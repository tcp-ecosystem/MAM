/**
 * Compression-ratio / technique index for the **Compression** layer of the
 * standalone MAM Context Engine.
 *
 * {@link CompressionIndex} answers the read-side questions the rest of the
 * layer keeps asking: *"which cached results were compressed with the
 * `'dedupe'` technique?"*, *"show me everything with a ratio above 0.5"*,
 * *"what's in the `'extreme'` bucket?"*. Rather than scanning every
 * {@link CompressionResult} on each query, it maintains a set of secondary
 * indexes — one bucket per {@link RatioBucket} and one set per
 * {@link CompressionTechnique}, plus a keyed primary index — and keeps them
 * consistent through explicit {@link CompressionIndex.indexResult} /
 * {@link CompressionIndex.removeResult} calls or a wholesale
 * {@link CompressionIndex.rebuild}.
 *
 * Responsibilities:
 *
 * - **Index** — {@link CompressionIndex.indexResult} inserts or updates a
 *   result and moves it to the correct technique and ratio buckets;
 *   {@link CompressionIndex.removeResult} evicts it from every index.
 * - **Query** — {@link CompressionIndex.findByTechnique} resolves results by
 *   technique; {@link CompressionIndex.findByRatioRange} resolves results whose
 *   ratio falls inside `[min, max]`; {@link CompressionIndex.findByBucket}
 *   resolves a single {@link RatioBucket}; {@link CompressionIndex.get} /
 *   {@link CompressionIndex.has} look up by key.
 * - **Rebuild** — {@link CompressionIndex.rebuild} drops and re-populates the
 *   whole index from an arbitrary iterable of `[key, result]` pairs, which is
 *   how a {@link CompressionStore} snapshot gets mirrored into the index
 *   cheaply.
 * - **Reset** — {@link CompressionIndex.clear} empties every index at once.
 * - **Inspect** — {@link CompressionIndex.stats} exposes the shape and health
 *   of the index (per-technique and per-bucket counts, min/max/average ratio).
 *
 * The index is deliberately **decoupled from {@link CompressionStore}**: it
 * indexes plain key→{@link CompressionResult} pairs, so it can mirror the
 * store's live cache, index results from a serialised snapshot, or even index
 * a hypothetical "what-if" result set without touching the store at all.
 *
 * @module compression/index
 */

import {
  isCompressionResult,
  ratioBucket,
} from './types.js';
import type {
  CompressionResult,
  CompressionTechnique,
  RatioBucket,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link CompressionIndex}.
 */
export interface CompressionIndexOptions {
  /**
   * Boundaries between the {@link RatioBucket} bands. Defaults to
   * {@link DEFAULT_RATIO_EDGES} (`[0.3, 0.6, 0.85]`). Only affects bucketing,
   * never the ratio arithmetic itself.
   */
  readonly ratioEdges?: readonly number[];

  /**
   * Clock used for all timestamps. Injecting a clock makes the index
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Shape of the {@link CompressionIndex.stats} report.
 */
export interface CompressionIndexStats {
  /**
   * Total number of results indexed.
   */
  readonly size: number;

  /**
   * Count of indexed results per {@link CompressionTechnique}.
   */
  readonly byTechnique: Readonly<Record<CompressionTechnique, number>>;

  /**
   * Count of indexed results per {@link RatioBucket}.
   */
  readonly byBucket: Readonly<Record<RatioBucket, number>>;

  /**
   * Highest ratio among indexed results (`0` when the index is empty).
   */
  readonly maxRatio: number;

  /**
   * Lowest ratio among indexed results (`0` when the index is empty).
   */
  readonly minRatio: number;

  /**
   * Mean ratio among indexed results (`0` when the index is empty).
   */
  readonly averageRatio: number;

  /**
   * Epoch-millisecond time of the most recent index change.
   */
  readonly updatedAt: Timestamp;
}

/**
 * The key/technique/ratio index.
 *
 * See the module documentation for the full responsibility list. Every query
 * method returns *copies* of the indexed results (or arrays of copies) so
 * callers cannot mutate the index's internal state through the values they
 * receive.
 *
 * @example
 * ```ts
 * const index = new CompressionIndex();
 * index.indexResult('doc-a', someResult);
 * index.findByTechnique('dedupe');           // dedupe-compressed results
 * index.findByRatioRange(0.5, 1);            // aggressive compressions
 * index.stats().byBucket.extreme;            // how many lost > 85%?
 * ```
 */
export class CompressionIndex {
  /**
   * Key→result primary index.
   */
  private readonly byKey: Map<string, CompressionResult> = new Map();

  /**
   * Technique→key-set secondary index.
   */
  private readonly byTechnique: Map<CompressionTechnique, Set<string>> = new Map();

