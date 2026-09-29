/**
 * store.ts
 *
 * The `InvocationStore` — the recording side of the Invocation layer.
 *
 * Every invocation that flows through the engine produces an
 * {@link ExecutionRecord} and updates cumulative statistics. This module is
 * where both live:
 *
 *   - **History**: an append-only buffer of {@link ExecutionRecord}s, newest
 *     last, bounded by `maxRecords` via {@link InvocationStore.prune}. Records
 *     carry a monotonic `id` that links them to index entries in `index.ts`.
 *   - **Statistics**: per-tool {@link ToolStats} plus an aggregate
 *     {@link InvocationStats}. Counters are monotonic — clearing history does
 *     NOT reset them; use {@link InvocationStore.resetStats} for that.
 *
 * Design decisions:
 *
 *   - `record` is the single write path. It derives a record from an
 *     {@link InvocationResult}, appends it and updates every counter. Callers
 *     never touch the buffers directly.
 *   - Cache hits are distinguishable: a result with `cached: true`
 *     increments `cacheHits` but is not counted as an execution, so
 *     `totalExecutions` reflects real handler work (mocks do count).
 *   - `toJSON` / `fromJSON` snapshot the whole store — history, per-tool
 *     stats and aggregate counters — so observability dashboards can persist
 *     and restore invocation telemetry across restarts.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type ExecutionRecord,
  type InvocationResult,
  type InvocationStats,
  type ToolStats,
  createEmptyToolStats,
  createExecutionRecord,
  createToolStats,
  isExecutionRecord,
  isInvocationResult,
} from './types.js';

/**
 * Serialisable snapshot of an {@link InvocationStore}, produced by
 * {@link InvocationStore.toJSON} and consumed by
 * {@link InvocationStore.fromJSON}.
 */
export interface InvocationStoreSnapshot {
  /** Next monotonic record id. */
  nextId: number;

  /** History records, oldest first. */
  history: ExecutionRecord[];

  /** Per-tool statistics keyed by tool name. */
  toolStats: Record<string, ToolStats>;

  /** Aggregate counters used to derive {@link InvocationStats}. */
  aggregate: {
    totalExecutions: number;
    successCount: number;
    failureCount: number;
    cacheHits: number;
    cacheMisses: number;
    mockExecutions: number;
    totalDurationMs: number;
    lastExecutedAt?: number;
  };

  /** Distinct tools seen, in first-execution order. */
  toolOrder: string[];
}

/**
 * Records execution history and cumulative statistics for the Invocation
 * layer.
 *
 * @example
 * const store = new InvocationStore({ maxRecords: 1000 });
 * store.record(result);               // appends a record + updates stats
 * store.historyFor('http.get');       // ExecutionRecord[]
 * store.statsFor('http.get');         // ToolStats
 * store.getStats();                   // InvocationStats (aggregate)
 * store.prune(100);                   // trim history to 100 records
 * store.toJSON();                     // snapshot for persistence
 */
export class InvocationStore {
  /** History buffer, oldest first. */
  private readonly history: ExecutionRecord[];

  /** Per-tool cumulative statistics. */
  private readonly toolStats: Map<string, ToolStats>;

  /** Monotonic id counter for records. */
  private nextId: number;

  /** Upper bound on retained history records (0 = unbounded). */
  private readonly maxRecords: number;

  /** Distinct tools seen, in first-execution order. */
  private readonly toolOrder: string[];

  /** Aggregate counters driving {@link InvocationStats}. */
  private readonly aggregate: {
    totalExecutions: number;
    successCount: number;
    failureCount: number;
    cacheHits: number;
    cacheMisses: number;
    mockExecutions: number;
    totalDurationMs: number;
    lastExecutedAt?: number;
  };

  /**
   * Creates an empty store.
   *
   * @param options optional tuning: `maxRecords` caps the history buffer
   *   (records beyond it are dropped on write; `0` or omission means
   *   unbounded), and `seed` pre-loads history/stats from a snapshot.
   */
  constructor(
    options: { maxRecords?: number; seed?: InvocationStoreSnapshot } = {},
  ) {
    this.history = [];
    this.toolStats = new Map();
    this.toolOrder = [];
    this.aggregate = {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      mockExecutions: 0,
      totalDurationMs: 0,
      lastExecutedAt: undefined,
    };
    this.maxRecords =
      typeof options.maxRecords === 'number' && options.maxRecords > 0
        ? Math.floor(options.maxRecords)
        : 0;
    this.nextId = 0;

    if (options.seed) {
      this.restoreSnapshot(options.seed);
    }
  }

  /* ------------------------------------------------------------------ *
   * Writing
   * ------------------------------------------------------------------ */

