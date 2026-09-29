/**
 * retrieval.ts
 *
 * `PolicyEvaluator` â€” the decision engine of the MAM Security Policy layer.
 *
 * The evaluator turns a {@link PolicyRequest} into a {@link PolicyResult} and
 * additionally owns the three defensive security utilities the engine exposes
 * to callers:
 *
 * 1. **Policy evaluation** â€” {@link evaluate} matches candidate rules against
 *    the request (subject/action/resource triple, optional condition),
 *    scores them with {@link compareRules} (most specific first, then highest
 *    priority, then insertion order) and applies the winning rule's effect.
 *    When no rule matches, the configured `defaultEffect` (default `deny`)
 *    applies â€” the engine fails closed.
 * 2. **Input sanitization** â€” {@link sanitize} strips script-bearing
 *    elements, JavaScript URL schemes, event handler attributes and (optionally)
 *    every tag, collapses whitespace and enforces a length cap, returning a
 *    {@link SanitizeResult} with change/removal counters.
 * 3. **Rate limiting** â€” {@link checkRateLimit} implements a sliding-window
 *    limiter keyed by an arbitrary string; each check prunes expired hits,
 *    admits the request while under `max` and reports `retryAfterMs` on
 *    denial.
 * 4. **Dependency validation** â€” {@link validateDependencies} enforces an
 *    allowlist over module/dependency names, rejecting anything not present.
 *
 * The evaluator is an {@link EventEmitter}: it emits `evaluated`,
 * `rateLimited` and `sanitized` events that the lifecycle layer fans out into
 * typed subscriptions and audit pipelines.
 *
 * @module policy/retrieval
 */

import { EventEmitter } from 'node:events';

import {
  allowResult,
  assertRateLimit,
  createEmptyStats,
  createPolicyRequest,
  createSanitizeResult,
  denyResult,
  describePolicyRequest,
  isPolicyRequest,
  resolvePolicyConfig,
  ruleMatches,
  compareRules,
  type DependencyValidationResult,
  type PolicyConfig,
  type PolicyRequest,
  type PolicyResult,
  type PolicyRule,
  type PolicyStats,
  type RateLimit,
  type RateLimitDecision,
  type RateLimitState,
  type SanitizeOptions,
  type SanitizeResult,
} from './types.js';
import type { PolicyStore } from './store.js';
import type { PolicyIndex } from './index.js';

/** Options accepted by the {@link PolicyEvaluator} constructor. */
export interface PolicyEvaluatorOptions {
  /** Behavioural overrides merged over {@link DEFAULT_POLICY_CONFIG}. */
  config?: Partial<PolicyConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * Default sanitization behaviour when no per-call options are supplied. The
 * values mirror {@link DEFAULT_POLICY_CONFIG}.
 */
const DEFAULT_SANITIZE_OPTIONS: Readonly<SanitizeOptions> = Object.freeze({
  maxLength: 10_000,
  stripJs: true,
  stripTags: true,
  normalizeWhitespace: false,
});

/**
 * Evaluates security rules and performs defensive utilities for the policy
 * engine.
 *
 * @example
 * ```ts
 * const evaluator = new PolicyEvaluator(store, index);
 * const result = evaluator.evaluate({ subject: 'u-1', action: 'read', resource: 'document' });
 * if (!result.allowed) { /* deny *\/ }
 * const safe = evaluator.sanitize(userInput);
 * const limited = evaluator.checkRateLimit('api:u-1', { windowMs: 60_000, max: 10 });
 * ```
 */
export class PolicyEvaluator extends EventEmitter {
  private readonly store: PolicyStore;
  private readonly index: PolicyIndex | undefined;
  private readonly config: PolicyConfig;
  private readonly now: () => number;

  /** Lifetime count of evaluated requests. */
  private evaluations = 0;
  /** Lifetime count of allowed outcomes. */
  private allows = 0;
  /** Lifetime count of denied outcomes. */
  private denies = 0;
  /** Lifetime count of rate-limit checks. */
  private rateLimitChecks = 0;
  /** Lifetime count of rate-limited hits. */
  private rateLimited = 0;
  /** Lifetime count of sanitization passes. */
  private sanitizations = 0;
  /** Lifetime count of characters removed by sanitization. */
  private sanitizedRemoved = 0;
  /** Lifetime count of dependency validations. */
  private dependenciesValidated = 0;
  /** Lifetime count of failed dependency validations. */
  private dependencyFailures = 0;
  /** Epoch ms of the most recent evaluation. */
  private lastEvaluationAt: number | undefined;

