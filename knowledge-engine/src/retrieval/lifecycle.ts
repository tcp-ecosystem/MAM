/**
 * RetrievalLifecycle — cache TTL sweeping, bounded pruning and event emission
 * for the Retrieval layer of the standalone MAM Knowledge Engine.
 *
 * Retrieval results are cached so repeated queries do not re-scan the corpus,
 * but an unbounded cache is a slow memory leak. This module owns the *life* of
 * those cached entries:
 *
 * - **TTL sweeping** — {@link RetrievalLifecycle.start} arms a periodic timer
 *   that calls {@link RetrievalLifecycle.sweep}, removing entries whose
 *   `expiresAt` has passed. `stop` disarms it. The sweep interval and TTL are
 *   configurable and the clock is injectable for deterministic tests.
 * - **Bounded pruning** — {@link RetrievalLifecycle.prune} evicts the
 *   least-recently-*accessed* entries when the cache exceeds a cap, so the
 *   cache never grows past a configured budget even when the TTL is generous.
 * - **Targeted invalidation** — {@link RetrievalLifecycle.clearQuery} removes
 *   every cached entry that answers a given query (normalised match on the
 *   original query text), which is what a caller wants when an underlying
 *   chunk changes and old answers must be dropped.
 * - **Events** — the lifecycle is observable. Every write to the cache emits a
 *   `'cache'` {@link RetrievalLifecycleEvent}; pruning and sweeping emit
 *   `'prune'`/`'sweep'`; {@link RetrievalLifecycle.reset} emits `'reset'`.
 *   Listeners are attached with `on`/`once` and removed with `off`, following
 *   the familiar Node-style emitter API but with zero dependencies.
 *
 * The lifecycle is storage-agnostic: it manages a `key → entry` map and can be
 * pointed at any cache that presents the same shape, so it works equally well
 * as the TTL/sweep brain for a {@link KnowledgeRetriever}'s internal cache or
 * as a standalone result cache fronted by {@link KnowledgeRetrieverAdapter}.
 *
 * @packageDocumentation
 * @module retrieval/lifecycle
 */

import { DEFAULT_TTL_MS, normalizeText } from './types.js';
import type {
  RetrievalLifecycleEvent,
  Timestamp,
} from './types.js';

/**
 * Listener signature for lifecycle events.
 *
 * @param event - the emitted event
 */
export type LifecycleListener = (event: RetrievalLifecycleEvent) => void;

/**
 * A single cached entry managed by the lifecycle.
 */
export interface LifecycleCacheEntry<T = unknown> {
  /** Cache key the entry is stored under. */
  readonly key: string;
  /** The cached value (e.g. a {@link RetrievalResult}). */
  readonly value: T;
  /** Original query text this entry answers, when known. */
  readonly queryText?: string;
  /** Epoch-ms time the entry was written. */
  readonly createdAt: Timestamp;
  /** Epoch-ms time the entry expires and becomes sweepable. */
  readonly expiresAt: Timestamp;
  /** Epoch-ms time of the most recent read (LRU bookkeeping). */
  lastAccessedAt: Timestamp;
  /** Number of times the entry has been read from cache. */
  accessCount: number;
}

/**
 * Construction options for the lifecycle.
 */
export interface LifecycleOptions {
  /** Time-to-live (ms) applied to registered entries. Defaults to 60s. */
  readonly ttlMs?: number;
  /** Interval (ms) between periodic TTL sweeps. Defaults to `ttlMs`. */
  readonly sweepIntervalMs?: number;
  /** Maximum number of cached entries retained by {@link RetrievalLifecycle.prune}. `0` disables the cap. */
  readonly maxEntries?: number;
  /** Clock used for all timestamps; injectable for deterministic tests. */
  readonly now?: () => Timestamp;
}

/**
 * On-demand statistics about the lifecycle's behaviour.
 */
