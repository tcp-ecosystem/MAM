/**
 * Integration surface for the Token budgeting layer of the standalone MAM
 * Context Engine.
 *
 * This module is how the rest of the context engine consumes Token budgeting.
 * It exposes three pieces:
 *
 * 1. **{@link TokenBudget}** — the contract every budgeting facade implements,
 *    so consumers can depend on the interface rather than a concrete class.
 * 2. **{@link TokenBudgeter}** — the high-level facade. It composes a
 *    {@link TokenBudgetStore}, a {@link BudgetManager} and a
 *    {@link BudgetLifecycle} into one object that can allocate tokens,
 *    *estimate* how many tokens a piece of text will cost, and *fit* a piece
 *    of text into a section's remaining budget by truncating it.
 * 3. **{@link BudgetAdapter}** — an alternate {@link TokenBudget}
 *    implementation that adapts an *already-existing* store + manager pair
 *    (perhaps shared with other consumers) into the same contract, without
 *    building its own lifecycle.
 *
 * The module also provides the factory {@link createTokenBudgeter} (and
 * {@link createBudgetAdapter}), which assemble the default wiring so callers do
 * not need to know the constructor order.
 *
 * The headline operations of the layer live here in their most ergonomic form:
 *
 * - {@link TokenBudgeter.allocate} — commit tokens to a section, honouring the
 *   overrun policy.
 * - {@link TokenBudgeter.estimate} — heuristic token count (`Math.ceil(len/4)`).
 * - {@link TokenBudgeter.fit} — estimate a text, and if it overruns its
 *   section's budget, truncate it to what the section can still afford.
 *
 * @module token-budgeting/integration
 */

import { BudgetLifecycle } from './lifecycle.js';
import { BudgetManager } from './retrieval.js';
import { TokenBudgetStore } from './store.js';
import { estimateTokens, mergeTokenBudgetConfig } from './types.js';
import type {
  BudgetAllocation,
  BudgetAvailability,
  BudgetCheck,
  BudgetOptions,
  BudgetStats,
  FitResult,
  SectionName,
  TokenBudgetConfig,
} from './types.js';

/**
 * The contract every budgeting facade implements.
 *
 * Consumers that want to stay decoupled from the concrete budgeter/adapter
 * should type against this interface.
 */
export interface TokenBudget {
  /**
   * Allocate tokens to a section, honouring the overrun policy.
   */
  allocate(section: SectionName, tokens: number, options?: BudgetOptions): BudgetAllocation;

  /**
   * Dry-run a prospective allocation without mutating state.
   */
  check(section: SectionName, tokens: number): BudgetCheck;

  /**
   * Heuristic token count for a piece of text (`Math.ceil(len / 4)`).
   */
  estimate(text: string): number;

  /**
   * Trim a piece of text to fit its section's remaining budget.
   */
  fit(text: string, section: SectionName): FitResult;

  /**
   * Remaining headroom, globally and per section.
   */
  available(): BudgetAvailability;
  available(section: SectionName): number;

  /**
   * Rolled-up totals for the whole budget table.
   */
  overall(): import('./retrieval.js').OverallTotals;

  /**
   * Aggregate counters for the budgeting subsystem.
   */
  stats(): BudgetStats;
}

/**
 * Construction options for a {@link TokenBudgeter}.
 */
export interface TokenBudgeterOptions {
  /**
   * When `true` (default), a {@link BudgetLifecycle} is created and
   * started alongside the store so the budget table is pruned periodically.
   * Set to `false` for short-lived or externally-managed processes.
   */
  readonly lifecycle?: boolean;

  /**
   * Maximum number of sections the lifecycle keeps before pruning (see
   * {@link BudgetLifecycleOptions.maxEntries}). Ignored when `lifecycle` is
   * `false`.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic lifecycle GC passes. Ignored
   * when `lifecycle` is `false`.
   */
  readonly gcIntervalMs?: number;

  /**
   * A pre-built store to drive. When omitted, a fresh store is constructed
   * from the configuration.
   */
  readonly store?: TokenBudgetStore;
}

