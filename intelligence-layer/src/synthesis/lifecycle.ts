/**
 * @fileoverview
 * Lifecycle management for the Answer synthesis layer.
 *
 * A synthesis pipeline in production has two lifecycle concerns that the
 * synthesizer, store, and index deliberately do not own:
 *
 *   1. **Retention.**  Synthesized answers accumulate.  A long-lived process
 *      that never evicts them grows without bound, and stale answers — an
 *      answer built from evidence that has since changed — silently poison
 *      later queries.  The lifecycle owns eviction policy.
 *
 *   2. **Observation.**  Consumers want to know when answers were synthesized
 *      and when entries were pruned, so they can feed dashboards, trigger
 *      re-synthesis, or cap memory.
 *
 * {@link SynthesisLifecycle} wraps a {@link SynthesisStore} (and optionally a
 * {@link SynthesisIndex}) and provides:
 *
 *   - `record`   — write an answer and emit a `synthesized` event when it is
 *     grounded;
 *   - `prune`    — evict down to a hard size bound, emitting `pruned`;
 *   - `clear`    — drop all data, keeping counters;
 *   - `reset`    — full teardown to a pristine state;
 *   - `start` / `stop` / `gcNow` — a periodic garbage collector that evicts
 *     entries idle past a TTL and keeps the store under a soft capacity.
 *
 * Events are delivered through a standard `node:events` {@link EventEmitter}
 * and can be consumed with `on`/`once`/`off` or awaited with `once(...)`.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';
import {
  type Answer,
  assertAnswer,
} from './types.js';
import { SynthesisStore, type CacheStats } from './store.js';
import { SynthesisIndex } from './index.js';

/**
 * Configuration for the lifecycle manager and its periodic garbage collector.
 */
export interface LifecycleOptions {
  /**
   * Interval between automatic GC passes, in milliseconds.  Must be positive.
   * Defaults to `60_000` (one minute).
   */
  readonly gcIntervalMs?: number;

  /**
   * An entry is considered stale (and evicted by GC) when its last access
   * time is older than this many milliseconds.  Defaults to `3_600_000`
   * (one hour).  Pass `Infinity` to disable time-based eviction.
   */
  readonly idleTtlMs?: number;

  /**
   * Soft capacity: when the store grows past this many entries the GC prunes
   * it down to `pruneTarget`.  Defaults to `500`.  Must not exceed the store
   * cap or time-based eviction is the only active policy.
   */
  readonly pruneThreshold?: number;

  /**
   * The size the GC prunes the store down to when `pruneThreshold` is
   * exceeded.  Defaults to `pruneThreshold * 0.8` (i.e. 400 for the default).
   */
  readonly pruneTarget?: number;

  /**
   * Whether to start the periodic GC immediately in the constructor.
   * Defaults to `false` — callers should `start()` explicitly so the timer is
   * created only when the process is actually ready for it.
   */
  readonly autoStart?: boolean;
}

/**
 * The report returned by {@link SynthesisLifecycle.gcNow} describing a single
 * garbage-collection pass.
 */
export interface GcReport {
  /** Number of resident entries before this pass. */
  readonly before: number;

  /** Number of entries evicted because they were idle past the TTL. */
  readonly staleRemoved: number;

  /** Number of entries evicted to enforce the soft capacity. */
  readonly capacityRemoved: number;

  /** Total number of entries removed this pass. */
  readonly removed: number;

  /** Number of resident entries after this pass. */
  readonly after: number;

  /** Unix epoch milliseconds at which the pass ran. */
  readonly at: number;
}

/**
 * Lifetime counters reported by {@link SynthesisLifecycle.stats}.
 */
export interface LifecycleStats {
  /** Total answers recorded via `record`. */
  readonly recorded: number;

  /** Total answers that were grounded at record time. */
  readonly grounded: number;

  /** Total answers that were ungrounded at record time. */
  readonly ungrounded: number;

  /** Total entries pruned (by `prune` and by GC passes). */
  readonly pruned: number;

  /** Number of GC passes run. */
  readonly gcRuns: number;

  /** Whether the periodic GC is currently running. */
  readonly running: boolean;

  /** Current store size. */
  readonly size: number;

  /** Store capacity. */
  readonly cap: number;

  /** Cache hit/miss accounting from the store. */
  readonly cache: CacheStats;
}

/**
 * A convenience bundle emitted with the `synthesized` event.
 */
export interface SynthesizedEventPayload {
  /** The query the answer was synthesized for. */
  readonly query: string;

  /** The synthesized answer. */
  readonly answer: Answer;

