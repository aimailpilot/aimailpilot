import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import cookieParser from "cookie-parser";
import MemoryStore from "memorystore";
import { smtpEmailService, SMTP_PRESETS, type SmtpConfig } from "./services/smtp-email-service";
import { campaignEngine } from "./services/campaign-engine";
import { gmailReplyTracker } from "./services/gmail-reply-tracker";
import { OAuth2Client } from 'google-auth-library';

// In-memory user store for simplified authentication
const loggedInUsers = new Set<string>();

// ========== Google OAuth 2.0 Helper ==========
// Credentials can come from environment variables or api_settings (database)
// Priority: env vars > api_settings
const PRODUCTION_DOMAIN = 'mailsbellaward.com';

function getGoogleOAuthConfig(overrides?: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
  const clientId = overrides?.clientId || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = overrides?.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = overrides?.redirectUri || process.env.GOOGLE_REDIRECT_URI || '';
  return { clientId, clientSecret, redirectUri };
}

function createOAuth2Client(config: { clientId: string; clientSecret: string; redirectUri: string }) {
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

// Detect public base URL from request headers
function getBaseUrlFromRequest(req: any): string {
  let proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  // Force HTTPS for non-localhost hosts (sandbox proxies, production domains)
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    proto = 'https';
  }
  return `${proto}://${host}`;
}

