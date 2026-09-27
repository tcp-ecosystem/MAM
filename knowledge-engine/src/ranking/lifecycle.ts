/**
 * Lifecycle management for the Ranking layer of the standalone MAM Knowledge
 * Engine.
 *
 * {@link RankingLifecycle} owns the *discipline* of the ranking cache: it
 * bounds its size, expires its stale entries and broadcasts what happened to
 * any observer. Where {@link RankingStore} is the passive data holder,
 * {@link RankingLifecycle} is the active manager that decides *when* entries
 * leave.
 *
 * Responsibilities:
 *
 * - **Pruning** — {@link RankingLifecycle.prune} shrinks the store to a target
 *   size, evicting least-recently-accessed entries first, and emits a
 *   `'prune'` event with the count and target.
 * - **Targeted clearing** — {@link RankingLifecycle.clearQuery} (and the
 *   query-aware {@link RankingLifecycle.clearQueryByQuery}) drop a single
 *   query's cached result and emit a `'cache'` event.
 * - **Reset** — {@link RankingLifecycle.reset} empties the store, stops the
 *   sweeper and resets all counters, emitting a `'reset'` event.
 * - **TTL sweeping** — {@link RankingLifecycle.start} / {@link RankingLifecycle.stop}
 *   drive an interval timer that periodically calls
 *   {@link RankingLifecycle.sweep} to evict expired entries (emitting
 *   `'sweep'`); {@link RankingLifecycle.sweep} is also callable manually.
 * - **Events** — the lifecycle is an `EventEmitter`. Every operation emits a
 *   {@link RankingLifecycleEvent} on its discriminant (`'cache'`, `'prune'`,
 *   `'sweep'`, `'reset'`) and also on a generic `'event'` channel, so both
 *   targeted and blanket subscriptions work.
 * - **Inspection** — {@link RankingLifecycle.stats} reports whether the
 *   sweeper is running, the current sweep interval, cumulative counters and
 *   the store's live size.
 *
 * The lifecycle never scores or ranks anything; it only manages the cache that
 * {@link RankingStore} holds. The sweeper timer is `unref`-ed so it never keeps
 * a Node.js process alive by itself.
 *
 * @module ranking/lifecycle
 */

import { EventEmitter } from 'node:events';

import { RankingStore } from './store.js';
import {
  DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_TTL_MS,
  normalizeText,
} from './types.js';
import type {
  RankingLifecycleEvent,
  RankingQuery,
  RankingStats,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link RankingLifecycle}.
 */
export interface RankingLifecycleOptions {
  /**
   * Interval in milliseconds between automatic TTL sweep passes while running.
   * Defaults to {@link DEFAULT_SWEEP_INTERVAL_MS}.
   */
  readonly sweepIntervalMs: number;

  /**
   * Time-to-live (ms) for cached results, forwarded as the store's default.
   * Defaults to {@link DEFAULT_TTL_MS}.
   */
  readonly ttlMs: number;

  /**
   * Default prune target used by {@link RankingLifecycle.prune} when the
   * caller omits `maxEntries`. Defaults to {@link DEFAULT_MAX_CACHE_SIZE}.
   */
  readonly maxCacheSize: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the lifecycle
   * deterministic under test.
   */
  readonly now: () => Timestamp;
}

/**
 * Live statistics for a {@link RankingLifecycle}.
 */
export interface RankingLifecycleStats {
  /**
   * Whether the TTL sweeper is currently running.
   */
  readonly running: boolean;

  /**
   * The configured sweep interval in milliseconds.
   */
  readonly sweepIntervalMs: number;

  /**
   * Total entries evicted by {@link RankingLifecycle.prune} since the last
   * reset.
   */
  readonly pruned: number;

  /**
   * Total entries evicted as expired by sweeps since the last reset.
   */
  readonly swept: number;

  /**
   * Total entries cleared via {@link RankingLifecycle.clearQuery} / reset.
   */
  readonly cleared: number;

  /**
   * Number of times {@link RankingLifecycle.reset} has run.
   */
  readonly resets: number;

