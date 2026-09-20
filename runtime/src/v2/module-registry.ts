/**
 * MAM Runtime Module Registry
 *
 * Manages loaded modules, resolves dependencies between them,
 * detects cycles, and provides module lookup and inspection.
 */

import { V2ModuleNode, V2PortDefinition, V2PermissionSet } from '@mam/ast';

export type ModuleStatus = 'registered' | 'resolved' | 'loading' | 'loaded' | 'active' | 'failed' | 'unloaded';

export interface ModuleRecord {
  id: string;
  name: string;
  version: string;
  type: string;
  status: ModuleStatus;
  module: V2ModuleNode;
  dependencies: string[];
  dependents: string[];
  capabilities: string[];
  inputs: V2PortDefinition[];
  outputs: V2PortDefinition[];
  permissions?: V2PermissionSet;
  metadata: Record<string, unknown>;
  loadedAt?: number;
  activatedAt?: number;
  error?: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  order: string[];
  cycles: string[][];
}

export interface DependencyNode {
  id: string;
  name: string;
  version: string;
  type: string;
  depth: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'direct' | 'peer' | 'optional';
}

export interface DependencyTree {
  name: string;
  version: string;
  type: string;
  depth: number;
  dependencies: DependencyTree[];
  truncated: boolean;
}

export interface RegistryStats {
  totalModules: number;
  registered: number;
  resolved: number;
  loaded: number;
  active: number;
  failed: number;
  totalDependencies: number;
  totalCapabilities: number;
}

export interface ModuleLookupOptions {
  type?: string;
  capability?: string;
  status?: ModuleStatus;
  tags?: string[];
}

export type RegistryEventType = 'register' | 'unregister' | 'resolve' | 'load' | 'activate' | 'fail';
export type RegistryListener = (event: RegistryEventType, record: ModuleRecord) => void;

export class ModuleRegistry {
  private modules: Map<string, ModuleRecord> = new Map();
  private aliases: Map<string, string> = new Map();
  private listeners: RegistryListener[] = [];

