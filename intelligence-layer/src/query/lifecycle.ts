/**
 * Lifecycle management for the Query understanding layer: pruning, cache GC
 * and periodic maintenance.
 *
 * The analysis cache in {@link QueryStore} grows without bound unless something
 * curates it. That curation is the job of {@link QueryLifecycle}, which owns
 * the three canonical maintenance operations:
 *
 * - **Prune to size** — {@link QueryLifecycle.prune} evicts the
 *   least-recently-used analyses until the store is within a size bound,
 *   implementing a classic LRU-bounded cache horizon.
 * - **Prune by age** — {@link QueryLifecycle.pruneByAge} discards analyses
 *   older than a retention window, keeping only fresh context.
 * - **Periodic GC** — {@link QueryLifecycle.start} installs a timer that runs
 *   both prunes on an interval, so a long-lived process never needs manual
 *   maintenance; {@link QueryLifecycle.stop} tears the timer down.
 *
 * The lifecycle also acts as the **orchestration seam** of the layer: its
 * {@link QueryLifecycle.process} method runs the full pipeline (analyze → cache
 * → index) in one call and broadcasts lifecycle events for observability.
 *
 * ## Event model
 *
 * `events` is a `node:events` {@link EventEmitter}. Two event types are
 * emitted:
 *
 * - `'analyzed'` — a new analysis was produced and recorded.
 * - `'pruned'` — entries were removed from the cache.
 * - `'cleared'` — the store and index were cleared.
 *
 * Listeners receive a {@link QueryLifecycleEvent} payload carrying the affected
 * analysis (for `'analyzed'`) or the removed ids/count (for `'pruned'`).
 *
 * @packageDocumentation
 * @module query/lifecycle
 */

import { EventEmitter } from 'node:events';
import type { QueryIndex } from './index.js';
import type { QueryAnalyzer } from './retrieval.js';
import type { QueryStore } from './store.js';
import type { AnalysisStats, AnalyzeOptions, QueryAnalysis } from './types.js';

/**
 * The lifecycle event types emitted by {@link QueryLifecycle.events}.
 */
export type QueryLifecycleEventType = 'analyzed' | 'pruned' | 'cleared';

/**
 * Payload delivered to lifecycle event listeners.
 *
 * Each event carries enough context for observers to react without reaching
 * back into the store: the affected analysis (for `'analyzed'`) or the removed
 * ids and count (for `'pruned'`).
 */
export interface QueryLifecycleEvent {
  /**
   * Discriminator naming the lifecycle operation that fired.
   */
  readonly type: QueryLifecycleEventType;

  /**
   * The analysis involved: present for `'analyzed'`, absent for `'pruned'` /
   * `'cleared'`.
   */
  readonly analysis?: QueryAnalysis;

  /**
   * Ids removed from the cache: present for `'pruned'`, absent otherwise.
   */
  readonly ids?: readonly string[];

  /**
   * Number of entries removed: present for `'pruned'`, absent otherwise.
   */
  readonly removed?: number;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: number;
}

/**
 * Configuration for a {@link QueryLifecycle}.
 *
 * All fields are optional; safe defaults apply. `maxEntries` and `maxAgeMs`
 * define the retention policy enforced by both manual prunes and the periodic
 * GC.
 */
export interface QueryLifecycleConfig {
  /**
   * Optional {@link QueryAnalyzer} used by {@link QueryLifecycle.process}.
   */
  readonly analyzer?: QueryAnalyzer;

  /**
   * Optional {@link QueryIndex} kept in sync by
   * {@link QueryLifecycle.process} / {@link QueryLifecycle.record}.
   */
  readonly index?: QueryIndex;

  /**
   * Maximum number of analyses retained. When the store exceeds this bound,
   * {@link QueryLifecycle.prune} (and the periodic GC) evict the
   * least-recently-used entries. `0` (default) disables the size bound.
   */
  readonly maxEntries?: number;

  /**
   * Maximum age of a retained analysis in milliseconds. Analyses older than
   * this are removed by {@link QueryLifecycle.pruneByAge} and the periodic GC.
   * `0` (default) disables the age bound.
   */
  readonly maxAgeMs?: number;