  /**
   * Current number of entries in the managed store.
   */
  readonly storeSize: number;

  /**
   * Epoch-millisecond time the sweeper was last started, or `null`.
   */
  readonly startedAt: Timestamp | null;

  /**
   * Epoch-millisecond time of the last sweep pass, or `null`.
   */
  readonly lastSweepAt: Timestamp | null;

  /**
   * Epoch-millisecond time the lifecycle was constructed.
   */
  readonly createdAt: Timestamp;
}

/**
 * Manages the ranking cache's size, freshness and event broadcast.
 *
 * See the module documentation for a full walkthrough. A lifecycle is always
 * constructed around an existing {@link RankingStore}; call
 * {@link RankingLifecycle.start} to begin automatic TTL sweeping, and
 * {@link RankingLifecycle.dispose} to tear the object down cleanly.
 *
 * @example
 * ```ts
 * const store = new RankingStore();
 * const lifecycle = new RankingLifecycle(store, { sweepIntervalMs: 15_000 });
 * lifecycle.on('sweep', (event) => console.log('swept', event.count));
 * lifecycle.start();
 * lifecycle.clearQuery('what is MCP?');
 * lifecycle.prune(50);
 * lifecycle.dispose();
 * ```
 */
export class RankingLifecycle extends EventEmitter {
  private readonly _store: RankingStore;
  private readonly _options: RankingLifecycleOptions;
  private _timer: NodeJS.Timeout | null = null;
  private _running = false;
  private _pruned = 0;
  private _swept = 0;
  private _cleared = 0;
  private _resets = 0;
  private _startedAt: Timestamp | null = null;
  private _lastSweepAt: Timestamp | null = null;
  private readonly _createdAt: Timestamp;

  /**
   * Construct a lifecycle around a store.
   *
   * @param store - the {@link RankingStore} to manage
   * @param options - partial {@link RankingLifecycleOptions}; omitted fields
   *   use the defaults
   */
  constructor(store: RankingStore, options: Partial<RankingLifecycleOptions> = {}) {
    super();
    this._store = store;
    this._options = {
      sweepIntervalMs: options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxCacheSize: options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
      now: options.now ?? (() => Date.now()),
    };
    this._createdAt = this._options.now();
  }

  /**
   * The managed store.
   */
  get store(): RankingStore {
    return this._store;
  }

  /**
   * Whether the TTL sweeper is currently running.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * The resolved lifecycle options.
   */
  get options(): Readonly<RankingLifecycleOptions> {
    return this._options;
  }

  /**
   * Begin periodic TTL sweeping.
   *
   * Idempotent: calling `start` while already running is a no-op that returns
   * `false`. The interval timer is `unref`-ed so it will not keep the process
   * alive on its own.
   *
   * @param intervalMs - optional override of the configured sweep interval
   * @returns `true` when the sweeper was newly started
   */
  start(intervalMs?: number): boolean {
    if (this._running) {
      return false;
    }
    this._running = true;
    this._startedAt = this._options.now();
    const interval = Math.max(10, intervalMs ?? this._options.sweepIntervalMs);
    this._timer = setInterval(() => {
      this.sweep();
    }, interval);
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
    return true;
  }

  /**
   * Stop periodic TTL sweeping.
   *
   * @returns `true` when the sweeper was running and has been stopped
   */
  stop(): boolean {
    if (!this._running) {
      return false;
    }
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    return true;
  }

  /**
   * Run one TTL sweep pass over the store.
   *
   * Evicts every expired entry, accumulates the `swept` counter, records
   * `lastSweepAt` and emits a `'sweep'` event (even when nothing was removed,
   * so observers can rely on the event as a heartbeat).
   *
   * @returns the number of entries swept
   */
  sweep(): number {
    const removed = this._store.sweepExpired();
    if (removed > 0) {
      this._swept += removed;
    }
    this._lastSweepAt = this._options.now();
    this._emit({
      type: 'sweep',
      timestamp: this._lastSweepAt,
      count: removed,
      detail: { running: this._running },
    });
    return removed;
  }

