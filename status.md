# STATUS.md — Working Features (DO NOT BREAK)

This file tracks features that are confirmed working in production.
**INSTRUCTION: Do NOT modify any code related to these features unless explicitly asked to fix a bug in that specific feature.**

---

## Working Features

### 1. Email Sending
- SMTP email sending is fully functional across all supported providers (Gmail OAuth, Outlook OAuth, SendGrid, Elastic Email, generic SMTP)
- Per-account daily send limits and throttling work correctly
- Test email sending works for OAuth accounts (Gmail API / Microsoft Graph) with automatic token refresh
- **Fix applied**: `/api/campaigns/send-test` now detects OAuth accounts and sends via Gmail API / Microsoft Graph with token refresh + 401 retry, instead of using raw SMTP with the `OAUTH_TOKEN` placeholder
- **Do not touch**: `server/services/campaign-engine.ts`, `server/services/smtp-email-service.ts`, OAuth token refresh logic in `/api/campaigns/send-test` route

### 2. Google OAuth / Google Auth
- Google login flow works end-to-end (login + add sender)
- Token exchange, user creation, session setup all working
- **Do not touch**: `server/auth/google-oauth.ts`, Google OAuth routes in `server/routes.ts` (~lines 504–944)

### 3. Unified Inbox / Inbox Sync
- Inbox sync is working (Gmail and Outlook reply tracking)
- Enhanced inbox endpoint (`/api/inbox/enhanced`) displays messages correctly
- Unread count badge matches actual inbox content
- **Fix applied**: Route ordering — `/api/inbox/enhanced` and `/api/inbox/stats` must be registered before `/api/inbox/:id` in Express to avoid param matching conflict
- **Do not touch**: route registration order of `/api/inbox/enhanced`, `/api/inbox/stats` relative to `/api/inbox/:id` in `server/routes.ts`

### 4. Campaign Tracking
- Email open tracking is working
- Email click tracking is working
- Email reply tracking is working
- **Do not touch**: tracking-related routes and webhook handlers in `server/routes.ts` and `server/services/gmail-reply-tracker.ts`, `server/services/outlook-reply-tracker.ts`

### 5. Contact Management
- Contact upload via CSV is working
- Bounce email handling updates contacts correctly
- All contact CRUD operations are working
- **Do not touch**: contact-related storage methods in `server/storage.ts`, CSV import in `server/routes/oauth-routes.ts`

### 6. Template Creation
- Email template creation, editing, and variable substitution are working
- **Do not touch**: template routes in `server/routes.ts`, `server/services/personalization-engine.ts`

### 7. OpenAI API via Azure
- Azure OpenAI integration is working in all places it is used
- **Do not touch**: `server/services/llm.ts` — Azure endpoint config, API key, model/deployment settings

### 8. Azure App Deployment
- The Azure App Service deployment is working correctly
- **Do not touch**: any Azure-related config files, deployment scripts, `web.config`, `.deployment`, `startup.sh`, or any file that affects how the app runs on Azure
- Database path `/home/data/aimailpilot.db` must remain as-is for Azure

### 9. Database Safety (CRITICAL)
- **NEVER** add code that deletes, renames, moves, or recreates the database file
- **NEVER** add `integrity_check` or any pragma as a startup gate — Azure CIFS causes false failures
- **NEVER** add a "reset database" feature that actually deletes the DB file
- If the DB fails to open: **retry**, then **crash** — do NOT create a fresh DB over an existing file
- Backups are at `/home/data/backups/` on Azure — restore manually via Kudu SSH if needed
- See `DATABASE-RECOVERY.md` for full restore procedure
- **Do not touch**: database initialization code in `server/storage.ts` (lines 53–137), the `autoRestoreBackup` function, or the backup mechanism

---

## General Rule

> If a feature is listed above as working, **do not refactor, restructure, or modify the underlying code** for that feature unless the user explicitly reports a bug in it and asks for a fix.
>
> When in doubt — **ask before changing**.
