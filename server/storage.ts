// Persistent SQLite storage for MailFlow
// Data is stored in ./data/mailflow.db and survives server restarts
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '..', 'data', 'mailflow.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// High-volume performance tuning
db.pragma('synchronous = NORMAL');      // Faster writes (WAL provides crash safety)
db.pragma('cache_size = -64000');       // 64MB cache (default is 2MB)
db.pragma('temp_store = MEMORY');       // Use RAM for temp tables
db.pragma('mmap_size = 268435456');     // 256MB memory-mapped I/O
db.pragma('wal_autocheckpoint = 1000'); // Checkpoint every 1000 pages

function genId() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

// JSON helpers: store arrays/objects as JSON text in SQLite
function toJson(v: any): string | null { return v != null ? JSON.stringify(v) : null; }
function fromJson(v: any): any { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } }
// Convert Date to ISO string for SQLite binding
function toSqlDate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

// Hydrate a row: parse JSON columns back to objects
function hydrateContact(r: any) {
  if (!r) return null;
  return { ...r, tags: fromJson(r.tags) || [], customFields: fromJson(r.customFields) || {}, emailRatingDetails: fromJson(r.emailRatingDetails) || {} };
}
function hydrateCampaign(r: any) {
  if (!r) return null;
  return { ...r, contactIds: fromJson(r.contactIds) || [] };
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

// ========== SCHEMA ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    settings TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    firstName TEXT,
    lastName TEXT,
    role TEXT DEFAULT 'admin',
    organizationId TEXT NOT NULL,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_accounts (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    provider TEXT,
    email TEXT NOT NULL,
    displayName TEXT,
    smtpConfig TEXT,
    dailyLimit INTEGER DEFAULT 500,
    dailySent INTEGER DEFAULT 0,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS llm_configs (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    isPrimary INTEGER DEFAULT 0,
    isActive INTEGER DEFAULT 1,
    monthlyCost REAL DEFAULT 0,
    monthlyLimit INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contact_lists (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT DEFAULT 'csv',
    headers TEXT DEFAULT '[]',
    contactCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    email TEXT NOT NULL,
    firstName TEXT,
    lastName TEXT,
    company TEXT,
    jobTitle TEXT,
    phone TEXT,
    mobilePhone TEXT,
    linkedinUrl TEXT,
    seniority TEXT,
    department TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    website TEXT,
    industry TEXT,
    employeeCount TEXT,
    annualRevenue TEXT,
    companyLinkedinUrl TEXT,
    companyCity TEXT,
    companyState TEXT,
    companyCountry TEXT,
    companyAddress TEXT,
    companyPhone TEXT,
    secondaryEmail TEXT,
    homePhone TEXT,
    emailStatus TEXT,
    lastActivityDate TEXT,
    status TEXT DEFAULT 'cold',
    score INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    customFields TEXT DEFAULT '{}',
    source TEXT DEFAULT 'manual',
    listId TEXT,
    assignedTo TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organizationId);
  CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(organizationId, email);
  CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(listId);

  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    filters TEXT,
    contactCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    subject TEXT,
    content TEXT,
    variables TEXT DEFAULT '[]',
    isPublic INTEGER DEFAULT 0,
    usageCount INTEGER DEFAULT 0,
    createdBy TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft',
    totalRecipients INTEGER DEFAULT 0,
    sentCount INTEGER DEFAULT 0,
    openedCount INTEGER DEFAULT 0,
    clickedCount INTEGER DEFAULT 0,
    repliedCount INTEGER DEFAULT 0,
    bouncedCount INTEGER DEFAULT 0,
    unsubscribedCount INTEGER DEFAULT 0,
    subject TEXT,
    content TEXT,
    emailAccountId TEXT,
    templateId TEXT,
    contactIds TEXT DEFAULT '[]',
    segmentId TEXT,
    scheduledAt TEXT,
    createdBy TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organizationId);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL,
    contactId TEXT,
    subject TEXT,
    content TEXT,
    status TEXT DEFAULT 'sending',
    trackingId TEXT,
    emailAccountId TEXT,
    stepNumber INTEGER DEFAULT 0,
    sentAt TEXT,
    openedAt TEXT,
    clickedAt TEXT,
    repliedAt TEXT,
    errorMessage TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaignId);
  CREATE INDEX IF NOT EXISTS idx_messages_tracking ON messages(trackingId);

  CREATE TABLE IF NOT EXISTS tracking_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    campaignId TEXT,
    messageId TEXT,
    contactId TEXT,
    trackingId TEXT,
    url TEXT,
    userAgent TEXT,
    ip TEXT,
    metadata TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_campaign ON tracking_events(campaignId);
  CREATE INDEX IF NOT EXISTS idx_events_message ON tracking_events(messageId);

  CREATE TABLE IF NOT EXISTS unsubscribes (
    id TEXT PRIMARY KEY,
    organizationId TEXT,
    email TEXT,
    contactId TEXT,
    campaignId TEXT,
    reason TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    type TEXT,
    name TEXT,
    isActive INTEGER DEFAULT 1,
    lastSyncAt TEXT,
    syncCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followup_sequences (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    isActive INTEGER DEFAULT 1,
    createdBy TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followup_steps (
    id TEXT PRIMARY KEY,
    sequenceId TEXT NOT NULL,
    stepNumber INTEGER DEFAULT 0,
    trigger TEXT,
    delayDays INTEGER DEFAULT 0,
    delayHours INTEGER DEFAULT 0,
    subject TEXT,
    content TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_followups (
    id TEXT PRIMARY KEY,
    campaignId TEXT NOT NULL,
    sequenceId TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followup_executions (
    id TEXT PRIMARY KEY,
    campaignMessageId TEXT,
    stepId TEXT,
    contactId TEXT,
    campaignId TEXT,
    status TEXT DEFAULT 'pending',
    scheduledAt TEXT,
    executedAt TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_settings (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    settingKey TEXT NOT NULL,
    settingValue TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE(organizationId, settingKey)
  );
  CREATE INDEX IF NOT EXISTS idx_api_settings_org ON api_settings(organizationId, settingKey);

  -- Unified Inbox table for aggregating replies across all email accounts
  CREATE TABLE IF NOT EXISTS unified_inbox (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    emailAccountId TEXT,
    campaignId TEXT,
    messageId TEXT,
    contactId TEXT,
    gmailMessageId TEXT,
    gmailThreadId TEXT,
    outlookMessageId TEXT,
    outlookConversationId TEXT,
    fromEmail TEXT NOT NULL,
    fromName TEXT,
    toEmail TEXT,
    subject TEXT,
    snippet TEXT,
    body TEXT,
    bodyHtml TEXT,
    status TEXT DEFAULT 'unread',
    provider TEXT,
    aiDraft TEXT,
    repliedAt TEXT,
    receivedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_org ON unified_inbox(organizationId, status);
  CREATE INDEX IF NOT EXISTS idx_inbox_account ON unified_inbox(emailAccountId);
  CREATE INDEX IF NOT EXISTS idx_inbox_campaign ON unified_inbox(campaignId);
  CREATE INDEX IF NOT EXISTS idx_inbox_contact ON unified_inbox(contactId);
  CREATE INDEX IF NOT EXISTS idx_inbox_received ON unified_inbox(receivedAt);
  CREATE INDEX IF NOT EXISTS idx_inbox_gmail ON unified_inbox(gmailMessageId);
  CREATE INDEX IF NOT EXISTS idx_inbox_outlook ON unified_inbox(outlookMessageId);
`);

// ========== MIGRATIONS for existing databases ==========
// Add new Apollo.io contact columns if they don't exist
const contactMigrationCols = [
  'phone', 'mobilePhone', 'linkedinUrl', 'seniority', 'department',
  'city', 'state', 'country', 'website', 'industry',
  'employeeCount', 'annualRevenue', 'companyLinkedinUrl',
  'companyCity', 'companyState', 'companyCountry', 'companyAddress',
  'companyPhone', 'secondaryEmail', 'homePhone', 'emailStatus', 'lastActivityDate', 'assignedTo'
];
for (const col of contactMigrationCols) {
  try { db.exec(`ALTER TABLE contacts ADD COLUMN ${col} TEXT`); } catch (e) { /* column already exists */ }
}

// Email rating columns
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailRating INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailRatingGrade TEXT DEFAULT ''`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailRatingDetails TEXT DEFAULT '{}'`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailRatingUpdatedAt TEXT`); } catch (e) { /* already exists */ }

// Create indexes on migrated columns (after migration ensures columns exist)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts(assignedTo)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_industry ON contacts(industry)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_city ON contacts(city)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_seniority ON contacts(seniority)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_email_rating ON contacts(emailRating)`); } catch (e) {}

// ========== Messages table migrations ==========
try { db.exec(`ALTER TABLE messages ADD COLUMN providerMessageId TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(providerMessageId)`); } catch (e) {}

// ========== Critical indexes for high-volume (10-20K emails/day) ==========
// Messages: needed for follow-up engine (getCampaignMessages filter by contactId+stepNumber)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contactId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sentAt)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_replied ON messages(repliedAt)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_campaign_contact ON messages(campaignId, contactId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_campaign_step ON messages(campaignId, stepNumber)`); } catch (e) {}

// Followup executions: needed for followupAlreadyExecuted check (called N*steps times per cycle)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fexec_msg_step ON followup_executions(campaignMessageId, stepId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fexec_contact ON followup_executions(contactId, status)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fexec_campaign ON followup_executions(campaignId, status)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fexec_status ON followup_executions(status, scheduledAt)`); } catch (e) {}

// Tracking events: needed for high-volume open/click tracking
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_tracking ON tracking_events(trackingId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON tracking_events(type, createdAt)`); } catch (e) {}
// Add stepNumber to tracking_events for correct step attribution
try { db.exec(`ALTER TABLE tracking_events ADD COLUMN stepNumber INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_step ON tracking_events(campaignId, stepNumber)`); } catch (e) {}

// Campaign followups: needed for processing loop
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_campaign_followups_active ON campaign_followups(isActive, campaignId)`); } catch (e) {}

// Followup steps: needed for step lookups
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_followup_steps_seq ON followup_steps(sequenceId, stepNumber)`); } catch (e) {}
// ========== Followup steps migrations ==========
try { db.exec(`ALTER TABLE followup_steps ADD COLUMN delayMinutes INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }

// ========== SEED DATA (only on first run) ==========
const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';

function seedIfEmpty() {
  const orgCount = (db.prepare('SELECT COUNT(*) as c FROM organizations').get() as any).c;
  if (orgCount > 0) return; // Already seeded

  console.log('[SQLite] Seeding initial data...');
  const ts = now();

  // Organization
  db.prepare('INSERT INTO organizations (id, name, domain, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    ORG_ID, 'MailFlow Organization', 'mailflow.app', '{}', ts, ts
  );

  // User
  db.prepare('INSERT INTO users (id, email, firstName, lastName, role, organizationId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
    'user-123', 'demo@mailflow.app', 'Demo', 'User', 'admin', ORG_ID, ts, ts
  );

  // Contacts
  const insertContact = db.prepare('INSERT INTO contacts (id, organizationId, email, firstName, lastName, company, jobTitle, status, score, tags, customFields, source, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const contacts = [
    { email: 'john@techcorp.com', firstName: 'John', lastName: 'Smith', company: 'Tech Corp', jobTitle: 'CTO', status: 'warm', score: 75, tags: ['tech', 'enterprise'], source: 'linkedin' },
    { email: 'jane@startup.io', firstName: 'Jane', lastName: 'Doe', company: 'Startup IO', jobTitle: 'CEO', status: 'hot', score: 92, tags: ['startup', 'saas'], source: 'referral' },
    { email: 'mike@enterprise.com', firstName: 'Mike', lastName: 'Johnson', company: 'Enterprise Ltd', jobTitle: 'VP Sales', status: 'cold', score: 30, tags: ['enterprise'], source: 'cold-outreach' },
    { email: 'sarah@consulting.com', firstName: 'Sarah', lastName: 'Wilson', company: 'Consulting Group', jobTitle: 'Director', status: 'warm', score: 65, tags: ['consulting'], source: 'website' },
    { email: 'david@agency.co', firstName: 'David', lastName: 'Brown', company: 'Creative Agency', jobTitle: 'Marketing Lead', status: 'replied', score: 88, tags: ['agency', 'marketing'], source: 'event' },
  ];
  for (const c of contacts) {
    insertContact.run(genId(), ORG_ID, c.email, c.firstName, c.lastName, c.company, c.jobTitle, c.status, c.score, toJson(c.tags), '{}', c.source, ts, ts);
  }

  // Seed contacts for tracking
  const seedContacts = [
    { id: 'seed-c1', email: 'alice@bigcorp.com', firstName: 'Alice', lastName: 'Chen', company: 'BigCorp Inc' },
    { id: 'seed-c2', email: 'bob@techstart.io', firstName: 'Bob', lastName: 'Williams', company: 'TechStart' },
    { id: 'seed-c3', email: 'carol@enterprise.co', firstName: 'Carol', lastName: 'Martinez', company: 'Enterprise Co' },
    { id: 'seed-c4', email: 'dan@agency.com', firstName: 'Dan', lastName: 'Kim', company: 'Creative Agency' },
    { id: 'seed-c5', email: 'eva@startup.ai', firstName: 'Eva', lastName: 'Patel', company: 'Startup AI' },
    { id: 'seed-c6', email: 'frank@consulting.biz', firstName: 'Frank', lastName: 'Lopez', company: 'Consulting Group' },
    { id: 'seed-c7', email: 'grace@fintech.io', firstName: 'Grace', lastName: 'Nguyen', company: 'FinTech Solutions' },
    { id: 'seed-c8', email: 'henry@saas.dev', firstName: 'Henry', lastName: 'Brown', company: 'SaaS Dev Co' },
    { id: 'seed-c9', email: 'irene@marketing.co', firstName: 'Irene', lastName: 'Taylor', company: 'Marketing Pro' },
    { id: 'seed-c10', email: 'jack@venture.vc', firstName: 'Jack', lastName: 'Davis', company: 'Venture Capital' },
  ];
  for (const sc of seedContacts) {
    const score = Math.floor(Math.random() * 60) + 40;
    insertContact.run(sc.id, ORG_ID, sc.email, sc.firstName, sc.lastName, sc.company, '', 'warm', score, toJson(['seed']), '{}', 'seed', '2025-07-01T00:00:00.000Z', ts);
  }

  // Templates
  const insertTemplate = db.prepare('INSERT INTO templates (id, organizationId, name, category, subject, content, variables, isPublic, usageCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertTemplate.run(genId(), ORG_ID, 'Welcome Email', 'onboarding', 'Welcome to {{company}}!', '<p>Hi {{firstName}},</p><p>Welcome aboard!</p>', toJson(['firstName', 'company']), 0, 45, '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z');
  insertTemplate.run(genId(), ORG_ID, 'Follow-up Template', 'follow-up', 'Quick follow-up - {{topic}}', '<p>Hi {{firstName}},</p><p>Just wanted to follow up about {{topic}}.</p>', toJson(['firstName', 'topic', 'senderName']), 0, 23, '2025-08-28T00:00:00.000Z', '2025-08-28T00:00:00.000Z');
  insertTemplate.run(genId(), ORG_ID, 'Product Launch Announcement', 'marketing', 'Introducing {{productName}}!', '<p>Hi {{firstName}},</p><p>We are excited to announce <strong>{{productName}}</strong>!</p>', toJson(['firstName', 'productName']), 1, 67, '2025-08-25T00:00:00.000Z', '2025-08-25T00:00:00.000Z');
  insertTemplate.run(genId(), ORG_ID, 'Cold Outreach', 'outreach', 'Hi {{firstName}}, quick question about {{company}}', '<p>Hi {{firstName}},</p><p>I came across {{company}} and was impressed.</p>', toJson(['firstName', 'company', 'senderName']), 0, 12, '2025-09-10T00:00:00.000Z', '2025-09-10T00:00:00.000Z');

  // Campaigns
  const CIDS = {
    q4: 'camp-q4-product-launch-001',
    onboard: 'camp-onboarding-series-002',
    reengage: 'camp-reengagement-003',
    newsletter: 'camp-newsletter-aug-004',
    cold: 'camp-cold-outreach-005',
  };
  const insertCampaign = db.prepare('INSERT INTO campaigns (id, organizationId, name, description, status, totalRecipients, sentCount, openedCount, clickedCount, repliedCount, bouncedCount, unsubscribedCount, subject, content, contactIds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertCampaign.run(CIDS.q4, ORG_ID, 'Q4 Product Launch', 'New feature announcement', 'completed', 1250, 1180, 720, 345, 89, 12, 5, 'Exciting news from MailFlow!', '<p>Hi {{firstName}},</p><p>We have exciting news!</p>', '[]', '2025-08-15T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.onboard, ORG_ID, 'Customer Onboarding Series', 'Welcome email sequence', 'completed', 450, 430, 312, 156, 42, 3, 2, 'Welcome to MailFlow!', '<p>Hi {{firstName}},</p><p>Welcome!</p>', '[]', '2025-08-20T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.reengage, ORG_ID, 'Re-engagement Campaign', 'Win back inactive users', 'scheduled', 890, 0, 0, 0, 0, 0, 0, '', '', '[]', '2025-09-01T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.newsletter, ORG_ID, 'Newsletter - August', 'Monthly newsletter', 'completed', 2400, 2380, 1450, 678, 120, 20, 15, 'MailFlow August Newsletter', '<p>Hi {{firstName}},</p><p>Monthly update.</p>', '[]', '2025-08-01T00:00:00.000Z', '2025-08-30T00:00:00.000Z');
  insertCampaign.run(CIDS.cold, ORG_ID, 'Cold Outreach - Tech', 'Tech industry outreach', 'draft', 0, 0, 0, 0, 0, 0, 0, '', '', '[]', '2025-09-02T00:00:00.000Z', ts);

  // Seed messages + tracking events for Q4 Product Launch
  const insertMsg = db.prepare('INSERT INTO messages (id, campaignId, contactId, subject, content, status, trackingId, stepNumber, sentAt, openedAt, clickedAt, repliedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertEvt = db.prepare('INSERT INTO tracking_events (id, type, campaignId, messageId, contactId, trackingId, url, userAgent, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

  const seedBatch = db.transaction(() => {
    const nowMs = Date.now();
    const dayMs = 86400000;

    // Q4 Product Launch messages
    seedContacts.forEach((contact, i) => {
      const trackingId = `${CIDS.q4}_${contact.id}_seed_${i}`;
      const sentTime = new Date(nowMs - (10 - i) * dayMs - Math.random() * dayMs).toISOString();
      const msgId = `msg-seed-001-${i}`;
      const rand = Math.random();
      const hasOpen = rand < 0.7;
      const hasClick = rand < 0.35;
      const hasReply = rand < 0.12;
      const isBounced = rand > 0.97;

      const openTime = hasOpen ? new Date(new Date(sentTime).getTime() + Math.random() * 3600000).toISOString() : null;
      const clickTime = hasClick ? new Date(new Date(sentTime).getTime() + Math.random() * 7200000).toISOString() : null;
      const replyTime = hasReply ? new Date(new Date(sentTime).getTime() + Math.random() * dayMs).toISOString() : null;

      insertMsg.run(msgId, CIDS.q4, contact.id, 'Exciting news from MailFlow!', `<p>Hi ${contact.firstName},</p><p>We have exciting news...</p>`, isBounced ? 'failed' : 'sent', trackingId, 0, isBounced ? null : sentTime, openTime, clickTime, replyTime, sentTime);

      insertEvt.run(`evt-sent-${msgId}`, 'sent', CIDS.q4, msgId, contact.id, trackingId, null, null, null, sentTime);
      if (hasOpen) {
        insertEvt.run(`evt-open-${msgId}`, 'open', CIDS.q4, msgId, contact.id, trackingId, null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', null, openTime);
        if (Math.random() < 0.3) {
          insertEvt.run(`evt-open2-${msgId}`, 'open', CIDS.q4, msgId, contact.id, trackingId, null, null, null, new Date(new Date(openTime!).getTime() + Math.random() * dayMs).toISOString());
        }
      }
      if (hasClick) insertEvt.run(`evt-click-${msgId}`, 'click', CIDS.q4, msgId, contact.id, trackingId, 'https://mailflow.app/features', null, null, clickTime);
      if (hasReply) insertEvt.run(`evt-reply-${msgId}`, 'reply', CIDS.q4, msgId, contact.id, trackingId, null, null, null, replyTime);
      if (isBounced) insertEvt.run(`evt-bounce-${msgId}`, 'bounce', CIDS.q4, msgId, contact.id, trackingId, null, null, toJson({ error: 'Mailbox not found' }), sentTime);
    });

    // Newsletter messages
    seedContacts.slice(0, 6).forEach((contact, i) => {
      const trackingId = `${CIDS.newsletter}_${contact.id}_seed_${i}`;
      const sentTime = new Date(nowMs - (15 + i) * dayMs).toISOString();
      const msgId = `msg-seed-nl-${i}`;
      const hasOpen = Math.random() < 0.65;
      const hasClick = Math.random() < 0.3;
      const hasReply = Math.random() < 0.08;

      const openTime = hasOpen ? new Date(new Date(sentTime).getTime() + Math.random() * 7200000).toISOString() : null;
      const clickTime = hasClick ? new Date(new Date(sentTime).getTime() + Math.random() * 14400000).toISOString() : null;
      const replyTime = hasReply ? new Date(new Date(sentTime).getTime() + Math.random() * dayMs).toISOString() : null;

      insertMsg.run(msgId, CIDS.newsletter, contact.id, 'MailFlow August Newsletter', `<p>Hi ${contact.firstName},</p><p>Monthly update...</p>`, 'sent', trackingId, 0, sentTime, openTime, clickTime, replyTime, sentTime);
      insertEvt.run(`evt-sent-nl-${i}`, 'sent', CIDS.newsletter, msgId, contact.id, trackingId, null, null, null, sentTime);
      if (hasOpen) insertEvt.run(`evt-open-nl-${i}`, 'open', CIDS.newsletter, msgId, contact.id, trackingId, null, null, null, openTime);
      if (hasClick) insertEvt.run(`evt-click-nl-${i}`, 'click', CIDS.newsletter, msgId, contact.id, trackingId, 'https://mailflow.app/blog/august-update', null, null, clickTime);
      if (hasReply) insertEvt.run(`evt-reply-nl-${i}`, 'reply', CIDS.newsletter, msgId, contact.id, trackingId, null, null, null, replyTime);
    });
  });

  seedBatch();
  console.log('[SQLite] Seed complete.');
}

seedIfEmpty();

// ========== DatabaseStorage class (all methods use SQLite) ==========
export class DatabaseStorage {
  // ========== Organization ==========
  async getOrganization(id: string) { return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) || null; }
  async createOrganization(org: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO organizations (id, name, domain, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, org.name, org.domain || '', toJson(org.settings || {}), ts2, ts2);
    return this.getOrganization(id);
  }

  // ========== Users ==========
  async getUser(id: string) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null; }
  async getUserByEmail(email: string) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null; }
  async createUser(user: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO users (id, email, firstName, lastName, role, organizationId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, user.email, user.firstName || '', user.lastName || '', user.role || 'admin', user.organizationId, user.isActive ? 1 : 0, ts2, ts2);
    return this.getUser(id);
  }
  async updateUser(id: string, data: any) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw new Error('User not found');
    const merged = { ...existing as any, ...data, updatedAt: now() };
    db.prepare('UPDATE users SET firstName=?, lastName=?, role=?, isActive=?, updatedAt=? WHERE id=?').run(merged.firstName, merged.lastName, merged.role, merged.isActive ? 1 : 0, merged.updatedAt, id);
    return this.getUser(id);
  }

  // ========== Email Accounts ==========
  async getEmailAccounts(organizationId: string) {
    return db.prepare('SELECT * FROM email_accounts WHERE organizationId = ?').all(organizationId).map(hydrateAccount);
  }
  async getEmailAccount(id: string) { return hydrateAccount(db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(id)); }
  async getEmailAccountByEmail(organizationId: string, email: string) {
    return hydrateAccount(db.prepare('SELECT * FROM email_accounts WHERE organizationId = ? AND email = ?').get(organizationId, email));
  }
  async createEmailAccount(account: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO email_accounts (id, organizationId, provider, email, displayName, smtpConfig, dailyLimit, dailySent, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, account.organizationId, account.provider || 'custom', account.email, account.displayName || account.email, toJson(account.smtpConfig), account.dailyLimit || 500, 0, 1, ts2, ts2
    );
    return this.getEmailAccount(id);
  }
  async updateEmailAccount(id: string, data: any) {
    const existing = await this.getEmailAccount(id);
    if (!existing) throw new Error('Email account not found');
    const merged = { ...existing, ...data };
    db.prepare('UPDATE email_accounts SET displayName=?, smtpConfig=?, dailyLimit=?, dailySent=?, isActive=?, updatedAt=? WHERE id=?').run(
      merged.displayName, toJson(merged.smtpConfig), merged.dailyLimit, merged.dailySent, merged.isActive ? 1 : 0, now(), id
    );
    return this.getEmailAccount(id);
  }
  async deleteEmailAccount(id: string) { db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id); return true; }
  
  // Daily send limit helpers
  async incrementDailySent(id: string, count: number = 1) {
    db.prepare('UPDATE email_accounts SET dailySent = dailySent + ?, updatedAt = ? WHERE id = ?').run(count, now(), id);
  }
  async resetDailySentAll() {
    db.prepare('UPDATE email_accounts SET dailySent = 0, updatedAt = ?').run(now());
  }
  async getAvailableEmailAccounts(organizationId: string) {
    return db.prepare('SELECT * FROM email_accounts WHERE organizationId = ? AND isActive = 1 AND dailySent < dailyLimit ORDER BY dailySent ASC')
      .all(organizationId).map(hydrateAccount);
  }

  // ========== LLM Configurations ==========
  async getLlmConfigurations(organizationId: string) { return db.prepare('SELECT * FROM llm_configs WHERE organizationId = ?').all(organizationId); }
  async getPrimaryLlmConfiguration(organizationId: string) { return db.prepare('SELECT * FROM llm_configs WHERE organizationId = ? AND isPrimary = 1 AND isActive = 1').get(organizationId) || null; }
  async createLlmConfiguration(config: any) {
    const id = genId();
    db.prepare('INSERT INTO llm_configs (id, organizationId, provider, model, isPrimary, isActive, monthlyCost, monthlyLimit, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, config.organizationId, config.provider, config.model, config.isPrimary ? 1 : 0, config.isActive ? 1 : 0, config.monthlyCost || 0, config.monthlyLimit || 0, now()
    );
    return db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id);
  }
  async updateLlmConfiguration(id: string, data: any) {
    const existing = db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id);
    if (!existing) throw new Error('LLM config not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE llm_configs SET provider=?, model=?, isPrimary=?, isActive=?, monthlyCost=?, monthlyLimit=? WHERE id=?').run(m.provider, m.model, m.isPrimary ? 1 : 0, m.isActive ? 1 : 0, m.monthlyCost, m.monthlyLimit, id);
    return db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id);
  }

  // ========== Contact Lists ==========
  async getContactLists(organizationId: string) {
    return db.prepare('SELECT * FROM contact_lists WHERE organizationId = ? ORDER BY createdAt DESC').all(organizationId).map(hydrateList);
  }
  async getContactList(id: string) { return hydrateList(db.prepare('SELECT * FROM contact_lists WHERE id = ?').get(id)); }
  async createContactList(list: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO contact_lists (id, organizationId, name, source, headers, contactCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, list.organizationId, list.name, list.source || 'csv', toJson(list.headers || []), list.contactCount || 0, ts2, ts2
    );
    return this.getContactList(id);
  }
  async updateContactList(id: string, data: any) {
    const existing = await this.getContactList(id);
    if (!existing) throw new Error('Contact list not found');
    const m = { ...existing, ...data };
    db.prepare('UPDATE contact_lists SET name=?, contactCount=?, updatedAt=? WHERE id=?').run(m.name, m.contactCount, now(), id);
    return this.getContactList(id);
  }
  async deleteContactList(id: string) { db.prepare('DELETE FROM contact_lists WHERE id = ?').run(id); return true; }

  // ========== Contacts ==========
  async getContacts(organizationId: string, limit = 50, offset = 0, filters?: { listId?: string }) {
    if (filters?.listId) {
      return db.prepare('SELECT * FROM contacts WHERE organizationId = ? AND listId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(organizationId, filters.listId, limit, offset).map(hydrateContact);
    }
    return db.prepare('SELECT * FROM contacts WHERE organizationId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(organizationId, limit, offset).map(hydrateContact);
  }
  async getContactsCount(organizationId: string, filters?: { listId?: string }) {
    if (filters?.listId) {
      return (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ? AND listId = ?').get(organizationId, filters.listId) as any).c;
    }
    return (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ?').get(organizationId) as any).c;
  }
  async getContact(id: string) { return hydrateContact(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)); }
  // Bulk load contacts by IDs (avoids N+1 query pattern)
  async getContactsByIds(ids: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    // SQLite has a limit of ~999 bind parameters; chunk if needed
    const CHUNK = 500;
    const results: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`).all(...chunk);
      results.push(...rows.map(hydrateContact));
    }
    return results;
  }
  async getContactByEmail(organizationId: string, email: string) {
    return hydrateContact(db.prepare('SELECT * FROM contacts WHERE organizationId = ? AND email = ?').get(organizationId, email));
  }
  async createContact(contact: any) {
    const id = genId(); const ts2 = now();
    db.prepare(`INSERT INTO contacts (id, organizationId, email, firstName, lastName, company, jobTitle,
      phone, mobilePhone, linkedinUrl, seniority, department, city, state, country, website, industry,
      employeeCount, annualRevenue, companyLinkedinUrl, companyCity, companyState, companyCountry, companyAddress,
      companyPhone, secondaryEmail, homePhone, emailStatus, lastActivityDate, status, score, tags, customFields, source, listId, assignedTo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, contact.organizationId, contact.email, contact.firstName || '', contact.lastName || '', contact.company || '', contact.jobTitle || '',
      contact.phone || '', contact.mobilePhone || '', contact.linkedinUrl || '', contact.seniority || '', contact.department || '',
      contact.city || '', contact.state || '', contact.country || '', contact.website || '', contact.industry || '',
      contact.employeeCount || '', contact.annualRevenue || '', contact.companyLinkedinUrl || '',
      contact.companyCity || '', contact.companyState || '', contact.companyCountry || '', contact.companyAddress || '',
      contact.companyPhone || '', contact.secondaryEmail || '', contact.homePhone || '', contact.emailStatus || '', contact.lastActivityDate || '',
      contact.status || 'cold', contact.score || 0, toJson(contact.tags || []), toJson(contact.customFields || {}),
      contact.source || 'manual', contact.listId || null, contact.assignedTo || null, ts2, ts2
    );
    return this.getContact(id);
  }
  async createContactsBulk(contacts: any[], listId?: string) {
    const results: any[] = [];
    const insertStmt = db.prepare(`INSERT INTO contacts (id, organizationId, email, firstName, lastName, company, jobTitle,
      phone, mobilePhone, linkedinUrl, seniority, department, city, state, country, website, industry,
      employeeCount, annualRevenue, companyLinkedinUrl, companyCity, companyState, companyCountry, companyAddress,
      companyPhone, secondaryEmail, homePhone, emailStatus, lastActivityDate, status, score, tags, customFields, source, listId, assignedTo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const findStmt = db.prepare('SELECT * FROM contacts WHERE organizationId = ? AND email = ?');
    const updateListStmt = db.prepare('UPDATE contacts SET listId = ?, updatedAt = ? WHERE id = ?');

    const batch = db.transaction(() => {
      for (const contact of contacts) {
        const existing = findStmt.get(contact.organizationId, contact.email);
        if (existing) {
          if (listId && !(existing as any).listId) {
            updateListStmt.run(listId, now(), (existing as any).id);
          }
          results.push({ ...hydrateContact(existing), _skipped: true });
          continue;
        }
        const id = genId(); const ts2 = now();
        insertStmt.run(
          id, contact.organizationId, contact.email, contact.firstName || '', contact.lastName || '', contact.company || '', contact.jobTitle || '',
          contact.phone || '', contact.mobilePhone || '', contact.linkedinUrl || '', contact.seniority || '', contact.department || '',
          contact.city || '', contact.state || '', contact.country || '', contact.website || '', contact.industry || '',
          contact.employeeCount || '', contact.annualRevenue || '', contact.companyLinkedinUrl || '',
          contact.companyCity || '', contact.companyState || '', contact.companyCountry || '', contact.companyAddress || '',
          contact.companyPhone || '', contact.secondaryEmail || '', contact.homePhone || '', contact.emailStatus || '', contact.lastActivityDate || '',
          contact.status || 'cold', contact.score || 0, toJson(contact.tags || []), toJson(contact.customFields || {}),
          contact.source || 'import', listId || contact.listId || null, contact.assignedTo || null, ts2, ts2
        );
        results.push({ id, ...contact, listId: listId || contact.listId || null, tags: contact.tags || [], customFields: contact.customFields || {} });
      }
    });
    batch();
    return results;
  }
  async updateContact(id: string, data: any) {
    const existing = await this.getContact(id);
    if (!existing) throw new Error('Contact not found');
    const m = { ...existing, ...data };
    db.prepare(`UPDATE contacts SET firstName=?, lastName=?, company=?, jobTitle=?,
      phone=?, mobilePhone=?, linkedinUrl=?, seniority=?, department=?,
      city=?, state=?, country=?, website=?, industry=?,
      employeeCount=?, annualRevenue=?, companyLinkedinUrl=?,
      companyCity=?, companyState=?, companyCountry=?, companyAddress=?,
      companyPhone=?, secondaryEmail=?, homePhone=?, emailStatus=?, lastActivityDate=?,
      status=?, score=?, tags=?, customFields=?, source=?, listId=?, assignedTo=?, updatedAt=? WHERE id=?`).run(
      m.firstName, m.lastName, m.company, m.jobTitle,
      m.phone || '', m.mobilePhone || '', m.linkedinUrl || '', m.seniority || '', m.department || '',
      m.city || '', m.state || '', m.country || '', m.website || '', m.industry || '',
      m.employeeCount || '', m.annualRevenue || '', m.companyLinkedinUrl || '',
      m.companyCity || '', m.companyState || '', m.companyCountry || '', m.companyAddress || '',
      m.companyPhone || '', m.secondaryEmail || '', m.homePhone || '', m.emailStatus || '', m.lastActivityDate || '',
      m.status, m.score, toJson(m.tags), toJson(m.customFields), m.source, m.listId || null, m.assignedTo || null, now(), id
    );
    return this.getContact(id);
  }
  async updateContactEmailRating(id: string, rating: number, grade: string, details: any) {
    db.prepare('UPDATE contacts SET emailRating=?, emailRatingGrade=?, emailRatingDetails=?, emailRatingUpdatedAt=? WHERE id=?').run(
      rating, grade, toJson(details), now(), id
    );
  }
  async getContactEngagementStats(contactId: string) {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as totalSent,
        SUM(CASE WHEN openedAt IS NOT NULL THEN 1 ELSE 0 END) as totalOpened,
        SUM(CASE WHEN clickedAt IS NOT NULL THEN 1 ELSE 0 END) as totalClicked,
        SUM(CASE WHEN repliedAt IS NOT NULL THEN 1 ELSE 0 END) as totalReplied,
        MAX(sentAt) as lastSentAt,
        MAX(openedAt) as lastOpenedAt,
        MAX(clickedAt) as lastClickedAt,
        MAX(repliedAt) as lastRepliedAt
      FROM messages WHERE contactId = ?
    `).get(contactId) as any;
    return stats || { totalSent: 0, totalOpened: 0, totalClicked: 0, totalReplied: 0 };
  }
  async getContactReplyContent(contactId: string) {
    // Get reply content from unified inbox
    const replies = db.prepare(`
      SELECT body, snippet, subject, fromEmail, receivedAt 
      FROM unified_inbox 
      WHERE contactId = ? AND (status = 'replied' OR repliedAt IS NOT NULL) AND body IS NOT NULL
      ORDER BY receivedAt DESC LIMIT 5
    `).all(contactId) as any[];
    // Also check tracking events for reply metadata
    const replyEvents = db.prepare(`
      SELECT metadata, createdAt FROM tracking_events 
      WHERE contactId = ? AND type = 'reply'
      ORDER BY createdAt DESC LIMIT 5
    `).all(contactId) as any[];
    return { replies, replyEvents: replyEvents.map(hydrateEvent) };
  }
  async deleteContact(id: string) { db.prepare('DELETE FROM contacts WHERE id = ?').run(id); return true; }
  async deleteContacts(ids: string[]) {
    const del = db.prepare('DELETE FROM contacts WHERE id = ?');
    const batch = db.transaction(() => { for (const id of ids) del.run(id); });
    batch();
    return true;
  }
  async searchContacts(organizationId: string, query: string, filters?: { listId?: string }) {
    const q = `%${query.toLowerCase()}%`;
    let sql = `SELECT * FROM contacts WHERE organizationId = ? AND (
      LOWER(firstName) LIKE ? OR LOWER(lastName) LIKE ? OR LOWER(email) LIKE ? OR
      LOWER(company) LIKE ? OR LOWER(jobTitle) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(customFields) LIKE ? OR
      LOWER(phone) LIKE ? OR LOWER(mobilePhone) LIKE ? OR LOWER(linkedinUrl) LIKE ? OR
      LOWER(city) LIKE ? OR LOWER(state) LIKE ? OR LOWER(country) LIKE ? OR LOWER(industry) LIKE ? OR
      LOWER(seniority) LIKE ? OR LOWER(department) LIKE ? OR LOWER(website) LIKE ?
    )`;
    const params: any[] = [organizationId, q, q, q, q, q, q, q, q, q, q, q, q, q, q, q, q, q];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    sql += ' ORDER BY createdAt DESC LIMIT 100';
    return db.prepare(sql).all(...params).map(hydrateContact);
  }
  async getContactsBySegment(segmentId: string) {
    const segment = await this.getContactSegment(segmentId);
    if (!segment || !segment.filters) return [];
    let sql = 'SELECT * FROM contacts WHERE organizationId = ?';
    const params: any[] = [segment.organizationId];
    if (segment.filters.status) { sql += ' AND status = ?'; params.push(segment.filters.status); }
    if (segment.filters.tag) { sql += ' AND tags LIKE ?'; params.push(`%${segment.filters.tag}%`); }
    return db.prepare(sql).all(...params).map(hydrateContact);
  }

  // ========== Contact Segments ==========
  async getContactSegments(organizationId: string) { return db.prepare('SELECT * FROM segments WHERE organizationId = ?').all(organizationId).map(hydrateSegment); }
  async getContactSegment(id: string) { return hydrateSegment(db.prepare('SELECT * FROM segments WHERE id = ?').get(id)); }
  async createContactSegment(segment: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO segments (id, organizationId, name, description, filters, contactCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, segment.organizationId, segment.name, segment.description || '', toJson(segment.filters), segment.contactCount || 0, ts2, ts2
    );
    return this.getContactSegment(id);
  }
  async updateContactSegment(id: string, data: any) {
    const existing = await this.getContactSegment(id);
    if (!existing) throw new Error('Segment not found');
    const m = { ...existing, ...data };
    db.prepare('UPDATE segments SET name=?, description=?, filters=?, contactCount=?, updatedAt=? WHERE id=?').run(m.name, m.description, toJson(m.filters), m.contactCount, now(), id);
    return this.getContactSegment(id);
  }
  async deleteContactSegment(id: string) { db.prepare('DELETE FROM segments WHERE id = ?').run(id); return true; }

  // ========== Email Templates ==========
  async getEmailTemplates(organizationId: string) { return db.prepare('SELECT * FROM templates WHERE organizationId = ?').all(organizationId).map(hydrateTemplate); }
  async getEmailTemplate(id: string) { return hydrateTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)); }
  async createEmailTemplate(template: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO templates (id, organizationId, name, category, subject, content, variables, isPublic, usageCount, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, template.organizationId, template.name, template.category || '', template.subject || '', template.content || '', toJson(template.variables || []), template.isPublic ? 1 : 0, 0, template.createdBy || null, ts2, ts2
    );
    return this.getEmailTemplate(id);
  }
  async updateEmailTemplate(id: string, data: any) {
    const existing = await this.getEmailTemplate(id);
    if (!existing) throw new Error('Template not found');
    const m = { ...existing, ...data };
    db.prepare('UPDATE templates SET name=?, category=?, subject=?, content=?, variables=?, isPublic=?, usageCount=?, updatedAt=? WHERE id=?').run(
      m.name, m.category, m.subject, m.content, toJson(m.variables), m.isPublic ? 1 : 0, m.usageCount, now(), id
    );
    return this.getEmailTemplate(id);
  }
  async deleteEmailTemplate(id: string) { db.prepare('DELETE FROM templates WHERE id = ?').run(id); return true; }

  // ========== Campaigns ==========
  async getCampaigns(organizationId: string, limit = 20, offset = 0) {
    return db.prepare('SELECT * FROM campaigns WHERE organizationId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(organizationId, limit, offset).map(hydrateCampaign);
  }
  async getCampaign(id: string) { return hydrateCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id)); }
  async createCampaign(campaign: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO campaigns (id, organizationId, name, description, status, totalRecipients, sentCount, openedCount, clickedCount, repliedCount, bouncedCount, unsubscribedCount, subject, content, emailAccountId, templateId, contactIds, segmentId, scheduledAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, campaign.organizationId, campaign.name, campaign.description || '', campaign.status || 'draft', campaign.totalRecipients || 0,
      campaign.subject || '', campaign.content || '', campaign.emailAccountId || null, campaign.templateId || null,
      toJson(campaign.contactIds || []), campaign.segmentId || null, campaign.scheduledAt || null, campaign.createdBy || null, ts2, ts2
    );
    return this.getCampaign(id);
  }
  async updateCampaign(id: string, data: any) {
    const existing = await this.getCampaign(id);
    if (!existing) throw new Error('Campaign not found');
    const m = { ...existing, ...data };
    db.prepare(`UPDATE campaigns SET name=?, description=?, status=?, totalRecipients=?, sentCount=?, openedCount=?, clickedCount=?, repliedCount=?, bouncedCount=?, unsubscribedCount=?, subject=?, content=?, emailAccountId=?, templateId=?, contactIds=?, segmentId=?, scheduledAt=?, updatedAt=? WHERE id=?`).run(
      m.name, m.description, m.status, m.totalRecipients, m.sentCount, m.openedCount, m.clickedCount, m.repliedCount, m.bouncedCount, m.unsubscribedCount,
      m.subject, m.content, m.emailAccountId || null, m.templateId || null, toJson(m.contactIds), m.segmentId || null, toSqlDate(m.scheduledAt), now(), id
    );
    return this.getCampaign(id);
  }
  async deleteCampaign(id: string) { db.prepare('DELETE FROM campaigns WHERE id = ?').run(id); return true; }
  async getCampaignStats(organizationId: string) {
    const row = db.prepare(`SELECT
      COUNT(*) as totalCampaigns,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeCampaigns,
      SUM(sentCount) as totalSent, SUM(openedCount) as totalOpened,
      SUM(clickedCount) as totalClicked, SUM(repliedCount) as totalReplied,
      SUM(bouncedCount) as totalBounced, SUM(unsubscribedCount) as totalUnsubscribed
    FROM campaigns WHERE organizationId = ?`).get(organizationId) as any;
    return {
      totalCampaigns: row.totalCampaigns || 0,
      activeCampaigns: row.activeCampaigns || 0,
      totalSent: row.totalSent || 0,
      totalOpened: row.totalOpened || 0,
      totalClicked: row.totalClicked || 0,
      totalReplied: row.totalReplied || 0,
      totalBounced: row.totalBounced || 0,
      totalUnsubscribed: row.totalUnsubscribed || 0,
    };
  }

  // ========== Campaign Messages ==========
  async getCampaignMessages(campaignId: string, limit = 100, offset = 0) {
    return db.prepare('SELECT * FROM messages WHERE campaignId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(campaignId, limit, offset);
  }
  async getCampaignMessage(id: string) { return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null; }
  async getCampaignMessageByTracking(trackingId: string) { return db.prepare('SELECT * FROM messages WHERE trackingId = ?').get(trackingId) || null; }
  async createCampaignMessage(message: any) {
    const id = genId();
    db.prepare('INSERT INTO messages (id, campaignId, contactId, subject, content, status, trackingId, emailAccountId, stepNumber, sentAt, openedAt, clickedAt, repliedAt, errorMessage, providerMessageId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, message.campaignId, message.contactId || null, message.subject || '', message.content || '', message.status || 'sending',
      message.trackingId || null, message.emailAccountId || null, message.stepNumber || 0,
      toSqlDate(message.sentAt), toSqlDate(message.openedAt), toSqlDate(message.clickedAt), toSqlDate(message.repliedAt), message.errorMessage || null, message.providerMessageId || null, now()
    );
    return this.getCampaignMessage(id);
  }
  async updateCampaignMessage(id: string, data: any) {
    const existing = await this.getCampaignMessage(id);
    if (!existing) throw new Error('Message not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE messages SET status=?, sentAt=?, openedAt=?, clickedAt=?, repliedAt=?, errorMessage=?, providerMessageId=? WHERE id=?').run(
      m.status, toSqlDate(m.sentAt), toSqlDate(m.openedAt), toSqlDate(m.clickedAt), toSqlDate(m.repliedAt), m.errorMessage || null, m.providerMessageId || null, id
    );
    return this.getCampaignMessage(id);
  }

  // ========== Tracking Events ==========
  async createTrackingEvent(event: any) {
    const id = genId();
    db.prepare('INSERT INTO tracking_events (id, type, campaignId, messageId, contactId, trackingId, stepNumber, url, userAgent, ip, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, event.type, event.campaignId || null, event.messageId || null, event.contactId || null, event.trackingId || null,
      event.stepNumber || 0, event.url || null, event.userAgent || null, event.ip || null, toJson(event.metadata), now()
    );
    return { id, ...event, createdAt: now() };
  }
  async getTrackingEvents(campaignId: string) {
    return db.prepare("SELECT * FROM tracking_events WHERE campaignId = ? AND type != 'prefetch' ORDER BY createdAt DESC").all(campaignId).map(hydrateEvent);
  }
  async getTrackingEventsByMessage(messageId: string) {
    return db.prepare("SELECT * FROM tracking_events WHERE messageId = ? AND type != 'prefetch' ORDER BY createdAt ASC").all(messageId).map(hydrateEvent);
  }
  async getAllTrackingEvents(organizationId: string, limit = 50) {
    return db.prepare(`SELECT te.* FROM tracking_events te
      INNER JOIN campaigns c ON te.campaignId = c.id
      WHERE c.organizationId = ? AND te.type != 'prefetch' ORDER BY te.createdAt DESC LIMIT ?`).all(organizationId, limit).map(hydrateEvent);
  }
  
  async getRecentTrackingEvents(messageId: string, type: string, withinSeconds: number) {
    const cutoff = new Date(Date.now() - withinSeconds * 1000).toISOString();
    return db.prepare("SELECT * FROM tracking_events WHERE messageId = ? AND type = ? AND createdAt > ? ORDER BY createdAt DESC").all(messageId, type, cutoff) as any[];
  }

  // ========== Enriched Campaign Messages ==========
  async getCampaignMessagesEnriched(campaignId: string, limit = 200, offset = 0) {
    const messages = db.prepare('SELECT * FROM messages WHERE campaignId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(campaignId, limit, offset);
    return messages.map((m: any) => {
      const events = db.prepare("SELECT * FROM tracking_events WHERE messageId = ? AND type != 'prefetch' ORDER BY createdAt ASC").all(m.id).map(hydrateEvent);
      const contact = m.contactId ? hydrateContact(db.prepare('SELECT * FROM contacts WHERE id = ?').get(m.contactId)) : null;
      return {
        ...m,
        contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
        events,
        openCount: events.filter((e: any) => {
          if (e.type !== 'open') return false;
          // Filter out duplicate opens (metadata contains { duplicate: true })
          if (e.metadata && typeof e.metadata === 'string') {
            try { const meta = JSON.parse(e.metadata); if (meta.duplicate) return false; } catch {}
          } else if (e.metadata && e.metadata.duplicate) return false;
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
    return (db.prepare('SELECT COUNT(*) as c FROM messages WHERE campaignId = ?').get(campaignId) as any).c;
  }

  // Get unopened campaign messages for Gmail API open detection
  // Increased limit to support 10-20K email/day volume
  async getUnopenedCampaignMessages(orgId: string, cutoff: string) {
    return db.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN campaigns c ON m.campaignId = c.id
      WHERE c.organizationId = ?
      AND m.status = 'sent'
      AND m.openedAt IS NULL
      AND m.sentAt >= ?
      AND m.providerMessageId IS NOT NULL
      ORDER BY m.sentAt DESC
      LIMIT 2000
    `).all(orgId, cutoff);
  }

  // Get unreplied campaign messages for thread-based reply detection
  // Increased limit to support 10-20K email/day volume
  async getUnrepliedCampaignMessages(orgId: string) {
    return db.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN campaigns c ON m.campaignId = c.id
      WHERE c.organizationId = ?
      AND m.status = 'sent'
      AND m.repliedAt IS NULL
      AND m.providerMessageId IS NOT NULL
      ORDER BY m.sentAt DESC
      LIMIT 5000
    `).all(orgId);
  }

  // ========== Unsubscribes ==========
  async addUnsubscribe(data: any) {
    const id = genId();
    db.prepare('INSERT INTO unsubscribes (id, organizationId, email, contactId, campaignId, reason, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, data.organizationId || null, data.email || null, data.contactId || null, data.campaignId || null, data.reason || null, now()
    );
    if (data.contactId) {
      db.prepare("UPDATE contacts SET status = 'unsubscribed' WHERE id = ?").run(data.contactId);
    }
    return { id, ...data, createdAt: now() };
  }
  async isUnsubscribed(organizationId: string, email: string) {
    return !!(db.prepare('SELECT 1 FROM unsubscribes WHERE organizationId = ? AND email = ?').get(organizationId, email));
  }
  async getUnsubscribes(organizationId: string) {
    return db.prepare('SELECT * FROM unsubscribes WHERE organizationId = ?').all(organizationId);
  }

  // ========== Integrations ==========
  async getIntegrations(organizationId: string) { return db.prepare('SELECT * FROM integrations WHERE organizationId = ?').all(organizationId); }
  async getIntegration(id: string) { return db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) || null; }
  async createIntegration(integration: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO integrations (id, organizationId, type, name, isActive, syncCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(
      id, integration.organizationId, integration.type, integration.name, integration.isActive ? 1 : 0, ts2, ts2
    );
    return this.getIntegration(id);
  }
  async updateIntegration(id: string, data: any) {
    const existing = await this.getIntegration(id);
    if (!existing) throw new Error('Integration not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE integrations SET name=?, isActive=?, lastSyncAt=?, syncCount=?, updatedAt=? WHERE id=?').run(m.name, m.isActive ? 1 : 0, m.lastSyncAt, m.syncCount, now(), id);
    return this.getIntegration(id);
  }

  // ========== Follow-up Sequences ==========
  async getFollowupSequences(organizationId: string) { return db.prepare('SELECT * FROM followup_sequences WHERE organizationId = ?').all(organizationId); }
  async getFollowupSequence(id: string) { return db.prepare('SELECT * FROM followup_sequences WHERE id = ?').get(id) || null; }
  async createFollowupSequence(sequence: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO followup_sequences (id, organizationId, name, description, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').run(
      id, sequence.organizationId, sequence.name, sequence.description || '', sequence.createdBy || null, ts2, ts2
    );
    return this.getFollowupSequence(id);
  }
  async updateFollowupSequence(id: string, data: any) {
    const existing = await this.getFollowupSequence(id);
    if (!existing) throw new Error('Sequence not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE followup_sequences SET name=?, description=?, isActive=?, updatedAt=? WHERE id=?').run(m.name, m.description, m.isActive ? 1 : 0, now(), id);
    return this.getFollowupSequence(id);
  }
  async deleteFollowupSequence(id: string) { db.prepare('DELETE FROM followup_sequences WHERE id = ?').run(id); return true; }

  // ========== Follow-up Steps ==========
  async getFollowupSteps(sequenceId: string) { return db.prepare('SELECT * FROM followup_steps WHERE sequenceId = ? ORDER BY stepNumber ASC').all(sequenceId); }
  async getFollowupStep(id: string) { return db.prepare('SELECT * FROM followup_steps WHERE id = ?').get(id) || null; }
  async createFollowupStep(step: any) {
    const id = genId();
    db.prepare('INSERT INTO followup_steps (id, sequenceId, stepNumber, trigger, delayDays, delayHours, delayMinutes, subject, content, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').run(
      id, step.sequenceId, step.stepNumber || 0, step.trigger || 'no_reply', step.delayDays || 0, step.delayHours || 0, step.delayMinutes || 0, step.subject || '', step.content || '', now()
    );
    return this.getFollowupStep(id);
  }
  async updateFollowupStep(id: string, data: any) {
    const existing = await this.getFollowupStep(id);
    if (!existing) throw new Error('Step not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE followup_steps SET stepNumber=?, trigger=?, delayDays=?, delayHours=?, delayMinutes=?, subject=?, content=?, isActive=? WHERE id=?').run(
      m.stepNumber, m.trigger, m.delayDays, m.delayHours, m.delayMinutes || 0, m.subject, m.content, m.isActive ? 1 : 0, id
    );
    return this.getFollowupStep(id);
  }
  async deleteFollowupStep(id: string) { db.prepare('DELETE FROM followup_steps WHERE id = ?').run(id); return true; }

  // ========== Campaign Follow-ups ==========
  async getCampaignFollowups(campaignId: string) { return db.prepare('SELECT * FROM campaign_followups WHERE campaignId = ? AND isActive = 1').all(campaignId); }
  async getActiveCampaignFollowups() { return db.prepare('SELECT * FROM campaign_followups WHERE isActive = 1').all(); }
  async createCampaignFollowup(followup: any) {
    const id = genId();
    db.prepare('INSERT INTO campaign_followups (id, campaignId, sequenceId, isActive, createdAt) VALUES (?, ?, ?, 1, ?)').run(id, followup.campaignId, followup.sequenceId || null, now());
    return db.prepare('SELECT * FROM campaign_followups WHERE id = ?').get(id);
  }

  // ========== Follow-up Executions ==========
  async getFollowupExecution(campaignMessageId: string, stepId: string) {
    return db.prepare('SELECT * FROM followup_executions WHERE campaignMessageId = ? AND stepId = ?').get(campaignMessageId, stepId) || null;
  }
  // Batch version: load all executions for a campaign at once (avoids N+1 queries)
  async getFollowupExecutionsByCampaign(campaignId: string) {
    return db.prepare('SELECT campaignMessageId, stepId, status FROM followup_executions WHERE campaignId = ?').all(campaignId);
  }
  async getFollowupExecutionById(id: string) { return db.prepare('SELECT * FROM followup_executions WHERE id = ?').get(id) || null; }
  async getPendingFollowupExecutions() {
    return db.prepare("SELECT * FROM followup_executions WHERE status = 'pending' AND scheduledAt <= ?").all(now());
  }
  async createFollowupExecution(execution: any) {
    const id = genId();
    // Ensure all values are SQLite-safe (strings, numbers, or null)
    const toStr = (v: any): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };
    db.prepare('INSERT INTO followup_executions (id, campaignMessageId, stepId, contactId, campaignId, status, scheduledAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, toStr(execution.campaignMessageId), toStr(execution.stepId), toStr(execution.contactId), toStr(execution.campaignId), toStr(execution.status) || 'pending', toStr(execution.scheduledAt), now()
    );
    return this.getFollowupExecutionById(id);
  }
  async updateFollowupExecution(id: string, data: any) {
    const existing = await this.getFollowupExecutionById(id);
    if (!existing) throw new Error('Execution not found');
    const m = { ...existing as any, ...data };
    const toDateStr = (v: any): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString();
      return String(v);
    };
    const executedAt = toDateStr(m.executedAt) || toDateStr(m.sentAt) || null;
    db.prepare('UPDATE followup_executions SET status=?, executedAt=? WHERE id=?').run(String(m.status), executedAt, id);
    return this.getFollowupExecutionById(id);
  }
  async cancelPendingFollowupsForContact(contactId: string, campaignId?: string) {
    if (campaignId) {
      db.prepare("UPDATE followup_executions SET status = 'skipped' WHERE contactId = ? AND campaignId = ? AND status = 'pending'").run(contactId, campaignId);
    } else {
      db.prepare("UPDATE followup_executions SET status = 'skipped' WHERE contactId = ? AND status = 'pending'").run(contactId);
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

    return {
      campaignId,
      campaignName: campaign.name,
      totalSent, delivered: totalSent - bounced, opened, clicked, replied, bounced, unsubscribed: unsub,
      openRate: totalSent > 0 ? ((opened / totalSent) * 100).toFixed(1) : '0',
      clickRate: opened > 0 ? ((clicked / opened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((replied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((bounced / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((unsub / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - bounced) / totalSent) * 100).toFixed(1) : '0',
    };
  }

  async getOrganizationAnalytics(organizationId: string, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const row = db.prepare(`SELECT
      SUM(sentCount) as totalSent, SUM(openedCount) as totalOpened,
      SUM(clickedCount) as totalClicked, SUM(repliedCount) as totalReplied,
      SUM(bouncedCount) as totalBounced, SUM(unsubscribedCount) as totalUnsubscribed,
      COUNT(*) as campaignCount
    FROM campaigns WHERE organizationId = ? AND createdAt >= ?`).get(organizationId, cutoffStr) as any;

    const totalSent = row.totalSent || 0;
    const totalOpened = row.totalOpened || 0;
    const totalClicked = row.totalClicked || 0;
    const totalReplied = row.totalReplied || 0;
    const totalBounced = row.totalBounced || 0;
    const totalUnsub = row.totalUnsubscribed || 0;

    // Timeline
    const timeline: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayEvents = db.prepare(`SELECT type, COUNT(*) as c FROM tracking_events te
        INNER JOIN campaigns ca ON te.campaignId = ca.id
        WHERE ca.organizationId = ? AND te.createdAt LIKE ?
        GROUP BY type`).all(organizationId, `${dateStr}%`) as any[];
      const counts: any = {};
      for (const e of dayEvents) counts[e.type] = e.c;
      timeline.push({
        date: dateStr,
        opens: counts.open || 0,
        clicks: counts.click || 0,
        replies: counts.reply || 0,
      });
    }

    const contactCount = (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ?').get(organizationId) as any).c;

    return {
      totalSent, totalOpened, totalClicked, totalReplied, totalBounced, totalUnsubscribed: totalUnsub,
      openRate: totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : '0',
      clickRate: totalOpened > 0 ? ((totalClicked / totalOpened) * 100).toFixed(1) : '0',
      replyRate: totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '0',
      bounceRate: totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : '0',
      deliveryRate: totalSent > 0 ? (((totalSent - totalBounced) / totalSent) * 100).toFixed(1) : '0',
      unsubscribeRate: totalSent > 0 ? ((totalUnsub / totalSent) * 100).toFixed(1) : '0',
      timeline,
      campaignCount: row.campaignCount || 0,
      contactCount,
    };
  }

  // ========== API Settings ==========
  async getApiSetting(organizationId: string, key: string): Promise<string | null> {
    const row = db.prepare('SELECT settingValue FROM api_settings WHERE organizationId = ? AND settingKey = ?').get(organizationId, key) as any;
    return row ? row.settingValue : null;
  }

  async getApiSettings(organizationId: string): Promise<Record<string, string>> {
    const rows = db.prepare('SELECT settingKey, settingValue FROM api_settings WHERE organizationId = ?').all(organizationId) as any[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.settingKey] = row.settingValue;
    }
    return result;
  }

  async setApiSetting(organizationId: string, key: string, value: string): Promise<void> {
    const ts = now();
    const existing = db.prepare('SELECT id FROM api_settings WHERE organizationId = ? AND settingKey = ?').get(organizationId, key) as any;
    if (existing) {
      db.prepare('UPDATE api_settings SET settingValue = ?, updatedAt = ? WHERE id = ?').run(value, ts, existing.id);
    } else {
      db.prepare('INSERT INTO api_settings (id, organizationId, settingKey, settingValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        genId(), organizationId, key, value, ts, ts
      );
    }
  }

  async setApiSettings(organizationId: string, settings: Record<string, string>): Promise<void> {
    const batch = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        const ts = now();
        const existing = db.prepare('SELECT id FROM api_settings WHERE organizationId = ? AND settingKey = ?').get(organizationId, key) as any;
        if (existing) {
          db.prepare('UPDATE api_settings SET settingValue = ?, updatedAt = ? WHERE id = ?').run(value || '', ts, existing.id);
        } else {
          db.prepare('INSERT INTO api_settings (id, organizationId, settingKey, settingValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
            genId(), organizationId, key, value || '', ts, ts
          );
        }
      }
    });
    batch();
  }

  async deleteApiSetting(organizationId: string, key: string): Promise<void> {
    db.prepare('DELETE FROM api_settings WHERE organizationId = ? AND settingKey = ?').run(organizationId, key);
  }

  // ========== Unified Inbox ==========
  async getInboxMessages(organizationId: string, filters?: { status?: string; emailAccountId?: string; campaignId?: string }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM unified_inbox WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (filters?.status && filters.status !== 'all') { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.emailAccountId) { sql += ' AND emailAccountId = ?'; params.push(filters.emailAccountId); }
    if (filters?.campaignId) { sql += ' AND campaignId = ?'; params.push(filters.campaignId); }
    sql += ' ORDER BY receivedAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  async getInboxMessageCount(organizationId: string, filters?: { status?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (filters?.status && filters.status !== 'all') { sql += ' AND status = ?'; params.push(filters.status); }
    return (db.prepare(sql).get(...params) as any).c;
  }

  async getInboxMessage(id: string) {
    return db.prepare('SELECT * FROM unified_inbox WHERE id = ?').get(id);
  }

  async getInboxMessageByGmailId(gmailMessageId: string) {
    return db.prepare('SELECT * FROM unified_inbox WHERE gmailMessageId = ?').get(gmailMessageId);
  }

  async getInboxMessageByOutlookId(outlookMessageId: string) {
    return db.prepare('SELECT * FROM unified_inbox WHERE outlookMessageId = ?').get(outlookMessageId);
  }

  async createInboxMessage(msg: any) {
    const id = genId(); const ts2 = now();
    db.prepare(`INSERT INTO unified_inbox (id, organizationId, emailAccountId, campaignId, messageId, contactId,
      gmailMessageId, gmailThreadId, outlookMessageId, outlookConversationId,
      fromEmail, fromName, toEmail, subject, snippet, body, bodyHtml,
      status, provider, aiDraft, repliedAt, receivedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, msg.organizationId, msg.emailAccountId || null, msg.campaignId || null, msg.messageId || null, msg.contactId || null,
      msg.gmailMessageId || null, msg.gmailThreadId || null, msg.outlookMessageId || null, msg.outlookConversationId || null,
      msg.fromEmail, msg.fromName || '', msg.toEmail || '', msg.subject || '', msg.snippet || '', msg.body || '', msg.bodyHtml || '',
      msg.status || 'unread', msg.provider || '', msg.aiDraft || null, msg.repliedAt || null, msg.receivedAt || ts2, ts2
    );
    return this.getInboxMessage(id);
  }

  async updateInboxMessage(id: string, data: any) {
    const existing = await this.getInboxMessage(id);
    if (!existing) throw new Error('Inbox message not found');
    const m = { ...existing, ...data } as any;
    db.prepare('UPDATE unified_inbox SET status=?, aiDraft=?, repliedAt=? WHERE id=?').run(
      m.status, m.aiDraft || null, m.repliedAt || null, id
    );
    return this.getInboxMessage(id);
  }

  async deleteInboxMessage(id: string) {
    db.prepare('DELETE FROM unified_inbox WHERE id = ?').run(id);
    return true;
  }

  async getInboxUnreadCount(organizationId: string) {
    return (db.prepare('SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = ?').get(organizationId, 'unread') as any).c;
  }
}

export const storage = new DatabaseStorage();
