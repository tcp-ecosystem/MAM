import { describe, it, expect } from 'vitest';
import { MermaidGenerator, MermaidOutput } from '../src/mermaid.js';
import { GraphData, GraphNode, GraphEdge } from '../src/graph.js';
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

describe('MermaidGenerator', () => {
  describe('constructor', () => {
    it('should create with defaults', () => {
      const gen = new MermaidGenerator();
      expect(gen).toBeInstanceOf(MermaidGenerator);
    });

    it('should accept partial config', () => {
      const gen = new MermaidGenerator({ direction: 'LR', styleByType: false });
      expect(gen).toBeInstanceOf(MermaidGenerator);
    });
  });

  describe('generateFromModules', () => {
    it('should output flowchart header', () => {
      const gen = new MermaidGenerator();
      const result = gen.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.code).toContain('flowchart TD');
      expect(result.type).toBe('flowchart');
    });

    it('should include node definitions', () => {
      const gen = new MermaidGenerator({ showTypes: true });
      const modules = [
        makeModule({ name: 'agent1', moduleType: 'agent' }),
        makeModule({ name: 'tool1', moduleType: 'tool' }),
      ];
      const result = gen.generateFromModules(modules);

      expect(result.code).toContain('agent1');
      expect(result.code).toContain('tool1');
      expect(result.code).toContain('[agent]');
      expect(result.code).toContain('[tool]');
    });

    it('should generate edges from module edges', () => {
      const gen = new MermaidGenerator();
      const modules = [
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b', label: 'calls' }],
        }),
      ];
      const result = gen.generateFromModules(modules);

      expect(result.code).toContain('a --> b');
    });

    it('should generate handoff edges with dashed style', () => {
      const gen = new MermaidGenerator();
      const modules = [
        makeModule({ name: 'a', handoff: ['b'] }),
      ];
      const result = gen.generateFromModules(modules);

      expect(result.code).toContain('a -.-> b');
    });

    it('should count nodes and edges correctly', () => {
      const gen = new MermaidGenerator();
      const modules = [
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
          handoff: ['c'],
        }),
        makeModule({ name: 'b' }),
      ];
      const result = gen.generateFromModules(modules);

      expect(result.nodeCount).toBe(2);
      expect(result.edgeCount).toBe(2);
    });

    it('should use LR direction when configured', () => {
      const gen = new MermaidGenerator({ direction: 'LR' });
      const result = gen.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.code).toContain('flowchart LR');
    });

    it('should omit type labels when showTypes is false', () => {
      const gen = new MermaidGenerator({ showTypes: false });
      const result = gen.generateFromModules([makeModule({ name: 'x', moduleType: 'agent' })]);

      expect(result.code).not.toContain('[agent]');
    });
  });

  describe('generateFromGraph', () => {
    it('should render nodes and edges from GraphData', () => {
      const gen = new MermaidGenerator();
      const graph: GraphData = {
        nodes: [
          { id: 'n1', label: 'Node 1', type: 'agent' },
          { id: 'n2', label: 'Node 2', type: 'tool' },
        ],
        edges: [
          { from: 'n1', to: 'n2', type: 'direct', label: 'uses' },
        ],
        metadata: { nodeCount: 2, edgeCount: 1, depth: 1 },
      };

      const result = gen.generateFromGraph(graph);

      expect(result.code).toContain('n1');
      expect(result.code).toContain('n2');
      expect(result.code).toContain('n1 -->|"uses"| n2');
      expect(result.nodeCount).toBe(2);
      expect(result.edgeCount).toBe(1);
    });

    it('should use correct edge styles by type', () => {
      const gen = new MermaidGenerator();
      const graph: GraphData = {
        nodes: [{ id: 'a', label: 'A', type: 'module' }],
        edges: [
          { from: 'a', to: 'a', type: 'handoff' },
          { from: 'a', to: 'a', type: 'dependency' },
        ],
        metadata: { nodeCount: 1, edgeCount: 2, depth: 0 },
      };

      const result = gen.generateFromGraph(graph);

      expect(result.code).toContain('a -.-> a');
      expect(result.code).toContain('a --> a');
    });

    it('should apply node shapes by type', () => {
      const gen = new MermaidGenerator();
      const graph: GraphData = {
        nodes: [
          { id: 'agent', label: 'Agent', type: 'agent' },
          { id: 'tool', label: 'Tool', type: 'tool' },
          { id: 'mem', label: 'Memory', type: 'memory' },
          { id: 'wf', label: 'Workflow', type: 'workflow' },
        ],
        edges: [],
        metadata: { nodeCount: 4, edgeCount: 0, depth: 0 },
      };

      const result = gen.generateFromGraph(graph);

      // Agent uses stadium shape ([ ])
      expect(result.code).toContain('(["Agent"])');
      // Tool uses subroutine shape ([[ ]])
      expect(result.code).toContain('[["Tool"]');
      // Memory uses cylinder shape ([(())])
      expect(result.code).toContain('[(("Memory"))]');
    });
  });

  describe('edge cases', () => {
    it('should handle empty modules array', () => {
      const gen = new MermaidGenerator();
      const result = gen.generateFromModules([]);

      expect(result.code).toContain('flowchart TD');
      expect(result.nodeCount).toBe(0);
      expect(result.edgeCount).toBe(0);
    });

    it('should handle empty graph', () => {
      const gen = new MermaidGenerator();
      const graph: GraphData = {
        nodes: [],
        edges: [],
        metadata: { nodeCount: 0, edgeCount: 0, depth: 0 },
      };
      const result = gen.generateFromGraph(graph);

      expect(result.nodeCount).toBe(0);
    });
  });
});
