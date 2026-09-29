/**
 * MAM Context Engine
 *
 * Standalone context engine: Context Assembly, Token Budgeting, Compression,
 * Summarization and Prioritization layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`,
 * `./<layer>/integration.js`). The per-layer `index.ts` files are the
 * *indexing* classes (`AssemblyIndex`, `BudgetIndex`, `CompressionIndex`,
 * `SummarizationIndex`), NOT barrels, so they are not re-exported here.
 *
 * Names that collide across layers (e.g. `Timestamp`, `estimateTokens`,
 * `LifecycleStats`, `PruneEvent`, `TECHNIQUES`, `DEFAULT_MAX_LENGTH`) are
 * aliased with a layer prefix so every name stays unique at the package root.
 */

// ---------------------------------------------------------------------------
// Context Assembly
// ---------------------------------------------------------------------------
export {
  ContextRole,
  PartId,
  Timestamp as ContextTimestamp,
  OrderingStrategy,
  TagMode,
  ContextPart,
  PartInput,
  AssembledContext,
  AssemblyConfig,
  AssembleOptions,
  AssemblyStats,
  ALL_ROLES,
  ROLE_PRIORITY,
  ROLE_RETENTION,
  ROLE_MARKERS,
  DEFAULT_SEPARATOR,
  DEFAULT_MAX_TOKENS,
  DEFAULT_DEDUPE,
  DEFAULT_ORDERING,
  DEFAULT_PROTECTED_ROLES,
  isContextRole,
  isContextPart,
  normalizeRole,
  normalizeText,
  estimateTokens as estimateAssemblyTokens,
  contentHash,
  partHash,
  createPart,
  createRolePart,
  systemPart,
  userPart,
  assistantPart,
  toolPart,
  memoryPart,
  knowledgePart,
  examplePart,
  resolveRolePriority,
  resolveRetention,
  mergeConfig,
  emptyRoleCounts,
} from './context-assembly/types.js';
export {
  STORE_SNAPSHOT_VERSION,
  StoreFilter,
  StoreSnapshot,
  StoreStats,
  PartPredicate,
  ContextAssemblyStore,
} from './context-assembly/store.js';
export {
  IndexStats,
  IndexQuery,
  AssemblyIndex,
  isValidIndexedRole,
  normalizeIndexRole,
} from './context-assembly/index.js';
export {
  BuildPromptOptions,
  AssemblerTotals,
  ContextAssembler,
  estimatePartTokens,
  createAssembler,
} from './context-assembly/retrieval.js';
export {
  DEFAULT_TTL_MS,
  DEFAULT_INTERVAL_MS,
  LifecycleEventType,
  LifecycleEvent,
  LifecycleConfig,
  LifecycleStats as AssemblyLifecycleStats,
  AssemblyLifecycle,
  createLifecycle,
} from './context-assembly/lifecycle.js';
export {
  ContextAssembler as ContextAssemblerInterface,
  ContextAssemblerAdapter,
  createContextAssembler,
  PipelineConfig,
  ContextPipeline,
  estimatePromptTokens,
} from './context-assembly/integration.js';

