/**
 * Shared domain types for the Ranking layer of the standalone MAM Knowledge
 * Engine.
 *
 * The Ranking layer answers the follow-up question every retrieval pipeline
 * poses after candidates have been fetched: *"now that I have a pool of
 * knowledge chunks, which ones deserve to be surfaced first, and why?"* It sits
 * between the **Retrieval** layer (which produces candidate chunks) and the
 * **Generation** side (which consumes evidence), and is responsible for four
 * distinct concerns:
 *
 * 1. **Scoring** — hybrid relevance: BM25-style term weighting, TF-IDF cosine
 *    similarity, literal lexical overlap, recency decay and authority
 *    normalisation, each blended by the caller's {@link RankingWeights}.
 * 2. **Indexing** — a lightweight {@link RankIndex} of document-frequency and
 *    term statistics used to compute IDF and BM25 components cheaply.
 * 3. **Caching & lifecycle** — remembering ranked results per query so repeated
 *    requests do not re-scan the candidate pool, and pruning/expiring those
 *    caches so memory stays bounded.
 * 4. **Integration** — adapters and facade retrievers that wrap an arbitrary
 *    retrieval source and decorate its output with ranked, explainable scores.
 *
 * The types in this module form the public contract shared by every other file
 * of the ranking subsystem:
 *
 * - {@link ChunkCandidate} — the minimal shape of a chunk that *can* be ranked.
 * - {@link RankedChunk} — a chunk together with its blended score, rank and
 *   explanation.
 * - {@link RankingQuery} — the caller's intent: free text plus optional
 *   filters and caps.
 * - {@link RankOptions} — per-call overrides for a single ranking operation.
 * - {@link RankingWeights} — the four-way blend (lexical, vector, recency,
 *   authority) that controls how the final score is composed.
 * - {@link RankingConfig} — construction/behaviour options shared by the
 *   ranker, store and lifecycle.
 * - {@link RankingStats} — aggregate counters describing the subsystem.
 * - {@link RankingResult} — a full answer: ranked chunks plus the query,
 *   timings and weight breakdown.
 *
 * The types are deliberately framework-agnostic and JSON-serialisable: every
 * value here can round-trip through `JSON.stringify`/`JSON.parse` without loss,
 * so a {@link RankingResult} produced in one process can be persisted and
 * replayed by another. The module also exports the pure helpers
 * ({@link tokenize}, {@link buildTermVector}, {@link cosineSimilarity}, …) that
 * the rest of the layer composes, keeping scoring deterministic and unit
 * testable.
 *
 * @packageDocumentation
 * @module ranking/types
 */

/**
 * Unique identifier for a knowledge chunk.
 *
 * Chunk identifiers are opaque to the ranking layer — any collision-free scheme
 * is acceptable. In practice they are usually the owning document's source id
 * combined with a chunk index (e.g. `"doc-42/chunk-3"`) or a UUID. The ranking
 * layer only uses them as map keys and correlation handles.
 */
export type ChunkId = string;

/**
 * Unique identifier for a source document.
 *
 * A *source* is the unit of provenance: the document, file or record a chunk
 * was carved from. Many {@link RankedChunk}s share one source id, which is
 * what makes {@link RankingQuery.sourceId} scoping — "only rank evidence from
 * this manual" — cheap and reliable.
 */
export type SourceId = string;

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the ranking layer use epoch milliseconds so they
 * interoperate cleanly with `Date`, `performance.now()`-derived clocks, TTL
 * arithmetic in {@link RankingStore} and recency half-life decay.
 */
export type Timestamp = number;

/**
 * A term→count sparse vector representation of a document.
 *
 * Keys are normalised terms (lower-cased, stop-words removed) and values are
 * the raw term frequencies within that document. Sparse maps are used instead
 * of dense arrays so that corpora with large vocabularies stay memory-cheap.
 */
export interface DocumentVector {
  /** Maps a term to its raw frequency in the represented document. */
  readonly [term: string]: number;
}

/**
 * Alias for {@link DocumentVector}: a plain term-frequency record.
 *
 * `DocumentVector` is the canonical "bag of words" produced by
 * {@link buildTermVector}; this alias exists so callers that want to speak in
 * terms of vectors rather than documents can do so without ceremony.
 */
export type TermVector = DocumentVector;

/**
 * Anything cosine-similarity can be computed over.
 *
 * Both plain records (`{ term: tf }`) and `ReadonlyMap<string, number>`
 * instances are accepted by {@link cosineSimilarity}, so callers can mix the
 * sparse-record representation with a `Map`-backed one without converting.
 */
