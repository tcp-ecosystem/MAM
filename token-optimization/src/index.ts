/**
 * MAM Token Optimization Engine
 *
 * Standalone token-optimization engine: **Estimation**, **Budgeting**,
 * **Compression**, **Caching** and **Optimization** layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`). The per-layer
 * `index.ts` files are the *indexing* classes (`EstimateIndex`,
 * `AllocationIndex`, `CompressionIndex`, `CacheIndex`, `OptimizationIndex`),
 * NOT barrels, so they are re-exported under their class names only.
 *
 * Names that collide across layers are aliased with a layer prefix so every
 * name stays unique at the package root:
 *
 *   - Estimation  -> `Estimation*`  (e.g. `EstimationDefaultCharsPerToken`,
 *                    `EstimationHashContent`, `EstimationLifecycleStats`)
 *   - Budgeting   -> `Budgeting*`   (e.g. `BudgetingEstimateTokens`,
 *                    `BudgetingCreateLifecycle`, `BudgetingPruneSummary`)
 *   - Compression -> `Compression*` (e.g. `CompressionStoreSnapshot`,
 *                    `CompressionSplitSentences`, `CompressionPrunedEvent`)
 *   - Caching     -> `Caching*`     (e.g. `CachingEstimateTokens`,
 *                    `CachingIsFiniteNumber`, `CachingPruneSummary`)
 *   - Optimization-> `Optimization*`(e.g. `OptimizationEstimateTokens`,
 *                    `OptimizationCreateLifecycle`, `OptimizationPruneSummary`)
 *
 * Names that exist in exactly one layer are exported unchanged (e.g.
 * `TokenEstimator`, `BudgetAllocator`, `TokenCompressor`, `CacheManager`,
 * `PromptOptimizer`).
 */

// ---------------------------------------------------------------------------
// Estimation layer
// ---------------------------------------------------------------------------

// estimation/types.ts
export {
  ESTIMATION_METHODS,
  DEFAULT_CHARS_PER_TOKEN as EstimationDefaultCharsPerToken,
  DEFAULT_WORDS_PER_TOKEN as EstimationDefaultWordsPerToken,
  DEFAULT_TOKENS_PER_WORD,
  MIN_CHARS_PER_TOKEN,
  MAX_CHARS_PER_TOKEN,
  CONFIDENT_MIN_CHARS,
  LENGTH_BUCKET_SIZE,
  MODEL_PROFILES,
  DEFAULT_MODEL_ID,
  DEFAULT_ESTIMATION_CONFIG,
  DEFAULT_MODEL_PROFILES,
  isEstimationMethod,
  isModelProfile,
  isTokenEstimate,
  isEstimateOptions,
  createModelProfile,
  createTokenEstimate,
  createCalibrationSample,
  normalizeEstimationConfig,
  resolveModelProfile,
  lengthBucketFor,
} from './estimation/types.js';
export type {
  TokenEstimationMethod,
  CalibrationSample,
  TokenEstimate,
  ModelProfile,
  LengthCalibrationConfig,
  EstimationConfig,
  EstimateOptions,
  EstimationStats,
  StoreSnapshot as EstimationStoreSnapshot,
} from './estimation/types.js';

// estimation/store.ts
export {
  DEFAULT_MAX_CACHE_ENTRIES as EstimationDefaultMaxCacheEntries,
  MIN_MAX_CACHE_ENTRIES as EstimationMinMaxCacheEntries,
  hashContent as EstimationHashContent,
  buildKey as EstimationBuildKey,
  parseKey as EstimationParseKey,
  EstimateStore,
} from './estimation/store.js';
export type {
  EstimateStoreOptions,
} from './estimation/store.js';

// estimation/index.ts
export {
  MIN_MAX_BUCKETS as EstimationMinMaxBuckets,
  DEFAULT_MAX_BUCKETS as EstimationDefaultMaxBuckets,
  bucketLabel as EstimationBucketLabel,
  EstimateIndex,
  bucketsCoveringRange as EstimationBucketsCoveringRange,
  INDEXED_METHODS,
} from './estimation/index.js';
export type {
  EstimateIndexOptions,
  IndexStats as EstimationIndexStats,
  ModelIndexStats,
  LengthBucketIndexStats,
  EstimationMethodIndexStats,
} from './estimation/index.js';

// estimation/retrieval.ts
export {
  HEURISTIC_CONFIDENCE_FLOOR,
  LONG_TEXT_CONFIDENCE_BONUS,
  MAX_CALIBRATION_SAMPLES_PER_MODEL,
  TokenEstimator,
} from './estimation/retrieval.js';
export type {
  TokenEstimatorOptions,
} from './estimation/retrieval.js';

