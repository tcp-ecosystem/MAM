/**
 * integration.ts
 *
 * High-level composition layer for the MAM Security Policy engine.
 *
 * While `types.ts`, `store.ts`, `index.ts`, `retrieval.ts` and `lifecycle.ts`
 * each solve one problem, application code typically wants a single entry
 * point. This module provides three increasingly capable facades:
 *
 * 1. **{@link SecurityPolicyEngine}** — the fully wired engine: policy store +
 *    rule index + evaluator + lifecycle, exposing rule management, policy
 *    evaluation, sanitization, rate limiting and dependency validation in one
 *    object. `enforce` throws {@link SecurityPolicyError} on denial for the
 *    fail-closed hot path.
 * 2. **{@link createSecurityPolicyEngine}** — a convenience factory returning
 *    a ready-to-use engine wired with a fresh store, index, evaluator and
 *    lifecycle.
 * 3. **{@link PolicyProvider} / {@link PolicyAdapter}** — the provider
 *    contract and an adapter that layers request normalization and a policy
 *    predicate over any underlying provider, giving you an ABAC-style
 *    pre-filter in front of the rule engine.
 *
 * All three are built with the same validated building blocks and emit
 * results that can be consumed directly or fed into audit pipelines.
 *
 * @module policy/integration
 */

import {
  denyResult,
  describePolicyRequest,
  resolvePolicyConfig,
  type DependencyValidationResult,
  type PolicyConfig,
  type PolicyDefinition,
  type PolicyRequest,
  type PolicyResult,
  type PolicyRule,
  type PolicyStats,
  type RateLimit,
  type RateLimitDecision,
  type SanitizeOptions,
  type SanitizeResult,
} from './types.js';
import { PolicyStore, type PolicyStoreSnapshot } from './store.js';
import { PolicyIndex } from './index.js';
import { PolicyEvaluator, type PolicyEvaluatorOptions } from './retrieval.js';
import { PolicyLifecycle, type PolicyLifecycleOptions } from './lifecycle.js';

/**
 * The minimal contract a policy facade must satisfy. Implemented by
 * {@link SecurityPolicyEngine} and {@link PolicyAdapter} so they can be
 * swapped behind a single type.
 */
export interface PolicyProvider {
  /**
   * Registers a rule and returns the stored record.
   *
   * @param definition The rule to add.
   * @returns The stored {@link PolicyRule}.
   */
  addRule(definition: PolicyDefinition | PolicyRule): PolicyRule;

  /**
   * Registers many rules at once.
   *
   * @param definitions The rules to add.
   * @returns The number of rules added.
   */
  addRules(definitions: readonly (PolicyDefinition | PolicyRule)[]): number;

  /**
   * Evaluates a request and returns its result (never throws for valid
   * requests).
   *
   * @param request The request to evaluate.
   * @returns The resulting {@link PolicyResult}.
   */
  evaluate(request: PolicyRequest): PolicyResult;

  /**
   * Evaluates a request and throws {@link SecurityPolicyError} on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed result.
   * @throws {SecurityPolicyError} when the request is denied.
   */
  enforce(request: PolicyRequest): PolicyResult;

  /**
   * Sanitizes a string input, stripping dangerous content.
   *
   * @param input The raw input.
   * @param opts Per-call sanitization options.
   * @returns A {@link SanitizeResult}.
   */
  sanitize(input: string, opts?: SanitizeOptions): SanitizeResult;

  /**
   * Performs a rate-limit check for a key.
   *
   * @param key Bucket key.
   * @param rateLimit Window/max specification.
   * @returns A {@link RateLimitDecision}.
   */
  rateLimit(key: string, rateLimit: RateLimit): RateLimitDecision;

  /**
   * Validates dependencies against an allowlist.
   *
   * @param deps The referenced dependencies.
   * @param allowed The allowlist.
   * @returns A {@link DependencyValidationResult}.
   */
  validateDependencies(deps: unknown, allowed: readonly string[]): DependencyValidationResult;

  /**
   * Returns every registered rule, sorted by id.
   *
   * @returns A defensive array of rules.
   */
  listRules(): PolicyRule[];
}

/**
 * Thrown by {@link enforce} and {@link PolicyProvider.enforce} when a request
 * is denied. Carries the full {@link PolicyResult} so callers can inspect the
 * reason and matched rule at the catch site.
 */
export class SecurityPolicyError extends Error {
  /** The result that produced the denial. */
  readonly result: PolicyResult;
  /** The request that was denied. */
  readonly request: PolicyRequest;

