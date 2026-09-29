/**
 * index.ts
 *
 * `PolicyIndex` — a denormalized, queryable index over the registered policy
 * rules.
 *
 * Instead of scanning every rule on each evaluation, the index maintains
 * four cross-cutting lookup tables plus an id→rule map:
 *
 * - `byId`      — every rule keyed by its id (fast direct access).
 * - `byAction`  — rule ids grouped by the rule's action.
 * - `byResource`— rule ids grouped by the rule's resource.
 * - `bySubject` — rule ids grouped by the rule's subject.
 * - `byEffect`  — rule ids grouped by the rule's effect.
 *
 * Because {@link PolicyEvaluator} runs in the hot path, the index trades
 * memory for speed: lookups are O(1) map reads and candidate narrowing is set
 * union rather than linear scans. Wildcard rules (any dimension equal to `*`
 * or omitted) live in a dedicated bucket so every query can cheaply include
 * them.
 *
 * The index is designed to stay consistent with a {@link PolicyStore}: rules
 * are (re)indexed via {@link indexRule} after store mutations, or the whole
 * index can be rebuilt from the store in one pass with {@link rebuild}.
 *
 * @module policy/index
 */

import {
  ACTION_ANY,
  RESOURCE_ANY,
  SUBJECT_ANY,
  isPolicyRule,
  type PolicyEffect,
  type PolicyRule,
} from './types.js';

/**
 * Aggregate statistics about the index contents.
 */
export interface PolicyIndexStats {
  /** Number of distinct rules indexed. */
  rules: number;
  /** Number of distinct actions indexed. */
  actions: number;
  /** Number of distinct resources indexed. */
  resources: number;
  /** Number of distinct subjects indexed (including the wildcard bucket). */
  subjects: number;
  /** Number of distinct effects indexed (1 or 2). */
  effects: number;
  /** Rules whose action is the wildcard `*`. */
  wildcardActions: number;
  /** Rules whose resource is the wildcard `*`. */
  wildcardResources: number;
  /** Rules whose subject is the wildcard `*`. */
  wildcardSubjects: number;
  /** Rules whose every dimension is unconstrained (fully wildcarded). */
  catchAllRules: number;
}

/** Options accepted by the lookup methods. */
export interface FindOptions {
  /**
   * When `true` (default), wildcard entries for the queried dimension are
   * included in the result set; when `false`, only exact matches are
   * returned.
   */
  readonly includeWildcards?: boolean;
  /**
   * When `true` (default), disabled rules are included; when `false` they are
   * filtered out of the results.
   */
  readonly includeDisabled?: boolean;
}

const DEFAULT_FIND_OPTIONS: Readonly<FindOptions> = Object.freeze({
  includeWildcards: true,
  includeDisabled: true,
});

/**
 * Normalizes a subject/action/resource value to the wildcard marker so every
 * rule belongs to exactly one bucket per dimension.
 */
function bucket(value: string | undefined): string {
  return value === undefined ? '*' : value;
}

/**
 * A queryable index over policy rules.
 *
 * @example
 * ```ts
 * const index = new PolicyIndex();
 * index.indexRule(store.getRule('read-docs')!);
 * const candidates = index.find({ action: 'read', resource: 'document' });
 * ```
 */
export class PolicyIndex {
  /** Rule id → rule record (fast access to the indexed rule). */
  private readonly byId = new Map<string, PolicyRule>();
  /** action bucket → set of rule ids. */
  private readonly byAction = new Map<string, Set<string>>();
  /** resource bucket → set of rule ids. */
  private readonly byResource = new Map<string, Set<string>>();
  /** subject bucket → set of rule ids. */
  private readonly bySubject = new Map<string, Set<string>>();
  /** effect → set of rule ids. */
  private readonly byEffect = new Map<string, Set<string>>();

  /**
   * Creates an empty index, optionally pre-populated with rules.
   *
   * @param rules Rules to index immediately.
   */
  constructor(rules?: Iterable<PolicyRule>) {
    if (rules) {
      this.indexRules(rules);
    }
  }