export type TermVectorLike = DocumentVector | ReadonlyMap<string, number>;

/**
 * The minimal shape of a chunk that *can* be ranked.
 *
 * A {@link ChunkCandidate} carries everything {@link KnowledgeRanker.score}
 * needs to produce a blended score: provenance, the raw text (for
 * tokenization), and optional signals such as an embedding `vector`, `tags`
 * for filtering and structured `metadata` from which recency and authority are
 * read. It deliberately has **no** `score`, `rank` or `reasons` — those are the
 * outputs of ranking, and appear on {@link RankedChunk}.
 *
 * @example
 * ```ts
 * const candidate: ChunkCandidate = {
 *   chunkId: 'manual/3',
 *   sourceId: 'manual',
 *   text: 'Always back up before migrating.',
 *   tags: ['backup', 'migration'],
 *   metadata: { updatedAt: 1700000000000, authority: 3.2 },
 * };
 * ```
 */
export interface ChunkCandidate {
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
   * will cite, so it is preserved verbatim by the ranking layer.
   */
  readonly text: string;

  /**
   * Human-readable provenance label for the owning source (e.g. a file name),
   * when one was supplied at ingestion time.
   */
  readonly source?: string;

  /**
   * Optional set of tags associated with the chunk. Used by
   * {@link RankingQuery.tags} filtering.
   */
  readonly tags?: readonly string[];

  /**
   * Optional dense embedding vector. When present *and* a query embedding is
   * supplied via {@link RankOptions.queryVector}, the vector score component
   * uses embedding cosine similarity instead of term-vector cosine.
   */
  readonly vector?: readonly number[];

  /**
   * Caller-owned structured metadata preserved verbatim. The ranking layer
   * reads two conventional keys from it — the recency timestamp
   * ({@link RankingConfig.recencyField}, default `updatedAt`) and the authority
   * value ({@link RankingConfig.authorityField}, default `authority`) — and
   * never interprets anything else.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A chunk together with its computed blended score.
 *
 * Every ranking entry point returns {@link RankedChunk}s. The base shape
 * carries the provenance (`chunkId`, `sourceId`, `text`), the blended `score`
 * in `[0, 1]`, the positionally-assigned `rank` and — when explanations are
 * enabled — an ordered list of human-readable `reasons` describing *why* the
 * chunk scored the way it did.
 */
export interface RankedChunk extends ChunkCandidate {
  /**
   * Blended relevance score in `[0, 1]`. `1` is a perfect match; `0` means the
   * chunk shared no usable signal with the query.
   */
  score: number;

  /**
   * One-based position of this chunk within its result list, assigned after
   * ranking. `1` is the best match. `undefined` until the chunk has been
   * ranked.
   */
  rank?: number;

  /**
   * Ordered, human-readable explanations of how the blended score was composed
   * (e.g. `"lexical=0.61 (bm25=0.42, overlap=0.80) w=1"`). Useful for
   * debugging and for explaining ranking decisions to users.
   */
  reasons?: string[];
}

/**
 * The four-way weighting blend used to compose a chunk's final score.
 *
 * Every component is a non-negative weight; they do **not** need to sum to `1`
 * because the ranker normalises the blend by the total weight. Setting a
 * component to `0` removes its contribution entirely — e.g. `{ lexical: 0,
 * vector: 1, recency: 0, authority: 0 }` yields a pure vector retriever.
 *
 * @example
 * ```ts
 * const weights: RankingWeights = { lexical: 1, vector: 1, recency: 0.5, authority: 0.2 };
 * ```
 */
export interface RankingWeights {
  /**
   * Weight of the lexical component — a blend of BM25-style term weighting and
   * literal token overlap. Defaults to `1`.
   */
  readonly lexical: number;

  /**
   * Weight of the vector component — TF-IDF term-vector cosine similarity (or
   * embedding cosine when a query embedding is supplied). Defaults to `1`.
   */
  readonly vector: number;

  /**
   * Weight of the recency component — exponential time-decay of the chunk's
   * `updatedAt` timestamp. Defaults to `0.25`.
   */
  readonly recency: number;

