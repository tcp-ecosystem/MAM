/**
 * @fileoverview Query engine for aggregated token usage analytics.
 *
 * While the store answers "which records exist?" and the index answers "find
 * records by dimension quickly?", {@link TokenUsageQuery} answers "how many
 * tokens were consumed, by model/provider/session, over a range, and relative
 * to a budget?". Every method returns plain, computed data structures and
 * never mutates its source, making the query layer safe to call from anywhere
 * in the observability engine.
 *
 * The query layer is deliberately read-only: it accepts a read source (a
 * {@link TokenUsageStore} or any iterable of records) and produces derived
 * statistics. This separation keeps queries cheap to unit test and trivial to
 * memoise at call sites when the underlying store is immutable for a window.
 *
 * @packageDocumentation
 */

import {
  EMPTY_TOTALS,
  normalizeTokenCount,
  providerOf,
  DEFAULT_TOKEN_USAGE_CONFIG,
  type MutableTokenTotals,
  type TokenBudget,
  type TokenUsageConfig,
  type TokenUsageRecord,
  type TokenTotals,
  type TotalsMap,
} from './types.js';

/**
 * The source of records a {@link TokenUsageQuery} reads from. Any iterable of
 * records satisfies the contract, so the query engine works with stores,
 * snapshots, arrays, or generator pipelines alike.
 */
export type TokenUsageSource = Iterable<TokenUsageRecord>;

/**
 * Result of {@link TokenUsageQuery.budgetUsage}: how much of a budget has been
 * consumed, both in absolute terms and as a percentage.
 */
export interface BudgetUsage {
  /**
   * The budget the result was computed against.
   */
  readonly budget: TokenBudget;

  /**
   * Total tokens counted against the budget.
   */
  readonly consumedTokens: number;

  /**
   * Total cost counted against the budget, or `0`.
   */
  readonly consumedCost: number;

  /**
   * Fraction of the token limit consumed, from `0` to `1` (or greater when
   * the budget is exceeded). `0` when the budget has no token limit.
   */
  readonly tokenRatio: number;

  /**
   * Fraction of the cost limit consumed, from `0` to `1` (or greater when
   * exceeded). `0` when the budget has no cost limit.
   */
  readonly costRatio: number;

  /**
   * Percentage of the token limit consumed, `0..100+`. Shorthand for
   * `tokenRatio * 100`.
   */
  readonly tokenPercent: number;

  /**
   * Percentage of the cost limit consumed, `0..100+`. Shorthand for
   * `costRatio * 100`.
   */
  readonly costPercent: number;

  /**
   * `true` when the token or cost limit has been exceeded.
   */
  readonly exceeded: boolean;
}

/**
 * Result of {@link TokenUsageQuery.averagePerCall}: mean token consumption per
 * call plus the underlying raw sums.
 */
export interface AverageUsage {
  /**
   * Mean total tokens per call.
   */
  readonly averageTotalTokens: number;

  /**
   * Mean input tokens per call.
   */
  readonly averageInputTokens: number;

  /**
   * Mean output tokens per call.
   */
  readonly averageOutputTokens: number;

  /**
   * Mean cost per call, or `0` when no costs are known.
   */
  readonly averageCost: number;

  /**
   * Number of calls the averages were computed over.
   */
  readonly callCount: number;
}

/**
 * A single row of {@link TokenUsageQuery.largest}: the biggest consumers of
 * tokens, ranked descending.
 */
export interface LargestUsage {
  /**
   * The record id.
   */
  readonly id: string;

  /**
   * The model that produced the record.
   */
  readonly model: string;

  /**
   * The provider that served the record.
   */
  readonly provider: string;

  /**
   * Total tokens consumed by the call.
   */
  readonly totalTokens: number;

  /**
   * Timestamp of the call.
   */
  readonly timestamp: number;

  /**
   * Optional session id, when the call was session-bound.
   */
  readonly sessionId?: string;
}

/**
 * Read-only aggregation engine over token usage records.
 *
 * Every method is pure with respect to its source: it iterates the provided
 * records (or the store behind it) and returns freshly computed aggregates.
 * No method writes to the source, so query objects can be created once and
 * re-used while the store continues to grow.
 *
 * @example
 * ```ts
 * const query = new TokenUsageQuery(store);
 * query.totalsByModel();                       // Map<'gpt-4o', TokenTotals>
 * query.sessionUsage('session-42');            // TokenTotals for one session
 * query.budgetUsage({ name: 'Q3', limit: 1e6 });
 * ```
 */
