import { storage } from '../storage';

interface PersonalizationContext {
  contact: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    jobTitle?: string;
    customFields?: Record<string, any>;
  };
  campaign: {
    name: string;
    organizationId: string;
  };
  sender: {
    name: string;
    email: string;
  };
  metadata?: Record<string, any>;
}

interface PersonalizationResult {
  subject: string;
  content: string;
  variables: Record<string, string>;
}

export class PersonalizationEngine {
  private static readonly DEFAULT_VARIABLES = {
    'first_name': 'there',
    'last_name': '',
    'full_name': 'there',
    'email': '',
    'company': 'your company',
    'job_title': '',
    'sender_name': '',
    'sender_email': '',
    'campaign_name': '',
    'today': new Date().toLocaleDateString(),
    'current_time': new Date().toLocaleTimeString(),
    'current_month': new Date().toLocaleDateString('en-US', { month: 'long' }),
    'current_year': new Date().getFullYear().toString()
  };

  /**
   * Personalize email subject and content for a specific contact
   */
  async personalizeEmail(
    subject: string,
    content: string,
    context: PersonalizationContext
  ): Promise<PersonalizationResult> {
    try {
      const variables = await this.buildVariables(context);
      
      const personalizedSubject = this.replaceVariables(subject, variables);
      const personalizedContent = this.replaceVariables(content, variables);
      
      return {
        subject: personalizedSubject,
        content: personalizedContent,
        variables
      };
    } catch (error) {
      console.error('Personalization error:', error);
      // Return original content with basic fallbacks if personalization fails
      return {
        subject: this.replaceVariables(subject, PersonalizationEngine.DEFAULT_VARIABLES),
        content: this.replaceVariables(content, PersonalizationEngine.DEFAULT_VARIABLES),
        variables: PersonalizationEngine.DEFAULT_VARIABLES
      };
    }
  }

