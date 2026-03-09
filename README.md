# MailFlow - AI-Powered Email Campaign Platform

## Project Overview
- **Name**: MailFlow
- **Production Domain**: `mailsbellaward.com`
- **Goal**: A Mailmeteor-like email campaign management platform with AI-powered personalization, campaign management, and intelligent outreach automation
- **Tech Stack**: Express + React + TypeScript + Tailwind CSS + Vite + shadcn/ui + SQLite

## Features

### Completed
- **Multitenancy & Team Management** - Full multi-organization support with team invitations, roles, and org switching
- **Google OAuth 2.0 Sign-In** - Real Google authentication for user login (configurable from Advanced Settings)
- **Microsoft OAuth 2.0 Sign-In** - Outlook/Microsoft account authentication
- **Landing Page** - Professional landing page with Google & Microsoft OAuth login buttons
- **Campaign Management** - Create, list, filter (All/Active/Scheduled/Drafts/Ended), search campaigns
- **Campaign Sending Engine** - Real SMTP email sending with per-email error handling and throttling
- **Open/Click/Reply Tracking** - Tracking pixels, click redirect tracking, reply webhooks
- **Contact Management** - View, create, import contacts from CSV or Google Sheets
- **Contact Lists & Segments** - Organize contacts into lists and segments
- **Email Templates** - Template gallery with variable support and AI generation
- **Analytics Dashboard** - Campaign stats, open/click/reply rates, performance tracking
- **Account Settings** - User info, billing plan, quota tracking
- **Email & Import Setup** - Google Sheets integration, CSV/Excel import with smart column mapping
- **Follow-up Sequences** - Automated multi-step follow-up email sequences
- **AI Email Writer** - Azure OpenAI-powered email content generation
- **Personalization Engine** - Dynamic variables ({{firstName}}, {{company}}, etc.)
- **Advanced Settings** - Google OAuth, Azure OpenAI, and Elastic Email configuration
- **SMTP Email Accounts** - Gmail, Outlook, Office 365, Elastic Email, and Custom SMTP support
- **Unified Inbox** - Aggregated replies from Gmail and Outlook in one place

### Architecture
- **Frontend**: React 18 + Wouter routing + TanStack Query + shadcn/ui components
- **Backend**: Express.js with session-based authentication + Google/Microsoft OAuth 2.0
- **Database**: SQLite (better-sqlite3) with WAL mode - persistent data in `./data/mailflow.db`
- **Auth**: Cookie-based sessions + real Google/Microsoft OAuth 2.0 (fallback to demo mode when not configured)
- **Email**: Nodemailer SMTP with multiple provider presets
- **Multitenancy**: Organization-based data isolation with role-based access control

## Multitenancy System

### How It Works
- **Organizations**: Every user belongs to one or more organizations. All data (campaigns, contacts, templates, etc.) is scoped to an organization.
- **Auto-Creation**: When a new user signs up via OAuth, a personal organization is automatically created.
- **Invitation System**: Admins/Owners can invite team members by email. Invitations expire after 7 days.
- **Auto-Accept**: If a new user signs up and has pending invitations, they are automatically accepted.
- **Org Switching**: Users who belong to multiple organizations can switch between them via the sidebar dropdown.
- **Data Isolation**: Each organization's data (campaigns, contacts, templates, settings) is completely isolated.

### Roles
| Role | Permissions |
|------|------------|
| **Owner** | Full control: billing, delete org, manage all settings, transfer ownership |
| **Admin** | Manage team members, settings, campaigns, contacts |
| **Member** | Create and manage campaigns, contacts, templates |
| **Viewer** | View-only access to dashboards and analytics |

### Database Tables
- `org_members` - Many-to-many mapping of users to organizations with roles
- `org_invitations` - Pending, accepted, or cancelled team invitations

## URLs
- **Production**: https://mailsbellaward.com (when deployed)
- **Sandbox**: https://3000-isw56zs1g5v3ymi7shlgn-cc2fbc16.sandbox.novita.ai

