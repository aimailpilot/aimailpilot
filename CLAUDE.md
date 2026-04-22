# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **IMPORTANT**: Before making any changes, read `status.md`. It lists features that are confirmed working in production and **must not be broken**. Do not modify code for those features unless explicitly asked to fix a bug in them.

> **Before searching the codebase**, read `FILE-INDEX.md` for the file-to-feature map. Go directly to the listed files instead of scanning.

> **DO NOT TOUCH — PROTECTED CODE (violating these rules has caused production outages)**
> - No changes to tracking code (open/click/reply) in routes.ts, campaign-engine.ts, followup-engine.ts
> - No changes to Gmail auth, Outlook auth, or OAuth routes
> - No changes to database init, backup, or guardrail code in storage.ts
> - No changes to `sendViaMicrosoftGraph` or `sendViaGmailAPI` functions
> - No changes to `gmail-reply-tracker.ts` or `outlook-reply-tracker.ts` (including per-org `checkingOrgs` lock logic, and the `15`-minute lookback in `runCheck()` — was `1440` which caused continuous DB saturation with 80 accounts; 15-min gives safe 3× overlap with 5-min poll cycle)
> - No changes to `warmup-engine.ts` — self-contained warmup service with own token helpers
> - No changes to `lead-intelligence-engine.ts` — self-contained email history scanner + AI classifier with own token helpers. All SELECT aliases in raw SQL queries MUST be double-quoted (e.g. `as "contactEmail"`, `as "totalReceived"`) — PostgreSQL lowercases unquoted aliases causing JS to read `undefined` from result rows, yielding 0 contacts analyzed (fixed 2026-04-21).
> - No changes to Gmail/Outlook threading logic (`gmailThreadId` storage, `executeFollowup` threading block, `sendEmail` threading headers)
> - No changes to `checkSendingWindow`, `getUserLocalTime`, `msUntilNextSendWindow` in campaign-engine.ts
> - No changes to `updateCampaignMessage` SQL in storage.ts — must include `gmailThreadId` column
> - No changes to Step 0 guarantee block in `/api/campaigns/:id/detail` route
> - No changes to campaign sending/pause/resume flow in routes.ts or campaign-engine.ts
> - No changes to `autoPaused` flag logic in `campaign-engine.ts` or `routes.ts` — system pauses (window closed, daily limit, sendBatched crash) MUST set `autoPaused=true`; user pauses/stops MUST set `autoPaused=false`. Boot recovery SQL filter depends on this distinction. Mixing them up causes user-paused campaigns to auto-restart on server reboot (2026-04-14 fix).
> - No changes to `resumeActiveCampaigns()` two-pass boot recovery — Pass 1 (`status='active'`) and Pass 2 (`status='paused' AND autoPaused=true AND autopilot.enabled=true`) are both required. SQL filters must stay on the DB side. Do NOT collapse into one pass or filter in-memory.
> - No changes to `processMessageFollowups()` in `followup-engine.ts` — must use bulk-loaded message directly (no per-contact `getCampaignMessage` re-fetch). Pre-loaded campaign must be passed from `processCampaignFollowups` → `processMessageFollowups` → `scheduleFollowup`. Reverting causes N×(2-5s) PG stalls that stall the engine mid-loop (caused 37 follow-ups to not send, 2026-04-09).
> - No changes to the `isProcessing` overlap lock in `startFollowupEngine()` — prevents concurrent 30s cycles from running simultaneously under PG load.
> - No changes to the atomic execution claim in `executeFollowup()` — `UPDATE SET status='processing' WHERE status='pending' RETURNING id` pattern. Do NOT revert to non-atomic `getById` + status check. Revert causes double-send race condition.
> - No changes to the 5-min stuck-processing recovery in `processFollowupTriggers()` — resets executions stuck in `processing` back to `pending` after crash/timeout.
> - No changes to targeted DB queries in `processCampaignFollowups()`, `processScheduledFollowups()`, `executeFollowup()` — do NOT restore `getCampaignMessages(campaignId, 50000, 0)` for replied/bounced set building. Was causing ~100-1000× unnecessary DB load per cycle.
> - No changes to atomic daily limit reservation in `executeFollowup()` — `UPDATE email_accounts SET dailySent=dailySent+1 WHERE dailySent < dailyLimit RETURNING id`. Do NOT revert to read-then-check. Decrement on failure is required.
> - No changes to idempotency guard in `executeFollowup()` — `SELECT 1 FROM messages WHERE campaignId+contactId+stepNumber+status='sent'` check before send. Prevents duplicate sends on crash recovery.
> - No changes to `checkFollowupCompletion()` multi-sequence aggregation — must call `getCampaignFollowups(campaignId)` and sum steps across ALL sequences. Was reading from one sequence only causing premature campaign completion.
> - No changes to campaign status guard in `processScheduledFollowups()` and `executeFollowup()` — must check `campaign.status === 'paused'/'cancelled'/'draft'` and defer (keep `pending`) not skip. Removes allow paused campaign executions to naturally resume on un-pause.
> - **NEVER** use `require('./db')` or import `server/db.ts` — caused 1 day of server crash (drizzle-orm not in production deps)
> - **NEVER** replace working `storage.getContacts()` calls with raw SQL as the primary path — caused contacts page to show 0 contacts TWICE (2026-04-04). Raw SQL may ONLY be used as an enhancement after `storage.getContacts()` has already fetched data. If raw SQL fails, the storage-fetched data must remain.
> - **NEVER** bypass `storage` methods for GET endpoints that work — if you must use raw SQL, always keep the working storage method as primary path and raw SQL as enhancement only
> - **NEVER** clear contacts/data on API error in the frontend (e.g., `setContacts([])` on fetch failure) — this causes "No contacts yet" display. Keep stale data visible on error; it's better UX than empty state.
> - **NEVER** modify the return value of `sendViaGmailAPI` — it must return `{ success, messageId, threadId }` for threading to work
> - When adding new SQL columns, always use `ALTER TABLE ADD COLUMN` with try/catch and update ALL relevant SQL statements (INSERT, UPDATE, SELECT) that touch that table
> - No changes to Reply tab filter in `pg-storage.ts` (`getInboxMessagesEnhanced`, `getInboxMessageCountEnhanced`, `getInboxStats`) — must be `(status = 'replied' OR "repliedAt" IS NOT NULL)`. Reverting to `status = 'replied'` alone causes empty Reply tab.
> - No changes to `forwardedFrom` capture in forward endpoint — must set `forwardedFrom: msg.fromEmail` when marking message as forwarded
> - No changes to bounce classifier thresholds in `reply-classifier.ts` — non-system senders require 3+ indicators. Lowering threshold causes legitimate replies to be misclassified as bounces.
> - No changes to reply classification rules in `reply-classifier.ts` — 30+ strengthened patterns for OOO, auto_reply, positive, negative, bounce. Do NOT weaken patterns or lower thresholds. Do NOT change `isHumanReply()` logic which identifies actionable replies (positive/negative/general/unsubscribe, excludes OOO/auto_reply/bounce).
> - No changes to boot reclassification in `server/index.ts` — targets `("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')` at 30s startup delay. Do NOT remove AI reclassification fallback for borderline cases.
> - No changes to inbox reply filter logic — "Emails Need Reply" and "Not Replied" must use `replyType IN ('positive', 'negative', 'general')` to exclude OOO/auto_reply/bounce. Do NOT revert to include-based filters (caused 11k false positives).
> - No changes to scorecard "Not Replied" 3-day lookback — enforced via `notRepliedCutoff` cutoff in `/api/team/scorecard`. Do NOT remove cutoff or revert to all-time counts — gives accurate signal for aged emails.
> - No changes to campaign enrichment `Promise.all` block in `GET /api/campaigns` — powers "Sent By" and "List" columns in campaign dashboard
> - No changes to `messages.recipientEmail` backfill in `pg-storage.ts initializeSchema()` — runs after COMMIT using `queryOne`/`execute`. Backfills email from `contacts` table where `contactId` still resolves. Required for rating engine fallback on re-imported contacts.
> - No changes to `getContactEngagementStats` 3-tier fallback in `pg-storage.ts` — (1) contactId match, (2) recipientEmail match, (3) old contactId via same email. All 3 tiers required. Removing any tier breaks rating for re-imported contacts.
> - No changes to email rating badge condition in `contacts-manager.tsx` — must use `emailRatingUpdatedAt` (not `emailRating > 0`). Contacts with 0/F rating are valid and must show badge.
> - No changes to batch rating fire-and-forget pattern in `POST /api/contacts/batch-rating` — must respond immediately then run `batchRecalculateRatings()` via `setImmediate()`. Making it synchronous causes HTTP timeout on large orgs.
> - No changes to `isSafeToSuppress()` guard in `bounce-sync-engine.ts` — EVERY scanner function that calls `addToSuppressionList` must call `isSafeToSuppress(email, connectedEmails)` first. `getOrgConnectedEmails()` loads email_accounts + warmup_accounts and must be called once at the top of `runBounceSyncForOrg()`. Removing or skipping this guard causes sender accounts (your own team) to be auto-added to the blocklist and excluded from campaigns. `scanOutlookHistorical()` previously missing this guard was the root cause of the sender-account blocklist bug (2026-04-13).
> - No changes to NDR extraction guard in `gmail-reply-tracker.ts` and `outlook-reply-tracker.ts` — when processing bounce NDR bodies, ONLY suppress the specific bounced recipient email found in structured NDR fields (Final-Recipient, X-Failed-Recipients). Do NOT regex-extract all emails from NDR body text and suppress them all — this caused sender accounts and Exchange routing IDs (*.prod.outlook.com) to be mass-added to suppression_list. Exchange internal routing IDs are message envelope IDs, not real mailboxes.
> - No changes to boot stagger in `resumeActiveCampaigns()` — the `await new Promise(r => setTimeout(r, 2000))` after each `startCampaign()` in both Pass 1 and Pass 2 is REQUIRED. Removing it causes simultaneous contact loading across all campaigns and OOM crash on boot (2026-04-17 fix).
> - No changes to zero-contact abort in `startCampaign()` — when `getContactsByIds()` returns 0 contacts, must return error immediately. Do NOT revert to `getContacts(org, 10000, 0)` fallback — loads all org contacts (188k+) and causes OOM crash.
> - No changes to `totalRecipients` update in `startCampaign()` in `campaign-engine.ts` — must be `Math.max(campaign.totalRecipients || 0, contacts.length + alreadyProcessedCount)`. Do NOT revert to raw `contacts.length` — on resume, `contacts` has been filtered to only the remaining-work set, and overwriting with that count shrinks the campaign's displayed audience (e.g. 1159 → 303 after 819 sent). The auto-heal in `GET /api/campaigns` and `GET /api/campaigns/:id/detail` uses `contactIds.length` as an additional floor to repair existing broken campaigns — do NOT remove either heal block (2026-04-22 fix).
> - No changes to `ownEmailsSet` warmup filter in `gmail-reply-tracker.ts` — built from `email_accounts` + `warmup_accounts`, checked per-message via regex-extracted `fromEmail`. The variable MUST be named `fromEmail` (not `senderEmail` — duplicate declaration compile error). Removing this causes warmup emails to flood unified inbox as `campaign match: false`.
> - No changes to 404 handling in `gmailFetch()` in `gmail-reply-tracker.ts` — must return `null` on 404 (not throw). Callers must check `if (!msg) continue`. Reverting causes retry loop noise for deleted messages.
> - No changes to follow-up tracking injection in `executeFollowup()` in `followup-engine.ts` — `followupTrackingId` generated before send, `addTrackingPixel()` + `addClickTracking()` applied to content before passing to `sendEmail()`. Same ID stored in message record and tracking event. Removing breaks Steps 2/3/4 open+click tracking (2026-04-18 fix).
> - No changes to `getAllRecentCampaignMessages()` 90-day cutoff in `pg-storage.ts` — `AND m."sentAt" >= $2` with 90-day window is required for index usage. Removing reverts to full table scan (11s+ query).
> - No changes to `getUnrepliedCampaignMessages()` 45-day cutoff in `pg-storage.ts` — `AND m."sentAt" >= $2` with 45-day window is required. Removing causes 8s+ full table scan ([PG-SLOW] 7908ms observed 2026-04-19).
> - No changes to `getInboxStats(orgId, accountIds?)` scoping in `pg-storage.ts` — `accountIds` param adds `AND "emailAccountId" IN (...)` to ALL count queries. Routes must pass member account IDs for non-admin users. Removing causes members to see org-wide counts (data leak).
> - No changes to Reply Quality auto-scorer in `server/index.ts` — 15-min `batchScoreOrgReplies` sweep (90s boot delay) populates `replyQualityScore`/`replyQualityLabel`. Removing causes dashboard hot/warm breakdowns to show zeros permanently.
> - No changes to `not_replied` filter in `pg-storage.ts` (`getInboxMessagesEnhanced`, `getInboxMessageCountEnhanced`, `getInboxStats`) — must be `"replyType" IN ('positive','negative','general') AND (status != 'replied' AND "repliedAt" IS NULL)`. Both conditions are required.
> - No changes to `isFalseBounceError()` in `routes.ts` — must NOT include `e.startsWith('bounce:')` or `e.startsWith('bounce detected:')` as auto-match patterns. These NDR prefixes are written by `outlook-reply-tracker.ts` and `gmail-reply-tracker.ts` for BOTH true hard bounces (5.1.1 invalid address) AND policy blocks (5.7.1 sender blocked) — they are indistinguishable. Adding them back causes valid contacts with genuinely invalid addresses to be unsuppressed silently. Force-mode (explicit user confirmation) is the correct gate for NDR bounces.
> - No changes to bounce surge detection constants in `campaign-engine.ts` (`SURGE_WINDOW=50`, `SURGE_BOUNCE_THRESHOLD=0.2`, `SURGE_MIN_BOUNCES=10`, `SURGE_CONSECUTIVE=10`) without testing. When tripped: campaign must be set `status='paused'`, `autoPaused=true`, and a `bounce_surge` tracking event written. Do NOT change `autoPaused` to `false` on surge — boot recovery must be able to resume it.
> - No changes to Team Scorecard `notReplied` query in `/api/team/scorecard` — must include `ui.status != 'replied' AND ui."repliedAt" IS NULL AND ui."repliedBy" IS NULL`. All three conditions required. Same filter must apply in the `/api/team/scorecard/drilldown` `not_replied` type query.
> - No changes to Team Scorecard `hotLeads` query — must match via `lo."emailAccountId" IN (SELECT id FROM email_accounts WHERE "userId" = ?)` as primary join (accountEmail defaults to '' in old records and can't be relied on alone). Both emailAccountId and accountEmail joins required.
> - No changes to Scorecard `emailsSent` query — must join `messages JOIN email_accounts WHERE ea."userId" = ?` (not contacts.assignedTo). Warmup sends never write to messages table so are already excluded. Falls back to contacts-based query if emailAccountId missing.
> - No changes to `POST /api/my/log-activity` — `contactId` is `NOT NULL` in `contact_activities` schema; uses `'__none__'` placeholder when no contact provided (quick Log Call/Meeting/WhatsApp). Uses `new Date().toISOString()` for createdAt. Do NOT pass `null` as contactId — causes PG NOT NULL violation.
> - No changes to `GET /api/my/task-queue` — returns hotReplies/overdueFollowups/staleLeads/todayProgress/targets. `targets` loaded from `api_settings` key `daily_activity_targets` (JSON). Default targets: emails=50, calls=10, meetings=1, whatsapp=15. Admin can override via api_settings.
> - No changes to `daily-task-queue.tsx` log activity flow — on success must call `setLoggedIds` to mark item done then refresh via `fetchData()`. Error message must be shown in header via `logFeedback` state. Do NOT make buttons silent on failure.
> - No changes to protected-email guard in boot reconcile sweeps in `server/index.ts` — both the bounce reconcile (60s boot) and unsubscribe reconcile (75s boot + 120s recurring every 6h) MUST build `protectedEmails` set from `email_accounts ∪ warmup_accounts` before flipping any contact. Skipping this guard caused sender/warmup accounts to be auto-suppressed (same class of bug as 2026-04-13 bounce-sync-engine fix).
> - No changes to unsubscribe auto-flip cadence (`6 * 60 * 60 * 1000` = 6 hours) in `server/index.ts`. Do NOT drop below 1 hour without PG load evaluation. Suppression_list check on every campaign send covers the in-between window; contact-status flip is a UI/reporting update, not a safety gate.
> - **NEVER** add outgoing unsubscribe link injection to `campaign-engine.ts` / `followup-engine.ts` / `personalization-engine.ts`. No `{{unsubscribe_url}}` auto-substitution, no `List-Unsubscribe` header addition. Per product direction, suppression is reply-classifier + manual-admin only. Users can add their own unsubscribe text/link inside templates — do not augment it.
> - No changes to `sendOrder` lock in `PUT /api/campaigns/:id` — field MUST be stripped from body when `campaign.status !== 'draft'`. Removing this allows mid-campaign toggling which breaks resume ordering expectations.
> - No changes to `applyEngagementOrdering()` placement in `startCampaign()` — must run AFTER unsubscribed/bounced/suppression/invalid-email filters, BEFORE the "already-processed-contactIds" dedup. Moving it breaks dedup consistency. Conditional gate `if (campaign.sendOrder === 'engagement')` is required — default/NULL campaigns must skip the helper entirely (zero behavior change for existing campaigns).
> - No changes to `sendOrder` default (NULL = old list-order behavior). Do NOT flip the default to `'engagement'` without explicit product validation against baseline campaigns. Radio button in `campaign-creator.tsx` must default to `'default'`.
> - No changes to `Do not contact` button visibility in `unified-inbox.tsx` — shown only when `replyType IN ('negative','unsubscribe','bounce')`. Exposing it on all messages would let reps accidentally suppress positive-reply senders.
> - No changes to `sweepSuppressionSignalsFromHistory()` confidence thresholds in `lead-intelligence-engine.ts` (bounce ≥0.9, unsubscribe ≥0.85). Lowering triggers false positives on ambiguous short snippets. Must call `getOrgProtectedEmails()` at start and `isSafeEmailToSuppress()` per row.
> - No changes to `server/services/auth-health.ts` behavior contract. `recordAuthFailure` / `recordAuthSuccess` MUST stay fail-open (top-level try/catch that swallows everything) and every caller MUST invoke with `.catch(() => {})`. Detector `isInvalidGrantError()` is limited to `invalid_grant` + `AADSTS50173` / `AADSTS70000` / `AADSTS700082` — do NOT add generic 401/403 strings, network-timeout patterns, or transient error shapes (would false-flag brief connectivity blips and mass-flag accounts). `REAUTH_THRESHOLD=3` — do NOT lower (transient failures false-flag) or raise above 5 (delays visibility). The module writes only to 4 columns on `email_accounts` (`authStatus`, `authFailureCount`, `authLastFailureAt`, `authLastErrorCode`). Do NOT add any code path that reads `authStatus` to skip sends, pause polling, stop follow-ups, block warmup, or divert token refresh — the system is observe-only by design; the Reconnect button (existing `/api/auth/gmail-connect` / `/api/auth/outlook-connect` flows) is the only path that clears a flag. Adding skip/pause logic would break sending for accounts with transient network blips and is exactly why this was scoped minimal.
> - No changes to the auth-health column set or migration path. The 4 columns + `idx_email_accounts_auth_status` index are created via `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `pg-storage.ts` AND declared directly in `scripts/pg-schema.sql` for fresh installs — both paths MUST stay in sync. Column names are case-sensitive in PG — always double-quote: `"authStatus"`, `"authFailureCount"`, `"authLastFailureAt"`, `"authLastErrorCode"`.
> - No changes to the auth-health wiring sites. Observation is wired into exactly three modules and no others: `gmail-reply-tracker.ts getValidAccessToken` (success after `accessToken = credentials.access_token`, failure in refresh-fail catch), `outlook-reply-tracker.ts refreshAccessToken` (success before return on `resp.ok`, failure on non-OK with captured `errText`), and `warmup-engine.ts` (Gmail path ~L90 success+failure, Outlook path ~L150 success+failure including the `else` branch on non-OK refresh). Do NOT sprinkle the helper into send paths, bulk-send loops, or one-off refresh calls — would double-count failures per cycle and prematurely flag healthy accounts. Do NOT remove `senderEmail` null-guards before calling the helper.
> - No changes to `GET /api/email-accounts/auth-health` route or the `auth-health` entry in the `/api/email-accounts/:id` skip list (currently `['quota-summary', 'recommend', 'auth-health']`). The endpoint filters by role: admins see all org accounts, members see only `userId === req.user.id`. Do NOT remove the role filter — exposing other members' reauth state leaks org structure. The extended fields on `GET /api/email-accounts` (`authStatus`, `authFailureCount`, `authLastFailureAt`, `authLastErrorCode`) are consumed by `ReauthBanner` in `mailmeteor-dashboard.tsx` (polls every 60s, renders null when count=0) and the "Reauth Required" badge + "Reconnect" button in `email-account-setup.tsx`. The Reconnect button MUST reuse the existing `/api/auth/gmail-connect` / `/api/auth/outlook-connect` routes — do NOT introduce a reauth-specific OAuth path.

> **CRITICAL — DATABASE PROTECTION (read this before writing ANY server code)**
> The production database has been accidentally deleted **4 times**. The following rules are NON-NEGOTIABLE:
> 1. **NEVER** add `fs.unlinkSync`, `fs.renameSync`, `fs.rmSync`, or `fs.writeFileSync` targeting the database file or `DB_PATH`
> 2. **NEVER** add `integrity_check` pragma — it causes false failures on Azure CIFS and triggers data loss
> 3. **NEVER** add code that creates a fresh database over an existing one — if the DB fails to open, CRASH, do not recreate
> 4. **NEVER** add a "reset database" feature, migration that drops tables, or any endpoint that wipes data
> 5. **NEVER** modify the DB initialization code in `server/storage.ts` (lines 53–137) or the `autoRestoreBackup` function
> 6. **NEVER** remove the `[DB-GUARDRAIL]` runtime protection in `server/storage.ts` — it blocks file deletion at runtime
> 7. If you need to change database schema, use `ALTER TABLE ADD COLUMN` only — never drop/recreate tables
> 8. Run `bash scripts/db-safety-check.sh` before deploying to verify no dangerous patterns exist
> 9. **NEVER** use `require('./db')` or import `server/db.ts` anywhere — it imports `drizzle-orm/neon-serverless` which is NOT installed in production and crashes the app. To access the SQLite database directly, use `(storage as any).db` only.
> See `DATABASE-RECOVERY.md` for the full incident history and recovery procedure.

> **CRITICAL — IMPORT SAFETY (read this before adding ANY import to server code)**
> The build uses `esbuild --packages=external` — all `node_modules` packages are left as external imports resolved at runtime on Azure. If you import a package that is NOT in `package.json` `dependencies`, the app will crash on startup with `ERR_MODULE_NOT_FOUND`.
> 1. **NEVER** import or require `server/db.ts` — it pulls in `drizzle-orm` which is not a production dependency (caused 1 day of downtime)
> 2. **NEVER** use `require('./db').db` as a fallback — even dead-code branches get bundled by esbuild and the import executes at module load
> 3. For custom SQL queries, always use: `await storage.rawGet(sql, ...params)` / `rawAll` / `rawRun` — these work in both SQLite and PostgreSQL mode
> 4. Before adding any new `import` from a package, verify it exists in `package.json` `dependencies` (not just `devDependencies`)
> 5. Run `bash scripts/deploy-safety-check.sh` before deploying to catch forbidden imports

> **CRITICAL — EMAIL THREADING PROTECTION (read this before touching campaign/followup code)**
> Gmail follow-up threading works by storing `gmailThreadId` at Step 1 send time and reusing it for follow-ups. This avoids fragile API calls that can fail due to token expiry. The following are NON-NEGOTIABLE:
> 1. **NEVER** remove the `threadId: data.threadId` return from `sendViaGmailAPI` in `campaign-engine.ts` — this is how threadId gets captured
> 2. **NEVER** remove the `gmailThreadId` save in `sendBatched()` in `campaign-engine.ts` — this stores it to the DB
> 3. **NEVER** remove the stored `gmailThreadId` lookup in `executeFollowup()` in `followup-engine.ts` — this is the primary threading path
> 4. **NEVER** remove the `gmailThreadId` column from the `messages` table migration in `storage.ts`
> 5. **NEVER** remove `gmailThreadId` from `updateCampaignMessage` SQL in `storage.ts`
> 6. The subject logic in `executeFollowup()` uses `Re: <original>` for threading — do not change this without testing Gmail threading end-to-end
> 7. **NEVER** remove the 401 retry + force-refresh logic in `sendEmail()` Gmail path in `followup-engine.ts` — without it, expired tokens cause fallthrough to SMTP which breaks threading
> 8. **NEVER** remove the token expiry null handling (`parseInt(tokenExpiry || '0')`) in `getGmailAccessToken` in `followup-engine.ts` — treats missing expiry as expired to ensure refresh happens

## Commands

```bash
npm run dev      # Start dev server (Express + Vite HMR on port 3000)
npm run build    # Build: Vite bundles frontend to dist/public/, esbuild bundles server to dist/index.js
npm start        # Run production build
npm run check    # TypeScript type check (no emit)
```

No test runner is configured.

## Architecture

AImailPilot is a **monolithic full-stack app**: a single Express server that serves both the REST API and (in production) the compiled React frontend as static files. In development, Vite is mounted onto the Express server for HMR.

```
client/src/      React frontend (Wouter routing, TanStack Query, shadcn/ui)
server/          Express backend
  index.ts       Entry: mounts middleware, registers routes, starts follow-up engine
  routes.ts      All API routes (~250KB - primary place for new endpoints)
  storage.ts     SQLite database layer (~112KB - all CRUD via better-sqlite3)
  db.ts          Drizzle/Neon config (NOT USED at runtime — DO NOT import this file, see Import Safety rules)
  auth/          OAuth helpers (Google, Microsoft)
  routes/        Modular route files (supplements routes.ts)
  services/      Business logic:
    campaign-engine.ts      Email sending, scheduling, throttling
    followup-engine.ts      Automated follow-up sequences (started on server boot)
    smtp-email-service.ts   SMTP provider abstraction
    gmail-reply-tracker.ts  Gmail webhook integration
    outlook-reply-tracker.ts Outlook webhook integration
    personalization-engine.ts Variable substitution in emails
    llm.ts                  AI/LLM integration (OpenAI, Gemini, Anthropic, Llama)
    oauth-service.ts        OAuth credential management
    warmup-engine.ts        Email warmup between org accounts (auto-open/star/reply)
    email-rating-engine.ts  Contact scoring
    lead-intelligence-engine.ts  Deep email history scan + AI lead classification
    context-engine.ts       Organization knowledge base + context assembly for AI drafts/proposals
    scheduler.ts            Task scheduling
shared/schema.ts  Drizzle ORM schema (PostgreSQL dialect, used for type definitions)
```

**Important**: The runtime database is **PostgreSQL** (Azure Flexible Server, `aimailpilot-db.postgres.database.azure.com`), managed via `server/pg-storage.ts` (drop-in replacement for `DatabaseStorage`). Storage is selected at startup in `server/storage.ts` via `DATABASE_URL` env var. The `shared/schema.ts` / `drizzle.config.ts` files define the PostgreSQL schema used for type generation — Drizzle migrations are **not** used at runtime. Schema is initialized by `scripts/pg-schema.sql` via `initStorage()` on server boot.

## Key Patterns

**Multitenancy**: Every resource is scoped to an `organizationId`. Users belong to organizations with roles: `owner`, `admin`, `member`, `viewer`. There is also a `superadmin` system (org ID `superadmin`) that can impersonate any org.

**Auth**: Session-based authentication via `express-session` + `memorystore`. OAuth flows for Google and Microsoft are implemented in `server/auth/` and `server/routes.ts`. The session stores `userId`, `organizationId`, and role.

**Email accounts**: Multiple SMTP providers supported (Gmail OAuth, Outlook OAuth, SendGrid, Elastic Email, generic SMTP). Credentials stored per-org in the `email_accounts` table. Google OAuth credentials fall back to the superadmin org if not found in the current org.

**Campaign sending**: `campaign-engine.ts` handles throttling, scheduling, and per-email-account daily send limits. Daily counters reset via a polling interval in `server/index.ts`.

**Follow-up engine**: Starts automatically on server boot (`startFollowupEngine()`), runs background polling to send scheduled follow-ups. Gmail follow-ups use stored `gmailThreadId` + 401 retry to stay on Gmail API path (SMTP fallback breaks threading).

**Warmup engine**: Starts automatically on server boot (`startWarmupEngine()`), runs every 30 minutes. Sends emails between connected org accounts using selected templates, then performs engagement actions (open, star, mark important, auto-reply) via Gmail API / Microsoft Graph. Volume ramps by phase. **Important**: Warmup emails must be excluded from inbox counts, nudges, and lead pipeline — filter at query time by excluding emails where `fromEmail` matches a warmup account email.

**Azure OpenAI**: Integrated via `email-rating-engine.ts` and `lead-intelligence-engine.ts`. Settings in `api_settings`: `azure_openai_endpoint`, `azure_openai_api_key`, `azure_openai_deployment`, `azure_openai_api_version`. Used for: contact reply quality scoring, lead classification (11 buckets), AI draft suggestions.

**Lead Intelligence Engine**: `lead-intelligence-engine.ts` scans linked Gmail/Outlook accounts for 6-12 months of email history, stores in `email_history` table, then uses Azure OpenAI (or rule-based fallback) to classify contacts into opportunity buckets (past_customer, hot_lead, warm_lead, etc.) stored in `lead_opportunities` table. Only received/reply emails are analyzed (sent-only outreach excluded). Supports email account selection (scan/analyze specific accounts), account-wise filtering, pagination (25/page), member role filtering (members see own accounts only), and custom AI prompt editing (admin). `accountEmail` column on `lead_opportunities` tracks which account received each reply. API: `/api/lead-intelligence/scan`, `/api/lead-intelligence/analyze`, `/api/lead-intelligence/run`, `/api/lead-intelligence/prompt` (GET/POST custom prompt), `/api/lead-intelligence/debug`. Has own token helpers independent of other engines.

**Context Engine**: `context-engine.ts` is the RAG-lite layer that assembles organizational knowledge for AI-powered actions. Pulls from 6 data sources (email_history, lead_opportunities, messages, contact_activities, contacts, org_documents) to build structured context prompts. Powers: smart email reply drafts (`/api/context/draft-reply`), proposal generation (`/api/context/proposal`), and contact context assembly (`/api/context/contact/:id`). Uses SQLite FTS5 for document search (zero dependencies). `org_documents` table stores case studies, proposals, brochures, pricing, etc. with auto-generated AI summaries. Knowledge Base page at sidebar > Tools > Knowledge Base (admin only). See `CONTEXT-ENGINE.md` for full architecture.

**Contact Enrichment**: `GET /api/contacts` enriches each contact with AI lead classification from `lead_opportunities` (leadBucket, leadConfidence, aiReasoning, suggestedAction). `GET /api/contacts/hot-leads` provides a dedicated AI leads view with bucket filtering, search, and pagination. Smart filters via `leadFilter` query param: `hot_leads`, `warm_leads`, `past_customer`, `engaged`, `cold`, `never_contacted`. Frontend shows lead badges on contact rows, AI intelligence card in detail dialog, and "AI Leads" tab in contacts manager.

**Raw database access**: Use `await storage.rawGet(sql, ...params)`, `await storage.rawAll(sql, ...params)`, `await storage.rawRun(sql, ...params)` for custom SQL in routes. These work on both SQLite and PostgreSQL — `?` placeholders are auto-converted to `$1,$2,...` for PG. Never use `(storage as any).db` for new code — it only works in SQLite mode. Never import `server/db.ts`.

**Frontend data fetching**: TanStack Query (`@tanstack/react-query`) with a shared `queryClient` in `client/src/lib/queryClient.ts`. All API calls go through fetch wrappers in that file.

**Path aliases**: `@/*` maps to `client/src/*`, `@shared/*` maps to `shared/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Authentication & Login

### Frontend
- **Auth hook**: `client/src/hooks/use-auth.ts` — `useAuth()` fetches `/api/auth/user`, exposes `login`/`logout`
- **Login page**: `client/src/pages/landing-page.tsx` — Google/Microsoft OAuth buttons redirect to `/api/auth/google` or `/api/auth/microsoft`
- **App router**: `client/src/App.tsx:39` — checks setup status + auth on mount, routes to `LandingPage` if unauthenticated

### Backend Routes (all in `server/routes.ts`)
| Line | Endpoint | Description |
|------|----------|-------------|
| ~375 | Session setup | `MemoryStore`, 24hr TTL, httpOnly cookies |
| ~122 | `requireAuth` middleware | Checks `req.cookies.user_id` or `req.session.userId`; auto-restores session from DB after restart |
| ~399 | `POST /api/auth/simple-login` | Dev-only demo login (no password) |
| ~414 | `GET /api/setup/status` | Returns setup state: needsSetup, googleConfigured, etc. |
| ~504 | `GET /api/auth/google` | Starts Google OAuth flow |
| ~544 | `GET /api/auth/google/callback` | Handles Google token exchange + user creation |
| ~854 | `GET /api/auth/gmail-connect` | Adds Gmail as a sender account (requires auth) |
| ~948 | `GET /api/auth/microsoft` | Starts Microsoft OAuth flow |
| ~991 | `GET /api/auth/microsoft/callback` | Handles Microsoft token exchange + user creation |
| ~1335 | `GET /api/auth/outlook-connect` | Adds Outlook as a sender account (requires auth) |
| ~1549 | `GET /api/auth/user` | Returns current session user |
| ~1588 | `POST /api/auth/logout` | Clears cookies + destroys session |

### OAuth Services
- `server/auth/google-oauth.ts` — `GoogleOAuthService`: `getAuthUrl()`, `exchangeCodeForTokens()`, `getUserInfo()`, `refreshAccessToken()`
- `server/auth/microsoft-oauth.ts` — `MicrosoftOAuthService` (uses `@azure/msal-node`): same interface

### OAuth Scopes
- **Google**: `gmail.readonly`, `gmail.send`, `gmail.modify`, `spreadsheets.readonly`, `userinfo.email`, `userinfo.profile`
- **Microsoft**: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `SMTP.Send`, `User.Read`, `openid`, `profile`, `email`

### Key Auth Patterns
- **Session restore**: After server restart, `requireAuth` auto-restores session from `req.cookies.user_id` DB lookup
- **Two OAuth sub-flows**: `purpose='add_sender'` stores per-sender tokens; default flow creates user session
- **Per-sender tokens**: Stored in `api_settings` keyed as `gmail_sender_{email}_access_token` etc.
- **OAuth credentials fallback**: `getStoredOAuthCredentials()` (~line 280) checks current org → superadmin org → env vars
- **Org assignment**: `ensureUserOrganization()` (~line 334) on login checks invitations, adopts ownerless orgs
- **Redirect URI**: Dynamic base URL detection (~line 51) handles www/non-www mismatch in production (`aimailpilot.com`)

### Secondary OAuth Routes (`server/routes/oauth-routes.ts`)
- `GET /oauth/gmail/auth/:organizationId` — Gmail demo connect
- `GET /oauth/outlook/auth/:organizationId` — Outlook demo connect
- `POST /oauth/import/googlesheets`, `/oauth/import/excel`, `/oauth/import/csv` — Contact imports
- `POST /oauth/test-connection`, `POST /oauth/revoke` — Account management

## Environment Variables

Key env vars the server expects:
- `SESSION_SECRET` - Express session secret
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` - Microsoft OAuth
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - `development` or `production`
- `DATABASE_URL` - PostgreSQL connection string (production: `postgresql://aimailpilotadmin:...@aimailpilot-db.postgres.database.azure.com:5432/aimailpilot?sslmode=require`)
- `SHADOW_MODE` - (optional) Set to `true` to enable dual-write shadow validation (SQLite primary + PG mirror)

**Storage modes** (controlled by env vars):
1. No `DATABASE_URL` → SQLite only (`./data/aimailpilot.db`)
2. `DATABASE_URL` + `SHADOW_MODE=true` → Shadow mode (SQLite primary, PG dual-write for validation)
3. `DATABASE_URL` only → **PostgreSQL live** (current production mode)

**camelCase column names in raw SQL**: PostgreSQL requires quoting — always use `"organizationId"`, `"createdBy"`, `"emailAccountId"` etc. in raw SQL strings. Unquoted names are lowercased by PostgreSQL and cause silent failures (returns 0 rows instead of error).

## Common Debugging Tips

- **Session lost after restart**: Expected — MemoryStore is non-persistent. Session auto-restores from `user_id` cookie via DB lookup in `requireAuth`.
- **OAuth redirect mismatch**: Check `getGoogleRedirectUri()` / `getMicrosoftRedirectUri()` (~line 51 in `routes.ts`). Must match what's registered in Google/Microsoft app consoles.
- **Emails not sending**: Check `campaign-engine.ts` throttling and per-account daily send limits. Daily counters reset via polling in `server/index.ts`.
- **Adding a new API route**: Add to `server/routes.ts` (primary) or a new file under `server/routes/` mounted in `server/index.ts`.
- **Frontend query not refreshing**: Check `queryClient` invalidation in `client/src/lib/queryClient.ts`.
- **Raw SQL returns 0 rows in PG**: camelCase column names must be double-quoted (`"organizationId"`, not `organizationId`). PostgreSQL lowercases unquoted identifiers.
- **Gmail accounts showing 401**: Gmail OAuth tokens are stored in `api_settings`. If tokens are missing from PG, run `scripts/patch-api-settings.ts` to copy from SQLite backup.
- **Campaign stats showing 0**: Messages/tracking_events may be missing from PG. Run `scripts/patch-messages.ts` to restore from SQLite backup.
- **Inbox missing messages**: Run `scripts/patch-unified-inbox.ts` to restore from SQLite backup.
