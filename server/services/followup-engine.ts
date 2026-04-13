import { storage } from "../storage";
import { smtpEmailService } from "./smtp-email-service";
import { OAuth2Client } from 'google-auth-library';

/**
 * RFC 2047 encode a subject line for MIME headers.
 * Non-ASCII subjects must be encoded as =?UTF-8?B?<base64>?= for email headers.
 */
function mimeEncodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject; // All ASCII — no encoding needed
  return '=?UTF-8?B?' + Buffer.from(subject, 'utf-8').toString('base64') + '?=';
}

// Simple email interface since we need to integrate with existing email providers
interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
  // Threading support: reply in same thread as original email
  threadId?: string;       // Gmail thread ID to reply in
  inReplyTo?: string;      // Message-ID of the original email
  references?: string;     // References header for threading
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  internetMessageId?: string;
  error?: string;
}

/**
 * Send email via Gmail API using OAuth access token.
 */
async function sendViaGmailAPI(
  accessToken: string,
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string>; threadId?: string }
): Promise<EmailResult> {
  try {
    let raw = '';
    raw += `From: ${opts.from}\r\n`;
    raw += `To: ${opts.to}\r\n`;
    raw += `Subject: ${opts.subject}\r\n`;
    raw += `MIME-Version: 1.0\r\n`;
    raw += `Content-Type: text/html; charset="UTF-8"\r\n`;
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        raw += `${k}: ${v}\r\n`;
      }
    }
    raw += `\r\n`;
    raw += opts.html;

    const base64 = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Include threadId if provided — this tells Gmail to place the reply in the same thread
    const payload: any = { raw: base64 };
    if (opts.threadId) {
      payload.threadId = opts.threadId;
    }

    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Gmail API error (${resp.status}): ${errText}` };
    }

    const data = await resp.json() as any;
    return { success: true, messageId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

class EmailService {
  /**
   * Get a valid Gmail access token for a specific sender email.
   * Tries per-sender token first, then falls back to org-level token.
   * Refreshes expired tokens automatically.
   * Public so executeFollowup can also use it for threading.
   */
  async getGmailAccessToken(orgId: string, senderEmail?: string): Promise<{ token: string; email: string } | null> {
    const settings = await storage.getApiSettings(orgId);
    
    // Try per-sender token first (e.g., gmail_sender_bharatai5@aegis.edu.in_access_token)
    const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
    let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
    let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
    let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
    let resolvedEmail = senderEmail || '';
    
    // Fall back to org-level tokens
    if (!accessToken && !refreshToken) {
      accessToken = settings.gmail_access_token;
      refreshToken = settings.gmail_refresh_token;
      tokenExpiry = settings.gmail_token_expiry;
      resolvedEmail = settings.gmail_user_email || '';
    }
    
    if (!accessToken && !refreshToken) return null;

    // Get OAuth client credentials
    let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID;
    let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET;
    
    // Fallback to superadmin org for OAuth credentials
    if (!clientId || !clientSecret) {
      try {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId && superAdminOrgId !== orgId) {
          const superSettings = await storage.getApiSettings(superAdminOrgId);
          if (superSettings.google_oauth_client_id) {
            clientId = superSettings.google_oauth_client_id;
            clientSecret = superSettings.google_oauth_client_secret || '';
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Refresh token if expired (5-minute buffer) or if no expiry recorded (treat as expired)
    const expiry = parseInt(tokenExpiry || '0');
    if (!tokenExpiry || Date.now() > expiry - 300000) {
      if (refreshToken && clientId && clientSecret) {
        try {
          const oauth2Client = new OAuth2Client(clientId, clientSecret);
          oauth2Client.setCredentials({ refresh_token: refreshToken });
          const { credentials } = await oauth2Client.refreshAccessToken();
          if (credentials.access_token) {
            accessToken = credentials.access_token;
            // Store refreshed token back
            if (senderEmail && settings[`${senderPrefix}refresh_token`]) {
              await storage.setApiSetting(orgId, `${senderPrefix}access_token`, accessToken);
              if (credentials.expiry_date) await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(credentials.expiry_date));
            } else {
              await storage.setApiSetting(orgId, 'gmail_access_token', accessToken);
              if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
            }
          }
        } catch (e) {
          console.error(`[Followup] Token refresh failed for ${senderEmail || 'org-default'}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    return accessToken ? { token: accessToken, email: resolvedEmail } : null;
  }

  /**
   * Get a valid Microsoft/Outlook access token for a specific sender email.
   * Mirrors getGmailAccessToken but for Microsoft Graph API.
   */
  async getOutlookAccessToken(orgId: string, senderEmail?: string): Promise<{ token: string; email: string } | null> {
    const settings = await storage.getApiSettings(orgId);

    const senderPrefix = senderEmail ? `outlook_sender_${senderEmail}_` : '';
    let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
    let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
    let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;

    // Fall back to org-level tokens
    if (!accessToken && !refreshToken) {
      accessToken = settings.microsoft_access_token;
      refreshToken = settings.microsoft_refresh_token;
      tokenExpiry = settings.microsoft_token_expiry;
    }

    if (!accessToken && !refreshToken) return null;

    const resolvedEmail = senderEmail || settings.microsoft_user_email || '';

    // Refresh token if expired (5-minute buffer)
    const expiry = parseInt(tokenExpiry || '0');
    if (!accessToken || Date.now() > expiry - 300000) {
      if (refreshToken) {
        let clientId = settings.microsoft_oauth_client_id || '';
        let clientSecret = settings.microsoft_oauth_client_secret || '';
        if (!clientId || !clientSecret) {
          try {
            const superAdminOrgId = await storage.getSuperAdminOrgId();
            if (superAdminOrgId && superAdminOrgId !== orgId) {
              const superSettings = await storage.getApiSettings(superAdminOrgId);
              if (superSettings.microsoft_oauth_client_id) {
                clientId = superSettings.microsoft_oauth_client_id;
                clientSecret = superSettings.microsoft_oauth_client_secret || '';
              }
            }
          } catch (e) { /* ignore */ }
        }
        if (!clientId) clientId = process.env.MICROSOFT_CLIENT_ID || '';
        if (!clientSecret) clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

        if (clientId && clientSecret) {
          try {
            const body = new URLSearchParams({
              client_id: clientId, client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: 'refresh_token',
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
                if (senderEmail && settings[`${senderPrefix}refresh_token`]) {
                  await storage.setApiSetting(orgId, `${senderPrefix}access_token`, accessToken);
                  if (tokens.refresh_token) await storage.setApiSetting(orgId, `${senderPrefix}refresh_token`, tokens.refresh_token);
                  await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(exp));
                } else {
                  await storage.setApiSetting(orgId, 'microsoft_access_token', accessToken);
                  if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
                  await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
                }
              }
            }
          } catch (e) {
            console.error(`[Followup] Microsoft token refresh failed for ${senderEmail || 'org-default'}:`, e instanceof Error ? e.message : e);
          }
        }
      }
    }

    return accessToken ? { token: accessToken, email: resolvedEmail } : null;
  }

  async sendEmail(emailAccountId: string, message: EmailMessage, orgId?: string): Promise<EmailResult> {
    try {
      // Determine the actual sending email address, display name, and provider from the email account
      let senderEmail: string | undefined;
      let accountProvider: string | undefined;
      let senderDisplayName: string | undefined;
      try {
        const emailAccount = await storage.getEmailAccount(emailAccountId);
        if (emailAccount?.email) {
          senderEmail = emailAccount.email;
        }
        if ((emailAccount as any)?.provider) {
          accountProvider = (emailAccount as any).provider;
        }
        // Get display name: smtpConfig.fromName > displayName > undefined
        const smtpConf = emailAccount?.smtpConfig as any;
        senderDisplayName = smtpConf?.fromName || (emailAccount as any)?.displayName || undefined;
      } catch (e) { /* ignore */ }

      // Route to the correct provider based on the email account's provider
      const isOutlook = accountProvider === 'outlook' || accountProvider === 'microsoft';
      const isGmail = accountProvider === 'gmail' || accountProvider === 'google';

      // For Outlook/Microsoft accounts: use Microsoft Graph API
      if (isOutlook && orgId) {
        const tokenResult = await this.getOutlookAccessToken(orgId, senderEmail);
        if (tokenResult) {
          const fromEmail = senderEmail || tokenResult.email || '';
          console.log(`[Followup] Sending follow-up via Microsoft Graph to ${message.to} from ${fromEmail}${message.inReplyTo ? ' (threaded)' : ''}`);

          // Use draft-then-send so internetMessageHeaders (In-Reply-To/References) are reliably accepted
          // and the new message's internetMessageId is captured for downstream follow-up steps.
          // One-shot /me/sendMail rejects custom headers on many personal accounts AND returns no message id.
          const baseMessage: any = {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
          };

          const threadingHeaders: { name: string; value: string }[] = [];
          if (message.inReplyTo) threadingHeaders.push({ name: 'In-Reply-To', value: message.inReplyTo });
          if (message.references) threadingHeaders.push({ name: 'References', value: message.references });

          const createDraft = async (withHeaders: boolean) => {
            const msg = (withHeaders && threadingHeaders.length > 0)
              ? { ...baseMessage, internetMessageHeaders: threadingHeaders }
              : baseMessage;
            const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tokenResult.token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(msg),
            });
            if (r.ok) return { ok: true as const, data: await r.json() as any };
            return { ok: false as const, status: r.status, err: await r.text() };
          };

          // Attempt 1: draft with threading headers
          let draft = await createDraft(true);
          if (!draft.ok) {
            if (draft.status === 401 || draft.status === 403) {
              console.error(`[Followup] Microsoft Graph auth error creating draft: ${draft.status} ${draft.err}`);
              // Fall through to SMTP fallback below
            } else if (threadingHeaders.length > 0) {
              // Attempt 2: draft without threading headers (rare — most personal accounts accept headers on drafts)
              console.log(`[Followup] Graph draft create with threading headers failed (${draft.status}), retrying without for ${message.to}`);
              draft = await createDraft(false);
            }
          }

          if (draft.ok) {
            const draftId: string | undefined = draft.data?.id;
            const internetMessageId: string | undefined = draft.data?.internetMessageId;
            if (draftId) {
              const sendResp = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/send`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tokenResult.token}` },
              });
              if (sendResp.ok) {
                return { success: true, messageId: draftId, internetMessageId };
              }
              const sendErr = await sendResp.text();
              console.error(`[Followup] Microsoft Graph draft send failed: ${sendResp.status} ${sendErr}`);
              // Best-effort: delete the orphan draft
              try {
                await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${tokenResult.token}` },
                });
              } catch { /* ignore */ }
              // Fall through to SMTP fallback below
            }
          } else if (!draft.ok) {
            console.error(`[Followup] Microsoft Graph draft create failed: ${draft.status} ${draft.err}`);
          }
          // Fall through to SMTP fallback below
        }
      }

      // For Gmail accounts: use Gmail API
      if (isGmail && orgId) {
        const tokenResult = await this.getGmailAccessToken(orgId, senderEmail);

        if (tokenResult) {
          const fromEmail = senderEmail || tokenResult.email || '';
          const fromFormatted = senderDisplayName ? `${senderDisplayName} <${fromEmail}>` : fromEmail;
          console.log(`[Followup] Sending follow-up via Gmail API to ${message.to} from ${fromFormatted}${message.threadId ? ' (thread: ' + message.threadId + ')' : ''}`);

          // Build threading headers for in-reply-to
          const headers: Record<string, string> = {};
          if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
          if (message.references) headers['References'] = message.references;

          const gmailOpts = {
            from: fromFormatted,
            to: message.to,
            subject: mimeEncodeSubject(message.subject),
            html: message.html,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            threadId: message.threadId,
          };
          const result = await sendViaGmailAPI(tokenResult.token, gmailOpts);
          if (result.success) return result;

          // If 401 (expired token), force-refresh and retry once — do NOT fall through to SMTP
          // SMTP has no threadId support and will break Gmail threading
          if (result.error?.includes('401')) {
            console.log(`[Followup] Gmail API 401 for ${fromEmail}, force-refreshing token and retrying...`);
            // Clear token expiry to force a refresh
            const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
            try {
              if (senderEmail) {
                await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, '0');
              } else {
                await storage.setApiSetting(orgId, 'gmail_token_expiry', '0');
              }
            } catch (e) { /* ignore */ }
            const retryToken = await this.getGmailAccessToken(orgId, senderEmail);
            if (retryToken && retryToken.token !== tokenResult.token) {
              console.log(`[Followup] Token refreshed, retrying Gmail API for ${message.to}${message.threadId ? ' (thread: ' + message.threadId + ')' : ''}`);
              const retryResult = await sendViaGmailAPI(retryToken.token, gmailOpts);
              if (retryResult.success) return retryResult;
              console.log(`[Followup] Gmail API retry also failed: ${retryResult.error}`);
            }
          }
          console.log(`[Followup] Gmail API failed, trying SMTP: ${result.error}`);
        }
      }

      // For unknown provider or API failure: try OAuth API based on available tokens
      if (!isOutlook && !isGmail && orgId) {
        // Try Gmail if tokens exist
        const gmailToken = await this.getGmailAccessToken(orgId, senderEmail);
        if (gmailToken) {
          const fromEmail = senderEmail || gmailToken.email || '';
          const fromFormatted = senderDisplayName ? `${senderDisplayName} <${fromEmail}>` : fromEmail;
          const headers: Record<string, string> = {};
          if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
          if (message.references) headers['References'] = message.references;
          const result = await sendViaGmailAPI(gmailToken.token, {
            from: fromFormatted, to: message.to, subject: mimeEncodeSubject(message.subject), html: message.html,
            headers: Object.keys(headers).length > 0 ? headers : undefined, threadId: message.threadId,
          });
          if (result.success) return result;
        }
      }

      // Try SMTP as fallback (include threading headers so replies still thread in non-Gmail clients)
      const account = await storage.getEmailAccount(emailAccountId);
      if (account?.smtpConfig) {
        console.log(`[Followup] Sending email via SMTP account ${emailAccountId} to ${message.to}${message.threadId ? ' (WARNING: SMTP cannot use Gmail threadId — threading may break)' : ''}`);
        const smtpHeaders: Record<string, string> = {};
        if (message.inReplyTo) smtpHeaders['In-Reply-To'] = message.inReplyTo;
        if (message.references) smtpHeaders['References'] = message.references;
        const result = await smtpEmailService.sendEmail(emailAccountId, account.smtpConfig, {
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text || message.html.replace(/<[^>]*>/g, ''),
          headers: Object.keys(smtpHeaders).length > 0 ? smtpHeaders : undefined,
        });
        return {
          success: result.success,
          messageId: result.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          error: result.error,
        };
      }

      // Fallback: log and simulate if no sending method available
      console.log(`[Followup] No email sending method for account ${emailAccountId}, simulating send to ${message.to}`);
      return {
        success: true,
        messageId: `followup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export interface FollowupTriggerData {
  campaignMessageId: string;
  contactId: string;
  triggerType: "no_reply" | "no_open" | "no_click" | "opened" | "clicked" | "replied" | "bounced" | "time_delay";
  metadata?: Record<string, any>;
}

export class FollowupEngine {
  private emailService: EmailService;
  private _checkCount: number = 0;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Process all pending follow-up triggers
   */
  async processFollowupTriggers(): Promise<void> {
    try {
      // P10 SAFETY NET: Reset executions stuck in 'processing' for >5 min (crash/timeout recovery)
      try {
        await storage.rawRun(
          `UPDATE followup_executions SET status = 'pending' WHERE status = 'processing' AND "scheduledAt" < ?`,
          new Date(Date.now() - 5 * 60 * 1000).toISOString()
        );
      } catch (e) { /* non-critical */ }

      // Get all campaigns with active follow-up sequences
      const activeCampaignFollowups = await storage.getActiveCampaignFollowups();
      
      // Only log occasionally to avoid spamming (every 10th check, ~every 5 min)
      this._checkCount = (this._checkCount || 0) + 1;
      if (activeCampaignFollowups.length > 0 && this._checkCount % 10 === 1) {
        console.log(`[Followup] Processing ${activeCampaignFollowups.length} active campaign follow-up configurations...`);
      }
      
      for (const campaignFollowup of activeCampaignFollowups) {
        await this.processCampaignFollowups(campaignFollowup.campaignId, campaignFollowup.sequenceId);
      }
      
      // Process time-based triggers (pending executions)
      await this.processScheduledFollowups();

      // Check if any 'following_up' campaigns are fully complete
      // (all follow-up executions are sent/skipped/failed, none pending)
      await this.checkFollowupCompletion(activeCampaignFollowups);
    } catch (error) {
      console.error("[Followup] Error processing follow-up triggers:", error);
    }
  }

  /**
   * Check if campaigns in 'following_up' status have completed all follow-up steps
   * and mark them as 'completed' when done.
   */
  private async checkFollowupCompletion(activeCampaignFollowups: any[]): Promise<void> {
    const checkedCampaigns = new Set<string>();
    
    for (const cf of activeCampaignFollowups) {
      const campaignId = cf.campaignId;
      if (checkedCampaigns.has(campaignId)) continue;
      checkedCampaigns.add(campaignId);

      const campaign = await storage.getCampaign(campaignId);
      if (!campaign || campaign.status !== 'following_up') continue;

      // PERFORMANCE FIX #4: Count step-0 messages via targeted query (not 50k fetch)
      const step0CountRow = await storage.rawGet(
        'SELECT COUNT(*) as cnt FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL)',
        campaignId
      );
      const step0Count = parseInt(step0CountRow?.cnt || '0');
      if (step0Count === 0) continue;

      // P8 FIX: Aggregate follow-up steps across ALL sequences for this campaign (not just one)
      // Each campaign can have multiple sequences (one per follow-up step), so we need total across all
      const allCampaignFollowups = await storage.getCampaignFollowups(campaignId);
      let totalFollowupSteps = 0;
      for (const cfLink of allCampaignFollowups) {
        const steps = await storage.getFollowupSteps((cfLink as any).sequenceId);
        totalFollowupSteps += steps.length;
      }
      if (totalFollowupSteps === 0) continue;

      // Count how many executions exist vs how many should exist
      const executions = await storage.getFollowupExecutionsByCampaign(campaignId);
      const totalExpected = step0Count * totalFollowupSteps;
      const totalDone = executions.filter((e: any) =>
        e.status === 'sent' || e.status === 'skipped' || e.status === 'failed'
      ).length;
      const totalPending = executions.filter((e: any) => e.status === 'pending' || e.status === 'processing').length;

      if (totalDone >= totalExpected && totalPending === 0) {
        await storage.updateCampaign(campaignId, { status: 'completed' });
        console.log(`[Followup] Campaign ${campaignId} (${campaign.name}): All ${totalDone}/${totalExpected} follow-up executions complete (${totalFollowupSteps} steps × ${step0Count} contacts). Marking campaign as completed.`);
      }
    }
  }

  /**
   * Check if current time is within the campaign's allowed sending window.
   * Returns { canSend: true } or { canSend: false, reason: string }
   */
  private checkSendingWindow(sendingConfig: any): { canSend: boolean; reason?: string } {
    if (!sendingConfig?.autopilot?.enabled) return { canSend: true };

    const autopilot = sendingConfig.autopilot;
    // Prefer IANA timezone (DST-aware), fallback to numeric offset
    let userLocal: Date;
    if (sendingConfig.timezone) {
      try {
        const nowUtc = new Date();
        const localStr = nowUtc.toLocaleString('en-US', { timeZone: sendingConfig.timezone });
        userLocal = new Date(localStr);
      } catch (e) {
        // Invalid timezone — fall through to offset
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        userLocal = new Date(utcMs - (sendingConfig.timezoneOffset || 0) * 60000);
      }
    } else {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      userLocal = new Date(utcMs - (sendingConfig.timezoneOffset || 0) * 60000);
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[userLocal.getDay()];
    const dayConfig = autopilot.days?.[dayName];

    if (!dayConfig || !dayConfig.enabled) {
      return { canSend: false, reason: `Sending disabled on ${dayName}` };
    }

    const currentHH = String(userLocal.getHours()).padStart(2, '0');
    const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHH}:${currentMM}`;

    if (dayConfig.startTime && currentTime < dayConfig.startTime) {
      return { canSend: false, reason: `Before sending hours (starts at ${dayConfig.startTime}), current local time: ${currentTime}` };
    }

    if (dayConfig.endTime && currentTime >= dayConfig.endTime) {
      return { canSend: false, reason: `After sending hours (ended at ${dayConfig.endTime}), current local time: ${currentTime}` };
    }

    return { canSend: true };
  }

  /**
   * Calculate the next valid send time based on campaign sending window.
   * If we can send now, returns now. Otherwise finds the next enabled day+time slot.
   */
  private getNextValidSendTime(sendingConfig: any): Date {
    if (!sendingConfig?.autopilot?.enabled) return new Date();

    const autopilot = sendingConfig.autopilot;
    const now = new Date();
    const timezoneOffset = sendingConfig.timezoneOffset || 0;
    // Prefer IANA timezone (DST-aware), fallback to numeric offset
    let userLocal: Date;
    if (sendingConfig.timezone) {
      try {
        const localStr = now.toLocaleString('en-US', { timeZone: sendingConfig.timezone });
        userLocal = new Date(localStr);
      } catch (e) {
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        userLocal = new Date(utcMs - timezoneOffset * 60000);
      }
    } else {
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      userLocal = new Date(utcMs - timezoneOffset * 60000);
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
      const checkDate = new Date(userLocal);
      if (daysAhead > 0) checkDate.setDate(checkDate.getDate() + daysAhead);
      const dayName = dayNames[checkDate.getDay()];
      const dayConfig = autopilot.days?.[dayName];

      if (!dayConfig?.enabled || !dayConfig.startTime) continue;

      const [sh, sm] = dayConfig.startTime.split(':').map(Number);

      if (daysAhead === 0) {
        // Today — check if we're within or before the window
        const currentHH = String(userLocal.getHours()).padStart(2, '0');
        const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
        const currentTime = `${currentHH}:${currentMM}`;

        if (dayConfig.endTime && currentTime >= dayConfig.endTime) continue; // Window ended today

        if (currentTime >= dayConfig.startTime) {
          // Currently in the window — send now
          return new Date();
        }
        // Before start — return start time today
        const startToday = new Date(userLocal);
        startToday.setHours(sh, sm, 0, 0);
        // Convert user-local back to UTC
        const utcStart = new Date(startToday.getTime() + timezoneOffset * 60000 - now.getTimezoneOffset() * 60000);
        return utcStart;
      } else {
        // Future day — return that day's start time
        const futureDay = new Date(userLocal);
        futureDay.setDate(userLocal.getDate() + daysAhead);
        futureDay.setHours(sh, sm, 0, 0);
        const utcFuture = new Date(futureDay.getTime() + timezoneOffset * 60000 - now.getTimezoneOffset() * 60000);
        return utcFuture;
      }
    }

    // Fallback: send now (no enabled days found)
    return new Date();
  }

  /**
   * Process follow-ups for a specific campaign
   */
  private async processCampaignFollowups(campaignId: string, sequenceId: string): Promise<void> {
    // Load campaign to check sending window
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign) return;

    // Respect campaign's sending window — defer follow-ups until within allowed hours
    const sendingConfig = (campaign as any).sendingConfig;
    const windowCheck = this.checkSendingWindow(sendingConfig);
    if (!windowCheck.canSend) {
      // Log only occasionally to avoid spam
      if (this._checkCount % 60 === 1) {
        console.log(`[Followup] Campaign ${campaignId}: Deferring follow-ups — ${windowCheck.reason}`);
      }
      return;
    }

    // PERFORMANCE FIX #4: Targeted queries instead of loading ALL 50k messages
    // 1. Replied contacts — lightweight: only contactId, no message content
    const repliedRows = await storage.rawAll(
      'SELECT DISTINCT "contactId" FROM messages WHERE "campaignId" = ? AND "repliedAt" IS NOT NULL',
      campaignId
    );
    const contactReplied = new Set<string>(repliedRows.map((r: any) => r.contactId));

    // 2. Bounced contacts — lightweight: only contactId (P6 fix: skip follow-ups for bounced)
    const bouncedRows = await storage.rawAll(
      'SELECT DISTINCT "contactId" FROM messages WHERE "campaignId" = ? AND "bouncedAt" IS NOT NULL',
      campaignId
    );
    const contactBounced = new Set<string>(bouncedRows.map((r: any) => r.contactId));

    // 3. Step-0 sent messages — only the rows we actually need to evaluate triggers
    const originalMessages = await storage.rawAll(
      'SELECT * FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) AND status = ? AND "sentAt" IS NOT NULL',
      campaignId, 'sent'
    );

    const followupSteps = await storage.getFollowupSteps(sequenceId);

    // PERFORMANCE: Batch-load all existing executions for this campaign to avoid N+1 queries
    const existingExecutions = await storage.getFollowupExecutionsByCampaign(campaignId);
    const executionSet = new Set(existingExecutions.map((e: any) => `${e.campaignMessageId}_${e.stepId}`));
    
    for (const message of originalMessages) {
      const msg = message as any;
      
      // CRITICAL: Skip if contact has replied to ANY message in this campaign
      if (contactReplied.has(msg.contactId)) {
        for (const step of followupSteps) {
          const execKey = `${msg.id}_${step.id}`;
          if (!executionSet.has(execKey)) {
            // Create a skipped execution record so we don't check again
            await storage.createFollowupExecution({
              campaignMessageId: msg.id,
              stepId: step.id,
              contactId: msg.contactId,
              campaignId: campaignId,
              status: "skipped",
              scheduledAt: new Date().toISOString(),
            });
            executionSet.add(execKey);
            console.log(`[Followup] Skipping step ${step.stepNumber} for contact ${msg.contactId} — already replied to campaign`);
          }
        }
        continue;
      }

      // P6 fix: Skip if Step 0 message bounced — no point sending follow-ups to invalid addresses
      if (contactBounced.has(msg.contactId)) {
        for (const step of followupSteps) {
          const execKey = `${msg.id}_${step.id}`;
          if (!executionSet.has(execKey)) {
            await storage.createFollowupExecution({
              campaignMessageId: msg.id,
              stepId: step.id,
              contactId: msg.contactId,
              campaignId: campaignId,
              status: "skipped",
              scheduledAt: new Date().toISOString(),
            });
            executionSet.add(execKey);
            console.log(`[Followup] Skipping step ${step.stepNumber} for contact ${msg.contactId} — message bounced`);
          }
        }
        continue;
      }

      await this.processMessageFollowups(msg, followupSteps, campaignId, executionSet, campaign);
    }
  }

  /**
   * Process follow-ups for a specific message based on triggers
   */
  private async processMessageFollowups(message: any, followupSteps: any[], campaignId?: string, executionSet?: Set<string>, preloadedCampaign?: any): Promise<void> {
    for (const step of followupSteps) {
      // Skip if already executed — use batch-loaded set for O(1) check
      const execKey = `${message.id}_${step.id}`;
      if (executionSet ? executionSet.has(execKey) : await this.followupAlreadyExecuted(message.id, step.id)) {
        continue;
      }

      // Use message already bulk-loaded at cycle start — no per-contact DB re-fetch
      // Reply/bounce are pre-checked via contactReplied/contactBounced sets in caller
      // Per-contact re-fetch was causing N×(2-5s) DB stalls with slow PG, stopping mid-loop
      const shouldTrigger = await this.evaluateFollowupTrigger(message, step);

      if (shouldTrigger) {
        await this.scheduleFollowup(message, step, preloadedCampaign);
        // Add to execution set to avoid re-processing in same cycle
        if (executionSet) executionSet.add(execKey);
      }
    }
  }

  /**
   * Evaluate if a follow-up should be triggered.
   * Delays are RELATIVE TO THE PREVIOUS STEP — not step 0.
   * Step 1 delay = time after step 0's sentAt.
   * Step 2 delay = time after step 1's sentAt.
   */
  private async evaluateFollowupTrigger(message: any, step: any): Promise<boolean> {
    const now = new Date();

    // Calculate delay in milliseconds - support days, hours, minutes
    const delayDays = parseInt(step.delayDays) || 0;
    const delayHours = parseInt(step.delayHours) || 0;
    const delayMinutes = parseInt(step.delayMinutes) || 0;
    const delayMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000) + (delayMinutes * 60 * 1000);

    // Find the reference time: use the PREVIOUS step's sentAt (not step 0)
    const currentStepNumber = parseInt(step.stepNumber) || 1;
    const previousStepNumber = currentStepNumber - 1;
    let referenceTime: Date;

    if (previousStepNumber === 0) {
      // Step 1 is relative to step 0 (the original message)
      referenceTime = new Date(message.sentAt);
    } else {
      // Step 2+ is relative to the previous step's sentAt
      const prevStepMsg = await storage.getCampaignMessageByContactAndStep(
        message.campaignId, message.contactId, previousStepNumber
      );
      if (prevStepMsg && (prevStepMsg as any).sentAt) {
        referenceTime = new Date((prevStepMsg as any).sentAt);
      } else {
        // Previous step not yet sent — can't trigger this step yet
        return false;
      }
    }

    const triggerTime = new Date(referenceTime.getTime() + delayMs);

    if (now < triggerTime) {
      return false;
    }

    // Check trigger conditions
    switch (step.trigger) {
      case "no_reply":
      case "if_no_reply":
        return !message.repliedAt;
        
      case "no_open":
      case "if_no_open":
        return !message.openedAt;
        
      case "no_click":
      case "if_no_click":
        return !message.clickedAt;
        
      case "opened":
      case "if_opened":
        return !!message.openedAt;
        
      case "clicked":
      case "if_clicked":
        return !!message.clickedAt;
        
      case "replied":
      case "if_replied":
        return !!message.repliedAt;
        
      case "bounced":
        return !!message.bouncedAt;
        
      case "time_delay":
      case "no_matter_what":
        return true; // Always send after delay
        
      default:
        console.log(`[Followup] Unknown trigger type: ${step.trigger}`);
        return false;
    }
  }

  /**
   * Check if a follow-up has already been executed
   */
  private async followupAlreadyExecuted(campaignMessageId: string, stepId: string): Promise<boolean> {
    const execution = await storage.getFollowupExecution(campaignMessageId, stepId);
    return !!execution;
  }

  /**
   * Schedule a follow-up email
   */
  private async scheduleFollowup(message: any, step: any, preloadedCampaign?: any): Promise<void> {
    try {
      const contact = await storage.getContact(message.contactId);
      const campaign = preloadedCampaign || await storage.getCampaign(message.campaignId);

      if (!contact || !campaign) {
        console.error("Missing contact or campaign data for follow-up");
        return;
      }

      // Generate personalized content if needed
      let subject = step.subject;
      let content = step.content;

      if (step.templateId) {
        const template = await storage.getEmailTemplate(step.templateId);
        if (template) {
          subject = template.subject;
          content = template.content;
        }
      }

      // Calculate next valid send time (respects campaign sending window / blocked days)
      const sendingConfig = (campaign as any).sendingConfig;
      const nextValidTime = this.getNextValidSendTime(sendingConfig);

      // Create follow-up execution record with proper scheduled time
      const execution = await storage.createFollowupExecution({
        campaignMessageId: message.id,
        stepId: step.id,
        contactId: contact.id,
        campaignId: campaign.id,
        status: "pending",
        scheduledAt: nextValidTime.toISOString(),
      });

      console.log(`Scheduled follow-up for contact ${contact.email}, step ${step.stepNumber}, scheduledAt ${nextValidTime.toISOString()}`);

      // If the follow-up should be sent immediately (no delay configured), send it now
      const hasDelay = (parseInt(step.delayDays) || 0) > 0 || (parseInt(step.delayHours) || 0) > 0 || (parseInt(step.delayMinutes) || 0) > 0;
      if (!hasDelay) {
        // Double-check: re-read the original message before sending (reply may have arrived)
        const latestMsg = await storage.getCampaignMessage(message.id);
        if (latestMsg?.repliedAt && (step.trigger === 'no_reply' || step.trigger === 'if_no_reply')) {
          await storage.updateFollowupExecution(execution.id, { status: 'skipped' });
          console.log(`[Followup] Skipped immediate send for step ${step.stepNumber} — contact replied since scheduling`);
        } else {
          await this.executeFollowup(execution.id);
        }
      }
      
    } catch (error) {
      console.error("Error scheduling follow-up:", error);
    }
  }

  /**
   * Process scheduled follow-ups that are ready to be sent
   * PERFORMANCE: Groups pending executions by campaignId to batch-load messages once per campaign
   */
  private async processScheduledFollowups(): Promise<void> {
    const pendingExecutions = await storage.getPendingFollowupExecutions();
    
    if (pendingExecutions.length === 0) return;
    
    // Group by campaignId to avoid N+1 queries
    const byCampaign = new Map<string, any[]>();
    for (const execution of pendingExecutions) {
      const now = new Date();
      const scheduledAt = new Date(execution.scheduledAt);
      if (now < scheduledAt) continue; // Not ready yet
      
      const cid = execution.campaignId || '';
      const existing = byCampaign.get(cid) || [];
      existing.push(execution);
      byCampaign.set(cid, existing);
    }
    
    for (const [campaignId, executions] of byCampaign) {
      // Check campaign status + sending window before sending any follow-ups
      if (campaignId) {
        const campaign = await storage.getCampaign(campaignId);
        if (campaign) {
          // P2 FIX: Skip follow-ups for paused/cancelled campaigns — user expects "Pause" to stop ALL sending
          if (campaign.status === 'paused' || campaign.status === 'cancelled' || campaign.status === 'draft') {
            if (this._checkCount % 60 === 1) {
              console.log(`[Followup] Skipping ${executions.length} pending follow-ups for campaign ${campaignId}: campaign is ${campaign.status}`);
            }
            continue;
          }
          const sendingConfig = (campaign as any).sendingConfig;
          const windowCheck = this.checkSendingWindow(sendingConfig);
          if (!windowCheck.canSend) {
            // Defer — don't send yet, will be picked up next time the window is open
            if (this._checkCount % 60 === 1) {
              console.log(`[Followup] Deferring ${executions.length} pending follow-ups for campaign ${campaignId}: ${windowCheck.reason}`);
            }
            continue;
          }
        }
      }

      // PERFORMANCE FIX #4: Targeted query for replied contacts instead of loading ALL messages
      const repliedRows = campaignId
        ? await storage.rawAll('SELECT DISTINCT "contactId" FROM messages WHERE "campaignId" = ? AND "repliedAt" IS NOT NULL', campaignId)
        : [];
      const contactReplied = new Set<string>(repliedRows.map((r: any) => r.contactId));

      for (const execution of executions) {
        // CRITICAL FIX: Before executing, re-check if contact has replied
        if (execution.contactId && campaignId) {
          const step = execution.stepId ? await storage.getFollowupStep(execution.stepId) : null;
          if (step && (step.trigger === 'no_reply' || step.trigger === 'if_no_reply')) {
            if (contactReplied.has(execution.contactId)) {
              await storage.updateFollowupExecution(execution.id, {
                status: "skipped",
                errorMessage: "Contact replied before scheduled send"
              });
              console.log(`[Followup] Skipped scheduled follow-up for contact ${execution.contactId} — already replied`);
              continue;
            }
          }
        }
        await this.executeFollowup(execution.id);
      }
    }
  }

  /**
   * Execute a specific follow-up email
   * @param executionId - the follow-up execution record ID
   */
  private async executeFollowup(executionId: string): Promise<void> {
    let dailyLimitReserved = false;
    let campaignEmailAccountId: string | null = null;
    try {
      // P10 FIX: Atomic claim — prevents double-send when overlapping cycles both see "pending"
      // UPDATE returns the row only if it was still pending; null means another cycle already claimed it
      const claimed = await storage.rawGet(
        'UPDATE followup_executions SET status = ? WHERE id = ? AND status = ? RETURNING id',
        'processing', executionId, 'pending'
      );
      if (!claimed) {
        return; // Already claimed by another cycle or no longer pending
      }

      const execution = await storage.getFollowupExecutionById(executionId);
      if (!execution) {
        return;
      }

      const contact = await storage.getContact(execution.contactId);
      const step = await storage.getFollowupStep(execution.stepId);
      const campaignMessage = await storage.getCampaignMessage(execution.campaignMessageId);
      
      if (!contact || !step || !campaignMessage) {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: "Missing required data for follow-up execution"
        });
        return;
      }

      const campaign = await storage.getCampaign(campaignMessage.campaignId);
      if (!campaign) {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: "Campaign not found"
        });
        return;
      }

      // P2 FIX: Don't send follow-ups for paused/cancelled campaigns
      if (campaign.status === 'paused' || campaign.status === 'cancelled' || campaign.status === 'draft') {
        // Don't mark as skipped — leave as pending so they resume when campaign is un-paused
        // Reset back to pending so it's picked up next cycle
        await storage.rawRun('UPDATE followup_executions SET status = ? WHERE id = ?', 'pending', executionId);
        console.log(`[Followup] Deferring execution ${executionId} — campaign ${campaign.id} is ${campaign.status}`);
        return;
      }

      // P4 FIX: Atomic daily limit check + reserve
      // Atomically increments dailySent ONLY if under limit — prevents race between campaign engine + follow-up engine
      // If send fails later, we decrement to release the reserved slot
      campaignEmailAccountId = campaign.emailAccountId || null;
      if (campaignEmailAccountId) {
        try {
          const reserved = await storage.rawGet(
            'UPDATE email_accounts SET "dailySent" = "dailySent" + 1 WHERE id = ? AND "dailySent" < "dailyLimit" RETURNING id, "dailySent", "dailyLimit"',
            campaign.emailAccountId
          );
          if (!reserved) {
            // Limit reached — defer, don't skip. Will retry next cycle after midnight reset.
            await storage.rawRun('UPDATE followup_executions SET status = ? WHERE id = ?', 'pending', executionId);
            // Read current values for logging
            const acct = await storage.getEmailAccount(campaign.emailAccountId);
            console.log(`[Followup] Deferring execution ${executionId} — account ${(acct as any)?.email} daily limit reached (${(acct as any)?.dailySent}/${(acct as any)?.dailyLimit})`);
            return;
          }
          dailyLimitReserved = true;
        } catch (e) { /* non-critical — proceed if check fails */ }
      }

      // Suppression list check — skip if contact email is blocked (bounced/unsubscribed)
      try {
        const suppressed = await storage.isEmailSuppressed(campaign.organizationId, (contact as any).email);
        if (suppressed) {
          await storage.updateFollowupExecution(executionId, {
            status: "skipped",
            errorMessage: "Contact email is suppressed (bounced/unsubscribed)"
          });
          console.log(`[Followup] Skipped step ${step.stepNumber} for ${(contact as any).email} — email is in suppression list`);
          return;
        }
      } catch (e) { /* non-critical */ }

      // CRITICAL FIX: Before sending, check if the contact has replied to ANY message in this campaign
      // PERFORMANCE FIX #4: Targeted query — only check this contact's reply status, not all 50k messages
      if (step.trigger === 'no_reply' || step.trigger === 'if_no_reply') {
        const replyCheck = await storage.rawGet(
          'SELECT 1 FROM messages WHERE "campaignId" = ? AND "contactId" = ? AND "repliedAt" IS NOT NULL LIMIT 1',
          campaign.id, contact.id
        );
        if (replyCheck) {
          await storage.updateFollowupExecution(executionId, {
            status: "skipped",
            errorMessage: "Contact already replied to campaign"
          });
          console.log(`[Followup] Skipped step ${step.stepNumber} for ${contact.email} — contact already replied to campaign`);
          return;
        }
      }

      // ========== Threading: send follow-up as reply in the same email thread ==========
      // Find the ORIGINAL (step 0) message for this contact in this campaign.
      // execution.campaignMessageId should point to step 0, but in edge cases it
      // might point to a step-1 message, so always look up the step-0 message.
      let originalMessage: any = campaignMessage;
      if ((campaignMessage as any).stepNumber !== 0 && (campaignMessage as any).stepNumber !== undefined) {
        // Targeted query: find step-0 message for this specific contact (not all campaign messages)
        const step0Msg = await storage.rawGet(
          'SELECT * FROM messages WHERE "campaignId" = ? AND "contactId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) LIMIT 1',
          campaign.id, contact.id
        );
        if (step0Msg) {
          originalMessage = step0Msg;
          console.log(`[Followup] Found step-0 original message ${step0Msg.id} with providerMessageId=${step0Msg.providerMessageId}`);
        }
      }
      
      // Determine subject: if step has no subject, use exact subject from step 1 (no "Re:" prefix)
      // Gmail threads via threadId (not subject), Outlook threads via In-Reply-To/References headers
      const stepSubject = (execution.subject || step.subject || '').trim();
      const originalSubject = (originalMessage.subject || campaign.subject || '').trim();
      let followupSubject: string;

      if (!stepSubject || stepSubject === originalSubject) {
        // No custom subject → reuse original subject exactly (strip any existing "Re:" for clean display)
        const cleanSubject = originalSubject.replace(/^(Re:\s*)+/i, '').trim();
        followupSubject = cleanSubject || 'Follow-up';
      } else {
        // Different subject specified → use it
        followupSubject = stepSubject;
      }
      
      const content = execution.content || step.content || '';
      
      if (!campaign.emailAccountId || !contact.email || !content) {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: "Missing required email data"
        });
        return;
      }

      // Build full personalization data — same fields as campaign-engine Step 0
      const personalData: Record<string, string> = {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email || '',
        company: contact.company || '',
        jobTitle: contact.jobTitle || '',
        fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        phone: contact.phone || '',
        mobilePhone: contact.mobilePhone || '',
        linkedinUrl: contact.linkedinUrl || '',
        seniority: contact.seniority || '',
        department: contact.department || '',
        city: contact.city || '',
        state: contact.state || '',
        country: contact.country || '',
        website: contact.website || '',
        industry: contact.industry || '',
        employeeCount: contact.employeeCount || '',
        annualRevenue: contact.annualRevenue || '',
        companyCity: contact.companyCity || '',
        companyState: contact.companyState || '',
        companyCountry: contact.companyCountry || '',
        topic: campaign.subject || campaign.name || '',
        // Spread any custom fields so {{customKey}} also works
        ...((contact as any).customFields || {}),
      };

      // Dynamic replacement: case-insensitive, cleans up unresolved variables
      function personalizeText(template: string): string {
        let result = template;
        for (const [key, value] of Object.entries(personalData)) {
          if (value !== undefined && value !== null) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
            result = result.replace(regex, String(value));
          }
        }
        result = result.replace(/\{\{[^}]+\}\}/g, '');
        return result;
      }

      let personalizedContent = personalizeText(content);
      let personalizedSubject = personalizeText(followupSubject);

      // Build threading headers — fetch the original message's real Message-ID from the provider
      let gmailThreadId: string | undefined;
      let originalMessageId = '';

      // Determine the email account provider for this campaign
      let accountProvider: string | undefined;
      let senderEmail: string | undefined;
      if (campaign.emailAccountId) {
        try {
          const emailAccount = await storage.getEmailAccount(campaign.emailAccountId);
          if (emailAccount?.email) senderEmail = emailAccount.email;
          if ((emailAccount as any)?.provider) accountProvider = (emailAccount as any).provider;
        } catch (e) {}
      }
      const isOutlookAccount = accountProvider === 'outlook' || accountProvider === 'microsoft';
      const isGmailAccount = accountProvider === 'gmail' || accountProvider === 'google';

      console.log(`[Followup] Threading lookup: providerMessageId=${originalMessage.providerMessageId || 'MISSING'}, gmailThreadId=${originalMessage.gmailThreadId || 'MISSING'}, orgId=${campaign.organizationId}, provider=${accountProvider}, sender=${senderEmail}`);

      // Use stored gmailThreadId if available (saved at step 0 send time — no API call needed)
      if (isGmailAccount && originalMessage.gmailThreadId) {
        gmailThreadId = originalMessage.gmailThreadId;
        console.log(`[Followup] Gmail threading: using stored threadId=${gmailThreadId}`);
      }

      if (originalMessage.providerMessageId && campaign.organizationId) {
        try {
          if (isGmailAccount) {
            // Gmail: fetch threadId and Message-ID from Gmail API
            const tokenResult = await this.emailService.getGmailAccessToken(campaign.organizationId, senderEmail);
            let accessToken = tokenResult?.token || null;

            if (!accessToken) {
              console.warn(`[Followup] Gmail threading: no access token for ${senderEmail} — will use stored threadId if available`);
            }

            if (accessToken) {
              let msgResp = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${originalMessage.providerMessageId}?format=metadata&metadataHeaders=Message-ID`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              // If 401, force-refresh token and retry once
              if (msgResp.status === 401) {
                console.log(`[Followup] Gmail metadata fetch 401, refreshing token...`);
                const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
                try {
                  await storage.setApiSetting(campaign.organizationId, senderEmail ? `${senderPrefix}token_expiry` : 'gmail_token_expiry', '0');
                } catch (e) { /* ignore */ }
                const retryToken = await this.emailService.getGmailAccessToken(campaign.organizationId, senderEmail);
                if (retryToken) {
                  accessToken = retryToken.token;
                  msgResp = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${originalMessage.providerMessageId}?format=metadata&metadataHeaders=Message-ID`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                  );
                }
              }
              if (!msgResp.ok) {
                const errText = await msgResp.text().catch(() => '');
                console.warn(`[Followup] Gmail threading API error: ${msgResp.status} ${errText.slice(0, 200)}`);
              }
              if (msgResp.ok) {
                const msgData = await msgResp.json() as any;
                // Use API threadId if we don't have a stored one
                if (!gmailThreadId) gmailThreadId = msgData.threadId;
                const msgIdHeader = (msgData.payload?.headers || []).find(
                  (h: any) => h.name.toLowerCase() === 'message-id'
                );
                if (msgIdHeader) {
                  originalMessageId = msgIdHeader.value;
                }
              }
            }
          } else if (isOutlookAccount) {
            // Outlook: fetch internetMessageId from Graph API for threading
            const tokenResult = await this.emailService.getOutlookAccessToken(campaign.organizationId, senderEmail);
            if (tokenResult) {
              // The providerMessageId for Outlook messages is stored as "graph-{timestamp}"
              // which is NOT a real Graph message ID. Instead, search for the original message
              // by subject + recipient in Sent Items to get the real internetMessageId.
              const originalSubjectClean = (originalMessage.subject || '').replace(/^(Re:\s*)+/i, '').trim();
              const contactEmail = contact.email;
              const filter = `subject eq '${originalSubjectClean.replace(/'/g, "''")}' and toRecipients/any(r:r/emailAddress/address eq '${contactEmail}')`;
              const sentResp = await fetch(
                `https://graph.microsoft.com/v1.0/me/mailFolders/sentItems/messages?$filter=${encodeURIComponent(filter)}&$select=internetMessageId,conversationId&$top=1&$orderby=sentDateTime desc`,
                { headers: { Authorization: `Bearer ${tokenResult.token}` } }
              );
              if (sentResp.ok) {
                const sentData = await sentResp.json() as any;
                const sentMsg = sentData.value?.[0];
                if (sentMsg?.internetMessageId) {
                  originalMessageId = sentMsg.internetMessageId;
                  console.log(`[Followup] Outlook threading: found original internetMessageId=${originalMessageId}`);
                }
              }
            }
          }
        } catch (e) {
          console.log(`[Followup] Could not fetch original Message-ID for threading: ${e}`);
        }
      }

      // Fallback: use stored RFC Message-ID from step-0 message if Gmail API fetch didn't return one
      if (!originalMessageId && originalMessage.messageId) {
        originalMessageId = originalMessage.messageId;
        console.log(`[Followup] Threading fallback: using stored messageId=${originalMessageId} for In-Reply-To/References`);
      }

      // Fallback: if threading is broken (no threadId for Gmail, no In-Reply-To for Outlook),
      // add "Re:" prefix so email clients can still group by subject as a last resort
      const threadLinked = (isGmailAccount && !!gmailThreadId) || (!isGmailAccount && !!originalMessageId);
      if (!threadLinked && (!stepSubject || stepSubject === originalSubject)) {
        const cleanSubject = originalSubject.replace(/^(Re:\s*)+/i, '').trim();
        if (cleanSubject) {
          personalizedSubject = personalizeText(`Re: ${cleanSubject}`);
          console.log(`[Followup] Threading not linked — adding "Re:" prefix as fallback for subject grouping`);
        }
      }

      if (isGmailAccount && !gmailThreadId) {
        console.error(`[Followup] ⚠ THREADING BROKEN: Gmail account but no threadId found! Original msg id=${originalMessage.id}, providerMessageId=${originalMessage.providerMessageId || 'NULL'}, gmailThreadId=${originalMessage.gmailThreadId || 'NULL'}. Follow-up will create a NEW thread instead of replying.`);
      }
      console.log(`[Followup] Threading: provider=${accountProvider}, subject="${personalizedSubject}", threadLinked=${threadLinked}, threadId=${gmailThreadId || 'none'}, inReplyTo=${originalMessageId || 'none'}`);

      // IDEMPOTENCY GUARD: If a message record already exists for this contact+campaign+step,
      // the email was already sent (crash between send and status update). Skip to prevent duplicate.
      const alreadySent = await storage.rawGet(
        'SELECT 1 FROM messages WHERE "campaignId" = ? AND "contactId" = ? AND "stepNumber" = ? AND status = ? LIMIT 1',
        campaign.id, contact.id, step.stepNumber || 1, 'sent'
      );
      if (alreadySent) {
        await storage.updateFollowupExecution(executionId, {
          status: "sent",
          sentAt: new Date().toISOString()
        });
        console.log(`[Followup] Idempotency: step ${step.stepNumber} for ${contact.email} already sent (crash recovery). Marking execution as sent.`);
        return;
      }

      const emailResult = await this.emailService.sendEmail(campaign.emailAccountId, {
        to: contact.email,
        subject: personalizedSubject,
        html: personalizedContent,
        text: personalizedContent.replace(/<[^>]*>/g, ""),
        // Threading info — places follow-up in same Gmail thread as original email
        threadId: gmailThreadId,
        inReplyTo: originalMessageId || undefined,
        references: originalMessageId || undefined,
      }, campaign.organizationId);

      if (emailResult.success) {
        await storage.updateFollowupExecution(executionId, {
          status: "sent",
          sentAt: new Date().toISOString()
        });
        
        // Create a new campaign message record for tracking with correct stepNumber
        const trackingId = `${campaign.id}_${contact.id}_${Date.now()}`;
        await storage.createCampaignMessage({
          campaignId: campaign.id,
          contactId: contact.id,
          subject: personalizedSubject,
          content: personalizedContent,
          status: "sent",
          sentAt: new Date().toISOString(),
          stepNumber: step.stepNumber || 1,
          trackingId: trackingId,
          providerMessageId: emailResult.messageId,
          messageId: emailResult.internetMessageId || null,
          emailAccountId: campaign.emailAccountId,
          recipientEmail: contact.email,
        });
        
        // Update campaign sent count
        await storage.updateCampaign(campaign.id, {
          sentCount: (campaign.sentCount || 0) + 1,
        });
        
        // Create sent tracking event
        await storage.createTrackingEvent({
          type: 'sent',
          campaignId: campaign.id,
          messageId: trackingId,
          contactId: contact.id,
          trackingId: trackingId,
        });
        
        console.log(`[Followup] Follow-up step ${step.stepNumber} sent successfully to ${contact.email} for campaign ${campaign.name}`);
      } else {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: emailResult.error || "Unknown email sending error"
        });

        // Release the reserved daily limit slot since the email didn't actually send
        if (dailyLimitReserved && campaignEmailAccountId) {
          try {
            await storage.rawRun(
              'UPDATE email_accounts SET "dailySent" = GREATEST("dailySent" - 1, 0) WHERE id = ?',
              campaignEmailAccountId
            );
          } catch (e) { /* non-critical */ }
        }

        console.error(`[Followup] Failed to send follow-up to ${contact.email}:`, emailResult.error);
      }
      
    } catch (error) {
      console.error("Error executing follow-up:", error);
      try {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        });
      } catch (e) { /* best effort */ }
      // Release reserved daily limit slot on exception
      if (dailyLimitReserved && campaignEmailAccountId) {
        try {
          await storage.rawRun(
            'UPDATE email_accounts SET "dailySent" = GREATEST("dailySent" - 1, 0) WHERE id = ?',
            campaignEmailAccountId
          );
        } catch (e) { /* non-critical */ }
      }
    }
  }

  /**
   * Trigger follow-ups based on email events (opens, clicks, replies)
   */
  async triggerEventBasedFollowups(triggerData: FollowupTriggerData): Promise<void> {
    try {
      const { campaignMessageId, contactId, triggerType } = triggerData;
      
      // Get campaign and follow-up sequences
      const campaignMessage = await storage.getCampaignMessage(campaignMessageId);
      if (!campaignMessage || !campaignMessage.campaignId) return;
      
      const campaignFollowups = await storage.getCampaignFollowups(campaignMessage.campaignId);
      
      for (const campaignFollowup of campaignFollowups) {
        const steps = await storage.getFollowupSteps(campaignFollowup.sequenceId);
        
        // Find steps that match this trigger type
        const matchingSteps = steps.filter(step => 
          step.trigger === triggerType && 
          step.isActive
        );
        
        for (const step of matchingSteps) {
          // Check if this follow-up hasn't been executed yet
          if (!(await this.followupAlreadyExecuted(campaignMessageId, step.id))) {
            await this.scheduleFollowup(campaignMessage, step);
          }
        }
      }
      
    } catch (error) {
      console.error("Error triggering event-based follow-ups:", error);
    }
  }

  /**
   * Stop all follow-ups for a contact (e.g., when they reply or unsubscribe)
   */
  async stopFollowupsForContact(contactId: string, campaignId?: string): Promise<void> {
    try {
      await storage.cancelPendingFollowupsForContact(contactId, campaignId);
      console.log(`Stopped follow-ups for contact ${contactId}`);
    } catch (error) {
      console.error("Error stopping follow-ups for contact:", error);
    }
  }
}

// Create singleton instance
export const followupEngine = new FollowupEngine();

// Auto-process follow-ups every 30 seconds (to handle minute-level delays)
let followupInterval: NodeJS.Timeout | null = null;
let isProcessing = false; // Overlap lock — prevents concurrent cycles under PG load

export function startFollowupEngine() {
  if (followupInterval) return;
  console.log('[Followup] Starting follow-up engine (checking every 30s)...');
  // Run immediately on start
  followupEngine.processFollowupTriggers().catch(console.error);
  // Then run every 30 seconds with overlap protection
  followupInterval = setInterval(async () => {
    if (isProcessing) {
      console.log('[Followup] Previous cycle still running, skipping this interval');
      return;
    }
    isProcessing = true;
    try {
      await followupEngine.processFollowupTriggers();
    } catch (e) {
      console.error('[Followup] Error in follow-up trigger processing:', e);
    } finally {
      isProcessing = false;
    }
  }, 30 * 1000);
}

export function stopFollowupEngine() {
  if (followupInterval) {
    clearInterval(followupInterval);
    followupInterval = null;
    console.log('[Followup] Follow-up engine stopped');
  }
}