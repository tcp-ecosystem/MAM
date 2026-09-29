/**
 * store.ts
 *
 * {@link CostStore} — an in-memory, dependency-free repository for
 * {@link CostRecord} objects.
 *
 * The store is the write-path of the Costs layer. It owns record identity
 * (generating UUIDs for records that arrive without one), validation,
 * eviction policy and O(1) lookup by id. Crucially, it maintains running
 * aggregates as records are inserted and removed, so `stats()`, `getTotal()`,
 * `getByModel()` and `getByProvider()` never scan the full collection.
 *
 * Features:
 *  - Ingest via `record()` / `recordMany()`; inputs are normalized into full
 *    records (default currency, precision rounding, timestamp fill-in).
 *  - Optional `maxRecords` cap with a pluggable eviction policy.
 *  - Serialization: `toJSON()` / `fromJSON()` (both static and instance) for
 *    persistence and hot reload.
 *  - Iterable, so the store can be spread into arrays or piped into the index.
 *
 * The store is intentionally provider/model agnostic; grouping is the job of
 * {@link CostIndex}, retrieval is the job of {@link CostQuery}.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import {
  type CostAggregate,
  type CostCurrency,
  type CostOptions,
  type CostRecord,
  type CostRecordInput,
  type CostStats,
  CostError,
  DEFAULT_CURRENCY,
  DEFAULT_PRECISION,
  UNKNOWN_PROVIDER,
  assertValidTokenCount,
  clamp,
  compareCostRecords,
  isCostRecordInput,
  isValidTimestamp,
  roundCost,
} from './types.js';

/**
 * Version tag embedded in {@link CostStoreSnapshot} so `fromJSON` can reject
 * snapshots written by an incompatible schema in the future.
 */
const SNAPSHOT_VERSION = 1;

/**
 * Format used by {@link CostStore.toJSON}. Kept explicit (instead of returning
 * the raw array) so future versions can attach schema metadata.
 */
export interface CostStoreSnapshot {
  /**
   * Schema version; always {@link SNAPSHOT_VERSION} for this build.
   */
  version: number;
  /**
   * Unix epoch (ms) the snapshot was produced.
   */
  exportedAt: number;
  /**
   * Currency the snapshot's records are denominated in.
   */
  currency: CostCurrency;
  /**
   * The records themselves, in insertion order.
   */
  records: CostRecord[];
}

/**
 * Internal running-aggregate structure maintained incrementally so that
 * statistics and grouped queries do not require full scans.
 */
interface CostStoreAggregate {
  /** Sum of all record costs. */
  totalCost: number;
  /** Sum of all input tokens. */
  totalTokensIn: number;
  /** Sum of all output tokens. */
  totalTokensOut: number;
  /** Number of records in the bucket. */
  count: number;
  /** Smallest single-record cost (0 when empty). */
  minCost: number;
  /** Largest single-record cost (0 when empty). */
  maxCost: number;
  /** Earliest record timestamp (null when empty). */
  oldest: number | null;
  /** Latest record timestamp (null when empty). */
  newest: number | null;
}

/**
 * Returns a fresh, zeroed aggregate bucket.
 *
 * @returns An empty aggregate bucket.
 */
function emptyAggregate(): CostStoreAggregate {
  return {
    totalCost: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    count: 0,
    minCost: 0,
    maxCost: 0,
    oldest: null,
    newest: null,
  };
}

/**
 * Merges one record into a running aggregate. Pure with respect to `bucket`:
 * a new bucket object is returned, the input bucket is left untouched.
 *
 * @param bucket - Running aggregate to fold into.
 * @param record - Record to fold in.
 * @returns The merged aggregate.
 */
function foldRecord(bucket: CostStoreAggregate, record: CostRecord): CostStoreAggregate {
  const next: CostStoreAggregate = {
    totalCost: roundCost(bucket.totalCost + record.cost),
    totalTokensIn: bucket.totalTokensIn + record.tokensIn,
    totalTokensOut: bucket.totalTokensOut + record.tokensOut,
    count: bucket.count + 1,
    minCost: bucket.count === 0 ? record.cost : Math.min(bucket.minCost, record.cost),
    maxCost: bucket.count === 0 ? record.cost : Math.max(bucket.maxCost, record.cost),
    oldest: bucket.oldest === null ? record.timestamp : Math.min(bucket.oldest, record.timestamp),
    newest: bucket.newest === null ? record.timestamp : Math.max(bucket.newest, record.timestamp),
  };
  return next;
}

