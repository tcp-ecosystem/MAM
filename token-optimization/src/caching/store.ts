/**
 * @file store.ts
 * @module caching/store
 *
 * {@link CacheSegmentStore}: the mutable, single-source-of-truth registry
 * for cached prompt segments.
 *
 * The store owns the authoritative {@link CachedSegment} records — their
 * text, token estimates, hit counts and timestamps. It is deliberately
 * policy-free in the same spirit as the budgeting layer's ledger: it knows
 * *how* to store, look up, touch and evict records, but it does not decide
 * *when* a hit should be served or when a segment is hot enough to pin.
 * Those decisions live in {@link CacheManager} (`retrieval.ts`) and the
 * {@link CachingLifecycle} (`lifecycle.ts`).
 *
 * Responsibilities in this class:
 *  - create / read / update / delete segment records;
 *  - account hits and access recency (`recordHit`, `touch`);
 *  - enforce the configured capacity cap with LRU eviction;
 *  - honour a TTL by expiring stale records on demand (`prune`);
 *  - derive aggregate {@link CacheStats};
 *  - serialize to and from plain JSON with runtime validation.
 *
 * All mutations are synchronous and in-memory; no I/O happens here. The
 * store is safe to share between the {@link CacheIndex} (`index.ts`) and
 * the {@link CacheManager}, both of which read from this single source of
 * truth.
 *
 * @packageDocumentation
 */

import type { CacheConfig, CachedSegment, CacheStats } from './types.js';

import {
  createCachedSegment,
  createEmptyCacheStats,
  isCachedSegment,
  isSegmentId,
  normalizeCacheConfig,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------------ */

/**
 * Coerces `tokens` to a non-negative integer. Fractional and negative
 * inputs are floored/clamped rather than thrown so callers can feed
 * estimates without defensive ceremony.
 */
function toTokenCount(tokens: number): number {
  if (!Number.isFinite(tokens)) return 0;
  return Math.max(0, Math.floor(tokens));
}

/**
 * Coerces `ms` to a non-negative integer timestamp.
 */
function toTimestamp(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms));
}

/**
 * Plain-JSON shape produced by {@link CacheSegmentStore.toJSON} and accepted
 * by {@link CacheSegmentStore.fromJSON}.
 */
export interface CacheSegmentStoreJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** The active capacity ceiling at serialization time. */
  maxSegments: number;
  /** The active TTL (ms) at serialization time (`undefined` when disabled). */
  ttlMs?: number;
  /** The stored segments, in insertion order. */
  segments: CachedSegment[];
}

/**
 * Options accepted by {@link CacheSegmentStore.put}.
 */
export interface PutStoreOptions {
  /**
   * When `true` (default), an existing segment with the same `id` is
   * refreshed in place: its `text`/`tokens`/`model` are updated, its hit
   * count is preserved, and its timestamps are touched. When `false`, the
   * existing record is left untouched and `put` returns `undefined`.
   */
  merge?: boolean;
  /**
   * Model name stamped onto the stored segment. Pass `null` to explicitly
   * clear any existing model on merge.
   */
  model?: string;
  /**
   * When `true` (default), a merge preserves the existing record's hit count
   * (a refresh, not a reuse). Set to `false` to take the hit count from the
   * incoming `segment` instead — useful when a re-cache should count as a
   * reuse.
   */
  preserveHits?: boolean;
}

/**
 * Options accepted by {@link CacheSegmentStore.prune}.
 */
export interface PruneStoreOptions {
  /**
   * When `true` (default), segments whose age exceeds the configured TTL
   * are removed first. Set to `false` to skip time-based expiry.
   */
  expire?: boolean;
  /**
   * Override the capacity ceiling for this prune run. Defaults to the
   * store's configured `maxSegments`.
   */
  maxSegments?: number;
  /**
   * When `true`, the returned summary also reports reclaimed tokens.
   */
  detail?: boolean;
}

/**
 * Summary returned by {@link CacheSegmentStore.prune}.
 */
export interface PruneSummary {
  /** Number of segments removed by this prune run. */
  removed: number;
  /** Number of segments remaining afterwards. */
  remaining: number;
  /** Estimated tokens reclaimed by the removal (when `detail` is set). */
  freedTokens?: number;
}

/**
 * Mutable registry of cached prompt segments.
 *
 * Backed by a `Map<segmentId, CachedSegment>` plus a monotonically
 * increasing access counter used to break LRU ties deterministically. All
 * reads return *copies* of the stored records so callers cannot corrupt the
 * registry through a handed-out reference; use {@link recordHit},
 * {@link touch} or {@link put} to mutate.
 */
