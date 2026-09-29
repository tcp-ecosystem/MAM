/**
 * @file lifecycle.ts
 * @module budgeting/lifecycle
 *
 * {@link BudgetingLifecycle}: the supervisory shell around the budgeting
 * engine.
 *
 * The allocator ({@link BudgetAllocator}, `retrieval.ts`) is a pure,
 * stateless-at-rest policy engine: it grants, trims and rejects on demand.
 * The lifecycle adds the operational concerns that a long-lived service
 * needs:
 *
 *  - **Events** — `allocated`, `trimmed`, `overrun`, `snapshot`, `pruned`,
 *    `reset` and `resetSection`, delivered on a typed {@link EventEmitter}.
 *  - **Periodic snapshots** — {@link start}/{@link stop} run a timer that
 *    captures immutable {@link BudgetSnapshot}s and retains a bounded ring
 *    buffer for observability.
 *  - **Housekeeping** — {@link prune} drops idle (zero-used) sections,
 *    {@link resetSection} resets one section, {@link reset} clears
 *    everything.
 *
 * The lifecycle is the only budgeting entry point that should be constructed
 * once and shared process-wide.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';

import { BudgetAllocator, type AllocatorOptions } from './retrieval.js';
import type {
  AllocationResult,
  AllocateOptions,
  BudgetConfig,
  BudgetSnapshot,
  BudgetStats,
  FitResult,
  SectionAllocation,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------ */

/**
 * Event names emitted by {@link BudgetingLifecycle}. Import this object to
 * subscribe without string literals.
 */
export const BUDGET_EVENTS = {
  /** Emitted after a successful (or partially successful) allocation. */
  allocated: 'allocated',
  /** Emitted when {@link BudgetingLifecycle.fit} had to truncate text. */
  trimmed: 'trimmed',
  /** Emitted when an allocation exceeded a ceiling (trim or reject). */
  overrun: 'overrun',
  /** Emitted on every periodic snapshot tick. */
  snapshot: 'snapshot',
  /** Emitted after {@link BudgetingLifecycle.prune} ran. */
  pruned: 'pruned',
  /** Emitted after {@link BudgetingLifecycle.reset}. */
  reset: 'reset',
  /** Emitted after a single section is reset. */
  resetSection: 'resetSection',
} as const;

/**
 * Number of historical snapshots retained by the ring buffer.
 */
export const MAX_SNAPSHOTS = 32;

/**
 * Default periodic snapshot interval (milliseconds).
 */
export const DEFAULT_INTERVAL_MS = 5_000;

/* ------------------------------------------------------------------------ *
 * Typed event map
 * ------------------------------------------------------------------------ */

/**
 * Typed event payloads. Each key maps to the argument tuple emitted for that
 * event, giving subscribers full type-safety via `on(...)`.
 */
export interface BudgetingLifecycleEvents {
  /** {@link AllocationResult} of the completed allocation. */
  allocated: [result: AllocationResult];
  /** {@link FitResult} of the (truncated) trim. */
  trimmed: [result: FitResult];
  /** {@link AllocationResult} that exceeded a ceiling. */
  overrun: [result: AllocationResult];
  /** {@link BudgetSnapshot} captured on the periodic tick. */
  snapshot: [snapshot: BudgetSnapshot];
  /** Summary returned by {@link BudgetingLifecycle.prune}. */
  pruned: [summary: { removed: number; sections: number }];
  /** The (now empty) allocator instance after a full reset. */
  reset: [allocator: BudgetAllocator];
  /** The section allocation, freshly zeroed. */
  resetSection: [allocation: SectionAllocation];
}

/**
 * Result of a {@link BudgetingLifecycle.prune} run.
 */
export interface PruneSummary {
  /** Number of idle sections removed. */
  removed: number;
  /** Number of sections remaining afterwards. */
  sections: number;
}

/**
 * Constructor options for {@link BudgetingLifecycle}.
 */
export interface LifecycleOptions extends AllocatorOptions {
  /** Optional initial periodic snapshot interval. */
  snapshotIntervalMs?: number;
  /** When `true`, the periodic timer starts immediately in the constructor. */
  autoStart?: boolean;
}

/* ------------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------------ */

/**
 * Supervisory shell that wraps a {@link BudgetAllocator} with events,
 * periodic snapshots and housekeeping.
 *
 * Usage:
 * ```ts
 * const lifecycle = new BudgetingLifecycle({ overrun: 'trim' });
 * lifecycle.on('overrun', (result) => logger.warn('overrun', result));
 * lifecycle.allocate('user', 900);
 * lifecycle.start(10_000); // snapshot every 10s
 * ```
 */
