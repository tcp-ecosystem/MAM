/**
 * @fileoverview Queryable index over cached token estimates.
 *
 * The Estimation layer produces many {@link TokenEstimate} records. Looking at
 * them one at a time is fine, but aggregation tasks — "how many tokens are
 * cached for `gpt-4`?", "which cached estimates fall in the 1k–2k token
 * range?", "how reliable is the word-based fallback across the cache?" — need
 * an index. {@link EstimateIndex} provides exactly that.
 *
 * The index maintains three complementary views over a flat key→estimate map:
 *
 *   1. by model family (`byModel`)
 *   2. by token-length bucket (`byLengthBucket`), where buckets are
 *      fixed-width windows of {@link LENGTH_BUCKET_SIZE} tokens
 *   3. by estimation method (`byMethod`)
 *
 * Keys are the same content-addressed keys produced by
 * {@link ./store.js} `EstimateStore#keyFor`, so the index and the store can
 * share a key space and be kept consistent by the lifecycle layer.
 *
 * The index is a companion to — not a replacement for — the store: the store
 * answers "is this exact text cached?" while the index answers "what *kind* of
 * estimates are cached?". Both are wired together in {@link ./lifecycle.js}.
 *
 * @module estimation/index
 */

import type { TokenEstimate, TokenEstimationMethod } from './types.js';
import {
  ESTIMATION_METHODS,
  LENGTH_BUCKET_SIZE,
  isTokenEstimate,
  lengthBucketFor,
} from './types.js';
import { hashContent } from './store.js';

/**
 * Lower bound for {@link EstimateIndex} constructor `maxBuckets`. The index
 * deliberately refuses to track more than this many distinct length buckets to
 * avoid pathological unbounded growth on wildly out-of-range estimates.
 */
export const MIN_MAX_BUCKETS = 8;

/**
 * Default maximum number of distinct length buckets the index will track.
 * With {@link LENGTH_BUCKET_SIZE} = 500 this covers estimates up to ~50k
 * tokens per bucket tier before eviction of oldest buckets kicks in.
 */
export const DEFAULT_MAX_BUCKETS = 128;

/**
 * Options accepted by the {@link EstimateIndex} constructor.
 */
export interface EstimateIndexOptions {
  /**
   * Maximum number of distinct length buckets tracked. When a new bucket would
   * exceed this limit, the oldest bucket is dropped entirely (its estimates
   * remain in `byModel` / `byMethod`, but the bucket view forgets them).
   * Defaults to {@link DEFAULT_MAX_BUCKETS}.
   */
  readonly maxBuckets?: number;
}

/**
 * Aggregate view of every estimate in the index. Returned by
 * {@link EstimateIndex#stats}.
 */
export interface IndexStats {
  /** Total number of indexed estimates. */
  readonly entries: number;
  /** Number of distinct model families represented. */
  readonly models: number;
  /** Number of distinct length buckets represented. */
  readonly buckets: number;
  /** Number of distinct estimation methods represented. */
  readonly methods: number;
  /** Per-model histogram (only models with ≥ 1 entry). */
  readonly byModel: Record<string, number>;
  /** Per-bucket histogram (keyed by bucket label like `500-999`). */
  readonly byLengthBucket: Record<string, number>;
  /** Per-method histogram. */
  readonly byMethod: Record<string, number>;
}

/**
 * A length-bucket key rendered as a human-readable window label. Buckets are
 * inclusive of their lower bound and exclusive of their upper bound.
 *
 * @param index - The zero-based bucket index.
 * @returns A label like `0-499` or `500-999`.
 */
export function bucketLabel(index: number): string {
  const start = index * LENGTH_BUCKET_SIZE;
  return `${start}-${start + LENGTH_BUCKET_SIZE - 1}`;
}

/**
 * Compact per-view histogram types returned by {@link EstimateIndex#histograms}.
 */
export interface ModelIndexStats {
  /** Number of distinct model families represented. */
  readonly total: number;
  /** Per-model counts keyed by model id. */
  readonly counts: Record<string, number>;
}

