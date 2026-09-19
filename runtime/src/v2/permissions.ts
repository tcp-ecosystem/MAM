import { PermissionChecker, PermissionContext, PermissionResult } from './types.js';
import { V2PermissionSet } from '@mam/ast';

interface AuditEntry {
  timestamp: number;
  action: string;
  allowed: boolean;
  reason?: string;
  policy?: string;
  context?: PermissionContext;
}

interface RateLimitConfig {
  maxPerSecond: number;
  burst: number;
  tokens: number;
  lastRefill: number;
}

interface PermissionGroup {
  parent: string;
  children: string[];
}

export class DefaultPermissionChecker implements PermissionChecker {
  private allowed: string[];
  private denied: string[];
  private customPermissions: Map<string, string> = new Map();
  private auditLog: AuditEntry[] = [];
  private rateLimits: Map<string, RateLimitConfig> = new Map();
  private permissionGroups: Map<string, PermissionGroup> = new Map();
  private inheritanceChains: Map<string, string[]> = new Map();

  constructor(permissions?: V2PermissionSet) {
    this.allowed = [];
    this.denied = [];

    if (permissions) {
      if (permissions.filesystem && permissions.filesystem !== 'none') {
        this.allowed.push(`filesystem:${permissions.filesystem}`);
        this.allowed.push('filesystem:read');
      } else if (permissions.filesystem === 'none') {
        this.denied.push('filesystem:*');
      }

      if (permissions.network && permissions.network !== 'none') {
        this.allowed.push(`network:${permissions.network}`);
        this.allowed.push('network:outbound');
      } else if (permissions.network === 'none') {
        this.denied.push('network:*');
      }

      if (permissions.python && permissions.python !== 'none') {
        this.allowed.push(`python:${permissions.python}`);
      } else if (permissions.python === 'none') {
        this.denied.push('python:*');
      }

      if (permissions.exec === 'allowed') {
        this.allowed.push('exec:allowed');
        this.allowed.push('exec:spawn');
      } else if (permissions.exec === 'denied') {
        this.denied.push('exec:*');
      }

      if (permissions.memory && permissions.memory !== 'none') {
        this.allowed.push(`memory:${permissions.memory}`);
        this.allowed.push('memory:read');
      } else if (permissions.memory === 'none') {
        this.denied.push('memory:*');
      }

      if (permissions.custom) {
        for (const [key, value] of Object.entries(permissions.custom)) {
          if (value === 'none' || value === 'denied') {
            this.denied.push(`${key}:*`);
          } else {
            this.allowed.push(`${key}:${value}`);
            this.customPermissions.set(key, value);
          }
        }
      }
    }
  }

  check(action: string, context?: PermissionContext): PermissionResult {
    if (this.checkRateLimit(action) === false) {
      return { allowed: false, reason: `Rate limit exceeded for action: ${action}`, policy: 'rate-limit' };
    }

    for (const pattern of this.denied) {
      if (this.matchesPattern(action, pattern)) {
        const result: PermissionResult = { allowed: false, reason: `Denied by pattern: ${pattern}`, policy: pattern };
        this.recordAudit(action, result, context);
        return result;
      }
    }

    for (const pattern of this.allowed) {
      if (this.matchesPattern(action, pattern)) {
        const result: PermissionResult = { allowed: true, policy: pattern };
        this.recordAudit(action, result, context);
        return result;
      }
    }

    if (context?.module) {
      const modulePattern = `${context.module}:${action}`;
      for (const pattern of this.denied) {
        if (this.matchesPattern(modulePattern, pattern)) {
          const result: PermissionResult = { allowed: false, reason: `Denied for module ${context.module}`, policy: pattern };
          this.recordAudit(action, result, context);
          return result;
        }
      }
      for (const pattern of this.allowed) {
        if (this.matchesPattern(modulePattern, pattern)) {
          const result: PermissionResult = { allowed: true, policy: pattern };
          this.recordAudit(action, result, context);
          return result;
        }
      }
    }

    const implied = this.checkImpliedPermissions(action);
    if (implied) {
      const result: PermissionResult = { allowed: implied.allowed, reason: implied.reason, policy: implied.policy };
      this.recordAudit(action, result, context);
      return result;
    }

    const inherited = this.checkInheritanceChain(action, context);
    if (inherited) {
      this.recordAudit(action, inherited, context);
      return inherited;
    }

    if (this.denied.length === 0 && this.allowed.length === 0) {
      const result: PermissionResult = { allowed: true, policy: 'default-allow' };
      this.recordAudit(action, result, context);
      return result;
    }

    const result: PermissionResult = { allowed: false, reason: `No matching allow rule for action: ${action}` };
    this.recordAudit(action, result, context);
    return result;
  }

