/**
 * Lifecycle management for the **Prioritization** layer of the standalone MAM
 * Context Engine.
 *
 * {@link PriorityLifecycle} owns the housekeeping a long-running engine needs:
 * keeping the {@link PriorityStore} score cache bounded, forgetting parts that
 * have been dropped from the context, resetting the whole subsystem, and
 * driving periodic pruning on a timer so the cache never silently grows without
 * bound.
 *
 * Responsibilities:
 *
 * - **Prune** — {@link PriorityLifecycle.prune} evicts the lowest-scoring
 *   entries when the store exceeds its cap, and can additionally forget scores
 *   older than a configurable TTL. It is callable on demand.
 * - **Forget** — {@link PriorityLifecycle.clearPart} removes the cached score
 *   for a single part id (e.g. when the part itself is evicted from context).
 * - **Reset** — {@link PriorityLifecycle.reset} clears the store entirely and
 *   restarts the pruning timer with fresh state.
 * - **Schedule** — {@link PriorityLifecycle.start} / {@link PriorityLifecycle
 *   .stop} start and stop the periodic prune interval; the lifecycle is safe to
 *   use without ever calling `start` (pruning then just happens on demand).
 * - **Observe** — emits `'prune'` and `'scored'` events so the integration
 *   facades and monitoring can react without polling.
 *
 * The lifecycle holds only a *reference* to the store it manages — it does not
 * own the store's data. Two lifecycles pointed at the same store coordinate
 * with each other naturally, because all mutation flows through the store's own
 * guards and events.
 *
 * Uses `node:events`' `EventEmitter`, extending it so consumers can attach
 * `'prune'` / `'scored'` listeners directly.
 *
 * @module prioritization/lifecycle
 */

import { EventEmitter } from 'node:events';

import { DEFAULT_MAX_ENTRIES } from './types.js';
import type { PriorityScore, Timestamp } from './types.js';
import type { PriorityStore } from './store.js';

/**
 * Payload emitted by the lifecycle's `'prune'` event.
 */
export interface PriorityLifecyclePruneEvent {
  /**
   * Number of entries evicted by this prune.
   */
  readonly removed: number;

  /**
   * Size of the store immediately after the prune.
   */
  readonly size: number;

  /**
   * Epoch-millisecond time the prune ran.
   */
  readonly timestamp: Timestamp;
}

/**
 * Payload emitted by the lifecycle's `'scored'` event (forwarded from the
 * store's `'put'` event).
 */
export interface PriorityLifecycleScoredEvent {
  /**
   * Part id that was scored (or `'*'` for a batch put).
   */
  readonly partId: string;

  /**
   * The score value, or the batch size when `partId` is `'*'`.
   */
  readonly score: number;

  /**
   * Epoch-millisecond time the score was recorded.
   */
  readonly timestamp: Timestamp;
}

/**
 * Construction options for a {@link PriorityLifecycle}.
 */
export interface PriorityLifecycleOptions {
  /**
   * The store this lifecycle manages. Required — the lifecycle refuses to
   * construct without one.
   */
  readonly store: PriorityStore;

  /**
   * Maximum entries the store may hold before a prune evicts the lowest
   * scorers. Defaults to {@link DEFAULT_MAX_ENTRIES}. `0` disables the cap.
   */
  readonly maxEntries?: number;

  /**
   * Entries whose scores are older than this many milliseconds are evicted on
   * prune even if the store is under its cap. `0` (default) disables TTL
   * pruning entirely.
   */
  readonly ttlMs?: number;

  /**
   * Interval, in milliseconds, at which {@link PriorityLifecycle.start}
   * schedules a prune. Defaults to `60_000` (once a minute).
   */
  readonly intervalMs?: number;

  /**
   * Whether to begin pruning on a timer immediately upon construction.
   * Defaults to `true`.
   */
  readonly autoStart?: boolean;

  /**
   * Clock used for all timestamps. Injecting a clock makes the lifecycle
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Lifecycle manager for the Prioritization layer.
 *
 * @example
 * ```ts
 * const lifecycle = new PriorityLifecycle({ store, maxEntries: 5000, ttlMs: 86_400_000 });
 * lifecycle.on('prune', (e) => console.log(`pruned ${e.removed}`));
 * lifecycle.start();
 * // ...later...
 * lifecycle.stop();
 * ```
 *
 * @fires PriorityLifecycle#prune
 * @fires PriorityLifecycle#scored
 */
export class PriorityLifecycle extends EventEmitter {
  /** The store being managed. */
  private readonly _store: PriorityStore;

  /** Entry cap enforced on prune. */
  private readonly _maxEntries: number;

  /** TTL in ms; `0` disables TTL pruning. */
  private readonly _ttlMs: number;

  /** Prune interval in ms. */
  private readonly _intervalMs: number;

  /** Clock used for `_now()`. */
  private readonly _now: () => Timestamp;

  /** Handle of the running interval, or `undefined` when stopped. */
  private _timer: ReturnType<typeof setInterval> | undefined;

  /** Whether the lifecycle is currently started. */
  private _started: boolean;

  /** Whether a prune is currently in flight (re-entrancy guard). */
  private _pruning: boolean;

  /**
   * @param options - construction options
   */
  constructor(options: PriorityLifecycleOptions) {
    super();
    this._store = options.store;
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._ttlMs = options.ttlMs ?? 0;
    this._intervalMs = options.intervalMs ?? 60_000;
    this._now = options.now ?? (() => Date.now());
    this._started = false;
    this._pruning = false;
    this._lastScored = new Map<string, Timestamp>();

    this._store.on('put', (event: { partId: string; score: number; timestamp: Timestamp }) => {
      const scoredEvent: PriorityLifecycleScoredEvent = {
        partId: event.partId,
        score: event.score,
        timestamp: event.timestamp,
      };
      this.emit('scored', scoredEvent);
      if (event.partId !== '*') {
        this._lastScored.set(event.partId, event.timestamp);
      }
    });

    if (options.autoStart ?? true) {
      this.start();
    }
  }

