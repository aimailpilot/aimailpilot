import { storage } from '../storage';

const REAUTH_THRESHOLD = 3;

function isInvalidGrantError(err: any): string | null {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : (err.message || err.error_description || '');
  const lower = msg.toLowerCase();
  if (lower.includes('invalid_grant')) return 'invalid_grant';
  if (lower.includes('aadsts50173')) return 'AADSTS50173';
  if (lower.includes('aadsts70000')) return 'AADSTS70000';
  if (lower.includes('aadsts700082')) return 'AADSTS700082';
  if (err?.response?.data?.error === 'invalid_grant') return 'invalid_grant';
  if (err?.cause?.message === 'invalid_grant') return 'invalid_grant';
  return null;
}

export async function recordAuthFailure(orgId: string, email: string, rawError: any): Promise<void> {
  try {
    const code = isInvalidGrantError(rawError);
    if (!code) return;
    const now = new Date().toISOString();
    await storage.rawRun(
      `UPDATE email_accounts
         SET "authFailureCount" = COALESCE("authFailureCount", 0) + 1,
             "authLastFailureAt" = ?,
             "authLastErrorCode" = ?,
             "authStatus" = CASE
                WHEN COALESCE("authFailureCount", 0) + 1 >= ? THEN 'reauth_required'
                ELSE COALESCE("authStatus", 'active')
              END
       WHERE "organizationId" = ? AND LOWER(email) = LOWER(?)`,
      now, code, REAUTH_THRESHOLD, orgId, email
    );
  } catch {}
}

export async function recordAuthSuccess(orgId: string, email: string): Promise<void> {
  try {
    await storage.rawRun(
      `UPDATE email_accounts
         SET "authStatus" = 'active',
             "authFailureCount" = 0,
             "authLastErrorCode" = NULL
       WHERE "organizationId" = ? AND LOWER(email) = LOWER(?)
         AND ("authStatus" = 'reauth_required' OR COALESCE("authFailureCount", 0) > 0)`,
      orgId, email
    );
  } catch {}
}
