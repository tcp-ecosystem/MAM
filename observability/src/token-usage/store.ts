/**
 * @fileoverview In-memory store for {@link TokenUsageRecord} instances.
 *
 * The store is the authoritative persistence point for the Token usage layer.
 * It owns the master record map and provides indexed-style lookups by id and
 * model, aggregate statistics, and JSON serialization so records can be
 * persisted to disk, replayed, or shipped to a remote collector.
 *
 * The store is intentionally dependency-free: it relies only on built-in
 * `Map` semantics, `node:crypto` (via {@link createRecordId}) and the shared
 * types/helpers in `./types.js`. Thread safety is a non-issue because Node is
 * single threaded; concurrent writes from async code are serialized by the
 * event loop.
 *
 * @packageDocumentation
 */

import {
  computeTotalTokens,
  createRecordId,
  DEFAULT_TOKEN_USAGE_CONFIG,
  EMPTY_STATS,
  isTokenUsageRecord,
  normalizeCost,
  normalizeTokenCount,
  providerOf,
  type MutableTokenTotals,
  type TokenUsageConfig,
  type TokenUsageRecord,
  type TokenUsageStats,
  type TokenTotals,
  type TotalsMap,
  UNKNOWN_PROVIDER,
} from './types.js';

/**
 * A plain serializable representation of a store, produced by
 * {@link TokenUsageStore.toJSON} and consumed by
 * {@link TokenUsageStore.fromJSON}.
 */
export interface TokenUsageStoreSnapshot {
  /**
   * The config active at serialization time.
   */
  readonly config: TokenUsageConfig;

  /**
   * The serialized records, sorted by timestamp ascending.
   */
  readonly records: TokenUsageRecord[];

  /**
   * The stats active at serialization time.
   */
  readonly stats: TokenUsageStats;
}

/**
 * Incremental aggregator used to keep {@link TokenUsageStats} up to date
 * without scanning the whole store on every call.
 *
 * It mirrors the store's deduplication semantics: when a record id is
 * re-registered, the previous record's contribution is subtracted before the
 * new one is added, keeping counters exact.
 */
class StatsAccumulator {
  /** Total input tokens across live records. */
  private inputTokens = 0;

  /** Total output tokens across live records. */
  private outputTokens = 0;

  /** Total tokens across live records. */
  private totalTokens = 0;

  /** Total cost across live records. */
  private totalCost = 0;

  /** Distinct model names, keyed by name (presence only). */
  private readonly models = new Map<string, true>();

  /** Distinct provider labels, keyed by label (presence only). */
  private readonly providers = new Map<string, true>();

  /** Epoch ms of the oldest live record, or `Infinity` while empty. */
  private earliest = Infinity;

  /** Epoch ms of the newest live record, or `-Infinity` while empty. */
  private latest = -Infinity;

  /**
   * Adds a record's contribution to the accumulator.
   *
   * @param record - The record being added.
   * @param defaultProvider - Provider label used when the record has none.
   */
  add(record: TokenUsageRecord, defaultProvider: string): void {
    this.inputTokens += record.inputTokens;
    this.outputTokens += record.outputTokens;
    this.totalTokens += record.totalTokens;
    this.totalCost += record.cost ?? 0;
    this.models.set(record.model, true);
    this.providers.set(providerOf(record, defaultProvider), true);
    if (record.timestamp < this.earliest) {
      this.earliest = record.timestamp;
    }
    if (record.timestamp > this.latest) {
      this.latest = record.timestamp;
    }
  }

  /**
   * Removes a record's contribution from the accumulator.
   *
   * @param record - The record being removed.
   * @param defaultProvider - Provider label used when the record has none.
   */
  remove(record: TokenUsageRecord, defaultProvider: string): void {
    this.inputTokens = Math.max(0, this.inputTokens - record.inputTokens);
    this.outputTokens = Math.max(0, this.outputTokens - record.outputTokens);
    this.totalTokens = Math.max(0, this.totalTokens - record.totalTokens);
    this.totalCost = Math.max(0, this.totalCost - (record.cost ?? 0));
    // Presence sets are intentionally NOT shrunk on remove: recomputation of
    // distinct counts happens in buildStats() which derives them from the map.
    this.models.delete(record.model);
    this.providers.delete(providerOf(record, defaultProvider));
  }

  /**
   * Materializes the current counters into a {@link TokenUsageStats} object.
   *
   * @param recordCount - The live record count from the store map.
   * @returns A snapshot of the current statistics.
   */
  buildStats(recordCount: number): TokenUsageStats {
    if (recordCount === 0) {
      return EMPTY_STATS;
    }
    return {
      recordCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      distinctModels: this.models.size,
      distinctProviders: this.providers.size,
      earliestTimestamp: this.earliest,
      latestTimestamp: this.latest,
    };
  }

