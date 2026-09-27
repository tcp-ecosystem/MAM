/**
 * Bounded, TTL-aware cache for RAG results and context pieces.
 *
 * The {@link RagStore} is the memory of the RAG layer: it remembers assembled
 * {@link RagContext}s and {@link RagResult}s keyed by normalised query text so
 * repeated queries do not re-run retrieval and assembly, and it remembers
 * individual {@link RagPiece}s by id so provenance lookups stay cheap.
 *
 * The store is deliberately dependency-free and JSON-serialisable: the whole
 * cache can be persisted with {@link RagStore.toJSON} and restored with
 * {@link RagStore.fromJSON}, which makes it suitable for hot-reload, test
 * replay and process hand-off scenarios.
 *
 * Behaviour is governed by a few simple rules:
 *
 * - **TTL expiry** — every entry carries `expiresAt`; reads and sweeps lazily
 *   evict expired entries and count them against the store's `pruned` counter.
 * - **Capacity pressure** — when the entry count exceeds `capacity`, expired
 *   entries are dropped first and then the least-recently-accessed entries are
 *   evicted until the store fits. Evictions are counted separately from prunes.
 * - **Piece indexing** — putting a {@link RagContext} or {@link RagResult}
 *   automatically indexes its pieces by id, and deleting that entry removes the
 *   pieces it owned, so the store never leaks orphaned pieces.
 *
 * @packageDocumentation
 * @module rag/store
 */

import {
  buildCacheKey,
  countTokens,
  isRagContext,
  isRagPiece,
  isRagResult,
  normalizeText,
  type RagContext,
  type RagPiece,
  type RagResult,
  type RagStats,
  type RagStoreValue,
} from './types.js';

/**
 * A single cache entry with its lifecycle bookkeeping.
 *
 * Bookkeeping is kept alongside the value so persistence
 * ({@link RagStore.toJSON}) can round-trip it losslessly.
 */
export interface StoredEntry<V = RagStoreValue> {
  /**
   * The cache key this entry lives under.
   */
  readonly key: string;

  /**
   * The cached value.
   */
  readonly value: V;

  /**
   * Epoch-millisecond time the entry was written.
   */
  readonly createdAt: number;

  /**
   * Epoch-millisecond time after which the entry is considered stale.
   * `Infinity` when the store has no TTL.
   */
  readonly expiresAt: number;

  /**
   * Epoch-millisecond time the entry was last read. Drives LRU eviction.
   */
  lastAccessed: number;

  /**
   * Number of times the entry has been read.
   */
  hits: number;
}

/**
 * Statistics specific to a {@link RagStore}.
 *
 * Extends {@link RagStats} with store-specific capacity and piece counts.
 */
export interface RagStoreStats extends RagStats {
  /**
   * Number of entries currently cached.
   */
  readonly entries: number;

  /**
   * Number of distinct pieces currently indexed by the store.
   */
  readonly pieces: number;

  /**
   * The store's capacity ceiling (entry count).
   */
  readonly capacity: number;

  /**
   * The configured TTL in milliseconds.
   */
  readonly ttlMs: number;

  /**
   * Number of entries that expired and were lazily dropped.
   */
  readonly expired: number;
}

/**
 * Options accepted by the {@link RagStore} constructor and
 * {@link RagStore.fromJSON}.
 */
export interface RagStoreOptions {
  /**
   * Maximum number of cached entries. Defaults to `1000`. `0` disables the
   * cap entirely.
   */
  readonly capacity?: number;

  /**
   * Time-to-live in milliseconds for cached entries. Defaults to `60_000`.
   * `0` disables TTL expiry.
   */
  readonly ttlMs?: number;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps.
   */
  readonly now?: () => number;
}

/**
 * Serialised shape produced by {@link RagStore.toJSON} and consumed by
 * {@link RagStore.fromJSON}.
 */
export interface SerializedRagStore {
  /**
   * Serialisation format version. Guards against future format drift.
   */
  readonly version: number;

  /**
   * The store's capacity at serialisation time.
   */
  readonly capacity: number;

  /**
   * The store's TTL at serialisation time.
   */
  readonly ttlMs: number;

  /**
   * Epoch-millisecond time the store was created.
   */
  readonly createdAt: number;

  /**
   * The cached entries, with their bookkeeping.
   */
  readonly entries: ReadonlyArray<StoredEntry<RagStoreValue>>;
}

/**
 * Version number stamped by {@link RagStore.toJSON}.
 */
export const RAG_STORE_VERSION = 1;

