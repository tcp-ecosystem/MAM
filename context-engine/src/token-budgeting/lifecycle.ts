/**
 * Lifecycle management for the Token budgeting layer of the standalone MAM
 * Context Engine.
 *
 * {@link TokenBudgetLifecycle} keeps a long-running process's budget table
 * *bounded and tidy*. Left alone, a budget store grows a section entry for
 * every name that ever touched it; over a long-lived server that can mean
 * hundreds of near-empty sections. The lifecycle's job is to periodically
 * sweep that table, prune the least-important sections, reset exhausted ones,
 * and keep counters fresh — all while surfacing what it did via events.
 *
 * Responsibilities:
 *
 * - **Prune** — {@link TokenBudgetLifecycle.prune} removes the least-used
 *   sections once the table exceeds {@link TokenBudgetLifecycle.maxEntries},
 *   preserving the sections that actually carry tokens.
 * - **Reset** — {@link TokenBudgetLifecycle.resetSection} zeroes a single
 *   section's usage; {@link TokenBudgetLifecycle.reset} zeroes every section.
 * - **Run** — {@link TokenBudgetLifecycle.start} / {@link TokenBudgetLifecycle
 *   .stop} run a periodic GC pass on a timer; {@link TokenBudgetLifecycle
 *   .tick} performs a single manual pass for tests and one-off invocations.
 * - **Observe** — the lifecycle re-emits the store's `'allocated'`,
 *   `'released'`, `'reserved'`, `'overrun'` and `'reset'` events and adds its
 *   own `'prune'` event, so a single listener can observe the whole subsystem.
 * - **Inspect** — {@link TokenBudgetLifecycle.stats} merges the store's
 *   counters with the lifecycle's own (prunes performed, running state).
 *
 * The lifecycle extends `node:events`' `EventEmitter`. Wiring to the store's
 * events happens in the constructor, so callers get forwarded events for free
 * and need not listen to both objects.
 *
 * @module token-budgeting/lifecycle
 */

import { EventEmitter } from 'node:events';

import { TokenBudgetStore } from './store.js';
import type { BudgetEventPayload } from './store.js';
import {
  DEFAULT_GC_INTERVAL_MS,
  DEFAULT_MAX_SECTIONS,
  clampTokens,
  remainingTokens,
} from './types.js';
import type {
  BudgetStats,
  SectionName,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link TokenBudgetLifecycle}.
 */
export interface BudgetLifecycleOptions {
  /**
   * Maximum number of sections kept before {@link TokenBudgetLifecycle.prune}
   * starts removing the least-used ones. Defaults to
   * {@link DEFAULT_MAX_SECTIONS} (`64`). `0` disables the cap entirely.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic GC passes while running.
   * Defaults to {@link DEFAULT_GC_INTERVAL_MS} (`60_000`).
   */
  readonly intervalMs?: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the lifecycle
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The lifecycle's own statistics, merged with the store's.
 */
export interface LifecycleStats extends BudgetStats {
  /**
   * Number of sections removed by pruning since construction.
   */
  readonly pruned: number;

  /**
   * Number of GC passes performed (manual {@link TokenBudgetLifecycle.tick}
   * calls plus automatic timer ticks) since construction.
   */
  readonly passes: number;

  /**
   * `true` when the periodic GC timer is currently running.
   */
  readonly running: boolean;

  /**
   * Interval in milliseconds between automatic GC passes.
   */
  readonly intervalMs: number;
}

/**
 * Payload emitted by the lifecycle's `'prune'` event.
 */
export interface PruneEvent {
  /**
   * Epoch-millisecond time the prune ran.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of sections removed.
   */
  readonly removed: number;

  /**
   * Names of the sections that were removed.
   */
  readonly sections: readonly SectionName[];
}

/**
 * The budget lifecycle manager.
 *
 * See the module documentation for the full responsibility list. The lifecycle
 * observes a single {@link TokenBudgetStore}; all pruning/reset operations are
 * applied through the store so it remains the single source of truth.
 *
 * @example
 * ```ts
 * const lifecycle = new BudgetLifecycle(store, { maxEntries: 32 });
 * lifecycle.on('prune', (e) => log(`pruned ${e.removed} sections`));
 * lifecycle.start();          // periodic GC every 60s
 * lifecycle.stop();
 * ```
 */
export class BudgetLifecycle extends EventEmitter {
  /**
   * The store this lifecycle manages.
   */
  readonly store: TokenBudgetStore;

  /**
   * Maximum number of sections kept before pruning starts (`0` = unbounded).
   */
  readonly maxEntries: number;

  /**
   * Interval in milliseconds between automatic GC passes.
   */
  readonly intervalMs: number;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * The active GC timer handle, or `null` while stopped.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Number of sections removed by pruning since construction.
   */
  private prunedCount = 0;

  /**
   * Number of GC passes performed since construction.
   */
  private passCount = 0;

  /**
   * Construct a lifecycle over a store.
   *
   * The constructor wires store-event forwarding, so the lifecycle mirrors the
   * store's `'allocated'`, `'released'`, `'reserved'`, `'overrun'` and
   * `'reset'` events under the same names.
   *
   * @param store - the store to manage
   * @param options - construction options
   */
  constructor(store: TokenBudgetStore, options: BudgetLifecycleOptions = {}) {
    super();
    this.store = store;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_SECTIONS;
    this.intervalMs = options.intervalMs ?? DEFAULT_GC_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.forwardStoreEvents();
  }