  /**
   * Interval between periodic GC runs, in milliseconds. Used by
   * {@link QueryLifecycle.start}; `0` (default) falls back to a 60-second
   * default interval.
   */
  readonly gcIntervalMs?: number;

  /**
   * Optional clock used for `now` in age calculations and timestamps.
   * Injecting a clock makes the lifecycle deterministic under test.
   */
  readonly now?: () => number;
}

/**
 * Result of a {@link QueryLifecycle.process} call.
 *
 * Wraps the produced analysis together with cache/index write confirmations so
 * callers can reason about where the analysis ended up.
 */
export interface ProcessResult {
  /**
   * The produced (and recorded) analysis.
   */
  readonly analysis: QueryAnalysis;

  /**
   * `true` when the analysis was newly cached (not already present).
   */
  readonly cached: boolean;

  /**
   * `true` when the analysis was indexed (a {@link QueryIndex} is attached).
   */
  readonly indexed: boolean;
}

/**
 * A typed listener alias for lifecycle events.
 *
 * @param event - the emitted lifecycle event
 */
export type QueryLifecycleListener = (event: QueryLifecycleEvent) => void;

/**
 * Manages the maintenance lifecycle of a {@link QueryStore}.
 *
 * A lifecycle is bound to exactly one store, with optional analyzer and index
 * attachments. All operations are synchronous; the periodic GC runs on a
 * `node:timers` interval and is torn down by {@link QueryLifecycle.stop} /
 * {@link QueryLifecycle.reset}.
 */
export class QueryLifecycle {
  /** The store this lifecycle curates. */
  readonly store: QueryStore;

  /** Event emitter broadcasting lifecycle operations. */
  readonly events = new EventEmitter();

  /** Configuration captured at construction time. */
  private readonly config: Required<
    Pick<QueryLifecycleConfig, 'maxEntries' | 'maxAgeMs' | 'gcIntervalMs'>
  > & {
    analyzer?: QueryAnalyzer;
    index?: QueryIndex;
    now: () => number;
  };

  /** Active GC timer handle, or `undefined` when not running. */
  private timer?: ReturnType<typeof setInterval>;

  /** Time (epoch ms) the periodic GC was started, or `undefined`. */
  private startedAt?: number;

  /**
   * Construct a lifecycle over a store.
   *
   * @param store - the store to curate (required)
   * @param config - optional analyzer/index attachments and retention policy
   */
  constructor(store: QueryStore, config?: QueryLifecycleConfig) {
    this.store = store;
    this.config = {
      maxEntries: config?.maxEntries ?? 0,
      maxAgeMs: config?.maxAgeMs ?? 0,
      gcIntervalMs: config?.gcIntervalMs ?? 60_000,
      analyzer: config?.analyzer,
      index: config?.index,
      now: config?.now ?? (() => Date.now()),
    };
    if (this.config.maxEntries < 0) {
      throw new Error(`QueryLifecycle: maxEntries must be >= 0, got ${this.config.maxEntries}`);
    }
    if (this.config.maxAgeMs < 0) {
      throw new Error(`QueryLifecycle: maxAgeMs must be >= 0, got ${this.config.maxAgeMs}`);
    }
    if (this.config.gcIntervalMs <= 0) {
      throw new Error(
        `QueryLifecycle: gcIntervalMs must be > 0, got ${this.config.gcIntervalMs}`,
      );
    }
  }

  /**
   * The {@link QueryAnalyzer} attached to this lifecycle, if any.
   *
   * @returns the attached analyzer, or `undefined`
   */
  get analyzer(): QueryAnalyzer | undefined {
    return this.config.analyzer;
  }

  /**
   * The {@link QueryIndex} attached to this lifecycle, if any.
   *
   * @returns the attached index, or `undefined`
   */
  get index(): QueryIndex | undefined {
    return this.config.index;
  }

