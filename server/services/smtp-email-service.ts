import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  fromName?: string;
  fromEmail: string;
  replyTo?: string;
  provider: 'gmail' | 'outlook' | 'custom';
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
  headers?: Record<string, string>;
  trackingId?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp?: string;
}

// Preset SMTP configurations
export const SMTP_PRESETS: Record<string, Partial<SmtpConfig>> = {
  gmail: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    provider: 'gmail',
  },
  outlook: {
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    provider: 'outlook',
  },
  'office365': {
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    provider: 'outlook',
  },
  yahoo: {
    host: 'smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    provider: 'custom',
  },
};

export class SmtpEmailService {
  private transporters: Map<string, Transporter> = new Map();
  private dailySentCounts: Map<string, { count: number; date: string }> = new Map();

  /**
   * Resolve the correct secure flag based on the port.
   * Port 465 = implicit TLS (secure: true)
   * Port 587/25/2525 = STARTTLS (secure: false)
   */
  private resolveSecure(port: number, userSecure: boolean): boolean {
    if (port === 465) return true;
    if (port === 587 || port === 25 || port === 2525) return false;
    return userSecure; // respect user's choice for non-standard ports
  }

  /**
   * Create or get cached SMTP transporter
   */
  private getTransporter(accountId: string, config: SmtpConfig): Transporter {
    const cached = this.transporters.get(accountId);
    if (cached) return cached;

    const secure = this.resolveSecure(config.port, config.secure);

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass,
      },
      tls: {
        rejectUnauthorized: false, // Allow self-signed certs for dev
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5, // Max 5 messages per second
    });

    this.transporters.set(accountId, transporter);
    return transporter;
  }

  /**
   * Create a verification transporter with the given settings
   */
  private createVerifyTransporter(host: string, port: number, secure: boolean, auth: { user: string; pass: string }) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
  }

  /**
   * Verify SMTP connection (test credentials).
   * Automatically resolves SSL/STARTTLS based on port.
   * If connection fails with an SSL error, retries with the opposite security setting.
   */
  async verifyConnection(config: SmtpConfig): Promise<{ success: boolean; error?: string }> {
    const resolvedSecure = this.resolveSecure(config.port, config.secure);

    // First attempt: with the resolved secure setting
    try {
      const transporter = this.createVerifyTransporter(config.host, config.port, resolvedSecure, config.auth);
      await transporter.verify();
      transporter.close();
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`SMTP verification failed (secure=${resolvedSecure}):`, errMsg);

      // If it's an SSL mismatch error, retry with the opposite setting
      const isSSLError = errMsg.includes('wrong version number') ||
                         errMsg.includes('ssl3_get_record') ||
                         errMsg.includes('SSL routines') ||
                         errMsg.includes('WRONG_VERSION_NUMBER') ||
                         errMsg.includes('SSL23_GET_SERVER_HELLO') ||
                         errMsg.includes('EPROTO');

      if (isSSLError) {
        const retrySecure = !resolvedSecure;
        console.log(`SSL mismatch detected, retrying with secure=${retrySecure}...`);
        try {
          const retryTransporter = this.createVerifyTransporter(config.host, config.port, retrySecure, config.auth);
          await retryTransporter.verify();
          retryTransporter.close();
          // Update the config so subsequent calls use the correct setting
          config.secure = retrySecure;
          return { success: true };
        } catch (retryError) {
          const retryErrMsg = retryError instanceof Error ? retryError.message : 'Unknown error';
          console.error(`SMTP retry also failed (secure=${retrySecure}):`, retryErrMsg);
          // Return the more helpful error from the retry if it's not another SSL error
          const retryIsSSL = retryErrMsg.includes('wrong version number') || retryErrMsg.includes('ssl3_get_record');
          return {
            success: false,
            error: retryIsSSL
              ? `SSL/TLS configuration error: Could not connect on port ${config.port} with either SSL or STARTTLS. Try port 587 (STARTTLS) or port 465 (SSL).`
              : retryErrMsg,
          };
        }
      }

      return { success: false, error: errMsg };
    }
  }

  /**
   * Send a single email
   */
  async sendEmail(accountId: string, config: SmtpConfig, message: EmailMessage): Promise<SendResult> {
    try {
      // Check daily limit
      const dailyLimit = config.provider === 'gmail' ? 2000 : config.provider === 'outlook' ? 300 : 500;
      const today = new Date().toISOString().split('T')[0];
      const sentData = this.dailySentCounts.get(accountId);
      
      if (sentData && sentData.date === today && sentData.count >= dailyLimit) {
        return { success: false, error: `Daily send limit reached (${dailyLimit} emails/day)` };
      }

      const transporter = this.getTransporter(accountId, config);
      
      const fromAddress = config.fromName 
        ? `"${config.fromName}" <${config.fromEmail}>`
        : config.fromEmail;

      const mailOptions: any = {
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text || this.htmlToText(message.html),
      };

      if (message.cc) mailOptions.cc = message.cc;
      if (message.bcc) mailOptions.bcc = message.bcc;
      if (message.replyTo || config.replyTo) mailOptions.replyTo = message.replyTo || config.replyTo;
      if (message.attachments) mailOptions.attachments = message.attachments;
      if (message.headers) mailOptions.headers = message.headers;

      // Add custom tracking header
      if (message.trackingId) {
        mailOptions.headers = {
          ...mailOptions.headers,
          'X-MailFlow-Track': message.trackingId,
        };
      }

      const result = await transporter.sendMail(mailOptions);

      // Update daily count
      if (sentData && sentData.date === today) {
        sentData.count++;
      } else {
        this.dailySentCounts.set(accountId, { count: 1, date: today });
      }

      return {
        success: true,
        messageId: result.messageId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`SMTP send error for account ${accountId}:`, errMsg);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Send a test email to verify the account works
   */
  async sendTestEmail(accountId: string, config: SmtpConfig, toEmail: string): Promise<SendResult> {
    return this.sendEmail(accountId, config, {
      to: toEmail,
      subject: '✅ MailFlow SMTP Test - Connection Successful!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 30px; border-radius: 12px; text-align: center; color: white;">
            <h1 style="margin: 0 0 10px 0;">✅ Connection Successful!</h1>
            <p style="margin: 0; opacity: 0.9;">Your SMTP email account is configured correctly in MailFlow.</p>
          </div>
          <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
            <h3 style="color: #1e293b; margin-top: 0;">Account Details:</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b;">Provider:</td><td style="padding: 8px 0; font-weight: 600;">${config.provider}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b;">SMTP Host:</td><td style="padding: 8px 0; font-weight: 600;">${config.host}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b;">From Email:</td><td style="padding: 8px 0; font-weight: 600;">${config.fromEmail}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b;">Test Time:</td><td style="padding: 8px 0; font-weight: 600;">${new Date().toLocaleString()}</td></tr>
            </table>
            <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This is an automated test from MailFlow.</p>
          </div>
        </div>
      `,
    });
  }

  /**
   * Get daily quota info
   */
  getDailyQuota(accountId: string, provider: string): { daily: number; sent: number; remaining: number } {
    const dailyLimit = provider === 'gmail' ? 2000 : provider === 'outlook' ? 300 : 500;
    const today = new Date().toISOString().split('T')[0];
    const sentData = this.dailySentCounts.get(accountId);
    const sent = (sentData && sentData.date === today) ? sentData.count : 0;
    
    return {
      daily: dailyLimit,
      sent,
      remaining: Math.max(0, dailyLimit - sent),
    };
  }

  /**
   * Remove a cached transporter
   */
  removeTransporter(accountId: string): void {
    const transporter = this.transporters.get(accountId);
    if (transporter) {
      transporter.close();
      this.transporters.delete(accountId);
    }
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

// Singleton instance
export const smtpEmailService = new SmtpEmailService();
