#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await db.connect();

  const res = await db.query(`
    SELECT
      c.id,
      c.name,
      c.status,
      c."sentCount",
      c."totalRecipients",
      c."updatedAt" as campaign_updated,
      ea.email as account,
      ea."dailySent",
      ea."dailyLimit",
      (SELECT MAX("sentAt"::timestamptz) FROM messages WHERE "campaignId" = c.id AND status = 'sent') as last_send_at,
      (SELECT COUNT(*)::int FROM messages WHERE "campaignId" = c.id AND status = 'sent' AND "sentAt"::timestamptz > NOW() - INTERVAL '10 minutes') as sent_last_10min,
      (SELECT COUNT(*)::int FROM messages WHERE "campaignId" = c.id AND status = 'sent' AND "sentAt"::timestamptz > NOW() - INTERVAL '60 minutes') as sent_last_60min
    FROM campaigns c
    LEFT JOIN email_accounts ea ON ea.id = c."emailAccountId"
    WHERE c.status = 'active'
    ORDER BY last_send_at DESC NULLS LAST
  `);

  console.log(`\n=== ${res.rowCount} active campaigns ===\n`);
  for (const r of res.rows) {
    const last = r.last_send_at ? new Date(r.last_send_at).toISOString() : 'NEVER';
    const ago = r.last_send_at ? Math.round((Date.now() - new Date(r.last_send_at).getTime()) / 60000) : '∞';
    const flag = r.sent_last_10min > 0 ? '✅ SENDING' : (r.sent_last_60min > 0 ? '⚠️  SLOW' : '❌ STRANDED');
    console.log(`${flag}  ${r.name}`);
    console.log(`   id=${r.id.slice(0, 8)}  sent=${r.sentCount}/${r.totalRecipients}  last_send=${ago}min ago  last10m=${r.sent_last_10min}  last60m=${r.sent_last_60min}`);
    console.log(`   account=${r.account}  dailySent=${r.dailySent}/${r.dailyLimit}`);
    console.log('');
  }

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
