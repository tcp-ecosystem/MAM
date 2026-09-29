/**
 * @fileoverview Lifecycle orchestration for the Compression layer.
 *
 * {@link CompressionLifecycle} binds the three compression primitives together:
 *
 *   - {@link ./retrieval.js} `TokenCompressor`   — produces compressed text
 *   - {@link ./store.js} `CompressionStore`      — caches compression results
 *   - {@link ./index.js} `CompressionIndex`      — indexes compression results
 *
 * and owns the operational concerns that none of the three should own alone:
 *
 *   - **Periodic GC**: a `setInterval`-driven sweep that prunes the cache down
 *     to its LRU cap so long-lived processes never leak memory.
 *   - **Scoped purges**: `prune(maxEntries)` evicts the stalest results and
 *     reconciles the index so it never references evicted keys.
 *   - **Clear / reset**: `clear()` empties store and index in one consistent
 *     operation; `reset()` additionally zeroes the lifecycle counters so a
 *     process can be re-used as if freshly constructed.
 *   - **Events**: `compressed` and `pruned` are emitted so observability
 *     tooling (metrics, logs, dashboards) can react without coupling to the
 *     compressor internals.
 *
 * The lifecycle class extends Node's `EventEmitter`, so it can be extended
 * further by consumers that want to add their own instrumentation.
 *
 * @module compression/lifecycle
 */

import { EventEmitter } from 'node:events';

import type { CompressionStore } from './store.js';
import type { CompressionIndex } from './index.js';
import type { TokenCompressor } from './retrieval.js';
import type {
  CompressConfig,
  CompressOptions,
  CompressionResult,
  CompressionStats,
} from './types.js';

/**
 * Default interval (ms) between periodic cache-GC sweeps. 60 seconds is
 * conservative: pruning is cheap, but we don't want to churn a hot cache.
 */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/**
 * Minimum allowed GC interval (ms). Values below this are rejected to prevent
 * accidental timer storms.
 */
export const MIN_GC_INTERVAL_MS = 250;

/**
 * Options accepted by the {@link CompressionLifecycle} constructor.
 */
export interface CompressionLifecycleOptions {
  /**
   * Compression config forwarded to the compressor when none is supplied.
   */
  readonly config?: Readonly<CompressConfig>;
  /** Interval (ms) between periodic GC sweeps. Defaults to 60_000. */
  readonly gcIntervalMs?: number;
  /**
   * Whether to begin the periodic GC timer immediately. Defaults to `false`;
   * callers start the sweep explicitly with {@link start} (or `autoStart`).
   */
  readonly autoStart?: boolean;
}

/**
 * Payload carried by the `pruned` event.
 */
export interface PrunedEvent {
  /** Entries resident in the store before the prune. */
  readonly before: number;
  /** Entries resident in the store after the prune. */
  readonly after: number;
  /** Number of entries evicted by this prune. */
  readonly evicted: number;
  /** Reason for the prune: `'gc'`, `'manual'`, `'clear'` or `'reset'`. */
  readonly reason: 'gc' | 'manual' | 'clear' | 'reset';
  /** Cumulative saved tokens of the entries that were evicted. */
  readonly evictedSavedTokens: number;
}

/**
 * Aggregate counters describing lifecycle activity. Returned by
 * {@link CompressionLifecycle#stats}.
 */
export interface LifecycleStats {
  /** Whether the periodic GC timer is currently armed. */
  readonly running: boolean;
  /** Number of periodic GC sweeps performed. */
  readonly gcSweeps: number;
  /** Total entries evicted across all prunes. */
  readonly totalEvicted: number;
  /** Number of times {@link reset} was called. */
  readonly resets: number;
  /** Number of times {@link clear} was called. */
  readonly clears: number;
  /** Number of `compressed` events emitted. */
  readonly compressed: number;
  /** Number of `pruned` events emitted. */
  readonly pruned: number;
}

/**
 * Ties the compressor, store and index together and owns periodic GC + event
 * emission.
 *
 * The lifecycle is intentionally thin — it does not re-implement compression
 * or caching, it *coordinates* them. All mutations flow through the injected
 * `compressor` / `store` / `index`, so an application can share one lifecycle
 * across many call sites and still observe every compression.
 *
 * @example
 * ```ts
 * const store = new CompressionStore();
 * const index = new CompressionIndex();
 * const compressor = new TokenCompressor({ store, index });
 * const lifecycle = new CompressionLifecycle(compressor, store, index, { autoStart: true });
 *
 * lifecycle.on('compressed', (result) => metrics.observe(result.savedTokens));
 * const result = lifecycle.compress('some long text');
 * ```
 */
export class CompressionLifecycle extends EventEmitter {
  /** The compressor this lifecycle drives. */
  readonly compressor: TokenCompressor;

  /** The store this lifecycle prunes. */
  readonly store: CompressionStore;

