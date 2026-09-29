/**
 * integration.ts
 *
 * `AuditLogger`, `Redactor` and `SecurityReporter` — the high-level facade of
 * the MAM audit engine.
 *
 * This module wires the four lower layers together into a single, ergonomic
 * entry point:
 *
 *  - {@link AuditStore}     — append-only, capacity-bounded event log
 *  - {@link AuditIndex}     — facet index over types/actors/results/severities
 *  - {@link AuditQuery}     — read-side facade for interrogating the log
 *  - {@link AuditLifecycle} — retention pruning, index sync, anomaly events
 *
 * It exposes three production components:
 *
 *  - {@link AuditLogger} — records security events (redacting secrets on the
 *    way in), offers convenience recorders for the common cases
 *    (`recordDenied`, `recordError`, ...) and runs the rule-based anomaly
 *    detection engine from `../lifecycle` against recorded or ad-hoc events.
 *  - {@link Redactor}    — masks emails, keys, bearer tokens, JWTs, passwords
 *    and caller-supplied patterns inside strings and event payloads.
 *  - {@link SecurityReporter} — aggregates the log into a {@link SecurityReport}
 *    (totals, top actors, denied ratio, anomalies, recent denials).
 *
 * {@link createAuditLogger} and {@link createSecurityReporter} are the
 * recommended factories; they apply the frozen defaults so a fresh engine is
 * safe to drop into any Node process.
 *
 * @module audit/integration
 */

import {
  type AnomalyFlag,
  type AuditConfig,
  type AuditEvent,
  type AuditEventInput,
  type AuditOptions,
  type AuditResult,
  type AuditSeverity,
  type AuditStats,
  type AuditType,
  type RedactConfig,
  type SecurityReport,
  AUDIT_RESULTS,
  AUDIT_SEVERITIES,
  AUDIT_TYPES,
  createAuditEvent,
  isRecord,
  nowMs,
  resolveAuditConfig,
  resolveRedactConfig,
} from './types.js';
import { AuditStore } from './store.js';
import { AuditIndex } from './index.js';
import { AuditQuery, type AuditSummary } from './retrieval.js';
import { AuditLifecycle, type PruneResult, detectAnomalies } from './lifecycle.js';

/**
 * Constructor options for {@link AuditLogger}. All collaborators are optional;
 * defaults are built internally so callers can pass nothing at all.
 */
export interface AuditLoggerOptions extends AuditOptions {
  /** Pre-built store (advanced use; defaults to a fresh one). */
  store?: AuditStore;
  /** Pre-built index (advanced use; defaults to a fresh one). */
  index?: AuditIndex;
  /** Pre-built query (advanced use; defaults to a fresh one). */
  query?: AuditQuery;
  /** Pre-built lifecycle (advanced use; defaults to a fresh one). */
  lifecycle?: AuditLifecycle;
  /** Pre-built redactor (advanced use; defaults to a fresh one). */
  redactor?: Redactor;
}

/** Options accepted by {@link SecurityReporter.report}. */
export interface ReportOptions {
  /** Inclusive lower bound of the report window in epoch ms. */
  from?: number;
  /** Inclusive upper bound of the report window in epoch ms. */
  to?: number;
  /** Maximum number of recent-denied events to include (default 20). */
  recentDeniedLimit?: number;
  /** Number of rows in the top-actor / top-action tallies (default 10). */
  topN?: number;
}

/** Constructor options for {@link SecurityReporter}. */
export interface SecurityReporterOptions {
  /** The audit log the reporter reads from. */
  store: AuditStore;
  /** Optional pre-built query (defaults to a fresh one over `store`). */
  query?: AuditQuery;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
  /** Configuration overrides (anomaly rules, redaction defaults). */
  config?: Partial<AuditConfig>;
}

/**
 * Masks well-known secret shapes inside strings and event payloads.
 *
 * The redactor walks a set of configurable patterns (emails, API keys, bearer
 * tokens, JWTs, passwords, and caller-supplied custom patterns) and replaces
 * every match with a masked value, optionally preserving a few leading and
 * trailing characters so operators can still correlate which secret was
 * scrubbed. Events can be redacted wholesale with {@link Redactor.redactEvent},
 * which also masks the values of sensitive keys (e.g. `password`,
 * `api_key`, `authorization`) inside the structured payload.
 */
export class Redactor {
  /** Pattern applied to whole matches (single capture group semantics). */
  private static readonly WHOLE = 0;

  private readonly config: RedactConfig;
  private readonly patterns: Array<{ regex: RegExp; replace: (groups: Array<string | undefined>) => string }> = [];
  private readonly sensitiveKeyPattern: RegExp =
    /(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|authorization|bearer|private[_-]?key)/i;

