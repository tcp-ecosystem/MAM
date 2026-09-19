export interface Policy {
  id: string;
  name: string;
  description?: string;
  type: 'execution' | 'resource' | 'security' | 'network' | 'data';
  rules: PolicyRule[];
  priority: number;
  enabled: boolean;
  version?: number;
  group?: string;
}

export interface PolicyRule {
  action: 'allow' | 'deny' | 'limit' | 'log';
  target: string;
  conditions?: PolicyCondition[];
  value?: unknown;
}

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'gt' | 'lt';
  value: unknown;
}

export interface PolicyEvaluation {
  allowed: boolean;
  matched: boolean;
  policy?: string;
  reason?: string;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description?: string;
  rules: PolicyRule[];
  defaults: Partial<Policy>;
}

export interface PolicyVersion {
  version: number;
  policy: Policy;
  timestamp: number;
}

export interface PolicyConflict {
  policyA: string;
  policyB: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PolicyStats {
  policyId: string;
  evaluations: number;
  hits: number;
  denies: number;
  allows: number;
  hitRate: number;
  lastEvaluated?: number;
}

export interface PolicyExport {
  version: string;
  timestamp: number;
  policies: Policy[];
  templates: PolicyTemplate[];
  groups: Record<string, string[]>;
}

type CompositionLogic = 'AND' | 'OR' | 'NOT';

type ConditionOperatorFn = (fieldValue: unknown, conditionValue: unknown) => boolean;

export class PolicyEngine {
  private policies: Map<string, Policy> = new Map();
  private templates: Map<string, PolicyTemplate> = new Map();
  private versions: Map<string, PolicyVersion[]> = new Map();
  private groups: Map<string, Set<string>> = new Map();
  private stats: Map<string, PolicyStats> = new Map();
  private customOperators: Map<string, ConditionOperatorFn> = new Map();

  register(policy: Policy): void {
    this.policies.set(policy.id, { ...policy, version: 1 });
    this.stats.set(policy.id, {
      policyId: policy.id,
      evaluations: 0,
      hits: 0,
      denies: 0,
      allows: 0,
      hitRate: 0,
    });
    this.versions.set(policy.id, [{
      version: 1,
      policy: { ...policy, version: 1 },
      timestamp: Date.now(),
    }]);
  }

  unregister(policyId: string): boolean {
    this.stats.delete(policyId);
    this.versions.delete(policyId);
    Array.from(this.groups.values()).forEach(members => members.delete(policyId));
    return this.policies.delete(policyId);
  }

  evaluate(action: string, target: string, context?: Record<string, unknown>): PolicyEvaluation {
    const sortedPolicies = Array.from(this.policies.values())
      .filter(p => p.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const policy of sortedPolicies) {
      for (const rule of policy.rules) {
        if (this.matchesTarget(rule.target, target)) {
          if (this.evaluateConditions(rule.conditions ?? [], context ?? {})) {
            this.recordEvaluation(policy.id, rule.action);
            return {
              allowed: rule.action === 'allow',
              matched: true,
              policy: policy.id,
              reason: rule.action === 'deny' ? `Denied by policy: ${policy.name}` : undefined,
            };
          }
        }
      }
    }

    return { allowed: false, matched: false };
  }

  list(): Policy[] {
    return Array.from(this.policies.values());
  }

  getEnabled(): Policy[] {
    return Array.from(this.policies.values()).filter(p => p.enabled);
  }

  compose(policies: string[], logic: CompositionLogic): Policy {
    const composedRules: PolicyRule[] = [];
    for (const pid of policies) {
      const policy = this.policies.get(pid);
      if (!policy) {
        throw new Error(`Policy ${pid} not found`);
      }
      composedRules.push(...policy.rules);
    }
    const composed: Policy = {
      id: `composed-${Date.now()}`,
      name: `Composed (${logic})`,
      type: 'execution',
      rules: composedRules,
      priority: Math.max(...policies.map(pid => this.policies.get(pid)!.priority)) + 1,
      enabled: true,
    };
    this.register(composed);
    return composed;
  }

