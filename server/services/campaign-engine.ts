import { storage } from '../storage';
import { smtpEmailService, type SmtpConfig, type SendResult } from './smtp-email-service';

interface CampaignSendOptions {
  campaignId: string;
  delayBetweenEmails?: number; // ms between each email (throttling)
  batchSize?: number;
  startTime?: Date;
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
    const { campaignId, delayBetweenEmails = 2000, batchSize = 10 } = options;

    try {
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };

      if (!campaign.emailAccountId) return { success: false, error: 'No email account assigned to campaign' };
      if (!campaign.templateId && !campaign.subject) return { success: false, error: 'No template or subject set' };

      // Get email account
      const emailAccount = await storage.getEmailAccount(campaign.emailAccountId);
      if (!emailAccount) return { success: false, error: 'Email account not found' };
      if (!emailAccount.smtpConfig) return { success: false, error: 'Email account SMTP not configured' };

      // Get contacts for this campaign
      let contacts: any[];
      if (campaign.segmentId) {
        contacts = await storage.getContactsBySegment(campaign.segmentId);
      } else if (campaign.contactIds && campaign.contactIds.length > 0) {
        contacts = [];
        for (const cid of campaign.contactIds) {
          const c = await storage.getContact(cid);
          if (c) contacts.push(c);
        }
      } else {
        contacts = await storage.getContacts(campaign.organizationId, 10000, 0);
      }

      // Filter out unsubscribed
      contacts = contacts.filter(c => c.status !== 'unsubscribed');

      if (contacts.length === 0) return { success: false, error: 'No contacts to send to' };

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
      this.sendBatched(campaignId, contacts, emailAccount, subject, content, delayBetweenEmails, batchSize);

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
    batchSize: number
  ): Promise<void> {
    const smtpConfig: SmtpConfig = emailAccount.smtpConfig;
    const tracker = this.activeCampaigns.get(campaignId);

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

      // Personalize
      const personalData: PersonalizationData = {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email,
        company: contact.company || '',
        jobTitle: contact.jobTitle || '',
        fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      };

      const personalizedSubject = this.personalizeContent(subject, personalData);
      const personalizedContent = this.personalizeContent(content, personalData);

      // Generate tracking ID
      const trackingId = `${campaignId}_${contact.id}_${Date.now()}`;

      // Add open tracking pixel
      const trackedContent = this.addTrackingPixel(personalizedContent, trackingId);

      // Add click tracking to links
      const clickTrackedContent = this.addClickTracking(trackedContent, trackingId);

      // Create message record
      const messageRecord = await storage.createCampaignMessage({
        campaignId,
        contactId: contact.id,
        subject: personalizedSubject,
        content: clickTrackedContent,
        status: 'sending',
        trackingId,
        emailAccountId: emailAccount.id,
      });

      // Send email
      const result: SendResult = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
        to: contact.email,
        subject: personalizedSubject,
        html: clickTrackedContent,
        trackingId,
      });

      if (result.success) {
        await storage.updateCampaignMessage(messageRecord.id, {
          status: 'sent',
          sentAt: new Date(),
          providerMessageId: result.messageId,
        });
        
        // Update campaign stats
        const campaign = await storage.getCampaign(campaignId);
        if (campaign) {
          await storage.updateCampaign(campaignId, {
            sentCount: (campaign.sentCount || 0) + 1,
          });
        }
      } else {
        await storage.updateCampaignMessage(messageRecord.id, {
          status: 'failed',
          errorMessage: result.error,
        });
        
        // Update bounce count
        const campaign = await storage.getCampaign(campaignId);
        if (campaign) {
          await storage.updateCampaign(campaignId, {
            bouncedCount: (campaign.bouncedCount || 0) + 1,
          });
        }
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
   * Add open tracking pixel to HTML
   */
  private addTrackingPixel(html: string, trackingId: string): string {
    const pixel = `<img src="/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
    // Insert before closing body tag, or append
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
  }

  /**
   * Replace links with tracked URLs
   */
  private addClickTracking(html: string, trackingId: string): string {
    return html.replace(
      /href="(https?:\/\/[^"]+)"/gi,
      (match, url) => {
        const encodedUrl = encodeURIComponent(url);
        return `href="/api/track/click/${trackingId}?url=${encodedUrl}"`;
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
      scheduledAt: startTime,
    });

    setTimeout(() => {
      this.startCampaign({ campaignId, ...options });
    }, delay);
  }
}

// Singleton
export const campaignEngine = new CampaignEngine();
