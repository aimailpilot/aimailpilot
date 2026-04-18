#!/usr/bin/env npx tsx
/**
 * Read-only diagnostic: trace reply-skip failure for a specific contact.
 *
 * Dumps messages, followup_executions, and unified_inbox rows for the given
 * email in the last N hours. Used to diagnose cases where follow-ups sent
 * despite a reply being received.
 *
 * Usage:
 *   $env:DATABASE_URL='...'
 *   npx tsx scripts/diag-reply-skip.ts <email> [hours]
 *
 * Example:
 *   npx tsx scripts/diag-reply-skip.ts priyang.b@aegis.edu.in 3
 */
import pg from 'pg';
const { Client } = pg;

const email = process.argv[2];
const hours = parseInt(process.argv[3] || '3', 10);

if (!email) {
  console.error('Usage: npx tsx scripts/diag-reply-skip.ts <email> [hours]');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL env var not set');
  process.exit(1);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  console.log(`\n=== Diagnostic for ${email} (last ${hours}h) ===\n`);

  // 1. Contact record — exact match, then fuzzy if not found
  let contact = await db.query(
    `SELECT id, email, "firstName", "lastName", status, "organizationId", "updatedAt"
     FROM contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 10`,
    [email]
  );

  if (contact.rowCount === 0) {
    console.log(`Exact match failed. Trying fuzzy LIKE match...`);
    contact = await db.query(
      `SELECT id, email, "firstName", "lastName", status, "organizationId", "updatedAt"
       FROM contacts WHERE LOWER(email) LIKE LOWER($1) LIMIT 10`,
      [`%${email.split('@')[0]}%`]
    );
  }

  console.log(`--- Contact(s) (${contact.rowCount}) ---`);
  console.table(contact.rows);

  if (contact.rowCount === 0) {
    // Last resort: find by recent unified_inbox from/to this email
    console.log(`No contact found. Searching unified_inbox for recent activity...`);
    const ib = await db.query(
      `SELECT DISTINCT "contactId", "fromEmail", "toEmail", "receivedAt"
       FROM unified_inbox
       WHERE (LOWER("fromEmail") LIKE LOWER($1) OR LOWER("toEmail") LIKE LOWER($1))
         AND "receivedAt" > NOW() - INTERVAL '6 hours'
       ORDER BY "receivedAt" DESC LIMIT 20`,
      [`%${email.split('@')[0]}%`]
    );
    console.log(`--- Recent inbox activity ---`);
    console.table(ib.rows);
    await db.end();
    return;
  }

  const contactIds = contact.rows.map(r => r.id);

  // 2. Messages (step 0 and follow-ups)
  const msgs = await db.query(
    `SELECT id, "campaignId", "contactId", "stepNumber", status,
            "sentAt", "repliedAt", "bouncedAt",
            LEFT(subject, 60) as subject,
            "providerMessageId" IS NOT NULL as has_provider_id,
            "gmailThreadId" IS NOT NULL as has_thread_id
     FROM messages
     WHERE "contactId" = ANY($1::text[])
       AND "sentAt"::timestamptz > NOW() - ($2 || ' hours')::interval
     ORDER BY "sentAt" DESC`,
    [contactIds, String(hours)]
  );
  console.log(`\n--- Messages (${msgs.rowCount}) ---`);
  console.table(msgs.rows);

  // 3. Follow-up executions
  const execs = await db.query(
    `SELECT fe.id, fe."campaignId", fe."campaignMessageId", fe."stepId", fe."contactId", fe.status,
            fe."scheduledAt", fe."executedAt", fe."createdAt"
     FROM followup_executions fe
     WHERE fe."contactId" = ANY($1::text[])
       AND (fe."scheduledAt"::timestamptz > NOW() - ($2 || ' hours')::interval
            OR fe."executedAt"::timestamptz > NOW() - ($2 || ' hours')::interval
            OR fe."createdAt"::timestamptz > NOW() - ($2 || ' hours')::interval)
     ORDER BY COALESCE(fe."executedAt", fe."scheduledAt", fe."createdAt") DESC`,
    [contactIds, String(hours)]
  );
  console.log(`\n--- Followup Executions (${execs.rowCount}) ---`);
  console.table(execs.rows);

  // 4. Unified inbox (replies received)
  const inbox = await db.query(
    `SELECT id, "campaignId", "contactId", "fromEmail", "toEmail",
            status, "replyType", "receivedAt",
            LEFT(subject, 60) as subject
     FROM unified_inbox
     WHERE (LOWER("fromEmail") = LOWER($1) OR "contactId" = ANY($2::text[]))
       AND "receivedAt"::timestamptz > NOW() - ($3 || ' hours')::interval
     ORDER BY "receivedAt" DESC`,
    [email, contactIds, String(hours)]
  );
  console.log(`\n--- Unified Inbox (${inbox.rowCount}) ---`);
  console.table(inbox.rows);

  // 5. Tracking events (replies)
  const events = await db.query(
    `SELECT type, "campaignId", "messageId", "contactId", "stepNumber", "createdAt"
     FROM tracking_events
     WHERE "contactId" = ANY($1::text[])
       AND type IN ('reply','bounce','sent')
       AND "createdAt"::timestamptz > NOW() - ($2 || ' hours')::interval
     ORDER BY "createdAt" DESC`,
    [contactIds, String(hours)]
  );
  console.log(`\n--- Tracking Events (${events.rowCount}) ---`);
  console.table(events.rows);

  // 6. Campaign followup step definitions (to see trigger types)
  if (msgs.rowCount > 0) {
    const campaignIds = [...new Set(msgs.rows.map(r => r.campaignId))];
    const steps = await db.query(
      `SELECT cf."campaignId", cf."stepNumber", cf.trigger, cf.delay, cf."delayUnit"
       FROM campaign_followups cf
       WHERE cf."campaignId" = ANY($1::text[])
       ORDER BY cf."campaignId", cf."stepNumber"`,
      [campaignIds]
    );
    console.log(`\n--- Campaign Followup Steps (${steps.rowCount}) ---`);
    console.table(steps.rows);
  }

  console.log('\n=== End ===\n');
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
