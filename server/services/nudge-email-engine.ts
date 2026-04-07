import { storage } from '../storage';
import { OAuth2Client } from 'google-auth-library';

/**
 * Nudge Email Engine — Sends daily nudge digest emails to all team members.
 *
 * Schedule: 10:00 AM and 2:30 PM IST (Asia/Kolkata)
 * For each org, computes per-member nudges and sends a summary email
 * via the org's first active email account (Gmail API / Microsoft Graph / SMTP).
 */

const NUDGE_TIMEZONE = 'Asia/Kolkata';
const SEND_TIMES = [
  { hour: 10, minute: 0 },   // 10:00 AM IST
  { hour: 14, minute: 30 },  // 2:30 PM IST
];

// ── Token helpers (own copy — per CLAUDE.md, each engine has independent token helpers) ──

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
        console.error(`[NudgeEmail] Gmail token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
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
          console.error(`[NudgeEmail] Outlook token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return accessToken;
}

// ── Send helpers ──

async function sendViaGmailAPI(
  token: string, from: string, to: string, subject: string, html: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const raw = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${html}`;
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
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaMicrosoftGraph(
  token: string, to: string, subject: string, html: string
): Promise<{ success: boolean; error?: string }> {
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
        saveToSentItems: false, // Don't clutter Sent folder with nudges
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, error: `Graph API ${resp.status}: ${err}` };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Nudge computation ──

interface NudgeItem {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  count: number;
}

/**
 * Calculate the daily email target based on org age.
 * Starts at 2000, increases 25% daily, caps at 4000.
 */
function getDailyEmailTarget(orgCreatedAt: string): number {
  const created = new Date(orgCreatedAt);
  const now = new Date();
  const daysSinceCreation = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  // Start at 2000, increase 25% per day, cap at 4000
  const target = Math.min(4000, Math.floor(2000 * Math.pow(1.25, daysSinceCreation)));
  return target;
}

async function computeNudgesForMember(
  db: any, orgId: string, userId: string, orgCreatedAt: string
): Promise<NudgeItem[]> {
  const nudges: NudgeItem[] = [];
  const todayStr = new Date().toISOString().split('T')[0];
  const startDate = todayStr;
  const endDate = '9999-12-31';

  // 1. Email sending progress (target: ramping from 2000 to 4000)
  try {
    const emailsSent = (db.prepare(`
      SELECT COUNT(*) as cnt FROM messages m
      JOIN contacts c ON c.id = m.contactId
      WHERE c.organizationId = ? AND c.assignedTo = ? AND m.status = 'sent' AND m.sentAt >= ? AND m.sentAt < ?
    `).get(orgId, userId, startDate, endDate) as any)?.cnt || 0;

    const dailyTarget = getDailyEmailTarget(orgCreatedAt);
    const remaining = dailyTarget - emailsSent;
    const pct = Math.round((emailsSent / dailyTarget) * 100);

    if (emailsSent === 0) {
      nudges.push({ type: 'email_target', priority: 'high', title: `0/${dailyTarget} Emails Sent Today`, message: `You haven't sent any emails yet. Target: ${dailyTarget} emails today — get started!`, count: 0 });
    } else if (remaining > 0) {
      const priority = pct < 50 ? 'high' : 'medium';
      nudges.push({ type: 'email_target', priority, title: `${emailsSent}/${dailyTarget} Emails Sent (${pct}%)`, message: `${remaining} more emails to go to hit your daily target`, count: emailsSent });
    } else {
      nudges.push({ type: 'email_target', priority: 'low', title: `Target Hit! ${emailsSent}/${dailyTarget} Emails Sent`, message: `Great job — you've reached your daily email target!`, count: emailsSent });
    }
  } catch { }

  // 2. Newsletter sending (target: 2000/day)
  try {
    const newslettersSent = (db.prepare(`
      SELECT COUNT(*) as cnt FROM messages m
      JOIN campaigns camp ON camp.id = m.campaignId
      JOIN contacts c ON c.id = m.contactId
      WHERE c.organizationId = ? AND c.assignedTo = ? AND m.status = 'sent' AND m.sentAt >= ? AND m.sentAt < ?
      AND (LOWER(camp.name) LIKE '%newsletter%' OR camp.templateId IN (SELECT id FROM templates WHERE category = 'newsletter' AND organizationId = ?))
    `).get(orgId, userId, startDate, endDate, orgId) as any)?.cnt || 0;

    const nlTarget = 2000;
    const nlRemaining = nlTarget - newslettersSent;
    const nlPct = Math.round((newslettersSent / nlTarget) * 100);

    if (newslettersSent === 0) {
      nudges.push({ type: 'newsletter_target', priority: 'high', title: `0/${nlTarget} Newsletters Sent Today`, message: `No newsletters sent yet — your subscribers are waiting!`, count: 0 });
    } else if (nlRemaining > 0) {
      const priority = nlPct < 50 ? 'high' : 'medium';
      nudges.push({ type: 'newsletter_target', priority, title: `${newslettersSent}/${nlTarget} Newsletters (${nlPct}%)`, message: `${nlRemaining} more newsletters to reach your daily goal`, count: newslettersSent });
    } else {
      nudges.push({ type: 'newsletter_target', priority: 'low', title: `Newsletter Target Hit! ${newslettersSent}/${nlTarget}`, message: `All newsletters sent for today — well done!`, count: newslettersSent });
    }
  } catch { }

  // 3. Call progress (target: 20-30 calls/day)
  try {
    const callsMade = (db.prepare(`
      SELECT COUNT(*) as cnt FROM contact_activities
      WHERE organizationId = ? AND userId = ? AND type = 'call' AND createdAt >= ? AND createdAt < ?
    `).get(orgId, userId, startDate, endDate) as any)?.cnt || 0;

    const callTarget = 25; // midpoint of 20-30
    if (callsMade === 0) {
      nudges.push({ type: 'call_target', priority: 'high', title: 'No Calls Made Today', message: 'Target: 20-30 calls/day — start dialing to warm up your pipeline!', count: 0 });
    } else if (callsMade < 20) {
      nudges.push({ type: 'call_target', priority: 'high', title: `${callsMade}/20-30 Calls Made`, message: `${20 - callsMade} more calls to reach your minimum target`, count: callsMade });
    } else if (callsMade < 30) {
      nudges.push({ type: 'call_target', priority: 'medium', title: `${callsMade}/30 Calls Made — Almost There!`, message: `You've hit the minimum! ${30 - callsMade} more to hit the max target`, count: callsMade });
    } else {
      nudges.push({ type: 'call_target', priority: 'low', title: `${callsMade} Calls Made — Target Smashed!`, message: `You've exceeded the 20-30 call target — keep the momentum!`, count: callsMade });
    }
  } catch { }

  // 4. LinkedIn engagement (10 min/day reminder)
  try {
    const linkedinDone = (db.prepare(`
      SELECT COUNT(*) as cnt FROM contact_activities
      WHERE organizationId = ? AND userId = ? AND type = 'linkedin' AND createdAt >= ? AND createdAt < ?
    `).get(orgId, userId, startDate, endDate) as any)?.cnt || 0;

    if (linkedinDone === 0) {
      nudges.push({ type: 'linkedin_target', priority: 'medium', title: 'LinkedIn: 10 Min Engagement Pending', message: 'Spend 10 minutes connecting, commenting, and engaging on LinkedIn today', count: 0 });
    } else {
      nudges.push({ type: 'linkedin_target', priority: 'low', title: `${linkedinDone} LinkedIn Activities Logged`, message: 'Keep engaging on LinkedIn — consistency builds pipeline', count: linkedinDone });
    }
  } catch { }

  // 5. Overdue follow-ups
  try {
    const overdue = (db.prepare(`
      SELECT COUNT(*) as cnt FROM contacts
      WHERE organizationId = ? AND assignedTo = ? AND nextActionDate < ? AND nextActionDate IS NOT NULL
      AND pipelineStage NOT IN ('won', 'lost')
    `).get(orgId, userId, todayStr) as any)?.cnt || 0;
    if (overdue > 0) nudges.push({ type: 'overdue', priority: 'high', title: `${overdue} Overdue Follow-ups`, message: 'Contacts with past-due follow-up dates need attention', count: overdue });
  } catch { }

  // 6. Emails needing reply
  try {
    const needsReply = (db.prepare(`
      SELECT COUNT(*) as cnt FROM unified_inbox ui
      LEFT JOIN email_accounts ea ON ea.email = ui.toEmail AND ea.organizationId = ?
      WHERE ui.organizationId = ? AND (ui.assignedTo = ? OR ea.userId = ?)
      AND ui.status IN ('unread', 'read') AND ui.replyType IS NULL
      AND (ui.sentByUs IS NULL OR ui.sentByUs = 0)
    `).get(orgId, orgId, userId, userId) as any)?.cnt || 0;
    if (needsReply > 0) nudges.push({ type: 'needs_reply', priority: 'high', title: `${needsReply} Emails Need Reply`, message: 'Received emails that haven\'t been replied to yet', count: needsReply });
  } catch { }

  // 7. Stale hot leads (3+ days no activity)
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const stale = (db.prepare(`
      SELECT COUNT(*) as cnt FROM contacts
      WHERE organizationId = ? AND assignedTo = ?
      AND pipelineStage IN ('interested', 'meeting_scheduled', 'meeting_done')
      AND (lastActivityAt IS NULL OR lastActivityAt < ?)
    `).get(orgId, userId, threeDaysAgo.toISOString().split('T')[0]) as any)?.cnt || 0;
    if (stale > 0) nudges.push({ type: 'stale_leads', priority: 'medium', title: `${stale} Stale Hot Leads`, message: 'Hot leads with no activity in 3+ days — reach out before they go cold', count: stale });
  } catch { }

  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  nudges.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  return nudges;
}

