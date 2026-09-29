/**
 * In-memory implementation of the metric store for the MAM Metrics layer.
 *
 * {@link MetricStore} is the persistence heart of the metrics subsystem. It
 * owns a `Map<name, Metric>` of time series and provides the full mutation and
 * inspection surface:
 *
 * - **Record** observations with {@link MetricStore.record},
 *   {@link MetricStore.increment}, {@link MetricStore.decrement},
 *   {@link MetricStore.set} and {@link MetricStore.sample}.
 * - **Read** series with {@link MetricStore.get}, {@link MetricStore.getSeries}
 *   and {@link MetricStore.list}.
 * - **Remove** with {@link MetricStore.delete}, {@link MetricStore.clear},
 *   {@link MetricStore.clearSamples} and {@link MetricStore.pruneSamples}.
 * - **Inspect** the collection with {@link MetricStore.has},
 *   {@link MetricStore.keys}, {@link MetricStore.size} and
 *   {@link MetricStore.stats}.
 * - **Summarise** a series with {@link MetricStore.getSummary}.
 * - **Persist / restore** the entire collection with
 *   {@link MetricStore.toJSON} and {@link MetricStore.fromJSON}.
 *
 * The store is a *plain in-memory* implementation: it imposes no filesystem,
 * network or database dependency, which keeps the metrics layer embeddable in
 * any Node process. For durability across restarts, callers periodically
 * serialise with {@link MetricStore.toJSON} and restore with
 * {@link MetricStore.fromJSON}.
 *
 * ## Ordering and retention guarantees
 *
 * - Samples are appended oldest-first and are never re-sorted on read.
 * - A per-series sample cap ({@link MetricsConfig.maxSamplesPerMetric}) is
 *   enforced as a ring buffer: when the cap is exceeded the oldest samples are
 *   dropped, so memory usage stays predictable under high write rates.
 * - A series' {@link MetricType} is immutable: once created, a name cannot be
 *   re-recorded under a different family.
 *
 * ## Events
 *
 * `MetricStore` extends {@link EventEmitter} and emits the following events:
 *
 * - `'record'` — with the {@link MetricSample} that was appended.
 * - `'prune'` — with `{ name, removedSamples, removedMetrics }` after a prune.
 * - `'reset'` — with `{ name, metrics }` after samples are cleared (or after
 *   `clear()`, with `name` set to `null`).
 *
 * @module metrics/store
 */

import { EventEmitter } from 'node:events';

import type {
  Metric,
  MetricLabels,
  MetricOptions,
  MetricSample,
  MetricsConfig,
  MetricsStats,
  MetricSummary,
  MetricType,
  SerializedMetrics,
  Timestamp,
} from './types.js';

/**
 * Default configuration applied when the caller supplies none.
 *
 * These values are deliberately conservative: no per-series cap is imposed,
 * labels are cloned to prevent external mutation, the eager index is disabled
 * so write-heavy workloads are not penalised, and pruning/rollup intervals are
 * disabled until the lifecycle is explicitly started.
 */
export const DEFAULT_METRICS_CONFIG: Required<
  Pick<
    MetricsConfig,
    | 'maxSamplesPerMetric'
    | 'now'
    | 'cloneLabels'
    | 'defaultUnit'
    | 'eagerIndex'
    | 'maxAgeMs'
    | 'pruneIntervalMs'
    | 'rollupIntervalMs'
  >
> = {
  maxSamplesPerMetric: 0,
  now: () => Date.now(),
  cloneLabels: true,
  defaultUnit: '',
  eagerIndex: false,
  maxAgeMs: 0,
  pruneIntervalMs: 0,
  rollupIntervalMs: 60_000,
};

/**
 * Merge a caller-supplied configuration with the defaults.
 *
 * @param config - optional partial configuration
 * @returns a fully-populated, immutable configuration object
 */
export function resolveConfig(
  config: MetricsConfig | undefined,
): Required<
  Pick<
    MetricsConfig,
    | 'maxSamplesPerMetric'
    | 'now'
    | 'cloneLabels'
    | 'defaultUnit'
    | 'eagerIndex'
    | 'maxAgeMs'
    | 'pruneIntervalMs'
    | 'rollupIntervalMs'
  >
