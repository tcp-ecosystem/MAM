/**
 * Integration surface for the Ranking layer of the standalone MAM Knowledge
 * Engine.
 *
 * This module is how the rest of the knowledge engine consumes the Ranking
 * layer. It exposes three pieces:
 *
 * 1. **{@link Ranker}** — the interface every ranking facade implements, so
 *    consumers can depend on the contract rather than a concrete class.
 * 2. **{@link RankingAdapter}** — a cache-aware facade over a
 *    {@link KnowledgeRanker} plus a {@link RankingStore}. It implements
 *    {@link Ranker} (`rank`, `topK`, `score`, `stats`) and transparently
 *    serves repeated queries from the cache, exposing hit/miss counters and
 *    invalidation hooks.
 * 3. **{@link ScoredRetriever}** — a facade that wraps an arbitrary
 *    {@link RetrievalSource} (anything that can turn a {@link RankingQuery}
 *    into {@link ChunkCandidate}s) and decorates its output with configurable,
 *    explainable ranking. This is the drop-in entry point for "retrieve
 *    candidates, then rank them".
 *
 * The module also provides the factories {@link createRankingAdapter} and
 * {@link createRanker}, which assemble the default wiring (a fresh
 * {@link KnowledgeRanker} and, for the adapter, a fresh cache) so callers do
 * not need to know the constructor order.
 *
 * @module ranking/integration
 */

import { KnowledgeRanker } from './retrieval.js';
import { RankingStore } from './store.js';
import {
  DEFAULT_TOP_K,
  DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_TTL_MS,
  normalizeText,
} from './types.js';
import type {
  ChunkCandidate,
  RankOptions,
  RankScore,
  RankedChunk,
  RankingConfig,
  RankingQuery,
  RankingResult,
  RankingStats,
  RankingWeights,
  Timestamp,
} from './types.js';

/**
 * The contract every ranking facade implements.
 *
 * Consumers that want to stay decoupled from the concrete ranker/adapter
 * should type against this interface.
 */
export interface Ranker {
  /**
   * Score and order a pool of chunks against a query, best first.
   */
  rank(
    chunks: readonly ChunkCandidate[],
    query: RankingQuery,
    options?: RankOptions,
  ): RankedChunk[];

  /**
   * Return only the top `k` results for a query.
   */
  topK(
    chunks: readonly ChunkCandidate[],
    query: RankingQuery,
    k?: number,
    options?: RankOptions,
  ): RankedChunk[];

  /**
   * Score a single chunk against a query.
   */
  score(chunk: ChunkCandidate, query: RankingQuery, options?: RankOptions): RankScore;

  /**
   * Aggregate statistics for the facade.
   */
  stats(): RankingStats;
}

/**
 * Construction options for a {@link RankingAdapter}.
 */
export interface RankingAdapterOptions {
  /**
   * When `true` (default), ranking results are cached by query and served on
   * repeat. Set to `false` for query-once workloads.
   */
  readonly cache: boolean;

  /**
   * Time-to-live in milliseconds for cached results. Defaults to
   * {@link DEFAULT_TTL_MS}.
   */
  readonly ttlMs: number;

  /**
   * Maximum number of cached results. Defaults to {@link DEFAULT_MAX_CACHE_SIZE}.
   */
  readonly maxCacheSize: number;

  /**
   * Custom cache-key derivation. Defaults to normalised query text.
   */
  readonly cacheKey?: (query: RankingQuery) => string;

  /**
   * Clock used for all timestamps.
   */
  readonly now: () => Timestamp;
}

/**
 * A cache-aware {@link Ranker} facade over a {@link KnowledgeRanker} and a
 * {@link RankingStore}.
 *
 * Delegates scoring to the wrapped ranker and remembers ranked results per
 * query. Repeat queries are served from the store (counted as hits); first
 * runs are computed and cached (counted as misses). Exposes
 * {@link RankingAdapter.invalidate} and {@link RankingAdapter.clearCache} for
 * targeted and wholesale cache control.
 *
 * @example
 * ```ts
 * const adapter = createRankingAdapter();
 * const ranked = adapter.rank(candidates, { text: 'what is mcp?' });
 * const again = adapter.rank(candidates, { text: 'What is MCP?' }); // cache hit
 * console.log(adapter.stats().cacheHits); // 1
 * adapter.invalidate('what is mcp?');
 * ```
 */