// ── Email HTML builder ──

function buildNudgeEmailHtml(memberName: string, nudges: NudgeItem[], isMorning: boolean): string {
  const greeting = isMorning ? 'Good Morning' : 'Good Afternoon';
  const timeLabel = isMorning ? '10 AM Check-in' : '2:30 PM Check-in';

  const priorityColors: Record<string, { bg: string; border: string; dot: string }> = {
    high: { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444' },
    medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B' },
    low: { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E' },
  };

  const nudgeRows = nudges.map(n => {
    const c = priorityColors[n.priority] || priorityColors.medium;
    return `
      <tr>
        <td style="padding: 6px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 8px;">
            <tr>
              <td style="padding: 12px 16px;">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td style="width: 10px; vertical-align: top; padding-top: 5px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: ${c.dot};"></div>
                  </td>
                  <td style="padding-left: 12px;">
                    <div style="font-size: 14px; font-weight: 600; color: #1F2937;">${n.title}</div>
                    <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">${n.message}</div>
                  </td>
                </tr></table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #F3F4F6; padding: 20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background: linear-gradient(135deg, #2563EB, #7C3AED); padding: 24px 32px; color: white;">
            <div style="font-size: 20px; font-weight: 700;">${greeting}, ${memberName}!</div>
            <div style="font-size: 13px; opacity: 0.85; margin-top: 4px;">Your ${timeLabel} — Daily Activity Digest</div>
          </td>
        </tr>
        <!-- Nudges -->
        <tr>
          <td style="padding: 24px 32px;">
            <div style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 12px;">Action Items & Progress</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${nudgeRows}
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding: 16px 32px 24px; border-top: 1px solid #E5E7EB;">
            <div style="font-size: 11px; color: #9CA3AF; text-align: center;">
              Sent by AImailPilot — Your daily activity nudge
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Send nudge email to a single member ──

async function sendNudgeToMember(
  orgId: string,
  memberEmail: string,
  memberName: string,
  nudges: NudgeItem[],
  isMorning: boolean,
  senderAccount: any
): Promise<boolean> {
  if (nudges.length === 0) return false;

  const subject = isMorning
    ? `Your Morning Check-in — ${nudges.filter(n => n.priority === 'high').length} urgent items`
    : `Afternoon Update — ${nudges.filter(n => n.priority === 'high').length} items need attention`;

  const html = buildNudgeEmailHtml(memberName, nudges, isMorning);
  const provider = senderAccount.provider || '';
  const fromEmail = senderAccount.email || '';

  try {
    if (provider === 'gmail' || provider === 'google') {
      const token = await getGmailAccessToken(orgId, fromEmail);
      if (token) {
        const result = await sendViaGmailAPI(token, fromEmail, memberEmail, subject, html);
        if (result.success) return true;
        console.error(`[NudgeEmail] Gmail send failed for ${memberEmail}:`, result.error);
      }
    } else if (provider === 'outlook' || provider === 'microsoft') {
      const token = await getOutlookAccessToken(orgId, fromEmail);
      if (token) {
        const result = await sendViaMicrosoftGraph(token, memberEmail, subject, html);
        if (result.success) return true;
        console.error(`[NudgeEmail] Outlook send failed for ${memberEmail}:`, result.error);
      }
    }
    // SMTP fallback if account has smtp config
    if (senderAccount.smtpConfig) {
      const smtpConfig = typeof senderAccount.smtpConfig === 'string'
        ? JSON.parse(senderAccount.smtpConfig)
        : senderAccount.smtpConfig;
      const { smtpEmailService } = await import('./smtp-email-service');
      const result = await smtpEmailService.sendEmail(senderAccount.id, smtpConfig, {
        to: memberEmail, subject, html,
      });
      if (result.success) return true;
      console.error(`[NudgeEmail] SMTP send failed for ${memberEmail}:`, result.error);
    }
  } catch (e) {
    console.error(`[NudgeEmail] Error sending to ${memberEmail}:`, e instanceof Error ? e.message : e);
  }
  return false;
}

// ── Main engine loop ──

async function sendNudgesForAllOrgs(isMorning: boolean) {
  console.log(`[NudgeEmail] Starting ${isMorning ? 'morning' : 'afternoon'} nudge email run...`);
  const db = (storage as any).db;

  try {
    // Get all orgs (limit 500 to be safe)
    const orgs = db.prepare('SELECT * FROM organizations WHERE id != ?').all('superadmin') as any[];

    for (const org of orgs) {
      try {
        // Get first active email account for sending
        const accounts = db.prepare(
          'SELECT * FROM email_accounts WHERE organizationId = ? AND isActive = 1 ORDER BY createdAt ASC LIMIT 1'
        ).all(org.id) as any[];
        if (accounts.length === 0) {
          console.log(`[NudgeEmail] Org ${org.name}: no active email account, skipping`);
          continue;
        }
        const senderAccount = accounts[0];
        // Parse smtpConfig if string
        if (typeof senderAccount.smtpConfig === 'string') {
          try { senderAccount.smtpConfig = JSON.parse(senderAccount.smtpConfig); } catch { }
        }

        // Get all org members
        const members = await storage.getOrgMembers(org.id) as any[];

        for (const member of members) {
          try {
            const memberName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;
            const nudges = await computeNudgesForMember(db, org.id, member.userId, org.createdAt);
            if (nudges.length > 0) {
              const sent = await sendNudgeToMember(org.id, member.email, memberName, nudges, isMorning, senderAccount);
              if (sent) {
                console.log(`[NudgeEmail] Sent ${isMorning ? 'morning' : 'afternoon'} nudge to ${member.email} (${nudges.length} items)`);
              }
            }
          } catch (e) {
            console.error(`[NudgeEmail] Error for member ${member.email}:`, e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.error(`[NudgeEmail] Error for org ${org.name}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error(`[NudgeEmail] Fatal error:`, e instanceof Error ? e.message : e);
  }
  console.log(`[NudgeEmail] ${isMorning ? 'Morning' : 'Afternoon'} nudge run complete.`);
}

// ── Scheduler ──

function getNextSendTime(): { delay: number; isMorning: boolean } {
  const now = new Date();
  // Convert to IST
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: NUDGE_TIMEZONE }));
  const istHour = istNow.getHours();
  const istMinute = istNow.getMinutes();
  const currentMinutes = istHour * 60 + istMinute;

  // Find next send time
  const sendMinutes = SEND_TIMES.map(t => t.hour * 60 + t.minute);

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (let i = 0; i < sendMinutes.length; i++) {
      let targetMinutes = sendMinutes[i] + dayOffset * 1440;
      if (targetMinutes > currentMinutes || (dayOffset === 0 && targetMinutes === currentMinutes)) {
        // Compute actual delay in ms
        const diffMinutes = targetMinutes - currentMinutes;
        return { delay: diffMinutes * 60 * 1000, isMorning: i === 0 };
      }
    }
  }

  // Fallback: next day 10 AM
  const diffMinutes = (1440 - currentMinutes) + sendMinutes[0];
  return { delay: diffMinutes * 60 * 1000, isMorning: true };
}

let nudgeTimer: NodeJS.Timeout | null = null;

function scheduleNextNudge() {
  const { delay, isMorning } = getNextSendTime();
  const nextTime = new Date(Date.now() + delay);
  console.log(`[NudgeEmail] Next nudge email scheduled at ${nextTime.toISOString()} (${isMorning ? 'morning' : 'afternoon'})`);

  nudgeTimer = setTimeout(async () => {
    try {
      await sendNudgesForAllOrgs(isMorning);
    } catch (e) {
      console.error('[NudgeEmail] Scheduler error:', e);
    }
    // Schedule the next one
    scheduleNextNudge();
  }, delay);
}

export function startNudgeEmailEngine() {
  console.log('[NudgeEmail] Starting nudge email engine (10:00 AM & 2:30 PM IST)');
  scheduleNextNudge();
}

export function stopNudgeEmailEngine() {
  if (nudgeTimer) {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    console.log('[NudgeEmail] Nudge email engine stopped');
  }
}
