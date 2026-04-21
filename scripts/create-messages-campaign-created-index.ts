import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    console.log('Creating idx_messages_campaign_created CONCURRENTLY...');
    const t0 = Date.now();
    await client.query(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_campaign_created ON messages("campaignId", "createdAt" DESC)'
    );
    console.log(`Done in ${Date.now() - t0}ms`);

    const { rows } = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'messages' AND indexname = 'idx_messages_campaign_created'
    `);
    console.log(rows);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
