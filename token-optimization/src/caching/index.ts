/**
 * @file index.ts
 * @module caching/index
 *
 * {@link CacheIndex}: a derived, query-oriented view over cached segments.
 *
 * While {@link CacheSegmentStore} is the authoritative registry, the index
 * is the *read model*. It maintains several orthogonal projections of the
 * segment population so callers can answer questions such as:
 *
 *  - "which segments are cached for model X?" (`findByModel`);
 *  - "which segments are large enough / small enough to matter?"
 *    (`findByLengthBucket`, `findLargest`);
 *  - "which segments have crossed a reuse threshold?" (`findByHitsRange`);
 *  - "what does the cache look like right now?" (`stats`);
 *  - "how is the cache distributed across buckets?" (`toJSON`).
 *
 * The index never mutates the underlying records; it is fed by
 * {@link indexSegment} and kept in sync by whoever owns the store (the
 * {@link CacheManager} in practice). Call {@link rebuild} to bulk-resync
 * from a list of segments, e.g. after deserialization.
 *
 * Length bucketing is a *logarithmic* scale: bucket boundaries double, so
 * a cache holding segments from 40 tokens to 40_000 tokens stays easy to
 * scan without an exact, order-preserving structure.
 *
 * @packageDocumentation
 */

import type { CachedSegment } from './types.js';
import { isCachedSegment, isSegmentId } from './types.js';

/* ------------------------------------------------------------------------ *
 * Length-bucket vocabulary
 * ------------------------------------------------------------------------ */

/**
 * Upper boundaries (inclusive) of the token-length buckets.
 *
 * A segment with `tokens` tokens lands in the bucket whose upper bound is
 * the smallest value `>= tokens`. Segments above the largest bound fall
 * into the implicit "overflow" bucket.
 */
export const LENGTH_BUCKET_BOUNDS: readonly number[] = [
  50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000,
] as const;

/**
 * Returns the length-bucket key for a token count.
 *
 * Bucket keys are formatted as `"<lower>-<upper>"` (e.g. `"251-500"`), or
 * `">50000"` for overflow, or `"0"` for empty segments. The bucketing is
 * logarithmic (boundaries double), keeping the bucket count small no matter
 * how wide the token range becomes.
 *
 * @param tokens - the segment's token footprint (>= 0).
 */
export function lengthBucket(tokens: number): string {
  const count = Math.max(0, Math.floor(tokens));
  let lower = 0;
  for (const upper of LENGTH_BUCKET_BOUNDS) {
    if (count <= upper) return `${lower}-${upper}`;
    lower = upper + 1;
  }
  return `>${lower}`;
}

/**
 * All bucket keys that {@link lengthBucket} can produce, in ascending token
 * order. Useful for iterating buckets deterministically.
 */
export const LENGTH_BUCKETS: readonly string[] = (() => {
  const keys: string[] = [];
  let lower = 0;
  for (const upper of LENGTH_BUCKET_BOUNDS) {
    keys.push(`${lower}-${upper}`);
    lower = upper + 1;
  }
  keys.push(`>${lower}`);
  return keys;
})();

/**
 * An indexed segment together with its derived bucket and model key.
 */
export interface IndexedSegment {
  /** The indexed segment (a stable reference, not a copy). */
  segment: CachedSegment;
  /** Length-bucket key, see {@link lengthBucket}. */
  bucket: string;
  /** Model key: the segment's model, or the sentinel `'*'` for none. */
  modelKey: string;
}

/**
 * Aggregate counts over the index's current distribution.
 */
export interface CacheIndexStats {
  /** Total number of indexed segments. */
  segments: number;
  /** Number of distinct model keys represented. */
  models: number;
  /** Number of distinct length buckets represented. */
  buckets: number;
  /** Sum of every indexed segment's token footprint. */
  totalTokens: number;
  /** Sum of every indexed segment's hits. */
  totalHits: number;
  /** The largest footprint among indexed segments (`0` when empty). */
  maxTokens: number;
  /** Distribution of segments across length buckets (bucket -> count). */
  byBucket: Record<string, number>;
}

/**
 * Plain-JSON shape produced by {@link CacheIndex.toJSON} and accepted by
 * {@link CacheIndex.fromJSON}.
 */
export interface CacheIndexJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** The indexed segments, in insertion order. */
  segments: CachedSegment[];
}

/**
 * Constructor options for {@link CacheIndex}.
 */
