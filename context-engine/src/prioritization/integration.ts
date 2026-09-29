/**
 * High-level integration facade for the **Prioritization** layer of the
 * standalone MAM Context Engine.
 *
 * {@link Prioritizer} is the entry point most callers of the layer actually
 * touch. It composes the four internal pieces — {@link PriorityScorer} (the
 * pure scoring math), {@link PriorityStore} (the score cache),
 * {@link PriorityIndex} (the score-bucket/role index) and
 * {@link PriorityLifecycle} (the housekeeping) — behind a small, ergonomic
 * surface:
 *
 * - {@link Prioritizer.run} — score a batch of parts, cache the scores, mirror
 *   them into the index, and return ranked {@link PriorityEntry}s.
 * - {@link Prioritizer.best} — return the top `k` parts (sugar over `run`).
 * - {@link Prioritizer.fitBudget} — return the best parts that fit a token
 *   budget (sugar over `run` + the scorer's `withinBudget`).
 *
 * Because {@link Prioritizer} keeps a store and an index, repeated calls with
 * overlapping parts reuse cached scores instead of recomputing them: the scorer
 * is only consulted for parts that are new or whose score changed. Callers who
 * want the pure math with zero state can bypass the facade entirely and use
 * {@link PriorityScorer} directly.
 *
 * The facade also exposes {@link createPrioritizer} (a config-first factory)
 * and {@link PrioritizationAdapter}, a structural adapter that wraps any
 * object satisfying the {@link PrioritizerInterface} so consumers can code
 * against a stable interface rather than the concrete class.
 *
 * @module prioritization/integration
 */

import {
  defaultPrioritizationConfig,
  estimateTokens,
} from './types.js';
import type {
  ContextPart,
  PrioritizationConfig,
  PrioritizationStats,
  PrioritizeOptions,
  PriorityEntry,
  PriorityScore,
  PriorityState,
} from './types.js';
import { PriorityScorer } from './retrieval.js';
import { PriorityStore } from './store.js';
import { PriorityIndex } from './index.js';
import { PriorityLifecycle } from './lifecycle.js';

/**
 * The stable contract a prioritization component satisfies.
 *
 * Defined as a structural interface (not a class) so that {@link Prioritizer}
 * *and* any hand-rolled or wrapped implementation can be passed to consumers
 * that only need ranking — this is what makes {@link PrioritizationAdapter}
 * possible and keeps the layer's public surface small.
 */
export interface PrioritizerInterface {
  /**
   * Score a batch of parts and return ranked entries, best first.
   *
   * @param parts - the parts to rank
   * @param options - per-call overrides (query, keywords, weights, clock)
   * @returns ranked entries, best first
   */
  run(
    parts: readonly ContextPart[],
    options?: PrioritizeOptions,
  ): Promise<PriorityEntry[]> | PriorityEntry[];

  /**
   * Return the best `k` entries.
   *
   * @param parts - the parts to rank
   * @param k - how many to return
   * @param options - per-call overrides
   * @returns the best `k` entries
   */
  best(
    parts: readonly ContextPart[],
    k: number,
    options?: PrioritizeOptions,
  ): Promise<PriorityEntry[]> | PriorityEntry[];

  /**
   * Return the best entries that fit within a token budget.
   *
   * @param parts - the parts to rank
   * @param budgetTokens - the token ceiling
   * @param options - per-call overrides
   * @returns the budget-fitting entries, best first
   */
  fitBudget(
    parts: readonly ContextPart[],
    budgetTokens: number,
    options?: PrioritizeOptions,
  ): Promise<PriorityEntry[]> | PriorityEntry[];
}

/**
 * Construction options for a {@link Prioritizer}.
 */
export interface PrioritizerOptions {
  /**
   * Base {@link PrioritizationConfig} used for scoring. Defaults to
   * {@link defaultPrioritizationConfig}. Per-call
   * {@link PrioritizeOptions.overrides} are merged on top at call time.
   */
  readonly config?: PrioritizationConfig;

  /**
   * Maximum score-cache entries before the lowest scorers are evicted.
   * Passed through to the internal {@link PriorityStore} and
   * {@link PriorityLifecycle}. `0` (default) keeps the cache unbounded.
   */
  readonly maxEntries?: number;

