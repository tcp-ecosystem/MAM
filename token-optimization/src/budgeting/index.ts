/**
 * @file index.ts
 * @module budgeting/index
 *
 * {@link AllocationIndex}: a derived, query-oriented view over section
 * allocations.
 *
 * While {@link AllocationStore} is the authoritative ledger, the index is
 * the *read model*. It classifies every section into one of three statuses
 * (`under`, `near`, `over` relative to its ceiling) and maintains
 * bidirectional maps so callers can answer questions such as:
 *
 *  - "which sections are at risk of running out?" (`findNearLimit`);
 *  - "which sections have already blown their ceiling?" (`findOverLimit`);
 *  - "what does the current pressure look like?" (`stats`);
 *  - "how is the index distributed across statuses?" (`toJSON`).
 *
 * The index never mutates the underlying records; it is fed by
 * {@link indexAllocation} and kept in sync by whoever owns the store
 * (the {@link BudgetAllocator} in practice). Call {@link rebuild} to
 * bulk-resync from a list of records, e.g. after deserialization.
 *
 * @packageDocumentation
 */

import type { SectionAllocation } from './types.js';
import { isSectionAllocation } from './types.js';

/* ------------------------------------------------------------------------ *
 * Status vocabulary
 * ------------------------------------------------------------------------ */

/**
 * The three pressure classifications a section can carry.
 *
 * - `'under'`: comfortably below its ceiling.
 * - `'near'`:  within the "near" margin of its ceiling (see
 *              {@link AllocationIndexOptions}).
 * - `'over'`:  strictly above its ceiling.
 */
export const INDEX_STATUSES = ['under', 'near', 'over'] as const;

/**
 * The valid index statuses ({@link INDEX_STATUSES} as a type).
 */
export type IndexStatus = (typeof INDEX_STATUSES)[number];

/**
 * A section record together with its derived status.
 */
export interface IndexedEntry {
  /** The indexed allocation (a stable reference, not a copy). */
  allocation: SectionAllocation;
  /** Derived pressure status. */
  status: IndexStatus;
}

/**
 * Aggregate counts over the index's current distribution.
 */
export interface IndexStats {
  /** Total number of indexed sections. */
  total: number;
  /** Sections classified `'under'`. */
  under: number;
  /** Sections classified `'near'`. */
  near: number;
  /** Sections classified `'over'`. */
  over: number;
  /** Number of sections at or past their ceiling (`near` + `over`). */
  atRisk: number;
}

/**
 * Plain-JSON shape produced by {@link AllocationIndex.toJSON} and accepted
 * by {@link AllocationIndex.fromJSON}.
 */
export interface AllocationIndexJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** The indexed allocations, in insertion order. */
  allocations: SectionAllocation[];
}

/**
 * Constructor options for {@link AllocationIndex}.
 */
export interface AllocationIndexOptions {
  /**
   * Absolute token margin (inclusive) that classifies a section as `'near'`
   * once its remaining headroom drops to this value. Defaults to `50`.
   */
  nearThreshold?: number;
  /**
   * Relative margin (fraction of the section's own `limit`, 0..1) that also
   * classifies a section as `'near'`. Defaults to `0.1` (10%). The larger
   * of `nearThreshold` and `nearRatio * limit` wins per section.
   */
  nearRatio?: number;
}

/**
 * Query-oriented read model over section allocations.
 *
 * Maintains `section -> entry` plus a reverse index `status -> sections` so
 * status lookups are O(1). All lookups are read-only; mutation happens via
 * {@link indexAllocation}/{@link removeAllocation}/{@link rebuild}.
 */
export class AllocationIndex {
  /** Forward map: section -> indexed entry. */
  private readonly _entries: Map<string, IndexedEntry>;
  /** Reverse map: status -> set of section names. */
  private readonly _byStatus: Map<IndexStatus, Set<string>>;
  /** Absolute "near" margin in tokens. */
  private readonly _nearThreshold: number;
  /** Relative "near" margin as a fraction of the section limit. */
  private readonly _nearRatio: number;

