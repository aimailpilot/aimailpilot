/**
 * Tests for server/lib/type-coercion.ts
 * --------------------------------------------------
 * Regression spec for the campaign-update bug encountered this session:
 * the frontend sent `trackOpens: true` (JS boolean) or `'true'` (string),
 * but the PG INTEGER column rejected both with
 *   "invalid input syntax for type integer: 'true'"
 *
 * Centralizing the coercer + locking the matrix ensures the next
 * boolean-shaped field added to a route can't silently re-introduce this.
 */

import { describe, it, expect } from 'vitest';
import { toInt } from '../../server/lib/type-coercion';

describe('toInt', () => {
  describe('boolean inputs', () => {
    it('true → 1', () => expect(toInt(true, 0)).toBe(1));
    it('false → 0', () => expect(toInt(false, 1)).toBe(0));
  });

  describe('string-of-boolean inputs (the actual bug)', () => {
    it("'true' → 1", () => expect(toInt('true', 0)).toBe(1));
    it("'false' → 0", () => expect(toInt('false', 1)).toBe(0));
  });

  describe('null/undefined → default', () => {
    it('null → default(0)', () => expect(toInt(null, 0)).toBe(0));
    it('null → default(1)', () => expect(toInt(null, 1)).toBe(1));
    it('undefined → default(0)', () => expect(toInt(undefined, 0)).toBe(0));
  });

  describe('numeric strings → parsed integers', () => {
    it("'0' → 0", () => expect(toInt('0', 99)).toBe(0));
    it("'1' → 1", () => expect(toInt('1', 99)).toBe(1));
    it("'42' → 42", () => expect(toInt('42', 99)).toBe(42));
    it("'-3' → -3", () => expect(toInt('-3', 99)).toBe(-3));
  });

  describe('numbers → unchanged', () => {
    it('0 → 0', () => expect(toInt(0, 99)).toBe(0));
    it('1 → 1', () => expect(toInt(1, 99)).toBe(1));
    it('42 → 42', () => expect(toInt(42, 99)).toBe(42));
  });

  describe('non-numeric strings → default', () => {
    // parseInt returns NaN, falsy → default
    it("'foo' → default", () => expect(toInt('foo', 5)).toBe(5));
    it("'' → default", () => expect(toInt('', 5)).toBe(5));
  });

  describe('campaign-update regression: trackOpens / includeUnsubscribe', () => {
    // The exact symptoms of the production bug fixed in commit f5d99d2:
    //   POST /api/campaigns/:id with body { trackOpens: true } from React form
    //   PG complained: invalid input syntax for type integer: 'true'
    it('trackOpens=true (boolean) → 1', () => expect(toInt(true, 1)).toBe(1));
    it("trackOpens='true' (string from URL/form) → 1", () => expect(toInt('true', 1)).toBe(1));
    it('trackOpens=undefined keeps default of 1', () => expect(toInt(undefined, 1)).toBe(1));
    it('includeUnsubscribe=false (boolean) → 0', () => expect(toInt(false, 0)).toBe(0));
    it("includeUnsubscribe='false' (string) → 0", () => expect(toInt('false', 0)).toBe(0));
  });
});
