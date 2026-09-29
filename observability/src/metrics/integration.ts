/**
 * Public integration surface for the MAM Metrics layer.
 *
 * This module ties the four core classes together and is the layer most
 * application code should import:
 *
 * - {@link MetricsRegistry} — the all-in-one entry point. It owns a
 *   {@link MetricStore}, a {@link MetricIndex}, a {@link MetricQuery} and a
 *   {@link MetricLifecycle}, keeps the index in sync with recorded series, and
 *   exposes typed handles ({@link CounterHandle}, {@link GaugeHandle},
 *   {@link HistogramHandle}) via {@link MetricsRegistry.counter},
 *   {@link MetricsRegistry.gauge} and {@link MetricsRegistry.histogram}.
 * - {@link MetricsAdapter} — a thin {@link MetricCollector} implementation
 *   over a single store. It makes the layer interchangeable with any other
 *   collector and ships a {@link MetricsAdapter.toPrometheus} exporter that
 *   renders the whole collection as Prometheus text exposition format.
 * - {@link createMetricsRegistry} and {@link createMetricsAdapter} — small
 *   factory functions that make construction ergonomic.
 *
 * ## Wiring diagram
 *
 * ```
 *                ┌─────────────────────────────┐
 *                │       MetricsRegistry        │
 *                │  counter()/gauge()/histogram()│
 *                └──┬──────┬──────┬──────┬──────┘
 *                   │      │      │      │
 *                  store  index  query lifecycle
 * ```
 *
 * The registry subscribes to the store's `'record'` event so that every newly
 * created series is indexed exactly once (indexing is O(1) and idempotent, so
 * the overhead per sample is negligible).
 *
 * @module metrics/integration
 */

import { MetricStore } from './store.js';
import { MetricIndex } from './index.js';
import { MetricQuery } from './retrieval.js';
import { MetricLifecycle } from './lifecycle.js';
import type {
  CounterHandle,
  GaugeHandle,
  HistogramHandle,
  Metric,
  MetricCollector,
  MetricHandle,
  MetricOptions,
  MetricsConfig,
  MetricsStats,
  MetricType,
  PruneResult,
  SerializedMetrics,
  Timestamp,
} from './types.js';

/**
 * Create a new {@link MetricsRegistry} from an optional configuration.
 *
 * @param config - optional construction options (see {@link MetricsConfig})
 * @returns a fully-wired, ready-to-use registry
 */
export function createMetricsRegistry(config?: MetricsConfig): MetricsRegistry {
  return new MetricsRegistry(config);
}

/**
 * Create a new {@link MetricsAdapter} from an optional configuration.
 *
 * The adapter wraps a freshly-created {@link MetricStore}; pass an existing
 * store via {@link MetricsAdapter.from} when you need to share one.
 *
 * @param config - optional construction options (see {@link MetricsConfig})
 * @returns a collector adapter over a new store
 */
export function createMetricsAdapter(config?: MetricsConfig): MetricsAdapter {
  return new MetricsAdapter(new MetricStore(config));
}

/**
 * All-in-one entry point that wires store, index, query and lifecycle.
 *
 * See the {@link MetricsRegistry | module documentation} for the full picture.
 * A registry is a {@link MetricCollector}, so it can be passed anywhere a
 * collector is expected.
 */
export class MetricsRegistry implements MetricCollector {
  /**
   * The underlying store.
   */
  readonly #store: MetricStore;

  /**
   * The secondary index, kept in sync with recorded series.
   */
  readonly #index: MetricIndex;

  /**
   * The lifecycle manager (inert until {@link MetricsRegistry.start}).
   */
  readonly #lifecycle: MetricLifecycle;

  /**
   * The read-side query facade.
   */
  readonly #query: MetricQuery;

  /**
   * Typed handles created so far, keyed by series name.
   */
  readonly #handles: Map<string, MetricHandle> = new Map<string, MetricHandle>();

  /**
   * Whether the config requested an eagerly-rebuilt index after bulk restores.
   */
  readonly #eagerIndex: boolean;

