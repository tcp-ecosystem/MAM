/**
 * retrieval.ts
 *
 * {@link CostQuery} — the read/query façade of the Costs layer.
 *
 * `CostQuery` wraps any source of {@link CostRecord} data — a {@link CostStore},
 * a {@link CostIndex}, or a plain array — behind a uniform, read-only query
 * API. It answers the money questions a dashboard or a budget guard cares
 * about:
 *
 *  - `total()`                — how much was spent, in total?
 *  - `byModel()`/`byProvider()` — where did the money go?
 *  - `sessionCost(sessionId)`  — how much did one session cost?
 *  - `range(from, to)`         — what happened in a window?
 *  - `top(limit)`              — what are the biggest spend buckets?
 *  - `averagePerCall()`        — what is the mean cost per invocation?
 *
 * All methods are pure with respect to the source: they snapshot and never
 * mutate. When the source is a store that already maintains aggregates, the
 * query still re-derives results from the live records so it always reflects
 * the latest state.
 *
 * @packageDocumentation
 */

import {
  type CostAggregate,
  type CostCurrency,
  type CostRecord,
  DEFAULT_CURRENCY,
  DEFAULT_PRECISION,
  UNKNOWN_PROVIDER,
  compareCostRecords,
  roundCost,
} from './types.js';
import type { CostStore } from './store.js';
import type { CostIndex } from './index.js';

/**
 * Anything that can back a {@link CostQuery}: a store, an index, or a plain
 * iterable of records.
 */
export type CostQuerySource = CostStore | CostIndex | Iterable<CostRecord>;

/**
 * Grouping dimensions supported by {@link CostQuery.top} and the `by*`
 * accessors.
 */
export type CostGroupBy = 'model' | 'provider' | 'session';

/**
 * Token totals over the queried set.
 */
export interface CostTokenTotals {
  /**
   * Total input (prompt) tokens.
   */
  tokensIn: number;
  /**
   * Total output (completion) tokens.
   */
  tokensOut: number;
  /**
   * Sum of input + output tokens.
   */
  total: number;
}

/**
 * CostQuery
 *
 * A read-only query object over a collection of cost records. Instantiate it
 * with any supported source and treat it as a stateless view: the same query
 * can be re-run any number of times and always reflects the current data.
 */
export class CostQuery {
  /** Backing source of records. */
  private readonly source: CostQuerySource;

  /** Currency used when reporting aggregates. */
  private readonly currency: CostCurrency;

  /**
   * @param source - Store, index or iterable to query.
   * @param currency - Currency label attached to aggregates (display only).
   */
  constructor(source: CostQuerySource, currency: CostCurrency = DEFAULT_CURRENCY) {
    this.source = source;
    this.currency = currency;
  }

  /**
   * Materializes the current record set as a fresh, sorted snapshot. The
   * snapshot is isolated from later mutations to the source.
   *
   * @returns Sorted record array.
   */
  private records(): CostRecord[] {
    const records: CostRecord[] = [];
    for (const record of this.source) {
      records.push(record);
    }
    return records.sort(compareCostRecords);
  }

  /**
   * Number of records in the queried set.
   *
   * @returns Record count.
   */
  count(): number {
    if (this.source instanceof Map) return this.source.size;
    let n = 0;
    for (const _record of this.source) n += 1;
    return n;
  }

  /**
   * Total monetary cost across every record in the set.
   *
   * @returns Sum of all costs, rounded.
   */
  total(): number {
    let sum = 0;
    for (const record of this.source) sum += record.cost;
    return roundCost(sum);
  }

  /**
   * Total input/output tokens across the set.
   *
   * @returns Token totals (see {@link CostTokenTotals}).
   */
  tokens(): CostTokenTotals {
    let tokensIn = 0;
    let tokensOut = 0;
    for (const record of this.source) {
      tokensIn += record.tokensIn;
      tokensOut += record.tokensOut;
    }
    return { tokensIn, tokensOut, total: tokensIn + tokensOut };
  }

