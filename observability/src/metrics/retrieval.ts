/**
 * Read-oriented query facade for the MAM Metrics layer.
 *
 * {@link MetricQuery} answers the questions observability consumers actually
 * ask, without exposing the store's internal representation:
 *
 * - **Latest value** — {@link MetricQuery.latest}.
 * - **Time ranges** — {@link MetricQuery.range}.
 * - **Label filtering** — {@link MetricQuery.byLabel} (per-series samples) and
 *   {@link MetricQuery.byLabelAcross} (across series, using the index).
 * - **Ranking** — {@link MetricQuery.top} for the highest-valued samples.
 * - **Digests** — {@link MetricQuery.summary}.
 * - **Arbitrary aggregation** — {@link MetricQuery.aggregate} and the
 *   convenience reducers {@link MetricQuery.count}, {@link MetricQuery.total},
 *   {@link MetricQuery.min}, {@link MetricQuery.max}, {@link MetricQuery.avg}.
 * - **Rates** — {@link MetricQuery.rate} for per-second throughput windows.
 *
 * A query is a pure, stateless read facade: constructing one is cheap and it
 * may be shared freely. Optionally bind an {@link MetricIndex} to accelerate
 * {@link MetricQuery.byLabelAcross} and to enable name/type discovery without
 * scanning every series.
 *
 * @module metrics/retrieval
 */

import type {
  Metric,
  MetricLabels,
  MetricQueryOptions,
  MetricSample,
  MetricSummary,
  MetricsStats,
  Timestamp,
} from './types.js';
import type { MetricStore } from './store.js';
import type { MetricIndex } from './index.js';

/**
 * A single row produced by {@link MetricQuery.aggregate}.
 *
 * Bundles the source series together with whatever value the caller's reducer
 * computed, so results are self-describing and easy to serialise.
 */
export interface AggregateRow<T> {
  /**
   * Name of the series the reducer was applied to.
   */
  readonly name: string;

  /**
   * The series itself (a live reference).
   */
  readonly metric: Metric;

  /**
   * The value returned by the reducer for this series.
   */
  readonly value: T;
}

/**
 * Result of a {@link MetricQuery.rate} computation.
 */
export interface RateResult {
  /**
   * Name of the series.
   */
  readonly name: string;

  /**
   * Number of samples observed within the window.
   */
  readonly samples: number;

  /**
   * Width of the window in milliseconds.
   */
  readonly windowMs: number;

  /**
   * Throughput in samples per second, or `null` when no samples fall inside
   * the window.
   */
  readonly perSecond: number | null;

  /**
   * Sum of the sample values within the window (useful for counter deltas).
   */
  readonly sum: number;
}

/**
 * The query facade.
 *
 * See the {@link MetricQuery | module documentation} for the full contract.
 */
export class MetricQuery {
  /**
   * The store being queried.
   */
  readonly #store: MetricStore;

  /**
   * Optional secondary index used for cross-series label discovery.
   */
  readonly #index: MetricIndex | undefined;

  /**
   * Create a query over a store.
   *
   * @param store - the store to read from
   * @param index - optional index used to accelerate label queries
   */
  constructor(store: MetricStore, index?: MetricIndex) {
    this.#store = store;
    this.#index = index;
  }

  /**
   * The most recent sample of a series.
   *
   * @param name - the metric name
   * @returns the newest sample, or `undefined` when the series is absent or
   * empty
   */
  latest(name: string): MetricSample | undefined {
    const series = this.#store.getSeries(name);
    return series.length > 0 ? series[series.length - 1] : undefined;
  }

  /**
   * Samples of a series falling inside an inclusive time window.
   *
   * Both bounds are optional; an omitted bound leaves that side unbounded. The
   * result preserves storage order (oldest first).
   *
   * @param name - the metric name
   * @param from - inclusive lower bound
   * @param to - inclusive upper bound
   * @returns matching samples (empty when the series is absent)
   */
  range(name: string, from?: Timestamp, to?: Timestamp): MetricSample[] {
    const series = this.#store.getSeries(name);
    if (series.length === 0) {
      return [];
    }
    const lower = from === undefined ? Number.NEGATIVE_INFINITY : from;
    const upper = to === undefined ? Number.POSITIVE_INFINITY : to;
    const out: MetricSample[] = [];
    for (const sample of series) {
      if (sample.timestamp >= lower && sample.timestamp <= upper) {
        out.push(sample);
      }
    }
    return out;
  }

  /**
   * Samples of one series whose per-sample labels satisfy *all* given pairs.
   *
   * Note the distinction from {@link MetricQuery.byLabelAcross}: this filters
   * the *samples* of a single series by their per-sample labels, while the
   * cross-series variant filters series by their fixed label set.
   *
   * @param name - the metric name
   * @param labels - label pairs to match (AND semantics; exact, case-insensitive)
   * @returns matching samples
   */
  byLabel(name: string, labels: MetricLabels): MetricSample[] {
    const series = this.#store.getSeries(name);
    if (series.length === 0 || labels === undefined) {
      return [];
    }
    const entries = Object.entries(labels);
    const out: MetricSample[] = [];
    for (const sample of series) {
      if (matchesLabels(sample.labels, entries)) {
        out.push(sample);
      }
    }
    return out;
  }

  /**
   * Series whose *fixed* labels satisfy all given pairs, using the index when
   * available.
   *
   * @param labels - label pairs to match (AND semantics)
   * @returns matching series
   */
  byLabelAcross(labels: MetricLabels): Metric[] {
    if (this.#index) {
      return this.#index.findByLabels(labels);
    }
    return this.#store
      .list()
      .filter((metric) => matchesLabels(metric.labels, Object.entries(labels)));
  }

