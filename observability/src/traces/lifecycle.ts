/**
 * @fileoverview
 * Lifecycle management for the MAM Observability Traces layer.
 *
 * A store accumulates data forever unless something actively removes it. The
 * `TraceLifecycle` engine owns that responsibility. It provides:
 *
 *  - **Pruning** — `prune(olderThanMs)` removes traces whose root span started
 *    before a retention cutoff, returning a {@link PruneResult}. This is the
 *    retention primitive that keeps the in-memory store bounded.
 *  - **Completion** — `completeSpan(id, ...)` finalizes a span that was
 *    recorded while in-flight, marks it ok/error, and emits a `spanComplete`
 *    event carrying the finished span.
 *  - **Scheduled pruning** — `start()` / `stop()` drive a periodic timer that
 *    runs prune passes on an interval (`pruneIntervalMs`), so production
 *    deployments get automatic retention without polling from the caller.
 *  - **Events** — the class extends `EventEmitter` and emits structured
 *    {@link TraceEvent} objects (`spanComplete`, `prune`, `started`,
 *    `stopped`, `reset`) that other components (dashboards, alerters, the
 *    `TraceAdapter`) can subscribe to.
 *
 * The timer is created with `.unref()` so an idle process never stays alive
 * purely because of the lifecycle engine, and `stop()` clears the timer
 * defensively even if it was already cleared.
 */

import { EventEmitter } from 'node:events';
import type { TraceConfig, TraceEvent, TraceSpan } from './types.js';
import { resolveTraceConfig } from './types.js';
import type { TraceStore } from './store.js';
import type { TraceIndex } from './index.js';
import type { PruneResult } from './types.js';

/**
 * A handler signature for lifecycle events. Kept intentionally generic so the
 * engine can forward the same event payload to every subscriber.
 */
export type TraceEventHandler = (event: TraceEvent) => void;

/**
 * Options accepted by {@link TraceLifecycle.completeSpan}.
 */
export interface CompleteSpanOptions {
  /** Epoch milliseconds to use as the completion time. Defaults to now. */
  endTime?: number;
  /** Final status for the span. Defaults to `ok`. */
  status?: 'ok' | 'error';
}

/**
 * Options accepted by {@link TraceLifecycle.start} when launching scheduled
 * pruning.
 */
export interface StartOptions {
  /** Override the prune interval for this run. Defaults to config. */
  pruneIntervalMs?: number;
  /**
   * Override the retention window for scheduled passes. Defaults to config.
   */
  retentionMs?: number;
  /**
   * When `true` a prune pass runs immediately on start (before the first
   * interval elapses). Defaults to `true`.
   */
  immediate?: boolean;
}

/**
 * The lifecycle / retention engine for a {@link TraceStore}.
 *
 * `TraceLifecycle` is an `EventEmitter`; valid event names are:
 * `spanComplete`, `prune`, `started`, `stopped`, `reset`.
 */
export class TraceLifecycle extends EventEmitter {
  /** The store this lifecycle manages. */
  readonly #store: TraceStore;
  /** Optional index kept in sync during prune passes. */
  readonly #index: TraceIndex | undefined;
  /** Effective configuration. */
  readonly #config: TraceConfig;
  /** Handle of the active scheduled prune timer, if any. */
  #timer: NodeJS.Timeout | null;
  /** Epoch ms at which scheduled pruning last ran. */
  #lastPruneAt: number;
  /** Total spans removed by this lifecycle across all passes. */
  #totalPrunedSpans: number;
  /** Total traces removed by this lifecycle across all passes. */
  #totalPrunedTraces: number;

  /**
   * Create a lifecycle engine bound to a store.
   *
   * @param store - the store to manage.
   * @param index - optional index to keep coherent during prune/reset.
   * @param config - optional partial configuration.
   */
  constructor(store: TraceStore, index?: TraceIndex, config?: Partial<TraceConfig>) {
    super();
    this.#store = store;
    this.#index = index;
    this.#config = resolveTraceConfig(config);
    this.#timer = null;
    this.#lastPruneAt = 0;
    this.#totalPrunedSpans = 0;
    this.#totalPrunedTraces = 0;
  }

  /**
   * The effective configuration of this lifecycle engine.
   */
  get config(): TraceConfig {
    return this.#config;
  }

  /**
   * Whether a scheduled prune timer is currently active.
   */
  get running(): boolean {
    return this.#timer !== null;
  }

  /**
   * Epoch ms of the last prune pass, or `0` if none has run.
   */
  get lastPruneAt(): number {
    return this.#lastPruneAt;
  }

  /**
   * Total number of spans removed across every prune pass.
   */
  get totalPrunedSpans(): number {
    return this.#totalPrunedSpans;
  }

  /**
   * Total number of traces removed across every prune pass.
   */
  get totalPrunedTraces(): number {
    return this.#totalPrunedTraces;
  }

