// Periodic cleanup: finds Gmail/Outlook messages that carry the warmup label/folder
// but still live in INBOX, and moves them out. Addresses backlog created when warmup
// engagement missed messages (read before engage ran, older than 1d window, engine downtime).
// Only touches messages already tagged by warmup-engine — never user mail.

import { storage } from '../storage';

const WARMUP_LABEL_NAME = 'AImailPilot-Warmup';

async function getAccessTokenForGmailAccount(acctId: string): Promise<string | null> {
  const row: any = await storage.rawGet(
    `SELECT "accessToken", "refreshToken", "tokenExpiry" FROM email_accounts WHERE id = ?`,
    acctId
  );
  if (!row?.accessToken) return null;
  const exp = parseInt(row.tokenExpiry || '0');
  if (exp && exp > Date.now() + 60_000) return row.accessToken;
  // Token expired — skip this cycle. Live sends will refresh via their own path.
  return null;
}

async function getAccessTokenForOutlookAccount(acctId: string): Promise<string | null> {
  const row: any = await storage.rawGet(
    `SELECT "accessToken", "tokenExpiry" FROM email_accounts WHERE id = ?`,
    acctId
  );
  if (!row?.accessToken) return null;
  const exp = parseInt(row.tokenExpiry || '0');
  if (exp && exp > Date.now() + 60_000) return row.accessToken;
  return null;
}

async function gmailFindWarmupLabelId(token: string): Promise<string | null> {
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const found = (data.labels || []).find((l: any) => l.name === WARMUP_LABEL_NAME);
  return found?.id || null;
}

async function gmailCleanupAccount(token: string): Promise<number> {
  const labelId = await gmailFindWarmupLabelId(token);
  if (!labelId) return 0;
  // Find messages carrying BOTH the warmup label AND INBOX
  const q = encodeURIComponent(`label:${WARMUP_LABEL_NAME} in:inbox`);
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return 0;
  const data: any = await resp.json();
  const msgs: any[] = data.messages || [];
  let cleaned = 0;
  for (const m of msgs) {
    const mod = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    );
    if (mod.ok) cleaned++;
  }
  return cleaned;
}

async function outlookFindWarmupFolderId(token: string): Promise<string | null> {
  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders?$filter=displayName eq '${WARMUP_LABEL_NAME}'`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data: any = await resp.json();
  return data.value?.[0]?.id || null;
}

async function outlookCleanupAccount(token: string): Promise<number> {
  const folderId = await outlookFindWarmupFolderId(token);
  if (!folderId) return 0;
  // Outlook's "move to folder" is destructive (removes from Inbox automatically),
  // so backlog here means some messages never got moved. Find Inbox messages whose
  // Subject/From match the warmup pattern isn't reliable — instead, rely on the
  // fact that warmup-engine stamps the body/subject via template. Skip Outlook
  // backlog cleanup — the live patch in warmup-engine will catch new ones.
  // (Outlook moves are atomic; Gmail is the one with the label-not-remove gap.)
  return 0;
}

export async function cleanupWarmupInboxOnce(): Promise<{ accounts: number; cleaned: number }> {
  // All connected email accounts that also have a warmup_accounts row
  const accounts: any[] = await storage.rawAll(`
    SELECT ea.id, ea.email, ea.provider
    FROM email_accounts ea
    JOIN warmup_accounts wa ON wa."emailAccountId" = ea.id
    WHERE ea."accessToken" IS NOT NULL
  `) as any[];

  let totalCleaned = 0;
  for (const acct of accounts) {
    try {
      if (acct.provider === 'gmail') {
        const token = await getAccessTokenForGmailAccount(acct.id);
        if (!token) continue;
        const n = await gmailCleanupAccount(token);
        if (n > 0) {
          totalCleaned += n;
          console.log(`[WarmupCleanup] gmail ${acct.email}: removed INBOX from ${n} warmup messages`);
        }
      } else if (acct.provider === 'outlook' || acct.provider === 'microsoft') {
        const token = await getAccessTokenForOutlookAccount(acct.id);
        if (!token) continue;
        const n = await outlookCleanupAccount(token);
        totalCleaned += n;
      }
    } catch (e) {
      console.error(`[WarmupCleanup] ${acct.email} error:`, e instanceof Error ? e.message : e);
    }
  }
  return { accounts: accounts.length, cleaned: totalCleaned };
}

export function startWarmupInboxCleanup() {
  const INTERVAL_MS = 2 * 60 * 60 * 1000; // every 2 hours
  const run = async () => {
    try {
      const { accounts, cleaned } = await cleanupWarmupInboxOnce();
      if (cleaned > 0) console.log(`[WarmupCleanup] scanned ${accounts} accounts, cleaned ${cleaned} inbox entries`);
    } catch (e) {
      console.error('[WarmupCleanup] Error:', e);
    }
  };
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, INTERVAL_MS);
  console.log('[WarmupCleanup] Scheduled: first run in 5min, then every 2h');
}
