# Context Engine — Organization Knowledge Base

The Context Engine is a RAG-lite (Retrieval-Augmented Generation) layer that assembles organizational knowledge for AI-powered actions: smart email drafts, proposals, and lead enrichment.

---

## Architecture

```
                    ┌────────────────────────────┐
                    │       CONTEXT ENGINE        │
                    │   server/services/          │
                    │   context-engine.ts         │
                    └──────────┬─────────────────┘
                               │
               ┌───────────────┼───────────────────┐
               │               │                    │
         ┌─────▼─────┐  ┌─────▼─────┐  ┌───────────▼──────────┐
         │  Contact   │  │  Org Docs │  │  Lead Intelligence   │
         │  Context   │  │  (KB)     │  │  (AI Classification) │
         └───────────┘  └───────────┘  └──────────────────────┘
         - email_history   - case studies   - lead_opportunities
         - activities      - proposals      - confidence scores
         - engagement      - brochures      - AI reasoning
         - pipeline        - pricing        - suggested actions
                               │
               ┌───────────────┼───────────────────┐
               │               │                    │
         ┌─────▼─────┐  ┌─────▼─────┐  ┌───────────▼──────────┐
         │  Smart     │  │  Proposal │  │  Contact Enrichment  │
         │  Reply     │  │  Builder  │  │  (badges + filters)  │
         └───────────┘  └───────────┘  └──────────────────────┘
```

## Data Sources

| Source | Table | What it provides |
|--------|-------|-----------------|
| Email History | `email_history` | Past 20 emails with a contact (subject, snippet, direction, date) |
| Lead Intelligence | `lead_opportunities` | AI classification bucket, confidence, reasoning, suggested action |
| Campaign Messages | `messages` | Engagement stats: opens, clicks, replies, bounces |
| Activity Log | `contact_activities` | Call notes, meeting outcomes, remarks |
| Contacts | `contacts` | Company, role, pipeline stage, location, industry |
| Knowledge Base | `org_documents` | Case studies, proposals, brochures, pricing, testimonials |

## Document Storage

### Table: `org_documents`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Nanoid |
| organizationId | TEXT | Org scope |
| name | TEXT | Document name |
| docType | TEXT | `general`, `case_study`, `proposal`, `brochure`, `testimonial`, `award`, `pricing`, `company_profile`, `product`, `faq` |
| source | TEXT | `upload`, `gdoc`, `url` |
| content | TEXT | Full text content |
| summary | TEXT | AI-generated summary (auto-generated on upload) |
| tags | TEXT (JSON) | Comma tags for relevance matching |
| metadata | TEXT (JSON) | Arbitrary metadata |
| fileSize | INTEGER | Content size in bytes |
| mimeType | TEXT | Original file MIME type |
| uploadedBy | TEXT | User ID who uploaded |
| createdAt | TEXT | ISO timestamp |
| updatedAt | TEXT | ISO timestamp |

### Full-Text Search: `org_documents_fts`

SQLite FTS5 virtual table — zero external dependencies, built into `better-sqlite3`.

```sql
CREATE VIRTUAL TABLE org_documents_fts USING fts5(
  name, content, summary, tags,
  content='org_documents', content_rowid='rowid'
);
```

FTS index is manually synced on create/update/delete in storage methods.

## API Endpoints

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/context/documents` | List docs (no full content). Params: `limit`, `offset`, `docType`, `source`, `search` |
| GET | `/api/context/documents/:id` | Single doc with full content |
| POST | `/api/context/documents` | Create doc. Body: `name`, `docType`, `content`, `tags[]`, `summary`. Auto-generates AI summary if omitted. |
| PUT | `/api/context/documents/:id` | Update doc fields |
| DELETE | `/api/context/documents/:id` | Delete doc + FTS entry |
| GET | `/api/context/doc-types` | Bucket counts by docType |

### Context & AI Actions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/context/contact/:contactId` | Full assembled context for a contact (lead intel + email history + relevant docs + activities) |
| POST | `/api/context/draft-reply` | AI draft email with full org context. Body: `contactId`, `contactEmail`, `tone`, `customInstructions`, `incomingEmail` |
| POST | `/api/context/proposal` | AI proposal generation. Body: `contactId`, `contactEmail`, `requirements`, `customInstructions` |