  /**
   * Create a new registry.
   *
   * @param config - optional construction options (see {@link MetricsConfig})
   */
  constructor(config?: MetricsConfig) {
    this.#store = new MetricStore(config);
    this.#index = new MetricIndex(undefined, config);
    this.#lifecycle = new MetricLifecycle(this.#store, config);
    this.#query = new MetricQuery(this.#store, this.#index);
    this.#eagerIndex = config?.eagerIndex ?? false;
    this.#store.on('record', (sample) => {
      if (!this.#index.has(sample.name)) {
        const metric = this.#store.get(sample.name);
        if (metric) {
          this.#index.indexMetric(metric);
        }
      }
    });
  }

  /**
   * The underlying store. Use for raw access or serialisation.
   */
  get store(): MetricStore {
    return this.#store;
  }

  /**
   * The secondary index. Use for name/type/label discovery.
   */
  get index(): MetricIndex {
    return this.#index;
  }

  /**
   * The lifecycle manager. Use for pruning, resets and periodic rollup.
   */
  get lifecycle(): MetricLifecycle {
    return this.#lifecycle;
  }

  /**
   * The query facade. Use for read-only retrieval.
   */
  get query(): MetricQuery {
    return this.#query;
  }

  /**
   * Create (or fetch) a typed counter handle.
   *
   * @param name - the metric name
   * @param options - optional fixed labels / unit applied at series creation
   * @returns a {@link CounterHandle}
   */
  counter(name: string, options?: MetricOptions): CounterHandle {
    const existing = this.#handles.get(name);
    if (existing && existing instanceof CounterHandleImpl) {
      return existing;
    }
    const handle = new CounterHandleImpl(name, options ?? {}, this.#store);
    this.#handles.set(name, handle);
    return handle;
  }

  /**
   * Create (or fetch) a typed gauge handle.
   *
   * @param name - the metric name
   * @param options - optional fixed labels / unit applied at series creation
   * @returns a {@link GaugeHandle}
   */
  gauge(name: string, options?: MetricOptions): GaugeHandle {
    const existing = this.#handles.get(name);
    if (existing && existing instanceof GaugeHandleImpl) {
      return existing;
    }
    const handle = new GaugeHandleImpl(name, options ?? {}, this.#store);
    this.#handles.set(name, handle);
    return handle;
  }

  /**
   * Create (or fetch) a typed histogram handle.
   *
   * @param name - the metric name
   * @param options - optional fixed labels / unit applied at series creation
   * @returns a {@link HistogramHandle}
   */
  histogram(name: string, options?: MetricOptions): HistogramHandle {
    const existing = this.#handles.get(name);
    if (existing && existing instanceof HistogramHandleImpl) {
      return existing;
    }
    const handle = new HistogramHandleImpl(name, options ?? {}, this.#store);
    this.#handles.set(name, handle);
    return handle;
  }

  /**
   * Look up a previously created handle by name.
   *
   * @param name - the series name
   * @returns the handle, or `undefined` when none was created through this
   * registry
   */
  handle(name: string): MetricHandle | undefined {
    return this.#handles.get(name);
  }

  /**
   * All handles created through this registry, in creation order.
   */
  handles(): MetricHandle[] {
    return Array.from(this.#handles.values());
  }

  /**
   * Snapshot of every series, as required by {@link MetricCollector}.
   *
   * @returns all series in the store
   */
  collect(): Metric[] {
    return this.#store.list();
  }

  /**
   * Aggregate statistics about the current contents.
   *
   * @returns a freshly-computed {@link MetricsStats}
   */
  stats(): MetricsStats {
    return this.#store.stats();
  }

  /**
   * Begin periodic pruning and rollup.
   *
   * @param rollupIntervalMs - override the rollup interval (ms)
   * @param pruneIntervalMs - override the prune interval (ms)
   * @returns `this` for chaining
   */
  start(rollupIntervalMs?: number, pruneIntervalMs?: number): this {
    this.#lifecycle.start(rollupIntervalMs, pruneIntervalMs);
    return this;
  }

  /**
   * Stop periodic pruning and rollup.
   *
   * @returns `this` for chaining
   */
  stop(): this {
    this.#lifecycle.stop();
    return this;
  }

  /**
   * Prune samples older than a retention window.
   *
   * @param name - optional series name; when omitted every series is pruned
   * @param olderThanMs - retention window in milliseconds
   * @returns a {@link PruneResult}
   */
  prune(name?: string, olderThanMs?: number): PruneResult {
    return this.#lifecycle.prune(name, olderThanMs);
  }

  /**
   * Reset a single series by clearing its samples.
   *
   * @param name - the series name
   * @returns `true` when the series existed and was reset
   */
  reset(name: string): boolean {
    return this.#lifecycle.reset(name);
  }

  /**
   * Reset every series while keeping them registered.
   *
   * @returns the number of series reset
   */
  resetAll(): number {
    return this.#lifecycle.resetAll();
  }

  /**
   * Serialise the whole collection to a plain JSON-safe object.
   *
   * @returns a {@link SerializedMetrics} payload
   */
  toJSON(): SerializedMetrics {
    return this.#store.toJSON();
  }

  /**
   * Restore the collection from a serialised payload.
   *
   * When the registry was constructed with `eagerIndex: true`, the index is
   * rebuilt to match the restored series.
   *
   * @param json - a payload produced by {@link MetricsRegistry.toJSON}
   */
  fromJSON(json: SerializedMetrics): void {
    this.#store.fromJSON(json);
    if (this.#eagerIndex) {
      this.#index.rebuild(this.#store.list());
    }
  }

  /**
   * Tear down timers and release event listeners.
   */
  dispose(): void {
    this.#lifecycle.dispose();
    this.#store.removeAllListeners('record');
  }
}

/**
 * Concrete {@link CounterHandle} backed by a store.
 *
 * Internal implementation detail of the registry; consumers interact with the
 * {@link CounterHandle} interface.
 */
class CounterHandleImpl implements CounterHandle {
  /**
   * Series name.
   */
  readonly name: string;

  /**
   * Creation options (fixed labels / unit).
   */
  readonly #options: MetricOptions;

  /**
   * The backing store.
   */
  readonly #store: MetricStore;

  /**
   * @param name - the series name
   * @param options - creation options
   * @param store - the backing store
   */
  constructor(name: string, options: MetricOptions, store: MetricStore) {
    this.name = name;
    this.#options = options;
    this.#store = store;
  }

  /** @inheritdoc */
  increment(by?: number): MetricSampleLike {
    return this.#store.increment(this.name, by, this.#options);
  }

  /** @inheritdoc */
  add(by?: number): MetricSampleLike {
    return this.#store.increment(this.name, by, this.#options);
  }

  /** @inheritdoc */
  reset(): MetricSampleLike {
    this.#store.clearSamples(this.name);
    return this.#store.record(this.name, 0, this.#options);
  }

  /** @inheritdoc */
  get(): number {
    return this.#store.getCurrent(this.name) ?? 0;
  }
}

/**
 * Concrete {@link GaugeHandle} backed by a store.
 *
 * Internal implementation detail of the registry.
 */
class GaugeHandleImpl implements GaugeHandle {
  /**
   * Series name.
   */
  readonly name: string;

  /**
   * Creation options (fixed labels / unit).
   */
  readonly #options: MetricOptions;

  /**
   * The backing store.
   */
  readonly #store: MetricStore;

  /**
   * @param name - the series name
   * @param options - creation options
   * @param store - the backing store
   */
  constructor(name: string, options: MetricOptions, store: MetricStore) {
    this.name = name;
    this.#options = options;
    this.#store = store;
  }

  /** @inheritdoc */
  set(value: number): MetricSampleLike {
    return this.#store.set(this.name, value, this.#options);
  }

  /** @inheritdoc */
  inc(by?: number): MetricSampleLike {
    return this.#store.set(this.name, (this.#store.getCurrent(this.name) ?? 0) + (by ?? 1), this.#options);
  }

  /** @inheritdoc */
  dec(by?: number): MetricSampleLike {
    return this.#store.set(this.name, (this.#store.getCurrent(this.name) ?? 0) - (by ?? 1), this.#options);
  }

  /** @inheritdoc */
  get(): number {
    return this.#store.getCurrent(this.name) ?? 0;
  }
}

/**
 * Concrete {@link HistogramHandle} backed by a store.
 *
 * Internal implementation detail of the registry.
 */
class HistogramHandleImpl implements HistogramHandle {
  /**
   * Series name.
   */
  readonly name: string;

  /**
   * Creation options (fixed labels / unit).
   */
  readonly #options: MetricOptions;

  /**
   * The backing store.
   */
  readonly #store: MetricStore;

  /**
   * @param name - the series name
   * @param options - creation options
   * @param store - the backing store
   */
  constructor(name: string, options: MetricOptions, store: MetricStore) {
    this.name = name;
    this.#options = options;
    this.#store = store;
  }

  /** @inheritdoc */
  observe(value: number): MetricSampleLike {
    return this.#store.sample(this.name, value, this.#options);
  }

  /** @inheritdoc */
  sample(value: number): MetricSampleLike {
    return this.#store.sample(this.name, value, this.#options);
  }

  /** @inheritdoc */
  count(): number {
    return this.#store.getSeries(this.name).length;
  }
}

/**
 * Structural stand-in for {@link MetricSample} used by handle return types.
 *
 * Kept loose so the handle classes stay focused on behaviour; the returned
 * objects are full {@link MetricSample}s at runtime.
 */
type MetricSampleLike = {
  readonly name: string;
  readonly type: MetricType;
  readonly value: number;
  readonly unit?: string;
  readonly labels?: Record<string, string | number | boolean>;
  readonly timestamp: Timestamp;
};

/**
 * A {@link MetricCollector} that presents a single store behind a uniform
 * collection contract and can export to Prometheus text format.
 *
 * @example
 * ```ts
 * const adapter = createMetricsAdapter();
 * adapter.collect().length; // 0
 * ```
 */
export class MetricsAdapter implements MetricCollector {
  /**
   * The wrapped store.
   */
  readonly #store: MetricStore;

  /**
   * Create an adapter over an existing store.
   *
   * @param store - the store to present
   */
  constructor(store: MetricStore) {
    this.#store = store;
  }

  /**
   * Build an adapter over a fresh store.
   *
   * @param config - optional construction options
   * @returns a new adapter with its own store
   */
  static create(config?: MetricsConfig): MetricsAdapter {
    return createMetricsAdapter(config);
  }

  /**
   * The wrapped store.
   */
  get store(): MetricStore {
    return this.#store;
  }

  /**
   * Snapshot of every series, as required by {@link MetricCollector}.
   *
   * @returns all series in the wrapped store
   */
  collect(): Metric[] {
    return this.#store.list();
  }

  /**
   * Aggregate statistics about the wrapped store.
   *
   * @returns a freshly-computed {@link MetricsStats}
   */
  stats(): MetricsStats {
    return this.#store.stats();
  }

  /**
   * The most recent sample of a series.
   *
   * @param name - the metric name
   * @returns the newest sample, or `undefined`
   */
  latest(name: string): MetricSampleLike | undefined {
    const series = this.#store.getSeries(name);
    return series.length > 0 ? series[series.length - 1] : undefined;
  }

  /**
   * A versioned snapshot of the whole collection.
   *
   * @returns a {@link SerializedMetrics} payload
   */
  snapshot(): SerializedMetrics {
    return this.#store.toJSON();
  }

  /**
   * Render the entire collection in Prometheus text exposition format.
   *
   * Counters and gauges are emitted with their latest value; histograms are
   * emitted as a `summary` with `_count`, `_sum` and nearest-rank quantiles.
   * Labels are escaped per the Prometheus specification. A `# EOF` line closes
   * the payload.
   *
   * @returns the exposition text
   */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const metric of this.#store.list()) {
      const name = escapeMetricName(metric.name);
      const type = metric.type === 'histogram' ? 'summary' : metric.type;
      const help = metric.unit ? `# HELP ${name} ${name} (unit: ${metric.unit}).` : `# HELP ${name} ${name}.`;
      lines.push(help);
      lines.push(`# TYPE ${name} ${type}`);
      const labelString = metric.labels ? `{${formatLabels(metric.labels)}}` : '';
      if (metric.type === 'histogram') {
        const summary = this.#store.getSummary(metric.name);
        const count = summary?.count ?? 0;
        const sum = summary?.sum ?? 0;
        lines.push(`${name}_count${labelString} ${count}`);
        lines.push(`${name}_sum${labelString} ${formatValue(sum)}`);
        if (summary) {
          const quantiles: Array<[string, number | null]> = [
            ['0.5', summary.p50],
            ['0.9', summary.p90],
            ['0.95', summary.p95],
            ['0.99', summary.p99],
          ];
          for (const [q, value] of quantiles) {
            if (value !== null) {
              lines.push(
                `${name}${formatLabelsWith(metric.labels, { quantile: q })} ${formatValue(value)}`,
              );
            }
          }
        }
      } else {
        const last = this.#store.getSeries(metric.name);
        const sample = last[last.length - 1];
        if (sample) {
          lines.push(`${name}${labelString} ${formatValue(sample.value)}`);
        }
      }
    }
    lines.push('# EOF');
    return lines.join('\n');
  }
}

/**
 * Escape a metric name for Prometheus exposition.
 *
 * @param name - the raw name
 * @returns a name containing only `[a-zA-Z0-9:_]`
 */
function escapeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

/**
 * Format a floating-point value compactly.
 *
 * @param value - the numeric value
 * @returns a short decimal string
 */
function formatValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Escape a single label value per the Prometheus specification.
 *
 * @param value - the raw value
 * @returns an escaped, quoted label value
 */
function escapeLabelValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * Format a label object as a Prometheus label list.
 *
 * @param labels - the label pairs
 * @returns `key="value",other="value"`
 */
function formatLabels(labels: Readonly<Record<string, string | number | boolean>>): string {
  const parts: string[] = [];
  for (const key of Object.keys(labels)) {
    const value = labels[key] as string | number | boolean;
    parts.push(`${key}${escapeLabelValue(String(value))}`);
  }
  return parts.join(',');
}

/**
 * Format a label object merged with extra quantile labels.
 *
 * @param base - the series' fixed labels (may be `undefined`)
 * @param extra - additional label pairs
 * @returns a Prometheus label list
 */
function formatLabelsWith(
  base: Readonly<Record<string, string | number | boolean>> | undefined,
  extra: Readonly<Record<string, string>>,
): string {
  const parts: string[] = [];
  if (base) {
    for (const key of Object.keys(base)) {
      const value = base[key] as string | number | boolean;
      parts.push(`${key}${escapeLabelValue(String(value))}`);
    }
  }
  for (const key of Object.keys(extra)) {
    parts.push(`${key}${escapeLabelValue(extra[key] as string)}`);
  }
  return `{${parts.join(',')}}`;
}