/**
 * Removes one record from a running aggregate. Used on delete/eviction so the
 * incremental statistics stay exact without a full recomputation.
 *
 * @param bucket - Running aggregate to fold out of.
 * @param record - Record to remove.
 * @returns The reduced aggregate.
 */
function unfoldRecord(bucket: CostStoreAggregate, record: CostRecord): CostStoreAggregate {
  const next: CostStoreAggregate = {
    totalCost: roundCost(Math.max(0, bucket.totalCost - record.cost)),
    totalTokensIn: Math.max(0, bucket.totalTokensIn - record.tokensIn),
    totalTokensOut: Math.max(0, bucket.totalTokensOut - record.tokensOut),
    count: Math.max(0, bucket.count - 1),
    minCost: bucket.minCost,
    maxCost: bucket.maxCost,
    oldest: bucket.oldest,
    newest: bucket.newest,
  };
  if (next.count === 0) {
    return emptyAggregate();
  }
  if (bucket.minCost === record.cost || bucket.maxCost === record.cost) {
    return recomputeAggregateOver(bucket, [record]);
  }
  if (bucket.oldest === record.timestamp) {
    next.oldest = null;
    next.newest = bucket.newest;
  }
  if (bucket.newest === record.timestamp) {
    next.newest = null;
  }
  return next;
}

/**
 * Recomputes min/max/extrema after removing a record that was itself an
 * extremum, since those cannot be derived incrementally. Scans the store once.
 *
 * @param bucket - Aggregate to repair.
 * @param records - All remaining records.
 * @returns Repaired aggregate.
 */
function recomputeAggregateOver(bucket: CostStoreAggregate, records: Iterable<CostRecord>): CostStoreAggregate {
  const next = emptyAggregate();
  for (const record of records) {
    next.totalCost = roundCost(next.totalCost + record.cost);
    next.totalTokensIn += record.tokensIn;
    next.totalTokensOut += record.tokensOut;
    next.count += 1;
    next.minCost = next.count === 1 ? record.cost : Math.min(next.minCost, record.cost);
    next.maxCost = next.count === 1 ? record.cost : Math.max(next.maxCost, record.cost);
    next.oldest = next.oldest === null ? record.timestamp : Math.min(next.oldest, record.timestamp);
    next.newest = next.newest === null ? record.timestamp : Math.max(next.newest, record.timestamp);
  }
  void bucket;
  return next;
}

/**
 * CostStore
 *
 * In-memory store for {@link CostRecord} objects with O(1) id lookup and
 * incrementally maintained statistics. All mutation methods are synchronous
 * and atomic with respect to the store's own invariants.
 */
export class CostStore implements Iterable<CostRecord> {
  /** Backing dictionary keyed by record id. */
  private readonly records: Map<string, CostRecord> = new Map();

  /** Global running aggregate. */
  private aggregate: CostStoreAggregate = emptyAggregate();

  /** Per-model running aggregates. */
  private readonly modelAggregates: Map<string, CostStoreAggregate> = new Map();

  /** Per-provider running aggregates. */
  private readonly providerAggregates: Map<string, CostStoreAggregate> = new Map();

  /** Per-session running aggregates. */
  private readonly sessionAggregates: Map<string, CostStoreAggregate> = new Map();

  /** Distinct model names (maintained for stats()). */
  private readonly modelNames: Set<string> = new Set();

  /** Distinct provider names (maintained for stats()). */
  private readonly providerNames: Set<string> = new Set();

  /** Distinct session ids (maintained for stats()). */
  private readonly sessionIds: Set<string> = new Set();

  /** Id prefix for auto-generated ids. */
  private readonly idPrefix: string;

  /** Default currency applied to records without one. */
  private readonly currency: CostCurrency;

  /** Rounding precision for normalized costs. */
  private readonly precision: number;

  /** Optional hard cap on record count. */
  private readonly maxRecords: number | undefined;

  /** Behaviour when {@link CostStore.maxRecords} is exceeded. */
  private readonly evictionPolicy: 'oldest' | 'error' | 'ignore';

