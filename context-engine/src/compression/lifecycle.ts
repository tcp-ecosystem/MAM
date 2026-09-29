/**
 * Lifecycle management for the **Compression** layer of the standalone MAM
 * Context Engine.
 *
 * {@link CompressionLifecycle} keeps a long-running process's result cache
 * *bounded and tidy*. Left alone, a {@link CompressionStore} grows a result for
 * every distinct text it ever saw; over a long-lived server that can mean
 * thousands of stale entries. The lifecycle's job is to periodically sweep that
 * cache, prune the least-valuable results (the ones that saved the least), and
 * surface everything it did via events — without disturbing the entries that
 * actually carry information.
 *
 * Responsibilities:
 *
 * - **Prune** — {@link CompressionLifecycle.prune} removes the lowest-ratio
 *   results once the cache exceeds {@link CompressionLifecycle.maxEntries},
 *   preserving the entries that actually saved the most context.
 * - **Run** — {@link CompressionLifecycle.start} / {@link CompressionLifecycle
 *   .stop} run a periodic prune on a timer; {@link CompressionLifecycle.tick}
 *   performs a single manual pass for tests and one-off cleanups.
 * - **Remove** — {@link CompressionLifecycle.clearKey} evicts a single result;
 *   {@link CompressionLifecycle.reset} empties the whole cache.
 * - **Observe** — the lifecycle forwards the store's `'compressed'`, `'put'`,
 *   `'delete'`, `'clear'` and `'prune'` events and adds its own `'prune'` pass
 *   event, so a single listener can observe the whole subsystem.
 * - **Inspect** — {@link CompressionLifecycle.stats} merges the store's
 *   counters with the lifecycle's own (passes performed, running state).
 *
 * The lifecycle extends `node:events`' `EventEmitter`. Wiring to the store's
 * events happens in the constructor, so callers get forwarded events for free
 * and need not listen to both objects.
 *
 * @module compression/lifecycle
 */

import { EventEmitter } from 'node:events';

import { CompressionStore } from './store.js';
import type { CompressionStoreEvent } from './store.js';
import { clampLength } from './types.js';
import type {
  CompressionStats,
  CompressionTechnique,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link CompressionLifecycle}.
 */
export interface CompressionLifecycleOptions {
  /**
   * Maximum number of results kept before {@link CompressionLifecycle.prune}
   * starts removing the lowest-value ones. `0` disables the cap entirely.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic prune passes while running.
   */
  readonly intervalMs?: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the lifecycle
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The lifecycle's own statistics, merged with the store's.
 */
export interface LifecycleStats extends CompressionStats {
  /**
   * Number of prune passes performed (manual {@link CompressionLifecycle.tick}
   * calls plus automatic timer ticks) since construction.
   */
  readonly passes: number;

  /**
   * `true` when the periodic prune timer is currently running.
   */
  readonly running: boolean;

  /**
   * Interval in milliseconds between automatic prune passes.
   */
  readonly intervalMs: number;
}

/**
 * Payload emitted by the lifecycle's `'prune'` event.
 */
export interface PruneEvent {
  /**
   * Epoch-millisecond time the prune ran.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of results removed.
   */
  readonly removed: number;

  /**
   * Cache keys of the results that were removed.
   */
  readonly keys: readonly string[];
}

/**
 * Payload emitted (forwarded from the store) when a result is cached.
 */
export interface CompressedEvent extends CompressionStoreEvent {
  /**
   * The technique of the cached result.
   */
  readonly technique: CompressionTechnique;
}

/**
 * The compression lifecycle manager.
 *
 * See the module documentation for the full responsibility list. The lifecycle
 * observes a single {@link CompressionStore}; all pruning/reset operations are
 * applied through the store so it remains the single source of truth.
 *
 * @example
 * ```ts
 * const lifecycle = new CompressionLifecycle(store, { maxEntries: 32 });
 * lifecycle.on('prune', (e) => log(`pruned ${e.removed} results`));
 * lifecycle.start();          // periodic prune every 60s
 * lifecycle.stop();
 * ```
 */
export class CompressionLifecycle extends EventEmitter {
  /**
   * The store this lifecycle manages.
   */
  readonly store: CompressionStore;

  /**
   * Maximum number of results kept before pruning starts (`0` = unbounded).
   */
  readonly maxEntries: number;

  /**
   * Interval in milliseconds between automatic prune passes.
   */
  readonly intervalMs: number;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * The active prune timer handle, or `null` while stopped.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Number of results removed by pruning since construction.
   */
  private prunedCount = 0;

  /**
   * Number of prune passes performed since construction.
   */
  private passCount = 0;

  /**
   * Construct a lifecycle over a store.
   *
   * The constructor wires store-event forwarding, so the lifecycle mirrors the
   * store's `'compressed'`/`'put'`, `'delete'`, `'clear'` and `'prune'` events
   * under the same names.
   *
   * @param store - the store to manage
   * @param options - construction options
   */
  constructor(store: CompressionStore, options: CompressionLifecycleOptions = {}) {
    super();
    this.store = store;
    this.maxEntries = options.maxEntries ?? 256;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    this.forwardStoreEvents();
  }