export class CacheSegmentStore {
  /** Backing registry, keyed by segment id. */
  private readonly _segments: Map<string, CachedSegment>;
  /** Access counter for deterministic LRU tie-breaking. */
  private _accessSequence: number;
  /** Capacity ceiling (number of segments). */
  private _maxSegments: number;
  /** Time-to-live (ms); `undefined` disables expiry. */
  private _ttlMs: number | undefined;

  /**
   * Creates an empty store.
   *
   * @param config - partial cache config; merged over the defaults. The
   *   `enabled` and `minHitsForPromotion` fields are ignored here — they are
   *   policy, not storage — but `maxSegments` and `ttlMs` are honoured.
   */
  constructor(config: Partial<CacheConfig> = {}) {
    this._segments = new Map<string, CachedSegment>();
    this._accessSequence = 0;
    const normalized = normalizeCacheConfig(config);
    this._maxSegments = Math.max(1, normalized.maxSegments);
    this._ttlMs = normalized.ttlMs;
  }

  /* -------------------------------------------------------------------- *
   * Raw record access
   * -------------------------------------------------------------------- */

  /**
   * Stores (or merges) a segment.
   *
   * When a segment with the same `id` already exists and `opts.merge` is
   * `true`, the record is refreshed: text, tokens and model are updated,
   * the hit count is preserved, and `lastAccessAt` is bumped. Otherwise the
   * record is replaced wholesale. After insertion the capacity cap is
   * enforced by evicting the least-recently-accessed segments.
   *
   * @returns the stored (stable) record, or `undefined` when a merge was
   *   requested for an existing id but `merge` was `false`.
   */
  put(
    segment: CachedSegment,
    opts: PutStoreOptions = {},
  ): CachedSegment | undefined {
    if (!isCachedSegment(segment)) {
      throw new TypeError(`Invalid CachedSegment: ${JSON.stringify(segment)}`);
    }
    const existing = this._segments.get(segment.id);
    if (existing && opts.merge === false) return undefined;

    const stored: CachedSegment = existing
      ? this._mergeInto(existing, segment, opts.model, opts.preserveHits !== false)
      : this._fresh(segment, opts.model);
    this._segments.set(stored.id, stored);
    this._accessSequence += 1;
    this._evictToCap();
    return { ...stored };
  }

  /**
   * Returns a copy of the segment for `id`, or `undefined` when absent.
   *
   * This is a pure read: it does *not* touch recency. Use {@link touch} or
   * {@link recordHit} when a read should count as access for LRU/TTL
   * purposes.
   */
  get(id: string): CachedSegment | undefined {
    if (!isSegmentId(id)) return undefined;
    const record = this._segments.get(id);
    return record ? { ...record } : undefined;
  }

  /**
   * Returns `true` when a segment exists for `id`.
   */
  has(id: string): boolean {
    return isSegmentId(id) && this._segments.has(id);
  }

  /**
   * Removes the segment for `id`. Returns `true` when a record existed and
   * was removed.
   */
  delete(id: string): boolean {
    if (!isSegmentId(id)) return false;
    return this._segments.delete(id);
  }

  /**
   * Returns a snapshot `Array` of every stored segment id, in insertion
   * order.
   */
  keys(): string[] {
    return Array.from(this._segments.keys());
  }

  /**
   * Returns a snapshot `Array` of every stored segment (deep copies).
   */
  values(): CachedSegment[] {
    return Array.from(this._segments.values(), (segment) => ({ ...segment }));
  }

  /**
   * Returns a snapshot `Array` of `[id, segment]` pairs.
   */
  entries(): Array<[string, CachedSegment]> {
    return Array.from(this._segments.entries(), ([key, segment]) => [
      key,
      { ...segment },
    ]);
  }

  /**
   * Invokes `callback` for every stored segment (copies). Useful for
   * scanning without mutating.
   */
  forEach(callback: (segment: CachedSegment, id: string) => void): void {
    for (const [id, segment] of this._segments) {
      callback({ ...segment }, id);
    }
  }

  /**
   * Number of stored segments.
   */
  get size(): number {
    return this._segments.size;
  }

  /**
   * Removes every stored segment. Returns the number of records dropped.
   */
  clear(): number {
    const cleared = this._segments.size;
    this._segments.clear();
    return cleared;
  }

  /* -------------------------------------------------------------------- *
   * Access accounting
   * -------------------------------------------------------------------- */

  /**
   * Records a cache hit for `id`: increments `hits` and bumps
   * `lastAccessAt`.
   *
   * @returns the updated record (a copy), or `undefined` when `id` is not
   *   stored.
   */
  recordHit(id: string, at = Date.now()): CachedSegment | undefined {
    const record = this._segments.get(id);
    if (!record) return undefined;
    const now = toTimestamp(at);
    const updated: CachedSegment = {
      ...record,
      hits: record.hits + 1,
      lastAccessAt: Math.max(now, record.lastAccessAt),
    };
    this._segments.set(id, updated);
    this._accessSequence += 1;
    return { ...updated };
  }

