/**
 * MAM Intelligence Engine
 *
 * Standalone intelligence engine: **Query understanding**, **Grounding**,
 * **Synthesis**, **Knowledge graph** and **Integration** layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`). The per-layer
 * `index.ts` files are the *indexing* classes (`QueryIndex`,
 * `GroundingIndex`, `SynthesisIndex`, `GraphIndex`, `KnowledgeIndex`),
 * NOT barrels, so they are re-exported under their class names only.
 *
 * Names that collide across layers are aliased with a layer prefix so every
 * name stays unique at the package root:
 *
 *   - Query       -> `Query*`        (e.g. `QueryClampScore`)
 *   - Grounding   -> `Grounding*`    (e.g. `GroundingIsFiniteNumber`)
 *   - Synthesis   -> `Synthesis*`    (e.g. `SynthesisStopWords`)
 *   - Graph       -> `Graph*`        (e.g. `GraphIndexStats`)
 *   - Integration -> `Integration*`  (e.g. `IntegrationConfidenceBucket`)
 *
 * Names that exist in exactly one layer are exported unchanged (e.g.
 * `QueryAnalyzer`, `GroundednessScorer`, `AnswerSynthesizer`, `GraphEngine`,
 * `Consolidator`).
 */

// ---------------------------------------------------------------------------
// Query understanding layer
// ---------------------------------------------------------------------------

// query/types.ts
export {
  QUERY_INTENTS,
  DEFAULT_STOPWORDS,
  DEFAULT_TERM_RULES,
  DEFAULT_QUERY_SYNONYMS,
  DEFAULT_QUERY_THESAURUS,
  DEFAULT_INTENT_PATTERNS,
  DEFAULT_ANALYSIS_CONFIG,
  isQueryIntent,
  assertQueryIntent,
  mergeExpansionConfig,
  resolveExpansionConfig,
  isQueryAnalysis,
  hashText,
  createQueryAnalysis,
  dedupeStrings,
  clamp01,
} from './query/types.js';
export type {
  QueryIntent,
  IntentSignal,
  IntentPattern,
  ExpansionConfig,
  TermRule,
  AnalysisConfig,
  AnalyzeOptions,
  QueryAnalysis,
  AnalysisStats,
  PutManyResult,
} from './query/types.js';

// query/store.ts
export {
  DEFAULT_QUERY_STORE_CONFIG,
  normalizeForAddress,
  addressFor,
  QueryStore,
} from './query/store.js';
export type {
  QueryStoreConfig,
  QueryStoreSnapshot,
} from './query/store.js';

// query/index.ts
export {
  DEFAULT_QUERY_INDEX_CONFIG,
  QueryIndex,
  clampScore as QueryClampScore,
  normalizeIndexTerm,
} from './query/index.js';
export type {
  QueryIndexConfig,
  QueryIndexHit,
  QueryIndexQueryOptions,
  QueryIndexStats,
  QueryIndexSnapshot,
} from './query/index.js';

// query/retrieval.ts
export {
  LANGUAGE_LEXICONS,
  ENTITY_PATTERNS,
  QueryAnalyzer,
} from './query/retrieval.js';
export type {
  ExtractedTerm,
  ExpansionResult,
  LanguageSignal,
} from './query/retrieval.js';

// query/lifecycle.ts
export {
  QueryLifecycle,
} from './query/lifecycle.js';
export type {
  QueryLifecycleEventType,
  QueryLifecycleEvent,
  QueryLifecycleConfig,
  ProcessResult,
  QueryLifecycleListener,
} from './query/lifecycle.js';

// ---------------------------------------------------------------------------
// Grounding layer
// ---------------------------------------------------------------------------

// grounding/types.ts
export {
  DEFAULT_GROUNDING_CONFIG,
  GROUNDING_LIMITS,
  isRecord as GroundingIsRecord,
  hasOwn as GroundingHasOwn,
  isFiniteNumber as GroundingIsFiniteNumber,
  isFiniteInRange as GroundingIsFiniteInRange,
  isNonEmptyString as GroundingIsNonEmptyString,
  isStringArray as GroundingIsStringArray,
  isEvidenceChunk,
  isGroundingRequest,
  isGroundedClaim,
  isGroundingResult,
  isGroundingConfig,
  isGroundingStats,
  isGroundOptions,
  assertEvidenceChunk,
  assertGroundingRequest,
  assertGroundingResult,
  assertFiniteInRange as GroundingAssertFiniteInRange,
  normalizeGroundingConfig,
  mergeGroundOptions,
  createEvidenceChunk,
  createGroundedClaim,
  createGroundingResult,
  emptyGroundingResult,
  createGroundingStats,
  syntheticId as GroundingSyntheticId,
} from './grounding/types.js';
export type {
  EvidenceChunk,
  GroundingRequest,
  GroundedClaim,
  GroundingResult,
  GroundingConfig,
  GroundingStats,
  GroundOptions,
} from './grounding/types.js';

