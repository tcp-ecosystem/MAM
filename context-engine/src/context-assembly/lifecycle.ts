/**
 * AssemblyLifecycle — the maintenance and observation layer of the Context
 * Assembly subsystem of the standalone MAM Context Engine.
 *
 * The {@link ContextAssemblyStore} holds parts; the {@link ContextAssembler}
 * turns them into prompts. This class is the third leg: it keeps the part
 * registry healthy and emits lifecycle events the rest of the system can
 * subscribe to.
 *
 * Concretely it provides:
 *
 * - **Refresh tracking** — `refresh`/`refreshMany` record when a part was
 *   last touched, so the pipeline can mark parts as "recently used" whenever
 *   it assembles them.
 * - **TTL pruning** — `prune` removes parts whose last-touch time is older
 *   than the configured TTL, and `clearRole` removes whole roles at once
 *   (e.g. flushing stale tool results before a new turn).
 * - **Periodic sweeps** — `start`/`stop` drive an interval timer that prunes
 *   expired parts on a schedule. The timer is `unref`-ed so it never keeps a
 *   process alive on its own.
 * - **Lifecycle events** — the class extends `node:events` `EventEmitter`
 *   and emits typed events for `assembled`, `prune`, `refresh`, `reset`,
 *   `start` and `stop`, so monitoring, evals and cache layers can observe the
 *   subsystem without coupling to it.
 *
 * @packageDocumentation
 * @module context-assembly/lifecycle
 */

import { EventEmitter } from 'node:events';

import type {
  AssembledContext,
  ContextPart,
  ContextRole,
  PartId,
  Timestamp,
} from './types.js';
import type { ContextAssemblyStore } from './store.js';

/**
 * Default time-to-live in milliseconds before an untouched part is pruned.
 */
export const DEFAULT_TTL_MS = 60_000;

/**
 * Default interval in milliseconds between periodic prune sweeps.
 */
export const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Discriminator for lifecycle events emitted by {@link AssemblyLifecycle}.
 */
export type LifecycleEventType =
  | 'assembled'
  | 'prune'
  | 'refresh'
  | 'reset'
  | 'start'
  | 'stop';

/**
 * Payload emitted by the {@link AssemblyLifecycle} event emitter.
 *
 * Every event carries the discriminator, a timestamp and an
 * operation-specific payload. `'assembled'` fires after a pipeline assembly;
 * `'prune'` when parts are removed (TTL expiry or role clear); `'refresh'`
 * when parts are touched; `'reset'`/`'start'`/`'stop'` fire on lifecycle
 * transitions.
 */
export interface LifecycleEvent {
  /**
   * The lifecycle operation that fired.
   */
  readonly type: LifecycleEventType;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: Timestamp;

  /**
   * Number of parts affected by the operation.
   */
  readonly count: number;

  /**
   * Part ids involved in the operation, when applicable.
   */
  readonly partIds?: readonly PartId[];

  /**
   * Operation-specific detail (e.g. `'ttl'` vs `'role'` for a prune).
   */
  readonly detail?: unknown;
}

/**
 * Configuration options for {@link AssemblyLifecycle}.
 */
export interface LifecycleConfig {
  /**
   * Time-to-live in milliseconds for parts that are never touched again.
   * Defaults to {@link DEFAULT_TTL_MS}.
   */
  readonly ttlMs?: number;

  /**
   * Interval in milliseconds between periodic prune sweeps when started.
   * Defaults to {@link DEFAULT_INTERVAL_MS}.
   */
  readonly intervalMs?: number;

  /**
   * When `true` (default), the periodic sweep timer is started on
   * construction.
   */
  readonly autoStart?: boolean;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate counters describing the lifecycle's behaviour since construction.
 */
export interface LifecycleStats {
  /**
   * Number of parts currently held by the store.
   */
  readonly parts: number;

  /**
   * Number of parts currently tracked in the touch ledger.
   */
  readonly touched: number;

  /**
   * Whether the periodic sweep timer is currently running.
   */
  readonly running: boolean;

  /**
   * Total number of parts pruned (TTL or role clear) since construction.
   */
  readonly pruned: number;

  /**
   * Total number of individual `refresh` calls since construction.
   */
  readonly refreshed: number;

