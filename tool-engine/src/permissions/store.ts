/**
 * store.ts
 *
 * The {@link PermissionStore} is the authoritative in-memory registry of
 * {@link PermissionRule} objects. It is deliberately dependency-free and
 * synchronous: rules are stored in a `Map<string, PermissionRule>` keyed by
 * rule id, with derived counters maintained incrementally so that
 * {@link PermissionStore.stats} is O(1).
 *
 * Responsibilities:
 *
 *   - CRUD: `addRule`, `removeRule`, `getRule`, `listRules`, `clear`.
 *   - Bulk operations: `addMany`.
 *   - Rule lifecycle: `enable`, `disable`.
 *   - Convenience grants: {@link PermissionStore.grant} builds allow rules for
 *     a tool across one or many roles in a single call.
 *   - Serialization: `toJSON`/`fromJSON` produce and consume a plain, JSON-safe
 *     representation so policies can be persisted, shipped to workers, or
 *     loaded from disk.
 *
 * The store emits the following events (it extends `node:events`):
 *
 *   - `'add'`    `(rule: PermissionRule)` after a rule is added.
 *   - `'remove'` `(rule: PermissionRule)` after a rule is removed.
 *   - `'change'` `(rule: PermissionRule)` after a rule is modified in place.
 *
 * All mutating methods validate their inputs and throw `TypeError` on bad
 * shapes so that corruption never silently propagates into the index.
 *
 * @module permissions/store
 */

import { EventEmitter } from 'node:events';
import {
  PermissionRule,
  PermissionStats,
  GrantOptions,
  isPermissionRule,
  createRule,
  cloneRule,
  createEmptyStats,
  resolveConfig,
  PermissionConfig,
  randomId,
  DEFAULT_RULE_PRIORITY,
  RoleName,
  ToolName,
  CapabilityName,
} from './types.js';

/**
 * The set of events emitted by a {@link PermissionStore}.
 *
 * @public
 */
export interface StoreEvents {
  /** Fired after a rule is added. */
  add: [rule: PermissionRule];
  /** Fired after a rule is removed. */
  remove: [rule: PermissionRule];
  /** Fired after a rule is modified (enabled/disabled) in place. */
  change: [rule: PermissionRule];
  /** Fired when the store is cleared. */
  clear: [];
}

/**
 * A JSON-safe serialized representation of a {@link PermissionStore}.
 *
 * @public
 */
export interface SerializedPermissionStore {
  /** Schema version for forward/backward compatibility. */
  version: 1;
  /** Rules stored as plain objects. */
  rules: PermissionRule[];
  /** Optional configuration snapshot. */
  config?: PermissionConfig;
}

/**
 * In-memory rule registry for the permissions layer.
 *
 * The store owns the rule list and nothing else: resolution semantics live in
 * `retrieval.ts` and indexing lives in `index.ts`. This separation keeps each
 * concern small and independently testable.
 *
 * @public
 */
export class PermissionStore extends EventEmitter {
  private readonly rules: Map<string, PermissionRule>;
  private readonly config: PermissionConfig;
  private dirty = false;
  private readonly toolSet: Set<string>;
  private readonly capabilitySet: Set<string>;
  private enabledCount = 0;
  private allowCount = 0;
  private denyCount = 0;
  private lastModified = 0;

  /**
   * Create a new store.
   *
   * @param config - Optional checker configuration; currently used to record
   *   baseline priority and wildcard behavior alongside the policy data.
   * @param initialRules - Rules to seed the store with.
   */
  constructor(config: Partial<PermissionConfig> = {}, initialRules: PermissionRule[] = []) {
    super();
    this.config = resolveConfig(config);
    this.rules = new Map<string, PermissionRule>();
    this.toolSet = new Set<string>();
    this.capabilitySet = new Set<string>();
    this.lastModified = Date.now();
    this.addMany(initialRules);
  }

