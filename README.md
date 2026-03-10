# AImailPilot - AI-Powered Email Campaign Platform

## Project Overview
- **Name**: AImailPilot
- **Production Domain**: `aimailpilot.com`
- **Goal**: A Mailmeteor-like email campaign management platform with AI-powered personalization, campaign management, and intelligent outreach automation
- **Tech Stack**: Express + React + TypeScript + Tailwind CSS + Vite + shadcn/ui + SQLite

## Features

### Completed
- **Initial Setup Wizard** - First-time setup page for configuring OAuth credentials (no auth required)
- **Production Auth Security** - Demo/simple login disabled in production; OAuth required
- **Auto SuperAdmin** - First user to authenticate automatically becomes SuperAdmin
- **SuperAdmin Console** - Platform-wide management: user/org administration, impersonation, stats dashboard, role-based access control
- **Multitenancy & Team Management** - Full multi-organization support with team invitations, roles, and org switching
- **Google OAuth 2.0 Sign-In** - Real Google authentication for user login (configurable from Advanced Settings or Setup Wizard)
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
- **Database**: SQLite (better-sqlite3) with WAL mode - persistent data in `./data/aimailpilot.db`
- **Auth**: Cookie-based sessions + real Google/Microsoft OAuth 2.0 (setup wizard for first-time config)
- **Email**: Nodemailer SMTP with multiple provider presets
- **Multitenancy**: Organization-based data isolation with role-based access control

## First-Time Setup Flow

When deployed to a fresh server, AImailPilot guides you through setup:

1. **Setup Wizard** - Opens automatically when no OAuth is configured
   - Configure Google OAuth 2.0 (Client ID + Secret from Google Cloud Console)
   - Or configure Microsoft OAuth 2.0 (Client ID + Secret from Azure Portal)
   - The setup page shows the exact redirect URI needed
2. **First Sign-In** - After configuring OAuth, sign in with Google or Microsoft
3. **Auto SuperAdmin** - The first authenticated user is automatically promoted to SuperAdmin
4. **Configure Platform** - As SuperAdmin, you can:
   - Manage users and organizations
   - Configure additional OAuth providers
   - Set up SMTP accounts, AI features, etc.

### Security Notes
- `POST /api/auth/simple-login` (demo login) is **disabled in production**
- OAuth fallback to demo mode is **removed** — OAuth must be configured first
- `POST /api/setup/oauth` is **locked** after OAuth is configured
- All API routes return proper 404 JSON instead of serving SPA fallback

## Multitenancy System

### How It Works
- **Organizations**: Every user belongs to one or more organizations. All data (campaigns, contacts, templates, etc.) is scoped to an organization.
- **Auto-Creation**: When a new user signs up via OAuth, a personal organization is automatically created.
- **Ownerless Org Adoption**: If an organization was created during setup with no owner, the first user to sign in adopts it.
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

## SuperAdmin System

### Overview
The SuperAdmin is a platform-level role that sits above organization owners. SuperAdmins can manage all organizations, users, and platform settings.

### How to Become SuperAdmin
1. **Auto-promotion**: The first user to authenticate on a fresh deployment is automatically promoted to SuperAdmin
2. **First-time setup**: If no SuperAdmin exists, any authenticated user can claim the role by calling `POST /api/setup-superadmin`
3. **Environment variable**: Set `SUPERADMIN_EMAILS=admin@example.com,admin2@example.com` to auto-promote users on startup
4. **Existing SuperAdmin**: A SuperAdmin can grant/revoke SuperAdmin status to other users via the console

### SuperAdmin Features
| Feature | Description |
|---------|------------|
| **Platform Stats** | Total users, orgs, campaigns, emails sent, opens, clicks, replies |
| **User Management** | List all users, search, enable/disable accounts, grant/revoke SuperAdmin |
| **Organization Management** | List all orgs with stats, view details, delete organizations (cascade) |
| **User Impersonation** | View the platform as any user (switch to their org context) |
| **Top Organizations** | Ranked by email volume with member/contact/campaign counts |
| **Weekly Activity** | New users, campaigns, and emails sent in the last 7 days |

### SuperAdmin API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/superadmin-exists` | Check if any SuperAdmin exists |
| POST | `/api/setup-superadmin` | First-time SuperAdmin setup (only works when none exist) |
| GET | `/api/superadmin/stats` | Platform-wide statistics |
| GET | `/api/superadmin/organizations` | List all organizations (with search, pagination) |
| GET | `/api/superadmin/organizations/:id` | Get org details with members and stats |
| DELETE | `/api/superadmin/organizations/:id` | Delete org and all related data |
| GET | `/api/superadmin/users` | List all users (with search, pagination) |
| PUT | `/api/superadmin/users/:id/toggle-active` | Enable/disable user |
| PUT | `/api/superadmin/users/:id/superadmin` | Grant/revoke SuperAdmin |
| POST | `/api/superadmin/impersonate/:userId` | Impersonate a user |
| POST | `/api/superadmin/stop-impersonation` | Stop impersonating |
| POST | `/api/superadmin/promote-by-email` | Promote user by email |

## URLs
- **Production**: https://aimailpilot.com
- **GitHub**: https://github.com/aimailpilot/aimailpilot

## API Endpoints

### Setup (No Auth Required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/setup/status` | Check if initial setup is needed |
| POST | `/api/setup/oauth` | Save OAuth credentials (only works before OAuth is configured) |

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
2. **First time**: Complete the Setup Wizard to configure OAuth (Google or Microsoft)
3. Click **"Continue with Google"** or **"Continue with Microsoft"** to sign in
4. The **first user** becomes **SuperAdmin** automatically
5. A personal organization is created on first login
6. Browse **Campaigns** - see active, scheduled, draft campaigns
7. Click **"New campaign"** to create a campaign with the email editor
8. Go to **Email Accounts** to add your SMTP sending account
9. Navigate to **Templates**, **Contacts**, **Analytics** via sidebar
10. Use **Team** in the sidebar to invite team members and manage roles
11. Use the **organization dropdown** in the sidebar to switch between orgs
12. Use **Advanced Settings** to configure Azure OpenAI for AI features
13. Access **SuperAdmin** (orange shield icon) for platform management

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

### Quick Start
```bash
git clone https://github.com/aimailpilot/aimailpilot /opt/aimailpilot
cd /opt/aimailpilot
npm install
npm run build

# Create environment file
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-strong-random-secret-here
EOF

# Start with PM2
pm2 start dist/index.js --name aimailpilot --env production
pm2 save && pm2 startup
```

### Configure OAuth
1. Open your app URL — the Setup Wizard will appear automatically
2. Enter your Google/Microsoft OAuth Client ID and Secret
3. Add the displayed redirect URI to your OAuth provider
4. Click **Save** and then **Sign In**
5. First user becomes SuperAdmin automatically

### Environment Variables (Optional)
```bash
GOOGLE_CLIENT_ID=xxx       # Alternative to UI setup
GOOGLE_CLIENT_SECRET=xxx
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
SUPERADMIN_EMAILS=admin@example.com  # Auto-promote to SuperAdmin
SESSION_SECRET=your-secret
COOKIE_DOMAIN=aimailpilot.com
```

## Deployment Status
- **Platform**: Node.js Express server
- **Database**: SQLite (./data/aimailpilot.db)
- **Status**: ✅ Active
- **Port**: 3000
- **GitHub**: https://github.com/aimailpilot/aimailpilot
- **Last Updated**: 2026-03-10