  /**
   * Bumps `lastAccessAt` without counting a hit. Use for reads that should
   * refresh TTL/recency but not inflate the hit count.
   *
   * @returns the updated record (a copy), or `undefined` when `id` is not
   *   stored.
   */
  touch(id: string, at = Date.now()): CachedSegment | undefined {
    const record = this._segments.get(id);
    if (!record) return undefined;
    const now = toTimestamp(at);
    const updated: CachedSegment = {
      ...record,
      lastAccessAt: Math.max(now, record.lastAccessAt),
    };
    this._segments.set(id, updated);
    this._accessSequence += 1;
    return { ...updated };
  }

  /**
   * The current access sequence number (monotonic). Exposed for callers
   * that want to reason about recency ordering externally.
   */
  get accessSequence(): number {
    return this._accessSequence;
  }

  /* -------------------------------------------------------------------- *
   * Derived numbers
   * -------------------------------------------------------------------- */

  /**
   * Hits recorded for `id` (`0` when untracked).
   */
  hits(id: string): number {
    return this._segments.get(id)?.hits ?? 0;
  }

  /**
   * Estimated token footprint for `id` (`0` when untracked).
   */
  tokens(id: string): number {
    return this._segments.get(id)?.tokens ?? 0;
  }

  /**
   * Epoch milliseconds of the most recent access for `id` (`0` when
   * untracked).
   */
  lastAccessAt(id: string): number {
    return this._segments.get(id)?.lastAccessAt ?? 0;
  }

  /**
   * `true` when the segment for `id` has expired against the configured
   * TTL (or `false` when TTL is disabled or the segment is untracked).
   */
  isExpired(id: string, at = Date.now()): boolean {
    if (this._ttlMs === undefined) return false;
    const record = this._segments.get(id);
    if (!record) return false;
    return toTimestamp(at) - record.lastAccessAt > this._ttlMs;
  }

  /* -------------------------------------------------------------------- *
   * Housekeeping
   * -------------------------------------------------------------------- */

  /**
   * Prunes the registry: first drops TTL-expired segments, then, if the
   * remaining count still exceeds the cap, evicts least-recently-accessed
   * segments until the cap holds.
   *
   * Expiry uses `lastAccessAt`, so a segment that keeps being touched never
   * expires. Eviction prefers older access times, breaking ties by the
   * deterministic insertion/access sequence.
   *
   * @param options - prune tuning ({@link PruneStoreOptions}).
   * @returns a {@link PruneSummary} describing what happened.
   */
  prune(options: PruneStoreOptions = {}): PruneSummary {
    const now = Date.now();
    let removed = 0;
    let freedTokens = 0;

    if (options.expire !== false && this._ttlMs !== undefined) {
      const expired: string[] = [];
      for (const [id, segment] of this._segments) {
        if (now - segment.lastAccessAt > this._ttlMs) expired.push(id);
      }
      for (const id of expired) {
        const record = this._segments.get(id);
        if (this._segments.delete(id) && record) {
          removed += 1;
          freedTokens += record.tokens;
        }
      }
    }

    const cap = Math.max(1, Math.floor(options.maxSegments ?? this._maxSegments));
    while (this._segments.size > cap) {
      const victim = this._leastRecent();
      if (!victim) break;
      const record = this._segments.get(victim);
      this._segments.delete(victim);
      removed += 1;
      freedTokens += record?.tokens ?? 0;
    }

    const summary: PruneSummary = {
      removed,
      remaining: this._segments.size,
    };
    if (options.detail === true) summary.freedTokens = freedTokens;
    return summary;
  }