export interface LifecycleStats {
  /** Number of cached entries currently held. */
  readonly cachedQueries: number;
  /** Number of entries registered since construction. */
  readonly created: number;
  /** Number of entries removed by {@link RetrievalLifecycle.prune}. */
  readonly pruned: number;
  /** Number of sweep passes completed. */
  readonly swept: number;
  /** Number of entries removed by {@link RetrievalLifecycle.sweep}. */
  readonly expired: number;
  /** Number of times {@link RetrievalLifecycle.reset} was called. */
  readonly resetCount: number;
  /** Whether the periodic sweep timer is currently armed. */
  readonly running: boolean;
  /** Epoch-ms time the lifecycle was constructed. */
  readonly createdAt: Timestamp;
  /** Epoch-ms time of the last sweep, or `null`. */
  readonly lastSweepAt: Timestamp | null;
}

/**
 * The default event type emitted when no specific type is given to `on`.
 */
export const DEFAULT_EVENT_TYPE = 'cache' as const;

/**
 * Manages cache entry lifecycles: registration, TTL sweeps, bounded pruning,
 * targeted invalidation and observable events.
 *
 * @example
 * ```ts
 * const lifecycle = new RetrievalLifecycle({ ttlMs: 30_000, maxEntries: 100 });
 * lifecycle.on('prune', (event) => console.log(`pruned ${event.count}`));
 * lifecycle.register('q-1', someResult, 30_000, 'how do I back up?');
 * lifecycle.start();      // arms periodic TTL sweeps
 * lifecycle.clearQuery('how do I back up?'); // invalidates by query
 * lifecycle.stop();
 * ```
 */
export class RetrievalLifecycle {
  /** The managed cache: key → entry. */
  private readonly cache = new Map<string, LifecycleCacheEntry>();

  /** Registered listeners keyed by event type. */
  private readonly listeners = new Map<string, Set<LifecycleListener>>();

  /** The periodic sweep timer, or `null` when not running. */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** TTL (ms) applied to registered entries. */
  private readonly ttlMs: number;

  /** Interval (ms) between periodic sweeps. */
  private readonly sweepIntervalMs: number;

  /** Maximum retained entries for {@link RetrievalLifecycle.prune}; `0` = no cap. */
  private readonly maxEntries: number;

  /** Injectable clock. */
  private readonly now: () => Timestamp;

  /** Counters. */
  private created = 0;
  private prunedCount = 0;
  private sweptCount = 0;
  private expiredCount = 0;
  private resetCount = 0;

  /** Epoch-ms time the lifecycle was constructed. */
  private readonly createdAt: Timestamp;

  /** Epoch-ms time of the last sweep, or `null`. */
  private lastSweepAt: Timestamp | null = null;

  /**
   * Construct a lifecycle.
   *
   * @param options - optional TTL, sweep interval, entry cap and clock
   */
  constructor(options: LifecycleOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? this.ttlMs;
    this.maxEntries = options.maxEntries ?? 0;
    this.createdAt = this.now();
  }

  /**
   * Register (or refresh) a cached entry.
   *
   * Writes the entry with a fresh TTL window and emits a `'cache'` event.
   *
   * @param key - the cache key
   * @param value - the value to cache
   * @param ttlMs - optional per-entry TTL; defaults to the configured TTL
   * @param queryText - optional original query text this entry answers (used by
   *   {@link RetrievalLifecycle.clearQuery})
   * @returns the registered entry
   */
  register<T>(
    key: string,
    value: T,
    ttlMs?: number,
    queryText?: string,
  ): LifecycleCacheEntry<T> {
    const now = this.now();
    const entry: LifecycleCacheEntry<T> = {
      key,
      value,
      queryText,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
      lastAccessedAt: now,
      accessCount: 0,
    };
    this.cache.set(key, entry as LifecycleCacheEntry);
    this.created += 1;
    this.emit({
      type: 'cache',
      timestamp: now,
      count: 1,
      keys: [key],
      detail: { write: true },
    });
    return entry;
  }

