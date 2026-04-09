# STATUS.md — DO NOT BREAK (45 features confirmed working)

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
| 21 | Follow-up Threading — Gmail + Outlook (LOCKED) | `sendViaGmailAPI` return value, `gmailThreadId` save/lookup, 401 retry in `followup-engine.ts` |
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
| 45 | Contact Activity Log + Pipeline (PG fix) | `routes.ts:4438-4548` — all camelCase MUST be double-quoted for PG |

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
