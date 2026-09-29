/**
 * types.ts
 *
 * Core type definitions for the MAM Tool Engine Permissions layer.
 *
 * This module defines the vocabulary used across the entire permissions
 * subsystem: rules, requests, decisions, configuration, statistics and the
 * supporting guards, factories and default values that make the types safe to
 * construct and easy to consume.
 *
 * The design philosophy here is deliberately simple:
 *
 *   - A {@link PermissionRule} is a single, declarative statement about how a
 *     request should be treated. Rules are keyed by an opaque `id` and may
 *     target a specific tool, a capability, a set of roles, or any combination
 *     of those dimensions. Each rule carries an explicit effect (`allow` or
 *     `deny`) and can participate in precedence resolution through its
 *     `priority` field.
 *
 *   - A {@link PermissionRequest} describes "who is asking to do what".
 *     It always names the tool being invoked, optionally names a capability
 *     that the invocation depends on, and carries the roles of the caller plus
 *     any identity, parameters or ambient context that a policy engine may want
 *     to inspect.
 *
 *   - A {@link PermissionDecision} is the immutable outcome of evaluating a
 *     request against a set of rules. It is deliberately small and serialisable
 *     so that callers can log, cache or forward decisions without lossy
 *     transforms.
 *
 *   - {@link PermissionConfig} carries the evaluation-time defaults (what to do
 *     when nothing matches) and a baseline priority that applies to rules that
 *     do not declare one.
 *
 * Every interface in this file is designed to be structurally typed: objects
 * created elsewhere that merely *look like* a rule or a request will satisfy
 * the corresponding guards. This keeps the layer easy to test and easy to
 * extend with user-defined rule sources.
 *
 * @module permissions/types
 */

/**
 * The effect a rule has on a matching request.
 *
 * - `'allow'`: the request is permitted.
 * - `'deny'`:  the request is refused.
 *
 * When two rules tie on specificity and priority, the safer outcome (`deny`)
 * wins. This is enforced by the resolver in `retrieval.ts` and documented
 * here so the policy author always knows the tie-breaking behaviour.
 */
export type PermissionEffect = 'allow' | 'deny';

/**
 * A role identifier (or a free-form subject label) used to constrain a rule.
 *
 * Roles are matched case-sensitively by default. A role of `'*'` matches every
 * caller and is how global (role-unconstrained) rules are expressed.
 */
export type RoleName = string;

/**
 * A capability name, e.g. `'file.read'` or `'network.send'`.
 *
 * Capabilities are hierarchical in nature and the checker treats a
 * `'a.b'` request as covered by a rule that declares `'a.b'` or a broader
 * `'a.*'`/`'*'` capability. See {@link PermissionRule.capability}.
 */
export type CapabilityName = string;

/**
 * A tool name, e.g. `'fs.readFile'` or `'http.request'`.
 */
export type ToolName = string;

/**
 * Free-form context attached to a request by the caller.
 *
 * The keys and values are intentionally untyped (arbitrary JSON-compatible
 * data) because the permissions layer must remain agnostic about the many
 * different environments that may embed it (MCP servers, CLI hosts, agents).
 * Policy authors may use the context to drive custom predicate hooks at a
 * higher layer; the core checker does not interpret it.
 */
export type RequestContext = Record<string, unknown>;

/**
 * Free-form parameters passed to the tool call that triggered the request.
 *
 * Kept separate from {@link RequestContext} because parameters describe the
 * *invocation* while context describes the *environment*.
 */
export type RequestParams = Record<string, unknown>;

/**
 * Identity information about the caller.
 *
 * `subject` is the primary identity key; `groups`/`attrs` are optional
 * secondary attributes. The `subject` is compared against a rule's `roles`
 * list, which means a "role" in this system is effectively any identity label.
 */
export interface RequestIdentity {
  /** Primary identity subject (user id, service account, principal). */
  subject: string;
  /** Secondary groups the subject belongs to. */
  groups?: string[];
  /** Arbitrary identity attributes. */
  attrs?: Record<string, unknown>;
}

