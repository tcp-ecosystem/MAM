/**
 * @fileoverview Lifecycle management for token usage data: retention, reset,
 * and periodic rollup.
 *
 * {@link TokenUsageLifecycle} ties the store and the index together with a
 * time-based policy. It owns the data lifecycle — records are added through it
 * so they are indexed and announced exactly once — and it enforces retention
 * via {@link prune}, resets via {@link reset}, and produces time-bucketed
 * {@link RollupSnapshot} rollups via a background interval started with
 * {@link start}.
 *
 * The lifecycle extends Node's `EventEmitter`, so consumers can subscribe to
 * `record`, `prune`, `rollup`, and `stop` notifications with the standard
 * `on`/`once`/`off` API. All event payloads come from `./types.js`.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';

import {
  DEFAULT_TOKEN_USAGE_CONFIG,
  EMPTY_TOTALS,
  type MutableTokenTotals,
  type PruneResult,
  type RollupSnapshot,
  type TokenTotals,
  type TokenUsageConfig,
  type TokenUsageEventMap,
  type TokenUsageRecord,
  type TotalsMap,
} from './types.js';
import { TokenUsageStore } from './store.js';
import { TokenUsageIndex } from './index.js';
import { TokenUsageQuery } from './retrieval.js';

/**
 * Event names exposed by {@link TokenUsageLifecycle}. Kept as a const object
 * so consumers can reference `LIFECYCLE_EVENTS.record` instead of raw string
 * literals.
 */
export const LIFECYCLE_EVENTS = {
  record: 'record',
  prune: 'prune',
  rollup: 'rollup',
  stop: 'stop',
} as const;

/**
 * Bridge that gives the lifecycle a typed `EventEmitter`. This interface
 * narrows `EventEmitter` so that `.on(name, listener)` matches the payloads in
 * {@link TokenUsageEventMap}.
 */
export interface TokenUsageLifecycleEmitter {
  on<K extends keyof TokenUsageEventMap>(
    event: K,
    listener: (payload: TokenUsageEventMap[K]) => void,
  ): this;
  once<K extends keyof TokenUsageEventMap>(
    event: K,
    listener: (payload: TokenUsageEventMap[K]) => void,
  ): this;
  off<K extends keyof TokenUsageEventMap>(
    event: K,
    listener: (payload: TokenUsageEventMap[K]) => void,
  ): this;
  emit<K extends keyof TokenUsageEventMap>(
    event: K,
    payload: TokenUsageEventMap[K],
  ): boolean;
};

/**
 * State exposed while the lifecycle is running (i.e. between {@link start}
 * and {@link stop}).
 */
export interface TokenUsageLifecycleState {
  /**
   * `true` while the periodic rollup interval is active.
   */
  readonly running: boolean;

  /**
   * Epoch milliseconds at which the current rollup window began, or `0` when
   * not running.
   */
  readonly windowStart: number;

  /**
   * Number of records added since the current window began.
   */
  readonly recordsSinceRollup: number;

  /**
   * Number of records pruned in total over the lifecycle's lifetime.
   */
  readonly totalPruned: number;

  /**
   * Number of rollup snapshots emitted so far.
   */
  readonly rollupCount: number;
}

/**
 * Manages the data lifecycle for a {@link TokenUsageStore} and an associated
 * {@link TokenUsageIndex}.
 *
 * Records enter the system through {@link record}; the lifecycle stores them,
 * indexes them, and broadcasts a `record` event. Retention is enforced with
 * {@link prune}, which removes records older than the configured window (or an
 * explicit age) and emits a `prune` event with the result. When
 * {@link start} is invoked, a `setInterval` captures {@link RollupSnapshot}
 * totals every `rollupIntervalMs` milliseconds and emits them as `rollup`
 * events.
 *
 * @example
 * ```ts
 * const lifecycle = new TokenUsageLifecycle();
 * lifecycle.start();
 * lifecycle.on('rollup', (snapshot) => saveSnapshot(snapshot));
 * lifecycle.record(record);            // stored + indexed + emitted
 * lifecycle.prune(7 * 24 * 60 * 60 * 1000);
 * lifecycle.stop();
 * ```
 */
export class TokenUsageLifecycle extends EventEmitter implements TokenUsageLifecycleEmitter {
  /** The underlying store. */
  private readonly store: TokenUsageStore;

  /** The index kept in sync with the store. */
  private readonly index: TokenUsageIndex;

  /** Read-only query engine over the store. */
  private readonly query: TokenUsageQuery;

  /** Effective configuration. */
  private readonly config: TokenUsageConfig;

  /** Handle for the periodic rollup interval, or `null` when stopped. */
  private timer: NodeJS.Timeout | null = null;

  /** Epoch ms at which the current rollup window began. */
  private windowStart = 0;

  /** Rolling per-window totals accumulator. */
  private windowTotals: MutableTokenTotals = { ...EMPTY_TOTALS };