  /**
   * Forces the registry back under its configured capacity by evicting
   * least-recently-accessed segments. Returns the number of evictions.
   */
  evictToCap(): number {
    return this.prune({ expire: false }).removed;
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Sum of every segment's estimated token footprint.
   */
  totalTokens(): number {
    let total = 0;
    for (const segment of this._segments.values()) total += segment.tokens;
    return total;
  }

  /**
   * Sum of every segment's recorded hits.
   */
  totalHits(): number {
    let total = 0;
    for (const segment of this._segments.values()) total += segment.hits;
    return total;
  }

  /**
   * Derives {@link CacheStats} from the current records.
   */
  stats(minHitsForPromotion = 3): CacheStats {
    const segments = this._segments.size;
    if (segments === 0) return createEmptyCacheStats();

    let totalTokens = 0;
    let totalHits = 0;
    let hot = 0;
    let cold = 0;
    let touched = 0;
    for (const segment of this._segments.values()) {
      totalTokens += segment.tokens;
      totalHits += segment.hits;
      if (segment.hits >= Math.max(1, Math.floor(minHitsForPromotion))) hot += 1;
      else if (segment.hits === 0) cold += 1;
      if (segment.hits > 0) touched += 1;
    }
    return {
      segments,
      totalTokens,
      totalHits,
      hot,
      cold,
      touched,
      avgHits: totalHits / segments,
      reusableTokens: totalTokens,
    };
  }

  /**
   * Returns a deep-copied, independent clone of this store.
   */
  clone(): CacheSegmentStore {
    const copy = new CacheSegmentStore({ maxSegments: this._maxSegments, ttlMs: this._ttlMs });
    for (const [id, segment] of this._segments) {
      copy._segments.set(id, { ...segment });
    }
    copy._accessSequence = this._accessSequence;
    return copy;
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the store to a plain, JSON-friendly object.
   */
  toJSON(): CacheSegmentStoreJSON {
    return {
      version: 1,
      maxSegments: this._maxSegments,
      ...(this._ttlMs !== undefined ? { ttlMs: this._ttlMs } : {}),
      segments: Array.from(this._segments.values(), (segment) => ({ ...segment })),
    };
  }

  /**
   * Clears this store and loads `data`. Invalid records are skipped; an
   * entirely malformed payload leaves the store cleared.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this._segments.clear();
    this._accessSequence = 0;
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    if (typeof parsed['maxSegments'] === 'number' && Number.isFinite(parsed['maxSegments'])) {
      this._maxSegments = Math.max(1, Math.floor(parsed['maxSegments']));
    }
    if (typeof parsed['ttlMs'] === 'number' && Number.isFinite(parsed['ttlMs'])) {
      const ttl = Math.floor(parsed['ttlMs']);
      this._ttlMs = ttl > 0 ? ttl : undefined;
    }
    const list = parsed['segments'];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (!isCachedSegment(entry)) continue;
        const copy: CachedSegment = { ...entry };
        this._segments.set(copy.id, copy);
        this._accessSequence += 1;
      }
    }
    return this;
  }

  /**
   * Rehydrates a new store from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): CacheSegmentStore {
    const store = new CacheSegmentStore();
    store.fromJSON(data);
    return store;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Builds a fresh stored record from an input segment.
   */
  private _fresh(segment: CachedSegment, model?: string): CachedSegment {
    const now = Date.now();
    return createCachedSegment(segment.id, segment.text, segment.tokens, {
      model: model !== undefined ? model : segment.model,
      hits: segment.hits,
      createdAt: segment.createdAt,
      lastAccessAt: Math.max(segment.lastAccessAt, now),
    });
  }

  /**
   * Merges a refreshed segment over an existing record, preserving the
   * original creation time and — unless `preserveHits` is `false` — the
   * existing hit count.
   */
  private _mergeInto(
    existing: CachedSegment,
    next: CachedSegment,
    model?: string,
    preserveHits = true,
  ): CachedSegment {
    const now = Date.now();
    return createCachedSegment(existing.id, next.text, toTokenCount(next.tokens), {
      model: model !== undefined ? model : next.model ?? existing.model,
      hits: preserveHits ? existing.hits : next.hits,
      createdAt: existing.createdAt,
      lastAccessAt: Math.max(existing.lastAccessAt, next.lastAccessAt, now),
    });
  }

  /**
   * Evicts segments until the registry is at or under `_maxSegments`.
   */
  private _evictToCap(): void {
    while (this._segments.size > this._maxSegments) {
      const victim = this._leastRecent();
      if (!victim) break;
      this._segments.delete(victim);
    }
  }

  /**
   * Returns the id of the least-recently-accessed segment, breaking ties by
   * insertion order (the first stored wins the "oldest" label).
   */
  private _leastRecent(): string | undefined {
    let oldestId: string | undefined;
    let oldestAt = Infinity;
    for (const [id, segment] of this._segments) {
      if (segment.lastAccessAt < oldestAt) {
        oldestAt = segment.lastAccessAt;
        oldestId = id;
      }
    }
    return oldestId;
  }
}

/**
 * Creates a store pre-populated from an iterable of segments.
 * Useful for tests and for loading persisted state.
 */
export function storeFromSegments(
  segments: Iterable<CachedSegment>,
  config: Partial<CacheConfig> = {},
): CacheSegmentStore {
  const store = new CacheSegmentStore(config);
  for (const segment of segments) store.put(segment, { merge: false });
  return store;
}