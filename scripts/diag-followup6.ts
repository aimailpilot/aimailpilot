import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cid = '9f9eba19-9edb-4884-af6e-aaa8578e0acb';

  const r = await db.query(`
    SELECT MIN("sentAt"::timestamptz) as oldest, MAX("sentAt"::timestamptz) as newest, COUNT(*)::int as n
    FROM messages WHERE "campaignId"=$1 AND "stepNumber"=1 AND status='sent'
  `, [cid]);
  console.log('Step 1 sent messages:', JSON.stringify(r.rows[0]));

  const r0 = await db.query(`
    SELECT MIN("sentAt"::timestamptz) as oldest, MAX("sentAt"::timestamptz) as newest, COUNT(*)::int as n
    FROM messages WHERE "campaignId"=$1 AND "stepNumber"=0 AND status='sent'
  `, [cid]);
  console.log('Step 0 sent messages:', JSON.stringify(r0.rows[0]));

  // how many Step 1 messages were sent >= 2 days ago (so Step 2 should trigger)?
  const eligible = await db.query(`
    SELECT COUNT(*)::int as n FROM messages
    WHERE "campaignId"=$1 AND "stepNumber"=1 AND status='sent'
    AND "sentAt"::timestamptz < NOW() - INTERVAL '2 days'
  `, [cid]);
  console.log(`Step1 sent > 2 days ago (eligible for Step 2): ${eligible.rows[0].n}`);

  // Step 2 executions status breakdown
  const s2 = await db.query(`
    SELECT fe.status, COUNT(*)::int as n FROM followup_executions fe
    LEFT JOIN followup_steps fs ON fs.id = fe."stepId"
    WHERE fe."campaignId"=$1 AND fs."stepNumber"=2
    GROUP BY fe.status
  `, [cid]);
  console.log('\nStep 2 execution statuses:');
  for (const x of s2.rows) console.log(`  ${x.status}: ${x.n}`);

  // Now check — is getCampaignMessageByContactAndStep actually returning the stepNumber=1 row?
  // The concern: if the function looks up by a "stepNumber" derived from the CURRENT sequence (local numbering),
  // then step 2's "previous" lookup uses stepNumber=1, which might be the sequence A step 1 which has stepNumber=1 on the message... so it SHOULD find it.
  // Let me actually sample: pick a contact that had step 1 sent > 2 days ago and check if Step 2 execution exists
  const sample = await db.query(`
    SELECT m."contactId", m."sentAt" as step1_sent,
      (SELECT COUNT(*)::int FROM followup_executions fe
       LEFT JOIN followup_steps fs ON fs.id = fe."stepId"
       WHERE fe."campaignId"=$1 AND fe."contactId"=m."contactId" AND fs."stepNumber"=2) as step2_execs
    FROM messages m
    WHERE m."campaignId"=$1 AND m."stepNumber"=1 AND m.status='sent'
    AND m."sentAt"::timestamptz < NOW() - INTERVAL '2 days'
    LIMIT 10
  `, [cid]);
  console.log('\nsample: step1 sent > 2d ago, has step2 exec?');
  for (const s of sample.rows) console.log(`  contact=${s.contactId.slice(0,8)}  step1_sent=${s.step1_sent}  step2_execs=${s.step2_execs}`);

  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