  /**
   * Resets every counter, returning the accumulator to its pristine state.
   */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.models.clear();
    this.providers.clear();
    this.earliest = Infinity;
    this.latest = -Infinity;
  }
}

/**
 * The canonical in-memory store for token usage records.
 *
 * Responsibilities:
 * - Unique-id tracking with optional deduplication
 * - Total-invariant enforcement and count/cost normalization
 * - Per-model lookups via {@link getByModel}
 * - Aggregate statistics via {@link stats} and {@link getTotals}
 * - Full JSON serialization via {@link toJSON} / {@link fromJSON}
 * - Optional record cap with oldest-first eviction
 *
 * @example
 * ```ts
 * const store = new TokenUsageStore();
 * store.record({
 *   id: 'r1', model: 'gpt-4o', provider: 'openai',
 *   inputTokens: 10, outputTokens: 5, totalTokens: 15, timestamp: Date.now(),
 * });
 * store.getTotals().totalTokens; // 15
 * ```
 */
export class TokenUsageStore {
  /** Active configuration for this store instance. */
  private readonly config: TokenUsageConfig;

  /** Master record map keyed by record id. */
  private readonly records = new Map<string, TokenUsageRecord>();

  /** Incremental statistics accumulator. */
  private readonly accumulator = new StatsAccumulator();

  /**
   * Creates a new store.
   *
   * @param config - Optional configuration overrides. Merged over
   * {@link DEFAULT_TOKEN_USAGE_CONFIG}.
   */
  constructor(config?: Partial<TokenUsageConfig>) {
    this.config = { ...DEFAULT_TOKEN_USAGE_CONFIG, ...config };
  }

  /**
   * Returns the effective configuration in use by this store.
   *
   * @returns A copy of the configuration so callers cannot mutate internals.
   */
  getConfig(): TokenUsageConfig {
    return { ...this.config };
  }

  /**
   * Registers a new record in the store.
   *
   * When {@link TokenUsageConfig.deduplicateById} is enabled and a record with
   * the same id already exists, the previous record is replaced and its
   * contribution to the statistics is removed first. When the store is at its
   * {@link TokenUsageConfig.maxRecords} cap, the oldest records are evicted to
   * make room for the new one.
   *
   * @param input - The record to store. When `totalTokens` is missing or the
   * total invariant is enforced, the value is recomputed from input+output.
   * @returns The normalized record that was actually stored. This may differ
   * from `input` when normalization or the invariant recomputation kicked in.
   * @throws {TypeError} When `input` fails structural validation.
   */
  record(input: TokenUsageRecord): TokenUsageRecord {
    if (!isTokenUsageRecord(input)) {
      throw new TypeError('TokenUsageStore.record: invalid token usage record');
    }
    const normalized: TokenUsageRecord = {
      ...input,
      inputTokens: normalizeTokenCount(input.inputTokens),
      outputTokens: normalizeTokenCount(input.outputTokens),
      totalTokens: computeTotalTokens(
        input.inputTokens,
        input.outputTokens,
        input.totalTokens,
        this.config.enforceTotalInvariant,
      ),
      cost: typeof input.cost === 'number' ? normalizeCost(input.cost) : undefined,
    };

    const existing = this.records.get(normalized.id);
    if (existing) {
      if (this.config.deduplicateById) {
        this.accumulator.remove(existing, this.config.defaultProvider);
      } else {
        // Without dedup the id would collide silently; refuse the write.
        throw new Error(
          `TokenUsageStore.record: duplicate id "${normalized.id}" and deduplication is disabled`,
        );
      }
    }

    this.records.set(normalized.id, normalized);
    this.accumulator.add(normalized, this.config.defaultProvider);

    if (this.config.maxRecords > 0 && this.records.size > this.config.maxRecords) {
      this.evictOldest(this.records.size - this.config.maxRecords);
    }
    return normalized;
  }

  /**
   * Convenience factory that builds and stores a record from raw call metrics.
   *
   * This is the record constructor used by the integration layer when a
   * provider response is reduced to its token counts.
   *
   * @param model - The model identifier.
   * @param inputTokens - Number of input tokens.
   * @param outputTokens - Number of output tokens.
   * @param options - Optional overrides (provider, cost, session, call ids).
   * @returns The stored, normalized record.
   */
  add(
    model: string,
    inputTokens: number,
    outputTokens: number,
    options: {
      provider?: string;
      cost?: number;
      sessionId?: string;
      callId?: string;
      timestamp?: number;
      id?: string;
    } = {},
  ): TokenUsageRecord {
    const input = normalizeTokenCount(inputTokens);
    const output = normalizeTokenCount(outputTokens);
    const timestamp = typeof options.timestamp === 'number' ? options.timestamp : Date.now();
    const record: TokenUsageRecord = {
      id: options.id ?? createRecordId(),
      model,
      provider: options.provider ?? this.config.defaultProvider,
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      cost: typeof options.cost === 'number' ? normalizeCost(options.cost) : undefined,
      timestamp,
      sessionId: options.sessionId,
      callId: options.callId,
    };
    return this.record(record);
  }

