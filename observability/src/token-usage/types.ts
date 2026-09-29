/**
 * @fileoverview Core type definitions for the Token usage layer of the MAM
 * Observability engine.
 *
 * The Token usage layer is responsible for accounting for the input and output
 * tokens consumed by model calls, broken down per model, per provider, and per
 * individual call. This module defines the data contracts shared across the
 * {@link TokenUsageStore}, {@link TokenUsageIndex}, {@link TokenUsageQuery},
 * {@link TokenUsageLifecycle}, and {@link TokenUsageTracker} implementations.
 *
 * All monetary values are expressed in a single, arbitrary currency unit. All
 * token counts are non-negative integers. Timestamps are UNIX epoch
 * milliseconds. The types in this module are deliberately free of any runtime
 * dependency so they can be imported from any other layer of the engine
 * without side effects.
 *
 * @packageDocumentation
 */

/**
 * A single, immutable snapshot of the tokens consumed by one model call.
 *
 * A `TokenUsageRecord` is the atomic unit of the Token usage layer. Every
 * record is uniquely identified by {@link TokenUsageRecord.id} and carries the
 * counts of input and output tokens, an optional monetary cost estimate, and
 * optional contextual identifiers that link the record back to the session and
 * call that produced it.
 */
export interface TokenUsageRecord {
  /**
   * Globally unique identifier for the record. Should be stable across
   * serialization round-trips so records can be de-duplicated when merging
   * multiple stores or replaying persisted snapshots.
   */
  readonly id: string;

  /**
   * The model identifier as reported by the provider, for example
   * `"gpt-4o"`, `"claude-3-5-sonnet"`, or `"llama-3.1-70b-instruct"`. This is
   * the primary dimension along which token accounting is aggregated.
   */
  readonly model: string;

  /**
   * The provider identifier that served the call, for example `"openai"`,
   * `"anthropic"`, or `"local"`. Optional; when absent the record is grouped
   * under the synthetic `"unknown"` provider during aggregation.
   */
  readonly provider?: string;

  /**
   * Number of input (prompt) tokens billed for the call. Always a
   * non-negative integer.
   */
  readonly inputTokens: number;

  /**
   * Number of output (completion) tokens billed for the call. Always a
   * non-negative integer.
   */
  readonly outputTokens: number;

  /**
   * Total number of tokens billed for the call. This is normally equal to
   * `inputTokens + outputTokens`; callers may supply an explicit value when
   * the provider reports a total that differs from the arithmetic sum.
   */
  readonly totalTokens: number;

  /**
   * Estimated monetary cost of the call in the engine's canonical currency
   * unit. Optional; when absent the call is treated as cost-free during
   * aggregation.
   */
  readonly cost?: number;

  /**
   * Epoch milliseconds at which the call completed. Used for date-range
   * queries, pruning, and time-bucketed rollups.
   */
  readonly timestamp: number;

  /**
   * Optional identifier of the logical session that issued the call. When
   * present, all records sharing a session id can be aggregated with
   * {@link TokenUsageQuery.sessionUsage}.
   */
  readonly sessionId?: string;

  /**
   * Optional identifier of the individual call/request. Useful for correlating
   * token usage with tracing and logging data emitted elsewhere in the
   * observability engine.
   */
  readonly callId?: string;
}

/**
 * A declarative budget describing the maximum number of tokens a caller is
 * willing to spend within a period, optionally bound to a single model,
 * provider, or session.
 *
 * Budgets are consumed by {@link TokenUsageQuery.budgetUsage} to answer the
 * question "what percentage of my allowance has already been spent?".
 */
export interface TokenBudget {
  /**
   * Human readable label for the budget, e.g. `"2026 H1 inference budget"`.
   * Used in logs and reporting only.
   */
  readonly name: string;

  /**
   * Maximum number of total tokens allowed under the budget. Must be a
   * positive integer.
   */
  readonly limit: number;

  /**
   * When set, only records whose model matches this value count against the
   * budget. When omitted, all models count.
   */
  readonly model?: string;

  /**
   * When set, only records whose provider matches this value count against the
   * budget. When omitted, all providers count.
   */
  readonly provider?: string;

  /**
   * When set, only records whose session id matches this value count against
   * the budget. When omitted, all sessions count.
   */
  readonly sessionId?: string;

