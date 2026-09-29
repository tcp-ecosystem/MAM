/**
 * lifecycle.ts
 *
 * `PolicyLifecycle` — the operational spine of the MAM Security Policy layer.
 *
 * The lifecycle layer owns everything that is not a single policy decision:
 *
 * - **Pruning** — {@link prune} removes rules that are no longer wanted,
 *   either explicitly named or automatically when they are disabled (a policy
 *   graveyard clean-up pass). Store and index are kept consistent.
 * - **Resets** — {@link reset} clears the store, the index and every
 *   rate-limit bucket together, so re-seeding from a snapshot is an
 *   all-or-nothing operation.
 * - **Periodic GC** — {@link start} / {@link stop} drive a timer that prunes
 *   expired rate-limit buckets via the evaluator, so long-lived processes do
 *   not accumulate unbounded state for high-cardinality keys. Each pass emits
 *   a `gc` event.
 * - **Events** — the lifecycle re-emits evaluator outcomes as `evaluated` /
 *   `denied` / `rate-limited` / `sanitized` events and broadcasts every
 *   structural mutation (`rule-added`, `rule-removed`, `rule-enabled`,
 *   `rule-disabled`, `pruned`, `reset`, `error`), giving adapters and audit
 *   pipelines a single subscription point.
 *
 * The lifecycle extends Node's {@link EventEmitter} and keeps typed
 * subscription helpers (`onEvaluated`, `onDenied`, …) that return unsubscribe
 * functions for easy teardown.
 *
 * @module policy/lifecycle
 */

import { EventEmitter } from 'node:events';

import {
  createEmptyStats,
  describePolicyRequest,
  resolvePolicyConfig,
  type PolicyConfig,
  type PolicyDefinition,
  type PolicyRequest,
  type PolicyResult,
  type PolicyRule,
  type PolicyStats,
  type RateLimitState,
  type SanitizeResult,
} from './types.js';
import type { PolicyStore } from './store.js';
import type { PolicyIndex } from './index.js';
import type { PolicyEvaluator } from './retrieval.js';

/**
 * Canonical event names emitted by {@link PolicyLifecycle}. Using the
 * constants keeps listeners safe from typos.
 */
export const POLICY_EVENTS = {
  /** An evaluation completed. Payload: `(result, request)`. */
  EVALUATED: 'evaluated',
  /** An evaluation denied a request. Payload: `(result, request)`. */
  DENIED: 'denied',
  /** A rate-limit check was performed. Payload: `(key, at, retryAfterMs, state)`. */
  RATE_LIMITED: 'rate-limited',
  /** A sanitization pass completed. Payload: `(result, input)`. */
  SANITIZED: 'sanitized',
  /** A rule was added. Payload: `(rule)`. */
  RULE_ADDED: 'rule-added',
  /** A rule was removed. Payload: `(ruleId, removed: boolean)`. */
  RULE_REMOVED: 'rule-removed',
  /** A rule was enabled. Payload: `(ruleId, changed: boolean)`. */
  RULE_ENABLED: 'rule-enabled',
  /** A rule was disabled. Payload: `(ruleId, changed: boolean)`. */
  RULE_DISABLED: 'rule-disabled',
  /** Rules were pruned. Payload: `(removed: string[])`. */
  PRUNED: 'pruned',
  /** A rate-limit GC pass completed. Payload: `(pruned: number)`. */
  GC: 'gc',
  /** The lifecycle started / stopped its timer. Payload: `(running: boolean)`. */
  RUNNING: 'running',
  /** The engine was reset. Payload: `(stats)`. */
  RESET: 'reset',
  /** A lifecycle operation failed. Payload: `(error)`. */
  ERROR: 'error',
} as const;

/** Options accepted by the {@link PolicyLifecycle} constructor. */
export interface PolicyLifecycleOptions {
  /** Behavioural overrides merged over the defaults. */
  config?: Partial<PolicyConfig>;
}

/**
 * The operational spine of the policy engine: pruning, resets, periodic
 * rate-limit GC and event fan-out.
 *
 * @example
 * ```ts
 * const lifecycle = new PolicyLifecycle(store, index, evaluator);
 * lifecycle.onDenied((result) => audit.track(result));
 * lifecycle.onRateLimited((key) => console.warn('rate limited', key));
 * lifecycle.start(5_000);
 * ```
 */