  /**
   * Indexes a single rule: its id is added to the subject, action, resource
   * and effect buckets it belongs to.
   *
   * @param rule The rule to index (validated structurally).
   * @returns The number of new bucket entries added.
   * @throws {TypeError} when the rule is structurally invalid.
   */
  indexRule(rule: PolicyRule): number {
    if (!isPolicyRule(rule)) {
      throw new TypeError('Cannot index an invalid PolicyRule object');
    }
    let added = 0;
    this.byId.set(rule.id, rule);
    added += this.addToBucket(this.bySubject, bucket(rule.subject), rule.id);
    added += this.addToBucket(this.byAction, bucket(rule.action), rule.id);
    added += this.addToBucket(this.byResource, bucket(rule.resource), rule.id);
    added += this.addToBucket(this.byEffect, rule.effect, rule.id);
    return added;
  }

  /**
   * Indexes many rules in a single pass.
   *
   * @param rules Rules to index.
   * @returns The total number of new bucket entries added.
   */
  indexRules(rules: Iterable<PolicyRule>): number {
    let added = 0;
    for (const rule of rules) {
      added += this.indexRule(rule);
    }
    return added;
  }

  /**
   * Removes a rule from every bucket it belongs to. Uniqueness is enforced by
   * the store, so the id map never holds duplicates and removal is total.
   *
   * @param ruleId Rule id to remove.
   * @returns `true` when the rule was indexed and removed.
   */
  removeRule(ruleId: string): boolean {
    const rule = this.byId.get(ruleId);
    if (!rule) {
      return false;
    }
    this.byId.delete(ruleId);
    this.deleteFromBucket(this.bySubject, bucket(rule.subject), ruleId);
    this.deleteFromBucket(this.byAction, bucket(rule.action), ruleId);
    this.deleteFromBucket(this.byResource, bucket(rule.resource), ruleId);
    this.deleteFromBucket(this.byEffect, rule.effect, ruleId);
    return true;
  }

  /**
   * Replaces the indexed record for a rule id, refreshing its buckets. Used
   * after an enable/disable toggle or an in-place rule update.
   *
   * @param rule The updated rule (must already exist or will be added).
   * @returns `true` when the rule was indexed.
   */
  syncRule(rule: PolicyRule): boolean {
    this.removeRule(rule.id);
    this.indexRule(rule);
    return true;
  }

  /**
   * Returns the indexed rule record for an id.
   *
   * @param ruleId Rule id to resolve.
   * @returns The indexed rule, or `undefined` when absent.
   */
  getRule(ruleId: string): PolicyRule | undefined {
    return this.byId.get(ruleId);
  }

  /**
   * Returns whether a rule id is currently indexed.
   *
   * @param ruleId Rule id to check.
   * @returns `true` when the rule is indexed.
   */
  has(ruleId: string): boolean {
    return this.byId.has(ruleId);
  }

  /**
   * Returns every rule whose action matches the query. With
   * `includeWildcards` (default) the wildcard action rules are included.
   *
   * @param action Action to match.
   * @param options Result filtering.
   * @returns Matching rules (defensive copy, sorted by id).
   */
  findByAction(action: string, options: FindOptions = DEFAULT_FIND_OPTIONS): PolicyRule[] {
    return this.collect(this.byAction.get(action), this.byAction.get(ACTION_ANY), options, 'action');
  }

  /**
   * Returns every rule whose resource matches the query.
   *
   * @param resource Resource to match.
   * @param options Result filtering.
   * @returns Matching rules (defensive copy, sorted by id).
   */
  findByResource(resource: string, options: FindOptions = DEFAULT_FIND_OPTIONS): PolicyRule[] {
    return this.collect(this.byResource.get(resource), this.byResource.get(RESOURCE_ANY), options, 'resource');
  }

  /**
   * Returns every rule whose subject matches the query. Unscoped rules live in
   * the {@link SUBJECT_ANY} bucket.
   *
   * @param subject Subject to match.
   * @param options Result filtering.
   * @returns Matching rules (defensive copy, sorted by id).
   */
  findBySubject(subject: string, options: FindOptions = DEFAULT_FIND_OPTIONS): PolicyRule[] {
    return this.collect(this.bySubject.get(subject), this.bySubject.get(SUBJECT_ANY), options, 'subject');
  }