  /**
   * Groups the set into buckets by a record field and computes a
   * {@link CostAggregate} for each bucket.
   *
   * @param field - Which field to group by.
   * @returns Aggregates, sorted by total cost descending (ties by key).
   */
  private groupBy(field: CostGroupBy): CostAggregate[] {
    const buckets = new Map<string, CostAggregate>();
    const init = (key: string): CostAggregate => ({
      key,
      count: 0,
      totalCost: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      averageCost: 0,
      minCost: 0,
      maxCost: 0,
      currency: this.currency,
      firstTimestamp: null,
      lastTimestamp: null,
    });
    for (const record of this.source) {
      const key = field === 'model' ? record.model : field === 'provider' ? (record.provider ?? UNKNOWN_PROVIDER) : (record.sessionId ?? '');
      if (key === '') continue;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = init(key);
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.totalCost = roundCost(bucket.totalCost + record.cost);
      bucket.totalTokensIn += record.tokensIn;
      bucket.totalTokensOut += record.tokensOut;
      bucket.minCost = bucket.count === 1 ? record.cost : Math.min(bucket.minCost, record.cost);
      bucket.maxCost = bucket.count === 1 ? record.cost : Math.max(bucket.maxCost, record.cost);
      bucket.firstTimestamp =
        bucket.firstTimestamp === null ? record.timestamp : Math.min(bucket.firstTimestamp, record.timestamp);
      bucket.lastTimestamp =
        bucket.lastTimestamp === null ? record.timestamp : Math.max(bucket.lastTimestamp, record.timestamp);
    }
    for (const bucket of buckets.values()) {
      bucket.averageCost = bucket.count === 0 ? 0 : roundCost(bucket.totalCost / bucket.count);
    }
    return [...buckets.values()].sort(
      (a, b) => b.totalCost - a.totalCost || a.key.localeCompare(b.key),
    );
  }

  /**
   * Per-model cost aggregates, sorted by total cost descending.
   *
   * @returns One aggregate per distinct model.
   */
  byModel(): CostAggregate[] {
    return this.groupBy('model');
  }

  /**
   * Per-provider cost aggregates, sorted by total cost descending.
   *
   * @returns One aggregate per distinct provider.
   */
  byProvider(): CostAggregate[] {
    return this.groupBy('provider');
  }

  /**
   * Per-session cost aggregates, sorted by total cost descending.
   *
   * @returns One aggregate per distinct session.
   */
  bySession(): CostAggregate[] {
    return this.groupBy('session');
  }

  /**
   * Total monetary cost attributable to a single session.
   *
   * @param sessionId - Session id to sum.
   * @returns Sum of that session's record costs (0 when absent).
   */
  sessionCost(sessionId: string): number {
    let sum = 0;
    for (const record of this.source) {
      if (record.sessionId === sessionId) sum += record.cost;
    }
    return roundCost(sum);
  }

  /**
   * Total monetary cost attributable to a single model.
   *
   * @param model - Model name to sum.
   * @returns Sum of that model's record costs (0 when absent).
   */
  modelCost(model: string): number {
    let sum = 0;
    for (const record of this.source) {
      if (record.model === model) sum += record.cost;
    }
    return roundCost(sum);
  }

  /**
   * Total monetary cost attributable to a single provider.
   *
   * @param provider - Provider name to sum.
   * @returns Sum of that provider's record costs (0 when absent).
   */
  providerCost(provider: string): number {
    let sum = 0;
    for (const record of this.source) {
      if ((record.provider ?? UNKNOWN_PROVIDER) === provider) sum += record.cost;
    }
    return roundCost(sum);
  }

  /**
   * Records whose timestamps fall inside `[from, to]` (inclusive), sorted
   * ascending.
   *
   * @param from - Inclusive lower bound, epoch ms.
   * @param to - Inclusive upper bound, epoch ms.
   * @returns Sorted records in range.
   */
  range(from: number, to: number): CostRecord[] {
    const records = this.records();
    const out: CostRecord[] = [];
    for (const record of records) {
      if (record.timestamp >= from && record.timestamp <= to) out.push(record);
    }
    return out;
  }

  /**
   * Total cost of records inside `[from, to]`.
   *
   * @param from - Inclusive lower bound, epoch ms.
   * @param to - Inclusive upper bound, epoch ms.
   * @returns Rounded sum.
   */
  rangeTotal(from: number, to: number): number {
    let sum = 0;
    for (const record of this.source) {
      if (record.timestamp >= from && record.timestamp <= to) sum += record.cost;
    }
    return roundCost(sum);
  }

  /**
   * The top `limit` spend buckets by total cost.
   *
   * @param limit - Maximum number of buckets (default 10, clamped to >= 1).
   * @param by - Grouping dimension (default `'model'`).
   * @returns Sorted aggregates, truncated to `limit`.
   */
  top(limit = 10, by: CostGroupBy = 'model'): CostAggregate[] {
    const safe = Math.max(1, Math.floor(limit));
    return this.groupBy(by).slice(0, safe);
  }

