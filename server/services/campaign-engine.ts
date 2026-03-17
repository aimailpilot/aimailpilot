import { storage } from '../storage';
import { smtpEmailService, type SmtpConfig, type SendResult, getProviderDailyLimit } from './smtp-email-service';

/**
 * Send email via Gmail API using OAuth access token.
 * Returns SendResult compatible with SMTP service.
 */
async function sendViaGmailAPI(
  accessToken: string,
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<SendResult> {
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

    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64 }),
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

/**
 * Send email via Microsoft Graph API using OAuth access token.
 */
async function sendViaMicrosoftGraph(
  accessToken: string,
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<SendResult> {
  try {
    const message: any = {
      subject: opts.subject,
      body: { contentType: 'HTML', content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    };
    
    // Only set 'from' if explicitly provided and different from the auth user
    // For personal Microsoft accounts, omitting 'from' lets Graph use the authenticated user
    if (opts.from) {
      message.from = { emailAddress: { address: opts.from } };
    }
    
    // Add custom headers if provided (X- headers for tracking)
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      message.internetMessageHeaders = Object.entries(opts.headers)
        .map(([name, value]) => ({ name, value }));
    }

    const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[MicrosoftGraph] Send failed to ${opts.to}: status=${resp.status}, error=${errText}`);
      
      // If the error is about custom headers, retry without them
      if (resp.status === 400 && errText.includes('internetMessageHeaders')) {
        console.log(`[MicrosoftGraph] Retrying without custom headers for ${opts.to}`);
        delete message.internetMessageHeaders;
        const retryResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (retryResp.ok) {
          return { success: true, messageId: `graph-${Date.now()}-noheaders` };
        }
        const retryErr = await retryResp.text();
        console.error(`[MicrosoftGraph] Retry without headers also failed: ${retryResp.status} ${retryErr}`);
      }
      
      // If error is about 'from' field, retry without it
      if (resp.status === 400 && (errText.includes('from') || errText.includes('From') || errText.includes('sender'))) {
        console.log(`[MicrosoftGraph] Retrying without explicit 'from' for ${opts.to}`);
        delete message.from;
        delete message.internetMessageHeaders;
        const retryResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (retryResp.ok) {
          return { success: true, messageId: `graph-${Date.now()}-nofrom` };
        }
        const retryErr = await retryResp.text();
        console.error(`[MicrosoftGraph] Retry without from also failed: ${retryResp.status} ${retryErr}`);
      }
      
      return { success: false, error: `Graph API error (${resp.status}): ${errText}` };
    }

    return { success: true, messageId: `graph-${Date.now()}` };
  } catch (err) {
    console.error(`[MicrosoftGraph] Exception sending to ${opts.to}:`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Refresh a Gmail access token if expired.
 */
async function refreshGmailToken(orgId: string, senderEmail?: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  
  // Try per-sender tokens first (for multi-account support)
  const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
  let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
  let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
  let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
  
  // Fall back to org-level tokens ONLY if no per-sender tokens exist at all
  // CRITICAL: Don't mix refresh tokens from different accounts!
  if (!accessToken && !refreshToken) {
    accessToken = settings.gmail_access_token;
    refreshToken = settings.gmail_refresh_token;
    tokenExpiry = settings.gmail_token_expiry;
  }
  
  const expiry = parseInt(tokenExpiry || '0');
  if (accessToken && Date.now() < expiry - 300000) {
    return accessToken;
  }
  if (!refreshToken) return accessToken || null;
  let clientId = settings.google_oauth_client_id || '';
  let clientSecret = settings.google_oauth_client_secret || '';
  
  // Fallback: try superadmin's org for OAuth credentials
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
  if (!clientId) clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientSecret) clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return accessToken || null;

  try {
    const { OAuth2Client } = await import('google-auth-library');
    const oauth2 = new OAuth2Client(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    if (credentials.access_token) {
      // Store refreshed tokens for the specific sender if applicable
      if (senderEmail) {
        await storage.setApiSetting(orgId, `${senderPrefix}access_token`, credentials.access_token);
        if (credentials.expiry_date) await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(credentials.expiry_date));
      } else {
        // Only update org-level tokens when NOT refreshing a per-sender token
        // CRITICAL: Don't overwrite org-level tokens with a secondary account's tokens!
        await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
        if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
      }
      return credentials.access_token;
    }
  } catch (e) { console.error('[CampaignEngine] Gmail token refresh failed:', e); }
  return accessToken || null;
}

/**
 * Refresh a Microsoft access token if expired.
 */
async function refreshMicrosoftToken(orgId: string, senderEmail?: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  
  // Try per-sender tokens first (for multi-account support)
  const senderPrefix = senderEmail ? `outlook_sender_${senderEmail}_` : '';
  let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
  let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
  let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
  let isPerSender = !!(accessToken || refreshToken);
  
  // Fall back to org-level tokens ONLY if no per-sender tokens exist at all
  // CRITICAL: Don't mix refresh tokens from different accounts!
  if (!accessToken && !refreshToken) {
    accessToken = settings.microsoft_access_token;
    refreshToken = settings.microsoft_refresh_token;
    tokenExpiry = settings.microsoft_token_expiry;
    isPerSender = false;
  }
  
  const expiry = parseInt(tokenExpiry || '0');
  if (accessToken && Date.now() < expiry - 300000) {
    return accessToken;
  }
  if (!refreshToken) return accessToken || null;
  let clientId = settings.microsoft_oauth_client_id || '';
  let clientSecret = settings.microsoft_oauth_client_secret || '';

  // Fallback: try superadmin's org for OAuth credentials
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
  if (!clientId || !clientSecret) return accessToken || null;

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
        // Store refreshed tokens for the specific sender if applicable
        if (senderEmail) {
          await storage.setApiSetting(orgId, `${senderPrefix}access_token`, tokens.access_token);
          if (tokens.refresh_token) await storage.setApiSetting(orgId, `${senderPrefix}refresh_token`, tokens.refresh_token);
          const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
          await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(exp));
        } else {
          // Only update org-level tokens when NOT refreshing a per-sender token
          // CRITICAL: Don't overwrite org-level tokens with a secondary account's tokens!
          await storage.setApiSetting(orgId, 'microsoft_access_token', tokens.access_token);
          if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
          const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
          await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
        }
        return tokens.access_token;
      }
    }
  } catch (e) { console.error('[CampaignEngine] Microsoft token refresh failed:', e); }
  return accessToken || null;
}

interface AutopilotDaySchedule {
  enabled: boolean;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
}

interface AutopilotConfig {
  enabled: boolean;
  days: { [dayName: string]: AutopilotDaySchedule };
  maxPerDay: number;
  delayBetween: number;
  delayUnit: 'seconds' | 'minutes';
}

interface SendingConfig {
  delayBetweenEmails: number;
  batchSize?: number;
  autopilot?: AutopilotConfig | null;
  timezoneOffset?: number | null; // minutes offset from UTC (e.g. -330 for IST)
}

interface CampaignSendOptions {
  campaignId: string;
  delayBetweenEmails?: number; // ms between each email (throttling)
  batchSize?: number;
  startTime?: Date;
  stepNumber?: number; // which step in the sequence (0 = initial, 1+ = follow-ups)
  sendingConfig?: SendingConfig | null;
}

interface PersonalizationData {
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  [key: string]: any;
}

export class CampaignEngine {
  private activeCampaigns: Map<string, { timer: any; paused: boolean; progress: number; total: number }> = new Map();
  private _publicBaseUrl: string | null = null;

  /**
   * Check if we're currently within the allowed sending window based on autopilot config.
   * Returns { canSend, reason, pauseUntilMs } where pauseUntilMs is the ms to wait until the next window opens.
   */
  private checkSendingWindow(sendingConfig: SendingConfig | null | undefined): { canSend: boolean; reason?: string; pauseUntilMs?: number } {
    if (!sendingConfig?.autopilot?.enabled) return { canSend: true };

    const autopilot = sendingConfig.autopilot;
    // Calculate user's local time using their timezone offset
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    // timezoneOffset is browser's getTimezoneOffset() which is minutes behind UTC (e.g. IST = -330)
    // So user's local time = UTC - timezoneOffset
    const userLocalMs = utcMs - (sendingConfig.timezoneOffset || 0) * 60000;
    const userLocal = new Date(userLocalMs);
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[userLocal.getDay()];
    const dayConfig = autopilot.days?.[dayName];

    if (!dayConfig || !dayConfig.enabled) {
      // Find next enabled day
      const pauseMs = this.msUntilNextSendWindow(autopilot, sendingConfig.timezoneOffset || 0);
      return { canSend: false, reason: `Sending disabled on ${dayName}`, pauseUntilMs: pauseMs };
    }

    // Check time window for today
    const currentHH = String(userLocal.getHours()).padStart(2, '0');
    const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHH}:${currentMM}`;

    if (dayConfig.startTime && currentTime < dayConfig.startTime) {
      // Before start time — wait until start
      const [sh, sm] = dayConfig.startTime.split(':').map(Number);
      const startMs = new Date(userLocal);
      startMs.setHours(sh, sm, 0, 0);
      const waitMs = startMs.getTime() - userLocal.getTime();
      return { canSend: false, reason: `Before sending hours (starts at ${dayConfig.startTime})`, pauseUntilMs: Math.max(waitMs, 60000) };
    }

    if (dayConfig.endTime && currentTime >= dayConfig.endTime) {
      // After end time — wait until next day's window
      const pauseMs = this.msUntilNextSendWindow(autopilot, sendingConfig.timezoneOffset || 0);
      return { canSend: false, reason: `After sending hours (ended at ${dayConfig.endTime})`, pauseUntilMs: pauseMs };
    }

    return { canSend: true };
  }

  /**
   * Calculate how many ms until the next sending window opens.
   */
  private msUntilNextSendWindow(autopilot: AutopilotConfig, timezoneOffset: number): number {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const userLocalMs = utcMs - timezoneOffset * 60000;
    const userLocal = new Date(userLocalMs);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
      const checkDate = new Date(userLocal);
      checkDate.setDate(checkDate.getDate() + (daysAhead === 0 ? 0 : daysAhead));
      const dayName = dayNames[checkDate.getDay()];
      const dayConfig = autopilot.days?.[dayName];

      if (dayConfig?.enabled && dayConfig.startTime) {
        const [sh, sm] = dayConfig.startTime.split(':').map(Number);
        const windowStart = new Date(checkDate);
        windowStart.setHours(sh, sm, 0, 0);

        if (daysAhead === 0) {
          // Same day — check if the window hasn't ended yet or starts later today
          if (dayConfig.endTime) {
            const currentHH = String(userLocal.getHours()).padStart(2, '0');
            const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
            const currentTime = `${currentHH}:${currentMM}`;
            if (currentTime >= dayConfig.endTime) continue; // Window ended today, check tomorrow
          }
          if (windowStart.getTime() > userLocal.getTime()) {
            // Window starts later today
            return windowStart.getTime() - userLocal.getTime();
          }
          // We're currently in the window (shouldn't be called if canSend=true)
          continue;
        } else {
          // Future day — calculate ms until that day's start time
          windowStart.setDate(userLocal.getDate() + daysAhead);
          return windowStart.getTime() - userLocal.getTime();
        }
      }
    }
    // Fallback: wait 1 hour
    return 3600000;
  }

  /**
   * Set the public base URL for tracking links (call from route handler with req info).
   * Always forces HTTPS for non-localhost URLs since tracking pixels need to be loaded
   * from external email clients which often require HTTPS.
   */
  setPublicBaseUrl(url: string): void {
    let cleanUrl = url.replace(/\/$/, '');
    // Force HTTPS for any non-localhost URL (sandbox, production, etc.)
    if (!cleanUrl.includes('localhost') && !cleanUrl.includes('127.0.0.1')) {
      cleanUrl = cleanUrl.replace(/^http:\/\//, 'https://');
    }
    this._publicBaseUrl = cleanUrl;
  }

  /**
   * Get the base URL for tracking links.
   * Priority: manually set URL > env vars > localhost fallback.
   * All non-localhost URLs are forced to HTTPS.
   */
  getBaseUrl(): string {
    const url = this._publicBaseUrl || process.env.BASE_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    // Force HTTPS for non-localhost
    if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
      return url.replace(/^http:\/\//, 'https://');
    }
    return url;
  }

  /**
   * Personalize template content with contact data
   */
  personalizeContent(template: string, data: PersonalizationData): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        result = result.replace(regex, String(value));
      }
    }
    // Remove any remaining unresolved variables
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  /**
   * Start sending a campaign
   */
  async startCampaign(options: CampaignSendOptions): Promise<{ success: boolean; error?: string }> {
    const { campaignId, delayBetweenEmails = 2000, batchSize = 10, stepNumber = 0, sendingConfig: optSendingConfig } = options;
    
    console.log(`[CampaignEngine] startCampaign called: campaignId=${campaignId}, delayBetweenEmails=${delayBetweenEmails}ms, batchSize=${batchSize}, hasSendingConfig=${!!optSendingConfig}`);

    try {
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };

      if (!campaign.emailAccountId) return { success: false, error: 'No email account assigned to campaign' };
      if (!campaign.templateId && !campaign.subject) return { success: false, error: 'No template or subject set' };

      // Get email account
      const emailAccount = await storage.getEmailAccount(campaign.emailAccountId);
      if (!emailAccount) return { success: false, error: 'Email account not found' };
      if (!emailAccount.smtpConfig) return { success: false, error: 'Email account SMTP not configured' };

      // Get contacts for this campaign (batch-loaded to avoid N+1 queries)
      let contacts: any[];
      if (campaign.segmentId) {
        contacts = await storage.getContactsBySegment(campaign.segmentId);
      } else if (campaign.contactIds && campaign.contactIds.length > 0) {
        // Bulk load all contacts in one query instead of one-by-one
        contacts = await storage.getContactsByIds(campaign.contactIds);
        // If contactIds were invalid (e.g. 'paste-0' placeholders), fall back to all org contacts
        if (contacts.length === 0) {
          console.warn(`[CampaignEngine] contactIds ${JSON.stringify(campaign.contactIds.slice(0, 5))} resolved to 0 contacts, falling back to all org contacts`);
          contacts = await storage.getContacts(campaign.organizationId, 10000, 0);
        }
      } else {
        contacts = await storage.getContacts(campaign.organizationId, 10000, 0);
      }

      // Filter out unsubscribed and bounced contacts
      contacts = contacts.filter(c => c.status !== 'unsubscribed' && c.status !== 'bounced');

      if (contacts.length === 0) return { success: false, error: 'No contacts to send to' };

      // ===== CRITICAL FIX: Skip contacts that already have messages for this campaign/step =====
      // This prevents duplicate sends when resuming a paused campaign
      try {
        const existingMessages = await storage.getCampaignMessages(campaignId, 100000, 0) as any[];
        if (existingMessages && existingMessages.length > 0) {
          // Build set of contactIds that already have a message for this step (sent, failed, or sending)
          const alreadyProcessedContactIds = new Set(
            existingMessages
              .filter((m: any) => (m.stepNumber || 0) === stepNumber)
              .map((m: any) => m.contactId)
          );
          
          if (alreadyProcessedContactIds.size > 0) {
            const beforeCount = contacts.length;
            contacts = contacts.filter(c => !alreadyProcessedContactIds.has(c.id));
            const skipped = beforeCount - contacts.length;
            if (skipped > 0) {
              console.log(`[CampaignEngine] Resuming campaign ${campaignId}: skipped ${skipped} already-processed contacts, ${contacts.length} remaining`);
            }
          }
        }
      } catch (e) {
        console.error('[CampaignEngine] Error checking existing messages, proceeding with all contacts:', e);
      }

      if (contacts.length === 0) {
        // All contacts already processed — check if follow-ups exist before marking completed
        const hasFollowups = await storage.hasActiveFollowupSteps(campaignId);
        if (hasFollowups) {
          console.log(`[CampaignEngine] All Step 1 contacts processed for campaign ${campaignId}. Follow-ups pending — status set to 'following_up'`);
          await storage.updateCampaign(campaignId, { status: 'following_up' });
        } else {
          console.log(`[CampaignEngine] All contacts already processed for campaign ${campaignId}, marking completed`);
          await storage.updateCampaign(campaignId, { status: 'completed' });
        }
        return { success: true };
      }

      // Get template if specified
      let subject = campaign.subject || '';
      let content = campaign.content || '';
      if (campaign.templateId) {
        const template = await storage.getEmailTemplate(campaign.templateId);
        if (template) {
          subject = template.subject;
          content = template.content;
        }
      }

      // Update campaign to active
      await storage.updateCampaign(campaignId, {
        status: 'active',
        totalRecipients: contacts.length,
      });

      // Track active campaign
      this.activeCampaigns.set(campaignId, {
        timer: null,
        paused: false,
        progress: 0,
        total: contacts.length,
      });

      // Load sendingConfig: prefer what was passed in options, then from the campaign DB record
      const savedConfig: SendingConfig | null = campaign.sendingConfig || null;
      const activeSendingConfig: SendingConfig = optSendingConfig || savedConfig || { delayBetweenEmails };
      
      // Use the configured delay from sendingConfig — this is the user's chosen delay (e.g. 2 minutes = 120000ms)
      // Fallback chain: sendingConfig.delayBetweenEmails > options.delayBetweenEmails > 2000ms default
      const effectiveDelay = activeSendingConfig.delayBetweenEmails || delayBetweenEmails;
      
      const ap = activeSendingConfig.autopilot;
      console.log(`[CampaignEngine] ===== CAMPAIGN START =====`);
      console.log(`[CampaignEngine] Campaign: ${campaignId}, Contacts: ${contacts.length}`);
      console.log(`[CampaignEngine] Delay between emails: ${effectiveDelay}ms (${(effectiveDelay / 1000).toFixed(0)}s)`);
      console.log(`[CampaignEngine] Autopilot: ${ap?.enabled ? 'ON' : 'OFF'}`);
      if (ap?.enabled) {
        console.log(`[CampaignEngine]   Max per day: ${ap.maxPerDay || 'unlimited'}`);
        console.log(`[CampaignEngine]   Delay config: ${ap.delayBetween} ${ap.delayUnit}`);
        console.log(`[CampaignEngine]   Timezone offset: ${activeSendingConfig.timezoneOffset ?? 'not set'}`);
        const enabledDays = Object.entries(ap.days || {}).filter(([_, d]) => d.enabled).map(([name, d]) => `${name}(${d.startTime}-${d.endTime})`);
        console.log(`[CampaignEngine]   Send days: ${enabledDays.join(', ')}`);
      }
      console.log(`[CampaignEngine] ==========================`);

      // Send emails in batches with throttling
      this.sendBatched(campaignId, contacts, emailAccount, subject, content, effectiveDelay, batchSize, stepNumber, activeSendingConfig);

      return { success: true };
    } catch (error) {
      console.error('Failed to start campaign:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send emails in batches with throttling and time-window enforcement
   */
  private async sendBatched(
    campaignId: string,
    contacts: any[],
    emailAccount: any,
    subject: string,
    content: string,
    delay: number,
    batchSize: number,
    stepNumber: number = 0,
    sendingConfig?: SendingConfig | null
  ): Promise<void> {
    const smtpConfig: SmtpConfig = emailAccount.smtpConfig;
    const tracker = this.activeCampaigns.get(campaignId);
    const baseUrl = this.getBaseUrl();
    
    // Pre-load campaign config once (avoid per-email DB read)
    const campaignConfig = await storage.getCampaign(campaignId);
    
    // Track sent/bounced counts locally to avoid re-reading campaign for every email
    let localSentCount = 0;
    let localBouncedCount = 0;
    let localFailedCount = 0; // Infrastructure failures (auth errors, etc.) — NOT real bounces
    // Batch size for DB count updates (flush every N emails)
    const FLUSH_INTERVAL = 25;
    
    // Track daily limit locally (refresh from DB on flush)
    // Use the account's stored dailyLimit, falling back to provider-based limit
    let accountDailySent = emailAccount.dailySent || 0;
    let accountDailyLimit = emailAccount.dailyLimit || getProviderDailyLimit(emailAccount.provider || smtpConfig?.provider || 'custom');

    // Track daily sends for autopilot maxPerDay enforcement (separate from account daily limit)
    let autopilotDailySent = 0;
    const autopilotMaxPerDay = sendingConfig?.autopilot?.enabled ? (sendingConfig.autopilot.maxPerDay || Infinity) : Infinity;
    
    console.log(`[CampaignEngine] Campaign ${campaignId} send loop starting: delay=${delay}ms, accountDailyLimit=${accountDailyLimit}, autopilotMaxPerDay=${autopilotMaxPerDay === Infinity ? 'unlimited' : autopilotMaxPerDay}, autopilotEnabled=${sendingConfig?.autopilot?.enabled || false}`);
    console.log(`[CampaignEngine] Campaign ${campaignId} sendingConfig: ${JSON.stringify(sendingConfig)?.slice(0, 500)}`);

    for (let i = 0; i < contacts.length; i++) {
      // Check if paused or stopped
      if (!tracker || tracker.paused) {
        // Wait until resumed
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            const t = this.activeCampaigns.get(campaignId);
            if (!t) { clearInterval(check); resolve(); return; }
            if (!t.paused) { clearInterval(check); resolve(); }
          }, 1000);
        });
      }

      // Check if campaign was deleted/stopped
      if (!this.activeCampaigns.has(campaignId)) break;

      // ===== TIME WINDOW ENFORCEMENT =====
      // Check if we're within the allowed sending window based on autopilot schedule
      const windowCheck = this.checkSendingWindow(sendingConfig);
      if (!windowCheck.canSend) {
        console.log(`[CampaignEngine] Campaign ${campaignId} outside sending window: ${windowCheck.reason}. Pausing for ${Math.round((windowCheck.pauseUntilMs || 0) / 60000)} minutes.`);
        
        // Flush any pending counts before sleeping
        if (localSentCount > 0 || localBouncedCount > 0) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }

        // Auto-pause the campaign and wait until next window
        await storage.updateCampaign(campaignId, { status: 'paused' });
        if (tracker) tracker.paused = true;

        // Sleep until the next sending window opens (check every 60s in case of manual resume)
        const sleepUntil = Date.now() + (windowCheck.pauseUntilMs || 3600000);
        while (Date.now() < sleepUntil) {
          // Check if campaign was stopped or deleted during sleep
          if (!this.activeCampaigns.has(campaignId)) return;
          
          // Re-check sending window periodically (in case timezone/schedule changed)
          const recheck = this.checkSendingWindow(sendingConfig);
          if (recheck.canSend) break;
          
          await new Promise(resolve => setTimeout(resolve, 60000)); // Check every 60 seconds
        }

        // Check again if campaign still exists after sleeping
        if (!this.activeCampaigns.has(campaignId)) return;

        // Resume the campaign
        if (tracker) tracker.paused = false;
        await storage.updateCampaign(campaignId, { status: 'active' });
        console.log(`[CampaignEngine] Campaign ${campaignId} sending window opened, resuming.`);
        
        // Reset daily counters when a new day starts
        autopilotDailySent = 0;
      }

      // ===== AUTOPILOT MAX PER DAY ENFORCEMENT =====
      if (autopilotDailySent >= autopilotMaxPerDay) {
        console.log(`[CampaignEngine] Campaign ${campaignId} reached autopilot daily limit (${autopilotMaxPerDay}). Pausing until next window.`);
        
        // Flush counts
        if (localSentCount > 0 || localBouncedCount > 0) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }

        // Pause until next day's window
        await storage.updateCampaign(campaignId, { status: 'paused' });
        if (tracker) tracker.paused = true;
        
        const sleepMs = this.msUntilNextSendWindow(sendingConfig?.autopilot!, sendingConfig?.timezoneOffset || 0);
        const sleepUntil = Date.now() + sleepMs;
        while (Date.now() < sleepUntil) {
          if (!this.activeCampaigns.has(campaignId)) return;
          await new Promise(resolve => setTimeout(resolve, 60000));
        }

        if (!this.activeCampaigns.has(campaignId)) return;
        if (tracker) tracker.paused = false;
        await storage.updateCampaign(campaignId, { status: 'active' });
        autopilotDailySent = 0;
        console.log(`[CampaignEngine] Campaign ${campaignId} daily limit reset, resuming.`);
      }

      const contact = contacts[i];

      try {
        // Daily limit enforcement: check before each email
        if (accountDailySent + localSentCount >= accountDailyLimit) {
          console.warn(`[CampaignEngine] Daily limit reached (${accountDailyLimit}) for account ${emailAccount.email}. Pausing campaign at ${i}/${contacts.length} until daily reset.`);
          // Flush counts before pausing
          if (localSentCount > 0 || localBouncedCount > 0) {
            const updatedCampaign = await storage.getCampaign(campaignId);
            if (updatedCampaign) {
              await storage.updateCampaign(campaignId, {
                sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
                bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
              });
            }
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            localSentCount = 0;
            localBouncedCount = 0;
          }
          
          // Sleep until next day (check every 5 minutes for daily reset)
          // Instead of permanently stopping, pause and wait for daily counter reset
          await storage.updateCampaign(campaignId, { status: 'paused' });
          if (tracker) tracker.paused = true;
          
          console.log(`[CampaignEngine] Campaign ${campaignId} sleeping until daily limit resets...`);
          
          // Wait up to 24 hours, checking every 5 minutes if daily limit has been reset
          const maxWait = Date.now() + 24 * 60 * 60 * 1000;
          while (Date.now() < maxWait) {
            if (!this.activeCampaigns.has(campaignId)) return; // Campaign was stopped
            
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes
            
            // Re-check daily limit (counters reset at midnight)
            const refreshedAccount = await storage.getEmailAccount(emailAccount.id) as any;
            if (refreshedAccount) {
              accountDailySent = refreshedAccount.dailySent || 0;
              if (accountDailySent < accountDailyLimit) {
                console.log(`[CampaignEngine] Campaign ${campaignId} daily limit reset (${accountDailySent}/${accountDailyLimit}), resuming.`);
                break;
              }
            }
          }
          
          if (!this.activeCampaigns.has(campaignId)) return;
          if (tracker) tracker.paused = false;
          await storage.updateCampaign(campaignId, { status: 'active' });
        }
        // Personalize
        const personalData: PersonalizationData = {
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          email: contact.email,
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
          // Spread any customFields so {{customKey}} also works
          ...(contact.customFields || {}),
        };

        const personalizedSubject = this.personalizeContent(subject, personalData);
        const personalizedContent = this.personalizeContent(content, personalData);

        // Generate tracking ID
        const trackingId = `${campaignId}_${contact.id}_${Date.now()}`;

        // Add unsubscribe link if campaign has it enabled
        let contentWithUnsub = personalizedContent;
        if (campaignConfig?.includeUnsubscribe) {
          const unsubUrl = `${baseUrl}/api/track/unsubscribe/${trackingId}`;
          contentWithUnsub += `<p style="text-align:center;margin-top:30px;font-size:11px;color:#999;"><a href="${unsubUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a></p>`;
        }

        // Add open tracking pixel (with absolute URL)
        const trackedContent = this.addTrackingPixel(contentWithUnsub, trackingId, baseUrl);

        // Add click tracking to links (with absolute URL)
        const clickTrackedContent = this.addClickTracking(trackedContent, trackingId, baseUrl);

        // Generate a unique Message-ID for reply tracking
        const messageId = `<${trackingId}@${(smtpConfig.fromEmail || 'noreply@aimailpilot.com').split('@')[1] || 'aimailpilot.com'}>`;

        // Create message record with step number
        const messageRecord = await storage.createCampaignMessage({
          campaignId,
          contactId: contact.id,
          subject: personalizedSubject,
          content: clickTrackedContent,
          status: 'sending',
          trackingId,
          emailAccountId: emailAccount.id,
          stepNumber,
          messageId,
        });

        // Send email — try API methods first (Gmail API / Microsoft Graph), fall back to SMTP
        const emailHeaders: Record<string, string> = {
          'Message-ID': messageId,
          'X-AImailPilot-Campaign': campaignId,
          'X-AImailPilot-Contact': contact.id,
          'X-AImailPilot-Tracking': trackingId,
          'X-AImailPilot-Step': String(stepNumber),
        };

        let result: SendResult;
        const provider = emailAccount.provider || smtpConfig?.provider || '';
        const fromEmail = smtpConfig?.fromEmail || emailAccount.email || '';
        const orgId = emailAccount.organizationId || '';

        // Detect if this account uses OAuth (password is a placeholder, not real SMTP creds)
        const isOAuthAccount = smtpConfig?.auth?.pass === 'OAUTH_TOKEN';

        if (provider === 'gmail' || provider === 'google') {
          // Try Gmail API first
          const accessToken = await refreshGmailToken(orgId, fromEmail);
          if (accessToken) {
            console.log(`[CampaignEngine] Sending via Gmail API to ${contact.email}`);
            result = await sendViaGmailAPI(accessToken, {
              from: smtpConfig?.fromName ? `${smtpConfig.fromName} <${fromEmail}>` : fromEmail,
              to: contact.email,
              subject: personalizedSubject,
              html: clickTrackedContent,
              headers: emailHeaders,
            });
            // If Gmail API fails with auth error, only fall back to SMTP if we have real SMTP credentials
            if (!result.success && result.error?.includes('401')) {
              if (!isOAuthAccount) {
                console.log(`[CampaignEngine] Gmail API auth failed, falling back to SMTP for ${contact.email}`);
                result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
                  to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
                });
              } else {
                console.error(`[CampaignEngine] Gmail API auth failed for OAuth account ${fromEmail}. No SMTP fallback available. User needs to re-authenticate.`);
                result = { success: false, error: `Gmail OAuth token expired for ${fromEmail}. Please re-authenticate with Google in Account Settings.` };
              }
            }
          } else if (!isOAuthAccount) {
            // No OAuth token but has real SMTP credentials — use SMTP
            result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
              to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
            });
          } else {
            // OAuth account but no token available
            console.error(`[CampaignEngine] No Gmail OAuth token for ${fromEmail}. User needs to re-authenticate.`);
            result = { success: false, error: `Gmail OAuth tokens not found for ${fromEmail}. Please re-authenticate with Google in Account Settings.` };
          }
        } else if (provider === 'outlook' || provider === 'microsoft') {
          // Try Microsoft Graph API first
          console.log(`[CampaignEngine] Outlook send: orgId=${orgId}, fromEmail=${fromEmail}, isOAuth=${isOAuthAccount}, provider=${provider}`);
          let accessToken = await refreshMicrosoftToken(orgId, fromEmail);
          if (accessToken) {
            console.log(`[CampaignEngine] Sending via Microsoft Graph to ${contact.email} (token len=${accessToken.length})`);
            result = await sendViaMicrosoftGraph(accessToken, {
              from: fromEmail,
              to: contact.email,
              subject: personalizedSubject,
              html: clickTrackedContent,
              headers: emailHeaders,
            });
            // If Graph fails with auth error, attempt a force token refresh and retry once
            if (!result.success && (result.error?.includes('401') || result.error?.includes('403') || result.error?.includes('InvalidAuthenticationToken'))) {
              console.log(`[CampaignEngine] Graph API auth failed for ${fromEmail}, forcing token refresh and retry...`);
              // Force refresh by clearing cached expiry
              try {
                await storage.setApiSetting(orgId, `outlook_sender_${fromEmail}_token_expiry`, '0');
              } catch (e) { /* ignore */ }
              const retryToken = await refreshMicrosoftToken(orgId, fromEmail);
              if (retryToken && retryToken !== accessToken) {
                console.log(`[CampaignEngine] Token refreshed, retrying Graph API for ${contact.email}`);
                result = await sendViaMicrosoftGraph(retryToken, {
                  from: fromEmail,
                  to: contact.email,
                  subject: personalizedSubject,
                  html: clickTrackedContent,
                  headers: emailHeaders,
                });
              }
              // If still failing after retry, fall back to SMTP if available
              if (!result.success) {
                if (!isOAuthAccount) {
                  console.log(`[CampaignEngine] Graph API retry failed, falling back to SMTP for ${contact.email}`);
                  result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
                    to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
                  });
                } else {
                  console.error(`[CampaignEngine] Microsoft Graph auth failed for OAuth account ${fromEmail} after retry. No SMTP fallback available.`);
                  result = { success: false, error: `Microsoft OAuth token expired for ${fromEmail}. Please re-authenticate in Account Settings.` };
                }
              }
            }
          } else if (!isOAuthAccount) {
            // No OAuth token but has real SMTP credentials — use SMTP
            console.log(`[CampaignEngine] No OAuth token for Outlook ${fromEmail}, attempting SMTP with password`);
            result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
              to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
            });
            // If SMTP fails with auth error for Outlook, it likely means basic auth is disabled
            if (!result.success && result.error) {
              const isAuthError = result.error.includes('535') || result.error.includes('Authentication') || 
                result.error.includes('auth') || result.error.includes('Login') ||
                result.error.includes('AUTHENTICATE') || result.error.includes('credentials');
              if (isAuthError) {
                console.error(`[CampaignEngine] Outlook SMTP basic auth failed for ${fromEmail}. Microsoft has disabled basic authentication. Account must be re-connected via OAuth.`);
                result = { success: false, error: `Outlook SMTP authentication failed for ${fromEmail}. Microsoft has disabled basic password authentication. Please remove this account and re-add it using "Connect Outlook" (OAuth) in Account Settings.` };
              }
            }
          } else {
            // OAuth account but no token available
            console.error(`[CampaignEngine] No Microsoft OAuth token for ${fromEmail}. User needs to re-authenticate.`);
            result = { success: false, error: `Microsoft OAuth tokens not found for ${fromEmail}. Please re-authenticate in Account Settings.` };
          }
        } else {
          // Other providers — SMTP only
          result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
            to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
          });
        }

        const nowIso = new Date().toISOString();

        if (result.success) {
          await storage.updateCampaignMessage(messageRecord.id, {
            status: 'sent',
            sentAt: nowIso,
            providerMessageId: result.messageId,
          });
          
          localSentCount++;
          autopilotDailySent++;

          // Create 'sent' tracking event
          await storage.createTrackingEvent({
            type: 'sent',
            campaignId,
            messageId: messageRecord.id,
            contactId: contact.id,
            trackingId,
            stepNumber,
          });
        } else {
          await storage.updateCampaignMessage(messageRecord.id, {
            status: 'failed',
            errorMessage: result.error,
          });
          
          // Determine if this is a real bounce vs a sending infrastructure failure
          // OAuth errors, token issues, API errors are NOT bounces — the email never left
          const errorStr = (result.error || '').toLowerCase();
          const isInfrastructureError = errorStr.includes('oauth') || errorStr.includes('token') ||
            errorStr.includes('re-authenticate') || errorStr.includes('401') || errorStr.includes('403') ||
            (errorStr.includes('smtp') && errorStr.includes('auth')) || errorStr.includes('credentials') ||
            errorStr.includes('graph api error') || errorStr.includes('api error') || 
            errorStr.includes('connection refused') ||
            errorStr.includes('getaddrinfo') || errorStr.includes('timeout') ||
            errorStr.includes('invalidauthenticationtoken') || errorStr.includes('errormessage');
          
          if (isInfrastructureError) {
            // Infrastructure/auth failure — do NOT count as bounce, do NOT mark contact as bounced
            console.warn(`[CampaignEngine] Infrastructure error for ${contact.email}: ${result.error?.slice(0, 100)}`);
            
            // If ALL contacts are failing due to the same auth issue, pause the campaign to prevent mass failures
            localFailedCount++;
            
            // After 3 consecutive infrastructure failures, auto-pause the campaign
            if (localFailedCount >= 3 && localSentCount === 0) {
              console.error(`[CampaignEngine] Auto-pausing campaign ${campaignId}: ${localFailedCount} consecutive infrastructure failures. Error: ${result.error?.slice(0, 200)}`);
              // Flush counts before pausing
              const pauseCampaign = await storage.getCampaign(campaignId);
              if (pauseCampaign) {
                await storage.updateCampaign(campaignId, {
                  status: 'paused',
                  // Do NOT add infrastructure failures to bouncedCount — they're not real bounces
                });
              }
              this.activeCampaigns.delete(campaignId);
              return; // Stop sending
            }
          } else {
            // Real bounce (invalid email, mailbox full, etc.) — count as bounce
            localBouncedCount++;

            // Create 'bounce' tracking event
            await storage.createTrackingEvent({
              type: 'bounce',
              campaignId,
              messageId: messageRecord.id,
              contactId: contact.id,
              trackingId,
              stepNumber,
              metadata: { error: result.error },
            });

            // Only mark contact as bounced for real delivery failures
            try {
              await storage.updateContact(contact.id, { status: 'bounced' });
              console.log(`[CampaignEngine] Contact ${contact.email} (${contact.id}) marked as bounced`);
            } catch (e) {
              console.error(`[CampaignEngine] Failed to mark contact ${contact.email} (${contact.id}) as bounced:`, e);
            }
          }
        }
        
        // Periodically flush campaign stats to DB (every FLUSH_INTERVAL emails)
        if ((i + 1) % FLUSH_INTERVAL === 0 || i === contacts.length - 1) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          // Update daily sent count on email account
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }
      } catch (emailError) {
        // Log the error but continue to next email — don't crash the entire campaign loop
        console.error(`[CampaignEngine] Error sending email ${i + 1}/${contacts.length} to ${contact.email}:`, emailError);
      }

      // Update progress
      if (tracker) {
        tracker.progress = i + 1;
      }

      // Throttle between emails using the configured delay
      if (i < contacts.length - 1) {
        if (i === 0) {
          console.log(`[CampaignEngine] Campaign ${campaignId}: First email sent. Waiting ${delay}ms (${(delay / 1000).toFixed(0)}s) before next email.`);
        } else if (i % 25 === 0) {
          console.log(`[CampaignEngine] Campaign ${campaignId}: Progress ${i + 1}/${contacts.length}. Delay=${delay}ms between emails.`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Campaign completed — final flush of any remaining counts
    if (localSentCount > 0 || localBouncedCount > 0) {
      try {
        const flushCampaign = await storage.getCampaign(campaignId);
        if (flushCampaign) {
          await storage.updateCampaign(campaignId, {
            sentCount: (flushCampaign.sentCount || 0) + localSentCount,
            bouncedCount: (flushCampaign.bouncedCount || 0) + localBouncedCount,
          });
        }
        if (localSentCount > 0) {
          await storage.incrementDailySent(emailAccount.id, localSentCount);
        }
        console.log(`[CampaignEngine] Final flush: +${localSentCount} sent, +${localBouncedCount} bounced for campaign ${campaignId}`);
        localSentCount = 0;
        localBouncedCount = 0;
      } catch (e) {
        console.error(`[CampaignEngine] Final flush error for campaign ${campaignId}:`, e);
      }
    }

    const finalCampaign = await storage.getCampaign(campaignId);
    if (finalCampaign && finalCampaign.status === 'active') {
      // Check if this campaign has active follow-up steps pending
      // If so, mark as 'following_up' instead of 'completed' so follow-ups can proceed
      const hasFollowups = await storage.hasActiveFollowupSteps(campaignId);
      if (hasFollowups) {
        await storage.updateCampaign(campaignId, { status: 'following_up' });
        console.log(`[CampaignEngine] Campaign ${campaignId} Step 1 complete. Follow-up steps pending — status set to 'following_up'`);
      } else {
        await storage.updateCampaign(campaignId, { status: 'completed' });
        console.log(`[CampaignEngine] Campaign ${campaignId} completed (no follow-up steps)`);
      }
    }
    this.activeCampaigns.delete(campaignId);
  }

  /**
   * Add open tracking pixel to HTML (with absolute URL)
   * Uses cache-busting parameter to prevent email proxy caching
   */
  private addTrackingPixel(html: string, trackingId: string, baseUrl: string): string {
    const cacheBuster = Date.now();
    const pixel = `<img src="${baseUrl}/api/track/open/${trackingId}?cb=${cacheBuster}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
    // Insert before closing body tag, or append
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
  }

  /**
   * Replace links with tracked URLs (with absolute URL)
   */
  private addClickTracking(html: string, trackingId: string, baseUrl: string): string {
    return html.replace(
      /href="(https?:\/\/[^"]+)"/gi,
      (match, url) => {
        // Don't track unsubscribe links (they're already tracked)
        if (url.includes('/api/track/')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
      }
    );
  }

  /**
   * Pause a campaign
   */
  pauseCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      tracker.paused = true;
      storage.updateCampaign(campaignId, { status: 'paused' });
      return true;
    }
    return false;
  }

  /**
   * Resume a paused campaign
   */
  resumeCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      tracker.paused = false;
      storage.updateCampaign(campaignId, { status: 'active' });
      return true;
    }
    return false;
  }

  /**
   * Stop/cancel a campaign
   */
  stopCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      this.activeCampaigns.delete(campaignId);
      storage.updateCampaign(campaignId, { status: 'paused' });
      return true;
    }
    return false;
  }

  /**
   * Get campaign sending progress
   */
  getCampaignProgress(campaignId: string): { active: boolean; paused: boolean; progress: number; total: number } | null {
    const tracker = this.activeCampaigns.get(campaignId);
    if (!tracker) return null;
    return {
      active: true,
      paused: tracker.paused,
      progress: tracker.progress,
      total: tracker.total,
    };
  }

  /**
   * Schedule a campaign to start at a specific time
   */
  scheduleCampaign(campaignId: string, startTime: Date, options?: Partial<CampaignSendOptions>): void {
    const delay = startTime.getTime() - Date.now();
    if (delay <= 0) {
      this.startCampaign({ campaignId, ...options });
      return;
    }

    storage.updateCampaign(campaignId, { 
      status: 'scheduled',
      scheduledAt: startTime.toISOString(),
    });

    setTimeout(() => {
      this.startCampaign({ campaignId, ...options });
    }, delay);
  }

  /**
   * Resume all active campaigns after server restart.
   * Finds campaigns with status 'active' in DB and re-starts the send loop.
   * The startCampaign method already skips contacts that were already sent to.
   */
  async resumeActiveCampaigns(): Promise<void> {
    try {
      const allOrgs = await storage.getAllOrganizationIds();
      let resumedCount = 0;
      
      for (const orgId of allOrgs) {
        const campaigns = await storage.getCampaigns(orgId) as any[];
        for (const campaign of campaigns) {
          if (campaign.status === 'active' && !this.activeCampaigns.has(campaign.id)) {
            console.log(`[CampaignEngine] Auto-resuming active campaign "${campaign.name}" (${campaign.id}) for org ${orgId}`);
            try {
              const result = await this.startCampaign({
                campaignId: campaign.id,
                sendingConfig: campaign.sendingConfig || undefined,
              });
              if (result.success) {
                resumedCount++;
                console.log(`[CampaignEngine] Successfully resumed campaign ${campaign.id}`);
              } else {
                console.warn(`[CampaignEngine] Failed to resume campaign ${campaign.id}: ${result.error}`);
              }
            } catch (e) {
              console.error(`[CampaignEngine] Error resuming campaign ${campaign.id}:`, e);
            }
          }
        }
      }
      
      if (resumedCount > 0) {
        console.log(`[CampaignEngine] Auto-resumed ${resumedCount} active campaign(s) after server restart`);
      } else {
        console.log(`[CampaignEngine] No active campaigns to resume`);
      }
    } catch (error) {
      console.error('[CampaignEngine] Error resuming active campaigns:', error);
    }
  }
}

// Singleton
export const campaignEngine = new CampaignEngine();
