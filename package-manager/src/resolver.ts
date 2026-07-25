/**
 * MAM Dependency Resolver
 * 
 * Resolves module dependencies and builds dependency graphs.
 */

import { PackageDependency } from './package.js';

// ============================================================================
// Types
// ============================================================================

export interface ResolutionResult {
  /** Resolved dependencies */
  resolved: ResolvedDependency[];
  /** Resolution errors */
  errors: ResolutionError[];
  /** Dependency graph */
  graph: DependencyGraph;
  /** Resolution time */
  timeMs: number;
}

export interface ResolvedDependency {
  /** Dependency name */
  name: string;
  /** Resolved version */
  version: string;
  /** Dependency URL */
  url: string;
  /** Integrity hash */
  integrity: string;
  /** Whether this is a direct dependency */
  direct: boolean;
  /** Resolved sub-dependencies */
  dependencies: ResolvedDependency[];
}

export interface ResolutionError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Dependency that caused error */
  dependency?: string;
}

export interface DependencyGraph {
  /** Nodes in the graph */
  nodes: DependencyNode[];
  /** Edges in the graph */
  edges: DependencyEdge[];
  /** Topological order */
  order: string[];
}

export interface DependencyNode {
  /** Node name */
  name: string;
  /** Node version */
  version: string;
  /** Node depth */
  depth: number;
}

export interface DependencyEdge {
  /** Source node */
  from: string;
  /** Target node */
  to: string;
  /** Edge type */
  type: 'direct' | 'peer' | 'optional';
}

// ============================================================================
// Resolver
// ============================================================================

export class DependencyResolver {
  private resolved: Map<string, ResolvedDependency> = new Map();
  private errors: ResolutionError[] = [];
  private visited: Set<string> = new Set();
  private resolving: Set<string> = new Set();

  /**
   * Resolve dependencies
   */
  resolve(dependencies: PackageDependency[]): ResolutionResult {
    const startTime = performance.now();
    this.resolved.clear();
    this.errors = [];
    this.visited.clear();
    this.resolving.clear();

    // Resolve each dependency
    for (const dep of dependencies) {
      this.resolveDependency(dep, 0, true);
    }

    // Build graph
    const graph = this.buildGraph();

    return {
      resolved: Array.from(this.resolved.values()),
      errors: this.errors,
      graph,
      timeMs: performance.now() - startTime,
    };
  }

  private resolveDependency(dep: PackageDependency, depth: number, direct: boolean): ResolvedDependency | null {
    // Check for circular dependencies
    if (this.resolving.has(dep.name)) {
      this.errors.push({
        code: 'CIRCULAR_DEPENDENCY',
        message: `Circular dependency detected: ${dep.name}`,
        dependency: dep.name,
      });
      return null;
    }

    // Check if already resolved
    if (this.resolved.has(dep.name)) {
      return this.resolved.get(dep.name)!;
    }

    this.resolving.add(dep.name);

    // In real implementation, this would:
    // 1. Check local cache
    // 2. Fetch from registry
    // 3. Resolve version range
    // 4. Download if needed

    const resolved: ResolvedDependency = {
      name: dep.name,
      version: dep.version,
      url: `https://registry.mam.dev/${dep.name}/${dep.version}`,
      integrity: `sha256-${this.generateHash(dep.name + dep.version)}`,
      direct,
      dependencies: [],
    };

    this.resolved.set(dep.name, resolved);
    this.resolving.delete(dep.name);
    this.visited.add(dep.name);

    return resolved;
  }

  private buildGraph(): DependencyGraph {
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const order: string[] = [];

    // Build nodes
    for (const [name, dep] of this.resolved) {
      nodes.push({
        name,
        version: dep.version,
        depth: 0,
      });
    }

    // Build edges
    for (const [name, dep] of this.resolved) {
      for (const subDep of dep.dependencies) {
        edges.push({
          from: name,
          to: subDep.name,
          type: 'direct',
        });
      }
    }

    // Topological sort
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (temp.has(name)) {
        // Circular dependency, skip
        return;
      }
      
      temp.add(name);
      
      const dep = this.resolved.get(name);
      if (dep) {
        for (const subDep of dep.dependencies) {
          visit(subDep.name);
        }
      }
      
      temp.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of this.resolved.keys()) {
      visit(name);
    }

    return { nodes, edges, order };
  }

  private generateHash(input: string): string {
    // Simple hash for demonstration
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }
}