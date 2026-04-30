#!/usr/bin/env npx tsx
/**
 * List all email accounts currently flagged for reauth.
 */
import pg from 'pg';
const { Client } = pg;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`
    SELECT email, provider, "authStatus", "authFailureCount", "authLastErrorCode", "authLastFailureAt", "organizationId"
    FROM email_accounts
    WHERE "authStatus" = 'reauth_required' AND "isActive" != 0
    ORDER BY "authLastFailureAt" DESC
  `);
  console.log(`Found ${r.rowCount} accounts needing reauth:`);
  for (const row of r.rows) {
    const ago = row.authLastFailureAt
      ? Math.round((Date.now() - new Date(row.authLastFailureAt).getTime()) / 60000) + 'm ago'
      : 'unknown';
    console.log(`  ${row.email} (${row.provider}) failures=${row.authFailureCount} code=${row.authLastErrorCode} last=${ago}`);
  }
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
