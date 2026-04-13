# STATUS.md — DO NOT BREAK (61 features confirmed working)

> Do NOT modify code for these features unless explicitly asked to fix a bug in that specific feature.
> When in doubt — **ask before changing**.

## Working Features

| # | Feature | Do Not Touch |
|---|---------|-------------|
| 1 | Email Sending (SMTP + OAuth + throttling + test send) | `campaign-engine.ts`, `smtp-email-service.ts`, `/api/campaigns/send-test` route |
| 2 | Google OAuth (login + add sender) | `google-oauth.ts`, `routes.ts:504-944` |
| 3 | Unified Inbox (Gmail + Outlook sync) | Route order: `/api/inbox/enhanced` and `/api/inbox/stats` BEFORE `/api/inbox/:id` |
| 4 | Campaign Tracking — open/click/reply (LOCKED) | `gmail-reply-tracker.ts`, `outlook-reply-tracker.ts`, tracking logic in `campaign-engine.ts`, `storage.ts` |
| 5 | Contact Management (CRUD + CSV import) | Contact storage methods, CSV import in `oauth-routes.ts` |
| 6 | Template Creation (editor + variables) | Template routes in `routes.ts`, `personalization-engine.ts` |
| 7 | Azure OpenAI Integration | `llm.ts` — endpoint config, API key, model settings |
| 8 | Azure App Deployment | `web.config`, `.deployment`, `startup.sh` |
| 9 | Campaign Detail (large campaigns, 500 cap) | `getCampaignMessagesEnriched`, `getCampaignMessageStats`, Step 0 guarantee block |
| 10 | Template Deliverability (scoring + AI fix) | `/api/templates/analyze-deliverability`, deliverability panel in `template-manager.tsx` |
| 11 | Template Preview (desktop/mobile + test email) | Preview dialog + `sendTestEmail` in `template-manager.tsx` |
| 12 | Template Visibility (public/private) | `getPublicEmailTemplatesExcludingUser`, visibility logic in template routes, `getUserRole` |
| 13 | AI Template Content Insertion | `textToHtml` function in `template-manager.tsx` |
| 14 | Contact List Access Control (member vs admin) | `getContactListsForUser`, role-based filtering in `GET /api/contacts` |
| 15 | Campaign Update Dialog (settings + preview) | Update dialog, autopilot, `trackOpens`/`includeUnsubscribe` in `campaign-detail.tsx` |
| 16 | URL Hash Navigation | Hash-based routing in `mailmeteor-dashboard.tsx` |
| 17 | Outlook OAuth Sending (Graph API) | `sendViaMicrosoftGraph` in `campaign-engine.ts`, Outlook path in `/api/contacts/send-email` |
| 18 | Send Email from Contacts (Write/Template/AI) | Send dialog, `handleAiGenerate`, `applyTemplate` in `contacts-manager.tsx` |
| 19 | Database Safety | See Golden Rules below |
| 20 | Campaign Engine (step delays, scheduling, jitter) | `evaluateFollowupTrigger`, `getNextValidSendTime`, `checkSendingWindow`, `getUserLocalTime` |
| 21 | Follow-up Threading — Gmail + Outlook (CONFIRMED WORKING 2026-04-13) | Gmail: threadId stored at step-0, `threadLinked=true` confirmed in logs. Outlook: `Prefer: IdType="ImmutableId"` on all Graph calls ensures providerMessageId survives Drafts→Sent move; `createReply` path in `followup-engine.ts` uses stored ID to inherit conversationId; `toRecipients` PATCH override fixes self-reply bug. Both confirmed: all steps appear in one conversation thread. |
| 22 | Follow-up Personalization (22+ variables) | `personalData` + `personalizeText()` in `followup-engine.ts` |
| 23 | Follow-up Sender Display Name | `senderDisplayName` in `sendEmail()` in `followup-engine.ts` |
| 24 | Email Subject Encoding (RFC 2047) | `mimeEncodeSubject()` in `campaign-engine.ts` and `followup-engine.ts` |
| 25 | Template Editor Rich Text (lists, fonts, AI bar) | `TbBtn`, `execCmd`, toolbar in `template-manager.tsx` + all editor pages |
| 26 | Import Safety — NEVER import db.ts | `server/db.ts` exists for type gen only. See Golden Rules. |
| 27 | Pipeline & Activity Log | Pipeline/activity routes in `routes.ts:4438-4548`, `contact_activities` table |
| 28 | EmailListVerify Integration | `email-verifier.ts`, verification routes in `routes.ts:9360-9480` |
| 29 | Warmup Engine (send + engage + labels) | `warmup-engine.ts`, warmup routes, `startWarmupEngine()` in `index.ts` |
| 30 | Inbox Reply with Token Refresh | Token refresh + retry in `POST /api/inbox/:id/reply`, draft save |
| 31 | Reply Tracker Per-Org Locking | `checkingOrgs` Set in `gmail-reply-tracker.ts` and `outlook-reply-tracker.ts` |
| 32 | Team Scorecard & Leaderboard | `/api/team/scorecard` route, `team-scorecard.tsx` — all raw SQL must use quoted camelCase + parseInt() on COUNT/SUM |
| 33 | My Dashboard (individual view) | `/api/my/dashboard`, `/api/my/emails-needing-reply`, `my-dashboard.tsx` — all raw SQL must use quoted camelCase + parseInt() on COUNT/SUM |
| 34 | Deal Tracking (value, notes, auto-close) | Deal columns in `storage.ts`, deal dialog in `contacts-manager.tsx` |
| 35 | Follow-up Subject (no Re: when threaded) | Subject logic in `executeFollowup()` in `followup-engine.ts` |
| 36 | Raw SQL Access | `storage.rawGet/rawAll/rawRun` — the ONLY safe way for custom SQL |
| 37 | Warmup Improvements (spam rescue, labels, pairs) | Label/folder functions, spam detection, `sendPairs` in `warmup-engine.ts`, `warmup-monitoring.tsx` |
| 38 | AI Lead Intelligence (scan + classify) | `lead-intelligence-engine.ts`, `email_history`/`lead_opportunities` tables, `lead-opportunities.tsx` |
| 39 | Contact Enrichment (AI badges + smart filters) | Enrichment block in `GET /api/contacts`, `GET /api/contacts/hot-leads`, `LEAD_BUCKET_CONFIG` |
| 40 | Follow-up Bounce Skip | Bounce skip block in `processCampaignFollowups()` in `followup-engine.ts` |
| 41 | Context Engine (Knowledge Base + AI Drafts) | `context-engine.ts`, `org_documents` table, `knowledge-base.tsx` |
| 42 | PostgreSQL Migration (PRODUCTION) | `pg-storage.ts`, `initStorage()`, `DATABASE_URL` env var |
| 43 | Campaign List Pagination (7/page) | Pagination in `mailmeteor-dashboard.tsx`, `/api/campaigns/count` |
| 44 | Bounce Suppression (4-layer protection) | `bounce-sync-engine.ts`, `getSuppressedEmails`, bounced filter in `pg-storage.ts` |
| 68 | Sender Account Blocklist Protection | `bounce-sync-engine.ts` — ALL scanner functions (syncContactsToSuppression, syncInboxToSuppression, syncEmailHistoryToSuppression, scanGmailHistorical, scanOutlookHistorical) MUST call `isSafeToSuppress(email, connectedEmails)` before adding to suppression_list. `getOrgConnectedEmails()` loads email_accounts + warmup_accounts. Missing this guard causes sender accounts to be auto-blocklisted. Same guard MUST exist in `gmail-reply-tracker.ts` and `outlook-reply-tracker.ts` NDR extraction paths. |
| 45 | Contact Activity Log + Pipeline (PG fix) | `routes.ts:4438-4548` — all camelCase MUST be double-quoted for PG |
| 46 | Follow-up Engine — No Mid-Loop Stall | `processMessageFollowups()` in `followup-engine.ts` — uses bulk-loaded message, NO per-contact `getCampaignMessage` re-fetch. Pre-loaded campaign passed from `processCampaignFollowups` → `processMessageFollowups` → `scheduleFollowup`. Removing this causes N×(2-5s) DB stalls with slow PG. |
| 47 | Reply Tracker — 15-min Lookback (not 24h) | `runCheck()` in `gmail-reply-tracker.ts` and `outlook-reply-tracker.ts` — lookback is `15` minutes. Was `1440` (24h) causing continuous DB saturation with 80 accounts. 15-min gives 3× overlap with 5-min poll cycle — no replies missed. Do NOT increase back to 1440. |
| 48 | Follow-up Engine — Paused Campaign Guard | `processScheduledFollowups()` and `executeFollowup()` in `followup-engine.ts` — both check `campaign.status`. If paused/cancelled/draft, execution is deferred (stays `pending`) not skipped — resumes naturally when campaign un-paused. |
| 49 | Follow-up Engine — Overlap Lock | `startFollowupEngine()` in `followup-engine.ts` — `isProcessing` boolean prevents concurrent 30s cycles. If previous cycle still running when next interval fires, it skips and logs. |
| 50 | Follow-up Engine — Atomic Execution Claim | `executeFollowup()` in `followup-engine.ts` — `UPDATE SET status='processing' WHERE status='pending' RETURNING id` atomically claims execution. Null return = already claimed. 5-min stuck-processing recovery in `processFollowupTriggers()`. Do NOT revert to non-atomic read-then-check. |
| 51 | Follow-up Engine — Targeted DB Queries | `processCampaignFollowups()`, `processScheduledFollowups()`, `executeFollowup()` in `followup-engine.ts` — all 50k message fetches replaced with targeted indexed queries for replied/bounced sets and per-contact lookups. Do NOT restore `getCampaignMessages(campaignId, 50000, 0)` in these paths. |
| 52 | Follow-up Engine — Multi-Sequence Completion | `checkFollowupCompletion()` in `followup-engine.ts` — aggregates follow-up steps across ALL sequences for a campaign via `getCampaignFollowups()`. Was reading from one sequence only, causing premature completion. |
| 53 | Follow-up Engine — Account Daily Limit (Atomic) | `executeFollowup()` in `followup-engine.ts` — atomic `UPDATE email_accounts SET dailySent=dailySent+1 WHERE dailySent < dailyLimit RETURNING id` reserves send slot before sending. Decrements on failure. Shares same counter with campaign engine. Do NOT revert to read-then-check pattern. |
| 54 | Follow-up Engine — Idempotency Guard | `executeFollowup()` in `followup-engine.ts` — checks `SELECT 1 FROM messages WHERE campaignId+contactId+stepNumber+status='sent'` before sending. Prevents duplicate sends on crash recovery between send and status update. |
| 55 | Inbox Forward — Full Body + Sender Email | Forward endpoint in `routes.ts` — sends full HTML-formatted body with inline border-left quote styling. Captures `forwardedFrom: msg.fromEmail` so original sender's email is visible in forward. |
| 56 | Inbox Forward Status Indicator | `unified-inbox.tsx` — shows forwarded status card (From/To) after forwarding. `forwardedAt`, `forwardedTo`, `forwardedFrom`, `forwardedBy` columns in `unified_inbox` table (pg-storage.ts). |
| 57 | Inbox Reply Tab (repliedAt filter) | `getInboxMessagesEnhanced`, `getInboxMessageCountEnhanced`, `getInboxStats` in `pg-storage.ts` — Reply tab filter is `(status = 'replied' OR "repliedAt" IS NOT NULL)`. Do NOT revert to `status = 'replied'` only. |
| 58 | Bounce False-Positive Override | `POST /api/inbox/:id/unmark-bounce` route in `routes.ts` — manually unmarks bounced emails. `reply-classifier.ts` requires multiple indicators for non-system senders (system senders always bounce at 95% confidence). |
| 59 | Unified Inbox Mobile Responsive | `unified-inbox.tsx` — fully responsive with Tailwind sm:/md: prefixes. Message list uses compact layout on mobile, desktop-only checkboxes hidden on mobile. |
| 60 | Campaign Dashboard Mobile Responsive | `mailmeteor-dashboard.tsx` — KPI cards 2-col mobile → 4-col desktop. Campaign table switches to card view on mobile (md: breakpoint). Desktop table preserved with full columns. |
| 61 | Campaign List — Sender + List Name | `GET /api/campaigns` in `routes.ts` enriches each campaign with `senderEmail`/`senderName` (from email_accounts), `creatorName`/`creatorEmail` (from users), `listName` (from contact_lists via segmentId or contactIds). Desktop table shows "Sent By" avatar column and "List" badge column. |
| 62 | Reply Classification — Rule-Based + AI | `reply-classifier.ts` with 30+ strengthened patterns (OOO, auto_reply, positive, negative, bounce). `classifyReplyWithAI()` uses Azure OpenAI for borderline `general` cases. `isHumanReply()` helper identifies actionable replies (positive/negative/general/unsubscribe, excludes OOO/auto_reply/bounce). |
| 63 | Inbox Reply Filtering (Exclude Auto-Replies) | `unified_inbox` messages excluded from "Emails Need Reply" if `replyType IN ('ooo', 'auto_reply', 'bounce')`. Only `positive`, `negative`, `general` count as real replies. Boot reclassifier processes NULL/empty/general messages via rules + AI. |
| 64 | Scorecard "Not Replied" — 3-Day Lookback | Scorecard counts contacts emailed **3+ days ago** without reply (gives time to respond). Uses `messages` table `repliedAt IS NULL` check. Short periods (Today/This Week) show 0 or very low numbers as expected. |
| 65 | AI Refine Button — Two-Phase Reclassification | Team Scorecard + My Dashboard get purple "AI Refine" button. Phase 1: rules-based reclassification (5000 msgs). Phase 2: Azure OpenAI batch (200 msgs). Progress message shown; auto-refreshes dashboard after 15s. |
| 66 | Email Rating Engine (Contact Scoring) | `email-rating-engine.ts` — 0–100 score + A+/A/B+…F grade per contact. Batch runs fire-and-forget via `POST /api/contacts/batch-rating`. AI rating uses Azure OpenAI reply-quality scoring. Ratings shown as badges in contacts table and detail card (condition: `emailRatingUpdatedAt` not `emailRating > 0`). Contacts with 0 sent emails correctly score 0/F. |
| 67 | Email Rating — recipientEmail Fallback | `pg-storage.ts getContactEngagementStats` — 3-tier fallback: (1) match by `contactId`, (2) match by `recipientEmail` column (backfilled on startup from contacts), (3) match via old contactIds sharing same email. `messages.recipientEmail` added as `ALTER TABLE` + backfilled via `UPDATE messages SET "recipientEmail" = c.email FROM contacts c WHERE messages."contactId" = c.id`. New messages get `recipientEmail` from `campaign-engine.ts` and `followup-engine.ts`. |

