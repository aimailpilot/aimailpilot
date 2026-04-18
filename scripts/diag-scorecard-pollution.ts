#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;

const TARGET_EMAIL = process.argv[2] || 'tw@bellaward.com';

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  console.log(`\n=== Checking if "${TARGET_EMAIL}" is in email_accounts (any org) ===`);
  const ea = await db.query(
    `SELECT id, email, "organizationId", provider, status FROM email_accounts WHERE LOWER(email) = LOWER($1)`,
    [TARGET_EMAIL]
  );
  console.log(`email_accounts rows: ${ea.rowCount}`);
  for (const r of ea.rows) console.log(`  id=${r.id} org=${r.organizationId} provider=${r.provider} status=${r.status}`);

  console.log(`\n=== email_accounts TOTAL across all orgs ===`);
  const eaAll = await db.query(`SELECT COUNT(*)::int as n, COUNT(DISTINCT LOWER(email))::int as uniq FROM email_accounts`);
  console.log(`  rows=${eaAll.rows[0].n} uniq_emails=${eaAll.rows[0].uniq}`);

  console.log(`\n=== Sample email_accounts emails ===`);
  const sample = await db.query(`SELECT DISTINCT LOWER(email) as email FROM email_accounts ORDER BY email LIMIT 20`);
  for (const r of sample.rows) console.log(`  ${r.email}`);

  console.log(`\n=== unified_inbox entries FROM "${TARGET_EMAIL}" ===`);
  const ui = await db.query(
    `SELECT ui.id, ui."fromEmail", ui."organizationId", ui."emailAccountId", ui."replyType", ui."repliedAt", ui."sentByUs", ea.email as recipient_account, ea."userId"
     FROM unified_inbox ui LEFT JOIN email_accounts ea ON ea.id = ui."emailAccountId"
     WHERE LOWER(ui."fromEmail") = LOWER($1) LIMIT 10`,
    [TARGET_EMAIL]
  );
  console.log(`  rows: ${ui.rowCount}`);
  for (const r of ui.rows) {
    console.log(`  from=${r.fromEmail} → recipient_acct=${r.recipient_account} userId=${r.userId} replyType=${r.replyType} sentByUs=${r.sentByUs} repliedAt=${r.repliedAt}`);
  }

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
