# MailFlow - AI-Powered Email Campaign Platform

## Project Overview
- **Name**: MailFlow (AImailagent)
- **Goal**: A Mailmeteor-like email campaign management platform with AI-powered personalization, campaign management, and intelligent outreach automation
- **Tech Stack**: Express + React + TypeScript + Tailwind CSS + Vite + shadcn/ui

## Features

### Completed
- **Landing Page** - Google & Microsoft OAuth login (demo mode auto-login)
- **Campaign Management** - Create, list, filter (All/Active/Scheduled/Drafts/Ended), search campaigns
- **Campaign Creation** - Full campaign form with email editor, recipient selection, scheduling
- **Contact Management** - View contacts list with search, create new contacts
- **Email Templates** - Template gallery, create new templates with variable support
- **Analytics Dashboard** - Campaign stats, open/click/reply rates, performance cards
- **Account Settings** - User info, billing plan, quota tracking
- **Email & Import Setup** - Google Sheets integration, CSV/Excel import
- **Follow-up Sequences** - Automated follow-up email sequences
- **AI Email Writer** - LLM-powered email content generation
- **Personalization Engine** - Dynamic variable support ({{firstName}}, {{company}}, etc.)
- **Sidebar Navigation** - Full Mailmeteor-style sidebar with campaigns, templates, contacts, analytics

### Architecture
- **Frontend**: React 18 + Wouter routing + TanStack Query + shadcn/ui components
- **Backend**: Express.js with session-based authentication
- **Storage**: In-memory storage with pre-seeded demo data (5 campaigns, 5 contacts, 3 templates)
- **Auth**: Cookie-based session auth with demo Google/Microsoft OAuth flow

## URLs
- **Live App**: https://3000-isw56zs1g5v3ymi7shlgn-cc2fbc16.sandbox.novita.ai

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/test` | Server health check |
| GET | `/api/auth/google` | Google OAuth login (demo) |
| GET | `/api/auth/microsoft` | Microsoft OAuth login (demo) |
| POST | `/api/auth/simple-login` | Simple login for dev |
| GET | `/api/auth/user` | Get current user info |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/dashboard/stats` | Dashboard KPI stats |
| GET | `/api/campaigns` | List campaigns |
| POST | `/api/campaigns` | Create campaign |
| GET | `/api/campaigns/:id` | Get campaign details |
| GET | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Create contact |
| GET | `/api/templates` | List email templates |
| POST | `/api/templates` | Create template |
| GET | `/api/analytics/:id` | Campaign analytics |
| POST | `/api/llm/generate` | AI email generation |

## User Guide
1. Open the app URL
2. Click **"Continue with Google"** to login (auto-creates demo session)
3. Browse **Campaigns** - see active, scheduled, draft campaigns
4. Click **"New campaign"** to create a campaign with the email editor
5. Navigate to **Templates**, **Contacts**, **Analytics** via sidebar
6. Use the **Account** dropdown for settings and logout

## Data Models
- **Organizations** - Multi-tenant support
- **Users** - Team members with roles
- **Campaigns** - Email campaigns with status tracking
- **Contacts** - Contact management with scoring and tags
- **Email Templates** - Reusable templates with variables
- **Follow-up Sequences** - Automated email sequences
- **Campaign Messages** - Individual message tracking

## Deployment
- **Platform**: Sandbox (Express + Vite dev server)
- **Status**: Active
- **Port**: 3000
- **Last Updated**: 2026-03-01