  /**
   * Add a single rule to the store.
   *
   * Rejects rules with a duplicate id (the store treats ids as unique keys).
   * The stored copy is deep-cloned so later mutation of the caller's object
   * does not corrupt the registry.
   *
   * @param rule - The rule to add; may be a partial that will be completed by
   *   {@link createRule}.
   * @returns The stored rule.
   * @throws {TypeError} When the rule is not valid or its id already exists.
   * @emits add
   */
  addRule(rule: PermissionRule): PermissionRule {
    if (!isPermissionRule(rule)) {
      throw new TypeError('PermissionStore.addRule: invalid rule shape');
    }
    if (this.rules.has(rule.id)) {
      throw new TypeError(`PermissionStore.addRule: duplicate rule id "${rule.id}"`);
    }
    const stored = cloneRule(rule);
    this.rules.set(stored.id, stored);
    this.record(stored);
    this.lastModified = Date.now();
    this.dirty = true;
    this.emit('add', stored);
    return stored;
  }

  /**
   * Add or replace a rule, overwriting any existing rule with the same id.
   *
   * @param rule - The rule to upsert.
   * @returns The stored rule.
   * @throws {TypeError} When the rule shape is invalid.
   * @emits add / remove / change
   */
  upsertRule(rule: PermissionRule): PermissionRule {
    if (!isPermissionRule(rule)) {
      throw new TypeError('PermissionStore.upsertRule: invalid rule shape');
    }
    const existing = this.rules.get(rule.id);
    if (existing) {
      this.unrecord(existing);
    }
    const stored = cloneRule(rule);
    this.rules.set(stored.id, stored);
    this.record(stored);
    this.lastModified = Date.now();
    this.dirty = true;
    if (existing) {
      this.emit('change', stored);
    } else {
      this.emit('add', stored);
    }
    return stored;
  }

  /**
   * Remove a rule by id.
   *
   * @param ruleId - The id of the rule to remove.
   * @returns The removed rule, or `undefined` when no such rule existed.
   * @emits remove
   */
  removeRule(ruleId: string): PermissionRule | undefined {
    const existing = this.rules.get(ruleId);
    if (!existing) {
      return undefined;
    }
    this.rules.delete(ruleId);
    this.unrecord(existing);
    this.lastModified = Date.now();
    this.dirty = true;
    this.emit('remove', existing);
    return existing;
  }