  /**
   * Epoch milliseconds at which the budget period begins. When omitted, the
   * budget is treated as open-ended on the low end.
   */
  readonly startsAt?: number;

  /**
   * Epoch milliseconds at which the budget period ends. When omitted, the
   * budget is treated as open-ended on the high end.
   */
  readonly endsAt?: number;

  /**
   * Optional monetary ceiling, in the engine's canonical currency unit. A
   * budget may cap tokens, cost, or both.
   */
  readonly costLimit?: number;
}

/**
 * Configuration knobs that tune the behaviour of the Token usage layer.
 *
 * The same configuration object is accepted by the store, the index, the
 * query engine, and the lifecycle manager so a single, consistent policy is
 * applied across the whole layer.
 */
export interface TokenUsageConfig {
  /**
   * Default provider label applied to records created without an explicit
   * provider. Defaults to `"unknown"`.
   */
  readonly defaultProvider: string;

  /**
   * Whether records should be de-duplicated by id inside the store. When
   * enabled, calling {@link TokenUsageStore.record} with an id that already
   * exists replaces the previous record instead of creating a duplicate.
   * Defaults to `true`.
   */
  readonly deduplicateById: boolean;

  /**
   * Whether to enforce that `totalTokens === inputTokens + outputTokens`.
   * When enabled, records that violate the invariant are normalized
   * (recomputed) rather than rejected. Defaults to `true`.
   */
  readonly enforceTotalInvariant: boolean;

  /**
   * Maximum number of records the store will hold before the lifecycle layer
   * should prune. A value of `0` disables the cap. Defaults to `0` (unbounded).
   */
  readonly maxRecords: number;

  /**
   * Default retention window in milliseconds used by
   * {@link TokenUsageLifecycle.prune} when no explicit age is supplied.
   * Defaults to 30 days.
   */
  readonly defaultRetentionMs: number;

  /**
   * Interval in milliseconds at which the lifecycle manager performs periodic
   * rollup snapshots while running. Defaults to 60 seconds.
   */
  readonly rollupIntervalMs: number;
}

/**
 * Options accepted by {@link TokenUsageStore.record} and
 * {@link TokenUsageTracker.record} to override config-derived defaults for a
 * single record.
 */
export interface TokenUsageOptions {
  /**
   * Overrides {@link TokenUsageConfig.defaultProvider} for this record only.
   */
  readonly provider?: string;

  /**
   * Optional monetary cost estimate for the call.
   */
  readonly cost?: number;

  /**
   * Optional session identifier to attach to the record.
   */
  readonly sessionId?: string;

  /**
   * Optional call identifier to attach to the record.
   */
  readonly callId?: string;

  /**
   * Optional explicit timestamp. Defaults to `Date.now()` when omitted.
   */
  readonly timestamp?: number;

  /**
   * Optional explicit record id. When omitted a v4-style id is generated.
   */
  readonly id?: string;
}

/**
 * A live snapshot of the contents of a {@link TokenUsageStore}.
 */
export interface TokenUsageStats {
  /**
   * Total number of records currently held.
   */
  readonly recordCount: number;

  /**
   * Total input tokens across every record.
   */
  readonly inputTokens: number;

  /**
   * Total output tokens across every record.
   */
  readonly outputTokens: number;

  /**
   * Total tokens (input + output) across every record.
   */
  readonly totalTokens: number;

  /**
   * Total estimated cost across every record, or `0` when no costs are known.
   */
  readonly totalCost: number;

  /**
   * Number of distinct models observed across all records.
   */
  readonly distinctModels: number;

  /**
   * Number of distinct providers observed across all records.
   */
  readonly distinctProviders: number;

  /**
   * Epoch milliseconds of the oldest record, or `0` when the store is empty.
   */
  readonly earliestTimestamp: number;

  /**
   * Epoch milliseconds of the newest record, or `0` when the store is empty.
   */
  readonly latestTimestamp: number;
}

/**
 * Aggregated token totals broken down by one dimension.
 *
 * Returned by the store's {@link TokenUsageStore.getTotals} and the query
 * engine's `totalsBy*` methods.
 */
export interface TokenTotals {
  /**
   * Grand total across every record included in the aggregation.
   */
  readonly inputTokens: number;

  /**
   * Grand total across every record included in the aggregation.
   */
  readonly outputTokens: number;

  /**
   * Grand total across every record included in the aggregation.
   */
  readonly totalTokens: number;

