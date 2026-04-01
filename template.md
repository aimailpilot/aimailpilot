# TEMPLATE.md — Template System Reference

This file documents the complete template system for future reference.

---

## Database Schema

**Table:** `templates` in `server/storage.ts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | TEXT | PK | Unique template ID |
| organizationId | TEXT | NOT NULL | Owning organization |
| name | TEXT | NOT NULL | Template name |
| category | TEXT | — | Category: general, onboarding, follow-up, marketing, outreach, newsletter, transactional |
| subject | TEXT | — | Email subject line |
| content | TEXT | — | Email body (HTML or plain text) |
| variables | TEXT | '[]' | JSON array of detected variable names |
| isPublic | INTEGER | 0 | 1 = visible to team, 0 = private to creator |
| usageCount | INTEGER | 0 | Number of campaigns using this template |
| createdBy | TEXT | — | User ID of creator |
| createdAt | TEXT | NOT NULL | Creation timestamp |
| updatedAt | TEXT | NOT NULL | Last update timestamp |

---

## Storage Methods (`server/storage.ts`)

| Method | Purpose |
|--------|---------|
| `getEmailTemplates(orgId)` | All templates in org |
| `getEmailTemplatesByUser(orgId, userId)` | Templates created by user (My Templates) |
| `getEmailTemplatesExcludingUser(orgId, userId)` | Templates by other users (Team Templates for admins) |
| `getPublicEmailTemplatesExcludingUser(orgId, userId)` | Only public templates by others (Team Templates for members) |
| `getEmailTemplate(id)` | Single template by ID |
| `createEmailTemplate(template)` | Create new template (generates ID + timestamps) |
| `updateEmailTemplate(id, data)` | Merge-update template fields |
| `deleteEmailTemplate(id)` | Delete template |

**Hydration:** `hydrateTemplate()` parses `variables` from JSON string to array.

---

## API Routes (`server/routes.ts`)

All routes require authentication (`requireAuth` middleware).

### CRUD

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/templates` | All org templates (enriched with scores) |
| GET | `/api/templates/mine` | User's own templates |
| GET | `/api/templates/team` | Team templates (admins: all, members: public only) |
| GET | `/api/templates/:id` | Single template |
| POST | `/api/templates` | Create template (members forced private) |
| PUT | `/api/templates/:id` | Update template (members cannot change isPublic) |
| DELETE | `/api/templates/:id` | Delete template |

### Deliverability

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/templates/analyze-deliverability` | Analyze subject+content for spam triggers |
| POST | `/api/templates/fix-deliverability` | AI auto-fix for deliverability issues |

### AI Generation

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/llm/status` | Check if Azure OpenAI is configured |
| POST | `/api/llm/generate` | Generate template content via AI |

---

## Access Control

| Role | My Templates | Team Templates | Set Public/Private |
|------|-------------|----------------|-------------------|
| Owner | All own templates | All other users' templates | Yes |
| Admin | All own templates | All other users' templates | Yes |
| Member | All own templates | Only public templates from others | No (always private) |

**Backend enforcement:**
- `POST /api/templates`: Members' `isPublic` forced to `false`
- `PUT /api/templates/:id`: `isPublic` field stripped for non-admin users

---

## Template Scoring System

Templates are enriched with performance scores based on campaign metrics.

**Score Interface:**
```
total: 0-100       openRate: %       replyRate: %
clickRate: %        spamScore: 0-100  campaignsUsed: count
grade: A/B/C/D/F
```

**Calculation:**
1. Find campaigns using this template (by templateId or subject+content match)
2. Aggregate: totalSent, totalOpened, totalReplied, totalClicked
3. Calculate rates
4. `total = (openRate * 0.3) + (replyRate * 0.4) + (clickRate * 0.1) + (spamPenalty * 0.2)`
5. Grades: A (80+), B (60+), C (40+), D (20+), F (<20)

---

## Deliverability Analysis

**Spam trigger words checked (20+ words across 4 severity groups):**
- **Critical (8-20pt penalty):** winner, congratulations, million dollars, viagra, pharmacy, casino...
- **Warning (3-4pt penalty):** free, act now, limited time, urgent, buy now, click here, risk free...

