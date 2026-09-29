/**
 * @fileoverview Lifecycle orchestration for the Estimation layer.
 *
 * {@link EstimationLifecycle} binds the three estimation primitives together:
 *
 *   - {@link ./retrieval.js} `TokenEstimator`  — produces estimates
 *   - {@link ./store.js} `EstimateStore`       — caches estimates
 *   - {@link ./index.js} `EstimateIndex`       — indexes estimates
 *
 * and owns the operational concerns that none of the three should own alone:
 *
 *   - **Periodic GC**: a `setInterval`-driven sweep that prunes the cache down
 *     to its LRU cap so long-lived processes never leak memory.
 *   - **Scoped purges**: `clearFor(model)` removes every cached + indexed
 *     estimate for one model family (e.g. right after that model is
 *     recalibrated) while leaving other models untouched.
 *   - **Full reset**: `reset()` empties store and index in one consistent
 *     operation.
 *   - **Events**: `estimated`, `pruned` and `calibrated` are emitted so
 *     observability tooling (metrics, logs, dashboards) can react without
 *     coupling to the estimator internals.
 *
 * The lifecycle class extends Node's `EventEmitter`, so it can be extended
 * further by consumers that want to add their own instrumentation.
 *
 * @module estimation/lifecycle
 */

import { EventEmitter } from 'node:events';

import type { EstimateStore } from './store.js';
import type { EstimateIndex } from './index.js';
import type { TokenEstimator } from './retrieval.js';
import type {
  CalibrationSample,
  EstimationConfig,
  EstimateOptions,
  EstimationStats,
  TokenEstimate,
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
 * Options accepted by the {@link EstimationLifecycle} constructor.
 */
export interface EstimationLifecycleOptions {
  /** Estimation config forwarded to the estimator when none is supplied. */
  readonly config?: Readonly<EstimationConfig>;
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
  /** The model family that was purged, or `undefined` for a global prune. */
  readonly model?: string;
  /** Entries resident in the store before the prune. */
  readonly before: number;
  /** Entries resident in the store after the prune. */
  readonly after: number;
  /** Number of entries evicted by this prune. */
  readonly evicted: number;
  /** Reason for the prune: `'gc'`, `'manual'`, `'reset'` or `'model'`. */
  readonly reason: 'gc' | 'manual' | 'reset' | 'model';
}

/**
 * Aggregate counters describing lifecycle activity. Returned by
 * {@link EstimationLifecycle#stats}.
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
  /** Number of `estimated` events emitted. */
  readonly estimated: number;
  /** Number of `calibrated` events emitted. */
  readonly calibrated: number;
  /** Number of model-scoped clears performed. */
  readonly modelClears: number;
}

/**
 * Ties the estimator, store and index together and owns periodic GC + event
 * emission.
 *
 * The lifecycle is intentionally thin — it does not re-implement estimation or
 * caching, it *coordinates* them. All mutations flow through the injected
 * `store` / `index` / `estimator`, so an application can share one lifecycle
 * across many call sites and still observe every estimate.
 *
 * @example
 * ```ts
 * const store = new EstimateStore();
 * const index = new EstimateIndex();
 * const estimator = new TokenEstimator({ store, index });
 * const lifecycle = new EstimationLifecycle(estimator, store, index, { autoStart: true });
 *
 * lifecycle.on('estimated', (e) => metrics.observe(e.tokens));
 * const est = lifecycle.estimate('some text', { model: 'gpt-4' });
 * ```
 */
export class EstimationLifecycle extends EventEmitter {
  /** The estimator this lifecycle drives. */
  readonly estimator: TokenEstimator;

  /** The store this lifecycle prunes. */
  readonly store: EstimateStore;

  /** The index this lifecycle reconciles. */
  readonly index: EstimateIndex;

  /** Configured GC interval (ms). */
  readonly gcIntervalMs: number;

