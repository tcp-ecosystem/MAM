/**
 * @fileoverview Queryable index over cached compression results.
 *
 * The Compression layer produces many {@link CompressionResult} records.
 * Looking at them one at a time is fine, but aggregation tasks — "which
 * results saved the most tokens?", "which techniques actually fired?", "how
 * much did `dedupe-blocks` contribute to the cache?" — need an index.
 * {@link CompressionIndex} provides exactly that.
 *
 * The index maintains two complementary views over a flat key→result map:
 *
 *   1. by technique (`byTechnique`): the ordered list of techniques that were
 *      actually applied to a result.
 *   2. by savings bucket (`bySavingsBucket`): fixed-width windows of saved
 *      tokens, where a bucket covers {@link SAVINGS_BUCKET_SIZE} saved tokens
 *      (bucket 0 = [0, 20), bucket 1 = [20, 40), …).
 *
 * Keys are the same content-addressed keys produced by
 * {@link ./store.js} `CompressionStore#keyFor`, so the index and the store can
 * share a key space and be kept consistent by the lifecycle layer.
 *
 * The index is a companion to — not a replacement for — the store: the store
 * answers "is this exact text cached?" while the index answers "what *kind* of
 * results are cached?". Both are wired together in {@link ./lifecycle.js}.
 *
 * @module compression/index
 */

import type {
  CompressionResult,
  CompressionTechnique,
} from './types.js';
import {
  SAVINGS_BUCKET_SIZE,
  isCompressionResult,
  isCompressionTechnique,
  savingsBucketFor,
} from './types.js';
import { hashContent } from './store.js';

/**
 * Lower bound for {@link CompressionIndex} constructor `maxBuckets`. The index
 * deliberately refuses to track more than this many distinct savings buckets
 * to avoid pathological unbounded growth on wildly-out-of-range savings.
 */
export const MIN_MAX_BUCKETS = 8;

/**
 * Default maximum number of distinct savings buckets the index will track.
 * With {@link SAVINGS_BUCKET_SIZE} = 20 this covers results saving up to
 * ~2.5k tokens per bucket tier before eviction of oldest buckets kicks in.
 */
export const DEFAULT_MAX_BUCKETS = 128;

/**
 * Options accepted by the {@link CompressionIndex} constructor.
 */
export interface CompressionIndexOptions {
  /**
   * Maximum number of distinct savings buckets tracked. When a new bucket
   * would exceed this limit, the oldest bucket is dropped entirely (its
   * results remain in `byTechnique`, but the bucket view forgets them).
   * Defaults to {@link DEFAULT_MAX_BUCKETS}.
   */
  readonly maxBuckets?: number;
}

/**
 * Aggregate view of every result in the index. Returned by
 * {@link CompressionIndex#stats}.
 */
export interface IndexStats {
  /** Total number of indexed results. */
  readonly entries: number;
  /** Number of distinct techniques represented. */
  readonly techniques: number;
  /** Number of distinct savings buckets represented. */
  readonly buckets: number;
  /** Per-technique histogram (only techniques with ≥ 1 entry). */
  readonly byTechnique: Record<string, number>;
  /** Per-bucket histogram (keyed by bucket label like `20-39`). */
  readonly bySavingsBucket: Record<string, number>;
}

/**
 * Compact per-view histogram types returned by {@link CompressionIndex#histograms}.
 */
export interface TechniqueIndexStats {
  /** Number of distinct techniques represented. */
  readonly total: number;
  /** Per-technique counts keyed by technique name. */
  readonly counts: Record<string, number>;
}

/** @see {@link TechniqueIndexStats} (specialized for savings buckets). */
export interface SavingsBucketIndexStats {
  /** Number of distinct savings buckets represented. */
  readonly total: number;
  /** Per-bucket counts keyed by bucket label. */
  readonly counts: Record<string, number>;
}

/**
 * A savings-bucket key rendered as a human-readable window label. Buckets are
 * inclusive of their lower bound and exclusive of their upper bound.
 *
 * @param index - The zero-based bucket index.
 * @returns A label like `0-19` or `20-39`.
 */
export function bucketLabel(index: number): string {
  const start = index * SAVINGS_BUCKET_SIZE;
  return `${start}-${start + SAVINGS_BUCKET_SIZE - 1}`;
}

/**
 * Queryable index over {@link CompressionResult} records.
 *
 * @example
 * ```ts
 * const index = new CompressionIndex();
 * index.indexResult(resultA);
 * index.indexResult(resultB);
 * const deduped = index.findByTechnique('dedupe-blocks');
 * const heavy = index.findBySavingsRange(40, 200);
 * ```
 */