  /** Rolling per-window per-model totals. */
  private windowByModel = new Map<string, MutableTokenTotals>();

  /** Rolling per-window per-provider totals. */
  private windowByProvider = new Map<string, MutableTokenTotals>();

  /** Count of records added since the window began. */
  private recordsSinceRollup = 0;

  /** Lifetime count of pruned records. */
  private totalPruned = 0;

  /** Lifetime count of emitted rollup snapshots. */
  private rollupCount = 0;

  /**
   * Creates a lifecycle manager.
   *
   * @param store - Optional store to manage. A fresh store is created when
   * omitted.
   * @param index - Optional index to keep in sync. A fresh index is created
   * and synchronised with the store when omitted.
   * @param config - Optional configuration overrides.
   */
  constructor(
    store?: TokenUsageStore,
    index?: TokenUsageIndex,
    config?: Partial<TokenUsageConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_TOKEN_USAGE_CONFIG, ...config };
    this.store = store ?? new TokenUsageStore(this.config);
    this.index = index ?? new TokenUsageIndex(this.config);
    if (index === undefined) {
      this.index.rebuild(this.store.values());
    }
    this.query = new TokenUsageQuery(this.store, this.config);
  }

  /**
   * Returns the managed store.
   *
   * @returns The store instance.
   */
  getStore(): TokenUsageStore {
    return this.store;
  }

  /**
   * Returns the index kept in sync with the store.
   *
   * @returns The index instance.
   */
  getIndex(): TokenUsageIndex {
    return this.index;
  }

  /**
   * Returns a query engine bound to the managed store.
   *
   * @returns The query engine.
   */
  getQuery(): TokenUsageQuery {
    return this.query;
  }

  /**
   * Adds a record through the lifecycle: stored, indexed, and announced.
   *
   * This is the single write path for the managed data. It keeps the store
   * and index in lockstep and broadcasts a `record` event carrying the stored
   * (normalized) record.
   *
   * @param record - The record to add.
   * @returns The normalized record that was stored.
   * @throws {TypeError} When the record is structurally invalid.
   */
  record(record: TokenUsageRecord): TokenUsageRecord {
    const stored = this.store.record(record);
    this.index.indexRecord(stored);
    this.foldWindow(stored);
    this.emit(LIFECYCLE_EVENTS.record, stored);
    return stored;
  }

  /**
   * Convenience factory that builds and stores a record from raw call metrics,
   * mirroring {@link TokenUsageStore.add}.
   *
   * @param model - The model identifier.
   * @param inputTokens - Number of input tokens.
   * @param outputTokens - Number of output tokens.
   * @param options - Optional overrides (provider, cost, session, call ids).
   * @returns The stored, normalized record.
   */
  add(
    model: string,
    inputTokens: number,
    outputTokens: number,
    options: {
      provider?: string;
      cost?: number;
      sessionId?: string;
      callId?: string;
      timestamp?: number;
      id?: string;
    } = {},
  ): TokenUsageRecord {
    return this.record(this.store.add(model, inputTokens, outputTokens, options));
  }

  /**
   * Removes records older than a retention window, plus any records beyond the
   * configured {@link TokenUsageConfig.maxRecords} cap (oldest first).
   *
   * @param olderThanMs - Age in milliseconds. Records whose timestamp is
   * strictly older than `now - olderThanMs` are removed. Defaults to the
   * configured `defaultRetentionMs`.
   * @returns A {@link PruneResult} describing what was removed. A `prune`
   * event is emitted when one or more records were removed.
   */
  prune(olderThanMs?: number): PruneResult {
    const cutoff = Date.now() - Math.max(0, olderThanMs ?? this.config.defaultRetentionMs);
    const all = Array.from(this.store.values());
    const candidates = all
      .filter((record) => record.timestamp < cutoff)
      .map((record) => record.id);
    const extra = this.overCapIds();
    const toRemove = Array.from(new Set([...candidates, ...extra]));

    let pruned = 0;
    for (const id of toRemove) {
      if (this.store.delete(id)) {
        this.index.removeRecord(id);
        pruned += 1;
      }
    }
    this.totalPruned += pruned;
    const result: PruneResult = {
      pruned,
      remaining: this.store.size,
      prunedAt: Date.now(),
    };
    if (pruned > 0) {
      this.emit(LIFECYCLE_EVENTS.prune, result);
    }
    return result;
  }

  /**
   * Removes every record from the store and index and resets all lifecycle
   * counters (including window totals and rollup count).
   *
   * The rollup timer, when active, is left running; the next snapshot will
   * simply see a fresh window.
   */
  reset(): void {
    this.store.clear();
    this.index.clear();
    this.windowTotals = { ...EMPTY_TOTALS };
    this.windowByModel.clear();
    this.windowByProvider.clear();
    this.recordsSinceRollup = 0;
    this.rollupCount = 0;
    this.windowStart = Date.now();
  }

  /**
   * Starts the periodic rollup interval.
   *
   * A `rollup` event is emitted every `intervalMs` milliseconds (defaulting to
   * the configured `rollupIntervalMs`). Each event carries a
   * {@link RollupSnapshot} describing the totals observed since the previous
   * snapshot. Starting when already running is a no-op.
   *
   * @param intervalMs - Optional interval override in milliseconds.
   * @returns `this` for chaining.
   */
  start(intervalMs?: number): this {
    if (this.timer !== null) {
      return this;
    }
    const interval = Math.max(10, intervalMs ?? this.config.rollupIntervalMs);
    this.windowStart = Date.now();
    this.timer = setInterval(() => {
      this.emitRollup();
    }, interval);
    // Do not keep the process alive purely for token accounting.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return this;
  }

  /**
   * Stops the periodic rollup interval and emits a final snapshot for the
   * remainder of the current window.
   *
   * Stopping when already stopped is a no-op. A `stop` event is emitted after
   * the final rollup.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.emitRollup();
    }
    this.emit(LIFECYCLE_EVENTS.stop, { stoppedAt: Date.now() });
    return this;
  }

  /**
   * Reports the current lifecycle state.
   *
   * @returns A {@link TokenUsageLifecycleState} snapshot.
   */
  state(): TokenUsageLifecycleState {
    return {
      running: this.timer !== null,
      windowStart: this.windowStart,
      recordsSinceRollup: this.recordsSinceRollup,
      totalPruned: this.totalPruned,
      rollupCount: this.rollupCount,
    };
  }

  /**
   * Number of records currently held in the store.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Computes the ids of records that exceed the configured
   * {@link TokenUsageConfig.maxRecords} cap, oldest first.
   *
   * @returns An array of record ids to evict.
   */
  private overCapIds(): string[] {
    const max = this.config.maxRecords;
    if (max <= 0 || this.store.size <= max) {
      return [];
    }
    const excess = this.store.size - max;
    return Array.from(this.store.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, excess)
      .map((record) => record.id);
  }

  /**
   * Folds a record into the current window's running totals.
   *
   * @param record - The record to fold in.
   */
  private foldWindow(record: TokenUsageRecord): void {
    this.windowTotals.inputTokens += record.inputTokens;
    this.windowTotals.outputTokens += record.outputTokens;
    this.windowTotals.totalTokens += record.totalTokens;
    this.windowTotals.totalCost += record.cost ?? 0;
    this.windowTotals.callCount += 1;
    this.recordsSinceRollup += 1;
    this.foldInto(this.windowByModel, record.model, record);
    const provider = record.provider ?? this.config.defaultProvider;
    this.foldInto(this.windowByProvider, provider, record);
  }

  /**
   * Folds a record into a dimension-keyed totals map, creating the entry
   * lazily.
   *
   * @param map - The map to update.
   * @param key - The dimension key.
   * @param record - The record to fold in.
   */
  private foldInto(map: Map<string, MutableTokenTotals>, key: string, record: TokenUsageRecord): void {
    let totals = map.get(key);
    if (!totals) {
      totals = { ...EMPTY_TOTALS };
      map.set(key, totals);
    }
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.totalTokens += record.totalTokens;
    totals.totalCost += record.cost ?? 0;
    totals.callCount += 1;
  }

  /**
   * Emits a {@link RollupSnapshot} for the current window and resets the
   * window accumulators for the next interval.
   */
  private emitRollup(): void {
    const windowStart = this.windowStart;
    const windowEnd = Date.now();
    const snapshot: RollupSnapshot = {
      windowStart,
      windowEnd,
      totals: { ...this.windowTotals },
      byModel: this.windowByModel,
      byProvider: this.windowByProvider,
    };
    this.rollupCount += 1;
    this.emit(LIFECYCLE_EVENTS.rollup, snapshot);
    this.windowTotals = { ...EMPTY_TOTALS };
    this.windowByModel = new Map<string, MutableTokenTotals>();
    this.windowByProvider = new Map<string, MutableTokenTotals>();
    this.recordsSinceRollup = 0;
    this.windowStart = windowEnd;
  }
}

/**
 * Creates a lifecycle manager with a friendlier signature for the integration
 * layer.
 *
 * @param options - Optional store, index, and config.
 * @returns A configured {@link TokenUsageLifecycle}.
 */
export function createTokenUsageLifecycle(options: {
  store?: TokenUsageStore;
  index?: TokenUsageIndex;
  config?: Partial<TokenUsageConfig>;
} = {}): TokenUsageLifecycle {
  return new TokenUsageLifecycle(options.store, options.index, options.config);
}

/**
 * Re-export of the events map so consumers building custom collectors can
 * reference the same constants.
 */
export { EMPTY_TOTALS };