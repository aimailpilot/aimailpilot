# CAMPAIGN.md — Campaign System Reference

This file documents the complete campaign system for future reference.

---

## Database Schema

### Campaigns Table (`campaigns`) in `server/storage.ts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | TEXT | PK | Unique campaign ID |
| organizationId | TEXT | NOT NULL | Owning organization |
| name | TEXT | NOT NULL | Campaign name |
| description | TEXT | — | Campaign description |
| status | TEXT | 'draft' | Campaign status: draft, scheduled, active, paused, completed |
| templateId | TEXT | — | Linked template ID |
| segmentId | TEXT | — | Target contact segment |
| emailAccountId | TEXT | — | Sending email account |
| contactIds | TEXT | '[]' | JSON array of contact IDs |
| sendingConfig | TEXT | null | JSON sending configuration (throttling, autopilot) |
| scheduledAt | TEXT | — | Scheduled send time |
| trackOpens | INTEGER | 1 | 1 = enable open tracking pixel |
| includeUnsubscribe | INTEGER | 0 | 1 = append unsubscribe link |
| totalRecipients | INTEGER | 0 | Total contacts targeted |
| sentCount | INTEGER | 0 | Emails successfully sent |
| openedCount | INTEGER | 0 | Unique opens |
| clickedCount | INTEGER | 0 | Unique clicks |
| repliedCount | INTEGER | 0 | Replies received |
| bouncedCount | INTEGER | 0 | Bounced emails |
| unsubscribedCount | INTEGER | 0 | Unsubscribes from this campaign |
| createdBy | TEXT | — | User ID of creator |
| createdAt | TEXT | NOT NULL | Creation timestamp |
| updatedAt | TEXT | NOT NULL | Last update timestamp |

### Campaign Messages Table (`campaign_messages`)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | TEXT | PK | Unique message ID |
| campaignId | TEXT | NOT NULL | Parent campaign |
| contactId | TEXT | — | Target contact |
| subject | TEXT | NOT NULL | Personalized subject |
| content | TEXT | NOT NULL | Personalized HTML content |
| status | TEXT | 'pending' | Message status: pending, sending, sent, failed, bounced |
| sentAt | TEXT | — | When email was sent |
| openedAt | TEXT | — | First open timestamp |
| clickedAt | TEXT | — | First click timestamp |
| repliedAt | TEXT | — | First reply timestamp |
| bouncedAt | TEXT | — | Bounce timestamp |
| errorMessage | TEXT | — | Error details if failed |
| trackingId | TEXT | — | Unique tracking ID for open/click/reply correlation |
| stepNumber | INTEGER | 0 | Follow-up step (0 = initial email) |
| createdAt | TEXT | NOT NULL | Creation timestamp |

### Tracking Events Table (`tracking_events`)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | TEXT | PK | Event ID |
| type | TEXT | NOT NULL | Event type: open, click, reply, bounce, unsubscribe, prefetch |
| campaignId | TEXT | — | Campaign reference |
| messageId | TEXT | — | Message reference |
| contactId | TEXT | — | Contact reference |
| trackingId | TEXT | — | Matches message trackingId |
| url | TEXT | — | Click destination URL |
| userAgent | TEXT | — | Email client info |
| ip | TEXT | — | Client IP address |
| metadata | TEXT | — | JSON extra data (e.g., `{ duplicate: true }`) |
| createdAt | TEXT | NOT NULL | Event timestamp |

---

## Campaign Statuses & Lifecycle

```
draft → scheduled → active → completed
  ↓                    ↓
  → active             → paused → active (resume)
```

| Status | Description | Can Transition To |
|--------|-------------|-------------------|
| draft | Initial state, not yet sent | scheduled, active |
| scheduled | Scheduled for future start | active (at time), draft (cancel) |
| active | Currently sending emails | paused, completed |
| paused | User paused; can resume | active (resume) |
| completed | All recipients processed | Terminal (read-only) |

---

## Storage Methods (`server/storage.ts`)

### Campaign CRUD

| Method | Parameters | Purpose |
|--------|------------|---------|
| `getCampaigns(orgId, limit, offset)` | Org ID, pagination | Paginated campaigns for org |
| `getCampaignsForUser(orgId, userId, limit, offset)` | Org ID, User ID | Campaigns by specific user |
| `getCampaign(id)` | Campaign ID | Single campaign |
| `createCampaign(campaign)` | Campaign object | Create campaign (counters default 0) |
| `updateCampaign(id, data)` | ID, partial data | Merge-update campaign fields (including trackOpens, includeUnsubscribe) |
| `deleteCampaign(id)` | Campaign ID | Delete campaign |

