import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { storage } from '../storage';

interface OAuthConfig {
  gmail: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  outlook: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    redirectUri: string;
  };
}

export class OAuthService {
  private gmailOAuth2Client: OAuth2Client;
  private outlookClient: ConfidentialClientApplication;
  private config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
    
    // Initialize Gmail OAuth client
    this.gmailOAuth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );

    // Initialize Outlook OAuth client only if credentials are provided
    if (config.outlook.clientId && config.outlook.clientSecret) {
      this.outlookClient = new ConfidentialClientApplication({
        auth: {
          clientId: config.outlook.clientId,
          clientSecret: config.outlook.clientSecret,
          authority: `https://login.microsoftonline.com/${config.outlook.tenantId}`
        }
      });
    }
  }

  /**
   * Generate Gmail OAuth authorization URL
   */
  generateGmailAuthUrl(state: string): string {
    return this.gmailOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ],
      prompt: 'consent',
      state: state
    });
  }

  /**
   * Generate Outlook OAuth authorization URL
   */
  generateOutlookAuthUrl(state: string): string {
    if (!this.outlookClient) {
      throw new Error('Outlook OAuth not configured. Please set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET environment variables.');
    }

    const authCodeUrlParameters = {
      scopes: [
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Files.Read.All'
      ],
      redirectUri: this.config.outlook.redirectUri,
      state: state
    };

    return this.outlookClient.getAuthCodeUrl(authCodeUrlParameters);
  }

  /**
   * Exchange Gmail authorization code for tokens
   */
  async exchangeGmailCode(code: string, organizationId: string): Promise<{
    email: string;
    displayName: string;
    accountId: string;
  }> {
    try {
      const { tokens } = await this.gmailOAuth2Client.getAccessToken(code);
      
      // Set credentials to get user info
      this.gmailOAuth2Client.setCredentials(tokens);
      
      // Get user profile
      const oauth2 = google.oauth2({ version: 'v2', auth: this.gmailOAuth2Client });
      const userInfo = await oauth2.userinfo.get();
      
      const email = userInfo.data.email!;
      const displayName = userInfo.data.name || email;
      
      // Store email account with OAuth tokens
      const account = await storage.createEmailAccount({
        organizationId,
        provider: 'gmail',
        email,
        displayName,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: tokens.scope!,
        credentials: {
          type: 'oauth2',
          gmail: {
            clientId: this.config.gmail.clientId,
            scopes: tokens.scope?.split(' ') || []
          }
        },
        isVerified: true
      });

      return {
        email,
        displayName,
        accountId: account.id
      };
    } catch (error) {
      console.error('Gmail OAuth error:', error);
      throw new Error('Failed to authenticate with Gmail');
    }
  }

  /**
   * Exchange Outlook authorization code for tokens
   */
  async exchangeOutlookCode(code: string, organizationId: string): Promise<{
    email: string;
    displayName: string;
    accountId: string;
  }> {
    if (!this.outlookClient) {
      throw new Error('Outlook OAuth not configured');
    }

    try {
      const tokenRequest = {
        code,
        scopes: [
          'https://graph.microsoft.com/Mail.Send',
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/User.Read',
          'https://graph.microsoft.com/Files.Read.All'
        ],
        redirectUri: this.config.outlook.redirectUri
      };

      const response = await this.outlookClient.acquireTokenByCode(tokenRequest);
      
      if (!response) {
        throw new Error('No token response from Outlook');
      }

      // Get user info from Microsoft Graph
      const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${response.accessToken}`
        }
      });

      const userData = await userResponse.json();
      const email = userData.mail || userData.userPrincipalName;
      const displayName = userData.displayName || email;

      // Store email account with OAuth tokens
      const account = await storage.createEmailAccount({
        organizationId,
        provider: 'outlook',
        email,
        displayName,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken!,
        tokenExpiresAt: response.expiresOn ? new Date(response.expiresOn) : undefined,
        scope: response.scopes?.join(' '),
        credentials: {
          type: 'oauth2',
          outlook: {
            clientId: this.config.outlook.clientId,
            tenantId: response.tenantId,
            scopes: response.scopes || []
          }
        },
        isVerified: true
      });

      return {
        email,
        displayName,
        accountId: account.id
      };
    } catch (error) {
      console.error('Outlook OAuth error:', error);
      throw new Error('Failed to authenticate with Outlook');
    }
  }

  /**
   * Refresh Gmail access token
   */
  async refreshGmailToken(account: any): Promise<string> {
    try {
      this.gmailOAuth2Client.setCredentials({
        refresh_token: account.refreshToken
      });

      const { credentials } = await this.gmailOAuth2Client.refreshAccessToken();
      
      // Update stored tokens
      await storage.updateEmailAccount(account.id, {
        accessToken: credentials.access_token!,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
        updatedAt: new Date()
      });

      return credentials.access_token!;
    } catch (error) {
      console.error('Gmail token refresh error:', error);
      throw new Error('Failed to refresh Gmail token');
    }
  }

  /**
   * Refresh Outlook access token
   */
  async refreshOutlookToken(account: any): Promise<string> {
    try {
      const tokenRequest = {
        refreshToken: account.refreshToken,
        scopes: account.scope?.split(' ') || [
          'https://graph.microsoft.com/Mail.Send',
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/User.Read'
        ]
      };

      const response = await this.outlookClient.acquireTokenByRefreshToken(tokenRequest);
      
      if (!response) {
        throw new Error('No token response from Outlook refresh');
      }

      // Update stored tokens
      await storage.updateEmailAccount(account.id, {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken!,
        tokenExpiresAt: response.expiresOn ? new Date(response.expiresOn) : undefined,
        updatedAt: new Date()
      });

      return response.accessToken;
    } catch (error) {
      console.error('Outlook token refresh error:', error);
      throw new Error('Failed to refresh Outlook token');
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(account: any): Promise<string> {
    const now = new Date();
    const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
    
    // If token expires within 5 minutes, refresh it
    if (expiresAt && expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      if (account.provider === 'gmail') {
        return await this.refreshGmailToken(account);
      } else if (account.provider === 'outlook') {
        return await this.refreshOutlookToken(account);
      }
    }

    return account.accessToken;
  }

  /**
   * Revoke OAuth access for an account
   */
  async revokeAccess(accountId: string): Promise<void> {
    const account = await storage.getEmailAccount(accountId);
    if (!account) {
      throw new Error('Email account not found');
    }

    try {
      if (account.provider === 'gmail') {
        // Revoke Gmail token
        await this.gmailOAuth2Client.revokeCredentials();
      } else if (account.provider === 'outlook') {
        // For Outlook, we'd typically call the revoke endpoint
        // This is simplified - in production you'd call the proper revoke endpoint
      }

      // Update account status
      await storage.updateEmailAccount(accountId, {
        isActive: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error revoking OAuth access:', error);
      throw new Error('Failed to revoke OAuth access');
    }
  }

  /**
   * Test OAuth connection
   */
  async testConnection(accountId: string): Promise<boolean> {
    try {
      const account = await storage.getEmailAccount(accountId);
      if (!account) return false;

      const accessToken = await this.getValidAccessToken(account);
      
      if (account.provider === 'gmail') {
        // Test Gmail connection
        this.gmailOAuth2Client.setCredentials({ access_token: accessToken });
        const gmail = google.gmail({ version: 'v1', auth: this.gmailOAuth2Client });
        await gmail.users.getProfile({ userId: 'me' });
        return true;
      } else if (account.provider === 'outlook') {
        // Test Outlook connection
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        return response.ok;
      }

      return false;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}

export default OAuthService;