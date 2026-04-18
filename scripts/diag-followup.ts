#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;

const CAMPAIGN_NAME_LIKE = process.argv[2] || 'Campaign 10/04/2026';

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await db.connect();

  const camp = await db.query(
    `SELECT id, name, status, "sentCount", "totalRecipients", "organizationId", "emailAccountId", "updatedAt"
     FROM campaigns WHERE name ILIKE $1 ORDER BY "updatedAt" DESC LIMIT 5`,
    [`%${CAMPAIGN_NAME_LIKE}%`]
  );
  console.log(`\n=== campaigns matching "${CAMPAIGN_NAME_LIKE}" ===`);
  for (const c of camp.rows) {
    console.log(`${c.name}  id=${c.id}  status=${c.status}  sent=${c.sentCount}/${c.totalRecipients}`);
  }
  if (camp.rowCount === 0) { await db.end(); return; }

  const cid = camp.rows[0].id;
  console.log(`\nInspecting: ${cid}\n`);

  // messages by stepNumber
  const msgs = await db.query(
    `SELECT "stepNumber", status, COUNT(*)::int as n
     FROM messages WHERE "campaignId" = $1
     GROUP BY "stepNumber", status ORDER BY "stepNumber", status`,
    [cid]
  );
  console.log('--- messages by step/status ---');
  for (const m of msgs.rows) console.log(`  step=${m.stepNumber}  status=${m.status}  n=${m.n}`);

  // campaign_followups (sequences/steps)
  const fups = await db.query(
    `SELECT id, "stepNumber", "sequenceNumber", "delayDays", "delayHours", subject, status
     FROM campaign_followups WHERE "campaignId" = $1 ORDER BY "sequenceNumber", "stepNumber"`,
    [cid]
  );
  console.log('\n--- campaign_followups (defined steps) ---');
  for (const f of fups.rows) console.log(`  seq=${f.sequenceNumber} step=${f.stepNumber} delay=${f.delayDays}d${f.delayHours}h status=${f.status}  id=${f.id.slice(0,8)}`);

  // followup_executions — are they scheduled, pending, processed?
  const exec = await db.query(
    `SELECT status, COUNT(*)::int as n, MIN("scheduledFor"::timestamptz) as earliest, MAX("scheduledFor"::timestamptz) as latest
     FROM followup_executions WHERE "campaignId" = $1 GROUP BY status`,
    [cid]
  );
  console.log('\n--- followup_executions by status ---');
  for (const e of exec.rows) {
    const earliest = e.earliest ? new Date(e.earliest).toISOString() : '-';
    const latest = e.latest ? new Date(e.latest).toISOString() : '-';
    console.log(`  status=${e.status}  n=${e.n}  earliest=${earliest}  latest=${latest}`);
  }

  // pending overdue?
  const overdue = await db.query(
    `SELECT COUNT(*)::int as n FROM followup_executions
     WHERE "campaignId" = $1 AND status = 'pending' AND "scheduledFor"::timestamptz <= NOW()`,
    [cid]
  );
  console.log(`\n--- PENDING + OVERDUE followup_executions: ${overdue.rows[0].n} ---`);

  // sample a few pending rows
  const sample = await db.query(
    `SELECT id, "contactId", "stepNumber", "scheduledFor", status, "errorMessage"
     FROM followup_executions
     WHERE "campaignId" = $1 AND status IN ('pending','processing','failed')
     ORDER BY "scheduledFor" ASC LIMIT 10`,
    [cid]
  );
  console.log('\n--- sample followup_executions ---');
  for (const s of sample.rows) {
    console.log(`  id=${s.id.slice(0,8)}  step=${s.stepNumber}  sched=${s.scheduledFor}  status=${s.status}  err=${(s.errorMessage || '').slice(0,80)}`);
  }

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
