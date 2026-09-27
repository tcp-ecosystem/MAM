/**
 * MAM Knowledge Engine — public barrel.
 *
 * Re-exports the public surface of the four knowledge layers:
 *
 * - **Sources** — the ingestion boundary: {@link KnowledgeSourceStore},
 *   {@link SourceIndex}, {@link SourceRetriever}, {@link SourceLifecycle} and
 *   the {@link KnowledgeSourceAdapter} / {@link SourceRegistry} composites.
 * - **Ranking** — scoring: {@link RankIndex}, {@link KnowledgeRanker},
 *   {@link RankingStore}, {@link RankingLifecycle} and the
 *   {@link RankingAdapter} / {@link ScoredRetriever} facades.
 * - **Retrieval** — a searchable corpus: {@link RetrievalStore},
 *   {@link RetrievalIndex}, {@link KnowledgeRetriever},
 *   {@link RetrievalLifecycle} and {@link KnowledgeRetrieverAdapter} /
 *   {@link HybridRetriever}.
 * - **RAG** — grounded generation: {@link RagStore}, {@link RagIndex},
 *   {@link RagRetriever}, {@link RagLifecycle} and the {@link RagEngine} /
 *   {@link RagAdapter} composites.
 *
 * Names that collide across layers (e.g. `Timestamp`, `normalizeText`,
 * `clampScore`) are re-exported with a layer prefix so the barrel stays
 * unambiguous.
 *
 * @packageDocumentation
 * @module knowledge-engine
 */

// ==========================================================================
// Sources
// ==========================================================================

// Types
export type {
  KnowledgeSource,
  SourceId,
  SourceKind,
  SourceTag,
  MimeType,
  Timestamp as SourcesTimestamp,
  SourceConfig,
  SourceOptions,
  TextIngestOptions,
  FileIngestOptions,
  UrlIngestOptions,
  SourceStats,
  IngestResult,
  SerializedSources,
  SourceEvent,
  SourceEventType,
} from './sources/types.js';
export {
  SOURCE_KINDS,
  DEFAULT_SOURCE_LIMIT,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_TTL_MS as SOURCES_DEFAULT_TTL_MS,
  DEFAULT_MIME_TYPE,
  TEXT_MIME_TYPE,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_PREFIX_LENGTH,
  MIME_BY_EXTENSION,
  normalizeText,
  normalizeTags,
  clamp,
  isValidKind,
  parseSourceKind,
  detectMimeType,
  buildSourceId,
  isKnowledgeSource,
  byteLength,
} from './sources/types.js';

// Index
export {
  SourceIndex,
  describeEntry,
  isTagMatchMode,
} from './sources/index.js';
export type { IndexStats as SourceIndexStats, TagMatchMode } from './sources/index.js';

// Store
export {
  KnowledgeSourceStore,
  isSourceStoreLike,
  canonicalId,
  countByKind,
  idForSeed,
  normalizeLimit,
  sourceKinds,
} from './sources/store.js';

// Retrieval
export {
  SourceRetriever,
  DEFAULT_RETRIEVER_LIMIT,
  DEFAULT_SEARCH_WEIGHTS,
  seededRandom,
  mergeSearchResults,
  isKindFilter,
} from './sources/retrieval.js';
export type {
  ScoredSource,
  SourceSearchResult,
  SearchOptions,
  SourceRetrieverOptions,
} from './sources/retrieval.js';

// Lifecycle
export {
  SourceLifecycle,
  createLifecycle,
  touchTime,
  isStale,
} from './sources/lifecycle.js';
export type {
  SourceLifecycleEvents,
  SourceLifecycleOptions,
  LifecycleStats as SourceLifecycleStats,
} from './sources/lifecycle.js';

// Integration
export {
  KnowledgeSourceAdapter,
  createSourceAdapter,
  SourceRegistry,
  isSourceStore,
} from './sources/integration.js';
export type {
  SourceStore,
  SourceAdapterConfig,
  IngestItem,
  IngestBatchResult,
  RegistrySearchResult,
  RegistryStats,
} from './sources/integration.js';

// ==========================================================================
// Ranking
// ==========================================================================