/** @see {@link ModelIndexStats} (specialized for length buckets). */
export interface LengthBucketIndexStats {
  /** Number of distinct length buckets represented. */
  readonly total: number;
  /** Per-bucket counts keyed by bucket label. */
  readonly counts: Record<string, number>;
}

/** @see {@link ModelIndexStats} (specialized for estimation methods). */
export interface EstimationMethodIndexStats {
  /** Number of distinct estimation methods represented. */
  readonly total: number;
  /** Per-method counts keyed by method name. */
  readonly counts: Record<string, number>;
}

/**
 * Queryable index over {@link TokenEstimate} records.
 *
 * @example
 * ```ts
 * const index = new EstimateIndex();
 * index.indexEstimate(estimateA);
 * index.indexEstimate(estimateB);
 * const gpt4 = index.findByModel('gpt-4');
 * const mid = index.findByLengthRange(500, 2000);
 * ```
 */
export class EstimateIndex {
  /** Maximum number of distinct length buckets tracked. */
  readonly maxBuckets: number;

  /** Flat map: content-addressed key → estimate. */
  private readonly entries: Map<string, TokenEstimate> = new Map();

  /** View 1: model family → set of keys. */
  private readonly byModel: Map<string, Set<string>> = new Map();

  /** View 2: bucket index → set of keys. */
  private readonly byLengthBucket: Map<number, Set<string>> = new Map();

  /** View 3: estimation method → set of keys. */
  private readonly byMethod: Map<TokenEstimationMethod, Set<string>> = new Map();

  /** Bucket insertion order, used to evict the oldest bucket when capped. */
  private readonly bucketOrder: number[] = [];

  /** Lifetime counters for {@link stats}. */
  private counters = {
    indexed: 0,
    removed: 0,
    rebuilds: 0,
    clears: 0,
  };

  /**
   * @param options - Tuning options (see {@link EstimateIndexOptions}).
   */
  constructor(options: Readonly<EstimateIndexOptions> = {}) {
    const raw = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    if (!Number.isInteger(raw) || raw < MIN_MAX_BUCKETS) {
      throw new RangeError(
        `EstimateIndex: maxBuckets must be an integer >= ${MIN_MAX_BUCKETS} (got ${String(raw)})`,
      );
    }
    this.maxBuckets = raw;
  }

  /**
   * Compute the content-addressed key for a `(text, model)` pair, consistent
   * with {@link ./store.js} `EstimateStore#keyFor` (minus any store namespace).
   *
   * @param text - The estimate's input text.
   * @param model - Optional model family.
   * @returns The index key.
   */
  keyFor(text: string, model?: string): string {
    return `${hashContent(text)}::${model ?? ''}`;
  }

  /**
   * Insert an estimate into every view. Idempotent: indexing the same estimate
   * twice replaces its previous slots rather than duplicating it.
   *
   * @param estimate - The estimate to index.
   * @returns The key the estimate was indexed under.
   */
  indexEstimate(estimate: TokenEstimate): string {
    if (!isTokenEstimate(estimate)) {
      throw new TypeError('EstimateIndex#indexEstimate: estimate failed structural validation');
    }
    const key = this.keyFor(estimate.input, estimate.model);

    this.removeKeyFromViews(key);

    this.entries.set(key, Object.freeze({ ...estimate }));
    this.addToModel(estimate.model, key);
    this.addToBucket(lengthBucketFor(estimate.tokens), key);
    this.addToMethod(estimate.method, key);
    this.counters.indexed += 1;
    return key;
  }

  /**
   * Remove an estimate from the index by its content-addressed key. Mirrors
   * {@link ./store.js} `EstimateStore#delete`.
   *
   * @param key - Key of the estimate to remove.
   * @returns `true` when an estimate was actually removed.
   */
  removeEstimate(key: string): boolean {
    const removed = this.entries.delete(key);
    if (removed) {
      this.removeKeyFromViews(key);
      this.counters.removed += 1;
    }
    return removed;
  }