> {
  return {
    maxSamplesPerMetric: config?.maxSamplesPerMetric ?? DEFAULT_METRICS_CONFIG.maxSamplesPerMetric,
    now: config?.now ?? DEFAULT_METRICS_CONFIG.now,
    cloneLabels: config?.cloneLabels ?? DEFAULT_METRICS_CONFIG.cloneLabels,
    defaultUnit: config?.defaultUnit ?? DEFAULT_METRICS_CONFIG.defaultUnit,
    eagerIndex: config?.eagerIndex ?? DEFAULT_METRICS_CONFIG.eagerIndex,
    maxAgeMs: config?.maxAgeMs ?? DEFAULT_METRICS_CONFIG.maxAgeMs,
    pruneIntervalMs: config?.pruneIntervalMs ?? DEFAULT_METRICS_CONFIG.pruneIntervalMs,
    rollupIntervalMs: config?.rollupIntervalMs ?? DEFAULT_METRICS_CONFIG.rollupIntervalMs,
  };
}

/**
 * Validate that a metric name is usable as a series key.
 *
 * Rejects empty, non-string and whitespace-only names so that the store's map
 * key space stays well-formed.
 *
 * @param name - the candidate name
 * @throws {TypeError} when the name is not a non-empty string
 */
export function assertValidMetricName(name: string): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(`Invalid metric name: ${JSON.stringify(name)}`);
  }
}

/**
 * Validate that a numeric observation is finite.
 *
 * Rejects `NaN`, `Infinity` and `-Infinity` so that summary statistics and
 * percentiles never have to reason about non-finite values.
 *
 * @param value - the candidate value
 * @throws {TypeError} when the value is not a finite number
 */