  /**
   * @param config Redaction rules (merged over the frozen defaults).
   */
  constructor(config: RedactConfig = resolveRedactConfig()) {
    this.config = resolveRedactConfig(config);
    this.buildPatterns();
  }

  /**
   * Returns the resolved redaction configuration in effect.
   *
   * @returns A readonly view of the active {@link RedactConfig}.
   */
  getConfig(): Readonly<RedactConfig> {
    return this.config;
  }

  /**
   * Masks every configured secret shape found in a string.
   *
   * @param input The string to scrub.
   * @returns The input with all matches replaced by masked values.
   */
  redact(input: string): string {
    if (typeof input !== 'string' || input.length === 0) return input;
    let out = input;
    for (const pattern of this.patterns) {
      out = out.replace(pattern.regex, (...args: unknown[]) => {
        const groups = args.slice(0, args.length - 2) as Array<string | undefined>;
        return pattern.replace(groups);
      });
    }
    return out;
  }

  /**
   * Returns a copy of an {@link AuditEvent} with its `message` and structured
   * `data` scrubbed. The event's id, type, action, timestamps and other facets
   * are preserved so the event remains correlated with its origin.
   *
   * @param event The event to redact.
   * @returns A new, redacted event.
   */
  redactEvent(event: AuditEvent): AuditEvent {
    const message = event.message === undefined ? undefined : this.redact(event.message);
    const data = this.redactData(event.data);
    return createAuditEvent({
      id: event.id,
      type: event.type,
      action: event.action,
      actor: event.actor,
      target: event.target,
      result: event.result,
      severity: event.severity,
      message,
      data,
      timestamp: event.timestamp,
    });
  }

