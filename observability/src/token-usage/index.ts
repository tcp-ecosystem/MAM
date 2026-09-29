/**
 * @fileoverview Secondary indexes over {@link TokenUsageRecord} data.
 *
 * The store's `get`/`getByModel` lookups are correct but linear in the number
 * of records for non-id dimensions. {@link TokenUsageIndex} maintains inverted
 * index maps so queries by model, provider, session, and calendar date resolve
 * in near-constant time regardless of store size.
 *
 * The index is designed to be fed by, but independent from, any concrete
 * store implementation: it exposes {@link indexRecord} and
 * {@link removeRecord} hooks, and a {@link rebuild} routine that re-syncs from
 * an arbitrary iterable of records. This keeps the index usable with custom
 * backends while remaining dependency-free.
 *
 * @packageDocumentation
 */

import {
  dateKeyOf,
  providerOf,
  sessionOf,
  DEFAULT_TOKEN_USAGE_CONFIG,
  type TokenUsageConfig,
  type TokenUsageRecord,
} from './types.js';

/**
 * A set of record ids that share a single indexed key. Stored as `Set` for
 * O(1) membership checks and de-duplication when the same record is indexed
 * multiple times.
 */
type IdSet = Set<string>;

/**
 * Statistics describing the current state of an index.
 */
export interface TokenUsageIndexStats {
  /**
   * Number of records currently indexed.
   */
  readonly recordCount: number;

  /**
   * Number of distinct model keys.
   */
  readonly modelKeys: number;

  /**
   * Number of distinct provider keys.
   */
  readonly providerKeys: number;

  /**
   * Number of distinct session keys (unbounded records are not counted).
   */
  readonly sessionKeys: number;

  /**
   * Number of distinct calendar-day date keys.
   */
  readonly dateKeys: number;

  /**
   * Total number of index entries across all maps (a record indexed in N
   * dimensions counts N times).
   */
  readonly entryCount: number;
}

/**
 * Maintains inverted indexes over token usage records for fast dimensional
 * lookups.
 *
 * The index tracks four dimensions:
 * - **model**: primary accounting dimension
 * - **provider**: aggregated with the configured default when records lack one
 * - **session**: only records bound to a session participate
 * - **date**: calendar-day bucket derived from each record's timestamp
 *
 * A record is always visible to the model and provider indexes once indexed;
 * session/date participation depends on the record's optional fields.
 *
 * @example
 * ```ts
 * const index = new TokenUsageIndex();
 * index.indexRecord(record);
 * index.findByModel('gpt-4o');            // Set of matching record ids
 * index.findByDateRange(t0, t1);          // Set across day buckets
 * ```
 */
export class TokenUsageIndex {
  /** Indexed records keyed by id. */
  private readonly records = new Map<string, TokenUsageRecord>();

  /** Inverted index: model name -> set of record ids. */
  private readonly byModel = new Map<string, IdSet>();

  /** Inverted index: provider label -> set of record ids. */
  private readonly byProvider = new Map<string, IdSet>();

  /** Inverted index: session id -> set of record ids. */
  private readonly bySession = new Map<string, IdSet>();

  /** Inverted index: `YYYY-MM-DD` date key -> set of record ids. */
  private readonly byDate = new Map<string, IdSet>();

  /** Effective configuration for provider fallback behaviour. */
  private readonly config: TokenUsageConfig;

  /**
   * Creates a new, empty index.
   *
   * @param config - Optional configuration overrides.
   */
  constructor(config?: Partial<TokenUsageConfig>) {
    this.config = { ...DEFAULT_TOKEN_USAGE_CONFIG, ...config };
  }

  /**
   * Adds a record to every index dimension it participates in.
   *
   * Re-indexing a record id that is already present is idempotent: the record
   * object is refreshed and the id is inserted into the same id sets, which
   * naturally de-duplicates.
   *
   * @param record - The record to index.
   * @returns `true` when the record was newly inserted, `false` when it
   * already existed and was merely refreshed.
   */
  indexRecord(record: TokenUsageRecord): boolean {
    const isNew = !this.records.has(record.id);
    this.records.set(record.id, record);
    this.addId(this.byModel, record.model, record.id);
    this.addId(this.byProvider, providerOf(record, this.config.defaultProvider), record.id);
    const session = sessionOf(record);
    if (session !== null) {
      this.addId(this.bySession, session, record.id);
    }
    this.addId(this.byDate, dateKeyOf(record.timestamp), record.id);
    return isNew;
  }

