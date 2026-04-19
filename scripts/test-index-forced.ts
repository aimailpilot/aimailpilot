#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log('Running ANALYZE messages...');
  await db.query('ANALYZE messages');
  console.log('Done. Testing with seqscan disabled...');
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await db.query('SET enable_seqscan = off');
  const r = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT m.id, m."campaignId", m."contactId", m."providerMessageId", m."gmailThreadId",
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
    LIMIT 50000`, ['86144c5d-b27b-4c20-88bc-7c8e933f3354', cutoff]);
  console.log(r.rows.map((x: any) => x['QUERY PLAN']).join('\n'));
  await db.end();
})();
