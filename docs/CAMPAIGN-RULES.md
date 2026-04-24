# Campaign Management Rules & Logic

This document captures every rule governing campaign sending, follow-ups, pause/resume, and scheduling. Use it to audit for logical issues and missing edge cases.

---

## 1. Campaign Lifecycle (Status Transitions)

```
draft → active → paused → active → following_up → completed
                    ↑                      ↑
          (auto-pause on window/limit)     |
                                           ↓
                                       completed
draft → scheduled → active  (at scheduledAt time, or boot recovery)
```

| From | To | Trigger | File:Line |
|------|----|---------|-----------|
| draft/paused | `active` | User clicks Send or Resume | routes.ts:~3260, campaign-engine.ts:594 |
| active | `paused` | User clicks Pause | campaign-engine.ts:1239 |
| active | `paused` | Outside sending window (auto) | campaign-engine.ts:735 |
| active | `paused` | Daily limit reached (auto) | campaign-engine.ts:785, 824 |
| active | `paused` | 3 consecutive infra failures | campaign-engine.ts:1092-1103 |
| paused | `active` | Sending window re-opens (auto) | campaign-engine.ts:756 |
| paused | `active` | Daily limit resets at midnight (auto) | campaign-engine.ts:849 + index.ts daily reset block |
| paused (`autoPaused=true`) | `active` | 15-min poll: account `dailySent < dailyLimit` (auto) | index.ts `resumeDailyLimitPausedCampaigns()` |
| active | `following_up` | All Step 1 contacts processed + has follow-up steps | campaign-engine.ts:1196 |
| active | `completed` | All Step 1 contacts processed + no follow-up steps | campaign-engine.ts:1200 |
| following_up | `completed` | All follow-up executions done (sent/skipped/failed) | followup-engine.ts:496 |
| any | `paused` | User clicks Stop | routes.ts:3331 |
| draft | `scheduled` | User schedules campaign | campaign-engine.ts:1299 |
| scheduled | `active` | scheduledAt time arrives (in-memory setTimeout) | campaign-engine.ts:1615 |
| scheduled | `active` | Boot recovery: scheduledAt has passed while server was down | index.ts 15s boot block |

**Edge cases identified:**
- ❌ `stopCampaign()` sets status to `paused` — not a distinct "stopped" status. Stopped campaigns can be resumed.
- ❌ No status gate on `getActiveCampaignFollowups()` — follow-up engine processes ALL campaigns with `isActive=1` follow-up links, even `paused` ones. This means follow-ups can fire while campaign is paused (sending window check in `processCampaignFollowups` is the only gate).
- ❌ `checkFollowupCompletion` only checks `status === 'following_up'` — if campaign is still `active` (Step 1 in progress), completion check is skipped. This is correct for parallel operation.

---

## 2. Step 1 Sending Rules (campaign-engine.ts)

### 2.1 Contact Filtering (startCampaign, lines 498-567)
1. Load contacts from `segmentId` OR `contactIds` OR all org contacts
2. Filter out `status === 'unsubscribed'` contacts
3. Filter out `status === 'bounced'` contacts
4. Filter out contacts with `emailVerificationStatus` in `['invalid', 'disposable', 'spamtrap']` (if `emaillistverify_block_invalid` enabled)
5. Filter out contacts that already have a message record for this campaign+step (prevents duplicate sends on resume)
6. If 0 contacts remain after filtering → set `following_up` or `completed`

### 2.2 Sending Window (checkSendingWindow, lines 343-388)
- Only enforced when `autopilot.enabled = true`
- Checks day-of-week enabled + time window (startTime/endTime)
- Uses IANA timezone (DST-aware), falls back to numeric `timezoneOffset`
- If outside window → auto-pause, sleep until next window, re-check every 60s
- On resume after window sleep → resets `autopilotDailySent = 0`

