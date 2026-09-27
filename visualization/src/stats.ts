import { GraphData } from './graph.js';

export interface StatsConfig {
  includeDegrees?: boolean;
  includeTypes?: boolean;
  includeDensity?: boolean;
}

interface TypeBreakdown {
  type: string;
  nodes: number;
  share: number;
}

export interface StatsOutput {
  nodeCount: number;
  edgeCount: number;
  density: number;
  averageOutDegree: number;
  maxOutDegree: number;
  isolatedNodes: string[];
  types: TypeBreakdown[];
  depth: number;
}

export function computeGraphStats(data: GraphData, config: StatsConfig = {}): StatsOutput {
  const options = {
    includeDegrees: true,
    includeTypes: true,
    includeDensity: true,
    ...config,
  };
  const outDegrees = getOutDegrees(data);
  const values = Array.from(outDegrees.values());
  const maxOutDegree = values.length === 0 ? 0 : Math.max(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    density: options.includeDensity ? getGraphDensity(data) : 0,
    averageOutDegree: data.nodes.length === 0 ? 0 : total / data.nodes.length,
    maxOutDegree: options.includeDegrees ? maxOutDegree : 0,
    isolatedNodes: findIsolatedNodes(data),
    types: options.includeTypes ? getTypeBreakdown(data) : [],
    depth: data.metadata.depth,
  };
}

export function getInDegrees(data: GraphData): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of data.nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of data.edges) {
    if (degrees.has(edge.to)) {
      degrees.set(edge.to, (degrees.get(edge.to) as number) + 1);
    }
  }
  return degrees;
}

export function getOutDegrees(data: GraphData): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of data.nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of data.edges) {
    if (degrees.has(edge.from)) {
      degrees.set(edge.from, (degrees.get(edge.from) as number) + 1);
    }
  }
  return degrees;
}

export function findIsolatedNodes(data: GraphData): string[] {
  const connected = new Set<string>();
  for (const edge of data.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return data.nodes.filter((node) => !connected.has(node.id)).map((node) => node.id);
}

export function getGraphDensity(data: GraphData): number {
  const n = data.nodes.length;
  if (n <= 1) return 0;
  const possible = n * (n - 1);
  return data.edges.length / possible;
}

function getTypeBreakdown(data: GraphData): TypeBreakdown[] {
  const counts = countNodesByType(data);
  const total = data.nodes.length;
  const breakdown: TypeBreakdown[] = [];
  for (const [type, nodes] of counts) {
    breakdown.push({ type, nodes, share: total === 0 ? 0 : nodes / total });
  }
  breakdown.sort((a, b) => b.nodes - a.nodes);
  return breakdown;
}

function countNodesByType(data: GraphData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of data.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  return counts;
}

function countEdgesByType(data: GraphData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of data.edges) {
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }
  return counts;
}

function getTotalDegree(data: GraphData, id: string): number {
  const inDegrees = getInDegrees(data);
  const outDegrees = getOutDegrees(data);
  return (inDegrees.get(id) ?? 0) + (outDegrees.get(id) ?? 0);
}

function findHubNodes(data: GraphData, minDegree: number): string[] {
  return data.nodes
    .filter((node) => getTotalDegree(data, node.id) >= minDegree)
    .map((node) => node.id);
}

