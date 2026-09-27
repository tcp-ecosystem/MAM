/**
 * Lifecycle management for short-term memory: TTL scheduling and eviction.
 *
 * {@link ShortTermLifecycle} wraps a {@link ShortTermStore} and an optional
 * {@link ShortTermIndex} with everything needed to keep ephemeral memory
 * *actually ephemeral*:
 *
 * - **Scheduled pruning** — {@link ShortTermLifecycle.start} installs a
 *   `setInterval`-based timer that runs {@link ShortTermLifecycle.prune} on a
 *   cadence, so expired entries are reclaimed even when nothing is reading the
 *   store. {@link ShortTermLifecycle.stop} tears the timer down cleanly.
 * - **Manual pruning** — {@link ShortTermLifecycle.prune} expires TTL-elapsed
 *   entries *and* enforces the `maxEntries` bound; {@link
 *   ShortTermLifecycle.purgeExpired} removes only TTL-expired entries.
 * - **Forced eviction** — {@link ShortTermLifecycle.evict} shrinks the store
 *   to a caller-supplied bound, removing the least-recently-accessed entries.
 * - **Targeted expiry** — {@link ShortTermLifecycle.expireEntry} removes a
 *   single entry as an expiry.
 * - **Full reset** — {@link ShortTermLifecycle.reset} wipes the store and
 *   index in one call.
 * - **Observability** — the lifecycle extends `EventEmitter` and emits the
 *   {@link ShortTermLifecycleEvents} events (`'prune'`, `'evict'`, `'reset'`),
 *   and exposes ergonomic `onEvict`/`onPrune`/`onReset` subscriptions.
 *
 * The index (when supplied) is kept in sync on every removal path, so the
 * retrieval layer never sees stale index entries after a prune or eviction.
 *
 * @packageDocumentation
 * @module short-term/lifecycle
 */

import { EventEmitter } from 'node:events';

import type {
  PruneResult,
  ShortTermConfig,
  ShortTermEntry,
  ShortTermId,
  Timestamp,
} from './types.js';
import { ShortTermIndex } from './index.js';
import { ShortTermStore } from './store.js';

/**
 * Event payloads emitted by {@link ShortTermLifecycle}.
 *
 * The lifecycle extends Node's `EventEmitter`; the `'prune'`, `'evict'` and
 * `'reset'` events carry the payloads described here. Consumers can also use
 * the dedicated {@link ShortTermLifecycle.onPrune},
 * {@link ShortTermLifecycle.onEvict} and {@link ShortTermLifecycle.onReset}
 * subscriptions, which are typed wrappers around the same events.
 */
export interface ShortTermLifecycleEvents {
  /**
   * Emitted after a pruning pass removes expired and/or over-bound entries.
   * The payload is the {@link PruneResult} produced by the pass.
   */
  prune: { result: PruneResult };

  /**
   * Emitted when entries are evicted to enforce a size bound (forced
   * {@link ShortTermLifecycle.evict}, a capacity-triggered prune, or
   * {@link ShortTermLifecycle.expireEntry}). Carries the removed ids, a
   * human-readable reason, and the underlying {@link PruneResult}.
   */
  evict: {
    readonly ids: readonly ShortTermId[];
    readonly reason: string;
    readonly result: PruneResult;
  };

  /**
   * Emitted after {@link ShortTermLifecycle.reset} wipes the store and index.
   * `removed` reports how many entries were discarded.
   */
  reset: { removed: number; timestamp: Timestamp };
}

/**
 * Signature of an `onEvict` subscriber.
 *
 * @param ids - the ids of the evicted entries
 * @param reason - why they were evicted (e.g. `'max-entries'`, `'forced'`)
 * @param result - the prune/eviction result that caused the eviction
 */
export type EvictListener = (
  ids: readonly ShortTermId[],
  reason: string,
  result: PruneResult,
) => void;

/**
 * Signature of an `onPrune` subscriber.
 *
 * @param result - the prune result of the pass
 */
export type PruneListener = (result: PruneResult) => void;

/**
 * Signature of an `onReset` subscriber.
 *
 * @param removed - how many entries were discarded
 * @param timestamp - when the reset happened
 */
export type ResetListener = (removed: number, timestamp: Timestamp) => void;

/**
 * Lifecycle manager for a short-term store and its index.
 *
 * Constructed with (or started against) a store and optional index, then
 * {@link ShortTermLifecycle.start} to schedule automatic pruning. All manual
 * operations (`prune`, `evict`, `purgeExpired`, `expireEntry`, `reset`) are
 * safe to call whether or not the timer is running.
 */
export class ShortTermLifecycle extends EventEmitter {
  private readonly store: ShortTermStore;
  private readonly index?: ShortTermIndex;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickCount = 0;
  private totalPrunes = 0;
  private totalExpired = 0;
  private totalEvicted = 0;

