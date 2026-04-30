# FILE-INDEX.md — File Summaries + Feature Map

> **For Claude Code**: Read this FIRST before searching the codebase. Go directly to the listed files.

---

## Server Files

| File | What it does |
|------|-------------|
| `server/index.ts` | Express entry — mounts middleware, starts followup + warmup engines. Boot sequence: (10s) `resumeActiveCampaigns`, (15s) overdue-scheduled recovery, (30s) reply reclassify, (60s) bounce reconcile, (75s) unsubscribe reconcile. Ongoing: 15-min `resumeDailyLimitPausedCampaigns` poll, hourly daily-limit reset, 15-min reply quality scorer. |
| `server/routes.ts` | ALL API endpoints (campaigns, contacts, inbox, auth, settings) ~10500 lines. Gmail/Outlook OAuth callbacks use `getEmailAccountIncludingInactive()` (case-insensitive) to reactivate existing accounts on reconnect instead of creating new UUID. |
| `server/storage.ts` | SQLite DB layer — all CRUD, schema init, guardrails |
| `server/pg-storage.ts` | PostgreSQL DB layer — drop-in replacement (PRODUCTION). `deleteEmailAccount()` is a soft-delete (`isActive=0`), NOT hard DELETE. `getEmailAccounts()` filters `isActive != 0`. `getEmailAccountIncludingInactive(orgId, email)` does case-insensitive lookup including inactive rows — use this in OAuth callbacks. |
| `server/db.ts` | Drizzle/Neon config — **NEVER IMPORT THIS** |
| `server/vite.ts` | Vite dev server + static file serving |
| `server/auth/google-oauth.ts` | Google OAuth — token exchange, refresh, user info |
| `server/auth/microsoft-oauth.ts` | Microsoft OAuth (MSAL) — token exchange, refresh |
| `server/routes/oauth-routes.ts` | Gmail/Outlook connect, Google Sheets/Excel/CSV import routes |
| `server/services/campaign-engine.ts` | Email sending, scheduling, throttling, per-account limits. `checkSendingWindow` + `msUntilNextSendWindow` support overnight cross-midnight windows (e.g. 17:00–07:00) via OR logic when `startTime > endTime`. |
| `server/services/followup-engine.ts` | Auto follow-ups, Gmail/Outlook threading, bounce skip. Has `addTrackingPixel()`, `addClickTracking()`, `getBaseUrl()` helpers for Steps 2/3/4 open+click tracking. `executeFollowup()` — after atomic daily-limit reservation fails, checks if email account exists: fails permanently (not infinite defer) if account was deleted. |
| `server/services/warmup-engine.ts` | Self-warmup between org accounts, engagement actions |
| `server/services/gmail-reply-tracker.ts` | Gmail inbox sync — reply/bounce/open detection. Has warmup filter (`ownEmailsSet` from email_accounts+warmup_accounts), 404 silent skip (returns null), 90-day message cutoff via `getAllRecentCampaignMessages` |
| `server/services/outlook-reply-tracker.ts` | Outlook Graph inbox sync — reply/bounce/open detection. Has warmup filter (`ownEmailsSet`) |
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
| `server/services/auth-health.ts` | OAuth reauth flagging — records `invalid_grant` / AADSTS failures, flips `authStatus='reauth_required'` at 3 consecutive failures. Fail-open (never throws). Wired into gmail-reply-tracker, outlook-reply-tracker, warmup-engine |
| `server/services/spreadsheet-importer.ts` | Excel/CSV/Google Sheets parsing for contact import |
| `server/google-sheets-service.ts` | Google Sheets API — read rows for contact import |
| `server/services/lead-agent.ts` | AI Lead Agent service — `runOneSearch()` wraps the LLM abstraction with mode-specific prompts (funded/cxo/academics/custom) + Apollo `/v1/people/match` enrichment for missing emails. Currently parked pending Anthropic credits — see status.md. |
| `server/lib/llm/index.ts` | `runLlm()` public entry point — provider-neutral. Loads settings with org → superadmin org → env-var fallback. |
| `server/lib/llm/config.ts` | Pure `resolveProvider(feature, settings, forceProvider?)` — chooses Anthropic vs Azure OpenAI per feature. Tested in `tests/unit/llm-config.test.ts` (27 tests). |
| `server/lib/llm/types.ts` | `LlmRequest`/`LlmResponse` types, `LlmConfigError`/`LlmCapabilityError`/`LlmProviderError` classes. `abortSignal` field plumbed through to providers. |
| `server/lib/llm/retry.ts` | Pure `classifyAnthropicError()` — decides retry-same vs retry-without-schema vs fatal. Recognizes `AbortError`, `Grammar compilation`, `overloaded_error`, `rate_limit_error`. Tested in `tests/unit/llm-retry.test.ts` (21 tests). |
| `server/lib/llm/providers/anthropic.ts` | Anthropic SDK wrapper — adaptive thinking, web_search_20260209 tool, JSON-schema enforcement, retry+schema-strip fallback, 6-min hard timeout, AbortSignal support, streams when webSearch=true OR maxTokens>16K. |
| `server/lib/llm/providers/azure-openai.ts` | Azure OpenAI raw-fetch wrapper — `response_format.json_schema` for structured output. No web search capability. |
| `server/lib/lead-agent-prompts.ts` | Pure mode prompt builders + `LEAD_RESULT_SCHEMA` (mirrors contacts table fields). Tested in `tests/unit/lead-agent-prompts.test.ts` (20 tests). |
| `server/lib/lead-agent-merge.ts` | Pure `normalizeLeads()` / `applyApolloEnrichment()` / `leadToContactInsert()`. Tested in `tests/unit/lead-agent-merge.test.ts` (29 tests). |
| `server/lib/autopilot-defaults.ts` | Pure `resolveAutopilotConfig()` — applies safe Mon-Fri 09:00-18:00 default if caller passes null/disabled/empty config. Used in `/api/campaigns/:id/send` and `/schedule`. Tested in `tests/unit/autopilot-defaults.test.ts` (10 tests). |

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
| `client/src/pages/lead-agent.tsx` | AI Lead Agent UI — mode tabs (funded/cxo/academics/custom), search form, background-job polling every 4s, results table with select-all, save-to-list dialog. Parked pending Anthropic credits — see status.md. |
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
| **AI Lead Agent** (parked) | `server/services/lead-agent.ts`, `server/lib/lead-agent-prompts.ts`, `server/lib/lead-agent-merge.ts`, `server/lib/llm/*`, routes `/api/lead-agent/*` in `routes.ts` (search/jobs/cancel/save) | `lead-agent.tsx` |
| **LLM Provider Abstraction** | `server/lib/llm/` — config, types, retry, providers/anthropic, providers/azure-openai. Used by lead-agent. | `advanced-settings.tsx` (Anthropic key card + AI Provider Routing matrix) |
| **Contact enrichment** | `server/routes.ts` (`hot-leads`), `pg-storage.ts` | `contacts-manager.tsx` (AI Leads tab) |
| **Knowledge Base / AI drafts** | `server/services/context-engine.ts` | `knowledge-base.tsx` |
| **Email verification** | `server/services/email-verifier.ts` | `contacts-manager.tsx` |
| **Team scorecard** | `server/routes.ts` (`/api/team/scorecard`) | `team-scorecard.tsx` |
| **My dashboard** | `server/routes.ts` (`/api/my/dashboard`) | `my-dashboard.tsx` |
| **Email account setup** | `server/routes/oauth-routes.ts`, `server/routes.ts` | `email-account-setup.tsx` |
| **OAuth reauth flagging + UI** | `server/services/auth-health.ts`, `server/routes.ts` (`GET /api/email-accounts/auth-health`, extended `GET /api/email-accounts`), wiring in `gmail-reply-tracker.ts` / `outlook-reply-tracker.ts` / `warmup-engine.ts` | `mailmeteor-dashboard.tsx` (`ReauthBanner`), `email-account-setup.tsx` (badge + Reconnect button) |
| **Contact import** | `server/routes.ts` (`/api/contacts/import`), `spreadsheet-importer.ts` | `email-import-setup.tsx` |
| **SuperAdmin** | `server/routes.ts` (`requireSuperAdmin`) | `superadmin-dashboard.tsx` |

