/**
 * Scored-entry cache for the **Prioritization** layer of the standalone MAM
 * Context Engine.
 *
 * {@link PriorityStore} is the mutable heart of the layer: a keyed registry of
 * {@link PriorityScore}s — the output of every successful scoring pass — that
 * answers the read-side questions ("did we already score this part?", "what is
 * the best score we have cached?") and applies every state change through a
 * single, well-guarded API.
 *
 * Responsibilities:
 *
 * - **Cache** — {@link PriorityStore.put} / {@link PriorityStore.get} /
 *   {@link PriorityStore.getByPart} / {@link PriorityStore.has} /
 *   {@link PriorityStore.delete} / {@link PriorityStore.keys} /
 *   {@link PriorityStore.clear} / {@link PriorityStore.size} manage which
 *   scores are retained at all.
 * - **Batch** — {@link PriorityStore.putMany} writes a batch of scores in one
 *   call, which is how a serialised snapshot or a bulk re-score repopulates the
 *   cache cheaply.
 * - **Evict** — when {@link PriorityStoreOptions.maxEntries} is set, an
 *   over-full cache evicts its *lowest-scoring* entries first, so the engine
 *   always keeps the most important scores and a long-running process stays
 *   bounded.
 * - **Inspect** — {@link PriorityStore.stats} rolls the cache up into a
 *   {@link PrioritizationStats} report (counts, score spread, totals, ages).
 * - **Persist** — {@link PriorityStore.toJSON} / {@link PriorityStore.fromJSON}
 *   round-trip the whole cache through plain JSON.
 *
 * Keys are the {@link ContextPart.partId} of the scored part, so re-scoring an
 * unchanged part overwrites its previous score in place rather than duplicating
 * it. Callers may supply any string key they like, but the store never invents
 * one for them.
 *
 * The store extends `node:events`' `EventEmitter` and emits `'put'`, `'delete'`,
 * `'clear'` and `'prune'` events carrying lightweight payloads, which lets
 * {@link PriorityLifecycle} and the integration facades observe and react
 * without polling.
 *
 * @module prioritization/store
 */

import { EventEmitter } from 'node:events';

import { DEFAULT_MAX_ENTRIES, isPriorityScore } from './types.js';
import type {
  PriorityScore,
  PriorityState,
  PrioritizationStats,
  Timestamp,
} from './types.js';

/**
 * A minimal event payload shared by every event the store emits.
 */
export interface PriorityStoreEvent {
  /**
   * The part id the event concerns (`'*'` for whole-store events).
   */
  readonly partId: string;

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly timestamp: Timestamp;
}

/**
 * Payload emitted by the store's `'put'` event.
 */
export interface PriorityStorePutEvent extends PriorityStoreEvent {
  /**
   * The score of the stored entry.
   */
  readonly score: number;
}

/**
 * Payload emitted by the store's `'prune'` event.
 */
export interface PriorityStorePruneEvent extends PriorityStoreEvent {
  /**
   * Number of entries evicted by this prune.
   */
  readonly removed: number;
}

/**
 * Construction options for a {@link PriorityStore}.
 */
export interface PriorityStoreOptions {
  /**
   * Maximum number of scored entries retained before the lowest-scoring
   * entries are evicted. `0` disables the cap entirely. Defaults to
   * {@link DEFAULT_MAX_ENTRIES}.
   */
  readonly maxEntries?: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the store
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The keyed score cache.
 *
 * @example
 * ```ts
 * const store = new PriorityStore({ maxEntries: 1000 });
 * store.put(score);
 * store.getByPart('mem:onboarding')?.score; // 0.83
 * store.toJSON(); // serialisable snapshot
 * ```
 *
 * @fires PriorityStore#put
 * @fires PriorityStore#delete
 * @fires PriorityStore#clear
 * @fires PriorityStore#prune
 */
export class PriorityStore extends EventEmitter {
  /** Part id → score, the primary store. */
  private readonly _scores: Map<string, PriorityScore>;

  /** Part id → insertion timestamp, used for the mean-age stat. */
  private readonly _insertedAt: Map<string, Timestamp>;

  /** Insertion order queue used to break eviction ties fairly. */
  private readonly _order: string[];

  /** Maximum entries before the lowest-scoring entries are evicted. */
  private readonly _maxEntries: number;

  /** Clock used for `_now()`. */
  private readonly _now: () => Timestamp;

  /** Total scoring operations performed since construction / clear. */
  private _totalScored: number;

  /** Total evictions performed since construction / clear. */
  private _totalEvicted: number;

  /**
   * @param options - construction options
   */
  constructor(options: PriorityStoreOptions = {}) {
    super();
    this._scores = new Map<string, PriorityScore>();
    this._insertedAt = new Map<string, Timestamp>();
    this._order = [];
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._now = options.now ?? (() => Date.now());
    this._totalScored = 0;
    this._totalEvicted = 0;
  }

