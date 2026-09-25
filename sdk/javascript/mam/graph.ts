import type { AST } from './parser.js';

export interface DepNode {
  name: string;
  type: string;
}

export interface DepEdge {
  from: string;
  to: string;
  label: string;
}

export interface DepGraph {
  nodes: DepNode[];
  edges: DepEdge[];
}

export function buildDepGraph(ast: AST): DepGraph {
  const nodes: DepNode[] = [];
  const edges: DepEdge[] = [];
  const seen = new Set<string>();
  const addNode = (name: string, type: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      nodes.push({ name, type });
    }
  };
  const root = moduleRootName(ast.location.source);
  addNode(root, 'module');
  if (ast.frontmatter !== null) {
    addNode('frontmatter', 'frontmatter');
    edges.push({ from: root, to: 'frontmatter', label: 'describes' });
  }
  for (const section of ast.sections) {
    addNode(section.name, 'section');
    edges.push({ from: root, to: section.name, label: 'contains' });
    for (const node of section.content) {
      if (node.type === 'CodeBlock') {
        const runtime = `runtime:${normalizeRuntimeLabel(node.language)}`;
        addNode(runtime, 'runtime');
        edges.push({ from: section.name, to: runtime, label: node.language ?? '' });
      }
    }
  }
  const deduped = deduplicateDepEdges(edges.map((edge) => ({ ...edge, label: edge.label.trim() })));
  const pruned = pruneDanglingEdges({ nodes, edges: deduped });
  pruned.nodes.sort((a, b) => a.name.localeCompare(b.name));
  pruned.edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return pruned;
}

export function topoSortDepGraph(graph: DepGraph): string[] {
  const inDegree = buildInDegrees(graph);
  const adjacency = adjacencyOf(graph);
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }
  queue.sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    order.push(name);
    const targets = [...(adjacency.get(name) ?? [])].sort();
    for (const target of targets) {
      inDegree.set(target, (inDegree.get(target) ?? 1) - 1);
      if (inDegree.get(target) === 0) {
        queue.push(target);
      }
    }
    queue.sort();
  }
  if (order.length !== inDegree.size) {
    const cycle = detectCyclePath(graph);
    throw new Error(
      cycle.length > 0
        ? `Dependency cycle detected: ${cycle.join(' -> ')}`
        : 'Dependency cycle detected',
    );
  }
  return order;
}

export function getDepNodeNames(graph: DepGraph, type?: string): string[] {
  const names = graph.nodes
    .filter((node) => type === undefined || node.type === type)
    .map((node) => node.name);
  return [...names].sort();
}