  /**
   * Ratio-bucket→key-set secondary index.
   */
  private readonly byBucket: Map<RatioBucket, Set<string>> = new Map();

  /**
   * Boundaries between the {@link RatioBucket} bands.
   */
  private readonly ratioEdges: readonly number[];

  /**
   * Epoch-millisecond time of the most recent index change.
   */
  private updatedAt: Timestamp;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * Construct a new index.
   *
   * @param options - optional bucket-edge and clock overrides
   */
  constructor(options: CompressionIndexOptions = {}) {
    this.ratioEdges = options.ratioEdges ?? [0.3, 0.6, 0.85];
    this.now = options.now ?? (() => Date.now());
    this.updatedAt = this.now();
    this.primeBuckets();
  }

  /**
   * Initialise every technique and bucket set to empty.
   */
  private primeBuckets(): void {
    const techniques: CompressionTechnique[] = [
      'none',
      'truncate',
      'collapse',
      'dedupe',
      'strip-markdown',
      'keywords',
      'tiered',
    ];
    const buckets: RatioBucket[] = ['none', 'low', 'medium', 'high', 'extreme'];
    for (const technique of techniques) {
      this.byTechnique.set(technique, new Set());
    }
    for (const bucket of buckets) {
      this.byBucket.set(bucket, new Set());
    }
  }

  /**
   * Move a key into a single technique set, removing it from any others.
   *
   * @param key - the key to re-bucket
   * @param technique - the target technique set
   */
  private rebucketTechnique(key: string, technique: CompressionTechnique): void {
    for (const set of this.byTechnique.values()) {
      set.delete(key);
    }
    this.byTechnique.get(technique)!.add(key);
  }

  /**
   * Move a key into a single ratio-bucket set, removing it from any others.
   *
   * @param key - the key to re-bucket
   * @param bucket - the target ratio-bucket set
   */
  private rebucketRatio(key: string, bucket: RatioBucket): void {
    for (const set of this.byBucket.values()) {
      set.delete(key);
    }
    this.byBucket.get(bucket)!.add(key);
  }

  /**
   * Insert or update a result in the index.
   *
   * Replaces any existing entry for the same key, re-buckets it by its
   * technique and its {@link RatioBucket} (derived with {@link ratioBucket}
   * under this index's edges), and returns the result this index now stores.
   * Values are validated structurally via {@link isCompressionResult};
   * malformed inputs are ignored and `false` is returned.
   *
   * @param key - the cache key to index
   * @param result - the result to index
   * @returns `true` when the result was accepted and indexed
   */
  indexResult(key: string, result: CompressionResult): boolean {
    if (!isCompressionResult(result)) {
      return false;
    }
    const normalized: CompressionResult = { ...result };
    this.byKey.set(key, normalized);
    this.rebucketTechnique(key, normalized.technique);
    this.rebucketRatio(key, ratioBucket(normalized.ratio, this.ratioEdges));
    this.updatedAt = this.now();
    return true;
  }

  /**
   * Remove a result from every index.
   *
   * @param key - the key to remove
   * @returns `true` when the key was indexed and removed
   */
  removeResult(key: string): boolean {
    const removed = this.byKey.delete(key);
    if (removed) {
      for (const set of this.byTechnique.values()) {
        set.delete(key);
      }
      for (const set of this.byBucket.values()) {
        set.delete(key);
      }
      this.updatedAt = this.now();
    }
    return removed;
  }

  /**
   * Resolve a key's indexed result.
   *
   * @param key - the key to look up
   * @returns a copy of the indexed result, or `undefined` when not indexed
   */
  get(key: string): CompressionResult | undefined {
    const result = this.byKey.get(key);
    return result ? { ...result } : undefined;
  }

  /**
   * Test whether a key is currently indexed.
   *
   * @param key - the key to test
   * @returns `true` when the key has an indexed result
   */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * The keys of every indexed result, in insertion order.
   *
   * @returns a fresh array of keys
   */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  /**
   * Every indexed result, in insertion order.
   *
   * @returns a fresh array of result copies
   */
  values(): CompressionResult[] {
    return [...this.byKey.values()].map((result) => ({ ...result }));
  }

  /**
   * Every indexed `[key, result]` pair, in insertion order.
   *
   * @returns a fresh array of entries (results as copies)
   */
  entries(): Array<[string, CompressionResult]> {
    return [...this.byKey.entries()].map(([key, result]) => [
      key,
      { ...result },
    ]);
  }

  /**
   * Every indexed result produced with a given technique.
   *
   * @param technique - the technique to filter by
   * @returns a fresh array of result copies in insertion order
   */
  findByTechnique(technique: CompressionTechnique): CompressionResult[] {
    const keys = this.byTechnique.get(technique) ?? new Set<string>();
    return this.resolve(keys);
  }

