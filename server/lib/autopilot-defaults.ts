/**
 * Default autopilot configuration applied when a campaign is sent without
 * an explicit one. Prevents the "no autopilot = no window enforcement = sending
 * 24/7" failure mode that caused production campaigns to fire emails outside
 * intended hours.
 *
 * Default = Monday–Friday, 09:00–18:00 in the caller's timezone, 1000/day max,
 * 5-minute delay. Conservative defaults that are safe for any business mailbox.
 *
 * Pure function — no I/O, no SDK calls — easy to unit-test.
 */

export interface AutopilotDayConfig {
  enabled: boolean;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

export interface AutopilotConfig {
  enabled: boolean;
  days: Record<string, AutopilotDayConfig>;
  maxPerDay: number;
  delayBetween: number;
  delayUnit: 'seconds' | 'minutes';
}

export function defaultAutopilotConfig(): AutopilotConfig {
  return {
    enabled: true,
    days: {
      Monday:    { enabled: true,  startTime: '09:00', endTime: '18:00' },
      Tuesday:   { enabled: true,  startTime: '09:00', endTime: '18:00' },
      Wednesday: { enabled: true,  startTime: '09:00', endTime: '18:00' },
      Thursday:  { enabled: true,  startTime: '09:00', endTime: '18:00' },
      Friday:    { enabled: true,  startTime: '09:00', endTime: '18:00' },
      Saturday:  { enabled: false, startTime: '09:00', endTime: '18:00' },
      Sunday:    { enabled: false, startTime: '09:00', endTime: '18:00' },
    },
    maxPerDay: 1000,
    delayBetween: 5,
    delayUnit: 'minutes',
  };
}

/**
 * Returns the caller's autopilot config if it has window-enforcement intent
 * (i.e. enabled=true with at least one enabled day), otherwise the safe default.
 *
 * Specifically replaces these failure modes:
 *  - autopilot is null/undefined        → use default
 *  - autopilot.enabled === false        → use default (user disabled it explicitly,
 *                                          but we still want some window enforcement)
 *  - autopilot has no enabled days      → use default (would never send otherwise)
 *
 * Callers can fully opt out by passing { ...config, allowNoWindow: true } to a
 * future variant — for now, every campaign gets a window.
 */
export function resolveAutopilotConfig(input: any): AutopilotConfig {
  if (!input || typeof input !== 'object') return defaultAutopilotConfig();
  if (input.enabled !== true) return defaultAutopilotConfig();
  const days = input.days;
  if (!days || typeof days !== 'object') return defaultAutopilotConfig();
  const anyEnabled = Object.values(days).some((d: any) => d?.enabled === true);
  if (!anyEnabled) return defaultAutopilotConfig();
  return input as AutopilotConfig;
}