  /**
   * The store this lifecycle manages.
   */
  get store(): PriorityStore {
    return this._store;
  }

  /**
   * Whether the lifecycle is currently running its pruning timer.
   */
  get started(): boolean {
    return this._started;
  }

  /**
   * Whether a prune is currently executing (true only inside the prune call).
   */
  get pruning(): boolean {
    return this._pruning;
  }

  /**
   * Current size of the managed store.
   */
  get size(): number {
    return this._store.size;
  }

  /**
   * Start the periodic prune timer.
   *
   * Safe to call when already started (no-op). The timer fires
   * {@link PriorityLifecycle.prune} every {@link PriorityLifecycleOptions
   * .intervalMs}. The interval is unref'd so it never keeps a process alive on
   * its own.
   */
  start(): void {
    if (this._started || this._intervalMs <= 0) return;
    this._started = true;
    this._timer = setInterval(() => {
      this.prune();
    }, this._intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  /**
   * Stop the periodic prune timer.
   *
   * Safe to call when already stopped (no-op). Any interval currently scheduled
   * is cleared; pruning remains available on demand via
   * {@link PriorityLifecycle.prune}.
   */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  /**
   * Prune the store now.
   *
   * Two independent policies run:
   *
   * 1. **TTL** — if {@link PriorityLifecycleOptions.ttlMs} is non-zero, entries
   *    whose *score timestamp* is older than the TTL are evicted first. The
   *    lifecycle keeps a shadow map of part id → last scored time (populated by
   *    the forwarded `'put'` events) so this works even though
   *    {@link PriorityScore} carries no timestamp of its own.
   * 2. **Cap** — if the store is over {@link PriorityLifecycleOptions
   *    .maxEntries}, the lowest-scoring entries are evicted until it fits.
   *
   * Emits a single `'prune'` event when anything was removed.
   *
   * @returns the number of entries removed
   */
  prune(): number {
    if (this._pruning) return 0;
    this._pruning = true;
    try {
      let removed = 0;
      if (this._ttlMs > 0) {
        removed += this._pruneExpired();
      }
      if (this._maxEntries > 0) {
        removed += this._pruneToCap();
      }
      if (removed > 0) {
        this.emit('prune', {
          removed,
          size: this._store.size,
          timestamp: this._now(),
        } satisfies PriorityLifecyclePruneEvent);
      }
      return removed;
    } finally {
      this._pruning = false;
    }
  }

  /**
   * Forget the cached score for a single part.
   *
   * Used when the part itself is dropped from the context, so the score cache
   * never references parts that no longer exist.
   *
   * @param partId - the part id to forget
   * @returns `true` when an entry was removed
   */
  clearPart(partId: string): boolean {
    return this._store.delete(partId);
  }

  /**
   * Reset the entire subsystem: stop the timer, clear the store, and restart.
   *
   * @returns `this` for chaining
   */
  reset(): this {
    this.stop();
    this._store.clear();
    this.start();
    return this;
  }

  /**
   * Detach this lifecycle from its store entirely.
   *
   * Stops the timer and removes the forwarded listeners, leaving the store
   * untouched. Useful during shutdown or when a lifecycle is being replaced.
   */
  dispose(): void {
    this.stop();
    this._store.removeAllListeners('put');
    this.removeAllListeners();
  }

  /**
   * Evict entries whose last scored time is older than the TTL.
   *
   * The lifecycle tracks `partId → last seen score time` by listening to the
   * store's `'put'` events. Entries never seen since this lifecycle was
   * constructed are treated as maximally old only when the store itself is
   * over the cap (handled by `_pruneToCap`); here we only remove entries we
   * positively know are expired.
   *
   * @returns the number of entries removed
   */
  private _pruneExpired(): number {
    if (this._ttlMs <= 0) return 0;
    const now = this._now();
    const cutoff = now - this._ttlMs;
    let removed = 0;
    for (const partId of this._store.keys()) {
      const lastScored = this._lastScored.get(partId);
      if (lastScored !== undefined && lastScored < cutoff) {
        if (this._store.delete(partId)) {
          this._lastScored.delete(partId);
          removed += 1;
        }
      }
    }
    return removed;
  }

  /**
   * Evict the lowest-scoring entries until the store fits under the cap.
   *
   * Repeatedly locates the entry with the smallest score in the store and
   * removes it, exactly as the store's own internal eviction would, but as an
   * explicit lifecycle pass so the eviction is observable (single `'prune'`
   * event) and so a cap changed *after* construction is honoured too.
   *
   * @returns the number of entries removed
   */
  private _pruneToCap(): number {
    if (this._maxEntries <= 0 || this._store.size <= this._maxEntries) {
      return 0;
    }
    let removed = 0;
    while (this._store.size > this._maxEntries) {
      const victim = this._lowestScoreKey();
      if (victim === undefined) break;
      if (this._store.delete(victim)) {
        this._lastScored.delete(victim);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Find the part id with the lowest score in the managed store.
   *
   * @returns the part id, or `undefined` when the store is empty
   */
  private _lowestScoreKey(): string | undefined {
    let lowest: string | undefined;
    let lowestScore = Number.POSITIVE_INFINITY;
    for (const score of this._store.values()) {
      if (score.score < lowestScore) {
        lowestScore = score.score;
        lowest = score.partId;
      }
    }
    return lowest;
  }

  /** Shadow map of part id → last scored time, fed by forwarded `'put'`s. */
  private readonly _lastScored: Map<string, Timestamp>;
}