/**
 * The high-level Token budgeting facade.
 *
 * {@link TokenBudgeter} is the object most consumers should construct. It wires
 * the whole layer together — store (accounting), manager (policy) and
 * lifecycle (housekeeping) — and adds the two text-oriented conveniences the
 * layer exists to serve: {@link TokenBudgeter.estimate} and
 * {@link TokenBudgeter.fit}.
 *
 * @example
 * ```ts
 * const budgeter = createTokenBudgeter({ overrunPolicy: 'trim' });
 * const tokens = budgeter.estimate('How do I migrate?');
 * const result = budgeter.fit(longKnowledgeDump, 'knowledge');
 * const allocation = budgeter.allocate('knowledge', result.tokens);
 * ```
 */
export class TokenBudgeter implements TokenBudget {
  /**
   * The underlying store (accounting).
   */
  readonly store: TokenBudgetStore;

  /**
   * The underlying manager (policy).
   */
  readonly manager: BudgetManager;

  /**
   * The lifecycle (housekeeping), or `null` when disabled.
   */
  readonly lifecycle: BudgetLifecycle | null;

  /**
   * Construct a budgeter.
   *
   * @param config - partial configuration, merged over the defaults
   * @param options - construction options (lifecycle toggle, store override)
   */
  constructor(
    config: Partial<TokenBudgetConfig> | undefined = undefined,
    options: TokenBudgeterOptions = {},
  ) {
    this.store = options.store ?? new TokenBudgetStore(config);
    this.manager = new BudgetManager(this.store, config);
    this.lifecycle = options.lifecycle === false ? null : new BudgetLifecycle(
      this.store,
      {
        maxEntries: options.maxEntries,
        intervalMs: options.gcIntervalMs,
      },
    );
    this.lifecycle?.start();
  }

  /**
   * Allocate tokens to a section, honouring the overrun policy.
   *
   * @param section - the section to allocate to
   * @param tokens - the number of tokens requested
   * @param options - per-call overrides (policy, reserve flag)
   * @returns a {@link BudgetAllocation} report
   */
  allocate(
    section: SectionName,
    tokens: number,
    options: BudgetOptions = {},
  ): BudgetAllocation {
    return this.manager.allocate(section, tokens, options);
  }

  /**
   * Dry-run a prospective allocation without mutating state.
   *
   * @param section - the section to check
   * @param tokens - the number of tokens being considered
   * @returns a {@link BudgetCheck} describing the outcome
   */
  check(section: SectionName, tokens: number): BudgetCheck {
    return this.manager.check(section, tokens);
  }

  /**
   * Heuristic token count for a piece of text.
   *
   * Uses the classic `Math.ceil(len / 4)` approximation — roughly four
   * characters per token for typical English prose. Cheap enough to call on
   * every prompt section during assembly.
   *
   * @param text - the text to estimate
   * @returns the estimated token count
   */
  estimate(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Trim a piece of text to fit its section's remaining budget.
   *
   * Estimates the text's token cost, checks it against the section's remaining
   * headroom, and when it overruns truncates the text to the longest prefix the
   * section can still afford. The truncation keeps a character-proportional
   * fraction of the original (so CJK-heavy text, which costs ~1 char/token,
   * is not over-cut), and always cuts at a word boundary when one can be found
   * cheaply.
   *
   * @param text - the text to fit
   * @param section - the section to fit it into
   * @returns a {@link FitResult} with the (possibly truncated) text
   */
  fit(text: string, section: SectionName): FitResult {
    const originalTokens = this.estimate(text);
    const check = this.check(section, originalTokens);
    if (!check.wouldExceed || check.remaining <= 0) {
      return {
        text,
        tokens: originalTokens,
        originalTokens,
        truncated: false,
        remaining: check.remaining,
        section,
      };
    }
    const available = Math.min(check.remaining, originalTokens);
    const ratio = available / originalTokens;
    let chars = Math.max(0, Math.floor(text.length * ratio));
    chars = Math.min(chars, text.length);
    let fitted = text.slice(0, chars);
    const boundary = fitted.lastIndexOf(' ');
    if (boundary > 0 && boundary > chars * 0.8) {
      fitted = fitted.slice(0, boundary);
    }
    const fittedTokens = this.estimate(fitted);
    const after = this.check(section, fittedTokens);
    return {
      text: fitted,
      tokens: fittedTokens,
      originalTokens,
      truncated: true,
      remaining: after.remaining,
      section,
    };
  }

  /**
   * Remaining headroom, globally and per section.
   *
   * @param section - optional section to narrow the answer to
   * @returns a {@link BudgetAvailability} summary, or a plain number when a
   *   section was given
   */
  available(): BudgetAvailability;
  available(section: SectionName): number;
  available(section?: SectionName): BudgetAvailability | number {
    return section === undefined
      ? (this.manager.available() as BudgetAvailability)
      : (this.manager.available(section) as number);
  }

  /**
   * Rolled-up totals for the whole budget table.
   *
   * @returns an {@link OverallTotals} snapshot
   */
  overall(): import('./retrieval.js').OverallTotals {
    return this.manager.overall();
  }

  /**
   * Aggregate counters for the budgeting subsystem.
   *
   * @returns a {@link BudgetStats} snapshot
   */
  stats(): BudgetStats {
    return this.manager.stats();
  }

  /**
   * Reset every section's usage to `0`.
   */
  reset(): void {
    this.manager.reset();
  }

  /**
   * Stop the lifecycle timer, if one is running.
   *
   * Idempotent; safe to call on budgeters built with `lifecycle: false`.
   */
  dispose(): void {
    this.lifecycle?.stop();
  }
}

/**
 * Construction options for a {@link BudgetAdapter}.
 */
export interface BudgetAdapterOptions {
  /**
   * A pre-built store to adapt. When omitted, a fresh store is constructed
   * from the configuration.
   */
  readonly store?: TokenBudgetStore;

