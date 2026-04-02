import { storage } from "../storage";
import { smtpEmailService } from "./smtp-email-service";
import { OAuth2Client } from 'google-auth-library';

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

    // Refresh token if expired (5-minute buffer)
    if (tokenExpiry && Date.now() > parseInt(tokenExpiry) - 300000) {
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
      // Determine the actual sending email address and provider from the email account
      let senderEmail: string | undefined;
      let accountProvider: string | undefined;
      try {
        const emailAccount = await storage.getEmailAccount(emailAccountId);
        if (emailAccount?.email) {
          senderEmail = emailAccount.email;
        }
        if ((emailAccount as any)?.provider) {
          accountProvider = (emailAccount as any).provider;
        }
      } catch (e) { /* ignore */ }

      // Route to the correct provider based on the email account's provider
      const isOutlook = accountProvider === 'outlook' || accountProvider === 'microsoft';
      const isGmail = accountProvider === 'gmail' || accountProvider === 'google';

      // For Outlook/Microsoft accounts: use Microsoft Graph API
      if (isOutlook && orgId) {
        const tokenResult = await this.getOutlookAccessToken(orgId, senderEmail);
        if (tokenResult) {
          const fromEmail = senderEmail || tokenResult.email || '';
          console.log(`[Followup] Sending follow-up via Microsoft Graph to ${message.to} from ${fromEmail}`);

          const graphMessage: any = {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
          };

          const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenResult.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: graphMessage, saveToSentItems: true }),
          });

          if (resp.ok) {
            return { success: true, messageId: `graph-followup-${Date.now()}` };
          }

          const errText = await resp.text();
          console.error(`[Followup] Microsoft Graph send failed: ${resp.status} ${errText}`);
          // Fall through to SMTP fallback below
        }
      }

      // For Gmail accounts: use Gmail API
      if (isGmail && orgId) {
        const tokenResult = await this.getGmailAccessToken(orgId, senderEmail);

        if (tokenResult) {
          const fromEmail = senderEmail || tokenResult.email || '';
          console.log(`[Followup] Sending follow-up via Gmail API to ${message.to} from ${fromEmail}${message.threadId ? ' (thread: ' + message.threadId + ')' : ''}`);

          // Build threading headers for in-reply-to
          const headers: Record<string, string> = {};
          if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
          if (message.references) headers['References'] = message.references;

          const result = await sendViaGmailAPI(tokenResult.token, {
            from: fromEmail,
            to: message.to,
            subject: message.subject,
            html: message.html,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            threadId: message.threadId,
          });
          if (result.success) return result;
          console.log(`[Followup] Gmail API failed, trying SMTP: ${result.error}`);
        }
      }

      // For unknown provider or API failure: try OAuth API based on available tokens
      if (!isOutlook && !isGmail && orgId) {
        // Try Gmail if tokens exist
        const gmailToken = await this.getGmailAccessToken(orgId, senderEmail);
        if (gmailToken) {
          const fromEmail = senderEmail || gmailToken.email || '';
          const headers: Record<string, string> = {};
          if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
          if (message.references) headers['References'] = message.references;
          const result = await sendViaGmailAPI(gmailToken.token, {
            from: fromEmail, to: message.to, subject: message.subject, html: message.html,
            headers: Object.keys(headers).length > 0 ? headers : undefined, threadId: message.threadId,
          });
          if (result.success) return result;
        }
      }

      // Try SMTP as fallback
      const account = await storage.getEmailAccount(emailAccountId);
      if (account?.smtpConfig) {
        console.log(`[Followup] Sending email via SMTP account ${emailAccountId} to ${message.to}`);
        const result = await smtpEmailService.sendEmail(emailAccountId, account.smtpConfig, {
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text || message.html.replace(/<[^>]*>/g, ''),
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

      // Count total original messages (step 0) and total follow-up steps
      const campaignMessages = await storage.getCampaignMessages(campaignId, 50000, 0);
      const step0Messages = campaignMessages.filter((m: any) => (m.stepNumber || 0) === 0);
      const followupSteps = await storage.getFollowupSteps(cf.sequenceId);

      if (step0Messages.length === 0 || followupSteps.length === 0) continue;

      // Count how many executions exist vs how many should exist
      const executions = await storage.getFollowupExecutionsByCampaign(campaignId);
      const totalExpected = step0Messages.length * followupSteps.length;
      const totalDone = executions.filter((e: any) =>
        e.status === 'sent' || e.status === 'skipped' || e.status === 'failed'
      ).length;
      const totalPending = executions.filter((e: any) => e.status === 'pending').length;

      if (totalDone >= totalExpected && totalPending === 0) {
        await storage.updateCampaign(campaignId, { status: 'completed' });
        console.log(`[Followup] Campaign ${campaignId} (${campaign.name}): All ${totalDone} follow-up executions complete. Marking campaign as completed.`);
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
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    // timezoneOffset is browser's getTimezoneOffset() (minutes behind UTC, e.g. IST = -330)
    const userLocalMs = utcMs - (sendingConfig.timezoneOffset || 0) * 60000;
    const userLocal = new Date(userLocalMs);

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

    const campaignMessages = await storage.getCampaignMessages(campaignId, 50000, 0);
    const followupSteps = await storage.getFollowupSteps(sequenceId);
    
    // PERFORMANCE: Batch-load all existing executions for this campaign to avoid N+1 queries
    const existingExecutions = await storage.getFollowupExecutionsByCampaign(campaignId);
    const executionSet = new Set(existingExecutions.map((e: any) => `${e.campaignMessageId}_${e.stepId}`));
    
    // Build a lookup: contactId -> has any replied message
    const contactReplied = new Set<string>();
    for (const m of campaignMessages) {
      if ((m as any).repliedAt && (m as any).contactId) {
        contactReplied.add((m as any).contactId);
      }
    }
    
    // Only evaluate original (step 0) messages for follow-up triggers
    const originalMessages = campaignMessages.filter((m: any) => (m.stepNumber || 0) === 0);
    
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
      
      await this.processMessageFollowups(msg, followupSteps, campaignId, executionSet);
    }
  }

  /**
   * Process follow-ups for a specific message based on triggers
   */
  private async processMessageFollowups(message: any, followupSteps: any[], campaignId?: string, executionSet?: Set<string>): Promise<void> {
    for (const step of followupSteps) {
      // Skip if already executed — use batch-loaded set for O(1) check
      const execKey = `${message.id}_${step.id}`;
      if (executionSet ? executionSet.has(execKey) : await this.followupAlreadyExecuted(message.id, step.id)) {
        continue;
      }
      
      // CRITICAL FIX: Re-fetch the latest message state from DB before evaluating
      // This prevents stale data issues when reply tracker updates happen between polling cycles
      const freshMessage = await storage.getCampaignMessage(message.id);
      if (!freshMessage) continue;
      
      const shouldTrigger = await this.evaluateFollowupTrigger(freshMessage, step);
      
      if (shouldTrigger) {
        await this.scheduleFollowup(freshMessage, step);
        // Add to execution set to avoid re-processing in same cycle
        if (executionSet) executionSet.add(execKey);
      }
    }
  }

  /**
   * Evaluate if a follow-up should be triggered
   */
  private async evaluateFollowupTrigger(message: any, step: any): Promise<boolean> {
    const now = new Date();
    const sentAt = new Date(message.sentAt);
    
    // Calculate delay in milliseconds - support days, hours, minutes
    const delayDays = parseInt(step.delayDays) || 0;
    const delayHours = parseInt(step.delayHours) || 0;
    const delayMinutes = parseInt(step.delayMinutes) || 0;
    const delayMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000) + (delayMinutes * 60 * 1000);
    const triggerTime = new Date(sentAt.getTime() + delayMs);

    // Debug logging — only log when time hasn't been reached yet (waiting) or when triggering
    if (now < triggerTime) {
      // Only log once per minute for waiting messages (skip noisy repeated logs)
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
  private async scheduleFollowup(message: any, step: any): Promise<void> {
    try {
      const contact = await storage.getContact(message.contactId);
      const campaign = await storage.getCampaign(message.campaignId);
      
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

      // Create follow-up execution record
      const execution = await storage.createFollowupExecution({
        campaignMessageId: message.id,
        stepId: step.id,
        contactId: contact.id,
        campaignId: campaign.id,
        status: "pending",
        scheduledAt: new Date().toISOString(),
      });

      console.log(`Scheduled follow-up for contact ${contact.email}, step ${step.stepNumber}`);
      
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
      // Check sending window for this campaign before sending any follow-ups
      if (campaignId) {
        const campaign = await storage.getCampaign(campaignId);
        if (campaign) {
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

      // Batch-load all campaign messages ONCE for this campaign
      let campaignMsgs: any[] = [];
      if (campaignId) {
        campaignMsgs = await storage.getCampaignMessages(campaignId, 50000, 0);
      }
      
      // Build contactId -> hasReplied lookup
      const contactReplied = new Set<string>();
      for (const m of campaignMsgs) {
        if ((m as any).repliedAt && (m as any).contactId) {
          contactReplied.add((m as any).contactId);
        }
      }
      
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
        await this.executeFollowup(execution.id, campaignMsgs);
      }
    }
  }

  /**
   * Execute a specific follow-up email
   * @param executionId - the follow-up execution record ID
   * @param preloadedCampaignMsgs - optional pre-loaded campaign messages to avoid N+1 queries
   */
  private async executeFollowup(executionId: string, preloadedCampaignMsgs?: any[]): Promise<void> {
    try {
      const execution = await storage.getFollowupExecutionById(executionId);
      if (!execution || execution.status !== "pending") {
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

      // CRITICAL FIX: Before sending, check if the contact has replied to ANY message in this campaign
      // This catches replies that arrived between scheduling and execution
      // Use preloaded campaign messages if available; otherwise load once
      const allCampaignMsgs = preloadedCampaignMsgs && preloadedCampaignMsgs.length > 0
        ? preloadedCampaignMsgs
        : await storage.getCampaignMessages(campaign.id, 50000, 0);
      const contactMsgs = allCampaignMsgs.filter((m: any) => m.contactId === contact.id);
      const contactHasReplied = contactMsgs.some((m: any) => !!m.repliedAt);
      
      if (contactHasReplied && (step.trigger === 'no_reply' || step.trigger === 'if_no_reply' || step.trigger === 'no_matter_what' || step.trigger === 'time_delay')) {
        // For no_reply triggers, always skip if any reply exists
        if (step.trigger === 'no_reply' || step.trigger === 'if_no_reply') {
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
        // Reuse already-loaded campaign messages for threading lookup
        const step0Msg = allCampaignMsgs.find((m: any) => m.contactId === contact.id && (m.stepNumber || 0) === 0);
        if (step0Msg) {
          originalMessage = step0Msg;
          console.log(`[Followup] Found step-0 original message ${step0Msg.id} with providerMessageId=${step0Msg.providerMessageId}`);
        }
      }
      
      // Determine subject: if step has no subject or same subject, use "Re: <original>"
      const stepSubject = (execution.subject || step.subject || '').trim();
      const originalSubject = (originalMessage.subject || campaign.subject || '').trim();
      let followupSubject: string;
      
      if (!stepSubject || stepSubject === originalSubject) {
        // No custom subject or same subject → thread as reply
        const cleanSubject = originalSubject.replace(/^(Re:\s*)+/i, '').trim();
        followupSubject = cleanSubject ? `Re: ${cleanSubject}` : 'Follow-up';
      } else {
        // Different subject specified → use it (will create new thread)
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

      // Replace template variables in content
      let personalizedContent = content
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{email\}\}/g, contact.email || '')
        .replace(/\{\{company\}\}/g, contact.company || '')
        .replace(/\{\{jobTitle\}\}/g, contact.jobTitle || '')
        .replace(/\{\{topic\}\}/g, campaign.subject || campaign.name || '');
      
      let personalizedSubject = followupSubject
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{company\}\}/g, contact.company || '');

      // Build threading headers
      // Fetch the real threadId and Message-ID from Gmail for the original email
      let gmailThreadId: string | undefined;
      let originalMessageId = '';
      
      if (originalMessage.providerMessageId && campaign.organizationId) {
        try {
          // Use per-sender token resolution (same as EmailService)
          // Resolve the correct Gmail account that sent the original email
          let senderEmail: string | undefined;
          if (campaign.emailAccountId) {
            try {
              const emailAccount = await storage.getEmailAccount(campaign.emailAccountId);
              if (emailAccount?.email) senderEmail = emailAccount.email;
            } catch (e) {}
          }
          
          const tokenResult = await this.emailService.getGmailAccessToken(campaign.organizationId, senderEmail);
          let accessToken = tokenResult?.token || null;
          
          if (accessToken) {
            const msgResp = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${originalMessage.providerMessageId}?format=metadata&metadataHeaders=Message-ID`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (msgResp.ok) {
              const msgData = await msgResp.json() as any;
              // Get the real Gmail threadId
              gmailThreadId = msgData.threadId;
              // Get the real Message-ID header
              const msgIdHeader = (msgData.payload?.headers || []).find(
                (h: any) => h.name.toLowerCase() === 'message-id'
              );
              if (msgIdHeader) {
                originalMessageId = msgIdHeader.value;
              }
            }
          }
        } catch (e) {
          console.log(`[Followup] Could not fetch original Message-ID, will rely on threadId for threading`);
        }
      }

      console.log(`[Followup] Threading: subject="${personalizedSubject}", threadId=${gmailThreadId || 'none'}, inReplyTo=${originalMessageId || 'none'}`);

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
          emailAccountId: campaign.emailAccountId,
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
        
        console.error(`[Followup] Failed to send follow-up to ${contact.email}:`, emailResult.error);
      }
      
    } catch (error) {
      console.error("Error executing follow-up:", error);
      await storage.updateFollowupExecution(executionId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error"
      });
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

// Auto-process follow-ups every 60 seconds (to handle minute-level delays)
let followupInterval: NodeJS.Timeout | null = null;

export function startFollowupEngine() {
  if (followupInterval) return;
  console.log('[Followup] Starting follow-up engine (checking every 30s)...');
  // Run immediately on start
  followupEngine.processFollowupTriggers().catch(console.error);
  // Then run every 30 seconds
  followupInterval = setInterval(() => {
    followupEngine.processFollowupTriggers().catch(console.error);
  }, 30 * 1000);
}

export function stopFollowupEngine() {
  if (followupInterval) {
    clearInterval(followupInterval);
    followupInterval = null;
    console.log('[Followup] Follow-up engine stopped');
  }
}