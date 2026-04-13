/**
 * Bounce Sync Engine
 * Scans all sources for bounced/unsubscribed emails and adds them to the suppression list.
 *
 * Sources:
 * 1. contacts table — status = 'bounced' or 'unsubscribed'
 * 2. unified_inbox — bounce notification emails (mailer-daemon, postmaster, replyType='bounce')
 * 3. Gmail inboxes — historical bounce scan via Gmail API search
 * 4. Outlook inboxes — historical bounce scan via Microsoft Graph
 */

import { storage } from '../storage.js';

const EMAIL_PATTERN = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
const SKIP_DOMAINS = ['mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'bounce', 'googlemail', 'google.com', 'microsoft.com', 'outlook.com', 'amazonses'];

const BOUNCE_SUBJECTS = [
  'delivery status notification',
  'undeliverable',
  'mail delivery failed',
  'delivery failure',
  'returned mail',
  'message not delivered',
  'delivery status',
  'failed delivery',
  'mail delivery subsystem',
];

const BOUNCE_SENDERS = ['mailer-daemon', 'postmaster', 'do-not-reply@sophosemail'];

function isSystemEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return SKIP_DOMAINS.some(d => lower.includes(d));
}

/**
 * Load all email addresses connected to this org (sending accounts + warmup accounts).
 * These must never be added to the suppression list.
 */
async function getOrgConnectedEmails(orgId: string): Promise<Set<string>> {
  const connected = new Set<string>();
  try {
    const accounts = await storage.rawAll(
      `SELECT email FROM email_accounts WHERE "organizationId" = ?`,
      orgId
    );
    for (const a of accounts as any[]) {
      if (a.email) connected.add(a.email.toLowerCase());
    }
    // Also include warmup accounts
    const warmup = await storage.rawAll(
      `SELECT email FROM warmup_accounts WHERE "organizationId" = ?`,
      orgId
    );
    for (const w of warmup as any[]) {
      if (w.email) connected.add(w.email.toLowerCase());
    }
  } catch (e) { /* non-critical */ }
  return connected;
}

function isSafeToSuppress(email: string, connectedEmails: Set<string>): boolean {
  const lower = email.toLowerCase();
  return !isSystemEmail(lower) && !connectedEmails.has(lower);
}

function isBounceSubject(subject: string): boolean {
  const lower = (subject || '').toLowerCase();
  return BOUNCE_SUBJECTS.some(s => lower.includes(s));
}

function isBounceSender(from: string): boolean {
  const lower = (from || '').toLowerCase();
  return BOUNCE_SENDERS.some(s => lower.includes(s));
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_PATTERN) || [];
  return matches.filter(e => !isSystemEmail(e));
}

export interface BounceSyncResult {
  contactsSynced: number;
  inboxBouncesSynced: number;
  emailHistorySynced: number;
  gmailHistoricalSynced: number;
  outlookHistoricalSynced: number;
  totalAdded: number;
  errors: string[];
}

/**
 * Sync contacts with status=bounced/unsubscribed → suppression list
 */
async function syncContactsToSuppression(orgId: string, connectedEmails: Set<string>): Promise<number> {
  let added = 0;
  try {
    const rows = await storage.rawAll(
      `SELECT email, status FROM contacts WHERE "organizationId" = ? AND status IN ('bounced', 'unsubscribed')`,
      orgId
    );
    for (const row of rows as any[]) {
      if (!row.email || !isSafeToSuppress(row.email, connectedEmails)) continue;
      try {
        await storage.addToSuppressionList(orgId, row.email, row.status === 'bounced' ? 'bounce' : 'unsubscribe', {
          bounceType: row.status === 'bounced' ? 'hard' : undefined,
          source: 'contact-sync',
        });
        added++;
      } catch (e) { /* duplicate */ }
    }
  } catch (e) {
    console.error('[BounceSync] Error syncing contacts:', e);
  }
  return added;
}

/**
 * Scan unified_inbox for bounce notification emails and extract bounced addresses
 * Sources:
 *   1. replyType='bounce' entries → toEmail is the bounced recipient
 *   2. Bounce notification emails (mailer-daemon/postmaster) → extract from snippet/body
 *   3. replyType='unsubscribe' entries → fromEmail unsubscribed
 */