export class RankingAdapter implements Ranker {
  private readonly _ranker: KnowledgeRanker;
  private readonly _store: RankingStore;
  private readonly _options: RankingAdapterOptions;
  private readonly _createdAt: Timestamp;
  private _hits = 0;
  private _misses = 0;
  private _ranked = 0;
  private _lastQueryAt: Timestamp | null = null;

  /**
   * Construct an adapter around a ranker.
   *
   * @param ranker - the {@link KnowledgeRanker} to delegate scoring to
   * @param options - partial {@link RankingAdapterOptions}; omitted fields use
   *   the defaults
   */
  constructor(ranker: KnowledgeRanker, options: Partial<RankingAdapterOptions> = {}) {
    this._ranker = ranker;
    this._options = {
      cache: options.cache ?? true,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxCacheSize: options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
      cacheKey: options.cacheKey,
      now: options.now ?? (() => Date.now()),
    };
    this._store = new RankingStore({
      ttlMs: this._options.ttlMs,
      maxCacheSize: this._options.maxCacheSize,
      now: this._options.now,
    });
    this._createdAt = this._options.now();
  }

  /**
   * The wrapped ranker.
   */
  get ranker(): KnowledgeRanker {
    return this._ranker;
  }

  /**
   * The backing cache store.
   */
  get store(): RankingStore {
    return this._store;
  }

  /**
   * Score and order a pool of chunks, serving repeats from the cache.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param options - per-call overrides
   * @returns the ranked chunks, best first
   */
  rank(chunks: readonly ChunkCandidate[], query: RankingQuery, options: RankOptions = {}): RankedChunk[] {
    this._lastQueryAt = this._options.now();
    const key = this._keyFor(query);
    const cached = this._options.cache ? this._store.get(key) : undefined;
    if (cached) {
      this._hits += 1;
      return [...cached.chunks];
    }
    this._misses += 1;
    const ranked = this._ranker.rank(chunks, query, options);
    if (this._options.cache && ranked.length > 0) {
      this._store.put(key, this._toResult(query, ranked, options));
    }
    this._ranked += ranked.length;
    return ranked;
  }

  /**
   * Return only the top `k` results, serving repeats from the cache.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param k - the maximum number of results (defaults to the query/config
   *   topK, then {@link DEFAULT_TOP_K})
   * @param options - per-call overrides
   * @returns the best `k` chunks, best first
   */
  topK(
    chunks: readonly ChunkCandidate[],
    query: RankingQuery,
    k?: number,
    options: RankOptions = {},
  ): RankedChunk[] {
    const limit = k ?? options.topK ?? query?.topK ?? DEFAULT_TOP_K;
    const ranked = this.rank(chunks, query, options);
    return ranked.slice(0, Math.max(0, limit));
  }

  /**
   * Score a single chunk against a query (never cached).
   *
   * @param chunk - the candidate chunk
   * @param query - the query to score against
   * @param options - per-call overrides
   * @returns the {@link RankScore}
   */
  score(chunk: ChunkCandidate, query: RankingQuery, options: RankOptions = {}): RankScore {
    return this._ranker.score(chunk, query, options);
  }

  /**
   * Aggregate statistics combining ranker, store and adapter counters.
   *
   * @returns a {@link RankingStats} snapshot
   */
  stats(): RankingStats {
    const rankerStats = this._ranker.stats();
    const storeStats = this._store.stats();
    return {
      chunks: rankerStats.chunks,
      documents: rankerStats.documents,
      distinctTerms: rankerStats.distinctTerms,
      totalTerms: rankerStats.totalTerms,
      averageDocumentLength: rankerStats.averageDocumentLength,
      cachedQueries: storeStats.size,
      queries: rankerStats.queries + this._hits + this._misses,
      cacheHits: this._hits,
      cacheMisses: this._misses,
      ranked: this._ranked,
      pruned: storeStats.pruned,
      swept: storeStats.expired,
      averageScore: rankerStats.averageScore,
      topScore: rankerStats.topScore,
      lastQueryAt: this._lastQueryAt,
      createdAt: this._createdAt,
    };
  }

  /**
   * Drop the cached result for a query text.
   *
   * @param text - the query text to invalidate
   * @returns `true` when an entry was removed
   */
  invalidate(text: string): boolean {
    return this._store.delete(normalizeText(text));
  }

