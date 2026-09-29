/**
 * index.ts
 *
 * The {@link PermissionIndex} is an accelerator structure for rule lookup.
 * While {@link PermissionStore} owns the authoritative rule list, the index
 * maintains a set of reverse maps so that the checker can gather candidate
 * rules in O(candidates) rather than O(all rules) on every request.
 *
 * Indexed dimensions:
 *
 *   - `byTool`       tool name -> rule ids
 *   - `byCapability` capability name -> rule ids (exact, plus wildcard buckets)
 *   - `byRole`       role name -> rule ids (including the `'*'` bucket)
 *   - `byEffect`     effect -> rule ids
 *
 * Every map stores *rule ids*, not rule objects. The ids are resolved lazily
 * against the underlying store by the checker, which keeps the index cheap to
 * maintain and avoids stale object references when rules are replaced.
 *
 * The index is designed to be driven by a store: callers subscribe to store
 * `add`/`remove`/`change`/`clear` events (or simply call the public methods
 * after a mutation) and then `rebuild()` when a full re-sync is desired.
 *
 * @module permissions/index
 */

import {
  PermissionRule,
  PermissionStats,
  ToolName,
  CapabilityName,
  RoleName,
  PermissionEffect,
  WILDCARD,
  parseCapability,
} from './types.js';

/**
 * The internal rule-id sets, grouped by index dimension.
 *
 * @public
 */
export interface PermissionIndexMap {
  byTool: Map<ToolName, Set<string>>;
  byCapability: Map<CapabilityName, Set<string>>;
  byRole: Map<RoleName, Set<string>>;
  byEffect: Map<PermissionEffect, Set<string>>;
}

/**
 * A snapshot of index coverage, useful for diagnostics and tests.
 *
 * @public
 */
export interface PermissionIndexStats {
  toolKeys: number;
  capabilityKeys: number;
  roleKeys: number;
  effectKeys: number;
  indexedRuleIds: number;
  wildcardCapabilityRules: number;
  wildcardRoleRules: number;
}

/**
 * Reverse-map accelerator for permission rules.
 *
 * The index never stores rule bodies — only ids — and therefore cannot be the
 * source of truth. Pair it with a {@link PermissionStore} and keep them in sync
 * by calling the mutation methods here (or by hooking the store's events).
 *
 * @public
 */
export class PermissionIndex {
  private readonly byTool = new Map<ToolName, Set<string>>();
  private readonly byCapability = new Map<CapabilityName, Set<string>>();
  private readonly byRole = new Map<RoleName, Set<string>>();
  private readonly byEffect = new Map<PermissionEffect, Set<string>>();
  private readonly wildcardCapabilityRules = new Set<string>();
  private readonly wildcardRoleRules = new Set<string>();

  /**
   * Add a single rule to the index.
   *
   * Idempotent per rule id: re-indexing the same id clears its previous
   * entries first, so callers may safely re-index after a rule mutation.
   *
   * @param rule - The rule to index.
   * @returns `true` if the id was newly introduced, `false` on re-index.
   */
  indexRule(rule: PermissionRule): boolean {
    const fresh = !this.contains(rule.id);
    this.removeRule(rule.id);
    this.indexTool(rule);
    this.indexCapability(rule);
    this.indexRoles(rule);
    this.indexEffect(rule);
    return fresh;
  }

  /**
   * Remove a rule id from every index map.
   *
   * @param ruleId - Id to remove.
   * @returns `true` when the id was present and removed.
   */
  removeRule(ruleId: string): boolean {
    let removed = false;
    for (const set of [
      ...this.byTool.values(),
      ...this.byCapability.values(),
      ...this.byRole.values(),
      ...this.byEffect.values(),
    ]) {
      if (set.delete(ruleId)) {
        removed = true;
      }
    }
    if (this.wildcardCapabilityRules.delete(ruleId)) {
      removed = true;
    }
    if (this.wildcardRoleRules.delete(ruleId)) {
      removed = true;
    }
    return removed;
  }

  /**
   * Find all rule ids that reference a given tool.
   *
   * @param tool - Tool name.
   * @returns Rule ids (never the internal set).
   */
  findByTool(tool: ToolName): string[] {
    return Array.from(this.byTool.get(tool) ?? []);
  }

  /**
   * Find rule ids that reference a capability, including wildcard rules that
   * cover the requested capability.
   *
   * For example, a request for `'file.read'` returns rules indexed under
   * `'file.read'`, `'file.*'` and `'*'`.
   *
   * @param capability - Requested capability.
   * @returns Matching rule ids.
   */
  findByCapability(capability: CapabilityName): string[] {
    const ids = new Set<string>();
    const parsed = parseCapability(capability);
    const bucket = this.byCapability.get(capability);
    if (bucket) {
      for (const id of bucket) {
        ids.add(id);
      }
    }
    if (parsed.segments.length > 0) {
      let prefix = '';
      for (const segment of parsed.segments.slice(0, -1)) {
        prefix = prefix.length === 0 ? segment : `${prefix}.${segment}`;
        const wildcardKey = `${prefix}.${WILDCARD}`;
        const wildcardBucket = this.byCapability.get(wildcardKey);
        if (wildcardBucket) {
          for (const id of wildcardBucket) {
            ids.add(id);
          }
        }
      }
    }
    for (const id of this.wildcardCapabilityRules) {
      ids.add(id);
    }
    return Array.from(ids);
  }

  /**
   * Find rule ids that reference a role, including the global `'*'` bucket.
   *
   * @param role - Role name.
   * @returns Matching rule ids.
   */
  findByRole(role: RoleName): string[] {
    const ids = new Set<string>();
    const bucket = this.byRole.get(role);
    if (bucket) {
      for (const id of bucket) {
        ids.add(id);
      }
    }
    for (const id of this.wildcardRoleRules) {
      ids.add(id);
    }
    return Array.from(ids);
  }

