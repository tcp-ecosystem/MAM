/**
 * types.ts
 *
 * Canonical type definitions, constants, type guards, factories and default
 * values for the MAM Audit layer.
 *
 * The audit layer records security-relevant events, redacts secrets, detects
 * anomalies and produces security reports. Every entity that flows through the
 * pipeline is described here so the store, index, retrieval, lifecycle and
 * integration layers share one canonical shape:
 *
 *  - {@link AuditEvent}      — the immutable record of a single security event
 *  - {@link RedactConfig}    — redaction rules used to scrub secrets
 *  - {@link AnomalyRule}     — declarative rules for anomaly detection
 *  - {@link AnomalyFlag}     — a single anomaly finding produced by a rule
 *  - {@link SecurityReport}  — the aggregated output of the reporter
 *  - {@link AuditConfig}     — tuning knobs for the whole engine
 *  - {@link AuditStats}      — aggregate counters produced by `stats()`
 *  - {@link AuditOptions}    — construction options for the high-level facade
 *
 * This module is deliberately dependency-free (only `node:crypto` for entropy
 * based id generation) and acts as the single source of truth for validation
 * logic. Guards follow the "narrow before use" philosophy: callers may rely on
 * the returned predicates to reduce an `unknown` payload to a fully typed
 * entity without casting. Factories freeze their results so stored records
 * cannot be mutated through a shared reference, and the constant defaults are
 * frozen so a fresh audit engine is safe to drop into any Node process.
 *
 * @module audit/types
 */

import { randomUUID } from 'node:crypto';

/**
 * The set of event categories understood by the MAM audit engine.
 *
 * - `auth`:     authentication outcomes (login, token verify, key issue).
 * - `access`:   authorization decisions (allowed / denied requests).
 * - `policy`:   policy evaluation, role or permission changes.
 * - `sandbox`:  sandbox boundary crossings, isolation and execution events.
 * - `secret`:   secret lifecycle events (created, rotated, exposed, revoked).
 * - `anomaly`:  events that were themselves flagged as anomalous.
 */
export const AUDIT_TYPES = ['auth', 'access', 'policy', 'sandbox', 'secret', 'anomaly'] as const;

/**
 * The `AuditType` union. Kept as a string literal union so that switch
 * statements and index keys remain exhaustively checkable at compile time.
 */
export type AuditType = (typeof AUDIT_TYPES)[number];

/**
 * The set of outcomes an {@link AuditEvent} may carry.
 *
 * - `allowed`: the action was permitted.
 * - `denied`:  the action was refused (the core signal for security review).
 * - `error`:   the action failed for a technical reason (not a policy refusal).
 * - `info`:    a purely informational observation with no allow/deny polarity.
 */
export const AUDIT_RESULTS = ['allowed', 'denied', 'error', 'info'] as const;

/** The `AuditResult` union. */
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/**
 * The set of severity levels attached to an {@link AuditEvent}.
 *
 * - `info`:     routine, expected activity.
 * - `warn`:     suspicious or noteworthy but not immediately dangerous.
 * - `critical`: requires immediate attention (breach indicators, data loss).
 */
export const AUDIT_SEVERITIES = ['info', 'warn', 'critical'] as const;

/** The `AuditSeverity` union. */
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/**
 * The kinds of anomaly rule understood by the detection engine.
 *
 * - `denial-burst`:    N denials from one actor inside a time window.
 * - `critical-severity`: any event carrying the `critical` severity.
 * - `unknown-actor`:   an event whose actor cannot be resolved.
 * - `custom`:          a caller-defined predicate-driven rule.
 */
export const ANOMALY_RULE_KINDS = ['denial-burst', 'critical-severity', 'unknown-actor', 'custom'] as const;

/** The `AnomalyRuleKind` union. */
export type AnomalyRuleKind = (typeof ANOMALY_RULE_KINDS)[number];

