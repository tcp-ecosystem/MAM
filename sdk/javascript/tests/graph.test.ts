import { describe, it, expect } from 'vitest';
import {
  buildDepGraph,
  topoSortDepGraph,
  getDepNodeNames,
  summarizeDepGraph,
  getDepSuccessors,
  getDepPredecessors,
  hasDepEdge,
  getDepEdgeLabels,
  getDepNodesOfType,
  countDepEdgesByLabel,
  countDepNodesByType,
  hasDepNode,
  getDepNodeType,
} from '../mam/graph.js';
import { parseMAM } from '../mam/parser.js';

const FIXTURE = `---
title: Graph Me
version: 2.0.0
---

## Purpose

A module for graphs.

## Python

\`\`\`python
print('hi')
\`\`\`
`;

describe('buildDepGraph', () => {
  it('builds nodes and edges from a module', () => {
    const graph = buildDepGraph(parseMAM(FIXTURE).ast);
    const names = getDepNodeNames(graph);
    expect(names).toContain('Purpose');
    expect(names).toContain('Python');
    expect(names).toContain('runtime:python');
    expect(names).toContain('frontmatter');
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('builds an empty graph for an empty module', () => {
    const graph = buildDepGraph(parseMAM('').ast);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges.length).toBe(0);
  });

  it('deduplicates edges', () => {
    const graph = buildDepGraph(parseMAM(FIXTURE).ast);
    const keys = graph.edges.map((edge) => `${edge.from}->${edge.to}->${edge.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('topoSortDepGraph', () => {
  it('sorts a linear chain', () => {
    const graph = {
      nodes: [{ name: 'a', type: 'x' }, { name: 'b', type: 'x' }, { name: 'c', type: 'x' }],
      edges: [
        { from: 'a', to: 'b', label: '' },
        { from: 'b', to: 'c', label: '' },
      ],
    };
    const order = topoSortDepGraph(graph);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws on cycles', () => {
    const graph = {
      nodes: [{ name: 'a', type: 'x' }, { name: 'b', type: 'x' }],
      edges: [
        { from: 'a', to: 'b', label: '' },
        { from: 'b', to: 'a', label: '' },
      ],
    };
    expect(() => topoSortDepGraph(graph)).toThrow(/cycle/i);
  });

  it('handles empty graphs', () => {
    expect(topoSortDepGraph({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('graph queries', () => {
  const graph = {
    nodes: [
      { name: 'a', type: 'agent' },
      { name: 'b', type: 'tool' },
      { name: 'c', type: 'memory' },
    ],
    edges: [
      { from: 'a', to: 'b', label: 'uses' },
      { from: 'a', to: 'c', label: 'reads' },
      { from: 'b', to: 'c', label: 'writes' },
    ],
  };

  it('lists successors and predecessors', () => {
    expect(getDepSuccessors(graph, 'a')).toEqual(['b', 'c']);
    expect(getDepPredecessors(graph, 'c')).toEqual(['a', 'b']);
    expect(getDepSuccessors(graph, 'c')).toEqual([]);
  });

  it('checks edges and reads labels', () => {
    expect(hasDepEdge(graph, 'a', 'b')).toBe(true);
    expect(hasDepEdge(graph, 'b', 'a')).toBe(false);
    expect(getDepEdgeLabels(graph, 'a', 'c')).toEqual(['reads']);
  });

  it('filters nodes by type', () => {
    expect(getDepNodesOfType(graph, 'tool')).toEqual([{ name: 'b', type: 'tool' }]);
    expect(countDepNodesByType(graph, 'agent')).toBe(1);
  });

  it('counts edges by label', () => {
    expect(countDepEdgesByLabel(graph, 'uses')).toBe(1);
    expect(countDepEdgesByLabel(graph, 'missing')).toBe(0);
  });

  it('looks up nodes and types', () => {
    expect(hasDepNode(graph, 'a')).toBe(true);
    expect(hasDepNode(graph, 'zzz')).toBe(false);
    expect(getDepNodeType(graph, 'b')).toBe('tool');
    expect(getDepNodeType(graph, 'zzz')).toBeUndefined();
  });

  it('summarizes the graph', () => {
    const summary = summarizeDepGraph(graph);
    expect(summary).toContain('3 nodes');
    expect(summary).toContain('3 edges');
    expect(summary).toContain('roots');
  });
});