async function syncInboxToSuppression(orgId: string, connectedEmails: Set<string>): Promise<number> {
  let added = 0;
  try {
    // Source 1: Entries tagged as bounce — toEmail is the bounced EXTERNAL recipient
    // Skip if toEmail is one of our own connected accounts (warmup emails)
    const taggedBounces = await storage.rawAll(
      `SELECT "toEmail", subject FROM unified_inbox
       WHERE "organizationId" = ? AND "replyType" = 'bounce' AND "toEmail" IS NOT NULL AND "toEmail" != ''`,
      orgId
    );
    for (const row of taggedBounces as any[]) {
      const email = (row.toEmail || '').toLowerCase().trim();
      if (!email || !isSafeToSuppress(email, connectedEmails)) continue;
      try {
        await storage.addToSuppressionList(orgId, email, 'bounce', {
          bounceType: 'hard',
          source: 'inbox-bounce-tag',
          notes: `Tagged bounced recipient in unified inbox`,
        });
        added++;
      } catch (e) { /* duplicate */ }
    }

    // Source 2: Bounce notification emails (mailer-daemon/postmaster) — extract email from snippet/body
    const notificationRows = await storage.rawAll(
      `SELECT "fromEmail", subject, snippet, body FROM unified_inbox
       WHERE "organizationId" = ?
       AND (LOWER("fromEmail") LIKE '%mailer-daemon%'
         OR LOWER("fromEmail") LIKE '%postmaster%'
         OR LOWER(subject) LIKE '%delivery status notification%'
         OR LOWER(subject) LIKE '%undeliverable%'
         OR LOWER(subject) LIKE '%mail delivery failed%'
         OR LOWER(subject) LIKE '%message not delivered%'
         OR LOWER(subject) LIKE '%undelivered mail%')`,
      orgId
    );
    for (const row of notificationRows as any[]) {
      const text = `${row.snippet || ''} ${row.body || ''}`;
      const emails = extractEmailsFromText(text);
      for (const email of emails) {
        if (!isSafeToSuppress(email, connectedEmails)) continue;
        try {
          await storage.addToSuppressionList(orgId, email, 'bounce', {
            bounceType: 'hard',
            source: 'inbox-notification-scan',
            notes: `Extracted from bounce notification: ${(row.subject || '').slice(0, 100)}`,
          });
          added++;
        } catch (e) { /* duplicate */ }
      }
    }

    // Source 3: Unsubscribe entries — fromEmail is the external contact who unsubscribed
    const unsubRows = await storage.rawAll(
      `SELECT "fromEmail" FROM unified_inbox WHERE "organizationId" = ? AND "replyType" = 'unsubscribe'`,
      orgId
    );
    for (const row of unsubRows as any[]) {
      if (!row.fromEmail || !isSafeToSuppress(row.fromEmail, connectedEmails)) continue;
      try {
        await storage.addToSuppressionList(orgId, row.fromEmail, 'unsubscribe', { source: 'inbox-scan' });
        added++;
      } catch (e) { /* duplicate */ }
    }

    console.log(`[BounceSync] unified_inbox: tagged=${taggedBounces.length}, notifications=${notificationRows.length}, unsubs=${unsubRows.length} → ${added} added to suppression`);
  } catch (e) {
    console.error('[BounceSync] Error scanning inbox:', e);
  }
  return added;
}

/**
 * Mine email_history table (already scanned by Lead Intelligence) for bounce notifications
 */
async function syncEmailHistoryToSuppression(orgId: string, connectedEmails: Set<string>): Promise<number> {
  let added = 0;
  try {
    // Find bounce notification emails already stored in email_history
    const rows = await storage.rawAll(
      `SELECT "fromEmail", subject, snippet FROM email_history
       WHERE "organizationId" = ?
       AND (
         LOWER("fromEmail") LIKE '%mailer-daemon%'
         OR LOWER("fromEmail") LIKE '%postmaster%'
         OR LOWER(subject) LIKE '%delivery status notification%'
         OR LOWER(subject) LIKE '%undeliverable%'
         OR LOWER(subject) LIKE '%mail delivery failed%'
         OR LOWER(subject) LIKE '%message not delivered%'
         OR LOWER(subject) LIKE '%delivery failure%'
         OR LOWER(subject) LIKE '%returned mail%'
         OR LOWER(subject) LIKE '%failed delivery%'
       )`,
      orgId
    );

    console.log(`[BounceSync] email_history: found ${rows.length} bounce notification emails for org ${orgId}`);

    for (const row of rows as any[]) {
      const text = `${row.snippet || ''}`;
      const emails = extractEmailsFromText(text);
      for (const email of emails) {
        if (!isSafeToSuppress(email, connectedEmails)) continue;
        try {
          await storage.addToSuppressionList(orgId, email, 'bounce', {
            bounceType: 'hard',
            source: 'email-history-scan',
            notes: `Mined from Lead Intelligence history: ${(row.subject || '').slice(0, 80)}`,
          });
          added++;
        } catch (e) { /* duplicate */ }
      }
    }
  } catch (e) {
    console.error('[BounceSync] Error scanning email_history:', e);
  }
  return added;
}