// Types
export type {
  ChunkCandidate,
  RankedChunk,
  RankingQuery,
  RankOptions,
  RankingWeights,
  RankingConfig,
  RankingResult,
  RankingStats,
  RankScore,
  ScoreBreakdown,
  Bm25Context,
  TokenizeOptions,
  DocumentVector as RankingDocumentVector,
  ChunkId as RankingChunkId,
  SourceId as RankingSourceId,
  Timestamp as RankingTimestamp,
  RankingEventType,
  RankingLifecycleEvent,
} from './ranking/types.js';
export {
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_BM25_K1,
  DEFAULT_BM25_B,
  DEFAULT_IDF_SMOOTHING,
  DEFAULT_TOP_K as RANKING_DEFAULT_TOP_K,
  DEFAULT_THRESHOLD as RANKING_DEFAULT_THRESHOLD,
  DEFAULT_TTL_MS as RANKING_DEFAULT_TTL_MS,
  DEFAULT_MAX_CACHE_SIZE as RANKING_DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_SWEEP_INTERVAL_MS as RANKING_DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_RECENCY_HALF_LIFE_MS,
  DEFAULT_RECENCY_FIELD,
  DEFAULT_AUTHORITY_FIELD,
  DEFAULT_AUTHORITY,
  AUTHORITY_SCALE,
  EPSILON,
  DEFAULT_STOP_WORDS as RANKING_DEFAULT_STOP_WORDS,
  normalizeText as rankingNormalizeText,
  clamp as rankingClamp,
  clampScore as rankingClampScore,
  isRankedChunk,
  validateWeights,
  defaultRankingConfig,
  mergeRankingConfig,
  tokenize,
  buildTermVector,
  termVectorToRecord,
  cosineSimilarity,
  cosineEmbedding,
  timestampOf,
  authorityOf,
  average,
} from './ranking/types.js';

// Index
export { RankIndex } from './ranking/index.js';
export type {
  IndexedDocument,
  RankIndexStats,
  RankIndexJSON,
} from './ranking/index.js';

// Store
export { RankingStore } from './ranking/store.js';
export type {
  RankingStoreOptions,
  CacheEntry as RankingCacheEntry,
  RankingStoreStats,
  RankingStoreJSON,
  RankingStoreEvent,
} from './ranking/store.js';

// Retrieval
export { KnowledgeRanker } from './ranking/retrieval.js';

// Lifecycle
export { RankingLifecycle } from './ranking/lifecycle.js';
export type {
  RankingLifecycleOptions,
  RankingLifecycleStats,
} from './ranking/lifecycle.js';

// Integration
export {
  RankingAdapter,
  createRankingAdapter,
  createRanker,
  ScoredRetriever,
} from './ranking/integration.js';
export type {
  Ranker,
  RankingAdapterOptions,
  RetrievalSource,
  ScoredRetrieverOptions,
} from './ranking/integration.js';

// ==========================================================================
// Retrieval
// ==========================================================================

// Types
export type {
  RetrievedChunk,
  RetrievalQuery,
  RetrievalOptions,
  RetrievalConfig,
  RetrievalResult,
  RetrievalStats,
  HybridWeights,
  DocumentVector as RetrievalDocumentVector,
  ChunkId as RetrievalChunkId,
  SourceId as RetrievalSourceId,
  Timestamp as RetrievalTimestamp,
  RetrievalEventType,
  RetrievalLifecycleEvent,
} from './retrieval/types.js';
export {
  DEFAULT_TOP_K as RETRIEVAL_DEFAULT_TOP_K,
  DEFAULT_THRESHOLD as RETRIEVAL_DEFAULT_THRESHOLD,
  DEFAULT_TTL_MS as RETRIEVAL_DEFAULT_TTL_MS,
  DEFAULT_LEXICAL_WEIGHT,
  DEFAULT_COSINE_WEIGHT,
  DEFAULT_CONTEXT_WEIGHT,
  normalizeText as retrievalNormalizeText,
  isRetrievedChunk,
  clamp as retrievalClamp,
  clampScore as retrievalClampScore,
} from './retrieval/types.js';

// Index
export {
  RetrievalIndex,
  DEFAULT_STOP_WORDS as RETRIEVAL_DEFAULT_STOP_WORDS,
  DEFAULT_MIN_TOKEN_LENGTH,
} from './retrieval/index.js';
export type {
  IndexEntryInput,
  IndexStats as RetrievalIndexStats,
  IndexSnapshot,
} from './retrieval/index.js';

