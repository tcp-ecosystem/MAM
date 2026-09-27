/**
 * Integration — the adapter surface of the Retrieval layer: a uniform
 * {@link Retriever} interface, a {@link KnowledgeRetrieverAdapter} that wraps a
 * {@link KnowledgeRetriever} behind that interface with cache lifecycle
 * management, and a standalone {@link HybridRetriever} that blends lexical,
 * TF-IDF and dense-vector scores.
 *
 * The rest of the retrieval layer is deliberately internal: `store.ts`,
 * `index.ts`, `retrieval.ts` and `lifecycle.ts` each solve one focused problem.
 * This module is the *integration layer* that consumers and frameworks actually
 * import, because it presents three things the rest of the system wants:
 *
 * 1. **A tiny stable contract** — {@link Retriever} (`search` / `recall` /
 *    `topK` / `stats`). Anything that consumes retrieval — an agent, a
 *    chat-completion tool, a CLI — can program against this one interface and
 *    be satisfied by any implementation, which is what makes the layer
 *    swappable.
 * 2. **A battery-included adapter** — {@link KnowledgeRetrieverAdapter}
 *    wires the pieces together for you: it constructs a
 *    {@link KnowledgeRetriever}, seeds it from optional initial chunks, fronts
 *    it with a {@link RetrievalLifecycle}-managed cache (TTL sweeps + bounded
 *    pruning), exposes `add`/`remove`/`clear` for live corpus maintenance and
 *    `dispose` for shutdown. {@link createRetrieverAdapter} is the one-line
 *    factory.
 * 3. **A vector-capable hybrid** — {@link HybridRetriever} scores chunks with
 *    configurable weights over three components: literal lexical overlap, TF-IDF
 *    cosine, and — when chunks carry dense embedding `vector`s and an embedder
 *    is supplied — true vector cosine. This is the drop-in for teams that
 *    already have embeddings and want to blend them with classical retrieval.
 *
 * @packageDocumentation
 * @module retrieval/integration
 */

import { RetrievalIndex } from './index.js';
import { RetrievalLifecycle } from './lifecycle.js';
import { KnowledgeRetriever, lexicalOverlap } from './retrieval.js';
import { RetrievalStore } from './store.js';
import type { StoreChunkInput } from './store.js';
import { clampScore } from './types.js';
import type {
  HybridWeights,
  RetrievedChunk,
  RetrievalConfig,
  RetrievalOptions,
  RetrievalQuery,
  RetrievalResult,
  RetrievalStats,
  Timestamp,
} from './types.js';

/**
 * The uniform retrieval contract consumed by the rest of the knowledge engine.
 *
 * Implementations may be pure (classical TF-IDF + lexical) or hybrid (also
 * blending dense vectors); consumers should not need to know which.
 */
export interface Retriever {
  /**
   * Run a full search and return the ranked result envelope.
   *
   * @param query - the query text or a structured {@link RetrievalQuery}
   * @param options - per-call overrides
   * @returns a {@link RetrievalResult}
   */
  search(query: string | RetrievalQuery, options?: RetrievalOptions): RetrievalResult;

  /**
   * Recall-style search: query text blended with additional context.
   *
   * @param query - the primary query
   * @param context - additional context to blend in
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  recall(query: string, context: string, options?: RetrievalOptions): RetrievedChunk[];

  /**
   * Return the top `k` chunks for a query.
   *
   * @param query - the query
   * @param k - number of results
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  topK(query: string | RetrievalQuery, k: number, options?: RetrievalOptions): RetrievedChunk[];

  /**
   * Aggregate statistics about the retriever and its corpus.
   *
   * @returns a {@link RetrievalStats} summary
   */
  stats(): RetrievalStats;
}

/**
 * The asynchronous analogue of {@link Retriever}, for retrievers whose scoring
 * pipeline awaits an external embedder (e.g. a model-backed embedding service).
 */
export interface AsyncRetriever {
  /**
   * Run a full search and return the ranked result envelope.
   *
   * @param query - the query text or a structured {@link RetrievalQuery}
   * @param options - per-call overrides
   * @returns a promise of a {@link RetrievalResult}
   */
  search(
    query: string | RetrievalQuery,
    options?: RetrievalOptions,
  ): Promise<RetrievalResult>;