  /**
   * The clock in use, exposed for subclasses and test code.
   *
   * @returns the current timestamp from the injected clock
   */
  protected timestamp(): Timestamp {
    return this._now();
  }

  /**
   * True when the store is configured with a non-zero entry cap.
   */
  get bounded(): boolean {
    return this._maxEntries > 0;
  }

  /**
   * Number of scored entries currently cached.
   */
  get size(): number {
    return this._scores.size;
  }

  /**
   * True when no scores are cached.
   */
  get empty(): boolean {
    return this._scores.size === 0;
  }

  /**
   * Whether a score is cached for the given part id.
   *
   * @param partId - the part id to look up
   * @returns `true` when an entry exists
   */
  has(partId: string): boolean {
    return this._scores.has(partId);
  }

  /**
   * Retrieve the cached score for a part id.
   *
   * @param partId - the part id to look up
   * @returns the cached score, or `undefined` when absent
   */
  get(partId: string): PriorityScore | undefined {
    return this._scores.get(partId);
  }

  /**
   * Convenience alias of {@link PriorityStore.get} that mirrors the
   * part-centric vocabulary of the rest of the layer.
   *
   * @param partId - the part id to look up
   * @returns the cached score, or `undefined` when absent
   */
  getByPart(partId: string): PriorityScore | undefined {
    return this.get(partId);
  }

  /**
   * Store (or overwrite) a scored entry.
   *
   * The score is validated structurally before being accepted; malformed
   * payloads are silently rejected. When the store is over its
   * {@link PriorityStoreOptions.maxEntries} cap, the lowest-scoring entries are
   * evicted to make room, oldest-first among ties.
   *
   * Emits `'put'` with the part id and score.
   *
   * @param score - the score to cache
   * @returns `true` when the entry was stored
   */
  put(score: PriorityScore): boolean {
    if (!isPriorityScore(score)) return false;
    const { partId } = score;
    const now = this.timestamp();
    if (!this._scores.has(partId)) {
      this._order.push(partId);
      this._insertedAt.set(partId, now);
    }
    this._scores.set(partId, score);
    this._totalScored += 1;
    this._evictIfOver();
    this.emit(
      'put',
      { partId, score: score.score, timestamp: this.timestamp() } as
        PriorityStorePutEvent,
    );
    return true;
  }

  /**
   * Store a batch of scored entries in one call.
   *
   * Equivalent to calling {@link PriorityStore.put} for each entry, but emits
   * a single `'put'` event with `partId: '*'` and records the batch size, which
   * is cheaper and easier to observe when re-populating a store from a
   * snapshot. Entries are applied in order, so later entries in the batch win
   * for duplicate part ids.
   *
   * @param scores - the scores to cache
   * @returns the number of entries actually stored
   */
  putMany(scores: readonly PriorityScore[]): number {
    let stored = 0;
    for (const score of scores) {
      if (this.put(score)) stored += 1;
    }
    if (stored > 0) {
      this.emit(
        'put',
        { partId: '*', score: stored, timestamp: this.timestamp() } as
          PriorityStorePutEvent,
      );
    }
    return stored;
  }

  /**
   * Remove the cached score for a part id, if any.
   *
   * Emits `'delete'` when an entry was actually removed.
   *
   * @param partId - the part id to evict
   * @returns `true` when an entry was removed
   */
  delete(partId: string): boolean {
    const existed = this._scores.delete(partId);
    if (existed) {
      this._insertedAt.delete(partId);
      const index = this._order.indexOf(partId);
      if (index >= 0) this._order.splice(index, 1);
      this.emit(
        'delete',
        { partId, timestamp: this.timestamp() } as PriorityStoreEvent,
      );
    }
    return existed;
  }

  /**
   * All currently cached part ids, in insertion order.
   *
   * @returns an array of part ids (a copy; mutating it does not affect the
   * store)
   */
  keys(): string[] {
    return Array.from(this._order);
  }

  /**
   * All currently cached scores, in insertion order.
   *
   * @returns an array of scores (a copy)
   */
  values(): PriorityScore[] {
    return this._order.map((partId) => this._scores.get(partId)!).filter(Boolean);
  }

  /**
   * Drop every cached entry and reset the counters.
   *
   * Emits `'clear'`.
   */
  clear(): void {
    this._scores.clear();
    this._insertedAt.clear();
    this._order.length = 0;
    this._totalScored = 0;
    this._totalEvicted = 0;
    this.emit('clear', { partId: '*', timestamp: this.timestamp() } as
      PriorityStoreEvent);
  }

