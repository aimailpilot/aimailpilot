import { storage } from '../storage';

interface SchedulingConfig {
  startTime?: string; // HH:MM format
  endTime?: string; // HH:MM format
  timeZone: string;
  sendDays: string[];
  emailDelaySeconds: number;
  maxEmailsPerHour: number;
}

interface SendWindow {
  canSend: boolean;
  nextSendTime?: Date;
  reason?: string;
}

export class SchedulerService {
  private activeSchedules: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Check if current time is within sending window
   */
  checkSendingWindow(config: SchedulingConfig): SendWindow {
    const now = new Date();
    const userTime = this.convertToUserTimezone(now, config.timeZone);
    
    // Check if today is a sending day
    const dayName = userTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    if (!config.sendDays.includes(dayName)) {
      return {
        canSend: false,
        reason: `Sending disabled on ${dayName}`,
        nextSendTime: this.getNextSendingDay(config)
      };
    }

    // Check time window
    if (config.startTime && config.endTime) {
      const currentTime = userTime.toTimeString().slice(0, 5); // HH:MM
      if (currentTime < config.startTime || currentTime > config.endTime) {
        return {
          canSend: false,
          reason: `Outside sending hours (${config.startTime} - ${config.endTime})`,
          nextSendTime: this.getNextSendingTime(config)
        };
      }
    }

    return { canSend: true };
  }

  /**
   * Schedule campaign with advanced options
   */
  async scheduleCampaign(campaignId: string): Promise<void> {
    const campaign = await storage.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const config: SchedulingConfig = {
      startTime: campaign.startTime || undefined,
      endTime: campaign.endTime || undefined,
      timeZone: campaign.timeZone || 'UTC',
      sendDays: campaign.sendDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      emailDelaySeconds: campaign.emailDelaySeconds || 30,
      maxEmailsPerHour: campaign.maxEmailsPerHour || 100
    };

    // If campaign has specific scheduled time, use it
    if (campaign.scheduledAt) {
      const scheduledTime = new Date(campaign.scheduledAt);
      const delay = scheduledTime.getTime() - Date.now();
      
      if (delay > 0) {
        const timeout = setTimeout(() => {
          this.startCampaignSending(campaignId, config);
        }, delay);
        
        this.activeSchedules.set(campaignId, timeout);
        return;
      }
    }

    // Otherwise start immediately if within sending window
    const sendWindow = this.checkSendingWindow(config);
    if (sendWindow.canSend) {
      await this.startCampaignSending(campaignId, config);
    } else {
      // Schedule for next available sending time
      const nextSendTime = sendWindow.nextSendTime || this.getNextSendingTime(config);
      const delay = nextSendTime.getTime() - Date.now();
      
      const timeout = setTimeout(() => {
        this.startCampaignSending(campaignId, config);
      }, delay);
      
      this.activeSchedules.set(campaignId, timeout);
    }
  }

  /**
   * Start sending campaign emails with rate limiting
   */
  private async startCampaignSending(campaignId: string, config: SchedulingConfig): Promise<void> {
    try {
      await storage.updateCampaign(campaignId, { 
        status: "active",
        startedAt: new Date() 
      });

      // Get campaign messages to send
      const messages = await storage.getCampaignMessages(campaignId, 'pending');
      
      if (messages.length === 0) {
        await storage.updateCampaign(campaignId, { 
          status: "completed",
          completedAt: new Date()
        });
        return;
      }

      // Calculate sending rate based on hourly limit
      const delayBetweenEmails = Math.max(
        config.emailDelaySeconds * 1000,
        (3600 * 1000) / config.maxEmailsPerHour // Convert hourly limit to ms delay
      );

      // Send emails with controlled rate
      await this.sendEmailsWithRate(campaignId, messages, delayBetweenEmails, config);
      
    } catch (error) {
      console.error(`Failed to send campaign ${campaignId}:`, error);
      await storage.updateCampaign(campaignId, { 
        status: "failed"
      });
    }
  }