export interface CacheIndexOptions {
  /**
   * Bucket upper boundaries. Defaults to {@link LENGTH_BUCKET_BOUNDS};
   * pass a custom list to re-tune bucket granularity for a specific corpus.
   */
  bucketBounds?: readonly number[];
}

/* ------------------------------------------------------------------------ *
 * Index
 * ------------------------------------------------------------------------ */

/**
 * Query-oriented read model over cached segments.
 *
 * Maintains a forward `segmentId -> IndexedSegment` map plus reverse maps
 * for model keys, length buckets and a hit-ordering structure. All lookups
 * are read-only; mutation happens via {@link indexSegment},
 * {@link removeSegment}, {@link clear} and {@link rebuild}.
 */
export class CacheIndex {
  /** Forward map: segment id -> indexed entry. */
  private readonly _entries: Map<string, IndexedSegment>;
  /** Reverse map: model key -> set of segment ids. */
  private readonly _byModel: Map<string, Set<string>>;
  /** Reverse map: length bucket -> set of segment ids. */
  private readonly _byBucket: Map<string, Set<string>>;
  /** Active bucket upper boundaries. */
  private readonly _bounds: readonly number[];

  /**
   * Creates an empty index.
   *
   * @param options - bucket tuning; see {@link CacheIndexOptions}.
   */
  constructor(options: CacheIndexOptions = {}) {
    this._entries = new Map<string, IndexedSegment>();
    this._byModel = new Map<string, Set<string>>();
    this._byBucket = new Map<string, Set<string>>();
    this._bounds =
      options.bucketBounds !== undefined && options.bucketBounds.length > 0
        ? Array.from(options.bucketBounds, (b) => Math.max(0, Math.floor(b))).sort(
            (a, b) => a - b,
          )
        : LENGTH_BUCKET_BOUNDS;
  }

  /* -------------------------------------------------------------------- *
   * Derivation helpers
   * -------------------------------------------------------------------- */

  /**
   * Computes the model key for a segment: its model string, or `'*'` when
   * the segment is model-agnostic.
   */
  modelKeyFor(segment: CachedSegment): string {
    return segment.model !== undefined && segment.model.length > 0
      ? segment.model
      : '*';
  }

  /**
   * Computes the length-bucket key for a segment under this index's
   * configured bounds.
   */
  bucketFor(segment: CachedSegment): string {
    return this._bucketForTokens(segment.tokens);
  }

  /**
   * Buckets a raw token count under this index's configured bounds.
   */
  private _bucketForTokens(tokens: number): string {
    const count = Math.max(0, Math.floor(tokens));
    let lower = 0;
    for (const upper of this._bounds) {
      if (count <= upper) return `${lower}-${upper}`;
      lower = upper + 1;
    }
    return `>${lower}`;
  }

  /* -------------------------------------------------------------------- *
   * Mutation
   * -------------------------------------------------------------------- */

  /**
   * Inserts or replaces the indexed entry for a segment.
   *
   * The reverse maps are kept in sync: the segment leaves any previous
   * model/bucket buckets and joins the ones matching its current values.
   *
   * @returns the indexed entry for the segment.
   */
  indexSegment(segment: CachedSegment): IndexedSegment {
    if (!isCachedSegment(segment)) {
      throw new TypeError(`Invalid CachedSegment: ${JSON.stringify(segment)}`);
    }
    const previous = this._entries.get(segment.id);
    if (previous) {
      this._byModel.get(previous.modelKey)?.delete(segment.id);
      this._byBucket.get(previous.bucket)?.delete(segment.id);
    }
    const modelKey = this.modelKeyFor(segment);
    const bucket = this.bucketFor(segment);
    const entry: IndexedSegment = { segment, bucket, modelKey };
    this._entries.set(segment.id, entry);
    this._addToSet(this._byModel, modelKey, segment.id);
    this._addToSet(this._byBucket, bucket, segment.id);
    return entry;
  }

  /**
   * Re-indexes a segment whose *underlying record* changed in place. Use
   * this after the store's record for an id was replaced (e.g. a refreshed
   * merge) so the projections reflect the latest values.
   *
   * @returns the fresh indexed entry, or `undefined` when `id` was not
   *   indexed.
   */
  refresh(id: string, segment?: CachedSegment): IndexedSegment | undefined {
    if (!isSegmentId(id)) return undefined;
    const current = this._entries.get(id);
    if (!current) return undefined;
    const source = segment ?? current.segment;
    return this.indexSegment(source);
  }

