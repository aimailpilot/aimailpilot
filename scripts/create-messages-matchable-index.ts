#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log('Creating index (non-blocking)...');
  const t0 = Date.now();
  await db.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_matchable
    ON messages ("sentAt" DESC, "campaignId")
    WHERE "providerMessageId" IS NOT NULL
      AND status IN ('sent','failed','sending','bounced')
  `);
  console.log(`Index created in ${Date.now() - t0}ms`);
  const r = await db.query(`SELECT pg_size_pretty(pg_relation_size('idx_messages_matchable')) as size`);
  console.log(`Index size: ${r.rows[0].size}`);
  await db.end();
})();