export class CompressionIndex {
  /** Maximum number of distinct savings buckets tracked. */
  readonly maxBuckets: number;

  /** Flat map: content-addressed key → result. */
  private readonly entries: Map<string, CompressionResult> = new Map();

  /** View 1: technique → set of keys. */
  private readonly byTechnique: Map<CompressionTechnique, Set<string>> = new Map();

  /** View 2: savings bucket index → set of keys. */
  private readonly bySavingsBucket: Map<number, Set<string>> = new Map();

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
   * @param options - Tuning options (see {@link CompressionIndexOptions}).
   */
  constructor(options: Readonly<CompressionIndexOptions> = {}) {
    const raw = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    if (!Number.isInteger(raw) || raw < MIN_MAX_BUCKETS) {
      throw new RangeError(
        `CompressionIndex: maxBuckets must be an integer >= ${MIN_MAX_BUCKETS} (got ${String(raw)})`,
      );
    }
    this.maxBuckets = raw;
  }

  /**
   * Compute the content-addressed key for a piece of text, consistent with
   * {@link ./store.js} `CompressionStore#keyFor`. The index keys results by
   * their original input text (falling back to the compressed text) so the key
   * space is identical to the store's.
   *
   * @param text - The original (or compressed) text.
   * @returns The index key.
   */
  keyFor(text: string): string {
    return hashContent(text);
  }

  /**
   * Resolve the content key for a stored result: its `originalText` when
   * present, otherwise its compressed `text`.
   *
   * @param result - The result to key.
   * @returns The content key.
   */
  keyForResult(result: CompressionResult): string {
    return this.keyFor(result.originalText ?? result.text);
  }

  /**
   * Insert a result into every view. Idempotent: indexing the same result
   * twice replaces its previous slots rather than duplicating it.
   *
   * @param result - The result to index.
   * @returns The key the result was indexed under.
   */
  indexResult(result: CompressionResult): string {
    if (!isCompressionResult(result)) {
      throw new TypeError('CompressionIndex#indexResult: result failed structural validation');
    }
    const key = this.keyForResult(result);

    this.removeKeyFromViews(key);

    this.entries.set(key, Object.freeze({ ...result }));
    for (const technique of result.techniques) {
      if (isCompressionTechnique(technique)) this.addToTechnique(technique, key);
    }
    this.addToBucket(savingsBucketFor(result.savedTokens), key);
    this.counters.indexed += 1;
    return key;
  }

  /**
   * Remove a result from the index by its content-addressed key. Mirrors
   * {@link ./store.js} `CompressionStore#delete`.
   *
   * @param key - Key of the result to remove.
   * @returns `true` when a result was actually removed.
   */
  removeResult(key: string): boolean {
    const removed = this.entries.delete(key);
    if (removed) {
      this.removeKeyFromViews(key);
      this.counters.removed += 1;
    }
    return removed;
  }

  /**
   * Remove every result that applied a given technique. Useful when a
   * technique is being retired or its tuning changed.
   *
   * @param technique - The technique to purge.
   * @returns The number of results removed.
   */
  removeForTechnique(technique: CompressionTechnique): number {
    const keys = this.byTechnique.get(technique);
    if (!keys) return 0;
    let removed = 0;
    for (const key of [...keys]) {
      if (this.entries.delete(key)) removed += 1;
    }
    this.removeKeyFromViewsByTechnique(technique);
    this.byTechnique.delete(technique);
    this.counters.removed += removed;
    return removed;
  }

  /**
   * Look up a single result by key.
   *
   * @param key - Content-addressed key.
   * @returns The indexed result, or `undefined`.
   */
  get(key: string): CompressionResult | undefined {
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
   * Number of indexed results.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * All results that applied a given technique, in insertion order.
   *
   * @param technique - The technique to match.
   * @returns Matching results (empty array when none).
   */
  findByTechnique(technique: CompressionTechnique): CompressionResult[] {
    const keys = this.byTechnique.get(technique);
    if (!keys) return [];
    const out: CompressionResult[] = [];
    for (const key of keys) {
      const result = this.entries.get(key);
      if (result) out.push(result);
    }
    return out;
  }

  /**
   * All results whose `savedTokens` falls within `[minSaved, maxSaved]` (both
   * inclusive). Backed by the savings-bucket index: only buckets that overlap
   * the requested range are scanned.
   *
   * @param minSaved - Inclusive lower bound (clamped to >= 0).
   * @param maxSaved - Inclusive upper bound (clamped to >= `minSaved`).
   * @returns Matching results, deduplicated, in insertion order.
   */
  findBySavingsRange(minSaved: number, maxSaved: number): CompressionResult[] {
    const low = Number.isFinite(minSaved) && minSaved >= 0 ? Math.floor(minSaved) : 0;
    const high = Number.isFinite(maxSaved) && maxSaved >= low ? Math.floor(maxSaved) : low;
    const firstBucket = savingsBucketFor(low);
    const lastBucket = savingsBucketFor(high);
    const seen = new Set<string>();
    const out: CompressionResult[] = [];
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const keys = this.bySavingsBucket.get(bucket);
      if (!keys) continue;
      for (const key of keys) {
        if (seen.has(key)) continue;
        const result = this.entries.get(key);
        if (!result) continue;
        if (result.savedTokens >= low && result.savedTokens <= high) {
          seen.add(key);
          out.push(result);
        }
      }
    }
    return out;
  }