  /**
   * Total number of assembly passes observed since construction.
   */
  readonly assembled: number;

  /**
   * Epoch-ms time of the most recent assembly, or `null` if none observed.
   */
  readonly lastAssembledAt: Timestamp | null;

  /**
   * Epoch-ms time of the most recent prune, or `null` if none ran.
   */
  readonly lastPrunedAt: Timestamp | null;

  /**
   * Epoch-ms time the lifecycle was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Effective TTL in milliseconds.
   */
  readonly ttlMs: number;

  /**
   * Effective sweep interval in milliseconds.
   */
  readonly intervalMs: number;
}

/**
 * The lifecycle and event emitter for a context-assembly store.
 *
 * Construct with a {@link ContextAssemblyStore}; the lifecycle tracks touch
 * times for the store's parts, prunes them when they age past the TTL, and
 * emits typed events for every transition. It shares the store by reference,
 * so parts added or removed through the store directly (rather than through
 * the lifecycle) are reflected immediately in `prune` scans.
 *
 * @example
 * ```ts
 * const store = new ContextAssemblyStore();
 * const lifecycle = new AssemblyLifecycle(store, { ttlMs: 5_000 });
 * lifecycle.onEvent('prune', (e) => console.log(`pruned ${e.count}`));
 * lifecycle.refresh('part-1');
 * ```
 */
export class AssemblyLifecycle extends EventEmitter {
  /**
   * The store this lifecycle watches and prunes.
   */
  private readonly store: ContextAssemblyStore;

  /**
   * Clock used for all timestamps; injectable for deterministic tests.
   */
  private readonly now: () => Timestamp;

  /**
   * Effective TTL in milliseconds.
   */
  private readonly ttlMs: number;

  /**
   * Effective sweep interval in milliseconds.
   */
  private readonly intervalMs: number;

  /**
   * Touch ledger: partId → last-touch timestamp.
   */
  private readonly lastTouched = new Map<PartId, Timestamp>();

  /**
   * Active periodic sweep timer, or `null` when stopped.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Rolling counters for {@link stats}.
   */
  private prunedCount = 0;
  private refreshedCount = 0;
  private assembledCount = 0;

  /**
   * Timestamps of the most recent prune/assembly, for {@link stats}.
   */
  private lastPrunedAt: Timestamp | null = null;
  private lastAssembledAt: Timestamp | null = null;

  /**
   * Epoch-ms time the lifecycle was constructed.
   */
  private readonly createdAt: Timestamp;

  /**
   * The most recent assembled context observed, or `null`.
   */
  private lastAssembled: AssembledContext | null = null;