  /**
   * Weight of the authority component — the chunk's authority value scaled into
   * `[0, 1]`. Defaults to `0.1`.
   */
  readonly authority: number;
}

/**
 * Detailed breakdown of a single {@link RankScore}.
 *
 * Every component lives in `[0, 1]` before blending, and `total` is the
 * weight-normalised sum. The two lexical sub-signals (`bm25` and `overlap`)
 * are exposed separately so callers can debug exactly where a lexical score
 * came from.
 */
export interface ScoreBreakdown {
  /**
   * The combined lexical component in `[0, 1]` (BM25 normalisation and
   * overlap blended 50/50).
   */
  readonly lexical: number;

  /**
   * The vector component in `[0, 1]` — TF-IDF term cosine or embedding cosine.
   */
  readonly vector: number;

  /**
   * The recency component in `[0, 1]` — exponential decay of `updatedAt`.
   */
  readonly recency: number;

  /**
   * The authority component in `[0, 1]` — raw authority scaled to a fraction.
   */
  readonly authority: number;

  /**
   * The BM25-style sub-signal in `[0, 1]`, before it is blended with
   * `overlap` to form `lexical`.
   */
  readonly bm25: number;

  /**
   * The Dice-coefficient literal-overlap sub-signal in `[0, 1]`, before it is
   * blended with `bm25` to form `lexical`.
   */
  readonly overlap: number;

  /**
   * The final weight-normalised, clamped blended score in `[0, 1]`. This is
   * the value published as {@link RankedChunk.score}.
   */
  readonly total: number;
}

/**
 * The result of scoring a single chunk against a query.
 *
 * Returns both the blended `score` and the full {@link ScoreBreakdown}, plus
 * the human-readable `reasons` the ranker uses to explain its decision.
 */
export interface RankScore {
  /**
   * The blended, clamped score in `[0, 1]`.
   */
  readonly score: number;

  /**
   * The component-wise breakdown behind `score`.
   */
  readonly breakdown: ScoreBreakdown;

  /**
   * Ordered, human-readable explanations of the score composition.
   */
  readonly reasons: readonly string[];
}

/**
 * A query against the ranking subsystem.
 *
 * The only strictly-required signal is the free-text `text`; everything else
 * is an optional narrowing or cap. A {@link RankingQuery} with only `tags` is a
 * legal "rank everything tagged X" request, and one with only `sourceId` is a
 * scoped ranking pass.
 */
export interface RankingQuery {
  /**
   * Free-text query string. Tokenized and scored against every candidate chunk.
   */
  readonly text: string;

  /**
   * Optional maximum number of results to return. Defaults to
   * {@link RankingConfig.defaultTopK}.
   */
  readonly topK?: number;

  /**
   * Optional minimum blended score a chunk must reach to be returned. Defaults
   * to {@link RankingConfig.defaultThreshold}.
   */
  readonly threshold?: number;

  /**
   * Optional scoping to a single source. When set, only chunks whose
   * `sourceId` equals this value are eligible.
   */
  readonly sourceId?: SourceId;

  /**
   * Optional tag filter. Chunks carrying **all** of these tags are kept when
   * `tagMode` is `'all'` (default), or any of them when it is `'any'`.
   */
  readonly tags?: readonly string[];

  /**
   * Tag matching mode applied to {@link RankingQuery.tags}. `'all'` requires
   * every tag; `'any'` accepts a single match. Defaults to `'all'`.
   */
  readonly tagMode?: 'all' | 'any';
}

/**
 * Per-call overrides for a single ranking operation.
 *
 * These values override the constructor-time {@link RankingConfig} for one
 * invocation only. They are deliberately optional — the ranker falls back to
 * its configured defaults for anything the caller omits.
 */
export interface RankOptions {
  /**
   * Per-call weight overrides. Values supplied here override the configured
   * {@link RankingWeights}; omitted components fall through to the config.
   */
  readonly weights?: Partial<RankingWeights>;

  /**
   * Maximum number of results to return. Overrides the configured
   * {@link RankingConfig.defaultTopK}. `0` means unbounded.
   */
  readonly topK?: number;

  /**
   * Minimum score floor. Overrides the configured
   * {@link RankingConfig.defaultThreshold}.
   */
  readonly threshold?: number;

  /**
   * When `true` (default), {@link RankedChunk.reasons} are attached to ranked
   * chunks. Set to `false` to save allocation on high-throughput paths.
   */
  readonly includeReasons?: boolean;

  /**
   * Optional dense query embedding. When supplied *and* a candidate chunk
   * carries a {@link ChunkCandidate.vector}, the vector score component uses
   * embedding cosine similarity.
   */
  readonly queryVector?: readonly number[];

