import { V2ModuleNode } from '@mam/ast';

export interface Capability {
  name: string;
  description?: string;
  module: string;
  inputs?: Array<{ name: string; type: string; required: boolean }>;
  outputs?: Array<{ name: string; type: string }>;
  permissions?: string[];
}

interface CapabilityCacheEntry {
  result: Record<string, unknown>;
  timestamp: number;
  ttlMs: number;
}

interface ChainStep {
  capabilityName: string;
  moduleName: string;
  inputMapping: Record<string, string> | null;
}

interface CapabilityStats {
  invocationCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastInvokedAt: number | null;
  errorCount: number;
}

interface CapabilityVersion {
  version: string;
  capability: Capability;
  deprecated: boolean;
  compatMap: string[];
}

interface PermissionRequirement {
  capabilityKey: string;
  permissions: string[];
}

interface CapabilityExportEntry {
  key: string;
  capability: Capability;
  permissions: string[];
  version: string;
  deprecated: boolean;
}

interface CapabilityExportData {
  version: string;
  exportedAt: number;
  entries: CapabilityExportEntry[];
}

export class CapabilityEngine {
  private capabilities: Map<string, Capability> = new Map();
  private handlers: Map<string, (inputs: Record<string, unknown>, context: unknown) => Promise<Record<string, unknown>>> = new Map();
  private cacheStore: Map<string, CapabilityCacheEntry> = new Map();
  private cacheTTLs: Map<string, number> = new Map();
  private stats: Map<string, CapabilityStats> = new Map();
  private versions: Map<string, CapabilityVersion[]> = new Map();
  private permissionRequirements: PermissionRequirement[] = [];
  private composites: Map<string, string[]> = new Map();
  private chainDefinitions: Map<string, ChainStep[]> = new Map();

  register(module: V2ModuleNode): void {
    const caps = module.capabilities ?? [];
    for (const capName of caps) {
      const cap: Capability = {
        name: capName,
        module: module.name,
      };
      this.capabilities.set(`${module.name}:${capName}`, cap);
    }
  }

  registerHandler(moduleName: string, capabilityName: string, handler: (inputs: Record<string, unknown>, context: unknown) => Promise<Record<string, unknown>>): void {
    this.handlers.set(`${moduleName}:${capabilityName}`, handler);
  }

  resolve(capabilityName: string): Capability | undefined {
    for (const [key, cap] of this.capabilities) {
      if (key.endsWith(`:${capabilityName}`)) {
        return cap;
      }
    }
    return undefined;
  }

  async invoke(moduleName: string, capabilityName: string, inputs: Record<string, unknown>, context: unknown): Promise<Record<string, unknown>> {
    const key = `${moduleName}:${capabilityName}`;
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new Error(`Capability not found: ${key}`);
    }