  /**
   * Removes a segment from the index entirely.
   *
   * @returns the removed entry, or `undefined` when `id` was not indexed.
   */
  removeSegment(id: string): IndexedSegment | undefined {
    if (!isSegmentId(id)) return undefined;
    const entry = this._entries.get(id);
    if (!entry) return undefined;
    this._entries.delete(id);
    this._byModel.get(entry.modelKey)?.delete(id);
    this._byBucket.get(entry.bucket)?.delete(id);
    return entry;
  }

  /**
   * Clears the index completely.
   */
  clear(): void {
    this._entries.clear();
    this._byModel.clear();
    this._byBucket.clear();
  }

  /**
   * Replaces the entire index with freshly indexed entries derived from
   * `segments`. Invalid records are skipped.
   *
   * @returns the number of records actually indexed.
   */
  rebuild(segments: Iterable<CachedSegment>): number {
    this.clear();
    let indexed = 0;
    for (const segment of segments) {
      if (!isCachedSegment(segment)) continue;
      this.indexSegment(segment);
      indexed += 1;
    }
    return indexed;
  }

  /* -------------------------------------------------------------------- *
   * Read access
   * -------------------------------------------------------------------- */

  /**
   * Returns the indexed entry for `id`, or `undefined`.
   */
  findBySegmentId(id: string): IndexedSegment | undefined {
    if (!isSegmentId(id)) return undefined;
    return this._entries.get(id);
  }

  /**
   * Returns `true` when `id` is currently indexed.
   */
  has(id: string): boolean {
    return isSegmentId(id) && this._entries.has(id);
  }

  /**
   * Number of indexed segments.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * All indexed segment ids, in insertion order.
   */
  keys(): string[] {
    return Array.from(this._entries.keys());
  }

  /**
   * All indexed segments (stable references to the underlying records).
   */
  segments(): CachedSegment[] {
    return Array.from(this._entries.values(), (entry) => entry.segment);
  }

  /**
   * All indexed entries (stable references).
   */
  entries(): IndexedSegment[] {
    return Array.from(this._entries.values());
  }

  /* -------------------------------------------------------------------- *
   * Model projection
   * -------------------------------------------------------------------- */

  /**
   * Returns every segment cached under `model`, or every segment when
   * `model` is `'*'`/omitted. Model-agnostic segments (stored without a
   * model) are always included, since they are valid for any model.
   */
  findByModel(model?: string): CachedSegment[] {
    if (model === undefined || model === '*') return this.segments();
    const exact = this._byModel.get(model);
    const wildcard = this._byModel.get('*');
    const result: CachedSegment[] = [];
    const seen = new Set<string>();
    const collect = (ids: Set<string> | undefined): void => {
      if (!ids) return;
      for (const id of ids) {
        if (seen.has(id)) continue;
        const entry = this._entries.get(id);
        if (entry) {
          result.push(entry.segment);
          seen.add(id);
        }
      }
    };
    collect(exact);
    collect(wildcard);
    return result;
  }

  /**
   * Returns the ids indexed under `model` (plus the wildcard set when
   * `includeWildcard` is `true`).
   */
  modelIds(model: string, includeWildcard = true): string[] {
    const ids: string[] = [];
    const exact = this._byModel.get(model);
    if (exact) ids.push(...exact);
    if (includeWildcard) {
      const wildcard = this._byModel.get('*');
      if (wildcard) ids.push(...wildcard);
    }
    return Array.from(new Set(ids));
  }

  /**
   * Every model key currently represented in the index.
   */
  models(): string[] {
    return Array.from(this._byModel.keys());
  }

  /* -------------------------------------------------------------------- *
   * Length-bucket projection
   * -------------------------------------------------------------------- */

  /**
   * Returns every segment whose length bucket equals `bucket` (e.g.
   * `"501-1000"`). Returns `[]` for an unknown bucket key.
   */
  findByLengthBucket(bucket: string): CachedSegment[] {
    const ids = this._byBucket.get(bucket);
    if (!ids) return [];
    return Array.from(ids, (id) => this._entries.get(id)!.segment);
  }

  /**
   * Returns every segment whose token footprint is at most `maxTokens`.
   */
  findByMaxTokens(maxTokens: number): CachedSegment[] {
    const ceiling = Math.max(0, Math.floor(maxTokens));
    const result: CachedSegment[] = [];
    for (const entry of this._entries.values()) {
      if (entry.segment.tokens <= ceiling) result.push(entry.segment);
    }
    return result;
  }

