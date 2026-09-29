/**
 * Lifecycle management for the Summarization layer of the standalone MAM
 * Context Engine.
 *
 * {@link SummarizationLifecycle} keeps a long-running process's summarization
 * cache *bounded and tidy*. Left alone, a result store grows an entry for every
 * document that was ever summarised; over a long-lived server that can mean
 * thousands of near-useless digests. The lifecycle's job is to periodically
 * sweep that cache, prune the least-valuable entries, forward store activity as
 * high-level events, and keep counters fresh.
 *
 * Responsibilities:
 *
 * - **Prune** — {@link SummarizationLifecycle.prune} removes the least-valuable
 *   cached results once the cache exceeds {@link SummarizationLifecycle
 *   .maxEntries}, preserving the digests that actually compress well, carry key
 *   points, and were used recently.
 * - **Reset** — {@link SummarizationLifecycle.clearKey} drops a single entry;
 *   {@link SummarizationLifecycle.reset} clears the whole cache and resets the
 *   lifecycle's counters.
 * - **Run** — {@link SummarizationLifecycle.start} / {@link SummarizationLifecycle
 *   .stop} run a periodic prune on a timer; {@link SummarizationLifecycle.tick}
 *   performs a single manual pass for tests and one-off invocations.
 * - **Observe** — the lifecycle re-emits the store's activity as `'summarized'`,
 *   `'removed'`, `'cleared'` and `'restored'` events and adds its own `'prune'`
 *   event, so a single listener can observe the whole subsystem.
 * - **Inspect** — {@link SummarizationLifecycle.stats} merges the store's
 *   counters with the lifecycle's own (prunes performed, passes, running state)
 *   and {@link SummarizationLifecycle.candidates} previews the eviction order.
 *
 * The lifecycle extends `node:events`' `EventEmitter`. Wiring to the store's
 * events happens in the constructor, so callers get forwarded events for free
 * and need not listen to both objects.
 *
 * @module summarization/lifecycle
 */

import { EventEmitter } from 'node:events';

import { SummarizationStore } from './store.js';
import type { SummarizationStoreEntry } from './store.js';
import { clampLength } from './types.js';
import type {
  SummarizationStats,
  SummaryResult,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link SummarizationLifecycle}.
 */
export interface SummarizationLifecycleOptions {
  /**
   * Maximum number of cached results kept before {@link SummarizationLifecycle
   * .prune} starts removing the least-valuable entries. Defaults to
   * `DEFAULT_MAX_ENTRIES` (`256`). `0` disables the cap entirely.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic prune passes while running.
   * Defaults to `DEFAULT_PRUNE_INTERVAL_MS` (`60_000`).
   */
  readonly intervalMs?: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the lifecycle
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Default maximum number of cached results kept by a
 * {@link SummarizationLifecycle}.
 */
export const DEFAULT_MAX_ENTRIES = 256;

/**
 * Default interval in milliseconds between automatic prune passes.
 */
export const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

/**
 * The lifecycle's own statistics, merged with the store's.
 */
export interface LifecycleStats extends SummarizationStats {
  /**
   * Number of results removed by pruning since construction.
   */
  readonly pruned: number;

  /**
   * Number of prune passes performed (manual {@link SummarizationLifecycle
   * .tick} calls plus automatic timer ticks) since construction.
   */
  readonly passes: number;

  /**
   * `true` while the periodic prune timer is running.
   */
  readonly running: boolean;

  /**
   * Interval in milliseconds between automatic prune passes.
   */
  readonly intervalMs: number;

  /**
   * Maximum number of cached results kept before pruning starts (`0` =
   * unbounded).
   */
  readonly maxEntries: number;
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
   * Number of cached results removed.
   */
  readonly removed: number;

  /**
   * Keys of the results that were removed.
   */
  readonly keys: readonly string[];
}

/**
 * Payload emitted by the lifecycle's `'summarized'` event (forwarded from the
 * store's `'put'`).
 */
export interface SummarizedEvent {
  /**
   * The cache key the result was stored under.
   */
  readonly key: string;

  /**
   * The stored {@link SummaryResult}.
   */
  readonly result: SummaryResult;

  /**
   * Epoch-millisecond time the result was stored.
   */
  readonly timestamp: Timestamp;
}

/**
 * The summarization lifecycle manager.
 *
 * See the module documentation for the full responsibility list. The lifecycle
 * observes a single {@link SummarizationStore}; all prune/clear operations are
 * applied through the store so it remains the single source of truth.
 *
 * @example
 * ```ts
 * const lifecycle = new SummarizationLifecycle(store, { maxEntries: 128 });
 * lifecycle.on('summarized', (e) => log(`digest for ${e.key}`));
 * lifecycle.on('prune', (e) => log(`pruned ${e.removed} digests`));
 * lifecycle.start();          // periodic prune every 60s
 * lifecycle.stop();
 * ```
 */
export class SummarizationLifecycle extends EventEmitter {
  /**
   * The store this lifecycle manages.
   */
  readonly store: SummarizationStore;