  /** Node `Timeout` handle for the periodic GC sweep, or `undefined`. */
  private gcTimer: NodeJS.Timeout | undefined;

  private counters = {
    gcSweeps: 0,
    totalEvicted: 0,
    resets: 0,
    estimated: 0,
    calibrated: 0,
    modelClears: 0,
  };

  /**
   * @param estimator - The estimator to wrap.
   * @param store - The store to prune.
   * @param index - The index to reconcile after prunes.
   * @param options - Tuning options (see {@link EstimationLifecycleOptions}).
   */
  constructor(
    estimator: TokenEstimator,
    store: EstimateStore,
    index: EstimateIndex,
    options: Readonly<EstimationLifecycleOptions> = {},
  ) {
    super();
    this.estimator = estimator;
    this.store = store;
    this.index = index;
    const rawInterval = options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS;
    if (!Number.isFinite(rawInterval) || rawInterval < MIN_GC_INTERVAL_MS) {
      throw new RangeError(
        `EstimationLifecycle: gcIntervalMs must be >= ${MIN_GC_INTERVAL_MS} (got ${String(rawInterval)})`,
      );
    }
    this.gcIntervalMs = Math.floor(rawInterval);
    if (options.autoStart === true) this.start();
  }

  /**
   * Estimate text through the wrapped estimator and emit an `estimated` event
   * carrying the produced {@link TokenEstimate}. Callers may subscribe to the
   * event to observe every estimate flowing through this lifecycle.
   *
   * @param text - The text to estimate.
   * @param options - Per-call estimate options.
   * @returns The estimate (identical to `estimator.estimate(...)`).
   */
  estimate(text: string, options: Readonly<EstimateOptions> = {}): TokenEstimate {
    const estimate = this.estimator.estimate(text, options);
    this.counters.estimated += 1;
    this.emit('estimated', estimate);
    return estimate;
  }

  /**
   * Estimate many texts, emitting one `estimated` event per result. Useful for
   * batch workloads that still want per-item observability without calling
   * {@link estimate} in a loop.
   *
   * @param texts - The texts to estimate.
   * @param options - Per-call estimate options (shared across the batch).
   * @returns One estimate per input text, in input order.
   */
  estimateMany(texts: Iterable<string>, options: Readonly<EstimateOptions> = {}): TokenEstimate[] {
    const out: TokenEstimate[] = [];
    for (const text of texts) {
      out.push(this.estimate(text, options));
    }
    return out;
  }

  /**
   * Calibrate the estimator for a model and emit a `calibrated` event carrying
   * the recorded {@link CalibrationSample}. After calibration, subsequent
   * {@link estimate} calls for that model use the measured ratio.
   *
   * @param model - Canonical model id.
   * @param sampleText - The sample text that was tokenized.
   * @param actualTokens - Ground-truth token count.
   * @param label - Optional content-type label.
   * @returns The recorded calibration sample.
   */
  calibrate(
    model: string,
    sampleText: string,
    actualTokens: number,
    label?: string,
  ): CalibrationSample {
    const sample = this.estimator.calibrate(model, sampleText, actualTokens, label);
    this.counters.calibrated += 1;
    this.emit('calibrated', sample);
    return sample;
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
    reason: 'gc' | 'manual' | 'model' | 'reset' = 'manual',
  ): number {
    const before = this.store.size;
    const keysBefore = new Set(this.store.keys());
    const evicted = this.store.prune(maxEntries);
    if (evicted > 0) {
      for (const key of keysBefore) {
        if (!this.store.has(key)) this.index.removeEstimate(key);
      }
    }
    this.counters.totalEvicted += evicted;
    this.emit('pruned', {
      model: undefined,
      before,
      after: this.store.size,
      evicted,
      reason,
    } satisfies PrunedEvent);
    return evicted;
  }

