# Recommended Tasks — Backlog

Tasks identified during debugging sessions but deferred. Review before starting new work to see if any are still relevant.

---

## 1. Pre-send preview modal (Part B)

**Priority:** HIGH
**Risk:** LOW
**Effort:** ~200 LoC (backend + frontend)

**Problem:**
Campaign engine silently filters contacts at send time (bounced, unsubscribed, suppression_list, invalid email, already-processed). User has no visibility into WHY contacts were dropped. Caused a 6-hour debug session on 2026-04-13 where a campaign with 18 selected contacts only sent to 1 — the other 17 were on the suppression_list with reason=bounce/hard/auto.

**Fix:**
1. New endpoint `POST /api/campaigns/:id/preview-send` — runs the same filters as `startCampaign` but without sending. Returns:
   ```json
   {
     "total": 18,
     "eligible": 1,
     "filtered": {
       "bounced": [...contacts],
       "unsubscribed": [...contacts],
       "suppressed": [...contacts with reason/bounceType/source],
       "invalidEmail": [...contacts],
       "alreadySent": [...contacts]
     }
   }
   ```
2. Modify `POST /api/campaigns/:id/send` to accept `overrideContactIds: string[]` — when present, bypass suppression/bounced filters for those specific IDs. NEVER allow override of `unsubscribed` (CAN-SPAM/GDPR).
3. Frontend modal on Send click:
   - Summary counts + expandable list per filter reason
   - Per-contact checkbox to force-include
   - Warmup accounts stay uncheckable (once that filter is added)
   - "Send to N eligible" CTA

**Files:**
- [server/routes.ts](../server/routes.ts) — new preview endpoint, modify existing send endpoint
- [server/services/campaign-engine.ts](../server/services/campaign-engine.ts) — extract filter logic into reusable function, accept `overrideContactIds` param
- [client/src/pages/campaign-creator.tsx](../client/src/pages/campaign-creator.tsx) — confirmation modal before send

**Why it's the best fix:**
Catches silent-filter problems at the exact moment they matter (Send time). Single modal solves the entire debug problem. No need for users to proactively hunt through admin pages.

---

## 2. Fix over-aggressive hard-bounce classifier (Part C)

**Priority:** MEDIUM-HIGH
**Risk:** MEDIUM (touches `reply-classifier.ts` which is on the CLAUDE.md protected list — requires explicit approval)
**Effort:** ~100 LoC

**Problem:**
`reply-classifier.ts` defaults `bounceType = 'hard'` at line 177 and 190. Soft/transient failures (token expiry, temporary Gmail rejection, SMTP auth errors) get misclassified as hard bounces, which auto-adds the recipient to `suppression_list` permanently. This is how 17 internal `@aegis.edu.in` addresses ended up blocked on 2026-04-13.

**Fix:**
1. Default `bounceType = 'soft'` when classifier is unsure
2. Only classify `'hard'` on clear permanent signals:
   - `550-5.1.1 no such user`
   - `551 not a valid mailbox`
   - `5.1.10 recipient not found`
   - Similar RFC 3463 5.x.x codes indicating permanent failure
3. Soft bounces should NOT auto-suppress — increment a counter and only suppress after N consecutive soft bounces (e.g., 3)
4. Add a soft-bounce counter column to `contacts` table

**Files:**
- [server/services/reply-classifier.ts](../server/services/reply-classifier.ts) — PROTECTED, requires approval
- [server/services/bounce-sync-engine.ts](../server/services/bounce-sync-engine.ts) — 5 call sites hardcoded to `bounceType: 'hard'`
- [server/services/gmail-reply-tracker.ts](../server/services/gmail-reply-tracker.ts) — PROTECTED, line 606
- [server/services/outlook-reply-tracker.ts](../server/services/outlook-reply-tracker.ts) — PROTECTED, line 416
- [server/pg-storage.ts](../server/pg-storage.ts) — `markContactBounced` defaults to `'hard'` (line 2760)

**Risk notes:**
- Multiple PROTECTED files. Do NOT start without user approval.
- Test with real bounce payloads from Gmail/Outlook before deploying.
- Backfill strategy needed: what to do with existing `bounceType='hard'` entries that may be false positives.

---

## 3. Blocklist tab improvements — DROPPED

**Priority:** LOW (deferred indefinitely)
**Risk:** MEDIUM-HIGH
**Effort:** ~300 LoC

**Why dropped:**
Initial thought was to merge `contact.status='bounced'` and `suppression_list` entries into the Blocklist tab so users can see the TRUE blocklist. Analysis showed:

