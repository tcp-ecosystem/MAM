/**
 * store.ts
 *
 * `PolicyStore` — the in-memory policy rule registry for the MAM Security
 * Policy layer.
 *
 * The store owns one kind of state: an id-keyed registry of {@link PolicyRule}
 * records. Each rule is an atomic allow/deny statement about a
 * subject/action/resource triple. The store is deliberately free of
 * decision-making logic — matching, scoring and defaulting live in
 * `retrieval.ts` — but it provides the complete mutation surface: add,
 * inspect, remove, list, enable, disable, serialize and deserialize.
 *
 * All persisted records are frozen and all returned collections are defensive
 * copies, so callers cannot corrupt internal state through a shared reference.
 * Rule ids are unique; adding a rule whose id already exists is an error so
 * accidental double-registration is surfaced loudly instead of silently
 * overwriting policy.
 *
 * The store is serializable to a versioned JSON snapshot via {@link toJSON}
 * and {@link fromJSON}. Rule `condition` callbacks are functions and cannot
 * be serialized; the snapshot omits them and documents the loss. Everything
 * else — dimensions, effect, priority, enabled flag, metadata, timestamps —
 * round-trips cleanly.
 *
 * @module policy/store
 */

import {
  POLICY_SNAPSHOT_VERSION,
  assertPolicyRule,
  createEmptyStats,
  createPolicyRule,
  isPolicyDefinition,
  isPolicyRule,
  isRecord,
  isValidRuleId,
  ruleSpecificity,
  type PolicyDefinition,
  type PolicyEffect,
  type PolicyRule,
  type PolicyStats,
} from './types.js';

/**
 * The serialized shape of a {@link PolicyStore}, versioned so future formats
 * can be migrated safely. Rule conditions (functions) are not representable
 * and are dropped from snapshots.
 */
export interface PolicyStoreSnapshot {
  /** Schema version of the snapshot (see {@link POLICY_SNAPSHOT_VERSION}). */
  readonly version: number;
  /** Every rule in the store (conditions omitted). */
  readonly rules: readonly PolicyRuleSnapshot[];
}

/**
 * A rule as it appears in a snapshot: a {@link PolicyRule} minus its
 * condition function, which cannot be serialized.
 */
