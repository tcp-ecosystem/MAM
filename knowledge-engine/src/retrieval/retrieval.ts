/**
 * KnowledgeRetriever — hybrid (TF-IDF cosine + lexical overlap) retrieval over
 * an in-memory corpus, with result caching, filtering and ranking.
 *
 * This is the primary entry point of the Retrieval layer. It ties together the
 * {@link RetrievalStore} (the chunks), the {@link RetrievalIndex} (the
 * tokenizer + TF-IDF machinery) and a small bounded result cache to answer the
 * question the rest of the knowledge engine cares about: *"which chunks are
 * most relevant to this query?"*
 *
 * ### Scoring model
 *
 * Every candidate chunk receives a **hybrid score** — a weighted blend of two
 * independent relevance signals:
 *
 * - **TF-IDF cosine** ({@link RetrievalConfig.cosineWeight}): the cosine
 *   similarity between the query's TF-IDF vector and the chunk's TF-IDF
 *   vector. This captures *semantic-ish* term overlap weighted by how rare
 *   (informative) each shared term is across the corpus.
 * - **Lexical overlap** ({@link RetrievalConfig.lexicalWeight}): a Dice
 *   coefficient between the query's literal tokens and the chunk's tokens —
 *   `2·|A ∩ B| / (|A| + |B|)`. This is a pure literal-overlap signal that
 *   rewards exact phrasing.
 *
 * The two components are normalised by the sum of their weights, so the
 * blended score always lies in `[0, 1]` regardless of how the caller sets the
 * weights. A `cosineWeight` of `0` produces a pure literal retriever; a
 * `lexicalWeight` of `0` a pure vector retriever.
 *
 * ### Flow of {@link KnowledgeRetriever.search}
 *
 * 1. **Cache check** — a deterministic key is derived from the normalised
 *    query + options; an unexpired hit is returned immediately.
 * 2. **Candidate narrowing** — chunks are filtered by `sourceId` and `tags`
 *    before scoring (cheap string/tag comparisons).
 * 3. **Hybrid scoring** — each surviving candidate is blended and sorted.
 * 4. **Threshold + top-K** — chunks below `threshold` are dropped, then the
 *    list is truncated to `topK` (if set) with ranks assigned.
 * 5. **Cache write** — the result is stored for the configured TTL.
 *
 * {@link KnowledgeRetriever.recall} is a recall-expansion variant: the query
 * text is blended with an additional context string (weighted by
 * {@link RetrievalConfig.contextWeight}) before scoring, so a caller can say
 * *"find chunks about backups"* while providing surrounding conversation
 * context that sharpens the match.
 *
 * @packageDocumentation
 * @module retrieval/retrieval
 */

import { RetrievalIndex } from './index.js';
import { RetrievalStore } from './store.js';
import type { StoreChunkInput } from './store.js';
import {
  DEFAULT_CONTEXT_WEIGHT,
  DEFAULT_COSINE_WEIGHT,
  DEFAULT_LEXICAL_WEIGHT,
  DEFAULT_THRESHOLD,
  DEFAULT_TOP_K,
  DEFAULT_TTL_MS,
  clampScore,
  normalizeText,
} from './types.js';
import type {
  DocumentVector,
  HybridWeights,
  RetrievedChunk,
  RetrievalConfig,
  RetrievalOptions,
  RetrievalQuery,
  RetrievalResult,
  RetrievalStats,
  SourceId,
  Timestamp,
} from './types.js';

/**
 * A cached search result together with its lifecycle bookkeeping.
 */
interface CacheEntry {
  /** The cached result. */
  readonly result: RetrievalResult;
  /** Epoch-ms time the entry was written. */
  readonly createdAt: Timestamp;
  /** Epoch-ms time the entry expires and may be swept. */
  readonly expiresAt: Timestamp;
  /** Number of times this entry was served from cache. */
  hits: number;
}

/**
 * Resolved, fully-defaulted options for a single retrieval operation.
 */
interface ResolvedOptions {
  readonly topK: number;
  readonly threshold: number;
  readonly sourceId: SourceId | undefined;
  readonly tags: readonly string[] | undefined;
  readonly tagMode: 'all' | 'any';
  readonly lexicalWeight: number;
  readonly cosineWeight: number;
  readonly contextWeight: number;
  readonly cache: boolean;
  readonly context: string | undefined;
}

/**
 * FNV-1a 32-bit hash, rendered in base-36.
 *
 * Deterministic across processes on the same platform, which is all the
 * retrieval layer requires for cache keys.
 *
 * @param input - the string to hash
 * @returns a short stable hash string
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Dice coefficient between two token sets: `2·|A ∩ B| / (|A| + |B|)`.
 *
 * @param a - first token list
 * @param b - second token list
 * @returns overlap score in `[0, 1]`
 */