### Campaign Messages

| Method | Parameters | Purpose |
|--------|------------|---------|
| `getCampaignMessages(campaignId, limit, offset)` | Campaign ID, pagination | Raw message list |
| `getCampaignMessage(id)` | Message ID | Single message |
| `getCampaignMessageByTracking(trackingId)` | Tracking ID | Lookup by tracking ID |
| `createCampaignMessage(message)` | Message object | Create message (status defaults to 'sending') |
| `updateCampaignMessage(id, data)` | ID, partial data | Update status/timestamps |
| `getCampaignMessagesTotalCount(campaignId)` | Campaign ID | Total message count |

### Enriched Data & Analytics

| Method | Parameters | Purpose |
|--------|------------|---------|
| `getCampaignMessagesEnriched(campaignId, limit, offset)` | Campaign ID, pagination | Messages + contact info + tracking events (batch-optimized, 2-3 SQL queries) |
| `getCampaignMessageStats(campaignId)` | Campaign ID | Single SQL aggregation: total, sent, bounced, opened, clicked, replied |
| `getCampaignStepStats(campaignId)` | Campaign ID | Per-step breakdown (GROUP BY stepNumber) |
| `getCampaignMessagesFiltered(campaignId, limit, offset, filter, search)` | Campaign ID, filters | Filtered messages by status + contact search |
| `getCampaignStats(orgId)` | Org ID | Aggregate stats across all org campaigns |
| `getCampaignStatsForUser(orgId, userId)` | Org ID, User ID | Stats for user's campaigns |
| `getCampaignAnalytics(campaignId)` | Campaign ID | Detailed single-campaign analytics |

### Tracking Events

| Method | Parameters | Purpose |
|--------|------------|---------|
| `createTrackingEvent(event)` | Event object | Log tracking event |
| `getTrackingEvents(campaignId)` | Campaign ID | All events (excludes prefetch) |
| `getRecentCampaignTrackingEvents(campaignId, limit)` | Campaign ID, limit | Recent events for live feed |
| `getTrackingEventsByMessage(messageId)` | Message ID | Events for single message |
| `getAllTrackingEvents(orgId, limit)` | Org ID, limit | Recent events across all campaigns |

---

## API Routes (`server/routes.ts`)

### Campaign Management

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/campaigns` | List campaigns (paginated, role-filtered) |
| GET | `/api/campaigns/:id` | Single campaign |
| GET | `/api/campaigns/:id/detail` | Full detail: enriched messages, stats, step stats, tracking events |
| POST | `/api/campaigns` | Create campaign |
| PUT | `/api/campaigns/:id` | Update campaign (subject, content, settings, trackOpens, includeUnsubscribe) |
| DELETE | `/api/campaigns/:id` | Delete campaign |

### Campaign Control

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/campaigns/:id/send` | Start sending (immediate or with sendingConfig) |
| POST | `/api/campaigns/:id/pause` | Pause active campaign |
| POST | `/api/campaigns/:id/resume` | Resume paused campaign |
| POST | `/api/campaigns/:id/stop` | Stop campaign permanently |
| POST | `/api/campaigns/:id/schedule` | Schedule for future start |

### Preview & Testing

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/campaigns/preview` | Personalized preview with sample contact |
| POST | `/api/campaigns/send-test` | Send test email (supports Gmail API, Microsoft Graph, SMTP) |

### Maintenance

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/campaigns/:id/recalculate` | Recalculate stats from message data |
| POST | `/api/campaigns/:id/reset-bounces` | Clear false bounce marks |

### Tracking (Public, No Auth)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/track/open/:trackingId` | Open tracking pixel (1x1 transparent GIF) |
| GET | `/api/track/click/:trackingId` | Click tracking (redirects to original URL) |
| GET | `/api/track/unsubscribe/:trackingId` | Unsubscribe (marks contact, shows confirmation page) |

### Reply Tracking

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/reply-tracking/check` | Check for new replies |
| POST | `/api/reply-tracking/start` | Enable reply tracking |
| POST | `/api/reply-tracking/stop` | Disable reply tracking |
| GET | `/api/reply-tracking/status` | Tracking status + connected accounts |
| GET | `/api/reply-tracking/diagnostics` | Setup diagnostics |
| GET | `/api/reply-tracking/recent` | Recent replies |

### Analytics

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/analytics/:campaignId` | Campaign analytics (rates, timeline) |
| GET | `/api/tracking/events` | Recent tracking events for live feed |

