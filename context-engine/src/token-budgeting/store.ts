/**
 * Budget registry for the Token budgeting layer of the standalone MAM Context
 * Engine.
 *
 * {@link TokenBudgetStore} is the mutable heart of the layer: a section-keyed
 * registry of {@link SectionBudget}s that answers every accounting question —
 * *how many tokens does `memory` have left?* — and applies every state change
 * — *grant these tokens to `knowledge`, release those from `user`* — through a
 * single, well-guarded API.
 *
 * Responsibilities:
 *
 * - **Registry** — {@link TokenBudgetStore.set} / {@link TokenBudgetStore.get}
 *   / {@link TokenBudgetStore.has} / {@link TokenBudgetStore.delete} /
 *   {@link TokenBudgetStore.keys} / {@link TokenBudgetStore.clear} /
 *   {@link TokenBudgetStore.size} manage which sections are tracked at all.
 * - **Allocate** — {@link TokenBudgetStore.allocate} grants tokens to a
 *   section while honouring the configured overrun policy
 *   (`'trim' | 'reject' | 'allow'`) and the optional global cap, returning a
 *   full {@link BudgetAllocation} report.
 * - **Release** — {@link TokenBudgetStore.release} returns tokens to a
 *   section (never below zero) and reports the new `used` total.
 * - **Reserve** — {@link TokenBudgetStore.reserve} /
 *   {@link TokenBudgetStore.releaseReserved} pre-commit headroom for planned
 *   work without consuming the section's `used` count.
 * - **Inspect** — {@link TokenBudgetStore.used} / {@link TokenBudgetStore
 *   .remaining} / {@link TokenBudgetStore.status} /
 *   {@link TokenBudgetStore.overloaded} expose live state without mutating it.
 * - **Persist** — {@link TokenBudgetStore.toJSON} / {@link TokenBudgetStore
 *   .fromJSON} round-trip the whole table through plain JSON.
 *
 * The store extends `node:events`' `EventEmitter` and emits `'allocated'`,
 * `'released'`, `'reserved'`, `'set'`, `'reset'` and `'overrun'` events
 * carrying lightweight payloads, which lets {@link TokenBudgetLifecycle} and
 * the integration facades observe and react without polling.
 *
 * Sections are created lazily: the first `allocate`, `set`, `used` or
 * `remaining` touch on a section materialises a budget with the limit resolved
 * from the config (per-section override, then default). The store never guesses
 * section names — unknown names are simply new sections with their own
 * (default) limits.
 *
 * @module token-budgeting/store
 */

import { EventEmitter } from 'node:events';

import {
  budgetTotals,
  clampTokens,
  computeStatus,
  createSectionBudget,
  effectiveLimit,
  mergeTokenBudgetConfig,
  remainingTokens,
} from './types.js';
import type {
  BudgetAllocation,
  BudgetOptions,
  BudgetState,
  BudgetStats,
  BudgetStatus,
  OverrunPolicy,
  SectionBudget,
  SectionName,
  Timestamp,
  TokenBudgetConfig,
} from './types.js';

/**
 * A minimal event payload shared by every event this store emits.
 */
export interface BudgetEventPayload {
  /**
   * The section the event concerns.
   */
  readonly section: SectionName;

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly timestamp: Timestamp;
}

/**
 * Construction options for a {@link TokenBudgetStore}.
 */
export interface TokenBudgetStoreOptions {
  /**
   * Clock used for all timestamps. Injecting a clock makes the store
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The section-keyed budget registry.
 *
 * See the module documentation for the full responsibility list. The store
 * combines the raw {@link SectionBudget} registry with the accounting
 * operations (`allocate`/`release`/`reserve`) and policy enforcement, so every
 * layer above it can assume token counts are always consistent: `used` and
 * `reserved` never go negative, limits are always non-negative, and overruns
 * only happen when the configured policy allows them.
 *
 * @example
 * ```ts
 * const store = new TokenBudgetStore(config);
 * store.allocate('knowledge', 1200);   // grants, trims or rejects per policy
 * store.release('knowledge', 400);
 * store.remaining('knowledge');        // limit - used - reserved
 * ```
 */
export class TokenBudgetStore extends EventEmitter {
  /**
   * The effective configuration governing limits and the overrun policy.
   */
  readonly config: TokenBudgetConfig;

  /**
   * Section→budget registry, in insertion order.
   */
  private readonly budgets: Map<SectionName, SectionBudget> = new Map();

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  private updatedAt: Timestamp;

  /**
   * Number of `allocate` calls since construction.
   */
  private allocationCount = 0;