  /**
   * Grand total cost across every record included in the aggregation.
   */
  readonly totalCost: number;

  /**
   * Total number of calls (records) included in the aggregation.
   */
  readonly callCount: number;
}

/**
 * A map from a dimension key (model name, provider name, session id) to its
 * {@link TokenTotals}.
 */
export type TotalsMap = ReadonlyMap<string, TokenTotals>;

/**
 * A writable variant of {@link TokenTotals} used internally by aggregators.
 *
 * Aggregation routines (store totals, query folds, lifecycle rollups) mutate a
 * running accumulator before freezing it into the readonly {@link TokenTotals}
 * contract exposed to callers. This interface is the mutation-safe view of the
 * same shape; every `MutableTokenTotals` is assignable to `TokenTotals`.
 */
export interface MutableTokenTotals {
  /** Total input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Total tokens. */
  totalTokens: number;
  /** Total cost. */
  totalCost: number;
  /** Total number of calls. */
  callCount: number;
}

/**
 * Result of {@link TokenUsageLifecycle.prune}: how many records were removed
 * and how many remained.
 */
export interface PruneResult {
  /**
   * Number of records removed during the prune.
   */
  readonly pruned: number;

  /**
   * Number of records remaining in the store after the prune.
   */
  readonly remaining: number;

  /**
   * Epoch milliseconds at which the prune ran.
   */
  readonly prunedAt: number;
}

/**
 * A periodic rollup snapshot captured by the lifecycle manager.
 *
 * Rollups answer "how many tokens were consumed during the last interval?"
 * without requiring the caller to replay the entire store.
 */
export interface RollupSnapshot {
  /**
   * Epoch milliseconds at which the rollup window began.
   */
  readonly windowStart: number;

  /**
   * Epoch milliseconds at which the rollup window ended.
   */
  readonly windowEnd: number;

  /**
   * Totals observed within the window.
   */
  readonly totals: TokenTotals;

  /**
   * Per-model totals observed within the window.
   */
  readonly byModel: TotalsMap;

  /**
   * Per-provider totals observed within the window.
   */
  readonly byProvider: TotalsMap;
}

/**
 * The shape of the event payloads emitted by
 * {@link TokenUsageLifecycle} via `node:events`.
 */
export interface TokenUsageEventMap {
  /**
   * Emitted whenever a record is added to the underlying store.
   */
  readonly record: TokenUsageRecord;

  /**
   * Emitted after a prune removes one or more records.
   */
  readonly prune: PruneResult;

  /**
   * Emitted after a rollup snapshot is captured.
   */
  readonly rollup: RollupSnapshot;

  /**
   * Emitted after the lifecycle is stopped.
   */
  readonly stop: { stoppedAt: number };
}

/**
 * The canonical "no data" token totals constant. Returned by aggregation
 * functions when their input set is empty so callers never have to guard
 * against `undefined`.
 */
export const EMPTY_TOTALS: TokenTotals = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  callCount: 0,
});

/**
 * The canonical empty {@link TokenUsageStats}. Used as the initial value by
 * store implementations before any record is added.
 */
export const EMPTY_STATS: TokenUsageStats = Object.freeze({
  recordCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  distinctModels: 0,
  distinctProviders: 0,
  earliestTimestamp: 0,
  latestTimestamp: 0,
});

/**
 * Default configuration applied when a caller does not supply their own
 * {@link TokenUsageConfig}.
 */
export const DEFAULT_TOKEN_USAGE_CONFIG: TokenUsageConfig = Object.freeze({
  defaultProvider: 'unknown',
  deduplicateById: true,
  enforceTotalInvariant: true,
  maxRecords: 0,
  defaultRetentionMs: 30 * 24 * 60 * 60 * 1000,
  rollupIntervalMs: 60 * 1000,
});

/**
 * The provider label records are grouped under when no provider is known.
 */
export const UNKNOWN_PROVIDER: string = DEFAULT_TOKEN_USAGE_CONFIG.defaultProvider;

/**
 * A 64-bit friendly pseudo-random id generator producing v4-style UUIDs.
 *
 * Uses the platform CSPRNG when available (`node:crypto`'s `randomUUID`) and
 * falls back to a Math.random-based generator otherwise, so the layer remains
 * dependency-free.
 *
 * @returns A 36-character UUID v4 string.
 */