// Store
export {
  RetrievalStore,
  STORE_SNAPSHOT_VERSION,
} from './retrieval/store.js';
export type {
  StoreChunkInput,
  StoreFilter,
  StoreSnapshot,
  StoreStats,
  ChunkPredicate,
} from './retrieval/store.js';

// Retrieval
export {
  KnowledgeRetriever,
  hashString as retrievalHashString,
  lexicalOverlap,
} from './retrieval/retrieval.js';

// Lifecycle
export {
  RetrievalLifecycle,
  DEFAULT_EVENT_TYPE as RETRIEVAL_DEFAULT_EVENT_TYPE,
} from './retrieval/lifecycle.js';
export type {
  LifecycleListener,
  LifecycleCacheEntry,
  LifecycleOptions,
  LifecycleStats as RetrievalLifecycleStats,
} from './retrieval/lifecycle.js';

// Integration
export {
  KnowledgeRetrieverAdapter,
  createRetrieverAdapter,
  HybridRetriever,
} from './retrieval/integration.js';
export type {
  Retriever,
  AsyncRetriever,
  RetrieverAdapterConfig,
  HybridRetrieverConfig,
  HybridScoreBreakdown,
  HybridScoredChunk,
} from './retrieval/integration.js';

// ==========================================================================
// RAG
// ==========================================================================

// Types
export type {
  RagPiece,
  RagContext,
  RagConfig,
  RagOptions,
  RagResult,
  RagStats,
  RagStrategy,
  RagEventType,
  RagSourceFn,
  RagStoreValue,
  RagLifecycleEvent,
  RagSourceDescriptor,
} from './rag/types.js';
export {
  DEFAULT_TOP_K as RAG_DEFAULT_TOP_K,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_STRATEGY,
  DEFAULT_THRESHOLD as RAG_DEFAULT_THRESHOLD,
  DEFAULT_TTL_MS as RAG_DEFAULT_TTL_MS,
  DEFAULT_MAX_CACHE_SIZE as RAG_DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_SWEEP_INTERVAL_MS as RAG_DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_PROMPT_HEADER,
  DEFAULT_PROMPT_FOOTER,
  DEFAULT_PROMPT_SEPARATOR,
  normalizeText as ragNormalizeText,
  countTokens,
  estimateTokens,
  clamp as ragClamp,
  clampScore as ragClampScore,
  hashString as ragHashString,
  buildCacheKey,
  isRagPiece,
  isRagContext,
  isRagResult,
  sortPiecesByScore,
  uniqueSources,
  averageScore,
  defaultRagConfig,
  mergeRagConfig,
  emptyRagStats,
} from './rag/types.js';

// Index
export {
  RagIndex,
  MIN_TERM_LENGTH,
  DEFAULT_STOP_WORDS as RAG_DEFAULT_STOP_WORDS,
} from './rag/index.js';
export type {
  RagIndexStats,
  RagIndexOptions,
  RagIndexHit,
} from './rag/index.js';

// Store
export {
  RagStore,
  RAG_STORE_VERSION,
  isSerializedRagStore,
  normalizeQuery,
  queryKey,
} from './rag/store.js';
export type {
  StoredEntry,
  RagStoreStats,
  RagStoreOptions,
  SerializedRagStore,
} from './rag/store.js';

// Retrieval
export {
  RagRetriever,
  contextCoverage,
  blendContextScore,
} from './rag/retrieval.js';
export type {
  RagRetrieverStats,
  RagRetrieverOptions,
} from './rag/retrieval.js';

// Lifecycle
export {
  RagLifecycle,
  createRagLifecycle,
  isRagLifecycleStats,
} from './rag/lifecycle.js';
export type {
  RagLifecycleOptions,
  RagLifecycleStats,
} from './rag/lifecycle.js';

// Integration
export {
  RagEngine,
  RagAdapter,
  completeRag,
  createRagEngine,
  createCorpusEngine,
  normalizeScore,
} from './rag/integration.js';
export type {
  Rag,
  RagEngineStats,
  RagEngineOptions,
} from './rag/integration.js';