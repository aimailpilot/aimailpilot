/**
 * Outbound Reply Sweeper
 * ----------------------
 * Detects when a user has replied to an inbox message via their native client (Gmail.com / Outlook.com)
 * outside AImailPilot, and marks the corresponding unified_inbox row as replied so it stops appearing
 * in the "Need Reply" tab.
 *
 * WHY THIS EXISTS:
 *   gmail-reply-tracker uses query `-in:sent` to skip the user's Sent folder, so outbound replies
 *   never enter unified_inbox. The "Need Reply" SQL filter checks for later messages in the same
 *   thread from org email accounts — but those rows never exist if the user replied via Gmail.com.
 *   This sweeper closes that gap by querying the Gmail/Outlook thread API directly to detect
 *   external replies, then setting `repliedBy` on the inbox row.
 *
 * SELF-CONTAINED — does NOT modify or import gmail-reply-tracker.ts / outlook-reply-tracker.ts
 * (both protected per CLAUDE.md). Has its own token helpers, mirroring lead-intelligence-engine.ts.
 *
 * BEHAVIOR:
 *   - Runs every 10 minutes
 *   - Processes up to 50 candidate messages per cycle (oldest "need reply" first)
 *   - Updates unified_inbox.repliedBy when an outbound reply is found in the thread
 *   - Bounded API quota usage; safe per-org concurrency (no per-org lock needed since selects are bounded)
 */

import { storage } from "../storage";
import { OAuth2Client } from 'google-auth-library';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;  // 10 minutes
const BOOT_DELAY_MS = 90 * 1000;           // 90 seconds after server boot
const MAX_CANDIDATES_PER_CYCLE = 50;       // bounded API quota usage per cycle
const MIN_AGE_MS = 60 * 1000;              // skip messages received in the last minute (let the tracker run first)
const RECHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // skip rows checked within last 6 hours — lets queue advance through full backlog

let isProcessing = false;

// Last-run stats for the admin status endpoint (in-memory, resets on restart)
interface LastRunStats {
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  candidates: number;
  replied: number;
  noReply: number;
  skipped: number;
  errors: number;
  // Granular outcomes from provider API checks. Previously all non-200 responses
  // were silently treated as "no reply" — making it impossible to tell genuine
  // empty threads from auth/404/server errors. These break that down so the admin
  // health endpoint can show the real reason detection rate is at zero.
  apiAuthFail: number;     // 401/403 from Gmail/Graph
  apiNotFound: number;     // 404 (thread/conversation gone or no permission)
  apiHttpError: number;    // other non-OK
  apiException: number;    // network error / parse error / throw
}
const lastRun: LastRunStats = {
  startedAt: null, finishedAt: null, durationSec: null,
  candidates: 0, replied: 0, noReply: 0, skipped: 0, errors: 0,
  apiAuthFail: 0, apiNotFound: 0, apiHttpError: 0, apiException: 0,
};

// Rolling buffer of recent API failures (in-memory, capped). Surfaced via
// the admin health endpoint to point at which accounts/threads are failing.
interface ApiFailureSample {
  ts: string;
  provider: 'gmail' | 'outlook';
  status: number | string;
  ownerEmail: string;
  threadId: string;
}
const recentFailures: ApiFailureSample[] = [];
const MAX_RECENT_FAILURES = 20;
function recordFailure(s: ApiFailureSample) {
  recentFailures.unshift(s);
  if (recentFailures.length > MAX_RECENT_FAILURES) recentFailures.length = MAX_RECENT_FAILURES;
}

export function getOutboundReplySweepStatus() {
  return { isProcessing, intervalMs: SWEEP_INTERVAL_MS, maxPerCycle: MAX_CANDIDATES_PER_CYCLE, lastRun, recentFailures };
}

// ──────────────────────────────────────────────────────────────────────────────
// Org email cache — populated per sweep cycle. Keys are organizationId, values
// are Set<lowercase email> of every email_accounts.email row for that org.
// Used to widen the from-match: a thread reply is treated as "the team replied"
// if its From: header email is ANY of the org's connected accounts (not just
// the specific account that received the original inbox row). This catches
// the cross-account-reply case (inbox arrives at sales@; a teammate replies
// from rajiv@; thread is still visible to sales' API call because rajiv was
// CC'd or used Send Mail As). Cache is rebuilt each cycle so newly-added
// accounts are picked up within one cycle (10 min).
// ──────────────────────────────────────────────────────────────────────────────

