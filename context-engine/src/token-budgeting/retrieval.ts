/**
 * Budget policy layer for the Token budgeting subsystem of the standalone MAM
 * Context Engine.
 *
 * {@link BudgetManager} is the layer's **decision-maker**. Where
 * {@link TokenBudgetStore} simply records token counts, the manager turns
 * those counts into decisions: *"can I afford this?"*, *"grant it, but only
 * this much"*, *"cut your payload by this many tokens"*. It is the class
 * callers are expected to interact with most, sitting between the raw store
 * and the high-level integration facades.
 *
 * Responsibilities:
 *
 * - **Check** — {@link BudgetManager.check} answers *"would allocating `tokens`
 *   to `section` exceed its budget?"* without mutating any state, returning a
 *   full {@link BudgetCheck} (projected usage, deficit, resulting status).
 * - **Allocate** — {@link BudgetManager.allocate} commits tokens through the
 *   store while honouring the configured overrun policy, returning a full
 *   {@link BudgetAllocation} report. Per-call policy overrides are accepted.
 * - **Trim** — {@link BudgetManager.trim} answers *"how many tokens must the
 *   section shed to reach `target`?"*, producing a suggested amount the caller
 *   can then physically trim (the integration facade's `fit` does exactly
 *   that).
 * - **Overall** — {@link BudgetManager.overall} rolls the whole table up into
 *   a single total-used/total-limit/total-remaining snapshot.
 * - **Available** — {@link BudgetManager.available} reports remaining headroom
 *   globally and per section.
 * - **Reset** — {@link BudgetManager.reset} and {@link BudgetManager
 *   .resetSection} clear usage without destroying the registry.
 *
 * The manager holds a reference to a {@link TokenBudgetStore} and delegates
 * all state mutation to it, so a manager can be layered over a store that is
 * shared with the lifecycle and index without any coordination hazards — the
 * store is the single source of truth.
 *
 * @module token-budgeting/retrieval
 */

import { TokenBudgetStore } from './store.js';
import {
  budgetTotals,
  clampTokens,
  computeStatus,
  effectiveLimit,
  mergeTokenBudgetConfig,
  remainingTokens,
} from './types.js';
import type {
  BudgetAllocation,
  BudgetAvailability,
  BudgetCheck,
  BudgetOptions,
  BudgetStats,
  OverrunPolicy,
  SectionName,
  TokenBudgetConfig,
} from './types.js';

/**
 * The rolled-up totals produced by {@link BudgetManager.overall}.
 */
export interface OverallTotals {
  /**
   * Number of sections tracked.
   */
  readonly sections: number;

  /**
   * Sum of every section's limit.
   */
  readonly totalLimit: number;

  /**
   * Sum of every section's used tokens.
   */
  readonly totalUsed: number;

  /**
   * Sum of every section's remaining headroom, clamped at `0`.
   */
  readonly totalRemaining: number;

  /**
   * Global utilisation ratio `totalUsed / totalLimit` (`1` when the limit is
   * `0`, so a full/empty table reads as exhausted).
   */
  readonly utilization: number;

  /**
   * The configured global cap (`0` = disabled). See
   * {@link TokenBudgetConfig.maxTotal}.
   */
  readonly maxTotal: number;

  /**
   * Remaining headroom against the global cap (`maxTotal - totalUsed`, clamped
   * at `0`) when a cap is configured, otherwise `Number.POSITIVE_INFINITY`.
   */
  readonly globalRemaining: number;
}

/**
 * The budget decision-maker.
 *
 * See the module documentation for the full responsibility list. The manager
 * composes a {@link TokenBudgetStore} with the policy logic (`check`, `trim`,
 * `overall`) so callers get one object that can answer both *"may I?"* and
 * *"how much?"* questions without reaching into the store directly.
 *
 * @example
 * ```ts
 * const manager = new BudgetManager(store);
 * if (!manager.check('knowledge', 500).wouldExceed) {
 *   manager.allocate('knowledge', 500);
 * }
 * const toTrim = manager.trim('user', 4000);   // suggested token cut
 * ```
 */
export class BudgetManager {
  /**
   * The underlying store this manager drives. Exposed read-only so callers can
   * reach lower-level features (serialisation, events) when needed.
   */
  readonly store: TokenBudgetStore;

  /**
   * The effective configuration governing limits and policy.
   */
  readonly config: TokenBudgetConfig;

  /**
   * Construct a manager over a store.
   *
   * @param store - the store to drive; when omitted a fresh store is built
   *   from `config`
   * @param config - optional configuration. When `store` is provided this is
   *   merged over the store's own config; when `store` is omitted it is used
   *   to construct one.
   */
  constructor(
    store?: TokenBudgetStore,
    config: Partial<TokenBudgetConfig> | undefined = undefined,
  ) {
    if (store) {
      this.store = store;
      this.config = mergeTokenBudgetConfig(config) as TokenBudgetConfig;
    } else {
      const resolved = mergeTokenBudgetConfig(config);
      this.store = new TokenBudgetStore(resolved);
      this.config = this.store.config;
    }
  }

