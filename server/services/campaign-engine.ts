import { storage } from '../storage';
import { smtpEmailService, type SmtpConfig, type SendResult, getProviderDailyLimit } from './smtp-email-service';

/** Wrap a promise with a timeout — returns null on timeout instead of hanging forever */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => {
      console.error(`[CampaignEngine] TIMEOUT (${ms}ms) on: ${label}`);
      resolve(null);
    }, ms)),
  ]);
}

/**
 * RFC 2047 encode a subject line for MIME headers.
 * Non-ASCII subjects must be encoded as =?UTF-8?B?<base64>?= for email headers.
 */
function mimeEncodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return '=?UTF-8?B?' + Buffer.from(subject, 'utf-8').toString('base64') + '?=';
}

/**
 * Send email via Gmail API using OAuth access token.
 * Returns SendResult compatible with SMTP service.
 */
async function sendViaGmailAPI(
  accessToken: string,
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<SendResult> {
  try {
    let raw = '';
    raw += `From: ${opts.from}\r\n`;
    raw += `To: ${opts.to}\r\n`;
    raw += `Subject: ${opts.subject}\r\n`;
    raw += `MIME-Version: 1.0\r\n`;
    raw += `Content-Type: text/html; charset="UTF-8"\r\n`;
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        raw += `${k}: ${v}\r\n`;
      }
    }
    raw += `\r\n`;
    raw += opts.html;

    const base64 = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64 }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Gmail API error (${resp.status}): ${errText}` };
    }

    const data = await resp.json() as any;
    // Return both messageId AND threadId — threadId is needed for follow-up threading
    return { success: true, messageId: data.id, threadId: data.threadId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send email via Microsoft Graph API using OAuth access token.
 */
async function sendViaMicrosoftGraph(
  accessToken: string,
  opts: { from: string; to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<SendResult> {
  // Use draft-then-send so we can capture the real `internetMessageId` for follow-up threading.
  // Graph's one-shot /me/sendMail endpoint returns 202 with no body, so the message ID is lost.
  // POST /me/messages creates a draft and returns the full Message resource (id + internetMessageId),
  // then POST /me/messages/{id}/send dispatches it.
  try {
    const baseMessage: any = {
      subject: opts.subject,
      body: { contentType: 'HTML', content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    };

    const headersArr = (opts.headers && Object.keys(opts.headers).length > 0)
      ? Object.entries(opts.headers).map(([name, value]) => ({ name, value }))
      : null;

    const createDraft = async (withHeaders: boolean) => {
      const message = (withHeaders && headersArr)
        ? { ...baseMessage, internetMessageHeaders: headersArr }
        : baseMessage;
      const r = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          // Request immutable IDs so the message ID survives the Drafts→Sent folder move.
          // Without this, the default (non-immutable) ID becomes invalid after /send, and
          // follow-up createReply calls 404 out, breaking Outlook conversation threading.
          'Prefer': 'IdType="ImmutableId"',
        },
        body: JSON.stringify(message),
      });
      if (r.ok) {
        return { ok: true as const, data: await r.json() as any };
      }
      return { ok: false as const, status: r.status, err: await r.text() };
    };

    // Attempt 1: draft with custom headers (needed for tracking)
    let draft = await createDraft(true);

    if (!draft.ok) {
      // Auth errors need a higher-level token refresh — don't retry here
      if (draft.status === 401 || draft.status === 403) {
        return { success: false, error: `Graph API error (${draft.status}): ${draft.err}` };
      }
      // Some Microsoft personal accounts reject custom internetMessageHeaders — retry plain
      if (headersArr) {
        console.log(`[MicrosoftGraph] Draft create with headers failed (${draft.status}) for ${opts.to}, retrying without headers`);
        draft = await createDraft(false);
      }
      if (!draft.ok) {
        console.error(`[MicrosoftGraph] Draft create failed for ${opts.to}: ${draft.status} ${draft.err}`);
        return { success: false, error: `Graph API error (${draft.status}): ${draft.err}` };
      }
    }

    const draftId: string | undefined = draft.data?.id;
    const internetMessageId: string | undefined = draft.data?.internetMessageId;
    if (!draftId) {
      return { success: false, error: 'Graph API: draft created but no id returned' };
    }

    // Send the draft
    const sendResp = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Prefer': 'IdType="ImmutableId"',
      },
    });

    if (!sendResp.ok) {
      const sendErr = await sendResp.text();
      console.error(`[MicrosoftGraph] Draft send failed for ${opts.to}: ${sendResp.status} ${sendErr}`);
      // Best-effort cleanup so we don't leave orphan drafts in the user's Drafts folder
      try {
        await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch { /* ignore */ }
      return { success: false, error: `Graph API send error (${sendResp.status}): ${sendErr}` };
    }

    return {
      success: true,
      messageId: draftId,
      internetMessageId,
    };
  } catch (err) {
    console.error(`[MicrosoftGraph] Exception sending to ${opts.to}:`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// In-memory token cache: key = `${orgId}:${email}`, value = { token, expiry }
const _gmailTokenCache = new Map<string, { token: string; expiry: number }>();
// Per-account refresh lock: prevents concurrent refreshes for the same account
const _gmailRefreshLock = new Map<string, Promise<string | null>>();
// Negative cache: back off for 60s after a failed refresh so we don't hot-loop a bad account
const _gmailRefreshBackoff = new Map<string, number>();
// Same pattern for Microsoft tokens
const _msTokenCache = new Map<string, { token: string; expiry: number }>();
const _msRefreshLock = new Map<string, Promise<string | null>>();
const _msRefreshBackoff = new Map<string, number>();
const REFRESH_BACKOFF_MS = 60_000;

/**
 * Refresh a Gmail access token if expired.
 * Uses in-memory cache to avoid redundant DB reads and concurrent Google API calls.
 */
async function refreshGmailToken(orgId: string, senderEmail?: string): Promise<string | null> {
  const cacheKey = `${orgId}:${senderEmail || '__org__'}`;

  // Serve from cache if token is valid for >5 more minutes
  const cached = _gmailTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry - 300_000) {
    return cached.token;
  }

  // Negative cache: if this account recently failed to refresh, short-circuit
  // and return whatever cached token we have (may be expired — caller's 401
  // retry path handles that) so we don't hot-loop 10s timeouts every cycle.
  const backoffUntil = _gmailRefreshBackoff.get(cacheKey) || 0;
  if (Date.now() < backoffUntil) {
    return cached?.token || null;
  }

  // If a refresh is already in-flight for this account, wait for it instead of firing another
  const inflight = _gmailRefreshLock.get(cacheKey);
  if (inflight) return inflight;

  const refreshPromise = _doRefreshGmailToken(orgId, senderEmail, cacheKey);
  _gmailRefreshLock.set(cacheKey, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    _gmailRefreshLock.delete(cacheKey);
  }
}

async function _doRefreshGmailToken(orgId: string, senderEmail: string | undefined, cacheKey: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  
  // Try per-sender tokens first (for multi-account support)
  const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
  let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
  let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
  let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
  
  // Fall back to org-level tokens ONLY if no per-sender tokens exist at all
  // CRITICAL: Don't mix refresh tokens from different accounts!
  if (!accessToken && !refreshToken) {
    accessToken = settings.gmail_access_token;
    refreshToken = settings.gmail_refresh_token;
    tokenExpiry = settings.gmail_token_expiry;
  }
  
  const expiry = parseInt(tokenExpiry || '0');
  if (accessToken && Date.now() < expiry - 300000) {
    // Warm the in-memory cache so future calls skip the DB read entirely
    _gmailTokenCache.set(cacheKey, { token: accessToken, expiry });
    return accessToken;
  }
  if (!refreshToken) return accessToken || null;
  let clientId = settings.google_oauth_client_id || '';
  let clientSecret = settings.google_oauth_client_secret || '';
  
  // Fallback: try superadmin's org for OAuth credentials
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
  if (!clientId) clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientSecret) clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return accessToken || null;

  // Direct fetch to Google's token endpoint with AbortController timeout.
  // We previously used google-auth-library's refreshAccessToken() but observed
  // 30s hangs (keep-alive socket reuse against half-open TCP). Each call here
  // creates a fresh connection bound to this request's abort signal, so a stuck
  // socket can't block future refresh attempts.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ac.signal,
    });
    if (resp.ok) {
      const tokens = await resp.json() as any;
      if (tokens.access_token) {
        const expiryMs = Date.now() + ((tokens.expires_in || 3600) * 1000);
        if (senderEmail) {
          await storage.setApiSetting(orgId, `${senderPrefix}access_token`, tokens.access_token);
          await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(expiryMs));
        } else {
          await storage.setApiSetting(orgId, 'gmail_access_token', tokens.access_token);
          await storage.setApiSetting(orgId, 'gmail_token_expiry', String(expiryMs));
        }
        _gmailTokenCache.set(cacheKey, { token: tokens.access_token, expiry: expiryMs });
        _gmailRefreshBackoff.delete(cacheKey); // clear any prior backoff on success
        return tokens.access_token;
      }
    } else {
      // Non-2xx: log status + body so invalid_grant etc. is visible. Set backoff.
      let errText = '';
      try { errText = await resp.text(); } catch { /* ignore */ }
      console.error(`[CampaignEngine] Gmail token refresh HTTP ${resp.status} for ${senderEmail || orgId}: ${errText.slice(0, 200)}`);
      _gmailRefreshBackoff.set(cacheKey, Date.now() + REFRESH_BACKOFF_MS);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[CampaignEngine] Gmail token refresh failed for ${senderEmail || orgId}: ${msg}`);
    _gmailRefreshBackoff.set(cacheKey, Date.now() + REFRESH_BACKOFF_MS);
  } finally {
    clearTimeout(timer);
  }
  // Cache existing token if still valid so subsequent calls skip the DB read
  if (accessToken) {
    const exp = parseInt(String(tokenExpiry || '0'));
    if (exp > Date.now()) _gmailTokenCache.set(cacheKey, { token: accessToken, expiry: exp });
  }
  return accessToken || null;
}

