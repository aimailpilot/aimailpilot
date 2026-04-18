// Purge warmup-only emails from unified_inbox older than 5 days.
// Warmup = both sender AND recipient are org-connected mailboxes
// (email_accounts ∪ warmup_accounts). Real contact replies are never touched.

import { storage } from '../storage';

const RETENTION_DAYS = 5;

export async function purgeOldWarmupInboxOnce(): Promise<{ deleted: number }> {
  const sql = `
    DELETE FROM unified_inbox
    WHERE id IN (
      SELECT ui.id
      FROM unified_inbox ui
      WHERE ui."receivedAt" < (NOW() - INTERVAL '${RETENTION_DAYS} days')::text
        AND (ui."replyType" IS NULL OR ui."replyType" NOT IN ('positive','negative','general'))
        AND LOWER(CASE WHEN ui."fromEmail" LIKE '%<%>%'
                       THEN substring(ui."fromEmail" from '<([^>]+)>')
                       ELSE ui."fromEmail" END) IN (
          SELECT LOWER(TRIM(email)) FROM email_accounts
            WHERE "organizationId" = ui."organizationId" AND email IS NOT NULL
          UNION
          SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
            JOIN email_accounts ea ON ea.id = wa."emailAccountId"
            WHERE wa."organizationId" = ui."organizationId" AND ea.email IS NOT NULL
        )
        AND LOWER(CASE WHEN ui."toEmail" LIKE '%<%>%'
                       THEN substring(ui."toEmail" from '<([^>]+)>')
                       ELSE COALESCE(ui."toEmail",'') END) IN (
          SELECT LOWER(TRIM(email)) FROM email_accounts
            WHERE "organizationId" = ui."organizationId" AND email IS NOT NULL
          UNION
          SELECT LOWER(TRIM(ea.email)) FROM warmup_accounts wa
            JOIN email_accounts ea ON ea.id = wa."emailAccountId"
            WHERE wa."organizationId" = ui."organizationId" AND ea.email IS NOT NULL
        )
    )
  `;
  const result: any = await storage.rawRun(sql);
  const deleted = typeof result === 'number' ? result : (result?.rowCount ?? 0);
  return { deleted };
}

export function startWarmupInboxPurge() {
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
  const run = async () => {
    try {
      const { deleted } = await purgeOldWarmupInboxOnce();
      if (deleted > 0) console.log(`[WarmupPurge] deleted=${deleted} warmup rows older than ${RETENTION_DAYS} days`);
    } catch (e) {
      console.error('[WarmupPurge] Error:', e);
    }
  };
  setTimeout(run, 10 * 60 * 1000);
  setInterval(run, INTERVAL_MS);
  console.log(`[WarmupPurge] Scheduled: first run in 10min, then every 6h (retention=${RETENTION_DAYS}d)`);
}
