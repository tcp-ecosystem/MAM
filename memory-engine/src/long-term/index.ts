/**
 * @fileOverview Multi-dimensional index over long-term entries.
 *
 * {@link LongTermIndex} answers the semantic queries that would otherwise
 * require an O(n) scan of the store: which entries carry a tag, which are
 * important enough, which were created inside a date range, and which came
 * from a particular source.
 *
 * It maintains four inverted indexes plus one ordered index:
 *
 *   - `tagIndex`        – tag -> set of entry ids (AND/OR queries supported)
 *   - `importanceIndex` – importance bucket -> set of entry ids
 *   - `sourceIndex`     – source string -> set of entry ids
 *   - `dateIndex`       – UTC day bucket -> set of entry ids
 *   - `dateOrder`       – ids sorted by createdAt (binary-search range scans)
 *
 * The index stores references to the entry objects it was given (it is a
 * *view*, not a copy), so it stays cheap and always reflects the latest
 * mutation as long as the owning store routes every write through
 * {@link LongTermIndex.indexEntry}.  For stores that mutate out-of-band, a
 * full {@link LongTermIndex.rebuild} is available.
 */

import {
  LongTermEntry,
  dateBucketKey,
  filterArchived,
  normalizeImportance,
  normalizeTags,
  sortByImportance,
  sortByNewest,
  IMPORTANCE_BUCKETS,
} from './types.js';

/** Query filters accepted by the index lookup methods. */
export interface IndexQueryOptions {
  /** Exclude archived entries unless explicitly set to `true`. */
  includeArchived?: boolean;
  /** Maximum number of results to return. */
  limit?: number;
  /** Skip the first N matches before returning results. */
  offset?: number;
}

/** Structural statistics about the index itself. */
export interface LongTermIndexStats {
  /** Number of entries registered in the index. */
  entries: number;
  /** Number of distinct tags indexed. */
  tags: number;
  /** Number of distinct sources indexed. */
  sources: number;
  /** Number of distinct UTC day buckets indexed. */
  dateBuckets: number;
  /** Total ids stored inside the tag index (sum over tags). */
  tagReferences: number;
  /** Total ids stored inside the source index (sum over sources). */
  sourceReferences: number;
}

/**
 * A tiny sorted insertion point descriptor returned by the internal binary
 * search so we can decide where to splice without re-searching.
 */
interface InsertionPoint {
  /** Index at which `timestamp` would be inserted to keep the array sorted. */
  position: number;
  /** Whether an element with an equal timestamp already exists at `position`. */
  found: boolean;
}

/**
 * Inverted + ordered index over {@link LongTermEntry} records.
 *
 * @example
 * ```ts
 * const index = new LongTermIndex();
 * index.indexEntry(entry);
 * index.findByTags(['project', 'active']);   // AND semantics
 * index.findByImportance(0.7);
 * index.findByDateRange(startMs, endMs);
 * ```
 */
export class LongTermIndex {
  /** Registered entries by id (source of truth for the view). */
  private entries = new Map<string, LongTermEntry>();
  /** tag -> set of entry ids. */
  private tagIndex = new Map<string, Set<string>>();
  /** importance bucket (0..99) -> set of entry ids. */
  private importanceIndex = new Map<number, Set<string>>();
  /** source string -> set of entry ids. */
  private sourceIndex = new Map<string, Set<string>>();
  /** UTC day bucket -> set of entry ids. */
  private dateIndex = new Map<string, Set<string>>();
  /** Entry ids ordered by `createdAt` ascending, for range scans. */
  private dateOrder: string[] = [];
  /** createdAt lookup cache so the binary search does not touch the entry. */
  private createdByOrder = new Map<string, number>();

  /* ------------------------------------------------------------------ *
   * Registration
   * ------------------------------------------------------------------ */

  /**
   * Registers (or re-registers) a single entry in every index.  When the id is
   * already known, the old index references are removed first so no stale tags
   * or timestamps survive.
   *
   * @returns `this` for chaining.
   */
  indexEntry(entry: LongTermEntry): this {
    if (this.entries.has(entry.id)) {
      this.removeEntry(entry.id);
    }
    this.entries.set(entry.id, entry);
    this.rememberInOrder(entry);
    for (const tag of normalizeTags(entry.tags)) {
      this.addToSet(this.tagIndex, tag, entry.id);
    }
    if (entry.importance !== undefined) {
      const bucket = this.importanceBucket(normalizeImportance(entry.importance));
      this.addToSet(this.importanceIndex, bucket, entry.id);
    }
    if (entry.source) {
      this.addToSet(this.sourceIndex, entry.source, entry.id);
    }
    this.addToSet(this.dateIndex, dateBucketKey(entry.createdAt), entry.id);
    return this;
  }

