/**
 * @file store.ts
 * @module budgeting/store
 *
 * {@link AllocationStore}: the mutable, single-source-of-truth ledger for
 * per-section token budgets.
 *
 * The store is deliberately policy-free. It knows how to track a set of
 * {@link SectionAllocation} records — how much each section is allowed, how
 * much it has consumed and what it reserves — but it does *not* decide what
 * to do when a request exceeds a ceiling. That decision lives in the
 * {@link BudgetAllocator} (see `retrieval.ts`), which reads policy from the
 * {@link BudgetConfig}.
 *
 * Responsibilities in this class:
 *  - create / read / update / delete section records;
 *  - clamp `allocate` and `release` mutations to sane bounds;
 *  - produce derived numbers (`used`, `remaining`, ratios);
 *  - compute aggregate {@link BudgetStats} and {@link BudgetSnapshot};
 *  - serialize to and from plain JSON with runtime validation.
 *
 * All mutations are synchronous and in-memory; no I/O happens here.
 *
 * @packageDocumentation
 */

import type {
  AllocationResult,
  BudgetSnapshot,
  BudgetStats,
  SectionAllocation,
} from './types.js';

import {
  createSectionAllocation,
  isSectionAllocation,
  isSectionName,
  sumLimits,
  sumReserved,
  sumUsed,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------------ */

/**
 * Coerces `tokens` to a non-negative integer. Fractional and negative
 * inputs are floored/clamped rather than thrown so callers can feed
 * estimates without defensive ceremony.
 */
function toTokenCount(tokens: number): number {
  if (!Number.isFinite(tokens)) return 0;
  return Math.max(0, Math.floor(tokens));
}

/**
 * Plain-JSON shape produced by {@link AllocationStore.toJSON} and accepted
 * by {@link AllocationStore.fromJSON}.
 */
export interface AllocationStoreJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** Default ceiling applied to sections created without an explicit limit. */
  defaultLimit: number;
  /** The tracked section allocations, in insertion order. */
  allocations: SectionAllocation[];
}

/**
 * Options accepted by {@link AllocationStore.allocate}.
 */
export interface AllocateStoreOptions {
  /**
   * When `true` (default), the granted amount is capped at the section's
   * `limit`. Set to `false` to record raw consumption even above the
   * ceiling — this is how the `'allow'` overrun policy books usage.
   */
  clamp?: boolean;
}

/**
 * Mutable ledger of per-section token allocations.
 *
 * The store owns the authoritative {@link SectionAllocation} records. It is
 * safe to share one store between the {@link AllocationIndex} and the
 * {@link BudgetAllocator}; both read from this single source of truth.
 */
export class AllocationStore {
  /** Backing map, keyed by section name. */
  private readonly _allocations: Map<string, SectionAllocation>;
  /** Default ceiling for sections created on first `allocate`. */
  private _defaultLimit: number;

  /**
   * Creates an empty store.
   *
   * @param defaultLimit - ceiling applied when `allocate` is asked to touch
   *   a section that does not exist yet. Defaults to `0` (sections start
   *   with no allowance until a ceiling is set or provided).
   */
  constructor(defaultLimit = 0) {
    this._allocations = new Map<string, SectionAllocation>();
    this._defaultLimit = Math.max(0, Math.floor(defaultLimit));
  }

  /* -------------------------------------------------------------------- *
   * Raw record access
   * -------------------------------------------------------------------- */

  /**
   * Replaces the record for `section` wholesale. Use for bulk loads or
   * explicit restores; prefer {@link allocate}/{@link release} for
   * incremental bookkeeping.
   */
  set(allocation: SectionAllocation): this {
    if (!isSectionAllocation(allocation)) {
      throw new TypeError(`Invalid SectionAllocation: ${JSON.stringify(allocation)}`);
    }
    this._allocations.set(allocation.section, { ...allocation });
    return this;
  }