  /**
   * Records an {@link InvocationResult}: derives an {@link ExecutionRecord},
   * appends it to history and updates every affected statistic.
   *
   * The write path distinguishes three flavours of result:
   *
   *   - **executed** (`cached` and `mock` both false) — counts toward
   *     `totalExecutions`, `successCount`/`failureCount` and duration.
   *   - **mock** (`mock: true`) — counts toward `totalExecutions` and
   *     `mockExecutions`, but not duration averages (duration is 0).
   *   - **cached** (`cached: true`) — counts toward `cacheHits` only; a
   *     cache hit is not an execution.
   *
   * @param result the outcome to record.
   * @returns the derived, id-bearing {@link ExecutionRecord}.
   */
  record(result: InvocationResult): ExecutionRecord {
    const record = createExecutionRecord(result);
    record.id = this.nextId;
    this.nextId += 1;

    this.history.push(record);
    if (this.maxRecords > 0 && this.history.length > this.maxRecords) {
      this.prune(this.maxRecords);
    }
    this.updateStats(result);
    return record;
  }

  /**
   * Records a cache *miss* for a tool.
   *
   * Misses are not executions, so they only bump the `cacheMisses` counters.
   * Callers that consulted a cache and found nothing should call this before
   * executing so the miss is attributed to the right tool.
   *
   * @param tool the tool whose cache was consulted.
   */
  recordCacheMiss(tool: string): void {
    const stats = this.toolStats.get(tool) ?? createEmptyToolStats();
    stats.cacheMisses += 1;
    this.toolStats.set(tool, stats);
    this.aggregate.cacheMisses += 1;
  }

  /**
   * Records a cache *hit* for a tool. Equivalent to recording a result with
   * `cached: true`; provided as a convenience for paths that do not build a
   * full result object.
   *
   * @param tool the tool whose cache was consulted.
   */
  recordCacheHit(tool: string): void {
    const stats = this.toolStats.get(tool) ?? createEmptyToolStats();
    stats.cacheHits += 1;
    this.toolStats.set(tool, stats);
    this.aggregate.cacheHits += 1;
  }

  /* ------------------------------------------------------------------ *
   * History queries
   * ------------------------------------------------------------------ */

  /**
   * Returns the number of history records currently retained.
   */
  get size(): number {
    return this.history.length;
  }

  /**
   * Returns every history record, oldest first. The returned array is a copy;
   * mutating it does not affect the store.
   */
  getHistory(): readonly ExecutionRecord[] {
    return this.history.slice();
  }

  /**
   * Returns the history records for a single tool, oldest first.
   *
   * @param tool the tool name to filter by.
   */
  historyFor(tool: string): ExecutionRecord[] {
    return this.history.filter((record) => record.tool === tool);
  }

  /**
   * Returns the most recent record, or `undefined` when history is empty.
   */
  latest(): ExecutionRecord | undefined {
    return this.history.length === 0
      ? undefined
      : this.history[this.history.length - 1];
  }

  /**
   * Removes records for a single tool from history.
   *
   * Note: this does not touch statistics — counters are monotonic. Use
   * {@link InvocationStore.resetStatsFor} to also reset a tool's stats.
   *
   * @param tool the tool name to purge.
   * @returns the number of records removed.
   */
  removeHistoryFor(tool: string): number {
    const retained: ExecutionRecord[] = [];
    let removed = 0;
    for (const record of this.history) {
      if (record.tool === tool) {
        removed += 1;
      } else {
        retained.push(record);
      }
    }
    if (removed > 0) {
      this.history.length = 0;
      this.history.push(...retained);
    }
    return removed;
  }

  /**
   * Removes every history record.
   *
   * @returns the number of records removed.
   */
  clearHistory(): number {
    const removed = this.history.length;
    this.history.length = 0;
    return removed;
  }

  /**
   * Trims history down to at most `maxRecords` records, dropping the oldest
   * ones. Returns the dropped records so callers can propagate removals into
   * the index.
   *
   * @param maxRecords the maximum number of records to retain.
   * @returns the removed records (oldest first).
   */
  prune(maxRecords: number): ExecutionRecord[] {
    const bound = Math.max(0, Math.floor(maxRecords));
    const overflow = Math.max(0, this.history.length - bound);
    if (overflow === 0) {
      return [];
    }
    return this.history.splice(0, overflow);
  }

  /* ------------------------------------------------------------------ *
   * Statistics
   * ------------------------------------------------------------------ */

  /**
   * Returns cumulative statistics for a single tool. When the tool has never
   * been seen, a zeroed {@link ToolStats} is returned (never `undefined`).
   *
   * @param tool the tool name to inspect.
   */
  statsFor(tool: string): ToolStats {
    const stats = this.toolStats.get(tool);
    return stats === undefined ? createEmptyToolStats() : { ...stats };
  }