  /**
   * Clock used for all timestamps and recency. Injecting a clock makes the
   * whole facade deterministic under test.
   */
  readonly now?: () => number;

  /**
   * Whether the internal lifecycle should prune on a timer. Defaults to
   * `true`.
   */
  readonly autoStart?: boolean;
}

/**
 * The high-level integration facade for the Prioritization layer.
 *
 * @example
 * ```ts
 * const prioritizer = new Prioritizer({ config: { boostKeywords: ['deadline'] } });
 * const entries = prioritizer.best(parts, 3, { query: 'onboarding' });
 * const fitted = prioritizer.fitBudget(parts, 2048, { query: 'onboarding' });
 * ```
 */
export class Prioritizer implements PrioritizerInterface {
  /** The pure scoring engine. */
  private readonly _scorer: PriorityScorer;

  /** The score cache. */
  private readonly _store: PriorityStore;

  /** The score-bucket / role index mirroring the cache. */
  private readonly _index: PriorityIndex;

  /** The lifecycle manager. */
  private readonly _lifecycle: PriorityLifecycle;

  /**
   * @param options - construction options
   */
  constructor(options: PrioritizerOptions = {}) {
    const config: PrioritizationConfig = options.config
      ? { ...defaultPrioritizationConfig(), ...options.config }
      : defaultPrioritizationConfig();

    this._scorer = new PriorityScorer({ config });
    this._store = new PriorityStore({
      maxEntries: options.maxEntries ?? 0,
      now: options.now,
    });
    this._index = new PriorityIndex({ now: options.now });
    this._lifecycle = new PriorityLifecycle({
      store: this._store,
      maxEntries: options.maxEntries ?? 0,
      now: options.now,
      autoStart: options.autoStart ?? true,
    });

    this._store.on('put', (event: { partId: string }) => {
      const score = this._store.get(event.partId);
      if (score) this._index.indexEntry(score);
    });
    this._store.on('delete', (event: { partId: string }) => {
      this._index.removeEntry(event.partId);
    });
    this._store.on('clear', () => {
      this._index.clear();
    });
  }

  /**
   * The underlying score cache, exposed for introspection and persistence.
   */
  get store(): PriorityStore {
    return this._store;
  }

  /**
   * The underlying score-bucket / role index, exposed for introspection.
   */
  get index(): PriorityIndex {
    return this._index;
  }

  /**
   * The underlying lifecycle manager, exposed for manual pruning control.
   */
  get lifecycle(): PriorityLifecycle {
    return this._lifecycle;
  }

  /**
   * The underlying pure scorer, exposed for callers that want un-cached math.
   */
  get scorer(): PriorityScorer {
    return this._scorer;
  }

