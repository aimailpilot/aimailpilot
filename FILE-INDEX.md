# FILE-INDEX.md — File Summaries + Feature Map

> **For Claude Code**: Read this FIRST before searching the codebase. Go directly to the listed files.

---

## Server Files

| File | What it does |
|------|-------------|
| `server/index.ts` | Express entry — mounts middleware, starts followup + warmup engines |
| `server/routes.ts` | ALL API endpoints (campaigns, contacts, inbox, auth, settings) ~10500 lines |
| `server/storage.ts` | SQLite DB layer — all CRUD, schema init, guardrails |
| `server/pg-storage.ts` | PostgreSQL DB layer — drop-in replacement (PRODUCTION) |
| `server/db.ts` | Drizzle/Neon config — **NEVER IMPORT THIS** |
| `server/vite.ts` | Vite dev server + static file serving |
| `server/auth/google-oauth.ts` | Google OAuth — token exchange, refresh, user info |
| `server/auth/microsoft-oauth.ts` | Microsoft OAuth (MSAL) — token exchange, refresh |
| `server/routes/oauth-routes.ts` | Gmail/Outlook connect, Google Sheets/Excel/CSV import routes |
| `server/services/campaign-engine.ts` | Email sending, scheduling, throttling, per-account limits |
| `server/services/followup-engine.ts` | Auto follow-ups, Gmail/Outlook threading, bounce skip |
| `server/services/warmup-engine.ts` | Self-warmup between org accounts, engagement actions |
| `server/services/gmail-reply-tracker.ts` | Gmail inbox sync — reply/bounce/open detection |
| `server/services/outlook-reply-tracker.ts` | Outlook Graph inbox sync — reply/bounce/open detection |
| `server/services/bounce-sync-engine.ts` | 5-source bounce scanner + suppression list sync |
| `server/services/reply-classifier.ts` | Auto-classify replies: positive/negative/bounce/OOO/auto_reply/unsub — 30+ rule patterns + Azure OpenAI for borderline cases |
| `server/services/smtp-email-service.ts` | SMTP provider abstraction (SendGrid, Elastic, generic) |
| `server/services/personalization-engine.ts` | Variable substitution ({{firstName}}, custom fields) |
| `server/services/email-rating-engine.ts` | Contact scoring via Azure OpenAI |
| `server/services/lead-intelligence-engine.ts` | Email history scan + AI lead classification (11 buckets) |
| `server/services/context-engine.ts` | Org knowledge base + RAG context for AI drafts/proposals |
| `server/services/email-verifier.ts` | EmailListVerify API — single + batch verification |
| `server/services/oauth-service.ts` | OAuth credential management helpers |
| `server/services/ai-command.ts` | AI command interface / natural language actions |
| `server/services/scheduler.ts` | Generic task scheduling utility |
| `server/services/spreadsheet-importer.ts` | Excel/CSV/Google Sheets parsing for contact import |
| `server/google-sheets-service.ts` | Google Sheets API — read rows for contact import |

## Client Pages

| File | What it does |
|------|-------------|
| `client/src/App.tsx` | Root — routing, auth check, Toaster |
| `client/src/main.tsx` | React entry point |
| `client/src/pages/mailmeteor-dashboard.tsx` | Main dashboard — sidebar nav, campaign list, hash routing |
| `client/src/pages/landing-page.tsx` | Login — Google/Microsoft OAuth buttons |
| `client/src/pages/campaign-creator.tsx` | Campaign creation — steps, recipients, content editor |
| `client/src/pages/campaign-detail.tsx` | Campaign detail — stats, messages, preview, settings |
| `client/src/pages/contacts-manager.tsx` | Contacts — CRUD, pipeline, activity log, AI leads, send email |
| `client/src/pages/unified-inbox.tsx` | Inbox — filters, warmup tab, reply/bounce views, sync |
| `client/src/pages/template-manager.tsx` | Templates — rich text editor, deliverability, AI, preview |
| `client/src/pages/email-account-setup.tsx` | Email account connection — OAuth + SMTP config |
| `client/src/pages/warmup-monitoring.tsx` | Warmup dashboard — accounts, logs, reputation, Run Now |
| `client/src/pages/lead-opportunities.tsx` | AI Leads — scan, classify, bucket filter, account filter |
| `client/src/pages/knowledge-base.tsx` | Knowledge Base — org documents, AI summaries |
| `client/src/pages/team-scorecard.tsx` | Team scorecard — per-member stats, leaderboard |
| `client/src/pages/my-dashboard.tsx` | Personal dashboard — stats, pipeline, nudges |
| `client/src/pages/account-settings.tsx` | Org settings — profile, members, billing |
| `client/src/pages/advanced-settings.tsx` | Admin settings — API keys, OAuth, danger zone |
| `client/src/pages/superadmin-dashboard.tsx` | SuperAdmin — org management, impersonation |
| `client/src/pages/followup-builder.tsx` | Follow-up sequence builder UI |
| `client/src/pages/analytics-dashboard.tsx` | Campaign analytics — charts, trends |
| `client/src/pages/team-management.tsx` | Team — invite members, roles |

## Client Hooks & Lib

| File | What it does |
|------|-------------|
| `client/src/hooks/use-auth.ts` | Auth hook — login/logout, session fetch from `/api/auth/user` |
| `client/src/hooks/use-toast.ts` | Toast notification hook (shadcn/ui) |
| `client/src/hooks/use-campaigns.ts` | Campaign data fetching hook |
| `client/src/hooks/use-contacts.ts` | Contacts data fetching hook |
| `client/src/lib/queryClient.ts` | TanStack Query client + fetch wrappers |

