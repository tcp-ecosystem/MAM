/**
 * index.ts
 *
 * {@link CostIndex} — a multi-key secondary index over {@link CostRecord}
 * objects.
 *
 * Where the store answers "give me record by id", the index answers
 * "give me all records for model X / provider Y / session Z / date range D".
 * It maintains four parallel inverted indexes:
 *
 *  - by model    (Map<string, Set<id>>)
 *  - by provider (Map<string, Set<id>>)
 *  - by session  (Map<string, Set<id>>)
 *  - by date     (Map<'YYYY-MM-DD', Set<id>>) plus a sorted date-key list
 *
 * Because every index points at the same source-of-truth id space, entries
 * stay consistent: `indexRecord` / `removeRecord` update all four in one step
 * and `rebuild()` restores every index from the id space in a single pass.
 *
 * The date index is the interesting one: dates are bucketed to UTC calendar
 * days so `findByDateRange(from, to)` can binary-search the sorted key list
 * and touch only the relevant buckets instead of scanning every record.
 *
 * @packageDocumentation
 */

import { type CostOptions, type CostRecord, CostError, dateKey, isCostRecord } from './types.js';

/**
 * Statistical view of an index, exposed by {@link CostIndex.stats}. Useful for
 * dashboards and for validating that the index is healthy (e.g. bucket counts
 * sum to the record count).
 */
export interface CostIndexStats {
  /**
   * Total number of indexed records.
   */
  records: number;
  /**
   * Number of distinct models in the model index.
   */
  models: number;
  /**
   * Number of distinct providers in the provider index.
   */
  providers: number;
  /**
   * Number of distinct sessions in the session index.
   */
  sessions: number;
  /**
   * Number of distinct date buckets in the date index.
   */
  dateBuckets: number;
  /**
   * Total number of (model, id) index entries.
   */
  modelEntries: number;
  /**
   * Total number of (provider, id) index entries.
   */
  providerEntries: number;
  /**
   * Total number of (session, id) index entries.
   */
  sessionEntries: number;
  /**
   * Total number of (date, id) index entries.
   */
  dateEntries: number;
  /**
   * Earliest indexed timestamp, or `null` when empty.
   */
  oldestTimestamp: number | null;
  /**
   * Latest indexed timestamp, or `null` when empty.
   */
  newestTimestamp: number | null;
}

/**
 * CostIndex
 *
 * Secondary multi-key index over a set of {@link CostRecord} objects. The
 * index is free-standing: it can be fed from any source (a `CostStore`, a
 * plain array, or live records) and does not hold the records themselves —
 * it holds ids and resolves them lazily on read.
 */
export class CostIndex {
  /** Source of truth: record id → record. */
  private readonly records: Map<string, CostRecord> = new Map();

  /** model → set of record ids. */
  private readonly modelIndex: Map<string, Set<string>> = new Map();

  /** provider → set of record ids. */
  private readonly providerIndex: Map<string, Set<string>> = new Map();

  /** sessionId → set of record ids. */
  private readonly sessionIndex: Map<string, Set<string>> = new Map();

  /** 'YYYY-MM-DD' → set of record ids. */
  private readonly dateIndex: Map<string, Set<string>> = new Map();

  /** Sorted list of date keys present in the date index. */
  private readonly dateOrder: string[] = [];

  /** Earliest indexed timestamp. */
  private oldestTimestamp: number | null = null;

  /** Latest indexed timestamp. */
  private newestTimestamp: number | null = null;

  /**
   * @param seed - Optional initial records to index immediately.
   * @param _options - Reserved for future tuning (retained for API stability).
   */
  constructor(seed?: Iterable<CostRecord>, _options?: CostOptions) {
    if (seed !== undefined) this.addBatch(seed);
    void _options;
  }