## API Endpoints

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/test` | Server health check |
| GET | `/api/auth/google` | Google OAuth 2.0 login |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| GET | `/api/auth/microsoft` | Microsoft OAuth 2.0 login |
| GET | `/api/auth/microsoft/callback` | Microsoft OAuth callback |
| GET | `/api/auth/user` | Get current user info |
| GET | `/api/auth/user-profile` | Get user + org info (enhanced) |
| POST | `/api/auth/logout` | Logout |

### Organization & Team Management (Multitenancy)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/organizations` | List user's organizations |
| POST | `/api/organizations` | Create new organization |
| GET | `/api/organizations/current` | Get current org details |
| PUT | `/api/organizations/current` | Update current org (admin+) |
| POST | `/api/organizations/switch` | Switch active organization |
| GET | `/api/team/members` | List org team members |
| PUT | `/api/team/members/:userId/role` | Update member role (admin+) |
| DELETE | `/api/team/members/:userId` | Remove member (admin+) |
| POST | `/api/team/leave` | Leave organization |
| POST | `/api/invitations` | Create invitation (admin+) |
| GET | `/api/invitations` | List org's pending invitations |
| DELETE | `/api/invitations/:id` | Cancel invitation (admin+) |
| POST | `/api/invitations/accept` | Accept invitation by token |
| GET | `/api/invitations/pending` | Get user's pending invitations |

### Campaigns & Email
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/stats` | Dashboard KPI stats |
| GET/POST | `/api/campaigns` | List/Create campaigns |
| POST | `/api/campaigns/:id/send` | Send campaign emails |
| GET | `/api/campaigns/:id/detail` | Full campaign detail + analytics |
| GET/POST | `/api/contacts` | List/Create contacts |
| POST | `/api/contacts/import` | Bulk import contacts |
| GET/POST | `/api/templates` | List/Create email templates |
| GET | `/api/analytics/:id` | Campaign analytics |
| POST | `/api/llm/generate` | AI email generation |
| GET/PUT | `/api/settings` | Get/Update API settings |
| GET | `/api/track/open/:id` | Open tracking pixel |
| GET | `/api/track/click/:id` | Click tracking redirect |

## User Guide
1. Open the app URL
2. Click **"Continue with Google"** or **"Continue with Microsoft"** to sign in
3. A personal organization is created automatically on first login
4. Browse **Campaigns** - see active, scheduled, draft campaigns
5. Click **"New campaign"** to create a campaign with the email editor
6. Go to **Email Accounts** to add your SMTP sending account
7. Navigate to **Templates**, **Contacts**, **Analytics** via sidebar
8. Use **Team** in the sidebar to invite team members and manage roles
9. Use the **organization dropdown** in the sidebar to switch between orgs
10. Use **Advanced Settings** to configure Azure OpenAI for AI features

## Data Models
- **Organizations** - Multi-tenant workspaces with settings
- **Org Members** - User-to-org mapping with roles (owner/admin/member/viewer)
- **Org Invitations** - Team invitation system with token-based acceptance
- **Users** - Team members with roles (created on first OAuth login)
- **Email Accounts** - SMTP sending accounts (Gmail, Outlook, Elastic Email, Custom)
- **Campaigns** - Email campaigns with status tracking and analytics
- **Campaign Messages** - Individual message tracking (open, click, reply, bounce)
- **Contacts** - Contact management with scoring, tags, and custom fields
- **Contact Lists** - Groups of imported contacts
- **Segments** - Dynamic contact segments
- **Email Templates** - Reusable templates with variables
- **Follow-up Sequences** - Automated multi-step email sequences
- **Unified Inbox** - Aggregated replies from all email accounts
- **API Settings** - Stored configuration per organization
- **Tracking Events** - Full event log for opens, clicks, replies, bounces

## Deployment

### Prerequisites
1. A VPS/server (Ubuntu 22.04+ recommended) with Node.js 20+
2. Domain pointing to your server's IP
3. SSL certificate (Let's Encrypt recommended)
4. Google Cloud OAuth 2.0 credentials (optional - configurable via UI)

### Quick Start
```bash
git clone <repo-url> /opt/mailflow
cd /opt/mailflow
npm install
npm run build

# Create environment file
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-strong-random-secret-here
EOF

# Start with PM2
pm2 start dist/index.js --name mailflow --env production
pm2 save && pm2 startup
```

### Configure OAuth via UI
1. Login with demo mode (first time)
2. Go to **Advanced Settings** (wrench icon in sidebar)
3. Enter your Google/Microsoft OAuth Client ID and Secret
4. Click **Save** and re-authenticate

## Deployment Status
- **Platform**: Node.js Express server
- **Database**: SQLite (./data/mailflow.db)
- **Status**: Active
- **Port**: 3000
- **Last Updated**: 2026-03-09
