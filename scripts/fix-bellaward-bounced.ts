#!/usr/bin/env npx tsx
/**
 * Fix: restore all bounced contacts whose email matches any email_accounts row (any org).
 * Also removes them from suppression_list.
 * Run: npx tsx scripts/fix-bellaward-bounced.ts
 * Apply: npx tsx scripts/fix-bellaward-bounced.ts --apply
 */
import pg from 'pg';
const { Client } = pg;
const APPLY = process.argv.includes('--apply');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // Find all bounced contacts that match ANY email_accounts email (across all orgs)
  const bounced = await db.query(`
    SELECT DISTINCT c.id, c.email, c."organizationId"
    FROM contacts c
    INNER JOIN email_accounts ea ON lower(ea.email) = lower(c.email)
    WHERE c.status = 'bounced'
    ORDER BY c.email
  `);

  console.log(`Found ${bounced.rowCount} bounced contact(s) matching sender accounts:`);
  for (const r of bounced.rows) console.log(`  ${r.email}  org=${r.organizationId.slice(0,8)}`);

  const suppressed = await db.query(`
    SELECT DISTINCT sl.id, sl.email, sl."organizationId"
    FROM suppression_list sl
    INNER JOIN email_accounts ea ON lower(ea.email) = lower(sl.email)
    ORDER BY sl.email
  `);
  console.log(`\nFound ${suppressed.rowCount} suppression_list row(s) matching sender accounts:`);
  for (const r of suppressed.rows) console.log(`  ${r.email}  org=${r.organizationId.slice(0,8)}`);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to commit.');
    await db.end(); return;
  }

  await db.query('BEGIN');
  try {
    if (bounced.rowCount) {
      const ids = bounced.rows.map(r => r.id);
      const res = await db.query(
        `UPDATE contacts SET status='active', "bouncedAt"=NULL, "bounceType"=NULL, "updatedAt"=$1 WHERE id=ANY($2::text[]) AND status='bounced'`,
        [new Date().toISOString(), ids]
      );
      console.log(`\nRestored ${res.rowCount} contacts → active`);
    }
    if (suppressed.rowCount) {
      const ids = suppressed.rows.map(r => r.id);
      const res = await db.query(`DELETE FROM suppression_list WHERE id=ANY($1::text[])`, [ids]);
      console.log(`Deleted ${res.rowCount} suppression_list rows`);
    }
    await db.query('COMMIT');
    console.log('Done.');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