  /**
   * Run a prune pass against the store.
   *
   * Any trace whose earliest span started before `Date.now() - olderThanMs`
   * is removed. When an index is attached its entries for the removed traces
   * are removed too, and a `prune` event is emitted.
   *
   * @param olderThanMs - retention window in milliseconds. Defaults to the
   * config's `defaultRetentionMs`.
   * @returns a {@link PruneResult} describing what was removed.
   */
  prune(olderThanMs?: number): PruneResult {
    const retention = typeof olderThanMs === 'number' ? Math.max(0, olderThanMs) : this.#config.defaultRetentionMs;
    const cutoff = Date.now() - retention;
    const beforeSpans = this.#store.spanCount;
    const beforeTraces = this.#store.size;

    const removedSpans = this.#store.pruneOlderThan(cutoff);
    const remainingSpans = Math.max(0, beforeSpans - removedSpans);
    const prunedTraces = Math.max(0, beforeTraces - this.#store.size);
    const remainingTraces = this.#store.size;

    if (this.#index !== undefined && prunedTraces > 0) {
      this.#index.rebuild(this.#store);
    }

    this.#lastPruneAt = Date.now();
    this.#totalPrunedSpans += removedSpans;
    this.#totalPrunedTraces += prunedTraces;

    const result: PruneResult = {
      prunedSpans: removedSpans,
      prunedTraces,
      remainingSpans,
      remainingTraces,
      at: this.#lastPruneAt,
      cutoff,
    };

    this.emit('prune', {
      type: 'trace-pruned',
      timestamp: this.#lastPruneAt,
      pruned: removedSpans,
      remaining: remainingSpans,
      reason: 'retention',
      detail: { ...result, retentionMs: retention },
    } satisfies TraceEvent);

    return result;
  }

  /**
   * Mark a recorded span as complete.
   *
   * The span's `endTime` and `durationMs` are computed, its status is set, and
   * the store is updated in place. A `spanComplete` event is emitted carrying
   * the finished span.
   *
   * @param spanId - id of the span to complete.
   * @param options - completion time and/or status.
   * @returns the completed span, or `undefined` when the span is unknown.
   */
  completeSpan(spanId: string, options: CompleteSpanOptions = {}): TraceSpan | undefined {
    const before = this.#store.getSpan(spanId);
    const updated = this.#store.completeSpan(spanId, {
      endTime: options.endTime,
      status: options.status,
    });
    if (updated === undefined) {
      return undefined;
    }
    if (this.#index !== undefined && before !== undefined) {
      this.#index.removeSpan(before.id, before.traceId);
      this.#index.indexSpan(updated);
    }
    this.emit('spanComplete', {
      type: 'span-completed',
      timestamp: updated.endTime ?? Date.now(),
      traceId: updated.traceId,
      spanId: updated.id,
      span: updated,
    } satisfies TraceEvent);
    return updated;
  }

  /**
   * Emit a "trace recorded" style event for a freshly completed trace. Useful
   * for consumers that only care about finished traces rather than individual
   * spans.
   *
   * @param traceId - the trace id.
   * @param detail - optional extra context.
   * @returns `true` when at least one listener received the event.
   */
  notifyTraceComplete(traceId: string, detail?: Record<string, unknown>): boolean {
    const trace = this.#store.getTrace(traceId);
    const event: TraceEvent = {
      type: 'trace-recorded',
      timestamp: Date.now(),
      traceId,
      trace: trace ?? undefined,
      detail,
    };
    return this.emit('traceComplete', event);
  }

  /**
   * Reset the lifecycle to a clean state: stop any scheduled pruning, clear
   * the store and the index, zero the counters, and emit a `reset` event.
   *
   * @returns the number of traces removed from the store.
   */
  reset(): number {
    this.stop();
    const removed = this.#store.clear();
    if (this.#index !== undefined) {
      this.#index.clear();
    }
    this.#totalPrunedSpans = 0;
    this.#totalPrunedTraces = 0;
    this.#lastPruneAt = 0;
    this.emit('reset', {
      type: 'store-cleared',
      timestamp: Date.now(),
      pruned: removed,
      remaining: 0,
      reason: 'lifecycle-reset',
    } satisfies TraceEvent);
    return removed;
  }

  /**
   * Start periodic pruning.
   *
   * A timer fires every `pruneIntervalMs` and runs `prune(retentionMs)`. If a
   * timer is already active this call is a no-op. When `immediate` is set a
   * prune pass runs right away.
   *
   * @param options - interval / retention / immediate overrides.
   * @returns `true` when a new timer was created, `false` when one was already
   * running.
   */
  start(options: StartOptions = {}): boolean {
    if (this.#timer !== null) {
      return false;
    }
    const interval = options.pruneIntervalMs ?? this.#config.pruneIntervalMs;
    const retention = options.retentionMs ?? this.#config.defaultRetentionMs;
    if (options.immediate !== false) {
      this.prune(retention);
    }
    this.#timer = setInterval(() => {
      try {
        this.prune(retention);
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    }, interval);
    if (typeof this.#timer.unref === 'function') {
      this.#timer.unref();
    }
    this.emit('started', {
      type: 'lifecycle-started',
      timestamp: Date.now(),
      reason: 'scheduled-prune',
      detail: { intervalMs: interval, retentionMs: retention },
    } satisfies TraceEvent);
    return true;
  }

  /**
   * Stop periodic pruning and clear the active timer.
   *
   * @returns `true` when a timer was stopped, `false` when none was running.
   */
  stop(): boolean {
    if (this.#timer === null) {
      return false;
    }
    clearInterval(this.#timer);
    this.#timer = null;
    this.emit('stopped', {
      type: 'lifecycle-stopped',
      timestamp: Date.now(),
      reason: 'manual-stop',
    } satisfies TraceEvent);
    return true;
  }

  /**
   * Dispose of the lifecycle engine: stop timers and remove every listener.
   * Safe to call multiple times.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Typed `on` overloads that narrow event payloads for the lifecycle's own
   * event names while remaining permissive for custom events.
   */
  override on(event: 'spanComplete', listener: (event: TraceEvent) => void): this;
  override on(event: 'prune', listener: (event: TraceEvent) => void): this;
  override on(event: 'started', listener: (event: TraceEvent) => void): this;
  override on(event: 'stopped', listener: (event: TraceEvent) => void): this;
  override on(event: 'reset', listener: (event: TraceEvent) => void): this;
  override on(event: 'traceComplete', listener: (event: TraceEvent) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}