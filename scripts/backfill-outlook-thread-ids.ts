#!/usr/bin/env npx tsx
/**
 * Backfill script: Fix step-0 Outlook providerMessageIds across ALL campaigns.
 *
 * Campaigns sent before the immutable ID fix have step-0 messages with synthetic
 * 'graph-...-noheaders' providerMessageIds. Without real Graph IDs, the follow-up
 * engine's createReply call 404s and falls back to non-threaded sends.
 *
 * This script:
 *   1. Finds every Outlook email account with fake step-0 providerMessageIds
 *   2. Refreshes each account's Microsoft token
 *   3. Queries Graph SentItems for each message to find the real immutable ID
 *   4. Updates the DB so subsequent follow-ups thread correctly
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://..."
 *   npx tsx scripts/backfill-outlook-thread-ids.ts
 *
 * Optional: --dry-run  (prints what would be updated without writing)
 * Optional: --campaign=<id>  (limit to a single campaign)
 */

import pg from 'pg';

const { Client } = pg;

// ── Config ────────────────────────────────────────────────────────────────────

// Superadmin org that holds shared Microsoft OAuth client_id/client_secret
const SUPERADMIN_ORG_ID = '550e8400-e29b-41d4-a716-446655440001';

// Time window around sentAt when searching SentItems (±minutes)
const WINDOW_MINUTES = 5;

// Rate limit between Graph calls (ms)
const DELAY_MS = 400;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const campaignArg = args.find(a => a.startsWith('--campaign='));
const CAMPAIGN_FILTER = campaignArg ? campaignArg.split('=')[1] : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function refreshMicrosoftToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite offline_access',
  });
  const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json() as any;
  if (!data.access_token) throw new Error('No access_token in refresh response');
  return data.access_token;
}

