/**
 * Bounded Set/Map with FIFO eviction.
 *
 * Subclasses of native Set/Map so all existing .add/.has/.delete/.get/.set/
 * .keys() / iteration call sites work unchanged. When `add` (Set) or `set` (Map)
 * is called and the collection is at capacity, the oldest entry (Map's iteration
 * preserves insertion order) is evicted before the new one is inserted.
 *
 * Used by routes.ts to bound the in-memory `loggedInUsers` Set and `authCache`
 * Map at 10k entries each, preventing unbounded memory growth on long-running
 * pods. Cache-miss path always re-resolves from DB so eviction is invisible
 * to users.
 *
 * Pure data structures — extracted from routes.ts so they can be unit-tested
 * in isolation. routes.ts imports from here.
 */

export class BoundedSet<T> extends Set<T> {
  private readonly maxSize: number;
  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }
  add(value: T): this {
    if (!this.has(value) && this.size >= this.maxSize) {
      const oldest = this.values().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.add(value);
  }
}

export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;
  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }
  set(key: K, value: V): this {
    if (!this.has(key) && this.size >= this.maxSize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.set(key, value);
  }
}