  /**
   * Forward the store's budget events under the same names.
   *
   * This keeps the lifecycle the natural single listening point: consumers
   * attach once here instead of wiring both the store and the lifecycle.
   */
  private forwardStoreEvents(): void {
    const events = ['allocated', 'released', 'reserved', 'overrun', 'reset'] as const;
    for (const event of events) {
      this.store.on(event, (payload: BudgetEventPayload) => {
        this.emit(event, payload);
      });
    }
  }

  /**
   * Start the periodic GC timer.
   *
   * Repeated calls are idempotent: if the lifecycle is already running the
   * existing timer is left untouched (a different interval restarts it).
   * Each pass runs {@link TokenBudgetLifecycle.tick}.
   *
   * @param intervalMs - optional override of the configured interval
   * @returns `this`, for chaining
   */
  start(intervalMs?: number): this {
    const resolved = intervalMs && intervalMs > 0 ? intervalMs : this.intervalMs;
    if (this.timer) {
      return this;
    }
    this.timer = setInterval(() => {
      this.tick();
    }, resolved);
    return this;
  }

  /**
   * Stop the periodic GC timer.
   *
   * Idempotent; safe to call when not running.
   *
   * @returns `this`, for chaining
   */
  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  /**
   * `true` while the periodic GC timer is running.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Run a single GC pass.
   *
   * Performs, in order: {@link BudgetLifecycle.prune} (bounded table) and
   * {@link BudgetLifecycle.pruneOverloaded} (reset sections that overshot
   * their limits), then bumps the pass counter. Safe to call manually for
   * tests and one-off cleanups.
   *
   * @returns the number of sections removed/reset by this pass
   */
  tick(): number {
    let changed = 0;
    if (this.maxEntries > 0) {
      changed += this.prune(this.maxEntries);
    }
    changed += this.pruneOverloaded();
    this.passCount += 1;
    return changed;
  }

  /**
   * Remove the least-used sections once the table exceeds `maxEntries`.
   *
   * Sections are ranked by *ascending* usage — least-used first — so the
   * sections that actually carry tokens survive. Ties are broken by
   * `reserved` (less reserved dies first) and then insertion order. Emits a
   * `'prune'` event describing what was removed.
   *
   * @param maxEntries - the maximum table size to enforce (clamped to a
   *   non-negative integer; `0` is a no-op)
   * @returns the number of sections removed
   */
  prune(maxEntries: number): number {
    const cap = clampTokens(maxEntries);
    if (cap === 0) {
      return 0;
    }
    const entries = this.store.entries();
    if (entries.length <= cap) {
      return 0;
    }
    const excess = entries.length - cap;
    entries.sort((a, b) => {
      const usedDiff = a[1].used - b[1].used;
      if (usedDiff !== 0) {
        return usedDiff;
      }
      return a[1].reserved - b[1].reserved;
    });
    const doomed = entries.slice(0, excess);
    for (const [section] of doomed) {
      this.store.delete(section);
    }
    this.prunedCount += doomed.length;
    const at = this.now();
    this.emit('prune', {
      timestamp: at,
      removed: doomed.length,
      sections: doomed.map(([section]) => section),
    } satisfies PruneEvent);
    return doomed.length;
  }

  /**
   * Reset every section that is currently over its limit.
   *
   * An overloaded section (possible only under the `'allow'` policy) is reset
   * to `used = 0` rather than left to linger. Reports each reset via the
   * store's `'reset'` event.
   *
   * @returns the number of sections reset
   */
  pruneOverloaded(): number {
    const overloaded = this.store.overloaded();
    for (const section of overloaded) {
      this.store.resetSection(section);
    }
    return overloaded.length;
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
   * Reset every section's usage to `0`.
   */
  reset(): void {
    this.store.reset();
  }

  /**
   * Merge the store's counters with the lifecycle's own.
   *
   * @returns a {@link LifecycleStats} snapshot
   */
  stats(): LifecycleStats {
    const storeStats = this.store.stats();
    return {
      ...storeStats,
      pruned: this.prunedCount,
      passes: this.passCount,
      running: this.running,
      intervalMs: this.intervalMs,
    };
  }

  /**
   * The names of the least-used sections, in prune order.
   *
   * Useful for callers that want to inspect *which* sections a prune would
   * remove before committing to it.
   *
   * @returns the sections sorted by ascending usage, then reserved
   */
  pruneCandidates(): SectionName[] {
    const entries = this.store.entries();
    entries.sort((a, b) => {
      const usedDiff = a[1].used - b[1].used;
      if (usedDiff !== 0) {
        return usedDiff;
      }
      return a[1].reserved - b[1].reserved;
    });
    return entries.map(([section]) => section);
  }

  /**
   * The sections currently over their limits (delegated to the store).
   *
   * @returns the overloaded section names
   */
  overloaded(): SectionName[] {
    return this.store.overloaded();
  }

  /**
   * Whether a section has any tokens that a prune would consider "safe to
   * drop" — used or reserved.
   *
   * @param section - the section to inspect
   * @returns `true` when the section has no used or reserved tokens
   */
  isIdle(section: SectionName): boolean {
    return remainingTokens(this.store.get(section)) >= this.store.limit(section);
  }
}