/**
 * types.ts
 *
 * Canonical type definitions, constants, type guards, factories, defaults and
 * pure helpers for the MAM Security Policy layer.
 *
 * The policy engine evaluates security rules of the form *"for a subject
 * performing an action on a resource, allow or deny"*. Every entity that flows
 * through the pipeline — rules, definitions, requests, results, rate limits,
 * sanitization output, dependency checks, configuration and statistics — is
 * described here so the store, index, retrieval, lifecycle and integration
 * layers share one canonical shape.
 *
 * A {@link PolicyRule} is the atomic unit: it carries an `effect`
 * (`allow` | `deny`), an optional subject/action/resource triple (each may be
 * a wildcard), an optional predicate {@link PolicyCondition}, an optional
 * priority and an enabled flag. When a request arrives, matching rules are
 * selected by the index, narrowed by the evaluator and the *most specific*
 * match (ties broken by *highest priority*, then insertion order) decides the
 * outcome. If no rule matches, the configured `defaultEffect` (default
 * `deny`) applies.
 *
 * Guard functions follow the "narrow before use" philosophy: callers can rely
 * on the returned predicates to reduce an `unknown` payload to a fully typed
 * entity without casting. Factories freeze their results so stored records
 * cannot be mutated through a shared reference, and the constant defaults are
 * frozen so a freshly constructed engine is safe to drop into any Node
 * process.
 *
 * Functions (conditions, context readers) are first-class values and therefore
 * cannot be serialized; the snapshot format defined in `store.ts` drops them
 * deliberately, and everything else round-trips cleanly.
 *
 * @module policy/types
 */

/** Allow effect marker. A rule with this effect grants its triple. */
export const ALLOW = 'allow';
/** Deny effect marker. A rule with this effect forbids its triple. */
export const DENY = 'deny';

/** Wildcard subject marker. A rule whose subject equals this applies to any subject. */
export const SUBJECT_ANY = '*';
/** Wildcard action marker. A rule whose action equals this applies to any action. */
export const ACTION_ANY = '*';
/** Wildcard resource marker. A rule whose resource equals this applies to any resource. */
export const RESOURCE_ANY = '*';

/** Schema version stamped into serialized store snapshots so future formats can migrate safely. */
export const POLICY_SNAPSHOT_VERSION = 1;

/** Default cap on sanitized input length (characters) when none is supplied. */
export const DEFAULT_MAX_INPUT_LENGTH = 10_000;

/** Default rate-limit window (ms) used when a policy omits its own window. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Default maximum number of hits within a rate-limit window. */
export const DEFAULT_RATE_LIMIT_MAX = 100;

/** Default interval (ms) between periodic rate-limit garbage-collection passes. */
export const DEFAULT_GC_INTERVAL_MS = 30_000;

/**
 * The effect a rule produces when it matches: `allow` grants the request,
 * `deny` forbids it.
 */
export type PolicyEffect = 'allow' | 'deny';

/**
 * Enumerated reasons a {@link PolicyResult} was produced. Kept as a
 * string-literal union so switch statements remain exhaustively checkable.
 */
export type PolicyReason =
  /** The request matched an allow rule. */
  | 'allowed'
  /** The request matched a deny rule. */
  | 'denied'
  /** No rule matched and the default effect applied (deny by default). */
  | 'default-deny'
  /** The request object failed structural validation. */
  | 'invalid-request';

/**
 * A security query: "may `subject` perform `action` on `resource`?".
 *
 * Every dimension is optional — a request may name only an action and
 * resource (ignoring the subject), only a resource, and so on. An omitted
 * dimension matches any rule that also omits it or declares a wildcard.
 *
 * `context` is application-defined and opaque to the core engine; it is
 * threaded into {@link PolicyCondition} callbacks so conditions can make
 * environment-aware decisions (region, time-of-day, risk score…).
 */
