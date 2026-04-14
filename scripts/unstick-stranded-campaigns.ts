#!/usr/bin/env npx tsx
/**
 * One-time unstick: mark currently-stranded campaigns as autoPaused=true
 * so the next server restart (or resumeActiveCampaigns on boot) adopts them.
 *
 * Target: status='paused' AND autoPaused=false AND autopilot.enabled=true
 * These are campaigns the engine paused pre-flag-deploy (window closed / daily
 * limit / crash) but had no way to mark as system-paused.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx scripts/unstick-stranded-campaigns.ts           # dry run
 *   DATABASE_URL='...' npx tsx scripts/unstick-stranded-campaigns.ts --apply   # commit
 */
import pg from 'pg';
const { Client } = pg;

const APPLY = process.argv.includes('--apply');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const rows = await db.query(`
    SELECT id, name, "organizationId", "sentCount", "totalRecipients", "updatedAt"
    FROM campaigns
    WHERE status = 'paused'
      AND "autoPaused" = false
      AND "sendingConfig" IS NOT NULL
      AND "sendingConfig"->'autopilot'->>'enabled' = 'true'
    ORDER BY "updatedAt" DESC
  `);

  console.log(`\n=== ${rows.rowCount} stranded campaign(s) found ===\n`);
  for (const r of rows.rows) {
    const ago = Math.round((Date.now() - new Date(r.updatedAt).getTime()) / 3600000);
    console.log(`  ${r.name}  id=${r.id.slice(0,8)}  sent=${r.sentCount}/${r.totalRecipients}  paused=${ago}h ago`);
  }

  if (rows.rowCount === 0) {
    console.log('Nothing to unstick.');
    await db.end();
    return;
  }

  if (!APPLY) {
    console.log(`\n[DRY RUN] Re-run with --apply to mark these ${rows.rowCount} campaigns autoPaused=true.`);
    await db.end();
    return;
  }

  const result = await db.query(`
    UPDATE campaigns
    SET "autoPaused" = true, "updatedAt" = NOW()
    WHERE status = 'paused'
      AND "autoPaused" = false
      AND "sendingConfig" IS NOT NULL
      AND "sendingConfig"->'autopilot'->>'enabled' = 'true'
  `);

  console.log(`\n✅ Marked ${result.rowCount} campaign(s) autoPaused=true.`);
  console.log(`   Next server restart will adopt them via resumeActiveCampaigns.`);
  console.log(`   Or restart the Azure Web App now to trigger immediate recovery.`);

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
