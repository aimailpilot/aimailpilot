/**
 * Patch missing unified_inbox rows from SQLite → PostgreSQL
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:SQLITE_PATH  = "C:\...\data\aimailpilot.db"
 *   npx tsx scripts/patch-unified-inbox.ts
 *
 * Safe: uses INSERT ... ON CONFLICT DO NOTHING
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

const COLUMNS = [
  'id', 'organizationId', 'emailAccountId', 'campaignId', 'messageId',
  'contactId', 'gmailMessageId', 'gmailThreadId', 'outlookMessageId',
  'outlookConversationId', 'fromEmail', 'fromName', 'toEmail', 'subject',
  'snippet', 'body', 'bodyHtml', 'status', 'provider', 'aiDraft',
  'repliedAt', 'receivedAt', 'replyContent', 'repliedBy', 'replyType',
  'bounceType', 'threadId', 'inReplyTo', 'assignedTo', 'leadStatus',
  'isStarred', 'labels', 'sentByUs', 'createdAt'
];

const JSONB_COLS = ['labels'];

async function main() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  const rows = sqlite.prepare('SELECT * FROM unified_inbox').all() as any[];
  const pgBefore = await pool.query('SELECT COUNT(*) FROM unified_inbox');

  console.log(`SQLite rows: ${rows.length}`);
  console.log(`PG rows before: ${pgBefore.rows[0].count}`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const values = COLUMNS.map(col => {
        const val = row[col];
        if (JSONB_COLS.includes(col)) {
          if (!val) return '[]';
          if (typeof val === 'string') {
            try { return JSON.parse(val); } catch { return val; }
          }
          return val;
        }
        return val ?? null;
      });

      const placeholders = COLUMNS.map((_, idx) => `$${idx + 1}`).join(', ');
      const quotedCols = COLUMNS.map(c => `"${c}"`).join(', ');

      const result = await pool.query(
        `INSERT INTO unified_inbox (${quotedCols})
         VALUES (${placeholders})
         ON CONFLICT (id) DO NOTHING`,
        values
      );

      if (result.rowCount && result.rowCount > 0) inserted++;
      else skipped++;
    }

    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  const pgAfter = await pool.query('SELECT COUNT(*) FROM unified_inbox');
  console.log(`\nDone.`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already in PG): ${skipped}`);
  console.log(`  PG rows after: ${pgAfter.rows[0].count}`);

  sqlite.close();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