/**
 * A single declarative permission rule.
 *
 * A rule may constrain on any subset of `tool`, `capability` and `roles`.
 * The more dimensions a rule constrains, the more *specific* it is, and
 * specificity is the primary factor used when resolving a request.
 *
 * Precedence rules (also see `retrieval.ts`):
 *   1. Only enabled rules participate in resolution.
 *   2. More specific rules win over less specific rules.
 *   3. On equal specificity, a higher `priority` wins.
 *   4. On an exact tie, `deny` wins (fail-closed default).
 *   5. If no rule matches, the config default applies.
 */
export interface PermissionRule {
  /** Opaque, stable identifier for the rule. */
  id: string;
  /** Tool name this rule applies to, if any. */
  tool?: ToolName;
  /** Capability this rule applies to, if any (supports `a.*` wildcards). */
  capability?: CapabilityName;
  /** Roles/subjects this rule applies to. Absent means "any role". */
  roles?: RoleName[];
  /** The effect of the rule. */
  effect: PermissionEffect;
  /** Numeric priority; higher wins on equal specificity. */
  priority?: number;
  /** Whether the rule is currently active. Defaults to `true`. */
  enabled?: boolean;
  /** Human-readable explanation, useful for audit and debugging. */
  reason?: string;
  /** Optional metadata (tags, source, owner) attached by tooling. */
  metadata?: Record<string, unknown>;
}

/**
 * A request to evaluate a tool invocation against the permission set.
 *
 * The `tool` field is always required. `capability` is optional because not
 * every invocation declares a capability; when present it widens the set of
 * rules that may match (a capability rule can match a request even when the
 * request only names the tool, as long as the tool is associated with that
 * capability through a capability mapping).
 */
export interface PermissionRequest {
  /** The tool being invoked. */
  tool: ToolName;
  /** Capability the invocation requires, if any. */
  capability?: CapabilityName;
  /** Roles (or the identity subject) of the caller. */
  roles?: RoleName[];
  /** Identity details of the caller. */
  identity?: RequestIdentity;
  /** Invocation parameters. */
  params?: RequestParams;
  /** Ambient environment context. */
  context?: RequestContext;
}

/**
 * The result of evaluating a {@link PermissionRequest}.
 *
 * `allowed` is the final verdict. When a rule matched, `matchedRuleId` and
 * `rule` reference it; `reason` is a stable, human-readable summary that is
 * safe to log.
 */
export interface PermissionDecision {
  /** Final verdict. */
  allowed: boolean;
  /** Human-readable summary of why the decision was reached. */
  reason?: string;
  /** The rule object that produced the verdict, when one matched. */
  rule?: PermissionRule;
  /** The id of the matched rule, when one matched. */
  matchedRuleId?: string;
  /** The request that was evaluated (for traceability). */
  request?: PermissionRequest;
  /** Which decision source produced this verdict. */
  source?: 'rule' | 'default';
}

/**
 * Configuration for the permission checker.
 *
 * `default` is the policy applied when no rule matches. `priority` is the
 * baseline priority assigned to rules that do not declare their own.
 */
export interface PermissionConfig {
  /** Fallback effect when no rule matches. */
  default: PermissionEffect;
  /** Baseline priority for rules without an explicit priority. */
  priority?: number;
  /**
   * When `true`, wildcard capability rules (`'*'`, `'a.*'`) are expanded at
   * index time instead of being resolved at query time. Enabling this trades
   * memory for lookup speed. Defaults to `false`.
   */
  precomputeWildcards?: boolean;
  /**
   * When `true`, decisions include the matched rule and request for full
   * auditability. Defaults to `true`.
   */
  includeDetails?: boolean;
}

/**
 * A read-only snapshot of store statistics.
 *
 * Useful for observability dashboards, quota checks and tests that want to
 * assert on registry growth.
 */
