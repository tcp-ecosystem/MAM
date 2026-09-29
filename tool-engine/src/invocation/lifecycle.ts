/**
 * lifecycle.ts
 *
 * The `InvocationLifecycle` — the housekeeping layer of the Invocation
 * engine.
 *
 * Execution (`retrieval.ts`) writes records into the store (`store.ts`) and
 * index (`index.ts`); neither of those components knows how the other is
 * kept bounded or consistent. The lifecycle manager is the glue that:
 *
 *   - bounds memory via {@link InvocationLifecycle.prune}, which trims the
 *     store's history buffer to `maxRecords` and removes the corresponding
 *     entries from the index by record id,
 *   - exposes whole-store resets: `clearHistory` (drop history + index) and
 *     `resetStats` (zero the statistics while keeping history),
 *   - runs an optional periodic garbage-collection pass (`start` / `stop`)
 *     so that a long-lived process never grows history without bound, even
 *     when callers forget to prune explicitly,
 *   - owns the {@link INVOCATION_EVENTS} vocabulary and the shared event
 *     emitter. The executor publishes `invoked` / `retried` / `succeeded` /
 *     `failed` through the same emitter, and the lifecycle itself emits
 *     `pruned`, `cleared` and `statsReset`.
 *
 * The periodic pass uses `setInterval` and is unref'd so it never keeps a
 * Node process alive on its own. Calling `start` twice is idempotent — the
 * second call is ignored while running.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events`).
 */

import { EventEmitter } from 'node:events';

import {
  type ExecutionRecord,
  type InvocationEmitter,
  type InvocationResult,
  type InvocationStats,
} from './types.js';
import { InvocationStore } from './store.js';
import { InvocationIndex } from './index.js';

/**
 * Names of every event published by the Invocation layer. Kept in one place
 * so consumers can subscribe with confidence and so typo-prone string
 * literals never leak into call sites.
 *
 * The executor (`retrieval.ts`) emits `invoked`, `retried`, `succeeded` and
 * `failed`; the lifecycle emits `pruned`, `cleared` and `statsReset`.
 */
export const INVOCATION_EVENTS = Object.freeze({
  /** Emitted when an attempt begins. */
  invoked: 'invoked',
  /** Emitted between attempts, when a retry is scheduled. */
  retried: 'retried',
  /** Emitted when an invocation ultimately succeeds. */
  succeeded: 'succeeded',
  /** Emitted when an invocation ultimately fails. */
  failed: 'failed',
  /** Emitted after the history buffer was pruned to a size bound. */
  pruned: 'pruned',
  /** Emitted after history (and the index) were cleared. */
  cleared: 'cleared',
  /** Emitted after cumulative statistics were reset to zero. */
  statsReset: 'statsReset',
} as const);

/**
 * Payload attached to every lifecycle event. Discriminated on `type` so
 * consumers can narrow safely.
 */
export type InvocationEventPayload =
  | {
      type: 'invoked';
      tool: string;
      traceId?: string;
      attempt: number;
      startedAt: number;
    }
  | {
      type: 'retried';
      tool: string;
      attempt: number;
      error: string;
      nextAttempt: number;
      delayMs: number;
    }
  | {
      type: 'succeeded' | 'failed';
      result: InvocationResult;
    }
  | {
      type: 'pruned';
      removed: number;
      remaining: number;
    }
  | {
      type: 'cleared';
      removed: number;
    }
  | {
      type: 'statsReset';
      toolCount: number;
    };

/**
 * Manages the boundedness and lifecycle of recorded invocation data.
 *
 * @example
 * const store = new InvocationStore();
 * const index = new InvocationIndex();
 * const lifecycle = new InvocationLifecycle(store, index, {
 *   maxRecords: 1000,
 *   gcIntervalMs: 60_000,
 * });
 *
 * lifecycle.on('pruned', ({ removed, remaining }) => {
 *   console.log(`pruned ${removed}; ${remaining} records remain`);
 * });
 *
 * lifecycle.prune(500);   // immediately trim history to 500 records
 * lifecycle.start();      // begin periodic GC every 60s
 * lifecycle.stop();
 * lifecycle.clearHistory();
 * lifecycle.resetStats();
 */
export class InvocationLifecycle {
  /** The store whose history this lifecycle bounds. */
  readonly store: InvocationStore;

  /** The index kept consistent with the store. */
  readonly index: InvocationIndex;

  /**
   * The shared event emitter. The executor publishes invocation events onto
   * the same emitter, so a single subscription surface covers everything.
   */
  readonly emitter: InvocationEmitter;

  /** Interval handle of the periodic GC pass, or `undefined`. */
  private timer?: ReturnType<typeof setInterval>;

  /** Maximum records retained by the periodic pass. */
  private readonly maxRecords: number;

  /** Interval between periodic GC passes, in ms. */
  private readonly gcIntervalMs: number;

  /** Whether periodic GC is permitted at all. */
  private readonly autoGc: boolean;

