#!/usr/bin/env npx tsx
import pg from 'pg';
const { Client } = pg;
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('DROP INDEX CONCURRENTLY IF EXISTS idx_messages_matchable');
  console.log('Dropped idx_messages_matchable');
  const wm = await db.query(`SHOW work_mem`);
  console.log('Current work_mem:', wm.rows[0].work_mem);
  const sb = await db.query(`SHOW shared_buffers`);
  console.log('shared_buffers:', sb.rows[0].shared_buffers);
  await db.end();
})();
