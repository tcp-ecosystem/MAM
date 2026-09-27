import { Module, Section, allCodeBlocks } from './ast.js';

/** Node in a module dependency graph. */
export interface DepNode { id: string; kind: string; label: string; }
/** Directed edge in a module dependency graph. */
export interface DepEdge { from: string; to: string; label: string; }
/** Deterministic dependency graph. */
export interface DepGraph { nodes: DepNode[]; edges: DepEdge[]; }

/** Builds a graph of frontmatter, sections, and code blocks. */
export function buildDepGraph(module: Module): DepGraph {
  const nodes: DepNode[] = [{ id: 'module', kind: 'module', label: module.frontmatter?.name || 'module' }];
  const edges: DepEdge[] = [];
  if (module.frontmatter) nodes.push({ id: 'frontmatter', kind: 'frontmatter', label: module.frontmatter.name });
  for (const section of module.sections) {
    const id = sectionId(section, section.title);
    nodes.push({ id, kind: 'section', label: section.title });
    edges.push({ from: 'module', to: id, label: 'contains' });
    for (const block of section.content.filter((node) => node.kind === 'CodeBlock')) edges.push({ from: id, to: `${id}:code`, label: block.language || 'unknown' });
    if (section.content.some((node) => node.kind === 'CodeBlock')) nodes.push({ id: `${id}:code`, kind: 'code', label: section.title });
  }
  return { nodes, edges };
}

/** Returns deterministic node names. */
export function nodeNames(graph: DepGraph): string[] {
  return graph.nodes.map((node) => node.id);
}

/** Returns deterministic topological order or throws on a cycle. */
export function topologicalSort(graph: DepGraph): string[] {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) { outgoing.get(edge.from)?.push(edge.to); indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1); }
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const result: string[] = [];
  while (ready.length) { const id = ready.shift() as string; result.push(id); for (const next of (outgoing.get(id) ?? []).sort()) { const count = (indegree.get(next) ?? 1) - 1; indegree.set(next, count); if (count === 0) { ready.push(next); ready.sort(); } } }
  if (result.length !== graph.nodes.length) throw new Error('dependency graph contains a cycle');
  return result;
}

/** Returns direct successors of a node. */
export function successors(graph: DepGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to).sort();
}

/** Returns direct predecessors of a node. */
export function predecessors(graph: DepGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from).sort();
}

/** Reports whether a directed edge exists. */
export function hasEdge(graph: DepGraph, from: string, to: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to);
}

/** Returns edge labels for a node. */
export function edgeLabels(graph: DepGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.from === id || edge.to === id).map((edge) => edge.label).sort();
}

/** Returns nodes without incoming edges. */
export function rootNodes(graph: DepGraph): DepNode[] {
  return graph.nodes.filter((node) => predecessors(graph, node.id).length === 0);
}

/** Returns nodes without outgoing edges. */
export function leafNodes(graph: DepGraph): DepNode[] {
  return graph.nodes.filter((node) => successors(graph, node.id).length === 0);
}

/** Returns nodes of a given kind. */
export function nodesOfType(graph: DepGraph, kind: string): DepNode[] {
  return graph.nodes.filter((node) => node.kind === kind);
}

/** Counts nodes by kind. */
export function countNodesByType(graph: DepGraph): Record<string, number> {
  return graph.nodes.reduce<Record<string, number>>((counts, node) => { counts[node.kind] = (counts[node.kind] ?? 0) + 1; return counts; }, {});
}

/** Counts edges by label. */
export function countEdgesByLabel(graph: DepGraph): Record<string, number> {
  return graph.edges.reduce<Record<string, number>>((counts, edge) => { counts[edge.label] = (counts[edge.label] ?? 0) + 1; return counts; }, {});
}

/** Returns reachable nodes from a starting node. */
export function reachableFrom(graph: DepGraph, start: string): string[] {
  const seen = new Set<string>(); const queue = [start];
  while (queue.length) { const id = queue.shift() as string; if (seen.has(id) || !graph.nodes.some((node) => node.id === id)) continue; seen.add(id); queue.push(...successors(graph, id)); }
  return [...seen].sort();
}