  /**
   * Find all rule ids with a given effect.
   *
   * @param effect - Effect to filter by.
   * @returns Rule ids.
   */
  findByEffect(effect: PermissionEffect): string[] {
    return Array.from(this.byEffect.get(effect) ?? []);
  }

  /**
   * Rebuild the entire index from a rule source.
   *
   * @param rules - The complete set of rules the index should reflect.
   * @returns The number of distinct rule ids indexed.
   */
  rebuild(rules: Iterable<PermissionRule>): number {
    this.clear();
    let count = 0;
    for (const rule of rules) {
      this.indexRule(rule);
      count += 1;
    }
    return count;
  }

  /**
   * Remove all index entries.
   */
  clear(): void {
    this.byTool.clear();
    this.byCapability.clear();
    this.byRole.clear();
    this.byEffect.clear();
    this.wildcardCapabilityRules.clear();
    this.wildcardRoleRules.clear();
  }

  /**
   * Whether a rule id is currently present in the index.
   *
   * @param ruleId - Id to test.
   * @returns `true` when the id appears in any bucket.
   */
  contains(ruleId: string): boolean {
    for (const set of this.byEffect.values()) {
      if (set.has(ruleId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Snapshot the index maps.
   *
   * @returns A shallow copy of the four maps plus wildcard buckets.
   */
  dump(): PermissionIndexMap {
    return {
      byTool: new Map(this.byTool),
      byCapability: new Map(this.byCapability),
      byRole: new Map(this.byRole),
      byEffect: new Map(this.byEffect),
    };
  }

  /**
   * Collect every rule id currently indexed.
   *
   * @returns An array of unique rule ids.
   */
  allIds(): string[] {
    const ids = new Set<string>();
    for (const set of this.byEffect.values()) {
      for (const id of set) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }

  /**
   * Count of distinct rule ids indexed.
   */
  get size(): number {
    return this.allIds().length;
  }

  /**
   * Compute coverage stats for the index.
   *
   * @returns A {@link PermissionIndexStats} snapshot.
   */
  stats(): PermissionIndexStats {
    return {
      toolKeys: this.byTool.size,
      capabilityKeys: this.byCapability.size,
      roleKeys: this.byRole.size,
      effectKeys: this.byEffect.size,
      indexedRuleIds: this.size,
      wildcardCapabilityRules: this.wildcardCapabilityRules.size,
      wildcardRoleRules: this.wildcardRoleRules.size,
    };
  }

  /**
   * Resolve a list of rule ids against a resolver function, preserving order
   * and dropping ids that no longer resolve.
   *
   * @param ids - Rule ids.
   * @param resolver - Maps an id to a rule (or `undefined`).
   * @returns Resolved rules in the input order.
   */
  resolve<T>(ids: Iterable<string>, resolver: (id: string) => T | undefined): T[] {
    const out: T[] = [];
    for (const id of ids) {
      const rule = resolver(id);
      if (rule !== undefined) {
        out.push(rule);
      }
    }
    return out;
  }

  /**
   * Compute a lightweight {@link PermissionStats} using the index maps rather
   * than a full scan of the store.
   *
   * @param storeRules - Total rules known to the owning store, if available.
   * @returns A best-effort stats object.
   */
  toPermissionStats(storeRules?: number): PermissionStats {
    const now = Date.now();
    return {
      totalRules: storeRules ?? this.size,
      enabledRules: 0,
      disabledRules: 0,
      allowRules: this.byEffect.get('allow')?.size ?? 0,
      denyRules: this.byEffect.get('deny')?.size ?? 0,
      distinctTools: this.byTool.size,
      distinctCapabilities: this.byCapability.size,
      lastModified: now,
    };
  }

  private indexTool(rule: PermissionRule): void {
    if (rule.tool === undefined) {
      return;
    }
    let set = this.byTool.get(rule.tool);
    if (!set) {
      set = new Set<string>();
      this.byTool.set(rule.tool, set);
    }
    set.add(rule.id);
  }

  private indexCapability(rule: PermissionRule): void {
    if (rule.capability === undefined) {
      return;
    }
    let set = this.byCapability.get(rule.capability);
    if (!set) {
      set = new Set<string>();
      this.byCapability.set(rule.capability, set);
    }
    set.add(rule.id);
    const parsed = parseCapability(rule.capability);
    if (rule.capability === WILDCARD || parsed.prefixSegments.length > 0) {
      this.wildcardCapabilityRules.add(rule.id);
    }
  }

  private indexRoles(rule: PermissionRule): void {
    const roles = rule.roles ?? [];
    if (roles.length === 0) {
      return;
    }
    for (const role of roles) {
      let set = this.byRole.get(role);
      if (!set) {
        set = new Set<string>();
        this.byRole.set(role, set);
      }
      set.add(rule.id);
      if (role === WILDCARD) {
        this.wildcardRoleRules.add(rule.id);
      }
    }
  }

  private indexEffect(rule: PermissionRule): void {
    let set = this.byEffect.get(rule.effect);
    if (!set) {
      set = new Set<string>();
      this.byEffect.set(rule.effect, set);
    }
    set.add(rule.id);
  }
}

/**
 * Factory helper that builds an index and immediately loads a set of rules.
 *
 * @param rules - Rules to index.
 * @returns A fully populated index.
 */
export function createPermissionIndex(rules: Iterable<PermissionRule> = []): PermissionIndex {
  const index = new PermissionIndex();
  index.rebuild(rules);
  return index;
}