// grounding/store.ts
export {
  DEFAULT_STORE_CAP,
  MAX_RESTORE_ENTRIES as GroundingMaxRestoreEntries,
  GroundingStore,
} from './grounding/store.js';
export type {
  GroundingStoreSnapshot,
  CacheStats as GroundingCacheStats,
} from './grounding/store.js';

// grounding/index.ts
export {
  GroundingIndex,
} from './grounding/index.js';
export type {
  IndexStats as GroundingIndexStats,
} from './grounding/index.js';

// grounding/retrieval.ts
export {
  diceCoefficient,
  jaccardIndex,
  GroundednessScorer,
} from './grounding/retrieval.js';
export type {
  TokenizerKind,
  ScoreDetail,
  ChunkOverlap,
  GroundingSummary,
} from './grounding/retrieval.js';

// grounding/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as GROUNDING_DEFAULT_GC_INTERVAL_MS,
  DEFAULT_IDLE_TTL_MS as GROUNDING_DEFAULT_IDLE_TTL_MS,
  DEFAULT_PRUNE_THRESHOLD as GROUNDING_DEFAULT_PRUNE_THRESHOLD,
  MIN_GC_INTERVAL_MS as GROUNDING_MIN_GC_INTERVAL_MS,
  GroundingLifecycle,
} from './grounding/lifecycle.js';
export type {
  LifecycleOptions as GroundingLifecycleOptions,
  GcReport as GroundingGcReport,
  LifecycleStats as GroundingLifecycleStats,
  GroundedEventPayload,
  PrunedEventPayload as GroundingPrunedEventPayload,
} from './grounding/lifecycle.js';

// ---------------------------------------------------------------------------
// Synthesis layer
// ---------------------------------------------------------------------------

// synthesis/types.ts
export {
  DEFAULT_SYNTHESIS_CONFIG,
  DEFAULT_STYLE_LIMITS,
  SYNTHESIS_LIMITS,
  isRecord as SynthesisIsRecord,
  hasOwn as SynthesisHasOwn,
  isFiniteNumber as SynthesisIsFiniteNumber,
  isFiniteInRange as SynthesisIsFiniteInRange,
  isNonEmptyString as SynthesisIsNonEmptyString,
  isStringArray as SynthesisIsStringArray,
  isEvidencePart,
  isSynthesisPart,
  isAnswer,
  isAnswerRequest,
  isSynthesisConfig,
  isSynthesizeOptions,
  isSentenceScore,
  isSynthesisStats,
  assertEvidencePart,
  assertSynthesisPart,
  assertAnswer,
  assertAnswerRequest,
  assertSentenceScore,
  assertFiniteInRange as SynthesisAssertFiniteInRange,
  normalizeSynthesisConfig,
  mergeSynthesizeOptions,
  createEvidencePart,
  createSynthesisPart,
  createAnswer,
  emptyAnswer,
  createSynthesisStats,
  syntheticId as SynthesisSyntheticId,
} from './synthesis/types.js';
export type {
  AnswerStyle,
  EvidencePart,
  SynthesisPart,
  Answer,
  AnswerRequest,
  SynthesisConfig,
  SynthesisStats,
  SynthesizeOptions,
  EffectiveSynthesisOptions,
  SentenceScore,
} from './synthesis/types.js';

// synthesis/store.ts
export {
  DEFAULT_SYNTHESIS_STORE_CAP,
  MAX_RESTORE_ENTRIES as SynthesisMaxRestoreEntries,
  SynthesisStore,
} from './synthesis/store.js';
export type {
  SynthesisStoreSnapshot,
  CacheStats as SynthesisCacheStats,
} from './synthesis/store.js';

// synthesis/index.ts
export {
  CONFIDENCE_BUCKET_FLOORS as SYNTHESIS_CONFIDENCE_BUCKET_FLOORS,
  CONFIDENCE_BUCKETS as SYNTHESIS_CONFIDENCE_BUCKETS,
  SynthesisIndex,
} from './synthesis/index.js';
export type {
  ConfidenceBucket as SynthesisConfidenceBucket,
  IndexStats as SynthesisIndexStats,
} from './synthesis/index.js';

