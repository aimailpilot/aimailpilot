/**
 * Read-only diagnostic for the repeating PG-SLOW query observed in prod logs:
 *   SELECT * FROM messages WHERE "campaignId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS) against it to confirm whether the existing
 * idx_messages_campaign_created index is being used, and to see row/timing/buffers.
 *
 * Zero writes. Safe on prod.
 *
 * Usage:
 *   DATABASE_URL="..." tsx scripts/diag-campaign-detail-slow.ts <campaignId> [limit] [offset]
 */
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const campaignId = process.argv[2];
  const limit = parseInt(process.argv[3] || '200', 10);
  const offset = parseInt(process.argv[4] || '0', 10);

  if (!campaignId) {
    console.error('Usage: tsx scripts/diag-campaign-detail-slow.ts <campaignId> [limit=200] [offset=0]');
    process.exit(1);
  }

  console.log(`\n=== EXPLAIN ANALYZE: getCampaignMessages(${campaignId}, ${limit}, ${offset}) ===\n`);

  const sql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT * FROM messages
    WHERE "campaignId" = $1
    ORDER BY "createdAt" DESC
    LIMIT $2 OFFSET $3`;

  try {
    const r = await pool.query(sql, [campaignId, limit, offset]);
    console.log(r.rows.map(x => x['QUERY PLAN']).join('\n'));
  } catch (e: any) {
    console.error('EXPLAIN failed:', e.message);
  }

  console.log(`\n=== Row count for campaign ===`);
  try {
    const r = await pool.query(
      'SELECT COUNT(*) as total FROM messages WHERE "campaignId" = $1',
      [campaignId]
    );
    console.log(`Total messages: ${r.rows[0]?.total}`);
  } catch (e: any) {
    console.error('Count failed:', e.message);
  }

  console.log(`\n=== Indexes on messages table ===`);
  try {
    const r = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'messages'
      ORDER BY indexname
    `);
    for (const row of r.rows) {
      console.log(`  ${row.indexname}`);
      console.log(`    ${row.indexdef}`);
    }
  } catch (e: any) {
    console.error('pg_indexes query failed:', e.message);
  }

  console.log(`\n=== Table stats ===`);
  try {
    const r = await pool.query(`
      SELECT
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        last_analyze,
        last_autoanalyze,
        last_vacuum,
        last_autovacuum
      FROM pg_stat_user_tables
      WHERE relname = 'messages'
    `);
    console.log(r.rows[0] || 'no stats row');
  } catch (e: any) {
    console.error('stats query failed:', e.message);
  }

  await pool.end();
})();
