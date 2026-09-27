/**
 * Shared domain types for the Retrieval layer of the standalone MAM Knowledge
 * Engine.
 *
 * The Retrieval layer answers the question a knowledge consumer actually asks:
 * *"given this query, which chunks of stored knowledge are most relevant?"* It
 * sits between the **ingestion** side of the engine (which tokenizes, chunks
 * and embeds raw documents) and the **generation** side (which consumes
 * evidence), and it is responsible for three distinct concerns:
 *
 * 1. **Scoring** — hybrid relevance: TF-IDF cosine similarity against a
 *    corpus-wide {@link RankIndex} combined with lexical (literal token)
 *    overlap, each weighted by the caller.
 * 2. **Filtering** — narrowing candidates by score threshold, owning source or
 *    tag before ranking dominates.
 * 3. **Caching & lifecycle** — remembering recent results so repeated queries
 *    do not re-scan the corpus, and pruning/expiring those caches so memory
 *    stays bounded.
 *
 * The types in this module form the public contract shared by every other file
 * of the retrieval subsystem:
 *
 * - {@link RetrievedChunk} — a single knowledge chunk with its relevance
 *   score, produced by every retrieval entry point.
 * - {@link RetrievalQuery} — the caller's intent: text, optional tag/source
 *   filters, a result cap and a score floor.
 * - {@link RetrievalConfig} — construction/behaviour options for the
 *   {@link KnowledgeRetriever}, {@link ResultStore} and
 *   {@link RetrievalLifecycle}.
 * - {@link RetrievalStats} — aggregate counters describing a store or a
 *   retriever's behaviour.
 * - {@link RetrievalResult} — a full answer: the ranked chunks plus the query,
 *   timings and weight breakdown.
 * - {@link RetrievalOptions} — per-call overrides accepted by
 *   {@link KnowledgeRetriever.search} and friends.
 *
 * The types are deliberately framework-agnostic and JSON-serialisable: every
 * value here can round-trip through `JSON.stringify`/`JSON.parse` without loss,
 * so a {@link RetrievalResult} produced in one process can be persisted and
 * replayed by another.
 *
 * @packageDocumentation
 * @module retrieval/types
 */

/**
 * Unique identifier for a knowledge chunk.
 *
 * Chunk identifiers are opaque to the retrieval layer — any collision-free
 * scheme is acceptable. In practice they are usually the owning document's
 * source id combined with a chunk index (e.g. `"doc-42/chunk-3"`) or a UUID.
 * The retrieval layer never inspects the internal structure of a chunk id; it
 * only uses it as a map key and a correlation handle.
 */
export type ChunkId = string;

/**
 * Unique identifier for a source document.
 *
 * A *source* is the unit of provenance: the document, file or record a chunk
 * was carved from. Many {@link RetrievedChunk}s share one source id, which is
 * what makes {@link RetrievalQuery.sourceId} filtering — "only answer from this
 * manual" — cheap and reliable.
 */
export type SourceId = string;

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the retrieval layer use epoch milliseconds so they
 * interoperate cleanly with `Date`, `performance.now()`-derived clocks and
 * TTL arithmetic in {@link RetrievalLifecycle}.
 */
export type Timestamp = number;

/**
 * A term→count sparse vector representation of a document.
 *
 * Keys are normalized terms (lower-cased, stop-words removed) and values are
 * the raw term frequencies within that document. Sparse maps are used instead
 * of dense arrays so that corpora with large vocabularies stay memory-cheap.
 */
export interface DocumentVector {
  /** Maps a term to its raw frequency in the represented document. */
  readonly [term: string]: number;
}

/**
 * A single knowledge chunk together with its computed relevance score.
 *
 * Every retrieval entry point returns {@link RetrievedChunk}s. The base shape
 * carries the provenance (`chunkId`, `sourceId`, `text`), the relevance
 * `score` in `[0, 1]` and the positionally-assigned `rank`. Optional fields —
 * `source`, `tags`, `vector`, `metadata`, `reason` — travel along when the
 * caller supplied them, so downstream consumers can explain or re-rank without
 * re-fetching the original chunk.
 *
 * @example
 * ```ts
 * const chunk: RetrievedChunk = {
 *   chunkId: 'manual/3',
 *   sourceId: 'manual',
 *   text: 'Always back up before migrating.',
 *   score: 0.87,
 *   rank: 1,
 *   source: 'operations-manual.md',
 *   tags: ['backup', 'migration'],
 * };
 * ```
 */
