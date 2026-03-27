# STATUS.md — Working Features (DO NOT BREAK)

This file tracks features that are confirmed working in production.
**INSTRUCTION: Do NOT modify any code related to these features unless explicitly asked to fix a bug in that specific feature.**

---

## Working Features

### 1. Email Sending
- SMTP email sending is fully functional across all supported providers (Gmail OAuth, Outlook OAuth, SendGrid, Elastic Email, generic SMTP)
- Per-account daily send limits and throttling work correctly
- **Do not touch**: `server/services/campaign-engine.ts`, `server/services/smtp-email-service.ts`

### 2. Google OAuth / Google Auth
- Google login flow works end-to-end (login + add sender)
- Token exchange, user creation, session setup all working
- **Do not touch**: `server/auth/google-oauth.ts`, Google OAuth routes in `server/routes.ts` (~lines 504–944)

### 3. Campaign Tracking
- Email open tracking is working
- Email click tracking is working
- Email reply tracking is working
- **Do not touch**: tracking-related routes and webhook handlers in `server/routes.ts` and `server/services/gmail-reply-tracker.ts`, `server/services/outlook-reply-tracker.ts`

### 4. Contact Management
- Contact upload via CSV is working
- Bounce email handling updates contacts correctly
- All contact CRUD operations are working
- **Do not touch**: contact-related storage methods in `server/storage.ts`, CSV import in `server/routes/oauth-routes.ts`

### 5. Template Creation
- Email template creation, editing, and variable substitution are working
- **Do not touch**: template routes in `server/routes.ts`, `server/services/personalization-engine.ts`

### 6. OpenAI API via Azure
- Azure OpenAI integration is working in all places it is used
- **Do not touch**: `server/services/llm.ts` — Azure endpoint config, API key, model/deployment settings

### 7. Azure App Deployment
- The Azure App Service deployment is working correctly
- **Do not touch**: any Azure-related config files, deployment scripts, `web.config`, `.deployment`, `startup.sh`, or any file that affects how the app runs on Azure
- Database path `/home/data/aimailpilot.db` must remain as-is for Azure

---

## General Rule

> If a feature is listed above as working, **do not refactor, restructure, or modify the underlying code** for that feature unless the user explicitly reports a bug in it and asks for a fix.
>
> When in doubt — **ask before changing**.
