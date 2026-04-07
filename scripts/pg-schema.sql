-- ============================================================
-- AImailPilot: PostgreSQL Schema
-- Migrated from SQLite (better-sqlite3) — 31 tables + indexes
-- Run against: aimailpilot-db.postgres.database.azure.com
-- Database: aimailpilot
-- ============================================================

-- 1. organizations
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  settings JSONB DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 2. users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  "firstName" TEXT,
  "lastName" TEXT,
  role TEXT DEFAULT 'admin',
  "organizationId" TEXT NOT NULL,
  "isActive" INTEGER DEFAULT 1,
  "isSuperAdmin" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 3. email_accounts
CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  provider TEXT,
  email TEXT NOT NULL,
  "displayName" TEXT,
  "smtpConfig" JSONB,
  "dailyLimit" INTEGER DEFAULT 500,
  "dailySent" INTEGER DEFAULT 0,
  "isActive" INTEGER DEFAULT 1,
  "userId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_accounts_org ON email_accounts("organizationId");
CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts("userId");

-- 4. llm_configs
CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  "isPrimary" INTEGER DEFAULT 0,
  "isActive" INTEGER DEFAULT 1,
  "monthlyCost" DOUBLE PRECISION DEFAULT 0,
  "monthlyLimit" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL
);

-- 5. contact_lists
CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'csv',
  headers JSONB DEFAULT '[]',
  "contactCount" INTEGER DEFAULT 0,
  "uploadedBy" TEXT,
  "uploadedByName" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 6. contacts (all columns including migrations)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  email TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  company TEXT,
  "jobTitle" TEXT,
  phone TEXT,
  "mobilePhone" TEXT,
  "linkedinUrl" TEXT,
  seniority TEXT,
  department TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  website TEXT,
  industry TEXT,
  "employeeCount" TEXT,
  "annualRevenue" TEXT,
  "companyLinkedinUrl" TEXT,
  "companyCity" TEXT,
  "companyState" TEXT,
  "companyCountry" TEXT,
  "companyAddress" TEXT,
  "companyPhone" TEXT,
  "secondaryEmail" TEXT,
  "homePhone" TEXT,
  "emailStatus" TEXT,
  "lastActivityDate" TEXT,
  status TEXT DEFAULT 'cold',
  score INTEGER DEFAULT 0,
  tags JSONB DEFAULT '[]',
  "customFields" JSONB DEFAULT '{}',
  source TEXT DEFAULT 'manual',
  "listId" TEXT,
  "assignedTo" TEXT,
  -- Email rating columns
  "emailRating" INTEGER DEFAULT 0,
  "emailRatingGrade" TEXT DEFAULT '',
  "emailRatingDetails" JSONB DEFAULT '{}',
  "emailRatingUpdatedAt" TEXT,
  -- Lead/CRM columns
  "leadStatus" TEXT DEFAULT '',
  unsubscribed INTEGER DEFAULT 0,
  "unsubscribedAt" TEXT,
  "bounceType" TEXT DEFAULT '',
  "bouncedAt" TEXT,
  "campaignHistory" JSONB DEFAULT '[]',
  "lastOpenedAt" TEXT,
  "lastClickedAt" TEXT,
  "lastRepliedAt" TEXT,
  "totalSent" INTEGER DEFAULT 0,
  "totalOpened" INTEGER DEFAULT 0,
  "totalClicked" INTEGER DEFAULT 0,
  "totalReplied" INTEGER DEFAULT 0,
  "totalBounced" INTEGER DEFAULT 0,
  -- Email verification
  "emailVerificationStatus" TEXT DEFAULT 'unverified',
  "emailVerifiedAt" TEXT,
  -- Pipeline/Deal
  "pipelineStage" TEXT DEFAULT 'new',
  "nextActionDate" TEXT,
  "nextActionType" TEXT,
  "dealValue" DOUBLE PRECISION DEFAULT 0,
  "dealClosedAt" TEXT,
  "dealNotes" TEXT DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts("organizationId");
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts("organizationId", email);
CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts("listId");
CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts("assignedTo");
CREATE INDEX IF NOT EXISTS idx_contacts_industry ON contacts(industry);
CREATE INDEX IF NOT EXISTS idx_contacts_city ON contacts(city);
CREATE INDEX IF NOT EXISTS idx_contacts_seniority ON contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_contacts_email_rating ON contacts("emailRating");
CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON contacts("leadStatus");
CREATE INDEX IF NOT EXISTS idx_contacts_unsubscribed ON contacts(unsubscribed);
CREATE INDEX IF NOT EXISTS idx_contacts_bounce ON contacts("bounceType");
CREATE INDEX IF NOT EXISTS idx_contacts_verification ON contacts("emailVerificationStatus");
CREATE INDEX IF NOT EXISTS idx_contacts_pipeline ON contacts("pipelineStage");
CREATE INDEX IF NOT EXISTS idx_contacts_next_action ON contacts("nextActionDate");
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts("organizationId", status);
CREATE INDEX IF NOT EXISTS idx_contacts_org_created ON contacts("organizationId", "createdAt");

