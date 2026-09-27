/**
 * RetrievalStore — an in-memory, insertion-ordered chunk store for the
 * Retrieval layer of the standalone MAM Knowledge Engine.
 *
 * The {@link KnowledgeRetriever} (see `retrieval.ts`) and the
 * {@link HybridRetriever} (see `integration.ts`) both need a place to keep the
 * {@link RetrievedChunk}s they rank. This module provides that place without
 * pulling in any external storage dependency:
 *
 * - `put` / `get` / `delete` / `has` / `keys` / `clear` / `size` give the full
 *   map-like CRUD surface that a caller expects from an in-memory store.
 * - `getBySource` and `putMany` are the two bulk operations that dominate real
 *   ingestion flows — loading a whole document (many chunks sharing one
 *   `sourceId`) in a single call.
 * - `filter` / `find` / `findByTag` / `sample` support the narrowing and
 *   inspection needs of debugging, testing and instrumentation tooling.
 * - `toJSON` / `fromJSON` make the entire corpus serialisable to a plain JSON
 *   snapshot and restorable later — used by persistence layers, hot-reload
 *   tooling and test fixtures.
 *
 * The store deliberately keeps **no scoring intelligence**: it is a dumb,
 * reliable holder of {@link RetrievedChunk} values. Relevance is computed
 * elsewhere (the index and the retrievers) so the store stays simple enough to
 * audit and swap for a real database-backed implementation without disturbing
 * the rest of the layer.
 *
 * {@link RetrievedChunk} values are stored immutable (the interface is
 * read-only) so a chunk handed out by `get`/`all` can never be corrupted
 * behind the store's back. `put` copies the caller's input into a canonical
 * {@link RetrievedChunk} via {@link RetrievalStore.toChunk}.
 *
 * @packageDocumentation
 * @module retrieval/store
 */

import { clampScore, isRetrievedChunk, normalizeText } from './types.js';
import type {
  ChunkId,
  RetrievedChunk,
  SourceId,
  Timestamp,
} from './types.js';

/**
 * Version tag written into {@link StoreSnapshot} values so future migrations
 * can detect incompatible snapshots produced by older releases.
 */
export const STORE_SNAPSHOT_VERSION = 1;

/**
 * A minimal, callable description of a chunk accepted by `put`.
 *
 * Everything except `chunkId`, `sourceId` and `text` is optional; the store
 * fills in sensible defaults (`score: 0`, `rank: undefined`) so callers that
 * only care about retrieval inputs never have to fabricate scoring fields.
 */
export interface StoreChunkInput {
  /** Unique identifier of the chunk. See {@link ChunkId}. */
  readonly chunkId: ChunkId;
  /** Identifier of the source document the chunk was carved from. */
  readonly sourceId: SourceId;
  /** The chunk's verbatim textual content. */
  readonly text: string;
  /** Optional human-readable provenance label for the owning source. */
  readonly source?: string;
  /** Optional set of tags used by tag-based filtering. */
  readonly tags?: readonly string[];
  /** Optional dense embedding vector, if the caller provides one. */
  readonly vector?: readonly number[];
  /** Caller-owned structured metadata, preserved verbatim. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Optional precomputed relevance score; defaults to `0`. */
  readonly score?: number;
}

/**
 * A predicate-based narrowing description for {@link RetrievalStore.filter}.
 *
 * An empty filter (all fields undefined) matches every chunk. When `tags` and
 * `sourceId` are both present they combine with an implicit AND; tags
 * themselves combine according to {@link StoreFilter.tagMode}.
 */
export interface StoreFilter {
  /** Keep only chunks whose `sourceId` equals this value. */
  readonly sourceId?: SourceId;
  /** Keep only chunks carrying the given tags (see {@link StoreFilter.tagMode}). */
  readonly tags?: readonly string[];
  /**
   * `'all'` (default) requires every tag to be present; `'any'` accepts a
   * chunk that carries at least one of them.
   */
  readonly tagMode?: 'all' | 'any';
  /** Keep only chunks whose stored `score` is `>=` this value. */
  readonly threshold?: number;
}

/**
 * A JSON-serialisable snapshot of the whole store, as produced by
 * {@link RetrievalStore.toJSON} and consumed by {@link RetrievalStore.fromJSON}.
 */
export interface StoreSnapshot {
  /** Snapshot format version ({@link STORE_SNAPSHOT_VERSION}). */
  readonly version: number;
  /** Epoch-ms time the snapshot was taken. */
  readonly createdAt: Timestamp;
  /** All chunks currently held by the store. */
  readonly chunks: readonly RetrievedChunk[];
}

