// Diagnose why Step 2/3/4 tracking shows 0 opens/clicks.
// Works on both SQLite and PG — uses ? placeholders (rawAll auto-converts for PG).

import { storage } from '../server/storage';

const CAMPAIGN_ID = 'e8f0da45-7d94-4273-aa5d-550ab8dc871c';
const FIX_DEPLOY_TS = '2026-04-18T03:52:54Z'; // 1fe13d9 commit time (09:22 IST)

async function main() {
  console.log('=== Step-by-step message analysis ===\n');

  const rows: any[] = await (storage as any).rawAll(`
    SELECT stepNumber,
           COUNT(*) as total,
           SUM(CASE WHEN sentAt < ? THEN 1 ELSE 0 END) as before_fix,
           SUM(CASE WHEN sentAt >= ? THEN 1 ELSE 0 END) as after_fix,
           SUM(CASE WHEN trackingId IS NOT NULL AND trackingId != '' THEN 1 ELSE 0 END) as has_tracking_id,
           SUM(CASE WHEN content LIKE '%/api/track/open/%' THEN 1 ELSE 0 END) as has_open_pixel,
           SUM(CASE WHEN content LIKE '%/api/track/click/%' THEN 1 ELSE 0 END) as has_click_wrap,
           SUM(CASE WHEN openedAt IS NOT NULL THEN 1 ELSE 0 END) as opened,
           SUM(CASE WHEN clickedAt IS NOT NULL THEN 1 ELSE 0 END) as clicked,
           MIN(sentAt) as earliest_sent,
           MAX(sentAt) as latest_sent
    FROM messages
    WHERE campaignId = ?
    GROUP BY stepNumber
    ORDER BY stepNumber
  `, FIX_DEPLOY_TS, FIX_DEPLOY_TS, CAMPAIGN_ID);

  for (const r of rows) {
    console.log(`Step ${r.stepNumber}:`);
    console.log(`  total=${r.total}  before_fix=${r.before_fix}  after_fix=${r.after_fix}`);
    console.log(`  has_trackingId=${r.has_tracking_id}  has_open_pixel=${r.has_open_pixel}  has_click_wrap=${r.has_click_wrap}`);
    console.log(`  opened=${r.opened}  clicked=${r.clicked}`);
    console.log(`  sent range: ${r.earliest_sent}  ->  ${r.latest_sent}\n`);
  }

  const sample: any = await (storage as any).rawGet(`
    SELECT id, stepNumber, sentAt, trackingId,
           SUBSTR(content, 1, 300) as content_head,
           INSTR(content, '/api/track/open/') as pixel_pos,
           INSTR(content, '/api/track/click/') as click_pos,
           LENGTH(content) as content_len
    FROM messages
    WHERE campaignId = ? AND stepNumber = 2
    ORDER BY sentAt DESC
    LIMIT 1
  `, CAMPAIGN_ID);
  if (sample) {
    console.log('=== Most recent Step 2 message ===');
    console.log(`id: ${sample.id}`);
    console.log(`sentAt: ${sample.sentAt}`);
    console.log(`trackingId: ${sample.trackingId}`);
    console.log(`content_len: ${sample.content_len}  pixel_pos: ${sample.pixel_pos}  click_pos: ${sample.click_pos}`);
    console.log(`content head:\n${sample.content_head}\n`);
  } else {
    console.log('No Step 2 message found locally.');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
