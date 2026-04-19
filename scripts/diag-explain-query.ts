import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const orgId = process.argv[2];
  if (!orgId) { console.error('Usage: tsx explain-query.ts <orgId>'); process.exit(1); }
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const sql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT
      m.id, m."campaignId", m."contactId", m."providerMessageId", m."gmailThreadId",
      m."trackingId", m."stepNumber", m.status, m."sentAt", m."repliedAt",
      m."recipientEmail", m."bouncedAt",
      ct.email as "contactEmail", c.name as "campaignName"
    FROM messages m
    INNER JOIN campaigns c ON m."campaignId" = c.id
    LEFT JOIN contacts ct ON m."contactId" = ct.id
    WHERE c."organizationId" = $1
    AND m.status IN ('sent', 'failed', 'sending', 'bounced')
    AND m."providerMessageId" IS NOT NULL
    AND m."sentAt" >= $2
    ORDER BY m."sentAt" DESC
    LIMIT 50000`;
  const r = await pool.query(sql, [orgId, cutoff]);
  console.log(r.rows.map(x => x['QUERY PLAN']).join('\n'));
  await pool.end();
})();