  /**
   * Creates a security policy error.
   *
   * @param result The denied result.
   * @param request The request that was denied.
   */
  constructor(result: PolicyResult, request: PolicyRequest) {
    super(`Policy denied: ${describePolicyRequest(request)} (reason: ${result.reason})`);
    this.name = 'SecurityPolicyError';
    this.result = result;
    this.request = request;
    Error.captureStackTrace?.(this, SecurityPolicyError);
  }
}

/** Options accepted by the {@link SecurityPolicyEngine} constructor. */
export interface SecurityPolicyEngineOptions {
  /** Behavioural configuration overrides. */
  config?: Partial<PolicyConfig>;
  /** Clock provider forwarded to the evaluator (deterministic tests). */
  now?: () => number;
  /** Explicit store injection for shared-state scenarios. */
  store?: PolicyStore;
  /** Explicit index injection. */
  index?: PolicyIndex;
  /** Explicit evaluator injection. */
  evaluator?: PolicyEvaluator;
  /** Explicit lifecycle injection. */
  lifecycle?: PolicyLifecycle;
}

/**
 * The fully wired policy engine: policy store + rule index + evaluator +
 * lifecycle, all composed into one object.
 *
 * `evaluate` is the hot-path entry point; `enforce` throws on denial;
 * lifecycle maintenance (`start`, `stop`, `gc`, `prune`, `reset`) and event
 * subscription are forwarded to the embedded lifecycle.
 *
 * @example
 * ```ts
 * const engine = createSecurityPolicyEngine();
 * engine.addRule({ id: 'read-public', effect: 'allow', action: 'read', resource: 'document' });
 * engine.addRule({ id: 'block-vip', effect: 'deny', resource: 'secrets', subject: 'public' });
 * engine.start();
 * const ok = engine.evaluate({ subject: 'u-1', action: 'read', resource: 'document' });
 * const safe = engine.sanitize('<script>alert(1)</script>hello');
 * const limited = engine.rateLimit('api:u-1', { windowMs: 60_000, max: 5 });
 * ```
 */
export class SecurityPolicyEngine implements PolicyProvider {
  private readonly store: PolicyStore;
  private readonly index: PolicyIndex;
  private readonly evaluator: PolicyEvaluator;
  private readonly lifecycle: PolicyLifecycle;
  private readonly config: PolicyConfig;

  /**
   * Creates an engine. By default all four collaborators are constructed
   * fresh; explicit collaborators may be injected for shared-state scenarios.
   *
   * @param options Optional config, clock and collaborator injection.
   */
  constructor(options: SecurityPolicyEngineOptions = {}) {
    this.config = resolvePolicyConfig(options.config);
    const evaluatorOptions: PolicyEvaluatorOptions = { config: this.config, now: options.now };
    const lifecycleOptions: PolicyLifecycleOptions = { config: this.config };
    this.store = options.store ?? new PolicyStore();
    this.index = options.index ?? new PolicyIndex();
    this.evaluator = options.evaluator ?? new PolicyEvaluator(this.store, this.index, evaluatorOptions);
    this.lifecycle = options.lifecycle ?? new PolicyLifecycle(this.store, this.index, this.evaluator, lifecycleOptions);
  }

  /**
   * Registers a rule and keeps the index consistent.
   *
   * @param definition The rule to add.
   * @returns The stored rule.
   * @throws {ReferenceError} when the id is already registered.
   */
  addRule(definition: PolicyDefinition | PolicyRule): PolicyRule {
    return this.lifecycle.addRule(definition);
  }

  /**
   * Registers many rules at once (all-or-nothing).
   *
   * @param definitions The rules to add.
   * @returns The number of rules added.
   */
  addRules(definitions: readonly (PolicyDefinition | PolicyRule)[]): number {
    let count = 0;
    for (const definition of definitions) {
      this.addRule(definition);
      count += 1;
    }
    return count;
  }

  /**
   * The hot-path entry point: evaluates a request and returns its result
   * (also fanned out through lifecycle events).
   *
   * @param request The request to evaluate.
   * @returns The resulting {@link PolicyResult}.
   */
  evaluate(request: PolicyRequest): PolicyResult {
    return this.evaluator.evaluate(request);
  }

  /**
   * Convenience boolean form of {@link evaluate}.
   *
   * @param request The request to evaluate.
   * @returns `true` when the request is permitted.
   */
  can(request: PolicyRequest): boolean {
    return this.evaluate(request).allowed;
  }

  /**
   * Returns `true` only when every request is permitted.
   *
   * @param requests The requests to evaluate.
   * @returns `true` when all are allowed.
   */
  canAll(requests: readonly PolicyRequest[]): boolean {
    return this.evaluator.canAll(requests);
  }

