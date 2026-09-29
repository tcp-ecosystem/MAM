/**
 * Lifecycle management for the MAM Metrics layer.
 *
 * {@link MetricLifecycle} owns the resource-management concerns that a bare
 * store deliberately does not:
 *
 * - **Pruning** — {@link MetricLifecycle.prune} drops samples older than a
 *   retention window so memory does not grow without bound.
 * - **Resetting** — {@link MetricLifecycle.reset} and
 *   {@link MetricLifecycle.resetAll} clear samples while keeping (or dropping)
 *   the series, which is useful between measurement windows.
 * - **Periodic rollup** — {@link MetricLifecycle.start} installs timers that
 *   prune stale data and compute a digest set ({@link RollupResult}) on a fixed
 *   cadence, so consumers always have a fresh, cheap snapshot to render.
 * - **Events** — the lifecycle re-emits structured
 *   {@link MetricLifecycleEvent}s (`record`, `prune`, `rollup`, `reset`) that
 *   observers can subscribe to without reaching into the store.
 *
 * ## Event model
 *
 * The lifecycle subscribes to the store's raw events (see `store.ts`) while
 * running and forwards them as rich, self-describing
 * {@link MetricLifecycleEvent} payloads. Lifecycle-initiated operations
 * (`prune`, `reset`, `rollup`) emit their events directly, so every
 * meaningful transition of the metrics layer is observable through one
 * emitter.
 *
 * @module metrics/lifecycle
 */

import { EventEmitter } from 'node:events';

import type {
  MetricLifecycleEvent,
  MetricsConfig,
  MetricSummary,
  PruneResult,
  RollupResult,
  Timestamp,
} from './types.js';
import type { MetricStore, PruneEventDetail, ResetEventDetail } from './store.js';

/**
 * Options specific to the lifecycle, resolved from a {@link MetricsConfig}.
 */
export interface MetricLifecycleOptions {
  /**
   * Default retention window used by {@link MetricLifecycle.prune} when the
   * caller omits `olderThanMs`. See {@link MetricsConfig.maxAgeMs}.
   */
  readonly maxAgeMs: number;

  /**
   * Interval (ms) for automatic pruning while running. `0` disables it.
   */
  readonly pruneIntervalMs: number;

  /**
   * Interval (ms) for automatic rollup while running. `0` disables it.
   */
  readonly rollupIntervalMs: number;

  /**
   * Clock used instead of `Date.now()`.
   */
  readonly now: () => Timestamp;
}

/**
 * Resolve lifecycle options from a {@link MetricsConfig}.
 *
 * @param config - optional configuration
 * @returns a fully-populated options object
 */
export function resolveLifecycleOptions(
  config: MetricsConfig | undefined,
): MetricLifecycleOptions {
  return {
    maxAgeMs: config?.maxAgeMs ?? 0,
    pruneIntervalMs: config?.pruneIntervalMs ?? 0,
    rollupIntervalMs: config?.rollupIntervalMs ?? 60_000,
    now: config?.now ?? (() => Date.now()),
  };
}

/**
 * The lifecycle manager.
 *
 * See the {@link MetricLifecycle | module documentation} for the full contract.
 */
export class MetricLifecycle extends EventEmitter {
  /**
   * The store whose samples are pruned, rolled up and reset.
   */
  readonly #store: MetricStore;

  /**
   * Resolved lifecycle options.
   */
  readonly #options: MetricLifecycleOptions;

  /**
   * Handle of the automatic rollup timer, when running.
   */
  #rollupTimer: NodeJS.Timeout | null = null;

  /**
   * Handle of the automatic prune timer, when running.
   */
  #pruneTimer: NodeJS.Timeout | null = null;

  /**
   * Most recent rollup digest set.
   */
  #lastRollup: RollupResult | null = null;

  /**
   * Total number of samples recorded since this lifecycle was created.
   */
  #sampleCount = 0;

  /**
   * Total number of series created since this lifecycle was created.
   */
  #seriesCount = 0;

  /**
   * Set of series names observed so far, used to count creations.
   */
  readonly #seen: Set<string> = new Set<string>();

