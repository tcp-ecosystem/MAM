/**
 * @fileoverview
 * Lifecycle management for the Knowledge integration layer.
 *
 * A knowledge pipeline in production has three lifecycle concerns that the
 * store, index, and consolidator deliberately do not own:
 *
 *   1. **Ingestion + consolidation.**  New knowledge arrives in batches.  The
 *      lifecycle owns the ceremony of writing entries into the store and
 *      index, running the consolidator over them, and applying the resulting
 *      kept set back to both — all in one call.
 *   2. **Retention.**  Entries accumulate and go stale.  A long-lived process
 *      that never evicts them grows without bound, and stale entries silently
 *      poison later consolidation.  The lifecycle owns eviction policy.
 *   3. **Observation.**  Consumers want to know when consolidation happened,
 *      when entries were pruned, and when contradictions were surfaced, so
 *      they can feed dashboards, trigger re-integration, or cap memory.
 *
 * {@link IntegrateLifecycle} wraps a {@link KnowledgeStore}, a
 * {@link KnowledgeIndex}, and a {@link Consolidator} and provides:
 *
 *   - `integrate` — write entries, consolidate the pool, apply the result,
 *     and emit `consolidated` / `conflict` events;
 *   - `prune`     — evict down to a hard size bound, emitting `pruned`;
 *   - `clear`     — drop all data, keeping counters;
 *   - `reset`     — full teardown to a pristine state;
 *   - `start` / `stop` / `gcNow` — a periodic garbage collector that runs
 *     consolidation over the resident pool and keeps the store under a soft
 *     capacity and a recency TTL.
 *
 * Events are delivered through a standard `node:events` {@link EventEmitter}
 * and can be consumed with `on`/`once`/`off` or awaited with `once(...)`.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';
import {
  type Conflict,
  type ConsolidationResult,
  type IntegrateConfig,
  type IntegrateOptions,
  type KnowledgeEntry,
  assertConsolidationResult,
  assertKnowledgeEntry,
} from './types.js';
import { KnowledgeStore } from './store.js';
import { KnowledgeIndex } from './index.js';
import { Consolidator, compareEntryQuality } from './retrieval.js';

/**
 * Configuration for the lifecycle manager and its periodic garbage collector.
 */
export interface LifecycleOptions {
  /**
   * Interval between automatic GC passes, in milliseconds.  Must be at least
   * {@link MIN_GC_INTERVAL_MS}.  Defaults to `60_000` (one minute).
   */
  readonly gcIntervalMs?: number;

  /**
   * An entry is considered stale (and evicted by GC) when its last-seen time
   * is older than this many milliseconds.  Defaults to `3_600_000` (one
   * hour).  Pass `Infinity` to disable time-based eviction.
   */
  readonly idleTtlMs?: number;

  /**
   * Soft capacity: when the store grows past this many entries the GC prunes
   * it down to `pruneTarget`.  Defaults to `5_000`.
   */
  readonly pruneThreshold?: number;

  /**
   * The size the GC prunes the store down to when `pruneThreshold` is
   * exceeded.  Defaults to `pruneThreshold * 0.8`.
   */
  readonly pruneTarget?: number;

  /**
   * Whether to start the periodic GC immediately in the constructor.
   * Defaults to `false` — callers should `start()` explicitly so the timer is
   * created only when the process is actually ready for it.
   */
  readonly autoStart?: boolean;

  /**
   * The shared integration config handed to the consolidator.  Defaults to
   * {@link DEFAULT_INTEGRATE_CONFIG}.
   */
  readonly config?: IntegrateConfig;
}

/**
 * The report returned by {@link IntegrateLifecycle.gcNow} describing a single
 * garbage-collection pass.
 */
export interface GcReport {
  /** Number of resident entries before this pass. */
  readonly before: number;

  /** Number of entries fused into canonical forms during this pass. */
  readonly consolidations: number;

  /** Number of entries removed by consolidation (dedupe / filter / cap). */
  readonly removed: number;

  /** Number of contradictions detected during this pass. */
  readonly conflicts: number;

  /** Number of entries evicted because they were idle past the TTL. */
  readonly staleRemoved: number;

  /** Number of entries evicted to enforce the soft capacity. */
  readonly capacityRemoved: number;

  /** Total number of entries removed this pass. */
  readonly removedTotal: number;

  /** Number of resident entries after this pass. */
  readonly after: number;

  /** Unix epoch milliseconds at which the pass ran. */
  readonly at: number;
}

/**
 * Lifetime counters reported by {@link IntegrateLifecycle.stats}.
 */
export interface LifecycleStats {
  /** Total entries ingested via `integrate`. */
  readonly integrated: number;

  /** Cumulative merges across all consolidation runs. */
  readonly merged: number;

