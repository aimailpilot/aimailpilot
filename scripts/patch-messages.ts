/**
 * Patch missing messages + tracking_events from SQLite → PostgreSQL
 *
 * Usage:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:SQLITE_PATH  = "./data/aimailpilot.db"
 *   npx tsx scripts/patch-messages.ts
 *
 * Safe: uses INSERT ... ON CONFLICT DO NOTHING
 * Rows already in PG are never overwritten.
 */

import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;

const SQLITE_PATH = process.env.SQLITE_PATH || './data/aimailpilot.db';
const DATABASE_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 500;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

async function patchTable(
  sqlite: InstanceType<typeof Database>,
  pool: pg.Pool,
  tableName: string,
  columns: string[],
  jsonbColumns: string[] = []
) {
  const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all() as any[];
  const pgBefore = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
  console.log(`\n[${tableName}]`);
  console.log(`  SQLite rows: ${rows.length}`);
  console.log(`  PG rows before: ${pgBefore.rows[0].count}`);

  let inserted = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const values = columns.map(col => {
        const val = row[col];
        if (jsonbColumns.includes(col) && val && typeof val === 'string') {
          try { return JSON.parse(val); } catch { return val; }
        }
        return val ?? null;
      });

      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
      const quotedCols = columns.map(c => `"${c}"`).join(', ');

      const result = await pool.query(
        `INSERT INTO ${tableName} (${quotedCols})
         VALUES (${placeholders})
         ON CONFLICT (id) DO NOTHING`,
        values
      );

      if (result.rowCount && result.rowCount > 0) inserted++;
      else skipped++;
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  const pgAfter = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
  console.log(`\n  Inserted: ${inserted}`);
  console.log(`  Skipped (already in PG): ${skipped}`);
  console.log(`  PG rows after: ${pgAfter.rows[0].count}`);
}

async function main() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  // Patch messages
  await patchTable(sqlite, pool, 'messages', [
    'id', 'campaignId', 'contactId', 'subject', 'content', 'status',
    'trackingId', 'emailAccountId', 'stepNumber', 'sentAt', 'openedAt',
    'clickedAt', 'repliedAt', 'errorMessage', 'providerMessageId',
    'gmailThreadId', 'bouncedAt', 'createdAt'
  ]);

  // Patch tracking_events
  await patchTable(sqlite, pool, 'tracking_events', [
    'id', 'type', 'campaignId', 'messageId', 'contactId', 'trackingId',
    'url', 'userAgent', 'ip', 'metadata', 'stepNumber', 'createdAt'
  ], ['metadata']);

  console.log('\nDone. Restart the Azure app to reflect changes.');

  sqlite.close();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