  /**
   * Recall-style search: query text blended with additional context.
   *
   * @param query - the primary query
   * @param context - additional context to blend in
   * @param options - per-call overrides
   * @returns a promise of ranked chunks, best first
   */
  recall(
    query: string,
    context: string,
    options?: RetrievalOptions,
  ): Promise<RetrievedChunk[]>;

  /**
   * Return the top `k` chunks for a query.
   *
   * @param query - the query
   * @param k - number of results
   * @param options - per-call overrides
   * @returns a promise of ranked chunks, best first
   */
  topK(
    query: string | RetrievalQuery,
    k: number,
    options?: RetrievalOptions,
  ): Promise<RetrievedChunk[]>;

  /**
   * Aggregate statistics about the retriever and its corpus.
   *
   * @returns a {@link RetrievalStats} summary
   */
  stats(): RetrievalStats;
}

/**
 * Configuration for {@link KnowledgeRetrieverAdapter} and
 * {@link createRetrieverAdapter}.
 *
 * Extends {@link RetrievalConfig} with seed chunks and a lifecycle sweep
 * interval.
 */
export interface RetrieverAdapterConfig extends RetrievalConfig {
  /** Optional chunks to seed the adapter's corpus with at construction. */
  readonly chunks?: readonly StoreChunkInput[];
  /** Interval (ms) between lifecycle cache sweeps. Defaults to the TTL. */
  readonly sweepIntervalMs?: number;
}

/**
 * A {@link Retriever} implementation that wraps a {@link KnowledgeRetriever},
 * fronts it with a {@link RetrievalLifecycle}-managed cache, and supports live
 * corpus maintenance.
 *
 * The adapter owns the retriever's cache instead of the retriever's internal
 * one: calls are delegated to the underlying retriever with `cache: false` and
 * results are stored in the lifecycle cache, which gives the adapter precise
 * control over TTL expiry, LRU pruning and query-targeted invalidation.
 *
 * @example
 * ```ts
 * const retriever = new KnowledgeRetrieverAdapter({
 *   chunks: [{ chunkId: 'm/1', sourceId: 'm', text: 'Back up first.' }],
 *   ttlMs: 30_000,
 * });
 * const result = retriever.search('how do I back up?');
 * retriever.add({ chunkId: 'm/2', sourceId: 'm', text: 'Then migrate.' });
 * retriever.dispose(); // stops lifecycle sweeps
 * ```
 */
export class KnowledgeRetrieverAdapter implements Retriever {
  /** The wrapped underlying retriever. */
  private readonly retriever: KnowledgeRetriever;

  /** The lifecycle managing the adapter's result cache. */
  private readonly lifecycle: RetrievalLifecycle;

  /** TTL (ms) applied to cached results. */
  private readonly ttlMs: number;

  /** Whether results are cached through the lifecycle. */
  private readonly cacheEnabled: boolean;

  /**
   * Construct an adapter.
   *
   * @param config - optional {@link RetrieverAdapterConfig}
   */
  constructor(config: RetrieverAdapterConfig = {}) {
    this.ttlMs = config.ttlMs ?? 60_000;
    this.cacheEnabled = config.cacheResults !== false;
    this.retriever = new KnowledgeRetriever({ ...config, cacheResults: false });
    this.lifecycle = new RetrievalLifecycle({
      ttlMs: this.ttlMs,
      sweepIntervalMs: config.sweepIntervalMs,
      maxEntries: config.maxCacheSize,
      now: config.now,
    });
    if (config.chunks && config.chunks.length > 0) {
      this.addMany(config.chunks);
    }
    this.lifecycle.start();
  }

  /**
   * Run a full search, serving from the lifecycle cache when possible.
   *
   * @param query - the query
   * @param options - per-call overrides
   * @returns a {@link RetrievalResult}
   */
  search(
    query: string | RetrievalQuery,
    options: RetrievalOptions = {},
  ): RetrievalResult {
    const key = this.retriever.cacheKey(query, options);
    if (this.cacheEnabled && options.cache !== false) {
      const hit = this.lifecycle.get<RetrievalResult>(key);
      if (hit) {
        return hit;
      }
    }
    const result = this.retriever.search(query, {
      ...options,
      cache: false,
    });
    if (this.cacheEnabled && options.cache !== false) {
      const text =
        typeof query === 'string' ? query : (query.text ?? '');
      this.lifecycle.register(key, result, this.ttlMs, text);
    }
    return result;
  }