### 2.3 Daily Limits
- **Account daily limit** (line 806): `accountDailySent + localSentCount >= accountDailyLimit`
  - Per-email-account limit from `emailAccount.dailyLimit` or provider default
  - On hit → sets `status='paused'`, `autoPaused=true`
  - Auto-resume path 1: midnight UTC — `resetDailySentAll()` runs, immediately calls `resumeDailyLimitPausedCampaigns()` (index.ts)
  - Auto-resume path 2: every 15 minutes — `resumeDailyLimitPausedCampaigns()` polls for `autoPaused=true` campaigns with any account still having `dailySent < dailyLimit` (catches mid-day limit increases or second accounts with capacity)
- **Autopilot max per day** (line 764): `autopilotDailySent >= autopilotMaxPerDay`
  - Campaign-level setting from `sendingConfig.autopilot.maxPerDay`
  - On hit → pause, sleep until next window
  - Resets when window sleep ends (line 760, 798)

### 2.4 Throttling (lines 1157-1167)
- Base delay: `sendingConfig.delayBetweenEmails` (user-configured, e.g., 120000ms = 2 min)
- Jitter: ±30s random (`Math.random() * 60000 - 30000`)
- Minimum delay: 1 second (`Math.max(1000, delay + jitter)`)
- Applied between every email (not between batches)

### 2.5 Auto-Pause on Infra Failures (lines 1084-1104)
- Tracks `localFailedCount` for infrastructure errors (OAuth, timeout, connection refused)
- Infrastructure errors are NOT counted as bounces
- After 3 consecutive infra failures with 0 successful sends → auto-pause and stop
- Real bounces (invalid email, mailbox full) ARE counted → contact marked `bounced`

### 2.6 Reply Check on Resume (lines 679-693)
- Pre-loads all campaign messages, builds `repliedContactIds` set
- During send loop, skips contacts in this set (line 853)
- One-time check at start — does NOT re-check mid-loop

### 2.7 Email Sending Priority
For each contact:
1. **Gmail/Google** → Try Gmail API with OAuth token → on 401, retry once → if still fails and has real SMTP creds, fall back to SMTP → else error
2. **Outlook/Microsoft** → Try Microsoft Graph API → on 401/403, force token refresh + retry → if still fails and has SMTP, fall back to SMTP → else error
3. **Other providers** → SMTP only

### 2.8 Message Record Flow
1. Create message with `status: 'sending'`, `sentAt: null` (line 908-918)
2. On success → update to `status: 'sent'`, `sentAt: now`, save `providerMessageId` + `gmailThreadId` (lines 1046-1053)
3. On failure → update to `status: 'failed'`, `errorMessage: ...` (line 1068)

### 2.9 Stats Flushing (lines 1130-1146)
- Batch-flush `sentCount` and `bouncedCount` every 25 emails (FLUSH_INTERVAL)
- Final flush after loop completes
- `incrementDailySent` called on each flush

---

## 3. Follow-up Engine Rules (followup-engine.ts)

### 3.1 Polling
- Runs every **30 seconds** (line 1312)
- Immediate run on server boot (line 1314)
- Calls `processFollowupTriggers()` which does two things:
  1. `processCampaignFollowups()` — evaluate new triggers
  2. `processScheduledFollowups()` — execute pending scheduled follow-ups

### 3.2 Follow-up Trigger Evaluation (processCampaignFollowups, lines 625-685)
1. Check sending window — skip campaign if outside window
2. Load ALL campaign messages (up to 50,000)
3. Load all follow-up steps for the sequence
4. Batch-load all existing executions → `executionSet` for O(1) lookup
5. Build `contactReplied` set from messages with `repliedAt`
6. Filter messages to: `stepNumber === 0 AND status === 'sent' AND sentAt exists` ← **the bug fix**
7. For each original message:
   - Skip if contact has replied to ANY message in campaign → create `skipped` execution
   - For each step: skip if execution already exists → re-fetch message from DB → evaluate trigger