  /** The index this lifecycle reconciles. */
  readonly index: CompressionIndex;

  /** Configured GC interval (ms). */
  readonly gcIntervalMs: number;

  /** Node `Timeout` handle for the periodic GC sweep, or `undefined`. */
  private gcTimer: NodeJS.Timeout | undefined;

  private counters = {
    gcSweeps: 0,
    totalEvicted: 0,
    resets: 0,
    clears: 0,
    compressed: 0,
    pruned: 0,
  };

  /**
   * @param compressor - The compressor to wrap.
   * @param store - The store to prune.
   * @param index - The index to reconcile after prunes.
   * @param options - Tuning options (see {@link CompressionLifecycleOptions}).
   */
  constructor(
    compressor: TokenCompressor,
    store: CompressionStore,
    index: CompressionIndex,
    options: Readonly<CompressionLifecycleOptions> = {},
  ) {
    super();
    this.compressor = compressor;
    this.store = store;
    this.index = index;
    const rawInterval = options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS;
    if (!Number.isFinite(rawInterval) || rawInterval < MIN_GC_INTERVAL_MS) {
      throw new RangeError(
        `CompressionLifecycle: gcIntervalMs must be >= ${MIN_GC_INTERVAL_MS} (got ${String(rawInterval)})`,
      );
    }
    this.gcIntervalMs = Math.floor(rawInterval);
    if (options.autoStart === true) this.start();
  }

  /**
   * Compress text through the wrapped compressor and emit a `compressed`
   * event carrying the produced {@link CompressionResult}. Results are cached
   * and indexed by the compressor itself (subject to per-call `useCache`);
   * this method only adds observability.
   *
   * @param text - The text to compress.
   * @param options - Per-call compression options.
   * @returns The compression result (identical to `compressor.compress(...)`).
   */
  compress(text: string, options: Readonly<CompressOptions> = {}): CompressionResult {
    const result = this.compressor.compress(text, options);
    this.counters.compressed += 1;
    this.emit('compressed', result);
    return result;
  }

  /**
   * Compress many texts, emitting one `compressed` event per result. Useful
   * for batch workloads that still want per-item observability without calling
   * {@link compress} in a loop.
   *
   * @param texts - The texts to compress.
   * @param options - Per-call compression options (shared across the batch).
   * @returns One compression result per input text, in input order.
   */
  compressMany(
    texts: Iterable<string>,
    options: Readonly<CompressOptions> = {},
  ): CompressionResult[] {
    const out: CompressionResult[] = [];
    for (const text of texts) {
      out.push(this.compress(text, options));
    }
    return out;
  }

  /**
   * Prune the store down to `maxEntries` (defaults to the store's own cap),
   * reconciling the index so it no longer references evicted entries, and emit
   * a `pruned` event describing the sweep.
   *
   * @param maxEntries - Maximum entries after pruning; defaults to
   *   `store.maxEntries`.
   * @param reason - Why the prune happened (defaults to `'manual'`).
   * @returns The number of entries evicted.
   */
  prune(
    maxEntries: number = this.store.maxEntries,
    reason: 'gc' | 'manual' = 'manual',
  ): number {
    const before = this.store.size;
    const keysBefore = new Set(this.store.keys());
    const savedBefore = this.store.totalSavedTokens();
    const evicted = this.store.prune(maxEntries);
    if (evicted > 0) {
      for (const key of keysBefore) {
        if (!this.store.has(key)) this.index.removeResult(key);
      }
    }
    const savedAfter = this.store.totalSavedTokens();
    this.counters.totalEvicted += evicted;
    this.counters.pruned += 1;
    this.emit('pruned', {
      before,
      after: this.store.size,
      evicted,
      reason,
      evictedSavedTokens: Math.max(0, savedBefore - savedAfter),
    } satisfies PrunedEvent);
    return evicted;
  }

  /**
   * Empty both the store and the index and emit a `pruned` event with
   * `reason: 'clear'`. Lifetime counters are preserved so callers can still
   * compute aggregate throughput across clears.
   */
  clear(): void {
    const before = this.store.size;
    const savedBefore = this.store.totalSavedTokens();
    this.store.clear();
    this.index.clear();
    this.counters.clears += 1;
    this.counters.totalEvicted += before;
    this.counters.pruned += 1;
    this.emit('pruned', {
      before,
      after: 0,
      evicted: before,
      reason: 'clear',
      evictedSavedTokens: savedBefore,
    } satisfies PrunedEvent);
  }

  /**
   * Full reset: empty store and index AND zero every lifecycle counter so the
   * instance behaves as if freshly constructed. Emits a `pruned` event with
   * `reason: 'reset'`.
   */
  reset(): void {
    const before = this.store.size;
    const savedBefore = this.store.totalSavedTokens();
    this.store.clear();
    this.index.clear();
    this.counters = {
      gcSweeps: 0,
      totalEvicted: 0,
      resets: 0,
      clears: 0,
      compressed: 0,
      pruned: 0,
    };
    this.counters.resets += 1;
    this.counters.totalEvicted += before;
    this.counters.pruned += 1;
    this.emit('pruned', {
      before,
      after: 0,
      evicted: before,
      reason: 'reset',
      evictedSavedTokens: savedBefore,
    } satisfies PrunedEvent);
  }

