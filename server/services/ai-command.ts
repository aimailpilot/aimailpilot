import { LLMService } from "./llm";
import { storage } from "../storage";

export class AICommandService {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  async processCommand(command: string, organizationId: string): Promise<any> {
    try {
      // Parse the command intent using LLM
      const intent = await this.parseCommandIntent(command, organizationId);
      
      switch (intent.action) {
        case 'create_campaign':
          return await this.createCampaignFromCommand(intent, organizationId);
        case 'get_analytics':
          return await this.getAnalyticsFromCommand(intent, organizationId);
        case 'manage_contacts':
          return await this.manageContactsFromCommand(intent, organizationId);
        case 'update_settings':
          return await this.updateSettingsFromCommand(intent, organizationId);
        default:
          return {
            success: false,
            message: "I didn't understand that command. Try asking me to create a campaign, show analytics, or manage contacts.",
          };
      }
    } catch (error) {
      console.error('Error processing AI command:', error);
      return {
        success: false,
        message: "Sorry, I encountered an error processing your command. Please try again.",
      };
    }
  }

  private async parseCommandIntent(command: string, organizationId: string): Promise<any> {
    // Use the primary LLM to understand the command intent
    const llmConfig = await storage.getPrimaryLlmConfiguration(organizationId);
    if (!llmConfig) {
      throw new Error('No LLM configuration found');
    }

    // Simplified intent parsing for demo
    const lowerCommand = command.toLowerCase();
    
    if (lowerCommand.includes('create') && lowerCommand.includes('campaign')) {
      return {
        action: 'create_campaign',
        parameters: this.extractCampaignParameters(command),
      };
    } else if (lowerCommand.includes('analytics') || lowerCommand.includes('report') || lowerCommand.includes('performance')) {
      return {
        action: 'get_analytics',
        parameters: this.extractAnalyticsParameters(command),
      };
    } else if (lowerCommand.includes('contact') || lowerCommand.includes('lead')) {
      return {
        action: 'manage_contacts',
        parameters: this.extractContactParameters(command),
      };
    } else if (lowerCommand.includes('setting') || lowerCommand.includes('config')) {
      return {
        action: 'update_settings',
        parameters: this.extractSettingsParameters(command),
      };
    }

    return { action: 'unknown', parameters: {} };
  }

  private extractCampaignParameters(command: string): any {
    // Extract campaign details from natural language
    const params: any = {};
    
    // Look for campaign name
    const nameMatch = command.match(/campaign.*?["']([^"']+)["']/i) || command.match(/called\s+["']([^"']+)["']/i);
    if (nameMatch) {
      params.name = nameMatch[1];
    }
    
    // Look for audience/segment
    const audienceMatch = command.match(/to\s+([\w\s]+?)(?:\s+about|\s+for|\s*$)/i);
    if (audienceMatch) {
      params.audience = audienceMatch[1].trim();
    }
    
    return params;
  }

  private extractAnalyticsParameters(command: string): any {
    const params: any = {};
    
    // Look for time period
    if (command.includes('last week')) {
      params.period = 'week';
    } else if (command.includes('last month')) {
      params.period = 'month';
    } else if (command.includes('today')) {
      params.period = 'today';
    }
    
    // Look for specific metrics
    if (command.includes('open rate')) {
      params.metrics = ['open_rate'];
    } else if (command.includes('reply rate')) {
      params.metrics = ['reply_rate'];
    }
    
    return params;
  }

  private extractContactParameters(command: string): any {
    const params: any = {};
    
    if (command.includes('import')) {
      params.action = 'import';
    } else if (command.includes('segment')) {
      params.action = 'segment';
    } else if (command.includes('score')) {
      params.action = 'score';
    }
    
    return params;
  }

  private extractSettingsParameters(command: string): any {
    const params: any = {};
    
    if (command.includes('llm') || command.includes('ai')) {
      params.type = 'llm';
    } else if (command.includes('email') || command.includes('sending')) {
      params.type = 'email';
    }
    
    return params;
  }