export function createRecordId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cryptoModule: { randomUUID?: () => string } | undefined = require('node:crypto') as {
    randomUUID?: () => string;
  };
  if (typeof cryptoModule?.randomUUID === 'function') {
    return cryptoModule.randomUUID();
  }
  const hex: string = '0123456789abcdef';
  let uuid: string = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[Math.floor(Math.random() * 4) + 8] ?? 'b';
    } else {
      uuid += hex[Math.floor(Math.random() * 16)] ?? '0';
    }
  }
  return uuid;
}

/**
 * Type guard for {@link TokenUsageRecord}. Verifies the structural shape of an
 * unknown value so callers can safely narrow data received from JSON,
 * message queues, or plugin boundaries.
 *
 * @param value - The value to inspect.
 * @returns `true` when the value is a structurally valid token usage record.
 */
export function isTokenUsageRecord(value: unknown): value is TokenUsageRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<TokenUsageRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.model === 'string' &&
    typeof record.inputTokens === 'number' &&
    Number.isFinite(record.inputTokens) &&
    record.inputTokens >= 0 &&
    typeof record.outputTokens === 'number' &&
    Number.isFinite(record.outputTokens) &&
    record.outputTokens >= 0 &&
    typeof record.totalTokens === 'number' &&
    Number.isFinite(record.totalTokens) &&
    record.totalTokens >= 0 &&
    typeof record.timestamp === 'number' &&
    Number.isFinite(record.timestamp)
  );
}

/**
 * Type guard for {@link TokenBudget}.
 *
 * @param value - The value to inspect.
 * @returns `true` when the value is a structurally valid budget.
 */
export function isTokenBudget(value: unknown): value is TokenBudget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const budget = value as Partial<TokenBudget>;
  return (
    typeof budget.name === 'string' &&
    typeof budget.limit === 'number' &&
    Number.isFinite(budget.limit) &&
    budget.limit > 0
  );
}

/**
 * Normalizes a raw token count to a non-negative safe integer, clamping
 * `NaN`, infinities, negatives, and fractional values.
 *
 * @param value - The raw count.
 * @returns A non-negative integer.
 */
export function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Computes the total token count for a record from its input and output
 * counts, honouring the store's total-invariant enforcement policy.
 *
 * @param inputTokens - The input token count.
 * @param outputTokens - The output token count.
 * @param reportedTotal - An optional provider-reported total.
 * @param enforceInvariant - Whether to trust the reported total or recompute.
 * @returns The effective total token count.
 */
export function computeTotalTokens(
  inputTokens: number,
  outputTokens: number,
  reportedTotal?: number,
  enforceInvariant = true,
): number {
  if (enforceInvariant || typeof reportedTotal !== 'number') {
    return normalizeTokenCount(inputTokens) + normalizeTokenCount(outputTokens);
  }
  return normalizeTokenCount(reportedTotal);
}

/**
 * Rounds a monetary cost to a fixed number of decimal places to avoid
 * floating point drift accumulating across thousands of records.
 *
 * @param cost - The raw cost value.
 * @param decimals - Number of decimals to keep (default 6).
 * @returns A non-negative rounded cost.
 */
export function normalizeCost(cost: number, decimals = 6): number {
  if (!Number.isFinite(cost)) {
    return 0;
  }
  const factor = 10 ** Math.max(0, Math.min(12, decimals));
  return Math.max(0, Math.round((cost + Number.EPSILON) * factor) / factor);
}

/**
 * Produces a canonical `YYYY-MM-DD` date key for a timestamp. Used by the
 * index to bucket records by calendar day for fast date-range lookups.
 *
 * @param timestamp - Epoch milliseconds.
 * @returns A `YYYY-MM-DD` string in the local timezone.
 */
export function dateKeyOf(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the effective provider for a record, applying the configurable
 * default when the record carries none.
 *
 * @param record - The record to inspect.
 * @param defaultProvider - The fallback provider label.
 * @returns A non-empty provider label.
 */
export function providerOf(record: TokenUsageRecord, defaultProvider: string): string {
  return record.provider && record.provider.length > 0 ? record.provider : defaultProvider;
}

/**
 * Returns the effective session id for a record, or `null` when the record is
 * not bound to a session.
 *
 * @param record - The record to inspect.
 * @returns The session id or `null`.
 */
export function sessionOf(record: TokenUsageRecord): string | null {
  return record.sessionId && record.sessionId.length > 0 ? record.sessionId : null;
}