// estimation/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as EstimationDefaultGcIntervalMs,
  MIN_GC_INTERVAL_MS as EstimationMinGcIntervalMs,
  EstimationLifecycle,
} from './estimation/lifecycle.js';
export type {
  EstimationLifecycleOptions,
  PrunedEvent as EstimationPrunedEvent,
  LifecycleStats as EstimationLifecycleStats,
} from './estimation/lifecycle.js';

// ---------------------------------------------------------------------------
// Budgeting layer
// ---------------------------------------------------------------------------

// budgeting/types.ts
export {
  CANONICAL_SECTIONS,
  CANONICAL_SECTION_SET,
  OVERRUN_POLICIES,
  FIT_STATUSES,
  DEFAULT_LIMIT,
  DEFAULT_MAX_TOTAL,
  DEFAULT_BUDGET_CONFIG,
  isFiniteNumber as BudgetingIsFiniteNumber,
  isFiniteNonNegative as BudgetingIsFiniteNonNegative,
  isNonNegativeInteger as BudgetingIsNonNegativeInteger,
  isSectionName,
  isOverrunPolicy,
  isSectionAllocation,
  isBudgetConfig,
  isAllocationResult,
  isBudgetSnapshot,
  isBudgetStats,
  isAllocateOptions,
  isFitResult,
  createSectionAllocation,
  createAllocationResult,
  createBudgetSnapshot,
  createFitResult,
  emptyFitResult,
  normalizeBudgetConfig,
  sectionLimit,
  totalLimit,
  sumUsed,
  sumLimits,
  sumReserved,
} from './budgeting/types.js';
export type {
  CanonicalSection,
  OverrunPolicy,
  FitStatus,
  SectionAllocation,
  BudgetConfig,
  AllocateOptions,
  AllocationResult,
  BudgetSnapshot,
  BudgetStats,
  FitResult,
} from './budgeting/types.js';

// budgeting/store.ts
export {
  AllocationStore,
  storeFromAllocations,
} from './budgeting/store.js';
export type {
  AllocationStoreJSON,
  AllocateStoreOptions,
} from './budgeting/store.js';

// budgeting/index.ts
export {
  INDEX_STATUSES,
  AllocationIndex,
  classify,
} from './budgeting/index.js';
export type {
  IndexStatus,
  IndexedEntry,
  IndexStats as BudgetingIndexStats,
  AllocationIndexJSON,
  AllocationIndexOptions,
} from './budgeting/index.js';

// budgeting/retrieval.ts
export {
  CHARS_PER_TOKEN as BudgetingCharsPerToken,
  ELLIPSIS_TOKENS,
  estimateTokens as BudgetingEstimateTokens,
  BudgetAllocator,
  createAllocator,
} from './budgeting/retrieval.js';
export type {
  AllocatorOptions,
  OverallTotals,
} from './budgeting/retrieval.js';

// budgeting/lifecycle.ts
export {
  BUDGET_EVENTS,
  MAX_SNAPSHOTS,
  DEFAULT_INTERVAL_MS,
  BudgetingLifecycle,
  createLifecycle as BudgetingCreateLifecycle,
} from './budgeting/lifecycle.js';
export type {
  BudgetingLifecycleEvents,
  PruneSummary as BudgetingPruneSummary,
  LifecycleOptions as BudgetingLifecycleOptions,
} from './budgeting/lifecycle.js';

// ---------------------------------------------------------------------------
// Compression layer
// ---------------------------------------------------------------------------

// compression/types.ts
export {
  TECHNIQUES,
  DEFAULT_MIN_BLOCK_LENGTH,
  DEFAULT_MAX_TOKENS,
  DEFAULT_CHARS_PER_TOKEN as CompressionDefaultCharsPerToken,
  DEFAULT_WORDS_PER_TOKEN as CompressionDefaultWordsPerToken,
  SAVINGS_BUCKET_SIZE,
  DEFAULT_COMPRESS_CONFIG,
  isCompressionTechnique,
  isTechniqueResult,
  isCompressionResult,
  isCompressConfig,
  isCompressOptions,
  isTokenCounter,
  createTechniqueResult,
  createCompressionResult,
  normalizeCompressConfig,
  savingsBucketFor,
  defaultTokenCounter,
} from './compression/types.js';
export type {
  CompressionTechnique,
  TechniqueResult,
  CompressionResult,
  CompressConfig,
  CompressOptions,
  CompressionStats,
  TokenCounter,
} from './compression/types.js';