  /**
   * Removes a record from every index dimension.
   *
   * @param id - The id of the record to un-index.
   * @returns The removed record, or `undefined` when it was not indexed.
   */
  removeRecord(id: string): TokenUsageRecord | undefined {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }
    this.records.delete(id);
    this.removeId(this.byModel, record.model, id);
    this.removeId(this.byProvider, providerOf(record, this.config.defaultProvider), id);
    const session = sessionOf(record);
    if (session !== null) {
      this.removeId(this.bySession, session, id);
    }
    this.removeId(this.byDate, dateKeyOf(record.timestamp), id);
    return record;
  }

  /**
   * Returns the record objects for a set of ids, preserving an unspecified but
   * stable order.
   *
   * @param ids - The ids to resolve.
   * @returns A new array of records. Ids missing from the master map are
   * skipped silently.
   */
  resolve(ids: Iterable<string>): TokenUsageRecord[] {
    const resolved: TokenUsageRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) {
        resolved.push(record);
      }
    }
    return resolved;
  }

  /**
   * Finds the ids of every record for a given model.
   *
   * @param model - The model name to match.
   * @returns A new set of matching record ids. The set is empty when no
   * records match.
   */
  findByModel(model: string): Set<string> {
    return new Set(this.byModel.get(model));
  }

  /**
   * Finds the ids of every record for a given provider.
   *
   * @param provider - The provider label to match. Records without a provider
   * are indexed under the configured default.
   * @returns A new set of matching record ids.
   */
  findByProvider(provider: string): Set<string> {
    return new Set(this.byProvider.get(provider));
  }

  /**
   * Finds the ids of every record bound to a given session.
   *
   * @param sessionId - The session id to match.
   * @returns A new set of matching record ids. Records without a session are
   * never returned.
   */
  findBySession(sessionId: string): Set<string> {
    return new Set(this.bySession.get(sessionId));
  }

  /**
   * Finds the ids of every record whose timestamp falls within a date range.
   *
   * The range is inclusive on both ends and expressed in epoch milliseconds.
   * Day buckets are computed on the fly, so arbitrary ranges are supported
   * without scanning the full store.
   *
   * @param from - Inclusive lower bound (epoch ms).
   * @param to - Inclusive upper bound (epoch ms).
   * @returns A new set of matching record ids.
   */
  findByDateRange(from: number, to: number): Set<string> {
    const result = new Set<string>();
    if (to < from) {
      return result;
    }
    const startKey = dateKeyOf(from);
    const endKey = dateKeyOf(to);
    for (const [key, ids] of this.byDate) {
      if (key >= startKey && key <= endKey) {
        for (const id of ids) {
          const record = this.records.get(id);
          if (record && record.timestamp >= from && record.timestamp <= to) {
            result.add(id);
          }
        }
      }
    }
    return result;
  }

  /**
   * Finds the ids of every record on a single calendar day.
   *
   * @param timestamp - Any timestamp within the target day.
   * @returns A new set of matching record ids.
   */
  findByDay(timestamp: number): Set<string> {
    return new Set(this.byDate.get(dateKeyOf(timestamp)));
  }

  /**
   * Returns the record objects matching a model.
   *
   * @param model - The model name to match.
   * @returns A new array of records.
   */
  getByModel(model: string): TokenUsageRecord[] {
    return this.resolve(this.findByModel(model));
  }

  /**
   * Returns the record objects matching a provider.
   *
   * @param provider - The provider label to match.
   * @returns A new array of records.
   */
  getByProvider(provider: string): TokenUsageRecord[] {
    return this.resolve(this.findByProvider(provider));
  }

  /**
   * Returns the record objects bound to a session.
   *
   * @param sessionId - The session id to match.
   * @returns A new array of records.
   */
  getBySession(sessionId: string): TokenUsageRecord[] {
    return this.resolve(this.findBySession(sessionId));
  }

  /**
   * Returns the record objects within a date range.
   *
   * @param from - Inclusive lower bound (epoch ms).
   * @param to - Inclusive upper bound (epoch ms).
   * @returns A new array of records sorted by timestamp ascending.
   */
  getByDateRange(from: number, to: number): TokenUsageRecord[] {
    return this.resolve(this.findByDateRange(from, to)).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  /**
   * Rebuilds every index from scratch using an iterable of records.
   *
   * This is the reconciliation routine used when a store is swapped in or
   * rehydrated: it resets all four dimension maps and re-indexes each record,
   * so the index can never drift from its source of truth.
   *
   * @param records - The records to index.
   * @returns The number of records indexed.
   */
  rebuild(records: Iterable<TokenUsageRecord>): number {
    this.clear();
    let count = 0;
    for (const record of records) {
      this.indexRecord(record);
      count += 1;
    }
    return count;
  }

  /**
   * Removes every entry from the index.
   */
  clear(): void {
    this.records.clear();
    this.byModel.clear();
    this.byProvider.clear();
    this.bySession.clear();
    this.byDate.clear();
  }

  /**
   * Reports whether the index contains a record id.
   *
   * @param id - The record id to probe.
   * @returns `true` when the id is indexed.
   */
  has(id: string): boolean {
    return this.records.has(id);
  }

  /**
   * Number of records currently indexed.
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Returns statistics describing the current index state.
   *
   * @returns A {@link TokenUsageIndexStats} snapshot.
   */
  stats(): TokenUsageIndexStats {
    let entryCount = this.records.size;
    entryCount += this.sumSetSizes(this.byModel);
    entryCount += this.sumSetSizes(this.byProvider);
    entryCount += this.sumSetSizes(this.bySession);
    entryCount += this.sumSetSizes(this.byDate);
    return {
      recordCount: this.records.size,
      modelKeys: this.byModel.size,
      providerKeys: this.byProvider.size,
      sessionKeys: this.bySession.size,
      dateKeys: this.byDate.size,
      entryCount,
    };
  }

  /**
   * Returns every indexed record, sorted by timestamp ascending.
   *
   * @returns A new array of all records.
   */
  all(): TokenUsageRecord[] {
    return Array.from(this.records.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Returns the model dimension keys (all models observed).
   *
   * @returns An array of model names.
   */
  modelKeys(): string[] {
    return Array.from(this.byModel.keys());
  }

  /**
   * Returns the provider dimension keys (all providers observed).
   *
   * @returns An array of provider labels.
   */
  providerKeys(): string[] {
    return Array.from(this.byProvider.keys());
  }

  /**
   * Returns the session dimension keys (all sessions observed).
   *
   * @returns An array of session ids.
   */
  sessionKeys(): string[] {
    return Array.from(this.bySession.keys());
  }

  /**
   * Adds a record id to a dimension map, creating the id set lazily.
   *
   * @param map - The dimension map.
   * @param key - The dimension key.
   * @param id - The record id.
   */
  private addId(map: Map<string, IdSet>, key: string, id: string): void {
    let ids = map.get(key);
    if (!ids) {
      ids = new Set();
      map.set(key, ids);
    }
    ids.add(id);
  }

  /**
   * Removes a record id from a dimension map, dropping empty id sets so
   * `stats().*Keys` stays accurate.
   *
   * @param map - The dimension map.
   * @param key - The dimension key.
   * @param id - The record id.
   */
  private removeId(map: Map<string, IdSet>, key: string, id: string): void {
    const ids = map.get(key);
    if (!ids) {
      return;
    }
    ids.delete(id);
    if (ids.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Sums the sizes of every id set in a dimension map.
   *
   * @param map - The dimension map.
   * @returns The total number of entries across all id sets.
   */
  private sumSetSizes(map: Map<string, IdSet>): number {
    let sum = 0;
    for (const ids of map.values()) {
      sum += ids.size;
    }
    return sum;
  }
}

/**
 * Creates an index synchronised with a live store and an initial set of
 * records, used by the integration layer to attach a ready-made index to a
 * tracker.
 *
 * @param records - Optional initial records to index.
 * @param config - Optional configuration overrides.
 * @returns A fully populated index.
 */
export function createTokenUsageIndex(
  records?: Iterable<TokenUsageRecord>,
  config?: Partial<TokenUsageConfig>,
): TokenUsageIndex {
  const index = new TokenUsageIndex(config);
  if (records) {
    index.rebuild(records);
  }
  return index;
}