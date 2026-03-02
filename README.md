# MailFlow - AI-Powered Email Campaign Platform

## Project Overview
- **Name**: MailFlow
- **Production Domain**: `mailsbellaward.com`
- **Goal**: A Mailmeteor-like email campaign management platform with AI-powered personalization, campaign management, and intelligent outreach automation
- **Tech Stack**: Express + React + TypeScript + Tailwind CSS + Vite + shadcn/ui + SQLite

## Features

### Completed
- **Google OAuth 2.0 Sign-In** - Real Google authentication for user login (configurable from Advanced Settings)
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

### Architecture
- **Frontend**: React 18 + Wouter routing + TanStack Query + shadcn/ui components
- **Backend**: Express.js with session-based authentication + Google OAuth 2.0
- **Database**: SQLite (better-sqlite3) with WAL mode - persistent data in `./data/mailflow.db`
- **Auth**: Cookie-based sessions + real Google OAuth 2.0 (fallback to demo mode when not configured)
- **Email**: Nodemailer SMTP with multiple provider presets

## URLs
- **Production**: https://mailsbellaward.com (when deployed)
- **Sandbox**: https://3000-isw56zs1g5v3ymi7shlgn-cc2fbc16.sandbox.novita.ai

## Deployment to mailsbellaward.com

### Prerequisites
1. A VPS/server (Ubuntu 22.04+ recommended) with Node.js 20+
2. Domain `mailsbellaward.com` pointing to your server's IP
3. SSL certificate (Let's Encrypt recommended)
4. Google Cloud OAuth 2.0 credentials

### Step 1: Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Enable the **Google People API** and **Gmail API**
4. Create **OAuth 2.0 Client ID** (Web Application type)
5. Add these Authorized Redirect URIs:
   - `https://mailsbellaward.com/api/auth/google/callback`
6. Copy the **Client ID** and **Client Secret**

### Step 2: Server Setup
```bash
# Clone the repository
git clone <your-repo-url> /opt/mailflow
cd /opt/mailflow

# Install dependencies
npm install

# Build for production
npm run build

# Create environment file
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-strong-random-secret-here
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
COOKIE_DOMAIN=mailsbellaward.com
EOF

# Start in production mode
npm start

# Or use PM2 for process management:
pm2 start dist/index.js --name mailflow --env production
pm2 save
pm2 startup
```

### Step 3: Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name mailsbellaward.com www.mailsbellaward.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mailsbellaward.com www.mailsbellaward.com;

    ssl_certificate /etc/letsencrypt/live/mailsbellaward.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mailsbellaward.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Step 4: SSL with Let's Encrypt
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d mailsbellaward.com -d www.mailsbellaward.com
```

### Alternative: Configure via UI
Instead of environment variables, you can configure Google OAuth credentials from the app itself:
1. Login with demo mode (first time)
2. Go to **Advanced Settings** (gear icon in sidebar)
3. Enter your Google OAuth Client ID and Client Secret in the **Google OAuth Sign-In** section
4. Click **Save Google OAuth Settings**
5. Sign out and sign back in - you'll now be redirected to Google's real login page

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/test` | Server health check |
| GET | `/api/auth/google` | Google OAuth 2.0 login |
| GET | `/api/auth/google/callback` | OAuth callback handler |
| GET | `/api/auth/google/status` | Check auth status |
| GET | `/api/auth/oauth-config-status` | Check OAuth configuration |
| GET | `/api/auth/user` | Get current user info |
| POST | `/api/auth/logout` | Logout |
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
| POST | `/api/track/reply/:id` | Reply tracking webhook |

## User Guide
1. Open the app URL (mailsbellaward.com)
2. Click **"Continue with Google"** to sign in with your Gmail account
3. Browse **Campaigns** - see active, scheduled, draft campaigns
4. Click **"New campaign"** to create a campaign with the email editor
5. Go to **Email Accounts** to add your SMTP sending account (Gmail App Password, Elastic Email, etc.)
6. Navigate to **Templates**, **Contacts**, **Analytics** via sidebar
7. Use **Advanced Settings** to configure Azure OpenAI for AI features
8. Use the **Account** dropdown for settings and logout

## Data Models
- **Organizations** - Multi-tenant support
- **Users** - Team members with roles (created on first Google OAuth login)
- **Email Accounts** - SMTP sending accounts (Gmail, Outlook, Elastic Email, Custom)
- **Campaigns** - Email campaigns with status tracking and analytics
- **Campaign Messages** - Individual message tracking (open, click, reply, bounce)
- **Contacts** - Contact management with scoring, tags, and custom fields
- **Contact Lists** - Groups of imported contacts
- **Segments** - Dynamic contact segments
- **Email Templates** - Reusable templates with variables
- **Follow-up Sequences** - Automated multi-step email sequences
- **API Settings** - Stored configuration (OAuth, Azure OpenAI, Elastic Email)
- **Tracking Events** - Full event log for opens, clicks, replies, bounces

## Deployment Status
- **Platform**: Node.js Express server
- **Database**: SQLite (./data/mailflow.db)
- **Status**: Active
- **Port**: 3000
- **Last Updated**: 2026-03-02