  addListener(listener: RegistryListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: RegistryListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notifyListeners(event: RegistryEventType, record: ModuleRecord): void {
    for (const listener of this.listeners) {
      try { listener(event, record); } catch {}
    }
  }

  register(module: V2ModuleNode, options: { version?: string; metadata?: Record<string, unknown> } = {}): ModuleRecord {
    const existing = this.modules.get(module.name);
    if (existing) throw new Error(`Module already registered: ${module.name}`);

    const deps = module.requires ?? [];
    const record: ModuleRecord = {
      id: `mod-${module.name}-${Date.now().toString(36)}`,
      name: module.name,
      version: options.version ?? '0.1.0',
      type: module.moduleType,
      status: 'registered',
      module,
      dependencies: deps,
      dependents: [],
      capabilities: module.capabilities ?? [],
      inputs: module.inputs ?? [],
      outputs: module.outputs ?? [],
      permissions: module.permissions,
      metadata: options.metadata ?? {},
    };

    this.modules.set(module.name, record);
    for (const dep of deps) {
      const depRecord = this.modules.get(dep);
      if (depRecord) depRecord.dependents.push(module.name);
    }
    this.notifyListeners('register', record);
    return record;
  }

  unregister(name: string): boolean {
    const record = this.modules.get(name);
    if (!record) return false;
    for (const dep of record.dependencies) {
      const depRecord = this.modules.get(dep);
      if (depRecord) depRecord.dependents = depRecord.dependents.filter(d => d !== name);
    }
    for (const dependent of record.dependents) {
      const depRecord = this.modules.get(dependent);
      if (depRecord) depRecord.dependencies = depRecord.dependencies.filter(d => d !== name);
    }
    this.modules.delete(name);
    this.notifyListeners('unregister', record);
    return true;
  }

  resolve(name: string): ModuleRecord | null {
    const resolvedName = this.aliases.get(name) ?? name;
    const record = this.modules.get(resolvedName);
    if (!record) return null;
    if (record.status === 'registered') {
      record.status = 'resolved';
      this.notifyListeners('resolve', record);
    }
    return record;
  }

  markLoaded(name: string): boolean {
    const record = this.modules.get(name);
    if (!record) return false;
    record.status = 'loaded';
    record.loadedAt = Date.now();
    this.notifyListeners('load', record);
    return true;
  }

  markActive(name: string): boolean {
    const record = this.modules.get(name);
    if (!record) return false;
    record.status = 'active';
    record.activatedAt = Date.now();
    this.notifyListeners('activate', record);
    return true;
  }

  markFailed(name: string, error: string): boolean {
    const record = this.modules.get(name);
    if (!record) return false;
    record.status = 'failed';
    record.error = error;
    this.notifyListeners('fail', record);
    return true;
  }

  getModule(name: string): ModuleRecord | null {
    return this.modules.get(name) ?? null;
  }

  getModules(): ModuleRecord[] {
    return Array.from(this.modules.values());
  }

  findModules(options: ModuleLookupOptions): ModuleRecord[] {
    let results = Array.from(this.modules.values());
    if (options.type) results = results.filter(m => m.type === options.type);
    if (options.capability) results = results.filter(m => m.capabilities.includes(options.capability!));
    if (options.status) results = results.filter(m => m.status === options.status);
    if (options.tags) {
      results = results.filter(m => {
        const tags = (m.metadata.tags as string[]) ?? [];
        return options.tags!.some(t => tags.includes(t));
      });
    }
    return results;
  }

  addAlias(alias: string, target: string): void {
    if (!this.modules.has(target)) throw new Error(`Target module not found: ${target}`);
    this.aliases.set(alias, target);
  }

  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias);
  }

  buildDependencyGraph(): DependencyGraph {
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const depths = new Map<string, number>();

    const calculateDepth = (name: string, currentDepth: number): number => {
      if (depths.has(name)) return depths.get(name)!;
      const record = this.modules.get(name);
      if (!record) return currentDepth;
      let maxDepth = currentDepth;
      for (const dep of record.dependencies) {
        const depDepth = calculateDepth(dep, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depDepth);
      }
      depths.set(name, maxDepth);
      return maxDepth;
    };

    for (const [name] of this.modules) calculateDepth(name, 0);

    for (const [name, record] of this.modules) {
      nodes.push({ id: name, name: record.name, version: record.version, type: record.type, depth: depths.get(name) ?? 0 });
      for (const dep of record.dependencies) edges.push({ from: name, to: dep, type: 'direct' });
    }

    return { nodes, edges, order: this.topologicalSort(), cycles: this.detectCycles() };
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (name: string) => {
      if (inStack.has(name)) {
        const cycleStart = path.indexOf(name);
        if (cycleStart !== -1) cycles.push([...path.slice(cycleStart), name]);
        return;
      }
      if (visited.has(name)) return;
      visited.add(name);
      inStack.add(name);
      path.push(name);
      const record = this.modules.get(name);
      if (record) { for (const dep of record.dependencies) dfs(dep); }
      path.pop();
      inStack.delete(name);
    };

    for (const [name] of this.modules) dfs(name);
    return cycles;
  }

  topologicalSort(): string[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    for (const [name] of this.modules) { graph.set(name, new Set()); inDegree.set(name, 0); }
    for (const [name, record] of this.modules) {
      for (const dep of record.dependencies) {
        const depGraph = graph.get(dep);
        if (depGraph) { depGraph.add(name); inDegree.set(name, (inDegree.get(name) ?? 0) + 1); }
      }
    }
    const queue: string[] = [];
    for (const [name, degree] of inDegree) { if (degree === 0) queue.push(name); }
    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);
      for (const neighbor of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }
    for (const name of this.modules.keys()) { if (!sorted.includes(name)) sorted.push(name); }
    return sorted;
  }

  validateDependencies(): { valid: boolean; missing: string[]; cycles: string[][] } {
    const missing: string[] = [];
    const cycles = this.detectCycles();
    for (const [name, record] of this.modules) {
      for (const dep of record.dependencies) {
        if (!this.modules.has(dep) && !this.aliases.has(dep)) missing.push(`${name} requires ${dep}`);
      }
    }
    return { valid: missing.length === 0 && cycles.length === 0, missing, cycles };
  }

  getDependencyTree(name: string, depth: number = 0, maxDepth: number = 10): DependencyTree | null {
    const record = this.modules.get(name);
    if (!record) return null;
    if (depth >= maxDepth) return { name: record.name, version: record.version, type: record.type, depth, dependencies: [], truncated: true };
    const dependencies: DependencyTree[] = [];
    for (const dep of record.dependencies) {
      const depTree = this.getDependencyTree(dep, depth + 1, maxDepth);
      if (depTree) dependencies.push(depTree);
    }
    return { name: record.name, version: record.version, type: record.type, depth, dependencies, truncated: false };
  }

  getReverseDependencyTree(name: string, depth: number = 0, maxDepth: number = 10): DependencyTree | null {
    const record = this.modules.get(name);
    if (!record) return null;
    if (depth >= maxDepth) return { name: record.name, version: record.version, type: record.type, depth, dependencies: [], truncated: true };
    const dependencies: DependencyTree[] = [];
    for (const dep of record.dependents) {
      const depTree = this.getReverseDependencyTree(dep, depth + 1, maxDepth);
      if (depTree) dependencies.push(depTree);
    }
    return { name: record.name, version: record.version, type: record.type, depth, dependencies, truncated: false };
  }

  getStats(): RegistryStats {
    const modules = Array.from(this.modules.values());
    return {
      totalModules: modules.length,
      registered: modules.filter(m => m.status === 'registered').length,
      resolved: modules.filter(m => m.status === 'resolved').length,
      loaded: modules.filter(m => m.status === 'loaded').length,
      active: modules.filter(m => m.status === 'active').length,
      failed: modules.filter(m => m.status === 'failed').length,
      totalDependencies: modules.reduce((sum, m) => sum + m.dependencies.length, 0),
      totalCapabilities: modules.reduce((sum, m) => sum + m.capabilities.length, 0),
    };
  }

  clear(): void {
    this.modules.clear();
    this.aliases.clear();
  }
}