/**
 * Aggregate, on-demand statistics describing a store's current contents.
 */
export interface StoreStats {
  /** Number of chunks currently held. */
  readonly chunks: number;
  /** Number of distinct source ids represented by the held chunks. */
  readonly sources: number;
  /** Total number of whitespace-delimited terms across every chunk. */
  readonly totalTerms: number;
  /** Mean chunk text length in code units (0 for an empty store). */
  readonly averageChunkLength: number;
  /** Number of distinct tags observed across all chunks. */
  readonly distinctTags: number;
  /** Epoch-ms time the store was constructed. */
  readonly createdAt: Timestamp;
}

/**
 * A chunk predicate used by {@link RetrievalStore.find}.
 */
export type ChunkPredicate = (chunk: RetrievedChunk) => boolean;

/**
 * The canonical in-memory chunk store.
 *
 * Backed by an insertion-ordered `Map`, so `keys()` and `all()` return chunks
 * in the order they were added unless the caller reorders them. The store is
 * safe to use from a single thread and makes no network or file-system calls.
 *
 * @example
 * ```ts
 * const store = new RetrievalStore();
 * store.put({ chunkId: 'manual/1', sourceId: 'manual', text: 'Back up first.' });
 * store.putMany([
 *   { chunkId: 'manual/2', sourceId: 'manual', text: 'Then migrate.', tags: ['migration'] },
 * ]);
 * store.getBySource('manual').length; // 2
 * store.toJSON(); // { version: 1, createdAt: ..., chunks: [...] }
 * ```
 */
export class RetrievalStore {
  /** Insertion-ordered backing map: chunkId → chunk. */
  private readonly chunks = new Map<ChunkId, RetrievedChunk>();

  /** Wall-clock time the store was constructed (or the injected clock). */
  private readonly createdAt: Timestamp;

  /** Clock used for all timestamps; injectable for deterministic tests. */
  private readonly now: () => Timestamp;

  /**
   * Construct a store, optionally seeding it from an iterable of inputs.
   *
   * @param initial - optional iterable of chunk inputs (or already-shaped
   *   {@link RetrievedChunk}s) to seed the store with.
   * @param config - optional construction options; currently only the clock.
   */
  constructor(
    initial?: Iterable<StoreChunkInput | RetrievedChunk>,
    config: { readonly now?: () => Timestamp } = {},
  ) {
    this.now = config.now ?? (() => Date.now());
    this.createdAt = this.now();
    if (initial) {
      for (const entry of initial) {
        this.put(RetrievalStore.toChunk(entry));
      }
    }
  }

  /**
   * Structural type guard for {@link StoreChunkInput}.
   *
   * Checks only the three required fields so it tolerates partial records and
   * fully-formed {@link RetrievedChunk}s alike.
   *
   * @param value - the value to test
   * @returns `true` when the value can be coerced to a chunk input
   */
  static isChunkInput(value: unknown): value is StoreChunkInput {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record = value as Partial<StoreChunkInput>;
    return (
      typeof record.chunkId === 'string' &&
      typeof record.sourceId === 'string' &&
      typeof record.text === 'string'
    );
  }

  /**
   * Coerce a chunk input (or an already-shaped chunk) into a canonical
   * {@link RetrievedChunk}.
   *
   * @param input - the value to coerce
   * @returns a new, immutable {@link RetrievedChunk} with a clamped score
   */
  static toChunk(input: StoreChunkInput | RetrievedChunk): RetrievedChunk {
    if (isRetrievedChunk(input)) {
      return input;
    }
    const candidate = input as StoreChunkInput;
    return {
      chunkId: candidate.chunkId,
      sourceId: candidate.sourceId,
      text: candidate.text,
      source: candidate.source,
      tags: candidate.tags,
      vector: candidate.vector,
      metadata: candidate.metadata,
      score: clampScore(candidate.score ?? 0),
    };
  }

  /**
   * Insert (or replace) a chunk in the store.
   *
   * @param input - the chunk to store; a new canonical chunk is derived from
   *   it, so later mutation of `input` cannot affect the store.
   * @returns the canonical chunk that was stored
   */
  put(input: StoreChunkInput): RetrievedChunk {
    const chunk = RetrievalStore.toChunk(input);
    this.chunks.set(chunk.chunkId, chunk);
    return chunk;
  }

