/**
 * Email Verification Service — integrates with EmailListVerify API
 * API docs: https://app.emaillistverify.com/api
 *
 * Stored as superadmin-level API key, shared across all orgs.
 */

import { storage } from '../storage';

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
  // unknown, catch_all, role, accept_all — these are risky but not outright invalid
  if (s === 'unknown' || s === 'catch_all' || s === 'role' || s === 'accept_all') return 'risky';
  return 'risky'; // default for unrecognized statuses
}

/**
 * Get the EmailListVerify API key from superadmin org settings
 */
export async function getEmailVerifyApiKey(): Promise<string | null> {
  const superAdminOrgId = await storage.getSuperAdminOrgId();
  if (!superAdminOrgId) return null;
  const settings = await storage.getApiSettings(superAdminOrgId);
  return settings.emaillistverify_api_key || null;
}

/**
 * Verify a single email address via EmailListVerify API
 */
export async function verifySingleEmail(email: string, apiKey: string): Promise<VerifyResult> {
  const url = `https://app.emaillistverify.com/api/verifyEmail?secret=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;

  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`EmailListVerify API error: ${res.status} ${text}`);
  }

  return {
    email,
    status: mapApiStatus(text),
    rawStatus: text.trim(),
  };
}

/**
 * Verify multiple emails with rate limiting (~1 per second)
 * Returns results as they complete, calls onProgress for each
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
      // On API error, mark as unverified (don't fail the whole batch)
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
 * Check remaining API credits (if supported by the API)
 */
export async function checkCredits(apiKey: string): Promise<{ credits: number | null; valid: boolean }> {
  try {
    const url = `https://app.emaillistverify.com/api/getCredits?secret=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
    const text = await res.text();

    if (!res.ok) return { credits: null, valid: false };

    const credits = parseInt(text.trim(), 10);
    return { credits: isNaN(credits) ? null : credits, valid: true };
  } catch {
    return { credits: null, valid: false };
  }
}