  /** The key under which the answer was stored. */
  readonly key: string;

  /** The answer's confidence. */
  readonly confidence: number;

  /** Whether the answer was grounded. */
  readonly grounded: boolean;

  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `pruned` event.
 */
export interface PrunedEventPayload {
  /** Number of entries removed. */
  readonly count: number;

  /** The reason: `"capacity"` (size bound) or `"stale"` (TTL) or `"manual"`. */
  readonly reason: 'capacity' | 'stale' | 'manual';

  /** Number of entries remaining after pruning. */
  readonly remaining: number;
}

/** The default GC interval (one minute). */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/** The default idle TTL (one hour). */
export const DEFAULT_IDLE_TTL_MS = 3_600_000;

/** The default soft capacity. */
export const DEFAULT_PRUNE_THRESHOLD = 500;

/** Interval cap so a misconfigured lifecycle cannot spin at sub-millisecond rate. */
export const MIN_GC_INTERVAL_MS = 1_000;

/**
 * Owns eviction policy, periodic garbage collection, and lifecycle events for
 * a {@link SynthesisStore}.
 *
 * The class is an {@link EventEmitter}; valid event names are:
 *
 *   - `'synthesized'` — fired once per grounded answer inside `record`.
 *   - `'pruned'`      — fired whenever entries are removed by `prune` or GC.
 *   - `'cleared'`     — fired after `clear`.
 *   - `'reset'`       — fired after `reset`.
 *   - `'started'` / `'stopped'` — fired on GC start/stop.
 *   - `'tick'`        — fired after every GC pass with its {@link GcReport}.
 */
export class SynthesisLifecycle extends EventEmitter {
  private readonly storeInternal: SynthesisStore;
  private readonly index: SynthesisIndex | null;

  private readonly gcIntervalMs: number;
  private readonly idleTtlMs: number;
  private readonly pruneThreshold: number;
  private readonly pruneTarget: number;

  private timer: ReturnType<typeof setInterval> | null = null;

  private recorded = 0;
  private groundedTotal = 0;
  private ungroundedTotal = 0;
  private prunedTotal = 0;
  private gcRuns = 0;

  /**
   * Creates a lifecycle manager.
   *
   * @param store - The store to manage.  When omitted, a store is created with
   *   the default capacity.  The store's capacity is the hard bound for the
   *   store; lifecycle pruning targets must be at or below it.
   * @param index - An optional index kept in sync with `record`.  When
   *   omitted the index is skipped entirely.
   * @param options - Lifecycle and GC tuning; normalized immediately.
   */
  constructor(
    store: SynthesisStore = new SynthesisStore(),
    index: SynthesisIndex | null = null,
    options: LifecycleOptions = {},
  ) {
    super();
    this.storeInternal = store;
    this.index = index;

    this.gcIntervalMs = SynthesisLifecycle.normalizePositive(
      options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS,
      MIN_GC_INTERVAL_MS,
      'gcIntervalMs',
    );
    this.idleTtlMs =
      options.idleTtlMs === undefined
        ? DEFAULT_IDLE_TTL_MS
        : options.idleTtlMs === Infinity
          ? Infinity
          : SynthesisLifecycle.normalizePositive(options.idleTtlMs, 0, 'idleTtlMs');
    this.pruneThreshold = SynthesisLifecycle.normalizePositive(
      options.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD,
      1,
      'pruneThreshold',
    );
    this.pruneTarget =
      options.pruneTarget ??
      Math.max(1, Math.floor(this.pruneThreshold * 0.8));
    SynthesisLifecycle.normalizePositive(this.pruneTarget, 1, 'pruneTarget');

    if (options.autoStart === true) this.start();
  }

  /** Returns the managed store. */
  get store(): SynthesisStore {
    return this.storeInternal;
  }

  /** Returns the managed index, or `null` when none was provided. */
  get indexRef(): SynthesisIndex | null {
    return this.index;
  }

  /** Returns whether the periodic GC is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Records a synthesized answer into the store (and index, when one is
   * attached) and emits a `synthesized` event when the answer is grounded.
   *
   * The answer is validated before it touches any structure, so a malformed
   * value throws here rather than corrupting the store.  When a `query` is
   * supplied the key is its content hash (so the store's `getFor` retrieves
   * the answer by query); otherwise the key is derived from the answer's
   * assembled text.  Re-recording is idempotent in both cases.
   *
   * @returns The key under which the answer was stored.
   */
  record(answer: Answer, query?: string): string {
    assertAnswer(answer);
    let key: string;
    if (query !== undefined && query.length > 0) {
      key = this.storeInternal.putFor(query, answer);
    } else {
      key = SynthesisStore.hashText(answer.text);
      this.storeInternal.put(key, answer);
    }
    this.index?.indexAnswer(answer, key);
    this.recorded += 1;
    if (answer.grounded) this.groundedTotal += 1;
    else this.ungroundedTotal += 1;

