/**
 * MAM Memory Engine — public barrel.
 *
 * Re-exports the public surface of the four memory layers:
 *
 * - {@link ShortTermStore} — ephemeral working memory with TTL expiry, LRU
 *   eviction, scopes and access tracking.
 * - {@link LongTermStore} — durable, taggable, importance-scored memory with
 *   file persistence.
 * - {@link EpisodicStore} — discrete recorded experiences with event timelines.
 * - {@link SemanticStore} — timeless facts/knowledge with TF-IDF retrieval.
 *
 * Each layer exposes the same shape: a store, an index, a retriever, a
 * lifecycle manager and a runtime integration adapter. The `RuntimeMemory`
 * contract lets the four layers be swapped behind a single consumer.
 *
 * @packageDocumentation
 * @module memory-engine
 */

// ==========================================================================
// Short-term memory
// ==========================================================================

// Types
export type {
  ShortTermId,
  ShortTermValue,
  ShortTermMetadata,
  ShortTermScope,
  RetentionPolicy,
  AccessRecord,
  ShortTermEntry,
  ShortTermConfig,
  ShortTermStats,
  ShortTermEntryOptions,
  ShortTermEntryInput,
  ScoredEntry,
  SearchResult,
  PruneResult,
  ShortTermIndexStats,
  ShortTermSnapshot,
  RuntimeMemory as ShortTermRuntimeMemory,
} from './short-term/types.js';

// Index
export {
  extractText,
  normalizeTerm,
  ShortTermIndex,
} from './short-term/index.js';

// Store
export {
  DEFAULT_SHORT_TERM_CONFIG,
  normalizeTags as normalizeShortTermTags,
  cloneValue as cloneShortTermValue,
  normalizeTtl,
  ShortTermStore,
} from './short-term/store.js';
export type { ShortTermUpdate } from './short-term/store.js';

// Retrieval
export {
  recencyScore,
  frequencyScore,
  textMatchScore,
  ShortTermRetriever,
} from './short-term/retrieval.js';
export type {
  ShortTermRetrievalOptions,
  HybridOptions,
} from './short-term/retrieval.js';

// Lifecycle
export {
  ShortTermLifecycle,
  createShortTermLifecycle,
} from './short-term/lifecycle.js';
export type {
  ShortTermLifecycleEvents,
  EvictListener,
  PruneListener,
  ResetListener,
} from './short-term/lifecycle.js';

// Integration
export {
  ShortTermRuntimeAdapter,
  createShortTermAdapter,
  generateSessionId,
  ShortTermSession,
  createWorkingMemory,
} from './short-term/integration.js';
export type {
  ShortTermAdapterOptions,
  ShortTermSessionOptions,
} from './short-term/integration.js';

// ==========================================================================
// Long-term memory
// ==========================================================================

// Types
export type {
  LongTermEntry,
  LongTermConfig,
  LongTermStats,
  LongTermEntryOptions,
  PersistenceOptions,
  LongTermEntryInput,
  ScoredLongTermResult,
} from './long-term/types.js';
export {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_IMPORTANCE_THRESHOLD,
  IMPORTANCE_MIN,
  IMPORTANCE_MAX,
  DEFAULT_PERSIST_INTERVAL_MS,
  DEFAULT_TAG,
  IMPORTANCE_BUCKETS,
  JSON_ID_FIELD,
  JSON_VALUE_FIELD,
  normalizeImportance,
  optionalImportance,
  normalizeTags as normalizeLongTermTags,
  isLongTermEntry,
  cloneValue as cloneLongTermValue,
  valuesEqual,
  mergeEntry,
  entryAgeMs,
  estimateEntryBytes,
  assertValidId,
  assertValidEntry,
  buildEntry,
  entryToJSON,
  entryFromJSON,
  sortByNewest,
  sortByImportance,
  sortByRecency,
  partitionLive,
  dateBucketKey,
  formatDuration as formatLongTermDuration,
  unionTags,
  filterArchived,
} from './long-term/types.js';

// Index
export { LongTermIndex } from './long-term/index.js';
export type {
  IndexQueryOptions,
  LongTermIndexStats,
} from './long-term/index.js';

// Store
export { LongTermStore } from './long-term/store.js';
export type {
  LongTermSnapshot,
  LongTermStoreOptions,
} from './long-term/store.js';

// Retrieval
export {
  LongTermRetriever,
  createLongTermRetriever,
} from './long-term/retrieval.js';
export type {
  LongTermRetrievalOptions,
  HybridRetrievalOptions,
  LongTermRetrieverDeps,
  RecallContext,
} from './long-term/retrieval.js';

// Lifecycle
export {
  LongTermLifecycle,
  createLongTermLifecycle,
  summarizeLifecycle,
} from './long-term/lifecycle.js';
export type {
  LongTermLifecycleEvents,
  LongTermLifecycleEventName,
  PruneOptions,
  ArchiveOldOptions,
  ConsolidateOptions,
  ConsolidateResult,
} from './long-term/lifecycle.js';

// Integration
export {
  LongTermRuntimeAdapter,
  createLongTermAdapter,
  LongTermRepository,
  createLongTermRepository,
} from './long-term/integration.js';
export type {
  RuntimeMemory as LongTermRuntimeMemory,
  LongTermAdapterOptions,
  LongTermRepositoryOptions,
  KnowledgeProfile,
} from './long-term/integration.js';