  checkBatch(actions: string[], context?: PermissionContext): Map<string, PermissionResult> {
    const results = new Map<string, PermissionResult>();
    for (const action of actions) {
      results.set(action, this.check(action, context));
    }
    return results;
  }

  getAllowed(): string[] {
    return [...this.allowed];
  }

  getDenied(): string[] {
    return [...this.denied];
  }

  addAllowed(pattern: string): void {
    this.allowed.push(pattern);
  }

  addDenied(pattern: string): void {
    this.denied.push(pattern);
  }

  removeAllowed(pattern: string): void {
    const idx = this.allowed.indexOf(pattern);
    if (idx >= 0) this.allowed.splice(idx, 1);
  }

  removeDenied(pattern: string): void {
    const idx = this.denied.indexOf(pattern);
    if (idx >= 0) this.denied.splice(idx, 1);
  }

  clear(): void {
    this.allowed = [];
    this.denied = [];
    this.customPermissions.clear();
  }

  setRateLimit(pattern: string, maxPerSecond: number): void {
    this.rateLimits.set(pattern, {
      maxPerSecond,
      burst: maxPerSecond * 2,
      tokens: maxPerSecond * 2,
      lastRefill: Date.now(),
    });
  }

  checkRateLimit(action: string): boolean {
    for (const [pattern, config] of this.rateLimits) {
      if (this.matchesPattern(action, pattern)) {
        const now = Date.now();
        const elapsed = (now - config.lastRefill) / 1000;
        const refill = elapsed * config.maxPerSecond;
        config.tokens = Math.min(config.burst, config.tokens + refill);
        config.lastRefill = now;

        if (config.tokens < 1) {
          return false;
        }
        config.tokens -= 1;
        return true;
      }
    }
    return true;
  }

  getRateLimitConfig(pattern: string): RateLimitConfig | undefined {
    const config = this.rateLimits.get(pattern);
    if (!config) return undefined;
    return { ...config };
  }

  removeRateLimit(pattern: string): void {
    this.rateLimits.delete(pattern);
  }

  getRateLimitPatterns(): string[] {
    return [...this.rateLimits.keys()];
  }

  addPermissionGroup(parent: string, children: string[]): void {
    this.permissionGroups.set(parent, { parent, children });
    for (const child of children) {
      this.inheritanceChains.set(child, [parent, ...children.filter((c) => c !== child)]);
    }
  }

  removePermissionGroup(parent: string): void {
    const group = this.permissionGroups.get(parent);
    if (!group) return;
    for (const child of group.children) {
      this.inheritanceChains.delete(child);
    }
    this.permissionGroups.delete(parent);
  }

  getPermissionGroup(parent: string): PermissionGroup | undefined {
    const group = this.permissionGroups.get(parent);
    if (!group) return undefined;
    return { parent: group.parent, children: [...group.children] };
  }

  getAllPermissionGroups(): Map<string, PermissionGroup> {
    const copy = new Map<string, PermissionGroup>();
    for (const [key, value] of this.permissionGroups) {
      copy.set(key, { parent: value.parent, children: [...value.children] });
    }
    return copy;
  }

  addInheritanceChain(child: string, chain: string[]): void {
    this.inheritanceChains.set(child, [...chain]);
  }

  removeInheritanceChain(child: string): void {
    this.inheritanceChains.delete(child);
  }

  getInheritanceChain(child: string): string[] | undefined {
    const chain = this.inheritanceChains.get(child);
    if (!chain) return undefined;
    return [...chain];
  }