export class TokenUsageQuery {
  /** Records to aggregate over. */
  private readonly source: TokenUsageSource;

  /** Effective configuration for provider fallback behaviour. */
  private readonly config: TokenUsageConfig;

  /**
   * Creates a query engine bound to a read source.
   *
   * @param source - The records to aggregate. Accepts a store, an array, or
   * any iterable.
   * @param config - Optional configuration overrides.
   */
  constructor(source: TokenUsageSource, config?: Partial<TokenUsageConfig>) {
    this.source = source;
    this.config = { ...DEFAULT_TOKEN_USAGE_CONFIG, ...config };
  }

  /**
   * Aggregates total tokens per model.
   *
   * @returns A {@link TotalsMap} keyed by model name. A model is present only
   * when at least one record exists for it. The map is freshly allocated per
   * call.
   */
  totalsByModel(): TotalsMap {
    return this.aggregate((record) => record.model);
  }

  /**
   * Aggregates total tokens per provider.
   *
   * Records without an explicit provider are grouped under the configured
   * default provider label.
   *
   * @returns A {@link TotalsMap} keyed by provider label.
   */
  totalsByProvider(): TotalsMap {
    return this.aggregate((record) => providerOf(record, this.config.defaultProvider));
  }

  /**
   * Aggregates the total usage attributed to a single session.
   *
   * Records not bound to the given session id are ignored, as are records
   * with no session at all.
   *
   * @param sessionId - The session id to aggregate.
   * @returns The session's {@link TokenTotals}, or {@link EMPTY_TOTALS} when
   * no records match.
   */
  sessionUsage(sessionId: string): TokenTotals {
    const totals = this.emptyTotals();
    for (const record of this.source) {
      if (record.sessionId === sessionId) {
        this.fold(totals, record);
      }
    }
    return totals.callCount === 0 ? EMPTY_TOTALS : totals;
  }

  /**
   * Aggregates the total usage within a timestamp range, inclusive on both
   * ends.
   *
   * @param from - Inclusive lower bound (epoch ms).
   * @param to - Inclusive upper bound (epoch ms).
   * @returns The range's {@link TokenTotals}. When `to < from` an empty
   * result is returned.
   */
  range(from: number, to: number): TokenTotals {
    const totals = this.emptyTotals();
    if (to < from) {
      return EMPTY_TOTALS;
    }
    for (const record of this.source) {
      if (record.timestamp >= from && record.timestamp <= to) {
        this.fold(totals, record);
      }
    }
    return totals.callCount === 0 ? EMPTY_TOTALS : totals;
  }

  /**
   * Returns the `limit` largest calls by total tokens, ranked descending.
   *
   * @param limit - Maximum number of results. Clamped to a non-negative
   * integer; `0` returns an empty array.
   * @returns A new array of {@link LargestUsage} rows.
   */
  largest(limit: number): LargestUsage[] {
    const count = Math.max(0, Math.floor(limit));
    const ranked: LargestUsage[] = [];
    for (const record of this.source) {
      const row: LargestUsage = {
        id: record.id,
        model: record.model,
        provider: providerOf(record, this.config.defaultProvider),
        totalTokens: record.totalTokens,
        timestamp: record.timestamp,
        sessionId: record.sessionId,
      };
      if (ranked.length < count || row.totalTokens > ranked[ranked.length - 1]!.totalTokens) {
        ranked.push(row);
        ranked.sort((a, b) => b.totalTokens - a.totalTokens);
        if (ranked.length > count) {
          ranked.pop();
        }
      }
    }
    return ranked;
  }

  /**
   * Computes the mean token consumption per call across the source.
   *
   * @returns An {@link AverageUsage} describing the means. When the source is
   * empty, all averages are `0` and `callCount` is `0`.
   */
  averagePerCall(): AverageUsage {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let callCount = 0;
    for (const record of this.source) {
      inputTokens += record.inputTokens;
      outputTokens += record.outputTokens;
      totalTokens += record.totalTokens;
      totalCost += record.cost ?? 0;
      callCount += 1;
    }
    if (callCount === 0) {
      return {
        averageTotalTokens: 0,
        averageInputTokens: 0,
        averageOutputTokens: 0,
        averageCost: 0,
        callCount: 0,
      };
    }
    return {
      averageTotalTokens: totalTokens / callCount,
      averageInputTokens: inputTokens / callCount,
      averageOutputTokens: outputTokens / callCount,
      averageCost: totalCost / callCount,
      callCount,
    };
  }