  /**
   * Insert (or replace) many chunks in a single call.
   *
   * @param inputs - iterable of chunk inputs
   * @returns the number of chunks stored
   */
  putMany(inputs: Iterable<StoreChunkInput | RetrievedChunk>): number {
    let count = 0;
    for (const input of inputs) {
      this.put(input);
      count += 1;
    }
    return count;
  }

  /**
   * Fetch a chunk by id.
   *
   * @param chunkId - the chunk's unique identifier
   * @returns the stored chunk, or `undefined` when absent
   */
  get(chunkId: ChunkId): RetrievedChunk | undefined {
    return this.chunks.get(chunkId);
  }

  /**
   * Remove a chunk by id.
   *
   * @param chunkId - the chunk's unique identifier
   * @returns `true` when a chunk was removed, `false` when it was absent
   */
  delete(chunkId: ChunkId): boolean {
    return this.chunks.delete(chunkId);
  }

  /**
   * Test whether a chunk id is present.
   *
   * @param chunkId - the chunk's unique identifier
   * @returns `true` when the store holds a chunk with this id
   */
  has(chunkId: ChunkId): boolean {
    return this.chunks.has(chunkId);
  }

  /**
   * Return all chunk ids, in insertion order.
   *
   * @returns a fresh array of chunk ids
   */
  keys(): ChunkId[] {
    return [...this.chunks.keys()];
  }

  /**
   * Remove every chunk from the store.
   */
  clear(): void {
    this.chunks.clear();
  }

  /**
   * Number of chunks currently held.
   */
  get size(): number {
    return this.chunks.size;
  }

  /**
   * All chunks, in insertion order, as a fresh array.
   *
   * @returns a shallow copy of the store's contents
   */
  all(): RetrievedChunk[] {
    return [...this.chunks.values()];
  }