// synthesis/retrieval.ts
export {
  STOP_WORDS as SYNTHESIS_STOP_WORDS,
  ABBREVIATIONS,
  PARAGRAPH_TRANSITIONS,
  AnswerSynthesizer,
} from './synthesis/retrieval.js';
export type {
  FuseResult,
  RankedEvidence,
  SynthesisDetail,
} from './synthesis/retrieval.js';

// synthesis/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as SYNTHESIS_DEFAULT_GC_INTERVAL_MS,
  DEFAULT_IDLE_TTL_MS as SYNTHESIS_DEFAULT_IDLE_TTL_MS,
  DEFAULT_PRUNE_THRESHOLD as SYNTHESIS_DEFAULT_PRUNE_THRESHOLD,
  MIN_GC_INTERVAL_MS as SYNTHESIS_MIN_GC_INTERVAL_MS,
  SynthesisLifecycle,
} from './synthesis/lifecycle.js';
export type {
  LifecycleOptions as SynthesisLifecycleOptions,
  GcReport as SynthesisGcReport,
  LifecycleStats as SynthesisLifecycleStats,
  SynthesizedEventPayload,
  PrunedEventPayload as SynthesisPrunedEventPayload,
} from './synthesis/lifecycle.js';

// ---------------------------------------------------------------------------
// Knowledge graph layer
// ---------------------------------------------------------------------------

// graph/types.ts
export {
  ENTITY_TYPES,
  GRAPH_LIMITS,
  DEFAULT_ENTITY_PATTERNS,
  DEFAULT_GRAPH_CONFIG,
  isRecord as GraphIsRecord,
  hasOwn as GraphHasOwn,
  isFiniteNumber as GraphIsFiniteNumber,
  isFiniteInRange as GraphIsFiniteInRange,
  isNonEmptyString as GraphIsNonEmptyString,
  isStringArray as GraphIsStringArray,
  isEntityType,
  isEntityPattern,
  isEntityPatterns,
  isEntityMention,
  isGraphEntity,
  isGraphRelation,
  isTriplet,
  isGraphConfig,
  isGraphStats,
  isGraphOptions,
  isEntityCandidate,
  isEntityExtraction,
  assertGraphEntity,
  assertGraphRelation,
  assertTriplet,
  assertEntityExtraction,
  assertFiniteInRange as GraphAssertFiniteInRange,
  normalizeGraphConfig,
  mergeGraphOptions,
  createEntityMention,
  createEntityCandidate,
  createEntityExtraction,
  createGraphEntity,
  createGraphRelation,
  createTriplet,
  createGraphStats,
  emptyGraphStats,
  hashString,
  entityIdFromName,
  syntheticId as GraphSyntheticId,
} from './graph/types.js';
export type {
  EntityType,
  EntityMention,
  EntityPattern,
  EntityPatterns,
  GraphEntity,
  GraphRelation,
  Triplet,
  GraphConfig,
  GraphStats,
  GraphOptions,
  EntityCandidate,
  EntityExtraction,
} from './graph/types.js';

// graph/store.ts
export {
  MAX_RESTORE_ENTITIES,
  MAX_RESTORE_RELATIONS,
  GraphStore,
} from './graph/store.js';
export type {
  GraphSize,
  Neighbor,
  NeighborDirection,
  DegreeInfo,
  GraphStoreSnapshot,
} from './graph/store.js';

// graph/index.ts
export {
  GraphIndex,
} from './graph/index.js';
export type {
  IndexStats as GraphIndexStats,
  GraphIndexSnapshot,
} from './graph/index.js';

// graph/retrieval.ts
export {
  GraphEngine,
  splitSentences,
  resolveOverlaps,
  normalizePredicate,
} from './graph/retrieval.js';
export type {
  TripletResult,
  QueryResult,
  Path,
  CentralityEntry,
} from './graph/retrieval.js';

// graph/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as GRAPH_DEFAULT_GC_INTERVAL_MS,
  DEFAULT_IDLE_TTL_MS as GRAPH_DEFAULT_IDLE_TTL_MS,
  DEFAULT_PRUNE_THRESHOLD as GRAPH_DEFAULT_PRUNE_THRESHOLD,
  MIN_GC_INTERVAL_MS as GRAPH_MIN_GC_INTERVAL_MS,
  GraphLifecycle,
} from './graph/lifecycle.js';
export type {
  LifecycleOptions as GraphLifecycleOptions,
  GcReport as GraphGcReport,
  LifecycleStats as GraphLifecycleStats,
  EntityAddedPayload,
  RelationAddedPayload,
  EntityRemovedPayload,
  RelationRemovedPayload,
  PrunedPayload,
} from './graph/lifecycle.js';