// compression/store.ts
export {
  DEFAULT_MAX_CACHE_ENTRIES as CompressionDefaultMaxCacheEntries,
  MIN_MAX_CACHE_ENTRIES as CompressionMinMaxCacheEntries,
  hashContent as CompressionHashContent,
  buildKey as CompressionBuildKey,
  parseKey as CompressionParseKey,
  CompressionStore,
} from './compression/store.js';
export type {
  CompressionStoreOptions,
  StoreSnapshot as CompressionStoreSnapshot,
} from './compression/store.js';

// compression/index.ts
export {
  MIN_MAX_BUCKETS as CompressionMinMaxBuckets,
  DEFAULT_MAX_BUCKETS as CompressionDefaultMaxBuckets,
  bucketLabel as CompressionBucketLabel,
  CompressionIndex,
  bucketsCoveringRange as CompressionBucketsCoveringRange,
  INDEX_BUCKET_SIZE,
} from './compression/index.js';
export type {
  CompressionIndexOptions,
  IndexStats as CompressionIndexStats,
  TechniqueIndexStats,
  SavingsBucketIndexStats,
} from './compression/index.js';

// compression/retrieval.ts
export {
  LEADING_STOPWORDS,
  TRAILING_STOPWORDS,
  ABBREVIATIONS,
  TokenCompressor,
  splitSentences as CompressionSplitSentences,
  isStopword,
  isTechnique,
} from './compression/retrieval.js';
export type {
  TokenCompressorOptions,
} from './compression/retrieval.js';

// compression/lifecycle.ts
export {
  DEFAULT_GC_INTERVAL_MS as CompressionDefaultGcIntervalMs,
  MIN_GC_INTERVAL_MS as CompressionMinGcIntervalMs,
  CompressionLifecycle,
} from './compression/lifecycle.js';
export type {
  CompressionLifecycleOptions,
  PrunedEvent as CompressionPrunedEvent,
  LifecycleStats as CompressionLifecycleStats,
} from './compression/lifecycle.js';

// ---------------------------------------------------------------------------
// Caching layer
// ---------------------------------------------------------------------------

// caching/types.ts
export {
  TOKEN_ESTIMATE_CHARS,
  estimateTokens as CachingEstimateTokens,
  PROMOTION_STATUSES,
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_TTL_MS,
  DEFAULT_MIN_HITS_FOR_PROMOTION,
  WARM_HITS,
  DEFAULT_CACHE_CONFIG,
  isFiniteNumber as CachingIsFiniteNumber,
  isFiniteNonNegative as CachingIsFiniteNonNegative,
  isNonNegativeInteger as CachingIsNonNegativeInteger,
  isPositiveNumber,
  isSegmentId,
  isPromotionStatus,
  isCachedSegment,
  isCacheConfig,
  isCacheHit,
  isCacheStats,
  isCacheOptions,
  isCacheDecision,
  createCachedSegment,
  createCacheMiss,
  createCacheHit,
  createEmptyCacheStats,
  normalizeCacheConfig,
  promotionStatusFor,
  shouldPromote,
  decideForSegment,
  EVICTION_COLD_TOKEN_FLOOR,
} from './caching/types.js';
export type {
  PromotionStatus,
  CachedSegment,
  CacheConfig,
  CacheHit,
  CacheStats,
  CacheOptions,
  CacheDecision,
} from './caching/types.js';

// caching/store.ts
export {
  CacheSegmentStore,
  storeFromSegments,
} from './caching/store.js';
export type {
  CacheSegmentStoreJSON,
  PutStoreOptions,
  PruneStoreOptions,
  PruneSummary as CachingPruneSummary,
} from './caching/store.js';

// caching/index.ts
export {
  LENGTH_BUCKET_BOUNDS,
  lengthBucket,
  LENGTH_BUCKETS,
  CacheIndex,
  classifyBucket,
} from './caching/index.js';
export type {
  IndexedSegment,
  CacheIndexStats,
  CacheIndexJSON,
  CacheIndexOptions,
} from './caching/index.js';

// caching/retrieval.ts
export {
  fnv1a,
  segmentIdFor,
  CacheManager,
  createCacheManager,
} from './caching/retrieval.js';
export type {
  CacheManagerOptions,
  PrefixScore,
  EvictOptions,
  EvictSummary,
} from './caching/retrieval.js';

// caching/lifecycle.ts
export {
  CACHE_EVENTS,
  DEFAULT_SWEEP_INTERVAL_MS,
  MIN_SWEEP_INTERVAL_MS,
  CachingLifecycle,
  createCachingLifecycle,
  isValidSegmentId,
} from './caching/lifecycle.js';
export type {
  CachingLifecycleEvents,
  PruneLifecycleSummary,
  CachingLifecycleOptions,
} from './caching/lifecycle.js';