  /**
   * Removes an entry from every index.
   *
   * @returns `true` when an entry with that id was present and removed.
   */
  removeEntry(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(id);
    this.dropFromOrder(id);
    for (const tag of normalizeTags(entry.tags)) {
      this.removeFromSet(this.tagIndex, tag, id);
    }
    if (entry.importance !== undefined) {
      const bucket = this.importanceBucket(normalizeImportance(entry.importance));
      this.removeFromSet(this.importanceIndex, bucket, id);
    }
    if (entry.source) {
      this.removeFromSet(this.sourceIndex, entry.source, id);
    }
    this.removeFromSet(this.dateIndex, dateBucketKey(entry.createdAt), id);
    return true;
  }

  /**
   * Rebuilds every index from scratch over the supplied entries.  Any prior
   * state is discarded first.  Useful after a bulk `load()` or `clear()` on
   * the backing store.
   *
   * @returns the number of entries indexed.
   */
  rebuild(entries: Iterable<LongTermEntry>): number {
    this.clear();
    let count = 0;
    for (const entry of entries) {
      this.indexEntry(entry);
      count += 1;
    }
    return count;
  }

  /**
   * Removes all entries from every index.
   *
   * @returns the number of entries that were indexed before clearing.
   */
  clear(): number {
    const removed = this.entries.size;
    this.entries.clear();
    this.tagIndex.clear();
    this.importanceIndex.clear();
    this.sourceIndex.clear();
    this.dateIndex.clear();
    this.dateOrder = [];
    this.createdByOrder.clear();
    return removed;
  }

  /* ------------------------------------------------------------------ *
   * Lookups
   * ------------------------------------------------------------------ */

  /** Returns `true` when an entry with `id` is currently indexed. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Returns the registered entry reference for `id`, or `undefined`. */
  get(id: string): LongTermEntry | undefined {
    return this.entries.get(id);
  }

  /** Returns the number of registered entries. */
  size(): number {
    return this.entries.size;
  }

  /** Returns references to every registered entry (unsorted). */
  all(): LongTermEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Returns entries that carry **all** of the requested tags (AND).  Pass a
   * single tag for a plain membership query.
   */
  findByTags(
    tags: string | string[],
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    const wanted = normalizeTags(tags);
    if (wanted.length === 0) {
      return [];
    }
    let ids: Set<string> | null = null;
    for (const tag of wanted) {
      const bucket = this.tagIndex.get(tag);
      if (bucket === undefined || bucket.size === 0) {
        return [];
      }
      ids = ids === null ? new Set(bucket) : intersect(ids, bucket);
      if (ids.size === 0) {
        return [];
      }
    }
    return this.paginate(ids, options);
  }

  /**
   * Returns entries carrying **at least one** of the requested tags (OR).
   * Results are de-duplicated and sorted newest-first.
   */
  findByAnyTag(
    tags: string | string[],
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    const wanted = normalizeTags(tags);
    const ids = new Set<string>();
    for (const tag of wanted) {
      const bucket = this.tagIndex.get(tag);
      if (bucket) {
        for (const id of bucket) {
          ids.add(id);
        }
      }
    }
    return this.paginate(ids, options);
  }

  /**
   * Returns entries whose normalised importance is at least `min`.  When `min`
   * is omitted, every entry with a recorded importance score is returned.
   */
  findByImportance(
    min?: number,
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    const threshold = min === undefined ? 0 : normalizeImportance(min);
    const fromBucket = this.importanceBucket(threshold);
    const ids = new Set<string>();
    for (let bucket = fromBucket; bucket < IMPORTANCE_BUCKETS; bucket += 1) {
      const set = this.importanceIndex.get(bucket);
      if (set) {
        for (const id of set) {
          ids.add(id);
        }
      }
    }
    const results = this.paginate(ids, options);
    return sortByImportance(results);
  }