  /** Whether ingestion validates inputs. */
  private readonly validate: boolean;

  /** Whether invalid inputs throw. */
  private readonly throwOnInvalid: boolean;

  /**
   * @param options - Tuning knobs for this store (see {@link CostOptions}).
   */
  constructor(options: CostOptions = {}) {
    this.idPrefix = options.idPrefix ?? 'cost';
    this.currency = options.currency ?? DEFAULT_CURRENCY;
    this.precision = options.precision ?? DEFAULT_PRECISION;
    this.maxRecords = options.maxRecords;
    this.evictionPolicy = options.evictionPolicy ?? 'oldest';
    this.validate = options.validate ?? true;
    this.throwOnInvalid = options.throwOnInvalid ?? true;
  }

  /**
   * Number of records currently stored.
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Currency this store normalizes records to.
   */
  get defaultCurrency(): CostCurrency {
    return this.currency;
  }

  /**
   * Generates a namespaced, collision-free id for a record.
   *
   * @returns A new id string.
   */
  private generateId(): string {
    return `${this.idPrefix}_${randomUUID()}`;
  }

  /**
   * Normalizes a {@link CostRecordInput} into a complete {@link CostRecord},
   * filling defaults and rounding the cost. Throws when validation fails and
   * {@link CostStore.throwOnInvalid} is enabled.
   *
   * @param input - Raw ingest shape.
   * @returns A normalized record.
   */
  private normalize(input: CostRecordInput): CostRecord {
    const model = String(input.model).trim();
    if (this.validate) {
      assertValidTokenCount(input.tokensIn, 'tokensIn');
      assertValidTokenCount(input.tokensOut, 'tokensOut');
      if (model.length === 0) {
        throw new CostError('ERR_INVALID_MODEL', 'model must be a non-empty string');
      }
      if (input.timestamp !== undefined && !isValidTimestamp(input.timestamp)) {
        throw new CostError('ERR_INVALID_TIMESTAMP', `timestamp must be a valid epoch ms value, got ${input.timestamp}`);
      }
      if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) {
        throw new CostError('ERR_INVALID_COST', `cost must be a non-negative finite number, got ${input.cost}`);
      }
      if (input.inputCostPer1k !== undefined && (!Number.isFinite(input.inputCostPer1k) || input.inputCostPer1k < 0)) {
        throw new CostError('ERR_INVALID_RATE', `inputCostPer1k must be non-negative, got ${input.inputCostPer1k}`);
      }
      if (input.outputCostPer1k !== undefined && (!Number.isFinite(input.outputCostPer1k) || input.outputCostPer1k < 0)) {
        throw new CostError('ERR_INVALID_RATE', `outputCostPer1k must be non-negative, got ${input.outputCostPer1k}`);
      }
    }
    const hasRates =
      input.inputCostPer1k !== undefined && input.outputCostPer1k !== undefined;
    const computedCost = hasRates
      ? (input.tokensIn * (input.inputCostPer1k as number)) / 1000 +
        (input.tokensOut * (input.outputCostPer1k as number)) / 1000
      : 0;
    const cost = input.cost !== undefined ? input.cost : computedCost;
    return {
      id: input.id ?? this.generateId(),
      model,
      provider: input.provider ?? UNKNOWN_PROVIDER,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      inputCostPer1k: input.inputCostPer1k,
      outputCostPer1k: input.outputCostPer1k,
      cost: roundCost(cost, this.precision),
      currency: input.currency ?? this.currency,
      timestamp: input.timestamp ?? Date.now(),
      sessionId: input.sessionId,
      callId: input.callId,
      metadata: input.metadata,
    };
  }

  /**
   * Folds a normalized record into every running aggregate (global + by model,
   * provider and session).
   *
   * @param record - Record to fold in.
   */
  private track(record: CostRecord): void {
    this.aggregate = foldRecord(this.aggregate, record);
    this.modelNames.add(record.model);
    this.providerNames.add(record.provider ?? UNKNOWN_PROVIDER);
    if (record.sessionId !== undefined) this.sessionIds.add(record.sessionId);
    this.modelAggregates.set(record.model, foldRecord(this.modelAggregates.get(record.model) ?? emptyAggregate(), record));
    const provider = record.provider ?? UNKNOWN_PROVIDER;
    this.providerAggregates.set(provider, foldRecord(this.providerAggregates.get(provider) ?? emptyAggregate(), record));
    if (record.sessionId !== undefined) {
      this.sessionAggregates.set(record.sessionId, foldRecord(this.sessionAggregates.get(record.sessionId) ?? emptyAggregate(), record));
    }
  }

  /**
   * Folds a normalized record out of every running aggregate. Called on
   * delete/eviction to keep stats exact.
   *
   * @param record - Record to fold out.
   */
  private untrack(record: CostRecord): void {
    this.aggregate = unfoldRecord(this.aggregate, record);
    this.modelAggregates.set(record.model, unfoldRecord(this.modelAggregates.get(record.model) ?? emptyAggregate(), record));
    const provider = record.provider ?? UNKNOWN_PROVIDER;
    this.providerAggregates.set(provider, unfoldRecord(this.providerAggregates.get(provider) ?? emptyAggregate(), record));
    if (record.sessionId !== undefined) {
      this.sessionAggregates.set(record.sessionId, unfoldRecord(this.sessionAggregates.get(record.sessionId) ?? emptyAggregate(), record));
      const remaining = this.sessionAggregates.get(record.sessionId);
      if (remaining && remaining.count === 0) this.sessionIds.delete(record.sessionId);
    }
    if ((this.modelAggregates.get(record.model)?.count ?? 0) === 0) this.modelNames.delete(record.model);
    if ((this.providerAggregates.get(provider)?.count ?? 0) === 0) this.providerNames.delete(provider);
  }

  /**
   * Applies the configured eviction policy when {@link CostStore.maxRecords}
   * would be exceeded. Returns `true` when the incoming record may proceed.
   *
   * @returns `false` when the incoming record should be dropped.
   */
  private enforceCapacity(): boolean {
    if (this.maxRecords === undefined || this.records.size < this.maxRecords) return true;
    if (this.evictionPolicy === 'ignore') return false;
    if (this.evictionPolicy === 'error') {
      throw new CostError('ERR_MAX_RECORDS', `store capacity of ${this.maxRecords} records exceeded`);
    }
    let oldestId: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const record of this.records.values()) {
      if (record.timestamp < oldestTs) {
        oldestTs = record.timestamp;
        oldestId = record.id;
      }
    }
    if (oldestId !== null) this.delete(oldestId);
    return true;
  }

  /**
   * Records a single call. Normalizes the input, applies capacity policy and
   * returns the stored, normalized record.
   *
   * @param input - The call to record.
   * @returns The normalized record that was stored.
   * @throws CostError when validation fails and `throwOnInvalid` is enabled.
   */
  record(input: CostRecordInput): CostRecord {
    if (!isCostRecordInput(input)) {
      if (this.throwOnInvalid) throw new CostError('ERR_INVALID_RECORD', 'input is not a valid cost record input');
      if (!this.validate) return input as unknown as CostRecord;
    }
    const record = this.normalize(input);
    if (this.records.has(record.id)) {
      throw new CostError('ERR_DUPLICATE_ID', `record with id "${record.id}" already exists`);
    }
    if (!this.enforceCapacity()) {
      if (this.throwOnInvalid) {
        throw new CostError('ERR_CAPACITY_DROP', `record dropped by ${this.evictionPolicy} policy`);
      }
      return record;
    }
    this.records.set(record.id, record);
    this.track(record);
    return record;
  }

  /**
   * Records many calls in one batch. Behaves like repeated {@link record}
   * calls but only returns after all inputs are processed.
   *
   * @param inputs - Calls to record.
   * @returns The stored, normalized records.
   */
  recordMany(inputs: readonly CostRecordInput[]): CostRecord[] {
    return inputs.map((input) => this.record(input));
  }

  /**
   * Fetches a record by id.
   *
   * @param id - Record id.
   * @returns The record, or `undefined` when absent.
   */
  get(id: string): CostRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Deletes a record by id.
   *
   * @param id - Record id.
   * @returns `true` when a record was deleted, `false` when the id was absent.
   */
  delete(id: string): boolean {
    const record = this.records.get(id);
    if (record === undefined) return false;
    this.records.delete(id);
    this.untrack(record);
    return true;
  }

  /**
   * Deletes every record matching a predicate.
   *
   * @param predicate - Called once per record; return `true` to delete.
   * @returns The number of records deleted.
   */
  deleteWhere(predicate: (record: CostRecord) => boolean): number {
    let removed = 0;
    for (const record of [...this.records.values()]) {
      if (predicate(record) && this.delete(record.id)) removed += 1;
    }
    return removed;
  }

  /**
   * Whether a record id is present.
   *
   * @param id - Record id.
   * @returns True when present.
   */
  has(id: string): boolean {
    return this.records.has(id);
  }

  /**
   * Iterates over stored record ids.
   *
   * @returns An iterator of ids.
   */
  keys(): IterableIterator<string> {
    return this.records.keys();
  }

  /**
   * All record ids as a stable array.
   *
   * @returns Array of ids.
   */
  ids(): string[] {
    return [...this.records.keys()];
  }

  /**
   * All records as a stable array, sorted by (timestamp, id).
   *
   * @returns Sorted record array.
   */
  values(): CostRecord[] {
    return [...this.records.values()].sort(compareCostRecords);
  }

  /**
   * Removes every record. Resets all running aggregates.
   */
  clear(): void {
    this.records.clear();
    this.aggregate = emptyAggregate();
    this.modelAggregates.clear();
    this.providerAggregates.clear();
    this.sessionAggregates.clear();
    this.modelNames.clear();
    this.providerNames.clear();
    this.sessionIds.clear();
  }

  /**
   * Sum of every stored record's cost.
   *
   * @returns Total cost in the store's default currency.
   */
  getTotal(): number {
    return this.aggregate.totalCost;
  }

  /**
   * Total tokens recorded: `{ tokensIn, tokensOut, total }`.
   *
   * @returns Token totals.
   */
  getTokenTotals(): { tokensIn: number; tokensOut: number; total: number } {
    return {
      tokensIn: this.aggregate.totalTokensIn,
      tokensOut: this.aggregate.totalTokensOut,
      total: this.aggregate.totalTokensIn + this.aggregate.totalTokensOut,
    };
  }

  /**
   * Every record matching a model name, sorted by (timestamp, id).
   *
   * @param model - Model name.
   * @returns Matching records.
   */
  getByModel(model: string): CostRecord[] {
    const ids = [...this.records.values()].filter((r) => r.model === model);
    return ids.sort(compareCostRecords);
  }

  /**
   * Every record matching a provider name, sorted by (timestamp, id).
   *
   * @param provider - Provider name.
   * @returns Matching records.
   */
  getByProvider(provider: string): CostRecord[] {
    const ids = [...this.records.values()].filter((r) => (r.provider ?? UNKNOWN_PROVIDER) === provider);
    return ids.sort(compareCostRecords);
  }

  /**
   * Every record belonging to a session, sorted by (timestamp, id).
   *
   * @param sessionId - Session id.
   * @returns Matching records.
   */
  getBySession(sessionId: string): CostRecord[] {
    const ids = [...this.records.values()].filter((r) => r.sessionId === sessionId);
    return ids.sort(compareCostRecords);
  }

  /**
   * Aggregate cost attributable to a single model.
   *
   * @param model - Model name.
   * @returns The bucket's total cost, or 0.
   */
  getModelTotal(model: string): number {
    return this.modelAggregates.get(model)?.totalCost ?? 0;
  }

  /**
   * Aggregate cost attributable to a single provider.
   *
   * @param provider - Provider name.
   * @returns The bucket's total cost, or 0.
   */
  getProviderTotal(provider: string): number {
    return this.providerAggregates.get(provider)?.totalCost ?? 0;
  }

  /**
   * Aggregate cost attributable to a single session.
   *
   * @param sessionId - Session id.
   * @returns The bucket's total cost, or 0.
   */
  getSessionTotal(sessionId: string): number {
    return this.sessionAggregates.get(sessionId)?.totalCost ?? 0;
  }

  /**
   * Converts a running aggregate bucket into the public {@link CostAggregate}
   * shape.
   *
   * @param key - Bucket key (model/provider/session name).
   * @param bucket - Running aggregate.
   * @returns Public aggregate.
   */
  private toCostAggregate(key: string, bucket: CostStoreAggregate): CostAggregate {
    return {
      key,
      count: bucket.count,
      totalCost: bucket.totalCost,
      totalTokensIn: bucket.totalTokensIn,
      totalTokensOut: bucket.totalTokensOut,
      averageCost: bucket.count === 0 ? 0 : roundCost(bucket.totalCost / bucket.count),
      minCost: bucket.minCost,
      maxCost: bucket.maxCost,
      currency: this.currency,
      firstTimestamp: bucket.oldest,
      lastTimestamp: bucket.newest,
    };
  }

  /**
   * Per-model cost aggregates, sorted by total cost descending.
   *
   * @returns Aggregate buckets for every present model.
   */
  getModelAggregates(): CostAggregate[] {
    return [...this.modelAggregates.entries()]
      .map(([key, bucket]) => this.toCostAggregate(key, bucket))
      .sort((a, b) => b.totalCost - a.totalCost || a.key.localeCompare(b.key));
  }

  /**
   * Per-provider cost aggregates, sorted by total cost descending.
   *
   * @returns Aggregate buckets for every present provider.
   */
  getProviderAggregates(): CostAggregate[] {
    return [...this.providerAggregates.entries()]
      .map(([key, bucket]) => this.toCostAggregate(key, bucket))
      .sort((a, b) => b.totalCost - a.totalCost || a.key.localeCompare(b.key));
  }

  /**
   * Per-session cost aggregates, sorted by total cost descending.
   *
   * @returns Aggregate buckets for every present session.
   */
  getSessionAggregates(): CostAggregate[] {
    return [...this.sessionAggregates.entries()]
      .map(([key, bucket]) => this.toCostAggregate(key, bucket))
      .sort((a, b) => b.totalCost - a.totalCost || a.key.localeCompare(b.key));
  }

  /**
   * A full statistical snapshot of the store (see {@link CostStats}).
   *
   * @returns Current statistics.
   */
  stats(): CostStats {
    return {
      recordCount: this.aggregate.count,
      totalCost: this.aggregate.totalCost,
      totalTokensIn: this.aggregate.totalTokensIn,
      totalTokensOut: this.aggregate.totalTokensOut,
      averageCostPerCall: this.aggregate.count === 0 ? 0 : roundCost(this.aggregate.totalCost / this.aggregate.count),
      models: this.modelNames.size,
      providers: this.providerNames.size,
      sessions: this.sessionIds.size,
      minCost: this.aggregate.minCost,
      maxCost: this.aggregate.maxCost,
      currency: this.currency,
      oldestRecord: this.aggregate.oldest,
      newestRecord: this.aggregate.newest,
    };
  }

  /**
   * Serializes the store to a plain, JSON-safe snapshot.
   *
   * @returns A {@link CostStoreSnapshot}.
   */
  toJSON(): CostStoreSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      exportedAt: Date.now(),
      currency: this.currency,
      records: this.values(),
    };
  }

  /**
   * Replaces the store contents with a snapshot produced by {@link toJSON}.
   * Clears existing data first.
   *
   * @param snapshot - Snapshot to load.
   * @returns This store, for chaining.
   * @throws CostError when the snapshot version is unsupported.
   */
  fromJSON(snapshot: CostStoreSnapshot): this {
    if (!snapshot || typeof snapshot.version !== 'number' || snapshot.version > SNAPSHOT_VERSION) {
      throw new CostError('ERR_SNAPSHOT_VERSION', `unsupported snapshot version: ${snapshot?.version}`);
    }
    this.clear();
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    for (const record of records) {
      this.records.set(record.id, record);
      this.track(record);
    }
    return this;
  }

  /**
   * Rebuilds a {@link CostStore} from a snapshot, statically.
   *
   * @param snapshot - Snapshot to load.
   * @param options - Store construction options.
   * @returns A populated store.
   */
  static fromJSON(snapshot: CostStoreSnapshot, options: CostOptions = {}): CostStore {
    return new CostStore(options).fromJSON(snapshot);
  }

  /**
   * Makes the store directly iterable (`for (const r of store) ...`).
   *
   * @returns An iterator over stored records (insertion order).
   */
  *[Symbol.iterator](): Iterator<CostRecord> {
    yield* this.records.values();
  }
}