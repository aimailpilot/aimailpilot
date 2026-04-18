import pg from 'pg';
const { Client } = pg;
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const cid = '9f9eba19-9edb-4884-af6e-aaa8578e0acb';

  const r = await db.query(`SELECT "contactId", "stepNumber", status FROM messages WHERE "campaignId"=$1 AND "stepNumber" > 0 ORDER BY "contactId", "stepNumber" LIMIT 20`, [cid]);
  console.log('sample step>0 messages:');
  for (const m of r.rows) console.log(JSON.stringify(m));

  const d = await db.query(`SELECT "stepNumber", COUNT(*)::int as n FROM messages WHERE "campaignId"=$1 GROUP BY "stepNumber" ORDER BY "stepNumber"`, [cid]);
  console.log('\nstepNumber distribution:');
  for (const x of d.rows) console.log(`  stepNumber=${x.stepNumber}  n=${x.n}`);

  // executions with stepId → which sequence does each stepId belong to?
  const e = await db.query(`
    SELECT fe."stepId", fs."stepNumber" as fs_step, fs."sequenceId", COUNT(*)::int as n
    FROM followup_executions fe
    LEFT JOIN followup_steps fs ON fs.id = fe."stepId"
    WHERE fe."campaignId"=$1
    GROUP BY fe."stepId", fs."stepNumber", fs."sequenceId"
  `, [cid]);
  console.log('\nexecutions grouped by stepId:');
  for (const x of e.rows) console.log(`  stepId=${x.stepId?.slice(0,8)}  fs_stepNumber=${x.fs_step}  seq=${x.sequenceId?.slice(0,8)}  n=${x.n}`);

  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