  /**
   * Remove every cached + indexed estimate belonging to one model family and
   * emit a `pruned` event with `reason: 'model'`. The estimator's calibration
   * for that model is left intact — clearing cache is not the same as forgetting
   * what was learned.
   *
   * @param model - Canonical model id to purge.
   * @returns The number of store entries removed.
   */
  clearFor(model: string): number {
    if (model === undefined || model === null || model === '') return 0;
    const before = this.store.size;
    const removed = this.store.deleteForModel(model);
    const indexedRemoved = this.index.removeForModel(model);
    this.counters.modelClears += 1;
    this.counters.totalEvicted += removed;
    this.emit('pruned', {
      model,
      before,
      after: this.store.size,
      evicted: removed,
      reason: 'model',
    } satisfies PrunedEvent);
    return Math.max(removed, indexedRemoved);
  }

  /**
   * Empty both the store and the index, emit a `pruned` event with
   * `reason: 'reset'`, and increment the reset counter. Estimation calibration
   * in the estimator is preserved so a reset is a *cache* reset, not a
   * knowledge reset.
   */
  reset(): void {
    const before = this.store.size;
    this.store.clear();
    this.index.clear();
    this.counters.resets += 1;
    this.counters.totalEvicted += before;
    this.emit('pruned', {
      model: undefined,
      before,
      after: 0,
      evicted: before,
      reason: 'reset',
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
        `EstimationLifecycle#start: intervalMs must be >= ${MIN_GC_INTERVAL_MS} (got ${String(intervalMs)})`,
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
   * out of sync. Returns the number of estimates indexed.
   */
  reconcile(): number {
    const estimates: TokenEstimate[] = [];
    for (const key of this.store.keys()) {
      const estimate = this.store.get(key);
      if (estimate) estimates.push(estimate);
    }
    this.index.rebuild(estimates);
    return estimates.length;
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
      estimated: this.counters.estimated,
      calibrated: this.counters.calibrated,
      modelClears: this.counters.modelClears,
    };
  }

  /**
   * Snapshot of the store's own health counters, forwarded for convenience so
   * callers only need to hold the lifecycle reference.
   *
   * @returns {@link EstimationStats} from the wrapped store.
   */
  storeStats(): EstimationStats {
    return this.store.stats();
  }

  /**
   * Persist the full runtime state (cache + index + calibration) to a
   * JSON-friendly snapshot. The snapshot carries the store's estimate list and
   * the estimator's calibration table; profiles are not included (they are
   * configuration, not state).
   *
   * @returns A serializable snapshot.
   */
  toJSON(): {
    version: 1;
    store: ReturnType<EstimateStore['toJSON']>;
    index: ReturnType<EstimateIndex['toJSON']>;
    estimator: ReturnType<TokenEstimator['toJSON']>;
  } {
    return {
      version: 1,
      store: this.store.toJSON(),
      index: this.index.toJSON(),
      estimator: this.estimator.toJSON(),
    };
  }

  /**
   * Restore runtime state from a snapshot produced by {@link toJSON}. Store and
   * index are repopulated and reconciled; calibration is forwarded into the
   * estimator. GC timer state is NOT restored — callers re-arm with {@link start}.
   *
   * @param snapshot - Snapshot to restore from.
   * @returns The number of estimates restored into the store.
   */
  fromJSON(snapshot: {
    version: 1;
    store: ReturnType<EstimateStore['toJSON']>;
    index: ReturnType<EstimateIndex['toJSON']>;
    estimator: ReturnType<TokenEstimator['toJSON']>;
  }): number {
    if (!snapshot || snapshot.version !== 1) {
      throw new TypeError('EstimationLifecycle#fromJSON: unsupported snapshot version');
    }
    this.stop();
    const restored = this.store.fromJSON(snapshot.store);
    this.index.fromJSON(snapshot.index);
    this.reconcile();
    if (snapshot.estimator?.calibration) {
      for (const [model, samples] of Object.entries(snapshot.estimator.calibration)) {
        for (const sample of samples) this.estimator.calibrate(model, sample.text, sample.actualTokens, sample.label);
      }
    }
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