export class PolicyLifecycle extends EventEmitter {
  private readonly store: PolicyStore;
  private readonly index: PolicyIndex;
  private readonly evaluator: PolicyEvaluator;
  private readonly config: PolicyConfig;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private gcCount = 0;
  private lastGcAt: number | undefined;
  private errorCount = 0;
  private lastEvaluatedAt: number | undefined;
  private lastDeniedAt: number | undefined;

  /**
   * Creates a lifecycle bound to the three core collaborators.
   *
   * The constructor wires the evaluator's `evaluated`, `rate-limited` and
   * `sanitized` events into the lifecycle's typed fan-out, so callers never
   * subscribe to the evaluator directly.
   *
   * @param store The rule registry.
   * @param index The rule index (kept in sync by the lifecycle).
   * @param evaluator The evaluator producing decisions.
   * @param options Configuration overrides.
   */
  constructor(
    store: PolicyStore,
    index: PolicyIndex,
    evaluator: PolicyEvaluator,
    options: PolicyLifecycleOptions = {},
  ) {
    super();
    this.store = store;
    this.index = index;
    this.evaluator = evaluator;
    this.config = resolvePolicyConfig(options.config);
    this.setMaxListeners(64);

    this.evaluator.on('evaluated', (result: PolicyResult, request: PolicyRequest) => {
      this.lastEvaluatedAt = result.at;
      this.emit(POLICY_EVENTS.EVALUATED, result, request);
      if (!result.allowed) {
        this.lastDeniedAt = result.at;
        this.emit(POLICY_EVENTS.DENIED, result, request);
      }
    });

    this.evaluator.on('rateLimited', (key: string, at: number, retryAfterMs: number, state: RateLimitState) => {
      this.emit(POLICY_EVENTS.RATE_LIMITED, key, at, retryAfterMs, state);
    });

    this.evaluator.on('sanitized', (result: SanitizeResult, input: string) => {
      this.emit(POLICY_EVENTS.SANITIZED, result, input);
    });
  }

  /**
   * Registers a rule and keeps the index consistent. Thin, event-emitting
   * wrapper over the store's `addRule`.
   *
   * @param rule The rule (or definition) to add.
   * @returns The stored rule.
   */
  addRule(rule: PolicyDefinition | PolicyRule): PolicyRule {
    const stored = this.store.addRule(rule);
    this.index.indexRule(stored);
    this.emit(POLICY_EVENTS.RULE_ADDED, stored);
    return stored;
  }

  /**
   * Removes a rule and keeps the index consistent.
   *
   * @param ruleId Rule id to remove.
   * @returns `true` when a rule was removed.
   */
  removeRule(ruleId: string): boolean {
    const removed = this.store.removeRule(ruleId);
    if (removed) {
      this.index.removeRule(ruleId);
    }
    this.emit(POLICY_EVENTS.RULE_REMOVED, ruleId, removed);
    return removed;
  }

  /**
   * Enables a rule, keeping the index consistent.
   *
   * @param ruleId Rule id to enable.
   * @returns `true` when the rule existed and its state changed.
   */
  enable(ruleId: string): boolean {
    return this.setEnabled(ruleId, true);
  }

  /**
   * Disables a rule, keeping the index consistent.
   *
   * @param ruleId Rule id to disable.
   * @returns `true` when the rule existed and its state changed.
   */
  disable(ruleId: string): boolean {
    return this.setEnabled(ruleId, false);
  }

  /**
   * Prunes rules. With an explicit list, exactly those rule ids are removed.
   * Without a list, disabled rules — policy that is switched off and therefore
   * dead weight — are removed automatically.
   *
   * @param ruleIds Optional explicit rule ids to prune.
   * @returns The ids of rules that were actually removed.
   */
  prune(ruleIds?: readonly string[]): string[] {
    const targets = ruleIds !== undefined ? Array.from(ruleIds) : this.findDisabled();
    const removed: string[] = [];
    for (const id of targets) {
      if (this.store.removeRule(id)) {
        this.index.removeRule(id);
        removed.push(id);
        this.emit(POLICY_EVENTS.RULE_REMOVED, id, true);
      }
    }
    if (removed.length > 0) {
      this.emit(POLICY_EVENTS.PRUNED, removed);
    }
    return removed;
  }

  /**
   * Runs a single rate-limit GC pass: expired buckets are pruned from the
   * evaluator and a `gc` event is emitted.
   *
   * @returns The number of buckets pruned.
   */
  gc(): number {
    const pruned = this.evaluator.pruneExpiredRateLimits();
    this.gcCount += 1;
    this.lastGcAt = Date.now();
    this.emit(POLICY_EVENTS.GC, pruned);
    return pruned;
  }