  /**
   * Fetch every chunk that belongs to a given source, in insertion order.
   *
   * @param sourceId - the owning source's identifier
   * @returns matching chunks (possibly empty)
   */
  getBySource(sourceId: SourceId): RetrievedChunk[] {
    const matches: RetrievedChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.sourceId === sourceId) {
        matches.push(chunk);
      }
    }
    return matches;
  }

  /**
   * Merge a partial update into an existing chunk.
   *
   * Only the fields present on `patch` are replaced; the rest are preserved.
   * A provided `score` is clamped into `[0, 1]`.
   *
   * @param chunkId - the chunk to update
   * @param patch - the fields to overwrite
   * @returns the updated chunk, or `undefined` when the id is unknown
   */
  update(
    chunkId: ChunkId,
    patch: Partial<StoreChunkInput>,
  ): RetrievedChunk | undefined {
    const current = this.chunks.get(chunkId);
    if (!current) {
      return undefined;
    }
    const updated: RetrievedChunk = {
      ...current,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.vector !== undefined ? { vector: patch.vector } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      ...(patch.score !== undefined ? { score: clampScore(patch.score) } : {}),
    };
    this.chunks.set(chunkId, updated);
    return updated;
  }

  /**
   * Narrow the store's contents by {@link StoreFilter}.
   *
   * `sourceId` and `tags` combine with an implicit AND; the threshold applies
   * to each chunk's stored `score`. An empty filter returns every chunk.
   *
   * @param filter - the narrowing description (all fields optional)
   * @returns the matching chunks, in insertion order
   */
  filter(filter: StoreFilter = {}): RetrievedChunk[] {
    const tagMode = filter.tagMode ?? 'all';
    const tagSet =
      filter.tags && filter.tags.length > 0 ? new Set(filter.tags) : null;
    const matches: RetrievedChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (filter.sourceId !== undefined && chunk.sourceId !== filter.sourceId) {
        continue;
      }
      if (filter.threshold !== undefined && chunk.score < filter.threshold) {
        continue;
      }
      if (tagSet) {
        const chunkTags = new Set(chunk.tags ?? []);
        const matched =
          tagMode === 'all'
            ? [...tagSet].every((tag) => chunkTags.has(tag))
            : [...tagSet].some((tag) => chunkTags.has(tag));
        if (!matched) {
          continue;
        }
      }
      matches.push(chunk);
    }
    return matches;
  }

  /**
   * Return every chunk carrying a specific tag.
   *
   * @param tag - the tag to search for
   * @returns matching chunks
   */
  findByTag(tag: string): RetrievedChunk[] {
    const matches: RetrievedChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.tags?.includes(tag)) {
        matches.push(chunk);
      }
    }
    return matches;
  }

  /**
   * Return chunks satisfying an arbitrary predicate.
   *
   * @param predicate - a per-chunk test
   * @returns the matching chunks, in insertion order
   */
  find(predicate: ChunkPredicate): RetrievedChunk[] {
    const matches: RetrievedChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (predicate(chunk)) {
        matches.push(chunk);
      }
    }
    return matches;
  }

  /**
   * Return up to `count` chunks chosen pseudo-randomly.
   *
   * Useful for sampling a corpus for spot-checks or evaluation fixtures. The
   * sample is drawn without replacement from the current contents.
   *
   * @param count - maximum number of chunks to return
   * @returns a random subset of the store's contents
   */
  sample(count: number): RetrievedChunk[] {
    const all = this.all();
    if (count >= all.length) {
      return all;
    }
    if (count <= 0) {
      return [];
    }
    const pool = [...all];
    const out: RetrievedChunk[] = [];
    for (let i = 0; i < count && pool.length > 0; i += 1) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  /**
   * Iterate every chunk in insertion order.
   *
   * @param callback - invoked once per chunk
   */
  forEach(callback: (chunk: RetrievedChunk, chunkId: ChunkId) => void): void {
    for (const [chunkId, chunk] of this.chunks) {
      callback(chunk, chunkId);
    }
  }

  /**
   * Compute on-demand statistics about the store's current contents.
   *
   * @returns a {@link StoreStats} summary
   */
  stats(): StoreStats {
    const sources = new Set<string>();
    const tags = new Set<string>();
    let totalTerms = 0;
    let totalLength = 0;
    for (const chunk of this.chunks.values()) {
      sources.add(chunk.sourceId);
      for (const tag of chunk.tags ?? []) {
        tags.add(tag);
      }
      totalTerms += chunk.text.split(/\s+/).filter(Boolean).length;
      totalLength += chunk.text.length;
    }
    const count = this.chunks.size;
    return {
      chunks: count,
      sources: sources.size,
      totalTerms,
      averageChunkLength: count > 0 ? totalLength / count : 0,
      distinctTags: tags.size,
      createdAt: this.createdAt,
    };
  }

  /**
   * Serialise the store into a plain JSON-safe {@link StoreSnapshot}.
   *
   * The snapshot contains a copy of every chunk, so it can be persisted and
   * later restored with {@link RetrievalStore.fromJSON}.
   *
   * @returns the store's snapshot
   */
  toJSON(): StoreSnapshot {
    return {
      version: STORE_SNAPSHOT_VERSION,
      createdAt: this.createdAt,
      chunks: this.all(),
    };
  }

  /**
   * Restore a store from a {@link StoreSnapshot}.
   *
   * @param snapshot - a snapshot produced by {@link RetrievalStore.toJSON}
   *   (or shaped identically)
   * @param config - optional construction options (e.g. a custom clock)
   * @returns a new store populated with the snapshot's chunks
   */
  static fromJSON(
    snapshot: StoreSnapshot,
    config: { readonly now?: () => Timestamp } = {},
  ): RetrievalStore {
    const store = new RetrievalStore(undefined, config);
    for (const chunk of snapshot.chunks) {
      store.put(chunk);
    }
    return store;
  }

  /**
   * Convenience factory: build a store from an iterable of chunk inputs.
   *
   * Equivalent to `new RetrievalStore(inputs)`.
   *
   * @param inputs - iterable of chunk inputs
   * @param config - optional construction options
   * @returns the seeded store
   */
  static from(
    inputs: Iterable<StoreChunkInput | RetrievedChunk>,
    config: { readonly now?: () => Timestamp } = {},
  ): RetrievalStore {
    return new RetrievalStore(inputs, config);
  }

  /**
   * A store is empty when it holds no chunks.
   *
   * @returns `true` when `size === 0`
   */
  get isEmpty(): boolean {
    return this.chunks.size === 0;
  }

  /**
   * Human-readable summary of the store's contents, for logging.
   *
   * @returns e.g. `"RetrievalStore(chunks=12, sources=3)"`
   */
  inspect(): string {
    return `RetrievalStore(chunks=${this.chunks.size}, sources=${
      this.stats().sources
    })`;
  }

  /**
   * Normalise a chunk's `sourceId` for grouping/query purposes.
   *
   * @param sourceId - the raw source id
   * @returns the normalised, lower-cased source id
   */
  static normalizeSourceId(sourceId: SourceId): string {
    return normalizeText(sourceId);
  }
}