    if (this.cacheTTLs.has(key)) {
      const cached = this.cacheStore.get(key);
      if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
        this.recordStats(key, 0, false);
        return cached.result;
      }
    }

    const start = performance.now();
    let result: Record<string, unknown>;
    let hadError = false;
    try {
      result = await handler(inputs, context);
    } catch (err) {
      hadError = true;
      throw err;
    } finally {
      const duration = performance.now() - start;
      this.recordStats(key, duration, hadError);
    }

    if (this.cacheTTLs.has(key)) {
      this.cacheStore.set(key, {
        result: result!,
        timestamp: Date.now(),
        ttlMs: this.cacheTTLs.get(key)!,
      });
    }

    return result!;
  }

  list(moduleName?: string): Capability[] {
    if (moduleName) {
      return Array.from(this.capabilities.values()).filter(c => c.module === moduleName);
    }
    return Array.from(this.capabilities.values());
  }

  has(moduleName: string, capabilityName: string): boolean {
    return this.capabilities.has(`${moduleName}:${capabilityName}`);
  }

  discover(modules: V2ModuleNode[]): void {
    for (const mod of modules) {
      this.register(mod);
      const inputs = mod.inputs ?? [];
      const outputs = mod.outputs ?? [];
      for (const capName of mod.capabilities ?? []) {
        const key = `${mod.name}:${capName}`;
        const existing = this.capabilities.get(key);
        if (existing) {
          if (inputs.length > 0) {
            existing.inputs = inputs.map(p => ({ name: p.name, type: p.type, required: p.required }));
          }
          if (outputs.length > 0) {
            existing.outputs = outputs.map(p => ({ name: p.name, type: p.type }));
          }
          if (mod.permissions) {
            const extractedPerms: string[] = [];
            if (mod.permissions.filesystem) extractedPerms.push(`filesystem:${mod.permissions.filesystem}`);
            if (mod.permissions.network) extractedPerms.push(`network:${mod.permissions.network}`);
            if (mod.permissions.python) extractedPerms.push(`python:${mod.permissions.python}`);
            if (mod.permissions.memory) extractedPerms.push(`memory:${mod.permissions.memory}`);
            if (mod.permissions.exec) extractedPerms.push(`exec:${mod.permissions.exec}`);
            if (mod.permissions.custom) {
              for (const [k, v] of Object.entries(mod.permissions.custom)) {
                extractedPerms.push(`${k}:${v}`);
              }
            }
            if (extractedPerms.length > 0) {
              existing.permissions = extractedPerms;
            }
          }
          if (mod.description) {
            existing.description = mod.description;
          }
        }
      }
    }
  }

  compose(name: string, components: Array<{ moduleName: string; capabilityName: string }>): Capability {
    const compositeKey = `composite:${name}`;
    const componentKeys: string[] = [];

    const mergedInputs: Array<{ name: string; type: string; required: boolean }> = [];
    const mergedOutputs: Array<{ name: string; type: string }> = [];
    const allPermissions: string[] = [];
    const seenInputNames = new Set<string>();
    const seenOutputNames = new Set<string>();

    for (const comp of components) {
      const key = `${comp.moduleName}:${comp.capabilityName}`;
      componentKeys.push(key);
      const cap = this.capabilities.get(key);
      if (!cap) {
        throw new Error(`Component capability not found: ${key}`);
      }
      for (const inp of cap.inputs ?? []) {
        if (!seenInputNames.has(inp.name)) {
          seenInputNames.add(inp.name);
          mergedInputs.push({ ...inp });
        }
      }
      for (const out of cap.outputs ?? []) {
        if (!seenOutputNames.has(out.name)) {
          seenOutputNames.add(out.name);
          mergedOutputs.push({ ...out });
        }
      }
      for (const perm of cap.permissions ?? []) {
        if (!allPermissions.includes(perm)) {
          allPermissions.push(perm);
        }
      }
    }

    const composite: Capability = {
      name,
      description: `Composite of ${components.map(c => `${c.moduleName}:${c.capabilityName}`).join(', ')}`,
      module: 'composite',
      inputs: mergedInputs.length > 0 ? mergedInputs : undefined,
      outputs: mergedOutputs.length > 0 ? mergedOutputs : undefined,
      permissions: allPermissions.length > 0 ? allPermissions : undefined,
    };

    this.capabilities.set(compositeKey, composite);
    this.composites.set(compositeKey, componentKeys);

    this.handlers.set(compositeKey, async (inputs: Record<string, unknown>, context: unknown) => {
      const mergedResult: Record<string, unknown> = {};
      let lastOutputs: Record<string, unknown> = {};
      for (const comp of components) {
        const compHandler = this.handlers.get(`${comp.moduleName}:${comp.capabilityName}`);
        if (!compHandler) {
          throw new Error(`Handler not found for component: ${comp.moduleName}:${comp.capabilityName}`);
        }
        const compInputs: Record<string, unknown> = {};
        for (const key of Object.keys(inputs)) {
          compInputs[key] = inputs[key];
        }
        for (const key of Object.keys(lastOutputs)) {
          if (!(key in compInputs)) {
            compInputs[key] = lastOutputs[key];
          }
        }
        lastOutputs = await compHandler(compInputs, context);
        Object.assign(mergedResult, lastOutputs);
      }
      return mergedResult;
    });

    return composite;
  }

  chain(capabilities: Array<{ moduleName: string; capabilityName: string; inputMapping?: Record<string, string> }>): string {
    const chainId = `chain:${capabilities.map(c => `${c.moduleName}:${c.capabilityName}`).join('->')}`;
    const steps: ChainStep[] = capabilities.map(c => ({
      capabilityName: c.capabilityName,
      moduleName: c.moduleName,
      inputMapping: c.inputMapping ?? null,
    }));
    this.chainDefinitions.set(chainId, steps);

    const firstKey = `${capabilities[0].moduleName}:${capabilities[0].capabilityName}`;
    this.handlers.set(chainId, async (inputs: Record<string, unknown>, context: unknown) => {
      let carry: Record<string, unknown> = { ...inputs };
      for (const step of steps) {
        const key = `${step.moduleName}:${step.capabilityName}`;
        const handler = this.handlers.get(key);
        if (!handler) {
          throw new Error(`Chain step handler not found: ${key}`);
        }
        const stepInputs: Record<string, unknown> = {};
        if (step.inputMapping) {
          for (const [targetKey, sourceKey] of Object.entries(step.inputMapping)) {
            stepInputs[targetKey] = carry[sourceKey];
          }
        } else {
          for (const k of Object.keys(carry)) {
            stepInputs[k] = carry[k];
          }
        }
        carry = await handler(stepInputs, context);
      }
      return carry;
    });

    this.capabilities.set(chainId, {
      name: chainId,
      description: `Chained: ${capabilities.map(c => `${c.moduleName}:${c.capabilityName}`).join(' -> ')}`,
      module: 'chain',
    });

    return chainId;
  }

  enableCache(name: string, ttlMs: number): void {
    const matchingKeys: string[] = [];
    for (const key of this.capabilities.keys()) {
      if (key.endsWith(`:${name}`)) {
        matchingKeys.push(key);
      }
    }
    if (matchingKeys.length === 0) {
      throw new Error(`Capability not found: ${name}`);
    }
    for (const key of matchingKeys) {
      this.cacheTTLs.set(key, ttlMs);
      this.cacheStore.delete(key);
    }
  }

  invalidateCache(name: string): void {
    for (const key of this.cacheStore.keys()) {
      if (key.endsWith(`:${name}`) || key === name) {
        this.cacheStore.delete(key);
      }
    }
  }

  clearCache(): void {
    this.cacheStore.clear();
  }

  validate(capabilityName: string, inputs: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const cap = this.resolve(capabilityName);
    if (!cap) {
      return { valid: false, errors: [`Capability not found: ${capabilityName}`] };
    }

    const errors: string[] = [];
    if (cap.inputs) {
      for (const inputDef of cap.inputs) {
        if (inputDef.required && !(inputDef.name in inputs)) {
          errors.push(`Missing required input: ${inputDef.name}`);
          continue;
        }
        if (inputDef.name in inputs) {
          const value = inputs[inputDef.name];
          const typeError = this.validateType(value, inputDef.type, inputDef.name);
          if (typeError) {
            errors.push(typeError);
          }
        }
      }
      for (const inputKey of Object.keys(inputs)) {
        if (!cap.inputs.some(i => i.name === inputKey)) {
          errors.push(`Unexpected input: ${inputKey}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  getSchema(capabilityName: string): { inputs: Array<{ name: string; type: string; required: boolean }>; outputs: Array<{ name: string; type: string }> } | undefined {
    const cap = this.resolve(capabilityName);
    if (!cap) {
      return undefined;
    }
    return {
      inputs: cap.inputs?.map(i => ({ name: i.name, type: i.type, required: i.required })) ?? [],
      outputs: cap.outputs?.map(o => ({ name: o.name, type: o.type })) ?? [],
    };
  }

  setPermissionRequirement(capabilityName: string, permissions: string[]): void {
    const matchingKeys: string[] = [];
    for (const key of this.capabilities.keys()) {
      if (key.endsWith(`:${capabilityName}`)) {
        matchingKeys.push(key);
      }
    }
    if (matchingKeys.length === 0) {
      throw new Error(`Capability not found: ${capabilityName}`);
    }
    for (const key of matchingKeys) {
      const cap = this.capabilities.get(key)!;
      cap.permissions = [...new Set([...(cap.permissions ?? []), ...permissions])];
      const existing = this.permissionRequirements.find(p => p.capabilityKey === key);
      if (existing) {
        existing.permissions = [...new Set([...existing.permissions, ...permissions])];
      } else {
        this.permissionRequirements.push({ capabilityKey: key, permissions });
      }
    }
  }

  checkPermissions(capabilityName: string, permissionChecker: (permission: string) => boolean): { allowed: boolean; missing: string[] } {
    const cap = this.resolve(capabilityName);
    if (!cap) {
      return { allowed: false, missing: [] };
    }
    const required = cap.permissions ?? [];
    const missing = required.filter(p => !permissionChecker(p));
    return { allowed: missing.length === 0, missing };
  }

  getByModule(moduleName: string): Capability[] {
    const result: Capability[] = [];
    for (const [key, cap] of this.capabilities) {
      if (cap.module === moduleName || key.startsWith(`${moduleName}:`)) {
        result.push(cap);
      }
    }
    return result;
  }

  getCapabilityStats(name: string): CapabilityStats | undefined {
    const matchingKeys: string[] = [];
    for (const key of this.capabilities.keys()) {
      if (key.endsWith(`:${name}`)) {
        matchingKeys.push(key);
      }
    }
    if (matchingKeys.length === 0) {
      return undefined;
    }
    const combined: CapabilityStats = {
      invocationCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      lastInvokedAt: null,
      errorCount: 0,
    };
    for (const key of matchingKeys) {
      const s = this.stats.get(key);
      if (s) {
        combined.invocationCount += s.invocationCount;
        combined.totalDurationMs += s.totalDurationMs;
        combined.errorCount += s.errorCount;
        if (s.lastInvokedAt && (!combined.lastInvokedAt || s.lastInvokedAt > combined.lastInvokedAt)) {
          combined.lastInvokedAt = s.lastInvokedAt;
        }
      }
    }
    combined.avgDurationMs = combined.invocationCount > 0 ? combined.totalDurationMs / combined.invocationCount : 0;
    return combined;
  }

  setVersion(capabilityName: string, version: string, compatMap: string[] = [], deprecated = false): void {
    const matchingKeys: string[] = [];
    for (const key of this.capabilities.keys()) {
      if (key.endsWith(`:${capabilityName}`)) {
        matchingKeys.push(key);
      }
    }
    for (const key of matchingKeys) {
      const cap = this.capabilities.get(key);
      if (!cap) continue;
      const versionEntry: CapabilityVersion = {
        version,
        capability: { ...cap },
        deprecated,
        compatMap,
      };
      const existing = this.versions.get(key) ?? [];
      existing.push(versionEntry);
      this.versions.set(key, existing);
    }
  }

  getVersionHistory(capabilityName: string): CapabilityVersion[] {
    for (const [key, versions] of this.versions) {
      if (key.endsWith(`:${capabilityName}`)) {
        return [...versions];
      }
    }
    return [];
  }

  resolveVersion(capabilityName: string, requestedVersion: string): Capability | undefined {
    for (const [key, versions] of this.versions) {
      if (key.endsWith(`:${capabilityName}`)) {
        const match = versions.find(v => v.version === requestedVersion);
        if (match && !match.deprecated) {
          return { ...match.capability };
        }
        const compatible = versions
          .filter(v => !v.deprecated && v.compatMap.includes(requestedVersion))
          .sort((a, b) => b.version.localeCompare(a.version));
        if (compatible.length > 0) {
          return { ...compatible[0].capability };
        }
      }
    }
    return this.resolve(capabilityName);
  }

  exportCapabilities(): CapabilityExportData {
    const entries: CapabilityExportEntry[] = [];
    for (const [key, cap] of this.capabilities) {
      const perms = this.permissionRequirements.find(p => p.capabilityKey === key);
      let version = '1.0.0';
      let deprecated = false;
      const versionList = this.versions.get(key);
      if (versionList && versionList.length > 0) {
        const latest = versionList[versionList.length - 1];
        version = latest.version;
        deprecated = latest.deprecated;
      }
      entries.push({
        key,
        capability: { ...cap },
        permissions: perms?.permissions ?? cap.permissions ?? [],
        version,
        deprecated,
      });
    }
    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      entries,
    };
  }

  importCapabilities(data: CapabilityExportData): { imported: number; skipped: number; errors: string[] } {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const entry of data.entries) {
      if (!entry.key || !entry.capability || !entry.capability.name) {
        errors.push(`Invalid entry: missing key or capability name`);
        skipped++;
        continue;
      }
      if (this.capabilities.has(entry.key)) {
        skipped++;
        continue;
      }
      this.capabilities.set(entry.key, { ...entry.capability });
      if (entry.permissions && entry.permissions.length > 0) {
        this.permissionRequirements.push({
          capabilityKey: entry.key,
          permissions: [...entry.permissions],
        });
      }
      if (entry.version) {
        const versionList = this.versions.get(entry.key) ?? [];
        versionList.push({
          version: entry.version,
          capability: { ...entry.capability },
          deprecated: entry.deprecated ?? false,
          compatMap: [],
        });
        this.versions.set(entry.key, versionList);
      }
      imported++;
    }

    return { imported, skipped, errors };
  }

  private validateType(value: unknown, expectedType: string, fieldName: string): string | null {
    switch (expectedType.toLowerCase()) {
      case 'string':
        if (typeof value !== 'string') {
          return `Input "${fieldName}" expected type "string", got "${typeof value}"`;
        }
        break;
      case 'number':
        if (typeof value !== 'number') {
          return `Input "${fieldName}" expected type "number", got "${typeof value}"`;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `Input "${fieldName}" expected type "boolean", got "${typeof value}"`;
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null) {
          return `Input "${fieldName}" expected type "object", got "${typeof value}"`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return `Input "${fieldName}" expected type "array", got "${typeof value}"`;
        }
        break;
      case 'any':
        break;
      default:
        if (expectedType.endsWith('[]')) {
          if (!Array.isArray(value)) {
            return `Input "${fieldName}" expected type "${expectedType}", got "${typeof value}"`;
          }
        }
        break;
    }
    return null;
  }

  private recordStats(key: string, durationMs: number, hadError: boolean): void {
    let existing = this.stats.get(key);
    if (!existing) {
      existing = {
        invocationCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        lastInvokedAt: null,
        errorCount: 0,
      };
      this.stats.set(key, existing);
    }
    existing.invocationCount++;
    existing.totalDurationMs += durationMs;
    existing.avgDurationMs = existing.totalDurationMs / existing.invocationCount;
    existing.lastInvokedAt = Date.now();
    if (hadError) {
      existing.errorCount++;
    }
  }
}
