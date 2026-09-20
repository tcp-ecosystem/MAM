import { V2ModuleNode } from '@mam/ast';
import { SandboxConfig } from './types.js';

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
}

interface AuditEntry {
  id: string;
  timestamp: number;
  executionId: string;
  moduleName: string;
  action: string;
  result: 'success' | 'failure' | 'blocked';
  details?: Record<string, unknown>;
}

interface AuditFilter {
  executionId?: string;
  moduleName?: string;
  action?: string;
  result?: 'success' | 'failure' | 'blocked';
  since?: number;
  until?: number;
  limit?: number;
}

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

interface DependencyInfo {
  name: string;
  version: string;
  knownVulnerabilities?: string[];
  deprecated?: boolean;
}

interface AnomalyResult {
  detected: boolean;
  anomalies: AnomalyDetail[];
  baseline: AnomalyBaseline;
}

interface AnomalyDetail {
  type: 'excessive_failures' | 'unusual_resource_access' | 'rate_spike' | 'privilege_escalation_attempt';
  severity: 'low' | 'medium' | 'high';
  description: string;
  data?: Record<string, unknown>;
}

interface AnomalyBaseline {
  avgFailures: number;
  avgResourceAccess: number;
  avgActionsPerMinute: number;
  sampleSize: number;
}

interface SecurityPolicy {
  id: string;
  version: string;
  name: string;
  maxExecutionTimeMs: number;
  maxMemoryBytes: number;
  allowedNetworkHosts: string[];
  deniedNetworkHosts: string[];
  allowedFilesystemPaths: string[];
  deniedFilesystemPaths: string[];
  requireSandbox: boolean;
  allowedModuleTypes: string[];
  deniedModuleTypes: string[];
  secretDetectionEnabled: boolean;
  rateLimitDefault: number;
  auditRetentionMs: number;
}

interface SecurityReport {
  generatedAt: number;
  totalExecutions: number;
  blockedExecutions: number;
  failedExecutions: number;
  secretsDetected: number;
  anomaliesDetected: number;
  activeRateLimits: number;
  policyViolations: number;
  topActions: Array<{ action: string; count: number }>;
  topModules: Array<{ module: string; count: number }>;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'AWS Access Key', pattern: /(?:^|[^A-Za-z0-9+/=])AKIA[0-9A-Z]{16}(?:[^A-Za-z0-9+/=]|$)/g, severity: 'critical' },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)['":\s]*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, severity: 'critical' },
  { name: 'GitHub Token', pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}/g, severity: 'critical' },
  { name: 'GitHub Fine-grained PAT', pattern: /github_pat_[A-Za-z0-9_]{22,255}/g, severity: 'critical' },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey|api[_-]?secret)['":\s]*['"]?([A-Za-z0-9\-_]{20,60})['"]?/gi, severity: 'high' },
  { name: 'Bearer Token', pattern: /bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, severity: 'high' },
  { name: 'Basic Auth', pattern: /basic\s+[A-Za-z0-9+/]+=*/gi, severity: 'high' },
  { name: 'Private Key', pattern: /-----BEGIN(?:\s+RSA)?(?:\s+PRIVATE)?\s+KEY-----/g, severity: 'critical' },
  { name: 'Password Assignment', pattern: /(?:password|passwd|pwd)['":\s]*['"]([^'"]{8,})['"]/gi, severity: 'high' },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g, severity: 'critical' },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: 'critical' },
  { name: 'Heroku API Key', pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, severity: 'high' },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/g, severity: 'medium' },
  { name: 'Connection String', pattern: /(?:mongodb|mysql|postgres|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/gi, severity: 'critical' },
  { name: 'npm Token', pattern: /npm_[A-Za-z0-9]{36}/g, severity: 'critical' },
];