  /**
   * Recall-style search with context blending.
   *
   * @param query - the primary query
   * @param context - additional context text
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  recall(
    query: string,
    context: string,
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    return this.retriever.recall(query, context, {
      ...options,
      cache: false,
    });
  }

  /**
   * Return the top `k` chunks for a query.
   *
   * @param query - the query
   * @param k - number of results
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  topK(
    query: string | RetrievalQuery,
    k: number,
    options: RetrievalOptions = {},
  ): RetrievedChunk[] {
    return this.search(query, { ...options, topK: k, threshold: 0 }).chunks.slice();
  }

  /**
   * Add a chunk to the adapter's corpus.
   *
   * @param input - the chunk to add
   */
  add(input: StoreChunkInput): void {
    this.retriever.addChunk(input);
  }

  /**
   * Add many chunks to the adapter's corpus.
   *
   * @param inputs - iterable of chunk inputs
   * @returns the number of chunks added
   */
  addMany(inputs: Iterable<StoreChunkInput>): number {
    return this.retriever.addMany(inputs);
  }

  /**
   * Remove a chunk from the adapter's corpus.
   *
   * @param chunkId - the chunk to remove
   * @returns `true` when removed
   */
  remove(chunkId: string): boolean {
    return this.retriever.removeChunk(chunkId);
  }

  /**
   * Clear the corpus (chunks and index), keeping the cache.
   */
  clear(): void {
    this.retriever.clear();
  }

  /**
   * Invalidate every cached answer for a given query.
   *
   * @param query - the query whose cached results should be dropped
   * @returns the number of entries removed
   */
  invalidate(query: string): number {
    return this.lifecycle.clearQuery(query);
  }

  /**
   * Drop every cached result.
   *
   * @returns the number of entries removed
   */
  clearCache(): number {
    return this.lifecycle.clear();
  }

  /**
   * Shut the adapter down: stop lifecycle sweeps and clear the cache.
   */
  dispose(): void {
    this.lifecycle.stop();
    this.lifecycle.clear();
  }

  /**
   * The wrapped underlying {@link KnowledgeRetriever}.
   */
  get underlying(): KnowledgeRetriever {
    return this.retriever;
  }

  /**
   * Aggregate statistics; the `cachedQueries` figure reflects the lifecycle
   * cache the adapter manages.
   *
   * @returns a {@link RetrievalStats} summary
   */
  stats(): RetrievalStats {
    const base = this.retriever.stats();
    return { ...base, cachedQueries: this.lifecycle.size };
  }

  /**
   * Human-readable summary for logging.
   *
   * @returns e.g. `"KnowledgeRetrieverAdapter(chunks=12, cached=4)"`
   */
  inspect(): string {
    return `KnowledgeRetrieverAdapter(chunks=${this.retriever.size}, cached=${
      this.lifecycle.size
    })`;
  }
}

/**
 * One-line factory for a configured {@link KnowledgeRetrieverAdapter}.
 *
 * @param config - optional {@link RetrieverAdapterConfig}
 * @returns a ready-to-use {@link Retriever}
 */
export function createRetrieverAdapter(
  config: RetrieverAdapterConfig = {},
): Retriever {
  return new KnowledgeRetrieverAdapter(config);
}

/**
 * Configuration for the {@link HybridRetriever}.
 *
 * The three weight fields control the blend of lexical overlap, TF-IDF cosine
 * and dense-vector cosine. Weights do not need to sum to `1`; the retriever
 * normalises over the components that actually contribute for each chunk.
 */
