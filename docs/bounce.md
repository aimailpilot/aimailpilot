# Bounce System — Architecture, Classification & Reset Logic

> Last updated: 2026-04-21
> Related files: `server/routes.ts` (reset endpoints), `server/services/campaign-engine.ts` (surge detection), `server/services/outlook-reply-tracker.ts`, `server/services/gmail-reply-tracker.ts`, `client/src/pages/campaign-detail.tsx`

---

## 1. How Bounces Are Recorded

Bounces enter the system from two separate paths:

### Path A — Send-time (campaign-engine.ts)
When `sendBatched()` sends an email and the SMTP/API call fails, the error is classified immediately:

- **Infrastructure errors** (OAuth token expired, connection refused, 401/403): set `status='failed'`, `errorMessage` = raw provider error string. These are NOT true bounces — email never left.
- **Real bounces** (provider accepted then rejected, e.g. `550 5.1.1 user unknown`): set `status='bounced'`, contact marked `status='bounced'`, added to `suppression_list`, `bouncedCount` incremented on campaign, `tracking_events` row created with `type='bounce'`.

### Path B — Reply-tracker NDR (outlook-reply-tracker.ts / gmail-reply-tracker.ts)
After an email is delivered, the provider sends an NDR (Non-Delivery Report) back to the sender inbox. The reply trackers poll every 5 minutes and detect these:

- **Outlook**: detects NDR by `from=mailer-daemon/postmaster` OR subject contains `undeliverable/delivery failed/etc.`. Writes `errorMessage: 'Bounce: <NDR subject>'`.
- **Gmail**: detects NDR similarly. Writes `errorMessage: 'Bounce detected: <NDR subject>'`.

**Critical limitation**: Both trackers write the same `"Bounce: ..."` / `"Bounce detected: ..."` prefix for ALL NDR types — both true hard bounces (5.1.1 invalid address) AND provider policy blocks (5.7.1 sender blocked). The NDR body is not stored in the error message, so the type is indistinguishable later.

---

## 2. Bounce Surge Detection (campaign-engine.ts)

A rolling-window detector in `sendBatched()` auto-pauses campaigns undergoing mass rejection:

```
SURGE_WINDOW = 50          // last N sends tracked
SURGE_BOUNCE_THRESHOLD = 0.2  // 20% bounce rate triggers
SURGE_MIN_BOUNCES = 10     // minimum absolute bounces before checking rate
SURGE_CONSECUTIVE = 10     // OR: 10 consecutive bounces triggers immediately
```

When tripped:
1. Campaign status set to `'paused'`, `autoPaused = true` (so boot recovery can resume)
2. A `tracking_events` row of type `'bounce_surge'` is written with metadata: `{ reason, senderEmail, consecutiveBounces, windowBounces, windowSize, lastError }`
3. Campaign engine stops processing that campaign

The `bounce_surge` event powers a red alert banner in the campaign detail UI (`campaign-detail.tsx`) with remediation steps.

---

## 3. False Bounce Classification (isFalseBounceError in routes.ts)

Used by the reset endpoints to decide which bounces are auto-recoverable without user confirmation:

**Auto-matches (safe to reset without confirmation):**
- Auth/token failures: `oauth`, `token`, `re-authenticate`, `401`, `403`, `invalidauthenticationtoken`, `credentials`, `smtp auth`
- Connection failures: `connection refused`, `getaddrinfo`
- Explicit sender-policy SMTP codes: `5.7.0`, `5.7.26`, `throttle`, `quota exceeded`, `temporarily rate`, `messagerejected`
- `5.7.1` ONLY when accompanied by `policy`, `blocked`, `spam`, or `sender` — prevents matching legitimate relay errors

**Does NOT auto-match (requires explicit force-mode):**
- `"Bounce: <subject>"` — Outlook NDR prefix (could be 5.1.1 or 5.7.1, indistinguishable)
- `"Bounce detected: <subject>"` — Gmail NDR prefix (same problem)
- Generic `blocked`, `denied`, `spam` alone without SMTP codes
- `5.7.1` alone without policy context