  /**
   * Construct a lifecycle over a store.
   *
   * Initialises the touch ledger from the store's current parts (using each
   * part's numeric `metadata.createdAt` when present, else the current time)
   * and, when `autoStart` is true (default), starts the periodic sweep timer.
   *
   * @param store - the store to watch and prune
   * @param config - optional configuration
   */
  constructor(store: ContextAssemblyStore, config: LifecycleConfig = {}) {
    super();
    this.store = store;
    this.now = config.now ?? (() => Date.now());
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.createdAt = this.now();

    const initial = this.now();
    for (const part of this.store.all()) {
      const recorded = this.partCreatedAt(part);
      this.lastTouched.set(part.id, recorded ?? initial);
    }

    if (config.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Mark a part as recently touched (now), by id.
   *
   * Refreshing a part postpones its TTL expiry by resetting its last-touch
   * timestamp. Emits a `'refresh'` event with `count: 1`.
   *
   * @param partId - the id of the part to refresh
   * @returns the new last-touch timestamp
   */
  refresh(partId: PartId): Timestamp {
    const now = this.now();
    this.lastTouched.set(partId, now);
    this.refreshedCount += 1;
    this.emitEvent('refresh', {
      type: 'refresh',
      timestamp: now,
      count: 1,
      partIds: [partId],
      detail: 'manual',
    });
    return now;
  }

  /**
   * Mark many parts as recently touched in one call.
   *
   * Emits a single `'refresh'` event aggregating the touched ids.
   *
   * @param parts - the parts to refresh
   * @returns the number of parts refreshed
   */
  refreshMany(parts: Iterable<ContextPart>): number {
    const now = this.now();
    const ids: PartId[] = [];
    for (const part of parts) {
      this.lastTouched.set(part.id, now);
      ids.push(part.id);
    }
    if (ids.length > 0) {
      this.refreshedCount += ids.length;
      this.emitEvent('refresh', {
        type: 'refresh',
        timestamp: now,
        count: ids.length,
        partIds: ids,
        detail: 'bulk',
      });
    }
    return ids.length;
  }

  /**
   * Prune parts whose last touch is older than the given age.
   *
   * Removes every part from the store whose last-touch timestamp is earlier
   * than `now - (olderThanMs ?? ttlMs)`. Parts unknown to the touch ledger
   * fall back to their `metadata.createdAt` (or are treated as fresh). Emits
   * a `'prune'` event with `count` and the pruned ids.
   *
   * @param olderThanMs - age threshold; defaults to the configured TTL
   * @returns the ids of the pruned parts
   */
  prune(olderThanMs?: number): PartId[] {
    const cutoff = this.now() - (olderThanMs ?? this.ttlMs);
    const pruned: PartId[] = [];
    for (const part of this.store.all()) {
      const lastTouch = this.lastTouched.get(part.id) ?? this.partCreatedAt(part);
      if (lastTouch === undefined || lastTouch >= cutoff) {
        continue;
      }
      if (this.store.delete(part.id)) {
        this.lastTouched.delete(part.id);
        pruned.push(part.id);
      }
    }
    if (pruned.length > 0) {
      this.prunedCount += pruned.length;
      this.lastPrunedAt = this.now();
      this.emitEvent('prune', {
        type: 'prune',
        timestamp: this.lastPrunedAt,
        count: pruned.length,
        partIds: pruned,
        detail: 'ttl',
      });
    }
    return pruned;
  }

  /**
   * Prune every part whose last touch is older than the configured TTL.
   *
   * Convenience wrapper around {@link prune} with no argument; used by the
   * periodic sweep timer.
   *
   * @returns the ids of the pruned parts
   */
  pruneExpired(): PartId[] {
    return this.prune();
  }

  /**
   * Remove every part of a given role from the store.
   *
   * Useful for flushing a whole class of parts at once (e.g. clearing all
   * `tool` results before a fresh turn). Emits a `'prune'` event with detail
   * `'role'`.
   *
   * @param role - the role to clear
   * @returns the ids of the removed parts
   */
  clearRole(role: ContextRole): PartId[] {
    const removed: PartId[] = [];
    for (const part of this.store.byRole(role)) {
      if (this.store.delete(part.id)) {
        this.lastTouched.delete(part.id);
        removed.push(part.id);
      }
    }
    if (removed.length > 0) {
      this.prunedCount += removed.length;
      this.lastPrunedAt = this.now();
      this.emitEvent('prune', {
        type: 'prune',
        timestamp: this.lastPrunedAt,
        count: removed.length,
        partIds: removed,
        detail: 'role',
      });
    }
    return removed;
  }

  /**
   * Reset the lifecycle to its construction state.
   *
   * Stops the sweep timer, clears the touch ledger (re-initialising it from
   * the store's current contents) and resets the rolling counters. The store
   * itself is left untouched — call {@link ContextAssemblyStore.clear}
   * separately if parts must also be removed. Emits a `'reset'` event.
   */
  reset(): void {
    this.stop();
    this.lastTouched.clear();
    const initial = this.now();
    for (const part of this.store.all()) {
      this.lastTouched.set(part.id, this.partCreatedAt(part) ?? initial);
    }
    this.prunedCount = 0;
    this.refreshedCount = 0;
    this.assembledCount = 0;
    this.lastPrunedAt = null;
    this.lastAssembledAt = null;
    this.lastAssembled = null;
    this.emitEvent('reset', {
      type: 'reset',
      timestamp: this.now(),
      count: 0,
    });
  }

  /**
   * Start the periodic prune sweep.
   *
   * Idempotent — a second call while running is a no-op. The timer is
   * `unref`-ed so it never keeps the process alive on its own. Emits a
   * `'start'` event.
   */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.pruneExpired();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.emitEvent('start', {
      type: 'start',
      timestamp: this.now(),
      count: 0,
    });
  }

  /**
   * Stop the periodic prune sweep.
   *
   * Idempotent — a second call while stopped is a no-op. Emits a `'stop'`
   * event.
   */
  stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.emitEvent('stop', {
      type: 'stop',
      timestamp: this.now(),
      count: 0,
    });
  }

