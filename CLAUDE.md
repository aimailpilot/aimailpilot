# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Environment Variables

Key env vars the server expects:
- `SESSION_SECRET` - Express session secret
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` - Microsoft OAuth
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - `development` or `production`

Database path defaults to `./data/aimailpilot.db` (Azure: `/home/data/aimailpilot.db`).