  /**
   * All results resident in a single savings bucket.
   *
   * @param bucketIndex - Zero-based bucket index (see {@link savingsBucketFor}).
   * @returns Matching results (empty array when none).
   */
  findBySavingsBucket(bucketIndex: number): CompressionResult[] {
    const keys = this.bySavingsBucket.get(bucketIndex);
    if (!keys) return [];
    const out: CompressionResult[] = [];
    for (const key of keys) {
      const result = this.entries.get(key);
      if (result) out.push(result);
    }
    return out;
  }

  /**
   * The top-N results by token savings. Handy for "what is compressible
   * here?" reports. Uses a bounded scan rather than a full sort so it stays
   * cheap on large indexes.
   *
   * @param limit - Maximum number of results to return (clamped to >= 0).
   * @returns Up to `limit` results, sorted by `savedTokens` descending.
   */
  topSavings(limit: number): CompressionResult[] {
    const n = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 0;
    if (n === 0) return [];
    const results = [...this.entries.values()];
    results.sort((a, b) => b.savedTokens - a.savedTokens);
    return results.slice(0, n);
  }

  /**
   * Count indexed results for a technique without materializing them.
   *
   * @param technique - The technique to count.
   * @returns The number of results that applied it (0 when none).
   */
  countByTechnique(technique: CompressionTechnique): number {
    return this.byTechnique.get(technique)?.size ?? 0;
  }