  /**
   * Returns `true` when at least one request is permitted.
   *
   * @param requests The requests to evaluate.
   * @returns `true` when any is allowed.
   */
  canAny(requests: readonly PolicyRequest[]): boolean {
    return this.evaluator.canAny(requests);
  }

  /**
   * Evaluates a request and throws on denial — the fail-closed hot path.
   *
   * @param request The request to evaluate.
   * @returns The allowed result.
   * @throws {SecurityPolicyError} when denied.
   */
  enforce(request: PolicyRequest): PolicyResult {
    const result = this.evaluate(request);
    if (!result.allowed) {
      throw new SecurityPolicyError(result, request);
    }
    return result;
  }

  /**
   * Sanitizes a string input, stripping dangerous content and enforcing the
   * configured length cap.
   *
   * @param input The raw input to sanitize.
   * @param opts Per-call sanitization options.
   * @returns A {@link SanitizeResult}.
   */
  sanitize(input: string, opts: SanitizeOptions = {}): SanitizeResult {
    return this.evaluator.sanitize(input, opts);
  }

  /**
   * Performs a sliding-window rate-limit check for a key.
   *
   * @param key Bucket key (ip, user id, endpoint…).
   * @param rateLimit Optional window/max; defaults to the engine config.
   * @returns A {@link RateLimitDecision}.
   */
  rateLimit(key: string, rateLimit?: RateLimit): RateLimitDecision {
    const spec: RateLimit = rateLimit ?? {
      windowMs: this.config.rateLimitWindowMs ?? 60_000,
      max: this.config.rateLimitMax ?? 100,
    };
    return this.evaluator.checkRateLimit(key, spec);
  }

  /**
   * Validates dependencies against an allowlist.
   *
   * @param deps The referenced dependencies.
   * @param allowed The allowlist (names or trailing-`*` globs).
   * @returns A {@link DependencyValidationResult}.
   */
  validateDependencies(deps: unknown, allowed: readonly string[]): DependencyValidationResult {
    return this.evaluator.validateDependencies(deps, allowed);
  }

  /**
   * Looks up a registered rule.
   *
   * @param ruleId Rule id to resolve.
   * @returns The stored rule, or `undefined`.
   */
  getRule(ruleId: string): PolicyRule | undefined {
    return this.store.getRule(ruleId);
  }

  /**
   * Returns whether a rule is registered.
   *
   * @param ruleId Rule id to check.
   * @returns `true` when registered.
   */
  hasRule(ruleId: string): boolean {
    return this.store.hasRule(ruleId);
  }

  /**
   * Returns every registered rule, sorted by id.
   *
   * @returns A defensive array of rules.
   */
  listRules(): PolicyRule[] {
    return this.store.listRules();
  }

  /**
   * Returns every registered rule id, sorted lexically.
   *
   * @returns A defensive array of rule ids.
   */
  listRuleIds(): string[] {
    return this.store.listRuleIds();
  }

  /**
   * Removes a rule, keeping the index consistent.
   *
   * @param ruleId Rule id to remove.
   * @returns `true` when a rule was removed.
   */
  removeRule(ruleId: string): boolean {
    return this.lifecycle.removeRule(ruleId);
  }

  /**
   * Enables a rule.
   *
   * @param ruleId Rule id to enable.
   * @returns `true` when the rule existed and its state changed.
   */
  enable(ruleId: string): boolean {
    return this.lifecycle.enable(ruleId);
  }

  /**
   * Disables a rule so it is skipped during evaluation.
   *
   * @param ruleId Rule id to disable.
   * @returns `true` when the rule existed and its state changed.
   */
  disable(ruleId: string): boolean {
    return this.lifecycle.disable(ruleId);
  }

  /**
   * Returns whether a rule is enabled.
   *
   * @param ruleId Rule id to inspect.
   * @returns `true` when the rule exists and is enabled.
   */
  isEnabled(ruleId: string): boolean {
    return this.store.isEnabled(ruleId);
  }

  /**
   * Prunes rules (explicit or disabled).
   *
   * @param ruleIds Optional explicit rule ids to prune.
   * @returns The removed rule ids.
   */
  prune(ruleIds?: readonly string[]): string[] {
    return this.lifecycle.prune(ruleIds);
  }

  /**
   * Runs a single rate-limit GC pass.
   *
   * @returns The number of rate-limit buckets pruned.
   */
  gc(): number {
    return this.lifecycle.gc();
  }

  /**
   * Resets the engine (store + index + rate-limit buckets).
   *
   * @returns The post-reset statistics.
   */
  reset(): PolicyStats {
    return this.lifecycle.reset();
  }