  /**
   * Roll the cache up into a {@link PrioritizationStats} report.
   *
   * @returns the aggregate statistics for the current cache
   */
  stats(): PrioritizationStats {
    const scores = this.values();
    const count = scores.length;
    if (count === 0) {
      return {
        cached: 0,
        buckets: 0,
        roles: 0,
        meanScore: 0,
        maxScore: 0,
        minScore: 0,
        totalScored: this._totalScored,
        totalEvicted: this._totalEvicted,
        meanAgeMs: 0,
      };
    }
    let sum = 0;
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    let ageSum = 0;
    const now = this.timestamp();
    const buckets = new Set<string>();
    for (const score of scores) {
      sum += score.score;
      if (score.score > max) max = score.score;
      if (score.score < min) min = score.score;
      const insertedAt = this._insertedAt.get(score.partId) ?? now;
      ageSum += Math.max(0, now - insertedAt);
      buckets.add(scoreBucketOf(score.score));
    }
    return {
      cached: count,
      buckets: buckets.size,
      roles: this._distinctRoles(),
      meanScore: sum / count,
      maxScore: max,
      minScore: min,
      totalScored: this._totalScored,
      totalEvicted: this._totalEvicted,
      meanAgeMs: ageSum / count,
    };
  }

  /**
   * Serialise the whole cache into a {@link PriorityState} snapshot.
   *
   * @returns a JSON-serialisable snapshot of the cache
   */
  toJSON(): PriorityState {
    const scores: Record<string, PriorityScore> = {};
    for (const [partId, score] of this._scores) {
      scores[partId] = { ...score };
    }
    return {
      version: 1,
      scores,
      savedAt: this.timestamp(),
    };
  }

  /**
   * Restore a {@link PriorityState} snapshot into this store, replacing the
   * current contents.
   *
   * Malformed entries in the snapshot are skipped defensively. Does not emit
   * per-entry events; callers wanting to observe the change can listen for the
   * single `'put'` event the batch repopulation emits.
   *
   * @param state - the snapshot to restore
   * @returns the number of entries restored
   */
  fromJSON(state: PriorityState): number {
    this.clear();
    const restored = this.putMany(
      Object.values(state.scores).filter(isPriorityScore),
    );
    return restored;
  }

  /**
   * Evict the lowest-scoring entries while over the cap.
   *
   * Repeatedly removes the entry with the smallest score, breaking ties by
   * insertion order (oldest first), until `size <= maxEntries`. When the cap is
   * `0` no eviction happens at all.
   *
   * Emits a single `'prune'` event with the number removed when anything was
   * evicted.
   *
   * @returns the number of entries evicted
   */
  private _evictIfOver(): number {
    if (this._maxEntries <= 0) return 0;
    let removed = 0;
    while (this._scores.size > this._maxEntries) {
      const victim = this._lowestScoreKey();
      if (victim === undefined) break;
      this._scores.delete(victim);
      this._insertedAt.delete(victim);
      const index = this._order.indexOf(victim);
      if (index >= 0) this._order.splice(index, 1);
      this._totalEvicted += 1;
      removed += 1;
    }
    if (removed > 0) {
      this.emit(
        'prune',
        { partId: '*', removed, timestamp: this.timestamp() } as
          PriorityStorePruneEvent,
      );
    }
    return removed;
  }

  /**
   * Find the part id with the lowest cached score.
   *
   * Scans the store linearly — acceptable because this only runs when the store
   * is over its cap, and the eviction removes at most a handful of entries per
   * {@link PriorityStore.put}.
   *
   * @returns the part id with the lowest score, or `undefined` when empty
   */
  private _lowestScoreKey(): string | undefined {
    let lowest: string | undefined;
    let lowestScore = Number.POSITIVE_INFINITY;
    for (const [partId, score] of this._scores) {
      if (score.score < lowestScore) {
        lowestScore = score.score;
        lowest = partId;
      }
    }
    return lowest;
  }

  /**
   * Count the distinct role *hints* among the cached part ids.
   *
   * {@link PriorityScore} deliberately does not carry the role of its part (the
   * role lives on the {@link ContextPart}), so the store infers a coarse role
   * hint from the part id prefix — `mem:onboarding-notes` hints `mem`,
   * `tool:search` hints `tool`, and ids without a separator hint `'other'`.
   * This keeps {@link PrioritizationStats.roles} meaningful without pulling
   * the index into the store. For authoritative per-role counts, use
   * {@link PriorityIndex.stats}.
   *
   * @returns the number of distinct role hints among cached entries
   */
  private _distinctRoles(): number {
    const hints = new Set<string>();
    for (const partId of this._order) {
      const separator = partId.indexOf(':');
      hints.add(separator > 0 ? partId.slice(0, separator) : 'other');
    }
    return hints.size;
  }
}

/**
 * Derive a score bucket string from a numeric score.
 *
 * Kept local to the store to avoid a circular import; mirrors
 * {@link scoreBucket} in `types.ts`. Exists so the stats report can count
 * occupied buckets without depending on the index module.
 *
 * @param score - a normalised score in `[0, 1]`
 * @returns a coarse bucket label
 */
function scoreBucketOf(score: number): string {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.3) return 'medium';
  return 'low';
}