  /**
   * Whether the periodic GC timer is currently running.
   *
   * @returns `true` when started and not yet stopped
   */
  get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Epoch-millisecond time the periodic GC was started, or `undefined`.
   *
   * @returns the start time, when running
   */
  get runningSince(): number | undefined {
    return this.startedAt;
  }

  /**
   * Run the full analysis pipeline and record the result.
   *
   * Delegates to the attached {@link QueryAnalyzer.analyze} (an analyzer must
   * be configured), caches the result in the store, indexes it when an index is
   * attached, and emits an `'analyzed'` event carrying the analysis.
   *
   * @param text - the raw user query
   * @param options - per-call analyzer options
   * @returns a {@link ProcessResult} describing where the analysis went
   * @throws {Error} when no analyzer is attached
   */
  process(text: string, options?: AnalyzeOptions): ProcessResult {
    if (!this.config.analyzer) {
      throw new Error(
        'QueryLifecycle.process: no QueryAnalyzer is attached; construct with config.analyzer or use record()',
      );
    }
    const analysis = this.config.analyzer.analyze(text, options);
    return this.record(analysis);
  }

  /**
   * Record an already-produced analysis: cache, index and broadcast.
   *
   * Useful when analyses are produced elsewhere (a batch importer, a remote
   * pipeline) but must still flow through the same cache/index/event path.
   *
   * @param analysis - the analysis to record
   * @returns a {@link ProcessResult} describing where the analysis went
   */
  record(analysis: QueryAnalysis): ProcessResult {
    const alreadyCached = this.store.has(analysis.id);
    this.store.put(analysis);
    let indexed = false;
    if (this.config.index) {
      this.config.index.indexAnalysis(analysis);
      indexed = true;
    }
    this.events.emit('analyzed', {
      type: 'analyzed',
      analysis,
      timestamp: this.config.now(),
    } satisfies QueryLifecycleEvent);
    return { analysis, cached: !alreadyCached, indexed };
  }

  /**
   * Prune the store down to at most `maxEntries` entries.
   *
   * When the store exceeds the bound, the least-recently-used entries are
   * evicted (via {@link QueryStore.oldest}) until the store is within bounds.
   * The bound may be overridden per call; the configured `maxEntries` is used
   * when the argument is `0`. Emits a single `'pruned'` event when any entries
   * were removed.
   *
   * @param maxEntries - the size bound; `0` uses the configured bound
   * @returns the number of entries pruned
   */
  prune(maxEntries = 0): number {
    const bound = maxEntries > 0 ? maxEntries : this.config.maxEntries;
    if (bound <= 0) {
      return 0;
    }
    const overflow = this.store.size() - bound;
    if (overflow <= 0) {
      return 0;
    }
    const ids = this.store.oldest(overflow);
    const removed: string[] = [];
    for (const id of ids) {
      if (this.store.delete(id)) {
        removed.push(id);
      }
    }
    if (removed.length > 0) {
      this.emitPruned(removed);
    }
    return removed.length;
  }

  /**
   * Prune analyses older than a retention window.
   *
   * Analyses whose `analyzedAt` is older than `now - olderThanMs` are removed.
   * The window may be overridden per call; the configured `maxAgeMs` is used
   * when the argument is `0`. Emits a `'pruned'` event when any entries were
   * removed.
   *
   * @param olderThanMs - the retention window in ms; `0` uses the configured
   *   bound (and is a no-op when that bound is also `0`)
   * @returns the number of entries pruned
   */
  pruneByAge(olderThanMs = 0): number {
    const window = olderThanMs > 0 ? olderThanMs : this.config.maxAgeMs;
    if (window <= 0) {
      return 0;
    }
    const cutoff = this.config.now() - window;
    const removed: string[] = [];
    for (const analysis of this.store.values()) {
      if (analysis.analyzedAt < cutoff) {
        if (this.store.delete(analysis.id)) {
          removed.push(analysis.id);
        }
      }
    }
    if (removed.length > 0) {
      this.emitPruned(removed);
    }
    return removed.length;
  }