  /**
   * Dry-run a prospective allocation.
   *
   * Answers *"would allocating `tokens` to `section` exceed its budget?"*
   * without changing any state. The check accounts for the section's current
   * `used` **and** `reserved` counts, and — when a global cap is configured —
   * for the total already used across all sections.
   *
   * @param section - the section to check
   * @param tokens - the number of tokens being considered
   * @returns a {@link BudgetCheck} describing the outcome
   */
  check(section: SectionName, tokens: number): BudgetCheck {
    const requested = clampTokens(tokens);
    const budget = this.store.get(section);
    const remaining = remainingTokens(budget);
    const projected = budget.used + requested;
    const globalRemaining =
      this.config.maxTotal > 0
        ? Math.max(0, this.config.maxTotal - this.store.stats().totalUsed)
        : Number.POSITIVE_INFINITY;
    const headroom = Math.min(remaining, globalRemaining);
    const wouldExceed = requested > headroom;
    return {
      section,
      requested,
      used: budget.used,
      remaining,
      limit: budget.limit,
      wouldExceed,
      projected,
      deficit: Math.max(0, requested - headroom),
      status: computeStatus({ ...budget, used: projected }),
    };
  }

  /**
   * Allocate tokens to a section, honouring the overrun policy.
   *
   * Delegates the actual accounting to {@link TokenBudgetStore.allocate} and
   * returns its full report. A per-call {@link BudgetOptions.policy} override
   * beats the configured policy for this invocation only.
   *
   * @param section - the section to allocate to
   * @param tokens - the number of tokens requested
   * @param options - per-call overrides (policy, reserve flag, clock)
   * @returns a {@link BudgetAllocation} report
   */
  allocate(
    section: SectionName,
    tokens: number,
    options: BudgetOptions = {},
  ): BudgetAllocation {
    return this.store.allocate(section, tokens, options);
  }

  /**
   * Suggest how many tokens a section must shed to reach a target usage.
   *
   * Pure advisory — nothing is released. The returned value is
   * `max(0, used - target)`, i.e. how many tokens the caller should release
   * (or physically trim from the section's content) for the section to sit at
   * or below `target`. A negative target is treated as `0`.
   *
   * @param section - the section to measure
   * @param target - the desired `used` ceiling (clamped to a non-negative
   *   integer)
   * @returns the number of tokens to trim
   */
  trim(section: SectionName, target: number): number {
    const used = this.store.used(section);
    const ceiling = clampTokens(target);
    return Math.max(0, used - ceiling);
  }

  /**
   * Roll the whole budget table up into totals.
   *
   * @returns an {@link OverallTotals} snapshot
   */
  overall(): OverallTotals {
    const sections = this.store.sections();
    const totals = budgetTotals(sections);
    const utilization = totals.totalLimit <= 0 ? 1 : totals.totalUsed / totals.totalLimit;
    const globalRemaining =
      this.config.maxTotal > 0
        ? Math.max(0, this.config.maxTotal - totals.totalUsed)
        : Number.POSITIVE_INFINITY;
    return {
      sections: sections.length,
      totalLimit: totals.totalLimit,
      totalUsed: totals.totalUsed,
      totalRemaining: totals.totalRemaining,
      utilization,
      maxTotal: this.config.maxTotal ?? 0,
      globalRemaining,
    };
  }

  /**
   * Remaining headroom, globally and per section.
   *
   * When called without a section it returns a {@link BudgetAvailability}
   * summary (total plus a per-section map). When called with a section it
   * returns that section's remaining count as a plain number.
   *
   * @param section - optional section to narrow the answer to
   * @returns a {@link BudgetAvailability} summary, or a plain number when a
   *   section was given
   */
  available(section?: SectionName): BudgetAvailability | number {
    if (section !== undefined) {
      return this.store.remaining(section);
    }
    const perSection: Record<string, number> = {};
    let total = 0;
    for (const budget of this.store.sections()) {
      const remaining = remainingTokens(budget);
      perSection[budget.section] = remaining;
      total += remaining;
    }
    return { total, perSection };
  }

  /**
   * The sections currently past their limit.
   *
   * @returns the overloaded section names
   */
  overloaded(): SectionName[] {
    return this.store.overloaded();
  }

  /**
   * Reset every section's usage to `0` (limits retained).
   */
  reset(): void {
    this.store.reset();
  }

  /**
   * Reset a single section's usage to `0`.
   *
   * @param section - the section to reset
   */
  resetSection(section: SectionName): void {
    this.store.resetSection(section);
  }

  /**
   * Aggregate counters for the manager's store.
   *
   * @returns a {@link BudgetStats} snapshot
   */
  stats(): BudgetStats {
    return this.store.stats();
  }

  /**
   * Resolve the effective limit for a section under this manager's config.
   *
   * @param section - the section to resolve a limit for
   * @returns the section's effective limit
   */
  limit(section: SectionName): number {
    return effectiveLimit(this.config, section);
  }
}

/**
 * Derive the effective policy for a single operation.
 *
 * Internal helper kept exported for the integration facades that need to know
 * which policy a call resolved to for reporting.
 *
 * @param config - the configuration
 * @param override - an optional per-call override
 * @returns the policy to apply
 */
export function resolvePolicy(
  config: TokenBudgetConfig,
  override: OverrunPolicy | undefined,
): OverrunPolicy {
  return override ?? config.overrunPolicy;
}