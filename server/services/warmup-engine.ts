import { storage } from "../storage";
import { OAuth2Client } from 'google-auth-library';
import { recordAuthFailure, recordAuthSuccess } from './auth-health';

/**
 * Warmup Engine — Self-warmup between connected org accounts.
 *
 * How it works:
 * 1. Picks active warmup accounts for each org
 * 2. Pairs them: Account A sends to Account B using a real template
 * 3. After sending, the recipient account auto-engages: open, star, mark important, reply
 * 4. Volume ramps by warmup phase (day count since start)
 * 5. Logs stats to warmup_logs and updates warmup_accounts totals
 *
 * Actions performed on received warmup emails:
 * - Gmail: star, mark important, mark as read (via gmail.modify scope)
 * - Outlook: mark as read, flag, move to focused (via Graph API)
 * - Auto-reply with a short human-like response every ~30% of the time
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * fetch() with an AbortController timeout. Default 15s — long enough for
 * Gmail/Graph round-trips, short enough that a single hung request can't
 * stall an entire warmup cycle. Mirrors the pattern used in followup-engine.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Concurrency cap for parallel org cycles — each org does many API calls, so
// 5 in flight is a reasonable ceiling that stays well under Google/MS rate limits
// while letting small/slow orgs not block large/fast ones.
const ORG_CONCURRENCY = 5;

// Overlap guard — prevents a second runWarmupCycle() from starting if the
// previous one hasn't finished. Mirrors the isProcessing pattern in followup-engine.
let cycleRunning = false;

/** Short human-like reply lines used for warmup replies */
const REPLY_LINES = [
  "Thanks for the update, noted!",
  "Got it, thanks!",
  "Appreciate the info — will review shortly.",
  "Received, thank you!",
  "Thanks! Let me know if there's anything else.",
  "Sounds good, thanks for sharing.",
  "Great, I'll take a look.",
  "Thank you for sending this over.",
  "Acknowledged, thanks!",
  "Perfect, will follow up soon.",
];

// ── Token Helpers (mirrors followup-engine pattern) ─────────────────────

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
    } catch (e) { /* ignore */ }
  }

  // Refresh if expired (5-min buffer) — also refresh when tokenExpiry is null/missing
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
          recordAuthSuccess(orgId, senderEmail).catch(() => {});
        }
      } catch (e) {
        console.error(`[Warmup] Gmail token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
        recordAuthFailure(orgId, senderEmail, e).catch(() => {});
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
        } catch (e) { /* ignore */ }
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
          const resp = await fetchWithTimeout('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
              recordAuthSuccess(orgId, senderEmail).catch(() => {});
            }
          } else {
            const errText = await resp.text().catch(() => '');
            recordAuthFailure(orgId, senderEmail, errText).catch(() => {});
          }
        } catch (e) {
          console.error(`[Warmup] Outlook token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
          recordAuthFailure(orgId, senderEmail, e).catch(() => {});
        }
      }
    }
  }
  return accessToken;
}

// ── Sending ─────────────────────────────────────────────────────────────