  /**
   * Number of `release` calls since construction.
   */
  private releaseCount = 0;

  /**
   * Number of `allocate` calls denied outright by the `'reject'` policy.
   */
  private rejectionCount = 0;

  /**
   * Number of allocations that pushed a section over its limit.
   */
  private overrunCount = 0;

  /**
   * Number of allocations partially denied by the `'trim'` policy.
   */
  private trimCount = 0;

  /**
   * Number of resets performed since construction.
   */
  private resetCount = 0;

  /**
   * Highest `totalUsed` observed since construction.
   */
  private peakUsed = 0;

  /**
   * Sum of every requested token count.
   */
  private totalRequested = 0;

  /**
   * Sum of every granted token count.
   */
  private totalGranted = 0;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * Construct a new budget store.
   *
   * @param config - partial configuration; merged over the defaults
   * @param options - construction options (notably the clock)
   */
  constructor(
    config: Partial<TokenBudgetConfig> | undefined = undefined,
    options: TokenBudgetStoreOptions = {},
  ) {
    super();
    this.config = mergeTokenBudgetConfig(config);
    this.now = options.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.updatedAt = this.createdAt;
  }

  /**
   * Resolve the effective overrun policy, preferring a per-call override.
   *
   * @param policy - the optional per-call policy override
   * @returns the policy to apply for this operation
   */
  private effectivePolicy(policy: OverrunPolicy | undefined): OverrunPolicy {
    return policy ?? this.config.overrunPolicy;
  }

  /**
   * Materialise a budget for a section if it does not already exist.
   *
   * Uses the limit resolved by {@link effectiveLimit}: per-section override
   * first, then the config default. A new section starts with `used = 0` and
   * `reserved = 0`.
   *
   * @param section - the section to materialise
   * @returns the (existing or freshly created) budget
   */
  private ensure(section: SectionName): SectionBudget {
    const existing = this.budgets.get(section);
    if (existing) {
      return existing;
    }
    const budget = createSectionBudget(
      section,
      effectiveLimit(this.config, section),
    );
    this.budgets.set(section, budget);
    return budget;
  }

  /**
   * Record a state change: bump `updatedAt` and refresh the peak counter.
   *
   * @param usedTotal - the current global `used` total
   */
  private touch(usedTotal: number): void {
    this.updatedAt = this.now();
    if (usedTotal > this.peakUsed) {
      this.peakUsed = usedTotal;
    }
  }

  /**
   * Insert or replace a section's budget wholesale.
   *
   * Values are validated and clamped: `limit`, `used` and `reserved` become
   * non-negative integers, and a missing `reserved` defaults to `0`. Emits a
   * `'set'` event.
   *
   * @param section - the section to set
   * @param budget - partial budget fields to apply; `limit`, `used` and
   *   `reserved` are read from it and `section` is overridden by the key
   * @returns the stored, normalised {@link SectionBudget}
   */
  set(section: SectionName, budget: Partial<SectionBudget>): SectionBudget {
    const limit = clampTokens(budget.limit ?? effectiveLimit(this.config, section));
    const used = clampTokens(budget.used ?? 0);
    const reserved = clampTokens(budget.reserved ?? 0);
    const normalized: SectionBudget = createSectionBudget(section, limit, used, reserved);
    this.budgets.set(section, normalized);
    const totals = budgetTotals(this.budgets.values());
    this.touch(totals.totalUsed);
    this.emit('set', { section, timestamp: this.updatedAt } satisfies BudgetEventPayload);
    return normalized;
  }

  /**
   * Fetch a section's budget without mutating it.
   *
   * Materialises the section (with its resolved limit) when unknown, so reads
   * never throw on fresh names. Returns a shallow copy to prevent callers from
   * mutating internal state through the returned object.
   *
   * @param section - the section to fetch
   * @returns a copy of the section's {@link SectionBudget}
   */
  get(section: SectionName): SectionBudget {
    return { ...this.ensure(section) };
  }

  /**
   * Test whether a section is currently tracked.
   *
   * Unlike {@link TokenBudgetStore.get}, this does **not** materialise unknown
   * sections — `has` is a pure registry lookup.
   *
   * @param section - the section to test
   * @returns `true` when the section has an explicit budget entry
   */
  has(section: SectionName): boolean {
    return this.budgets.has(section);
  }

  /**
   * Remove a section's budget entirely.
   *
   * @param section - the section to remove
   * @returns `true` when an entry existed and was removed
   */
  delete(section: SectionName): boolean {
    const removed = this.budgets.delete(section);
    if (removed) {
      this.touch(budgetTotals(this.budgets.values()).totalUsed);
    }
    return removed;
  }

