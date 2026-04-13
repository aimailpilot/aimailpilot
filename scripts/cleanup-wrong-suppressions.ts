#!/usr/bin/env npx tsx
/**
 * Cleanup script: Remove wrongly-suppressed sender accounts and Exchange internal
 * routing IDs from the blocklist, and restore contacts that were wrongly marked
 * as bounced.
 *
 * Context: Before the bounce-tracker narrowing fix, the auto-suppression path in
 * outlook-reply-tracker.ts and gmail-reply-tracker.ts would extract EVERY email
 * from bounce NDR bodies (including quoted From: headers and Exchange envelope IDs)
 * and add them all to suppression_list. This caused sender accounts (your own
 * team members) to be blocklisted and excluded from campaigns.
 *
 * What this script touches:
 *   1. contacts.status — flips from 'bounced' back to 'active' for contacts whose
 *      email matches an email_accounts row.
 *   2. suppression_list — DELETES rows where:
 *      (a) email matches an email_accounts row (sender accounts), OR
 *      (b) email matches an Exchange internal routing ID pattern,
 *      AND source = 'auto-detected' (only undoing what the buggy auto-path created)
 *
 * What this script does NOT touch:
 *   - Contacts are never deleted. Only their status is changed.
 *   - No campaigns, messages, tracking events, or other tables touched.
 *   - No contact fields touched except 'status'.
 *   - suppression_list rows with source != 'auto-detected' are left alone.
 *
 * Usage:
 *   export DATABASE_URL="postgresql://..."
 *   npx tsx scripts/cleanup-wrong-suppressions.ts            # dry run (default)
 *   npx tsx scripts/cleanup-wrong-suppressions.ts --apply    # actually commit
 */

import pg from 'pg';

const { Client } = pg;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