  /**
   * Whether the periodic sweep timer is currently running.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Whether the periodic sweep timer is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Observe an assembly pass.
   *
   * Records the assembled context, updates the assembly counters and emits an
   * `'assembled'` event carrying the token count in `detail`. The pipeline
   * calls this after every `run`/`assemble` so subscribers stay in sync.
   *
   * @param assembled - the assembled context to observe
   */
  trackAssembled(assembled: AssembledContext): void {
    this.lastAssembled = assembled;
    this.assembledCount += 1;
    this.lastAssembledAt = this.now();
    this.emitEvent('assembled', {
      type: 'assembled',
      timestamp: this.lastAssembledAt,
      count: assembled.parts.length,
      partIds: assembled.parts.map((part) => part.id),
      detail: assembled.tokens,
    });
  }

  /**
   * The most recent assembled context observed, or `null` when none.
   */
  get lastResult(): AssembledContext | null {
    return this.lastAssembled;
  }

  /**
   * Aggregate counters describing the lifecycle's behaviour since
   * construction.
   *
   * @returns a {@link LifecycleStats} summary
   */
  stats(): LifecycleStats {
    return {
      parts: this.store.size,
      touched: this.lastTouched.size,
      running: this.running,
      pruned: this.prunedCount,
      refreshed: this.refreshedCount,
      assembled: this.assembledCount,
      lastAssembledAt: this.lastAssembledAt,
      lastPrunedAt: this.lastPrunedAt,
      createdAt: this.createdAt,
      ttlMs: this.ttlMs,
      intervalMs: this.intervalMs,
    };
  }

  /**
   * Human-readable summary of the lifecycle, for logging.
   *
   * @returns e.g. `"AssemblyLifecycle(parts=12, running=true, pruned=3)"`
   */
  inspect(): string {
    return `AssemblyLifecycle(parts=${this.store.size}, running=${this.running}, pruned=${this.prunedCount})`;
  }

  /**
   * Subscribe to a typed lifecycle event.
   *
   * Typed wrapper around `EventEmitter.on` that narrows the listener payload
   * to {@link LifecycleEvent}.
   *
   * @param type - the event discriminator to subscribe to
   * @param listener - the event handler
   * @returns `this` for chaining
   */
  onEvent(
    type: LifecycleEventType,
    listener: (event: LifecycleEvent) => void,
  ): this {
    this.on(type, listener);
    return this;
  }

  /**
   * Subscribe to a single typed lifecycle event.
   *
   * Typed wrapper around `EventEmitter.once`.
   *
   * @param type - the event discriminator to subscribe to
   * @param listener - the event handler
   * @returns `this` for chaining
   */
  onceEvent(
    type: LifecycleEventType,
    listener: (event: LifecycleEvent) => void,
  ): this {
    this.once(type, listener);
    return this;
  }

  /**
   * Emit a typed lifecycle event through the underlying emitter.
   *
   * @param type - the event discriminator
   * @param event - the fully-formed event payload
   */
  private emitEvent(type: LifecycleEventType, event: LifecycleEvent): void {
    this.emit(type, event);
  }

  /**
   * Read a part's recorded creation time, if any.
   *
   * Looks for a numeric `metadata.createdAt`; returns `undefined` when the
   * part has no usable creation timestamp.
   *
   * @param part - the part to inspect
   * @returns the recorded creation time, or `undefined`
   */
  private partCreatedAt(part: ContextPart): Timestamp | undefined {
    const recorded = part.metadata?.createdAt;
    return typeof recorded === 'number' && Number.isFinite(recorded)
      ? recorded
      : undefined;
  }
}

/**
 * Convenience factory: build a lifecycle over a store.
 *
 * Equivalent to `new AssemblyLifecycle(store, config)`.
 *
 * @param store - the store to watch
 * @param config - optional configuration
 * @returns a configured {@link AssemblyLifecycle}
 */
export function createLifecycle(
  store: ContextAssemblyStore,
  config: LifecycleConfig = {},
): AssemblyLifecycle {
  return new AssemblyLifecycle(store, config);
}