  /**
   * Create a lifecycle over a store.
   *
   * The lifecycle is inert until {@link MetricLifecycle.start} is called:
   * constructing it performs no timers and emits no events.
   *
   * @param store - the store to manage
   * @param config - optional lifecycle configuration
   */
  constructor(store: MetricStore, config?: MetricsConfig) {
    super();
    this.#store = store;
    this.#options = resolveLifecycleOptions(config);
  }

  /**
   * Begin periodic pruning and rollup.
   *
   * Installs the configured intervals from {@link MetricLifecycleOptions}. A
   * rollup is also computed immediately so consumers have a baseline digest.
   * While running, the lifecycle subscribes to the store's `'record'` events
   * and forwards them (plus running counters) as `'record'` lifecycle events.
   *
   * @param rollupIntervalMs - override the rollup interval (ms); `0` disables
   * @param pruneIntervalMs - override the prune interval (ms); `0` disables
   * @returns `this` for chaining
   */
  start(rollupIntervalMs?: number, pruneIntervalMs?: number): this {
    if (this.isRunning) {
      return this;
    }
    this.#store.on('record', this.#onStoreRecord);
    this.#store.on('prune', this.#onStorePrune);
    const rollupMs = rollupIntervalMs ?? this.#options.rollupIntervalMs;
    const pruneMs = pruneIntervalMs ?? this.#options.pruneIntervalMs;
    if (rollupMs > 0) {
      this.#rollupTimer = setInterval(() => {
        this.rollup();
      }, rollupMs);
      if (typeof this.#rollupTimer.unref === 'function') {
        this.#rollupTimer.unref();
      }
    }
    if (pruneMs > 0) {
      this.#pruneTimer = setInterval(() => {
        this.prune();
      }, pruneMs);
      if (typeof this.#pruneTimer.unref === 'function') {
        this.#pruneTimer.unref();
      }
    }
    this.rollup();
    return this;
  }

  /**
   * Stop periodic pruning and rollup.
   *
   * Clears both timers and detaches the store's event listeners. The store
   * itself is untouched.
   *
   * @returns `this` for chaining
   */
  stop(): this {
    if (this.#rollupTimer !== null) {
      clearInterval(this.#rollupTimer);
      this.#rollupTimer = null;
    }
    if (this.#pruneTimer !== null) {
      clearInterval(this.#pruneTimer);
      this.#pruneTimer = null;
    }
    this.#store.removeListener('record', this.#onStoreRecord);
    this.#store.removeListener('prune', this.#onStorePrune);
    return this;
  }

  /**
   * Whether the lifecycle is currently running its periodic timers.
   */
  get isRunning(): boolean {
    return this.#rollupTimer !== null || this.#pruneTimer !== null;
  }

  /**
   * The store managed by this lifecycle.
   */
  get store(): MetricStore {
    return this.#store;
  }

  /**
   * The most recent rollup digest set, or `null` before the first rollup.
   */
  get lastRollup(): RollupResult | null {
    return this.#lastRollup;
  }

  /**
   * Total number of samples recorded since creation.
   */
  get sampleCount(): number {
    return this.#sampleCount;
  }

  /**
   * Total number of distinct series observed since creation.
   */
  get seriesCount(): number {
    return this.#seriesCount;
  }

  /**
   * Remove samples older than a retention window.
   *
   * Delegates the actual removal to {@link MetricStore.pruneSamples} and then
   * emits a `'prune'` event carrying a {@link PruneResult}. When the store is
   * running its own prune timer this is invoked automatically.
   *
   * @param name - optional series name; when omitted every series is pruned
   * @param olderThanMs - retention window; defaults to
   * {@link MetricLifecycleOptions.maxAgeMs}
   * @returns a {@link PruneResult}
   */
  prune(name?: string, olderThanMs?: number): PruneResult {
    const now = this.#options.now();
    const window = olderThanMs ?? this.#options.maxAgeMs;
    const detail = this.#store.pruneSamples(name, window);
    const result: PruneResult = {
      removedSamples: detail.removedSamples,
      removedMetrics: detail.removedMetrics,
      metrics: this.#store.keys(),
      olderThanMs: window,
      cutoff: now - window,
      now,
    };
    this.#emit('prune', result);
    return result;
  }

  /**
   * Reset a single series by clearing its samples.
   *
   * The series remains registered (so handles continue to work); only its
   * observations are discarded. Counters reset to a running total of `0`.
   *
   * @param name - the series name
   * @returns `true` when the series existed and was reset
   */
  reset(name: string): boolean {
    const cleared = this.#store.clearSamples(name);
    if (cleared) {
      const event: MetricLifecycleEvent = {
        type: 'reset',
        timestamp: this.#options.now(),
        detail: { name, metrics: 1 } satisfies ResetEventDetail,
      };
      this.emit('reset', event);
    }
    return cleared;
  }

  /**
   * Reset every series by clearing all samples while keeping the series.
   *
   * @returns the number of series that were reset
   */
  resetAll(): number {
    const count = this.#store.clearAllSamples();
    if (count > 0) {
      const event: MetricLifecycleEvent = {
        type: 'reset',
        timestamp: this.#options.now(),
        detail: { name: null, metrics: count } satisfies ResetEventDetail,
      };
      this.emit('reset', event);
    }
    return count;
  }

  /**
   * Compute a digest set for every series and store it as the latest rollup.
   *
   * This is the operation invoked by the automatic rollup timer; calling it
   * manually is safe at any time. Emits a `'rollup'` event with the new
   * {@link RollupResult}.
   *
   * @returns the freshly-computed {@link RollupResult}
   */
  rollup(): RollupResult {
    const timestamp = this.#options.now();
    const summaries: Record<string, MetricSummary> = {};
    let samples = 0;
    for (const metric of this.#store.list()) {
      const summary = this.#store.getSummary(metric.name);
      if (summary) {
        summaries[metric.name] = summary;
        samples += summary.count;
      }
    }
    const result: RollupResult = {
      timestamp,
      metrics: Object.keys(summaries).length,
      samples,
      summaries,
    };
    this.#lastRollup = result;
    this.#emit('rollup', result);
    return result;
  }

  /**
   * Aggregate counters describing the lifecycle's own activity.
   *
   * @returns running totals and the last rollup timestamp
   */
  stats(): {
    sampleCount: number;
    seriesCount: number;
    isRunning: boolean;
    lastRollupAt: Timestamp | null;
    lastRollupMetrics: number;
  } {
    return {
      sampleCount: this.#sampleCount,
      seriesCount: this.#seriesCount,
      isRunning: this.isRunning,
      lastRollupAt: this.#lastRollup?.timestamp ?? null,
      lastRollupMetrics: this.#lastRollup?.metrics ?? 0,
    };
  }

  /**
   * Tear the lifecycle down.
   *
   * Alias of {@link MetricLifecycle.stop}; provided so the lifecycle can be
   * used with resource-pool patterns that call `dispose()`.
   *
   * @returns `this`
   */
  dispose(): this {
    return this.stop();
  }

  /**
   * Forward a store `'record'` event as a lifecycle event and update counters.
   *
   * @param sample - the recorded sample forwarded by the store
   */
  #onStoreRecord = (sample: {
    name: string;
    type: 'counter' | 'gauge' | 'histogram';
    value: number;
    unit?: string;
    labels?: Record<string, string | number | boolean>;
    timestamp: Timestamp;
  }): void => {
    this.#sampleCount += 1;
    if (!this.#seen.has(sample.name)) {
      this.#seen.add(sample.name);
      this.#seriesCount += 1;
    }
    this.#emit('record', sample);
  };

  /**
   * Forward a store `'prune'` event as a lifecycle event.
   *
   * @param detail - the store's prune detail
   */
  #onStorePrune = (detail: PruneEventDetail): void => {
    this.#emit('prune', detail);
  };

  /**
   * Build and emit a structured {@link MetricLifecycleEvent}.
   *
   * @param type - the event discriminator
   * @param detail - the operation-specific payload
   */
  #emit(
    type: 'record' | 'prune' | 'rollup' | 'reset',
    detail: unknown,
  ): void {
    const event: MetricLifecycleEvent = {
      type,
      timestamp: this.#options.now(),
      detail,
    };
    this.emit(type, event);
  }
}