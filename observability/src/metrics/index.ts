/**
 * Secondary index for the MAM Metrics layer.
 *
 * {@link MetricIndex} makes label/type discovery cheap by maintaining a set of
 * inverted structures over the series held by a {@link MetricStore}:
 *
 * - **by name** — `Map<name, Metric>` giving O(1) series lookup.
 * - **by type** — `Map<MetricType, Set<name>>` answering "which series are
 *   histograms?" without a linear scan.
 * - **by label** — `Map<labelKey, Map<labelValue, Set<name>>>` answering
 *   "which series carry `env=prod`?".
 *
 * The index stores *references* to the {@link Metric} objects that the store
 * mutates in place, so a series indexed once stays fresh: samples appended
 * later are visible through the indexed object without re-indexing. The name,
 * type and fixed label set are the only indexed attributes; per-sample labels
 * are intentionally left to {@link MetricQuery.byLabel}, which filters samples
 * at read time.
 *
 * ## Consistency model
 *
 * The index is *eventually consistent* with the store: callers should invoke
 * {@link MetricIndex.indexMetric} after creating a series (or call
 * {@link MetricIndex.rebuild} after bulk loads / {@link MetricStore.fromJSON}).
 * For write-heavy workloads the store's `eagerIndex` mode performs the
 * indexing automatically through the registry wiring in `integration.ts`.
 *
 * @module metrics/index
 */

import type {
  Metric,
  MetricLabels,
  MetricType,
  MetricsConfig,
  Timestamp,
} from './types.js';

/**
 * Aggregate statistics describing the contents of an index.
 *
 * Returned by {@link MetricIndex.stats}. All fields are derived on demand.
 */
export interface IndexStats {
  /**
   * Total number of indexed series.
   */
  readonly metrics: number;

  /**
   * Number of series indexed under each type. Only types present are included.
   */
  readonly byType: Readonly<Partial<Record<MetricType, number>>>;

  /**
   * Number of distinct label keys observed across all fixed label sets.
   */
  readonly labelKeys: number;

  /**
   * Total number of distinct label values across all keys.
   */
  readonly labelValues: number;

  /**
   * Names of the series whose fixed labels reference each label key.
   */
  readonly labels: Readonly<Record<string, number>>;

  /**
   * Epoch-millisecond timestamp of the most recent mutation of the index.
   */
  readonly updatedAt: Timestamp;
}

/**
 * Normalise a label key for use in the inverted index.
 *
 * Keys are trimmed and lower-cased so that `'ENV'` and `'env'` address the
 * same dimension. Empty keys are rejected.
 *
 * @param key - the raw label key
 * @returns a canonical key
 * @throws {TypeError} when the key is empty after trimming
 */
export function normalizeLabelKey(key: string): string {
  const cleaned = String(key).trim();
  if (cleaned.length === 0) {
    throw new TypeError('Label keys must be non-empty strings');
  }
  return cleaned.toLowerCase();
}

/**
 * Normalise a label value for use in the inverted index.
 *
 * Values are converted to a canonical string form so that `5` and `'5'` (or
 * `true` and `'true'`) address the same bucket.
 *
 * @param value - the raw label value
 * @returns a canonical string form
 */
export function normalizeLabelValue(value: string | number | boolean): string {
  return String(value).toLowerCase();
}

/**
 * The secondary index.
 *
 * See the {@link MetricIndex | module documentation} for the full contract.
 */
export class MetricIndex {
  /**
   * Series table keyed by canonical name.
   */
  #byName: Map<string, Metric>;

  /**
   * Name sets keyed by series type.
   */
  #byType: Map<MetricType, Set<string>>;

  /**
   * Nested inverted index: label key → label value → set of series names.
   */
  #byLabel: Map<string, Map<string, Set<string>>>;

  /**
   * Count of series currently labelled under each label key.
   */
  #labelCount: Map<string, number>;

  /**
   * Timestamp of the last mutation, from the injected clock.
   */
  #updatedAt: Timestamp;

  /**
   * The injected clock.
   */
  readonly #now: () => Timestamp;

  /**
   * Create an empty index, optionally pre-populated.
   *
   * @param metrics - optional initial series to index
   * @param config - optional configuration (only the clock is consulted)
   */
  constructor(metrics?: Iterable<Metric>, config?: MetricsConfig) {
    this.#byName = new Map<string, Metric>();
    this.#byType = new Map<MetricType, Set<string>>();
    this.#byLabel = new Map<string, Map<string, Set<string>>>();
    this.#labelCount = new Map<string, number>();
    this.#now = config?.now ?? (() => Date.now());
    this.#updatedAt = this.#now();
    if (metrics) {
      this.indexMany(metrics);
    }
  }