  /**
   * Returns the live record for `section`, or `undefined` when absent.
   *
   * The returned object is the store's internal record — mutate with care.
   * Prefer the derived accessors (`used`, `remaining`, ...) in hot paths.
   */
  get(section: string): SectionAllocation | undefined {
    return this._allocations.get(section);
  }

  /**
   * Returns `true` when a record exists for `section`.
   */
  has(section: string): boolean {
    return this._allocations.has(section);
  }

  /**
   * Removes the record for `section`. Returns `true` when a record existed
   * and was removed.
   */
  delete(section: string): boolean {
    return this._allocations.delete(section);
  }

  /**
   * Returns a snapshot `Array` of every tracked section name.
   */
  keys(): string[] {
    return Array.from(this._allocations.keys());
  }

  /**
   * Returns a snapshot `Array` of every tracked record (shallow copies).
   */
  values(): SectionAllocation[] {
    return Array.from(this._allocations.values()).map((a) => ({ ...a }));
  }

  /**
   * Returns a snapshot `Array` of `[section, record]` pairs.
   */
  entries(): Array<[string, SectionAllocation]> {
    return Array.from(this._allocations.entries()).map(([key, value]) => [
      key,
      { ...value },
    ]);
  }

  /**
   * Invokes `callback` for every tracked record. Mutating the record inside
   * the callback is allowed and is reflected immediately.
   */
  forEach(callback: (allocation: SectionAllocation, section: string) => void): void {
    for (const [section, allocation] of this._allocations) {
      callback(allocation, section);
    }
  }

  /**
   * Number of tracked sections.
   */
  get size(): number {
    return this._allocations.size;
  }

  /**
   * Removes every record. Returns the number of records that were dropped.
   */
  clear(): number {
    const cleared = this._allocations.size;
    this._allocations.clear();
    return cleared;
  }

  /* -------------------------------------------------------------------- *
   * Mutation
   * -------------------------------------------------------------------- */

  /**
   * Consumes up to `tokens` from `section`'s allowance.
   *
   * When the section has no record yet, one is created with the store's
   * `defaultLimit`. Unless `opts.clamp` is `false`, the granted amount is
   * capped at the section's remaining headroom.
   *
   * @returns the number of tokens actually granted (always `<= tokens`).
   */
  allocate(section: string, tokens: number, opts: AllocateStoreOptions = {}): number {
    if (!isSectionName(section)) {
      throw new TypeError(`Invalid section name: ${String(section)}`);
    }
    const amount = toTokenCount(tokens);
    if (amount === 0) return 0;

    let allocation = this._allocations.get(section);
    if (!allocation) {
      allocation = createSectionAllocation(section, this._defaultLimit);
      this._allocations.set(section, allocation);
    }

    const clamp = opts.clamp !== false;
    const room = clamp ? Math.max(0, allocation.limit - allocation.used) : amount;
    const granted = Math.min(amount, room);
    allocation.used += granted;
    return granted;
  }

  /**
   * Frees up to `tokens` back to `section`'s allowance.
   *
   * `used` is never driven below zero. Releasing more than is consumed
   * returns the excess as `0` (i.e. the returned value is what actually
   * changed).
   *
   * @returns the number of tokens actually released.
   */
  release(section: string, tokens: number): number {
    const allocation = this._allocations.get(section);
    if (!allocation) return 0;
    const amount = toTokenCount(tokens);
    if (amount === 0) return 0;
    const released = Math.min(amount, allocation.used);
    allocation.used -= released;
    return released;
  }

  /**
   * Records `amount` tokens of reserved headroom for `section`.
   *
   * Reserved tokens are excluded from "remaining" so they act as a
   * guaranteed floor for the section. Setting a reserve that, together with
   * `used`, exceeds `limit` is permitted but leaves the section over-budget
   * on paper.
   */
  reserve(section: string, amount: number): SectionAllocation | undefined {
    const allocation = this._allocations.get(section);
    if (!allocation) return undefined;
    allocation.reserved = toTokenCount(amount);
    return allocation;
  }