  /**
   * Send emails with rate limiting and window checking
   */
  private async sendEmailsWithRate(
    campaignId: string,
    messages: any[],
    delay: number,
    config: SchedulingConfig
  ): Promise<void> {
    let sentCount = 0;

    for (const message of messages) {
      // Check if we're still in sending window
      const sendWindow = this.checkSendingWindow(config);
      if (!sendWindow.canSend) {
        console.log(`Pausing campaign ${campaignId}: ${sendWindow.reason}`);
        
        // Reschedule remaining messages for next sending window
        if (sendWindow.nextSendTime) {
          const remainingMessages = messages.slice(sentCount);
          const delayToNextWindow = sendWindow.nextSendTime.getTime() - Date.now();
          
          setTimeout(() => {
            this.sendEmailsWithRate(campaignId, remainingMessages, delay, config);
          }, delayToNextWindow);
        }
        break;
      }

      try {
        await this.sendSingleEmail(message);
        sentCount++;
        
        // Update campaign progress
        await storage.updateCampaign(campaignId, {
          sentCount: sentCount
        });

        // Wait before sending next email
        if (sentCount < messages.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        console.error(`Failed to send email ${message.id}:`, error);
        await storage.updateCampaignMessage(message.id, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Mark campaign as completed if all messages processed
    if (sentCount >= messages.length) {
      await storage.updateCampaign(campaignId, {
        status: 'completed',
        completedAt: new Date()
      });
    }
  }

  /**
   * Send a single email (placeholder - will integrate with email service)
   */
  private async sendSingleEmail(message: any): Promise<void> {
    // This will integrate with the actual email service
    console.log(`Sending email to ${message.contactId}: ${message.subject}`);
    
    await storage.updateCampaignMessage(message.id, {
      status: 'sent',
      sentAt: new Date()
    });
  }

  /**
   * Cancel scheduled campaign
   */
  cancelCampaign(campaignId: string): void {
    const timeout = this.activeSchedules.get(campaignId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeSchedules.delete(campaignId);
    }
  }

  /**
   * Convert time to user's timezone
   */
  private convertToUserTimezone(date: Date, timeZone: string): Date {
    try {
      return new Date(date.toLocaleString('en-US', { timeZone }));
    } catch {
      return date; // Fallback to UTC if timezone invalid
    }
  }

  /**
   * Get next valid sending time based on schedule
   */
  private getNextSendingTime(config: SchedulingConfig): Date {
    const now = new Date();
    const userNow = this.convertToUserTimezone(now, config.timeZone);
    
    // If we have time restrictions, find next valid time
    if (config.startTime) {
      const [hours, minutes] = config.startTime.split(':').map(Number);
      const nextSendTime = new Date(userNow);
      nextSendTime.setHours(hours, minutes, 0, 0);
      
      // If start time already passed today, try tomorrow
      if (nextSendTime <= userNow) {
        nextSendTime.setDate(nextSendTime.getDate() + 1);
      }
      
      return nextSendTime;
    }
    
    return now; // No time restrictions, send now
  }

  /**
   * Get next valid sending day
   */
  private getNextSendingDay(config: SchedulingConfig): Date {
    const now = new Date();
    const userNow = this.convertToUserTimezone(now, config.timeZone);
    
    // Find next valid sending day
    for (let i = 1; i <= 7; i++) {
      const checkDate = new Date(userNow);
      checkDate.setDate(checkDate.getDate() + i);
      
      const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      if (config.sendDays.includes(dayName)) {
        // Set to start time if specified
        if (config.startTime) {
          const [hours, minutes] = config.startTime.split(':').map(Number);
          checkDate.setHours(hours, minutes, 0, 0);
        }
        return checkDate;
      }
    }
    
    return new Date(userNow.getTime() + 24 * 60 * 60 * 1000); // Default to tomorrow
  }

  /**
   * Get popular timezones for UI
   */
  getPopularTimezones(): Array<{ value: string; label: string; offset: string }> {
    return [
      { value: 'America/New_York', label: 'Eastern Time (US)', offset: 'UTC-5/-4' },
      { value: 'America/Chicago', label: 'Central Time (US)', offset: 'UTC-6/-5' },
      { value: 'America/Denver', label: 'Mountain Time (US)', offset: 'UTC-7/-6' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (US)', offset: 'UTC-8/-7' },
      { value: 'Europe/London', label: 'London Time (UK)', offset: 'UTC+0/+1' },
      { value: 'Europe/Paris', label: 'Central European Time', offset: 'UTC+1/+2' },
      { value: 'Asia/Tokyo', label: 'Japan Standard Time', offset: 'UTC+9' },
      { value: 'Asia/Kolkata', label: 'India Standard Time', offset: 'UTC+5:30' },
      { value: 'Australia/Sydney', label: 'Australian Eastern Time', offset: 'UTC+10/+11' },
      { value: 'UTC', label: 'Coordinated Universal Time', offset: 'UTC+0' }
    ];
  }
}

export const schedulerService = new SchedulerService();