  /**
   * Returns `true` when the store has recorded statistics for `tool`.
   *
   * @param tool the tool name to probe.
   */
  hasStatsFor(tool: string): boolean {
    return this.toolStats.has(tool);
  }

  /**
   * Returns the per-tool statistics map keyed by tool name.
   */
  allStats(): Map<string, ToolStats> {
    return new Map(
      Array.from(this.toolStats, ([tool, stats]) => [tool, { ...stats }]),
    );
  }

  /**
   * Returns aggregate {@link InvocationStats} across every recorded tool.
   */
  getStats(): InvocationStats {
    const averageDurationMs =
      this.aggregate.totalExecutions === 0
        ? 0
        : this.aggregate.totalDurationMs / this.aggregate.totalExecutions;
    return {
      totalExecutions: this.aggregate.totalExecutions,
      successCount: this.aggregate.successCount,
      failureCount: this.aggregate.failureCount,
      averageDurationMs: Math.round(averageDurationMs * 100) / 100,
      cacheHits: this.aggregate.cacheHits,
      cacheMisses: this.aggregate.cacheMisses,
      mockExecutions: this.aggregate.mockExecutions,
      lastExecutedAt: this.aggregate.lastExecutedAt,
      tools: this.toolOrder.slice(),
      toolStats: Object.fromEntries(this.toolStats),
    };
  }

  /**
   * Alias of {@link InvocationStore.getStats} matching the naming used by
   * other layers.
   */
  stats(): InvocationStats {
    return this.getStats();
  }

  /**
   * Resets every statistic — per-tool and aggregate — to zero while leaving
   * history untouched.
   *
   * @returns the number of tools whose stats were reset.
   */
  resetStats(): number {
    const count = this.toolStats.size;
    this.toolStats.clear();
    this.toolOrder.length = 0;
    this.aggregate.totalExecutions = 0;
    this.aggregate.successCount = 0;
    this.aggregate.failureCount = 0;
    this.aggregate.cacheHits = 0;
    this.aggregate.cacheMisses = 0;
    this.aggregate.mockExecutions = 0;
    this.aggregate.totalDurationMs = 0;
    this.aggregate.lastExecutedAt = undefined;
    return count;
  }

  /**
   * Resets the statistics of a single tool.
   *
   * @param tool the tool name to reset.
   * @returns `true` when the tool had statistics that were reset.
   */
  resetStatsFor(tool: string): boolean {
    const existed = this.toolStats.delete(tool);
    return existed;
  }

  /* ------------------------------------------------------------------ *
   * Reset & persistence
   * ------------------------------------------------------------------ */

  /**
   * Clears history and statistics, returning the store to its initial empty
   * state. The id counter is preserved so future records never collide with
   * ids referenced elsewhere.
   */
  clear(): void {
    this.history.length = 0;
    this.toolStats.clear();
    this.toolOrder.length = 0;
    this.aggregate.totalExecutions = 0;
    this.aggregate.successCount = 0;
    this.aggregate.failureCount = 0;
    this.aggregate.cacheHits = 0;
    this.aggregate.cacheMisses = 0;
    this.aggregate.mockExecutions = 0;
    this.aggregate.totalDurationMs = 0;
    this.aggregate.lastExecutedAt = undefined;
  }

  /**
   * Serialises the store as a JSON-safe snapshot. Functions never appear in
   * the payload, so the result round-trips through
   * {@link InvocationStore.fromJSON} losslessly.
   */
  toJSON(): InvocationStoreSnapshot {
    return {
      nextId: this.nextId,
      history: this.history.map((record) => ({ ...record })),
      toolStats: Object.fromEntries(
        Array.from(this.toolStats, ([tool, stats]) => [tool, { ...stats }]),
      ),
      aggregate: { ...this.aggregate },
      toolOrder: this.toolOrder.slice(),
    };
  }

  /**
   * Rebuilds a store from the output of {@link InvocationStore.toJSON} (or
   * any JSON-serialised snapshot with the same shape).
   *
   * Entries are validated defensively: malformed records and stats are
   * skipped rather than thrown, so a corrupted snapshot cannot take down the
   * store.
   *
   * @param snapshot the serialised snapshot.
   * @returns a new, populated {@link InvocationStore}.
   */
  static fromJSON(snapshot: InvocationStoreSnapshot): InvocationStore {
    const store = new InvocationStore();
    store.restoreSnapshot(snapshot);
    return store;
  }

  /* ------------------------------------------------------------------ *
   * Internal helpers
   * ------------------------------------------------------------------ */