async function findSentMessageId(
  token: string,
  recipientEmail: string,
  sentAt: Date,
): Promise<{ graphId: string; internetMessageId: string } | null> {
  const start = new Date(sentAt.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  const end   = new Date(sentAt.getTime() + WINDOW_MINUTES * 60_000).toISOString();

  // Graph OData does not allow filtering toRecipients/any(...) alongside sentDateTime
  // in the same $filter. Filter by time window server-side, match recipient client-side.
  const filter = `sentDateTime ge ${start} and sentDateTime le ${end}`;
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$filter=${encodeURIComponent(filter)}&$select=id,internetMessageId,toRecipients,sentDateTime&$top=50&$orderby=sentDateTime desc`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Prefer': 'IdType="ImmutableId"',
    },
  });

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 200);
    console.error(`    Graph error (${resp.status}): ${text}`);
    return null;
  }

  const data = await resp.json() as any;
  const candidates: any[] = data?.value || [];
  const target = recipientEmail.toLowerCase();

  for (const msg of candidates) {
    const recipients: any[] = msg.toRecipients || [];
    const match = recipients.some(r => (r?.emailAddress?.address || '').toLowerCase() === target);
    if (match) {
      return { graphId: msg.id, internetMessageId: msg.internetMessageId };
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FakeMessageGroup = {
  emailAccountId: string;
  senderEmail: string;
  organizationId: string;
  messageCount: number;
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL env var is required');
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update DB)'}`);
  if (CAMPAIGN_FILTER) console.log(`Campaign filter: ${CAMPAIGN_FILTER}`);

  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  console.log('Connected to database\n');

  try {
    // 1. Get shared Microsoft OAuth client credentials from superadmin org
    const credRows = await db.query<{ settingKey: string; settingValue: string }>(
      `SELECT "settingKey", "settingValue" FROM api_settings
       WHERE "organizationId" = $1
         AND "settingKey" IN ('microsoft_oauth_client_id','microsoft_oauth_client_secret')`,
      [SUPERADMIN_ORG_ID],
    );
    const creds: Record<string, string> = {};
    for (const r of credRows.rows) creds[r.settingKey] = r.settingValue;

    const clientId     = process.env.MICROSOFT_CLIENT_ID     || creds['microsoft_oauth_client_id'];
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || creds['microsoft_oauth_client_secret'];

    if (!clientId || !clientSecret) {
      throw new Error(`Microsoft OAuth credentials not found in superadmin org ${SUPERADMIN_ORG_ID}`);
    }
    console.log('Got Microsoft OAuth client credentials from superadmin org');

    // 2. Find all email accounts with fake step-0 providerMessageIds
    const campaignWhere = CAMPAIGN_FILTER ? `AND m."campaignId" = '${CAMPAIGN_FILTER.replace(/'/g, "''")}'` : '';

    const groupRows = await db.query<FakeMessageGroup>(
      `SELECT
         m."emailAccountId",
         ea.email AS "senderEmail",
         ea."organizationId",
         COUNT(*)::int AS "messageCount"
       FROM messages m
       JOIN email_accounts ea ON ea.id = m."emailAccountId"
       WHERE m."stepNumber" = 0
         AND ea.provider = 'outlook'
         AND (m."providerMessageId" LIKE 'graph-%-noheaders'
              OR m."providerMessageId" IS NULL
              OR m."providerMessageId" = '')
         ${campaignWhere}
       GROUP BY m."emailAccountId", ea.email, ea."organizationId"
       ORDER BY "messageCount" DESC`,
    );

    if (groupRows.rows.length === 0) {
      console.log('No fake step-0 messages found. Nothing to backfill.');
      return;
    }

    console.log(`\nFound ${groupRows.rows.length} Outlook email account(s) with fake IDs:`);
    for (const g of groupRows.rows) {
      console.log(`  • ${g.senderEmail.padEnd(40)} ${g.messageCount} messages`);
    }
    console.log('');

    // 3. Process each account
    let totalUpdated = 0;
    let totalFailed  = 0;
    let totalSkipped = 0;

    for (const group of groupRows.rows) {
      console.log(`\n━━ ${group.senderEmail} (${group.messageCount} messages) ━━`);

      // Get per-sender refresh token
      const prefix = `outlook_sender_${group.senderEmail}_`;
      const tokenRows = await db.query<{ settingKey: string; settingValue: string }>(
        `SELECT "settingKey", "settingValue" FROM api_settings
         WHERE "organizationId" = $1
           AND "settingKey" IN ($2, $3, $4)`,
        [group.organizationId, `${prefix}access_token`, `${prefix}refresh_token`, `${prefix}token_expiry`],
      );
      const tokenSettings: Record<string, string> = {};
      for (const r of tokenRows.rows) tokenSettings[r.settingKey] = r.settingValue;

      let accessToken = '';
      const refreshTok = tokenSettings[`${prefix}refresh_token`] || '';

      if (!refreshTok) {
        console.log(`  ⚠ No refresh token found for ${group.senderEmail} — skipping all ${group.messageCount} messages`);
        totalSkipped += group.messageCount;
        continue;
      }

      // Always refresh to be safe
      try {
        console.log(`  Refreshing token...`);
        accessToken = await refreshMicrosoftToken(refreshTok, clientId, clientSecret);
      } catch (err) {
        console.log(`  ⚠ Token refresh failed: ${err instanceof Error ? err.message : err} — skipping`);
        totalSkipped += group.messageCount;
        continue;
      }

      // Get all fake step-0 messages for this account
      const msgRows = await db.query<{
        id: string;
        campaignId: string;
        contactId: string;
        recipientEmail: string | null;
        sentAt: string;
        providerMessageId: string | null;
      }>(
        `SELECT m.id, m."campaignId", m."contactId", m."recipientEmail", m."sentAt", m."providerMessageId"
         FROM messages m
         WHERE m."emailAccountId" = $1
           AND m."stepNumber" = 0
           AND (m."providerMessageId" LIKE 'graph-%-noheaders'
                OR m."providerMessageId" IS NULL
                OR m."providerMessageId" = '')
           ${campaignWhere}
         ORDER BY m."sentAt" ASC`,
        [group.emailAccountId],
      );

      let updated = 0, failed = 0, skipped = 0;

      for (let i = 0; i < msgRows.rows.length; i++) {
        const msg = msgRows.rows[i];

        // Resolve recipient email
        let recipientEmail = msg.recipientEmail;
        if (!recipientEmail) {
          const cr = await db.query<{ email: string }>(
            `SELECT email FROM contacts WHERE id = $1`,
            [msg.contactId],
          );
          recipientEmail = cr.rows[0]?.email || null;
        }

        if (!recipientEmail) {
          skipped++;
          continue;
        }

        const sentAt = new Date(msg.sentAt);
        const prefix = `[${i + 1}/${msgRows.rows.length}]`;
        process.stdout.write(`  ${prefix} ${recipientEmail.padEnd(40)} `);

        const found = await findSentMessageId(accessToken, recipientEmail, sentAt);
        if (!found) {
          console.log('NOT FOUND');
          failed++;
        } else {
          if (DRY_RUN) {
            console.log(`would update → ${found.graphId.slice(0, 30)}...`);
          } else {
            await db.query(
              `UPDATE messages SET "providerMessageId" = $1, "messageId" = $2 WHERE id = $3`,
              [found.graphId, found.internetMessageId, msg.id],
            );
            console.log('OK');
          }
          updated++;
        }

        await sleep(DELAY_MS);
      }

      console.log(`  Result: ${updated} updated, ${failed} not found, ${skipped} skipped`);
      totalUpdated += updated;
      totalFailed  += failed;
      totalSkipped += skipped;
    }

    console.log(`\n━━ TOTAL ━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Updated  : ${totalUpdated}`);
    console.log(`  Not found: ${totalFailed}`);
    console.log(`  Skipped  : ${totalSkipped}`);
    if (DRY_RUN) console.log(`\n(dry run — no changes written)`);
    else if (totalUpdated > 0) {
      console.log(`\nBackfill complete. Subsequent follow-ups will use real immutable IDs and thread correctly.`);
    }

  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
