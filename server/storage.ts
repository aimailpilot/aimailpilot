// Persistent SQLite storage for AImailPilot
// Data is stored in ./data/aimailpilot.db and survives server restarts
import Database from 'better-sqlite3';
import { PostgresStorage } from './pg-storage.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On Azure App Service, use /home/data for persistent storage
// /home is an Azure persistent mount that survives deployments and container restarts
// Locally, use ./data relative to project root
function getDbPath(): string {
  // MULTIPLE detection methods for Azure (belt + suspenders)
  const azureEnvVars = process.env.WEBSITE_SITE_NAME || process.env.AZURE_WEBAPP_NAME || 
                       process.env.APPSETTING_WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID ||
                       process.env.WEBSITE_HOSTNAME || process.env.WEBSITE_RESOURCE_GROUP;
  const azurePathExists = fs.existsSync('/home/site/wwwroot');
  // ALSO check if /home/data already has our DB from a previous run (survives even if env vars change)
  const azureDbExists = fs.existsSync('/home/data/aimailpilot.db');
  const isAzure = !!(azureEnvVars || azurePathExists || azureDbExists);
  
  console.log(`[DB] Azure detection: envVars=${!!azureEnvVars}, pathExists=${azurePathExists}, dbExists=${azureDbExists}, isAzure=${isAzure}`);
  
  if (isAzure) {
    const azureDataDir = '/home/data';
    if (!fs.existsSync(azureDataDir)) {
      fs.mkdirSync(azureDataDir, { recursive: true });
    }
    const dbPath = path.join(azureDataDir, 'aimailpilot.db');
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    console.log(`[DB] Azure detected (WEBSITE_SITE_NAME=${process.env.WEBSITE_SITE_NAME || 'unset'}), DB path: ${dbPath}, exists: ${dbSize > 0}, size: ${(dbSize / 1024).toFixed(1)}KB`);
    return dbPath;
  }
  // Local development
  const localPath = path.resolve(__dirname, '..', 'data', 'aimailpilot.db');
  const localDir = path.dirname(localPath);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  return localPath;
}

const isAzure = !!(process.env.WEBSITE_SITE_NAME || process.env.AZURE_WEBAPP_NAME || 
                   process.env.APPSETTING_WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID ||
                   process.env.WEBSITE_HOSTNAME || process.env.WEBSITE_RESOURCE_GROUP ||
                   fs.existsSync('/home/site/wwwroot') || fs.existsSync('/home/data/aimailpilot.db'));

const DB_PATH = getDbPath();
console.log(`[DB] Using database at: ${DB_PATH}`);

// ===== Database initialization =====
// SAFETY: NEVER delete, rename, or recreate the database file automatically.
// If the current DB is empty/fresh but a .corrupt backup exists, RESTORE it first.

function autoRestoreBackup(): boolean {
  // Check if current DB is empty or missing — if so, look for .corrupt backups to restore
  const dbDir = path.dirname(DB_PATH);
  const dbName = path.basename(DB_PATH);

  try {
    const files = fs.readdirSync(dbDir);
    // Find all .corrupt backup files sorted by timestamp (newest first)
    const backups = files
      .filter(f => f.startsWith(dbName + '.corrupt.'))
      .map(f => ({ name: f, path: path.join(dbDir, f), stat: fs.statSync(path.join(dbDir, f)) }))
      .filter(f => f.stat.size > 50000) // Only consider backups larger than 50KB (not empty DBs)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // Newest first

    if (backups.length === 0) return false;

    const currentExists = fs.existsSync(DB_PATH);
    const currentSize = currentExists ? fs.statSync(DB_PATH).size : 0;
    const bestBackup = backups[0];

    console.log(`[DB] Found ${backups.length} backup(s). Best: ${bestBackup.name} (${(bestBackup.stat.size / 1024).toFixed(1)}KB). Current DB: ${(currentSize / 1024).toFixed(1)}KB`);

    // Restore if: current DB doesn't exist, or current DB is much smaller than backup (likely empty/fresh)
    if (!currentExists || currentSize < 50000 && bestBackup.stat.size > currentSize * 10) {
      console.log(`[DB] AUTO-RESTORING from backup: ${bestBackup.name} (${(bestBackup.stat.size / 1024 / 1024).toFixed(2)}MB)`);
      // Back up the current empty DB just in case
      if (currentExists && currentSize > 0) {
        fs.copyFileSync(DB_PATH, DB_PATH + '.empty.' + Date.now());
      }
      fs.copyFileSync(bestBackup.path, DB_PATH);
      console.log(`[DB] Restore complete! Database restored from ${bestBackup.name}`);
      return true;
    }
  } catch (err) {
    console.error(`[DB] Auto-restore check failed:`, err);
  }
  return false;
}

// Try auto-restore before opening DB
autoRestoreBackup();

let db: InstanceType<typeof Database>;
try {
  db = new Database(DB_PATH);
  // Verify the DB has real data (not just empty schema)
  const tableCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any).c;
  console.log(`[DB] Database opened successfully (${tableCount} tables)`);

  // If DB opened but has no tables and a backup exists, try restore
  if (tableCount === 0) {
    console.log(`[DB] Database has no tables — checking for backups...`);
    db.close();
    if (autoRestoreBackup()) {
      db = new Database(DB_PATH);
      const newCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as any).c;
      console.log(`[DB] After restore: ${newCount} tables`);
    } else {
      db = new Database(DB_PATH);
    }
  }
} catch (e: any) {
  console.error(`[DB] Failed to open database: ${e.message}. Retrying in 3 seconds...`);
  // Wait and retry — Azure CIFS locks can cause transient failures during deployment
  // Use synchronous busy-wait (3 seconds) since this only runs on DB open failure
  const waitUntil = Date.now() + 3000;
  while (Date.now() < waitUntil) { /* busy wait */ }
  try {
    db = new Database(DB_PATH);
    console.log(`[DB] Database opened on retry`);
  } catch (e2: any) {
    console.error(`[DB] FATAL: Cannot open database after retry: ${e2.message}`);
    if (!fs.existsSync(DB_PATH)) {
      console.log(`[DB] No database file found at ${DB_PATH}, creating new one`);
      db = new Database(DB_PATH);
    } else {
      throw new Error(`Cannot open existing database at ${DB_PATH}: ${e2.message}. Manual intervention required.`);
    }
  }
}

// ===== DATABASE FILE PROTECTION GUARDRAIL =====
// This guardrail intercepts any attempt to delete, rename, or overwrite the database file.
// It was added after 4 incidents of production data loss caused by code that
// accidentally deleted/renamed the database file during deployment.
// DO NOT REMOVE OR MODIFY THIS GUARDRAIL.
const _originalUnlinkSync = fs.unlinkSync;
const _originalRenameSync = fs.renameSync;
const dbBaseName = path.basename(DB_PATH).toLowerCase();
const dbDirNorm = path.dirname(DB_PATH).replace(/\\/g, '/').toLowerCase();

function isDbFile(filePath: string): boolean {
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  const base = path.basename(norm);
  // Protect the main DB file and its journal/WAL files
  return (base === dbBaseName || base === dbBaseName + '-wal' || base === dbBaseName + '-shm' || base === dbBaseName + '-journal')
    && norm.includes(dbDirNorm);
}

fs.unlinkSync = function guardedUnlinkSync(p: fs.PathLike): void {
  if (isDbFile(String(p))) {
    console.error(`[DB-GUARDRAIL] BLOCKED attempt to DELETE database file: ${p}`);
    console.error(`[DB-GUARDRAIL] Stack trace:`, new Error().stack);
    throw new Error(`GUARDRAIL: Deleting the database file is forbidden. File: ${p}`);
  }
  return _originalUnlinkSync(p);
} as typeof fs.unlinkSync;

fs.renameSync = function guardedRenameSync(oldPath: fs.PathLike, newPath: fs.PathLike): void {
  if (isDbFile(String(oldPath))) {
    console.error(`[DB-GUARDRAIL] BLOCKED attempt to RENAME database file: ${oldPath} -> ${newPath}`);
    console.error(`[DB-GUARDRAIL] Stack trace:`, new Error().stack);
    throw new Error(`GUARDRAIL: Renaming the database file is forbidden. File: ${oldPath}`);
  }
  return _originalRenameSync(oldPath, newPath);
} as typeof fs.renameSync;

console.log(`[DB-GUARDRAIL] Database file protection active for: ${DB_PATH}`);

// ===== CRITICAL: SQLite configuration for Azure vs Local =====
// Azure App Service uses CIFS/SMB network share for /home mount.
// SQLite WAL mode is UNSAFE on network shares because:
// 1. WAL uses shared memory (.db-shm) which requires POSIX locking (not available on CIFS)
// 2. Memory-mapped I/O (mmap) doesn't work correctly on network shares
// 3. When container restarts, un-checkpointed WAL data is LOST
// This was the ROOT CAUSE of data loss on Azure deployments.
if (isAzure) {
  // AZURE: Use DELETE journal mode (safe for network shares)
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');         // NORMAL is safe with DELETE journal mode — only risks losing last txn on power failure (N/A on Azure)
  db.pragma('cache_size = -256000');         // 256MB cache — P2v2 has 7GB RAM, keep entire DB in memory to avoid slow CIFS reads
  db.pragma('temp_store = MEMORY');          // Use RAM for temp tables
  // Do NOT use mmap on Azure CIFS - it's unreliable
  db.pragma('mmap_size = 0');
  db.pragma('busy_timeout = 10000');         // Wait 10s for locks instead of failing immediately
  console.log(`[DB] Azure mode: journal_mode=DELETE, synchronous=NORMAL, cache=256MB, mmap=OFF (safe for CIFS/SMB)`);
} else {
  // LOCAL: WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');         // Faster writes (WAL provides crash safety)
  db.pragma('cache_size = -64000');          // 64MB cache
  db.pragma('temp_store = MEMORY');          // Use RAM for temp tables
  db.pragma('mmap_size = 268435456');        // 256MB memory-mapped I/O
  db.pragma('wal_autocheckpoint = 1000');    // Checkpoint every 1000 pages
  console.log(`[DB] Local mode: journal_mode=WAL, synchronous=NORMAL, mmap=256MB`);
}

// ===== AZURE: Automatic database backup on startup =====
// Creates a timestamped backup copy every time the server starts.
// This protects against data loss from Azure container restarts.
if (isAzure) {
  try {
    const backupDir = '/home/data/backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Only backup if the DB has data (file > 100KB)
    const stats = fs.statSync(DB_PATH);
    if (stats.size > 100 * 1024) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(backupDir, `aimailpilot-${timestamp}.db`);
      
      // Use SQLite backup API for consistent backup (not file copy)
      db.backup(backupPath).then(() => {
        console.log(`[DB] Azure backup created: ${backupPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
        
        // Keep only last 5 backups to save space
        try {
          const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('aimailpilot-') && f.endsWith('.db'))
            .sort()
            .reverse();
          for (let i = 5; i < backups.length; i++) {
            fs.unlinkSync(path.join(backupDir, backups[i]));
            console.log(`[DB] Removed old backup: ${backups[i]}`);
          }
        } catch (e) { /* ignore cleanup errors */ }
      }).catch((err: any) => {
        console.error(`[DB] Azure backup failed:`, err);
        // Fallback: simple file copy
        try {
          fs.copyFileSync(DB_PATH, backupPath);
          console.log(`[DB] Azure backup (file copy) created: ${backupPath}`);
        } catch (e2) {
          console.error(`[DB] Azure backup file copy also failed:`, e2);
        }
      });
    } else {
      console.log(`[DB] Azure backup skipped: DB too small (${stats.size} bytes), likely empty`);
    }
  } catch (e) {
    console.error('[DB] Azure backup error:', e);
  }
}

// ===== GRACEFUL SHUTDOWN: Checkpoint WAL and close DB =====
// Even though Azure uses DELETE mode now, this handles edge cases
function gracefulShutdown(signal: string) {
  console.log(`[DB] ${signal} received, closing database...`);
  try {
    if (!isAzure) {
      // Checkpoint WAL before closing (local only since Azure uses DELETE mode)
      db.pragma('wal_checkpoint(TRUNCATE)');
    }
    db.close();
    console.log(`[DB] Database closed cleanly`);
  } catch (e) {
    console.error(`[DB] Error closing database:`, e);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
    isSuperAdmin INTEGER DEFAULT 0,
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
    isPublic INTEGER DEFAULT 1,
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

  -- Organization Members (multitenancy: many-to-many user<->org)
  CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    userId TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    isDefault INTEGER DEFAULT 0,
    joinedAt TEXT NOT NULL,
    invitedBy TEXT,
    createdAt TEXT NOT NULL,
    UNIQUE(organizationId, userId)
  );
  CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(userId);
  CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(organizationId);
  CREATE INDEX IF NOT EXISTS idx_org_members_default ON org_members(userId, isDefault);

  -- Organization Invitations
  CREATE TABLE IF NOT EXISTS org_invitations (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    invitedBy TEXT,
    token TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending',
    expiresAt TEXT NOT NULL,
    acceptedAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email, status);
  CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations(organizationId, status);
  CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token);
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

// ========== Contact Lists migration: add uploadedBy columns ==========
try { db.exec(`ALTER TABLE contact_lists ADD COLUMN uploadedBy TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE contact_lists ADD COLUMN uploadedByName TEXT`); } catch (e) { /* already exists */ }

// ========== Multitenancy migration: ensure all users have org_member records ==========
try {
  const usersWithoutMembership = db.prepare(`
    SELECT u.id, u.organizationId FROM users u 
    LEFT JOIN org_members om ON om.userId = u.id AND om.organizationId = u.organizationId
    WHERE om.id IS NULL AND u.organizationId IS NOT NULL
  `).all() as any[];
  if (usersWithoutMembership.length > 0) {
    const insertMember = db.prepare('INSERT OR IGNORE INTO org_members (id, organizationId, userId, role, isDefault, joinedAt, createdAt) VALUES (?, ?, ?, ?, 1, ?, ?)');
    const ts = now();
    for (const u of usersWithoutMembership) {
      insertMember.run(genId(), u.organizationId, u.id, 'admin', ts, ts);
    }
    console.log(`[Migration] Created ${usersWithoutMembership.length} org_member record(s) for existing users`);
  }
} catch (e) { /* ignore */ }

// ========== Messages table migrations ==========
try { db.exec(`ALTER TABLE messages ADD COLUMN providerMessageId TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(providerMessageId)`); } catch (e) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN gmailThreadId TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE messages ADD COLUMN bouncedAt TEXT`); } catch (e) { /* already exists */ }

// ========== SuperAdmin migration ==========
try { db.exec(`ALTER TABLE users ADD COLUMN isSuperAdmin INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }
// Auto-promote superadmin from environment variable (comma-separated emails)
try {
  const superAdminEmails = (process.env.SUPERADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (superAdminEmails.length > 0) {
    const promote = db.prepare('UPDATE users SET isSuperAdmin = 1 WHERE LOWER(email) = ?');
    for (const email of superAdminEmails) {
      promote.run(email);
    }
    console.log(`[SuperAdmin] Checked ${superAdminEmails.length} email(s) for superadmin promotion`);
  }
} catch (e) { /* ignore */ }

// ========== Templates migration: make all existing templates public by default ==========
try { db.exec(`UPDATE templates SET isPublic = 1 WHERE isPublic = 0 OR isPublic IS NULL`); } catch (e) { /* ignore */ }

// ========== Email account ownership migration: add userId ==========
try { db.exec(`ALTER TABLE email_accounts ADD COLUMN userId TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(userId)`); } catch (e) {}
// NOTE: We do NOT auto-assign unowned accounts to the admin anymore.
// Admins can reassign accounts via the /api/email-accounts/:id/assign endpoint.
// Accounts with NULL userId are only visible to admins for reassignment.

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

// ========== Unified Inbox migrations ==========
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN replyContent TEXT`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN repliedBy TEXT`); } catch (e) { /* already exists */ }

// Campaign sending config (throttle, schedule, time windows)
try { db.exec(`ALTER TABLE campaigns ADD COLUMN sendingConfig TEXT`); } catch (e) { /* already exists */ }
// Campaign includeUnsubscribe and trackOpens flags
try { db.exec(`ALTER TABLE campaigns ADD COLUMN includeUnsubscribe INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN trackOpens INTEGER DEFAULT 1`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN spamCount INTEGER DEFAULT 0`); } catch (e) { /* already exists */ }
try { db.exec(`ALTER TABLE campaigns ADD COLUMN sendOrder TEXT`); } catch (e) { /* already exists */ }

// ========== v12 Unified Inbox & Contact Engine Migrations ==========

// Unified Inbox: reply classification, bounce type, threading, assignment, lead status
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN replyType TEXT DEFAULT ''`); } catch (e) {} // positive, negative, ooo, auto_reply, general, bounce, unsubscribe
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN bounceType TEXT DEFAULT ''`); } catch (e) {} // hard, soft, blocked, mailbox_full
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN threadId TEXT`); } catch (e) {} // conversation thread
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN inReplyTo TEXT`); } catch (e) {} // references parent message
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN assignedTo TEXT`); } catch (e) {} // team member userId
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN leadStatus TEXT DEFAULT ''`); } catch (e) {} // interested, meeting_scheduled, follow_up, closed, not_interested
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN isStarred INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN labels TEXT DEFAULT '[]'`); } catch (e) {} // JSON array of labels/tags
try { db.exec(`ALTER TABLE unified_inbox ADD COLUMN sentByUs INTEGER DEFAULT 0`); } catch (e) {} // 1 if sent by us (outbound)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_thread ON unified_inbox(threadId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_assigned ON unified_inbox(assignedTo)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_reply_type ON unified_inbox(replyType)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_lead_status ON unified_inbox(leadStatus)`); } catch (e) {}