  /**
   * Optional additional context text blended into the query signal. Its tokens
   * are appended to the query's own tokens before scoring.
   */
  readonly context?: string;

  /**
   * Optional clock override used as "now" for recency decay and timing.
   * Defaults to the configured {@link RankingConfig.now}.
   */
  readonly now?: Timestamp;
}

/**
 * Construction/behaviour options for the ranking layer.
 *
 * A {@link RankingConfig} may be supplied to {@link KnowledgeRanker},
 * {@link RankingStore}, {@link RankingLifecycle}, {@link RankingAdapter} or
 * {@link ScoredRetriever} to tune tokenization, scoring weights, BM25
 * parameters, caching and lifecycle behaviour. Every field has a sensible
 * default (see {@link defaultRankingConfig}); callers only override what they
 * care about.
 */
export interface RankingConfig {
  /**
   * The default four-way blend. Defaults to `{ lexical: 1, vector: 1,
   * recency: 0.25, authority: 0.1 }` (see {@link DEFAULT_RANKING_WEIGHTS}).
   */
  readonly weights: RankingWeights;

  /**
   * Default maximum number of results when the caller omits `topK`. Defaults
   * to {@link DEFAULT_TOP_K} (`10`).
   */
  readonly defaultTopK: number;

  /**
   * Default minimum blended score for a chunk to be returned. Defaults to
   * {@link DEFAULT_THRESHOLD} (`0`).
   */
  readonly defaultThreshold: number;

  /**
   * BM25 term-frequency saturation parameter `k1`. Defaults to `1.2`.
   * Higher values make repeated terms contribute more slowly.
   */
  readonly bm25K1: number;

  /**
   * BM25 document-length normalisation parameter `b`. Defaults to `0.75`.
   * `b = 0` disables length normalisation entirely.
   */
  readonly bm25B: number;

  /**
   * Laplace-style smoothing added to both numerator and denominator of the IDF
   * ratio. Defaults to `0.5`.
   */
  readonly idfSmoothing: number;

  /**
   * When `true` (default), term frequencies are normalised so that a term's
   * contribution is sub-linear (`1 + ln(tf)`); when `false` raw counts are
   * used.
   */
  readonly sublinearTf: boolean;

  /**
   * When `false` (default), terms are lower-cased before tokenization. Set to
   * `true` only when case carries meaning in the corpus.
   */
  readonly caseSensitive: boolean;

  /**
   * A list of stop-words removed during tokenization. Defaults to the built-in
   * {@link DEFAULT_STOP_WORDS}; supplying your own replaces it.
   */
  readonly stopWords: readonly string[];

  /**
   * Minimum length (in code units) of a token to be kept. Defaults to `2`.
   */
  readonly minTokenLength: number;

  /**
   * Maximum number of tokens kept per chunk during tokenization. `0` (default)
   * disables the cap. Guards against pathological chunk sizes.
   */
  readonly maxTokensPerDocument: number;

  /**
   * Time-to-live in milliseconds for cached results before they are swept by
   * {@link RankingLifecycle}. Defaults to {@link DEFAULT_TTL_MS} (`60_000`).
   */
  readonly ttlMs: number;

  /**
   * Maximum number of cached results retained by the {@link RankingStore}.
   * Defaults to {@link DEFAULT_MAX_CACHE_SIZE} (`250`).
   */
  readonly maxCacheSize: number;

  /**
   * Interval in milliseconds between automatic TTL sweep passes while the
   * lifecycle is running. Defaults to {@link DEFAULT_SWEEP_INTERVAL_MS}
   * (`30_000`).
   */
  readonly sweepIntervalMs: number;

  /**
   * Half-life (milliseconds) of the recency decay. A chunk whose `updatedAt` is
   * one half-life old contributes 50% of its maximum recency. Defaults to 7
   * days ({@link DEFAULT_RECENCY_HALF_LIFE_MS}).
   */
  readonly recencyHalfLifeMs: number;

  /**
   * The metadata key holding the chunk's last-updated timestamp. Defaults to
   * {@link DEFAULT_RECENCY_FIELD} (`'updatedAt'`).
   */
  readonly recencyField: string;

  /**
   * The metadata key holding the chunk's authority value. Defaults to
   * {@link DEFAULT_AUTHORITY_FIELD} (`'authority'`).
   */
  readonly authorityField: string;