  /**
   * Remove every estimate belonging to a model family. Useful when a
   * calibration clears all prior estimates for a model.
   *
   * @param model - Canonical model id to purge.
   * @returns The number of estimates removed.
   */
  removeForModel(model: string): number {
    const keys = this.byModel.get(model);
    if (!keys) return 0;
    let removed = 0;
    for (const key of [...keys]) {
      if (this.entries.delete(key)) removed += 1;
    }
    this.removeKeyFromViewsByModel(model);
    this.byModel.delete(model);
    this.counters.removed += removed;
    return removed;
  }

  /**
   * Look up a single estimate by key.
   *
   * @param key - Content-addressed key.
   * @returns The indexed estimate, or `undefined`.
   */
  get(key: string): TokenEstimate | undefined {
    return this.entries.get(key);
  }

  /**
   * Check whether a key is indexed.
   *
   * @param key - Content-addressed key.
   * @returns `true` when the key is present.
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Return all keys currently indexed. Fresh array; safe to iterate while the
   * index is mutated.
   */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Number of indexed estimates.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * All estimates indexed by a given model family. Estimates are returned in
   * insertion order.
   *
   * @param model - Canonical model id.
   * @returns Matching estimates (empty array when none).
   */
  findByModel(model: string): TokenEstimate[] {
    const keys = this.byModel.get(model);
    if (!keys) return [];
    const out: TokenEstimate[] = [];
    for (const key of keys) {
      const estimate = this.entries.get(key);
      if (estimate) out.push(estimate);
    }
    return out;
  }

  /**
   * All estimates produced by a given estimation method.
   *
   * @param method - The method to match.
   * @returns Matching estimates (empty array when none).
   */
  findByMethod(method: TokenEstimationMethod): TokenEstimate[] {
    const keys = this.byMethod.get(method);
    if (!keys) return [];
    const out: TokenEstimate[] = [];
    for (const key of keys) {
      const estimate = this.entries.get(key);
      if (estimate) out.push(estimate);
    }
    return out;
  }