/**
 * Guard for {@link SerializedRagStore} produced by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a valid serialised store
 */
export function isSerializedRagStore(value: unknown): value is SerializedRagStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SerializedRagStore>;
  return (
    record.version === RAG_STORE_VERSION &&
    typeof record.capacity === 'number' &&
    typeof record.ttlMs === 'number' &&
    typeof record.createdAt === 'number' &&
    Array.isArray(record.entries)
  );
}

/**
 * A bounded, TTL-aware cache of RAG values.
 *
 * @example
 * ```ts
 * const store = new RagStore({ capacity: 100, ttlMs: 60_000 });
 * store.put('rag:abc', context);
 * const cached = store.get<RagContext>('rag:abc');
 * const snapshot = store.toJSON();
 * const restored = RagStore.fromJSON(snapshot);
 * ```
 */
export class RagStore {
  private readonly _entries: Map<string, StoredEntry<RagStoreValue>>;
  private readonly _pieces: Map<string, RagPiece>;
  private readonly _pieceOwners: Map<string, Set<string>>;
  private readonly _capacity: number;
  private readonly _ttlMs: number;
  private readonly _now: () => number;
  private readonly _createdAt: number;
  private _lastAccessAt: number | null;
  private _hits: number;
  private _misses: number;
  private _evictions: number;
  private _expired: number;

  /**
   * Construct a new store.
   *
   * @param options - capacity, TTL and clock configuration
   */
  constructor(options: RagStoreOptions = {}) {
    this._capacity = Math.max(0, Math.floor(options.capacity ?? 1000));
    this._ttlMs = Math.max(0, Math.floor(options.ttlMs ?? 60_000));
    this._now = options.now ?? Date.now;
    this._entries = new Map();
    this._pieces = new Map();
    this._pieceOwners = new Map();
    this._createdAt = this._now();
    this._lastAccessAt = null;
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._expired = 0;
  }

  /**
   * Number of entries currently cached.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * Number of distinct pieces currently indexed.
   */
  get pieceCount(): number {
    return this._pieces.size;
  }

  /**
   * The store's capacity ceiling.
   */
  get capacity(): number {
    return this._capacity;
  }

  /**
   * The store's configured TTL in milliseconds.
   */
  get ttlMs(): number {
    return this._ttlMs;
  }

  /**
   * Store a value under a key.
   *
   * Overwrites any previous entry for the same key (and retires the piece
   * ownership of the overwritten value). When the value is a context or a
   * result, its pieces are indexed by id.
   *
   * @param key - the cache key
   * @param value - the value to cache
   * @returns the store, for chaining
   */
  put(key: string, value: RagStoreValue): this {
    const now = this._now();
    if (this._entries.has(key)) {
      this._dropPiecesFor(key);
    }
    const entry: StoredEntry<RagStoreValue> = {
      key,
      value,
      createdAt: now,
      expiresAt: this._ttlMs > 0 ? now + this._ttlMs : Number.POSITIVE_INFINITY,
      lastAccessed: now,
      hits: 0,
    };
    this._entries.set(key, entry);
    this._lastAccessAt = now;
    this._indexPieces(key, value);
    this._enforceCapacity(now);
    return this;
  }

  /**
   * Retrieve a value by key.
   *
   * Expired entries are dropped (and counted) before returning, so stale data
   * never leaks out of the store.
   *
   * @param key - the cache key
   * @returns the cached value, or `undefined` when absent or expired
   */
  get<T extends RagStoreValue = RagStoreValue>(key: string): T | undefined {
    const now = this._now();
    const entry = this._entries.get(key);
    if (!entry) {
      this._misses += 1;
      return undefined;
    }
    if (now > entry.expiresAt) {
      this._expire(key, entry, now);
      this._misses += 1;
      return undefined;
    }
    entry.lastAccessed = now;
    entry.hits += 1;
    this._hits += 1;
    this._lastAccessAt = now;
    return entry.value as T;
  }

  /**
   * Look up a cached value by raw query text.
   *
   * The query is normalised and hashed exactly as {@link buildCacheKey} does,
   * so any value cached under a query key (contexts, results) is found.
   *
   * @param query - the raw query text
   * @returns the cached value, or `undefined`
   */
  getByQuery(query: string): RagStoreValue | undefined {
    if (!query) {
      return undefined;
    }
    return this.get(buildCacheKey(query));
  }

