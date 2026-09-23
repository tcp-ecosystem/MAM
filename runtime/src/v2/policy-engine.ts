/**
 * MAM V2 Policy Engine
 *
 * Behavioral constraints represented independently from implementation code:
 * allowed operations, execution limits, retry rules, timeout rules, data
 * handling, and network restrictions.
 */

import {
  type PolicyEngine,
  type PolicyDefinition,
  type PolicyCondition,
  type PolicyDecision,
  type PermissionContext,
} from './types.js';

export type PolicyKind =
  | 'operation'
  | 'execution-limit'
  | 'retry'
  | 'timeout'
  | 'data-handling'
  | 'network';

export interface RuntimePolicy extends PolicyDefinition {
  kind: PolicyKind;
  description?: string;
}

export interface TimeoutRule {
  maxSeconds: number;
  action: 'abort' | 'warn';
}

export interface RetryRule {
  maxAttempts: number;
  backoffMs: number;
  retryOn: string[];
}

export interface ExecutionLimit {
  maxConcurrent: number;
  maxDurationMs: number;
}

export interface PolicySummary {
  total: number;
  byKind: Record<PolicyKind, number>;
  byEffect: Record<'allow' | 'deny', number>;
}

function matchCondition(condition: PolicyCondition, context: Record<string, unknown>): boolean {
  const actual = context[condition.field];
  switch (condition.operator) {
    case 'equals': return actual === condition.value;
    case 'not-equals': return actual !== condition.value;
    case 'in': return Array.isArray(condition.value) && (condition.value as unknown[]).includes(actual);
    case 'not-in': return Array.isArray(condition.value) && !(condition.value as unknown[]).includes(actual);
    case 'contains': return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    case 'matches': return typeof actual === 'string' && typeof condition.value === 'string' && new RegExp(condition.value).test(actual);
    default: return false;
  }
}

const DEFAULT_POLICY: RuntimePolicy = {
  id: 'policy-default-deny',
  name: 'Default Deny',
  version: '1.0.0',
  effect: 'deny',
  kind: 'operation',
  conditions: [],
  priority: 0,
};

export class DefaultPolicyEngine implements PolicyEngine {
  private policies: Map<string, RuntimePolicy> = new Map();

  constructor(policies: RuntimePolicy[] = []) {
    this.policies.set(DEFAULT_POLICY.id, DEFAULT_POLICY);
    for (const policy of policies) this.register(policy);
  }

  register(policy: PolicyDefinition): void {
    this.policies.set(policy.id, { kind: 'operation', ...policy });
  }

  registerPolicy(policy: RuntimePolicy): void {
    this.policies.set(policy.id, policy);
  }

  unregister(policyId: string): void {
    if (policyId !== DEFAULT_POLICY.id) this.policies.delete(policyId);
  }

  list(): PolicyDefinition[] {
    return [...this.policies.values()];
  }

  listPolicies(): RuntimePolicy[] {
    return [...this.policies.values()];
  }

  async evaluate(action: string, context: PermissionContext): Promise<PolicyDecision> {
    const ctx = (context ?? {}) as Record<string, unknown>;
    ctx.action = action;

    const matched = this.listPolicies()
      .filter((p) => p.conditions.every((c) => matchCondition(c, ctx)))
      .sort((a, b) => b.priority - a.priority);

    if (matched.length === 0) {
      return { allowed: false, matchedPolicies: [], reason: 'No policy matched (default deny)' };
    }

    const decision = matched[0]!;
    const allowed = decision.effect === 'allow';
    return {
      allowed,
      matchedPolicies: matched.map((p) => p.id),
      reason: `${decision.id}: ${decision.effect}`,
    };
  }

  // -------------------------------------------------------------------------
  // Policy helpers
  // -------------------------------------------------------------------------

  addAllow(id: string, name: string, action: string): void {
    this.registerPolicy({
      id, name, version: '1.0.0', effect: 'allow', kind: 'operation',
      conditions: [{ field: 'action', operator: 'equals', value: action }],
      priority: 100,
    });
  }

  addDeny(id: string, name: string, action: string): void {
    this.registerPolicy({
      id, name, version: '1.0.0', effect: 'deny', kind: 'operation',
      conditions: [{ field: 'action', operator: 'equals', value: action }],
      priority: 200,
    });
  }

  addTimeoutRule(id: string, name: string, rule: TimeoutRule): void {
    this.registerPolicy({
      id, name, version: '1.0.0', effect: 'deny', kind: 'timeout',
      conditions: [
        { field: 'elapsedMs', operator: 'matches', value: String(rule.maxSeconds * 1000) },
      ],
      priority: 300,
    });
  }

  addExecutionLimit(id: string, name: string, limit: ExecutionLimit): void {
    this.registerPolicy({
      id, name, version: '1.0.0', effect: 'deny', kind: 'execution-limit',
      conditions: [
        { field: 'concurrent', operator: 'matches', value: String(limit.maxConcurrent) },
      ],
      priority: 250,
    });
  }

  addRetryRule(id: string, name: string, rule: RetryRule): void {
    this.registerPolicy({
      id, name, version: '1.0.0', effect: 'allow', kind: 'retry',
      conditions: [
        { field: 'attempts', operator: 'matches', value: String(rule.maxAttempts) },
      ],
      priority: 10,
    });
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  summarize(): PolicySummary {
    const all = this.listPolicies();
    const byKind: Record<PolicyKind, number> = {
      operation: 0, 'execution-limit': 0, retry: 0, timeout: 0, 'data-handling': 0, network: 0,
    };
    const byEffect = { allow: 0, deny: 0 };
    for (const p of all) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      byEffect[p.effect] = (byEffect[p.effect] ?? 0) + 1;
    }
    return { total: all.length, byKind, byEffect };
  }
}

export function createPolicyEngine(): DefaultPolicyEngine {
  return new DefaultPolicyEngine();
}