export function assertFiniteValue(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Metric value must be a finite number, got: ${String(value)}`);
  }
}

/**
 * Clone a label set, guarding against external mutation.
 *
 * When cloning is disabled the original object is returned verbatim.
 *
 * @param labels - the labels to clone
 * @param clone - whether to deep-clone
 * @returns a fresh (or identical) label object
 */
export function cloneLabels(labels: MetricLabels | undefined, clone: boolean): MetricLabels | undefined {
  if (labels === undefined || labels === null) {
    return undefined;
  }
  if (!clone) {
    return labels;
  }
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(labels)) {
    out[key] = labels[key] as string | number | boolean;
  }
  return out;
}

/**
 * Compute the `p`-th percentile of a set of values using nearest-rank
 * interpolation over a sorted copy.
 *
 * @param values - the raw values (may be empty)
 * @param p - percentile in `[0, 100]`
 * @returns the percentile value, or `null` when `values` is empty
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  const value = sorted[index];
  return value === undefined ? null : value;
}

/**
 * Internal, mutable representation of a series.
 *
 * Structurally identical to the public {@link Metric} but with a writable
 * `samples` array; the store mutates these in place so that any external
 * reference (including one held by the {@link MetricIndex}) stays fresh.
 */
interface StoredMetric extends Metric {
  samples: MetricSample[];
  updatedAt: Timestamp;
}

/**
 * Runtime detail carried by the store's `'prune'` event.
 */
export interface PruneEventDetail {
  /** Name of the pruned series, or `null` when every series was considered. */
  readonly name: string | null;
  /** Number of samples removed. */
  readonly removedSamples: number;
  /** Number of series deleted because they ran dry. */
  readonly removedMetrics: number;
}

/**
 * Runtime detail carried by the store's `'reset'` event.
 */
export interface ResetEventDetail {
  /** Name of the reset series, or `null` when the whole store was reset. */
  readonly name: string | null;
  /** Number of series that were reset. */
  readonly metrics: number;
}

/**
 * The in-memory metric store.
 *
 * See the {@link MetricStore | module documentation} for the full contract and
 * event surface.
 */
export class MetricStore extends EventEmitter {
  /**
   * The series table, keyed by metric name.
   */
  #metrics: Map<string, StoredMetric>;

  /**
   * Running "current value" for counters and gauges, used by
   * {@link MetricStore.getCurrent} and by the typed handles in
   * `integration.ts`. Histograms have no current value and never appear here.
   */
  #current: Map<string, number>;

  /**
   * Resolved configuration for this store.
   */
  readonly #config: Required<
    Pick<
      MetricsConfig,
      | 'maxSamplesPerMetric'
      | 'now'
      | 'cloneLabels'
      | 'defaultUnit'
      | 'eagerIndex'
      | 'maxAgeMs'
      | 'pruneIntervalMs'
      | 'rollupIntervalMs'
    >
  >;

  /**
   * Create a new empty metric store.
   *
   * @param config - optional construction options (see {@link MetricsConfig})
   */
  constructor(config?: MetricsConfig) {
    super();
    this.#metrics = new Map<string, StoredMetric>();
    this.#current = new Map<string, number>();
    this.#config = resolveConfig(config);
  }

  /**
   * Record an absolute observation against a series.
   *
   * If the series does not exist it is created with the type from
   * `options.type` (default `'gauge'`). For counters/gauges the sample value
   * also becomes the series' current value.
   *
   * @param name - the metric name
   * @param value - the observation (must be finite)
   * @param options - optional timestamp, labels, unit or creation type
   * @returns the recorded sample
   * @throws {TypeError} on invalid names or non-finite values
   */
  record(name: string, value: number, options?: MetricOptions): MetricSample {
    assertValidMetricName(name);
    assertFiniteValue(value);
    const metric = this.#ensureMetric(name, options?.type ?? 'gauge', options);
    if (metric.type !== 'histogram') {
      this.#current.set(name, value);
    }
    return this.#appendSample(metric, value, options);
  }

  /**
   * Increment a counter by `by` (default `1`) and record the cumulative total.
   *
   * The series is created as a `'counter'` when it does not exist. The sample
   * value written to the series is the running total, matching Prometheus
   * cumulative-counter semantics.
   *
   * @param name - the metric name
   * @param by - the increment (default `1`; may be fractional or negative)
   * @param options - optional timestamp, labels or unit
   * @returns the recorded sample
   */
  increment(name: string, by?: number, options?: MetricOptions): MetricSample {
    assertValidMetricName(name);
    const delta = by ?? 1;
    assertFiniteValue(delta);
    const metric = this.#ensureMetric(name, 'counter', options);
    const next = (this.#current.get(name) ?? 0) + delta;
    this.#current.set(name, next);
    return this.#appendSample(metric, next, options);
  }

  /**
   * Decrement a counter by `by` (default `1`) and record the cumulative total.
   *
   * Provided for symmetry with {@link MetricStore.increment}; decrementing a
   * counter is unusual (counters should be monotonically increasing) but is
   * occasionally needed for rollback-style accounting.
   *
   * @param name - the metric name
   * @param by - the decrement (default `1`)
   * @param options - optional timestamp, labels or unit
   * @returns the recorded sample
   */
  decrement(name: string, by?: number, options?: MetricOptions): MetricSample {
    return this.increment(name, -(by ?? 1), options);
  }

  /**
   * Set a gauge to an absolute value and record it.
   *
   * The series is created as a `'gauge'` when it does not exist. Each call
   * replaces the gauge's current reading.
   *
   * @param name - the metric name
   * @param value - the new gauge reading
   * @param options - optional timestamp, labels or unit
   * @returns the recorded sample
   */
  set(name: string, value: number, options?: MetricOptions): MetricSample {
    assertValidMetricName(name);
    assertFiniteValue(value);
    const metric = this.#ensureMetric(name, 'gauge', options);
    this.#current.set(name, value);
    return this.#appendSample(metric, value, options);
  }

  /**
   * Append a raw observation to a histogram series.
   *
   * The series is created as a `'histogram'` when it does not exist. Each call
   * appends exactly one observation (e.g. one request latency).
   *
   * @param name - the metric name
   * @param value - the observation
   * @param options - optional timestamp, labels or unit
   * @returns the recorded sample
   */
  sample(name: string, value: number, options?: MetricOptions): MetricSample {
    assertValidMetricName(name);
    assertFiniteValue(value);
    const metric = this.#ensureMetric(name, 'histogram', options);
    return this.#appendSample(metric, value, options);
  }

  /**
   * Retrieve a series by name.
   *
   * The returned {@link Metric} is a live view: appending further samples via
   * the store mutates it in place, so callers should not cache the object for
   * long periods if they need a frozen snapshot — use {@link MetricStore.getSeries}
   * or {@link MetricStore.toJSON} for that.
   *
   * @param name - the metric name
   * @returns the series, or `undefined` when absent
   */
  get(name: string): Metric | undefined {
    return this.#metrics.get(name);
  }

  /**
   * Return a defensive copy of a series' samples, oldest first.
   *
   * @param name - the metric name
   * @returns a fresh array of samples (empty when the series is absent)
   */
  getSeries(name: string): MetricSample[] {
    const metric = this.#metrics.get(name);
    return metric ? metric.samples.slice() : [];
  }

  /**
   * Return the current value of a counter or gauge series.
   *
   * @param name - the metric name
   * @returns the latest cumulative value, or `undefined` for absent series and
   * histograms
   */
  getCurrent(name: string): number | undefined {
    return this.#current.get(name);
  }

  /**
   * Remove a series entirely.
   *
   * @param name - the metric name
   * @returns `true` when a series was removed, `false` when it did not exist
   */
  delete(name: string): boolean {
    const existed = this.#metrics.delete(name);
    if (existed) {
      this.#current.delete(name);
    }
    return existed;
  }

  /**
   * Whether a series exists under the given name.
   *
   * @param name - the metric name
   * @returns `true` when present
   */
  has(name: string): boolean {
    return this.#metrics.has(name);
  }

  /**
   * All currently-stored metric names, in insertion order.
   */
  keys(): string[] {
    return Array.from(this.#metrics.keys());
  }

  /**
   * Remove every series from the store.
   *
   * Emits a `'reset'` event with `{ name: null, metrics: <count> }`.
   */
  clear(): void {
    const count = this.#metrics.size;
    this.#metrics.clear();
    this.#current.clear();
    if (count > 0) {
      const detail: ResetEventDetail = { name: null, metrics: count };
      this.emit('reset', detail);
    }
  }

  /**
   * Number of series currently stored.
   */
  get size(): number {
    return this.#metrics.size;
  }

  /**
   * All series, oldest-created first.
   */
  list(): Metric[] {
    return Array.from(this.#metrics.values());
  }

  /**
   * Aggregate statistics about the current contents.
   *
   * @returns a freshly-computed {@link MetricsStats}
   */
  stats(): MetricsStats {
    let samples = 0;
    let counters = 0;
    let gauges = 0;
    let histograms = 0;
    let labelled = 0;
    let unlabelled = 0;
    let oldestAt: Timestamp | null = null;
    let newestAt: Timestamp | null = null;
    for (const metric of this.#metrics.values()) {
      samples += metric.samples.length;
      if (metric.type === 'counter') {
        counters += 1;
      } else if (metric.type === 'gauge') {
        gauges += 1;
      } else {
        histograms += 1;
      }
      if (metric.labels && Object.keys(metric.labels).length > 0) {
        labelled += 1;
      } else {
        unlabelled += 1;
      }
      const first = metric.samples[0];
      const last = metric.samples[metric.samples.length - 1];
      if (first) {
        if (oldestAt === null || first.timestamp < oldestAt) {
          oldestAt = first.timestamp;
        }
      }
      if (last) {
        if (newestAt === null || last.timestamp > newestAt) {
          newestAt = last.timestamp;
        }
      }
    }
    return {
      metrics: this.#metrics.size,
      samples,
      counters,
      gauges,
      histograms,
      labelled,
      unlabelled,
      byType: { counter: counters, gauge: gauges, histogram: histograms },
      oldestAt,
      newestAt,
    };
  }

  /**
   * Compute a statistical digest for one series.
   *
   * Counts every sample's `value` field and derives min/max/avg/sum/last,
   * standard deviation and nearest-rank percentiles.
   *
   * @param name - the metric name
   * @returns a {@link MetricSummary}, or `undefined` when the series is absent
   */
  getSummary(name: string): MetricSummary | undefined {
    const metric = this.#metrics.get(name);
    if (!metric) {
      return undefined;
    }
    const samples = metric.samples;
    const count = samples.length;
    if (count === 0) {
      return {
        name,
        type: metric.type,
        count: 0,
        min: null,
        max: null,
        avg: null,
        sum: 0,
        last: null,
        stddev: null,
        p50: null,
        p90: null,
        p95: null,
        p99: null,
        oldestAt: null,
        newestAt: null,
      };
    }
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const values: number[] = new Array<number>(count);
    for (let i = 0; i < count; i += 1) {
      const sample = samples[i] as MetricSample;
      const v = sample.value;
      values[i] = v;
      sum += v;
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
    const avg = sum / count;
    let variance = 0;
    for (let i = 0; i < count; i += 1) {
      const diff = (values[i] as number) - avg;
      variance += diff * diff;
    }
    const stddev = count > 1 ? Math.sqrt(variance / (count - 1)) : null;
    const lastSample = samples[count - 1] as MetricSample;
    const firstSample = samples[0] as MetricSample;
    return {
      name,
      type: metric.type,
      count,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      avg,
      sum,
      last: lastSample.value,
      stddev,
      p50: percentile(values, 50),
      p90: percentile(values, 90),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      oldestAt: firstSample.timestamp,
      newestAt: lastSample.timestamp,
    };
  }

  /**
   * Remove samples older than a retention window.
   *
   * Samples whose `timestamp` is strictly older than `now - olderThanMs` are
   * dropped. Series that end up with no samples are removed entirely.
   *
   * @param name - optional series name; when omitted every series is pruned
   * @param olderThanMs - retention window in milliseconds; `0` (default)
   * removes everything older than the present moment
   * @returns a summary of what was removed
   */
  pruneSamples(name?: string, olderThanMs?: number): PruneEventDetail {
    const cutoff = this.#config.now() - (olderThanMs ?? 0);
    let removedSamples = 0;
    let removedMetrics = 0;
    const targets = name === undefined ? this.#metrics.keys() : [name];
    for (const target of targets) {
      const metric = this.#metrics.get(target);
      if (!metric) {
        continue;
      }
      const before = metric.samples.length;
      const kept = metric.samples.filter((s) => s.timestamp >= cutoff);
      removedSamples += before - kept.length;
      metric.samples.length = 0;
      metric.samples.push(...kept);
      if (metric.samples.length === 0) {
        this.#metrics.delete(target);
        this.#current.delete(target);
        removedMetrics += 1;
      }
    }
    const detail: PruneEventDetail = {
      name: name ?? null,
      removedSamples,
      removedMetrics,
    };
    if (removedSamples > 0 || removedMetrics > 0) {
      this.emit('prune', detail);
    }
    return detail;
  }

  /**
   * Clear all samples of one series while keeping the series registered.
   *
   * @param name - the metric name
   * @returns `true` when the series existed and was reset
   */
  clearSamples(name: string): boolean {
    const metric = this.#metrics.get(name);
    if (!metric) {
      return false;
    }
    metric.samples.length = 0;
    this.#current.delete(name);
    const detail: ResetEventDetail = { name, metrics: 1 };
    this.emit('reset', detail);
    return true;
  }

  /**
   * Clear every sample while keeping all series registered.
   *
   * @returns the number of series that were reset
   */
  clearAllSamples(): number {
    const count = this.#metrics.size;
    if (count === 0) {
      return 0;
    }
    for (const metric of this.#metrics.values()) {
      metric.samples.length = 0;
    }
    this.#current.clear();
    const detail: ResetEventDetail = { name: null, metrics: count };
    this.emit('reset', detail);
    return count;
  }

  /**
   * Serialise the entire store to a plain JSON-safe object.
   *
   * The output is schema-versioned so that {@link MetricStore.fromJSON} can
   * migrate or reject incompatible payloads in the future.
   *
   * @returns a {@link SerializedMetrics} payload
   */
  toJSON(): SerializedMetrics {
    return { version: 1, metrics: this.list() };
  }

  /**
   * Restore the store from a previously serialised payload.
   *
   * Replaces the current contents wholesale. Samples and labels are cloned to
   * keep the store's copy-on-write guarantee.
   *
   * @param json - a payload produced by {@link MetricStore.toJSON}
   * @throws {TypeError} on unsupported versions, invalid names or invalid types
   */
  fromJSON(json: SerializedMetrics): void {
    if (json.version !== 1) {
      throw new TypeError(`Unsupported metrics schema version: ${String(json.version)}`);
    }
    const next = new Map<string, StoredMetric>();
    const currents = new Map<string, number>();
    const now = this.#config.now();
    for (const raw of json.metrics) {
      assertValidMetricName(raw.name);
      if (raw.type !== 'counter' && raw.type !== 'gauge' && raw.type !== 'histogram') {
        throw new TypeError(`Invalid metric type: ${String(raw.type)}`);
      }
      const samples: MetricSample[] = raw.samples.map((s) => ({
        name: s.name,
        type: s.type,
        value: s.value,
        unit: s.unit,
        labels: cloneLabels(s.labels, this.#config.cloneLabels),
        timestamp: s.timestamp,
      }));
      const metric: StoredMetric = {
        name: raw.name,
        type: raw.type,
        unit: raw.unit || this.#config.defaultUnit || undefined,
        labels: cloneLabels(raw.labels, this.#config.cloneLabels),
        samples,
        createdAt: raw.createdAt ?? now,
        updatedAt: raw.updatedAt ?? now,
      };
      next.set(raw.name, metric);
      const lastSample = samples[samples.length - 1];
      if (metric.type !== 'histogram' && lastSample) {
        currents.set(raw.name, lastSample.value);
      }
    }
    this.#metrics = next;
    this.#current = currents;
  }

  /**
   * Ensure a series exists, creating it when necessary.
   *
   * @param name - the metric name
   * @param type - the type to create when the series is new
   * @param options - creation options (unit, labels, timestamp)
   * @returns the existing or freshly-created series
   */
  #ensureMetric(name: string, type: MetricType, options?: MetricOptions): StoredMetric {
    const existing = this.#metrics.get(name);
    if (existing) {
      return existing;
    }
    const now = this.#config.now();
    const metric: StoredMetric = {
      name,
      type,
      unit: (options?.unit ?? this.#config.defaultUnit) || undefined,
      labels: cloneLabels(options?.labels, this.#config.cloneLabels),
      samples: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#metrics.set(name, metric);
    return metric;
  }

  /**
   * Append a sample to a series and apply the ring-buffer cap.
   *
   * @param metric - the owning series
   * @param value - the observation value
   * @param options - optional timestamp, labels and unit
   * @returns the appended sample
   */
  #appendSample(metric: StoredMetric, value: number, options?: MetricOptions): MetricSample {
    const timestamp = options?.timestamp ?? this.#config.now();
    const sample: MetricSample = {
      name: metric.name,
      type: metric.type,
      value,
      unit: options?.unit ?? metric.unit,
      labels: cloneLabels(options?.labels, this.#config.cloneLabels),
      timestamp,
    };
    metric.samples.push(sample);
    metric.updatedAt = timestamp;
    this.#applyCap(metric);
    this.emit('record', sample);
    return sample;
  }

  /**
   * Enforce {@link MetricsConfig.maxSamplesPerMetric} by dropping the oldest
   * samples.
   *
   * @param metric - the series to cap
   */
  #applyCap(metric: StoredMetric): void {
    const cap = this.#config.maxSamplesPerMetric;
    if (cap > 0 && metric.samples.length > cap) {
      metric.samples.splice(0, metric.samples.length - cap);
    }
  }
}