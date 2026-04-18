#!/usr/bin/env npx tsx
/**
 * Read-only: answer the three diagnostic questions for the it@municampus.com
 * false-follow-up incident.
 *
 *   1. Timestamps of every message sent to that contact (Step 0 + F1 + F2)
 *   2. repliedAt value on each of those message rows
 *   3. Any unified_inbox row from that contact (the actual reply)
 *   4. Every followup_executions row for that contact
 *   5. Any tracking_events 'reply' event for that contact
 *
 * Usage:
 *   $env:DATABASE_URL='...'
 *   npx tsx scripts/diag-municampus.ts
 */
import pg from 'pg';
const { Client } = pg;

const EMAIL = 'it@municampus.com';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL env var not set');
  process.exit(1);
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  console.log(`\n=== Diagnostic for ${EMAIL} ===\n`);

  const contact = await db.query(
    `SELECT id, email, status, "organizationId", "updatedAt"
     FROM contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [EMAIL]
  );
  console.log(`--- Contact(s) (${contact.rowCount}) ---`);
  console.table(contact.rows);

  if (contact.rowCount === 0) {
    console.log('No contact. Exiting.');
    await db.end();
    return;
  }

  const contactIds = contact.rows.map(r => r.id);

  // Q1+Q2 combined: all messages, ordered by stepNumber, with repliedAt visible
  const msgs = await db.query(
    `SELECT id, "campaignId", "stepNumber", status,
            "sentAt", "repliedAt", "bouncedAt",
            LEFT(subject, 60) as subject,
            "providerMessageId",
            "gmailThreadId"
     FROM messages
     WHERE "contactId" = ANY($1::text[])
     ORDER BY "sentAt" ASC`,
    [contactIds]
  );
  console.log(`\n--- All messages for this contact (${msgs.rowCount}) ---`);
  console.table(msgs.rows);

  // Comparison: was any F1/F2 sent AFTER the reply was stamped?
  const analysis = await db.query(
    `SELECT
       m."stepNumber",
       m."sentAt"     AS follow_up_sent_at,
       m."repliedAt"  AS replied_at,
       (m."sentAt"::timestamptz > m."repliedAt"::timestamptz) AS sent_after_reply
     FROM messages m
     WHERE m."contactId" = ANY($1::text[])
       AND m."repliedAt" IS NOT NULL
     ORDER BY m."stepNumber"`,
    [contactIds]
  );
  console.log(`\n--- KEY COMPARISON: sent_after_reply column ---`);
  console.table(analysis.rows);
  console.log(`If sent_after_reply = true for any F1/F2 row, that is a proven wrong send.`);

  // Q3: unified_inbox — did the tracker see a reply at all?
  const inbox = await db.query(
    `SELECT id, "campaignId", "messageId", "contactId",
            "fromEmail", status, "replyType", "receivedAt",
            LEFT(subject, 60) as subject,
            "gmailMessageId", "gmailThreadId"
     FROM unified_inbox
     WHERE LOWER("fromEmail") = LOWER($1)
        OR "contactId" = ANY($2::text[])
     ORDER BY "receivedAt" ASC`,
    [EMAIL, contactIds]
  );
  console.log(`\n--- unified_inbox rows (${inbox.rowCount}) ---`);
  console.table(inbox.rows);

  // Q4: followup_executions — scoped to the 4 suspect campaigns only
  const suspectCampaigns = [
    '52fa54c1-bbb3-4528-a694-889b1e85edc2',
    '9466999e-977d-4634-a2a1-c1dea18854e1',
    'a2a89d9b-e0cd-420a-afd1-d59934d0f896',
    '5f3599c8-025d-49d3-a8d7-223f8269465d',
  ];
  const execs = await db.query(
    `SELECT id, "campaignId", "contactId", "stepId", "campaignMessageId", status,
            "scheduledAt", "executedAt", "createdAt"
     FROM followup_executions
     WHERE "contactId" = ANY($1::text[])
       AND "campaignId" = ANY($2::text[])
     ORDER BY "campaignId", COALESCE("executedAt", "scheduledAt", "createdAt") ASC`,
    [contactIds, suspectCampaigns]
  );
  console.log(`\n--- followup_executions (${execs.rowCount}) for suspect campaigns ---`);
  console.table(execs.rows);

  // HYPOTHESIS 3 TEST: Does the Step 0 message's contactId match the followup_execution's contactId?
  // If they differ, the guard query (WHERE contactId = ?) will return 0 rows and the skip won't fire.
  const idCompare = await db.query(
    `SELECT
       fe."campaignId",
       fe.id            AS execution_id,
       fe."contactId"   AS exec_contact_id,
       m.id             AS step0_message_id,
       m."contactId"    AS msg_contact_id,
       m."stepNumber"   AS msg_step,
       m."repliedAt"    AS msg_replied_at,
       (fe."contactId" = m."contactId") AS ids_match
     FROM followup_executions fe
     LEFT JOIN messages m
       ON m."campaignId" = fe."campaignId"
      AND (m."stepNumber" = 0 OR m."stepNumber" IS NULL)
      AND LOWER(TRIM((SELECT c.email FROM contacts c WHERE c.id = m."contactId"))) = $3
     WHERE fe."campaignId" = ANY($2::text[])
       AND fe."contactId" = ANY($1::text[])
     ORDER BY fe."campaignId", fe."createdAt"`,
    [contactIds, suspectCampaigns, EMAIL.toLowerCase()]
  );
  console.log(`\n--- HYPOTHESIS 3: execution.contactId vs step0 message.contactId ---`);
  console.table(idCompare.rows);
  console.log(`If ids_match = false anywhere, the guard query misses and the skip never fires.`);

  // Also: dump ALL contacts with this email to see if duplicates exist
  const allContacts = await db.query(
    `SELECT id, email, "organizationId", "createdAt", "updatedAt", status
     FROM contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
     ORDER BY "createdAt" ASC`,
    [EMAIL]
  );
  console.log(`\n--- All contacts with email ${EMAIL} (${allContacts.rowCount}) ---`);
  console.table(allContacts.rows);

  // Q5: followup_steps — what's the trigger type? This is CRITICAL.
  // If trigger !== 'no_reply' the send-time guard at line 1147 is bypassed entirely.
  const stepIds = [...new Set(execs.rows.map(r => r.stepId).filter(Boolean))];
  if (stepIds.length > 0) {
    const steps = await db.query(
      `SELECT id, "sequenceId", "stepNumber", trigger,
              "delayDays", "delayHours", "delayMinutes",
              LEFT(subject, 50) as subject
       FROM followup_steps
       WHERE id = ANY($1::text[])
       ORDER BY "stepNumber"`,
      [stepIds]
    );
    console.log(`\n--- followup_steps used by suspect executions (${steps.rowCount}) ---`);
    console.table(steps.rows);
  }

  // Q6: campaign_followups — sequence wrappers (no step defs, those live in followup_steps)
  const seqs = await db.query(
    `SELECT id, "campaignId", "sequenceId", "isActive", "createdAt"
     FROM campaign_followups
     WHERE "campaignId" = ANY($1::text[])
     ORDER BY "campaignId"`,
    [suspectCampaigns]
  );
  console.log(`\n--- campaign_followups wrappers (${seqs.rowCount}) ---`);
  console.table(seqs.rows);

  // Q7: tracking_events
  const events = await db.query(
    `SELECT type, "campaignId", "messageId", "stepNumber", "createdAt"
     FROM tracking_events
     WHERE "contactId" = ANY($1::text[])
       AND "campaignId" = ANY($2::text[])
       AND type IN ('reply','bounce','sent')
     ORDER BY "createdAt" ASC`,
    [contactIds, suspectCampaigns]
  );
  console.log(`\n--- tracking_events (${events.rowCount}) ---`);
  console.table(events.rows);

  console.log('\n=== End ===\n');
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