  /**
   * Resets the engine: store, index and rate-limit buckets are cleared
   * together and a `reset` event is emitted with the post-reset statistics.
   *
   * @returns The empty statistics snapshot.
   */
  reset(): PolicyStats {
    this.store.clear();
    this.index.clear();
    this.evaluator.clearRateLimits();
    const stats = this.stats();
    this.emit(POLICY_EVENTS.RESET, stats);
    return stats;
  }

  /**
   * Starts the periodic rate-limit GC timer. Idempotent: calling again while
   * running is a no-op.
   *
   * @param intervalMs GC interval in milliseconds (defaults to
   *   `config.gcIntervalMs`).
   * @returns `true` when the timer was started, `false` if already running.
   */
  start(intervalMs?: number): boolean {
    if (this.running) {
      return false;
    }
    const interval = intervalMs ?? this.config.gcIntervalMs ?? 30_000;
    this.timer = setInterval(() => {
      this.gc();
    }, interval);
    if (this.timer.unref) {
      this.timer.unref();
    }
    this.running = true;
    this.emit(POLICY_EVENTS.RUNNING, true);
    return true;
  }

  /**
   * Stops the periodic GC timer. Idempotent.
   *
   * @returns `true` when a running timer was stopped.
   */
  stop(): boolean {
    if (!this.running || this.timer === null) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.emit(POLICY_EVENTS.RUNNING, false);
    return true;
  }

  /**
   * Returns whether the periodic GC timer is active.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Subscribes a listener to evaluation outcomes. Returns an unsubscribe
   * function.
   *
   * @param listener Callback invoked with `(result, request)` for every
   *   evaluation.
   * @returns A function that removes the listener.
   */
  onEvaluated(listener: (result: PolicyResult, request: PolicyRequest) => void): () => void {
    this.on(POLICY_EVENTS.EVALUATED, listener);
    return () => this.off(POLICY_EVENTS.EVALUATED, listener);
  }

  /**
   * Subscribes a listener to denied outcomes. Returns an unsubscribe function.
   *
   * @param listener Callback invoked with `(result, request)` for denies.
   * @returns A function that removes the listener.
   */
  onDenied(listener: (result: PolicyResult, request: PolicyRequest) => void): () => void {
    this.on(POLICY_EVENTS.DENIED, listener);
    return () => this.off(POLICY_EVENTS.DENIED, listener);
  }

  /**
   * Subscribes a listener to rate-limit checks. Returns an unsubscribe
   * function.
   *
   * @param listener Callback invoked with `(key, at, retryAfterMs, state)`.
   * @returns A function that removes the listener.
   */
  onRateLimited(
    listener: (key: string, at: number, retryAfterMs: number, state: RateLimitState) => void,
  ): () => void {
    this.on(POLICY_EVENTS.RATE_LIMITED, listener);
    return () => this.off(POLICY_EVENTS.RATE_LIMITED, listener);
  }

  /**
   * Subscribes a listener to sanitization passes. Returns an unsubscribe
   * function.
   *
   * @param listener Callback invoked with `(result, input)`.
   * @returns A function that removes the listener.
   */
  onSanitized(listener: (result: SanitizeResult, input: string) => void): () => void {
    this.on(POLICY_EVENTS.SANITIZED, listener);
    return () => this.off(POLICY_EVENTS.SANITIZED, listener);
  }

  /**
   * Subscribes a listener to rule-add events.
   *
   * @param listener Callback invoked with the stored rule.
   * @returns An unsubscribe function.
   */
  onRuleAdded(listener: (rule: PolicyRule) => void): () => void {
    this.on(POLICY_EVENTS.RULE_ADDED, listener);
    return () => this.off(POLICY_EVENTS.RULE_ADDED, listener);
  }

  /**
   * Subscribes a listener to rule-remove events.
   *
   * @param listener Callback invoked with `(ruleId, removed)`.
   * @returns An unsubscribe function.
   */
  onRuleRemoved(listener: (ruleId: string, removed: boolean) => void): () => void {
    this.on(POLICY_EVENTS.RULE_REMOVED, listener);
    return () => this.off(POLICY_EVENTS.RULE_REMOVED, listener);
  }

  /**
   * Subscribes a listener to prune events.
   *
   * @param listener Callback invoked with the removed rule ids.
   * @returns An unsubscribe function.
   */
  onPruned(listener: (removed: string[]) => void): () => void {
    this.on(POLICY_EVENTS.PRUNED, listener);
    return () => this.off(POLICY_EVENTS.PRUNED, listener);
  }

