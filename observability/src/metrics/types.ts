/**
 * Core domain types for the MAM Metrics layer.
 *
 * The metrics layer is a self-contained, dependency-free observability engine
 * that collects three kinds of signals — **counters**, **gauges** and
 * **histograms** — and makes them queryable through a small family of classes:
 *
 * - {@link MetricStore} (`store.ts`) — the in-memory persistence heart. It
 *   owns a `Map<name, Metric>` and provides the full mutation surface
 *   (`record`, `increment`, `decrement`, `set`, `sample`), inspection
 *   (`get`, `getSeries`, `keys`, `has`, `size`, `stats`, `getSummary`) and
 *   serialisation (`toJSON` / `fromJSON`).
 * - {@link MetricIndex} (`index.ts`) — a secondary structure that indexes
 *   metrics by name, type and label so that lookups do not require a linear
 *   scan of every series.
 * - {@link MetricQuery} (`retrieval.ts`) — a read-oriented facade for the most
 *   common observability questions (latest value, time range, label filter,
 *   top-N, summary, custom aggregation).
 * - {@link MetricLifecycle} (`lifecycle.ts`) — resource management: pruning,
 *   reset, periodic rollup and the event stream (`record` / `prune` /
 *   `rollup`).
 * - {@link MetricsRegistry} and {@link MetricsAdapter} (`integration.ts`) —
 *   the public entry points that wire the four classes together behind a
 *   convenient API (typed handles for counters/gauges/histograms) and present
 *   the collected data behind a uniform {@link MetricCollector} contract
 *   (including a Prometheus text-format exporter).
 *
 * Every value in this module is deliberately serialisable: a {@link Metric}
 * can be round-tripped through {@link JSON} without loss, so metrics captured
 * in one process can be persisted and restored by another.
 *
 * @module metrics/types
 */

/**
 * Discriminator for the three metric families.
 *
 * The type of a metric is fixed for the lifetime of its series and cannot be
 * changed once the series exists. Choosing the correct family up front matters:
 *
 * - `'counter'` — monotonically non-decreasing totals (request counts, bytes
 *   served, task completions). Sampled values are cumulative running totals.
 * - `'gauge'` — point-in-time values that may go up and down (heap used, queue
 *   depth, temperature). Each `set` replaces the previous reading.
 * - `'histogram'` — a distribution of observations (request latencies, payload
 *   sizes). Every observation is appended verbatim and can be summarised with
 *   percentiles via {@link MetricSummary}.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the metrics layer use epoch milliseconds so that
 * they interoperate cleanly with both {@link Date} and `performance.now()`
 * derived clocks, and so that range arithmetic (see
 * {@link MetricQuery.range}) does not need to deal with calendar complexity.
 */
export type Timestamp = number;

/**
 * Unit annotation attached to a metric or sample.
 *
 * Units are advisory and never interpreted by the metrics layer, but they make
 * exported output dramatically more useful. Standard practice is to use a
 * short lowercase token such as `'bytes'`, `'ms'`, `'seconds'`, `'requests'`
 * or `'percent'`. When {@link Metric.labels} carry a unit the per-sample unit
 * may be omitted.
 */
export type MetricUnit = string;

/**
 * A fixed set of label key/value pairs describing a metric series.
 *
 * Labels are the primary dimensioning mechanism: two series with the same name
 * but different label sets are treated as distinct entries in the store and
 * can be queried independently (see {@link MetricIndex.findByLabel} and
 * {@link MetricQuery.byLabel}). Values are restricted to primitives so that
 * label sets are directly comparable and serialisable.
 */
export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

/**
 * A single observation recorded against a metric at one point in time.
 *
 * A sample is the atomic unit of the metrics layer. It duplicates the owning
 * metric's `name` and `type` so that samples can be streamed, exported or
 * persisted independently of their series without losing context.
 */
export interface MetricSample {
  /**
   * Name of the owning metric series.
   *
   * Matches {@link Metric.name}; kept on the sample so that exported samples
   * (e.g. via {@link MetricsAdapter.toPrometheus}) are self-describing.
   */
  readonly name: string;

  /**
   * Family of the owning metric. Matches {@link Metric.type}.
   */
  readonly type: MetricType;

  /**
   * Numeric value of the observation.
   *
   * For counters this is the cumulative running total at observation time; for
   * gauges it is the most recently set reading; for histograms it is the raw
   * observed quantity (e.g. a latency in milliseconds).
   */
  readonly value: number;

  /**
   * Optional unit annotation overriding the series-level unit.
   *
   * When omitted, consumers should fall back to {@link Metric.unit}.
   */
  readonly unit?: MetricUnit;

  /**
   * Optional per-sample labels.
   *
   * These are *additional* to (never a replacement for) the series-level
   * {@link Metric.labels}. They can be used to dimension individual readings
   * (e.g. the response status of a single request).
   */
  readonly labels?: MetricLabels;