export interface HybridRetrieverConfig {
  /** Weight of the lexical (literal token overlap) component. Defaults to `1`. */
  readonly lexicalWeight?: number;
  /** Weight of the dense-vector cosine component. Defaults to `1`. */
  readonly vectorWeight?: number;
  /** Weight of the TF-IDF cosine component. Defaults to `1`. */
  readonly tfidfWeight?: number;
  /** Weight of the context signal in recall-style queries. Defaults to `0.5`. */
  readonly contextWeight?: number;
  /** Default maximum results when the caller omits `topK`. Defaults to `10`. */
  readonly defaultTopK?: number;
  /** Default minimum score floor. Defaults to `0`. */
  readonly defaultThreshold?: number;
  /** Enable sub-linear TF normalisation. Defaults to `true`. */
  readonly sublinearTf?: boolean;
  /** Enable case-sensitive tokenization. Defaults to `false`. */
  readonly caseSensitive?: boolean;
  /** Replacement stop-word list (defaults to the built-in English list). */
  readonly stopWords?: readonly string[];
  /** Minimum token length in code units. Defaults to `2`. */
  readonly minTokenLength?: number;
  /** Maximum tokens kept per document; `0` disables the cap. */
  readonly maxTokensPerDocument?: number;
  /**
   * Embedder used to produce a dense query vector for the vector component.
   * When omitted (or when chunks carry no `vector`), the vector component is
   * skipped for the affected chunks.
   */
  readonly embed?: (text: string) => readonly number[] | Promise<readonly number[]>;
  /** Clock used for timestamps; injectable for deterministic tests. */
  readonly now?: () => Timestamp;
}

/**
 * Per-chunk breakdown of a {@link HybridScoredChunk}'s blended score.
 */
export interface HybridScoreBreakdown {
  /** Lexical overlap component in `[0, 1]`. */
  readonly lexical: number;
  /** Dense-vector cosine component in `[0, 1]` (0 when no vectors present). */
  readonly vector: number;
  /** TF-IDF cosine component in `[0, 1]`. */
  readonly tfidf: number;
  /** The blended total in `[0, 1]`. */
  readonly total: number;
}

/**
 * A {@link RetrievedChunk} enriched with its hybrid score breakdown.
 */
export interface HybridScoredChunk extends RetrievedChunk {
  /** Component-by-component score breakdown. */
  readonly breakdown: HybridScoreBreakdown;
}

/**
 * A standalone hybrid retriever that blends lexical overlap, TF-IDF cosine and
 * dense-vector cosine with configurable weights.
 *
 * Unlike {@link KnowledgeRetrieverAdapter} (which is a cache-managed facade
 * over the classical retriever), {@link HybridRetriever} is a full retriever in
 * its own right and is the natural choice when you already have dense
 * embeddings. Give it chunks that carry `vector` fields plus an `embed`
 * function for the query side, and it will blend all three signals per chunk.
 *
 * {@link HybridRetriever.search} is **asynchronous** because the query-side
 * embedder may be async (as is common with model-backed embedding services).
 *
 * @example
 * ```ts
 * const retriever = new HybridRetriever(
 *   {
 *     lexicalWeight: 1,
 *     tfidfWeight: 1,
 *     vectorWeight: 2,
 *     embed: async (text) => myEmbeddingService.embed(text),
 *   },
 *   [
 *     { chunkId: 'm/1', sourceId: 'm', text: 'Back up before migrating.',
 *       vector: [0.1, 0.9, ...] },
 *   ],
 * );
 * const result = await retriever.search('backup procedure');
 * ```
 */
export class HybridRetriever implements AsyncRetriever {
  /** Chunk store backing the hybrid retriever. */
  private readonly store: RetrievalStore;

  /** Term index providing tokenization and TF-IDF scoring. */
  private readonly index: RetrievalIndex;

  /** Current blend weights. */
  private readonly weights: {
    lexical: number;
    vector: number;
    tfidf: number;
    context: number;
  };

  /** Default top-K when the caller omits it. */
  private readonly defaultTopK: number;

  /** Default threshold when the caller omits it. */
  private readonly defaultThreshold: number;

  /** Optional query-side embedder. */
  private readonly embed: ((text: string) => readonly number[] | Promise<readonly number[]>) | undefined;

  /** Injectable clock. */
  private readonly now: () => Timestamp;

  /** Query counter for stats. */
  private queries = 0;

  /** Epoch-ms time the retriever was constructed. */
  private readonly createdAt: Timestamp;