  /**
   * Applies a snapshot to this store. Used by the constructor and by
   * `fromJSON`. Malformed entries are skipped defensively.
   */
  private restoreSnapshot(snapshot: InvocationStoreSnapshot): void {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      !Array.isArray(snapshot.history) ||
      typeof snapshot.aggregate !== 'object' ||
      snapshot.aggregate === null
    ) {
      throw new TypeError('InvocationStore: invalid snapshot shape.');
    }

    this.nextId =
      typeof snapshot.nextId === 'number' ? snapshot.nextId : this.nextId;

    for (const entry of snapshot.history) {
      if (!isExecutionRecord(entry)) {
        continue;
      }
      this.history.push({ ...entry });
    }

    const statsSource =
      isRecordLike(snapshot.toolStats) ? snapshot.toolStats : {};
    for (const [tool, stats] of Object.entries(statsSource)) {
      if (!isRecordLike(stats)) {
        continue;
      }
      this.toolStats.set(
        tool,
        createToolStats({
          totalExecutions: numOr(stats.totalExecutions),
          successCount: numOr(stats.successCount),
          failureCount: numOr(stats.failureCount),
          averageDurationMs: numOr(stats.averageDurationMs),
          lastExecutedAt:
            typeof stats.lastExecutedAt === 'number'
              ? stats.lastExecutedAt
              : undefined,
          cacheHits: numOr(stats.cacheHits),
          cacheMisses: numOr(stats.cacheMisses),
          mockExecutions: numOr(stats.mockExecutions),
        }),
      );
    }

    const agg = snapshot.aggregate as Record<string, unknown>;
    this.aggregate.totalExecutions = numOr(agg.totalExecutions);
    this.aggregate.successCount = numOr(agg.successCount);
    this.aggregate.failureCount = numOr(agg.failureCount);
    this.aggregate.cacheHits = numOr(agg.cacheHits);
    this.aggregate.cacheMisses = numOr(agg.cacheMisses);
    this.aggregate.mockExecutions = numOr(agg.mockExecutions);
    this.aggregate.totalDurationMs = numOr(agg.totalDurationMs);
    this.aggregate.lastExecutedAt =
      typeof agg.lastExecutedAt === 'number'
        ? agg.lastExecutedAt
        : undefined;

    if (Array.isArray(snapshot.toolOrder)) {
      for (const tool of snapshot.toolOrder) {
        if (typeof tool === 'string' && this.toolStats.has(tool)) {
          this.toolOrder.push(tool);
        }
      }
    }
    for (const tool of this.toolStats.keys()) {
      if (!this.toolOrder.includes(tool)) {
        this.toolOrder.push(tool);
      }
    }
  }

  /**
   * Updates per-tool and aggregate counters from a recorded result.
   *
   * See {@link InvocationStore.record} for the executed/mock/cached semantics.
   */
  private updateStats(result: InvocationResult): void {
    const tool = result.tool;

    if (result.cached === true) {
      const stats = this.toolStats.get(tool) ?? createEmptyToolStats();
      stats.cacheHits += 1;
      this.toolStats.set(tool, stats);
      this.aggregate.cacheHits += 1;
      return;
    }

    let stats = this.toolStats.get(tool);
    if (stats === undefined) {
      stats = createEmptyToolStats();
      this.toolStats.set(tool, stats);
      this.toolOrder.push(tool);
    }

    stats.totalExecutions += 1;
    if (result.ok) {
      stats.successCount += 1;
    } else {
      stats.failureCount += 1;
    }
    stats.lastExecutedAt = result.timestamp;
    stats.averageDurationMs =
      (stats.averageDurationMs * (stats.totalExecutions - 1) +
        result.durationMs) /
      stats.totalExecutions;
    if (result.mock === true) {
      stats.mockExecutions += 1;
    }

    this.aggregate.totalExecutions += 1;
    if (result.ok) {
      this.aggregate.successCount += 1;
    } else {
      this.aggregate.failureCount += 1;
    }
    this.aggregate.totalDurationMs += result.durationMs;
    this.aggregate.lastExecutedAt = result.timestamp;
    if (result.mock === true) {
      this.aggregate.mockExecutions += 1;
    }
  }
}

/**
 * Returns `true` when `value` is a plain record (object, non-null,
 * non-array). Used for defensive snapshot parsing.
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerces an unknown value to a non-negative number, defaulting to `0`.
 */
function numOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Default exported convenience factory mirroring the class so consumers can
 * write `import createStore from './store.js'`.
 *
 * @param options optional `maxRecords` cap and `seed` snapshot.
 * @returns a new {@link InvocationStore}.
 */
export default function createStore(
  options: { maxRecords?: number; seed?: InvocationStoreSnapshot } = {},
): InvocationStore {
  return new InvocationStore(options);
}