async function sendViaGmailAPI(
  token: string, from: string, to: string, subject: string, html: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let raw = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${html}`;
    const base64 = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const resp = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64 }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Gmail API ${resp.status}: ${err}` };
    }
    const data = await resp.json() as any;
    return { success: true, messageId: data.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaMicrosoftGraph(
  token: string, to: string, subject: string, html: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const resp = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Graph API ${resp.status}: ${err}` };
    }
    return { success: true, messageId: `graph-warmup-${Date.now()}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Label / Folder Management ──────────────────────────────────────────

const WARMUP_LABEL_NAME = 'AImailPilot-Warmup';

// Cache label/folder IDs per token to avoid repeated API calls
const labelCache = new Map<string, string>();

/** Gmail: get or create the warmup label */
async function getOrCreateGmailLabel(token: string): Promise<string | null> {
  const cacheKey = `gmail:${token.substring(0, 20)}`;
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey)!;

  try {
    // Check if label exists
    const listResp = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResp.ok) return null;
    const listData = await listResp.json() as any;
    const existing = (listData.labels || []).find((l: any) => l.name === WARMUP_LABEL_NAME);
    if (existing) {
      labelCache.set(cacheKey, existing.id);
      return existing.id;
    }

    // Create label
    const createResp = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: WARMUP_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
    if (!createResp.ok) return null;
    const created = await createResp.json() as any;
    labelCache.set(cacheKey, created.id);
    console.log(`[Warmup] Created Gmail label "${WARMUP_LABEL_NAME}" (${created.id})`);
    return created.id;
  } catch (e) {
    console.error('[Warmup] Gmail label error:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Outlook: get or create the warmup folder */
async function getOrCreateOutlookFolder(token: string): Promise<string | null> {
  const cacheKey = `outlook:${token.substring(0, 20)}`;
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey)!;

  try {
    // Check if folder exists
    const listResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/mailFolders?$filter=displayName eq '${WARMUP_LABEL_NAME}'`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (listResp.ok) {
      const listData = await listResp.json() as any;
      if (listData.value?.length > 0) {
        labelCache.set(cacheKey, listData.value[0].id);
        return listData.value[0].id;
      }
    }

    // Create folder
    const createResp = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/mailFolders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: WARMUP_LABEL_NAME }),
    });
    if (!createResp.ok) return null;
    const created = await createResp.json() as any;
    labelCache.set(cacheKey, created.id);
    console.log(`[Warmup] Created Outlook folder "${WARMUP_LABEL_NAME}" (${created.id})`);
    return created.id;
  } catch (e) {
    console.error('[Warmup] Outlook folder error:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Engagement Actions ──────────────────────────────────────────────────

/** Gmail: detect inbox/spam, move spam→inbox, apply warmup label, star + mark important */
async function gmailEngage(token: string, fromEmail: string): Promise<{ opened: number; starred: number; important: number; inboxCount: number; spamCount: number; movedFromSpam: number }> {
  const stats = { opened: 0, starred: 0, important: 0, inboxCount: 0, spamCount: 0, movedFromSpam: 0 };
  try {
    const warmupLabelId = await getOrCreateGmailLabel(token);

    // 1. Search INBOX for warmup emails from this sender (read or unread — engagement marks as read)
    const inboxQ = encodeURIComponent(`from:${fromEmail} newer_than:3d in:inbox`);
    const inboxResp = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${inboxQ}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const inboxMessages = inboxResp.ok ? ((await inboxResp.json() as any).messages || []) : [];
    stats.inboxCount = inboxMessages.length;

    // 2. Search SPAM for warmup emails from this sender
    const spamQ = encodeURIComponent(`from:${fromEmail} newer_than:1d in:spam`);
    const spamResp = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${spamQ}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const spamMessages = spamResp.ok ? ((await spamResp.json() as any).messages || []) : [];
    stats.spamCount = spamMessages.length;

    // 3. Move spam emails → inbox + apply warmup label (trains Gmail this sender is safe)
    for (const msg of spamMessages) {
      const addLabels = ['INBOX'];
      if (warmupLabelId) addLabels.push(warmupLabelId);
      const modResp = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addLabelIds: addLabels,
            removeLabelIds: ['SPAM', 'UNREAD'],
          }),
        }
      );
      if (modResp.ok) {
        stats.movedFromSpam++;
        console.log(`[Warmup] Moved email from SPAM → Inbox+Label (from: ${fromEmail})`);
      }
    }

    // 4. Process inbox emails: star, mark important, apply warmup label, remove from inbox view
    for (const msg of inboxMessages) {
      const addLabels = ['STARRED', 'IMPORTANT'];
      if (warmupLabelId) addLabels.push(warmupLabelId);
      const modResp = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addLabelIds: addLabels,
            removeLabelIds: ['UNREAD', 'INBOX'], // remove from INBOX so it only lives under the warmup label
          }),
        }
      );
      if (modResp.ok) {
        stats.opened++;
        stats.starred++;
        stats.important++;
      }
    }
  } catch (e) {
    console.error('[Warmup] Gmail engage error:', e instanceof Error ? e.message : e);
  }
  return stats;
}

/** Outlook: detect inbox/junk, move junk→warmup folder, move inbox→warmup folder */
async function outlookEngage(token: string, fromEmail: string): Promise<{ opened: number; flagged: number; inboxCount: number; spamCount: number; movedFromSpam: number }> {
  const stats = { opened: 0, flagged: 0, inboxCount: 0, spamCount: 0, movedFromSpam: 0 };
  try {
    const warmupFolderId = await getOrCreateOutlookFolder(token);

    // 1. Search Inbox for warmup emails
    const inboxFilter = encodeURIComponent(`from/emailAddress/address eq '${fromEmail}' and isRead eq false`);
    const inboxResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${inboxFilter}&$top=20&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const inboxMessages = inboxResp.ok ? ((await inboxResp.json() as any).value || []) : [];
    stats.inboxCount = inboxMessages.length;

    // 2. Search JunkEmail for warmup emails
    const junkFilter = encodeURIComponent(`from/emailAddress/address eq '${fromEmail}'`);
    const junkResp = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$filter=${junkFilter}&$top=20&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const junkMessages = junkResp.ok ? ((await junkResp.json() as any).value || []) : [];
    stats.spamCount = junkMessages.length;

    // 3. Move junk emails → warmup folder (trains Outlook that sender is safe)
    for (const msg of junkMessages) {
      const destId = warmupFolderId || 'inbox';
      const moveResp = await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/move`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinationId: destId }),
        }
      );
      if (moveResp.ok) {
        stats.movedFromSpam++;
        console.log(`[Warmup] Moved email from Junk → ${warmupFolderId ? 'Warmup folder' : 'Inbox'} (from: ${fromEmail})`);
      }
    }

    // 4. Process inbox emails: mark read, flag, move to warmup folder
    for (const msg of inboxMessages) {
      // Mark as read + flag
      await fetchWithTimeout(
        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRead: true, flag: { flagStatus: 'flagged' } }),
        }
      );
      stats.opened++;
      stats.flagged++;

      // Move to warmup folder to keep inbox clean
      if (warmupFolderId) {
        await fetchWithTimeout(
          `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/move`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ destinationId: warmupFolderId }),
          }
        );
      }
    }
  } catch (e) {
    console.error('[Warmup] Outlook engage error:', e instanceof Error ? e.message : e);
  }
  return stats;
}

