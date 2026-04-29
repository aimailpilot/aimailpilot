/**
 * Pure stale-job aging decision logic.
 *
 * Used by stale-jobs-sweeper.ts (and the manual /api/admin/sweep-stale-jobs
 * trigger) to decide whether a background-job row in api_settings should be
 * flipped to 'failed'. Extracted as a pure function so the decision tree
 * (status, lastSignal extraction, NaN handling, TTL comparison) is unit-testable
 * without spinning up DB or HTTP plumbing.
 *
 * Invariants:
 *   - Only `status === 'running'` rows are eligible
 *   - Last signal = `heartbeatAt` if present, otherwise `startedAt`
 *   - Missing or unparseable signal → not stale (we can't reason about age)
 *   - Stale when `(now - lastSignal) > ttlMs`
 */

export interface JobLike {
  status?: string;
  startedAt?: string;
  heartbeatAt?: string;
}

export interface StaleDecision {
  isStale: boolean;
  /** Age in ms, present whenever a usable lastSignal was found (regardless of stale verdict). */
  ageMs?: number;
  /** Reason this row was rejected as a candidate (when isStale=false and we can explain why). */
  reason?: 'not_running' | 'no_signal' | 'invalid_signal' | 'within_ttl';
}

export function isStaleJob(job: JobLike | null | undefined, ttlMs: number, nowMs: number): StaleDecision {
  if (!job || job.status !== 'running') return { isStale: false, reason: 'not_running' };
  const lastSignal = job.heartbeatAt || job.startedAt;
  if (!lastSignal) return { isStale: false, reason: 'no_signal' };
  const lastSignalMs = new Date(lastSignal).getTime();
  if (!Number.isFinite(lastSignalMs)) return { isStale: false, reason: 'invalid_signal' };
  const ageMs = nowMs - lastSignalMs;
  if (ageMs <= ttlMs) return { isStale: false, ageMs, reason: 'within_ttl' };
  return { isStale: true, ageMs };
}