  /**
   * Returns every segment whose token footprint is at least `minTokens`.
   */
  findByMinTokens(minTokens: number): CachedSegment[] {
    const floor = Math.max(0, Math.floor(minTokens));
    const result: CachedSegment[] = [];
    for (const entry of this._entries.values()) {
      if (entry.segment.tokens >= floor) result.push(entry.segment);
    }
    return result;
  }

  /**
   * Returns the segments with the largest token footprints, in descending
   * order, limited to `limit` entries (default `10`).
   */
  findLargest(limit = 10): CachedSegment[] {
    const sorted = Array.from(this._entries.values(), (entry) => entry.segment).sort(
      (a, b) => b.tokens - a.tokens,
    );
    return sorted.slice(0, Math.max(0, Math.floor(limit)));
  }

  /**
   * All length-bucket keys represented in the index.
   */
  buckets(): string[] {
    return Array.from(this._byBucket.keys());
  }

  /* -------------------------------------------------------------------- *
   * Hits projection
   * -------------------------------------------------------------------- */

  /**
   * Returns every segment whose hit count falls within `[min, max]`
   * (inclusive; `max` omitted means unbounded), ordered by hit count
   * ascending.
   */
  findByHitsRange(min: number, max?: number): CachedSegment[] {
    const lo = Math.max(0, Math.floor(min));
    const hi = max !== undefined ? Math.max(lo, Math.floor(max)) : Infinity;
    const matches: CachedSegment[] = [];
    for (const entry of this._entries.values()) {
      if (entry.segment.hits >= lo && entry.segment.hits <= hi) {
        matches.push(entry.segment);
      }
    }
    matches.sort((a, b) => a.hits - b.hits);
    return matches;
  }

  /**
   * Returns every segment at or above `minHits` (i.e. promotable/hot).
   */
  findByMinHits(minHits: number): CachedSegment[] {
    return this.findByHitsRange(minHits);
  }

  /**
   * Returns every segment with exactly zero recorded hits (eviction fodder).
   */
  findCold(): CachedSegment[] {
    return this.findByHitsRange(0, 0);
  }

  /**
   * Returns the most-reused segments, in descending hit order, limited to
   * `limit` entries (default `10`).
   */
  findHottest(limit = 10): CachedSegment[] {
    const sorted = Array.from(this._entries.values(), (entry) => entry.segment).sort(
      (a, b) => b.hits - a.hits,
    );
    return sorted.slice(0, Math.max(0, Math.floor(limit)));
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Computes distribution statistics over the current index.
   */
  stats(): CacheIndexStats {
    let totalTokens = 0;
    let totalHits = 0;
    let maxTokens = 0;
    const byBucket: Record<string, number> = {};
    for (const entry of this._entries.values()) {
      totalTokens += entry.segment.tokens;
      totalHits += entry.segment.hits;
      if (entry.segment.tokens > maxTokens) maxTokens = entry.segment.tokens;
      byBucket[entry.bucket] = (byBucket[entry.bucket] ?? 0) + 1;
    }
    return {
      segments: this._entries.size,
      models: this._byModel.size,
      buckets: this._byBucket.size,
      totalTokens,
      totalHits,
      maxTokens,
      byBucket,
    };
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the index to a plain, JSON-friendly object.
   */
  toJSON(): CacheIndexJSON {
    return {
      version: 1,
      segments: Array.from(this._entries.values(), (entry) => ({ ...entry.segment })),
    };
  }

  /**
   * Clears and reloads the index from `data`. Invalid records are skipped.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this.clear();
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    const list = parsed['segments'];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (isCachedSegment(entry)) this.indexSegment(entry);
      }
    }
    return this;
  }

  /**
   * Rehydrates a new index from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): CacheIndex {
    const index = new CacheIndex();
    index.fromJSON(data);
    return index;
  }

  /**
   * Builds an index directly from an iterable of segments.
   */
  static build(
    segments: Iterable<CachedSegment>,
    options: CacheIndexOptions = {},
  ): CacheIndex {
    const index = new CacheIndex(options);
    index.rebuild(segments);
    return index;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Adds `id` to the set under `key` in a reverse map, creating the set
   * when needed.
   */
  private _addToSet(map: Map<string, Set<string>>, key: string, id: string): void {
    let set = map.get(key);
    if (!set) {
      set = new Set<string>();
      map.set(key, set);
    }
    set.add(id);
  }
}

/**
 * Convenience bucket classifier for a raw token count, mirroring
 * {@link lengthBucket} with the default bounds. Provided for callers that
 * want to classify a number without building an index instance.
 */
export function classifyBucket(tokens: number): string {
  return lengthBucket(tokens);
}