  /**
   * Epoch-millisecond time at which the observation was recorded.
   *
   * Defaults to the injected clock's current time (see {@link MetricsConfig.now})
   * when the caller does not supply one.
   */
  readonly timestamp: Timestamp;
}

/**
 * A named time series: a collection of {@link MetricSample}s sharing a name,
 * type and fixed label set.
 *
 * The store keeps one `Metric` per distinct name (plus its fixed labels). The
 * `samples` array is ordered oldest-first and is bounded by
 * {@link MetricsConfig.maxSamplesPerMetric}; when the bound is exceeded the
 * oldest samples are dropped so memory usage stays predictable.
 */
export interface Metric {
  /**
   * Canonical, low-cardinality name of the series.
   *
   * Names should follow a dotted convention such as `'http.requests.total'` or
   * `'process.memory.heap'`. The store validates that names are non-empty
   * strings before a series can be created.
   */
  readonly name: string;

  /**
   * Family of the series. Fixed at creation time; see {@link MetricType}.
   */
  readonly type: MetricType;

  /**
   * Optional unit for every sample that does not carry its own. See
   * {@link MetricUnit}.
   */
  readonly unit?: MetricUnit;

  /**
   * Optional fixed label set for the whole series. See {@link MetricLabels}.
   */
  readonly labels?: MetricLabels;

  /**
   * The observed samples, oldest first. Read-only from the consumer's
   * perspective; mutations flow through the store.
   */
  readonly samples: readonly MetricSample[];

  /**
   * Epoch-millisecond time the series was first created.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent mutation.
   */
  readonly updatedAt: Timestamp;
}

/**
 * A derived statistical digest of a metric's samples.
 *
 * Produced by {@link MetricStore.getSummary} and re-exposed by
 * {@link MetricQuery.summary}. Percentiles are computed from a sorted copy of
 * the sample values using nearest-rank interpolation, so they are exact for
 * the observed data rather than approximate.
 */
export interface MetricSummary {
  /**
   * Name of the summarised series.
   */
  readonly name: string;

  /**
   * Family of the summarised series.
   */
  readonly type: MetricType;

  /**
   * Number of samples included in the digest.
   */
  readonly count: number;

  /**
   * Minimum sample value, or `null` when the series has no samples.
   */
  readonly min: number | null;

  /**
   * Maximum sample value, or `null` when the series has no samples.
   */
  readonly max: number | null;

  /**
   * Arithmetic mean of the sample values, or `null` when empty.
   */
  readonly avg: number | null;

  /**
   * Sum of all sample values.
   */
  readonly sum: number;

  /**
   * Value of the most recent sample.
   */
  readonly last: number | null;

  /**
   * Sample standard deviation, or `null` when fewer than two samples exist.
   */
  readonly stddev: number | null;

  /**
   * 50th percentile (median) of the sample values.
   */
  readonly p50: number | null;

  /**
   * 90th percentile of the sample values.
   */
  readonly p90: number | null;

  /**
   * 95th percentile of the sample values.
   */
  readonly p95: number | null;

  /**
   * 99th percentile of the sample values.
   */
  readonly p99: number | null;

  /**
   * Timestamp of the oldest included sample, or `null` when empty.
   */
  readonly oldestAt: Timestamp | null;

  /**
   * Timestamp of the newest included sample, or `null` when empty.
   */
  readonly newestAt: Timestamp | null;
}

/**
 * Aggregate statistics describing the contents of a store, index or registry.
 *
 * Returned by {@link MetricStore.stats}, {@link MetricIndex.stats},
 * {@link MetricQuery.stats} (where applicable) and {@link MetricsRegistry.stats}.
 * All fields are derived on demand rather than cached, guaranteeing freshness
 * at the cost of an O(n) scan for large stores.
 */
export interface MetricsStats {
  /**
   * Total number of metric series currently stored.
   */
  readonly metrics: number;

  /**
   * Total number of samples across all stored series.
   */
  readonly samples: number;

  /**
   * Number of series whose type is `'counter'`.
   */
  readonly counters: number;

  /**
   * Number of series whose type is `'gauge'`.
   */
  readonly gauges: number;

  /**
   * Number of series whose type is `'histogram'`.
   */
  readonly histograms: number;

  /**
   * Number of series carrying a fixed label set.
   */
  readonly labelled: number;

  /**
   * Number of series without a fixed label set.
   */
  readonly unlabelled: number;

  /**
   * Count of series per type. Only types present are included.
   */
  readonly byType: Readonly<Record<MetricType, number>>;

  /**
   * Timestamp of the oldest sample in the store, or `null` when empty.
   */
  readonly oldestAt: Timestamp | null;