function findLeafNodes(data: GraphData): string[] {
  const outDegrees = getOutDegrees(data);
  return data.nodes
    .filter((node) => (outDegrees.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
}

function findRootNodes(data: GraphData): string[] {
  const inDegrees = getInDegrees(data);
  return data.nodes
    .filter((node) => (inDegrees.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
}

function getAverageInDegree(data: GraphData): number {
  if (data.nodes.length === 0) return 0;
  let total = 0;
  for (const degree of getInDegrees(data).values()) {
    total += degree;
  }
  return total / data.nodes.length;
}

function getMaxInDegree(data: GraphData): number {
  let max = 0;
  for (const degree of getInDegrees(data).values()) {
    max = Math.max(max, degree);
  }
  return max;
}

function getDegreeHistogram(data: GraphData): Map<number, number> {
  const histogram = new Map<number, number>();
  const inDegrees = getInDegrees(data);
  const outDegrees = getOutDegrees(data);
  for (const node of data.nodes) {
    const total = (inDegrees.get(node.id) ?? 0) + (outDegrees.get(node.id) ?? 0);
    histogram.set(total, (histogram.get(total) ?? 0) + 1);
  }
  return histogram;
}

function formatStatsSummary(stats: StatsOutput): string {
  return `${stats.nodeCount} nodes, ${stats.edgeCount} edges, density ${stats.density.toFixed(3)}, ` +
    `avg out-degree ${stats.averageOutDegree.toFixed(2)}, ${stats.isolatedNodes.length} isolated`;
}

function hasSelfLoops(data: GraphData): boolean {
  return data.edges.some((edge) => edge.from === edge.to);
}

function countSelfLoops(data: GraphData): number {
  return data.edges.filter((edge) => edge.from === edge.to).length;
}

function getReciprocatedEdgeCount(data: GraphData): number {
  const pairs = new Set(data.edges.map((edge) => `${edge.from}->${edge.to}`));
  let count = 0;
  for (const edge of data.edges) {
    if (pairs.has(`${edge.to}->${edge.from}`)) {
      count++;
    }
  }
  return count;
}

function getReciprocity(data: GraphData): number {
  if (data.edges.length === 0) return 0;
  return getReciprocatedEdgeCount(data) / data.edges.length;
}

function getSelfLoopRate(data: GraphData): number {
  if (data.edges.length === 0) return 0;
  return countSelfLoops(data) / data.edges.length;
}

function getIsolationRate(data: GraphData): number {
  if (data.nodes.length === 0) return 0;
  return findIsolatedNodes(data).length / data.nodes.length;
}

function rankNodesByDegree(data: GraphData): Array<{ id: string; degree: number }> {
  const inDegrees = getInDegrees(data);
  const outDegrees = getOutDegrees(data);
  const ranked = data.nodes.map((node) => ({
    id: node.id,
    degree: (inDegrees.get(node.id) ?? 0) + (outDegrees.get(node.id) ?? 0),
  }));
  ranked.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  return ranked;
}

function getTopHubs(data: GraphData, limit: number): Array<{ id: string; degree: number }> {
  return rankNodesByDegree(data).slice(0, Math.max(0, limit));
}

function getDegreePercentile(data: GraphData, percentile: number): number {
  const ranked = rankNodesByDegree(data).map((entry) => entry.degree).sort((a, b) => a - b);
  if (ranked.length === 0) return 0;
  const clamped = Math.min(Math.max(percentile, 0), 100);
  const index = Math.min(ranked.length - 1, Math.floor((clamped / 100) * ranked.length));
  return ranked[index] as number;
}

function renderStatsTable(stats: StatsOutput): string[] {
  return [
    `nodes           ${stats.nodeCount}`,
    `edges           ${stats.edgeCount}`,
    `density         ${stats.density.toFixed(3)}`,
    `avg out-degree  ${stats.averageOutDegree.toFixed(2)}`,
    `max out-degree  ${stats.maxOutDegree}`,
    `isolated        ${stats.isolatedNodes.length}`,
    `depth           ${stats.depth}`,
  ];
}

function renderTypeBreakdownTable(stats: StatsOutput): string[] {
  return stats.types.map((entry) => {
    const pct = (entry.share * 100).toFixed(1);
    return `${entry.type}: ${entry.nodes} (${pct}%)`;
  });
}

function renderFullStatsReport(stats: StatsOutput): string {
  const lines: string[] = ['Graph Statistics', ...renderStatsTable(stats)];
  const breakdown = renderTypeBreakdownTable(stats);
  if (breakdown.length > 0) {
    lines.push('Types:', ...breakdown.map((line) => `  ${line}`));
  }
  if (stats.isolatedNodes.length > 0) {
    lines.push(`Isolated: ${stats.isolatedNodes.join(', ')}`);
  }
  return lines.join('\n');
}

function compareStatsDensities(a: StatsOutput, b: StatsOutput): number {
  return a.density - b.density;
}

function isDenserThan(a: StatsOutput, b: StatsOutput): boolean {
  return compareStatsDensities(a, b) > 0;
}

function getIsolatedNodeCount(stats: StatsOutput): number {
  return stats.isolatedNodes.length;
}

function getTypeCount(stats: StatsOutput): number {
  return stats.types.length;
}

function getDominantType(stats: StatsOutput): string | undefined {
  return stats.types[0]?.type;
}

function sumNodeCounts(stats: StatsOutput[]): number {
  return stats.reduce((total, item) => total + item.nodeCount, 0);
}

function sumEdgeCounts(stats: StatsOutput[]): number {
  return stats.reduce((total, item) => total + item.edgeCount, 0);
}

function getLargestGraphIndex(stats: StatsOutput[]): number {
  if (stats.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < stats.length; i++) {
    if ((stats[i] as StatsOutput).nodeCount > (stats[best] as StatsOutput).nodeCount) {
      best = i;
    }
  }
  return best;
}