  /**
   * Authority value assumed when a chunk has none. Defaults to
   * {@link DEFAULT_AUTHORITY} (`0.5`).
   */
  readonly defaultAuthority: number;

  /**
   * Scale used to normalise raw authority into `[0, 1]`. A raw authority of
   * `authorityScale` maps to `1.0`. Defaults to {@link AUTHORITY_SCALE} (`5`).
   */
  readonly authorityScale: number;

  /**
   * Tiny constant guarding against division by zero in score blending and BM25
   * denominators. Defaults to {@link EPSILON}.
   */
  readonly epsilon: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the layer
   * deterministic under test.
   */
  readonly now: () => Timestamp;
}

/**
 * Aggregate statistics describing the ranking subsystem.
 *
 * Returned by {@link KnowledgeRanker.stats}, {@link RankingStore.stats},
 * {@link RankingLifecycle.stats}, {@link RankingAdapter.stats} and
 * {@link ScoredRetriever.stats}. Counters that track behaviour over time are
 * monotonically increasing from construction, while corpus-derived fields are
 * computed on demand.
 */
export interface RankingStats {
  /**
   * Number of chunks currently indexed by the {@link RankIndex}.
   */
  readonly chunks: number;

  /**
   * Number of distinct source documents represented by the indexed chunks.
   */
  readonly documents: number;

  /**
   * Number of distinct terms in the indexed vocabulary.
   */
  readonly distinctTerms: number;

  /**
   * Total number of term occurrences across the indexed corpus.
   */
  readonly totalTerms: number;

  /**
   * Average indexed document length in tokens.
   */
  readonly averageDocumentLength: number;

  /**
   * Number of cached query entries currently held (store-backed).
   */
  readonly cachedQueries: number;

  /**
   * Total number of ranking operations (queries) processed since construction.
   */
  readonly queries: number;

  /**
   * Number of cache hits (a cached result was served) since construction.
   */
  readonly cacheHits: number;

  /**
   * Number of cache misses (a result was computed from scratch) since
   * construction.
   */
  readonly cacheMisses: number;

  /**
   * Total number of chunks scored by the ranker since construction.
   */
  readonly ranked: number;

  /**
   * Total number of results pruned by the lifecycle/store since construction.
   */
  readonly pruned: number;

  /**
   * Total number of entries swept as expired by the lifecycle since
   * construction.
   */
  readonly swept: number;

  /**
   * Arithmetic mean of all blended scores produced since construction, or `0`
   * when nothing has been ranked yet.
   */
  readonly averageScore: number;

  /**
   * Highest blended score produced since construction, or `0`.
   */
  readonly topScore: number;

  /**
   * Epoch-millisecond time of the most recent query, or `null` if none.
   */
  readonly lastQueryAt: Timestamp | null;

  /**
   * Epoch-millisecond time the ranker/store was constructed.
   */
  readonly createdAt: Timestamp;
}

/**
 * A complete answer to a {@link RankingQuery}.
 *
 * Wraps the ranked {@link RankedChunk}s with the query that produced them, the
 * candidate/returned/removed counts, the timing of the operation and the
 * effective weight blend. Consumers that need to attribute a result (for
 * logging, caching or re-ranking) should carry the whole {@link RankingResult}.
 */
export interface RankingResult {
  /**
   * The query this result answers (normalised form).
   */
  readonly query: RankingQuery;

  /**
   * The ranked chunks, best first. Each carries a `rank` and a `score` in
   * `[0, 1]`.
   */
  readonly chunks: readonly RankedChunk[];

  /**
   * Number of candidates considered *before* threshold filtering.
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
   * Wall-clock time the ranking pass took, in milliseconds.
   */
  readonly tookMs: number;

  /**
   * Epoch-millisecond time at which the ranking pass ran.
   */
  readonly at: Timestamp;

  /**
   * The effective weight blend applied to produce the scores.
   */
  readonly weights: RankingWeights;

  /**
   * `true` when this result was served from the cache rather than recomputed.
   */
  readonly cached: boolean;
}

/**
 * Discriminator for lifecycle events emitted by {@link RankingLifecycle} and
 * forwarded from {@link RankingStore}.
 */
export type RankingEventType = 'cache' | 'prune' | 'sweep' | 'reset';

/**
 * Payload emitted by {@link RankingLifecycle} (and mirrored by
 * {@link RankingStore}).
 *
 * Every event carries the discriminator, a timestamp, an affected-entry count
 * and an operation-specific payload. `'cache'` fires when entries are written,
 * read, cleared or evicted; `'prune'` fires when entries are removed to
 * enforce the capacity cap; `'sweep'` fires after a TTL sweep pass; `'reset'`
 * fires when the lifecycle is reset.
 */
export interface RankingLifecycleEvent {
  /**
   * The lifecycle operation that fired.
   */
  readonly type: RankingEventType;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of entries affected by the operation.
   */
  readonly count: number;

