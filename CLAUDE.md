# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **IMPORTANT**: Before making any changes, read `status.md`. It lists features that are confirmed working in production and **must not be broken**. Do not modify code for those features unless explicitly asked to fix a bug in them.

> **DO NOT TOUCH — PROTECTED CODE (violating these rules has caused production outages)**
> - No changes to tracking code (open/click/reply) in routes.ts, campaign-engine.ts, followup-engine.ts
> - No changes to Gmail auth, Outlook auth, or OAuth routes
> - No changes to database init, backup, or guardrail code in storage.ts
> - No changes to `sendViaMicrosoftGraph` or `sendViaGmailAPI` functions
> - No changes to `gmail-reply-tracker.ts` or `outlook-reply-tracker.ts` (including per-org `checkingOrgs` lock logic)
> - No changes to `warmup-engine.ts` — self-contained warmup service with own token helpers
> - No changes to `lead-intelligence-engine.ts` — self-contained email history scanner + AI classifier with own token helpers
> - No changes to Gmail/Outlook threading logic (`gmailThreadId` storage, `executeFollowup` threading block, `sendEmail` threading headers)
> - No changes to `checkSendingWindow`, `getUserLocalTime`, `msUntilNextSendWindow` in campaign-engine.ts
> - No changes to `updateCampaignMessage` SQL in storage.ts — must include `gmailThreadId` column
> - No changes to Step 0 guarantee block in `/api/campaigns/:id/detail` route
> - No changes to campaign sending/pause/resume flow in routes.ts or campaign-engine.ts
> - **NEVER** use `require('./db')` or import `server/db.ts` — caused 1 day of server crash (drizzle-orm not in production deps)
> - **NEVER** replace working `storage.getContacts()` calls with raw SQL as the primary path — caused contacts page to show 0 contacts TWICE (2026-04-04). Raw SQL may ONLY be used as an enhancement after `storage.getContacts()` has already fetched data. If raw SQL fails, the storage-fetched data must remain.
> - **NEVER** bypass `storage` methods for GET endpoints that work — if you must use raw SQL, always keep the working storage method as primary path and raw SQL as enhancement only
> - **NEVER** clear contacts/data on API error in the frontend (e.g., `setContacts([])` on fetch failure) — this causes "No contacts yet" display. Keep stale data visible on error; it's better UX than empty state.
> - **NEVER** modify the return value of `sendViaGmailAPI` — it must return `{ success, messageId, threadId }` for threading to work
> - When adding new SQL columns, always use `ALTER TABLE ADD COLUMN` with try/catch and update ALL relevant SQL statements (INSERT, UPDATE, SELECT) that touch that table

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
> 3. To access the raw SQLite `better-sqlite3` instance, always use: `const db = (storage as any).db;`
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

**Important**: The runtime database is **SQLite** (`./data/aimailpilot.db`), managed directly with `better-sqlite3` in `server/storage.ts`. The `shared/schema.ts` / `drizzle.config.ts` files define a PostgreSQL schema used for type generation — Drizzle migrations are **not** used at runtime.

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

**Email Attachments**: `email_attachments` table stores base64-encoded file attachments linked to templates or campaigns. API: `GET/POST/DELETE /api/attachments`. Template editor has a Paperclip toolbar button for file upload (max 10MB). Attachments shown in editor bar and preview dialog. `copyAttachmentsToCampaign()` copies template attachments when creating a campaign. See `template.md` for full schema.

**Template Editor**: Uses `contentEditable` div with `document.execCommand` for formatting. Selection save/restore (`savedSelectionRef`) ensures toolbar dropdowns (font, color) apply to highlighted text correctly. Font options: Sans Serif, Serif, Monospace, Georgia, Arial, Verdana, Tahoma, Times New Roman. Preview dialog uses same CSS classes as editor for consistent rendering.

**Performance (Lazy Loading)**: All page components are lazy-loaded via `React.lazy()`. Key chunks are prefetched after initial render via `requestIdleCallback` so tab switches are instant. Campaign queries gated with `enabled` flag — only fire when on campaigns view.

**Raw SQLite access**: `DatabaseStorage` exposes `get db()` getter. Use `const db = (storage as any).db;` in routes. Never import `server/db.ts`.

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

Database path defaults to `./data/aimailpilot.db` (Azure: `/home/data/aimailpilot.db`).

## Common Debugging Tips

- **Session lost after restart**: Expected — MemoryStore is non-persistent. Session auto-restores from `user_id` cookie via DB lookup in `requireAuth`.
- **OAuth redirect mismatch**: Check `getGoogleRedirectUri()` / `getMicrosoftRedirectUri()` (~line 51 in `routes.ts`). Must match what's registered in Google/Microsoft app consoles.
- **Emails not sending**: Check `campaign-engine.ts` throttling and per-account daily send limits. Daily counters reset via polling in `server/index.ts`.
- **Adding a new API route**: Add to `server/routes.ts` (primary) or a new file under `server/routes/` mounted in `server/index.ts`.
- **Frontend query not refreshing**: Check `queryClient` invalidation in `client/src/lib/queryClient.ts`.