  /**
   * Forward the store's cache events under the same names.
   *
   * This keeps the lifecycle the natural single listening point: consumers
   * attach once here instead of wiring both the store and the lifecycle.
   */
  private forwardStoreEvents(): void {
    const forwarded = ['put', 'delete', 'clear', 'prune'] as const;
    for (const event of forwarded) {
      this.store.on(event, (payload: CompressionStoreEvent) => {
        this.emit(event, payload);
      });
    }
    this.store.on('put', (payload: CompressionStoreEvent) => {
      this.emit('compressed', {
        key: payload.key,
        timestamp: payload.timestamp,
        technique: (payload as { technique?: CompressionTechnique }).technique ?? 'tiered',
      } satisfies CompressedEvent);
    });
  }

  /**
   * Start the periodic prune timer.
   *
   * Repeated calls are idempotent: if the lifecycle is already running the
   * existing timer is left untouched. Each pass runs {@link CompressionLifecycle
   * .tick}.
   *
   * @param intervalMs - optional override of the configured interval
   * @returns `this`, for chaining
   */
  start(intervalMs?: number): this {
    const resolved = intervalMs && intervalMs > 0 ? intervalMs : this.intervalMs;
    if (this.timer) {
      return this;
    }
    this.timer = setInterval(() => {
      this.tick();
    }, resolved);
    return this;
  }

  /**
   * Stop the periodic prune timer.
   *
   * Idempotent; safe to call when not running.
   *
   * @returns `this`, for chaining
   */
  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  /**
   * `true` while the periodic prune timer is running.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Run a single prune pass.
   *
   * Applies {@link CompressionLifecycle.prune} against the configured
   * `maxEntries` (when a cap is set), then bumps the pass counter. Safe to call
   * manually for tests and one-off cleanups.
   *
   * @returns the number of results removed by this pass
   */
  tick(): number {
    let removed = 0;
    if (this.maxEntries > 0) {
      removed += this.prune(this.maxEntries);
    }
    this.passCount += 1;
    return removed;
  }

  /**
   * Remove the lowest-value results once the cache exceeds `maxEntries`.
   *
   * Results are ranked by *ascending* ratio — least-compressed (i.e. least
   * saved) first — so the entries that actually saved the most context
   * survive. Ties are broken by insertion order (older first). Emits a
   * `'prune'` event describing what was removed.
   *
   * @param maxEntries - the maximum cache size to enforce (clamped to a
   *   non-negative integer; `0` is a no-op)
   * @returns the number of results removed
   */
  prune(maxEntries: number): number {
    const cap = clampLength(maxEntries);
    if (cap === 0) {
      return 0;
    }
    const entries = this.store.entries();
    if (entries.length <= cap) {
      return 0;
    }
    const excess = entries.length - cap;
    const ranked = [...entries].sort((a, b) => {
      const ratioDiff = a[1].ratio - b[1].ratio;
      if (ratioDiff !== 0) {
        return ratioDiff;
      }
      return a[1].originalLength - b[1].originalLength;
    });
    const doomed = ranked.slice(0, excess);
    for (const [key] of doomed) {
      this.store.delete(key);
    }
    this.prunedCount += doomed.length;
    const at = this.now();
    this.emit('prune', {
      timestamp: at,
      removed: doomed.length,
      keys: doomed.map(([key]) => key),
    } satisfies PruneEvent);
    return doomed.length;
  }

  /**
   * Remove a single cached result by key.
   *
   * @param key - the cache key to remove
   * @returns `true` when a result existed and was removed
   */
  clearKey(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Empty the entire cache.
   *
   * Counter history (passes, pruned) is retained; all cached results are
   * dropped.
   */
  reset(): void {
    this.store.clear();
  }

  /**
   * Merge the store's counters with the lifecycle's own.
   *
   * @returns a {@link LifecycleStats} snapshot
   */
  stats(): LifecycleStats {
    const storeStats = this.store.stats();
    return {
      ...storeStats,
      pruned: this.prunedCount,
      passes: this.passCount,
      running: this.running,
      intervalMs: this.intervalMs,
    };
  }

  /**
   * The cache keys of the lowest-value results, in prune order.
   *
   * Useful for callers that want to inspect *which* results a prune would
   * remove before committing to it.
   *
   * @returns the keys sorted by ascending ratio, then ascending original
   *   length
   */
  pruneCandidates(): string[] {
    const entries = this.store.entries();
    entries.sort((a, b) => {
      const ratioDiff = a[1].ratio - b[1].ratio;
      if (ratioDiff !== 0) {
        return ratioDiff;
      }
      return a[1].originalLength - b[1].originalLength;
    });
    return entries.map(([key]) => key);
  }

  /**
   * Test whether a result is currently cached.
   *
   * @param key - the cache key to test
   * @returns `true` when the key has a cached result
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Resolve a cached result by key.
   *
   * @param key - the cache key to look up
   * @returns a copy of the cached result, or `undefined`
   */
  get(key: string): ReturnType<CompressionStore['getByKey']> {
    return this.store.getByKey(key);
  }
}