  /**
   * Maximum number of cached results kept before pruning starts (`0` =
   * unbounded).
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
   * store's `'put'`, `'delete'`, `'clear'` and `'restore'` events under the
   * more descriptive names `'summarized'`, `'removed'`, `'cleared'` and
   * `'restored'`.
   *
   * @param store - the store to manage
   * @param options - construction options
   */
  constructor(
    store: SummarizationStore,
    options: SummarizationLifecycleOptions = {},
  ) {
    super();
    this.store = store;
    this.maxEntries =
      options.maxEntries !== undefined && options.maxEntries > 0
        ? Math.floor(options.maxEntries)
        : DEFAULT_MAX_ENTRIES;
    this.intervalMs =
      options.intervalMs !== undefined && options.intervalMs > 0
        ? Math.floor(options.intervalMs)
        : DEFAULT_PRUNE_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.forwardStoreEvents();
  }

  /**
   * Forward the store's activity events under descriptive names.
   *
   * The store emits `'put'`, `'delete'`, `'clear'` and `'restore'`; the
   * lifecycle re-emits them as `'summarized'`, `'removed'`, `'cleared'` and
   * `'restored'`. The `'summarized'` payload additionally carries the stored
   * {@link SummaryResult}, resolved from the store at emission time.
   */
  private forwardStoreEvents(): void {
    this.store.on('put', (payload: { key: string; timestamp: Timestamp }) => {
      const result = this.store.get(payload.key);
      if (result) {
        this.emit('summarized', {
          key: payload.key,
          result,
          timestamp: payload.timestamp,
        } satisfies SummarizedEvent);
      }
    });
    this.store.on('delete', (payload: { key: string; timestamp: Timestamp }) => {
      this.emit('removed', payload);
    });
    this.store.on('clear', (payload: { key: string; timestamp: Timestamp }) => {
      this.emit('cleared', payload);
    });
    this.store.on('restore', (payload: { key: string; timestamp: Timestamp }) => {
      this.emit('restored', payload);
    });
  }

  /**
   * Start the periodic prune timer.
   *
   * Repeated calls are idempotent: if the lifecycle is already running the
   * existing timer is left untouched (a different interval restarts it). Each
   * pass runs {@link SummarizationLifecycle.tick}.
   *
   * @param intervalMs - optional override of the configured interval
   * @returns `this`, for chaining
   */
  start(intervalMs?: number): this {
    const resolved =
      intervalMs !== undefined && intervalMs > 0
        ? Math.floor(intervalMs)
        : this.intervalMs;
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
   * When {@link SummarizationLifecycle.maxEntries} is `> 0`, evicts enough
   * least-valuable results to bring the cache back under the cap, then bumps
   * the pass counter. Safe to call manually for tests and one-off cleanups.
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
   * Remove the least-valuable cached results once the cache exceeds
   * `maxEntries`.
   *
   * Each entry is scored by {@link SummarizationLifecycle.valueOf} — a digest
   * is more valuable when it compresses hard (low ratio), carries key points,
   * and is reasonably long — and ties are broken by recency (`updatedAt`, older
   * first). The lowest-scored excess entries are evicted through the store.
   * Emits a `'prune'` event describing what was removed.
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
    entries.sort((a, b) => {
      const valueDiff = this.valueOf(a) - this.valueOf(b);
      if (valueDiff !== 0) {
        return valueDiff;
      }
      return a.updatedAt - b.updatedAt;
    });
    const doomed = entries.slice(0, excess);
    const keys = doomed.map((entry) => entry.key);
    for (const key of keys) {
      this.store.delete(key);
    }
    this.prunedCount += keys.length;
    const at = this.now();
    this.emit('prune', {
      timestamp: at,
      removed: keys.length,
      keys,
    } satisfies PruneEvent);
    return keys.length;
  }

  /**
   * Score an entry for eviction ordering; lower scores are evicted first.
   *
   * `ratio × 2` penalises digests that barely compress; each key point grants
   * up to `0.5` back; a digest at or beyond ~500 characters grants up to `0.5`
   * back. Recency is applied as a tie-breaker by {@link SummarizationLifecycle
   * .prune}, not here.
   *
   * @param entry - the entry to score
   * @returns the eviction value (lower = more expendable)
   */
  private valueOf(entry: SummarizationStoreEntry): number {
    const keyPointBonus = Math.min(1, entry.result.keyPoints?.length ?? 0) * 0.5;
    const lengthBonus = Math.min(1, entry.result.summaryLength / 500) * 0.5;
    return entry.result.ratio * 2 - keyPointBonus - lengthBonus;
  }

  /**
   * Remove a single cached result.
   *
   * Delegates to {@link SummarizationStore.delete}; the store emits `'delete'`,
   * which the lifecycle forwards as `'removed'`.
   *
   * @param key - the cache key to remove
   * @returns `true` when an entry existed and was removed
   */
  clearKey(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear the whole cache and reset the lifecycle's counters.
   *
   * The store emits `'clear'` (forwarded as `'cleared'`). `prunedCount` and
   * `passCount` are reset so a fresh monitoring window starts clean.
   */
  reset(): void {
    this.store.clear();
    this.prunedCount = 0;
    this.passCount = 0;
  }

  /**
   * The cache keys in eviction order (least valuable first).
   *
   * A preview of which entries {@link SummarizationLifecycle.prune} would remove
   * next, for callers that want to inspect before committing.
   *
   * @returns the keys sorted ascending by eviction value, then age
   */
  candidates(): string[] {
    const entries = this.store.entries();
    entries.sort((a, b) => {
      const valueDiff = this.valueOf(a) - this.valueOf(b);
      if (valueDiff !== 0) {
        return valueDiff;
      }
      return a.updatedAt - b.updatedAt;
    });
    return entries.map((entry) => entry.key);
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
      maxEntries: this.maxEntries,
    };
  }
}