  /**
   * Timestamp of the newest sample in the store, or `null` when empty.
   */
  readonly newestAt: Timestamp | null;
}

/**
 * Configuration shared by the store, index, query, lifecycle and registry.
 *
 * An {@link MetricsConfig} may be supplied to {@link MetricStore},
 * {@link MetricsRegistry} or the factory functions in `integration.ts` to tune
 * retention, clocking, cloning and indexing behaviour. Every field is optional;
 * the defaults are chosen to be safe for general use.
 */
export interface MetricsConfig {
  /**
   * Upper bound on the number of samples retained per series. When a series
   * exceeds this bound the oldest samples are dropped (a ring-buffer policy).
   * `0` (default) disables the cap entirely.
   */
  readonly maxSamplesPerMetric?: number;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps. Injecting
   * a clock makes the layer deterministic under test.
   */
  readonly now?: () => Timestamp;

  /**
   * When `true` (default `true`), a copy of each labels object and sample is
   * taken at record time so that later mutation of the caller's object cannot
   * corrupt the store. Set to `false` when label objects are treated as
   * immutable by the caller and memory overhead matters.
   */
  readonly cloneLabels?: boolean;

  /**
   * Default unit applied to newly created series that do not specify one. See
   * {@link MetricUnit}.
   */
  readonly defaultUnit?: MetricUnit;

  /**
   * When `true` (default `false`), the {@link MetricIndex} is eagerly rebuilt
   * after every mutation. When `false`, the index is rebuilt lazily on the
   * next query, which is cheaper for write-heavy workloads.
   */
  readonly eagerIndex?: boolean;

  /**
   * Default retention window (in milliseconds) used by
   * {@link MetricLifecycle.prune} when the caller omits `olderThanMs`.
   * `0` (default) means "prune everything older than the present moment".
   */
  readonly maxAgeMs?: number;

  /**
   * Interval (in milliseconds) at which {@link MetricLifecycle} performs
   * automatic pruning while running. `0` disables automatic pruning.
   */
  readonly pruneIntervalMs?: number;

  /**
   * Interval (in milliseconds) at which {@link MetricLifecycle} performs
   * periodic rollup while running. `0` disables automatic rollup.
   */
  readonly rollupIntervalMs?: number;
}

/**
 * Options accepted when recording a single sample.
 *
 * {@link MetricStore.record}, {@link MetricStore.increment},
 * {@link MetricStore.set} and {@link MetricStore.sample} accept an optional
 * {@link MetricOptions} to override the timestamp, attach labels or force a
 * type when the series does not yet exist.
 */
export interface MetricOptions {
  /**
   * Epoch-millisecond timestamp for the sample. Defaults to the store's clock.
   */
  readonly timestamp?: Timestamp;

  /**
   * Optional per-sample labels. See {@link MetricSample.labels}.
   */
  readonly labels?: MetricLabels;

  /**
   * Optional unit annotation. See {@link MetricUnit}.
   */
  readonly unit?: MetricUnit;

  /**
   * Optional series type used only when the series does not yet exist.
   * Ignored when the series already exists (its type is immutable). Defaults
   * to `'gauge'` for `record`/`set` and is forced for `increment`/`decrement`
   * (`'counter'`) and `sample` (`'histogram'`).
   */
  readonly type?: MetricType;
}

/**
 * Options accepted by retrieval entry points.
 *
 * {@link MetricQuery.top} and {@link MetricQuery.all} accept a
 * {@link MetricQueryOptions} to bound results and constrain time windows.
 */
export interface MetricQueryOptions {
  /**
   * Maximum number of results to return. `0` means unbounded. Defaults to 20
   * for `top` and `undefined` (unbounded) for range queries.
   */
  readonly limit?: number;

  /**
   * Inclusive lower timestamp bound for the query window.
   */
  readonly from?: Timestamp;

  /**
   * Inclusive upper timestamp bound for the query window.
   */
  readonly to?: Timestamp;

  /**
   * When `true`, results are ordered newest-first. Defaults to `false`
   * (oldest-first, matching storage order).
   */
  readonly newestFirst?: boolean;
}

/**
 * A typed handle for a counter series.
 *
 * Returned by {@link MetricsRegistry.counter} and
 * {@link createMetricsRegistry}. Handles are lightweight closures over the
 * registry and can be retained by application code without holding a reference
 * to the registry itself.
 */
export interface CounterHandle {
  /**
   * Increment the counter by `by` (default `1`) and record a sample carrying
   * the cumulative total.
   */
  increment(by?: number): MetricSample;

  /**
   * Alias of {@link CounterHandle.increment} for readers coming from a
   * Prometheus/OpenMetrics background.
   */
  add(by?: number): MetricSample;

  /**
   * Reset the counter to zero and record a sample.
   */
  reset(): MetricSample;