  /** Rate-limit buckets keyed by the caller's key. */
  private readonly rateLimitStates = new Map<string, RateLimitState>();

  /**
   * Creates an evaluator bound to a store (and optionally an index).
   *
   * @param store The policy rule registry to resolve rules from.
   * @param index Optional index used to narrow candidate rules.
   * @param options Configuration overrides and clock injection.
   */
  constructor(store: PolicyStore, index?: PolicyIndex, options: PolicyEvaluatorOptions = {}) {
    super();
    this.store = store;
    this.index = index;
    this.config = resolvePolicyConfig(options.config);
    this.now = options.now ?? (() => Date.now());
    this.setMaxListeners(64);
  }

  /**
   * Evaluates a single policy request and returns a decision.
   *
   * Candidate rules are narrowed by the index (when present) or scanned from
   * the store, then scored with {@link compareRules}: the most specific match
   * wins, ties broken by highest priority and then insertion order. The
   * winning rule's effect decides the outcome; with no matching rule the
   * configured `defaultEffect` (default `deny`) applies.
   *
   * Never throws for malformed requests unless `config.rejectInvalidRequests`
   * is set â€” otherwise they produce an `invalid-request` denial.
   *
   * @param request The request to evaluate.
   * @returns A {@link PolicyResult} describing the outcome.
   * @throws {TypeError} when the request is invalid and strict mode is on.
   */
  evaluate(request: PolicyRequest): PolicyResult {
    const at = this.now();
    this.evaluations += 1;
    this.lastEvaluationAt = at;

    let result: PolicyResult;
    if (!isPolicyRequest(request)) {
      if (this.config.rejectInvalidRequests) {
        throw new TypeError('Invalid policy request: expected optional subject/action/resource strings');
      }
      result = denyResult('invalid-request', undefined, request, at);
    } else {
      const candidate = this.candidates(request);
      const best = this.bestMatch(candidate, request);
      if (!best) {
        result = this.config.defaultEffect === 'allow'
          ? allowResult(this.fallbackRule('allow'), request, at)
          : denyResult('default-deny', undefined, request, at);
      } else {
        result = best.effect === 'allow'
          ? allowResult(best, request, at)
          : denyResult('denied', best, request, at);
      }
    }

    if (result.allowed) {
      this.allows += 1;
    } else {
      this.denies += 1;
    }
    this.emit('evaluated', result, request);
    return result;
  }

  /**
   * Evaluates many requests, returning a result per request in order.
   *
   * @param requests The requests to evaluate.
   * @returns An array of results aligned with `requests`.
   */
  evaluateMany(requests: readonly PolicyRequest[]): PolicyResult[] {
    return requests.map((request) => this.evaluate(request));
  }