**Other checks:**
- Subject length (30-60 chars optimal)
- Content word count (50-200 words optimal)
- Link count (>3 = warning)
- Image count (>2 = warning)
- Personalization variables (none = warning)
- ALL CAPS detection
- Excessive exclamation marks/emojis

**AI Fix:** Uses Azure OpenAI (temperature 0.3) to rewrite subject+content while preserving {{variables}} and meaning.

---

## AI Template Generation (`/api/llm/generate`)

**Request:**
```json
{
  "prompt": "Describe the email you want",
  "type": "template|campaign|personalize|subject|reply",
  "format": "text|html|both",
  "context": { "category": "...", "name": "..." }
}
```

**Format handling:**
- `text`: Plain text only, no HTML
- `html`: HTML email markup (<p>, <strong>, <a>, <ul>, etc.)
- `both`: Returns separate `textContent` and `htmlContent`

**Text-to-HTML conversion:** When inserting plain text into the visual editor, `textToHtml()` converts:
- `\n\n` to paragraph breaks (`<p>`)
- `\n` to `<br>` within paragraphs
- `**bold**` to `<strong>bold</strong>`
- Existing HTML passed through unchanged

**Demo fallback:** When Azure not configured, returns demo template with configuration note.

---

## Personalization Variables

**Available in templates via `{{variableName}}` syntax:**

| Variable | Source | Fallback |
|----------|--------|----------|
| `firstName` | Contact | "there" |
| `lastName` | Contact | "" |
| `fullName` | Contact | "there" |
| `email` | Contact | "" |
| `company` | Contact | "your company" |
| `jobTitle` | Contact | "" |
| `senderName` | Sender account | "" |
| `senderEmail` | Sender account | "" |
| `campaignName` | Campaign | "" |
| `today` | Server | Current date |
| `currentMonth` | Server | Month name |
| `currentYear` | Server | 4-digit year |

**Pattern support:** `{{var}}`, `[[var]]`, `{var}`, `%var%` (all normalized to lowercase+underscores)

**Custom fields:** Any contact custom field is auto-available as a variable.

---

## Frontend Component (`client/src/pages/template-manager.tsx`)

### Template List View
- Search by name, category, subject, creator
- Category filter (7 categories with icons/colors)
- Tabs: My Templates / Team Templates
- Sort: name, date, score, usage (asc/desc)
- Template rows show: name, visibility badge (owner only), category, creator avatar, score grade, usage count, date
- Dropdown actions: Preview, Edit, Duplicate, Make Private/Public (owner), Delete

### Editor View (Full-screen)
- **Top bar:** Back, actions dropdown, Public/Private toggle (owner), Preview, Save
- **Template name:** Inline editable text input
- **Subject + category:** Subject input with category dropdown
- **Toolbar (visual mode):** Bold, Italic, Underline, Strikethrough, Link, Image, Lists, Alignment, Clear formatting, Variables dropdown
- **Editor modes:** Visual (contentEditable) / HTML (code textarea)
- **AI Write section:** Collapsible, format selector (Text/HTML/Both), prompt textarea, quick suggestions, result display with Use buttons
- **Deliverability panel:** Right sidebar (340px), score card, quick stats, issues list, spam highlighting, AI suggestions, auto-fix button

### Preview Dialog
- Desktop/mobile viewport toggle (mobile = 375px phone frame)
- Personalized content with sample contact
- Send test email: account selector, recipient input, send button with success/error feedback

---

## Template Usage in Campaigns

1. Campaign creation: user selects template from dropdown
2. `templateId` stored on campaign record
3. During send: template subject+content loaded and personalized per contact
4. `personalizeContent()` in campaign-engine replaces all `{{variables}}` with contact data
5. Unresolved variables stripped from final email
6. Template `usageCount` tracked for scoring

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/pages/template-manager.tsx` | Full template management UI |
| `server/storage.ts` (~lines 1382-1403) | Template CRUD methods |
| `server/routes.ts` (~lines 5159-5521) | Template API routes |
| `server/services/personalization-engine.ts` | Variable substitution engine |
| `server/services/llm.ts` | Azure OpenAI integration |
| `shared/schema.ts` | Type definitions |
