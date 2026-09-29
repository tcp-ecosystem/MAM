/**
 * lifecycle.ts
 *
 * {@link CostLifecycle} — retention, reset and periodic rollup for the Costs
 * layer, wired up as a typed `EventEmitter`.
 *
 * The lifecycle owns the *time dimension* of cost data:
 *
 *  - **Pruning** — `prune(olderThanMs)` deletes records older than a retention
 *    window and emits a `prune` event with the removed records so downstream
 *    sinks (analytics, billing exports) can persist them before they vanish.
 *  - **Reset** — `reset()` clears everything atomically and emits `reset`.
 *  - **Periodic rollup** — `start(intervalMs)` runs a background timer that
 *    snapshots the store's statistics and emits `rollup` on every tick,
 *    giving dashboards a cheap, consistent summary without polling the store
 *    directly.
 *
 * The lifecycle also hosts an optional {@link CostIndex} so pruned records are
 * removed from both the store and the secondary indexes together, keeping the
 * two consistent.
 *
 * Events (see {@link COST_EVENTS}):
 *  - `record` — emitted after a record is added via `addRecord`.
 *  - `prune`  — emitted after pruning, payload `{ removed, cutoff }`.
 *  - `reset`  — emitted after a reset.
 *  - `rollup` — emitted on every periodic tick with the latest {@link CostStats}.
 *  - `start` / `stop` — emitted when the timer is started/stopped.
 *  - `error`  — emitted when a rollup or prune throws.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';
import { type CostOptions, type CostRecord, type CostRecordInput, type CostStats, CostError, roundCost } from './types.js';
import { CostStore } from './store.js';
import { CostIndex } from './index.js';

/**
 * Canonical event names for {@link CostLifecycle}. Keeping them in a frozen
 * object lets consumers import the constants instead of raw string literals.
 */
export const COST_EVENTS = {
  RECORD: 'record',
  PRUNE: 'prune',
  RESET: 'reset',
  ROLLUP: 'rollup',
  START: 'start',
  STOP: 'stop',
  ERROR: 'error',
} as const;

/**
 * Union of all valid lifecycle event names.
 */
export type CostEventName = (typeof COST_EVENTS)[keyof typeof COST_EVENTS];

/**
 * Payload emitted with the `prune` event.
 */
export interface PruneEvent {
  /**
   * Records that were removed by the prune.
   */
  removed: CostRecord[];
  /**
   * The cutoff timestamp used: records with `timestamp < cutoff` were removed.
   */
  cutoff: number;
  /**
   * Total cost of the removed records.
   */
  removedCost: number;
}

/**
 * Configuration for constructing a {@link CostLifecycle}.
 */
export interface CostLifecycleOptions {
  /**
   * Store to manage. Created internally when omitted.
   */
  store?: CostStore;
  /**
   * Optional secondary index kept in sync with the store. Created internally
   * when omitted.
   */
  index?: CostIndex;
  /**
   * Store construction options when the store is created internally.
   */
  storeOptions?: CostOptions;
  /**
   * Whether to create and keep the secondary index in sync. Defaults to `true`.
   */
  useIndex?: boolean;
  /**
   * Whether the periodic rollup timer starts immediately. Defaults to `false`.
   */
  autoStart?: boolean;
  /**
   * Interval (ms) for the periodic rollup when started. Defaults to 60_000.
   */
  rollupIntervalMs?: number;
  /**
   * Default retention window (ms) used when `prune()` is called without args.
   */
  defaultRetentionMs?: number;
}

/**
 * CostLifecycle
 *
 * An `EventEmitter` that manages retention, reset and periodic rollup over a
 * {@link CostStore} (and an optional {@link CostIndex}). Use `addRecord` as the
 * single write entry point when you want every write to be observable via
 * events; otherwise use the store directly and drive pruning manually.
 */
export class CostLifecycle extends EventEmitter {
  /** The underlying store. */
  readonly store: CostStore;

  /** The secondary index, when enabled. */
  readonly index?: CostIndex;

  /** Interval (ms) used when the timer is started without an explicit value. */
  private readonly intervalMs: number;

  /** Default retention window for arg-less prunes. */
  private readonly defaultRetentionMs: number | undefined;

  /** Handle of the running rollup timer, or `null` when stopped. */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Latest rollup snapshot produced by {@link CostLifecycle.rollup}. */
  private lastRollup: CostStats | null = null;

  /**
   * @param options - Lifecycle configuration (see {@link CostLifecycleOptions}).
   */
  constructor(options: CostLifecycleOptions = {}) {
    super();
    const useIndex = options.useIndex ?? true;
    this.store = options.store ?? new CostStore(options.storeOptions);
    this.index = useIndex ? (options.index ?? new CostIndex()) : options.index;
    this.intervalMs = options.rollupIntervalMs ?? 60_000;
    this.defaultRetentionMs = options.defaultRetentionMs;
    if (options.autoStart === true) this.start();
  }

  /**
   * Whether the periodic rollup timer is currently running.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * The most recent rollup snapshot, or `null` before the first rollup.
   */
  get lastStats(): CostStats | null {
    return this.lastRollup;
  }

  /**
   * Records a call through the lifecycle: writes to the store, mirrors into
   * the index and emits `record`.
   *
   * @param input - The call to record.
   * @returns The stored, normalized record.
   */
  addRecord(input: CostRecordInput): CostRecord {
    const record = this.store.record(input);
    this.index?.indexRecord(record);
    this.emit(COST_EVENTS.RECORD, record);
    return record;
  }