---

## Quick Reference: Common Bug Areas

| Bug area | Check these files FIRST |
|----------|------------------------|
| Login / session lost | `server/routes.ts` (`requireAuth` ~line 130), `server/auth/google-oauth.ts` |
| Campaign not sending / blocked by window | `server/services/campaign-engine.ts`, `server/routes.ts` (`campaigns/send`). For overnight windows (17:00–07:00), check `isOvernightWindow` logic in `checkSendingWindow` — log says `"BLOCKED — overnight gap"` when in gap, `"OK — within overnight window"` when allowed. |
| Campaign stranded after restart | `campaign-engine.ts` `resumeActiveCampaigns()` — check `autoPaused` flag in DB; run `scripts/diag-active-campaigns.ts`. Boot has 2s stagger between campaigns to prevent OOM. For daily-limit-paused campaigns: `resumeDailyLimitPausedCampaigns()` polls every 15 min and fires immediately after midnight reset. For overdue-scheduled campaigns: 15s boot block fires them automatically. CONFIRMED WORKING 2026-04-24. |
| Campaign stuck in following_up | `followup-engine.ts checkFollowupCompletion()` — step0Count query MUST filter `AND status='sent'` (bounced excluded). If done >= expected and pending=0, campaign completes on next 30s cycle. Check if follow-up delay hasn't elapsed yet before assuming stuck (e.g. Cloud 32-Nomination had 2d delay, only 1d elapsed). |
| Server OOM crash on boot | `campaign-engine.ts` — check if a campaign has orphaned contactIds (0 contacts). Abort path added. Also check Azure `NODE_OPTIONS=--max-old-space-size=4096` is set. |
| Follow-up threading | `server/services/followup-engine.ts` (`executeFollowup`, `sendEmail`) |
| Inbox not syncing | `gmail-reply-tracker.ts`, `outlook-reply-tracker.ts` |
| False bounces / replies | `reply-classifier.ts` (strengthened patterns), `server/routes.ts` (auto-classify + `POST /api/inbox/reclassify`), `pg-storage.ts` |
| Inbox reply counts wrong | `server/routes.ts` (filter: `replyType IN ('positive', 'negative', 'general')`), `reply-classifier.ts` |
| Warmup not working | `warmup-engine.ts` (token + daily counter reset) |
| Contact activities/pipeline | `server/routes.ts` (~lines 4838-4930) — quote all camelCase for PG |
| Email account tokens 401 | `server/routes.ts` (`getGmailAccessToken`, `getOutlookAccessToken`) |
| Follow-ups all deferring "account undefined" | `followup-engine.ts` — email account was deleted (soft-deleted) but executions still reference old `emailAccountId`. After atomic daily-limit UPDATE returns no row, engine checks if account exists; missing account → execution marked `failed` permanently. To recover: update `campaigns.emailAccountId` to new account UUID in DB, then reset stuck executions back to `pending`. |
| Reconnecting email account creates new UUID | `server/routes.ts` OAuth callbacks + `pg-storage.ts` `getEmailAccountIncludingInactive()` — already fixed (case-insensitive match + soft-delete). If it recurs, verify the `getEmailAccountIncludingInactive` call path is reached and that `LOWER(email)` comparison works. |
| Account flagged for reauth but shouldn't be | `server/services/auth-health.ts` — detector only matches `invalid_grant` + AADSTS codes, threshold=3. Check `authFailureCount` / `authLastErrorCode` columns on `email_accounts`. Clear manually via `UPDATE email_accounts SET "authStatus"='active', "authFailureCount"=0 WHERE email=?` |
| Raw SQL 0 rows in PG | Double-quote camelCase: `"organizationId"`, `"contactId"`, etc. |
| Import crash | Never import `server/db.ts`. Use `storage.rawGet/rawAll/rawRun` |

---

## Diagnostic Scripts

| Script | What it does |
|--------|-------------|
| `scripts/diag-active-campaigns.ts` | Lists all active campaigns with ✅ SENDING / ⚠️ SLOW / ❌ STRANDED flags based on last 10/60 min activity |
| `scripts/diag-followup.ts` | Inspects follow-up executions for a campaign by name — step/status breakdown, pending overdue, sample rows |
| `scripts/diag-lead-agent-jobs.ts` | Lists all `lead_agent_job_*` rows from `api_settings` with status/heartbeat/error one-liners. Used to diagnose stuck Lead Agent jobs (timeouts, credit failures, abort state). |
| `scripts/emergency-pause-out-of-window.ts` | DRY_RUN/FORCE script that pauses active campaigns currently sending outside their configured autopilot window. Used 2026-04-30 to halt 3 campaigns sending at 23:57 IST. |
| `scripts/unstick-stranded-campaigns.ts` | One-time script: marks stranded campaigns `autoPaused=true` so boot recovery adopts them. `--apply` flag required to write. |
| `scripts/fix-bellaward-bounced.ts` | Restores bounced contacts whose email matches any email_account row (removes false-positive bounces) |

All scripts require `$env:DATABASE_URL` set in PowerShell before running.