export interface PermissionStats {
  /** Total number of rules in the registry. */
  totalRules: number;
  /** Number of enabled rules. */
  enabledRules: number;
  /** Number of disabled rules. */
  disabledRules: number;
  /** Number of allow rules. */
  allowRules: number;
  /** Number of deny rules. */
  denyRules: number;
  /** Number of unique tools referenced by rules. */
  distinctTools: number;
  /** Number of unique capabilities referenced by rules. */
  distinctCapabilities: number;
  /** Timestamp (epoch ms) of the last mutation. */
  lastModified: number;
}

/**
 * Options for {@link PermissionStore.grant}.
 *
 * `grant` is a convenience that creates allow rules for a tool across a set of
 * roles. These options control how the resulting rule(s) are formed.
 */
export interface GrantOptions {
  /** Capability to grant, if the grant is capability-scoped. */
  capability?: CapabilityName;
  /** Priority for the generated rule(s). */
  priority?: number;
  /** Whether the generated rule(s) start enabled. Defaults to `true`. */
  enabled?: boolean;
  /** Reason recorded on the generated rule(s). */
  reason?: string;
  /** Metadata attached to the generated rule(s). */
  metadata?: Record<string, unknown>;
  /** If true, one rule per role is created; otherwise one shared rule. */
  perRole?: boolean;
}

/**
 * A mapping between a tool and the capabilities it exposes.
 *
 * Capability extraction (`retrieval.ts`) can produce these from tool
 * definitions, and the checker uses them to decide whether a tool *requires*
 * a capability and to widen rule matching.
 */
export interface CapabilityMapping {
  /** The tool name. */
  tool: ToolName;
  /** Capabilities the tool declares. */
  capabilities: CapabilityName[];
  /** How the mapping was derived ('declared' | 'derived' | 'manual'). */
  source?: 'declared' | 'derived' | 'manual';
}

/**
 * A normalized role that carries both the raw role name and a wildcard flag.
 *
 * Used internally by the index and checker to speed up matching without
 * re-parsing strings on every request.
 */
export interface NormalizedRole {
  /** The raw role string. */
  raw: RoleName;
  /** True when the role is the `'*'` wildcard. */
  wildcard: boolean;
}

/**
 * A parsed, structured capability expression.
 *
 * Capabilities support two wildcard shapes: the full wildcard `'*'` and the
 * segment wildcard `'a.*'`. This structure makes both cheap to test at query
 * time.
 */
export interface ParsedCapability {
  /** The original capability string. */
  raw: CapabilityName;
  /** True for the bare `'*'` wildcard. */
  isWildcard: boolean;
  /** Prefix segments for `'a.*'` style wildcards (without the trailing `*`). */
  prefixSegments: string[];
  /** Full segments for exact capabilities. */
  segments: string[];
}

/**
 * Guard: is this object a valid permission effect?
 *
 * @param value - Candidate value.
 * @returns True when `value` is exactly `'allow'` or `'deny'`.
 */
export function isPermissionEffect(value: unknown): value is PermissionEffect {
  return value === 'allow' || value === 'deny';
}

/**
 * Guard: is this object a structurally valid {@link PermissionRule}?
 *
 * Checks the fields that matter for safe consumption; extra fields are
 * permitted.
 *
 * @param value - Candidate value.
 * @returns True when `value` satisfies the minimum shape of a rule.
 */
export function isPermissionRule(value: unknown): value is PermissionRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return false;
  }
  if (!isPermissionEffect(candidate.effect)) {
    return false;
  }
  if (candidate.tool !== undefined && typeof candidate.tool !== 'string') {
    return false;
  }
  if (
    candidate.capability !== undefined &&
    typeof candidate.capability !== 'string'
  ) {
    return false;
  }
  if (candidate.roles !== undefined) {
    if (!Array.isArray(candidate.roles)) {
      return false;
    }
    for (const role of candidate.roles as unknown[]) {
      if (typeof role !== 'string') {
        return false;
      }
    }
  }
  if (candidate.priority !== undefined && typeof candidate.priority !== 'number') {
    return false;
  }
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') {
    return false;
  }
  return true;
}