  /**
   * Creates an empty index.
   *
   * @param options - tuning for the "near" classification; see
   *   {@link AllocationIndexOptions}.
   */
  constructor(options: AllocationIndexOptions = {}) {
    this._entries = new Map<string, IndexedEntry>();
    this._byStatus = new Map<IndexStatus, Set<string>>();
    for (const status of INDEX_STATUSES) {
      this._byStatus.set(status, new Set<string>());
    }
    this._nearThreshold = Math.max(0, Math.floor(options.nearThreshold ?? 50));
    const ratio = options.nearRatio ?? 0.1;
    this._nearRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.1;
  }

  /* -------------------------------------------------------------------- *
   * Classification
   * -------------------------------------------------------------------- */

  /**
   * Classifies an allocation into a status without touching the index.
   *
   * `'over'` when `used > limit`; otherwise `'near'` when remaining headroom
   * is within the larger of `nearThreshold` or `nearRatio * limit`;
   * otherwise `'under'`.
   */
  statusFor(allocation: SectionAllocation): IndexStatus {
    if (allocation.used > allocation.limit) return 'over';
    const remaining = allocation.limit - allocation.used - (allocation.reserved ?? 0);
    if (remaining <= 0) return 'near';
    const margin = Math.max(this._nearThreshold, allocation.limit * this._nearRatio);
    return remaining <= margin ? 'near' : 'under';
  }

  /**
   * Returns the status a *prospective* allocation would carry, without
   * indexing anything. `used` defaults to the request size.
   */
  projectStatus(section: string, limit: number, used: number): IndexStatus {
    return this.statusFor({ section, limit, used });
  }

  /* -------------------------------------------------------------------- *
   * Mutation
   * -------------------------------------------------------------------- */

  /**
   * Inserts or replaces the indexed entry for an allocation.
   *
   * The reverse status map is kept in sync: the section leaves any previous
   * status bucket and joins the one matching its current pressure.
   *
   * @returns the status the allocation was classified as.
   */
  indexAllocation(allocation: SectionAllocation): IndexStatus {
    if (!isSectionAllocation(allocation)) {
      throw new TypeError(`Invalid SectionAllocation: ${JSON.stringify(allocation)}`);
    }
    const status = this.statusFor(allocation);
    const previous = this._entries.get(allocation.section);
    if (previous) {
      this._byStatus.get(previous.status)?.delete(allocation.section);
    }
    this._entries.set(allocation.section, { allocation, status });
    this._byStatus.get(status)?.add(allocation.section);
    return status;
  }

  /**
   * Removes a section from the index entirely.
   *
   * @returns the removed entry, or `undefined` when the section was not
   *   indexed.
   */
  removeAllocation(section: string): IndexedEntry | undefined {
    const entry = this._entries.get(section);
    if (!entry) return undefined;
    this._entries.delete(section);
    this._byStatus.get(entry.status)?.delete(section);
    return entry;
  }

  /**
   * Clears the index completely.
   */
  clear(): void {
    this._entries.clear();
    for (const sections of this._byStatus.values()) sections.clear();
  }

  /**
   * Replaces the entire index with freshly classified entries derived from
   * `allocations`. Invalid records are skipped.
   *
   * @returns the number of records actually indexed.
   */
  rebuild(allocations: Iterable<SectionAllocation>): number {
    this.clear();
    let indexed = 0;
    for (const allocation of allocations) {
      if (!isSectionAllocation(allocation)) continue;
      this.indexAllocation(allocation);
      indexed += 1;
    }
    return indexed;
  }

  /**
   * Reindexes a single section whose *underlying record* changed in place.
   * Use this after mutating a record that was handed out by
   * {@link findBySection}.
   */
  refresh(section: string): IndexStatus | undefined {
    const entry = this._entries.get(section);
    if (!entry) return undefined;
    return this.indexAllocation(entry.allocation);
  }

  /* -------------------------------------------------------------------- *
   * Read access
   * -------------------------------------------------------------------- */