## Golden Rules (NEVER violate)

- **NEVER** import `server/db.ts` — crashes production (`drizzle-orm` not installed, caused 1 day downtime)
- **NEVER** drop or recreate tables — use `ALTER TABLE ADD COLUMN` with try/catch only
- **NEVER** `setContacts([])` on API error — keep stale data visible (caused "No contacts" display TWICE)
- **NEVER** bypass `storage` methods for working GET endpoints — raw SQL only as enhancement after storage fetch
- **NEVER** modify `sendViaGmailAPI` return value — must return `{ success, messageId, threadId }` for threading
- **NEVER** remove `gmailThreadId` save in `sendBatched()` or lookup in `executeFollowup()`
- **NEVER** remove 401 retry + force-refresh in `sendEmail()` Gmail path in `followup-engine.ts`
- All camelCase columns in PostgreSQL raw SQL MUST be double-quoted: `"organizationId"`, `"contactId"`, `"createdAt"`, etc.
- Raw SQL only via `storage.rawGet/rawAll/rawRun` — auto-converts `?` to `$1,$2` for PG
- **PostgreSQL returns `COUNT(*)` and `SUM()` as bigint strings** — always wrap with `parseInt()` / `Number()` or JS will string-concatenate instead of add
- `email_accounts` uses `"isActive" = 1` column (NOT `status = 'active'` — that column does not exist)
- `fromEmail` in `unified_inbox` stores `"Name <email>"` format — extract email before comparing
- **Inbox Reply tab** filter must be `(status = 'replied' OR "repliedAt" IS NOT NULL)` in all 3 locations in `pg-storage.ts` — `status = 'replied'` alone shows empty Reply tab
- **Forward endpoint** must set `forwardedFrom: msg.fromEmail` — required so original sender email shows in UI
- **Bounce classifier** (`reply-classifier.ts`) non-system senders require 3+ indicators to classify as bounce — do NOT lower threshold (legitimate replies were being misclassified)
- **Campaign enrichment** in `GET /api/campaigns` — `Promise.all` async map with try/catch — do NOT remove (powers "Sent By" and "List" columns)
- **Reply classification rules** in `reply-classifier.ts` — 30+ strengthened patterns for OOO, auto_reply, positive, negative, bounce. Do NOT weaken patterns or lower thresholds. Non-system senders require 3+ indicators for bounce classification (legitimate replies were being misclassified). Do NOT change `isHumanReply()` logic which identifies actionable replies.
- **Boot reclassification** in `server/index.ts` — targets `("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')` at 30s startup delay. Do NOT change delay timing or message limits. Do NOT remove AI reclassification fallback for borderline cases.
- **Inbox reply filter** — "Emails Need Reply" and "Not Replied" filters must exclude non-human replies: `replyType IN ('positive', 'negative', 'general')` only. Do NOT revert to include-based filters. OOO/auto_reply/bounce must always be excluded.
- **Scorecard "Not Replied" cutoff** in `routes.ts` — must enforce 3-day lookback via `notRepliedCutoff` to allow reply time. Do NOT remove cutoff or revert to all-time counts. Gives accurate signal for aged emails.
- **Email rating badge condition** in `contacts-manager.tsx` — use `contact.emailRatingUpdatedAt` (not `emailRating > 0`) to detect rated contacts. A 0/F rating is valid and must show a badge.
- **`messages.recipientEmail` backfill** in `pg-storage.ts initializeSchema()` — runs after schema COMMIT using `queryOne`/`execute` (not `client`). Backfills from `contacts` table where `contactId` still resolves. Do NOT remove — required for rating fallback on re-imported contacts.
- **Batch rating is fire-and-forget** — `POST /api/contacts/batch-rating` responds immediately with `background: true`, then runs `batchRecalculateRatings()` via `setImmediate()`. Do NOT make it synchronous (causes HTTP timeout on large orgs).
