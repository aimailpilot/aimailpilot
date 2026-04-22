// PostgreSQL storage layer for AImailPilot
// Drop-in replacement for DatabaseStorage (SQLite) using node-postgres connection pool
// All methods maintain the EXACT same interface as server/storage.ts DatabaseStorage class

import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';

// ========== Connection Pool ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('azure') ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,  // fail fast — 5s per attempt
  query_timeout: 30000,           // max 30s per query
});

pool.on('error', (err) => {
  console.error('[PG] Unexpected pool error:', err);
});

// Raise work_mem per connection so large sorts (reply-matching 50k-row queries)
// stay in RAM instead of spilling to disk. Server default is 4MB; 32MB covers
// the ~10MB sort with headroom. Per-connection × pool max 10 = 320MB ceiling.
pool.on('connect', (client) => {
  client.query("SET work_mem = '32MB'").catch((e) => {
    console.error('[PG] Failed to set work_mem:', e instanceof Error ? e.message : e);
  });
});

// ========== Helpers ==========
function genId(): string { return crypto.randomUUID(); }
function now(): string { return new Date().toISOString(); }
function toJson(v: any): string { return typeof v === 'string' ? v : JSON.stringify(v ?? null); }
function fromJson(v: any): any {
  if (v == null) return v;
  if (typeof v === 'object') return v; // PostgreSQL JSONB already parsed
  try { return JSON.parse(v); } catch { return v; }
}
function toSqlDate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

// Hydrate functions — parse JSONB columns (PG may return objects already)
function hydrateContact(r: any) {
  if (!r) return null;
  return { ...r, tags: fromJson(r.tags) || [], customFields: fromJson(r.customFields) || {}, emailRatingDetails: fromJson(r.emailRatingDetails) || {}, campaignHistory: fromJson(r.campaignHistory) || [] };
}
function hydrateCampaign(r: any) {
  if (!r) return null;
  return { ...r, contactIds: fromJson(r.contactIds) || [], sendingConfig: fromJson(r.sendingConfig) || null };
}
function hydrateTemplate(r: any) {
  if (!r) return null;
  return { ...r, variables: fromJson(r.variables) || [] };
}
function hydrateAccount(r: any) {
  if (!r) return null;
  return { ...r, smtpConfig: fromJson(r.smtpConfig) };
}
function hydrateEvent(r: any) {
  if (!r) return null;
  return { ...r, metadata: fromJson(r.metadata) };
}
function hydrateList(r: any) {
  if (!r) return null;
  return { ...r, headers: fromJson(r.headers) || [] };
}
function hydrateSegment(r: any) {
  if (!r) return null;
  return { ...r, filters: fromJson(r.filters) };
}

// Helper: generate $1, $2, ... placeholders for an array
function placeholders(arr: any[], startAt: number = 1): string {
  return arr.map((_, i) => `$${startAt + i}`).join(', ');
}

// Slow query threshold (ms) — log queries exceeding this
const SLOW_QUERY_MS = 500;

async function runQuery(sql: string, params: any[] = []) {
  const start = Date.now();
  const result = await pool.query(sql, params);
  const ms = Date.now() - start;
  if (ms > SLOW_QUERY_MS) {
    const short = sql.replace(/\s+/g, ' ').trim().substring(0, 120);
    console.warn(`[PG-SLOW] ${ms}ms — ${short}`);
  }
  return result;
}

// Helper: single row from query result
async function queryOne(sql: string, params: any[] = []): Promise<any> {
  const { rows } = await runQuery(sql, params);
  return rows[0] || null;
}

// Helper: all rows from query result
async function queryAll(sql: string, params: any[] = []): Promise<any[]> {
  const { rows } = await runQuery(sql, params);
  return rows;
}

// Helper: execute a statement
async function execute(sql: string, params: any[] = []): Promise<any> {
  return runQuery(sql, params);
}

// ========== SCHEMA INITIALIZATION ==========
async function initializeSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT,
        settings JSONB DEFAULT '{}',
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT,
        provider TEXT,
        email TEXT NOT NULL,
        "displayName" TEXT,
        "smtpConfig" JSONB,
        "dailyLimit" INTEGER DEFAULT 500,
        "dailySent" INTEGER DEFAULT 0,
        "isActive" INTEGER DEFAULT 1,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_configs (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        "isPrimary" INTEGER DEFAULT 0,
        "isActive" INTEGER DEFAULT 1,
        "monthlyCost" REAL DEFAULT 0,
        "monthlyLimit" INTEGER DEFAULT 0,
        "createdAt" TEXT NOT NULL
      );

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
        "emailRating" INTEGER DEFAULT 0,
        "emailRatingGrade" TEXT DEFAULT '',
        "emailRatingDetails" JSONB DEFAULT '{}',
        "emailRatingUpdatedAt" TEXT,
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
        "emailVerificationStatus" TEXT DEFAULT 'unverified',
        "emailVerifiedAt" TEXT,
        "pipelineStage" TEXT DEFAULT 'new',
        "nextActionDate" TEXT,
        "nextActionType" TEXT,
        "dealValue" REAL DEFAULT 0,
        "dealClosedAt" TEXT,
        "dealNotes" TEXT DEFAULT '',
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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
        "spamCount" INTEGER DEFAULT 0,
        subject TEXT,
        content TEXT,
        "emailAccountId" TEXT,
        "templateId" TEXT,
        "contactIds" JSONB DEFAULT '[]',
        "segmentId" TEXT,
        "scheduledAt" TEXT,
        "sendingConfig" JSONB,
        "includeUnsubscribe" INTEGER DEFAULT 0,
        "trackOpens" INTEGER DEFAULT 1,
        "createdBy" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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
        "bouncedAt" TEXT,
        "errorMessage" TEXT,
        "providerMessageId" TEXT,
        "gmailThreadId" TEXT,
        "createdAt" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracking_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        "campaignId" TEXT,
        "messageId" TEXT,
        "contactId" TEXT,
        "trackingId" TEXT,
        "stepNumber" INTEGER DEFAULT 0,
        url TEXT,
        "userAgent" TEXT,
        ip TEXT,
        metadata JSONB,
        "createdAt" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unsubscribes (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT,
        email TEXT,
        "contactId" TEXT,
        "campaignId" TEXT,
        reason TEXT,
        "createdAt" TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS campaign_followups (
        id TEXT PRIMARY KEY,
        "campaignId" TEXT NOT NULL,
        "sequenceId" TEXT,
        "isActive" INTEGER DEFAULT 1,
        "createdAt" TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS api_settings (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "settingKey" TEXT NOT NULL,
        "settingValue" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL,
        UNIQUE("organizationId", "settingKey")
      );

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
        "createdAt" TEXT NOT NULL,
        "replyContent" TEXT,
        "repliedBy" TEXT,
        "replyType" TEXT DEFAULT '',
        "bounceType" TEXT DEFAULT '',
        "threadId" TEXT,
        "inReplyTo" TEXT,
        "assignedTo" TEXT,
        "leadStatus" TEXT DEFAULT '',
        "isStarred" INTEGER DEFAULT 0,
        labels JSONB DEFAULT '[]',
        "sentByUs" INTEGER DEFAULT 0,
        "forwardedAt" TEXT,
        "forwardedTo" TEXT,
        "forwardedFrom" TEXT,
        "forwardedBy" TEXT
      );

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

      CREATE TABLE IF NOT EXISTS warmup_accounts (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "emailAccountId" TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        "dailyTarget" INTEGER DEFAULT 5,
        "currentDaily" INTEGER DEFAULT 0,
        "totalSent" INTEGER DEFAULT 0,
        "totalReceived" INTEGER DEFAULT 0,
        "inboxRate" REAL DEFAULT 0,
        "spamRate" REAL DEFAULT 0,
        "reputationScore" REAL DEFAULT 50,
        "startDate" TEXT NOT NULL,
        "lastWarmupAt" TEXT,
        settings JSONB DEFAULT '{}',
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS lead_opportunities (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "emailAccountId" TEXT,
        "accountEmail" TEXT DEFAULT '',
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
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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
        search_vector TSVECTOR,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );

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
    `);

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts("organizationId", email)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts("listId")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts("assignedTo")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_industry ON contacts(industry)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_city ON contacts(city)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_seniority ON contacts(seniority)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_email_rating ON contacts("emailRating")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON contacts("leadStatus")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_unsubscribed ON contacts(unsubscribed)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_bounce ON contacts("bounceType")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_verification ON contacts("emailVerificationStatus")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_pipeline ON contacts("pipelineStage")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_next_action ON contacts("nextActionDate")',
      'CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts("organizationId", status)',
      'CREATE INDEX IF NOT EXISTS idx_contacts_org_created ON contacts("organizationId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_campaigns_org_created ON campaigns("organizationId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns("createdBy")',
      'CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages("campaignId")',
      'CREATE INDEX IF NOT EXISTS idx_messages_tracking ON messages("trackingId")',
      'CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages("contactId")',
      'CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)',
      'CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages("sentAt")',
      'CREATE INDEX IF NOT EXISTS idx_messages_replied ON messages("repliedAt")',
      'CREATE INDEX IF NOT EXISTS idx_messages_campaign_contact ON messages("campaignId", "contactId")',
      'CREATE INDEX IF NOT EXISTS idx_messages_campaign_step ON messages("campaignId", "stepNumber")',
      'CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages("providerMessageId")',
      'CREATE INDEX IF NOT EXISTS idx_messages_campaign_status ON messages("campaignId", status)',
      'CREATE INDEX IF NOT EXISTS idx_messages_campaign_created ON messages("campaignId", "createdAt" DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_sent_campaign ON messages("sentAt", "campaignId") WHERE status IN (\'sent\',\'failed\',\'sending\',\'bounced\')',
      'CREATE INDEX IF NOT EXISTS idx_messages_unreplied ON messages("sentAt", "campaignId") WHERE status = \'sent\' AND "repliedAt" IS NULL AND "providerMessageId" IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_events_campaign ON tracking_events("campaignId")',
      'CREATE INDEX IF NOT EXISTS idx_events_message ON tracking_events("messageId")',
      'CREATE INDEX IF NOT EXISTS idx_events_tracking ON tracking_events("trackingId")',
      'CREATE INDEX IF NOT EXISTS idx_events_type ON tracking_events(type, "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_events_step ON tracking_events("campaignId", "stepNumber")',
      'CREATE INDEX IF NOT EXISTS idx_api_settings_org ON api_settings("organizationId", "settingKey")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_org ON unified_inbox("organizationId", status)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_account ON unified_inbox("emailAccountId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_campaign ON unified_inbox("campaignId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_contact ON unified_inbox("contactId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_received ON unified_inbox("receivedAt")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_gmail ON unified_inbox("gmailMessageId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_outlook ON unified_inbox("outlookMessageId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_thread ON unified_inbox("threadId")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_assigned ON unified_inbox("assignedTo")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_reply_type ON unified_inbox("replyType")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_lead_status ON unified_inbox("leadStatus")',
      'CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members("userId")',
      'CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_org_members_default ON org_members("userId", "isDefault")',
      'CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email, status)',
      'CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations("organizationId", status)',
      'CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token)',
      'CREATE INDEX IF NOT EXISTS idx_fexec_msg_step ON followup_executions("campaignMessageId", "stepId")',
      'CREATE INDEX IF NOT EXISTS idx_fexec_contact ON followup_executions("contactId", status)',
      'CREATE INDEX IF NOT EXISTS idx_fexec_campaign ON followup_executions("campaignId", status)',
      'CREATE INDEX IF NOT EXISTS idx_fexec_status ON followup_executions(status, "scheduledAt")',
      'CREATE INDEX IF NOT EXISTS idx_campaign_followups_active ON campaign_followups("isActive", "campaignId")',
      'CREATE INDEX IF NOT EXISTS idx_followup_steps_seq ON followup_steps("sequenceId", "stepNumber")',
      'CREATE INDEX IF NOT EXISTS idx_activities_contact ON contact_activities("contactId")',
      'CREATE INDEX IF NOT EXISTS idx_activities_org ON contact_activities("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_activities_next ON contact_activities("nextActionDate")',
      'CREATE INDEX IF NOT EXISTS idx_suppression_org ON suppression_list("organizationId", email)',
      'CREATE INDEX IF NOT EXISTS idx_suppression_reason ON suppression_list("organizationId", reason)',
      'CREATE INDEX IF NOT EXISTS idx_warmup_org ON warmup_accounts("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_warmup_email ON warmup_accounts("emailAccountId")',
      'CREATE INDEX IF NOT EXISTS idx_warmup_logs_acct ON warmup_logs("warmupAccountId", date)',
      'CREATE INDEX IF NOT EXISTS idx_email_history_org ON email_history("organizationId", "receivedAt")',
      'CREATE INDEX IF NOT EXISTS idx_email_history_account ON email_history("emailAccountId", "receivedAt")',
      'CREATE INDEX IF NOT EXISTS idx_email_history_thread ON email_history("threadId")',
      'CREATE INDEX IF NOT EXISTS idx_email_history_external ON email_history("externalId")',
      'CREATE INDEX IF NOT EXISTS idx_email_history_from ON email_history("fromEmail")',
      'CREATE INDEX IF NOT EXISTS idx_lead_opps_org ON lead_opportunities("organizationId", bucket)',
      'CREATE INDEX IF NOT EXISTS idx_lead_opps_email ON lead_opportunities("contactEmail")',
      'CREATE INDEX IF NOT EXISTS idx_lead_opps_status ON lead_opportunities("organizationId", status)',
      'CREATE INDEX IF NOT EXISTS idx_contact_activity_contact ON contact_activity("contactId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_contact_activity_org ON contact_activity("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications("userId", "isRead", "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications("organizationId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS idx_org_docs_org ON org_documents("organizationId", "docType")',
      'CREATE INDEX IF NOT EXISTS idx_email_accounts_org ON email_accounts("organizationId")',
      'CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts("userId")',
      'CREATE INDEX IF NOT EXISTS idx_templates_org ON templates("organizationId", "updatedAt")',
      'CREATE INDEX IF NOT EXISTS idx_templates_created_by ON templates("createdBy")',
    ];

    for (const idx of indexes) {
      try { await client.query(idx); } catch (e) { /* index already exists */ }
    }

    // Create GIN index for org_documents search_vector
    try {
      await client.query('CREATE INDEX IF NOT EXISTS idx_org_docs_search ON org_documents USING GIN(search_vector)');
    } catch (e) { /* already exists */ }

    // Create trigger to auto-update search_vector on org_documents
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION org_docs_search_trigger() RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english', COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.summary, '') || ' ' || COALESCE(NEW.tags::text, ''));
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
      `);
      await client.query(`
        DO $$ BEGIN
          CREATE TRIGGER org_docs_search_update BEFORE INSERT OR UPDATE ON org_documents
          FOR EACH ROW EXECUTE FUNCTION org_docs_search_trigger();
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    } catch (e) { /* trigger already exists */ }

    // Ensure columns added after initial schema creation exist
    const alterColumns = [
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "forwardedAt" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "forwardedTo" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "forwardedFrom" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "forwardedBy" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "repliedBy" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "replyContent" TEXT',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "emailRating" INTEGER DEFAULT 0',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "emailRatingGrade" TEXT DEFAULT \'\'',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "emailRatingDetails" JSONB DEFAULT \'{}\'',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "emailRatingUpdatedAt" TEXT',
      'ALTER TABLE messages ADD COLUMN IF NOT EXISTS "recipientEmail" TEXT',
      'ALTER TABLE messages ADD COLUMN IF NOT EXISTS "messageId" TEXT',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "autoPaused" BOOLEAN DEFAULT FALSE',
      'ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS "allocatedTo" TEXT',
      'ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS "allocatedToName" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "meetingDetected" BOOLEAN DEFAULT FALSE',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "meetingPlatform" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "meetingAt" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "aiSuggestedWon" BOOLEAN DEFAULT FALSE',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "aiSuggestedMeeting" BOOLEAN DEFAULT FALSE',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "aiSuggestionReason" TEXT',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "replyQualityScore" INTEGER DEFAULT NULL',
      'ALTER TABLE unified_inbox ADD COLUMN IF NOT EXISTS "replyQualityLabel" TEXT DEFAULT NULL',
      'CREATE INDEX IF NOT EXISTS idx_inbox_meeting ON unified_inbox("organizationId", "meetingDetected")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_ai_won ON unified_inbox("organizationId", "aiSuggestedWon")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_ai_meeting ON unified_inbox("organizationId", "aiSuggestedMeeting")',
      'CREATE INDEX IF NOT EXISTS idx_inbox_reply_quality ON unified_inbox("organizationId", "replyQualityScore")',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "apolloContactId" TEXT',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "apolloLastSyncedAt" TEXT',
      'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "apolloListIds" JSONB DEFAULT \'[]\'',
      'CREATE INDEX IF NOT EXISTS idx_contacts_apollo_id ON contacts("organizationId", "apolloContactId")',
    ];
    for (const alt of alterColumns) {
      try { await client.query(alt); } catch (e) { /* column already exists */ }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS apollo_sync_jobs (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "triggeredBy" TEXT NOT NULL,
        "listIds" JSONB DEFAULT '[]',
        "listNames" JSONB DEFAULT '[]',
        "targetListId" TEXT,
        "overwriteMode" TEXT DEFAULT 'fill_blanks_only',
        status TEXT NOT NULL DEFAULT 'queued',
        "totalFound" INTEGER DEFAULT 0,
        processed INTEGER DEFAULT 0,
        "alreadyCurrent" INTEGER DEFAULT 0,
        enriched INTEGER DEFAULT 0,
        imported INTEGER DEFAULT 0,
        "errorMessage" TEXT,
        "startedAt" TEXT,
        "completedAt" TEXT,
        "createdAt" TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_apollo_jobs_org ON apollo_sync_jobs("organizationId", "createdAt" DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS apollo_usage_log (
        id TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        action TEXT NOT NULL,
        "creditsUsed" INTEGER DEFAULT 0,
        "contactsAffected" INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        "createdAt" TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_apollo_usage_org ON apollo_usage_log("organizationId", "createdAt" DESC);
    `);

    await client.query('COMMIT');
    console.log('[PG] Schema initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PG] Schema initialization failed:', e);
    throw e;
  } finally {
    client.release();
  }

  // Backfill allocatedTo/allocatedToName on contact_lists from existing contact assignedTo data
  try {
    await execute(`
      UPDATE contact_lists cl
      SET
        "allocatedTo"     = sub."assignedTo",
        "allocatedToName" = COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), u.email)
      FROM (
        SELECT "listId", "assignedTo"
        FROM contacts
        WHERE "assignedTo" IS NOT NULL AND "listId" IS NOT NULL
        GROUP BY "listId", "assignedTo"
        HAVING COUNT(*) = (SELECT COUNT(*) FROM contacts c2 WHERE c2."listId" = contacts."listId")
      ) sub
      JOIN users u ON u.id = sub."assignedTo"
      WHERE cl.id = sub."listId"
        AND cl."allocatedTo" IS NULL
    `);
    console.log('[PG] Backfilled allocatedTo/allocatedToName on contact_lists');
  } catch (e) {
    console.error('[PG] allocatedTo backfill error (non-fatal):', e);
  }

  // Backfill recipientEmail on messages where contactId still resolves to a contact
  try {
    const needsBackfill = await queryOne(`SELECT COUNT(*) as cnt FROM messages WHERE "recipientEmail" IS NULL AND "contactId" IS NOT NULL`);
    const cnt = parseInt((needsBackfill as any)?.cnt || '0');
    if (cnt > 0) {
      console.log(`[PG] Backfilling recipientEmail for ${cnt} messages...`);
      await execute(`
        UPDATE messages SET "recipientEmail" = c.email
        FROM contacts c WHERE messages."contactId" = c.id
        AND messages."recipientEmail" IS NULL
      `);
      const remaining = await queryOne(`SELECT COUNT(*) as cnt FROM messages WHERE "recipientEmail" IS NULL AND "contactId" IS NOT NULL`);
      console.log(`[PG] Backfill done. ${parseInt((remaining as any)?.cnt || '0')} messages still have no recipientEmail (orphaned contactIds)`);
    }
  } catch (e) {
    console.error('[PG] recipientEmail backfill error (non-fatal):', e);
  }

  // Backfill meetingDetected on unified_inbox for existing rows (one-time per row)
  // Runs in background — does not block server startup
  setTimeout(async () => {
    try {
      const { detectMeeting } = await import('./services/meeting-detector');
      const needs = await queryOne(`SELECT COUNT(*) as cnt FROM unified_inbox WHERE "meetingDetected" IS NULL OR ("meetingDetected" = FALSE AND "meetingPlatform" IS NULL)`);
      const total = parseInt((needs as any)?.cnt || '0');
      if (total === 0) return;
      console.log(`[PG] Meeting detection backfill: scanning ${total} inbox rows in background...`);
      let scanned = 0, hits = 0, offset = 0;
      const BATCH = 500;
      while (true) {
        const rows = await queryAll(
          `SELECT id, subject, body, "bodyHtml" FROM unified_inbox
           WHERE ("meetingDetected" IS NULL OR ("meetingDetected" = FALSE AND "meetingPlatform" IS NULL))
           ORDER BY "receivedAt" DESC LIMIT $1 OFFSET $2`,
          [BATCH, offset]
        );
        if (!rows.length) break;
        for (const r of rows) {
          const det = detectMeeting(r.subject, r.body, r.bodyHtml);
          if (det.detected) {
            await execute(
              'UPDATE unified_inbox SET "meetingDetected"=TRUE, "meetingPlatform"=$1, "meetingUrl"=$2, "meetingAt"=$3 WHERE id=$4',
              [det.platform, det.url, det.meetingAt, r.id]
            );
            hits++;
          } else {
            await execute('UPDATE unified_inbox SET "meetingDetected"=FALSE WHERE id=$1 AND "meetingDetected" IS NULL', [r.id]);
          }
          scanned++;
        }
        offset += rows.length;
        if (rows.length < BATCH) break;
        await new Promise(r => setTimeout(r, 100));
      }
      console.log(`[PG] Meeting backfill done: scanned=${scanned} hits=${hits}`);
    } catch (e) {
      console.error('[PG] Meeting backfill error (non-fatal):', e);
    }
  }, 30000);
}