  /** Cumulative removals across all consolidation runs and prunes. */
  readonly removed: number;

  /** Cumulative contradictions detected. */
  readonly conflicts: number;

  /** Total entries pruned by `prune` and by GC passes. */
  readonly pruned: number;

  /** Number of GC passes run. */
  readonly gcRuns: number;

  /** Whether the periodic GC is currently running. */
  readonly running: boolean;

  /** Current store size. */
  readonly size: number;

  /** Store capacity. */
  readonly cap: number;
}

/**
 * The payload emitted with the `consolidated` event.
 */
export interface ConsolidatedEventPayload {
  /** Number of entries resident before consolidation was applied. */
  readonly before: number;

  /** The full consolidation result (kept set, counts, conflicts). */
  readonly result: ConsolidationResult;

  /** Number of entries resident after consolidation was applied. */
  readonly after: number;

  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `pruned` event.
 */
export interface PrunedEventPayload {
  /** Number of entries removed. */
  readonly count: number;

  /** The reason: `"capacity"`, `"stale"`, or `"manual"`. */
  readonly reason: 'capacity' | 'stale' | 'manual';

  /** Number of entries remaining after pruning. */
  readonly remaining: number;

  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `conflict` event (one per detected
 * contradiction).
 */
export interface ConflictEventPayload {
  /** The detected conflict. */
  readonly conflict: Conflict;

  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/** The default GC interval (one minute). */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/** The default idle TTL (one hour). */
export const DEFAULT_IDLE_TTL_MS = 3_600_000;

/** The default soft capacity. */
export const DEFAULT_PRUNE_THRESHOLD = 5_000;

/** Interval cap so a misconfigured lifecycle cannot spin at sub-millisecond rate. */
export const MIN_GC_INTERVAL_MS = 1_000;

/**
 * Owns ingestion, retention, periodic garbage collection, and lifecycle
 * events for a {@link KnowledgeStore}.
 *
 * The class is an {@link EventEmitter}; valid event names are:
 *
 *   - `'consolidated'` — fired whenever a consolidation run is applied.
 *   - `'conflict'`     — fired once per detected contradiction.
 *   - `'pruned'`       — fired whenever entries are removed by `prune` or GC.
 *   - `'cleared'`      — fired after `clear`.
 *   - `'reset'`        — fired after `reset`.
 *   - `'started'` / `'stopped'` — fired on GC start/stop.
 *   - `'tick'`         — fired after every GC pass with its {@link GcReport}.
 */
export class IntegrateLifecycle extends EventEmitter {
  private readonly storeInternal: KnowledgeStore;
  private readonly indexInternal: KnowledgeIndex;
  private readonly consolidator: Consolidator;

  private readonly gcIntervalMs: number;
  private readonly idleTtlMs: number;
  private readonly pruneThreshold: number;
  private readonly pruneTarget: number;

  private timer: ReturnType<typeof setInterval> | null = null;

  private integrated = 0;
  private mergedTotal = 0;
  private removedTotal = 0;
  private conflictsTotal = 0;
  private prunedTotal = 0;
  private gcRuns = 0;

  /**
   * Creates a lifecycle manager.
   *
   * @param store - The store to manage.  When omitted, a store is created
   *   with the default capacity.
   * @param index - An optional index kept in sync with every ingestion and
   *   consolidation.  When omitted the index is skipped entirely.
   * @param options - Lifecycle and GC tuning; normalized immediately.
   */
  constructor(
    store: KnowledgeStore = new KnowledgeStore(),
    index: KnowledgeIndex = new KnowledgeIndex(),
    options: LifecycleOptions = {},
  ) {
    super();
    this.storeInternal = store;
    this.indexInternal = index;
    this.consolidator = new Consolidator(options.config);

    this.gcIntervalMs = IntegrateLifecycle.normalizePositive(
      options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS,
      MIN_GC_INTERVAL_MS,
      'gcIntervalMs',
    );
    this.idleTtlMs =
      options.idleTtlMs === undefined
        ? DEFAULT_IDLE_TTL_MS
        : options.idleTtlMs === Infinity
          ? Infinity
          : IntegrateLifecycle.normalizePositive(options.idleTtlMs, 0, 'idleTtlMs');
    this.pruneThreshold = IntegrateLifecycle.normalizePositive(
      options.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD,
      1,
      'pruneThreshold',
    );
    this.pruneTarget =
      options.pruneTarget ?? Math.max(1, Math.floor(this.pruneThreshold * 0.8));
    IntegrateLifecycle.normalizePositive(this.pruneTarget, 1, 'pruneTarget');

    if (options.autoStart === true) this.start();
  }

  /** Returns the managed store. */
  get store(): KnowledgeStore {
    return this.storeInternal;
  }

  /** Returns the managed index. */
  get indexRef(): KnowledgeIndex {
    return this.indexInternal;
  }

