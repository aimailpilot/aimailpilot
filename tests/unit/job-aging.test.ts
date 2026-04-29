/**
 * Tests for server/lib/job-aging.ts (isStaleJob)
 * --------------------------------------------------
 * Validates the stale-detection logic used by the stale-jobs-sweeper to
 * auto-fail crashed background jobs (lead-intel, bulk-template-analyze).
 *
 * Regression class: the 8-hour zombie Lead Intel job we hit this session.
 * Without the heartbeat-fallback-to-startedAt logic, jobs without heartbeats
 * never aged out. Without the NaN guard, malformed timestamps crashed the
 * sweep loop.
 */

import { describe, it, expect } from 'vitest';
import { isStaleJob } from '../../server/lib/job-aging';

const ONE_HOUR_MS = 60 * 60 * 1000;

describe('isStaleJob', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0); // fixed 'now' for deterministic age math

  it('non-running jobs are never stale', () => {
    expect(isStaleJob({ status: 'completed', startedAt: '2020-01-01T00:00:00Z' }, ONE_HOUR_MS, now).isStale).toBe(false);
    expect(isStaleJob({ status: 'failed', startedAt: '2020-01-01T00:00:00Z' }, ONE_HOUR_MS, now).isStale).toBe(false);
    expect(isStaleJob({ status: 'cancelled', startedAt: '2020-01-01T00:00:00Z' }, ONE_HOUR_MS, now).isStale).toBe(false);
    expect(isStaleJob({ status: 'pending' }, ONE_HOUR_MS, now).reason).toBe('not_running');
  });

  it('null/undefined job is not stale (defensive)', () => {
    expect(isStaleJob(null, ONE_HOUR_MS, now).isStale).toBe(false);
    expect(isStaleJob(undefined, ONE_HOUR_MS, now).isStale).toBe(false);
  });

  it('running job within TTL is not stale', () => {
    const startedAt = new Date(now - 30 * 60 * 1000).toISOString(); // 30 min ago
    const r = isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(false);
    expect(r.reason).toBe('within_ttl');
    expect(r.ageMs).toBe(30 * 60 * 1000);
  });

  it('running job older than TTL is stale (regression: 8h Lead Intel zombie)', () => {
    const startedAt = new Date(now - 8 * 60 * 60 * 1000).toISOString();
    const r = isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(true);
    expect(r.ageMs).toBe(8 * 60 * 60 * 1000);
  });

  it('uses heartbeatAt when present, NOT startedAt', () => {
    // Job started 8 hours ago but heartbeat 5 min ago → should be fresh
    const startedAt = new Date(now - 8 * 60 * 60 * 1000).toISOString();
    const heartbeatAt = new Date(now - 5 * 60 * 1000).toISOString();
    const r = isStaleJob({ status: 'running', startedAt, heartbeatAt }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(false);
  });

  it('falls back to startedAt when heartbeatAt is missing', () => {
    const startedAt = new Date(now - 90 * 60 * 1000).toISOString(); // 1.5h ago
    const r = isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(true); // 90min > 60min TTL
  });

  it('boundary: exactly TTL is NOT stale (only strictly greater)', () => {
    const startedAt = new Date(now - ONE_HOUR_MS).toISOString();
    expect(isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now).isStale).toBe(false);
  });

  it('1 ms over TTL → stale', () => {
    const startedAt = new Date(now - ONE_HOUR_MS - 1).toISOString();
    expect(isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now).isStale).toBe(true);
  });

  it('missing startedAt and heartbeatAt → not stale (cannot compute age)', () => {
    const r = isStaleJob({ status: 'running' }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(false);
    expect(r.reason).toBe('no_signal');
  });

  it('invalid timestamp string → not stale (NaN guard prevents crash)', () => {
    const r = isStaleJob({ status: 'running', startedAt: 'not-a-date' }, ONE_HOUR_MS, now);
    expect(r.isStale).toBe(false);
    expect(r.reason).toBe('invalid_signal');
  });

  it('different TTLs work (lead-intel 1h vs hypothetical 5min)', () => {
    const startedAt = new Date(now - 30 * 60 * 1000).toISOString(); // 30 min ago
    expect(isStaleJob({ status: 'running', startedAt }, ONE_HOUR_MS, now).isStale).toBe(false); // 30min < 1h
    expect(isStaleJob({ status: 'running', startedAt }, 5 * 60 * 1000, now).isStale).toBe(true);  // 30min > 5min
  });
});