/** Send a reply to a warmup email (Gmail) */
async function gmailReply(token: string, fromEmail: string, toEmail: string, originalSubject: string): Promise<boolean> {
  try {
    const replyText = randomPick(REPLY_LINES);
    const subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
    const html = `<p>${replyText}</p>`;
    const result = await sendViaGmailAPI(token, fromEmail, toEmail, subject, html);
    return result.success;
  } catch (e) {
    return false;
  }
}

/** Send a reply to a warmup email (Outlook) */
async function outlookReply(token: string, toEmail: string, originalSubject: string): Promise<boolean> {
  try {
    const replyText = randomPick(REPLY_LINES);
    const subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
    const result = await sendViaMicrosoftGraph(token, toEmail, subject, `<p>${replyText}</p>`);
    return result.success;
  } catch (e) {
    return false;
  }
}

// ── Volume / Phase Logic ────────────────────────────────────────────────

function getDailyVolume(daysSinceStart: number, dailyTarget: number): number {
  // Phase 1 (days 0-6):  ramp from 2 to dailyTarget * 0.3
  // Phase 2 (days 7-20): ramp to dailyTarget * 0.6
  // Phase 3 (days 21-44): ramp to dailyTarget * 0.9
  // Phase 4 (45+): full dailyTarget
  let ratio: number;
  if (daysSinceStart < 7) {
    ratio = 0.1 + (daysSinceStart / 7) * 0.2; // 10% → 30%
  } else if (daysSinceStart < 21) {
    ratio = 0.3 + ((daysSinceStart - 7) / 14) * 0.3; // 30% → 60%
  } else if (daysSinceStart < 45) {
    ratio = 0.6 + ((daysSinceStart - 21) / 24) * 0.3; // 60% → 90%
  } else {
    ratio = 1.0;
  }
  return Math.max(1, Math.round(dailyTarget * ratio));
}