export interface PolicyRequest {
  /** Identity performing the action (optional). */
  readonly subject?: string;
  /** The action being requested (e.g. `read`, `execute`, `admin`). */
  readonly action?: string;
  /** The resource being acted upon (e.g. `document`, `module`, `endpoint`). */
  readonly resource?: string;
  /** Opaque application context exposed to rule conditions. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * A predicate attached to a {@link PolicyRule}. When present, the rule only
 * matches requests for which the predicate returns `true`. Conditions are the
 * ABAC extension point: they can read `request.context` and any captured
 * application state, but must be pure functions to remain deterministic.
 */
export type PolicyCondition = (request: PolicyRequest) => boolean;

/**
 * An atomic security statement: for a subject performing an action on a
 * resource (optionally guarded by a condition), allow or deny.
 *
 * Matching semantics:
 * - An omitted dimension matches any request value for that dimension.
 * - A wildcard value (`*`) matches any request value for that dimension.
 * - A concrete value matches requests carrying that exact value.
 * - When `condition` is present it must also return `true`.
 * - `priority` breaks ties: among equally specific matches, higher priority
 *   wins.
 * - `enabled === false` rules are ignored during evaluation.
 */
export interface PolicyRule {
  /** Stable, unique rule identifier (used for remove/enable/disable). */
  readonly id: string;
  /** Optional human-readable name describing the rule's intent. */
  readonly name?: string;
  /** The effect applied when the rule matches. */
  readonly effect: PolicyEffect;
  /** Optional subject the rule applies to. */
  readonly subject?: string;
  /** Optional action the rule applies to. */
  readonly action?: string;
  /** Optional resource the rule applies to. */
  readonly resource?: string;
  /** Optional predicate that must return `true` for the rule to match. */
  readonly condition?: PolicyCondition;
  /** Optional tie-breaker; higher priorities win among equally specific matches. */
  readonly priority?: number;
  /** When `false`, the rule is ignored during evaluation. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Epoch ms timestamp recording when the rule was created. */
  readonly createdAt: number;
  /** Free-form application metadata attached to the rule. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A loose input shape accepted by the store's `addRule`/`addMany` and by the
 * engine's `addRule`. Every field except `id` is optional; the store applies
 * sensible defaults (allow-unspecified effect, no wildcards replaced, current
 * wall clock, enabled) and freezes the resulting {@link PolicyRule}.
 */
export interface PolicyDefinition {
  /** Stable, unique rule identifier. */
  readonly id: string;
  /** Optional human-readable name. */
  readonly name?: string;
  /** Desired effect; defaults to `deny` when omitted. */
  readonly effect?: PolicyEffect;
  /** Optional subject constraint. */
  readonly subject?: string;
  /** Optional action constraint. */
  readonly action?: string;
  /** Optional resource constraint. */
  readonly resource?: string;
  /** Optional predicate condition. */
  readonly condition?: PolicyCondition;
  /** Optional priority tie-breaker. */
  readonly priority?: number;
  /** Optional enabled flag; defaults to `true`. */
  readonly enabled?: boolean;
  /** Optional creation timestamp; defaults to the current wall clock. */
  readonly createdAt?: number;
  /** Optional metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The outcome of evaluating a {@link PolicyRequest}. Always carries `allowed`
 * and a reason; when a rule produced the outcome, both the full rule and its
 * id are attached so callers can implement audit trails and per-rule
 * post-processing.
 */
export interface PolicyResult {
  /** Whether the request is permitted. */
  readonly allowed: boolean;
  /** Why the outcome was produced (always present). */
  readonly reason: PolicyReason;
  /** The rule that produced the outcome (matched-rule outcomes only). */
  readonly rule?: PolicyRule;
  /** The id of the matched rule (matched-rule outcomes only). */
  readonly matchedRuleId?: string;
  /** Epoch ms timestamp of the evaluation. */
  readonly at: number;
}

/**
 * A rate-limit specification: at most `max` hits are admitted within any
 * sliding `windowMs` window.
 */
export interface RateLimit {
  /** Length of the sliding window in milliseconds. */
  readonly windowMs: number;
  /** Maximum number of admitted hits within the window. */
  readonly max: number;
}

/**
 * The persisted state of one rate-limit bucket, keyed by the caller's `key`.
 *
 * `timestamps` holds the epochs of every hit currently inside the sliding
 * window (newest last). The state is frozen on storage and replaced on each
 * check, never mutated in place, so concurrent readers observe a consistent
 * snapshot.
 */
export interface RateLimitState {
  /** The bucket key. */
  readonly key: string;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Maximum admitted hits per window. */
  readonly max: number;
  /** Epochs of hits currently within the window (newest last). */
  readonly timestamps: readonly number[];
  /** Epoch ms of the last check performed against this bucket. */
  readonly lastCheckedAt: number;
}

/**
 * The outcome of a single {@link RateLimit} check. `allowed` is `true` when
 * the hit was admitted; on denial, `retryAfterMs` is the caller-visible
 * minimum delay before retrying.
 */
export interface RateLimitDecision {
  /** Whether the hit was admitted. */
  readonly allowed: boolean;
  /** Minimum delay in ms before a retry is likely to succeed (0 when allowed). */
  readonly retryAfterMs: number;
  /** Hits remaining in the current window (0 when denied). */
  readonly remaining: number;
  /** The post-check bucket state. */
  readonly state: RateLimitState;
  /** Epoch ms of the check. */
  readonly at: number;
}

/**
 * Options controlling a single {@link sanitize} pass. All fields are optional
 * and default to the {@link DEFAULT_POLICY_CONFIG} policy defaults.
 */
export interface SanitizeOptions {
  /** Maximum output length in characters; longer input is truncated. */
  readonly maxLength?: number;
  /** When `true`, strip script-bearing elements and `javascript:` URLs. */
  readonly stripJs?: boolean;
  /** When `true`, strip all HTML/XML tags. */
  readonly stripTags?: boolean;
  /** When `true`, collapse runs of whitespace to a single space and trim. */
  readonly normalizeWhitespace?: boolean;
  /** Optional custom character filter invoked per character (returns `true` to keep). */
  readonly charFilter?: (char: string) => boolean;
}

/**
 * The result of a sanitization pass. `changed` is `true` whenever the output
 * differs from the input; `removed` counts how many characters were stripped
 * or truncated so callers can log abuse.
 */
export interface SanitizeResult {
  /** The sanitized output string. */
  readonly sanitized: string;
  /** Whether the output differs from the input. */
  readonly changed: boolean;
  /** Number of characters removed by sanitization/truncation. */
  readonly removed: number;
  /** Length of the original input. */
  readonly originalLength: number;
  /** Length of the sanitized output. */
  readonly sanitizedLength: number;
}

/**
 * The outcome of a dependency/module allowlist validation. `valid` is `true`
 * only when every referenced dependency appears in (or matches) the allowlist.
 */
export interface DependencyValidationResult {
  /** Whether every dependency is allowed. */
  readonly valid: boolean;
  /** Dependencies that were referenced but not allowed. */
  readonly unknown: readonly string[];
  /** Dependencies that were recognized as allowed. */
  readonly allowed: readonly string[];
  /** Optional human-readable explanation (present on failure). */
  readonly reason?: string;
}

/**
 * Construction and runtime tuning knobs for the policy engine. Values are
 * intentionally conservative so a freshly constructed engine is immediately
 * usable in any Node process.
 */
export interface PolicyConfig {
  /** Effect applied when no rule matches. Defaults to `deny` (fail closed). */
  readonly defaultEffect?: PolicyEffect;
  /** Default sanitization length cap. Defaults to {@link DEFAULT_MAX_INPUT_LENGTH}. */
  readonly maxInputLength?: number;
  /** Default for stripping script-bearing content during sanitization. */
  readonly stripJs?: boolean;
  /** Default for stripping all tags during sanitization. */
  readonly stripTags?: boolean;
  /** Default for collapsing whitespace during sanitization. */
  readonly normalizeWhitespace?: boolean;
  /** Default sliding window (ms) for engine-level `rateLimit` calls. */
  readonly rateLimitWindowMs?: number;
  /** Default maximum hits for engine-level `rateLimit` calls. */
  readonly rateLimitMax?: number;
  /** Default interval (ms) for periodic rate-limit GC. */
  readonly gcIntervalMs?: number;
  /** Application name recorded for audit / stats purposes. */
  readonly appName?: string;
  /**
   * When `true`, structurally invalid requests throw; when `false` they
   * produce an `invalid-request` denial. Defaults to `false`.
   */
  readonly rejectInvalidRequests?: boolean;
}

/**
 * Aggregate counters describing the state and activity of the policy engine.
 * Produced by `stats()` on the store, index, evaluator, lifecycle and the
 * composite engine, and safe to serialize for metrics endpoints.
 */
export interface PolicyStats {
  /** Number of registered rules. */
  rules: number;
  /** Number of enabled rules. */
  enabled: number;
  /** Number of disabled rules. */
  disabled: number;
  /** Number of allow rules. */
  allowRules: number;
  /** Number of deny rules. */
  denyRules: number;
  /** Lifetime count of policy evaluations. */
  evaluations: number;
  /** Lifetime count of allowed outcomes. */
  allows: number;
  /** Lifetime count of denied outcomes. */
  denies: number;
  /** Lifetime count of rate-limit checks. */
  rateLimitChecks: number;
  /** Lifetime count of rate-limited (denied) hits. */
  rateLimited: number;
  /** Lifetime count of sanitization passes. */
  sanitizations: number;
  /** Lifetime count of characters removed by sanitization. */
  sanitizedRemoved: number;
  /** Lifetime count of dependency validations. */
  dependenciesValidated: number;
  /** Lifetime count of failed dependency validations. */
  dependencyFailures: number;
  /** Distinct indexed actions in the policy index. */
  indexActions: number;
  /** Distinct indexed resources in the policy index. */
  indexResources: number;
  /** Distinct indexed subjects in the policy index. */
  indexSubjects: number;
  /** Distinct indexed effects in the policy index. */
  indexEffects: number;
  /** Epoch ms of the last evaluation (undefined before the first). */
  lastEvaluationAt?: number;
}

/**
 * Immutable default configuration. A shallow freeze prevents accidental
 * mutation of shared defaults; per-instance configs are resolved copies.
 */
export const DEFAULT_POLICY_CONFIG: Readonly<PolicyConfig> = Object.freeze({
  defaultEffect: 'deny',
  maxInputLength: DEFAULT_MAX_INPUT_LENGTH,
  stripJs: true,
  stripTags: true,
  normalizeWhitespace: false,
  rateLimitWindowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
  rateLimitMax: DEFAULT_RATE_LIMIT_MAX,
  gcIntervalMs: DEFAULT_GC_INTERVAL_MS,
  appName: 'mam-policy',
  rejectInvalidRequests: false,
});

/**
 * Returns `true` when `value` is a non-null object (not an array, not null).
 *
 * @param value Any runtime value.
 * @returns `true` when the value is a record-like object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns `true` when `value` is a non-empty, non-whitespace string usable as
 * an identifier (rule id, subject, action, resource).
 *
 * @param value Any runtime value.
 * @returns `true` for a usable identifier string.
 */
export function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns `true` when `value` is a valid rule id: a non-empty string.
 *
 * @param value Any runtime value.
 * @returns `true` for a usable rule id.
 */
export function isValidRuleId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns `true` when `value` equals the wildcard marker (or is undefined),
 * i.e. the value imposes no constraint on its dimension.
 *
 * @param value A candidate subject/action/resource value.
 * @returns `true` when the value is unconstrained.
 */
export function isWildcard(value: string | undefined): boolean {
  return value === undefined || value === '*';
}

/**
 * Runtime type guard for {@link PolicyRequest}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `PolicyRequest`.
 */
export function isPolicyRequest(value: unknown): value is PolicyRequest {
  if (!isRecord(value)) return false;
  if (value.subject !== undefined && typeof value.subject !== 'string') return false;
  if (value.action !== undefined && typeof value.action !== 'string') return false;
  if (value.resource !== undefined && typeof value.resource !== 'string') return false;
  if (value.context !== undefined && !isRecord(value.context)) return false;
  return true;
}

/**
 * Runtime type guard for {@link PolicyRule}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `PolicyRule`.
 */
export function isPolicyRule(value: unknown): value is PolicyRule {
  if (!isRecord(value)) return false;
  if (!isValidRuleId(value.id)) return false;
  if (value.effect !== 'allow' && value.effect !== 'deny') return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.subject !== undefined && typeof value.subject !== 'string') return false;
  if (value.action !== undefined && typeof value.action !== 'string') return false;
  if (value.resource !== undefined && typeof value.resource !== 'string') return false;
  if (value.condition !== undefined && typeof value.condition !== 'function') return false;
  if (value.priority !== undefined && typeof value.priority !== 'number') return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link PolicyDefinition}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `PolicyDefinition`.
 */
export function isPolicyDefinition(value: unknown): value is PolicyDefinition {
  if (!isRecord(value)) return false;
  if (!isValidRuleId(value.id)) return false;
  if (value.effect !== undefined && value.effect !== 'allow' && value.effect !== 'deny') return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.subject !== undefined && typeof value.subject !== 'string') return false;
  if (value.action !== undefined && typeof value.action !== 'string') return false;
  if (value.resource !== undefined && typeof value.resource !== 'string') return false;
  if (value.condition !== undefined && typeof value.condition !== 'function') return false;
  if (value.priority !== undefined && typeof value.priority !== 'number') return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link PolicyResult}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `PolicyResult`.
 */
export function isPolicyResult(value: unknown): value is PolicyResult {
  if (!isRecord(value)) return false;
  if (typeof value.allowed !== 'boolean') return false;
  if (typeof value.reason !== 'string') return false;
  if (value.matchedRuleId !== undefined && typeof value.matchedRuleId !== 'string') return false;
  if (value.at !== undefined && typeof value.at !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link RateLimit}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `RateLimit`.
 */
export function isRateLimit(value: unknown): value is RateLimit {
  if (!isRecord(value)) return false;
  if (typeof value.windowMs !== 'number' || value.windowMs <= 0) return false;
  if (typeof value.max !== 'number' || value.max <= 0) return false;
  return true;
}

/**
 * Runtime type guard for {@link RateLimitState}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `RateLimitState`.
 */
export function isRateLimitState(value: unknown): value is RateLimitState {
  if (!isRecord(value)) return false;
  if (typeof value.key !== 'string') return false;
  if (typeof value.windowMs !== 'number') return false;
  if (typeof value.max !== 'number') return false;
  if (!Array.isArray(value.timestamps) || !value.timestamps.every((t) => typeof t === 'number')) return false;
  if (value.lastCheckedAt !== undefined && typeof value.lastCheckedAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link SanitizeResult}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `SanitizeResult`.
 */
export function isSanitizeResult(value: unknown): value is SanitizeResult {
  if (!isRecord(value)) return false;
  if (typeof value.sanitized !== 'string') return false;
  if (typeof value.changed !== 'boolean') return false;
  if (typeof value.removed !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link DependencyValidationResult}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `DependencyValidationResult`.
 */
export function isDependencyValidationResult(value: unknown): value is DependencyValidationResult {
  if (!isRecord(value)) return false;
  if (typeof value.valid !== 'boolean') return false;
  if (value.unknown !== undefined && !Array.isArray(value.unknown)) return false;
  if (value.allowed !== undefined && !Array.isArray(value.allowed)) return false;
  return true;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid rule.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link PolicyRule}.
 */
export function assertPolicyRule(value: unknown, label = 'rule'): PolicyRule {
  if (!isPolicyRule(value)) {
    throw new TypeError(`${label} is not a valid PolicyRule object`);
  }
  return value;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid definition.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link PolicyDefinition}.
 */
export function assertPolicyDefinition(value: unknown, label = 'rule definition'): PolicyDefinition {
  if (!isPolicyDefinition(value)) {
    throw new TypeError(`${label} is not a valid PolicyRule definition`);
  }
  return value;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid rate limit.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link RateLimit}.
 */
export function assertRateLimit(value: unknown, label = 'rate limit'): RateLimit {
  if (!isRateLimit(value)) {
    throw new TypeError(`${label} must be a RateLimit with a positive windowMs and max`);
  }
  return value;
}

/**
 * Factory for the zero-value statistics object used by every `stats()`.
 *
 * @returns A freshly allocated {@link PolicyStats} with all counters at zero.
 */
export function createEmptyStats(): PolicyStats {
  return {
    rules: 0,
    enabled: 0,
    disabled: 0,
    allowRules: 0,
    denyRules: 0,
    evaluations: 0,
    allows: 0,
    denies: 0,
    rateLimitChecks: 0,
    rateLimited: 0,
    sanitizations: 0,
    sanitizedRemoved: 0,
    dependenciesValidated: 0,
    dependencyFailures: 0,
    indexActions: 0,
    indexResources: 0,
    indexSubjects: 0,
    indexEffects: 0,
  };
}

/**
 * Merges a partial configuration over the frozen defaults and returns a
 * plain, fully-populated configuration object safe for downstream mutation.
 *
 * @param overrides Partial configuration overrides (may be empty).
 * @returns A complete, non-frozen {@link PolicyConfig}.
 */
export function resolvePolicyConfig(overrides: Partial<PolicyConfig> | undefined = {}): PolicyConfig {
  return { ...DEFAULT_POLICY_CONFIG, ...overrides };
}

/**
 * Builds a {@link PolicyRequest} from a partial description, filling nothing
 * for the optional fields.
 *
 * @param request The request core plus optional subject/context.
 * @returns A frozen {@link PolicyRequest}.
 */
export function createPolicyRequest(request: {
  subject?: string;
  action?: string;
  resource?: string;
  context?: Readonly<Record<string, unknown>>;
}): PolicyRequest {
  return Object.freeze({
    subject: request.subject,
    action: request.action,
    resource: request.resource,
    context: request.context ? { ...request.context } : undefined,
  });
}

/**
 * Builds a {@link PolicyRule} record from a loose definition, filling
 * defaults for every optional field and freezing the result.
 *
 * The supplied id is trimmed and validated; the effect defaults to `deny`
 * (fail closed); `enabled` defaults to `true`; `createdAt` defaults to the
 * current wall clock.
 *
 * @param definition The rule definition to normalize.
 * @returns A frozen {@link PolicyRule}.
 * @throws {TypeError} when the definition is structurally invalid.
 */
export function createPolicyRule(definition: PolicyDefinition): PolicyRule {
  assertPolicyDefinition(definition, 'policy rule definition');
  const id = definition.id.trim();
  return Object.freeze({
    id,
    name: definition.name,
    effect: definition.effect ?? DENY,
    subject: definition.subject,
    action: definition.action,
    resource: definition.resource,
    condition: definition.condition,
    priority: definition.priority,
    enabled: definition.enabled ?? true,
    createdAt: definition.createdAt ?? Date.now(),
    metadata: definition.metadata ? { ...definition.metadata } : undefined,
  });
}

/**
 * Convenience factory building an *allow* rule from raw dimensions. Ideal for
 * seeding permissive policy sets without constructing definition objects.
 *
 * @param id Unique rule id.
 * @param options Optional constraints and rule metadata.
 * @returns A frozen, enabled allow {@link PolicyRule}.
 */
export function createAllowRule(
  id: string,
  options: {
    name?: string;
    subject?: string;
    action?: string;
    resource?: string;
    condition?: PolicyCondition;
    priority?: number;
    metadata?: Readonly<Record<string, unknown>>;
  } = {},
): PolicyRule {
  return createPolicyRule({ id, name: options.name, effect: ALLOW, ...options });
}

/**
 * Convenience factory building a *deny* rule from raw dimensions. Ideal for
 * seeding blacklist policy sets.
 *
 * @param id Unique rule id.
 * @param options Optional constraints and rule metadata.
 * @returns A frozen, enabled deny {@link PolicyRule}.
 */
export function createDenyRule(
  id: string,
  options: {
    name?: string;
    subject?: string;
    action?: string;
    resource?: string;
    condition?: PolicyCondition;
    priority?: number;
    metadata?: Readonly<Record<string, unknown>>;
  } = {},
): PolicyRule {
  return createPolicyRule({ id, name: options.name, effect: DENY, ...options });
}

/**
 * Builds a {@link RateLimit} specification.
 *
 * @param windowMs Sliding window length in milliseconds (must be positive).
 * @param max Maximum admitted hits per window (must be positive).
 * @returns A frozen {@link RateLimit}.
 */
export function createRateLimit(windowMs: number, max: number): RateLimit {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError('windowMs must be a positive finite number');
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new TypeError('max must be a positive integer');
  }
  return Object.freeze({ windowMs, max });
}

/**
 * Builds a {@link SanitizeResult}.
 *
 * @param sanitized The sanitized output string.
 * @param changed Whether the output differs from the input.
 * @param removed Number of characters removed.
 * @param originalLength Length of the original input.
 * @param sanitizedLength Length of the sanitized output.
 * @returns A frozen {@link SanitizeResult}.
 */
export function createSanitizeResult(
  sanitized: string,
  changed: boolean,
  removed: number,
  originalLength: number,
  sanitizedLength: number,
): SanitizeResult {
  return Object.freeze({
    sanitized,
    changed,
    removed,
    originalLength,
    sanitizedLength,
  });
}

/**
 * Builds an allowed {@link PolicyResult} from the matching rule.
 *
 * @param rule The rule that produced the allow.
 * @param request The evaluated request (unused but kept for signature parity).
 * @param at Epoch ms of the evaluation (defaults to now).
 * @returns A frozen allowed result.
 */
export function allowResult(rule: PolicyRule, request?: PolicyRequest, at: number = Date.now()): PolicyResult {
  return Object.freeze({
    allowed: true,
    reason: 'allowed',
    rule,
    matchedRuleId: rule.id,
    at,
  });
}

/**
 * Builds a denied {@link PolicyResult}.
 *
 * @param reason Why the request was denied.
 * @param rule The rule that produced the denial (optional for default-deny).
 * @param request The evaluated request (unused but kept for signature parity).
 * @param at Epoch ms of the evaluation (defaults to now).
 * @returns A frozen denied result.
 */
export function denyResult(
  reason: PolicyReason,
  rule: PolicyRule | undefined,
  request?: PolicyRequest,
  at: number = Date.now(),
): PolicyResult {
  return Object.freeze({
    allowed: false,
    reason,
    rule,
    matchedRuleId: rule?.id,
    at,
  });
}

/**
 * Returns a specificity score for a rule: how many of its three dimensions
 * are unconstrained (omitted or wildcard). Lower scores mean a more specific
 * (less wildcard-y) match and win ties during evaluation.
 *
 * @param rule The rule to score.
 * @returns A number in the range 0 (fully specific) to 3 (fully wildcarded).
 */
export function ruleSpecificity(rule: PolicyRule): number {
  let score = 0;
  if (isWildcard(rule.subject)) score += 1;
  if (isWildcard(rule.action)) score += 1;
  if (isWildcard(rule.resource)) score += 1;
  return score;
}

/**
 * Core matching predicate: does `rule` apply to `request`?
 *
 * A dimension matches when the rule's value is wildcard/omitted or equals the
 * request's value. An omitted request dimension matches any rule value for
 * that dimension (a request scoped only to an action is tested against rules
 * regardless of their subject/resource constraints). When the rule carries a
 * condition, it must also return `true`.
 *
 * Disabled rules never match.
 *
 * @param rule The candidate rule.
 * @param request The request to test.
 * @returns `true` when the rule applies to the request.
 */
export function ruleMatches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.enabled === false) return false;
  if (request.subject !== undefined && !isWildcard(rule.subject) && rule.subject !== request.subject) return false;
  if (request.action !== undefined && !isWildcard(rule.action) && rule.action !== request.action) return false;
  if (request.resource !== undefined && !isWildcard(rule.resource) && rule.resource !== request.resource) return false;
  if (rule.condition !== undefined) {
    try {
      if (!rule.condition(request)) return false;
    } catch {
      // A throwing condition is treated as "does not apply" — the rule cannot
      // be trusted to make a decision, so it is skipped rather than fatal.
      return false;
    }
  }
  return true;
}

/**
 * Compares two rules for tie-breaking during evaluation. Returns a negative
 * number when `a` should win, a positive number when `b` should win.
 *
 * Ordering: most specific first, then highest priority, then earliest
 * creation, then lexically smallest id for determinism.
 *
 * @param a First candidate rule.
 * @param b Second candidate rule.
 * @returns A comparison value suitable for `Array.prototype.sort`.
 */
export function compareRules(a: PolicyRule, b: PolicyRule): number {
  const specA = ruleSpecificity(a);
  const specB = ruleSpecificity(b);
  if (specA !== specB) {
    return specA - specB;
  }
  const priA = a.priority ?? 0;
  const priB = b.priority ?? 0;
  if (priA !== priB) {
    return priB - priA;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Produces a compact human-readable description of a policy request, useful
 * for logging, error messages and audit trails.
 *
 * @param request The request to describe.
 * @returns e.g. `"subject#u-1 read document"`.
 */
export function describePolicyRequest(request: PolicyRequest): string {
  const parts: string[] = [];
  if (request.subject !== undefined) parts.push(`subject#${request.subject}`);
  if (request.action !== undefined) parts.push(request.action);
  if (request.resource !== undefined) parts.push(request.resource);
  if (parts.length === 0) return 'anonymous request';
  return parts.join(' ');
}

/**
 * Returns the rule's effect as a stable integer, useful for stats grouping
 * (`0` for allow, `1` for deny).
 *
 * @param rule The rule to classify.
 * @returns `0` when the rule allows, `1` when it denies.
 */
export function effectRank(rule: PolicyRule): 0 | 1 {
  return rule.effect === ALLOW ? 0 : 1;
}