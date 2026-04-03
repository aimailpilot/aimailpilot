# STATUS.md — Working Features (DO NOT BREAK)

This file tracks features that are confirmed working in production.
**INSTRUCTION: Do NOT modify any code related to these features unless explicitly asked to fix a bug in that specific feature.**

---

## Working Features

### 1. Email Sending
- SMTP email sending is fully functional across all supported providers (Gmail OAuth, Outlook OAuth, SendGrid, Elastic Email, generic SMTP)
- Per-account daily send limits and throttling work correctly
- Test email sending works for OAuth accounts (Gmail API / Microsoft Graph) with automatic token refresh
- **Fix applied**: `/api/campaigns/send-test` now detects OAuth accounts and sends via Gmail API / Microsoft Graph with token refresh + 401 retry, instead of using raw SMTP with the `OAUTH_TOKEN` placeholder
- **Do not touch**: `server/services/campaign-engine.ts`, `server/services/smtp-email-service.ts`, OAuth token refresh logic in `/api/campaigns/send-test` route

### 2. Google OAuth / Google Auth
- Google login flow works end-to-end (login + add sender)
- Token exchange, user creation, session setup all working
- **Do not touch**: `server/auth/google-oauth.ts`, Google OAuth routes in `server/routes.ts` (~lines 504–944)

### 3. Unified Inbox / Inbox Sync
- Inbox sync is working (Gmail and Outlook reply tracking)
- Enhanced inbox endpoint (`/api/inbox/enhanced`) displays messages correctly
- Unread count badge matches actual inbox content
- **Fix applied**: Route ordering — `/api/inbox/enhanced` and `/api/inbox/stats` must be registered before `/api/inbox/:id` in Express to avoid param matching conflict
- **Do not touch**: route registration order of `/api/inbox/enhanced`, `/api/inbox/stats` relative to `/api/inbox/:id` in `server/routes.ts`

### 4. Campaign Tracking (Gmail + Outlook — LOCKED)
- Email **open tracking** is working on both Gmail and Outlook campaigns
- Email **click tracking** is working on both Gmail and Outlook campaigns
- Email **reply tracking** is working on both Gmail and Outlook campaigns
- All three tracking types are confirmed working in production for both providers — **any changes require explicit user approval**
- **Do not touch**: tracking-related routes and webhook handlers in `server/routes.ts`, `server/services/gmail-reply-tracker.ts`, `server/services/outlook-reply-tracker.ts`, tracking pixel/click/reply logic in `server/services/campaign-engine.ts`, and `getCampaignMessageByContactEmailAndSubject` / `getCampaignMessageByProviderMessageId` in `server/storage.ts`

### 5. Contact Management
- Contact upload via CSV is working
- Bounce email handling updates contacts correctly
- All contact CRUD operations are working
- **Do not touch**: contact-related storage methods in `server/storage.ts`, CSV import in `server/routes/oauth-routes.ts`

### 6. Template Creation
- Email template creation, editing, and variable substitution are working
- **Do not touch**: template routes in `server/routes.ts`, `server/services/personalization-engine.ts`

### 7. OpenAI API via Azure
- Azure OpenAI integration is working in all places it is used
- **Do not touch**: `server/services/llm.ts` — Azure endpoint config, API key, model/deployment settings

### 8. Azure App Deployment
- The Azure App Service deployment is working correctly
- **Do not touch**: any Azure-related config files, deployment scripts, `web.config`, `.deployment`, `startup.sh`, or any file that affects how the app runs on Azure
- Database path `/home/data/aimailpilot.db` must remain as-is for Azure

### 9. Campaign Detail Page (Large Campaigns)
- Campaign detail page loads correctly even for large campaigns (900+ messages)
- **Fix applied**: Batch-optimized `getCampaignMessagesEnriched` from N+1 queries (2 per message) to 2-3 total queries using `IN(...)` SQL
- **Fix applied**: Added `getCampaignMessageStats` (single SQL aggregation) and `getCampaignStepStats` (GROUP BY) for lightweight stats
- **Fix applied**: Capped messages loaded on detail page to 500 to prevent timeout
- **Fix applied**: Renamed `getRecentCampaignTrackingEvents` to avoid conflict with existing `getRecentTrackingEvents` method
- **Do not touch**: `getCampaignMessagesEnriched`, `getCampaignMessageStats`, `getCampaignStepStats`, `getRecentCampaignTrackingEvents` in `server/storage.ts`; `/api/campaigns/:id/detail` route in `server/routes.ts`