  /**
   * Start the periodic GC timer. Safe to call when already running (no-op).
   * Each sweep prunes the store to its cap with `reason: 'gc'` and increments
   * the sweep counter.
   *
   * @param intervalMs - Override the GC interval for this run (must be >=
   *   {@link MIN_GC_INTERVAL_MS}). Defaults to the constructor value.
   */
  start(intervalMs: number = this.gcIntervalMs): void {
    if (this.gcTimer !== undefined) return;
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_GC_INTERVAL_MS) {
      throw new RangeError(
        `CompressionLifecycle#start: intervalMs must be >= ${MIN_GC_INTERVAL_MS} (got ${String(intervalMs)})`,
      );
    }
    this.gcTimer = setInterval(() => {
      this.counters.gcSweeps += 1;
      this.prune(this.store.maxEntries, 'gc');
    }, Math.floor(intervalMs));
    if (typeof this.gcTimer.unref === 'function') this.gcTimer.unref();
  }

  /**
   * Stop the periodic GC timer. Safe to call when not running (no-op).
   *
   * @returns `true` if a timer was actually cleared.
   */
  stop(): boolean {
    if (this.gcTimer === undefined) return false;
    clearInterval(this.gcTimer);
    this.gcTimer = undefined;
    return true;
  }

  /**
   * Whether the periodic GC timer is currently armed.
   */
  get running(): boolean {
    return this.gcTimer !== undefined;
  }

  /**
   * Convenience: forward a manual prune using the store's configured cap.
   * Identical to calling {@link prune} with defaults. Present so callers can
   * invoke a sweep on demand without remembering the signature.
   *
   * @returns The number of entries evicted.
   */
  sweep(): number {
    return this.prune(this.store.maxEntries, 'gc');
  }

  /**
   * Run one reconciliation pass: make the index exactly mirror the store by
   * re-indexing the store's contents. This is the repair operation for cases
   * where external code mutated the store (or index) directly and the two fell
   * out of sync. Returns the number of results indexed.
   */
  reconcile(): number {
    const results: CompressionResult[] = [];
    for (const key of this.store.keys()) {
      const result = this.store.get(key);
      if (result) results.push(result);
    }
    this.index.rebuild(results);
    return results.length;
  }

  /**
   * Aggregate counters describing this lifecycle's activity.
   *
   * @returns A fresh {@link LifecycleStats} snapshot.
   */
  stats(): LifecycleStats {
    return {
      running: this.running,
      gcSweeps: this.counters.gcSweeps,
      totalEvicted: this.counters.totalEvicted,
      resets: this.counters.resets,
      clears: this.counters.clears,
      compressed: this.counters.compressed,
      pruned: this.counters.pruned,
    };
  }

  /**
   * Snapshot of the store's own health counters, forwarded for convenience so
   * callers only need to hold the lifecycle reference.
   *
   * @returns {@link CompressionStats} from the wrapped store.
   */
  storeStats(): CompressionStats {
    return this.store.stats();
  }

  /**
   * Persist the full runtime state (store + index) to a JSON-friendly
   * snapshot. The snapshot carries the store's result list and the index's
   * result list; configuration is not included (it is configuration, not
   * state).
   *
   * @returns A serializable snapshot.
   */
  toJSON(): {
    version: 1;
    store: ReturnType<CompressionStore['toJSON']>;
    index: ReturnType<CompressionIndex['toJSON']>;
  } {
    return {
      version: 1,
      store: this.store.toJSON(),
      index: this.index.toJSON(),
    };
  }

  /**
   * Restore runtime state from a snapshot produced by {@link toJSON}. Store and
   * index are repopulated and reconciled. GC timer state is NOT restored —
   * callers re-arm with {@link start}.
   *
   * @param snapshot - Snapshot to restore from.
   * @returns The number of results restored into the store.
   */
  fromJSON(snapshot: {
    version: 1;
    store: ReturnType<CompressionStore['toJSON']>;
    index: ReturnType<CompressionIndex['toJSON']>;
  }): number {
    if (!snapshot || snapshot.version !== 1) {
      throw new TypeError('CompressionLifecycle#fromJSON: unsupported snapshot version');
    }
    this.stop();
    const restored = this.store.fromJSON(snapshot.store);
    this.index.fromJSON(snapshot.index);
    this.reconcile();
    return restored;
  }

  /**
   * Release resources held by this lifecycle: stop the GC timer and remove all
   * event listeners so the instance can be garbage collected. Idempotent.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}