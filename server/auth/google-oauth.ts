import { OAuth2Client } from 'google-auth-library';

export class GoogleOAuthService {
  private client: OAuth2Client;
  private redirectUri: string;

  constructor() {
    // Use dynamic redirect URI based on current host
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

    this.client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      this.redirectUri
    );
  }

  // Method to update redirect URI dynamically
  setRedirectUri(host: string) {
    this.redirectUri = `https://${host}/api/auth/google/callback`;
    this.client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      this.redirectUri
    );
  }

  getAuthUrl(): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly'
      ],
      prompt: 'consent',
      // Don't explicitly set redirect_uri here, let the OAuth client handle it
    });
  }

  async exchangeCodeForTokens(code: string) {
    const { tokens } = await this.client.getToken(code);
    this.client.setCredentials(tokens);
    return tokens;
  }

  async getUserInfo(accessToken: string) {
    this.client.setCredentials({ access_token: accessToken });
    
    const userInfoResponse = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
    );
    
    return await userInfoResponse.json();
  }

  async refreshAccessToken(refreshToken: string) {
    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();
    return credentials;
  }
}