  /**
   * Count indexed results per savings bucket. Returns a map of bucket index →
   * count; the bucket index can be rendered with {@link bucketLabel}.
   */
  countsByBucket(): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const [bucket, keys] of this.bySavingsBucket) {
      counts.set(bucket, keys.size);
    }
    return counts;
  }

  /**
   * List the techniques currently present in the index, in {@link TECHNIQUES}
   * application order (techniques with no entries are omitted).
   */
  techniques(): CompressionTechnique[] {
    const out: CompressionTechnique[] = [];
    for (const technique of ['collapse-whitespace', 'dedupe-blocks', 'trim-stopwords', 'abbreviate', 'truncate'] as const) {
      if (this.byTechnique.has(technique)) out.push(technique);
    }
    return out;
  }

  /**
   * List the savings buckets currently present, sorted ascending, as labels
   * rendered by {@link bucketLabel}.
   */
  savingsBuckets(): string[] {
    return [...this.bySavingsBucket.keys()].sort((a, b) => a - b).map(bucketLabel);
  }

  /**
   * Rebuild the index from scratch using the provided results. This is the
   * recommended way to initialize the index from a persisted snapshot or from
   * the contents of a {@link ./store.js} `CompressionStore`.
   *
   * @param source - Iterable of results to index.
   * @returns The number of results indexed.
   */
  rebuild(source: Iterable<CompressionResult>): number {
    this.entries.clear();
    this.byTechnique.clear();
    this.bySavingsBucket.clear();
    this.bucketOrder.length = 0;
    this.counters.rebuilds += 1;
    let count = 0;
    for (const result of source) {
      if (!isCompressionResult(result)) continue;
      const key = this.keyForResult(result);
      this.entries.set(key, Object.freeze({ ...result }));
      for (const technique of result.techniques) {
        if (isCompressionTechnique(technique)) this.addToTechnique(technique, key);
      }
      this.addToBucket(savingsBucketFor(result.savedTokens), key);
      count += 1;
    }
    this.counters.indexed += count;
    return count;
  }

  /**
   * Remove every result and reset all views. Lifetime counters (`indexed`,
   * `removed`) are preserved so callers can compute aggregate throughput.
   */
  clear(): void {
    this.entries.clear();
    this.byTechnique.clear();
    this.bySavingsBucket.clear();
    this.bucketOrder.length = 0;
    this.counters.clears += 1;
  }

  /**
   * Aggregate statistics about the index. See {@link IndexStats}.
   *
   * @returns A fresh stats snapshot.
   */
  stats(): IndexStats {
    const byTechnique: Record<string, number> = {};
    for (const [technique, keys] of this.byTechnique) byTechnique[technique] = keys.size;
    const bySavingsBucket: Record<string, number> = {};
    for (const [bucket, keys] of this.bySavingsBucket) {
      bySavingsBucket[bucketLabel(bucket)] = keys.size;
    }
    return {
      entries: this.entries.size,
      techniques: this.byTechnique.size,
      buckets: this.bySavingsBucket.size,
      byTechnique,
      bySavingsBucket,
    };
  }

  /**
   * Serialize the index to a JSON-friendly shape. The flat result list is the
   * source of truth; the two views are reconstructed on deserialize via
   * {@link rebuild}.
   *
   * @returns A serializable snapshot.
   */
  toJSON(): {
    version: 1;
    results: readonly CompressionResult[];
    indexed: number;
  } {
    return {
      version: 1,
      results: [...this.entries.values()],
      indexed: this.counters.indexed,
    };
  }

  /**
   * Restore the index from a snapshot produced by {@link toJSON}.
   *
   * @param snapshot - Snapshot to restore from.
   * @returns The number of results restored.
   */
  fromJSON(snapshot: {
    version: 1;
    results: readonly CompressionResult[];
  }): number {
    if (!snapshot || snapshot.version !== 1) {
      throw new TypeError('CompressionIndex#fromJSON: unsupported snapshot version');
    }
    return this.rebuild(snapshot.results);
  }

  /**
   * Add a key to the by-technique view, creating the set if needed.
   */
  private addToTechnique(technique: CompressionTechnique, key: string): void {
    let set = this.byTechnique.get(technique);
    if (!set) {
      set = new Set();
      this.byTechnique.set(technique, set);
    }
    set.add(key);
  }

  /**
   * Add a key to the by-bucket view, enforcing the bucket cap by evicting the
   * oldest bucket when the limit is exceeded.
   */
  private addToBucket(bucket: number, key: string): void {
    let set = this.bySavingsBucket.get(bucket);
    if (!set) {
      set = new Set();
      this.bySavingsBucket.set(bucket, set);
      this.bucketOrder.push(bucket);
      this.evictOldestBucketIfNeeded();
    }
    set.add(key);
  }

  /**
   * Remove a key from both views. The flat `entries` map is NOT touched —
   * callers decide whether the key stays addressable.
   */
  private removeKeyFromViews(key: string): void {
    for (const set of this.byTechnique.values()) set.delete(key);
    for (const set of this.bySavingsBucket.values()) set.delete(key);
  }

  /**
   * Remove every key of a technique from the bucket view (the by-technique set
   * itself is dropped by the caller).
   */
  private removeKeyFromViewsByTechnique(technique: CompressionTechnique): void {
    const keys = this.byTechnique.get(technique);
    if (!keys) return;
    for (const key of keys) {
      for (const set of this.bySavingsBucket.values()) set.delete(key);
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
      this.bySavingsBucket.delete(oldest);
    }
  }

  /**
   * Collapse the technique / bucket views down to a compact pair of
   * histograms. Provided as a typed convenience for the two view types
   * declared above; simply delegates to {@link stats}.
   */
  histograms(): {
    technique: TechniqueIndexStats;
    savingsBucket: SavingsBucketIndexStats;
  } {
    const snapshot = this.stats();
    return {
      technique: { total: snapshot.techniques, counts: snapshot.byTechnique },
      savingsBucket: { total: snapshot.buckets, counts: snapshot.bySavingsBucket },
    };
  }
}

/**
 * Convenience helper: derive every savings-bucket index that intersects the
 * given inclusive range. Exported for callers that want to reason about bucket
 * coverage without consulting a live index.
 *
 * @param minSaved - Inclusive lower bound.
 * @param maxSaved - Inclusive upper bound.
 * @returns The sorted list of bucket indices covering `[minSaved, maxSaved]`.
 */
export function bucketsCoveringRange(minSaved: number, maxSaved: number): number[] {
  const low = Number.isFinite(minSaved) && minSaved >= 0 ? Math.floor(minSaved) : 0;
  const high = Number.isFinite(maxSaved) && maxSaved >= low ? Math.floor(maxSaved) : low;
  const out: number[] = [];
  for (let bucket = savingsBucketFor(low); bucket <= savingsBucketFor(high); bucket += 1) {
    out.push(bucket);
  }
  return out;
}

/**
 * Re-export of the savings-bucket width so consumers of the index can rely on
 * the same constant when rendering bucket histograms.
 */
export const INDEX_BUCKET_SIZE: number = SAVINGS_BUCKET_SIZE;