  getAllInheritanceChains(): Map<string, string[]> {
    const copy = new Map<string, string[]>();
    for (const [key, value] of this.inheritanceChains) {
      copy.set(key, [...value]);
    }
    return copy;
  }

  getAuditLog(): AuditEntry[] {
    return this.auditLog.map((entry) => ({
      timestamp: entry.timestamp,
      action: entry.action,
      allowed: entry.allowed,
      reason: entry.reason,
      policy: entry.policy,
      context: entry.context ? { ...entry.context } : undefined,
    }));
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }

  getAuditLogSince(timestamp: number): AuditEntry[] {
    return this.auditLog
      .filter((entry) => entry.timestamp >= timestamp)
      .map((entry) => ({
        timestamp: entry.timestamp,
        action: entry.action,
        allowed: entry.allowed,
        reason: entry.reason,
        policy: entry.policy,
        context: entry.context ? { ...entry.context } : undefined,
      }));
  }

  getAuditLogForAction(action: string): AuditEntry[] {
    return this.auditLog
      .filter((entry) => entry.action === action)
      .map((entry) => ({
        timestamp: entry.timestamp,
        action: entry.action,
        allowed: entry.allowed,
        reason: entry.reason,
        policy: entry.policy,
        context: entry.context ? { ...entry.context } : undefined,
      }));
  }

  inspect(): {
    allowed: string[];
    denied: string[];
    rateLimits: Map<string, RateLimitConfig>;
    permissionGroups: Map<string, PermissionGroup>;
    inheritanceChains: Map<string, string[]>;
    auditLogSize: number;
  } {
    return {
      allowed: [...this.allowed],
      denied: [...this.denied],
      rateLimits: new Map(this.rateLimits),
      permissionGroups: new Map(this.permissionGroups),
      inheritanceChains: new Map(this.inheritanceChains),
      auditLogSize: this.auditLog.length,
    };
  }

  export(): {
    allowed: string[];
    denied: string[];
    customPermissions: Record<string, string>;
    rateLimits: Array<{ pattern: string; config: RateLimitConfig }>;
    permissionGroups: Array<{ parent: string; children: string[] }>;
    inheritanceChains: Array<{ child: string; chain: string[] }>;
  } {
    const customPermissionsObj: Record<string, string> = {};
    for (const [key, value] of this.customPermissions) {
      customPermissionsObj[key] = value;
    }

    const rateLimitsArr: Array<{ pattern: string; config: RateLimitConfig }> = [];
    for (const [pattern, config] of this.rateLimits) {
      rateLimitsArr.push({ pattern, config: { ...config } });
    }

    const permissionGroupsArr: Array<{ parent: string; children: string[] }> = [];
    for (const [parent, group] of this.permissionGroups) {
      permissionGroupsArr.push({ parent, children: [...group.children] });
    }

    const inheritanceChainsArr: Array<{ child: string; chain: string[] }> = [];
    for (const [child, chain] of this.inheritanceChains) {
      inheritanceChainsArr.push({ child, chain: [...chain] });
    }

    return {
      allowed: [...this.allowed],
      denied: [...this.denied],
      customPermissions: customPermissionsObj,
      rateLimits: rateLimitsArr,
      permissionGroups: permissionGroupsArr,
      inheritanceChains: inheritanceChainsArr,
    };
  }

  import(data: {
    allowed?: string[];
    denied?: string[];
    customPermissions?: Record<string, string>;
    rateLimits?: Array<{ pattern: string; config: RateLimitConfig }>;
    permissionGroups?: Array<{ parent: string; children: string[] }>;
    inheritanceChains?: Array<{ child: string; chain: string[] }>;
  }): void {
    if (data.allowed) {
      this.allowed = [...data.allowed];
    }
    if (data.denied) {
      this.denied = [...data.denied];
    }
    if (data.customPermissions) {
      this.customPermissions.clear();
      for (const [key, value] of Object.entries(data.customPermissions)) {
        this.customPermissions.set(key, value);
      }
    }
    if (data.rateLimits) {
      this.rateLimits.clear();
      for (const { pattern, config } of data.rateLimits) {
        this.rateLimits.set(pattern, { ...config });
      }
    }
    if (data.permissionGroups) {
      this.permissionGroups.clear();
      this.inheritanceChains.clear();
      for (const { parent, children } of data.permissionGroups) {
        this.permissionGroups.set(parent, { parent, children: [...children] });
        for (const child of children) {
          this.inheritanceChains.set(child, [parent, ...children.filter((c) => c !== child)]);
        }
      }
    }
    if (data.inheritanceChains) {
      for (const { child, chain } of data.inheritanceChains) {
        this.inheritanceChains.set(child, [...chain]);
      }
    }
  }