/**
 * Refresh a Microsoft access token if expired.
 */
async function refreshMicrosoftToken(orgId: string, senderEmail?: string): Promise<string | null> {
  const cacheKey = `${orgId}:${senderEmail || '__org__'}`;
  const cached = _msTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry - 300_000) return cached.token;
  const backoffUntil = _msRefreshBackoff.get(cacheKey) || 0;
  if (Date.now() < backoffUntil) return cached?.token || null;
  const inflight = _msRefreshLock.get(cacheKey);
  if (inflight) return inflight;
  const p = _doRefreshMicrosoftToken(orgId, senderEmail, cacheKey);
  _msRefreshLock.set(cacheKey, p);
  try { return await p; } finally { _msRefreshLock.delete(cacheKey); }
}

async function _doRefreshMicrosoftToken(orgId: string, senderEmail: string | undefined, cacheKey: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);

  // Try per-sender tokens first (for multi-account support)
  const senderPrefix = senderEmail ? `outlook_sender_${senderEmail}_` : '';
  let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
  let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
  let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
  let isPerSender = !!(accessToken || refreshToken);

  // Fall back to org-level tokens ONLY if no per-sender tokens exist at all
  // CRITICAL: Don't mix refresh tokens from different accounts!
  if (!accessToken && !refreshToken) {
    accessToken = settings.microsoft_access_token;
    refreshToken = settings.microsoft_refresh_token;
    tokenExpiry = settings.microsoft_token_expiry;
    isPerSender = false;
  }

  const expiry = parseInt(tokenExpiry || '0');
  if (accessToken && Date.now() < expiry - 300000) {
    _msTokenCache.set(cacheKey, { token: accessToken, expiry });
    return accessToken;
  }
  if (!refreshToken) return accessToken || null;
  let clientId = settings.microsoft_oauth_client_id || '';
  let clientSecret = settings.microsoft_oauth_client_secret || '';

  // Fallback: try superadmin's org for OAuth credentials
  if (!clientId || !clientSecret) {
    try {
      const superAdminOrgId = await storage.getSuperAdminOrgId();
      if (superAdminOrgId && superAdminOrgId !== orgId) {
        const superSettings = await storage.getApiSettings(superAdminOrgId);
        if (superSettings.microsoft_oauth_client_id) {
          clientId = superSettings.microsoft_oauth_client_id;
          clientSecret = superSettings.microsoft_oauth_client_secret || '';
        }
      }
    } catch (e) { /* ignore */ }
  }
  if (!clientId) clientId = process.env.MICROSOFT_CLIENT_ID || '';
  if (!clientSecret) clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return accessToken || null;

  try {
    const body = new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
    });
    const ac = new AbortController();
    const msTimer = setTimeout(() => ac.abort(), 10000);
    let resp: Response;
    try {
      resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(), signal: ac.signal,
      });
    } finally {
      clearTimeout(msTimer);
    }
    if (resp.ok) {
      const tokens = await resp.json() as any;
      if (tokens.access_token) {
        // Store refreshed tokens for the specific sender if applicable
        if (senderEmail) {
          await storage.setApiSetting(orgId, `${senderPrefix}access_token`, tokens.access_token);
          if (tokens.refresh_token) await storage.setApiSetting(orgId, `${senderPrefix}refresh_token`, tokens.refresh_token);
          const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
          await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(exp));
          _msTokenCache.set(cacheKey, { token: tokens.access_token, expiry: exp });
        } else {
          // Only update org-level tokens when NOT refreshing a per-sender token
          // CRITICAL: Don't overwrite org-level tokens with a secondary account's tokens!
          await storage.setApiSetting(orgId, 'microsoft_access_token', tokens.access_token);
          if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
          const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
          await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
          _msTokenCache.set(cacheKey, { token: tokens.access_token, expiry: exp });
        }
        _msRefreshBackoff.delete(cacheKey);
        return tokens.access_token;
      }
    } else {
      let errText = '';
      try { errText = await resp.text(); } catch { /* ignore */ }
      console.error(`[CampaignEngine] Microsoft token refresh HTTP ${resp.status} for ${senderEmail || orgId}: ${errText.slice(0, 200)}`);
      _msRefreshBackoff.set(cacheKey, Date.now() + REFRESH_BACKOFF_MS);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[CampaignEngine] Microsoft token refresh failed for ${senderEmail || orgId}: ${msg}`);
    _msRefreshBackoff.set(cacheKey, Date.now() + REFRESH_BACKOFF_MS);
  }
  if (accessToken) {
    const exp = parseInt(String(tokenExpiry || '0'));
    if (exp > Date.now()) _msTokenCache.set(cacheKey, { token: accessToken, expiry: exp });
  }
  return accessToken || null;
}

interface AutopilotDaySchedule {
  enabled: boolean;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
}

interface AutopilotConfig {
  enabled: boolean;
  days: { [dayName: string]: AutopilotDaySchedule };
  maxPerDay: number;
  delayBetween: number;
  delayUnit: 'seconds' | 'minutes';
}

interface SendingConfig {
  delayBetweenEmails: number;
  batchSize?: number;
  autopilot?: AutopilotConfig | null;
  timezoneOffset?: number | null; // minutes offset from UTC (e.g. -330 for IST) — legacy fallback
  timezone?: string | null; // IANA timezone name (e.g. "Asia/Kolkata") — DST-aware, preferred over timezoneOffset
}

interface CampaignSendOptions {
  campaignId: string;
  delayBetweenEmails?: number; // ms between each email (throttling)
  batchSize?: number;
  startTime?: Date;
  stepNumber?: number; // which step in the sequence (0 = initial, 1+ = follow-ups)
  sendingConfig?: SendingConfig | null;
}

interface PersonalizationData {
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  [key: string]: any;
}

/**
 * Get user's local time from sendingConfig. Prefers IANA timezone (DST-aware),
 * falls back to numeric timezoneOffset for backward compatibility.
 */
function getUserLocalTime(sendingConfig: SendingConfig | any): Date {
  // Prefer IANA timezone name (handles DST automatically)
  if (sendingConfig?.timezone) {
    try {
      const nowUtc = new Date();
      const localStr = nowUtc.toLocaleString('en-US', { timeZone: sendingConfig.timezone });
      return new Date(localStr);
    } catch (e) {
      // Invalid timezone name — fall through to offset
    }
  }
  // Fallback: numeric offset (legacy, no DST awareness)
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const userLocalMs = utcMs - (sendingConfig?.timezoneOffset || 0) * 60000;
  return new Date(userLocalMs);
}

export class CampaignEngine {
  private activeCampaigns: Map<string, { timer: any; paused: boolean; progress: number; total: number }> = new Map();
  private _publicBaseUrl: string | null = null;

  /**
   * Check if we're currently within the allowed sending window based on autopilot config.
   * Returns { canSend, reason, pauseUntilMs } where pauseUntilMs is the ms to wait until the next window opens.
   */
  private checkSendingWindow(sendingConfig: SendingConfig | null | undefined): { canSend: boolean; reason?: string; pauseUntilMs?: number } {
    if (!sendingConfig?.autopilot?.enabled) return { canSend: true };

    const autopilot = sendingConfig.autopilot;
    // Calculate user's local time (prefers IANA timezone for DST awareness, falls back to offset)
    const userLocal = getUserLocalTime(sendingConfig);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[userLocal.getDay()];
    const dayConfig = autopilot.days?.[dayName];

    console.log(`[CampaignEngine] checkSendingWindow: serverUTC=${new Date().toISOString()}, userLocal=${userLocal.toISOString()}, day=${dayName}, tz=${sendingConfig.timezone || 'offset:' + sendingConfig.timezoneOffset}, dayEnabled=${dayConfig?.enabled}, startTime=${dayConfig?.startTime}, endTime=${dayConfig?.endTime}`);

    if (!dayConfig || !dayConfig.enabled) {
      // Find next enabled day
      const pauseMs = this.msUntilNextSendWindow(autopilot, sendingConfig.timezoneOffset || 0, sendingConfig.timezone);
      console.log(`[CampaignEngine] checkSendingWindow: BLOCKED — ${dayName} is disabled. Pause ${Math.round(pauseMs / 60000)} min`);
      return { canSend: false, reason: `Sending disabled on ${dayName}`, pauseUntilMs: pauseMs };
    }

    // Check time window for today
    const currentHH = String(userLocal.getHours()).padStart(2, '0');
    const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHH}:${currentMM}`;

    console.log(`[CampaignEngine] checkSendingWindow: currentTime=${currentTime}, window=${dayConfig.startTime}-${dayConfig.endTime}`);

    if (dayConfig.startTime && currentTime < dayConfig.startTime) {
      // Before start time — wait until start
      const [sh, sm] = dayConfig.startTime.split(':').map(Number);
      const startMs = new Date(userLocal);
      startMs.setHours(sh, sm, 0, 0);
      const waitMs = startMs.getTime() - userLocal.getTime();
      console.log(`[CampaignEngine] checkSendingWindow: BLOCKED — before start (${currentTime} < ${dayConfig.startTime})`);
      return { canSend: false, reason: `Before sending hours (starts at ${dayConfig.startTime})`, pauseUntilMs: Math.max(waitMs, 60000) };
    }

    if (dayConfig.endTime && currentTime >= dayConfig.endTime) {
      // After end time — wait until next day's window
      const pauseMs = this.msUntilNextSendWindow(autopilot, sendingConfig.timezoneOffset || 0, sendingConfig.timezone);
      console.log(`[CampaignEngine] checkSendingWindow: BLOCKED — after end (${currentTime} >= ${dayConfig.endTime})`);
      return { canSend: false, reason: `After sending hours (ended at ${dayConfig.endTime})`, pauseUntilMs: pauseMs };
    }

    console.log(`[CampaignEngine] checkSendingWindow: OK — within window`);
    return { canSend: true };
  }

  /**
   * Calculate how many ms until the next sending window opens.
   */
  private msUntilNextSendWindow(autopilot: AutopilotConfig, timezoneOffset: number, timezone?: string | null): number {
    const userLocal = getUserLocalTime({ timezoneOffset, timezone });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
      const checkDate = new Date(userLocal);
      checkDate.setDate(checkDate.getDate() + (daysAhead === 0 ? 0 : daysAhead));
      const dayName = dayNames[checkDate.getDay()];
      const dayConfig = autopilot.days?.[dayName];

      if (dayConfig?.enabled && dayConfig.startTime) {
        const [sh, sm] = dayConfig.startTime.split(':').map(Number);
        const windowStart = new Date(checkDate);
        windowStart.setHours(sh, sm, 0, 0);

        if (daysAhead === 0) {
          // Same day — check if the window hasn't ended yet or starts later today
          if (dayConfig.endTime) {
            const currentHH = String(userLocal.getHours()).padStart(2, '0');
            const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
            const currentTime = `${currentHH}:${currentMM}`;
            if (currentTime >= dayConfig.endTime) continue; // Window ended today, check tomorrow
          }
          if (windowStart.getTime() > userLocal.getTime()) {
            // Window starts later today
            return windowStart.getTime() - userLocal.getTime();
          }
          // We're currently in the window (shouldn't be called if canSend=true)
          continue;
        } else {
          // Future day — calculate ms until that day's start time
          windowStart.setDate(userLocal.getDate() + daysAhead);
          return windowStart.getTime() - userLocal.getTime();
        }
      }
    }
    // Fallback: wait 1 hour
    return 3600000;
  }

  /**
   * Set the public base URL for tracking links (call from route handler with req info).
   * Always forces HTTPS for non-localhost URLs since tracking pixels need to be loaded
   * from external email clients which often require HTTPS.
   */
  setPublicBaseUrl(url: string): void {
    let cleanUrl = url.replace(/\/$/, '');
    // Force HTTPS for any non-localhost URL (sandbox, production, etc.)
    if (!cleanUrl.includes('localhost') && !cleanUrl.includes('127.0.0.1')) {
      cleanUrl = cleanUrl.replace(/^http:\/\//, 'https://');
    }
    this._publicBaseUrl = cleanUrl;
  }

  /**
   * Get the base URL for tracking links.
   * Priority: manually set URL > env vars > localhost fallback.
   * All non-localhost URLs are forced to HTTPS.
   */
  getBaseUrl(): string {
    const url = this._publicBaseUrl || process.env.BASE_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    // Force HTTPS for non-localhost
    if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
      return url.replace(/^http:\/\//, 'https://');
    }
    return url;
  }

  /**
   * Personalize template content with contact data
   */
  personalizeContent(template: string, data: PersonalizationData): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        result = result.replace(regex, String(value));
      }
    }
    // Remove any remaining unresolved variables
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  /**
   * Start sending a campaign
   */
  async startCampaign(options: CampaignSendOptions): Promise<{ success: boolean; error?: string }> {
    const { campaignId, delayBetweenEmails = 2000, batchSize = 10, stepNumber = 0, sendingConfig: optSendingConfig } = options;
    
    console.log(`[CampaignEngine] startCampaign called: campaignId=${campaignId}, delayBetweenEmails=${delayBetweenEmails}ms, batchSize=${batchSize}, hasSendingConfig=${!!optSendingConfig}`);

    try {
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return { success: false, error: 'Campaign not found' };

      if (!campaign.emailAccountId) return { success: false, error: 'No email account assigned to campaign' };
      if (!campaign.templateId && !campaign.subject) return { success: false, error: 'No template or subject set' };

      // Get email account
      const emailAccount = await storage.getEmailAccount(campaign.emailAccountId);
      if (!emailAccount) return { success: false, error: 'Email account not found' };
      if (!emailAccount.smtpConfig) return { success: false, error: 'Email account SMTP not configured' };

      // Get contacts for this campaign (batch-loaded to avoid N+1 queries)
      let contacts: any[];
      if (campaign.segmentId) {
        contacts = await storage.getContactsBySegment(campaign.segmentId);
      } else if (campaign.contactIds && campaign.contactIds.length > 0) {
        // Bulk load all contacts in one query instead of one-by-one
        contacts = await storage.getContactsByIds(campaign.contactIds);
        // If contactIds were explicitly set but resolve to nothing, abort — do NOT fall back to all org contacts (causes OOM on large orgs)
        if (contacts.length === 0) {
          console.error(`[CampaignEngine] contactIds ${JSON.stringify(campaign.contactIds.slice(0, 5))} resolved to 0 contacts — aborting campaign ${campaign.id} to prevent OOM fallback`);
          return { success: false, error: 'Campaign contactIds resolve to 0 contacts — please re-import or reassign contacts' };
        }
      } else {
        contacts = await storage.getContacts(campaign.organizationId, 10000, 0);
      }

      // Filter out unsubscribed and bounced contacts
      const beforeFilterCount = contacts.length;
      const bouncedContacts = contacts.filter(c => c.status === 'bounced');
      const unsubscribedContacts = contacts.filter(c => c.status === 'unsubscribed');
      contacts = contacts.filter(c => c.status !== 'unsubscribed' && c.status !== 'bounced');

      // Also filter against suppression list (catches emails blocked even without a contact record)
      let suppressedCount = 0;
      try {
        const suppressedEmails = await storage.getSuppressedEmails(campaign.organizationId);
        if (suppressedEmails.size > 0) {
          const before = contacts.length;
          contacts = contacts.filter(c => !suppressedEmails.has((c.email || '').toLowerCase()));
          suppressedCount = before - contacts.length;
        }
      } catch (e) { /* non-critical — proceed without suppression check */ }

      if (bouncedContacts.length > 0 || unsubscribedContacts.length > 0 || suppressedCount > 0) {
        console.log(`[CampaignEngine] Campaign ${campaignId} contact filtering: ${beforeFilterCount} loaded, ${bouncedContacts.length} bounced, ${unsubscribedContacts.length} unsubscribed, ${suppressedCount} suppressed, ${contacts.length} remaining`);
      }

      // Filter out contacts with invalid email verification status (if block_invalid is enabled)
      let invalidEmailCount = 0;
      try {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId) {
          const elvSettings = await storage.getApiSettings(superAdminOrgId);
          if (elvSettings.emaillistverify_block_invalid === 'true') {
            const blockedStatuses = new Set(['invalid', 'disposable', 'spamtrap']);
            const beforeVerifyFilter = contacts.length;
            contacts = contacts.filter((c: any) => !blockedStatuses.has(c.emailVerificationStatus));
            invalidEmailCount = beforeVerifyFilter - contacts.length;
            if (invalidEmailCount > 0) {
              console.log(`[CampaignEngine] Campaign ${campaignId}: skipped ${invalidEmailCount} contacts with invalid/disposable/spamtrap email verification status`);
            }
          }
        }
      } catch (e) { /* non-critical, continue sending */ }

      if (contacts.length === 0) return { success: false, error: `No contacts to send to (${bouncedContacts.length} bounced, ${unsubscribedContacts.length} unsubscribed, ${invalidEmailCount} invalid email out of ${beforeFilterCount} total)` };

      // ===== CRITICAL FIX: Skip contacts that already have messages for this campaign/step =====
      // This prevents duplicate sends when resuming a paused campaign
      let alreadyProcessedCount = 0;
      try {
        const existingMessages = await storage.getCampaignMessages(campaignId, 100000, 0) as any[];
        if (existingMessages && existingMessages.length > 0) {
          // Build set of contactIds that already have a message for this step (sent, failed, or sending)
          const alreadyProcessedContactIds = new Set(
            existingMessages
              .filter((m: any) => (m.stepNumber || 0) === stepNumber)
              .map((m: any) => m.contactId)
          );

          if (alreadyProcessedContactIds.size > 0) {
            const beforeCount = contacts.length;
            contacts = contacts.filter(c => !alreadyProcessedContactIds.has(c.id));
            alreadyProcessedCount = beforeCount - contacts.length;
            if (alreadyProcessedCount > 0) {
              console.log(`[CampaignEngine] Resuming campaign ${campaignId}: skipped ${alreadyProcessedCount} already-processed contacts, ${contacts.length} remaining`);
            }
          }
        }
      } catch (e) {
        console.error('[CampaignEngine] Error checking existing messages, proceeding with all contacts:', e);
      }

      if (contacts.length === 0) {
        // All contacts already processed — check if follow-ups exist before marking completed
        const hasFollowups = await storage.hasActiveFollowupSteps(campaignId);
        if (hasFollowups) {
          console.log(`[CampaignEngine] All Step 1 contacts processed for campaign ${campaignId}. Follow-ups pending — status set to 'following_up'`);
          await storage.updateCampaign(campaignId, { status: 'following_up' });
        } else {
          console.log(`[CampaignEngine] All contacts already processed for campaign ${campaignId}, marking completed`);
          await storage.updateCampaign(campaignId, { status: 'completed' });
        }
        return { success: true };
      }

      // Get template if specified
      let subject = campaign.subject || '';
      let content = campaign.content || '';
      if (campaign.templateId) {
        const template = await storage.getEmailTemplate(campaign.templateId);
        if (template) {
          subject = template.subject;
          content = template.content;
        }
      }

      // Update campaign to active
      // totalRecipients = remaining + already-processed. Guard with Math.max against the existing
      // value so resumes never shrink the displayed audience (previously overwrote 1159 with 303).
      const intendedTotal = contacts.length + alreadyProcessedCount;
      const newTotalRecipients = Math.max(campaign.totalRecipients || 0, intendedTotal);
      await storage.updateCampaign(campaignId, {
        status: 'active',
        totalRecipients: newTotalRecipients,
      });

      // Track active campaign
      this.activeCampaigns.set(campaignId, {
        timer: null,
        paused: false,
        progress: 0,
        total: contacts.length,
      });

      // Load sendingConfig: prefer what was passed in options, then from the campaign DB record
      const savedConfig: SendingConfig | null = campaign.sendingConfig || null;
      const activeSendingConfig: SendingConfig = optSendingConfig || savedConfig || { delayBetweenEmails };
      
      // Use the configured delay from sendingConfig — this is the user's chosen delay (e.g. 2 minutes = 120000ms)
      // Fallback chain: sendingConfig.delayBetweenEmails > options.delayBetweenEmails > 2000ms default
      const effectiveDelay = activeSendingConfig.delayBetweenEmails || delayBetweenEmails;
      
      const ap = activeSendingConfig.autopilot;
      console.log(`[CampaignEngine] ===== CAMPAIGN START =====`);
      console.log(`[CampaignEngine] Campaign: ${campaignId}, Contacts: ${contacts.length}`);
      console.log(`[CampaignEngine] Delay between emails: ${effectiveDelay}ms (${(effectiveDelay / 1000).toFixed(0)}s)`);
      console.log(`[CampaignEngine] Autopilot: ${ap?.enabled ? 'ON' : 'OFF'}`);
      if (ap?.enabled) {
        console.log(`[CampaignEngine]   Max per day: ${ap.maxPerDay || 'unlimited'}`);
        console.log(`[CampaignEngine]   Delay config: ${ap.delayBetween} ${ap.delayUnit}`);
        console.log(`[CampaignEngine]   Timezone offset: ${activeSendingConfig.timezoneOffset ?? 'not set'}`);
        const enabledDays = Object.entries(ap.days || {}).filter(([_, d]) => d.enabled).map(([name, d]) => `${name}(${d.startTime}-${d.endTime})`);
        console.log(`[CampaignEngine]   Send days: ${enabledDays.join(', ')}`);
      }
      console.log(`[CampaignEngine] ==========================`);

      // Send emails in batches with throttling
      this.sendBatched(campaignId, contacts, emailAccount, subject, content, effectiveDelay, batchSize, stepNumber, activeSendingConfig)
        .catch(async (err) => {
          console.error(`[CampaignEngine] FATAL: sendBatched crashed for campaign ${campaignId}:`, err);
          try {
            await storage.updateCampaign(campaignId, { status: 'paused', autoPaused: true });
            this.activeCampaigns.delete(campaignId);
          } catch { }
        });

      return { success: true };
    } catch (error) {
      console.error('Failed to start campaign:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send emails in batches with throttling and time-window enforcement
   */
  private async sendBatched(
    campaignId: string,
    contacts: any[],
    emailAccount: any,
    subject: string,
    content: string,
    delay: number,
    batchSize: number,
    stepNumber: number = 0,
    sendingConfig?: SendingConfig | null
  ): Promise<void> {
    const smtpConfig: SmtpConfig = emailAccount.smtpConfig;
    const tracker = this.activeCampaigns.get(campaignId);
    const baseUrl = this.getBaseUrl();
    
    // Pre-load campaign config once (avoid per-email DB read)
    const campaignConfig = await storage.getCampaign(campaignId);
    
    // Track sent/bounced counts locally to avoid re-reading campaign for every email
    let localSentCount = 0;
    let localBouncedCount = 0;
    let localFailedCount = 0; // Infrastructure failures (auth errors, etc.) — NOT real bounces
    // Batch size for DB count updates (flush every N emails)
    const FLUSH_INTERVAL = 25;

    // Bounce-surge detection: rolling window of last N send outcomes for this sender account.
    // If bounce rate within the window exceeds threshold, auto-pause and alert — the provider
    // has likely blocked this sender (Outlook 550 5.7.1 policy block, mass rejection, etc.).
    const SURGE_WINDOW = 50;
    const SURGE_BOUNCE_THRESHOLD = 0.2; // 20% bounce rate
    const SURGE_MIN_BOUNCES = 10; // need at least 10 bounces before tripping
    const SURGE_CONSECUTIVE = 10; // OR 10 consecutive bounces = immediate pause
    const sendWindow: ('sent' | 'bounced')[] = [];
    let consecutiveBounces = 0;
    let surgeTriggered = false;
    
    // Track daily limit locally (refresh from DB on flush)
    // Use the account's stored dailyLimit, falling back to provider-based limit
    let accountDailySent = emailAccount.dailySent || 0;
    let accountDailyLimit = emailAccount.dailyLimit || getProviderDailyLimit(emailAccount.provider || smtpConfig?.provider || 'custom');

    // Track daily sends for autopilot maxPerDay enforcement (separate from account daily limit)
    let autopilotDailySent = 0;
    const autopilotMaxPerDay = sendingConfig?.autopilot?.enabled ? (sendingConfig.autopilot.maxPerDay || Infinity) : Infinity;
    
    console.log(`[CampaignEngine] Campaign ${campaignId} send loop starting: delay=${delay}ms, accountDailySent=${accountDailySent}, accountDailyLimit=${accountDailyLimit}, autopilotMaxPerDay=${autopilotMaxPerDay === Infinity ? 'unlimited' : autopilotMaxPerDay}, autopilotEnabled=${sendingConfig?.autopilot?.enabled || false}, provider=${emailAccount.provider}, email=${emailAccount.email}`);
    console.log(`[CampaignEngine] Campaign ${campaignId} sendingConfig: ${JSON.stringify(sendingConfig)?.slice(0, 500)}`);
    if (accountDailySent >= accountDailyLimit) {
      console.error(`[CampaignEngine] *** DAILY LIMIT ALREADY REACHED *** Campaign ${campaignId}: ${accountDailySent} >= ${accountDailyLimit} — will pause on first contact!`);
    }

    // ===== PRE-LOAD REPLIED CONTACTS =====
    // Build set of contactIds that already replied in this campaign (e.g. during pause)
    // This prevents sending to contacts who replied while campaign was paused
    const repliedContactIds = new Set<string>();
    try {
      const allMsgs = await storage.getCampaignMessages(campaignId, 100000, 0) as any[];
      for (const m of allMsgs) {
        if (m.repliedAt && m.contactId) repliedContactIds.add(m.contactId);
      }
      if (repliedContactIds.size > 0) {
        console.log(`[CampaignEngine] Campaign ${campaignId}: ${repliedContactIds.size} contacts already replied, will skip them`);
      }
    } catch (e) {
      // Non-fatal — proceed without reply check if this fails
    }

    console.log(`[CampaignEngine] Campaign ${campaignId} entering for loop with ${contacts.length} contacts`);

    for (let i = 0; i < contacts.length; i++) {
      if (i === 0) console.log(`[CampaignEngine] Campaign ${campaignId} processing FIRST contact: ${contacts[i]?.email}`);
      // Check if paused or stopped
      if (!tracker || tracker.paused) {
        // Wait until resumed
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            const t = this.activeCampaigns.get(campaignId);
            if (!t) { clearInterval(check); resolve(); return; }
            if (!t.paused) { clearInterval(check); resolve(); }
          }, 1000);
        });
      }

      // Check if campaign was deleted/stopped
      if (!this.activeCampaigns.has(campaignId)) break;

      // ===== TIME WINDOW ENFORCEMENT =====
      // Check if we're within the allowed sending window based on autopilot schedule
      const windowCheck = this.checkSendingWindow(sendingConfig);
      if (!windowCheck.canSend) {
        console.log(`[CampaignEngine] Campaign ${campaignId} outside sending window: ${windowCheck.reason}. Pausing for ${Math.round((windowCheck.pauseUntilMs || 0) / 60000)} minutes.`);
        
        // Flush any pending counts before sleeping
        if (localSentCount > 0 || localBouncedCount > 0) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }

        // Auto-pause the campaign and wait until next window
        await storage.updateCampaign(campaignId, { status: 'paused', autoPaused: true });
        if (tracker) tracker.paused = true;

        // Sleep until the next sending window opens (check every 60s in case of manual resume)
        const sleepUntil = Date.now() + (windowCheck.pauseUntilMs || 3600000);
        while (Date.now() < sleepUntil) {
          // Check if campaign was stopped or deleted during sleep
          if (!this.activeCampaigns.has(campaignId)) return;
          
          // Re-check sending window periodically (in case timezone/schedule changed)
          const recheck = this.checkSendingWindow(sendingConfig);
          if (recheck.canSend) break;
          
          await new Promise(resolve => setTimeout(resolve, 60000)); // Check every 60 seconds
        }

        // Check again if campaign still exists after sleeping
        if (!this.activeCampaigns.has(campaignId)) return;

        // Resume the campaign
        if (tracker) tracker.paused = false;
        await storage.updateCampaign(campaignId, { status: 'active', autoPaused: false });
        console.log(`[CampaignEngine] Campaign ${campaignId} sending window opened, resuming.`);
        
        // Reset daily counters when a new day starts
        autopilotDailySent = 0;
      }

      // ===== AUTOPILOT MAX PER DAY ENFORCEMENT =====
      if (autopilotDailySent >= autopilotMaxPerDay) {
        console.log(`[CampaignEngine] Campaign ${campaignId} reached autopilot daily limit (${autopilotMaxPerDay}). Pausing until next window.`);
        
        // Flush counts
        if (localSentCount > 0 || localBouncedCount > 0) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }

        // Pause until next day's window
        await storage.updateCampaign(campaignId, { status: 'paused', autoPaused: true });
        if (tracker) tracker.paused = true;
        
        const sleepMs = this.msUntilNextSendWindow(sendingConfig?.autopilot!, sendingConfig?.timezoneOffset || 0, sendingConfig?.timezone);
        const sleepUntil = Date.now() + sleepMs;
        while (Date.now() < sleepUntil) {
          if (!this.activeCampaigns.has(campaignId)) return;
          await new Promise(resolve => setTimeout(resolve, 60000));
        }

        if (!this.activeCampaigns.has(campaignId)) return;
        if (tracker) tracker.paused = false;
        await storage.updateCampaign(campaignId, { status: 'active', autoPaused: false });
        autopilotDailySent = 0;
        console.log(`[CampaignEngine] Campaign ${campaignId} daily limit reset, resuming.`);
      }

      const contact = contacts[i];

      try {
        // Daily limit enforcement: check before each email
        if (accountDailySent + localSentCount >= accountDailyLimit) {
          console.warn(`[CampaignEngine] Daily limit reached (${accountDailyLimit}) for account ${emailAccount.email}. Pausing campaign at ${i}/${contacts.length} until daily reset.`);
          // Flush counts before pausing
          if (localSentCount > 0 || localBouncedCount > 0) {
            const updatedCampaign = await storage.getCampaign(campaignId);
            if (updatedCampaign) {
              await storage.updateCampaign(campaignId, {
                sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
                bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
              });
            }
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            localSentCount = 0;
            localBouncedCount = 0;
          }
          
          // Sleep until next day (check every 5 minutes for daily reset)
          // Instead of permanently stopping, pause and wait for daily counter reset
          await storage.updateCampaign(campaignId, { status: 'paused', autoPaused: true });
          if (tracker) tracker.paused = true;

          console.log(`[CampaignEngine] Campaign ${campaignId} sleeping until daily limit resets...`);
          
          // Wait up to 24 hours, checking every 5 minutes if daily limit has been reset
          const maxWait = Date.now() + 24 * 60 * 60 * 1000;
          while (Date.now() < maxWait) {
            if (!this.activeCampaigns.has(campaignId)) return; // Campaign was stopped
            
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes
            
            // Re-check daily limit (counters reset at midnight)
            const refreshedAccount = await storage.getEmailAccount(emailAccount.id) as any;
            if (refreshedAccount) {
              accountDailySent = refreshedAccount.dailySent || 0;
              if (accountDailySent < accountDailyLimit) {
                console.log(`[CampaignEngine] Campaign ${campaignId} daily limit reset (${accountDailySent}/${accountDailyLimit}), resuming.`);
                break;
              }
            }
          }
          
          if (!this.activeCampaigns.has(campaignId)) return;
          if (tracker) tracker.paused = false;
          await storage.updateCampaign(campaignId, { status: 'active', autoPaused: false });
        }
        // ===== REPLY RE-CHECK ON RESUME =====
        // Skip contacts who replied during pause (checked via pre-loaded set)
        if (repliedContactIds.has(contact.id)) {
          console.log(`[CampaignEngine] Skipping contact ${contact.email} — replied during pause`);
          continue;
        }

        // Personalize
        const personalData: PersonalizationData = {
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          email: contact.email,
          company: contact.company || '',
          jobTitle: contact.jobTitle || '',
          fullName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          phone: contact.phone || '',
          mobilePhone: contact.mobilePhone || '',
          linkedinUrl: contact.linkedinUrl || '',
          seniority: contact.seniority || '',
          department: contact.department || '',
          city: contact.city || '',
          state: contact.state || '',
          country: contact.country || '',
          website: contact.website || '',
          industry: contact.industry || '',
          employeeCount: contact.employeeCount || '',
          annualRevenue: contact.annualRevenue || '',
          companyCity: contact.companyCity || '',
          companyState: contact.companyState || '',
          companyCountry: contact.companyCountry || '',
          // Spread any customFields so {{customKey}} also works
          ...(contact.customFields || {}),
        };

        const personalizedSubject = this.personalizeContent(subject, personalData);
        const personalizedContent = this.personalizeContent(content, personalData);

        // Generate tracking ID
        const trackingId = `${campaignId}_${contact.id}_${Date.now()}`;

        // Add unsubscribe link if campaign has it enabled
        let contentWithUnsub = personalizedContent;
        if (campaignConfig?.includeUnsubscribe) {
          const unsubUrl = `${baseUrl}/api/track/unsubscribe/${trackingId}`;
          contentWithUnsub += `<p style="text-align:center;margin-top:30px;font-size:11px;color:#999;"><a href="${unsubUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a></p>`;
        }

        // Add open tracking pixel (with absolute URL)
        const trackedContent = this.addTrackingPixel(contentWithUnsub, trackingId, baseUrl);

        // Add click tracking to links (with absolute URL)
        const clickTrackedContent = this.addClickTracking(trackedContent, trackingId, baseUrl);

        // Generate a unique Message-ID for reply tracking
        const messageId = `<${trackingId}@${(smtpConfig.fromEmail || 'noreply@aimailpilot.com').split('@')[1] || 'aimailpilot.com'}>`;

        // Create message record with step number
        const messageRecord = await storage.createCampaignMessage({
          campaignId,
          contactId: contact.id,
          subject: personalizedSubject,
          content: clickTrackedContent,
          status: 'sending',
          trackingId,
          emailAccountId: emailAccount.id,
          stepNumber,
          messageId,
          recipientEmail: contact.email,
        });

        // Send email — try API methods first (Gmail API / Microsoft Graph), fall back to SMTP
        const emailHeaders: Record<string, string> = {
          'Message-ID': messageId,
          'X-AImailPilot-Campaign': campaignId,
          'X-AImailPilot-Contact': contact.id,
          'X-AImailPilot-Tracking': trackingId,
          'X-AImailPilot-Step': String(stepNumber),
        };

        let result: SendResult;
        const provider = emailAccount.provider || smtpConfig?.provider || '';
        const fromEmail = smtpConfig?.fromEmail || emailAccount.email || '';
        const orgId = emailAccount.organizationId || '';

        // Detect if this account uses OAuth (password is a placeholder, not real SMTP creds)
        const isOAuthAccount = smtpConfig?.auth?.pass === 'OAUTH_TOKEN';

        if (provider === 'gmail' || provider === 'google') {
          // Try Gmail API first
          const accessToken = await withTimeout(refreshGmailToken(orgId, fromEmail), 30000, `refreshGmailToken(${fromEmail})`);
          if (accessToken) {
            console.log(`[CampaignEngine] Sending via Gmail API to ${contact.email}`);
            result = await sendViaGmailAPI(accessToken, {
              from: smtpConfig?.fromName ? `${smtpConfig.fromName} <${fromEmail}>` : fromEmail,
              to: contact.email,
              subject: mimeEncodeSubject(personalizedSubject),
              html: clickTrackedContent,
              headers: emailHeaders,
            });
            // If Gmail API fails with auth error, only fall back to SMTP if we have real SMTP credentials
            if (!result.success && result.error?.includes('401')) {
              if (!isOAuthAccount) {
                console.log(`[CampaignEngine] Gmail API auth failed, falling back to SMTP for ${contact.email}`);
                result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
                  to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
                });
              } else {
                console.error(`[CampaignEngine] Gmail API auth failed for OAuth account ${fromEmail}. No SMTP fallback available. User needs to re-authenticate.`);
                result = { success: false, error: `Gmail OAuth token expired for ${fromEmail}. Please re-authenticate with Google in Account Settings.` };
              }
            }
          } else if (!isOAuthAccount) {
            // No OAuth token but has real SMTP credentials — use SMTP
            result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
              to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
            });
          } else {
            // OAuth account but no token available
            console.error(`[CampaignEngine] No Gmail OAuth token for ${fromEmail}. User needs to re-authenticate.`);
            result = { success: false, error: `Gmail OAuth tokens not found for ${fromEmail}. Please re-authenticate with Google in Account Settings.` };
          }
        } else if (provider === 'outlook' || provider === 'microsoft') {
          // Try Microsoft Graph API first
          console.log(`[CampaignEngine] Outlook send: orgId=${orgId}, fromEmail=${fromEmail}, isOAuth=${isOAuthAccount}, provider=${provider}`);
          let accessToken = await withTimeout(refreshMicrosoftToken(orgId, fromEmail), 30000, `refreshMicrosoftToken(${fromEmail})`);
          if (accessToken) {
            console.log(`[CampaignEngine] Sending via Microsoft Graph to ${contact.email} (token len=${accessToken.length})`);
            result = await sendViaMicrosoftGraph(accessToken, {
              from: fromEmail,
              to: contact.email,
              subject: personalizedSubject,
              html: clickTrackedContent,
              headers: emailHeaders,
            });
            // If Graph fails with auth error, attempt a force token refresh and retry once
            if (!result.success && (result.error?.includes('401') || result.error?.includes('403') || result.error?.includes('InvalidAuthenticationToken'))) {
              console.log(`[CampaignEngine] Graph API auth failed for ${fromEmail}, forcing token refresh and retry...`);
              // Force refresh by clearing cached expiry
              try {
                await storage.setApiSetting(orgId, `outlook_sender_${fromEmail}_token_expiry`, '0');
              } catch (e) { /* ignore */ }
              const retryToken = await withTimeout(refreshMicrosoftToken(orgId, fromEmail), 30000, `retryRefreshMicrosoftToken(${fromEmail})`);
              if (retryToken && retryToken !== accessToken) {
                console.log(`[CampaignEngine] Token refreshed, retrying Graph API for ${contact.email}`);
                result = await sendViaMicrosoftGraph(retryToken, {
                  from: fromEmail,
                  to: contact.email,
                  subject: personalizedSubject,
                  html: clickTrackedContent,
                  headers: emailHeaders,
                });
              }
              // If still failing after retry, fall back to SMTP if available
              if (!result.success) {
                if (!isOAuthAccount) {
                  console.log(`[CampaignEngine] Graph API retry failed, falling back to SMTP for ${contact.email}`);
                  result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
                    to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
                  });
                } else {
                  console.error(`[CampaignEngine] Microsoft Graph auth failed for OAuth account ${fromEmail} after retry. No SMTP fallback available.`);
                  result = { success: false, error: `Microsoft OAuth token expired for ${fromEmail}. Please re-authenticate in Account Settings.` };
                }
              }
            }
          } else if (!isOAuthAccount) {
            // No OAuth token but has real SMTP credentials — use SMTP
            console.log(`[CampaignEngine] No OAuth token for Outlook ${fromEmail}, attempting SMTP with password`);
            result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
              to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
            });
            // If SMTP fails with auth error for Outlook, it likely means basic auth is disabled
            if (!result.success && result.error) {
              const isAuthError = result.error.includes('535') || result.error.includes('Authentication') || 
                result.error.includes('auth') || result.error.includes('Login') ||
                result.error.includes('AUTHENTICATE') || result.error.includes('credentials');
              if (isAuthError) {
                console.error(`[CampaignEngine] Outlook SMTP basic auth failed for ${fromEmail}. Microsoft has disabled basic authentication. Account must be re-connected via OAuth.`);
                result = { success: false, error: `Outlook SMTP authentication failed for ${fromEmail}. Microsoft has disabled basic password authentication. Please remove this account and re-add it using "Connect Outlook" (OAuth) in Account Settings.` };
              }
            }
          } else {
            // OAuth account but no token available
            console.error(`[CampaignEngine] No Microsoft OAuth token for ${fromEmail}. User needs to re-authenticate.`);
            result = { success: false, error: `Microsoft OAuth tokens not found for ${fromEmail}. Please re-authenticate in Account Settings.` };
          }
        } else {
          // Other providers — SMTP only
          result = await smtpEmailService.sendEmail(emailAccount.id, smtpConfig, {
            to: contact.email, subject: personalizedSubject, html: clickTrackedContent, trackingId, headers: emailHeaders,
          });
        }

        const nowIso = new Date().toISOString();

        if (result.success) {
          const msgUpdate: any = {
            status: 'sent',
            sentAt: nowIso,
            providerMessageId: result.messageId,
          };
          // Save Gmail threadId for follow-up threading (avoids extra API call later)
          if (result.threadId) msgUpdate.gmailThreadId = result.threadId;
          await storage.updateCampaignMessage(messageRecord.id, msgUpdate);

          // Save real RFC internetMessageId for Outlook follow-up threading.
          // followup-engine.ts uses originalMessage.messageId as fallback for In-Reply-To/References.
          if (result.internetMessageId) {
            try {
              await storage.rawRun('UPDATE messages SET "messageId" = ? WHERE id = ?', result.internetMessageId, messageRecord.id);
            } catch (e) {
              console.warn(`[CampaignEngine] Failed to save internetMessageId for ${messageRecord.id}:`, e);
            }
          }

          localSentCount++;
          autopilotDailySent++;
          sendWindow.push('sent');
          if (sendWindow.length > SURGE_WINDOW) sendWindow.shift();
          consecutiveBounces = 0;

          // Create 'sent' tracking event
          await storage.createTrackingEvent({
            type: 'sent',
            campaignId,
            messageId: messageRecord.id,
            contactId: contact.id,
            trackingId,
            stepNumber,
          });
        } else {
          await storage.updateCampaignMessage(messageRecord.id, {
            status: 'failed',
            errorMessage: result.error,
          });
          
          // Determine if this is a real bounce vs a sending infrastructure failure
          // OAuth errors, token issues, API errors are NOT bounces — the email never left
          const errorStr = (result.error || '').toLowerCase();
          const isInfrastructureError = errorStr.includes('oauth') || errorStr.includes('token') ||
            errorStr.includes('re-authenticate') || errorStr.includes('401') || errorStr.includes('403') ||
            (errorStr.includes('smtp') && errorStr.includes('auth')) || errorStr.includes('credentials') ||
            errorStr.includes('graph api error') || errorStr.includes('api error') || 
            errorStr.includes('connection refused') ||
            errorStr.includes('getaddrinfo') || errorStr.includes('timeout') ||
            errorStr.includes('invalidauthenticationtoken') || errorStr.includes('errormessage');
          
          if (isInfrastructureError) {
            // Infrastructure/auth failure — do NOT count as bounce, do NOT mark contact as bounced
            console.warn(`[CampaignEngine] Infrastructure error for ${contact.email}: ${result.error?.slice(0, 100)}`);
            
            // If ALL contacts are failing due to the same auth issue, pause the campaign to prevent mass failures
            localFailedCount++;
            
            // After 3 consecutive infrastructure failures, auto-pause the campaign
            if (localFailedCount >= 3 && localSentCount === 0) {
              console.error(`[CampaignEngine] Auto-pausing campaign ${campaignId}: ${localFailedCount} consecutive infrastructure failures. Error: ${result.error?.slice(0, 200)}`);
              // Flush counts before pausing
              const pauseCampaign = await storage.getCampaign(campaignId);
              if (pauseCampaign) {
                await storage.updateCampaign(campaignId, {
                  status: 'paused',
                  // Do NOT add infrastructure failures to bouncedCount — they're not real bounces
                });
              }
              this.activeCampaigns.delete(campaignId);
              return; // Stop sending
            }
          } else {
            // Real bounce (invalid email, mailbox full, etc.) — count as bounce
            localBouncedCount++;
            sendWindow.push('bounced');
            if (sendWindow.length > SURGE_WINDOW) sendWindow.shift();
            consecutiveBounces++;

            // Create 'bounce' tracking event
            await storage.createTrackingEvent({
              type: 'bounce',
              campaignId,
              messageId: messageRecord.id,
              contactId: contact.id,
              trackingId,
              stepNumber,
              metadata: { error: result.error },
            });

            // Only mark contact as bounced for real delivery failures
            try {
              await storage.updateContact(contact.id, { status: 'bounced' });
              console.log(`[CampaignEngine] Contact ${contact.email} (${contact.id}) marked as bounced`);
            } catch (e) {
              console.error(`[CampaignEngine] Failed to mark contact ${contact.email} (${contact.id}) as bounced:`, e);
            }

            // BOUNCE-SURGE DETECTION: if provider is mass-rejecting, pause and alert
            if (!surgeTriggered) {
              const windowBounces = sendWindow.filter(x => x === 'bounced').length;
              const windowRate = sendWindow.length > 0 ? windowBounces / sendWindow.length : 0;
              const tripByRate = sendWindow.length >= SURGE_WINDOW && windowBounces >= SURGE_MIN_BOUNCES && windowRate >= SURGE_BOUNCE_THRESHOLD;
              const tripByStreak = consecutiveBounces >= SURGE_CONSECUTIVE;
              if (tripByRate || tripByStreak) {
                surgeTriggered = true;
                const reason = tripByStreak
                  ? `${consecutiveBounces} consecutive bounces on sender ${emailAccount.email}`
                  : `${windowBounces}/${sendWindow.length} bounces (${Math.round(windowRate * 100)}%) on sender ${emailAccount.email}`;
                console.error(`[CampaignEngine] *** BOUNCE SURGE *** Campaign ${campaignId}: ${reason}. Auto-pausing. Last error: ${result.error?.slice(0, 200)}`);
                try {
                  // Flush current counts first
                  const flushCampaign = await storage.getCampaign(campaignId);
                  if (flushCampaign) {
                    await storage.updateCampaign(campaignId, {
                      status: 'paused',
                      autoPaused: true,
                      sentCount: (flushCampaign.sentCount || 0) + localSentCount,
                      bouncedCount: (flushCampaign.bouncedCount || 0) + localBouncedCount,
                    });
                  }
                  // Record surge as a tracking event for UI surfacing
                  try {
                    await storage.createTrackingEvent({
                      type: 'bounce_surge' as any,
                      campaignId,
                      messageId: messageRecord.id,
                      contactId: contact.id,
                      trackingId,
                      stepNumber,
                      metadata: {
                        reason,
                        senderEmail: emailAccount.email,
                        consecutiveBounces,
                        windowBounces,
                        windowSize: sendWindow.length,
                        lastError: (result.error || '').slice(0, 500),
                      },
                    });
                  } catch (e) { /* non-fatal */ }
                  if (localSentCount > 0) {
                    await storage.incrementDailySent(emailAccount.id, localSentCount);
                  }
                } catch (e) {
                  console.error('[CampaignEngine] Failed to record bounce surge:', e);
                }
                this.activeCampaigns.delete(campaignId);
                return; // Stop sending this batch
              }
            }
          }
        }
        
        // Periodically flush campaign stats to DB (every FLUSH_INTERVAL emails)
        if ((i + 1) % FLUSH_INTERVAL === 0 || i === contacts.length - 1) {
          const updatedCampaign = await storage.getCampaign(campaignId);
          if (updatedCampaign) {
            await storage.updateCampaign(campaignId, {
              sentCount: (updatedCampaign.sentCount || 0) + localSentCount,
              bouncedCount: (updatedCampaign.bouncedCount || 0) + localBouncedCount,
            });
          }
          // Update daily sent count on email account
          if (localSentCount > 0) {
            await storage.incrementDailySent(emailAccount.id, localSentCount);
            accountDailySent += localSentCount;
          }
          localSentCount = 0;
          localBouncedCount = 0;
        }
      } catch (emailError) {
        // Log the error but continue to next email — don't crash the entire campaign loop
        console.error(`[CampaignEngine] Error sending email ${i + 1}/${contacts.length} to ${contact.email}:`, emailError);
      }

      // Update progress
      if (tracker) {
        tracker.progress = i + 1;
      }

      // Throttle between emails using the configured delay + random jitter (±30s) for human-like timing
      if (i < contacts.length - 1) {
        const jitter = Math.floor(Math.random() * 60000) - 30000; // -30s to +30s
        const jitteredDelay = Math.max(1000, delay + jitter); // minimum 1s
        if (i === 0) {
          console.log(`[CampaignEngine] Campaign ${campaignId}: First email sent. Waiting ${jitteredDelay}ms (${(jitteredDelay / 1000).toFixed(0)}s, base=${delay}ms, jitter=${jitter > 0 ? '+' : ''}${(jitter / 1000).toFixed(0)}s) before next email.`);
        } else if (i % 25 === 0) {
          console.log(`[CampaignEngine] Campaign ${campaignId}: Progress ${i + 1}/${contacts.length}. Delay=${jitteredDelay}ms (base=${delay}ms ± jitter).`);
        }
        await new Promise(resolve => setTimeout(resolve, jitteredDelay));
      }
    }

    // Campaign completed — final flush of any remaining counts
    if (localSentCount > 0 || localBouncedCount > 0) {
      try {
        const flushCampaign = await storage.getCampaign(campaignId);
        if (flushCampaign) {
          await storage.updateCampaign(campaignId, {
            sentCount: (flushCampaign.sentCount || 0) + localSentCount,
            bouncedCount: (flushCampaign.bouncedCount || 0) + localBouncedCount,
          });
        }
        if (localSentCount > 0) {
          await storage.incrementDailySent(emailAccount.id, localSentCount);
        }
        console.log(`[CampaignEngine] Final flush: +${localSentCount} sent, +${localBouncedCount} bounced for campaign ${campaignId}`);
        localSentCount = 0;
        localBouncedCount = 0;
      } catch (e) {
        console.error(`[CampaignEngine] Final flush error for campaign ${campaignId}:`, e);
      }
    }

    const finalCampaign = await storage.getCampaign(campaignId);
    if (finalCampaign && finalCampaign.status === 'active') {
      // Check if this campaign has active follow-up steps pending
      // If so, mark as 'following_up' instead of 'completed' so follow-ups can proceed
      const hasFollowups = await storage.hasActiveFollowupSteps(campaignId);
      if (hasFollowups) {
        await storage.updateCampaign(campaignId, { status: 'following_up' });
        console.log(`[CampaignEngine] Campaign ${campaignId} Step 1 complete. Follow-up steps pending — status set to 'following_up'`);
      } else {
        await storage.updateCampaign(campaignId, { status: 'completed' });
        console.log(`[CampaignEngine] Campaign ${campaignId} completed (no follow-up steps)`);
      }
    }
    this.activeCampaigns.delete(campaignId);
  }

  /**
   * Add open tracking pixel to HTML (with absolute URL)
   * Uses cache-busting parameter to prevent email proxy caching
   */
  private addTrackingPixel(html: string, trackingId: string, baseUrl: string): string {
    const cacheBuster = Date.now();
    const pixel = `<img src="${baseUrl}/api/track/open/${trackingId}?cb=${cacheBuster}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
    // Insert before closing body tag, or append
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
  }

  /**
   * Replace links with tracked URLs (with absolute URL)
   */
  private addClickTracking(html: string, trackingId: string, baseUrl: string): string {
    return html.replace(
      /href="(https?:\/\/[^"]+)"/gi,
      (match, url) => {
        // Don't track unsubscribe links (they're already tracked)
        if (url.includes('/api/track/')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
      }
    );
  }

  /**
   * Pause a campaign
   */
  pauseCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      tracker.paused = true;
      storage.updateCampaign(campaignId, { status: 'paused', autoPaused: false });
      return true;
    }
    return false;
  }

  /**
   * Resume a paused campaign
   */
  resumeCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      tracker.paused = false;
      storage.updateCampaign(campaignId, { status: 'active' });
      return true;
    }
    return false;
  }

  /**
   * Stop/cancel a campaign
   */
  stopCampaign(campaignId: string): boolean {
    const tracker = this.activeCampaigns.get(campaignId);
    if (tracker) {
      this.activeCampaigns.delete(campaignId);
      storage.updateCampaign(campaignId, { status: 'paused', autoPaused: false });
      return true;
    }
    return false;
  }

  /**
   * Get campaign sending progress
   */
  getCampaignProgress(campaignId: string): { active: boolean; paused: boolean; progress: number; total: number } | null {
    const tracker = this.activeCampaigns.get(campaignId);
    if (!tracker) return null;
    return {
      active: true,
      paused: tracker.paused,
      progress: tracker.progress,
      total: tracker.total,
    };
  }

  /**
   * Schedule a campaign to start at a specific time
   */
  scheduleCampaign(campaignId: string, startTime: Date, options?: Partial<CampaignSendOptions>): void {
    const delay = startTime.getTime() - Date.now();
    if (delay <= 0) {
      this.startCampaign({ campaignId, ...options });
      return;
    }

    storage.updateCampaign(campaignId, { 
      status: 'scheduled',
      scheduledAt: startTime.toISOString(),
    });

    setTimeout(() => {
      this.startCampaign({ campaignId, ...options });
    }, delay);
  }

  /**
   * Resume all active campaigns after server restart.
   * Finds campaigns with status 'active' in DB and re-starts the send loop.
   * The startCampaign method already skips contacts that were already sent to.
   */
  async resumeActiveCampaigns(): Promise<void> {
    try {
      let resumedActive = 0;
      let resumedAutoPaused = 0;

      // 1) Resume campaigns left in 'active' status (standard path — covers normal restart)
      const activeRows = await storage.rawAll(
        `SELECT id, name, "organizationId", "sendingConfig" FROM campaigns WHERE status = 'active'`
      );
      for (const row of activeRows as any[]) {
        if (this.activeCampaigns.has(row.id)) continue;
        const sendingConfig = typeof row.sendingConfig === 'string'
          ? (() => { try { return JSON.parse(row.sendingConfig); } catch { return null; } })()
          : row.sendingConfig;
        console.log(`[CampaignEngine] Auto-resuming active campaign "${row.name}" (${row.id})`);
        try {
          const result = await this.startCampaign({ campaignId: row.id, sendingConfig: sendingConfig || undefined });
          if (result.success) { resumedActive++; }
          else { console.warn(`[CampaignEngine] Failed to resume active campaign ${row.id}: ${result.error}`); }
        } catch (e) {
          console.error(`[CampaignEngine] Error resuming active campaign ${row.id}:`, e);
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      // 2) Resume auto-paused campaigns (window-wait / daily-limit strandings after restart).
      //    SQL filter pushes all guards to the DB so we never load user-paused rows.
      //    Excludes completed/archived (safety rail). Autopilot must be enabled (JSONB->>'enabled' = 'true').
      //    Window-open check is NOT applied here — startCampaign's own sleep loop handles closed windows correctly.
      const autoPausedRows = await storage.rawAll(
        `SELECT id, name, "organizationId", "sendingConfig"
         FROM campaigns
         WHERE status = 'paused'
           AND "autoPaused" = true
           AND "sendingConfig" IS NOT NULL
           AND "sendingConfig"->'autopilot'->>'enabled' = 'true'`
      );
      for (const row of autoPausedRows as any[]) {
        if (this.activeCampaigns.has(row.id)) continue;
        const sendingConfig = typeof row.sendingConfig === 'string'
          ? (() => { try { return JSON.parse(row.sendingConfig); } catch { return null; } })()
          : row.sendingConfig;
        console.log(`[CampaignEngine] Auto-resuming stranded (auto-paused) campaign "${row.name}" (${row.id})`);
        try {
          const result = await this.startCampaign({ campaignId: row.id, sendingConfig: sendingConfig || undefined });
          if (result.success) { resumedAutoPaused++; }
          else { console.warn(`[CampaignEngine] Failed to resume auto-paused campaign ${row.id}: ${result.error}`); }
        } catch (e) {
          console.error(`[CampaignEngine] Error resuming auto-paused campaign ${row.id}:`, e);
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      console.log(`[CampaignEngine] Boot resume: ${resumedActive} active + ${resumedAutoPaused} auto-paused campaign(s) adopted`);
    } catch (error) {
      console.error('[CampaignEngine] Error resuming campaigns on boot:', error);
    }
  }
}

// Singleton
export const campaignEngine = new CampaignEngine();