/**
 * Guard: is this object a structurally valid {@link PermissionRequest}?
 *
 * @param value - Candidate value.
 * @returns True when `value` satisfies the minimum shape of a request.
 */
export function isPermissionRequest(value: unknown): value is PermissionRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.tool !== 'string' || candidate.tool.length === 0) {
    return false;
  }
  if (candidate.capability !== undefined && typeof candidate.capability !== 'string') {
    return false;
  }
  if (candidate.roles !== undefined) {
    if (!Array.isArray(candidate.roles)) {
      return false;
    }
    for (const role of candidate.roles as unknown[]) {
      if (typeof role !== 'string') {
        return false;
      }
    }
  }
  return true;
}

/**
 * Guard: is this object a structurally valid {@link PermissionDecision}?
 *
 * @param value - Candidate value.
 * @returns True when `value` looks like a decision.
 */
export function isPermissionDecision(value: unknown): value is PermissionDecision {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.allowed === 'boolean';
}

/**
 * Guard: is this object a valid {@link CapabilityMapping}?
 *
 * @param value - Candidate value.
 * @returns True when `value` satisfies the minimum mapping shape.
 */
export function isCapabilityMapping(value: unknown): value is CapabilityMapping {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.tool !== 'string' || candidate.tool.length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.capabilities)) {
    return false;
  }
  for (const cap of candidate.capabilities as unknown[]) {
    if (typeof cap !== 'string') {
      return false;
    }
  }
  return true;
}

/**
 * Guard: is this object a valid {@link PermissionConfig}?
 *
 * @param value - Candidate value.
 * @returns True when `value` has a valid `default` effect.
 */
export function isPermissionConfig(value: unknown): value is PermissionConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isPermissionEffect(candidate.default);
}

/**
 * Default configuration: fail closed.
 *
 * When no rule matches, the request is denied. This is the conservative
 * default for a security boundary.
 */
export const DEFAULT_PERMISSION_CONFIG: Readonly<PermissionConfig> = Object.freeze({
  default: 'deny',
  priority: 0,
  precomputeWildcards: false,
  includeDetails: true,
});

/**
 * Default baseline priority for rules that do not declare one.
 *
 * Zero is neutral: a rule without an explicit priority neither gains nor loses
 * against sibling rules of the same specificity.
 */
export const DEFAULT_RULE_PRIORITY = 0;

/**
 * The wildcard character used for role and capability wildcards.
 */
export const WILDCARD = '*';

/**
 * The segment separator used in hierarchical capability names.
 */
export const CAPABILITY_SEPARATOR = '.';

/**
 * Create a new {@link PermissionRule} from partial input.
 *
 * Assigns an id if one is not provided (UUID v4 via `crypto.randomUUID`),
 * fills `enabled` and `priority` defaults, and validates the result.
 *
 * @param input - Partial rule fields; `id` and `effect` may be omitted when
 *   sensible defaults exist (`id` is generated, `effect` defaults to `allow`).
 * @returns A fully-formed, validated rule.
 * @throws {TypeError} When the input cannot form a valid rule.
 */
export function createRule(
  input: Partial<PermissionRule> & { effect?: PermissionEffect }
): PermissionRule {
  const id = input.id ?? randomId();
  const effect = input.effect ?? 'allow';
  const rule: PermissionRule = {
    id,
    effect,
    tool: input.tool,
    capability: input.capability,
    roles: input.roles !== undefined ? [...input.roles] : undefined,
    priority: input.priority ?? DEFAULT_RULE_PRIORITY,
    enabled: input.enabled ?? true,
    reason: input.reason,
    metadata: input.metadata !== undefined ? { ...input.metadata } : undefined,
  };
  if (!isPermissionRule(rule)) {
    throw new TypeError(
      `createRule: cannot build a valid PermissionRule from the supplied input (id=${JSON.stringify(id)})`
    );
  }
  return rule;
}