  toString(): string {
    const data = this.export();
    return JSON.stringify(data, null, 2);
  }

  private recordAudit(action: string, result: PermissionResult, context?: PermissionContext): void {
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      allowed: result.allowed,
      reason: result.reason,
      policy: result.policy,
      context: context ? { ...context } : undefined,
    });
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }

  private checkImpliedPermissions(action: string): PermissionResult | null {
    const parts = action.split(':');
    if (parts.length < 2) return null;

    const namespace = parts[0];
    const wildcardPattern = `${namespace}:*`;

    for (const pattern of this.denied) {
      if (this.matchesPattern(wildcardPattern, pattern)) {
        return { allowed: false, reason: `Denied by wildcard: ${pattern}`, policy: pattern };
      }
    }

    for (const pattern of this.allowed) {
      if (this.matchesPattern(wildcardPattern, pattern)) {
        return { allowed: true, policy: pattern };
      }
    }

    return null;
  }

  private checkInheritanceChain(action: string, context?: PermissionContext): PermissionResult | null {
    for (const [child, chain] of this.inheritanceChains) {
      if (this.matchesPattern(action, child)) {
        for (const ancestor of chain) {
          const ancestorResult = this.checkSingle(ancestor, context);
          if (ancestorResult) {
            return ancestorResult;
          }
        }
      }
    }
    return null;
  }

  private checkSingle(action: string, context?: PermissionContext): PermissionResult | null {
    for (const pattern of this.denied) {
      if (this.matchesPattern(action, pattern)) {
        return { allowed: false, reason: `Denied by pattern: ${pattern}`, policy: pattern };
      }
    }

    for (const pattern of this.allowed) {
      if (this.matchesPattern(action, pattern)) {
        return { allowed: true, policy: pattern };
      }
    }

    return null;
  }

  private matchesPattern(action: string, pattern: string): boolean {
    if (pattern === '*') return true;

    const regexParts: string[] = [];
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*') {
        if (i + 1 < pattern.length && pattern[i + 1] === '*') {
          regexParts.push('.*');
          i += 2;
          if (i < pattern.length && pattern[i] === '/') {
            regexParts.push('/');
            i += 1;
          }
        } else {
          if (i + 1 < pattern.length && pattern[i + 1] === '/') {
            regexParts.push('[^/]*');
            i += 2;
            if (i < pattern.length && pattern[i] === '/') {
              regexParts.push('/');
              i += 1;
            }
          } else {
            regexParts.push('[^/]*');
            i += 1;
          }
        }
      } else if (ch === '?') {
        regexParts.push('[^/]');
        i += 1;
      } else if (ch === '[') {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== ']') j++;
        if (j < pattern.length) {
          regexParts.push(pattern.slice(i, j + 1));
          i = j + 1;
        } else {
          regexParts.push('\\[');
          i += 1;
        }
      } else if (ch === '{') {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== '}') j++;
        if (j < pattern.length) {
          const alternatives = pattern.slice(i + 1, j);
          regexParts.push(`(?:${alternatives.split(',').map((a) => escapeRegex(a.trim())).join('|')})`);
          i = j + 1;
        } else {
          regexParts.push('\\{');
          i += 1;
        }
      } else {
        regexParts.push(escapeRegex(ch));
        i += 1;
      }
    }

    const regex = new RegExp(`^${regexParts.join('')}$`);
    return regex.test(action);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