  /**
   * Returns entries whose `createdAt` falls inside the inclusive
   * `[from, to]` millisecond range.  Uses the ordered `dateOrder` index with a
   * binary search, so it stays fast even for large stores.
   */
  findByDateRange(from: number, to: number): LongTermEntry[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return [];
    }
    const start = this.lowerBound(from);
    const end = this.upperBound(to);
    const results: LongTermEntry[] = [];
    for (let i = start; i < end; i += 1) {
      const id = this.dateOrder[i];
      if (id === undefined) {
        break;
      }
      const entry = this.entries.get(id);
      if (entry !== undefined && entry.archived !== true) {
        results.push(entry);
      }
    }
    return sortByNewest(results);
  }

  /**
   * Returns entries whose `source` string equals `source` exactly.
   */
  findBySource(
    source: string,
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    if (source.length === 0) {
      return [];
    }
    const ids = this.sourceIndex.get(source);
    return this.paginate(ids, options);
  }

  /**
   * Returns all entries matching a tag **or** a source, for coarse filters
   * like "everything related to channel X".
   */
  findByTagOrSource(
    tag: string,
    source: string,
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    const ids = new Set<string>();
    const tagBucket = this.tagIndex.get(normalizeTags(tag)[0] ?? tag);
    if (tagBucket) {
      for (const id of tagBucket) {
        ids.add(id);
      }
    }
    const sourceBucket = this.sourceIndex.get(source);
    if (sourceBucket) {
      for (const id of sourceBucket) {
        ids.add(id);
      }
    }
    return this.paginate(ids, options);
  }

  /* ------------------------------------------------------------------ *
   * Maintenance
   * ------------------------------------------------------------------ */

  /**
   * Re-keys a single entry id after its importance changed.  This is a
   * targeted version of `removeEntry + indexEntry` and is preferred over a
   * full rebuild when the store rescored one entry.
   */
  reindexImportance(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return false;
    }
    for (const [bucket, ids] of this.importanceIndex) {
      ids.delete(id);
      if (ids.size === 0) {
        this.importanceIndex.delete(bucket);
      }
    }
    if (entry.importance !== undefined) {
      const bucket = this.importanceBucket(normalizeImportance(entry.importance));
      this.addToSet(this.importanceIndex, bucket, id);
    }
    return true;
  }

  /**
   * Computes {@link LongTermIndexStats}, a cheap O(number of buckets) pass.
   */
  stats(): LongTermIndexStats {
    let tagReferences = 0;
    for (const ids of this.tagIndex.values()) {
      tagReferences += ids.size;
    }
    let sourceReferences = 0;
    for (const ids of this.sourceIndex.values()) {
      sourceReferences += ids.size;
    }
    return {
      entries: this.entries.size,
      tags: this.tagIndex.size,
      sources: this.sourceIndex.size,
      dateBuckets: this.dateIndex.size,
      tagReferences,
      sourceReferences,
    };
  }

  /* ------------------------------------------------------------------ *
   * Ordered-index internals
   * ------------------------------------------------------------------ */

  /** Maps a normalised importance to its bucket key in `0..99`. */
  private importanceBucket(importance: number): number {
    const scaled = Math.floor(normalizeImportance(importance) * IMPORTANCE_BUCKETS);
    return Math.min(IMPORTANCE_BUCKETS - 1, Math.max(0, scaled));
  }

  /** Adds `id` to the set under `key`, creating the bucket when needed. */
  private addToSet<K>(map: Map<K, Set<string>>, key: K, id: string): void {
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = new Set();
      map.set(key, bucket);
    }
    bucket.add(id);
  }

  /** Removes `id` from the set under `key`, dropping empty buckets. */
  private removeFromSet<K>(map: Map<K, Set<string>>, key: K, id: string): void {
    const bucket = map.get(key);
    if (bucket === undefined) {
      return;
    }
    bucket.delete(id);
    if (bucket.size === 0) {
      map.delete(key);
    }
  }

  /** Binary search for the first index whose createdAt is `>= timestamp`. */
  private lowerBound(timestamp: number): number {
    let lo = 0;
    let hi = this.dateOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const id = this.dateOrder[mid];
      if (id === undefined || (this.createdByOrder.get(id) ?? 0) < timestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Binary search for the first index whose createdAt is `> timestamp`. */
  private upperBound(timestamp: number): number {
    let lo = 0;
    let hi = this.dateOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const id = this.dateOrder[mid];
      if (id === undefined || (this.createdByOrder.get(id) ?? 0) <= timestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Finds the insertion point of `timestamp` within the sorted id array. */
  private findInsertionPoint(timestamp: number): InsertionPoint {
    let lo = 0;
    let hi = this.dateOrder.length;
    let found = false;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const id = this.dateOrder[mid];
      const midTime = this.createdByOrder.get(id ?? '') ?? 0;
      if (midTime < timestamp) {
        lo = mid + 1;
      } else {
        if (midTime === timestamp) {
          found = true;
        }
        hi = mid;
      }
    }
    return { position: lo, found };
  }

  /** Inserts an entry into the ordered date index at the right position. */
  private rememberInOrder(entry: LongTermEntry): void {
    const { position } = this.findInsertionPoint(entry.createdAt);
    this.dateOrder.splice(position, 0, entry.id);
    this.createdByOrder.set(entry.id, entry.createdAt);
  }

  /** Removes an entry id from the ordered date index. */
  private dropFromOrder(id: string): void {
    const timestamp = this.createdByOrder.get(id);
    if (timestamp === undefined) {
      return;
    }
    const { position } = this.findInsertionPoint(timestamp);
    const index = this.dateOrder.indexOf(id, position);
    if (index >= 0) {
      this.dateOrder.splice(index, 1);
    }
    this.createdByOrder.delete(id);
  }

  /** Applies filtering, offset, and limit to a candidate id set. */
  private paginate(
    ids: Set<string> | undefined,
    options?: IndexQueryOptions,
  ): LongTermEntry[] {
    if (ids === undefined || ids.size === 0) {
      return [];
    }
    const includeArchived = options?.includeArchived ?? false;
    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    const results: LongTermEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry === undefined) {
        continue;
      }
      if (entry.archived === true && !includeArchived) {
        continue;
      }
      results.push(entry);
    }
    const sorted = sortByNewest(results);
    return filterArchived(
      limit === undefined ? sorted.slice(offset) : sorted.slice(offset, offset + limit),
      includeArchived,
    );
  }
}

/**
 * Computes the set intersection of two string sets (used for AND tag queries).
 */
function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<string>();
  for (const id of small) {
    if (large.has(id)) {
      out.add(id);
    }
  }
  return out;
}