  /**
   * Creates a lifecycle manager bound to a store and index.
   *
   * @param store the store to bound.
   * @param index the index to keep consistent.
   * @param options optional tuning: `maxRecords` (default `1000`),
   *   `gcIntervalMs` (default `60_000`), `autoGc` (default `true`) and an
   *   injectable `emitter`.
   */
  constructor(
    store: InvocationStore,
    index: InvocationIndex,
    options: {
      maxRecords?: number;
      gcIntervalMs?: number;
      autoGc?: boolean;
      emitter?: InvocationEmitter;
    } = {},
  ) {
    this.store = store;
    this.index = index;
    this.emitter = options.emitter ?? new EventEmitter();
    this.maxRecords =
      typeof options.maxRecords === 'number' && options.maxRecords > 0
        ? Math.floor(options.maxRecords)
        : 1_000;
    this.gcIntervalMs =
      typeof options.gcIntervalMs === 'number' && options.gcIntervalMs > 0
        ? options.gcIntervalMs
        : 60_000;
    this.autoGc = options.autoGc ?? true;
  }

  /* ------------------------------------------------------------------ *
   * Bounding
   * ------------------------------------------------------------------ */

  /**
   * Trims the store's history to at most `maxRecords` records, removing the
   * oldest ones, and removes the corresponding entries from the index.
   *
   * Returns the number of records removed and emits a `pruned` event when any
   * were dropped. This is the transactional bound primitive — the periodic GC
   * pass calls it with the configured `maxRecords`.
   *
   * @param maxRecords the maximum number of records to retain.
   * @returns the number of records removed.
   */
  prune(maxRecords: number): number {
    const removedRecords = this.store.prune(maxRecords);
    for (const record of removedRecords) {
      if (record.id !== undefined) {
        this.index.removeRecord(record.id);
      }
    }
    if (removedRecords.length > 0) {
      this.emit(INVOCATION_EVENTS.pruned, {
        type: 'pruned',
        removed: removedRecords.length,
        remaining: this.store.size,
      } satisfies InvocationEventPayload);
    }
    return removedRecords.length;
  }

  /**
   * Returns the current number of retained history records.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Returns the maximum number of records the periodic GC pass retains.
   */
  getRecordLimit(): number {
    return this.maxRecords;
  }

  /* ------------------------------------------------------------------ *
   * Reset operations
   * ------------------------------------------------------------------ */

  /**
   * Clears history and the index, leaving statistics untouched.
   *
   * @returns the number of records removed.
   */
  clearHistory(): number {
    const removed = this.store.clearHistory();
    this.index.clear();
    if (removed > 0) {
      this.emit(INVOCATION_EVENTS.cleared, {
        type: 'cleared',
        removed,
      } satisfies InvocationEventPayload);
    }
    return removed;
  }

  /**
   * Resets cumulative statistics (per-tool and aggregate) to zero while
   * keeping history intact.
   *
   * @returns the number of tools whose stats were reset.
   */
  resetStats(): number {
    const toolCount = this.store.resetStats();
    this.emit(INVOCATION_EVENTS.statsReset, {
      type: 'statsReset',
      toolCount,
    } satisfies InvocationEventPayload);
    return toolCount;
  }

  /* ------------------------------------------------------------------ *
   * Periodic garbage collection
   * ------------------------------------------------------------------ */

  /**
   * Starts the periodic GC pass. Every `gcIntervalMs` the history is pruned
   * down to `maxRecords`.
   *
   * The timer is `unref`'d so the process can still exit naturally. Starting
   * while already running is a no-op. When `autoGc` was disabled at
   * construction, `start` does nothing.
   *
   * @returns `true` when a new timer was started, `false` when one was
   *   already running or GC is disabled.
   */
  start(): boolean {
    if (!this.autoGc || this.timer !== undefined) {
      return false;
    }
    this.timer = setInterval(() => {
      this.prune(this.maxRecords);
    }, this.gcIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return true;
  }

  /**
   * Stops the periodic GC pass, if one is running.
   *
   * @returns `true` when a timer was stopped, `false` when none was running.
   */
  stop(): boolean {
    if (this.timer === undefined) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    return true;
  }

  /**
   * Returns `true` when the periodic GC pass is currently running.
   */
  isRunning(): boolean {
    return this.timer !== undefined;
  }

  /* ------------------------------------------------------------------ *
   * Subscription
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to any invocation or lifecycle event. See
   * {@link INVOCATION_EVENTS} for names and {@link InvocationEventPayload}
   * for payload shapes.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: InvocationEventPayload) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener previously added via
   * {@link InvocationLifecycle.on}.
   *
   * @param event the event name.
   * @param listener the callback to remove.
   * @returns `this` for chaining.
   */
  off(
    event: string,
    listener: (payload: InvocationEventPayload) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Observation
   * ------------------------------------------------------------------ */

  /**
   * Returns every retained history record, oldest first.
   */
  history(): readonly ExecutionRecord[] {
    return this.store.getHistory();
  }

  /**
   * Returns the history records for a single tool.
   *
   * @param tool the tool name to filter by.
   */
  historyFor(tool: string): ExecutionRecord[] {
    return this.store.historyFor(tool);
  }

  /**
   * Returns an aggregate {@link InvocationStats} snapshot.
   */
  stats(): InvocationStats {
    return this.store.getStats();
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Publishes an event payload on the shared emitter.
   */
  private emit(event: string, payload: InvocationEventPayload): void {
    this.emitter.emit(event, payload);
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param store the store to bound.
 * @param index the index to keep consistent.
 * @param options optional lifecycle tuning.
 * @returns a new {@link InvocationLifecycle}.
 */
export default function createLifecycle(
  store: InvocationStore,
  index: InvocationIndex,
  options?: ConstructorParameters<typeof InvocationLifecycle>[2],
): InvocationLifecycle {
  return new InvocationLifecycle(store, index, options);
}