  /**
   * Every indexed result whose ratio falls inside `[min, max]` (inclusive).
   *
   * Both bounds are clamped to `[0, 1]`; when `min > max` the call returns an
   * empty array rather than throwing. This is the headline "how aggressively
   * was this compressed?" query.
   *
   * @param min - lower ratio bound (inclusive, clamped to `[0, 1]`)
   * @param max - upper ratio bound (inclusive, clamped to `[0, 1]`)
   * @returns a fresh array of result copies matching the range
   */
  findByRatioRange(min: number, max: number): CompressionResult[] {
    const lo = Math.min(1, Math.max(0, min));
    const hi = Math.min(1, Math.max(0, max));
    if (lo > hi) {
      return [];
    }
    const out: CompressionResult[] = [];
    for (const result of this.byKey.values()) {
      if (result.ratio >= lo && result.ratio <= hi) {
        out.push({ ...result });
      }
    }
    return out;
  }

  /**
   * Every indexed result currently in a given ratio bucket.
   *
   * @param bucket - the bucket to filter by
   * @returns a fresh array of result copies in insertion order
   */
  findByBucket(bucket: RatioBucket): CompressionResult[] {
    const keys = this.byBucket.get(bucket) ?? new Set<string>();
    return this.resolve(keys);
  }

  /**
   * The number of results currently indexed.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Rebuild the entire index from an iterable of `[key, result]` pairs.
   *
   * Atomically clears every existing index and repopulates it from `entries`.
   * Useful for mirroring a {@link CompressionStore} snapshot, re-indexing after
   * a restore, or indexing a freshly-loaded serialised cache. Invalid results
   * in the source are silently skipped.
   *
   * @param entries - the entries to index
   * @returns the number of results actually indexed
   */
  rebuild(entries: Iterable<readonly [string, CompressionResult]>): number {
    this.clear();
    let indexed = 0;
    for (const [key, result] of entries) {
      if (this.indexResult(key, result)) {
        indexed += 1;
      }
    }
    return indexed;
  }

  /**
   * Empty every index.
   */
  clear(): void {
    this.byKey.clear();
    for (const set of this.byTechnique.values()) {
      set.clear();
    }
    for (const set of this.byBucket.values()) {
      set.clear();
    }
    this.updatedAt = this.now();
  }

  /**
   * Snapshot the shape and health of the index.
   *
   * @returns a {@link CompressionIndexStats} report
   */
  stats(): CompressionIndexStats {
    const byTechnique = {} as Record<CompressionTechnique, number>;
    const byBucket = {} as Record<RatioBucket, number>;
    let maxRatio = 0;
    let minRatio = 0;
    let totalRatio = 0;
    for (const [technique, set] of this.byTechnique) {
      byTechnique[technique] = set.size;
    }
    for (const [bucket, set] of this.byBucket) {
      byBucket[bucket] = set.size;
    }
    let count = 0;
    for (const result of this.byKey.values()) {
      const ratio = result.ratio;
      if (count === 0) {
        minRatio = ratio;
        maxRatio = ratio;
      } else {
        minRatio = Math.min(minRatio, ratio);
        maxRatio = Math.max(maxRatio, ratio);
      }
      totalRatio += ratio;
      count += 1;
    }
    return {
      size: this.byKey.size,
      byTechnique,
      byBucket,
      maxRatio: count > 0 ? maxRatio : 0,
      minRatio: count > 0 ? minRatio : 0,
      averageRatio: count > 0 ? totalRatio / count : 0,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Iterate over every indexed `[key, result]` pair.
   */
  *[Symbol.iterator](): IterableIterator<[string, CompressionResult]> {
    for (const [key, result] of this.byKey) {
      yield [key, { ...result }];
    }
  }

  /**
   * Resolve a set of keys into result copies, preserving set iteration order.
   *
   * @param keys - the keys to resolve
   * @returns a fresh array of result copies
   */
  private resolve(keys: Set<string>): CompressionResult[] {
    const out: CompressionResult[] = [];
    for (const key of keys) {
      const result = this.byKey.get(key);
      if (result) {
        out.push({ ...result });
      }
    }
    return out;
  }

  /**
   * Build an index pre-populated from an iterable of `[key, result]` pairs.
   *
   * @param entries - the entries to index
   * @param options - optional bucket-edge and clock overrides
   * @returns a populated {@link CompressionIndex}
   */
  static from(
    entries: Iterable<readonly [string, CompressionResult]>,
    options: CompressionIndexOptions = {},
  ): CompressionIndex {
    const index = new CompressionIndex(options);
    index.rebuild(entries);
    return index;
  }
}