  /**
   * Remove every rule that matches a predicate.
   *
   * @param predicate - Called once per rule; return `true` to remove.
   * @returns The number of rules removed.
   * @emits remove (once per removed rule)
   */
  removeWhere(predicate: (rule: PermissionRule) => boolean): number {
    let removed = 0;
    for (const rule of Array.from(this.rules.values())) {
      if (predicate(rule)) {
        this.removeRule(rule.id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Retrieve a rule by id without copying.
   *
   * The returned object is the internal reference; treat it as read-only.
   *
   * @param ruleId - Rule id to look up.
   * @returns The rule, or `undefined`.
   */
  getRule(ruleId: string): PermissionRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Retrieve a defensive copy of a rule by id.
   *
   * @param ruleId - Rule id to look up.
   * @returns A cloned rule, or `undefined`.
   */
  getRuleClone(ruleId: string): PermissionRule | undefined {
    const rule = this.rules.get(ruleId);
    return rule ? cloneRule(rule) : undefined;
  }

  /**
   * List all rules.
   *
   * The returned array is a fresh array of clones; mutating entries has no
   * effect on the store.
   *
   * @returns An array of all rules in insertion order.
   */
  listRules(): PermissionRule[] {
    return Array.from(this.rules.values(), (rule) => cloneRule(rule));
  }

  /**
   * List only enabled rules.
   *
   * @returns Cloned, enabled rules.
   */
  listEnabled(): PermissionRule[] {
    return this.listRules().filter((rule) => rule.enabled !== false);
  }

  /**
   * Add many rules in a single call.
   *
   * Adds are applied transactionally-ish: each rule is validated individually,
   * duplicate ids abort the whole batch, and the `add` event fires per rule.
   *
   * @param rules - Rules to add.
   * @returns The number of rules actually added.
   * @throws {TypeError} When any rule is invalid or a duplicate id appears.
   */
  addMany(rules: PermissionRule[]): number {
    let added = 0;
    for (const rule of rules) {
      this.addRule(rule);
      added += 1;
    }
    return added;
  }

  /**
   * Remove all rules from the store.
   *
   * @emits clear
   */
  clear(): void {
    this.rules.clear();
    this.toolSet.clear();
    this.capabilitySet.clear();
    this.enabledCount = 0;
    this.allowCount = 0;
    this.denyCount = 0;
    this.lastModified = Date.now();
    this.dirty = true;
    this.emit('clear');
  }

  /**
   * Enable a rule by id (no-op when already enabled or missing).
   *
   * @param ruleId - Rule id to enable.
   * @returns `true` when the rule changed state, `false` otherwise.
   * @emits change
   */
  enable(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.enabled === true) {
      return false;
    }
    rule.enabled = true;
    this.enabledCount += 1;
    this.lastModified = Date.now();
    this.dirty = true;
    this.emit('change', rule);
    return true;
  }

  /**
   * Disable a rule by id (no-op when already disabled or missing).
   *
   * Disabled rules remain in the registry but are ignored during resolution.
   *
   * @param ruleId - Rule id to disable.
   * @returns `true` when the rule changed state, `false` otherwise.
   * @emits change
   */
  disable(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.enabled === false) {
      return false;
    }
    rule.enabled = false;
    this.enabledCount -= 1;
    this.lastModified = Date.now();
    this.dirty = true;
    this.emit('change', rule);
    return true;
  }

  /**
   * Convenience: grant a tool to one or many roles by creating allow rule(s).
   *
   * When `perRole` is false (default), a single rule with `roles: [...]` is
   * created. When true, one rule per role is created so that individual roles
   * can later be revoked independently.
   *
   * @param tool - Tool name being granted.
   * @param roles - Roles receiving the grant.
   * @param options - {@link GrantOptions}.
   * @returns The created rule(s).
   * @throws {TypeError} When `tool` or `roles` are invalid.
   * @emits add
   */
  grant(tool: ToolName, roles: RoleName[], options: GrantOptions = {}): PermissionRule[] {
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new TypeError('PermissionStore.grant: tool must be a non-empty string');
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new TypeError('PermissionStore.grant: roles must be a non-empty array');
    }
    for (const role of roles) {
      if (typeof role !== 'string' || role.length === 0) {
        throw new TypeError('PermissionStore.grant: every role must be a non-empty string');
      }
    }
    const uniqueRoles = Array.from(new Set(roles));
    const priority = options.priority ?? DEFAULT_RULE_PRIORITY;
    const created: PermissionRule[] = [];
    if (options.perRole === true) {
      for (const role of uniqueRoles) {
        const rule = createRule({
          id: randomId(),
          tool,
          capability: options.capability,
          roles: [role],
          effect: 'allow',
          priority,
          enabled: options.enabled ?? true,
          reason: options.reason,
          metadata: options.metadata,
        });
        this.addRule(rule);
        created.push(rule);
      }
    } else {
      const rule = createRule({
        id: randomId(),
        tool,
        capability: options.capability,
        roles: uniqueRoles,
        effect: 'allow',
        priority,
        enabled: options.enabled ?? true,
        reason: options.reason,
        metadata: options.metadata,
      });
      this.addRule(rule);
      created.push(rule);
    }
    return created;
  }

  /**
   * Check whether a rule with the given id exists.
   *
   * @param ruleId - Rule id to test.
   * @returns `true` when present.
   */
  has(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  /**
   * Total number of rules in the store.
   */
  get size(): number {
    return this.rules.size;
  }

  /**
   * True when the store has been mutated since the last `dirty` reset.
   */
  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark the store as clean (e.g. after a successful persistence flush).
   */
  markClean(): void {
    this.dirty = false;
  }

  /**
   * Timestamp (epoch ms) of the most recent mutation.
   */
  get lastModifiedAt(): number {
    return this.lastModified;
  }

  /**
   * Compute an O(1) {@link PermissionStats} snapshot.
   *
   * Distinct tool/capability counts are maintained incrementally on mutation,
   * so this call never iterates the registry.
   *
   * @returns A fresh stats object.
   */
  stats(): PermissionStats {
    return {
      totalRules: this.rules.size,
      enabledRules: this.enabledCount,
      disabledRules: this.rules.size - this.enabledCount,
      allowRules: this.allowCount,
      denyRules: this.denyCount,
      distinctTools: this.toolSet.size,
      distinctCapabilities: this.capabilitySet.size,
      lastModified: this.lastModified,
    };
  }

  /**
   * Serialize the store to a plain JSON-safe object.
   *
   * @returns {@link SerializedPermissionStore} for persistence or transport.
   */
  toJSON(): SerializedPermissionStore {
    return {
      version: 1,
      rules: this.listRules(),
      config: { ...this.config },
    };
  }

  /**
   * Rehydrate a store from a serialized snapshot.
   *
   * Replaces the current contents wholesale.
   *
   * @param data - A {@link SerializedPermissionStore} produced by `toJSON`.
   * @returns A new store populated with the serialized rules.
   * @throws {TypeError} On structurally invalid data.
   */
  static fromJSON(data: unknown): PermissionStore {
    if (typeof data !== 'object' || data === null) {
      throw new TypeError('PermissionStore.fromJSON: expected an object');
    }
    const record = data as Record<string, unknown>;
    if (record.version !== 1) {
      throw new TypeError(`PermissionStore.fromJSON: unsupported version ${JSON.stringify(record.version)}`);
    }
    if (!Array.isArray(record.rules)) {
      throw new TypeError('PermissionStore.fromJSON: "rules" must be an array');
    }
    const config =
      typeof record.config === 'object' && record.config !== null
        ? (record.config as Partial<PermissionConfig>)
        : {};
    const store = new PermissionStore(config);
    for (const rule of record.rules as unknown[]) {
      if (!isPermissionRule(rule)) {
        throw new TypeError('PermissionStore.fromJSON: invalid rule in snapshot');
      }
      store.addRule(rule as PermissionRule);
    }
    return store;
  }

  /**
   * Clone an entire store (rules and config).
   *
   * @returns A deep copy sharing no mutable state with `this`.
   */
  clone(): PermissionStore {
    return PermissionStore.fromJSON(this.toJSON());
  }

  /**
   * Alias for {@link PermissionStore.addRule} so the store can be used as a
   * drop-in collection with a common "put" naming convention.
   */
  put(rule: PermissionRule): PermissionRule {
    return this.upsertRule(rule);
  }

  /**
   * Alias for {@link PermissionStore.removeRule}.
   */
  delete(ruleId: string): PermissionRule | undefined {
    return this.removeRule(ruleId);
  }

  /**
   * Look up the distinct tools referenced across all rules.
   *
   * @returns An array of tool names.
   */
  distinctTools(): ToolName[] {
    return Array.from(this.toolSet);
  }

  /**
   * Look up the distinct capabilities referenced across all rules.
   *
   * @returns An array of capability names.
   */
  distinctCapabilities(): CapabilityName[] {
    return Array.from(this.capabilitySet);
  }

  private record(rule: PermissionRule): void {
    if (rule.enabled !== false) {
      this.enabledCount += 1;
    }
    if (rule.effect === 'allow') {
      this.allowCount += 1;
    } else {
      this.denyCount += 1;
    }
    if (rule.tool !== undefined) {
      this.toolSet.add(rule.tool);
    }
    if (rule.capability !== undefined) {
      this.capabilitySet.add(rule.capability);
    }
  }

  private unrecord(rule: PermissionRule): void {
    if (rule.enabled !== false) {
      this.enabledCount -= 1;
    }
    if (rule.effect === 'allow') {
      this.allowCount -= 1;
    } else {
      this.denyCount -= 1;
    }
    if (rule.tool !== undefined) {
      this.toolSet.delete(rule.tool);
    }
    if (rule.capability !== undefined) {
      this.capabilitySet.delete(rule.capability);
    }
  }
}

/**
 * Convenience factory: create a store seeded with a single allow grant.
 *
 * @param tool - Tool to grant.
 * @param roles - Roles to grant to.
 * @returns A configured store.
 */
export function createPermissionStore(
  tool?: ToolName,
  roles: RoleName[] = []
): PermissionStore {
  const store = new PermissionStore();
  if (tool !== undefined) {
    store.grant(tool, roles);
  }
  return store;
}