export type PolicyRuleSnapshot = {
  readonly id: string;
  readonly name?: string;
  readonly effect: PolicyEffect;
  readonly subject?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly createdAt?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Options accepted by {@link PolicyStore.removeRule}. Currently empty but kept
 * so future removal behaviour (e.g. cascade into indexes) does not change the
 * signature.
 */
export interface RemoveRuleOptions {
  /**
   * Reserved for future use. When `true`, the removal also broadcasts through
   * attached observers. Defaults to `true`.
   */
  readonly notify?: boolean;
}

/** Default options for mutations that accept an options bag. */
const DEFAULT_REMOVE_OPTIONS: Readonly<RemoveRuleOptions> = Object.freeze({ notify: true });

/**
 * Validates a plain rule-like object, fills defaults and returns a frozen
 * {@link PolicyRule}. Throws a descriptive error for structurally invalid
 * input or an empty id.
 */
function normalizeRuleDefinition(input: PolicyDefinition): PolicyRule {
  if (!isValidRuleId(input.id)) {
    throw new TypeError('Rule id must be a non-empty, non-whitespace string');
  }
  return createPolicyRule(input);
}

/**
 * The policy rule registry for the security engine.
 *
 * @example
 * ```ts
 * const store = new PolicyStore();
 * store.addRule({ id: 'read-docs', effect: 'allow', action: 'read', resource: 'document' });
 * store.addRule({ id: 'block-delete', effect: 'deny', action: 'delete' });
 * store.disable('read-docs');
 * const snapshot = store.toJSON();
 * ```
 */
export class PolicyStore {
  private readonly rules = new Map<string, PolicyRule>();

  /** Lifetime count of added rules. */
  private additions = 0;
  /** Lifetime count of removed rules. */
  private removals = 0;
  /** Lifetime count of enable/disable transitions. */
  private toggles = 0;
  /** Epoch ms of the last mutation (add/remove/toggle/clear). */
  private lastMutationAt: number | undefined;

  /**
   * Creates an empty store, optionally pre-loaded with rules.
   *
   * @param rules Initial rules to register (validated on load).
   */
  constructor(rules?: Iterable<PolicyDefinition | PolicyRule>) {
    if (rules) {
      for (const rule of rules) {
        this.addRule(rule);
      }
    }
  }

  /**
   * Registers a rule in the registry. The supplied definition is validated,
   * normalized and frozen before storage. Rule ids are unique: adding a rule
   * whose id already exists throws a {@link ReferenceError}.
   *
   * @param definition Rule definition or an already-frozen {@link PolicyRule}.
   * @returns The stored {@link PolicyRule}.
   * @throws {TypeError} when the definition is malformed.
   * @throws {ReferenceError} when the id is already registered.
   */
  addRule(definition: PolicyDefinition | PolicyRule): PolicyRule {
    const rule = isPolicyRule(definition) ? definition : normalizeRuleDefinition(definition);
    assertPolicyRule(rule, 'rule definition');
    if (this.rules.has(rule.id)) {
      throw new ReferenceError(`A rule with id "${rule.id}" is already registered`);
    }
    const stored = createPolicyRule({
      id: rule.id,
      name: rule.name,
      effect: rule.effect,
      subject: rule.subject,
      action: rule.action,
      resource: rule.resource,
      condition: rule.condition,
      priority: rule.priority,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      metadata: rule.metadata,
    });
    this.rules.set(stored.id, stored);
    this.additions += 1;
    this.touch();
    return stored;
  }

  /**
   * Registers many rules in one call, returning how many were added. If any
   * rule is invalid or collides with an existing id, the whole batch is
   * rejected (all-or-nothing) so the registry is never left in a partially
   * applied state.
   *
   * @param definitions Rules to register.
   * @returns The number of rules added.
   * @throws {TypeError} when any definition is malformed.
   * @throws {ReferenceError} when any id collides.
   */
  addMany(definitions: readonly (PolicyDefinition | PolicyRule)[]): number {
    const staged: PolicyRule[] = [];
    for (const definition of definitions) {
      const rule = isPolicyRule(definition) ? definition : normalizeRuleDefinition(definition);
      assertPolicyRule(rule, 'rule definition');
      if (this.rules.has(rule.id)) {
        throw new ReferenceError(`A rule with id "${rule.id}" is already registered`);
      }
      staged.push(rule);
    }
    let added = 0;
    for (const rule of staged) {
      this.addRule(rule);
      added += 1;
    }
    return added;
  }

  /**
   * Looks up a rule by id.
   *
   * @param id Rule id to resolve.
   * @returns The stored rule, or `undefined` when absent.
   */
  getRule(id: string): PolicyRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Returns whether a rule with the given id exists.
   *
   * @param id Rule id to check.
   * @returns `true` when the rule is registered.
   */
  hasRule(id: string): boolean {
    return this.rules.has(id);
  }

  /**
   * Returns every registered rule, sorted by id for stable iteration.
   *
   * @returns A defensive array of all rules.
   */
  listRules(): PolicyRule[] {
    return Array.from(this.rules.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Returns every registered rule id, sorted lexically.
   *
   * @returns A defensive array of rule ids.
   */
  listRuleIds(): string[] {
    return this.listRules().map((rule) => rule.id);
  }

  /**
   * Returns every rule whose effect matches the given effect, sorted by id.
   *
   * @param effect The effect to filter by.
   * @returns A defensive array of matching rules.
   */
  rulesByEffect(effect: PolicyEffect): PolicyRule[] {
    return this.listRules().filter((rule) => rule.effect === effect);
  }

  /**
   * Returns every enabled rule, sorted by id.
   *
   * @returns A defensive array of enabled rules.
   */
  listEnabledRules(): PolicyRule[] {
    return this.listRules().filter((rule) => rule.enabled !== false);
  }

  /**
   * Returns every disabled rule, sorted by id.
   *
   * @returns A defensive array of disabled rules.
   */
  listDisabledRules(): PolicyRule[] {
    return this.listRules().filter((rule) => rule.enabled === false);
  }

  /**
   * Removes a rule from the registry.
   *
   * @param id Rule id to remove.
   * @param options Removal behaviour.
   * @returns `true` when a rule was removed, `false` when it did not exist.
   */
  removeRule(id: string, options: RemoveRuleOptions = DEFAULT_REMOVE_OPTIONS): boolean {
    if (!this.rules.delete(id)) {
      return false;
    }
    this.removals += 1;
    if (options.notify !== false) {
      this.touch();
    }
    return true;
  }

  /**
   * Removes every rule matching a predicate.
   *
   * @param predicate Called once per rule; `true` removes the rule.
   * @returns The number of rules removed.
   */
  removeWhere(predicate: (rule: PolicyRule) => boolean): number {
    let removed = 0;
    for (const rule of this.listRules()) {
      if (predicate(rule)) {
        if (this.removeRule(rule.id)) {
          removed += 1;
        }
      }
    }
    return removed;
  }

  /**
   * Removes every rule from the store.
   */
  clear(): void {
    const count = this.rules.size;
    this.rules.clear();
    if (count > 0) {
      this.removals += count;
      this.touch();
    }
  }

  /**
   * Number of rules currently registered.
   */
  get size(): number {
    return this.rules.size;
  }

  /**
   * Enables a rule, making it eligible for evaluation again.
   *
   * @param ruleId Rule id to enable.
   * @returns `true` when the rule existed and was previously disabled.
   */
  enable(ruleId: string): boolean {
    return this.setEnabled(ruleId, true);
  }

  /**
   * Disables a rule so it is skipped during evaluation without removing it.
   *
   * @param ruleId Rule id to disable.
   * @returns `true` when the rule existed and was previously enabled.
   */
  disable(ruleId: string): boolean {
    return this.setEnabled(ruleId, false);
  }

  /**
   * Returns whether a rule is currently enabled.
   *
   * @param ruleId Rule id to inspect.
   * @returns `true` when the rule exists and is not disabled.
   */
  isEnabled(ruleId: string): boolean {
    return this.rules.get(ruleId)?.enabled !== false;
  }

  /**
   * Computes aggregate statistics about the store.
   *
   * @param extra Optional fields to merge over the computed counters.
   * @returns A fresh {@link PolicyStats} reflecting current state.
   */
  stats(extra: Partial<PolicyStats> = {}): PolicyStats {
    const base = createEmptyStats();
    const rules = this.listRules();
    const enabled = rules.filter((rule) => rule.enabled !== false).length;
    const allowRules = rules.filter((rule) => rule.effect === 'allow').length;
    return {
      ...base,
      rules: rules.length,
      enabled,
      disabled: rules.length - enabled,
      allowRules,
      denyRules: rules.length - allowRules,
      ...extra,
    };
  }

  /**
   * Serializes the store into a versioned, JSON-safe snapshot. Rule
   * conditions (functions) are omitted.
   *
   * @returns The snapshot object (safe to `JSON.stringify`).
   */
  toJSON(): PolicyStoreSnapshot {
    const rules: PolicyRuleSnapshot[] = this.listRules().map((rule) => ({
      id: rule.id,
      name: rule.name,
      effect: rule.effect,
      subject: rule.subject,
      action: rule.action,
      resource: rule.resource,
      priority: rule.priority,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      metadata: rule.metadata,
    }));
    return { version: POLICY_SNAPSHOT_VERSION, rules };
  }

  /**
   * Replaces the entire store state from a snapshot. The current state is
   * discarded after the snapshot validates successfully.
   *
   * @param snapshot Snapshot produced by {@link toJSON} (or hand-built).
   * @throws {TypeError} when the snapshot is structurally invalid.
   */
  fromJSON(snapshot: unknown): void {
    if (!isRecord(snapshot)) {
      throw new TypeError('PolicyStore snapshot must be an object');
    }
    if (snapshot.version !== undefined && snapshot.version !== POLICY_SNAPSHOT_VERSION) {
      throw new TypeError(`Unsupported PolicyStore snapshot version "${snapshot.version}"`);
    }
    if (!Array.isArray(snapshot.rules)) {
      throw new TypeError('PolicyStore snapshot is missing a rules array');
    }
    const staged: PolicyRule[] = [];
    for (const entry of snapshot.rules as unknown[]) {
      if (!isPolicyRule(entry)) {
        throw new TypeError('PolicyStore snapshot contains an invalid rule');
      }
      const rule = entry as PolicyRule;
      staged.push(createPolicyRule({
        id: rule.id,
        name: rule.name,
        effect: rule.effect,
        subject: rule.subject,
        action: rule.action,
        resource: rule.resource,
        priority: rule.priority,
        enabled: rule.enabled,
        createdAt: rule.createdAt,
        metadata: rule.metadata,
      }));
    }

    this.rules.clear();
    for (const rule of staged) {
      this.rules.set(rule.id, rule);
    }
    this.touch();
  }

  /**
   * Reconstructs a store from a snapshot in a single call.
   *
   * @param snapshot Snapshot produced by {@link toJSON}.
   * @returns A fully-populated {@link PolicyStore}.
   */
  static fromJSON(snapshot: unknown): PolicyStore {
    const store = new PolicyStore();
    store.fromJSON(snapshot);
    return store;
  }

  /**
   * Reconstructs a store from a JSON string.
   *
   * @param json The serialized snapshot text.
   * @returns A fully-populated {@link PolicyStore}.
   */
  static fromJSONString(json: string): PolicyStore {
    return PolicyStore.fromJSON(JSON.parse(json) as unknown);
  }

  /**
   * Internal helper: flips a rule's enabled flag, replacing it with a frozen
   * updated record.
   *
   * @param ruleId Rule id to toggle.
   * @param enabled Desired enabled state.
   * @returns `true` when the rule existed and its state actually changed.
   */
  private setEnabled(ruleId: string, enabled: boolean): boolean {
    const current = this.rules.get(ruleId);
    if (!current) {
      return false;
    }
    if (current.enabled === enabled) {
      return false;
    }
    const updated = createPolicyRule({
      id: current.id,
      name: current.name,
      effect: current.effect,
      subject: current.subject,
      action: current.action,
      resource: current.resource,
      condition: current.condition,
      priority: current.priority,
      enabled,
      createdAt: current.createdAt,
      metadata: current.metadata,
    });
    this.rules.set(ruleId, updated);
    this.toggles += 1;
    this.touch();
    return true;
  }

  /**
   * Records that the store was mutated, refreshing the mutation timestamp.
   */
  private touch(): void {
    this.lastMutationAt = Date.now();
  }
}

/**
 * Convenience factory that builds a {@link PolicyStore} pre-populated from a
 * list of rule definitions.
 *
 * @param definitions Rules to register.
 * @returns A store containing every supplied rule.
 */
export function createPolicyStore(definitions: readonly PolicyDefinition[] = []): PolicyStore {
  const store = new PolicyStore();
  store.addMany(definitions);
  return store;
}

/**
 * Returns the rules from a snapshot, re-validated. Useful for tooling that
 * wants to inspect a persisted policy set without mutating a store.
 *
 * @param snapshot Snapshot produced by {@link PolicyStore.toJSON}.
 * @returns The re-validated, frozen rules.
 * @throws {TypeError} when the snapshot is invalid.
 */
export function rulesFromSnapshot(snapshot: PolicyStoreSnapshot): PolicyRule[] {
  return PolicyStore.fromJSON(snapshot).listRules();
}

/**
 * Renders a single rule as a compact human-readable policy line, useful for
 * audit output and diagnostics.
 *
 * @param rule The rule to render.
 * @returns e.g. `"[allow] read document (subject=u-1, pri=10) — read-docs"`.
 */
export function renderRule(rule: PolicyRule): string {
  const triple = [rule.subject ?? '*', rule.action ?? '*', rule.resource ?? '*'].join(' ');
  const spec = ruleSpecificity(rule);
  const flags = [
    rule.enabled === false ? 'disabled' : 'enabled',
    rule.priority !== undefined ? `pri=${rule.priority}` : undefined,
    `spec=${spec}`,
    rule.condition !== undefined ? 'cond' : undefined,
  ].filter(Boolean).join(', ');
  return `[${rule.effect}] ${triple} (${flags}) — ${rule.id}`;
}

/**
 * Type-only re-export convenience so integration layers can refer to the core
 * rule types without importing `types.js` directly.
 */
export type { PolicyDefinition, PolicyEffect, PolicyRule, PolicyStats };