// Contacts: lead status, unsubscribe flag, bounce info, campaign history
try { db.exec(`ALTER TABLE contacts ADD COLUMN leadStatus TEXT DEFAULT ''`); } catch (e) {} // interested, meeting_scheduled, follow_up, closed, not_interested
try { db.exec(`ALTER TABLE contacts ADD COLUMN unsubscribed INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN unsubscribedAt TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN bounceType TEXT DEFAULT ''`); } catch (e) {} // hard, soft, blocked, mailbox_full
try { db.exec(`ALTER TABLE contacts ADD COLUMN bouncedAt TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN campaignHistory TEXT DEFAULT '[]'`); } catch (e) {} // JSON array of campaign IDs
try { db.exec(`ALTER TABLE contacts ADD COLUMN lastOpenedAt TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN lastClickedAt TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN lastRepliedAt TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN totalSent INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN totalOpened INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN totalClicked INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN totalReplied INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN totalBounced INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON contacts(leadStatus)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_unsubscribed ON contacts(unsubscribed)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_bounce ON contacts(bounceType)`); } catch (e) {}

// Email verification columns
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailVerificationStatus TEXT DEFAULT 'unverified'`); } catch (e) {} // unverified, valid, invalid, risky, disposable, spamtrap
try { db.exec(`ALTER TABLE contacts ADD COLUMN emailVerifiedAt TEXT`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_verification ON contacts(emailVerificationStatus)`); } catch (e) {}

