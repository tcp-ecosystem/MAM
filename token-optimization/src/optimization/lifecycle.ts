/**
 * @file lifecycle.ts
 * @module optimization/lifecycle
 *
 * {@link OptimizationLifecycle}: the supervisory shell around the
 * Optimization engine.
 *
 * The optimizer ({@link PromptOptimizer}, `retrieval.ts`) is a pure,
 * stateless orchestration engine, and the store/index (`store.ts`,
 * `index.ts`) are passive data structures. The lifecycle wires them together
 * and adds the operational concerns a long-lived service needs:
 *
 *  - **Events** — `optimized`, `analyzed`, `pruned`, `cleared` and `reset`,
 *    delivered on a typed {@link EventEmitter}.
 *  - **Cache wiring** — every {@link optimize} call stores its result in the
 *    content-addressed {@link OptimizationStore} and classifies it in the
 *    {@link OptimizationIndex}, so identical prompts short-circuit on the
 *    next call.
 *  - **Periodic GC** — {@link start}/{@link stop} run a timer that evicts
 *    idle entries and prunes the cache back to its cap.
 *  - **Housekeeping** — {@link prune} shrinks the cache on demand,
 *    {@link clear} drops the cache and {@link reset} returns the whole
 *    lifecycle to its initial state.
 *
 * The lifecycle is the only Optimization entry point that should be
 * constructed once and shared process-wide.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';

import { OptimizationStore, contentHash } from './store.js';
import { OptimizationIndex } from './index.js';
import {
  PromptOptimizer,
  type OptimizerOptions,
  joinSections,
} from './retrieval.js';
import type {
  AnalysisResult,
  OptimizeOptions,
  OptimizeResult,
  OptimizationConfig,
  OptimizationStats,
  PromptSection,
} from './types.js';

import {
  clampPercent,
  createOptimizationStats,
  isOptimizeOptions,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------ */

/**
 * Event names emitted by {@link OptimizationLifecycle}. Import this object
 * to subscribe without string literals.
 */
export const OPTIMIZATION_EVENTS = {
  /** Emitted after an optimization completes (cache hit or full run). */
  optimized: 'optimized',
  /** Emitted after an analysis completes. */
  analyzed: 'analyzed',
  /** Emitted when the cache was pruned (on demand or by the GC timer). */
  pruned: 'pruned',
  /** Emitted after {@link OptimizationLifecycle.clear}. */
  cleared: 'cleared',
  /** Emitted after {@link OptimizationLifecycle.reset}. */
  reset: 'reset',
} as const;

/**
 * Default periodic GC interval (milliseconds).
 */
export const DEFAULT_GC_INTERVAL_MS = 30_000;

/**
 * Default maximum cache size enforced by the periodic GC.
 */
export const DEFAULT_MAX_ENTRIES = 512;

/**
 * Default idle time (milliseconds) after which an entry is evicted by the GC
 * even if the cache is below its cap.
 */
export const DEFAULT_IDLE_TTL_MS = 600_000;

/* ------------------------------------------------------------------------ *
 * Typed event map & shapes
 * ------------------------------------------------------------------------ */

/**
 * Typed event payloads. Each key maps to the argument tuple emitted for that
 * event, giving subscribers full type-safety via `on(...)`.
 */
export interface OptimizationLifecycleEvents {
  /** The result plus whether it came from the cache. */
  optimized: [{ result: OptimizeResult; cached: boolean }];
  /** The completed {@link AnalysisResult}. */
  analyzed: [analysis: AnalysisResult];
  /** Summary returned by {@link OptimizationLifecycle.prune}. */
  pruned: [summary: PruneSummary];
  /** Number of entries dropped by {@link OptimizationLifecycle.clear}. */
  cleared: [removed: number];
  /** The (now empty) lifecycle instance after a full reset. */
  reset: [lifecycle: OptimizationLifecycle];
}

/**
 * Result of a {@link OptimizationLifecycle.prune} run.
 */
export interface PruneSummary {
  /** Number of entries removed. */
  removed: number;
  /** Number of entries remaining afterwards. */
  remaining: number;
  /** The target cap the prune ran against. */
  target: number;
  /** Number of entries removed purely because they were idle. */
  idleRemoved: number;
}