  private async createCampaignFromCommand(intent: any, organizationId: string): Promise<any> {
    try {
      const { parameters } = intent;
      
      // Get available templates and segments
      const templates = await storage.getEmailTemplates(organizationId);
      const segments = await storage.getContactSegments(organizationId);
      
      return {
        success: true,
        action: 'create_campaign',
        message: `I can help you create a campaign${parameters.name ? ` called "${parameters.name}"` : ''}. Let me show you the campaign creation form.`,
        data: {
          suggestedName: parameters.name || 'New AI Campaign',
          availableTemplates: templates.slice(0, 5),
          availableSegments: segments.slice(0, 5),
          suggestedAudience: parameters.audience,
        },
        uiAction: 'open_campaign_form',
      };
    } catch (error) {
      return {
        success: false,
        message: 'I encountered an error while preparing the campaign creation. Please try again.',
      };
    }
  }

  private async getAnalyticsFromCommand(intent: any, organizationId: string): Promise<any> {
    try {
      const stats = await storage.getCampaignStats(organizationId);
      const { parameters } = intent;
      
      let message = "Here's your campaign performance";
      if (parameters.period) {
        message += ` for the ${parameters.period}`;
      }
      message += ":";
      
      return {
        success: true,
        action: 'show_analytics',
        message,
        data: {
          activeCampaigns: stats.activeCampaigns || 0,
          totalSent: stats.totalSent || 0,
          totalOpened: stats.totalOpened || 0,
          totalReplied: stats.totalReplied || 0,
          openRate: stats.totalSent > 0 ? (stats.totalOpened / stats.totalSent * 100).toFixed(1) : '0',
          replyRate: stats.totalSent > 0 ? (stats.totalReplied / stats.totalSent * 100).toFixed(1) : '0',
        },
        uiAction: 'show_analytics_modal',
      };
    } catch (error) {
      return {
        success: false,
        message: 'I encountered an error while retrieving analytics. Please try again.',
      };
    }
  }

  private async manageContactsFromCommand(intent: any, organizationId: string): Promise<any> {
    try {
      const { parameters } = intent;
      const contacts = await storage.getContacts(organizationId, 10);
      
      let message = "Here's what I can help you with regarding contacts: ";
      let uiAction = 'show_contacts';
      
      if (parameters.action === 'import') {
        message = "I can help you import contacts. Let me open the import tool.";
        uiAction = 'open_contact_import';
      } else if (parameters.action === 'segment') {
        message = "I can help you create contact segments. Let me show you the segmentation tool.";
        uiAction = 'open_segmentation';
      } else if (parameters.action === 'score') {
        message = "I can help you analyze contact scoring. Here's your current lead distribution.";
        uiAction = 'show_lead_scoring';
      }
      
      return {
        success: true,
        action: 'manage_contacts',
        message,
        data: {
          totalContacts: contacts.length,
          recentContacts: contacts.slice(0, 5),
        },
        uiAction,
      };
    } catch (error) {
      return {
        success: false,
        message: 'I encountered an error while accessing contact information. Please try again.',
      };
    }
  }

  private async updateSettingsFromCommand(intent: any, organizationId: string): Promise<any> {
    try {
      const { parameters } = intent;
      
      let message = "I can help you update your settings. ";
      let uiAction = 'show_settings';
      
      if (parameters.type === 'llm') {
        const llmConfigs = await storage.getLlmConfigurations(organizationId);
        message = "Here are your current AI provider settings. Which would you like to modify?";
        uiAction = 'show_llm_settings';
        return {
          success: true,
          action: 'update_settings',
          message,
          data: { llmConfigs },
          uiAction,
        };
      } else if (parameters.type === 'email') {
        const emailAccounts = await storage.getEmailAccounts(organizationId);
        message = "Here are your email sending accounts. Which would you like to configure?";
        uiAction = 'show_email_settings';
        return {
          success: true,
          action: 'update_settings',
          message,
          data: { emailAccounts },
          uiAction,
        };
      }
      
      return {
        success: true,
        action: 'update_settings',
        message: "What settings would you like to update? I can help with AI providers, email accounts, or organization settings.",
        uiAction: 'show_settings_menu',
      };
    } catch (error) {
      return {
        success: false,
        message: 'I encountered an error while accessing settings. Please try again.',
      };
    }
  }
}