  /**
   * Clears the reserved headroom for `section`.
   */
  clearReserve(section: string): SectionAllocation | undefined {
    const allocation = this._allocations.get(section);
    if (!allocation) return undefined;
    delete allocation.reserved;
    return allocation;
  }

  /* -------------------------------------------------------------------- *
   * Derived per-section numbers
   * -------------------------------------------------------------------- */

  /**
   * Tokens currently consumed by `section` (`0` when untracked).
   */
  used(section: string): number {
    return this._allocations.get(section)?.used ?? 0;
  }

  /**
   * Effective ceiling for `section`.
   *
   * Returns the record's `limit` when tracked; otherwise the store's
   * `defaultLimit`; otherwise `0`.
   */
  limit(section: string): number {
    const allocation = this._allocations.get(section);
    if (allocation) return allocation.limit;
    return this._defaultLimit;
  }

  /**
   * Reserved headroom for `section` (`0` when none or untracked).
   */
  reserved(section: string): number {
    return this._allocations.get(section)?.reserved ?? 0;
  }

  /**
   * Headroom left for `section`: `limit - used - reserved`.
   *
   * Returns `Infinity` for untracked sections when the store has no
   * default ceiling (they are unbounded until first touched).
   */
  remaining(section: string): number {
    const allocation = this._allocations.get(section);
    if (!allocation) {
      return this._defaultLimit > 0 ? this._defaultLimit : Infinity;
    }
    return Math.max(0, allocation.limit - allocation.used - (allocation.reserved ?? 0));
  }

  /**
   * Fraction of `section`'s ceiling consumed (>= 0; may exceed `1`).
   * Returns `0` for untracked sections.
   */
  usedRatio(section: string): number {
    const allocation = this._allocations.get(section);
    if (!allocation || allocation.limit === 0) return 0;
    return allocation.used / allocation.limit;
  }

  /**
   * `true` when `section` is currently above its ceiling.
   */
  isOverLimit(section: string): boolean {
    const allocation = this._allocations.get(section);
    return allocation ? allocation.used > allocation.limit : false;
  }

  /* -------------------------------------------------------------------- *
   * Queries
   * -------------------------------------------------------------------- */

  /**
   * Returns every section currently above its ceiling.
   */
  findOverLimit(): SectionAllocation[] {
    const matches: SectionAllocation[] = [];
    for (const allocation of this._allocations.values()) {
      if (allocation.used > allocation.limit) matches.push({ ...allocation });
    }
    return matches;
  }