  /**
   * Score a batch of parts, cache the results, and return ranked entries.
   *
   * For each part, the cached score is reused when present; otherwise the part
   * is scored by the {@link PriorityScorer} and cached. All results are then
   * ranked best-first and returned as {@link PriorityEntry}s (part + score).
   *
   * @param parts - the parts to rank
   * @param options - per-call overrides
   * @returns ranked entries, best first
   */
  run(
    parts: readonly ContextPart[],
    options: PrioritizeOptions = {},
  ): PriorityEntry[] {
    const scores = this._scoreAll(parts, options);
    scores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0;
    });
    for (let i = 0; i < scores.length; i += 1) {
      scores[i] = { ...scores[i], rank: i + 1 };
    }

    const byId = new Map<string, ContextPart>();
    for (const part of parts) byId.set(part.partId, part);

    const entries: PriorityEntry[] = [];
    for (const score of scores) {
      const part = byId.get(score.partId);
      if (part) entries.push({ part, score });
    }
    return entries;
  }

  /**
   * Return the best `k` entries.
   *
   * @param parts - the parts to rank
   * @param k - how many to return; `<= 0` returns an empty list
   * @param options - per-call overrides
   * @returns the best `k` entries
   */
  best(
    parts: readonly ContextPart[],
    k: number,
    options: PrioritizeOptions = {},
  ): PriorityEntry[] {
    const ranked = this.run(parts, options);
    return k <= 0 ? [] : ranked.slice(0, k);
  }

  /**
   * Return the best entries that fit within a token budget.
   *
   * Ranks all parts, then greedily takes the best parts whose estimated token
   * size fits within `budgetTokens`. Selected entries are returned best-first.
   *
   * @param parts - the parts to rank
   * @param budgetTokens - the token ceiling
   * @param options - per-call overrides
   * @returns the budget-fitting entries, best first
   */
  fitBudget(
    parts: readonly ContextPart[],
    budgetTokens: number,
    options: PrioritizeOptions = {},
  ): PriorityEntry[] {
    const ranked = this.run(parts, options);
    const byId = new Map<string, ContextPart>();
    for (const part of parts) byId.set(part.partId, part);

    const budget = Math.max(0, budgetTokens);
    const selected: PriorityEntry[] = [];
    let used = 0;
    for (const entry of ranked) {
      const tokens = estimateTokens(entry.part.content);
      if (used + tokens <= budget) {
        selected.push(entry);
        used += tokens;
      }
    }
    return selected;
  }

  /**
   * Roll the whole facade up into a {@link PrioritizationStats} report.
   *
   * Combines the store's cache statistics with the index's bucket/role shape
   * into one view.
   *
   * @returns the aggregate statistics
   */
  stats(): PrioritizationStats {
    return this._store.stats();
  }

  /**
   * Persist the score cache as a serialisable snapshot.
   *
   * @returns the store snapshot
   */
  toJSON(): PriorityState {
    return this._store.toJSON();
  }

  /**
   * Restore the score cache from a snapshot.
   *
   * @param state - the snapshot to restore
   * @returns the number of entries restored
   */
  fromJSON(state: PriorityState): number {
    return this._store.fromJSON(state);
  }

  /**
   * Score every part that is not already cached, reusing cached scores
   * otherwise.
   *
   * @param parts - the parts to ensure are scored
   * @param options - per-call overrides
   * @returns one score per distinct part id
   */
  private _scoreAll(
    parts: readonly ContextPart[],
    options: PrioritizeOptions,
  ): PriorityScore[] {
    const out: PriorityScore[] = [];
    for (const part of parts) {
      const cached = this._store.get(part.partId);
      if (cached) {
        out.push(cached);
      } else {
        const score = this._scorer.scorePart(part, options.query, options);
        this._store.put(score);
        out.push(score);
      }
    }
    return out;
  }
}

/**
 * Create a {@link Prioritizer} from a config-first factory call.
 *
 * @param config - base scoring config; merged over the defaults
 * @returns a fully wired {@link Prioritizer}
 */
export function createPrioritizer(
  config: PrioritizationConfig = {},
): Prioritizer {
  return new Prioritizer({ config });
}

/**
 * A structural adapter that exposes any {@link PrioritizerInterface} as a
 * {@link PrioritizerInterface}-conformant object.
 *
 * Useful when a consumer holds an object that already satisfies the interface
 * (a wrapped implementation, a mock, a proxied instance) and wants a stable,
 * typed handle to it without re-implementing the interface. The adapter simply
 * forwards each call to the wrapped object.
 */
export class PrioritizationAdapter implements PrioritizerInterface {
  /** The wrapped implementation. */
  private readonly _delegate: PrioritizerInterface;

  /**
   * @param delegate - the object to adapt; must satisfy
   * {@link PrioritizerInterface}
   */
  constructor(delegate: PrioritizerInterface) {
    this._delegate = delegate;
  }

  /**
   * The wrapped implementation.
   */
  get delegate(): PrioritizerInterface {
    return this._delegate;
  }

  /**
   * @inheritDoc
   */
  run(
    parts: readonly ContextPart[],
    options: PrioritizeOptions = {},
  ): PriorityEntry[] | Promise<PriorityEntry[]> {
    return this._delegate.run(parts, options);
  }

  /**
   * @inheritDoc
   */
  best(
    parts: readonly ContextPart[],
    k: number,
    options: PrioritizeOptions = {},
  ): PriorityEntry[] | Promise<PriorityEntry[]> {
    return this._delegate.best(parts, k, options);
  }

  /**
   * @inheritDoc
   */
  fitBudget(
    parts: readonly ContextPart[],
    budgetTokens: number,
    options: PrioritizeOptions = {},
  ): PriorityEntry[] | Promise<PriorityEntry[]> {
    return this._delegate.fitBudget(parts, budgetTokens, options);
  }
}