  /** Returns whether the periodic GC is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Ingests new entries, consolidates the resident pool, and applies the
   * consolidated result back to the store and index in one call.
   *
   * The flow is:
   *   1. Every input entry is validated, stored in the registry, and indexed.
   *   2. The consolidator runs over the (now larger) resident pool, returning
   *      a {@link ConsolidationResult}.
   *   3. The result's `kept` set is applied wholesale to the store and index
   *      (removed/merged entries disappear; merged entries are re-installed
   *      in canonical form).
   *   4. A `consolidated` event fires when anything changed, plus one
   *      `conflict` event per detected contradiction.
   *
   * @param entries - The newly arrived knowledge.  May be empty (a no-op
   *   consolidation pass).
   * @param options - Per-run consolidation overrides.
   * @returns The consolidation result that was applied.
   */
  integrate(entries: readonly KnowledgeEntry[], options?: IntegrateOptions): ConsolidationResult {
    for (const entry of entries) {
      assertKnowledgeEntry(entry);
      this.storeInternal.put(entry);
      this.indexInternal.indexEntry(entry);
    }
    this.integrated += entries.length;

    const result = this.consolidator.consolidate(this.storeInternal.list(), options);
    return this.applyConsolidation(result);
  }

  /**
   * Evicts the lowest-quality entries until the store holds at most
   * `maxEntries`.
   *
   * @param maxEntries - Hard target size.  Must be a positive integer.  When
   *   it is at or above the current size this is a no-op returning `0`.
   * @returns The number of entries evicted.
   */
  prune(maxEntries: number): number {
    IntegrateLifecycle.normalizePositive(maxEntries, 1, 'maxEntries');
    const current = this.storeInternal.size;
    if (current <= maxEntries) return 0;

    const entries = this.storeInternal.list();
    entries.sort(compareEntryQuality);
    const toRemove = entries.slice(maxEntries);
    for (const entry of toRemove) {
      this.storeInternal.delete(entry.id);
      this.indexInternal.removeEntry(entry.id);
    }

    const removed = toRemove.length;
    this.prunedTotal += removed;
    this.removedTotal += removed;
    this.emit('pruned', {
      count: removed,
      reason: 'manual',
      remaining: this.storeInternal.size,
      at: Date.now(),
    } satisfies PrunedEventPayload);
    return removed;
  }

  /**
   * Drops all data from the store and index but keeps lifetime counters and
   * the GC timer state.  Use {@link reset} for a full teardown.
   */
  clear(): void {
    this.storeInternal.clear();
    this.indexInternal.clear();
    this.emit('cleared', { at: Date.now() });
  }

  /**
   * Fully reinitializes the manager: stops the GC, clears all data, and zeroes
   * every lifetime counter.  Listeners are preserved.
   */
  reset(): void {
    this.stop();
    this.storeInternal.clear();
    this.indexInternal.clear();
    this.integrated = 0;
    this.mergedTotal = 0;
    this.removedTotal = 0;
    this.conflictsTotal = 0;
    this.prunedTotal = 0;
    this.gcRuns = 0;
    this.emit('reset', { at: Date.now() });
  }

  /**
   * Arms the periodic garbage collector.  Idempotent: calling `start` on an
   * already-running lifecycle does nothing.
   *
   * @returns `true` when the timer was newly created, `false` when it was
   *   already running.
   */
  start(): boolean {
    if (this.timer !== null) return false;
    this.timer = setInterval(() => {
      this.gcNow();
    }, this.gcIntervalMs);
    this.timer.unref?.();
    this.emit('started', { intervalMs: this.gcIntervalMs, at: Date.now() });
    return true;
  }

  /**
   * Disarms the periodic garbage collector.  Idempotent.
   *
   * @returns `true` when a running timer was stopped, `false` when none was
   *   armed.
   */
  stop(): boolean {
    if (this.timer === null) return false;
    clearInterval(this.timer);
    this.timer = null;
    this.emit('stopped', { at: Date.now() });
    return true;
  }