  /**
   * Construct a hybrid retriever.
   *
   * @param config - optional {@link HybridRetrieverConfig}
   * @param initial - optional chunks to seed the corpus with
   */
  constructor(
    config: HybridRetrieverConfig = {},
    initial?: readonly StoreChunkInput[],
  ) {
    this.weights = {
      lexical: config.lexicalWeight ?? 1,
      vector: config.vectorWeight ?? 1,
      tfidf: config.tfidfWeight ?? 1,
      context: config.contextWeight ?? 0.5,
    };
    this.defaultTopK = config.defaultTopK ?? 10;
    this.defaultThreshold = config.defaultThreshold ?? 0;
    this.embed = config.embed;
    this.now = config.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.store = new RetrievalStore(undefined, { now: this.now });
    this.index = new RetrievalIndex({
      sublinearTf: config.sublinearTf,
      caseSensitive: config.caseSensitive,
      stopWords: config.stopWords,
      minTokenLength: config.minTokenLength,
      maxTokensPerDocument: config.maxTokensPerDocument,
    });
    if (initial && initial.length > 0) {
      this.seed(initial);
    }
  }

  /**
   * Seed the corpus with many chunks at once.
   *
   * @param chunks - the chunks to add
   * @returns the number of chunks added
   */
  seed(chunks: readonly StoreChunkInput[]): number {
    let count = 0;
    for (const chunk of chunks) {
      this.add(chunk);
      count += 1;
    }
    return count;
  }

  /**
   * Add a single chunk to the corpus.
   *
   * @param input - the chunk to add
   */
  add(input: StoreChunkInput): void {
    const chunk = this.store.put(input);
    this.index.indexText(chunk.chunkId, chunk.text);
  }

  /**
   * Remove a chunk from the corpus.
   *
   * @param chunkId - the chunk to remove
   * @returns `true` when removed
   */
  remove(chunkId: string): boolean {
    const removed = this.store.delete(chunkId);
    this.index.removeEntry(chunkId);
    return removed;
  }

