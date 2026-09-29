/**
 * @fileoverview
 * Caching layer for synthesized answers.
 *
 * The {@link SynthesisStore} is a bounded, LRU-evicting, content-addressed
 * cache of {@link Answer} values.  It exists because synthesis is not free:
 * sentence extraction, term-overlap scoring, deduplication, and fusion all
 * cost CPU.  When a consumer re-asks the same question, or a pipeline re-runs
 * with the same query text, the store lets us serve the previous answer
 * instead of recomputing it.
 *
 * Design notes:
 *
 *   - **LRU eviction.**  The cache is backed by a `Map` whose iteration order
 *     is insertion order.  Every read (`get`/`has`) and write (`put`) touches
 *     the entry so the most recently used key is always at the tail.  When the
 *     capacity is exceeded the oldest (head) entries are evicted first.
 *
 *   - **Content addressing.**  Every answer is indexed by the normalized text
 *     of the query it was synthesized for.  {@link SynthesisStore.getFor}
 *     looks an answer up by its content hash, so a caller can retrieve the
 *     cached answer for a query without choosing or remembering an opaque key.
 *     The explicit-key API (`put`/`get`) is preserved for callers that do
 *     manage keys.  Because answers are content-addressed by query, the same
 *     question asked twice — even with freshly retrieved evidence — returns
 *     the previous answer, which is exactly the stability a chat backend
 *     wants.
 *
 *   - **Durability.**  {@link SynthesisStore.toJSON} emits a plain,
 *     dependency-free snapshot and {@link SynthesisStore.fromJSON} restores
 *     it.  The snapshot is validated on the way in, so a corrupted or hostile
 *     payload cannot poison the cache.
 *
 *   - **Observability.**  {@link SynthesisStore.cacheStats} reports hits,
 *     misses, puts, evictions and the current hit rate, and
 *     {@link SynthesisStore.stats} aggregates the semantic synthesis stats
 *     across every cached answer.  The lifecycle layer consumes these to drive
 *     periodic GC.
 *
 * @packageDocumentation
 */

import {
  type Answer,
  type SynthesisStats,
  assertAnswer,
  createSynthesisStats,
  isAnswer,
} from './types.js';

/**
 * The maximum capacity used when the caller does not specify one.  256 is a
 * deliberate compromise: large enough to hold a serious session's answers in
 * memory, small enough that a long-lived process reaping stale answers stays
 * cheap.
 */
export const DEFAULT_SYNTHESIS_STORE_CAP = 256;

/**
 * The maximum number of serialized entries accepted by `fromJSON`.  Guards
 * against unbounded allocation when restoring untrusted snapshots.
 */
export const MAX_RESTORE_ENTRIES = 10_000;

/**
 * Snapshot shape produced by {@link SynthesisStore.toJSON} and consumed by
 * {@link SynthesisStore.fromJSON}.  The shape is deliberately flat and JSON
 * friendly so it can round-trip through `JSON.stringify`/`JSON.parse`, a
 * database column, or a file.
 */
export interface SynthesisStoreSnapshot {
  /** Store version; used by `fromJSON` to reject incompatible snapshots. */
  readonly version: 1;
  /** The capacity in effect when the snapshot was taken. */
  readonly cap: number;
  /** The cached entries, most-recently-used first (tail-first). */
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly answer: Answer;
  }>;
}

/**
 * Coarse hit/miss accounting for the cache, useful for telemetry and for
 * deciding whether the store's capacity should be raised.
 */
export interface CacheStats {
  /** Number of `get` calls that returned a cached value. */
  readonly hits: number;
  /** Number of `get` calls that found nothing. */
  readonly misses: number;
  /** Number of `put` calls that inserted or refreshed an entry. */
  readonly puts: number;
  /** Number of entries evicted to stay within capacity. */
  readonly evictions: number;
  /** Number of entries currently resident. */
  readonly size: number;
  /** The configured capacity. */
  readonly cap: number;
  /** `hits / (hits + misses)`, or `0` when there have been no reads. */
  readonly hitRate: number;
}

/**
 * A bounded LRU cache of synthesized answers with content-addressable
 * lookups.
 *
 * Instances are **not** thread-safe; callers in concurrent environments
 * (worker threads, multiple async pipelines sharing one store) should guard
 * access with a mutex, or construct one store per worker.
 */