/**
 * Constructor options for {@link OptimizationLifecycle}.
 */
export interface LifecycleOptions extends OptimizerOptions {
  /** Initial cache cap (also used as the GC's prune target). */
  cacheCap?: number;
  /** Periodic GC interval in milliseconds. */
  gcIntervalMs?: number;
  /** Max cache entries the periodic GC enforces. */
  maxEntries?: number;
  /** Idle time (ms) after which the GC evicts an entry. */
  idleTtlMs?: number;
  /** When `true`, the periodic GC timer starts immediately. */
  autoStart?: boolean;
}

/* ------------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------------ */

/**
 * Supervisory shell that wires a {@link PromptOptimizer} to an
 * {@link OptimizationStore} and {@link OptimizationIndex}, adds typed
 * events, and runs a periodic cache-GC timer.
 *
 * Usage:
 * ```ts
 * const lifecycle = new OptimizationLifecycle({ maxTotalTokens: 4096 });
 * lifecycle.on('optimized', ({ result }) => logger.info(result));
 * lifecycle.start(); // GC every 30s
 * const result = lifecycle.optimize(promptSections);
 * ```
 */
export class OptimizationLifecycle extends EventEmitter {
  /** The pure optimization engine. */
  private readonly _optimizer: PromptOptimizer;
  /** The content-addressed result cache. */
  private readonly _store: OptimizationStore;
  /** The query-oriented result index. */
  private readonly _index: OptimizationIndex;
  /** Periodic GC timer handle (`null` when stopped). */
  private _timer: NodeJS.Timeout | null;
  /** GC interval in milliseconds. */
  private _gcIntervalMs: number;
  /** Max cache entries enforced by the GC. */
  private _maxEntries: number;
  /** Idle TTL (ms) enforced by the GC. */
  private _idleTtlMs: number;

  /** Lifetime analysis counter. */
  private _analyzed: number;
  /** Lifetime full-optimization counter. */
  private _optimized: number;
  /** Lifetime cache-hit counter. */
  private _cached: number;
  /** Cumulative original tokens. */
  private _totalOriginalTokens: number;
  /** Cumulative optimized tokens. */
  private _totalOptimizedTokens: number;
  /** Cumulative saved tokens. */
  private _totalSavedTokens: number;
  /** Cumulative saved-percent (for averaging). */
  private _savedPercentSum: number;