  /**
   * Convenience predicate: does the request evaluate to `allowed`?
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
   * @returns `true` when all results are allowed.
   */
  canAll(requests: readonly PolicyRequest[]): boolean {
    for (const request of requests) {
      if (!this.evaluate(request).allowed) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns `true` when at least one request is permitted.
   *
   * @param requests The requests to evaluate.
   * @returns `true` when any result is allowed.
   */
  canAny(requests: readonly PolicyRequest[]): boolean {
    for (const request of requests) {
      if (this.evaluate(request).allowed) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sanitizes a string input, removing dangerous content and enforcing a
   * length cap.
   *
   * When `stripJs` is enabled (default) script-bearing elements, `javascript:`
   * URLs and inline `on*` handler attributes are removed. When `stripTags` is
   * enabled (default) every remaining HTML/XML tag is stripped. An optional
   * per-character `charFilter` allows a fully custom allowlist.
   *
   * @param input The raw input to sanitize.
   * @param opts Per-call sanitization options (merge over defaults).
   * @returns A {@link SanitizeResult} with the output and change counters.
   */
  sanitize(input: string, opts: SanitizeOptions = {}): SanitizeResult {
    const options: SanitizeOptions = {
      maxLength: opts.maxLength ?? this.config.maxInputLength ?? DEFAULT_SANITIZE_OPTIONS.maxLength,
      stripJs: opts.stripJs ?? this.config.stripJs ?? DEFAULT_SANITIZE_OPTIONS.stripJs,
      stripTags: opts.stripTags ?? this.config.stripTags ?? DEFAULT_SANITIZE_OPTIONS.stripTags,
      normalizeWhitespace: opts.normalizeWhitespace ?? this.config.normalizeWhitespace ?? false,
      charFilter: opts.charFilter,
    };
    const original = String(input);
    let value = original;
    let removed = 0;

    if (options.stripJs) {
      const before = value;
      value = value
        .replace(/<\s*(script|iframe|object|embed|link|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*\/?\s*(script|iframe|object|embed|link|style)\b[^>]*>/gi, '')
        .replace(/javascript\s*:/gi, '')
        .replace(/on[a-z]+\s*=/gi, '');
      removed += before.length - value.length;
    }

    if (options.stripTags) {
      const before = value;
      value = value.replace(/<[^>]*>/g, '');
      removed += before.length - value.length;
    }

    if (options.normalizeWhitespace) {
      value = value.replace(/\s+/g, ' ').trim();
    }

    if (options.charFilter) {
      let filtered = '';
      for (const char of value) {
        if (options.charFilter(char)) {
          filtered += char;
        }
      }
      removed += value.length - filtered.length;
      value = filtered;
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      removed += value.length - options.maxLength;
      value = value.slice(0, options.maxLength);
    }

    this.sanitizations += 1;
    this.sanitizedRemoved += removed;
    const result = createSanitizeResult(value, value !== original, removed, original.length, value.length);
    this.emit('sanitized', result, input);
    return result;
  }

  /**
   * Performs a sliding-window rate-limit check for a key.
   *
   * Hits older than `windowMs` are pruned before the check. When the number of
   * hits still inside the window equals or exceeds `max`, the hit is denied
   * and `retryAfterMs` reports how long until the oldest hit falls out of the
   * window.
   *
   * @param key Arbitrary bucket key (ip, user id, endpoint, â€¦).
   * @param rateLimit The window/max specification (validated).
   * @returns A {@link RateLimitDecision} describing admission and state.
   * @throws {TypeError} when the rate limit is malformed.
   */
  checkRateLimit(key: string, rateLimit: RateLimit): RateLimitDecision {
    assertRateLimit(rateLimit, 'rate limit');
    const at = this.now();
    this.rateLimitChecks += 1;
    const cutoff = at - rateLimit.windowMs;
    const previous = this.rateLimitStates.get(key);
    const timestamps = previous
      ? previous.timestamps.filter((timestamp) => timestamp > cutoff)
      : [];

    if (timestamps.length >= rateLimit.max) {
      const retryAfterMs = Math.max(0, timestamps[0] + rateLimit.windowMs - at);
      const state = this.storeState(key, rateLimit, timestamps, at);
      this.rateLimited += 1;
      this.emit('rateLimited', key, at, retryAfterMs, state);
      return {
        allowed: false,
        retryAfterMs,
        remaining: 0,
        state,
        at,
      };
    }

    timestamps.push(at);
    const state = this.storeState(key, rateLimit, timestamps, at);
    this.emit('rateLimited', key, at, 0, state);
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: rateLimit.max - timestamps.length,
      state,
      at,
    };
  }

  /**
   * Returns the current state of a rate-limit bucket without performing a
   * check (no hit is recorded, no counters change).
   *
   * @param key Bucket key to inspect.
   * @returns The stored state, or `undefined` when the key was never checked.
   */
  getRateLimitState(key: string): RateLimitState | undefined {
    const state = this.rateLimitStates.get(key);
    return state ? this.freezeState(state) : undefined;
  }

  /**
   * Returns the number of live rate-limit buckets.
   */
  get rateLimitBucketCount(): number {
    return this.rateLimitStates.size;
  }

  /**
   * Removes every rate-limit bucket.
   */
  clearRateLimits(): void {
    this.rateLimitStates.clear();
  }

  /**
   * Removes a single rate-limit bucket.
   *
   * @param key Bucket key to remove.
   * @returns `true` when a bucket existed and was removed.
   */
  resetRateLimit(key: string): boolean {
    return this.rateLimitStates.delete(key);
  }

  /**
   * Prunes rate-limit buckets whose every hit has expired (no hit within the
   * last `windowMs`). Runs periodically via the lifecycle layer and
   * prevents unbounded memory growth on high-cardinality keys.
   *
   * @param now Optional reference time (defaults to the injected clock).
   * @returns The number of buckets pruned.
   */
  pruneExpiredRateLimits(now?: number): number {
    const at = now ?? this.now();
    let pruned = 0;
    for (const [key, state] of this.rateLimitStates) {
      const cutoff = at - state.windowMs;
      const live = state.timestamps.filter((timestamp) => timestamp > cutoff);
      if (live.length === 0) {
        this.rateLimitStates.delete(key);
        pruned += 1;
      } else if (live.length !== state.timestamps.length) {
        this.rateLimitStates.set(key, this.freezeState({ ...state, timestamps: live, lastCheckedAt: at }));
      }
    }
    return pruned;
  }

  /**
   * Validates a dependency/module allowlist: every referenced dependency must
   * appear in (or match) `allowed`.
   *
   * `deps` may be a single name string, an array of names, or a record of
   * `name â†’ version` entries. Allowlist entries may use a trailing `*` glob
   * (e.g. `@scope/*`) to match a whole namespace.
   *
   * @param deps The referenced dependencies.
   * @param allowed The allowlist (names or glob patterns).
   * @returns A {@link DependencyValidationResult}.
   */
  validateDependencies(deps: unknown, allowed: readonly string[]): DependencyValidationResult {
    this.dependenciesValidated += 1;
    const names = normalizeDependencyNames(deps);
    const allow = new Set(allowed.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
    const globs = Array.from(allow).filter((entry) => entry.endsWith('*'));
    const exact = Array.from(allow).filter((entry) => !entry.endsWith('*'));

    const unknown: string[] = [];
    const known: string[] = [];
    for (const name of names) {
      const matched = exact.includes(name) || globs.some((glob) => globMatch(glob, name));
      if (matched) {
        known.push(name);
      } else {
        unknown.push(name);
      }
    }

    const valid = unknown.length === 0;
    if (!valid) {
      this.dependencyFailures += 1;
    }
    const result: DependencyValidationResult = {
      valid,
      unknown,
      allowed: known,
      reason: valid ? undefined : `Dependencies not on the allowlist: ${unknown.join(', ')}`,
    };
    return Object.freeze(result);
  }

  /**
   * Produces a human-readable explanation of a request's outcome.
   *
   * @param request The request to describe.
   * @returns A one-line summary including the decision.
   */
  describe(request: PolicyRequest): string {
    const result = this.evaluate(request);
    return `${describePolicyRequest(request)} => ${result.allowed ? 'ALLOW' : 'DENY'} (${result.reason})`;
  }

  /**
   * Computes aggregate statistics about the evaluator.
   *
   * @returns A fresh {@link PolicyStats} reflecting evaluator activity.
   */
  stats(): PolicyStats {
    const base = createEmptyStats();
    const storeStats = this.store.stats();
    const indexStats = this.index ? this.index.stats() : undefined;
    return {
      ...base,
      rules: storeStats.rules,
      enabled: storeStats.enabled,
      disabled: storeStats.disabled,
      allowRules: storeStats.allowRules,
      denyRules: storeStats.denyRules,
      evaluations: this.evaluations,
      allows: this.allows,
      denies: this.denies,
      rateLimitChecks: this.rateLimitChecks,
      rateLimited: this.rateLimited,
      sanitizations: this.sanitizations,
      sanitizedRemoved: this.sanitizedRemoved,
      dependenciesValidated: this.dependenciesValidated,
      dependencyFailures: this.dependencyFailures,
      indexActions: indexStats?.actions ?? 0,
      indexResources: indexStats?.resources ?? 0,
      indexSubjects: indexStats?.subjects ?? 0,
      indexEffects: indexStats?.effects ?? 0,
      lastEvaluationAt: this.lastEvaluationAt,
    };
  }

  /**
   * The index currently used for candidate narrowing (if any).
   */
  get policyIndex(): PolicyIndex | undefined {
    return this.index;
  }

  /**
   * The store this evaluator reads rules from.
   */
  get policyStore(): PolicyStore {
    return this.store;
  }

  /**
   * Internal: gathers the candidate rules for a request from the index (when
   * present) or the whole store.
   */
  private candidates(request: PolicyRequest): PolicyRule[] {
    if (this.index) {
      return this.index.find({ subject: request.subject, action: request.action, resource: request.resource });
    }
    return this.store.listRules();
  }

  /**
   * Internal: scores the candidates, returning the single best matching rule
   * or `undefined` when none match.
   */
  private bestMatch(candidates: readonly PolicyRule[], request: PolicyRequest): PolicyRule | undefined {
    const matches: PolicyRule[] = [];
    for (const rule of candidates) {
      if (ruleMatches(rule, request)) {
        matches.push(rule);
      }
    }
    if (matches.length === 0) {
      return undefined;
    }
    matches.sort(compareRules);
    return matches[0];
  }

  /**
   * Internal: builds and stores a frozen {@link RateLimitState} for a bucket.
   */
  private storeState(key: string, rateLimit: RateLimit, timestamps: number[], at: number): RateLimitState {
    const state = this.freezeState({
      key,
      windowMs: rateLimit.windowMs,
      max: rateLimit.max,
      timestamps,
      lastCheckedAt: at,
    });
    this.rateLimitStates.set(key, state);
    return state;
  }

  /**
   * Internal: returns a structurally-shared frozen copy of a state.
   */
  private freezeState(state: RateLimitState): RateLimitState {
    return Object.freeze({ ...state, timestamps: Object.freeze(Array.from(state.timestamps)) });
  }

  /**
   * Internal: the synthetic rule used when `defaultEffect` is `allow` so the
   * result carries a well-formed, self-describing rule.
   */
  private fallbackRule(effect: 'allow'): PolicyRule {
    return Object.freeze({
      id: '__default_allow__',
      name: 'default allow',
      effect,
      createdAt: 0,
    });
  }
}

/**
 * Normalizes a dependency value into a de-duplicated name list.
 */
function normalizeDependencyNames(deps: unknown): string[] {
  const out: string[] = [];
  const push = (name: unknown): void => {
    if (typeof name === 'string' && name.trim().length > 0 && !out.includes(name.trim())) {
      out.push(name.trim());
    }
  };
  if (typeof deps === 'string') {
    push(deps);
  } else if (Array.isArray(deps)) {
    for (const entry of deps) {
      push(entry);
    }
  } else if (deps && typeof deps === 'object') {
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      push(name);
    }
  }
  return out;
}

/**
 * Matches a glob allowlist entry (trailing `*`) against a dependency name.
 * The glob matches a leading namespace, e.g. `@scope/*` matches `@scope/a`.
 */
function globMatch(glob: string, name: string): boolean {
  const prefix = glob.slice(0, -1);
  return name.startsWith(prefix);
}

/**
 * Convenience factory building an evaluator over a store and optional index.
 *
 * @param store The policy rule registry.
 * @param index Optional policy index.
 * @param options Configuration overrides.
 * @returns A configured {@link PolicyEvaluator}.
 */
export function createPolicyEvaluator(
  store: PolicyStore,
  index?: PolicyIndex,
  options: PolicyEvaluatorOptions = {},
): PolicyEvaluator {
  return new PolicyEvaluator(store, index, options);
}

/**
 * Convenience that builds a request and evaluates it in one call.
 *
 * @param store The policy rule registry.
 * @param request The request dimensions to evaluate.
 * @param options Evaluator options.
 * @returns The resulting {@link PolicyResult}.
 */
export function evaluateAgainst(
  store: PolicyStore,
  request: { subject?: string; action?: string; resource?: string },
  options: PolicyEvaluatorOptions = {},
): PolicyResult {
  const evaluator = new PolicyEvaluator(store, undefined, options);
  return evaluator.evaluate(createPolicyRequest(request));
}

/**
 * Type-only re-export for integration consumers.
 */
export type { PolicyConfig, PolicyRequest, PolicyResult, PolicyStats, RateLimit, RateLimitDecision, RateLimitState, SanitizeOptions, SanitizeResult };