  /**
   * Returns every section whose remaining headroom is at most `threshold`
   * tokens (inclusive). Defaults to one tenth of the section's own limit.
   */
  findNearLimit(thresholdRatio = 0.1): SectionAllocation[] {
    const matches: SectionAllocation[] = [];
    for (const allocation of this._allocations.values()) {
      const threshold = Math.max(1, Math.floor(allocation.limit * thresholdRatio));
      const remaining = allocation.limit - allocation.used - (allocation.reserved ?? 0);
      if (remaining <= threshold) matches.push({ ...allocation });
    }
    return matches;
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Sum of every section's consumption.
   */
  totalUsed(): number {
    return sumUsed(this._allocations.values());
  }

  /**
   * Sum of every section's ceiling.
   */
  totalLimit(): number {
    return sumLimits(this._allocations.values());
  }

  /**
   * Sum of every section's reserved headroom.
   */
  totalReserved(): number {
    return sumReserved(this._allocations.values());
  }

  /**
   * Combined headroom across all sections (`totalLimit - totalUsed -
   * totalReserved`, floored at zero). Untracked, unbounded sections do not
   * inflate this number.
   */
  remainingTotal(): number {
    return Math.max(0, this.totalLimit() - this.totalUsed() - this.totalReserved());
  }

  /**
   * Derives {@link BudgetStats} from the current records.
   */
  stats(): BudgetStats {
    let totalUsed = 0;
    let totalLimit = 0;
    let totalReserved = 0;
    let overLimit = 0;
    let underLimit = 0;
    for (const allocation of this._allocations.values()) {
      totalUsed += allocation.used;
      totalLimit += allocation.limit;
      totalReserved += allocation.reserved ?? 0;
      if (allocation.used > allocation.limit) overLimit += 1;
      else underLimit += 1;
    }
    const remaining = Math.max(0, totalLimit - totalUsed - totalReserved);
    return {
      sections: this._allocations.size,
      totalLimit,
      totalUsed,
      totalReserved,
      remaining,
      utilization: totalLimit > 0 ? totalUsed / totalLimit : 0,
      overLimit,
      underLimit,
    };
  }

  /**
   * Captures an immutable {@link BudgetSnapshot} of the current state.
   */
  snapshot(): BudgetSnapshot {
    const allocations = Array.from(this._allocations.values(), (a) => ({ ...a }));
    const totalLimit = sumLimits(allocations);
    const totalUsed = sumUsed(allocations);
    const totalReserved = sumReserved(allocations);
    return {
      timestamp: Date.now(),
      totalLimit,
      totalUsed,
      totalReserved,
      remaining: Math.max(0, totalLimit - totalUsed - totalReserved),
      sections: allocations,
    };
  }

  /**
   * Returns a deep-copied, independent clone of this store.
   */
  clone(): AllocationStore {
    const copy = new AllocationStore(this._defaultLimit);
    for (const [section, allocation] of this._allocations) {
      copy._allocations.set(section, { ...allocation });
    }
    return copy;
  }

  /**
   * Applies a result (from the allocator) to the ledger.
   *
   * Books the `allowed` tokens and, when present, records the reserve and
   * the post-condition. This keeps the store and the allocator consistent
   * without the allocator reaching into the store's internals.
   */
  apply(result: AllocationResult): this {
    if (!isSectionName(result.section)) {
      throw new TypeError(`Invalid section name: ${result.section}`);
    }
    const granted = Math.max(0, Math.floor(result.allowed));
    let record = this._allocations.get(result.section);
    if (!record) {
      record = createSectionAllocation(result.section, this._defaultLimit);
      this._allocations.set(result.section, record);
    }
    record.used = Math.max(0, Math.floor(result.used ?? granted));
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the store to a plain, JSON-friendly object.
   */
  toJSON(): AllocationStoreJSON {
    return {
      version: 1,
      defaultLimit: this._defaultLimit,
      allocations: Array.from(this._allocations.values(), (a) => ({ ...a })),
    };
  }

  /**
   * Clears this store and loads `data`. Invalid records are skipped; an
   * entirely malformed payload leaves the store cleared.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this._allocations.clear();
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    if (typeof parsed['defaultLimit'] === 'number' && Number.isFinite(parsed['defaultLimit'])) {
      this._defaultLimit = Math.max(0, Math.floor(parsed['defaultLimit']));
    }
    const list = parsed['allocations'];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (!isSectionAllocation(entry)) continue;
        const copy: SectionAllocation = { ...entry };
        this._allocations.set(copy.section, copy);
      }
    }
    return this;
  }

  /**
   * Rehydrates a new store from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): AllocationStore {
    const store = new AllocationStore(0);
    store.fromJSON(data);
    return store;
  }
}

/**
 * Creates a store pre-populated from an iterable of section allocations.
 * Useful for tests and for loading persisted state.
 */
export function storeFromAllocations(
  allocations: Iterable<SectionAllocation>,
  defaultLimit = 0,
): AllocationStore {
  const store = new AllocationStore(defaultLimit);
  for (const allocation of allocations) store.set(allocation);
  return store;
}