  /**
   * Cache keys involved in the operation, when applicable.
   */
  readonly keys?: readonly string[];

  /**
   * Operation-specific detail (e.g. `{ op: 'evict', reason: 'lru' }` for a
   * cache eviction, or `{ target: 100 }` for a prune).
   */
  readonly detail?: unknown;
}

/**
 * The corpus-level context BM25 needs to score a single term.
 *
 * {@link KnowledgeRanker.bm25} accepts one of these so it can compute the IDF
 * and length-normalisation terms of the BM25 formula without coupling to a
 * specific index implementation. {@link RankIndex.bm25Context} produces one
 * bound to a live index.
 */
export interface Bm25Context {
  /**
   * Total number of documents in the corpus.
   */
  readonly documentCount: number;

  /**
   * Returns the number of documents containing the given term.
   */
  readonly documentFrequency: (term: string) => number;

  /**
   * Average document length (in tokens) across the corpus.
   */
  readonly avgDocumentLength: number;
}

/**
 * Options accepted by {@link tokenize}.
 */
export interface TokenizeOptions {
  /**
   * Stop-words removed from the output. Defaults to {@link DEFAULT_STOP_WORDS}.
   */
  readonly stopWords?: readonly string[];

  /**
   * Minimum token length (in code units) to keep. Defaults to `2`.
   */
  readonly minTokenLength?: number;

  /**
   * When `true`, casing is preserved; when `false` (default) the input is
   * lower-cased first.
   */
  readonly caseSensitive?: boolean;

  /**
   * Maximum number of tokens to emit. `0` (default) disables the cap.
   */
  readonly maxTokens?: number;
}

/**
 * The default four-way weight blend: lexical and vector at parity, with
 * recency and authority as lighter, situation-dependent signals.
 */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  lexical: 1,
  vector: 1,
  recency: 0.25,
  authority: 0.1,
};

/**
 * Default BM25 term-frequency saturation parameter `k1`.
 */
export const DEFAULT_BM25_K1 = 1.2;

/**
 * Default BM25 document-length normalisation parameter `b`.
 */
export const DEFAULT_BM25_B = 0.75;

/**
 * Default IDF smoothing applied to the document-frequency ratio.
 */
export const DEFAULT_IDF_SMOOTHING = 0.5;

/**
 * Default maximum number of results when the caller omits `topK`.
 */
export const DEFAULT_TOP_K = 10;

/**
 * Default minimum blended score a chunk must reach to be returned.
 */
export const DEFAULT_THRESHOLD = 0;

/**
 * Default time-to-live (ms) for cached ranking results.
 */
export const DEFAULT_TTL_MS = 60_000;

/**
 * Default maximum number of cached results retained by the store.
 */
export const DEFAULT_MAX_CACHE_SIZE = 250;

/**
 * Default interval (ms) between automatic TTL sweep passes.
 */
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * Default recency half-life (ms): seven days.
 */
export const DEFAULT_RECENCY_HALF_LIFE_MS = 7 * 86_400_000;

/**
 * Default metadata key holding a chunk's last-updated timestamp.
 */
export const DEFAULT_RECENCY_FIELD = 'updatedAt';

/**
 * Default metadata key holding a chunk's authority value.
 */
export const DEFAULT_AUTHORITY_FIELD = 'authority';

/**
 * Default authority value assumed when a chunk carries none.
 */
export const DEFAULT_AUTHORITY = 0.5;

/**
 * Scale used to normalise raw authority into `[0, 1]`.
 */
export const AUTHORITY_SCALE = 5;

/**
 * Tiny constant guarding against division by zero in blends and denominators.
 */
export const EPSILON = 1e-9;

/**
 * Built-in English stop-word list removed during tokenization.
 *
 * Kept deliberately small so it does not eat legitimate signal on technical
 * corpora; supplying {@link TokenizeOptions.stopWords} or
 * {@link RankingConfig.stopWords} replaces it entirely.
 */
export const DEFAULT_STOP_WORDS: readonly string[] = [
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'she', 'that', 'the', 'their', 'they', 'this', 'to',
  'was', 'were', 'will', 'with',
];