  /**
   * Retrieve an indexed piece by id.
   *
   * @param id - the piece id
   * @returns the piece, or `undefined` when not indexed
   */
  getPiece(id: string): RagPiece | undefined {
    const piece = this._pieces.get(id);
    if (piece) {
      this._lastAccessAt = this._now();
    }
    return piece;
  }

  /**
   * Test whether a key is present and unexpired.
   *
   * @param key - the cache key
   * @returns `true` when an unexpired entry exists
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete an entry by key, removing any pieces it owned.
   *
   * @param key - the cache key
   * @returns `true` when an entry was removed
   */
  delete(key: string): boolean {
    if (!this._entries.has(key)) {
      return false;
    }
    this._entries.delete(key);
    this._dropPiecesFor(key);
    this._evictions += 1;
    return true;
  }

  /**
   * All cache keys currently held, in insertion order.
   *
   * @returns the keys as a new array
   */
  keys(): string[] {
    return [...this._entries.keys()];
  }

  /**
   * Remove every entry and indexed piece.
   *
   * @returns the number of entries cleared
   */
  clear(): number {
    const cleared = this._entries.size;
    this._entries.clear();
    this._pieces.clear();
    this._pieceOwners.clear();
    return cleared;
  }

  /**
   * Store a batch of entries in one call.
   *
   * @param entries - key/value pairs to store
   * @returns the number of entries stored
   */
  putMany(entries: ReadonlyArray<readonly [string, RagStoreValue]>): number {
    let count = 0;
    for (const [key, value] of entries) {
      this.put(key, value);
      count += 1;
    }
    return count;
  }