-- 7. segments
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filters JSONB,
  "contactCount" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 8. templates
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  subject TEXT,
  content TEXT,
  variables JSONB DEFAULT '[]',
  "isPublic" INTEGER DEFAULT 1,
  "usageCount" INTEGER DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_org ON templates("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS idx_templates_created_by ON templates("createdBy");

-- 9. campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  "totalRecipients" INTEGER DEFAULT 0,
  "sentCount" INTEGER DEFAULT 0,
  "openedCount" INTEGER DEFAULT 0,
  "clickedCount" INTEGER DEFAULT 0,
  "repliedCount" INTEGER DEFAULT 0,
  "bouncedCount" INTEGER DEFAULT 0,
  "unsubscribedCount" INTEGER DEFAULT 0,
  subject TEXT,
  content TEXT,
  "emailAccountId" TEXT,
  "templateId" TEXT,
  "contactIds" JSONB DEFAULT '[]',
  "segmentId" TEXT,
  "scheduledAt" TEXT,
  "createdBy" TEXT,
  "sendingConfig" JSONB,
  "includeUnsubscribe" INTEGER DEFAULT 0,
  "trackOpens" INTEGER DEFAULT 1,
  "spamCount" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns("organizationId");
CREATE INDEX IF NOT EXISTS idx_campaigns_org_created ON campaigns("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns("createdBy");

-- 10. messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT,
  subject TEXT,
  content TEXT,
  status TEXT DEFAULT 'sending',
  "trackingId" TEXT,
  "emailAccountId" TEXT,
  "stepNumber" INTEGER DEFAULT 0,
  "sentAt" TEXT,
  "openedAt" TEXT,
  "clickedAt" TEXT,
  "repliedAt" TEXT,
  "errorMessage" TEXT,
  "providerMessageId" TEXT,
  "gmailThreadId" TEXT,
  "bouncedAt" TEXT,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages("campaignId");
CREATE INDEX IF NOT EXISTS idx_messages_tracking ON messages("trackingId");
CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages("providerMessageId");
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages("contactId");
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages("sentAt");
CREATE INDEX IF NOT EXISTS idx_messages_replied ON messages("repliedAt");
CREATE INDEX IF NOT EXISTS idx_messages_campaign_contact ON messages("campaignId", "contactId");
CREATE INDEX IF NOT EXISTS idx_messages_campaign_step ON messages("campaignId", "stepNumber");
CREATE INDEX IF NOT EXISTS idx_messages_campaign_status ON messages("campaignId", status);

-- 11. tracking_events
CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  "campaignId" TEXT,
  "messageId" TEXT,
  "contactId" TEXT,
  "trackingId" TEXT,
  url TEXT,
  "userAgent" TEXT,
  ip TEXT,
  metadata JSONB,
  "stepNumber" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON tracking_events("campaignId");
CREATE INDEX IF NOT EXISTS idx_events_message ON tracking_events("messageId");
CREATE INDEX IF NOT EXISTS idx_events_tracking ON tracking_events("trackingId");
CREATE INDEX IF NOT EXISTS idx_events_type ON tracking_events(type, "createdAt");
CREATE INDEX IF NOT EXISTS idx_events_step ON tracking_events("campaignId", "stepNumber");

-- 12. unsubscribes
CREATE TABLE IF NOT EXISTS unsubscribes (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT,
  email TEXT,
  "contactId" TEXT,
  "campaignId" TEXT,
  reason TEXT,
  "createdAt" TEXT NOT NULL
);

-- 13. integrations
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  type TEXT,
  name TEXT,
  "isActive" INTEGER DEFAULT 1,
  "lastSyncAt" TEXT,
  "syncCount" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 14. followup_sequences
CREATE TABLE IF NOT EXISTS followup_sequences (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  "isActive" INTEGER DEFAULT 1,
  "createdBy" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- 15. followup_steps
CREATE TABLE IF NOT EXISTS followup_steps (
  id TEXT PRIMARY KEY,
  "sequenceId" TEXT NOT NULL,
  "stepNumber" INTEGER DEFAULT 0,
  trigger TEXT,
  "delayDays" INTEGER DEFAULT 0,
  "delayHours" INTEGER DEFAULT 0,
  "delayMinutes" INTEGER DEFAULT 0,
  subject TEXT,
  content TEXT,
  "isActive" INTEGER DEFAULT 1,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_steps_seq ON followup_steps("sequenceId", "stepNumber");

-- 16. campaign_followups
CREATE TABLE IF NOT EXISTS campaign_followups (
  id TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL,
  "sequenceId" TEXT,
  "isActive" INTEGER DEFAULT 1,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_followups_active ON campaign_followups("isActive", "campaignId");

-- 17. followup_executions
CREATE TABLE IF NOT EXISTS followup_executions (
  id TEXT PRIMARY KEY,
  "campaignMessageId" TEXT,
  "stepId" TEXT,
  "contactId" TEXT,
  "campaignId" TEXT,
  status TEXT DEFAULT 'pending',
  "scheduledAt" TEXT,
  "executedAt" TEXT,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fexec_msg_step ON followup_executions("campaignMessageId", "stepId");
CREATE INDEX IF NOT EXISTS idx_fexec_contact ON followup_executions("contactId", status);
CREATE INDEX IF NOT EXISTS idx_fexec_campaign ON followup_executions("campaignId", status);
CREATE INDEX IF NOT EXISTS idx_fexec_status ON followup_executions(status, "scheduledAt");

-- 18. api_settings
CREATE TABLE IF NOT EXISTS api_settings (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "settingKey" TEXT NOT NULL,
  "settingValue" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("organizationId", "settingKey")
);
CREATE INDEX IF NOT EXISTS idx_api_settings_org ON api_settings("organizationId", "settingKey");

-- 19. unified_inbox
CREATE TABLE IF NOT EXISTS unified_inbox (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "campaignId" TEXT,
  "messageId" TEXT,
  "contactId" TEXT,
  "gmailMessageId" TEXT,
  "gmailThreadId" TEXT,
  "outlookMessageId" TEXT,
  "outlookConversationId" TEXT,
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "toEmail" TEXT,
  subject TEXT,
  snippet TEXT,
  body TEXT,
  "bodyHtml" TEXT,
  status TEXT DEFAULT 'unread',
  provider TEXT,
  "aiDraft" TEXT,
  "repliedAt" TEXT,
  "receivedAt" TEXT NOT NULL,
  "replyContent" TEXT,
  "repliedBy" TEXT,
  -- v12 fields
  "replyType" TEXT DEFAULT '',
  "bounceType" TEXT DEFAULT '',
  "threadId" TEXT,
  "inReplyTo" TEXT,
  "assignedTo" TEXT,
  "leadStatus" TEXT DEFAULT '',
  "isStarred" INTEGER DEFAULT 0,
  labels JSONB DEFAULT '[]',
  "sentByUs" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_org ON unified_inbox("organizationId", status);
CREATE INDEX IF NOT EXISTS idx_inbox_account ON unified_inbox("emailAccountId");
CREATE INDEX IF NOT EXISTS idx_inbox_campaign ON unified_inbox("campaignId");
CREATE INDEX IF NOT EXISTS idx_inbox_contact ON unified_inbox("contactId");
CREATE INDEX IF NOT EXISTS idx_inbox_received ON unified_inbox("receivedAt");
CREATE INDEX IF NOT EXISTS idx_inbox_gmail ON unified_inbox("gmailMessageId");
CREATE INDEX IF NOT EXISTS idx_inbox_outlook ON unified_inbox("outlookMessageId");
CREATE INDEX IF NOT EXISTS idx_inbox_thread ON unified_inbox("threadId");
CREATE INDEX IF NOT EXISTS idx_inbox_assigned ON unified_inbox("assignedTo");
CREATE INDEX IF NOT EXISTS idx_inbox_reply_type ON unified_inbox("replyType");
CREATE INDEX IF NOT EXISTS idx_inbox_lead_status ON unified_inbox("leadStatus");

-- 20. org_members
CREATE TABLE IF NOT EXISTS org_members (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  "isDefault" INTEGER DEFAULT 0,
  "joinedAt" TEXT NOT NULL,
  "invitedBy" TEXT,
  "createdAt" TEXT NOT NULL,
  UNIQUE("organizationId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members("userId");
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members("organizationId");
CREATE INDEX IF NOT EXISTS idx_org_members_default ON org_members("userId", "isDefault");

-- 21. org_invitations
CREATE TABLE IF NOT EXISTS org_invitations (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  "invitedBy" TEXT,
  token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  "expiresAt" TEXT NOT NULL,
  "acceptedAt" TEXT,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email, status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations("organizationId", status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token);

-- 22. contact_activities
CREATE TABLE IF NOT EXISTS contact_activities (
  id TEXT PRIMARY KEY,
  "contactId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  type TEXT NOT NULL DEFAULT 'note',
  outcome TEXT,
  notes TEXT,
  "nextActionDate" TEXT,
  "nextActionType" TEXT,
  metadata JSONB DEFAULT '{}',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON contact_activities("contactId");
CREATE INDEX IF NOT EXISTS idx_activities_org ON contact_activities("organizationId");
CREATE INDEX IF NOT EXISTS idx_activities_next ON contact_activities("nextActionDate");

-- 23. suppression_list
CREATE TABLE IF NOT EXISTS suppression_list (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  "bounceType" TEXT,
  source TEXT,
  "campaignId" TEXT,
  notes TEXT,
  "createdAt" TEXT NOT NULL,
  UNIQUE("organizationId", email)
);
CREATE INDEX IF NOT EXISTS idx_suppression_org ON suppression_list("organizationId", email);
CREATE INDEX IF NOT EXISTS idx_suppression_reason ON suppression_list("organizationId", reason);

-- 24. warmup_accounts
CREATE TABLE IF NOT EXISTS warmup_accounts (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  "dailyTarget" INTEGER DEFAULT 5,
  "currentDaily" INTEGER DEFAULT 0,
  "totalSent" INTEGER DEFAULT 0,
  "totalReceived" INTEGER DEFAULT 0,
  "inboxRate" DOUBLE PRECISION DEFAULT 0,
  "spamRate" DOUBLE PRECISION DEFAULT 0,
  "reputationScore" DOUBLE PRECISION DEFAULT 50,
  "startDate" TEXT NOT NULL,
  "lastWarmupAt" TEXT,
  settings JSONB DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warmup_org ON warmup_accounts("organizationId");
CREATE INDEX IF NOT EXISTS idx_warmup_email ON warmup_accounts("emailAccountId");

-- 25. warmup_logs
CREATE TABLE IF NOT EXISTS warmup_logs (
  id TEXT PRIMARY KEY,
  "warmupAccountId" TEXT NOT NULL,
  date TEXT NOT NULL,
  sent INTEGER DEFAULT 0,
  received INTEGER DEFAULT 0,
  "inboxCount" INTEGER DEFAULT 0,
  "spamCount" INTEGER DEFAULT 0,
  "bounceCount" INTEGER DEFAULT 0,
  "openCount" INTEGER DEFAULT 0,
  "replyCount" INTEGER DEFAULT 0,
  "sendPairs" JSONB DEFAULT '[]',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warmup_logs_acct ON warmup_logs("warmupAccountId", date);

-- 26. email_history
CREATE TABLE IF NOT EXISTS email_history (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  provider TEXT,
  "externalId" TEXT,
  "threadId" TEXT,
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "toEmail" TEXT,
  subject TEXT,
  snippet TEXT,
  direction TEXT NOT NULL DEFAULT 'received',
  "receivedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_history_org ON email_history("organizationId", "receivedAt");
CREATE INDEX IF NOT EXISTS idx_email_history_account ON email_history("emailAccountId", "receivedAt");
CREATE INDEX IF NOT EXISTS idx_email_history_thread ON email_history("threadId");
CREATE INDEX IF NOT EXISTS idx_email_history_external ON email_history("externalId");
CREATE INDEX IF NOT EXISTS idx_email_history_from ON email_history("fromEmail");

-- 27. lead_opportunities
CREATE TABLE IF NOT EXISTS lead_opportunities (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "contactEmail" TEXT NOT NULL,
  "contactName" TEXT,
  company TEXT,
  bucket TEXT NOT NULL DEFAULT 'unknown',
  confidence INTEGER DEFAULT 0,
  "aiReasoning" TEXT,
  "suggestedAction" TEXT,
  "lastEmailDate" TEXT,
  "totalEmails" INTEGER DEFAULT 0,
  "totalSent" INTEGER DEFAULT 0,
  "totalReceived" INTEGER DEFAULT 0,
  "sampleSubjects" JSONB DEFAULT '[]',
  "sampleSnippets" JSONB DEFAULT '[]',
  status TEXT DEFAULT 'new',
  "reviewedAt" TEXT,
  "reviewedBy" TEXT,
  "accountEmail" TEXT DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_opps_org ON lead_opportunities("organizationId", bucket);
CREATE INDEX IF NOT EXISTS idx_lead_opps_email ON lead_opportunities("contactEmail");
CREATE INDEX IF NOT EXISTS idx_lead_opps_status ON lead_opportunities("organizationId", status);

-- 28. contact_activity (timeline)
CREATE TABLE IF NOT EXISTS contact_activity (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  "campaignId" TEXT,
  "messageId" TEXT,
  metadata JSONB DEFAULT '{}',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_activity_contact ON contact_activity("contactId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_contact_activity_org ON contact_activity("organizationId");

-- 29. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  "linkUrl" TEXT,
  "isRead" INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications("userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications("organizationId", "createdAt");

-- 30. org_documents
CREATE TABLE IF NOT EXISTS org_documents (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  name TEXT NOT NULL,
  "docType" TEXT NOT NULL DEFAULT 'general',
  source TEXT NOT NULL DEFAULT 'upload',
  content TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  "fileSize" INTEGER DEFAULT 0,
  "mimeType" TEXT DEFAULT '',
  "uploadedBy" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_docs_org ON org_documents("organizationId", "docType");

-- PostgreSQL full-text search (replaces SQLite FTS5)
ALTER TABLE org_documents ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_org_docs_fts ON org_documents USING GIN(search_vector);

-- Auto-update search vector on insert/update
CREATE OR REPLACE FUNCTION org_documents_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' ||
    coalesce(NEW.content, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(NEW.tags::text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS org_documents_fts_trigger ON org_documents;
CREATE TRIGGER org_documents_fts_trigger
  BEFORE INSERT OR UPDATE ON org_documents
  FOR EACH ROW EXECUTE FUNCTION org_documents_search_update();

-- 31. email_attachments
CREATE TABLE IF NOT EXISTS email_attachments (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT,
  "campaignId" TEXT,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER DEFAULT 0,
  "mimeType" TEXT DEFAULT '',
  content TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