  /**
   * Empty the cache entirely.
   *
   * @returns the number of entries cleared
   */
  clearCache(): number {
    return this._store.clear();
  }

  /**
   * Derive the cache key for a query.
   *
   * @param query - the query to key
   * @returns the cache key
   */
  private _keyFor(query: RankingQuery): string {
    return this._options.cacheKey ? this._options.cacheKey(query) : normalizeText(query?.text);
  }

  /**
   * Package a ranked list into a {@link RankingResult} for caching.
   *
   * @param query - the query that produced the result
   * @param chunks - the ranked chunks
   * @param options - the options applied (for the effective weights)
   * @returns a cacheable {@link RankingResult}
   */
  private _toResult(
    query: RankingQuery,
    chunks: readonly RankedChunk[],
    options: RankOptions,
  ): RankingResult {
    return {
      query,
      chunks,
      candidates: chunks.length,
      returned: chunks.length,
      removed: 0,
      tookMs: 0,
      at: this._options.now(),
      weights: this._effectiveWeights(options),
      cached: true,
    };
  }

  /**
   * The effective weight blend for a call, merging options over config.
   *
   * @param options - the per-call options
   * @returns the effective {@link RankingWeights}
   */
  private _effectiveWeights(options: RankOptions): RankingWeights {
    return options.weights
      ? { ...this._ranker.weights(), ...options.weights }
      : this._ranker.weights();
  }
}

/**
 * Assemble a default {@link RankingAdapter}.
 *
 * Creates a fresh {@link KnowledgeRanker} (unless one is supplied) and wraps
 * it in a cache-enabled adapter. Pass `{ cache: false }` to skip caching.
 *
 * @param config - optional wiring: a pre-built ranker and/or adapter options
 * @returns a ready-to-use {@link RankingAdapter}
 */
export function createRankingAdapter(config?: {
  readonly ranker?: KnowledgeRanker;
  readonly cache?: boolean;
  readonly ttlMs?: number;
  readonly maxCacheSize?: number;
  readonly now?: () => Timestamp;
}): RankingAdapter {
  const ranker = config?.ranker ?? new KnowledgeRanker();
  return new RankingAdapter(ranker, config);
}

/**
 * Assemble a default {@link KnowledgeRanker}.
 *
 * @param config - optional partial {@link RankingConfig}
 * @returns a configured {@link KnowledgeRanker}
 */
export function createRanker(config?: Partial<RankingConfig>): KnowledgeRanker {
  return new KnowledgeRanker(config);
}

/**
 * Anything the {@link ScopedRetriever} can pull candidates from.
 *
 * A source turns a {@link RankingQuery} into {@link ChunkCandidate}s. It may
 * be synchronous or asynchronous; {@link ScopedRetriever} normalises both.
 */
export interface RetrievalSource {
  /**
   * Fetch candidate chunks for a query.
   *
   * @param query - the query to satisfy
   * @returns the candidate chunks (or a promise of them)
   */
  search(query: RankingQuery): readonly ChunkCandidate[] | Promise<readonly ChunkCandidate[]>;
}

/**
 * Construction options for a {@link ScopedRetriever}.
 */
export interface ScoredRetrieverOptions {
  /**
   * The ranker used to score candidates. A fresh one is created when omitted.
   */
  readonly ranker?: KnowledgeRanker;

  /**
   * Weight overrides applied to every ranking pass made through this retriever
   * (per-call {@link RankOptions.weights} merge over these).
   */
  readonly weights?: Partial<RankingWeights>;

  /**
   * Default top-K applied when neither the query nor the call supplies one.
   */
  readonly defaultTopK?: number;

  /**
   * Default score threshold applied to every pass.
   */
  readonly defaultThreshold?: number;

  /**
   * Whether repeated queries are cached by the internal adapter.
   */
  readonly cache?: boolean;

  /**
   * Cache TTL in milliseconds.
   */
  readonly ttlMs?: number;

  /**
   * Maximum cached results.
   */
  readonly maxCacheSize?: number;
}