  /**
   * A pre-built manager to adapt. When omitted, a fresh manager is
   * constructed over the store. If the store is also omitted, a fresh store
   * is built first.
   */
  readonly manager?: BudgetManager;

  /**
   * When `true` (default), a {@link BudgetLifecycle} is attached (but not
   * started — call {@link BudgetAdapter.lifecycle} to start it).
   */
  readonly lifecycle?: boolean;

  /**
   * Maximum number of sections the lifecycle keeps before pruning.
   */
  readonly maxEntries?: number;
}

/**
 * An alternate {@link TokenBudget} implementation that adapts an existing
 * store + manager pair.
 *
 * {@link BudgetAdapter} is for callers who already hold a
 * {@link TokenBudgetStore} (shared with the index or the lifecycle, say) and
 * want to expose the {@link TokenBudget} contract over it without constructing
 * a second, competing store. It implements the same interface as
 * {@link TokenBudgeter} — `allocate`, `estimate`, `fit`, `available`,
 * `overall`, `stats` — so the two can be swapped freely.
 *
 * @example
 * ```ts
 * const store = new TokenBudgetStore(config);
 * const adapter = new BudgetAdapter({ store, lifecycle: true });
 * adapter.lifecycle.start();
 * const fitted = adapter.fit(someText, 'tool');
 * ```
 */
export class BudgetAdapter implements TokenBudget {
  /**
   * The adapted store.
   */
  readonly store: TokenBudgetStore;

  /**
   * The adapted manager.
   */
  readonly manager: BudgetManager;

  /**
   * An attached lifecycle (not started), or `null` when disabled.
   */
  readonly lifecycle: BudgetLifecycle | null;

  /**
   * Construct an adapter.
   *
   * @param options - construction options (store/manager overrides, lifecycle
   *   toggle)
   * @param config - partial configuration used to build a store/manager when
   *   none is supplied
   */
  constructor(
    options: BudgetAdapterOptions = {},
    config: Partial<TokenBudgetConfig> | undefined = undefined,
  ) {
    this.store = options.store ?? new TokenBudgetStore(config);
    this.manager = options.manager ?? new BudgetManager(this.store, config);
    this.lifecycle =
      options.lifecycle === false
        ? null
        : new BudgetLifecycle(this.store, { maxEntries: options.maxEntries });
  }

  /**
   * Allocate tokens to a section, honouring the overrun policy.
   *
   * @param section - the section to allocate to
   * @param tokens - the number of tokens requested
   * @param options - per-call overrides
   * @returns a {@link BudgetAllocation} report
   */
  allocate(
    section: SectionName,
    tokens: number,
    options: BudgetOptions = {},
  ): BudgetAllocation {
    return this.manager.allocate(section, tokens, options);
  }

