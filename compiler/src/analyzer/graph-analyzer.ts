/**
 * MAM Graph Analyzer
 *
 * Models the module dependency graph built from `edges` and `requires`
 * references, then detects cycles, orphaned modules, connectivity, reachability
 * between module pairs, and produces a deterministic topological ordering
 * (dependencies first).
 */

import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/** Result of analyzing the module dependency graph. */
export interface GraphAnalysisResult {
  /** True when the graph contains no cycles. */
  valid: boolean;
  /** Every detected cycle as an ordered list of module names (start == end). */
  cycles: string[][];
  /** Module names that have neither incoming nor outgoing dependencies. */
  orphans: string[];
  /** Module names ordered dependencies-first (partial when cycles exist). */
  order: string[];
  /** Number of modules in the graph. */
  nodeCount: number;
  /** Number of unique directed dependency edges. */
  edgeCount: number;
}

// ============================================================================
// Graph Analyzer
// ============================================================================

/**
 * Builds and inspects the directed dependency graph implied by a collection
 * of {@link V2ModuleNode} modules.
 *
 * Edges are sourced from:
 * - `requires` lists (module -> dependency),
 * - `edges` lists whose source/target both name known modules (workflow-internal
 *   edges that reference step names are intentionally ignored).
 */
export class GraphAnalyzer {
  private modules: V2ModuleNode[] = [];
  private adjacency: Map<string, string[]> = new Map();
  private reverse: Map<string, string[]> = new Map();
  private edgeCount = 0;
  private built = false;

  /**
   * Build the dependency graph from a list of modules and return a full
   * {@link GraphAnalysisResult} (cycles, orphans, ordering, and counts).
   *
   * @param modules - The modules to analyze.
   */
  analyzeGraph(modules: V2ModuleNode[]): GraphAnalysisResult {
    this.buildGraph(modules);
    const cycles = this.findCycles();
    return {
      valid: cycles.length === 0,
      cycles,
      orphans: this.findOrphans(),
      order: this.topologicalOrder(modules),
      nodeCount: this.modules.length,
      edgeCount: this.edgeCount,
    };
  }

  /**
   * Find every cycle in the dependency graph.
   *
   * @returns An array of cycles; each cycle is a module-name list whose first
   * element equals its last element.
   */
  findCycles(): string[][] {
    if (!this.built) return [];
    const cycles: string[][] = [];
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    for (const name of this.adjacency.keys()) {
      state.set(name, 0);
    }
    for (const start of this.adjacency.keys()) {
      if (state.get(start) === 0) {
        this.dfsCycle(start, state, stack, cycles);
      }
    }
    return cycles;
  }

  /**
   * Find modules that participate in no dependency edge at all (no `requires`
   * and no incoming/outgoing module-level edges).
   *
   * @returns Module names that are orphaned.
   */
  findOrphans(): string[] {
    if (!this.built) return [];
    return this.modules
      .filter((m) => {
        const out = this.adjacency.get(m.name) ?? [];
        const inc = this.reverse.get(m.name) ?? [];
        return out.length === 0 && inc.length === 0;
      })
      .map((m) => m.name);
  }

  /**
   * Determine whether the whole graph is weakly connected when edge direction
   * is ignored.
   *
   * @returns True when every module is reachable from the first module via the
   * undirected graph, or when there are no modules.
   */
  isConnected(): boolean {
    const nodes = this.modules.map((m) => m.name);
    if (nodes.length === 0) return true;
    if (!this.built) return false;

    const undirected = new Map<string, string[]>();
    for (const n of nodes) undirected.set(n, []);
    for (const [from, tos] of this.adjacency) {
      for (const to of tos) {
        undirected.get(from)?.push(to);
        undirected.get(to)?.push(from);
      }
    }

    const visited = new Set<string>();
    const queue = [nodes[0]];
    visited.add(nodes[0]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of undirected.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited.size === nodes.length;
  }

  /**
   * Determine whether `to` is reachable from `from` following directed edges.
   *
   * @param from - The starting module name.
   * @param to - The target module name.
   * @returns True when a directed path exists from `from` to `to`.
   */
  reachable(from: string, to: string): boolean {
    if (!this.built) return false;
    const visited = new Set<string>();
    const queue = [from];
    visited.add(from);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) return true;
      for (const next of this.adjacency.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Produce a deterministic topological ordering of modules (dependencies
   * first) using Kahn's algorithm.
   *
   * When cycles exist the ordering is partial: cycle members are appended in
   * their original input order after all non-cycle modules.
   *
   * @param modules - The modules to order.
   * @returns Module names in dependency-first order.
   */
  topologicalOrder(modules: V2ModuleNode[]): string[] {
    this.buildGraph(modules);

    const indegree = new Map<string, number>();
    for (const name of this.adjacency.keys()) {
      indegree.set(name, 0);
    }
    for (const tos of this.adjacency.values()) {
      for (const to of tos) {
        indegree.set(to, (indegree.get(to) ?? 0) + 1);
      }
    }

    const queue = [...indegree.keys()].filter((n) => (indegree.get(n) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const next of this.adjacency.get(cur) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if ((indegree.get(next) ?? 0) === 0) queue.push(next);
      }
    }

    const seen = new Set(order);
    for (const m of modules) {
      if (!seen.has(m.name)) order.push(m.name);
    }
    return order;
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private buildGraph(modules: V2ModuleNode[]): void {
    this.modules = modules;
    this.adjacency.clear();
    this.reverse.clear();
    this.edgeCount = 0;
    this.built = true;

    const names = new Set(modules.map((m) => m.name));
    for (const name of names) {
      this.adjacency.set(name, []);
      this.reverse.set(name, []);
    }

    for (const mod of modules) {
      for (const dep of mod.requires ?? []) {
        if (names.has(dep)) this.addEdge(mod.name, dep);
      }
      for (const edge of mod.edges ?? []) {
        if (names.has(edge.source) && names.has(edge.target)) {
          this.addEdge(edge.source, edge.target);
        }
      }
    }
  }

  private addEdge(from: string, to: string): void {
    if (this.adjacency.get(from)?.includes(to)) return;
    this.adjacency.get(from)?.push(to);
    this.reverse.get(to)?.push(from);
    this.edgeCount++;
  }

  private dfsCycle(
    node: string,
    state: Map<string, 0 | 1 | 2>,
    stack: string[],
    cycles: string[][],
  ): void {
    state.set(node, 1);
    stack.push(node);
    for (const next of this.adjacency.get(node) ?? []) {
      const s = state.get(next);
      if (s === 1) {
        const idx = stack.indexOf(next);
        if (idx !== -1) cycles.push([...stack.slice(idx), next]);
      } else if (s === 0) {
        this.dfsCycle(next, state, stack, cycles);
      }
    }
    stack.pop();
    state.set(node, 2);
  }
}