// ========== PostgresStorage Class ==========
export class PostgresStorage {
  private initialized = false;

  async ensureInitialized() {
    if (!this.initialized) {
      await initializeSchema();
      this.initialized = true;
    }
  }

  // ========== Organization ==========
  async getOrganization(id: string) {
    return queryOne('SELECT * FROM organizations WHERE id = $1', [id]);
  }

  async createOrganization(org: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO organizations (id, name, domain, settings, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [id, org.name, org.domain || '', toJson(org.settings || {}), ts, ts]
    );
    return this.getOrganization(id);
  }

  // ========== Users ==========
  async getUser(id: string) { return queryOne('SELECT * FROM users WHERE id = $1', [id]); }
  async getUserByEmail(email: string) { return queryOne('SELECT * FROM users WHERE email = $1', [email]); }

  async createUser(user: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO users (id, email, "firstName", "lastName", role, "organizationId", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, user.email, user.firstName || '', user.lastName || '', user.role || 'admin', user.organizationId, user.isActive ? 1 : 0, ts, ts]
    );
    return this.getUser(id);
  }

  async updateUser(id: string, data: any) {
    const existing = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!existing) throw new Error('User not found');
    const merged = { ...existing, ...data, updatedAt: now() };
    await execute(
      'UPDATE users SET "firstName"=$1, "lastName"=$2, role=$3, "isActive"=$4, "updatedAt"=$5 WHERE id=$6',
      [merged.firstName, merged.lastName, merged.role, merged.isActive ? 1 : 0, merged.updatedAt, id]
    );
    return this.getUser(id);
  }

  // ========== Email Accounts ==========
  async getEmailAccounts(organizationId: string) {
    return (await queryAll('SELECT * FROM email_accounts WHERE "organizationId" = $1', [organizationId])).map(hydrateAccount);
  }

  async getEmailAccountsForUser(organizationId: string, userId: string) {
    return (await queryAll('SELECT * FROM email_accounts WHERE "organizationId" = $1 AND "userId" = $2', [organizationId, userId])).map(hydrateAccount);
  }

  async getEmailAccount(id: string) { return hydrateAccount(await queryOne('SELECT * FROM email_accounts WHERE id = $1', [id])); }

  async getEmailAccountByEmail(organizationId: string, email: string) {
    return hydrateAccount(await queryOne('SELECT * FROM email_accounts WHERE "organizationId" = $1 AND email = $2', [organizationId, email]));
  }

  async findEmailAccountByEmail(email: string) {
    return hydrateAccount(await queryOne('SELECT * FROM email_accounts WHERE email = $1 LIMIT 1', [email]));
  }

  async createEmailAccount(account: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO email_accounts (id, "organizationId", "userId", provider, email, "displayName", "smtpConfig", "dailyLimit", "dailySent", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, account.organizationId, account.userId || null, account.provider || 'custom', account.email, account.displayName || account.email, toJson(account.smtpConfig), account.dailyLimit || 500, 0, 1, ts, ts]
    );
    return this.getEmailAccount(id);
  }

  async updateEmailAccount(id: string, data: any) {
    const existing = await this.getEmailAccount(id);
    if (!existing) throw new Error('Email account not found');
    const merged = { ...existing, ...data };
    await execute(
      'UPDATE email_accounts SET "displayName"=$1, "smtpConfig"=$2, "dailyLimit"=$3, "dailySent"=$4, "isActive"=$5, provider=$6, "updatedAt"=$7 WHERE id=$8',
      [merged.displayName, toJson(merged.smtpConfig), merged.dailyLimit, merged.dailySent, merged.isActive ? 1 : 0, merged.provider || existing.provider, now(), id]
    );
    return this.getEmailAccount(id);
  }

  async deleteEmailAccount(id: string) { await execute('DELETE FROM email_accounts WHERE id = $1', [id]); return true; }

  async assignEmailAccountToUser(id: string, userId: string) {
    await execute('UPDATE email_accounts SET "userId" = $1, "updatedAt" = $2 WHERE id = $3', [userId, now(), id]);
    return this.getEmailAccount(id);
  }

  async incrementDailySent(id: string, count: number = 1) {
    await execute('UPDATE email_accounts SET "dailySent" = "dailySent" + $1, "updatedAt" = $2 WHERE id = $3', [count, now(), id]);
  }

  async resetDailySentAll() {
    await execute('UPDATE email_accounts SET "dailySent" = 0, "updatedAt" = $1', [now()]);
  }

  async getAvailableEmailAccounts(organizationId: string) {
    return (await queryAll('SELECT * FROM email_accounts WHERE "organizationId" = $1 AND "isActive" = 1 AND "dailySent" < "dailyLimit" ORDER BY "dailySent" ASC', [organizationId])).map(hydrateAccount);
  }

  async getAvailableEmailAccountsForUser(organizationId: string, userId: string) {
    return (await queryAll('SELECT * FROM email_accounts WHERE "organizationId" = $1 AND "userId" = $2 AND "isActive" = 1 AND "dailySent" < "dailyLimit" ORDER BY "dailySent" ASC', [organizationId, userId])).map(hydrateAccount);
  }

  // ========== LLM Configurations ==========
  async getLlmConfigurations(organizationId: string) { return queryAll('SELECT * FROM llm_configs WHERE "organizationId" = $1', [organizationId]); }
  async getPrimaryLlmConfiguration(organizationId: string) { return queryOne('SELECT * FROM llm_configs WHERE "organizationId" = $1 AND "isPrimary" = 1 AND "isActive" = 1', [organizationId]); }

  async createLlmConfiguration(config: any) {
    const id = genId();
    await execute(
      'INSERT INTO llm_configs (id, "organizationId", provider, model, "isPrimary", "isActive", "monthlyCost", "monthlyLimit", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, config.organizationId, config.provider, config.model, config.isPrimary ? 1 : 0, config.isActive ? 1 : 0, config.monthlyCost || 0, config.monthlyLimit || 0, now()]
    );
    return queryOne('SELECT * FROM llm_configs WHERE id = $1', [id]);
  }

  async updateLlmConfiguration(id: string, data: any) {
    const existing = await queryOne('SELECT * FROM llm_configs WHERE id = $1', [id]);
    if (!existing) throw new Error('LLM config not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE llm_configs SET provider=$1, model=$2, "isPrimary"=$3, "isActive"=$4, "monthlyCost"=$5, "monthlyLimit"=$6 WHERE id=$7',
      [m.provider, m.model, m.isPrimary ? 1 : 0, m.isActive ? 1 : 0, m.monthlyCost, m.monthlyLimit, id]
    );
    return queryOne('SELECT * FROM llm_configs WHERE id = $1', [id]);
  }

  // ========== Contact Lists ==========
  async getContactLists(organizationId: string) {
    return (await queryAll('SELECT * FROM contact_lists WHERE "organizationId" = $1 ORDER BY "createdAt" DESC', [organizationId])).map(hydrateList);
  }

  async getContactListsForUser(organizationId: string, userId: string) {
    return (await queryAll(`
      SELECT DISTINCT cl.* FROM contact_lists cl
      WHERE cl."organizationId" = $1
        AND (
          cl."uploadedBy" = $2
          OR EXISTS (SELECT 1 FROM contacts c WHERE c."listId" = cl.id AND c."assignedTo" = $3)
        )
      ORDER BY cl."createdAt" DESC
    `, [organizationId, userId, userId])).map(hydrateList);
  }

  async getContactList(id: string) { return hydrateList(await queryOne('SELECT * FROM contact_lists WHERE id = $1', [id])); }

  async createContactList(list: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO contact_lists (id, "organizationId", name, source, headers, "contactCount", "uploadedBy", "uploadedByName", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, list.organizationId, list.name, list.source || 'csv', toJson(list.headers || []), list.contactCount || 0, list.uploadedBy || null, list.uploadedByName || null, ts, ts]
    );
    return this.getContactList(id);
  }

  async updateContactList(id: string, data: any) {
    const existing = await this.getContactList(id);
    if (!existing) throw new Error('Contact list not found');
    const m = { ...existing, ...data };
    await execute('UPDATE contact_lists SET name=$1, "contactCount"=$2, "updatedAt"=$3 WHERE id=$4', [m.name, m.contactCount, now(), id]);
    return this.getContactList(id);
  }

  async deleteContactList(id: string, deleteContacts = false) {
    if (deleteContacts) {
      await execute('DELETE FROM contacts WHERE "listId" = $1', [id]);
    }
    await execute('DELETE FROM contact_lists WHERE id = $1', [id]);
    return true;
  }

  // ========== Contacts ==========
  async getContacts(organizationId: string, limit = 50, offset = 0, filters?: { listId?: string; status?: string; assignedTo?: string }) {
    let sql = 'SELECT * FROM contacts WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ` AND ("assignedTo" IS NULL OR "assignedTo" = '')`; }
    else if (filters?.assignedTo) { sql += ` AND "assignedTo" = $${idx++}`; params.push(filters.assignedTo); }
    sql += ` ORDER BY "createdAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return (await queryAll(sql, params)).map(hydrateContact);
  }

  async getContactsCount(organizationId: string, filters?: { listId?: string; status?: string; assignedTo?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ` AND ("assignedTo" IS NULL OR "assignedTo" = '')`; }
    else if (filters?.assignedTo) { sql += ` AND "assignedTo" = $${idx++}`; params.push(filters.assignedTo); }
    const row = await queryOne(sql, params);
    return parseInt(row.c);
  }

  async getContact(id: string) { return hydrateContact(await queryOne('SELECT * FROM contacts WHERE id = $1', [id])); }

  async getContactsByIds(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const CHUNK = 500;
    const results: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(',');
      const rows = await queryAll(`SELECT * FROM contacts WHERE id IN (${ph})`, chunk);
      results.push(...rows.map(hydrateContact));
    }
    return results;
  }

  async getContactByEmail(organizationId: string, email: string) {
    return hydrateContact(await queryOne('SELECT * FROM contacts WHERE "organizationId" = $1 AND LOWER(email) = LOWER($2)', [organizationId, email]));
  }

  async createContact(contact: any) {
    const id = genId(); const ts = now();
    await execute(`INSERT INTO contacts (id, "organizationId", email, "firstName", "lastName", company, "jobTitle",
      phone, "mobilePhone", "linkedinUrl", seniority, department, city, state, country, website, industry,
      "employeeCount", "annualRevenue", "companyLinkedinUrl", "companyCity", "companyState", "companyCountry", "companyAddress",
      "companyPhone", "secondaryEmail", "homePhone", "emailStatus", "lastActivityDate", status, score, tags, "customFields", source, "listId", "assignedTo", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)`,
      [id, contact.organizationId, contact.email, contact.firstName || '', contact.lastName || '', contact.company || '', contact.jobTitle || '',
      contact.phone || '', contact.mobilePhone || '', contact.linkedinUrl || '', contact.seniority || '', contact.department || '',
      contact.city || '', contact.state || '', contact.country || '', contact.website || '', contact.industry || '',
      contact.employeeCount || '', contact.annualRevenue || '', contact.companyLinkedinUrl || '',
      contact.companyCity || '', contact.companyState || '', contact.companyCountry || '', contact.companyAddress || '',
      contact.companyPhone || '', contact.secondaryEmail || '', contact.homePhone || '', contact.emailStatus || '', contact.lastActivityDate || '',
      contact.status || 'cold', contact.score || 0, toJson(contact.tags || []), toJson(contact.customFields || {}),
      contact.source || 'manual', contact.listId || null, contact.assignedTo || null, ts, ts]
    );
    return this.getContact(id);
  }

  async createContactsBulk(contacts: any[], listId?: string) {
    const results: any[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const contact of contacts) {
        const existing = (await client.query('SELECT * FROM contacts WHERE "organizationId" = $1 AND email = $2', [contact.organizationId, contact.email])).rows[0];
        if (existing) {
          if (listId && !existing.listId) {
            await client.query('UPDATE contacts SET "listId" = $1, "updatedAt" = $2 WHERE id = $3', [listId, now(), existing.id]);
          }
          results.push({ ...hydrateContact(existing), _skipped: true });
          continue;
        }
        const id = genId(); const ts = now();
        await client.query(`INSERT INTO contacts (id, "organizationId", email, "firstName", "lastName", company, "jobTitle",
          phone, "mobilePhone", "linkedinUrl", seniority, department, city, state, country, website, industry,
          "employeeCount", "annualRevenue", "companyLinkedinUrl", "companyCity", "companyState", "companyCountry", "companyAddress",
          "companyPhone", "secondaryEmail", "homePhone", "emailStatus", "lastActivityDate", status, score, tags, "customFields", source, "listId", "assignedTo", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)`,
          [id, contact.organizationId, contact.email, contact.firstName || '', contact.lastName || '', contact.company || '', contact.jobTitle || '',
          contact.phone || '', contact.mobilePhone || '', contact.linkedinUrl || '', contact.seniority || '', contact.department || '',
          contact.city || '', contact.state || '', contact.country || '', contact.website || '', contact.industry || '',
          contact.employeeCount || '', contact.annualRevenue || '', contact.companyLinkedinUrl || '',
          contact.companyCity || '', contact.companyState || '', contact.companyCountry || '', contact.companyAddress || '',
          contact.companyPhone || '', contact.secondaryEmail || '', contact.homePhone || '', contact.emailStatus || '', contact.lastActivityDate || '',
          contact.status || 'cold', contact.score || 0, toJson(contact.tags || []), toJson(contact.customFields || {}),
          contact.source || 'import', listId || contact.listId || null, contact.assignedTo || null, ts, ts]
        );
        results.push({ id, ...contact, listId: listId || contact.listId || null, tags: contact.tags || [], customFields: contact.customFields || {} });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return results;
  }

  async updateContact(id: string, data: any) {
    const existing = await this.getContact(id);
    if (!existing) throw new Error('Contact not found');
    const m = { ...existing, ...data };
    await execute(`UPDATE contacts SET "firstName"=$1, "lastName"=$2, company=$3, "jobTitle"=$4,
      phone=$5, "mobilePhone"=$6, "linkedinUrl"=$7, seniority=$8, department=$9,
      city=$10, state=$11, country=$12, website=$13, industry=$14,
      "employeeCount"=$15, "annualRevenue"=$16, "companyLinkedinUrl"=$17,
      "companyCity"=$18, "companyState"=$19, "companyCountry"=$20, "companyAddress"=$21,
      "companyPhone"=$22, "secondaryEmail"=$23, "homePhone"=$24, "emailStatus"=$25, "lastActivityDate"=$26,
      status=$27, score=$28, tags=$29, "customFields"=$30, source=$31, "listId"=$32, "assignedTo"=$33, "updatedAt"=$34 WHERE id=$35`,
      [m.firstName, m.lastName, m.company, m.jobTitle,
      m.phone || '', m.mobilePhone || '', m.linkedinUrl || '', m.seniority || '', m.department || '',
      m.city || '', m.state || '', m.country || '', m.website || '', m.industry || '',
      m.employeeCount || '', m.annualRevenue || '', m.companyLinkedinUrl || '',
      m.companyCity || '', m.companyState || '', m.companyCountry || '', m.companyAddress || '',
      m.companyPhone || '', m.secondaryEmail || '', m.homePhone || '', m.emailStatus || '', m.lastActivityDate || '',
      m.status, m.score, toJson(m.tags), toJson(m.customFields), m.source, m.listId || null, m.assignedTo || null, now(), id]
    );
    return this.getContact(id);
  }

  async updateContactEmailRating(id: string, rating: number, grade: string, details: any) {
    await execute('UPDATE contacts SET "emailRating"=$1, "emailRatingGrade"=$2, "emailRatingDetails"=$3, "emailRatingUpdatedAt"=$4 WHERE id=$5',
      [rating, grade, toJson(details), now(), id]);
  }

  async getContactEngagementStats(contactId: string) {
    // First try by contactId, then fallback to email match if no messages found
    let stats = await queryOne(`
      SELECT
        COUNT(*) as "totalSent",
        SUM(CASE WHEN "openedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalOpened",
        SUM(CASE WHEN "clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalClicked",
        SUM(CASE WHEN "repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalReplied",
        MAX("sentAt") as "lastSentAt",
        MAX("openedAt") as "lastOpenedAt",
        MAX("clickedAt") as "lastClickedAt",
        MAX("repliedAt") as "lastRepliedAt"
      FROM messages WHERE "contactId" = $1
    `, [contactId]);

    // If no messages found by contactId, try matching by recipientEmail (handles re-imported contacts with new IDs)
    if (!stats || parseInt(stats.totalSent || 0) === 0) {
      try {
        const contact = await queryOne('SELECT email, "organizationId" FROM contacts WHERE id = $1', [contactId]);
        if (contact?.email) {
          // Match messages directly by recipientEmail column (backfilled from contacts)
          const emailStats = await queryOne(`
            SELECT
              COUNT(*) as "totalSent",
              SUM(CASE WHEN "openedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalOpened",
              SUM(CASE WHEN "clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalClicked",
              SUM(CASE WHEN "repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalReplied",
              MAX("sentAt") as "lastSentAt",
              MAX("openedAt") as "lastOpenedAt",
              MAX("clickedAt") as "lastClickedAt",
              MAX("repliedAt") as "lastRepliedAt"
            FROM messages
            WHERE LOWER("recipientEmail") = LOWER($1)
          `, [contact.email]);
          if (emailStats && parseInt(emailStats.totalSent || 0) > 0) {
            stats = emailStats;
          } else {
            // Second fallback: match via old contactIds that share the same email
            const oldIdStats = await queryOne(`
              SELECT
                COUNT(*) as "totalSent",
                SUM(CASE WHEN m."openedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalOpened",
                SUM(CASE WHEN m."clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalClicked",
                SUM(CASE WHEN m."repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as "totalReplied",
                MAX(m."sentAt") as "lastSentAt",
                MAX(m."openedAt") as "lastOpenedAt",
                MAX(m."clickedAt") as "lastClickedAt",
                MAX(m."repliedAt") as "lastRepliedAt"
              FROM messages m
              WHERE m."contactId" IN (
                SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) AND "organizationId" = $2
              )
            `, [contact.email, contact.organizationId]);
            if (oldIdStats && parseInt(oldIdStats.totalSent || 0) > 0) {
              stats = oldIdStats;
            }
          }
        }
      } catch (e) {
        // Fallback failed — use original stats (0)
      }
    }

    if (!stats) return { totalSent: 0, totalOpened: 0, totalClicked: 0, totalReplied: 0 };
    return {
      totalSent: parseInt(stats.totalSent || 0),
      totalOpened: parseInt(stats.totalOpened || 0),
      totalClicked: parseInt(stats.totalClicked || 0),
      totalReplied: parseInt(stats.totalReplied || 0),
      lastSentAt: stats.lastSentAt,
      lastOpenedAt: stats.lastOpenedAt,
      lastClickedAt: stats.lastClickedAt,
      lastRepliedAt: stats.lastRepliedAt,
    };
  }

  async getContactReplyContent(contactId: string) {
    const replies = await queryAll(`
      SELECT body, snippet, subject, "fromEmail", "receivedAt"
      FROM unified_inbox
      WHERE "contactId" = $1 AND (status = 'replied' OR "repliedAt" IS NOT NULL) AND body IS NOT NULL
      ORDER BY "receivedAt" DESC LIMIT 5
    `, [contactId]);
    const replyEvents = (await queryAll(`
      SELECT metadata, "createdAt" FROM tracking_events
      WHERE "contactId" = $1 AND type = 'reply'
      ORDER BY "createdAt" DESC LIMIT 5
    `, [contactId])).map(hydrateEvent);
    return { replies, replyEvents };
  }

  async deleteContact(id: string) { await execute('DELETE FROM contacts WHERE id = $1', [id]); return true; }

  async deleteContacts(ids: string[]) {
    if (ids.length === 0) return true;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query('DELETE FROM contacts WHERE id = $1', [id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return true;
  }

  async searchContacts(organizationId: string, query: string, filters?: { listId?: string; status?: string; assignedTo?: string }) {
    const q = `%${query.toLowerCase()}%`;
    let sql = `SELECT * FROM contacts WHERE "organizationId" = $1 AND (
      LOWER("firstName") ILIKE $2 OR LOWER("lastName") ILIKE $2 OR LOWER(email) ILIKE $2 OR
      LOWER(company) ILIKE $2 OR LOWER("jobTitle") ILIKE $2 OR tags::text ILIKE $2 OR "customFields"::text ILIKE $2 OR
      LOWER(phone) ILIKE $2 OR LOWER("mobilePhone") ILIKE $2 OR LOWER("linkedinUrl") ILIKE $2 OR
      LOWER(city) ILIKE $2 OR LOWER(state) ILIKE $2 OR LOWER(country) ILIKE $2 OR LOWER(industry) ILIKE $2 OR
      LOWER(seniority) ILIKE $2 OR LOWER(department) ILIKE $2 OR LOWER(website) ILIKE $2
    )`;
    const params: any[] = [organizationId, q];
    let idx = 3;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ` AND ("assignedTo" IS NULL OR "assignedTo" = '')`; }
    else if (filters?.assignedTo) { sql += ` AND "assignedTo" = $${idx++}`; params.push(filters.assignedTo); }
    sql += ' ORDER BY "createdAt" DESC LIMIT 100';
    return (await queryAll(sql, params)).map(hydrateContact);
  }

  async getContactsBySegment(segmentId: string) {
    const segment = await this.getContactSegment(segmentId);
    if (!segment || !segment.filters) return [];
    let sql = 'SELECT * FROM contacts WHERE "organizationId" = $1';
    const params: any[] = [segment.organizationId];
    let idx = 2;
    if (segment.filters.status) { sql += ` AND status = $${idx++}`; params.push(segment.filters.status); }
    if (segment.filters.tag) { sql += ` AND tags::text ILIKE $${idx++}`; params.push(`%${segment.filters.tag}%`); }
    return (await queryAll(sql, params)).map(hydrateContact);
  }

  // ========== Contact Segments ==========
  async getContactSegments(organizationId: string) { return (await queryAll('SELECT * FROM segments WHERE "organizationId" = $1', [organizationId])).map(hydrateSegment); }
  async getContactSegment(id: string) { return hydrateSegment(await queryOne('SELECT * FROM segments WHERE id = $1', [id])); }

  async createContactSegment(segment: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO segments (id, "organizationId", name, description, filters, "contactCount", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, segment.organizationId, segment.name, segment.description || '', toJson(segment.filters), segment.contactCount || 0, ts, ts]
    );
    return this.getContactSegment(id);
  }

  async updateContactSegment(id: string, data: any) {
    const existing = await this.getContactSegment(id);
    if (!existing) throw new Error('Segment not found');
    const m = { ...existing, ...data };
    await execute('UPDATE segments SET name=$1, description=$2, filters=$3, "contactCount"=$4, "updatedAt"=$5 WHERE id=$6',
      [m.name, m.description, toJson(m.filters), m.contactCount, now(), id]);
    return this.getContactSegment(id);
  }

  async deleteContactSegment(id: string) { await execute('DELETE FROM segments WHERE id = $1', [id]); return true; }

  // ========== Email Templates ==========
  async getEmailTemplates(organizationId: string) { return (await queryAll('SELECT * FROM templates WHERE "organizationId" = $1', [organizationId])).map(hydrateTemplate); }
  async getEmailTemplatesByUser(organizationId: string, userId: string) { return (await queryAll('SELECT * FROM templates WHERE "organizationId" = $1 AND "createdBy" = $2 ORDER BY "updatedAt" DESC', [organizationId, userId])).map(hydrateTemplate); }
  async getEmailTemplatesExcludingUser(organizationId: string, userId: string) { return (await queryAll('SELECT * FROM templates WHERE "organizationId" = $1 AND ("createdBy" IS NULL OR "createdBy" != $2) ORDER BY "updatedAt" DESC', [organizationId, userId])).map(hydrateTemplate); }
  async getPublicEmailTemplatesExcludingUser(organizationId: string, userId: string) { return (await queryAll('SELECT * FROM templates WHERE "organizationId" = $1 AND ("createdBy" IS NULL OR "createdBy" != $2) AND "isPublic" = 1 ORDER BY "updatedAt" DESC', [organizationId, userId])).map(hydrateTemplate); }
  async getEmailTemplate(id: string) { return hydrateTemplate(await queryOne('SELECT * FROM templates WHERE id = $1', [id])); }

  async createEmailTemplate(template: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO templates (id, "organizationId", name, category, subject, content, variables, "isPublic", "usageCount", "createdBy", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, template.organizationId, template.name, template.category || '', template.subject || '', template.content || '', toJson(template.variables || []), template.isPublic ? 1 : 0, 0, template.createdBy || null, ts, ts]
    );
    return this.getEmailTemplate(id);
  }

  async updateEmailTemplate(id: string, data: any) {
    const existing = await this.getEmailTemplate(id);
    if (!existing) throw new Error('Template not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE templates SET name=$1, category=$2, subject=$3, content=$4, variables=$5, "isPublic"=$6, "usageCount"=$7, "updatedAt"=$8 WHERE id=$9',
      [m.name, m.category, m.subject, m.content, toJson(m.variables), m.isPublic ? 1 : 0, m.usageCount, now(), id]
    );
    return this.getEmailTemplate(id);
  }

  async deleteEmailTemplate(id: string) { await execute('DELETE FROM templates WHERE id = $1', [id]); return true; }

  // ========== Lead Assignment (CRM) ==========
  async assignContactsToUser(contactIds: string[], userId: string, organizationId: string) {
    const client = await pool.connect();
    const ts = now();
    try {
      await client.query('BEGIN');
      for (const cid of contactIds) {
        await client.query('UPDATE contacts SET "assignedTo" = $1, "updatedAt" = $2 WHERE id = $3 AND "organizationId" = $4', [userId, ts, cid, organizationId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return contactIds.length;
  }

  async unassignContacts(contactIds: string[], organizationId: string) {
    const client = await pool.connect();
    const ts = now();
    try {
      await client.query('BEGIN');
      for (const cid of contactIds) {
        await client.query('UPDATE contacts SET "assignedTo" = NULL, "updatedAt" = $1 WHERE id = $2 AND "organizationId" = $3', [ts, cid, organizationId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return contactIds.length;
  }

  async assignContactsByList(listId: string, userId: string, organizationId: string, memberName?: string) {
    const result = await execute('UPDATE contacts SET "assignedTo" = $1, "updatedAt" = $2 WHERE "listId" = $3 AND "organizationId" = $4', [userId, now(), listId, organizationId]);
    await execute('UPDATE contact_lists SET "allocatedTo" = $1, "allocatedToName" = $2, "updatedAt" = $3 WHERE id = $4', [userId, memberName || null, now(), listId]);
    return result.rowCount;
  }

  async getContactsForUser(organizationId: string, userId: string, limit = 50, offset = 0, filters?: { listId?: string; status?: string }) {
    let sql = 'SELECT * FROM contacts WHERE "organizationId" = $1 AND "assignedTo" = $2';
    const params: any[] = [organizationId, userId];
    let idx = 3;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    sql += ` ORDER BY "createdAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return (await queryAll(sql, params)).map(hydrateContact);
  }

  async getContactsCountForUser(organizationId: string, userId: string, filters?: { listId?: string; status?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1 AND "assignedTo" = $2';
    const params: any[] = [organizationId, userId];
    let idx = 3;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    return parseInt((await queryOne(sql, params)).c);
  }

  async searchContactsForUser(organizationId: string, userId: string, query: string, filters?: { listId?: string; status?: string }) {
    const q = `%${query}%`;
    let sql = `SELECT * FROM contacts WHERE "organizationId" = $1 AND "assignedTo" = $2 AND (email ILIKE $3 OR "firstName" ILIKE $3 OR "lastName" ILIKE $3 OR company ILIKE $3)`;
    const params: any[] = [organizationId, userId, q];
    let idx = 4;
    if (filters?.listId) { sql += ` AND "listId" = $${idx++}`; params.push(filters.listId); }
    if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    sql += ' ORDER BY "createdAt" DESC LIMIT 200';
    return (await queryAll(sql, params)).map(hydrateContact);
  }

  async getAssignmentStats(organizationId: string) {
    const total = parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1', [organizationId])).c);
    const assigned = parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1 AND "assignedTo" IS NOT NULL', [organizationId])).c);
    const unassigned = total - assigned;
    const byUser = await queryAll(`
      SELECT c."assignedTo" as "userId", u.email, u."firstName", u."lastName", COUNT(*) as "contactCount"
      FROM contacts c LEFT JOIN users u ON c."assignedTo" = u.id
      WHERE c."organizationId" = $1 AND c."assignedTo" IS NOT NULL
      GROUP BY c."assignedTo", u.email, u."firstName", u."lastName" ORDER BY "contactCount" DESC
    `, [organizationId]);
    return { total, assigned, unassigned, byUser };
  }

  // ========== Campaigns ==========
  async getCampaigns(organizationId: string, limit = 20, offset = 0) {
    return (await queryAll('SELECT * FROM campaigns WHERE "organizationId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3', [organizationId, limit, offset])).map(hydrateCampaign);
  }

  async getCampaignsForUser(organizationId: string, userId: string, limit = 20, offset = 0) {
    return (await queryAll('SELECT * FROM campaigns WHERE "organizationId" = $1 AND "createdBy" = $2 ORDER BY "createdAt" DESC LIMIT $3 OFFSET $4', [organizationId, userId, limit, offset])).map(hydrateCampaign);
  }

  async getCampaign(id: string) { return hydrateCampaign(await queryOne('SELECT * FROM campaigns WHERE id = $1', [id])); }

  async createCampaign(campaign: any) {
    const id = genId(); const ts = now();
    await execute(
      `INSERT INTO campaigns (id, "organizationId", name, description, status, "totalRecipients", "sentCount", "openedCount", "clickedCount", "repliedCount", "bouncedCount", "unsubscribedCount", subject, content, "emailAccountId", "templateId", "contactIds", "segmentId", "scheduledAt", "createdBy", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 0, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, campaign.organizationId, campaign.name, campaign.description || '', campaign.status || 'draft', campaign.totalRecipients || 0,
      campaign.subject || '', campaign.content || '', campaign.emailAccountId || null, campaign.templateId || null,
      toJson(campaign.contactIds || []), campaign.segmentId || null, campaign.scheduledAt || null, campaign.createdBy || null, ts, ts]
    );
    return this.getCampaign(id);
  }

  async updateCampaign(id: string, data: any) {
    const existing = await this.getCampaign(id);
    if (!existing) throw new Error('Campaign not found');
    const cleanData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) cleanData[key] = value;
    }
    const m = { ...existing, ...cleanData };
    await execute(
      `UPDATE campaigns SET name=$1, description=$2, status=$3, "totalRecipients"=$4, "sentCount"=$5, "openedCount"=$6, "clickedCount"=$7, "repliedCount"=$8, "bouncedCount"=$9, "unsubscribedCount"=$10, subject=$11, content=$12, "emailAccountId"=$13, "templateId"=$14, "contactIds"=$15, "segmentId"=$16, "scheduledAt"=$17, "sendingConfig"=$18, "trackOpens"=$19, "includeUnsubscribe"=$20, "updatedAt"=$21, "autoPaused"=$22 WHERE id=$23`,
      [m.name, m.description, m.status, m.totalRecipients, m.sentCount, m.openedCount, m.clickedCount, m.repliedCount, m.bouncedCount, m.unsubscribedCount,
      m.subject, m.content, m.emailAccountId || null, m.templateId || null, toJson(m.contactIds), m.segmentId || null, toSqlDate(m.scheduledAt), toJson(m.sendingConfig), m.trackOpens ?? 1, m.includeUnsubscribe ?? 0, now(), m.autoPaused ?? false, id]
    );
    return this.getCampaign(id);
  }

  async deleteCampaign(id: string) { await execute('DELETE FROM campaigns WHERE id = $1', [id]); return true; }

  async getCampaignStats(organizationId: string) {
    const row = await queryOne(`SELECT
      COUNT(*) as "totalCampaigns",
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as "activeCampaigns",
      SUM("sentCount") as "totalSent", SUM("openedCount") as "totalOpened",
      SUM("clickedCount") as "totalClicked", SUM("repliedCount") as "totalReplied",
      SUM("bouncedCount") as "totalBounced", SUM("unsubscribedCount") as "totalUnsubscribed"
    FROM campaigns WHERE "organizationId" = $1`, [organizationId]);
    return {
      totalCampaigns: parseInt(row.totalCampaigns) || 0, activeCampaigns: parseInt(row.activeCampaigns) || 0,
      totalSent: parseInt(row.totalSent) || 0, totalOpened: parseInt(row.totalOpened) || 0,
      totalClicked: parseInt(row.totalClicked) || 0, totalReplied: parseInt(row.totalReplied) || 0,
      totalBounced: parseInt(row.totalBounced) || 0, totalUnsubscribed: parseInt(row.totalUnsubscribed) || 0,
    };
  }

  async getCampaignStatsForUser(organizationId: string, userId: string) {
    const row = await queryOne(`SELECT
      COUNT(*) as "totalCampaigns",
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as "activeCampaigns",
      SUM("sentCount") as "totalSent", SUM("openedCount") as "totalOpened",
      SUM("clickedCount") as "totalClicked", SUM("repliedCount") as "totalReplied",
      SUM("bouncedCount") as "totalBounced", SUM("unsubscribedCount") as "totalUnsubscribed"
    FROM campaigns WHERE "organizationId" = $1 AND "createdBy" = $2`, [organizationId, userId]);
    return {
      totalCampaigns: parseInt(row.totalCampaigns) || 0, activeCampaigns: parseInt(row.activeCampaigns) || 0,
      totalSent: parseInt(row.totalSent) || 0, totalOpened: parseInt(row.totalOpened) || 0,
      totalClicked: parseInt(row.totalClicked) || 0, totalReplied: parseInt(row.totalReplied) || 0,
      totalBounced: parseInt(row.totalBounced) || 0, totalUnsubscribed: parseInt(row.totalUnsubscribed) || 0,
    };
  }

  async getContactsCountForUserTotal(organizationId: string, userId: string) {
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1 AND "assignedTo" = $2', [organizationId, userId])).c);
  }

  // ========== Campaign Messages ==========
  async getCampaignMessages(campaignId: string, limit = 100, offset = 0) {
    return queryAll('SELECT * FROM messages WHERE "campaignId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3', [campaignId, limit, offset]);
  }

  async getCampaignMessage(id: string) { return queryOne('SELECT * FROM messages WHERE id = $1', [id]); }

  async getFailedMessagesByContact(contactId: string, limit = 5) {
    return queryAll(`SELECT "errorMessage" FROM messages WHERE "contactId" = $1 AND status = 'failed' AND "errorMessage" IS NOT NULL ORDER BY "createdAt" DESC LIMIT $2`, [contactId, limit]);
  }

  async getCampaignMessageByTracking(trackingId: string) { return queryOne('SELECT * FROM messages WHERE "trackingId" = $1', [trackingId]); }

  async getCampaignMessageByContactAndStep(campaignId: string, contactId: string, stepNumber: number) {
    return queryOne(`SELECT * FROM messages WHERE "campaignId" = $1 AND "contactId" = $2 AND "stepNumber" = $3 AND status = 'sent' ORDER BY "sentAt" DESC LIMIT 1`, [campaignId, contactId, stepNumber]);
  }

  async getCampaignMessageByContactEmailAndSubject(contactEmail: string, subject: string) {
    return queryOne(`
      SELECT m.* FROM messages m
      JOIN contacts c ON m."contactId" = c.id
      WHERE LOWER(c.email) = LOWER($1) AND LOWER(TRIM(m.subject)) = LOWER(TRIM($2)) AND m."repliedAt" IS NULL
      ORDER BY m."sentAt" DESC LIMIT 1
    `, [contactEmail, subject]);
  }

  async getCampaignMessageByProviderMessageId(providerMsgId: string) {
    return queryOne(`SELECT * FROM messages WHERE "providerMessageId" = $1 AND status = 'sent'`, [providerMsgId]);
  }

  async createCampaignMessage(message: any) {
    const id = genId();
    await execute(
      `INSERT INTO messages (id, "campaignId", "contactId", subject, content, status, "trackingId", "emailAccountId", "stepNumber", "sentAt", "openedAt", "clickedAt", "repliedAt", "bouncedAt", "errorMessage", "providerMessageId", "recipientEmail", "messageId", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [id, message.campaignId, message.contactId || null, message.subject || '', message.content || '', message.status || 'sending',
      message.trackingId || null, message.emailAccountId || null, message.stepNumber || 0,
      toSqlDate(message.sentAt), toSqlDate(message.openedAt), toSqlDate(message.clickedAt), toSqlDate(message.repliedAt), toSqlDate(message.bouncedAt), message.errorMessage || null, message.providerMessageId || null, message.recipientEmail || null, message.messageId || null, now()]
    );
    return this.getCampaignMessage(id);
  }

  async updateCampaignMessage(id: string, data: any) {
    const existing = await this.getCampaignMessage(id);
    if (!existing) throw new Error('Message not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE messages SET status=$1, "sentAt"=$2, "openedAt"=$3, "clickedAt"=$4, "repliedAt"=$5, "bouncedAt"=$6, "errorMessage"=$7, "providerMessageId"=$8, "gmailThreadId"=$9 WHERE id=$10',
      [m.status, toSqlDate(m.sentAt), toSqlDate(m.openedAt), toSqlDate(m.clickedAt), toSqlDate(m.repliedAt), toSqlDate(m.bouncedAt), m.errorMessage || null, m.providerMessageId || null, m.gmailThreadId || null, id]
    );
    return this.getCampaignMessage(id);
  }

  async deleteCampaignMessage(id: string) {
    await execute('DELETE FROM messages WHERE id = $1', [id]);
    return true;
  }

  // ========== Tracking Events ==========
  async createTrackingEvent(event: any) {
    const id = genId();
    await execute(
      'INSERT INTO tracking_events (id, type, "campaignId", "messageId", "contactId", "trackingId", "stepNumber", url, "userAgent", ip, metadata, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, event.type, event.campaignId || null, event.messageId || null, event.contactId || null, event.trackingId || null,
      event.stepNumber || 0, event.url || null, event.userAgent || null, event.ip || null, toJson(event.metadata), now()]
    );
    return { id, ...event, createdAt: now() };
  }

  async getTrackingEvents(campaignId: string) {
    return (await queryAll(`SELECT * FROM tracking_events WHERE "campaignId" = $1 AND type != 'prefetch' ORDER BY "createdAt" DESC`, [campaignId])).map(hydrateEvent);
  }

  async getRecentCampaignTrackingEvents(campaignId: string, limit = 50) {
    return (await queryAll(`SELECT * FROM tracking_events WHERE "campaignId" = $1 AND type != 'prefetch' ORDER BY "createdAt" DESC LIMIT $2`, [campaignId, limit])).map(hydrateEvent);
  }

  async getTrackingEventsByMessage(messageId: string) {
    return (await queryAll(`SELECT * FROM tracking_events WHERE "messageId" = $1 AND type != 'prefetch' ORDER BY "createdAt" ASC`, [messageId])).map(hydrateEvent);
  }

  async getAllTrackingEvents(organizationId: string, limit = 50) {
    return (await queryAll(`SELECT te.* FROM tracking_events te
      INNER JOIN campaigns c ON te."campaignId" = c.id
      WHERE c."organizationId" = $1 AND te.type != 'prefetch' ORDER BY te."createdAt" DESC LIMIT $2`, [organizationId, limit])).map(hydrateEvent);
  }

  async getRecentTrackingEvents(messageId: string, type: string, withinSeconds: number) {
    const cutoff = new Date(Date.now() - withinSeconds * 1000).toISOString();
    return queryAll(`SELECT * FROM tracking_events WHERE "messageId" = $1 AND type = $2 AND "createdAt" > $3 ORDER BY "createdAt" DESC`, [messageId, type, cutoff]);
  }

  // ========== Enriched Campaign Messages ==========
  async getCampaignMessagesEnriched(campaignId: string, limit = 200, offset = 0) {
    const messages = await queryAll('SELECT * FROM messages WHERE "campaignId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3', [campaignId, limit, offset]);
    if (messages.length === 0) return [];

    const messageIds = messages.map((m: any) => m.id);
    const CHUNK = 500;
    const allEvents: any[] = [];
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const chunk = messageIds.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(',');
      const rows = await queryAll(`SELECT * FROM tracking_events WHERE "messageId" IN (${ph}) AND type != 'prefetch' ORDER BY "createdAt" ASC`, chunk);
      allEvents.push(...rows.map(hydrateEvent));
    }
    const eventsByMessageId = new Map<string, any[]>();
    for (const evt of allEvents) {
      const arr = eventsByMessageId.get(evt.messageId) || [];
      arr.push(evt);
      eventsByMessageId.set(evt.messageId, arr);
    }

    const contactIds = messages.map((m: any) => m.contactId).filter(Boolean).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i);
    const contactMap = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const chunk = contactIds.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(',');
      const rows = await queryAll(`SELECT * FROM contacts WHERE id IN (${ph})`, chunk);
      for (const r of rows) { const c = hydrateContact(r); if (c) contactMap.set(c.id, c); }
    }

    return messages.map((m: any) => {
      const events = eventsByMessageId.get(m.id) || [];
      const contact = m.contactId ? contactMap.get(m.contactId) || null : null;
      return {
        ...m,
        contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
        events,
        openCount: events.filter((e: any) => {
          if (e.type !== 'open') return false;
          if (e.metadata && typeof e.metadata === 'string') { try { const meta = JSON.parse(e.metadata); if (meta.duplicate) return false; } catch {} }
          else if (e.metadata && e.metadata.duplicate) return false;
          return true;
        }).length,
        clickCount: events.filter((e: any) => e.type === 'click').length,
        replyCount: events.filter((e: any) => e.type === 'reply').length,
        firstOpenedAt: events.find((e: any) => e.type === 'open')?.createdAt || null,
        firstClickedAt: events.find((e: any) => e.type === 'click')?.createdAt || null,
        firstRepliedAt: events.find((e: any) => e.type === 'reply')?.createdAt || null,
      };
    });
  }

  async getCampaignMessagesTotalCount(campaignId: string) {
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM messages WHERE "campaignId" = $1', [campaignId])).c);
  }

  async getCampaignMessageStats(campaignId: string) {
    const row = await queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' OR status = 'sending' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'bounced' OR (status = 'failed' AND "errorMessage" ILIKE '%bounce%') THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN "openedAt" IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN "clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN "repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM messages WHERE "campaignId" = $1
    `, [campaignId]);
    return {
      total: parseInt(row.total) || 0, sent: parseInt(row.sent) || 0, bounced: parseInt(row.bounced) || 0,
      opened: parseInt(row.opened) || 0, clicked: parseInt(row.clicked) || 0, replied: parseInt(row.replied) || 0,
    };
  }

  async getCampaignStepStats(campaignId: string) {
    const rows = await queryAll(`
      SELECT
        COALESCE("stepNumber", 0) as "stepNumber",
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' OR status = 'sending' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'bounced' OR (status = 'failed' AND "errorMessage" ILIKE '%bounce%') THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN "openedAt" IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN "clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN "repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM messages WHERE "campaignId" = $1 GROUP BY COALESCE("stepNumber", 0) ORDER BY "stepNumber" ASC
    `, [campaignId]);
    return rows.map((r: any) => ({
      stepNumber: parseInt(r.stepNumber), sent: parseInt(r.sent) || 0, bounced: parseInt(r.bounced) || 0,
      opened: parseInt(r.opened) || 0, clicked: parseInt(r.clicked) || 0, replied: parseInt(r.replied) || 0,
    }));
  }

  async getCampaignMessagesFiltered(campaignId: string, limit = 25, offset = 0, filter = 'all', search = '') {
    let where = 'WHERE m."campaignId" = $1';
    const params: any[] = [campaignId];
    let idx = 2;

    if (filter === 'opened') where += ' AND m."openedAt" IS NOT NULL';
    else if (filter === 'clicked') where += ' AND m."clickedAt" IS NOT NULL';
    else if (filter === 'replied') where += ' AND m."repliedAt" IS NOT NULL';
    else if (filter === 'bounced') where += ` AND (m.status = 'bounced' OR m.status = 'failed')`;

    if (search) {
      where += ` AND (c.email ILIKE $${idx} OR c."firstName" ILIKE $${idx} OR c."lastName" ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const total = parseInt((await queryOne(
      `SELECT COUNT(*) as cnt FROM messages m LEFT JOIN contacts c ON m."contactId" = c.id ${where}`, params
    )).cnt);

    const messages = await queryAll(
      `SELECT m.* FROM messages m LEFT JOIN contacts c ON m."contactId" = c.id ${where} ORDER BY m."createdAt" DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const messageIds = messages.map((m: any) => m.id);
    const CHUNK = 500;
    const allEvents: any[] = [];
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const chunk = messageIds.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(',');
      allEvents.push(...(await queryAll(`SELECT * FROM tracking_events WHERE "messageId" IN (${ph}) AND type != 'prefetch' ORDER BY "createdAt" ASC`, chunk)).map(hydrateEvent));
    }
    const eventsByMsgId = new Map<string, any[]>();
    for (const evt of allEvents) { const arr = eventsByMsgId.get(evt.messageId) || []; arr.push(evt); eventsByMsgId.set(evt.messageId, arr); }

    const contactIds = messages.map((m: any) => m.contactId).filter(Boolean).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i);
    const contactMap = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const chunk = contactIds.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(',');
      for (const r of await queryAll(`SELECT * FROM contacts WHERE id IN (${ph})`, chunk)) {
        const c = hydrateContact(r); if (c) contactMap.set(c.id, c);
      }
    }

    const enriched = messages.map((m: any) => {
      const events = eventsByMsgId.get(m.id) || [];
      const contact = m.contactId ? contactMap.get(m.contactId) || null : null;
      return {
        ...m,
        contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
        events,
        openCount: events.filter((e: any) => {
          if (e.type !== 'open') return false;
          if (e.metadata && typeof e.metadata === 'string') { try { const meta = JSON.parse(e.metadata); if (meta.duplicate) return false; } catch {} }
          else if (e.metadata && e.metadata.duplicate) return false;
          return true;
        }).length,
        clickCount: events.filter((e: any) => e.type === 'click').length,
        replyCount: events.filter((e: any) => e.type === 'reply').length,
        firstOpenedAt: events.find((e: any) => e.type === 'open')?.createdAt || null,
        firstClickedAt: events.find((e: any) => e.type === 'click')?.createdAt || null,
        firstRepliedAt: events.find((e: any) => e.type === 'reply')?.createdAt || null,
      };
    });

    return { messages: enriched, total };
  }

  async getUnopenedCampaignMessages(orgId: string, cutoff: string) {
    return queryAll(`
      SELECT m.* FROM messages m
      INNER JOIN campaigns c ON m."campaignId" = c.id
      WHERE c."organizationId" = $1
      AND m.status = 'sent'
      AND m."openedAt" IS NULL
      AND m."sentAt" >= $2
      AND m."providerMessageId" IS NOT NULL
      ORDER BY m."sentAt" DESC
      LIMIT 2000
    `, [orgId, cutoff]);
  }

  async getUnrepliedCampaignMessages(orgId: string) {
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    return queryAll(`
      SELECT
        m.id, m."campaignId", m."contactId", m."providerMessageId", m."gmailThreadId",
        m."trackingId", m."stepNumber", m.status, m."sentAt", m."repliedAt",
        m."recipientEmail", m."bouncedAt",
        ct.email as "contactEmail", c.name as "campaignName"
      FROM messages m
      INNER JOIN campaigns c ON m."campaignId" = c.id
      LEFT JOIN contacts ct ON m."contactId" = ct.id
      WHERE c."organizationId" = $1
      AND m.status = 'sent'
      AND m."repliedAt" IS NULL
      AND m."providerMessageId" IS NOT NULL
      AND m."sentAt" >= $2
      ORDER BY m."sentAt" DESC
      LIMIT 5000
    `, [orgId, cutoff]);
  }

  async getAllRecentCampaignMessages(orgId: string) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    return queryAll(`
      SELECT
        m.id, m."campaignId", m."contactId", m."providerMessageId", m."gmailThreadId",
        m."trackingId", m."stepNumber", m.status, m."sentAt", m."repliedAt",
        m."recipientEmail", m."bouncedAt",
        ct.email as "contactEmail", c.name as "campaignName"
      FROM messages m
      INNER JOIN campaigns c ON m."campaignId" = c.id
      LEFT JOIN contacts ct ON m."contactId" = ct.id
      WHERE c."organizationId" = $1
      AND m.status IN ('sent', 'failed', 'sending', 'bounced')
      AND m."providerMessageId" IS NOT NULL
      AND m."sentAt" >= $2
      ORDER BY m."sentAt" DESC
      LIMIT 50000
    `, [orgId, cutoff]);
  }

  // ========== Unsubscribes ==========
  async addUnsubscribe(data: any) {
    const id = genId();
    await execute(
      'INSERT INTO unsubscribes (id, "organizationId", email, "contactId", "campaignId", reason, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, data.organizationId || null, data.email || null, data.contactId || null, data.campaignId || null, data.reason || null, now()]
    );
    if (data.contactId) {
      await execute(`UPDATE contacts SET status = 'unsubscribed' WHERE id = $1`, [data.contactId]);
    }
    return { id, ...data, createdAt: now() };
  }

  async isUnsubscribed(organizationId: string, email: string) {
    return !!(await queryOne('SELECT 1 FROM unsubscribes WHERE "organizationId" = $1 AND email = $2', [organizationId, email]));
  }

  async getUnsubscribes(organizationId: string) {
    return queryAll('SELECT * FROM unsubscribes WHERE "organizationId" = $1', [organizationId]);
  }

  // ========== Integrations ==========
  async getIntegrations(organizationId: string) { return queryAll('SELECT * FROM integrations WHERE "organizationId" = $1', [organizationId]); }
  async getIntegration(id: string) { return queryOne('SELECT * FROM integrations WHERE id = $1', [id]); }

  async createIntegration(integration: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO integrations (id, "organizationId", type, name, "isActive", "syncCount", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 0, $6, $7)',
      [id, integration.organizationId, integration.type, integration.name, integration.isActive ? 1 : 0, ts, ts]
    );
    return this.getIntegration(id);
  }

  async updateIntegration(id: string, data: any) {
    const existing = await this.getIntegration(id);
    if (!existing) throw new Error('Integration not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE integrations SET name=$1, "isActive"=$2, "lastSyncAt"=$3, "syncCount"=$4, "updatedAt"=$5 WHERE id=$6',
      [m.name, m.isActive ? 1 : 0, m.lastSyncAt, m.syncCount, now(), id]
    );
    return this.getIntegration(id);
  }

  // ========== Follow-up Sequences ==========
  async getFollowupSequences(organizationId: string) { return queryAll('SELECT * FROM followup_sequences WHERE "organizationId" = $1', [organizationId]); }
  async getFollowupSequence(id: string) { return queryOne('SELECT * FROM followup_sequences WHERE id = $1', [id]); }

  async createFollowupSequence(sequence: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO followup_sequences (id, "organizationId", name, description, "isActive", "createdBy", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 1, $5, $6, $7)',
      [id, sequence.organizationId, sequence.name, sequence.description || '', sequence.createdBy || null, ts, ts]
    );
    return this.getFollowupSequence(id);
  }

  async updateFollowupSequence(id: string, data: any) {
    const existing = await this.getFollowupSequence(id);
    if (!existing) throw new Error('Sequence not found');
    const m = { ...existing, ...data };
    await execute('UPDATE followup_sequences SET name=$1, description=$2, "isActive"=$3, "updatedAt"=$4 WHERE id=$5',
      [m.name, m.description, m.isActive ? 1 : 0, now(), id]);
    return this.getFollowupSequence(id);
  }

  async deleteFollowupSequence(id: string) { await execute('DELETE FROM followup_sequences WHERE id = $1', [id]); return true; }

  // ========== Follow-up Steps ==========
  async getFollowupSteps(sequenceId: string) { return queryAll('SELECT * FROM followup_steps WHERE "sequenceId" = $1 ORDER BY "stepNumber" ASC', [sequenceId]); }
  async getFollowupStep(id: string) { return queryOne('SELECT * FROM followup_steps WHERE id = $1', [id]); }

  async createFollowupStep(step: any) {
    const id = genId();
    await execute(
      'INSERT INTO followup_steps (id, "sequenceId", "stepNumber", trigger, "delayDays", "delayHours", "delayMinutes", subject, content, "isActive", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)',
      [id, step.sequenceId, step.stepNumber || 0, step.trigger || 'no_reply', step.delayDays || 0, step.delayHours || 0, step.delayMinutes || 0, step.subject || '', step.content || '', now()]
    );
    return this.getFollowupStep(id);
  }

  async updateFollowupStep(id: string, data: any) {
    const existing = await this.getFollowupStep(id);
    if (!existing) throw new Error('Step not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE followup_steps SET "stepNumber"=$1, trigger=$2, "delayDays"=$3, "delayHours"=$4, "delayMinutes"=$5, subject=$6, content=$7, "isActive"=$8 WHERE id=$9',
      [m.stepNumber, m.trigger, m.delayDays, m.delayHours, m.delayMinutes || 0, m.subject, m.content, m.isActive ? 1 : 0, id]
    );
    return this.getFollowupStep(id);
  }

  async deleteFollowupStep(id: string) { await execute('DELETE FROM followup_steps WHERE id = $1', [id]); return true; }

  // ========== Campaign Follow-ups ==========
  async getCampaignFollowups(campaignId: string) { return queryAll('SELECT * FROM campaign_followups WHERE "campaignId" = $1 AND "isActive" = 1', [campaignId]); }
  async getActiveCampaignFollowups() { return queryAll('SELECT * FROM campaign_followups WHERE "isActive" = 1'); }

  async hasActiveFollowupSteps(campaignId: string): Promise<boolean> {
    const followup = await queryOne('SELECT cf.id FROM campaign_followups cf INNER JOIN followup_steps fs ON fs."sequenceId" = cf."sequenceId" WHERE cf."campaignId" = $1 AND cf."isActive" = 1 LIMIT 1', [campaignId]);
    return !!followup;
  }

  async createCampaignFollowup(followup: any) {
    const id = genId();
    await execute('INSERT INTO campaign_followups (id, "campaignId", "sequenceId", "isActive", "createdAt") VALUES ($1, $2, $3, 1, $4)', [id, followup.campaignId, followup.sequenceId || null, now()]);
    return queryOne('SELECT * FROM campaign_followups WHERE id = $1', [id]);
  }

  // ========== Follow-up Executions ==========
  async getFollowupExecution(campaignMessageId: string, stepId: string) {
    return queryOne('SELECT * FROM followup_executions WHERE "campaignMessageId" = $1 AND "stepId" = $2', [campaignMessageId, stepId]);
  }

  async getFollowupExecutionsByCampaign(campaignId: string) {
    return queryAll('SELECT "campaignMessageId", "stepId", status FROM followup_executions WHERE "campaignId" = $1', [campaignId]);
  }

  async getFollowupExecutionById(id: string) { return queryOne('SELECT * FROM followup_executions WHERE id = $1', [id]); }

  async getPendingFollowupExecutions() {
    return queryAll(`SELECT * FROM followup_executions WHERE status = 'pending' AND "scheduledAt" <= $1`, [now()]);
  }

  async createFollowupExecution(execution: any) {
    const id = genId();
    const toStr = (v: any): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };
    await execute(
      'INSERT INTO followup_executions (id, "campaignMessageId", "stepId", "contactId", "campaignId", status, "scheduledAt", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, toStr(execution.campaignMessageId), toStr(execution.stepId), toStr(execution.contactId), toStr(execution.campaignId), toStr(execution.status) || 'pending', toStr(execution.scheduledAt), now()]
    );
    return this.getFollowupExecutionById(id);
  }

  async updateFollowupExecution(id: string, data: any) {
    const existing = await this.getFollowupExecutionById(id);
    if (!existing) throw new Error('Execution not found');
    const m = { ...existing, ...data };
    const toDateStr = (v: any): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString();
      return String(v);
    };
    const executedAt = toDateStr(m.executedAt) || toDateStr(m.sentAt) || null;
    await execute('UPDATE followup_executions SET status=$1, "executedAt"=$2 WHERE id=$3', [String(m.status), executedAt, id]);
    return this.getFollowupExecutionById(id);
  }

  async cancelPendingFollowupsForContact(contactId: string, campaignId?: string) {
    if (campaignId) {
      await execute(`UPDATE followup_executions SET status = 'skipped' WHERE "contactId" = $1 AND "campaignId" = $2 AND status = 'pending'`, [contactId, campaignId]);
    } else {
      await execute(`UPDATE followup_executions SET status = 'skipped' WHERE "contactId" = $1 AND status = 'pending'`, [contactId]);
    }
  }

  // ========== Analytics Helpers ==========
  async getCampaignAnalytics(campaignId: string) {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return null;

    const totalSent = campaign.sentCount || 0;
    const opened = campaign.openedCount || 0;
    const clicked = campaign.clickedCount || 0;
    const replied = campaign.repliedCount || 0;
    const bounced = campaign.bouncedCount || 0;
    const unsub = campaign.unsubscribedCount || 0;
    const spam = (campaign as any).spamCount || 0;

    const replyBreakdown = await queryAll(`
      SELECT "replyType", COUNT(*) as count FROM unified_inbox
      WHERE "campaignId" = $1 AND "replyType" != '' AND "replyType" IS NOT NULL
      GROUP BY "replyType"
    `, [campaignId]);

    const bounceBreakdown = await queryAll(`
      SELECT "bounceType", COUNT(*) as count FROM unified_inbox
      WHERE "campaignId" = $1 AND "bounceType" != '' AND "bounceType" IS NOT NULL
      GROUP BY "bounceType"
    `, [campaignId]);

    const dailyTimeline = await queryAll(`
      SELECT "createdAt"::date::text as date, type, COUNT(*) as count
      FROM tracking_events
      WHERE "campaignId" = $1
      GROUP BY "createdAt"::date, type
      ORDER BY date
    `, [campaignId]);

    const positiveReplies = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "campaignId" = $1 AND "replyType" = 'positive'`, [campaignId])).c);

    return {
      campaignId,
      campaignName: campaign.name,
      totalSent, delivered: totalSent - bounced, opened, clicked, replied, bounced, unsubscribed: unsub, spam,
      openRate: totalSent > 0 ? ((opened / totalSent) * 100).toFixed(1) : '0',
      clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((replied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((bounced / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((unsub / totalSent) * 100).toFixed(1) : '0',
      spamRate: totalSent > 0 ? ((spam / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - bounced) / totalSent) * 100).toFixed(1) : '0',
      positiveReplies,
      replyBreakdown,
      bounceBreakdown,
      dailyTimeline,
    };
  }

  async getOrganizationAnalytics(organizationId: string, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const row = await queryOne(`SELECT
      SUM("sentCount") as "totalSent", SUM("openedCount") as "totalOpened",
      SUM("clickedCount") as "totalClicked", SUM("repliedCount") as "totalReplied",
      SUM("bouncedCount") as "totalBounced", SUM("unsubscribedCount") as "totalUnsubscribed",
      COUNT(*) as "campaignCount"
    FROM campaigns WHERE "organizationId" = $1 AND "createdAt" >= $2`, [organizationId, cutoffStr]);

    const totalSent = parseInt(row.totalSent) || 0;
    const totalOpened = parseInt(row.totalOpened) || 0;
    const totalClicked = parseInt(row.totalClicked) || 0;
    const totalReplied = parseInt(row.totalReplied) || 0;
    const totalBounced = parseInt(row.totalBounced) || 0;
    const totalUnsub = parseInt(row.totalUnsubscribed) || 0;

    const timeline: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayEvents = await queryAll(`SELECT type, COUNT(*) as c FROM tracking_events te
        INNER JOIN campaigns ca ON te."campaignId" = ca.id
        WHERE ca."organizationId" = $1 AND te."createdAt"::date = $2::date
        GROUP BY type`, [organizationId, dateStr]);
      const counts: any = {};
      for (const e of dayEvents) counts[e.type] = parseInt(e.c);
      timeline.push({ date: dateStr, opens: counts.open || 0, clicks: counts.click || 0, replies: counts.reply || 0 });
    }

    const contactCount = parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1', [organizationId])).c);

    return {
      totalSent, totalOpened, totalClicked, totalReplied, totalBounced, totalUnsubscribed: totalUnsub,
      openRate: totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : '0',
      clickRate: totalOpened > 0 ? ((totalClicked / totalOpened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - totalBounced) / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((totalUnsub / totalSent) * 100).toFixed(1) : '0',
      timeline,
      campaignCount: parseInt(row.campaignCount) || 0,
      contactCount,
    };
  }

  // ========== API Settings ==========
  async getApiSetting(organizationId: string, key: string): Promise<string | null> {
    const row = await queryOne('SELECT "settingValue" FROM api_settings WHERE "organizationId" = $1 AND "settingKey" = $2', [organizationId, key]);
    return row ? row.settingValue : null;
  }

  async getApiSettings(organizationId: string): Promise<Record<string, string>> {
    const rows = await queryAll('SELECT "settingKey", "settingValue" FROM api_settings WHERE "organizationId" = $1', [organizationId]);
    const result: Record<string, string> = {};
    for (const row of rows) result[row.settingKey] = row.settingValue;
    return result;
  }

  async setApiSetting(organizationId: string, key: string, value: string): Promise<void> {
    const ts = now();
    await execute(
      `INSERT INTO api_settings (id, "organizationId", "settingKey", "settingValue", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("organizationId", "settingKey") DO UPDATE SET "settingValue" = $4, "updatedAt" = $6`,
      [genId(), organizationId, key, value, ts, ts]
    );
  }

  async setApiSettings(organizationId: string, settings: Record<string, string>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(settings)) {
        const ts = now();
        await client.query(
          `INSERT INTO api_settings (id, "organizationId", "settingKey", "settingValue", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ("organizationId", "settingKey") DO UPDATE SET "settingValue" = $4, "updatedAt" = $6`,
          [genId(), organizationId, key, value || '', ts, ts]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteApiSetting(organizationId: string, key: string): Promise<void> {
    await execute('DELETE FROM api_settings WHERE "organizationId" = $1 AND "settingKey" = $2', [organizationId, key]);
  }

  // ========== Unified Inbox ==========
  async getInboxMessages(organizationId: string, filters?: { status?: string; emailAccountId?: string; campaignId?: string }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM unified_inbox WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;
    if (filters?.status && filters.status !== 'all') { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ` AND "emailAccountId" = $${idx++}`; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND "emailAccountId" IN (${accountIds.map(() => `$${idx++}`).join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ` AND "campaignId" = $${idx++}`; params.push(filters.campaignId); }
    sql += ` ORDER BY "receivedAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  async getInboxMessagesForUser(organizationId: string, userId: string, filters?: { status?: string; emailAccountId?: string; campaignId?: string }, limit = 50, offset = 0) {
    let sql = `SELECT ui.* FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
      WHERE ui."organizationId" = $1 AND ea."userId" = $2`;
    const params: any[] = [organizationId, userId];
    let idx = 3;
    if (filters?.status && filters.status !== 'all') { sql += ` AND ui.status = $${idx++}`; params.push(filters.status); }
    if (filters?.emailAccountId) { sql += ` AND ui."emailAccountId" = $${idx++}`; params.push(filters.emailAccountId); }
    if (filters?.campaignId) { sql += ` AND ui."campaignId" = $${idx++}`; params.push(filters.campaignId); }
    sql += ` ORDER BY ui."receivedAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  async getInboxMessageCount(organizationId: string, filters?: { status?: string; emailAccountId?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;
    if (filters?.status && filters.status !== 'all') { sql += ` AND status = $${idx++}`; params.push(filters.status); }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ` AND "emailAccountId" = $${idx++}`; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND "emailAccountId" IN (${accountIds.map(() => `$${idx++}`).join(',')})`;
        params.push(...accountIds);
      }
    }
    return parseInt((await queryOne(sql, params)).c);
  }

  async getInboxMessageCountForUser(organizationId: string, userId: string, filters?: { status?: string }) {
    let sql = `SELECT COUNT(*) as c FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
      WHERE ui."organizationId" = $1 AND ea."userId" = $2`;
    const params: any[] = [organizationId, userId];
    let idx = 3;
    if (filters?.status && filters.status !== 'all') { sql += ` AND ui.status = $${idx++}`; params.push(filters.status); }
    return parseInt((await queryOne(sql, params)).c);
  }

  async getInboxMessage(id: string) { return queryOne('SELECT * FROM unified_inbox WHERE id = $1', [id]); }
  async getInboxMessageByGmailId(gmailMessageId: string) { return queryOne('SELECT * FROM unified_inbox WHERE "gmailMessageId" = $1', [gmailMessageId]); }
  async getInboxMessageByOutlookId(outlookMessageId: string) { return queryOne('SELECT * FROM unified_inbox WHERE "outlookMessageId" = $1', [outlookMessageId]); }

  async createInboxMessage(msg: any) {
    const id = genId(); const ts = now();
    await execute(`INSERT INTO unified_inbox (id, "organizationId", "emailAccountId", "campaignId", "messageId", "contactId",
      "gmailMessageId", "gmailThreadId", "outlookMessageId", "outlookConversationId",
      "fromEmail", "fromName", "toEmail", subject, snippet, body, "bodyHtml",
      status, provider, "aiDraft", "repliedAt", "receivedAt", "createdAt",
      "replyType", "bounceType", "threadId", "inReplyTo", "assignedTo", "leadStatus", "sentByUs")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
      [id, msg.organizationId, msg.emailAccountId || null, msg.campaignId || null, msg.messageId || null, msg.contactId || null,
      msg.gmailMessageId || null, msg.gmailThreadId || null, msg.outlookMessageId || null, msg.outlookConversationId || null,
      msg.fromEmail, msg.fromName || '', msg.toEmail || '', msg.subject || '', msg.snippet || '', msg.body || '', msg.bodyHtml || '',
      msg.status || 'unread', msg.provider || '', msg.aiDraft || null, msg.repliedAt || null, msg.receivedAt || ts, ts,
      msg.replyType || '', msg.bounceType || '', msg.threadId || null, msg.inReplyTo || null, msg.assignedTo || null, msg.leadStatus || '', msg.sentByUs || 0]
    );
    try {
      const { detectMeeting } = await import('./services/meeting-detector');
      const det = detectMeeting(msg.subject, msg.body, msg.bodyHtml);
      if (det.detected) {
        await execute(
          'UPDATE unified_inbox SET "meetingDetected"=TRUE, "meetingPlatform"=$1, "meetingUrl"=$2, "meetingAt"=$3 WHERE id=$4',
          [det.platform, det.url, det.meetingAt, id]
        );
      }
    } catch (e) { /* meeting columns may not exist yet */ }
    return this.getInboxMessage(id);
  }

  async updateInboxMessage(id: string, data: any) {
    const existing = await this.getInboxMessage(id);
    if (!existing) throw new Error('Inbox message not found');
    const m = { ...existing, ...data } as any;
    // Only SET columns that are known to exist — forward columns may not exist in older schemas
    await execute(
      'UPDATE unified_inbox SET status=$1, "aiDraft"=$2, "repliedAt"=$3, "replyType"=$4, "bounceType"=$5, "threadId"=$6, "assignedTo"=$7, "leadStatus"=$8, "isStarred"=$9 WHERE id=$10',
      [m.status, m.aiDraft || null, m.repliedAt || null,
      m.replyType || '', m.bounceType || '', m.threadId || null, m.assignedTo || null, m.leadStatus || '', m.isStarred || 0, id]
    );
    // Update forward/reply columns separately — these may not exist yet in production
    const extraCols = [
      { col: '"replyContent"', val: m.replyContent || null },
      { col: '"repliedBy"', val: m.repliedBy || null },
      { col: '"forwardedAt"', val: m.forwardedAt || null },
      { col: '"forwardedTo"', val: m.forwardedTo || null },
      { col: '"forwardedFrom"', val: m.forwardedFrom || null },
      { col: '"forwardedBy"', val: m.forwardedBy || null },
    ];
    for (const { col, val } of extraCols) {
      if (val !== null && val !== undefined) {
        try { await execute(`UPDATE unified_inbox SET ${col}=$1 WHERE id=$2`, [val, id]); } catch (e) { /* column may not exist */ }
      }
    }
    return this.getInboxMessage(id);
  }

  async deleteInboxMessage(id: string) { await execute('DELETE FROM unified_inbox WHERE id = $1', [id]); return true; }

  async backfillInboxEmailAccountId(id: string, emailAccountId: string) {
    await execute('UPDATE unified_inbox SET "emailAccountId" = $1 WHERE id = $2', [emailAccountId, id]);
  }

  async getInboxMessagesWithNullAccount(organizationId: string, limit = 200) {
    return queryAll('SELECT * FROM unified_inbox WHERE "organizationId" = $1 AND "emailAccountId" IS NULL ORDER BY "receivedAt" DESC LIMIT $2', [organizationId, limit]);
  }

  async getInboxUnreadCount(organizationId: string, emailAccountIds?: string) {
    if (emailAccountIds) {
      const ids = emailAccountIds.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length === 1) {
        return parseInt((await queryOne('SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND status = $2 AND "emailAccountId" = $3', [organizationId, 'unread', ids[0]])).c);
      } else if (ids.length > 1) {
        const ph = ids.map((_, i) => `$${i + 3}`).join(',');
        return parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND status = $2 AND "emailAccountId" IN (${ph})`, [organizationId, 'unread', ...ids])).c);
      }
    }
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND status = $2', [organizationId, 'unread'])).c);
  }

  async getInboxUnreadCountForUser(organizationId: string, userId: string) {
    return parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
      WHERE ui."organizationId" = $1 AND ea."userId" = $2 AND ui.status = $3`, [organizationId, userId, 'unread'])).c);
  }

  // ========== Organization Members (Multitenancy) ==========
  async getOrgMember(organizationId: string, userId: string) {
    return queryOne('SELECT * FROM org_members WHERE "organizationId" = $1 AND "userId" = $2', [organizationId, userId]);
  }

  async getOrgMembers(organizationId: string) {
    return queryAll(`
      SELECT om.*, u.email, u."firstName", u."lastName", u."isActive" as "userActive"
      FROM org_members om
      INNER JOIN users u ON om."userId" = u.id
      WHERE om."organizationId" = $1
      ORDER BY (om.role = 'owner') DESC, om."joinedAt" ASC
    `, [organizationId]);
  }

  async getUserOrganizations(userId: string) {
    return queryAll(`
      SELECT o.*, om.role as "memberRole", om."isDefault", om."joinedAt"
      FROM organizations o
      INNER JOIN org_members om ON om."organizationId" = o.id
      WHERE om."userId" = $1
      ORDER BY om."isDefault" DESC, om."joinedAt" ASC
    `, [userId]);
  }

  async getUserDefaultOrganization(userId: string) {
    const defaultOrg = await queryOne(`
      SELECT o.*, om.role as "memberRole", om."isDefault"
      FROM organizations o
      INNER JOIN org_members om ON om."organizationId" = o.id
      WHERE om."userId" = $1 AND om."isDefault" = 1
      LIMIT 1
    `, [userId]);
    if (defaultOrg) return defaultOrg;
    return queryOne(`
      SELECT o.*, om.role as "memberRole", om."isDefault"
      FROM organizations o
      INNER JOIN org_members om ON om."organizationId" = o.id
      WHERE om."userId" = $1
      ORDER BY om."joinedAt" ASC
      LIMIT 1
    `, [userId]);
  }

  async addOrgMember(organizationId: string, userId: string, role: string = 'member', invitedBy?: string) {
    const id = genId(); const ts = now();
    const existingOrgs = await queryOne('SELECT COUNT(*) as c FROM org_members WHERE "userId" = $1', [userId]);
    const isDefault = parseInt(existingOrgs.c) === 0 ? 1 : 0;
    await execute(
      'INSERT INTO org_members (id, "organizationId", "userId", role, "isDefault", "joinedAt", "invitedBy", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT ("organizationId", "userId") DO NOTHING',
      [id, organizationId, userId, role, isDefault, ts, invitedBy || null, ts]
    );
    return this.getOrgMember(organizationId, userId);
  }

  async updateOrgMemberRole(organizationId: string, userId: string, role: string) {
    await execute('UPDATE org_members SET role = $1 WHERE "organizationId" = $2 AND "userId" = $3', [role, organizationId, userId]);
    return this.getOrgMember(organizationId, userId);
  }

  async removeOrgMember(organizationId: string, userId: string) {
    await execute('DELETE FROM org_members WHERE "organizationId" = $1 AND "userId" = $2', [organizationId, userId]);
    const remaining = await queryOne('SELECT * FROM org_members WHERE "userId" = $1 ORDER BY "joinedAt" ASC LIMIT 1', [userId]);
    if (remaining) {
      await execute('UPDATE org_members SET "isDefault" = 1 WHERE id = $1', [remaining.id]);
    }
    return true;
  }

  async setDefaultOrganization(userId: string, organizationId: string) {
    await execute('UPDATE org_members SET "isDefault" = 0 WHERE "userId" = $1', [userId]);
    await execute('UPDATE org_members SET "isDefault" = 1 WHERE "userId" = $1 AND "organizationId" = $2', [userId, organizationId]);
    await execute('UPDATE users SET "organizationId" = $1, "updatedAt" = $2 WHERE id = $3', [organizationId, now(), userId]);
    return true;
  }

  async getOrgMemberCount(organizationId: string) {
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM org_members WHERE "organizationId" = $1', [organizationId])).c);
  }

  // ========== Organization Invitations ==========
  async createInvitation(organizationId: string, email: string, role: string, invitedBy: string) {
    const id = genId(); const ts = now();
    const token = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await execute(`UPDATE org_invitations SET status = 'cancelled' WHERE "organizationId" = $1 AND email = $2 AND status = 'pending'`, [organizationId, email]);
    await execute(
      'INSERT INTO org_invitations (id, "organizationId", email, role, "invitedBy", token, status, "expiresAt", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, organizationId, email, role, invitedBy, token, 'pending', expiresAt, ts]
    );
    return { id, organizationId, email, role, invitedBy, token, status: 'pending', expiresAt, createdAt: ts };
  }

  async getInvitationByToken(token: string) { return queryOne('SELECT * FROM org_invitations WHERE token = $1', [token]); }

  async getOrgInvitations(organizationId: string) {
    return queryAll(`SELECT * FROM org_invitations WHERE "organizationId" = $1 AND status = 'pending' ORDER BY "createdAt" DESC`, [organizationId]);
  }

  async getPendingInvitationsForEmail(email: string) {
    return queryAll(`SELECT oi.*, o.name as "orgName" FROM org_invitations oi INNER JOIN organizations o ON oi."organizationId" = o.id WHERE oi.email = $1 AND oi.status = 'pending' AND oi."expiresAt" > $2`, [email, now()]);
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.getInvitationByToken(token) as any;
    if (!invitation) throw new Error('Invitation not found');
    if (invitation.status !== 'pending') throw new Error('Invitation already used');
    if (new Date(invitation.expiresAt) < new Date()) throw new Error('Invitation expired');
    await execute(`UPDATE org_invitations SET status = 'accepted', "acceptedAt" = $1 WHERE id = $2`, [now(), invitation.id]);
    await this.addOrgMember(invitation.organizationId, userId, invitation.role, invitation.invitedBy);
    return invitation;
  }

  async cancelInvitation(id: string) {
    await execute(`UPDATE org_invitations SET status = 'cancelled' WHERE id = $1`, [id]);
    return true;
  }

  // ========== Enhanced Organization Methods ==========
  async updateOrganization(id: string, data: any) {
    const existing = await this.getOrganization(id);
    if (!existing) throw new Error('Organization not found');
    const m = { ...existing, ...data };
    await execute('UPDATE organizations SET name=$1, domain=$2, settings=$3, "updatedAt"=$4 WHERE id=$5',
      [m.name, m.domain || '', toJson(m.settings || {}), now(), id]);
    return this.getOrganization(id);
  }

  async deleteOrganization(id: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM org_invitations WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM org_members WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM api_settings WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM unified_inbox WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM followup_sequences WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM integrations WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM unsubscribes WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM templates WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM segments WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM contact_lists WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM contacts WHERE "organizationId" = $1', [id]);
      const campaigns = (await client.query('SELECT id FROM campaigns WHERE "organizationId" = $1', [id])).rows;
      for (const c of campaigns) {
        await client.query('DELETE FROM messages WHERE "campaignId" = $1', [c.id]);
        await client.query('DELETE FROM tracking_events WHERE "campaignId" = $1', [c.id]);
        await client.query('DELETE FROM campaign_followups WHERE "campaignId" = $1', [c.id]);
        await client.query('DELETE FROM followup_executions WHERE "campaignId" = $1', [c.id]);
      }
      await client.query('DELETE FROM campaigns WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM email_accounts WHERE "organizationId" = $1', [id]);
      await client.query('DELETE FROM organizations WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return true;
  }

  async createOrganizationWithOwner(orgData: any, userId: string) {
    const orgId = genId(); const ts = now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO organizations (id, name, domain, settings, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
        [orgId, orgData.name, orgData.domain || '', toJson(orgData.settings || {}), ts, ts]);
      await client.query('INSERT INTO org_members (id, "organizationId", "userId", role, "isDefault", "joinedAt", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [genId(), orgId, userId, 'owner', 0, ts, ts]);
      await client.query('UPDATE users SET "organizationId" = $1, "updatedAt" = $2 WHERE id = $3', [orgId, ts, userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.getOrganization(orgId);
  }

  async getAllOrganizationIds(): Promise<string[]> {
    return (await queryAll('SELECT id FROM organizations')).map(r => r.id);
  }

  // ========== SuperAdmin Methods ==========
  async isSuperAdmin(userId: string): Promise<boolean> {
    const user = await queryOne('SELECT "isSuperAdmin" FROM users WHERE id = $1', [userId]);
    return user?.isSuperAdmin === 1;
  }

  async getSuperAdminOrgId(): Promise<string | null> {
    const superAdmin = await queryOne('SELECT u.id FROM users u WHERE u."isSuperAdmin" = 1 LIMIT 1');
    if (!superAdmin) return null;
    const org = await queryOne('SELECT "organizationId" FROM org_members WHERE "userId" = $1 AND "isDefault" = 1 LIMIT 1', [superAdmin.id]);
    if (org) return org.organizationId;
    const firstOrg = await queryOne('SELECT "organizationId" FROM org_members WHERE "userId" = $1 ORDER BY "joinedAt" ASC LIMIT 1', [superAdmin.id]);
    return firstOrg?.organizationId || null;
  }

  async getApiSettingsWithAzureFallback(organizationId: string): Promise<Record<string, string>> {
    const settings = await this.getApiSettings(organizationId);
    if (settings.azure_openai_endpoint && settings.azure_openai_api_key && settings.azure_openai_deployment) {
      return settings;
    }
    const superAdminOrgId = await this.getSuperAdminOrgId();
    if (superAdminOrgId && superAdminOrgId !== organizationId) {
      const superSettings = await this.getApiSettings(superAdminOrgId);
      const azureKeys = ['azure_openai_endpoint', 'azure_openai_api_key', 'azure_openai_deployment', 'azure_openai_api_version'];
      for (const key of azureKeys) {
        if (superSettings[key] && !settings[key]) settings[key] = superSettings[key];
      }
    }
    return settings;
  }

  async setSuperAdmin(userId: string, isSuperAdmin: boolean): Promise<void> {
    await execute('UPDATE users SET "isSuperAdmin" = $1, "updatedAt" = $2 WHERE id = $3', [isSuperAdmin ? 1 : 0, now(), userId]);
  }

  async setSuperAdminByEmail(email: string, isSuperAdmin: boolean): Promise<any> {
    await execute('UPDATE users SET "isSuperAdmin" = $1, "updatedAt" = $2 WHERE LOWER(email) = LOWER($3)', [isSuperAdmin ? 1 : 0, now(), email]);
    return queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  }

  async getAllUsers(limit = 100, offset = 0, search?: string): Promise<any[]> {
    if (search) {
      return queryAll(`
        SELECT u.*,
          (SELECT COUNT(*) FROM org_members om WHERE om."userId" = u.id) as "orgCount",
          (SELECT STRING_AGG(o.name, ', ') FROM org_members om2 JOIN organizations o ON o.id = om2."organizationId" WHERE om2."userId" = u.id) as "orgNames"
        FROM users u
        WHERE u.email ILIKE $1 OR u."firstName" ILIKE $1 OR u."lastName" ILIKE $1
        ORDER BY u."createdAt" DESC LIMIT $2 OFFSET $3
      `, [`%${search}%`, limit, offset]);
    }
    return queryAll(`
      SELECT u.*,
        (SELECT COUNT(*) FROM org_members om WHERE om."userId" = u.id) as "orgCount",
        (SELECT STRING_AGG(o.name, ', ') FROM org_members om2 JOIN organizations o ON o.id = om2."organizationId" WHERE om2."userId" = u.id) as "orgNames"
      FROM users u
      ORDER BY u."createdAt" DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
  }

  async getAllUsersCount(search?: string): Promise<number> {
    if (search) {
      return parseInt((await queryOne('SELECT COUNT(*) as c FROM users WHERE email ILIKE $1 OR "firstName" ILIKE $1 OR "lastName" ILIKE $1', [`%${search}%`])).c);
    }
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM users')).c);
  }

  async getAllOrganizations(limit = 100, offset = 0, search?: string): Promise<any[]> {
    if (search) {
      return queryAll(`
        SELECT o.*,
          (SELECT COUNT(*) FROM org_members om WHERE om."organizationId" = o.id) as "memberCount",
          (SELECT COUNT(*) FROM campaigns c WHERE c."organizationId" = o.id) as "campaignCount",
          (SELECT COUNT(*) FROM contacts ct WHERE ct."organizationId" = o.id) as "contactCount",
          (SELECT COUNT(*) FROM email_accounts ea WHERE ea."organizationId" = o.id) as "emailAccountCount",
          (SELECT SUM(CASE WHEN c2.status = 'active' THEN 1 ELSE 0 END) FROM campaigns c2 WHERE c2."organizationId" = o.id) as "activeCampaigns"
        FROM organizations o
        WHERE o.name ILIKE $1 OR o.domain ILIKE $1
        ORDER BY o."createdAt" DESC LIMIT $2 OFFSET $3
      `, [`%${search}%`, limit, offset]);
    }
    return queryAll(`
      SELECT o.*,
        (SELECT COUNT(*) FROM org_members om WHERE om."organizationId" = o.id) as "memberCount",
        (SELECT COUNT(*) FROM campaigns c WHERE c."organizationId" = o.id) as "campaignCount",
        (SELECT COUNT(*) FROM contacts ct WHERE ct."organizationId" = o.id) as "contactCount",
        (SELECT COUNT(*) FROM email_accounts ea WHERE ea."organizationId" = o.id) as "emailAccountCount",
        (SELECT SUM(CASE WHEN c2.status = 'active' THEN 1 ELSE 0 END) FROM campaigns c2 WHERE c2."organizationId" = o.id) as "activeCampaigns"
      FROM organizations o
      ORDER BY o."createdAt" DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
  }

  async getAllOrganizationsCount(search?: string): Promise<number> {
    if (search) {
      return parseInt((await queryOne('SELECT COUNT(*) as c FROM organizations WHERE name ILIKE $1 OR domain ILIKE $1', [`%${search}%`])).c);
    }
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM organizations')).c);
  }

  async getPlatformStats(): Promise<any> {
    const totalUsers = parseInt((await queryOne('SELECT COUNT(*) as c FROM users')).c);
    const activeUsers = parseInt((await queryOne('SELECT COUNT(*) as c FROM users WHERE "isActive" = 1')).c);
    const totalOrgs = parseInt((await queryOne('SELECT COUNT(*) as c FROM organizations')).c);
    const totalCampaigns = parseInt((await queryOne('SELECT COUNT(*) as c FROM campaigns')).c);
    const activeCampaigns = parseInt((await queryOne(`SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'`)).c);
    const totalContacts = parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts')).c);
    const totalEmailAccounts = parseInt((await queryOne('SELECT COUNT(*) as c FROM email_accounts')).c);
    const totalEmailsSent = parseInt((await queryOne(`SELECT COUNT(*) as c FROM messages WHERE status = 'sent'`)).c);
    const totalOpens = parseInt((await queryOne(`SELECT COUNT(*) as c FROM tracking_events WHERE type = 'open'`)).c);
    const totalClicks = parseInt((await queryOne(`SELECT COUNT(*) as c FROM tracking_events WHERE type = 'click'`)).c);
    const totalReplies = parseInt((await queryOne(`SELECT COUNT(*) as c FROM tracking_events WHERE type = 'reply'`)).c);
    const totalTemplates = parseInt((await queryOne('SELECT COUNT(*) as c FROM templates')).c);
    const superAdmins = parseInt((await queryOne('SELECT COUNT(*) as c FROM users WHERE "isSuperAdmin" = 1')).c);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentUsers = parseInt((await queryOne('SELECT COUNT(*) as c FROM users WHERE "createdAt" > $1', [sevenDaysAgo])).c);
    const recentCampaigns = parseInt((await queryOne('SELECT COUNT(*) as c FROM campaigns WHERE "createdAt" > $1', [sevenDaysAgo])).c);
    const recentEmails = parseInt((await queryOne('SELECT COUNT(*) as c FROM messages WHERE "sentAt" > $1', [sevenDaysAgo])).c);

    const topOrgs = await queryAll(`
      SELECT o.id, o.name, o.domain,
        (SELECT COUNT(*) FROM messages m JOIN campaigns c ON c.id = m."campaignId" WHERE c."organizationId" = o.id AND m.status = 'sent') as "emailsSent",
        (SELECT COUNT(*) FROM contacts ct WHERE ct."organizationId" = o.id) as contacts,
        (SELECT COUNT(*) FROM org_members om WHERE om."organizationId" = o.id) as members
      FROM organizations o
      ORDER BY "emailsSent" DESC LIMIT 10
    `);

    return {
      totalUsers, activeUsers, totalOrgs, totalCampaigns, activeCampaigns,
      totalContacts, totalEmailAccounts, totalEmailsSent, totalOpens, totalClicks,
      totalReplies, totalTemplates, superAdmins,
      recentUsers, recentCampaigns, recentEmails,
      topOrgs,
    };
  }

  async deactivateUser(userId: string): Promise<void> {
    await execute('UPDATE users SET "isActive" = 0, "updatedAt" = $1 WHERE id = $2', [now(), userId]);
  }

  async activateUser(userId: string): Promise<void> {
    await execute('UPDATE users SET "isActive" = 1, "updatedAt" = $1 WHERE id = $2', [now(), userId]);
  }

  async deleteOrganizationCascade(orgId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tracking_events WHERE "campaignId" IN (SELECT id FROM campaigns WHERE "organizationId" = $1)', [orgId]);
      await client.query('DELETE FROM messages WHERE "campaignId" IN (SELECT id FROM campaigns WHERE "organizationId" = $1)', [orgId]);
      await client.query('DELETE FROM followup_executions WHERE "campaignId" IN (SELECT id FROM campaigns WHERE "organizationId" = $1)', [orgId]);
      await client.query('DELETE FROM campaign_followups WHERE "campaignId" IN (SELECT id FROM campaigns WHERE "organizationId" = $1)', [orgId]);
      await client.query('DELETE FROM followup_steps WHERE "sequenceId" IN (SELECT id FROM followup_sequences WHERE "organizationId" = $1)', [orgId]);
      await client.query('DELETE FROM followup_sequences WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM campaigns WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM contacts WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM contact_lists WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM segments WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM templates WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM email_accounts WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM llm_configs WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM api_settings WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM unified_inbox WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM unsubscribes WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM org_invitations WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM org_members WHERE "organizationId" = $1', [orgId]);
      await client.query('DELETE FROM organizations WHERE id = $1', [orgId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getOrgDetails(orgId: string): Promise<any> {
    const org = await queryOne('SELECT * FROM organizations WHERE id = $1', [orgId]);
    if (!org) return null;
    const members = await queryAll(`
      SELECT u.id, u.email, u."firstName", u."lastName", u."isSuperAdmin", u."isActive", u."createdAt",
        om.role, om."joinedAt"
      FROM org_members om
      JOIN users u ON u.id = om."userId"
      WHERE om."organizationId" = $1
      ORDER BY (om.role = 'owner') DESC, om."joinedAt" ASC
    `, [orgId]);
    const campaigns = parseInt((await queryOne('SELECT COUNT(*) as c FROM campaigns WHERE "organizationId" = $1', [orgId])).c);
    const contacts = parseInt((await queryOne('SELECT COUNT(*) as c FROM contacts WHERE "organizationId" = $1', [orgId])).c);
    const emailAccounts = parseInt((await queryOne('SELECT COUNT(*) as c FROM email_accounts WHERE "organizationId" = $1', [orgId])).c);
    const emailsSent = parseInt((await queryOne(`SELECT COUNT(*) as c FROM messages m JOIN campaigns c ON c.id = m."campaignId" WHERE c."organizationId" = $1 AND m.status = 'sent'`, [orgId])).c);
    return { ...org, members, stats: { campaigns, contacts, emailAccounts, emailsSent } };
  }

  async getBouncedMessagesWithContacts(orgId: string) {
    return queryAll(`
      SELECT m."contactId", m.status as "messageStatus", m."errorMessage", ct.email as "contactEmail", ct.status as "contactStatus"
      FROM messages m
      INNER JOIN campaigns c ON m."campaignId" = c.id
      LEFT JOIN contacts ct ON m."contactId" = ct.id
      WHERE c."organizationId" = $1
      AND (m.status = 'bounced' OR (m.status = 'failed' AND m."errorMessage" ILIKE '%Bounce%'))
      AND m."contactId" IS NOT NULL
    `, [orgId]);
  }

  async getBounceEventsWithContacts(orgId: string) {
    return queryAll(`
      SELECT te."contactId", ct.email as "contactEmail", ct.status as "contactStatus"
      FROM tracking_events te
      INNER JOIN campaigns c ON te."campaignId" = c.id
      LEFT JOIN contacts ct ON te."contactId" = ct.id
      WHERE te.type = 'bounce'
      AND c."organizationId" = $1
      AND te."contactId" IS NOT NULL
    `, [orgId]);
  }

  // ========== v12: Reply Classification Engine ==========
  async classifyReply(inboxMessageId: string, replyType: string) {
    await execute('UPDATE unified_inbox SET "replyType" = $1 WHERE id = $2', [replyType, inboxMessageId]);
  }

  async setBounceType(inboxMessageId: string, bounceType: string) {
    await execute('UPDATE unified_inbox SET "bounceType" = $1 WHERE id = $2', [bounceType, inboxMessageId]);
  }

  // ========== v12: Conversation Threading ==========
  async getConversationThread(threadId: string) {
    return queryAll('SELECT * FROM unified_inbox WHERE "threadId" = $1 ORDER BY "receivedAt" ASC', [threadId]);
  }

  async getConversationByContact(organizationId: string, contactId: string, limit = 50) {
    return queryAll('SELECT * FROM unified_inbox WHERE "organizationId" = $1 AND "contactId" = $2 ORDER BY "receivedAt" DESC LIMIT $3', [organizationId, contactId, limit]);
  }

  // ========== v12: Inbox Assignment ==========
  async assignInboxMessage(inboxMessageId: string, userId: string) {
    await execute('UPDATE unified_inbox SET "assignedTo" = $1 WHERE id = $2', [userId, inboxMessageId]);
  }

  async getInboxByAssignee(organizationId: string, userId: string, limit = 50, offset = 0) {
    return queryAll('SELECT * FROM unified_inbox WHERE "organizationId" = $1 AND "assignedTo" = $2 ORDER BY "receivedAt" DESC LIMIT $3 OFFSET $4', [organizationId, userId, limit, offset]);
  }

  // ========== v12: Lead Status ==========
  async updateLeadStatus(inboxMessageId: string, leadStatus: string) {
    await execute('UPDATE unified_inbox SET "leadStatus" = $1 WHERE id = $2', [leadStatus, inboxMessageId]);
    const msg = await queryOne('SELECT "contactId" FROM unified_inbox WHERE id = $1', [inboxMessageId]);
    if (msg?.contactId) {
      await execute('UPDATE contacts SET "leadStatus" = $1, "updatedAt" = $2 WHERE id = $3', [leadStatus, now(), msg.contactId]);
    }
  }

  async updateContactLeadStatus(contactId: string, leadStatus: string) {
    await execute('UPDATE contacts SET "leadStatus" = $1, "updatedAt" = $2 WHERE id = $3', [leadStatus, now(), contactId]);
  }

  // ========== v12: Star messages ==========
  async starInboxMessage(id: string, isStarred: boolean) {
    await execute('UPDATE unified_inbox SET "isStarred" = $1 WHERE id = $2', [isStarred ? 1 : 0, id]);
  }

  // ========== v12: Global Suppression List ==========
  async addToSuppressionList(orgId: string, email: string, reason: string, extra?: { bounceType?: string; source?: string; campaignId?: string; notes?: string }) {
    const id = genId();
    try {
      await execute(
        `INSERT INTO suppression_list (id, "organizationId", email, reason, "bounceType", source, "campaignId", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ("organizationId", email) DO UPDATE SET reason = $4, "bounceType" = $5, "createdAt" = $9`,
        [id, orgId, email.toLowerCase(), reason, extra?.bounceType || null, extra?.source || null, extra?.campaignId || null, extra?.notes || null, now()]
      );
    } catch (e) { /* unique constraint - already exists */ }
    return id;
  }

  async removeFromSuppressionList(orgId: string, email: string) {
    await execute('DELETE FROM suppression_list WHERE "organizationId" = $1 AND email = $2', [orgId, email.toLowerCase()]);
  }

  async isEmailSuppressed(orgId: string, email: string): Promise<boolean> {
    const row = await queryOne('SELECT id FROM suppression_list WHERE "organizationId" = $1 AND email = $2', [orgId, email.toLowerCase()]);
    return !!row;
  }

  async getSuppressedEmails(orgId: string): Promise<Set<string>> {
    const rows = await queryAll('SELECT email FROM suppression_list WHERE "organizationId" = $1', [orgId]);
    return new Set(rows.map((r: any) => r.email.toLowerCase()));
  }

  async getSuppressionList(orgId: string, filters?: { reason?: string }, limit = 100, offset = 0) {
    let sql = 'SELECT * FROM suppression_list WHERE "organizationId" = $1';
    const params: any[] = [orgId];
    let idx = 2;
    if (filters?.reason) { sql += ` AND reason = $${idx++}`; params.push(filters.reason); }
    sql += ` ORDER BY "createdAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  async getSuppressionListCount(orgId: string, filters?: { reason?: string }): Promise<number> {
    let sql = 'SELECT COUNT(*) as c FROM suppression_list WHERE "organizationId" = $1';
    const params: any[] = [orgId];
    let idx = 2;
    if (filters?.reason) { sql += ` AND reason = $${idx++}`; params.push(filters.reason); }
    return parseInt((await queryOne(sql, params)).c);
  }

  // ========== v12: Unsubscribe Management ==========
  async markContactUnsubscribed(contactId: string, campaignId?: string) {
    const ts = now();
    await execute('UPDATE contacts SET unsubscribed = 1, "unsubscribedAt" = $1, status = $2, "updatedAt" = $3 WHERE id = $4', [ts, 'unsubscribed', ts, contactId]);
    const contact = await this.getContact(contactId);
    if (contact) {
      await this.addToSuppressionList(contact.organizationId, contact.email, 'unsubscribe', { campaignId, source: 'auto' });
    }
  }

  async getUnsubscribedContacts(orgId: string, limit = 100, offset = 0) {
    return queryAll('SELECT * FROM contacts WHERE "organizationId" = $1 AND unsubscribed = 1 ORDER BY "unsubscribedAt" DESC LIMIT $2 OFFSET $3', [orgId, limit, offset]);
  }

  // ========== v12: Contact Status Engine ==========
  async recalculateContactStatus(contactId: string) {
    const contact = await this.getContact(contactId);
    if (!contact) return;
    if (contact.status === 'bounced' || contact.status === 'unsubscribed') return;

    const stats = await this.getContactEngagementStats(contactId);
    let newStatus = 'cold';
    let newScore = contact.score || 0;

    if (stats.totalReplied > 0) { newStatus = 'replied'; newScore = Math.max(newScore, 80); }
    else if (stats.totalClicked > 0) { newStatus = 'hot'; newScore = Math.max(newScore, 60); }
    else if (stats.totalOpened > 0) { newStatus = 'warm'; newScore = Math.max(newScore, 40); }

    await execute('UPDATE contacts SET status = $1, score = $2, "totalSent" = $3, "totalOpened" = $4, "totalClicked" = $5, "totalReplied" = $6, "updatedAt" = $7 WHERE id = $8',
      [newStatus, newScore, stats.totalSent || 0, stats.totalOpened || 0, stats.totalClicked || 0, stats.totalReplied || 0, now(), contactId]);
  }

  async recalculateContactScore(contactId: string) {
    const stats = await this.getContactEngagementStats(contactId);
    let score = 0;
    score += (stats.totalOpened || 0) * 5;
    score += (stats.totalClicked || 0) * 10;
    score += (stats.totalReplied || 0) * 20;

    const contact = await this.getContact(contactId);
    if (contact) {
      if ((contact as any).unsubscribed) score -= 30;
      if (contact.status === 'bounced') score -= 50;
    }
    score = Math.max(0, Math.min(100, score));
    await execute('UPDATE contacts SET score = $1, "updatedAt" = $2 WHERE id = $3', [score, now(), contactId]);
    return score;
  }

  // ========== v12: Bounce Management ==========
  async markContactBounced(contactId: string, bounceType: string = 'hard') {
    const ts = now();
    await execute('UPDATE contacts SET status = $1, "bounceType" = $2, "bouncedAt" = $3, "updatedAt" = $4 WHERE id = $5', ['bounced', bounceType, ts, ts, contactId]);
    const contact = await this.getContact(contactId);
    if (contact) {
      await this.addToSuppressionList(contact.organizationId, contact.email, 'bounce', { bounceType, source: 'auto' });
      const activeCampaigns = await queryAll(`
        SELECT DISTINCT c.id FROM campaigns c
        INNER JOIN messages m ON m."campaignId" = c.id
        WHERE m."contactId" = $1 AND c.status IN ('active', 'scheduled')
      `, [contactId]);
      for (const camp of activeCampaigns) {
        await execute(`UPDATE followup_executions SET status = 'skipped' WHERE "contactId" = $1 AND "campaignId" = $2 AND status = 'pending'`, [contactId, camp.id]);
      }
    }
  }

  // ========== v12: Contact Activity Timeline ==========
  async addContactActivity(orgId: string, contactId: string, type: string, title: string, description?: string, extra?: { campaignId?: string; messageId?: string; metadata?: any }) {
    const id = genId();
    await execute(
      'INSERT INTO contact_activity (id, "organizationId", "contactId", type, title, description, "campaignId", "messageId", metadata, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, orgId, contactId, type, title, description || null, extra?.campaignId || null, extra?.messageId || null, toJson(extra?.metadata || {}), now()]
    );
    return id;
  }

  async getContactActivity(contactId: string, limit = 50, offset = 0) {
    return (await queryAll('SELECT * FROM contact_activity WHERE "contactId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3', [contactId, limit, offset])).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
  }

  // ========== v12: Warmup Monitoring ==========
  async createWarmupAccount(data: any) {
    const id = genId(); const ts = now();
    await execute(
      'INSERT INTO warmup_accounts (id, "organizationId", "emailAccountId", status, "dailyTarget", "startDate", settings, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, data.organizationId, data.emailAccountId, data.status || 'active', data.dailyTarget || 5, data.startDate || ts, toJson(data.settings || {}), ts, ts]
    );
    return this.getWarmupAccount(id);
  }

  async getWarmupAccount(id: string) {
    const r = await queryOne('SELECT * FROM warmup_accounts WHERE id = $1', [id]);
    return r ? { ...r, settings: fromJson(r.settings) } : null;
  }

  async getWarmupAccounts(orgId: string) {
    return (await queryAll('SELECT wa.*, ea.email as "accountEmail", ea.provider FROM warmup_accounts wa LEFT JOIN email_accounts ea ON ea.id = wa."emailAccountId" WHERE wa."organizationId" = $1 ORDER BY wa."createdAt" DESC', [orgId])).map((r: any) => ({ ...r, settings: fromJson(r.settings) }));
  }

  async updateWarmupAccount(id: string, data: any) {
    const existing = await this.getWarmupAccount(id);
    if (!existing) throw new Error('Warmup account not found');
    const m = { ...existing, ...data };
    await execute(
      'UPDATE warmup_accounts SET status=$1, "dailyTarget"=$2, "currentDaily"=$3, "totalSent"=$4, "totalReceived"=$5, "inboxRate"=$6, "spamRate"=$7, "reputationScore"=$8, "lastWarmupAt"=$9, settings=$10, "updatedAt"=$11 WHERE id=$12',
      [m.status, m.dailyTarget, m.currentDaily || 0, m.totalSent || 0, m.totalReceived || 0,
      m.inboxRate || 0, m.spamRate || 0, m.reputationScore || 50,
      m.lastWarmupAt || null, toJson(m.settings || {}), now(), id]
    );
    return this.getWarmupAccount(id);
  }

  async deleteWarmupAccount(id: string) {
    await execute('DELETE FROM warmup_logs WHERE "warmupAccountId" = $1', [id]);
    await execute('DELETE FROM warmup_accounts WHERE id = $1', [id]);
  }

  async addWarmupLog(warmupAccountId: string, date: string, data: any) {
    const id = genId();
    await execute(
      'INSERT INTO warmup_logs (id, "warmupAccountId", date, sent, received, "inboxCount", "spamCount", "bounceCount", "openCount", "replyCount", "sendPairs", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, warmupAccountId, date, data.sent || 0, data.received || 0, data.inboxCount || 0,
      data.spamCount || 0, data.bounceCount || 0, data.openCount || 0, data.replyCount || 0,
      JSON.stringify(data.sendPairs || []), now()]
    );
    return id;
  }

  async getWarmupLogs(warmupAccountId: string, limit = 30) {
    return queryAll('SELECT * FROM warmup_logs WHERE "warmupAccountId" = $1 ORDER BY date DESC LIMIT $2', [warmupAccountId, limit]);
  }

  // ========== Email History & Lead Opportunities ==========
  async addEmailHistory(data: { organizationId: string; emailAccountId: string; accountEmail: string; provider?: string; externalId?: string; threadId?: string; fromEmail: string; fromName?: string; toEmail?: string; subject?: string; snippet?: string; direction: string; receivedAt: string }) {
    const id = genId();
    await execute(
      `INSERT INTO email_history (id, "organizationId", "emailAccountId", "accountEmail", provider, "externalId", "threadId", "fromEmail", "fromName", "toEmail", subject, snippet, direction, "receivedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING`,
      [id, data.organizationId, data.emailAccountId, data.accountEmail, data.provider || null,
      data.externalId || null, data.threadId || null, data.fromEmail, data.fromName || null,
      data.toEmail || null, data.subject || null, data.snippet || null, data.direction, data.receivedAt, now()]
    );
    return id;
  }

  async getEmailHistoryByThread(threadId: string) {
    return queryAll('SELECT * FROM email_history WHERE "threadId" = $1 ORDER BY "receivedAt" ASC', [threadId]);
  }

  async getEmailHistoryContacts(orgId: string, emailAccountId?: string) {
    if (emailAccountId) {
      return queryAll(`SELECT "fromEmail", "fromName", COUNT(*) as "totalEmails",
           SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as "totalSent",
           SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as "totalReceived",
           MAX("receivedAt") as "lastEmailDate",
           STRING_AGG(DISTINCT subject, ', ') as subjects
         FROM email_history WHERE "organizationId" = $1 AND "emailAccountId" = $2
         GROUP BY "fromEmail", "fromName" ORDER BY "lastEmailDate" DESC`, [orgId, emailAccountId]);
    }
    return queryAll(`SELECT "fromEmail", "fromName", COUNT(*) as "totalEmails",
         SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as "totalSent",
         SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as "totalReceived",
         MAX("receivedAt") as "lastEmailDate",
         STRING_AGG(DISTINCT subject, ', ') as subjects
       FROM email_history WHERE "organizationId" = $1
       GROUP BY "fromEmail", "fromName" ORDER BY "lastEmailDate" DESC`, [orgId]);
  }

  async getEmailHistoryStats(orgId: string) {
    return queryOne(`SELECT COUNT(*) as "totalEmails", COUNT(DISTINCT "fromEmail") as "uniqueContacts",
      COUNT(DISTINCT "threadId") as "totalThreads", COUNT(DISTINCT "emailAccountId") as "accountsScanned",
      MIN("receivedAt") as "oldestEmail", MAX("receivedAt") as "newestEmail"
      FROM email_history WHERE "organizationId" = $1`, [orgId]);
  }

  async emailHistoryExists(externalId: string) {
    const row = await queryOne('SELECT id FROM email_history WHERE "externalId" = $1 LIMIT 1', [externalId]);
    return !!row;
  }

  async getEmailHistorySyncStatus(orgId: string) {
    return queryAll(`SELECT "emailAccountId", "accountEmail", provider, COUNT(*) as "emailCount", MIN("receivedAt") as oldest, MAX("receivedAt") as newest
      FROM email_history WHERE "organizationId" = $1 GROUP BY "emailAccountId", "accountEmail", provider`, [orgId]);
  }

  // Lead Opportunities
  async addLeadOpportunity(data: { organizationId: string; emailAccountId?: string; accountEmail?: string; contactEmail: string; contactName?: string; company?: string; bucket: string; confidence: number; aiReasoning?: string; suggestedAction?: string; lastEmailDate?: string; totalEmails?: number; totalSent?: number; totalReceived?: number; sampleSubjects?: string[]; sampleSnippets?: string[] }) {
    const id = genId(); const ts = now();
    await execute(
      `INSERT INTO lead_opportunities (id, "organizationId", "emailAccountId", "accountEmail", "contactEmail", "contactName", company, bucket, confidence, "aiReasoning", "suggestedAction", "lastEmailDate", "totalEmails", "totalSent", "totalReceived", "sampleSubjects", "sampleSnippets", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'new', $18, $19)`,
      [id, data.organizationId, data.emailAccountId || null, data.accountEmail || null, data.contactEmail, data.contactName || null,
      data.company || null, data.bucket, data.confidence, data.aiReasoning || null, data.suggestedAction || null,
      data.lastEmailDate || null, data.totalEmails || 0, data.totalSent || 0, data.totalReceived || 0,
      JSON.stringify(data.sampleSubjects || []), JSON.stringify(data.sampleSnippets || []), ts, ts]
    );
    return id;
  }

  async updateLeadOpportunity(id: string, data: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id') continue;
      sets.push(`"${k}" = $${idx++}`);
      vals.push(k === 'sampleSubjects' || k === 'sampleSnippets' ? JSON.stringify(v) : v);
    }
    sets.push(`"updatedAt" = $${idx++}`);
    vals.push(now());
    vals.push(id);
    await execute(`UPDATE lead_opportunities SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
  }

  async getLeadOpportunities(orgId: string, filters?: { bucket?: string; status?: string; limit?: number }) {
    let q = 'SELECT * FROM lead_opportunities WHERE "organizationId" = $1';
    const params: any[] = [orgId];
    let idx = 2;
    if (filters?.bucket) { q += ` AND bucket = $${idx++}`; params.push(filters.bucket); }
    if (filters?.status) { q += ` AND status = $${idx++}`; params.push(filters.status); }
    q += ' ORDER BY confidence DESC, "lastEmailDate" DESC';
    if (filters?.limit) { q += ` LIMIT $${idx++}`; params.push(filters.limit); }
    return queryAll(q, params);
  }

  async getLeadOpportunitySummary(orgId: string) {
    return queryAll(`SELECT bucket, COUNT(*) as count, AVG(confidence) as "avgConfidence",
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as "newCount",
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as "reviewedCount",
      SUM(CASE WHEN status = 'actioned' THEN 1 ELSE 0 END) as "actionedCount",
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as "dismissedCount"
      FROM lead_opportunities WHERE "organizationId" = $1 GROUP BY bucket`, [orgId]);
  }

  async deleteLeadOpportunitiesByOrg(orgId: string) {
    await execute('DELETE FROM lead_opportunities WHERE "organizationId" = $1', [orgId]);
  }

  async getLeadOpportunityByEmail(orgId: string, contactEmail: string) {
    return queryOne('SELECT * FROM lead_opportunities WHERE "organizationId" = $1 AND "contactEmail" = $2 LIMIT 1', [orgId, contactEmail]);
  }

  // ========== v12: Notifications ==========
  async createNotification(orgId: string, data: { userId?: string; type: string; title: string; message?: string; linkUrl?: string; metadata?: any }) {
    const id = genId();
    await execute(
      'INSERT INTO notifications (id, "organizationId", "userId", type, title, message, "linkUrl", metadata, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, orgId, data.userId || null, data.type, data.title, data.message || null, data.linkUrl || null, toJson(data.metadata || {}), now()]
    );
    return id;
  }

  async getNotifications(orgId: string, userId?: string, limit = 50) {
    if (userId) {
      return (await queryAll('SELECT * FROM notifications WHERE "organizationId" = $1 AND ("userId" = $2 OR "userId" IS NULL) ORDER BY "createdAt" DESC LIMIT $3', [orgId, userId, limit])).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
    }
    return (await queryAll('SELECT * FROM notifications WHERE "organizationId" = $1 ORDER BY "createdAt" DESC LIMIT $2', [orgId, limit])).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
  }

  async getUnreadNotificationCount(orgId: string, userId?: string): Promise<number> {
    if (userId) {
      return parseInt((await queryOne('SELECT COUNT(*) as c FROM notifications WHERE "organizationId" = $1 AND ("userId" = $2 OR "userId" IS NULL) AND "isRead" = 0', [orgId, userId])).c);
    }
    return parseInt((await queryOne('SELECT COUNT(*) as c FROM notifications WHERE "organizationId" = $1 AND "isRead" = 0', [orgId])).c);
  }

  async markNotificationRead(id: string) {
    await execute('UPDATE notifications SET "isRead" = 1 WHERE id = $1', [id]);
  }

  async markAllNotificationsRead(orgId: string, userId?: string) {
    if (userId) {
      await execute('UPDATE notifications SET "isRead" = 1 WHERE "organizationId" = $1 AND ("userId" = $2 OR "userId" IS NULL)', [orgId, userId]);
    } else {
      await execute('UPDATE notifications SET "isRead" = 1 WHERE "organizationId" = $1', [orgId]);
    }
  }

  // Enhanced inbox with new filters
  async getInboxMessagesEnhanced(organizationId: string, filters: {
    status?: string; emailAccountId?: string; campaignId?: string; replyType?: string;
    bounceType?: string; leadStatus?: string; assignedTo?: string; isStarred?: boolean;
    search?: string; viewMode?: string;
  }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM unified_inbox WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;

    // Warmup detection: fromEmail is any org-connected account (email_accounts ∪ warmup_accounts).
    // Exclude traffic where the sender is one of our own mailboxes (warmup chatter), regardless of recipient.
    const extractFrom = `LOWER(CASE WHEN "fromEmail" LIKE '%<%>%' THEN substring("fromEmail" from '<([^>]+)>') ELSE "fromEmail" END)`;
    const extractTo = `LOWER(CASE WHEN "toEmail" LIKE '%<%>%' THEN substring("toEmail" from '<([^>]+)>') ELSE COALESCE("toEmail",'') END)`;
    const orgEmails = `(
      SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = $1 AND email IS NOT NULL
      UNION
      SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
        JOIN email_accounts ea ON ea.id = wa."emailAccountId"
        WHERE wa."organizationId" = $1 AND ea.email IS NOT NULL
    )`;
    const warmupExclude = ` AND ${extractFrom} NOT IN ${orgEmails}`;
    const warmupOnly = ` AND ${extractFrom} IN ${orgEmails} AND ${extractTo} IN ${orgEmails}`;

    if (filters?.status === 'warmup') {
      sql += warmupOnly;
    } else if (filters?.status === 'bounced') {
      sql += ` AND (status = 'bounced' OR "bounceType" != '')` + warmupExclude;
    } else if (filters?.status === 'unsubscribed') {
      sql += ` AND "replyType" = 'unsubscribe'`;
    } else if (filters?.status === 'replied') {
      // Emails where a team member has sent a reply back to the contact.
      // Detects both in-app replies (repliedBy/status='replied') AND native-client
      // replies (subsequent message in same thread from an org-connected account).
      sql += ` AND (
        "repliedBy" IS NOT NULL
        OR (status = 'replied' AND "repliedAt" IS NOT NULL)
        OR ("threadId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM unified_inbox ui2
          WHERE ui2."threadId" = unified_inbox."threadId"
            AND ui2."organizationId" = unified_inbox."organizationId"
            AND ui2."receivedAt" > unified_inbox."receivedAt"
            AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN ${orgEmails}
        ))
      )` + warmupExclude;
    } else if (filters?.status === 'not_replied') {
      // Human replies that haven't been responded to yet — exclude threads where
      // a team member has replied via native client (subsequent inbox row from org account).
      sql += ` AND "replyType" IN ('positive','negative','general')
        AND (status != 'replied' AND "repliedAt" IS NULL)
        AND "repliedBy" IS NULL
        AND NOT (
          "threadId" IS NOT NULL AND EXISTS (
            SELECT 1 FROM unified_inbox ui2
            WHERE ui2."threadId" = unified_inbox."threadId"
              AND ui2."organizationId" = unified_inbox."organizationId"
              AND ui2."receivedAt" > unified_inbox."receivedAt"
              AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN ${orgEmails}
          )
        )` + warmupExclude;
    } else if (filters?.status && filters.status !== 'all') {
      sql += ` AND status = $${idx++}` + warmupExclude; params.push(filters.status);
    } else {
      // "all" view — exclude warmup emails so they don't clutter inbox
      sql += warmupExclude;
    }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ` AND "emailAccountId" = $${idx++}`; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND "emailAccountId" IN (${accountIds.map(() => `$${idx++}`).join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ` AND "campaignId" = $${idx++}`; params.push(filters.campaignId); }
    if (filters?.replyType) { sql += ` AND "replyType" = $${idx++}`; params.push(filters.replyType); }
    if (filters?.bounceType) { sql += ` AND "bounceType" = $${idx++}`; params.push(filters.bounceType); }
    if (filters?.leadStatus) { sql += ` AND "leadStatus" = $${idx++}`; params.push(filters.leadStatus); }
    if (filters?.assignedTo) { sql += ` AND "assignedTo" = $${idx++}`; params.push(filters.assignedTo); }
    if (filters?.isStarred) { sql += ' AND "isStarred" = 1'; }
    if (filters?.search) {
      sql += ` AND (subject ILIKE $${idx} OR "fromEmail" ILIKE $${idx} OR "fromName" ILIKE $${idx} OR snippet ILIKE $${idx})`;
      params.push(`%${filters.search}%`);
      idx++;
    }

    sql += ` ORDER BY "receivedAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  async getInboxMessageCountEnhanced(organizationId: string, filters: {
    status?: string; emailAccountId?: string; campaignId?: string; replyType?: string;
    assignedTo?: string; search?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1';
    const params: any[] = [organizationId];
    let idx = 2;

    const extractFromC = `LOWER(CASE WHEN "fromEmail" LIKE '%<%>%' THEN substring("fromEmail" from '<([^>]+)>') ELSE "fromEmail" END)`;
    const extractToC = `LOWER(CASE WHEN "toEmail" LIKE '%<%>%' THEN substring("toEmail" from '<([^>]+)>') ELSE COALESCE("toEmail",'') END)`;
    const orgEmailsC = `(
      SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = $1 AND email IS NOT NULL
      UNION
      SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
        JOIN email_accounts ea ON ea.id = wa."emailAccountId"
        WHERE wa."organizationId" = $1 AND ea.email IS NOT NULL
    )`;
    const warmupExcludeCount = ` AND ${extractFromC} NOT IN ${orgEmailsC}`;
    const warmupOnlyCount = ` AND ${extractFromC} IN ${orgEmailsC} AND ${extractToC} IN ${orgEmailsC}`;

    if (filters?.status === 'warmup') {
      sql += warmupOnlyCount;
    } else if (filters?.status === 'bounced') {
      sql += ` AND (status = 'bounced' OR "bounceType" != '')` + warmupExcludeCount;
    } else if (filters?.status === 'unsubscribed') {
      sql += ` AND "replyType" = 'unsubscribe'`;
    } else if (filters?.status === 'replied') {
      sql += ` AND (
        "repliedBy" IS NOT NULL
        OR (status = 'replied' AND "repliedAt" IS NOT NULL)
        OR ("threadId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM unified_inbox ui2
          WHERE ui2."threadId" = unified_inbox."threadId"
            AND ui2."organizationId" = unified_inbox."organizationId"
            AND ui2."receivedAt" > unified_inbox."receivedAt"
            AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN ${orgEmailsC}
        ))
      )` + warmupExcludeCount;
    } else if (filters?.status === 'not_replied') {
      sql += ` AND "replyType" IN ('positive','negative','general')
        AND (status != 'replied' AND "repliedAt" IS NULL)
        AND "repliedBy" IS NULL
        AND NOT (
          "threadId" IS NOT NULL AND EXISTS (
            SELECT 1 FROM unified_inbox ui2
            WHERE ui2."threadId" = unified_inbox."threadId"
              AND ui2."organizationId" = unified_inbox."organizationId"
              AND ui2."receivedAt" > unified_inbox."receivedAt"
              AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN ${orgEmailsC}
          )
        )` + warmupExcludeCount;
    } else if (filters?.status && filters.status !== 'all') {
      sql += ` AND status = $${idx++}` + warmupExcludeCount; params.push(filters.status);
    } else {
      sql += warmupExcludeCount;
    }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ` AND "emailAccountId" = $${idx++}`; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND "emailAccountId" IN (${accountIds.map(() => `$${idx++}`).join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ` AND "campaignId" = $${idx++}`; params.push(filters.campaignId); }
    if (filters?.replyType) { sql += ` AND "replyType" = $${idx++}`; params.push(filters.replyType); }
    if (filters?.assignedTo) { sql += ` AND "assignedTo" = $${idx++}`; params.push(filters.assignedTo); }
    if (filters?.search) {
      sql += ` AND (subject ILIKE $${idx} OR "fromEmail" ILIKE $${idx} OR "fromName" ILIKE $${idx} OR snippet ILIKE $${idx})`;
      params.push(`%${filters.search}%`);
      idx++;
    }
    return parseInt((await queryOne(sql, params)).c);
  }

  async getInboxStats(organizationId: string, accountIds?: string[]) {
    // Warmup detection: both fromEmail AND toEmail are org email accounts
    const exF = `LOWER(CASE WHEN "fromEmail" LIKE '%<%>%' THEN substring("fromEmail" from '<([^>]+)>') ELSE "fromEmail" END)`;
    const exT = `LOWER(CASE WHEN "toEmail" LIKE '%<%>%' THEN substring("toEmail" from '<([^>]+)>') ELSE COALESCE("toEmail",'') END)`;
    const oE = `(
      SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = $1 AND email IS NOT NULL
      UNION
      SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
        JOIN email_accounts ea ON ea.id = wa."emailAccountId"
        WHERE wa."organizationId" = $1 AND ea.email IS NOT NULL
    )`;
    const warmupExcludeSql = `AND ${exF} NOT IN ${oE}`;
    const warmupOnlySql = `AND ${exF} IN ${oE} AND ${exT} IN ${oE}`;

    // Scope to specific email accounts when provided (non-admin members)
    const params: any[] = [organizationId];
    let acctScope = '';
    if (accountIds && accountIds.length > 0) {
      const placeholders = accountIds.map((_, i) => `$${i + 2}`).join(',');
      acctScope = ` AND "emailAccountId" IN (${placeholders})`;
      params.push(...accountIds);
    }

    const total = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 ${warmupExcludeSql}${acctScope}`, params)).c);
    const unread = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND status = 'unread' ${warmupExcludeSql}${acctScope}`, params)).c);
    const teamRepliedInThread = `("threadId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM unified_inbox ui2
      WHERE ui2."threadId" = unified_inbox."threadId"
        AND ui2."organizationId" = unified_inbox."organizationId"
        AND ui2."receivedAt" > unified_inbox."receivedAt"
        AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN ${oE}
    ))`;
    const repliedFilter = `AND ("repliedBy" IS NOT NULL OR (status = 'replied' AND "repliedAt" IS NOT NULL) OR ${teamRepliedInThread})`;
    const replied = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 ${repliedFilter} ${warmupExcludeSql}${acctScope}`, params)).c);
    const archived = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND status = 'archived'${acctScope}`, params)).c);
    const positive = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "replyType" = 'positive'${acctScope}`, params)).c);
    const negative = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "replyType" = 'negative'${acctScope}`, params)).c);
    const ooo = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "replyType" = 'ooo'${acctScope}`, params)).c);
    const autoReply = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "replyType" = 'auto_reply'${acctScope}`, params)).c);
    const bounced = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND ("bounceType" != '' AND "bounceType" IS NOT NULL) ${warmupExcludeSql}${acctScope}`, params)).c);
    const starred = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "isStarred" = 1${acctScope}`, params)).c);
    const warmup = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 ${warmupOnlySql}${acctScope}`, params)).c);
    const notReplied = parseInt((await queryOne(`SELECT COUNT(*) as c FROM unified_inbox WHERE "organizationId" = $1 AND "replyType" IN ('positive','negative','general') AND (status != 'replied' AND "repliedAt" IS NULL) AND "repliedBy" IS NULL AND NOT ${teamRepliedInThread} ${warmupExcludeSql}${acctScope}`, params)).c);
    return { total, unread, replied, archived, positive, negative, ooo, autoReply, bounced, starred, warmup, notReplied };
  }

  // ========== DATABASE EXPORT/IMPORT ==========
  exportTable(tableName: string): any[] {
    // NOTE: This is async in PG, but we return a sync-compatible empty array
    // For actual use, call exportTableAsync
    console.warn('[PG] exportTable called synchronously — use exportTableAsync instead');
    return [];
  }

  async exportTableAsync(tableName: string): Promise<any[]> {
    const validTables = [
      'users', 'organizations', 'org_members', 'api_settings',
      'email_accounts', 'templates', 'campaigns', 'messages', 'contacts',
      'contact_lists', 'tracking_events',
      'unified_inbox', 'followup_sequences', 'followup_steps',
    ];
    if (!validTables.includes(tableName)) throw new Error(`Invalid table name: ${tableName}`);
    try {
      return await queryAll(`SELECT * FROM "${tableName}"`);
    } catch (e) {
      console.warn(`[PG] exportTable: table ${tableName} does not exist`);
      return [];
    }
  }

  importTable(tableName: string, rows: any[]): { imported: number; errors: number } {
    // NOTE: This is async in PG, but we return sync-compatible result
    // For actual use, call importTableAsync
    console.warn('[PG] importTable called synchronously — use importTableAsync instead');
    return { imported: 0, errors: 0 };
  }

  async importTableAsync(tableName: string, rows: any[]): Promise<{ imported: number; errors: number }> {
    const validTables = [
      'users', 'organizations', 'org_members', 'api_settings',
      'email_accounts', 'templates', 'campaigns', 'messages', 'contacts',
      'contact_lists', 'tracking_events',
      'unified_inbox', 'followup_sequences', 'followup_steps',
    ];
    if (!validTables.includes(tableName)) throw new Error(`Invalid table name: ${tableName}`);

    let imported = 0;
    let errors = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const ph = columns.map((_, i) => `$${i + 1}`).join(', ');
          const colNames = columns.map(c => `"${c}"`).join(', ');
          const result = await client.query(`INSERT INTO "${tableName}" (${colNames}) VALUES (${ph}) ON CONFLICT DO NOTHING`, values);
          if (result.rowCount && result.rowCount > 0) imported++;
        } catch (e) {
          errors++;
          if (errors <= 3) console.warn(`[PG] importTable ${tableName} row error:`, e);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { imported, errors };
  }

  /** Compatibility proxy for raw db access — returns the pool */
  get db() { return pool; }

  /** Get the database path (returns identifier for PostgreSQL) */
  getDbPath(): string { return 'postgresql'; }

  /** Run a direct SQL statement */
  async runDirectSQL(sql: string, params: any[] = []): Promise<any> {
    return pool.query(sql, params);
  }

  /** Check if running on Azure */
  isAzureEnvironment(): boolean {
    return !!(process.env.WEBSITE_SITE_NAME || process.env.AZURE_WEBAPP_NAME ||
              process.env.APPSETTING_WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID ||
              process.env.WEBSITE_HOSTNAME || process.env.WEBSITE_RESOURCE_GROUP);
  }

  // ========== CONTEXT ENGINE — Org Documents ==========
  async createOrgDocument(doc: { id: string; organizationId: string; name: string; docType: string; source: string; content: string; summary?: string; tags?: string[]; metadata?: any; fileSize?: number; mimeType?: string; uploadedBy?: string }) {
    const ts = now();
    await execute(
      `INSERT INTO org_documents (id, "organizationId", name, "docType", source, content, summary, tags, metadata, "fileSize", "mimeType", "uploadedBy", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [doc.id, doc.organizationId, doc.name, doc.docType, doc.source, doc.content, doc.summary || '',
      JSON.stringify(doc.tags || []), JSON.stringify(doc.metadata || {}), doc.fileSize || 0, doc.mimeType || '', doc.uploadedBy || '', ts, ts]
    );
    return this.getOrgDocument(doc.id);
  }

  async getOrgDocument(id: string) { return queryOne('SELECT * FROM org_documents WHERE id = $1', [id]); }

  async getOrgDocuments(orgId: string, filters?: { docType?: string; source?: string; search?: string }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM org_documents WHERE "organizationId" = $1';
    const params: any[] = [orgId];
    let idx = 2;
    if (filters?.docType) { sql += ` AND "docType" = $${idx++}`; params.push(filters.docType); }
    if (filters?.source) { sql += ` AND source = $${idx++}`; params.push(filters.source); }
    if (filters?.search) {
      // Try tsvector search first
      try {
        const ftsResults = await queryAll(
          `SELECT id FROM org_documents WHERE "organizationId" = $1 AND search_vector @@ plainto_tsquery('english', $2) ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC LIMIT $3`,
          [orgId, filters.search, limit]
        );
        if (ftsResults.length > 0) {
          const ids = ftsResults.map(r => r.id);
          const ph = ids.map((_, i) => `$${i + 2}`).join(',');
          return queryAll(`SELECT * FROM org_documents WHERE "organizationId" = $1 AND id IN (${ph}) ORDER BY "updatedAt" DESC`, [orgId, ...ids]);
        }
      } catch { /* FTS not available, fall through to ILIKE */ }
      sql += ` AND (LOWER(name) ILIKE $${idx} OR LOWER(content) ILIKE $${idx} OR tags::text ILIKE $${idx})`;
      params.push(`%${filters.search.toLowerCase()}%`);
      idx++;
    }
    sql += ` ORDER BY "updatedAt" DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    return queryAll(sql, params);
  }

  async getOrgDocumentsCount(orgId: string, filters?: { docType?: string; source?: string }) {
    let sql = 'SELECT COUNT(*) as cnt FROM org_documents WHERE "organizationId" = $1';
    const params: any[] = [orgId];
    let idx = 2;
    if (filters?.docType) { sql += ` AND "docType" = $${idx++}`; params.push(filters.docType); }
    if (filters?.source) { sql += ` AND source = $${idx++}`; params.push(filters.source); }
    return parseInt((await queryOne(sql, params)).cnt);
  }

  async updateOrgDocument(id: string, updates: Partial<{ name: string; docType: string; content: string; summary: string; tags: string[]; metadata: any }>) {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (updates.name !== undefined) { sets.push(`name = $${idx++}`); params.push(updates.name); }
    if (updates.docType !== undefined) { sets.push(`"docType" = $${idx++}`); params.push(updates.docType); }
    if (updates.content !== undefined) { sets.push(`content = $${idx++}`); params.push(updates.content); }
    if (updates.summary !== undefined) { sets.push(`summary = $${idx++}`); params.push(updates.summary); }
    if (updates.tags !== undefined) { sets.push(`tags = $${idx++}`); params.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(updates.metadata)); }
    sets.push(`"updatedAt" = $${idx++}`); params.push(now());
    params.push(id);
    await execute(`UPDATE org_documents SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    // search_vector is auto-updated by trigger
    return this.getOrgDocument(id);
  }

  async deleteOrgDocument(id: string) {
    await execute('DELETE FROM org_documents WHERE id = $1', [id]);
  }

  async searchOrgDocuments(orgId: string, query: string, limit = 10): Promise<any[]> {
    // Try tsvector search first
    try {
      const results = await queryAll(`
        SELECT od.*, ts_rank(od.search_vector, plainto_tsquery('english', $2)) as rank
        FROM org_documents od
        WHERE od."organizationId" = $1 AND od.search_vector @@ plainto_tsquery('english', $2)
        ORDER BY rank DESC
        LIMIT $3
      `, [orgId, query, limit]);
      if (results.length > 0) return results;
    } catch { /* FTS not available */ }
    // Fallback: ILIKE search
    const q = `%${query.toLowerCase()}%`;
    return queryAll(`SELECT * FROM org_documents WHERE "organizationId" = $1 AND (LOWER(name) ILIKE $2 OR LOWER(content) ILIKE $2 OR LOWER(summary) ILIKE $2 OR tags::text ILIKE $2) ORDER BY "updatedAt" DESC LIMIT $3`, [orgId, q, limit]);
  }

  // ===== EMAIL ATTACHMENTS =====
  async createAttachment(data: { organizationId: string; templateId?: string; campaignId?: string; fileName: string; fileSize: number; mimeType: string; content: string }) {
    const id = genId();
    await execute(
      'INSERT INTO email_attachments (id, "organizationId", "templateId", "campaignId", "fileName", "fileSize", "mimeType", content, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, data.organizationId, data.templateId || null, data.campaignId || null, data.fileName, data.fileSize, data.mimeType, data.content, now()]
    );
    return { id, ...data, createdAt: now() };
  }

  async getAttachments(orgId: string, opts: { templateId?: string; campaignId?: string }) {
    if (opts.templateId) {
      return queryAll('SELECT id, "fileName", "fileSize", "mimeType", "createdAt" FROM email_attachments WHERE "organizationId" = $1 AND "templateId" = $2', [orgId, opts.templateId]);
    }
    if (opts.campaignId) {
      return queryAll('SELECT id, "fileName", "fileSize", "mimeType", "createdAt" FROM email_attachments WHERE "organizationId" = $1 AND "campaignId" = $2', [orgId, opts.campaignId]);
    }
    return [];
  }

  async getAttachment(id: string, orgId: string) {
    return queryOne('SELECT * FROM email_attachments WHERE id = $1 AND "organizationId" = $2', [id, orgId]);
  }

  async deleteAttachment(id: string, orgId: string) {
    await execute('DELETE FROM email_attachments WHERE id = $1 AND "organizationId" = $2', [id, orgId]);
  }

  async copyAttachmentsTocampaign(templateId: string, campaignId: string, orgId: string) {
    const attachments = await queryAll('SELECT * FROM email_attachments WHERE "organizationId" = $1 AND "templateId" = $2', [orgId, templateId]);
    for (const att of attachments) {
      const id = genId();
      await execute(
        'INSERT INTO email_attachments (id, "organizationId", "templateId", "campaignId", "fileName", "fileSize", "mimeType", content, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, orgId, null, campaignId, att.fileName, att.fileSize, att.mimeType, att.content, now()]
      );
    }
  }

  // ===== Raw SQL helpers for cross-backend compatibility =====
  // Accepts SQLite-style ? placeholders — auto-converts to $1, $2, ... for PostgreSQL
  private pgSql(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }
  async rawGet(sql: string, ...params: any[]): Promise<any> {
    return queryOne(this.pgSql(sql), params);
  }
  async rawAll(sql: string, ...params: any[]): Promise<any[]> {
    return queryAll(this.pgSql(sql), params);
  }
  async rawRun(sql: string, ...params: any[]): Promise<void> {
    await execute(this.pgSql(sql), params);
  }

  // ===== GUARDRAIL: resetCorruptDatabase =====
  resetCorruptDatabase(): { success: boolean; message: string } {
    console.error('[PG] resetCorruptDatabase called but BLOCKED — this method is disabled');
    return { success: false, message: 'Database reset is disabled for PostgreSQL.' };
  }
}

// Factory function
export async function createPostgresStorage(): Promise<PostgresStorage> {
  const storage = new PostgresStorage();
  await storage.ensureInitialized();
  return storage;
}
