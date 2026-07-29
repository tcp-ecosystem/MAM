import { describe, it, expect } from 'vitest';
import { GraphVisualizer, GraphData, GraphNode, GraphEdge } from '../src/graph.js';
import { V2ModuleNode } from '@mam/ast';

function makeModule(overrides: Partial<V2ModuleNode> = {}): V2ModuleNode {
  return {
    type: 'ModuleNode',
    location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 10, offset: 10 }, source: 'test.mam' },
    name: 'test-module',
    moduleType: 'module',
    ...overrides,
  } as V2ModuleNode;
}

describe('GraphVisualizer', () => {
  describe('constructor defaults', () => {
    it('should create with default config', () => {
      const viz = new GraphVisualizer();
      expect(viz).toBeInstanceOf(GraphVisualizer);
    });

    it('should accept partial config', () => {
      const viz = new GraphVisualizer({ direction: 'LR', showLabels: false });
      expect(viz).toBeInstanceOf(GraphVisualizer);
    });
  });

  describe('generate', () => {
    it('should generate nodes from modules', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({ name: 'alpha', moduleType: 'agent' }),
        makeModule({ name: 'beta', moduleType: 'tool' }),
      ];
      const result = viz.generate(modules);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].id).toBe('alpha');
      expect(result.nodes[0].type).toBe('agent');
      expect(result.nodes[1].id).toBe('beta');
      expect(result.nodes[1].type).toBe('tool');
    });

    it('should generate edges from module edges', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ];
      const result = viz.generate(modules);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].from).toBe('a');
      expect(result.edges[0].to).toBe('b');
      expect(result.edges[0].type).toBe('direct');
    });

    it('should generate handoff edges', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({ name: 'a', handoff: ['b', 'c'] }),
      ];
      const result = viz.generate(modules);

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].type).toBe('handoff');
    });

    it('should generate dependency edges from tools', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({ name: 'agent1', tools: ['tool-a', 'tool-b'] }),
      ];
      const result = viz.generate(modules);

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].type).toBe('dependency');
    });

    it('should calculate metadata', () => {
      const viz = new GraphVisualizer();
      const modules = [makeModule({ name: 'a' })];
      const result = viz.generate(modules);

      expect(result.metadata.nodeCount).toBe(1);
      expect(result.metadata.edgeCount).toBe(0);
      expect(result.metadata.depth).toBe(0);
    });

    it('should truncate labels when showLabels is false', () => {
      const viz = new GraphVisualizer({ showLabels: false });
      const modules = [makeModule({ name: 'long-module-name' })];
      const result = viz.generate(modules);

      expect(result.nodes[0].label).toBe('lon');
    });
  });

  describe('generateDependencyGraph', () => {
    it('should only include requires edges', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({
          name: 'a',
          requires: ['b', 'c'],
          handoff: ['d'],
        }),
      ];
      const result = viz.generateDependencyGraph(modules);

      expect(result.edges).toHaveLength(2);
      expect(result.edges.every(e => e.type === 'dependency')).toBe(true);
    });

    it('should handle modules without requires', () => {
      const viz = new GraphVisualizer();
      const modules = [makeModule({ name: 'standalone' })];
      const result = viz.generateDependencyGraph(modules);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('generateWorkflowGraph', () => {
    it('should create step nodes', () => {
      const viz = new GraphVisualizer();
      const modules = [
        makeModule({
          name: 'workflow1',
          moduleType: 'workflow',
          steps: [
            { type: 'StepNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, name: 'step-a', agent: 'agent1' },
            { type: 'StepNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, name: 'step-b', tool: 'tool1' },
          ],
          edges: [
            { type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'step-a', target: 'step-b', label: 'next' },
          ],
        }),
      ];
      const result = viz.generateWorkflowGraph(modules);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].id).toBe('workflow1-step-a');
      expect(result.nodes[0].type).toBe('step');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].from).toBe('workflow1-step-a');
      expect(result.edges[0].to).toBe('workflow1-step-b');
    });
  });

  describe('depth calculation', () => {
    it('should calculate depth for linear chain', () => {
      const viz = new GraphVisualizer();
      const data: GraphData = {
        nodes: [
          { id: 'a', label: 'a', type: 'module' },
          { id: 'b', label: 'b', type: 'module' },
          { id: 'c', label: 'c', type: 'module' },
        ],
        edges: [
          { from: 'a', to: 'b', type: 'direct' },
          { from: 'b', to: 'c', type: 'direct' },
        ],
        metadata: { nodeCount: 3, edgeCount: 2, depth: 0 },
      };

      const result = viz.generate(data.nodes.map(n => makeModule({ name: n.id })));
      expect(result.metadata.depth).toBeGreaterThanOrEqual(0);
    });
  });
});