  /**
   * The names of every tracked section, in insertion order.
   *
   * @returns a fresh array of section names
   */
  keys(): SectionName[] {
    return [...this.budgets.keys()];
  }

  /**
   * Every tracked budget, in insertion order.
   *
   * @returns a fresh array of {@link SectionBudget} copies
   */
  sections(): SectionBudget[] {
    return [...this.budgets.values()].map((budget) => ({ ...budget }));
  }

  /**
   * Every `[section, budget]` pair, in insertion order.
   *
   * @returns a fresh array of entries (budgets as copies)
   */
  entries(): Array<[SectionName, SectionBudget]> {
    return [...this.budgets.entries()].map(([section, budget]) => [
      section,
      { ...budget },
    ]);
  }

  /**
   * Remove every tracked budget, returning the store to an empty table.
   *
   * Counters are retained (so `stats().allocations` is still meaningful), but
   * all section entries are dropped. Emits a `'reset'` event.
   */
  clear(): void {
    this.budgets.clear();
    this.resetCount += 1;
    this.updatedAt = this.now();
    this.emit('reset', { section: '*', timestamp: this.updatedAt } satisfies BudgetEventPayload);
  }

  /**
   * The number of sections currently tracked.
   */
  get size(): number {
    return this.budgets.size;
  }

  /**
   * Allocate tokens to a section, enforcing the overrun policy and the
   * optional global cap.
   *
   * The behaviour for each policy when the request exceeds headroom:
   *
   * - `'trim'` — grant only what fits (`remaining` tokens), refuse the rest.
   * - `'reject'` — grant nothing; the call is a {@link BudgetStats.rejections}.
   * - `'allow'` — grant everything, even past the limit (counted as an
   *   {@link BudgetStats.overruns}).
   *
   * When {@link BudgetOptions.reserve} is set the granted tokens are added to
   * `reserved` instead of `used`. Emits `'allocated'` (or `'reserved'`)
   * and, when applicable, `'overrun'`.
   *
   * @param section - the section to allocate to
   * @param tokens - the number of tokens requested (clamped to a non-negative
   *   integer)
   * @param options - per-call overrides (policy, reserve flag, clock)
   * @returns a full {@link BudgetAllocation} report
   */
  allocate(
    section: SectionName,
    tokens: number,
    options: BudgetOptions = {},
  ): BudgetAllocation {
    const requested = clampTokens(tokens);
    const policy = this.effectivePolicy(options.policy);
    const budget = this.ensure(section);
    const headroom = remainingTokens(budget);
    const at = options.now ?? this.now();
    const globalHeadroom =
      this.config.maxTotal > 0
        ? Math.max(0, this.config.maxTotal - budgetTotals(this.budgets.values()).totalUsed)
        : Number.POSITIVE_INFINITY;
    const effectiveHeadroom = Math.min(headroom, globalHeadroom);

    let granted = 0;
    let denied = 0;
    let overrun = false;

    if (requested <= effectiveHeadroom) {
      granted = requested;
    } else if (policy === 'trim') {
      granted = effectiveHeadroom;
      denied = requested - granted;
      if (denied > 0) {
        this.trimCount += 1;
      }
    } else if (policy === 'allow') {
      granted = requested;
      denied = 0;
      if (requested > effectiveHeadroom) {
        overrun = true;
        this.overrunCount += 1;
      }
    } else {
      denied = requested;
      this.rejectionCount += 1;
    }

    const nextUsed = budget.used + (options.reserve ? 0 : granted);
    const nextReserved = budget.reserved + (options.reserve ? granted : 0);
    this.budgets.set(section, {
      section,
      limit: budget.limit,
      used: nextUsed,
      reserved: nextReserved,
    });

    this.totalRequested += requested;
    this.totalGranted += granted;
    this.allocationCount += 1;
    this.touch(budgetTotals(this.budgets.values()).totalUsed);

    const status = computeStatus({ ...this.budgets.get(section)! });
    this.emit(
      options.reserve ? 'reserved' : 'allocated',
      { section, timestamp: at } satisfies BudgetEventPayload,
    );
    if (overrun) {
      this.emit('overrun', { section, timestamp: at } satisfies BudgetEventPayload);
    }

    return {
      section,
      requested,
      granted,
      denied,
      used: nextUsed,
      committed: nextUsed + nextReserved,
      remaining: Math.max(0, this.budgets.get(section)!.limit - nextUsed - nextReserved),
      limit: budget.limit,
      status,
      policy,
      ok: granted === requested && status !== 'over',
      at,
    };
  }