  /**
   * Remove expired entries.
   *
   * @returns the number of expired entries removed
   */
  sweep(): number {
    const now = this._now();
    let removed = 0;
    for (const [key, entry] of this._entries) {
      if (now > entry.expiresAt) {
        this._expire(key, entry, now);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Reduce the store to at most `maxEntries` entries, evicting
   * least-recently-accessed entries first (after dropping expired ones).
   *
   * @param maxEntries - the target entry ceiling
   * @returns the number of entries removed
   */
  prune(maxEntries: number): number {
    const ceiling = Math.max(0, Math.floor(maxEntries));
    if (this._entries.size <= ceiling) {
      return 0;
    }
    this.sweep();
    let removed = 0;
    while (this._entries.size > ceiling) {
      const victim = this._leastRecentlyAccessedKey();
      if (victim === null) {
        break;
      }
      this._entries.delete(victim);
      this._dropPiecesFor(victim);
      this._evictions += 1;
      removed += 1;
    }
    return removed;
  }

  /**
   * Aggregate statistics for the store.
   *
   * @returns a {@link RagStoreStats} snapshot
   */
  stats(): RagStoreStats {
    const lookups = this._hits + this._misses;
    return {
      queries: this._hits + this._misses,
      cacheHits: this._hits,
      cacheMisses: this._misses,
      cached: this._hits,
      assembled: 0,
      pruned: this._expired,
      evictions: this._evictions,
      createdAt: this._createdAt,
      lastAccessAt: this._lastAccessAt,
      cachedRatio: lookups === 0 ? 0 : this._hits / lookups,
      entries: this._entries.size,
      pieces: this._pieces.size,
      capacity: this._capacity,
      ttlMs: this._ttlMs,
      expired: this._expired,
    };
  }

  /**
   * Serialise the entire store to a JSON-safe plain object.
   *
   * Values (pieces, contexts, results) are plain JSON-safe shapes, so the
   * output can be persisted or shipped to another process.
   *
   * @returns a {@link SerializedRagStore}
   */
  toJSON(): SerializedRagStore {
    return {
      version: RAG_STORE_VERSION,
      capacity: this._capacity,
      ttlMs: this._ttlMs,
      createdAt: this._createdAt,
      entries: [...this._entries.values()].map((entry) => ({
        key: entry.key,
        value: entry.value,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        lastAccessed: entry.lastAccessed,
        hits: entry.hits,
      })),
    };
  }

  /**
   * Rebuild a store from a serialised snapshot.
   *
   * @param data - the output of {@link RagStore.toJSON}
   * @param options - overrides for capacity/TTL/clock (defaults to the snapshot's)
   * @returns a new store populated with the snapshot's entries
   */
  static fromJSON(
    data: unknown,
    options?: RagStoreOptions,
  ): RagStore {
    if (!isSerializedRagStore(data)) {
      throw new TypeError('Cannot restore RagStore: invalid serialised shape');
    }
    const store = new RagStore({
      capacity: options?.capacity ?? data.capacity,
      ttlMs: options?.ttlMs ?? data.ttlMs,
      now: options?.now,
    });
    for (const entry of data.entries) {
      store.put(entry.key, entry.value);
    }
    return store;
  }

  /**
   * Enforce the capacity ceiling, evicting expired entries first and then
   * least-recently-accessed entries.
   *
   * @param now - the current timestamp
   */
  private _enforceCapacity(now: number): void {
    if (this._capacity <= 0 || this._entries.size <= this._capacity) {
      return;
    }
    for (const [key, entry] of this._entries) {
      if (now > entry.expiresAt) {
        this._expire(key, entry, now);
      }
    }
    while (this._entries.size > this._capacity) {
      const victim = this._leastRecentlyAccessedKey();
      if (victim === null) {
        break;
      }
      this._entries.delete(victim);
      this._dropPiecesFor(victim);
      this._evictions += 1;
    }
  }

  /**
   * Find the key of the least-recently-accessed entry.
   *
   * @returns the key, or `null` when the store is empty
   */
  private _leastRecentlyAccessedKey(): string | null {
    let oldest: StoredEntry<RagStoreValue> | null = null;
    for (const entry of this._entries.values()) {
      if (oldest === null || entry.lastAccessed < oldest.lastAccessed) {
        oldest = entry;
      }
    }
    return oldest ? oldest.key : null;
  }

  /**
   * Drop an entry, counting it as expired.
   *
   * @param key - the entry key
   * @param entry - the entry being dropped
   * @param now - the current timestamp
   */
  private _expire(
    key: string,
    _entry: StoredEntry<RagStoreValue>,
    now: number,
  ): void {
    this._entries.delete(key);
    this._dropPiecesFor(key);
    this._expired += 1;
    this._lastAccessAt = now;
  }

  /**
   * Index the pieces embedded in a value, remembering which entry owns each
   * piece so it can be dropped later.
   *
   * @param key - the owning entry key
   * @param value - the value being stored
   */
  private _indexPieces(key: string, value: RagStoreValue): void {
    let pieces: readonly RagPiece[] | undefined;
    if (isRagContext(value)) {
      pieces = value.pieces;
    } else if (isRagResult(value)) {
      pieces = value.context.pieces;
    }
    if (!pieces) {
      return;
    }
    for (const piece of pieces) {
      this._pieces.set(piece.id, piece);
      this._addOwner(key, piece.id);
    }
  }

  /**
   * Remove all piece ownership for an entry key, deleting piece records that
   * no other entry references.
   *
   * @param key - the entry key being removed
   */
  private _dropPiecesFor(key: string): void {
    const owned = this._pieceOwners.get(key);
    if (!owned) {
      return;
    }
    for (const pieceId of owned) {
      const stillOwned = [...this._pieceOwners.entries()].some(
        ([ownerKey, ids]) => ownerKey !== key && ids.has(pieceId),
      );
      if (!stillOwned) {
        this._pieces.delete(pieceId);
      }
    }
    this._pieceOwners.delete(key);
  }

  /**
   * Register that an entry key owns a piece id.
   *
   * @param key - the entry key
   * @param pieceId - the piece id
   */
  private _addOwner(key: string, pieceId: string): void {
    let owners = this._pieceOwners.get(key);
    if (!owners) {
      owners = new Set();
      this._pieceOwners.set(key, owners);
    }
    owners.add(pieceId);
  }

  /**
   * Total token count of all currently indexed pieces (for diagnostics).
   *
   * @returns the sum of {@link countTokens} over indexed pieces
   */
  tokenFootprint(): number {
    let total = 0;
    for (const piece of this._pieces.values()) {
      total += countTokens(piece.text);
    }
    return total;
  }

  /**
   * Describe the store in one line (useful for logs).
   *
   * @returns a short human-readable description
   */
  describe(): string {
    const now = this._now();
    const expired = this.sweep();
    void expired;
    return (
      `RagStore{entries=${this._entries.size}, pieces=${this._pieces.size}, ` +
      `capacity=${this._capacity}, ttlMs=${this._ttlMs}, now=${now}}`
    );
  }
}

/**
 * Normalise a raw query for store lookups (convenience re-export).
 *
 * @param text - the raw query text
 * @returns the normalised query
 */
export function normalizeQuery(text: string): string {
  return normalizeText(text);
}

/**
 * Build a store cache key for a raw query (convenience re-export).
 *
 * @param query - the raw query text
 * @returns the cache key
 */
export function queryKey(query: string): string {
  return buildCacheKey(query);
}