// Simple auth middleware
const requireAuth = (req: any, res: any, next: any) => {
  const userId = req.cookies?.user_id || req.session?.userId;
  if (userId && loggedInUsers.has(userId)) {
    // Get user data from session
    const sessionUser = (req.session as any)?.user;
    req.user = { 
      id: userId, 
      organizationId: '550e8400-e29b-41d4-a716-446655440001', 
      role: 'admin',
      email: sessionUser?.email || 'unknown',
      name: sessionUser?.name || 'Unknown',
    };
    // Auto-detect public URL for tracking links
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost')) {
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      campaignEngine.setPublicBaseUrl(`${proto}://${host}`);
    }
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  app.set('trust proxy', 1);
  app.use(cookieParser());

  // Load persisted tracking base URL from settings on startup
  try {
    const orgSettings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
    if (orgSettings.tracking_base_url) {
      campaignEngine.setPublicBaseUrl(orgSettings.tracking_base_url);
      console.log('[Tracking] Loaded base URL from settings:', orgSettings.tracking_base_url);
    }
  } catch (e) { /* ignore on startup */ }

  // Auto-detect public URL on every request for tracking link generation
  // Only auto-detect if no manual tracking_base_url is configured
  app.use(async (req: any, _res: any, next: any) => {
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost')) {
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const detectedUrl = `${proto}://${host}`;
      // Always update to latest detected URL (ensures HTTPS via setPublicBaseUrl)
      campaignEngine.setPublicBaseUrl(detectedUrl);
    }
    next();
  });
  
  const MemStore = MemoryStore(session);
  
  // Detect if running in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  app.use(session({
    store: new MemStore({ checkPeriod: 86400000 }),
    secret: process.env.SESSION_SECRET || 'mailflow-dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: isProduction,  // Use secure cookies in production (HTTPS)
      httpOnly: true, 
      maxAge: 24 * 60 * 60 * 1000, 
      sameSite: 'lax',
      // In production, set domain for mailsbellaward.com
      ...(isProduction && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    },
    name: 'connect.sid'
  }));

  // ========== AUTH ROUTES ==========
  
  // Simple login (fallback/dev only)
  app.post('/api/auth/simple-login', (req, res) => {
    const userId = 'user-123';
    const mockUser = { id: userId, email: 'demo@mailflow.app', name: 'Demo User', picture: '', provider: 'google', access_token: 'demo-token' };
    loggedInUsers.add(userId);
    res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
    (req.session as any).userId = userId;
    (req.session as any).user = mockUser;
    res.json({ success: true, user: mockUser });
  });

  // ===== REAL GOOGLE OAUTH 2.0 =====
  // Step 1: Redirect user to Google's consent screen
  app.get('/api/auth/google', async (req: any, res) => {
    try {
      // Determine redirect URI from the current request
      const baseUrl = getBaseUrlFromRequest(req);
      const redirectUri = `${baseUrl}/api/auth/google/callback`;

      // Try to load credentials from api_settings first, then env vars
      let clientId = process.env.GOOGLE_CLIENT_ID || '';
      let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

      try {
        // Check api_settings for stored OAuth credentials (use a default org)
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.google_oauth_client_id) clientId = settings.google_oauth_client_id;
        if (settings.google_oauth_client_secret) clientSecret = settings.google_oauth_client_secret;
      } catch (e) { /* ignore - use env vars */ }

      if (!clientId || !clientSecret) {
        // No OAuth configured - fall back to demo login
        console.warn('[Auth] Google OAuth not configured, falling back to demo login');
        const userId = 'google-demo-user';
        const mockUser = { id: userId, email: 'demo@mailflow.app', name: 'Demo User', picture: '', provider: 'google', access_token: 'demo-token' };
        loggedInUsers.add(userId);
        res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
        res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
        (req.session as any).userId = userId;
        (req.session as any).user = mockUser;
        return req.session.save(() => { res.redirect('/?connected=true'); });
      }

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.readonly',
          'openid',
        ],
        state: JSON.stringify({ redirectUri }),
      });

      console.log('[Auth] Redirecting to Google OAuth, redirect_uri:', redirectUri);
      res.redirect(authUrl);
    } catch (error) {
      console.error('[Auth] Google OAuth init error:', error);
      res.redirect('/?error=oauth_init_failed');
    }
  });

  // Step 2: Handle Google OAuth callback
  app.get('/api/auth/google/callback', async (req: any, res) => {
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        console.error('[Auth] Google OAuth error:', oauthError);
        return res.redirect('/?error=oauth_denied');
      }

      if (!code) {
        return res.redirect('/?error=no_code');
      }

      // Parse state to get the redirect URI used during initiation
      let redirectUri = `${getBaseUrlFromRequest(req)}/api/auth/google/callback`;
      try {
        if (state) {
          const parsed = JSON.parse(state as string);
          if (parsed.redirectUri) redirectUri = parsed.redirectUri;
        }
      } catch (e) { /* use default */ }

      // Load credentials
      let clientId = process.env.GOOGLE_CLIENT_ID || '';
      let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

      try {
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.google_oauth_client_id) clientId = settings.google_oauth_client_id;
        if (settings.google_oauth_client_secret) clientSecret = settings.google_oauth_client_secret;
      } catch (e) { /* use env vars */ }

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      // Get user info from Google
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoResponse.ok) {
        console.error('[Auth] Failed to get Google user info:', userInfoResponse.status);
        return res.redirect('/?error=user_info_failed');
      }

      const googleUser = await userInfoResponse.json() as any;
      const email = googleUser.email;
      const name = googleUser.name || email;
      const picture = googleUser.picture || '';
      const firstName = googleUser.given_name || name.split(' ')[0] || '';
      const lastName = googleUser.family_name || name.split(' ').slice(1).join(' ') || '';

      console.log('[Auth] Google OAuth success for:', email);

      // Upsert user in database
      const defaultOrgId = '550e8400-e29b-41d4-a716-446655440001';
      let dbUser = await storage.getUserByEmail(email) as any;
      if (!dbUser) {
        dbUser = await storage.createUser({
          email,
          firstName,
          lastName,
          role: 'admin',
          organizationId: defaultOrgId,
          isActive: true,
        });
        console.log('[Auth] Created new user:', dbUser.id, email);
      } else {
        // Update name/picture if changed
        await storage.updateUser(dbUser.id, { firstName, lastName });
        console.log('[Auth] Updated existing user:', dbUser.id, email);
      }

      const userId = dbUser.id;
      const userObj = {
        id: userId,
        email,
        name,
        picture,
        provider: 'google',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
      };

      // Store Gmail tokens in api_settings for reply tracking service
      const defaultOrgIdForTokens = '550e8400-e29b-41d4-a716-446655440001';
      try {
        if (tokens.access_token) {
          await storage.setApiSetting(defaultOrgIdForTokens, 'gmail_access_token', tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(defaultOrgIdForTokens, 'gmail_refresh_token', tokens.refresh_token);
        }
        if (tokens.expiry_date) {
          await storage.setApiSetting(defaultOrgIdForTokens, 'gmail_token_expiry', String(tokens.expiry_date));
        }
        await storage.setApiSetting(defaultOrgIdForTokens, 'gmail_user_email', email);
        console.log('[Auth] Stored Gmail tokens for reply tracking');

        // Start automatic reply checking
        gmailReplyTracker.startAutoCheck(defaultOrgIdForTokens, 5);
      } catch (tokenStoreError) {
        console.error('[Auth] Failed to store Gmail tokens:', tokenStoreError);
      }

      // Set session and cookies
      loggedInUsers.add(userId);
      const cookieOpts: any = { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax', secure: false, path: '/' };
      // Use secure cookies in production
      const host = req.headers['host'] || '';
      if (host.includes(PRODUCTION_DOMAIN) || host.includes('.pages.dev') || host.includes('.sandbox.novita.ai')) {
        cookieOpts.secure = true;
        cookieOpts.sameSite = 'lax';
      }
      res.cookie('user_id', userId, cookieOpts);
      res.cookie('user_data', JSON.stringify(userObj), cookieOpts);
      (req.session as any).userId = userId;
      (req.session as any).user = userObj;

      req.session.save(() => {
        res.redirect('/?connected=true');
      });
    } catch (error) {
      console.error('[Auth] Google OAuth callback error:', error);
      res.redirect('/?error=oauth_callback_failed');
    }
  });

  // ===== REAL MICROSOFT / OUTLOOK OAUTH 2.0 =====
  // Step 1: Redirect user to Microsoft's consent screen
  app.get('/api/auth/microsoft', async (req: any, res) => {
    try {
      const baseUrl = getBaseUrlFromRequest(req);
      const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;

      // Load credentials from api_settings first, then env vars
      let clientId = process.env.MICROSOFT_CLIENT_ID || '';
      let clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

      try {
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.microsoft_oauth_client_id) clientId = settings.microsoft_oauth_client_id;
        if (settings.microsoft_oauth_client_secret) clientSecret = settings.microsoft_oauth_client_secret;
      } catch (e) { /* ignore - use env vars */ }

      if (!clientId || !clientSecret) {
        // No OAuth configured - fall back to demo login
        console.warn('[Auth] Microsoft OAuth not configured, falling back to demo login');
        const userId = 'microsoft-demo-user';
        const mockUser = { id: userId, email: 'demo@mailflow.app', name: 'Demo User', picture: '', provider: 'microsoft', access_token: 'demo-ms-token' };
        loggedInUsers.add(userId);
        res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
        res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
        (req.session as any).userId = userId;
        (req.session as any).user = mockUser;
        return req.session.save(() => { res.redirect('/?connected=true'); });
      }

      // Microsoft OAuth 2.0 authorization URL (using 'common' tenant for multi-tenant support)
      const scopes = [
        'openid',
        'profile',
        'email',
        'offline_access',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.Send',
      ];

      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', scopes.join(' '));
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', JSON.stringify({ redirectUri }));

      console.log('[Auth] Redirecting to Microsoft OAuth, redirect_uri:', redirectUri);
      res.redirect(authUrl.toString());
    } catch (error) {
      console.error('[Auth] Microsoft OAuth init error:', error);
      res.redirect('/?error=ms_oauth_init_failed');
    }
  });

  // Step 2: Handle Microsoft OAuth callback
  app.get('/api/auth/microsoft/callback', async (req: any, res) => {
    try {
      const { code, state, error: oauthError, error_description } = req.query;

      if (oauthError) {
        console.error('[Auth] Microsoft OAuth error:', oauthError, error_description);
        return res.redirect('/?error=ms_oauth_denied');
      }

      if (!code) {
        return res.redirect('/?error=ms_no_code');
      }

      // Parse state to get the redirect URI used during initiation
      let redirectUri = `${getBaseUrlFromRequest(req)}/api/auth/microsoft/callback`;
      try {
        if (state) {
          const parsed = JSON.parse(state as string);
          if (parsed.redirectUri) redirectUri = parsed.redirectUri;
        }
      } catch (e) { /* use default */ }

      // Load credentials
      let clientId = process.env.MICROSOFT_CLIENT_ID || '';
      let clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

      try {
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.microsoft_oauth_client_id) clientId = settings.microsoft_oauth_client_id;
        if (settings.microsoft_oauth_client_secret) clientSecret = settings.microsoft_oauth_client_secret;
      } catch (e) { /* use env vars */ }

      // Exchange authorization code for tokens
      const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code as string,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send',
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error('[Auth] Microsoft token exchange failed:', tokenResponse.status, errBody);
        return res.redirect('/?error=ms_token_failed');
      }

      const tokens = await tokenResponse.json() as any;
      console.log('[Auth] Microsoft token exchange successful');

      // Get user info from Microsoft Graph
      const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoResponse.ok) {
        console.error('[Auth] Failed to get Microsoft user info:', userInfoResponse.status);
        return res.redirect('/?error=ms_user_info_failed');
      }

      const msUser = await userInfoResponse.json() as any;
      const email = msUser.mail || msUser.userPrincipalName || '';
      const name = msUser.displayName || email;
      const firstName = msUser.givenName || name.split(' ')[0] || '';
      const lastName = msUser.surname || name.split(' ').slice(1).join(' ') || '';

      console.log('[Auth] Microsoft OAuth success for:', email);

      // Upsert user in database
      const defaultOrgId = '550e8400-e29b-41d4-a716-446655440001';
      let dbUser = await storage.getUserByEmail(email) as any;
      if (!dbUser) {
        dbUser = await storage.createUser({
          email,
          firstName,
          lastName,
          role: 'admin',
          organizationId: defaultOrgId,
          isActive: true,
        });
        console.log('[Auth] Created new Microsoft user:', dbUser.id, email);
      } else {
        await storage.updateUser(dbUser.id, { firstName, lastName });
        console.log('[Auth] Updated existing Microsoft user:', dbUser.id, email);
      }

      const userId = dbUser.id;
      const userObj = {
        id: userId,
        email,
        name,
        picture: '',
        provider: 'microsoft',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
      };

      // Store Microsoft tokens in api_settings for future use (mail send, read, etc.)
      try {
        if (tokens.access_token) {
          await storage.setApiSetting(defaultOrgId, 'microsoft_access_token', tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(defaultOrgId, 'microsoft_refresh_token', tokens.refresh_token);
        }
        if (tokens.expires_in) {
          const expiryDate = Date.now() + (tokens.expires_in * 1000);
          await storage.setApiSetting(defaultOrgId, 'microsoft_token_expiry', String(expiryDate));
        }
        await storage.setApiSetting(defaultOrgId, 'microsoft_user_email', email);
        console.log('[Auth] Stored Microsoft tokens for mail integration');
      } catch (tokenStoreError) {
        console.error('[Auth] Failed to store Microsoft tokens:', tokenStoreError);
      }

      // Set session and cookies
      loggedInUsers.add(userId);
      const cookieOpts: any = { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax', secure: false, path: '/' };
      const host = req.headers['host'] || '';
      if (host.includes(PRODUCTION_DOMAIN) || host.includes('.pages.dev') || host.includes('.sandbox.novita.ai')) {
        cookieOpts.secure = true;
        cookieOpts.sameSite = 'lax';
      }
      res.cookie('user_id', userId, cookieOpts);
      res.cookie('user_data', JSON.stringify(userObj), cookieOpts);
      (req.session as any).userId = userId;
      (req.session as any).user = userObj;

      req.session.save(() => {
        res.redirect('/?connected=true');
      });
    } catch (error) {
      console.error('[Auth] Microsoft OAuth callback error:', error);
      res.redirect('/?error=ms_oauth_failed');
    }
  });

  app.get('/api/auth/google/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const userId = req.cookies?.user_id;
    if (userId && loggedInUsers.has(userId)) {
      const session = req.session as any;
      const user = session?.user;
      return res.json({ connected: true, email: user?.email || 'unknown', demo: !user?.access_token || user?.access_token === 'demo-token' });
    }
    res.json({ connected: false });
  });

  app.get('/api/auth/microsoft/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const userId = req.cookies?.user_id;
    if (userId && loggedInUsers.has(userId)) {
      const session = req.session as any;
      const user = session?.user;
      if (user?.provider === 'microsoft') {
        return res.json({ connected: true, email: user?.email || 'unknown', demo: !user?.access_token || user?.access_token === 'demo-ms-token' });
      }
      // Also check if Microsoft tokens are stored (user logged in with Google but connected Outlook too)
      try {
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.microsoft_access_token && settings.microsoft_user_email) {
          return res.json({ connected: true, email: settings.microsoft_user_email, demo: false });
        }
      } catch (e) { /* ignore */ }
    }
    res.json({ connected: false });
  });

  app.get('/api/auth/user', (req, res) => {
    const session = req.session as any;
    if (session?.user) return res.json(session.user);
    const userId = req.cookies?.user_id;
    const userData = req.cookies?.user_data;
    if (userId && loggedInUsers.has(userId) && userData) {
      try {
        const user = JSON.parse(userData);
        (req.session as any).userId = userId;
        (req.session as any).user = user;
        return res.json(user);
      } catch (err) { /* ignore */ }
    }
    res.status(401).json({ error: 'Not authenticated' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const userId = req.cookies?.user_id || (req.session as any)?.userId;
    if (userId) loggedInUsers.delete(userId);
    res.clearCookie('user_id');
    res.clearCookie('user_data');
    res.clearCookie('connect.sid');
    if (req.session) req.session.destroy(() => {});
    res.json({ success: true });
  });

  // OAuth config status check (for Advanced Settings UI)
  app.get('/api/auth/oauth-config-status', async (req: any, res) => {
    try {
      let googleClientId = process.env.GOOGLE_CLIENT_ID || '';
      let msClientId = process.env.MICROSOFT_CLIENT_ID || '';
      try {
        const settings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
        if (settings.google_oauth_client_id) googleClientId = settings.google_oauth_client_id;
        if (settings.microsoft_oauth_client_id) msClientId = settings.microsoft_oauth_client_id;
      } catch (e) { /* ignore */ }
      res.json({
        googleOAuth: !!googleClientId,
        microsoftOAuth: !!msClientId,
        productionDomain: PRODUCTION_DOMAIN,
      });
    } catch (error) {
      res.json({ googleOAuth: false, microsoftOAuth: false });
    }
  });

  app.get('/api/test', (req, res) => {
    res.json({ message: 'MailFlow server is running!', timestamp: new Date().toISOString() });
  });

  // Apply auth middleware
  app.use('/api/campaigns', requireAuth);
  app.use('/api/dashboard', requireAuth);
  app.use('/api/contacts', requireAuth);
  app.use('/api/templates', requireAuth);
  app.use('/api/analytics', requireAuth);
  app.use('/api/email-accounts', requireAuth);
  app.use('/api/integrations', requireAuth);
  app.use('/api/followup', requireAuth);
  app.use('/api/followup-sequences', requireAuth);
  app.use('/api/followup-steps', requireAuth);
  app.use('/api/segments', requireAuth);
  app.use('/api/contact-lists', requireAuth);
  app.use('/api/tracking', requireAuth);
  app.use('/api/account', requireAuth);
  app.use('/api/settings', requireAuth);
  app.use('/api/llm', requireAuth);

  // ========== DASHBOARD ==========
  
  app.get('/api/dashboard/stats', async (req: any, res) => {
    try {
      const stats = await storage.getCampaignStats(req.user.organizationId);
      const openRate = stats.totalSent > 0 ? ((stats.totalOpened / stats.totalSent) * 100).toFixed(1) : '0';
      const replyRate = stats.totalSent > 0 ? ((stats.totalReplied / stats.totalSent) * 100).toFixed(1) : '0';
      const deliveryRate = stats.totalSent > 0 ? (((stats.totalSent - stats.totalBounced) / stats.totalSent) * 100).toFixed(1) : '0';
      
      res.json({
        activeCampaigns: stats.activeCampaigns || 0,
        totalCampaigns: stats.totalCampaigns || 0,
        openRate: parseFloat(openRate),
        replyRate: parseFloat(replyRate),
        deliverability: parseFloat(deliveryRate) || 97.8,
        totalSent: stats.totalSent || 0,
        totalOpened: stats.totalOpened || 0,
        totalClicked: stats.totalClicked || 0,
        totalReplied: stats.totalReplied || 0,
        totalBounced: stats.totalBounced || 0,
        totalUnsubscribed: stats.totalUnsubscribed || 0,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
  });

  // ========== EMAIL ACCOUNTS (SMTP) ==========

  app.get('/api/email-accounts', async (req: any, res) => {
    try {
      const accounts = await storage.getEmailAccounts(req.user.organizationId);
      // Don't return passwords in the response
      const safe = accounts.map((a: any) => ({
        ...a,
        smtpConfig: a.smtpConfig ? {
          ...a.smtpConfig,
          auth: { user: a.smtpConfig.auth?.user, pass: '••••••••' }
        } : null,
      }));
      res.json(safe);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch email accounts' });
    }
  });

  app.get('/api/email-accounts/:id', async (req: any, res, next: any) => {
    // Skip if this is a known static sub-path (handled by later routes)
    if (['quota-summary', 'recommend'].includes(req.params.id)) {
      return next();
    }
    try {
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) return res.status(404).json({ message: 'Not found' });
      res.json({
        ...account,
        smtpConfig: account.smtpConfig ? {
          ...account.smtpConfig,
          auth: { user: account.smtpConfig.auth?.user, pass: '••••••••' }
        } : null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch email account' });
    }
  });

  app.post('/api/email-accounts', async (req: any, res) => {
    try {
      const { provider, email, displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, replyTo } = req.body;

      if (!email || !smtpUser || !smtpPass) {
        return res.status(400).json({ message: 'Email, SMTP username, and password are required' });
      }

      // Build SMTP config from preset or custom
      const preset = SMTP_PRESETS[provider];
      const resolvedPort = smtpPort || preset?.port || 587;
      // Auto-resolve secure based on port: 465 = implicit SSL, 587/25/2525 = STARTTLS
      let resolvedSecure: boolean;
      if (resolvedPort === 465) {
        resolvedSecure = true;
      } else if (resolvedPort === 587 || resolvedPort === 25 || resolvedPort === 2525) {
        resolvedSecure = false;
      } else {
        resolvedSecure = smtpSecure !== undefined ? smtpSecure : (preset?.secure || false);
      }
      const smtpConfig: SmtpConfig = {
        host: smtpHost || preset?.host || 'smtp.gmail.com',
        port: resolvedPort,
        secure: resolvedSecure,
        auth: { user: smtpUser, pass: smtpPass },
        fromName: displayName || '',
        fromEmail: email,
        replyTo: replyTo || '',
        provider: (provider as 'gmail' | 'outlook' | 'custom') || 'custom',
      };

      // Create account
      const account = await storage.createEmailAccount({
        organizationId: req.user.organizationId,
        provider: provider || 'custom',
        email,
        displayName: displayName || email,
        smtpConfig,
        dailyLimit: provider === 'gmail' ? 2000 : provider === 'outlook' ? 300 : 500,
        isActive: true,
      });

      res.status(201).json({
        ...account,
        smtpConfig: { ...account.smtpConfig, auth: { user: smtpConfig.auth.user, pass: '••••••••' } },
        message: `Email account ${email} added successfully. Use the "Test" button to verify your SMTP credentials.`,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error creating email account:', errMsg);
      res.status(500).json({ 
        message: `Failed to create email account: ${errMsg}`,
        code: 'CREATE_FAILED'
      });
    }
  });

  app.post('/api/email-accounts/:id/test', async (req: any, res) => {
    try {
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) {
        return res.status(404).json({ 
          success: false, 
          error: `Email account with ID "${req.params.id}" was not found. It may have been deleted or the ID is incorrect.`,
          code: 'ACCOUNT_NOT_FOUND'
        });
      }
      if (!account.smtpConfig) {
        return res.status(400).json({ 
          success: false, 
          error: 'SMTP is not configured for this account. Please update the account with valid SMTP settings.',
          code: 'SMTP_NOT_CONFIGURED'
        });
      }

      // Verify SMTP connection
      const verifyResult = await smtpEmailService.verifyConnection(account.smtpConfig);
      if (!verifyResult.success) {
        return res.json({ 
          success: false, 
          error: verifyResult.error,
          code: 'SMTP_VERIFY_FAILED',
          provider: account.provider,
          host: account.smtpConfig.host,
        });
      }

      // Send test email
      const testEmail = req.body.testEmail || account.email;
      const sendResult = await smtpEmailService.sendTestEmail(account.id, account.smtpConfig, testEmail);
      
      res.json({
        ...sendResult,
        provider: account.provider,
        email: account.email,
        host: account.smtpConfig.host,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: `Internal error while testing: ${errMsg}`, code: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/email-accounts/:id/verify', async (req: any, res) => {
    try {
      const account = await storage.getEmailAccount(req.params.id);
      if (!account || !account.smtpConfig) {
        return res.status(404).json({ message: 'Account not found or SMTP not configured' });
      }
      const result = await smtpEmailService.verifyConnection(account.smtpConfig);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to verify' });
    }
  });

  app.put('/api/email-accounts/:id', async (req: any, res) => {
    try {
      const existing = await storage.getEmailAccount(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Not found' });

      const { displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, replyTo } = req.body;
      const updates: any = {};
      
      if (displayName !== undefined) updates.displayName = displayName;
      
      if (smtpHost || smtpUser || smtpPass) {
        updates.smtpConfig = {
          ...existing.smtpConfig,
          ...(smtpHost ? { host: smtpHost } : {}),
          ...(smtpPort ? { port: smtpPort } : {}),
          ...(smtpSecure !== undefined ? { secure: smtpSecure } : {}),
          ...(smtpUser ? { auth: { ...existing.smtpConfig.auth, user: smtpUser } } : {}),
          ...(smtpPass && smtpPass !== '••••••••' ? { auth: { ...existing.smtpConfig.auth, pass: smtpPass } } : {}),
          ...(replyTo !== undefined ? { replyTo } : {}),
          ...(displayName ? { fromName: displayName } : {}),
        };
        // Clear cached transporter
        smtpEmailService.removeTransporter(req.params.id);
      }

      const updated = await storage.updateEmailAccount(req.params.id, updates);
      res.json({
        ...updated,
        smtpConfig: updated.smtpConfig ? { ...updated.smtpConfig, auth: { user: updated.smtpConfig.auth?.user, pass: '••••••••' } } : null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update email account' });
    }
  });

  app.delete('/api/email-accounts/:id', async (req: any, res) => {
    try {
      smtpEmailService.removeTransporter(req.params.id);
      await storage.deleteEmailAccount(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete email account' });
    }
  });

  app.get('/api/email-accounts/:id/quota', async (req: any, res) => {
    try {
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) {
        return res.status(404).json({ 
          message: `Email account with ID "${req.params.id}" not found`,
          code: 'ACCOUNT_NOT_FOUND'
        });
      }
      const quota = smtpEmailService.getDailyQuota(account.id, account.provider);
      res.json({
        ...quota,
        provider: account.provider,
        email: account.email,
        resetTime: 'Midnight UTC',
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch quota' });
    }
  });

  // ========== EMAIL ACCOUNT QUOTA SUMMARY & AI RECOMMENDATION ==========

  app.get('/api/email-accounts/quota-summary', async (req: any, res) => {
    try {
      const accounts = await storage.getEmailAccounts(req.user.organizationId);
      const accountQuotas = accounts.map((a: any) => {
        const quota = smtpEmailService.getDailyQuota(a.id, a.provider);
        return {
          id: a.id,
          email: a.email,
          displayName: a.displayName || a.email,
          provider: a.provider,
          isActive: a.isActive,
          dailyLimit: quota.daily,
          dailySent: quota.sent,
          remaining: quota.remaining,
          usagePercent: quota.daily > 0 ? Math.round((quota.sent / quota.daily) * 100) : 0,
          resetTime: 'Midnight UTC',
        };
      });

      const totalLimit = accountQuotas.reduce((s: number, a: any) => s + a.dailyLimit, 0);
      const totalSent = accountQuotas.reduce((s: number, a: any) => s + a.dailySent, 0);
      const totalRemaining = accountQuotas.reduce((s: number, a: any) => s + a.remaining, 0);

      res.json({
        accounts: accountQuotas,
        summary: {
          totalAccounts: accountQuotas.length,
          activeAccounts: accountQuotas.filter((a: any) => a.isActive).length,
          totalDailyLimit: totalLimit,
          totalDailySent: totalSent,
          totalRemaining,
          overallUsagePercent: totalLimit > 0 ? Math.round((totalSent / totalLimit) * 100) : 0,
        },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch quota summary' });
    }
  });

  app.post('/api/email-accounts/recommend', async (req: any, res) => {
    try {
      const { recipientCount, campaignType, campaignName } = req.body;
      const accounts = await storage.getEmailAccounts(req.user.organizationId);

      const accountQuotas = accounts.map((a: any) => {
        const quota = smtpEmailService.getDailyQuota(a.id, a.provider);
        return {
          id: a.id,
          email: a.email,
          displayName: a.displayName || a.email,
          provider: a.provider,
          isActive: a.isActive,
          dailyLimit: quota.daily,
          dailySent: quota.sent,
          remaining: quota.remaining,
          usagePercent: quota.daily > 0 ? Math.round((quota.sent / quota.daily) * 100) : 0,
        };
      });

      // Try Azure OpenAI for intelligent recommendation
      const settings = await storage.getApiSettings(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (endpoint && apiKey && deploymentName) {
        const systemPrompt = `You are an AI email campaign advisor. Analyze the user's email accounts and their quotas, then recommend the best account(s) to use for sending a campaign. Consider:
1. Remaining daily quota vs number of recipients
2. Provider reputation (Gmail has high deliverability, Outlook is good for business)
3. Whether one account can handle all recipients or if splitting is needed
4. Usage patterns - avoid accounts near their daily limit
5. Account status (only recommend active accounts)

Return a JSON response with this exact structure:
{
  "recommendedAccountId": "id of the best account",
  "recommendedAccountEmail": "email of the best account",
  "reason": "Brief explanation why this account is recommended",
  "strategy": "single" or "split",
  "splitPlan": [{"accountId": "...", "email": "...", "count": 123, "reason": "..."}] (only if strategy is split),
  "warnings": ["any warnings about quota limits or risks"],
  "tips": ["helpful tips for better deliverability"]
}`;

        const userPrompt = `I need to send a campaign "${campaignName || 'Email Campaign'}" (type: ${campaignType || 'marketing'}) to ${recipientCount || 'unknown number of'} recipients.

Here are my email accounts and their current quotas:
${JSON.stringify(accountQuotas, null, 2)}

Which account should I use and why? If I need to split across accounts, provide a split plan.`;

        try {
          const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              max_tokens: 800,
              temperature: 0.3,
              response_format: { type: 'json_object' },
            }),
          });

          if (response.ok) {
            const data = await response.json() as any;
            const content = data?.choices?.[0]?.message?.content || '';
            try {
              const recommendation = JSON.parse(content);
              return res.json({
                ...recommendation,
                accounts: accountQuotas,
                provider: 'azure-openai',
                model: data?.model || deploymentName,
              });
            } catch (parseError) {
              // LLM returned non-JSON, use rule-based fallback
              console.error('Failed to parse LLM recommendation:', content);
            }
          }
        } catch (llmError) {
          console.error('Azure OpenAI recommendation failed:', llmError);
        }
      }

      // Fallback: rule-based recommendation
      const activeAccounts = accountQuotas.filter((a: any) => a.isActive && a.remaining > 0);
      if (activeAccounts.length === 0) {
        return res.json({
          recommendedAccountId: null,
          recommendedAccountEmail: null,
          reason: 'No active accounts with available quota. Please add an email account or wait for quota reset.',
          strategy: 'none',
          warnings: ['All accounts have exhausted their daily quota or are inactive.'],
          tips: ['Add more email accounts to increase your sending capacity.', 'Wait until midnight UTC for quota reset.'],
          accounts: accountQuotas,
          provider: 'rule-based',
        });
      }

      // Sort by remaining quota (descending)
      activeAccounts.sort((a: any, b: any) => b.remaining - a.remaining);
      const best = activeAccounts[0];
      const count = recipientCount || 0;

      if (count <= best.remaining) {
        return res.json({
          recommendedAccountId: best.id,
          recommendedAccountEmail: best.email,
          reason: `${best.email} has ${best.remaining} emails remaining today (${best.dailySent}/${best.dailyLimit} used). Enough capacity for ${count || 'your'} recipients.`,
          strategy: 'single',
          warnings: best.usagePercent > 70 ? [`${best.email} is at ${best.usagePercent}% of daily limit.`] : [],
          tips: ['Consider sending during business hours for better open rates.'],
          accounts: accountQuotas,
          provider: 'rule-based',
        });
      }

      // Need to split
      const splitPlan: any[] = [];
      let remaining = count;
      for (const acct of activeAccounts) {
        if (remaining <= 0) break;
        const assign = Math.min(remaining, acct.remaining);
        if (assign > 0) {
          splitPlan.push({ accountId: acct.id, email: acct.email, count: assign, reason: `${acct.remaining} available` });
          remaining -= assign;
        }
      }

      const totalAvailable = activeAccounts.reduce((s: any, a: any) => s + a.remaining, 0);
      return res.json({
        recommendedAccountId: best.id,
        recommendedAccountEmail: best.email,
        reason: `No single account has enough quota for ${count} recipients. Recommend splitting across ${splitPlan.length} accounts.`,
        strategy: remaining > 0 ? 'insufficient' : 'split',
        splitPlan,
        warnings: remaining > 0 ? [`Total available quota (${totalAvailable}) is less than recipients (${count}). ${remaining} emails won't be sent.`] : [],
        tips: ['Consider splitting your campaign into multiple sends across different days.'],
        accounts: accountQuotas,
        provider: 'rule-based',
      });
    } catch (error) {
      console.error('Recommendation error:', error);
      res.status(500).json({ message: 'Failed to generate recommendation' });
    }
  });

  // ========== CAMPAIGNS ==========

  app.get('/api/campaigns', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const campaigns = await storage.getCampaigns(req.user.organizationId, limit, offset);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaigns' });
    }
  });

  app.get('/api/campaigns/:id', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Not found' });
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaign' });
    }
  });

  app.post('/api/campaigns', async (req: any, res) => {
    try {
      const campaign = await storage.createCampaign({
        ...req.body,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
        status: req.body.status || 'draft',
      });
      res.status(201).json(campaign);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create campaign' });
    }
  });

  app.put('/api/campaigns/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateCampaign(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update campaign' });
    }
  });

  app.delete('/api/campaigns/:id', async (req: any, res) => {
    try {
      campaignEngine.stopCampaign(req.params.id);
      await storage.deleteCampaign(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete campaign' });
    }
  });

  // Campaign actions: send, pause, resume, stop, schedule
  app.post('/api/campaigns/:id/send', async (req: any, res) => {
    try {
      // Detect public URL from the incoming request for tracking links
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers['host'];
      if (host && !host.includes('localhost')) {
        campaignEngine.setPublicBaseUrl(`${proto}://${host}`);
      }

      const result = await campaignEngine.startCampaign({
        campaignId: req.params.id,
        delayBetweenEmails: req.body.delayBetweenEmails || 2000,
        batchSize: req.body.batchSize || 10,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to start campaign' });
    }
  });

  app.post('/api/campaigns/:id/pause', async (req: any, res) => {
    const success = campaignEngine.pauseCampaign(req.params.id);
    if (!success) {
      await storage.updateCampaign(req.params.id, { status: 'paused' });
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/resume', async (req: any, res) => {
    const success = campaignEngine.resumeCampaign(req.params.id);
    if (!success) {
      // Re-start the campaign
      const result = await campaignEngine.startCampaign({ campaignId: req.params.id });
      return res.json(result);
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/stop', async (req: any, res) => {
    campaignEngine.stopCampaign(req.params.id);
    await storage.updateCampaign(req.params.id, { status: 'paused' });
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/schedule', async (req: any, res) => {
    try {
      const { scheduledAt, delayBetweenEmails } = req.body;
      if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });
      
      campaignEngine.scheduleCampaign(req.params.id, new Date(scheduledAt), { delayBetweenEmails });
      res.json({ success: true, scheduledAt });
    } catch (error) {
      res.status(500).json({ message: 'Failed to schedule campaign' });
    }
  });

  app.get('/api/campaigns/:id/progress', async (req: any, res) => {
    const progress = campaignEngine.getCampaignProgress(req.params.id);
    if (!progress) {
      const campaign = await storage.getCampaign(req.params.id);
      return res.json({
        active: false,
        paused: campaign?.status === 'paused',
        progress: campaign?.sentCount || 0,
        total: campaign?.totalRecipients || 0,
        status: campaign?.status || 'draft',
      });
    }
    res.json(progress);
  });

  app.get('/api/campaigns/:id/messages', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 200;
      const offset = parseInt(req.query.offset) || 0;
      const enriched = req.query.enriched === 'true';
      
      if (enriched) {
        const messages = await storage.getCampaignMessagesEnriched(req.params.id, limit, offset);
        const total = await storage.getCampaignMessagesTotalCount(req.params.id);
        return res.json({ messages, total, limit, offset });
      }
      
      const messages = await storage.getCampaignMessages(req.params.id, limit, offset);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch messages' });
    }
  });

  // Campaign detail: full campaign info + analytics + enriched messages
  app.get('/api/campaigns/:id/detail', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

      const analytics = await storage.getCampaignAnalytics(req.params.id);
      const messages = await storage.getCampaignMessagesEnriched(req.params.id, 200, 0);
      const totalMessages = await storage.getCampaignMessagesTotalCount(req.params.id);
      const trackingEvents = await storage.getTrackingEvents(req.params.id);

      // Step-by-step breakdown analytics
      const stepNumbers = [...new Set(messages.map((m: any) => m.stepNumber || 0))].sort((a: number, b: number) => a - b);
      const stepAnalytics = stepNumbers.map((stepNum: number) => {
        const stepMsgs = messages.filter((m: any) => (m.stepNumber || 0) === stepNum);
        const sent = stepMsgs.filter((m: any) => m.status === 'sent' || m.status === 'sending').length;
        const opened = stepMsgs.filter((m: any) => m.openedAt || (m.openCount && m.openCount > 0)).length;
        const clicked = stepMsgs.filter((m: any) => m.clickedAt || (m.clickCount && m.clickCount > 0)).length;
        const replied = stepMsgs.filter((m: any) => m.repliedAt || (m.replyCount && m.replyCount > 0)).length;
        const bounced = stepMsgs.filter((m: any) => m.status === 'failed' || m.status === 'bounced').length;
        const unsub = 0; // tracked at campaign level
        return {
          stepNumber: stepNum,
          label: stepNum === 0 ? 'Step 1' : `Step ${stepNum + 1}`,
          description: stepNum === 0 ? 'Sent at campaign creation' : null, // Will be enhanced with followup info
          sent, opened, clicked, replied, bounced, unsubscribed: unsub,
          openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0',
          clickRate: sent > 0 ? ((clicked / sent) * 100).toFixed(1) : '0',
          replyRate: sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0',
        };
      });

      // Get follow-up sequences for this campaign
      let followupSequences: any[] = [];
      try {
        const campaignFollowups = await storage.getCampaignFollowups(req.params.id);
        for (const cf of campaignFollowups) {
          const seq = await storage.getFollowupSequence(cf.sequenceId);
          if (seq) {
            const steps = await storage.getFollowupSteps(seq.id);
            followupSequences.push({ ...seq, steps });
            // Enhance step analytics with follow-up info (Mailmeteor-style description)
            for (const step of steps) {
              const sa = stepAnalytics.find((s: any) => s.stepNumber === (step as any).stepNumber);
              if (sa) {
                const triggerLabels: Record<string, string> = {
                  no_reply: 'If no reply', no_open: 'If no open', no_click: 'If no click',
                  opened: 'If opened', clicked: 'If clicked', replied: 'If replied',
                  always: 'Always',
                };
                const trigger = triggerLabels[(step as any).trigger] || (step as any).trigger;
                const days = (step as any).delayDays || 0;
                const hours = (step as any).delayHours || 0;
                const delayParts = [];
                if (days > 0) delayParts.push(`${days} day${days > 1 ? 's' : ''}`);
                if (hours > 0) delayParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
                const delayStr = delayParts.length > 0 ? delayParts.join(' ') : 'immediate';
                sa.description = `${trigger} – ${delayStr}`;
              }
            }
          }
        }
      } catch (e) { /* ignore */ }

      // Get email account info
      let emailAccount: any = null;
      if (campaign.emailAccountId) {
        try {
          const acct = await storage.getEmailAccount(campaign.emailAccountId);
          if (acct) emailAccount = { id: acct.id, email: acct.email, displayName: acct.displayName, provider: acct.provider };
        } catch (e) { /* ignore */ }
      }

      // Build activity timeline from tracking events + campaign timestamps
      const activityTimeline: any[] = [];
      if (campaign.status === 'completed' || campaign.status === 'archived') {
        activityTimeline.push({ type: 'ended', label: 'Campaign has ended', timestamp: campaign.updatedAt, icon: 'check' });
      }
      if (campaign.status === 'paused') {
        activityTimeline.push({ type: 'paused', label: 'Campaign was paused', timestamp: campaign.updatedAt, icon: 'pause' });
      }
      if (campaign.updatedAt && campaign.updatedAt !== campaign.createdAt && campaign.status !== 'completed' && campaign.status !== 'archived' && campaign.status !== 'paused') {
        activityTimeline.push({ type: 'updated', label: 'Campaign was updated', timestamp: campaign.updatedAt, icon: 'edit' });
      }
      if (campaign.scheduledAt) {
        activityTimeline.push({ type: 'scheduled', label: 'Campaign was scheduled', timestamp: campaign.scheduledAt, icon: 'clock' });
      }
      activityTimeline.push({ type: 'created', label: 'Campaign started', timestamp: campaign.createdAt, icon: 'play' });

      res.json({
        campaign,
        analytics,
        messages,
        totalMessages,
        recentEvents: trackingEvents.slice(0, 50),
        stepAnalytics,
        followupSequences,
        emailAccount,
        activityTimeline,
        trackingBaseUrl: campaignEngine.getBaseUrl(),
      });
    } catch (error) {
      console.error('Campaign detail error:', error);
      res.status(500).json({ message: 'Failed to fetch campaign detail' });
    }
  });

  // Duplicate a campaign
  app.post('/api/campaigns/:id/duplicate', async (req: any, res) => {
    try {
      const original = await storage.getCampaign(req.params.id);
      if (!original) return res.status(404).json({ message: 'Campaign not found' });
      const dupe = await storage.createCampaign({
        organizationId: original.organizationId,
        name: `${original.name} (Copy)`,
        description: original.description,
        subject: original.subject,
        content: original.content,
        emailAccountId: original.emailAccountId,
        templateId: original.templateId,
        contactIds: original.contactIds,
        segmentId: original.segmentId,
        trackOpens: original.trackOpens,
        trackClicks: original.trackClicks,
        includeUnsubscribe: original.includeUnsubscribe,
      });
      res.json(dupe);
    } catch (error) {
      res.status(500).json({ message: 'Failed to duplicate campaign' });
    }
  });

  // Archive a campaign
  app.post('/api/campaigns/:id/archive', async (req: any, res) => {
    try {
      await storage.updateCampaign(req.params.id, { status: 'archived' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to archive campaign' });
    }
  });

  // Tracking events feed (all events for the organization)
  app.get('/api/tracking/events', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const events = await storage.getAllTrackingEvents(req.user.organizationId, limit);
      
      // Enrich events with contact and campaign info
      const enrichedEvents = await Promise.all(events.map(async (event: any) => {
        const contact = event.contactId ? await storage.getContact(event.contactId) : null;
        const campaign = event.campaignId ? await storage.getCampaign(event.campaignId) : null;
        return {
          ...event,
          contact: contact ? { email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
          campaignName: campaign?.name || 'Unknown Campaign',
        };
      }));
      
      res.json(enrichedEvents);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch tracking events' });
    }
  });

  // Reply tracking webhook
  app.post('/api/track/reply/:trackingId', async (req, res) => {
    try {
      const { trackingId } = req.params;
      const message = await storage.getCampaignMessageByTracking(trackingId);
      
      if (message) {
        if (!message.repliedAt) {
          await storage.updateCampaignMessage(message.id, { repliedAt: new Date().toISOString() });
          
          const campaign = await storage.getCampaign(message.campaignId);
          if (campaign) {
            await storage.updateCampaign(message.campaignId, {
              repliedCount: (campaign.repliedCount || 0) + 1,
            });
          }

          // Update contact status to 'replied'
          if (message.contactId) {
            try { await storage.updateContact(message.contactId, { status: 'replied' }); } catch (e) {}
          }
        }

        await storage.createTrackingEvent({
          type: 'reply',
          campaignId: message.campaignId,
          messageId: message.id,
          contactId: message.contactId,
          trackingId,
          metadata: req.body || {},
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Reply tracking error:', error);
      res.json({ success: false });
    }
  });

  // ========== GMAIL REPLY TRACKING ==========

  // Check for replies via Gmail API (manual trigger)
  app.post('/api/reply-tracking/check', requireAuth, async (req: any, res) => {
    try {
      const lookbackMinutes = parseInt(req.body.lookbackMinutes) || 120;
      const result = await gmailReplyTracker.checkForReplies(req.user.organizationId, lookbackMinutes);
      res.json(result);
    } catch (error) {
      console.error('Reply check error:', error);
      res.status(500).json({ message: 'Failed to check for replies' });
    }
  });

  // Get reply tracking status
  app.get('/api/reply-tracking/status', requireAuth, async (req: any, res) => {
    try {
      const status = gmailReplyTracker.getStatus();
      const settings = await storage.getApiSettings(req.user.organizationId);
      const hasGmailToken = !!(settings.gmail_access_token || settings.gmail_refresh_token);
      const gmailEmail = settings.gmail_user_email || null;

      res.json({
        ...status,
        configured: hasGmailToken,
        gmailEmail,
        hasRefreshToken: !!settings.gmail_refresh_token,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get tracking status' });
    }
  });

  // Start auto-polling for replies
  app.post('/api/reply-tracking/start', requireAuth, async (req: any, res) => {
    try {
      const intervalMinutes = parseInt(req.body.intervalMinutes) || 5;
      gmailReplyTracker.startAutoCheck(req.user.organizationId, intervalMinutes);
      res.json({ success: true, intervalMinutes });
    } catch (error) {
      res.status(500).json({ message: 'Failed to start reply tracking' });
    }
  });

  // Stop auto-polling for replies
  app.post('/api/reply-tracking/stop', requireAuth, async (req: any, res) => {
    try {
      gmailReplyTracker.stopAutoCheck();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to stop reply tracking' });
    }
  });

  // Get recent reply events (enriched)
  app.get('/api/reply-tracking/recent', requireAuth, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      // Get reply-type tracking events
      const allEvents = await storage.getAllTrackingEvents(req.user.organizationId, 200);
      const replyEvents = allEvents
        .filter((e: any) => e.type === 'reply')
        .slice(0, limit);
      
      // Enrich with contact and campaign info
      const enriched = await Promise.all(replyEvents.map(async (event: any) => {
        const contact = event.contactId ? await storage.getContact(event.contactId) : null;
        const campaign = event.campaignId ? await storage.getCampaign(event.campaignId) : null;
        const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
        return {
          ...event,
          metadata,
          contact: contact ? { email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company } : null,
          campaignName: campaign?.name || 'Unknown Campaign',
        };
      }));
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch reply events' });
    }
  });

  // Campaign preview (personalize & preview before sending)
  // Supports both single email preview and full sequence preview
  app.post('/api/campaigns/preview', async (req: any, res) => {
    try {
      const { subject, content, contactId, steps } = req.body;
      let contact = null;
      if (contactId) {
        contact = await storage.getContact(contactId);
      }
      if (!contact) {
        // Use first contact as preview
        const contacts = await storage.getContacts(req.user.organizationId, 1, 0);
        contact = contacts[0];
      }

      const data = {
        firstName: contact?.firstName || 'John',
        lastName: contact?.lastName || 'Doe',
        email: contact?.email || 'john@example.com',
        company: contact?.company || 'Example Corp',
        jobTitle: contact?.jobTitle || 'CEO',
        fullName: `${contact?.firstName || 'John'} ${contact?.lastName || 'Doe'}`,
      };

      // If steps array is provided, preview all steps (full sequence preview)
      if (steps && Array.isArray(steps) && steps.length > 0) {
        const previews = steps.map((step: any, index: number) => ({
          stepIndex: index,
          subject: campaignEngine.personalizeContent(step.subject || '', data),
          content: campaignEngine.personalizeContent(step.content || '', data),
          condition: step.condition || (index === 0 ? 'immediate' : 'if_no_reply'),
          delayValue: step.delayValue || 0,
          delayUnit: step.delayUnit || 'days',
        }));
        res.json({ previews, contact: data });
      } else {
        // Single email preview (backwards compatible)
        const personalizedSubject = campaignEngine.personalizeContent(subject || '', data);
        const personalizedContent = campaignEngine.personalizeContent(content || '', data);
        res.json({ subject: personalizedSubject, content: personalizedContent, contact: data });
      }
    } catch (error) {
      res.status(500).json({ message: 'Failed to preview' });
    }
  });

  // Send test email with campaign content
  app.post('/api/campaigns/send-test', async (req: any, res) => {
    try {
      const { emailAccountId, toEmail, subject, content, steps } = req.body;
      if (!emailAccountId) return res.status(400).json({ success: false, error: 'Email account is required' });
      if (!toEmail) return res.status(400).json({ success: false, error: 'Test email address is required' });

      const account = await storage.getEmailAccount(emailAccountId);
      if (!account) return res.status(404).json({ success: false, error: 'Email account not found' });
      if (!account.smtpConfig) return res.status(400).json({ success: false, error: 'SMTP not configured for this account' });

      // Get a sample contact for personalization
      let contact: any = null;
      const contacts = await storage.getContacts(req.user.organizationId, 1, 0);
      contact = contacts[0];
      const data = {
        firstName: contact?.firstName || 'John',
        lastName: contact?.lastName || 'Doe',
        email: contact?.email || toEmail,
        company: contact?.company || 'Example Corp',
        jobTitle: contact?.jobTitle || 'CEO',
        fullName: `${contact?.firstName || 'John'} ${contact?.lastName || 'Doe'}`,
      };

      // Build the test email - combine all steps into one email for preview
      const emailSteps = steps && Array.isArray(steps) && steps.length > 0 ? steps : [{ subject, content, condition: 'immediate', delayValue: 0, delayUnit: 'days' }];

      let combinedHtml = '';
      const conditionLabels: Record<string, string> = {
        immediate: 'Initial email - sent immediately',
        if_no_reply: 'If no reply', if_no_click: 'If no click', if_no_open: 'If no open',
        if_opened: 'If opened', if_clicked: 'If clicked', if_replied: 'If replied',
        no_matter_what: 'No matter what',
      };

      for (let i = 0; i < emailSteps.length; i++) {
        const step = emailSteps[i];
        const pSubject = campaignEngine.personalizeContent(step.subject || '(No subject)', data);
        const pContent = campaignEngine.personalizeContent(step.content || '', data);
        const condLabel = i === 0 ? 'Initial email - sent immediately' : `${conditionLabels[step.condition] || step.condition} after ${step.delayValue} ${step.delayUnit}`;

        combinedHtml += `
          <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: ${i === 0 ? '#2563eb' : '#6366f1'}; color: white; padding: 12px 20px; font-size: 13px;">
              <strong>Step ${i + 1}:</strong> ${condLabel}
            </div>
            <div style="padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <span style="color: #64748b; font-size: 12px;">Subject:</span>
              <strong style="color: #1e293b; font-size: 14px; margin-left: 8px;">${pSubject}</strong>
            </div>
            <div style="padding: 20px;">
              ${pContent || '<p style="color: #94a3b8; font-style: italic;">No content</p>'}
            </div>
          </div>
        `;
      }

      const fullHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 24px; border-radius: 12px; text-align: center; color: white; margin-bottom: 24px;">
            <h2 style="margin: 0 0 8px 0; font-size: 18px;">MailFlow - Campaign Test Email</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 13px;">This is a preview of your complete email sequence (${emailSteps.length} step${emailSteps.length > 1 ? 's' : ''})</p>
          </div>
          ${combinedHtml}
          <div style="text-align: center; padding: 16px; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; margin-top: 16px;">
            This is a test email sent from MailFlow. Variables have been replaced with sample data.
          </div>
        </div>
      `;

      const firstSubject = campaignEngine.personalizeContent(emailSteps[0].subject || 'Test Email', data);
      const result = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
        to: toEmail,
        subject: `[TEST] ${firstSubject}`,
        html: fullHtml,
      });

      res.json({ ...result, stepsIncluded: emailSteps.length });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Send test email error:', errMsg);
      res.status(500).json({ success: false, error: errMsg });
    }
  });

  // ========== CONTACTS ==========

  // ========== CONTACT LISTS ==========

  app.get('/api/contact-lists', async (req: any, res) => {
    try {
      const lists = await storage.getContactLists(req.user.organizationId);
      res.json(lists);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact lists' });
    }
  });

  app.get('/api/contact-lists/:id', async (req: any, res) => {
    try {
      const list = await storage.getContactList(req.params.id);
      if (!list) return res.status(404).json({ message: 'Not found' });
      res.json(list);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact list' });
    }
  });

  // Create a new (empty) contact list
  app.post('/api/contact-lists', async (req: any, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
      const list = await storage.createContactList({
        organizationId: req.user.organizationId,
        name: name.trim(),
        source: 'manual',
        headers: [],
        contactCount: 0,
      });
      res.status(201).json(list);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create contact list' });
    }
  });

  // Rename / update a contact list
  app.put('/api/contact-lists/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateContactList(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update contact list' });
    }
  });

  app.delete('/api/contact-lists/:id', async (req: any, res) => {
    try {
      await storage.deleteContactList(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete contact list' });
    }
  });

  // ========== CONTACTS ==========

  app.get('/api/contacts', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search as string;
      const status = req.query.status as string;
      const listId = req.query.listId as string;
      const filters = listId ? { listId } : undefined;
      
      let contacts;
      if (search) {
        contacts = await storage.searchContacts(req.user.organizationId, search, filters);
      } else {
        contacts = await storage.getContacts(req.user.organizationId, limit, offset, filters);
      }

      if (status && status !== 'all') {
        contacts = contacts.filter((c: any) => c.status === status);
      }

      const total = await storage.getContactsCount(req.user.organizationId, filters);
      res.json({ contacts, total, limit, offset });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contacts' });
    }
  });

  app.get('/api/contacts/:id', async (req: any, res) => {
    try {
      const contact = await storage.getContact(req.params.id);
      if (!contact) return res.status(404).json({ message: 'Not found' });
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact' });
    }
  });

  app.post('/api/contacts', async (req: any, res) => {
    try {
      const contact = await storage.createContact({
        ...req.body,
        organizationId: req.user.organizationId,
      });
      res.status(201).json(contact);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create contact' });
    }
  });

  // Bulk import contacts with list name and all column headers
  // Supports both creating a new list (listName) and adding to an existing list (existingListId)
  app.post('/api/contacts/import', async (req: any, res) => {
    try {
      const { contacts: contactList, listName, existingListId, headers, source } = req.body;
      if (!Array.isArray(contactList) || contactList.length === 0) {
        return res.status(400).json({ message: 'contacts array is required' });
      }

      // Determine which list to use: existing or create new
      let contactListRecord: any = null;
      let targetListId: string | null = null;

      if (existingListId) {
        // Add to an existing list
        contactListRecord = await storage.getContactList(existingListId);
        targetListId = existingListId;
      } else if (listName) {
        // Create a new contact list
        contactListRecord = await storage.createContactList({
          organizationId: req.user.organizationId,
          name: listName,
          source: source || 'csv',
          headers: headers || [],
          contactCount: 0, // Will update after import
        });
        targetListId = contactListRecord?.id || null;
      }

      const contactsToCreate = contactList.map((c: any) => {
        // Separate known fields from custom fields
        const { email, firstName, first_name, lastName, last_name, company, jobTitle, job_title, status, tags, source: cSource, ...extraFields } = c;
        return {
          organizationId: req.user.organizationId,
          email: email || '',
          firstName: firstName || first_name || '',
          lastName: lastName || last_name || '',
          company: company || '',
          jobTitle: jobTitle || job_title || '',
          status: status || 'cold',
          tags: tags || [],
          source: cSource || source || 'import',
          listId: targetListId,
          customFields: extraFields || {},
        };
      });

      const results = await storage.createContactsBulk(contactsToCreate, targetListId);
      const imported = results.filter((r: any) => !r._skipped).length;
      const skipped = results.filter((r: any) => r._skipped).length;

      // Update the contact list count
      if (contactListRecord && targetListId) {
        const existingCount = existingListId ? (contactListRecord.contactCount || 0) : 0;
        await storage.updateContactList(targetListId, { contactCount: existingCount + imported });
      }

      const listDisplayName = contactListRecord?.name || null;

      res.json({
        success: true,
        imported,
        skipped,
        total: contactList.length,
        listId: targetListId,
        listName: listDisplayName,
        message: `Imported ${imported} contacts${listDisplayName ? ` to list "${listDisplayName}"` : ''}, ${skipped} duplicates skipped`,
      });
    } catch (error) {
      console.error('Import error:', error);
      res.status(500).json({ message: 'Failed to import contacts' });
    }
  });

  app.put('/api/contacts/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateContact(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update contact' });
    }
  });

  app.delete('/api/contacts/:id', async (req: any, res) => {
    try {
      await storage.deleteContact(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete contact' });
    }
  });

  app.post('/api/contacts/delete-bulk', async (req: any, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids array required' });
      await storage.deleteContacts(ids);
      res.json({ success: true, deleted: ids.length });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete contacts' });
    }
  });

  // ========== CONTACT SEGMENTS ==========

  app.get('/api/segments', async (req: any, res) => {
    try {
      const segments = await storage.getContactSegments(req.user.organizationId);
      res.json(segments);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch segments' });
    }
  });

  app.post('/api/segments', async (req: any, res) => {
    try {
      const segment = await storage.createContactSegment({
        ...req.body,
        organizationId: req.user.organizationId,
      });
      res.status(201).json(segment);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create segment' });
    }
  });

  app.delete('/api/segments/:id', async (req: any, res) => {
    try {
      await storage.deleteContactSegment(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete segment' });
    }
  });

  // ========== TEMPLATES ==========

  app.get('/api/templates', async (req: any, res) => {
    try {
      const templates = await storage.getEmailTemplates(req.user.organizationId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch templates' });
    }
  });

  app.get('/api/templates/:id', async (req: any, res) => {
    try {
      const template = await storage.getEmailTemplate(req.params.id);
      if (!template) return res.status(404).json({ message: 'Not found' });
      res.json(template);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch template' });
    }
  });

  app.post('/api/templates', async (req: any, res) => {
    try {
      const template = await storage.createEmailTemplate({
        ...req.body,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create template' });
    }
  });

  app.put('/api/templates/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateEmailTemplate(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update template' });
    }
  });

  app.delete('/api/templates/:id', async (req: any, res) => {
    try {
      await storage.deleteEmailTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete template' });
    }
  });

  // ========== TRACKING ENDPOINTS (public, no auth) ==========

  // Open tracking pixel
  app.get('/api/track/open/:trackingId', async (req, res) => {
    try {
      const { trackingId } = req.params;
      const message = await storage.getCampaignMessageByTracking(trackingId);
      
      if (message) {
        // Always record tracking event (even repeat opens)
        await storage.createTrackingEvent({
          type: 'open',
          campaignId: message.campaignId,
          messageId: message.id,
          contactId: message.contactId,
          trackingId,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        });

        // Only increment campaign count on first open
        if (!message.openedAt) {
          await storage.updateCampaignMessage(message.id, { openedAt: new Date().toISOString() });
          
          const campaign = await storage.getCampaign(message.campaignId);
          if (campaign) {
            await storage.updateCampaign(message.campaignId, {
              openedCount: (campaign.openedCount || 0) + 1,
            });
          }
        }
      }
    } catch (error) {
      console.error('Tracking error:', error);
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(pixel);
  });

  // Click tracking
  app.get('/api/track/click/:trackingId', async (req, res) => {
    try {
      const { trackingId } = req.params;
      const { url } = req.query;
      
      const message = await storage.getCampaignMessageByTracking(trackingId);
      
      if (message) {
        if (!message.clickedAt) {
          await storage.updateCampaignMessage(message.id, { clickedAt: new Date().toISOString() });
          
          const campaign = await storage.getCampaign(message.campaignId);
          if (campaign) {
            await storage.updateCampaign(message.campaignId, {
              clickedCount: (campaign.clickedCount || 0) + 1,
            });
          }
        }

        await storage.createTrackingEvent({
          type: 'click',
          campaignId: message.campaignId,
          messageId: message.id,
          contactId: message.contactId,
          trackingId,
          url: decodeURIComponent(url as string || ''),
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        });
      }
    } catch (error) {
      console.error('Click tracking error:', error);
    }

    // Redirect to original URL
    const targetUrl = decodeURIComponent((req.query.url as string) || '/');
    res.redirect(302, targetUrl);
  });

  // Unsubscribe
  app.get('/api/track/unsubscribe/:trackingId', async (req, res) => {
    try {
      const { trackingId } = req.params;
      const message = await storage.getCampaignMessageByTracking(trackingId);
      
      if (message) {
        const contact = await storage.getContact(message.contactId);
        const campaign = await storage.getCampaign(message.campaignId);
        
        if (contact) {
          await storage.addUnsubscribe({
            organizationId: campaign?.organizationId,
            email: contact.email,
            contactId: contact.id,
            campaignId: message.campaignId,
            reason: 'user_requested',
          });

          // Tag the contact as unsubscribed so they're excluded from future campaigns
          try { await storage.updateContact(contact.id, { status: 'unsubscribed' }); } catch (e) {}
          
          if (campaign) {
            await storage.updateCampaign(message.campaignId, {
              unsubscribedCount: (campaign.unsubscribedCount || 0) + 1,
            });
          }
        }
      }
    } catch (error) {
      console.error('Unsubscribe error:', error);
    }

    res.send(`
      <html>
        <head><title>Unsubscribed</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>You have been unsubscribed</h2>
          <p>You will no longer receive emails from this sender.</p>
        </body>
      </html>
    `);
  });

  // ========== ANALYTICS ==========

  app.get('/api/analytics/overview', async (req: any, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const analytics = await storage.getOrganizationAnalytics(req.user.organizationId, days);
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch analytics' });
    }
  });

  app.get('/api/analytics/:campaignId', async (req: any, res) => {
    try {
      const analytics = await storage.getCampaignAnalytics(req.params.campaignId);
      if (!analytics) return res.status(404).json({ message: 'Campaign not found' });
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch analytics' });
    }
  });

  // ========== ACCOUNT ==========

  app.get('/api/account/info', async (req: any, res) => {
    const accounts = await storage.getEmailAccounts(req.user.organizationId);
    const totalQuota = accounts.reduce((sum: number, a: any) => sum + (a.dailyLimit || 500), 0) || 500;
    const sessionUser = (req.session as any)?.user;
    
    res.json({
      name: sessionUser?.name || req.user.name || 'MailFlow User',
      email: sessionUser?.email || req.user.email || 'user@mailflow.app',
      picture: sessionUser?.picture || '',
      provider: sessionUser?.provider || 'google',
      quota: { used: 0, total: totalQuota, resetsAt: 'Tomorrow at 12:00 AM' },
      billing: { plan: 'MailFlow Pro', isEducation: false, members: 'Invite teammates to join' },
      emailAccounts: accounts.length,
    });
  });

  app.get('/api/account/senders', async (req: any, res) => {
    const accounts = await storage.getEmailAccounts(req.user.organizationId);
    res.json(accounts.map((a: any) => ({
      id: a.id,
      name: a.displayName,
      email: a.email,
      provider: a.provider,
      status: a.isActive ? 'Active' : 'Inactive',
    })));
  });

  // ========== PERSONALIZATION ==========

  app.get("/api/personalization/variables", (req, res) => {
    res.json([
      { name: 'firstName', label: 'First Name', category: 'contact', example: 'John' },
      { name: 'lastName', label: 'Last Name', category: 'contact', example: 'Smith' },
      { name: 'email', label: 'Email', category: 'contact', example: 'john@example.com' },
      { name: 'company', label: 'Company', category: 'contact', example: 'Tech Corp' },
      { name: 'jobTitle', label: 'Job Title', category: 'contact', example: 'CTO' },
      { name: 'fullName', label: 'Full Name', category: 'contact', example: 'John Smith' },
      { name: 'senderName', label: 'Sender Name', category: 'sender', example: 'Your Name' },
      { name: 'senderEmail', label: 'Sender Email', category: 'sender', example: 'you@example.com' },
    ]);
  });

  app.post("/api/personalization/validate", (req, res) => {
    const { template } = req.body;
    const variables = (template || '').match(/\{\{(\w+)\}\}/g) || [];
    res.json({ valid: true, variables: variables.map((v: string) => v.replace(/[{}]/g, '')) });
  });

  // ========== FOLLOW-UP SEQUENCES ==========

  app.get('/api/followup-sequences', async (req: any, res) => {
    const sequences = await storage.getFollowupSequences(req.user.organizationId);
    // Include steps for each sequence
    const withSteps = await Promise.all(sequences.map(async (seq: any) => {
      const steps = await storage.getFollowupSteps(seq.id);
      return { ...seq, steps };
    }));
    res.json(withSteps);
  });

  app.post('/api/followup-sequences', async (req: any, res) => {
    try {
      const { campaignId, trigger, subject, content, delayValue, delayUnit, stepOrder, name } = req.body;

      // Convert delayValue + delayUnit to delayDays + delayHours
      let delayDays = 0;
      let delayHours = 0;
      const val = parseInt(delayValue) || 0;
      switch (delayUnit) {
        case 'minutes': delayHours = 0; delayDays = 0; break; // minutes stored as fractional hours
        case 'hours': delayHours = val; break;
        case 'days': delayDays = val; break;
        case 'weeks': delayDays = val * 7; break;
        default: delayDays = val; break;
      }
      // For minutes, convert to hours (round up to at least 1 hour for practical sending)
      if (delayUnit === 'minutes' && val > 0) {
        delayHours = Math.max(1, Math.ceil(val / 60));
      }

      // Map condition names from campaign creator to followup engine triggers
      const triggerMap: Record<string, string> = {
        'if_no_reply': 'no_reply',
        'if_no_click': 'no_click',
        'if_no_open': 'no_open',
        'if_opened': 'opened',
        'if_clicked': 'clicked',
        'if_replied': 'replied',
        'no_matter_what': 'time_delay',
      };
      const mappedTrigger = triggerMap[trigger] || trigger || 'no_reply';

      // Create or reuse a follow-up sequence for this campaign
      const seqName = name || `Campaign Follow-up ${stepOrder || 1}`;
      const sequence = await storage.createFollowupSequence({
        organizationId: req.user.organizationId,
        name: seqName,
        description: `Auto-created follow-up: ${mappedTrigger} after ${delayDays}d ${delayHours}h`,
        createdBy: req.user.id,
      });

      // Create the follow-up step
      const step = await storage.createFollowupStep({
        sequenceId: (sequence as any).id,
        stepNumber: stepOrder || 1,
        trigger: mappedTrigger,
        delayDays,
        delayHours,
        subject: subject || '',
        content: content || '',
      });

      // Link the campaign to this sequence
      if (campaignId) {
        await storage.createCampaignFollowup({
          campaignId,
          sequenceId: (sequence as any).id,
        });
        console.log(`[Followup] Created sequence "${seqName}" for campaign ${campaignId}: ${mappedTrigger} after ${delayDays}d ${delayHours}h`);
      }

      res.status(201).json({
        ...(sequence as any),
        step,
        campaignId,
        trigger: mappedTrigger,
        delayDays,
        delayHours,
      });
    } catch (error) {
      console.error('[Followup] Error creating sequence:', error);
      res.status(500).json({ message: 'Failed to create follow-up sequence' });
    }
  });

  app.put('/api/followup-sequences/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateFollowupSequence(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update sequence' });
    }
  });

  app.delete('/api/followup-sequences/:id', async (req: any, res) => {
    try {
      await storage.deleteFollowupSequence(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete sequence' });
    }
  });

  // Follow-up steps
  app.get('/api/followup-sequences/:seqId/steps', async (req: any, res) => {
    const steps = await storage.getFollowupSteps(req.params.seqId);
    res.json(steps);
  });

  app.post('/api/followup-sequences/:seqId/steps', async (req: any, res) => {
    const step = await storage.createFollowupStep({
      ...req.body,
      sequenceId: req.params.seqId,
    });
    res.status(201).json(step);
  });

  app.put('/api/followup-steps/:id', async (req: any, res) => {
    try {
      const updated = await storage.updateFollowupStep(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update step' });
    }
  });

  app.delete('/api/followup-steps/:id', async (req: any, res) => {
    try {
      await storage.deleteFollowupStep(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete step' });
    }
  });

  // ========== INTEGRATIONS ==========

  app.get('/api/integrations', async (req: any, res) => {
    const integrations = await storage.getIntegrations(req.user.organizationId);
    res.json(integrations);
  });

  // ========== API SETTINGS ==========

  app.get('/api/settings', async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      // Mask sensitive values
      const masked: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (key.includes('api_key') || key.includes('apiKey') || key.includes('password')) {
          masked[key] = value ? '••••••••' + value.slice(-4) : '';
        } else {
          masked[key] = value;
        }
      }
      res.json(masked);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  // Return raw (unmasked) settings for internal use
  app.get('/api/settings/raw', async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  app.put('/api/settings', async (req: any, res) => {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ message: 'Settings object required' });
      }
      // Don't save masked values
      const toSave: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value === 'string' && !value.startsWith('••••')) {
          toSave[key] = value;
        }
      }
      await storage.setApiSettings(req.user.organizationId, toSave);
      res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save settings' });
    }
  });

  // Get/set tracking base URL
  app.get('/api/settings/tracking-url', async (req: any, res) => {
    try {
      const currentUrl = campaignEngine.getBaseUrl();
      const settings = await storage.getApiSettings(req.user.organizationId);
      res.json({
        trackingBaseUrl: currentUrl,
        configured: !!settings.tracking_base_url,
        configuredUrl: settings.tracking_base_url || null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch tracking URL' });
    }
  });

  app.put('/api/settings/tracking-url', async (req: any, res) => {
    try {
      const { trackingBaseUrl } = req.body;
      if (trackingBaseUrl) {
        campaignEngine.setPublicBaseUrl(trackingBaseUrl);
        await storage.setApiSettings(req.user.organizationId, { tracking_base_url: trackingBaseUrl });
        res.json({ success: true, trackingBaseUrl: campaignEngine.getBaseUrl() });
      } else {
        // Clear manual config - will auto-detect from requests
        await storage.setApiSettings(req.user.organizationId, { tracking_base_url: '' });
        res.json({ success: true, trackingBaseUrl: campaignEngine.getBaseUrl() });
      }
    } catch (error) {
      res.status(500).json({ message: 'Failed to update tracking URL' });
    }
  });

  app.post('/api/settings/test-azure-openai', async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.status(400).json({ success: false, error: 'Azure OpenAI endpoint, API key, and deployment name are required' });
      }

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Reply with: Connection successful' }],
          max_tokens: 20,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return res.json({ success: false, error: `Azure OpenAI returned ${response.status}: ${errorBody.slice(0, 200)}` });
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content || '';
      res.json({ success: true, message: `Connection successful. Model replied: "${content.slice(0, 100)}"`, model: data?.model });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      res.json({ success: false, error: `Connection test failed: ${errMsg}` });
    }
  });

  app.post('/api/settings/test-elastic-email', async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const apiKey = settings.elastic_email_api_key;

      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'Elastic Email API key is required' });
      }

      // Test the API key by fetching account info
      const response = await fetch('https://api.elasticemail.com/v4/account', {
        headers: { 'X-ElasticEmail-ApiKey': apiKey },
      });

      if (!response.ok) {
        return res.json({ success: false, error: `Elastic Email API returned ${response.status}: Invalid API key or permissions` });
      }

      const data = await response.json() as any;
      res.json({ 
        success: true, 
        message: `Connected to Elastic Email account: ${data?.email || 'unknown'}`,
        email: data?.email,
        plan: data?.marketingPlan?.typeName || data?.statusFormatted || 'Active',
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      res.json({ success: false, error: `Connection test failed: ${errMsg}` });
    }
  });

  // ========== LLM ==========

  app.post('/api/llm/generate', async (req: any, res) => {
    try {
      const { prompt, type, context } = req.body;

      // Try to use Azure OpenAI if configured
      const settings = await storage.getApiSettings(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (endpoint && apiKey && deploymentName) {
        // Use Azure OpenAI
        const systemPrompts: Record<string, string> = {
          template: 'You are an expert email marketing copywriter. Generate professional email templates with personalization variables like {{firstName}}, {{company}}, {{jobTitle}}. Return only the email HTML content.',
          campaign: 'You are an expert email campaign strategist. Generate compelling campaign email content that drives engagement. Use personalization variables like {{firstName}}, {{company}}. Return only the email HTML content.',
          personalize: 'You are an AI email personalization expert. Take the provided template and personalize it for the specific recipient. Make it feel custom-written while maintaining the core message. Return only the personalized email content.',
          subject: 'You are an email subject line expert. Generate 3-5 compelling subject line options. Return them as a numbered list.',
          reply: 'You are a professional email assistant. Generate an appropriate, contextual reply to the provided email. Return only the reply content.',
          default: 'You are an expert email marketing copywriter. Generate personalized, professional email content that drives engagement and responses.',
        };

        const systemPrompt = systemPrompts[type || 'default'] || systemPrompts.default;

        const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `${prompt || ''}\n\n${context ? 'Context: ' + JSON.stringify(context) : ''}` },
            ],
            max_tokens: 1500,
            temperature: 0.7,
          }),
        });

        if (response.ok) {
          const data = await response.json() as any;
          const content = data?.choices?.[0]?.message?.content || '';
          return res.json({
            content,
            model: data?.model || deploymentName,
            tokens: data?.usage?.total_tokens || 0,
            provider: 'azure-openai',
          });
        }
        
        // If Azure fails, fall through to demo
        console.error('Azure OpenAI generation failed:', response.status, await response.text());
      }

      // Fallback: demo response
      res.json({
        content: `Here's a professionally crafted email based on your request:\n\nSubject: Quick Follow-up\n\nHi {{firstName}},\n\nI hope this message finds you well. I wanted to reach out regarding ${prompt || 'our recent discussion'}.\n\nI'd love to schedule a quick call to discuss further. Would you have 15 minutes this week?\n\nBest regards,\nThe MailFlow Team`,
        model: 'demo',
        tokens: 150,
        provider: 'demo',
        note: 'Configure Azure OpenAI in Advanced Settings for real AI-powered generation.',
      });
    } catch (error) {
      console.error('LLM generation error:', error);
      res.status(500).json({ message: 'Failed to generate content' });
    }
  });

  app.get('/api/llm-configs', async (req: any, res) => {
    const configs = await storage.getLlmConfigurations(req.user.organizationId);
    res.json(configs);
  });

  // AI-powered personalization preview
  app.post('/api/llm/personalize-preview', async (req: any, res) => {
    try {
      const { subject, content, contact } = req.body;
      if (!subject || !content) {
        return res.status(400).json({ message: 'Subject and content are required' });
      }

      const settings = await storage.getApiSettings(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.json({
          subject,
          content,
          provider: 'none',
          note: 'Configure Azure OpenAI in Advanced Settings for AI-powered personalization.',
        });
      }

      const contactInfo = contact || { firstName: 'John', lastName: 'Doe', company: 'Acme Corp', jobTitle: 'Manager' };
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an AI email personalization expert. Refine the given email to feel more personal and relevant to the recipient while preserving the core message and tone. Return ONLY the refined email content.' },
            { role: 'user', content: `Personalize for ${contactInfo.firstName} ${contactInfo.lastName} (${contactInfo.jobTitle} at ${contactInfo.company}):\n\nSubject: ${subject}\n\nContent:\n${content}` },
          ],
          max_tokens: 1500,
          temperature: 0.6,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        return res.json({
          subject,
          content: data?.choices?.[0]?.message?.content || content,
          model: data?.model || deploymentName,
          provider: 'azure-openai',
        });
      }

      res.json({ subject, content, provider: 'error', note: 'Azure OpenAI request failed.' });
    } catch (error) {
      console.error('Personalization preview error:', error);
      res.status(500).json({ message: 'Personalization preview failed' });
    }
  });

  // ========== GOOGLE SHEETS INTEGRATION ==========

  // Helper: extract spreadsheet ID from URL
  function extractSpreadsheetId(urlOrId: string): string | null {
    // Direct ID
    if (/^[a-zA-Z0-9_-]{20,}$/.test(urlOrId)) return urlOrId;
    // Full URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/...
    const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Helper: parse CSV text into rows
  function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let current = '';
    let inQuotes = false;
    let row: string[] = [];
    
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current.trim());
          current = '';
        } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
          row.push(current.trim());
          current = '';
          if (row.some(c => c !== '')) rows.push(row);
          row = [];
          if (ch === '\r') i++;
        } else {
          current += ch;
        }
      }
    }
    // Last row
    row.push(current.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  // Fetch spreadsheet info (sheet names) using the Google Sheets CSV export
  // NOTE: Wrapped with .then().catch() for Express 4 async safety
  app.post('/api/sheets/fetch-info', (req: any, res, next) => {
    (async () => {
      const body = req.body || {};
      const url = body.url;
      console.log('[sheets/fetch-info] Request body:', JSON.stringify(body));
      
      if (!url) {
        return res.status(400).json({ valid: false, error: 'URL is required' });
      }

      const spreadsheetId = extractSpreadsheetId(url);
      if (!spreadsheetId) {
        return res.status(400).json({ valid: false, error: 'Invalid Google Sheets URL. Please paste a valid Google Sheets URL.' });
      }

      console.log('[sheets/fetch-info] Extracted spreadsheet ID:', spreadsheetId);

      // Strategy: Try to export the default sheet as CSV to verify access
      // Then try to discover other sheets via gid probing
      const sheets: { id: number; name: string; index: number }[] = [];

      // First, try to export gid=0 (default sheet) to verify the spreadsheet is accessible
      const testCsvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      console.log('[sheets/fetch-info] Testing CSV access:', testCsvUrl);
      
      const testRes = await fetch(testCsvUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        redirect: 'follow',
      });

      console.log('[sheets/fetch-info] CSV test response status:', testRes.status);

      if (!testRes.ok) {
        return res.status(400).json({ 
          valid: false, 
          error: 'Cannot access this spreadsheet. Make sure it is shared with "Anyone with the link" can view.' 
        });
      }

      const testCsv = await testRes.text();
      
      // Check if we got an HTML error page instead of CSV
      if (testCsv.trim().startsWith('<!DOCTYPE') || testCsv.trim().startsWith('<html')) {
        return res.status(400).json({ 
          valid: false, 
          error: 'Cannot access this spreadsheet. Please make sure it is shared publicly with "Anyone with the link".' 
        });
      }

      // Default sheet is accessible
      sheets.push({ id: 0, name: 'Sheet1', index: 0 });

      // Try to discover additional sheets by probing common gids
      // Google Sheets assigns gid values, the first sheet is usually 0
      // We'll try a few common additional sheet gids
      const probGids = [1, 2, 3];
      for (const gid of probGids) {
        try {
          const probeUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
          const probeRes = await fetch(probeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
          });
          if (probeRes.ok) {
            const probeText = await probeRes.text();
            if (!probeText.trim().startsWith('<!DOCTYPE') && !probeText.trim().startsWith('<html') && probeText.trim().length > 0) {
              sheets.push({ id: gid, name: `Sheet${sheets.length + 1}`, index: sheets.length });
            }
          }
        } catch { /* ignore probe failures */ }
      }

      // Try to get real sheet names from the HTML page (best effort)
      try {
        const htmlUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=sharing`;
        const htmlRes = await fetch(htmlUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          redirect: 'follow',
        });
        
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          
          // Try multiple regex patterns to extract sheet names
          const extractedSheets: { id: number; name: string }[] = [];
          
          // Pattern 1: sheet tab buttons  
          const tabRegex1 = /class="[^"]*docs-sheet-tab[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/gi;
          let m;
          while ((m = tabRegex1.exec(html)) !== null) {
            const name = m[1].trim();
            if (name && name.length < 100) extractedSheets.push({ id: extractedSheets.length, name });
          }
          
          // Pattern 2: sheet button text
          if (extractedSheets.length === 0) {
            const tabRegex2 = /sheet-button[^>]*>(?:<[^>]*>)*\s*([^<]+)/gi;
            while ((m = tabRegex2.exec(html)) !== null) {
              const name = m[1].trim();
              if (name && name.length < 100) extractedSheets.push({ id: extractedSheets.length, name });
            }
          }

          // If we found real names, update the sheets array
          if (extractedSheets.length > 0) {
            sheets.length = 0; // Clear
            extractedSheets.forEach((s, i) => {
              sheets.push({ id: i, name: s.name, index: i });
            });
          }
        }
      } catch (htmlErr) {
        console.log('[sheets/fetch-info] HTML extraction failed (non-critical):', htmlErr);
        // Keep the sheets we already have from CSV probing
      }

      console.log('[sheets/fetch-info] Found sheets:', JSON.stringify(sheets));
      
      return res.json({
        id: spreadsheetId,
        title: 'Google Spreadsheet',
        sheets,
        valid: true,
      });
    })().catch((error) => {
      console.error('[sheets/fetch-info] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ valid: false, error: 'Failed to fetch spreadsheet information. Please check the URL and sharing settings.' });
      }
    });
  });

  // Fetch sheet data (actual rows) using CSV export
  app.post('/api/sheets/fetch-data', (req: any, res, next) => {
    (async () => {
      const body = req.body || {};
      const { url, sheetName, gid } = body;
      console.log('[sheets/fetch-data] Request body:', JSON.stringify(body));

      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      const spreadsheetId = extractSpreadsheetId(url);
      if (!spreadsheetId) {
        return res.status(400).json({ error: 'Invalid Google Sheets URL' });
      }

      // Export as CSV using gid
      const sheetGid = gid !== undefined ? gid : 0;
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheetGid}`;
      console.log('[sheets/fetch-data] Fetching CSV:', csvUrl);
      
      const csvRes = await fetch(csvUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        redirect: 'follow',
      });

      if (!csvRes.ok) {
        return res.status(400).json({ error: 'Cannot export sheet data. Make sure the spreadsheet is shared publicly.' });
      }

      const csvText = await csvRes.text();
      
      // Check if we got an HTML error page instead of CSV
      if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
        return res.status(400).json({ error: 'Cannot access this spreadsheet. Please check sharing settings.' });
      }

      const rows = parseCSV(csvText);

      if (rows.length === 0) {
        return res.json({ headers: [], values: [], contacts: [], totalRows: 0, validContacts: 0 });
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      // Auto-detect column mapping
      const emailCol = headers.findIndex(h => /email|e-mail|mail/i.test(h));
      const firstNameCol = headers.findIndex(h => /first.?name|given.?name|first/i.test(h));
      const lastNameCol = headers.findIndex(h => /last.?name|surname|family.?name|last/i.test(h));
      const companyCol = headers.findIndex(h => /company|organization|org|business/i.test(h));
      const nameCol = headers.findIndex(h => /^name$/i.test(h));

      // Build contacts from data - include ALL column headers as fields
      const mappedColIndices = new Set([emailCol, firstNameCol, lastNameCol, companyCol, nameCol].filter(i => i >= 0));
      const contacts = dataRows
        .filter(row => {
          const email = emailCol >= 0 ? row[emailCol] : '';
          return email && email.includes('@');
        })
        .map((row) => {
          let firstName = firstNameCol >= 0 ? (row[firstNameCol] || '') : '';
          let lastName = lastNameCol >= 0 ? (row[lastNameCol] || '') : '';
          
          // If no first/last name columns but there's a "name" column, split it
          if (!firstName && !lastName && nameCol >= 0 && row[nameCol]) {
            const parts = row[nameCol].trim().split(/\s+/);
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
          }

          // Build contact with all columns preserved
          const contact: Record<string, any> = {
            email: emailCol >= 0 ? (row[emailCol] || '').trim() : '',
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            company: companyCol >= 0 ? (row[companyCol] || '').trim() : '',
          };

          // Add all unmapped columns as extra fields (preserved for import)
          headers.forEach((header, idx) => {
            if (!mappedColIndices.has(idx) && row[idx]) {
              contact[header] = row[idx].trim();
            }
          });

          return contact;
        });

      console.log('[sheets/fetch-data] Found', contacts.length, 'contacts from', dataRows.length, 'rows with', headers.length, 'columns');

      return res.json({
        headers,
        values: rows,
        contacts,
        totalRows: dataRows.length,
        validContacts: contacts.length,
        allHeaders: headers,
        columnMapping: {
          email: emailCol >= 0 ? headers[emailCol] : null,
          firstName: firstNameCol >= 0 ? headers[firstNameCol] : (nameCol >= 0 ? headers[nameCol] : null),
          lastName: lastNameCol >= 0 ? headers[lastNameCol] : null,
          company: companyCol >= 0 ? headers[companyCol] : null,
        },
      });
    })().catch((error) => {
      console.error('[sheets/fetch-data] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to fetch sheet data' });
      }
    });
  });

  // Keep old mock endpoints for backward compatibility
  app.get('/api/sheets/info/:spreadsheetId', (req, res) => {
    res.json({
      id: req.params.spreadsheetId,
      title: 'Customer Email List',
      sheets: [{ id: 0, name: 'Contacts', index: 0 }, { id: 1, name: 'Leads', index: 1 }]
    });
  });

  app.post('/api/sheets/preview', (req, res) => {
    const { sheetName } = req.body;
    res.json({
      range: `${sheetName}!A1:D10`,
      values: [
        ['Name', 'Email', 'Company', 'Status'],
        ['John Smith', 'john@example.com', 'Tech Corp', 'Active'],
        ['Jane Doe', 'jane@company.com', 'Business Inc', 'Active'],
        ['Mike Johnson', 'mike@startup.io', 'Startup LLC', 'Pending'],
      ],
      headers: ['Name', 'Email', 'Company', 'Status']
    });
  });

  // ========== SMTP PRESETS ==========
  app.get('/api/smtp-presets', (req, res) => {
    res.json(Object.entries(SMTP_PRESETS).map(([key, config]) => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      host: config.host,
      port: config.port,
      secure: config.secure,
    })));
  });

  // Start Gmail reply tracking auto-check if tokens are available
  try {
    const orgSettings = await storage.getApiSettings('550e8400-e29b-41d4-a716-446655440001');
    if (orgSettings.gmail_access_token || orgSettings.gmail_refresh_token) {
      console.log('[ReplyTracker] Gmail tokens found, starting auto-check...');
      gmailReplyTracker.startAutoCheck('550e8400-e29b-41d4-a716-446655440001', 5);
    }
  } catch (e) {
    console.error('[ReplyTracker] Failed to start auto-check on startup:', e);
  }

  const httpServer = createServer(app);
  return httpServer;
}
