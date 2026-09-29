/**
 * lifecycle.ts
 *
 * `AuditLifecycle` — the operational heartbeat of the MAM audit engine, plus
 * the rule-based anomaly detection engine it runs against recorded events.
 *
 * The lifecycle component owns everything that happens to the audit log after
 * an event is recorded and before it is queried:
 *
 *  - automatic retention pruning on a configurable interval
 *  - index synchronization (every recorded event is mirrored into the
 *    {@link AuditIndex}; every pruned event is removed from it)
 *  - rule-based anomaly detection against newly recorded events
 *  - full reset when the engine is torn down
 *  - an {@link EventEmitter} fan-out for `recorded`, `pruned`, `anomaly`,
 *    `start`, `stop` and `reset` so callers can wire alerting, metrics and
 *    cross-cutting caches without coupling to internals
 *
 * The anomaly detection engine ({@link detectAnomalies}) is exported as a
 * standalone, dependency-free function so the integration layer's
 * {@link AuditLogger} can also run it over ad-hoc batches of events. It
 * supports the three rule kinds from `types.ts` (`denial-burst`,
 * `critical-severity`, `unknown-actor`) plus caller-defined `custom` rules.
 *
 * The lifecycle manages an interval timer that is created lazily by
 * {@link AuditLifecycle.start} and always created `unref()`'d so it never
 * keeps the Node process alive.
 *
 * @module audit/lifecycle
 */

import { EventEmitter } from 'node:events';
import {
  type AnomalyFlag,
  type AnomalyRule,
  type AuditConfig,
  type AuditEvent,
  type AuditStats,
  DEFAULT_ANOMALY_RULES,
  createAnomalyFlag,
  createEmptyAuditStats,
  isUnknownActor,
  nowMs,
  resolveAuditConfig,
} from './types.js';
import { type AuditStore } from './store.js';
import { type AuditIndex } from './index.js';

/** Result of a single {@link AuditLifecycle.prune} sweep. */
export interface PruneResult {
  /** Number of events evicted. */
  count: number;
  /** Epoch ms when the sweep ran. */
  at: number;
  /** The retention threshold applied, in milliseconds. */
  olderThanMs: number;
}

/** Payloads emitted through the lifecycle {@link EventEmitter}. */
export interface AuditLifecycleEvents {
  /** A new event was recorded (re-emitted from the store). */
  recorded: AuditEvent;
  /** A prune sweep completed. */
  pruned: PruneResult;
  /** An anomaly was detected against a recorded event. */
  anomaly: AnomalyFlag;
  /** The periodic pruner started. */
  start: { intervalMs: number };
  /** The periodic pruner stopped. */
  stop: {};
  /** All audit state was cleared. */
  reset: { at: number };
}

/** Constructor options for {@link AuditLifecycle}. */
export interface AuditLifecycleOptions {
  /** The audit store this lifecycle supervises. */
  store: AuditStore;
  /** Optional audit index kept in sync on record/prune/reset. */
  index?: AuditIndex;
  /** Configuration overrides (retention, interval, anomaly rules). */
  config?: Partial<AuditConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
  /** Invoked synchronously whenever an anomaly is detected. */
  onAnomaly?: (flag: AnomalyFlag) => void;
}

/**
 * Determines whether a set of events satisfies a `denial-burst` rule: one
 * actor accumulating at least `threshold` denials within `windowMs`.
 *
 * @param events Candidate events.
 * @param rule The denial-burst rule (threshold/window resolved from defaults).
 * @param config Engine config (for default threshold/window).
 * @param now Reference time in epoch ms.
 * @returns The triggering events grouped per violating actor.
 */
export function evaluateDenialBurst(
  events: readonly AuditEvent[],
  rule: AnomalyRule,
  config: AuditConfig | undefined,
  now: number,
): { actor: string; related: AuditEvent[] }[] {
  const threshold = rule.threshold ?? config?.denyBurstThreshold ?? 5;
  const windowMs = rule.windowMs ?? config?.denyBurstWindowMs ?? 60_000;
  const windowStart = now - windowMs;
  const denied: AuditEvent[] = events.filter((e) => e.result === 'denied' && e.timestamp >= windowStart);
  const grouped = new Map<string, AuditEvent[]>();
  for (const event of denied) {
    const actor = event.actor ?? 'system';
    let list = grouped.get(actor);
    if (!list) {
      list = [];
      grouped.set(actor, list);
    }
    list.push(event);
  }
  const out: { actor: string; related: AuditEvent[] }[] = [];
  for (const [actor, related] of grouped) {
    if (related.length >= threshold) out.push({ actor, related });
  }
  return out;
}