// ==========================================================================
// Episodic memory
// ==========================================================================

// Types
export type {
  EpisodeId,
  EventId,
  EpisodeOutcome,
  EpisodeMetadata,
  EpisodeEvent,
  Episode,
  MutableEpisode,
  EpisodeStats,
  EpisodeConfig,
  EpisodeOptions,
  EpisodeHit,
  ConsolidationResult as EpisodicConsolidationResult,
  EpisodeLifecycleEvent,
  RuntimeMemory as EpisodicRuntimeMemory,
} from './episodic/types.js';

// Index
export {
  INDEX_FACETS,
  extractFacets,
  insertTimeEntry,
  removeTimeEntry,
  lowerBound,
  EpisodicIndex,
  createIndex as createEpisodicIndex,
} from './episodic/index.js';
export type {
  IndexFacet,
  IndexTimeEntry,
  IndexMatch,
  IndexStats,
} from './episodic/index.js';

// Store
export {
  DEFAULT_EPISODE_CONFIG,
  deepClone as deepCloneEpisodic,
  normalizeTags as normalizeEpisodicTags,
  collectEventIds,
  EpisodicStore,
} from './episodic/store.js';
export type { EpisodicStoreSnapshot } from './episodic/store.js';

// Retrieval
export {
  DEFAULT_RETRIEVAL_LIMIT,
  sortEpisodes,
  resolveLimit,
  applyLimit,
  containsText,
  EpisodicRetriever,
  scoreEpisode,
  matchPattern,
} from './episodic/retrieval.js';
export type {
  PatternStep,
  PatternOptions,
  PatternMatch,
} from './episodic/retrieval.js';

// Lifecycle
export {
  LifecycleEmitter as EpisodicLifecycleEmitter,
  EpisodicLifecycle,
  selectEvents,
  buildEpisodeSummary,
  formatDuration as formatEpisodicDuration,
} from './episodic/lifecycle.js';
export type {
  LifecycleEventType,
  LifecycleListener,
  TrimResult,
  TrimOptions,
} from './episodic/lifecycle.js';

// Integration
export {
  EpisodicRuntimeAdapter,
  createEpisodicAdapter,
  EpisodeRecorder,
  coerceToEpisode,
  buildFacetFilter,
  facetMatches,
} from './episodic/integration.js';
export type {
  SearchClause,
  EpisodicSearchQuery,
  EpisodicSearchResult,
  EpisodicRuntime,
} from './episodic/integration.js';

// ==========================================================================
// Semantic memory
// ==========================================================================

// Types
export type {
  SemanticEntryId,
  Timestamp,
  Confidence,
  SemanticMetadata,
  SemanticEntry,
  MutableSemanticEntry,
  SemanticEntryOptions,
  SemanticPatch,
  SemanticConfig,
  SemanticStats,
  SemanticHit,
  SemanticPruneResult,
  SemanticDedupeResult,
  SemanticDecayResult,
  SemanticNormalizeResult,
  SemanticLifecycleEvent,
  SemanticSnapshot,
  RuntimeMemory,
} from './semantic/types.js';

// Index
export {
  FIELD_WEIGHTS,
  tokenize,
  stem,
  termFrequency,
  extractWeightedTerms,
  cosineSimilarity,
  magnitude,
  SemanticIndex,
  createIndex as createSemanticIndex,
} from './semantic/index.js';
export type { SemanticIndexStats } from './semantic/index.js';

// Store
export {
  DEFAULT_SEMANTIC_CONFIG,
  generateId,
  deepClone as deepCloneSemantic,
  normalizeTags as normalizeSemanticTags,
  normalizeConfidence,
  SemanticStore,
  createStore,
  toSemanticMetadata,
} from './semantic/store.js';
export type { SemanticStoreSnapshot } from './semantic/store.js';

// Retrieval
export {
  SemanticRetriever,
  createRetriever,
} from './semantic/retrieval.js';
export type { SemanticRetrievalOptions } from './semantic/retrieval.js';

// Lifecycle
export {
  DEFAULT_DECAY_FACTOR,
  DEFAULT_DECAY_FLOOR,
  LifecycleEmitter as SemanticLifecycleEmitter,
  normalizeFactKey,
  pickSurvivor,
  mergeDuplicates,
  SemanticLifecycle,
  createLifecycle,
} from './semantic/lifecycle.js';
export type {
  SemanticLifecycleOptions,
  SemanticLifecycleListener,
} from './semantic/lifecycle.js';

// Integration
export {
  toFact,
  optionsFromMetadata,
  SemanticRuntimeAdapter,
  createSemanticAdapter,
  KnowledgeBase,
  createKnowledgeBase,
} from './semantic/integration.js';
export type { SemanticRecallOptions } from './semantic/integration.js';

// ==========================================================================
// Shared cross-layer types (aliased to avoid collisions)
// ==========================================================================

export type { Timestamp as ShortTermTimestamp } from './short-term/types.js';
export type { Timestamp as EpisodicTimestamp } from './episodic/types.js';