export interface RetrievedChunk {
  /**
   * Unique identifier of the chunk. See {@link ChunkId}.
   */
  readonly chunkId: ChunkId;

  /**
   * Identifier of the source document the chunk was carved from.
   * See {@link SourceId}.
   */
  readonly sourceId: SourceId;

  /**
   * The chunk's textual content. This is the evidence a downstream consumer
   * will cite, so it is preserved verbatim by the retrieval layer.
   */
  readonly text: string;

  /**
   * Relevance score in `[0, 1]`. `1` is a perfect match; `0` means the chunk
   * shared no signal with the query and survived only as fallback filler.
   */
  readonly score: number;

  /**
   * Zero-based position of this chunk within its result list, assigned after
   * ranking. `undefined` until the chunk has been ranked.
   */
  readonly rank?: number;

  /**
   * Human-readable provenance label for the owning source (e.g. a file name),
   * when one was supplied at ingestion time.
   */
  readonly source?: string;

  /**
   * Optional set of tags associated with the chunk. Used by
   * {@link RetrievalQuery.tags} filtering and by {@link KnowledgeRetriever.filter}.
   */
  readonly tags?: readonly string[];

  /**
   * Optional dense embedding vector, when the caller supplies one. Consumed by
   * vector-aware scorers such as {@link HybridRetriever}.
   */
  readonly vector?: readonly number[];

  /**
   * Caller-owned structured metadata preserved verbatim (e.g. `title`,
   * `updatedAt`, `language`). The retrieval layer never interprets it.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /**
   * Human-readable explanation of *why* this chunk scored as it did (e.g.
   * `"cosine 0.62 + lexical 0.8"`). Useful for debugging and for explaining
   * retrieval decisions to users.
   */
  readonly reason?: string;
}

/**
 * A query against the knowledge corpus.
 *
 * The only strictly-required signal is intent; everything else is an optional
 * narrowing. A {@link RetrievalQuery} with only `tags` is a legal "give me
 * everything tagged X" request, and one with only `sourceId` is a scoped scan.
 * The retrieval layer normalises each field before hashing it into a cache key
 * (see {@link ResultStore}).
 */
export interface RetrievalQuery {
  /**
   * Free-text query string. Tokenized and scored against every candidate chunk
   * via hybrid TF-IDF cosine + lexical overlap.
   */
  readonly text?: string;

  /**
   * Optional tag filter. Chunks carrying **all** of these tags are kept when
   * `tagMode` is `'all'` (default), or any of them when it is `'any'`.
   */
  readonly tags?: readonly string[];

  /**
   * Optional scoping to a single source. When set, only chunks whose
   * `sourceId` equals this value are eligible.
   */
  readonly sourceId?: SourceId;

  /**
   * Maximum number of results to return. Defaults to
   * {@link RetrievalConfig.defaultTopK}.
   */
  readonly topK?: number;

  /**
   * Minimum relevance score a chunk must reach to be returned. Defaults to
   * {@link RetrievalConfig.defaultThreshold}.
   */
  readonly threshold?: number;

  /**
   * Tag matching mode applied to {@link RetrievalQuery.tags}. `'all'`
   * requires every tag; `'any'` accepts a single match. Defaults to `'all'`.
   */
  readonly tagMode?: 'all' | 'any';
}

/**
 * Per-call overrides for a single retrieval operation.
 *
 * These values override the constructor-time {@link RetrievalConfig} for one
 * invocation only. They are deliberately optional — the retriever falls back
 * to its configured defaults for anything the caller omits.
 */
