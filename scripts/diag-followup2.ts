import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cid = 'c8127168-ad7c-4a91-a6b2-245532e71da1';

  const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='campaign_followups' ORDER BY ordinal_position`);
  console.log('campaign_followups columns:', cols.rows.map(r => r.column_name).join(', '));

  const ecols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='followup_executions' ORDER BY ordinal_position`);
  console.log('\nfollowup_executions columns:', ecols.rows.map(r => r.column_name).join(', '));

  const stuck = await db.query(`SELECT id, "contactId", "recipientEmail", "stepNumber", status, "sentAt", "updatedAt" FROM messages WHERE "campaignId"=$1 AND status='sending'`, [cid]);
  console.log('\n=== stuck sending messages ===');
  for (const s of stuck.rows) console.log(JSON.stringify(s));

  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
