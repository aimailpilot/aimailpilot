/**
 * Patch missing api_settings rows from SQLite → PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=<pg_conn> SQLITE_PATH=./aimailpilot.db npx tsx scripts/patch-api-settings.ts
 *
 * Safe: uses INSERT ... ON CONFLICT DO NOTHING
 * Rows already in PG (newer tokens) are never overwritten.
 */

import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;

const SQLITE_PATH = process.env.SQLITE_PATH || './data/aimailpilot.db';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

async function main() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  // Count before
  const sqliteRows = sqlite.prepare('SELECT * FROM api_settings').all() as any[];
  const pgBefore = await pool.query('SELECT COUNT(*) FROM api_settings');
  console.log(`SQLite rows: ${sqliteRows.length}`);
  console.log(`PG rows before: ${pgBefore.rows[0].count}`);

  let inserted = 0;
  let skipped = 0;

  for (const row of sqliteRows) {
    const result = await pool.query(
      `INSERT INTO api_settings (id, "organizationId", "settingKey", "settingValue", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("organizationId", "settingKey") DO NOTHING`,
      [
        row.id,
        row.organizationId,
        row.settingKey,
        row.settingValue,
        row.createdAt || new Date().toISOString(),
        row.updatedAt || new Date().toISOString(),
      ]
    );
    if (result.rowCount && result.rowCount > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  const pgAfter = await pool.query('SELECT COUNT(*) FROM api_settings');
  console.log(`\nDone.`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already in PG): ${skipped}`);
  console.log(`PG rows after: ${pgAfter.rows[0].count}`);

  sqlite.close();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