  /**
   * Fetches a single record by its unique id.
   *
   * @param id - The record id.
   * @returns The record, or `undefined` when no such record exists.
   */
  get(id: string): TokenUsageRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Fetches every record for a given model.
   *
   * @param model - The model identifier to match.
   * @returns A new array of records for the model, sorted by timestamp
   * ascending. The caller may mutate the returned array freely; the store is
   * not affected.
   */
  getByModel(model: string): TokenUsageRecord[] {
    const matches: TokenUsageRecord[] = [];
    for (const record of this.records.values()) {
      if (record.model === model) {
        matches.push(record);
      }
    }
    matches.sort((a, b) => a.timestamp - b.timestamp);
    return matches;
  }

  /**
   * Removes a record from the store by id.
   *
   * @param id - The record id to remove.
   * @returns `true` when a record was removed, `false` when no such record
   * existed.
   */
  delete(id: string): boolean {
    const existing = this.records.get(id);
    if (!existing) {
      return false;
    }
    this.records.delete(id);
    this.accumulator.remove(existing, this.config.defaultProvider);
    return true;
  }

  /**
   * Reports whether a record with the given id exists.
   *
   * @param id - The record id to probe.
   * @returns `true` when the record is present.
   */
  has(id: string): boolean {
    return this.records.has(id);
  }

  /**
   * Iterates over every record id in the store.
   *
   * @returns An iterator of record ids.
   */
  keys(): IterableIterator<string> {
    return this.records.keys();
  }

  /**
   * Iterates over every record in the store.
   *
   * @returns An iterator of records.
   */
  values(): IterableIterator<TokenUsageRecord> {
    return this.records.values();
  }

  /**
   * Makes the store directly iterable as a source of records.
   *
   * This satisfies the {@link TokenUsageSource} contract so a store can be
   * passed straight into the query engine without an intermediate array.
   *
   * @returns An iterator of records.
   */
  [Symbol.iterator](): IterableIterator<TokenUsageRecord> {
    return this.records.values();
  }

  /**
   * Removes every record from the store and resets all statistics.
   */
  clear(): void {
    this.records.clear();
    this.accumulator.reset();
  }

  /**
   * Number of records currently held.
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Returns a live snapshot of the store's aggregate statistics.
   *
   * @returns A {@link TokenUsageStats} object. The object is fresh on each
   * call and safe to mutate.
   */
  stats(): TokenUsageStats {
    return this.accumulator.buildStats(this.records.size);
  }

  /**
   * Computes totals aggregated per model and per provider, plus the grand
   * total across the whole store.
   *
   * @returns An object containing `totalsByModel`, `totalsByProvider`, and
   * `grandTotal` maps keyed by dimension value.
   */
  getTotals(): {
    readonly totalsByModel: TotalsMap;
    readonly totalsByProvider: TotalsMap;
    readonly grandTotal: TokenTotals;
  } {
    const byModel = new Map<string, MutableTokenTotals>();
    const byProvider = new Map<string, MutableTokenTotals>();
    const grand = this.emptyTotals();

    for (const record of this.records.values()) {
      const modelKey = record.model;
      const providerKey = providerOf(record, this.config.defaultProvider);
      this.accumulateInto(byModel, modelKey, record);
      this.accumulateInto(byProvider, providerKey, record);
      this.accumulateIntoMap(grand, record);
    }
    return { totalsByModel: byModel, totalsByProvider: byProvider, grandTotal: grand };
  }

  /**
   * Returns a per-model totals map without the grand total.
   *
   * @returns Totals keyed by model name.
   */
  totalsByModel(): TotalsMap {
    return this.getTotals().totalsByModel;
  }

  /**
   * Returns a per-provider totals map without the grand total.
   *
   * @returns Totals keyed by provider label.
   */
  totalsByProvider(): TotalsMap {
    return this.getTotals().totalsByProvider;
  }