export interface RetrievalOptions {
  /**
   * Maximum number of results to return. Overrides the configured
   * {@link RetrievalConfig.defaultTopK}. `0` means unbounded.
   */
  readonly topK?: number;

  /**
   * Minimum score floor. Overrides the configured
   * {@link RetrievalConfig.defaultThreshold}.
   */
  readonly threshold?: number;

  /**
   * Scoping to a single source. Equivalent to setting
   * {@link RetrievalQuery.sourceId}.
   */
  readonly sourceId?: SourceId;

  /**
   * Tag filter. Equivalent to setting {@link RetrievalQuery.tags}.
   */
  readonly tags?: readonly string[];

  /**
   * Tag matching mode (`'all'` | `'any'`). Defaults to `'all'`.
   */
  readonly tagMode?: 'all' | 'any';

  /**
   * Weight applied to the lexical (literal token overlap) score component in
   * the hybrid blend. Defaults to {@link RetrievalConfig.lexicalWeight}.
   */
  readonly lexicalWeight?: number;

  /**
   * Weight applied to the TF-IDF cosine score component in the hybrid blend.
   * Defaults to {@link RetrievalConfig.cosineWeight}.
   */
  readonly cosineWeight?: number;

  /**
   * When `false`, the result of this call is not written to the retriever's
   * {@link ResultStore} cache. Defaults to the configured
   * {@link RetrievalConfig.cacheResults}.
   */
  readonly cache?: boolean;

  /**
   * Optional additional context text blended into the query signal (used by
   * {@link KnowledgeRetriever.recall}). Higher weight is given to the primary
   * query text.
   */
  readonly context?: string;

  /**
   * Weight of the context signal when `context` is supplied. Defaults to
   * {@link RetrievalConfig.contextWeight}.
   */
  readonly contextWeight?: number;
}

/**
 * Hybrid relevance weights used when blending score components.
 *
 * The lexical and cosine weights do not need to sum to `1` — the retriever
 * normalises them internally. A `lexicalWeight` of `0` yields a pure vector
 * retriever; a `cosineWeight` of `0` yields a pure literal-overlap retriever.
 */
export interface HybridWeights {
  /**
   * Weight of the lexical (literal token overlap) component. Defaults to `1`.
   */
  readonly lexical: number;

  /**
   * Weight of the TF-IDF cosine component. Defaults to `1`.
   */
  readonly cosine: number;

  /**
   * Optional weight of an additional context signal in recall-style queries.
   * Defaults to `0.5` when context is supplied.
   */
  readonly context?: number;
}

/**
 * Configuration options for the retrieval layer.
 *
 * A {@link RetrievalConfig} may be supplied to {@link KnowledgeRetriever},
 * {@link ResultStore}, {@link RetrievalLifecycle} or
 * {@link createRetrieverAdapter} to tune tokenization, scoring weights,
 * caching and lifecycle behaviour. Every field is optional; the defaults are
 * chosen to be safe for general knowledge-corpus use.
 */
export interface RetrievalConfig {
  /**
   * Default maximum number of results returned by {@link KnowledgeRetriever.search}
   * when the caller omits `topK`. Defaults to `10`.
   */
  readonly defaultTopK?: number;

  /**
   * Default minimum score for a chunk to be returned. Defaults to `0`.
   */
  readonly defaultThreshold?: number;

  /**
   * Weight of the lexical (literal token overlap) score component in the
   * hybrid blend. Defaults to `1`.
   */
  readonly lexicalWeight?: number;

  /**
   * Weight of the TF-IDF cosine score component in the hybrid blend.
   * Defaults to `1`.
   */
  readonly cosineWeight?: number;

  /**
   * Weight of the context signal used by {@link KnowledgeRetriever.recall}.
   * Defaults to `0.5`.
   */
  readonly contextWeight?: number;

  /**
   * When `true` (default), term frequencies are normalised so that a term's
   * contribution is sub-linear (`1 + ln(tf)`); when `false` raw counts are
   * used. Sub-linear normalisation dampens the effect of a term repeated many
   * times in a single chunk.
   */
  readonly sublinearTf?: boolean;