### 3.3 Delay Calculation (evaluateFollowupTrigger, lines 721-793)
- Delay = `delayDays * 86400000 + delayHours * 3600000 + delayMinutes * 60000`
- **Reference time** depends on step number:
  - Step 1 (`stepNumber=1`): relative to Step 0's `sentAt` (the original message)
  - Step 2+ (`stepNumber=2+`): relative to previous step's `sentAt` via `getCampaignMessageByContactAndStep`
  - If previous step not yet sent → return false (can't trigger)
- Trigger condition check after delay passes:
  - `no_reply` / `if_no_reply` → `!message.repliedAt`
  - `no_open` / `if_no_open` → `!message.openedAt`
  - `no_click` / `if_no_click` → `!message.clickedAt`
  - `opened` / `if_opened` → `!!message.openedAt`
  - `clicked` / `if_clicked` → `!!message.clickedAt`
  - `replied` / `if_replied` → `!!message.repliedAt`
  - `bounced` → `!!message.bouncedAt`
  - `time_delay` / `no_matter_what` → always true after delay

### 3.4 Scheduling Follow-ups (scheduleFollowup, lines 805-875)
1. Load contact and campaign
2. Get template content if `templateId` set
3. Calculate `scheduledAt` via `getNextValidSendTime(sendingConfig)` — next valid sending window slot
4. Create follow-up execution with `status: 'pending'`, `scheduledAt`
5. If step has NO delay configured (`delayDays=0, delayHours=0, delayMinutes=0`):
   - Re-check reply status
   - If no reply → execute immediately

### 3.5 Processing Scheduled Follow-ups (processScheduledFollowups, lines 867-933)
1. Load all pending executions from DB
2. Skip executions where `now < scheduledAt`
3. Group by campaignId for batch loading
4. Check sending window per campaign — defer if outside
5. Batch-load messages, build `contactReplied` set
6. For each execution:
   - Re-check if contact replied (catches replies between scheduling and execution)
   - If replied + trigger is `no_reply` → skip
   - Otherwise → `executeFollowup()`

### 3.6 Executing Follow-ups (executeFollowup, lines 941-1240+)
1. Load execution, contact, step, campaign message
2. **Reply re-check** using preloaded campaign messages (catches last-second replies)
3. Threading: find original step-0 message for In-Reply-To/References headers
4. Subject: use step subject if different from original; otherwise exact original subject (no "Re:" when threaded)
5. Full personalization (same 22+ variables as Step 0)
6. Create new message record with correct `stepNumber`
7. Send via Gmail API / Microsoft Graph / SMTP (same priority as Step 0, with 401 retry + refresh)
8. Save `gmailThreadId` on follow-up message for downstream threading
9. Update execution status to `sent` or `failed`

### 3.7 Completion Check (checkFollowupCompletion, lines 470-499)
- Only runs for campaigns with `status === 'following_up'`
- Counts: `step0Count` = messages with `stepNumber=0 AND status='sent'` — **bounced step-0 contacts excluded** (they never receive executions, so including them permanently inflates `totalExpected`)
- Counts: `totalExpected = step0Count * totalFollowupSteps` (across ALL sequences via `getCampaignFollowups`)
- Counts: `totalDone = executions with status sent/skipped/failed`
- If `totalDone >= totalExpected && totalPending === 0` → mark campaign `completed`

---

## 4. Pause / Resume Rules

### 4.1 Pause (routes.ts:3272, campaign-engine.ts:1239)
- If campaign is in-memory (`activeCampaigns` map): set `tracker.paused = true`, update DB status
- If not in memory: just update DB status to `paused`
- Send loop checks `tracker.paused` every 1 second and waits

### 4.2 Resume (routes.ts:3280)
- If campaign is in-memory: set `tracker.paused = false`, update DB status to `active`
- If NOT in memory (server restarted while paused):
  - Always calls `startCampaign()` which:
    - Loads contacts, filters already-processed ones
    - Sends remaining contacts
    - If 0 remaining → sets `following_up` or `completed`
  - Restores `sendingConfig` from DB (delay, autopilot, time windows, maxPerDay)

### 4.3 Stop (routes.ts:3329, campaign-engine.ts:1265)
- Removes from `activeCampaigns` map (send loop breaks on next iteration check)
- Sets status to `paused` (not a distinct status)

---

## 5. Parallel Step Operation (Large Lists)

For a 3000-contact campaign with Step 2 at 3 days:

1. **Day 1**: Campaign engine sends Step 1 to contacts (status: `active`)
2. **Day 1+**: Follow-up engine polls every 30s, finds sent Step 0 messages
3. **Day 4**: Follow-up engine evaluates contacts sent on Day 1 → 3-day delay elapsed → schedules Step 2
4. **Day 4**: Campaign engine may still be sending Step 1 to remaining contacts
5. **Both run simultaneously**: No conflict because:
   - Follow-up engine operates on `followup_executions` table
   - Campaign engine operates on new `messages` records
   - They share no in-memory state
6. When Step 1 finishes → status becomes `following_up`
7. When ALL follow-up executions complete → status becomes `completed`

---

## 6. Server Restart Recovery

| State at restart | Recovery behavior |
|------------------|-------------------|
| `active` (sending) | Pass 1 of `resumeActiveCampaigns()` at 10s boot — calls `startCampaign()` → skips already-sent contacts, continues from where it left off. **Automatic.** |
| `paused` (user-paused, `autoPaused=false`) | NOT auto-resumed. Manual resume required. |
| `paused` (system-paused, `autoPaused=true`) + `autopilot.enabled=true` | Pass 2 of `resumeActiveCampaigns()` at 10s boot — auto-resumed. **Automatic.** |
| `paused` (system-paused, `autoPaused=true`) + `autopilot.enabled=false` | NOT auto-resumed on boot. Will auto-resume when `resumeDailyLimitPausedCampaigns()` next fires (every 15 min or midnight reset) and an account has remaining capacity. |
| `following_up` | Follow-up engine restarts on boot → polls every 30s → picks up active campaign_followups → continues processing. **Automatic.** |
| `scheduled` (scheduledAt already passed) | Boot block at 15s queries `status='scheduled' AND scheduledAt <= now` → calls `startCampaign()` for each. **Automatic.** |
| `scheduled` (scheduledAt in future) | `scheduleCampaign()` is called again via the route that created it... but in-memory setTimeout is lost. **Lost on restart** — future-scheduled campaigns need a re-queue mechanism or manual trigger. |

---

## 7. Known Edge Cases & Potential Issues

### 7.1 CONFIRMED BUGS (all fixed)
- ✅ **Null sentAt bypass**: Messages with `sentAt=null` evaluated by follow-up engine — `new Date(null)=epoch` — 3-day delay thought 56 years passed, follow-ups fired immediately. **Fixed**: Filter requires `status='sent' AND sentAt exists`.
- ✅ **Resume shortcut skipping contacts**: `sentCount > 0` treated as "all Step 1 done" — only 8/92 contacts sent. **Fixed**: Resume always calls `startCampaign()`.
- ✅ **P2: Follow-ups firing on paused campaigns**: `processScheduledFollowups()` and `executeFollowup()` now check `campaign.status`. Paused/cancelled/draft — execution stays `pending` (deferred, not skipped) for natural resume on un-pause.
- ✅ **P4: No account daily limit for follow-ups**: `executeFollowup()` atomically reserves a send slot via `UPDATE email_accounts SET dailySent=dailySent+1 WHERE dailySent < dailyLimit RETURNING id`. Decrements on send failure. Shares counter with campaign engine sends.
- ✅ **P6: No bounce check for follow-ups**: `processCampaignFollowups()` builds `contactBounced` set and creates `skipped` execution records for all steps when original message bounced.
- ✅ **P8: Completion check wrong with multiple sequences**: `checkFollowupCompletion()` now aggregates steps across ALL sequences via `getCampaignFollowups(campaignId)`. `totalExpected = step0Count x totalFollowupSteps` across all sequences.
- ✅ **P10: Double-send race condition**: `executeFollowup()` uses atomic `UPDATE SET status='processing' WHERE status='pending' RETURNING id` claim. Null return = already claimed. 5-min stuck-processing recovery in `processFollowupTriggers()`.
- ✅ **50k message fetch per cycle**: All three `getCampaignMessages(campaignId, 50000, 0)` calls replaced with targeted indexed queries. ~100-1000x DB load reduction.
- ✅ **Idempotency gap**: `executeFollowup()` checks for existing sent message record before sending. Prevents duplicate sends on crash recovery.
- ✅ **Overlapping engine cycles**: `startFollowupEngine()` uses `isProcessing` boolean lock — overlapping 30s cycles skip instead of running concurrently.
- ✅ **totalRecipients inflated by follow-up sends** — CONFIRMED FIXED 2026-04-24: `getCampaignMessageStats()` now returns `step0Sent`/`step0Bounced` fields. All auto-heal locations use `max(step0Sent+step0Bounced, contactIds.length)`. Production verified: 12/12 campaigns show `totalRecipients = contactIds.length` exactly.
- ✅ **checkFollowupCompletion bounce-inflated totalExpected** — CONFIRMED FIXED 2026-04-24: step0Count query now filters `AND status='sent'` to exclude bounced step-0 messages. Production verified: `test AGBA 2026 Nominations Open —` (stuck with 0 step-0 sent) correctly completed on first engine cycle after deploy.
- ✅ **Scheduled campaigns lost on restart (overdue)** — CONFIRMED FIXED 2026-04-24: 15s boot block queries `status='scheduled' AND scheduledAt <= now`. Production verified: zero campaigns stuck in `scheduled` after deploy.
- ✅ **Daily-limit-paused campaigns not auto-resuming** — CONFIRMED FIXED 2026-04-24: `resumeDailyLimitPausedCampaigns()` polls every 15 min + fires immediately after midnight reset. Production verified: campaigns updated exactly 15 min after pause.

### 7.2 REMAINING ISSUES (not yet fixed)

#### P1: Scheduled campaigns with future scheduledAt lost on server restart
- `scheduleCampaign()` uses `setTimeout` — in-memory only
- If server restarts before `scheduledAt`, the campaign stays `scheduled` indefinitely
- **Partial fix in place (CONFIRMED WORKING 2026-04-24)**: Boot block at 15s recovers campaigns where `scheduledAt` has already passed during downtime — zero campaigns stuck in scheduled after deploy
- **Still missing**: Re-queuing future-dated `scheduled` campaigns into a new `setTimeout` on boot — low priority since most scheduled campaigns are set for near-term launch

#### P11: BA_AI Panel Host — autoPaused since 2026-04-22, not resuming (monitoring)
- Campaign has `autoPaused=true` since 2026-04-22, `sentCount=345/393`, 91 org accounts with `dailySent < dailyLimit`
- The 15-min `resumeDailyLimitPausedCampaigns` poll IS firing (other campaigns resume correctly) but `BA_AI Panel Host` `updatedAt` has not moved
- Likely cause: `startCampaign` hitting a silent error (OAuth token expiry on specific sending account, or all remaining contacts filtered out at start)
- **Diagnosis**: Check Azure logs for `[DailyLimitResume] Resuming campaign: BA_AI Panel Host` — if logged, error follows. If not logged, campaign is not matching the poll query (check if all accounts for this org have `dailyLimit IS NULL`)
- **Not blocking other campaigns**

#### P3: Daily limit counter race (campaign engine only)
- `autopilotDailySent` in `sendBatched()` resets to 0 when window sleep ends — in-memory, lost on restart
- Account-level `dailySent` (DB-backed, reset at UTC midnight) is the real safety net
- **Blocked**: Inside protected `sendBatched()` in campaign-engine.ts

#### P5: Reply check is point-in-time for Step 1
- `repliedContactIds` set built once at campaign start — stale mid-loop for long campaigns
- **Low risk**: Reply tracker has 15-min lookback; window is very narrow
- **Blocked**: Inside protected `sendBatched()` in campaign-engine.ts

#### P7: Multiple follow-up sequences per campaign (architecture)
- Each follow-up step is a separate sequence + campaign_followup link (campaign-creator.tsx:450)
- Works correctly — not a bug, just unusual architecture worth knowing


## 8. Sending Config Schema

```typescript
interface SendingConfig {
  delayBetweenEmails: number;    // ms between emails (e.g., 120000 = 2 min)
  timezoneOffset?: number;       // minutes offset from UTC (legacy)
  timezone?: string;             // IANA timezone (e.g., "Asia/Kolkata") — preferred, DST-aware
  batchSize?: number;            // not used in sendBatched loop
  autopilot?: {
    enabled: boolean;
    maxPerDay: number;           // campaign-level daily limit
    delayBetween: number;        // UI display value
    delayUnit: 'seconds' | 'minutes';
    days: {
      [dayName: string]: {       // Monday, Tuesday, etc.
        enabled: boolean;
        startTime: string;       // "09:00"
        endTime: string;         // "18:00"
      }
    }
  }
}
```

---

## 9. Follow-up Step Schema

```typescript
interface FollowupStep {
  id: string;
  sequenceId: string;
  stepNumber: number;            // 1 = first follow-up (Step 2 in UI), 2 = second follow-up (Step 3 in UI)
  trigger: string;               // no_reply, no_open, no_click, opened, clicked, replied, bounced, time_delay
  delayDays: number;             // days to wait after previous step
  delayHours: number;            // hours to wait
  delayMinutes: number;          // minutes to wait
  subject: string;               // follow-up subject (empty = reuse original)
  content: string;               // follow-up body HTML
  isActive: boolean;
}
```

---

## 10. Message Status Values

| Status | Meaning | Set by |
|--------|---------|--------|
| `sending` | Message record created, email not yet sent | campaign-engine.ts:913, followup-engine.ts:~1215 |
| `sent` | Email successfully delivered to provider | campaign-engine.ts:1047, followup-engine.ts:~1230 |
| `failed` | Email sending failed | campaign-engine.ts:1068, followup-engine.ts:~1240 |
| `bounced` | Real delivery bounce (NOT infrastructure failure) | Set via tracking events, not directly by campaign-engine |

---

## 11. Execution Status Values (followup_executions)

| Status | Meaning |
|--------|---------|
| `pending` | Scheduled, waiting for `scheduledAt` time |
| `processing` | Atomically claimed by engine cycle — in-flight. Reset to `pending` after 5 min if stuck (crash recovery). |
| `sent` | Follow-up email successfully sent |
| `skipped` | Skipped (contact replied, bounced, campaign paused, or daily limit reached) |
| `failed` | Failed to send (error logged in `errorMessage`) |

---

## 12. Rules Summary Checklist

### Before sending each email:
- [ ] Campaign not paused/stopped
- [ ] Within sending window (day + time)
- [ ] Under autopilot maxPerDay limit
- [ ] Under account dailyLimit
- [ ] Contact not replied (pre-loaded set)
- [ ] Contact not bounced/unsubscribed (filtered at start)
- [ ] Contact not already processed for this step (dedup)

### Before firing a follow-up:
- [x] Original message has `status='sent'` AND `sentAt` is not null
- [x] Configured delay has elapsed since reference time
- [x] Reference time = previous step's sentAt (not step 0 for Step 2+)
- [x] Previous step has been sent (for Step 2+)
- [x] Trigger condition met (e.g., no reply)
- [x] Execution doesn't already exist for this message+step (executionSet O(1) lookup)
- [x] Contact hasn't replied to ANY message in campaign (targeted query + re-check at execution)
- [x] Contact not bounced (contactBounced set — P6 fix)
- [x] Within sending window (day + time check)
- [x] Campaign not paused/cancelled (P2 fix — both scheduler and executor)
- [x] Under account daily limit (atomic reserve — P4 fix)
- [x] No duplicate send (idempotency guard — message existence check before send)
- [x] No double-claim (atomic processing status — P10 fix)