export class BudgetingLifecycle extends EventEmitter {
  /** The underlying policy engine. */
  private readonly _allocator: BudgetAllocator;
  /** Periodic snapshot timer handle (`null` when stopped). */
  private _timer: NodeJS.Timeout | null;
  /** Ring buffer of recent snapshots (oldest first). */
  private _snapshots: BudgetSnapshot[];
  /** Snapshot interval in milliseconds. */
  private _intervalMs: number;

  /**
   * Creates a lifecycle.
   *
   * @param config - partial budget config for the underlying allocator.
   * @param options - lifecycle tuning ({@link LifecycleOptions}).
   */
  constructor(config: Partial<BudgetConfig> = {}, options: LifecycleOptions = {}) {
    super();
    this._allocator = new BudgetAllocator(config, {
      nearThreshold: options.nearThreshold,
      nearRatio: options.nearRatio,
    });
    this._timer = null;
    this._snapshots = [];
    this._intervalMs = Math.max(10, Math.floor(options.snapshotIntervalMs ?? DEFAULT_INTERVAL_MS));
    if (options.autoStart === true) this.start();
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The underlying allocator, exposed for advanced callers.
   */
  get allocator(): BudgetAllocator {
    return this._allocator;
  }

  /**
   * `true` while the periodic snapshot timer is running.
   */
  get running(): boolean {
    return this._timer !== null;
  }

  /**
   * The most recent captured snapshot, or `undefined` before the first one.
   */
  get latestSnapshot(): BudgetSnapshot | undefined {
    return this._snapshots.length > 0
      ? this._snapshots[this._snapshots.length - 1]
      : undefined;
  }

  /**
   * Recent snapshots, oldest first. The returned array is a copy.
   */
  snapshots(): BudgetSnapshot[] {
    return Array.from(this._snapshots);
  }

  /* -------------------------------------------------------------------- *
   * Allocation delegation (with events)
   * -------------------------------------------------------------------- */

  /**
   * Delegates to {@link BudgetAllocator.allocate}, then emits `allocated`
   * and — when the request exceeded a ceiling — `overrun`.
   */
  allocate(section: string, tokens: number, opts: AllocateOptions = {}): AllocationResult {
    const result = this._allocator.allocate(section, tokens, opts);
    this.emit(BUDGET_EVENTS.allocated, result);
    if (result.exceeded === true) this.emit(BUDGET_EVENTS.overrun, result);
    return result;
  }

  /**
   * Delegates to {@link BudgetAllocator.fit}; emits `trimmed` when the text
   * had to be truncated.
   */
  fit(text: string, section: string, tokens: number): FitResult {
    const result = this._allocator.fit(text, section, tokens);
    if (result.truncated) this.emit(BUDGET_EVENTS.trimmed, result);
    return result;
  }

  /**
   * Delegates to {@link BudgetAllocator.release}.
   */
  release(section: string, tokens: number): number {
    return this._allocator.release(section, tokens);
  }

  /**
   * Delegates to {@link BudgetAllocator.check} (would this exceed?).
   */
  check(section: string, tokens: number): boolean {
    return this._allocator.check(section, tokens);
  }

  /**
   * Delegates to {@link BudgetAllocator.fits}.
   */
  fits(section: string, tokens: number): boolean {
    return this._allocator.fits(section, tokens);
  }

  /**
   * Delegates to {@link BudgetAllocator.project} (non-mutating preview).
   */
  project(section: string, tokens: number, opts: AllocateOptions = {}): AllocationResult {
    return this._allocator.project(section, tokens, opts);
  }

  /* -------------------------------------------------------------------- *
   * Housekeeping
   * -------------------------------------------------------------------- */

  /**
   * Removes every section that is idle (zero `used`) and holds no reserve,
   * freeing the index and preventing the budget map from growing unboundedly
   * over a long process lifetime.
   *
   * Sections that still carry reserve headroom are kept, since the reserve
   * represents an intentional commitment.
   *
   * @returns a {@link PruneSummary} describing what happened.
   */
  prune(): PruneSummary {
    let removed = 0;
    for (const section of this._allocator.store.keys()) {
      const record = this._allocator.store.get(section);
      if (!record) continue;
      if (record.used === 0 && (record.reserved ?? 0) === 0) {
        this._allocator.store.delete(section);
        this._allocator.index.removeAllocation(section);
        removed += 1;
      }
    }
    const summary: PruneSummary = { removed, sections: this._allocator.store.size };
    this.emit(BUDGET_EVENTS.pruned, summary);
    return summary;
  }

  /**
   * Resets a single section's consumption to zero, keeping its ceiling and
   * any reserve intact. Emits `resetSection`.
   *
   * @returns the freshly zeroed allocation, or `undefined` when the section
   *   was not tracked.
   */
  resetSection(section: string): SectionAllocation | undefined {
    const record = this._allocator.store.get(section);
    if (!record) return undefined;
    const zeroed: SectionAllocation = { ...record, used: 0 };
    this._allocator.store.set(zeroed);
    this._allocator.index.indexAllocation(zeroed);
    this.emit(BUDGET_EVENTS.resetSection, { ...zeroed });
    return { ...zeroed };
  }

  /**
   * Fully resets the budget: stops the timer, clears all allocations, the
   * index and the snapshot history. Configuration is preserved.
   *
   * @returns `this` for chaining.
   */
  reset(): this {
    this.stop();
    this._snapshots = [];
    this._allocator.reset();
    this.emit(BUDGET_EVENTS.reset, this._allocator);
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Periodic snapshots
   * -------------------------------------------------------------------- */

  /**
   * Starts (or restarts) the periodic snapshot timer.
   *
   * Every `intervalMs` milliseconds the current state is captured and pushed
   * to the ring buffer, and a `snapshot` event is emitted. The timer is
   * unref'd so it never keeps the Node process alive on its own.
   *
   * @param intervalMs - snapshot cadence; defaults to the constructor value.
   * @returns `this` for chaining.
   */
  start(intervalMs?: number): this {
    if (intervalMs !== undefined) {
      this._intervalMs = Math.max(10, Math.floor(intervalMs));
    }
    this.stop();
    this._timer = setInterval(() => this._captureAndEmit(), this._intervalMs);
    if (typeof (this._timer as NodeJS.Timeout).unref === 'function') {
      (this._timer as NodeJS.Timeout).unref();
    }
    return this;
  }

  /**
   * Stops the periodic snapshot timer (if running).
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /**
   * Captures the current state into the ring buffer (no event emitted) and
   * returns it.
   */
  snapshot(): BudgetSnapshot {
    const captured = this._allocator.snapshot();
    this._pushSnapshot(captured);
    return captured;
  }

  /* -------------------------------------------------------------------- *
   * Delegated aggregates
   * -------------------------------------------------------------------- */

  /**
   * Delegates to {@link BudgetAllocator.overall}.
   */
  overall(): ReturnType<BudgetAllocator['overall']> {
    return this._allocator.overall();
  }

  /**
   * Delegates to {@link BudgetAllocator.available}.
   */
  available(): number {
    return this._allocator.available();
  }

  /**
   * Delegates to {@link BudgetAllocator.stats}.
   */
  stats(): BudgetStats {
    return this._allocator.stats();
  }

  /* -------------------------------------------------------------------- *
   * Typed emitter overrides
   * -------------------------------------------------------------------- */

  /**
   * Typed `on` that narrows the payload per event name.
   */
  override on<K extends keyof BudgetingLifecycleEvents>(
    event: K,
    listener: (...args: BudgetingLifecycleEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `once` that narrows the payload per event name.
   */
  override once<K extends keyof BudgetingLifecycleEvents>(
    event: K,
    listener: (...args: BudgetingLifecycleEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `off` that narrows the payload per event name.
   */
  override off<K extends keyof BudgetingLifecycleEvents>(
    event: K,
    listener: (...args: BudgetingLifecycleEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `emit` that narrows the payload per event name.
   */
  override emit<K extends keyof BudgetingLifecycleEvents>(
    event: K,
    ...args: BudgetingLifecycleEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Captures a snapshot, pushes it to the ring buffer and emits `snapshot`.
   */
  private _captureAndEmit(): void {
    const captured = this._allocator.snapshot();
    this._pushSnapshot(captured);
    this.emit(BUDGET_EVENTS.snapshot, captured);
  }

  /**
   * Appends a snapshot to the ring buffer, evicting the oldest entry once
   * the buffer is full.
   */
  private _pushSnapshot(snapshot: BudgetSnapshot): void {
    this._snapshots.push(snapshot);
    if (this._snapshots.length > MAX_SNAPSHOTS) {
      this._snapshots.shift();
    }
  }
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createLifecycle(
  config: Partial<BudgetConfig> = {},
  options: LifecycleOptions = {},
): BudgetingLifecycle {
  return new BudgetingLifecycle(config, options);
}