/**
 * Create an allow rule.
 *
 * Sugar over {@link createRule} that pins the effect to `'allow'`.
 *
 * @param input - Partial rule fields.
 * @returns A validated allow rule.
 */
export function allowRule(
  input: Omit<Partial<PermissionRule>, 'effect'> = {}
): PermissionRule {
  return createRule({ ...input, effect: 'allow' });
}

/**
 * Create a deny rule.
 *
 * Sugar over {@link createRule} that pins the effect to `'deny'`.
 *
 * @param input - Partial rule fields.
 * @returns A validated deny rule.
 */
export function denyRule(
  input: Omit<Partial<PermissionRule>, 'effect'> = {}
): PermissionRule {
  return createRule({ ...input, effect: 'deny' });
}

/**
 * Build an allow decision.
 *
 * @param rule - The rule that allowed the request (optional).
 * @param request - The evaluated request (optional).
 * @param reason - Optional human-readable reason; defaults to a stable string.
 * @returns A {@link PermissionDecision} with `allowed === true`.
 */
export function allowDecision(
  rule?: PermissionRule,
  request?: PermissionRequest,
  reason: string = 'allowed by matching rule'
): PermissionDecision {
  const decision: PermissionDecision = {
    allowed: true,
    reason,
    source: rule ? 'rule' : 'default',
  };
  if (rule) {
    decision.rule = rule;
    decision.matchedRuleId = rule.id;
  }
  if (request) {
    decision.request = request;
  }
  return decision;
}

/**
 * Build a deny decision.
 *
 * @param rule - The rule that denied the request (optional).
 * @param request - The evaluated request (optional).
 * @param reason - Optional human-readable reason; defaults to a stable string.
 * @returns A {@link PermissionDecision} with `allowed === false`.
 */
export function denyDecision(
  rule?: PermissionRule,
  request?: PermissionRequest,
  reason: string = 'denied by policy'
): PermissionDecision {
  const decision: PermissionDecision = {
    allowed: false,
    reason,
    source: rule ? 'rule' : 'default',
  };
  if (rule) {
    decision.rule = rule;
    decision.matchedRuleId = rule.id;
  }
  if (request) {
    decision.request = request;
  }
  return decision;
}

/**
 * Create a well-formed {@link PermissionRequest}.
 *
 * Normalises optional arrays and defaults empty roles to an empty array so
 * consumers never have to null-check.
 *
 * @param input - Partial request fields; `tool` is required.
 * @returns A normalised request.
 * @throws {TypeError} When `tool` is missing or not a string.
 */
export function createRequest(input: Partial<PermissionRequest> & { tool: string }): PermissionRequest {
  const request: PermissionRequest = {
    tool: input.tool,
    capability: input.capability,
    roles: input.roles !== undefined ? [...input.roles] : [],
    identity: input.identity,
    params: input.params !== undefined ? { ...input.params } : undefined,
    context: input.context !== undefined ? { ...input.context } : undefined,
  };
  if (!isPermissionRequest(request)) {
    throw new TypeError(`createRequest: invalid tool name ${JSON.stringify(input.tool)}`);
  }
  return request;
}

/**
 * Create an empty {@link PermissionStats} snapshot.
 *
 * @param lastModified - Optional initial timestamp; defaults to `Date.now()`.
 * @returns A zeroed stats object.
 */
export function createEmptyStats(lastModified: number = Date.now()): PermissionStats {
  return {
    totalRules: 0,
    enabledRules: 0,
    disabledRules: 0,
    allowRules: 0,
    denyRules: 0,
    distinctTools: 0,
    distinctCapabilities: 0,
    lastModified,
  };
}

/**
 * Merge a partial config over {@link DEFAULT_PERMISSION_CONFIG}.
 *
 * @param overrides - Optional overrides.
 * @returns A fully populated, non-frozen config object.
 */