/**
 * Normalise free text for comparison and cache-key hashing.
 *
 * Trims surrounding whitespace and collapses internal runs of whitespace to a
 * single space. Optionally lower-cases the result. Used to derive canonical
 * query keys in {@link RankingStore} and to canonicalise text before scoring.
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
 * Blended scores should always lie in `[0, 1]`; this guard repairs
 * floating-point drift and rejects negative or super-unity inputs, mapping any
 * non-finite value to `0`.
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

/**
 * Narrow a value to {@link RankedChunk} by structural inspection.
 *
 * Useful for guards in generic pipelines that may receive either a ranked
 * chunk or a plain {@link ChunkCandidate}. Checks the four required fields
 * plus the presence of a finite `score`.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link RankedChunk}
 */
export function isRankedChunk(value: unknown): value is RankedChunk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<RankedChunk>;
  return (
    typeof record.chunkId === 'string' &&
    typeof record.sourceId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score)
  );
}

/**
 * Validate and fill in a partial {@link RankingWeights}.
 *
 * Negative or non-finite components are coerced to `0`; omitted components
 * inherit the {@link DEFAULT_RANKING_WEIGHTS} value.
 *
 * @param weights - the partial weights, or `undefined`
 * @returns a complete, validated {@link RankingWeights}
 */
export function validateWeights(weights: Partial<RankingWeights> | undefined): RankingWeights {
  const base = DEFAULT_RANKING_WEIGHTS;
  const pick = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
  return {
    lexical: pick(weights?.lexical, base.lexical),
    vector: pick(weights?.vector, base.vector),
    recency: pick(weights?.recency, base.recency),
    authority: pick(weights?.authority, base.authority),
  };
}

/**
 * Produce the canonical {@link RankingConfig} defaults.
 *
 * @returns a complete configuration with every field populated by its default
 */
export function defaultRankingConfig(): RankingConfig {
  return {
    weights: { ...DEFAULT_RANKING_WEIGHTS },
    defaultTopK: DEFAULT_TOP_K,
    defaultThreshold: DEFAULT_THRESHOLD,
    bm25K1: DEFAULT_BM25_K1,
    bm25B: DEFAULT_BM25_B,
    idfSmoothing: DEFAULT_IDF_SMOOTHING,
    sublinearTf: true,
    caseSensitive: false,
    stopWords: [...DEFAULT_STOP_WORDS],
    minTokenLength: 2,
    maxTokensPerDocument: 0,
    ttlMs: DEFAULT_TTL_MS,
    maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
    sweepIntervalMs: DEFAULT_SWEEP_INTERVAL_MS,
    recencyHalfLifeMs: DEFAULT_RECENCY_HALF_LIFE_MS,
    recencyField: DEFAULT_RECENCY_FIELD,
    authorityField: DEFAULT_AUTHORITY_FIELD,
    defaultAuthority: DEFAULT_AUTHORITY,
    authorityScale: AUTHORITY_SCALE,
    epsilon: EPSILON,
    now: () => Date.now(),
  };
}

/**
 * Merge a partial {@link RankingConfig} over the defaults.
 *
 * Nested objects are merged shallowly, so a caller can override just
 * `weights.recency` without losing the rest of the blend.
 *
 * @param config - the partial configuration, or `undefined`
 * @returns a complete, merged {@link RankingConfig}
 */
export function mergeRankingConfig(config: Partial<RankingConfig> | undefined): RankingConfig {
  const base = defaultRankingConfig();
  if (!config) {
    return base;
  }
  return {
    ...base,
    ...config,
    weights: config.weights ? { ...base.weights, ...config.weights } : base.weights,
  };
}

/**
 * Tokenize free text into a de-duplicated list of normalised terms.
 *
 * Splits on any run of non-alphanumeric characters, drops tokens shorter than
 * `minTokenLength`, removes stop-words and (by default) lower-cases. Duplicate
 * tokens are collapsed so the result is a set of *distinct* terms — exactly
 * what lexical-overlap and vector scoring need.
 *
 * @param text - the raw text to tokenize
 * @param options - tokenization options (stop-words, min length, casing, cap)
 * @returns the distinct normalised terms, or `[]` for empty input
 */