---

## Feature -> File Map

| Feature | Backend | Frontend |
|---------|---------|----------|
| **Login / OAuth** | `server/auth/google-oauth.ts`, `server/auth/microsoft-oauth.ts`, `server/routes.ts` (~lines 504-1588) | `landing-page.tsx`, `use-auth.ts` |
| **Campaign creation** | `server/routes.ts` (`POST /api/campaigns`), `campaign-engine.ts` | `campaign-creator.tsx` |
| **Campaign sending** | `server/services/campaign-engine.ts` | `campaign-detail.tsx` |
| **Follow-ups** | `server/services/followup-engine.ts` | `followup-builder.tsx` |
| **Inbox sync** | `gmail-reply-tracker.ts`, `outlook-reply-tracker.ts` | `unified-inbox.tsx` |
| **Inbox display** | `server/routes.ts` (`/api/inbox/enhanced`), `pg-storage.ts` (`getInboxMessagesEnhanced`) | `unified-inbox.tsx` |
| **Reply classification** | `server/routes.ts` (auto-classify loop, `POST /api/inbox/reclassify`), `reply-classifier.ts` (30+ rules + Azure OpenAI) | `team-scorecard.tsx`, `my-dashboard.tsx` (AI Refine button) |
| **Bounce / suppression** | `bounce-sync-engine.ts`, `reply-classifier.ts`, `pg-storage.ts` | `unified-inbox.tsx` (Bounced tab) |
| **Warmup engine** | `server/services/warmup-engine.ts` | `warmup-monitoring.tsx` |
| **Contact management** | `server/routes.ts` (~lines 4468-4965), `pg-storage.ts` | `contacts-manager.tsx` |
| **Pipeline / activity log** | `server/routes.ts` (~lines 4838-4930) | `contacts-manager.tsx` |
| **Templates** | `server/routes.ts` (`/api/templates`), `personalization-engine.ts` | `template-manager.tsx` |
| **AI Lead Intelligence** | `server/services/lead-intelligence-engine.ts` | `lead-opportunities.tsx` |
| **Contact enrichment** | `server/routes.ts` (`hot-leads`), `pg-storage.ts` | `contacts-manager.tsx` (AI Leads tab) |
| **Knowledge Base / AI drafts** | `server/services/context-engine.ts` | `knowledge-base.tsx` |
| **Email verification** | `server/services/email-verifier.ts` | `contacts-manager.tsx` |
| **Team scorecard** | `server/routes.ts` (`/api/team/scorecard`) | `team-scorecard.tsx` |
| **My dashboard** | `server/routes.ts` (`/api/my/dashboard`) | `my-dashboard.tsx` |
| **Email account setup** | `server/routes/oauth-routes.ts`, `server/routes.ts` | `email-account-setup.tsx` |
| **Contact import** | `server/routes.ts` (`/api/contacts/import`), `spreadsheet-importer.ts` | `email-import-setup.tsx` |
| **SuperAdmin** | `server/routes.ts` (`requireSuperAdmin`) | `superadmin-dashboard.tsx` |

---

## Quick Reference: Common Bug Areas

| Bug area | Check these files FIRST |
|----------|------------------------|
| Login / session lost | `server/routes.ts` (`requireAuth` ~line 130), `server/auth/google-oauth.ts` |
| Campaign not sending | `server/services/campaign-engine.ts`, `server/routes.ts` (`campaigns/send`) |
| Campaign stranded after restart | `campaign-engine.ts` `resumeActiveCampaigns()` — check `autoPaused` flag in DB; run `scripts/diag-active-campaigns.ts` |
| Follow-up threading | `server/services/followup-engine.ts` (`executeFollowup`, `sendEmail`) |
| Inbox not syncing | `gmail-reply-tracker.ts`, `outlook-reply-tracker.ts` |
| False bounces / replies | `reply-classifier.ts` (strengthened patterns), `server/routes.ts` (auto-classify + `POST /api/inbox/reclassify`), `pg-storage.ts` |
| Inbox reply counts wrong | `server/routes.ts` (filter: `replyType IN ('positive', 'negative', 'general')`), `reply-classifier.ts` |
| Warmup not working | `warmup-engine.ts` (token + daily counter reset) |
| Contact activities/pipeline | `server/routes.ts` (~lines 4838-4930) — quote all camelCase for PG |
| Email account tokens 401 | `server/routes.ts` (`getGmailAccessToken`, `getOutlookAccessToken`) |
| Raw SQL 0 rows in PG | Double-quote camelCase: `"organizationId"`, `"contactId"`, etc. |
| Import crash | Never import `server/db.ts`. Use `storage.rawGet/rawAll/rawRun` |

---

## Diagnostic Scripts

| Script | What it does |
|--------|-------------|
| `scripts/diag-active-campaigns.ts` | Lists all active campaigns with ✅ SENDING / ⚠️ SLOW / ❌ STRANDED flags based on last 10/60 min activity |
| `scripts/diag-followup.ts` | Inspects follow-up executions for a campaign by name — step/status breakdown, pending overdue, sample rows |
| `scripts/unstick-stranded-campaigns.ts` | One-time script: marks stranded campaigns `autoPaused=true` so boot recovery adopts them. `--apply` flag required to write. |
| `scripts/fix-bellaward-bounced.ts` | Restores bounced contacts whose email matches any email_account row (removes false-positive bounces) |

All scripts require `$env:DATABASE_URL` set in PowerShell before running.
