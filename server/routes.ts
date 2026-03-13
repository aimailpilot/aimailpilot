import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import cookieParser from "cookie-parser";
import MemoryStore from "memorystore";
import { smtpEmailService, SMTP_PRESETS, type SmtpConfig, getProviderDailyLimit } from "./services/smtp-email-service";
import { campaignEngine } from "./services/campaign-engine";
import { gmailReplyTracker } from "./services/gmail-reply-tracker";
import { outlookReplyTracker } from "./services/outlook-reply-tracker";
import { calculateContactRating, batchRecalculateRatings } from "./services/email-rating-engine";
import { OAuth2Client } from 'google-auth-library';


// In-memory user store for simplified authentication
const loggedInUsers = new Set<string>();

// Helper to create raw email for Gmail API send
function createRawEmail(opts: { from: string; to: string; subject: string; body: string; inReplyTo?: string; threadId?: string }): string {
  const boundary = `boundary_${Date.now()}`;
  let raw = '';
  raw += `From: ${opts.from}\r\n`;
  raw += `To: ${opts.to}\r\n`;
  raw += `Subject: ${opts.subject}\r\n`;
  raw += `MIME-Version: 1.0\r\n`;
  raw += `Content-Type: text/html; charset="UTF-8"\r\n`;
  if (opts.inReplyTo) raw += `In-Reply-To: ${opts.inReplyTo}\r\n`;
  raw += `\r\n`;
  raw += opts.body;
  // Base64url encode
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ========== Google OAuth 2.0 Helper ==========
// Credentials can come from environment variables or api_settings (database)
// Priority: env vars > api_settings
const PRODUCTION_DOMAIN = 'aimailpilot.com';

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
const requireAuth = async (req: any, res: any, next: any) => {
  const userId = req.cookies?.user_id || req.session?.userId;
  
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // If userId exists but not in loggedInUsers (e.g. server restarted),
  // verify against the database and auto-re-authenticate
  if (!loggedInUsers.has(userId)) {
    try {
      const dbUser = await storage.getUser(userId) as any;
      if (dbUser && dbUser.isActive !== false) {
        // User exists in DB - re-add to loggedInUsers
        loggedInUsers.add(userId);
        // Restore session data from DB if not already in session
        if (!(req.session as any)?.user) {
          (req.session as any).userId = userId;
          (req.session as any).user = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name || dbUser.email,
            provider: dbUser.provider || 'google',
          };
        }
        console.log(`[Auth] Auto-restored session for user ${dbUser.email} (${userId}) from DB after server restart`);
      } else {
        // User not found in DB - invalid cookie
        return res.status(401).json({ error: 'Not authenticated' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
  }
  
  // Get user data from session
  const sessionUser = (req.session as any)?.user;
  
  // Determine the active organization for this user
  // Priority: 1) query param ?orgId, 2) session orgId, 3) user's default org from DB
  let orgId = req.query?.orgId || (req.session as any)?.activeOrgId;
  let orgRole = 'admin';
  
  if (!orgId) {
    // Look up user's default organization from database
    try {
      const defaultOrg = await storage.getUserDefaultOrganization(userId);
      if (defaultOrg) {
        orgId = defaultOrg.id;
        orgRole = defaultOrg.memberRole || 'admin';
        // Cache in session for future requests
        (req.session as any).activeOrgId = orgId;
      }
    } catch (e) {
      // Fallback: try user's organizationId from DB
      try {
        const dbUser = await storage.getUser(userId);
        if (dbUser) orgId = (dbUser as any).organizationId;
      } catch (e2) { /* ignore */ }
    }
  } else {
    // Verify user has access to the requested org
    try {
      const membership = await storage.getOrgMember(orgId, userId);
      if (membership) {
        orgRole = (membership as any).role;
      } else {
        // User doesn't have access to this org
        return res.status(403).json({ error: 'Access denied to this organization' });
      }
    } catch (e) { /* fallback */ }
  }
  
  if (!orgId) {
    return res.status(400).json({ error: 'No organization found. Please create or join an organization.' });
  }
  
  req.user = { 
    id: userId, 
    organizationId: orgId, 
    role: orgRole,
    email: sessionUser?.email || 'unknown',
    name: sessionUser?.name || 'Unknown',
    isSuperAdmin: false,
  };
  // Check superadmin status
  try {
    req.user.isSuperAdmin = await storage.isSuperAdmin(userId);
  } catch (e) { /* ignore */ }
  // Auto-detect public URL for tracking links
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  if (host && !host.includes('localhost')) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    campaignEngine.setPublicBaseUrl(`${proto}://${host}`);
  }
  next();
};

// SuperAdmin middleware - must be used AFTER requireAuth
const requireSuperAdmin = async (req: any, res: any, next: any) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  app.set('trust proxy', 1);
  app.use(cookieParser());

  // Load persisted tracking base URL from settings on startup
  try {
    const orgIds = await storage.getAllOrganizationIds();
    for (const orgId of orgIds) {
      const orgSettings = await storage.getApiSettings(orgId);
      if (orgSettings.tracking_base_url) {
        campaignEngine.setPublicBaseUrl(orgSettings.tracking_base_url);
        console.log('[Tracking] Loaded base URL from settings:', orgSettings.tracking_base_url);
        break; // Use first found
      }
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

  // Helper: Get OAuth credentials from any org (for pre-auth flows)
  // Searches all orgs for stored OAuth config, falls back to env vars
  async function getStoredOAuthCredentials(provider: 'google' | 'microsoft') {
    let clientId = '';
    let clientSecret = '';
    
    try {
      const orgIds = await storage.getAllOrganizationIds();
      for (const orgId of orgIds) {
        const settings = await storage.getApiSettings(orgId);
        if (provider === 'google') {
          if (settings.google_oauth_client_id) { clientId = settings.google_oauth_client_id; clientSecret = settings.google_oauth_client_secret || ''; break; }
        } else {
          if (settings.microsoft_oauth_client_id) { clientId = settings.microsoft_oauth_client_id; clientSecret = settings.microsoft_oauth_client_secret || ''; break; }
        }
      }
    } catch (e) { /* ignore */ }
    
    if (provider === 'google') {
      return { clientId: clientId || process.env.GOOGLE_CLIENT_ID || '', clientSecret: clientSecret || process.env.GOOGLE_CLIENT_SECRET || '' };
    }
    return { clientId: clientId || process.env.MICROSOFT_CLIENT_ID || '', clientSecret: clientSecret || process.env.MICROSOFT_CLIENT_SECRET || '' };
  }

  // Helper: Ensure user has an org (create one if needed, or accept pending invitations)
  async function ensureUserOrganization(userId: string, email: string, name: string): Promise<string> {
    // Check if user already has an org
    const defaultOrg = await storage.getUserDefaultOrganization(userId);
    if (defaultOrg) return defaultOrg.id;
    
    // Check for pending invitations
    const pendingInvites = await storage.getPendingInvitationsForEmail(email);
    if (pendingInvites.length > 0) {
      // Auto-accept the first invitation
      const invite = pendingInvites[0] as any;
      await storage.acceptInvitation(invite.token, userId);
      return invite.organizationId;
    }
    
    // Check for existing org with no members (created during initial setup)
    try {
      const allOrgIds = await storage.getAllOrganizationIds();
      for (const orgId of allOrgIds) {
        const memberCount = await storage.getOrgMemberCount(orgId);
        if (memberCount === 0) {
          // Adopt this ownerless org (likely created during setup)
          await storage.addOrgMember(orgId, userId, 'owner');
          await storage.setDefaultOrganization(userId, orgId);
          await storage.updateUser(userId, { organizationId: orgId });
          console.log('[Auth] User adopted ownerless org:', orgId);
          return orgId;
        }
      }
    } catch (e) {
      console.error('[Auth] Error checking for ownerless orgs:', e);
    }
    
    // No org and no invitations - create a personal org
    const orgName = name ? `${name}'s Organization` : `${email.split('@')[0]}'s Organization`;
    const org = await storage.createOrganizationWithOwner({ name: orgName, domain: email.split('@')[1] || '' }, userId);
    // Set as default
    await storage.setDefaultOrganization(userId, (org as any).id);
    return (org as any).id;
  }

  const MemStore = MemoryStore(session);
  
  // Detect if running in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  app.use(session({
    store: new MemStore({ checkPeriod: 86400000 }),
    secret: process.env.SESSION_SECRET || 'aimailpilot-dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: isProduction,  // Use secure cookies in production (HTTPS)
      httpOnly: true, 
      maxAge: 24 * 60 * 60 * 1000, 
      sameSite: 'lax',
      // In production, set domain for aimailpilot.com
      ...(isProduction && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    },
    name: 'connect.sid'
  }));

  // ========== AUTH ROUTES ==========
  
  // Simple login - ONLY available in development
  if (!isProduction) {
    app.post('/api/auth/simple-login', (req, res) => {
      const userId = 'user-123';
      const mockUser = { id: userId, email: 'demo@aimailpilot.com', name: 'Demo User', picture: '', provider: 'google', access_token: 'demo-token' };
      loggedInUsers.add(userId);
      res.cookie('user_id', userId, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
      res.cookie('user_data', JSON.stringify(mockUser), { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false, secure: false, sameSite: 'lax' });
      (req.session as any).userId = userId;
      (req.session as any).user = mockUser;
      res.json({ success: true, user: mockUser });
    });
  }

  // ========== INITIAL SETUP (no auth required) ==========
  // Check if initial setup is needed (no OAuth configured AND no users exist)
  app.get('/api/setup/status', async (_req, res) => {
    try {
      const { clientId: googleId } = await getStoredOAuthCredentials('google');
      const { clientId: msId } = await getStoredOAuthCredentials('microsoft');
      const hasOAuth = !!(googleId || msId);
      const stats = await storage.getPlatformStats();
      const hasUsers = stats.totalUsers > 0;
      const hasSuperAdmin = stats.superAdmins > 0;
      res.json({
        needsSetup: !hasOAuth,
        hasUsers,
        hasSuperAdmin,
        googleConfigured: !!googleId,
        microsoftConfigured: !!msId,
      });
    } catch (error) {
      res.json({ needsSetup: true, hasUsers: false, hasSuperAdmin: false, googleConfigured: false, microsoftConfigured: false });
    }
  });

  // Initial setup: Save OAuth credentials (only when no OAuth is configured yet)
  app.post('/api/setup/oauth', async (req, res) => {
    try {
      // Check if OAuth is already configured - if so, block this endpoint
      const { clientId: existingGoogle } = await getStoredOAuthCredentials('google');
      const { clientId: existingMs } = await getStoredOAuthCredentials('microsoft');
      if (existingGoogle || existingMs) {
        return res.status(403).json({ error: 'OAuth is already configured. Use the admin settings page to modify.' });
      }

      const { provider, clientId, clientSecret } = req.body;
      if (!provider || !clientId || !clientSecret) {
        return res.status(400).json({ error: 'provider, clientId, and clientSecret are required' });
      }
      if (!['google', 'microsoft'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider. Use "google" or "microsoft".' });
      }

      // Store in a default org or first available org
      let targetOrgId = '';
      const orgIds = await storage.getAllOrganizationIds();
      if (orgIds.length > 0) {
        targetOrgId = orgIds[0];
      } else {
        // Create a system org for initial setup (no owner yet - first user to login will claim it)
        const org = await storage.createOrganization(
          { name: 'AImailPilot', domain: 'aimailpilot.com' }
        );
        targetOrgId = org.id;
      }

      if (provider === 'google') {
        await storage.setApiSettings(targetOrgId, {
          google_oauth_client_id: clientId,
          google_oauth_client_secret: clientSecret,
        });
      } else {
        await storage.setApiSettings(targetOrgId, {
          microsoft_oauth_client_id: clientId,
          microsoft_oauth_client_secret: clientSecret,
        });
      }

      console.log(`[Setup] ${provider} OAuth credentials saved to org ${targetOrgId}`);
      res.json({ success: true, message: `${provider} OAuth configured successfully` });
    } catch (error) {
      console.error('[Setup] Failed to save OAuth credentials:', error);
      res.status(500).json({ error: 'Failed to save OAuth credentials' });
    }
  });

  // ===== REAL GOOGLE OAUTH 2.0 =====
  // Step 1: Redirect user to Google's consent screen
  app.get('/api/auth/google', async (req: any, res) => {
    try {
      // Determine redirect URI from the current request
      const baseUrl = getBaseUrlFromRequest(req);
      const redirectUri = `${baseUrl}/api/auth/google/callback`;

      // Try to load credentials from api_settings first, then env vars
      const { clientId, clientSecret } = await getStoredOAuthCredentials('google');

      if (!clientId || !clientSecret) {
        console.warn('[Auth] Google OAuth not configured');
        return res.redirect('/?error=oauth_not_configured&provider=google');
      }

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/spreadsheets.readonly',
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
  // This handles BOTH the login flow AND the gmail-connect (add sender) flow.
  // The 'purpose' field in the OAuth state differentiates them.
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

      // Parse state to get the redirect URI and purpose
      let redirectUri = `${getBaseUrlFromRequest(req)}/api/auth/google/callback`;
      let purpose = 'login'; // default
      let stateOrgId = '';
      let returnTo = '';
      try {
        if (state) {
          const parsed = JSON.parse(state as string);
          if (parsed.redirectUri) redirectUri = parsed.redirectUri;
          if (parsed.purpose) purpose = parsed.purpose;
          if (parsed.orgId) stateOrgId = parsed.orgId;
          if (parsed.returnTo) returnTo = parsed.returnTo;
        }
      } catch (e) { /* use default */ }

      // Load credentials
      const { clientId, clientSecret } = await getStoredOAuthCredentials('google');

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

      // ===== GMAIL-CONNECT (ADD SENDER) FLOW =====
      // If purpose is 'add_sender', this came from /api/auth/gmail-connect
      // Handle it like the old gmail-connect/callback: store per-sender tokens, create account, redirect
      if (purpose === 'add_sender') {
        console.log('[Auth] Gmail-connect flow for:', email);
        const orgId = stateOrgId || (req.session as any)?.user?.organizationId || '';
        
        // Fallback: get first org if orgId not in state
        let effectiveOrgId = orgId;
        if (!effectiveOrgId) {
          const orgIds = await storage.getAllOrganizationIds();
          effectiveOrgId = orgIds[0] || '';
        }

        // Store per-sender tokens
        if (tokens.access_token) {
          await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_access_token`, tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_refresh_token`, tokens.refresh_token);
        } else {
          console.warn('[Auth] No refresh_token returned on re-auth for', email, '- Google may not have issued one. prompt:consent should force this.');
        }
        if (tokens.expiry_date) {
          await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_token_expiry`, String(tokens.expiry_date));
        }

        // ALWAYS update org-level tokens on re-auth so Google Sheets API etc. use the freshest token
        // (which includes all requested scopes like spreadsheets.readonly)
        console.log('[Auth] Updating org-level tokens. access_token:', tokens.access_token ? 'yes' : 'no', 'refresh_token:', tokens.refresh_token ? 'yes' : 'no', 'expiry:', tokens.expiry_date);
        await storage.setApiSetting(effectiveOrgId, 'gmail_access_token', tokens.access_token!);
        if (tokens.refresh_token) await storage.setApiSetting(effectiveOrgId, 'gmail_refresh_token', tokens.refresh_token);
        if (tokens.expiry_date) await storage.setApiSetting(effectiveOrgId, 'gmail_token_expiry', String(tokens.expiry_date));
        const primaryEmail = (await storage.getApiSettings(effectiveOrgId)).gmail_user_email;
        if (!primaryEmail) await storage.setApiSetting(effectiveOrgId, 'gmail_user_email', email);

        // Create or update email account
        const existingAccounts = await storage.getEmailAccounts(effectiveOrgId);
        const existingAccount = existingAccounts.find((a: any) => a.email === email);
        if (!existingAccount) {
          const currentUserId = (req.session as any)?.userId || req.cookies?.user_id || null;
          await storage.createEmailAccount({
            organizationId: effectiveOrgId,
            userId: currentUserId,
            provider: 'gmail',
            email,
            displayName: name,
            smtpConfig: {
              host: 'smtp.gmail.com', port: 587, secure: false,
              auth: { user: email, pass: 'OAUTH_TOKEN' },
              fromName: name, fromEmail: email, replyTo: '',
              provider: 'gmail',
            },
            dailyLimit: getProviderDailyLimit('gmail'),
            isActive: true,
          });
          console.log(`[Auth] New Gmail sender added via OAuth: ${email}`);
        } else {
          console.log(`[Auth] Gmail sender already exists: ${email}, tokens updated`);
        }

        // Redirect back to the page that initiated the flow
        if (returnTo === 'contacts') {
          return res.redirect('/?view=contacts&gmail_connected=' + encodeURIComponent(email));
        } else {
          return res.redirect('/?view=setup&gmail_connected=' + encodeURIComponent(email));
        }
      }

      // ===== NORMAL LOGIN FLOW =====
      console.log('[Auth] Google OAuth success for:', email);

      // Upsert user in database
      let dbUser = await storage.getUserByEmail(email) as any;
      if (!dbUser) {
        // Create user without org first (org will be assigned by ensureUserOrganization)
        dbUser = await storage.createUser({
          email,
          firstName,
          lastName,
          role: 'admin',
          organizationId: 'pending', // temporary, will be set properly below
          isActive: true,
        });
        console.log('[Auth] Created new user:', dbUser.id, email);
      } else {
        // Update name/picture if changed
        await storage.updateUser(dbUser.id, { firstName, lastName });
        console.log('[Auth] Updated existing user:', dbUser.id, email);
      }

      const userId = dbUser.id;
      
      // Ensure user has an organization (create one or accept invitations)
      const userOrgId = await ensureUserOrganization(userId, email, name);
      console.log('[Auth] User org resolved:', userOrgId);

      // Auto-promote first user to SuperAdmin if none exists
      try {
        const platformStats = await storage.getPlatformStats();
        if (platformStats.superAdmins === 0) {
          await storage.setSuperAdmin(userId, true);
          console.log('[Auth] Auto-promoted first user to SuperAdmin:', email);
        }
      } catch (e) {
        console.error('[Auth] Failed to check/set SuperAdmin:', e);
      }

      const userObj = {
        id: userId,
        email,
        name,
        picture,
        provider: 'google',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
      };

      // Store Gmail tokens in the user's organization api_settings
      try {
        if (tokens.access_token) {
          await storage.setApiSetting(userOrgId, 'gmail_access_token', tokens.access_token);
          // Also store per-sender tokens for multi-account support
          await storage.setApiSetting(userOrgId, `gmail_sender_${email}_access_token`, tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(userOrgId, 'gmail_refresh_token', tokens.refresh_token);
          await storage.setApiSetting(userOrgId, `gmail_sender_${email}_refresh_token`, tokens.refresh_token);
        }
        if (tokens.expiry_date) {
          await storage.setApiSetting(userOrgId, 'gmail_token_expiry', String(tokens.expiry_date));
          await storage.setApiSetting(userOrgId, `gmail_sender_${email}_token_expiry`, String(tokens.expiry_date));
        }
        await storage.setApiSetting(userOrgId, 'gmail_user_email', email);
        console.log('[Auth] Stored Gmail tokens for reply tracking');

        // Auto-create Gmail email account for sending campaigns
        try {
          const existingAccounts = await storage.getEmailAccounts(userOrgId);
          const alreadyExists = existingAccounts.find((a: any) => a.email === email);
          if (!alreadyExists) {
            await storage.createEmailAccount({
              organizationId: userOrgId,
              userId: userId,
              provider: 'gmail',
              email,
              displayName: name || email.split('@')[0],
              smtpConfig: {
                host: 'smtp.gmail.com', port: 587, secure: false,
                auth: { user: email, pass: 'OAUTH_TOKEN' },
                fromName: name || email.split('@')[0],
                fromEmail: email,
                replyTo: '',
                provider: 'gmail',
              },
              dailyLimit: getProviderDailyLimit('gmail'),
              isActive: true,
            });
            console.log('[Auth] Auto-created Gmail sender account:', email);
          } else {
            console.log('[Auth] Gmail sender account already exists:', email);
          }
        } catch (accountError) {
          console.error('[Auth] Failed to auto-create Gmail sender account:', accountError);
        }

        // Start automatic reply checking
        gmailReplyTracker.startAutoCheck(userOrgId, 5);
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

  // ===== ADD GMAIL ACCOUNT VIA OAUTH (separate from login) =====
  // Initiates Google OAuth specifically to add a new Gmail sender account
  // IMPORTANT: Uses the SAME redirect URI as the main login flow (/api/auth/google/callback)
  // to avoid redirect_uri_mismatch errors. The 'purpose' field in state differentiates flows.
  app.get('/api/auth/gmail-connect', requireAuth, async (req: any, res) => {
    try {
      const baseUrl = getBaseUrlFromRequest(req);
      // Use the SAME callback as the main Google OAuth flow (registered in Google Cloud Console)
      const redirectUri = `${baseUrl}/api/auth/google/callback`;
      const orgId = req.user.organizationId;

      // Look for Google OAuth credentials: user's org first, then superadmin's org, then all orgs, then env vars
      let clientId = '';
      let clientSecret = '';
      try {
        const settings = await storage.getApiSettings(orgId);
        if (settings.google_oauth_client_id) {
          clientId = settings.google_oauth_client_id;
          clientSecret = settings.google_oauth_client_secret || '';
        }
      } catch (e) { /* ignore */ }

      // Fallback: try superadmin's org
      if (!clientId || !clientSecret) {
        try {
          const superAdminOrgId = await storage.getSuperAdminOrgId();
          if (superAdminOrgId && superAdminOrgId !== orgId) {
            const superSettings = await storage.getApiSettings(superAdminOrgId);
            if (superSettings.google_oauth_client_id) {
              clientId = superSettings.google_oauth_client_id;
              clientSecret = superSettings.google_oauth_client_secret || '';
              console.log('[Auth] Using Google OAuth credentials from superadmin org');
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Fallback: search all orgs (via existing helper)
      if (!clientId || !clientSecret) {
        const creds = await getStoredOAuthCredentials('google');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      }

      if (!clientId || !clientSecret) {
        return res.redirect('/?view=setup&error=oauth_not_configured');
      }

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });
      // Use login_hint if provided (for connecting specific account)
      const loginHint = req.query.email as string || '';
      // Support returnTo parameter so we can redirect back to the page that initiated the flow
      const returnTo = req.query.returnTo as string || '';
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/spreadsheets.readonly',
        ],
        state: JSON.stringify({ redirectUri, purpose: 'add_sender', orgId, returnTo }),
        ...(loginHint ? { login_hint: loginHint } : {}),
      });

      console.log('[Auth] Gmail connect redirect, hint:', loginHint || 'none');
      res.redirect(authUrl);
    } catch (error) {
      console.error('[Auth] Gmail connect init error:', error);
      res.redirect('/?view=setup&error=gmail_connect_failed');
    }
  });

  // Callback for adding Gmail sender account
  // Legacy callback - kept for backward compatibility but /api/auth/google/callback now handles both flows
  app.get('/api/auth/gmail-connect/callback', async (req: any, res) => {
    // Redirect to the main Google callback with the same query params
    const queryString = Object.entries(req.query).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    res.redirect(`/api/auth/google/callback?${queryString}`);
  });

  // ===== REAL MICROSOFT / OUTLOOK OAUTH 2.0 =====
  // Step 1: Redirect user to Microsoft's consent screen
  app.get('/api/auth/microsoft', async (req: any, res) => {
    try {
      const baseUrl = getBaseUrlFromRequest(req);
      const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;

      // Load credentials from api_settings first, then env vars
      const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');

      if (!clientId || !clientSecret) {
        console.warn('[Auth] Microsoft OAuth not configured');
        return res.redirect('/?error=oauth_not_configured&provider=microsoft');
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
      const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');

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
      let dbUser = await storage.getUserByEmail(email) as any;
      if (!dbUser) {
        dbUser = await storage.createUser({
          email,
          firstName,
          lastName,
          role: 'admin',
          organizationId: 'pending', // temporary, will be set properly below
          isActive: true,
        });
        console.log('[Auth] Created new Microsoft user:', dbUser.id, email);
      } else {
        await storage.updateUser(dbUser.id, { firstName, lastName });
        console.log('[Auth] Updated existing Microsoft user:', dbUser.id, email);
      }

      const userId = dbUser.id;
      
      // Ensure user has an organization
      const userOrgId = await ensureUserOrganization(userId, email, name);
      console.log('[Auth] Microsoft user org resolved:', userOrgId);

      // Auto-promote first user to SuperAdmin if none exists
      try {
        const platformStats = await storage.getPlatformStats();
        if (platformStats.superAdmins === 0) {
          await storage.setSuperAdmin(userId, true);
          console.log('[Auth] Auto-promoted first Microsoft user to SuperAdmin:', email);
        }
      } catch (e) {
        console.error('[Auth] Failed to check/set SuperAdmin:', e);
      }

      const userObj = {
        id: userId,
        email,
        name,
        picture: '',
        provider: 'microsoft',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
      };

      // Store Microsoft tokens in the user's organization api_settings
      try {
        if (tokens.access_token) {
          await storage.setApiSetting(userOrgId, 'microsoft_access_token', tokens.access_token);
          await storage.setApiSetting(userOrgId, `outlook_sender_${email}_access_token`, tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(userOrgId, 'microsoft_refresh_token', tokens.refresh_token);
          await storage.setApiSetting(userOrgId, `outlook_sender_${email}_refresh_token`, tokens.refresh_token);
        }
        if (tokens.expires_in) {
          const expiryDate = Date.now() + (tokens.expires_in * 1000);
          await storage.setApiSetting(userOrgId, 'microsoft_token_expiry', String(expiryDate));
          await storage.setApiSetting(userOrgId, `outlook_sender_${email}_token_expiry`, String(expiryDate));
        }
        await storage.setApiSetting(userOrgId, 'microsoft_user_email', email);
        console.log('[Auth] Stored Microsoft tokens for mail integration');

        // Auto-create Outlook email account for sending campaigns
        try {
          const existingAccounts = await storage.getEmailAccounts(userOrgId);
          const alreadyExists = existingAccounts.find((a: any) => a.email === email);
          if (!alreadyExists) {
            await storage.createEmailAccount({
              organizationId: userOrgId,
              userId: userId,
              provider: 'outlook',
              email,
              displayName: name || email.split('@')[0],
              smtpConfig: {
                host: 'smtp-mail.outlook.com', port: 587, secure: false,
                auth: { user: email, pass: 'OAUTH_TOKEN' },
                fromName: name || email.split('@')[0],
                fromEmail: email,
                replyTo: '',
                provider: 'outlook',
              },
              dailyLimit: getProviderDailyLimit('outlook'),
              isActive: true,
            });
            console.log('[Auth] Auto-created Outlook sender account:', email);
          } else {
            console.log('[Auth] Outlook sender account already exists:', email);
          }
        } catch (accountError) {
          console.error('[Auth] Failed to auto-create Outlook sender account:', accountError);
        }

        // Start Outlook reply tracking
        outlookReplyTracker.startAutoCheck(userOrgId, 5);
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
    if (userId) {
      // Auto-restore session from DB if needed (after server restart)
      if (!loggedInUsers.has(userId)) {
        try {
          const dbUser = await storage.getUser(userId) as any;
          if (dbUser && dbUser.isActive !== false) {
            loggedInUsers.add(userId);
            if (!(req.session as any)?.user) {
              (req.session as any).userId = userId;
              (req.session as any).user = {
                id: dbUser.id, email: dbUser.email,
                name: dbUser.name || dbUser.email, provider: dbUser.provider || 'google',
              };
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (loggedInUsers.has(userId)) {
        const session = req.session as any;
        const user = session?.user;
        return res.json({ connected: true, email: user?.email || 'unknown', demo: !user?.access_token || user?.access_token === 'demo-token' });
      }
    }
    res.json({ connected: false });
  });

  app.get('/api/auth/microsoft/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const userId = req.cookies?.user_id;
    if (userId) {
      // Auto-restore session from DB if needed (after server restart)
      if (!loggedInUsers.has(userId)) {
        try {
          const dbUser = await storage.getUser(userId) as any;
          if (dbUser && dbUser.isActive !== false) {
            loggedInUsers.add(userId);
            if (!(req.session as any)?.user) {
              (req.session as any).userId = userId;
              (req.session as any).user = {
                id: dbUser.id, email: dbUser.email,
                name: dbUser.name || dbUser.email, provider: dbUser.provider || 'google',
              };
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (loggedInUsers.has(userId)) {
        const session = req.session as any;
        const user = session?.user;
        if (user?.provider === 'microsoft') {
          return res.json({ connected: true, email: user?.email || 'unknown', demo: !user?.access_token || user?.access_token === 'demo-ms-token' });
        }
        // Also check if Microsoft tokens are stored (user logged in with Google but connected Outlook too)
        try {
          // Try to find the user's org and check for MS tokens
          const dbUser = await storage.getUserByEmail(user?.email || '') as any;
          if (dbUser) {
            const userOrg = await storage.getUserDefaultOrganization(dbUser.id);
            if (userOrg) {
              const settings = await storage.getApiSettings(userOrg.id);
              if (settings.microsoft_access_token && settings.microsoft_user_email) {
                return res.json({ connected: true, email: settings.microsoft_user_email, demo: false });
              }
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
    res.json({ connected: false });
  });

  app.get('/api/auth/user', async (req, res) => {
    const session = req.session as any;
    if (session?.user) return res.json(session.user);
    const userId = req.cookies?.user_id;
    const userData = req.cookies?.user_data;
    
    // Try restoring from cookie data first (existing behavior)
    if (userId && loggedInUsers.has(userId) && userData) {
      try {
        const user = JSON.parse(userData);
        (req.session as any).userId = userId;
        (req.session as any).user = user;
        return res.json(user);
      } catch (err) { /* ignore */ }
    }
    
    // Auto-restore from DB if server was restarted (loggedInUsers cleared)
    if (userId && !loggedInUsers.has(userId)) {
      try {
        const dbUser = await storage.getUser(userId) as any;
        if (dbUser && dbUser.isActive !== false) {
          loggedInUsers.add(userId);
          const userObj = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name || dbUser.email,
            provider: dbUser.provider || 'google',
          };
          (req.session as any).userId = userId;
          (req.session as any).user = userObj;
          console.log(`[Auth] Auto-restored /api/auth/user session for ${dbUser.email} (${userId})`);
          return res.json(userObj);
        }
      } catch (e) { /* ignore */ }
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
        const { clientId: gId } = await getStoredOAuthCredentials('google');
        const { clientId: mId } = await getStoredOAuthCredentials('microsoft');
        if (gId) googleClientId = gId;
        if (mId) msClientId = mId;
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
    res.json({ message: 'AImailPilot server is running!', timestamp: new Date().toISOString() });
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
  app.use('/api/sheets', requireAuth);

  // ========== DASHBOARD ==========
  
  app.get('/api/dashboard/stats', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      // Members see only their own stats; admins/owners see all org stats
      const stats = isAdmin
        ? await storage.getCampaignStats(req.user.organizationId)
        : await storage.getCampaignStatsForUser(req.user.organizationId, req.user.id);
      
      const openRate = stats.totalSent > 0 ? ((stats.totalOpened / stats.totalSent) * 100).toFixed(1) : '0';
      const replyRate = stats.totalSent > 0 ? ((stats.totalReplied / stats.totalSent) * 100).toFixed(1) : '0';
      const deliveryRate = stats.totalSent > 0 ? (((stats.totalSent - stats.totalBounced) / stats.totalSent) * 100).toFixed(1) : '0';

      // Get contact counts scoped to user role
      const totalContacts = isAdmin
        ? await storage.getContactsCount(req.user.organizationId)
        : await storage.getContactsCountForUserTotal(req.user.organizationId, req.user.id);
      
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
        totalContacts: totalContacts || 0,
        // User context
        userRole: req.user.role,
        userId: req.user.id,
        isSuperAdmin: req.user.isSuperAdmin || false,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
  });

  // ========== EMAIL ACCOUNTS (SMTP) ==========

  app.get('/api/email-accounts', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const allAccounts = await storage.getEmailAccounts(req.user.organizationId);
      
      // Non-admin members only see their OWN accounts; admins see all
      const accounts = isAdmin 
        ? allAccounts 
        : allAccounts.filter((a: any) => a.userId === req.user.id);
      
      // Don't return passwords in the response, but expose authMethod for OAuth detection
      const safe = accounts.map((a: any) => {
        const isOAuth = a.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
        return {
          ...a,
          authMethod: isOAuth ? 'oauth' : 'smtp',
          smtpConfig: a.smtpConfig ? {
            ...a.smtpConfig,
            auth: { user: a.smtpConfig.auth?.user, pass: isOAuth ? 'OAUTH_TOKEN' : '••••••••' }
          } : null,
        };
      });
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
      const isOAuth = account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
      res.json({
        ...account,
        authMethod: isOAuth ? 'oauth' : 'smtp',
        smtpConfig: account.smtpConfig ? {
          ...account.smtpConfig,
          auth: { user: account.smtpConfig.auth?.user, pass: isOAuth ? 'OAUTH_TOKEN' : '••••••••' }
        } : null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch email account' });
    }
  });

  // ===== CONNECT GMAIL VIA OAUTH (Mailmeteor-style one-click) =====

  // Check if Gmail OAuth is available for quick connect
  app.get('/api/email-accounts/gmail-oauth-status', async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const gmailEmail = settings.gmail_user_email;
      const hasToken = !!(settings.gmail_access_token || settings.gmail_refresh_token);
      res.json({ 
        available: !!(gmailEmail && hasToken),
        email: gmailEmail || null,
        hasToken,
      });
    } catch (e) {
      res.json({ available: false, email: null, hasToken: false });
    }
  });

  app.post('/api/email-accounts/connect-gmail', async (req: any, res) => {
    try {
      const { displayName, email: overrideEmail } = req.body;
      const orgId = req.user.organizationId;

      // Check if we have stored Gmail OAuth tokens
      const settings = await storage.getApiSettings(orgId);
      const gmailEmail = overrideEmail || settings.gmail_user_email;
      const accessToken = settings.gmail_access_token;
      const refreshToken = settings.gmail_refresh_token;

      if (!gmailEmail) {
        return res.status(400).json({ 
          message: 'No Gmail account connected. Please sign in with Google first.',
          code: 'NO_GMAIL_ACCOUNT'
        });
      }

      if (!accessToken && !refreshToken) {
        return res.status(400).json({ 
          message: 'Gmail OAuth tokens not found. Please re-authenticate with Google.',
          code: 'NO_OAUTH_TOKENS'
        });
      }

      // Check if this Gmail is already connected as an email account
      const existingAccounts = await storage.getEmailAccounts(orgId);
      const alreadyExists = existingAccounts.find((a: any) => a.email === gmailEmail && a.provider === 'gmail');
      if (alreadyExists) {
        return res.status(400).json({ 
          message: `Gmail account ${gmailEmail} is already connected.`,
          code: 'ALREADY_EXISTS'
        });
      }

      // Verify the token works by calling Gmail API
      let tokenToUse = accessToken;
      try {
        const testResp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${tokenToUse}` },
        });
        if (!testResp.ok) {
          // Try refreshing the token
          const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
          const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
          if (refreshToken && clientId && clientSecret) {
            const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
              }),
            });
            if (refreshResp.ok) {
              const refreshData = await refreshResp.json() as any;
              tokenToUse = refreshData.access_token;
              await storage.setApiSetting(orgId, 'gmail_access_token', tokenToUse);
              if (refreshData.expiry_date) {
                await storage.setApiSetting(orgId, 'gmail_token_expiry', String(refreshData.expiry_date));
              }
            } else {
              return res.status(400).json({ 
                message: 'Failed to refresh Gmail token. Please re-authenticate with Google.',
                code: 'TOKEN_REFRESH_FAILED'
              });
            }
          } else {
            return res.status(400).json({ 
              message: 'Gmail token expired and cannot be refreshed. Please re-authenticate.',
              code: 'TOKEN_EXPIRED'
            });
          }
        }
      } catch (e) {
        return res.status(400).json({ 
          message: 'Could not verify Gmail connection. Please try again.',
          code: 'VERIFICATION_FAILED'
        });
      }

      // Create the email account with Gmail provider (no SMTP config needed for API sending)
      const smtpConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: gmailEmail, pass: 'OAUTH_TOKEN' },
        fromName: displayName || gmailEmail.split('@')[0],
        fromEmail: gmailEmail,
        replyTo: '',
        provider: 'gmail' as const,
      };

      const account = await storage.createEmailAccount({
        organizationId: orgId,
        userId: req.user.id,
        provider: 'gmail',
        email: gmailEmail,
        displayName: displayName || gmailEmail.split('@')[0],
        smtpConfig,
        dailyLimit: getProviderDailyLimit('gmail'),
        isActive: true,
      });

      console.log(`[EmailAccounts] Gmail OAuth account connected: ${gmailEmail}`);

      res.status(201).json({
        ...account,
        smtpConfig: undefined,
        method: 'oauth',
        message: `Gmail account ${gmailEmail} connected successfully via OAuth! No app password required.`,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[EmailAccounts] Gmail OAuth connect error:', errMsg);
      res.status(500).json({ message: `Failed to connect Gmail: ${errMsg}` });
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

      // Create account — userId links to the user who adds this account
      const account = await storage.createEmailAccount({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        provider: provider || 'custom',
        email,
        displayName: displayName || email,
        smtpConfig,
        dailyLimit: getProviderDailyLimit(provider),
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
          error: `Email account with ID "${req.params.id}" was not found.`,
          code: 'ACCOUNT_NOT_FOUND'
        });
      }

      const isOAuthAccount = account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
      const orgId = account.organizationId || req.user?.organizationId || '';

      // For OAuth-linked accounts (Gmail API / Microsoft Graph), test via API
      if (isOAuthAccount) {
        const provider = account.provider || account.smtpConfig?.provider || '';
        
        if (provider === 'gmail' || provider === 'google') {
          // Test Gmail API connection
          try {
            const settings = await storage.getApiSettings(orgId);
            // Try per-sender tokens first, then org-level
            let accessToken = settings[`gmail_sender_${account.email}_access_token`] || settings.gmail_access_token;
            const refreshToken = settings[`gmail_sender_${account.email}_refresh_token`] || settings.gmail_refresh_token;
            
            if (!accessToken && !refreshToken) {
              return res.json({ success: false, error: 'Gmail OAuth tokens not found. Please re-authenticate with Google.', code: 'OAUTH_NO_TOKENS', authMethod: 'oauth' });
            }

            // Try a lightweight Gmail API call to verify tokens
            const testResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (testResp.ok) {
              const profile = await testResp.json() as any;
              // Optionally send test email
              const testEmail = req.body.testEmail || account.email;
              if (testEmail) {
                const raw = Buffer.from(
                  `From: ${account.email}\r\nTo: ${testEmail}\r\nSubject: AImailPilot Test Email\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n<p>This is a test email from AImailPilot sent via Gmail API (OAuth).</p><p>Your Gmail account <strong>${profile.emailAddress}</strong> is working correctly!</p>`
                ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw }),
                });

                if (sendResp.ok) {
                  return res.json({ success: true, message: `Test email sent to ${testEmail} via Gmail API`, authMethod: 'oauth', provider: 'gmail', email: profile.emailAddress });
                } else {
                  const errText = await sendResp.text();
                  // If 401, try token refresh
                  if (sendResp.status === 401 && refreshToken) {
                    return res.json({ success: false, error: 'Gmail token expired. Please sign out and sign back in with Google to refresh.', code: 'OAUTH_TOKEN_EXPIRED', authMethod: 'oauth' });
                  }
                  return res.json({ success: false, error: `Gmail API send failed: ${errText}`, code: 'GMAIL_API_ERROR', authMethod: 'oauth' });
                }
              }
              return res.json({ success: true, message: `Gmail API connected as ${profile.emailAddress}`, authMethod: 'oauth', provider: 'gmail', email: profile.emailAddress });
            } else if (testResp.status === 401 && refreshToken) {
              // Token expired - try refresh
              const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
              const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
              if (clientId && clientSecret) {
                try {
                  const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri: '' });
                  oauth2Client.setCredentials({ refresh_token: refreshToken });
                  const { credentials } = await oauth2Client.refreshAccessToken();
                  if (credentials.access_token) {
                    await storage.setApiSetting(orgId, `gmail_sender_${account.email}_access_token`, credentials.access_token);
                    await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
                    if (credentials.expiry_date) {
                      await storage.setApiSetting(orgId, `gmail_sender_${account.email}_token_expiry`, String(credentials.expiry_date));
                      await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
                    }
                    return res.json({ success: true, message: 'Gmail OAuth token refreshed and verified', authMethod: 'oauth', provider: 'gmail', email: account.email });
                  }
                } catch (refreshErr) {
                  console.error('[Test] Gmail token refresh failed:', refreshErr);
                }
              }
              return res.json({ success: false, error: 'Gmail token expired. Please sign out and sign back in with Google.', code: 'OAUTH_TOKEN_EXPIRED', authMethod: 'oauth' });
            } else {
              return res.json({ success: false, error: 'Gmail API connection failed. Please re-authenticate.', code: 'GMAIL_API_ERROR', authMethod: 'oauth' });
            }
          } catch (gmailErr) {
            console.error('[Test] Gmail API test error:', gmailErr);
            return res.json({ success: false, error: 'Failed to test Gmail API connection', code: 'GMAIL_API_ERROR', authMethod: 'oauth' });
          }
        } else if (provider === 'outlook' || provider === 'microsoft') {
          // Test Microsoft Graph connection
          try {
            const settings = await storage.getApiSettings(orgId);
            const accessToken = settings[`outlook_sender_${account.email}_access_token`] || settings.microsoft_access_token;
            if (!accessToken) {
              return res.json({ success: false, error: 'Microsoft OAuth tokens not found. Please re-authenticate.', code: 'OAUTH_NO_TOKENS', authMethod: 'oauth' });
            }
            const testResp = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (testResp.ok) {
              const profile = await testResp.json() as any;
              return res.json({ success: true, message: `Microsoft Graph connected as ${profile.mail || profile.userPrincipalName}`, authMethod: 'oauth', provider: 'outlook', email: profile.mail || profile.userPrincipalName });
            } else {
              return res.json({ success: false, error: 'Microsoft token expired. Please sign out and sign back in.', code: 'OAUTH_TOKEN_EXPIRED', authMethod: 'oauth' });
            }
          } catch (msErr) {
            return res.json({ success: false, error: 'Failed to test Microsoft Graph connection', code: 'MS_GRAPH_ERROR', authMethod: 'oauth' });
          }
        }
      }

      // Non-OAuth: Standard SMTP test
      if (!account.smtpConfig) {
        return res.status(400).json({ success: false, error: 'SMTP is not configured.', code: 'SMTP_NOT_CONFIGURED' });
      }

      const verifyResult = await smtpEmailService.verifyConnection(account.smtpConfig);
      if (!verifyResult.success) {
        return res.json({ 
          success: false, error: verifyResult.error, code: 'SMTP_VERIFY_FAILED',
          provider: account.provider, host: account.smtpConfig.host, authMethod: 'smtp',
        });
      }

      const testEmail = req.body.testEmail || account.email;
      const sendResult = await smtpEmailService.sendTestEmail(account.id, account.smtpConfig, testEmail);
      res.json({ ...sendResult, provider: account.provider, email: account.email, host: account.smtpConfig.host, authMethod: 'smtp' });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: `Internal error while testing: ${errMsg}`, code: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/email-accounts/:id/verify', async (req: any, res) => {
    try {
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }

      const isOAuthAccount = account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
      
      // OAuth accounts are "verified" if tokens exist
      if (isOAuthAccount) {
        const orgId = account.organizationId || req.user?.organizationId || '';
        const provider = account.provider || '';
        const settings = await storage.getApiSettings(orgId);
        
        if (provider === 'gmail' || provider === 'google') {
          const hasToken = settings[`gmail_sender_${account.email}_access_token`] || settings.gmail_access_token;
          return res.json({ success: !!hasToken, authMethod: 'oauth', message: hasToken ? 'Gmail OAuth connected' : 'Gmail OAuth tokens missing' });
        } else if (provider === 'outlook' || provider === 'microsoft') {
          const hasToken = settings[`outlook_sender_${account.email}_access_token`] || settings.microsoft_access_token;
          return res.json({ success: !!hasToken, authMethod: 'oauth', message: hasToken ? 'Outlook OAuth connected' : 'Outlook OAuth tokens missing' });
        }
      }

      if (!account.smtpConfig) {
        return res.status(404).json({ success: false, error: 'SMTP not configured' });
      }
      const result = await smtpEmailService.verifyConnection(account.smtpConfig);
      res.json({ ...result, authMethod: 'smtp' });
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
      // All org members can see quota summary (email accounts are shared resources)
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

  // Admin endpoint: get email accounts grouped by team member
  app.get('/api/email-accounts/by-member', async (req: any, res) => {
    try {
      const role = req.user.role;
      if (role !== 'owner' && role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }
      const accounts = await storage.getEmailAccounts(req.user.organizationId);
      const members = await storage.getOrgMembers(req.user.organizationId);
      
      // Group accounts by userId
      const byMember: Record<string, any> = {};
      for (const acct of accounts as any[]) {
        const uid = acct.userId || 'unassigned';
        if (!byMember[uid]) {
          const member = members.find((m: any) => m.userId === uid);
          byMember[uid] = {
            userId: uid,
            email: (member as any)?.email || 'Unassigned',
            firstName: (member as any)?.firstName || '',
            lastName: (member as any)?.lastName || '',
            role: (member as any)?.role || '',
            accounts: [],
          };
        }
        byMember[uid].accounts.push({
          id: acct.id,
          email: acct.email,
          displayName: acct.displayName,
          provider: acct.provider,
          isActive: acct.isActive,
          dailyLimit: acct.dailyLimit,
          dailySent: acct.dailySent,
        });
      }
      res.json(Object.values(byMember));
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch accounts by member' });
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
      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
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
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      // Members only see their own campaigns; admins/owners see all org campaigns
      let campaigns;
      if (isAdmin) {
        campaigns = await storage.getCampaigns(req.user.organizationId, limit, offset);
      } else {
        campaigns = await storage.getCampaignsForUser(req.user.organizationId, req.user.id, limit, offset);
      }
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

      const delayBetweenEmails = req.body.delayBetweenEmails || 2000;

      // Persist the sending config so it survives pause/resume/restart
      const sendingConfig = {
        delayBetweenEmails,
        batchSize: req.body.batchSize || 10,
        autopilot: req.body.autopilot || null,
        // Store the user's timezone offset so we can calculate their local time
        timezoneOffset: req.body.timezoneOffset ?? null,
      };
      
      console.log(`[Campaign] SEND ${req.params.id}: delay=${delayBetweenEmails}ms, autopilot=${sendingConfig.autopilot?.enabled ? 'ON' : 'OFF'}, maxPerDay=${sendingConfig.autopilot?.maxPerDay || 'N/A'}, tz=${sendingConfig.timezoneOffset}`);
      console.log(`[Campaign] Full sendingConfig: ${JSON.stringify(sendingConfig).slice(0, 500)}`);
      
      await storage.updateCampaign(req.params.id, { sendingConfig });

      const result = await campaignEngine.startCampaign({
        campaignId: req.params.id,
        delayBetweenEmails,
        batchSize: req.body.batchSize || 10,
        sendingConfig,
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
    // Set public base URL for tracking links (same as /send endpoint)
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost')) {
      campaignEngine.setPublicBaseUrl(`${proto}://${host}`);
    }

    const success = campaignEngine.resumeCampaign(req.params.id);
    if (!success) {
      // Campaign not in memory (e.g. server restarted while paused).
      // Re-start — startCampaign skips already-sent contacts.
      // Read saved sending config to restore ALL settings: delay, time windows, maxPerDay.
      try {
        const campaign = await storage.getCampaign(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
        
        const savedConfig = campaign.sendingConfig;
        if (!savedConfig || !savedConfig.delayBetweenEmails) {
          console.warn(`[Campaign] WARNING: No sendingConfig found for campaign ${req.params.id}. Using defaults.`);
        }
        
        const delayBetweenEmails = savedConfig?.delayBetweenEmails || 2000;

        console.log(`[Campaign] Resuming ${req.params.id} from DB config:`);
        console.log(`[Campaign]   delay=${delayBetweenEmails}ms (${(delayBetweenEmails/1000).toFixed(0)}s)`);
        console.log(`[Campaign]   autopilot=${savedConfig?.autopilot?.enabled ? 'ON' : 'OFF'}`);
        console.log(`[Campaign]   maxPerDay=${savedConfig?.autopilot?.maxPerDay || 'unlimited'}`);
        console.log(`[Campaign]   timezoneOffset=${savedConfig?.timezoneOffset ?? 'not set'}`);
        console.log(`[Campaign]   Full sendingConfig: ${JSON.stringify(savedConfig)?.slice(0, 500)}`);

        const result = await campaignEngine.startCampaign({
          campaignId: req.params.id,
          delayBetweenEmails,
          batchSize: savedConfig?.batchSize || 10,
          sendingConfig: savedConfig || undefined,
        });
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ success: false, error: 'Failed to resume campaign' });
      }
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/stop', async (req: any, res) => {
    campaignEngine.stopCampaign(req.params.id);
    await storage.updateCampaign(req.params.id, { status: 'paused' });
    res.json({ success: true });
  });

  // Reset campaign: clear failed messages and bounce counts (for campaigns with false bounces)
  app.post('/api/campaigns/:id/reset-bounces', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      // Get all messages for this campaign
      const messages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      
      // Delete failed messages (these were never actually sent)
      let deletedCount = 0;
      let restoredContacts = 0;
      for (const msg of messages) {
        if (msg.status === 'failed') {
          // Check if the failure was an infrastructure error (not a real bounce)
          const errorStr = (msg.errorMessage || '').toLowerCase();
          const isInfraError = errorStr.includes('oauth') || errorStr.includes('token') ||
            errorStr.includes('re-authenticate') || errorStr.includes('401') || errorStr.includes('403') ||
            errorStr.includes('api error') || errorStr.includes('connection refused');
          
          if (isInfraError) {
            // Delete the failed message record
            try { await storage.deleteCampaignMessage(msg.id); } catch (e) {}
            deletedCount++;
            
            // Restore contact status from 'bounced' to 'active' if it was falsely bounced
            if (msg.contactId) {
              try {
                const contact = await storage.getContact(msg.contactId);
                if (contact && (contact as any).status === 'bounced') {
                  await storage.updateContact(msg.contactId, { status: 'active' });
                  restoredContacts++;
                }
              } catch (e) {}
            }
          }
        }
      }
      
      // Recalculate bounce count from remaining failed messages
      const remainingMessages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      const actualBounces = remainingMessages.filter((m: any) => m.status === 'failed').length;
      const actualSent = remainingMessages.filter((m: any) => m.status === 'sent').length;
      
      await storage.updateCampaign(req.params.id, {
        bouncedCount: actualBounces,
        sentCount: actualSent,
      });
      
      res.json({
        success: true,
        deletedMessages: deletedCount,
        restoredContacts,
        actualBounces,
        actualSent,
      });
    } catch (error) {
      console.error('[Campaign] Reset bounces error:', error);
      res.status(500).json({ error: 'Failed to reset bounces' });
    }
  });

  app.post('/api/campaigns/:id/schedule', async (req: any, res) => {
    try {
      const { scheduledAt, delayBetweenEmails, autopilot, timezoneOffset } = req.body;
      if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });
      
      // Persist sending config for scheduled campaigns too
      const sendingConfig = {
        delayBetweenEmails: delayBetweenEmails || 2000,
        autopilot: autopilot || null,
        timezoneOffset: timezoneOffset || null,
      };
      await storage.updateCampaign(req.params.id, { sendingConfig });
      
      campaignEngine.scheduleCampaign(req.params.id, new Date(scheduledAt), { delayBetweenEmails, sendingConfig });
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
              let sa = stepAnalytics.find((s: any) => s.stepNumber === (step as any).stepNumber);
              // If no step analytics entry exists for this follow-up step, create one
              if (!sa) {
                sa = {
                  stepNumber: (step as any).stepNumber,
                  label: `Step ${(step as any).stepNumber + 1}`,
                  description: null,
                  sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0,
                  openRate: '0', clickRate: '0', replyRate: '0',
                  isPending: true,
                };
                stepAnalytics.push(sa);
              }
              const triggerLabels: Record<string, string> = {
                no_reply: 'If no reply', no_open: 'If no open', no_click: 'If no click',
                opened: 'If opened', clicked: 'If clicked', replied: 'If replied',
                always: 'Always',
              };
              const trigger = triggerLabels[(step as any).trigger] || (step as any).trigger;
              const days = (step as any).delayDays || 0;
              const hours = (step as any).delayHours || 0;
              const minutes = (step as any).delayMinutes || 0;
              const delayParts = [];
              if (days > 0) delayParts.push(`${days} day${days > 1 ? 's' : ''}`);
              if (hours > 0) delayParts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
              if (minutes > 0) delayParts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
              const delayStr = delayParts.length > 0 ? delayParts.join(' ') : 'immediate';
              sa.description = `${trigger} \u2013 ${delayStr}`;
            }
          }
        }
        // Sort step analytics by stepNumber
        stepAnalytics.sort((a: any, b: any) => a.stepNumber - b.stepNumber);
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
        hasActiveFollowups: followupSequences.length > 0 && followupSequences.some((s: any) => s.steps && s.steps.length > 0),
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
            <h2 style="margin: 0 0 8px 0; font-size: 18px;">AImailPilot - Campaign Test Email</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 13px;">This is a preview of your complete email sequence (${emailSteps.length} step${emailSteps.length > 1 ? 's' : ''})</p>
          </div>
          ${combinedHtml}
          <div style="text-align: center; padding: 16px; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; margin-top: 16px;">
            This is a test email sent from AImailPilot. Variables have been replaced with sample data.
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
      const assignedTo = req.query.assignedTo as string;
      const filters = listId ? { listId } : undefined;
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      
      let contacts;
      let total;

      // If admin is filtering by a specific member
      if (isAdmin && assignedTo) {
        if (assignedTo === 'unassigned') {
          // Get unassigned contacts
          const allContacts = await storage.getContacts(req.user.organizationId, 100000, 0, filters);
          contacts = allContacts.filter((c: any) => !c.assignedTo);
          total = contacts.length;
          contacts = contacts.slice(offset, offset + limit);
        } else {
          contacts = search
            ? await storage.searchContactsForUser(req.user.organizationId, assignedTo, search, filters)
            : await storage.getContactsForUser(req.user.organizationId, assignedTo, limit, offset, filters);
          total = await storage.getContactsCountForUser(req.user.organizationId, assignedTo, filters);
        }
      } else if (!isAdmin) {
        // Members only see contacts assigned to them
        contacts = search
          ? await storage.searchContactsForUser(req.user.organizationId, req.user.id, search, filters)
          : await storage.getContactsForUser(req.user.organizationId, req.user.id, limit, offset, filters);
        total = await storage.getContactsCountForUser(req.user.organizationId, req.user.id, filters);
      } else {
        // Admin with no filter — see all org contacts
        contacts = search
          ? await storage.searchContacts(req.user.organizationId, search, filters)
          : await storage.getContacts(req.user.organizationId, limit, offset, filters);
        total = await storage.getContactsCount(req.user.organizationId, filters);
      }

      if (status && status !== 'all') {
        contacts = contacts.filter((c: any) => c.status === status);
      }

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

      // Apollo.io field mapping - recognize common CSV header variations
      const apolloFieldMap: Record<string, string> = {
        'email': 'email', 'e-mail': 'email', 'email address': 'email', 'work email': 'email',
        'first name': 'firstName', 'first': 'firstName', 'firstname': 'firstName', 'first_name': 'firstName',
        'last name': 'lastName', 'last': 'lastName', 'lastname': 'lastName', 'last_name': 'lastName', 'surname': 'lastName',
        'name': '_fullName', 'full name': '_fullName', 'fullname': '_fullName',
        'company': 'company', 'company name': 'company', 'organization': 'company', 'account name': 'company',
        'title': 'jobTitle', 'job title': 'jobTitle', 'jobtitle': 'jobTitle', 'job_title': 'jobTitle', 'position': 'jobTitle', 'designation': 'jobTitle',
        'phone': 'phone', 'phone number': 'phone', 'work phone': 'phone', 'direct phone': 'phone', 'work direct phone': 'phone', 'corporate phone': 'phone',
        'mobile': 'mobilePhone', 'mobile phone': 'mobilePhone', 'cell': 'mobilePhone', 'cell phone': 'mobilePhone', 'other phone': 'mobilePhone',
        'linkedin': 'linkedinUrl', 'linkedin url': 'linkedinUrl', 'linkedin profile': 'linkedinUrl', 'person linkedin url': 'linkedinUrl',
        'company linkedin url': 'companyLinkedinUrl', 'company linkedin': 'companyLinkedinUrl',
        'seniority': 'seniority', 'level': 'seniority', 'management level': 'seniority',
        'department': 'department', 'departments': 'department', 'function': 'department',
        'city': 'city', 'person city': 'city',
        'state': 'state', 'person state': 'state', 'region': 'state',
        'country': 'country', 'person country': 'country',
        'website': 'website', 'company website': 'website', 'url': 'website', 'domain': 'website',
        'industry': 'industry', 'company industry': 'industry',
        'employees': 'employeeCount', '# employees': 'employeeCount', 'employee count': 'employeeCount', 'company size': 'employeeCount', 'number of employees': 'employeeCount', 'headcount': 'employeeCount',
        'annual revenue': 'annualRevenue', 'revenue': 'annualRevenue', 'company revenue': 'annualRevenue',
        'company city': 'companyCity', 'hq city': 'companyCity',
        'company state': 'companyState', 'hq state': 'companyState',
        'company country': 'companyCountry', 'hq country': 'companyCountry',
        'company address': 'companyAddress', 'hq address': 'companyAddress', 'address': 'companyAddress',
        'company phone': 'companyPhone',
        'email status': 'emailStatus', 'email confidence': 'emailStatus',
        'last activity date': 'lastActivityDate', 'last contacted': 'lastActivityDate',
        'lead status': 'status', 'status': 'status', 'stage': 'status',
        'lead score': 'score', 'score': 'score',
        'tags': 'tags', 'labels': 'tags',
        'secondary email': 'secondaryEmail', 'secondary_email': 'secondaryEmail', 'alternate email': 'secondaryEmail', 'other email': 'secondaryEmail', 'personal email': 'secondaryEmail',
        'home phone': 'homePhone', 'home_phone': 'homePhone', 'personal phone': 'homePhone',
        'source': '_source', 'lead source': '_source',
      };

      // List of known direct contact field names (sent by enhanced column mapper)
      const directContactFields = new Set([
        'email', 'firstName', 'lastName', 'company', 'jobTitle',
        'phone', 'mobilePhone', 'linkedinUrl', 'seniority', 'department',
        'city', 'state', 'country', 'website', 'industry',
        'employeeCount', 'annualRevenue', 'companyLinkedinUrl',
        'companyCity', 'companyState', 'companyCountry', 'companyAddress', 'companyPhone',
        'emailStatus', 'lastActivityDate', 'tags', 'status', 'score',
      ]);

      const contactsToCreate = contactList.map((c: any) => {
        const contact: Record<string, any> = {};
        const customFields: Record<string, any> = {};

        for (const [csvHeader, value] of Object.entries(c)) {
          if (!value || String(value).trim() === '') continue;
          const trimmedValue = String(value).trim();

          // Check if key is already a direct contact field name (from enhanced mapper)
          if (directContactFields.has(csvHeader)) {
            if (csvHeader === 'tags') {
              contact.tags = trimmedValue.split(/[,;|]/).map((t: string) => t.trim()).filter(Boolean);
            } else if (csvHeader === 'score') {
              contact.score = parseInt(trimmedValue) || 0;
            } else {
              if (!contact[csvHeader]) contact[csvHeader] = trimmedValue;
            }
            continue;
          }

          const lowerHeader = String(csvHeader).toLowerCase().trim();
          const mappedField = apolloFieldMap[lowerHeader];

          if (mappedField === '_fullName') {
            if (!contact.firstName) {
              const parts = trimmedValue.split(/\s+/);
              contact.firstName = parts[0] || '';
              contact.lastName = parts.slice(1).join(' ') || '';
            }
          } else if (mappedField === 'tags') {
            contact.tags = trimmedValue.split(/[,;|]/).map((t: string) => t.trim()).filter(Boolean);
          } else if (mappedField === 'score') {
            contact.score = parseInt(trimmedValue) || 0;
          } else if (mappedField === '_source') {
            contact.source = trimmedValue;
          } else if (mappedField) {
            if (!contact[mappedField]) contact[mappedField] = trimmedValue;
          } else {
            customFields[csvHeader] = trimmedValue;
          }
        }

        return {
          organizationId: req.user.organizationId,
          email: contact.email || '', firstName: contact.firstName || '', lastName: contact.lastName || '',
          company: contact.company || '', jobTitle: contact.jobTitle || '',
          phone: contact.phone || '', mobilePhone: contact.mobilePhone || '',
          linkedinUrl: contact.linkedinUrl || '', seniority: contact.seniority || '', department: contact.department || '',
          city: contact.city || '', state: contact.state || '', country: contact.country || '',
          website: contact.website || '', industry: contact.industry || '',
          employeeCount: contact.employeeCount || '', annualRevenue: contact.annualRevenue || '',
          companyLinkedinUrl: contact.companyLinkedinUrl || '',
          companyCity: contact.companyCity || '', companyState: contact.companyState || '', companyCountry: contact.companyCountry || '',
          companyAddress: contact.companyAddress || '', companyPhone: contact.companyPhone || '',
          secondaryEmail: contact.secondaryEmail || '', homePhone: contact.homePhone || '',
          emailStatus: contact.emailStatus || '', lastActivityDate: contact.lastActivityDate || '',
          status: contact.status || 'cold', score: contact.score || 0,
          tags: contact.tags || [], source: contact.source || source || 'import',
          listId: targetListId,
          customFields: Object.keys(customFields).length > 0 ? customFields : {},
        };
      }).filter((c: any) => c.email && c.email.includes('@'));

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

  // Quick send email to selected contacts from contact management
  app.post('/api/contacts/send-email', async (req: any, res) => {
    try {
      const { contactIds, emailAccountId, subject, content } = req.body;
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Select at least one contact' });
      }
      if (!emailAccountId) return res.status(400).json({ success: false, error: 'Email account is required' });
      if (!subject || !content) return res.status(400).json({ success: false, error: 'Subject and content are required' });

      const account = await storage.getEmailAccount(emailAccountId) as any;
      if (!account) return res.status(404).json({ success: false, error: 'Email account not found' });

      // Determine sending method: Gmail OAuth or SMTP
      const settings = await storage.getApiSettings(req.user.organizationId);
      const isGmail = account.provider === 'gmail';
      let gmailAccessToken: string | null = null;

      if (isGmail) {
        // Try sender-specific tokens first, then org-wide tokens
        gmailAccessToken = settings[`gmail_sender_${account.email}_access_token`] || settings.gmail_access_token || null;
        const gmailRefreshToken = settings[`gmail_sender_${account.email}_refresh_token`] || settings.gmail_refresh_token;
        const gmailTokenExpiry = settings[`gmail_sender_${account.email}_token_expiry`] || settings.gmail_token_expiry;
        const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID;
        const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET;

        // Refresh token if expired
        if (gmailAccessToken && gmailRefreshToken && gmailTokenExpiry && Date.now() > parseInt(gmailTokenExpiry) - 60000) {
          if (clientId && clientSecret) {
            try {
              const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: gmailRefreshToken, grant_type: 'refresh_token' }),
              });
              if (tokenRes.ok) {
                const tokenData = await tokenRes.json() as any;
                gmailAccessToken = tokenData.access_token;
                const settingPrefix = settings[`gmail_sender_${account.email}_access_token`] ? `gmail_sender_${account.email}` : 'gmail';
                await storage.setApiSetting(req.user.organizationId, `${settingPrefix}_access_token`, gmailAccessToken!);
                if (tokenData.expires_in) {
                  await storage.setApiSetting(req.user.organizationId, `${settingPrefix}_token_expiry`, String(Date.now() + tokenData.expires_in * 1000));
                }
              }
            } catch (e) { console.error('[QuickSend] Token refresh error:', e); }
          }
        }
      }

      // Fetch all contacts
      const results: { email: string; success: boolean; error?: string }[] = [];
      let sent = 0;
      let failed = 0;

      for (const contactId of contactIds) {
        try {
          const contact = await storage.getContact(contactId) as any;
          if (!contact || !contact.email) {
            results.push({ email: contactId, success: false, error: 'Contact not found' });
            failed++;
            continue;
          }

          // Personalize content
          const data: Record<string, string> = {
            firstName: contact.firstName || '', lastName: contact.lastName || '',
            email: contact.email, company: contact.company || '', jobTitle: contact.jobTitle || '',
            fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          };
          const pSubject = subject.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => data[key] || `{{${key}}}`);
          const pContent = content.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => data[key] || `{{${key}}}`);

          if (isGmail && gmailAccessToken) {
            // Send via Gmail API
            const rawEmail = createRawEmail({ from: account.email, to: contact.email, subject: pSubject, body: pContent });
            const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${gmailAccessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw: rawEmail }),
            });
            if (gmailRes.ok) {
              results.push({ email: contact.email, success: true });
              sent++;
            } else {
              const errText = await gmailRes.text();
              results.push({ email: contact.email, success: false, error: `Gmail API error: ${gmailRes.status}` });
              failed++;
              console.error(`[QuickSend] Gmail error for ${contact.email}:`, errText.slice(0, 200));
            }
          } else if (account.smtpConfig) {
            // Send via SMTP
            const result = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
              to: contact.email, subject: pSubject, html: pContent,
            });
            if (result.success) { sent++; } else { failed++; }
            results.push({ email: contact.email, ...result });
          } else {
            results.push({ email: contact.email, success: false, error: 'No sending method configured' });
            failed++;
          }

          // Small delay between sends
          if (contactIds.length > 1) await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : 'Unknown error';
          results.push({ email: contactId, success: false, error: errMsg });
          failed++;
        }
      }

      res.json({ success: true, sent, failed, total: contactIds.length, results });
    } catch (error) {
      console.error('[QuickSend] Error:', error);
      res.status(500).json({ success: false, error: 'Failed to send emails' });
    }
  });

  // AI-powered column mapping using Azure OpenAI
  app.post('/api/contacts/ai-map-columns', async (req: any, res) => {
    try {
      const { csvHeaders, sampleRows } = req.body;
      if (!Array.isArray(csvHeaders) || csvHeaders.length === 0) {
        return res.status(400).json({ message: 'csvHeaders array is required' });
      }

      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.status(400).json({ 
          success: false, 
          message: 'Azure OpenAI is not configured. Go to Advanced Settings to set up Azure OpenAI.' 
        });
      }

      const contactFields = [
        { field: 'email', description: 'Email address' },
        { field: 'firstName', description: 'First name / given name' },
        { field: 'lastName', description: 'Last name / surname / family name' },
        { field: 'company', description: 'Company name / organization' },
        { field: 'jobTitle', description: 'Job title / position / role / designation' },
        { field: 'phone', description: 'Work phone / direct phone number' },
        { field: 'mobilePhone', description: 'Mobile / cell phone number' },
        { field: 'linkedinUrl', description: 'Personal LinkedIn profile URL' },
        { field: 'seniority', description: 'Seniority level (e.g., VP, Director, Manager)' },
        { field: 'department', description: 'Department or function' },
        { field: 'city', description: 'Person city' },
        { field: 'state', description: 'Person state / region / province' },
        { field: 'country', description: 'Person country' },
        { field: 'website', description: 'Website / domain URL' },
        { field: 'industry', description: 'Company industry / sector' },
        { field: 'employeeCount', description: 'Number of employees / company size / headcount' },
        { field: 'annualRevenue', description: 'Annual revenue / company revenue' },
        { field: 'companyLinkedinUrl', description: 'Company LinkedIn URL' },
        { field: 'companyCity', description: 'Company HQ city' },
        { field: 'companyState', description: 'Company HQ state' },
        { field: 'companyCountry', description: 'Company HQ country' },
        { field: 'companyAddress', description: 'Company address / HQ address' },
        { field: 'companyPhone', description: 'Company phone number' },
        { field: 'secondaryEmail', description: 'Secondary / alternate / personal email address' },
        { field: 'homePhone', description: 'Home phone / personal phone number' },
        { field: 'emailStatus', description: 'Email verification status / confidence' },
        { field: 'lastActivityDate', description: 'Last activity / last contacted date' },
        { field: 'tags', description: 'Tags / labels' },
        { field: 'status', description: 'Lead status / stage (hot, warm, cold)' },
        { field: 'score', description: 'Lead score / contact score' },
      ];

      const sampleDataStr = sampleRows && sampleRows.length > 0
        ? `\n\nSample data (first ${sampleRows.length} rows):\n${sampleRows.map((row: Record<string, string>, i: number) => 
            `Row ${i+1}: ${csvHeaders.map(h => `${h}="${row[h] || ''}"`).join(', ')}`
          ).join('\n')}`
        : '';

      const prompt = `You are a data mapping assistant. Given CSV column headers and available contact fields, suggest the best mapping.

CSV Headers: ${JSON.stringify(csvHeaders)}${sampleDataStr}

Available contact fields:
${contactFields.map(f => `- "${f.field}": ${f.description}`).join('\n')}

Return ONLY a valid JSON object mapping contact field names to CSV header names. Only include mappings where you are confident the CSV header corresponds to the contact field. If a CSV header does not clearly match any field, do not include it. The keys should be contact field names and values should be exact CSV header names from the list above.

Example response:
{"email": "Email Address", "firstName": "First Name", "company": "Organization"}`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a precise data mapping assistant. Respond only with a valid JSON object.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[AI Map] Azure OpenAI error:', errText);
        return res.json({ success: false, message: `Azure OpenAI error: ${response.status}` });
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse the JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ success: false, message: 'AI could not generate a mapping', raw: content });
      }

      const mapping = JSON.parse(jsonMatch[0]);
      
      // Validate that all values are actual CSV headers and all keys are valid fields
      const validFields = new Set(contactFields.map(f => f.field));
      const headerSet = new Set(csvHeaders);
      const cleanMapping: Record<string, string> = {};
      for (const [field, header] of Object.entries(mapping)) {
        if (validFields.has(field) && headerSet.has(header as string)) {
          cleanMapping[field] = header as string;
        }
      }

      res.json({ success: true, mapping: cleanMapping });
    } catch (error) {
      console.error('[AI Map] Error:', error);
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      res.json({ success: false, message: `AI mapping failed: ${errMsg}` });
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

  // ========== LEAD ALLOCATION (CRM) ==========
  
  // Assign contacts to a team member (admin/owner only)
  app.post('/api/contacts/assign', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Only admins can assign leads' });
      
      const { contactIds, userId } = req.body;
      if (!Array.isArray(contactIds) || !userId) return res.status(400).json({ message: 'contactIds array and userId required' });
      
      // Verify the target user is a member of this org
      const membership = await storage.getOrgMember(req.user.organizationId, userId);
      if (!membership) return res.status(400).json({ message: 'Target user is not a member of this organization' });
      
      const count = await storage.assignContactsToUser(contactIds, userId, req.user.organizationId);
      res.json({ success: true, assigned: count });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign contacts' });
    }
  });

  // Unassign contacts (admin/owner only)
  app.post('/api/contacts/unassign', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Only admins can unassign leads' });
      
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds)) return res.status(400).json({ message: 'contactIds array required' });
      
      const count = await storage.unassignContacts(contactIds, req.user.organizationId);
      res.json({ success: true, unassigned: count });
    } catch (error) {
      res.status(500).json({ message: 'Failed to unassign contacts' });
    }
  });

  // Bulk auto-assign: distribute unassigned contacts evenly among members
  app.post('/api/contacts/auto-assign', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Only admins can auto-assign leads' });
      
      const { memberIds } = req.body;
      if (!Array.isArray(memberIds) || memberIds.length === 0) return res.status(400).json({ message: 'memberIds array required' });
      
      // Get all unassigned contacts
      const allContacts = await storage.getContacts(req.user.organizationId, 100000, 0);
      const unassigned = allContacts.filter((c: any) => !c.assignedTo);
      
      if (unassigned.length === 0) return res.json({ success: true, assigned: 0, message: 'No unassigned contacts' });
      
      // Round-robin distribute
      let assigned = 0;
      for (let i = 0; i < unassigned.length; i++) {
        const targetMemberId = memberIds[i % memberIds.length];
        await storage.assignContactsToUser([unassigned[i].id], targetMemberId, req.user.organizationId);
        assigned++;
      }
      
      res.json({ success: true, assigned, perMember: Math.ceil(unassigned.length / memberIds.length) });
    } catch (error) {
      res.status(500).json({ message: 'Failed to auto-assign contacts' });
    }
  });

  // Get assignment stats
  app.get('/api/contacts/assignment-stats', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Admin access required' });
      
      const stats = await storage.getAssignmentStats(req.user.organizationId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get assignment stats' });
    }
  });

  // ========== EMAIL RATING ==========

  // Calculate rating for a single contact
  app.post('/api/contacts/:id/rating', async (req: any, res) => {
    try {
      const { useAI } = req.body || {};
      const result = await calculateContactRating(req.params.id, {
        useAI: useAI !== false,
        organizationId: req.user.organizationId,
      });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: `Failed to calculate rating: ${msg}` });
    }
  });

  // Get engagement stats for a contact (without recalculating)
  app.get('/api/contacts/:id/engagement', async (req: any, res) => {
    try {
      const stats = await storage.getContactEngagementStats(req.params.id);
      const contact = await storage.getContact(req.params.id);
      res.json({
        ...stats,
        emailRating: (contact as any)?.emailRating || 0,
        emailRatingGrade: (contact as any)?.emailRatingGrade || '',
        emailRatingDetails: (contact as any)?.emailRatingDetails || {},
        emailRatingUpdatedAt: (contact as any)?.emailRatingUpdatedAt || null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch engagement stats' });
    }
  });

  // Batch recalculate ratings for all contacts
  app.post('/api/contacts/batch-rating', async (req: any, res) => {
    try {
      const { useAI } = req.body || {};
      const result = await batchRecalculateRatings(req.user.organizationId, { useAI });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ message: 'Failed to batch recalculate ratings' });
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

  // Helper: enrich templates with creator info and performance scores
  async function enrichTemplatesWithScores(templates: any[], organizationId: string, storage: any) {
    const spamWords = ['free', 'urgent', 'act now', 'limited time', 'guaranteed', 'no obligation', 'risk free', 'click here', 'buy now', 'order now', 'winner', 'congratulations', 'earn money', 'make money', 'cash', 'discount', '100%', 'double your', 'million', 'billion'];
    const campaigns = await storage.getCampaigns(organizationId);
    
    return Promise.all(templates.map(async (t: any) => {
      let creator = null;
      if (t.createdBy) {
        try {
          const user = await storage.getUser(t.createdBy);
          if (user) {
            creator = {
              id: user.id,
              email: user.email,
              firstName: (user as any).firstName || '',
              lastName: (user as any).lastName || '',
              name: (user as any).name || (user as any).firstName || user.email?.split('@')[0] || 'Unknown',
            };
          }
        } catch (e) { /* ignore */ }
      }

      let score = { total: 0, openRate: 0, replyRate: 0, clickRate: 0, spamScore: 0, campaignsUsed: 0, grade: 'N/A' as string };
      try {
        const matchingCampaigns = campaigns.filter((c: any) =>
          c.templateId === t.id || (c.subject === t.subject && c.content === t.content)
        );
        if (matchingCampaigns.length > 0) {
          let totalSent = 0, totalOpened = 0, totalReplied = 0, totalClicked = 0;
          for (const camp of matchingCampaigns) {
            totalSent += (camp as any).totalRecipients || (camp as any).sentCount || 0;
            totalOpened += (camp as any).openedCount || 0;
            totalReplied += (camp as any).repliedCount || 0;
            totalClicked += (camp as any).clickedCount || 0;
          }
          score.campaignsUsed = matchingCampaigns.length;
          score.openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
          score.replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;
          score.clickRate = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0;
        }
        const contentLower = ((t.content || '') + ' ' + (t.subject || '')).toLowerCase();
        const spamHits = spamWords.filter(w => contentLower.includes(w));
        score.spamScore = Math.min(spamHits.length * 10, 100);
        if (score.campaignsUsed > 0) {
          const spamPenalty = Math.max(0, 100 - score.spamScore);
          score.total = Math.round((score.openRate * 0.3) + (score.replyRate * 0.4) + (score.clickRate * 0.1) + (spamPenalty * 0.2));
          score.grade = score.total >= 80 ? 'A' : score.total >= 60 ? 'B' : score.total >= 40 ? 'C' : score.total >= 20 ? 'D' : 'F';
        } else if (score.spamScore > 0) {
          score.total = Math.max(0, 100 - score.spamScore);
          score.grade = score.spamScore === 0 ? '—' : score.spamScore <= 20 ? 'B' : score.spamScore <= 50 ? 'C' : 'D';
        }
      } catch (e) { /* ignore */ }

      return { ...t, creator, score };
    }));
  }

  app.get('/api/templates', async (req: any, res) => {
    try {
      const templates = await storage.getEmailTemplates(req.user.organizationId);
      const enriched = await enrichTemplatesWithScores(templates, req.user.organizationId, storage);
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch templates' });
    }
  });

  // Get user's own templates
  app.get('/api/templates/mine', async (req: any, res) => {
    try {
      const templates = await storage.getEmailTemplatesByUser(req.user.organizationId, req.user.id);
      const enriched = await enrichTemplatesWithScores(templates, req.user.organizationId, storage);
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch your templates' });
    }
  });

  // Get team templates (other users' templates in same org)
  app.get('/api/templates/team', async (req: any, res) => {
    try {
      const templates = await storage.getEmailTemplatesExcludingUser(req.user.organizationId, req.user.id);
      const enriched = await enrichTemplatesWithScores(templates, req.user.organizationId, storage);
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch team templates' });
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
      const userAgent = req.headers['user-agent'] || '';
      
      const message = await storage.getCampaignMessageByTracking(trackingId);
      
      if (message) {
        // ========== Smart open tracking with proxy detection ==========
        // Gmail, Outlook etc. ALWAYS proxy images through their servers.
        // Gmail uses GoogleImageProxy for BOTH prefetch AND real opens.
        // We use a time-based heuristic:
        //   - Hits within 90s of sentAt = likely prefetch (email delivery scan)
        //   - Hits after 90s = likely a real user open
        // Non-proxy user agents are always treated as real opens.
        
        const gmailProxyPattern = /GoogleImageProxy|via ggpht\.com/i;
        const botPatterns = [
          /Google-SMTP-STS/i,
          /Windows-RSS-Platform/i,
          /YahooMailProxy/i,
          /YahooSeeker/i,
          /Chrome\/42\.0\.2311.*Edge\/12/i, // Known bot/scanner UA
          /^Mozilla\/4\.0\s*$/,
          /^$/,
        ];
        
        const isGmailProxy = gmailProxyPattern.test(userAgent);
        const isBot = botPatterns.some(p => p.test(userAgent));
        
        // Calculate seconds since email was sent
        const sentTime = message.sentAt ? new Date(message.sentAt).getTime() : 0;
        const now = Date.now();
        const secondsSinceSent = sentTime > 0 ? (now - sentTime) / 1000 : 9999;
        
        // Decision logic:
        // - Pure bots (not Gmail proxy) → always prefetch
        // - Gmail proxy within 90s of send → likely prefetch
        // - Gmail proxy after 90s → real open (Gmail always proxies, this IS the user viewing)
        // - Normal browser UA → real open
        const isPrefetch = isBot || (isGmailProxy && secondsSinceSent < 90);
        
        if (isPrefetch) {
          // Pre-fetch / bot - log but don't count
          await storage.createTrackingEvent({
            type: 'prefetch',
            campaignId: message.campaignId,
            messageId: message.id,
            contactId: message.contactId,
            trackingId,
            stepNumber: message.stepNumber || 0,
            userAgent,
            ip: req.ip,
            metadata: JSON.stringify({ filtered: true, reason: isBot ? 'bot' : 'gmail_prefetch', secondsSinceSent: Math.round(secondsSinceSent) }),
          });
        } else {
          // Check for rapid-fire duplicate opens (same message, same UA within 30 seconds)
          // Gmail image proxy often hits the tracking pixel multiple times in quick succession
          const recentEvents = await storage.getRecentTrackingEvents(message.id, 'open', 30);
          const isDuplicate = recentEvents.length > 0;
          
          if (isDuplicate) {
            // Still log the event but mark as duplicate — don't increment counts
            await storage.createTrackingEvent({
              type: 'open',
              campaignId: message.campaignId,
              messageId: message.id,
              contactId: message.contactId,
              trackingId,
              stepNumber: message.stepNumber || 0,
              userAgent,
              ip: req.ip,
              metadata: JSON.stringify({ duplicate: true, secondsSinceLast: Math.round((Date.now() - new Date(recentEvents[0].createdAt).getTime()) / 1000) }),
            });
          } else {
            // Real unique open (either normal browser or Gmail proxy after delay)
            await storage.createTrackingEvent({
              type: 'open',
              campaignId: message.campaignId,
              messageId: message.id,
              contactId: message.contactId,
              trackingId,
              stepNumber: message.stepNumber || 0,
              userAgent,
              ip: req.ip,
            });

            // Only increment campaign count on first real open
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
        }
      }
    } catch (error) {
      console.error('Tracking error:', error);
    }

    // Return 1x1 transparent GIF — with aggressive anti-caching headers
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate, private, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
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
          stepNumber: message.stepNumber || 0,
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
    const totalQuota = accounts.reduce((sum: number, a: any) => sum + (a.dailyLimit || getProviderDailyLimit(a.provider)), 0) || 500;
    const sessionUser = (req.session as any)?.user;
    
    res.json({
      name: sessionUser?.name || req.user.name || 'AImailPilot User',
      email: sessionUser?.email || req.user.email || 'user@aimailpilot.com',
      picture: sessionUser?.picture || '',
      provider: sessionUser?.provider || 'google',
      quota: { used: 0, total: totalQuota, resetsAt: 'Tomorrow at 12:00 AM' },
      billing: { plan: 'AImailPilot Pro', isEducation: false, members: 'Invite teammates to join' },
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

      // Convert delayValue + delayUnit to delayDays + delayHours + delayMinutes
      let delayDays = 0;
      let delayHours = 0;
      let delayMinutes = 0;
      const val = parseInt(delayValue) || 0;
      switch (delayUnit) {
        case 'minutes': delayMinutes = val; break;
        case 'hours': delayHours = val; break;
        case 'days': delayDays = val; break;
        case 'weeks': delayDays = val * 7; break;
        default: delayDays = val; break;
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
        description: `Auto-created follow-up: ${mappedTrigger} after ${delayDays}d ${delayHours}h ${delayMinutes}m`,
        createdBy: req.user.id,
      });

      // Create the follow-up step
      const step = await storage.createFollowupStep({
        sequenceId: (sequence as any).id,
        stepNumber: stepOrder || 1,
        trigger: mappedTrigger,
        delayDays,
        delayHours,
        delayMinutes,
        subject: subject || '',
        content: content || '',
      });

      // Link the campaign to this sequence
      if (campaignId) {
        await storage.createCampaignFollowup({
          campaignId,
          sequenceId: (sequence as any).id,
        });
        console.log(`[Followup] Created sequence "${seqName}" for campaign ${campaignId}: ${mappedTrigger} after ${delayDays}d ${delayHours}h ${delayMinutes}m`);
      }

      res.status(201).json({
        ...(sequence as any),
        step,
        campaignId,
        trigger: mappedTrigger,
        delayDays,
        delayHours,
        delayMinutes,
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
      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
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

  // Check Azure OpenAI configuration status for the current organization
  app.get('/api/llm/status', async (req: any, res) => {
    try {
      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const configured = !!(endpoint && apiKey && deploymentName);
      res.json({
        configured,
        provider: configured ? 'azure-openai' : 'demo',
        endpoint: endpoint ? endpoint.replace(/\/[^/]*$/, '/***') : null,
        deployment: deploymentName || null,
        organizationId: req.user.organizationId,
      });
    } catch (error) {
      res.json({ configured: false, provider: 'demo', error: 'Failed to check configuration' });
    }
  });

  app.post('/api/llm/generate', async (req: any, res) => {
    try {
      const { prompt, type, context, format } = req.body;
      // format: 'text' | 'html' | 'both' (default 'html')
      const emailFormat = format || 'html';

      // Try to use Azure OpenAI if configured
      const orgId = req.user.organizationId;
      console.log(`[LLM] Generate request for org: ${orgId}, user: ${req.user.email}, type: ${type || 'default'}, format: ${emailFormat}`);
      const settings = await storage.getApiSettingsWithAzureFallback(orgId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        console.log(`[LLM] Azure OpenAI NOT configured for org ${orgId}. endpoint=${!!endpoint}, apiKey=${!!apiKey}, deployment=${!!deploymentName}. Falling back to demo.`);
      }

      if (endpoint && apiKey && deploymentName) {
        // Build format instructions
        const formatInstructions: Record<string, string> = {
          text: 'Return ONLY plain text content. No HTML tags at all. Use line breaks for formatting.',
          html: 'Return the content as well-formatted HTML email markup with proper tags (<p>, <strong>, <a>, <ul>, etc). Do NOT include <html>, <head>, or <body> wrappers.',
          both: 'Return BOTH versions separated by the marker ===TEXT_VERSION=== and ===HTML_VERSION===. First output ===TEXT_VERSION=== followed by the plain text version (no HTML tags). Then output ===HTML_VERSION=== followed by the HTML version (with proper tags like <p>, <strong>, <a>). Do NOT include <html>, <head>, or <body> wrappers in the HTML version.',
        };
        const formatSuffix = formatInstructions[emailFormat] || formatInstructions.html;

        // Use Azure OpenAI
        const systemPrompts: Record<string, string> = {
          template: `You are an expert email marketing copywriter. Generate professional email templates with personalization variables like {{firstName}}, {{company}}, {{jobTitle}}. ${formatSuffix}`,
          campaign: `You are an expert email campaign strategist. Generate compelling campaign email content that drives engagement. Use personalization variables like {{firstName}}, {{company}}. ${formatSuffix}`,
          personalize: `You are an AI email personalization expert. Take the provided template and personalize it for the specific recipient. Make it feel custom-written while maintaining the core message. ${formatSuffix}`,
          subject: 'You are an email subject line expert. Generate 3-5 compelling subject line options. Return them as a numbered list.',
          reply: `You are a professional email assistant. Generate an appropriate, contextual reply to the provided email. ${formatSuffix}`,
          default: `You are an expert email marketing copywriter. Generate personalized, professional email content that drives engagement and responses. ${formatSuffix}`,
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
          const rawContent = data?.choices?.[0]?.message?.content || '';
          
          // Parse 'both' format: split into text and html versions
          if (emailFormat === 'both' && rawContent.includes('===TEXT_VERSION===')) {
            const textMatch = rawContent.match(/===TEXT_VERSION===\s*([\s\S]*?)(?====HTML_VERSION===)/);
            const htmlMatch = rawContent.match(/===HTML_VERSION===\s*([\s\S]*?)$/);
            return res.json({
              content: htmlMatch ? htmlMatch[1].trim() : rawContent,
              textContent: textMatch ? textMatch[1].trim() : rawContent.replace(/<[^>]+>/g, ''),
              htmlContent: htmlMatch ? htmlMatch[1].trim() : rawContent,
              format: 'both',
              model: data?.model || deploymentName,
              tokens: data?.usage?.total_tokens || 0,
              provider: 'azure-openai',
            });
          }
          
          return res.json({
            content: rawContent,
            format: emailFormat,
            model: data?.model || deploymentName,
            tokens: data?.usage?.total_tokens || 0,
            provider: 'azure-openai',
          });
        }
        
        // If Azure fails, fall through to demo
        console.error('Azure OpenAI generation failed:', response.status, await response.text());
      }

      // Fallback: demo response
      const demoText = `Hi {{firstName}},\n\nI hope this message finds you well. I wanted to reach out regarding ${prompt || 'our recent discussion'}.\n\nI'd love to schedule a quick call to discuss further. Would you have 15 minutes this week?\n\nBest regards,\nThe AImailPilot Team`;
      const demoHtml = `<p>Hi {{firstName}},</p>\n<p>I hope this message finds you well. I wanted to reach out regarding ${prompt || 'our recent discussion'}.</p>\n<p>I'd love to schedule a quick call to discuss further. Would you have 15 minutes this week?</p>\n<p>Best regards,<br/>The AImailPilot Team</p>`;
      
      const demoResponse: any = {
        model: 'demo',
        tokens: 150,
        provider: 'demo',
        format: emailFormat,
        note: 'Azure OpenAI is not configured for your current organization. Go to Advanced Settings to configure Azure OpenAI endpoint, API key, and deployment name.',
        organizationId: orgId,
      };
      
      if (emailFormat === 'both') {
        demoResponse.content = demoHtml;
        demoResponse.textContent = demoText;
        demoResponse.htmlContent = demoHtml;
      } else if (emailFormat === 'text') {
        demoResponse.content = demoText;
      } else {
        demoResponse.content = demoHtml;
      }
      
      res.json(demoResponse);
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

      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
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

  // Helper: Get a valid Google access token for the user's organization
  // Refreshes the token automatically if expired
  async function getGoogleAccessToken(organizationId: string): Promise<string | null> {
    try {
      const settings = await storage.getApiSettings(organizationId);
      let clientId = settings.google_oauth_client_id || '';
      let clientSecret = settings.google_oauth_client_secret || '';

      // If no OAuth credentials in user's org, try superadmin's org, then env vars
      if (!clientId || !clientSecret) {
        try {
          const superAdminOrgId = await storage.getSuperAdminOrgId();
          if (superAdminOrgId && superAdminOrgId !== organizationId) {
            const superSettings = await storage.getApiSettings(superAdminOrgId);
            if (superSettings.google_oauth_client_id) {
              clientId = superSettings.google_oauth_client_id;
              clientSecret = superSettings.google_oauth_client_secret || '';
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (!clientId) clientId = process.env.GOOGLE_CLIENT_ID || '';
      if (!clientSecret) clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

      // Collect ALL available token pairs (org-level + per-sender) and try the freshest first
      const tokenCandidates: { accessToken: string; refreshToken: string; tokenExpiry: string; label: string }[] = [];

      // Org-level tokens first
      if (settings.gmail_access_token && settings.gmail_refresh_token) {
        tokenCandidates.push({
          accessToken: settings.gmail_access_token,
          refreshToken: settings.gmail_refresh_token,
          tokenExpiry: settings.gmail_token_expiry || '0',
          label: 'org-level',
        });
      }

      // Per-sender tokens
      const allKeys = Object.keys(settings);
      const senderTokenKeys = allKeys.filter(k => k.startsWith('gmail_sender_') && k.endsWith('_access_token'));
      for (const key of senderTokenKeys) {
        const email = key.replace('gmail_sender_', '').replace('_access_token', '');
        const senderAccess = settings[key];
        const senderRefresh = settings[`gmail_sender_${email}_refresh_token`];
        if (senderAccess && senderRefresh) {
          // Don't duplicate if same as org-level
          if (senderAccess !== settings.gmail_access_token || senderRefresh !== settings.gmail_refresh_token) {
            tokenCandidates.push({
              accessToken: senderAccess,
              refreshToken: senderRefresh,
              tokenExpiry: settings[`gmail_sender_${email}_token_expiry`] || '0',
              label: `sender:${email}`,
            });
          }
        }
      }

      if (tokenCandidates.length === 0) return null;

      // Sort by expiry (freshest first - highest expiry = newest token)
      tokenCandidates.sort((a, b) => parseInt(b.tokenExpiry || '0') - parseInt(a.tokenExpiry || '0'));

      // Try each token pair until one works
      for (const candidate of tokenCandidates) {
        let { accessToken, refreshToken, tokenExpiry } = candidate;

        // Check if token is expired (with 5 min buffer)
        const isExpired = tokenExpiry && Date.now() > parseInt(tokenExpiry) - 5 * 60 * 1000;
        if (isExpired) {
          if (!clientId || !clientSecret) continue;
          console.log(`[GoogleAuth] Token expired for ${candidate.label}, refreshing...`);
          try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
              }),
            });
            if (tokenRes.ok) {
              const tokenData = await tokenRes.json() as any;
              accessToken = tokenData.access_token;
              // Store refreshed token back at org level
              await storage.setApiSetting(organizationId, 'gmail_access_token', accessToken!);
              if (tokenData.expires_in) {
                await storage.setApiSetting(organizationId, 'gmail_token_expiry', String(Date.now() + tokenData.expires_in * 1000));
              }
              console.log(`[GoogleAuth] Token refreshed successfully from ${candidate.label}`);
              return accessToken || null;
            } else {
              console.error(`[GoogleAuth] Token refresh failed for ${candidate.label}:`, tokenRes.status);
              continue; // Try next candidate
            }
          } catch (e) {
            console.error(`[GoogleAuth] Token refresh error for ${candidate.label}:`, e);
            continue;
          }
        }

        // Token is still valid
        return accessToken || null;
      }

      return null;
    } catch (e) {
      console.error('[GoogleAuth] Error getting access token:', e);
      return null;
    }
  }

  // Diagnostic endpoint: check what scopes the current Google token has
  app.get('/api/debug/google-token', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const accessToken = await getGoogleAccessToken(req.user.organizationId);
      if (!accessToken) {
        return res.json({ error: 'No access token available', hasRefresh: !!settings.gmail_refresh_token });
      }
      // Check token info using Google's tokeninfo endpoint
      const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      const tokenInfo = await tokenInfoRes.json() as any;
      return res.json({
        scope: tokenInfo.scope || 'unknown',
        email: tokenInfo.email || 'unknown',
        expires_in: tokenInfo.expires_in,
        hasSpreadsheetScope: (tokenInfo.scope || '').includes('spreadsheets'),
        hasGmailSendScope: (tokenInfo.scope || '').includes('gmail.send'),
        orgLevelToken: !!settings.gmail_access_token,
        orgLevelRefresh: !!settings.gmail_refresh_token,
        orgLevelExpiry: settings.gmail_token_expiry ? new Date(parseInt(settings.gmail_token_expiry)).toISOString() : null,
      });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  // Fetch spreadsheet info (sheet names) using Google Sheets API v4 with OAuth, fallback to public CSV export
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

      // Strategy 1: Try Google Sheets API v4 with user's OAuth token
      const accessToken = await getGoogleAccessToken(req.user.organizationId);
      console.log('[sheets/fetch-info] Got access token:', accessToken ? 'yes (length=' + accessToken.length + ')' : 'no');
      if (accessToken) {
        try {
          // First verify the token has spreadsheet scope
          const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
          const tokenInfo = await tokenInfoRes.json() as any;
          const hasSheetScope = (tokenInfo.scope || '').includes('spreadsheets');
          console.log('[sheets/fetch-info] Token scopes:', tokenInfo.scope || 'unknown', '| has spreadsheet scope:', hasSheetScope);
          
          if (!hasSheetScope) {
            console.log('[sheets/fetch-info] Token lacks spreadsheet scope. Need re-auth with consent.');
            // Clear the stale tokens so user is forced to re-auth properly
            await storage.setApiSetting(req.user.organizationId, 'gmail_access_token', '');
            await storage.setApiSetting(req.user.organizationId, 'gmail_token_expiry', '0');
            return res.json({ 
              valid: false, 
              error: 'Google Sheets permission not granted. Please go to Email Accounts > Connect Gmail to re-authenticate with Google (this will grant Sheets access).',
              needsReauth: true 
            });
          }

          const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`;
          const apiRes = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          
          if (apiRes.ok) {
            const data = await apiRes.json() as any;
            const sheets = (data.sheets || []).map((s: any) => ({
              id: s.properties?.sheetId ?? 0,
              name: s.properties?.title || 'Sheet1',
              index: s.properties?.index ?? 0,
            }));
            
            console.log('[sheets/fetch-info] Google Sheets API success, found', sheets.length, 'sheets');
            return res.json({
              id: spreadsheetId,
              title: data.properties?.title || 'Google Spreadsheet',
              sheets,
              valid: true,
              method: 'oauth',
            });
          } else {
            const errText = await apiRes.text();
            console.log('[sheets/fetch-info] Google Sheets API returned', apiRes.status, '- falling back to public CSV. Error:', errText.slice(0, 200));
            // If 403 with insufficient scopes or permission denied, give specific guidance
            if (apiRes.status === 403) {
              if (errText.includes('insufficient') || errText.includes('PERMISSION_DENIED') || errText.includes('Request had insufficient authentication scopes')) {
                // OAuth token lacks spreadsheets scope - need re-auth
                return res.json({ 
                  valid: false, 
                  error: 'Google Sheets permission not granted. Please go to Email Accounts > Connect Gmail to re-authenticate with Google (this will grant Sheets access).',
                  needsReauth: true 
                });
              }
            }
            if (apiRes.status === 404) {
              return res.json({
                valid: false,
                error: 'Spreadsheet not found. Please check the URL is correct and you have access to this sheet.'
              });
            }
          }
        } catch (apiErr) {
          console.log('[sheets/fetch-info] Google Sheets API error, falling back to public CSV:', apiErr);
        }
      }

      // Strategy 2: Fallback to public CSV export (for publicly shared sheets)
      const sheets: { id: number; name: string; index: number }[] = [];

      const testCsvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      console.log('[sheets/fetch-info] Trying public CSV access:', testCsvUrl);
      
      const testRes = await fetch(testCsvUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        redirect: 'follow',
      });

      if (!testRes.ok) {
        const hint = accessToken 
          ? 'Cannot access this spreadsheet. Your Google account may not have permission. Try re-authenticating: go to Email Accounts and click "Connect Gmail" to refresh your Google access.'
          : 'Cannot access this spreadsheet. Please connect a Gmail account first (Email Accounts > Connect Gmail), or make sure the sheet is shared with "Anyone with the link".';
        return res.status(400).json({ valid: false, error: hint, needsAuth: !accessToken });
      }

      const testCsv = await testRes.text();
      if (testCsv.trim().startsWith('<!DOCTYPE') || testCsv.trim().startsWith('<html')) {
        return res.status(400).json({ 
          valid: false, 
          error: 'Cannot access this spreadsheet. Please connect a Gmail account (Email Accounts > Connect Gmail), or share the sheet with "Anyone with the link".', 
          needsAuth: !accessToken 
        });
      }

      sheets.push({ id: 0, name: 'Sheet1', index: 0 });

      // Try to discover additional sheets by probing common gids
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

      console.log('[sheets/fetch-info] Public CSV found sheets:', JSON.stringify(sheets));
      
      return res.json({
        id: spreadsheetId,
        title: 'Google Spreadsheet',
        sheets,
        valid: true,
        method: 'public',
      });
    })().catch((error) => {
      console.error('[sheets/fetch-info] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ valid: false, error: 'Failed to fetch spreadsheet information. Please check the URL and sharing settings.' });
      }
    });
  });

  // Fetch sheet data (actual rows) using Google Sheets API v4 with OAuth, fallback to public CSV
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

      let headers: string[] = [];
      let dataRows: string[][] = [];

      // Strategy 1: Try Google Sheets API v4 with OAuth
      const accessToken = await getGoogleAccessToken(req.user.organizationId);
      let usedOAuth = false;
      
      if (accessToken) {
        try {
          // Use the sheet name for range, default to first sheet
          const range = sheetName ? encodeURIComponent(sheetName) : 'Sheet1';
          const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
          const apiRes = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          
          if (apiRes.ok) {
            const data = await apiRes.json() as any;
            const allRows: string[][] = (data.values || []).map((row: any[]) => row.map(String));
            if (allRows.length > 0) {
              headers = allRows[0];
              dataRows = allRows.slice(1);
              usedOAuth = true;
              console.log('[sheets/fetch-data] Google Sheets API success:', headers.length, 'cols,', dataRows.length, 'rows');
            }
          } else {
            const errText = await apiRes.text();
            console.log('[sheets/fetch-data] Sheets API returned', apiRes.status, '- falling back to CSV. Error:', errText.slice(0, 200));
          }
        } catch (apiErr) {
          console.log('[sheets/fetch-data] Sheets API error, falling back to CSV:', apiErr);
        }
      }

      // Strategy 2: Fallback to public CSV export
      if (!usedOAuth) {
        const sheetGid = gid !== undefined ? gid : 0;
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheetGid}`;
        console.log('[sheets/fetch-data] Trying public CSV:', csvUrl);
        
        const csvRes = await fetch(csvUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          redirect: 'follow',
        });

        if (!csvRes.ok) {
          const hint = accessToken
            ? 'Cannot access sheet data. Your Google account may not have permission. Try re-authenticating via Email Accounts > Connect Gmail.'
            : 'Cannot access sheet data. Please connect a Gmail account first (Email Accounts > Connect Gmail), or share the sheet with "Anyone with the link".';
          return res.status(400).json({ error: hint });
        }

        const csvText = await csvRes.text();
        if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
          return res.status(400).json({ error: 'Cannot access this spreadsheet. Please connect a Gmail account (Email Accounts > Connect Gmail), or share the sheet with "Anyone with the link".' });
        }

        const rows = parseCSV(csvText);
        if (rows.length > 0) {
          headers = rows[0];
          dataRows = rows.slice(1);
        }
      }

      if (headers.length === 0) {
        return res.json({ headers: [], values: [], contacts: [], totalRows: 0, validContacts: 0 });
      }

      // Auto-detect column mapping
      const emailCol = headers.findIndex(h => /email|e-mail|mail/i.test(h));
      const firstNameCol = headers.findIndex(h => /first.?name|given.?name|first/i.test(h));
      const lastNameCol = headers.findIndex(h => /last.?name|surname|family.?name|last/i.test(h));
      const companyCol = headers.findIndex(h => /company|organization|org|business/i.test(h));
      const nameCol = headers.findIndex(h => /^name$/i.test(h));

      const mappedColIndices = new Set([emailCol, firstNameCol, lastNameCol, companyCol, nameCol].filter(i => i >= 0));
      const contacts = dataRows
        .filter(row => {
          const email = emailCol >= 0 ? row[emailCol] : '';
          return email && email.includes('@');
        })
        .map((row) => {
          let firstName = firstNameCol >= 0 ? (row[firstNameCol] || '') : '';
          let lastName = lastNameCol >= 0 ? (row[lastNameCol] || '') : '';
          
          if (!firstName && !lastName && nameCol >= 0 && row[nameCol]) {
            const parts = row[nameCol].trim().split(/\s+/);
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
          }

          const contact: Record<string, any> = {
            email: emailCol >= 0 ? (row[emailCol] || '').trim() : '',
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            company: companyCol >= 0 ? (row[companyCol] || '').trim() : '',
          };

          headers.forEach((header, idx) => {
            if (!mappedColIndices.has(idx) && row[idx]) {
              contact[header] = row[idx].trim();
            }
          });

          return contact;
        });

      console.log('[sheets/fetch-data] Found', contacts.length, 'contacts from', dataRows.length, 'rows');

      return res.json({
        headers,
        values: [headers, ...dataRows],
        contacts,
        totalRows: dataRows.length,
        validContacts: contacts.length,
        allHeaders: headers,
        method: usedOAuth ? 'oauth' : 'public',
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

  // ========== UNIFIED INBOX ==========

  // List inbox messages with filters — admin sees all, members see only their own accounts
  app.get('/api/inbox', requireAuth, async (req: any, res) => {
    try {
      const { status, emailAccountId, campaignId, limit, offset } = req.query;
      const role = req.user.role;
      const isAdmin = role === 'owner' || role === 'admin';
      const parsedLimit = parseInt(limit as string) || 50;
      const parsedOffset = parseInt(offset as string) || 0;
      const filters = { status, emailAccountId, campaignId };

      let messages: any[];
      let total: number;
      let unread: number;

      if (isAdmin) {
        messages = await storage.getInboxMessages(req.user.organizationId, filters, parsedLimit, parsedOffset);
        total = await storage.getInboxMessageCount(req.user.organizationId, { status });
        unread = await storage.getInboxUnreadCount(req.user.organizationId);
      } else {
        messages = await storage.getInboxMessagesForUser(req.user.organizationId, req.user.id, filters, parsedLimit, parsedOffset);
        total = await storage.getInboxMessageCountForUser(req.user.organizationId, req.user.id, { status });
        unread = await storage.getInboxUnreadCountForUser(req.user.organizationId, req.user.id);
      }

      // Enrich messages with contact info
      const enriched = await Promise.all(messages.map(async (m: any) => {
        let contact = null;
        if (m.contactId) {
          contact = await storage.getContact(m.contactId);
        }
        // Try to find contact by email if not linked
        if (!contact && m.fromEmail) {
          contact = await storage.getContactByEmail(m.fromEmail, req.user.organizationId);
        }
        // Add account owner info for admin view
        let accountOwner = null;
        if (isAdmin && m.emailAccountId) {
          const acct = await storage.getEmailAccount(m.emailAccountId);
          if (acct && (acct as any).userId) {
            const owner = await storage.getUser((acct as any).userId);
            if (owner) accountOwner = { id: owner.id, email: owner.email, firstName: (owner as any).firstName, lastName: (owner as any).lastName };
          }
        }
        return {
          ...m,
          contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company, jobTitle: contact.jobTitle } : null,
          accountOwner,
        };
      }));

      res.json({ messages: enriched, total, unread });
    } catch (error) {
      console.error('Inbox list error:', error);
      res.status(500).json({ message: 'Failed to fetch inbox messages' });
    }
  });

  // Mark multiple messages read
  app.post('/api/inbox/bulk-read', requireAuth, async (req: any, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ message: 'ids array required' });
      for (const id of ids) {
        await storage.updateInboxMessage(id, { status: 'read' });
      }
      res.json({ success: true, updated: ids.length });
    } catch (error) {
      res.status(500).json({ message: 'Failed to bulk update' });
    }
  });

  // Get unread count — MUST be before /:id routes
  app.get('/api/inbox/unread-count', requireAuth, async (req: any, res) => {
    try {
      const role = req.user.role;
      const isAdmin = role === 'owner' || role === 'admin';
      const count = isAdmin
        ? await storage.getInboxUnreadCount(req.user.organizationId)
        : await storage.getInboxUnreadCountForUser(req.user.organizationId, req.user.id);
      res.json({ unread: count });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get unread count' });
    }
  });

  // Trigger manual inbox sync — MUST be before /:id routes
  app.post('/api/inbox/sync', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const lookbackMinutes = parseInt(req.body.lookbackMinutes) || 120;
      const results: any = { gmail: null, outlook: null };

      const settings = await storage.getApiSettings(orgId);

      if (settings.gmail_access_token || settings.gmail_refresh_token) {
        results.gmail = await gmailReplyTracker.checkForReplies(orgId, lookbackMinutes);
      }
      if (settings.microsoft_access_token || settings.microsoft_refresh_token) {
        results.outlook = await outlookReplyTracker.checkForReplies(orgId, lookbackMinutes);
      }

      const totalNew = (results.gmail?.newReplies || 0) + (results.outlook?.newReplies || 0);
      res.json({ success: true, totalNew, results });
    } catch (error) {
      console.error('Inbox sync error:', error);
      res.status(500).json({ message: 'Failed to sync inbox' });
    }
  });

  // Get inbox sync status — MUST be before /:id routes
  app.get('/api/inbox/sync-status', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const gmailStatus = gmailReplyTracker.getStatus();
      const outlookStatus = outlookReplyTracker.getStatus();

      res.json({
        gmail: {
          connected: !!(settings.gmail_access_token || settings.gmail_refresh_token),
          email: settings.gmail_email || null,
          ...gmailStatus,
        },
        outlook: {
          connected: !!(settings.microsoft_access_token || settings.microsoft_refresh_token),
          email: settings.microsoft_user_email || null,
          ...outlookStatus,
        },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get sync status' });
    }
  });

  // Get single inbox message
  app.get('/api/inbox/:id', requireAuth, async (req: any, res) => {
    try {
      const msg = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });

      // Enrich with contact
      let contact = null;
      if ((msg as any).contactId) contact = await storage.getContact((msg as any).contactId);
      if (!contact && (msg as any).fromEmail) contact = await storage.getContactByEmail((msg as any).fromEmail, req.user.organizationId);

      // Enrich with campaign info
      let campaign = null;
      if ((msg as any).campaignId) campaign = await storage.getCampaign((msg as any).campaignId);

      res.json({
        ...msg,
        contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company, jobTitle: contact.jobTitle } : null,
        campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch message' });
    }
  });

  // Mark message as read / archived / replied
  app.patch('/api/inbox/:id', requireAuth, async (req: any, res) => {
    try {
      const updated = await storage.updateInboxMessage(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update message' });
    }
  });

  // Archive message
  app.post('/api/inbox/:id/archive', requireAuth, async (req: any, res) => {
    try {
      const updated = await storage.updateInboxMessage(req.params.id, { status: 'archived' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to archive message' });
    }
  });

  // Delete message from inbox
  app.delete('/api/inbox/:id', requireAuth, async (req: any, res) => {
    try {
      await storage.deleteInboxMessage(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete message' });
    }
  });

  // Reply to message via Gmail API
  app.post('/api/inbox/:id/reply', requireAuth, async (req: any, res) => {
    try {
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });

      const { body: replyBody } = req.body;
      if (!replyBody) return res.status(400).json({ message: 'Reply body is required' });

      const settings = await storage.getApiSettings(req.user.organizationId);
      const provider = msg.provider;

      if (provider === 'gmail') {
        // Send reply via Gmail API
        const accessToken = settings.gmail_access_token;
        if (!accessToken) return res.status(400).json({ message: 'Gmail not connected. Please re-authenticate.' });

        const senderEmail = settings.gmail_email || msg.toEmail;
        const rawMessage = createRawEmail({
          from: senderEmail,
          to: msg.fromEmail,
          subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
          body: replyBody,
          inReplyTo: msg.gmailMessageId ? `<${msg.gmailMessageId}>` : undefined,
          threadId: msg.gmailThreadId,
        });

        const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: rawMessage, threadId: msg.gmailThreadId }),
        });

        if (!sendResp.ok) {
          const errText = await sendResp.text();
          return res.status(500).json({ message: `Gmail send failed: ${errText}` });
        }

        const sendResult = await sendResp.json() as any;
        
        // Store reply details: update original message and create a sent-reply record
        await storage.updateInboxMessage(msg.id, { 
          status: 'replied', 
          repliedAt: new Date().toISOString(),
          replyContent: replyBody,
          repliedBy: req.user.email || req.user.id,
        });

        // Also store the sent reply as a new inbox message for the conversation trail
        try {
          const senderName = req.user.name || req.user.email || 'Me';
          await storage.createInboxMessage({
            organizationId: req.user.organizationId,
            emailAccountId: msg.emailAccountId,
            campaignId: msg.campaignId,
            messageId: msg.messageId,
            contactId: msg.contactId,
            gmailMessageId: sendResult.id || null,
            gmailThreadId: msg.gmailThreadId || sendResult.threadId || null,
            fromEmail: senderEmail,
            fromName: senderName,
            toEmail: msg.fromEmail,
            subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
            snippet: replyBody.replace(/<[^>]+>/g, '').substring(0, 200),
            body: replyBody.replace(/<[^>]+>/g, ''),
            bodyHtml: replyBody,
            status: 'sent',
            provider: 'gmail',
            receivedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[Inbox] Failed to store sent reply record:', e);
        }
        
        res.json({ success: true, provider: 'gmail' });

      } else if (provider === 'outlook') {
        // Send reply via Microsoft Graph
        const accessToken = settings.microsoft_access_token;
        if (!accessToken) return res.status(400).json({ message: 'Outlook not connected. Please re-authenticate.' });

        // Create a reply
        const replyResp = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.outlookMessageId}/reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: replyBody }),
        });

        if (!replyResp.ok) {
          const errText = await replyResp.text();
          return res.status(500).json({ message: `Outlook send failed: ${errText}` });
        }

        // Store reply details
        await storage.updateInboxMessage(msg.id, { 
          status: 'replied', 
          repliedAt: new Date().toISOString(),
          replyContent: replyBody,
          repliedBy: req.user.email || req.user.id,
        });

        // Store the sent reply as a new inbox message for conversation trail
        try {
          const senderEmail = settings.microsoft_user_email || msg.toEmail;
          const senderName = req.user.name || req.user.email || 'Me';
          await storage.createInboxMessage({
            organizationId: req.user.organizationId,
            emailAccountId: msg.emailAccountId,
            campaignId: msg.campaignId,
            messageId: msg.messageId,
            contactId: msg.contactId,
            outlookMessageId: null,
            fromEmail: senderEmail,
            fromName: senderName,
            toEmail: msg.fromEmail,
            subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
            snippet: replyBody.replace(/<[^>]+>/g, '').substring(0, 200),
            body: replyBody.replace(/<[^>]+>/g, ''),
            bodyHtml: replyBody,
            status: 'sent',
            provider: 'outlook',
            receivedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[Inbox] Failed to store sent reply record:', e);
        }

        res.json({ success: true, provider: 'outlook' });

      } else {
        // No provider match — can't send reply without Gmail or Outlook connected
        res.status(400).json({ message: 'Could not determine reply provider. Connect Gmail or Outlook first.' });
      }
    } catch (error) {
      console.error('Reply error:', error);
      res.status(500).json({ message: 'Failed to send reply' });
    }
  });

  // ========== AI DRAFT FOR INBOX REPLY ==========
  app.post('/api/inbox/:id/ai-draft', requireAuth, async (req: any, res) => {
    try {
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });

      const { tone, customInstructions } = req.body; // tone: 'professional' | 'friendly' | 'concise' | 'custom'
      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.json({
          draft: `Hi ${msg.fromName || 'there'},\n\nThank you for your email. I appreciate you reaching out.\n\nI'll get back to you shortly with more details.\n\nBest regards`,
          provider: 'demo',
          note: 'Configure Azure OpenAI in Advanced Settings for AI-powered drafts.',
        });
      }

      // Get contact info for context
      let contact = null;
      if (msg.contactId) contact = await storage.getContact(msg.contactId);
      if (!contact && msg.fromEmail) contact = await storage.getContactByEmail(msg.fromEmail, req.user.organizationId);

      // ========== BUILD FULL CONVERSATION TRAIL ==========
      // Collect the entire email thread for AI context
      let conversationTrail = '';
      try {
        // Method 1: Get all inbox messages in the same thread (by gmailThreadId)
        const threadMessages: any[] = [];
        if (msg.gmailThreadId) {
          const allInbox = await storage.getInboxMessages(req.user.organizationId, {}, 50, 0) as any[];
          const threadMsgs = allInbox.filter((m: any) => m.gmailThreadId === msg.gmailThreadId);
          threadMsgs.sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
          threadMessages.push(...threadMsgs);
        }

        // Method 2: Get the original campaign message that started this thread
        let originalCampaignContent = '';
        if (msg.messageId) {
          const campaignMsg = await storage.getCampaignMessage(msg.messageId);
          if (campaignMsg) {
            const campaign = await storage.getCampaign(campaignMsg.campaignId);
            originalCampaignContent = `\n--- Original Campaign Email (${campaign?.name || 'Campaign'}) ---\nSubject: ${campaignMsg.subject || campaign?.subject || '(no subject)'}\n${(campaignMsg as any).content || (campaignMsg as any).body || ''}`;
          }
        }

        // Build the trail
        const trailParts: string[] = [];
        if (originalCampaignContent) {
          trailParts.push(originalCampaignContent);
        }
        for (const tm of threadMessages) {
          if (tm.id === msg.id) continue; // Skip the current message (already included separately)
          const direction = tm.status === 'sent' ? 'You sent' : `${tm.fromName || tm.fromEmail} wrote`;
          const msgBody = (tm.body || tm.snippet || '').substring(0, 1000);
          if (msgBody.trim()) {
            trailParts.push(`\n--- ${direction} (${tm.receivedAt}) ---\nSubject: ${tm.subject || ''}\n${msgBody}`);
          }
          // Also include any stored reply content
          if (tm.replyContent) {
            trailParts.push(`\n--- Your reply ---\n${tm.replyContent.substring(0, 1000)}`);
          }
        }
        
        if (trailParts.length > 0) {
          conversationTrail = '\n\n========== FULL CONVERSATION TRAIL ==========\n' + trailParts.join('\n');
        }
      } catch (e) {
        console.warn('[AI Draft] Could not build conversation trail:', e);
      }

      const toneInstructions: Record<string, string> = {
        professional: 'Write in a professional, business-appropriate tone.',
        friendly: 'Write in a warm, friendly, and approachable tone.',
        concise: 'Be very brief and concise. Get straight to the point.',
        formal: 'Use formal business language appropriate for executives.',
        custom: customInstructions || 'Write an appropriate reply.',
      };

      const systemPrompt = `You are an expert email assistant for a business email outreach platform. Generate a contextual reply to the received email. 
${toneInstructions[tone || 'professional']}
- You will be provided with the FULL CONVERSATION TRAIL including the original campaign email and all previous replies.
- Read and understand the ENTIRE conversation context before drafting your reply.
- Your reply should be consistent with the conversation history and address the latest message specifically.
- Do NOT include a subject line, only the body.
- Use proper greeting and sign-off.
- If the original email has a question, answer it helpfully.
- Keep the reply concise (2-4 paragraphs max).
- Do NOT use markdown formatting — write plain text or simple HTML.
- Reference specifics from the conversation to make it feel personal and contextual.`;

      const contactContext = contact ? `\nSender context: ${contact.firstName || ''} ${contact.lastName || ''}, ${contact.jobTitle || ''} at ${contact.company || 'Unknown Company'}` : '';

      const userPrompt = `Latest email from: ${msg.fromName || msg.fromEmail}
Subject: ${msg.subject || '(no subject)'}
${contactContext}

Latest email body:
${msg.body || msg.snippet || '(no content)'}
${conversationTrail}

Generate an appropriate reply to the LATEST email above, considering the full conversation context.`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1200,
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const draft = data?.choices?.[0]?.message?.content || '';
        // Store the AI draft in the inbox message
        await storage.updateInboxMessage(msg.id, { aiDraft: draft });
        return res.json({ draft, provider: 'azure-openai', model: data?.model || deploymentName, tokens: data?.usage?.total_tokens || 0 });
      }

      // Fallback
      const errorText = await response.text();
      console.error('Azure OpenAI draft error:', response.status, errorText);
      res.json({
        draft: `Hi ${msg.fromName || 'there'},\n\nThank you for your email regarding "${msg.subject || 'your inquiry'}". I appreciate you reaching out.\n\nI'll review the details and get back to you shortly.\n\nBest regards`,
        provider: 'fallback',
        note: 'Azure OpenAI returned an error. Using template reply.',
      });
    } catch (error) {
      console.error('AI draft error:', error);
      res.status(500).json({ message: 'Failed to generate AI draft' });
    }
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

  // ========== ORGANIZATION & TEAM MANAGEMENT (Multitenancy) ==========
  app.use('/api/organizations', requireAuth);
  app.use('/api/team', requireAuth);
  app.use('/api/invitations', requireAuth);

  // Get current user's organizations
  app.get('/api/organizations', async (req: any, res) => {
    try {
      const orgs = await storage.getUserOrganizations(req.user.id);
      res.json(orgs);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch organizations' });
    }
  });

  // Get current organization details
  app.get('/api/organizations/current', async (req: any, res) => {
    try {
      const org = await storage.getOrganization(req.user.organizationId);
      if (!org) return res.status(404).json({ message: 'Organization not found' });
      const memberCount = await storage.getOrgMemberCount(req.user.organizationId);
      res.json({ ...org, memberCount, userRole: req.user.role });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch organization' });
    }
  });

  // Create a new organization
  app.post('/api/organizations', async (req: any, res) => {
    try {
      const { name, domain } = req.body;
      if (!name) return res.status(400).json({ message: 'Organization name is required' });
      
      const org = await storage.createOrganizationWithOwner({ name, domain }, req.user.id);
      res.status(201).json(org);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create organization' });
    }
  });

  // Update current organization
  app.put('/api/organizations/current', async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only owners and admins can update organization settings' });
      }
      const { name, domain, settings } = req.body;
      const org = await storage.updateOrganization(req.user.organizationId, { name, domain, settings });
      res.json(org);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update organization' });
    }
  });

  // Switch active organization
  app.post('/api/organizations/switch', async (req: any, res) => {
    try {
      const { organizationId } = req.body;
      if (!organizationId) return res.status(400).json({ message: 'Organization ID required' });
      
      const membership = await storage.getOrgMember(organizationId, req.user.id);
      if (!membership) return res.status(403).json({ message: 'You are not a member of this organization' });
      
      await storage.setDefaultOrganization(req.user.id, organizationId);
      (req.session as any).activeOrgId = organizationId;
      
      const org = await storage.getOrganization(organizationId);
      res.json({ success: true, organization: org });
    } catch (error) {
      res.status(500).json({ message: 'Failed to switch organization' });
    }
  });

  // Get team members of current org
  app.get('/api/team/members', async (req: any, res) => {
    try {
      const members = await storage.getOrgMembers(req.user.organizationId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch team members' });
    }
  });

  // Update member role
  app.put('/api/team/members/:userId/role', async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only owners and admins can change roles' });
      }
      const { role } = req.body;
      if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      if (req.params.userId === req.user.id && req.user.role === 'owner') {
        const members = await storage.getOrgMembers(req.user.organizationId) as any[];
        const ownerCount = members.filter(m => m.role === 'owner').length;
        if (ownerCount <= 1 && role !== 'owner') {
          return res.status(400).json({ message: 'Cannot remove the last owner. Transfer ownership first.' });
        }
      }
      const member = await storage.updateOrgMemberRole(req.user.organizationId, req.params.userId, role);
      res.json(member);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update member role' });
    }
  });

  // Remove member from organization
  app.delete('/api/team/members/:userId', async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only owners and admins can remove members' });
      }
      if (req.params.userId === req.user.id) {
        const members = await storage.getOrgMembers(req.user.organizationId) as any[];
        const ownerCount = members.filter(m => m.role === 'owner').length;
        if (req.user.role === 'owner' && ownerCount <= 1) {
          return res.status(400).json({ message: 'Cannot leave as the last owner. Transfer ownership first.' });
        }
      }
      await storage.removeOrgMember(req.user.organizationId, req.params.userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to remove member' });
    }
  });

  // Leave organization (self-remove)
  app.post('/api/team/leave', async (req: any, res) => {
    try {
      const members = await storage.getOrgMembers(req.user.organizationId) as any[];
      const ownerCount = members.filter(m => m.role === 'owner').length;
      if (req.user.role === 'owner' && ownerCount <= 1) {
        return res.status(400).json({ message: 'Cannot leave as the last owner. Transfer ownership or delete the organization.' });
      }
      await storage.removeOrgMember(req.user.organizationId, req.user.id);
      (req.session as any).activeOrgId = null;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to leave organization' });
    }
  });

  // Helper: Send invitation email via the org's best available email channel
  async function sendInvitationEmail(
    orgId: string,
    inviteeEmail: string,
    inviterName: string,
    orgName: string,
    role: string,
    acceptUrl: string
  ): Promise<{ sent: boolean; method?: string; error?: string }> {
    try {
      const settings = await storage.getApiSettings(orgId);
      const accounts = await storage.getEmailAccounts(orgId);
      
      // Build a nice HTML invitation email
      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1a56db; font-size: 24px; margin: 0;">AImailPilot</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">AI-Powered Email Campaign Platform</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; text-align: center;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 12px;">You're invited to join a team!</h2>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
              <strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> as a <strong>${roleLabel}</strong>.
            </p>
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 24px;">
              This invitation expires in 7 days.
            </p>
            <a href="${acceptUrl}" style="display: inline-block; background: #1a56db; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              Accept Invitation
            </a>
            <p style="color: #9ca3af; font-size: 12px; margin: 20px 0 0;">
              If you don't have an AImailPilot account, you'll be able to create one when you click the link above.
            </p>
          </div>
          <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 11px; margin: 0;">
              This email was sent by AImailPilot. If you didn't expect this invitation, you can safely ignore it.
            </p>
          </div>
        </div>
      `;

      const subject = `${inviterName} invited you to join ${orgName} on AImailPilot`;

      // Strategy 1: Try Gmail API with org-level or sender tokens
      const gmailAccessToken = settings.gmail_access_token;
      const gmailRefreshToken = settings.gmail_refresh_token;
      const gmailEmail = settings.gmail_user_email;
      
      if (gmailAccessToken && gmailEmail) {
        // Check if token needs refresh
        let token = gmailAccessToken;
        const expiry = parseInt(settings.gmail_token_expiry || '0');
        if (Date.now() >= expiry - 300000 && gmailRefreshToken) {
          const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
          const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
          if (clientId && clientSecret) {
            try {
              const oauth2 = createOAuth2Client({ clientId, clientSecret, redirectUri: '' });
              oauth2.setCredentials({ refresh_token: gmailRefreshToken });
              const { credentials } = await oauth2.refreshAccessToken();
              if (credentials.access_token) {
                token = credentials.access_token;
                await storage.setApiSetting(orgId, 'gmail_access_token', token);
                if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
              }
            } catch (e) { console.error('[InviteEmail] Gmail token refresh failed:', e); }
          }
        }

        const raw = createRawEmail({ from: gmailEmail, to: inviteeEmail, subject, body: htmlBody });
        const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (resp.ok) {
          console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via Gmail API from ${gmailEmail}`);
          return { sent: true, method: 'gmail-api' };
        }
        console.error(`[InviteEmail] Gmail API failed (${resp.status}):`, await resp.text());
      }

      // Strategy 2: Try Microsoft Graph API
      const msAccessToken = settings.microsoft_access_token;
      if (msAccessToken) {
        const message = {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: inviteeEmail } }],
        };
        const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${msAccessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (resp.ok) {
          console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via Microsoft Graph`);
          return { sent: true, method: 'microsoft-graph' };
        }
        console.error(`[InviteEmail] Microsoft Graph failed (${resp.status}):`, await resp.text());
      }

      // Strategy 3: Try any SMTP-configured email account in the org
      for (const account of accounts) {
        if (account.smtpConfig && account.smtpConfig.auth?.pass && account.smtpConfig.auth.pass !== 'OAUTH_TOKEN' && account.isActive) {
          try {
            const sendResult = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
              to: inviteeEmail,
              subject,
              html: htmlBody,
            });
            if (sendResult.success) {
              console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via SMTP (${account.email})`);
              return { sent: true, method: 'smtp' };
            }
          } catch (e) { console.error(`[InviteEmail] SMTP send failed for ${account.email}:`, e); }
        }
      }

      // Strategy 4: Try per-sender Gmail tokens for any Gmail account
      for (const account of accounts) {
        if (account.provider === 'gmail' && account.isActive) {
          const senderToken = settings[`gmail_sender_${account.email}_access_token`];
          if (senderToken) {
            const raw = createRawEmail({ from: account.email, to: inviteeEmail, subject, body: htmlBody });
            const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST',
              headers: { Authorization: `Bearer ${senderToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw }),
            });
            if (resp.ok) {
              console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via Gmail API (sender: ${account.email})`);
              return { sent: true, method: 'gmail-api' };
            }
          }
        }
      }

      console.warn(`[InviteEmail] No email channel available to send invitation to ${inviteeEmail}`);
      return { sent: false, error: 'No email sending channel configured. The invitation was created but no email was sent.' };
    } catch (err) {
      console.error('[InviteEmail] Unexpected error:', err);
      return { sent: false, error: err instanceof Error ? err.message : 'Unknown error sending invitation email' };
    }
  }

  // Create invitation
  app.post('/api/invitations', async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only owners and admins can invite members' });
      }
      const { email, role } = req.body;
      if (!email) return res.status(400).json({ message: 'Email is required' });
      
      const existingUser = await storage.getUserByEmail(email) as any;
      if (existingUser) {
        const existingMember = await storage.getOrgMember(req.user.organizationId, existingUser.id);
        if (existingMember) {
          return res.status(400).json({ message: 'This user is already a member of this organization' });
        }
      }
      
      const invitation = await storage.createInvitation(req.user.organizationId, email, role || 'member', req.user.id);

      // Send invitation email asynchronously
      const baseUrl = getBaseUrlFromRequest(req);
      const acceptUrl = `${baseUrl}/?invite_token=${invitation.token}`;
      const org = await storage.getOrganization(req.user.organizationId) as any;
      const orgName = org?.name || 'AImailPilot';
      const inviterName = req.user.name || req.user.email || 'A team member';

      const emailResult = await sendInvitationEmail(
        req.user.organizationId,
        email,
        inviterName,
        orgName,
        role || 'member',
        acceptUrl
      );

      res.status(201).json({
        ...invitation,
        emailSent: emailResult.sent,
        emailMethod: emailResult.method,
        emailError: emailResult.error,
      });
    } catch (error) {
      console.error('[Invitations] Create error:', error);
      res.status(500).json({ message: 'Failed to create invitation' });
    }
  });

  // Get pending invitations for current org
  app.get('/api/invitations', async (req: any, res) => {
    try {
      const invitations = await storage.getOrgInvitations(req.user.organizationId);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch invitations' });
    }
  });

  // Cancel invitation
  app.delete('/api/invitations/:id', async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only owners and admins can cancel invitations' });
      }
      await storage.cancelInvitation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to cancel invitation' });
    }
  });

  // Accept invitation (can be used by logged-in users)
  app.post('/api/invitations/accept', async (req: any, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: 'Invitation token required' });
      
      const invitation = await storage.acceptInvitation(token, req.user.id);
      await storage.setDefaultOrganization(req.user.id, (invitation as any).organizationId);
      (req.session as any).activeOrgId = (invitation as any).organizationId;
      
      res.json({ success: true, organizationId: (invitation as any).organizationId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to accept invitation';
      res.status(400).json({ message: msg });
    }
  });

  // Get pending invitations for current user's email
  app.get('/api/invitations/pending', async (req: any, res) => {
    try {
      const invitations = await storage.getPendingInvitationsForEmail(req.user.email);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch pending invitations' });
    }
  });

  // Enhanced /api/auth/user-profile with org information
  app.get('/api/auth/user-profile', requireAuth, async (req: any, res) => {
    try {
      const orgs = await storage.getUserOrganizations(req.user.id);
      const currentOrg = await storage.getOrganization(req.user.organizationId);
      const sessionUser = (req.session as any)?.user || {};
      
      res.json({
        ...sessionUser,
        id: req.user.id,
        organizationId: req.user.organizationId,
        organizationName: (currentOrg as any)?.name || 'Unknown',
        role: req.user.role,
        isSuperAdmin: req.user.isSuperAdmin || false,
        organizations: orgs.map((o: any) => ({
          id: o.id,
          name: o.name,
          role: o.memberRole,
          isDefault: !!o.isDefault,
        })),
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch user profile' });
    }
  });

  // ========== SUPERADMIN ROUTES ==========
  app.use('/api/superadmin', requireAuth, requireSuperAdmin);

  // First-time superadmin setup: If no superadmin exists, the first user to call this becomes superadmin
  // This is separate from the superadmin middleware so any authenticated user can bootstrap
  app.post('/api/setup-superadmin', requireAuth, async (req: any, res) => {
    try {
      const stats = await storage.getPlatformStats();
      if (stats.superAdmins > 0) {
        return res.status(403).json({ message: 'SuperAdmin already exists. Contact an existing superadmin.' });
      }
      await storage.setSuperAdmin(req.user.id, true);
      res.json({ success: true, message: 'You are now the platform SuperAdmin!' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to setup superadmin' });
    }
  });

  // Check if superadmin exists (public for setup UI)
  app.get('/api/superadmin-exists', requireAuth, async (req: any, res) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json({ exists: stats.superAdmins > 0, isSuperAdmin: req.user.isSuperAdmin });
    } catch (error) {
      res.json({ exists: false, isSuperAdmin: false });
    }
  });

  // Platform-wide statistics
  app.get('/api/superadmin/stats', async (req: any, res) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch platform stats' });
    }
  });

  // List all organizations
  app.get('/api/superadmin/organizations', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || '';
      const orgs = await storage.getAllOrganizations(limit, offset, search);
      const total = await storage.getAllOrganizationsCount(search);
      res.json({ organizations: orgs, total, limit, offset });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch organizations' });
    }
  });

  // Get organization details (with members, stats)
  app.get('/api/superadmin/organizations/:id', async (req: any, res) => {
    try {
      const org = await storage.getOrgDetails(req.params.id);
      if (!org) return res.status(404).json({ message: 'Organization not found' });
      res.json(org);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch organization details' });
    }
  });

  // Delete organization (cascade)
  app.delete('/api/superadmin/organizations/:id', async (req: any, res) => {
    try {
      await storage.deleteOrganizationCascade(req.params.id);
      res.json({ success: true, message: 'Organization and all related data deleted' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete organization' });
    }
  });

  // List all users
  app.get('/api/superadmin/users', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || '';
      const users = await storage.getAllUsers(limit, offset, search);
      const total = await storage.getAllUsersCount(search);
      res.json({ users: users.map((u: any) => ({ ...u, isSuperAdmin: !!u.isSuperAdmin, isActive: !!u.isActive })), total, limit, offset });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  // Toggle user active/inactive
  app.put('/api/superadmin/users/:id/toggle-active', async (req: any, res) => {
    try {
      const user = await storage.getUser(req.params.id) as any;
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (user.isSuperAdmin && req.params.id !== req.user.id) {
        return res.status(400).json({ message: 'Cannot deactivate another superadmin' });
      }
      if (user.isActive) {
        await storage.deactivateUser(req.params.id);
      } else {
        await storage.activateUser(req.params.id);
      }
      const updated = await storage.getUser(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to toggle user status' });
    }
  });

  // Grant/revoke superadmin
  app.put('/api/superadmin/users/:id/superadmin', async (req: any, res) => {
    try {
      const { isSuperAdmin } = req.body;
      if (req.params.id === req.user.id && !isSuperAdmin) {
        return res.status(400).json({ message: 'Cannot remove your own superadmin access' });
      }
      await storage.setSuperAdmin(req.params.id, !!isSuperAdmin);
      const updated = await storage.getUser(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update superadmin status' });
    }
  });

  // Impersonate user (switch to their default org)
  app.post('/api/superadmin/impersonate/:userId', async (req: any, res) => {
    try {
      const targetUser = await storage.getUser(req.params.userId) as any;
      if (!targetUser) return res.status(404).json({ message: 'User not found' });
      
      const defaultOrg = await storage.getUserDefaultOrganization(req.params.userId);
      if (!defaultOrg) return res.status(400).json({ message: 'User has no organization' });
      
      // Store original superadmin identity for "return to admin" functionality
      (req.session as any).originalUserId = req.user.id;
      (req.session as any).originalUserName = req.user.name;
      (req.session as any).isImpersonating = true;
      
      // Switch to the target user's context
      (req.session as any).activeOrgId = defaultOrg.id;
      
      res.json({ 
        success: true, 
        user: { id: targetUser.id, email: targetUser.email, name: `${targetUser.firstName} ${targetUser.lastName}`.trim() },
        organization: { id: defaultOrg.id, name: (defaultOrg as any).name },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to impersonate user' });
    }
  });

  // Stop impersonation (return to superadmin)
  app.post('/api/superadmin/stop-impersonation', async (req: any, res) => {
    try {
      const originalUserId = (req.session as any)?.originalUserId;
      if (!originalUserId) return res.status(400).json({ message: 'Not currently impersonating' });
      
      const defaultOrg = await storage.getUserDefaultOrganization(originalUserId);
      (req.session as any).activeOrgId = defaultOrg ? defaultOrg.id : null;
      delete (req.session as any).originalUserId;
      delete (req.session as any).originalUserName;
      delete (req.session as any).isImpersonating;
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to stop impersonation' });
    }
  });

  // Promote a user to superadmin by email (useful for initial setup)
  app.post('/api/superadmin/promote-by-email', async (req: any, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: 'Email is required' });
      const user = await storage.setSuperAdminByEmail(email, true);
      if (!user) return res.status(404).json({ message: 'User not found' });
      res.json({ success: true, user });
    } catch (error) {
      res.status(500).json({ message: 'Failed to promote user' });
    }
  });

  // Get current superadmin's impersonation status
  app.get('/api/superadmin/impersonation-status', async (req: any, res) => {
    res.json({
      isImpersonating: !!(req.session as any)?.isImpersonating,
      originalUserId: (req.session as any)?.originalUserId || null,
      originalUserName: (req.session as any)?.originalUserName || null,
    });
  });

  // Start Gmail reply tracking auto-check for all organizations that have tokens
  try {
    const allOrgIds = await storage.getAllOrganizationIds();
    for (const orgId of allOrgIds) {
      const orgSettings = await storage.getApiSettings(orgId);
      if (orgSettings.gmail_access_token || orgSettings.gmail_refresh_token) {
        console.log(`[ReplyTracker] Gmail tokens found for org ${orgId}, starting auto-check...`);
        gmailReplyTracker.startAutoCheck(orgId, 5);
      }
      if (orgSettings.microsoft_access_token || orgSettings.microsoft_refresh_token) {
        console.log(`[ReplyTracker] Outlook tokens found for org ${orgId}, starting auto-check...`);
        outlookReplyTracker.startAutoCheck(orgId, 5);
      }
    }
  } catch (e) {
    console.error('[ReplyTracker] Failed to start auto-check on startup:', e);
  }

  const httpServer = createServer(app);
  return httpServer;
}