  /**
   * Construct a lifecycle around a store.
   *
   * @param store - the store to govern (owned by the caller; the lifecycle
   *   mutates it in place)
   * @param index - optional index to keep synchronised with removals
   */
  constructor(store: ShortTermStore, index?: ShortTermIndex) {
    super();
    this.store = store;
    this.index = index;
  }

  /**
   * The store governed by this lifecycle.
   */
  get storeView(): ShortTermStore {
    return this.store;
  }

  /**
   * The index synchronised by this lifecycle, when one was supplied.
   */
  get indexView(): ShortTermIndex | undefined {
    return this.index;
  }

  /**
   * Whether the automatic prune timer is currently running.
   *
   * @returns `true` when {@link ShortTermLifecycle.start} has been called and
   *   not yet stopped
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * The number of scheduled prune ticks that have fired so far.
   *
   * @returns the tick count
   */
  ticks(): number {
    return this.tickCount;
  }

  /**
   * Begin automatic, interval-based pruning.
   *
   * Applies the supplied config to the store (if any), then installs a
   * `setInterval` that runs {@link ShortTermLifecycle.prune} every
   * `pruneIntervalMs`. If the effective `pruneIntervalMs` is not positive, no
   * timer is installed but the lifecycle is still marked running so manual
   * operations behave identically. Calling `start` again while running is a
   * no-op that returns the same instance.
   *
   * @param config - optional config merged into the store before starting
   * @returns this lifecycle, for chaining
   */
  start(config?: ShortTermConfig): this {
    if (config) {
      this.store.setConfig(config);
    }
    if (this.running) {
      return this;
    }
    this.running = true;
    const interval = this.store.getConfig().pruneIntervalMs;
    if (interval && interval > 0) {
      this.timer = setInterval(() => {
        this.tickCount += 1;
        this.prune();
      }, interval);
      if (typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
    return this;
  }

  /**
   * Stop the automatic prune timer.
   *
   * Safe to call when not running. The store, index and accumulated counters
   * are left untouched; {@link ShortTermLifecycle.start} may be called again
   * later to resume scheduling.
   *
   * @returns this lifecycle, for chaining
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    return this;
  }

  /**
   * Run a full prune pass immediately.
   *
   * Expires TTL-elapsed entries and enforces the store's `maxEntries` bound,
   * synchronises the index for every removed id, emits `'prune'` (and, when
   * entries were evicted for capacity, `'evict'`), and updates the cumulative
   * counters.
   *
   * @returns the {@link PruneResult} of the pass
   */
  prune(): PruneResult {
    const result = this.store.prune();
    this.totalPrunes += 1;
    this.totalExpired += result.expired;
    this.totalEvicted += result.evicted;
    this.removeFromIndex(result.removedIds);
    this.emit('prune', { result });
    if (result.evicted > 0) {
      this.emit('evict', {
        ids: result.removedIds,
        reason: 'max-entries',
        result,
      });
    }
    return result;
  }

  /**
   * Remove only TTL-expired entries, without enforcing the size bound.
   *
   * Unlike {@link ShortTermLifecycle.prune}, this never evicts
   * least-recently-used entries, so it is safe for stores that are
   * intentionally running over their bound. Emits `'prune'` and returns the
   * result.
   *
   * @returns the {@link PruneResult} of the pass
   */
  purgeExpired(): PruneResult {
    const result = this.store.pruneExpired();
    this.totalPrunes += 1;
    this.totalExpired += result.expired;
    this.removeFromIndex(result.removedIds);
    this.emit('prune', { result });
    return result;
  }

  /**
   * Force the store down to at most `maxEntries` entries.
   *
   * Evicts the least-recently-accessed entries, synchronises the index,
   * emits `'evict'`, and returns the result. Passing a bound at or above the
   * current size is a harmless no-op.
   *
   * @param maxEntries - the maximum number of entries to keep
   * @returns the {@link PruneResult} of the eviction
   */
  evict(maxEntries: number): PruneResult {
    const result = this.store.evict(maxEntries);
    this.totalEvicted += result.evicted;
    this.removeFromIndex(result.removedIds);
    if (result.evicted > 0) {
      this.emit('evict', {
        ids: result.removedIds,
        reason: 'forced',
        result,
      });
    }
    return result;
  }

  /**
   * Expire a single entry by id.
   *
   * Removes the entry (if present), synchronises the index, counts it as an
   * expiry, and emits `'evict'` with reason `'expire'`. This is the
   * fine-grained counterpart to the bulk prune paths.
   *
   * @param id - the entry id to expire
   * @returns `true` when an entry was removed
   */
  expireEntry(id: ShortTermId): boolean {
    const existed = this.store.delete(id);
    if (!existed) {
      return false;
    }
    this.index?.removeEntry(id);
    this.totalExpired += 1;
    const result: PruneResult = {
      expired: 1,
      evicted: 0,
      removed: 1,
      remaining: this.store.size(),
      removedIds: [id],
      timestamp: Date.now(),
    };
    this.emit('evict', { ids: [id], reason: 'expire', result });
    return true;
  }

  /**
   * Wipe the store and index completely.
   *
   * Discards every entry and emits `'reset'` with the number of entries that
   * were present. Cumulative counters are *not* reset — the lifecycle's
   * lifetime statistics remain comparable across resets.
   *
   * @returns the number of entries discarded
   */
  reset(): number {
    const removed = this.store.size();
    this.store.clear();
    this.index?.clear();
    this.emit('reset', { removed, timestamp: Date.now() });
    return removed;
  }

  /**
   * Run a prune immediately and return the result (alias for
   * {@link ShortTermLifecycle.prune}).
   *
   * Convenient for flushing expired entries on demand before a retrieval, or
   * when the timer is not running but a single pass is wanted.
   *
   * @returns the {@link PruneResult} of the pass
   */
  flush(): PruneResult {
    return this.prune();
  }

  /**
   * Subscribe to eviction events.
   *
   * @param listener - invoked with `(ids, reason, result)` after any eviction
   * @returns an unsubscribe function that removes the listener
   */
  onEvict(listener: EvictListener): () => void {
    this.on('evict', (payload: ShortTermLifecycleEvents['evict']) => {
      listener(payload.ids, payload.reason, payload.result);
    });
    return () => {
      this.removeAllListeners('evict');
    };
  }

  /**
   * Subscribe to prune events.
   *
   * @param listener - invoked with the {@link PruneResult} after every prune
   *   pass (scheduled or manual)
   * @returns an unsubscribe function that removes the listener
   */
  onPrune(listener: PruneListener): () => void {
    this.on('prune', (payload: ShortTermLifecycleEvents['prune']) => {
      listener(payload.result);
    });
    return () => {
      this.removeAllListeners('prune');
    };
  }

  /**
   * Subscribe to reset events.
   *
   * @param listener - invoked with `(removed, timestamp)` after a reset
   * @returns an unsubscribe function that removes the listener
   */
  onReset(listener: ResetListener): () => void {
    this.on('reset', (payload: ShortTermLifecycleEvents['reset']) => {
      listener(payload.removed, payload.timestamp);
    });
    return () => {
      this.removeAllListeners('reset');
    };
  }

  /**
   * Lifetime statistics accumulated by this lifecycle.
   *
   * Useful for observability: how often pruning has run, and how many entries
   * have been expired or evicted since construction (or the last reset of the
   * counters).
   *
   * @returns a plain statistics object
   */
  stats(): {
    running: boolean;
    ticks: number;
    prunes: number;
    expired: number;
    evicted: number;
    entries: number;
  } {
    return {
      running: this.running,
      ticks: this.tickCount,
      prunes: this.totalPrunes,
      expired: this.totalExpired,
      evicted: this.totalEvicted,
      entries: this.store.size(),
    };
  }

  /**
   * Tear down the lifecycle: stop the timer and detach all listeners.
   *
   * The store and index are left intact (their contents remain readable);
   * only the timer and event subscriptions are disposed.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Synchronise the index by removing entries that no longer exist.
   *
   * @param ids - the ids removed from the store
   */
  private removeFromIndex(ids: readonly ShortTermId[]): void {
    if (!this.index) {
      return;
    }
    for (const id of ids) {
      this.index.removeEntry(id);
    }
  }
}

/**
 * Create a fully-wired lifecycle over a fresh store and index.
 *
 * Convenience factory: constructs a {@link ShortTermStore} (optionally seeded
 * from a JSON snapshot), a {@link ShortTermIndex} kept in sync by the
 * returned lifecycle, and returns the assembled trio.
 *
 * @param config - store configuration
 * @param snapshot - optional snapshot to seed the store with
 * @returns the assembled lifecycle, store and index
 */
export function createShortTermLifecycle(
  config?: ShortTermConfig,
  snapshot?: Parameters<ShortTermStore['fromJSON']>[0],
): { lifecycle: ShortTermLifecycle; store: ShortTermStore; index: ShortTermIndex } {
  const store = new ShortTermStore(config);
  if (snapshot) {
    store.fromJSON(snapshot);
  }
  const index = new ShortTermIndex();
  index.rebuild(store.entries());
  const lifecycle = new ShortTermLifecycle(store, index);
  return { lifecycle, store, index };
}