### 10. Template Deliverability Analysis
- Deliverability scoring, spam word detection, and issue analysis are working in the template editor
- AI auto-fix via Azure OpenAI rewrites subject/content to improve deliverability
- Spam word highlighting in editor (contentEditable + subject overlay) is working
- Deliverability panel renders as a **right sidebar** beside the editor (not stacked above)
- **Do not touch**: `/api/templates/analyze-deliverability`, `/api/templates/fix-deliverability` routes in `server/routes.ts`; deliverability panel and spam highlighting logic in `client/src/pages/template-manager.tsx`

### 11. Template Preview (Desktop/Mobile + Test Email)
- Desktop/mobile preview toggle in template preview dialog is working
- Mobile preview renders at 375px width with phone frame styling
- Send test email from preview dialog is working — uses existing `/api/campaigns/send-test` endpoint
- Email account selector auto-loads on preview open
- Both preview dialogs (editor view + list view) have the same features
- **Do not touch**: preview dialog code and `sendTestEmail` function in `client/src/pages/template-manager.tsx`

### 12. Template Visibility (Private/Public)
- All templates are **public by default** — visible to all team members
- Only owners/admins can toggle templates to Private (only creator sees) or back to Public
- Members cannot change visibility — their templates are always public
- Team Templates tab for members only shows public templates from other users; owners/admins see all
- DB default changed to `isPublic INTEGER DEFAULT 1`; migration sets all existing templates to public
- `/api/auth/user` now returns `role` so the frontend can detect owner/admin correctly
- Backend enforces: `isPublic` field stripped from non-admin PUT/POST requests
- **Do not touch**: `getPublicEmailTemplatesExcludingUser` in `server/storage.ts`; visibility logic in `POST /api/templates` and `PUT /api/templates/:id` in `server/routes.ts`; visibility toggle UI and role-fetching in `client/src/pages/template-manager.tsx`; `getUserRole` helper in `/api/auth/user` route

### 13. AI Template Content Insertion
- AI-generated text content is properly converted to HTML before insertion into contentEditable editor
- `textToHtml()` helper converts plain text → `<p>` tags, `\n` → `<br>`, `**bold**` → `<strong>`
- Detects existing HTML and passes through unchanged
- Applied to "Use Content", "Use Text", and "Use HTML" buttons
- **Do not touch**: `textToHtml` function and AI result insertion logic in `client/src/pages/template-manager.tsx`

### 14. Contact List Access Control
- Members see only contacts/lists uploaded by themselves or allocated to them
- Owners/admins see all lists and contacts across the organization
- SQL-level filtering via `getContactListsForUser` with EXISTS subquery on `uploadedBy` and `contacts.assignedTo`
- **Do not touch**: `getContactListsForUser` in `server/storage.ts`; role-based filtering in `GET /api/contact-lists` and `GET /api/contacts` in `server/routes.ts`

### 15. Campaign Update Dialog (Settings + Preview)
- Campaign update dialog has two modes: Edit (with settings sidebar) and Preview (desktop/mobile toggle + test email)
- Settings sidebar is functional: Autopilot config (day schedule, max per day, delay), Track emails toggle, Unsubscribe link toggle
- `trackOpens` and `includeUnsubscribe` saved to campaign via `updateCampaign` SQL
- `sendingConfig` JSON stores autopilot configuration
- Preview mode shows personalized content from `/api/campaigns/preview`
- **Do not touch**: update dialog modes, settings sidebar, autopilot dialog, and `loadPreview`/`showPreviewMode`/`sendCampaignTestEmail` in `client/src/pages/campaign-detail.tsx`; `trackOpens`/`includeUnsubscribe` in `updateCampaign` SQL in `server/storage.ts`

### 16. URL Hash Navigation Persistence
- Current view persists across page refresh using URL hash (`#contacts`, `#templates`, `#campaign-detail/{id}`, etc.)
- `setCurrentView` wrapper updates hash via `replaceState`; initial state reads from hash
- **Do not touch**: hash-based navigation logic in `client/src/pages/mailmeteor-dashboard.tsx`

### 17. Outlook OAuth Email Sending (Campaigns + Quick Send)
- Outlook OAuth email sending via Microsoft Graph API is working for campaigns and contact quick-send
- **Fix applied**: `sendViaMicrosoftGraph` no longer sets explicit `from` field — Graph auto-uses the authenticated user's email (personal Microsoft accounts reject explicit `from`)
- **Fix applied**: Retry logic tries with custom tracking headers first, falls back to without headers
- **Fix applied**: `/api/contacts/send-email` now has full Outlook OAuth/Graph API support (was missing — only Gmail and SMTP were handled before)
- Token refresh with 401 retry, superadmin credential fallback, per-sender token support all working
- **Do not touch**: `sendViaMicrosoftGraph` function in `server/services/campaign-engine.ts`; Outlook Graph sending path in `/api/contacts/send-email` in `server/routes.ts`; Gmail sending code (already working, do not modify)