  /**
   * Index (or re-index) a single series.
   *
   * Adding a series that is already indexed is idempotent and cheap: existing
   * name/type/label entries are replaced rather than duplicated.
   *
   * @param metric - the series to index
   * @returns `this` for chaining
   */
  indexMetric(metric: Metric): this {
    const name = metric.name;
    this.#byName.set(name, metric);
    this.#addToType(metric.type, name);
    if (metric.labels) {
      for (const key of Object.keys(metric.labels)) {
        this.#addLabel(key, metric.labels[key] as string | number | boolean, name);
      }
    }
    this.#touch();
    return this;
  }

  /**
   * Index many series at once.
   *
   * More efficient than repeated {@link MetricIndex.indexMetric} calls because
   * the mutation timestamp is updated only once.
   *
   * @param metrics - the series to index
   * @returns `this` for chaining
   */
  indexMany(metrics: Iterable<Metric>): this {
    for (const metric of metrics) {
      const name = metric.name;
      this.#byName.set(name, metric);
      this.#addToType(metric.type, name);
      if (metric.labels) {
        for (const key of Object.keys(metric.labels)) {
          this.#addLabel(key, metric.labels[key] as string | number | boolean, name);
        }
      }
    }
    this.#touch();
    return this;
  }

  /**
   * Remove a series from every index structure.
   *
   * @param name - the series name
   * @returns `true` when a series was removed
   */
  removeMetric(name: string): boolean {
    const metric = this.#byName.get(name);
    if (!metric) {
      return false;
    }
    this.#byName.delete(name);
    this.#removeFromType(metric.type, name);
    if (metric.labels) {
      for (const key of Object.keys(metric.labels)) {
        this.#removeLabel(key, metric.labels[key] as string | number | boolean, name);
      }
    }
    this.#touch();
    return true;
  }

  /**
   * Look up a series by name.
   *
   * @param name - the series name
   * @returns the indexed series (a live reference), or `undefined` when absent
   */
  findByName(name: string): Metric | undefined {
    return this.#byName.get(name);
  }

  /**
   * Find every series of a given type.
   *
   * @param type - the {@link MetricType} to match
   * @returns matching series, in insertion order
   */
  findByType(type: MetricType): Metric[] {
    const names = this.#byType.get(type);
    if (!names) {
      return [];
    }
    const out: Metric[] = [];
    for (const name of names) {
      const metric = this.#byName.get(name);
      if (metric) {
        out.push(metric);
      }
    }
    return out;
  }

  /**
   * Find every series whose fixed labels carry a given key/value pair.
   *
   * The match is exact and case-insensitive: `findByLabel('env', 'prod')`
   * matches a label set of `{ env: 'PROD' }` as well as `{ env: 'prod' }`.
   *
   * @param key - the label key
   * @param value - the label value
   * @returns matching series, in insertion order
   */
  findByLabel(key: string, value: string | number | boolean): Metric[] {
    const normalizedKey = normalizeLabelKey(key);
    const byValue = this.#byLabel.get(normalizedKey);
    if (!byValue) {
      return [];
    }
    const names = byValue.get(normalizeLabelValue(value));
    if (!names) {
      return [];
    }
    const out: Metric[] = [];
    for (const name of names) {
      const metric = this.#byName.get(name);
      if (metric) {
        out.push(metric);
      }
    }
    return out;
  }