export function lexicalOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setB = new Set(b);
  let intersection = 0;
  for (const token of a) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

/**
 * The retriever: hybrid scoring, filtering, ranking and caching over a chunk
 * store + term index.
 *
 * @example
 * ```ts
 * const retriever = new KnowledgeRetriever({ defaultTopK: 5 });
 * retriever.addMany([
 *   { chunkId: 'a/1', sourceId: 'a', text: 'Back up before migrating.' },
 *   { chunkId: 'b/1', sourceId: 'b', text: 'Rollback on failure.' },
 * ]);
 * const result = retriever.search('how do I back up?');
 * result.chunks[0].chunkId; // 'a/1'
 * ```
 */
export class KnowledgeRetriever {
  /** Chunk store backing the retriever. */
  private readonly store: RetrievalStore;

  /** Term index (tokenizer + TF-IDF + postings) backing the retriever. */
  private readonly index: RetrievalIndex;

  /** Bounded result cache: cache key → entry. */
  private readonly cache = new Map<string, CacheEntry>();

  /** Default options applied when the caller omits them. */
  private readonly defaults: Readonly<ResolvedOptions>;

  /** Monotonically increasing query counter. */
  private queries = 0;

  /** Cache hit counter. */
  private cacheHits = 0;

  /** Cache miss counter. */
  private cacheMisses = 0;

  /** Number of cache entries evicted to respect `maxCacheSize`. */
  private pruned = 0;

  /** Epoch-ms time of the most recent query, or `null`. */
  private lastQueryAt: Timestamp | null = null;

  /** Epoch-ms time the retriever was constructed. */
  private readonly createdAt: Timestamp;

  /** TTL (ms) applied to cached results. */
  private readonly ttlMs: number;

  /** Maximum cache size; `0` disables the cap. */
  private readonly maxCacheSize: number;

  /** Whether results are cached by default. */
  private readonly cacheResults: boolean;

  /** Clock used for all timestamps; injectable for tests. */
  private readonly now: () => Timestamp;

  /**
   * Construct a retriever.
   *
   * @param config - configuration; every field optional (see
   *   {@link RetrievalConfig})
   */
  constructor(config: RetrievalConfig = {}) {
    this.now = config.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.maxCacheSize = config.maxCacheSize ?? 0;
    this.cacheResults = config.cacheResults !== false;
    this.store = new RetrievalStore(undefined, { now: this.now });
    this.index = new RetrievalIndex(config);
    this.defaults = {
      topK: config.defaultTopK ?? DEFAULT_TOP_K,
      threshold: config.defaultThreshold ?? DEFAULT_THRESHOLD,
      sourceId: undefined,
      tags: undefined,
      tagMode: 'all',
      lexicalWeight: config.lexicalWeight ?? DEFAULT_LEXICAL_WEIGHT,
      cosineWeight: config.cosineWeight ?? DEFAULT_COSINE_WEIGHT,
      contextWeight: config.contextWeight ?? DEFAULT_CONTEXT_WEIGHT,
      cache: this.cacheResults,
      context: undefined,
    };
  }

  /**
   * The underlying chunk store (exposed for inspection/tooling).
   */
  get storeView(): RetrievalStore {
    return this.store;
  }

  /**
   * The underlying term index (exposed for inspection/tooling).
   */
  get indexView(): RetrievalIndex {
    return this.index;
  }

  /**
   * Number of chunks currently registered with the retriever.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Add a chunk to the retriever's corpus (store + index).
   *
   * @param input - the chunk to add
   * @returns the canonical stored chunk
   */
  addChunk(input: StoreChunkInput): RetrievedChunk {
    const chunk = this.store.put(input);
    this.index.indexText(chunk.chunkId, chunk.text);
    return chunk;
  }

  /**
   * Add many chunks to the retriever's corpus in a single call.
   *
   * @param inputs - iterable of chunk inputs
   * @returns the number of chunks added
   */
  addMany(inputs: Iterable<StoreChunkInput>): number {
    let count = 0;
    for (const input of inputs) {
      this.addChunk(input);
      count += 1;
    }
    return count;
  }

  /**
   * Remove a chunk from the corpus (store + index).
   *
   * @param chunkId - the chunk to remove
   * @returns `true` when the chunk was removed
   */
  removeChunk(chunkId: string): boolean {
    const removed = this.store.delete(chunkId);
    this.index.removeEntry(chunkId);
    return removed;
  }

