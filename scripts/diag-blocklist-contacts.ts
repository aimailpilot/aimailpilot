#!/usr/bin/env npx tsx
/**
 * Diagnostic: check actual DB state of contacts that still appear in the UI Blocklist tab.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://..."
 *   npx tsx scripts/diag-blocklist-contacts.ts
 */

import pg from 'pg';

const { Client } = pg;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL env var is required');
    process.exit(1);
  }

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  try {
    // Query 1: ALL contacts with status=bounced whose email matches an email_accounts row
    console.log('━━ 1. contacts.status=bounced matching any sender account ━━');
    const bouncedSenders = await db.query(`
      SELECT c.id, c.email, c.status, c."organizationId", c."bouncedAt", c."updatedAt"
      FROM contacts c
      INNER JOIN email_accounts ea ON lower(ea.email) = lower(c.email)
      WHERE c.status = 'bounced'
      ORDER BY c.email, c."organizationId"
    `);
    console.log(`  Found ${bouncedSenders.rowCount} row(s):`);
    for (const r of bouncedSenders.rows) {
      console.log(`    ${r.email.padEnd(40)} status=${r.status} org=${r.organizationId.slice(0,8)} bouncedAt=${r.bouncedAt || 'null'} updatedAt=${r.updatedAt}`);
    }
    console.log('');

    // Query 2: ALL contacts with status=bounced in the bellaward.com org (the one in the screenshot)
    console.log('━━ 2. contacts.status=bounced with email ending in bellaward.com or aegis.edu.in ━━');
    const orgBounced = await db.query(`
      SELECT c.id, c.email, c.status, c."organizationId", c."bouncedAt", c."updatedAt"
      FROM contacts c
      WHERE c.status = 'bounced'
        AND (c.email LIKE '%@bellaward.com' OR c.email LIKE '%@aegis.edu.in')
      ORDER BY c.email, c."organizationId"
    `);
    console.log(`  Found ${orgBounced.rowCount} row(s):`);
    for (const r of orgBounced.rows.slice(0, 30)) {
      console.log(`    ${r.email.padEnd(40)} org=${r.organizationId.slice(0,8)} bouncedAt=${r.bouncedAt || 'null'}`);
    }
    if (orgBounced.rowCount && orgBounced.rowCount > 30) console.log(`    ... and ${orgBounced.rowCount - 30} more`);
    console.log('');

    // Query 3: suppression_list rows for these same emails
    console.log('━━ 3. suppression_list rows for sender-matching emails (any source) ━━');
    const suppress = await db.query(`
      SELECT sl.id, sl.email, sl.reason, sl.source, sl."organizationId", sl."createdAt"
      FROM suppression_list sl
      INNER JOIN email_accounts ea ON lower(ea.email) = lower(sl.email)
      ORDER BY sl.email, sl."organizationId"
    `);
    console.log(`  Found ${suppress.rowCount} row(s):`);
    for (const r of suppress.rows) {
      console.log(`    ${r.email.padEnd(40)} reason=${r.reason} source=${r.source || 'null'} org=${r.organizationId.slice(0,8)}`);
    }
    console.log('');

    // Query 4: list of all sender account emails
    console.log('━━ 4. All email_accounts (sender accounts) in the org ━━');
    const senders = await db.query(`
      SELECT ea.email, ea."organizationId", ea.provider
      FROM email_accounts ea
      ORDER BY ea.email
    `);
    console.log(`  Found ${senders.rowCount} sender account(s):`);
    for (const r of senders.rows) {
      console.log(`    ${r.email.padEnd(40)} provider=${r.provider} org=${r.organizationId.slice(0,8)}`);
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