  /**
   * Build personalization variables from contact and context data
   */
  private async buildVariables(context: PersonalizationContext): Promise<Record<string, string>> {
    const variables: Record<string, string> = { ...PersonalizationEngine.DEFAULT_VARIABLES };
    
    const { contact, campaign, sender, metadata } = context;
    
    // Basic contact variables
    if (contact.firstName) {
      variables.first_name = contact.firstName;
      variables.full_name = contact.lastName 
        ? `${contact.firstName} ${contact.lastName}`
        : contact.firstName;
    }
    
    if (contact.lastName) {
      variables.last_name = contact.lastName;
    }
    
    if (contact.email) {
      variables.email = contact.email;
      // Extract name from email as fallback
      if (!contact.firstName) {
        const emailName = contact.email.split('@')[0];
        variables.first_name = this.formatEmailName(emailName);
        variables.full_name = variables.first_name;
      }
    }
    
    if (contact.company) {
      variables.company = contact.company;
    }
    
    if (contact.jobTitle) {
      variables.job_title = contact.jobTitle;
    }
    
    // Sender variables
    variables.sender_name = sender.name;
    variables.sender_email = sender.email;
    
    // Campaign variables
    variables.campaign_name = campaign.name;
    
    // Custom field variables
    if (contact.customFields) {
      Object.entries(contact.customFields).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          variables[key.toLowerCase().replace(/\s+/g, '_')] = value;
        }
      });
    }
    
    // Metadata variables
    if (metadata) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          variables[key.toLowerCase().replace(/\s+/g, '_')] = value;
        }
      });
    }
    
    // Dynamic variables based on context
    await this.addContextualVariables(variables, context);
    
    return variables;
  }

  /**
   * Add contextual variables based on contact data and external sources
   */
  private async addContextualVariables(
    variables: Record<string, string>,
    context: PersonalizationContext
  ): Promise<void> {
    try {
      // Company-specific variables
      if (context.contact.company) {
        variables.company_industry = await this.getCompanyIndustry(context.contact.company);
        variables.company_size = await this.getCompanySize(context.contact.company);
        variables.company_website = await this.getCompanyWebsite(context.contact.company);
      }
      
      // Time-based variables
      const now = new Date();
      variables.time_of_day = this.getTimeOfDay();
      variables.day_of_week = now.toLocaleDateString('en-US', { weekday: 'long' });
      variables.season = this.getSeason();
      
      // Geographic variables
      if (context.contact.email) {
        const domain = context.contact.email.split('@')[1];
        variables.email_domain = domain;
        variables.likely_country = await this.getCountryFromDomain(domain);
      }
      
    } catch (error) {
      console.error('Error adding contextual variables:', error);
    }
  }

  /**
   * Replace variables in text using multiple patterns
   */
  private replaceVariables(text: string, variables: Record<string, string>): string {
    let result = text;
    
    // Replace {{variable}} pattern
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      return variables[trimmedKey] || match;
    });
    
    // Replace [[variable]] pattern
    result = result.replace(/\[\[([^\]]+)\]\]/g, (match, key) => {
      const trimmedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      return variables[trimmedKey] || match;
    });
    
    // Replace {variable} pattern
    result = result.replace(/\{([^}]+)\}/g, (match, key) => {
      const trimmedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      return variables[trimmedKey] || match;
    });
    
    // Replace %variable% pattern
    result = result.replace(/%([^%]+)%/g, (match, key) => {
      const trimmedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      return variables[trimmedKey] || match;
    });
    
    return result;
  }

  /**
   * Format email username into a proper name
   */
  private formatEmailName(emailName: string): string {
    return emailName
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Get time of day greeting
   */
  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  /**
   * Get current season
   */
  private getSeason(): string {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  }

  /**
   * Placeholder for company industry lookup
   */
  private async getCompanyIndustry(company: string): Promise<string> {
    // This would integrate with services like Apollo, ZoomInfo, or Clearbit
    // For now, return empty string
    return '';
  }

  /**
   * Placeholder for company size lookup
   */
  private async getCompanySize(company: string): Promise<string> {
    // This would integrate with external data sources
    return '';
  }

  /**
   * Placeholder for company website lookup
   */
  private async getCompanyWebsite(company: string): Promise<string> {
    // This would use web search or company databases
    return '';
  }

  /**
   * Placeholder for country detection from email domain
   */
  private async getCountryFromDomain(domain: string): Promise<string> {
    // This would use domain geolocation services
    const countryTlds: Record<string, string> = {
      'co.uk': 'United Kingdom',
      'ca': 'Canada',
      'au': 'Australia',
      'de': 'Germany',
      'fr': 'France',
      'it': 'Italy',
      'es': 'Spain',
      'nl': 'Netherlands',
      'se': 'Sweden',
      'no': 'Norway',
      'dk': 'Denmark',
      'fi': 'Finland',
      'jp': 'Japan',
      'kr': 'South Korea',
      'cn': 'China',
      'in': 'India',
      'br': 'Brazil',
      'mx': 'Mexico',
      'ar': 'Argentina'
    };
    
    for (const [tld, country] of Object.entries(countryTlds)) {
      if (domain.endsWith(`.${tld}`)) {
        return country;
      }
    }
    
    return 'United States'; // Default
  }

  /**
   * Get all available personalization variables
   */
  getAvailableVariables(): Array<{
    name: string;
    description: string;
    example: string;
    category: string;
  }> {
    return [
      // Contact variables
      { name: 'first_name', description: 'Contact\'s first name', example: 'John', category: 'Contact' },
      { name: 'last_name', description: 'Contact\'s last name', example: 'Smith', category: 'Contact' },
      { name: 'full_name', description: 'Contact\'s full name', example: 'John Smith', category: 'Contact' },
      { name: 'email', description: 'Contact\'s email address', example: 'john@company.com', category: 'Contact' },
      { name: 'company', description: 'Contact\'s company name', example: 'Acme Corp', category: 'Contact' },
      { name: 'job_title', description: 'Contact\'s job title', example: 'Marketing Manager', category: 'Contact' },
      
      // Sender variables
      { name: 'sender_name', description: 'Sender\'s name', example: 'Jane Doe', category: 'Sender' },
      { name: 'sender_email', description: 'Sender\'s email', example: 'jane@company.com', category: 'Sender' },
      
      // Campaign variables
      { name: 'campaign_name', description: 'Current campaign name', example: 'Q1 Outreach', category: 'Campaign' },
      
      // Date/Time variables
      { name: 'today', description: 'Current date', example: '1/15/2024', category: 'Date/Time' },
      { name: 'current_time', description: 'Current time', example: '2:30 PM', category: 'Date/Time' },
      { name: 'current_month', description: 'Current month name', example: 'January', category: 'Date/Time' },
      { name: 'current_year', description: 'Current year', example: '2024', category: 'Date/Time' },
      { name: 'time_of_day', description: 'Time of day greeting', example: 'morning', category: 'Date/Time' },
      { name: 'day_of_week', description: 'Current day of week', example: 'Monday', category: 'Date/Time' },
      { name: 'season', description: 'Current season', example: 'winter', category: 'Date/Time' },
      
      // Context variables
      { name: 'email_domain', description: 'Contact\'s email domain', example: 'company.com', category: 'Context' },
      { name: 'likely_country', description: 'Likely country based on domain', example: 'United States', category: 'Context' }
    ];
  }

  /**
   * Validate personalization template
   */
  validateTemplate(template: string): {
    isValid: boolean;
    errors: string[];
    variables: string[];
  } {
    const errors: string[] = [];
    const variables: string[] = [];
    
    // Find all variable patterns
    const patterns = [
      /\{\{([^}]+)\}\}/g,
      /\[\[([^\]]+)\]\]/g,
      /\{([^}]+)\}/g,
      /%([^%]+)%/g
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(template)) !== null) {
        const variable = match[1].trim().toLowerCase().replace(/\s+/g, '_');
        if (!variables.includes(variable)) {
          variables.push(variable);
        }
      }
    });
    
    // Check for unmatched brackets
    const openBrackets = (template.match(/\{\{/g) || []).length;
    const closeBrackets = (template.match(/\}\}/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push('Unmatched curly brackets {{}}');
    }
    
    const openSquare = (template.match(/\[\[/g) || []).length;
    const closeSquare = (template.match(/\]\]/g) || []).length;
    if (openSquare !== closeSquare) {
      errors.push('Unmatched square brackets [[]]');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      variables
    };
  }

  /**
   * AI-powered email personalization via Azure OpenAI (optional enhancement).
   * Falls back gracefully if Azure is not configured.
   */
  async aiPersonalizeEmail(
    organizationId: string,
    subject: string,
    content: string,
    context: PersonalizationContext
  ): Promise<PersonalizationResult> {
    // First do standard variable replacement
    const basicResult = await this.personalizeEmail(subject, content, context);

    try {
      // Check if Azure OpenAI is configured
      const settings = await storage.getApiSettings(organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        // Azure not configured, return basic personalization
        return basicResult;
      }

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are an AI email personalization expert. Refine the given email to feel more personal and relevant to the recipient while preserving the core message, tone, and all tracking links/images. Return ONLY the refined email HTML content without explanation.',
            },
            {
              role: 'user',
              content: `Personalize this email for ${context.contact.firstName || 'the recipient'} (${context.contact.jobTitle || 'professional'} at ${context.contact.company || 'their company'}):\n\nSubject: ${basicResult.subject}\n\nContent:\n${basicResult.content}`,
            },
          ],
          max_tokens: 1500,
          temperature: 0.6,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const aiContent = data?.choices?.[0]?.message?.content;
        if (aiContent) {
          return {
            subject: basicResult.subject,
            content: aiContent,
            variables: basicResult.variables,
          };
        }
      }
    } catch (error) {
      console.error('AI personalization failed, using standard:', error);
    }

    // Fallback to basic personalization
    return basicResult;
  }
}

export const personalizationEngine = new PersonalizationEngine();