  createTemplate(name: string, rules: PolicyRule[], defaults?: Partial<Policy>): PolicyTemplate {
    const template: PolicyTemplate = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      rules,
      defaults: defaults ?? {},
    };
    this.templates.set(template.id, template);
    return template;
  }

  applyTemplate(templateId: string, overrides: Partial<Policy>): Policy {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }
    const policy: Policy = {
      id: overrides.id ?? `policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: overrides.name ?? template.name,
      description: overrides.description ?? template.description,
      type: overrides.type ?? template.defaults.type ?? 'execution',
      rules: overrides.rules ?? template.rules,
      priority: overrides.priority ?? template.defaults.priority ?? 0,
      enabled: overrides.enabled ?? template.defaults.enabled ?? true,
    };
    this.register(policy);
    return policy;
  }

  version(policyId: string): number {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }
    return policy.version ?? 1;
  }

  rollback(policyId: string, targetVersion: number): Policy {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }
    const versionHistory = this.versions.get(policyId);
    if (!versionHistory) {
      throw new Error(`No version history for policy ${policyId}`);
    }
    const entry = versionHistory.find(v => v.version === targetVersion);
    if (!entry) {
      throw new Error(`Version ${targetVersion} not found for policy ${policyId}`);
    }
    const restored = { ...entry.policy, version: (policy.version ?? 1) + 1 };
    this.policies.set(policyId, restored);
    versionHistory.push({
      version: restored.version!,
      policy: { ...restored },
      timestamp: Date.now(),
    });
    return restored;
  }

  simulate(action: string, target: string, context?: Record<string, unknown>): PolicyEvaluation {
    const sortedPolicies = Array.from(this.policies.values())
      .filter(p => p.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const policy of sortedPolicies) {
      for (const rule of policy.rules) {
        if (this.matchesTarget(rule.target, target)) {
          if (this.evaluateConditions(rule.conditions ?? [], context ?? {})) {
            return {
              allowed: rule.action === 'allow',
              matched: true,
              policy: policy.id,
              reason: `[SIMULATED] ${rule.action === 'deny' ? `Denied by policy: ${policy.name}` : `Allowed by policy: ${policy.name}`}`,
            };
          }
        }
      }
    }

    return { allowed: false, matched: false, reason: '[SIMULATED] No matching policy' };
  }

  detectConflicts(): PolicyConflict[] {
    const conflicts: PolicyConflict[] = [];
    const enabledPolicies = this.getEnabled();

    for (let i = 0; i < enabledPolicies.length; i++) {
      for (let j = i + 1; j < enabledPolicies.length; j++) {
        const a = enabledPolicies[i];
        const b = enabledPolicies[j];

        for (const ruleA of a.rules) {
          for (const ruleB of b.rules) {
            if (this.targetsOverlap(ruleA.target, ruleB.target)) {
              if (ruleA.action !== ruleB.action) {
                const severity: PolicyConflict['severity'] =
                  ruleA.action === 'deny' || ruleB.action === 'deny' ? 'high' : 'medium';
                conflicts.push({
                  policyA: a.id,
                  policyB: b.id,
                  reason: `Conflicting actions on target ${ruleA.target}: ${ruleA.action} vs ${ruleB.action}`,
                  severity,
                });
              }
            }
          }
        }
      }
    }

    return conflicts;
  }

  enableGroup(groupName: string): void {
    const members = this.groups.get(groupName);
    if (!members) {
      throw new Error(`Group ${groupName} not found`);
    }
    Array.from(members).forEach(pid => {
      const policy = this.policies.get(pid);
      if (policy) {
        policy.enabled = true;
      }
    });
  }

  disableGroup(groupName: string): void {
    const members = this.groups.get(groupName);
    if (!members) {
      throw new Error(`Group ${groupName} not found`);
    }
    Array.from(members).forEach(pid => {
      const policy = this.policies.get(pid);
      if (policy) {
        policy.enabled = false;
      }
    });
  }

  addToGroup(groupName: string, policyId: string): void {
    if (!this.policies.has(policyId)) {
      throw new Error(`Policy ${policyId} not found`);
    }
    if (!this.groups.has(groupName)) {
      this.groups.set(groupName, new Set());
    }
    this.groups.get(groupName)!.add(policyId);
    const policy = this.policies.get(policyId)!;
    policy.group = groupName;
  }

  removeFromGroup(groupName: string, policyId: string): void {
    const members = this.groups.get(groupName);
    if (members) {
      members.delete(policyId);
    }
    const policy = this.policies.get(policyId);
    if (policy) {
      policy.group = undefined;
    }
  }

  listGroups(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    Array.from(this.groups.entries()).forEach(([name, members]) => {
      result[name] = Array.from(members);
    });
    return result;
  }

  getPolicyStats(policyId: string): PolicyStats {
    const stat = this.stats.get(policyId);
    if (!stat) {
      throw new Error(`No stats for policy ${policyId}`);
    }
    return { ...stat };
  }

  export(): PolicyExport {
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      policies: Array.from(this.policies.values()),
      templates: Array.from(this.templates.values()),
      groups: this.listGroups(),
    };
  }

  import(data: PolicyExport): void {
    for (const policy of data.policies) {
      this.policies.set(policy.id, policy);
      if (!this.stats.has(policy.id)) {
        this.stats.set(policy.id, {
          policyId: policy.id,
          evaluations: 0,
          hits: 0,
          denies: 0,
          allows: 0,
          hitRate: 0,
        });
      }
    }
    for (const template of data.templates) {
      this.templates.set(template.id, template);
    }
    for (const [groupName, members] of Object.entries(data.groups)) {
      this.groups.set(groupName, new Set(members));
    }
  }

  evaluateBatch(actions: Array<{ action: string; target: string; context?: Record<string, unknown> }>): PolicyEvaluation[] {
    return actions.map(({ action, target, context }) => this.evaluate(action, target, context));
  }

  addConditionOperator(name: string, fn: ConditionOperatorFn): void {
    this.customOperators.set(name, fn);
  }

  removeConditionOperator(name: string): boolean {
    return this.customOperators.delete(name);
  }

  private recordEvaluation(policyId: string, action: string): void {
    const stat = this.stats.get(policyId);
    if (!stat) return;
    stat.evaluations++;
    stat.hits++;
    if (action === 'deny') {
      stat.denies++;
    } else if (action === 'allow') {
      stat.allows++;
    }
    stat.hitRate = stat.evaluations > 0 ? stat.hits / stat.evaluations : 0;
    stat.lastEvaluated = Date.now();
  }

  private matchesTarget(pattern: string, target: string): boolean {
    if (pattern === '*') return true;
    if (pattern === target) return true;
    const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(target);
  }

  private targetsOverlap(patternA: string, patternB: string): boolean {
    if (patternA === '*' || patternB === '*') return true;
    if (patternA === patternB) return true;
    try {
      const regexA = new RegExp(`^${patternA.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      if (regexA.test(patternB)) return true;
      const regexB = new RegExp(`^${patternB.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      return regexB.test(patternA);
    } catch {
      return patternA === patternB;
    }
  }

  private evaluateConditions(conditions: PolicyCondition[], context: Record<string, unknown>): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => {
      const fieldValue = context[condition.field];
      const customOp = this.customOperators.get(condition.operator as string);
      if (customOp) {
        return customOp(fieldValue, condition.value);
      }
      switch (condition.operator) {
        case 'equals': return fieldValue === condition.value;
        case 'contains': return String(fieldValue).includes(String(condition.value));
        case 'matches': return new RegExp(String(condition.value)).test(String(fieldValue));
        case 'gt': return Number(fieldValue) > Number(condition.value);
        case 'lt': return Number(fieldValue) < Number(condition.value);
        default: return false;
      }
    });
  }
}