  /**
   * Release tokens back to a section.
   *
   * `used` is reduced by `tokens` and never drops below `0`. Emits a
   * `'released'` event.
   *
   * @param section - the section to release from
   * @param tokens - the number of tokens to release (clamped; a value of `0`
   *   or less is a no-op)
   * @returns the section's new `used` total
   */
  release(section: SectionName, tokens: number): number {
    const amount = clampTokens(tokens);
    if (amount === 0 || !this.budgets.has(section)) {
      return this.budgets.get(section)?.used ?? 0;
    }
    const budget = this.budgets.get(section)!;
    const nextUsed = Math.max(0, budget.used - amount);
    this.budgets.set(section, { ...budget, used: nextUsed });
    this.releaseCount += 1;
    const at = this.now();
    this.touch(budgetTotals(this.budgets.values()).totalUsed);
    this.emit('released', { section, timestamp: at } satisfies BudgetEventPayload);
    return nextUsed;
  }

  /**
   * Reserve headroom for planned work without consuming `used`.
   *
   * Tokens are added to the section's `reserved` count. Like
   * {@link TokenBudgetStore.allocate}, the overrun policy applies — under
   * `'reject'` an unreservable request grants nothing.
   *
   * @param section - the section to reserve for
   * @param tokens - the number of tokens to reserve
   * @param options - per-call overrides
   * @returns the granted reservation count
   */
  reserve(
    section: SectionName,
    tokens: number,
    options: BudgetOptions = {},
  ): number {
    const allocation = this.allocate(section, tokens, { ...options, reserve: true });
    return allocation.granted;
  }

  /**
   * Release a previously-made reservation.
   *
   * `reserved` is reduced by `tokens` and never drops below `0`. Emits a
   * `'released'` event.
   *
   * @param section - the section whose reservation to release
   * @param tokens - the number of reserved tokens to release
   * @returns the section's new `reserved` total
   */
  releaseReserved(section: SectionName, tokens: number): number {
    const amount = clampTokens(tokens);
    if (amount === 0 || !this.budgets.has(section)) {
      return this.budgets.get(section)?.reserved ?? 0;
    }
    const budget = this.budgets.get(section)!;
    const nextReserved = Math.max(0, budget.reserved - amount);
    this.budgets.set(section, { ...budget, reserved: nextReserved });
    const at = this.now();
    this.updatedAt = at;
    this.emit('released', { section, timestamp: at } satisfies BudgetEventPayload);
    return nextReserved;
  }

  /**
   * A section's current `used` token count.
   *
   * @param section - the section to query
   * @returns the used count (`0` for a never-touched section)
   */
  used(section: SectionName): number {
    return this.ensure(section).used;
  }

  /**
   * A section's current `reserved` token count.
   *
   * @param section - the section to query
   * @returns the reserved count (`0` for a never-touched section)
   */
  reserved(section: SectionName): number {
    return this.ensure(section).reserved;
  }

  /**
   * A section's effective token limit.
   *
   * @param section - the section to query
   * @returns the resolved limit
   */
  limit(section: SectionName): number {
    return this.ensure(section).limit;
  }

  /**
   * A section's remaining headroom: `limit - used - reserved`, clamped at `0`.
   *
   * @param section - the section to query
   * @returns the remaining token count
   */
  remaining(section: SectionName): number {
    return remainingTokens(this.ensure(section));
  }

  /**
   * A section's utilisation bucket.
   *
   * @param section - the section to query
   * @returns the section's {@link BudgetStatus}
   */
  status(section: SectionName): BudgetStatus {
    return computeStatus(this.ensure(section));
  }

  /**
   * The names of every section currently over its limit.
   *
   * Only possible under the `'allow'` policy (or after a `'trim'` grant was
   * later topped up to exceed the limit).
   *
   * @returns a fresh array of overloaded section names
   */
  overloaded(): SectionName[] {
    const names: SectionName[] = [];
    for (const [name, budget] of this.budgets) {
      if (budget.used > budget.limit) {
        names.push(name);
      }
    }
    return names;
  }

  /**
   * Reset every section's `used` and `reserved` counts to `0`, keeping the
   * limits intact.
   *
   * Emits a `'reset'` event.
   */
  reset(): void {
    for (const [name, budget] of this.budgets) {
      this.budgets.set(name, { ...budget, used: 0, reserved: 0 });
    }
    this.resetCount += 1;
    this.updatedAt = this.now();
    this.emit('reset', { section: '*', timestamp: this.updatedAt } satisfies BudgetEventPayload);
  }