/**
 * Evaluates a set of events against a single {@link AnomalyRule}.
 *
 * @param events Candidate events to evaluate.
 * @param rule The rule to apply.
 * @param config Engine config (for rule defaults).
 * @param now Reference time in epoch ms.
 * @returns An array of anomaly flags produced by the rule.
 */
export function evaluateRule(
  events: readonly AuditEvent[],
  rule: AnomalyRule,
  config: AuditConfig | undefined,
  now: number,
): AnomalyFlag[] {
  if (rule.enabled === false) return [];
  const flags: AnomalyFlag[] = [];
  switch (rule.kind) {
    case 'critical-severity': {
      for (const event of events) {
        if (event.severity === 'critical') {
          flags.push(
            createAnomalyFlag(rule, event, `Event '${event.action}' was recorded with critical severity`, now),
          );
        }
      }
      break;
    }
    case 'unknown-actor': {
      for (const event of events) {
        if (isUnknownActor(event.actor)) {
          flags.push(createAnomalyFlag(rule, event, `Event '${event.action}' references an unresolved actor`, now));
        }
      }
      break;
    }
    case 'denial-burst': {
      for (const burst of evaluateDenialBurst(events, rule, config, now)) {
        const latest = burst.related[burst.related.length - 1];
        if (latest) {
          flags.push(
            createAnomalyFlag(
              rule,
              latest,
              `Actor '${burst.actor}' recorded ${burst.related.length} denials within the detection window`,
              now,
              burst.related,
            ),
          );
        }
      }
      break;
    }
    case 'custom': {
      for (const event of events) {
        if (rule.severity !== undefined && event.severity !== rule.severity) continue;
        if (rule.result !== undefined && event.result !== rule.result) continue;
        if (rule.actor !== undefined && event.actor !== rule.actor) continue;
        flags.push(
          createAnomalyFlag(rule, event, `Event '${event.action}' matched custom rule '${rule.id}'`, now),
        );
      }
      break;
    }
    default:
      break;
  }
  return flags;
}

/**
 * Runs the full rule-based anomaly detection engine over a set of events.
 *
 * Each enabled rule in `config.anomalyRules` (falling back to
 * {@link DEFAULT_ANOMALY_RULES}) is applied independently; the returned flags
 * aggregate the findings across rules. The same function backs both the
 * lifecycle's live detection and the logger's ad-hoc {@code detectAnomalies}.
 *
 * @param events The events to evaluate.
 * @param config Engine configuration (may be omitted to use defaults).
 * @param now Reference time in epoch ms (defaults to the wall clock).
 * @returns An array of anomaly flags (empty when nothing is flagged).
 */
export function detectAnomalies(
  events: readonly AuditEvent[],
  config?: AuditConfig,
  now: number = nowMs(),
): AnomalyFlag[] {
  const resolved = config ?? resolveAuditConfig();
  const rules = resolved.anomalyRules ?? DEFAULT_ANOMALY_RULES;
  const flags: AnomalyFlag[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    flags.push(...evaluateRule(events, rule, resolved, now));
  }
  return flags;
}

/**
 * Coordinates retention pruning, index synchronization and anomaly detection
 * for the audit engine.
 *
 * Typical usage:
 *
 * ```ts
 * const lifecycle = new AuditLifecycle({ store, index, onAnomaly: alert });
 * lifecycle.on('anomaly', (flag) => console.error(flag.reason));
 * lifecycle.start(); // begins periodic retention pruning
 * lifecycle.prune(24 * 60 * 60 * 1000); // manual sweep
 * lifecycle.dispose();
 * ```
 */
export class AuditLifecycle {
  private readonly store: AuditStore;
  private readonly index: AuditIndex | undefined;
  private readonly config: AuditConfig;
  private readonly now: () => number;
  private readonly events: EventEmitter;
  private readonly onAnomaly: ((flag: AnomalyFlag) => void) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running: boolean;
  private lastPruneAt: number | undefined;
  private readonly cleanup: Array<() => void> = [];

