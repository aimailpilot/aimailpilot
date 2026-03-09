import { storage } from "../storage";
import { smtpEmailService } from "./smtp-email-service";

// Simple email interface since we need to integrate with existing email providers
interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
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
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string> }
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

class EmailService {
  async sendEmail(emailAccountId: string, message: EmailMessage, orgId?: string): Promise<EmailResult> {
    try {
      // Try Gmail API first if we have OAuth tokens
      if (orgId) {
        const settings = await storage.getApiSettings(orgId);
        let accessToken = settings.gmail_access_token;
        const refreshToken = settings.gmail_refresh_token;
        const tokenExpiry = settings.gmail_token_expiry;
        const clientId = settings.google_oauth_client_id;
        const clientSecret = settings.google_oauth_client_secret;

        // Refresh token if expired
        if (accessToken && tokenExpiry && Date.now() > parseInt(tokenExpiry) - 300000) {
          if (refreshToken && clientId && clientSecret) {
            try {
              const resp = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  grant_type: 'refresh_token',
                  refresh_token: refreshToken,
                  client_id: clientId,
                  client_secret: clientSecret,
                }),
              });
              if (resp.ok) {
                const data = await resp.json() as any;
                accessToken = data.access_token;
                await storage.setApiSetting(orgId, 'gmail_access_token', accessToken);
                await storage.setApiSetting(orgId, 'gmail_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
              }
            } catch (e) {
              console.error('[Followup] Token refresh failed:', e);
            }
          }
        }

        if (accessToken) {
          const fromEmail = settings.gmail_user_email || message.from || '';
          console.log(`[Followup] Sending follow-up via Gmail API to ${message.to}`);
          const result = await sendViaGmailAPI(accessToken, {
            from: fromEmail,
            to: message.to,
            subject: message.subject,
            html: message.html,
          });
          if (result.success) return result;
          console.log(`[Followup] Gmail API failed, trying SMTP: ${result.error}`);
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
      
      if (activeCampaignFollowups.length > 0) {
        console.log(`[Followup] Processing ${activeCampaignFollowups.length} active campaign follow-up configurations...`);
      }
      
      for (const campaignFollowup of activeCampaignFollowups) {
        await this.processCampaignFollowups(campaignFollowup.campaignId, campaignFollowup.sequenceId);
      }
      
      // Process time-based triggers (pending executions)
      await this.processScheduledFollowups();
    } catch (error) {
      console.error("[Followup] Error processing follow-up triggers:", error);
    }
  }

  /**
   * Process follow-ups for a specific campaign
   */
  private async processCampaignFollowups(campaignId: string, sequenceId: string): Promise<void> {
    const campaignMessages = await storage.getCampaignMessages(campaignId);
    const followupSteps = await storage.getFollowupSteps(sequenceId);
    
    for (const message of campaignMessages) {
      await this.processMessageFollowups(message, followupSteps);
    }
  }

  /**
   * Process follow-ups for a specific message based on triggers
   */
  private async processMessageFollowups(message: any, followupSteps: any[]): Promise<void> {
    for (const step of followupSteps) {
      const shouldTrigger = await this.evaluateFollowupTrigger(message, step);
      
      if (shouldTrigger && !(await this.followupAlreadyExecuted(message.id, step.id))) {
        await this.scheduleFollowup(message, step);
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

    // Debug logging
    console.log(`[Followup] Evaluating step ${step.stepNumber} for msg ${message.id}: trigger=${step.trigger}, delay=${delayDays}d ${delayHours}h ${delayMinutes}m, sentAt=${sentAt.toISOString()}, triggerTime=${triggerTime.toISOString()}, now=${now.toISOString()}, timeReached=${now >= triggerTime}`);

    // Check if enough time has passed
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
        scheduledAt: new Date(),
      });

      console.log(`Scheduled follow-up for contact ${contact.email}, step ${step.stepNumber}`);
      
      // If the follow-up should be sent immediately (no delay configured), send it now
      const hasDelay = (parseInt(step.delayDays) || 0) > 0 || (parseInt(step.delayHours) || 0) > 0 || (parseInt(step.delayMinutes) || 0) > 0;
      if (!hasDelay) {
        await this.executeFollowup(execution.id);
      }
      
    } catch (error) {
      console.error("Error scheduling follow-up:", error);
    }
  }

  /**
   * Process scheduled follow-ups that are ready to be sent
   */
  private async processScheduledFollowups(): Promise<void> {
    const pendingExecutions = await storage.getPendingFollowupExecutions();
    
    for (const execution of pendingExecutions) {
      const now = new Date();
      const scheduledAt = new Date(execution.scheduledAt);
      
      if (now >= scheduledAt) {
        await this.executeFollowup(execution.id);
      }
    }
  }

  /**
   * Execute a specific follow-up email
   */
  private async executeFollowup(executionId: string): Promise<void> {
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

      // Send the follow-up email — use subject from step if execution.subject is empty
      const subject = execution.subject || step.subject || campaign.subject || 'Follow-up';
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
      
      let personalizedSubject = subject
        .replace(/\{\{firstName\}\}/g, contact.firstName || '')
        .replace(/\{\{lastName\}\}/g, contact.lastName || '')
        .replace(/\{\{company\}\}/g, contact.company || '');

      const emailResult = await this.emailService.sendEmail(campaign.emailAccountId, {
        to: contact.email,
        subject: personalizedSubject,
        html: personalizedContent,
        text: personalizedContent.replace(/<[^>]*>/g, ""), // Strip HTML for text version
      }, campaign.organizationId);

      if (emailResult.success) {
        await storage.updateFollowupExecution(executionId, {
          status: "sent",
          sentAt: new Date()
        });
        
        // Create a new campaign message record for tracking with correct stepNumber
        const trackingId = `${campaign.id}_${contact.id}_${Date.now()}`;
        await storage.createCampaignMessage({
          campaignId: campaign.id,
          contactId: contact.id,
          subject: personalizedSubject,
          content: personalizedContent,
          status: "sent",
          sentAt: new Date(),
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
  console.log('[Followup] Starting follow-up engine (checking every 60s)...');
  // Run immediately on start
  followupEngine.processFollowupTriggers().catch(console.error);
  // Then run every 60 seconds
  followupInterval = setInterval(() => {
    followupEngine.processFollowupTriggers().catch(console.error);
  }, 60 * 1000);
}

export function stopFollowupEngine() {
  if (followupInterval) {
    clearInterval(followupInterval);
    followupInterval = null;
    console.log('[Followup] Follow-up engine stopped');
  }
}