  /**
   * Recursively scrubs string values in a structured payload. String values
   * under sensitive key names (passwords, tokens, authorization, ...) are
   * masked entirely; every other string is run through {@link Redactor.redact}.
   *
   * @param data The structured payload to scrub.
   * @returns A deep copy with string values masked, or `undefined`.
   */
  redactData(data: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
    if (data === undefined) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        out[key] = this.sensitiveKeyPattern.test(key) ? this.maskValue(value) : this.redact(value);
      } else if (Array.isArray(value)) {
        out[key] = value.map((item) => {
          if (typeof item === 'string') return this.redact(item);
          if (isRecord(item)) return this.redactData(item);
          return item;
        });
      } else if (isRecord(value)) {
        out[key] = this.redactData(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Masks a single value, honouring `maskWith` and the optional preserved
   * prefix/suffix lengths.
   *
   * @param value The raw value to mask.
   * @returns The masked value.
   */
  maskValue(value: string): string {
    if (typeof value !== 'string' || value.length === 0) return value;
    const maskWith = this.config.maskWith ?? '***';
    const prefix = Math.max(0, Math.floor(this.config.preservePrefix ?? 0));
    const suffix = Math.max(0, Math.floor(this.config.preserveSuffix ?? 0));
    const keepStart = Math.min(prefix, value.length);
    const keepEnd = Math.min(suffix, Math.max(0, value.length - keepStart));
    if (keepStart + keepEnd >= value.length) return maskWith;
    const head = value.slice(0, keepStart);
    const tail = keepEnd > 0 ? value.slice(value.length - keepEnd) : '';
    return `${head}${maskWith}${tail}`;
  }

  /**
   * Builds the active pattern list from the configuration flags.
   */
  private buildPatterns(): void {
    const c = this.config;
    if (c.email) {
      this.addWhole(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
    }
    if (c.jwt) {
      this.addWhole(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
    }
    if (c.bearerTokens) {
      this.patterns.push({
        regex: /(\bBearer\s+)([A-Za-z0-9._~+/=-]+)/gi,
        replace: (groups) => `${groups[1] ?? ''}${this.maskValue(groups[2] ?? '')}`,
      });
    }
    if (c.apiKeys) {
      this.addWhole(/\b(?:mam_ak_|mam_tk_|sk-|sk_|pk-|pk_|ak-|ak_|ghp_|gho_|xox[bap]-|github_pat_)[A-Za-z0-9_-]{8,}/gi);
      this.patterns.push({
        regex: /\b(api[_-]?key|apikey|access[_-]?token|client[_-]?secret)\b(\s*[=:]\s*)(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
        replace: (groups) => `${groups[1] ?? ''}${groups[2] ?? ''}${this.maskValue(groups[3] ?? groups[4] ?? groups[5] ?? '')}`,
      });
    }
    if (c.passwords) {
      this.patterns.push({
        regex: /\b(password|passwd|pwd|secret)\b(\s*[=:]\s*)(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
        replace: (groups) => `${groups[1] ?? ''}${groups[2] ?? ''}${this.maskValue(groups[3] ?? groups[4] ?? groups[5] ?? '')}`,
      });
    }
    if (c.ipAddresses) {
      this.addWhole(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
    }
    if (c.phoneNumbers) {
      this.addWhole(/\b\+?\d[\d\s().-]{7,}\d\b/g);
    }
    if (c.cardNumbers) {
      this.addWhole(/\b(?:\d[ -]?){13,19}\b/g);
    }
    for (const custom of c.customPatterns ?? []) {
      if (custom instanceof RegExp) {
        const flags = custom.flags.includes('g') ? custom.flags : `${custom.flags}g`;
        this.addWhole(new RegExp(custom.source, flags));
      } else if (typeof custom === 'string' && custom.length > 0) {
        this.addWhole(new RegExp(escapeRegExp(custom), 'g'));
      }
    }
  }

  /**
   * Registers a whole-match masking pattern.
   *
   * @param regex The global regex whose full match is masked.
   */
  private addWhole(regex: RegExp): void {
    this.patterns.push({
      regex,
      replace: (groups) => this.maskValue(groups[Redactor.WHOLE] ?? ''),
    });
  }
}

/**
 * Escapes a string so it can be used verbatim inside a `RegExp`.
 *
 * @param value The literal string to escape.
 * @returns The escaped regex source.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The high-level audit logger: records redacted security events, offers
 * convenience recorders and runs anomaly detection.
 *
 * ```ts
 * const audit = createAuditLogger();
 * audit.start();
 * audit.recordDenied('document.read', 'alice', { target: 'doc-42' });
 * audit.recordError('kms.decrypt', 'provider unreachable');
 * const flags = audit.detectAnomalies();
 * const stats = audit.stats();
 * ```
 */
export class AuditLogger {
  private readonly store: AuditStore;
  private readonly index: AuditIndex;
  private readonly queryRef: AuditQuery;
  private readonly lifecycle: AuditLifecycle;
  private readonly config: AuditConfig;
  private readonly now: () => number;
  private readonly redactor: Redactor;

  /**
   * @param options Configuration plus optional pre-built collaborators.
   */
  constructor(options: AuditLoggerOptions = {}) {
    this.config = resolveAuditConfig(options.config);
    this.now = options.now ?? nowMs;
    this.store = options.store ?? new AuditStore({ config: this.config, now: this.now });
    this.index = options.index ?? new AuditIndex();
    this.redactor = options.redactor ?? new Redactor(this.config.redact);
    this.queryRef = options.query ?? new AuditQuery({ store: this.store, index: this.index, now: this.now });
    this.lifecycle =
      options.lifecycle ??
      new AuditLifecycle({ store: this.store, index: this.index, config: this.config, now: this.now });
  }

  /**
   * Records a security event. The event is normalized, redacted (message and
   * payload are scrubbed by the configured {@link Redactor}) and appended to
   * the store, where the lifecycle mirrors it into the index and runs anomaly
   * detection.
   *
   * @param event A full event or a partial input to be normalized.
   * @returns The stored, redacted, frozen event.
   */
  record(event: AuditEvent | AuditEventInput): AuditEvent {
    const normalized = createAuditEvent(event);
    const redacted = this.redactor.redactEvent(normalized);
    return this.store.record(redacted);
  }

  /**
   * Convenience recorder for an allowed action.
   *
   * @param action The action verb.
   * @param actor The performing principal (defaults to the config default).
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordAllowed(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: extra.type ?? 'access',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
      result: 'allowed',
      severity: 'info',
    });
  }

  /**
   * Convenience recorder for a denied action — the core signal for security
   * review. Denials default to `warn` severity and feed both the anomaly
   * detection engine and the reporter's denied-ratio metrics.
   *
   * @param action The action verb.
   * @param actor The performing principal (defaults to the config default).
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordDenied(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: extra.type ?? 'access',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
      result: 'denied',
      severity: 'warn',
    });
  }

  /**
   * Convenience recorder for a technical failure. The outcome is `error` and
   * the given `message` is redacted before storage.
   *
   * @param action The action verb.
   * @param message Human-readable description of the failure.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordError(action: string, message: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: extra.type ?? 'access',
      action,
      actor: extra.actor ?? this.config.defaultActor,
      result: 'error',
      severity: extra.severity ?? 'warn',
      message,
    });
  }

  /**
   * Convenience recorder for an authentication event.
   *
   * @param action The action verb (e.g. `login`, `token.verify`).
   * @param actor The performing principal.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordAuth(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: 'auth',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
    });
  }

  /**
   * Convenience recorder for an authorization/access decision.
   *
   * @param action The action verb (e.g. `document.read`).
   * @param actor The performing principal.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordAccess(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: 'access',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
    });
  }

  /**
   * Convenience recorder for a policy event (role changes, policy edits).
   *
   * @param action The action verb (e.g. `role.grant`).
   * @param actor The performing principal.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordPolicy(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: 'policy',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
    });
  }

  /**
   * Convenience recorder for a sandbox event (boundary crossings, isolation).
   *
   * @param action The action verb (e.g. `sandbox.spawn`).
   * @param actor The performing principal.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordSandbox(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: 'sandbox',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
    });
  }

  /**
   * Convenience recorder for a secret lifecycle event (issue, rotate, revoke).
   *
   * @param action The action verb (e.g. `secret.rotate`).
   * @param actor The performing principal.
   * @param extra Additional event fields merged into the record.
   * @returns The stored event.
   */
  recordSecret(action: string, actor?: string, extra: AuditEventInput = {}): AuditEvent {
    return this.record({
      ...extra,
      type: 'secret',
      action,
      actor: actor ?? extra.actor ?? this.config.defaultActor,
    });
  }

  /**
   * Runs the rule-based anomaly detection engine over a set of events.
   *
   * @param events Events to evaluate; defaults to the full current log.
   * @returns An array of {@link AnomalyFlag} findings (empty when clean).
   */
  detectAnomalies(events?: readonly AuditEvent[]): AnomalyFlag[] {
    const source = events ?? this.store.all();
    return detectAnomalies(source, this.config, this.now());
  }

  /**
   * Masks secrets inside a string using the configured redactor.
   *
   * @param value The string to scrub.
   * @returns The scrubbed string.
   */
  redact(value: string): string {
    return this.redactor.redact(value);
  }

  /**
   * Returns the read-side query facade over the current log.
   *
   * @returns The {@link AuditQuery}.
   */
  query(): AuditQuery {
    return this.queryRef;
  }

  /**
   * Computes engine-wide {@link AuditStats}.
   *
   * @returns A fresh stats object.
   */
  stats(): AuditStats {
    return this.lifecycle.stats();
  }

  /**
   * Subscribes to lifecycle events (see {@link AuditLifecycle}).
   *
   * @param event Event name.
   * @param listener Event callback.
   * @returns An unsubscribe function.
   */
  on<K extends keyof import('./lifecycle.js').AuditLifecycleEvents>(
    event: K,
    listener: (payload: import('./lifecycle.js').AuditLifecycleEvents[K]) => void,
  ): () => void {
    return this.lifecycle.on(event, listener);
  }

  /**
   * Starts the periodic retention prune.
   *
   * @returns `true` when started (or already running).
   */
  start(): boolean {
    return this.lifecycle.start();
  }

  /**
   * Stops the periodic retention prune.
   *
   * @returns `true` when a running pruner was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns whether the periodic pruner is running.
   *
   * @returns `true` when started without a matching stop.
   */
  isRunning(): boolean {
    return this.lifecycle.isRunning();
  }

  /**
   * Runs an immediate retention prune.
   *
   * @param olderThanMs Age threshold in milliseconds.
   * @param at Reference time in epoch ms.
   * @returns A {@link PruneResult} describing the sweep.
   */
  prune(olderThanMs?: number, at?: number): PruneResult {
    return this.lifecycle.prune(olderThanMs, at);
  }

  /**
   * Clears all recorded events and index state.
   *
   * @returns The total number of records cleared.
   */
  reset(): number {
    return this.lifecycle.reset();
  }

  /**
   * Tears down the logger (stops the pruner and detaches listeners).
   */
  dispose(): void {
    this.lifecycle.dispose();
  }

  /**
   * Accessors for advanced composition: returns the underlying store, index,
   * query, lifecycle and redactor instances.
   */
  internals(): {
    store: AuditStore;
    index: AuditIndex;
    query: AuditQuery;
    lifecycle: AuditLifecycle;
    redactor: Redactor;
  } {
    return {
      store: this.store,
      index: this.index,
      query: this.queryRef,
      lifecycle: this.lifecycle,
      redactor: this.redactor,
    };
  }
}

/**
 * Aggregates the audit log into a {@link SecurityReport}.
 *
 * The reporter reads the store (through an {@link AuditQuery}) and computes
 * per-type/result/severity tallies, the denied and error ratios, the most
 * active actors and actions (each with its denial count), the anomalies
 * present in the window and the most recent denied events.
 */
export class SecurityReporter {
  private readonly store: AuditStore;
  private readonly query: AuditQuery;
  private readonly now: () => number;
  private readonly config: AuditConfig;

  /**
   * @param options Backing store, optional query, clock and config.
   */
  constructor(options: SecurityReporterOptions) {
    this.store = options.store;
    this.now = options.now ?? nowMs;
    this.config = resolveAuditConfig(options.config);
    this.query = options.query ?? new AuditQuery({ store: this.store, now: this.now });
  }

  /**
   * Produces a {@link SecurityReport} over the events in the given window.
   *
   * @param options Window bounds and tally limits.
   * @returns A fully-populated security report.
   */
  report(options: ReportOptions = {}): SecurityReport {
    const generatedAt = this.now();
    const window = { from: options.from, to: options.to };
    const events = this.query.range(options.from, options.to);
    const total = events.length;

    const totals = {} as Record<AuditType, number>;
    for (const type of AUDIT_TYPES) totals[type] = 0;
    const byResult = {} as Record<AuditResult, number>;
    for (const result of AUDIT_RESULTS) byResult[result] = 0;
    const bySeverity = {} as Record<AuditSeverity, number>;
    for (const severity of AUDIT_SEVERITIES) bySeverity[severity] = 0;

    const actorAgg = new Map<string, { count: number; denied: number }>();
    const actionAgg = new Map<string, { count: number; denied: number }>();
    for (const event of events) {
      totals[event.type] += 1;
      byResult[event.result] += 1;
      bySeverity[event.severity] += 1;
      if (event.actor !== undefined) {
        const entry = actorAgg.get(event.actor) ?? { count: 0, denied: 0 };
        entry.count += 1;
        if (event.result === 'denied') entry.denied += 1;
        actorAgg.set(event.actor, entry);
      }
      const actionEntry = actionAgg.get(event.action) ?? { count: 0, denied: 0 };
      actionEntry.count += 1;
      if (event.result === 'denied') actionEntry.denied += 1;
      actionAgg.set(event.action, actionEntry);
    }

    const topN = Math.max(1, Math.floor(options.topN ?? 10));
    const topActors = Array.from(actorAgg.entries())
      .map(([actor, value]) => ({ actor, count: value.count, denied: value.denied }))
      .sort((a, b) => b.count - a.count || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0))
      .slice(0, topN);
    const topActions = Array.from(actionAgg.entries())
      .map(([action, value]) => ({ action, count: value.count, denied: value.denied }))
      .sort((a, b) => b.count - a.count || (a.action < b.action ? -1 : a.action > b.action ? 1 : 0))
      .slice(0, topN);

    const anomalies = detectAnomalies(events, this.config, generatedAt);
    const recentDeniedLimit = Math.max(0, Math.floor(options.recentDeniedLimit ?? 20));
    const recentDenied = events
      .filter((event) => event.result === 'denied')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, recentDeniedLimit);

    return {
      generatedAt,
      totalEvents: total,
      window,
      totals,
      byResult,
      bySeverity,
      deniedRatio: total > 0 ? byResult.denied / total : 0,
      errorRatio: total > 0 ? byResult.error / total : 0,
      criticalCount: bySeverity.critical,
      topActors,
      topActions,
      anomalies,
      recentDenied,
    };
  }

  /**
   * Produces a compact aggregate summary by delegating to the query layer.
   *
   * @param topN Number of rows in the top-actor / top-action tallies.
   * @returns An {@link AuditSummary}.
   */
  summary(topN: number = 10): AuditSummary {
    return this.query.summary(topN);
  }

  /**
   * Returns the backing store this reporter reads from.
   *
   * @returns The {@link AuditStore}.
   */
  storeRef(): AuditStore {
    return this.store;
  }
}

/**
 * Factory for a ready-to-use {@link AuditLogger} with merged defaults.
 *
 * @param config Configuration overrides (may be empty).
 * @param options Additional construction options (clock, collaborators).
 * @returns A configured audit logger (not yet started).
 */
export function createAuditLogger(config?: Partial<AuditConfig>, options: AuditOptions = {}): AuditLogger {
  return new AuditLogger({ config, ...options });
}

/**
 * Factory for a ready-to-use {@link SecurityReporter} with merged defaults.
 *
 * @param config Configuration overrides (may be empty).
 * @param options Backing store and clock.
 * @returns A configured security reporter.
 */
export function createSecurityReporter(
  config?: Partial<AuditConfig>,
  options: { store?: AuditStore; now?: () => number } = {},
): SecurityReporter {
  const store = options.store ?? new AuditStore();
  return new SecurityReporter({ store, config, now: options.now });
}