  /**
   * Number of indexed records.
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Inserts an id into an inverted index bucket, creating the bucket when
   * needed.
   *
   * @param index - The inverted index to mutate.
   * @param key - Bucket key (model/provider/session/date).
   * @param id - Record id to add.
   */
  private addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    let bucket = index.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      index.set(key, bucket);
    }
    bucket.add(id);
  }

  /**
   * Removes an id from an inverted index bucket, pruning empty buckets.
   *
   * @param index - The inverted index to mutate.
   * @param key - Bucket key.
   * @param id - Record id to remove.
   */
  private removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    const bucket = index.get(key);
    if (bucket === undefined) return;
    bucket.delete(id);
    if (bucket.size === 0) index.delete(key);
  }

  /**
   * Rebuilds the sorted date-key list from scratch. Called after mutations
   * that affect the date index.
   */
  private rebuildDateOrder(): void {
    this.dateOrder.length = 0;
    this.dateOrder.push(...[...this.dateIndex.keys()].sort());
  }

  /**
   * Updates the running oldest/newest timestamps. When the removed record was
   * itself the extremum, the extremum is recomputed by scanning the id space.
   *
   * @param record - Record that was removed.
   */
  private refreshExtrema(record: CostRecord): void {
    if (this.records.size === 0) {
      this.oldestTimestamp = null;
      this.newestTimestamp = null;
      return;
    }
    let needsOldest = this.oldestTimestamp === record.timestamp;
    let needsNewest = this.newestTimestamp === record.timestamp;
    if (!needsOldest && !needsNewest) return;
    if (needsOldest) this.oldestTimestamp = null;
    if (needsNewest) this.newestTimestamp = null;
    for (const r of this.records.values()) {
      if (needsOldest && (this.oldestTimestamp === null || r.timestamp < this.oldestTimestamp)) {
        this.oldestTimestamp = r.timestamp;
      }
      if (needsNewest && (this.newestTimestamp === null || r.timestamp > this.newestTimestamp)) {
        this.newestTimestamp = r.timestamp;
      }
    }
  }

  /**
   * Indexes a single record across all four dimensions. No-op for records
   * already present under the same id.
   *
   * @param record - Record to index.
   * @returns `true` when the record was newly indexed.
   */
  indexRecord(record: CostRecord): boolean {
    if (!isCostRecord(record)) {
      throw new CostError('ERR_INVALID_RECORD', 'cannot index a structurally invalid record');
    }
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, record);
    this.addToIndex(this.modelIndex, record.model, record.id);
    this.addToIndex(this.providerIndex, record.provider ?? 'unknown', record.id);
    if (record.sessionId !== undefined) {
      this.addToIndex(this.sessionIndex, record.sessionId, record.id);
    }
    const day = dateKey(record.timestamp);
    this.addToIndex(this.dateIndex, day, record.id);
    if (!this.dateOrder.includes(day)) {
      this.dateOrder.push(day);
      this.dateOrder.sort();
    }
    if (this.oldestTimestamp === null || record.timestamp < this.oldestTimestamp) this.oldestTimestamp = record.timestamp;
    if (this.newestTimestamp === null || record.timestamp > this.newestTimestamp) this.newestTimestamp = record.timestamp;
    return true;
  }

  /**
   * Indexes many records in one pass.
   *
   * @param records - Records to index.
   * @returns Number of records newly indexed.
   */
  addBatch(records: Iterable<CostRecord>): number {
    let added = 0;
    for (const record of records) {
      if (this.indexRecord(record)) added += 1;
    }
    return added;
  }

  /**
   * Removes a record from the index by id (or by record object, using its id).
   *
   * @param idOrRecord - Id string or record to remove.
   * @returns `true` when a record was removed.
   */
  removeRecord(idOrRecord: string | CostRecord): boolean {
    const id = typeof idOrRecord === 'string' ? idOrRecord : idOrRecord.id;
    const record = this.records.get(id);
    if (record === undefined) return false;
    this.records.delete(id);
    this.removeFromIndex(this.modelIndex, record.model, id);
    this.removeFromIndex(this.providerIndex, record.provider ?? 'unknown', id);
    if (record.sessionId !== undefined) {
      this.removeFromIndex(this.sessionIndex, record.sessionId, id);
    }
    const day = dateKey(record.timestamp);
    this.removeFromIndex(this.dateIndex, day, id);
    if (!this.dateIndex.has(day)) {
      const pos = this.dateOrder.indexOf(day);
      if (pos >= 0) this.dateOrder.splice(pos, 1);
    }
    this.refreshExtrema(record);
    return true;
  }

  /**
   * Rebuilds every secondary index from the id space in a single pass. Use
   * after bulk mutations to guarantee consistency.
   */
  rebuild(): void {
    this.modelIndex.clear();
    this.providerIndex.clear();
    this.sessionIndex.clear();
    this.dateIndex.clear();
    this.dateOrder.length = 0;
    this.oldestTimestamp = null;
    this.newestTimestamp = null;
    for (const record of this.records.values()) {
      this.addToIndex(this.modelIndex, record.model, record.id);
      this.addToIndex(this.providerIndex, record.provider ?? 'unknown', record.id);
      if (record.sessionId !== undefined) {
        this.addToIndex(this.sessionIndex, record.sessionId, record.id);
      }
      const day = dateKey(record.timestamp);
      this.addToIndex(this.dateIndex, day, record.id);
      if (this.oldestTimestamp === null || record.timestamp < this.oldestTimestamp) this.oldestTimestamp = record.timestamp;
      if (this.newestTimestamp === null || record.timestamp > this.newestTimestamp) this.newestTimestamp = record.timestamp;
    }
    this.rebuildDateOrder();
  }

  /**
   * Empties the index entirely.
   */
  clear(): void {
    this.records.clear();
    this.modelIndex.clear();
    this.providerIndex.clear();
    this.sessionIndex.clear();
    this.dateIndex.clear();
    this.dateOrder.length = 0;
    this.oldestTimestamp = null;
    this.newestTimestamp = null;
  }

  /**
   * Resolves a bucket of ids back into records, sorted by (timestamp, id).
   *
   * @param ids - Ids to resolve.
   * @returns Sorted matching records.
   */
  private resolve(ids: Iterable<string>): CostRecord[] {
    const out: CostRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record !== undefined) out.push(record);
    }
    out.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    return out;
  }

  /**
   * All records for a given model.
   *
   * @param model - Model name.
   * @returns Sorted records.
   */
  findByModel(model: string): CostRecord[] {
    return this.resolve(this.modelIndex.get(model) ?? []);
  }

  /**
   * All records for a given provider.
   *
   * @param provider - Provider name.
   * @returns Sorted records.
   */
  findByProvider(provider: string): CostRecord[] {
    return this.resolve(this.providerIndex.get(provider) ?? []);
  }

  /**
   * All records belonging to a given session.
   *
   * @param sessionId - Session id.
   * @returns Sorted records.
   */
  findBySession(sessionId: string): CostRecord[] {
    return this.resolve(this.sessionIndex.get(sessionId) ?? []);
  }

  /**
   * All records falling inside `[from, to]` (inclusive), sorted ascending.
   *
   * The query touches only the date buckets whose keys intersect the range:
   * a binary search locates the first and last intersecting bucket and every
   * record in those buckets is kept only when its timestamp actually falls in
   * range (a single bucket can straddle the boundaries).
   *
   * @param from - Inclusive lower bound, epoch ms.
   * @param to - Inclusive upper bound, epoch ms.
   * @returns Sorted records inside the range.
   */
  findByDateRange(from: number, to: number): CostRecord[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
    const fromKey = dateKey(from);
    const toKey = dateKey(to);
    let start = this.lowerBound(fromKey);
    let end = this.upperBound(toKey);
    const ids = new Set<string>();
    for (let i = start; i < end; i += 1) {
      for (const id of this.dateIndex.get(this.dateOrder[i]) ?? []) {
        ids.add(id);
      }
    }
    const inRange: CostRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record !== undefined && record.timestamp >= from && record.timestamp <= to) {
        inRange.push(record);
      }
    }
    inRange.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    return inRange;
  }

  /**
   * All records whose timestamp falls on a specific UTC calendar day.
   *
   * @param day - `'YYYY-MM-DD'` key (see {@link dateKey}).
   * @returns Sorted records for that day.
   */
  findByDateKey(day: string): CostRecord[] {
    return this.resolve(this.dateIndex.get(day) ?? []);
  }

  /**
   * First index in {@link CostIndex.dateOrder} whose key is `>=` the target.
   *
   * @param key - Date key to search for.
   * @returns Insertion index.
   */
  private lowerBound(key: string): number {
    let lo = 0;
    let hi = this.dateOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.dateOrder[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * First index in {@link CostIndex.dateOrder} whose key is `>` the target.
   *
   * @param key - Date key to search for.
   * @returns Insertion index.
   */
  private upperBound(key: string): number {
    let lo = 0;
    let hi = this.dateOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.dateOrder[mid] <= key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * All distinct model names present in the index.
   *
   * @returns Sorted model names.
   */
  models(): string[] {
    return [...this.modelIndex.keys()].sort();
  }

  /**
   * All distinct provider names present in the index.
   *
   * @returns Sorted provider names.
   */
  providers(): string[] {
    return [...this.providerIndex.keys()].sort();
  }

  /**
   * All distinct session ids present in the index.
   *
   * @returns Sorted session ids.
   */
  sessions(): string[] {
    return [...this.sessionIndex.keys()].sort();
  }

  /**
   * All distinct date keys present in the index, sorted.
   *
   * @returns Sorted `'YYYY-MM-DD'` keys.
   */
  dates(): string[] {
    return [...this.dateOrder];
  }

  /**
   * Whether an id is indexed.
   *
   * @param id - Record id.
   * @returns True when present.
   */
  has(id: string): boolean {
    return this.records.has(id);
  }

  /**
   * Fetches an indexed record by id.
   *
   * @param id - Record id.
   * @returns The record, or `undefined`.
   */
  get(id: string): CostRecord | undefined {
    return this.records.get(id);
  }

  /**
   * All indexed records, sorted by (timestamp, id).
   *
   * @returns Sorted records.
   */
  values(): CostRecord[] {
    return this.resolve(this.records.keys());
  }

  /**
   * Statistical view of the index (see {@link CostIndexStats}).
   *
   * @returns Current index statistics.
   */
  stats(): CostIndexStats {
    let modelEntries = 0;
    let providerEntries = 0;
    let sessionEntries = 0;
    let dateEntries = 0;
    for (const bucket of this.modelIndex.values()) modelEntries += bucket.size;
    for (const bucket of this.providerIndex.values()) providerEntries += bucket.size;
    for (const bucket of this.sessionIndex.values()) sessionEntries += bucket.size;
    for (const bucket of this.dateIndex.values()) dateEntries += bucket.size;
    return {
      records: this.records.size,
      models: this.modelIndex.size,
      providers: this.providerIndex.size,
      sessions: this.sessionIndex.size,
      dateBuckets: this.dateIndex.size,
      modelEntries,
      providerEntries,
      sessionEntries,
      dateEntries,
      oldestTimestamp: this.oldestTimestamp,
      newestTimestamp: this.newestTimestamp,
    };
  }

  /**
   * Serializes the index to a plain record array (JSON-safe).
   *
   * @returns All indexed records.
   */
  toJSON(): CostRecord[] {
    return this.values();
  }

  /**
   * Makes the index directly iterable (`for (const r of index) ...`), yielding
   * indexed records in insertion order.
   *
   * @returns An iterator over indexed records.
   */
  *[Symbol.iterator](): Iterator<CostRecord> {
    yield* this.records.values();
  }

  /**
   * Replaces the index contents with an array of records.
   *
   * @param records - Records to index.
   * @returns This index, for chaining.
   */
  fromJSON(records: readonly CostRecord[]): this {
    this.clear();
    this.addBatch(records);
    return this;
  }
}