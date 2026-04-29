import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import cookieParser from "cookie-parser";
import MemoryStore from "memorystore";
import { smtpEmailService, SMTP_PRESETS, type SmtpConfig, getProviderDailyLimit } from "./services/smtp-email-service";
import { campaignEngine } from "./services/campaign-engine";
import { followupEngine } from "./services/followup-engine";
import { gmailReplyTracker } from "./services/gmail-reply-tracker";
import { outlookReplyTracker } from "./services/outlook-reply-tracker";
import { calculateContactRating, batchRecalculateRatings } from "./services/email-rating-engine";
import { classifyReply, classifyBounce, classifyReplyWithAI, isHumanReply } from "./services/reply-classifier";
import { verifySingleEmail, verifyBatch, checkCredits, getEmailVerifyApiKey } from "./services/email-verifier";
import { OAuth2Client } from 'google-auth-library';
import { runWarmupNow, runOrgWarmupDirect } from "./services/warmup-engine";
import { runBounceSyncForOrg, runBounceSyncAllOrgs } from "./services/bounce-sync-engine";
import { scanOrgEmailHistory, analyzeOrgLeads, runFullLeadIntelligence, BUCKET_LABELS } from "./services/lead-intelligence-engine";


// Bounded Set/Map with FIFO eviction — extracted to server/lib/bounded-collections.ts
// so the eviction logic can be unit-tested independently of route handlers.
import { BoundedSet, BoundedMap } from "./lib/bounded-collections";

// In-memory user store for simplified authentication
const loggedInUsers = new BoundedSet<string>(10000);

// Helper to create raw email for Gmail API send
function createRawEmail(opts: { from: string; to: string; cc?: string; bcc?: string; subject: string; body: string; inReplyTo?: string; threadId?: string }): string {
  let raw = '';
  raw += `From: ${opts.from}\r\n`;
  raw += `To: ${opts.to}\r\n`;
  if (opts.cc) raw += `Cc: ${opts.cc}\r\n`;
  if (opts.bcc) raw += `Bcc: ${opts.bcc}\r\n`;
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
  // Azure may send multiple protocols comma-separated (e.g., "https,http")
  if (typeof proto === 'string' && proto.includes(',')) {
    proto = proto.split(',')[0].trim();
  }
  // Check multiple headers for the host (Azure uses different headers)
  const host = req.headers['x-forwarded-host'] || req.headers['x-original-host'] || req.headers['host'];
  // Force HTTPS for non-localhost hosts (sandbox proxies, production domains)
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    proto = 'https';
  }
  return `${proto}://${host}`;
}

// CRITICAL: Get the canonical Microsoft OAuth redirect URI.
// For production, ALWAYS use the canonical domain to avoid www vs non-www mismatches.
// Microsoft token exchange requires the redirect_uri to EXACTLY match what was sent
// in the authorization request AND what's registered in Azure App Registration.
function getMicrosoftRedirectUri(req: any): string {
  const host = req.headers['x-forwarded-host'] || req.headers['x-original-host'] || req.headers['host'] || '';
  // If this is a production request (any variant of aimailpilot.com),
  // always use the canonical non-www version to avoid mismatches
  if (host.includes(PRODUCTION_DOMAIN)) {
    return `https://${PRODUCTION_DOMAIN}/api/auth/microsoft/callback`;
  }
  // For local development / sandbox, compute dynamically
  const baseUrl = getBaseUrlFromRequest(req);
  return `${baseUrl}/api/auth/microsoft/callback`;
}

// CRITICAL: Get the canonical Google OAuth redirect URI.
// Same www vs non-www issue as Microsoft. Google also requires exact match.
function getGoogleRedirectUri(req: any): string {
  const host = req.headers['x-forwarded-host'] || req.headers['x-original-host'] || req.headers['host'] || '';
  if (host.includes(PRODUCTION_DOMAIN)) {
    return `https://${PRODUCTION_DOMAIN}/api/auth/google/callback`;
  }
  const baseUrl = getBaseUrlFromRequest(req);
  return `${baseUrl}/api/auth/google/callback`;
}

/**
 * Check if an organization has ANY Gmail or Outlook tokens (org-level OR per-sender).
 * This is critical for starting reply/bounce tracking auto-checks.
 * Previously, only org-level tokens were checked, missing per-sender tokens entirely.
 */
function orgHasGmailTokens(settings: Record<string, string>): boolean {
  if (settings.gmail_access_token || settings.gmail_refresh_token) return true;
  // Check for per-sender Gmail tokens: gmail_sender_{email}_access_token
  for (const key of Object.keys(settings)) {
    if (key.startsWith('gmail_sender_') && (key.endsWith('_access_token') || key.endsWith('_refresh_token'))) {
      return true;
    }
  }
  return false;
}

function orgHasOutlookTokens(settings: Record<string, string>): boolean {
  if (settings.microsoft_access_token || settings.microsoft_refresh_token) return true;
  // Check for per-sender Outlook tokens: outlook_sender_{email}_access_token
  for (const key of Object.keys(settings)) {
    if (key.startsWith('outlook_sender_') && (key.endsWith('_access_token') || key.endsWith('_refresh_token'))) {
      return true;
    }
  }
  return false;
}

// Simple auth middleware
// In-memory auth cache: userId+orgId -> resolved user object (TTL 60s).
// Bounded to 10k entries to prevent unbounded growth (e.g. attacker rotating
// ?orgId= values, or long-lived pods with many users). Cache-miss path
// re-resolves from DB — eviction is invisible to users.
const authCache = new BoundedMap<string, { user: any; ts: number }>(10000);
const AUTH_CACHE_TTL = 60000; // 60 seconds

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
        loggedInUsers.add(userId);
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
        return res.status(401).json({ error: 'Not authenticated' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
  }

  // Determine which org is being requested
  const requestedOrgId = req.query?.orgId || (req.session as any)?.activeOrgId || '';
  const cacheKey = `${userId}:${requestedOrgId}`;

  // Check auth cache first — avoids 4-6 DB queries per request
  const cached = authCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < AUTH_CACHE_TTL) {
    req.user = { ...cached.user };
    // Auto-detect public URL for tracking links
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost')) {
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const url = `${proto}://${host}`;
      campaignEngine.setPublicBaseUrl(url);
      followupEngine.setPublicBaseUrl(url);
    }
    return next();
  }

  // Cache miss — resolve from DB (same logic as before)
  const sessionUser = (req.session as any)?.user;
  let orgId = requestedOrgId;
  let orgRole = 'admin';

  if (!orgId) {
    try {
      const defaultOrg = await storage.getUserDefaultOrganization(userId);
      if (defaultOrg) {
        orgId = defaultOrg.id;
        orgRole = defaultOrg.memberRole || 'admin';
        (req.session as any).activeOrgId = orgId;
      }
    } catch (e) {
      try {
        const dbUser = await storage.getUser(userId);
        if (dbUser) orgId = (dbUser as any).organizationId;
      } catch (e2) { /* ignore */ }
    }
  } else {
    try {
      const membership = await storage.getOrgMember(orgId, userId);
      if (membership) {
        orgRole = (membership as any).role;
      } else {
        return res.status(403).json({ error: 'Access denied to this organization' });
      }
    } catch (e) { /* fallback */ }
  }

  if (!orgId) {
    return res.status(400).json({ error: 'No organization found. Please create or join an organization.' });
  }

  let userEmail = sessionUser?.email;
  let userName = sessionUser?.name;
  let userFirstName = '';
  let userLastName = '';
  if (!userEmail || userEmail === 'unknown') {
    try {
      const dbUser = await storage.getUser(userId) as any;
      if (dbUser) {
        userEmail = dbUser.email || 'unknown';
        userName = dbUser.name || dbUser.email || 'Unknown';
        userFirstName = dbUser.firstName || '';
        userLastName = dbUser.lastName || '';
      }
    } catch (e) { /* ignore */ }
  }

  let isSuperAdmin = false;
  try {
    isSuperAdmin = await storage.isSuperAdmin(userId);
  } catch (e) { /* ignore */ }

  const resolvedUser = {
    id: userId,
    organizationId: orgId,
    role: orgRole,
    email: userEmail || 'unknown',
    name: userName || 'Unknown',
    firstName: userFirstName,
    lastName: userLastName,
    isSuperAdmin,
  };

  // Cache the resolved user for 60s
  authCache.set(cacheKey, { user: resolvedUser, ts: Date.now() });
  req.user = { ...resolvedUser };

  // Auto-detect public URL for tracking links
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  if (host && !host.includes('localhost')) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const url = `${proto}://${host}`;
    campaignEngine.setPublicBaseUrl(url);
    followupEngine.setPublicBaseUrl(url);
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
  app.set('trust proxy', true); // Trust all proxies (Azure App Service uses multiple proxy layers)
  app.use(cookieParser());

  // Load persisted tracking base URL from settings on startup
  try {
    const orgIds = await storage.getAllOrganizationIds();
    for (const orgId of orgIds) {
      const orgSettings = await storage.getApiSettings(orgId);
      if (orgSettings.tracking_base_url) {
        campaignEngine.setPublicBaseUrl(orgSettings.tracking_base_url);
        followupEngine.setPublicBaseUrl(orgSettings.tracking_base_url);
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
      followupEngine.setPublicBaseUrl(detectedUrl);
    }
    next();
  });

  // Helper: Get OAuth credentials - SuperAdmin org first, then scan all orgs, then env vars
  // OAuth credentials are platform-wide settings stored in the SuperAdmin's organization.
  // SuperAdmin → Organization → Members → Email Accounts (credentials flow top-down)
  async function getStoredOAuthCredentials(provider: 'google' | 'microsoft') {
    let clientId = '';
    let clientSecret = '';
    let foundInOrgId = '';
    
    const googleKey = 'google_oauth_client_id';
    const googleSecretKey = 'google_oauth_client_secret';
    const msKey = 'microsoft_oauth_client_id';
    const msSecretKey = 'microsoft_oauth_client_secret';
    const idKey = provider === 'google' ? googleKey : msKey;
    const secretKey = provider === 'google' ? googleSecretKey : msSecretKey;
    
    try {
      // PRIORITY 1: Check SuperAdmin's org first (this is where platform-wide settings live)
      const superAdminOrgId = await storage.getSuperAdminOrgId();
      if (superAdminOrgId) {
        const superSettings = await storage.getApiSettings(superAdminOrgId);
        if (superSettings[idKey] && superSettings[secretKey]) {
          clientId = superSettings[idKey];
          clientSecret = superSettings[secretKey];
          foundInOrgId = superAdminOrgId;
          console.log(`[OAuth] Found ${provider} credentials in SuperAdmin org ${superAdminOrgId}: clientId=${clientId.substring(0, 8)}..., secret len=${clientSecret.length}`);
        }
      }
      
      // PRIORITY 2: If not in SuperAdmin org, scan all orgs
      if (!clientId || !clientSecret) {
        const orgIds = await storage.getAllOrganizationIds();
        for (const orgId of orgIds) {
          if (orgId === superAdminOrgId) continue; // Already checked
          const settings = await storage.getApiSettings(orgId);
          if (settings[idKey] && settings[secretKey]) {
            clientId = settings[idKey];
            clientSecret = settings[secretKey];
            foundInOrgId = orgId;
            console.log(`[OAuth] Found ${provider} credentials in org ${orgId}: clientId=${clientId.substring(0, 8)}..., secret len=${clientSecret.length}`);
            break;
          }
        }
      }
      
      if (!foundInOrgId) {
        console.log(`[OAuth] No ${provider} credentials found in any org, falling back to env vars`);
      }
    } catch (e) {
      console.error(`[OAuth] Failed to load ${provider} credentials from DB:`, e instanceof Error ? e.message : e);
    }
    
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
      
      // CRITICAL: If users exist in the DB, the system was already set up.
      // Don't show setup wizard even if OAuth credentials can't be found
      // (they may have been lost due to Azure container restart with ephemeral storage).
      // Instead, redirect to login page and let admin re-configure OAuth in settings.
      const needsSetup = !hasOAuth && !hasUsers;
      
      res.json({
        needsSetup,
        hasUsers,
        hasSuperAdmin,
        googleConfigured: !!googleId,
        microsoftConfigured: !!msId,
      });
    } catch (error) {
      console.error('[Setup] Status check failed:', error instanceof Error ? error.message : error);
      // CRITICAL: On error, do NOT default to needsSetup: true.
      // This prevents the setup wizard from appearing on transient DB errors.
      // If the DB is truly empty, the next request after recovery will handle it.
      res.json({ needsSetup: false, hasUsers: true, hasSuperAdmin: false, googleConfigured: false, microsoftConfigured: false });
    }
  });

  // Initial setup: Save OAuth credentials (only when no OAuth is configured AND no users exist)
  app.post('/api/setup/oauth', async (req, res) => {
    try {
      // Check if system is already set up (OAuth configured OR users exist)
      const { clientId: existingGoogle } = await getStoredOAuthCredentials('google');
      const { clientId: existingMs } = await getStoredOAuthCredentials('microsoft');
      const stats = await storage.getPlatformStats();
      const hasUsers = stats.totalUsers > 0;
      
      if (existingGoogle || existingMs) {
        return res.status(403).json({ error: 'OAuth is already configured. Use the admin settings page to modify.' });
      }
      if (hasUsers) {
        return res.status(403).json({ error: 'System already has users. OAuth can only be reconfigured from admin settings.' });
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
      // Use canonical redirect URI to avoid www vs non-www mismatches
      const redirectUri = getGoogleRedirectUri(req);

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
          'https://www.googleapis.com/auth/gmail.modify',
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
      let redirectUri = getGoogleRedirectUri(req);
      let purpose = 'login'; // default
      let stateOrgId = '';
      let returnTo = '';
      let stateUserId = '';
      try {
        if (state) {
          const parsed = JSON.parse(state as string);
          if (parsed.redirectUri) redirectUri = parsed.redirectUri;
          if (parsed.purpose) purpose = parsed.purpose;
          if (parsed.orgId) stateOrgId = parsed.orgId;
          if (parsed.returnTo) returnTo = parsed.returnTo;
          if (parsed.userId) stateUserId = parsed.userId;
        }
      } catch (e) { /* use default */ }

      // Load credentials
      const { clientId, clientSecret } = await getStoredOAuthCredentials('google');

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      // Log granted scopes so we can diagnose missing-scope cases (e.g. user
      // declined sheets access). tokens.scope is a space-separated string when
      // present; absence usually means the IDP didn't echo scopes (treat as best-effort).
      if ((tokens as any).scope) {
        console.log('[Auth] Google OAuth granted scopes:', (tokens as any).scope);
        if (!String((tokens as any).scope).includes('spreadsheets')) {
          console.warn('[Auth] WARNING: spreadsheets scope NOT in granted scopes — user likely declined that scope on the consent screen, or the OAuth client config in Google Cloud doesn\'t include it.');
        }
      }

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

      // ===== GMAIL-CONNECT (ADD SENDER OR SCAN-ONLY) FLOW =====
      // purpose === 'add_sender': /api/auth/gmail-connect — full send-capable account
      // purpose === 'scan_only':  /api/auth/gmail-scan-connect — read-only for Lead Intelligence
      // Both store per-sender tokens. The only differences for scan_only:
      //   - Account is created with scanOnly=1 (hidden from send paths and Email Accounts UI)
      //   - We don't overwrite org-level "primary" tokens
      //   - We don't replicate to the user's other orgs (scan-only is per-org intent)
      if (purpose === 'add_sender' || purpose === 'scan_only') {
        const isScanOnly = purpose === 'scan_only';
        console.log(`[Auth] Gmail-connect flow for: ${email} (mode=${isScanOnly ? 'scan_only' : 'add_sender'}) stateOrgId: ${stateOrgId}, stateUserId: ${stateUserId}`);
        const orgId = stateOrgId || (req.session as any)?.user?.organizationId || '';
        
        // Fallback: get first org if orgId not in state
        let effectiveOrgId = orgId;
        if (!effectiveOrgId) {
          const orgIds = await storage.getAllOrganizationIds();
          effectiveOrgId = orgIds[0] || '';
        }

        // CRITICAL: Also check if the email account already exists in a DIFFERENT org
        try {
          const existingByEmail = await storage.findEmailAccountByEmail(email);
          if (existingByEmail && (existingByEmail as any).organizationId) {
            const accountOrgId = (existingByEmail as any).organizationId;
            if (accountOrgId !== effectiveOrgId) {
              console.log(`[Auth] IMPORTANT: Gmail account ${email} belongs to org ${accountOrgId}, but state has org ${effectiveOrgId}. Using ACCOUNT's org.`);
              effectiveOrgId = accountOrgId;
            }
          }
        } catch (e) {
          console.warn('[Auth] Could not look up Gmail account org:', e);
        }

        console.log(`[Auth] Storing Gmail tokens for ${email} in org: ${effectiveOrgId}`);

        // Store per-sender tokens
        if (tokens.access_token) {
          await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_access_token`, tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_refresh_token`, tokens.refresh_token);
        } else {
          console.warn('[Auth] No refresh_token returned on re-auth for', email, '- Google may not have issued one. prompt:consent should force this.');
        }
        // Always store a valid expiry — use expiry_date if provided, otherwise calculate from expires_in.
        // Google omits expiry_date on re-auth reconnects, which left stale expired values in DB causing refresh hangs.
        const expiryToStore = tokens.expiry_date || (tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : Date.now() + 3600000);
        await storage.setApiSetting(effectiveOrgId, `gmail_sender_${email}_token_expiry`, String(expiryToStore));

        // Active-session failsafe: if effectiveOrgId got overridden to the existing-account's
        // org (line 681-687), the user's currently-active session might be in a different org
        // and won't see the fresh tokens — leading to the "Re-authenticate Gmail" loop on
        // /api/sheets/fetch-info. Always also write tokens to stateOrgId (the org the flow
        // was initiated from) so the active session can find a sheets-capable token.
        if (stateOrgId && stateOrgId !== effectiveOrgId) {
          if (tokens.access_token) await storage.setApiSetting(stateOrgId, `gmail_sender_${email}_access_token`, tokens.access_token);
          if (tokens.refresh_token) await storage.setApiSetting(stateOrgId, `gmail_sender_${email}_refresh_token`, tokens.refresh_token);
          await storage.setApiSetting(stateOrgId, `gmail_sender_${email}_token_expiry`, String(expiryToStore));
          console.log(`[Auth] Active-session failsafe: also stored ${email} tokens in stateOrgId ${stateOrgId} (effectiveOrgId was overridden to ${effectiveOrgId})`);
        }

        // ONLY update org-level tokens if this IS the primary account or no primary exists yet
        // CRITICAL FIX: Do NOT overwrite org-level tokens with a secondary account's tokens!
        // e.g., if primary is dev@aegis.edu.in, connecting bharatai5@aegis.edu.in should NOT overwrite org tokens
        // Also: scan-only accounts are never the primary — they're read-only for Lead Intelligence.
        if (!isScanOnly) {
          const currentSettings = await storage.getApiSettings(effectiveOrgId);
          const primaryEmail = currentSettings.gmail_user_email;
          const isPrimaryAccount = !primaryEmail || primaryEmail === email;

          if (isPrimaryAccount) {
            console.log('[Auth] Updating org-level tokens (primary account or first account). email:', email);
            await storage.setApiSetting(effectiveOrgId, 'gmail_access_token', tokens.access_token!);
            if (tokens.refresh_token) await storage.setApiSetting(effectiveOrgId, 'gmail_refresh_token', tokens.refresh_token);
            if (tokens.expiry_date) await storage.setApiSetting(effectiveOrgId, 'gmail_token_expiry', String(tokens.expiry_date));
            if (!primaryEmail) await storage.setApiSetting(effectiveOrgId, 'gmail_user_email', email);
          } else {
            console.log(`[Auth] NOT overwriting org-level tokens: primary is ${primaryEmail}, this is ${email} (per-sender tokens stored above)`);
          }
        } else {
          console.log(`[Auth] scan-only account ${email} — skipping org-level primary token assignment`);
        }

        // Create or update email account
        // Use getEmailAccountIncludingInactive so soft-deleted accounts are found and reactivated
        // (preserving the original ID so campaigns/messages stay linked)
        const existingAccount = await (storage as any).getEmailAccountIncludingInactive
          ? await (storage as any).getEmailAccountIncludingInactive(effectiveOrgId, email)
          : (await storage.getEmailAccounts(effectiveOrgId)).find((a: any) => a.email.toLowerCase() === email.toLowerCase());
        if (!existingAccount) {
          // Use userId from OAuth state (set by /api/auth/gmail-connect) for reliable member attribution
          const currentUserId = stateUserId || (req.session as any)?.userId || req.cookies?.user_id || null;
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
            scanOnly: isScanOnly,
          });
          console.log(`[Auth] New Gmail ${isScanOnly ? 'scan-only' : 'sender'} added via OAuth: ${email}`);
        } else {
          // Account exists (active or soft-deleted) — update tokens and reactivate.
          // If user reconnects an existing sender via the scan-only path (or vice versa),
          // we keep the existing scanOnly value to avoid surprise transitions. Admin must
          // delete and re-add to switch modes.
          const needsOAuthUpgrade = existingAccount.smtpConfig?.auth?.pass && existingAccount.smtpConfig.auth.pass !== 'OAUTH_TOKEN';
          await storage.updateEmailAccount(existingAccount.id, {
            ...(needsOAuthUpgrade ? {
              smtpConfig: { ...existingAccount.smtpConfig, auth: { user: email, pass: 'OAUTH_TOKEN' }, provider: 'gmail' },
              provider: 'gmail',
              displayName: name || existingAccount.displayName,
            } : {}),
            isActive: true,
            authStatus: null,
            authFailureCount: 0,
            authLastFailureAt: null,
            authLastErrorCode: null,
          });
          console.log(`[Auth] Gmail ${existingAccount.scanOnly ? 'scan-only ' : ''}${existingAccount.isActive ? 'reconnected' : 'reactivated (was soft-deleted)'}: ${email} (id: ${existingAccount.id})`);
        }

        // Also create the email account in other orgs the user belongs to.
        // SKIP this for scan-only accounts — scan-only is per-org intent (admin connecting
        // a mailbox specifically for THIS org's lead intelligence).
        const connectingUserId = stateUserId || (req.session as any)?.userId || req.cookies?.user_id || null;
        if (connectingUserId && !isScanOnly) {
          try {
            const userOrgs = await storage.getUserOrganizations(connectingUserId);
            for (const org of userOrgs) {
              const otherOrgId = (org as any).id;
              if (otherOrgId === effectiveOrgId) continue; // already handled above

              // Store per-sender tokens in this org too
              if (tokens.access_token) await storage.setApiSetting(otherOrgId, `gmail_sender_${email}_access_token`, tokens.access_token);
              if (tokens.refresh_token) await storage.setApiSetting(otherOrgId, `gmail_sender_${email}_refresh_token`, tokens.refresh_token);
              await storage.setApiSetting(otherOrgId, `gmail_sender_${email}_token_expiry`, String(expiryToStore));

              // Create email account in other org if it doesn't exist
              const otherAccounts = await storage.getEmailAccounts(otherOrgId);
              const existsInOtherOrg = otherAccounts.find((a: any) => a.email.toLowerCase() === email.toLowerCase());
              if (!existsInOtherOrg) {
                await storage.createEmailAccount({
                  organizationId: otherOrgId,
                  userId: connectingUserId,
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
                console.log(`[Auth] Also added Gmail sender ${email} to org ${otherOrgId}`);
              }
            }
          } catch (e) {
            console.warn(`[Auth] Could not replicate Gmail account to other orgs:`, e);
          }
        }

        // Redirect back to the page that initiated the flow
        if (isScanOnly) {
          return res.redirect('/#lead-intelligence?scan_only_connected=' + encodeURIComponent(email));
        }
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
          const alreadyExists = (storage as any).getEmailAccountIncludingInactive
            ? await (storage as any).getEmailAccountIncludingInactive(userOrgId, email)
            : (await storage.getEmailAccounts(userOrgId)).find((a: any) => a.email.toLowerCase() === email.toLowerCase());
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
            // Account exists (active or soft-deleted) — reactivate and upgrade to OAuth if needed
            const needsUpgrade = alreadyExists.smtpConfig?.auth?.pass && alreadyExists.smtpConfig.auth.pass !== 'OAUTH_TOKEN';
            await storage.updateEmailAccount(alreadyExists.id, {
              ...(needsUpgrade ? {
                smtpConfig: { ...alreadyExists.smtpConfig, auth: { user: email, pass: 'OAUTH_TOKEN' }, provider: 'gmail' },
                provider: 'gmail',
              } : {}),
              isActive: true,
            });
            console.log('[Auth] Gmail sender account reactivated/updated:', email);
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
      // Use canonical redirect URI (same as main login flow, registered in Google Cloud Console)
      const redirectUri = getGoogleRedirectUri(req);
      let orgId = req.user.organizationId;

      // CRITICAL FIX: When re-authenticating an existing email account,
      // use the ACCOUNT's organizationId (not the logged-in user's org).
      const loginHint = req.query.email as string || '';
      if (loginHint) {
        try {
          const existingAccount = await storage.findEmailAccountByEmail(loginHint);
          if (existingAccount) {
            orgId = (existingAccount as any).organizationId || orgId;
            console.log(`[Auth] Gmail re-auth: using account's org ${orgId} for ${loginHint} (logged-in user org: ${req.user.organizationId})`);
          }
        } catch (e) {
          console.warn('[Auth] Could not look up existing email account for org resolution:', e);
        }
      }

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
      // Support returnTo parameter so we can redirect back to the page that initiated the flow
      const returnTo = req.query.returnTo as string || '';
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/spreadsheets.readonly',
        ],
        state: JSON.stringify({ redirectUri, purpose: 'add_sender', orgId, userId: req.user.id, returnTo }),
        ...(loginHint ? { login_hint: loginHint } : {}),
      });

      console.log('[Auth] Gmail connect redirect for org:', orgId, 'hint:', loginHint || 'none', 'user-org:', req.user.organizationId);
      res.redirect(authUrl);
    } catch (error) {
      console.error('[Auth] Gmail connect init error:', error);
      res.redirect('/?view=setup&error=gmail_connect_failed');
    }
  });

  // ===== ADD SCAN-ONLY GMAIL ACCOUNT =====
  // Like /api/auth/gmail-connect but flags the resulting email_account as scanOnly=1.
  // Account will be invisible to send paths, reply trackers, and the Email Accounts UI.
  // Used by the Lead Intelligence page to connect mailboxes for read-only analysis.
  app.get('/api/auth/gmail-scan-connect', requireAuth, async (req: any, res) => {
    try {
      const redirectUri = getGoogleRedirectUri(req);
      const orgId = req.user.organizationId;

      // Resolve OAuth credentials (same fallback chain as gmail-connect)
      let clientId = '';
      let clientSecret = '';
      try {
        const settings = await storage.getApiSettings(orgId);
        if (settings.google_oauth_client_id) {
          clientId = settings.google_oauth_client_id;
          clientSecret = settings.google_oauth_client_secret || '';
        }
      } catch (e) { /* ignore */ }
      if (!clientId || !clientSecret) {
        try {
          const superAdminOrgId = await storage.getSuperAdminOrgId();
          if (superAdminOrgId && superAdminOrgId !== orgId) {
            const superSettings = await storage.getApiSettings(superAdminOrgId);
            if (superSettings.google_oauth_client_id) {
              clientId = superSettings.google_oauth_client_id;
              clientSecret = superSettings.google_oauth_client_secret || '';
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (!clientId || !clientSecret) {
        const creds = await getStoredOAuthCredentials('google');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      }
      if (!clientId || !clientSecret) {
        return res.redirect('/#lead-intelligence?error=oauth_not_configured');
      }

      const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        // Scan-only intent — but request the same Gmail API scopes the existing
        // tracker/scanner needs so a single OAuth grant covers all read paths.
        // We deliberately also include userinfo for displayName.
        scope: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        state: JSON.stringify({ redirectUri, purpose: 'scan_only', orgId, userId: req.user.id, returnTo: 'lead-intelligence' }),
      });

      console.log('[Auth] Gmail scan-connect redirect for org:', orgId);
      res.redirect(authUrl);
    } catch (error) {
      console.error('[Auth] Gmail scan-connect init error:', error);
      res.redirect('/#lead-intelligence?error=gmail_scan_connect_failed');
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
      const redirectUri = getMicrosoftRedirectUri(req);

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
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/SMTP.Send',
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
        return res.redirect('/?error=ms_oauth_denied&view=setup');
      }

      if (!code) {
        return res.redirect('/?error=ms_no_code&view=setup');
      }

      // Parse state to get the redirect URI used during initiation
      let parsedState: any = {};
      try {
        if (state) {
          parsedState = JSON.parse(state as string);
        }
      } catch (e) {
        console.error('[Auth] Failed to parse OAuth state:', e);
      }

      // CRITICAL: Use the EXACT redirectUri from the state parameter.
      // This is the same URI that was sent to Microsoft during authorization.
      // It MUST match exactly for the token exchange to succeed.
      // If state doesn't have it, use the canonical URI as fallback.
      const canonicalRedirectUri = getMicrosoftRedirectUri(req);
      const redirectUri = parsedState.redirectUri || canonicalRedirectUri;

      console.log('[Auth] Microsoft callback - redirectUri from state:', parsedState.redirectUri || 'NONE (using canonical)');
      console.log('[Auth] Microsoft callback - canonical redirectUri:', canonicalRedirectUri);
      console.log('[Auth] Microsoft callback - FINAL redirectUri for token exchange:', redirectUri);
      console.log('[Auth] Microsoft callback - purpose:', parsedState.purpose || 'login');
      console.log('[Auth] Microsoft callback - host:', req.headers['host'], 'x-fwd-host:', req.headers['x-forwarded-host'] || 'NONE', 'x-orig-host:', req.headers['x-original-host'] || 'NONE');

      // Load credentials
      const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');
      if (!clientId || !clientSecret) {
        console.error('[Auth] Microsoft OAuth credentials not found');
        return res.redirect('/?error=ms_no_credentials&view=setup');
      }

      // Exchange authorization code for tokens
      // NOTE: Authorization codes are SINGLE USE. Do NOT retry with different redirect_uri.
      const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code as string,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error('[Auth] Microsoft token exchange FAILED:', tokenResponse.status, errBody);
        console.error('[Auth] Used redirectUri:', redirectUri);
        console.error('[Auth] Used clientId:', clientId.substring(0, 8) + '...');
        
        // Parse Microsoft error for user-friendly message
        let msError = 'unknown';
        let msErrorDesc = '';
        try {
          const errJson = JSON.parse(errBody);
          msError = errJson.error || 'unknown';
          msErrorDesc = errJson.error_description || '';
          console.error('[Auth] Microsoft error code:', errJson.error, 'description:', errJson.error_description);
        } catch (e) { /* not JSON */ }
        
        return res.redirect(`/?error=ms_token_failed&ms_error=${encodeURIComponent(msError)}&ms_desc=${encodeURIComponent(msErrorDesc.substring(0, 200))}&view=setup`);
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

      // Use already-parsed state for purpose (add_sender vs login)
      const purpose = parsedState.purpose || '';
      const stateOrgId = parsedState.orgId || '';
      const stateUserId = parsedState.userId || '';
      console.log(`[Auth] Microsoft callback - email: ${email}, purpose: ${purpose}, stateOrgId: ${stateOrgId}, stateUserId: ${stateUserId}`);

      // ===== OUTLOOK-CONNECT (ADD SENDER OR SCAN-ONLY) FLOW =====
      if (purpose === 'add_sender' || purpose === 'scan_only') {
        const isScanOnly = purpose === 'scan_only';
        console.log(`[Auth] Outlook-connect flow for: ${email} (mode=${isScanOnly ? 'scan_only' : 'add_sender'}) stateOrgId: ${stateOrgId}, stateUserId: ${stateUserId}`);
        let effectiveOrgId = stateOrgId || (req.session as any)?.user?.organizationId || '';
        if (!effectiveOrgId) {
          const orgIds = await storage.getAllOrganizationIds();
          effectiveOrgId = orgIds[0] || '';
        }

        // CRITICAL: Also check if the email account already exists in a DIFFERENT org
        // (e.g., SuperAdmin from org-A re-authenticating an account in org-B)
        let accountOrgId = effectiveOrgId;
        try {
          const existingByEmail = await storage.findEmailAccountByEmail(email);
          if (existingByEmail && (existingByEmail as any).organizationId) {
            accountOrgId = (existingByEmail as any).organizationId;
            if (accountOrgId !== effectiveOrgId) {
              console.log(`[Auth] IMPORTANT: Account ${email} belongs to org ${accountOrgId}, but state has org ${effectiveOrgId}. Storing tokens in ACCOUNT's org.`);
              effectiveOrgId = accountOrgId; // Use the account's org for token storage
            }
          }
        } catch (e) {
          console.warn('[Auth] Could not look up account org for token storage:', e);
        }

        console.log(`[Auth] Storing Outlook tokens for ${email} in org: ${effectiveOrgId}`);

        // Store per-sender tokens
        if (tokens.access_token) {
          await storage.setApiSetting(effectiveOrgId, `outlook_sender_${email}_access_token`, tokens.access_token);
        }
        if (tokens.refresh_token) {
          await storage.setApiSetting(effectiveOrgId, `outlook_sender_${email}_refresh_token`, tokens.refresh_token);
        }
        if (tokens.expires_in) {
          const expiryDate = Date.now() + (tokens.expires_in * 1000);
          await storage.setApiSetting(effectiveOrgId, `outlook_sender_${email}_token_expiry`, String(expiryDate));
        }

        // Verify tokens were stored
        const verifySettings = await storage.getApiSettings(effectiveOrgId);
        const storedToken = verifySettings[`outlook_sender_${email}_access_token`];
        console.log(`[Auth] Token storage verification for ${email}: token stored = ${!!storedToken}, org = ${effectiveOrgId}`);

        // Only update org-level tokens if this is the primary Outlook account or first account.
        // Scan-only accounts are never the primary — skip this block for them.
        if (!isScanOnly) {
          const currentSettings = await storage.getApiSettings(effectiveOrgId);
          const primaryMsEmail = currentSettings.microsoft_user_email;
          const isPrimary = !primaryMsEmail || primaryMsEmail === email;

          if (isPrimary) {
            await storage.setApiSetting(effectiveOrgId, 'microsoft_access_token', tokens.access_token);
            if (tokens.refresh_token) await storage.setApiSetting(effectiveOrgId, 'microsoft_refresh_token', tokens.refresh_token);
            if (tokens.expires_in) await storage.setApiSetting(effectiveOrgId, 'microsoft_token_expiry', String(Date.now() + tokens.expires_in * 1000));
            if (!primaryMsEmail) await storage.setApiSetting(effectiveOrgId, 'microsoft_user_email', email);
          }
        } else {
          console.log(`[Auth] scan-only Outlook account ${email} — skipping org-level primary token assignment`);
        }

        // Create or update email account — check including soft-deleted to preserve ID
        const existingAccount = await (storage as any).getEmailAccountIncludingInactive
          ? await (storage as any).getEmailAccountIncludingInactive(effectiveOrgId, email)
          : (await storage.getEmailAccounts(effectiveOrgId)).find((a: any) => a.email.toLowerCase() === email.toLowerCase());
        if (!existingAccount) {
          const currentUserId = stateUserId || (req.session as any)?.userId || req.cookies?.user_id || null;
          await storage.createEmailAccount({
            organizationId: effectiveOrgId,
            userId: currentUserId,
            provider: 'outlook',
            email,
            displayName: name,
            smtpConfig: {
              host: 'smtp-mail.outlook.com', port: 587, secure: false,
              auth: { user: email, pass: 'OAUTH_TOKEN' },
              fromName: name, fromEmail: email, replyTo: '',
              provider: 'outlook',
            },
            dailyLimit: getProviderDailyLimit('outlook'),
            isActive: true,
            scanOnly: isScanOnly,
          });
          console.log(`[Auth] New Outlook ${isScanOnly ? 'scan-only' : 'sender'} added via OAuth: ${email}`);
        } else {
          // Account exists (active or soft-deleted) — update tokens and reactivate
          const needsOAuthUpgrade = existingAccount.smtpConfig?.auth?.pass && existingAccount.smtpConfig.auth.pass !== 'OAUTH_TOKEN';
          await storage.updateEmailAccount(existingAccount.id, {
            ...(needsOAuthUpgrade ? {
              smtpConfig: { ...existingAccount.smtpConfig, auth: { user: email, pass: 'OAUTH_TOKEN' }, provider: 'outlook' },
              provider: 'outlook',
              displayName: name || existingAccount.displayName,
            } : {}),
            isActive: true,
            authStatus: null,
            authFailureCount: 0,
            authLastFailureAt: null,
            authLastErrorCode: null,
          });
          console.log(`[Auth] Outlook ${existingAccount.scanOnly ? 'scan-only ' : ''}${existingAccount.isActive ? 'reconnected' : 'reactivated (was soft-deleted)'}: ${email} (id: ${existingAccount.id})`);
        }

        // Also create the email account in other orgs the user belongs to.
        // SKIP for scan-only — scan-only is per-org intent.
        const connectingUserId = stateUserId || (req.session as any)?.userId || req.cookies?.user_id || null;
        if (connectingUserId && !isScanOnly) {
          try {
            const userOrgs = await storage.getUserOrganizations(connectingUserId);
            for (const org of userOrgs) {
              const otherOrgId = (org as any).id;
              if (otherOrgId === effectiveOrgId) continue; // already handled above

              // Store per-sender tokens in this org too
              if (tokens.access_token) await storage.setApiSetting(otherOrgId, `outlook_sender_${email}_access_token`, tokens.access_token);
              if (tokens.refresh_token) await storage.setApiSetting(otherOrgId, `outlook_sender_${email}_refresh_token`, tokens.refresh_token);
              if (tokens.expires_in) await storage.setApiSetting(otherOrgId, `outlook_sender_${email}_token_expiry`, String(Date.now() + tokens.expires_in * 1000));

              // Create email account in other org if it doesn't exist
              const otherAccounts = await storage.getEmailAccounts(otherOrgId);
              const existsInOtherOrg = otherAccounts.find((a: any) => a.email.toLowerCase() === email.toLowerCase());
              if (!existsInOtherOrg) {
                await storage.createEmailAccount({
                  organizationId: otherOrgId,
                  userId: connectingUserId,
                  provider: 'outlook',
                  email,
                  displayName: name,
                  smtpConfig: {
                    host: 'smtp-mail.outlook.com', port: 587, secure: false,
                    auth: { user: email, pass: 'OAUTH_TOKEN' },
                    fromName: name, fromEmail: email, replyTo: '',
                    provider: 'outlook',
                  },
                  dailyLimit: getProviderDailyLimit('outlook'),
                  isActive: true,
                });
                console.log(`[Auth] Also added Outlook sender ${email} to org ${otherOrgId}`);
              }
            }
          } catch (e) {
            console.warn(`[Auth] Could not replicate email account to other orgs:`, e);
          }
        }

        // Start Outlook reply tracking — only for send-capable accounts.
        // Scan-only accounts are read by the lead intelligence engine, not the reply tracker.
        if (!isScanOnly) {
          outlookReplyTracker.startAutoCheck(effectiveOrgId, 5);
        }

        if (isScanOnly) {
          return res.redirect('/#lead-intelligence?scan_only_connected=' + encodeURIComponent(email));
        }
        return res.redirect('/?view=setup&outlook_connected=' + encodeURIComponent(email));
      }

      // ===== NORMAL LOGIN FLOW =====

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
          const alreadyExists = existingAccounts.find((a: any) => a.email.toLowerCase() === email.toLowerCase());
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
            // Upgrade existing SMTP-password account to OAuth if needed
            const needsUpgrade = alreadyExists.smtpConfig?.auth?.pass && alreadyExists.smtpConfig.auth.pass !== 'OAUTH_TOKEN';
            if (needsUpgrade) {
              await storage.updateEmailAccount(alreadyExists.id, {
                smtpConfig: {
                  ...alreadyExists.smtpConfig,
                  auth: { user: email, pass: 'OAUTH_TOKEN' },
                  provider: 'outlook',
                },
                provider: 'outlook',
              });
              console.log('[Auth] Upgraded Outlook sender from SMTP to OAuth:', email);
            } else {
              console.log('[Auth] Outlook sender account already exists:', email);
            }
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

  // ===== OUTLOOK CONNECT (Add Sender) =====
  // Similar to /api/auth/gmail-connect — adds an Outlook account to the current org
  // without changing the logged-in user's session
  app.get('/api/auth/outlook-connect', requireAuth, async (req: any, res) => {
    try {
      const redirectUri = getMicrosoftRedirectUri(req);
      let orgId = req.user.organizationId;

      // CRITICAL FIX: When re-authenticating an existing email account,
      // use the ACCOUNT's organizationId (not the logged-in user's org).
      // This handles the case where a SuperAdmin from org-A re-authenticates
      // an account that belongs to org-B.
      const loginHint = req.query.email as string || '';
      if (loginHint) {
        try {
          const existingAccount = await storage.findEmailAccountByEmail(loginHint);
          if (existingAccount) {
            orgId = (existingAccount as any).organizationId || orgId;
            console.log(`[Auth] Outlook re-auth: using account's org ${orgId} for ${loginHint} (logged-in user org: ${req.user.organizationId})`);
          }
        } catch (e) {
          console.warn('[Auth] Could not look up existing email account for org resolution:', e);
        }
      }

      // Load credentials from api_settings first, then env vars
      const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');

      if (!clientId || !clientSecret) {
        console.warn('[Auth] Microsoft OAuth not configured');
        return res.redirect('/?view=setup&error=oauth_not_configured&provider=microsoft');
      }

      const scopes = [
        'openid',
        'profile',
        'email',
        'offline_access',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.ReadWrite',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/SMTP.Send',
      ];

      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', scopes.join(' '));
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', JSON.stringify({ 
        redirectUri, 
        purpose: 'add_sender', 
        orgId, 
        userId: req.user.id 
      }));
      if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

      console.log('[Auth] Outlook connect redirect - org:', orgId, 'hint:', loginHint || 'none', 'user-org:', req.user.organizationId, 'redirectUri:', redirectUri);
      res.redirect(authUrl.toString());
    } catch (error) {
      console.error('[Auth] Outlook connect init error:', error);
      res.redirect('/?view=setup&error=outlook_connect_failed');
    }
  });

  // ===== ADD SCAN-ONLY OUTLOOK ACCOUNT =====
  // Like /api/auth/outlook-connect but flags the resulting email_account as scanOnly=1.
  // Account will be invisible to send paths, reply trackers, and the Email Accounts UI.
  app.get('/api/auth/outlook-scan-connect', requireAuth, async (req: any, res) => {
    try {
      const redirectUri = getMicrosoftRedirectUri(req);
      const orgId = req.user.organizationId;
      const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');
      if (!clientId || !clientSecret) {
        return res.redirect('/#lead-intelligence?error=oauth_not_configured');
      }
      // Read-only scopes — Mail.Read for /me/messages access, User.Read for displayName.
      // Reuses same redirect URI so registration in Azure stays unchanged.
      const scopes = [
        'openid', 'profile', 'email', 'offline_access',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
      ];
      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', scopes.join(' '));
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', JSON.stringify({
        redirectUri,
        purpose: 'scan_only',
        orgId,
        userId: req.user.id,
      }));
      console.log('[Auth] Outlook scan-connect redirect - org:', orgId);
      res.redirect(authUrl.toString());
    } catch (error) {
      console.error('[Auth] Outlook scan-connect init error:', error);
      res.redirect('/#lead-intelligence?error=outlook_scan_connect_failed');
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

    // Debug mode: ?debug=true returns diagnostic info for troubleshooting OAuth issues
    if (req.query.debug === 'true') {
      try {
        const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');
        const dynamicBaseUrl = getBaseUrlFromRequest(req);
        const dynamicRedirectUri = `${dynamicBaseUrl}/api/auth/microsoft/callback`;
        const canonicalRedirectUri = getMicrosoftRedirectUri(req);
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        
        // Check all orgs for Microsoft OAuth credentials and tokens
        const orgIds = await storage.getAllOrganizationIds();
        const oauthCredentialStatus: any[] = [];
        const tokenStatus: any[] = [];
        for (const orgId of orgIds) {
          const settings = await storage.getApiSettings(orgId);
          const org = await storage.getOrganization(orgId);
          const orgName = (org as any)?.name || 'unknown';
          const isSuperAdminOrg = orgId === superAdminOrgId;
          
          // Check OAuth credentials in this org
          if (settings.microsoft_oauth_client_id) {
            oauthCredentialStatus.push({
              orgId,
              orgName,
              isSuperAdminOrg,
              hasClientId: true,
              clientIdPreview: settings.microsoft_oauth_client_id.substring(0, 8) + '...',
              hasClientSecret: !!settings.microsoft_oauth_client_secret,
              clientSecretLength: settings.microsoft_oauth_client_secret?.length || 0,
              clientSecretPreview: settings.microsoft_oauth_client_secret ? settings.microsoft_oauth_client_secret.substring(0, 4) + '...' : 'EMPTY',
            });
          }
          
          // Check tokens in this org
          const msKeys = Object.keys(settings).filter(k => k.includes('outlook_sender_') || k.includes('microsoft_'));
          if (msKeys.length > 0) {
            tokenStatus.push({
              orgId,
              orgName,
              isSuperAdminOrg,
              keys: msKeys.map(k => ({ key: k, hasValue: !!settings[k], preview: k.includes('token') ? (settings[k] ? settings[k].substring(0, 10) + '...' : 'EMPTY') : settings[k] })),
            });
          }
        }

        return res.json({
          diagnostics: true,
          superAdminOrgId: superAdminOrgId || 'NOT FOUND',
          credentialsUsed: {
            clientId: clientId ? clientId.substring(0, 8) + '...' + clientId.substring(clientId.length - 4) : 'MISSING',
            clientSecretPresent: !!clientSecret,
            clientSecretLength: clientSecret ? clientSecret.length : 0,
            clientSecretPreview: clientSecret ? clientSecret.substring(0, 4) + '...' : 'EMPTY',
          },
          oauthCredentialsByOrg: oauthCredentialStatus,
          canonicalRedirectUri,
          dynamicRedirectUri,
          note: canonicalRedirectUri === dynamicRedirectUri ? 'MATCH - canonical equals dynamic' : 'MISMATCH - canonical differs from dynamic! This was the bug.',
          hostHeader: req.headers['host'],
          xForwardedHost: req.headers['x-forwarded-host'] || 'NONE',
          xOriginalHost: req.headers['x-original-host'] || 'NONE',
          xForwardedProto: req.headers['x-forwarded-proto'] || 'NONE',
          registeredRedirectUris: [
            'https://aimailpilot.com/api/auth/microsoft/callback',
            'https://www.aimailpilot.com/api/auth/microsoft/callback',
          ],
          tokenStatus,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        return res.json({ diagnostics: true, error: e instanceof Error ? e.message : String(e) });
      }
    }

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

  // ========== POSTGRESQL HEALTH CHECK ==========
  // Quick smoke test after cutover: GET /api/pg-health
  app.get('/api/pg-health', async (_req, res) => {
    const results: Record<string, any> = {
      backend: process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
      timestamp: new Date().toISOString(),
    };
    const checks = [
      { name: 'organizations', sql: 'SELECT COUNT(*) as cnt FROM organizations' },
      { name: 'users', sql: 'SELECT COUNT(*) as cnt FROM users' },
      { name: 'contacts', sql: 'SELECT COUNT(*) as cnt FROM contacts' },
      { name: 'campaigns', sql: 'SELECT COUNT(*) as cnt FROM campaigns' },
      { name: 'email_accounts', sql: 'SELECT COUNT(*) as cnt FROM email_accounts' },
      { name: 'messages', sql: 'SELECT COUNT(*) as cnt FROM messages' },
      { name: 'unified_inbox', sql: 'SELECT COUNT(*) as cnt FROM unified_inbox' },
      { name: 'api_settings', sql: 'SELECT COUNT(*) as cnt FROM api_settings' },
    ];
    let allOk = true;
    for (const check of checks) {
      try {
        const row = await storage.rawGet(check.sql);
        results[check.name] = row?.cnt ?? 0;
      } catch (e: any) {
        results[check.name] = `ERROR: ${e.message}`;
        allOk = false;
      }
    }
    results.ok = allOk;
    res.status(allOk ? 200 : 500).json(results);
  });

  app.get('/api/auth/user', async (req, res) => {
    const session = req.session as any;
    const userId = req.cookies?.user_id || session?.userId;
    const userData = req.cookies?.user_data;

    // Helper: look up org role for a user
    const getUserRole = async (uid: string) => {
      try {
        const orgId = session?.activeOrgId;
        if (orgId) {
          const membership = await storage.getOrgMember(orgId, uid);
          if (membership) return (membership as any).role;
        }
        const defaultOrg = await storage.getUserDefaultOrganization(uid);
        if (defaultOrg) return defaultOrg.memberRole || 'admin';
      } catch (e) { /* ignore */ }
      return 'member';
    };

    if (session?.user) {
      // Ensure role is included
      if (!session.user.role && userId) {
        session.user.role = await getUserRole(userId);
      }
      return res.json(session.user);
    }

    // Try restoring from cookie data first (existing behavior)
    if (userId && loggedInUsers.has(userId) && userData) {
      try {
        const user = JSON.parse(userData);
        user.role = await getUserRole(userId);
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
          const role = await getUserRole(userId);
          const userObj = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name || dbUser.email,
            provider: dbUser.provider || 'google',
            role,
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
    if (userId) {
      loggedInUsers.delete(userId);
      // Clear auth cache for this user
      for (const key of authCache.keys()) {
        if (key.startsWith(`${userId}:`)) authCache.delete(key);
      }
    }
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

  // ========== VERIFICATION FILES ==========
  // Microsoft domain verification
  app.get('/.well-known/microsoft-identity-association.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      "associatedApplications": [
        {
          "applicationId": "15b15ca5-83ac-4219-9cc1-d27496017352"
        }
      ]
    }));
  });

  // Google site verification
  app.get('/googledc2a820e33a8a478.html', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send('google-site-verification: googledc2a820e33a8a478.html');
  });

  // ========== BRANDING / LEGAL PAGES ==========
  // These are server-rendered so Microsoft Azure App Registration can crawl them

  app.get('/termsofservice', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - AImailPilot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #1a1a2e; background: #f8f9fa; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 3rem 2rem; text-align: center; }
    .header h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .header p { opacity: 0.9; font-size: 1.1rem; }
    .container { max-width: 800px; margin: -2rem auto 3rem; padding: 2.5rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h2 { color: #6366f1; font-size: 1.4rem; margin-top: 2rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; }
    h3 { color: #374151; font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    p, li { color: #4b5563; margin-bottom: 0.75rem; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    .effective-date { background: #f0f0ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #6366f1; margin-bottom: 1.5rem; }
    .footer { text-align: center; padding: 2rem; color: #9ca3af; font-size: 0.9rem; }
    a { color: #6366f1; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Terms of Service</h1>
    <p>AImailPilot - AI-Powered Email Campaign Platform</p>
  </div>
  <div class="container">
    <div class="effective-date"><strong>Effective Date:</strong> March 17, 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> March 17, 2026</div>

    <p>Welcome to AImailPilot ("Service", "we", "us", or "our"). By accessing or using our platform at <a href="https://aimailpilot.com">aimailpilot.com</a>, you agree to be bound by these Terms of Service ("Terms"). Please read them carefully.</p>

    <h2>1. Acceptance of Terms</h2>
    <p>By creating an account or using AImailPilot, you confirm that you are at least 18 years old, have the legal capacity to enter into a binding agreement, and agree to these Terms and our <a href="/privacystatement">Privacy Statement</a>.</p>

    <h2>2. Description of Service</h2>
    <p>AImailPilot is an AI-powered email campaign management platform that provides:</p>
    <ul>
      <li>Email campaign creation, scheduling, and management</li>
      <li>Contact list management and segmentation</li>
      <li>Email template creation with AI-assisted personalization</li>
      <li>Campaign analytics including open, click, reply, and bounce tracking</li>
      <li>Integration with email providers (Gmail, Microsoft Outlook) via OAuth</li>
      <li>Multi-step follow-up sequences</li>
      <li>Unified inbox for managing replies</li>
    </ul>

    <h2>3. User Accounts</h2>
    <h3>3.1 Account Registration</h3>
    <p>You may register using Google or Microsoft OAuth. You are responsible for maintaining the confidentiality of your account and for all activities that occur under your account.</p>
    <h3>3.2 Account Hierarchy</h3>
    <p>AImailPilot supports a hierarchical account structure: Super Admin, Organization Admins, and Members. Permissions and access are governed by your role within your organization.</p>

    <h2>4. Acceptable Use Policy</h2>
    <p>You agree NOT to use AImailPilot to:</p>
    <ul>
      <li>Send unsolicited bulk email (spam) in violation of applicable laws</li>
      <li>Violate any applicable anti-spam laws including CAN-SPAM, GDPR, CASL, or similar regulations</li>
      <li>Send emails containing malware, phishing attempts, or fraudulent content</li>
      <li>Harvest or collect email addresses without consent</li>
      <li>Impersonate any person or entity</li>
      <li>Interfere with or disrupt the Service or servers</li>
      <li>Use the Service for any illegal or unauthorized purpose</li>
    </ul>

    <h2>5. Email Sending &amp; Compliance</h2>
    <p>You are solely responsible for ensuring your email campaigns comply with all applicable laws and regulations. AImailPilot provides tools to help compliance (unsubscribe links, bounce management) but does not guarantee legal compliance of your campaigns.</p>

    <h2>6. Third-Party Integrations</h2>
    <p>AImailPilot integrates with third-party services including Google (Gmail API) and Microsoft (Graph API). Your use of these integrations is subject to the respective third-party terms of service. We access only the permissions you explicitly grant during OAuth authorization.</p>

    <h2>7. Data &amp; Content</h2>
    <h3>7.1 Your Data</h3>
    <p>You retain ownership of all data you upload or create through the Service, including contacts, email templates, and campaign content.</p>
    <h3>7.2 Data Handling</h3>
    <p>We handle your data in accordance with our <a href="/privacystatement">Privacy Statement</a>. We do not sell your data to third parties.</p>

    <h2>8. Intellectual Property</h2>
    <p>AImailPilot and its original content, features, and functionality are owned by us and are protected by international copyright, trademark, and other intellectual property laws.</p>

    <h2>9. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, AImailPilot shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunities, arising from your use of the Service.</p>

    <h2>10. Disclaimer of Warranties</h2>
    <p>The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, either express or implied. We do not guarantee that the Service will be uninterrupted, secure, or error-free.</p>

    <h2>11. Termination</h2>
    <p>We may suspend or terminate your account at any time for violation of these Terms. You may terminate your account at any time by contacting us. Upon termination, your right to use the Service ceases immediately.</p>

    <h2>12. Changes to Terms</h2>
    <p>We reserve the right to modify these Terms at any time. Material changes will be communicated via email or through the Service. Continued use after changes constitutes acceptance of the new Terms.</p>

    <h2>13. Contact Us</h2>
    <p>For questions about these Terms, please contact us at:</p>
    <ul>
      <li>Email: <a href="mailto:support@aimailpilot.com">support@aimailpilot.com</a></li>
      <li>Website: <a href="https://aimailpilot.com">https://aimailpilot.com</a></li>
    </ul>
  </div>
  <div class="footer">&copy; 2026 AImailPilot. All rights reserved.</div>
</body>
</html>`);
  });

  app.get('/privacystatement', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Statement - AImailPilot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #1a1a2e; background: #f8f9fa; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 3rem 2rem; text-align: center; }
    .header h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .header p { opacity: 0.9; font-size: 1.1rem; }
    .container { max-width: 800px; margin: -2rem auto 3rem; padding: 2.5rem; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h2 { color: #6366f1; font-size: 1.4rem; margin-top: 2rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; }
    h3 { color: #374151; font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    p, li { color: #4b5563; margin-bottom: 0.75rem; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    .effective-date { background: #f0f0ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #6366f1; margin-bottom: 1.5rem; }
    .footer { text-align: center; padding: 2rem; color: #9ca3af; font-size: 0.9rem; }
    a { color: #6366f1; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; color: #374151; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Privacy Statement</h1>
    <p>AImailPilot - AI-Powered Email Campaign Platform</p>
  </div>
  <div class="container">
    <div class="effective-date"><strong>Effective Date:</strong> March 17, 2026 &nbsp;|&nbsp; <strong>Last Updated:</strong> March 17, 2026</div>

    <p>AImailPilot ("we", "us", or "our") is committed to protecting your privacy. This Privacy Statement explains how we collect, use, disclose, and safeguard your information when you use our platform at <a href="https://aimailpilot.com">aimailpilot.com</a>.</p>

    <h2>1. Information We Collect</h2>
    <h3>1.1 Information You Provide</h3>
    <ul>
      <li><strong>Account Information:</strong> Name, email address, and profile picture obtained through Google or Microsoft OAuth sign-in</li>
      <li><strong>Contact Data:</strong> Email addresses, names, company names, and other contact details you upload for email campaigns</li>
      <li><strong>Email Content:</strong> Email templates, campaign content, and follow-up sequences you create</li>
      <li><strong>Organization Data:</strong> Organization name and settings configured by administrators</li>
    </ul>
    <h3>1.2 Information Collected Automatically</h3>
    <ul>
      <li><strong>Usage Data:</strong> Campaign statistics (sends, opens, clicks, replies, bounces)</li>
      <li><strong>Email Tracking Data:</strong> Open tracking via pixel, click tracking via redirect links</li>
      <li><strong>Log Data:</strong> Server logs including IP addresses, browser type, and access times</li>
    </ul>
    <h3>1.3 Information from Third Parties</h3>
    <ul>
      <li><strong>Google OAuth:</strong> Email, name, profile picture (scopes: email, profile, Gmail API for sending/reading emails)</li>
      <li><strong>Microsoft OAuth:</strong> Email, name, profile (scopes: User.Read, Mail.Read, Mail.ReadWrite, Mail.Send, SMTP.Send)</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use collected information to:</p>
    <ul>
      <li>Provide and maintain the AImailPilot service</li>
      <li>Authenticate your identity via OAuth providers</li>
      <li>Send email campaigns on your behalf through connected email accounts</li>
      <li>Track campaign performance (opens, clicks, replies, bounces)</li>
      <li>Detect and process email replies and bounces</li>
      <li>Manage your contact lists and segmentation</li>
      <li>Generate AI-powered email personalization</li>
      <li>Improve and optimize the Service</li>
    </ul>

    <h2>3. Microsoft Graph API &amp; Gmail API Usage</h2>
    <p>When you connect your Microsoft or Google account, AImailPilot accesses the following data through their respective APIs:</p>
    <table>
      <tr><th>Permission</th><th>Purpose</th></tr>
      <tr><td>Mail.Send</td><td>Send campaign emails on your behalf</td></tr>
      <tr><td>Mail.Read / Mail.ReadWrite</td><td>Detect replies and bounces to your campaign emails</td></tr>
      <tr><td>User.Read</td><td>Retrieve your profile information for account setup</td></tr>
      <tr><td>SMTP.Send</td><td>Fallback email sending via SMTP protocol</td></tr>
    </table>
    <p>We only access your mailbox to detect replies and bounces related to campaigns sent through AImailPilot. We do not read, store, or analyze your personal emails unrelated to our Service.</p>

    <h2>4. Data Storage &amp; Security</h2>
    <ul>
      <li>Data is stored securely on cloud infrastructure with encryption at rest and in transit</li>
      <li>OAuth tokens are stored securely and used only for authorized operations</li>
      <li>We implement industry-standard security measures to protect against unauthorized access</li>
      <li>Access to data is restricted to authorized personnel only</li>
    </ul>

    <h2>5. Data Sharing</h2>
    <p>We do <strong>not</strong> sell, rent, or trade your personal information. We may share data only in these circumstances:</p>
    <ul>
      <li><strong>With your consent:</strong> When you explicitly authorize sharing</li>
      <li><strong>Service providers:</strong> Third-party services essential to operating the platform (hosting, email delivery)</li>
      <li><strong>Legal requirements:</strong> When required by law, subpoena, or government request</li>
      <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
    </ul>

    <h2>6. Data Retention</h2>
    <p>We retain your data for as long as your account is active or as needed to provide the Service. Upon account termination, we will delete your data within 90 days, except where retention is required by law.</p>

    <h2>7. Your Rights</h2>
    <p>Depending on your jurisdiction, you may have the right to:</p>
    <ul>
      <li>Access, correct, or delete your personal data</li>
      <li>Export your data in a portable format</li>
      <li>Withdraw consent for data processing</li>
      <li>Object to automated decision-making</li>
      <li>Lodge a complaint with a supervisory authority</li>
    </ul>
    <p>To exercise these rights, contact us at <a href="mailto:support@aimailpilot.com">support@aimailpilot.com</a>.</p>

    <h2>8. Cookies &amp; Tracking</h2>
    <p>We use essential cookies for session management and authentication. Campaign tracking uses pixel images and redirect links to measure opens and clicks. Recipients can opt out via the unsubscribe link in each email.</p>

    <h2>9. Children's Privacy</h2>
    <p>AImailPilot is not intended for use by individuals under 18 years of age. We do not knowingly collect data from children.</p>

    <h2>10. International Data Transfers</h2>
    <p>Your data may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for international data transfers.</p>

    <h2>11. Changes to This Privacy Statement</h2>
    <p>We may update this Privacy Statement periodically. Material changes will be communicated via email or through the Service. The "Last Updated" date at the top indicates the most recent revision.</p>

    <h2>12. Contact Us</h2>
    <p>For privacy-related questions or concerns, please contact us at:</p>
    <ul>
      <li>Email: <a href="mailto:support@aimailpilot.com">support@aimailpilot.com</a></li>
      <li>Website: <a href="https://aimailpilot.com">https://aimailpilot.com</a></li>
    </ul>
  </div>
  <div class="footer">&copy; 2026 AImailPilot. All rights reserved.</div>
</body>
</html>`);
  });

  app.get('/api/test', (req, res) => {
    res.json({ message: 'AImailPilot server is running!', timestamp: new Date().toISOString() });
  });

  // Diagnostic endpoint for debugging Azure deployment issues
  app.get('/api/diagnostics', async (_req, res) => {
    try {
      const stats = await storage.getPlatformStats();
      const orgIds = await storage.getAllOrganizationIds();
      let hasGoogleOAuth = false;
      let hasMicrosoftOAuth = false;
      try {
        const { clientId: gId } = await getStoredOAuthCredentials('google');
        const { clientId: mId } = await getStoredOAuthCredentials('microsoft');
        hasGoogleOAuth = !!gId;
        hasMicrosoftOAuth = !!mId;
      } catch (e) { /* ignore */ }
      
      // Debug: show email account ownership data (no sensitive info)
      let emailAccountDebug: any[] = [];
      try {
        for (const orgId of orgIds) {
          const accounts = await storage.getEmailAccounts(orgId);
          for (const a of accounts as any[]) {
            emailAccountDebug.push({
              id: a.id,
              email: a.email,
              userId: a.userId || null,
              provider: a.provider,
              orgId: a.organizationId,
            });
          }
        }
      } catch (e) { /* ignore */ }
      
      // Debug: show org members (no sensitive info)
      let memberDebug: any[] = [];
      try {
        for (const orgId of orgIds) {
          const members = await storage.getOrgMembers(orgId);
          for (const m of members as any[]) {
            memberDebug.push({
              userId: m.userId,
              email: m.email,
              role: m.role,
              orgId: m.organizationId,
            });
          }
        }
      } catch (e) { /* ignore */ }
      
      // Debug: inbox stats
      let inboxDebug: any = {};
      try {
        for (const orgId of orgIds) {
          const total = await storage.getInboxMessageCount(orgId, {});
          const unread = await storage.getInboxUnreadCount(orgId);
          const allMsgs = await storage.getInboxMessages(orgId, {}, 100, 0);
          const nullAccountCount = (allMsgs as any[]).filter((m: any) => !m.emailAccountId).length;
          inboxDebug[orgId] = { total, unread, sampleSize: allMsgs.length, nullEmailAccountId: nullAccountCount };
        }
      } catch (e) { /* ignore */ }
      
      res.json({
        timestamp: new Date().toISOString(),
        environment: process.env.WEBSITE_SITE_NAME ? 'azure' : 'local',
        azureSiteName: process.env.WEBSITE_SITE_NAME || null,
        nodeVersion: process.version,
        codeVersion: 'v12-unified-inbox-contact-engine',
        dbStats: {
          totalUsers: stats.totalUsers,
          totalOrgs: orgIds.length,
          superAdmins: stats.superAdmins,
        },
        emailAccounts: emailAccountDebug,
        members: memberDebug,
        inboxStats: inboxDebug,
        oauth: {
          googleConfigured: hasGoogleOAuth,
          microsoftConfigured: hasMicrosoftOAuth,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
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
  app.use('/api/attachments', requireAuth);

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

  // Email accounts visible to Lead Intelligence (regular send-capable + scan-only).
  // Separate endpoint so the main /api/email-accounts UI continues to hide scan-only.
  app.get('/api/email-accounts/lead-intel', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const allAccounts = (storage as any).getEmailAccountsForLeadIntel
        ? await (storage as any).getEmailAccountsForLeadIntel(orgId)
        : await storage.getEmailAccounts(orgId);
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const filtered = isAdmin ? allAccounts : (allAccounts as any[]).filter((a: any) => a.userId === req.user.id);
      // Strip smtpConfig.auth.pass like the main endpoint does
      const safe = filtered.map((a: any) => ({
        id: a.id,
        organizationId: a.organizationId,
        userId: a.userId,
        provider: a.provider,
        email: a.email,
        displayName: a.displayName,
        dailyLimit: a.dailyLimit,
        dailySent: a.dailySent,
        isActive: a.isActive,
        scanOnly: a.scanOnly === 1 || a.scanOnly === true,
        leadIntelLastScanAt: a.leadIntelLastScanAt,
      }));
      res.json(safe);
    } catch (error: any) {
      console.error('[email-accounts/lead-intel] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to load lead intel accounts' });
    }
  });

  // Disconnect a scan-only account (admin only). Soft-deletes by isActive=0 + scanOnly=1
  // so it's hidden from both the regular and lead-intel lists. Existing email_history rows
  // and lead_opportunities are preserved (admin can re-add later to resume).
  app.delete('/api/email-accounts/scan-only/:id', requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Admin only' });
      }
      const orgId = req.user.organizationId;
      // Soft-delete via existing pattern (mirrors deleteEmailAccount which sets isActive=0)
      await storage.rawRun(
        `UPDATE email_accounts SET "isActive" = 0 WHERE id = ? AND "organizationId" = ? AND "scanOnly" = 1`,
        req.params.id, orgId
      );
      res.json({ ok: true });
    } catch (error: any) {
      console.error('[email-accounts/scan-only delete] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to disconnect scan-only account' });
    }
  });

  app.get('/api/email-accounts', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const allAccounts = await storage.getEmailAccounts(req.user.organizationId);
      
      console.log(`[EmailAccounts] User: ${req.user.email} (id=${req.user.id}, role=${req.user.role}), total accounts: ${allAccounts.length}`);
      
      // STRICT MEMBER FILTERING:
      // Members can ONLY see accounts they personally added (matched by userId)
      // The email-match fallback is REMOVED to prevent members seeing admin-added accounts
      // Admins/Owners see ALL accounts with owner info for management
      let filtered: any[];
      if (isAdmin) {
        filtered = allAccounts;
      } else {
        // Strict: only accounts where userId matches the logged-in member's id
        filtered = allAccounts.filter((a: any) => a.userId === req.user.id);
        console.log(`[EmailAccounts] Member ${req.user.email}: showing ${filtered.length}/${allAccounts.length} accounts (strict userId match)`);
      }
      
      // For admin view, look up who added each account
      let memberLookup: Record<string, any> = {};
      if (isAdmin) {
        try {
          const members = await storage.getOrgMembers(req.user.organizationId);
          for (const m of members as any[]) {
            memberLookup[m.userId] = { name: m.firstName || m.email?.split('@')[0] || 'Unknown', email: m.email, role: m.role };
          }
        } catch (e) { /* ignore */ }
      }
      
      // Check token status for each account so UI can show re-authenticate warnings
      const orgSettings = await storage.getApiSettings(req.user.organizationId);
      
      const safe = filtered.map((a: any) => {
        const isOAuth = a.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
        // canManage: admins manage all, members manage only their own
        const canManage = isAdmin || a.userId === req.user.id;
        const ownerInfo = isAdmin && a.userId ? memberLookup[a.userId] : null;
        
        // Check if OAuth tokens actually exist for this account
        let hasValidTokens = false;
        let tokenStatus = 'unknown';
        if (isOAuth) {
          if (a.provider === 'outlook' || a.provider === 'microsoft') {
            // Check per-sender Outlook tokens
            const hasPerSender = !!(orgSettings[`outlook_sender_${a.email}_access_token`] || orgSettings[`outlook_sender_${a.email}_refresh_token`]);
            const hasOrgLevel = !!(orgSettings.microsoft_access_token || orgSettings.microsoft_refresh_token);
            hasValidTokens = hasPerSender || (hasOrgLevel && orgSettings.microsoft_user_email === a.email);
            tokenStatus = hasValidTokens ? 'connected' : 'tokens_missing';
          } else if (a.provider === 'gmail' || a.provider === 'google') {
            const hasPerSender = !!(orgSettings[`gmail_sender_${a.email}_access_token`] || orgSettings[`gmail_sender_${a.email}_refresh_token`]);
            const hasOrgLevel = !!(orgSettings.gmail_access_token || orgSettings.gmail_refresh_token);
            hasValidTokens = hasPerSender || (hasOrgLevel && orgSettings.gmail_user_email === a.email);
            tokenStatus = hasValidTokens ? 'connected' : 'tokens_missing';
          }
        } else {
          // SMTP accounts don't need OAuth tokens
          hasValidTokens = true;
          tokenStatus = 'smtp';
        }
        
        return {
          ...a,
          authMethod: isOAuth ? 'oauth' : 'smtp',
          canManage,
          hasValidTokens,
          tokenStatus,
          // Admin-only: show who added this account
          addedByName: ownerInfo?.name || null,
          addedByEmail: ownerInfo?.email || null,
          addedByRole: ownerInfo?.role || null,
          smtpConfig: a.smtpConfig ? {
            ...a.smtpConfig,
            auth: { user: a.smtpConfig.auth?.user, pass: isOAuth ? 'OAUTH_TOKEN' : '••••••••' }
          } : null,
          authStatus: a.authStatus || 'active',
          authFailureCount: a.authFailureCount || 0,
          authLastFailureAt: a.authLastFailureAt || null,
          authLastErrorCode: a.authLastErrorCode || null,
        };
      });
      res.json(safe);
    } catch (error) {
      console.error('[EmailAccounts] Error:', error);
      res.status(500).json({ message: 'Failed to fetch email accounts' });
    }
  });

  // Lightweight endpoint for dashboard banner — returns only accounts needing reauth, scoped to caller
  app.get('/api/email-accounts/auth-health', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const all = await storage.getEmailAccounts(req.user.organizationId);
      const visible = isAdmin ? all : all.filter((a: any) => a.userId === req.user.id);
      const needsReauth = visible
        .filter((a: any) => a.authStatus === 'reauth_required')
        .map((a: any) => ({
          id: a.id,
          email: a.email,
          provider: a.provider,
          authFailureCount: a.authFailureCount || 0,
          authLastFailureAt: a.authLastFailureAt || null,
          authLastErrorCode: a.authLastErrorCode || null,
        }));
      res.json({ needsReauth, count: needsReauth.length });
    } catch (error) {
      console.error('[AuthHealth] Error:', error);
      res.status(500).json({ message: 'Failed to fetch auth health', needsReauth: [], count: 0 });
    }
  });

  app.get('/api/email-accounts/:id', async (req: any, res, next: any) => {
    // Skip if this is a known static sub-path (handled by later routes)
    if (['quota-summary', 'recommend', 'auth-health'].includes(req.params.id)) {
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
          // Test Microsoft Graph connection with token refresh
          try {
            console.log(`[Test] Testing Outlook account ${account.email}, orgId: ${orgId}, account.organizationId: ${account.organizationId}`);
            const settings = await storage.getApiSettings(orgId);
            let accessToken = settings[`outlook_sender_${account.email}_access_token`] || settings.microsoft_access_token;
            const refreshToken = settings[`outlook_sender_${account.email}_refresh_token`] || settings.microsoft_refresh_token;
            const tokenExpiry = settings[`outlook_sender_${account.email}_token_expiry`] || settings.microsoft_token_expiry;
            console.log(`[Test] Outlook tokens for ${account.email}: accessToken=${!!accessToken}, refreshToken=${!!refreshToken}, expiry=${tokenExpiry || 'none'}, orgId=${orgId}`);
            
            if (!accessToken && !refreshToken) {
              return res.json({ success: false, error: 'Microsoft OAuth tokens not found. Please use "Connect Outlook" to authenticate this account.', code: 'OAUTH_NO_TOKENS', authMethod: 'oauth' });
            }

            // Check if token is expired and try to refresh first
            const expiry = parseInt(tokenExpiry || '0');
            const isExpired = !accessToken || Date.now() > expiry - 300000; // 5 min buffer

            if (isExpired && refreshToken) {
              console.log(`[Test] Outlook token expired for ${account.email}, attempting refresh...`);
              // Get OAuth client credentials
              const { clientId, clientSecret } = await getStoredOAuthCredentials('microsoft');
              if (clientId && clientSecret) {
                try {
                  const body = new URLSearchParams({
                    client_id: clientId, client_secret: clientSecret,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                    scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
                  });
                  const refreshResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
                  });
                  if (refreshResp.ok) {
                    const newTokens = await refreshResp.json() as any;
                    if (newTokens.access_token) {
                      accessToken = newTokens.access_token;
                      // Store refreshed tokens
                      await storage.setApiSetting(orgId, `outlook_sender_${account.email}_access_token`, newTokens.access_token);
                      if (newTokens.refresh_token) await storage.setApiSetting(orgId, `outlook_sender_${account.email}_refresh_token`, newTokens.refresh_token);
                      const newExpiry = Date.now() + (newTokens.expires_in || 3600) * 1000;
                      await storage.setApiSetting(orgId, `outlook_sender_${account.email}_token_expiry`, String(newExpiry));
                      // Update org-level if primary
                      const primaryMsEmail = settings.microsoft_user_email;
                      if (!primaryMsEmail || primaryMsEmail === account.email) {
                        await storage.setApiSetting(orgId, 'microsoft_access_token', newTokens.access_token);
                        if (newTokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', newTokens.refresh_token);
                        await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(newExpiry));
                      }
                      console.log(`[Test] Outlook token refreshed successfully for ${account.email}`);
                    }
                  } else {
                    const errText = await refreshResp.text();
                    console.error(`[Test] Outlook token refresh failed for ${account.email}:`, errText);
                  }
                } catch (refreshErr) {
                  console.error(`[Test] Outlook token refresh error for ${account.email}:`, refreshErr);
                }
              }
            }

            if (!accessToken) {
              return res.json({ success: false, error: 'Microsoft OAuth token expired and refresh failed. Please use "Connect Outlook" to re-authenticate.', code: 'OAUTH_TOKEN_EXPIRED', authMethod: 'oauth' });
            }

            const testResp = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (testResp.ok) {
              const profile = await testResp.json() as any;
              // Optionally send test email via Graph API
              const testEmail = req.body.testEmail || account.email;
              if (testEmail) {
                try {
                  const sendResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      message: {
                        subject: '✅ AImailPilot Test - Outlook Connection Successful!',
                        body: { contentType: 'HTML', content: `<p>This is a test email from AImailPilot sent via Microsoft Graph API (OAuth).</p><p>Your Outlook account <strong>${profile.mail || profile.userPrincipalName}</strong> is working correctly!</p><p>Sent at: ${new Date().toLocaleString()}</p>` },
                        toRecipients: [{ emailAddress: { address: testEmail } }],
                      },
                      saveToSentItems: true,
                    }),
                  });
                  if (sendResp.ok) {
                    return res.json({ success: true, message: `Test email sent to ${testEmail} via Microsoft Graph API`, authMethod: 'oauth', provider: 'outlook', email: profile.mail || profile.userPrincipalName });
                  } else {
                    const sendErr = await sendResp.text();
                    return res.json({ success: false, error: `Graph API send failed: ${sendErr}`, code: 'MS_GRAPH_SEND_ERROR', authMethod: 'oauth' });
                  }
                } catch (sendErr) {
                  return res.json({ success: false, error: 'Graph API send error: ' + (sendErr instanceof Error ? sendErr.message : String(sendErr)), code: 'MS_GRAPH_SEND_ERROR', authMethod: 'oauth' });
                }
              }
              return res.json({ success: true, message: `Microsoft Graph connected as ${profile.mail || profile.userPrincipalName}`, authMethod: 'oauth', provider: 'outlook', email: profile.mail || profile.userPrincipalName });
            } else {
              const errBody = await testResp.text();
              console.error(`[Test] Graph API /me failed for ${account.email}:`, testResp.status, errBody);
              return res.json({ success: false, error: `Microsoft Graph API failed (${testResp.status}). Token may be expired. Please use "Connect Outlook" to re-authenticate.`, code: 'OAUTH_TOKEN_EXPIRED', authMethod: 'oauth' });
            }
          } catch (msErr) {
            console.error(`[Test] Microsoft Graph test error for ${account.email}:`, msErr);
            return res.json({ success: false, error: 'Failed to test Microsoft Graph connection: ' + (msErr instanceof Error ? msErr.message : String(msErr)), code: 'MS_GRAPH_ERROR', authMethod: 'oauth' });
          }
        }
      }

      // Non-OAuth: Standard SMTP test
      if (!account.smtpConfig) {
        return res.status(400).json({ success: false, error: 'SMTP is not configured.', code: 'SMTP_NOT_CONFIGURED' });
      }

      const verifyResult = await smtpEmailService.verifyConnection(account.smtpConfig);
      if (!verifyResult.success) {
        // For Outlook accounts, detect if basic auth is disabled and suggest OAuth
        const isOutlook = account.provider === 'outlook' || account.provider === 'microsoft' ||
          account.smtpConfig.host?.includes('outlook') || account.smtpConfig.host?.includes('office365');
        const isAuthError = smtpEmailService.isBasicAuthDisabledError(verifyResult.error || '');
        
        if (isOutlook && isAuthError) {
          return res.json({ 
            success: false, 
            error: 'Microsoft has disabled basic SMTP authentication for this account. Please use "Connect Outlook" (OAuth) to re-authenticate this account.',
            code: 'OUTLOOK_BASIC_AUTH_DISABLED',
            provider: account.provider, host: account.smtpConfig.host, authMethod: 'smtp',
            suggestion: 'oauth_upgrade',
          });
        }
        
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
          const hasAccessToken = settings[`outlook_sender_${account.email}_access_token`] || settings.microsoft_access_token;
          const hasRefreshToken = settings[`outlook_sender_${account.email}_refresh_token`] || settings.microsoft_refresh_token;
          const hasAnyToken = hasAccessToken || hasRefreshToken;
          return res.json({ success: !!hasAnyToken, authMethod: 'oauth', message: hasAnyToken ? 'Outlook OAuth connected' : 'Outlook OAuth tokens missing. Please use "Connect Outlook" to authenticate.' });
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

      // Permission check: admins can edit any, members can only edit their own (strict userId)
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const isOwner = existing.userId === req.user.id;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ message: 'You can only edit your own email accounts' });
      }

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
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) return res.status(404).json({ message: 'Email account not found' });
      
      // Permission check: admins can delete any, members can only delete their own (strict userId)
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const isOwner = account.userId === req.user.id;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ message: 'You can only delete your own email accounts' });
      }
      
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
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const allAccounts = await storage.getEmailAccounts(req.user.organizationId);
      
      // STRICT: Members only see quota for their own accounts (userId match only)
      const accounts = isAdmin 
        ? allAccounts 
        : allAccounts.filter((a: any) => a.userId === req.user.id);
      
      const accountQuotas = accounts.map((a: any) => {
        // Read from DB (email_accounts.dailySent / dailyLimit) — source of truth for all providers
        // Gmail OAuth, Outlook OAuth, and SMTP all increment email_accounts.dailySent atomically
        const dailyLimit = a.dailyLimit || 500;
        const dailySent = a.dailySent || 0;
        const remaining = Math.max(0, dailyLimit - dailySent);
        return {
          id: a.id,
          email: a.email,
          displayName: a.displayName || a.email,
          provider: a.provider,
          isActive: a.isActive,
          dailyLimit,
          dailySent,
          remaining,
          usagePercent: dailyLimit > 0 ? Math.round((dailySent / dailyLimit) * 100) : 0,
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

  // Admin endpoint: assign/reassign an email account to a specific member
  app.post('/api/email-accounts/:id/assign', async (req: any, res) => {
    try {
      const role = req.user.role;
      if (role !== 'owner' && role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }
      const { targetUserId } = req.body;
      if (!targetUserId) {
        return res.status(400).json({ message: 'targetUserId is required' });
      }
      const account = await storage.getEmailAccount(req.params.id);
      if (!account) return res.status(404).json({ message: 'Email account not found' });
      
      // Verify target user is in the same org
      const members = await storage.getOrgMembers(req.user.organizationId);
      const targetMember = (members as any[]).find((m: any) => m.userId === targetUserId);
      if (!targetMember) {
        return res.status(400).json({ message: 'Target user not found in this organization' });
      }
      
      // Update userId using dedicated storage method
      await storage.assignEmailAccountToUser(req.params.id, targetUserId);
      
      console.log(`[Admin] Email account ${account.email} (${req.params.id}) reassigned to user ${targetMember.email} (${targetUserId}) by ${req.user.email}`);
      res.json({ success: true, message: `Account ${account.email} assigned to ${targetMember.email}` });
    } catch (error) {
      console.error('[Admin] Failed to assign email account:', error);
      res.status(500).json({ message: 'Failed to assign email account' });
    }
  });

  app.post('/api/email-accounts/recommend', async (req: any, res) => {
    try {
      const { recipientCount, campaignType, campaignName } = req.body;
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const allAccounts = await storage.getEmailAccounts(req.user.organizationId);
      
      // STRICT: Members only see recommendations for their own accounts (userId match only)
      const accounts = isAdmin 
        ? allAccounts 
        : allAccounts.filter((a: any) => a.userId === req.user.id);

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
      
      // Auto-fix stale sentCount for campaigns that have messages but sentCount=0
      // Uses lightweight single-SQL aggregation instead of loading all messages
      for (const c of campaigns as any[]) {
        // Heal totalRecipients if it's smaller than the originally-selected contactIds (fixes campaigns where
        // totalRecipients got overwritten with post-filter remaining-work count on resume).
        const originalAudienceSize = Array.isArray(c.contactIds) ? c.contactIds.length : 0;
        if (originalAudienceSize > (c.totalRecipients || 0)) {
          try {
            await storage.updateCampaign(c.id, { totalRecipients: originalAudienceSize });
            c.totalRecipients = originalAudienceSize;
          } catch (e) { /* ignore */ }
        }

        if ((c.sentCount || 0) === 0 && (c.status === 'active' || c.status === 'completed')) {
          try {
            const stats = await storage.getCampaignMessageStats(c.id);
            if (stats.sent > 0) {
              const step0Floor = Math.max((stats.step0Sent || 0) + (stats.step0Bounced || 0), originalAudienceSize);
              await storage.updateCampaign(c.id, {
                sentCount: stats.sent, bouncedCount: stats.bounced,
                openedCount: stats.opened, clickedCount: stats.clicked, repliedCount: stats.replied,
                totalRecipients: step0Floor || (stats.sent + stats.bounced),
              });
              c.sentCount = stats.sent;
              c.bouncedCount = stats.bounced;
              c.openedCount = stats.opened;
              c.clickedCount = stats.clicked;
              c.repliedCount = stats.replied;
              c.totalRecipients = step0Floor || (stats.sent + stats.bounced);
              console.log(`[Campaigns] Auto-fixed stats for ${c.id}: sent=${stats.sent}`);
            }
          } catch (e) { /* ignore per-campaign errors */ }
        }
      }

      // Enrich campaigns with creator name — batch load unique creators
      try {
        const creatorIds = [...new Set((campaigns as any[]).map(c => c.createdBy).filter(Boolean))];
        const creators: Record<string, any> = {};
        for (const uid of creatorIds) {
          try {
            const u = await storage.getUser(uid);
            if (u) creators[uid] = u;
          } catch (e) { /* skip */ }
        }
        for (const c of campaigns as any[]) {
          const creator = c.createdBy ? creators[c.createdBy] : null;
          if (creator) {
            c.creatorName = `${(creator as any).firstName || ''} ${(creator as any).lastName || ''}`.trim() || (creator as any).email;
            c.creatorEmail = (creator as any).email;
          }
        }
      } catch (e) { /* enrichment failure is non-fatal */ }

      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaigns' });
    }
  });

  // Campaign count for pagination
  app.get('/api/campaigns/count', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const status = req.query.status as string;
      let sql = 'SELECT COUNT(*) as total FROM campaigns WHERE "organizationId" = ?';
      const params: any[] = [req.user.organizationId];
      if (!isAdmin) {
        sql += ' AND "createdBy" = ?';
        params.push(req.user.id);
      }
      if (status && status !== 'all') {
        if (status === 'active') {
          sql += " AND (status = 'active' OR status = 'following_up')";
        } else {
          sql += ' AND status = ?';
          params.push(status);
        }
      }
      const row = await storage.rawGet(sql, ...params) as any;
      res.json({ total: parseInt(row?.total || '0', 10) });
    } catch (error) {
      res.status(500).json({ message: 'Failed to count campaigns' });
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
      // Lock sendOrder after campaign has started (active/paused/completed/cancelled).
      // Only 'draft' state allows changing Default <-> Smart.
      const patch = { ...req.body };
      if ('sendOrder' in patch) {
        const existing = await storage.getCampaign(req.params.id);
        if (existing && existing.status !== 'draft') {
          delete patch.sendOrder;
        }
      }
      const updated = await storage.updateCampaign(req.params.id, patch);
      res.json(updated);
    } catch (error: any) {
      // Log the actual error so we can diagnose 500s. Include sanitized request body
      // (without HTML content) and the error message for the response so the UI shows
      // the real cause instead of a generic "Failed to update campaign".
      const safeBody = { ...(req.body || {}) };
      if (safeBody.content) safeBody.content = `[${String(safeBody.content).length} chars omitted]`;
      console.error('[PUT /api/campaigns/:id] error for campaign', req.params.id, '-', error?.message || error);
      console.error('[PUT /api/campaigns/:id] request keys:', Object.keys(safeBody).join(','));
      res.status(500).json({ message: 'Failed to update campaign', error: error?.message || String(error) });
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
  // Pre-send email verification check — returns counts of invalid/unverified contacts in a campaign
  app.get('/api/campaigns/:id/verification-check', requireAuth, async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
      const contacts = await storage.getCampaignContacts(req.params.id);
      const contactIds = contacts.map((c: any) => c.id);
      if (contactIds.length === 0) return res.json({ total: 0, unverified: 0, invalid: 0, risky: 0, valid: 0 });
      const placeholders = contactIds.map(() => '?').join(',');
      const rows = await storage.rawAll(`SELECT "emailVerificationStatus", COUNT(*) as count FROM contacts WHERE id IN (${placeholders}) GROUP BY "emailVerificationStatus"`, ...contactIds);
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.emailVerificationStatus || 'unverified'] = row.count;
      // Check if superadmin has block_invalid enabled
      const apiKey = await getEmailVerifyApiKey();
      let blockInvalid = false;
      if (apiKey) {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId) {
          const settings = await storage.getApiSettings(superAdminOrgId);
          blockInvalid = settings.emaillistverify_block_invalid === 'true';
        }
      }
      res.json({
        total: contactIds.length,
        unverified: counts['unverified'] || counts[''] || 0,
        invalid: (counts['invalid'] || 0) + (counts['disposable'] || 0) + (counts['spamtrap'] || 0),
        risky: counts['risky'] || 0,
        valid: counts['valid'] || 0,
        hasApiKey: !!apiKey,
        blockInvalid,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post('/api/campaigns/:id/send', async (req: any, res) => {
    try {
      // Detect public URL from the incoming request for tracking links
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers['host'];
      if (host && !host.includes('localhost')) {
        const url = `${proto}://${host}`;
        campaignEngine.setPublicBaseUrl(url);
        followupEngine.setPublicBaseUrl(url);
      }

      const delayBetweenEmails = req.body.delayBetweenEmails || 2000;

      // Persist the sending config so it survives pause/resume/restart
      const sendingConfig = {
        delayBetweenEmails,
        batchSize: req.body.batchSize || 10,
        autopilot: req.body.autopilot || null,
        // Store the user's timezone offset so we can calculate their local time
        timezoneOffset: req.body.timezoneOffset ?? null,
        // IANA timezone name (DST-aware, preferred over timezoneOffset)
        timezone: req.body.timezone || null,
      };

      console.log(`[Campaign] SEND ${req.params.id}: delay=${delayBetweenEmails}ms, autopilot=${sendingConfig.autopilot?.enabled ? 'ON' : 'OFF'}, maxPerDay=${sendingConfig.autopilot?.maxPerDay || 'N/A'}, tz=${sendingConfig.timezone || sendingConfig.timezoneOffset}`);
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
      await storage.updateCampaign(req.params.id, { status: 'paused', autoPaused: false });
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/resume', async (req: any, res) => {
    // Set public base URL for tracking links (same as /send endpoint)
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost')) {
      const url = `${proto}://${host}`;
      campaignEngine.setPublicBaseUrl(url);
      followupEngine.setPublicBaseUrl(url);
    }

    const success = campaignEngine.resumeCampaign(req.params.id);
    if (!success) {
      // Campaign not in memory (e.g. server restarted while paused).
      try {
        const campaign = await storage.getCampaign(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
        
        // Always go through startCampaign on resume — it checks existing messages,
        // skips already-sent contacts, and sends only the remaining ones.
        // If ALL Step 1 contacts are already sent, startCampaign sets status to 'following_up'.
        // This handles: partial Step 1 (resume sending), complete Step 1 (follow-up only),
        // and large lists where Step 2 fires for early contacts while Step 1 continues.
        // Read saved sending config to restore ALL settings: delay, time windows, maxPerDay.
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
    await storage.updateCampaign(req.params.id, { status: 'paused', autoPaused: false });
    res.json({ success: true });
  });

  // Recalculate campaign stats from actual messages (fixes campaigns with wrong sentCount)
  app.post('/api/campaigns/:id/recalculate', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
      
      const messages = await storage.getCampaignMessagesEnriched(req.params.id, 100000, 0);
      const sentCount = messages.filter((m: any) => m.status === 'sent' || m.status === 'sending').length;
      // Count real bounces: status='bounced' OR status='failed' with bounce-related error
      const bouncedCount = messages.filter((m: any) => 
        m.status === 'bounced' || 
        (m.status === 'failed' && m.errorMessage && m.errorMessage.toLowerCase().includes('bounce'))
      ).length;
      const openedCount = messages.filter((m: any) => m.openedAt).length;
      const clickedCount = messages.filter((m: any) => m.clickedAt).length;
      const repliedCount = messages.filter((m: any) => m.repliedAt).length;
      
      await storage.updateCampaign(req.params.id, {
        sentCount,
        bouncedCount,
        openedCount,
        clickedCount,
        repliedCount,
        totalRecipients: campaign.totalRecipients || sentCount + bouncedCount,
      });
      
      console.log(`[Campaign] Recalculated stats for ${req.params.id}: sent=${sentCount}, bounced=${bouncedCount}, opened=${openedCount}, clicked=${clickedCount}, replied=${repliedCount}`);
      res.json({ 
        success: true, 
        stats: { sentCount, bouncedCount, openedCount, clickedCount, repliedCount, totalRecipients: campaign.totalRecipients || sentCount + bouncedCount }
      });
    } catch (error) {
      console.error('[Campaign] Recalculate error:', error);
      res.status(500).json({ message: 'Failed to recalculate stats' });
    }
  });

  // Classify a campaign message error as infrastructure/policy-block (false bounce) vs real bounce.
  // Only matches errors where the message provably never reached a valid inbox:
  //   - Auth/token failures (email never left our server)
  //   - SMTP error codes known to be sender-side policy blocks (5.7.x), not recipient-side
  // NDR-prefix bounces ("Bounce: ..." / "Bounce detected: ...") are NOT auto-matched here
  // because the Outlook/Gmail reply trackers write this prefix for both true hard bounces
  // (5.1.1 user unknown) AND policy blocks (5.7.1 blocked sender) — indistinguishable at
  // this point. Users must use force-mode (explicit confirmation) for those.
  const isFalseBounceError = (errorMessage: string | null | undefined): boolean => {
    const e = (errorMessage || '').toLowerCase();
    if (!e) return false;
    // Infrastructure / auth (email never left)
    if (e.includes('oauth') || e.includes('token') || e.includes('re-authenticate') ||
        e.includes('401') || e.includes('403') || e.includes('api error') ||
        e.includes('connection refused') || e.includes('getaddrinfo') ||
        e.includes('invalidauthenticationtoken') || e.includes('credentials') ||
        (e.includes('smtp') && e.includes('auth'))) return true;
    // Sender-side policy blocks with explicit SMTP codes (recoverable — unblock sender + reset)
    // 5.7.x = policy/auth/security rejection (sender blocked), NOT recipient-side
    // Exclude 5.7.1 raw alone — too ambiguous (also used for "relay access denied" to bad recipient)
    if (e.includes('5.7.0') || e.includes('5.7.26') ||
        e.includes('throttle') || e.includes('quota exceeded') ||
        e.includes('temporarily rate') || e.includes('messagerejected') ||
        (e.includes('5.7.1') && (e.includes('policy') || e.includes('blocked') || e.includes('spam') || e.includes('sender')))) return true;
    return false;
  };

  // A message qualifies for reset in "force all" mode: any failed/bounced row regardless of error text.
  // Used when the user explicitly confirms (after unblocking sender) that ALL bounces on the campaign
  // should be treated as recoverable.
  const shouldResetMessage = (msg: any, force: boolean): boolean => {
    if (msg.status !== 'failed' && msg.status !== 'bounced') return false;
    if (force) return true;
    return isFalseBounceError(msg.errorMessage);
  };

  // Preview which messages would be reset (dry run) — lets UI show a breakdown before committing.
  // Returns both "matched" (pattern match) and "totalBounced" (all failed/bounced) so the UI can
  // offer a "force reset all" option when pattern matches = 0 but bounces exist.
  app.get('/api/campaigns/:id/reset-bounces-preview', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      const messages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      const matches: any[] = [];
      let totalBounced = 0;
      let noErrorMessageCount = 0;
      const errorSamples: string[] = [];
      for (const msg of messages) {
        if (msg.status !== 'failed' && msg.status !== 'bounced') continue;
        totalBounced++;
        if (!msg.errorMessage) noErrorMessageCount++;
        else if (errorSamples.length < 5 && !errorSamples.includes(msg.errorMessage)) {
          errorSamples.push((msg.errorMessage || '').slice(0, 150));
        }
        if (isFalseBounceError(msg.errorMessage)) {
          matches.push({ id: msg.id, email: msg.recipientEmail, error: (msg.errorMessage || '').slice(0, 200), status: msg.status });
        }
      }
      const byPattern: Record<string, number> = {};
      for (const m of matches) {
        const e = m.error.toLowerCase();
        let tag = 'other';
        if (e.includes('5.7.1') || e.includes('policy') || e.includes('blocked') || e.includes('denied')) tag = 'policy_block';
        else if (e.includes('spam')) tag = 'spam_filter';
        else if (e.includes('throttle') || e.includes('quota') || e.includes('rate')) tag = 'throttle';
        else if (e.includes('oauth') || e.includes('token') || e.includes('auth')) tag = 'auth_error';
        else if (e.startsWith('bounce detected:') || e.startsWith('bounce:')) tag = 'ndr_detected';
        byPattern[tag] = (byPattern[tag] || 0) + 1;
      }
      res.json({
        total: matches.length,
        totalBounced,
        noErrorMessageCount,
        byPattern,
        errorSamples,
        sample: matches.slice(0, 10),
      });
    } catch (error) {
      console.error('[Campaign] Reset bounces preview error:', error);
      res.status(500).json({ error: 'Failed to preview reset' });
    }
  });

  // Reset campaign: clear false-bounce messages (auth + Outlook/SMTP policy blocks) and restore affected contacts.
  // Also clears the matching 'bounce' tracking_events and removes affected emails from the org suppression list.
  app.post('/api/campaigns/:id/reset-bounces', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      const messages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      let deletedCount = 0;
      let restoredContacts = 0;
      let unsuppressedCount = 0;
      let clearedTrackingEvents = 0;

      const force = !!(req.body && req.body.force);

      for (const msg of messages) {
        if (!shouldResetMessage(msg, force)) continue;

        // Delete 'bounce' tracking events tied to this message
        try {
          const existing = await storage.rawAll(
            `SELECT id FROM tracking_events WHERE "messageId" = ? AND type = 'bounce'`,
            msg.id
          ) as any[];
          if (existing && existing.length) {
            await storage.rawRun(`DELETE FROM tracking_events WHERE "messageId" = ? AND type = 'bounce'`, msg.id);
            clearedTrackingEvents += existing.length;
          }
        } catch (e) { /* ignore */ }

        // Delete the failed message record
        try { await storage.deleteCampaignMessage(msg.id); } catch (e) {}
        deletedCount++;

        // Restore contact + drop from suppression list
        if (msg.contactId) {
          try {
            const contact = await storage.getContact(msg.contactId);
            if (contact && (contact as any).status === 'bounced') {
              await storage.updateContact(msg.contactId, { status: 'active' });
              restoredContacts++;
            }
            const email = (contact as any)?.email || msg.recipientEmail;
            if (email) {
              try {
                await storage.removeFromSuppressionList(campaign.organizationId, email);
                unsuppressedCount++;
              } catch (e) { /* ignore */ }
            }
          } catch (e) {}
        } else if (msg.recipientEmail) {
          try {
            await storage.removeFromSuppressionList(campaign.organizationId, msg.recipientEmail);
            unsuppressedCount++;
          } catch (e) { /* ignore */ }
        }
      }

      // Recalculate campaign counters from what's actually left
      const remainingMessages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      const actualBounces = remainingMessages.filter((m: any) => m.status === 'failed' || m.status === 'bounced').length;
      const actualSent = remainingMessages.filter((m: any) => m.status === 'sent').length;

      await storage.updateCampaign(req.params.id, {
        bouncedCount: actualBounces,
        sentCount: actualSent,
      });

      res.json({
        success: true,
        deletedMessages: deletedCount,
        restoredContacts,
        unsuppressedCount,
        clearedTrackingEvents,
        actualBounces,
        actualSent,
      });
    } catch (error) {
      console.error('[Campaign] Reset bounces error:', error);
      res.status(500).json({ error: 'Failed to reset bounces' });
    }
  });

  // One-click "Retry after unblock" — reset false bounces, then resume the campaign so it re-sends to restored contacts.
  app.post('/api/campaigns/:id/retry-after-unblock', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      // --- Inline reset (same logic as /reset-bounces) ---
      const messages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      let deletedCount = 0;
      let restoredContacts = 0;
      let unsuppressedCount = 0;

      const forceRetry = !!(req.body && req.body.force);
      for (const msg of messages) {
        if (!shouldResetMessage(msg, forceRetry)) continue;
        try {
          await storage.rawRun(`DELETE FROM tracking_events WHERE "messageId" = ? AND type = 'bounce'`, msg.id);
        } catch (e) {}
        try { await storage.deleteCampaignMessage(msg.id); } catch (e) {}
        deletedCount++;
        if (msg.contactId) {
          try {
            const contact = await storage.getContact(msg.contactId);
            if (contact && (contact as any).status === 'bounced') {
              await storage.updateContact(msg.contactId, { status: 'active' });
              restoredContacts++;
            }
            const email = (contact as any)?.email || msg.recipientEmail;
            if (email) {
              try { await storage.removeFromSuppressionList(campaign.organizationId, email); unsuppressedCount++; } catch (e) {}
            }
          } catch (e) {}
        } else if (msg.recipientEmail) {
          try { await storage.removeFromSuppressionList(campaign.organizationId, msg.recipientEmail); unsuppressedCount++; } catch (e) {}
        }
      }

      const remainingMessages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      const actualBounces = remainingMessages.filter((m: any) => m.status === 'failed' || m.status === 'bounced').length;
      const actualSent = remainingMessages.filter((m: any) => m.status === 'sent').length;
      await storage.updateCampaign(req.params.id, { bouncedCount: actualBounces, sentCount: actualSent });

      // --- Resume the campaign (mirrors /resume logic) ---
      let resumed = false;
      try {
        const fresh = await storage.getCampaign(req.params.id);
        if (fresh && (fresh.status === 'paused' || fresh.status === 'draft' || fresh.status === 'completed')) {
          // Set public base URL for tracking links
          const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
          const host = req.headers['x-forwarded-host'] || req.headers['host'];
          if (host && !host.includes('localhost')) {
            const url = `${proto}://${host}`;
            campaignEngine.setPublicBaseUrl(url);
            followupEngine.setPublicBaseUrl(url);
          }

          await storage.updateCampaign(req.params.id, { status: 'active', autoPaused: false });
          const savedConfig: any = fresh.sendingConfig || {};
          const delayBetweenEmails = savedConfig?.delayBetweenEmails || 2000;
          try {
            const result = await campaignEngine.startCampaign({
              campaignId: req.params.id,
              delayBetweenEmails,
              batchSize: savedConfig?.batchSize || 10,
              sendingConfig: savedConfig || undefined,
            });
            resumed = !!result?.success;
          } catch (e) {
            console.error('[Campaign] Retry-after-unblock: start failed:', e);
          }
        }
      } catch (e) { console.error('[Campaign] Retry-after-unblock: resume error:', e); }

      res.json({
        success: true,
        deletedMessages: deletedCount,
        restoredContacts,
        unsuppressedCount,
        actualBounces,
        actualSent,
        resumed,
      });
    } catch (error) {
      console.error('[Campaign] Retry-after-unblock error:', error);
      res.status(500).json({ error: 'Failed to retry after unblock' });
    }
  });

  // Latest bounce-surge alert for a campaign — powers the UI banner.
  app.get('/api/campaigns/:id/bounce-surge', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ alert: null });
      const row = await storage.rawGet(
        `SELECT id, "createdAt", metadata FROM tracking_events
         WHERE "campaignId" = ? AND type = 'bounce_surge'
         ORDER BY "createdAt" DESC LIMIT 1`,
        req.params.id
      ) as any;
      if (!row) return res.json({ alert: null });
      let metadata: any = row.metadata;
      if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
      res.json({ alert: { id: row.id, createdAt: row.createdAt, ...metadata } });
    } catch (e) {
      console.error('[Campaign] bounce-surge fetch error:', e);
      res.json({ alert: null });
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
        timezone: req.body.timezone || null,
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
      let campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

      const totalMessages = await storage.getCampaignMessagesTotalCount(req.params.id);

      // Use lightweight SQL aggregation for stats instead of loading all messages
      const msgStats = await storage.getCampaignMessageStats(req.params.id);

      // Heal totalRecipients if it's smaller than the originally-selected contactIds (fixes campaigns where
      // totalRecipients got overwritten with post-filter remaining-work count on resume).
      const originalAudienceSize = Array.isArray((campaign as any).contactIds) ? (campaign as any).contactIds.length : 0;
      if (originalAudienceSize > (campaign.totalRecipients || 0)) {
        await storage.updateCampaign(req.params.id, { totalRecipients: originalAudienceSize });
        campaign = await storage.getCampaign(req.params.id);
      }

      // Auto-recalculate stats if sentCount appears stale
      if (msgStats.sent > 0 && (campaign.sentCount || 0) < msgStats.sent) {
        console.log(`[Campaign] Auto-fixing stale stats for ${req.params.id}: DB sentCount=${campaign.sentCount}, actual=${msgStats.sent}`);
        const step0Floor = Math.max((msgStats.step0Sent || 0) + (msgStats.step0Bounced || 0), originalAudienceSize);
        await storage.updateCampaign(req.params.id, {
          sentCount: msgStats.sent,
          bouncedCount: msgStats.bounced,
          openedCount: msgStats.opened,
          clickedCount: msgStats.clicked,
          repliedCount: msgStats.replied,
          totalRecipients: step0Floor || (msgStats.sent + msgStats.bounced),
        });
        campaign = await storage.getCampaign(req.params.id);
      }

      // Load messages with batch-optimized enrichment (2-3 SQL queries total, not 2*N)
      // Cap at 500 to prevent timeout on very large campaigns — frontend paginates at 25/page anyway
      const messages = await storage.getCampaignMessagesEnriched(req.params.id, Math.min(totalMessages || 500, 500), 0);

      const analytics = await storage.getCampaignAnalytics(req.params.id);
      // Only fetch recent tracking events (not all — can be thousands for large campaigns)
      const trackingEvents = await storage.getRecentCampaignTrackingEvents(req.params.id, 50);

      // Step-by-step breakdown analytics using lightweight SQL aggregation
      const stepStatsRows = await storage.getCampaignStepStats(req.params.id);
      const stepAnalytics = stepStatsRows.map((row: any) => {
        const sent = row.sent;
        return {
          stepNumber: row.stepNumber,
          label: row.stepNumber === 0 ? 'Step 1' : `Step ${row.stepNumber + 1}`,
          description: row.stepNumber === 0 ? 'Sent at campaign creation' : null,
          sent, opened: row.opened, clicked: row.clicked, replied: row.replied, bounced: row.bounced,
          unsubscribed: 0, spam: 0,
          openRate: sent > 0 ? ((row.opened / sent) * 100).toFixed(1) : '0',
          clickRate: sent > 0 ? ((row.clicked / sent) * 100).toFixed(1) : '0',
          replyRate: sent > 0 ? ((row.replied / sent) * 100).toFixed(1) : '0',
        };
      });
      // Always ensure Step 1 (stepNumber 0) exists — even if no emails sent yet
      if (!stepAnalytics.find((s: any) => s.stepNumber === 0)) {
        stepAnalytics.unshift({
          stepNumber: 0, label: 'Step 1', description: 'Initial email',
          sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0, spam: 0,
          openRate: '0', clickRate: '0', replyRate: '0',
          isPending: campaign.status === 'paused' || campaign.status === 'draft',
        });
      }

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
                  sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0, spam: 0,
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

      // Get contact list info — find the most common listId among campaign's selected contacts
      let contactList: any = null;
      try {
        // Campaign stores all selected contactIds as JSON array — use that (not messages table which may be partial)
        const contactIdsJson = (campaign as any).contactIds;
        const contactIds: string[] = contactIdsJson ? (typeof contactIdsJson === 'string' ? JSON.parse(contactIdsJson) : contactIdsJson) : [];
        if (contactIds.length > 0) {
          // Sample first 50 contacts to find the most common list (efficient enough)
          const sample = contactIds.slice(0, 50);
          const ph = sample.map(() => '?').join(',');
          const listRow = await storage.rawGet(`
            SELECT c."listId", cl.name as "listName", COUNT(*) as cnt
            FROM contacts c
            LEFT JOIN contact_lists cl ON cl.id = c."listId"
            WHERE c.id IN (${ph}) AND c."listId" IS NOT NULL AND c."listId" != ''
            GROUP BY c."listId", cl.name
            ORDER BY cnt DESC LIMIT 1
          `, ...sample) as any;
          if (listRow && listRow.listId) {
            contactList = { id: listRow.listId, name: listRow.listName || 'Unnamed list' };
          }
        }
      } catch (e) { /* ignore */ }

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
        recentEvents: trackingEvents,
        stepAnalytics,
        followupSequences,
        hasActiveFollowups: followupSequences.length > 0 && followupSequences.some((s: any) => s.steps && s.steps.length > 0),
        emailAccount,
        contactList,
        activityTimeline,
        trackingBaseUrl: campaignEngine.getBaseUrl(),
      });
    } catch (error) {
      console.error('Campaign detail error:', error);
      res.status(500).json({ message: 'Failed to fetch campaign detail' });
    }
  });

  // Campaign contact debug: show which contacts would be filtered and why
  app.get('/api/campaigns/:id/contact-debug', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

      // Load contacts the same way campaign engine does
      let allContacts: any[] = [];
      if (campaign.contactIds && campaign.contactIds.length > 0) {
        allContacts = await storage.getContactsByIds(campaign.contactIds);
      } else if (campaign.segmentId) {
        allContacts = await storage.getContactsBySegment(campaign.segmentId);
      }

      const bounced = allContacts.filter(c => c.status === 'bounced').map(c => ({ id: c.id, email: c.email, status: c.status }));
      const unsubscribed = allContacts.filter(c => c.status === 'unsubscribed').map(c => ({ id: c.id, email: c.email, status: c.status }));
      const eligible = allContacts.filter(c => c.status !== 'bounced' && c.status !== 'unsubscribed').map(c => ({ id: c.id, email: c.email, status: c.status }));

      // Check already-processed (dedup)
      const existingMessages = await storage.getCampaignMessages(req.params.id, 100000, 0) as any[];
      const processedContactIds = new Set(existingMessages.filter((m: any) => (m.stepNumber || 0) === 0).map((m: any) => m.contactId));
      const alreadyProcessed = eligible.filter(c => processedContactIds.has(c.id));
      const wouldSend = eligible.filter(c => !processedContactIds.has(c.id));

      res.json({
        storedContactIds: campaign.contactIds?.length || 0,
        segmentId: campaign.segmentId || null,
        loadedFromDb: allContacts.length,
        bounced: { count: bounced.length, contacts: bounced },
        unsubscribed: { count: unsubscribed.length, contacts: unsubscribed },
        alreadyProcessed: { count: alreadyProcessed.length, contacts: alreadyProcessed },
        wouldSend: { count: wouldSend.length, contacts: wouldSend },
      });
    } catch (error) {
      console.error('Contact debug error:', error);
      res.status(500).json({ message: 'Failed to debug contacts' });
    }
  });

  // Duplicate a campaign — copies Step 1 + all follow-up sequences/steps; clears contactIds so user picks fresh list
  app.post('/api/campaigns/:id/duplicate', async (req: any, res) => {
    try {
      const original = await storage.getCampaign(req.params.id);
      if (!original) return res.status(404).json({ message: 'Campaign not found' });

      // Create the new campaign — no contactIds, no segmentId, status=draft
      const dupe = await storage.createCampaign({
        organizationId: original.organizationId,
        name: `${original.name} (Copy)`,
        description: original.description,
        subject: original.subject,
        content: original.content,
        emailAccountId: original.emailAccountId,
        templateId: original.templateId,
        contactIds: [],      // cleared — user must select recipients
        segmentId: null,     // cleared
        sendOrder: (original as any).sendOrder || null,
      });
      // createCampaign INSERT lacks trackOpens/includeUnsubscribe columns — patch via update
      await storage.updateCampaign((dupe as any).id, {
        trackOpens: original.trackOpens ?? 1,
        includeUnsubscribe: (original as any).includeUnsubscribe ?? 0,
      });

      // Copy all follow-up sequences + steps linked to the original campaign
      try {
        const campaignFollowups = await storage.getCampaignFollowups(req.params.id);
        for (const cf of campaignFollowups) {
          const seq = await storage.getFollowupSequence((cf as any).sequenceId);
          if (!seq) continue;
          const steps = await storage.getFollowupSteps((seq as any).id);

          // Create a new sequence for the duplicate
          const newSeq = await storage.createFollowupSequence({
            organizationId: original.organizationId,
            name: (seq as any).name,
            description: (seq as any).description || '',
            createdBy: req.user?.id || null,
          });

          // Copy each step into the new sequence
          for (const step of steps) {
            await storage.createFollowupStep({
              sequenceId: (newSeq as any).id,
              stepNumber: (step as any).stepNumber,
              trigger: (step as any).trigger || 'no_reply',
              delayDays: (step as any).delayDays || 0,
              delayHours: (step as any).delayHours || 0,
              delayMinutes: (step as any).delayMinutes || 0,
              subject: (step as any).subject || '',
              content: (step as any).content || '',
            });
          }

          // Link new sequence to the duplicate campaign
          await storage.createCampaignFollowup({
            campaignId: (dupe as any).id,
            sequenceId: (newSeq as any).id,
          });
        }
      } catch (followupErr) {
        console.error('[duplicate] followup copy error (non-fatal):', followupErr);
      }

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

  // Paginated messages for campaign tracking/emails tables
  app.get('/api/campaigns/:id/messages', async (req: any, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
      const offset = (page - 1) * limit;
      const filter = (req.query.filter as string) || 'all';
      const search = (req.query.search as string) || '';
      const { messages, total } = await storage.getCampaignMessagesFiltered(req.params.id, limit, offset, filter, search);
      res.json({ messages, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

          // Create the tracking_event ONLY on first detection. Previously this was
          // outside the !repliedAt guard, so retries/duplicate webhook calls on the
          // same trackingId accumulated reply events on a single message — leading
          // to message.replyCount values like 10/12/etc on the campaign detail page.
          // The guard above ensures repliedAt + repliedCount only bump once; the
          // tracking_event must follow the same rule for replyCount to be accurate.
          await storage.createTrackingEvent({
            type: 'reply',
            campaignId: message.campaignId,
            messageId: message.id,
            contactId: message.contactId,
            trackingId,
            metadata: req.body || {},
          });
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Reply tracking error:', error);
      res.json({ success: false });
    }
  });

  // ========== GMAIL REPLY TRACKING ==========

  // Check for replies via Gmail & Outlook APIs (manual trigger)
  app.post('/api/reply-tracking/check', requireAuth, async (req: any, res) => {
    try {
      const lookbackMinutes = parseInt(req.body.lookbackMinutes) || 1440; // Default 24h for better bounce detection
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      console.log(`[ReplyTracking] Manual check triggered for org ${orgId} with lookback ${lookbackMinutes} minutes`);
      
      const results: any = { gmail: null, outlook: null, checked: 0, newReplies: 0, errors: [] as string[], replies: [] as any[] };
      
      // Check Gmail if tokens exist
      if (orgHasGmailTokens(settings)) {
        try {
          const gmailResult = await gmailReplyTracker.checkForReplies(orgId, lookbackMinutes);
          results.gmail = gmailResult;
          results.checked += gmailResult.checked;
          results.newReplies += gmailResult.newReplies;
          results.errors.push(...gmailResult.errors);
          results.replies.push(...gmailResult.replies);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.errors.push(`Gmail: ${msg}`);
          console.error('[ReplyTracking] Gmail check error:', msg);
        }
      }
      
      // Check Outlook if tokens exist
      if (orgHasOutlookTokens(settings)) {
        try {
          const outlookResult = await outlookReplyTracker.checkForReplies(orgId, lookbackMinutes);
          results.outlook = outlookResult;
          results.checked += outlookResult.checked;
          results.newReplies += outlookResult.newReplies;
          results.errors.push(...outlookResult.errors);
          results.replies.push(...outlookResult.replies);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.errors.push(`Outlook: ${msg}`);
          console.error('[ReplyTracking] Outlook check error:', msg);
        }
      }
      
      console.log(`[ReplyTracking] Check complete: ${results.checked} checked, ${results.newReplies} new events, ${results.errors.length} errors`);
      res.json(results);
    } catch (error) {
      console.error('Reply check error:', error);
      res.status(500).json({ message: 'Failed to check for replies' });
    }
  });

  // Get reply tracking status (Gmail + Outlook)
  app.get('/api/reply-tracking/status', requireAuth, async (req: any, res) => {
    try {
      const gmailStatus = gmailReplyTracker.getStatus();
      const outlookStatus = outlookReplyTracker.getStatus();
      const settings = await storage.getApiSettings(req.user.organizationId);
      const hasGmailToken = orgHasGmailTokens(settings);
      const hasOutlookToken = orgHasOutlookTokens(settings);
      const gmailEmail = settings.gmail_user_email || null;

      res.json({
        ...gmailStatus,
        configured: hasGmailToken || hasOutlookToken,
        gmailEmail,
        hasRefreshToken: !!settings.gmail_refresh_token,
        outlook: {
          ...outlookStatus,
          configured: hasOutlookToken,
        },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get tracking status' });
    }
  });

  // Comprehensive bounce/reply tracking diagnostics
  app.get('/api/reply-tracking/diagnostics', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const emailAccounts = await storage.getEmailAccounts(orgId);
      
      // Check all token sources
      const gmailTokenSources: any[] = [];
      const outlookTokenSources: any[] = [];
      
      for (const key of Object.keys(settings)) {
        if (key.startsWith('gmail_sender_') && key.endsWith('_access_token')) {
          const email = key.match(/^gmail_sender_(.+?)_access_token$/)?.[1] || 'unknown';
          gmailTokenSources.push({ 
            email, type: 'per-sender', 
            hasAccessToken: !!settings[`gmail_sender_${email}_access_token`],
            hasRefreshToken: !!settings[`gmail_sender_${email}_refresh_token`],
            tokenExpiryRaw: settings[`gmail_sender_${email}_token_expiry`] || null,
          });
        }
        if (key.startsWith('outlook_sender_') && key.endsWith('_access_token')) {
          const email = key.match(/^outlook_sender_(.+?)_access_token$/)?.[1] || 'unknown';
          outlookTokenSources.push({ 
            email, type: 'per-sender',
            hasAccessToken: !!settings[`outlook_sender_${email}_access_token`],
            hasRefreshToken: !!settings[`outlook_sender_${email}_refresh_token`],
            tokenExpiryRaw: settings[`outlook_sender_${email}_token_expiry`] || null,
          });
        }
      }
      
      // Org-level tokens
      if (settings.gmail_access_token || settings.gmail_refresh_token) {
        gmailTokenSources.push({ 
          email: settings.gmail_user_email || 'org-level', type: 'org-level',
          hasAccessToken: !!settings.gmail_access_token,
          hasRefreshToken: !!settings.gmail_refresh_token,
          tokenExpiryRaw: settings.gmail_token_expiry || null,
        });
      }
      if (settings.microsoft_access_token || settings.microsoft_refresh_token) {
        outlookTokenSources.push({ 
          email: settings.microsoft_user_email || 'org-level', type: 'org-level',
          hasAccessToken: !!settings.microsoft_access_token,
          hasRefreshToken: !!settings.microsoft_refresh_token,
          tokenExpiryRaw: settings.microsoft_token_expiry || null,
        });
      }
      
      // Accounts vs tokens comparison
      const accountsWithoutTokens = emailAccounts.filter((a: any) => {
        if (a.smtpConfig?.auth?.pass !== 'OAUTH_TOKEN') return false; // SMTP accounts don't need OAuth tokens
        if (a.provider === 'outlook' || a.provider === 'microsoft') {
          return !settings[`outlook_sender_${a.email}_access_token`] && 
                 !settings[`outlook_sender_${a.email}_refresh_token`] &&
                 !(settings.microsoft_access_token && settings.microsoft_user_email === a.email);
        }
        if (a.provider === 'gmail' || a.provider === 'google') {
          return !settings[`gmail_sender_${a.email}_access_token`] && 
                 !settings[`gmail_sender_${a.email}_refresh_token`] &&
                 !(settings.gmail_access_token && settings.gmail_user_email === a.email);
        }
        return false;
      }).map((a: any) => ({ email: a.email, provider: a.provider, id: a.id }));
      
      // Bounce statistics
      const bouncedMessages = await storage.getBouncedMessagesWithContacts(orgId);
      const bounceEvents = await storage.getBounceEventsWithContacts(orgId);
      
      // Tracker status
      const gmailStatus = gmailReplyTracker.getStatus();
      const outlookStatus = outlookReplyTracker.getStatus();
      
      res.json({
        orgId,
        trackerStatus: {
          gmail: { ...gmailStatus, hasTokens: orgHasGmailTokens(settings) },
          outlook: { ...outlookStatus, hasTokens: orgHasOutlookTokens(settings) },
        },
        tokenSources: {
          gmail: gmailTokenSources,
          outlook: outlookTokenSources,
        },
        emailAccounts: emailAccounts.map((a: any) => ({ 
          id: a.id, email: a.email, provider: a.provider, 
          isOAuth: a.smtpConfig?.auth?.pass === 'OAUTH_TOKEN',
          isActive: a.isActive,
        })),
        accountsWithoutTokens,
        bounceStats: {
          bouncedMessages: bouncedMessages.length,
          bounceEvents: bounceEvents.length,
        },
        recommendation: accountsWithoutTokens.length > 0
          ? `${accountsWithoutTokens.length} OAuth account(s) missing tokens. These accounts need re-authentication: ${accountsWithoutTokens.map(a => a.email).join(', ')}`
          : 'All OAuth accounts have tokens. Bounce tracking should be working.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[ReplyTracking] Diagnostics error:', error);
      res.status(500).json({ message: 'Failed to get tracking diagnostics' });
    }
  });

  // Start auto-polling for replies (Gmail + Outlook)
  app.post('/api/reply-tracking/start', requireAuth, async (req: any, res) => {
    try {
      const intervalMinutes = parseInt(req.body.intervalMinutes) || 5;
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      
      if (orgHasGmailTokens(settings)) {
        gmailReplyTracker.startAutoCheck(orgId, intervalMinutes);
      }
      if (orgHasOutlookTokens(settings)) {
        outlookReplyTracker.startAutoCheck(orgId, intervalMinutes);
      }
      res.json({ success: true, intervalMinutes });
    } catch (error) {
      res.status(500).json({ message: 'Failed to start reply tracking' });
    }
  });

  // Stop auto-polling for replies (Gmail + Outlook)
  app.post('/api/reply-tracking/stop', requireAuth, async (req: any, res) => {
    try {
      gmailReplyTracker.stopAutoCheck();
      outlookReplyTracker.stopAutoCheck();
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
      const testSubject = `[TEST] ${firstSubject}`;
      const provider = (account as any).provider || account.smtpConfig?.provider || '';
      const isOAuthAccount = account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
      const fromEmail = account.smtpConfig?.fromEmail || (account as any).email || '';
      const orgId = req.user.organizationId;

      let result: any;

      if ((provider === 'gmail' || provider === 'google') && isOAuthAccount) {
        // Send via Gmail API with token refresh
        const settings = await storage.getApiSettings(orgId);
        let accessToken = settings[`gmail_sender_${fromEmail}_access_token`] || settings.gmail_access_token;
        const refreshToken = settings[`gmail_sender_${fromEmail}_refresh_token`] || settings.gmail_refresh_token;
        const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
        const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';

        // Also check superadmin org for OAuth credentials
        let effectiveClientId = clientId;
        let effectiveClientSecret = clientSecret;
        if (!effectiveClientId || !effectiveClientSecret) {
          try {
            const superAdminOrgId = await storage.getSuperAdminOrgId();
            if (superAdminOrgId && superAdminOrgId !== orgId) {
              const superSettings = await storage.getApiSettings(superAdminOrgId);
              if (superSettings.google_oauth_client_id) {
                effectiveClientId = superSettings.google_oauth_client_id;
                effectiveClientSecret = superSettings.google_oauth_client_secret || '';
              }
            }
          } catch (e) { /* ignore */ }
          if (!effectiveClientId) effectiveClientId = process.env.GOOGLE_CLIENT_ID || '';
          if (!effectiveClientSecret) effectiveClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
        }

        // Helper to refresh token
        const doRefresh = async (): Promise<string | null> => {
          if (!refreshToken || !effectiveClientId || !effectiveClientSecret) return null;
          try {
            const oauth2Client = createOAuth2Client({ clientId: effectiveClientId, clientSecret: effectiveClientSecret, redirectUri: '' });
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await oauth2Client.refreshAccessToken();
            if (credentials.access_token) {
              await storage.setApiSetting(orgId, `gmail_sender_${fromEmail}_access_token`, credentials.access_token);
              if (credentials.expiry_date) await storage.setApiSetting(orgId, `gmail_sender_${fromEmail}_token_expiry`, String(credentials.expiry_date));
              return credentials.access_token;
            }
          } catch (refreshErr) {
            console.error('[SendTest] Gmail token refresh failed:', refreshErr);
          }
          return null;
        };

        // Always force-refresh the token before sending test email to ensure it's valid
        const refreshedToken = await doRefresh();
        if (refreshedToken) {
          accessToken = refreshedToken;
        }

        if (!accessToken) {
          return res.status(400).json({ success: false, error: `Gmail OAuth token not found for ${fromEmail}. Please disconnect and re-connect this Gmail account.` });
        }

        // Send via Gmail API
        const fromHeader = account.smtpConfig?.fromName ? `${account.smtpConfig.fromName} <${fromEmail}>` : fromEmail;
        const raw = Buffer.from(
          `From: ${fromHeader}\r\nTo: ${toEmail}\r\nSubject: ${testSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${fullHtml}`
        ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        let sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });

        // If 401, force refresh and retry once
        if (sendResp.status === 401) {
          console.log(`[SendTest] Gmail API returned 401 for ${fromEmail}, forcing token refresh and retry...`);
          const retryToken = await doRefresh();
          if (retryToken) {
            accessToken = retryToken;
            sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST',
              headers: { Authorization: `Bearer ${retryToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw }),
            });
          }
        }

        if (sendResp.ok) {
          const sendData = await sendResp.json() as any;
          result = { success: true, messageId: sendData.id };
        } else if (sendResp.status === 401) {
          result = { success: false, error: `Gmail OAuth token is invalid for ${fromEmail}. Please disconnect this account and re-connect it with Google to refresh permissions.` };
        } else {
          const errText = await sendResp.text();
          result = { success: false, error: `Gmail API error (${sendResp.status}): ${errText}` };
        }
      } else if ((provider === 'outlook' || provider === 'microsoft') && isOAuthAccount) {
        // Send via Microsoft Graph API with token refresh
        const settings = await storage.getApiSettings(orgId);
        let accessToken = settings[`outlook_sender_${fromEmail}_access_token`] || settings.microsoft_access_token;
        const refreshToken = settings[`outlook_sender_${fromEmail}_refresh_token`] || settings.microsoft_refresh_token;
        const tokenExpiry = settings[`outlook_sender_${fromEmail}_token_expiry`] || settings.microsoft_token_expiry;
        const expiry = parseInt(tokenExpiry || '0');

        if (refreshToken && (!accessToken || Date.now() >= expiry - 300000)) {
          const clientId = settings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
          const clientSecret = settings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';
          if (clientId && clientSecret) {
            try {
              const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: 'Mail.Send Mail.ReadWrite' }),
              });
              if (tokenResp.ok) {
                const tokens = await tokenResp.json() as any;
                if (tokens.access_token) {
                  accessToken = tokens.access_token;
                  await storage.setApiSetting(orgId, `outlook_sender_${fromEmail}_access_token`, tokens.access_token);
                  if (tokens.expires_in) await storage.setApiSetting(orgId, `outlook_sender_${fromEmail}_token_expiry`, String(Date.now() + tokens.expires_in * 1000));
                }
              }
            } catch (refreshErr) {
              console.error('[SendTest] Outlook token refresh failed:', refreshErr);
            }
          }
        }

        if (!accessToken) {
          return res.status(400).json({ success: false, error: `Outlook OAuth token not found for ${fromEmail}. Please re-authenticate with Microsoft.` });
        }

        const graphResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: testSubject,
              body: { contentType: 'HTML', content: fullHtml },
              toRecipients: [{ emailAddress: { address: toEmail } }],
            },
            saveToSentItems: true,
          }),
        });

        if (graphResp.ok) {
          result = { success: true, messageId: `graph-${Date.now()}` };
        } else {
          const errText = await graphResp.text();
          result = { success: false, error: `Graph API error (${graphResp.status}): ${errText}` };
        }
      } else {
        // Non-OAuth account — use SMTP directly
        result = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
          to: toEmail,
          subject: testSubject,
          html: fullHtml,
        });
      }

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
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const lists = isAdmin
        ? await storage.getContactLists(req.user.organizationId)
        : await storage.getContactListsForUser(req.user.organizationId, req.user.id);
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

  // Campaigns that used contacts from this list
  app.get('/api/contact-lists/:id/campaigns', async (req: any, res) => {
    try {
      const list = await storage.getContactList(req.params.id);
      if (!list) return res.status(404).json({ message: 'Not found' });

      // Find campaigns that included contacts from this list — join entirely in DB
      const campaigns = await storage.rawAll(
        `SELECT DISTINCT c.id, c.name, c.status, c."sentCount", c."totalRecipients", c."createdAt", c."createdBy",
                COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), u.email) as "createdByName"
         FROM campaigns c
         LEFT JOIN users u ON u.id = c."createdBy"
         WHERE c."organizationId" = $1
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(c."contactIds") = 'array' THEN c."contactIds" ELSE '[]'::jsonb END
             ) AS cid
             JOIN contacts ct ON ct.id = cid
             WHERE ct."listId" = $2
           )
         ORDER BY c."createdAt" DESC
         LIMIT 50`,
        req.user.organizationId,
        req.params.id
      ) as any[];

      res.json(campaigns);
    } catch (error) {
      console.error('List campaigns fetch error:', error);
      res.status(500).json({ message: 'Failed to fetch campaigns for list' });
    }
  });

  // Create a new (empty) contact list
  app.post('/api/contact-lists', async (req: any, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
      const uploaderName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email?.split('@')[0] || 'Unknown';
      const list = await storage.createContactList({
        organizationId: req.user.organizationId,
        name: name.trim(),
        source: 'manual',
        headers: [],
        contactCount: 0,
        uploadedBy: req.user.id,
        uploadedByName: uploaderName,
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
      const deleteContacts = req.query.deleteContacts === 'true';
      await storage.deleteContactList(req.params.id, deleteContacts);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete contact list' });
    }
  });

  // PR2: Add selected contacts to a NEW or EXISTING list.
  // Accepts either explicit `contactIds` OR a `filter` object that mirrors
  // GET /api/contacts query params (for select-all-matching across pages).
  // NOTE: contacts.listId is single-valued — adding moves contacts from their
  // previous list; the response includes `moved` count to surface this in UI.
  app.post('/api/contact-lists/add-contacts', async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const { listId: targetListId, newList, contactIds, filter } = req.body || {};

      if (!targetListId && (!newList || !newList.name || !String(newList.name).trim())) {
        return res.status(400).json({ message: 'Provide listId or newList.name' });
      }
      if (!Array.isArray(contactIds) && !filter) {
        return res.status(400).json({ message: 'Provide contactIds or filter' });
      }

      // Resolve target list (create if requested)
      let listRow: any;
      if (targetListId) {
        listRow = await storage.rawGet(`SELECT * FROM contact_lists WHERE id = ? AND "organizationId" = ?`, targetListId, orgId);
        if (!listRow) return res.status(404).json({ message: 'List not found' });
      } else {
        const uploaderName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email?.split('@')[0] || 'Unknown';
        listRow = await storage.createContactList({
          organizationId: orgId,
          name: String(newList.name).trim(),
          description: newList.description ? String(newList.description).trim() : undefined,
          source: 'manual',
          headers: [],
          contactCount: 0,
          uploadedBy: req.user.id,
          uploadedByName: uploaderName,
        });
      }

      // Resolve the set of contact ids to update
      let idsToUpdate: string[] = [];
      if (Array.isArray(contactIds) && contactIds.length > 0) {
        // Validate ownership — only touch contacts in this org the user can see
        const ph = contactIds.map(() => '?').join(',');
        const conds: string[] = [`c."organizationId" = ?`, `c.id IN (${ph})`];
        const params: any[] = [orgId, ...contactIds];
        if (!isAdmin) { conds.push(`c."assignedTo" = ?`); params.push(req.user.id); }
        const rows = await storage.rawAll(`SELECT c.id FROM contacts c WHERE ${conds.join(' AND ')}`, ...params);
        idsToUpdate = rows.map((r: any) => r.id);
      } else if (filter) {
        // Build WHERE from filter (mirrors /api/contacts advanced path)
        const conds: string[] = [`c."organizationId" = ?`];
        const params: any[] = [orgId];
        if (!isAdmin) { conds.push(`c."assignedTo" = ?`); params.push(req.user.id); }
        else if (filter.assignedTo) {
          if (filter.assignedTo === 'unassigned') conds.push(`(c."assignedTo" IS NULL OR c."assignedTo" = '')`);
          else { conds.push(`c."assignedTo" = ?`); params.push(filter.assignedTo); }
        }
        if (filter.listId) {
          conds.push(`EXISTS (SELECT 1 FROM contact_list_members clm WHERE clm."contactId" = c.id AND clm."listId" = ?)`);
          params.push(filter.listId);
        }
        if (filter.status && filter.status !== 'all') { conds.push(`c.status = ?`); params.push(filter.status); }
        if (filter.pipelineStage && filter.pipelineStage !== 'all') { conds.push(`c."pipelineStage" = ?`); params.push(filter.pipelineStage); }
        if (filter.company) { conds.push(`LOWER(c.company) LIKE ?`); params.push(`%${String(filter.company).toLowerCase()}%`); }
        if (filter.location) {
          const locExact = String(filter.location).toLowerCase();
          const locLike = `%${locExact}%`;
          conds.push(`(LOWER(TRIM(SPLIT_PART(c.city, ',', 1))) = ? OR LOWER(c.city) LIKE ? OR LOWER(c.state) LIKE ? OR LOWER(TRIM(SPLIT_PART(c.country, ',', 1))) = ? OR LOWER(c.country) LIKE ?)`);
          params.push(locExact, locLike, locLike, locExact, locLike);
        }
        if (filter.designation) { conds.push(`LOWER(c."jobTitle") LIKE ?`); params.push(`%${String(filter.designation).toLowerCase()}%`); }
        if (filter.keywordFilter) {
          const terms = String(filter.keywordFilter).split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
          const termClauses = terms.map(() =>
            `(LOWER(c."jobTitle") LIKE ? OR LOWER(c.industry) LIKE ? OR LOWER(c.department) LIKE ? OR LOWER(c.seniority) LIKE ? OR LOWER(c.company) LIKE ?)`
          );
          conds.push(`(${termClauses.join(' OR ')})`);
          for (const t of terms) { params.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`); }
        }
        if (filter.seniorityFilter) {
          const senTerms = String(filter.seniorityFilter).split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
          if (senTerms.length === 1) {
            conds.push('LOWER(c.seniority) LIKE ?'); params.push(`%${senTerms[0]}%`);
          } else if (senTerms.length > 1) {
            conds.push(`(${senTerms.map(() => 'LOWER(c.seniority) LIKE ?').join(' OR ')})`);
            senTerms.forEach((t: string) => params.push(`%${t}%`));
          }
        }
        if (filter.industryFilter) { const _inds = String(filter.industryFilter).split(',').map((s:string)=>s.trim().toLowerCase()).filter(Boolean); if (_inds.length===1) { conds.push('LOWER(c.industry) LIKE ?'); params.push(`%${_inds[0]}%`); } else if (_inds.length>1) { conds.push('('+_inds.map(()=>'LOWER(c.industry) LIKE ?').join(' OR ')+')'); params.push(..._inds.map(i=>`%${i}%`)); } }
        if (filter.tagsFilter) { conds.push('LOWER(CAST(c.tags AS TEXT)) LIKE ?'); params.push(`%${String(filter.tagsFilter).toLowerCase()}%`); }
        if (filter.emailVerification) { conds.push('c."emailVerificationStatus" = ?'); params.push(String(filter.emailVerification)); }
        if (filter.emailRatingGrade) { conds.push('c."emailRatingGrade" = ?'); params.push(String(filter.emailRatingGrade)); }
        if (filter.employeeRange) {
          const ranges: Record<string, string> = {
            '1-10': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 1 AND 10)`,
            '11-50': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 11 AND 50)`,
            '51-200': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 51 AND 200)`,
            '201-1000': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 201 AND 1000)`,
            '1000+': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) > 1000)`,
          };
          if (ranges[String(filter.employeeRange)]) conds.push(ranges[String(filter.employeeRange)]);
        }
        if (filter.leadFilter && filter.leadFilter !== 'all') {
          const lf = String(filter.leadFilter);
          const bucket = lf === 'hot_leads' ? 'hot_lead' : lf === 'warm_leads' ? 'warm_lead' : lf === 'past_customer' ? 'past_customer' : null;
          if (bucket) {
            conds.push(`LOWER(c.email) IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket = ?)`);
            params.push(orgId, bucket);
          } else if (lf === 'engaged') {
            conds.push(`(c."totalOpened" > 0 OR c."totalClicked" > 0 OR c."totalReplied" > 0)`);
          } else if (lf === 'never_contacted') {
            conds.push(`(c."totalSent" = 0 OR c."totalSent" IS NULL)`);
          }
        }
        if (filter.search) {
          const q = `%${String(filter.search).toLowerCase()}%`;
          conds.push(`(LOWER(c."firstName") LIKE ? OR LOWER(c."lastName") LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.company) LIKE ? OR LOWER(c."jobTitle") LIKE ? OR LOWER(c.city) LIKE ?)`);
          params.push(q, q, q, q, q, q);
        }
        const rows = await storage.rawAll(`SELECT c.id FROM contacts c WHERE ${conds.join(' AND ')}`, ...params);
        idsToUpdate = rows.map((r: any) => r.id);
      }

      if (idsToUpdate.length === 0) {
        return res.json({ success: true, listId: listRow.id, listName: listRow.name, added: 0, moved: 0 });
      }

      // Count how many are moving from a different list (for UI messaging)
      const mph = idsToUpdate.map(() => '?').join(',');
      const movedRow = await storage.rawGet(
        `SELECT COUNT(*) as cnt FROM contacts WHERE id IN (${mph}) AND "listId" IS NOT NULL AND "listId" != ?`,
        ...idsToUpdate, listRow.id
      ) as any;
      const moved = movedRow?.cnt || 0;

      // Perform the assignment — update primary listId and write junction rows
      const ts = new Date().toISOString();
      await storage.rawRun(
        `UPDATE contacts SET "listId" = ?, "updatedAt" = ? WHERE id IN (${mph}) AND "organizationId" = ?`,
        listRow.id, ts, ...idsToUpdate, orgId
      );
      // Write junction membership rows (idempotent — ON CONFLICT DO NOTHING)
      for (const cid of idsToUpdate) {
        try {
          await storage.rawRun(
            `INSERT INTO contact_list_members ("contactId", "listId", "addedAt") VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
            cid, listRow.id, ts
          );
        } catch { /* non-fatal */ }
      }

      // Refresh contactCount on affected lists (based on junction table)
      try {
        await storage.rawRun(
          `UPDATE contact_lists SET "contactCount" = (SELECT COUNT(*) FROM contact_list_members WHERE "listId" = contact_lists.id) WHERE "organizationId" = ?`,
          orgId
        );
      } catch { /* non-fatal */ }

      res.json({ success: true, listId: listRow.id, listName: listRow.name, added: idsToUpdate.length, moved });
    } catch (error: any) {
      console.error('[add-contacts] error:', error?.message, error?.stack?.slice(0, 300));
      res.status(500).json({ message: 'Failed to add contacts to list' });
    }
  });

  // PR2: Per-user saved views (filters + columns + sort) stored in api_settings.
  // Key format: `contact_views:<userId>` → JSON array of { id, name, createdAt, data }.
  app.get('/api/my/contact-views', async (req: any, res) => {
    try {
      const key = `contact_views:${req.user.id}`;
      const settings = await storage.getApiSettings(req.user.organizationId);
      const raw = settings?.[key] || '[]';
      let views: any[] = [];
      try { views = JSON.parse(raw); if (!Array.isArray(views)) views = []; } catch { views = []; }
      res.json(views);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load views' });
    }
  });

  app.post('/api/my/contact-views', async (req: any, res) => {
    try {
      const { name, data } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ message: 'Name required' });
      if (!data || typeof data !== 'object') return res.status(400).json({ message: 'data object required' });
      const key = `contact_views:${req.user.id}`;
      const settings = await storage.getApiSettings(req.user.organizationId);
      let views: any[] = [];
      try { views = JSON.parse(settings?.[key] || '[]'); if (!Array.isArray(views)) views = []; } catch { views = []; }
      const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const view = { id, name: String(name).trim(), createdAt: new Date().toISOString(), data };
      views.push(view);
      if (views.length > 50) views = views.slice(-50); // cap per-user
      await storage.setApiSetting(req.user.organizationId, key, JSON.stringify(views));
      res.status(201).json(view);
    } catch (error) {
      res.status(500).json({ message: 'Failed to save view' });
    }
  });

  app.delete('/api/my/contact-views/:id', async (req: any, res) => {
    try {
      const key = `contact_views:${req.user.id}`;
      const settings = await storage.getApiSettings(req.user.organizationId);
      let views: any[] = [];
      try { views = JSON.parse(settings?.[key] || '[]'); if (!Array.isArray(views)) views = []; } catch { views = []; }
      const before = views.length;
      views = views.filter(v => v.id !== req.params.id);
      if (views.length === before) return res.status(404).json({ message: 'View not found' });
      await storage.setApiSetting(req.user.organizationId, key, JSON.stringify(views));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete view' });
    }
  });

  // ========== CONTACTS ==========

  app.get('/api/contacts', async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const search = (req.query.search as string || '').trim();
      const status = req.query.status as string;
      const listId = req.query.listId as string;
      const assignedTo = req.query.assignedTo as string;
      const pipelineStage = req.query.pipelineStage as string;
      const company = req.query.company as string;
      const location = req.query.location as string;
      const cityFilter = (req.query.cityFilter as string || '').trim();
      const countryFilter = (req.query.countryFilter as string || '').trim();
      const designation = (req.query.designation as string || '').trim();
      const keywordFilter = (req.query.keywordFilter as string || '').trim();
      const seniorityFilter = (req.query.seniorityFilter as string || '').trim();
      const industryFilter = (req.query.industryFilter as string || '').trim();
      const employeeRange = (req.query.employeeRange as string || '').trim(); // 1-10, 11-50, 51-200, 201-1000, 1000+
      const emailVerification = (req.query.emailVerification as string || '').trim(); // verified, unverified, risky, unknown
      const emailRatingGrade = (req.query.emailRatingGrade as string || '').trim(); // A, B, C, D, F
      const tagsFilter = (req.query.tagsFilter as string || '').trim();
      const leadFilter = req.query.leadFilter as string;
      const sortByParam = req.query.sortBy as string || 'createdAt';
      const sortOrder = (req.query.sortOrder as string || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const orgId = req.user.organizationId;

      // Build filters object for storage methods
      const filters: { listId?: string; status?: string; assignedTo?: string } = {};
      if (listId) filters.listId = listId;
      if (status && status !== 'all') filters.status = status;

      // === PRIMARY PATH: Use proven storage methods (always works) ===
      // Storage methods handle pagination, filtering, and default sort (createdAt DESC)
      let contacts: any[];
      let total: number;

      if (isAdmin && assignedTo) {
        if (assignedTo === 'unassigned') {
          filters.assignedTo = 'unassigned';
          contacts = await storage.getContacts(orgId, limit, offset, filters);
          total = await storage.getContactsCount(orgId, filters);
        } else {
          contacts = await storage.getContactsForUser(orgId, assignedTo, limit, offset, filters);
          total = await storage.getContactsCountForUser(orgId, assignedTo, filters);
        }
      } else if (!isAdmin) {
        contacts = await storage.getContactsForUser(orgId, req.user.id, limit, offset, filters);
        total = await storage.getContactsCountForUser(orgId, req.user.id, filters);
      } else {
        contacts = await storage.getContacts(orgId, limit, offset, filters);
        total = await storage.getContactsCount(orgId, filters);
      }

      // === ENHANCEMENT: If user requested sorting/search/advanced filters, try SQL path ===
      // On failure, keep the storage-fetched contacts (unsorted but correct data)
      const needsAdvanced = search || pipelineStage || company || location || cityFilter || countryFilter || designation || keywordFilter || seniorityFilter || industryFilter || employeeRange || emailVerification || emailRatingGrade || tagsFilter || leadFilter || (sortByParam && sortByParam !== 'createdAt');
      if (needsAdvanced) {
        try {
          // rawGet/rawAll/rawRun used for advanced SQL path

          const conditions: string[] = ['c."organizationId" = ?'];
          const params: any[] = [orgId];

          if (!isAdmin) {
            conditions.push('c."assignedTo" = ?');
            params.push(req.user.id);
          } else if (assignedTo) {
            if (assignedTo === 'unassigned') {
              conditions.push(`(c."assignedTo" IS NULL OR c."assignedTo" = '')`);
            } else {
              conditions.push('c."assignedTo" = ?');
              params.push(assignedTo);
            }
          }

          if (listId) {
            conditions.push(`EXISTS (SELECT 1 FROM contact_list_members clm WHERE clm."contactId" = c.id AND clm."listId" = ?)`);
            params.push(listId);
          }
          if (status && status !== 'all') { conditions.push('c.status = ?'); params.push(status); }
          if (pipelineStage && pipelineStage !== 'all') { conditions.push('c."pipelineStage" = ?'); params.push(pipelineStage); }
          if (company) {
            const cos = company.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
            if (cos.length === 1) { conditions.push('LOWER(c.company) LIKE ?'); params.push(`%${cos[0]}%`); }
            else if (cos.length > 1) { conditions.push(`(${cos.map(() => 'LOWER(c.company) LIKE ?').join(' OR ')})`); cos.forEach((c: string) => params.push(`%${c}%`)); }
          }
          if (location) {
            const locExact = location.toLowerCase();
            const locLike = `%${locExact}%`;
            conditions.push('(LOWER(TRIM(SPLIT_PART(c.city, \',\', 1))) = ? OR LOWER(c.city) LIKE ? OR LOWER(c.state) LIKE ? OR LOWER(TRIM(SPLIT_PART(c.country, \',\', 1))) = ? OR LOWER(c.country) LIKE ?)');
            params.push(locExact, locLike, locLike, locExact, locLike);
          }
          if (cityFilter) {
            const cities = cityFilter.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
            if (cities.length === 1) { conditions.push('LOWER(TRIM(SPLIT_PART(c.city, \',\', 1))) LIKE ?'); params.push(`%${cities[0]}%`); }
            else if (cities.length > 1) { conditions.push(`(${cities.map(() => 'LOWER(TRIM(SPLIT_PART(c.city, \',\', 1))) LIKE ?').join(' OR ')})`); cities.forEach((c: string) => params.push(`%${c}%`)); }
          }
          if (countryFilter) {
            const countries = countryFilter.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
            if (countries.length === 1) { conditions.push('LOWER(TRIM(c.country)) LIKE ?'); params.push(`%${countries[0]}%`); }
            else if (countries.length > 1) { conditions.push(`(${countries.map(() => 'LOWER(TRIM(c.country)) LIKE ?').join(' OR ')})`); countries.forEach((c: string) => params.push(`%${c}%`)); }
          }
          // Designation: keyword search across jobTitle (free-text, not exact match)
          if (designation) {
            conditions.push('LOWER(c."jobTitle") LIKE ?');
            params.push(`%${designation.toLowerCase()}%`);
          }
          // Keyword filter: jobTitle + industry + department + seniority + company (comma = OR)
          if (keywordFilter) {
            const terms = keywordFilter.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
            const termClauses = terms.map(() =>
              `(LOWER(c."jobTitle") LIKE ? OR LOWER(c.industry) LIKE ? OR LOWER(c.department) LIKE ? OR LOWER(c.seniority) LIKE ? OR LOWER(c.company) LIKE ?)`
            );
            conditions.push(`(${termClauses.join(' OR ')})`);
            for (const t of terms) { params.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`); }
          }
          if (seniorityFilter) {
            // comma-separated multi-select OR logic
            const senTerms = seniorityFilter.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
            if (senTerms.length === 1) {
              conditions.push('LOWER(c.seniority) LIKE ?'); params.push(`%${senTerms[0]}%`);
            } else if (senTerms.length > 1) {
              conditions.push(`(${senTerms.map(() => 'LOWER(c.seniority) LIKE ?').join(' OR ')})`);
              senTerms.forEach((t: string) => params.push(`%${t}%`));
            }
          }
          if (industryFilter) { const _inds2 = industryFilter.split(',').map((s:string)=>s.trim().toLowerCase()).filter(Boolean); if (_inds2.length===1) { conditions.push('LOWER(c.industry) LIKE ?'); params.push(`%${_inds2[0]}%`); } else if (_inds2.length>1) { conditions.push('('+_inds2.map(()=>'LOWER(c.industry) LIKE ?').join(' OR ')+')'); params.push(..._inds2.map(i=>`%${i}%`)); } }
          if (tagsFilter) { conditions.push('LOWER(CAST(c.tags AS TEXT)) LIKE ?'); params.push(`%${tagsFilter.toLowerCase()}%`); }
          if (emailVerification) { conditions.push('c."emailVerificationStatus" = ?'); params.push(emailVerification); }
          if (emailRatingGrade) { conditions.push('c."emailRatingGrade" = ?'); params.push(emailRatingGrade); }
          if (employeeRange) {
            const ranges: Record<string, string> = {
              '1-10':     `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 1 AND 10)`,
              '11-50':    `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 11 AND 50)`,
              '51-200':   `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 51 AND 200)`,
              '201-1000': `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) BETWEEN 201 AND 1000)`,
              '1000+':    `(CAST(NULLIF(REGEXP_REPLACE(c."employeeCount", '[^0-9]', '', 'g'), '') AS BIGINT) > 1000)`,
            };
            if (ranges[employeeRange]) conditions.push(ranges[employeeRange]);
          }

          // Lead intelligence smart filters (requires subquery to lead_opportunities)
          if (leadFilter && leadFilter !== 'all') {
            if (leadFilter === 'hot_leads') {
              conditions.push(`LOWER(c.email) IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket = 'hot_lead')`);
              params.push(orgId);
            } else if (leadFilter === 'warm_leads') {
              conditions.push(`LOWER(c.email) IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket = 'warm_lead')`);
              params.push(orgId);
            } else if (leadFilter === 'past_customer') {
              conditions.push(`LOWER(c.email) IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket = 'past_customer')`);
              params.push(orgId);
            } else if (leadFilter === 'engaged') {
              // Contacts with opens or clicks or replies in campaigns
              conditions.push(`(c."totalOpened" > 0 OR c."totalClicked" > 0 OR c."totalReplied" > 0)`);
            } else if (leadFilter === 'cold') {
              // No engagement in any campaign and no AI classification as hot/warm
              conditions.push(`(c."totalOpened" = 0 OR c."totalOpened" IS NULL) AND (c."totalClicked" = 0 OR c."totalClicked" IS NULL) AND (c."totalReplied" = 0 OR c."totalReplied" IS NULL)`);
              conditions.push(`LOWER(c.email) NOT IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket IN ('hot_lead','warm_lead','past_customer'))`);
              params.push(orgId);
            } else if (leadFilter === 'never_contacted') {
              conditions.push(`(c."totalSent" = 0 OR c."totalSent" IS NULL)`);
            } else {
              // Generic bucket filter (e.g., 'churned', 'vendor', 'newsletter', etc.)
              conditions.push(`LOWER(c.email) IN (SELECT LOWER("contactEmail") FROM lead_opportunities WHERE "organizationId" = ? AND bucket = ?)`);
              params.push(orgId, leadFilter);
            }
          }

          if (search) {
            const q = `%${search.toLowerCase()}%`;
            conditions.push(`(LOWER(c."firstName") LIKE ? OR LOWER(c."lastName") LIKE ? OR LOWER(c.email) LIKE ? OR
              LOWER(c.company) LIKE ? OR LOWER(c."jobTitle") LIKE ? OR LOWER(COALESCE(CAST(c.tags AS TEXT),'')) LIKE ? OR
              LOWER(c.phone) LIKE ? OR LOWER(c."mobilePhone") LIKE ? OR LOWER(c."linkedinUrl") LIKE ? OR
              LOWER(c.city) LIKE ? OR LOWER(c.country) LIKE ? OR LOWER(c.industry) LIKE ?)`);
            params.push(q, q, q, q, q, q, q, q, q, q, q, q);
          }

          const where = conditions.join(' AND ');
          const allowedSorts: Record<string, string> = {
            createdAt: 'c."createdAt"', firstName: 'c."firstName"', company: 'c.company',
            pipelineStage: 'c."pipelineStage"', nextActionDate: 'c."nextActionDate"',
            lastActivityDate: 'c."lastActivityDate"', email: 'c.email', jobTitle: 'c."jobTitle"',
            phone: 'c.phone', mobilePhone: 'c."mobilePhone"', city: 'c.city',
          };
          const sortCol = allowedSorts[sortByParam] || 'c.createdAt';
          const textSortCols = new Set(['c."firstName"', 'c.company', 'c."jobTitle"', 'c.email', 'c.phone', 'c."mobilePhone"', 'c.city']);
          const collate = '';

          const countSql = `SELECT COUNT(*) as cnt FROM contacts c WHERE ${where}`;
          console.log(`[Contacts] Advanced SQL: sort=${sortCol} ${sortOrder}, params=${params.length}, search="${search}"`);
          const countRow = await storage.rawGet(countSql, ...params) as any;
          if (!countRow) throw new Error('COUNT query returned null');
          total = countRow.cnt;

          const selectSql = `SELECT c.* FROM contacts c WHERE ${where} ORDER BY ${sortCol}${collate} ${sortOrder} LIMIT ? OFFSET ?`;
          const advContacts = await storage.rawAll(selectSql, ...params, limit, offset);

          // Add lastRemark separately (safe — won't break if table missing)
          try {
            const ids = advContacts.map((c: any) => c.id);
            if (ids.length > 0) {
              const ph = ids.map(() => '?').join(',');
              const remarks = await storage.rawAll(`SELECT "contactId", notes FROM contact_activities WHERE "contactId" IN (${ph}) AND id IN (SELECT MAX(id) FROM contact_activities WHERE "contactId" IN (${ph}) GROUP BY "contactId")`, ...ids, ...ids);
              const map = new Map(remarks.map((r: any) => [r.contactId, r.notes]));
              advContacts.forEach((c: any) => { c.lastRemark = map.get(c.id) || null; });
            }
          } catch { /* ignore */ }

          // Hydrate JSON fields
          contacts = advContacts.map((row: any) => {
            try { if (row.tags && typeof row.tags === 'string') row.tags = JSON.parse(row.tags); } catch { row.tags = []; }
            try { if (row.customFields && typeof row.customFields === 'string') row.customFields = JSON.parse(row.customFields); } catch { row.customFields = {}; }
            try { if (row.emailRatingDetails && typeof row.emailRatingDetails === 'string') row.emailRatingDetails = JSON.parse(row.emailRatingDetails); } catch { row.emailRatingDetails = null; }
            return row;
          });
          console.log(`[Contacts] Advanced SQL success: ${contacts.length} contacts, total=${total}, sort=${sortCol} ${sortOrder}`);
        } catch (sqlErr: any) {
          // Advanced SQL failed — keep the storage-fetched contacts (already assigned above)
          console.error('[Contacts] Advanced SQL FAILED:', sqlErr.message, '\nSQL sort:', sortByParam, '\nSearch:', search, '\nStack:', sqlErr.stack?.substring(0, 300));
        }
      }

      // Add lastRemark if not already included (safe path doesn't include it)
      if (contacts.length > 0 && !(contacts[0] as any).lastRemark) {
        try {
          const contactIds = contacts.map((c: any) => c.id);
          const placeholders = contactIds.map(() => '?').join(',');
          const remarks = await storage.rawAll(`SELECT ca."contactId", ca.notes FROM contact_activities ca
            WHERE ca."contactId" IN (${placeholders}) AND ca.id IN (
              SELECT MAX(ca2.id) FROM contact_activities ca2 WHERE ca2."contactId" IN (${placeholders}) GROUP BY ca2."contactId"
            )`, ...contactIds, ...contactIds);
          const remarkMap = new Map(remarks.map((r: any) => [r.contactId, r.notes]));
          contacts.forEach((c: any) => { c.lastRemark = remarkMap.get(c.id) || null; });
        } catch { /* contact_activities table may not exist yet — ignore */ }
      }

      // === ENRICHMENT: Add lead intelligence data (AI classification from lead_opportunities) ===
      // Safe enhancement — if lead_opportunities table doesn't exist or query fails, contacts still return fine
      if (contacts.length > 0) {
        try {
          const emails = contacts.map((c: any) => c.email?.toLowerCase()).filter(Boolean);
          if (emails.length > 0) {
            const ph = emails.map(() => '?').join(',');
            // Get the BEST (highest confidence) lead classification per email for this org
            const leadData = await storage.rawAll(`
              SELECT "contactEmail", bucket, confidence, "aiReasoning", "suggestedAction", "lastEmailDate", "totalEmails", "totalReceived", "totalSent", "accountEmail",
                     ROW_NUMBER() OVER (PARTITION BY LOWER("contactEmail") ORDER BY confidence DESC) as rn
              FROM lead_opportunities
              WHERE "organizationId" = ? AND LOWER("contactEmail") IN (${ph})
            `, orgId, ...emails);
            // Only keep rn=1 (best classification per email)
            const leadMap = new Map<string, any>();
            for (const row of leadData as any[]) {
              if (row.rn === 1) {
                leadMap.set(row.contactEmail?.toLowerCase(), {
                  leadBucket: row.bucket,
                  leadConfidence: row.confidence,
                  aiReasoning: row.aiReasoning,
                  suggestedAction: row.suggestedAction,
                  lastEmailDate: row.lastEmailDate,
                  leadTotalEmails: row.totalEmails,
                  leadTotalReceived: row.totalReceived,
                  leadTotalSent: row.totalSent,
                  leadAccountEmail: row.accountEmail,
                });
              }
            }
            contacts.forEach((c: any) => {
              const lead = leadMap.get(c.email?.toLowerCase());
              if (lead) Object.assign(c, lead);
            });
          }
        } catch (leadErr: any) {
          console.error('[Contacts] Lead intelligence enrichment failed (non-fatal):', leadErr.message);
        }
      }

      res.json({ contacts, total, limit, offset });
    } catch (error: any) {
      console.error('[Contacts] GET error:', error.message, error.stack);
      res.status(500).json({ message: 'Failed to fetch contacts' });
    }
  });

  // ========== HOT LEADS — AI-enriched lead view ==========
  app.get('/api/contacts/hot-leads', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const bucket = req.query.bucket as string || 'all'; // hot_lead, warm_lead, past_customer, etc.
      const limit = parseInt(req.query.limit as string) || 25;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = (req.query.search as string || '').trim();
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';

      const conditions: string[] = ['lo."organizationId" = ?'];
      const params: any[] = [orgId];

      if (bucket && bucket !== 'all') {
        conditions.push('lo.bucket = ?');
        params.push(bucket);
      } else {
        // Default: show hot_lead, warm_lead, past_customer (actionable buckets)
        conditions.push(`lo.bucket IN ('hot_lead', 'warm_lead', 'past_customer', 'churned')`);
      }

      if (search) {
        const q = `%${search.toLowerCase()}%`;
        conditions.push(`(LOWER(lo."contactEmail") LIKE ? OR LOWER(lo."contactName") LIKE ? OR LOWER(lo.company) LIKE ?)`);
        params.push(q, q, q);
      }

      // Member role: restrict to their email accounts only
      if (!isAdmin) {
        const memberAccounts = await storage.rawAll(`SELECT email FROM email_accounts WHERE "organizationId" = ? AND "userId" = ?`, orgId, req.user.id) as any[];
        if (memberAccounts.length > 0) {
          const ph = memberAccounts.map(() => '?').join(',');
          conditions.push(`lo."accountEmail" IN (${ph})`);
          params.push(...memberAccounts.map((a: any) => a.email));
        } else {
          return res.json({ leads: [], total: 0, bucketCounts: {} });
        }
      }

      const where = conditions.join(' AND ');

      // Get total count
      const countRow = await storage.rawGet(`SELECT COUNT(*) as cnt FROM lead_opportunities lo WHERE ${where}`, ...params) as any;
      const total = countRow?.cnt || 0;

      // Get leads with contact data joined
      const leads = await storage.rawAll(`
        SELECT lo.*,
               c.id as "contactId", c."firstName", c."lastName", c.company as "contactCompany", c."jobTitle",
               c.phone, c.city, c.country, c.status as "contactStatus", c."pipelineStage",
               c."totalOpened", c."totalClicked", c."totalReplied", c."totalSent" as "contactTotalSent", c."totalBounced",
               c."lastOpenedAt", c."lastClickedAt", c."lastRepliedAt", c."assignedTo"
        FROM lead_opportunities lo
        LEFT JOIN contacts c ON LOWER(c.email) = LOWER(lo."contactEmail") AND c."organizationId" = lo."organizationId"
        WHERE ${where}
        ORDER BY lo.confidence DESC, lo."lastEmailDate" DESC
        LIMIT ? OFFSET ?
      `, ...params, limit, offset);

      // Parse JSON fields
      leads.forEach((l: any) => {
        try { if (l.sampleSubjects && typeof l.sampleSubjects === 'string') l.sampleSubjects = JSON.parse(l.sampleSubjects); } catch { l.sampleSubjects = []; }
        try { if (l.sampleSnippets && typeof l.sampleSnippets === 'string') l.sampleSnippets = JSON.parse(l.sampleSnippets); } catch { l.sampleSnippets = []; }
      });

      // Bucket counts for sidebar
      const bucketCounts = await storage.rawAll(`
        SELECT bucket, COUNT(*) as cnt
        FROM lead_opportunities
        WHERE "organizationId" = ?
        GROUP BY bucket
        ORDER BY cnt DESC
      `, orgId) as any[];
      const bucketCountMap: Record<string, number> = {};
      for (const b of bucketCounts) {
        bucketCountMap[b.bucket] = b.cnt;
      }

      res.json({ leads, total, limit, offset, bucketCounts: bucketCountMap });
    } catch (error: any) {
      console.error('[HotLeads] GET error:', error.message, error.stack);
      res.status(500).json({ message: 'Failed to fetch hot leads' });
    }
  });

  // DEBUG: Test SQL sort/search directly (temporary — remove after fixing)
  app.get('/api/contacts/debug-sql', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const search = (req.query.q as string || '').trim();
      const sortBy = req.query.sort as string || 'createdAt';

      const conditions: string[] = ['c.organizationId = ?'];
      const params: any[] = [orgId];

      if (search) {
        const q = `%${search.toLowerCase()}%`;
        conditions.push(`(LOWER(c.firstName) LIKE ? OR LOWER(c.lastName) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.company) LIKE ?)`);
        params.push(q, q, q, q);
      }

      const where = conditions.join(' AND ');
      const allowedSorts: Record<string, string> = {
        createdAt: 'c.createdAt', firstName: 'c.firstName', company: 'c.company', jobTitle: 'c.jobTitle', city: 'c.city',
      };
      const sortCol = allowedSorts[sortBy] || 'c.createdAt';

      const total = (await storage.rawGet(`SELECT COUNT(*) as cnt FROM contacts c WHERE ${where}`, ...params) as any).cnt;
      const rows = await storage.rawAll(`SELECT c.id, c.firstName, c.lastName, c.company, c.email FROM contacts c WHERE ${where} ORDER BY ${sortCol} COLLATE NOCASE ASC LIMIT 5`, ...params);

      res.json({ success: true, total, sortCol, where, paramCount: params.length, rows });
    } catch (e: any) {
      res.json({ success: false, error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
    }
  });

  // Server-side type-ahead search for company / city / country dropdowns
  app.get('/api/contacts/field-search', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const field = (req.query.field as string || '').trim();
      const q = (req.query.q as string || '').trim();
      if (!q) return res.json({ results: [] });
      const like = `%${q}%`;
      let rows: any[] = [];
      if (field === 'company') {
        rows = await storage.rawAll(
          `SELECT DISTINCT INITCAP(LOWER(company)) AS val FROM contacts WHERE "organizationId" = ? AND company IS NOT NULL AND company != '' AND LOWER(company) LIKE LOWER(?) AND company NOT LIKE '+%' AND company NOT LIKE '%http%' AND company NOT LIKE '%@%' AND LENGTH(company) BETWEEN 2 AND 100 ORDER BY 1 LIMIT 30`,
          orgId, like
        );
      } else if (field === 'city') {
        rows = await storage.rawAll(
          `SELECT DISTINCT INITCAP(LOWER(TRIM(SPLIT_PART(city, ',', 1)))) AS val FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city != '' AND city NOT LIKE '+%' AND LOWER(city) LIKE LOWER(?) AND LENGTH(TRIM(SPLIT_PART(city, ',', 1))) BETWEEN 2 AND 50 AND LEFT(TRIM(city), 1) NOT BETWEEN '0' AND '9' AND TRIM(SPLIT_PART(city, ',', 1)) NOT ILIKE '%highway%' AND TRIM(SPLIT_PART(city, ',', 1)) NOT ILIKE '% road' AND TRIM(SPLIT_PART(city, ',', 1)) NOT ILIKE '% road %' ORDER BY 1 LIMIT 30`,
          orgId, like
        );
      } else if (field === 'country') {
        rows = await storage.rawAll(
          `SELECT DISTINCT INITCAP(LOWER(TRIM(country))) AS val FROM contacts WHERE "organizationId" = ? AND country IS NOT NULL AND country != '' AND country NOT LIKE '+%' AND LOWER(country) LIKE LOWER(?) AND LENGTH(TRIM(country)) BETWEEN 2 AND 60 ORDER BY 1 LIMIT 30`,
          orgId, like
        );
      } else {
        return res.status(400).json({ message: 'Invalid field' });
      }
      res.json({ results: rows.map((r: any) => r.val).filter(Boolean) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/contacts/filter-options', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const [companies, designations, cities, countries, industries, departments, seniorities, tagRows] = await Promise.all([
        storage.rawAll(`SELECT DISTINCT company FROM contacts WHERE "organizationId" = ? AND company IS NOT NULL AND company != '' AND company NOT LIKE '+%' AND company NOT LIKE '%http%' AND company NOT LIKE '%@%' AND LENGTH(company) BETWEEN 2 AND 100 ORDER BY company LIMIT 200`, orgId),
        storage.rawAll(`SELECT DISTINCT "jobTitle" FROM contacts WHERE "organizationId" = ? AND "jobTitle" IS NOT NULL AND "jobTitle" != '' AND "jobTitle" NOT LIKE '+%' AND "jobTitle" NOT LIKE '%http%' AND "jobTitle" NOT LIKE '%@%' AND LENGTH("jobTitle") BETWEEN 2 AND 100 ORDER BY "jobTitle" LIMIT 300`, orgId),
        storage.rawAll(`SELECT DISTINCT INITCAP(LOWER(TRIM(SPLIT_PART(city, ',', 1)))) as city FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city != '' AND city NOT LIKE '+%' AND LEFT(TRIM(city), 1) NOT BETWEEN '0' AND '9' AND LENGTH(TRIM(SPLIT_PART(city, ',', 1))) BETWEEN 2 AND 60 AND TRIM(SPLIT_PART(city, ',', 1)) NOT ILIKE '%highway%' AND TRIM(SPLIT_PART(city, ',', 1)) NOT ILIKE '% road' ORDER BY 1 LIMIT 300`, orgId),
        storage.rawAll(`SELECT DISTINCT INITCAP(LOWER(TRIM(SPLIT_PART(country, ',', 1)))) as country FROM contacts WHERE "organizationId" = ? AND country IS NOT NULL AND country != '' AND country NOT LIKE '+%' AND LENGTH(TRIM(SPLIT_PART(country, ',', 1))) BETWEEN 2 AND 60 ORDER BY 1 LIMIT 150`, orgId),
        storage.rawAll(`SELECT DISTINCT INITCAP(LOWER(industry)) as industry FROM contacts WHERE "organizationId" = ? AND industry IS NOT NULL AND industry != '' AND industry NOT LIKE '%http%' AND industry NOT LIKE '%@%' AND industry NOT LIKE '%,%' AND LENGTH(industry) BETWEEN 3 AND 60 AND industry ~ '[a-zA-Z]' ORDER BY 1 LIMIT 500`, orgId),
        storage.rawAll(`SELECT DISTINCT department FROM contacts WHERE "organizationId" = ? AND department IS NOT NULL AND department != '' ORDER BY department LIMIT 100`, orgId),
        storage.rawAll(`SELECT DISTINCT seniority FROM contacts WHERE "organizationId" = ? AND seniority IS NOT NULL AND seniority != '' ORDER BY seniority LIMIT 50`, orgId),
        storage.rawAll(`SELECT DISTINCT t.tag FROM (SELECT tags FROM contacts WHERE "organizationId" = ? AND tags IS NOT NULL AND tags::text NOT IN ('', 'null', '[]') AND tags::text LIKE '[%') AS c CROSS JOIN LATERAL jsonb_array_elements_text(c.tags::jsonb) AS t(tag) WHERE t.tag IS NOT NULL AND t.tag != '' ORDER BY t.tag LIMIT 200`, orgId),
      ]);
      // Clean seniority values — strip anything containing URLs or longer than 40 chars (corrupted data)
      const cleanSeniorities = seniorities
        .map((r: any) => r.seniority as string)
        .filter((s: string) => s && s.length <= 40 && !s.includes('http') && !s.includes('www.') && !s.includes(','));
      res.json({
        companies: companies.map((r: any) => r.company),
        designations: designations.map((r: any) => r.jobTitle),
        cities: cities.map((r: any) => r.city),
        countries: countries.map((r: any) => r.country),
        industries: industries.map((r: any) => r.industry),
        departments: departments.map((r: any) => r.department),
        seniorities: cleanSeniorities,
        tags: tagRows.map((r: any) => r.tag),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ===== DATA QUALITY =====

  // Preview how many contacts have data quality issues
  app.get('/api/contacts/data-quality-preview', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      // Count contacts with numeric-only industry (e.g. "100", "500")
      const numericIndustry = await storage.rawGet(`SELECT COUNT(*) as cnt FROM contacts WHERE "organizationId" = ? AND industry IS NOT NULL AND industry != '' AND industry ~ '^[0-9]+$'`, orgId) as any;
      // Count contacts with phone number in city field (starts with +, or all digits, or contains parentheses typical of phone)
      const phoneInCity = await storage.rawGet(`SELECT COUNT(*) as cnt FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city != '' AND (city ~ '^\+[0-9]' OR city ~ '^[0-9]{7,}' OR (city LIKE '(%' AND city LIKE '%)%'))`, orgId) as any;
      // Count contacts with comma in city (full address stored in city)
      const addressInCity = await storage.rawGet(`SELECT COUNT(*) as cnt FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city LIKE '%,%'`, orgId) as any;
      // Count contacts with URL in company name
      const urlInCompany = await storage.rawGet(`SELECT COUNT(*) as cnt FROM contacts WHERE "organizationId" = ? AND company IS NOT NULL AND (company LIKE '%http%' OR company LIKE '%www.%')`, orgId) as any;
      res.json({
        numericIndustry: parseInt(numericIndustry?.cnt || '0'),
        phoneInCity: parseInt(phoneInCity?.cnt || '0'),
        addressInCity: parseInt(addressInCity?.cnt || '0'),
        urlInCompany: parseInt(urlInCompany?.cnt || '0'),
        total: parseInt(numericIndustry?.cnt || '0') + parseInt(phoneInCity?.cnt || '0') + parseInt(addressInCity?.cnt || '0') + parseInt(urlInCompany?.cnt || '0'),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Apply rule-based data quality fixes
  app.post('/api/contacts/data-quality-fix', requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'owner' && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Admin only' });
      }
      const orgId = req.user.organizationId;
      const { fixTypes, useAI } = req.body as { fixTypes: string[]; useAI?: boolean };

      let fixed = { numericIndustry: 0, phoneInCity: 0, urlInCompany: 0, aiAddressInCity: 0 };

      // 1. Null out numeric-only industry values
      if (fixTypes.includes('numericIndustry')) {
        const r = await storage.rawRun(`UPDATE contacts SET industry = NULL WHERE "organizationId" = ? AND industry IS NOT NULL AND industry != '' AND industry ~ '^[0-9]+$'`, orgId);
        fixed.numericIndustry = (r as any)?.rowCount ?? 0;
      }

      // 2. Null out phone numbers stored in city
      if (fixTypes.includes('phoneInCity')) {
        const r = await storage.rawRun(`UPDATE contacts SET city = NULL WHERE "organizationId" = ? AND city IS NOT NULL AND city != '' AND (city ~ '^\+[0-9]' OR city ~ '^[0-9]{7,}' OR (city LIKE '(%' AND city LIKE '%)%'))`, orgId);
        fixed.phoneInCity = (r as any)?.rowCount ?? 0;
      }

      // 3. Null out URLs in company name
      if (fixTypes.includes('urlInCompany')) {
        const r = await storage.rawRun(`UPDATE contacts SET company = NULL WHERE "organizationId" = ? AND company IS NOT NULL AND (company LIKE '%http%' OR company LIKE '%www.%')`, orgId);
        fixed.urlInCompany = (r as any)?.rowCount ?? 0;
      }

      // 4. AI-assisted: parse "City, Country" → extract city using Azure OpenAI
      if (fixTypes.includes('addressInCity') && useAI) {
        try {
          const settings = await (storage as any).getApiSettingsWithAzureFallback(orgId);
          const endpoint = settings?.azure_openai_endpoint;
          const apiKey = settings?.azure_openai_api_key;
          const deployment = settings?.azure_openai_deployment;
          const apiVersion = settings?.azure_openai_api_version || '2024-02-01';
          if (endpoint && apiKey && deployment) {
            const rows = await storage.rawAll(`SELECT id, city FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city LIKE '%,%' LIMIT 500`, orgId) as any[];
            for (const row of rows) {
              try {
                const resp = await fetch(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
                  body: JSON.stringify({
                    messages: [
                      { role: 'system', content: 'Extract only the city name from the address string. Reply with ONLY the city name, nothing else. If you cannot determine the city, reply with UNKNOWN.' },
                      { role: 'user', content: row.city }
                    ],
                    max_tokens: 30, temperature: 0,
                  }),
                });
                if (resp.ok) {
                  const data = await resp.json() as any;
                  const city = data.choices?.[0]?.message?.content?.trim();
                  if (city && city !== 'UNKNOWN' && city.length < 60 && !city.includes(',')) {
                    await storage.rawRun(`UPDATE contacts SET city = ? WHERE id = ?`, city, row.id);
                    fixed.aiAddressInCity++;
                  }
                }
              } catch (_) { /* skip individual failures */ }
            }
          }
        } catch (e2: any) {
          console.warn('[DataQuality] AI city fix failed:', e2.message);
        }
      } else if (fixTypes.includes('addressInCity') && !useAI) {
        // Rule-based: take the part before the first comma as city
        const rows = await storage.rawAll(`SELECT id, city FROM contacts WHERE "organizationId" = ? AND city IS NOT NULL AND city LIKE '%,%' LIMIT 2000`, orgId) as any[];
        for (const row of rows) {
          const cityPart = row.city.split(',')[0].trim();
          if (cityPart && cityPart.length >= 2 && cityPart.length <= 60 && !/^\+/.test(cityPart)) {
            await storage.rawRun(`UPDATE contacts SET city = ? WHERE id = ?`, cityPart, row.id);
            fixed.aiAddressInCity++;
          }
        }
      }

      res.json({ success: true, fixed });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ===== PIPELINE & ACTIVITY LOG (must be BEFORE /api/contacts/:id) =====

  // Get today's follow-ups (contacts with nextActionDate = today or overdue)
  app.get('/api/contacts/follow-ups', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const today = new Date().toISOString().split('T')[0];
      const contacts = await storage.rawAll(`SELECT c.*,
        (SELECT ca.notes FROM contact_activities ca WHERE ca."contactId" = c.id ORDER BY ca."createdAt" DESC LIMIT 1) as lastRemark,
        (SELECT ca.type FROM contact_activities ca WHERE ca."contactId" = c.id ORDER BY ca."createdAt" DESC LIMIT 1) as lastActivityType,
        (SELECT ca."createdAt" FROM contact_activities ca WHERE ca."contactId" = c.id ORDER BY ca."createdAt" DESC LIMIT 1) as lastActivityDate,
        COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), u.email) as "assignedToName"
        FROM contacts c
        LEFT JOIN users u ON u.id = c."assignedTo"
        WHERE c."organizationId" = ? AND c."nextActionDate" IS NOT NULL AND c."nextActionDate" <= ?
        AND c."pipelineStage" NOT IN ('won', 'lost') AND c.status NOT IN ('bounced', 'unsubscribed')
        ORDER BY c."nextActionDate" ASC LIMIT 200`, orgId, today + 'T23:59:59');
      res.json(contacts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Get pipeline stats (count per stage)
  app.get('/api/contacts/pipeline-stats', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const stats = await storage.rawAll(`SELECT "pipelineStage", COUNT(*) as count FROM contacts WHERE "organizationId" = ? AND status NOT IN ('bounced', 'unsubscribed') GROUP BY "pipelineStage"`, orgId);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Update contact pipeline stage
  app.put('/api/contacts/:id/pipeline', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { pipelineStage, nextActionDate, nextActionType, dealValue, dealNotes } = req.body;
      const contact = await storage.rawGet(`SELECT id FROM contacts WHERE id = ? AND "organizationId" = ?`, req.params.id, orgId);
      if (!contact) return res.status(404).json({ message: 'Contact not found' });
      const updates: string[] = [];
      const values: any[] = [];
      if (pipelineStage) { updates.push('"pipelineStage" = ?'); values.push(pipelineStage); }
      if (nextActionDate !== undefined) { updates.push('"nextActionDate" = ?'); values.push(nextActionDate || null); }
      if (nextActionType !== undefined) { updates.push('"nextActionType" = ?'); values.push(nextActionType || null); }
      if (dealValue !== undefined) { updates.push('"dealValue" = ?'); values.push(dealValue || 0); }
      if (dealNotes !== undefined) { updates.push('"dealNotes" = ?'); values.push(dealNotes || ''); }
      // Auto-set dealClosedAt when stage changes to won/lost
      if (pipelineStage === 'won' || pipelineStage === 'lost') {
        updates.push('"dealClosedAt" = ?'); values.push(new Date().toISOString());
      } else if (pipelineStage && pipelineStage !== 'won' && pipelineStage !== 'lost') {
        // Clear dealClosedAt if moved back from won/lost
        updates.push('"dealClosedAt" = ?'); values.push(null);
      }
      updates.push('"updatedAt" = ?'); values.push(new Date().toISOString());
      values.push(req.params.id, orgId);
      await storage.rawRun(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ? AND "organizationId" = ?`, ...values);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Get activities for a contact
  app.get('/api/contacts/:id/activities', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const activities = await storage.rawAll(`SELECT ca.*, u."firstName" as "userFirstName", u."lastName" as "userLastName", u.email as "userEmail"
        FROM contact_activities ca LEFT JOIN users u ON ca."userId" = u.id
        WHERE ca."contactId" = ? AND ca."organizationId" = ? ORDER BY ca."createdAt" DESC LIMIT 100`, req.params.id, orgId);
      res.json(activities);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Log a new activity for a contact
  app.post('/api/contacts/:id/activities', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const { type, outcome, notes, nextActionDate, nextActionType } = req.body;
      if (!type) return res.status(400).json({ message: 'Activity type is required' });
      const contact = await storage.rawGet(`SELECT id, "pipelineStage" FROM contacts WHERE id = ? AND "organizationId" = ?`, req.params.id, orgId) as any;
      if (!contact) return res.status(404).json({ message: 'Contact not found' });
      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      await storage.rawRun(`INSERT INTO contact_activities (id, "contactId", "organizationId", "userId", type, outcome, notes, "nextActionDate", "nextActionType", metadata, "createdAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, req.params.id, orgId, userId, type, outcome || null, notes || null, nextActionDate || null, nextActionType || null, '{}', now);
      // Update contact's nextActionDate if provided
      if (nextActionDate) {
        await storage.rawRun(`UPDATE contacts SET "nextActionDate" = ?, "nextActionType" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, nextActionDate, nextActionType || null, now, req.params.id, orgId);
      }
      // Auto-advance pipeline stage (only forward, never backward)
      const autoStageMap: Record<string, string> = { call: 'contacted', email: 'contacted', whatsapp: 'contacted', meeting_scheduled: 'meeting_scheduled', meeting: 'meeting_done', proposal: 'proposal_sent' };
      const stageOrder = ['new', 'contacted', 'interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent', 'won', 'lost'];
      if (autoStageMap[type]) {
        const currentIdx = stageOrder.indexOf(contact.pipelineStage || 'new');
        const newIdx = stageOrder.indexOf(autoStageMap[type]);
        if (newIdx > currentIdx) {
          await storage.rawRun(`UPDATE contacts SET "pipelineStage" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, autoStageMap[type], now, req.params.id, orgId);
        }
      }
      if (outcome === 'converted') await storage.rawRun(`UPDATE contacts SET "pipelineStage" = 'won', "dealClosedAt" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, now, now, req.params.id, orgId);
      else if (outcome === 'rejected') await storage.rawRun(`UPDATE contacts SET "pipelineStage" = 'lost', "dealClosedAt" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, now, now, req.params.id, orgId);
      res.json({ id, success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ===== END PIPELINE & ACTIVITY LOG =====

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

      const uploaderName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email?.split('@')[0] || 'Unknown';
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';

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
          uploadedBy: req.user.id,
          uploadedByName: uploaderName,
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
        'lead status': '_leadStatusRaw', 'status': '_statusRaw', 'stage': 'pipelineStage', 'pipeline stage': 'pipelineStage', 'pipeline': 'pipelineStage',
        'lead score': 'score', 'score': 'score',
        'tags': 'tags', 'labels': 'tags',
        'lists': 'tags', 'list': 'tags', 'segments': 'tags', 'segment': 'tags',
        'keywords': 'tags', 'keyword': 'tags',
        'secondary email': 'secondaryEmail', 'secondary_email': 'secondaryEmail', 'alternate email': 'secondaryEmail', 'other email': 'secondaryEmail', 'personal email': 'secondaryEmail',
        'home phone': 'homePhone', 'home_phone': 'homePhone', 'personal phone': 'homePhone', 'home': 'homePhone',
        'other phone': 'mobilePhone', 'other_phone': 'mobilePhone',
        'sub department': 'department', 'sub-department': 'department', 'subdepartment': 'department',
        'work direction': 'department', 'work function': 'department',
        'source': '_source', 'lead source': '_source',
        'person linkedin': 'linkedinUrl',
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
          } else if (mappedField === '_statusRaw' || mappedField === '_leadStatusRaw') {
            const validStatuses = new Set(['cold','warm','hot','replied','bounced','unsubscribed']);
            const v = trimmedValue.toLowerCase();
            if (validStatuses.has(v)) {
              if (!contact.status) contact.status = v;
            } else {
              customFields[csvHeader] = trimmedValue;
            }
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
          status: contact.status || 'cold', pipelineStage: contact.pipelineStage || null, score: contact.score || 0,
          tags: contact.tags || [], source: contact.source || source || 'import',
          listId: targetListId,
          customFields: Object.keys(customFields).length > 0 ? customFields : {},
        };
      }).filter((c: any) => c.email && c.email.includes('@'));

      const results = await storage.createContactsBulk(contactsToCreate, targetListId);
      const imported = results.filter((r: any) => !r._skipped && !r._updated).length;
      const updated = results.filter((r: any) => r._updated).length;
      const skipped = results.filter((r: any) => r._skipped).length;

      // Auto-assign imported contacts to the uploader (members get their own data)
      if (imported > 0 && !isAdmin) {
        const newContactIds = results.filter((r: any) => !r._skipped && r.id).map((r: any) => r.id);
        if (newContactIds.length > 0) {
          await storage.assignContactsToUser(newContactIds, req.user.id, req.user.organizationId);
        }
      }

      // Update the contact list count — always recount from junction table for accuracy
      if (contactListRecord && targetListId) {
        try {
          const countRow = await storage.rawGet(
            `SELECT COUNT(*) as c FROM contact_list_members WHERE "listId" = $1`, targetListId
          ) as any;
          const junctionCount = parseInt(countRow?.c || '0');
          // Junction count should be >= imported+updated; if it looks wrong fall back to arithmetic
          const arithmeticCount = (existingListId ? (contactListRecord.contactCount || 0) : 0) + imported;
          await storage.updateContactList(targetListId, { contactCount: Math.max(junctionCount, arithmeticCount) });
        } catch {
          const existingCount = existingListId ? (contactListRecord.contactCount || 0) : 0;
          await storage.updateContactList(targetListId, { contactCount: existingCount + imported });
        }
      }

      const listDisplayName = contactListRecord?.name || null;

      const parts = [`${imported} new`];
      if (updated > 0) parts.push(`${updated} updated`);
      if (skipped > 0) parts.push(`${skipped} skipped (protected)`);
      const message = `Imported ${parts.join(', ')} contact${imported === 1 && updated === 0 ? '' : 's'}${listDisplayName ? ` to list "${listDisplayName}"` : ''}`;
      res.json({
        success: true,
        imported,
        updated,
        skipped,
        total: contactList.length,
        listId: targetListId,
        listName: listDisplayName,
        message,
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

      // Determine sending method: Gmail OAuth, Outlook OAuth (Graph), or SMTP
      const settings = await storage.getApiSettings(req.user.organizationId);
      const orgId = req.user.organizationId;
      const isGmail = account.provider === 'gmail';
      const isOutlook = account.provider === 'outlook' || account.provider === 'microsoft';
      const isOAuthAccount = account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN';
      let gmailAccessToken: string | null = null;
      let outlookAccessToken: string | null = null;

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
                await storage.setApiSetting(orgId, `${settingPrefix}_access_token`, gmailAccessToken!);
                if (tokenData.expires_in) {
                  await storage.setApiSetting(orgId, `${settingPrefix}_token_expiry`, String(Date.now() + tokenData.expires_in * 1000));
                }
              }
            } catch (e) { console.error('[QuickSend] Token refresh error:', e); }
          }
        }
      } else if (isOutlook && isOAuthAccount) {
        // Try per-sender tokens first, then org-level tokens
        outlookAccessToken = settings[`outlook_sender_${account.email}_access_token`] || settings.microsoft_access_token || null;
        const outlookRefreshToken = settings[`outlook_sender_${account.email}_refresh_token`] || settings.microsoft_refresh_token;
        const outlookTokenExpiry = settings[`outlook_sender_${account.email}_token_expiry`] || settings.microsoft_token_expiry;
        const expiry = parseInt(outlookTokenExpiry || '0');

        // Refresh token if expired or about to expire (5 min buffer)
        if (outlookRefreshToken && (!outlookAccessToken || Date.now() >= expiry - 300000)) {
          let msClientId = settings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
          let msClientSecret = settings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';
          // Fallback to superadmin org for credentials
          if (!msClientId || !msClientSecret) {
            try {
              const superAdminOrgId = await storage.getSuperAdminOrgId();
              if (superAdminOrgId && superAdminOrgId !== orgId) {
                const superSettings = await storage.getApiSettings(superAdminOrgId);
                if (superSettings.microsoft_oauth_client_id) {
                  msClientId = superSettings.microsoft_oauth_client_id;
                  msClientSecret = superSettings.microsoft_oauth_client_secret || '';
                }
              }
            } catch (e) { /* ignore */ }
          }
          if (msClientId && msClientSecret) {
            try {
              const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id: msClientId, client_secret: msClientSecret,
                  refresh_token: outlookRefreshToken, grant_type: 'refresh_token',
                  scope: 'openid profile email offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite',
                }),
              });
              if (tokenRes.ok) {
                const tokenData = await tokenRes.json() as any;
                if (tokenData.access_token) {
                  outlookAccessToken = tokenData.access_token;
                  const prefix = settings[`outlook_sender_${account.email}_access_token`] ? `outlook_sender_${account.email}_` : 'microsoft_';
                  await storage.setApiSetting(orgId, `${prefix}access_token`, outlookAccessToken!);
                  if (tokenData.refresh_token) await storage.setApiSetting(orgId, `${prefix}refresh_token`, tokenData.refresh_token);
                  if (tokenData.expires_in) await storage.setApiSetting(orgId, `${prefix}token_expiry`, String(Date.now() + tokenData.expires_in * 1000));
                }
              } else {
                console.error(`[QuickSend] Outlook token refresh failed: ${tokenRes.status}`);
              }
            } catch (e) { console.error('[QuickSend] Outlook token refresh error:', e); }
          }
        }
        console.log(`[QuickSend] Outlook OAuth for ${account.email}: token=${outlookAccessToken ? 'present' : 'missing'}`);
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
          } else if (isOutlook && isOAuthAccount && outlookAccessToken) {
            // Send via Microsoft Graph API
            const graphMsg: any = {
              subject: pSubject,
              body: { contentType: 'HTML', content: pContent },
              toRecipients: [{ emailAddress: { address: contact.email } }],
            };
            let graphRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
              method: 'POST',
              headers: { Authorization: `Bearer ${outlookAccessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: graphMsg, saveToSentItems: true }),
            });
            if (graphRes.ok) {
              results.push({ email: contact.email, success: true });
              sent++;
            } else {
              const errText = await graphRes.text();
              // If 401, try refreshing token once and retry
              if (graphRes.status === 401) {
                console.log(`[QuickSend] Outlook Graph 401 for ${contact.email}, attempting force refresh...`);
                try {
                  await storage.setApiSetting(orgId, `outlook_sender_${account.email}_token_expiry`, '0');
                } catch (e) { /* ignore */ }
                // Re-fetch settings and try refresh
                const refreshedSettings = await storage.getApiSettings(orgId);
                const rToken = refreshedSettings[`outlook_sender_${account.email}_refresh_token`] || refreshedSettings.microsoft_refresh_token;
                let msClientId = refreshedSettings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
                let msClientSecret = refreshedSettings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';
                if (!msClientId || !msClientSecret) {
                  try {
                    const superOrgId = await storage.getSuperAdminOrgId();
                    if (superOrgId && superOrgId !== orgId) {
                      const ss = await storage.getApiSettings(superOrgId);
                      if (ss.microsoft_oauth_client_id) { msClientId = ss.microsoft_oauth_client_id; msClientSecret = ss.microsoft_oauth_client_secret || ''; }
                    }
                  } catch (e) { /* ignore */ }
                }
                if (rToken && msClientId && msClientSecret) {
                  try {
                    const tRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: new URLSearchParams({ client_id: msClientId, client_secret: msClientSecret, refresh_token: rToken, grant_type: 'refresh_token', scope: 'openid profile email offline_access https://graph.microsoft.com/Mail.Send' }),
                    });
                    if (tRes.ok) {
                      const td = await tRes.json() as any;
                      if (td.access_token) {
                        outlookAccessToken = td.access_token;
                        await storage.setApiSetting(orgId, `outlook_sender_${account.email}_access_token`, td.access_token);
                        if (td.expires_in) await storage.setApiSetting(orgId, `outlook_sender_${account.email}_token_expiry`, String(Date.now() + td.expires_in * 1000));
                        // Retry send
                        graphRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${outlookAccessToken}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ message: graphMsg, saveToSentItems: true }),
                        });
                        if (graphRes.ok) {
                          results.push({ email: contact.email, success: true });
                          sent++;
                          continue;
                        }
                      }
                    }
                  } catch (e) { console.error(`[QuickSend] Outlook token retry failed:`, e); }
                }
              }
              results.push({ email: contact.email, success: false, error: `Graph API error (${graphRes.status}): ${errText.slice(0, 200)}` });
              failed++;
              console.error(`[QuickSend] Outlook Graph error for ${contact.email}:`, errText.slice(0, 200));
            }
          } else if (account.smtpConfig && !isOAuthAccount) {
            // Send via SMTP (only for non-OAuth accounts with real SMTP credentials)
            const result = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
              to: contact.email, subject: pSubject, html: pContent,
            });
            if (result.success) { sent++; } else { failed++; }
            results.push({ email: contact.email, ...result });
          } else {
            results.push({ email: contact.email, success: false, error: isOAuthAccount ? `OAuth token not found for ${account.email}. Please re-authenticate in Account Settings.` : 'No sending method configured' });
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
      const body = { ...req.body };
      if (body.status !== undefined) {
        const validStatuses = new Set(['cold','warm','hot','replied','bounced','unsubscribed']);
        const v = String(body.status).toLowerCase();
        if (!validStatuses.has(v)) delete body.status;
        else body.status = v;
      }
      const updated = await storage.updateContact(req.params.id, body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update contact' });
    }
  });

  // Mark a contact as bounced (adds to blocklist)
  app.post('/api/contacts/mark-bounced', async (req: any, res) => {
    try {
      const { email, contactId, reason } = req.body;
      
      if (contactId) {
        // Mark specific contact as bounced
        await storage.updateContact(contactId, { status: 'bounced' });
        res.json({ success: true, message: `Contact marked as bounced` });
      } else if (email) {
        // Find contact by email and mark as bounced
        const contacts = await storage.getContacts(req.user.organizationId, 100000, 0);
        const match = contacts.find((c: any) => c.email && c.email.toLowerCase() === email.toLowerCase());
        if (match) {
          await storage.updateContact(match.id, { status: 'bounced' });
          res.json({ success: true, message: `Contact ${email} marked as bounced`, contactId: match.id });
        } else {
          res.status(404).json({ success: false, message: `Contact with email ${email} not found` });
        }
      } else {
        res.status(400).json({ success: false, message: 'Provide either contactId or email' });
      }
    } catch (error) {
      console.error('[Contacts] Mark bounced error:', error);
      res.status(500).json({ message: 'Failed to mark contact as bounced' });
    }
  });

  // Sync bounce status: find all campaign messages marked as failed/bounced
  // and ensure the corresponding contacts are also marked as bounced
  app.post('/api/contacts/sync-bounces', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const failedMessages = await storage.getBouncedMessagesWithContacts(orgId);
      const bounceEvents = await storage.getBounceEventsWithContacts(orgId);

      let fixed = 0;
      const seen = new Set<string>();

      for (const msg of failedMessages as any[]) {
        if (!msg.contactId || seen.has(msg.contactId)) continue;
        seen.add(msg.contactId);
        if (msg.contactStatus && msg.contactStatus !== 'bounced') {
          try {
            await storage.updateContact(msg.contactId, { status: 'bounced' });
            console.log(`[BounceSync] Fixed contact ${msg.contactEmail} (${msg.contactId}): ${msg.contactStatus} -> bounced`);
            fixed++;
          } catch (e) {
            console.error(`[BounceSync] Failed to update contact ${msg.contactId}:`, e);
          }
        }
      }

      for (const evt of bounceEvents as any[]) {
        if (!evt.contactId || seen.has(evt.contactId)) continue;
        seen.add(evt.contactId);
        if (evt.contactStatus && evt.contactStatus !== 'bounced') {
          try {
            await storage.updateContact(evt.contactId, { status: 'bounced' });
            console.log(`[BounceSync] Fixed contact ${evt.contactEmail} (${evt.contactId}) from tracking event`);
            fixed++;
          } catch (e) {
            console.error(`[BounceSync] Failed to update contact ${evt.contactId}:`, e);
          }
        }
      }

      res.json({
        success: true,
        totalFailed: (failedMessages as any[]).length,
        totalBounceEvents: (bounceEvents as any[]).length,
        contactsFixed: fixed,
      });
    } catch (error) {
      console.error('[Contacts] Sync bounces error:', error);
      res.status(500).json({ message: 'Failed to sync bounce status' });
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

  // Unbounce contacts: reset selected contacts from 'bounced' back to 'cold'
  app.post('/api/contacts/unbounce', async (req: any, res) => {
    try {
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: 'contactIds array required' });
      }
      let updated = 0;
      for (const id of contactIds) {
        try {
          const contact = await storage.getContact(id);
          if (contact && contact.status === 'bounced') {
            await storage.updateContact(id, { status: 'cold' });
            updated++;
          }
        } catch (e) { /* skip individual errors */ }
      }
      res.json({ success: true, updated, total: contactIds.length });
    } catch (error) {
      res.status(500).json({ message: 'Failed to unbounce contacts' });
    }
  });

  // Analyze bounced contacts: separate real bounces from false positives (infrastructure failures)
  // Analyze bounced contacts: separate real bounces from false positives
  // CONSERVATIVE: only marks as "false bounce" if there is a clear infrastructure error message.
  // No error message = treat as real bounce (could be from webhook/external tracking).
  app.get('/api/contacts/bounce-analysis', async (req: any, res) => {
    try {
      const allContacts = await storage.getContacts(req.user.organizationId, 100000, 0);
      const bouncedContacts = allContacts.filter((c: any) => c.status === 'bounced');

      // Infrastructure error patterns — these are NOT real bounces
      const infraPatterns = ['oauth', 'token', 're-authenticate', '401', '403', 'smtp auth',
        'credentials', 'graph api error', 'api error', 'connection refused', 'getaddrinfo',
        'timeout', 'invalidauthenticationtoken', 'econnrefused', 'socket hang up',
        'please re-authenticate', 'token expired'];

      const realBounces: any[] = [];
      const falseBounces: any[] = [];

      for (const contact of bouncedContacts) {
        const messages = await storage.getFailedMessagesByContact(contact.id, 5);
        const errors = messages.map((m: any) => m.errorMessage || '').filter(Boolean);
        const lastError = errors[0] || '';
        const errorLower = lastError.toLowerCase();

        // CONSERVATIVE: Only flag as false bounce if we have a CLEAR infrastructure error.
        // No error messages = assume real bounce (from webhook, external tracking, etc.)
        const isInfraFailure = errors.length > 0 && infraPatterns.some(p => errorLower.includes(p));

        const entry = {
          id: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          lastError: lastError.slice(0, 200),
          failedMessageCount: errors.length,
        };

        if (isInfraFailure) {
          falseBounces.push({ ...entry, reason: 'infrastructure failure' });
        } else {
          realBounces.push({ ...entry, reason: errors.length === 0 ? 'no error recorded (assumed real bounce)' : 'real delivery failure' });
        }
      }

      res.json({
        totalBounced: bouncedContacts.length,
        realBounces: { count: realBounces.length, contacts: realBounces },
        falseBounces: { count: falseBounces.length, contacts: falseBounces },
      });
    } catch (error) {
      console.error('Bounce analysis error:', error);
      res.status(500).json({ message: 'Failed to analyze bounces' });
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

  // Assign entire contact list to a team member (admin/owner only)
  app.post('/api/contact-lists/:id/assign', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Only admins can assign leads' });
      
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: 'userId is required' });
      
      // Verify the target user is a member of this org
      const membership = await storage.getOrgMember(req.user.organizationId, userId);
      if (!membership) return res.status(400).json({ message: 'Target user is not a member of this organization' });

      const targetUser = await storage.getUser(userId);
      const memberName = targetUser
        ? (`${(targetUser as any).firstName || ''} ${(targetUser as any).lastName || ''}`.trim() || (targetUser as any).email || '')
        : '';
      const count = await storage.assignContactsByList(req.params.id, userId, req.user.organizationId, memberName);
      res.json({ success: true, assigned: count });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign list contacts' });
    }
  });
  
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
  app.post('/api/contacts/:id/rating', requireAuth, async (req: any, res) => {
    try {
      console.log('[Rating] Single rating for contact:', req.params.id, 'useAI:', req.body?.useAI);
      const { useAI } = req.body || {};
      const result = await calculateContactRating(req.params.id, {
        useAI: useAI !== false,
        organizationId: req.user.organizationId,
      });
      console.log('[Rating] Done:', result.rating, result.grade);
      res.json(result);
    } catch (error: any) {
      console.error('[Rating] FAILED for', req.params.id, ':', error.message, error.stack?.substring(0, 500));
      res.status(500).json({ message: `Failed to calculate rating: ${error.message}` });
    }
  });

  // Get engagement stats for a contact (without recalculating)
  app.get('/api/contacts/:id/engagement', requireAuth, async (req: any, res) => {
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

  // Batch recalculate ratings for all contacts (fire-and-forget to avoid timeout)
  app.post('/api/contacts/batch-rating', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { useAI } = req.body || {};
      console.log('[BatchRating] Starting for org:', orgId, 'useAI:', useAI);

      // Get contact count first for the response
      const countRow = await storage.rawGet('SELECT COUNT(*) as cnt FROM contacts WHERE "organizationId" = ?', orgId) as any;
      const totalContacts = parseInt(countRow?.cnt || '0');
      console.log('[BatchRating] Total contacts in org:', totalContacts);

      // Respond immediately
      res.json({ success: true, message: `Rating ${totalContacts} contacts in background`, total: totalContacts, processed: 0, errors: 0, background: true });

      // Process in background with error catching
      setImmediate(() => {
        batchRecalculateRatings(orgId, { useAI }).then(result => {
          console.log('[BatchRating] Background DONE:', JSON.stringify(result));
        }).catch(err => {
          console.error('[BatchRating] Background FAILED:', err.message, err.stack?.substring(0, 300));
        });
      });
    } catch (error: any) {
      console.error('[BatchRating] FAILED:', error.message, error.stack?.substring(0, 500));
      res.status(500).json({ message: `Failed to start batch rating: ${error.message}` });
    }
  });

  // Check rating status for a contact (diagnostic)
  app.get('/api/contacts/:id/rating-check', requireAuth, async (req: any, res) => {
    try {
      const cid = req.params.id;
      console.log('[RatingCheck] Checking contact:', cid);
      const row = await storage.rawGet('SELECT id, email, "emailRating", "emailRatingGrade", "emailRatingUpdatedAt" FROM contacts WHERE id = ?', cid) as any;
      console.log('[RatingCheck] Contact row:', row ? `${row.id} / ${row.email}` : 'NULL');
      const stats = await storage.getContactEngagementStats(cid);
      console.log('[RatingCheck] Stats:', JSON.stringify(stats));
      // Also check messages directly
      const msgById = await storage.rawGet('SELECT COUNT(*) as cnt FROM messages WHERE "contactId" = ?', cid) as any;
      // Check total messages in system
      const totalMsgs = await storage.rawGet('SELECT COUNT(*) as cnt FROM messages') as any;
      // Check messages by recipientEmail
      let msgsByEmail = 0;
      if (row?.email) {
        const emailMatch = await storage.rawGet('SELECT COUNT(*) as cnt FROM messages WHERE LOWER("recipientEmail") = LOWER(?)', row.email) as any;
        msgsByEmail = parseInt(emailMatch?.cnt || 0);
      }
      // Check backfill status
      const backfillStatus = await storage.rawGet('SELECT COUNT(*) as total, SUM(CASE WHEN "recipientEmail" IS NOT NULL THEN 1 ELSE 0 END) as filled FROM messages') as any;
      // If no contact found, check first few contact IDs to see format
      let sampleIds = null;
      if (!row) {
        const samples = await storage.rawAll('SELECT id, email FROM contacts LIMIT 3') as any[];
        sampleIds = samples?.map((s: any) => ({ id: s.id, email: s.email }));
      }
      // Show which org's messages exist and sample recipientEmails
      const orgId = req.user?.organizationId;
      const orgMsgs = await storage.rawGet('SELECT COUNT(*) as cnt FROM messages m JOIN campaigns c ON m."campaignId" = c.id WHERE c."organizationId" = ?', orgId) as any;
      // Sample recipientEmails from this org's campaigns
      const sampleEmails = await storage.rawAll(`
        SELECT DISTINCT m."recipientEmail" FROM messages m
        JOIN campaigns c ON m."campaignId" = c.id
        WHERE c."organizationId" = ? AND m."recipientEmail" IS NOT NULL
        LIMIT 10
      `, orgId) as any[];
      // Find contacts in this list that DO have messages
      const contactsWithMessages = await storage.rawAll(`
        SELECT m."recipientEmail", COUNT(*)::int as "msgCount"
        FROM messages m
        JOIN campaigns c ON m."campaignId" = c.id
        WHERE c."organizationId" = ? AND m."recipientEmail" IS NOT NULL
        GROUP BY m."recipientEmail"
        ORDER BY COUNT(*) DESC LIMIT 5
      `, orgId) as any[];
      // Find a contact in current org that matches a recipient email (to prove rating works)
      let proofContact = null;
      if (contactsWithMessages?.length > 0) {
        const topEmail = contactsWithMessages[0].recipientEmail;
        proofContact = await storage.rawGet(`
          SELECT id, email, "firstName", "lastName", "emailRating", "emailRatingGrade"
          FROM contacts WHERE LOWER(email) = LOWER(?) AND "organizationId" = ? LIMIT 1
        `, topEmail, orgId) as any;
      }
      res.json({
        queriedId: cid,
        contact: row,
        stats,
        messagesByContactId: parseInt(msgById?.cnt || 0),
        messagesByRecipientEmail: msgsByEmail,
        totalMessagesInDB: parseInt(totalMsgs?.cnt || 0),
        messagesInOrg: parseInt(orgMsgs?.cnt || 0),
        sampleRecipientsInOrg: sampleEmails?.map((s: any) => s.recipientEmail),
        topContactsWithMessages: contactsWithMessages?.map((s: any) => ({ email: s.recipientEmail, count: parseInt(s.msgCount || '0') })),
        proofContact: proofContact ? { id: proofContact.id, email: proofContact.email, name: `${proofContact.firstName || ''} ${proofContact.lastName || ''}`.trim(), rating: proofContact.emailRating, grade: proofContact.emailRatingGrade } : null,
        sampleContactIds: sampleIds,
      });
    } catch (error: any) {
      console.error('[RatingCheck] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });



  // ========== THREADING DIAGNOSTIC ==========
  app.get('/api/campaigns/:id/threading-check', requireAuth, async (req: any, res) => {
    try {
      const campaignId = req.params.id;
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      let accountInfo: any = null;
      if (campaign.emailAccountId) {
        const acct = await storage.getEmailAccount(campaign.emailAccountId);
        accountInfo = { id: acct?.id, email: acct?.email, provider: (acct as any)?.provider };
      }

      const step0Messages = await storage.rawAll(
        'SELECT id, "contactId", subject, "stepNumber", "providerMessageId", "gmailThreadId", "messageId", "emailAccountId", status, "sentAt" FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) ORDER BY "sentAt" DESC LIMIT 20',
        campaignId
      );

      const followupMessages = await storage.rawAll(
        'SELECT id, "contactId", subject, "stepNumber", "providerMessageId", "gmailThreadId", "messageId", "emailAccountId", status, "sentAt" FROM messages WHERE "campaignId" = ? AND "stepNumber" > 0 ORDER BY "stepNumber", "sentAt" DESC LIMIT 40',
        campaignId
      );

      const totalStep0 = await storage.rawGet(
        'SELECT COUNT(*)::int as cnt FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL)', campaignId
      );
      const step0WithThread = await storage.rawGet(
        'SELECT COUNT(*)::int as cnt FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) AND "gmailThreadId" IS NOT NULL', campaignId
      );
      const step0WithProvider = await storage.rawGet(
        'SELECT COUNT(*)::int as cnt FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) AND "providerMessageId" IS NOT NULL', campaignId
      );
      const step0WithRfcMessageId = await storage.rawGet(
        'SELECT COUNT(*)::int as cnt FROM messages WHERE "campaignId" = ? AND ("stepNumber" = 0 OR "stepNumber" IS NULL) AND "messageId" IS NOT NULL', campaignId
      );
      const totalFollowups = await storage.rawGet(
        'SELECT COUNT(*)::int as cnt FROM messages WHERE "campaignId" = ? AND "stepNumber" > 0', campaignId
      );

      const executions = await storage.rawAll(
        'SELECT * FROM followup_executions WHERE "campaignId" = ? ORDER BY "scheduledAt" DESC LIMIT 20',
        campaignId
      );

      res.json({
        campaign: { id: campaign.id, name: campaign.name, subject: campaign.subject, status: campaign.status },
        emailAccount: accountInfo,
        threading: {
          totalStep0: (totalStep0 as any)?.cnt || 0,
          step0WithGmailThreadId: (step0WithThread as any)?.cnt || 0,
          step0WithProviderMessageId: (step0WithProvider as any)?.cnt || 0,
          step0WithRfcMessageId: (step0WithRfcMessageId as any)?.cnt || 0,
          totalFollowupMessages: (totalFollowups as any)?.cnt || 0,
          // Healthy if every step-0 has either a Gmail threadId (Gmail) or an RFC messageId (Outlook)
          threadingHealthy: (((step0WithThread as any)?.cnt || 0) + ((step0WithRfcMessageId as any)?.cnt || 0)) >= ((totalStep0 as any)?.cnt || 0),
        },
        step0Messages,
        followupMessages,
        recentExecutions: executions,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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

    // Batch-load all unique creators in ONE query instead of N+1
    const creatorIds = [...new Set(templates.map(t => t.createdBy).filter(Boolean))];
    const creatorMap: Record<string, any> = {};
    for (const cid of creatorIds) {
      try {
        const user = await storage.getUser(cid);
        if (user) {
          creatorMap[cid] = {
            id: user.id,
            email: user.email,
            firstName: (user as any).firstName || '',
            lastName: (user as any).lastName || '',
            name: (user as any).name || (user as any).firstName || user.email?.split('@')[0] || 'Unknown',
          };
        }
      } catch (e) { /* ignore */ }
    }

    return templates.map((t: any) => {
      const creator = t.createdBy ? (creatorMap[t.createdBy] || null) : null;

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
    });
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
  // Members only see public templates; owners/admins see all team templates
  app.get('/api/templates/team', async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      const templates = isAdmin
        ? await storage.getEmailTemplatesExcludingUser(req.user.organizationId, req.user.id)
        : await storage.getPublicEmailTemplatesExcludingUser(req.user.organizationId, req.user.id);
      const enriched = await enrichTemplatesWithScores(templates, req.user.organizationId, storage);
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch team templates' });
    }
  });

  // ===== DELIVERABILITY ANALYSIS =====
  // Analyzes email template subject + content for spam triggers, deliverability issues,
  // and provides AI-powered suggestions to improve inbox placement.
  app.post('/api/templates/analyze-deliverability', async (req: any, res) => {
    try {
      const { subject, content } = req.body;
      if (!subject && !content) return res.status(400).json({ message: 'Subject or content required' });

      const subjectLower = (subject || '').toLowerCase();
      const contentLower = (content || '').toLowerCase();
      const combined = subjectLower + ' ' + contentLower;

      // Strip HTML tags for text analysis
      const textOnly = (content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const textLower = textOnly.toLowerCase();

      const issues: { severity: 'critical' | 'warning' | 'info'; category: string; message: string; fix?: string }[] = [];
      let score = 100;

      // ===== 1. SPAM TRIGGER WORDS =====
      const spamTriggers: { words: string[]; severity: 'critical' | 'warning'; penalty: number }[] = [
        { words: ['free', 'act now', 'limited time', 'urgent', 'buy now', 'order now', 'click here', 'no obligation', 'risk free', 'guaranteed'], severity: 'warning', penalty: 3 },
        { words: ['winner', 'congratulations', 'you have been selected', 'million dollars', 'earn money', 'make money', 'cash bonus', 'double your income'], severity: 'critical', penalty: 8 },
        { words: ['100% free', 'no cost', 'no credit card', 'no purchase necessary', 'apply now', 'offer expires', 'once in a lifetime', 'special promotion'], severity: 'warning', penalty: 4 },
        { words: ['viagra', 'pharmacy', 'weight loss', 'enlargement', 'casino'], severity: 'critical', penalty: 20 },
      ];

      const foundSpamWords: string[] = [];
      for (const group of spamTriggers) {
        for (const word of group.words) {
          if (combined.includes(word)) {
            foundSpamWords.push(word);
            score -= group.penalty;
            issues.push({
              severity: group.severity,
              category: 'Spam Words',
              message: `Contains spam trigger word: "${word}"`,
              fix: `Remove or rephrase "${word}" — spam filters flag this`,
            });
          }
        }
      }

      // ===== 2. SUBJECT LINE ANALYSIS =====
      if (subject) {
        if (subject.length > 60) {
          score -= 5;
          issues.push({ severity: 'warning', category: 'Subject Line', message: `Subject is ${subject.length} chars (recommended: under 60)`, fix: 'Shorten subject — long subjects get clipped on mobile' });
        }
        if (/^[A-Z\s!]+$/.test(subject) || subject === subject.toUpperCase()) {
          score -= 10;
          issues.push({ severity: 'critical', category: 'Subject Line', message: 'Subject is ALL CAPS', fix: 'Use normal capitalization — ALL CAPS triggers spam filters' });
        }
        if ((subject.match(/!/g) || []).length > 1) {
          score -= 5;
          issues.push({ severity: 'warning', category: 'Subject Line', message: 'Multiple exclamation marks in subject', fix: 'Use at most one exclamation mark' });
        }
        if ((subject.match(/\?/g) || []).length > 2) {
          score -= 3;
          issues.push({ severity: 'info', category: 'Subject Line', message: 'Multiple question marks in subject', fix: 'Reduce question marks for a cleaner subject' });
        }
        if (/\$\d|₹|€/.test(subject)) {
          score -= 5;
          issues.push({ severity: 'warning', category: 'Subject Line', message: 'Currency symbols in subject line', fix: 'Move pricing to the email body — currency in subject triggers filters' });
        }
        if (!subject.includes('{{')) {
          issues.push({ severity: 'info', category: 'Subject Line', message: 'No personalization in subject', fix: 'Add {{firstName}} or {{company}} — personalized subjects get 26% higher open rates' });
        }
      }

      // ===== 3. CONTENT ANALYSIS =====
      const htmlContent = content || '';
      const linkCount = (htmlContent.match(/<a\s/gi) || []).length;
      const imageCount = (htmlContent.match(/<img\s/gi) || []).length;
      const wordCount = textOnly.split(/\s+/).filter(Boolean).length;

      // Text to link ratio
      if (linkCount > 0 && wordCount < linkCount * 20) {
        score -= 8;
        issues.push({ severity: 'warning', category: 'Content', message: `Too many links relative to text (${linkCount} links, ${wordCount} words)`, fix: 'Add more text content — aim for at least 20 words per link' });
      }
      if (linkCount > 5) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Content', message: `${linkCount} links in email`, fix: 'Reduce to 2-3 links maximum — too many links look spammy' });
      }

      // Image to text ratio
      if (imageCount > 0 && wordCount < 50) {
        score -= 10;
        issues.push({ severity: 'critical', category: 'Content', message: 'Image-heavy email with little text', fix: 'Add at least 50 words of text — image-only emails often go to spam' });
      }
      if (imageCount > 3) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Content', message: `${imageCount} images in email`, fix: 'Reduce images — some email clients block images by default' });
      }

      // Short email
      if (wordCount < 20 && wordCount > 0) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Content', message: `Very short email (${wordCount} words)`, fix: 'Emails under 20 words may look auto-generated to spam filters' });
      }

      // Very long email
      if (wordCount > 500) {
        issues.push({ severity: 'info', category: 'Content', message: `Long email (${wordCount} words)`, fix: 'Consider shortening — emails between 50-200 words get the best engagement' });
      }

      // ALL CAPS in content
      const capsWords = textOnly.split(/\s+/).filter(w => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
      if (capsWords.length > 3) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Content', message: `${capsWords.length} ALL CAPS words in content`, fix: 'Reduce caps — excessive caps triggers spam filters' });
      }

      // ===== 4. PERSONALIZATION CHECK =====
      const variables = (combined.match(/\{\{(\w+)\}\}/g) || []);
      if (variables.length === 0) {
        score -= 5;
        issues.push({ severity: 'warning', category: 'Personalization', message: 'No personalization variables used', fix: 'Add {{firstName}}, {{company}}, etc. — personalized emails have 2x higher reply rates' });
      } else if (variables.length >= 2) {
        issues.push({ severity: 'info', category: 'Personalization', message: `Good: using ${variables.length} personalization variables`, fix: undefined });
      }

      // ===== 5. HTML QUALITY =====
      if (htmlContent.includes('<style') || htmlContent.includes('<link')) {
        issues.push({ severity: 'info', category: 'HTML', message: 'External/embedded stylesheets detected', fix: 'Use inline styles — many email clients strip <style> tags' });
      }
      if (htmlContent.includes('javascript:') || htmlContent.includes('<script')) {
        score -= 15;
        issues.push({ severity: 'critical', category: 'HTML', message: 'JavaScript detected in email', fix: 'Remove all JavaScript — it\'s blocked by email clients and triggers spam filters' });
      }
      if (htmlContent.includes('display:none') || htmlContent.includes('visibility:hidden')) {
        score -= 10;
        issues.push({ severity: 'critical', category: 'HTML', message: 'Hidden content detected', fix: 'Remove hidden elements — spam filters treat these as deceptive' });
      }

      // ===== 6. UNSUBSCRIBE =====
      if (!combined.includes('unsubscribe')) {
        issues.push({ severity: 'info', category: 'Compliance', message: 'No unsubscribe mention', fix: 'Enable the unsubscribe link when sending — required by CAN-SPAM and improves deliverability' });
      }

      // Clamp score
      score = Math.max(0, Math.min(100, score));
      const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';

      // ===== AI-POWERED SUGGESTIONS (if Azure OpenAI configured) =====
      let aiSuggestions: string[] = [];
      try {
        const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
        const endpoint = settings.azure_openai_endpoint;
        const apiKey = settings.azure_openai_api_key;
        const deploymentName = settings.azure_openai_deployment;
        const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

        if (endpoint && apiKey && deploymentName) {
          const aiPrompt = `You are an email deliverability expert. Analyze this email and give 3-5 short, actionable suggestions to improve inbox placement and avoid spam filters. Focus on practical improvements only.

Subject: ${subject || '(empty)'}
Content (text): ${textOnly.slice(0, 1000)}

Current issues found: ${issues.length > 0 ? issues.map(i => i.message).join('; ') : 'None'}
Word count: ${wordCount}, Links: ${linkCount}, Images: ${imageCount}

Return ONLY a JSON array of strings, each 1-2 sentences. Example: ["Add a personalized greeting with the recipient's name", "Shorten the subject to under 50 characters"]`;

          const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
          const aiResp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: 'You are an email deliverability expert. Respond only with a valid JSON array of strings.' },
                { role: 'user', content: aiPrompt },
              ],
              temperature: 0.3,
              max_tokens: 500,
            }),
          });

          if (aiResp.ok) {
            const aiData = await aiResp.json() as any;
            const raw = aiData.choices?.[0]?.message?.content || '';
            try {
              const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
              if (Array.isArray(parsed)) aiSuggestions = parsed.slice(0, 5);
            } catch { /* AI returned non-JSON, skip */ }
          }
        }
      } catch { /* AI not available, that's fine */ }

      res.json({
        score,
        grade,
        wordCount,
        linkCount,
        imageCount,
        personalizationCount: variables.length,
        spamWordsFound: foundSpamWords,
        issues,
        aiSuggestions,
      });
    } catch (error) {
      console.error('Deliverability analysis error:', error);
      res.status(500).json({ message: 'Failed to analyze deliverability' });
    }
  });

  // KB validation: check email template against the org's Knowledge Base for factual correctness
  // Pulls top 2 most relevant org_documents via FTS and asks Azure OpenAI to flag contradictions or missing key points.
  // Skips entirely if no matching KB doc exists — saves tokens and avoids irrelevant validation.
  app.post('/api/templates/validate-kb', requireAuth, async (req: any, res) => {
    try {
      const { subject, content } = req.body;
      if (!subject && !content) return res.status(400).json({ message: 'Subject or content required' });

      const orgId = req.user.organizationId;

      // Strip HTML for plain-text body used in retrieval and the LLM prompt
      const textOnly = (content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

      // Build retrieval query from subject + full body. getRelevantDocuments handles
      // multi-tier fallback (full query → first sentence → acronyms/proper nouns) — its
      // distinctive-token tier needs the full body text to spot acronyms like "AGBA"
      // that often appear several lines into the email, not just in the first 150 chars.
      const query = `${subject || ''} ${textOnly}`.trim();
      if (!query) return res.status(400).json({ message: 'Empty query — provide subject or content' });

      const { getRelevantDocuments } = await import('./services/context-engine.js');
      const kbDocs = await getRelevantDocuments(orgId, query, undefined, 2);

      // Gate: no matching KB doc → skip validation entirely
      if (!kbDocs || kbDocs.length === 0) {
        console.log('[validate-kb]', JSON.stringify({ orgId, kbDocsCount: 0, skipped: true, bodyChars: textOnly.length, ai_called: false }));
        return res.json({
          factualIssues: [],
          missingKeyPoints: [],
          suggestions: [],
          kbDocsUsed: [],
          skipped: true,
          skipReason: 'No matching Knowledge Base document for this email\'s topic. Upload a relevant doc to enable KB validation.',
        });
      }

      // Read Azure OpenAI settings (same pattern as analyze-deliverability)
      const settings = await storage.getApiSettingsWithAzureFallback(orgId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.status(503).json({ message: 'Azure OpenAI not configured. Add credentials in Settings.' });
      }

      // Truncate each doc to ~2000 chars to keep tokens bounded
      const kbContext = kbDocs.map((d: any, i: number) => {
        const docContent = (d.content || '').slice(0, 2000);
        return `[DOC ${i + 1}: ${d.name || 'Untitled'}]\n${docContent}`;
      }).join('\n\n---\n\n');

      // Body truncation: capture intro + CTA/signature (head + tail) instead of blind front-load
      const bodyForPrompt = textOnly.length <= 3000
        ? textOnly
        : textOnly.slice(0, 1500) + '\n...[middle truncated]...\n' + textOnly.slice(-1500);

      const validationPrompt = `You validate a B2B email template against the organization's Knowledge Base. The KB documents below are AUTHORITATIVE — they reflect the org's verified facts. Flag any direct contradictions in the email and identify important key points from the KB that are missing.

KB DOCUMENTS (authoritative source of truth):
${kbContext}

EMAIL SUBJECT: ${subject || '(empty)'}
EMAIL BODY (plain text): ${bodyForPrompt}

RULES:
- Only flag DIRECT factual contradictions (wrong number, date, name, edition, location, price, claim) — NOT stylistic or phrasing differences.
- "high" severity = clear factual error that will damage credibility (e.g. wrong edition number, wrong date)
- "medium" severity = stale/ambiguous claim that may mislead
- "low" severity = minor inconsistency
- For missingKeyPoints, only suggest things that materially improve credibility or completeness — NOT every detail in the KB.
- Keep all text concise. Each issue/point/suggestion should be 1-2 sentences.
- Empty arrays if everything is consistent.
- Return ONLY valid JSON. No markdown fences, no commentary.

Output schema:
{
  "factualIssues": [{ "claim": "what the email says", "kbReference": "what the KB says", "severity": "high|medium|low" }],
  "missingKeyPoints": [{ "point": "key point missing", "kbSource": "which doc supports it" }],
  "suggestions": ["short actionable improvement"]
}`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const aiResp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You validate B2B emails against an organization knowledge base. Output ONLY valid JSON matching the schema given. No markdown, no commentary.' },
            { role: 'user', content: validationPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1200,
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text().catch(() => '');
        console.error('[validate-kb] Azure OpenAI error:', aiResp.status, errText.slice(0, 200));
        return res.status(502).json({ message: 'KB validation service temporarily unavailable. Try again.' });
      }

      const aiData = await aiResp.json() as any;
      const raw = aiData.choices?.[0]?.message?.content || '';

      let parsed: any = null;
      try {
        parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
      } catch {
        console.error('[validate-kb] AI returned non-JSON:', raw.slice(0, 200));
        return res.status(502).json({ message: 'KB validation returned malformed response. Try again.' });
      }

      const factualIssues = Array.isArray(parsed?.factualIssues) ? parsed.factualIssues.slice(0, 10) : [];
      const missingKeyPoints = Array.isArray(parsed?.missingKeyPoints) ? parsed.missingKeyPoints.slice(0, 10) : [];
      const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions.slice(0, 5) : [];

      const usage = aiData?.usage || {};
      console.log('[validate-kb]', JSON.stringify({
        orgId,
        kbDocsCount: kbDocs.length,
        kbDocNames: kbDocs.map((d: any) => d.name || 'Untitled'),
        skipped: false,
        bodyChars: textOnly.length,
        ai_called: true,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        issues: factualIssues.length,
        missing: missingKeyPoints.length,
      }));

      res.json({
        factualIssues,
        missingKeyPoints,
        suggestions,
        kbDocsUsed: kbDocs.map((d: any) => ({ id: d.id, name: d.name || 'Untitled' })),
        skipped: false,
      });
    } catch (error: any) {
      console.error('[validate-kb] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to validate against Knowledge Base' });
    }
  });

  // ===== BULK TEMPLATE ANALYSIS =====
  // Background job: runs deliverability + KB validation on up to 20 selected templates,
  // persists scores to the templates table. Frontend polls status endpoint for progress.
  // Concurrent jobs per org are blocked. Score blend = NONE (deliverability and KB stay independent).

  const BULK_MAX_BATCH = 20;
  const BULK_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
  const BULK_SKIP_RECENT_MS = 60 * 60 * 1000; // skip templates analyzed in last hour unless force=true

  // Compute deliverability synchronously from template content (rule-based, no LLM).
  // Mirrors the scoring rules in /api/templates/analyze-deliverability but without the
  // Azure AI suggestions step (those are not needed for bulk score persistence).
  function computeDeliverabilityScore(subject: string, content: string): { score: number; grade: 'A' | 'B' | 'C' | 'D' } {
    const subjectLower = (subject || '').toLowerCase();
    const contentLower = (content || '').toLowerCase();
    const combined = subjectLower + ' ' + contentLower;
    const textOnly = (content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    let score = 100;

    const spamGroups: { words: string[]; penalty: number }[] = [
      { words: ['free', 'act now', 'limited time', 'urgent', 'buy now', 'order now', 'click here', 'no obligation', 'risk free', 'guaranteed'], penalty: 3 },
      { words: ['winner', 'congratulations', 'you have been selected', 'million dollars', 'earn money', 'make money', 'cash bonus', 'double your income'], penalty: 8 },
      { words: ['100% free', 'no cost', 'no credit card', 'no purchase necessary', 'apply now', 'offer expires', 'once in a lifetime', 'special promotion'], penalty: 4 },
      { words: ['viagra', 'pharmacy', 'weight loss', 'enlargement', 'casino'], penalty: 20 },
    ];
    for (const g of spamGroups) for (const w of g.words) if (combined.includes(w)) score -= g.penalty;

    if (subject) {
      if (subject.length > 60) score -= 5;
      if (/^[A-Z\s!]+$/.test(subject) || subject === subject.toUpperCase()) score -= 10;
      if ((subject.match(/!/g) || []).length > 1) score -= 5;
      if (/\$\d|₹|€/.test(subject)) score -= 5;
    }

    const linkCount = (content?.match(/<a\s/gi) || []).length;
    const imageCount = (content?.match(/<img\s/gi) || []).length;
    const wordCount = textOnly.split(/\s+/).filter(Boolean).length;
    if (linkCount > 0 && wordCount < linkCount * 20) score -= 8;
    if (linkCount > 5) score -= 5;
    if (imageCount > 0 && wordCount < 50) score -= 10;
    if (imageCount > 3) score -= 5;
    if (wordCount < 20 && wordCount > 0) score -= 5;
    const capsWords = textOnly.split(/\s+/).filter(w => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
    if (capsWords.length > 3) score -= 5;
    const variables = combined.match(/\{\{(\w+)\}\}/g) || [];
    if (variables.length === 0) score -= 5;
    if (content?.includes('javascript:') || content?.includes('<script')) score -= 15;
    if (content?.includes('display:none') || content?.includes('visibility:hidden')) score -= 10;

    score = Math.max(0, Math.min(100, score));
    const grade: 'A' | 'B' | 'C' | 'D' = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
    return { score, grade };
  }

  // Run KB validation for one template. Returns issue counts. Returns null on failure (treated as "not validated").
  async function runKBValidationForBulk(orgId: string, subject: string, content: string): Promise<{ issuesCount: number; highSeverityCount: number } | null> {
    try {
      const textOnly = (content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      const query = `${subject || ''} ${textOnly}`.trim();
      if (!query) return null;

      const { getRelevantDocuments } = await import('./services/context-engine.js');
      const kbDocs = await getRelevantDocuments(orgId, query, undefined, 2);
      if (!kbDocs || kbDocs.length === 0) {
        return { issuesCount: 0, highSeverityCount: 0 }; // skipped (no KB match) — count as clean
      }

      const settings = await storage.getApiSettingsWithAzureFallback(orgId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';
      if (!endpoint || !apiKey || !deploymentName) return null;

      const kbContext = kbDocs.map((d: any, i: number) => `[DOC ${i + 1}: ${d.name || 'Untitled'}]\n${(d.content || '').slice(0, 2000)}`).join('\n\n---\n\n');
      const bodyForPrompt = textOnly.length <= 3000 ? textOnly : textOnly.slice(0, 1500) + '\n...[middle truncated]...\n' + textOnly.slice(-1500);
      const prompt = `Validate this email against the org Knowledge Base. Output ONLY JSON: {"factualIssues":[{"claim":"...","kbReference":"...","severity":"high|medium|low"}],"missingKeyPoints":[],"suggestions":[]}\n\nKB:\n${kbContext}\n\nSUBJECT: ${subject || '(empty)'}\nBODY: ${bodyForPrompt}`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const aiResp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You validate B2B emails against an org KB. Output ONLY valid JSON.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });
      if (!aiResp.ok) return null;
      const aiData = await aiResp.json() as any;
      const raw = aiData.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
      const factualIssues = Array.isArray(parsed?.factualIssues) ? parsed.factualIssues : [];
      const highSeverity = factualIssues.filter((i: any) => i.severity === 'high').length;
      return { issuesCount: factualIssues.length, highSeverityCount: highSeverity };
    } catch {
      return null;
    }
  }

  // Background runner — processes templates one at a time, updates job state in api_settings.
  // Checks cancellation flag between each template. Each template gets its own try/catch so
  // a single failure doesn't kill the whole batch.
  async function runBulkAnalyzeJob(jobId: string, orgId: string) {
    const jobKey = `bulk_analyze_job_${jobId}`;
    const loadJob = async () => {
      const settings = await storage.getApiSettings(orgId);
      const raw = settings?.[jobKey];
      return raw ? JSON.parse(raw) : null;
    };
    const saveJob = async (job: any) => storage.setApiSetting(orgId, jobKey, JSON.stringify(job));

    let job = await loadJob();
    if (!job) return;

    for (let i = 0; i < job.templateIds.length; i++) {
      // Re-load to pick up cancellation flag
      job = await loadJob();
      if (!job || job.cancelRequested) {
        if (job) { job.status = 'cancelled'; job.completedAt = new Date().toISOString(); await saveJob(job); }
        return;
      }

      const tplId = job.templateIds[i];
      const tpl = await storage.getEmailTemplate(tplId);
      if (!tpl || tpl.organizationId !== orgId) {
        job.errors.push({ templateId: tplId, error: 'Template not found' });
        job.processed = i + 1;
        await saveJob(job);
        continue;
      }

      job.currentTemplateId = tplId;
      job.currentTemplateName = tpl.name;
      job.lastHeartbeatAt = new Date().toISOString(); // refresh heartbeat before each template — keeps long KB validations from looking stale
      await saveJob(job);

      try {
        const subject = tpl.subject || '';
        const content = tpl.content || '';
        const deliverability = computeDeliverabilityScore(subject, content);
        const kb = await runKBValidationForBulk(orgId, subject, content);

        await storage.rawRun(
          `UPDATE templates SET "deliverabilityScore" = ?, "deliverabilityGrade" = ?, "kbIssuesCount" = ?, "kbHighSeverityCount" = ?, "qualityCheckedAt" = ? WHERE id = ? AND "organizationId" = ?`,
          deliverability.score, deliverability.grade,
          kb?.issuesCount ?? null, kb?.highSeverityCount ?? null,
          new Date().toISOString(), tplId, orgId
        );

        job.results.push({
          templateId: tplId,
          deliverabilityScore: deliverability.score,
          deliverabilityGrade: deliverability.grade,
          kbIssuesCount: kb?.issuesCount ?? null,
          kbHighSeverityCount: kb?.highSeverityCount ?? null,
        });
      } catch (e: any) {
        job.errors.push({ templateId: tplId, error: e?.message || 'Analysis failed' });
      }

      job.processed = i + 1;
      await saveJob(job);
    }

    job = await loadJob();
    if (job) {
      job.status = job.cancelRequested ? 'cancelled' : 'completed';
      job.currentTemplateId = null;
      job.currentTemplateName = null;
      job.completedAt = new Date().toISOString();
      await saveJob(job);
    }
  }

  app.post('/api/templates/bulk-analyze', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { templateIds, force } = req.body as { templateIds?: string[]; force?: boolean };

      if (!Array.isArray(templateIds) || templateIds.length === 0) {
        return res.status(400).json({ message: 'templateIds array required' });
      }
      if (templateIds.length > BULK_MAX_BATCH) {
        return res.status(400).json({ message: `Maximum ${BULK_MAX_BATCH} templates per bulk analysis. Split into multiple batches.` });
      }

      // Block concurrent jobs per org. Pre-check + post-write double-check pattern
      // catches the TOCTOU race where two requests arrive in the same tick. Heartbeat
      // (set on each template) keeps long-running validations from looking stale.
      const findActiveJob = async (excludeJobId?: string) => {
        const allSettings = await storage.getApiSettings(orgId);
        const now = Date.now();
        for (const [key, val] of Object.entries(allSettings || {})) {
          if (!key.startsWith('bulk_analyze_job_')) continue;
          try {
            const j = JSON.parse(val as string);
            if (excludeJobId && j.id === excludeJobId) continue;
            if (j.status !== 'running') continue;
            // Use heartbeat if present, fall back to startedAt
            const heartbeat = j.lastHeartbeatAt ? new Date(j.lastHeartbeatAt).getTime() : new Date(j.startedAt).getTime();
            if ((now - heartbeat) < BULK_JOB_TTL_MS) return j;
          } catch { /* ignore malformed */ }
        }
        return null;
      };

      const existingPre = await findActiveJob();
      if (existingPre) {
        return res.status(409).json({ message: 'A bulk analysis is already running for your organization. Wait for it to complete or cancel it.', existingJobId: existingPre.id });
      }

      // Optionally skip templates analyzed within the last hour
      let toProcess = templateIds.slice();
      let skippedRecent: string[] = [];
      if (!force) {
        const cutoff = Date.now() - BULK_SKIP_RECENT_MS;
        const filtered: string[] = [];
        for (const id of toProcess) {
          const tpl = await storage.getEmailTemplate(id);
          if (!tpl || tpl.organizationId !== orgId) continue;
          const checkedAt = tpl.qualityCheckedAt ? new Date(tpl.qualityCheckedAt).getTime() : 0;
          if (checkedAt && checkedAt > cutoff) {
            skippedRecent.push(id);
          } else {
            filtered.push(id);
          }
        }
        toProcess = filtered;
      }

      if (toProcess.length === 0) {
        return res.json({
          jobId: null,
          total: 0,
          skippedRecent,
          message: skippedRecent.length > 0 ? 'All selected templates were analyzed recently. Use Force re-analyze to override.' : 'No valid templates to analyze.',
        });
      }

      const jobId = `${orgId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = new Date().toISOString();
      const job = {
        id: jobId,
        organizationId: orgId,
        userId: req.user.id,
        total: toProcess.length,
        processed: 0,
        templateIds: toProcess,
        currentTemplateId: null,
        currentTemplateName: null,
        errors: [] as any[],
        results: [] as any[],
        skippedRecent,
        status: 'running' as const,
        startedAt,
        lastHeartbeatAt: startedAt,
        completedAt: null as string | null,
        cancelRequested: false,
      };
      await storage.setApiSetting(orgId, `bulk_analyze_job_${jobId}`, JSON.stringify(job));

      // Post-write double-check: if a concurrent request also created a job, the one
      // with the EARLIER startedAt wins. On identical-millisecond timestamps, lower jobId
      // wins as a deterministic tie-break — without this, both jobs could see "the other
      // wins" and both yield, leaving no job running. This closes the TOCTOU race without
      // needing transactional locks.
      const existingPost = await findActiveJob(jobId);
      if (existingPost) {
        const existingTime = new Date(existingPost.startedAt).getTime();
        const myTime = new Date(startedAt).getTime();
        const existingWins = existingTime < myTime || (existingTime === myTime && String(existingPost.id) < String(jobId));
        if (existingWins) {
          const yielded = { ...job, status: 'cancelled' as any, completedAt: new Date().toISOString(), cancelRequested: true };
          await storage.setApiSetting(orgId, `bulk_analyze_job_${jobId}`, JSON.stringify(yielded));
          return res.status(409).json({ message: 'Another bulk analysis was started concurrently. Wait for it to complete.', existingJobId: existingPost.id });
        }
        // I won — silently leave the other job in place; its post-write check will yield to me.
        // (It was already marked 'running'; its own arbitration will mark it cancelled when it scans and sees mine.)
      }

      // Fire-and-forget background runner with explicit error handling — marks job failed on crash
      setImmediate(async () => {
        try {
          await runBulkAnalyzeJob(jobId, orgId);
        } catch (err: any) {
          console.error('[bulk-analyze] runner crashed:', err?.message || err);
          try {
            const settings = await storage.getApiSettings(orgId);
            const raw = settings?.[`bulk_analyze_job_${jobId}`];
            if (raw) {
              const j = JSON.parse(raw);
              if (j.status === 'running') {
                j.status = 'failed';
                j.completedAt = new Date().toISOString();
                await storage.setApiSetting(orgId, `bulk_analyze_job_${jobId}`, JSON.stringify(j));
              }
            }
          } catch { /* best-effort cleanup */ }
        }
      });

      res.json({ jobId, total: toProcess.length, skippedRecent });
    } catch (error: any) {
      console.error('[bulk-analyze] start error:', error?.message || error);
      res.status(500).json({ message: 'Failed to start bulk analysis' });
    }
  });

  app.get('/api/templates/bulk-analyze/:jobId', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const raw = settings?.[`bulk_analyze_job_${req.params.jobId}`];
      if (!raw) return res.status(404).json({ message: 'Job not found' });
      const job = JSON.parse(raw);
      if (job.organizationId !== orgId) return res.status(403).json({ message: 'Forbidden' });

      // Stale-job detection: use heartbeat (refreshed before each template) so a slow KB
      // validation doesn't false-flag a healthy long-running job. Falls back to startedAt
      // for jobs created before heartbeat tracking was added.
      const lastSignal = job.lastHeartbeatAt || job.startedAt;
      if (job.status === 'running' && lastSignal && (Date.now() - new Date(lastSignal).getTime()) > BULK_JOB_TTL_MS) {
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        await storage.setApiSetting(orgId, `bulk_analyze_job_${req.params.jobId}`, JSON.stringify(job));
      }

      res.json(job);
    } catch (error: any) {
      console.error('[bulk-analyze] status error:', error?.message || error);
      res.status(500).json({ message: 'Failed to get job status' });
    }
  });

  app.post('/api/templates/bulk-analyze/:jobId/cancel', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const key = `bulk_analyze_job_${req.params.jobId}`;
      const raw = settings?.[key];
      if (!raw) return res.status(404).json({ message: 'Job not found' });
      const job = JSON.parse(raw);
      if (job.organizationId !== orgId) return res.status(403).json({ message: 'Forbidden' });
      if (job.status !== 'running') return res.json({ ok: true, status: job.status });
      job.cancelRequested = true;
      await storage.setApiSetting(orgId, key, JSON.stringify(job));
      res.json({ ok: true, status: 'cancelling' });
    } catch (error: any) {
      console.error('[bulk-analyze] cancel error:', error?.message || error);
      res.status(500).json({ message: 'Failed to cancel job' });
    }
  });

  // Dashboard: count + list templates that need attention (low deliverability OR high-severity KB issues)
  app.get('/api/templates/quality-alerts', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const rows = await storage.rawAll(
        `SELECT id, name, "deliverabilityScore", "deliverabilityGrade", "kbIssuesCount", "kbHighSeverityCount", "qualityCheckedAt"
         FROM templates
         WHERE "organizationId" = ?
           AND ("deliverabilityGrade" IN ('C', 'D') OR ("kbHighSeverityCount" IS NOT NULL AND "kbHighSeverityCount" > 0))
         ORDER BY
           CASE "deliverabilityGrade" WHEN 'D' THEN 1 WHEN 'C' THEN 2 ELSE 3 END,
           "kbHighSeverityCount" DESC NULLS LAST
         LIMIT 20`,
        orgId
      );
      res.json({ count: rows.length, templates: rows });
    } catch (error: any) {
      console.error('[quality-alerts] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to load quality alerts' });
    }
  });

  // ===== OUTBOUND REPLY SWEEPER ADMIN =====
  // Lets owners/admins verify the sweeper is running and trigger a manual sweep on demand.
  // No payload mutation — only reads sweeper status and invokes the existing run function.
  //
  // Authorization: standard admin session OR a header-based debug token match.
  // The debug-token path is ONLY for these two sweeper endpoints (scope-limited) and is OFF
  // by default — only active when DEBUG_AUTH_TOKEN env var is set in Azure config.
  // Worst-case if leaked: triggers a sweep (same effect as the scheduled 10-min cycle).
  const requireAdminOrDebugToken = (req: any, res: any, next: any) => {
    const expected = process.env.DEBUG_AUTH_TOKEN;
    if (expected && expected.length >= 16 && req.headers['x-debug-token'] === expected) {
      return next(); // debug-token bypass (scoped to this middleware only)
    }
    // Fall through to standard session-based admin check
    return requireAuth(req, res, () => {
      const role = req.user?.role;
      if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
        return res.status(403).json({ message: 'Admin only' });
      }
      next();
    });
  };

  app.get('/api/admin/outbound-reply-sweep/status', requireAdminOrDebugToken, async (req: any, res) => {
    try {
      const { getOutboundReplySweepStatus } = await import('./services/outbound-reply-sweeper.js');
      res.json(getOutboundReplySweepStatus());
    } catch (error: any) {
      console.error('[outbound-reply-sweep status] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to get sweeper status' });
    }
  });

  app.post('/api/admin/outbound-reply-sweep/run', requireAdminOrDebugToken, async (req: any, res) => {
    try {
      const { runOutboundReplySweep, getOutboundReplySweepStatus } = await import('./services/outbound-reply-sweeper.js');
      const before = getOutboundReplySweepStatus();
      if (before.isProcessing) {
        return res.status(409).json({ message: 'Sweeper already running. Try again in a moment.', status: before });
      }
      // Run synchronously and return the stats — gives the admin immediate verification
      const stats = await runOutboundReplySweep();
      res.json({ ok: true, stats });
    } catch (error: any) {
      console.error('[outbound-reply-sweep run] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to run sweeper' });
    }
  });

  // Backfill nativeReplyContent for rows already marked repliedBy by older sweep runs
  // (those only stored timestamps, not bodies). Body limit per call defaults to 100.
  app.post('/api/admin/outbound-reply-sweep/backfill-content', requireAdminOrDebugToken, async (req: any, res) => {
    try {
      const max = Math.min(500, Math.max(1, parseInt(req.body?.maxRows as string) || 100));
      const { backfillNativeReplyContent } = await import('./services/outbound-reply-sweeper.js');
      const stats = await backfillNativeReplyContent(max);
      res.json({ ok: true, stats });
    } catch (error: any) {
      console.error('[outbound-reply-sweep backfill-content] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to backfill native reply content' });
    }
  });

  // One-time backfill: reclassify inbox rows from system/bot senders (GitHub Actions,
  // CI, no-reply addresses) that were previously mis-flagged as 'positive' / 'general' /
  // 'negative'. Sets replyType='auto_reply' so isHumanReply() excludes them from Need Reply.
  // Sender match list mirrors SYSTEM_BOT_SENDER_PATTERNS in reply-classifier.ts.
  app.post('/api/admin/reclassify-bot-senders', requireAdminOrDebugToken, async (req: any, res) => {
    try {
      const orgId = req.user?.organizationId || (req.body?.organizationId as string | undefined);
      const senderPatterns = [
        '%noreply@%', '%no-reply@%', '%donotreply@%', '%do-not-reply@%',
        '%notifications@github.com%', '%noreply@github.com%', '%notifications@gitlab.com%',
        '%notifications@bitbucket.org%', '%@atlassian.com%', '%notifications@slack.com%',
        '%notify@%', '%alerts@%', '%alert@%', '%system@%', '%automated@%',
        '%buildmaster@%', '%jenkins@%', '%circleci%', '%azure-noreply@%',
        '%azuredevops%', '%support-noreply@%', '%github-action%',
      ];
      // ? placeholders are auto-converted to $N for PG by storage.rawRun/rawAll
      const orConds = senderPatterns.map(() => `(LOWER("fromEmail") LIKE ? OR LOWER("fromName") LIKE ?)`).join(' OR ');
      const params: any[] = [];
      for (const pat of senderPatterns) { params.push(pat, pat); }
      const orgClause = orgId ? `AND "organizationId" = ?` : '';
      if (orgId) params.push(orgId);
      // Count before to report what was changed (safer than relying on RETURNING which is PG-only)
      const beforeRow = await storage.rawGet(
        `SELECT COUNT(*) as c FROM unified_inbox WHERE (${orConds}) AND "replyType" IN ('positive','negative','general') ${orgClause}`,
        ...params
      );
      const matched = parseInt(beforeRow?.c || '0', 10);
      if (matched > 0) {
        await storage.rawRun(
          `UPDATE unified_inbox SET "replyType" = 'auto_reply' WHERE (${orConds}) AND "replyType" IN ('positive','negative','general') ${orgClause}`,
          ...params
        );
      }
      console.log(`[reclassify-bot-senders] reclassified ${matched} rows${orgId ? ` for org ${orgId}` : ' (all orgs)'}`);
      res.json({ ok: true, reclassified: matched });
    } catch (error: any) {
      console.error('[reclassify-bot-senders] error:', error?.message || error);
      res.status(500).json({ message: 'Failed to reclassify' });
    }
  });

  // ===== ADMIN: TRIGGER STALE-JOBS SWEEP =====
  // Forces an immediate run of the stale-jobs sweeper. Same code path as the
  // 5-min scheduled sweep — useful when a job has obviously crashed and you
  // don't want to wait for the next scheduled cycle.
  app.post('/api/admin/sweep-stale-jobs', requireAuth, async (req: any, res) => {
    const role = req.user?.role;
    const isSuperAdmin = !!req.user?.isSuperAdmin;
    if (!isSuperAdmin && role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const { getStaleJobsSweepStatus } = await import('./services/stale-jobs-sweeper.js');
      const before = getStaleJobsSweepStatus();
      // Manually run sweep query (same logic as scheduled run but inline so we
      // can return the result immediately). Reuses the storage layer; no
      // duplication of the matching/aging logic since we just call the module.
      // Easier: re-export a runSweepNow() — but to avoid a wider refactor here,
      // we inline a mini-sweep matching the module's behavior exactly.
      const JOB_PREFIXES = [
        { keyPrefix: 'lead_intel_job_', ttlMs: 60 * 60 * 1000, label: 'lead-intel' },
        { keyPrefix: 'bulk_analyze_job_', ttlMs: 60 * 60 * 1000, label: 'bulk-template-analyze' },
      ];
      const likePatterns = JOB_PREFIXES.map(() => `"settingKey" LIKE ?`).join(' OR ');
      const params = JOB_PREFIXES.map(t => `${t.keyPrefix}%`);
      const rows = await storage.rawAll(
        `SELECT "organizationId", "settingKey", "settingValue" FROM api_settings WHERE ${likePatterns}`,
        ...params
      ) as any[];
      const now = Date.now();
      let scanned = 0; let aged = 0; const byType: Record<string, number> = {};
      for (const row of rows) {
        scanned++;
        try {
          const job = JSON.parse(row.settingValue);
          if (job?.status !== 'running') continue;
          const jobType = JOB_PREFIXES.find(t => row.settingKey.startsWith(t.keyPrefix));
          if (!jobType) continue;
          const lastSignal = job.heartbeatAt || job.startedAt;
          if (!lastSignal) continue;
          const lastSignalMs = new Date(lastSignal).getTime();
          if (!Number.isFinite(lastSignalMs)) continue;
          const ageMs = now - lastSignalMs;
          if (ageMs <= jobType.ttlMs) continue;
          job.status = 'failed';
          job.error = `Stale-job sweeper (manual): no heartbeat for ${Math.round(ageMs / 60000)} minutes (TTL ${Math.round(jobType.ttlMs / 60000)}m).`;
          job.finishedAt = new Date().toISOString();
          await storage.setApiSetting(row.organizationId, row.settingKey, JSON.stringify(job));
          aged++;
          byType[jobType.label] = (byType[jobType.label] || 0) + 1;
          console.log(`[StaleJobs] Manual sweep aged out ${row.settingKey} (org=${row.organizationId})`);
        } catch { /* skip malformed */ }
      }
      res.json({ ok: true, scanned, aged, byType, before: before.lastRun });
    } catch (error: any) {
      console.error('[Admin] Manual sweep failed:', error?.message || error);
      res.status(500).json({ message: 'Failed to run stale-jobs sweep' });
    }
  });

  // ===== ADMIN: SHEETS-IMPORT DEBUG =====
  // Read-only diagnostic — given a Google Sheets URL, lists every Google token stored
  // for the org and reports what each one returns when asked to read THIS specific
  // spreadsheet. No secrets exposed (token values masked). Use when the import dialog
  // shows a confusing error to see exactly which path is failing.
  //
  // Usage: /api/admin/sheets-debug?url=<google-sheets-url>
  app.get('/api/admin/sheets-debug', requireAuth, async (req: any, res) => {
    const role = req.user?.role;
    const isSuperAdmin = !!req.user?.isSuperAdmin;
    if (!isSuperAdmin && role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const orgId = req.user.organizationId;
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url query param required' });

    // Same regex as extractSpreadsheetId
    let spreadsheetId: string | null = null;
    if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) spreadsheetId = url;
    else {
      const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (m) spreadsheetId = m[1];
    }
    if (!spreadsheetId) return res.status(400).json({ error: 'Invalid Google Sheets URL', input: url });

    const settings = await storage.getApiSettings(orgId);

    // Collect candidates exactly the way Strategy 1.5 does
    type Cand = { label: string; accessToken: string; refreshToken: string; tokenExpiry: string };
    const candidates: Cand[] = [];
    if (settings.gmail_access_token && settings.gmail_refresh_token) {
      candidates.push({
        label: 'org-level',
        accessToken: settings.gmail_access_token,
        refreshToken: settings.gmail_refresh_token,
        tokenExpiry: settings.gmail_token_expiry || '0',
      });
    }
    for (const k of Object.keys(settings)) {
      if (!k.startsWith('gmail_sender_') || !k.endsWith('_access_token')) continue;
      const email = k.replace('gmail_sender_', '').replace('_access_token', '');
      const sa = settings[k];
      const sr = settings[`gmail_sender_${email}_refresh_token`];
      if (sa && sr) {
        candidates.push({
          label: `sender:${email}`,
          accessToken: sa,
          refreshToken: sr,
          tokenExpiry: settings[`gmail_sender_${email}_token_expiry`] || '0',
        });
      }
    }

    let cid = settings.google_oauth_client_id || '';
    let csec = settings.google_oauth_client_secret || '';
    if (!cid || !csec) {
      try {
        const sa = await storage.getSuperAdminOrgId();
        if (sa && sa !== orgId) {
          const ss = await storage.getApiSettings(sa);
          if (ss.google_oauth_client_id) { cid = ss.google_oauth_client_id; csec = ss.google_oauth_client_secret || ''; }
        }
      } catch {}
    }
    if (!cid) cid = process.env.GOOGLE_CLIENT_ID || '';
    if (!csec) csec = process.env.GOOGLE_CLIENT_SECRET || '';

    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties.title`;
    const now = Date.now();

    const results = [] as any[];
    for (const c of candidates) {
      const expiryMs = parseInt(c.tokenExpiry || '0');
      const expired = !expiryMs || now > expiryMs - 5 * 60 * 1000;
      let token: string | null = c.accessToken;
      let refreshOutcome: string | null = null;

      if (expired && cid && csec) {
        try {
          const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
          });
          if (r.ok) {
            const td = await r.json() as any;
            if (td.access_token) {
              token = td.access_token;
              refreshOutcome = 'refreshed_ok';
            } else {
              refreshOutcome = 'refresh_no_access_token_in_response';
            }
          } else {
            const errText = await r.text();
            refreshOutcome = `refresh_failed_${r.status}: ${errText.slice(0, 120)}`;
          }
        } catch (e: any) {
          refreshOutcome = `refresh_threw: ${e?.message || 'unknown'}`;
        }
      }

      // Probe Google's tokeninfo to see actual granted scopes
      let scopes: string | null = null;
      if (token) {
        try {
          const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
          if (ti.ok) {
            const tid = await ti.json() as any;
            scopes = tid.scope || null;
          }
        } catch {}
      }

      // Try the actual sheet
      let sheetStatus: number | null = null;
      let sheetBody: string | null = null;
      if (token) {
        try {
          const apiRes = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
          sheetStatus = apiRes.status;
          if (!apiRes.ok) {
            sheetBody = (await apiRes.text()).slice(0, 200);
          } else {
            sheetBody = '<ok>';
          }
        } catch (e: any) {
          sheetBody = `threw: ${e?.message || 'unknown'}`;
        }
      }

      results.push({
        label: c.label,
        tokenExpiryIso: expiryMs ? new Date(expiryMs).toISOString() : null,
        tokenExpired: expired,
        refreshOutcome,
        grantedScopes: scopes,
        hasSheetsScope: scopes ? scopes.includes('spreadsheets') : null,
        sheetFetchStatus: sheetStatus,
        sheetFetchBody: sheetBody,
      });
    }

    // Public CSV check
    let publicCsvStatus: number | null = null;
    let publicCsvLooksHtml = false;
    try {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      publicCsvStatus = r.status;
      if (r.ok) {
        const t = await r.text();
        publicCsvLooksHtml = t.trim().startsWith('<!DOCTYPE') || t.trim().startsWith('<html');
      }
    } catch {}

    res.json({
      orgId,
      spreadsheetId,
      candidatesCount: candidates.length,
      results,
      publicCsv: { status: publicCsvStatus, looksHtmlLogin: publicCsvLooksHtml },
    });
  });

  // ===== ADMIN HEALTH =====
  // Read-only system health: process metrics, DB latency, queue depths, engine status,
  // active background jobs. Org-scoped for admins; superadmin sees all-orgs aggregate.
  // Each section in its own try/catch so a partial failure still returns useful data.
  // No external API calls — fully in-process + simple counts on indexed columns.
  app.get('/api/admin/health', requireAuth, async (req: any, res) => {
    const role = req.user?.role;
    const isSuperAdmin = !!req.user?.isSuperAdmin;
    if (!isSuperAdmin && role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const orgId: string = req.user.organizationId;
    const errors: Record<string, string> = {};
    const out: any = { timestamp: new Date().toISOString(), orgId, isSuperAdmin };
    const t0 = Date.now();

    // Helper: safely parse counts from PG/SQLite (PG returns bigint as string)
    const num = (v: any): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      return Number.isFinite(n) ? n : 0;
    };

    // === Process metrics ===
    try {
      const mem = process.memoryUsage();
      out.process = {
        uptimeSec: Math.round(process.uptime()),
        memoryMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        nodeVersion: process.version,
        pid: process.pid,
        env: process.env.NODE_ENV || 'development',
      };
    } catch (e: any) { errors.process = e?.message || String(e); }

    // === DB latency ===
    try {
      const dt = Date.now();
      await storage.rawGet('SELECT 1 as ok');
      out.db = { latencyMs: Date.now() - dt, ok: true };
    } catch (e: any) {
      out.db = { ok: false, latencyMs: -1 };
      errors.db = e?.message || String(e);
    }

    // === Campaigns by status ===
    try {
      const orgFilter = isSuperAdmin ? '' : `WHERE "organizationId" = ?`;
      const params = isSuperAdmin ? [] : [orgId];
      const row = await storage.rawGet(
        `SELECT
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS "active",
           SUM(CASE WHEN status='paused' AND "autoPaused"=true THEN 1 ELSE 0 END) AS "pausedAuto",
           SUM(CASE WHEN status='paused' AND ("autoPaused" IS NULL OR "autoPaused"=false) THEN 1 ELSE 0 END) AS "pausedUser",
           SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS "draft",
           SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS "scheduled",
           SUM(CASE WHEN status='following_up' THEN 1 ELSE 0 END) AS "followingUp",
           SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS "completed",
           COUNT(*) AS "total"
         FROM campaigns ${orgFilter}`,
        ...params
      ) as any;
      out.campaigns = {
        active: num(row?.active),
        pausedAuto: num(row?.pausedAuto),
        pausedUser: num(row?.pausedUser),
        draft: num(row?.draft),
        scheduled: num(row?.scheduled),
        followingUp: num(row?.followingUp),
        completed: num(row?.completed),
        total: num(row?.total),
      };
    } catch (e: any) { errors.campaigns = e?.message || String(e); }

    // === Follow-up executions (joined via campaigns for org scope) ===
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const orgJoin = isSuperAdmin ? '' : `JOIN campaigns c ON c.id = fe."campaignId" WHERE c."organizationId" = ?`;
      const params = isSuperAdmin ? [dayAgo, dayAgo] : [dayAgo, dayAgo, orgId];
      const row = await storage.rawGet(
        `SELECT
           SUM(CASE WHEN fe.status='pending' THEN 1 ELSE 0 END) AS "pending",
           SUM(CASE WHEN fe.status='processing' THEN 1 ELSE 0 END) AS "processing",
           SUM(CASE WHEN fe.status='sent' AND fe."executedAt" >= ? THEN 1 ELSE 0 END) AS "sentLast24h",
           SUM(CASE WHEN fe.status='failed' AND fe."executedAt" >= ? THEN 1 ELSE 0 END) AS "failedLast24h",
           SUM(CASE WHEN fe.status='cancelled' THEN 1 ELSE 0 END) AS "cancelled",
           COUNT(*) AS "total"
         FROM followup_executions fe ${orgJoin}`,
        ...params
      ) as any;
      out.followups = {
        pending: num(row?.pending),
        processing: num(row?.processing),
        sentLast24h: num(row?.sentLast24h),
        failedLast24h: num(row?.failedLast24h),
        cancelled: num(row?.cancelled),
        total: num(row?.total),
      };
    } catch (e: any) { errors.followups = e?.message || String(e); }

    // === Email accounts ===
    try {
      const orgFilter = isSuperAdmin ? '' : `WHERE "organizationId" = ?`;
      const params = isSuperAdmin ? [] : [orgId];
      const row = await storage.rawGet(
        `SELECT
           SUM(CASE WHEN "isActive" != 0 AND COALESCE("scanOnly",0)=0 THEN 1 ELSE 0 END) AS "active",
           SUM(CASE WHEN COALESCE("scanOnly",0)=1 THEN 1 ELSE 0 END) AS "scanOnly",
           SUM(CASE WHEN "isActive" = 0 THEN 1 ELSE 0 END) AS "softDeleted",
           SUM(CASE WHEN "authStatus"='reauth_required' THEN 1 ELSE 0 END) AS "reauthRequired",
           SUM(CASE WHEN "isActive" != 0 AND COALESCE("scanOnly",0)=0 AND "dailySent" >= "dailyLimit" THEN 1 ELSE 0 END) AS "dailyLimitReached",
           COUNT(*) AS "total"
         FROM email_accounts ${orgFilter}`,
        ...params
      ) as any;
      out.emailAccounts = {
        active: num(row?.active),
        scanOnly: num(row?.scanOnly),
        softDeleted: num(row?.softDeleted),
        reauthRequired: num(row?.reauthRequired),
        dailyLimitReached: num(row?.dailyLimitReached),
        total: num(row?.total),
      };
    } catch (e: any) { errors.emailAccounts = e?.message || String(e); }

    // === Inbox (use canonical storage.getInboxStats — already excludes warmup) ===
    try {
      if (!isSuperAdmin) {
        out.inbox = await storage.getInboxStats(orgId);
      } else {
        // Superadmin: skip per-org call, just count rows
        const row = await storage.rawGet(
          `SELECT COUNT(*) AS "total",
             SUM(CASE WHEN status='unread' THEN 1 ELSE 0 END) AS "unread",
             SUM(CASE WHEN "replyType" IS NULL OR "replyType"='' THEN 1 ELSE 0 END) AS "unclassified"
           FROM unified_inbox`
        ) as any;
        out.inbox = { total: num(row?.total), unread: num(row?.unread), unclassified: num(row?.unclassified) };
      }
    } catch (e: any) { errors.inbox = e?.message || String(e); }

    // === Engine status (in-process state) ===
    try {
      const eng: any = {};
      try {
        const { getOutboundReplySweepStatus } = await import('./services/outbound-reply-sweeper.js');
        eng.outboundReplySweeper = getOutboundReplySweepStatus();
      } catch (e: any) { eng.outboundReplySweeper = { error: e?.message || String(e) }; }
      try {
        const { getStaleJobsSweepStatus } = await import('./services/stale-jobs-sweeper.js');
        eng.staleJobsSweeper = getStaleJobsSweepStatus();
      } catch (e: any) { eng.staleJobsSweeper = { error: e?.message || String(e) }; }
      out.engines = eng;
    } catch (e: any) { errors.engines = e?.message || String(e); }

    // === Active background jobs (from api_settings — only this org's jobs) ===
    try {
      const settings = await storage.getApiSettings(orgId);
      const jobs: any = { leadIntel: [], bulkTemplateAnalyze: [] };
      const now = Date.now();
      for (const [key, val] of Object.entries(settings || {})) {
        try {
          if (key.startsWith('lead_intel_job_')) {
            const j = JSON.parse(val as string);
            if (j.status === 'running') {
              jobs.leadIntel.push({
                jobId: j.id, type: j.type, status: j.status,
                startedAt: j.startedAt, heartbeatAt: j.heartbeatAt,
                progress: j.progress, ageMs: j.startedAt ? now - new Date(j.startedAt).getTime() : null,
              });
            }
          } else if (key.startsWith('bulk_analyze_job_')) {
            const j = JSON.parse(val as string);
            if (j.status === 'running') {
              jobs.bulkTemplateAnalyze.push({
                jobId: j.id, status: j.status,
                startedAt: j.startedAt, heartbeatAt: j.heartbeatAt,
                progress: j.progress, ageMs: j.startedAt ? now - new Date(j.startedAt).getTime() : null,
              });
            }
          }
        } catch { /* skip malformed */ }
      }
      out.activeJobs = jobs;
    } catch (e: any) { errors.activeJobs = e?.message || String(e); }

    // === In-process caches ===
    try {
      out.caches = {
        authCacheSize: authCache.size,
        loggedInUsersSize: loggedInUsers.size,
      };
    } catch (e: any) { errors.caches = e?.message || String(e); }

    out.totalLatencyMs = Date.now() - t0;
    if (Object.keys(errors).length > 0) out.errors = errors;
    res.json(out);
  });

  // AI Auto-fix: rewrite subject + content to fix deliverability issues
  app.post('/api/templates/fix-deliverability', async (req: any, res) => {
    try {
      const { subject, content, issues } = req.body;
      if (!subject && !content) return res.status(400).json({ message: 'Subject or content required' });

      const settings = await storage.getApiSettingsWithAzureFallback(req.user.organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.status(400).json({ message: 'Azure OpenAI not configured. Go to Advanced Settings to set up.' });
      }

      const issuesList = (issues || []).map((i: any) => `- [${i.severity}] ${i.category}: ${i.message}`).join('\n');

      const prompt = `You are an email deliverability expert. Rewrite the email below to fix the deliverability issues listed. Keep the same meaning, tone, structure, and HTML formatting. Only fix the specific issues — do not change anything else unnecessarily.

RULES:
- Replace spam trigger words with professional alternatives (e.g., "free" → "complimentary" or "at no cost", "click here" → "learn more", "act now" → "take the next step")
- If subject is too long, shorten it while keeping the key message
- If ALL CAPS, convert to normal case
- Remove excessive exclamation marks or question marks
- Keep all {{variables}} exactly as they are — do NOT modify personalization tokens
- Keep all HTML tags, links, images, and structure intact
- Keep all tracking URLs and unsubscribe links unchanged
- If the email has too many links, do NOT remove them — just improve the surrounding text

ISSUES TO FIX:
${issuesList || 'General deliverability improvement needed'}

ORIGINAL SUBJECT:
${subject || '(none)'}

ORIGINAL CONTENT (HTML):
${(content || '').slice(0, 8000)}

Respond with ONLY a JSON object in this format:
{"subject": "improved subject line", "content": "improved HTML content", "changes": ["list of changes you made"]}`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const aiResp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an email deliverability expert. Respond only with valid JSON. Preserve all HTML structure and {{variables}}.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        return res.status(500).json({ message: `AI request failed: ${errText.slice(0, 200)}` });
      }

      const aiData = await aiResp.json() as any;
      const raw = aiData.choices?.[0]?.message?.content || '';
      try {
        const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
        res.json({
          success: true,
          subject: parsed.subject || subject,
          content: parsed.content || content,
          changes: parsed.changes || [],
        });
      } catch {
        res.status(500).json({ message: 'AI returned invalid response. Please try again.' });
      }
    } catch (error) {
      console.error('Fix deliverability error:', error);
      res.status(500).json({ message: 'Failed to fix deliverability issues' });
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
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      // All templates are public by default; only owners/admins can change visibility
      const isPublic = isAdmin ? (req.body.isPublic !== undefined ? req.body.isPublic : true) : true;
      const template = await storage.createEmailTemplate({
        ...req.body,
        isPublic,
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
      const data = { ...req.body };
      // Only owners/admins can change template visibility
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) delete data.isPublic;
      const updated = await storage.updateEmailTemplate(req.params.id, data);
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

  // ========== ATTACHMENT ENDPOINTS ==========

  // List attachments for a template or campaign
  app.get('/api/attachments', async (req: any, res) => {
    try {
      const { templateId, campaignId } = req.query;
      const attachments = await storage.getAttachments(req.user.organizationId, { templateId, campaignId });
      res.json(attachments);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch attachments' });
    }
  });

  // Upload attachment (base64 encoded in JSON body — max 10MB)
  app.post('/api/attachments', async (req: any, res) => {
    try {
      const { templateId, campaignId, fileName, mimeType, content } = req.body;
      if (!fileName || !content) return res.status(400).json({ message: 'fileName and content (base64) required' });
      // content is base64 string — check size (base64 is ~33% larger than raw)
      const rawSize = Math.ceil(content.length * 3 / 4);
      if (rawSize > 10 * 1024 * 1024) return res.status(400).json({ message: 'File too large (max 10MB)' });
      const attachment = await storage.createAttachment({
        organizationId: req.user.organizationId,
        templateId: templateId || undefined,
        campaignId: campaignId || undefined,
        fileName, fileSize: rawSize, mimeType: mimeType || 'application/octet-stream', content
      });
      res.json({ id: attachment.id, fileName, fileSize: rawSize, mimeType });
    } catch (error) {
      res.status(500).json({ message: 'Failed to upload attachment' });
    }
  });

  // Download attachment
  app.get('/api/attachments/:id', async (req: any, res) => {
    try {
      const att = await storage.getAttachment(req.params.id, req.user.organizationId);
      if (!att) return res.status(404).json({ message: 'Not found' });
      const buf = Buffer.from(att.content, 'base64');
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${att.fileName}"`);
      res.send(buf);
    } catch (error) {
      res.status(500).json({ message: 'Failed to download attachment' });
    }
  });

  // Delete attachment
  app.delete('/api/attachments/:id', async (req: any, res) => {
    try {
      await storage.deleteAttachment(req.params.id, req.user.organizationId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete attachment' });
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
        followupEngine.setPublicBaseUrl(trackingBaseUrl);
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

  // Helper: Find a Google access token that actually works for the Sheets API.
  // Authoritative test — probes each stored token (org-level + per-sender) against
  // a real Sheets API endpoint. Refreshes expired tokens. Returns the first token
  // that returns 200/404 (404 = auth works, spreadsheet just not found).
  // Returns null if NONE work (re-auth required).
  async function getGoogleAccessTokenForSheets(organizationId: string): Promise<string | null> {
    try {
      const settings = await storage.getApiSettings(organizationId);
      let clientId = settings.google_oauth_client_id || '';
      let clientSecret = settings.google_oauth_client_secret || '';
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
        } catch {}
      }
      if (!clientId) clientId = process.env.GOOGLE_CLIENT_ID || '';
      if (!clientSecret) clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

      type Cand = { accessToken: string; refreshToken: string; tokenExpiry: string; label: string; expiryKey: string; tokenKey: string };
      const candidates: Cand[] = [];
      const seen = new Set<string>();

      const pushCandidate = (c: Cand) => {
        const key = c.refreshToken || c.accessToken;
        if (!key || seen.has(key)) return;
        seen.add(key);
        candidates.push(c);
      };

      if (settings.gmail_access_token && settings.gmail_refresh_token) {
        pushCandidate({
          accessToken: settings.gmail_access_token,
          refreshToken: settings.gmail_refresh_token,
          tokenExpiry: settings.gmail_token_expiry || '0',
          label: 'org-level',
          expiryKey: 'gmail_token_expiry',
          tokenKey: 'gmail_access_token',
        });
      }
      const senderTokenKeys = Object.keys(settings).filter(k => k.startsWith('gmail_sender_') && k.endsWith('_access_token'));
      for (const key of senderTokenKeys) {
        const email = key.replace('gmail_sender_', '').replace('_access_token', '');
        const senderAccess = settings[key];
        const senderRefresh = settings[`gmail_sender_${email}_refresh_token`];
        if (senderAccess && senderRefresh) {
          pushCandidate({
            accessToken: senderAccess,
            refreshToken: senderRefresh,
            tokenExpiry: settings[`gmail_sender_${email}_token_expiry`] || '0',
            label: `sender:${email}`,
            expiryKey: `gmail_sender_${email}_token_expiry`,
            tokenKey: `gmail_sender_${email}_access_token`,
          });
        }
      }
      if (candidates.length === 0) {
        console.log('[GoogleAuth/Sheets] No candidate tokens found in org', organizationId);
        return null;
      }

      // Try freshest first
      candidates.sort((a, b) => parseInt(b.tokenExpiry || '0') - parseInt(a.tokenExpiry || '0'));
      console.log(`[GoogleAuth/Sheets] Probing ${candidates.length} candidate token(s):`, candidates.map(c => c.label).join(', '));

      // Probe URL — a public Google-owned test spreadsheet. We only care about the HTTP status:
      // 200 = token works AND has spreadsheets scope
      // 403 with "insufficient" = token lacks spreadsheets scope
      // 401 = token invalid/expired
      // 404 = token works but this specific id doesn't exist (still means scope OK — unlikely here)
      // We use Google's public sample sheet so any authorized account can read it.
      const probeSpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
      const probeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${probeSpreadsheetId}?fields=spreadsheetId`;

      for (const candidate of candidates) {
        let accessToken: string | null = candidate.accessToken;
        const isExpired = candidate.tokenExpiry && Date.now() > parseInt(candidate.tokenExpiry) - 5 * 60 * 1000;
        if (isExpired) {
          if (!clientId || !clientSecret) { console.log(`[GoogleAuth/Sheets] No OAuth creds to refresh ${candidate.label}`); continue; }
          try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: candidate.refreshToken,
                grant_type: 'refresh_token',
              }),
            });
            if (!tokenRes.ok) { console.log(`[GoogleAuth/Sheets] Refresh failed for ${candidate.label}:`, tokenRes.status); continue; }
            const tokenData = await tokenRes.json() as any;
            accessToken = tokenData.access_token;
            if (accessToken) {
              await storage.setApiSetting(organizationId, candidate.tokenKey, accessToken);
              if (tokenData.expires_in) {
                await storage.setApiSetting(organizationId, candidate.expiryKey, String(Date.now() + tokenData.expires_in * 1000));
              }
            }
          } catch (e) { console.log(`[GoogleAuth/Sheets] Refresh error for ${candidate.label}:`, e); continue; }
        }
        if (!accessToken) continue;

        try {
          const probeRes = await fetch(probeUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          if (probeRes.ok) {
            console.log(`[GoogleAuth/Sheets] Token works for ${candidate.label}`);
            return accessToken;
          }
          const body = await probeRes.text();
          const insufficientScope = probeRes.status === 403 && (body.includes('insufficient') || body.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || body.includes('Request had insufficient authentication scopes'));
          console.log(`[GoogleAuth/Sheets] ${candidate.label} probe status=${probeRes.status}${insufficientScope ? ' (insufficient scope)' : ''}: ${body.slice(0, 160)}`);
          // If it's an auth/scope issue, continue to next candidate.
        } catch (e) {
          console.log(`[GoogleAuth/Sheets] Probe error for ${candidate.label}:`, e);
        }
      }
      return null;
    } catch (e) {
      console.error('[GoogleAuth/Sheets] getGoogleAccessTokenForSheets error:', e);
      return null;
    }
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

  // Diagnostic endpoint: per-token scope inspection. Lists ALL Google tokens stored
  // for this org and probes each against both tokeninfo and the Sheets API.
  app.get('/api/debug/google-token', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const report: any[] = [];
      const probeSpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

      const probeToken = async (label: string, token: string) => {
        const entry: any = { label, tokenPrefix: token.slice(0, 12) + '...' };
        try {
          const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
          if (ti.ok) {
            const info = await ti.json() as any;
            entry.email = info.email || null;
            entry.scopes = info.scope || '';
            entry.tokenInfoHasSpreadsheets = (info.scope || '').includes('spreadsheets');
          } else {
            entry.tokenInfoStatus = ti.status;
            entry.tokenInfoBody = (await ti.text()).slice(0, 200);
          }
        } catch (e) { entry.tokenInfoError = String(e); }
        try {
          const probe = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${probeSpreadsheetId}?fields=spreadsheetId`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          entry.sheetsApiStatus = probe.status;
          entry.sheetsApiWorks = probe.ok;
          if (!probe.ok) entry.sheetsApiBody = (await probe.text()).slice(0, 200);
        } catch (e) { entry.sheetsApiError = String(e); }
        return entry;
      };

      if (settings.gmail_access_token) report.push(await probeToken('org-level', settings.gmail_access_token));
      const senderKeys = Object.keys(settings).filter(k => k.startsWith('gmail_sender_') && k.endsWith('_access_token'));
      for (const k of senderKeys) {
        const email = k.replace('gmail_sender_', '').replace('_access_token', '');
        if (settings[k]) report.push(await probeToken(`sender:${email}`, settings[k]));
      }

      const workingToken = await getGoogleAccessTokenForSheets(req.user.organizationId);
      return res.json({
        organizationId: req.user.organizationId,
        candidateCount: report.length,
        sheetsCapableTokenFound: !!workingToken,
        tokens: report,
      });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  // Helper: try each stored Gmail token directly against a specific spreadsheet ID.
  // Used as a fallback when the fixed-probe approach in getGoogleAccessTokenForSheets
  // fails — sometimes the public probe sheet is unreachable even when the user's own
  // sheet is fully accessible. Returns a structured outcome so the caller can give an
  // accurate user-facing error instead of a generic "permission denied" loop.
  type DirectSheetsOutcome =
    | { kind: 'success'; tokenLabel: string; accessToken: string; title: string; sheets: Array<{ id: number; name: string; index: number }> }
    | { kind: 'sheet_not_in_account' }     // every token returned 404 — sheet not owned/shared with any of them
    | { kind: 'no_sheets_scope' }          // every token returned 403 with insufficient_scope
    | { kind: 'no_tokens' }                // org has zero Google tokens stored
    | { kind: 'unknown' };                 // mixed/other failures — caller should fall through to public CSV
  async function tryDirectSheetsAccess(organizationId: string, spreadsheetId: string): Promise<DirectSheetsOutcome> {
    const settings = await storage.getApiSettings(organizationId);

    type Cand = { accessToken: string; refreshToken: string; tokenExpiry: string; label: string; expiryKey: string; tokenKey: string };
    const candidates: Cand[] = [];
    const seen = new Set<string>();
    const push = (c: Cand) => {
      const k = c.refreshToken || c.accessToken;
      if (!k || seen.has(k)) return;
      seen.add(k);
      candidates.push(c);
    };
    if (settings.gmail_access_token && settings.gmail_refresh_token) {
      push({
        accessToken: settings.gmail_access_token,
        refreshToken: settings.gmail_refresh_token,
        tokenExpiry: settings.gmail_token_expiry || '0',
        label: 'org-level',
        expiryKey: 'gmail_token_expiry',
        tokenKey: 'gmail_access_token',
      });
    }
    for (const k of Object.keys(settings)) {
      if (!k.startsWith('gmail_sender_') || !k.endsWith('_access_token')) continue;
      const email = k.replace('gmail_sender_', '').replace('_access_token', '');
      const sa = settings[k];
      const sr = settings[`gmail_sender_${email}_refresh_token`];
      if (sa && sr) {
        push({
          accessToken: sa,
          refreshToken: sr,
          tokenExpiry: settings[`gmail_sender_${email}_token_expiry`] || '0',
          label: `sender:${email}`,
          expiryKey: `gmail_sender_${email}_token_expiry`,
          tokenKey: `gmail_sender_${email}_access_token`,
        });
      }
    }
    if (candidates.length === 0) return { kind: 'no_tokens' };

    let cid = settings.google_oauth_client_id || '';
    let csec = settings.google_oauth_client_secret || '';
    if (!cid || !csec) {
      try {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId && superAdminOrgId !== organizationId) {
          const ss = await storage.getApiSettings(superAdminOrgId);
          if (ss.google_oauth_client_id) { cid = ss.google_oauth_client_id; csec = ss.google_oauth_client_secret || ''; }
        }
      } catch {}
    }
    if (!cid) cid = process.env.GOOGLE_CLIENT_ID || '';
    if (!csec) csec = process.env.GOOGLE_CLIENT_SECRET || '';

    candidates.sort((a, b) => parseInt(b.tokenExpiry || '0') - parseInt(a.tokenExpiry || '0'));

    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`;
    let saw404 = false;
    let saw403Scope = false;

    for (const c of candidates) {
      let token: string | null = c.accessToken;
      const expired = c.tokenExpiry && Date.now() > parseInt(c.tokenExpiry) - 5 * 60 * 1000;
      if (expired && cid && csec) {
        try {
          const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
          });
          if (r.ok) {
            const td = await r.json() as any;
            if (td.access_token) {
              token = td.access_token;
              await storage.setApiSetting(organizationId, c.tokenKey, token!);
              if (td.expires_in) await storage.setApiSetting(organizationId, c.expiryKey, String(Date.now() + td.expires_in * 1000));
            }
          } else {
            console.log(`[tryDirectSheetsAccess] refresh failed for ${c.label}: ${r.status}`);
          }
        } catch (e) {
          console.log(`[tryDirectSheetsAccess] refresh error for ${c.label}:`, e instanceof Error ? e.message : e);
        }
      }
      if (!token) continue;

      try {
        const apiRes = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (apiRes.ok) {
          const data = await apiRes.json() as any;
          const sheets = (data.sheets || []).map((s: any) => ({
            id: s.properties?.sheetId ?? 0,
            name: s.properties?.title || 'Sheet1',
            index: s.properties?.index ?? 0,
          }));
          return { kind: 'success', tokenLabel: c.label, accessToken: token!, title: data.properties?.title || 'Google Spreadsheet', sheets };
        }
        const errText = await apiRes.text();
        if (apiRes.status === 404) saw404 = true;
        else if (apiRes.status === 403) {
          if (errText.includes('insufficient') || errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || errText.includes('Request had insufficient authentication scopes')) {
            saw403Scope = true;
          }
        }
        console.log(`[tryDirectSheetsAccess] ${c.label} status=${apiRes.status} ${errText.slice(0, 120)}`);
      } catch (e) {
        console.log(`[tryDirectSheetsAccess] fetch error for ${c.label}:`, e instanceof Error ? e.message : e);
      }
    }

    // Pick the most actionable outcome. Scope-missing wins over 404 because the user
    // can fix scope themselves; 404-everywhere means we know they need to share publicly.
    console.log(`[tryDirectSheetsAccess] outcome decision: candidates=${candidates.length}, saw404=${saw404}, saw403Scope=${saw403Scope}`);
    if (saw403Scope && !saw404) return { kind: 'no_sheets_scope' };
    if (saw404 && !saw403Scope) return { kind: 'sheet_not_in_account' };
    if (saw404 && saw403Scope) return { kind: 'no_sheets_scope' }; // prefer the actionable one
    // No candidate produced a clear 404 or scope error. This usually means tokens
    // failed in some other way (refresh failure, generic 403, network error, etc.).
    // The most likely real-world cause is still that the sheet is not in the user's
    // account — return that outcome by default so the user gets a clear actionable
    // message instead of a vague "connect Gmail" loop. Worst case if we're wrong:
    // they share publicly and the public-CSV strategy succeeds; or they connect the
    // right account and Strategy 1/1.5 succeeds next time.
    if (candidates.length > 0) return { kind: 'sheet_not_in_account' };
    return { kind: 'unknown' };
  }

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

      // Strategy 1: try each stored Gmail token directly against the user's actual sheet.
      // The previous "probe-based" strategy validated tokens against a fixed test sheet and
      // returned the first one that worked — but a token passing the probe doesn't mean it
      // can read the USER's sheet (different sheets, different ACL). When the probe-validated
      // token didn't own the user's sheet, the API returned 403 PERMISSION_DENIED and the
      // code fell through to public-CSV, which then failed with a misleading error.
      //
      // tryDirectSheetsAccess iterates ALL stored tokens and returns the first that gets a
      // 200 from the user's actual sheet. This is the right primary strategy — and gives
      // accurate error messages when no token works (sheet_not_in_account / no_sheets_scope).
      const accessToken: string | null = null; // kept declared so the fallback messages later still typecheck
      const directRes = await tryDirectSheetsAccess(req.user.organizationId, spreadsheetId);
      if (directRes.kind === 'success') {
        console.log('[sheets/fetch-info] Strategy 1 succeeded via', directRes.tokenLabel);
        return res.json({
          id: spreadsheetId,
          title: directRes.title,
          sheets: directRes.sheets,
          valid: true,
          method: 'oauth-direct',
        });
      }
      if (directRes.kind === 'sheet_not_in_account') {
        return res.json({
          valid: false,
          error: 'This spreadsheet is not in any of your connected Google accounts. To import, share the sheet with "Anyone with the link" — or open it from the account that owns it.',
        });
      }
      if (directRes.kind === 'no_sheets_scope') {
        return res.json({
          valid: false,
          error: 'Google Sheets access not yet granted on your Gmail token. Click below to grant Sheets access — Google will show only the missing permission on the consent screen.',
          needsReauth: true,
        });
      }
      // directRes.kind === 'no_tokens' or 'unknown' → fall through to public CSV
      console.log('[sheets/fetch-info] Strategy 1 outcome:', directRes.kind, '— falling through to public CSV');

      // Strategy 2: Fallback to public CSV export (for publicly shared sheets)
      const sheets: { id: number; name: string; index: number }[] = [];

      const testCsvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      console.log('[sheets/fetch-info] Trying public CSV access:', testCsvUrl);
      
      const testRes = await fetch(testCsvUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        redirect: 'follow',
      });

      if (!testRes.ok) {
        // The user may already have connected Gmail (Strategy 1 / 1.5 above) but
        // the sheet isn't owned by any of those accounts AND isn't publicly shared.
        // Asking them to "connect Gmail" here is misleading — what they actually need
        // to do is either share the sheet publicly or connect the owning account.
        // (Strategy 1.5 already returns the explicit "sheet_not_in_account" message
        // when it can prove this; this branch fires when the diagnosis is ambiguous.)
        console.log(`[sheets/fetch-info] FALLBACK FAILURE — public CSV returned ${testRes.status}, no OAuth match found. accessToken probe-validated: ${!!accessToken}`);
        return res.status(400).json({
          valid: false,
          error: 'Could not access this spreadsheet. Either (a) share the sheet with "Anyone with the link" in Google Sheets, OR (b) sign in with the Google account that owns this sheet (Email Accounts > Connect Google Sheets).',
          needsAuth: !accessToken,
        });
      }

      const testCsv = await testRes.text();
      if (testCsv.trim().startsWith('<!DOCTYPE') || testCsv.trim().startsWith('<html')) {
        console.log(`[sheets/fetch-info] FALLBACK FAILURE — public CSV returned an HTML login page (sheet is private). accessToken probe-validated: ${!!accessToken}`);
        return res.status(400).json({
          valid: false,
          error: 'This spreadsheet is private. Either (a) share the sheet with "Anyone with the link" in Google Sheets, OR (b) sign in with the Google account that owns this sheet (Email Accounts > Connect Google Sheets).',
          needsAuth: !accessToken,
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

      // Strategy 1: find the Google token that actually owns/can-read THIS spreadsheet
      // (via tryDirectSheetsAccess — iterates all stored tokens, first 200 wins). This is
      // the same fix applied to /api/sheets/fetch-info — the previous probe-based approach
      // picked a token that could read a public test sheet but not necessarily this one.
      const directRes = await tryDirectSheetsAccess(req.user.organizationId, spreadsheetId);
      const accessToken = directRes.kind === 'success' ? directRes.accessToken : null;
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
              console.log('[sheets/fetch-data] Google Sheets API success via', directRes.kind === 'success' ? directRes.tokenLabel : '(no label)', ':', headers.length, 'cols,', dataRows.length, 'rows');
            }
          } else {
            const errText = await apiRes.text();
            console.log('[sheets/fetch-data] Sheets API returned', apiRes.status, '- falling back to CSV. Error:', errText.slice(0, 200));
          }
        } catch (apiErr) {
          console.log('[sheets/fetch-data] Sheets API error, falling back to CSV:', apiErr);
        }
      } else {
        console.log('[sheets/fetch-data] No working OAuth token for this sheet (tryDirectSheetsAccess outcome:', directRes.kind, ')');
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

      let messages: any[];
      let total: number;
      let unread: number;

      if (isAdmin) {
        // Admin sees all org messages; can filter by specific account
        const filters = { status, emailAccountId, campaignId };
        messages = await storage.getInboxMessages(req.user.organizationId, filters, parsedLimit, parsedOffset);
        total = await storage.getInboxMessageCount(req.user.organizationId, { status, emailAccountId });
        unread = await storage.getInboxUnreadCount(req.user.organizationId);
      } else {
        // Member: get their linked email account IDs
        const userAccounts = await storage.getEmailAccountsForUser(req.user.organizationId, req.user.id);
        const userAccountIds = userAccounts.map((a: any) => a.id);
        
        if (userAccountIds.length === 0) {
          // No linked accounts — return empty
          return res.json({ messages: [], total: 0, unread: 0 });
        }

        // If member selected a specific account, use that; otherwise use all their accounts
        let filterAccountIds: string;
        if (emailAccountId && emailAccountId !== 'all') {
          // Verify member owns this account
          if (userAccountIds.includes(emailAccountId)) {
            filterAccountIds = emailAccountId;
          } else {
            return res.json({ messages: [], total: 0, unread: 0 });
          }
        } else {
          filterAccountIds = userAccountIds.join(',');
        }

        const filters = { status, emailAccountId: filterAccountIds, campaignId };
        messages = await storage.getInboxMessages(req.user.organizationId, filters, parsedLimit, parsedOffset);
        total = await storage.getInboxMessageCount(req.user.organizationId, { status, emailAccountId: filterAccountIds });
        unread = await storage.getInboxUnreadCount(req.user.organizationId, filterAccountIds);
      }

      // Enrich messages with contact info
      const enriched = await Promise.all(messages.map(async (m: any) => {
        let contact = null;
        if (m.contactId) {
          contact = await storage.getContact(m.contactId);
        }
        // Try to find contact by email if not linked
        if (!contact && m.fromEmail) {
          contact = await storage.getContactByEmail(req.user.organizationId, m.fromEmail);
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
      let count: number;
      if (isAdmin) {
        count = await storage.getInboxUnreadCount(req.user.organizationId);
      } else {
        // Member: count unread only for their linked accounts
        const userAccounts = await storage.getEmailAccountsForUser(req.user.organizationId, req.user.id);
        const accountIds = userAccounts.map((a: any) => a.id);
        count = accountIds.length > 0
          ? await storage.getInboxUnreadCount(req.user.organizationId, accountIds.join(','))
          : 0;
      }
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
      const results: any = { gmail: null, outlook: null, warnings: [] as string[] };

      const settings = await storage.getApiSettings(orgId);

      // CRITICAL: Check BOTH org-level AND per-sender tokens
      if (orgHasGmailTokens(settings)) {
        results.gmail = await gmailReplyTracker.checkForReplies(orgId, lookbackMinutes);
      } else {
        results.warnings.push('No Gmail OAuth tokens found. Gmail bounce detection is disabled.');
      }
      if (orgHasOutlookTokens(settings)) {
        results.outlook = await outlookReplyTracker.checkForReplies(orgId, lookbackMinutes);
      } else {
        // Check if there are Outlook email accounts that need OAuth
        const emailAccounts = await storage.getEmailAccounts(orgId);
        const outlookAccounts = emailAccounts.filter((a: any) => a.provider === 'outlook' || a.provider === 'microsoft');
        if (outlookAccounts.length > 0) {
          results.warnings.push(`${outlookAccounts.length} Outlook account(s) found but no OAuth tokens. Re-authenticate these accounts to enable Outlook bounce detection: ${outlookAccounts.map((a: any) => a.email).join(', ')}`);
        }
      }

      // Auto-sync bounce status to contacts after every inbox sync
      try {
        const failedMessages = await storage.getBouncedMessagesWithContacts(orgId);
        const bounceEvents = await storage.getBounceEventsWithContacts(orgId);
        let bouncesSynced = 0;
        const seen = new Set<string>();
        for (const msg of [...(failedMessages as any[]), ...(bounceEvents as any[])]) {
          if (!msg.contactId || seen.has(msg.contactId)) continue;
          seen.add(msg.contactId);
          if (msg.contactStatus && msg.contactStatus !== 'bounced') {
            try {
              await storage.updateContact(msg.contactId, { status: 'bounced' });
              bouncesSynced++;
            } catch (e) { /* ignore */ }
          }
        }
        if (bouncesSynced > 0) {
          console.log(`[InboxSync] Auto-synced ${bouncesSynced} bounced contacts`);
        }
        results.bouncesSynced = bouncesSynced;
      } catch (e) {
        console.error('[InboxSync] Bounce sync error:', e);
      }

      // Auto-backfill emailAccountId on messages that have null (for member inbox to work)
      try {
        const nullAccountMsgs = await storage.getInboxMessagesWithNullAccount(orgId, 200);
        if (nullAccountMsgs.length > 0) {
          const emailAccounts = await storage.getEmailAccounts(orgId);
          const emailToAccountId = new Map<string, string>();
          for (const ea of emailAccounts as any[]) {
            if (ea.email) emailToAccountId.set(ea.email.toLowerCase(), ea.id);
          }
          let backfilled = 0;
          for (const inboxMsg of nullAccountMsgs as any[]) {
            let emailAccountId: string | null = null;
            if (inboxMsg.messageId) {
              try {
                const campaignMsg = await storage.getCampaignMessage(inboxMsg.messageId);
                if (campaignMsg && (campaignMsg as any).emailAccountId) emailAccountId = (campaignMsg as any).emailAccountId;
              } catch (e) {}
            }
            if (!emailAccountId && inboxMsg.toEmail) {
              const toEmail = inboxMsg.toEmail.toLowerCase().replace(/<.*?>/, '').replace(/.*</, '').replace(/>.*/, '').trim();
              emailAccountId = emailToAccountId.get(toEmail) || null;
            }
            if (emailAccountId) {
              await storage.backfillInboxEmailAccountId(inboxMsg.id, emailAccountId);
              backfilled++;
            }
          }
          if (backfilled > 0) {
            console.log(`[InboxSync] Auto-backfilled emailAccountId on ${backfilled}/${nullAccountMsgs.length} inbox messages`);
          }
          results.backfilled = backfilled;
        }
      } catch (e) {
        console.error('[InboxSync] Backfill error:', e);
      }

      // Auto-recalculate campaign stats for all active/completed campaigns in this org
      // This ensures bounce counts, open counts, reply counts are always accurate
      try {
        const campaigns = await storage.getCampaigns(orgId, 1000, 0);
        let recalculated = 0;
        for (const c of campaigns as any[]) {
          if (c.status === 'draft') continue; // Skip drafts
          try {
            const msgs = await storage.getCampaignMessagesEnriched(c.id, 100000, 0);
            if (msgs.length === 0) continue;
            const sentCount = msgs.filter((m: any) => m.status === 'sent' || m.status === 'sending').length;
            const bouncedCount = msgs.filter((m: any) => m.status === 'bounced' || (m.status === 'failed' && m.errorMessage && m.errorMessage.toLowerCase().includes('bounce'))).length;
            const openedCount = msgs.filter((m: any) => m.openedAt).length;
            const clickedCount = msgs.filter((m: any) => m.clickedAt).length;
            const repliedCount = msgs.filter((m: any) => m.repliedAt).length;
            const step0Sent = msgs.filter((m: any) => (m.stepNumber || 0) === 0 && (m.status === 'sent' || m.status === 'sending')).length;
            const step0Bounced = msgs.filter((m: any) => (m.stepNumber || 0) === 0 && (m.status === 'bounced' || (m.status === 'failed' && m.errorMessage?.toLowerCase().includes('bounce')))).length;
            const inboxAudienceSize = Array.isArray(c.contactIds) ? c.contactIds.length : 0;
            const inboxStep0Floor = Math.max(step0Sent + step0Bounced, inboxAudienceSize) || (sentCount + bouncedCount);

            // Only update if values changed
            if (sentCount !== (c.sentCount || 0) || bouncedCount !== (c.bouncedCount || 0) ||
                openedCount !== (c.openedCount || 0) || clickedCount !== (c.clickedCount || 0) ||
                repliedCount !== (c.repliedCount || 0)) {
              await storage.updateCampaign(c.id, {
                sentCount, bouncedCount, openedCount, clickedCount, repliedCount,
                totalRecipients: inboxStep0Floor,
              });
              recalculated++;
            }
          } catch (e) { /* skip per-campaign errors */ }
        }
        if (recalculated > 0) {
          console.log(`[InboxSync] Auto-recalculated stats for ${recalculated} campaigns`);
        }
        results.campaignsRecalculated = recalculated;
      } catch (e) {
        console.error('[InboxSync] Campaign recalculation error:', e);
      }

      // v13: Auto-classify new unclassified inbox messages (rule-based + AI for borderline)
      try {
        const unclassified = await storage.getInboxMessagesEnhanced(orgId, { replyType: '' }, 100, 0) as any[];
        let autoClassified = 0;
        for (const msg of unclassified) {
          if (msg.replyType && msg.replyType !== '') continue;
          if (msg.sentByUs) continue; // Don't classify our own sent messages
          let result = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);

          // For 'general' low-confidence results, use AI to reclassify (catches missed auto-replies/OOO)
          if (result.replyType === 'general' && result.confidence <= 0.5) {
            try {
              const aiResult = await classifyReplyWithAI(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, orgId, storage);
              if (aiResult.confidence >= 0.7) {
                result = aiResult; // AI is confident — use its classification
                console.log(`[InboxSync] AI reclassified ${msg.fromEmail}: general → ${aiResult.replyType}`);
              }
            } catch (aiErr: any) {
              console.error('[InboxSync] AI classify error:', aiErr.message);
            }
          }

          await storage.classifyReply(msg.id, result.replyType);
          if (result.bounceType) await storage.setBounceType(msg.id, result.bounceType);
          // Auto-actions based on classification
          if (msg.contactId) {
            if (result.replyType === 'bounce' && result.bounceType) {
              await storage.markContactBounced(msg.contactId, result.bounceType);
            } else if (result.replyType === 'unsubscribe') {
              await storage.markContactUnsubscribed(msg.contactId, msg.campaignId);
            } else if (result.replyType === 'positive') {
              await storage.updateContactLeadStatus(msg.contactId, 'interested');
            }
            // Only notify for actual human replies (not OOO/auto_reply/bounce)
            if (isHumanReply(result.replyType)) {
              await storage.createNotification(orgId, {
                type: 'reply',
                title: `New ${result.replyType} reply from ${msg.fromName || msg.fromEmail}`,
                message: msg.snippet?.substring(0, 150),
                linkUrl: `/inbox?id=${msg.id}`,
                metadata: { inboxMessageId: msg.id, replyType: result.replyType },
              });
            }
          }
          autoClassified++;
        }
        if (autoClassified > 0) {
          console.log(`[InboxSync] Auto-classified ${autoClassified} inbox messages`);
        }
        results.autoClassified = autoClassified;
      } catch (e) {
        console.error('[InboxSync] Auto-classify error:', e);
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
          connected: orgHasGmailTokens(settings),
          email: settings.gmail_email || null,
          ...gmailStatus,
        },
        outlook: {
          connected: orgHasOutlookTokens(settings),
          email: settings.microsoft_user_email || null,
          ...outlookStatus,
        },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get sync status' });
    }
  });

  // Backfill emailAccountId on existing inbox messages that have null
  // This repairs data from before the fix where emailAccountId wasn't set
  // MUST be before /:id routes
  app.post('/api/inbox/backfill-accounts', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      // Get all inbox messages for this org
      const allMessages = await storage.getInboxMessages(orgId, {}, 10000, 0);
      const emailAccounts = await storage.getEmailAccounts(orgId);
      
      // Build email -> accountId lookup
      const emailToAccountId = new Map<string, string>();
      for (const ea of emailAccounts as any[]) {
        if (ea.email) emailToAccountId.set(ea.email.toLowerCase(), ea.id);
      }
      
      let fixed = 0;
      let total = 0;
      for (const inboxMsg of allMessages as any[]) {
        if (inboxMsg.emailAccountId) continue; // Already has account
        total++;
        
        let emailAccountId: string | null = null;
        
        // Try to get emailAccountId from the linked campaign message
        if (inboxMsg.messageId) {
          try {
            const campaignMsg = await storage.getCampaignMessage(inboxMsg.messageId);
            if (campaignMsg && (campaignMsg as any).emailAccountId) {
              emailAccountId = (campaignMsg as any).emailAccountId;
            }
          } catch (e) {}
        }
        
        // Fallback: match toEmail against email_accounts
        if (!emailAccountId && inboxMsg.toEmail) {
          const toEmail = inboxMsg.toEmail.toLowerCase().replace(/<.*?>/, '').replace(/.*</, '').replace(/>.*/, '').trim();
          const matchedId = emailToAccountId.get(toEmail);
          if (matchedId) emailAccountId = matchedId;
        }
        
        if (emailAccountId) {
          await storage.backfillInboxEmailAccountId(inboxMsg.id, emailAccountId);
          fixed++;
        }
      }
      
      console.log(`[Inbox Backfill] Fixed ${fixed}/${total} messages with null emailAccountId`);
      res.json({ success: true, needsFix: total, fixed });
    } catch (error) {
      console.error('Inbox backfill error:', error);
      res.status(500).json({ message: 'Failed to backfill inbox accounts' });
    }
  });

  // ========== v12: ENHANCED INBOX API ==========
  // NOTE: These routes MUST be registered before /api/inbox/:id to avoid Express treating "enhanced"/"stats" as an :id param

  // Enhanced inbox with all new filters (replaces base inbox for frontend)
  app.get('/api/inbox/enhanced', requireAuth, async (req: any, res) => {
    try {
      const { status, emailAccountId, campaignId, replyType, bounceType, leadStatus, assignedTo, isStarred, search, limit, offset, viewMode } = req.query;
      const role = req.user.role;
      const isAdmin = role === 'owner' || role === 'admin';
      const parsedLimit = parseInt(limit as string) || 50;
      const parsedOffset = parseInt(offset as string) || 0;

      const filters: any = { status, emailAccountId, campaignId, replyType, bounceType, leadStatus, search, viewMode };
      if (isStarred === 'true') filters.isStarred = true;

      // Member filter (admin selects a team member from dropdown): resolve userId -> that user's email account IDs.
      // Note: assignedTo on unified_inbox is for manual reply-assignment and is rarely populated, so don't filter on it here.
      if (isAdmin && assignedTo && assignedTo !== 'all' && assignedTo !== 'unassigned') {
        const memberAccounts = await storage.getEmailAccountsForUser(req.user.organizationId, String(assignedTo));
        const memberAccountIds = memberAccounts.map((a: any) => a.id);
        if (memberAccountIds.length === 0) return res.json({ messages: [], total: 0, unread: 0, stats: {} });
        if (!emailAccountId || emailAccountId === 'all') {
          filters.emailAccountId = memberAccountIds.join(',');
        } else {
          // Intersect chosen account with member's accounts
          const chosen = String(emailAccountId).split(',').filter(Boolean);
          const intersect = chosen.filter(id => memberAccountIds.includes(id));
          if (intersect.length === 0) return res.json({ messages: [], total: 0, unread: 0, stats: {} });
          filters.emailAccountId = intersect.join(',');
        }
      }

      if (!isAdmin) {
        const userAccounts = await storage.getEmailAccountsForUser(req.user.organizationId, req.user.id);
        const userAccountIds = userAccounts.map((a: any) => a.id);
        if (userAccountIds.length === 0) return res.json({ messages: [], total: 0, unread: 0, stats: {} });
        if (!emailAccountId || emailAccountId === 'all') {
          filters.emailAccountId = userAccountIds.join(',');
        }
      }

      const messages = await storage.getInboxMessagesEnhanced(req.user.organizationId, filters, parsedLimit, parsedOffset);
      const total = await storage.getInboxMessageCountEnhanced(req.user.organizationId, filters);
      // Scope stats to member's own accounts (non-admin) or to selected member's accounts (admin with member filter)
      const memberFilterActive = isAdmin && assignedTo && assignedTo !== 'all' && assignedTo !== 'unassigned';
      const statsAccountIds = (!isAdmin || memberFilterActive) && filters.emailAccountId
        ? String(filters.emailAccountId).split(',').filter(Boolean)
        : undefined;
      const stats = await storage.getInboxStats(req.user.organizationId, statsAccountIds);
      const unread = stats.unread;

      // Enrich messages (individual try/catch to prevent one bad message from crashing the whole endpoint)
      const enriched = await Promise.all(messages.map(async (m: any) => {
        try {
          let contact = null;
          if (m.contactId) contact = await storage.getContact(m.contactId);
          if (!contact && m.fromEmail) contact = await storage.getContactByEmail(req.user.organizationId, m.fromEmail);
          let accountOwner = null;
          if (isAdmin && m.emailAccountId) {
            const acct = await storage.getEmailAccount(m.emailAccountId);
            if (acct && (acct as any).userId) {
              const owner = await storage.getUser((acct as any).userId);
              if (owner) accountOwner = { id: owner.id, email: owner.email, firstName: (owner as any).firstName, lastName: (owner as any).lastName };
            }
          }
          let campaign = null;
          if (m.campaignId) campaign = await storage.getCampaign(m.campaignId);
          return {
            ...m,
            contact: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, company: contact.company, jobTitle: contact.jobTitle, status: contact.status, score: contact.score, leadStatus: (contact as any).leadStatus } : null,
            campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
            accountOwner,
          };
        } catch (enrichErr) {
          console.error(`[Enhanced Inbox] Failed to enrich message ${m.id}:`, enrichErr);
          return { ...m, contact: null, campaign: null, accountOwner: null };
        }
      }));

      res.json({ messages: enriched, total, unread, stats });
    } catch (error) {
      console.error('Enhanced inbox error:', error);
      res.status(500).json({ message: 'Failed to fetch enhanced inbox' });
    }
  });

  // Get inbox stats
  app.get('/api/inbox/stats', requireAuth, async (req: any, res) => {
    try {
      const role = req.user.role;
      const isAdmin = role === 'owner' || role === 'admin';
      let accountIds: string[] | undefined;
      if (!isAdmin) {
        const userAccounts = await storage.getEmailAccountsForUser(req.user.organizationId, req.user.id);
        accountIds = userAccounts.map((a: any) => a.id);
        if (accountIds.length === 0) return res.json({ total: 0, unread: 0, replied: 0, archived: 0, positive: 0, negative: 0, ooo: 0, autoReply: 0, bounced: 0, starred: 0, warmup: 0, notReplied: 0 });
      }
      const stats = await storage.getInboxStats(req.user.organizationId, accountIds);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch inbox stats' });
    }
  });

  // Score unscored human-reply inbox messages with Azure OpenAI (fire-and-forget)
  app.post('/api/inbox/score-replies', requireAuth, async (req: any, res) => {
    try {
      const { batchScoreOrgReplies } = await import('./services/reply-quality-engine');
      const limit = parseInt(req.body?.limit) || 100;
      res.json({ status: 'started', limit });
      // Fire-and-forget after responding
      setImmediate(() => {
        batchScoreOrgReplies(req.user.organizationId, limit).catch((e: any) =>
          console.error('[ReplyQuality] batch error:', e instanceof Error ? e.message : e)
        );
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to start reply scoring' });
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
      if (!contact && (msg as any).fromEmail) contact = await storage.getContactByEmail(req.user.organizationId, (msg as any).fromEmail);

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

  // Confirm AI-suggested Won — flips contact pipelineStage to 'won' and dismisses nudge
  app.post('/api/inbox/:id/confirm-won', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { dealValue, dealNotes } = req.body || {};
      const msg = await storage.getInboxMessage(req.params.id);
      if (!msg || (msg as any).organizationId !== orgId) return res.status(404).json({ message: 'Not found' });
      const contactId = (msg as any).contactId;
      if (contactId) {
        await storage.rawRun(
          `UPDATE contacts SET "pipelineStage" = 'won', "dealValue" = COALESCE(?, "dealValue"), "dealNotes" = COALESCE(?, "dealNotes"), "dealClosedAt" = ? WHERE id = ? AND "organizationId" = ?`,
          dealValue ?? null, dealNotes ?? null, new Date().toISOString(), contactId, orgId
        );
      }
      await storage.rawRun(`UPDATE unified_inbox SET "aiSuggestedWon" = FALSE WHERE id = ?`, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[confirm-won]', e);
      res.status(500).json({ message: 'Failed to confirm Won' });
    }
  });

  // Confirm AI-suggested Meeting — logs a contact_activities row of type='meeting' and dismisses nudge
  app.post('/api/inbox/:id/confirm-meeting', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const msg = await storage.getInboxMessage(req.params.id);
      if (!msg || (msg as any).organizationId !== orgId) return res.status(404).json({ message: 'Not found' });
      const contactId = (msg as any).contactId;
      if (contactId) {
        try {
          await (storage as any).createContactActivity({
            contactId,
            organizationId: orgId,
            userId,
            type: 'meeting',
            outcome: 'scheduled',
            notes: `Confirmed from inbox nudge: ${(msg as any).subject || ''}`,
          });
        } catch { /* fallback: direct insert */ }
      }
      await storage.rawRun(`UPDATE unified_inbox SET "aiSuggestedMeeting" = FALSE WHERE id = ?`, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error('[confirm-meeting]', e);
      res.status(500).json({ message: 'Failed to confirm meeting' });
    }
  });

  // Dismiss a nudge without acting on it
  app.post('/api/inbox/:id/dismiss-nudge', requireAuth, async (req: any, res) => {
    try {
      await storage.rawRun(`UPDATE unified_inbox SET "aiSuggestedWon" = FALSE, "aiSuggestedMeeting" = FALSE WHERE id = ?`, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: 'Failed to dismiss' });
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
        // Send reply via Gmail API with token refresh
        const senderEmail = msg.toEmail || settings.gmail_email || '';
        const senderPrefix = `gmail_sender_${senderEmail}_`;
        let accessToken = settings[`${senderPrefix}access_token`] || settings.gmail_access_token;
        const refreshToken = settings[`${senderPrefix}refresh_token`] || settings.gmail_refresh_token;
        if (!accessToken && !refreshToken) return res.status(400).json({ message: 'Gmail not connected. Please re-authenticate.' });

        const rawMessage = createRawEmail({
          from: senderEmail,
          to: msg.fromEmail,
          subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
          body: replyBody,
          inReplyTo: msg.gmailMessageId ? `<${msg.gmailMessageId}>` : undefined,
          threadId: msg.gmailThreadId,
        });

        let sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: rawMessage, threadId: msg.gmailThreadId }),
        });

        // 401 → refresh token and retry once
        if (sendResp.status === 401 && refreshToken) {
          console.log('[Inbox Reply] Gmail 401, refreshing token...');
          let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
          let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
          if (!clientId || !clientSecret) {
            try {
              const superAdminOrgId = await storage.getSuperAdminOrgId();
              if (superAdminOrgId) {
                const ss = await storage.getApiSettings(superAdminOrgId);
                if (ss.google_oauth_client_id) { clientId = ss.google_oauth_client_id; clientSecret = ss.google_oauth_client_secret || ''; }
              }
            } catch (e) { /* ignore */ }
          }
          if (clientId && clientSecret) {
            try {
              const oauth2 = createOAuth2Client({ clientId, clientSecret, redirectUri: '' });
              oauth2.setCredentials({ refresh_token: refreshToken });
              const { credentials } = await oauth2.refreshAccessToken();
              if (credentials.access_token) {
                accessToken = credentials.access_token;
                // Save refreshed token
                if (settings[`${senderPrefix}refresh_token`]) {
                  await storage.setApiSetting(req.user.organizationId, `${senderPrefix}access_token`, accessToken);
                  if (credentials.expiry_date) await storage.setApiSetting(req.user.organizationId, `${senderPrefix}token_expiry`, String(credentials.expiry_date));
                } else {
                  await storage.setApiSetting(req.user.organizationId, 'gmail_access_token', accessToken);
                  if (credentials.expiry_date) await storage.setApiSetting(req.user.organizationId, 'gmail_token_expiry', String(credentials.expiry_date));
                }
                // Retry send
                sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw: rawMessage, threadId: msg.gmailThreadId }),
                });
              }
            } catch (refreshErr) {
              console.error('[Inbox Reply] Gmail token refresh failed:', refreshErr);
            }
          }
        }

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
        // Send reply via Microsoft Graph with token refresh
        const senderEmail = msg.toEmail || settings.microsoft_user_email || '';
        const outlookPrefix = `outlook_sender_${senderEmail}_`;
        let accessToken = settings[`${outlookPrefix}access_token`] || settings.microsoft_access_token;
        const refreshToken = settings[`${outlookPrefix}refresh_token`] || settings.microsoft_refresh_token;
        if (!accessToken && !refreshToken) return res.status(400).json({ message: 'Outlook not connected. Please re-authenticate.' });

        // If no outlookMessageId, fall back to sendMail instead of /reply endpoint
        const useReplyEndpoint = !!msg.outlookMessageId;
        let replyResp = useReplyEndpoint
          ? await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.outlookMessageId}/reply`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment: replyBody }),
            })
          : await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: {
                  subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
                  body: { contentType: 'HTML', content: replyBody },
                  toRecipients: [{ emailAddress: { address: msg.fromEmail } }],
                }
              }),
            });

        // 401 → refresh token and retry once
        if (replyResp.status === 401 && refreshToken) {
          console.log('[Inbox Reply] Outlook 401, refreshing token...');
          let clientId = settings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
          let clientSecret = settings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';
          if (!clientId || !clientSecret) {
            try {
              const superAdminOrgId = await storage.getSuperAdminOrgId();
              if (superAdminOrgId) {
                const ss = await storage.getApiSettings(superAdminOrgId);
                if (ss.microsoft_oauth_client_id) { clientId = ss.microsoft_oauth_client_id; clientSecret = ss.microsoft_oauth_client_secret || ''; }
              }
            } catch (e) { /* ignore */ }
          }
          if (clientId && clientSecret) {
            try {
              const body = new URLSearchParams({
                client_id: clientId, client_secret: clientSecret,
                refresh_token: refreshToken, grant_type: 'refresh_token',
                scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
              });
              const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
              });
              if (tokenResp.ok) {
                const tokens = await tokenResp.json() as any;
                if (tokens.access_token) {
                  accessToken = tokens.access_token;
                  const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
                  if (settings[`${outlookPrefix}refresh_token`]) {
                    await storage.setApiSetting(req.user.organizationId, `${outlookPrefix}access_token`, accessToken);
                    if (tokens.refresh_token) await storage.setApiSetting(req.user.organizationId, `${outlookPrefix}refresh_token`, tokens.refresh_token);
                    await storage.setApiSetting(req.user.organizationId, `${outlookPrefix}token_expiry`, String(exp));
                  } else {
                    await storage.setApiSetting(req.user.organizationId, 'microsoft_access_token', accessToken);
                    if (tokens.refresh_token) await storage.setApiSetting(req.user.organizationId, 'microsoft_refresh_token', tokens.refresh_token);
                    await storage.setApiSetting(req.user.organizationId, 'microsoft_token_expiry', String(exp));
                  }
                  // Retry send
                  replyResp = useReplyEndpoint
                    ? await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.outlookMessageId}/reply`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ comment: replyBody }),
                      })
                    : await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          message: {
                            subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
                            body: { contentType: 'HTML', content: replyBody },
                            toRecipients: [{ emailAddress: { address: msg.fromEmail } }],
                          }
                        }),
                      });
                }
              }
            } catch (refreshErr) {
              console.error('[Inbox Reply] Outlook token refresh failed:', refreshErr);
            }
          }
        }

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
          const replySenderEmail = senderEmail || settings.microsoft_user_email || msg.toEmail;
          const senderName = req.user.name || req.user.email || 'Me';
          await storage.createInboxMessage({
            organizationId: req.user.organizationId,
            emailAccountId: msg.emailAccountId,
            campaignId: msg.campaignId,
            messageId: msg.messageId,
            contactId: msg.contactId,
            outlookMessageId: null,
            fromEmail: replySenderEmail,
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
    } catch (error: any) {
      console.error('[Inbox Reply] Unexpected error:', error);
      res.status(500).json({ message: `Failed to send reply: ${error?.message || error}` });
    }
  });

  // Save reply draft
  app.put('/api/inbox/:id/draft', requireAuth, async (req: any, res) => {
    try {
      const { body: draftBody } = req.body;
      await storage.updateInboxMessage(req.params.id, { replyContent: draftBody || '' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save draft' });
    }
  });

  // Forward message with optional CC/BCC
  app.post('/api/inbox/:id/forward', requireAuth, async (req: any, res) => {
    try {
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });

      const { to, cc, bcc, body: fwdBody } = req.body;
      if (!to) return res.status(400).json({ message: 'To address is required' });

      const settings = await storage.getApiSettings(req.user.organizationId);
      const provider = msg.provider;
      const fwdSubject = msg.subject?.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`;
      const senderEmail = msg.toEmail || settings.gmail_email || '';

      // Build forwarded message body with full original email context
      const userNote = fwdBody ? fwdBody.replace(/\n/g, '<br>') : '';
      const originalBody = msg.bodyHtml || (msg.body || msg.snippet || '').replace(/\n/g, '<br>');
      const originalDate = msg.receivedAt ? new Date(msg.receivedAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const fullBody = `${userNote}${userNote ? '<br><br>' : ''}<div style="border-left: 3px solid #ccc; padding-left: 12px; color: #555; margin-top: 16px; font-family: Arial, sans-serif;">
<div style="font-size: 12px; color: #999; margin-bottom: 10px; font-style: italic;">---------- Forwarded message ----------</div>
<div style="font-size: 13px; margin-bottom: 4px;"><strong>From:</strong> ${msg.fromName ? `${msg.fromName} &lt;${msg.fromEmail}&gt;` : msg.fromEmail}</div>
<div style="font-size: 13px; margin-bottom: 4px;"><strong>Date:</strong> ${originalDate}</div>
<div style="font-size: 13px; margin-bottom: 4px;"><strong>Subject:</strong> ${msg.subject || '(no subject)'}</div>
<div style="font-size: 13px; margin-bottom: 10px;"><strong>To:</strong> ${msg.toEmail || senderEmail}</div>
<br>
<div style="font-size: 13px; line-height: 1.6;">${originalBody}</div>
</div>`;

      if (provider === 'gmail') {
        const senderPrefix = `gmail_sender_${senderEmail}_`;
        let accessToken = settings[`${senderPrefix}access_token`] || settings.gmail_access_token;
        const refreshToken = settings[`${senderPrefix}refresh_token`] || settings.gmail_refresh_token;
        if (!accessToken && !refreshToken) return res.status(400).json({ message: 'Gmail not connected.' });

        const rawMessage = createRawEmail({ from: senderEmail, to, cc, bcc, subject: fwdSubject, body: fullBody });

        let sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: rawMessage }),
        });

        if (sendResp.status === 401 && refreshToken) {
          let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
          let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
          try {
            const oauth2 = createOAuth2Client({ clientId, clientSecret, redirectUri: '' });
            oauth2.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await oauth2.refreshAccessToken();
            if (credentials.access_token) {
              accessToken = credentials.access_token;
              sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw: rawMessage }),
              });
            }
          } catch { /* ignore */ }
        }

        if (!sendResp.ok) {
          const errText = await sendResp.text();
          return res.status(500).json({ message: `Gmail forward failed: ${errText}` });
        }

        // Mark as forwarded
        await storage.updateInboxMessage(msg.id, {
          status: 'forwarded',
          forwardedAt: new Date().toISOString(),
          forwardedTo: to,
          forwardedFrom: msg.fromEmail, // Store original sender's email
          forwardedBy: req.user.email || req.user.id,
        });

        return res.json({ success: true });

      } else if (provider === 'outlook') {
        // Outlook forward via Graph API
        const emailAccountId = msg.emailAccountId;
        if (!emailAccountId) return res.status(400).json({ message: 'No email account linked to this message' });
        const account = await storage.getEmailAccount(emailAccountId) as any;
        if (!account) return res.status(400).json({ message: 'Email account not found' });
        const settingsForAccount = await storage.getApiSettings(req.user.organizationId);
        const outlookPrefix = `outlook_sender_${account.email}_`;
        let token = settingsForAccount[`${outlookPrefix}access_token`] || settingsForAccount.microsoft_access_token;
        const refreshTok = settingsForAccount[`${outlookPrefix}refresh_token`] || settingsForAccount.microsoft_refresh_token;
        if (!token && !refreshTok) return res.status(400).json({ message: 'Outlook not connected.' });
        // Refresh token if missing access token
        if (!token && refreshTok) {
          try {
            let clientId = settingsForAccount.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
            let clientSecret = settingsForAccount.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';
            const body = new URLSearchParams({
              client_id: clientId, client_secret: clientSecret,
              refresh_token: refreshTok, grant_type: 'refresh_token',
              scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
            });
            const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
            });
            if (tokenResp.ok) {
              const tokens = await tokenResp.json() as any;
              if (tokens.access_token) token = tokens.access_token;
            }
          } catch (e) { console.error('[Inbox Forward] Token refresh failed:', e); }
        }
        if (!token) return res.status(400).json({ message: 'Outlook token expired. Please re-authenticate.' });

        const toRecipients = to.split(',').map((e: string) => ({ emailAddress: { address: e.trim() } }));
        const ccRecipients = cc ? cc.split(',').map((e: string) => ({ emailAddress: { address: e.trim() } })) : [];
        const bccRecipients = bcc ? bcc.split(',').map((e: string) => ({ emailAddress: { address: e.trim() } })) : [];

        const graphResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: fwdSubject,
              body: { contentType: 'HTML', content: fullBody.replace(/\n/g, '<br>') },
              toRecipients,
              ccRecipients,
              bccRecipients,
            }
          }),
        });

        if (!graphResp.ok) {
          const errText = await graphResp.text();
          return res.status(500).json({ message: `Outlook forward failed: ${errText}` });
        }

        // Mark as forwarded
        await storage.updateInboxMessage(msg.id, {
          status: 'forwarded',
          forwardedAt: new Date().toISOString(),
          forwardedTo: to,
          forwardedFrom: msg.fromEmail, // Store original sender's email
          forwardedBy: req.user.email || req.user.id,
        });

        return res.json({ success: true });
      }

      return res.status(400).json({ message: 'Unsupported provider for forward' });
    } catch (error: any) {
      console.error('[Inbox Forward] Unexpected error:', error);
      res.status(500).json({ message: `Failed to forward message: ${error?.message || error}` });
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
      if (!contact && msg.fromEmail) contact = await storage.getContactByEmail(req.user.organizationId, msg.fromEmail);

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

  // (enhanced inbox and stats routes moved above /:id route to avoid Express param matching)

  // Classify a reply
  app.post('/api/inbox/:id/classify', requireAuth, async (req: any, res) => {
    try {
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });
      
      // Manual override or auto-classify
      const { replyType } = req.body;
      if (replyType) {
        await storage.classifyReply(req.params.id, replyType);
        // Auto-update contact status based on reply type
        if (msg.contactId) {
          if (replyType === 'positive') {
            await storage.updateContactLeadStatus(msg.contactId, 'interested');
          } else if (replyType === 'negative') {
            await storage.updateContactLeadStatus(msg.contactId, 'not_interested');
          }
          await storage.addContactActivity(req.user.organizationId, msg.contactId, 'reply_classified', `Reply classified as ${replyType}`, null, { messageId: msg.id, metadata: { replyType } });
        }
        return res.json({ success: true, replyType });
      }
      
      // Auto-classify
      const result = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);
      await storage.classifyReply(req.params.id, result.replyType);
      if (result.bounceType) await storage.setBounceType(req.params.id, result.bounceType);
      
      // Auto-update contact based on classification
      if (msg.contactId) {
        if (result.replyType === 'bounce' && result.bounceType) {
          await storage.markContactBounced(msg.contactId, result.bounceType);
        } else if (result.replyType === 'unsubscribe') {
          await storage.markContactUnsubscribed(msg.contactId, msg.campaignId);
        }
      }
      
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Classify error:', error);
      res.status(500).json({ message: 'Failed to classify reply' });
    }
  });

  // Bulk auto-classify all unclassified inbox messages
  app.post('/api/inbox/bulk-classify', requireAuth, async (req: any, res) => {
    try {
      const messages = await storage.getInboxMessagesEnhanced(req.user.organizationId, { replyType: '' }, 500, 0) as any[];
      let classified = 0;
      for (const msg of messages) {
        if (msg.replyType && msg.replyType !== '') continue;
        const result = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);
        await storage.classifyReply(msg.id, result.replyType);
        if (result.bounceType) await storage.setBounceType(msg.id, result.bounceType);
        // Auto-update contact
        if (msg.contactId) {
          if (result.replyType === 'bounce' && result.bounceType) {
            await storage.markContactBounced(msg.contactId, result.bounceType);
          } else if (result.replyType === 'unsubscribe') {
            await storage.markContactUnsubscribed(msg.contactId, msg.campaignId);
          }
        }
        classified++;
      }
      res.json({ success: true, classified });
    } catch (error) {
      res.status(500).json({ message: 'Failed to bulk classify' });
    }
  });

  // Assign inbox message to team member
  app.post('/api/inbox/:id/assign', requireAuth, async (req: any, res) => {
    try {
      const { userId } = req.body;
      await storage.assignInboxMessage(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign message' });
    }
  });

  // Update lead status on inbox message
  app.post('/api/inbox/:id/lead-status', requireAuth, async (req: any, res) => {
    try {
      const { leadStatus } = req.body;
      await storage.updateLeadStatus(req.params.id, leadStatus);
      // Create activity log
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (msg?.contactId) {
        await storage.addContactActivity(req.user.organizationId, msg.contactId, 'lead_status_changed', `Lead status changed to ${leadStatus}`, null, { messageId: msg.id, metadata: { leadStatus } });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update lead status' });
    }
  });

  // Star/unstar inbox message
  app.post('/api/inbox/:id/star', requireAuth, async (req: any, res) => {
    try {
      const { isStarred } = req.body;
      await storage.starInboxMessage(req.params.id, !!isStarred);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to star message' });
    }
  });

  // Unmark a message as bounced — clears bounceType, resets status to read
  app.post('/api/inbox/:id/unmark-bounce', requireAuth, async (req: any, res) => {
    try {
      const msg: any = await storage.getInboxMessage(req.params.id);
      if (!msg) return res.status(404).json({ message: 'Message not found' });
      await storage.updateInboxMessage(req.params.id, { bounceType: '', status: 'read' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to unmark bounce' });
    }
  });

  // Get conversation thread
  app.get('/api/inbox/thread/:threadId', requireAuth, async (req: any, res) => {
    try {
      const messages = await storage.getConversationThread(req.params.threadId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch thread' });
    }
  });

  // Get conversation by contact
  app.get('/api/inbox/contact/:contactId', requireAuth, async (req: any, res) => {
    try {
      const messages = await storage.getConversationByContact(req.user.organizationId, req.params.contactId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact conversation' });
    }
  });

  // ========== v12: SUPPRESSION LIST ==========

  app.get('/api/suppression-list', requireAuth, async (req: any, res) => {
    try {
      const { reason, limit, offset } = req.query;
      const items = await storage.getSuppressionList(req.user.organizationId, { reason }, parseInt(limit) || 100, parseInt(offset) || 0);
      const total = await storage.getSuppressionListCount(req.user.organizationId, { reason });
      res.json({ items, total });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch suppression list' });
    }
  });

  app.post('/api/suppression-list', requireAuth, async (req: any, res) => {
    try {
      const { email, reason, notes } = req.body;
      if (!email) return res.status(400).json({ message: 'Email is required' });
      const id = await storage.addToSuppressionList(req.user.organizationId, email, reason || 'manual', { notes, source: 'manual' });
      res.json({ success: true, id });
    } catch (error) {
      res.status(500).json({ message: 'Failed to add to suppression list' });
    }
  });

  app.delete('/api/suppression-list/:email', requireAuth, async (req: any, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      await storage.removeFromSuppressionList(req.user.organizationId, email);
      // Also restore the contact status so bounce-sync doesn't re-add them on next cycle
      await storage.rawRun(
        `UPDATE contacts SET status='active', "bouncedAt"=NULL, "bounceType"=NULL, "updatedAt"=$1 WHERE lower(email)=lower($2) AND "organizationId"=$3 AND status='bounced'`,
        [new Date().toISOString(), email, req.user.organizationId]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to remove from suppression list' });
    }
  });

  app.post('/api/suppression-list/check', requireAuth, async (req: any, res) => {
    try {
      const { emails } = req.body;
      if (!Array.isArray(emails)) return res.status(400).json({ message: 'emails array required' });
      const results: Record<string, boolean> = {};
      for (const email of emails) {
        results[email] = await storage.isEmailSuppressed(req.user.organizationId, email);
      }
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: 'Failed to check suppression' });
    }
  });

  // Bounce sync — scan all sources and populate suppression list
  app.post('/api/suppression-list/sync-bounces', requireAuth, async (req: any, res) => {
    try {
      const { lookbackDays, allOrgs } = req.body;
      const days = Math.min(parseInt(lookbackDays) || 30, 180);
      const orgId = req.user.organizationId;

      if (allOrgs && req.user.role === 'superadmin') {
        const results = await runBounceSyncAllOrgs(days);
        return res.json({ success: true, results });
      }

      const result = await runBounceSyncForOrg(orgId, days);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ message: 'Failed to sync bounces' });
    }
  });

  // ========== v12: CONTACT STATUS ENGINE ==========

  app.post('/api/contacts/:id/recalculate-status', requireAuth, async (req: any, res) => {
    try {
      await storage.recalculateContactStatus(req.params.id);
      const contact = await storage.getContact(req.params.id);
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: 'Failed to recalculate contact status' });
    }
  });

  app.post('/api/contacts/:id/recalculate-score', requireAuth, async (req: any, res) => {
    try {
      const score = await storage.recalculateContactScore(req.params.id);
      res.json({ score });
    } catch (error) {
      res.status(500).json({ message: 'Failed to recalculate score' });
    }
  });

  app.post('/api/contacts/:id/lead-status', requireAuth, async (req: any, res) => {
    try {
      const { leadStatus } = req.body;
      await storage.updateContactLeadStatus(req.params.id, leadStatus);
      await storage.addContactActivity(req.user.organizationId, req.params.id, 'lead_status_changed', `Lead status set to ${leadStatus}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update lead status' });
    }
  });

  app.post('/api/contacts/:id/mark-unsubscribed', requireAuth, async (req: any, res) => {
    try {
      await storage.markContactUnsubscribed(req.params.id, req.body.campaignId);
      await storage.addContactActivity(req.user.organizationId, req.params.id, 'unsubscribed', 'Contact marked as unsubscribed');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to mark unsubscribed' });
    }
  });

  // Manual "Do not contact" from unified inbox — suppresses the sender and flips
  // the matching contact row. Used for replies the classifier didn't auto-suppress.
  app.post('/api/inbox/:id/do-not-contact', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const msg = await storage.getInboxMessage(req.params.id) as any;
      if (!msg || msg.organizationId !== orgId) return res.status(404).json({ message: 'Not found' });

      const email = (msg.fromEmail || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return res.status(400).json({ message: 'Invalid sender email' });

      // Guard: don't suppress own sending / warmup accounts
      const accounts = await storage.rawAll(`SELECT email FROM email_accounts WHERE "organizationId" = ?`, orgId) as any[];
      const warmup = await storage.rawAll(`SELECT email FROM warmup_accounts WHERE "organizationId" = ?`, orgId) as any[];
      const protectedSet = new Set<string>();
      for (const a of accounts) if (a.email) protectedSet.add(a.email.toLowerCase());
      for (const w of warmup) if (w.email) protectedSet.add(w.email.toLowerCase());
      if (protectedSet.has(email)) return res.status(400).json({ message: 'Cannot suppress an account you own' });

      const reason = (req.body?.reason === 'bounce' ? 'bounce' : 'unsubscribe') as 'bounce' | 'unsubscribe';
      await storage.addToSuppressionList(orgId, email, reason, { source: 'manual-inbox', notes: req.body?.notes });

      let contactFlipped = false;
      const contact = await storage.rawGet(
        `SELECT id FROM contacts WHERE "organizationId" = ? AND LOWER(email) = ? LIMIT 1`,
        orgId, email
      ) as any;
      if (contact?.id) {
        if (reason === 'bounce') await storage.markContactBounced(contact.id, 'hard');
        else await storage.markContactUnsubscribed(contact.id, msg.campaignId);
        try {
          await storage.addContactActivity(orgId, contact.id, reason === 'bounce' ? 'bounced' : 'unsubscribed',
            `Marked ${reason} via inbox by ${req.user.email || req.user.id}`);
        } catch { /* non-critical */ }
        contactFlipped = true;
      }

      res.json({ success: true, email, reason, contactFlipped });
    } catch (error) {
      console.error('[do-not-contact] error:', error);
      res.status(500).json({ message: 'Failed to suppress contact' });
    }
  });

  // ========== v12: CONTACT ACTIVITY TIMELINE ==========

  app.get('/api/contacts/:id/activity', requireAuth, async (req: any, res) => {
    try {
      const { limit, offset } = req.query;
      const activities = await storage.getContactActivity(req.params.id, parseInt(limit as string) || 50, parseInt(offset as string) || 0);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact activity' });
    }
  });

  app.get('/api/contacts/:id/conversations', requireAuth, async (req: any, res) => {
    try {
      const messages = await storage.getConversationByContact(req.user.organizationId, req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch contact conversations' });
    }
  });

  // ========== v12: WARMUP MONITORING ==========

  app.get('/api/warmup', requireAuth, async (req: any, res) => {
    try {
      const accounts = await storage.getWarmupAccounts(req.user.organizationId);
      // Add effective daily volume (accounts for warmup phase ramp-up)
      const enriched = accounts.map((a: any) => {
        const daysSinceStart = Math.max(0, Math.floor((Date.now() - new Date(a.startDate).getTime()) / (1000 * 60 * 60 * 24)));
        let ratio: number;
        if (daysSinceStart < 7) ratio = 0.1 + (daysSinceStart / 7) * 0.2;
        else if (daysSinceStart < 21) ratio = 0.3 + ((daysSinceStart - 7) / 14) * 0.3;
        else if (daysSinceStart < 45) ratio = 0.6 + ((daysSinceStart - 21) / 24) * 0.3;
        else ratio = 1.0;
        const effectiveDailyTarget = Math.max(1, Math.round((a.dailyTarget || 5) * ratio));
        return { ...a, effectiveDailyTarget, daysSinceStart };
      });
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch warmup accounts' });
    }
  });

  app.post('/api/warmup', requireAuth, async (req: any, res) => {
    try {
      const { emailAccountId, dailyTarget, settings } = req.body;
      if (!emailAccountId) return res.status(400).json({ message: 'emailAccountId required' });
      const account = await storage.createWarmupAccount({
        organizationId: req.user.organizationId,
        emailAccountId,
        dailyTarget: dailyTarget || 5,
        settings: settings || {},
      });
      res.json(account);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create warmup account' });
    }
  });

  // Warmup settings — get/save selected template IDs (must be before :id routes)
  app.get('/api/warmup/settings', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const templateIds = settings.warmup_template_ids ? JSON.parse(settings.warmup_template_ids) : [];
      res.json({ templateIds });
    } catch (error) {
      res.json({ templateIds: [] });
    }
  });

  app.put('/api/warmup/settings', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { templateIds } = req.body;
      await storage.setApiSetting(orgId, 'warmup_template_ids', JSON.stringify(templateIds || []));
      res.json({ success: true, templateIds: templateIds || [] });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save warmup settings' });
    }
  });

  // Manual warmup trigger — run one cycle now (must be before :id routes)
  app.post('/api/warmup/run-now', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      // Run warmup for this specific org directly
      const orgResult = await runOrgWarmupDirect(orgId);
      res.json({ success: true, result: orgResult });
    } catch (error) {
      console.error('[Warmup] Run-now error:', error);
      res.status(500).json({ message: 'Failed to run warmup cycle', error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put('/api/warmup/:id', requireAuth, async (req: any, res) => {
    try {
      const updated = await storage.updateWarmupAccount(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update warmup account' });
    }
  });

  app.delete('/api/warmup/:id', requireAuth, async (req: any, res) => {
    try {
      await storage.deleteWarmupAccount(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete warmup account' });
    }
  });

  app.get('/api/warmup/:id/logs', requireAuth, async (req: any, res) => {
    try {
      const logs = await storage.getWarmupLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch warmup logs' });
    }
  });

  // ========== v12: NOTIFICATIONS ==========

  app.get('/api/notifications', requireAuth, async (req: any, res) => {
    try {
      const notifications = await storage.getNotifications(req.user.organizationId, req.user.id);
      const unreadCount = await storage.getUnreadNotificationCount(req.user.organizationId, req.user.id);
      res.json({ notifications, unreadCount });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch notifications' });
    }
  });

  app.post('/api/notifications/:id/read', requireAuth, async (req: any, res) => {
    try {
      await storage.markNotificationRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to mark notification read' });
    }
  });

  app.post('/api/notifications/read-all', requireAuth, async (req: any, res) => {
    try {
      await storage.markAllNotificationsRead(req.user.organizationId, req.user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to mark all read' });
    }
  });

  // ========== v12: CAMPAIGN ANALYTICS (enhanced) ==========

  app.get('/api/campaigns/:id/analytics', requireAuth, async (req: any, res) => {
    try {
      const analytics = await storage.getCampaignAnalytics(req.params.id);
      if (!analytics) return res.status(404).json({ message: 'Campaign not found' });
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch campaign analytics' });
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
      // Clear auth cache for this user so next request picks up new org
      for (const key of authCache.keys()) {
        if (key.startsWith(`${req.user.id}:`)) authCache.delete(key);
      }

      const org = await storage.getOrganization(organizationId);
      res.json({ success: true, organization: org });
    } catch (error) {
      res.status(500).json({ message: 'Failed to switch organization' });
    }
  });

  // Get team members of current org
  // ========== TEAM SCORECARD & LEADERBOARD ==========

  app.get('/api/team/scorecard', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const period = (req.query.period as string) || 'today'; // today, week, YYYY-MM, all

      // Calculate date range — supports month names like "2026-01", "2026-04"
      const now = new Date();
      let startDate: string;
      let endDate: string = '9999-12-31'; // default: no upper bound
      const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
      if (period === 'today') {
        startDate = now.toISOString().split('T')[0];
      } else if (period === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        startDate = d.toISOString().split('T')[0];
      } else if (monthMatch) {
        const year = parseInt(monthMatch[1]);
        const month = parseInt(monthMatch[2]);
        startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
        endDate = nextMonth.toISOString().split('T')[0];
      } else {
        startDate = '2000-01-01';
      }

      // Get all org members
      const members = await storage.getOrgMembers(orgId);

      // Exclude ALL connected sender / warmup account emails. Uses SQL subqueries
      // against email_accounts + warmup_accounts (via join) to guarantee a match
      // regardless of case/whitespace — these are the same emails shown on the
      // warmup-monitoring page.
      const ownEmailsFilter = `
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (
          SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
          JOIN email_accounts ea ON ea.id = wa."emailAccountId" WHERE ea.email IS NOT NULL
        )
      `;

      const scorecard = [];
      for (const member of members) {
       try {
        const userId = (member as any).userId;
        const userName = `${(member as any).firstName || ''} ${(member as any).lastName || ''}`.trim() || (member as any).email || 'Unknown';

        // Emails sent — count campaign messages sent FROM this user's email accounts.
        // Warmup sends never write to the messages table so they are already excluded.
        // Also exclude recipients that are own-org accounts (internal sends).
        let emailsSent = 0;
        try {
          emailsSent = parseInt((await storage.rawGet(`
            SELECT COUNT(*) as cnt FROM messages m
            JOIN email_accounts ea ON ea.id = m."emailAccountId"
            WHERE ea."organizationId" = ? AND ea."userId" = ? AND m.status = 'sent' AND m."sentAt" >= ? AND m."sentAt" < ?
            AND LOWER(TRIM(COALESCE(m."recipientEmail", ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
            AND LOWER(TRIM(COALESCE(m."recipientEmail", ''))) NOT IN (
              SELECT LOWER(TRIM(ea2.email)) FROM warmup_accounts wa
              JOIN email_accounts ea2 ON ea2.id = wa."emailAccountId" WHERE ea2.email IS NOT NULL
            )
          `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
        } catch {
          // Fallback: count by contacts assigned to this user if emailAccountId column missing
          try {
            emailsSent = parseInt((await storage.rawGet(`
              SELECT COUNT(*) as cnt FROM messages m
              JOIN contacts c ON c.id = m."contactId"
              WHERE c."organizationId" = ? AND c."assignedTo" = ? AND m.status = 'sent' AND m."sentAt" >= ? AND m."sentAt" < ?
              AND LOWER(TRIM(COALESCE(m."recipientEmail", c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
            `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
          } catch { /* skip */ }
        }

        // Activities by type
        let callsMade = 0, meetingsDone = 0, proposalsSent = 0;
        const activityMap: Record<string, number> = {};
        try {
          const activities = await storage.rawAll(`
            SELECT type, COUNT(*) as cnt FROM contact_activities
            WHERE "organizationId" = ? AND "userId" = ? AND "createdAt" >= ? AND "createdAt" < ?
            GROUP BY type
          `, orgId, userId, startDate, endDate) as any[];
          for (const a of activities) activityMap[a.type] = parseInt(a.cnt || 0);
          callsMade = activityMap['call'] || 0;
          meetingsDone = activityMap['meeting'] || 0;
          proposalsSent = activityMap['proposal'] || 0;
        } catch { /* contact_activities may not exist */ }

        // Meetings detected in inbox (regex-detected Zoom/Meet/Teams/ICS invites sent to this user's accounts).
        // Counted as DISTINCT contact so multiple invite emails for the same contact = 1 meeting.
        try {
          const inboxMeetings = parseInt((await storage.rawGet(`
            SELECT COUNT(DISTINCT LOWER(COALESCE(c.email, ui."fromEmail"))) as cnt FROM unified_inbox ui
            INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
            LEFT JOIN contacts c ON c.id = ui."contactId"
            WHERE ui."organizationId" = ? AND ea."userId" = ?
            AND ui."meetingDetected" = TRUE
            AND ui."receivedAt" >= ? AND ui."receivedAt" < ?
            ${ownEmailsFilter}
            AND LOWER(TRIM(COALESCE(c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
          meetingsDone += inboxMeetings;
        } catch { /* meetingDetected column may not exist yet */ }

        // Pipeline stats (contacts assigned to this user)
        // dealValue column may not exist yet on older deployments — use try/catch
        let pipelineStats: any[] = [];
        try {
          pipelineStats = await storage.rawAll(`
            SELECT "pipelineStage", COUNT(*) as cnt, SUM(COALESCE("dealValue", 0)) as totalValue
            FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ?
            AND "pipelineStage" IN ('interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent', 'won', 'lost')
            GROUP BY "pipelineStage"
          `, orgId, userId) as any[];
        } catch {
          pipelineStats = await storage.rawAll(`
            SELECT "pipelineStage", COUNT(*) as cnt, 0 as totalValue
            FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ?
            AND "pipelineStage" IN ('interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent', 'won', 'lost')
            GROUP BY "pipelineStage"
          `, orgId, userId) as any[];
        }
        const pipeMap: Record<string, { count: number; value: number }> = {};
        for (const p of pipelineStats) pipeMap[p.pipelineStage] = { count: parseInt(p.cnt || 0), value: Number(p.totalValue || 0) };

        // Deals won/lost in this period
        let dealsWon = { cnt: 0, totalValue: 0 };
        let dealsLost = 0;
        try {
          const dwRaw = (await storage.rawGet(`
            SELECT COUNT(*) as cnt, SUM(COALESCE("dealValue", 0)) as totalValue
            FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'won' AND "dealClosedAt" >= ? AND "dealClosedAt" < ?
          `, orgId, userId, startDate, endDate) as any);
          dealsWon = { cnt: parseInt(dwRaw?.cnt || 0), totalValue: Number(dwRaw?.totalValue || 0) };
          dealsLost = parseInt((await storage.rawGet(`
            SELECT COUNT(*) as cnt FROM contacts
            WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'lost' AND "dealClosedAt" >= ? AND "dealClosedAt" < ?
          `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
        } catch {
          // dealClosedAt column may not exist — fall back to counting all won/lost
          const dwRaw = (await storage.rawGet(`
            SELECT COUNT(*) as cnt, 0 as totalValue
            FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'won'
          `, orgId, userId) as any);
          dealsWon = { cnt: parseInt(dwRaw?.cnt || 0), totalValue: 0 };
          dealsLost = parseInt((await storage.rawGet(`
            SELECT COUNT(*) as cnt FROM contacts
            WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'lost'
          `, orgId, userId) as any)?.cnt || 0);
        }

        // Not Replied — inbox messages the team member hasn't replied back to
        // Counts human replies (positive/negative/general) waiting in their inbox
        // Excludes warmup/internal senders (own-org email accounts)
        let notReplied = 0;
        let notRepliedHot = 0;
        let notRepliedWarm = 0;
        try {
          const row = (await storage.rawGet(`
            SELECT
              COUNT(*) as cnt,
              COUNT(*) FILTER (WHERE ui."replyQualityLabel" = 'Hot') as hot,
              COUNT(*) FILTER (WHERE ui."replyQualityLabel" = 'Warm') as warm
            FROM unified_inbox ui
            INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
            LEFT JOIN contacts c ON c.id = ui."contactId"
            WHERE ui."organizationId" = ? AND ea."userId" = ?
            AND ui.status != 'replied' AND ui."repliedAt" IS NULL AND ui."repliedBy" IS NULL
            AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
            AND ui."replyType" IN ('positive', 'negative', 'general')
            ${ownEmailsFilter}
            AND LOWER(TRIM(COALESCE(c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          `, orgId, userId) as any) || {};
          notReplied = parseInt(row.cnt || 0);
          notRepliedHot = parseInt(row.hot || 0);
          notRepliedWarm = parseInt(row.warm || 0);
        } catch { /* inbox schema mismatch — skip */ }

        // Hot Leads — contacts classified as hot_lead/warm_lead/past_customer by lead intelligence,
        // who are linked to this user's accounts (via emailAccountId or accountEmail) OR assigned to this user.
        // accountEmail may be empty string on older records so we also match via emailAccountId.
        let hotLeads = 0;
        try {
          hotLeads = parseInt((await storage.rawGet(`
            SELECT COUNT(DISTINCT LOWER(lo."contactEmail")) as cnt
            FROM lead_opportunities lo
            WHERE lo."organizationId" = ?
            AND lo.bucket IN ('hot_lead', 'warm_lead', 'past_customer')
            AND (
              lo."emailAccountId" IN (SELECT id FROM email_accounts WHERE "userId" = ? AND id IS NOT NULL)
              OR (lo."accountEmail" != '' AND lo."accountEmail" IN (SELECT email FROM email_accounts WHERE "userId" = ? AND email IS NOT NULL))
              OR LOWER(lo."contactEmail") IN (
                SELECT LOWER(COALESCE(c.email, '')) FROM contacts c WHERE c."organizationId" = ? AND c."assignedTo" = ? AND c.email IS NOT NULL
              )
            )
            AND LOWER(lo."contactEmail") NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          `, orgId, userId, userId, orgId, userId) as any)?.cnt || 0);
        } catch { /* inbox schema mismatch — skip */ }

        const revenue = dealsWon.totalValue || 0;
        const wonCount = dealsWon.cnt || 0;
        const winRate = (wonCount + dealsLost) > 0 ? Math.round((wonCount / (wonCount + dealsLost)) * 100) : 0;

        scorecard.push({
          userId,
          userName,
          email: (member as any).email,
          role: (member as any).role,
          emailsSent,
          callsMade,
          meetingsDone,
          proposalsSent,
          hotLeads,
          notReplied,
          notRepliedHot,
          notRepliedWarm,
          dealsWon: wonCount,
          dealsLost,
          revenue,
          winRate,
          totalActivities: callsMade + meetingsDone + proposalsSent + (activityMap['email'] || 0) + (activityMap['whatsapp'] || 0) + (activityMap['note'] || 0),
          pipeline: pipeMap,
        });
      } catch (memberErr: any) {
        console.error(`[Scorecard] Error processing member ${(member as any).email}:`, memberErr.message);
      }
      }

      // Sort by revenue descending (leaderboard order)
      scorecard.sort((a, b) => b.revenue - a.revenue || b.dealsWon - a.dealsWon || b.emailsSent - a.emailsSent);

      // Team totals
      const teamTotals = {
        emailsSent: scorecard.reduce((s, m) => s + m.emailsSent, 0),
        callsMade: scorecard.reduce((s, m) => s + m.callsMade, 0),
        meetingsDone: scorecard.reduce((s, m) => s + m.meetingsDone, 0),
        proposalsSent: scorecard.reduce((s, m) => s + m.proposalsSent, 0),
        hotLeads: scorecard.reduce((s, m) => s + m.hotLeads, 0),
        notReplied: scorecard.reduce((s, m) => s + (m.notReplied || 0), 0),
        notRepliedHot: scorecard.reduce((s, m) => s + ((m as any).notRepliedHot || 0), 0),
        notRepliedWarm: scorecard.reduce((s, m) => s + ((m as any).notRepliedWarm || 0), 0),
        dealsWon: scorecard.reduce((s, m) => s + m.dealsWon, 0),
        dealsLost: scorecard.reduce((s, m) => s + m.dealsLost, 0),
        revenue: scorecard.reduce((s, m) => s + m.revenue, 0),
      };

      // Overdue actions (team-wide) — safe if nextActionDate column missing
      let overdueActions = 0;
      try {
        overdueActions = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts
          WHERE "organizationId" = ? AND "nextActionDate" < ? AND "nextActionDate" IS NOT NULL
          AND "pipelineStage" NOT IN ('won', 'lost')
        `, orgId, now.toISOString().split('T')[0]) as any)?.cnt || 0);
      } catch { /* column may not exist */ }

      // Unactioned replies — safe if repliedAt column missing
      let unactionedReplies = 0;
      try {
        unactionedReplies = parseInt((await storage.rawGet(`
          SELECT COUNT(DISTINCT m."contactId") as cnt
          FROM messages m
          LEFT JOIN contact_activities ca ON ca."contactId" = m."contactId" AND ca."createdAt" > m."repliedAt"
          WHERE m."campaignId" IN (SELECT id FROM campaigns WHERE "organizationId" = ?)
          AND m."repliedAt" IS NOT NULL AND m."repliedAt" >= ? AND m."repliedAt" < ? AND ca.id IS NULL
        `, orgId, startDate, endDate) as any)?.cnt || 0);
      } catch { /* column may not exist */ }

      // Get org createdAt for month picker
      let orgCreatedAt = '2026-01-01';
      try {
        const org = await storage.getOrganization(orgId);
        if (org && (org as any).createdAt) orgCreatedAt = (org as any).createdAt;
      } catch { }

      res.json({ scorecard, teamTotals, overdueActions, unactionedReplies, period, orgCreatedAt });
    } catch (error: any) {
      console.error('[Scorecard] Error:', error.message);
      res.status(500).json({ message: 'Failed to fetch scorecard' });
    }
  });

  // ── Scorecard Drill-Down — not-replied contacts or hot leads for a user ──
  app.get('/api/team/scorecard/drilldown', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { userId, type, period } = req.query as Record<string, string>;

      const now = new Date();
      let startDate = '2000-01-01';
      let endDate = '9999-12-31';
      const monthMatch = period?.match(/^(\d{4})-(\d{2})$/);
      if (period === 'today') {
        startDate = now.toISOString().split('T')[0];
      } else if (period === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        startDate = d.toISOString().split('T')[0];
      } else if (monthMatch) {
        const year = parseInt(monthMatch[1]);
        const month = parseInt(monthMatch[2]);
        startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
        endDate = nextMonth.toISOString().split('T')[0];
      }

      // Exclude all connected sender / warmup account emails via SQL subquery
      // (same emails shown on warmup-monitoring page).
      const ownEmailsFilter = `
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (
          SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
          JOIN email_accounts ea ON ea.id = wa."emailAccountId" WHERE ea.email IS NOT NULL
        )
      `;

      if (type === 'not_replied') {
        // Inbox messages the team member hasn't replied to yet (excluding warmup/internal)
        const contacts = await storage.rawAll(`
          SELECT
            COALESCE(c.id, ui.id) AS id,
            COALESCE(c."firstName", SPLIT_PART(ui."fromName", ' ', 1), '') AS "firstName",
            COALESCE(c."lastName", '') AS "lastName",
            COALESCE(c.email, ui."fromEmail") AS email,
            c.company, c."pipelineStage",
            ui."receivedAt" AS "sentAt", ui.subject,
            EXTRACT(DAY FROM (NOW() - ui."receivedAt"::timestamptz))::int AS "daysSinceSent"
          FROM unified_inbox ui
          INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
          LEFT JOIN contacts c ON c.id = ui."contactId"
          WHERE ui."organizationId" = ? AND ea."userId" = ?
          AND ui.status != 'replied' AND ui."repliedAt" IS NULL AND ui."repliedBy" IS NULL
          AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
          AND ui."replyType" IN ('positive', 'negative', 'general')
          ${ownEmailsFilter}
          AND LOWER(TRIM(COALESCE(c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          ORDER BY ui."receivedAt" DESC
        `, orgId, userId) as any[];
        return res.json({ contacts: contacts || [] });
      }

      if (type === 'hot_leads') {
        // Contacts classified as hot/warm/past_customer by lead intelligence engine,
        // assigned to this user or received on this user's accounts.
        const contacts = await storage.rawAll(`
          SELECT DISTINCT ON (LOWER(lo."contactEmail"))
            COALESCE(c.id::text, lo.id::text) AS id,
            COALESCE(c."firstName", SPLIT_PART(lo."contactName", ' ', 1), '') AS "firstName",
            COALESCE(c."lastName", '') AS "lastName",
            lo."contactEmail" AS email,
            c.company, c."pipelineStage",
            c."dealValue", c."nextActionDate",
            lo.bucket AS "leadBucket", lo.confidence AS "leadConfidence",
            lo."suggestedAction", lo."aiReasoning"
          FROM lead_opportunities lo
          LEFT JOIN contacts c ON LOWER(c.email) = LOWER(lo."contactEmail") AND c."organizationId" = lo."organizationId"
          WHERE lo."organizationId" = ?
          AND lo.bucket IN ('hot_lead', 'warm_lead', 'past_customer')
          AND (
            lo."emailAccountId" IN (SELECT id FROM email_accounts WHERE "userId" = ? AND id IS NOT NULL)
            OR (lo."accountEmail" != '' AND lo."accountEmail" IN (SELECT email FROM email_accounts WHERE "userId" = ? AND email IS NOT NULL))
            OR LOWER(lo."contactEmail") IN (
              SELECT LOWER(COALESCE(c2.email, '')) FROM contacts c2 WHERE c2."organizationId" = ? AND c2."assignedTo" = ? AND c2.email IS NOT NULL
            )
          )
          AND LOWER(lo."contactEmail") NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          ORDER BY LOWER(lo."contactEmail"), lo."lastEmailDate" DESC
        `, orgId, userId, userId, orgId, userId) as any[];
        return res.json({ contacts: contacts || [] });
      }

      if (type === 'meetings') {
        const contacts = await storage.rawAll(`
          SELECT DISTINCT ON (LOWER(COALESCE(c.email, ui."fromEmail")))
            COALESCE(c.id, ui.id) AS id,
            COALESCE(c."firstName", SPLIT_PART(ui."fromName", ' ', 1), '') AS "firstName",
            COALESCE(c."lastName", '') AS "lastName",
            COALESCE(c.email, ui."fromEmail") AS email,
            c.company, c."pipelineStage", c."dealValue", c."nextActionDate",
            ui."receivedAt" AS "sentAt", ui.subject,
            ui."meetingPlatform", ui."meetingUrl", ui."meetingAt"
          FROM unified_inbox ui
          INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
          LEFT JOIN contacts c ON c.id = ui."contactId"
          WHERE ui."organizationId" = ? AND ea."userId" = ?
          AND ui."meetingDetected" = TRUE
          ${ownEmailsFilter}
          AND LOWER(TRIM(COALESCE(c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          ORDER BY LOWER(COALESCE(c.email, ui."fromEmail")), ui."receivedAt" DESC
        `, orgId, userId) as any[];
        return res.json({ contacts: contacts || [] });
      }

      res.status(400).json({ message: 'Invalid type. Use not_replied, hot_leads, or meetings' });
    } catch (error: any) {
      console.error('[Scorecard Drilldown] Error:', error.message);
      res.status(500).json({ message: 'Failed to fetch drill-down data' });
    }
  });

  // Debug — shows the exclusion set + any inbox senders that look internal but aren't excluded
  app.get('/api/team/scorecard/debug', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const sample = (req.query.sample as string || '').toLowerCase().trim();

      const emailAccounts = await storage.rawAll(`SELECT id, LOWER(TRIM(email)) as email, "organizationId", provider FROM email_accounts ORDER BY email`) as any[];
      const warmupJoin = await storage.rawAll(`
        SELECT wa.id as warmup_id, LOWER(TRIM(ea.email)) as email, ea."organizationId", wa.status
        FROM warmup_accounts wa JOIN email_accounts ea ON ea.id = wa."emailAccountId"
        ORDER BY ea.email
      `) as any[];

      // Find inbox senders for this org that look like they SHOULD be excluded but aren't in either table
      const leakedSenders = await storage.rawAll(`
        SELECT LOWER(TRIM(ui."fromEmail")) as "fromEmail", COUNT(*)::int as cnt
        FROM unified_inbox ui
        WHERE ui."organizationId" = ?
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
        AND LOWER(TRIM(ui."fromEmail")) NOT IN (
          SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
          JOIN email_accounts ea ON ea.id = wa."emailAccountId" WHERE ea.email IS NOT NULL
        )
        AND (
          LOWER(TRIM(ui."fromEmail")) LIKE '%@bellaward.com'
          OR LOWER(TRIM(ui."fromEmail")) LIKE '%@aegis.edu.in'
        )
        GROUP BY LOWER(TRIM(ui."fromEmail"))
        ORDER BY cnt DESC
        LIMIT 50
      `, orgId) as any[];

      // Optional: look up a specific sample email
      let sampleInfo: any = null;
      if (sample) {
        const inEa = await storage.rawAll(`SELECT id, LOWER(TRIM(email)) as email, "organizationId", provider FROM email_accounts WHERE LOWER(TRIM(email)) = ?`, sample) as any[];
        const inWa = await storage.rawAll(`
          SELECT wa.id, LOWER(TRIM(ea.email)) as email, ea."organizationId"
          FROM warmup_accounts wa JOIN email_accounts ea ON ea.id = wa."emailAccountId"
          WHERE LOWER(TRIM(ea.email)) = ?
        `, sample) as any[];
        const inInbox = await storage.rawAll(`
          SELECT ui.id, LOWER(TRIM(ui."fromEmail")) as "fromEmail", ui."emailAccountId", ui."replyType", ui."sentByUs"
          FROM unified_inbox ui WHERE LOWER(TRIM(ui."fromEmail")) = ? LIMIT 5
        `, sample) as any[];
        sampleInfo = { sample, inEmailAccounts: inEa, inWarmupAccounts: inWa, inboxRows: inInbox };
      }

      res.json({
        orgId,
        emailAccountsCount: emailAccounts.length,
        warmupLinkedCount: warmupJoin.length,
        emailAccounts: emailAccounts.slice(0, 100),
        warmupAccounts: warmupJoin,
        leakedSenders,
        sampleInfo,
      });
    } catch (error: any) {
      console.error('[Scorecard Debug] Error:', error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // ── My Dashboard (individual member view) ──
  app.get('/api/my/dashboard', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const period = (req.query.period as string) || 'today';

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      let startDate: string;
      let endDate: string = '9999-12-31';
      const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
      if (period === 'today') {
        startDate = todayStr;
      } else if (period === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 7);
        startDate = d.toISOString().split('T')[0];
      } else if (monthMatch) {
        const year = parseInt(monthMatch[1]);
        const month = parseInt(monthMatch[2]);
        startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
        endDate = nextMonth.toISOString().split('T')[0];
      } else {
        startDate = '2000-01-01';
      }

      // ── My Stats ──
      let emailsSent = 0;
      try {
        emailsSent = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM messages m
          JOIN contacts c ON c.id = m."contactId"
          WHERE c."organizationId" = ? AND c."assignedTo" = ? AND m.status = 'sent' AND m."sentAt" >= ? AND m."sentAt" < ?
        `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
      } catch { }

      let callsMade = 0, meetingsDone = 0, proposalsSent = 0;
      const activityMap: Record<string, number> = {};
      try {
        const activities = await storage.rawAll(`
          SELECT type, COUNT(*) as cnt FROM contact_activities
          WHERE "organizationId" = ? AND "userId" = ? AND "createdAt" >= ? AND "createdAt" < ?
          GROUP BY type
        `, orgId, userId, startDate, endDate) as any[];
        for (const a of activities) activityMap[a.type] = parseInt(a.cnt || 0);
        callsMade = activityMap['call'] || 0;
        meetingsDone = activityMap['meeting'] || 0;
        proposalsSent = activityMap['proposal'] || 0;
      } catch { }

      try {
        const inboxMeetings = parseInt((await storage.rawGet(`
          SELECT COUNT(DISTINCT LOWER(COALESCE(c.email, ui."fromEmail"))) as cnt FROM unified_inbox ui
          INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
          LEFT JOIN contacts c ON c.id = ui."contactId"
          WHERE ui."organizationId" = ? AND ea."userId" = ?
          AND ui."meetingDetected" = TRUE
          AND ui."receivedAt" >= ? AND ui."receivedAt" < ?
          AND LOWER(TRIM(ui."fromEmail")) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
          AND LOWER(TRIM(COALESCE(c.email, ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
        `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
        meetingsDone += inboxMeetings;
      } catch { }

      let dealsWon = { cnt: 0, totalValue: 0 };
      let dealsLost = 0;
      try {
        const dwRaw = (await storage.rawGet(`
          SELECT COUNT(*) as cnt, SUM(COALESCE("dealValue", 0)) as totalValue
          FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'won' AND "dealClosedAt" >= ? AND "dealClosedAt" < ?
        `, orgId, userId, startDate, endDate) as any);
        dealsWon = { cnt: parseInt(dwRaw?.cnt || 0), totalValue: Number(dwRaw?.totalValue || 0) };
        dealsLost = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts
          WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'lost' AND "dealClosedAt" >= ? AND "dealClosedAt" < ?
        `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
      } catch {
        const dwRaw = (await storage.rawGet(`
          SELECT COUNT(*) as cnt, 0 as totalValue
          FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'won'
        `, orgId, userId) as any);
        dealsWon = { cnt: parseInt(dwRaw?.cnt || 0), totalValue: 0 };
        dealsLost = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts
          WHERE "organizationId" = ? AND "assignedTo" = ? AND "pipelineStage" = 'lost'
        `, orgId, userId) as any)?.cnt || 0);
      }

      // Pipeline funnel
      let pipeline: any[] = [];
      try {
        pipeline = await storage.rawAll(`
          SELECT "pipelineStage", COUNT(*) as cnt, SUM(COALESCE("dealValue", 0)) as totalValue
          FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ?
          AND "pipelineStage" IN ('new', 'contacted', 'interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent', 'won', 'lost')
          GROUP BY "pipelineStage"
        `, orgId, userId) as any[];
      } catch {
        try {
          pipeline = await storage.rawAll(`
            SELECT "pipelineStage", COUNT(*) as cnt, 0 as totalValue
            FROM contacts WHERE "organizationId" = ? AND "assignedTo" = ?
            AND "pipelineStage" IN ('new', 'contacted', 'interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent', 'won', 'lost')
            GROUP BY "pipelineStage"
          `, orgId, userId) as any[];
        } catch { }
      }
      const pipeMap: Record<string, { count: number; value: number }> = {};
      for (const p of pipeline) pipeMap[p.pipelineStage] = { count: parseInt(p.cnt || 0), value: Number(p.totalValue || 0) };

      const hotLeads = (pipeMap['interested']?.count || 0) + (pipeMap['meeting_scheduled']?.count || 0) + (pipeMap['meeting_done']?.count || 0);
      const revenue = dealsWon.totalValue || 0;
      const wonCount = dealsWon.cnt || 0;
      const winRate = (wonCount + dealsLost) > 0 ? Math.round((wonCount / (wonCount + dealsLost)) * 100) : 0;

      const stats = {
        emailsSent, callsMade, meetingsDone, proposalsSent, hotLeads,
        dealsWon: wonCount, dealsLost, revenue, winRate,
        totalActivities: callsMade + meetingsDone + proposalsSent + (activityMap['email'] || 0) + (activityMap['whatsapp'] || 0) + (activityMap['note'] || 0),
        pipeline: pipeMap,
      };

      // ── Nudges ──
      const nudges: { type: string; priority: string; title: string; message: string; count: number; actionType?: string }[] = [];

      // 1. Overdue follow-ups
      try {
        const overdue = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts
          WHERE "organizationId" = ? AND "assignedTo" = ? AND "nextActionDate" < ? AND "nextActionDate" IS NOT NULL
          AND "pipelineStage" NOT IN ('won', 'lost')
        `, orgId, userId, todayStr) as any)?.cnt || 0);
        if (overdue > 0) nudges.push({ type: 'overdue', priority: 'high', title: `${overdue} Overdue Follow-ups`, message: 'Contacts with past-due follow-up dates need attention', count: overdue, actionType: 'contacts' });
      } catch { }

      // 2. Emails needing reply — only CLASSIFIED human replies (positive, negative, general)
      // Excludes: OOO, auto_reply, bounce, and unclassified (NULL/empty) messages
      let emailsNeedingReply = 0;
      let hotReplies = 0;
      let warmReplies = 0;
      try {
        const needReplyBreakdown = (await storage.rawGet(`
          SELECT
            COUNT(*) as cnt,
            COUNT(*) FILTER (WHERE ui."replyQualityLabel" = 'Hot') as hot,
            COUNT(*) FILTER (WHERE ui."replyQualityLabel" = 'Warm') as warm
          FROM unified_inbox ui
          INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
          WHERE ui."organizationId" = ? AND ea."userId" = ?
          AND ui.status != 'replied' AND ui."repliedAt" IS NULL
          AND ui."repliedBy" IS NULL
          AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
          AND ui."replyType" IN ('positive', 'negative', 'general')
          AND LOWER(CASE WHEN ui."fromEmail" LIKE '%<%>%' THEN substring(ui."fromEmail" from '<([^>]+)>') ELSE ui."fromEmail" END) NOT IN (
            SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
            UNION
            SELECT LOWER(TRIM(ea2.email)) FROM warmup_accounts wa
              JOIN email_accounts ea2 ON ea2.id = wa."emailAccountId"
              WHERE wa."organizationId" = ? AND ea2.email IS NOT NULL
          )
          AND NOT (
            ui."threadId" IS NOT NULL AND EXISTS (
              SELECT 1 FROM unified_inbox ui2
              WHERE ui2."threadId" = ui."threadId"
                AND ui2."organizationId" = ui."organizationId"
                AND ui2."receivedAt" > ui."receivedAt"
                AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN (
                  SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
                  UNION
                  SELECT LOWER(TRIM(ea3.email)) FROM warmup_accounts wa2
                    JOIN email_accounts ea3 ON ea3.id = wa2."emailAccountId"
                    WHERE wa2."organizationId" = ? AND ea3.email IS NOT NULL
                )
            )
          )
        `, orgId, userId, orgId, orgId, orgId, orgId) as any) || {};
        emailsNeedingReply = parseInt(needReplyBreakdown.cnt || 0);
        hotReplies = parseInt(needReplyBreakdown.hot || 0);
        warmReplies = parseInt(needReplyBreakdown.warm || 0);
        if (emailsNeedingReply > 0) {
          const qualityBits: string[] = [];
          if (hotReplies > 0) qualityBits.push(`🔥 ${hotReplies} Hot`);
          if (warmReplies > 0) qualityBits.push(`⚡ ${warmReplies} Warm`);
          const msg = qualityBits.length
            ? `${qualityBits.join(' · ')} — prioritize these first`
            : 'Real human replies that haven\'t been responded to yet';
          nudges.push({ type: 'needs_reply', priority: 'high', title: `${emailsNeedingReply} Emails Need Reply`, message: msg, count: emailsNeedingReply, actionType: 'emails' });
        }
      } catch { }
      (stats as any).hotReplies = hotReplies;
      (stats as any).warmReplies = warmReplies;
      (stats as any).emailsNeedingReply = emailsNeedingReply;

      // 3. Unactioned replies (contacts replied to campaign but no activity logged after)
      try {
        const unactioned = parseInt((await storage.rawGet(`
          SELECT COUNT(DISTINCT m."contactId") as cnt
          FROM messages m
          JOIN contacts c ON c.id = m."contactId"
          LEFT JOIN contact_activities ca ON ca."contactId" = m."contactId" AND ca."createdAt" > m."repliedAt"
          WHERE c."organizationId" = ? AND c."assignedTo" = ?
          AND m."repliedAt" IS NOT NULL AND m."repliedAt" >= ? AND m."repliedAt" < ? AND ca.id IS NULL
        `, orgId, userId, startDate, endDate) as any)?.cnt || 0);
        if (unactioned > 0) nudges.push({ type: 'unactioned_reply', priority: 'high', title: `${unactioned} Unactioned Replies`, message: 'Contacts replied to campaigns but no follow-up activity logged', count: unactioned, actionType: 'contacts' });
      } catch { }

      // 4. Stale hot leads (interested/meeting stage, no activity in 3+ days)
      try {
        const threeDaysAgo = new Date(now); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const stale = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts c
          WHERE c."organizationId" = ? AND c."assignedTo" = ?
          AND c."pipelineStage" IN ('interested', 'meeting_scheduled', 'meeting_done')
          AND NOT EXISTS (
            SELECT 1 FROM contact_activities ca WHERE ca."contactId" = c.id AND ca."createdAt" >= ?
          )
        `, orgId, userId, threeDaysAgo.toISOString().split('T')[0]) as any)?.cnt || 0);
        if (stale > 0) nudges.push({ type: 'stale_leads', priority: 'medium', title: `${stale} Stale Hot Leads`, message: 'Hot leads with no activity in 3+ days — reach out before they go cold', count: stale, actionType: 'contacts' });
      } catch { }

      // 5. Proposals pending (proposal_sent for 3+ days with no update)
      try {
        const threeDaysAgo = new Date(now); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const pendingProposals = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM contacts c
          WHERE c."organizationId" = ? AND c."assignedTo" = ? AND c."pipelineStage" = 'proposal_sent'
          AND NOT EXISTS (
            SELECT 1 FROM contact_activities ca WHERE ca."contactId" = c.id AND ca."createdAt" >= ?
          )
        `, orgId, userId, threeDaysAgo.toISOString().split('T')[0]) as any)?.cnt || 0);
        if (pendingProposals > 0) nudges.push({ type: 'pending_proposals', priority: 'medium', title: `${pendingProposals} Proposals Awaiting Response`, message: 'Proposals sent 3+ days ago with no follow-up — time to check in', count: pendingProposals, actionType: 'contacts' });
      } catch { }

      // 6. No calls today (only for today period)
      if (period === 'today' && callsMade === 0) {
        nudges.push({ type: 'no_calls', priority: 'low', title: 'No Calls Made Today', message: 'Start your day with outbound calls to warm up your pipeline', count: 0 });
      }

      // 7. Win celebration
      if (wonCount > 0) {
        nudges.push({ type: 'celebration', priority: 'low', title: `${wonCount} Deal${wonCount > 1 ? 's' : ''} Won!`, message: `You closed ${wonCount > 1 ? 'deals' : 'a deal'} worth ₹${revenue.toLocaleString('en-IN')}`, count: wonCount });
      }

      // Sort nudges by priority
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      nudges.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

      // ── Recent Activity Feed (last 10) ──
      let recentActivities: any[] = [];
      try {
        recentActivities = await storage.rawAll(`
          SELECT ca.*, c."firstName", c."lastName", c.email as contactEmail, c.company
          FROM contact_activities ca
          JOIN contacts c ON c.id = ca."contactId"
          WHERE ca."organizationId" = ? AND ca."userId" = ?
          ORDER BY ca."createdAt" DESC LIMIT 10
        `, orgId, userId) as any[];
      } catch { }

      // Get org createdAt for month picker
      let orgCreatedAt = '2026-01-01';
      try {
        const org = await storage.getOrganization(orgId);
        if (org && (org as any).createdAt) orgCreatedAt = (org as any).createdAt;
      } catch { }

      res.json({ stats, nudges, recentActivities, period, orgCreatedAt });
    } catch (error: any) {
      console.error('[MyDashboard] Error:', error.message, error.stack);
      res.status(500).json({ message: 'Failed to fetch dashboard', error: error.message });
    }
  });

  // ── Daily Task Queue — structured action list for sales reps ──
  app.get('/api/my/task-queue', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const todayStr = new Date().toISOString().split('T')[0];
      const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

      const ownEmailsSubquery = `
        SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
        UNION
        SELECT LOWER(TRIM(ea2.email)) FROM warmup_accounts wa
          JOIN email_accounts ea2 ON ea2.id = wa."emailAccountId"
          WHERE wa."organizationId" = ? AND ea2.email IS NOT NULL
      `;

      // 1. Hot replies — positive/general inbox messages not yet replied to (limit 10)
      let hotReplies: any[] = [];
      try {
        hotReplies = await storage.rawAll(`
          SELECT ui.id, ui."fromName", ui."fromEmail", ui.subject, ui.snippet,
                 ui."receivedAt", ui."replyType", ui."replyQualityLabel", ui."replyQualityScore",
                 c."firstName", c."lastName", c.company, c.id as "contactId"
          FROM unified_inbox ui
          INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
          LEFT JOIN contacts c ON c.id = ui."contactId"
          WHERE ui."organizationId" = ? AND ea."userId" = ?
          AND ui.status != 'replied' AND ui."repliedAt" IS NULL AND ui."repliedBy" IS NULL
          AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
          AND ui."replyType" IN ('positive', 'negative', 'general')
          AND LOWER(TRIM(ui."fromEmail")) NOT IN (${ownEmailsSubquery})
          ORDER BY
            CASE ui."replyQualityLabel" WHEN 'Hot' THEN 0 WHEN 'Warm' THEN 1 ELSE 2 END,
            ui."receivedAt" DESC
          LIMIT 10
        `, orgId, userId, orgId, orgId) as any[];
      } catch { }

      // 2. Overdue follow-ups — contacts with nextActionDate in the past (limit 10)
      let overdueFollowups: any[] = [];
      try {
        overdueFollowups = await storage.rawAll(`
          SELECT c.id, c."firstName", c."lastName", c.email, c.company, c."pipelineStage",
                 c."nextActionDate",
                 EXTRACT(DAY FROM (NOW() - c."nextActionDate"::timestamptz))::int AS "daysOverdue"
          FROM contacts c
          WHERE c."organizationId" = ? AND c."assignedTo" = ?
          AND c."nextActionDate" < ? AND c."nextActionDate" IS NOT NULL
          AND c."pipelineStage" NOT IN ('won', 'lost')
          ORDER BY c."nextActionDate" ASC
          LIMIT 10
        `, orgId, userId, todayStr) as any[];
      } catch { }

      // 3. Stale hot leads — interested/meeting stage contacts with no activity in 3+ days (limit 10)
      let staleLeads: any[] = [];
      try {
        staleLeads = await storage.rawAll(`
          SELECT c.id, c."firstName", c."lastName", c.email, c.company, c."pipelineStage",
                 c."nextActionDate",
                 (SELECT MAX(ca."createdAt") FROM contact_activities ca WHERE ca."contactId" = c.id) AS "lastActivityAt"
          FROM contacts c
          WHERE c."organizationId" = ? AND c."assignedTo" = ?
          AND c."pipelineStage" IN ('interested', 'meeting_scheduled', 'meeting_done', 'proposal_sent')
          AND NOT EXISTS (
            SELECT 1 FROM contact_activities ca WHERE ca."contactId" = c.id AND ca."createdAt" >= ?
          )
          ORDER BY c."nextActionDate" ASC NULLS LAST
          LIMIT 10
        `, orgId, userId, threeDaysAgoStr) as any[];
      } catch { }

      // 4. Today's activity counts (auto-tracked)
      const todayStart = todayStr;
      const todayEnd = new Date(); todayEnd.setDate(todayEnd.getDate() + 1);
      const todayEndStr = todayEnd.toISOString().split('T')[0];

      let todayEmailsSent = 0;
      let todayCallsMade = 0;
      let todayMeetings = 0;
      let todayWhatsApp = 0;
      try {
        const acts = await storage.rawAll(`
          SELECT type, COUNT(*) as cnt FROM contact_activities
          WHERE "organizationId" = ? AND "userId" = ? AND "createdAt" >= ? AND "createdAt" < ?
          GROUP BY type
        `, orgId, userId, todayStart, todayEndStr) as any[];
        const actMap: Record<string, number> = {};
        for (const a of acts) actMap[a.type] = parseInt(a.cnt || 0);
        todayCallsMade = actMap['call'] || 0;
        todayMeetings = actMap['meeting'] || 0;
        todayWhatsApp = actMap['whatsapp'] || 0;
      } catch { }
      try {
        todayEmailsSent = parseInt((await storage.rawGet(`
          SELECT COUNT(*) as cnt FROM messages m
          JOIN email_accounts ea ON ea.id = m."emailAccountId"
          WHERE ea."organizationId" = ? AND ea."userId" = ? AND m.status = 'sent' AND m."sentAt" >= ? AND m."sentAt" < ?
          AND LOWER(TRIM(COALESCE(m."recipientEmail", ''))) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
        `, orgId, userId, todayStart, todayEndStr) as any)?.cnt || 0);
      } catch { }

      // 5. Load daily targets from api_settings (admin-configurable)
      let targets = { emails: 50, calls: 10, meetings: 1, whatsapp: 15 };
      try {
        const targetsRow = await storage.rawGet(
          `SELECT value FROM api_settings WHERE "organizationId" = ? AND key = 'daily_activity_targets'`,
          orgId
        ) as any;
        if (targetsRow?.value) {
          const parsed = JSON.parse(targetsRow.value);
          targets = { ...targets, ...parsed };
        }
      } catch { }

      res.json({
        hotReplies,
        overdueFollowups,
        staleLeads,
        todayProgress: {
          emailsSent: todayEmailsSent,
          callsMade: todayCallsMade,
          meetingsDone: todayMeetings,
          whatsappSent: todayWhatsApp,
        },
        targets,
        summary: {
          hotRepliesCount: hotReplies.length,
          overdueCount: overdueFollowups.length,
          staleCount: staleLeads.length,
        }
      });
    } catch (error: any) {
      console.error('[TaskQueue] Error:', error.message);
      res.status(500).json({ message: 'Failed to fetch task queue' });
    }
  });

  // ── Log a manual activity from task queue (call/whatsapp/meeting) ──
  app.post('/api/my/log-activity', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const { contactId, type, outcome, notes } = req.body;
      if (!type) return res.status(400).json({ message: 'type required' });

      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      // contactId is NOT NULL in schema — use '__none__' when logging without a specific contact
      const safeContactId = contactId || '__none__';
      await storage.rawRun(`
        INSERT INTO contact_activities (id, "organizationId", "contactId", "userId", type, outcome, notes, "createdAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, id, orgId, safeContactId, userId, type, outcome || null, notes || null, now);

      res.json({ success: true, id });
    } catch (error: any) {
      console.error('[LogActivity] Error:', error.message);
      res.status(500).json({ message: 'Failed to log activity' });
    }
  });

  // ── Emails needing reply (detail list for nudge click) ──
  app.get('/api/my/emails-needing-reply', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const emails = await storage.rawAll(`
        SELECT ui.id, ui."fromEmail", ui."fromName", ui."toEmail", ui.subject, ui.snippet, ui.body, ui."bodyHtml",
               ui."receivedAt", ui.status, ui."campaignId", ui."contactId", ui."replyType",
               ui."replyQualityScore", ui."replyQualityLabel",
               c."firstName" as contactFirstName, c."lastName" as contactLastName, c.company as contactCompany,
               camp.name as campaignName
        FROM unified_inbox ui
        INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
        LEFT JOIN contacts c ON c.id = ui."contactId"
        LEFT JOIN campaigns camp ON camp.id = ui."campaignId"
        WHERE ui."organizationId" = ? AND ea."userId" = ?
        AND ui.status != 'replied' AND ui."repliedAt" IS NULL
        AND ui."repliedBy" IS NULL
        AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
        AND ui."replyType" IN ('positive', 'negative', 'general')
        AND LOWER(CASE WHEN ui."fromEmail" LIKE '%<%>%' THEN substring(ui."fromEmail" from '<([^>]+)>') ELSE ui."fromEmail" END) NOT IN (
          SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
          UNION
          SELECT LOWER(TRIM(ea2.email)) FROM warmup_accounts wa
            JOIN email_accounts ea2 ON ea2.id = wa."emailAccountId"
            WHERE wa."organizationId" = ? AND ea2.email IS NOT NULL
        )
        AND NOT (
          ui."threadId" IS NOT NULL AND EXISTS (
            SELECT 1 FROM unified_inbox ui2
            WHERE ui2."threadId" = ui."threadId"
              AND ui2."organizationId" = ui."organizationId"
              AND ui2."receivedAt" > ui."receivedAt"
              AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN (
                SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
                UNION
                SELECT LOWER(TRIM(ea3.email)) FROM warmup_accounts wa2
                  JOIN email_accounts ea3 ON ea3.id = wa2."emailAccountId"
                  WHERE wa2."organizationId" = ? AND ea3.email IS NOT NULL
              )
          )
        )
        ORDER BY COALESCE(ui."replyQualityScore", -1) DESC, ui."receivedAt" DESC
        LIMIT ? OFFSET ?
      `, orgId, userId, orgId, orgId, orgId, orgId, limit, offset) as any[];

      const total = (await storage.rawGet(`
        SELECT COUNT(*) as cnt FROM unified_inbox ui
        INNER JOIN email_accounts ea ON ea.id = ui."emailAccountId"
        WHERE ui."organizationId" = ? AND ea."userId" = ?
        AND ui.status != 'replied' AND ui."repliedAt" IS NULL
        AND ui."repliedBy" IS NULL
        AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
        AND ui."replyType" IN ('positive', 'negative', 'general')
        AND LOWER(CASE WHEN ui."fromEmail" LIKE '%<%>%' THEN substring(ui."fromEmail" from '<([^>]+)>') ELSE ui."fromEmail" END) NOT IN (
          SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
          UNION
          SELECT LOWER(TRIM(ea2.email)) FROM warmup_accounts wa
            JOIN email_accounts ea2 ON ea2.id = wa."emailAccountId"
            WHERE wa."organizationId" = ? AND ea2.email IS NOT NULL
        )
        AND NOT (
          ui."threadId" IS NOT NULL AND EXISTS (
            SELECT 1 FROM unified_inbox ui2
            WHERE ui2."threadId" = ui."threadId"
              AND ui2."organizationId" = ui."organizationId"
              AND ui2."receivedAt" > ui."receivedAt"
              AND LOWER(CASE WHEN ui2."fromEmail" LIKE '%<%>%' THEN substring(ui2."fromEmail" from '<([^>]+)>') ELSE ui2."fromEmail" END) IN (
                SELECT LOWER(TRIM(email)) FROM email_accounts WHERE "organizationId" = ? AND email IS NOT NULL
                UNION
                SELECT LOWER(TRIM(ea3.email)) FROM warmup_accounts wa2
                  JOIN email_accounts ea3 ON ea3.id = wa2."emailAccountId"
                  WHERE wa2."organizationId" = ? AND ea3.email IS NOT NULL
              )
          )
        )
      `, orgId, userId, orgId, orgId, orgId, orgId) as any)?.cnt || 0;

      res.json({ emails, total });
    } catch (error: any) {
      console.error('[EmailsNeedingReply] Error:', error.message);
      res.status(500).json({ message: 'Failed to fetch emails' });
    }
  });

  // ── Reclassify existing inbox messages using AI (admin trigger) ──
  app.post('/api/inbox/reclassify', requireAuth, async (req: any, res) => {
    const orgId = req.user.organizationId;
    const role = req.user.role;
    if (role !== 'owner' && role !== 'admin') return res.status(403).json({ message: 'Admin only' });

    // Count how many need reclassification
    const totalCount = parseInt((await storage.rawGet(`
      SELECT COUNT(*) as cnt FROM unified_inbox
      WHERE "organizationId" = ?
      AND ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
      AND ("sentByUs" IS NULL OR "sentByUs" = 0)
    `, orgId) as any)?.cnt || 0);

    res.json({ message: `Reclassification started for ${totalCount} messages. Rules first, then AI for remaining.` });

    // Run async after response
    (async () => {
      try {
        // Phase 1: Rule-based reclassification on ALL unclassified (NULL, empty, general)
        const msgs = await storage.rawAll(`
          SELECT id, subject, body, snippet, "fromEmail", "fromName", "replyType"
          FROM unified_inbox
          WHERE "organizationId" = ?
          AND ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
          AND ("sentByUs" IS NULL OR "sentByUs" = 0)
          LIMIT 5000
        `, orgId) as any[];

        let ruleReclassified = 0;
        for (const msg of msgs) {
          const ruleResult = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);
          if (ruleResult.replyType !== 'general') {
            try {
              await storage.rawRun(`UPDATE unified_inbox SET "replyType" = ? WHERE id = ?`, ruleResult.replyType, msg.id);
              ruleReclassified++;
            } catch { }
          }
        }
        console.log(`[Reclassify] Phase 1 (rules): ${ruleReclassified}/${msgs.length} reclassified for org ${orgId}`);

        // Phase 2: AI reclassification for remaining general/unclassified (limit 200)
        const remaining = await storage.rawAll(`
          SELECT id, subject, body, snippet, "fromEmail", "fromName"
          FROM unified_inbox
          WHERE "organizationId" = ?
          AND ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
          AND ("sentByUs" IS NULL OR "sentByUs" = 0)
          LIMIT 200
        `, orgId) as any[];

        let aiReclassified = 0;
        for (const msg of remaining) {
          try {
            const aiResult = await classifyReplyWithAI(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, orgId, storage);
            if (aiResult.confidence >= 0.6 && aiResult.replyType !== 'general') {
              await storage.rawRun(`UPDATE unified_inbox SET "replyType" = ? WHERE id = ?`, aiResult.replyType, msg.id);
              aiReclassified++;
            }
          } catch { /* skip individual failures */ }
        }
        console.log(`[Reclassify] Phase 2 (AI): ${aiReclassified}/${remaining.length} reclassified for org ${orgId}`);
        console.log(`[Reclassify] Total: ${ruleReclassified + aiReclassified} messages reclassified`);
      } catch (e: any) {
        console.error('[Reclassify] Error:', e.message);
      }
    })();
  });

  // ── Reclassify status check ──
  app.get('/api/inbox/reclassify/status', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const breakdown = await storage.rawAll(`
        SELECT "replyType", COUNT(*) as cnt FROM unified_inbox
        WHERE "organizationId" = ? AND ("sentByUs" IS NULL OR "sentByUs" = 0)
        GROUP BY "replyType" ORDER BY cnt DESC
      `, orgId) as any[];
      const remaining = parseInt((await storage.rawGet(`
        SELECT COUNT(*) as cnt FROM unified_inbox
        WHERE "organizationId" = ?
        AND ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
        AND ("sentByUs" IS NULL OR "sentByUs" = 0)
      `, orgId) as any)?.cnt || 0);
      res.json({ breakdown, remaining });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get('/api/team/members', requireAuth, async (req: any, res) => {
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
  // Prioritizes the inviter's own email account so invitations come from the person who invited
  async function sendInvitationEmail(
    orgId: string,
    inviteeEmail: string,
    inviterName: string,
    inviterEmail: string,
    orgName: string,
    role: string,
    acceptUrl: string
  ): Promise<{ sent: boolean; method?: string; error?: string }> {
    try {
      const settings = await storage.getApiSettings(orgId);
      const allAccounts = await storage.getEmailAccounts(orgId);

      // Sort accounts so the inviter's own email account comes first
      const accounts = [...allAccounts].sort((a, b) => {
        const aIsInviter = a.email?.toLowerCase() === inviterEmail.toLowerCase() ? -1 : 0;
        const bIsInviter = b.email?.toLowerCase() === inviterEmail.toLowerCase() ? -1 : 0;
        return aIsInviter - bIsInviter;
      });
      
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

      // Helper: try sending via Gmail API for a specific account
      async function tryGmailSend(email: string, accessToken: string, refreshToken?: string): Promise<boolean> {
        let token = accessToken;
        // Check if per-sender token needs refresh
        const senderExpiry = parseInt(settings[`gmail_sender_${email}_token_expiry`] || '0');
        const orgExpiry = parseInt(settings.gmail_token_expiry || '0');
        const expiry = email === settings.gmail_user_email ? orgExpiry : senderExpiry;
        if (Date.now() >= expiry - 300000 && refreshToken) {
          const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
          const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
          if (clientId && clientSecret) {
            try {
              const oauth2 = createOAuth2Client({ clientId, clientSecret, redirectUri: '' });
              oauth2.setCredentials({ refresh_token: refreshToken });
              const { credentials } = await oauth2.refreshAccessToken();
              if (credentials.access_token) token = credentials.access_token;
            } catch (e) { console.error(`[InviteEmail] Gmail token refresh failed for ${email}:`, e); }
          }
        }
        const raw = createRawEmail({ from: email, to: inviteeEmail, subject, body: htmlBody });
        const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (resp.ok) {
          console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via Gmail API from ${email}`);
          return true;
        }
        console.error(`[InviteEmail] Gmail API failed for ${email} (${resp.status}):`, await resp.text());
        return false;
      }

      // Helper: try sending via Microsoft Graph for a specific account
      async function tryMsGraphSend(accessToken: string, accountEmail?: string): Promise<boolean> {
        const message = {
          subject,
          body: { contentType: 'HTML' as const, content: htmlBody },
          toRecipients: [{ emailAddress: { address: inviteeEmail } }],
        };
        const resp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (resp.ok) {
          console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via Microsoft Graph${accountEmail ? ` from ${accountEmail}` : ''}`);
          return true;
        }
        console.error(`[InviteEmail] Microsoft Graph failed${accountEmail ? ` for ${accountEmail}` : ''} (${resp.status}):`, await resp.text());
        return false;
      }

      // PRIORITY 1: Try inviter's own per-sender Gmail token
      const inviterGmailToken = settings[`gmail_sender_${inviterEmail}_access_token`];
      const inviterGmailRefresh = settings[`gmail_sender_${inviterEmail}_refresh_token`];
      if (inviterGmailToken) {
        if (await tryGmailSend(inviterEmail, inviterGmailToken, inviterGmailRefresh)) {
          return { sent: true, method: 'gmail-api' };
        }
      }

      // PRIORITY 2: Try inviter's own per-sender Outlook token
      const inviterMsToken = settings[`outlook_sender_${inviterEmail}_access_token`];
      if (inviterMsToken) {
        if (await tryMsGraphSend(inviterMsToken, inviterEmail)) {
          return { sent: true, method: 'microsoft-graph' };
        }
      }

      // PRIORITY 3: Try inviter's SMTP account directly
      const inviterAccount = accounts.find(a => a.email?.toLowerCase() === inviterEmail.toLowerCase() && a.isActive);
      if (inviterAccount && inviterAccount.smtpConfig && inviterAccount.smtpConfig.auth?.pass && inviterAccount.smtpConfig.auth.pass !== 'OAUTH_TOKEN') {
        try {
          const sendResult = await smtpEmailService.sendEmail(inviterAccount.id, inviterAccount.smtpConfig, {
            to: inviteeEmail, subject, html: htmlBody,
          });
          if (sendResult.success) {
            console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via SMTP from inviter (${inviterAccount.email})`);
            return { sent: true, method: 'smtp' };
          }
        } catch (e) { console.error(`[InviteEmail] SMTP send failed for inviter ${inviterAccount.email}:`, e); }
      }

      // PRIORITY 4: Try org-level Gmail (if it matches inviter email)
      const gmailEmail = settings.gmail_user_email;
      const gmailAccessToken = settings.gmail_access_token;
      const gmailRefreshToken = settings.gmail_refresh_token;
      if (gmailAccessToken && gmailEmail) {
        if (await tryGmailSend(gmailEmail, gmailAccessToken, gmailRefreshToken)) {
          return { sent: true, method: 'gmail-api' };
        }
      }

      // PRIORITY 5: Try org-level Microsoft Graph
      const msAccessToken = settings.microsoft_access_token;
      if (msAccessToken) {
        if (await tryMsGraphSend(msAccessToken)) {
          return { sent: true, method: 'microsoft-graph' };
        }
      }

      // PRIORITY 6: Try remaining SMTP accounts (sorted so inviter's account is first via sort above)
      for (const account of accounts) {
        if (account.email?.toLowerCase() === inviterEmail.toLowerCase()) continue; // already tried
        if (account.smtpConfig && account.smtpConfig.auth?.pass && account.smtpConfig.auth.pass !== 'OAUTH_TOKEN' && account.isActive) {
          try {
            const sendResult = await smtpEmailService.sendEmail(account.id, account.smtpConfig, {
              to: inviteeEmail, subject, html: htmlBody,
            });
            if (sendResult.success) {
              console.log(`[InviteEmail] Invitation sent to ${inviteeEmail} via SMTP (${account.email})`);
              return { sent: true, method: 'smtp' };
            }
          } catch (e) { console.error(`[InviteEmail] SMTP send failed for ${account.email}:`, e); }
        }
      }

      // PRIORITY 7: Try per-sender Gmail tokens for other accounts
      for (const account of accounts) {
        if (account.email?.toLowerCase() === inviterEmail.toLowerCase()) continue; // already tried
        if (account.provider === 'gmail' && account.isActive) {
          const senderToken = settings[`gmail_sender_${account.email}_access_token`];
          const senderRefresh = settings[`gmail_sender_${account.email}_refresh_token`];
          if (senderToken) {
            if (await tryGmailSend(account.email, senderToken, senderRefresh)) {
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
        req.user.email || '',
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

  // ========== DATABASE EXPORT/IMPORT (SUPERADMIN ONLY) ==========
  // Export entire database as JSON for backup/restore
  app.get('/api/superadmin/db-export', async (req: any, res) => {
    try {
      console.log(`[DB Export] SuperAdmin ${req.user.email} exporting database...`);
      
      const tables = [
        'users', 'organizations', 'org_members', 'api_settings',
        'email_accounts', 'templates', 'campaigns', 'messages', 'contacts',
        'contact_lists', 'contact_list_members', 'tracking_events',
        'unified_inbox', 'followup_sequences', 'followup_steps', 'followup_messages',
        'suppression_list', 'notifications', 'contact_activity',
      ];
      
      const exportData: Record<string, any[]> = {};
      let totalRows = 0;
      
      for (const table of tables) {
        try {
          const rows = storage.exportTable(table);
          exportData[table] = rows;
          totalRows += rows.length;
          console.log(`[DB Export] ${table}: ${rows.length} rows`);
        } catch (e) {
          console.warn(`[DB Export] Table ${table} not found or error:`, e);
          exportData[table] = [];
        }
      }
      
      const exportPayload = {
        version: 'aimailpilot-v18',
        exportedAt: new Date().toISOString(),
        exportedBy: req.user.email,
        totalRows,
        tables: exportData,
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=aimailpilot-backup-${new Date().toISOString().slice(0, 10)}.json`);
      res.json(exportPayload);
      console.log(`[DB Export] Complete: ${totalRows} total rows across ${tables.length} tables`);
    } catch (error) {
      console.error('[DB Export] Failed:', error);
      res.status(500).json({ message: 'Failed to export database' });
    }
  });

  // Import database from JSON backup (DESTRUCTIVE - replaces all data)
  app.post('/api/superadmin/db-import', async (req: any, res) => {
    try {
      const importData = req.body;
      
      if (!importData || !importData.tables) {
        return res.status(400).json({ message: 'Invalid import data. Expected JSON with "tables" object.' });
      }
      
      console.log(`[DB Import] SuperAdmin ${req.user.email} importing database...`);
      console.log(`[DB Import] Source: ${importData.version || 'unknown'}, exported: ${importData.exportedAt || 'unknown'}, totalRows: ${importData.totalRows || 'unknown'}`);
      
      // Import order matters due to foreign keys
      const importOrder = [
        'organizations', 'users', 'org_members', 'api_settings',
        'email_accounts', 'contact_lists', 'contacts', 'contact_list_members',
        'templates', 'campaigns', 'messages', 'tracking_events',
        'unified_inbox', 'followup_sequences', 'followup_steps', 'followup_messages',
        'suppression_list', 'notifications', 'contact_activity',
      ];
      
      let totalImported = 0;
      const results: Record<string, { imported: number; errors: number }> = {};
      
      for (const table of importOrder) {
        // Support both old and new table names
        let rows = importData.tables[table];
        if (!rows && table === 'org_members') rows = importData.tables['organization_members'];
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          results[table] = { imported: 0, errors: 0 };
          continue;
        }
        
        try {
          const result = storage.importTable(table, rows);
          results[table] = result;
          totalImported += result.imported;
          console.log(`[DB Import] ${table}: ${result.imported} imported, ${result.errors} errors`);
        } catch (e) {
          console.error(`[DB Import] Table ${table} import failed:`, e);
          results[table] = { imported: 0, errors: rows.length };
        }
      }
      
      res.json({
        success: true,
        message: `Imported ${totalImported} rows`,
        totalImported,
        results,
        importedAt: new Date().toISOString(),
      });
      console.log(`[DB Import] Complete: ${totalImported} total rows imported`);
    } catch (error) {
      console.error('[DB Import] Failed:', error);
      res.status(500).json({ message: 'Failed to import database' });
    }
  });

  // Quick DB status check (no auth required for debugging)
  app.get('/api/db-status', async (_req, res) => {
    try {
      const stats = await storage.getPlatformStats();
      const tables = ['users', 'organizations', 'campaigns', 'templates', 'contacts', 'messages', 'tracking_events', 'email_accounts', 'unified_inbox'];
      const counts: Record<string, number> = {};
      for (const table of tables) {
        try {
          const rows = storage.exportTable(table);
          counts[table] = rows.length;
        } catch (e) {
          counts[table] = -1;
        }
      }
      res.json({
        dbPath: storage.getDbPath(),
        isAzure: storage.isAzureEnvironment(),
        stats,
        tableCounts: counts,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get DB status', error: String(error) });
    }
  });

  // ========== OAuth redirect URI diagnostic ==========
  app.get('/api/oauth-debug', async (req: any, res) => {
    try {
      const googleCreds = await getStoredOAuthCredentials('google');
      const msCreds = await getStoredOAuthCredentials('microsoft');
      const googleRedirect = getGoogleRedirectUri(req);
      const msRedirect = getMicrosoftRedirectUri(req);
      res.json({
        google: {
          clientId: googleCreds.clientId ? googleCreds.clientId.substring(0, 20) + '...' : 'NOT SET',
          hasSecret: !!googleCreds.clientSecret,
          redirectUri: googleRedirect,
        },
        microsoft: {
          clientId: msCreds.clientId ? msCreds.clientId.substring(0, 20) + '...' : 'NOT SET',
          hasSecret: !!msCreds.clientSecret,
          redirectUri: msRedirect,
        },
        requestHeaders: {
          host: req.headers['host'],
          xForwardedHost: req.headers['x-forwarded-host'],
          xOriginalHost: req.headers['x-original-host'],
          xForwardedProto: req.headers['x-forwarded-proto'],
        },
        instruction: 'The redirect URIs above MUST be registered EXACTLY in Google Cloud Console > Credentials > OAuth Client > Authorized redirect URIs. Go add them if missing.',
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ========== EMERGENCY DB RESET (for corrupted databases) ==========
  app.post('/api/db-reset', async (req: any, res) => {
    try {
      const restoreKey = req.headers['x-restore-key'] || req.body.restoreKey;
      if (restoreKey !== 'aimailpilot-restore-2026') {
        return res.status(403).json({ message: 'Invalid restore key' });
      }
      console.log('[DB Reset] Emergency database reset initiated');
      const result = storage.resetCorruptDatabase();
      console.log('[DB Reset] Result:', result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: 'Reset failed', error: String(error) });
    }
  });

  // ========== BOOTSTRAP DB RESTORE (emergency, works when DB is empty) ==========
  // This endpoint ONLY works when the database has NO users (i.e., after a DB wipe/corruption recovery).
  // Once users exist, it returns 403 and you must use the superadmin endpoint instead.
  // Security: a simple secret key must be provided to prevent unauthorized restores.
  app.post('/api/db-restore', async (req: any, res) => {
    try {
      // Security check: require a restore key
      const restoreKey = req.headers['x-restore-key'] || req.body.restoreKey;
      if (restoreKey !== 'aimailpilot-restore-2026') {
        return res.status(403).json({ message: 'Invalid restore key' });
      }
      
      // Safety check: only allow when DB has no REAL users (seed data has <=1 user)
      const stats = await storage.getPlatformStats();
      if (stats.totalUsers > 1) {
        return res.status(403).json({ 
          message: 'Database has real user data. Use /api/superadmin/db-import instead.',
          totalUsers: stats.totalUsers,
        });
      }
      
      const importData = req.body;
      if (!importData || !importData.tables) {
        return res.status(400).json({ message: 'Invalid import data. Expected JSON with "tables" object.' });
      }
      
      console.log(`[DB Restore] Bootstrap restore initiated. Source: ${importData.version || 'unknown'}, rows: ${importData.totalRows || 'unknown'}`);
      
      const importOrder = [
        'organizations', 'users', 'organization_members', 'api_settings',
        'email_accounts', 'contact_lists', 'contacts', 'contact_list_members',
        'templates', 'campaigns', 'messages', 'tracking_events',
        'unified_inbox', 'followup_sequences', 'followup_steps', 'followup_messages',
      ];
      
      let totalImported = 0;
      const results: Record<string, { imported: number; errors: number }> = {};
      
      for (const table of importOrder) {
        const rows = importData.tables[table];
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          results[table] = { imported: 0, errors: 0 };
          continue;
        }
        
        try {
          const result = storage.importTable(table, rows);
          results[table] = result;
          totalImported += result.imported;
          console.log(`[DB Restore] ${table}: ${result.imported} imported, ${result.errors} errors`);
        } catch (e) {
          console.error(`[DB Restore] Table ${table} import failed:`, e);
          results[table] = { imported: 0, errors: rows.length };
        }
      }
      
      res.json({
        success: true,
        message: `Bootstrap restore complete: ${totalImported} rows imported`,
        totalImported,
        results,
        restoredAt: new Date().toISOString(),
      });
      console.log(`[DB Restore] Complete: ${totalImported} total rows restored`);
    } catch (error) {
      console.error('[DB Restore] Failed:', error);
      res.status(500).json({ message: 'Failed to restore database', error: String(error) });
    }
  });

  // ========== ADMIN FIX: Restore org_members + superadmin (one-time repair) ==========
  app.post('/api/admin-fix', async (req: any, res) => {
    try {
      const restoreKey = req.headers['x-restore-key'] || req.body.restoreKey;
      if (restoreKey !== 'aimailpilot-restore-2026') {
        return res.status(403).json({ message: 'Invalid restore key' });
      }
      
      const fixes: string[] = [];
      
      // 1. Get all users and their orgs
      const allUsers = storage.exportTable('users');
      console.log(`[AdminFix] Found ${allUsers.length} users`);
      
      // 2. Restore org_members for each user
      for (const user of allUsers) {
        if (!user.organizationId) continue;
        
        // Check if org_members row exists
        const existing = storage.exportTable('org_members').filter(
          (m: any) => m.userId === user.id && m.organizationId === user.organizationId
        );
        
        if (existing.length === 0) {
          const memberId = `fix-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          try {
            storage.importTable('org_members', [{
              id: memberId,
              organizationId: user.organizationId,
              userId: user.id,
              role: user.role || 'admin',
              isActive: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }]);
            fixes.push(`Added org_member for ${user.email} in org ${user.organizationId}`);
          } catch (e) {
            fixes.push(`Failed to add org_member for ${user.email}: ${e}`);
          }
        } else {
          fixes.push(`org_member already exists for ${user.email}`);
        }
      }
      
      // 3. Promote specified user to superadmin using direct UPDATE
      const targetEmail = req.body.superadminEmail || 'dev@aegis.edu.in';
      const targetUser = allUsers.find((u: any) => u.email === targetEmail);
      if (targetUser) {
        try {
          storage.runDirectSQL(
            `UPDATE users SET isSuperAdmin = 1, role = 'admin' WHERE id = ?`,
            [targetUser.id]
          );
          fixes.push(`Promoted ${targetEmail} (id: ${targetUser.id}) to superadmin`);
        } catch (e) {
          fixes.push(`Failed to promote ${targetEmail}: ${e}`);
        }
      } else {
        fixes.push(`User ${targetEmail} not found`);
      }
      
      // 4. Update settings if provided
      if (req.body.settings && typeof req.body.settings === 'object') {
        const orgId = req.body.orgId || '550e8400-e29b-41d4-a716-446655440001';
        for (const [key, value] of Object.entries(req.body.settings)) {
          try {
            storage.runDirectSQL(
              `UPDATE api_settings SET settingValue = ?, updatedAt = ? WHERE settingKey = ? AND organizationId = ?`,
              [value, new Date().toISOString(), key, orgId]
            );
            fixes.push(`Updated setting ${key} for org ${orgId}`);
          } catch (e) {
            fixes.push(`Failed to update setting ${key}: ${e}`);
          }
        }
      }

      // 5. Return summary
      const stats = await storage.getPlatformStats();
      res.json({
        success: true,
        fixes,
        currentStats: {
          superAdmins: stats.superAdmins,
          totalUsers: stats.totalUsers,
          orgMembers: storage.exportTable('org_members').length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[AdminFix] Failed:', error);
      res.status(500).json({ message: 'Admin fix failed', error: String(error) });
    }
  });

  // Start Gmail/Outlook reply & bounce tracking auto-check for all organizations
  // CRITICAL: Check BOTH org-level AND per-sender tokens (outlook_sender_*, gmail_sender_*)
  // Previously only org-level tokens were checked, causing bounce tracking to not start
  // for orgs where tokens are stored per-sender (e.g., after OAuth connect flow)
  try {
    const allOrgIds = await storage.getAllOrganizationIds();
    // Stagger org startup to prevent thundering herd: all orgs firing runCheck()
    // simultaneously saturates the PG pool and Google/MS API rate limits.
    for (let i = 0; i < allOrgIds.length; i++) {
      const orgId = allOrgIds[i];
      const orgSettings = await storage.getApiSettings(orgId);
      const stagger = i * 3000; // 3s per org
      if (orgHasGmailTokens(orgSettings)) {
        console.log(`[ReplyTracker] Gmail tokens found for org ${orgId}, starting auto-check in ${stagger}ms...`);
        setTimeout(() => gmailReplyTracker.startAutoCheck(orgId, 5), stagger);
      }
      if (orgHasOutlookTokens(orgSettings)) {
        console.log(`[ReplyTracker] Outlook tokens found for org ${orgId}, starting auto-check in ${stagger}ms...`);
        setTimeout(() => outlookReplyTracker.startAutoCheck(orgId, 5), stagger);
      }
    }
  } catch (e) {
    console.error('[ReplyTracker] Failed to start auto-check on startup:', e);
  }

  // ==================== EMAIL VERIFICATION ENDPOINTS ====================

  // Test EmailListVerify API connection
  app.post('/api/email-verify/test', requireAuth, async (req: any, res) => {
    try {
      let apiKey = req.body.apiKey;
      // If the frontend sent a masked value or empty, read the real key from DB
      if (!apiKey || apiKey.startsWith('••••')) {
        // Try superadmin org first, then current user's org
        apiKey = await getEmailVerifyApiKey();
        if (!apiKey) {
          const orgId = req.user?.organizationId || req.session?.organizationId;
          if (orgId) {
            const settings = await storage.getApiSettings(orgId);
            apiKey = settings.emaillistverify_api_key || null;
          }
        }
      }
      if (!apiKey) return res.status(400).json({ message: 'API key not configured. Enter your key and save first.' });
      console.log(`[EmailVerify] Testing with key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)} (len=${apiKey.length})`);
      const result = await checkCredits(apiKey);
      if (result.valid) {
        res.json({ success: true, credits: result.credits });
      } else {
        res.status(400).json({ message: result.raw || 'Invalid API key or connection failed' });
      }
    } catch (e: any) {
      console.error(`[EmailVerify] Test error:`, e.message);
      res.status(500).json({ message: e.message || 'Connection test failed' });
    }
  });

  // Get verification stats for current org
  app.get('/api/email-verify/stats', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const stats = await storage.rawAll(`
        SELECT "emailVerificationStatus", COUNT(*) as count
        FROM contacts WHERE "organizationId" = ?
        GROUP BY "emailVerificationStatus"
      `, orgId);
      const apiKey = await getEmailVerifyApiKey();
      let credits = null;
      if (apiKey) {
        const creditResult = await checkCredits(apiKey);
        credits = creditResult.credits;
      }
      res.json({ stats, credits, hasApiKey: !!apiKey });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Verify specific contacts (by IDs)
  app.post('/api/contacts/verify', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { contactIds } = req.body;
      if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: 'contactIds array required' });
      }
      const apiKey = await getEmailVerifyApiKey();
      if (!apiKey) return res.status(400).json({ message: 'EmailListVerify API key not configured. Ask your admin to add it in SuperAdmin > Advanced Settings.' });

      // Fetch contacts
      const placeholders = contactIds.map(() => '?').join(',');
      const contacts = await storage.rawAll(`SELECT id, email FROM contacts WHERE id IN (${placeholders}) AND "organizationId" = ?`, ...contactIds, orgId);

      if (contacts.length === 0) return res.status(404).json({ message: 'No contacts found' });

      const emails = contacts.map((c: any) => ({ contactId: c.id, email: c.email }));
      const now = new Date().toISOString();

      // Verify in batch with progress
      const results = await verifyBatch(emails, apiKey);

      // Update contacts in DB
      let verified = 0, invalid = 0, risky = 0;
      for (const [contactId, result] of results) {
        await storage.rawRun(`UPDATE contacts SET "emailVerificationStatus" = ?, "emailVerifiedAt" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, result.status, now, now, contactId, orgId);
        if (result.status === 'valid') verified++;
        else if (result.status === 'invalid' || result.status === 'disposable' || result.status === 'spamtrap') invalid++;
        else if (result.status === 'risky') risky++;
      }

      res.json({ total: results.size, verified, invalid, risky });
    } catch (e: any) {
      res.status(500).json({ message: e.message || 'Verification failed' });
    }
  });

  // Verify all contacts in a list
  app.post('/api/contacts/verify-list', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { listId, statusFilter } = req.body; // statusFilter: 'unverified' | 'all'
      const apiKey = await getEmailVerifyApiKey();
      if (!apiKey) return res.status(400).json({ message: 'EmailListVerify API key not configured. Ask your admin to add it in SuperAdmin > Advanced Settings.' });

      let contacts;
      if (listId) {
        const filter = statusFilter === 'all' ? '' : `AND ("emailVerificationStatus" = 'unverified' OR "emailVerificationStatus" IS NULL)`;
        contacts = await storage.rawAll(`SELECT id, email FROM contacts WHERE "listId" = ? AND "organizationId" = ? ${filter}`, listId, orgId);
      } else {
        const filter = statusFilter === 'all' ? '' : `AND ("emailVerificationStatus" = 'unverified' OR "emailVerificationStatus" IS NULL)`;
        contacts = await storage.rawAll(`SELECT id, email FROM contacts WHERE "organizationId" = ? ${filter}`, orgId);
      }

      if (contacts.length === 0) return res.json({ total: 0, verified: 0, invalid: 0, risky: 0, message: 'No contacts to verify' });
      if (contacts.length > 5000) return res.status(400).json({ message: `Too many contacts (${contacts.length}). Please verify by list or in smaller batches (max 5000).` });

      const emails = contacts.map((c: any) => ({ contactId: c.id, email: c.email }));
      const now = new Date().toISOString();
      const results = await verifyBatch(emails, apiKey);

      let verified = 0, invalid = 0, risky = 0;
      for (const [contactId, result] of results) {
        await storage.rawRun(`UPDATE contacts SET "emailVerificationStatus" = ?, "emailVerifiedAt" = ?, "updatedAt" = ? WHERE id = ? AND "organizationId" = ?`, result.status, now, now, contactId, orgId);
        if (result.status === 'valid') verified++;
        else if (result.status === 'invalid' || result.status === 'disposable' || result.status === 'spamtrap') invalid++;
        else if (result.status === 'risky') risky++;
      }

      res.json({ total: results.size, verified, invalid, risky });
    } catch (e: any) {
      res.status(500).json({ message: e.message || 'Verification failed' });
    }
  });

  // Get verification status for a single contact
  app.get('/api/contacts/:id/verification', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const contact = await storage.rawGet(`SELECT "emailVerificationStatus", "emailVerifiedAt" FROM contacts WHERE id = ? AND "organizationId" = ?`, req.params.id, orgId);
      if (!contact) return res.status(404).json({ message: 'Contact not found' });
      res.json(contact);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ========== CONTEXT ENGINE — Organization Knowledge Base ==========

  // List org documents
  app.get('/api/context/documents', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const docType = req.query.docType as string;
      const source = req.query.source as string;
      const search = req.query.search as string;

      const filters: any = {};
      if (docType) filters.docType = docType;
      if (source) filters.source = source;
      if (search) filters.search = search;

      const docs = await storage.getOrgDocuments(orgId, filters, limit, offset);
      const total = await storage.getOrgDocumentsCount(orgId, filters);

      // Don't send full content in list view — too heavy
      const lightDocs = (docs as any[]).map(d => ({
        ...d,
        content: undefined,
        contentPreview: (d.content || '').substring(0, 200),
        tags: typeof d.tags === 'string' ? JSON.parse(d.tags) : (d.tags || []),
        metadata: typeof d.metadata === 'string' ? JSON.parse(d.metadata) : (d.metadata || {}),
      }));

      res.json({ documents: lightDocs, total });
    } catch (error: any) {
      console.error('[Context] GET documents error:', error.message);
      res.status(500).json({ message: 'Failed to fetch documents' });
    }
  });

  // Get single document (with full content)
  app.get('/api/context/documents/:id', requireAuth, async (req: any, res) => {
    try {
      const doc: any = await storage.getOrgDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: 'Document not found' });
      if (doc.organizationId !== req.user.organizationId) return res.status(403).json({ message: 'Access denied' });
      doc.tags = typeof doc.tags === 'string' ? JSON.parse(doc.tags) : (doc.tags || []);
      doc.metadata = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch document' });
    }
  });

  // Upload / create document
  app.post('/api/context/documents', requireAuth, async (req: any, res) => {
    try {
      const { name, docType, source, content, summary, tags, metadata, mimeType } = req.body;
      if (!name || !content) return res.status(400).json({ message: 'Name and content are required' });

      const { nanoid } = await import('nanoid');
      const { extractText, generateDocumentSummary } = await import('./services/context-engine.js');

      // Extract text from content
      let plainText = extractText(content, mimeType || 'text/plain');
      // Strip null bytes and non-printable control chars — PostgreSQL text columns reject  
      // and binary garbage from mis-uploaded PDFs/DOCX produces it. Keep \t \n \r.
      plainText = plainText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

      // Auto-generate summary if not provided
      let docSummary = summary || '';
      if (!docSummary && plainText.length > 100) {
        try {
          docSummary = await generateDocumentSummary(req.user.organizationId, plainText, name);
        } catch { /* AI summary failed — proceed without */ }
      }

      const doc = await storage.createOrgDocument({
        id: nanoid(),
        organizationId: req.user.organizationId,
        name,
        docType: docType || 'general',
        source: source || 'upload',
        content: plainText,
        summary: docSummary,
        tags: tags || [],
        metadata: metadata || {},
        fileSize: Buffer.byteLength(plainText, 'utf8'),
        mimeType: mimeType || 'text/plain',
        uploadedBy: req.user.id,
      });

      res.json(doc);
    } catch (error: any) {
      console.error('[Context] POST document error:', error.message);
      res.status(500).json({ message: 'Failed to create document' });
    }
  });

  // Update document
  app.put('/api/context/documents/:id', requireAuth, async (req: any, res) => {
    try {
      const existing: any = await storage.getOrgDocument(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Document not found' });
      if (existing.organizationId !== req.user.organizationId) return res.status(403).json({ message: 'Access denied' });

      const { name, docType, content, summary, tags, metadata } = req.body;
      const cleanContent = typeof content === 'string'
        ? content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        : content;
      const doc = await storage.updateOrgDocument(req.params.id, {
        ...(name !== undefined && { name }),
        ...(docType !== undefined && { docType }),
        ...(content !== undefined && { content: cleanContent }),
        ...(summary !== undefined && { summary }),
        ...(tags !== undefined && { tags }),
        ...(metadata !== undefined && { metadata }),
      });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to update document' });
    }
  });

  // Delete document
  app.delete('/api/context/documents/:id', requireAuth, async (req: any, res) => {
    try {
      const existing: any = await storage.getOrgDocument(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Document not found' });
      if (existing.organizationId !== req.user.organizationId) return res.status(403).json({ message: 'Access denied' });
      await storage.deleteOrgDocument(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to delete document' });
    }
  });

  // Get context for a contact (used by AI draft, proposal builder, etc.)
  app.get('/api/context/contact/:contactId', requireAuth, async (req: any, res) => {
    try {
      const { assembleContext, buildContextPrompt } = await import('./services/context-engine.js');
      const ctx = await assembleContext(req.user.organizationId, {
        contactId: req.params.contactId,
        query: req.query.query as string,
        docTypes: req.query.docTypes ? (req.query.docTypes as string).split(',') : undefined,
      });
      res.json({
        contact: ctx.contact ? {
          ...ctx.contact.contact,
          leadOpportunity: ctx.contact.leadOpportunity,
          campaignEngagement: ctx.contact.campaignEngagement,
          emailHistoryCount: ctx.contact.emailHistory.length,
          activitiesCount: ctx.contact.activities.length,
          lastRemark: ctx.contact.lastRemark,
        } : null,
        relevantDocs: ctx.relevantDocs.map((d: any) => ({ id: d.id, name: d.name, docType: d.docType, summary: d.summary })),
        totalOrgDocs: ctx.org.totalDocs,
        contextPrompt: buildContextPrompt(ctx),
      });
    } catch (error: any) {
      console.error('[Context] GET contact context error:', error.message);
      res.status(500).json({ message: 'Failed to build context' });
    }
  });

  // AI Draft Reply with full context
  app.post('/api/context/draft-reply', requireAuth, async (req: any, res) => {
    try {
      const { contactId, contactEmail, incomingEmail, tone, customInstructions } = req.body;
      if (!contactId && !contactEmail) return res.status(400).json({ message: 'Contact ID or email required' });

      const { assembleContext, buildReplyDraftPrompt } = await import('./services/context-engine.js');
      const orgId = req.user.organizationId;

      // Build context
      const ctx = await assembleContext(orgId, {
        contactId,
        contactEmail,
        docTypes: ['case_study', 'brochure', 'proposal', 'general'],
      });

      const systemPrompt = buildReplyDraftPrompt(ctx, tone || 'professional');

      // Add custom instructions if provided
      const finalSystem = customInstructions
        ? `${systemPrompt}\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`
        : systemPrompt;

      // Call Azure OpenAI
      const settings = await storage.getApiSettingsWithAzureFallback(orgId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.json({
          draft: `Hi ${ctx.contact?.contact?.firstName || 'there'},\n\nThank you for your email. I'll review and get back to you shortly.\n\nBest regards`,
          provider: 'fallback',
          note: 'Configure Azure OpenAI in Advanced Settings for AI-powered drafts.',
          contextUsed: { docsCount: ctx.relevantDocs.length, emailHistoryCount: ctx.contact?.emailHistory?.length || 0 },
        });
      }

      const userPrompt = incomingEmail
        ? `Draft a reply to this email:\n\nFrom: ${incomingEmail.from || contactEmail}\nSubject: ${incomingEmail.subject || '(no subject)'}\n\n${incomingEmail.body || incomingEmail.snippet || ''}`
        : `Draft an outreach email to ${ctx.contact?.contact?.firstName || ''} ${ctx.contact?.contact?.lastName || ''} at ${ctx.contact?.contact?.company || 'their company'}. Use the context provided to make it relevant and personalized.`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: finalSystem },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Context] Azure OpenAI error:', response.status, errText);
        return res.status(500).json({ message: 'AI draft generation failed' });
      }

      const data = await response.json() as any;
      const draft = data.choices?.[0]?.message?.content || '';

      res.json({
        draft,
        provider: 'azure-openai',
        contextUsed: {
          docsCount: ctx.relevantDocs.length,
          docNames: ctx.relevantDocs.map((d: any) => d.name),
          emailHistoryCount: ctx.contact?.emailHistory?.length || 0,
          leadBucket: ctx.contact?.leadOpportunity?.bucket || null,
          activitiesCount: ctx.contact?.activities?.length || 0,
        },
      });
    } catch (error: any) {
      console.error('[Context] Draft reply error:', error.message, error.stack);
      res.status(500).json({ message: 'Failed to generate draft' });
    }
  });

  // AI Proposal Builder with full context
  app.post('/api/context/proposal', requireAuth, async (req: any, res) => {
    try {
      const { contactId, contactEmail, requirements, customInstructions } = req.body;

      const { assembleContext, buildProposalPrompt } = await import('./services/context-engine.js');
      const orgId = req.user.organizationId;

      const ctx = await assembleContext(orgId, {
        contactId,
        contactEmail,
        docTypes: ['case_study', 'proposal', 'brochure', 'award', 'testimonial'],
        maxDocTokens: 12000, // More docs for proposals
      });

      const systemPrompt = buildProposalPrompt(ctx);

      const settings = await storage.getApiSettingsWithAzureFallback(orgId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;
      const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

      if (!endpoint || !apiKey || !deploymentName) {
        return res.json({ proposal: '', provider: 'none', note: 'Configure Azure OpenAI in Advanced Settings.' });
      }

      const userPrompt = requirements
        ? `Generate a proposal for this contact based on their requirements:\n\n${requirements}\n\n${customInstructions || ''}`
        : `Generate a proposal for ${ctx.contact?.contact?.firstName || ''} ${ctx.contact?.contact?.lastName || ''} at ${ctx.contact?.contact?.company || 'their company'}. ${customInstructions || ''}`;

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.6,
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        return res.status(500).json({ message: 'AI proposal generation failed' });
      }

      const data = await response.json() as any;
      res.json({
        proposal: data.choices?.[0]?.message?.content || '',
        provider: 'azure-openai',
        contextUsed: {
          docsCount: ctx.relevantDocs.length,
          docNames: ctx.relevantDocs.map((d: any) => d.name),
          leadBucket: ctx.contact?.leadOpportunity?.bucket || null,
        },
      });
    } catch (error: any) {
      console.error('[Context] Proposal error:', error.message);
      res.status(500).json({ message: 'Failed to generate proposal' });
    }
  });

  // Document type counts (for sidebar)
  app.get('/api/context/doc-types', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const counts = await storage.rawAll(`SELECT "docType", COUNT(*) as cnt FROM org_documents WHERE "organizationId" = ? GROUP BY "docType" ORDER BY cnt DESC`, orgId);
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch doc types' });
    }
  });

  // ========== CAMPAIGN PLANNER AGENT ==========

  app.post('/api/agent/plan-campaign', requireAuth, async (req: any, res) => {
    try {
      const { brief } = req.body;
      if (!brief || typeof brief !== 'string' || brief.trim().length < 10) {
        return res.status(400).json({ message: 'Please provide a campaign brief (at least 10 characters).' });
      }
      const { runCampaignPlannerAgent } = await import('./services/campaign-planner-agent.js');
      const plan = await runCampaignPlannerAgent(req.user.organizationId, brief.trim());
      res.json(plan);
    } catch (error: any) {
      console.error('[CampaignPlannerAgent] Error:', error.message);
      res.status(500).json({ message: error.message || 'Failed to generate campaign plan.' });
    }
  });

  // ========== CAMPAIGN INTELLIGENCE AGENT ==========

  // Run a review (pre_launch | live | post_mortem) — result cached in api_settings
  app.post('/api/campaigns/:id/review', requireAuth, async (req: any, res) => {
    try {
      const campaignId = req.params.id;
      const { mode } = req.body;
      if (!mode || !['pre_launch', 'live', 'post_mortem'].includes(mode)) {
        return res.status(400).json({ message: 'mode must be pre_launch, live, or post_mortem' });
      }

      // Verify campaign belongs to org
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign || campaign.organizationId !== req.user.organizationId) {
        return res.status(404).json({ message: 'Campaign not found' });
      }

      const { runCampaignReviewAgent, saveCachedReview } = await import('./services/campaign-review-agent.js');
      const review = await runCampaignReviewAgent(req.user.organizationId, campaignId, mode);
      await saveCachedReview(req.user.organizationId, campaignId, review);
      res.json(review);
    } catch (error: any) {
      console.error('[CampaignReviewAgent] Error:', error.message);
      res.status(500).json({ message: error.message || 'Failed to generate campaign review.' });
    }
  });

  // Get cached review grades for all org campaigns (for list column)
  app.get('/api/campaigns/reviews/summary', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      if (!settings) return res.json({});
      const summary: Record<string, { grade: string; score: number; mode: string; degradation: boolean }> = {};
      for (const [key, val] of Object.entries(settings)) {
        if (!key.startsWith('campaign_review_') || !val) continue;
        const campaignId = key.replace('campaign_review_', '');
        try {
          const review = JSON.parse(val as string);
          summary[campaignId] = {
            grade: review.overallGrade || '?',
            score: review.overallScore || 0,
            mode: review.mode || 'pre_launch',
            degradation: review.degradation?.detected === true,
          };
        } catch { /* skip malformed */ }
      }
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch review summaries.' });
    }
  });

  // Bulk review: queue reviews for all active/paused/completed campaigns (fire-and-forget)
  // In-memory cancellation flags — org IDs that have requested cancel
  const bulkReviewCancelled = new Set<string>();

  // Cancel a running bulk review
  app.post('/api/campaigns/bulk-review/cancel', requireAuth, async (req: any, res) => {
    bulkReviewCancelled.add(req.user.organizationId);
    res.json({ success: true });
  });

  // List candidates eligible for bulk review (for selection dialog)
  app.get('/api/campaigns/bulk-review/candidates', requireAuth, async (req: any, res) => {
    try {
      const candidates = await storage.rawAll(
        `SELECT id, name, status, "sentCount", "openedCount", "repliedCount"
         FROM campaigns
         WHERE "organizationId" = $1
           AND status IN ('active','following_up','paused','completed')
           AND "sentCount" > 0
         ORDER BY "updatedAt" DESC`,
        req.user.organizationId
      ) as any[];
      res.json(candidates);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch candidates.' });
    }
  });

  app.post('/api/campaigns/bulk-review', requireAuth, async (req: any, res) => {
    try {
      // Accept optional list of specific campaign IDs; if omitted fall back to all eligible
      const { campaignIds } = req.body as { campaignIds?: string[] };
      let campaigns: any[];
      if (campaignIds && campaignIds.length > 0) {
        const placeholders = campaignIds.map((_: any, i: number) => `$${i + 2}`).join(',');
        campaigns = await storage.rawAll(
          `SELECT id, status FROM campaigns WHERE "organizationId" = $1 AND id IN (${placeholders}) AND "sentCount" > 0`,
          req.user.organizationId, ...campaignIds
        ) as any[];
      } else {
        campaigns = await storage.rawAll(
          `SELECT id, status FROM campaigns WHERE "organizationId" = $1 AND status IN ('active','following_up','paused','completed') AND "sentCount" > 0`,
          req.user.organizationId
        ) as any[];
      }
      if (campaigns.length === 0) return res.json({ queued: 0 });
      res.json({ queued: campaigns.length });
      const orgId = req.user.organizationId;
      bulkReviewCancelled.delete(orgId); // clear any stale cancel flag
      // Fire-and-forget — don't block the response
      setImmediate(async () => {
        const { runCampaignReviewAgent, saveCachedReview } = await import('./services/campaign-review-agent.js');
        for (const c of campaigns) {
          if (bulkReviewCancelled.has(orgId)) {
            bulkReviewCancelled.delete(orgId);
            console.log(`[BulkReview] Cancelled for org ${orgId}`);
            break;
          }
          try {
            const mode = c.status === 'completed' ? 'post_mortem' : 'live';
            const review = await runCampaignReviewAgent(orgId, c.id, mode);
            await saveCachedReview(orgId, c.id, review);
          } catch { /* skip failed campaign */ }
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to start bulk review.' });
    }
  });

  // Get latest cached review for a campaign
  app.get('/api/campaigns/:id/review/latest', requireAuth, async (req: any, res) => {
    try {
      const campaignId = req.params.id;
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign || campaign.organizationId !== req.user.organizationId) {
        return res.status(404).json({ message: 'Campaign not found' });
      }
      const { getCachedReview } = await import('./services/campaign-review-agent.js');
      const review = await getCachedReview(req.user.organizationId, campaignId);
      if (!review) return res.json(null);
      res.json(review);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch campaign review.' });
    }
  });

  // Save Claude API key in api_settings
  app.post('/api/agent/settings', requireAuth, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'owner' && role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required.' });
      }
      const { claudeApiKey } = req.body;
      if (!claudeApiKey || typeof claudeApiKey !== 'string') {
        return res.status(400).json({ message: 'claudeApiKey is required.' });
      }
      await storage.setApiSetting(req.user.organizationId, 'claude_api_key', claudeApiKey);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to save agent settings.' });
    }
  });

  app.get('/api/agent/settings', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getApiSettings(req.user.organizationId);
      const hasKey = !!(settings?.claude_api_key);
      res.json({ hasClaudeKey: hasKey });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch agent settings.' });
    }
  });

  // ========== LEAD INTELLIGENCE ==========

  // Helper: get member's own account IDs (for filtering)
  const getMemberAccountIds = async (req: any): Promise<string[] | null> => {
    const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
    if (isAdmin) return null; // null means no filter (see all)
    const allAccounts = await storage.getEmailAccounts(req.user.organizationId);
    const memberAccounts = allAccounts.filter((a: any) => a.userId === req.user.id);
    return memberAccounts.map((a: any) => String(a.id));
  };

  // Get opportunities (AI-classified leads)
  app.get('/api/lead-intelligence/opportunities', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const bucket = req.query.bucket as string | undefined;
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || undefined;
      let opportunities = await storage.getLeadOpportunities(orgId, { bucket, status, limit });

      // Backfill accountEmail from email_history for opportunities missing it
      try {
        for (const opp of opportunities as any[]) {
          if (!opp.accountEmail && opp.contactEmail) {
            const hist = await storage.rawGet(`SELECT "accountEmail", "emailAccountId" FROM email_history WHERE "organizationId" = ? AND LOWER("fromEmail") = ? AND direction = 'received' LIMIT 1`, orgId, opp.contactEmail.toLowerCase()) as any;
            if (hist?.accountEmail) {
              opp.accountEmail = hist.accountEmail;
              if (!opp.emailAccountId) opp.emailAccountId = hist.emailAccountId;
              // Persist the backfill
              try { await storage.rawRun(`UPDATE lead_opportunities SET "accountEmail" = ?, "emailAccountId" = ? WHERE id = ?`, hist.accountEmail, hist.emailAccountId, opp.id); } catch (e) {}
            }
          }
        }
      } catch (e) { /* non-critical */ }

      // Member filtering: only show opportunities from their accounts
      const memberIds = await getMemberAccountIds(req);
      if (memberIds) {
        opportunities = opportunities.filter((o: any) => memberIds.includes(String(o.emailAccountId)));
      }
      res.json(opportunities);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch opportunities' });
    }
  });

  // Get opportunity summary (bucket counts)
  app.get('/api/lead-intelligence/summary', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      let summary = await storage.getLeadOpportunitySummary(orgId);
      // Member filtering: recompute summary from their opportunities only
      const memberIds = await getMemberAccountIds(req);
      if (memberIds) {
        const allOpps = await storage.getLeadOpportunities(orgId, {});
        const memberOpps = allOpps.filter((o: any) => memberIds.includes(String(o.emailAccountId)));
        const bucketMap: Record<string, any> = {};
        for (const o of memberOpps as any[]) {
          if (!bucketMap[o.bucket]) bucketMap[o.bucket] = { bucket: o.bucket, count: 0, avgConfidence: 0, newCount: 0, reviewedCount: 0, actionedCount: 0, dismissedCount: 0, totalConf: 0 };
          bucketMap[o.bucket].count++;
          bucketMap[o.bucket].totalConf += (o.confidence || 0);
          if (o.status === 'new') bucketMap[o.bucket].newCount++;
          if (o.status === 'reviewed') bucketMap[o.bucket].reviewedCount++;
          if (o.status === 'actioned') bucketMap[o.bucket].actionedCount++;
          if (o.status === 'dismissed') bucketMap[o.bucket].dismissedCount++;
        }
        summary = Object.values(bucketMap).map((b: any) => ({ ...b, avgConfidence: b.count > 0 ? Math.round(b.totalConf / b.count) : 0 }));
      }
      const bucketLabels = BUCKET_LABELS;
      res.json({ summary, bucketLabels });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch summary' });
    }
  });

  // Debug: check email_history data quality
  app.get('/api/lead-intelligence/debug', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const totalRows = await storage.rawGet(`SELECT COUNT(*) as cnt FROM email_history WHERE "organizationId" = ?`, orgId) as any;
      const sample = await storage.rawAll(`SELECT id, direction, "fromEmail", "toEmail", subject, "accountEmail" FROM email_history WHERE "organizationId" = ? LIMIT 5`, orgId) as any[];
      const directionCounts = await storage.rawAll(`SELECT direction, COUNT(*) as cnt FROM email_history WHERE "organizationId" = ? GROUP BY direction`, orgId) as any[];
      const contactQuery = await storage.rawAll(`
        SELECT
          CASE WHEN direction = 'sent' THEN LOWER("toEmail") ELSE LOWER("fromEmail") END as contactEmail,
          COUNT(*) as totalEmails
        FROM email_history
        WHERE "organizationId" = ?
        GROUP BY contactEmail
        HAVING contactEmail != '' AND contactEmail IS NOT NULL
        ORDER BY totalEmails DESC
        LIMIT 10
      `, orgId) as any[];

      // Check org emails
      const orgAccounts = await storage.getEmailAccounts(orgId);
      const orgEmailList = (orgAccounts as any[]).map((a: any) => (a.email || '').toLowerCase()).filter(Boolean);

      res.json({
        totalRows: totalRows?.cnt || 0,
        directionCounts,
        sampleRows: sample,
        topContacts: contactQuery,
        orgEmails: orgEmailList,
        orgId,
      });
    } catch (error) {
      res.status(500).json({ message: 'Debug failed', error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get email history sync status
  app.get('/api/lead-intelligence/sync-status', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      let syncStatus = await storage.getEmailHistorySyncStatus(orgId);
      const stats = await storage.getEmailHistoryStats(orgId);
      // Member filtering: only show their accounts' sync status
      const memberIds = await getMemberAccountIds(req);
      if (memberIds) {
        syncStatus = (syncStatus as any[]).filter((s: any) => memberIds.includes(String(s.emailAccountId)));
      }
      res.json({ syncStatus, stats });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch sync status' });
    }
  });

  // Get/set custom AI prompt for lead intelligence
  app.get('/api/lead-intelligence/prompt', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const { DEFAULT_LEAD_PROMPT } = await import('./services/lead-intelligence-engine.js');
      const settings = await storage.getApiSettings(orgId);
      res.json({ prompt: (settings as any).lead_intelligence_prompt || '', defaultPrompt: DEFAULT_LEAD_PROMPT, role: req.user.role });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch prompt' });
    }
  });

  app.post('/api/lead-intelligence/prompt', requireAuth, async (req: any, res) => {
    try {
      const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
      if (!isAdmin) return res.status(403).json({ message: 'Only admin/owner can edit the prompt' });
      const orgId = req.user.organizationId;
      await storage.setApiSetting(orgId, 'lead_intelligence_prompt', req.body.prompt || '');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save prompt' });
    }
  });

  // Trigger email history scan (deep scan)
  // ===== LEAD INTELLIGENCE BACKGROUND JOBS =====
  // The synchronous /scan and /analyze used to take 60-300+ seconds for orgs with many
  // accounts and months of history. Azure App Service kills requests at ~230s, causing
  // 504 Gateway Timeouts that left the user with no idea what happened. These endpoints
  // now return a jobId immediately and run in the background. Frontend polls /jobs/:jobId.
  // Pattern mirrors the proven bulk template analyze flow.

  const LEAD_INTEL_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour — stale after this if not finished

  type LeadIntelJobType = 'scan' | 'analyze' | 'full';
  interface LeadIntelJob {
    id: string;
    organizationId: string;
    userId: string;
    type: LeadIntelJobType;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: string;
    finishedAt: string | null;
    options: { monthsBack?: number; emailAccountIds?: string[]; force?: boolean };
    result: any | null;
    error: string | null;
    cancelRequested: boolean;
  }

  const leadIntelJobKey = (jobId: string) => `lead_intel_job_${jobId}`;

  const findActiveLeadIntelJob = async (orgId: string, excludeJobId?: string): Promise<LeadIntelJob | null> => {
    const allSettings = await storage.getApiSettings(orgId);
    const now = Date.now();
    for (const [key, val] of Object.entries(allSettings || {})) {
      if (!key.startsWith('lead_intel_job_')) continue;
      try {
        const j = JSON.parse(val as string) as LeadIntelJob;
        if (excludeJobId && j.id === excludeJobId) continue;
        if (j.status !== 'running') continue;
        if (j.startedAt && (now - new Date(j.startedAt).getTime()) < LEAD_INTEL_JOB_TTL_MS) return j;
      } catch { /* ignore malformed */ }
    }
    return null;
  };

  const startLeadIntelJob = async (orgId: string, userId: string, type: LeadIntelJobType, options: LeadIntelJob['options']): Promise<{ jobId: string } | { conflict: LeadIntelJob }> => {
    // Pre-check for active job in this org (prevents duplicate work)
    const existing = await findActiveLeadIntelJob(orgId);
    if (existing) return { conflict: existing };

    const jobId = `${orgId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const job: LeadIntelJob = {
      id: jobId,
      organizationId: orgId,
      userId,
      type,
      status: 'running',
      startedAt,
      finishedAt: null,
      options,
      result: null,
      error: null,
      cancelRequested: false,
    };
    await storage.setApiSetting(orgId, leadIntelJobKey(jobId), JSON.stringify(job));

    // Post-write double-check (TOCTOU race) — same pattern as bulk template analyze
    const concurrent = await findActiveLeadIntelJob(orgId, jobId);
    if (concurrent) {
      const earlierTime = new Date(concurrent.startedAt).getTime();
      const myTime = new Date(startedAt).getTime();
      const concurrentWins = earlierTime < myTime || (earlierTime === myTime && String(concurrent.id) < String(jobId));
      if (concurrentWins) {
        const yielded: LeadIntelJob = { ...job, status: 'cancelled', cancelRequested: true, finishedAt: new Date().toISOString() };
        await storage.setApiSetting(orgId, leadIntelJobKey(jobId), JSON.stringify(yielded));
        return { conflict: concurrent };
      }
    }

    // Fire-and-forget runner with explicit error handling — marks job 'failed' on crash
    setImmediate(async () => {
      try {
        await runLeadIntelJob(jobId, orgId, type, options);
      } catch (err: any) {
        console.error(`[LeadIntel] runner crashed for job ${jobId}:`, err?.message || err);
        try {
          const settings = await storage.getApiSettings(orgId);
          const raw = settings?.[leadIntelJobKey(jobId)];
          if (raw) {
            const j = JSON.parse(raw) as LeadIntelJob;
            if (j.status === 'running') {
              j.status = 'failed';
              j.error = err?.message || String(err);
              j.finishedAt = new Date().toISOString();
              await storage.setApiSetting(orgId, leadIntelJobKey(jobId), JSON.stringify(j));
            }
          }
        } catch { /* best-effort cleanup */ }
      }
    });

    return { jobId };
  };

  const runLeadIntelJob = async (jobId: string, orgId: string, type: LeadIntelJobType, options: LeadIntelJob['options']): Promise<void> => {
    const { scanOrgEmailHistory, analyzeOrgLeads, runFullLeadIntelligence, analyzeOrgLeadsIncremental } = await import('./services/lead-intelligence-engine.js');

    let result: any = null;
    if (type === 'scan') {
      result = await scanOrgEmailHistory(orgId, options.monthsBack || 6, options.emailAccountIds, !!options.force);
    } else if (type === 'analyze') {
      result = options.force
        ? await analyzeOrgLeads(orgId, options.emailAccountIds)
        : await analyzeOrgLeadsIncremental(orgId, options.emailAccountIds);
    } else if (type === 'full') {
      result = await runFullLeadIntelligence(orgId, options.monthsBack || 6, options.emailAccountIds, !!options.force);
    }

    // Persist final state
    const settings = await storage.getApiSettings(orgId);
    const raw = settings?.[leadIntelJobKey(jobId)];
    if (raw) {
      const j = JSON.parse(raw) as LeadIntelJob;
      // Honor cancellation that was requested mid-run (work already done, just don't expose result)
      j.status = j.cancelRequested ? 'cancelled' : 'completed';
      j.result = result;
      j.finishedAt = new Date().toISOString();
      await storage.setApiSetting(orgId, leadIntelJobKey(jobId), JSON.stringify(j));
    }
  };

  // Scan email history (background job).
  // Returns { jobId, type:'scan' } immediately. Frontend polls /jobs/:jobId for status.
  app.post('/api/lead-intelligence/scan', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const monthsBack = parseInt(req.body.monthsBack as string) || 6;
      const emailAccountIds = Array.isArray(req.body.emailAccountIds) ? req.body.emailAccountIds.map(String) : undefined;
      const force = req.body?.force === true;
      console.log(`[LeadIntel] Scan job requested for org ${orgId} (${monthsBack} months, mode=${force ? 'force-full' : 'incremental'})`);
      const r = await startLeadIntelJob(orgId, req.user.id, 'scan', { monthsBack, emailAccountIds, force });
      if ('conflict' in r) {
        return res.status(409).json({ message: 'A lead intelligence job is already running for your org. Wait for it to complete or cancel it.', activeJob: r.conflict });
      }
      res.json({ jobId: r.jobId, type: 'scan' });
    } catch (error) {
      console.error('[LeadIntel] Scan job start error:', error);
      res.status(500).json({ message: 'Failed to start scan', error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Trigger AI analysis (background job).
  app.post('/api/lead-intelligence/analyze', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const emailAccountIds = Array.isArray(req.body.emailAccountIds) ? req.body.emailAccountIds.map(String) : undefined;
      const force = req.body?.force === true;
      console.log(`[LeadIntel] Analyze job requested for org ${orgId} (mode=${force ? 'force-full' : 'incremental'})`);
      const r = await startLeadIntelJob(orgId, req.user.id, 'analyze', { emailAccountIds, force });
      if ('conflict' in r) {
        return res.status(409).json({ message: 'A lead intelligence job is already running for your org. Wait for it to complete or cancel it.', activeJob: r.conflict });
      }
      res.json({ jobId: r.jobId, type: 'analyze' });
    } catch (error) {
      console.error('[LeadIntel] Analyze job start error:', error);
      res.status(500).json({ message: 'Failed to start analysis', error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Full pipeline (background job): scan then analyze.
  app.post('/api/lead-intelligence/run', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const monthsBack = parseInt(req.body.monthsBack as string) || 6;
      const emailAccountIds = Array.isArray(req.body.emailAccountIds) ? req.body.emailAccountIds.map(String) : undefined;
      const force = req.body?.force === true;
      console.log(`[LeadIntel] Full pipeline job requested for org ${orgId} (mode=${force ? 'force-full' : 'incremental'})`);
      const r = await startLeadIntelJob(orgId, req.user.id, 'full', { monthsBack, emailAccountIds, force });
      if ('conflict' in r) {
        return res.status(409).json({ message: 'A lead intelligence job is already running for your org. Wait for it to complete or cancel it.', activeJob: r.conflict });
      }
      res.json({ jobId: r.jobId, type: 'full' });
    } catch (error) {
      console.error('[LeadIntel] Full pipeline job start error:', error);
      res.status(500).json({ message: 'Failed to start pipeline', error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Job status — frontend polls this every 3s while a job is running.
  app.get('/api/lead-intelligence/jobs/:jobId', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const raw = settings?.[leadIntelJobKey(req.params.jobId)];
      if (!raw) return res.status(404).json({ message: 'Job not found' });
      const job = JSON.parse(raw) as LeadIntelJob;
      if (job.organizationId !== orgId) return res.status(403).json({ message: 'Forbidden' });
      // Stale-job detection — if running but TTL exceeded, mark failed
      if (job.status === 'running' && job.startedAt && (Date.now() - new Date(job.startedAt).getTime()) > LEAD_INTEL_JOB_TTL_MS) {
        job.status = 'failed';
        job.error = 'Job exceeded TTL — likely the server restarted mid-run.';
        job.finishedAt = new Date().toISOString();
        await storage.setApiSetting(orgId, leadIntelJobKey(job.id), JSON.stringify(job));
      }
      res.json(job);
    } catch (error: any) {
      console.error('[LeadIntel] Job status error:', error?.message || error);
      res.status(500).json({ message: 'Failed to read job status' });
    }
  });

  // Cancel a running job (best-effort — work in progress completes; result is suppressed).
  app.post('/api/lead-intelligence/jobs/:jobId/cancel', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const settings = await storage.getApiSettings(orgId);
      const raw = settings?.[leadIntelJobKey(req.params.jobId)];
      if (!raw) return res.status(404).json({ message: 'Job not found' });
      const job = JSON.parse(raw) as LeadIntelJob;
      if (job.organizationId !== orgId) return res.status(403).json({ message: 'Forbidden' });
      if (job.status !== 'running') return res.json({ ok: true, status: job.status });
      job.cancelRequested = true;
      await storage.setApiSetting(orgId, leadIntelJobKey(req.params.jobId), JSON.stringify(job));
      res.json({ ok: true, status: 'cancelling' });
    } catch (error: any) {
      console.error('[LeadIntel] Job cancel error:', error?.message || error);
      res.status(500).json({ message: 'Failed to cancel job' });
    }
  });

  // Update opportunity status (reviewed, actioned, dismissed)
  app.patch('/api/lead-intelligence/opportunities/:id', requireAuth, async (req: any, res) => {
    try {
      const { status, reviewedBy } = req.body;
      await storage.updateLeadOpportunity(req.params.id, {
        status,
        reviewedAt: new Date().toISOString(),
        reviewedBy: reviewedBy || req.user.id,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update opportunity' });
    }
  });

  // Get single opportunity detail
  app.get('/api/lead-intelligence/opportunities/:email', requireAuth, async (req: any, res) => {
    try {
      const orgId = req.user.organizationId;
      const opp = await storage.getLeadOpportunityByEmail(orgId, req.params.email);
      if (!opp) return res.status(404).json({ message: 'Opportunity not found' });
      res.json(opp);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch opportunity' });
    }
  });

  // ============================================================
  // Apollo.io integration — per-org API key, saved-data sync, no credit spend in Phase 1
  // ============================================================

  const isOrgAdmin = (u: any) => u?.role === 'owner' || u?.role === 'admin';

  // GET /api/apollo/settings — key-is-set flag + credit balance + overwrite mode
  app.get('/api/apollo/settings', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const apollo = await import('./services/apollo-sync-engine.js');
      const key = await apollo.getApolloApiKey(req.user.organizationId);
      const overwriteMode = await apollo.getOverwriteMode(req.user.organizationId);
      let credits: any = null;
      let creditsError: string | null = null;
      if (key) {
        try { credits = await apollo.fetchCreditBalance(req.user.organizationId); }
        catch (e: any) { creditsError = e?.message || 'Unable to fetch credits'; }
      }
      res.json({
        configured: !!key,
        keyPreview: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : null,
        overwriteMode,
        credits,
        creditsError,
      });
    } catch (error: any) {
      console.error('[Apollo] settings error:', error?.message);
      res.status(500).json({ message: 'Failed to load Apollo settings' });
    }
  });

  // POST /api/apollo/settings — save/update API key + overwrite mode
  app.post('/api/apollo/settings', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { apiKey, overwriteMode } = req.body || {};
      const apollo = await import('./services/apollo-sync-engine.js');
      const orgId = req.user.organizationId;

      if (typeof apiKey === 'string' && apiKey.trim()) {
        const check = await apollo.validateApiKey(apiKey.trim());
        if (!check.valid) return res.status(400).json({ message: 'Invalid Apollo API key', error: check.error });
        await storage.setApiSetting(orgId, 'apollo_api_key', apiKey.trim());
      }
      if (overwriteMode === 'fill_blanks_only' || overwriteMode === 'apollo_wins') {
        await storage.setApiSetting(orgId, 'apollo_sync_overwrite_mode', overwriteMode);
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error('[Apollo] save settings error:', error?.message);
      res.status(500).json({ message: 'Failed to save Apollo settings' });
    }
  });

  // DELETE /api/apollo/settings — remove API key
  app.delete('/api/apollo/settings', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      await storage.setApiSetting(req.user.organizationId, 'apollo_api_key', '');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to remove Apollo key' });
    }
  });

  // GET /api/apollo/lists — saved lists from Apollo (no credit cost)
  app.get('/api/apollo/lists', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const apollo = await import('./services/apollo-sync-engine.js');
      const lists = await apollo.fetchSavedLists(req.user.organizationId);
      res.json({ lists });
    } catch (error: any) {
      console.error('[Apollo] lists error:', error?.message);
      res.status(500).json({ message: error?.message || 'Failed to fetch Apollo lists' });
    }
  });

  // POST /api/apollo/sync/preview — dry-run: totals + samples (no DB writes)
  app.post('/api/apollo/sync/preview', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { listIds } = req.body || {};
      if (!Array.isArray(listIds) || listIds.length === 0) {
        return res.status(400).json({ message: 'listIds required' });
      }
      const apollo = await import('./services/apollo-sync-engine.js');
      const preview = await apollo.previewSync(req.user.organizationId, listIds.map(String));
      res.json(preview);
    } catch (error: any) {
      console.error('[Apollo] preview error:', error?.message);
      res.status(500).json({ message: error?.message || 'Preview failed' });
    }
  });

  // POST /api/apollo/sync/start — kick off background sync job
  app.post('/api/apollo/sync/start', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { listIds, listNames, targetListId, overwriteMode } = req.body || {};
      if (!Array.isArray(listIds) || listIds.length === 0) {
        return res.status(400).json({ message: 'listIds required' });
      }
      const apollo = await import('./services/apollo-sync-engine.js');
      const jobId = await apollo.createSyncJob({
        organizationId: req.user.organizationId,
        triggeredBy: req.user.id,
        listIds: listIds.map(String),
        listNames: Array.isArray(listNames) ? listNames.map(String) : [],
        targetListId: targetListId || null,
        overwriteMode: overwriteMode === 'apollo_wins' ? 'apollo_wins' : 'fill_blanks_only',
      });
      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error('[Apollo] sync start error:', error?.message);
      res.status(500).json({ message: error?.message || 'Failed to start sync' });
    }
  });

  // GET /api/apollo/sync/jobs — recent jobs
  app.get('/api/apollo/sync/jobs', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const apollo = await import('./services/apollo-sync-engine.js');
      const jobs = await apollo.listJobs(req.user.organizationId, 20);
      res.json({ jobs });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to load jobs' });
    }
  });

  // GET /api/apollo/sync/jobs/:jobId — polling endpoint for progress
  app.get('/api/apollo/sync/jobs/:jobId', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const apollo = await import('./services/apollo-sync-engine.js');
      const job = await apollo.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ message: 'Job not found' });
      if (job.organizationId !== req.user.organizationId) return res.status(403).json({ message: 'Access denied' });
      res.json({ job });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to load job' });
    }
  });

  // POST /api/apollo/sync/jobs/:jobId/cancel — request cancellation
  app.post('/api/apollo/sync/jobs/:jobId/cancel', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const apollo = await import('./services/apollo-sync-engine.js');
      const job = await apollo.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ message: 'Job not found' });
      if (job.organizationId !== req.user.organizationId) return res.status(403).json({ message: 'Access denied' });
      apollo.cancelJob(req.params.jobId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to cancel job' });
    }
  });

  // ===== Phase 2: Apollo People Search =====
  // POST /api/apollo/search/preview — filter-based search with dedup overlay. No credits spent.
  app.post('/api/apollo/search/preview', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { filters } = req.body || {};
      if (!filters || typeof filters !== 'object') {
        return res.status(400).json({ message: 'filters is required' });
      }
      const search = await import('./services/apollo-search-engine.js');
      const result = await search.previewSearch(req.user.organizationId, filters);
      res.json(result);
    } catch (error: any) {
      console.error('[apollo search preview]', error);
      res.status(500).json({ message: error?.message || 'Search preview failed' });
    }
  });

  // POST /api/apollo/search/import — reveal + import selected people. Spends credits.
  app.post('/api/apollo/search/import', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { peopleIds, allowReveal, revealBudgetCredits, targetListId, saveToApolloListName } = req.body || {};
      if (!Array.isArray(peopleIds) || !peopleIds.length) {
        return res.status(400).json({ message: 'peopleIds required' });
      }
      if (peopleIds.length > 2000) {
        return res.status(400).json({ message: 'Max 2000 people per import' });
      }
      const budget = Math.max(0, Math.min(Number(revealBudgetCredits) || 0, 10000));
      const search = await import('./services/apollo-search-engine.js');
      const jobId = await search.startImportJob({
        organizationId: req.user.organizationId,
        triggeredBy: req.user.id,
        peopleIds: peopleIds.map(String),
        allowReveal: Boolean(allowReveal),
        revealBudgetCredits: budget,
        targetListId: targetListId || null,
        saveToApolloListName: saveToApolloListName || null,
      });
      res.json({ jobId });
    } catch (error: any) {
      console.error('[apollo search import]', error);
      res.status(500).json({ message: error?.message || 'Search import failed' });
    }
  });

  // GET /api/apollo/search/import/:jobId — poll import progress.
  app.get('/api/apollo/search/import/:jobId', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const search = await import('./services/apollo-search-engine.js');
      const progress = search.getImportProgress(req.params.jobId);
      if (!progress) return res.status(404).json({ message: 'Job not found' });
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch progress' });
    }
  });

  // ===== Apollo Saved Searches =====
  app.get('/api/apollo/saved-searches', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const search = await import('./services/apollo-search-engine.js');
      const rows = await search.listSavedSearches(req.user.organizationId);
      const parsed = rows.map((r: any) => ({
        ...r,
        filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : r.filters,
      }));
      res.json({ searches: parsed });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to load saved searches' });
    }
  });

  app.post('/api/apollo/saved-searches', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const { name, filters } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ message: 'name required' });
      const search = await import('./services/apollo-search-engine.js');
      const id = await search.createSavedSearch({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        name: name.trim(),
        filters: filters || {},
      });
      res.json({ id });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to save search' });
    }
  });

  app.delete('/api/apollo/saved-searches/:id', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const search = await import('./services/apollo-search-engine.js');
      await search.deleteSavedSearch(req.user.organizationId, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed to delete saved search' });
    }
  });

  app.post('/api/apollo/saved-searches/:id/run', requireAuth, async (req: any, res) => {
    try {
      if (!isOrgAdmin(req.user)) return res.status(403).json({ message: 'Admin access required' });
      const search = await import('./services/apollo-search-engine.js');
      const result = await search.runSavedSearch(req.user.organizationId, req.params.id);
      res.json(result);
    } catch (error: any) {
      console.error('[apollo saved search run]', error);
      res.status(500).json({ message: error?.message || 'Failed to run saved search' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