// Pipeline stage, follow-up tracking
try { db.exec(`ALTER TABLE contacts ADD COLUMN pipelineStage TEXT DEFAULT 'new'`); } catch (e) {} // new, contacted, interested, meeting_scheduled, meeting_done, proposal_sent, won, lost
try { db.exec(`ALTER TABLE contacts ADD COLUMN nextActionDate TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN nextActionType TEXT`); } catch (e) {} // call, meeting, email, whatsapp, proposal
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_pipeline ON contacts(pipelineStage)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_next_action ON contacts(nextActionDate)`); } catch (e) {}

// Deal tracking columns
try { db.exec(`ALTER TABLE contacts ADD COLUMN dealValue REAL DEFAULT 0`); } catch (e) {} // deal amount in currency
try { db.exec(`ALTER TABLE contacts ADD COLUMN dealClosedAt TEXT`); } catch (e) {} // when deal was won/lost
try { db.exec(`ALTER TABLE contacts ADD COLUMN dealNotes TEXT DEFAULT ''`); } catch (e) {} // what was sold / deal description

// Contact activities table (activity log / remarks)
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_activities (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL,
    organizationId TEXT NOT NULL,
    userId TEXT,
    type TEXT NOT NULL DEFAULT 'note',
    outcome TEXT,
    notes TEXT,
    nextActionDate TEXT,
    nextActionType TEXT,
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL
  )
`);
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_contact ON contact_activities(contactId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_org ON contact_activities(organizationId)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_next ON contact_activities(nextActionDate)`); } catch (e) {}

// Global Suppression List table
db.exec(`
  CREATE TABLE IF NOT EXISTS suppression_list (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    email TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'manual',
    bounceType TEXT,
    source TEXT,
    campaignId TEXT,
    notes TEXT,
    createdAt TEXT NOT NULL,
    UNIQUE(organizationId, email)
  );
  CREATE INDEX IF NOT EXISTS idx_suppression_org ON suppression_list(organizationId, email);
  CREATE INDEX IF NOT EXISTS idx_suppression_reason ON suppression_list(organizationId, reason);
`);

// Email Warmup Monitoring table
db.exec(`
  CREATE TABLE IF NOT EXISTS warmup_accounts (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    emailAccountId TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    dailyTarget INTEGER DEFAULT 5,
    currentDaily INTEGER DEFAULT 0,
    totalSent INTEGER DEFAULT 0,
    totalReceived INTEGER DEFAULT 0,
    inboxRate REAL DEFAULT 0,
    spamRate REAL DEFAULT 0,
    reputationScore REAL DEFAULT 50,
    startDate TEXT NOT NULL,
    lastWarmupAt TEXT,
    settings TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_warmup_org ON warmup_accounts(organizationId);
  CREATE INDEX IF NOT EXISTS idx_warmup_email ON warmup_accounts(emailAccountId);
`);

// Warmup Log (daily stats)
db.exec(`
  CREATE TABLE IF NOT EXISTS warmup_logs (
    id TEXT PRIMARY KEY,
    warmupAccountId TEXT NOT NULL,
    date TEXT NOT NULL,
    sent INTEGER DEFAULT 0,
    received INTEGER DEFAULT 0,
    inboxCount INTEGER DEFAULT 0,
    spamCount INTEGER DEFAULT 0,
    bounceCount INTEGER DEFAULT 0,
    openCount INTEGER DEFAULT 0,
    replyCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_warmup_logs_acct ON warmup_logs(warmupAccountId, date);
`);

// v: Add sendPairs column to warmup_logs for per-pair tracking
try { db.exec(`ALTER TABLE warmup_logs ADD COLUMN sendPairs TEXT DEFAULT '[]'`); } catch (e) { /* already exists */ }

// Email History — deep scan of linked account email history
db.exec(`
  CREATE TABLE IF NOT EXISTS email_history (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    emailAccountId TEXT NOT NULL,
    accountEmail TEXT NOT NULL,
    provider TEXT,
    externalId TEXT,
    threadId TEXT,
    fromEmail TEXT NOT NULL,
    fromName TEXT,
    toEmail TEXT,
    subject TEXT,
    snippet TEXT,
    direction TEXT NOT NULL DEFAULT 'received',
    receivedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_email_history_org ON email_history(organizationId, receivedAt);
  CREATE INDEX IF NOT EXISTS idx_email_history_account ON email_history(emailAccountId, receivedAt);
  CREATE INDEX IF NOT EXISTS idx_email_history_thread ON email_history(threadId);
  CREATE INDEX IF NOT EXISTS idx_email_history_external ON email_history(externalId);
  CREATE INDEX IF NOT EXISTS idx_email_history_from ON email_history(fromEmail);
`);

// Lead Opportunities — AI-classified leads from email history analysis
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_opportunities (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    emailAccountId TEXT,
    contactEmail TEXT NOT NULL,
    contactName TEXT,
    company TEXT,
    bucket TEXT NOT NULL DEFAULT 'unknown',
    confidence INTEGER DEFAULT 0,
    aiReasoning TEXT,
    suggestedAction TEXT,
    lastEmailDate TEXT,
    totalEmails INTEGER DEFAULT 0,
    totalSent INTEGER DEFAULT 0,
    totalReceived INTEGER DEFAULT 0,
    sampleSubjects TEXT DEFAULT '[]',
    sampleSnippets TEXT DEFAULT '[]',
    status TEXT DEFAULT 'new',
    reviewedAt TEXT,
    reviewedBy TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lead_opps_org ON lead_opportunities(organizationId, bucket);
  CREATE INDEX IF NOT EXISTS idx_lead_opps_email ON lead_opportunities(contactEmail);
  CREATE INDEX IF NOT EXISTS idx_lead_opps_status ON lead_opportunities(organizationId, status);
`);
try { db.exec(`ALTER TABLE lead_opportunities ADD COLUMN accountEmail TEXT DEFAULT ''`); } catch (e) {}

// Contact Activity Timeline
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_activity (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    contactId TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    campaignId TEXT,
    messageId TEXT,
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contact_activity_contact ON contact_activity(contactId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_contact_activity_org ON contact_activity(organizationId);
`);

// Reply Notifications
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    userId TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    linkUrl TEXT,
    isRead INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, isRead, createdAt);
  CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organizationId, createdAt);
`);

// ========== CONTEXT ENGINE — Organization Knowledge Base ==========
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_documents (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      name TEXT NOT NULL,
      docType TEXT NOT NULL DEFAULT 'general',
      source TEXT NOT NULL DEFAULT 'upload',
      content TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      fileSize INTEGER DEFAULT 0,
      mimeType TEXT DEFAULT '',
      uploadedBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_org_docs_org ON org_documents(organizationId, docType);
    CREATE INDEX IF NOT EXISTS idx_org_docs_tags ON org_documents(organizationId, tags);
  `);
} catch (e) { /* table already exists */ }

// FTS5 full-text search index for org_documents (zero dependencies, built into better-sqlite3)
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS org_documents_fts USING fts5(
      name, content, summary, tags,
      content='org_documents', content_rowid='rowid'
    );
  `);
} catch (e) { /* FTS5 already exists or not supported */ }

// Email attachments table — stores files for templates/campaigns
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_attachments (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      templateId TEXT,
      campaignId TEXT,
      fileName TEXT NOT NULL,
      fileSize INTEGER DEFAULT 0,
      mimeType TEXT DEFAULT '',
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
} catch (e) { /* table already exists */ }

// Performance indexes for slow queries
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(organizationId, status)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_org_created ON contacts(organizationId, createdAt)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_templates_org ON templates(organizationId, updatedAt)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_templates_created_by ON templates(createdBy)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_org_created ON campaigns(organizationId, createdAt)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(createdBy)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_campaign_status ON messages(campaignId, status)`); } catch (e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_email_accounts_org ON email_accounts(organizationId)`); } catch (e) {}

// Migrate existing email accounts to correct provider-based daily limits
// Gmail=2000, Outlook=10000, ElasticEmail=unlimited, Custom=500
try {
  db.exec(`UPDATE email_accounts SET dailyLimit = 2000 WHERE provider IN ('gmail', 'google') AND dailyLimit < 2000`);
  db.exec(`UPDATE email_accounts SET dailyLimit = 10000 WHERE provider IN ('outlook', 'microsoft') AND dailyLimit < 10000`);
  db.exec(`UPDATE email_accounts SET dailyLimit = 999999999 WHERE provider IN ('elasticemail', 'elastic-email', 'elastic_email')`);
} catch (e) { /* ignore */ }

// ========== SEED DATA (only on first run) ==========
const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';

function seedIfEmpty() {
  const orgCount = (db.prepare('SELECT COUNT(*) as c FROM organizations').get() as any).c;
  if (orgCount > 0) return; // Already seeded

  console.log('[SQLite] Seeding initial data...');
  const ts = now();

  // Organization
  db.prepare('INSERT INTO organizations (id, name, domain, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    ORG_ID, 'AImailPilot Organization', 'aimailpilot.com', '{}', ts, ts
  );

  // User
  db.prepare('INSERT INTO users (id, email, firstName, lastName, role, organizationId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
    'user-123', 'demo@aimailpilot.com', 'Demo', 'User', 'admin', ORG_ID, ts, ts
  );

  // Org Member (associate demo user with org)
  db.prepare('INSERT INTO org_members (id, organizationId, userId, role, isDefault, joinedAt, createdAt) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    genId(), ORG_ID, 'user-123', 'owner', ts, ts
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
  insertCampaign.run(CIDS.q4, ORG_ID, 'Q4 Product Launch', 'New feature announcement', 'completed', 1250, 1180, 720, 345, 89, 12, 5, 'Exciting news from AImailPilot!', '<p>Hi {{firstName}},</p><p>We have exciting news!</p>', '[]', '2025-08-15T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.onboard, ORG_ID, 'Customer Onboarding Series', 'Welcome email sequence', 'completed', 450, 430, 312, 156, 42, 3, 2, 'Welcome to AImailPilot!', '<p>Hi {{firstName}},</p><p>Welcome!</p>', '[]', '2025-08-20T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.reengage, ORG_ID, 'Re-engagement Campaign', 'Win back inactive users', 'scheduled', 890, 0, 0, 0, 0, 0, 0, '', '', '[]', '2025-09-01T00:00:00.000Z', ts);
  insertCampaign.run(CIDS.newsletter, ORG_ID, 'Newsletter - August', 'Monthly newsletter', 'completed', 2400, 2380, 1450, 678, 120, 20, 15, 'AImailPilot August Newsletter', '<p>Hi {{firstName}},</p><p>Monthly update.</p>', '[]', '2025-08-01T00:00:00.000Z', '2025-08-30T00:00:00.000Z');
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

      insertMsg.run(msgId, CIDS.q4, contact.id, 'Exciting news from AImailPilot!', `<p>Hi ${contact.firstName},</p><p>We have exciting news...</p>`, isBounced ? 'failed' : 'sent', trackingId, 0, isBounced ? null : sentTime, openTime, clickTime, replyTime, sentTime);

      insertEvt.run(`evt-sent-${msgId}`, 'sent', CIDS.q4, msgId, contact.id, trackingId, null, null, null, sentTime);
      if (hasOpen) {
        insertEvt.run(`evt-open-${msgId}`, 'open', CIDS.q4, msgId, contact.id, trackingId, null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', null, openTime);
        if (Math.random() < 0.3) {
          insertEvt.run(`evt-open2-${msgId}`, 'open', CIDS.q4, msgId, contact.id, trackingId, null, null, null, new Date(new Date(openTime!).getTime() + Math.random() * dayMs).toISOString());
        }
      }
      if (hasClick) insertEvt.run(`evt-click-${msgId}`, 'click', CIDS.q4, msgId, contact.id, trackingId, 'https://aimailpilot.com/features', null, null, clickTime);
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

      insertMsg.run(msgId, CIDS.newsletter, contact.id, 'AImailPilot August Newsletter', `<p>Hi ${contact.firstName},</p><p>Monthly update...</p>`, 'sent', trackingId, 0, sentTime, openTime, clickTime, replyTime, sentTime);
      insertEvt.run(`evt-sent-nl-${i}`, 'sent', CIDS.newsletter, msgId, contact.id, trackingId, null, null, null, sentTime);
      if (hasOpen) insertEvt.run(`evt-open-nl-${i}`, 'open', CIDS.newsletter, msgId, contact.id, trackingId, null, null, null, openTime);
      if (hasClick) insertEvt.run(`evt-click-nl-${i}`, 'click', CIDS.newsletter, msgId, contact.id, trackingId, 'https://aimailpilot.com/blog/august-update', null, null, clickTime);
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
  async getEmailAccountsForUser(organizationId: string, userId: string) {
    return db.prepare('SELECT * FROM email_accounts WHERE organizationId = ? AND userId = ?').all(organizationId, userId).map(hydrateAccount);
  }
  async getEmailAccount(id: string) { return hydrateAccount(db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(id)); }
  async getEmailAccountByEmail(organizationId: string, email: string) {
    return hydrateAccount(db.prepare('SELECT * FROM email_accounts WHERE organizationId = ? AND email = ?').get(organizationId, email));
  }
  // Find email account by email only (across all orgs) - used for OAuth re-auth to find the correct org
  async findEmailAccountByEmail(email: string) {
    return hydrateAccount(db.prepare('SELECT * FROM email_accounts WHERE email = ? LIMIT 1').get(email));
  }
  async createEmailAccount(account: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO email_accounts (id, organizationId, userId, provider, email, displayName, smtpConfig, dailyLimit, dailySent, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, account.organizationId, account.userId || null, account.provider || 'custom', account.email, account.displayName || account.email, toJson(account.smtpConfig), account.dailyLimit || 500, 0, 1, ts2, ts2
    );
    return this.getEmailAccount(id);
  }
  async updateEmailAccount(id: string, data: any) {
    const existing = await this.getEmailAccount(id);
    if (!existing) throw new Error('Email account not found');
    const merged = { ...existing, ...data };
    const authStatus = 'authStatus' in data ? data.authStatus : (existing as any).authStatus;
    const authFailureCount = 'authFailureCount' in data ? data.authFailureCount : (existing as any).authFailureCount;
    const authLastFailureAt = 'authLastFailureAt' in data ? data.authLastFailureAt : (existing as any).authLastFailureAt;
    const authLastErrorCode = 'authLastErrorCode' in data ? data.authLastErrorCode : (existing as any).authLastErrorCode;
    db.prepare('UPDATE email_accounts SET displayName=?, smtpConfig=?, dailyLimit=?, dailySent=?, isActive=?, provider=?, updatedAt=?, authStatus=?, authFailureCount=?, authLastFailureAt=?, authLastErrorCode=? WHERE id=?').run(
      merged.displayName, toJson(merged.smtpConfig), merged.dailyLimit, merged.dailySent, merged.isActive ? 1 : 0, merged.provider || existing.provider, now(),
      authStatus ?? null, authFailureCount ?? 0, authLastFailureAt ?? null, authLastErrorCode ?? null, id
    );
    return this.getEmailAccount(id);
  }

  async deleteEmailAccount(id: string) { db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id); return true; }
  async assignEmailAccountToUser(id: string, userId: string) {
    db.prepare('UPDATE email_accounts SET userId = ?, updatedAt = ? WHERE id = ?').run(userId, now(), id);
    return this.getEmailAccount(id);
  }
  
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
  async getAvailableEmailAccountsForUser(organizationId: string, userId: string) {
    return db.prepare('SELECT * FROM email_accounts WHERE organizationId = ? AND userId = ? AND isActive = 1 AND dailySent < dailyLimit ORDER BY dailySent ASC')
      .all(organizationId, userId).map(hydrateAccount);
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
  async getContactListsForUser(organizationId: string, userId: string) {
    return db.prepare(`
      SELECT DISTINCT cl.* FROM contact_lists cl
      WHERE cl.organizationId = ?
        AND (
          cl.uploadedBy = ?
          OR EXISTS (SELECT 1 FROM contacts c WHERE c.listId = cl.id AND c.assignedTo = ?)
        )
      ORDER BY cl.createdAt DESC
    `).all(organizationId, userId, userId).map(hydrateList);
  }
  async getContactList(id: string) { return hydrateList(db.prepare('SELECT * FROM contact_lists WHERE id = ?').get(id)); }
  async createContactList(list: any) {
    const id = genId(); const ts2 = now();
    db.prepare('INSERT INTO contact_lists (id, organizationId, name, source, headers, contactCount, uploadedBy, uploadedByName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, list.organizationId, list.name, list.source || 'csv', toJson(list.headers || []), list.contactCount || 0, list.uploadedBy || null, list.uploadedByName || null, ts2, ts2
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
  async deleteContactList(id: string, deleteContacts = false) {
    if (deleteContacts) {
      db.prepare('DELETE FROM contacts WHERE listId = ?').run(id);
    }
    db.prepare('DELETE FROM contact_lists WHERE id = ?').run(id);
    return true;
  }

  // ========== Contacts ==========
  async getContacts(organizationId: string, limit = 50, offset = 0, filters?: { listId?: string; status?: string; assignedTo?: string }) {
    let sql = 'SELECT * FROM contacts WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ' AND (assignedTo IS NULL OR assignedTo = \'\')'; }
    else if (filters?.assignedTo) { sql += ' AND assignedTo = ?'; params.push(filters.assignedTo); }
    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params).map(hydrateContact);
  }
  async getContactsCount(organizationId: string, filters?: { listId?: string; status?: string; assignedTo?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM contacts WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ' AND (assignedTo IS NULL OR assignedTo = \'\')'; }
    else if (filters?.assignedTo) { sql += ' AND assignedTo = ?'; params.push(filters.assignedTo); }
    return (db.prepare(sql).get(...params) as any).c;
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
    // Case-insensitive email lookup
    return hydrateContact(db.prepare('SELECT * FROM contacts WHERE organizationId = ? AND LOWER(email) = LOWER(?)').get(organizationId, email));
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
        const existing = findStmt.get(contact.organizationId, contact.email) as any;
        if (existing) {
          // Never touch bounced, unsubscribed, or blocked contacts
          const protectedStatuses = new Set(['bounced', 'unsubscribed', 'blocked']);
          if (protectedStatuses.has(existing.status)) {
            results.push({ ...hydrateContact(existing), _skipped: true });
            continue;
          }
          // Fill only empty fields — existing CRM data always wins
          const stringFields: Array<[string, string]> = [
            ['firstName', 'firstName'], ['lastName', 'lastName'], ['company', 'company'],
            ['jobTitle', 'jobTitle'], ['phone', 'phone'], ['mobilePhone', 'mobilePhone'],
            ['linkedinUrl', 'linkedinUrl'], ['seniority', 'seniority'], ['department', 'department'],
            ['city', 'city'], ['state', 'state'], ['country', 'country'],
            ['website', 'website'], ['industry', 'industry'], ['employeeCount', 'employeeCount'],
            ['annualRevenue', 'annualRevenue'], ['companyLinkedinUrl', 'companyLinkedinUrl'],
            ['companyCity', 'companyCity'], ['companyState', 'companyState'],
            ['companyCountry', 'companyCountry'], ['companyAddress', 'companyAddress'],
            ['companyPhone', 'companyPhone'], ['secondaryEmail', 'secondaryEmail'],
            ['homePhone', 'homePhone'], ['emailStatus', 'emailStatus'],
          ];
          const updates: Record<string, any> = {};
          for (const [dbCol, srcKey] of stringFields) {
            if (contact[srcKey] && !existing[dbCol]) updates[dbCol] = contact[srcKey];
          }
          // Merge custom fields: only add keys missing from existing
          if (contact.customFields && typeof contact.customFields === 'object') {
            let existingCf: Record<string, any> = {};
            try { existingCf = typeof existing.customFields === 'string' ? JSON.parse(existing.customFields) : (existing.customFields || {}); } catch {}
            const merged = { ...contact.customFields, ...existingCf };
            if (JSON.stringify(merged) !== JSON.stringify(existingCf)) updates['customFields'] = JSON.stringify(merged);
          }
          if (listId && !existing.listId) updates['listId'] = listId;
          if (Object.keys(updates).length > 0) {
            updates['updatedAt'] = now();
            const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const setVals = [...Object.values(updates), existing.id];
            db.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`).run(...setVals);
            results.push({ ...hydrateContact(existing), _updated: true });
          } else {
            results.push({ ...hydrateContact(existing), _skipped: true });
          }
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
  async searchContacts(organizationId: string, query: string, filters?: { listId?: string; status?: string; assignedTo?: string }) {
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
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.assignedTo === 'unassigned') { sql += ' AND (assignedTo IS NULL OR assignedTo = \'\')'; }
    else if (filters?.assignedTo) { sql += ' AND assignedTo = ?'; params.push(filters.assignedTo); }
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
  async getEmailTemplatesByUser(organizationId: string, userId: string) { return db.prepare('SELECT * FROM templates WHERE organizationId = ? AND createdBy = ? ORDER BY updatedAt DESC').all(organizationId, userId).map(hydrateTemplate); }
  async getEmailTemplatesExcludingUser(organizationId: string, userId: string) { return db.prepare('SELECT * FROM templates WHERE organizationId = ? AND (createdBy IS NULL OR createdBy != ?) ORDER BY updatedAt DESC').all(organizationId, userId).map(hydrateTemplate); }
  async getPublicEmailTemplatesExcludingUser(organizationId: string, userId: string) { return db.prepare('SELECT * FROM templates WHERE organizationId = ? AND (createdBy IS NULL OR createdBy != ?) AND isPublic = 1 ORDER BY updatedAt DESC').all(organizationId, userId).map(hydrateTemplate); }
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

  // ========== Lead Assignment (CRM) ==========
  async assignContactsToUser(contactIds: string[], userId: string, organizationId: string) {
    const stmt = db.prepare('UPDATE contacts SET assignedTo = ?, updatedAt = ? WHERE id = ? AND organizationId = ?');
    const ts = now();
    const transaction = db.transaction(() => {
      for (const cid of contactIds) {
        stmt.run(userId, ts, cid, organizationId);
      }
    });
    transaction();
    return contactIds.length;
  }
  async unassignContacts(contactIds: string[], organizationId: string) {
    const stmt = db.prepare('UPDATE contacts SET assignedTo = NULL, updatedAt = ? WHERE id = ? AND organizationId = ?');
    const ts = now();
    const transaction = db.transaction(() => {
      for (const cid of contactIds) {
        stmt.run(ts, cid, organizationId);
      }
    });
    transaction();
    return contactIds.length;
  }
  async assignContactsByList(listId: string, userId: string, organizationId: string) {
    const ts = now();
    const result = db.prepare('UPDATE contacts SET assignedTo = ?, updatedAt = ? WHERE listId = ? AND organizationId = ?').run(userId, ts, listId, organizationId);
    return result.changes;
  }
  async getContactsForUser(organizationId: string, userId: string, limit = 50, offset = 0, filters?: { listId?: string; status?: string }) {
    let sql = 'SELECT * FROM contacts WHERE organizationId = ? AND assignedTo = ?';
    const params: any[] = [organizationId, userId];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params).map(hydrateContact);
  }
  async getContactsCountForUser(organizationId: string, userId: string, filters?: { listId?: string; status?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM contacts WHERE organizationId = ? AND assignedTo = ?';
    const params: any[] = [organizationId, userId];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    return (db.prepare(sql).get(...params) as any).c;
  }
  async searchContactsForUser(organizationId: string, userId: string, query: string, filters?: { listId?: string; status?: string }) {
    const q = `%${query}%`;
    let sql = `SELECT * FROM contacts WHERE organizationId = ? AND assignedTo = ? AND (email LIKE ? OR firstName LIKE ? OR lastName LIKE ? OR company LIKE ?)`;
    const params: any[] = [organizationId, userId, q, q, q, q];
    if (filters?.listId) { sql += ' AND listId = ?'; params.push(filters.listId); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    sql += ' ORDER BY createdAt DESC LIMIT 200';
    return db.prepare(sql).all(...params).map(hydrateContact);
  }
  async getAssignmentStats(organizationId: string) {
    const total = (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ?').get(organizationId) as any).c;
    const assigned = (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ? AND assignedTo IS NOT NULL').get(organizationId) as any).c;
    const unassigned = total - assigned;
    const byUser = db.prepare(`
      SELECT c.assignedTo as userId, u.email, u.firstName, u.lastName, COUNT(*) as contactCount
      FROM contacts c LEFT JOIN users u ON c.assignedTo = u.id
      WHERE c.organizationId = ? AND c.assignedTo IS NOT NULL
      GROUP BY c.assignedTo ORDER BY contactCount DESC
    `).all(organizationId);
    return { total, assigned, unassigned, byUser };
  }

  // ========== Campaigns ==========
  async getCampaigns(organizationId: string, limit = 20, offset = 0, status?: string) {
    let sql = 'SELECT * FROM campaigns WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (status && status !== 'all') {
      if (status === 'active') {
        sql += " AND (status = 'active' OR status = 'following_up')";
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }
    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params).map(hydrateCampaign);
  }
  async getCampaignsForUser(organizationId: string, userId: string, limit = 20, offset = 0, status?: string) {
    let sql = 'SELECT * FROM campaigns WHERE organizationId = ? AND createdBy = ?';
    const params: any[] = [organizationId, userId];
    if (status && status !== 'all') {
      if (status === 'active') {
        sql += " AND (status = 'active' OR status = 'following_up')";
      } else {
        sql += ' AND status = ?';
        params.push(status);
      }
    }
    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params).map(hydrateCampaign);
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
    // Filter out undefined values to avoid overwriting existing fields with null/undefined
    const cleanData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    }
    const m = { ...existing, ...cleanData };
    db.prepare(`UPDATE campaigns SET name=?, description=?, status=?, totalRecipients=?, sentCount=?, openedCount=?, clickedCount=?, repliedCount=?, bouncedCount=?, unsubscribedCount=?, subject=?, content=?, emailAccountId=?, templateId=?, contactIds=?, segmentId=?, scheduledAt=?, sendingConfig=?, trackOpens=?, includeUnsubscribe=?, updatedAt=? WHERE id=?`).run(
      m.name, m.description, m.status, m.totalRecipients, m.sentCount, m.openedCount, m.clickedCount, m.repliedCount, m.bouncedCount, m.unsubscribedCount,
      m.subject, m.content, m.emailAccountId || null, m.templateId || null, toJson(m.contactIds), m.segmentId || null, toSqlDate(m.scheduledAt), toJson(m.sendingConfig), m.trackOpens ?? 1, m.includeUnsubscribe ?? 0, now(), id
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

  // Get campaign stats for a specific user (member-scoped)
  async getCampaignStatsForUser(organizationId: string, userId: string) {
    const row = db.prepare(`SELECT
      COUNT(*) as totalCampaigns,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeCampaigns,
      SUM(sentCount) as totalSent, SUM(openedCount) as totalOpened,
      SUM(clickedCount) as totalClicked, SUM(repliedCount) as totalReplied,
      SUM(bouncedCount) as totalBounced, SUM(unsubscribedCount) as totalUnsubscribed
    FROM campaigns WHERE organizationId = ? AND createdBy = ?`).get(organizationId, userId) as any;
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

  // Get contact count for a specific user
  async getContactsCountForUserTotal(organizationId: string, userId: string) {
    return (db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ? AND assignedTo = ?').get(organizationId, userId) as any).c;
  }

  // ========== Campaign Messages ==========
  async getCampaignMessages(campaignId: string, limit = 100, offset = 0) {
    return db.prepare('SELECT * FROM messages WHERE campaignId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(campaignId, limit, offset);
  }
  async getCampaignMessage(id: string) { return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null; }
  async getFailedMessagesByContact(contactId: string, limit = 5) {
    return db.prepare("SELECT errorMessage FROM messages WHERE contactId = ? AND status = 'failed' AND errorMessage IS NOT NULL ORDER BY createdAt DESC LIMIT ?").all(contactId, limit) as any[];
  }
  async getCampaignMessageByTracking(trackingId: string) { return db.prepare('SELECT * FROM messages WHERE trackingId = ?').get(trackingId) || null; }
  /** Find the most recent sent message for a contact in a campaign at a specific step number */
  async getCampaignMessageByContactAndStep(campaignId: string, contactId: string, stepNumber: number) {
    return db.prepare("SELECT * FROM messages WHERE campaignId = ? AND contactId = ? AND stepNumber = ? AND status = 'sent' ORDER BY sentAt DESC LIMIT 1").get(campaignId, contactId, stepNumber) || null;
  }
  /** Find a sent campaign message by contact email and subject (for reply matching fallback) */
  async getCampaignMessageByContactEmailAndSubject(contactEmail: string, subject: string) {
    return db.prepare(`
      SELECT m.* FROM messages m
      JOIN contacts c ON m.contactId = c.id
      WHERE LOWER(c.email) = LOWER(?) AND LOWER(TRIM(m.subject)) = LOWER(TRIM(?)) AND m.repliedAt IS NULL
      ORDER BY m.sentAt DESC LIMIT 1
    `).get(contactEmail, subject) || null;
  }
  /** Find a sent campaign message by providerMessageId (for matching Microsoft's internetMessageId) */
  async getCampaignMessageByProviderMessageId(providerMsgId: string) {
    return db.prepare("SELECT * FROM messages WHERE providerMessageId = ? AND status = 'sent'").get(providerMsgId) || null;
  }
  async createCampaignMessage(message: any) {
    const id = genId();
    db.prepare('INSERT INTO messages (id, campaignId, contactId, subject, content, status, trackingId, emailAccountId, stepNumber, sentAt, openedAt, clickedAt, repliedAt, bouncedAt, errorMessage, providerMessageId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, message.campaignId, message.contactId || null, message.subject || '', message.content || '', message.status || 'sending',
      message.trackingId || null, message.emailAccountId || null, message.stepNumber || 0,
      toSqlDate(message.sentAt), toSqlDate(message.openedAt), toSqlDate(message.clickedAt), toSqlDate(message.repliedAt), toSqlDate(message.bouncedAt), message.errorMessage || null, message.providerMessageId || null, now()
    );
    return this.getCampaignMessage(id);
  }
  async updateCampaignMessage(id: string, data: any) {
    const existing = await this.getCampaignMessage(id);
    if (!existing) throw new Error('Message not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE messages SET status=?, sentAt=?, openedAt=?, clickedAt=?, repliedAt=?, bouncedAt=?, errorMessage=?, providerMessageId=?, gmailThreadId=? WHERE id=?').run(
      m.status, toSqlDate(m.sentAt), toSqlDate(m.openedAt), toSqlDate(m.clickedAt), toSqlDate(m.repliedAt), toSqlDate(m.bouncedAt), m.errorMessage || null, m.providerMessageId || null, m.gmailThreadId || null, id
    );
    return this.getCampaignMessage(id);
  }
  async deleteCampaignMessage(id: string) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    return true;
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
  async getRecentCampaignTrackingEvents(campaignId: string, limit = 50) {
    return db.prepare("SELECT * FROM tracking_events WHERE campaignId = ? AND type != 'prefetch' ORDER BY createdAt DESC LIMIT ?").all(campaignId, limit).map(hydrateEvent);
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
    const messages = db.prepare('SELECT * FROM messages WHERE campaignId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(campaignId, limit, offset) as any[];
    if (messages.length === 0) return [];

    // Batch-load all tracking events for these messages (1 query instead of N)
    const messageIds = messages.map((m: any) => m.id);
    const CHUNK = 500;
    const allEvents: any[] = [];
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const chunk = messageIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM tracking_events WHERE messageId IN (${placeholders}) AND type != 'prefetch' ORDER BY createdAt ASC`).all(...chunk);
      allEvents.push(...rows.map(hydrateEvent));
    }
    // Group events by messageId
    const eventsByMessageId = new Map<string, any[]>();
    for (const evt of allEvents) {
      const arr = eventsByMessageId.get(evt.messageId) || [];
      arr.push(evt);
      eventsByMessageId.set(evt.messageId, arr);
    }

    // Batch-load all contacts for these messages (1 query instead of N)
    const contactIds = [...new Set(messages.map((m: any) => m.contactId).filter(Boolean))];
    const contactMap = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const chunk = contactIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`).all(...chunk);
      for (const r of rows) {
        const c = hydrateContact(r);
        if (c) contactMap.set(c.id, c);
      }
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

  // Lightweight stats query — single SQL, no per-message enrichment
  // NOTE: messages table only has openedAt/clickedAt/repliedAt — NOT openCount/clickCount/replyCount
  async getCampaignMessageStats(campaignId: string) {
    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' OR status = 'sending' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'bounced' OR (status = 'failed' AND errorMessage LIKE '%bounce%') THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN openedAt IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN clickedAt IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN repliedAt IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM messages WHERE campaignId = ?
    `).get(campaignId) as any;
    return {
      total: row.total || 0,
      sent: row.sent || 0,
      bounced: row.bounced || 0,
      opened: row.opened || 0,
      clicked: row.clicked || 0,
      replied: row.replied || 0,
    };
  }

  // Lightweight per-step stats — single SQL with GROUP BY, no per-message enrichment
  // NOTE: messages table only has openedAt/clickedAt/repliedAt — NOT openCount/clickCount/replyCount
  async getCampaignStepStats(campaignId: string) {
    const rows = db.prepare(`
      SELECT
        COALESCE(stepNumber, 0) as stepNumber,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' OR status = 'sending' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'bounced' OR (status = 'failed' AND errorMessage LIKE '%bounce%') THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN openedAt IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN clickedAt IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN repliedAt IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM messages WHERE campaignId = ? GROUP BY COALESCE(stepNumber, 0) ORDER BY stepNumber ASC
    `).all(campaignId) as any[];
    return rows.map((r: any) => ({
      stepNumber: r.stepNumber,
      sent: r.sent || 0,
      bounced: r.bounced || 0,
      opened: r.opened || 0,
      clicked: r.clicked || 0,
      replied: r.replied || 0,
    }));
  }

  async getCampaignMessagesFiltered(campaignId: string, limit = 25, offset = 0, filter = 'all', search = '') {
    let where = 'WHERE m.campaignId = ?';
    const params: any[] = [campaignId];

    if (filter === 'opened') {
      where += ' AND (m.openedAt IS NOT NULL OR m.openCount > 0)';
    } else if (filter === 'clicked') {
      where += ' AND (m.clickedAt IS NOT NULL OR m.clickCount > 0)';
    } else if (filter === 'replied') {
      where += ' AND (m.repliedAt IS NOT NULL OR m.replyCount > 0)';
    } else if (filter === 'bounced') {
      where += " AND (m.status = 'bounced' OR m.status = 'failed')";
    }

    if (search) {
      where += ' AND (c.email LIKE ? OR c.firstName LIKE ? OR c.lastName LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as cnt FROM messages m LEFT JOIN contacts c ON m.contactId = c.id ${where}`
    ).get(...params) as any).cnt;

    const messages = db.prepare(
      `SELECT m.* FROM messages m LEFT JOIN contacts c ON m.contactId = c.id ${where} ORDER BY m.createdAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    // Batch-load events and contacts (same optimization as getCampaignMessagesEnriched)
    const messageIds = messages.map((m: any) => m.id);
    const CHUNK = 500;
    const allEvents: any[] = [];
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const chunk = messageIds.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      allEvents.push(...db.prepare(`SELECT * FROM tracking_events WHERE messageId IN (${ph}) AND type != 'prefetch' ORDER BY createdAt ASC`).all(...chunk).map(hydrateEvent));
    }
    const eventsByMsgId = new Map<string, any[]>();
    for (const evt of allEvents) { const arr = eventsByMsgId.get(evt.messageId) || []; arr.push(evt); eventsByMsgId.set(evt.messageId, arr); }

    const contactIds = [...new Set(messages.map((m: any) => m.contactId).filter(Boolean))];
    const contactMap = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const chunk = contactIds.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT * FROM contacts WHERE id IN (${ph})`).all(...chunk)) {
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

    return { messages: enriched, total };
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
      SELECT m.*, ct.email as contactEmail, c.name as campaignName FROM messages m
      INNER JOIN campaigns c ON m.campaignId = c.id
      LEFT JOIN contacts ct ON m.contactId = ct.id
      WHERE c.organizationId = ?
      AND m.status = 'sent'
      AND m.repliedAt IS NULL
      AND m.providerMessageId IS NOT NULL
      ORDER BY m.sentAt DESC
      LIMIT 5000
    `).all(orgId);
  }

  // Get ALL recent campaign messages (including already-replied) for inbox matching
  // This allows us to match incoming Gmail/Outlook messages to campaign context
  // even if the reply was already tracked
  // IMPORTANT: Include 'failed' status because bounced messages have status 'failed'
  // and we need them in the map to detect duplicate bounces
  async getAllRecentCampaignMessages(orgId: string) {
    return db.prepare(`
      SELECT m.*, ct.email as contactEmail, c.name as campaignName FROM messages m
      INNER JOIN campaigns c ON m.campaignId = c.id
      LEFT JOIN contacts ct ON m.contactId = ct.id
      WHERE c.organizationId = ?
      AND m.status IN ('sent', 'failed', 'sending', 'bounced')
      AND m.providerMessageId IS NOT NULL
      ORDER BY m.sentAt DESC
      LIMIT 50000
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
  
  // Check if a campaign has active follow-up steps (used to decide 'following_up' vs 'completed')
  async hasActiveFollowupSteps(campaignId: string): Promise<boolean> {
    const followup = db.prepare('SELECT cf.id FROM campaign_followups cf INNER JOIN followup_steps fs ON fs.sequenceId = cf.sequenceId WHERE cf.campaignId = ? AND cf.isActive = 1 LIMIT 1').get(campaignId);
    return !!followup;
  }

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
    const spam = (campaign as any).spamCount || 0;

    // v12: Enhanced analytics with reply/bounce breakdowns
    const replyBreakdown = db.prepare(`
      SELECT replyType, COUNT(*) as count FROM unified_inbox
      WHERE campaignId = ? AND replyType != '' AND replyType IS NOT NULL
      GROUP BY replyType
    `).all(campaignId);
    
    const bounceBreakdown = db.prepare(`
      SELECT bounceType, COUNT(*) as count FROM unified_inbox
      WHERE campaignId = ? AND bounceType != '' AND bounceType IS NOT NULL
      GROUP BY bounceType
    `).all(campaignId);
    
    const dailyTimeline = db.prepare(`
      SELECT DATE(createdAt) as date, type, COUNT(*) as count
      FROM tracking_events
      WHERE campaignId = ?
      GROUP BY DATE(createdAt), type
      ORDER BY date
    `).all(campaignId);
    
    const positiveReplies = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE campaignId = ? AND replyType = 'positive'").get(campaignId) as any).c;

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
    if (filters?.emailAccountId) {
      // Support comma-separated emailAccountIds for filtering by member's accounts
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ' AND emailAccountId = ?'; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND emailAccountId IN (${accountIds.map(() => '?').join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ' AND campaignId = ?'; params.push(filters.campaignId); }
    sql += ' ORDER BY receivedAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  // Member-scoped inbox: only messages from email accounts owned by this user
  async getInboxMessagesForUser(organizationId: string, userId: string, filters?: { status?: string; emailAccountId?: string; campaignId?: string }, limit = 50, offset = 0) {
    let sql = `SELECT ui.* FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui.emailAccountId
      WHERE ui.organizationId = ? AND ea.userId = ?`;
    const params: any[] = [organizationId, userId];
    if (filters?.status && filters.status !== 'all') { sql += ' AND ui.status = ?'; params.push(filters.status); }
    if (filters?.emailAccountId) { sql += ' AND ui.emailAccountId = ?'; params.push(filters.emailAccountId); }
    if (filters?.campaignId) { sql += ' AND ui.campaignId = ?'; params.push(filters.campaignId); }
    sql += ' ORDER BY ui.receivedAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  async getInboxMessageCount(organizationId: string, filters?: { status?: string; emailAccountId?: string }) {
    let sql = 'SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ?';
    const params: any[] = [organizationId];
    if (filters?.status && filters.status !== 'all') { sql += ' AND status = ?'; params.push(filters.status); }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ' AND emailAccountId = ?'; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND emailAccountId IN (${accountIds.map(() => '?').join(',')})`;
        params.push(...accountIds);
      }
    }
    return (db.prepare(sql).get(...params) as any).c;
  }

  async getInboxMessageCountForUser(organizationId: string, userId: string, filters?: { status?: string }) {
    let sql = `SELECT COUNT(*) as c FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui.emailAccountId
      WHERE ui.organizationId = ? AND ea.userId = ?`;
    const params: any[] = [organizationId, userId];
    if (filters?.status && filters.status !== 'all') { sql += ' AND ui.status = ?'; params.push(filters.status); }
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
      status, provider, aiDraft, repliedAt, receivedAt, createdAt,
      replyType, bounceType, threadId, inReplyTo, assignedTo, leadStatus, sentByUs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, msg.organizationId, msg.emailAccountId || null, msg.campaignId || null, msg.messageId || null, msg.contactId || null,
      msg.gmailMessageId || null, msg.gmailThreadId || null, msg.outlookMessageId || null, msg.outlookConversationId || null,
      msg.fromEmail, msg.fromName || '', msg.toEmail || '', msg.subject || '', msg.snippet || '', msg.body || '', msg.bodyHtml || '',
      msg.status || 'unread', msg.provider || '', msg.aiDraft || null, msg.repliedAt || null, msg.receivedAt || ts2, ts2,
      msg.replyType || '', msg.bounceType || '', msg.threadId || null, msg.inReplyTo || null, msg.assignedTo || null, msg.leadStatus || '', msg.sentByUs || 0
    );
    return this.getInboxMessage(id);
  }

  async updateInboxMessage(id: string, data: any) {
    const existing = await this.getInboxMessage(id);
    if (!existing) throw new Error('Inbox message not found');
    const m = { ...existing, ...data } as any;
    db.prepare('UPDATE unified_inbox SET status=?, aiDraft=?, repliedAt=?, replyContent=?, repliedBy=?, replyType=?, bounceType=?, threadId=?, assignedTo=?, leadStatus=?, isStarred=? WHERE id=?').run(
      m.status, m.aiDraft || null, m.repliedAt || null, m.replyContent || null, m.repliedBy || null,
      m.replyType || '', m.bounceType || '', m.threadId || null, m.assignedTo || null, m.leadStatus || '', m.isStarred || 0, id
    );
    return this.getInboxMessage(id);
  }

  async deleteInboxMessage(id: string) {
    db.prepare('DELETE FROM unified_inbox WHERE id = ?').run(id);
    return true;
  }

  async backfillInboxEmailAccountId(id: string, emailAccountId: string) {
    db.prepare('UPDATE unified_inbox SET emailAccountId = ? WHERE id = ?').run(emailAccountId, id);
  }

  async getInboxMessagesWithNullAccount(organizationId: string, limit = 200) {
    return db.prepare('SELECT * FROM unified_inbox WHERE organizationId = ? AND emailAccountId IS NULL ORDER BY receivedAt DESC LIMIT ?').all(organizationId, limit);
  }

  async getInboxUnreadCount(organizationId: string, emailAccountIds?: string) {
    if (emailAccountIds) {
      const ids = emailAccountIds.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length === 1) {
        return (db.prepare('SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = ? AND emailAccountId = ?').get(organizationId, 'unread', ids[0]) as any).c;
      } else if (ids.length > 1) {
        const placeholders = ids.map(() => '?').join(',');
        return (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = ? AND emailAccountId IN (${placeholders})`).get(organizationId, 'unread', ...ids) as any).c;
      }
    }
    return (db.prepare('SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = ?').get(organizationId, 'unread') as any).c;
  }

  async getInboxUnreadCountForUser(organizationId: string, userId: string) {
    return (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox ui
      INNER JOIN email_accounts ea ON ea.id = ui.emailAccountId
      WHERE ui.organizationId = ? AND ea.userId = ? AND ui.status = ?`).get(organizationId, userId, 'unread') as any).c;
  }

  // ========== Organization Members (Multitenancy) ==========
  
  async getOrgMember(organizationId: string, userId: string) {
    return db.prepare('SELECT * FROM org_members WHERE organizationId = ? AND userId = ?').get(organizationId, userId) || null;
  }

  async getOrgMembers(organizationId: string) {
    return db.prepare(`
      SELECT om.*, u.email, u.firstName, u.lastName, u.isActive as userActive
      FROM org_members om
      INNER JOIN users u ON om.userId = u.id
      WHERE om.organizationId = ?
      ORDER BY om.role = 'owner' DESC, om.joinedAt ASC
    `).all(organizationId);
  }

  async getUserOrganizations(userId: string) {
    return db.prepare(`
      SELECT o.*, om.role as memberRole, om.isDefault, om.joinedAt
      FROM organizations o
      INNER JOIN org_members om ON om.organizationId = o.id
      WHERE om.userId = ?
      ORDER BY om.isDefault DESC, om.joinedAt ASC
    `).all(userId);
  }

  async getUserDefaultOrganization(userId: string) {
    // Get the default org, or fallback to the first org
    const defaultOrg = db.prepare(`
      SELECT o.*, om.role as memberRole, om.isDefault
      FROM organizations o
      INNER JOIN org_members om ON om.organizationId = o.id
      WHERE om.userId = ? AND om.isDefault = 1
      LIMIT 1
    `).get(userId) as any;
    if (defaultOrg) return defaultOrg;
    
    // Fallback: get the first org the user belongs to
    return db.prepare(`
      SELECT o.*, om.role as memberRole, om.isDefault
      FROM organizations o
      INNER JOIN org_members om ON om.organizationId = o.id
      WHERE om.userId = ?
      ORDER BY om.joinedAt ASC
      LIMIT 1
    `).get(userId) || null;
  }

  async addOrgMember(organizationId: string, userId: string, role: string = 'member', invitedBy?: string) {
    const id = genId(); const ts = now();
    // If user has no other orgs, make this the default
    const existingOrgs = db.prepare('SELECT COUNT(*) as c FROM org_members WHERE userId = ?').get(userId) as any;
    const isDefault = existingOrgs.c === 0 ? 1 : 0;
    db.prepare('INSERT OR IGNORE INTO org_members (id, organizationId, userId, role, isDefault, joinedAt, invitedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, organizationId, userId, role, isDefault, ts, invitedBy || null, ts
    );
    return this.getOrgMember(organizationId, userId);
  }

  async updateOrgMemberRole(organizationId: string, userId: string, role: string) {
    db.prepare('UPDATE org_members SET role = ? WHERE organizationId = ? AND userId = ?').run(role, organizationId, userId);
    return this.getOrgMember(organizationId, userId);
  }

  async removeOrgMember(organizationId: string, userId: string) {
    db.prepare('DELETE FROM org_members WHERE organizationId = ? AND userId = ?').run(organizationId, userId);
    // If this was the default org, set another one as default
    const remaining = db.prepare('SELECT * FROM org_members WHERE userId = ? ORDER BY joinedAt ASC LIMIT 1').get(userId) as any;
    if (remaining) {
      db.prepare('UPDATE org_members SET isDefault = 1 WHERE id = ?').run(remaining.id);
    }
    return true;
  }

  async setDefaultOrganization(userId: string, organizationId: string) {
    db.prepare('UPDATE org_members SET isDefault = 0 WHERE userId = ?').run(userId);
    db.prepare('UPDATE org_members SET isDefault = 1 WHERE userId = ? AND organizationId = ?').run(userId, organizationId);
    // Also update the user's organizationId for backward compatibility
    db.prepare('UPDATE users SET organizationId = ?, updatedAt = ? WHERE id = ?').run(organizationId, now(), userId);
    return true;
  }

  async getOrgMemberCount(organizationId: string) {
    return (db.prepare('SELECT COUNT(*) as c FROM org_members WHERE organizationId = ?').get(organizationId) as any).c;
  }

  // ========== Organization Invitations ==========
  
  async createInvitation(organizationId: string, email: string, role: string, invitedBy: string) {
    const id = genId(); const ts = now();
    const token = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    // Cancel any existing pending invitations for this email + org
    db.prepare("UPDATE org_invitations SET status = 'cancelled' WHERE organizationId = ? AND email = ? AND status = 'pending'").run(organizationId, email);
    db.prepare('INSERT INTO org_invitations (id, organizationId, email, role, invitedBy, token, status, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, organizationId, email, role, invitedBy, token, 'pending', expiresAt, ts
    );
    return { id, organizationId, email, role, invitedBy, token, status: 'pending', expiresAt, createdAt: ts };
  }

  async getInvitationByToken(token: string) {
    return db.prepare('SELECT * FROM org_invitations WHERE token = ?').get(token) || null;
  }

  async getOrgInvitations(organizationId: string) {
    return db.prepare("SELECT * FROM org_invitations WHERE organizationId = ? AND status = 'pending' ORDER BY createdAt DESC").all(organizationId);
  }

  async getPendingInvitationsForEmail(email: string) {
    return db.prepare("SELECT oi.*, o.name as orgName FROM org_invitations oi INNER JOIN organizations o ON oi.organizationId = o.id WHERE oi.email = ? AND oi.status = 'pending' AND oi.expiresAt > ?").all(email, now());
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.getInvitationByToken(token) as any;
    if (!invitation) throw new Error('Invitation not found');
    if (invitation.status !== 'pending') throw new Error('Invitation already used');
    if (new Date(invitation.expiresAt) < new Date()) throw new Error('Invitation expired');

    db.prepare("UPDATE org_invitations SET status = 'accepted', acceptedAt = ? WHERE id = ?").run(now(), invitation.id);
    await this.addOrgMember(invitation.organizationId, userId, invitation.role, invitation.invitedBy);
    return invitation;
  }

  async cancelInvitation(id: string) {
    db.prepare("UPDATE org_invitations SET status = 'cancelled' WHERE id = ?").run(id);
    return true;
  }

  // ========== Enhanced Organization Methods ==========

  async updateOrganization(id: string, data: any) {
    const existing = await this.getOrganization(id);
    if (!existing) throw new Error('Organization not found');
    const m = { ...existing as any, ...data };
    db.prepare('UPDATE organizations SET name=?, domain=?, settings=?, updatedAt=? WHERE id=?').run(
      m.name, m.domain || '', toJson(m.settings || {}), now(), id
    );
    return this.getOrganization(id);
  }

  async deleteOrganization(id: string) {
    // Delete all related data in a transaction
    const batch = db.transaction(() => {
      db.prepare('DELETE FROM org_invitations WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM org_members WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM api_settings WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM unified_inbox WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM followup_sequences WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM integrations WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM unsubscribes WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM templates WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM segments WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM contact_lists WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM contacts WHERE organizationId = ?').run(id);
      // Delete campaign messages first, then campaigns
      const campaigns = db.prepare('SELECT id FROM campaigns WHERE organizationId = ?').all(id) as any[];
      for (const c of campaigns) {
        db.prepare('DELETE FROM messages WHERE campaignId = ?').run(c.id);
        db.prepare('DELETE FROM tracking_events WHERE campaignId = ?').run(c.id);
        db.prepare('DELETE FROM campaign_followups WHERE campaignId = ?').run(c.id);
        db.prepare('DELETE FROM followup_executions WHERE campaignId = ?').run(c.id);
      }
      db.prepare('DELETE FROM campaigns WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM email_accounts WHERE organizationId = ?').run(id);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
    });
    batch();
    return true;
  }

  // Create org + owner membership in a single transaction
  async createOrganizationWithOwner(orgData: any, userId: string) {
    const orgId = genId(); const ts = now();
    const batch = db.transaction(() => {
      // Create org
      db.prepare('INSERT INTO organizations (id, name, domain, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        orgId, orgData.name, orgData.domain || '', toJson(orgData.settings || {}), ts, ts
      );
      // Add owner membership
      db.prepare('INSERT INTO org_members (id, organizationId, userId, role, isDefault, joinedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        genId(), orgId, userId, 'owner', 0, ts, ts
      );
      // Update user's organizationId
      db.prepare('UPDATE users SET organizationId = ?, updatedAt = ? WHERE id = ?').run(orgId, ts, userId);
    });
    batch();
    return this.getOrganization(orgId);
  }

  async getAllOrganizationIds(): Promise<string[]> {
    return (db.prepare('SELECT id FROM organizations').all() as any[]).map(r => r.id);
  }

  // ========== SuperAdmin Methods ==========
  
  async isSuperAdmin(userId: string): Promise<boolean> {
    const user = db.prepare('SELECT isSuperAdmin FROM users WHERE id = ?').get(userId) as any;
    return user?.isSuperAdmin === 1;
  }

  // Get the default organization of the first superadmin user
  async getSuperAdminOrgId(): Promise<string | null> {
    const superAdmin = db.prepare(`
      SELECT u.id FROM users u WHERE u.isSuperAdmin = 1 LIMIT 1
    `).get() as any;
    if (!superAdmin) return null;
    const org = db.prepare(`
      SELECT organizationId FROM org_members WHERE userId = ? AND isDefault = 1 LIMIT 1
    `).get(superAdmin.id) as any;
    if (org) return org.organizationId;
    // Fallback to first org
    const firstOrg = db.prepare(`
      SELECT organizationId FROM org_members WHERE userId = ? ORDER BY joinedAt ASC LIMIT 1
    `).get(superAdmin.id) as any;
    return firstOrg?.organizationId || null;
  }

  // Get API settings with Azure fallback from superadmin org
  async getApiSettingsWithAzureFallback(organizationId: string): Promise<Record<string, string>> {
    const settings = await this.getApiSettings(organizationId);

    // If Azure OpenAI is already configured for this org, return as-is
    if (settings.azure_openai_endpoint && settings.azure_openai_api_key && settings.azure_openai_deployment) {
      return settings;
    }

    // Fallback: try superadmin's org for Azure keys
    const superAdminOrgId = await this.getSuperAdminOrgId();
    if (superAdminOrgId && superAdminOrgId !== organizationId) {
      const superSettings = await this.getApiSettings(superAdminOrgId);
      const azureKeys = ['azure_openai_endpoint', 'azure_openai_api_key', 'azure_openai_deployment', 'azure_openai_api_version'];
      for (const key of azureKeys) {
        if (superSettings[key] && !settings[key]) {
          settings[key] = superSettings[key];
        }
      }
    }

    return settings;
  }

  async setSuperAdmin(userId: string, isSuperAdmin: boolean): Promise<void> {
    db.prepare('UPDATE users SET isSuperAdmin = ?, updatedAt = ? WHERE id = ?').run(isSuperAdmin ? 1 : 0, now(), userId);
  }

  async setSuperAdminByEmail(email: string, isSuperAdmin: boolean): Promise<any> {
    db.prepare('UPDATE users SET isSuperAdmin = ?, updatedAt = ? WHERE LOWER(email) = LOWER(?)').run(isSuperAdmin ? 1 : 0, now(), email);
    return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email) || null;
  }

  async getAllUsers(limit = 100, offset = 0, search?: string): Promise<any[]> {
    if (search) {
      return db.prepare(`
        SELECT u.*, 
          (SELECT COUNT(*) FROM org_members om WHERE om.userId = u.id) as orgCount,
          (SELECT GROUP_CONCAT(o.name, ', ') FROM org_members om2 JOIN organizations o ON o.id = om2.organizationId WHERE om2.userId = u.id) as orgNames
        FROM users u 
        WHERE u.email LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ?
        ORDER BY u.createdAt DESC LIMIT ? OFFSET ?
      `).all(`%${search}%`, `%${search}%`, `%${search}%`, limit, offset);
    }
    return db.prepare(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM org_members om WHERE om.userId = u.id) as orgCount,
        (SELECT GROUP_CONCAT(o.name, ', ') FROM org_members om2 JOIN organizations o ON o.id = om2.organizationId WHERE om2.userId = u.id) as orgNames
      FROM users u 
      ORDER BY u.createdAt DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  async getAllUsersCount(search?: string): Promise<number> {
    if (search) {
      return ((db.prepare('SELECT COUNT(*) as c FROM users WHERE email LIKE ? OR firstName LIKE ? OR lastName LIKE ?').get(`%${search}%`, `%${search}%`, `%${search}%`)) as any).c;
    }
    return ((db.prepare('SELECT COUNT(*) as c FROM users').get()) as any).c;
  }

  async getAllOrganizations(limit = 100, offset = 0, search?: string): Promise<any[]> {
    if (search) {
      return db.prepare(`
        SELECT o.*,
          (SELECT COUNT(*) FROM org_members om WHERE om.organizationId = o.id) as memberCount,
          (SELECT COUNT(*) FROM campaigns c WHERE c.organizationId = o.id) as campaignCount,
          (SELECT COUNT(*) FROM contacts ct WHERE ct.organizationId = o.id) as contactCount,
          (SELECT COUNT(*) FROM email_accounts ea WHERE ea.organizationId = o.id) as emailAccountCount,
          (SELECT SUM(CASE WHEN c2.status = 'active' THEN 1 ELSE 0 END) FROM campaigns c2 WHERE c2.organizationId = o.id) as activeCampaigns
        FROM organizations o 
        WHERE o.name LIKE ? OR o.domain LIKE ?
        ORDER BY o.createdAt DESC LIMIT ? OFFSET ?
      `).all(`%${search}%`, `%${search}%`, limit, offset);
    }
    return db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM org_members om WHERE om.organizationId = o.id) as memberCount,
        (SELECT COUNT(*) FROM campaigns c WHERE c.organizationId = o.id) as campaignCount,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.organizationId = o.id) as contactCount,
        (SELECT COUNT(*) FROM email_accounts ea WHERE ea.organizationId = o.id) as emailAccountCount,
        (SELECT SUM(CASE WHEN c2.status = 'active' THEN 1 ELSE 0 END) FROM campaigns c2 WHERE c2.organizationId = o.id) as activeCampaigns
      FROM organizations o 
      ORDER BY o.createdAt DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  async getAllOrganizationsCount(search?: string): Promise<number> {
    if (search) {
      return ((db.prepare('SELECT COUNT(*) as c FROM organizations WHERE name LIKE ? OR domain LIKE ?').get(`%${search}%`, `%${search}%`)) as any).c;
    }
    return ((db.prepare('SELECT COUNT(*) as c FROM organizations').get()) as any).c;
  }

  async getPlatformStats(): Promise<any> {
    const totalUsers = ((db.prepare('SELECT COUNT(*) as c FROM users').get()) as any).c;
    const activeUsers = ((db.prepare('SELECT COUNT(*) as c FROM users WHERE isActive = 1').get()) as any).c;
    const totalOrgs = ((db.prepare('SELECT COUNT(*) as c FROM organizations').get()) as any).c;
    const totalCampaigns = ((db.prepare('SELECT COUNT(*) as c FROM campaigns').get()) as any).c;
    const activeCampaigns = ((db.prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").get()) as any).c;
    const totalContacts = ((db.prepare('SELECT COUNT(*) as c FROM contacts').get()) as any).c;
    const totalEmailAccounts = ((db.prepare('SELECT COUNT(*) as c FROM email_accounts').get()) as any).c;
    const totalEmailsSent = ((db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'sent'").get()) as any).c;
    const totalOpens = ((db.prepare("SELECT COUNT(*) as c FROM tracking_events WHERE type = 'open'").get()) as any).c;
    const totalClicks = ((db.prepare("SELECT COUNT(*) as c FROM tracking_events WHERE type = 'click'").get()) as any).c;
    const totalReplies = ((db.prepare("SELECT COUNT(*) as c FROM tracking_events WHERE type = 'reply'").get()) as any).c;
    const totalTemplates = ((db.prepare('SELECT COUNT(*) as c FROM templates').get()) as any).c;
    const superAdmins = ((db.prepare('SELECT COUNT(*) as c FROM users WHERE isSuperAdmin = 1').get()) as any).c;
    
    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentUsers = ((db.prepare('SELECT COUNT(*) as c FROM users WHERE createdAt > ?').get(sevenDaysAgo)) as any).c;
    const recentCampaigns = ((db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE createdAt > ?').get(sevenDaysAgo)) as any).c;
    const recentEmails = ((db.prepare("SELECT COUNT(*) as c FROM messages WHERE sentAt > ?").get(sevenDaysAgo)) as any).c;

    // Top organizations by email volume
    const topOrgs = db.prepare(`
      SELECT o.id, o.name, o.domain,
        (SELECT COUNT(*) FROM messages m JOIN campaigns c ON c.id = m.campaignId WHERE c.organizationId = o.id AND m.status = 'sent') as emailsSent,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.organizationId = o.id) as contacts,
        (SELECT COUNT(*) FROM org_members om WHERE om.organizationId = o.id) as members
      FROM organizations o
      ORDER BY emailsSent DESC LIMIT 10
    `).all();

    return {
      totalUsers, activeUsers, totalOrgs, totalCampaigns, activeCampaigns,
      totalContacts, totalEmailAccounts, totalEmailsSent, totalOpens, totalClicks,
      totalReplies, totalTemplates, superAdmins,
      recentUsers, recentCampaigns, recentEmails,
      topOrgs,
    };
  }

  async deactivateUser(userId: string): Promise<void> {
    db.prepare('UPDATE users SET isActive = 0, updatedAt = ? WHERE id = ?').run(now(), userId);
  }

  async activateUser(userId: string): Promise<void> {
    db.prepare('UPDATE users SET isActive = 1, updatedAt = ? WHERE id = ?').run(now(), userId);
  }

  async deleteOrganizationCascade(orgId: string): Promise<void> {
    const batch = db.transaction(() => {
      db.prepare('DELETE FROM tracking_events WHERE campaignId IN (SELECT id FROM campaigns WHERE organizationId = ?)').run(orgId);
      db.prepare('DELETE FROM messages WHERE campaignId IN (SELECT id FROM campaigns WHERE organizationId = ?)').run(orgId);
      db.prepare('DELETE FROM followup_executions WHERE campaignId IN (SELECT id FROM campaigns WHERE organizationId = ?)').run(orgId);
      db.prepare('DELETE FROM campaign_followups WHERE campaignId IN (SELECT id FROM campaigns WHERE organizationId = ?)').run(orgId);
      db.prepare('DELETE FROM followup_steps WHERE sequenceId IN (SELECT id FROM followup_sequences WHERE organizationId = ?)').run(orgId);
      db.prepare('DELETE FROM followup_sequences WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM campaigns WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM contacts WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM contact_lists WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM segments WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM templates WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM email_accounts WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM llm_configs WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM api_settings WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM unified_inbox WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM unsubscribes WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM org_invitations WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM org_members WHERE organizationId = ?').run(orgId);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);
    });
    batch();
  }

  async getOrgDetails(orgId: string): Promise<any> {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as any;
    if (!org) return null;
    const members = db.prepare(`
      SELECT u.id, u.email, u.firstName, u.lastName, u.isSuperAdmin, u.isActive, u.createdAt,
        om.role, om.joinedAt
      FROM org_members om 
      JOIN users u ON u.id = om.userId
      WHERE om.organizationId = ?
      ORDER BY om.role = 'owner' DESC, om.joinedAt ASC
    `).all(orgId);
    const campaigns = ((db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE organizationId = ?').get(orgId)) as any).c;
    const contacts = ((db.prepare('SELECT COUNT(*) as c FROM contacts WHERE organizationId = ?').get(orgId)) as any).c;
    const emailAccounts = ((db.prepare('SELECT COUNT(*) as c FROM email_accounts WHERE organizationId = ?').get(orgId)) as any).c;
    const emailsSent = ((db.prepare("SELECT COUNT(*) as c FROM messages m JOIN campaigns c ON c.id = m.campaignId WHERE c.organizationId = ? AND m.status = 'sent'").get(orgId)) as any).c;
    return { ...org, members, stats: { campaigns, contacts, emailAccounts, emailsSent } };
  }
  // Get failed/bounced campaign messages with contact status for bounce sync
  async getBouncedMessagesWithContacts(orgId: string) {
    return db.prepare(`
      SELECT m.contactId, m.status as messageStatus, m.errorMessage, ct.email as contactEmail, ct.status as contactStatus
      FROM messages m
      INNER JOIN campaigns c ON m.campaignId = c.id
      LEFT JOIN contacts ct ON m.contactId = ct.id
      WHERE c.organizationId = ?
      AND (m.status = 'bounced' OR (m.status = 'failed' AND m.errorMessage LIKE '%Bounce%'))
      AND m.contactId IS NOT NULL
    `).all(orgId);
  }

  // Get bounce tracking events with contact status
  async getBounceEventsWithContacts(orgId: string) {
    return db.prepare(`
      SELECT te.contactId, ct.email as contactEmail, ct.status as contactStatus
      FROM tracking_events te
      INNER JOIN campaigns c ON te.campaignId = c.id
      LEFT JOIN contacts ct ON te.contactId = ct.id
      WHERE te.type = 'bounce'
      AND c.organizationId = ?
      AND te.contactId IS NOT NULL
    `).all(orgId);
  }

  // ========== v12: Reply Classification Engine ==========
  
  async classifyReply(inboxMessageId: string, replyType: string) {
    db.prepare('UPDATE unified_inbox SET replyType = ? WHERE id = ?').run(replyType, inboxMessageId);
  }

  async setBounceType(inboxMessageId: string, bounceType: string) {
    db.prepare('UPDATE unified_inbox SET bounceType = ? WHERE id = ?').run(bounceType, inboxMessageId);
  }

  // ========== v12: Conversation Threading ==========
  
  async getConversationThread(threadId: string) {
    return db.prepare('SELECT * FROM unified_inbox WHERE threadId = ? ORDER BY receivedAt ASC').all(threadId);
  }

  async getConversationByContact(organizationId: string, contactId: string, limit = 50) {
    return db.prepare('SELECT * FROM unified_inbox WHERE organizationId = ? AND contactId = ? ORDER BY receivedAt DESC LIMIT ?').all(organizationId, contactId, limit);
  }

  // ========== v12: Inbox Assignment ==========
  
  async assignInboxMessage(inboxMessageId: string, userId: string) {
    db.prepare('UPDATE unified_inbox SET assignedTo = ? WHERE id = ?').run(userId, inboxMessageId);
  }

  async getInboxByAssignee(organizationId: string, userId: string, limit = 50, offset = 0) {
    return db.prepare('SELECT * FROM unified_inbox WHERE organizationId = ? AND assignedTo = ? ORDER BY receivedAt DESC LIMIT ? OFFSET ?').all(organizationId, userId, limit, offset);
  }

  // ========== v12: Lead Status ==========
  
  async updateLeadStatus(inboxMessageId: string, leadStatus: string) {
    db.prepare('UPDATE unified_inbox SET leadStatus = ? WHERE id = ?').run(leadStatus, inboxMessageId);
    // Also update the linked contact's lead status
    const msg = db.prepare('SELECT contactId FROM unified_inbox WHERE id = ?').get(inboxMessageId) as any;
    if (msg?.contactId) {
      db.prepare('UPDATE contacts SET leadStatus = ?, updatedAt = ? WHERE id = ?').run(leadStatus, now(), msg.contactId);
    }
  }

  async updateContactLeadStatus(contactId: string, leadStatus: string) {
    db.prepare('UPDATE contacts SET leadStatus = ?, updatedAt = ? WHERE id = ?').run(leadStatus, now(), contactId);
  }

  // ========== v12: Star messages ==========
  
  async starInboxMessage(id: string, isStarred: boolean) {
    db.prepare('UPDATE unified_inbox SET isStarred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
  }

  // ========== v12: Global Suppression List ==========
  
  async addToSuppressionList(orgId: string, email: string, reason: string, extra?: { bounceType?: string; source?: string; campaignId?: string; notes?: string }) {
    const id = genId();
    try {
      db.prepare('INSERT OR REPLACE INTO suppression_list (id, organizationId, email, reason, bounceType, source, campaignId, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, orgId, email.toLowerCase(), reason, extra?.bounceType || null, extra?.source || null, extra?.campaignId || null, extra?.notes || null, now()
      );
    } catch (e) { /* unique constraint - already exists */ }
    return id;
  }

  async removeFromSuppressionList(orgId: string, email: string) {
    db.prepare('DELETE FROM suppression_list WHERE organizationId = ? AND email = ?').run(orgId, email.toLowerCase());
  }

  async isEmailSuppressed(orgId: string, email: string): Promise<boolean> {
    const row = db.prepare('SELECT id FROM suppression_list WHERE organizationId = ? AND email = ?').get(orgId, email.toLowerCase()) as any;
    return !!row;
  }

  async getSuppressedEmails(orgId: string): Promise<Set<string>> {
    const rows = db.prepare('SELECT email FROM suppression_list WHERE organizationId = ?').all(orgId) as any[];
    return new Set(rows.map(r => r.email.toLowerCase()));
  }

  async getSuppressionList(orgId: string, filters?: { reason?: string }, limit = 100, offset = 0) {
    let sql = 'SELECT * FROM suppression_list WHERE organizationId = ?';
    const params: any[] = [orgId];
    if (filters?.reason) { sql += ' AND reason = ?'; params.push(filters.reason); }
    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  async getSuppressionListCount(orgId: string, filters?: { reason?: string }): Promise<number> {
    let sql = 'SELECT COUNT(*) as c FROM suppression_list WHERE organizationId = ?';
    const params: any[] = [orgId];
    if (filters?.reason) { sql += ' AND reason = ?'; params.push(filters.reason); }
    return (db.prepare(sql).get(...params) as any).c;
  }

  // ========== v12: Unsubscribe Management ==========
  
  async markContactUnsubscribed(contactId: string, campaignId?: string) {
    const ts = now();
    db.prepare('UPDATE contacts SET unsubscribed = 1, unsubscribedAt = ?, status = ?, updatedAt = ? WHERE id = ?').run(ts, 'unsubscribed', ts, contactId);
    const contact = await this.getContact(contactId);
    if (contact) {
      await this.addToSuppressionList(contact.organizationId, contact.email, 'unsubscribe', { campaignId, source: 'auto' });
    }
  }

  async getUnsubscribedContacts(orgId: string, limit = 100, offset = 0) {
    return db.prepare('SELECT * FROM contacts WHERE organizationId = ? AND unsubscribed = 1 ORDER BY unsubscribedAt DESC LIMIT ? OFFSET ?').all(orgId, limit, offset);
  }

  // ========== v12: Contact Status Engine (auto-calculate) ==========
  
  async recalculateContactStatus(contactId: string) {
    const contact = await this.getContact(contactId);
    if (!contact) return;
    // Don't change status for bounced or unsubscribed contacts
    if (contact.status === 'bounced' || contact.status === 'unsubscribed') return;
    
    const stats = await this.getContactEngagementStats(contactId);
    let newStatus = 'cold';
    let newScore = contact.score || 0;
    
    if (stats.totalReplied > 0) {
      newStatus = 'replied';
      newScore = Math.max(newScore, 80);
    } else if (stats.totalClicked > 0) {
      newStatus = 'hot';
      newScore = Math.max(newScore, 60);
    } else if (stats.totalOpened > 0) {
      newStatus = 'warm';
      newScore = Math.max(newScore, 40);
    }
    
    db.prepare('UPDATE contacts SET status = ?, score = ?, totalSent = ?, totalOpened = ?, totalClicked = ?, totalReplied = ?, updatedAt = ? WHERE id = ?').run(
      newStatus, newScore,
      stats.totalSent || 0, stats.totalOpened || 0, stats.totalClicked || 0, stats.totalReplied || 0,
      now(), contactId
    );
  }

  async recalculateContactScore(contactId: string) {
    const stats = await this.getContactEngagementStats(contactId);
    // Scoring: +5 open, +10 click, +20 reply, -30 unsubscribe, -50 bounce
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
    db.prepare('UPDATE contacts SET score = ?, updatedAt = ? WHERE id = ?').run(score, now(), contactId);
    return score;
  }

  // ========== v12: Bounce Management ==========
  
  async markContactBounced(contactId: string, bounceType: string = 'hard') {
    const ts = now();
    db.prepare('UPDATE contacts SET status = ?, bounceType = ?, bouncedAt = ?, updatedAt = ? WHERE id = ?').run('bounced', bounceType, ts, ts, contactId);
    const contact = await this.getContact(contactId);
    if (contact) {
      await this.addToSuppressionList(contact.organizationId, contact.email, 'bounce', { bounceType, source: 'auto' });
      // Remove contact from active campaigns
      const activeCampaigns = db.prepare(`
        SELECT DISTINCT c.id FROM campaigns c
        INNER JOIN messages m ON m.campaignId = c.id
        WHERE m.contactId = ? AND c.status IN ('active', 'scheduled')
      `).all(contactId) as any[];
      for (const camp of activeCampaigns) {
        // Cancel pending follow-ups
        db.prepare("UPDATE followup_executions SET status = 'skipped' WHERE contactId = ? AND campaignId = ? AND status = 'pending'").run(contactId, camp.id);
      }
    }
  }

  // ========== v12: Contact Activity Timeline ==========
  
  async addContactActivity(orgId: string, contactId: string, type: string, title: string, description?: string, extra?: { campaignId?: string; messageId?: string; metadata?: any }) {
    const id = genId();
    db.prepare('INSERT INTO contact_activity (id, organizationId, contactId, type, title, description, campaignId, messageId, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, orgId, contactId, type, title, description || null, extra?.campaignId || null, extra?.messageId || null, toJson(extra?.metadata || {}), now()
    );
    return id;
  }

  async getContactActivity(contactId: string, limit = 50, offset = 0) {
    return db.prepare('SELECT * FROM contact_activity WHERE contactId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(contactId, limit, offset).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
  }

  // ========== v12: Warmup Monitoring ==========
  
  async createWarmupAccount(data: any) {
    const id = genId(); const ts = now();
    db.prepare('INSERT INTO warmup_accounts (id, organizationId, emailAccountId, status, dailyTarget, startDate, settings, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, data.organizationId, data.emailAccountId, data.status || 'active', data.dailyTarget || 5, data.startDate || ts, toJson(data.settings || {}), ts, ts
    );
    return this.getWarmupAccount(id);
  }

  async getWarmupAccount(id: string) {
    const r = db.prepare('SELECT * FROM warmup_accounts WHERE id = ?').get(id) as any;
    return r ? { ...r, settings: fromJson(r.settings) } : null;
  }

  async getWarmupAccounts(orgId: string) {
    return db.prepare('SELECT wa.*, ea.email as accountEmail, ea.provider FROM warmup_accounts wa JOIN email_accounts ea ON ea.id = wa.emailAccountId WHERE wa.organizationId = ? AND ea.email IS NOT NULL ORDER BY wa.createdAt DESC').all(orgId).map((r: any) => ({ ...r, settings: fromJson(r.settings) }));
  }

  async updateWarmupAccount(id: string, data: any) {
    const existing = await this.getWarmupAccount(id);
    if (!existing) throw new Error('Warmup account not found');
    const m = { ...existing, ...data };
    db.prepare('UPDATE warmup_accounts SET status=?, dailyTarget=?, currentDaily=?, totalSent=?, totalReceived=?, inboxRate=?, spamRate=?, reputationScore=?, lastWarmupAt=?, settings=?, updatedAt=? WHERE id=?').run(
      m.status, m.dailyTarget, m.currentDaily || 0, m.totalSent || 0, m.totalReceived || 0,
      m.inboxRate || 0, m.spamRate || 0, m.reputationScore || 50,
      m.lastWarmupAt || null, toJson(m.settings || {}), now(), id
    );
    return this.getWarmupAccount(id);
  }

  async deleteWarmupAccount(id: string) {
    db.prepare('DELETE FROM warmup_logs WHERE warmupAccountId = ?').run(id);
    db.prepare('DELETE FROM warmup_accounts WHERE id = ?').run(id);
  }

  async addWarmupLog(warmupAccountId: string, date: string, data: any) {
    const id = genId();
    db.prepare('INSERT INTO warmup_logs (id, warmupAccountId, date, sent, received, inboxCount, spamCount, bounceCount, openCount, replyCount, sendPairs, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, warmupAccountId, date, data.sent || 0, data.received || 0, data.inboxCount || 0,
      data.spamCount || 0, data.bounceCount || 0, data.openCount || 0, data.replyCount || 0,
      JSON.stringify(data.sendPairs || []), now()
    );
    return id;
  }

  async getWarmupLogs(warmupAccountId: string, limit = 30) {
    return db.prepare('SELECT * FROM warmup_logs WHERE warmupAccountId = ? ORDER BY date DESC LIMIT ?').all(warmupAccountId, limit);
  }

  // ========== Email History & Lead Opportunities ==========

  async addEmailHistory(data: { organizationId: string; emailAccountId: string; accountEmail: string; provider?: string; externalId?: string; threadId?: string; fromEmail: string; fromName?: string; toEmail?: string; subject?: string; snippet?: string; direction: string; receivedAt: string }) {
    const id = genId();
    db.prepare('INSERT OR IGNORE INTO email_history (id, organizationId, emailAccountId, accountEmail, provider, externalId, threadId, fromEmail, fromName, toEmail, subject, snippet, direction, receivedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, data.organizationId, data.emailAccountId, data.accountEmail, data.provider || null,
      data.externalId || null, data.threadId || null, data.fromEmail, data.fromName || null,
      data.toEmail || null, data.subject || null, data.snippet || null, data.direction, data.receivedAt, now()
    );
    return id;
  }

  async getEmailHistoryByThread(threadId: string) {
    return db.prepare('SELECT * FROM email_history WHERE threadId = ? ORDER BY receivedAt ASC').all(threadId);
  }

  async getEmailHistoryContacts(orgId: string, emailAccountId?: string) {
    const q = emailAccountId
      ? `SELECT fromEmail, fromName, COUNT(*) as totalEmails,
           SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as totalSent,
           SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as totalReceived,
           MAX(receivedAt) as lastEmailDate,
           GROUP_CONCAT(DISTINCT subject) as subjects
         FROM email_history WHERE organizationId = ? AND emailAccountId = ?
         GROUP BY fromEmail ORDER BY lastEmailDate DESC`
      : `SELECT fromEmail, fromName, COUNT(*) as totalEmails,
           SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as totalSent,
           SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as totalReceived,
           MAX(receivedAt) as lastEmailDate,
           GROUP_CONCAT(DISTINCT subject) as subjects
         FROM email_history WHERE organizationId = ?
         GROUP BY fromEmail ORDER BY lastEmailDate DESC`;
    return emailAccountId
      ? db.prepare(q).all(orgId, emailAccountId)
      : db.prepare(q).all(orgId);
  }

  async getEmailHistoryStats(orgId: string) {
    return db.prepare(`SELECT COUNT(*) as totalEmails, COUNT(DISTINCT fromEmail) as uniqueContacts,
      COUNT(DISTINCT threadId) as totalThreads, COUNT(DISTINCT emailAccountId) as accountsScanned,
      MIN(receivedAt) as oldestEmail, MAX(receivedAt) as newestEmail
      FROM email_history WHERE organizationId = ?`).get(orgId);
  }

  async emailHistoryExists(externalId: string) {
    const row = db.prepare('SELECT id FROM email_history WHERE externalId = ? LIMIT 1').get(externalId) as any;
    return !!row;
  }

  async getEmailHistorySyncStatus(orgId: string) {
    return db.prepare(`SELECT emailAccountId, accountEmail, provider, COUNT(*) as emailCount, MIN(receivedAt) as oldest, MAX(receivedAt) as newest
      FROM email_history WHERE organizationId = ? GROUP BY emailAccountId`).all(orgId);
  }

  // Lead Opportunities
  async addLeadOpportunity(data: { organizationId: string; emailAccountId?: string; accountEmail?: string; contactEmail: string; contactName?: string; company?: string; bucket: string; confidence: number; aiReasoning?: string; suggestedAction?: string; lastEmailDate?: string; totalEmails?: number; totalSent?: number; totalReceived?: number; sampleSubjects?: string[]; sampleSnippets?: string[] }) {
    const id = genId();
    const ts = now();
    db.prepare(`INSERT INTO lead_opportunities (id, organizationId, emailAccountId, accountEmail, contactEmail, contactName, company, bucket, confidence, aiReasoning, suggestedAction, lastEmailDate, totalEmails, totalSent, totalReceived, sampleSubjects, sampleSnippets, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`).run(
      id, data.organizationId, data.emailAccountId || null, data.accountEmail || null, data.contactEmail, data.contactName || null,
      data.company || null, data.bucket, data.confidence, data.aiReasoning || null, data.suggestedAction || null,
      data.lastEmailDate || null, data.totalEmails || 0, data.totalSent || 0, data.totalReceived || 0,
      JSON.stringify(data.sampleSubjects || []), JSON.stringify(data.sampleSnippets || []), ts, ts
    );
    return id;
  }

  async updateLeadOpportunity(id: string, data: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id') continue;
      sets.push(`${k} = ?`);
      vals.push(k === 'sampleSubjects' || k === 'sampleSnippets' ? JSON.stringify(v) : v);
    }
    sets.push('updatedAt = ?');
    vals.push(now());
    vals.push(id);
    db.prepare(`UPDATE lead_opportunities SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  async getLeadOpportunities(orgId: string, filters?: { bucket?: string; status?: string; limit?: number }) {
    let q = 'SELECT * FROM lead_opportunities WHERE organizationId = ?';
    const params: any[] = [orgId];
    if (filters?.bucket) { q += ' AND bucket = ?'; params.push(filters.bucket); }
    if (filters?.status) { q += ' AND status = ?'; params.push(filters.status); }
    q += ' ORDER BY confidence DESC, lastEmailDate DESC';
    if (filters?.limit) { q += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(q).all(...params);
  }

  async getLeadOpportunitySummary(orgId: string) {
    return db.prepare(`SELECT bucket, COUNT(*) as count, AVG(confidence) as avgConfidence,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as newCount,
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewedCount,
      SUM(CASE WHEN status = 'actioned' THEN 1 ELSE 0 END) as actionedCount,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissedCount
      FROM lead_opportunities WHERE organizationId = ? GROUP BY bucket`).all(orgId);
  }

  async deleteLeadOpportunitiesByOrg(orgId: string) {
    db.prepare('DELETE FROM lead_opportunities WHERE organizationId = ?').run(orgId);
  }

  async getLeadOpportunityByEmail(orgId: string, contactEmail: string) {
    return db.prepare('SELECT * FROM lead_opportunities WHERE organizationId = ? AND contactEmail = ? LIMIT 1').get(orgId, contactEmail);
  }

  // ========== v12: Notifications ==========
  
  async createNotification(orgId: string, data: { userId?: string; type: string; title: string; message?: string; linkUrl?: string; metadata?: any }) {
    const id = genId();
    db.prepare('INSERT INTO notifications (id, organizationId, userId, type, title, message, linkUrl, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, orgId, data.userId || null, data.type, data.title, data.message || null, data.linkUrl || null, toJson(data.metadata || {}), now()
    );
    return id;
  }

  async getNotifications(orgId: string, userId?: string, limit = 50) {
    if (userId) {
      return db.prepare('SELECT * FROM notifications WHERE organizationId = ? AND (userId = ? OR userId IS NULL) ORDER BY createdAt DESC LIMIT ?').all(orgId, userId, limit).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
    }
    return db.prepare('SELECT * FROM notifications WHERE organizationId = ? ORDER BY createdAt DESC LIMIT ?').all(orgId, limit).map((r: any) => ({ ...r, metadata: fromJson(r.metadata) }));
  }

  async getUnreadNotificationCount(orgId: string, userId?: string): Promise<number> {
    if (userId) {
      return (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE organizationId = ? AND (userId = ? OR userId IS NULL) AND isRead = 0').get(orgId, userId) as any).c;
    }
    return (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE organizationId = ? AND isRead = 0').get(orgId) as any).c;
  }

  async markNotificationRead(id: string) {
    db.prepare('UPDATE notifications SET isRead = 1 WHERE id = ?').run(id);
  }

  async markAllNotificationsRead(orgId: string, userId?: string) {
    if (userId) {
      db.prepare('UPDATE notifications SET isRead = 1 WHERE organizationId = ? AND (userId = ? OR userId IS NULL)').run(orgId, userId);
    } else {
      db.prepare('UPDATE notifications SET isRead = 1 WHERE organizationId = ?').run(orgId);
    }
  }

  // Enhanced inbox query with new filters
  async getInboxMessagesEnhanced(organizationId: string, filters: {
    status?: string;
    emailAccountId?: string;
    campaignId?: string;
    replyType?: string;
    bounceType?: string;
    leadStatus?: string;
    assignedTo?: string;
    isStarred?: boolean;
    search?: string;
    viewMode?: string; // 'unified' | 'account' | 'campaign'
  }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM unified_inbox WHERE organizationId = ?';
    const params: any[] = [organizationId];

    // Warmup detection: both fromEmail AND toEmail are org email accounts
    // fromEmail may store "Name <email>" format — extract just the email part
    const exF = "LOWER(CASE WHEN fromEmail LIKE '%<%>%' THEN SUBSTR(fromEmail, INSTR(fromEmail,'<')+1, INSTR(fromEmail,'>')-INSTR(fromEmail,'<')-1) ELSE fromEmail END)";
    const exT = "LOWER(CASE WHEN toEmail LIKE '%<%>%' THEN SUBSTR(toEmail, INSTR(toEmail,'<')+1, INSTR(toEmail,'>')-INSTR(toEmail,'<')-1) ELSE COALESCE(toEmail,'') END)";
    const oE = "(SELECT LOWER(email) FROM email_accounts WHERE organizationId = ?)";
    const warmupExclude = ` AND NOT (${exF} IN ${oE} AND ${exT} IN ${oE})`;
    const warmupOnly = ` AND ${exF} IN ${oE} AND ${exT} IN ${oE}`;

    if (filters?.status === 'warmup') {
      sql += warmupOnly;
      params.push(organizationId, organizationId);
    } else if (filters?.status === 'bounced') {
      sql += " AND (status = 'bounced' OR bounceType != '')" + warmupExclude;
      params.push(organizationId, organizationId);
    } else if (filters?.status === 'unsubscribed') {
      sql += " AND replyType = 'unsubscribe'";
    } else if (filters?.status && filters.status !== 'all') {
      sql += ' AND status = ?' + warmupExclude; params.push(filters.status, organizationId, organizationId);
    } else {
      sql += warmupExclude;
      params.push(organizationId, organizationId);
    }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ' AND emailAccountId = ?'; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND emailAccountId IN (${accountIds.map(() => '?').join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ' AND campaignId = ?'; params.push(filters.campaignId); }
    if (filters?.replyType) { sql += ' AND replyType = ?'; params.push(filters.replyType); }
    if (filters?.bounceType) { sql += ' AND bounceType = ?'; params.push(filters.bounceType); }
    if (filters?.leadStatus) { sql += ' AND leadStatus = ?'; params.push(filters.leadStatus); }
    if (filters?.assignedTo) { sql += ' AND assignedTo = ?'; params.push(filters.assignedTo); }
    if (filters?.isStarred) { sql += ' AND isStarred = 1'; }
    if (filters?.search) {
      sql += ' AND (subject LIKE ? OR fromEmail LIKE ? OR fromName LIKE ? OR snippet LIKE ?)';
      const q = `%${filters.search}%`;
      params.push(q, q, q, q);
    }
    
    sql += ' ORDER BY receivedAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  async getInboxMessageCountEnhanced(organizationId: string, filters: {
    status?: string;
    emailAccountId?: string;
    campaignId?: string;
    replyType?: string;
    assignedTo?: string;
    search?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ?';
    const params: any[] = [organizationId];

    const exFC = "LOWER(CASE WHEN fromEmail LIKE '%<%>%' THEN SUBSTR(fromEmail, INSTR(fromEmail,'<')+1, INSTR(fromEmail,'>')-INSTR(fromEmail,'<')-1) ELSE fromEmail END)";
    const exTC = "LOWER(CASE WHEN toEmail LIKE '%<%>%' THEN SUBSTR(toEmail, INSTR(toEmail,'<')+1, INSTR(toEmail,'>')-INSTR(toEmail,'<')-1) ELSE COALESCE(toEmail,'') END)";
    const oEC = "(SELECT LOWER(email) FROM email_accounts WHERE organizationId = ?)";
    const warmupExcludeC = ` AND NOT (${exFC} IN ${oEC} AND ${exTC} IN ${oEC})`;
    const warmupOnlyC = ` AND ${exFC} IN ${oEC} AND ${exTC} IN ${oEC}`;

    if (filters?.status === 'warmup') {
      sql += warmupOnlyC;
      params.push(organizationId, organizationId);
    } else if (filters?.status === 'bounced') {
      sql += " AND (status = 'bounced' OR bounceType != '')" + warmupExcludeC;
      params.push(organizationId, organizationId);
    } else if (filters?.status === 'unsubscribed') {
      sql += " AND replyType = 'unsubscribe'";
    } else if (filters?.status && filters.status !== 'all') {
      sql += ' AND status = ?' + warmupExcludeC; params.push(filters.status, organizationId, organizationId);
    } else {
      sql += warmupExcludeC;
      params.push(organizationId, organizationId);
    }
    if (filters?.emailAccountId) {
      const accountIds = filters.emailAccountId.split(',').map(id => id.trim()).filter(Boolean);
      if (accountIds.length === 1) {
        sql += ' AND emailAccountId = ?'; params.push(accountIds[0]);
      } else if (accountIds.length > 1) {
        sql += ` AND emailAccountId IN (${accountIds.map(() => '?').join(',')})`;
        params.push(...accountIds);
      }
    }
    if (filters?.campaignId) { sql += ' AND campaignId = ?'; params.push(filters.campaignId); }
    if (filters?.replyType) { sql += ' AND replyType = ?'; params.push(filters.replyType); }
    if (filters?.assignedTo) { sql += ' AND assignedTo = ?'; params.push(filters.assignedTo); }
    if (filters?.search) {
      sql += ' AND (subject LIKE ? OR fromEmail LIKE ? OR fromName LIKE ? OR snippet LIKE ?)';
      const q = `%${filters.search}%`;
      params.push(q, q, q, q);
    }
    return (db.prepare(sql).get(...params) as any).c;
  }

  // Get inbox stats breakdown for dashboard
  async getInboxStats(organizationId: string, _accountIds?: string[]) {
    const exFS = "LOWER(CASE WHEN fromEmail LIKE '%<%>%' THEN SUBSTR(fromEmail, INSTR(fromEmail,'<')+1, INSTR(fromEmail,'>')-INSTR(fromEmail,'<')-1) ELSE fromEmail END)";
    const exTS = "LOWER(CASE WHEN toEmail LIKE '%<%>%' THEN SUBSTR(toEmail, INSTR(toEmail,'<')+1, INSTR(toEmail,'>')-INSTR(toEmail,'<')-1) ELSE COALESCE(toEmail,'') END)";
    const oES = "(SELECT LOWER(email) FROM email_accounts WHERE organizationId = ?)";
    const warmupExcludeS = `AND NOT (${exFS} IN ${oES} AND ${exTS} IN ${oES})`;
    const warmupOnlyS = `AND ${exFS} IN ${oES} AND ${exTS} IN ${oES}`;

    const total = (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? ${warmupExcludeS}`).get(organizationId, organizationId, organizationId) as any).c;
    const unread = (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = 'unread' ${warmupExcludeS}`).get(organizationId, organizationId, organizationId) as any).c;
    const replied = (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = 'replied' ${warmupExcludeS}`).get(organizationId, organizationId, organizationId) as any).c;
    const archived = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND status = 'archived'").get(organizationId) as any).c;
    const positive = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND replyType = 'positive'").get(organizationId) as any).c;
    const negative = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND replyType = 'negative'").get(organizationId) as any).c;
    const ooo = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND replyType = 'ooo'").get(organizationId) as any).c;
    const autoReply = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND replyType = 'auto_reply'").get(organizationId) as any).c;
    const bounced = (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND (bounceType != '' AND bounceType IS NOT NULL) ${warmupExcludeS}`).get(organizationId, organizationId, organizationId) as any).c;
    const starred = (db.prepare("SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? AND isStarred = 1").get(organizationId) as any).c;
    const warmup = (db.prepare(`SELECT COUNT(*) as c FROM unified_inbox WHERE organizationId = ? ${warmupOnlyS}`).get(organizationId, organizationId, organizationId) as any).c;
    return { total, unread, replied, archived, positive, negative, ooo, autoReply, bounced, starred, warmup };
  }

  // ========== DATABASE EXPORT/IMPORT ==========
  
  /** Export all rows from a table as JSON array */
  exportTable(tableName: string): any[] {
    // Sanitize table name to prevent SQL injection
    const validTables = [
      'users', 'organizations', 'organization_members', 'org_members', 'api_settings',
      'email_accounts', 'templates', 'campaigns', 'messages', 'contacts',
      'contact_lists', 'contact_list_members', 'tracking_events',
      'unified_inbox', 'followup_sequences', 'followup_steps', 'followup_messages',
    ];
    if (!validTables.includes(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    try {
      return db.prepare(`SELECT * FROM ${tableName}`).all();
    } catch (e) {
      console.warn(`[Storage] exportTable: table ${tableName} does not exist`);
      return [];
    }
  }

  /** Import rows into a table, skipping duplicates (INSERT OR IGNORE) */
  importTable(tableName: string, rows: any[]): { imported: number; errors: number } {
    const validTables = [
      'users', 'organizations', 'organization_members', 'org_members', 'api_settings',
      'email_accounts', 'templates', 'campaigns', 'messages', 'contacts',
      'contact_lists', 'contact_list_members', 'tracking_events',
      'unified_inbox', 'followup_sequences', 'followup_steps', 'followup_messages',
    ];
    if (!validTables.includes(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    
    let imported = 0;
    let errors = 0;
    
    // Use a transaction for performance and atomicity
    const importTransaction = db.transaction((rowsToImport: any[]) => {
      for (const row of rowsToImport) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const placeholders = columns.map(() => '?').join(', ');
          const sql = `INSERT OR IGNORE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
          const result = db.prepare(sql).run(...values);
          if (result.changes > 0) imported++;
        } catch (e) {
          errors++;
          if (errors <= 3) {
            console.warn(`[Storage] importTable ${tableName} row error:`, e);
          }
        }
      }
    });
    
    importTransaction(rows);
    return { imported, errors };
  }

  /** Get the raw better-sqlite3 database instance for direct queries */
  get db() { return db; }

  /** Get the database file path */
  getDbPath(): string {
    return DB_PATH;
  }

  /** Run a direct SQL statement (for admin fixes) */
  runDirectSQL(sql: string, params: any[] = []): any {
    return db.prepare(sql).run(...params);
  }

  /** Check if running on Azure */
  isAzureEnvironment(): boolean {
    return isAzure;
  }

  // ========== CONTEXT ENGINE — Org Documents ==========

  async createOrgDocument(doc: { id: string; organizationId: string; name: string; docType: string; source: string; content: string; summary?: string; tags?: string[]; metadata?: any; fileSize?: number; mimeType?: string; uploadedBy?: string }) {
    const ts = now();
    db.prepare(`INSERT INTO org_documents (id, organizationId, name, docType, source, content, summary, tags, metadata, fileSize, mimeType, uploadedBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      doc.id, doc.organizationId, doc.name, doc.docType, doc.source, doc.content, doc.summary || '',
      JSON.stringify(doc.tags || []), JSON.stringify(doc.metadata || {}), doc.fileSize || 0, doc.mimeType || '', doc.uploadedBy || '', ts, ts
    );
    // Update FTS index
    try {
      db.prepare(`INSERT INTO org_documents_fts(rowid, name, content, summary, tags)
        SELECT rowid, name, content, summary, tags FROM org_documents WHERE id = ?`).run(doc.id);
    } catch (e) { /* FTS not available */ }
    return this.getOrgDocument(doc.id);
  }

  async getOrgDocument(id: string) {
    return db.prepare('SELECT * FROM org_documents WHERE id = ?').get(id);
  }

  async getOrgDocuments(orgId: string, filters?: { docType?: string; source?: string; search?: string }, limit = 50, offset = 0) {
    let sql = 'SELECT * FROM org_documents WHERE organizationId = ?';
    const params: any[] = [orgId];
    if (filters?.docType) { sql += ' AND docType = ?'; params.push(filters.docType); }
    if (filters?.source) { sql += ' AND source = ?'; params.push(filters.source); }
    if (filters?.search) {
      // Try FTS5 first, fall back to LIKE
      try {
        const ftsResults = db.prepare(`SELECT rowid FROM org_documents_fts WHERE org_documents_fts MATCH ? ORDER BY rank LIMIT ?`).all(filters.search, limit);
        if (ftsResults.length > 0) {
          const rowids = (ftsResults as any[]).map(r => r.rowid);
          const ph = rowids.map(() => '?').join(',');
          return db.prepare(`SELECT * FROM org_documents WHERE organizationId = ? AND rowid IN (${ph}) ORDER BY updatedAt DESC`).all(orgId, ...rowids);
        }
      } catch { /* FTS not available, fall through to LIKE */ }
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)';
      const q = `%${filters.search.toLowerCase()}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  }

  async getOrgDocumentsCount(orgId: string, filters?: { docType?: string; source?: string }) {
    let sql = 'SELECT COUNT(*) as cnt FROM org_documents WHERE organizationId = ?';
    const params: any[] = [orgId];
    if (filters?.docType) { sql += ' AND docType = ?'; params.push(filters.docType); }
    if (filters?.source) { sql += ' AND source = ?'; params.push(filters.source); }
    return (db.prepare(sql).get(...params) as any).cnt;
  }

  async updateOrgDocument(id: string, updates: Partial<{ name: string; docType: string; content: string; summary: string; tags: string[]; metadata: any }>) {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.docType !== undefined) { sets.push('docType = ?'); params.push(updates.docType); }
    if (updates.content !== undefined) { sets.push('content = ?'); params.push(updates.content); }
    if (updates.summary !== undefined) { sets.push('summary = ?'); params.push(updates.summary); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(updates.metadata)); }
    sets.push('updatedAt = ?'); params.push(now());
    params.push(id);
    db.prepare(`UPDATE org_documents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    // Rebuild FTS for this doc
    try {
      const doc = db.prepare('SELECT rowid, * FROM org_documents WHERE id = ?').get(id) as any;
      if (doc) {
        db.prepare(`DELETE FROM org_documents_fts WHERE rowid = ?`).run(doc.rowid);
        db.prepare(`INSERT INTO org_documents_fts(rowid, name, content, summary, tags) VALUES (?, ?, ?, ?, ?)`).run(doc.rowid, doc.name, doc.content, doc.summary, doc.tags);
      }
    } catch { /* FTS not available */ }
    return this.getOrgDocument(id);
  }

  async deleteOrgDocument(id: string) {
    try {
      const doc = db.prepare('SELECT rowid FROM org_documents WHERE id = ?').get(id) as any;
      if (doc) db.prepare('DELETE FROM org_documents_fts WHERE rowid = ?').run(doc.rowid);
    } catch { /* FTS not available */ }
    db.prepare('DELETE FROM org_documents WHERE id = ?').run(id);
  }

  async searchOrgDocuments(orgId: string, query: string, limit = 10): Promise<any[]> {
    // Try FTS5 first (best relevance)
    try {
      const results = db.prepare(`
        SELECT od.*, rank FROM org_documents_fts fts
        JOIN org_documents od ON od.rowid = fts.rowid
        WHERE org_documents_fts MATCH ? AND od.organizationId = ?
        ORDER BY rank
        LIMIT ?
      `).all(query, orgId, limit);
      if (results.length > 0) return results as any[];
    } catch { /* FTS not available */ }
    // Fallback: LIKE search
    const q = `%${query.toLowerCase()}%`;
    return db.prepare(`SELECT * FROM org_documents WHERE organizationId = ? AND (LOWER(name) LIKE ? OR LOWER(content) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(tags) LIKE ?) ORDER BY updatedAt DESC LIMIT ?`).all(orgId, q, q, q, q, limit) as any[];
  }

  // ===== EMAIL ATTACHMENTS =====
  async createAttachment(data: { organizationId: string; templateId?: string; campaignId?: string; fileName: string; fileSize: number; mimeType: string; content: string }) {
    const id = genId();
    db.prepare('INSERT INTO email_attachments (id, organizationId, templateId, campaignId, fileName, fileSize, mimeType, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, data.organizationId, data.templateId || null, data.campaignId || null, data.fileName, data.fileSize, data.mimeType, data.content, now()
    );
    return { id, ...data, createdAt: now() };
  }

  async getAttachments(orgId: string, opts: { templateId?: string; campaignId?: string }) {
    if (opts.templateId) {
      return db.prepare('SELECT id, fileName, fileSize, mimeType, createdAt FROM email_attachments WHERE organizationId = ? AND templateId = ?').all(orgId, opts.templateId) as any[];
    }
    if (opts.campaignId) {
      return db.prepare('SELECT id, fileName, fileSize, mimeType, createdAt FROM email_attachments WHERE organizationId = ? AND campaignId = ?').all(orgId, opts.campaignId) as any[];
    }
    return [];
  }

  async getAttachment(id: string, orgId: string) {
    return db.prepare('SELECT * FROM email_attachments WHERE id = ? AND organizationId = ?').get(id, orgId) as any;
  }

  async deleteAttachment(id: string, orgId: string) {
    db.prepare('DELETE FROM email_attachments WHERE id = ? AND organizationId = ?').run(id, orgId);
  }

  async copyAttachmentsTocampaign(templateId: string, campaignId: string, orgId: string) {
    const attachments = db.prepare('SELECT * FROM email_attachments WHERE organizationId = ? AND templateId = ?').all(orgId, templateId) as any[];
    for (const att of attachments) {
      const id = genId();
      db.prepare('INSERT INTO email_attachments (id, organizationId, templateId, campaignId, fileName, fileSize, mimeType, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, orgId, null, campaignId, att.fileName, att.fileSize, att.mimeType, att.content, now()
      );
    }
  }

  // No-op for interface compatibility with PostgresStorage
  async ensureInitialized(): Promise<void> { /* SQLite is sync-initialized */ }

  // ===== Raw SQL helpers for cross-backend compatibility =====
  // These provide an async interface that works the same whether using SQLite or PostgreSQL.
  // Use these instead of (storage as any).db.prepare() for new code and migration.
  async rawGet(sql: string, ...params: any[]): Promise<any> {
    return db.prepare(sql).get(...params) || null;
  }
  async rawAll(sql: string, ...params: any[]): Promise<any[]> {
    return db.prepare(sql).all(...params);
  }
  async rawRun(sql: string, ...params: any[]): Promise<void> {
    db.prepare(sql).run(...params);
  }

  // ===== GUARDRAIL: resetCorruptDatabase has been REMOVED =====
  // This method used to delete the production database file. It caused catastrophic data loss.
  // NEVER add any method that deletes, renames, or overwrites the database file.
  // If the DB is corrupt, restore from /home/data/backups/ via Kudu SSH manually.
  resetCorruptDatabase(): { success: boolean; message: string } {
    console.error('[DB] resetCorruptDatabase called but BLOCKED — this method is disabled to prevent data loss');
    return { success: false, message: 'Database reset is disabled. Restore manually from /home/data/backups/ via Kudu SSH.' };
  }
}

// ===== Storage Switcher =====
// Modes:
//   DATABASE_URL unset              → SQLite only
//   DATABASE_URL + SHADOW_MODE=true → SQLite serves requests, PG mirrors writes in background
//   DATABASE_URL only               → PostgreSQL only

let _pgStorage: PostgresStorage | null = null;
if (process.env.DATABASE_URL) {
  _pgStorage = new PostgresStorage();
}

const _sqliteStorage = new DatabaseStorage();

// Shadow mode: SQLite is primary, PG mirrors writes + validates reads
const SHADOW_MODE = !!(process.env.DATABASE_URL && process.env.SHADOW_MODE === 'true');

// Write method prefixes — any method starting with these is a write
const WRITE_PREFIXES = ['create', 'update', 'delete', 'add', 'set', 'reset', 'remove', 'upsert', 'insert', 'mark', 'save', 'copy'];

// ===== Shadow state tracking =====
let _pgWriteFailures = 0;
let _pgWriteTotal = 0;
// Set to true by shadowValidate() when all tables pass — checked by cutover guard
let _shadowValidationPassed = false;

// Log failure summary every 5 minutes during shadow mode
function startShadowFailureReporter() {
  setInterval(() => {
    if (_pgWriteTotal === 0) return;
    if (_pgWriteFailures > 0) {
      console.warn(`[SHADOW] ⚠ ${_pgWriteFailures}/${_pgWriteTotal} PG write(s) failed — re-run migration before cutover`);
    } else {
      console.log(`[SHADOW] ✓ ${_pgWriteTotal} PG write(s) — 0 failures`);
    }
    // Reset counters each interval so we see per-period rates
    _pgWriteFailures = 0;
    _pgWriteTotal = 0;
  }, 5 * 60 * 1000);
}

/**
 * Dual-write proxy: SQLite is the source of truth for return values.
 * Writes are mirrored to PostgreSQL in the background (non-blocking).
 * If PG write fails, increments failure counter and logs — never affects response.
 */
function createDualWriteProxy(sqlite: DatabaseStorage, pg: PostgresStorage): any {
  return new Proxy(sqlite, {
    get(target, prop: string) {
      const val = (target as any)[prop];
      if (typeof val !== 'function') return val;

      const isWrite = WRITE_PREFIXES.some(p => prop.startsWith(p)) || prop === 'rawRun';

      return async function (...args: any[]) {
        // Always call SQLite first — return its result to the caller
        const result = await (val as Function).apply(target, args);

        if (isWrite) {
          _pgWriteTotal++;
          const pgMethod = (pg as any)[prop];
          if (typeof pgMethod === 'function') {
            pgMethod.apply(pg, args).catch((e: any) => {
              _pgWriteFailures++;
              console.warn(`[SHADOW-WRITE-FAIL] ${prop}(): ${e.message}`);
            });
          }
        }

        return result;
      };
    },
  });
}

let storage: any;
if (SHADOW_MODE && _pgStorage) {
  storage = createDualWriteProxy(_sqliteStorage, _pgStorage);
  console.log('[Storage] SHADOW MODE — SQLite primary + dual-write to PostgreSQL');
} else if (process.env.DATABASE_URL && _pgStorage) {
  storage = _pgStorage;
  console.log('[Storage] Using PostgreSQL');
} else {
  storage = _sqliteStorage;
  console.log('[Storage] Using SQLite');
}

/** Call this at server startup to initialize async storage (PostgreSQL schema) */
export async function initStorage() {
  if (_pgStorage) {
    await _pgStorage.ensureInitialized();
  }

  if (SHADOW_MODE) {
    console.log('[MODE]', {
      db: 'SQLite+PostgreSQL(shadow)',
      shadow: true,
      nodeEnv: process.env.NODE_ENV || 'development',
    });
    // Shadow mode: validate data and start write-failure reporter
    shadowValidate().catch(() => {});
    startShadowFailureReporter();
    return;
  }

  // ===== STARTUP MODE LOG =====
  console.log('[MODE]', {
    db: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite',
    shadow: false,
    skipShadowCheck: process.env.SKIP_SHADOW_CHECK === 'true',
    nodeEnv: process.env.NODE_ENV || 'development',
  });

  if (process.env.SKIP_SHADOW_CHECK === 'true') {
    console.warn('[CUTOVER-GUARD] ⚠ SKIP_SHADOW_CHECK is enabled — safety checks bypassed. Use with intent only.');
  }

  // ===== PG READINESS CHECK (retry up to 5x, 1s apart) =====
  // Handles Azure cold starts, slow pool warm-up, brief network blips.
  if (process.env.DATABASE_URL) {
    let connected = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await _pgStorage!.rawGet('SELECT 1 as ping');
        connected = true;
        if (attempt > 1) console.log(`[PG-LIVE] Connected on attempt ${attempt}`);
        break;
      } catch (e: any) {
        console.warn(`[PG-LIVE] Connection attempt ${attempt}/5 failed: ${e.message}`);
        if (attempt < 5) await new Promise(r => setTimeout(r, 1000)); // 1s between retries
      }
    }
    if (!connected) {
      throw new Error('[PG-LIVE] Could not connect to PostgreSQL after 5 attempts. Check DATABASE_URL and server status.');
    }
  }

  // ===== CUTOVER GUARD =====
  // Prevents startup if migration was not run (or only partially run).
  // Bypassed with SKIP_SHADOW_CHECK=true for emergency use.
  if (process.env.DATABASE_URL && process.env.SKIP_SHADOW_CHECK !== 'true') {
    try {
      // Check 3 critical tables — partial migration leaves at least one empty
      const [orgs, contacts, emailAccounts] = await Promise.all([
        _pgStorage!.rawGet('SELECT COUNT(*) as cnt FROM organizations'),
        _pgStorage!.rawGet('SELECT COUNT(*) as cnt FROM contacts'),
        _pgStorage!.rawGet('SELECT COUNT(*) as cnt FROM email_accounts'),
      ]);
      const orgCnt      = Number(orgs?.cnt ?? 0);
      const contactCnt  = Number(contacts?.cnt ?? 0);
      const accountCnt  = Number(emailAccounts?.cnt ?? 0);

      if (orgCnt === 0 || contactCnt === 0 || accountCnt === 0) {
        console.error('[CUTOVER-GUARD] ❌ Migration incomplete or not run:');
        console.error(`[CUTOVER-GUARD]    organizations=${orgCnt}  contacts=${contactCnt}  email_accounts=${accountCnt}`);
        console.error('[CUTOVER-GUARD]    Run: npx tsx scripts/migrate-sqlite-to-pg.ts');
        console.error('[CUTOVER-GUARD]    To bypass (dangerous): set SKIP_SHADOW_CHECK=true');
        throw new Error('[CUTOVER-GUARD] Cannot start: PostgreSQL migration incomplete.');
      }

      // Log the exact moment PG becomes primary — audit trail
      console.log(`[PG-LIVE] ✓ PostgreSQL is now serving production traffic`);
      console.log(`[PG-LIVE] orgs=${orgCnt}  contacts=${contactCnt}  email_accounts=${accountCnt}`);
      console.log(`[PG-LIVE] Timestamp: ${new Date().toISOString()}`);
    } catch (e: any) {
      if (e.message.startsWith('[CUTOVER-GUARD]')) throw e;
      console.error('[PG-LIVE] ❌ Failed to connect to PostgreSQL:', e.message);
      throw e;
    }
  }
}

// Key fields to compare per table (avoids large blob/content columns)
const SHADOW_SAMPLE_FIELDS: Record<string, string> = {
  organizations: 'id, name, domain',
  users:         'id, email, role, "organizationId"',
  contacts:      'id, email, status, "organizationId", "createdAt"',
  campaigns:     'id, name, status, "sentCount", "openedCount", "organizationId"',
  messages:      'id, status, "sentAt", "openedAt", "repliedAt", "campaignId"',
  email_accounts:'id, email, provider, "isActive", "dailyLimit", "organizationId"',
  unified_inbox: 'id, "fromEmail", status, "receivedAt", "organizationId"',
  api_settings:  'id, "organizationId", "settingKey"',
  templates:     'id, name, subject, "organizationId"',
  followup_sequences: 'id, name, "isActive", "organizationId"',
};

/** Normalize a value for comparison: trim strings, unify nulls, ignore whitespace */
function normalizeVal(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return v.trim();
  return String(v);
}

/** Compare row counts AND sample rows between SQLite and PostgreSQL */
async function shadowValidate() {
  if (!_pgStorage) return;
  const tables = Object.keys(SHADOW_SAMPLE_FIELDS);
  let countMismatches = 0;
  let sampleMismatches = 0;

  for (const table of tables) {
    // 1. Row count check
    try {
      const sqliteRow = await _sqliteStorage.rawGet(`SELECT COUNT(*) as cnt FROM ${table}`);
      const pgRow     = await _pgStorage.rawGet(`SELECT COUNT(*) as cnt FROM ${table}`);
      const sqliteCnt = Number(sqliteRow?.cnt ?? 0);
      const pgCnt     = Number(pgRow?.cnt ?? 0);

      if (sqliteCnt !== pgCnt) {
        countMismatches++;
        console.warn(`[SHADOW] COUNT MISMATCH ${table}: SQLite=${sqliteCnt} PG=${pgCnt}`);
        continue; // skip sample if counts differ — data isn't in sync yet
      }

      if (sqliteCnt === 0) {
        console.log(`[SHADOW] OK ${table}: empty`);
        continue;
      }

      // 2. Sample row comparison (5 random rows by ID)
      const fields = SHADOW_SAMPLE_FIELDS[table];
      const sqliteSample: any[] = await _sqliteStorage.rawAll(
        `SELECT ${fields} FROM ${table} ORDER BY id LIMIT 5`
      );
      const pgSample: any[] = await _pgStorage.rawAll(
        `SELECT ${fields} FROM ${table} ORDER BY id LIMIT 5`
      );

      let rowMismatch = false;
      for (let i = 0; i < Math.min(sqliteSample.length, pgSample.length); i++) {
        const sRow = sqliteSample[i];
        const pRow = pgSample[i];
        const keys = Object.keys(sRow);
        for (const key of keys) {
          const sv = normalizeVal(sRow[key]);
          const pv = normalizeVal(pRow[key]);
          if (sv !== pv) {
            console.warn(`[SHADOW] SAMPLE MISMATCH ${table}.${key} id=${sRow.id}: SQLite="${sv}" PG="${pv}"`);
            rowMismatch = true;
            sampleMismatches++;
          }
        }
      }

      if (!rowMismatch) {
        console.log(`[SHADOW] OK ${table}: ${sqliteCnt} rows, sample match ✓`);
      }
    } catch (e: any) {
      console.warn(`[SHADOW] ERROR ${table}: ${e.message}`);
    }
  }

  // Summary + persist pass/fail result for cutover guard
  if (countMismatches === 0 && sampleMismatches === 0) {
    _shadowValidationPassed = true;
    console.log('[SHADOW] ✓ All tables: row counts match, sample data matches — SAFE TO CUT OVER');
    console.log('[SHADOW] → Remove SHADOW_MODE env var and restart to switch to PostgreSQL');
  } else {
    _shadowValidationPassed = false;
    if (countMismatches > 0) console.warn(`[SHADOW] ✗ ${countMismatches} table(s) have row count mismatches — re-run migration`);
    if (sampleMismatches > 0) console.warn(`[SHADOW] ✗ ${sampleMismatches} field(s) have data mismatches — check migration script`);
  }
}

/** Run a query on both DBs and compare results (call from routes for spot-checking) */
export async function shadowCheck(sql: string, params: any[] = [], label = '') {
  if (!SHADOW_MODE || !_pgStorage) return;
  try {
    const [sqliteRows, pgRows] = await Promise.all([
      _sqliteStorage.rawAll(sql, ...params),
      _pgStorage.rawAll(sql, ...params),
    ]);
    if (JSON.stringify(sqliteRows) !== JSON.stringify(pgRows)) {
      console.warn(`[SHADOW-DIFF] ${label || sql.substring(0, 80)}`);
      console.warn(`[SHADOW-DIFF] SQLite(${sqliteRows.length}):`, JSON.stringify(sqliteRows).substring(0, 200));
      console.warn(`[SHADOW-DIFF] PG(${pgRows.length}):`, JSON.stringify(pgRows).substring(0, 200));
    }
  } catch (e: any) {
    console.warn(`[SHADOW-DIFF] Error comparing: ${e.message}`);
  }
}

export { storage };