  /**
   * Subscribes a listener to error events emitted by lifecycle operations.
   *
   * @param listener Callback invoked with the error.
   * @returns An unsubscribe function.
   */
  onError(listener: (error: Error) => void): () => void {
    this.on(POLICY_EVENTS.ERROR, listener);
    return () => this.off(POLICY_EVENTS.ERROR, listener);
  }

  /**
   * Subscribes a listener to reset events.
   *
   * @param listener Callback invoked with the post-reset statistics.
   * @returns An unsubscribe function.
   */
  onReset(listener: (stats: PolicyStats) => void): () => void {
    this.on(POLICY_EVENTS.RESET, listener);
    return () => this.off(POLICY_EVENTS.RESET, listener);
  }

  /**
   * Safely performs a lifecycle operation, emitting an `error` event (and
   * re-throwing only when no listener is attached) instead of crashing the
   * process.
   *
   * @param operation The operation to attempt.
   * @returns The operation's result, or `undefined` when it threw.
   */
  attempt<T>(operation: () => T): T | undefined {
    try {
      return operation();
    } catch (error) {
      this.errorCount += 1;
      this.emit(POLICY_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  }

  /**
   * Computes aggregate statistics across the store, index and evaluator.
   *
   * @returns A merged {@link PolicyStats}.
   */
  stats(): PolicyStats {
    const base = createEmptyStats();
    const evaluatorStats = this.evaluator.stats();
    const indexStats = this.index.stats();
    return {
      ...base,
      ...evaluatorStats,
      indexActions: indexStats.actions,
      indexResources: indexStats.resources,
      indexSubjects: indexStats.subjects,
      indexEffects: indexStats.effects,
    };
  }

  /**
   * Reports the lifecycle's operational state.
   *
   * @returns A plain snapshot of timers, counts and the running flag.
   */
  status(): {
    running: boolean;
    gcCount: number;
    lastGcAt: number | undefined;
    errorCount: number;
    lastEvaluatedAt: number | undefined;
    lastDeniedAt: number | undefined;
    rateLimitBucketCount: number;
  } {
    return {
      running: this.running,
      gcCount: this.gcCount,
      lastGcAt: this.lastGcAt,
      errorCount: this.errorCount,
      lastEvaluatedAt: this.lastEvaluatedAt,
      lastDeniedAt: this.lastDeniedAt,
      rateLimitBucketCount: this.evaluator.rateLimitBucketCount,
    };
  }

  /**
   * Internal: flips a rule's enabled state through the store and resynchronizes
   * the index.
   */
  private setEnabled(ruleId: string, enabled: boolean): boolean {
    const changed = enabled ? this.store.enable(ruleId) : this.store.disable(ruleId);
    const rule = this.store.getRule(ruleId);
    if (rule) {
      this.index.syncRule(rule);
    }
    this.emit(enabled ? POLICY_EVENTS.RULE_ENABLED : POLICY_EVENTS.RULE_DISABLED, ruleId, changed);
    return changed;
  }

  /**
   * Internal: finds disabled rules for automatic pruning.
   */
  private findDisabled(): string[] {
    return this.store.listDisabledRules().map((rule) => rule.id);
  }
}

/**
 * Convenience factory building a fully-wired lifecycle.
 *
 * @param store The rule registry.
 * @param index The rule index.
 * @param evaluator The policy evaluator.
 * @param options Configuration overrides.
 * @returns A configured {@link PolicyLifecycle}.
 */
export function createPolicyLifecycle(
  store: PolicyStore,
  index: PolicyIndex,
  evaluator: PolicyEvaluator,
  options: PolicyLifecycleOptions = {},
): PolicyLifecycle {
  return new PolicyLifecycle(store, index, evaluator, options);
}

/**
 * Utility that renders a policy result for an audit log line.
 *
 * @param result The result to render.
 * @returns A single-line audit string.
 */
export function auditLine(result: PolicyResult): string {
  const request = result.rule ? describePolicyRequest({
    subject: result.rule.subject,
    action: result.rule.action,
    resource: result.rule.resource,
  }) : 'anonymous';
  const rule = result.matchedRuleId ? ` via "${result.matchedRuleId}"` : '';
  return `[policy] ${result.allowed ? 'ALLOW' : 'DENY'} ${request} (${result.reason})${rule}`;
}

/**
 * Type-only re-export for integration consumers.
 */
export type { PolicyConfig, PolicyRequest, PolicyResult, PolicyRule, PolicyStats, RateLimitState, SanitizeResult };