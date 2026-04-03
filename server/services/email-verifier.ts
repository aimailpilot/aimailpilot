/**
 * Email Verification Service — integrates with EmailListVerify API
 * API docs: https://api.emaillistverify.com
 * Base URL: https://api.emaillistverify.com
 * Auth: x-api-key header or ?secret= query param
 *
 * Stored as superadmin-level API key, shared across all orgs.
 */

import { storage } from '../storage';
import { execSync } from 'child_process';

export type VerificationStatus = 'unverified' | 'valid' | 'invalid' | 'risky' | 'disposable' | 'spamtrap';

interface VerifyResult {
  email: string;
  status: VerificationStatus;
  rawStatus: string;
}

const API_BASE = 'https://api.emaillistverify.com';

// Map EmailListVerify API responses to our simplified statuses
// Docs: ok, email_disabled, dead_server, invalid_mx, disposable, spamtrap, ok_for_all,
//       smtp_protocol, antispam_system, unknown, invalid_syntax
function mapApiStatus(apiStatus: string): VerificationStatus {
  const s = apiStatus.toLowerCase().trim();
  if (s === 'ok') return 'valid';
  if (s === 'email_disabled' || s === 'dead_server' || s === 'invalid_mx' || s === 'invalid_syntax') return 'invalid';
  if (s === 'disposable') return 'disposable';
  if (s === 'spamtrap') return 'spamtrap';
  if (s === 'ok_for_all' || s === 'unknown' || s === 'smtp_protocol' || s === 'antispam_system') return 'risky';
  // Legacy status names (backwards compat)
  if (s === 'valid') return 'valid';
  if (s === 'fail' || s === 'invalid' || s === 'error') return 'invalid';
  if (s === 'catch_all' || s === 'role' || s === 'accept_all') return 'risky';
  return 'risky';
}

/**
 * HTTP GET using curl — Azure Linux has curl pre-installed.
 * Matches the PHP sample from EmailListVerify docs.
 */
function httpGet(url: string, timeoutSec = 30): string {
  try {
    const result = execSync(
      `curl -s -L -k --max-time ${timeoutSec} "${url}"`,
      { encoding: 'utf-8', timeout: (timeoutSec + 5) * 1000 }
    );
    return result.trim();
  } catch (e: any) {
    throw new Error(`HTTP request failed: ${e.message?.substring(0, 100)}`);
  }
}

/**
 * Get the EmailListVerify API key from superadmin org settings
 */
export async function getEmailVerifyApiKey(orgId?: string): Promise<string | null> {
  try {
    // Try superadmin org first
    const superAdminOrgId = await storage.getSuperAdminOrgId();
    if (superAdminOrgId) {
      const settings = await storage.getApiSettings(superAdminOrgId);
      if (settings.emaillistverify_api_key) return settings.emaillistverify_api_key;
    }
    // Fallback: try the provided org
    if (orgId && orgId !== superAdminOrgId) {
      const settings = await storage.getApiSettings(orgId);
      if (settings.emaillistverify_api_key) return settings.emaillistverify_api_key;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify a single email address via EmailListVerify API
 */
export async function verifySingleEmail(email: string, apiKey: string): Promise<VerifyResult> {
  const url = `${API_BASE}/api/verifyEmail?secret=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=15`;
  const body = httpGet(url, 30);

  return {
    email,
    status: mapApiStatus(body),
    rawStatus: body,
  };
}

/**
 * Verify multiple emails with rate limiting (~1 per second)
 */
export async function verifyBatch(
  emails: { contactId: string; email: string }[],
  apiKey: string,
  onProgress?: (contactId: string, result: VerifyResult, index: number, total: number) => void
): Promise<Map<string, VerifyResult>> {
  const results = new Map<string, VerifyResult>();

  for (let i = 0; i < emails.length; i++) {
    const { contactId, email } = emails[i];
    try {
      const result = await verifySingleEmail(email, apiKey);
      results.set(contactId, result);
      onProgress?.(contactId, result, i + 1, emails.length);
    } catch (err: any) {
      const fallback: VerifyResult = { email, status: 'unverified', rawStatus: `error: ${err.message}` };
      results.set(contactId, fallback);
      onProgress?.(contactId, fallback, i + 1, emails.length);
    }

    // Rate limit: ~1 request per second (skip delay on last item)
    if (i < emails.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return results;
}

/**
 * Check remaining API credits (GET /api/credits)
 */
export async function checkCredits(apiKey: string): Promise<{ credits: number | null; valid: boolean; raw?: string }> {
  try {
    const url = `${API_BASE}/api/credits?secret=${encodeURIComponent(apiKey)}`;
    const body = httpGet(url, 10);

    console.log(`[EmailVerify] checkCredits body="${body.substring(0, 200)}"`);

    // Try JSON response first (new API format)
    try {
      const json = JSON.parse(body);
      // API may return { credits: N } or similar
      const c = json.credits ?? json.total ?? json.remaining;
      if (typeof c === 'number') return { credits: c, valid: true, raw: body };
    } catch { /* not JSON, try plain number */ }

    // Plain number response (legacy format)
    const credits = parseInt(body, 10);
    if (isNaN(credits)) {
      const hint = body.includes('<!DOCTYPE') ? 'API returned HTML — wrong URL or Cloudflare block' : body.substring(0, 150);
      return { credits: null, valid: false, raw: hint };
    }
    return { credits, valid: true, raw: body };
  } catch (e: any) {
    console.error(`[EmailVerify] checkCredits error:`, e.message);
    return { credits: null, valid: false, raw: e.message };
  }
}