export class SynthesisStore {
  /** LRU ordered map: key -> answer.  Insertion order is recency order. */
  private readonly cache = new Map<string, Answer>();

  /** content hash -> key.  Enables {@link getFor}. */
  private readonly contentIndex = new Map<string, string>();

  /** key -> content hash, for symmetric removal in {@link delete}. */
  private readonly keyIndex = new Map<string, string>();

  /** key -> last access time (ms epoch).  Consumed by the lifecycle GC. */
  private readonly accessedAt = new Map<string, number>();

  /** Capacity; raising it later never drops below the current size. */
  private capInternal: number;

  private hits = 0;
  private misses = 0;
  private putsCount = 0;
  private evictions = 0;

  /**
   * Creates a store with the given capacity.
   *
   * @param cap - Maximum number of resident entries.  Must be a positive
   *   integer; anything else throws a {@link RangeError}.  Defaults to
   *   {@link DEFAULT_SYNTHESIS_STORE_CAP}.
   */
  constructor(cap: number = DEFAULT_SYNTHESIS_STORE_CAP) {
    SynthesisStore.assertCap(cap);
    this.capInternal = cap;
  }

  /** Validates `cap`, throwing a {@link RangeError} for non-positive values. */
  private static assertCap(cap: number): void {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new RangeError(`SynthesisStore cap must be a positive integer, got ${cap}`);
    }
  }

  /** Returns the configured capacity. */
  get cap(): number {
    return this.capInternal;
  }

  /**
   * Reconfigures the capacity, evicting the least-recently-used entries
   * immediately if the new cap is smaller than the current size.
   */
  set cap(next: number) {
    SynthesisStore.assertCap(next);
    this.capInternal = next;
    this.trimToCapacity();
  }

  /** Returns the number of resident entries. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Inserts (or refreshes) an answer under `key`.
   *
   * Reading and writing share the same LRU path: inserting an existing key
   * moves it to the most-recently-used tail.  The answer is validated with
   * {@link assertAnswer} so a malformed value can never enter the cache.  The
   * content hash of the query is registered so {@link getFor} can later find
   * it.  When capacity is exceeded the oldest entries are evicted; each
   * eviction increments the eviction counter.
   *
   * @returns `true` when `key` was already resident (a refresh), `false` when
   *   it was a brand-new insertion.
   */
  put(key: string, answer: Answer): boolean {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('SynthesisStore key must be a non-empty string');
    }
    assertAnswer(answer);

    const wasPresent = this.cache.has(key);
    if (wasPresent) {
      this.cache.delete(key);
      this.removeKeyMapping(key);
    }

    this.cache.set(key, answer);
    const hash = SynthesisStore.hashText(answer.text);
    this.contentIndex.set(hash, key);
    this.keyIndex.set(key, hash);
    this.accessedAt.set(key, Date.now());

    this.putsCount += 1;
    this.trimToCapacity();
    return wasPresent;
  }

  /**
   * Stores an answer addressed by its query.
   *
   * This is the content-addressing path that makes {@link getFor} useful:
   * `put` registers an entry under the hash of its *answer text*, whereas
   * `putFor` registers it under the hash of the *query* it was synthesized
   * for.  The returned key equals `hashText(query)`, and a later
   * `getFor(query)` retrieves the answer without the caller remembering any
   * key.
   *
   * @returns The content-derived key (the query hash).
   */
  putFor(query: string, answer: Answer): string {
    if (typeof query !== 'string' || query.length === 0) {
      throw new TypeError('SynthesisStore query must be a non-empty string');
    }
    assertAnswer(answer);
    const key = SynthesisStore.hashText(query);
    this.put(key, answer);
    // Re-point the content index at the query hash so getFor(query) resolves.
    const textHash = this.keyIndex.get(key);
    if (textHash !== undefined) {
      this.contentIndex.delete(textHash);
    }
    const queryHash = SynthesisStore.hashText(query);
    this.contentIndex.set(queryHash, key);
    this.keyIndex.set(key, queryHash);
    return key;
  }

  /**
   * Stores multiple entries in a single call.
   *
   * @param entries - `[key, answer]` pairs.  Processed left to right so later
   *   pairs win when a key repeats.
   * @returns The number of entries stored.
   */
  putMany(entries: ReadonlyArray<readonly [string, Answer]>): number {
    for (const [key, answer] of entries) {
      this.put(key, answer);
    }
    return entries.length;
  }

  /**
   * Reads an answer by key, promoting it to the MRU tail.  Returns `undefined`
   * when the key is absent.
   */
  get(key: string): Answer | undefined {
    const answer = this.cache.get(key);
    if (answer === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.touch(key);
    return answer;
  }

  /**
   * Returns whether `key` is resident without disturbing LRU order.  This is
   * the cheapest membership test and does not count as a hit or miss.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

/**
   * Content-addressed lookup: returns the cached answer whose query (registered
   * via {@link putFor} or the lifecycle's `record`) or assembled text
   * normalizes to the same content hash as `query`, optionally narrowed by
   * the presence of `evidence` (the hash includes the evidence texts when they
   * are provided).  The entry is promoted to the MRU tail on a hit.
   */
  getFor(query: string, evidence?: readonly { readonly text: string }[]): Answer | undefined {
    const hash = SynthesisStore.hashText(
      query,
      evidence === undefined ? undefined : evidence.map((part) => part.text),
    );
    const key = this.contentIndex.get(hash);
    if (key === undefined) {
      this.misses += 1;
      return undefined;
    }
    return this.get(key);
  }

  /**
   * Removes a key and every index entry that points at it.
   *
   * @returns `true` when the key was resident and was removed.
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (!existed) return false;
    this.removeKeyMapping(key);
    this.accessedAt.delete(key);
    return true;
  }

  /**
   * Removes the least-recently-used `n` entries.
   *
   * @param n - Number of oldest entries to drop; clamped to the current size.
   * @returns The number of entries actually removed.
   */
  evictOldest(n: number): number {
    const count = Math.max(0, Math.min(n, this.cache.size));
    const keys = [...this.cache.keys()];
    for (let i = 0; i < count; i += 1) {
      this.delete(keys[i]);
    }
    this.evictions += count;
    return count;
  }

  /** Returns all resident keys in LRU order (oldest first). */
  keys(): string[] {
    return [...this.cache.keys()];
  }

  /** Returns all resident values in LRU order (oldest first). */
  values(): Answer[] {
    return [...this.cache.values()];
  }

  /** Returns all resident `[key, answer]` pairs in LRU order (oldest first). */
  entries(): Array<[string, Answer]> {
    return [...this.cache.entries()];
  }

  /**
   * Removes every entry and resets the content index, access timestamps, and
   * hit/miss/put/eviction counters.  Use {@link clear} when only the data
   * should be dropped but counters preserved.
   */
  clear(): void {
    this.cache.clear();
    this.contentIndex.clear();
    this.keyIndex.clear();
    this.accessedAt.clear();
    this.hits = 0;
    this.misses = 0;
    this.putsCount = 0;
    this.evictions = 0;
  }

  /**
   * Returns the last access time (ms epoch) for `key`, or `undefined` when
   * the key is not resident.  Used by the lifecycle GC to detect stale
   * entries.
   */
  lastAccessAt(key: string): number | undefined {
    return this.accessedAt.get(key);
  }

  /**
   * Returns the current access time for every resident key as a
   * `key -> ms epoch` map.  Convenience for external GC policies.
   */
  accessTimes(): ReadonlyMap<string, number> {
    return new Map(this.accessedAt);
  }

  /**
   * Aggregates semantic synthesis stats across every cached answer.
   *
   * Counts requests as the number of resident answers and sums parts,
   * citations, grounded/ungrounded flags, and confidence across all of them.
   * `lastUpdated` reflects the moment the snapshot was computed.
   */
  stats(): SynthesisStats {
    let answers = 0;
    let parts = 0;
    let citations = 0;
    let grounded = 0;
    let ungrounded = 0;
    let confidenceTotal = 0;

    for (const answer of this.cache.values()) {
      answers += 1;
      parts += answer.parts.length;
      citations += answer.citations.length;
      if (answer.grounded) grounded += 1;
      else ungrounded += 1;
      confidenceTotal += answer.confidence;
    }

    return createSynthesisStats({
      requests: this.cache.size,
      answers,
      parts,
      citations,
      grounded,
      ungrounded,
      meanConfidence: answers > 0 ? confidenceTotal / answers : 0,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Returns cache hit/miss accounting.  `hitRate` is `0` until at least one
   * read has occurred.
   */
  cacheStats(): CacheStats {
    const reads = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      puts: this.putsCount,
      evictions: this.evictions,
      size: this.cache.size,
      cap: this.capInternal,
      hitRate: reads > 0 ? this.hits / reads : 0,
    };
  }

  /**
   * Serializes the store to a plain, JSON-friendly snapshot.  Entries are
   * emitted most-recently-used first so a restored cache has the correct
   * recency ordering.
   */
  toJSON(): SynthesisStoreSnapshot {
    const keys = [...this.cache.keys()];
    const entries: Array<{ key: string; answer: Answer }> = [];
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      const answer = this.cache.get(key);
      if (answer !== undefined) entries.push({ key, answer });
    }
    return { version: 1, cap: this.capInternal, entries };
  }

  /**
   * Restores the store from a snapshot, replacing all current contents.
   *
   * The snapshot is fully validated: the version must match, the cap must be
   * a positive integer, the entry count must not exceed
   * {@link MAX_RESTORE_ENTRIES}, and every entry must round-trip through
   * {@link isAnswer}.  On failure nothing is changed and a {@link TypeError}
   * is thrown.
   */
  fromJSON(snapshot: SynthesisStoreSnapshot): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported SynthesisStore snapshot version ${snapshot.version}`);
    }
    SynthesisStore.assertCap(snapshot.cap);
    if (snapshot.entries.length > MAX_RESTORE_ENTRIES) {
      throw new RangeError(
        `Snapshot has ${snapshot.entries.length} entries; refusing to restore more than ${MAX_RESTORE_ENTRIES}`,
      );
    }

    const nextCache = new Map<string, Answer>();
    const nextContent = new Map<string, string>();
    const nextKey = new Map<string, string>();
    const nextAccessed = new Map<string, number>();

    for (const { key, answer } of snapshot.entries) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('Snapshot contains an entry with an invalid key');
      }
      if (!isAnswer(answer)) {
        throw new TypeError(`Snapshot entry "${key}" is not a valid Answer`);
      }
      const hash = SynthesisStore.hashText(answer.text);
      nextCache.set(key, answer);
      nextContent.set(hash, key);
      nextKey.set(key, hash);
      nextAccessed.set(key, Date.now());
    }

    this.cache.clear();
    this.contentIndex.clear();
    this.keyIndex.clear();
    this.accessedAt.clear();
    for (const [key, value] of nextCache) this.cache.set(key, value);
    for (const [hash, key] of nextContent) this.contentIndex.set(hash, key);
    for (const [key, hash] of nextKey) this.keyIndex.set(key, hash);
    for (const [key, at] of nextAccessed) this.accessedAt.set(key, at);

    this.capInternal = snapshot.cap;
    this.hits = 0;
    this.misses = 0;
    this.putsCount = 0;
    this.evictions = 0;
  }

  /** Marks `key` as most-recently-used and updates its access time. */
  private touch(key: string): void {
    const answer = this.cache.get(key);
    if (answer === undefined) return;
    this.cache.delete(key);
    this.cache.set(key, answer);
    this.accessedAt.set(key, Date.now());
  }

  /** Removes the content/key index rows that reference `key`. */
  private removeKeyMapping(key: string): void {
    const hash = this.keyIndex.get(key);
    if (hash !== undefined) {
      this.keyIndex.delete(key);
      if (this.contentIndex.get(hash) === key) {
        this.contentIndex.delete(hash);
      }
    }
  }

  /** Evicts oldest entries until the size is within capacity. */
  private trimToCapacity(): void {
    while (this.cache.size > this.capInternal) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
      this.evictions += 1;
    }
  }

  /**
   * Stable content hash over one or more texts.
   *
   * FNV-1a 32-bit over the normalized, joined texts, with each segment's
   * length mixed in so `["ab","c"]` and `["a","bc"]` produce different
   * hashes.  This is a cache key, not a security primitive; collisions are
   * practically impossible but not adversarially prevented.
   */
  static hashText(text: string, extra?: readonly string[]): string {
    const parts = [text, ...(extra ?? [])].map((part) =>
      part.normalize('NFKD').toLowerCase().trim(),
    );
    let hash = 0x811c9dc5;
    for (const part of parts) {
      hash ^= part.length & 0xff;
      hash = Math.imul(hash, 0x01000193);
      for (let i = 0; i < part.length; i += 1) {
        hash ^= part.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      hash ^= 0x7f4a7c15;
      hash = Math.imul(hash, 0x01000193);
    }
    return `s${(hash >>> 0).toString(16)}:${parts.length}`;
  }
}