### 18. Enhanced Send Email from Contacts
- Send Email dialog in Contacts has three modes: Write (rich text editor), Template (select from existing), AI Write (generate with AI)
- Template mode loads both My Templates + Team Templates with search
- AI Write uses `/api/llm/generate` with quick prompt suggestions
- Rich text toolbar with Bold/Italic/Underline/Link/Lists/Variables
- Visual/HTML editor mode toggle
- Content syncs from contentEditable before sending
- **Do not touch**: send email dialog, `handleAiGenerate`, `applyTemplate`, `sendEmailEditorRef` in `client/src/pages/contacts-manager.tsx`

### 19. Database Safety (CRITICAL)
- **NEVER** add code that deletes, renames, moves, or recreates the database file
- **NEVER** add `integrity_check` or any pragma as a startup gate — Azure CIFS causes false failures
- **NEVER** add a "reset database" feature that actually deletes the DB file
- If the DB fails to open: **retry**, then **crash** — do NOT create a fresh DB over an existing file
- Backups are at `/home/data/backups/` on Azure — restore manually via Kudu SSH if needed
- See `DATABASE-RECOVERY.md` for full restore procedure
- **Do not touch**: database initialization code in `server/storage.ts` (lines 53–137), the `autoRestoreBackup` function, or the backup mechanism

### 20. Campaign Engine Improvements
- Step delays are now relative to previous step's sentAt (not step 0)
- Schedule shifting via `getNextValidSendTime()` for blocked days/hours
- Reply re-check on resume using pre-loaded `repliedContactIds` set
- DST-aware timezone using IANA names with `toLocaleString()` fallback
- ±30s jitter on delay between emails
- **Do not touch**: `evaluateFollowupTrigger`, `getNextValidSendTime`, `checkSendingWindow` in `server/services/followup-engine.ts`; `getUserLocalTime`, `checkSendingWindow`, `msUntilNextSendWindow`, reply re-check logic in `server/services/campaign-engine.ts`

### 21. Follow-up Email Threading (Outlook)
- Follow-up emails on Outlook appear in the same thread using In-Reply-To/References headers via Graph API `internetMessageHeaders`
- Retry-without-headers fallback for personal accounts that reject custom headers
- Gmail threading was already working via existing thread support
- **Do not touch**: Outlook threading block in `executeFollowup()` and `sendEmail()` in `server/services/followup-engine.ts`

### 22. Follow-up Personalization Parity
- Follow-up steps now have full 22+ personalization variables (same as Step 0)
- Dynamic case-insensitive regex replacement including custom fields
- Previously only 6 hardcoded variables were available in follow-ups
- **Do not touch**: `personalData` object and `personalizeText()` function in `server/services/followup-engine.ts`

### 23. Follow-up Sender Display Name
- Follow-up emails show proper display name (e.g., "Bharat AI Innovation") not raw email address
- Extracted from `smtpConfig.fromName` or `emailAccount.displayName`
- **Do not touch**: `senderDisplayName` extraction in `sendEmail()` in `server/services/followup-engine.ts`

### 24. Email Subject Encoding (RFC 2047)
- Special characters (smart quotes, em dashes) in subjects no longer garble as "Ã¢Â€Â™"
- `mimeEncodeSubject()` applies `=?UTF-8?B?<base64>?=` encoding at call sites
- Applied in both `campaign-engine.ts` and `followup-engine.ts`
- **Do not touch**: `mimeEncodeSubject()` in `server/services/campaign-engine.ts` and `server/services/followup-engine.ts`

### 25. Template Editor Rich Text
- Bullet points and numbered lists now work correctly in all editors
- `onMouseDown={e => e.preventDefault()}` on toolbar buttons prevents focus loss from contentEditable
- Tailwind list styling (`list-disc`, `list-decimal`, padding) applied to editor divs
- Font color picker and font family selector added to template editor toolbar
- AI email feedback bar with "Apply" button for one-click suggestion implementation
- Clear editor boundary with rounded border on gray background
- **Do not touch**: `TbBtn` component, `execCmd`, font color/family controls, AI feedback bar in `client/src/pages/template-manager.tsx`; same toolbar fixes in `campaign-creator.tsx`, `campaign-detail.tsx`, `contacts-manager.tsx`, `unified-inbox.tsx`

---

## General Rule

> If a feature is listed above as working, **do not refactor, restructure, or modify the underlying code** for that feature unless the user explicitly reports a bug in it and asks for a fix.
>
> When in doubt — **ask before changing**.
