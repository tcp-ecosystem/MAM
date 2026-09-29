/**
 * @file retrieval.ts
 * @module budgeting/retrieval
 *
 * {@link BudgetAllocator}: the policy engine of the budgeting layer.
 *
 * Where {@link AllocationStore} is a neutral ledger and {@link AllocationIndex}
 * is a read model, the allocator decides *what actually happens* when a
 * prompt section requests a slice of the token budget. It owns the
 * three core verbs:
 *
 *  - {@link check}/{@link project} — ask without committing;
 *  - {@link allocate} — commit, honouring the configured overrun policy
 *    (`'trim'` | `'reject'` | `'allow'`) and the global `maxTotal` ceiling;
 *  - {@link fit} — truncate a text payload down to a section's token budget
 *    at a word boundary, appending an ellipsis.
 *
 * The allocator composes a store (authoritative usage) with an index
 * (derived pressure) and keeps both in sync on every mutation. It performs
 * no I/O and holds no timers; long-lived supervision lives in the
 * {@link BudgetingLifecycle} (see `lifecycle.ts`).
 *
 * @packageDocumentation
 */

import { AllocationStore } from './store.js';
import { AllocationIndex, type IndexStatus } from './index.js';
import type {
  AllocationResult,
  AllocateOptions,
  BudgetConfig,
  BudgetSnapshot,
  BudgetStats,
  FitResult,
  SectionAllocation,
} from './types.js';
import {
  createAllocationResult,
  createFitResult,
  createSectionAllocation,
  emptyFitResult,
  normalizeBudgetConfig,
  sectionLimit,
  totalLimit,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Estimation heuristic
 * ------------------------------------------------------------------------ */

/**
 * Characters per token used by the estimator below. The de-facto industry
 * heuristic is ~4 characters per token for English prose; we keep it
 * constant so estimates are reproducible across the codebase.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Tokens reserved for the trailing ellipsis when {@link BudgetAllocator.fit}
 * has to truncate. Kept small so the trimmed text stays under budget.
 */
export const ELLIPSIS_TOKENS = 3;

/**
 * Token-estimation heuristic used by the allocator.
 *
 * Without a real tokenizer (this library has no external dependencies) we
 * estimate with `max(wordCount, ceil(charCount / 4))`. The word term makes
 * the estimate robust to long unbroken identifiers; the character term makes
 * it robust to heavily-punctuated text.
 *
 * @param text - the text to estimate.
 * @returns a non-negative integer token estimate.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byChars = Math.ceil(text.length / CHARS_PER_TOKEN);
  return Math.max(words, byChars);
}

/* ------------------------------------------------------------------------ *
 * Allocator
 * ------------------------------------------------------------------------ */

/**
 * Configuration for the allocator's internal index tuning.
 */
export interface AllocatorOptions {
  /** Absolute "near" margin in tokens (see {@link AllocationIndexOptions}). */
  nearThreshold?: number;
  /** Relative "near" margin as a fraction of each section's limit. */
  nearRatio?: number;
}

/**
 * Aggregate totals over the entire budget, mirroring a {@link BudgetSnapshot}
 * without the timestamp.
 */
export interface OverallTotals {
  /** Sum of every section's ceiling. */
  totalLimit: number;
  /** Sum of every section's consumption. */
  totalUsed: number;
  /** Sum of every section's reserve. */
  totalReserved: number;
  /** `totalLimit - totalUsed - totalReserved` (>= 0). */
  remaining: number;
  /** Number of tracked sections. */
  sections: number;
  /** Deep copies of every section allocation. */
  allocations: SectionAllocation[];
}

/**
 * The policy engine that grants, trims or rejects token requests.
 *
 * Construct with a partial {@link BudgetConfig}; the remainder is filled
 * from {@link DEFAULT_BUDGET_CONFIG}. Every public mutation keeps the
 * internal store and index consistent, so the allocator is safe to share
 * across the prompt-assembly pipeline.
 */
export class BudgetAllocator {
  /** Normalized (fully-populated) configuration. */
  private readonly _config: BudgetConfig;
  /** Authoritative usage ledger. */
  private readonly _store: AllocationStore;
  /** Derived pressure index. */
  private readonly _index: AllocationIndex;

  /**
   * Creates an allocator.
   *
   * @param config - partial budget config; merged over the defaults.
   * @param options - tuning for the internal pressure index.
   */
  constructor(config: Partial<BudgetConfig> = {}, options: AllocatorOptions = {}) {
    this._config = normalizeBudgetConfig(config);
    this._store = new AllocationStore(this._config.defaultLimit);
    this._index = new AllocationIndex({
      nearThreshold: options.nearThreshold,
      nearRatio: options.nearRatio,
    });
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The normalized configuration in force.
   */
  get config(): BudgetConfig {
    return this._config;
  }

  /**
   * The authoritative usage ledger (read access for observability).
   */
  get store(): AllocationStore {
    return this._store;
  }

  /**
   * The derived pressure index (read access for queries).
   */
  get index(): AllocationIndex {
    return this._index;
  }

  /**
   * Resolves the effective ceiling for `section` under the current config.
   */
  sectionLimit(section: string): number {
    return sectionLimit(this._config, section);
  }

  /**
   * The effective global ceiling, or `Infinity` when unset.
   */
  maxTotal(): number {
    return totalLimit(this._config);
  }

  /**
   * Current pressure classification for a section (or `undefined` if it has
   * never been allocated).
   */
  status(section: string): IndexStatus | undefined {
    return this._index.statusOf(section);
  }

  /* -------------------------------------------------------------------- *
   * Dry-run queries
   * -------------------------------------------------------------------- */

  /**
   * Returns `true` when committing `tokens` for `section` *would* exceed
   * either the section ceiling or the global `maxTotal` ceiling.
   *
   * This is a pure capacity question, independent of the overrun policy:
   * even under `'allow'`, a request that overshoots still "would exceed".
   *
   * @param section - the target section.
   * @param tokens - the proposed token count.
   */
  check(section: string, tokens: number): boolean {
    const amount = Math.max(0, Math.floor(tokens));
    const limit = this.sectionLimit(section);
    const used = this._store.used(section);
    const reserved = this._store.reserved(section);
    const wouldExceedSection = used + amount > limit;
    const maxTotal = this.maxTotal();
    const wouldExceedTotal = maxTotal !== Infinity && this._store.totalUsed() + amount > maxTotal;
    return wouldExceedSection || wouldExceedTotal;
  }

  /**
   * Inverse of {@link check}: `true` when the request fits within both the
   * section ceiling and the global ceiling.
   */
  fits(section: string, tokens: number): boolean {
    return !this.check(section, tokens);
  }

  /**
   * Computes the {@link AllocationResult} a request *would* produce without
   * mutating any state. Handy for preview UIs, "what-if" tooling and tests.
   *
   * Applies the exact same policy math as {@link allocate} but never touches
   * the store or index.
   */
  project(section: string, tokens: number, opts: AllocateOptions = {}): AllocationResult {
    const amount = Math.max(0, Math.floor(tokens));
    const limit = this.sectionLimit(section);
    const usedNow = this._store.used(section);
    const reservedNow = this._store.reserved(section);
    const remSection = Math.max(0, limit - usedNow - reservedNow);
    const totalNow = this._store.totalUsed();
    const maxTotal = this.maxTotal();
    const remTotal = maxTotal === Infinity ? Infinity : Math.max(0, maxTotal - totalNow);

    const policy = this._config.overrun;
    let granted = amount;
    let exceeded = false;
    let reason: string | undefined;

    if (policy === 'allow') {
      exceeded =
        usedNow + amount > limit ||
        (maxTotal !== Infinity && totalNow + amount > maxTotal);
      reason = exceeded ? 'allowed overrun' : undefined;
    } else if (policy === 'reject') {
      if (amount > remSection || (remTotal !== Infinity && amount > remTotal)) {
        granted = 0;
        exceeded = true;
        reason = 'rejected: exceeds ceiling';
      }
    } else {
      granted = Math.min(amount, remSection);
      if (remTotal !== Infinity) granted = Math.min(granted, remTotal);
      if (granted < amount) {
        exceeded = true;
        if (opts.allowPartial === false) {
          granted = 0;
          reason = 'rejected: partial not allowed';
        } else {
          reason = 'trimmed to fit';
        }
      }
    }

    const usedAfter = usedNow + granted;
    const remainingAfter = Math.max(0, limit - usedAfter - reservedNow);
    return createAllocationResult(section, granted, {
      used: usedAfter,
      remaining: remainingAfter,
      exceeded: exceeded || undefined,
      reason,
    });
  }

  /* -------------------------------------------------------------------- *
   * Mutating operations
   * -------------------------------------------------------------------- */

  /**
   * Commits a token request for `section`, applying the configured overrun
   * policy and the global `maxTotal` ceiling.
   *
   * Policy behaviour (see {@link OverrunPolicy}):
   *  - `'trim'`:   grants as much as fits (`granted < requested` when short);
   *                unless `opts.allowPartial === false`, in which case an
   *                overrun grants nothing.
   *  - `'reject'`: grants nothing when the request would exceed a ceiling.
   *  - `'allow'`:  grants the full request; overruns are flagged via
   *                `exceeded`.
   *
   * The store and the index are updated so subsequent reads are consistent.
   *
   * @param section - the section to allocate against.
   * @param tokens - the requested token count.
   * @param opts - options ({@link AllocateOptions}).
   * @returns the resulting {@link AllocationResult}.
   */
  allocate(section: string, tokens: number, opts: AllocateOptions = {}): AllocationResult {
    const result = this.project(section, tokens, opts);
    this._commit(section, result);
    return result;
  }

  /**
   * Frees tokens back to a section's allowance. Returns the number of
   * tokens actually released.
   */
  release(section: string, tokens: number): number {
    const released = this._store.release(section, tokens);
    const record = this._store.get(section);
    if (record) this._index.indexAllocation(record);
    return released;
  }

  /**
   * Sets the reserved headroom for a section (see
   * {@link SectionAllocation.reserved}). Reserved tokens are excluded from
   * "remaining", guaranteeing the section a floor.
   */
  reserve(section: string, amount: number): SectionAllocation | undefined {
    const record = this._store.reserve(section, amount);
    if (record) this._index.indexAllocation(record);
    return record;
  }

  /**
   * Trims `text` so it fits within a token budget for `section`.
   *
   * When the estimated size of `text` already fits, it is returned whole
   * (`truncated: false`, status `'full'`). Otherwise the text is cut at the
   * last word boundary that keeps it within budget, a `'…'` ellipsis is
   * appended, and the result is re-estimated to confirm the ceiling held.
   *
   * The trim honours {@link ELLIPSIS_TOKENS} of headroom for the ellipsis.
   *
   * @param text - the source text.
   * @param section - the section whose budget governs the trim (used for the
   *   resulting record metadata).
   * @param tokens - the maximum token budget for the returned text.
   * @returns a {@link FitResult}.
   */
  fit(text: string, section: string, tokens: number): FitResult {
    const budget = Math.max(0, Math.floor(tokens));
    const limit = this.sectionLimit(section);
    const source = typeof text === 'string' ? text : '';

    if (source.length === 0) return emptyFitResult(section, limit, source);
    if (estimateTokens(source) <= budget) {
      return createFitResult({
        section,
        sourceText: source,
        text: source,
        truncated: false,
        status: 'full',
        limit,
        usedTokens: estimateTokens(source),
        remaining: Math.max(0, budget - estimateTokens(source)),
      });
    }

    const effectiveBudget = Math.max(0, budget - ELLIPSIS_TOKENS);
    if (effectiveBudget === 0) return emptyFitResult(section, limit, source);

    let trimmed = this._truncateAtBoundary(source, effectiveBudget * CHARS_PER_TOKEN);
    let guard = 0;
    while (trimmed.length > 0 && estimateTokens(trimmed + '…') > budget && guard < 1000) {
      trimmed = this._truncateAtBoundary(trimmed, Math.floor(trimmed.length * 0.9));
      guard += 1;
    }
    const resultText = trimmed.length > 0 ? `${trimmed}…` : '';
    if (resultText.length === 0) return emptyFitResult(section, limit, source);
    const usedTokens = estimateTokens(resultText);
    return createFitResult({
      section,
      sourceText: source,
      text: resultText,
      truncated: true,
      status: 'trimmed',
      limit,
      usedTokens,
      remaining: Math.max(0, budget - usedTokens),
    });
  }

  /**
   * Returns `true` when `text` fits within `budget` tokens without trimming.
   */
  fitsText(text: string, budget: number): boolean {
    return estimateTokens(text) <= Math.max(0, Math.floor(budget));
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Overall totals across every tracked section.
   */
  overall(): OverallTotals {
    const stats = this._store.stats();
    return {
      totalLimit: stats.totalLimit,
      totalUsed: stats.totalUsed,
      totalReserved: stats.totalReserved,
      remaining: stats.remaining,
      sections: stats.sections,
      allocations: this._store.values(),
    };
  }

  /**
   * Headroom left across the whole budget (`available()` = `overall().remaining`).
   * Returns `Infinity` when nothing is tracked yet and no global ceiling
   * limits it.
   */
  available(): number {
    if (this._store.size === 0) return this.maxTotal();
    return this.overall().remaining;
  }

  /**
   * Per-section detail record.
   */
  sectionUsage(section: string): {
    section: string;
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
    ratio: number;
    status: IndexStatus | undefined;
  } {
    const limit = this.sectionLimit(section);
    const used = this._store.used(section);
    const reserved = this._store.reserved(section);
    const remaining = this._store.remaining(section);
    const ratio = limit > 0 ? used / limit : 0;
    return {
      section,
      limit,
      used,
      reserved,
      remaining: Number.isFinite(remaining) ? remaining : limit,
      ratio,
      status: this._index.statusOf(section),
    };
  }

  /**
   * Captures an immutable {@link BudgetSnapshot} of the current state.
   */
  snapshot(): BudgetSnapshot {
    return this._store.snapshot();
  }

  /**
   * Derives {@link BudgetStats} over the current state.
   */
  stats(): BudgetStats {
    return this._store.stats();
  }

  /**
   * Clears every allocation and index entry, returning the allocator to its
   * initial (empty) state. Configuration is preserved.
   */
  reset(): this {
    this._store.clear();
    this._index.clear();
    return this;
  }

  /**
   * Re-syncs the index from the store. Call this if the store was mutated
   * directly (e.g. via {@link AllocationStore.set}) so derived statuses
   * reflect the latest records.
   */
  reindex(): this {
    this._index.rebuild(this._store.values());
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Applies a projected result to the store and index.
   */
  private _commit(section: string, result: AllocationResult): void {
    if (!this._store.has(section)) {
      this._store.set(createSectionAllocation(section, this.sectionLimit(section)));
    }
    this._store.apply(result);
    const record = this._store.get(section);
    if (record) this._index.indexAllocation(record);
  }

  /**
   * Truncates `text` to at most `maxChars` code units, cutting at the last
   * whitespace boundary strictly below `maxChars`.
   */
  private _truncateAtBoundary(text: string, maxChars: number): string {
    const safeMax = Math.max(0, Math.floor(maxChars));
    if (text.length <= safeMax) return text;
    let cut = safeMax;
    while (cut > 0 && !/\s/.test(text[cut - 1]!)) cut -= 1;
    if (cut === 0) cut = safeMax;
    return text.slice(0, cut).trimEnd();
  }
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createAllocator(
  config: Partial<BudgetConfig> = {},
  options: AllocatorOptions = {},
): BudgetAllocator {
  return new BudgetAllocator(config, options);
}