/**
 * The default actor label applied when a caller records an event without an
 * explicit actor. Choosing a stable sentinel value means "no actor supplied"
 * is always distinguishable from an actor literally named `unknown`.
 */
export const DEFAULT_ACTOR = 'system';

/**
 * An immutable record of a single security event.
 *
 * An {@link AuditEvent} is the atomic unit the entire audit layer operates on.
 * It is frozen at construction time (see {@link createAuditEvent}) and never
 * mutated in place; every transformation (redaction, flagging) produces a new
 * event. The shape intentionally mirrors a classic SIEM entry: a typed action
 * performed by an actor against a target, with an outcome, a severity, a
 * human-readable message and an arbitrary structured payload.
 */
export interface AuditEvent {
  /** Stable, globally unique event identifier (opaque, non-sequential). */
  readonly id: string;
  /** The coarse category of the event (`auth`, `access`, `policy`, ...). */
  readonly type: AuditType;
  /** The verb describing what happened (e.g. `login`, `read`, `revoke`). */
  readonly action: string;
  /** The principal that performed the action, when known. */
  readonly actor?: string;
  /** The resource or subject the action targeted, when applicable. */
  readonly target?: string;
  /** The outcome of the action. */
  readonly result: AuditResult;
  /** The severity assigned to the event. */
  readonly severity: AuditSeverity;
  /** Optional human-readable summary of the event. */
  readonly message?: string;
  /** Free-form structured payload attached to the event. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Epoch ms timestamp recording when the event occurred. */
  readonly timestamp: number;
}

/**
 * Input shape accepted by {@link createAuditEvent}. Every field is optional at
 * construction time; sensible defaults are applied so callers never need to
 * know the full event shape up front (`type` → `auth`, `action` → `unknown`,
 * `result` → `info`, `severity` → `info`, `actor` → {@link DEFAULT_ACTOR}).
 */
export interface AuditEventInput {
  /** Optional explicit id; a random id is generated when omitted. */
  id?: string;
  /** Event category; defaults to `auth`. */
  type?: AuditType;
  /** Action verb; defaults to `unknown`. */
  action?: string;
  /** Actor label; defaults to {@link DEFAULT_ACTOR}. */
  actor?: string;
  /** Target resource the action applied to. */
  target?: string;
  /** Outcome; defaults to `info`. */
  result?: AuditResult;
  /** Severity; defaults to `info`. */
  severity?: AuditSeverity;
  /** Human-readable summary. */
  message?: string;
  /** Structured payload; shallow-copied on write. */
  data?: Readonly<Record<string, unknown>>;
  /** Event timestamp; defaults to the current wall clock. */
  timestamp?: number;
}

/**
 * Redaction rules consumed by the {@link Redactor} in `integration.ts`.
 *
 * Each boolean flag switches on the masking of a well-known secret shape;
 * `customPatterns` lets callers inject their own patterns (string literals or
 * `RegExp`s). `maskWith` is the replacement text and `preservePrefix` /
 * `preserveSuffix` keep a few identifying characters either side of the mask
 * so operators can still correlate which secret was redacted.
 */
export interface RedactConfig {
  /** Mask email addresses (`user@example.com`). */
  email?: boolean;
  /** Mask high-entropy API keys (well-known prefixes like `sk_`, `mam_ak_`). */
  apiKeys?: boolean;
  /** Mask `Bearer <token>` authorization header values. */
  bearerTokens?: boolean;
  /** Mask JWT payloads (the `eyJ...` compact form). */
  jwt?: boolean;
  /** Mask `password=...`, `secret: ...` style assignments. */
  passwords?: boolean;
  /** Mask IPv4 addresses. */
  ipAddresses?: boolean;
  /** Mask phone numbers (loose, heuristic matching). */
  phoneNumbers?: boolean;
  /** Mask card-like digit runs of 13–19 characters. */
  cardNumbers?: boolean;
  /** Extra caller-supplied patterns applied verbatim. */
  customPatterns?: readonly (string | RegExp)[];
  /** Replacement text used for masked values (default `***`). */
  maskWith?: string;
  /** Leading characters of a value left unmasked (default 0). */
  preservePrefix?: number;
  /** Trailing characters of a value left unmasked (default 0). */
  preserveSuffix?: number;
}