    if (answer.grounded) {
      const payload: SynthesizedEventPayload = {
        query: query ?? '',
        answer,
        key,
        confidence: answer.confidence,
        grounded: true,
        at: Date.now(),
      };
      this.emit('synthesized', payload);
    }
    return key;
  }

  /**
   * Evicts the least-recently-used entries until the store holds at most
   * `maxEntries`.
   *
   * @param maxEntries - Hard target size.  Must be a positive integer.  When
   *   it is at or above the current size this is a no-op returning `0`.
   * @returns The number of entries evicted.
   */
  prune(maxEntries: number): number {
    SynthesisLifecycle.normalizePositive(maxEntries, 1, 'maxEntries');
    const current = this.storeInternal.size;
    if (current <= maxEntries) return 0;

    const toEvict = current - maxEntries;
    const removed = this.storeInternal.evictOldest(toEvict);
    this.prunedTotal += removed;
    const payload: PrunedEventPayload = {
      count: removed,
      reason: 'manual',
      remaining: this.storeInternal.size,
    };
    this.emit('pruned', payload);
    return removed;
  }

  /**
   * Drops all cached data and index contents but keeps lifetime counters and
   * the GC timer state.  Use {@link reset} for a full teardown.
   */
  clear(): void {
    this.storeInternal.clear();
    this.index?.clear();
    this.emit('cleared', { at: Date.now() });
  }

  /**
   * Fully reinitializes the manager: stops the GC, clears all data and index
   * contents, and zeroes every lifetime counter.  Listeners are preserved.
   */
  reset(): void {
    this.stop();
    this.storeInternal.clear();
    this.index?.clear();
    this.recorded = 0;
    this.groundedTotal = 0;
    this.ungroundedTotal = 0;
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
   * The pass has two phases:
   *   1. **Stale eviction** — entries whose last access is older than the
   *      configured TTL are removed (skipped when the TTL is `Infinity`).
   *   2. **Capacity enforcement** — when the store still exceeds
   *      `pruneThreshold`, oldest entries are evicted down to `pruneTarget`.
   *
   * A `pruned` event fires for each phase that removed entries, and a `tick`
   * event always fires with the report.
   */
  gcNow(): GcReport {
    this.gcRuns += 1;
    const before = this.storeInternal.size;
    let staleRemoved = 0;
    let capacityRemoved = 0;

    if (this.idleTtlMs !== Infinity) {
      const cutoff = Date.now() - this.idleTtlMs;
      const keys = this.storeInternal.keys();
      for (const key of keys) {
        const at = this.storeInternal.lastAccessAt(key);
        if (at === undefined || at < cutoff) {
          if (this.storeInternal.delete(key)) staleRemoved += 1;
        }
      }
      if (staleRemoved > 0) {
        this.prunedTotal += staleRemoved;
        this.emit('pruned', {
          count: staleRemoved,
          reason: 'stale',
          remaining: this.storeInternal.size,
        } satisfies PrunedEventPayload);
      }
    }

    const sizeAfterStale = this.storeInternal.size;
    if (sizeAfterStale > this.pruneThreshold) {
      const target = Math.min(this.pruneTarget, sizeAfterStale - 1);
      capacityRemoved = this.storeInternal.evictOldest(sizeAfterStale - target);
      if (capacityRemoved > 0) {
        this.prunedTotal += capacityRemoved;
        this.emit('pruned', {
          count: capacityRemoved,
          reason: 'capacity',
          remaining: this.storeInternal.size,
        } satisfies PrunedEventPayload);
      }
    }

    const report: GcReport = {
      before,
      staleRemoved,
      capacityRemoved,
      removed: staleRemoved + capacityRemoved,
      after: this.storeInternal.size,
      at: Date.now(),
    };
    this.emit('tick', report);
    return report;
  }

  /**
   * Returns lifetime counters plus the store's cache accounting.
   */
  stats(): LifecycleStats {
    return {
      recorded: this.recorded,
      grounded: this.groundedTotal,
      ungrounded: this.ungroundedTotal,
      pruned: this.prunedTotal,
      gcRuns: this.gcRuns,
      running: this.running,
      size: this.storeInternal.size,
      cap: this.storeInternal.cap,
      cache: this.storeInternal.cacheStats(),
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