---

## Sending Configuration (`sendingConfig` JSON)

```json
{
  "delayBetweenEmails": 2000,
  "timezoneOffset": -330,
  "autopilot": {
    "enabled": true,
    "days": {
      "Monday": { "enabled": true, "startTime": "09:00", "endTime": "17:00" },
      "Tuesday": { "enabled": true, "startTime": "09:00", "endTime": "17:00" },
      "Wednesday": { "enabled": true, "startTime": "09:00", "endTime": "17:00" },
      "Thursday": { "enabled": true, "startTime": "09:00", "endTime": "17:00" },
      "Friday": { "enabled": true, "startTime": "09:00", "endTime": "17:00" },
      "Saturday": { "enabled": false, "startTime": "09:00", "endTime": "17:00" },
      "Sunday": { "enabled": false, "startTime": "09:00", "endTime": "17:00" }
    },
    "maxPerDay": 100,
    "delayBetween": 30,
    "delayUnit": "seconds"
  }
}
```

---

## Campaign Engine (`server/services/campaign-engine.ts`)

### Core Methods

| Method | Purpose |
|--------|---------|
| `startCampaign(options)` | Start sending with throttling & autopilot |
| `pauseCampaign(campaignId)` | Pause active campaign (can resume) |
| `resumeCampaign(campaignId)` | Resume paused campaign |
| `stopCampaign(campaignId)` | Stop permanently (clears timer) |
| `scheduleCampaign(campaignId, date, options)` | Schedule for future |
| `personalizeContent(template, data)` | Replace {{variables}} with contact data |

### Sending Flow

1. Load campaign + template + contacts
2. Filter out unsubscribed/bounced contacts
3. For each contact:
   a. Personalize subject + content (replace {{variables}})
   b. Inject open tracking pixel (if `trackOpens=1`)
   c. Rewrite links for click tracking
   d. Append unsubscribe link (if `includeUnsubscribe=1`)
   e. Create `campaign_message` record with unique `trackingId`
   f. Send via Gmail API / Microsoft Graph / SMTP
   g. Update message status (sent/failed)
   h. Wait `delayBetweenEmails` ms
4. Check autopilot window between batches
5. Update campaign counters
6. Mark campaign completed when all contacts processed

### Throttling & Limits

- `delayBetweenEmails`: Pause between each email (default 2000ms)
- `batchSize`: Emails per batch (default 10)
- Email account `dailyLimit` (default 1000) with `dailySent` counter
- Daily counters reset via polling in `server/index.ts`
- Autopilot: respects configured hours, max per day, auto-pauses outside window

### Email Sending Methods

| Method | When Used |
|--------|-----------|
| Gmail API | Gmail OAuth accounts (per-sender tokens) |
| Microsoft Graph | Outlook OAuth accounts (per-sender tokens) |
| SMTP | Generic SMTP, SendGrid, Elastic Email accounts |

### Token Management
- Per-sender tokens: `{provider}_sender_{email}_{token_field}` in `api_settings`
- Auto-refresh: 5-minute buffer before expiry
- Fallback: org-level tokens if per-sender unavailable

---

## Tracking System

### Open Tracking
- 1x1 transparent GIF pixel injected at end of email HTML
- URL: `{baseUrl}/api/track/open/{trackingId}`
- Deduplication: first open updates `message.openedAt`, subsequent marked `duplicate: true` in metadata
- Gmail proxy detection: hits within 90s of `sentAt` treated as prefetch, not real opens
- Bot/scanner user-agent detection: known patterns filtered

### Click Tracking
- All `<a href="...">` links rewritten to `{baseUrl}/api/track/click/{trackingId}?url={encodedOriginalUrl}`
- Endpoint logs click event, then 302 redirects to original URL
- First click updates `message.clickedAt`

### Reply Tracking
- **Gmail:** `server/services/gmail-reply-tracker.ts` — polls mailbox via Gmail API
- **Outlook:** `server/services/outlook-reply-tracker.ts` — polls via Microsoft Graph API
- Matches replies by In-Reply-To / References headers or tracking ID
- Updates `message.repliedAt` and campaign `repliedCount`