  /**
   * All estimates whose token count falls within `[minTokens, maxTokens]`
   * (both inclusive). Backed by the length-bucket index: only buckets that
   * overlap the requested range are scanned.
   *
   * @param minTokens - Inclusive lower bound (clamped to >= 0).
   * @param maxTokens - Inclusive upper bound (clamped to >= `minTokens`).
   * @returns Matching estimates, deduplicated, in insertion order.
   */
  findByLengthRange(minTokens: number, maxTokens: number): TokenEstimate[] {
    const low = Number.isFinite(minTokens) && minTokens >= 0 ? Math.floor(minTokens) : 0;
    const high = Number.isFinite(maxTokens) && maxTokens >= low ? Math.floor(maxTokens) : low;
    const firstBucket = lengthBucketFor(low);
    const lastBucket = lengthBucketFor(high);
    const seen = new Set<string>();
    const out: TokenEstimate[] = [];
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const keys = this.byLengthBucket.get(bucket);
      if (!keys) continue;
      for (const key of keys) {
        if (seen.has(key)) continue;
        const estimate = this.entries.get(key);
        if (!estimate) continue;
        if (estimate.tokens >= low && estimate.tokens <= high) {
          seen.add(key);
          out.push(estimate);
        }
      }
    }
    return out;
  }

  /**
   * All estimates resident in a single length bucket.
   *
   * @param bucketIndex - Zero-based bucket index (see {@link lengthBucketFor}).
   * @returns Matching estimates (empty array when none).
   */
  findByLengthBucket(bucketIndex: number): TokenEstimate[] {
    const keys = this.byLengthBucket.get(bucketIndex);
    if (!keys) return [];
    const out: TokenEstimate[] = [];
    for (const key of keys) {
      const estimate = this.entries.get(key);
      if (estimate) out.push(estimate);
    }
    return out;
  }

  /**
   * Count indexed estimates for a model family without materializing them.
   *
   * @param model - Canonical model id.
   * @returns The number of estimates for that model (0 when none).
   */
  countByModel(model: string): number {
    return this.byModel.get(model)?.size ?? 0;
  }

  /**
   * Count indexed estimates per length bucket. Returns a map of bucket index →
   * count; the bucket index can be rendered with {@link bucketLabel}.
   */
  countsByBucket(): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const [bucket, keys] of this.byLengthBucket) {
      counts.set(bucket, keys.size);
    }
    return counts;
  }

  /**
   * List the model families currently present in the index.
   */
  models(): string[] {
    return [...this.byModel.keys()];
  }

  /**
   * List the length buckets currently present, sorted ascending, as labels
   * rendered by {@link bucketLabel}.
   */
  lengthBuckets(): string[] {
    return [...this.byLengthBucket.keys()].sort((a, b) => a - b).map(bucketLabel);
  }

  /**
   * Rebuild the index from scratch using the provided estimates. This is the
   * recommended way to initialize the index from a persisted snapshot or from
   * the contents of a {@link ./store.js} `EstimateStore`.
   *
   * @param source - Iterable of estimates to index.
   * @returns The number of estimates indexed.
   */
  rebuild(source: Iterable<TokenEstimate>): number {
    this.entries.clear();
    this.byModel.clear();
    this.byLengthBucket.clear();
    this.byMethod.clear();
    this.bucketOrder.length = 0;
    this.counters.rebuilds += 1;
    let count = 0;
    for (const estimate of source) {
      if (!isTokenEstimate(estimate)) continue;
      const key = this.keyFor(estimate.input, estimate.model);
      this.entries.set(key, Object.freeze({ ...estimate }));
      this.addToModel(estimate.model, key);
      this.addToBucket(lengthBucketFor(estimate.tokens), key);
      this.addToMethod(estimate.method, key);
      count += 1;
    }
    this.counters.indexed += count;
    return count;
  }

  /**
   * Remove every estimate and reset all views. Lifetime counters (`indexed`,
   * `removed`) are preserved so callers can compute aggregate throughput.
   */
  clear(): void {
    this.entries.clear();
    this.byModel.clear();
    this.byLengthBucket.clear();
    this.byMethod.clear();
    this.bucketOrder.length = 0;
    this.counters.clears += 1;
  }

  /**
   * Aggregate statistics about the index. See {@link IndexStats}.
   *
   * @returns A fresh stats snapshot.
   */
  stats(): IndexStats {
    const byModel: Record<string, number> = {};
    for (const [model, keys] of this.byModel) byModel[model] = keys.size;
    const byLengthBucket: Record<string, number> = {};
    for (const [bucket, keys] of this.byLengthBucket) {
      byLengthBucket[bucketLabel(bucket)] = keys.size;
    }
    const byMethod: Record<string, number> = {};
    for (const [method, keys] of this.byMethod) byMethod[method] = keys.size;
    return {
      entries: this.entries.size,
      models: this.byModel.size,
      buckets: this.byLengthBucket.size,
      methods: this.byMethod.size,
      byModel,
      byLengthBucket,
      byMethod,
    };
  }

  /**
   * Serialize the index to a JSON-friendly shape. The flat estimate list is
   * the source of truth; the three views are reconstructed on deserialize via
   * {@link rebuild}.
   *
   * @returns A serializable snapshot.
   */
  toJSON(): {
    version: 1;
    estimates: readonly TokenEstimate[];
    indexed: number;
  } {
    return {
      version: 1,
      estimates: [...this.entries.values()],
      indexed: this.counters.indexed,
    };
  }

  /**
   * Restore the index from a snapshot produced by {@link toJSON}.
   *
   * @param snapshot - Snapshot to restore from.
   * @returns The number of estimates restored.
   */
  fromJSON(snapshot: {
    version: 1;
    estimates: readonly TokenEstimate[];
  }): number {
    if (!snapshot || snapshot.version !== 1) {
      throw new TypeError('EstimateIndex#fromJSON: unsupported snapshot version');
    }
    return this.rebuild(snapshot.estimates);
  }

  /**
   * Add a key to the by-model view, creating the set if needed.
   */
  private addToModel(model: string | undefined, key: string): void {
    const id = model ?? '';
    let set = this.byModel.get(id);
    if (!set) {
      set = new Set();
      this.byModel.set(id, set);
    }
    set.add(key);
  }

  /**
   * Add a key to the by-bucket view, enforcing the bucket cap by evicting the
   * oldest bucket when the limit is exceeded.
   */
  private addToBucket(bucket: number, key: string): void {
    let set = this.byLengthBucket.get(bucket);
    if (!set) {
      set = new Set();
      this.byLengthBucket.set(bucket, set);
      this.bucketOrder.push(bucket);
      this.evictOldestBucketIfNeeded();
    }
    set.add(key);
  }

  /**
   * Add a key to the by-method view, creating the set if needed.
   */
  private addToMethod(method: TokenEstimationMethod, key: string): void {
    let set = this.byMethod.get(method);
    if (!set) {
      set = new Set();
      this.byMethod.set(method, set);
    }
    set.add(key);
  }

  /**
   * Remove a key from all three views. The flat `entries` map is NOT touched —
   * callers decide whether the key stays addressable.
   */
  private removeKeyFromViews(key: string): void {
    for (const set of this.byModel.values()) set.delete(key);
    for (const set of this.byLengthBucket.values()) set.delete(key);
    for (const set of this.byMethod.values()) set.delete(key);
  }

  /**
   * Remove every key of a model from the bucket and method views (the by-model
   * set itself is dropped by the caller).
   */
  private removeKeyFromViewsByModel(model: string): void {
    const keys = this.byModel.get(model);
    if (!keys) return;
    for (const key of keys) {
      for (const set of this.byLengthBucket.values()) set.delete(key);
      for (const set of this.byMethod.values()) set.delete(key);
    }
  }

  /**
   * Enforce `maxBuckets`: when the number of tracked buckets exceeds the cap,
   * drop the oldest bucket (and its keys) from the bucket view entirely.
   */
  private evictOldestBucketIfNeeded(): void {
    while (this.bucketOrder.length > this.maxBuckets) {
      const oldest = this.bucketOrder.shift();
      if (oldest === undefined) break;
      this.byLengthBucket.delete(oldest);
    }
  }

  /**
   * Collapse the model / bucket / method views down to a compact triple of
   * histograms. Provided as a typed convenience for the three view types
   * declared above; simply delegates to {@link stats}.
   */
  histograms(): {
    model: ModelIndexStats;
    lengthBucket: LengthBucketIndexStats;
    method: EstimationMethodIndexStats;
  } {
    const snapshot = this.stats();
    return {
      model: { total: snapshot.models, counts: snapshot.byModel },
      lengthBucket: { total: snapshot.buckets, counts: snapshot.byLengthBucket },
      method: { total: snapshot.methods, counts: snapshot.byMethod },
    };
  }
}

/**
 * Convenience helper: derive every length-bucket index that intersects the
 * given inclusive range. Exported for callers that want to reason about bucket
 * coverage without consulting a live index.
 *
 * @param minTokens - Inclusive lower bound.
 * @param maxTokens - Inclusive upper bound.
 * @returns The sorted list of bucket indices covering `[minTokens, maxTokens]`.
 */
export function bucketsCoveringRange(minTokens: number, maxTokens: number): number[] {
  const low = Number.isFinite(minTokens) && minTokens >= 0 ? Math.floor(minTokens) : 0;
  const high = Number.isFinite(maxTokens) && maxTokens >= low ? Math.floor(maxTokens) : low;
  const out: number[] = [];
  for (let bucket = lengthBucketFor(low); bucket <= lengthBucketFor(high); bucket += 1) {
    out.push(bucket);
  }
  return out;
}

/**
 * Export of the method-tuple used internally for iteration; re-exported here so
 * consumers of the index can rely on the same ordering when rendering method
 * histograms.
 */
export const INDEXED_METHODS: readonly TokenEstimationMethod[] = ESTIMATION_METHODS;