  /**
   * Returns the indexed entry for `section`, or `undefined`.
   */
  findBySection(section: string): IndexedEntry | undefined {
    return this._entries.get(section);
  }

  /**
   * Returns the current status for an indexed section, or `undefined`.
   */
  statusOf(section: string): IndexStatus | undefined {
    return this._entries.get(section)?.status;
  }

  /**
   * Returns `true` when `section` is currently indexed.
   */
  has(section: string): boolean {
    return this._entries.has(section);
  }

  /**
   * Number of indexed sections.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * All indexed section names, in insertion order.
   */
  keys(): string[] {
    return Array.from(this._entries.keys());
  }

  /**
   * All indexed entries (stable references to the underlying allocations).
   */
  entries(): IndexedEntry[] {
    return Array.from(this._entries.values());
  }

  /**
   * All indexed allocations (stable references, not copies).
   */
  allocations(): SectionAllocation[] {
    return Array.from(this._entries.values(), (entry) => entry.allocation);
  }

  /**
   * Returns every allocation classified under `status` (or all of them when
   * `status` is omitted).
   */
  find(status?: IndexStatus): SectionAllocation[] {
    if (status === undefined) return this.allocations();
    const sections = this._byStatus.get(status);
    if (!sections) return [];
    return Array.from(sections, (section) => this._entries.get(section)!.allocation);
  }

  /**
   * Returns every allocation that has blown its ceiling.
   */
  findOverLimit(): SectionAllocation[] {
    return this.find('over');
  }

  /**
   * Returns every allocation within the "near" margin of its ceiling.
   */
  findNearLimit(): SectionAllocation[] {
    return this.find('near');
  }

  /**
   * Returns every allocation comfortably below its ceiling.
   */
  findUnderLimit(): SectionAllocation[] {
    return this.find('under');
  }

  /**
   * Returns the section names classified under `status`.
   */
  sectionNames(status: IndexStatus): string[] {
    return Array.from(this._byStatus.get(status) ?? []);
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Computes distribution statistics over the current index.
   */
  stats(): IndexStats {
    const under = this._byStatus.get('under')?.size ?? 0;
    const near = this._byStatus.get('near')?.size ?? 0;
    const over = this._byStatus.get('over')?.size ?? 0;
    return {
      total: this._entries.size,
      under,
      near,
      over,
      atRisk: near + over,
    };
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the index to a plain, JSON-friendly object.
   */
  toJSON(): AllocationIndexJSON {
    return {
      version: 1,
      allocations: Array.from(this._entries.values(), (entry) => ({ ...entry.allocation })),
    };
  }

  /**
   * Clears and reloads the index from `data`. Invalid records are skipped.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this.clear();
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    const list = parsed['allocations'];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (isSectionAllocation(entry)) this.indexAllocation(entry);
      }
    }
    return this;
  }

  /**
   * Rehydrates a new index from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): AllocationIndex {
    const index = new AllocationIndex();
    index.fromJSON(data);
    return index;
  }

  /**
   * Builds an index directly from an iterable of allocations.
   */
  static build(
    allocations: Iterable<SectionAllocation>,
    options: AllocationIndexOptions = {},
  ): AllocationIndex {
    const index = new AllocationIndex(options);
    index.rebuild(allocations);
    return index;
  }
}

/**
 * Convenience classifier: returns `'over'`/`'near'`/`'under'` for a raw
 * (limit, used, reserved?) triple without needing an index instance.
 */
export function classify(
  limit: number,
  used: number,
  reserved: number | undefined,
  options: AllocationIndexOptions = {},
): IndexStatus {
  if (!Number.isFinite(limit) || !Number.isFinite(used)) {
    throw new TypeError('classify requires finite numeric inputs');
  }
  return new AllocationIndex(options).statusFor({
    section: 'probe',
    limit: Math.max(0, Math.floor(limit)),
    used: Math.max(0, Math.floor(used)),
    reserved: reserved !== undefined ? Math.max(0, Math.floor(reserved)) : undefined,
  });
}