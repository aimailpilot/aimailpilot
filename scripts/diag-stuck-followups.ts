#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  console.log('\n=== Campaigns with deleted/missing email accounts ===');
  const res = await db.query(`
    SELECT
      c.name AS campaign,
      c."emailAccountId" AS missing_account_id,
      c.status AS campaign_status,
      COUNT(fe.id) AS stuck_executions
    FROM followup_executions fe
    JOIN campaigns c ON c.id = fe."campaignId"
    WHERE fe.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM email_accounts ea WHERE ea.id = c."emailAccountId"
      )
    GROUP BY c.name, c."emailAccountId", c.status
    ORDER BY stuck_executions DESC
  `);

  if (res.rows.length === 0) {
    console.log('No stuck executions found (account exists for all pending executions).');
  } else {
    for (const row of res.rows) {
      console.log(`Campaign: ${row.campaign}`);
      console.log(`  Missing account ID: ${row.missing_account_id}`);
      console.log(`  Campaign status:    ${row.campaign_status}`);
      console.log(`  Stuck executions:   ${row.stuck_executions}`);
      console.log('');
    }
    const total = res.rows.reduce((s: number, r: any) => s + parseInt(r.stuck_executions), 0);
    console.log(`Total stuck executions: ${total}`);
  }

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
