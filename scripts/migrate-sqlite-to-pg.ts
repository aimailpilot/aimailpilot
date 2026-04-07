/**
 * SQLite → PostgreSQL Data Migration Script
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Environment:
 *   DATABASE_URL  — PostgreSQL connection string (required)
 *   SQLITE_PATH   — SQLite file path (default: ./data/aimailpilot.db)
 *
 * Prerequisites:
 *   1. pg-schema.sql must be run against the PostgreSQL database first
 *   2. SQLite database must be accessible
 *
 * What it does:
 *   - Reads all 31 tables from SQLite
 *   - Batch-inserts into PostgreSQL (1000 rows per batch)
 *   - Converts TEXT JSON columns to proper JSONB
 *   - Verifies row counts match
 *   - Skips tables that already have data (safe to re-run)
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// ===== Configuration =====
const SQLITE_PATH = process.env.SQLITE_PATH || './data/aimailpilot.db';
const DATABASE_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 1000;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Example: DATABASE_URL=postgresql://user:pass@host:5432/db npx tsx scripts/migrate-sqlite-to-pg.ts');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`ERROR: SQLite database not found at ${SQLITE_PATH}`);
  console.error('Set SQLITE_PATH environment variable if it is in a different location');
  process.exit(1);
}

// ===== Table definitions in dependency order =====
// Each entry: [tableName, jsonbColumns[]]
// jsonbColumns are columns that are TEXT in SQLite but JSONB in PostgreSQL
const TABLES: [string, string[]][] = [
  ['organizations', ['settings']],
  ['users', []],
  ['email_accounts', ['smtpConfig']],
  ['llm_configs', []],
  ['contact_lists', ['headers']],
  ['contacts', ['tags', 'customFields', 'emailRatingDetails', 'campaignHistory']],
  ['segments', ['filters']],
  ['templates', ['variables']],
  ['campaigns', ['contactIds', 'sendingConfig']],
  ['messages', []],
  ['tracking_events', ['metadata']],
  ['unsubscribes', []],
  ['integrations', []],
  ['followup_sequences', []],
  ['followup_steps', []],
  ['campaign_followups', []],
  ['followup_executions', []],
  ['api_settings', []],
  ['unified_inbox', ['labels']],
  ['org_members', []],
  ['org_invitations', []],
  ['contact_activities', ['metadata']],
  ['suppression_list', []],
  ['warmup_accounts', ['settings']],
  ['warmup_logs', ['sendPairs']],
  ['email_history', []],
  ['lead_opportunities', ['sampleSubjects', 'sampleSnippets']],
  ['contact_activity', ['metadata']],
  ['notifications', ['metadata']],
  ['org_documents', ['tags', 'metadata']],
  ['email_attachments', []],
];

// ===== Helpers =====

/** Ensure a value is valid JSON for PostgreSQL JSONB column */
function toJsonb(value: any): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try {
      // Validate it's parseable JSON
      JSON.parse(value);
      return value;
    } catch {
      // Not valid JSON — wrap as JSON string
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

/** Quote column name for PostgreSQL (handles camelCase) */
function quoteCol(col: string): string {
  // Always quote to handle camelCase safely
  return `"${col}"`;
}

/** Build INSERT statement with $1, $2, ... placeholders */
function buildInsert(table: string, columns: string[]): string {
  const quotedCols = columns.map(quoteCol).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  return `INSERT INTO ${table} (${quotedCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
}

// ===== Main migration =====
async function migrate() {
  console.log('========================================');
  console.log('  SQLite → PostgreSQL Migration');
  console.log('========================================');
  console.log(`SQLite:     ${SQLITE_PATH}`);
  console.log(`PostgreSQL: ${DATABASE_URL!.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Connect to SQLite
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log('[SQLite] Connected (read-only)');

  // Connect to PostgreSQL
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL!.includes('azure') ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

  try {
    await pool.query('SELECT 1');
    console.log('[PG] Connected');
  } catch (err: any) {
    console.error('[PG] Connection failed:', err.message);
    process.exit(1);
  }

  console.log('');

  const results: { table: string; sqlite: number; pg: number; migrated: number; skipped: boolean }[] = [];

  for (const [table, jsonbCols] of TABLES) {
    process.stdout.write(`[${table}] `);

    // Check if table exists in SQLite
    const tableExists = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);

    if (!tableExists) {
      console.log('⏭  Table does not exist in SQLite — skipping');
      results.push({ table, sqlite: 0, pg: 0, migrated: 0, skipped: true });
      continue;
    }

    // Count rows in SQLite
    const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get() as any).cnt;

    // Count existing rows in PostgreSQL
    let pgCountBefore = 0;
    try {
      const pgRes = await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      pgCountBefore = parseInt(pgRes.rows[0].cnt, 10);
    } catch {
      console.log('⏭  Table does not exist in PostgreSQL — run pg-schema.sql first');
      results.push({ table, sqlite: sqliteCount, pg: 0, migrated: 0, skipped: true });
      continue;
    }

    if (pgCountBefore > 0) {
      console.log(`⏭  Already has ${pgCountBefore} rows in PG (SQLite: ${sqliteCount}) — skipping`);
      results.push({ table, sqlite: sqliteCount, pg: pgCountBefore, migrated: 0, skipped: true });
      continue;
    }

    if (sqliteCount === 0) {
      console.log('✓  Empty table — nothing to migrate');
      results.push({ table, sqlite: 0, pg: 0, migrated: 0, skipped: false });
      continue;
    }

    // Read all rows from SQLite
    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();

    if (rows.length === 0) {
      console.log('✓  No rows');
      results.push({ table, sqlite: 0, pg: 0, migrated: 0, skipped: false });
      continue;
    }

    // Get column names from first row
    const columns = Object.keys(rows[0] as any);
    const insertSql = buildInsert(table, columns);
    const jsonbSet = new Set(jsonbCols);

    // Batch insert
    let migrated = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of batch) {
          const values = columns.map(col => {
            const val = (row as any)[col];
            if (jsonbSet.has(col)) {
              return toJsonb(val);
            }
            return val;
          });
          await client.query(insertSql, values);
        }
        await client.query('COMMIT');
        migrated += batch.length;
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(`\n  ERROR in batch at row ${i}: ${err.message}`);
        // Try row-by-row to find the problematic row
        let singleMigrated = 0;
        const client2 = await pool.connect();
        try {
          for (const row of batch) {
            try {
              const values = columns.map(col => {
                const val = (row as any)[col];
                if (jsonbSet.has(col)) return toJsonb(val);
                return val;
              });
              await client2.query(insertSql, values);
              singleMigrated++;
            } catch (rowErr: any) {
              const rowId = (row as any).id || 'unknown';
              console.error(`  SKIP row id=${rowId}: ${rowErr.message}`);
            }
          }
          migrated += singleMigrated;
        } finally {
          client2.release();
        }
      } finally {
        client.release();
      }

      if (rows.length > BATCH_SIZE) {
        process.stdout.write(`\r[${table}] ${migrated}/${sqliteCount} `);
      }
    }

    // Verify final count
    const pgCountAfter = parseInt(
      (await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`)).rows[0].cnt, 10
    );

    const match = pgCountAfter === sqliteCount ? '✓' : '⚠';
    console.log(`${match}  ${migrated} rows migrated (SQLite: ${sqliteCount}, PG: ${pgCountAfter})`);
    results.push({ table, sqlite: sqliteCount, pg: pgCountAfter, migrated, skipped: false });
  }

  // ===== Summary =====
  console.log('\n========================================');
  console.log('  Migration Summary');
  console.log('========================================');
  console.log(`${'Table'.padEnd(25)} ${'SQLite'.padStart(8)} ${'PG'.padStart(8)} ${'Migrated'.padStart(10)} Status`);
  console.log('-'.repeat(70));

  let totalSqlite = 0;
  let totalPg = 0;
  let totalMigrated = 0;
  let warnings = 0;

  for (const r of results) {
    totalSqlite += r.sqlite;
    totalPg += r.pg;
    totalMigrated += r.migrated;
    const status = r.skipped ? 'SKIPPED' : (r.sqlite === r.pg ? 'OK' : 'MISMATCH');
    if (status === 'MISMATCH') warnings++;
    console.log(
      `${r.table.padEnd(25)} ${String(r.sqlite).padStart(8)} ${String(r.pg).padStart(8)} ${String(r.migrated).padStart(10)} ${status}`
    );
  }

  console.log('-'.repeat(70));
  console.log(
    `${'TOTAL'.padEnd(25)} ${String(totalSqlite).padStart(8)} ${String(totalPg).padStart(8)} ${String(totalMigrated).padStart(10)}`
  );

  if (warnings > 0) {
    console.log(`\n⚠  ${warnings} table(s) have mismatched counts — investigate before cutover`);
  } else {
    console.log('\n✓  All tables migrated successfully');
  }

  // Cleanup
  sqlite.close();
  await pool.end();
  console.log('\nDone.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