/**
 * A declarative anomaly detection rule consumed by the detection engine.
 *
 * Rules are grouped by {@link AnomalyRuleKind}; the kind-specific fields are
 * interpreted as follows:
 *
 * - `denial-burst`:      `threshold` denials inside `windowMs` from one actor.
 * - `critical-severity`: fires for every event with `severity` `critical`.
 * - `unknown-actor`:     fires for events whose actor cannot be resolved.
 * - `custom`:            fires for events matching optional `severity`,
 *                        `result`, `actor` and `threshold` constraints.
 */
export interface AnomalyRule {
  /** Stable rule identifier (used in {@link AnomalyFlag.ruleId}). */
  readonly id: string;
  /** The kind of detection this rule performs. */
  readonly kind: AnomalyRuleKind;
  /** Optional human-readable description of the rule's intent. */
  readonly description?: string;
  /** For `denial-burst`: the number of denials that triggers the flag. */
  readonly threshold?: number;
  /** For `denial-burst`: the sliding window length in milliseconds. */
  readonly windowMs?: number;
  /** For `custom`: an actor label the event must match to be flagged. */
  readonly actor?: string;
  /** For `custom`: a severity the event must carry to be flagged. */
  readonly severity?: AuditSeverity;
  /** For `custom`: a result the event must carry to be flagged. */
  readonly result?: AuditResult;
  /** When `false` the rule is skipped by the detection engine. */
  readonly enabled?: boolean;
}

/**
 * A single anomaly finding produced by the detection engine.
 *
 * Each flag references the rule that fired, the triggering event and, where
 * the rule is aggregating (e.g. a denial burst), the related events that
 * formed the evidence. Flags are immutable and carry a detection timestamp so
 * they can be persisted alongside the events that produced them.
 */
export interface AnomalyFlag {
  /** Stable, globally unique flag identifier. */
  readonly id: string;
  /** Id of the {@link AnomalyRule} that produced this flag. */
  readonly ruleId: string;
  /** The kind of detection that fired. */
  readonly kind: AnomalyRuleKind;
  /** Human-readable explanation of why the event was flagged. */
  readonly reason: string;
  /** The event that triggered the flag. */
  readonly event: AuditEvent;
  /** Related evidence events (denial bursts, for example). */
  readonly related?: readonly AuditEvent[];
  /** Epoch ms when the flag was produced. */
  readonly detectedAt: number;
}

/**
 * The aggregated security report produced by the {@link SecurityReporter} in
 * `integration.ts`.
 *
 * A report is a point-in-time snapshot of the audit store: totals per type,
 * outcome and severity, denial and error ratios, the most active actors and
 * actions (with their denial counts), the anomalies detected in the window and
 * the most recent denials. It is fully serializable for dashboards and
 * alerting pipelines.
 */
export interface SecurityReport {
  /** Epoch ms when the report was generated. */
  readonly generatedAt: number;
  /** Number of events covered by the report (respecting the time window). */
  readonly totalEvents: number;
  /** Optional time window the report covers. */
  readonly window: Readonly<{ from?: number; to?: number }>;
  /** Event count per {@link AuditType}. */
  readonly totals: Readonly<Record<AuditType, number>>;
  /** Event count per {@link AuditResult}. */
  readonly byResult: Readonly<Record<AuditResult, number>>;
  /** Event count per {@link AuditSeverity}. */
  readonly bySeverity: Readonly<Record<AuditSeverity, number>>;
  /** Share of events that were denied (0..1; 0 when no events). */
  readonly deniedRatio: number;
  /** Share of events that errored (0..1; 0 when no events). */
  readonly errorRatio: number;
  /** Absolute number of `critical` events in the window. */
  readonly criticalCount: number;
  /** Most active actors (descending by count) with their denial counts. */
  readonly topActors: readonly Readonly<{ actor: string; count: number; denied: number }>[];
  /** Most common actions (descending by count) with denial counts. */
  readonly topActions: readonly Readonly<{ action: string; count: number; denied: number }>[];
  /** Anomalies detected across the events in the window. */
  readonly anomalies: readonly AnomalyFlag[];
  /** The most recent denied events in the window. */
  readonly recentDenied: readonly AuditEvent[];
}