  /**
   * @param options Store plus optional index, config, clock and anomaly hook.
   */
  constructor(options: AuditLifecycleOptions) {
    this.store = options.store;
    this.index = options.index;
    this.config = resolveAuditConfig(options.config);
    this.now = options.now ?? nowMs;
    this.onAnomaly = options.onAnomaly;
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.running = false;
    this.cleanup.push(
      this.store.on('recorded', (event) => {
        if (this.index) this.index.indexEvent(event);
        this.events.emit('recorded', event);
        for (const flag of detectAnomalies([event], this.config, this.now())) {
          this.events.emit('anomaly', flag);
          if (this.onAnomaly) this.onAnomaly(flag);
        }
      }),
    );
    this.cleanup.push(
      this.store.on('pruned', (result) => {
        if (this.index) {
          for (const event of result.events) this.index.removeEvent(event.id);
        }
      }),
    );
  }

  /**
   * Subscribes to a lifecycle event. Returns an unsubscribe function.
   *
   * @param event Event name (`recorded`, `pruned`, `anomaly`, `start`, `stop`
   *   or `reset`).
   * @param listener Event callback.
   * @returns Function that removes the listener.
   */
  on<K extends keyof AuditLifecycleEvents>(
    event: K,
    listener: (payload: AuditLifecycleEvents[K]) => void,
  ): () => void {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
    };
  }

  /**
   * Returns whether the periodic pruner is currently running.
   *
   * @returns `true` when {@link AuditLifecycle.start} has been called without a
   *   matching {@link AuditLifecycle.stop}.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Performs an immediate retention prune: every event older than
   * `olderThanMs` milliseconds is evicted from the store and unindexed. The
   * aggregate result is emitted as `pruned` and recorded as the new
   * `lastPruneAt`.
   *
   * @param olderThanMs Age threshold in milliseconds (defaults to
   *   `config.defaultRetentionMs`).
   * @param at Reference time in epoch ms (defaults to the clock).
   * @returns A {@link PruneResult} describing the sweep.
   */
  prune(olderThanMs: number = this.config.defaultRetentionMs ?? 24 * 60 * 60 * 1000, at: number = this.now()): PruneResult {
    const threshold = Math.max(0, olderThanMs);
    const removed = this.store.prune(threshold, at);
    this.lastPruneAt = removed.at;
    const result: PruneResult = { count: removed.count, at: removed.at, olderThanMs: threshold };
    this.events.emit('pruned', result);
    return result;
  }

  /**
   * Clears every event from the store and the index, then emits `reset`.
   *
   * @returns The total number of records cleared (store + index entries).
   */
  reset(): number {
    let count = this.store.clear();
    if (this.index) count += this.index.clear();
    this.lastPruneAt = undefined;
    this.events.emit('reset', { at: this.now() });
    return count;
  }

  /**
   * Begins the periodic retention prune. The interval timer is `unref()`'d so
   * the process can exit naturally. Safe to call more than once; subsequent
   * calls are ignored while running.
   *
   * @returns `true` when the pruner was started (or was already running).
   */
  start(): boolean {
    if (this.running) return true;
    const intervalMs = this.config.pruneIntervalMs ?? 60_000;
    this.timer = setInterval(() => {
      try {
        this.prune();
      } catch {
        // A failed sweep must never crash the host process; the next tick
        // will retry. Subscribers may hook 'pruned' for observability.
      }
    }, intervalMs);
    this.timer.unref();
    this.running = true;
    this.events.emit('start', { intervalMs });
    return true;
  }

  /**
   * Stops the periodic pruner and clears the pending timer.
   *
   * @returns `true` when a running pruner was stopped.
   */
  stop(): boolean {
    if (!this.running) return false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
    this.events.emit('stop', {});
    return true;
  }

  /**
   * Returns the epoch ms of the most recent prune sweep (or `undefined`).
   *
   * @returns Last prune timestamp, or `undefined`.
   */
  getLastPruneAt(): number | undefined {
    return this.lastPruneAt;
  }

  /**
   * Computes an {@link AuditStats} snapshot by delegating to the store, with
   * `lastPruneAt` populated from this lifecycle.
   *
   * @param base Optional starting stats.
   * @returns A fresh stats object.
   */
  stats(base: AuditStats = createEmptyAuditStats()): AuditStats {
    return this.store.stats({ ...base, lastPruneAt: this.lastPruneAt });
  }

  /**
   * Returns the resolved configuration in effect for this lifecycle.
   *
   * @returns A readonly view of the active {@link AuditConfig}.
   */
  getConfig(): Readonly<AuditConfig> {
    return this.config;
  }

  /**
   * Tears down the lifecycle: stops the pruner and detaches all store
   * listeners. Safe to call multiple times.
   */
  dispose(): void {
    this.stop();
    for (const unsubscribe of this.cleanup) unsubscribe();
    this.cleanup.length = 0;
  }
}