  /**
   * Reset a single section's `used` and `reserved` counts to `0`.
   *
   * @param section - the section to reset
   * @returns the reset {@link SectionBudget}
   */
  resetSection(section: SectionName): SectionBudget {
    const budget = this.ensure(section);
    const reset: SectionBudget = { ...budget, used: 0, reserved: 0 };
    this.budgets.set(section, reset);
    this.updatedAt = this.now();
    return reset;
  }

  /**
   * Aggregate counters for this store.
   *
   * Behaviour counters are monotonic since construction; state-derived fields
   * (`sections`, `totalUsed`, …) are computed on demand.
   *
   * @returns a {@link BudgetStats} snapshot
   */
  stats(): BudgetStats {
    const totals = budgetTotals(this.budgets.values());
    return {
      sections: this.budgets.size,
      totalUsed: totals.totalUsed,
      totalReserved: totals.totalReserved,
      totalLimit: totals.totalLimit,
      totalRemaining: totals.totalRemaining,
      allocations: this.allocationCount,
      releases: this.releaseCount,
      rejections: this.rejectionCount,
      overruns: this.overrunCount,
      trims: this.trimCount,
      resets: this.resetCount,
      pruned: 0,
      peakUsed: this.peakUsed,
      totalRequested: this.totalRequested,
      totalGranted: this.totalGranted,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Serialise the whole budget table.
   *
   * @returns a JSON-safe {@link BudgetState} snapshot
   */
  toJSON(): BudgetState {
    const totals = budgetTotals(this.budgets.values());
    return {
      sections: this.sections(),
      maxTotal: this.config.maxTotal ?? 0,
      totalLimit: totals.totalLimit,
      totalUsed: totals.totalUsed,
      totalRemaining: totals.totalRemaining,
      overrunPolicy: this.config.overrunPolicy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Restore a previously-serialised budget table.
   *
   * Existing entries are replaced wholesale; sections absent from `state` are
   * dropped. Emits a `'reset'` event.
   *
   * @param state - a {@link BudgetState} produced by {@link TokenBudgetStore
   *   .toJSON}
   */
  fromJSON(state: BudgetState): void {
    this.budgets.clear();
    for (const budget of state.sections) {
      this.budgets.set(
        budget.section,
        createSectionBudget(budget.section, budget.limit, budget.used, budget.reserved),
      );
    }
    this.resetCount += 1;
    this.updatedAt = this.now();
    this.emit('reset', { section: '*', timestamp: this.updatedAt } satisfies BudgetEventPayload);
  }

  /**
   * Build a store from a serialised {@link BudgetState}.
   *
   * The stored config-level fields (`maxTotal`, `overrunPolicy`) are folded
   * back into the constructed store's config so the restored table behaves
   * like the original.
   *
   * @param state - the serialised state to restore
   * @param options - construction options (notably the clock)
   * @returns a configured, populated {@link TokenBudgetStore}
   */
  static fromJSON(
    state: BudgetState,
    options: TokenBudgetStoreOptions = {},
  ): TokenBudgetStore {
    const store = new TokenBudgetStore(
      {
        defaultLimit: DEFAULT_LIMIT_FROM_STATE(state),
        perSection: perSectionFromState(state),
        maxTotal: state.maxTotal,
        overrunPolicy: state.overrunPolicy,
      },
      options,
    );
    store.fromJSON(state);
    return store;
  }
}

/**
 * Internal helper: derive a plausible default limit from a restored state.
 *
 * Picks the median section limit so that future (unknown) sections get a
 * representative cap rather than an arbitrary one. Falls back to
 * `DEFAULT_SECTION_LIMIT` when the state is empty.
 *
 * @param state - the restored state
 * @returns the derived default limit
 */
function DEFAULT_LIMIT_FROM_STATE(state: BudgetState): number {
  const limits = state.sections.map((budget) => budget.limit).sort((a, b) => a - b);
  if (limits.length === 0) {
    return 8000;
  }
  const mid = Math.floor(limits.length / 2);
  return limits[mid];
}

/**
 * Internal helper: extract a per-section limit table from a restored state.
 *
 * @param state - the restored state
 * @returns a per-section record usable as {@link TokenBudgetConfig.perSection}
 */
function perSectionFromState(
  state: BudgetState,
): Readonly<Partial<Record<SectionName, number>>> {
  const per: Record<string, number> = {};
  for (const budget of state.sections) {
    per[budget.section] = budget.limit;
  }
  return per;
}