/**
 * Tuning knobs for the whole audit engine.
 *
 * Values are intentionally conservative by default so that a fresh
 * `createAuditLogger()` is safe to drop into any Node process: a bounded
 * store, a modest periodic prune and a small default retention window.
 */
export interface AuditConfig {
  /** Upper bound on retained events before oldest entries are evicted. */
  maxEvents?: number;
  /** Interval (ms) between automatic prune sweeps (default 60s). */
  pruneIntervalMs?: number;
  /** Default retention window used by lifecycle prunes (default 24h). */
  defaultRetentionMs?: number;
  /** Actor label stamped on events recorded without an actor. */
  defaultActor?: string;
  /** Redaction rules applied by the logger before persisting events. */
  redact?: RedactConfig;
  /** Anomaly rules evaluated against recorded events. */
  anomalyRules?: readonly AnomalyRule[];
  /** Default denial-burst threshold when a rule omits one (default 5). */
  denyBurstThreshold?: number;
  /** Default denial-burst window when a rule omits one (default 60s). */
  denyBurstWindowMs?: number;
}

/**
 * Aggregate counters describing the health and activity of the audit engine.
 *
 * `AuditStats` is produced by `stats()` on the store and the composite logger,
 * and is safe to serialize for metrics endpoints. Lifetime counters (`recorded`,
 * `pruned`, `deleted`) are monotonic from construction (or the last {@link clear}).
 */
export interface AuditStats {
  /** Events currently retained in the store. */
  total: number;
  /** Lifetime count of events recorded (including evicted ones). */
  recorded: number;
  /** Lifetime count of events pruned (by age or capacity). */
  pruned: number;
  /** Lifetime count of events deleted individually. */
  deleted: number;
  /** Configured capacity (upper bound) of the store. */
  capacity: number;
  /** Fraction of capacity currently used (0..1). */
  usagePercent: number;
  /** Epoch ms of the oldest retained event, when any. */
  oldestAt?: number;
  /** Epoch ms of the newest retained event, when any. */
  newestAt?: number;
  /** Epoch ms of the last prune sweep, when any. */
  lastPruneAt?: number;
  /** Event count per {@link AuditType}. */
  byType: Readonly<Record<AuditType, number>>;
  /** Event count per {@link AuditResult}. */
  byResult: Readonly<Record<AuditResult, number>>;
  /** Event count per {@link AuditSeverity}. */
  bySeverity: Readonly<Record<AuditSeverity, number>>;
}

/**
 * Construction options accepted by the composite {@link AuditLogger}.
 *
 * All fields are optional; defaults come from {@link DEFAULT_AUDIT_CONFIG} and
 * the real system clock.
 */