export function summarizeDepGraph(graph: DepGraph): string {
  const isolated = countIsolatedNodes(graph);
  const leaves = findDepLeafNodes(graph).length;
  const roots = findDepRootNodes(graph).length;
  let summary = `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
  if (isolated > 0) {
    summary += `, ${isolated} isolated`;
  }
  summary += `, ${roots} roots, ${leaves} leaves`;
  return summary;
}

export function getDepSuccessors(graph: DepGraph, name: string): string[] {
  const targets = graph.edges.filter((edge) => edge.from === name).map((edge) => edge.to);
  return [...new Set(targets)].sort();
}

export function getDepNodesOfType(graph: DepGraph, type: string): DepNode[] {
  return graph.nodes
    .filter((node) => node.type === type)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countDepEdgesByLabel(graph: DepGraph, label: string): number {
  return graph.edges.filter((edge) => edge.label === label).length;
}

export function countDepNodesByType(graph: DepGraph, type: string): number {
  return graph.nodes.filter((node) => node.type === type).length;
}

export function hasDepNode(graph: DepGraph, name: string): boolean {
  return graph.nodes.some((node) => node.name === name);
}

export function getDepNodeType(graph: DepGraph, name: string): string | undefined {
  return graph.nodes.find((node) => node.name === name)?.type;
}

export function getDepPredecessors(graph: DepGraph, name: string): string[] {
  const sources = graph.edges.filter((edge) => edge.to === name).map((edge) => edge.from);
  return [...new Set(sources)].sort();
}

export function hasDepEdge(graph: DepGraph, from: string, to: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to);
}

export function getDepEdgeLabels(graph: DepGraph, from: string, to: string): string[] {
  return graph.edges
    .filter((edge) => edge.from === from && edge.to === to)
    .map((edge) => edge.label)
    .sort();
}

export function findDepLeafNodes(graph: DepGraph): string[] {
  return graph.nodes
    .filter((node) => countEdgesFrom(graph, node.name) === 0)
    .map((node) => node.name)
    .sort();
}

export function findDepRootNodes(graph: DepGraph): string[] {
  return graph.nodes
    .filter((node) => countEdgesTo(graph, node.name) === 0)
    .map((node) => node.name)
    .sort();
}

export function formatDepGraphText(graph: DepGraph): string {
  const lines: string[] = [`# Dependency graph (${summarizeDepGraph(graph)})`, ''];
  lines.push('## Nodes');
  for (const node of [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- ${node.name} (${node.type})`);
  }
  lines.push('', '## Edges');
  for (const line of formatDepGraphLines(graph)) {
    lines.push(`- ${line}`);
  }
  return lines.join('\n');
}

function buildInDegrees(graph: DepGraph): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.name, 0);
  }
  for (const edge of graph.edges) {
    if (!inDegree.has(edge.from)) {
      inDegree.set(edge.from, 0);
    }
    if (!inDegree.has(edge.to)) {
      inDegree.set(edge.to, 0);
    }
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  return inDegree;
}

function adjacencyOf(graph: DepGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.name, []);
  }
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.from);
    if (targets === undefined) {
      adjacency.set(edge.from, [edge.to]);
    } else {
      targets.push(edge.to);
    }
    if (!adjacency.has(edge.to)) {
      adjacency.set(edge.to, []);
    }
  }
  return adjacency;
}

function detectCyclePath(graph: DepGraph): string[] {
  const adjacency = adjacencyOf(graph);
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const at = stack.indexOf(node);
    if (at >= 0) {
      return [...stack.slice(at), node];
    }
    if (visited.has(node)) {
      return null;
    }
    visited.add(node);
    stack.push(node);
    const targets = [...(adjacency.get(node) ?? [])].sort();
    for (const target of targets) {
      const cycle = visit(target);
      if (cycle !== null) {
        return cycle;
      }
    }
    stack.pop();
    return null;
  };
  for (const name of getDepNodeNames(graph)) {
    const cycle = visit(name);
    if (cycle !== null) {
      return cycle;
    }
  }
  return [];
}

function pruneDanglingEdges(graph: DepGraph): DepGraph {
  const names = new Set(graph.nodes.map((node) => node.name));
  return {
    nodes: [...graph.nodes],
    edges: graph.edges.filter((edge) => names.has(edge.from) && names.has(edge.to)),
  };
}

function normalizeRuntimeLabel(language: string | undefined): string {
  const trimmed = (language ?? '').trim().toLowerCase();
  return trimmed === '' ? 'unknown' : trimmed;
}

function moduleRootName(source: string): string {
  if (source !== '' && source !== '<input>') {
    return `module:${source}`;
  }
  return 'module:root';
}

function countIsolatedNodes(graph: DepGraph): number {
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return graph.nodes.filter((node) => !connected.has(node.name)).length;
}

function countEdgesFrom(graph: DepGraph, name: string): number {
  return graph.edges.filter((edge) => edge.from === name).length;
}

function countEdgesTo(graph: DepGraph, name: string): number {
  return graph.edges.filter((edge) => edge.to === name).length;
}

function formatDepEdge(edge: DepEdge): string {
  if (edge.label === '') {
    return `${edge.from} -> ${edge.to}`;
  }
  return `${edge.from} -[${edge.label}]-> ${edge.to}`;
}

function formatDepGraphLines(graph: DepGraph): string[] {
  const sorted = [...graph.edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  return sorted.map(formatDepEdge);
}

function deduplicateDepEdges(edges: DepEdge[]): DepEdge[] {
  const seen = new Set<string>();
  const result: DepEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from} ${edge.to} ${edge.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}