  /**
   * Returns every rule with the given effect.
   *
   * @param effect Effect to match.
   * @param options Result filtering.
   * @returns Matching rules (defensive copy, sorted by id).
   */
  findByEffect(effect: PolicyEffect, options: FindOptions = DEFAULT_FIND_OPTIONS): PolicyRule[] {
    return this.collect(this.byEffect.get(effect), undefined, options, 'effect');
  }

  /**
   * Candidate lookup for a request: returns the rules potentially relevant for
   * the request's subject/action/resource. The result is the union of the
   * exact-dimension buckets and the wildcard buckets, giving the evaluator a
   * small candidate set to score. Disabled rules are included by default and
   * filtered by the evaluator; pass `includeDisabled: false` to drop them
   * here.
   *
   * @param request The request dimensions to match (any may be omitted).
   * @returns Candidate rules for the request.
   */
  find(request: { subject?: string; action?: string; resource?: string }): PolicyRule[] {
    const ids = new Set<string>();
    if (request.subject !== undefined) {
      this.addDimensionTo(request.subject, SUBJECT_ANY, this.bySubject, ids);
    }
    if (request.action !== undefined) {
      this.addDimensionTo(request.action, ACTION_ANY, this.byAction, ids);
    }
    if (request.resource !== undefined) {
      this.addDimensionTo(request.resource, RESOURCE_ANY, this.byResource, ids);
    }
    if (request.subject === undefined && request.action === undefined && request.resource === undefined) {
      for (const rule of this.byId.values()) {
        ids.add(rule.id);
      }
    }
    return this.resolveSorted(ids);
  }

  /**
   * Returns the candidate rule ids for a request (used internally by the
   * evaluator when it wants raw ids).
   *
   * @param request The request dimensions to match.
   * @returns Candidate rule ids.
   */
  findIds(request: { subject?: string; action?: string; resource?: string }): string[] {
    return this.find(request).map((rule) => rule.id);
  }

  /**
   * Returns whether the index contains no rules.
   */
  get isEmpty(): boolean {
    return this.byId.size === 0;
  }

  /**
   * Number of distinct rules currently indexed.
   */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Returns every rule id currently indexed, sorted lexically.
   *
   * @returns A defensive array of rule ids.
   */
  ids(): string[] {
    return Array.from(this.byId.keys()).sort();
  }

  /**
   * Returns every indexed rule, sorted by id.
   *
   * @returns A defensive array of rules.
   */
  rules(): PolicyRule[] {
    return this.ids().map((id) => this.byId.get(id)!).filter((rule): rule is PolicyRule => Boolean(rule));
  }

  /**
   * Rebuilds the index from scratch from an iterable of rules. All current
   * entries are discarded before re-indexing.
   *
   * @param rules Rules to index.
   * @returns The total number of new bucket entries indexed.
   */
  rebuild(rules: Iterable<PolicyRule>): number {
    this.clear();
    return this.indexRules(rules);
  }

  /**
   * Removes every entry from the index.
   */
  clear(): void {
    this.byId.clear();
    this.byAction.clear();
    this.byResource.clear();
    this.bySubject.clear();
    this.byEffect.clear();
  }

  /**
   * Computes aggregate statistics about the index.
   *
   * @returns A fresh {@link PolicyIndexStats}.
   */
  stats(): PolicyIndexStats {
    let wildcardActions = 0;
    let wildcardResources = 0;
    let wildcardSubjects = 0;
    let catchAllRules = 0;
    for (const rule of this.byId.values()) {
      if (rule.action === ACTION_ANY || rule.action === undefined) wildcardActions += 1;
      if (rule.resource === RESOURCE_ANY || rule.resource === undefined) wildcardResources += 1;
      if (rule.subject === SUBJECT_ANY || rule.subject === undefined) wildcardSubjects += 1;
      const unconstrained =
        (rule.action === undefined || rule.action === ACTION_ANY) &&
        (rule.resource === undefined || rule.resource === RESOURCE_ANY) &&
        (rule.subject === undefined || rule.subject === SUBJECT_ANY);
      if (unconstrained) catchAllRules += 1;
    }
    return {
      rules: this.byId.size,
      actions: this.byAction.size,
      resources: this.byResource.size,
      subjects: this.bySubject.size,
      effects: this.byEffect.size,
      wildcardActions,
      wildcardResources,
      wildcardSubjects,
      catchAllRules,
    };
  }