  /**
   * Mean cost per recorded call.
   *
   * @returns `total / count` (0 when empty).
   */
  averagePerCall(): number {
    let count = 0;
    let sum = 0;
    for (const record of this.source) {
      count += 1;
      sum += record.cost;
    }
    return count === 0 ? 0 : roundCost(sum / count);
  }

  /**
   * Mean token throughput per recorded call.
   *
   * @returns `{ tokensIn, tokensOut, total }` averages (0 when empty).
   */
  averageTokensPerCall(): CostTokenTotals {
    let count = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const record of this.source) {
      count += 1;
      tokensIn += record.tokensIn;
      tokensOut += record.tokensOut;
    }
    if (count === 0) return { tokensIn: 0, tokensOut: 0, total: 0 };
    return {
      tokensIn: Math.round(tokensIn / count),
      tokensOut: Math.round(tokensOut / count),
      total: Math.round((tokensIn + tokensOut) / count),
    };
  }

  /**
   * Median cost per call — useful because call-cost distributions are heavily
   * skewed and the mean is easily distorted by a few large calls.
   *
   * @returns Median record cost (0 when empty).
   */
  medianCost(): number {
    const costs = this.records().map((record) => record.cost).sort((a, b) => a - b);
    const n = costs.length;
    if (n === 0) return 0;
    const mid = n >> 1;
    return n % 2 === 1 ? costs[mid] : roundCost((costs[mid - 1] + costs[mid]) / 2);
  }

  /**
   * The `limit` most expensive individual calls.
   *
   * @param limit - Maximum number of records (default 10, clamped to >= 1).
   * @returns Records sorted by cost descending, truncated.
   */
  expensive(limit = 10): CostRecord[] {
    const safe = Math.max(1, Math.floor(limit));
    return this.records()
      .sort((a, b) => b.cost - a.cost || a.timestamp - b.timestamp)
      .slice(0, safe);
  }

  /**
   * The `limit` least expensive individual calls.
   *
   * @param limit - Maximum number of records (default 10, clamped to >= 1).
   * @returns Records sorted by cost ascending, truncated.
   */
  cheapest(limit = 10): CostRecord[] {
    const safe = Math.max(1, Math.floor(limit));
    return this.records()
      .sort((a, b) => a.cost - b.cost || a.timestamp - b.timestamp)
      .slice(0, safe);
  }

  /**
   * Share (0..1) of total spend attributable to one bucket key within a
   * grouping dimension. E.g. `costShare('gpt-4o', 'model')` returns the
   * fraction of all spend that went to gpt-4o.
   *
   * @param key - Bucket key to measure.
   * @param by - Grouping dimension.
   * @returns Fraction of total cost (0 when total is 0).
   */
  costShare(key: string, by: CostGroupBy = 'model'): number {
    const total = this.total();
    if (total === 0) return 0;
    const bucket = this.groupBy(by).find((aggregate) => aggregate.key === key);
    if (bucket === undefined) return 0;
    return bucket.totalCost / total;
  }

  /**
   * Average cost per 1,000 tokens across the whole set — the blended
   * effective rate, useful for comparing providers.
   *
   * @returns Cost per 1k tokens (0 when no tokens were recorded).
   */
  costPerThousandTokens(): number {
    const tokens = this.tokens();
    const denominator = tokens.total;
    if (denominator <= 0) return 0;
    return roundCost((this.total() / denominator) * 1000);
  }

  /**
   * All records in the set, sorted ascending.
   *
   * @returns Sorted record array.
   */
  all(): CostRecord[] {
    return this.records();
  }
}

/**
 * Convenience factory: builds a {@link CostQuery} over a source.
 *
 * @param source - Store, index or iterable to query.
 * @param currency - Currency label for aggregates.
 * @returns A ready-to-use query.
 */
export function createQuery(source: CostQuerySource, currency: CostCurrency = DEFAULT_CURRENCY): CostQuery {
  return new CostQuery(source, currency);
}

/**
 * Exported default precision for consumers who want to mirror query rounding.
 */
export const QUERY_PRECISION: number = DEFAULT_PRECISION;

/**
 * Re-exports for convenience: consumers frequently import `roundCost` and
 * `compareCostRecords` together with the query helpers.
 */
export { roundCost, compareCostRecords };