  /**
   * Run a full maintenance pass.
   *
   * Applies both {@link QueryLifecycle.prune} (size bound) and
   * {@link QueryLifecycle.pruneByAge} (age bound) using the configured
   * retention policy. A single `'pruned'` event is emitted per policy that
   * removed entries.
   *
   * @returns the total number of entries pruned
   */
  gc(): number {
    let total = 0;
    total += this.prune();
    total += this.pruneByAge();
    return total;
  }

  /**
   * Start the periodic GC timer.
   *
   * Installs an interval that runs {@link QueryLifecycle.gc} every
   * `gcIntervalMs` (or the configured interval). When `runNow` is `true`, a
   * first GC pass runs synchronously before the timer is installed. Starting
   * when already running is a no-op.
   *
   * @param intervalMs - optional override of the configured GC interval
   * @param runNow - when `true` (default), run one GC pass immediately
   * @returns `true` when the timer was (re)started, `false` when already running
   */
  start(intervalMs?: number, runNow = true): boolean {
    if (this.timer) {
      return false;
    }
    const interval = intervalMs && intervalMs > 0 ? intervalMs : this.config.gcIntervalMs;
    if (runNow) {
      this.gc();
    }
    this.timer = setInterval(() => {
      this.gc();
    }, interval);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.startedAt = this.config.now();
    return true;
  }

  /**
   * Stop the periodic GC timer.
   *
   * No maintenance runs after this returns; {@link QueryLifecycle.start} may be
   * called again later. Stopping when not running is a no-op.
   *
   * @returns `true` when a timer was stopped, `false` when none was active
   */
  stop(): boolean {
    if (!this.timer) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    this.startedAt = undefined;
    return true;
  }

  /**
   * Clear the store and index.
   *
   * All cached analyses and all indexed pointers are removed. The GC timer (if
   * running) keeps running — use {@link QueryLifecycle.reset} to tear it down
   * too. Emits a `'cleared'` event.
   */
  clear(): void {
    const removed = this.store.size();
    this.store.clear();
    this.config.index?.clear();
    this.events.emit('cleared', {
      type: 'cleared',
      removed,
      timestamp: this.config.now(),
    } satisfies QueryLifecycleEvent);
  }

  /**
   * Fully reset the lifecycle.
   *
   * Stops the GC timer, clears the store and index, and removes every
   * registered listener. This is the clean-slate path for tests and for
   * tearing down a long-lived lifecycle.
   */
  reset(): void {
    this.stop();
    this.store.clear();
    this.config.index?.clear();
    this.events.removeAllListeners();
  }

  /**
   * Subscribe to a lifecycle event type.
   *
   * Convenience wrapper over {@link EventEmitter.on} that returns an
   * unsubscribe function, matching the convention used elsewhere in the MAM
   * Intelligence layer.
   *
   * @param type - the event type to subscribe to
   * @param listener - the handler to invoke
   * @returns an unsubscribe function
   */
  onEvent(type: QueryLifecycleEventType, listener: QueryLifecycleListener): () => void {
    this.events.on(type, listener);
    return () => {
      this.events.off(type, listener);
    };
  }

  /**
   * Aggregate statistics over the store (and index, when attached).
   *
   * The store's {@link QueryStore.stats} snapshot is augmented with the index's
   * top terms when an index is attached.
   *
   * @returns a fresh {@link AnalysisStats} snapshot
   */
  stats(): AnalysisStats {
    const storeStats = this.store.stats();
    if (!this.config.index) {
      return storeStats;
    }
    const indexStats = this.config.index.stats();
    return {
      ...storeStats,
      intentCounts: indexStats.intentCounts,
      totalTerms: indexStats.totalTerms,
      distinctTerms: indexStats.distinctTerms,
    };
  }

  /**
   * Emit a `'pruned'` event for a batch of removed ids.
   *
   * @param ids - the ids removed from the store
   */
  private emitPruned(ids: readonly string[]): void {
    this.events.emit('pruned', {
      type: 'pruned',
      ids,
      removed: ids.length,
      timestamp: this.config.now(),
    } satisfies QueryLifecycleEvent);
  }
}