  /**
   * Creates a lifecycle.
   *
   * @param config - partial optimization config for the underlying optimizer.
   * @param options - lifecycle tuning ({@link LifecycleOptions}).
   */
  constructor(config: Partial<OptimizationConfig> = {}, options: LifecycleOptions = {}) {
    super();
    this._optimizer = new PromptOptimizer(config, { charsPerToken: options.charsPerToken });
    this._store = new OptimizationStore(options.cacheCap);
    this._index = new OptimizationIndex();
    this._timer = null;
    this._gcIntervalMs = Math.max(
      10,
      Math.floor(options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS),
    );
    this._maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this._idleTtlMs = Math.max(0, Math.floor(options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS));
    this._analyzed = 0;
    this._optimized = 0;
    this._cached = 0;
    this._totalOriginalTokens = 0;
    this._totalOptimizedTokens = 0;
    this._totalSavedTokens = 0;
    this._savedPercentSum = 0;
    if (options.autoStart === true) this.start();
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The underlying optimization engine, exposed for advanced callers.
   */
  get optimizer(): PromptOptimizer {
    return this._optimizer;
  }

  /**
   * The content-addressed result cache.
   */
  get store(): OptimizationStore {
    return this._store;
  }

  /**
   * The query-oriented result index.
   */
  get index(): OptimizationIndex {
    return this._index;
  }

  /**
   * `true` while the periodic GC timer is running.
   */
  get running(): boolean {
    return this._timer !== null;
  }

  /* -------------------------------------------------------------------- *
   * Pipeline delegation (with events)
   * -------------------------------------------------------------------- */

  /**
   * Delegates to {@link PromptOptimizer.analyze} and emits `analyzed`.
   *
   * @param sections - the prompt sections to analyze.
   * @param options - per-call overrides ({@link OptimizeOptions}).
   */
  analyze(sections: readonly PromptSection[], options: OptimizeOptions = {}): AnalysisResult {
    const result = this._optimizer.analyze(sections, options);
    this._analyzed += 1;
    this.emit(OPTIMIZATION_EVENTS.analyzed, result);
    return result;
  }

  /**
   * Optimizes a prompt, caches the result (content-addressed) and indexes it.
   *
   * When the underlying optimizer short-circuits on a cache hit, the result
   * is returned as-is and counted as a cache hit rather than a full
   * optimization. Either way an `optimized` event is emitted with the
   * `cached` flag set accordingly.
   *
   * @param sections - the prompt sections to optimize.
   * @param options - per-call overrides ({@link OptimizeOptions}).
   */
  optimize(sections: readonly PromptSection[], options: OptimizeOptions = {}): OptimizeResult {
    const result = this._optimizer.optimize(sections, {
      ...options,
      cache: options.cache ?? this._store,
    });
    this._optimized += 1;
    this._totalOriginalTokens += result.originalTokens;
    this._totalOptimizedTokens += result.optimizedTokens;
    this._totalSavedTokens += result.savedTokens;
    this._savedPercentSum += result.savedPercent;

    if (result.applied.includes('cache')) {
      this._cached += 1;
      this.emit(OPTIMIZATION_EVENTS.optimized, { result, cached: true });
      return result;
    }

    const text = joinSections(sections, options.sectionSeparator);
    const key = `opt:${contentHash(text)}`;
    this._store.put(key, result, { sourceText: text });
    this._index.indexResult(key, result);
    this.emit(OPTIMIZATION_EVENTS.optimized, { result, cached: false });
    return result;
  }

  /**
   * Content-addressed cache lookup directly on the store (no analysis or
   * optimization performed).
   */
  getFor(text: string): OptimizeResult | undefined {
    return this._store.getFor(text);
  }

  /**
   * Delegates to {@link PromptOptimizer.savingsReport}.
   */
  savingsReport(result: OptimizeResult): string {
    return this._optimizer.savingsReport(result);
  }

  /* -------------------------------------------------------------------- *
   * Housekeeping
   * -------------------------------------------------------------------- */

  /**
   * Prunes the cache down to `maxEntries` (default: the configured cap),
   * evicting idle entries first and then the least-recently-used ones.
   *
   * Every evicted entry is also dropped from the index so the read model
   * stays consistent. Emits `pruned`.
   *
   * @param maxEntries - optional per-call target; defaults to the configured
   *   `maxEntries`.
   */
  prune(maxEntries?: number): PruneSummary {
    const summary = this._sweep(maxEntries);
    this.emit(OPTIMIZATION_EVENTS.pruned, summary);
    return summary;
  }

  /**
   * Drops the entire cache (store and index). Counters are preserved so the
   * lifetime statistics survive. Emits `cleared` with the number of entries
   * dropped.
   *
   * @returns the number of entries dropped.
   */
  clear(): number {
    const removed = this._store.clear();
    this._index.clear();
    this.emit(OPTIMIZATION_EVENTS.cleared, removed);
    return removed;
  }

  /**
   * Fully resets the lifecycle: stops the GC timer, clears the cache and
   * resets every counter to zero. Configuration is preserved.
   *
   * @returns `this` for chaining.
   */
  reset(): this {
    this.stop();
    this._store.clear();
    this._index.clear();
    this._analyzed = 0;
    this._optimized = 0;
    this._cached = 0;
    this._totalOriginalTokens = 0;
    this._totalOptimizedTokens = 0;
    this._totalSavedTokens = 0;
    this._savedPercentSum = 0;
    this.emit(OPTIMIZATION_EVENTS.reset, this);
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Periodic cache GC
   * -------------------------------------------------------------------- */

  /**
   * Starts (or restarts) the periodic cache-GC timer.
   *
   * Every `intervalMs` milliseconds the cache is swept: idle entries (not
   * accessed within the configured `idleTtlMs`) are evicted, then the cache
   * is pruned back to `maxEntries`. The timer is unref'd so it never keeps
   * the Node process alive on its own.
   *
   * @param intervalMs - GC cadence; defaults to the constructor value.
   * @returns `this` for chaining.
   */
  start(intervalMs?: number): this {
    if (intervalMs !== undefined) {
      this._gcIntervalMs = Math.max(10, Math.floor(intervalMs));
    }
    this.stop();
    this._timer = setInterval(() => this._tick(), this._gcIntervalMs);
    if (typeof (this._timer as NodeJS.Timeout).unref === 'function') {
      (this._timer as NodeJS.Timeout).unref();
    }
    return this;
  }

  /**
   * Stops the periodic GC timer (if running).
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Derives lifetime {@link OptimizationStats}, combining the pipeline
   * counters with the store's cache hit/miss counters.
   */
  stats(): OptimizationStats {
    const storeStats = this._store.stats();
    return createOptimizationStats({
      analyzed: this._analyzed,
      optimized: this._optimized,
      cached: this._cached,
      totalOriginalTokens: this._totalOriginalTokens,
      totalOptimizedTokens: this._totalOptimizedTokens,
      totalSavedTokens: this._totalSavedTokens,
      avgSavedPercent:
        this._optimized > 0 ? clampPercent(this._savedPercentSum / this._optimized) : 0,
      cacheHits: storeStats.hits,
      cacheMisses: storeStats.misses,
    });
  }

  /* -------------------------------------------------------------------- *
   * Typed emitter overrides
   * -------------------------------------------------------------------- */

  /**
   * Typed `on` that narrows the payload per event name.
   */
  override on<K extends keyof OptimizationLifecycleEvents>(
    event: K,
    listener: (...args: OptimizationLifecycleEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `once` that narrows the payload per event name.
   */
  override once<K extends keyof OptimizationLifecycleEvents>(
    event: K,
    listener: (...args: OptimizationLifecycleEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `off` that narrows the payload per event name.
   */
  override off<K extends keyof OptimizationLifecycleEvents>(
    event: K,
    listener: (...args: OptimizationLifecycleEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `emit` that narrows the payload per event name.
   */
  override emit<K extends keyof OptimizationLifecycleEvents>(
    event: K,
    ...args: OptimizationLifecycleEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Runs one periodic GC sweep, emitting `pruned` only when entries were
   * actually removed (keeps the event stream quiet).
   */
  private _tick(): void {
    const summary = this._sweep();
    if (summary.removed > 0) this.emit(OPTIMIZATION_EVENTS.pruned, summary);
  }

  /**
   * Performs the eviction sweep without emitting any event: evicts idle
   * entries, then prunes down to `target`. Shared by {@link prune} and the
   * periodic GC timer.
   */
  private _sweep(maxEntries?: number): PruneSummary {
    const target = Math.max(1, Math.floor(maxEntries ?? this._maxEntries));
    let idleRemoved = 0;
    let removed = 0;

    const cutoff = Date.now() - this._idleTtlMs;
    for (const key of this._store.keys()) {
      const entry = this._store.entry(key);
      if (entry && entry.lastAccessedAt < cutoff) {
        if (this._store.delete(key)) {
          this._index.removeResult(key);
          idleRemoved += 1;
          removed += 1;
        }
      }
    }

    for (const key of this._store.keys()) {
      if (this._store.size <= target) break;
      if (this._store.delete(key)) {
        this._index.removeResult(key);
        removed += 1;
      }
    }

    return {
      removed,
      remaining: this._store.size,
      target,
      idleRemoved,
    };
  }
}

/* ------------------------------------------------------------------------ *
 * Module-level helpers & factories
 * ------------------------------------------------------------------------ */

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createLifecycle(
  config: Partial<OptimizationConfig> = {},
  options: LifecycleOptions = {},
): OptimizationLifecycle {
  return new OptimizationLifecycle(config, options);
}

/**
 * Convenience for callers that already hold a validated {@link OptimizeOptions}
 * object and want to be sure it is structurally sound before passing it into
 * a lifecycle (a no-op guard that returns the input when valid).
 */
export function ensureOptimizeOptions(options: unknown): OptimizeOptions {
  if (isOptimizeOptions(options)) return options;
  return {};
}