export function resolveConfig(overrides?: Partial<PermissionConfig>): PermissionConfig {
  return {
    default: overrides?.default ?? DEFAULT_PERMISSION_CONFIG.default,
    priority: overrides?.priority ?? DEFAULT_PERMISSION_CONFIG.priority,
    precomputeWildcards:
      overrides?.precomputeWildcards ?? DEFAULT_PERMISSION_CONFIG.precomputeWildcards,
    includeDetails: overrides?.includeDetails ?? DEFAULT_PERMISSION_CONFIG.includeDetails,
  };
}

/**
 * Generate a reasonably unique id for a rule.
 *
 * Prefers `crypto.randomUUID()` when available; falls back to a timestamp +
 * random suffix otherwise. Ids are guaranteed to be non-empty strings.
 *
 * @returns A new id string.
 */
export function randomId(): string {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID === 'function') {
    return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
  }
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parse a role string into its structured form.
 *
 * @param role - Raw role string.
 * @returns A {@link NormalizedRole}.
 */
export function normalizeRole(role: RoleName): NormalizedRole {
  return { raw: role, wildcard: role === WILDCARD };
}

/**
 * Parse a capability string into its structured, matchable form.
 *
 * Supports `'*'` (matches everything) and `'a.b.*'` (matches `a.b.*` and any
 * deeper segment). Exact capabilities like `'a.b.c'` match only themselves.
 *
 * @param capability - Raw capability string.
 * @returns A {@link ParsedCapability}.
 */
export function parseCapability(capability: CapabilityName): ParsedCapability {
  const raw = capability;
  if (capability === WILDCARD) {
    return { raw, isWildcard: true, prefixSegments: [], segments: [] };
  }
  const segments = capability.split(CAPABILITY_SEPARATOR);
  if (segments[segments.length - 1] === WILDCARD) {
    const prefixSegments = segments.slice(0, -1);
    return { raw, isWildcard: false, prefixSegments, segments };
  }
  return { raw, isWildcard: false, prefixSegments: [], segments };
}

/**
 * Test whether a requested capability is covered by a declared capability.
 *
 * @param requested - The capability requested by the caller.
 * @param declared - The capability declared by the rule or mapping.
 * @returns True when `declared` covers `requested`.
 */
export function capabilityCovers(requested: CapabilityName, declared: CapabilityName): boolean {
  const req = parseCapability(requested);
  const dec = parseCapability(declared);
  if (dec.isWildcard) {
    return true;
  }
  if (dec.prefixSegments.length > 0) {
    return (
      req.segments.length >= dec.prefixSegments.length &&
      dec.prefixSegments.every((seg, i) => req.segments[i] === seg)
    );
  }
  return req.raw === dec.raw;
}

/**
 * Compute the specificity of a rule's constraints.
 *
 * Specificity is a tuple-safe ordering key: each constraint dimension adds one
 * point when present. More constrained rules are more specific. A wildcard
 * capability adds a fraction less than an exact capability so that an exact
 * capability rule beats a wildcard rule of otherwise identical shape.
 *
 * @param rule - The rule to score.
 * @returns A numeric specificity score.
 */
export function ruleSpecificity(rule: PermissionRule): number {
  let score = 0;
  if (rule.tool !== undefined) {
    score += 100;
  }
  if (rule.capability !== undefined) {
    score += rule.capability === WILDCARD ? 40 : 60;
  }
  if (rule.roles !== undefined && rule.roles.length > 0) {
    score += rule.roles.length * 20;
  }
  return score;
}

/**
 * Clone a rule, deep-copying mutable fields so callers cannot corrupt the
 * registry by mutating a returned reference.
 *
 * @param rule - Source rule.
 * @returns An independent copy.
 */
export function cloneRule(rule: PermissionRule): PermissionRule {
  return {
    ...rule,
    roles: rule.roles !== undefined ? [...rule.roles] : undefined,
    metadata: rule.metadata !== undefined ? { ...rule.metadata } : undefined,
  };
}