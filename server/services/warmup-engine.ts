import { storage } from "../storage";
import { OAuth2Client } from 'google-auth-library';

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

  // Refresh if expired (5-min buffer)
  if (tokenExpiry && Date.now() > parseInt(tokenExpiry) - 300000) {
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
        console.error(`[Warmup] Gmail token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
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
          console.error(`[Warmup] Outlook token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
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
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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

// ── Engagement Actions ──────────────────────────────────────────────────

/** Gmail: star + mark important + mark as read on recent messages from sender */
async function gmailEngage(token: string, fromEmail: string): Promise<{ opened: number; starred: number; important: number }> {
  const stats = { opened: 0, starred: 0, important: 0 };
  try {
    // Search for recent unread messages from the sender
    const q = encodeURIComponent(`from:${fromEmail} is:unread newer_than:1d`);
    const listResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listResp.ok) return stats;
    const listData = await listResp.json() as any;
    const messages = listData.messages || [];
    if (messages.length === 0) return stats;

    for (const msg of messages) {
      // Mark as read (remove UNREAD) + star (add STARRED) + mark important (add IMPORTANT)
      const modResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addLabelIds: ['STARRED', 'IMPORTANT'],
            removeLabelIds: ['UNREAD'],
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

/** Outlook: mark as read + flag on recent messages from sender */
async function outlookEngage(token: string, fromEmail: string): Promise<{ opened: number; flagged: number }> {
  const stats = { opened: 0, flagged: 0 };
  try {
    // Get recent unread messages from the sender
    const filter = encodeURIComponent(`from/emailAddress/address eq '${fromEmail}' and isRead eq false`);
    const listResp = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$top=10&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listResp.ok) return stats;
    const listData = await listResp.json() as any;
    const messages = listData.value || [];

    for (const msg of messages) {
      // Mark as read + flag
      const patchResp = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isRead: true,
            flag: { flagStatus: 'flagged' },
          }),
        }
      );
      if (patchResp.ok) {
        stats.opened++;
        stats.flagged++;
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

interface WarmupRunResult {
  orgId: string;
  sent: number;
  received: number;
  opened: number;
  replied: number;
  errors: string[];
}

async function runWarmupCycle(): Promise<WarmupRunResult[]> {
  const results: WarmupRunResult[] = [];

  try {
    // Get all organizations that have warmup accounts
    const db = (storage as any).db;
    const orgs = db.prepare('SELECT DISTINCT organizationId FROM warmup_accounts WHERE status = ?').all('active') as any[];

    for (const { organizationId: orgId } of orgs) {
      const result = await runOrgWarmup(orgId);
      results.push(result);
    }
  } catch (e) {
    console.error('[Warmup] Cycle error:', e instanceof Error ? e.message : e);
  }

  return results;
}

async function runOrgWarmup(orgId: string): Promise<WarmupRunResult> {
  const result: WarmupRunResult = { orgId, sent: 0, received: 0, opened: 0, replied: 0, errors: [] };
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get active warmup accounts with email/provider info
    const warmupAccounts = await storage.getWarmupAccounts(orgId);
    const activeAccounts = warmupAccounts.filter((a: any) => a.status === 'active');

    if (activeAccounts.length < 2) {
      console.log(`[Warmup] Org ${orgId}: need at least 2 active warmup accounts, have ${activeAccounts.length}`);
      return result;
    }

    // Get real templates from org
    const templates = await storage.getEmailTemplates(orgId);
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

      // Get sender token
      let senderToken: string | null = null;
      if (isGmail) {
        senderToken = await getGmailAccessToken(orgId, email);
      } else if (isOutlook) {
        senderToken = await getOutlookAccessToken(orgId, email);
      }

      if (!senderToken) {
        console.log(`[Warmup] No token for ${email}, skipping`);
        result.errors.push(`No token: ${email}`);
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

        // Send email
        let sendResult: { success: boolean; messageId?: string; error?: string };
        if (isGmail) {
          sendResult = await sendViaGmailAPI(senderToken, email, recipient.accountEmail, subject, html);
        } else {
          sendResult = await sendViaMicrosoftGraph(senderToken, recipient.accountEmail, subject, html);
        }

        if (sendResult.success) {
          sentThisBatch++;
          result.sent++;
          console.log(`[Warmup] Sent: ${email} → ${recipient.accountEmail} (${subject.substring(0, 40)})`);

          // Small delay between sends (2-5 seconds)
          await new Promise(r => setTimeout(r, randomInt(2000, 5000)));
        } else {
          console.error(`[Warmup] Send failed ${email} → ${recipient.accountEmail}: ${sendResult.error}`);
          result.errors.push(`Send fail: ${email} → ${recipient.accountEmail}`);
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
      const isGmail = provider === 'gmail' || provider === 'google';
      const isOutlook = provider === 'outlook' || provider === 'microsoft';

      let recipientToken: string | null = null;
      if (isGmail) {
        recipientToken = await getGmailAccessToken(orgId, email);
      } else if (isOutlook) {
        recipientToken = await getOutlookAccessToken(orgId, email);
      }
      if (!recipientToken) continue;

      // Get senders (other accounts that may have sent to this one)
      const senders = activeAccounts.filter((a: any) => a.id !== account.id);
      let engagedCount = 0;
      let repliedCount = 0;

      for (const sender of senders) {
        if (isGmail) {
          const stats = await gmailEngage(recipientToken, sender.accountEmail);
          engagedCount += stats.opened;

          // Auto-reply ~30% of the time
          if (stats.opened > 0 && Math.random() < 0.3) {
            const template = randomPick(await storage.getEmailTemplates(orgId));
            const origSubject = (template as any).subject || 'Quick update';
            const replied = await gmailReply(recipientToken, email, sender.accountEmail, origSubject);
            if (replied) { repliedCount++; result.replied++; }
          }
        } else if (isOutlook) {
          const stats = await outlookEngage(recipientToken, sender.accountEmail);
          engagedCount += stats.opened;

          if (stats.opened > 0 && Math.random() < 0.3) {
            const template = randomPick(await storage.getEmailTemplates(orgId));
            const origSubject = (template as any).subject || 'Quick update';
            const replied = await outlookReply(recipientToken, sender.accountEmail, origSubject);
            if (replied) { repliedCount++; result.replied++; }
          }
        }
      }

      result.received += engagedCount;
      result.opened += engagedCount;

      // Update recipient account stats
      if (engagedCount > 0 || repliedCount > 0) {
        const totalReceived = (account.totalReceived || 0) + engagedCount;
        const totalSent = account.totalSent || 0;
        // Calculate inbox rate (received/sent ratio capped at 100)
        const inboxRate = totalSent > 0 ? Math.min(100, Math.round((totalReceived / totalSent) * 100)) : 0;
        // Reputation score: combination of inbox rate and engagement
        const reputationScore = Math.min(100, Math.round(inboxRate * 0.7 + (repliedCount > 0 ? 20 : 0) + Math.min(10, engagedCount * 2)));

        await storage.updateWarmupAccount(account.id, {
          totalReceived,
          inboxRate,
          reputationScore: Math.max(account.reputationScore || 50, reputationScore),
        });
      }
    }

    // ── Log daily stats ──
    for (const account of activeAccounts) {
      try {
        // Upsert: check if today's log exists
        const db = (storage as any).db;
        const existingLog = db.prepare('SELECT * FROM warmup_logs WHERE warmupAccountId = ? AND date = ?').get(account.id, today) as any;

        if (existingLog) {
          // Update existing log
          db.prepare('UPDATE warmup_logs SET sent = sent + ?, received = received + ?, openCount = openCount + ?, replyCount = replyCount + ? WHERE id = ?').run(
            result.sent > 0 ? 1 : 0, // approximate per-account
            result.received > 0 ? 1 : 0,
            result.opened > 0 ? 1 : 0,
            result.replied > 0 ? 1 : 0,
            existingLog.id
          );
        } else {
          await storage.addWarmupLog(account.id, today, {
            sent: account.currentDaily || 0,
            received: 0,
            inboxCount: 0,
            spamCount: 0,
            bounceCount: 0,
            openCount: 0,
            replyCount: 0,
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
    const db = (storage as any).db;
    db.prepare('UPDATE warmup_accounts SET currentDaily = 0 WHERE status = ?').run('active');
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

  // Run first cycle after 60s delay (let server fully start)
  setTimeout(() => {
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
