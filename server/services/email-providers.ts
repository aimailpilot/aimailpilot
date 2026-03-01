import { google } from 'googleapis';
import { MailService } from '@sendgrid/mail';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  trackingId?: string;
}

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }>;
  getQuota(): Promise<{ daily: number; remaining: number }>;
}

class GmailProvider implements EmailProvider {
  private gmail: any;
  private fromEmail: string;

  constructor(credentials: any, fromEmail: string) {
    const auth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );
    auth.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth });
    this.fromEmail = fromEmail;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const raw = this.createRawEmail(message);
      
      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: raw,
        },
      });

      return {
        success: true,
        messageId: response.data.id,
      };
    } catch (error) {
      console.error('Gmail send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getQuota(): Promise<{ daily: number; remaining: number }> {
    // Gmail API doesn't provide quota info directly, return defaults
    return { daily: 2000, remaining: 1500 };
  }

  private createRawEmail(message: EmailMessage): string {
    const boundary = 'boundary_' + Math.random().toString(36).substr(2, 9);
    
    let raw = [
      `From: ${this.fromEmail}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      message.text || this.htmlToText(message.html),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      message.html,
      '',
      `--${boundary}--`,
    ].join('\n');

    return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private htmlToText(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

class OutlookProvider implements EmailProvider {
  private credentials: any;
  private fromEmail: string;

  constructor(credentials: any, fromEmail: string) {
    this.credentials = credentials;
    this.fromEmail = fromEmail;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Microsoft Graph API call would go here
      // For now, return mock success
      return {
        success: true,
        messageId: 'outlook_' + Math.random().toString(36),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getQuota(): Promise<{ daily: number; remaining: number }> {
    return { daily: 1500, remaining: 800 };
  }
}

class SendGridProvider implements EmailProvider {
  private client: MailService;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    this.client = new MailService();
    this.client.setApiKey(apiKey);
    this.fromEmail = fromEmail;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const [response] = await this.client.send({
        to: message.to,
        from: this.fromEmail,
        subject: message.subject,
        html: message.html,
        text: message.text,
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true },
        },
      });

      return {
        success: true,
        messageId: response.headers['x-message-id'] as string,
      };
    } catch (error) {
      console.error('SendGrid send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getQuota(): Promise<{ daily: number; remaining: number }> {
    // SendGrid quota would be checked via API
    return { daily: 50000, remaining: 37660 };
  }
}

class ElasticEmailProvider implements EmailProvider {
  private apiKey: string;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  async sendEmail(message: EmailMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Elastic Email API call would go here
      // For now, return mock success
      return {
        success: true,
        messageId: 'elastic_' + Math.random().toString(36),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getQuota(): Promise<{ daily: number; remaining: number }> {
    return { daily: 25000, remaining: 18340 };
  }
}

export class EmailProviderService {
  private providers: Map<string, EmailProvider> = new Map();

  async initializeProvider(account: any): Promise<EmailProvider> {
    const { provider, email, credentials } = account;

    switch (provider) {
      case 'gmail':
        return new GmailProvider(credentials, email);
      case 'outlook':
        return new OutlookProvider(credentials, email);
      case 'sendgrid':
        return new SendGridProvider(credentials.apiKey, email);
      case 'elasticemail':
        return new ElasticEmailProvider(credentials.apiKey, email);
      default:
        throw new Error(`Unsupported email provider: ${provider}`);
    }
  }

  async sendEmail(accountId: string, message: EmailMessage, account: any): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      let provider = this.providers.get(accountId);
      if (!provider) {
        provider = await this.initializeProvider(account);
        this.providers.set(accountId, provider);
      }

      return await provider.sendEmail(message);
    } catch (error) {
      console.error('Error sending email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getProviderQuota(accountId: string, account: any): Promise<{ daily: number; remaining: number }> {
    try {
      let provider = this.providers.get(accountId);
      if (!provider) {
        provider = await this.initializeProvider(account);
        this.providers.set(accountId, provider);
      }

      return await provider.getQuota();
    } catch (error) {
      console.error('Error getting quota:', error);
      return { daily: 0, remaining: 0 };
    }
  }

  async selectOptimalProvider(organizationId: string, recipientCount: number): Promise<string> {
    // Logic to select the best provider based on:
    // - Available quota
    // - Deliverability rates
    // - Cost optimization
    // - Rate limits
    
    // For now, return a mock provider selection
    return 'gmail_account_1';
  }
}