  /**
   * Adds many records at once, emitting one `record` event per record.
   *
   * @param inputs - Calls to record.
   * @returns The stored, normalized records.
   */
  addRecords(inputs: readonly CostRecordInput[]): CostRecord[] {
    return inputs.map((input) => this.addRecord(input));
  }

  /**
   * Prunes records older than a retention window.
   *
   * Records with `timestamp < cutoff` (where `cutoff = now - olderThanMs`)
   * are removed from the store and, when enabled, from the index. A `prune`
   * event carrying the removed records is emitted afterwards.
   *
   * @param olderThanMs - Retention window in ms. Defaults to the configured
   *   `defaultRetentionMs`; when neither is set, nothing is pruned.
   * @returns The removed records.
   */
  prune(olderThanMs?: number): CostRecord[] {
    const retention = olderThanMs ?? this.defaultRetentionMs;
    if (retention === undefined) return [];
    if (!Number.isFinite(retention) || retention < 0) {
      const error = new CostError('ERR_INVALID_RETENTION', `retention must be a non-negative ms value, got ${retention}`);
      this.emit(COST_EVENTS.ERROR, error);
      throw error;
    }
    const cutoff = Date.now() - retention;
    const removed = this.pruneBefore(cutoff);
    return removed;
  }

  /**
   * Prunes every record with `timestamp < cutoff`. Shared implementation for
   * {@link CostLifecycle.prune} and time-travel tests.
   *
   * @param cutoff - Exclusive upper bound on kept timestamps.
   * @returns The removed records.
   */
  pruneBefore(cutoff: number): CostRecord[] {
    const removed: CostRecord[] = [];
    for (const id of this.store.ids()) {
      const record = this.store.get(id);
      if (record === undefined || record.timestamp >= cutoff) continue;
      if (this.store.delete(id)) {
        this.index?.removeRecord(id);
        removed.push(record);
      }
    }
    if (removed.length > 0) {
      const removedCost = roundCost(removed.reduce((sum, record) => sum + record.cost, 0));
      const event: PruneEvent = { removed, cutoff, removedCost };
      this.emit(COST_EVENTS.PRUNE, event);
    }
    return removed;
  }

  /**
   * Removes every record below a cost threshold. Useful for dropping
   * sub-cent noise before exporting.
   *
   * @param maxCost - Records with `cost < maxCost` are pruned.
   * @returns The removed records.
   */
  pruneCheap(maxCost: number): CostRecord[] {
    const removed: CostRecord[] = [];
    for (const id of this.store.ids()) {
      const record = this.store.get(id);
      if (record === undefined || record.cost >= maxCost) continue;
      if (this.store.delete(id)) {
        this.index?.removeRecord(id);
        removed.push(record);
      }
    }
    if (removed.length > 0) {
      this.emit(COST_EVENTS.PRUNE, { removed, cutoff: Date.now(), removedCost: roundCost(removed.reduce((s, r) => s + r.cost, 0)) } satisfies PruneEvent);
    }
    return removed;
  }

  /**
   * Atomically clears the store, the index and the last rollup snapshot, then
   * emits `reset`.
   */
  reset(): void {
    this.store.clear();
    this.index?.clear();
    this.lastRollup = null;
    this.emit(COST_EVENTS.RESET);
  }

  /**
   * Starts the periodic rollup timer.
   *
   * Every `intervalMs` the store is snapshotted via {@link CostLifecycle.rollup}
   * and a `rollup` event is emitted. Starting twice is a no-op.
   *
   * @param intervalMs - Override for the configured interval. Must be >= 10ms.
   * @returns This lifecycle, for chaining.
   * @throws CostError when `intervalMs` is too small.
   */
  start(intervalMs?: number): this {
    const interval = intervalMs ?? this.intervalMs;
    if (!Number.isFinite(interval) || interval < 10) {
      throw new CostError('ERR_INVALID_INTERVAL', `rollup interval must be >= 10ms, got ${interval}`);
    }
    if (this.timer !== null) return this;
    this.timer = setInterval(() => {
      try {
        this.rollup();
      } catch (error) {
        this.emit(COST_EVENTS.ERROR, error);
      }
    }, interval);
    this.emit(COST_EVENTS.START, interval);
    return this;
  }

  /**
   * Stops the periodic rollup timer. Stopping when already stopped is a no-op.
   *
   * @returns This lifecycle, for chaining.
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.emit(COST_EVENTS.STOP);
    }
    return this;
  }

  /**
   * Computes a fresh {@link CostStats} snapshot from the store, caches it and
   * emits `rollup`. Safe to call manually at any time.
   *
   * @returns The computed statistics.
   */
  rollup(): CostStats {
    const stats = this.store.stats();
    this.lastRollup = stats;
    this.emit(COST_EVENTS.ROLLUP, stats);
    return stats;
  }

  /**
   * Total cost currently tracked by the lifecycle.
   *
   * @returns Sum of all record costs.
   */
  total(): number {
    return this.store.getTotal();
  }

  /**
   * Statistics snapshot without emitting events.
   *
   * @returns Current store statistics.
   */
  stats(): CostStats {
    return this.store.stats();
  }

  /**
   * Stops the timer and removes all listeners, releasing the lifecycle.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}