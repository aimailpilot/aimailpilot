# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **IMPORTANT**: Before making any changes, read `status.md`. It lists features that are confirmed working in production and **must not be broken**. Do not modify code for those features unless explicitly asked to fix a bug in them.

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
> See `DATABASE-RECOVERY.md` for the full incident history and recovery procedure.

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
  db.ts          Database initialization and connection
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
    email-rating-engine.ts  Contact scoring
    scheduler.ts            Task scheduling
shared/schema.ts  Drizzle ORM schema (PostgreSQL dialect, used for type definitions)
```

**Important**: The runtime database is **SQLite** (`./data/aimailpilot.db`), managed directly with `better-sqlite3` in `server/storage.ts`. The `shared/schema.ts` / `drizzle.config.ts` files define a PostgreSQL schema used for type generation — Drizzle migrations are **not** used at runtime.

## Key Patterns

**Multitenancy**: Every resource is scoped to an `organizationId`. Users belong to organizations with roles: `owner`, `admin`, `member`, `viewer`. There is also a `superadmin` system (org ID `superadmin`) that can impersonate any org.

**Auth**: Session-based authentication via `express-session` + `memorystore`. OAuth flows for Google and Microsoft are implemented in `server/auth/` and `server/routes.ts`. The session stores `userId`, `organizationId`, and role.

**Email accounts**: Multiple SMTP providers supported (Gmail OAuth, Outlook OAuth, SendGrid, Elastic Email, generic SMTP). Credentials stored per-org in the `email_accounts` table. Google OAuth credentials fall back to the superadmin org if not found in the current org.

**Campaign sending**: `campaign-engine.ts` handles throttling, scheduling, and per-email-account daily send limits. Daily counters reset via a polling interval in `server/index.ts`.

**Follow-up engine**: Starts automatically on server boot (`startFollowupEngine()`), runs background polling to send scheduled follow-ups.

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
