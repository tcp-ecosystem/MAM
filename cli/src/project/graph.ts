/**
 * Project dependency graph across all modules in a MAM project.
 */

import type { LoadedModule } from './loader.js';

export interface ProjectGraphNode {
  id: string;
  name: string;
  type: string;
  file: string;
  external: boolean;
}

export interface ProjectGraphEdge {
  from: string;
  to: string;
  kind: 'dependency' | 'module' | 'agent';
}

export interface ProjectGraph {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  /** Topologically sorted module ids (dependencies first). */
  order: string[];
  /** Cyclic groups, if any. */
  cycles: string[][];
}

/**
 * Build a dependency graph from loaded modules. Dependencies that do not
 * resolve to a module in the project are marked `external`.
 */
export function buildProjectGraph(modules: LoadedModule[]): ProjectGraph {
  const byKey = new Map<string, LoadedModule>();
  for (const mod of modules) {
    byKey.set(mod.id.toLowerCase(), mod);
    byKey.set(mod.name.toLowerCase(), mod);
  }

  const nodes: ProjectGraphNode[] = modules.map((mod) => ({
    id: mod.id,
    name: mod.name,
    type: mod.type,
    file: mod.relativePath,
    external: false,
  }));

  const edges: ProjectGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const seenExternal = new Map<string, ProjectGraphNode>();

  const addEdge = (from: string, to: string, kind: ProjectGraphEdge['kind']) => {
    const key = `${from}\u0000${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };

  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      const name = dep.split('@')[0]!.toLowerCase();
      const target = byKey.get(name);
      if (target) {
        addEdge(mod.id, target.id, 'dependency');
      } else if (name) {
        if (!seenExternal.has(name)) {
          const externalNode: ProjectGraphNode = {
            id: dep.split('@')[0]!,
            name: dep.split('@')[0]!,
            type: 'external',
            file: '',
            external: true,
          };
          seenExternal.set(name, externalNode);
          nodes.push(externalNode);
        }
        addEdge(mod.id, dep.split('@')[0]!, 'dependency');
      }
    }

    // System composition edges (## Modules / agents).
    for (const composed of [...(mod.node?.modules ?? []), ...(mod.node?.agents ?? [])]) {
      const target = byKey.get(composed.toLowerCase());
      if (target) {
        addEdge(mod.id, target.id, 'module');
      }
    }
  }

  const { order, cycles } = topologicalOrder(modules, edges);
  return { nodes, edges, order, cycles };
}

function topologicalOrder(
  modules: LoadedModule[],
  edges: ProjectGraphEdge[],
): { order: string[]; cycles: string[][] } {
  const ids = [...new Set(modules.map((m) => m.id))];
  const idSet = new Set(ids);
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of ids) {
    graph.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    // `from` depends on `to`; dependencies must execute first.
    const out = graph.get(edge.to)!;
    if (!out.has(edge.from)) {
      out.add(edge.from);
      inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of graph.get(current) ?? []) {
      const degree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  const cycles: string[][] = [];
  if (order.length < ids.length) {
    cycles.push(ids.filter((id) => !order.includes(id)));
    for (const id of ids) if (!order.includes(id)) order.push(id);
  }

  return { order, cycles };
}

/**
 * Render the graph as a Mermaid flowchart.
 */
export function graphToMermaid(graph: ProjectGraph): string {
  const lines: string[] = ['flowchart TD'];
  const safe = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '_');
  const label = new Map(graph.nodes.map((n) => [n.id, n.name]));

  for (const node of graph.nodes) {
    if (node.external) lines.push(`    ${safe(node.id)}[/"${node.name} (external)"/]`);
    else lines.push(`    ${safe(node.id)}["${label.get(node.id) ?? node.id}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`    ${safe(edge.from)} --> ${safe(edge.to)}`);
  }
  return lines.join('\n');
}

/**
 * Render the graph as a plain-text adjacency listing.
 */
export function graphToText(graph: ProjectGraph): string {
  const lines: string[] = [];
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from)!.push(edge.to);
  }
  for (const node of graph.nodes.filter((n) => !n.external)) {
    const deps = outgoing.get(node.id) ?? [];
    lines.push(`${node.id} (${node.type})`);
    if (deps.length === 0) lines.push('  └── (no dependencies)');
    else for (const dep of deps) lines.push(`  ├── ${dep}`);
  }
  if (graph.cycles.length > 0) {
    lines.push('');
    lines.push('Cycles:');
    for (const cycle of graph.cycles) lines.push(`  ! ${cycle.join(' -> ')}`);
  }
  return lines.join('\n');
}
