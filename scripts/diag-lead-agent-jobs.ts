#!/usr/bin/env npx tsx
/**
 * Quick diagnostic: list all lead_agent_job_* rows across all orgs with a
 * one-line summary so we can tell at a glance whether a stuck job is hung,
 * making progress, or actually finished.
 */
import pg from 'pg';
const { Client } = pg;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r = await c.query(`
    SELECT "organizationId", "settingKey", "settingValue"
    FROM api_settings
    WHERE "settingKey" LIKE 'lead_agent_job_%'
    ORDER BY "settingKey" DESC LIMIT 20
  `);

  console.log(`\n=== ${r.rowCount} lead-agent jobs ===\n`);
  const now = Date.now();
  for (const row of r.rows) {
    try {
      const j = typeof row.settingValue === 'string' ? JSON.parse(row.settingValue) : row.settingValue;
      const startedAgo = j.startedAt ? Math.round((now - new Date(j.startedAt).getTime()) / 1000) : null;
      const heartbeatAgo = j.heartbeatAt ? Math.round((now - new Date(j.heartbeatAt).getTime()) / 1000) : null;
      const fmt = (n: number | null) => n == null ? '∞' : (n > 60 ? `${Math.round(n/60)}m` : `${n}s`);
      const flag = j.status === 'running' ? (heartbeatAgo != null && heartbeatAgo > 60 ? '⚠️  STALE' : '⏳ RUNNING') : (j.status === 'cancelled' ? '🛑 CANCEL' : (j.status === 'failed' ? '❌ FAIL' : '✅ DONE'));
      console.log(`${flag}  ${j.id?.slice(-16)}`);
      console.log(`   org=${j.organizationId} mode=${j.mode}  startedAgo=${fmt(startedAgo)}  heartbeatAgo=${fmt(heartbeatAgo)}  cancelReq=${j.cancelRequested}`);
      if (j.error) console.log(`   error: ${String(j.error).slice(0, 200)}`);
      if (j.result) console.log(`   leads=${j.result?.leads?.length ?? 0}  cost=$${j.result?.llmUsage?.estCostUsd?.toFixed(4) ?? '?'}`);
      console.log('');
    } catch (e: any) {
      console.log(`  PARSE ERROR for ${row.settingKey}: ${e.message}`);
    }
  }
  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