  /**
   * Runs a single garbage-collection pass immediately and returns the report.
   *
   * The pass has three phases:
   *   1. **Consolidation** — the consolidator runs over the whole resident
   *      pool and the result is applied back to the store and index
   *      (deduping, merging, and surfacing conflicts).
   *   2. **Stale eviction** — entries whose last-seen time is older than the
   *      configured TTL are removed (skipped when the TTL is `Infinity`).
   *   3. **Capacity enforcement** — when the store still exceeds
   *      `pruneThreshold`, lowest-quality entries are evicted down to
   *      `pruneTarget`.
   *
   * A `consolidated` event fires when consolidation changed anything, a
   * `conflict` event fires per detected contradiction, a `pruned` event fires
   * for each eviction phase that removed entries, and a `tick` event always
   * fires with the report.
   */
  gcNow(): GcReport {
    this.gcRuns += 1;
    const before = this.storeInternal.size;
    let conflictCount = 0;

    // Phase 1: consolidation over the resident pool.
    const result = this.consolidator.consolidate(this.storeInternal.list());
    this.applyConsolidation(result);
    conflictCount = result.conflicts.length;

    // Phase 2: stale eviction.
    let staleRemoved = 0;
    if (this.idleTtlMs !== Infinity) {
      const cutoff = Date.now() - this.idleTtlMs;
      const keys = this.storeInternal.keys();
      for (const key of keys) {
        const at = this.storeInternal.lastSeenAt(key);
        if (at === undefined || at < cutoff) {
          if (this.storeInternal.delete(key)) {
            this.indexInternal.removeEntry(key);
            staleRemoved += 1;
          }
        }
      }
      if (staleRemoved > 0) {
        this.prunedTotal += staleRemoved;
        this.removedTotal += staleRemoved;
        this.emit('pruned', {
          count: staleRemoved,
          reason: 'stale',
          remaining: this.storeInternal.size,
          at: Date.now(),
        } satisfies PrunedEventPayload);
      }
    }

    // Phase 3: capacity enforcement.
    let capacityRemoved = 0;
    const sizeAfterStale = this.storeInternal.size;
    if (sizeAfterStale > this.pruneThreshold) {
      const target = Math.min(this.pruneTarget, sizeAfterStale - 1);
      const entries = this.storeInternal.list();
      entries.sort(compareEntryQuality);
      const toRemove = entries.slice(target);
      for (const entry of toRemove) {
        this.storeInternal.delete(entry.id);
        this.indexInternal.removeEntry(entry.id);
      }
      capacityRemoved = toRemove.length;
      if (capacityRemoved > 0) {
        this.prunedTotal += capacityRemoved;
        this.removedTotal += capacityRemoved;
        this.emit('pruned', {
          count: capacityRemoved,
          reason: 'capacity',
          remaining: this.storeInternal.size,
          at: Date.now(),
        } satisfies PrunedEventPayload);
      }
    }

    const report: GcReport = {
      before,
      consolidations: result.merged,
      removed: result.removed,
      conflicts: conflictCount,
      staleRemoved,
      capacityRemoved,
      removedTotal: result.removed + staleRemoved + capacityRemoved,
      after: this.storeInternal.size,
      at: Date.now(),
    };
    this.emit('tick', report);
    return report;
  }

  /**
   * Returns lifetime counters plus the store's capacity accounting.
   */
  stats(): LifecycleStats {
    return {
      integrated: this.integrated,
      merged: this.mergedTotal,
      removed: this.removedTotal,
      conflicts: this.conflictsTotal,
      pruned: this.prunedTotal,
      gcRuns: this.gcRuns,
      running: this.running,
      size: this.storeInternal.size,
      cap: this.storeInternal.cap,
    };
  }

  /**
   * Stops the GC and removes every event listener.  Call in shutdown paths to
   * let the event loop drain cleanly.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Applies a {@link ConsolidationResult} to the store and index.
   *
   * The `kept` set is installed wholesale (via the store's `replaceAll` and
   * the index's `rebuild`, so merged entries are re-installed in canonical
   * form and removed entries disappear everywhere), the merge/removal/conflict
   * counters are updated, and `consolidated` / `conflict` events are emitted
   * when anything of note happened.
   *
   * @returns The result that was applied (validated on the way in).
   */
  private applyConsolidation(result: ConsolidationResult): ConsolidationResult {
    assertConsolidationResult(result);

    const before = this.storeInternal.size;
    this.storeInternal.replaceAll(result.kept);
    this.indexInternal.rebuild(result.kept);

    this.mergedTotal += result.merged;
    this.removedTotal += result.removed;
    this.conflictsTotal += result.conflicts.length;
    this.storeInternal.recordMerged(result.merged);
    this.storeInternal.recordRemoved(result.removed);

    for (const conflict of result.conflicts) {
      this.emit('conflict', { conflict, at: Date.now() } satisfies ConflictEventPayload);
    }
    if (result.merged > 0 || result.removed > 0 || result.conflicts.length > 0) {
      this.emit('consolidated', {
        before,
        result,
        after: this.storeInternal.size,
        at: Date.now(),
      } satisfies ConsolidatedEventPayload);
    }
    return result;
  }

  /** Normalizes a positive numeric option, throwing a {@link RangeError}. */
  private static normalizePositive(
    value: number,
    min: number,
    name: string,
  ): number {
    if (!Number.isFinite(value) || value < min) {
      throw new RangeError(`${name} must be a finite number >= ${min}, got ${value}`);
    }
    return value;
  }
}