// ---------------------------------------------------------------------------
// Token Budgeting
// ---------------------------------------------------------------------------
export {
  SectionName,
  OverrunPolicy,
  BudgetStatus,
  SectionBudget,
  TokenBudgetConfig,
  BudgetOptions,
  BudgetAllocation,
  BudgetCheck,
  BudgetState,
  BudgetStats,
  BudgetAvailability,
  FitResult,
  Timestamp as BudgetTimestamp,
  CANONICAL_SECTIONS,
  DEFAULT_SECTION_LIMIT,
  DEFAULT_PER_SECTION_LIMITS,
  DEFAULT_OVERRUN_POLICY,
  WARN_THRESHOLD,
  CRITICAL_THRESHOLD,
  DEFAULT_GC_INTERVAL_MS,
  DEFAULT_MAX_SECTIONS,
  clampTokens,
  isSectionName,
  isOverrunPolicy,
  isSectionBudget,
  estimateTokens as estimateBudgetTokens,
  remainingTokens,
  budgetUtilization,
  computeStatus,
  createSectionBudget,
  defaultTokenBudgetConfig,
  mergeTokenBudgetConfig,
  effectiveLimit,
  budgetTotals,
} from './token-budgeting/types.js';
export {
  BudgetEventPayload,
  TokenBudgetStoreOptions,
  TokenBudgetStore,
} from './token-budgeting/store.js';
export {
  BudgetIndexOptions,
  BudgetIndexStats,
  BudgetIndex,
} from './token-budgeting/index.js';
export { OverallTotals, BudgetManager, resolvePolicy } from './token-budgeting/retrieval.js';
export {
  BudgetLifecycleOptions,
  LifecycleStats as BudgetLifecycleStats,
  PruneEvent as BudgetPruneEvent,
  BudgetLifecycle,
} from './token-budgeting/lifecycle.js';
export {
  TokenBudget,
  TokenBudgeterOptions,
  TokenBudgeter,
  BudgetAdapterOptions,
  BudgetAdapter,
  createTokenBudgeter,
  createBudgetAdapter,
} from './token-budgeting/integration.js';

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------
export {
  CompressionTechnique,
  RatioBucket,
  Timestamp as CompressionTimestamp,
  CompressionResult,
  CompressionConfig,
  CompressOptions,
  CompressionStats,
  CompressionState,
  TECHNIQUES as CompressionTechniques,
  RATIO_BUCKETS,
  DEFAULT_MAX_LENGTH as CompressionDefaultMaxLength,
  DEFAULT_TECHNIQUE as CompressionDefaultTechnique,
  DEFAULT_RATIO_EDGES,
  DEFAULT_MAX_ENTRIES as CompressionDefaultMaxEntries,
  DEFAULT_KEYWORD_COUNT,
  MIN_KEYWORDS,
  MAX_KEYWORDS,
  clampLength as clampCompressionLength,
  clampKeywordCount,
  estimateTokens as estimateCompressionTokens,
  computeRatio,
  isCompressionTechnique,
  isRatioBucket,
  isCompressionResult,
  ratioBucket,
  defaultCompressionConfig,
  mergeCompressionConfig,
  resolveCompressOptions,
} from './compression/types.js';
export {
  CompressionStoreEvent,
  CompressionStorePutEvent,
  CompressionStorePruneEvent,
  CompressionStoreOptions,
  compressionKey,
  CompressionStore,
} from './compression/store.js';
export {
  CompressionIndexOptions,
  CompressionIndexStats,
  CompressionIndex,
} from './compression/index.js';
export {
  TextCompressorOptions,
  DedupeResult,
  StripMarkdownResult,
  KeywordScore,
  TextCompressor,
} from './compression/retrieval.js';
export {
  CompressionLifecycleOptions,
  LifecycleStats as CompressionLifecycleStats,
  PruneEvent as CompressionPruneEvent,
  CompressedEvent,
  CompressionLifecycle,
} from './compression/lifecycle.js';
export {
  CompressorInterface,
  CompressorOptions,
  CompressionEventPayload,
  Compressor,
  CompressionAdapterOptions,
  CompressionAdapter,
  createCompressor,
} from './compression/integration.js';

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------
export {
  SummarizeTechnique,
  KeyPoint,
  SummaryResult,
  SummarizationConfig,
  SummarizeOptions,
  SummarizationStats,
  Timestamp as SummarizationTimestamp,
  TECHNIQUES as SummarizationTechniques,
  DEFAULT_TECHNIQUE as SummarizationDefaultTechnique,
  DEFAULT_MAX_SENTENCES,
  DEFAULT_MAX_LENGTH as SummarizationDefaultMaxLength,
  DEFAULT_MIN_SCORE,
  DEFAULT_BUCKET_WIDTH,
  clampScore,
  clampSentences,
  clampLength as clampSummaryLength,
  resolveMaxSentences,
  ratioFor,
  lengthBucket,
  hashString,
  isSummarizeTechnique,
  isKeyPoint,
  isSummaryResult,
  emptyTechniqueCounts,
  defaultSummarizationConfig,
  mergeSummarizationConfig,
  createSummaryResult,
  emptySummarizationStats,
} from './summarization/types.js';
export {
  SummarizationStoreEntry,
  SummarizationStoreState,
  SummarizationStoreOptions,
  SummarizationEventPayload,
  SummarizationStore,
} from './summarization/store.js';
export {
  IndexedSummary,
  SummarizationIndexOptions,
  SummarizationIndexStats,
  SummarizationIndex,
  isIndexedTechnique,
} from './summarization/index.js';
export {
  ScoredSentence,
  SectionGist,
  RollingOptions,
  TextSummarizerOptions,
  TextSummarizerStats,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_STEPS,
  SENTENCE_ABBREVIATIONS,
  DEFAULT_STOPWORDS,
  TextSummarizer,
} from './summarization/retrieval.js';
export {
  SummarizationLifecycleOptions,
  DEFAULT_MAX_ENTRIES as SummarizationDefaultMaxEntries,
  DEFAULT_PRUNE_INTERVAL_MS,
  LifecycleStats as SummarizationLifecycleStats,
  PruneEvent as SummarizationPruneEvent,
  SummarizedEvent,
  SummarizationLifecycle,
} from './summarization/lifecycle.js';
export {
  SummarizerInterface,
  SummarizerOptions,
  summarizationCacheKey,
  Summarizer,
  SummarizationAdapterOptions,
  SummarizationAdapter,
  createSummarizer,
  createSummarizationAdapter,
} from './summarization/integration.js';

