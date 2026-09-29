/**
 * Status index for the Token budgeting layer of the standalone MAM Context
 * Engine.
 *
 * {@link BudgetIndex} answers the read-side questions the rest of the layer
 * keeps asking: *"which sections are over their limit?"*, *"what's in the
 * critical bucket?"*, *"show me the budget for `tool`"*. Rather than scanning
 * every {@link SectionBudget} on each query, it maintains a set of secondary
 * indexes — one bucket per {@link BudgetStatus} plus a section-keyed map — and
 * keeps them consistent through explicit `indexBudget` / `removeBudget` calls
 * or a wholesale {@link BudgetIndex.rebuild}.
 *
 * Responsibilities:
 *
 * - **Index** — {@link BudgetIndex.indexBudget} inserts or updates a budget
 *   and moves it to the correct status bucket; {@link BudgetIndex.removeBudget}
 *   evicts it from every index.
 * - **Query** — {@link BudgetIndex.findBySection} / {@link BudgetIndex
 *   .findByStatus} resolve indexed budgets; {@link BudgetIndex.overloaded}
 *   returns every section past its limit; {@link BudgetIndex.size} reports how
 *   many budgets are tracked.
 * - **Rebuild** — {@link BudgetIndex.rebuild} drops and re-populates the
 *   whole index from an arbitrary iterable of budgets, which is how a store
 *   snapshot gets mirrored into the index cheaply.
 * - **Reset** — {@link BudgetIndex.clear} empties every index at once.
 * - **Inspect** — {@link BudgetIndex.stats} and {@link BudgetIndex.status}
 *   expose the shape and health of the index.
 *
 * The index is deliberately **decoupled from {@link TokenBudgetStore}**: it
 * indexes plain {@link SectionBudget} objects, so it can mirror the store's
 * live table, index budgets from a serialised snapshot, or even index a
 * hypothetical "what-if" budget set without touching the store at all.
 *
 * Status buckets are derived with {@link computeStatus} using the
 * `warnThreshold` / `criticalThreshold` ratios, which may be customised at
 * construction time for stricter or looser reporting.
 *
 * @module token-budgeting/index
 */

import {
  computeStatus,
  isSectionBudget,
} from './types.js';
import type {
  BudgetStatus,
  SectionBudget,
  SectionName,
} from './types.js';

/**
 * Construction options for a {@link BudgetIndex}.
 */
export interface BudgetIndexOptions {
  /**
   * Utilisation ratio at which a section is bucketed as `'warn'`. Defaults to
   * `0.8`. Only affects classification, never the budget arithmetic itself.
   */
  readonly warnThreshold?: number;

  /**
   * Utilisation ratio at which a section is bucketed as `'critical'`. Defaults
   * to `0.95`. Only affects classification.
   */
  readonly criticalThreshold?: number;
}

/**
 * Shape of the {@link BudgetIndex.stats} report.
 */
export interface BudgetIndexStats {
  /**
   * Total number of budgets indexed.
   */
  readonly size: number;

  /**
   * Number of budgets currently in the `'ok'` bucket.
   */
  readonly ok: number;

  /**
   * Number of budgets currently in the `'warn'` bucket.
   */
  readonly warn: number;

  /**
   * Number of budgets currently in the `'critical'` bucket.
   */
  readonly critical: number;

  /**
   * Number of budgets currently in the `'over'` bucket (used > limit).
   */
  readonly over: number;

  /**
   * Number of budgets currently past their limit (same as `over`).
   */
  readonly overloaded: number;
}

/**
 * The section/status budget index.
 *
 * See the module documentation for the full responsibility list. Every query
 * method returns *copies* of the indexed budgets (or arrays of copies) so
 * callers cannot mutate the index's internal state through the values they
 * receive.
 *
 * @example
 * ```ts
 * const index = new BudgetIndex();
 * index.indexBudget(store.get('knowledge'));
 * index.overloaded();            // sections past their limit
 * index.findByStatus('warn');    // sections approaching their limit
 * ```
 */
export class BudgetIndex {
  /**
   * Section→budget primary index.
   */
  private readonly bySection: Map<SectionName, SectionBudget> = new Map();

  /**
   * Status→section-names secondary index.
   */
  private readonly byStatus: Map<BudgetStatus, Set<SectionName>> = new Map([
    ['ok', new Set()],
    ['warn', new Set()],
    ['critical', new Set()],
    ['over', new Set()],
  ]);

  /**
   * Utilisation ratio at which a section is bucketed as `'warn'`.
   */
  private readonly warnThreshold: number;

  /**
   * Utilisation ratio at which a section is bucketed as `'critical'`.
   */
  private readonly criticalThreshold: number;

  /**
   * Construct a new index.
   *
   * @param options - optional threshold overrides
   */
  constructor(options: BudgetIndexOptions = {}) {
    this.warnThreshold = options.warnThreshold ?? 0.8;
    this.criticalThreshold = options.criticalThreshold ?? 0.95;
  }

  /**
   * Classify a budget under this index's thresholds.
   *
   * `'over'` wins whenever `used > limit`; otherwise the ratio is compared
   * against the configured critical and warn thresholds.
   *
   * @param budget - the budget to classify
   * @returns the derived {@link BudgetStatus}
   */
  private classify(budget: SectionBudget): BudgetStatus {
    if (budget.used > budget.limit) {
      return 'over';
    }
    if (budget.limit <= 0) {
      return budget.used > 0 ? 'over' : 'critical';
    }
    const ratio = budget.used / budget.limit;
    if (ratio >= this.criticalThreshold) {
      return 'critical';
    }
    if (ratio >= this.warnThreshold) {
      return 'warn';
    }
    return 'ok';
  }