/** Returns a one-line graph summary. */
export function summarizeGraph(graph: DepGraph): string {
  return `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
}

/** Formats a graph as plain text. */
export function formatGraph(graph: DepGraph): string {
  return graph.nodes.map((node) => `${node.id} (${node.kind}) -> ${successors(graph, node.id).join(', ') || 'leaf'}`).join('\n');
}

/** Returns a graph with duplicate nodes and edges removed. */
export function dedupeGraph(graph: DepGraph): DepGraph {
  const seenNodes = new Set<string>(); const seenEdges = new Set<string>();
  return { nodes: graph.nodes.filter((node) => !seenNodes.has(node.id) && (seenNodes.add(node.id), true)), edges: graph.edges.filter((edge) => { const key = `${edge.from}\u0000${edge.to}\u0000${edge.label}`; if (seenEdges.has(key)) return false; seenEdges.add(key); return true; }) };
}

/** Returns a graph after pruning edges to absent nodes. */
export function pruneDanglingEdges(graph: DepGraph): DepGraph {
  const ids = new Set(nodeNames(graph));
  return { nodes: graph.nodes, edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}

/** Returns all code-block language nodes for a module. */
export function codeLanguages(module: Module): string[] {
  return [...new Set(allCodeBlocks(module).map((block) => block.language || 'unknown'))];
}

/** Creates a standalone graph node. */
export function makeNode(id: string, kind = 'node', label = id): DepNode {
  return { id, kind, label };
}

/** Creates a standalone graph edge. */
export function makeEdge(from: string, to: string, label = 'depends'): DepEdge {
  return { from, to, label };
}

/** Returns whether a node exists. */
export function hasNode(graph: DepGraph, id: string): boolean {
  return graph.nodes.some((node) => node.id === id);
}

/** Returns a node kind or undefined. */
export function nodeType(graph: DepGraph, id: string): string | undefined {
  return graph.nodes.find((node) => node.id === id)?.kind;
}

/** Returns all edges in stable order. */
export function sortedEdges(graph: DepGraph): DepEdge[] {
  return [...graph.edges].sort((a, b) => `${a.from}${a.to}${a.label}`.localeCompare(`${b.from}${b.to}${b.label}`));
}

/** Builds a minimal empty graph. */
export function emptyGraph(): DepGraph {
  return { nodes: [], edges: [] };
}

/** Returns a graph's node labels. */
export function nodeLabels(graph: DepGraph): string[] {
  return graph.nodes.map((node) => node.label);
}

/** Returns a graph's edge labels. */
export function edgeLabelList(graph: DepGraph): string[] {
  return graph.edges.map((edge) => edge.label);
}

/** Returns a node by identifier. */
export function nodeById(graph: DepGraph, id: string): DepNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

/** Returns edges touching a node. */
export function incidentEdges(graph: DepGraph, id: string): DepEdge[] {
  return graph.edges.filter((edge) => edge.from === id || edge.to === id);
}

/** Reports whether a graph has any nodes. */
export function graphIsEmpty(graph: DepGraph): boolean {
  return graph.nodes.length === 0;
}

/** Returns a sorted list of graph node identifiers. */
export function sortedNodeNames(graph: DepGraph): string[] {
  return nodeNames(graph).sort();
}

/** Returns a sorted list of graph edge keys. */
export function edgeKeys(graph: DepGraph): string[] {
  return graph.edges.map((edge) => `${edge.from}->${edge.to}`).sort();
}

/** Returns only section nodes. */
export function sectionNodes(graph: DepGraph): DepNode[] {
  return nodesOfType(graph, 'section');
}

/** Returns only code nodes. */
export function codeNodes(graph: DepGraph): DepNode[] {
  return nodesOfType(graph, 'code');
}

/** Returns edges in a label-specific order. */
export function edgesWithLabel(graph: DepGraph, label: string): DepEdge[] {
  return graph.edges.filter((edge) => edge.label === label);
}

/** Returns a graph summary with node kinds. */
export function graphTypeSummary(graph: DepGraph): string {
  return Object.entries(countNodesByType(graph)).map(([kind, count]) => `${kind}=${count}`).join(', ') || 'empty';
}

/** Returns a safe deterministic JSON graph. */
export function graphJSON(graph: DepGraph): string {
  return JSON.stringify({ nodes: graph.nodes, edges: [...graph.edges].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)) }, null, 2);
}

/** Reports whether a node can reach a target. */
export function canReach(graph: DepGraph, from: string, to: string): boolean {
  return reachableFrom(graph, from).includes(to);
}

/** Returns a graph with edges sorted deterministically. */
export function sortGraph(graph: DepGraph): DepGraph {
  return { nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: sortedEdges(graph) };
}

/** Returns a shallow node map. */
export function nodeMap(graph: DepGraph): Map<string, DepNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

/** Returns all root and leaf node labels. */
export function graphBoundaryLabels(graph: DepGraph): string[] {
  return [...rootNodes(graph), ...leafNodes(graph)].map((node) => node.label);
}

/** Returns a compact edge count for a node. */
export function degree(graph: DepGraph, id: string): number {
  return incidentEdges(graph, id).length;
}

/** Returns whether two graphs have the same node identifiers. */
export function sameNodes(left: DepGraph, right: DepGraph): boolean {
  return nodeNames(left).sort().join('\u0000') === nodeNames(right).sort().join('\u0000');
}

/** Returns a module graph's section count. */
export function graphSectionCount(graph: DepGraph): number {
  return sectionNodes(graph).length;
}

/** Returns a graph with one node added. */
export function addNode(graph: DepGraph, node: DepNode): DepGraph {
  return hasNode(graph, node.id) ? graph : { nodes: [...graph.nodes, node], edges: graph.edges };
}

/** Returns a graph with one edge added. */
export function addEdge(graph: DepGraph, edge: DepEdge): DepGraph {
  return hasEdge(graph, edge.from, edge.to) ? graph : { nodes: graph.nodes, edges: [...graph.edges, edge] };
}

/** Returns a graph suitable for tests. */
export function sampleGraph(): DepGraph {
  return { nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('a', 'b')] };
}

/** Returns a graph with nodes and edges sorted. */
export function canonicalGraph(graph: DepGraph): DepGraph {
  return sortGraph(dedupeGraph(pruneDanglingEdges(graph)));
}

/** Returns the number of distinct edge labels. */
export function edgeLabelCount(graph: DepGraph): number {
  return new Set(graph.edges.map((edge) => edge.label)).size;
}

/** Returns a graph's maximum degree. */
export function maxDegree(graph: DepGraph): number {
  return graph.nodes.reduce((max, node) => Math.max(max, degree(graph, node.id)), 0);
}

/** Returns whether a graph has a cycle. */
export function graphHasCycle(graph: DepGraph): boolean {
  try { topologicalSort(graph); return false; } catch { return true; }
}

/** Returns a safe topological order fallback. */
export function safeTopologicalSort(graph: DepGraph): string[] {
  return graphHasCycle(graph) ? nodeNames(graph).sort() : topologicalSort(graph);
}

/** Returns a node's outgoing labels. */
export function outgoingLabels(graph: DepGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.from === id).map((edge) => edge.label).sort();
}

/** Returns a node's incoming labels. */
export function incomingLabels(graph: DepGraph, id: string): string[] {
  return graph.edges.filter((edge) => edge.to === id).map((edge) => edge.label).sort();
}

/** Returns a simple graph with no dangling edges. */
export function normalizedGraph(graph: DepGraph): DepGraph {
  return pruneDanglingEdges(dedupeGraph(graph));
}

/** Returns the graph's module node. */
export function moduleNode(graph: DepGraph): DepNode | undefined {
  return nodesOfType(graph, 'module')[0];
}

/** Returns whether an edge is self-referential. */
export function isSelfEdge(edge: DepEdge): boolean {
  return edge.from === edge.to;
}

/** Returns a count of self edges. */
export function selfEdgeCount(graph: DepGraph): number {
  return graph.edges.filter(isSelfEdge).length;
}

/** Returns a graph text report with a header. */
export function graphReport(graph: DepGraph): string {
  return `${summarizeGraph(graph)}\n${formatGraph(graph)}`;
}

/** Returns a safe graph node label. */
export function safeNodeLabel(label: string): string {
  return label.trim() || '(unnamed)';
}

function sectionId(section: Section, fallback: string): string {
  return `section:${section.kind}:${fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}