  /**
   * The `limit` highest-valued samples of a series.
   *
   * @param name - the metric name
   * @param limit - maximum results; `0` or omitted means unbounded
   * @returns samples sorted by value, descending
   */
  top(name: string, limit?: number): MetricSample[] {
    const series = this.#store.getSeries(name);
    const ranked = series.slice().sort((a, b) => b.value - a.value);
    return limit && limit > 0 ? ranked.slice(0, limit) : ranked;
  }

  /**
   * The `limit` most recent samples of a series.
   *
   * @param name - the metric name
   * @param options - optional window bounds and limit
   * @returns samples ordered newest-first
   */
  recent(name: string, options?: MetricQueryOptions): MetricSample[] {
    const from = options?.from;
    const to = options?.to;
    const series = this.range(name, from, to);
    series.reverse();
    const limit = options?.limit ?? 0;
    return limit > 0 ? series.slice(0, limit) : series;
  }

  /**
   * Statistical digest of a series.
   *
   * Delegates to the store's summary computation, so the result is identical
   * to {@link MetricStore.getSummary}.
   *
   * @param name - the metric name
   * @returns the digest, or `undefined` when the series is absent
   */
  summary(name: string): MetricSummary | undefined {
    return this.#store.getSummary(name);
  }

  /**
   * Apply a reducer function to every series and collect the results.
   *
   * @param fn - reducer invoked with each {@link Metric}
   * @returns one {@link AggregateRow} per series, in insertion order
   */
  aggregate<T>(fn: (metric: Metric) => T): AggregateRow<T>[] {
    const rows: AggregateRow<T>[] = [];
    for (const metric of this.#store.list()) {
      rows.push({ name: metric.name, metric, value: fn(metric) });
    }
    return rows;
  }

  /**
   * Every series currently in the store.
   */
  all(): Metric[] {
    return this.#store.list();
  }

  /**
   * Number of samples currently held by a series.
   *
   * @param name - the metric name
   * @returns the sample count (`0` when the series is absent)
   */
  count(name: string): number {
    return this.#store.getSeries(name).length;
  }

  /**
   * Sum of all sample values of a series.
   *
   * @param name - the metric name
   * @returns the sum (`0` when the series is absent or empty)
   */
  total(name: string): number {
    return this.#store.getSeries(name).reduce((acc, s) => acc + s.value, 0);
  }

  /**
   * Minimum sample value of a series.
   *
   * @param name - the metric name
   * @returns the minimum, or `null` when there are no samples
   */
  min(name: string): number | null {
    const series = this.#store.getSeries(name);
    if (series.length === 0) {
      return null;
    }
    let min = Infinity;
    for (const s of series) {
      if (s.value < min) {
        min = s.value;
      }
    }
    return min;
  }

  /**
   * Maximum sample value of a series.
   *
   * @param name - the metric name
   * @returns the maximum, or `null` when there are no samples
   */
  max(name: string): number | null {
    const series = this.#store.getSeries(name);
    if (series.length === 0) {
      return null;
    }
    let max = -Infinity;
    for (const s of series) {
      if (s.value > max) {
        max = s.value;
      }
    }
    return max;
  }

  /**
   * Arithmetic mean of a series' sample values.
   *
   * @param name - the metric name
   * @returns the mean, or `null` when there are no samples
   */
  avg(name: string): number | null {
    const series = this.#store.getSeries(name);
    if (series.length === 0) {
      return null;
    }
    let sum = 0;
    for (const s of series) {
      sum += s.value;
    }
    return sum / series.length;
  }

  /**
   * Throughput of a series over a trailing window.
   *
   * @param name - the metric name
   * @param windowMs - window width in milliseconds (default `60_000`)
   * @returns a {@link RateResult}
   */
  rate(name: string, windowMs?: number): RateResult {
    const window = windowMs ?? 60_000;
    const now = Date.now();
    const from = now - window;
    const inWindow = this.range(name, from, now);
    const samples = inWindow.length;
    const sum = inWindow.reduce((acc, s) => acc + s.value, 0);
    const perSecond = samples > 0 ? (samples / window) * 1000 : null;
    return { name, samples, windowMs: window, perSecond, sum };
  }

  /**
   * List the names of all series matching an optional type filter.
   *
   * @param type - optional type filter
   * @returns matching series names
   */
  names(type?: 'counter' | 'gauge' | 'histogram'): string[] {
    if (this.#index && type !== undefined) {
      return this.#index.findByType(type).map((m) => m.name);
    }
    return this.#store
      .list()
      .filter((m) => type === undefined || m.type === type)
      .map((m) => m.name);
  }

  /**
   * Aggregate statistics about the underlying store.
   *
   * @returns a freshly-computed {@link MetricsStats}
   */
  stats(): MetricsStats {
    return this.#store.stats();
  }
}

/**
 * Match a set of label entries against a label object (AND semantics).
 *
 * The match is exact and case-insensitive on both key and value.
 *
 * @param labels - the label object to test (may be `undefined`)
 * @param entries - the required key/value pairs
 * @returns `true` when every pair is present and equal (case-insensitively)
 */
function matchesLabels(
  labels: Readonly<Record<string, string | number | boolean>> | undefined,
  entries: Array<[string, string | number | boolean]>,
): boolean {
  if (labels === undefined || entries.length === 0) {
    return false;
  }
  for (const [key, value] of entries) {
    const actual = labels[key];
    if (actual === undefined || String(actual).toLowerCase() !== String(value).toLowerCase()) {
      return false;
    }
  }
  return true;
}