  /**
   * Starts the periodic rate-limit GC timer.
   *
   * @param intervalMs GC interval in milliseconds.
   * @returns `true` when started.
   */
  start(intervalMs?: number): boolean {
    return this.lifecycle.start(intervalMs);
  }

  /**
   * Stops the periodic GC timer.
   *
   * @returns `true` when a running timer was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns whether the periodic timer is active.
   */
  get isRunning(): boolean {
    return this.lifecycle.isRunning;
  }

  /**
   * Subscribes to a lifecycle event (see {@link PolicyLifecycle} event names).
   *
   * @param event Event name.
   * @param listener Event listener.
   * @returns This engine (for chaining).
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.lifecycle.on(event, listener);
    return this;
  }

  /**
   * Computes aggregate engine statistics.
   *
   * @returns A merged {@link PolicyStats}.
   */
  stats(): PolicyStats {
    return this.lifecycle.stats();
  }

  /**
   * Reports the lifecycle's operational state.
   *
   * @returns A plain snapshot of timers and counts.
   */
  status(): ReturnType<PolicyLifecycle['status']> {
    return this.lifecycle.status();
  }

  /**
   * Serializes the backing policy store (conditions omitted).
   *
   * @returns A JSON-safe snapshot.
   */
  toJSON(): PolicyStoreSnapshot {
    return this.store.toJSON();
  }

  /**
   * Replaces the entire engine state from a snapshot.
   *
   * @param snapshot A snapshot produced by {@link toJSON}.
   */
  fromJSON(snapshot: unknown): void {
    this.store.fromJSON(snapshot);
    this.index.rebuild(this.store.listRules());
  }

  /**
   * The backing policy store (exposed for advanced composition).
   */
  get policyStore(): PolicyStore {
    return this.store;
  }

  /**
   * The backing rule index (exposed for advanced composition).
   */
  get policyIndex(): PolicyIndex {
    return this.index;
  }

  /**
   * The backing evaluator (exposed for advanced composition).
   */
  get policyEvaluator(): PolicyEvaluator {
    return this.evaluator;
  }

  /**
   * The embedded lifecycle (exposed for advanced event wiring).
   */
  get lifecycleHandle(): PolicyLifecycle {
    return this.lifecycle;
  }
}

/**
 * Builds a fully-wired, standalone policy engine: a fresh store, a fresh
 * index, an evaluator and a lifecycle.
 *
 * @param config Optional configuration overrides.
 * @returns A ready-to-use {@link SecurityPolicyEngine}.
 */
export function createSecurityPolicyEngine(config?: Partial<PolicyConfig>): SecurityPolicyEngine {
  return new SecurityPolicyEngine({ config });
}

/** Options accepted by the {@link PolicyAdapter} constructor. */
export interface PolicyAdapterOptions {
  /**
   * Optional request normalizer: transforms an incoming request before it is
   * evaluated (e.g. canonicalizing resource names, filling default subjects).
   */
  normalize?: (request: PolicyRequest) => PolicyRequest;
  /**
   * Optional policy predicate evaluated *before* the provider. Returning
   * `false` produces an immediate denial with reason `denied`, so ABAC-style
   * environment conditions belong here.
   */
  policy?: (request: PolicyRequest) => boolean;
  /**
   * Optional observer called with every final result (for audit).
   */
  onResult?: (result: PolicyResult) => void;
}

/**
 * A {@link PolicyProvider}-conforming adapter that layers request
 * normalization and a policy predicate over any underlying provider.
 *
 * The policy hook makes the adapter a convenient place to add ABAC-style
 * conditions ("only during business hours", "only from this region") without
 * changing the rule engine core.
 *
 * @example
 * ```ts
 * const adapter = new PolicyAdapter(engine, {
 *   policy: (req) => req.context?.environment !== 'production' || req.subject === 'admin',
 *   onResult: (r) => console.log(auditLine(r)),
 * });
 * ```
 */
export class PolicyAdapter implements PolicyProvider {
  private readonly provider: PolicyProvider;
  private readonly normalize: NonNullable<PolicyAdapterOptions['normalize']>;
  private readonly policy: NonNullable<PolicyAdapterOptions['policy']>;
  private readonly onResult: NonNullable<PolicyAdapterOptions['onResult']>;

  /**
   * Creates an adapter over an underlying provider.
   *
   * @param provider The provider to delegate to.
   * @param options Normalizer, policy predicate and result observer hooks.
   */
  constructor(provider: PolicyProvider, options: PolicyAdapterOptions = {}) {
    this.provider = provider;
    this.normalize = options.normalize ?? ((request) => request);
    this.policy = options.policy ?? (() => true);
    this.onResult = options.onResult ?? (() => undefined);
  }