  /**
   * Serializes the index into a JSON-safe structure. Primarily for
   * diagnostics; prefer {@link rebuild} for persistence round-trips.
   *
   * @returns A plain object describing the index.
   */
  toJSON(): { rules: string[]; byAction: Record<string, string[]>; byResource: Record<string, string[]> } {
    const byAction: Record<string, string[]> = {};
    for (const [label, ids] of this.byAction) {
      byAction[label] = Array.from(ids).sort();
    }
    const byResource: Record<string, string[]> = {};
    for (const [label, ids] of this.byResource) {
      byResource[label] = Array.from(ids).sort();
    }
    return { rules: this.ids(), byAction, byResource };
  }

  /**
   * Collects rules from a primary and wildcard bucket, applying filters.
   */
  private collect(
    primary: Set<string> | undefined,
    wildcard: Set<string> | undefined,
    options: FindOptions,
    dimension: 'action' | 'resource' | 'subject' | 'effect',
  ): PolicyRule[] {
    const ids = new Set<string>();
    if (primary) {
      for (const id of primary) ids.add(id);
    }
    if (options.includeWildcards && wildcard) {
      for (const id of wildcard) ids.add(id);
    }
    const out: PolicyRule[] = [];
    for (const id of ids) {
      const rule = this.byId.get(id);
      if (!rule) continue;
      if (dimension !== 'effect') {
        const isWild = this.isWildForDimension(rule, dimension);
        if (!options.includeWildcards && isWild && !primary?.has(id)) continue;
      }
      if (options.includeDisabled === false && rule.enabled === false) continue;
      out.push(rule);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Adds the exact and wildcard bucket members for a dimension into a set.
   */
  private addDimensionTo(
    label: string,
    wildcardLabel: string,
    bucket: Map<string, Set<string>>,
    into: Set<string>,
  ): void {
    bucket.get(label)?.forEach((id) => into.add(id));
    if (label !== wildcardLabel) {
      bucket.get(wildcardLabel)?.forEach((id) => into.add(id));
    }
  }

  /**
   * Resolves a set of ids into a sorted defensive rule array.
   */
  private resolveSorted(ids: Iterable<string>): PolicyRule[] {
    const out: PolicyRule[] = [];
    for (const id of ids) {
      const rule = this.byId.get(id);
      if (rule) out.push(rule);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Returns whether a rule's value for a dimension is the wildcard marker.
   */
  private isWildForDimension(rule: PolicyRule, dimension: 'action' | 'resource' | 'subject'): boolean {
    if (dimension === 'action') return rule.action === undefined || rule.action === ACTION_ANY;
    if (dimension === 'resource') return rule.resource === undefined || rule.resource === RESOURCE_ANY;
    return rule.subject === undefined || rule.subject === SUBJECT_ANY;
  }

  /**
   * Adds a rule id to a bucket, creating the bucket on demand.
   */
  private addToBucket(bucket: Map<string, Set<string>>, label: string, id: string): number {
    let ids = bucket.get(label);
    if (!ids) {
      ids = new Set<string>();
      bucket.set(label, ids);
    }
    if (ids.has(id)) {
      return 0;
    }
    ids.add(id);
    return 1;
  }

  /**
   * Removes a rule id from a bucket, pruning empty buckets.
   */
  private deleteFromBucket(bucket: Map<string, Set<string>>, label: string, id: string): void {
    const ids = bucket.get(label);
    if (!ids) {
      return;
    }
    ids.delete(id);
    if (ids.size === 0) {
      bucket.delete(label);
    }
  }
}

/**
 * Convenience factory building an index over a list of rules.
 *
 * @param rules Rules to index.
 * @returns A populated {@link PolicyIndex}.
 */
export function createPolicyIndex(rules: readonly PolicyRule[] = []): PolicyIndex {
  return new PolicyIndex(rules);
}

/**
 * Type-only re-export for integration consumers.
 */
export type { PolicyEffect, PolicyRule };