  /**
   * Move a section into the bucket for a given status, removing it from any
   * bucket it previously occupied.
   *
   * @param section - the section to re-bucket
   * @param status - the target status bucket
   */
  private rebucket(section: SectionName, status: BudgetStatus): void {
    for (const bucket of this.byStatus.values()) {
      bucket.delete(section);
    }
    this.byStatus.get(status)!.add(section);
  }

  /**
   * Insert or update a budget in the index.
   *
   * Replaces any existing entry for the same section, re-buckets it by its
   * (recomputed) status, and returns the budget this index now stores. Values
   * are validated structurally via {@link isSectionBudget}; malformed inputs
   * are ignored and `false` is returned.
   *
   * @param budget - the budget to index
   * @returns `true` when the budget was accepted and indexed
   */
  indexBudget(budget: SectionBudget): boolean {
    if (!isSectionBudget(budget)) {
      return false;
    }
    const normalized: SectionBudget = {
      section: budget.section,
      limit: budget.limit,
      used: budget.used,
      reserved: budget.reserved,
    };
    this.bySection.set(budget.section, normalized);
    this.rebucket(budget.section, this.classify(normalized));
    return true;
  }

  /**
   * Remove a budget from every index.
   *
   * @param section - the section to remove
   * @returns `true` when the section was indexed and removed
   */
  removeBudget(section: SectionName): boolean {
    const removed = this.bySection.delete(section);
    if (removed) {
      for (const bucket of this.byStatus.values()) {
        bucket.delete(section);
      }
    }
    return removed;
  }

  /**
   * Resolve a section's indexed budget.
   *
   * @param section - the section to look up
   * @returns a copy of the indexed budget, or `undefined` when not indexed
   */
  findBySection(section: SectionName): SectionBudget | undefined {
    const budget = this.bySection.get(section);
    return budget ? { ...budget } : undefined;
  }

  /**
   * Every indexed budget currently in a given status bucket.
   *
   * @param status - the status to filter by
   * @returns a fresh array of budget copies in insertion order
   */
  findByStatus(status: BudgetStatus): SectionBudget[] {
    const names = this.byStatus.get(status) ?? new Set<SectionName>();
    const out: SectionBudget[] = [];
    for (const name of names) {
      const budget = this.bySection.get(name);
      if (budget) {
        out.push({ ...budget });
      }
    }
    return out;
  }

  /**
   * Every section whose budget is *over* its limit.
   *
   * This is the headline health query: a non-empty result means something is
   * consuming more than it was budgeted (only possible under the `'allow'`
   * policy or after trim-grant top-ups).
   *
   * @returns a fresh array of overloaded {@link SectionBudget} copies
   */
  overloaded(): SectionBudget[] {
    return this.findByStatus('over');
  }

  /**
   * Every indexed budget, in insertion order.
   *
   * @returns a fresh array of budget copies
   */
  sections(): SectionBudget[] {
    return [...this.bySection.values()].map((budget) => ({ ...budget }));
  }

  /**
   * The names of every indexed section, in insertion order.
   *
   * @returns a fresh array of section names
   */
  keys(): SectionName[] {
    return [...this.bySection.keys()];
  }

  /**
   * A section's current classification under this index.
   *
   * @param section - the section to classify
   * @returns the indexed status, or `undefined` when the section is unknown
   */
  status(section: SectionName): BudgetStatus | undefined {
    const budget = this.bySection.get(section);
    return budget ? this.classify(budget) : undefined;
  }

  /**
   * Test whether a section is currently indexed.
   *
   * @param section - the section to test
   * @returns `true` when the section has an indexed budget
   */
  has(section: SectionName): boolean {
    return this.bySection.has(section);
  }

  /**
   * The number of budgets currently indexed.
   */
  get size(): number {
    return this.bySection.size;
  }

  /**
   * Rebuild the entire index from an iterable of budgets.
   *
   * Atomically clears every existing index and repopulates it from `budgets`.
   * Useful for mirroring a store snapshot, re-indexing after a restore, or
   * indexing a freshly-loaded serialised state. Invalid budgets in the source
   * are silently skipped.
   *
   * @param budgets - the budgets to index
   * @returns the number of budgets actually indexed
   */
  rebuild(budgets: Iterable<SectionBudget>): number {
    this.clear();
    let indexed = 0;
    for (const budget of budgets) {
      if (this.indexBudget(budget)) {
        indexed += 1;
      }
    }
    return indexed;
  }

  /**
   * Empty every index.
   */
  clear(): void {
    this.bySection.clear();
    for (const bucket of this.byStatus.values()) {
      bucket.clear();
    }
  }

  /**
   * Snapshot the shape and health of the index.
   *
   * @returns a {@link BudgetIndexStats} report
   */
  stats(): BudgetIndexStats {
    return {
      size: this.bySection.size,
      ok: this.byStatus.get('ok')!.size,
      warn: this.byStatus.get('warn')!.size,
      critical: this.byStatus.get('critical')!.size,
      over: this.byStatus.get('over')!.size,
      overloaded: this.byStatus.get('over')!.size,
    };
  }

  /**
   * Iterate over every indexed budget.
   */
  *[Symbol.iterator](): IterableIterator<SectionBudget> {
    for (const budget of this.bySection.values()) {
      yield { ...budget };
    }
  }

  /**
   * Build an index pre-populated from an iterable of budgets.
   *
   * @param budgets - the budgets to index
   * @param options - optional threshold overrides
   * @returns a populated {@link BudgetIndex}
   */
  static from(budgets: Iterable<SectionBudget>, options: BudgetIndexOptions = {}): BudgetIndex {
    const index = new BudgetIndex(options);
    index.rebuild(budgets);
    return index;
  }
}