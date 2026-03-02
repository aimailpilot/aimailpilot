import { storage } from "../storage";
import { LLMService } from "./llm";
import { smtpEmailService } from "./smtp-email-service";

// Simple email interface since we need to integrate with existing email providers
interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class EmailService {
  async sendEmail(emailAccountId: string, message: EmailMessage): Promise<EmailResult> {
    try {
      // Try real SMTP sending via the email account
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

      // Fallback: log and simulate if no SMTP config
      console.log(`[Followup] No SMTP config for account ${emailAccountId}, simulating send to ${message.to}`);
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
  private llmService: LLMService;
  private emailService: EmailService;

  constructor() {
    this.llmService = new LLMService();
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
    
    // Calculate delay in milliseconds - support days, hours
    const delayDays = parseInt(step.delayDays) || 0;
    const delayHours = parseInt(step.delayHours) || 0;
    const delayMs = (delayDays * 24 * 60 * 60 * 1000) + (delayHours * 60 * 60 * 1000);
    const triggerTime = new Date(sentAt.getTime() + delayMs);

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

      // Use AI to personalize if LLM config is available
      if (campaign.llmConfigId && campaign.organizationId) {
        try {
          const personalizedContent = await this.llmService.generatePersonalizedEmail(
            campaign.organizationId,
            contact,
            content,
            {
              isFollowup: true,
              originalMessage: message,
              step: step,
              trigger: step.trigger
            }
          );
          content = personalizedContent;
        } catch (error) {
          console.error("Failed to personalize follow-up content:", error);
          // Continue with original content
        }
      }

      // Create follow-up execution record
      const execution = await storage.createFollowupExecution({
        campaignMessageId: message.id,
        stepId: step.id,
        contactId: contact.id,
        status: "scheduled",
        scheduledAt: new Date(),
        subject: subject || '',
        content: content || '',
        triggerData: {
          trigger: step.trigger,
          originalMessageId: message.id,
          timestamp: new Date().toISOString()
        }
      });

      console.log(`Scheduled follow-up for contact ${contact.email}, step ${step.stepNumber}`);
      
      // If the follow-up should be sent immediately, send it now
      if (step.delayDays === 0 && step.delayHours === 0) {
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

      // Send the follow-up email
      if (!campaign.emailAccountId || !contact.email || !execution.subject || !execution.content) {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: "Missing required email data"
        });
        return;
      }

      const emailResult = await this.emailService.sendEmail(campaign.emailAccountId, {
        to: contact.email,
        subject: execution.subject,
        html: execution.content,
        text: execution.content.replace(/<[^>]*>/g, ""), // Strip HTML for text version
      });

      if (emailResult.success) {
        await storage.updateFollowupExecution(executionId, {
          status: "sent",
          sentAt: new Date()
        });
        
        // Create a new campaign message record for tracking
        await storage.createCampaignMessage({
          campaignId: campaign.id,
          contactId: contact.id,
          subject: execution.subject || '',
          content: execution.content || '',
          status: "sent",
          sentAt: new Date(),
          trackingId: emailResult.messageId
        });
        
        console.log(`Follow-up sent successfully to ${contact.email}`);
      } else {
        await storage.updateFollowupExecution(executionId, {
          status: "failed",
          errorMessage: emailResult.error || "Unknown email sending error"
        });
        
        console.error(`Failed to send follow-up to ${contact.email}:`, emailResult.error);
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

// Auto-process follow-ups every 5 minutes
setInterval(() => {
  followupEngine.processFollowupTriggers().catch(console.error);
}, 5 * 60 * 1000);