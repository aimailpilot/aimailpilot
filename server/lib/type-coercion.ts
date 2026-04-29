/**
 * Type coercion helpers for the SQL boundary.
 *
 * PostgreSQL columns typed as INTEGER reject JS booleans and string forms of
 * booleans. The frontend sometimes sends `trackOpens: true` or `'true'` for
 * what the schema stores as 0/1 — the bare `Number(true)` works for booleans
 * but `Number('true')` is NaN, and a NaN bind parameter blows up the query
 * with "invalid input syntax for type integer: 'true'".
 *
 * This caused the silent campaign-update failure on the warmup-data flow we
 * debugged this session: the Update button surfaced a generic "Failed to
 * update campaign" with the real PG error hidden until we threaded it
 * through. Centralizing the coercer + testing the matrix ensures the next
 * boolean-shaped field added to a route can't silently break.
 */

/**
 * Coerce a possibly-boolean / possibly-string-bool / possibly-number value
 * to an integer suitable for a PG INTEGER column. Falls back to `def` for
 * null/undefined/empty/non-numeric values.
 *
 * Mapping:
 *   true              → 1
 *   false             → 0
 *   null / undefined  → def
 *   'true'            → 1
 *   'false'           → 0
 *   '0', '1', '42'    → 0, 1, 42
 *   42                → 42
 *   non-numeric str   → def (parseInt returns NaN, falsy → def)
 */
export function toInt(v: any, def: number): number {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === null || v === undefined) return def;
  if (typeof v === 'string') {
    if (v === 'true') return 1;
    if (v === 'false') return 0;
    // Use Number.isFinite, NOT `parseInt(v) || def` — the latter incorrectly
    // returns def for the string "0" because 0 is falsy. Matters for fields
    // like trackOpens where '0' (disabled) must NOT silently become 1 (default).
    const n = parseInt(v);
    return Number.isFinite(n) ? n : def;
  }
  return Number(v);
}
