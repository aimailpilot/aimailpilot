/**
 * Tests for server/lib/bounded-collections.ts
 * --------------------------------------------------
 * Verifies the FIFO eviction behavior used by routes.ts to bound the
 * `loggedInUsers` Set and `authCache` Map at 10k entries each. Memory leak
 * regression test — these collections were previously unbounded.
 *
 * Key invariants:
 *   1. Adding under capacity does not evict
 *   2. Adding at capacity evicts the OLDEST entry (FIFO via insertion order)
 *   3. Updating an existing key does NOT evict (size doesn't grow)
 *   4. Native Set/Map APIs (.has, .delete, .keys, iteration) still work
 */

import { describe, it, expect } from 'vitest';
import { BoundedSet, BoundedMap } from '../../server/lib/bounded-collections';

describe('BoundedSet', () => {
  it('respects maxSize and evicts oldest on overflow', () => {
    const s = new BoundedSet<number>(3);
    s.add(1);
    s.add(2);
    s.add(3);
    expect(s.size).toBe(3);
    expect([...s]).toEqual([1, 2, 3]);

    // Adding a 4th evicts the oldest (1)
    s.add(4);
    expect(s.size).toBe(3);
    expect(s.has(1)).toBe(false);
    expect(s.has(4)).toBe(true);
    expect([...s]).toEqual([2, 3, 4]);
  });

  it('does NOT evict when re-adding an existing value', () => {
    const s = new BoundedSet<number>(3);
    s.add(1);
    s.add(2);
    s.add(3);
    // Re-adding 2 (already present) must not change size or evict
    s.add(2);
    expect(s.size).toBe(3);
    expect(s.has(1)).toBe(true);
    expect([...s]).toEqual([1, 2, 3]);
  });

  it('handles many evictions correctly (rolling window)', () => {
    const s = new BoundedSet<number>(5);
    for (let i = 0; i < 100; i++) s.add(i);
    expect(s.size).toBe(5);
    // Should have only the last 5 inserted (95-99)
    expect([...s]).toEqual([95, 96, 97, 98, 99]);
  });

  it('delete works as on a normal Set', () => {
    const s = new BoundedSet<string>(10);
    s.add('a');
    s.add('b');
    expect(s.delete('a')).toBe(true);
    expect(s.has('a')).toBe(false);
    expect(s.delete('nonexistent')).toBe(false);
  });

  it('size 1 behaves like a single-slot cache', () => {
    const s = new BoundedSet<number>(1);
    s.add(1);
    expect([...s]).toEqual([1]);
    s.add(2);
    expect([...s]).toEqual([2]);
    s.add(3);
    expect([...s]).toEqual([3]);
  });
});

describe('BoundedMap', () => {
  it('respects maxSize and evicts oldest key on overflow', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    expect(m.size).toBe(3);
    expect([...m.keys()]).toEqual(['a', 'b', 'c']);

    m.set('d', 4);
    expect(m.size).toBe(3);
    expect(m.has('a')).toBe(false);
    expect(m.get('d')).toBe(4);
    expect([...m.keys()]).toEqual(['b', 'c', 'd']);
  });

  it('does NOT evict when updating an existing key', () => {
    const m = new BoundedMap<string, number>(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    // Updating 'b' must not change size or evict 'a'
    m.set('b', 999);
    expect(m.size).toBe(3);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(999);
    expect([...m.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('rolls cleanly through many entries', () => {
    const m = new BoundedMap<number, string>(5);
    for (let i = 0; i < 50; i++) m.set(i, `v${i}`);
    expect(m.size).toBe(5);
    expect([...m.keys()]).toEqual([45, 46, 47, 48, 49]);
    expect(m.get(45)).toBe('v45');
    expect(m.get(0)).toBeUndefined();
  });

  it('iteration matches insertion order (auth cache key cleanup depends on this)', () => {
    const m = new BoundedMap<string, number>(10);
    m.set('user1:org1', 1);
    m.set('user2:org1', 2);
    m.set('user1:org2', 3);
    const keys: string[] = [];
    for (const k of m.keys()) keys.push(k);
    expect(keys).toEqual(['user1:org1', 'user2:org1', 'user1:org2']);
  });
});