  /**
   * When `false` (default), terms are lower-cased before indexing and querying.
   * Set to `true` only when case carries meaning in the corpus.
   */
  readonly caseSensitive?: boolean;

  /**
   * A list of stop-words removed during tokenization. Defaults to a small
   * built-in English list; supplying your own replaces it.
   */
  readonly stopWords?: readonly string[];

  /**
   * Minimum length (in code units) of a token to be kept. Defaults to `2`.
   * Shorter tokens — usually single characters — carry little signal.
   */
  readonly minTokenLength?: number;

  /**
   * Maximum number of tokens kept per document during indexing. `0` (default)
   * disables the cap. Guards against pathological chunk sizes.
   */
  readonly maxTokensPerDocument?: number;

  /**
   * When `true` (default), results of {@link KnowledgeRetriever.search} are
   * written to the retriever's {@link ResultStore} so repeated queries hit the
   * cache. Set to `false` for write-heavy, query-once workloads.
   */
  readonly cacheResults?: boolean;

  /**
   * Time-to-live in milliseconds for cached results before they are swept by
   * {@link RetrievalLifecycle}. Defaults to `60_000` (one minute).
   */
  readonly ttlMs?: number;

  /**
   * Maximum number of cached results retained by the {@link ResultStore}.
   * `0` (default) disables the cap.
   */
  readonly maxCacheSize?: number;

  /**
   * Default limit applied when the caller omits one. Defaults to `10`.
   */
  readonly defaultLimit?: number;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps. Injecting
   * a clock makes the layer deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate statistics describing a retrieval store or retriever.
 *
 * Returned by {@link ResultStore.stats}, {@link KnowledgeRetriever.stats},
 * {@link RetrievalLifecycle.stats} and {@link KnowledgeRetrieverAdapter.stats}.
 * Counters that track behaviour over time are monotonically increasing from
 * construction, while corpus-derived fields are computed on demand.
 */
export interface RetrievalStats {
  /**
   * Number of chunks currently registered with the retriever (or entries in
   * the store, for {@link ResultStore}).
   */
  readonly chunks: number;

  /**
   * Number of distinct source documents represented by the chunks.
   */
  readonly sources: number;

  /**
   * Number of cached query entries currently held (store-backed).
   */
  readonly cachedQueries: number;

  /**
   * Total number of term occurrences across the indexed corpus.
   */
  readonly totalTerms: number;

  /**
   * Number of distinct terms in the corpus vocabulary.
   */
  readonly distinctTerms: number;

  /**
   * Average chunk text length in code units.
   */
  readonly averageChunkLength: number;

  /**
   * Total number of retrieval queries processed since construction.
   */
  readonly queries: number;

  /**
   * Number of cache hits (a cached result was served) since construction.
   */
  readonly cacheHits: number;

  /**
   * Number of cache misses (a query was executed from scratch) since
   * construction.
   */
  readonly cacheMisses: number;

  /**
   * Total number of results pruned/expired by the lifecycle since construction.
   */
  readonly pruned: number;

  /**
   * Epoch-millisecond time of the most recent query, or `null` if none.
   */
  readonly lastQueryAt: Timestamp | null;

  /**
   * Epoch-millisecond time the store/retriever was constructed.
   */
  readonly createdAt: Timestamp;
}

/**
 * A complete answer to a {@link RetrievalQuery}.
 *
 * Wraps the ranked {@link RetrievedChunk}s with the query that produced them,
 * the timing of the operation, candidate/returned counts and the effective
 * hybrid weights. Consumers that need to attribute a result (for logging,
 * caching or re-ranking) should carry the whole {@link RetrievalResult}.
 */
export interface RetrievalResult {
  /**
   * The query this result answers (normalised form).
   */
  readonly query: RetrievalQuery;

  /**
   * The ranked chunks, best first. Each carries a `rank` and a `score` in
   * `[0, 1]`.
   */
  readonly chunks: readonly RetrievedChunk[];

  /**
   * Number of candidates considered *before* filtering (the pre-threshold
   * universe), useful for diagnosing over-restrictive thresholds.
   */
  readonly candidates: number;