  /**
   * Clear the entire corpus.
   */
  clear(): void {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Number of chunks in the corpus.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Update the blend weights at runtime.
   *
   * @param weights - partial weight overrides
   * @returns `this` for chaining
   */
  setWeights(weights: Partial<typeof this.weights>): this {
    if (weights.lexical !== undefined) {
      this.weights.lexical = weights.lexical;
    }
    if (weights.vector !== undefined) {
      this.weights.vector = weights.vector;
    }
    if (weights.tfidf !== undefined) {
      this.weights.tfidf = weights.tfidf;
    }
    if (weights.context !== undefined) {
      this.weights.context = weights.context;
    }
    return this;
  }

  /**
   * Read the current blend weights.
   *
   * @returns the effective weights
   */
  getWeights(): Readonly<{ lexical: number; vector: number; tfidf: number; context: number }> {
    return { ...this.weights };
  }

  /**
   * Static cosine similarity between two dense vectors.
   *
   * @param a - first vector
   * @param b - second vector
   * @returns cosine similarity in `[0, 1]` (0 when either vector is empty)
   */
  static cosine(a: readonly number[], b: readonly number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Score a single chunk against a query, returning a blended breakdown.
   *
   * The blended total normalises over the components that *contribute* for
   * this chunk: if the chunk carries no `vector` (or no embedder is set), the
   * vector weight is excluded from the denominator so the corpus is never
   * penalised for lacking embeddings.
   *
   * @param chunk - the candidate chunk
   * @param query - the query
   * @returns a scored chunk with its breakdown
   */
  async scoreChunk(
    chunk: RetrievedChunk,
    query: string | RetrievalQuery,
  ): Promise<HybridScoredChunk> {
    const text = typeof query === 'string' ? query : (query.text ?? '');
    const qTokens = this.index.tokenize(text);
    const cTokens = this.index.tokenize(chunk.text);
    const lexical = lexicalOverlap(qTokens, cTokens);

    const qVector = this.index.computeVector(text);
    const cVector = this.index.computeVector(chunk.text);
    const tfidf = this.index.similarity(qVector, cVector);

    let vector = 0;
    const vectorUsable = !!this.embed && !!chunk.vector && chunk.vector.length > 0;
    if (vectorUsable && this.embed) {
      const queryVector = await this.embed(text);
      vector = HybridRetriever.cosine(queryVector, chunk.vector ?? []);
    }

    const parts: Array<{ score: number; weight: number }> = [];
    if (this.weights.lexical > 0) {
      parts.push({ score: lexical, weight: this.weights.lexical });
    }
    if (this.weights.tfidf > 0) {
      parts.push({ score: tfidf, weight: this.weights.tfidf });
    }
    if (vectorUsable && this.weights.vector > 0) {
      parts.push({ score: vector, weight: this.weights.vector });
    }

    const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
    const total =
      weightSum > 0
        ? parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
          weightSum
        : 0;
    const score = clampScore(total);
    const reason = parts
      .map((part, i) => {
        const name =
          i === 0 && this.weights.lexical > 0
            ? 'lexical'
            : i === 1 && this.weights.tfidf > 0
              ? 'tfidf'
              : 'vector';
        return `${name} ${part.score.toFixed(3)}`;
      })
      .join(' + ');

    return {
      ...chunk,
      score,
      reason,
      breakdown: { lexical, vector, tfidf, total: score },
    };
  }

  /**
   * Run a full hybrid search over the corpus.
   *
   * @param query - the query
   * @param options - per-call overrides (top-K, threshold, source/tag filters)
   * @returns a {@link RetrievalResult}
   */
  async search(
    query: string | RetrievalQuery,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const started = this.now();
    this.queries += 1;
    const q = typeof query === 'string' ? { text: query } : query;
    const topK = options.topK ?? this.defaultTopK;
    const threshold = options.threshold ?? this.defaultThreshold;

    const candidates = this.store.filter({
      sourceId: options.sourceId,
      tags: options.tags,
      tagMode: options.tagMode,
    });
    const candidateCount = candidates.length;

    const scored: HybridScoredChunk[] = [];
    for (const chunk of candidates) {
      scored.push(await this.scoreChunk(chunk, q));
    }
    scored.sort((a, b) => b.score - a.score);

    const passed = scored.filter((chunk) => chunk.score >= threshold);
    const capped = topK > 0 ? passed.slice(0, topK) : passed;
    const ranked = capped.map((chunk, rank) => ({ ...chunk, rank }));

    const weights: HybridWeights = {
      lexical: this.weights.lexical,
      cosine: this.weights.tfidf,
      context: this.weights.context,
    };

    return {
      query: q,
      chunks: ranked,
      candidates: candidateCount,
      returned: ranked.length,
      removed: candidateCount - ranked.length,
      tookMs: this.now() - started,
      at: started,
      weights,
      cached: false,
    };
  }

  /**
   * Recall-style search: blend query and context text before scoring.
   *
   * The query and context are combined into a single signal (the context
   * tokenized with its weight applied) and scored against every candidate.
   *
   * @param query - the primary query
   * @param context - additional context text
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  async recall(
    query: string,
    context: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievedChunk[]> {
    const combined = `${query} ${context ?? ''}`;
    const result = await this.search(combined, options);
    return result.chunks.slice();
  }

  /**
   * Return the top `k` chunks for a query.
   *
   * @param query - the query
   * @param k - number of results
   * @param options - per-call overrides
   * @returns ranked chunks, best first
   */
  async topK(
    query: string | RetrievalQuery,
    k: number,
    options: RetrievalOptions = {},
  ): Promise<RetrievedChunk[]> {
    const result = await this.search(query, { ...options, topK: k, threshold: 0 });
    return result.chunks.slice();
  }

  /**
   * Aggregate statistics about the hybrid retriever.
   *
   * @returns a {@link RetrievalStats} summary (cached-query fields are 0/empty)
   */
  stats(): RetrievalStats {
    const storeStats = this.store.stats();
    const indexStats = this.index.stats();
    return {
      chunks: storeStats.chunks,
      sources: storeStats.sources,
      cachedQueries: 0,
      totalTerms: indexStats.totalTerms,
      distinctTerms: indexStats.distinctTerms,
      averageChunkLength: storeStats.averageChunkLength,
      queries: this.queries,
      cacheHits: 0,
      cacheMisses: this.queries,
      pruned: 0,
      lastQueryAt: this.queries > 0 ? this.createdAt : null,
      createdAt: this.createdAt,
    };
  }

  /**
   * Human-readable summary for logging.
   *
   * @returns e.g. `"HybridRetriever(chunks=12)"`
   */
  inspect(): string {
    return `HybridRetriever(chunks=${this.store.size})`;
  }
}