### Unsubscribe
- Link: `{baseUrl}/api/track/unsubscribe/{trackingId}`
- Marks contact `status='unsubscribed'`
- Increments campaign `unsubscribedCount`
- Shows confirmation HTML page to user
- Contact excluded from all future campaigns

---

## Follow-up Engine (`server/services/followup-engine.ts`)

### Overview
- Starts automatically on server boot (`startFollowupEngine()`)
- Runs background polling to send scheduled follow-ups
- Multi-step sequences linked to campaigns

### Trigger Types

| Trigger | Condition |
|---------|-----------|
| `no_reply` | No reply after delay |
| `no_open` | Not opened after delay |
| `no_click` | No click after delay |
| `opened` | Email was opened |
| `clicked` | Link was clicked |
| `replied` | Reply received |
| `time_delay` | Always send after delay |

### Sequence Structure
```
Campaign → CampaignFollowups → FollowupSequence → FollowupSteps
                                                      ↓
                                               FollowupExecutions (per contact)
```

### Execution Flow
1. Initial campaign email sent
2. Follow-up steps scheduled based on trigger conditions + delay
3. Engine polls for due executions
4. Checks trigger condition (e.g., still no reply?)
5. If condition met: personalize & send follow-up (same thread if Gmail)
6. Update execution status: pending → scheduled → sent/failed

---

## Frontend Components

### Campaign Detail Page (`client/src/pages/campaign-detail.tsx`)

**Header:** Campaign name, status badge, aggregate stats (sent/opened/clicked/replied/bounced)

**Update Dialog (two modes):**
1. **Edit mode:**
   - Subject + content editing (rich text)
   - Settings sidebar: Autopilot button, Track emails toggle, Unsubscribe link toggle
   - Autopilot config dialog: day schedule, max per day, delay between emails, summary
2. **Preview mode:**
   - Desktop/mobile toggle (mobile = 375px phone frame)
   - Personalized content preview
   - Send test email: account selector, recipient input

**Messages Table:**
- Paginated (25 per page)
- Filters: All, Opened, Clicked, Replied, Bounced
- Search by email/name
- Each row: contact info, status, sent time, open/click/reply counts
- Expandable: tracking event timeline

**Step Analytics:** Per-step breakdown with send/open/click/reply rates (for multi-step campaigns)

**Recent Activity:** Live feed of last 50 tracking events

### Campaign List (in `client/src/pages/mailmeteor-dashboard.tsx`)
- Campaign cards: name, status badge, stats, progress bar
- Actions: Send, Pause, Resume, Delete
- Role-based: members see own campaigns, admins see all
- Navigation persisted via URL hash (`#campaign-detail/{id}`)

---

## Access Control

| Role | See Campaigns | Create | Send | Pause/Resume | Delete |
|------|--------------|--------|------|--------------|--------|
| Owner | All org campaigns | Yes | Yes | Yes | Yes |
| Admin | All org campaigns | Yes | Yes | Yes | Yes |
| Member | Own campaigns only | Yes | Yes | Own only | Own only |

---

## Key Files

| File | Purpose |
|------|---------|
| `server/services/campaign-engine.ts` | Email sending, throttling, scheduling, autopilot |
| `server/services/followup-engine.ts` | Follow-up sequence execution |
| `server/services/smtp-email-service.ts` | SMTP provider abstraction |
| `server/services/gmail-reply-tracker.ts` | Gmail reply detection |
| `server/services/outlook-reply-tracker.ts` | Outlook reply detection |
| `server/services/personalization-engine.ts` | Variable substitution |
| `server/storage.ts` (~lines 1468-1790) | Campaign CRUD + messages + tracking |
| `server/routes.ts` | Campaign API routes |
| `client/src/pages/campaign-detail.tsx` | Campaign detail page + update dialog |
| `client/src/pages/mailmeteor-dashboard.tsx` | Campaign list + dashboard |
| `shared/schema.ts` | Type definitions |

---

## Performance Optimizations

- **Batch-optimized enrichment:** `getCampaignMessagesEnriched` uses 2-3 total SQL queries with `IN(...)` instead of N+1 per message
- **Lightweight stats:** `getCampaignMessageStats` (single aggregation) and `getCampaignStepStats` (GROUP BY) avoid loading all messages
- **Message cap:** Detail page capped at 500 messages to prevent timeout
- **Pagination:** Messages table paginated at 25 per page with server-side filtering