  /**
   * Computes how much of a {@link TokenBudget} has been consumed.
   *
   * Only records matching the budget's optional `model`, `provider`,
   * `sessionId`, `startsAt`, and `endsAt` filters count toward consumption.
   * Percentages are clamped to `0` on the low end but may exceed `100` when
   * the budget is overspent.
   *
   * @param budget - The budget to evaluate against.
   * @returns A {@link BudgetUsage} describing consumption.
   */
  budgetUsage(budget: TokenBudget): BudgetUsage {
    const totals = this.emptyTotals();
    for (const record of this.source) {
      if (!this.budgetMatches(budget, record)) {
        continue;
      }
      this.fold(totals, record);
    }
    const tokenRatio =
      budget.limit > 0 ? Math.max(0, totals.totalTokens / budget.limit) : 0;
    const costRatio =
      typeof budget.costLimit === 'number' && budget.costLimit > 0
        ? Math.max(0, totals.totalCost / budget.costLimit)
        : 0;
    return {
      budget,
      consumedTokens: totals.totalTokens,
      consumedCost: totals.totalCost,
      tokenRatio,
      costRatio,
      tokenPercent: tokenRatio * 100,
      costPercent: costRatio * 100,
      exceeded: tokenRatio > 1 || costRatio > 1,
    };
  }

  /**
   * Convenience shorthand: returns the grand total across the whole source.
   *
   * @returns The {@link TokenTotals} for every record.
   */
  grandTotal(): TokenTotals {
    const totals = this.emptyTotals();
    for (const record of this.source) {
      this.fold(totals, record);
    }
    return totals.callCount === 0 ? EMPTY_TOTALS : totals;
  }

  /**
   * Returns the number of calls (records) in the source.
   *
   * @returns The record count.
   */
  callCount(): number {
    let count = 0;
    for (const _record of this.source) {
      count += 1;
    }
    return count;
  }

  /**
   * Aggregates the source into a dimension-keyed totals map.
   *
   * @param keys - Mapping from record to its dimension key.
   * @returns A fresh {@link TotalsMap}.
   */
  private aggregate(keys: (record: TokenUsageRecord) => string): TotalsMap {
    const map = new Map<string, MutableTokenTotals>();
    for (const record of this.source) {
      const key = keys(record);
      let totals = map.get(key);
      if (!totals) {
        totals = this.emptyTotals();
        map.set(key, totals);
      }
      this.fold(totals, record);
    }
    return map;
  }

  /**
   * Determines whether a record counts toward a budget.
   *
   * @param budget - The budget to match against.
   * @param record - The record to test.
   * @returns `true` when the record should count toward the budget.
   */
  private budgetMatches(budget: TokenBudget, record: TokenUsageRecord): boolean {
    if (budget.model !== undefined && budget.model !== record.model) {
      return false;
    }
    if (budget.provider !== undefined && budget.provider !== record.provider) {
      return false;
    }
    if (budget.sessionId !== undefined && budget.sessionId !== record.sessionId) {
      return false;
    }
    if (budget.startsAt !== undefined && record.timestamp < budget.startsAt) {
      return false;
    }
    if (budget.endsAt !== undefined && record.timestamp > budget.endsAt) {
      return false;
    }
    return true;
  }

  /**
   * Creates a fresh zeroed totals accumulator.
   *
   * @returns A mutable {@link MutableTokenTotals}.
   */
  private emptyTotals(): MutableTokenTotals {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0, callCount: 0 };
  }

  /**
   * Folds a single record's contribution into a totals accumulator.
   *
   * @param target - The mutable totals accumulator.
   * @param record - The record to fold in.
   */
  private fold(target: MutableTokenTotals, record: TokenUsageRecord): void {
    target.inputTokens += record.inputTokens;
    target.outputTokens += record.outputTokens;
    target.totalTokens += record.totalTokens;
    target.totalCost += record.cost ?? 0;
    target.callCount += 1;
  }
}

/**
 * Creates a query engine with a friendlier signature for the integration
 * layer.
 *
 * @param source - The records to aggregate.
 * @param config - Optional configuration overrides.
 * @returns A configured {@link TokenUsageQuery}.
 */
export function createTokenUsageQuery(
  source: TokenUsageSource,
  config?: Partial<TokenUsageConfig>,
): TokenUsageQuery {
  return new TokenUsageQuery(source, config);
}

/**
 * Re-export of the token-count normalizer so query consumers can sanitise
 * user-supplied limits without importing `./types.js` directly.
 */
export { normalizeTokenCount };