const DANGEROUS_EXEC_PATTERNS: RegExp[] = [
  /eval\s*\(/g,
  /new\s+Function\s*\(/g,
  /child_process/g,
  /process\s*\.\s*exit/g,
  /require\s*\(\s*['"]child_process['"]\s*\)/g,
  /__proto__/g,
  /constructor\s*\[/g,
  /\bthis\b\s*\.\s*constructor/g,
];

const DANGEROUS_FILESYSTEM_PATTERNS: RegExp[] = [
  /\.\.[\/\\]/g,
  /\/etc\/passwd/g,
  /\/etc\/shadow/g,
  /~\//g,
  /\/proc\//g,
];

const MAX_AUDIT_ENTRIES = 10000;
const DEFAULT_RATE_LIMIT = 100;
const RATE_LIMIT_REFILL_INTERVAL_MS = 1000;
const DEFAULT_AUDIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class SecurityManager {
  private auditLog: AuditEntry[] = [];
  private rateLimitBuckets: Map<string, RateLimitBucket> = new Map();
  private executionHistory: Array<{ moduleId: string; action: string; success: boolean; timestamp: number; resourcesAccessed: string[] }> = [];
  private policies: Map<string, SecurityPolicy> = new Map();
  private secretsDetectedCount = 0;
  private policyViolationsCount = 0;
  private anomalyBaseline: AnomalyBaseline = {
    avgFailures: 0,
    avgResourceAccess: 0,
    avgActionsPerMinute: 0,
    sampleSize: 0,
  };

  validateModule(module: V2ModuleNode): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const content = JSON.stringify(module);

    if (!module.name || module.name.length === 0) {
      issues.push('Module must have a non-empty name');
    }

    if (module.name && module.name.length > 256) {
      issues.push('Module name exceeds maximum length of 256 characters');
    }

    if (module.name && /[<>&"'\/\\]/.test(module.name)) {
      issues.push('Module name contains potentially dangerous characters');
    }

    for (const pattern of DANGEROUS_EXEC_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`Module contains potentially dangerous execution pattern: ${pattern.source}`);
      }
      pattern.lastIndex = 0;
    }

    const secretResults = this.checkSecrets(content);
    if (secretResults.length > 0) {
      issues.push(`Module contains exposed secrets: ${secretResults.map((s) => s.name).join(', ')}`);
    }

    if (module.permissions) {
      const permIssues = this.validatePermissions(module.permissions);
      issues.push(...permIssues);
    }

    if (module.permissions?.exec === 'allowed') {
      if (!module.rules || module.rules.length === 0) {
        issues.push('Module with exec permission should define safety rules');
      }
    }

    if (module.moduleType === 'agent' && (!module.role || !module.goal)) {
      issues.push('Agent module should define role and goal');
    }

    if (module.steps && module.steps.length > 100) {
      issues.push('Module exceeds maximum step count of 100');
    }

    if (module.tools && module.tools.length > 50) {
      issues.push('Module exceeds maximum tool count of 50');
    }

    return { valid: issues.length === 0, issues };
  }

  sanitizeInput(input: unknown): unknown {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      return this.sanitizeString(input);
    }

    if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        return 0;
      }
      return input;
    }

    if (typeof input === 'boolean') {
      return input;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.sanitizeInput(item));
    }

    if (typeof input === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        const cleanKey = this.sanitizeString(key);
        if (cleanKey.length > 0 && cleanKey.length <= 256) {
          sanitized[cleanKey] = this.sanitizeInput(value);
        }
      }
      return sanitized;
    }

    return String(input);
  }

  checkSecrets(content: string): Array<{ name: string; severity: 'critical' | 'high' | 'medium'; position: number }> {
    const findings: Array<{ name: string; severity: 'critical' | 'high' | 'medium'; position: number }> = [];

    for (const secretPattern of SECRET_PATTERNS) {
      const regex = new RegExp(secretPattern.pattern.source, secretPattern.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        findings.push({
          name: secretPattern.name,
          severity: secretPattern.severity,
          position: match.index,
        });
        if (findings.length > 100) break;
      }
      if (findings.length > 100) break;
    }

    this.secretsDetectedCount += findings.length;
    return findings;
  }

  createSandboxConfig(module: V2ModuleNode): SandboxConfig {
    const perms = module.permissions;
    const hasNetwork = perms?.network && perms.network !== 'none';
    const hasFilesystem = perms?.filesystem && perms.filesystem !== 'none';
    const hasExec = perms?.exec === 'allowed';
    const hasPython = perms?.python && perms.python !== 'none';

    const config: SandboxConfig = {
      timeout: 30000,
      memoryLimit: 128 * 1024 * 1024,
      networkAccess: false,
      filesystemAccess: false,
      allowedModules: [],
      env: {},
    };

    if (hasNetwork) {
      if (perms!.network === 'internet') {
        config.networkAccess = true;
      } else {
        config.networkAccess = true;
      }
    }

    if (hasFilesystem) {
      config.filesystemAccess = true;
      if (perms!.filesystem === 'read') {
        config.filesystemAccess = false;
      }
    }

    if (hasExec) {
      config.timeout = Math.min(config.timeout, 60000);
    }

    if (hasPython && perms!.python === 'full') {
      config.memoryLimit = Math.min(config.memoryLimit, 256 * 1024 * 1024);
    }

    if (module.tools && module.tools.length > 0) {
      config.allowedModules = [...module.tools];
    }

    if (module.requires && module.requires.length > 0) {
      config.allowedModules = [...(config.allowedModules || []), ...module.requires];
    }

    return config;
  }

  auditExecution(executionId: string, module: V2ModuleNode, action: string, result: 'success' | 'failure' | 'blocked', details?: Record<string, unknown>): AuditEntry {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      executionId,
      moduleName: module.name,
      action,
      result,
      details,
    };

    this.auditLog.push(entry);
    this.pruneAuditLog();

    this.executionHistory.push({
      moduleId: module.name,
      action,
      success: result === 'success',
      timestamp: entry.timestamp,
      resourcesAccessed: details?.resources as string[] || [],
    });

    if (this.executionHistory.length > 1000) {
      this.executionHistory = this.executionHistory.slice(-500);
    }

    return entry;
  }

  getAuditLog(filter?: AuditFilter): AuditEntry[] {
    let results = [...this.auditLog];

    if (filter) {
      if (filter.executionId) {
        results = results.filter((e) => e.executionId === filter.executionId);
      }
      if (filter.moduleName) {
        results = results.filter((e) => e.moduleName === filter.moduleName);
      }
      if (filter.action) {
        results = results.filter((e) => e.action === filter.action);
      }
      if (filter.result) {
        results = results.filter((e) => e.result === filter.result);
      }
      if (filter.since) {
        results = results.filter((e) => e.timestamp >= filter.since!);
      }
      if (filter.until) {
        results = results.filter((e) => e.timestamp <= filter.until!);
      }
      if (filter.limit) {
        results = results.slice(-filter.limit);
      }
    }

    return results;
  }

  validateDependencies(module: V2ModuleNode, registry: Map<string, DependencyInfo>): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const deps = module.requires || [];

    for (const dep of deps) {
      const info = registry.get(dep);
      if (!info) {
        issues.push(`Dependency '${dep}' not found in registry`);
        continue;
      }

      if (info.knownVulnerabilities && info.knownVulnerabilities.length > 0) {
        issues.push(`Dependency '${dep}' has known vulnerabilities: ${info.knownVulnerabilities.join(', ')}`);
      }

      if (info.deprecated) {
        issues.push(`Dependency '${dep}' is deprecated`);
      }

      if (!info.version || info.version.length === 0) {
        issues.push(`Dependency '${dep}' has no version specified`);
      }

      if (info.version && !/^[0-9]+\.[0-9]+\.[0-9]+/.test(info.version)) {
        issues.push(`Dependency '${dep}' has invalid version format: ${info.version}`);
      }
    }

    const allDeps = new Set<string>();
    const hasCycle = this.detectDependencyCycle(module.name, deps, registry, allDeps);
    if (hasCycle) {
      issues.push('Dependency cycle detected');
    }

    return { valid: issues.length === 0, issues };
  }

  checkResourceAccess(module: V2ModuleNode, resource: string, action: string): { allowed: boolean; reason?: string } {
    const perms = module.permissions;
    const resourceType = resource.split(':')[0];
    const resourceAction = action;

    if (!perms) {
      if (this.isHighRiskResource(resourceType)) {
        return { allowed: false, reason: 'Module has no permissions defined for high-risk resource' };
      }
      return { allowed: true };
    }

    switch (resourceType) {
      case 'filesystem': {
        if (!perms.filesystem || perms.filesystem === 'none') {
          return { allowed: false, reason: 'Filesystem access not permitted' };
        }
        if (resourceAction === 'write' && perms.filesystem !== 'write') {
          return { allowed: false, reason: 'Write access not permitted for filesystem' };
        }
        if (this.isDangerousPath(resource)) {
          return { allowed: false, reason: 'Access to dangerous filesystem path denied' };
        }
        return { allowed: true };
      }
      case 'network': {
        if (!perms.network || perms.network === 'none') {
          return { allowed: false, reason: 'Network access not permitted' };
        }
        if (perms.network === 'internal' && this.isExternalHost(resource)) {
          return { allowed: false, reason: 'External network access not permitted' };
        }
        return { allowed: true };
      }
      case 'exec': {
        if (perms.exec !== 'allowed') {
          return { allowed: false, reason: 'Execution not permitted' };
        }
        return { allowed: true };
      }
      case 'memory': {
        if (!perms.memory || perms.memory === 'none') {
          return { allowed: false, reason: 'Memory access not permitted' };
        }
        if (resourceAction === 'shared' && perms.memory !== 'shared') {
          return { allowed: false, reason: 'Shared memory access not permitted' };
        }
        return { allowed: true };
      }
      case 'python': {
        if (!perms.python || perms.python === 'none') {
          return { allowed: false, reason: 'Python access not permitted' };
        }
        if (resourceAction === 'full' && perms.python !== 'full') {
          return { allowed: false, reason: 'Full Python access not permitted' };
        }
        return { allowed: true };
      }
      default: {
        if (perms.custom && perms.custom[resourceType]) {
          const customPerm = perms.custom[resourceType];
          if (customPerm === 'none' || customPerm === 'denied') {
            return { allowed: false, reason: `Custom resource '${resourceType}' not permitted` };
          }
          return { allowed: true };
        }
        if (this.isHighRiskResource(resourceType)) {
          return { allowed: false, reason: `No permission defined for high-risk resource '${resourceType}'` };
        }
        return { allowed: true };
      }
    }
  }

  enforceRateLimit(moduleId: string, action: string, limit: number = DEFAULT_RATE_LIMIT): { allowed: boolean; retryAfterMs?: number } {
    const key = `${moduleId}:${action}`;
    let bucket = this.rateLimitBuckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: limit,
        lastRefill: Date.now(),
        maxTokens: limit,
        refillRate: limit / RATE_LIMIT_REFILL_INTERVAL_MS,
      };
      this.rateLimitBuckets.set(key, bucket);
    }

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const refillTokens = elapsed * bucket.refillRate;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + refillTokens);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - bucket.tokens) / bucket.refillRate);
      return { allowed: false, retryAfterMs };
    }

    bucket.tokens -= 1;
    return { allowed: true };
  }

  detectAnomalies(history: Array<{ moduleId: string; action: string; success: boolean; timestamp: number; resourcesAccessed: string[] }>): AnomalyResult {
    const anomalies: AnomalyDetail[] = [];

    if (history.length < 10) {
      return { detected: false, anomalies, baseline: this.anomalyBaseline };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentActions = history.filter((h) => h.timestamp >= oneMinuteAgo);

    const actionsPerMinute = recentActions.length;
    if (this.anomalyBaseline.sampleSize > 0) {
      if (actionsPerMinute > this.anomalyBaseline.avgActionsPerMinute * 3) {
        anomalies.push({
          type: 'rate_spike',
          severity: 'medium',
          description: `Action rate ${actionsPerMinute}/min exceeds baseline ${Math.round(this.anomalyBaseline.avgActionsPerMinute)}/min by 3x`,
          data: { currentRate: actionsPerMinute, baselineRate: this.anomalyBaseline.avgActionsPerMinute },
        });
      }
    }

    const moduleFailures = new Map<string, number>();
    const moduleAttempts = new Map<string, number>();
    for (const entry of history) {
      const attempts = moduleAttempts.get(entry.moduleId) || 0;
      moduleAttempts.set(entry.moduleId, attempts + 1);
      if (!entry.success) {
        const failures = moduleFailures.get(entry.moduleId) || 0;
        moduleFailures.set(entry.moduleId, failures + 1);
      }
    }

    for (const [moduleId, failures] of moduleFailures) {
      const attempts = moduleAttempts.get(moduleId) || 1;
      const failureRate = failures / attempts;
      if (failureRate > 0.8 && attempts >= 5) {
        anomalies.push({
          type: 'excessive_failures',
          severity: 'high',
          description: `Module '${moduleId}' has ${failures} failures out of ${attempts} attempts (${Math.round(failureRate * 100)}%)`,
          data: { moduleId, failures, attempts, failureRate },
        });
      }
    }

    const resourceAccessCount = new Map<string, number>();
    for (const entry of history) {
      for (const resource of entry.resourcesAccessed) {
        const count = resourceAccessCount.get(resource) || 0;
        resourceAccessCount.set(resource, count + 1);
      }
    }

    for (const [resource, count] of resourceAccessCount) {
      if (count > 50) {
        anomalies.push({
          type: 'unusual_resource_access',
          severity: 'medium',
          description: `Resource '${resource}' accessed ${count} times in session`,
          data: { resource, count },
        });
      }
    }

    const uniqueModules = new Set(history.map((h) => h.moduleId));
    const uniqueResources = new Set(history.flatMap((h) => h.resourcesAccessed));
    const moduleWithEscalation = history.find((h) => {
      const moduleHistory = history.filter((m) => m.moduleId === h.moduleId);
      const resources = new Set(moduleHistory.flatMap((m) => m.resourcesAccessed));
      return resources.size > 5;
    });

    if (moduleWithEscalation) {
      anomalies.push({
        type: 'privilege_escalation_attempt',
        severity: 'high',
        description: `Module '${moduleWithEscalation.moduleId}' accessing unusually many resource types`,
        data: { moduleId: moduleWithEscalation.moduleId },
      });
    }

    this.updateBaseline(history);

    return {
      detected: anomalies.length > 0,
      anomalies,
      baseline: { ...this.anomalyBaseline },
    };
  }

  createSecurityPolicy(config: Partial<SecurityPolicy>): SecurityPolicy {
    const policy: SecurityPolicy = {
      id: config.id || this.generateId(),
      version: config.version || '1.0.0',
      name: config.name || 'default-policy',
      maxExecutionTimeMs: config.maxExecutionTimeMs ?? 60000,
      maxMemoryBytes: config.maxMemoryBytes ?? 256 * 1024 * 1024,
      allowedNetworkHosts: config.allowedNetworkHosts ?? [],
      deniedNetworkHosts: config.deniedNetworkHosts ?? [],
      allowedFilesystemPaths: config.allowedFilesystemPaths ?? [],
      deniedFilesystemPaths: config.deniedFilesystemPaths ?? ['/etc', '/proc', '/sys', '/dev'],
      requireSandbox: config.requireSandbox ?? false,
      allowedModuleTypes: config.allowedModuleTypes ?? ['module', 'agent', 'tool', 'memory', 'workflow', 'policy'],
      deniedModuleTypes: config.deniedModuleTypes ?? [],
      secretDetectionEnabled: config.secretDetectionEnabled ?? true,
      rateLimitDefault: config.rateLimitDefault ?? DEFAULT_RATE_LIMIT,
      auditRetentionMs: config.auditRetentionMs ?? DEFAULT_AUDIT_RETENTION_MS,
    };

    this.policies.set(policy.id, policy);
    return policy;
  }

  validateSecurityPolicy(policy: SecurityPolicy): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!policy.id || policy.id.length === 0) {
      issues.push('Policy must have an ID');
    }

    if (!policy.name || policy.name.length === 0) {
      issues.push('Policy must have a name');
    }

    if (policy.maxExecutionTimeMs <= 0) {
      issues.push('maxExecutionTimeMs must be positive');
    }

    if (policy.maxExecutionTimeMs > 300000) {
      issues.push('maxExecutionTimeMs exceeds maximum allowed value of 300000ms');
    }

    if (policy.maxMemoryBytes <= 0) {
      issues.push('maxMemoryBytes must be positive');
    }

    if (policy.maxMemoryBytes > 1024 * 1024 * 1024) {
      issues.push('maxMemoryBytes exceeds maximum allowed value of 1GB');
    }

    const overlap = policy.allowedNetworkHosts.filter((h) => policy.deniedNetworkHosts.includes(h));
    if (overlap.length > 0) {
      issues.push(`Hosts appear in both allowed and denied lists: ${overlap.join(', ')}`);
    }

    const fsOverlap = policy.allowedFilesystemPaths.filter((p) => policy.deniedFilesystemPaths.some((d) => p.startsWith(d) || d.startsWith(p)));
    if (fsOverlap.length > 0) {
      issues.push(`Filesystem paths have conflicting allow/deny rules: ${fsOverlap.join(', ')}`);
    }

    if (policy.allowedModuleTypes.length > 0 && policy.deniedModuleTypes.length > 0) {
      const typeOverlap = policy.allowedModuleTypes.filter((t) => policy.deniedModuleTypes.includes(t));
      if (typeOverlap.length > 0) {
        issues.push(`Module types appear in both allowed and denied lists: ${typeOverlap.join(', ')}`);
      }
    }

    if (policy.rateLimitDefault <= 0) {
      issues.push('rateLimitDefault must be positive');
    }

    if (policy.auditRetentionMs < 60000) {
      issues.push('auditRetentionMs must be at least 60 seconds');
    }

    if (policy.deniedFilesystemPaths.some((p) => p.includes('..'))) {
      issues.push('deniedFilesystemPaths must not contain path traversal sequences');
    }

    return { valid: issues.length === 0, issues };
  }

  getSecurityReport(): SecurityReport {
    const totalExecutions = this.auditLog.length;
    const blockedExecutions = this.auditLog.filter((e) => e.result === 'blocked').length;
    const failedExecutions = this.auditLog.filter((e) => e.result === 'failure').length;
    const policyViolations = this.policyViolationsCount;

    const actionCounts = new Map<string, number>();
    const moduleCounts = new Map<string, number>();

    for (const entry of this.auditLog) {
      actionCounts.set(entry.action, (actionCounts.get(entry.action) || 0) + 1);
      moduleCounts.set(entry.moduleName, (moduleCounts.get(entry.moduleName) || 0) + 1);
    }

    const topActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topModules = Array.from(moduleCounts.entries())
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      generatedAt: Date.now(),
      totalExecutions,
      blockedExecutions,
      failedExecutions,
      secretsDetected: this.secretsDetectedCount,
      anomaliesDetected: this.executionHistory.length > 0 ? this.detectAnomalies(this.executionHistory).anomalies.length : 0,
      activeRateLimits: this.rateLimitBuckets.size,
      policyViolations,
      topActions,
      topModules,
    };
  }

  private sanitizeString(input: string): string {
    let result = input;
    result = result.replace(/[<>'"]/g, '');
    result = result.replace(/\x00/g, '');
    result = result.replace(/javascript:/gi, '');
    result = result.replace(/data:/gi, '');
    result = result.replace(/vbscript:/gi, '');
    result = result.replace(/on\w+\s*=/gi, '');
    result = result.trim();
    if (result.length > 10000) {
      result = result.substring(0, 10000);
    }
    return result;
  }

  private validatePermissions(perms: { filesystem?: string; network?: string; exec?: string; memory?: string; python?: string; custom?: Record<string, string> }): string[] {
    const issues: string[] = [];

    if (perms.exec === 'allowed' && (!perms.filesystem || perms.filesystem === 'none')) {
      issues.push('Exec permission requires at least read filesystem access');
    }

    if (perms.network === 'internet' && (!perms.filesystem || perms.filesystem === 'none')) {
      issues.push('Internet network access typically requires filesystem access for caching');
    }

    if (perms.custom) {
      for (const [key, value] of Object.entries(perms.custom)) {
        if (key.length === 0) {
          issues.push('Custom permission key must not be empty');
        }
        if (!['allowed', 'denied', 'none', 'read', 'write', 'full', 'sandbox'].includes(value)) {
          issues.push(`Custom permission '${key}' has unknown value '${value}'`);
        }
      }
    }

    return issues;
  }

  private isHighRiskResource(resourceType: string): boolean {
    return ['exec', 'filesystem', 'network', 'python'].includes(resourceType);
  }

  private isDangerousPath(resource: string): boolean {
    for (const pattern of DANGEROUS_FILESYSTEM_PATTERNS) {
      if (pattern.test(resource)) {
        return true;
      }
      pattern.lastIndex = 0;
    }
    return false;
  }

  private isExternalHost(resource: string): boolean {
    const host = resource.replace(/^(?:https?:\/\/|tcp:\/\/|udp:\/\/)/, '').split('/')[0].split(':')[0];
    const internalPatterns = [/^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./, /^0\./, /^::1$/, /^\[::1\]$/, /^::ffff:127\./];
    return !internalPatterns.some((p) => p.test(host));
  }

  private generateId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 24; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private pruneAuditLog(): void {
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) {
      this.auditLog = this.auditLog.slice(-Math.floor(MAX_AUDIT_ENTRIES / 2));
    }
    const cutoff = Date.now() - DEFAULT_AUDIT_RETENTION_MS;
    this.auditLog = this.auditLog.filter((e) => e.timestamp >= cutoff);
  }

  private detectDependencyCycle(
    moduleName: string,
    deps: string[],
    registry: Map<string, DependencyInfo>,
    visited: Set<string>
  ): boolean {
    if (visited.has(moduleName)) {
      return true;
    }
    visited.add(moduleName);
    for (const dep of deps) {
      const depInfo = registry.get(dep);
      if (depInfo) {
        const depDeps: string[] = [];
        const depModule = registry.get(dep);
        if (depModule) {
          const cycleFound = this.detectDependencyCycle(dep, depDeps, registry, visited);
          if (cycleFound) return true;
        }
      }
    }
    visited.delete(moduleName);
    return false;
  }

  private updateBaseline(history: Array<{ moduleId: string; action: string; success: boolean; timestamp: number; resourcesAccessed: string[] }>): void {
    const totalFailures = history.filter((h) => !h.success).length;
    const totalResources = history.reduce((sum, h) => sum + h.resourcesAccessed.length, 0);
    const timeSpan = history.length > 1 ? (history[history.length - 1].timestamp - history[0].timestamp) / 60000 : 1;
    const actionsPerMinute = history.length / Math.max(timeSpan, 0.01);

    const n = this.anomalyBaseline.sampleSize;
    this.anomalyBaseline = {
      avgFailures: (this.anomalyBaseline.avgFailures * n + totalFailures) / (n + 1),
      avgResourceAccess: (this.anomalyBaseline.avgResourceAccess * n + totalResources / history.length) / (n + 1),
      avgActionsPerMinute: (this.anomalyBaseline.avgActionsPerMinute * n + actionsPerMinute) / (n + 1),
      sampleSize: n + 1,
    };
  }
}
