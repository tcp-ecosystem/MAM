import { describe, it, expect } from 'vitest';
import {
  computeGraphStats,
  getInDegrees,
  getOutDegrees,
  findIsolatedNodes,
  getGraphDensity,
} from '../src/stats.js';
import { GraphData } from '../src/graph.js';

const graph: GraphData = {
  nodes: [
    { id: 'a', label: 'A', type: 'agent' },
    { id: 'b', label: 'B', type: 'tool' },
    { id: 'c', label: 'C', type: 'agent' },
    { id: 'lonely', label: 'L', type: 'memory' },
  ],
  edges: [
    { from: 'a', to: 'b', type: 'direct' },
    { from: 'b', to: 'c', type: 'handoff' },
    { from: 'a', to: 'c', type: 'dependency' },
  ],
  metadata: { nodeCount: 4, edgeCount: 3, depth: 2 },
};

describe('computeGraphStats', () => {
  it('should compute full statistics', () => {
    const stats = computeGraphStats(graph);

    expect(stats.nodeCount).toBe(4);
    expect(stats.edgeCount).toBe(3);
    expect(stats.density).toBeCloseTo(3 / 12);
    expect(stats.maxOutDegree).toBe(2);
    expect(stats.averageOutDegree).toBeCloseTo(0.75);
    expect(stats.isolatedNodes).toEqual(['lonely']);
    expect(stats.depth).toBe(2);
    expect(stats.types[0]).toEqual({ type: 'agent', nodes: 2, share: 0.5 });
  });

  it('should respect config flags', () => {
    const stats = computeGraphStats(graph, { includeDegrees: false, includeTypes: false, includeDensity: false });

    expect(stats.maxOutDegree).toBe(0);
    expect(stats.types).toEqual([]);
    expect(stats.density).toBe(0);
  });

  it('should handle empty graphs', () => {
    const stats = computeGraphStats({ nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, depth: 0 } });

    expect(stats.nodeCount).toBe(0);
    expect(stats.density).toBe(0);
    expect(stats.averageOutDegree).toBe(0);
    expect(stats.isolatedNodes).toEqual([]);
  });
});

describe('getInDegrees / getOutDegrees', () => {
  it('should count incoming edges', () => {
    const degrees = getInDegrees(graph);
    expect(degrees.get('a')).toBe(0);
    expect(degrees.get('c')).toBe(2);
  });

  it('should count outgoing edges', () => {
    const degrees = getOutDegrees(graph);
    expect(degrees.get('a')).toBe(2);
    expect(degrees.get('lonely')).toBe(0);
  });

  it('should ignore dangling endpoints', () => {
    const data: GraphData = {
      nodes: [{ id: 'a', label: 'A', type: 'agent' }],
      edges: [{ from: 'a', to: 'ghost', type: 'direct' }],
      metadata: { nodeCount: 1, edgeCount: 1, depth: 1 },
    };
    expect(getInDegrees(data).get('ghost')).toBeUndefined();
    expect(getOutDegrees(data).get('a')).toBe(1);
  });
});

describe('findIsolatedNodes', () => {
  it('should find disconnected nodes', () => {
    expect(findIsolatedNodes(graph)).toEqual(['lonely']);
    expect(findIsolatedNodes({ nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, depth: 0 } })).toEqual([]);
  });
});

describe('getGraphDensity', () => {
  it('should compute density', () => {
    expect(getGraphDensity(graph)).toBeCloseTo(3 / 12);
    expect(getGraphDensity({ nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, depth: 0 } })).toBe(0);
    expect(getGraphDensity({
      nodes: [{ id: 'a', label: 'A', type: 'agent' }],
      edges: [],
      metadata: { nodeCount: 1, edgeCount: 0, depth: 0 },
    })).toBe(0);
  });

  it('should reach 1 for complete graphs', () => {
    const complete: GraphData = {
      nodes: [
        { id: 'a', label: 'A', type: 'agent' },
        { id: 'b', label: 'B', type: 'tool' },
      ],
      edges: [
        { from: 'a', to: 'b', type: 'direct' },
        { from: 'b', to: 'a', type: 'direct' },
      ],
      metadata: { nodeCount: 2, edgeCount: 2, depth: 1 },
    };
    expect(getGraphDensity(complete)).toBe(1);
  });
});