/**
 * A facade that wraps a {@link RetrievalSource} and decorates its output with
 * configurable, explainable ranking.
 *
 * This is the drop-in integration point: point it at any candidate-producing
 * source (a retriever, an embedding store scan, a hybrid search) and it will
 * rank the candidates with the configured weights, cache repeats, and expose
 * {@link Ranker}-shaped entry points.
 *
 * @example
 * ```ts
 * const retriever = new ScoredRetriever(embeddingStore, {
 *   weights: { lexical: 1, vector: 2, recency: 0.3 },
 * });
 * const ranked = await retriever.retrieve({ text: 'how does mcp work?', topK: 5 });
 * ```
 */
export class ScoredRetriever implements Ranker {
  private readonly _source: RetrievalSource;
  private readonly _ranker: KnowledgeRanker;
  private readonly _adapter: RankingAdapter;
  private readonly _options: ScoredRetrieverOptions;

  /**
   * Construct a scored retriever around a source.
   *
   * @param source - the candidate-producing {@link RetrievalSource}
   * @param options - partial {@link ScoredRetrieverOptions}
   */
  constructor(source: RetrievalSource, options: ScoredRetrieverOptions = {}) {
    this._source = source;
    this._options = options;
    this._ranker = options.ranker ?? new KnowledgeRanker();
    this._adapter = new RankingAdapter(this._ranker, {
      cache: options.cache ?? true,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxCacheSize: options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    });
  }

  /**
   * The wrapped retrieval source.
   */
  get source(): RetrievalSource {
    return this._source;
  }

  /**
   * The wrapped ranker.
   */
  get ranker(): KnowledgeRanker {
    return this._ranker;
  }

  /**
   * The internal cache-aware adapter.
   */
  get adapter(): RankingAdapter {
    return this._adapter;
  }

  /**
   * Retrieve candidates from the source and rank them.
   *
   * @param query - the query to satisfy
   * @param options - per-call overrides
   * @returns the ranked chunks, best first
   */
  async retrieve(query: RankingQuery, options: RankOptions = {}): Promise<RankedChunk[]> {
    const candidates = await this._source.search(query);
    return this.rank(candidates, query, options);
  }

  /**
   * Retrieve and return only the top `k` results.
   *
   * @param query - the query to satisfy
   * @param k - the maximum number of results
   * @param options - per-call overrides
   * @returns the best `k` chunks, best first
   */
  async best(query: RankingQuery, k?: number, options: RankOptions = {}): Promise<RankedChunk[]> {
    const candidates = await this._source.search(query);
    return this.topK(candidates, query, k, options);
  }

  /**
   * Rank an already-fetched pool of candidates.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param options - per-call overrides
   * @returns the ranked chunks, best first
   */
  rank(chunks: readonly ChunkCandidate[], query: RankingQuery, options: RankOptions = {}): RankedChunk[] {
    return this._adapter.rank(chunks, query, this._mergedOptions(options));
  }

  /**
   * Return only the top `k` results from an already-fetched pool.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param k - the maximum number of results
   * @param options - per-call overrides
   * @returns the best `k` chunks, best first
   */
  topK(
    chunks: readonly ChunkCandidate[],
    query: RankingQuery,
    k?: number,
    options: RankOptions = {},
  ): RankedChunk[] {
    return this._adapter.topK(chunks, query, k, this._mergedOptions(options));
  }

  /**
   * Score a single chunk against a query.
   *
   * @param chunk - the candidate chunk
   * @param query - the query to score against
   * @param options - per-call overrides
   * @returns the {@link RankScore}
   */
  score(chunk: ChunkCandidate, query: RankingQuery, options: RankOptions = {}): RankScore {
    return this._ranker.score(chunk, query, this._mergedOptions(options));
  }

  /**
   * Aggregate statistics for the retriever.
   *
   * @returns a {@link RankingStats} snapshot
   */
  stats(): RankingStats {
    return this._adapter.stats();
  }

  /**
   * Merge per-call options over the retriever's configured defaults.
   *
   * @param options - the per-call options
   * @returns options with weights/topK/threshold defaults filled in
   */
  private _mergedOptions(options: RankOptions): RankOptions {
    const mergedWeights = { ...this._options.weights, ...options.weights };
    return {
      ...options,
      weights:
        mergedWeights && Object.keys(mergedWeights).length > 0 ? mergedWeights : undefined,
      topK: options.topK ?? this._options.defaultTopK,
      threshold: options.threshold ?? this._options.defaultThreshold,
    };
  }
}