export interface AuditOptions {
  /** Configuration overrides merged over the defaults. */
  config?: Partial<AuditConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * Immutable default redaction configuration. Redaction is enabled for the
 * most common secret shapes out of the box so that a fresh logger never
 * leaks credentials into the audit trail.
 */
export const DEFAULT_REDACT_CONFIG: Readonly<RedactConfig> = Object.freeze({
  email: true,
  apiKeys: true,
  bearerTokens: true,
  jwt: true,
  passwords: true,
  ipAddresses: false,
  phoneNumbers: false,
  cardNumbers: false,
  customPatterns: Object.freeze([]),
  maskWith: '***',
  preservePrefix: 0,
  preserveSuffix: 0,
});

/**
 * Immutable default anomaly rules. These give a fresh engine useful baseline
 * detection without any configuration:
 *
 * - `critical-events` fires on any critical-severity event.
 * - `denial-burst` fires when one actor accumulates 5 denials in 60 seconds.
 * - `unresolved-actor` fires when an event references an unknown actor.
 */
export const DEFAULT_ANOMALY_RULES: Readonly<readonly AnomalyRule[]> = Object.freeze([
  Object.freeze({
    id: 'critical-severity',
    kind: 'critical-severity',
    description: 'Flags any event recorded with critical severity.',
    enabled: true,
  }),
  Object.freeze({
    id: 'denial-burst',
    kind: 'denial-burst',
    description: 'Flags a burst of denials from a single actor within the window.',
    threshold: 5,
    windowMs: 60_000,
    enabled: true,
  }),
  Object.freeze({
    id: 'unresolved-actor',
    kind: 'unknown-actor',
    description: 'Flags events whose actor cannot be resolved.',
    enabled: true,
  }),
]);

/**
 * Immutable default audit configuration. A shallow freeze prevents accidental
 * mutation of shared defaults; per-instance configs are merged copies.
 */
export const DEFAULT_AUDIT_CONFIG: Readonly<AuditConfig> = Object.freeze({
  maxEvents: 10_000,
  pruneIntervalMs: 60 * 1000,
  defaultRetentionMs: 24 * 60 * 60 * 1000,
  defaultActor: DEFAULT_ACTOR,
  redact: DEFAULT_REDACT_CONFIG,
  anomalyRules: DEFAULT_ANOMALY_RULES,
  denyBurstThreshold: 5,
  denyBurstWindowMs: 60 * 1000,
});

/** Factory for the zero-value statistics object used by every `stats()`. */
export function createEmptyAuditStats(): AuditStats {
  const byType = {} as Record<AuditType, number>;
  for (const type of AUDIT_TYPES) byType[type] = 0;
  const byResult = {} as Record<AuditResult, number>;
  for (const result of AUDIT_RESULTS) byResult[result] = 0;
  const bySeverity = {} as Record<AuditSeverity, number>;
  for (const severity of AUDIT_SEVERITIES) bySeverity[severity] = 0;
  return {
    total: 0,
    recorded: 0,
    pruned: 0,
    deleted: 0,
    capacity: 0,
    usagePercent: 0,
    byType,
    byResult,
    bySeverity,
  };
}

/**
 * Returns the current wall-clock time in epoch milliseconds. Injectable clock
 * is applied at the logger/lifecycle level; this helper is the default source.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Generates a random, opaque identifier using a cryptographically strong RNG.
 *
 * @returns A 128-bit random UUID string.
 */
export function createId(): string {
  return randomUUID();
}

/** Returns `true` when `value` is a non-null object (not array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a value is a member of the {@link AuditType} union.
 *
 * @param value Any runtime value.
 * @returns `true` when the value equals one of the six audit types.
 */
export function isAuditType(value: unknown): value is AuditType {
  return (AUDIT_TYPES as readonly unknown[]).includes(value);
}

/**
 * Checks whether a value is a member of the {@link AuditResult} union.
 *
 * @param value Any runtime value.
 * @returns `true` when the value is a valid outcome.
 */
export function isAuditResult(value: unknown): value is AuditResult {
  return (AUDIT_RESULTS as readonly unknown[]).includes(value);
}

/**
 * Checks whether a value is a member of the {@link AuditSeverity} union.
 *
 * @param value Any runtime value.
 * @returns `true` when the value is a valid severity.
 */
export function isAuditSeverity(value: unknown): value is AuditSeverity {
  return (AUDIT_SEVERITIES as readonly unknown[]).includes(value);
}

/**
 * Validates a candidate identifier. Accepts non-empty, non-whitespace strings.
 *
 * @param id Candidate id.
 * @returns `true` when the id is usable.
 */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Runtime type guard for {@link AuditEvent}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `AuditEvent`.
 */
export function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isAuditType(value.type)) return false;
  if (typeof value.action !== 'string') return false;
  if (value.actor !== undefined && typeof value.actor !== 'string') return false;
  if (value.target !== undefined && typeof value.target !== 'string') return false;
  if (!isAuditResult(value.result)) return false;
  if (!isAuditSeverity(value.severity)) return false;
  if (value.message !== undefined && typeof value.message !== 'string') return false;
  if (value.timestamp !== undefined && typeof value.timestamp !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link RedactConfig}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `RedactConfig`.
 */
