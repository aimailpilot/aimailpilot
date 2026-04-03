/**
 * Email Verification Service — integrates with EmailListVerify API
 * API docs: https://app.emaillistverify.com/api
 *
 * Stored as superadmin-level API key, shared across all orgs.
 */

import { storage } from '../storage';
import https from 'https';

export type VerificationStatus = 'unverified' | 'valid' | 'invalid' | 'risky' | 'disposable' | 'spamtrap';

interface VerifyResult {
  email: string;
  status: VerificationStatus;
  rawStatus: string;
}

// Map EmailListVerify API responses to our simplified statuses
function mapApiStatus(apiStatus: string): VerificationStatus {
  const s = apiStatus.toLowerCase().trim();
  if (s === 'ok' || s === 'valid') return 'valid';
  if (s === 'fail' || s === 'invalid' || s === 'error') return 'invalid';
  if (s === 'disposable') return 'disposable';
  if (s === 'spamtrap') return 'spamtrap';
  if (s === 'unknown' || s === 'catch_all' || s === 'role' || s === 'accept_all') return 'risky';
  return 'risky';
}

/** Simple HTTPS GET that works on all Node versions */
function httpsGet(url: string, timeoutMs = 30000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Get the EmailListVerify API key from superadmin org settings
 */
export async function getEmailVerifyApiKey(): Promise<string | null> {
  try {
    const superAdminOrgId = await storage.getSuperAdminOrgId();
    if (!superAdminOrgId) return null;
    const settings = await storage.getApiSettings(superAdminOrgId);
    return settings.emaillistverify_api_key || null;
  } catch {
    return null;
  }
}

/**
 * Verify a single email address via EmailListVerify API
 */
export async function verifySingleEmail(email: string, apiKey: string): Promise<VerifyResult> {
  const url = `https://app.emaillistverify.com/api/verifyEmail?secret=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
  const res = await httpsGet(url);

  if (res.status !== 200) {
    throw new Error(`EmailListVerify API error: ${res.status} ${res.body}`);
  }

  return {
    email,
    status: mapApiStatus(res.body),
    rawStatus: res.body.trim(),
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
 * Check remaining API credits
 */
export async function checkCredits(apiKey: string): Promise<{ credits: number | null; valid: boolean; raw?: string }> {
  try {
    const url = `https://app.emaillistverify.com/api/getCredits?secret=${encodeURIComponent(apiKey)}`;
    const res = await httpsGet(url, 10000);
    const body = res.body.trim();

    console.log(`[EmailVerify] checkCredits status=${res.status} body="${body}"`);

    if (res.status !== 200) return { credits: null, valid: false, raw: body };

    // API returns plain number on success, or error string on failure
    const credits = parseInt(body, 10);
    if (isNaN(credits)) {
      // Non-numeric response = error message from API (e.g. "Invalid API key")
      return { credits: null, valid: false, raw: body };
    }
    return { credits, valid: true, raw: body };
  } catch (e: any) {
    console.error(`[EmailVerify] checkCredits error:`, e.message);
    return { credits: null, valid: false, raw: e.message };
  }
}