// ── Main Warmup Cycle ───────────────────────────────────────────────────

interface SendPair {
  from: string;
  to: string;
  subject: string;
  status: 'sent' | 'failed';
  timestamp: string;
}

interface WarmupRunResult {
  orgId: string;
  sent: number;
  received: number;
  opened: number;
  replied: number;
  errors: string[];
  sendPairs: SendPair[];
}

async function runWarmupCycle(): Promise<WarmupRunResult[]> {
  // Overlap guard — if the previous cycle hasn't finished, skip this tick.
  // Better than running two concurrent cycles which would double-count sends
  // and race on currentDaily updates.
  if (cycleRunning) {
    console.log('[Warmup] Previous cycle still running, skipping this interval');
    return [];
  }
  cycleRunning = true;
  const startedAt = Date.now();
  const results: WarmupRunResult[] = [];

  try {
    // Get all organizations that have warmup accounts
    const orgs = await storage.rawAll('SELECT DISTINCT "organizationId" FROM warmup_accounts WHERE status = ?', 'active') as any[];

    // Process orgs in parallel, capped at ORG_CONCURRENCY at a time. Each org's
    // work is independent, so a slow org (many accounts, rate-limited API calls)
    // no longer blocks every other org's cycle.
    const orgIds: string[] = orgs.map((o: any) => o.organizationId);
    for (let i = 0; i < orgIds.length; i += ORG_CONCURRENCY) {
      const batch = orgIds.slice(i, i + ORG_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((orgId) =>
          runOrgWarmup(orgId).catch((e) => {
            console.error(`[Warmup] Org ${orgId} crashed:`, e instanceof Error ? e.message : e);
            return { orgId, sent: 0, received: 0, opened: 0, replied: 0, errors: [String(e)], sendPairs: [] } as WarmupRunResult;
          }),
        ),
      );
      results.push(...batchResults);
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[Warmup] Cycle complete — ${orgIds.length} orgs in ${elapsedSec}s (concurrency=${ORG_CONCURRENCY})`);
  } catch (e) {
    console.error('[Warmup] Cycle error:', e instanceof Error ? e.message : e);
  } finally {
    cycleRunning = false;
  }

  return results;
}

async function runOrgWarmup(orgId: string): Promise<WarmupRunResult> {
  const result: WarmupRunResult = { orgId, sent: 0, received: 0, opened: 0, replied: 0, errors: [], sendPairs: [] };
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get active warmup accounts with email/provider info
    const warmupAccounts = await storage.getWarmupAccounts(orgId);
    let activeAccounts = warmupAccounts.filter((a: any) => a.status === 'active');

    // Skip accounts flagged as needing reauth — their refresh tokens are revoked
    // (password reset / user revoked app access). Retrying wastes Google/MS API
    // calls and floods logs with 401s until user clicks Reconnect in the UI.
    // The reconnect flow clears authStatus back to 'active' and warmup resumes.
    try {
      const reauthRows = await storage.rawAll(
        `SELECT email FROM email_accounts WHERE "organizationId" = ? AND "authStatus" = 'reauth_required'`,
        orgId,
      ) as any[];
      const reauthSet = new Set(reauthRows.map((r: any) => String(r.email || '').toLowerCase()));
      if (reauthSet.size > 0) {
        const before = activeAccounts.length;
        activeAccounts = activeAccounts.filter((a: any) => !reauthSet.has(String(a.accountEmail || '').toLowerCase()));
        const skipped = before - activeAccounts.length;
        if (skipped > 0) {
          console.log(`[Warmup] Org ${orgId}: skipped ${skipped} account(s) flagged reauth_required (need user reconnect)`);
        }
      }
    } catch (e) {
      console.error('[Warmup] reauth filter failed (continuing without it):', e);
    }

    if (activeAccounts.length < 2) {
      console.log(`[Warmup] Org ${orgId}: need at least 2 active warmup accounts, have ${activeAccounts.length}`);
      return result;
    }

    // Get templates — use selected warmup templates if configured, otherwise all
    let templates = await storage.getEmailTemplates(orgId);
    try {
      const settings = await storage.getApiSettings(orgId);
      const savedIds = settings.warmup_template_ids ? JSON.parse(settings.warmup_template_ids) : [];
      if (savedIds.length > 0) {
        const filtered = templates.filter((t: any) => savedIds.includes(t.id));
        if (filtered.length > 0) {
          templates = filtered;
          console.log(`[Warmup] Org ${orgId}: using ${filtered.length} selected warmup templates`);
        }
      }
    } catch (e) { /* ignore parse errors, use all templates */ }

    if (templates.length === 0) {
      console.log(`[Warmup] Org ${orgId}: no templates available`);
      result.errors.push('No templates available');
      return result;
    }

    // For each account, determine how many emails to send today
    for (const account of activeAccounts) {
      const daysSinceStart = Math.floor((Date.now() - new Date(account.startDate).getTime()) / (1000 * 60 * 60 * 24));
      const todayVolume = getDailyVolume(daysSinceStart, account.dailyTarget);
      const alreadySent = account.currentDaily || 0;
      const remaining = Math.max(0, todayVolume - alreadySent);

      if (remaining <= 0) continue;

      // How many to send this cycle (spread across the day — run every 30 min = 48 runs/day)
      // Send 1-3 per cycle to spread naturally
      const batchSize = Math.min(remaining, randomInt(1, 3));

      const email = account.accountEmail;
      const provider = (account.provider || '').toLowerCase();
      const isGmail = provider === 'gmail' || provider === 'google';
      const isOutlook = provider === 'outlook' || provider === 'microsoft';

      console.log(`[Warmup] Account ${email}: provider="${account.provider}", isGmail=${isGmail}, isOutlook=${isOutlook}, daysSinceStart=${daysSinceStart}, todayVolume=${todayVolume}, remaining=${remaining}`);

      // Get sender token — try Gmail first, then Outlook, to handle unknown providers
      let senderToken: string | null = null;
      let resolvedProvider: 'gmail' | 'outlook' | 'unknown' = 'unknown';
      if (isGmail) {
        senderToken = await getGmailAccessToken(orgId, email);
        if (senderToken) resolvedProvider = 'gmail';
      } else if (isOutlook) {
        senderToken = await getOutlookAccessToken(orgId, email);
        if (senderToken) resolvedProvider = 'outlook';
      } else {
        // Unknown provider — try both
        senderToken = await getGmailAccessToken(orgId, email);
        if (senderToken) { resolvedProvider = 'gmail'; }
        else {
          senderToken = await getOutlookAccessToken(orgId, email);
          if (senderToken) resolvedProvider = 'outlook';
        }
      }

      if (!senderToken) {
        console.log(`[Warmup] No token for ${email} (provider=${provider}), skipping`);
        result.errors.push(`No OAuth token for ${email} (provider: ${provider || 'unknown'}). Re-connect the account.`);
        continue;
      }

      // Pick recipients (other active warmup accounts)
      const recipients = activeAccounts.filter((a: any) => a.id !== account.id);
      if (recipients.length === 0) continue;

      let sentThisBatch = 0;

      for (let i = 0; i < batchSize; i++) {
        const recipient = randomPick(recipients);
        const template = randomPick(templates);
        const subject = (template as any).subject || 'Quick update';
        const html = (template as any).content || (template as any).htmlContent || '<p>Hello</p>';

        // Send email (with 401 retry — force-refresh token on auth failure)
        let sendResult: { success: boolean; messageId?: string; error?: string };
        if (resolvedProvider === 'gmail') {
          sendResult = await sendViaGmailAPI(senderToken, email, recipient.accountEmail, subject, html);
          // Retry on 401 — token may have expired mid-cycle
          if (!sendResult.success && sendResult.error && sendResult.error.includes('401')) {
            console.log(`[Warmup] Gmail 401 for ${email}, force-refreshing token...`);
            // Clear expiry to force refresh
            const prefix = `gmail_sender_${email}_`;
            const settings = await storage.getApiSettings(orgId);
            if (settings[`${prefix}token_expiry`]) {
              await storage.setApiSetting(orgId, `${prefix}token_expiry`, '0');
            } else {
              await storage.setApiSetting(orgId, 'gmail_token_expiry', '0');
            }
            const freshToken = await getGmailAccessToken(orgId, email);
            if (freshToken) {
              senderToken = freshToken;
              sendResult = await sendViaGmailAPI(freshToken, email, recipient.accountEmail, subject, html);
            }
          }
        } else {
          sendResult = await sendViaMicrosoftGraph(senderToken, recipient.accountEmail, subject, html);
          // Retry on 401 for Outlook
          if (!sendResult.success && sendResult.error && sendResult.error.includes('401')) {
            console.log(`[Warmup] Outlook 401 for ${email}, force-refreshing token...`);
            const prefix = `outlook_sender_${email}_`;
            const settings = await storage.getApiSettings(orgId);
            if (settings[`${prefix}token_expiry`]) {
              await storage.setApiSetting(orgId, `${prefix}token_expiry`, '0');
            } else {
              await storage.setApiSetting(orgId, 'microsoft_token_expiry', '0');
            }
            const freshToken = await getOutlookAccessToken(orgId, email);
            if (freshToken) {
              senderToken = freshToken;
              sendResult = await sendViaMicrosoftGraph(freshToken, recipient.accountEmail, subject, html);
            }
          }
        }

        if (sendResult.success) {
          sentThisBatch++;
          result.sent++;
          result.sendPairs.push({ from: email, to: (recipient as any).accountEmail, subject: subject.substring(0, 60), status: 'sent', timestamp: new Date().toISOString() });
          console.log(`[Warmup] Sent: ${email} → ${(recipient as any).accountEmail} (${subject.substring(0, 40)})`);

          // Small delay between sends (2-5 seconds)
          await new Promise(r => setTimeout(r, randomInt(2000, 5000)));
        } else {
          result.sendPairs.push({ from: email, to: (recipient as any).accountEmail, subject: subject.substring(0, 60), status: 'failed', timestamp: new Date().toISOString() });
          console.error(`[Warmup] Send failed ${email} → ${(recipient as any).accountEmail}: ${sendResult.error}`);
          result.errors.push(`Send fail: ${email} → ${(recipient as any).accountEmail}`);
        }
      }

      // Update sender account stats
      if (sentThisBatch > 0) {
        await storage.updateWarmupAccount(account.id, {
          currentDaily: alreadySent + sentThisBatch,
          totalSent: (account.totalSent || 0) + sentThisBatch,
          lastWarmupAt: new Date().toISOString(),
        });
      }
    }

    // ── Engagement phase: each account checks inbox and engages with received warmup emails ──
    // Small delay to let emails arrive
    await new Promise(r => setTimeout(r, 5000));

    for (const account of activeAccounts) {
      const email = account.accountEmail;
      const provider = (account.provider || '').toLowerCase();

      // Resolve token — try matching provider first, then both
      let recipientToken: string | null = null;
      let engageProvider: 'gmail' | 'outlook' | 'unknown' = 'unknown';
      if (provider === 'gmail' || provider === 'google') {
        recipientToken = await getGmailAccessToken(orgId, email);
        if (recipientToken) engageProvider = 'gmail';
      } else if (provider === 'outlook' || provider === 'microsoft') {
        recipientToken = await getOutlookAccessToken(orgId, email);
        if (recipientToken) engageProvider = 'outlook';
      } else {
        recipientToken = await getGmailAccessToken(orgId, email);
        if (recipientToken) { engageProvider = 'gmail'; }
        else {
          recipientToken = await getOutlookAccessToken(orgId, email);
          if (recipientToken) engageProvider = 'outlook';
        }
      }
      if (!recipientToken) continue;

      // Get senders (other accounts that may have sent to this one)
      const senders = activeAccounts.filter((a: any) => a.id !== account.id);
      let engagedCount = 0;
      let repliedCount = 0;
      let totalInbox = 0;
      let totalSpam = 0;
      let totalMovedFromSpam = 0;

      for (const sender of senders) {
        if (engageProvider === 'gmail') {
          const stats = await gmailEngage(recipientToken, sender.accountEmail);
          engagedCount += stats.opened;
          totalInbox += stats.inboxCount;
          totalSpam += stats.spamCount;
          totalMovedFromSpam += stats.movedFromSpam;

          // Auto-reply ~30% of the time. Reuse outer templates array — no need
          // to re-fetch from DB per (recipient × sender) pair.
          if (stats.opened > 0 && Math.random() < 0.3) {
            const template = randomPick(templates);
            const origSubject = (template as any).subject || 'Quick update';
            const replied = await gmailReply(recipientToken, email, sender.accountEmail, origSubject);
            if (replied) { repliedCount++; result.replied++; }
          }
        } else if (engageProvider === 'outlook') {
          const stats = await outlookEngage(recipientToken, sender.accountEmail);
          engagedCount += stats.opened;
          totalInbox += stats.inboxCount;
          totalSpam += stats.spamCount;
          totalMovedFromSpam += stats.movedFromSpam;

          if (stats.opened > 0 && Math.random() < 0.3) {
            const template = randomPick(templates);
            const origSubject = (template as any).subject || 'Quick update';
            const replied = await outlookReply(recipientToken, sender.accountEmail, origSubject);
            if (replied) { repliedCount++; result.replied++; }
          }
        }
      }

      result.received += engagedCount;
      result.opened += engagedCount;

      // Update recipient account stats with REAL inbox/spam data
      const totalFound = totalInbox + totalSpam;
      if (totalFound > 0 || engagedCount > 0 || repliedCount > 0) {
        const totalReceived = (account.totalReceived || 0) + engagedCount + totalMovedFromSpam;

        // Real inbox rate: based on actual placement detection
        let inboxRate = account.inboxRate || 0;
        if (totalFound > 0) {
          // Weighted: blend historical rate with today's detection
          const todayInboxRate = Math.round((totalInbox / totalFound) * 100);
          inboxRate = Math.round(inboxRate * 0.6 + todayInboxRate * 0.4); // 60% history, 40% today
        }

        // Real spam rate
        let spamRate = account.spamRate || 0;
        if (totalFound > 0) {
          const todaySpamRate = Math.round((totalSpam / totalFound) * 100);
          spamRate = Math.round(spamRate * 0.6 + todaySpamRate * 0.4);
        }

        // Reputation = inbox rate (70%) + reply engagement (20%) + activity (10%)
        const reputationScore = Math.min(100, Math.round(
          inboxRate * 0.7 +
          (repliedCount > 0 ? 20 : 0) +
          Math.min(10, engagedCount * 2)
        ));

        await storage.updateWarmupAccount(account.id, {
          totalReceived,
          inboxRate,
          spamRate,
          reputationScore,
        });

        if (totalSpam > 0) {
          console.log(`[Warmup] ${email}: ${totalInbox} inbox, ${totalSpam} spam (${totalMovedFromSpam} rescued), rate=${inboxRate}%`);
        }
      }
    }

    // ── Log daily stats with real inbox/spam counts ──
    // Per-account tracking for accurate logs
    for (const account of activeAccounts) {
      try {
        const existingLog = await storage.rawGet('SELECT * FROM warmup_logs WHERE "warmupAccountId" = ? AND date = ?', account.id, today) as any;

        // Re-fetch account to get latest stats
        const latest = await storage.getWarmupAccount(account.id) as any;

        // Build send pairs for this specific account (sent FROM this account)
        const accountPairs = result.sendPairs.filter(p => p.from === account.accountEmail);

        if (existingLog) {
          // Merge new pairs with existing pairs
          let existingPairs: SendPair[] = [];
          try { existingPairs = JSON.parse(existingLog.sendPairs || '[]'); } catch (e) { /* ignore */ }
          const mergedPairs = [...existingPairs, ...accountPairs];

          await storage.rawRun(`UPDATE warmup_logs SET sent = ?, received = received + ?,
            "inboxCount" = "inboxCount" + ?, "spamCount" = "spamCount" + ?,
            "openCount" = "openCount" + ?, "replyCount" = "replyCount" + ?,
            "sendPairs" = ? WHERE id = ?`,
            latest?.currentDaily || existingLog.sent,
            result.received > 0 ? 1 : 0,
            result.received > 0 ? 1 : 0, // inbox (after rescue)
            0, // spam count already rescued
            result.opened > 0 ? 1 : 0,
            result.replied > 0 ? 1 : 0,
            JSON.stringify(mergedPairs),
            existingLog.id
          );
        } else {
          await storage.addWarmupLog(account.id, today, {
            sent: latest?.currentDaily || 0,
            received: 0,
            inboxCount: 0,
            spamCount: 0,
            bounceCount: 0,
            openCount: 0,
            replyCount: 0,
            sendPairs: accountPairs,
          });
        }
      } catch (e) {
        // Log creation failed — non-critical
      }
    }

    console.log(`[Warmup] Org ${orgId} cycle done: sent=${result.sent}, received=${result.received}, opened=${result.opened}, replied=${result.replied}`);
  } catch (e) {
    console.error(`[Warmup] Org ${orgId} error:`, e instanceof Error ? e.message : e);
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

// ── Reset daily counters at midnight ────────────────────────────────────

async function resetDailyCounters() {
  try {
    await storage.rawRun('UPDATE warmup_accounts SET "currentDaily" = 0 WHERE status = ?', 'active');
    console.log('[Warmup] Daily counters reset');
  } catch (e) {
    console.error('[Warmup] Failed to reset daily counters:', e);
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────

let warmupInterval: ReturnType<typeof setInterval> | null = null;
let lastResetDay = new Date().getUTCDate();

export function startWarmupEngine() {
  if (warmupInterval) return;
  console.log('[Warmup] Starting warmup engine (every 30 min)...');

  // Always reset daily counters on startup (fixes stuck counters from failed resets)
  setTimeout(async () => {
    await resetDailyCounters();
    runWarmupCycle().catch(e => console.error('[Warmup] Initial cycle error:', e));
  }, 60000);

  // Then every 30 minutes
  warmupInterval = setInterval(async () => {
    // Check for daily reset
    const today = new Date().getUTCDate();
    if (today !== lastResetDay) {
      lastResetDay = today;
      await resetDailyCounters();
    }

    await runWarmupCycle().catch(e => console.error('[Warmup] Cycle error:', e));
  }, 30 * 60 * 1000);
}

export function stopWarmupEngine() {
  if (warmupInterval) {
    clearInterval(warmupInterval);
    warmupInterval = null;
    console.log('[Warmup] Warmup engine stopped');
  }
}

/** Manual trigger — run one cycle immediately */
export async function runWarmupNow(): Promise<WarmupRunResult[]> {
  console.log('[Warmup] Manual trigger — running warmup cycle now');
  return runWarmupCycle();
}

/** Run warmup for a specific org (called from the run-now API) */
export async function runOrgWarmupDirect(orgId: string): Promise<WarmupRunResult> {
  console.log(`[Warmup] Manual trigger for org ${orgId}`);
  return runOrgWarmup(orgId);
}
