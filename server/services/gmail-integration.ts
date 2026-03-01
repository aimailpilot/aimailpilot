import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

interface GmailAccount {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiryDate?: number;
}

export class GmailIntegrationService {
  private oauth2Client: OAuth2Client;
  private gmail: any;

  constructor(config: GmailConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }

  /**
   * Generate OAuth authorization URL
   */
  generateAuthUrl(state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ],
      prompt: 'consent',
      state: state
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getAccessToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
  }> {
    const { tokens } = await this.oauth2Client.getAccessToken(code);
    
    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: tokens.expiry_date!
    };
  }

  /**
   * Set credentials for API calls
   */
  setCredentials(account: GmailAccount): void {
    this.oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      expiry_date: account.expiryDate
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Refresh access token if expired
   */
  async refreshAccessToken(): Promise<string> {
    const { credentials } = await this.oauth2Client.refreshAccessToken();
    return credentials.access_token!;
  }

  /**
   * Get user's Gmail profile
   */
  async getUserProfile(): Promise<{ email: string; name: string }> {
    const profile = await this.gmail.users.getProfile({ userId: 'me' });
    
    // Get additional user info
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    return {
      email: profile.data.emailAddress,
      name: userInfo.data.name || profile.data.emailAddress
    };
  }

  /**
   * Send email through Gmail API
   */
  async sendEmail(message: EmailMessage): Promise<{ messageId: string; threadId: string }> {
    const emailLines = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html || message.text || ''
    ];

    const email = emailLines.join('\n');
    const encodedEmail = Buffer.from(email).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    return {
      messageId: response.data.id,
      threadId: response.data.threadId
    };
  }

  /**
   * Send bulk emails with rate limiting
   */
  async sendBulkEmails(
    messages: EmailMessage[],
    options: {
      delayBetweenEmails?: number; // milliseconds
      batchSize?: number;
      onProgress?: (sent: number, total: number) => void;
      onError?: (error: Error, message: EmailMessage) => void;
    } = {}
  ): Promise<Array<{ messageId: string; threadId: string; error?: Error }>> {
    const {
      delayBetweenEmails = 1000,
      batchSize = 10,
      onProgress,
      onError
    } = options;

    const results: Array<{ messageId: string; threadId: string; error?: Error }> = [];
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (message, index) => {
        try {
          // Add delay to avoid rate limiting
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenEmails));
          }
          
          const result = await this.sendEmail(message);
          onProgress?.(i + index + 1, messages.length);
          
          return { ...result, error: undefined };
        } catch (error) {
          const err = error as Error;
          onError?.(err, message);
          return { messageId: '', threadId: '', error: err };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get email delivery status (read receipts, bounces)
   */
  async getMessageStatus(messageId: string): Promise<{
    delivered: boolean;
    opened?: boolean;
    clicked?: boolean;
    bounced?: boolean;
    spam?: boolean;
  }> {
    try {
      const message = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId
      });

      // Gmail doesn't provide detailed delivery status directly
      // This would typically require additional tracking pixels or third-party services
      return {
        delivered: message.data.labelIds?.includes('SENT') || false,
        // Additional tracking would require webhook integrations
      };
    } catch (error) {
      return { delivered: false, bounced: true };
    }
  }

  /**
   * Search for bounced emails
   */
  async getBouncedEmails(days: number = 7): Promise<Array<{
    messageId: string;
    recipient: string;
    bounceReason: string;
    timestamp: Date;
  }>> {
    const query = `in:inbox subject:(undelivered OR returned OR bounced) newer_than:${days}d`;
    
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query
      });

      const bounces = [];
      
      if (response.data.messages) {
        for (const msg of response.data.messages) {
          const message = await this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id
          });

          // Parse bounce information from message headers and body
          const bounce = this.parseBounceMessage(message.data);
          if (bounce) {
            bounces.push(bounce);
          }
        }
      }

      return bounces;
    } catch (error) {
      console.error('Failed to fetch bounced emails:', error);
      return [];
    }
  }

  /**
   * Parse bounce message details
   */
  private parseBounceMessage(message: any): {
    messageId: string;
    recipient: string;
    bounceReason: string;
    timestamp: Date;
  } | null {
    // Implementation would parse the bounce message
    // This is a simplified version
    const subject = message.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || '';
    const date = message.payload?.headers?.find((h: any) => h.name === 'Date')?.value;
    
    if (subject.toLowerCase().includes('undelivered') || subject.toLowerCase().includes('bounced')) {
      return {
        messageId: message.id,
        recipient: 'unknown@example.com', // Would be parsed from bounce message
        bounceReason: 'Email bounced',
        timestamp: new Date(date || Date.now())
      };
    }

    return null;
  }

  /**
   * Import contacts from Google Sheets
   */
  async importFromGoogleSheets(spreadsheetId: string, range: string = 'A:Z'): Promise<Array<{
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    [key: string]: any;
  }>> {
    const sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const values = response.data.values;
      if (!values || values.length === 0) {
        return [];
      }

      // Assume first row contains headers
      const headers = values[0].map(h => h.toString().toLowerCase().trim());
      const contacts = [];

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const contact: any = {};

        headers.forEach((header, index) => {
          const value = row[index]?.toString().trim();
          if (value) {
            // Map common column names
            switch (header) {
              case 'email':
              case 'email address':
              case 'e-mail':
                contact.email = value;
                break;
              case 'first name':
              case 'firstname':
              case 'fname':
                contact.firstName = value;
                break;
              case 'last name':
              case 'lastname':
              case 'lname':
                contact.lastName = value;
                break;
              case 'company':
              case 'organization':
              case 'org':
                contact.company = value;
                break;
              default:
                contact[header] = value;
            }
          }
        });

        // Only include contacts with valid emails
        if (contact.email && this.isValidEmail(contact.email)) {
          contacts.push(contact);
        }
      }

      return contacts;
    } catch (error) {
      console.error('Failed to import from Google Sheets:', error);
      throw new Error('Failed to import contacts from Google Sheets');
    }
  }

  /**
   * Validate email address
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Setup email tracking (requires webhook endpoint)
   */
  async setupEmailTracking(webhookUrl: string): Promise<void> {
    // This would set up Gmail push notifications for tracking
    // Requires proper webhook implementation on the server
    try {
      await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName: 'projects/your-project/topics/gmail-tracking',
          labelIds: ['SENT'],
          labelFilterAction: 'include'
        }
      });
    } catch (error) {
      console.error('Failed to setup email tracking:', error);
    }
  }

  /**
   * Send warm-up emails to improve sender reputation
   */
  async sendWarmupEmails(options: {
    count: number;
    recipientEmails: string[];
    subjectPrefix?: string;
    delay?: number;
  }): Promise<void> {
    const { count, recipientEmails, subjectPrefix = '[Warm-up]', delay = 3600000 } = options; // 1 hour delay

    const warmupMessages: EmailMessage[] = [];
    
    for (let i = 0; i < count; i++) {
      const recipient = recipientEmails[i % recipientEmails.length];
      
      warmupMessages.push({
        to: recipient,
        subject: `${subjectPrefix} Test Email ${i + 1}`,
        html: `
          <p>This is a warm-up email to improve sender reputation.</p>
          <p>Email ${i + 1} of ${count}</p>
          <p>This email can be safely ignored.</p>
        `,
        text: `This is a warm-up email to improve sender reputation. Email ${i + 1} of ${count}. This email can be safely ignored.`
      });
    }

    await this.sendBulkEmails(warmupMessages, {
      delayBetweenEmails: delay,
      batchSize: 1,
      onProgress: (sent, total) => {
        console.log(`Warm-up progress: ${sent}/${total} emails sent`);
      }
    });
  }
}

export default GmailIntegrationService;