/**
 * Scan Gmail inboxes for historical bounce emails
 */
async function scanGmailHistorical(orgId: string, lookbackDays: number = 30, connectedEmails: Set<string> = new Set()): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];

  try {
    const accounts = await storage.rawAll(
      `SELECT email, id FROM email_accounts WHERE "organizationId" = ? AND provider = 'gmail' AND "isActive" = 1`,
      orgId
    );

    for (const account of accounts as any[]) {
      try {
        // Get access token
        const tokenKey = `gmail_sender_${account.email}_access_token`;
        const expiryKey = `gmail_sender_${account.email}_token_expiry`;
        const refreshKey = `gmail_sender_${account.email}_refresh_token`;

        const settings = await storage.getApiSettings(orgId);
        let accessToken: string = settings[tokenKey];
        const expiry = parseInt(settings[expiryKey] || '0');
        const refreshToken: string = settings[refreshKey];

        if (!accessToken) continue;

        // Refresh if expired
        if (expiry && Date.now() > expiry - 60000 && refreshToken) {
          try {
            const superOrgId = await storage.getSuperAdminOrgId();
            const superSettings = await storage.getApiSettings(superOrgId || orgId);
            const clientId = superSettings['google_client_id'] || process.env.GOOGLE_CLIENT_ID;
            const clientSecret = superSettings['google_client_secret'] || process.env.GOOGLE_CLIENT_SECRET;
            if (clientId && clientSecret) {
              const resp = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
              });
              const data = await resp.json() as any;
              if (data.access_token) accessToken = data.access_token;
            }
          } catch (e) { /* use existing token */ }
        }

        // Search Gmail for bounce notifications
        const afterDate = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
        const query = `from:(mailer-daemon OR postmaster) subject:(delivery OR undeliverable OR failed) after:${afterDate}`;

        const listResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=200`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!listResp.ok) continue;

        const listData = await listResp.json() as any;
        const messages = listData.messages || [];

        for (const msgRef of messages) {
          try {
            const msgResp = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=metadata&metadataHeaders=Subject,From`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!msgResp.ok) continue;
            const msg = await msgResp.json() as any;

            const subject = msg.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || '';
            const from = msg.payload?.headers?.find((h: any) => h.name === 'From')?.value || '';

            if (!isBounceSender(from) && !isBounceSubject(subject)) continue;

            // Extract emails from snippet
            const text = msg.snippet || '';
            const emails = extractEmailsFromText(text);
            for (const email of emails) {
              if (!isSafeToSuppress(email, connectedEmails)) continue;
              try {
                await storage.addToSuppressionList(orgId, email, 'bounce', {
                  bounceType: 'hard',
                  source: 'gmail-historical-scan',
                  notes: `Gmail scan: ${account.email} — ${subject.slice(0, 80)}`,
                });
                added++;
              } catch (e) { /* duplicate */ }
            }
          } catch (e) { /* skip individual message errors */ }
        }

        console.log(`[BounceSync] Gmail scan for ${account.email}: ${messages.length} bounce emails processed`);
      } catch (e: any) {
        errors.push(`Gmail ${account.email}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`Gmail scan failed: ${e.message}`);
  }

  return { added, errors };
}

/**
 * Scan Outlook inboxes for historical bounce emails
 */
async function scanOutlookHistorical(orgId: string, lookbackDays: number = 30, connectedEmails: Set<string> = new Set()): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];

  try {
    const accounts = await storage.rawAll(
      `SELECT email, id FROM email_accounts WHERE "organizationId" = ? AND provider = 'outlook' AND "isActive" = 1`,
      orgId
    );

    for (const account of accounts as any[]) {
      try {
        const tokenKey = `outlook_sender_${account.email}_access_token`;
        const settings = await storage.getApiSettings(orgId);
        const accessToken: string = settings[tokenKey];
        if (!accessToken) continue;

        const afterDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
        const filter = encodeURIComponent(
          `receivedDateTime ge ${afterDate} and (contains(subject,'Delivery') or contains(subject,'Undeliverable') or contains(subject,'delivery') or from/emailAddress/address eq 'postmaster@microsoft.com')`
        );

        const resp = await fetch(
          `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$select=subject,from,bodyPreview&$top=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!resp.ok) continue;

        const data = await resp.json() as any;
        const messages = data.value || [];

        for (const msg of messages) {
          const from = msg.from?.emailAddress?.address || '';
          const subject = msg.subject || '';
          if (!isBounceSender(from) && !isBounceSubject(subject)) continue;

          const text = msg.bodyPreview || '';
          const emails = extractEmailsFromText(text);
          for (const email of emails) {
            if (!isSafeToSuppress(email, connectedEmails)) continue;
            try {
              await storage.addToSuppressionList(orgId, email, 'bounce', {
                bounceType: 'hard',
                source: 'outlook-historical-scan',
                notes: `Outlook scan: ${account.email} — ${subject.slice(0, 80)}`,
              });
              added++;
            } catch (e) { /* duplicate */ }
          }
        }

        console.log(`[BounceSync] Outlook scan for ${account.email}: ${messages.length} bounce emails processed`);
      } catch (e: any) {
        errors.push(`Outlook ${account.email}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`Outlook scan failed: ${e.message}`);
  }

  return { added, errors };
}

/**
 * Run full bounce sync for a single org
 */
export async function runBounceSyncForOrg(orgId: string, lookbackDays: number = 30): Promise<BounceSyncResult> {
  console.log(`[BounceSync] Starting sync for org ${orgId} (lookback: ${lookbackDays} days)`);

  // Load all connected org email accounts once — never suppress these
  const connectedEmails = await getOrgConnectedEmails(orgId);
  console.log(`[BounceSync] Org ${orgId} has ${connectedEmails.size} connected accounts to protect from suppression`);

  const result: BounceSyncResult = {
    contactsSynced: 0,
    inboxBouncesSynced: 0,
    emailHistorySynced: 0,
    gmailHistoricalSynced: 0,
    outlookHistoricalSynced: 0,
    totalAdded: 0,
    errors: [],
  };

  result.contactsSynced = await syncContactsToSuppression(orgId, connectedEmails);
  result.inboxBouncesSynced = await syncInboxToSuppression(orgId, connectedEmails);
  result.emailHistorySynced = await syncEmailHistoryToSuppression(orgId, connectedEmails);

  const gmailResult = await scanGmailHistorical(orgId, lookbackDays, connectedEmails);
  result.gmailHistoricalSynced = gmailResult.added;
  result.errors.push(...gmailResult.errors);

  const outlookResult = await scanOutlookHistorical(orgId, lookbackDays, connectedEmails);
  result.outlookHistoricalSynced = outlookResult.added;
  result.errors.push(...outlookResult.errors);

  result.totalAdded = result.contactsSynced + result.inboxBouncesSynced + result.emailHistorySynced + result.gmailHistoricalSynced + result.outlookHistoricalSynced;

  console.log(`[BounceSync] Org ${orgId} done: contacts=${result.contactsSynced}, inbox=${result.inboxBouncesSynced}, gmail=${result.gmailHistoricalSynced}, outlook=${result.outlookHistoricalSynced}, total=${result.totalAdded}`);

  return result;
}

/**
 * Run bounce sync for all orgs
 */
export async function runBounceSyncAllOrgs(lookbackDays: number = 30): Promise<{ [orgId: string]: BounceSyncResult }> {
  const results: { [orgId: string]: BounceSyncResult } = {};
  try {
    const orgs = await storage.rawAll(`SELECT DISTINCT "organizationId" FROM email_accounts WHERE "isActive" = 1`);
    for (const org of orgs as any[]) {
      try {
        results[org.organizationId] = await runBounceSyncForOrg(org.organizationId, lookbackDays);
      } catch (e: any) {
        results[org.organizationId] = {
          contactsSynced: 0, inboxBouncesSynced: 0, gmailHistoricalSynced: 0, outlookHistoricalSynced: 0,
          totalAdded: 0, errors: [e.message],
        };
      }
    }
  } catch (e: any) {
    console.error('[BounceSync] Failed to list orgs:', e);
  }
  return results;
}
