/**
 * MAM Observability
 *
 * Standalone observability engine: Traces, Metrics, Token usage, Costs and
 * Evaluation layers.
 */

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------
export {
  TraceSpan,
  Trace,
  TraceConfig,
  DEFAULT_TRACE_CONFIG,
  TraceStats,
  SpanOptions,
  TraceEvent,
  SpanStatus,
  SPAN_STATUSES,
  TraceEventType,
  TraceSortOrder,
  SerializedTraceStore,
} from './traces/types.js';
export { TraceStore, TraceListSort, ListOptions, DEFAULT_LIST_LIMIT } from './traces/store.js';
export { TraceIndex, TraceIndexStats, DEFAULT_INDEX_LIMIT } from './traces/index.js';
export { TraceQuery, TraceTree, TraceRebuildOptions, DEFAULT_QUERY_LIMIT } from './traces/retrieval.js';
export { TraceLifecycle, TraceEventHandler, CompleteSpanOptions, StartOptions } from './traces/lifecycle.js';
export {
  SpanNotFoundError,
  TraceRecorder,
  TraceAdapterOptions,
  TraceAdapter,
  Tracer,
  createTraceAdapter,
  createTracer,
} from './traces/integration.js';

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export {
  MetricType,
  Timestamp,
  MetricUnit as MetricMetricUnit,
  MetricLabels,
  MetricSample,
  Metric,
  MetricSummary,
  MetricsStats,
  MetricsConfig,
  MetricOptions,
  MetricQueryOptions,
  CounterHandle,
} from './metrics/types.js';
export {
  MetricStore,
  DEFAULT_METRICS_CONFIG,
  resolveConfig,
  percentile,
  PruneEventDetail,
  ResetEventDetail,
} from './metrics/store.js';
export { MetricIndex, IndexStats, normalizeLabelKey, normalizeLabelValue } from './metrics/index.js';
export { MetricQuery, AggregateRow, RateResult } from './metrics/retrieval.js';
export { MetricLifecycle, MetricLifecycleOptions, resolveLifecycleOptions } from './metrics/lifecycle.js';
export {
  MetricsRegistry,
  MetricsAdapter,
  createMetricsRegistry,
  createMetricsAdapter,
} from './metrics/integration.js';

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------
export {
  TokenUsageRecord,
  TokenBudget,
  TokenUsageConfig,
  TokenUsageOptions,
  TokenUsageStats,
  TokenTotals,
  TotalsMap,
  PruneResult,
  RollupSnapshot,
  EMPTY_TOTALS,
} from './token-usage/types.js';
export { TokenUsageStore, createTokenUsageStore, TokenUsageStoreSnapshot } from './token-usage/store.js';
export { TokenUsageIndex, createTokenUsageIndex, TokenUsageIndexStats } from './token-usage/index.js';
export {
  TokenUsageQuery,
  createTokenUsageQuery,
  TokenUsageSource,
  BudgetUsage,
  AverageUsage,
  LargestUsage,
} from './token-usage/retrieval.js';
export {
  TokenUsageLifecycle,
  createTokenUsageLifecycle,
  TokenUsageLifecycleEmitter,
  TokenUsageLifecycleState,
  LIFECYCLE_EVENTS,
} from './token-usage/lifecycle.js';
export {
  TokenUsageCollector,
  TokenUsageSession,
  TokenUsageTracker,
  TokenUsageAdapter,
  createTokenUsageAdapter,
  createTokenUsageTracker,
} from './token-usage/integration.js';

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------
export {
  CostCurrency,
  SUPPORTED_CURRENCIES,
  CURRENCY_SYMBOLS,
  DEFAULT_CURRENCY,
  isCurrency,
  DEFAULT_PRECISION,
  CostProvider,
  CostModel,
  CostSessionId,
  CostCallId,
  UNKNOWN_PROVIDER,
} from './costs/types.js';
export { CostStore, CostStoreSnapshot } from './costs/store.js';
export { CostIndex, CostIndexStats } from './costs/index.js';
export {
  CostQuery,
  createQuery,
  CostQuerySource,
  CostGroupBy,
  CostTokenTotals,
  QUERY_PRECISION,
} from './costs/retrieval.js';
export { CostLifecycle, CostLifecycleOptions, COST_EVENTS, CostEventName, PruneEvent } from './costs/lifecycle.js';
export {
  CostCollector,
  CostEstimate,
  TrackCallOptions,
  TrackerHandle,
  CostTrackerOptions,
  CostCalculator,
  CostTracker,
  CostAdapterOptions,
  CostAdapter,
  createCostTracker,
  createCostAdapter,
  createCostPipeline,
} from './costs/integration.js';

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
export {
  MetricUnit as EvaluationMetricUnit,
  ThresholdComparison,
  EvaluationMetric,
  EvaluationThreshold,
  QualityGate,
  GateOutcome,
  EvaluationCheck,
  EvaluationResult,
  EvaluationWeights,
  EvaluationThresholds,
  EvaluationConfig,
  EvalOptions,
} from './evaluation/types.js';
export { EvaluationStore, SerializedEvaluationStore, createResultId } from './evaluation/store.js';
export { EvaluationIndex } from './evaluation/index.js';
export { EvaluationQuery, ResultSource, TrendPoint } from './evaluation/retrieval.js';
export { EvaluationLifecycle } from './evaluation/lifecycle.js';
export {
  GateReport,
  SuiteItem,
  Evaluator,
  EvaluationEngine,
  createEvaluator,
  createEvaluationEngine,
  resolveThreshold,
} from './evaluation/integration.js';