  /**
   * Find every series whose fixed labels satisfy *all* of the given pairs.
   *
   * Acts as the intersection of repeated {@link MetricIndex.findByLabel}
   * queries, which is useful for queries such as `{ env: 'prod', region: 'eu' }`.
   *
   * @param labels - the label pairs to match (AND semantics)
   * @returns matching series, in insertion order
   */
  findByLabels(labels: MetricLabels): Metric[] {
    const entries = Object.entries(labels);
    if (entries.length === 0) {
      return Array.from(this.#byName.values());
    }
    let candidates: Set<string> | undefined;
    for (const [key, value] of entries) {
      const normalizedKey = normalizeLabelKey(key);
      const byValue = this.#byLabel.get(normalizedKey);
      if (!byValue) {
        return [];
      }
      const names = byValue.get(normalizeLabelValue(value as string | number | boolean));
      if (!names) {
        return [];
      }
      if (candidates === undefined) {
        candidates = new Set(names);
      } else {
        for (const name of Array.from(candidates)) {
          if (!names.has(name)) {
            candidates.delete(name);
          }
        }
      }
    }
    const out: Metric[] = [];
    if (candidates) {
      for (const name of candidates) {
        const metric = this.#byName.get(name);
        if (metric) {
          out.push(metric);
        }
      }
    }
    return out;
  }

  /**
   * Whether a name is currently indexed.
   *
   * @param name - the series name
   * @returns `true` when indexed
   */
  has(name: string): boolean {
    return this.#byName.has(name);
  }

  /**
   * Number of indexed series.
   */
  get size(): number {
    return this.#byName.size;
  }

  /**
   * All currently-indexed series names.
   */
  keys(): string[] {
    return Array.from(this.#byName.keys());
  }

  /**
   * Rebuild every inverted structure from a set of series.
   *
   * This is the correct way to resynchronise the index after bulk mutations or
   * a {@link MetricStore.fromJSON} restore: it clears all structures and
   * re-indexes from scratch in a single pass.
   *
   * @param metrics - the authoritative series set
   * @returns `this` for chaining
   */
  rebuild(metrics: Iterable<Metric>): this {
    this.#byName.clear();
    this.#byType.clear();
    this.#byLabel.clear();
    this.#labelCount.clear();
    this.indexMany(metrics);
    return this;
  }

  /**
   * Remove every entry from the index.
   *
   * @returns `this` for chaining
   */
  clear(): this {
    this.#byName.clear();
    this.#byType.clear();
    this.#byLabel.clear();
    this.#labelCount.clear();
    this.#touch();
    return this;
  }

  /**
   * Aggregate statistics about the indexed contents.
   *
   * @returns a freshly-computed {@link IndexStats}
   */
  stats(): IndexStats {
    const byType: Partial<Record<MetricType, number>> = {};
    for (const [type, names] of this.#byType) {
      byType[type] = names.size;
    }
    let labelValues = 0;
    for (const byValue of this.#byLabel.values()) {
      labelValues += byValue.size;
    }
    const labels: Record<string, number> = {};
    for (const [key, count] of this.#labelCount) {
      labels[key] = count;
    }
    return {
      metrics: this.#byName.size,
      byType,
      labelKeys: this.#byLabel.size,
      labelValues,
      labels,
      updatedAt: this.#updatedAt,
    };
  }

  /**
   * Record the timestamp of the most recent mutation.
   */
  #touch(): void {
    this.#updatedAt = this.#now();
  }

  /**
   * Add a name to the type bucket.
   *
   * @param type - the series type
   * @param name - the series name
   */
  #addToType(type: MetricType, name: string): void {
    let bucket = this.#byType.get(type);
    if (!bucket) {
      bucket = new Set<string>();
      this.#byType.set(type, bucket);
    }
    bucket.add(name);
  }

  /**
   * Remove a name from its type bucket, dropping empty buckets.
   *
   * @param type - the series type
   * @param name - the series name
   */
  #removeFromType(type: MetricType, name: string): void {
    const bucket = this.#byType.get(type);
    if (!bucket) {
      return;
    }
    bucket.delete(name);
    if (bucket.size === 0) {
      this.#byType.delete(type);
    }
  }

  /**
   * Add a name to the inverted label index.
   *
   * @param key - the raw label key
   * @param value - the raw label value
   * @param name - the series name
   */
  #addLabel(key: string, value: string | number | boolean, name: string): void {
    const normalizedKey = normalizeLabelKey(key);
    const normalizedValue = normalizeLabelValue(value);
    let byValue = this.#byLabel.get(normalizedKey);
    if (!byValue) {
      byValue = new Map<string, Set<string>>();
      this.#byLabel.set(normalizedKey, byValue);
    }
    let names = byValue.get(normalizedValue);
    if (!names) {
      names = new Set<string>();
      byValue.set(normalizedValue, names);
    }
    names.add(name);
    this.#labelCount.set(normalizedKey, (this.#labelCount.get(normalizedKey) ?? 0) + 1);
  }

  /**
   * Remove a name from the inverted label index, dropping empty buckets.
   *
   * @param key - the raw label key
   * @param value - the raw label value
   * @param name - the series name
   */
  #removeLabel(key: string, value: string | number | boolean, name: string): void {
    const normalizedKey = normalizeLabelKey(key);
    const byValue = this.#byLabel.get(normalizedKey);
    if (!byValue) {
      return;
    }
    const names = byValue.get(normalizeLabelValue(value));
    if (!names) {
      return;
    }
    names.delete(name);
    const count = (this.#labelCount.get(normalizedKey) ?? 0) - 1;
    if (count <= 0) {
      this.#labelCount.delete(normalizedKey);
    } else {
      this.#labelCount.set(normalizedKey, count);
    }
    if (names.size === 0) {
      byValue.delete(normalizeLabelValue(value));
    }
    if (byValue.size === 0) {
      this.#byLabel.delete(normalizedKey);
    }
  }
}