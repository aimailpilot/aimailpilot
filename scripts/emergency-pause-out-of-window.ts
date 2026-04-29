#!/usr/bin/env npx tsx
/**
 * Emergency: pause campaigns currently sending OUTSIDE their configured autopilot window.
 *
 * Run with DRY_RUN=1 first to see what would be paused, then again without to apply.
 * Sets status='paused' and autoPaused=true, so boot-recovery + 15-min sweeper will
 * automatically resume them once the window opens (no manual restart needed).
 *
 * Logic:
 *   - For each active campaign with sendingConfig.autopilot.enabled = true,
 *     compute "is current time inside today's window in the campaign's timezone".
 *   - If outside, pause it.
 *   - Campaigns with no autopilot are LEFT ALONE (they have no configured window).
 */
import pg from 'pg';
const { Client } = pg;

const DRY_RUN = process.env.DRY_RUN === '1';
// FORCE=1 → pause EVERY active campaign regardless of autopilot config.
// Use this when you want to stop everything immediately (e.g. you just discovered
// campaigns are sending without window enforcement and want to halt them).
const FORCE = process.env.FORCE === '1';

function getUserLocalTime(sendingConfig: any): Date {
  if (sendingConfig?.timezone) {
    try {
      const nowUtc = new Date();
      const localStr = nowUtc.toLocaleString('en-US', { timeZone: sendingConfig.timezone });
      return new Date(localStr);
    } catch { /* fall through */ }
  }
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const userLocalMs = utcMs - (sendingConfig?.timezoneOffset || 0) * 60000;
  return new Date(userLocalMs);
}

function isOutsideWindow(sendingConfig: any): { outside: boolean; reason: string } {
  if (!sendingConfig?.autopilot?.enabled) {
    return { outside: false, reason: 'autopilot disabled — no window configured' };
  }
  const ap = sendingConfig.autopilot;
  const userLocal = getUserLocalTime(sendingConfig);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[userLocal.getDay()];
  const dayConfig = ap.days?.[dayName];

  if (!dayConfig?.enabled) {
    return { outside: true, reason: `${dayName} disabled` };
  }
  const HH = String(userLocal.getHours()).padStart(2, '0');
  const MM = String(userLocal.getMinutes()).padStart(2, '0');
  const currentTime = `${HH}:${MM}`;
  const start = dayConfig.startTime;
  const end = dayConfig.endTime;
  const overnight = !!(start && end && start > end);

  if (overnight) {
    const inWindow = currentTime >= start || currentTime < end;
    return { outside: !inWindow, reason: inWindow ? `inside overnight ${start}-${end}` : `outside overnight ${start}-${end} (now ${currentTime})` };
  }
  if (start && currentTime < start) return { outside: true, reason: `before ${start} (now ${currentTime})` };
  if (end && currentTime >= end) return { outside: true, reason: `after ${end} (now ${currentTime})` };
  return { outside: false, reason: `inside ${start}-${end}` };
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const res = await db.query(`
    SELECT id, name, "sendingConfig"
    FROM campaigns
    WHERE status = 'active'
  `);

  console.log(`\n=== Found ${res.rowCount} active campaigns ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will pause out-of-window campaigns)'}\n`);

  const toPause: { id: string; name: string; reason: string }[] = [];
  const okInWindow: { id: string; name: string; reason: string }[] = [];
  const noAutopilot: { id: string; name: string }[] = [];

  for (const row of res.rows) {
    const sc = row.sendingConfig;
    if (!sc?.autopilot?.enabled) {
      if (FORCE) {
        toPause.push({ id: row.id, name: row.name, reason: 'no autopilot — force-paused' });
      } else {
        noAutopilot.push({ id: row.id, name: row.name });
      }
      continue;
    }
    const check = isOutsideWindow(sc);
    if (check.outside) {
      toPause.push({ id: row.id, name: row.name, reason: check.reason });
    } else {
      okInWindow.push({ id: row.id, name: row.name, reason: check.reason });
    }
  }

  console.log(`✅ Inside window — leave running (${okInWindow.length}):`);
  for (const c of okInWindow) console.log(`   ${c.name}  [${c.reason}]`);

  console.log(`\n⚠️  No autopilot configured — leave alone (${noAutopilot.length}):`);
  for (const c of noAutopilot) console.log(`   ${c.name}`);

  console.log(`\n🛑 Outside window — WILL PAUSE (${toPause.length}):`);
  for (const c of toPause) console.log(`   ${c.name}  [${c.reason}]`);

  if (toPause.length === 0) {
    console.log('\nNothing to pause. Done.');
    await db.end();
    return;
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — re-run without DRY_RUN=1 to apply.');
    await db.end();
    return;
  }

  const ids = toPause.map(c => c.id);
  // FORCE mode → autoPaused=false so the 15-min daily-limit sweeper does NOT auto-resume.
  // User must manually resume after configuring autopilot.
  // Window-only mode → autoPaused=true so sweeper resumes once window opens.
  const autoPausedFlag = FORCE ? false : true;
  const upd = await db.query(
    `UPDATE campaigns
       SET status = 'paused', "autoPaused" = $2, "updatedAt" = NOW()
     WHERE id = ANY($1::text[])`,
    [ids, autoPausedFlag]
  );
  console.log(`\n✅ Paused ${upd.rowCount} campaigns. autoPaused=${autoPausedFlag} ${FORCE ? '(durable — manual resume required)' : '(will auto-resume when window opens)'}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