  /**
   * Shrink the store to at most `maxEntries` live entries.
   *
   * Eviction is recency-based (least-recently-accessed first), so hot queries
   * survive. Emits a `'prune'` event with the count and target.
   *
   * @param maxEntries - the target maximum size; defaults to the configured
   *   `maxCacheSize`
   * @returns the number of entries evicted
   */
  prune(maxEntries?: number): number {
    const target = maxEntries ?? this._options.maxCacheSize;
    const removed = this._store.prune(target);
    if (removed > 0) {
      this._pruned += removed;
    }
    this._emit({
      type: 'prune',
      timestamp: this._options.now(),
      count: removed,
      detail: { target },
    });
    return removed;
  }

  /**
   * Drop a single query's cached result.
   *
   * The query text is normalised before keying, matching the store's key
   * derivation. Emits a `'cache'` event with the affected key.
   *
   * @param text - the query text whose cache entry should be cleared
   * @returns `true` when an entry was removed
   */
  clearQuery(text: string): boolean {
    const key = normalizeText(text);
    const removed = this._store.delete(key);
    if (removed) {
      this._cleared += 1;
    }
    this._emit({
      type: 'cache',
      timestamp: this._options.now(),
      count: removed ? 1 : 0,
      keys: [key],
      detail: { op: 'clear', text },
    });
    return removed;
  }

  /**
   * Drop the cached result for a structured query.
   *
   * @param query - the query whose cache entry should be cleared
   * @returns `true` when an entry was removed
   */
  clearQueryByQuery(query: RankingQuery): boolean {
    return this.clearQuery(query?.text ?? '');
  }

  /**
   * Empty the store, stop the sweeper and reset all counters.
   *
   * Emits a `'reset'` event with the number of entries cleared. Subsequent
   * {@link RankingLifecycle.start} calls restart sweeping fresh.
   *
   * @returns the number of entries cleared
   */
  reset(): number {
    this.stop();
    const cleared = this._store.clear();
    this._cleared += cleared;
    this._resets += 1;
    this._pruned = 0;
    this._swept = 0;
    this._startedAt = null;
    this._lastSweepAt = null;
    this._emit({
      type: 'reset',
      timestamp: this._options.now(),
      count: cleared,
    });
    return cleared;
  }

  /**
   * Compute live statistics for the lifecycle.
   *
   * @returns a {@link RankingLifecycleStats} snapshot
   */
  stats(): RankingLifecycleStats {
    return {
      running: this._running,
      sweepIntervalMs: this._options.sweepIntervalMs,
      pruned: this._pruned,
      swept: this._swept,
      cleared: this._cleared,
      resets: this._resets,
      storeSize: this._store.size,
      startedAt: this._startedAt,
      lastSweepAt: this._lastSweepAt,
      createdAt: this._createdAt,
    };
  }

  /**
   * Produce a {@link RankingStats}-compatible view for consumers that report
   * the whole subsystem in one shape.
   *
   * @returns a {@link RankingStats} snapshot mixing lifecycle counters with
   *   the store's state
   */
  toRankingStats(): RankingStats {
    const lifecycle = this.stats();
    return {
      chunks: 0,
      documents: 0,
      distinctTerms: 0,
      totalTerms: 0,
      averageDocumentLength: 0,
      cachedQueries: lifecycle.storeSize,
      queries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      ranked: 0,
      pruned: lifecycle.pruned,
      swept: lifecycle.swept,
      averageScore: 0,
      topScore: 0,
      lastQueryAt: null,
      createdAt: lifecycle.createdAt,
    };
  }

  /**
   * Stop the sweeper and detach every listener.
   *
   * Safe to call multiple times and from within event handlers.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Broadcast a lifecycle event on both its discriminant and the generic
   * `'event'` channel.
   *
   * @param event - the event to broadcast
   */
  private _emit(event: RankingLifecycleEvent): void {
    this.emit(event.type, event);
    this.emit('event', event);
  }
}