export function isRedactConfig(value: unknown): value is RedactConfig {
  if (!isRecord(value)) return false;
  for (const flag of ['email', 'apiKeys', 'bearerTokens', 'jwt', 'passwords', 'ipAddresses', 'phoneNumbers', 'cardNumbers'] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') return false;
  }
  if (value.maskWith !== undefined && typeof value.maskWith !== 'string') return false;
  if (value.preservePrefix !== undefined && typeof value.preservePrefix !== 'number') return false;
  if (value.preserveSuffix !== undefined && typeof value.preserveSuffix !== 'number') return false;
  if (value.customPatterns !== undefined && !Array.isArray(value.customPatterns)) return false;
  return true;
}

/**
 * Runtime type guard for {@link AnomalyRule}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `AnomalyRule`.
 */
export function isAnomalyRule(value: unknown): value is AnomalyRule {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!(ANOMALY_RULE_KINDS as readonly unknown[]).includes(value.kind)) return false;
  if (value.threshold !== undefined && typeof value.threshold !== 'number') return false;
  if (value.windowMs !== undefined && typeof value.windowMs !== 'number') return false;
  if (value.severity !== undefined && !isAuditSeverity(value.severity)) return false;
  if (value.result !== undefined && !isAuditResult(value.result)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  return true;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid audit event.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link AuditEvent}.
 */
export function assertAuditEvent(value: unknown, label = 'auditEvent'): AuditEvent {
  if (!isAuditEvent(value)) {
    throw new TypeError(`${label} is not a valid AuditEvent object`);
  }
  return value;
}

/**
 * Normalizes a loosely-typed input into a fully-formed {@link AuditEvent}.
 *
 * Missing fields receive defaults: `type` becomes `auth`, `action` becomes
 * `unknown`, `actor` becomes {@link DEFAULT_ACTOR}, `result` becomes `info`,
 * `severity` becomes `info` and `timestamp` becomes the current wall clock. An
 * explicit `id` is preserved; otherwise one is generated. The `data` payload is
 * shallow-copied so callers cannot mutate the stored record afterwards.
 *
 * @param input Partial event description.
 * @returns A complete, frozen, validated event object.
 */
export function createAuditEvent(input: AuditEventInput = {}): AuditEvent {
  return Object.freeze({
    id: input.id ?? createId(),
    type: input.type ?? 'auth',
    action: input.action ?? 'unknown',
    actor: input.actor ?? DEFAULT_ACTOR,
    target: input.target,
    result: input.result ?? 'info',
    severity: input.severity ?? 'info',
    message: input.message,
    data: input.data ? { ...input.data } : undefined,
    timestamp: input.timestamp ?? nowMs(),
  });
}

/**
 * Merges a partial redaction configuration over the frozen defaults and
 * returns a plain, fully-populated object safe for downstream mutation.
 *
 * @param overrides Partial redaction configuration (may be empty).
 * @returns A complete, non-frozen {@link RedactConfig}.
 */
export function resolveRedactConfig(overrides: Partial<RedactConfig> | undefined = {}): RedactConfig {
  const customPatterns = Array.from(overrides.customPatterns ?? DEFAULT_REDACT_CONFIG.customPatterns ?? []);
  return {
    ...DEFAULT_REDACT_CONFIG,
    ...overrides,
    customPatterns,
  };
}