// ---------------------------------------------------------------------------
// Integration layer
// ---------------------------------------------------------------------------

// integration/types.ts
export {
  DEFAULT_INTEGRATE_CONFIG,
  DEFAULT_CONFIDENCE,
  DEFAULT_MERGE_THRESHOLD,
  DEFAULT_CONFLICT_MIN_SIMILARITY,
  INTEGRATE_LIMITS,
  isRecord as IntegrationIsRecord,
  hasOwn as IntegrationHasOwn,
  isFiniteNumber as IntegrationIsFiniteNumber,
  isFiniteInRange as IntegrationIsFiniteInRange,
  isNonEmptyString as IntegrationIsNonEmptyString,
  isStringArray as IntegrationIsStringArray,
  isJsonSafe,
  isMetadata,
  isKnowledgeEntry,
  isConflict,
  isConsolidationResult,
  isIntegrateConfig,
  isIntegrateOptions,
  isMergeDecision,
  isIntegrateStats,
  assertKnowledgeEntry,
  assertConsolidationResult,
  assertConflict,
  assertIntegrateOptions,
  assertFiniteInRange as IntegrationAssertFiniteInRange,
  confidenceOf,
  clampScore as IntegrationClampScore,
  normalizeIntegrateConfig,
  mergeIntegrateOptions,
  createKnowledgeEntry,
  createConflict,
  createMergeDecision,
  createConsolidationResult,
  emptyConsolidationResult,
  createIntegrateStats,
  syntheticId as IntegrationSyntheticId,
} from './integration/types.js';
export type {
  KnowledgeEntry,
  ConsolidationResult,
  Conflict,
  IntegrateConfig,
  IntegrateOptions,
  EffectiveIntegrateOptions,
  IntegrateStats,
  MergeDecisionKind,
  MergeDecision,
} from './integration/types.js';

// integration/store.ts
export {
  DEFAULT_KNOWLEDGE_STORE_CAP,
  MAX_RESTORE_ENTRIES as IntegrationMaxRestoreEntries,
  KnowledgeStore,
} from './integration/store.js';
export type {
  ListSortKey,
  ListOrder,
  ListOptions,
  StoreStats,
  KnowledgeStoreSnapshot,
} from './integration/store.js';

// integration/index.ts
export {
  CONFIDENCE_BUCKET_FLOORS as INTEGRATION_CONFIDENCE_BUCKET_FLOORS,
  CONFIDENCE_BUCKETS as INTEGRATION_CONFIDENCE_BUCKETS,
  KnowledgeIndex,
} from './integration/index.js';
export type {
  ConfidenceBucket as IntegrationConfidenceBucket,
  IndexStats as IntegrationIndexStats,
  KnowledgeIndexSnapshot,
} from './integration/index.js';

// integration/retrieval.ts
export {
  STOP_WORDS as INTEGRATION_STOP_WORDS,
  NEGATION_WORDS,
  OPPOSITE_PAIRS,
  tokenize,
  entryTokens,
  entryTokenCount,
  compareEntryQuality,
  jaccard,
  dice,
  Consolidator,
} from './integration/retrieval.js';
export type {
  SimilarityBreakdown,
} from './integration/retrieval.js';

// integration/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as INTEGRATION_DEFAULT_GC_INTERVAL_MS,
  DEFAULT_IDLE_TTL_MS as INTEGRATION_DEFAULT_IDLE_TTL_MS,
  DEFAULT_PRUNE_THRESHOLD as INTEGRATION_DEFAULT_PRUNE_THRESHOLD,
  MIN_GC_INTERVAL_MS as INTEGRATION_MIN_GC_INTERVAL_MS,
  IntegrateLifecycle,
} from './integration/lifecycle.js';
export type {
  LifecycleOptions as IntegrationLifecycleOptions,
  GcReport as IntegrationGcReport,
  LifecycleStats as IntegrationLifecycleStats,
  ConsolidatedEventPayload,
  PrunedEventPayload as IntegrationPrunedEventPayload,
  ConflictEventPayload,
} from './integration/lifecycle.js';