  /**
   * Read a cached entry, bumping its LRU metadata, or `undefined` on miss.
   *
   * Emits a `'cache'` event on a hit.
   *
   * @param key - the cache key
   * @returns the stored value, or `undefined`
   */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    const now = this.now();
    entry.lastAccessedAt = now;
    entry.accessCount += 1;
    this.emit({
      type: 'cache',
      timestamp: now,
      count: 1,
      keys: [key],
      detail: { write: false },
    });
    return entry.value as T;
  }

  /**
   * Peek at a cached entry without touching its LRU metadata.
   *
   * @param key - the cache key
   * @returns the stored value, or `undefined`
   */
  peek<T = unknown>(key: string): T | undefined {
    return this.cache.get(key)?.value as T | undefined;
  }

  /**
   * Test whether a key is present in the cache.
   *
   * @param key - the cache key
   * @returns `true` when present
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove a single entry from the cache.
   *
   * @param key - the cache key
   * @returns `true` when an entry was removed
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Number of cached entries currently held.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * All cache keys currently held.
   *
   * @returns a fresh array of keys
   */
  keys(): string[] {
    return [...this.cache.keys()];
  }

  /**
   * All cache entries currently held.
   *
   * @returns a fresh array of entries
   */
  entries(): readonly LifecycleCacheEntry[] {
    return [...this.cache.values()];
  }

  /**
   * Evict entries until the cache fits within `maxEntries`.
   *
   * Eviction order is least-recently-*accessed* first (LRU). Emits a
   * `'prune'` event listing the evicted keys.
   *
   * @param maxEntries - the cap to enforce; `0`/`undefined` uses the configured cap
   * @returns the number of entries evicted
   */
  prune(maxEntries = this.maxEntries): number {
    if (maxEntries <= 0 || this.cache.size <= maxEntries) {
      return 0;
    }
    const sorted = [...this.cache.entries()].sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
    );
    const excess = this.cache.size - maxEntries;
    const keys: string[] = [];
    for (let i = 0; i < excess; i += 1) {
      const key = sorted[i][0];
      this.cache.delete(key);
      keys.push(key);
    }
    this.prunedCount += keys.length;
    const now = this.now();
    this.emit({
      type: 'prune',
      timestamp: now,
      count: keys.length,
      keys,
      detail: { reason: 'max-entries', cap: maxEntries },
    });
    return keys.length;
  }

  /**
   * Invalidate every cached entry that answers a given query.
   *
   * Matching is done on the original query text (normalised, lower-cased). When
   * an entry carries no query text, its key is compared to the normalised text
   * instead. Emits a `'prune'` event with `detail.reason === 'query-invalidated'`.
   *
   * @param text - the query whose cached answers should be dropped
   * @returns the number of entries removed
   */
  clearQuery(text: string): number {
    const target = normalizeText(text);
    const keys: string[] = [];
    for (const [key, entry] of this.cache) {
      const candidate =
        entry.queryText !== undefined
          ? normalizeText(entry.queryText)
          : normalizeText(key);
      if (candidate === target) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      this.cache.delete(key);
    }
    if (keys.length > 0) {
      this.prunedCount += keys.length;
      this.emit({
        type: 'prune',
        timestamp: this.now(),
        count: keys.length,
        keys,
        detail: { reason: 'query-invalidated', query: text },
      });
    }
    return keys.length;
  }

  /**
   * Remove every entry from the cache.
   *
   * @returns the number of entries removed
   */
  clear(): number {
    const count = this.cache.size;
    if (count > 0) {
      this.cache.clear();
      this.prunedCount += count;
    }
    return count;
  }

  /**
   * Run a TTL sweep: remove every entry whose `expiresAt` has passed.
   *
   * Emits a `'sweep'` event with `detail === 'ttl-expired'` when anything was
   * removed. Also called automatically by the periodic timer armed via
   * {@link RetrievalLifecycle.start}.
   *
   * @returns the number of entries removed
   */
  sweep(): number {
    const now = this.now();
    this.lastSweepAt = now;
    this.sweptCount += 1;
    const keys: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      this.cache.delete(key);
    }
    this.expiredCount += keys.length;
    if (keys.length > 0) {
      this.emit({
        type: 'sweep',
        timestamp: now,
        count: keys.length,
        keys,
        detail: 'ttl-expired',
      });
    }
    return keys.length;
  }

  /**
   * Reset the lifecycle: clear the cache, reset counters, emit `'reset'`.
   *
   * Listeners are preserved (use {@link RetrievalLifecycle.clearListeners} to
   * drop them). The periodic timer, if armed, keeps running.
   */
  reset(): void {
    const cleared = this.cache.size;
    this.cache.clear();
    this.created = 0;
    this.prunedCount = 0;
    this.sweptCount = 0;
    this.expiredCount = 0;
    this.resetCount += 1;
    this.emit({
      type: 'reset',
      timestamp: this.now(),
      count: cleared,
      detail: { reason: 'explicit-reset' },
    });
  }

  /**
   * Arm the periodic TTL sweep timer.
   *
   * Idempotent: calling `start` while already running is a no-op.
   *
   * @param intervalMs - optional sweep interval override (defaults to the
   *   configured value)
   * @returns `this` for chaining
   */
  start(intervalMs?: number): this {
    if (this.timer !== null) {
      return this;
    }
    const interval = intervalMs ?? this.sweepIntervalMs;
    this.timer = setInterval(() => {
      this.sweep();
    }, interval);
    return this;
  }

  /**
   * Disarm the periodic TTL sweep timer.
   *
   * @returns `this` for chaining
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  /**
   * Whether the periodic sweep timer is currently armed.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Subscribe a listener to one event type.
   *
   * @param type - the event type (`'cache' | 'prune' | 'sweep' | 'reset'`)
   * @param listener - the callback
   * @returns `this` for chaining
   */
  on(type: string, listener: LifecycleListener): this {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set<LifecycleListener>();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
    return this;
  }

  /**
   * Subscribe a listener for a single emission, then remove it.
   *
   * @param type - the event type
   * @param listener - the callback
   * @returns `this` for chaining
   */
  once(type: string, listener: LifecycleListener): this {
    const wrapper: LifecycleListener = (event) => {
      this.off(type, wrapper);
      listener(event);
    };
    return this.on(type, wrapper);
  }

  /**
   * Remove a previously-registered listener.
   *
   * @param type - the event type
   * @param listener - the callback to remove
   * @returns `this` for chaining
   */
  off(type: string, listener: LifecycleListener): this {
    const bucket = this.listeners.get(type);
    if (bucket) {
      bucket.delete(listener);
      if (bucket.size === 0) {
        this.listeners.delete(type);
      }
    }
    return this;
  }

  /**
   * Emit an event to all listeners of its type.
   *
   * Listeners are invoked synchronously, in registration order; a throwing
   * listener does not prevent the remaining listeners from running (errors are
   * captured and re-thrown after dispatch completes).
   *
   * @param event - the event to dispatch
   */
  emit(event: RetrievalLifecycleEvent): void {
    const bucket = this.listeners.get(event.type);
    if (!bucket || bucket.size === 0) {
      return;
    }
    const captured: unknown[] = [];
    for (const listener of [...bucket]) {
      try {
        listener(event);
      } catch (error) {
        captured.push(error);
      }
    }
    if (captured.length > 0) {
      throw captured[0];
    }
  }

  /**
   * Remove every registered listener.
   *
   * @returns `this` for chaining
   */
  clearListeners(): this {
    this.listeners.clear();
    return this;
  }

  /**
   * Aggregate statistics about the lifecycle.
   *
   * @returns a {@link LifecycleStats} summary
   */
  stats(): LifecycleStats {
    return {
      cachedQueries: this.cache.size,
      created: this.created,
      pruned: this.prunedCount,
      swept: this.sweptCount,
      expired: this.expiredCount,
      resetCount: this.resetCount,
      running: this.running,
      createdAt: this.createdAt,
      lastSweepAt: this.lastSweepAt,
    };
  }

  /**
   * Human-readable summary for logging.
   *
   * @returns e.g. `"RetrievalLifecycle(cached=4, running=true)"`
   */
  inspect(): string {
    return `RetrievalLifecycle(cached=${this.cache.size}, running=${
      this.running
    })`;
  }
}