const orgEmailsCache = new Map<string, Set<string>>();

async function getOrgEmails(orgId: string): Promise<Set<string>> {
  const cached = orgEmailsCache.get(orgId);
  if (cached) return cached;
  try {
    const rows = await storage.rawAll(
      `SELECT LOWER(TRIM(email)) as email FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL AND email != ''`,
      orgId
    ) as any[];
    const set = new Set<string>(rows.map((r: any) => r.email).filter(Boolean));
    orgEmailsCache.set(orgId, set);
    return set;
  } catch (e: any) {
    console.error(`[OutboundReplySweep] Failed to load org emails for ${orgId}:`, e?.message || e);
    return new Set<string>();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Self-contained token helpers (same pattern as lead-intelligence-engine.ts)
// ──────────────────────────────────────────────────────────────────────────────

async function getGmailAccessToken(orgId: string, senderEmail: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  const prefix = `gmail_sender_${senderEmail}_`;
  let accessToken = settings[`${prefix}access_token`] || null;
  let refreshToken = settings[`${prefix}refresh_token`] || null;
  let tokenExpiry = settings[`${prefix}token_expiry`] || null;

  if (!accessToken && !refreshToken) {
    accessToken = settings.gmail_access_token || null;
    refreshToken = settings.gmail_refresh_token || null;
    tokenExpiry = settings.gmail_token_expiry || null;
  }
  if (!accessToken && !refreshToken) return null;

  let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    try {
      const superAdminOrgId = await storage.getSuperAdminOrgId();
      if (superAdminOrgId && superAdminOrgId !== orgId) {
        const ss = await storage.getApiSettings(superAdminOrgId);
        if (ss.google_oauth_client_id) { clientId = ss.google_oauth_client_id; clientSecret = ss.google_oauth_client_secret || ''; }
      }
    } catch { /* ignore */ }
  }

  const expiry = parseInt(tokenExpiry || '0');
  if (!tokenExpiry || Date.now() > expiry - 300000) {
    if (refreshToken && clientId && clientSecret) {
      try {
        const oauth2 = new OAuth2Client(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2.refreshAccessToken();
        if (credentials.access_token) {
          accessToken = credentials.access_token;
          if (settings[`${prefix}refresh_token`]) {
            await storage.setApiSetting(orgId, `${prefix}access_token`, accessToken);
            if (credentials.expiry_date) await storage.setApiSetting(orgId, `${prefix}token_expiry`, String(credentials.expiry_date));
          } else {
            await storage.setApiSetting(orgId, 'gmail_access_token', accessToken);
            if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
          }
        }
      } catch (e) {
        console.error(`[OutboundReplySweep] Gmail token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return accessToken;
}

async function getOutlookAccessToken(orgId: string, senderEmail: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  const prefix = `outlook_sender_${senderEmail}_`;
  let accessToken = settings[`${prefix}access_token`] || null;
  let refreshToken = settings[`${prefix}refresh_token`] || null;
  let tokenExpiry = settings[`${prefix}token_expiry`] || null;

  if (!accessToken && !refreshToken) {
    accessToken = settings.microsoft_access_token || null;
    refreshToken = settings.microsoft_refresh_token || null;
    tokenExpiry = settings.microsoft_token_expiry || null;
  }
  if (!accessToken && !refreshToken) return null;

  const expiry = parseInt(tokenExpiry || '0');
  if (!accessToken || Date.now() > expiry - 300000) {
    if (refreshToken) {
      let clientId = settings.microsoft_oauth_client_id || '';
      let clientSecret = settings.microsoft_oauth_client_secret || '';
      if (!clientId || !clientSecret) {
        try {
          const superAdminOrgId = await storage.getSuperAdminOrgId();
          if (superAdminOrgId && superAdminOrgId !== orgId) {
            const ss = await storage.getApiSettings(superAdminOrgId);
            if (ss.microsoft_oauth_client_id) { clientId = ss.microsoft_oauth_client_id; clientSecret = ss.microsoft_oauth_client_secret || ''; }
          }
        } catch { /* ignore */ }
      }
      if (!clientId) clientId = process.env.MICROSOFT_CLIENT_ID || '';
      if (!clientSecret) clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

      if (clientId && clientSecret) {
        try {
          const body = new URLSearchParams({
            client_id: clientId, client_secret: clientSecret,
            refresh_token: refreshToken, grant_type: 'refresh_token',
            scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
          });
          const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
          });
          if (resp.ok) {
            const tokens = await resp.json() as any;
            if (tokens.access_token) {
              accessToken = tokens.access_token;
              const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
              if (settings[`${prefix}refresh_token`]) {
                await storage.setApiSetting(orgId, `${prefix}access_token`, accessToken);
                if (tokens.refresh_token) await storage.setApiSetting(orgId, `${prefix}refresh_token`, tokens.refresh_token);
                await storage.setApiSetting(orgId, `${prefix}token_expiry`, String(exp));
              } else {
                await storage.setApiSetting(orgId, 'microsoft_access_token', accessToken);
                if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
                await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
              }
            }
          }
        } catch (e) {
          console.error(`[OutboundReplySweep] Outlook token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return accessToken;
}

// ──────────────────────────────────────────────────────────────────────────────
// Provider-specific thread checkers
// ──────────────────────────────────────────────────────────────────────────────

// Extract plain-text body from a Gmail message payload (handles multipart/mixed,
// multipart/alternative, and single-part text/plain or text/html). Falls back to snippet.
function extractGmailBody(msg: any): string {
  if (!msg) return '';
  // Walk the parts tree depth-first preferring text/plain over text/html
  const collect = (part: any, acc: { plain: string; html: string }) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const data = part.body?.data;
    if (data) {
      try {
        const decoded = Buffer.from(data, 'base64url').toString('utf-8');
        if (mime === 'text/plain' && !acc.plain) acc.plain = decoded;
        else if (mime === 'text/html' && !acc.html) acc.html = decoded;
      } catch { /* skip */ }
    }
    if (Array.isArray(part.parts)) for (const p of part.parts) collect(p, acc);
  };
  const acc = { plain: '', html: '' };
  collect(msg.payload, acc);
  if (acc.plain) return acc.plain;
  if (acc.html) {
    return acc.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim();
  }
  return msg.snippet || '';
}

const NATIVE_REPLY_MAX_CHARS = 5000;

/**
 * Check a Gmail thread for an outbound reply from the user.
 * Returns { sentAt, content } when found, else null.
 * Uses format=full so the matched message body is included — no extra detail fetch needed.
 */
async function checkGmailThread(accessToken: string, threadId: string, ownerEmail: string, orgEmails: Set<string>, receivedAt: number): Promise<{ sentAt: string; content: string } | null> {
  try {
    const resp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!resp.ok) {
      const sample: ApiFailureSample = { ts: new Date().toISOString(), provider: 'gmail', status: resp.status, ownerEmail, threadId };
      if (resp.status === 401 || resp.status === 403) lastRun.apiAuthFail++;
      else if (resp.status === 404) lastRun.apiNotFound++;
      else lastRun.apiHttpError++;
      recordFailure(sample);
      return null;
    }
    const data = await resp.json() as any;
    if (!data?.messages) return null;

    for (const msg of data.messages) {
      const headers = msg.payload?.headers || [];
      const fromHeader = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
      const dateHeader = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
      const fromEmail = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader).toLowerCase().trim();
      // Match: any org-connected email (not just the receiving account). Catches the
      // common Send-Mail-As / cross-account-reply case where a teammate replies from
      // their own connected account but the thread is visible via the receiving
      // account's API call.
      if (fromEmail && orgEmails.has(fromEmail)) {
        const msgTime = dateHeader ? new Date(dateHeader).getTime() : (msg.internalDate ? Number(msg.internalDate) : 0);
        if (msgTime > receivedAt) {
          const rawBody = extractGmailBody(msg);
          const content = (rawBody || '').replace(/\s+/g, ' ').trim().slice(0, NATIVE_REPLY_MAX_CHARS);
          return { sentAt: new Date(msgTime).toISOString(), content };
        }
      }
    }
    return null;
  } catch (e: any) {
    lastRun.apiException++;
    recordFailure({ ts: new Date().toISOString(), provider: 'gmail', status: `exception: ${e?.message || 'unknown'}`.slice(0, 100), ownerEmail, threadId });
    return null;
  }
}

/**
 * Check an Outlook (Microsoft Graph) conversation for an outbound reply from the user.
 * Returns { sentAt, content } when found, else null.
 * `body` is requested inline via $select — no extra message detail fetch needed.
 */
async function checkOutlookConversation(accessToken: string, conversationId: string, ownerEmail: string, orgEmails: Set<string>, receivedAt: number): Promise<{ sentAt: string; content: string } | null> {
  try {
    const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'&$select=from,sentDateTime,sender,body,bodyPreview&$top=50`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const sample: ApiFailureSample = { ts: new Date().toISOString(), provider: 'outlook', status: resp.status, ownerEmail, threadId: conversationId };
      if (resp.status === 401 || resp.status === 403) lastRun.apiAuthFail++;
      else if (resp.status === 404) lastRun.apiNotFound++;
      else lastRun.apiHttpError++;
      recordFailure(sample);
      return null;
    }
    const data = await resp.json() as any;
    const messages: any[] = data?.value || [];

    for (const m of messages) {
      const fromAddr = (m.from?.emailAddress?.address || m.sender?.emailAddress?.address || '').toLowerCase();
      // Match: any org-connected email, not just the receiving account.
      if (!fromAddr || !orgEmails.has(fromAddr)) continue;
      const sentTime = m.sentDateTime ? new Date(m.sentDateTime).getTime() : 0;
      if (sentTime > receivedAt) {
        // Graph returns body as { contentType: 'html' | 'text', content: '...' }. Strip HTML if needed.
        const bodyContentType = (m.body?.contentType || '').toLowerCase();
        const bodyRaw: string = m.body?.content || m.bodyPreview || '';
        let textOnly = bodyRaw;
        if (bodyContentType === 'html') {
          textOnly = bodyRaw
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        }
        const content = (textOnly || '').replace(/\s+/g, ' ').trim().slice(0, NATIVE_REPLY_MAX_CHARS);
        return { sentAt: new Date(sentTime).toISOString(), content };
      }
    }
    return null;
  } catch (e: any) {
    lastRun.apiException++;
    recordFailure({ ts: new Date().toISOString(), provider: 'outlook', status: `exception: ${e?.message || 'unknown'}`.slice(0, 100), ownerEmail, threadId: conversationId });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main sweep
// ──────────────────────────────────────────────────────────────────────────────

interface InboxCandidate {
  id: string;
  organizationId: string;
  gmailThreadId: string | null;
  outlookConversationId: string | null;
  emailAccountId: string;
  receivedAt: string;
  ownerEmail: string;
  ownerUserId: string | null;
  provider: string;
}

async function selectCandidates(): Promise<InboxCandidate[]> {
  // Pull up to N candidates: "need reply" messages with either a Gmail thread id or an Outlook
  // conversation id (the trackers populate provider-specific thread fields, not the generic
  // "threadId" column).
  //
  // Two age gates:
  //   - receivedAt > MIN_AGE_MS old → skip (let inbound tracker run first)
  //   - outboundCheckedAt within RECHECK_COOLDOWN_MS → skip (queue progression — without
  //     this we'd loop on the same oldest 50 forever and never reach newer messages)
  //
  // Order by outboundCheckedAt NULLS FIRST so never-checked rows are processed before re-checks,
  // then by receivedAt ASC for stable iteration order.
  const recvCutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const checkCutoff = new Date(Date.now() - RECHECK_COOLDOWN_MS).toISOString();
  const sql = `
    SELECT ui.id, ui."organizationId",
           ui."gmailThreadId", ui."outlookConversationId",
           ui."emailAccountId", ui."receivedAt",
           ea.email AS "ownerEmail", ea."userId" AS "ownerUserId", ea.provider AS "provider"
    FROM unified_inbox ui
    JOIN email_accounts ea ON ea.id = ui."emailAccountId"
    WHERE ui."replyType" IN ('positive','negative','general')
      AND (ui.status != 'replied' AND ui."repliedAt" IS NULL)
      AND ui."repliedBy" IS NULL
      AND (
        (ui."gmailThreadId" IS NOT NULL AND ui."gmailThreadId" != '')
        OR (ui."outlookConversationId" IS NOT NULL AND ui."outlookConversationId" != '')
      )
      AND ui."receivedAt" < ?
      AND (ui."outboundCheckedAt" IS NULL OR ui."outboundCheckedAt" < ?)
      AND ea."isActive" != 0
    ORDER BY ui."outboundCheckedAt" ASC NULLS FIRST, ui."receivedAt" ASC
    LIMIT ?
  `;
  return storage.rawAll(sql, recvCutoff, checkCutoff, MAX_CANDIDATES_PER_CYCLE) as Promise<InboxCandidate[]>;
}

async function processCandidate(c: InboxCandidate): Promise<'replied' | 'no_reply' | 'skipped'> {
  // Mark this row as checked regardless of outcome — keeps the queue advancing through the
  // backlog instead of looping on the same oldest 50 forever. Set BEFORE the API calls so that
  // even on transient skips/errors we won't keep retrying the same row every cycle.
  // Re-checks happen naturally after RECHECK_COOLDOWN_MS expires.
  const checkedAtIso = new Date().toISOString();
  await storage.rawRun(
    `UPDATE unified_inbox SET "outboundCheckedAt" = ? WHERE id = ? AND "organizationId" = ?`,
    checkedAtIso, c.id, c.organizationId
  );

  if (!c.ownerEmail) return 'skipped';
  const provider = (c.provider || '').toLowerCase();
  const receivedAt = new Date(c.receivedAt).getTime();
  // Each member has 5-10 connected emails. A reply may come from ANY of the org's
  // accounts, not just the one that received the inbox row. Pre-fetch the full set
  // (cached per cycle) and pass to the matcher so we catch cross-account replies.
  const orgEmails = await getOrgEmails(c.organizationId);
  let match: { sentAt: string; content: string } | null = null;

  if (provider === 'gmail' && c.gmailThreadId) {
    const token = await getGmailAccessToken(c.organizationId, c.ownerEmail);
    if (!token) return 'skipped';
    match = await checkGmailThread(token, c.gmailThreadId, c.ownerEmail, orgEmails, receivedAt);
  } else if (provider === 'outlook' && c.outlookConversationId) {
    const token = await getOutlookAccessToken(c.organizationId, c.ownerEmail);
    if (!token) return 'skipped';
    match = await checkOutlookConversation(token, c.outlookConversationId, c.ownerEmail, orgEmails, receivedAt);
  } else {
    return 'skipped';
  }

  if (!match) return 'no_reply';

  // Mark this inbox row as replied via native client. Stores:
  //   - repliedBy: who replied (ownerUserId fallback to ownerEmail)
  //   - repliedAt: the timestamp of the native reply (from the Gmail/Outlook thread)
  //   - nativeReplyContent: the body of their reply (extracted from the thread)
  // Setting repliedAt aligns native replies with in-app reply UX so the unified inbox
  // shows them consistently in the Replied tab and the message detail can surface a
  // "Replied at X" label. The "(status='replied' AND repliedAt IS NOT NULL)" branch in
  // the Replied filter and the "repliedAt IS NULL" guard in the not_replied filter both
  // benefit from the timestamp being populated. Idempotent via repliedBy IS NULL — won't
  // overwrite if another flow already claimed the row.
  // Does NOT set status='replied' (kept for explicit in-app actions like archive/dismiss).
  await storage.rawRun(
    `UPDATE unified_inbox SET "repliedBy" = ?, "repliedAt" = ?, "nativeReplyContent" = ? WHERE id = ? AND "organizationId" = ? AND "repliedBy" IS NULL`,
    c.ownerUserId || c.ownerEmail, match.sentAt, match.content || null, c.id, c.organizationId
  );
  return 'replied';
}

export async function runOutboundReplySweep(): Promise<LastRunStats> {
  if (isProcessing) {
    console.log('[OutboundReplySweep] Previous cycle still running, skipping');
    return { ...lastRun };
  }
  isProcessing = true;
  const started = Date.now();
  lastRun.startedAt = new Date(started).toISOString();
  lastRun.finishedAt = null;
  lastRun.durationSec = null;
  lastRun.candidates = 0;
  lastRun.replied = 0;
  lastRun.noReply = 0;
  lastRun.skipped = 0;
  lastRun.errors = 0;
  lastRun.apiAuthFail = 0;
  lastRun.apiNotFound = 0;
  lastRun.apiHttpError = 0;
  lastRun.apiException = 0;

  try {
    const candidates = await selectCandidates();
    lastRun.candidates = candidates.length;
    if (candidates.length === 0) {
      console.log('[OutboundReplySweep] No candidates this cycle');
    } else {
      console.log(`[OutboundReplySweep] Processing ${candidates.length} candidate(s)`);
      for (const c of candidates) {
        try {
          const result = await processCandidate(c);
          if (result === 'replied') lastRun.replied++;
          else if (result === 'no_reply') lastRun.noReply++;
          else lastRun.skipped++;
        } catch (e) {
          lastRun.errors++;
          console.error(`[OutboundReplySweep] candidate ${c.id} failed:`, e instanceof Error ? e.message : e);
        }
      }
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`[OutboundReplySweep] Done in ${elapsed}s — replied=${lastRun.replied} no_reply=${lastRun.noReply} skipped=${lastRun.skipped} errors=${lastRun.errors}`);
    }
  } catch (e) {
    console.error('[OutboundReplySweep] sweep failed:', e instanceof Error ? e.message : e);
  } finally {
    isProcessing = false;
    lastRun.finishedAt = new Date().toISOString();
    lastRun.durationSec = Math.round((Date.now() - started) / 1000);
  }
  return { ...lastRun };
}

// One-time backfill: fetch nativeReplyContent for rows already marked repliedBy by older
// sweeper runs (which only stored the timestamp, not the body). Same provider API logic
// as the regular sweep, but selects different rows and uses an UPDATE that doesn't require
// repliedBy IS NULL (since these already have it set).
export async function backfillNativeReplyContent(maxRows: number = 100): Promise<{ processed: number; filled: number; skipped: number; errors: number }> {
  const stats = { processed: 0, filled: 0, skipped: 0, errors: 0 };
  // Pull rows that have a repliedBy (sweeper marked) but no body yet, with a thread id available.
  const sql = `
    SELECT ui.id, ui."organizationId",
           ui."gmailThreadId", ui."outlookConversationId",
           ui."emailAccountId", ui."receivedAt",
           ea.email AS "ownerEmail", ea.provider AS "provider"
    FROM unified_inbox ui
    JOIN email_accounts ea ON ea.id = ui."emailAccountId"
    WHERE ui."repliedBy" IS NOT NULL
      AND (ui."nativeReplyContent" IS NULL OR ui."nativeReplyContent" = '')
      AND (
        (ui."gmailThreadId" IS NOT NULL AND ui."gmailThreadId" != '')
        OR (ui."outlookConversationId" IS NOT NULL AND ui."outlookConversationId" != '')
      )
      AND ea."isActive" != 0
    ORDER BY ui."receivedAt" DESC
    LIMIT ?
  `;
  const rows = await storage.rawAll(sql, maxRows) as any[];
  if (!rows.length) return stats;
  console.log(`[OutboundReplySweep] Backfill: ${rows.length} candidate rows`);

  for (const r of rows) {
    stats.processed++;
    try {
      const provider = (r.provider || '').toLowerCase();
      const receivedAt = new Date(r.receivedAt).getTime();
      let match: { sentAt: string; content: string } | null = null;

      if (provider === 'gmail' && r.gmailThreadId) {
        const token = await getGmailAccessToken(r.organizationId, r.ownerEmail);
        if (!token) { stats.skipped++; continue; }
        match = await checkGmailThread(token, r.gmailThreadId, r.ownerEmail, receivedAt);
      } else if (provider === 'outlook' && r.outlookConversationId) {
        const token = await getOutlookAccessToken(r.organizationId, r.ownerEmail);
        if (!token) { stats.skipped++; continue; }
        match = await checkOutlookConversation(token, r.outlookConversationId, r.ownerEmail, receivedAt);
      } else {
        stats.skipped++; continue;
      }

      if (!match || !match.content) { stats.skipped++; continue; }

      // Backfill UPDATE — does NOT require repliedBy IS NULL (the row already has repliedBy set).
      // Only writes if nativeReplyContent is still empty (idempotent against concurrent sweeps).
      await storage.rawRun(
        `UPDATE unified_inbox SET "nativeReplyContent" = ? WHERE id = ? AND "organizationId" = ? AND ("nativeReplyContent" IS NULL OR "nativeReplyContent" = '')`,
        match.content, r.id, r.organizationId
      );
      stats.filled++;
    } catch (e) {
      stats.errors++;
      console.error(`[OutboundReplySweep] backfill row ${r.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[OutboundReplySweep] Backfill done: processed=${stats.processed} filled=${stats.filled} skipped=${stats.skipped} errors=${stats.errors}`);
  return stats;
}

export function startOutboundReplySweeper(): void {
  console.log(`[OutboundReplySweep] Starting — first run in ${BOOT_DELAY_MS / 1000}s, then every ${SWEEP_INTERVAL_MS / 60000}min, max ${MAX_CANDIDATES_PER_CYCLE} candidates/cycle`);
  setTimeout(() => {
    runOutboundReplySweep().catch(e => console.error('[OutboundReplySweep] initial run crashed:', e));
    setInterval(() => {
      runOutboundReplySweep().catch(e => console.error('[OutboundReplySweep] cycle crashed:', e));
    }, SWEEP_INTERVAL_MS);
  }, BOOT_DELAY_MS);
}
