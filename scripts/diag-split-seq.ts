import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const r = await db.query(`
    SELECT cf."campaignId", c.name, c.status, COUNT(DISTINCT cf."sequenceId")::int as seq_count, COUNT(*)::int as row_count
    FROM campaign_followups cf
    JOIN campaigns c ON c.id = cf."campaignId"
    WHERE cf."isActive" = 1
    GROUP BY cf."campaignId", c.name, c.status
    HAVING COUNT(DISTINCT cf."sequenceId") > 1
    ORDER BY seq_count DESC
  `);
  console.log(`\n=== campaigns with >1 active sequence: ${r.rowCount} ===`);
  for (const row of r.rows) {
    console.log(`  ${row.name}  status=${row.status}  sequences=${row.seq_count}  id=${row.campaignId.slice(0,8)}`);
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
