/**
 * Tests for server/lib/autopilot-defaults.ts
 *
 * Covers the rules that prevent the "no autopilot = sends 24/7" failure mode:
 *   - null/undefined input  → default applied
 *   - enabled: false        → default applied (user disabled, but we still want a window)
 *   - empty days            → default applied (would never send otherwise)
 *   - all days disabled     → default applied
 *   - valid config          → returned unchanged
 */

import { describe, it, expect } from 'vitest';
import { resolveAutopilotConfig, defaultAutopilotConfig } from '../../server/lib/autopilot-defaults';

const validUserConfig = {
  enabled: true,
  days: {
    Monday:    { enabled: true,  startTime: '10:00', endTime: '16:00' },
    Tuesday:   { enabled: false, startTime: '09:00', endTime: '17:00' },
    Wednesday: { enabled: true,  startTime: '10:00', endTime: '16:00' },
    Thursday:  { enabled: false, startTime: '09:00', endTime: '17:00' },
    Friday:    { enabled: false, startTime: '09:00', endTime: '17:00' },
    Saturday:  { enabled: false, startTime: '09:00', endTime: '17:00' },
    Sunday:    { enabled: false, startTime: '09:00', endTime: '17:00' },
  },
  maxPerDay: 250,
  delayBetween: 2,
  delayUnit: 'minutes',
};

describe('defaultAutopilotConfig', () => {
  it('returns Mon-Fri enabled, weekends off, with 09:00-18:00 windows', () => {
    const d = defaultAutopilotConfig();
    expect(d.enabled).toBe(true);
    expect(d.days.Monday.enabled).toBe(true);
    expect(d.days.Friday.enabled).toBe(true);
    expect(d.days.Saturday.enabled).toBe(false);
    expect(d.days.Sunday.enabled).toBe(false);
    expect(d.days.Monday.startTime).toBe('09:00');
    expect(d.days.Monday.endTime).toBe('18:00');
    expect(d.maxPerDay).toBe(1000);
    expect(d.delayBetween).toBe(5);
    expect(d.delayUnit).toBe('minutes');
  });
});

describe('resolveAutopilotConfig — applies default when intent is missing', () => {
  it('null input → default', () => {
    const r = resolveAutopilotConfig(null);
    expect(r.enabled).toBe(true);
    expect(r.days.Monday.startTime).toBe('09:00');
    expect(r.days.Monday.endTime).toBe('18:00');
  });

  it('undefined input → default', () => {
    const r = resolveAutopilotConfig(undefined);
    expect(r.enabled).toBe(true);
  });

  it('non-object input → default', () => {
    expect(resolveAutopilotConfig('autopilot' as any).enabled).toBe(true);
    expect(resolveAutopilotConfig(0 as any).enabled).toBe(true);
    expect(resolveAutopilotConfig(true as any).enabled).toBe(true);
  });

  it('enabled: false → default', () => {
    const r = resolveAutopilotConfig({ ...validUserConfig, enabled: false });
    // Default is returned wholesale — user's days/maxPerDay are NOT preserved
    expect(r.enabled).toBe(true);
    expect(r.maxPerDay).toBe(1000);
  });

  it('missing days field → default', () => {
    const r = resolveAutopilotConfig({ enabled: true, maxPerDay: 100 });
    expect(r.enabled).toBe(true);
    expect(r.days.Monday).toBeDefined();
  });

  it('all days disabled → default (otherwise would never send)', () => {
    const allOff = {
      ...validUserConfig,
      days: Object.fromEntries(
        Object.entries(validUserConfig.days).map(([k, v]) => [k, { ...v, enabled: false }])
      ),
    };
    const r = resolveAutopilotConfig(allOff);
    expect(r.days.Monday.enabled).toBe(true); // default re-enabled it
  });
});

describe('resolveAutopilotConfig — preserves valid config', () => {
  it('valid user config returned unchanged', () => {
    const r = resolveAutopilotConfig(validUserConfig);
    expect(r).toBe(validUserConfig);
    expect(r.maxPerDay).toBe(250);
    expect(r.days.Monday.startTime).toBe('10:00');
  });

  it('config with at least one enabled day is preserved', () => {
    const cfg = {
      enabled: true,
      days: {
        Monday:    { enabled: false, startTime: '09:00', endTime: '17:00' },
        Tuesday:   { enabled: false, startTime: '09:00', endTime: '17:00' },
        Wednesday: { enabled: true,  startTime: '14:00', endTime: '20:00' },
        Thursday:  { enabled: false, startTime: '09:00', endTime: '17:00' },
        Friday:    { enabled: false, startTime: '09:00', endTime: '17:00' },
        Saturday:  { enabled: false, startTime: '09:00', endTime: '17:00' },
        Sunday:    { enabled: false, startTime: '09:00', endTime: '17:00' },
      },
      maxPerDay: 50,
      delayBetween: 30,
      delayUnit: 'minutes' as const,
    };
    const r = resolveAutopilotConfig(cfg);
    expect(r).toBe(cfg);
    expect(r.days.Wednesday.startTime).toBe('14:00');
  });

  it('overnight window config is preserved (startTime > endTime)', () => {
    const overnight = {
      ...validUserConfig,
      days: {
        ...validUserConfig.days,
        Monday: { enabled: true, startTime: '17:00', endTime: '07:00' },
      },
    };
    const r = resolveAutopilotConfig(overnight);
    expect(r.days.Monday.startTime).toBe('17:00');
    expect(r.days.Monday.endTime).toBe('07:00');
  });
});