/**
 * Merges a partial audit configuration over the frozen defaults and returns a
 * plain, fully-populated configuration object safe for downstream mutation.
 * Nested redaction and anomaly-rule settings are resolved recursively.
 *
 * @param overrides Partial configuration (may be empty).
 * @returns A complete, non-frozen {@link AuditConfig}.
 */
export function resolveAuditConfig(overrides: Partial<AuditConfig> | undefined = {}): AuditConfig {
  const redact = resolveRedactConfig(overrides.redact);
  const anomalyRules = Array.from(overrides.anomalyRules ?? DEFAULT_AUDIT_CONFIG.anomalyRules ?? []);
  return {
    ...DEFAULT_AUDIT_CONFIG,
    ...overrides,
    redact,
    anomalyRules,
  };
}

/**
 * Maps a severity to a numeric rank for comparisons: `info` → 0, `warn` → 1,
 * `critical` → 2. Higher is more severe.
 *
 * @param severity Severity to rank.
 * @returns A numeric rank (0, 1 or 2).
 */
export function severityRank(severity: AuditSeverity): number {
  switch (severity) {
    case 'info':
      return 0;
    case 'warn':
      return 1;
    case 'critical':
      return 2;
    default:
      return 0;
  }
}

/**
 * Returns `true` when `actual` is at least as severe as `required` under the
 * {@link severityRank} ordering. Used by alerting thresholds to answer "is this
 * event severe enough to page?".
 *
 * @param actual The severity carried by the event.
 * @param required The minimum severity to satisfy.
 * @returns `true` when the event meets or exceeds the required severity.
 */
export function isSeverityAtLeast(actual: AuditSeverity, required: AuditSeverity): boolean {
  return severityRank(actual) >= severityRank(required);
}

/**
 * Evaluates whether an actor label counts as "unknown" for anomaly detection.
 *
 * An actor is considered unresolved when it is missing, empty, or one of the
 * conventional sentinel values (`unknown`, `anonymous`, `null`, `undefined`,
 * or the whitespace-trimmed forms thereof).
 *
 * @param actor The actor label carried by an event.
 * @returns `true` when the actor cannot be resolved.
 */
export function isUnknownActor(actor: string | undefined): boolean {
  if (actor === undefined) return true;
  const normalized = actor.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return normalized === 'unknown' || normalized === 'anonymous' || normalized === 'null' || normalized === 'undefined';
}

/**
 * Deep-clones plain-object event data so callers cannot mutate stored records
 * through a shared reference. Non-plain values (functions, class instances)
 * are passed through by reference as-is.
 *
 * @param data Source data object.
 * @returns A recursively cloned copy, or `undefined` when omitted.
 */
export function cloneData(data: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  if (data === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = cloneData(value as Readonly<Record<string, unknown>>) ?? {};
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Builds an {@link AnomalyFlag} from a rule and a triggering event.
 *
 * @param rule The rule that fired.
 * @param event The triggering event.
 * @param reason Human-readable explanation.
 * @param now Detection timestamp (defaults to the wall clock).
 * @param related Optional related evidence events.
 * @returns A frozen anomaly flag.
 */
export function createAnomalyFlag(
  rule: AnomalyRule,
  event: AuditEvent,
  reason: string,
  now: number = nowMs(),
  related?: readonly AuditEvent[],
): AnomalyFlag {
  return Object.freeze({
    id: createId(),
    ruleId: rule.id,
    kind: rule.kind,
    reason,
    event,
    related: related ? Array.from(related) : undefined,
    detectedAt: now,
  });
}

/**
 * Returns a plain, JSON-safe copy of an {@link AuditEvent} (frozen wrappers and
 * shared references are stripped). Useful before handing events to
 * `JSON.stringify` or a persistence layer.
 *
 * @param event The event to serialize.
 * @returns A plain object representation of the event.
 */
export function serializeEvent(event: AuditEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    action: event.action,
    actor: event.actor,
    target: event.target,
    result: event.result,
    severity: event.severity,
    message: event.message,
    data: cloneData(event.data),
    timestamp: event.timestamp,
  };
}