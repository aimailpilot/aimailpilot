import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cid = '9f9eba19-9edb-4884-af6e-aaa8578e0acb';

  const c = await db.query(`SELECT id, name, status, "sentCount", "totalRecipients" FROM campaigns WHERE id=$1`, [cid]);
  console.log('campaign:', JSON.stringify(c.rows[0]));

  const msgs = await db.query(`SELECT "stepNumber", status, COUNT(*)::int as n FROM messages WHERE "campaignId"=$1 GROUP BY "stepNumber", status ORDER BY "stepNumber", status`, [cid]);
  console.log('\nmessages by step/status:');
  for (const m of msgs.rows) console.log(`  step=${m.stepNumber}  status=${m.status}  n=${m.n}`);

  const exec = await db.query(`SELECT status, COUNT(*)::int as n FROM followup_executions WHERE "campaignId"=$1 GROUP BY status`, [cid]);
  console.log('\nfollowup_executions by status:');
  for (const e of exec.rows) console.log(`  ${e.status}: ${e.n}`);

  const seq = await db.query(`SELECT cf.id as fid, cf."sequenceId", cf."isActive", fs.id as "stepId", fs."stepNumber", fs."delayDays", fs."delayHours", fs.subject FROM campaign_followups cf LEFT JOIN followup_steps fs ON fs."sequenceId"=cf."sequenceId" WHERE cf."campaignId"=$1 ORDER BY fs."stepNumber"`, [cid]);
  console.log('\nfollowup steps defined:');
  for (const s of seq.rows) console.log(`  seq=${s.sequenceId?.slice(0,8)}  step=${s.stepNumber}  delay=${s.delayDays}d${s.delayHours}h  active=${s.isActive}  subject="${s.subject}"`);

  // pending+overdue?
  const overdue = await db.query(`SELECT COUNT(*)::int as n FROM followup_executions WHERE "campaignId"=$1 AND status='pending' AND "scheduledAt"::timestamptz <= NOW()`, [cid]);
  console.log(`\npending + overdue executions: ${overdue.rows[0].n}`);

  const pendFut = await db.query(`SELECT COUNT(*)::int as n, MIN("scheduledAt"::timestamptz) as next FROM followup_executions WHERE "campaignId"=$1 AND status='pending'`, [cid]);
  console.log(`pending future executions: ${pendFut.rows[0].n}  next=${pendFut.rows[0].next}`);

  // Step 2 specifically — how many Step 1 messages exist that should trigger Step 2?
  const step1sent = await db.query(`SELECT COUNT(*)::int as n FROM messages WHERE "campaignId"=$1 AND "stepNumber"=0 AND status='sent'`, [cid]);
  const step2sent = await db.query(`SELECT COUNT(*)::int as n FROM messages WHERE "campaignId"=$1 AND "stepNumber"=1 AND status='sent'`, [cid]);
  const step3sent = await db.query(`SELECT COUNT(*)::int as n FROM messages WHERE "campaignId"=$1 AND "stepNumber"=2 AND status='sent'`, [cid]);
  console.log(`\nStep0 sent: ${step1sent.rows[0].n}   Step1 sent: ${step2sent.rows[0].n}   Step2 sent: ${step3sent.rows[0].n}`);

  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