1. `contact.status='bounced'` is referenced in 20+ places (lead intelligence, ratings, stats, inbox filters, scorecard). Changing the meaning of "bounced" ripples across the app.
2. CLAUDE.md rule: "NEVER replace working `storage.getContacts()` calls with raw SQL as the primary path — caused contacts page to show 0 contacts TWICE." Blocklist tab uses `getContacts()`.
3. `suppression_list` joins by `LOWER(email)` (no contactId), breaks pagination semantics.
4. The "unbounce" endpoint fix would silently undo legitimate hard-bounce protection.
5. **Preview modal (Task 1) solves the user's actual pain better** — catches the problem at Send time instead of requiring proactive inspection of a settings page.

**When to reconsider:**
- If users repeatedly ask "where can I see what's blocked?" after Task 1 ships
- If Task 2 is completed and suppression_list stops accumulating false positives — at that point the ~20% gap (suppression_list-only blocks) becomes negligible
- If a compliance/audit requirement demands a unified view

---

## 4. Outlook follow-up threading fix

**Priority:** HIGH
**Risk:** MEDIUM (touches `sendViaMicrosoftGraph` which is on the CLAUDE.md protected list — requires explicit approval)
**Effort:** ~80 LoC

**Problem:**
Gmail follow-up threading works (fixed 2026-04-13 for campaign `7e0538f5`). Outlook follow-ups do NOT thread — recipients see each follow-up as a separate standalone email in their inbox.

**Verified 2026-04-13:** Campaign `6aaeff05-167c-449f-98e1-8efcbcf5bdd4` (test AGBA 2026, Outlook sender `tw@bellaward.com`) sent 9 step-0 + 7 follow-ups. Recipient in Outlook inbox sees 3 separate emails. Same recipient in Gmail sees all emails in one thread.

**Root cause:**
`sendViaMicrosoftGraph` doesn't capture the real `internetMessageId` from the Graph API response after send. Instead it generates synthetic fallback IDs like `graph-1776052921612-noheaders` (note the `-noheaders` suffix — the tell). Without the real RFC Message-ID, follow-ups can't set proper `In-Reply-To`/`References` headers, so Outlook/Exchange treats each follow-up as a new standalone email.

**Why Gmail works but Outlook doesn't:**
- Gmail has TWO threading mechanisms: `threadId` (API param) + RFC headers. We store the Gmail threadId at step-0 send time.
- Outlook has ONLY RFC header threading — there's no equivalent of `threadId`. Without capturing the real `internetMessageId`, threading is impossible.

**Fix:**
1. After Graph `sendMail` succeeds, fetch the sent message via `GET /me/mailFolders/SentItems/messages?$filter=...` to retrieve the real `internetMessageId`
2. Store it in the `messageId` column (same column added for Gmail fix) AND `providerMessageId`
3. Follow-up engine `executeFollowup` already falls back to stored `messageId` — no changes needed there
4. Remove the `-noheaders` synthetic fallback (or log it as a warning so we can detect when Graph fetch fails)

**Files:**
- [server/services/campaign-engine.ts](../server/services/campaign-engine.ts) — `sendViaMicrosoftGraph` (PROTECTED, needs approval)
- [server/services/followup-engine.ts](../server/services/followup-engine.ts) — `sendEmail` Outlook path may need similar fetch-after-send for follow-up's own messageId
- No changes to `executeFollowup` threading block (fallback chain already handles it)

**Risk notes:**
- `sendViaMicrosoftGraph` is on the CLAUDE.md protected list. Do NOT start without user approval.
- Graph API `SentItems` fetch is async — there can be a short delay before the sent message appears. May need retry logic.
- Test thoroughly: send a real campaign, verify follow-ups thread in recipient's Outlook inbox.

---

## 5. Suppression list management page — DROPPED

**Priority:** LOW (deferred indefinitely)
**Risk:** LOW

**Why dropped:**
User already has a Blocklist tab in Contacts. Building a separate admin page is duplication. Preview modal (Task 1) covers the "remove from suppression" flow at the moment it's needed (just before sending). No separate admin hygiene page required for now.

**When to reconsider:**
- If support volume shows users need bulk suppression management outside of campaign-send workflow
- If legal/compliance requires an audit page showing all suppression entries with timestamps

---

## Incident log — 2026-04-13

**Context for future Claude sessions:**

- Campaign `7e0538f5-22d0-4d27-ae96-1d76c72c0a1d` (BAI Warmup) showed 18 contacts selected but only 1 sent
- Root cause: 17 contacts in `suppression_list` with `reason=bounce, bounceType=hard, source=auto`
- These were internal `@aegis.edu.in` addresses — likely false positives from transient delivery failures misclassified as hard bounces
- Manual recovery: DELETE from suppression_list for the 17 emails + UPDATE contacts SET status='cold' where status='bounced' (matched via the campaign's contactIds array)
- After recovery: user needs to DUPLICATE the campaign (not resume) — the already-processed filter at [campaign-engine.ts:569](../server/services/campaign-engine.ts#L569) will skip the 1 contact from the old campaign
- Debug time: ~6 hours. Primary cause of time loss: silent filtering with no user-facing feedback at Send time.