**Why NDR prefixes were removed from auto-match (2026-04-21):**
The Outlook/Gmail reply trackers write `"Bounce: ..."` for both policy blocks AND true hard bounces. Including this as auto-match caused 43 contacts to be restored that may have included invalid addresses — we could not distinguish which were recoverable. Removed to prevent unsuppressing genuinely undeliverable emails.

---

## 4. Reset Endpoints

### GET `/api/campaigns/:id/reset-bounces-preview`
Dry run — returns what would be reset:
```json
{
  "total": 5,           // messages matching isFalseBounceError (auto-reset candidates)
  "totalBounced": 43,   // all failed/bounced messages
  "noErrorMessageCount": 2,
  "byPattern": { "auth_error": 3, "throttle": 2 },
  "errorSamples": ["Bounce: Undeliverable: ...", "..."],
  "sample": [{ "id": "...", "email": "...", "error": "...", "status": "bounced" }]
}
```

### POST `/api/campaigns/:id/reset-bounces`
Body: `{ force?: boolean }`

- `force=false` (default): only resets messages where `isFalseBounceError(errorMessage)` is true
- `force=true`: resets ALL failed/bounced messages regardless of error text (user must confirm warning)

For each reset message:
1. Deletes `tracking_events WHERE "messageId" = ? AND type = 'bounce'`
2. Deletes the campaign message row
3. Restores contact `status` from `'bounced'` → `'active'`
4. Calls `removeFromSuppressionList(orgId, email)`
5. Recalculates `bouncedCount` and `sentCount` on the campaign

Returns: `{ deletedMessages, restoredContacts, unsuppressedCount, clearedTrackingEvents, actualBounces, actualSent }`

### POST `/api/campaigns/:id/retry-after-unblock`
Same reset logic as above, then resumes the campaign:
1. Sets `status='active'`, `autoPaused=false`
2. Calls `campaignEngine.startCampaign({ campaignId, delayBetweenEmails, batchSize, sendingConfig })`

Handles `paused`, `draft`, and `completed` campaign states.

### GET `/api/campaigns/:id/bounce-surge`
Returns latest `bounce_surge` tracking event metadata for the UI banner. Returns `null` if no surge event.

---

## 5. UI Flow (campaign-detail.tsx)

### "Reset false bounces" button (Actions menu, shown when bouncedCount > 0)
1. Calls preview endpoint
2. Shows `byPattern` breakdown and sample error strings in confirm dialog
3. **If `total > 0`**: standard confirm → POST without force
4. **If `total = 0` AND `totalBounced > 0`**: shows warning dialog explaining NDR ambiguity — user must explicitly confirm that sender is unblocked AND addresses are valid → POST with `force: true`

### "Retry after unblock" button (Actions menu, shown when bouncedCount > 0)
Same force-mode logic as above, but POSTs to `/retry-after-unblock` which also resumes the campaign.

### Bounce surge banner
Red alert banner shown above Overview when `bounce_surge` event exists. Shows:
- Reason text
- Last error string
- Sender email
- "Next steps" pointing to Retry after unblock action

---

## 6. Known Limitations & Future Work

1. **NDR type ambiguity**: The Outlook/Gmail reply trackers write `"Bounce: <subject>"` for both hard bounces and policy blocks. The NDR body is not stored in the error message. To fix this properly (without touching protected reply tracker code), a future enhancement could parse the NDR body text at write time to extract SMTP codes and write them into `errorMessage`.

2. **Suppression list on force-reset**: Force-reset removes contacts from `suppression_list`. If any of those contacts were genuinely invalid addresses, they will receive emails again until they bounce again. Users should only force-reset when confident addresses are valid.

3. **Bounce surge tracking events**: `bounce_surge` events are never deleted. If a campaign is paused/resumed multiple times, multiple surge events accumulate. The UI shows only the latest one (by `createdAt DESC`).