// Exchange/Outlook internal message routing ID pattern — e.g.
//   ma0p287mb2519cbcb653c1fd41037b71dda242@ma0p287mb2519.indp287.prod.outlook.com
// These are NOT real mailboxes. They are message envelope IDs that leaked into
// suppression_list via the buggy regex extractor.
const EXCHANGE_INTERNAL_REGEX = '%\\.prod\\.outlook\\.com';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL env var is required');
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update database)'}`);
  console.log('');

  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  console.log('Connected to database\n');

  try {
    // ── 1. Discover: sender accounts wrongly in suppression_list ──────────────
    const senderSuppressions = await db.query<{
      id: string;
      organizationId: string;
      email: string;
      reason: string;
      source: string | null;
      createdAt: string;
    }>(
      `SELECT sl.id, sl."organizationId", sl.email, sl.reason, sl.source, sl."createdAt"
       FROM suppression_list sl
       INNER JOIN email_accounts ea ON lower(ea.email) = lower(sl.email)
       WHERE sl.source = 'auto-detected'
       ORDER BY sl.email, sl."organizationId"`,
    );

    console.log(`━━ 1. Sender accounts in suppression_list (source=auto-detected) ━━`);
    if (senderSuppressions.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.log(`  Found ${senderSuppressions.rows.length} row(s):`);
      for (const r of senderSuppressions.rows) {
        console.log(`    • ${r.email.padEnd(45)} org=${r.organizationId.slice(0, 8)}  reason=${r.reason}`);
      }
    }
    console.log('');

    // ── 2. Discover: Exchange internal routing IDs in suppression_list ────────
    const exchangeSuppressions = await db.query<{
      id: string;
      organizationId: string;
      email: string;
      source: string | null;
    }>(
      `SELECT id, "organizationId", email, source
       FROM suppression_list
       WHERE email LIKE $1
         AND source = 'auto-detected'
       ORDER BY email`,
      [EXCHANGE_INTERNAL_REGEX],
    );

    console.log(`━━ 2. Exchange internal routing IDs in suppression_list (source=auto-detected) ━━`);
    if (exchangeSuppressions.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.log(`  Found ${exchangeSuppressions.rows.length} row(s):`);
      for (const r of exchangeSuppressions.rows.slice(0, 20)) {
        console.log(`    • ${r.email.slice(0, 80)}`);
      }
      if (exchangeSuppressions.rows.length > 20) {
        console.log(`    ... and ${exchangeSuppressions.rows.length - 20} more`);
      }
    }
    console.log('');

    // ── 3. Discover: contacts wrongly marked as bounced (matching sender accounts) ──
    const bouncedSenders = await db.query<{
      id: string;
      organizationId: string;
      email: string;
      status: string;
    }>(
      `SELECT c.id, c."organizationId", c.email, c.status
       FROM contacts c
       INNER JOIN email_accounts ea ON lower(ea.email) = lower(c.email)
       WHERE c.status = 'bounced'
       ORDER BY c.email`,
    );

    console.log(`━━ 3. Contacts with status='bounced' matching a sender account ━━`);
    if (bouncedSenders.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.log(`  Found ${bouncedSenders.rows.length} contact(s):`);
      for (const r of bouncedSenders.rows) {
        console.log(`    • ${r.email.padEnd(45)} id=${r.id.slice(0, 8)}  org=${r.organizationId.slice(0, 8)}`);
      }
    }
    console.log('');

    // ── Apply or dry-run summary ──────────────────────────────────────────────
    const totalChanges =
      senderSuppressions.rows.length +
      exchangeSuppressions.rows.length +
      bouncedSenders.rows.length;

    if (totalChanges === 0) {
      console.log('Nothing to clean up. Exiting.');
      return;
    }

    if (DRY_RUN) {
      console.log('━━ DRY RUN SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  Would DELETE from suppression_list:  ${senderSuppressions.rows.length + exchangeSuppressions.rows.length}`);
      console.log(`    - sender accounts:                 ${senderSuppressions.rows.length}`);
      console.log(`    - Exchange internal IDs:           ${exchangeSuppressions.rows.length}`);
      console.log(`  Would UPDATE contacts.status:         ${bouncedSenders.rows.length}`);
      console.log(`    - bounced -> active`);
      console.log('');
      console.log('Re-run with --apply to commit these changes.');
      return;
    }

    // ── LIVE: apply changes inside a single transaction ───────────────────────
    console.log('━━ APPLYING CHANGES ━━━━━━━━━━━━━━━━━━━━━━━━━');
    await db.query('BEGIN');
    try {
      // 1. Delete sender-account rows from suppression_list
      let deletedSenders = 0;
      if (senderSuppressions.rows.length > 0) {
        const ids = senderSuppressions.rows.map(r => r.id);
        const result = await db.query(
          `DELETE FROM suppression_list WHERE id = ANY($1::text[])`,
          [ids],
        );
        deletedSenders = result.rowCount || 0;
        console.log(`  Deleted ${deletedSenders} sender-account row(s) from suppression_list`);
      }

      // 2. Delete Exchange internal ID rows from suppression_list
      let deletedExchange = 0;
      if (exchangeSuppressions.rows.length > 0) {
        const ids = exchangeSuppressions.rows.map(r => r.id);
        const result = await db.query(
          `DELETE FROM suppression_list WHERE id = ANY($1::text[])`,
          [ids],
        );
        deletedExchange = result.rowCount || 0;
        console.log(`  Deleted ${deletedExchange} Exchange routing ID row(s) from suppression_list`);
      }

      // 3. Flip bounced sender contacts back to active
      let restoredContacts = 0;
      if (bouncedSenders.rows.length > 0) {
        const ids = bouncedSenders.rows.map(r => r.id);
        const result = await db.query(
          `UPDATE contacts
             SET status = 'active',
                 "bouncedAt" = NULL,
                 "bounceType" = NULL,
                 "updatedAt" = $1
           WHERE id = ANY($2::text[])
             AND status = 'bounced'`,
          [new Date().toISOString(), ids],
        );
        restoredContacts = result.rowCount || 0;
        console.log(`  Restored ${restoredContacts} contact(s) from bounced -> active`);
      }

      await db.query('COMMIT');
      console.log('');
      console.log('━━ TOTALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  suppression_list deleted (sender):   ${deletedSenders}`);
      console.log(`  suppression_list deleted (Exchange): ${deletedExchange}`);
      console.log(`  contacts restored (bounced->active): ${restoredContacts}`);
      console.log('');
      console.log('Cleanup complete.');
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Transaction failed, rolled back:', err);
      throw err;
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