  /**
   * Number of chunks returned after filtering and top-K truncation.
   */
  readonly returned: number;

  /**
   * Number of chunks removed by threshold/source/tag filters.
   */
  readonly removed: number;

  /**
   * Wall-clock time the search took, in milliseconds.
   */
  readonly tookMs: number;

  /**
   * Epoch-millisecond time at which the search ran.
   */
  readonly at: Timestamp;

  /**
   * The effective hybrid weights applied to produce the blended scores.
   */
  readonly weights: HybridWeights;

  /**
   * `true` when this result was served from the cache rather than recomputed.
   */
  readonly cached: boolean;
}

/**
 * Discriminator for lifecycle events emitted by {@link RetrievalLifecycle}.
 */
export type RetrievalEventType = 'cache' | 'prune' | 'sweep' | 'reset';

/**
 * Payload emitted by the {@link RetrievalLifecycle} event emitter.
 *
 * Every event carries the discriminator, a timestamp and an operation-specific
 * payload. `'cache'` fires when a result is written to (or read from) the
 * store; `'prune'` fires when entries are removed; `'sweep'` fires after a TTL
 * sweep pass; `'reset'` fires when the lifecycle is reset.
 */
export interface RetrievalLifecycleEvent {
  /**
   * The lifecycle operation that fired.
   */
  readonly type: RetrievalEventType;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of entries affected by the operation.
   */
  readonly count: number;

  /**
   * Query keys involved in the operation, when applicable.
   */
  readonly keys?: readonly string[];

  /**
   * Operation-specific detail (e.g. `'ttl-expired'` for a sweep removal).
   */
  readonly detail?: unknown;
}

/**
 * Default maximum number of results when the caller omits `topK`.
 */
export const DEFAULT_TOP_K = 10;

/**
 * Default minimum score a chunk must reach to be returned.
 */
export const DEFAULT_THRESHOLD = 0;

/**
 * Default time-to-live (ms) for cached retrieval results.
 */
export const DEFAULT_TTL_MS = 60_000;

/**
 * Default weight of the lexical score component in the hybrid blend.
 */
export const DEFAULT_LEXICAL_WEIGHT = 1;

/**
 * Default weight of the TF-IDF cosine score component in the hybrid blend.
 */
export const DEFAULT_COSINE_WEIGHT = 1;

/**
 * Default weight of the context signal in recall-style queries.
 */
export const DEFAULT_CONTEXT_WEIGHT = 0.5;

/**
 * Normalise free text for comparison and hashing.
 *
 * Trims surrounding whitespace and collapses internal runs of whitespace to a
 * single space. Optionally lower-cases the result. Used to derive canonical
 * query keys in {@link ResultStore} and to canonicalise text before scoring.
 *
 * @param text - the raw text to normalise
 * @param lower - when `true` (default), the result is lower-cased
 * @returns the normalised text, or `''` when `text` is falsy
 */
export function normalizeText(text: string | undefined, lower = true): string {
  if (!text) {
    return '';
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return lower ? collapsed.toLowerCase() : collapsed;
}

/**
 * Narrow a value to {@link RetrievedChunk} by structural inspection.
 *
 * Useful for guards in generic pipelines that may receive either a chunk or a
 * plain record. Checks the four required fields only.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link RetrievedChunk}
 */
export function isRetrievedChunk(value: unknown): value is RetrievedChunk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<RetrievedChunk>;
  return (
    typeof record.chunkId === 'string' &&
    typeof record.sourceId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score)
  );
}

/**
 * Clamp a number into `[min, max]`.
 *
 * @param value - the value to clamp
 * @param min - inclusive lower bound
 * @param max - inclusive upper bound
 * @returns the clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Clamp a score into the canonical `[0, 1]` range.
 *
 * Scores from hybrid blends should always lie in `[0, 1]`; this guard repairs
 * floating-point drift and rejects negative or super-unity inputs.
 *
 * @param score - the raw score
 * @returns the clamped score
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return clamp(score, 0, 1);
}