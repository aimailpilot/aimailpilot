/**
 * Stale Jobs Sweeper
 * ------------------
 * Runs every 5 minutes. Scans all background jobs stored in api_settings
 * (lead_intel_job_*, bulk_analyze_job_*) across every org and marks any
 * status='running' rows as 'failed' when their last signal (heartbeatAt
 * fallback to startedAt) is older than the per-job-type TTL.
 *
 * Why: a job that crashes mid-run (server restart, OOM, unhandled exception)
 * leaves its status as 'running' forever. The only existing age-out path is
 * the GET status endpoint, which only fires while a user is polling. Once
 * the user navigates away, the row stays 'running' indefinitely, blocks new
 * jobs of the same type via the conflict guard, and clutters /api/admin/health.
 *
 * Design:
 *   - One SQL query across all orgs for known job-type prefixes
 *   - Per-job-type TTL configured in JOB_TYPES table
 *   - Idempotent (checks status === 'running' before flipping)
 *   - Read failure on any single row never blocks the sweep
 *   - Last-run stats exposed via getStaleJobsSweepStatus() for /api/admin/health
 */

import { storage } from "../storage";
import { isStaleJob } from "../lib/job-aging";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes
const BOOT_DELAY_MS = 120 * 1000;            // 2 minutes after server boot

interface JobTypeConfig {
  keyPrefix: string;
  ttlMs: number;
  label: string;
}

// Each job type's TTL matches the corresponding handler's existing TTL constant
// (see LEAD_INTEL_JOB_TTL_MS and BULK_JOB_TTL_MS in routes.ts). Keep in sync if
// either is changed.
const JOB_TYPES: JobTypeConfig[] = [
  { keyPrefix: 'lead_intel_job_', ttlMs: 60 * 60 * 1000, label: 'lead-intel' },
  { keyPrefix: 'bulk_analyze_job_', ttlMs: 60 * 60 * 1000, label: 'bulk-template-analyze' },
];

let isProcessing = false;
interface LastRunStats {
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  scanned: number;
  aged: number;
  byType: Record<string, number>;  // label -> count aged
  errors: number;
}
const lastRun: LastRunStats = {
  startedAt: null, finishedAt: null, durationMs: null,
  scanned: 0, aged: 0, byType: {}, errors: 0,
};

export function getStaleJobsSweepStatus() {
  return { isProcessing, intervalMs: SWEEP_INTERVAL_MS, jobTypes: JOB_TYPES.map(t => ({ label: t.label, prefix: t.keyPrefix, ttlMs: t.ttlMs })), lastRun };
}

async function runSweep() {
  if (isProcessing) return;
  isProcessing = true;
  const started = Date.now();
  lastRun.startedAt = new Date(started).toISOString();
  lastRun.finishedAt = null;
  lastRun.scanned = 0;
  lastRun.aged = 0;
  lastRun.byType = {};
  lastRun.errors = 0;

  try {
    // One efficient query across all orgs for every known job-type prefix.
    // ? placeholders auto-converted to $N by storage.rawAll for PG.
    const likePatterns = JOB_TYPES.map(() => `"settingKey" LIKE ?`).join(' OR ');
    const params = JOB_TYPES.map(t => `${t.keyPrefix}%`);
    const rows = await storage.rawAll(
      `SELECT "organizationId", "settingKey", "settingValue" FROM api_settings WHERE ${likePatterns}`,
      ...params
    ) as any[];

    const now = Date.now();

    for (const row of rows) {
      lastRun.scanned++;
      try {
        const raw = row.settingValue;
        if (!raw) continue;
        const job = JSON.parse(raw);

        // Determine TTL based on which prefix this row's key matches
        const jobType = JOB_TYPES.find(t => row.settingKey.startsWith(t.keyPrefix));
        if (!jobType) continue;

        // Pure aging decision — see server/lib/job-aging.ts for the decision tree.
        const decision = isStaleJob(job, jobType.ttlMs, now);
        if (!decision.isStale) continue;
        const ageMs = decision.ageMs!;

        // Stale — flip to failed. Idempotent UPDATE not required since we just
        // overwrote the value; if a worker happens to update concurrently, the
        // worker's write wins (which is fine — we'd just retry on next sweep).
        job.status = 'failed';
        job.error = `Stale-job sweeper: no heartbeat for ${Math.round(ageMs / 60000)} minutes (TTL ${Math.round(jobType.ttlMs / 60000)}m). Likely the worker crashed or the server restarted mid-run.`;
        job.finishedAt = new Date().toISOString();

        await storage.setApiSetting(row.organizationId, row.settingKey, JSON.stringify(job));
        lastRun.aged++;
        lastRun.byType[jobType.label] = (lastRun.byType[jobType.label] || 0) + 1;
        console.log(`[StaleJobs] Aged out ${row.settingKey} (org=${row.organizationId}) — running for ${Math.round(ageMs / 60000)}m`);
      } catch (e: any) {
        lastRun.errors++;
        // Don't log every malformed row to avoid noise — just count
      }
    }

    if (lastRun.aged > 0) {
      console.log(`[StaleJobs] Cycle complete — scanned ${lastRun.scanned} rows, aged ${lastRun.aged} (${Object.entries(lastRun.byType).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
    }
  } catch (e: any) {
    console.error('[StaleJobs] Sweep failed:', e?.message || e);
    lastRun.errors++;
  } finally {
    lastRun.finishedAt = new Date().toISOString();
    lastRun.durationMs = Date.now() - started;
    isProcessing = false;
  }
}

export function startStaleJobsSweeper() {
  setTimeout(() => {
    runSweep();
    setInterval(runSweep, SWEEP_INTERVAL_MS);
    console.log(`[StaleJobs] Sweeper started — every ${SWEEP_INTERVAL_MS / 60000}min. Job types: ${JOB_TYPES.map(t => `${t.label}(${t.ttlMs / 60000}m)`).join(', ')}`);
  }, BOOT_DELAY_MS);
}