// ---------------------------------------------------------------------------
// Prioritization
// ---------------------------------------------------------------------------
export {
  PartRole,
  PriorityBucket,
  Timestamp as PriorityTimestamp,
  PriorityScore,
  ContextPart as PriorityContextPart,
  PrioritizationConfig,
  PrioritizeOptions,
  PriorityEntry,
  PrioritizationStats,
  PriorityIndexStats,
  PriorityState,
  DEFAULT_DECAY_HOURS,
  DEFAULT_RECENCY_WEIGHT,
  DEFAULT_RELEVANCE_WEIGHT,
  DEFAULT_ROLE_WEIGHT,
  DEFAULT_SIZE_WEIGHT,
  DEFAULT_ROLE,
  DEFAULT_ROLE_WEIGHTS,
  CHARS_PER_TOKEN,
  DEFAULT_IDEAL_TOKENS,
  DEFAULT_BUCKET_EDGES,
  DEFAULT_MAX_ENTRIES as PriorityDefaultMaxEntries,
  defaultPrioritizationConfig,
  mergePrioritizationConfig,
  configFromOptions,
  scoreBucket,
  clampScore as priorityClampScore,
  estimateTokens as estimatePriorityTokens,
  roleTerm,
  extractQueryTerms,
  isPriorityScore,
  fnv1a,
  partHash as priorityPartHash,
} from './prioritization/types.js';
export {
  PriorityStoreEvent,
  PriorityStorePutEvent,
  PriorityStorePruneEvent,
  PriorityStoreOptions,
  PriorityStore,
} from './prioritization/store.js';
export {
  PriorityIndexOptions,
  PriorityIndexEntry,
  PriorityIndex,
} from './prioritization/index.js';
export {
  PriorityScorerOptions,
  BudgetSelection,
  PriorityScorer,
  createScorer,
} from './prioritization/retrieval.js';
export {
  PriorityLifecyclePruneEvent,
  PriorityLifecycleScoredEvent,
  PriorityLifecycleOptions,
  PriorityLifecycle,
} from './prioritization/lifecycle.js';
export {
  PrioritizerInterface,
  PrioritizerOptions,
  Prioritizer,
  PrioritizationAdapter,
  createPrioritizer,
} from './prioritization/integration.js';