  /**
   * Dry-run a prospective allocation without mutating state.
   *
   * @param section - the section to check
   * @param tokens - the number of tokens being considered
   * @returns a {@link BudgetCheck} describing the outcome
   */
  check(section: SectionName, tokens: number): BudgetCheck {
    return this.manager.check(section, tokens);
  }

  /**
   * Heuristic token count for a piece of text.
   *
   * @param text - the text to estimate
   * @returns the estimated token count
   */
  estimate(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Trim a piece of text to fit its section's remaining budget.
   *
   * @param text - the text to fit
   * @param section - the section to fit it into
   * @returns a {@link FitResult} with the (possibly truncated) text
   */
  fit(text: string, section: SectionName): FitResult {
    const originalTokens = this.estimate(text);
    const check = this.check(section, originalTokens);
    if (!check.wouldExceed || check.remaining <= 0) {
      return {
        text,
        tokens: originalTokens,
        originalTokens,
        truncated: false,
        remaining: check.remaining,
        section,
      };
    }
    const available = Math.min(check.remaining, originalTokens);
    const ratio = available / originalTokens;
    const chars = Math.min(text.length, Math.max(0, Math.floor(text.length * ratio)));
    let fitted = text.slice(0, chars);
    const boundary = fitted.lastIndexOf(' ');
    if (boundary > 0 && boundary > chars * 0.8) {
      fitted = fitted.slice(0, boundary);
    }
    const fittedTokens = this.estimate(fitted);
    const after = this.check(section, fittedTokens);
    return {
      text: fitted,
      tokens: fittedTokens,
      originalTokens,
      truncated: true,
      remaining: after.remaining,
      section,
    };
  }

  /**
   * Remaining headroom, globally and per section.
   *
   * @param section - optional section to narrow the answer to
   * @returns a {@link BudgetAvailability} summary, or a plain number when a
   *   section was given
   */
  available(): BudgetAvailability;
  available(section: SectionName): number;
  available(section?: SectionName): BudgetAvailability | number {
    return section === undefined
      ? (this.manager.available() as BudgetAvailability)
      : (this.manager.available(section) as number);
  }

  /**
   * Rolled-up totals for the whole budget table.
   *
   * @returns an {@link OverallTotals} snapshot
   */
  overall(): import('./retrieval.js').OverallTotals {
    return this.manager.overall();
  }

  /**
   * Aggregate counters for the budgeting subsystem.
   *
   * @returns a {@link BudgetStats} snapshot
   */
  stats(): BudgetStats {
    return this.manager.stats();
  }

  /**
   * Reset every section's usage to `0`.
   */
  reset(): void {
    this.manager.reset();
  }
}

/**
 * The default effective configuration for a budgeter built without arguments.
 *
 * Pre-merged once so {@link createTokenBudgeter} and {@link createBudgetAdapter}
 * share identical defaults.
 */
const DEFAULT_CONFIG: TokenBudgetConfig = mergeTokenBudgetConfig(undefined);

/**
 * Assemble a high-level {@link TokenBudgeter} with default wiring.
 *
 * Creates a fresh store + manager + (started) lifecycle. Pass a partial config
 * to tune limits and policy.
 *
 * @param config - partial configuration, merged over the defaults
 * @param options - construction options (lifecycle toggle, store override)
 * @returns a ready-to-use {@link TokenBudgeter}
 */
export function createTokenBudgeter(
  config: Partial<TokenBudgetConfig> | undefined = undefined,
  options: TokenBudgeterOptions = {},
): TokenBudgeter {
  const resolved: TokenBudgetConfig = config
    ? mergeTokenBudgetConfig(config)
    : DEFAULT_CONFIG;
  return new TokenBudgeter(resolved, options);
}

/**
 * Assemble a {@link BudgetAdapter} over default (or supplied) wiring.
 *
 * @param config - partial configuration used when no store/manager is supplied
 * @param options - construction options (store/manager overrides, lifecycle
 *   toggle)
 * @returns a ready-to-use {@link BudgetAdapter}
 */
export function createBudgetAdapter(
  config: Partial<TokenBudgetConfig> | undefined = undefined,
  options: BudgetAdapterOptions = {},
): BudgetAdapter {
  const resolved: TokenBudgetConfig = config
    ? mergeTokenBudgetConfig(config)
    : DEFAULT_CONFIG;
  return new BudgetAdapter(options, resolved);
}
