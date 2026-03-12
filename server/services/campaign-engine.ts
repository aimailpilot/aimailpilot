import { storage } from '../storage';
import { smtpEmailService, type SmtpConfig, type SendResult } from './smtp-email-service';

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
    const message = {
      subject: opts.subject,
      body: { contentType: 'HTML', content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
      from: { emailAddress: { address: opts.from } },
      internetMessageHeaders: opts.headers
        ? Object.entries(opts.headers).map(([name, value]) => ({ name, value }))
        : undefined,
    };

    const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Graph API error (${resp.status}): ${errText}` };
    }

    return { success: true, messageId: `graph-${Date.now()}` };
  } catch (err) {
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
  
  // Fall back to org-level tokens
  if (!accessToken) accessToken = settings.gmail_access_token;
  if (!refreshToken) refreshToken = settings.gmail_refresh_token;
  if (!tokenExpiry) tokenExpiry = settings.gmail_token_expiry;
  
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
      }
      // Also update org-level tokens
      await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
      if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
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
  
  // Fall back to org-level tokens
  if (!accessToken) accessToken = settings.microsoft_access_token;
  if (!refreshToken) refreshToken = settings.microsoft_refresh_token;
  if (!tokenExpiry) tokenExpiry = settings.microsoft_token_expiry;
  
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
      scope: 'openid profile email offline_access User.Read Mail.Read Mail.Send',
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
        }
        // Also update org-level tokens
        await storage.setApiSetting(orgId, 'microsoft_access_token', tokens.access_token);
        if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
        const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
        await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
        return tokens.access_token;
      }
    }
  } catch (e) { console.error('[CampaignEngine] Microsoft token refresh failed:', e); }
  return accessToken || null;
}

interface CampaignSendOptions {
  campaignId: string;
  delayBetweenEmails?: number; // ms between each email (throttling)
  batchSize?: number;
  startTime?: Date;
  stepNumber?: number; // which step in the sequence (0 = initial, 1+ = follow-ups)
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
    const { campaignId, delayBetweenEmails = 2000, batchSize = 10, stepNumber = 0 } = options;

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
        // All contacts already processed — mark campaign as completed
        console.log(`[CampaignEngine] All contacts already processed for campaign ${campaignId}, marking completed`);
        await storage.updateCampaign(campaignId, { status: 'completed' });
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

      // Send emails in batches with throttling
      this.sendBatched(campaignId, contacts, emailAccount, subject, content, delayBetweenEmails, batchSize, stepNumber);

      return { success: true };
    } catch (error) {
      console.error('Failed to start campaign:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send emails in batches with throttling
   */
  private async sendBatched(
    campaignId: string,
    contacts: any[],
    emailAccount: any,
    subject: string,
    content: string,
    delay: number,
    batchSize: number,
    stepNumber: number = 0
  ): Promise<void> {
    const smtpConfig: SmtpConfig = emailAccount.smtpConfig;
    const tracker = this.activeCampaigns.get(campaignId);
    const baseUrl = this.getBaseUrl();
    
    // Pre-load campaign config once (avoid per-email DB read)
    const campaignConfig = await storage.getCampaign(campaignId);
    
    // Track sent/bounced counts locally to avoid re-reading campaign for every email
    let localSentCount = 0;
    let localBouncedCount = 0;
    // Batch size for DB count updates (flush every N emails)
    const FLUSH_INTERVAL = 25;
    
    // Track daily limit locally (refresh from DB on flush)
    let accountDailySent = emailAccount.dailySent || 0;
    let accountDailyLimit = emailAccount.dailyLimit || 500;

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

      const contact = contacts[i];

      try {
        // Daily limit enforcement: check before each email
        if (accountDailySent + localSentCount >= accountDailyLimit) {
          console.warn(`[CampaignEngine] Daily limit reached (${accountDailyLimit}) for account ${emailAccount.email}. Pausing campaign at ${i}/${contacts.length}.`);
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
          await storage.updateCampaign(campaignId, { status: 'paused' });
          this.activeCampaigns.delete(campaignId);
          return; // Stop sending
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
          const accessToken = await refreshMicrosoftToken(orgId, fromEmail);
          if (accessToken) {
            console.log(`[CampaignEngine] Sending via Microsoft Graph to ${contact.email}`);
            result = await sendViaMicrosoftGraph(accessToken, {
              from: fromEmail,
              to: contact.email,
              subject: personalizedSubject,
              html: clickTrackedContent,
              headers: emailHeaders,
            });
            // If Graph fails with auth error, only fall back to SMTP if we have real SMTP credentials
            if (!result.success && (result.error?.includes('401') || result.error?.includes('403'))) {
              if (!isOAuthAccount) {
                console.log(`[CampaignEngine] Graph API auth failed, falling back to SMTP for ${contact.email}`);
                result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
                  to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
                });
              } else {
                console.error(`[CampaignEngine] Microsoft Graph auth failed for OAuth account ${fromEmail}. No SMTP fallback available.`);
                result = { success: false, error: `Microsoft OAuth token expired for ${fromEmail}. Please re-authenticate in Account Settings.` };
              }
            }
          } else if (!isOAuthAccount) {
            // No OAuth token but has real SMTP credentials — use SMTP
            result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
              to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
            });
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
            errorStr.includes('smtp') && errorStr.includes('auth') || errorStr.includes('credentials') ||
            errorStr.includes('api error') || errorStr.includes('connection refused') ||
            errorStr.includes('getaddrinfo') || errorStr.includes('timeout');
          
          if (isInfrastructureError) {
            // Infrastructure/auth failure — do NOT count as bounce, do NOT mark contact as bounced
            console.warn(`[CampaignEngine] Infrastructure error for ${contact.email}: ${result.error?.slice(0, 100)}`);
            
            // If ALL contacts are failing due to the same auth issue, pause the campaign to prevent mass failures
            localBouncedCount++;
            
            // After 3 consecutive infrastructure failures, auto-pause the campaign
            if (localBouncedCount >= 3 && localSentCount === 0) {
              console.error(`[CampaignEngine] Auto-pausing campaign ${campaignId}: ${localBouncedCount} consecutive infrastructure failures. Error: ${result.error?.slice(0, 200)}`);
              // Flush counts before pausing
              const pauseCampaign = await storage.getCampaign(campaignId);
              if (pauseCampaign) {
                await storage.updateCampaign(campaignId, {
                  status: 'paused',
                  bouncedCount: (pauseCampaign.bouncedCount || 0) + localBouncedCount,
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
            try { await storage.updateContact(contact.id, { status: 'bounced' }); } catch (e) {}
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

      // Throttle between emails
      if (i < contacts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Campaign completed
    const finalCampaign = await storage.getCampaign(campaignId);
    if (finalCampaign && finalCampaign.status === 'active') {
      await storage.updateCampaign(campaignId, { status: 'completed' });
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
}

// Singleton
export const campaignEngine = new CampaignEngine();