  /**
   * Serializes the store to a plain JSON-compatible snapshot.
   *
   * Records are emitted sorted by timestamp ascending so that replaying the
   * snapshot produces a store with stable enumeration order.
   *
   * @returns A {@link TokenUsageStoreSnapshot}.
   */
  toJSON(): TokenUsageStoreSnapshot {
    const records = Array.from(this.records.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    return {
      config: this.getConfig(),
      records,
      stats: this.stats(),
    };
  }

  /**
   * Rehydrates a store from a snapshot produced by {@link toJSON}.
   *
   * All records are re-registered through {@link record} so normalization,
   * deduplication, and statistics are rebuilt from the ground up, which keeps
   * the deserialized store internally consistent even when the snapshot was
   * hand-crafted or produced by an older schema.
   *
   * @param snapshot - The snapshot to load.
   * @param store - An optional store instance to populate. When omitted, a
   * fresh store is created using the snapshot's config.
   * @returns The populated store.
   * @throws {TypeError} When any record in the snapshot is invalid.
   */
  static fromJSON(snapshot: TokenUsageStoreSnapshot, store?: TokenUsageStore): TokenUsageStore {
    const target = store ?? new TokenUsageStore(snapshot.config);
    for (const record of snapshot.records) {
      target.record(record);
    }
    return target;
  }

  /**
   * Serializes the snapshot to a JSON string.
   *
   * @param space - Optional pretty-print indentation.
   * @returns The JSON string.
   */
  toJSONString(space?: number): string {
    return JSON.stringify(this.toJSON(), null, space);
  }

  /**
   * Rehydrates a store from a JSON string produced by {@link toJSONString}.
   *
   * @param json - The JSON payload.
   * @returns The populated store.
   */
  static fromJSONString(json: string): TokenUsageStore {
    const parsed = JSON.parse(json) as TokenUsageStoreSnapshot;
    return TokenUsageStore.fromJSON(parsed);
  }

  /**
   * Returns a fresh, zeroed totals accumulator for {@link getTotals}.
   *
   * @returns An empty mutable totals object.
   */
  private emptyTotals(): MutableTokenTotals {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0, callCount: 0 };
  }

  /**
   * Adds a single record's contribution to an accumulator object.
   *
   * @param target - The mutable totals accumulator.
   * @param record - The record whose contribution is folded in.
   */
  private accumulateIntoMap(target: MutableTokenTotals, record: TokenUsageRecord): void {
    target.inputTokens += record.inputTokens;
    target.outputTokens += record.outputTokens;
    target.totalTokens += record.totalTokens;
    target.totalCost += record.cost ?? 0;
    target.callCount += 1;
  }

  /**
   * Adds a single record's contribution to a dimension-keyed totals map,
   * creating the entry lazily when it does not yet exist.
   *
   * @param map - The dimension map to update.
   * @param key - The dimension key (model/provider).
   * @param record - The record whose contribution is folded in.
   */
  private accumulateInto(
    map: Map<string, MutableTokenTotals>,
    key: string,
    record: TokenUsageRecord,
  ): void {
    let totals = map.get(key);
    if (!totals) {
      totals = this.emptyTotals();
      map.set(key, totals);
    }
    this.accumulateIntoMap(totals, record);
  }

  /**
   * Evicts the `count` oldest records by timestamp, removing them from the
   * record map and the statistics accumulator.
   *
   * @param count - Number of records to evict.
   */
  private evictOldest(count: number): void {
    const ordered = Array.from(this.records.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    for (let i = 0; i < count && i < ordered.length; i += 1) {
      const record = ordered[i];
      if (record) {
        this.records.delete(record.id);
        this.accumulator.remove(record, this.config.defaultProvider);
      }
    }
  }
}

/**
 * Constructs a store pre-populated from a snapshot, mirroring the semantics of
 * {@link TokenUsageStore.fromJSON} with a friendlier signature for the
 * integration layer.
 *
 * @param snapshot - Optional snapshot to load.
 * @param config - Optional config overrides applied when no snapshot is given.
 * @returns A ready-to-use store.
 */
export function createTokenUsageStore(
  snapshot?: TokenUsageStoreSnapshot,
  config?: Partial<TokenUsageConfig>,
): TokenUsageStore {
  if (snapshot) {
    return TokenUsageStore.fromJSON(snapshot, new TokenUsageStore(snapshot.config));
  }
  return new TokenUsageStore(config);
}

/**
 * Type guard for {@link TokenUsageStoreSnapshot}.
 *
 * @param value - The value to inspect.
 * @returns `true` when the value looks like a store snapshot.
 */
export function isTokenUsageStoreSnapshot(value: unknown): value is TokenUsageStoreSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Partial<TokenUsageStoreSnapshot>;
  return (
    Array.isArray(snapshot.records) &&
    snapshot.records.every((record) => isTokenUsageRecord(record))
  );
}

/**
 * Re-exported so downstream consumers that only import the store still get a
 * reference to the provider label sentinel without importing `./types.js`.
 */
export { UNKNOWN_PROVIDER };