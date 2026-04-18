import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cid = 'c8127168-ad7c-4a91-a6b2-245532e71da1';

  const stuck = await db.query(`SELECT id, "contactId", "recipientEmail", "stepNumber", status, "sentAt", "createdAt" FROM messages WHERE "campaignId"=$1 AND status='sending'`, [cid]);
  console.log('=== stuck sending messages ===');
  for (const s of stuck.rows) console.log(JSON.stringify(s));

  // followup executions by status
  const exec = await db.query(`SELECT status, COUNT(*)::int as n FROM followup_executions WHERE "campaignId"=$1 GROUP BY status`, [cid]);
  console.log('\n=== followup_executions by status ===');
  for (const e of exec.rows) console.log(`  ${e.status}: ${e.n}`);

  // sample pending
  const pend = await db.query(`SELECT id, "contactId", "stepId", status, "scheduledAt", "executedAt", "createdAt" FROM followup_executions WHERE "campaignId"=$1 AND status IN ('pending','processing','failed') ORDER BY "scheduledAt" ASC LIMIT 10`, [cid]);
  console.log('\n=== sample pending/processing/failed executions ===');
  for (const p of pend.rows) console.log(JSON.stringify(p));

  // how many pending+overdue
  const overdue = await db.query(`SELECT COUNT(*)::int as n FROM followup_executions WHERE "campaignId"=$1 AND status='pending' AND "scheduledAt"::timestamptz <= NOW()`, [cid]);
  console.log(`\n=== pending + overdue: ${overdue.rows[0].n} ===`);

  // sequences/steps defined
  const seq = await db.query(`SELECT cf.id as fid, cf."sequenceId", cf."isActive", fs.id as "stepId", fs."stepNumber", fs."delayDays", fs."delayHours", fs.subject FROM campaign_followups cf LEFT JOIN followup_steps fs ON fs."sequenceId"=cf."sequenceId" WHERE cf."campaignId"=$1 ORDER BY fs."stepNumber"`, [cid]);
  console.log('\n=== followup steps defined ===');
  for (const s of seq.rows) console.log(JSON.stringify(s));

  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