// ---------------------------------------------------------------------------
// Optimization layer
// ---------------------------------------------------------------------------

// optimization/types.ts
export {
  SECTION_ROLES,
  SECTION_ROLE_SET,
  STRATEGY_NAMES,
  STRATEGY_SET,
  PRIORITY_MIN,
  PRIORITY_MAX,
  DEFAULT_PRIORITY,
  SYSTEM_PRIORITY,
  USER_PRIORITY,
  PRIORITY_LABELS,
  DEFAULT_CHARS_PER_TOKEN as OptimizationDefaultCharsPerToken,
  DEFAULT_SECTION_SEPARATOR,
  DEFAULT_STRATEGY_CONFIG,
  DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_PER_SECTION_BUDGET,
  DEFAULT_OPTIMIZATION_CONFIG,
  isFiniteNumber as OptimizationIsFiniteNumber,
  isFiniteNonNegative as OptimizationIsFiniteNonNegative,
  isNonNegativeInteger as OptimizationIsNonNegativeInteger,
  clampRange,
  clampPercent,
  isSectionRole,
  isPriority,
  isPromptSection,
  isStrategyConfig,
  isOptimizationConfig,
  isAnalysisResult,
  isOptimizeResult,
  isStrategyResult,
  isOptimizationStats,
  isOptimizeOptions,
  createPromptSection,
  createStrategyResult,
  createAnalysisResult,
  createOptimizeResult,
  createOptimizationStats,
  emptyAnalysisResult,
  zeroedOptimizationStats,
  normalizePriority,
  priorityLabel,
  sectionKey,
  indexOfSection,
  totalTokens,
  estimateFromText,
  resolveBudget,
  strategyEnabled,
  normalizeOptimizationConfig,
  sectionCeiling,
} from './optimization/types.js';
export type {
  SectionRole,
  StrategyName,
  PriorityLabel,
  PromptSection,
  PerSectionBudget,
  StrategyConfig,
  OptimizationConfig,
  SectionUsageMap,
  AnalysisResult,
  OptimizeResult,
  StrategyResult,
  OptimizeOptions,
  OptimizationStats,
} from './optimization/types.js';

// optimization/store.ts
export {
  DEFAULT_CACHE_CAP,
  FALLBACK_JSON_CAP,
  ACCESS_CLASSES,
  HOT_AGE_MS,
  WARM_AGE_MS,
  contentHash,
  OptimizationStore,
  accessClassFor,
  createOptimizationStore,
} from './optimization/store.js';
export type {
  AccessClass,
  OptimizationCacheEntry,
  OptimizationStoreJSON,
  OptimizationStoreStats,
  PutOptions,
} from './optimization/store.js';

// optimization/index.ts
export {
  SAVINGS_BUCKETS,
  SAVINGS_BUCKET_RANGES,
  bucketFor,
  bucketRange,
  isSavingsBucket,
  OptimizationIndex,
  createOptimizationIndex,
} from './optimization/index.js';
export type {
  SavingsBucket,
  SavingsBucketRange,
  IndexedOptimization,
  OptimizationIndexJSON,
  OptimizationIndexStats,
  OptimizationIndexOptions,
} from './optimization/index.js';

// optimization/retrieval.ts
export {
  CHARS_PER_TOKEN as OptimizationCharsPerToken,
  DEFAULT_COMPRESS_MIN_TOKENS,
  DEFAULT_COMPRESS_MAX_PRIORITY,
  DEFAULT_DEDUPE_MIN_BLOCK_LENGTH,
  FILLER_WORDS,
  estimateTokens as OptimizationEstimateTokens,
  reorderSections,
  splitSentences as OptimizationSplitSentences,
  joinSections,
  PromptOptimizer,
  createOptimizer,
  section,
} from './optimization/retrieval.js';
export type {
  OptimizerOptions,
} from './optimization/retrieval.js';

// optimization/lifecycle.ts
export {
  OPTIMIZATION_EVENTS,
  DEFAULT_GC_INTERVAL_MS as OptimizationDefaultGcIntervalMs,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_IDLE_TTL_MS,
  OptimizationLifecycle,
  createLifecycle as OptimizationCreateLifecycle,
  ensureOptimizeOptions,
} from './optimization/lifecycle.js';
export type {
  OptimizationLifecycleEvents,
  PruneSummary as OptimizationPruneSummary,
  LifecycleOptions as OptimizationLifecycleOptions,
} from './optimization/lifecycle.js';