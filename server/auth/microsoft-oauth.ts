import { ConfidentialClientApplication } from '@azure/msal-node';

export class MicrosoftOAuthService {
  private msalInstance: ConfidentialClientApplication;

  constructor() {
    this.msalInstance = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
        authority: 'https://login.microsoftonline.com/common'
      }
    });
  }

  async getAuthUrl(): Promise<string> {
    const authCodeUrlParameters = {
      scopes: [
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.Read'
      ],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:5000/api/auth/microsoft/callback',
    };

    return await this.msalInstance.getAuthCodeUrl(authCodeUrlParameters);
  }

  async exchangeCodeForTokens(code: string) {
    const tokenRequest = {
      code: code,
      scopes: [
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.Read'
      ],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:5000/api/auth/microsoft/callback',
    };

    const response = await this.msalInstance.acquireTokenByCode(tokenRequest);
    return response;
  }

  async getUserInfo(accessToken: string) {
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    return await userInfoResponse.json();
  }

  async refreshAccessToken(account: any) {
    const silentRequest = {
      scopes: [
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.Read'
      ],
      account: account,
    };

    const response = await this.msalInstance.acquireTokenSilent(silentRequest);
    return response;
  }
}