  /**
   * Current cumulative value of the counter.
   */
  get(): number;

  /**
   * Name of the underlying series.
   */
  readonly name: string;
}

/**
 * A typed handle for a gauge series.
 *
 * Returned by {@link MetricsRegistry.gauge} and {@link createMetricsRegistry}.
 */
export interface GaugeHandle {
  /**
   * Set the gauge to `value` and record a sample.
   */
  set(value: number): MetricSample;

  /**
   * Increment the current gauge reading by `by` (default `1`) and record a
   * sample.
   */
  inc(by?: number): MetricSample;

  /**
   * Decrement the current gauge reading by `by` (default `1`) and record a
   * sample.
   */
  dec(by?: number): MetricSample;

  /**
   * Current reading of the gauge.
   */
  get(): number;

  /**
   * Name of the underlying series.
   */
  readonly name: string;
}

/**
 * A typed handle for a histogram series.
 *
 * Returned by {@link MetricsRegistry.histogram} and
 * {@link createMetricsRegistry}. Each {@link HistogramHandle.observe} call
 * appends one observation to the series.
 */
export interface HistogramHandle {
  /**
   * Record a single observation (e.g. one request latency).
   */
  observe(value: number): MetricSample;

  /**
   * Alias of {@link HistogramHandle.observe} mirroring the store's `sample`.
   */
  sample(value: number): MetricSample;

  /**
   * Number of observations recorded so far.
   */
  count(): number;

  /**
   * Name of the underlying series.
   */
  readonly name: string;
}

/**
 * Union of all typed handles, used by the registry's lookup helpers.
 */
export type MetricHandle = CounterHandle | GaugeHandle | HistogramHandle;

/**
 * Result of a {@link MetricLifecycle.prune} operation.
 */
export interface PruneResult {
  /**
   * Number of samples removed across all affected series.
   */
  readonly removedSamples: number;

  /**
   * Number of series that were removed entirely because they had no remaining
   * samples (or because they did not match a `name` filter and were dropped).
   */
  readonly removedMetrics: number;

  /**
   * Names of the series that still exist after pruning.
   */
  readonly metrics: readonly string[];

  /**
   * Retention window applied (samples older than `now - olderThanMs` were
   * removed).
   */
  readonly olderThanMs: number;

  /**
   * Epoch-millisecond cut-off used by the prune.
   */
  readonly cutoff: Timestamp;

  /**
   * Epoch-millisecond time the prune ran.
   */
  readonly now: Timestamp;
}

/**
 * Result of a {@link MetricLifecycle.rollup} operation.
 *
 * The lifecycle periodically (or on demand) computes a {@link MetricSummary}
 * for every series and stores the digest set here.
 */
export interface RollupResult {
  /**
   * Epoch-millisecond time the rollup was computed.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of series summarised.
   */
  readonly metrics: number;

  /**
   * Total number of samples considered across all series.
   */
  readonly samples: number;

  /**
   * Per-series digests keyed by metric name.
   */
  readonly summaries: Readonly<Record<string, MetricSummary>>;
}

/**
 * Payload emitted by the metrics lifecycle event emitter.
 *
 * Each event carries enough context for observers to react without reaching
 * back into the store.
 */
export interface MetricLifecycleEvent {
  /**
   * Discriminator naming the lifecycle operation that fired: `'record'`,
   * `'prune'`, `'rollup'` or `'reset'`.
   */
  readonly type: 'record' | 'prune' | 'rollup' | 'reset';

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly timestamp: Timestamp;

  /**
   * Operation-specific payload: a {@link MetricSample} for `'record'`, a
   * {@link PruneResult} for `'prune'`, a {@link RollupResult} for `'rollup'`,
   * and a `{ name: string | null; metrics: number }` object for `'reset'`.
   */
  readonly detail: unknown;
}

/**
 * Uniform collection contract implemented by {@link MetricsAdapter} and
 * {@link MetricsRegistry}.
 *
 * Consumers (a dashboard, an exporter, a background reporter) can depend on
 * this interface and be agnostic about whether the implementation is a bare
 * adapter over a single store or a full registry with lifecycle management.
 */
export interface MetricCollector {
  /**
   * Snapshot of every series currently held, as an array of {@link Metric}s.
   */
  collect(): Metric[];

  /**
   * Aggregate statistics about the current contents.
   */
  stats(): MetricsStats;
}

/**
 * JSON representation of a store produced by {@link MetricStore.toJSON} and
 * accepted by {@link MetricStore.fromJSON}.
 */
export interface SerializedMetrics {
  /**
   * Schema version. Currently always `1`; future schema changes can bump this
   * so that `fromJSON` can migrate or reject incompatible payloads.
   */
  readonly version: number;

  /**
   * All series, ready for restoration.
   */
  readonly metrics: Metric[];
}