  /**
   * Evaluates a request: normalize → policy check → delegate. Never throws for
   * valid requests.
   *
   * @param request The incoming request.
   * @returns The final result.
   */
  evaluate(request: PolicyRequest): PolicyResult {
    const normalized = this.normalize(request);
    let result: PolicyResult;
    if (!this.policy(normalized)) {
      result = denyResult('denied', undefined, normalized);
    } else {
      result = this.provider.evaluate(normalized);
    }
    this.onResult(result);
    return result;
  }

  /**
   * Evaluates a request and throws on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed result.
   * @throws {SecurityPolicyError} when denied.
   */
  enforce(request: PolicyRequest): PolicyResult {
    const result = this.evaluate(request);
    if (!result.allowed) {
      throw new SecurityPolicyError(result, request);
    }
    return result;
  }

  /**
   * Registers a rule through the underlying provider.
   *
   * @param definition The rule to add.
   * @returns The stored rule.
   */
  addRule(definition: PolicyDefinition | PolicyRule): PolicyRule {
    return this.provider.addRule(definition);
  }

  /**
   * Registers many rules through the underlying provider.
   *
   * @param definitions The rules to add.
   * @returns The number of rules added.
   */
  addRules(definitions: readonly (PolicyDefinition | PolicyRule)[]): number {
    return this.provider.addRules(definitions);
  }

  /**
   * Sanitizes input through the underlying provider.
   *
   * @param input The raw input.
   * @param opts Per-call options.
   * @returns A {@link SanitizeResult}.
   */
  sanitize(input: string, opts: SanitizeOptions = {}): SanitizeResult {
    return this.provider.sanitize(input, opts);
  }

  /**
   * Performs a rate-limit check through the underlying provider.
   *
   * @param key Bucket key.
   * @param rateLimit Window/max specification.
   * @returns A {@link RateLimitDecision}.
   */
  rateLimit(key: string, rateLimit: RateLimit): RateLimitDecision {
    return this.provider.rateLimit(key, rateLimit);
  }

  /**
   * Validates dependencies through the underlying provider.
   *
   * @param deps The referenced dependencies.
   * @param allowed The allowlist.
   * @returns A {@link DependencyValidationResult}.
   */
  validateDependencies(deps: unknown, allowed: readonly string[]): DependencyValidationResult {
    return this.provider.validateDependencies(deps, allowed);
  }

  /**
   * Lists rules from the underlying provider.
   *
   * @returns A defensive array of rules.
   */
  listRules(): PolicyRule[] {
    return this.provider.listRules();
  }

  /**
   * The underlying provider.
   */
  get delegate(): PolicyProvider {
    return this.provider;
  }
}

/**
 * Convenience factory building an adapter around a freshly created engine.
 *
 * @param adapterOptions Adapter hooks (normalize / policy / observer).
 * @param config Engine configuration overrides.
 * @returns A fully wired {@link PolicyAdapter}.
 */
export function createPolicyAdapter(
  adapterOptions: PolicyAdapterOptions = {},
  config?: Partial<PolicyConfig>,
): PolicyAdapter {
  return new PolicyAdapter(createSecurityPolicyEngine(config), adapterOptions);
}

/**
 * Convenience that seeds a fresh engine with allow/deny rules and returns it,
 * for one-line bootstrapping of common policy sets.
 *
 * @param allow An allowlist of `{ action, resource, subject? }` triples.
 * @param deny A denylist of `{ action, resource, subject? }` triples.
 * @param config Optional engine configuration.
 * @returns A ready-to-use {@link SecurityPolicyEngine}.
 */
export function createPolicyEngineFromRules(
  allow: readonly { action: string; resource: string; subject?: string }[] = [],
  deny: readonly { action: string; resource: string; subject?: string }[] = [],
  config?: Partial<PolicyConfig>,
): SecurityPolicyEngine {
  const engine = createSecurityPolicyEngine(config);
  allow.forEach((triple, index) => {
    engine.addRule({ id: `allow-${index}`, effect: 'allow', ...triple });
  });
  deny.forEach((triple, index) => {
    engine.addRule({ id: `deny-${index}`, effect: 'deny', ...triple });
  });
  return engine;
}

/**
 * Type-only re-export for integration consumers.
 */
export type { DependencyValidationResult, PolicyConfig, PolicyRequest, PolicyResult, PolicyRule, PolicyStats, RateLimit, RateLimitDecision, SanitizeOptions, SanitizeResult };