### Draft Reply Request

```json
{
  "contactId": "abc123",
  "tone": "professional",
  "customInstructions": "Mention our recent award, propose a meeting"
}
```

### Draft Reply Response

```json
{
  "draft": "Hi John, ...",
  "provider": "azure-openai",
  "contextUsed": {
    "docsCount": 3,
    "docNames": ["Acme Case Study", "Company Brochure"],
    "emailHistoryCount": 8,
    "leadBucket": "hot_lead",
    "activitiesCount": 2
  }
}
```

## Context Assembly Process

1. **Contact lookup** — by ID or email
2. **Email history** — last 20 emails from `email_history` table
3. **Lead classification** — best (highest confidence) from `lead_opportunities`
4. **Campaign engagement** — aggregated opens/clicks/replies/bounces from `messages`
5. **Activity notes** — last 10 from `contact_activities`
6. **Document search** — FTS5 search using contact's company/industry/topic, with tag-based fallback
7. **Token budgeting** — trims doc content to stay within `maxDocTokens` (default 8K, 12K for proposals)
8. **Prompt assembly** — structured text block injected into LLM system prompt

## Search Strategy (No Vector DB Needed)

At current scale (<100 docs per org), the search strategy is:

1. **FTS5 full-text search** — keyword matching with BM25 ranking (built into SQLite)
2. **Tag-based fallback** — if FTS returns nothing, matches docs by `docType` and tag overlap
3. **Stuff in prompt** — all relevant docs fit within Azure OpenAI's 128K context window

When to add embeddings (future):
- 1000+ documents per org
- Need semantic search ("client retention" matching "reducing churn")
- Can add embeddings as BLOB column in SQLite — no separate vector DB needed

## Frontend

### Knowledge Base Page (`client/src/pages/knowledge-base.tsx`)
- Document list with search, doc type filter pills, pagination
- Add/Edit dialog: name, doc type selector, content textarea, summary, tags
- File upload: reads TXT, CSV, MD, HTML, JSON as text
- View dialog: AI summary badge, tags, full content
- Located in sidebar: Tools > Knowledge Base (admin/owner only)

### AI Draft in Contact Detail (`client/src/pages/contacts-manager.tsx`)
- "AI Draft Email" button in contact detail dialog footer
- Tone selector: professional, friendly, concise, formal, persuasive
- Custom instructions field
- Shows generated draft with "Context used" indicators
- Copy to clipboard + regenerate

### Contact Enrichment (`client/src/pages/contacts-manager.tsx`)
- AI lead classification badges on contact rows (Hot Lead, Warm, Past Customer, etc.)
- Tooltip with AI reasoning and suggested action
- AI Lead Intelligence card in contact detail dialog
- Smart filters in filter bar: Hot Leads, Warm Leads, Past Customers, Engaged, Gone Cold, Never Contacted
- AI Leads tab with full lead cards, bucket filter, search, pagination

## Files

| File | Purpose |
|------|---------|
| `server/services/context-engine.ts` | Core service: context assembly, prompt builders, text extraction, summary generation |
| `server/storage.ts` | `org_documents` table + FTS5 + CRUD methods (~lines 1003-1033, 3440-3530) |
| `server/routes.ts` | API endpoints: document CRUD + context + draft-reply + proposal (~before LEAD INTELLIGENCE section) |
| `client/src/pages/knowledge-base.tsx` | Knowledge Base management UI |
| `client/src/pages/contacts-manager.tsx` | Contact enrichment badges, AI draft dialog, smart filters, AI Leads tab |
| `client/src/pages/mailmeteor-dashboard.tsx` | Dashboard routing + sidebar entry for Knowledge Base |

## Protected Code Notice

The Context Engine is **additive only** — it does not modify any existing protected code:
- No changes to campaign/followup/tracking/threading
- No changes to email auth or sending functions
- No changes to database init or schema (uses `CREATE TABLE IF NOT EXISTS`)
- No new npm dependencies (FTS5 is built into `better-sqlite3`)
- All queries are read-only for enrichment; writes only to new `org_documents` table