export function tokenize(text: string | undefined, options: TokenizeOptions = {}): string[] {
  if (!text) {
    return [];
  }
  const stopWords = options.stopWords ?? DEFAULT_STOP_WORDS;
  const minTokenLength = options.minTokenLength ?? 2;
  const caseSensitive = options.caseSensitive ?? false;
  const maxTokens = options.maxTokens ?? 0;
  const normalized = caseSensitive ? text : text.toLowerCase();
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (word.length < minTokenLength) {
      continue;
    }
    if (stopWords.includes(word)) {
      continue;
    }
    if (seen.has(word)) {
      continue;
    }
    seen.add(word);
    tokens.push(word);
    if (maxTokens > 0 && tokens.length >= maxTokens) {
      break;
    }
  }
  return tokens;
}

/**
 * Build a sparse {@link DocumentVector} from a token list.
 *
 * Counts occurrences of each term. Pass the output of {@link tokenize} for a
 * distinct-term set (every count `1`) or raw (possibly duplicated) tokens for
 * true term frequencies.
 *
 * @param terms - the tokens to count
 * @returns a term→count sparse vector
 */
export function buildTermVector(terms: readonly string[]): DocumentVector {
  const vector: Record<string, number> = {};
  for (const term of terms) {
    vector[term] = (vector[term] ?? 0) + 1;
  }
  return vector;
}

/**
 * Convert any {@link TermVectorLike} into a plain term→count record.
 *
 * `Map`-backed vectors are expanded into records; record-backed vectors are
 * shallow-copied. The result is JSON-serialisable.
 *
 * @param vector - the vector to convert
 * @returns a plain record representation
 */
export function termVectorToRecord(vector: TermVectorLike): Record<string, number> {
  if (vector instanceof Map) {
    const out: Record<string, number> = {};
    for (const [term, count] of vector) {
      out[term] = count;
    }
    return out;
  }
  return { ...(vector as DocumentVector) };
}

/**
 * Compute cosine similarity between two term vectors.
 *
 * Accepts either sparse records or `Map`s. Returns `0` when either vector is
 * empty (no shared dimensionality), so the result is always safe to blend.
 *
 * @param a - the first vector
 * @param b - the second vector
 * @returns cosine similarity in `[0, 1]` (cosine is non-negative for
 *   frequency vectors)
 */
export function cosineSimilarity(a: TermVectorLike, b: TermVectorLike): number {
  const ra = termVectorToRecord(a);
  const rb = termVectorToRecord(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const term of Object.keys(ra)) {
    const va = ra[term];
    normA += va * va;
    const vb = rb[term];
    if (vb !== undefined) {
      dot += va * vb;
    }
  }
  for (const term of Object.keys(rb)) {
    normB += rb[term] * rb[term];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute cosine similarity between two dense embedding vectors.
 *
 * Both vectors must be non-empty and equally sized; otherwise `0` is
 * returned. Values may be negative (unlike term frequencies), so the raw
 * cosine is returned and callers should clamp/blend appropriately.
 *
 * @param a - the first embedding
 * @param b - the second embedding
 * @returns cosine similarity in `[-1, 1]`
 */
export function cosineEmbedding(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Resolve a timestamp out of a chunk's metadata.
 *
 * Accepts epoch-millisecond numbers, ISO-8601 strings or `Date` instances.
 * Returns `null` when the field is missing or unparsable, so callers can fall
 * back to a neutral recency signal.
 *
 * @param metadata - the chunk metadata, or `undefined`
 * @param field - the metadata key to read
 * @returns the epoch-millisecond timestamp, or `null`
 */
export function timestampOf(
  metadata: Readonly<Record<string, unknown>> | undefined,
  field: string,
): Timestamp | null {
  if (!metadata) {
    return null;
  }
  const raw = metadata[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (raw instanceof Date) {
    return raw.getTime();
  }
  return null;
}

/**
 * Resolve a numeric authority value out of a chunk's metadata.
 *
 * Accepts numbers or numeric strings. Returns the `fallback` when the field is
 * missing, non-numeric or non-finite.
 *
 * @param metadata - the chunk metadata, or `undefined`
 * @param field - the metadata key to read
 * @param fallback - the value used when the field cannot be resolved
 * @returns the resolved authority value
 */
export function authorityOf(
  metadata: Readonly<Record<string, unknown>> | undefined,
  field: string,
  fallback = DEFAULT_AUTHORITY,
): number {
  if (!metadata) {
    return fallback;
  }
  const raw = metadata[field];
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Compute the arithmetic mean of a list of numbers.
 *
 * @param values - the values to average
 * @returns the mean, or `0` for an empty list
 */
export function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}