  /**
   * Fetch a stored chunk by id.
   *
   * @param chunkId - the chunk's identifier
   * @returns the chunk, or `undefined`
   */
  getChunk(chunkId: string): RetrievedChunk | undefined {
    return this.store.get(chunkId);
  }

  /**
   * Test whether a chunk id is registered.
   *
   * @param chunkId - the chunk's identifier
   * @returns `true` when present
   */
  hasChunk(chunkId: string): boolean {
    return this.store.has(chunkId);
  }

  /**
   * Remove every chunk from the retriever's corpus (but keep the cache).
   */
  clear(): void {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Remove every entry from the result cache.
   *
   * @returns the number of entries cleared
   */
  clearCache(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  /**
   * Derive a deterministic cache key for a query + options combination.
   *
   * The key folds in the normalised query text, source/tag scoping, top-K,
   * threshold and the effective hybrid weights, so changing any scoring-relevant
   * option produces a different bucket.
   *
   * @param query - the query (string or {@link RetrievalQuery})
   * @param options - per-call options (optional)
   * @returns a stable cache key string
   */
  cacheKey(query: string | RetrievalQuery, options: RetrievalOptions = {}): string {
    const q = this.resolveQuery(query);
    const o = this.resolveOptions(options);
    const parts = [
      normalizeText(q.text ?? ''),
      q.sourceId ?? o.sourceId ?? '',
      (q.tags ?? o.tags ?? []).slice().sort().join(','),
      q.tagMode ?? o.tagMode ?? 'all',
      String(q.topK ?? o.topK),
      String(q.threshold ?? o.threshold),
      String(o.lexicalWeight),
      String(o.cosineWeight),
      String(o.contextWeight),
    ];
    return hashString(parts.join('|'));
  }

  /**
   * Normalise a query argument (string or object) into a {@link RetrievalQuery}.
   *
   * @param query - the raw query
   * @returns a normalised query object
   */
  private resolveQuery(query: string | RetrievalQuery): RetrievalQuery {
    if (typeof query === 'string') {
      return { text: query };
    }
    return query;
  }

  /**
   * Merge per-call options over the configured defaults.
   *
   * @param options - the caller's overrides
   * @returns a fully-resolved options record
   */
  private resolveOptions(options: RetrievalOptions): ResolvedOptions {
    return {
      topK: options.topK ?? this.defaults.topK,
      threshold: options.threshold ?? this.defaults.threshold,
      sourceId: options.sourceId ?? this.defaults.sourceId,
      tags: options.tags ?? this.defaults.tags,
      tagMode: options.tagMode ?? this.defaults.tagMode,
      lexicalWeight: options.lexicalWeight ?? this.defaults.lexicalWeight,
      cosineWeight: options.cosineWeight ?? this.defaults.cosineWeight,
      contextWeight: options.contextWeight ?? this.defaults.contextWeight,
      cache: options.cache ?? this.defaults.cache,
      context: options.context ?? this.defaults.context,
    };
  }

  /**
   * Compute the hybrid score + reason for a single chunk against a query.
   *
   * @param chunk - the candidate chunk
   * @param query - the normalised query
   * @param options - the resolved options (weights)
   * @returns the chunk with a clamped `score` and an explanatory `reason`
   */
  private scoreChunk(
    chunk: RetrievedChunk,
    query: RetrievalQuery,
    options: ResolvedOptions,
  ): RetrievedChunk {
    const text = query.text ?? '';
    const hasTextSignal = text.trim().length > 0;
    const hasTagSignal = !!query.tags && query.tags.length > 0;

    if (!hasTextSignal && hasTagSignal) {
      const tags = query.tags ?? [];
      const chunkTags = new Set(chunk.tags ?? []);
      const matched = tags.filter((tag) => chunkTags.has(tag)).length;
      const score = clampScore(matched / tags.length);
      return { ...chunk, score, reason: `tags ${matched}/${tags.length}` };
    }

    if (!hasTextSignal && !hasTagSignal) {
      return { ...chunk, score: clampScore(chunk.score), reason: 'no signal' };
    }

    const qTokens = this.index.tokenize(text);
    const cTokens = this.index.tokenize(chunk.text);
    const qVector = this.index.computeVector(text);
    const cVector = this.index.computeVector(chunk.text);

    const cosine = this.index.similarity(qVector, cVector);
    const lexical = lexicalOverlap(qTokens, cTokens);

    const weightSum = options.cosineWeight + options.lexicalWeight;
    const blended =
      weightSum > 0
        ? (cosine * options.cosineWeight + lexical * options.lexicalWeight) /
          weightSum
        : 0;
    const score = clampScore(blended);
    const reason = `cosine ${cosine.toFixed(3)} + lexical ${lexical.toFixed(3)}`;
    return { ...chunk, score, reason };
  }

  /**
   * Blend two raw term→count vectors, weighting `extra` by `weight`.
   *
   * Used by {@link KnowledgeRetriever.recall} to fold a context string into the
   * query signal via query expansion.
   *
   * @param primary - the primary vector (query)
   * @param extra - the secondary vector (context)
   * @param weight - weight applied to the secondary vector's counts
   * @returns a new merged raw vector
   */
  private blendVectors(
    primary: DocumentVector,
    extra: DocumentVector,
    weight: number,
  ): DocumentVector {
    const merged: Record<string, number> = { ...primary };
    for (const [term, count] of Object.entries(extra)) {
      merged[term] = (merged[term] ?? 0) + count * weight;
    }
    return merged;
  }

  /**
   * Rank an arbitrary set of chunks against a query without touching the cache.
   *
   * Pure, side-effect-free scoring: the input array is not mutated and a fresh
   * array of scored chunks (each carrying `rank`, `score` and `reason`) is
   * returned, best first.
   *
   * @param chunks - the chunks to score
   * @param query - the query to score against
   * @param options - optional per-call overrides (weights, top-K, threshold)
   * @returns the scored, sorted, filtered chunks
   */
  rank(
    chunks: readonly RetrievedChunk[],
    query: string | RetrievalQuery,
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    const q = this.resolveQuery(query);
    const o = this.resolveOptions(options);
    const scored = chunks.map((chunk) =>
      this.scoreChunk(chunk, q, o),
    );
    scored.sort((a, b) => b.score - a.score);
    const passed = scored.filter((chunk) => chunk.score >= o.threshold);
    const capped = o.topK > 0 ? passed.slice(0, o.topK) : passed;
    return capped.map((chunk, rank) => ({ ...chunk, rank }));
  }

  /**
   * Apply threshold/source/tag filtering to a chunk list.
   *
   * Pure function: the input array is not mutated. `threshold` compares against
   * each chunk's `score`; `sourceId` and `tags` match provenance.
   *
   * @param chunks - the chunks to filter
   * @param options - the filtering options
   * @returns the chunks that survived every filter
   */
  filter(
    chunks: readonly RetrievedChunk[],
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    const o = this.resolveOptions(options);
    const tagMode = o.tagMode;
    const tagSet = o.tags && o.tags.length > 0 ? new Set(o.tags) : null;
    return chunks.filter((chunk) => {
      if (o.sourceId !== undefined && chunk.sourceId !== o.sourceId) {
        return false;
      }
      if (chunk.score < o.threshold) {
        return false;
      }
      if (tagSet) {
        const chunkTags = new Set(chunk.tags ?? []);
        const matched =
          tagMode === 'all'
            ? [...tagSet].every((tag) => chunkTags.has(tag))
            : [...tagSet].some((tag) => chunkTags.has(tag));
        if (!matched) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Run a full hybrid search over the corpus.
   *
   * @param query - the query text, or a structured {@link RetrievalQuery}
   * @param options - per-call overrides (top-K, threshold, source/tags, weights,
   *   caching)
   * @returns a {@link RetrievalResult} with ranked, filtered chunks
   */
  search(
    query: string | RetrievalQuery,
    options: RetrievalOptions = {},
  ): RetrievalResult {
    const started = this.now();
    this.queries += 1;
    this.lastQueryAt = this.now();

    const q = this.resolveQuery(query);
    const o = this.resolveOptions(options);
    const key = this.cacheKey(q, o);

    const cached = this.cache.get(key);
    if (o.cache && cached && cached.expiresAt > this.now()) {
      this.cacheHits += 1;
      cached.hits += 1;
      return cached.result;
    }
    this.cacheMisses += 1;

    const weights: HybridWeights = {
      lexical: o.lexicalWeight,
      cosine: o.cosineWeight,
      context: o.contextWeight,
    };

    const preFilterCount = this.store.size;
    const candidates = this.store.filter({
      sourceId: q.sourceId ?? o.sourceId,
      tags: q.tags ?? o.tags,
      tagMode: q.tagMode ?? o.tagMode,
    });
    const removedByFilters = preFilterCount - candidates.length;

    const scored = candidates.map((chunk) =>
      this.scoreChunk(chunk, q, o),
    );
    scored.sort((a, b) => b.score - a.score);

    const passed = scored.filter((chunk) => chunk.score >= o.threshold);
    const capped = o.topK > 0 ? passed.slice(0, o.topK) : passed;
    const ranked = capped.map((chunk, rank) => ({ ...chunk, rank }));

    const result: RetrievalResult = {
      query: q,
      chunks: ranked,
      candidates: candidates.length,
      returned: ranked.length,
      removed: removedByFilters + (scored.length - passed.length),
      tookMs: this.now() - started,
      at: started,
      weights,
      cached: false,
    };

    if (o.cache) {
      this.cache.set(key, {
        result,
        createdAt: started,
        expiresAt: this.now() + this.ttlMs,
        hits: 0,
      });
      this.evictIfNeeded();
    }

    return result;
  }

  /**
   * Return the top `k` chunks for a query, discarding the result envelope.
   *
   * @param query - the query
   * @param k - number of results to return
   * @param options - optional per-call overrides
   * @returns the top-k ranked chunks (best first)
   */
  topK(
    query: string | RetrievalQuery,
    k: number,
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    const result = this.search(query, { ...options, topK: k, threshold: 0 });
    return result.chunks.slice();
  }

  /**
   * Recall-style search: query text blended with additional context.
   *
   * The context string is tokenized and its term counts added to the query's
   * (weighted by `contextWeight`) *before* scoring — classic query expansion.
   * The lexical overlap uses the union of query + context tokens.
   *
   * @param query - the primary query text
   * @param context - additional context text to blend in
   * @param options - optional per-call overrides
   * @returns ranked chunks, best first
   */
  recall(
    query: string,
    context: string,
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    this.queries += 1;
    this.lastQueryAt = this.now();

    const o = this.resolveOptions(options);
    const q: RetrievalQuery = { text: query };

    const candidates = this.store.filter({
      sourceId: o.sourceId,
      tags: o.tags,
      tagMode: o.tagMode,
    });

    const qVector = this.index.computeVector(query);
    const cVector = this.index.computeVector(context ?? '');
    const expanded = this.blendVectors(qVector, cVector, o.contextWeight);
    const qTokens = this.index.tokenize(`${query} ${context ?? ''}`);

    const scored = candidates.map((chunk) => {
      const cTokens = this.index.tokenize(chunk.text);
      const cRaw = this.index.computeVector(chunk.text);
      const cosine = this.index.similarity(expanded, cRaw);
      const lexical = lexicalOverlap(qTokens, cTokens);
      const weightSum = o.cosineWeight + o.lexicalWeight;
      const blended =
        weightSum > 0
          ? (cosine * o.cosineWeight + lexical * o.lexicalWeight) / weightSum
          : 0;
      const score = clampScore(blended);
      const reason = `recall cosine ${cosine.toFixed(3)} + lexical ${lexical.toFixed(
        3,
      )}`;
      return { ...chunk, score, reason } as RetrievedChunk;
    });
    scored.sort((a, b) => b.score - a.score);

    const passed = scored.filter((chunk) => chunk.score >= o.threshold);
    const capped = o.topK > 0 ? passed.slice(0, o.topK) : passed;
    return capped.map((chunk, rank) => ({ ...chunk, rank }));
  }

  /**
   * Evict the least-recently-written cache entries to respect `maxCacheSize`.
   *
   * @returns the number of entries evicted
   */
  private evictIfNeeded(): number {
    if (this.maxCacheSize <= 0 || this.cache.size <= this.maxCacheSize) {
      return 0;
    }
    const entries = [...this.cache.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    const excess = this.cache.size - this.maxCacheSize;
    let evicted = 0;
    for (let i = 0; i < excess; i += 1) {
      this.cache.delete(entries[i][0]);
      evicted += 1;
    }
    this.pruned += evicted;
    return evicted;
  }

  /**
   * Aggregate statistics describing the retriever's behaviour and corpus.
   *
   * @returns a {@link RetrievalStats} summary
   */
  stats(): RetrievalStats {
    const storeStats = this.store.stats();
    const indexStats = this.index.stats();
    return {
      chunks: storeStats.chunks,
      sources: storeStats.sources,
      cachedQueries: this.cache.size,
      totalTerms: indexStats.totalTerms,
      distinctTerms: indexStats.distinctTerms,
      averageChunkLength: storeStats.averageChunkLength,
      queries: this.queries,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      pruned: this.pruned,
      lastQueryAt: this.lastQueryAt,
      createdAt: this.createdAt,
    };
  }

  /**
   * Human-readable summary for logging.
   *
   * @returns e.g. `"KnowledgeRetriever(chunks=12, cached=4, queries=9)"`
   */
  inspect(): string {
    return `KnowledgeRetriever(chunks=${this.store.size}, cached=${
      this.cache.size
    }, queries=${this.queries})`;
  }
}