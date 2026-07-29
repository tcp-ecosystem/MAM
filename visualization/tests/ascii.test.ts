import { describe, it, expect } from 'vitest';
import { ASCIIArt, ASCIIOutput } from '../src/ascii.js';
import { GraphData } from '../src/graph.js';
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

describe('ASCIIArt', () => {
  describe('constructor', () => {
    it('should create with defaults', () => {
      const art = new ASCIIArt();
      expect(art).toBeInstanceOf(ASCIIArt);
    });

    it('should accept partial config', () => {
      const art = new ASCIIArt({ style: 'double', maxWidth: 120 });
      expect(art).toBeInstanceOf(ASCIIArt);
    });
  });

  describe('generateFromModules', () => {
    it('should return ASCIIOutput with art, width, height', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([makeModule({ name: 'mod1' })]);

      expect(result).toHaveProperty('art');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(typeof result.art).toBe('string');
      expect(typeof result.width).toBe('number');
      expect(typeof result.height).toBe('number');
    });

    it('should include module name in output', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([makeModule({ name: 'my-agent' })]);

      expect(result.art).toContain('my-agent');
    });

    it('should include module type when showTypes is true', () => {
      const art = new ASCIIArt({ showTypes: true });
      const result = art.generateFromModules([makeModule({ name: 'a', moduleType: 'agent' })]);

      expect(result.art).toContain('Type:');
      expect(result.art).toContain('agent');
    });

    it('should include role when present', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([
        makeModule({ name: 'a', role: 'orchestrator' }),
      ]);

      expect(result.art).toContain('orchestrator');
    });

    it('should include goal when present', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([
        makeModule({ name: 'a', goal: 'Help users' }),
      ]);

      expect(result.art).toContain('Help users');
    });

    it('should include tools when present', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([
        makeModule({ name: 'a', tools: ['search', 'calculator'] }),
      ]);

      expect(result.art).toContain('search');
      expect(result.art).toContain('calculator');
    });

    it('should show connections', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ]);

      expect(result.art).toContain('a --> b');
    });

    it('should show handoff connections', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([
        makeModule({ name: 'a', handoff: ['b'] }),
      ]);

      expect(result.art).toContain('a -.-> b');
    });

    it('should include MAM System title', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([]);

      expect(result.art).toContain('MAM System');
    });

    it('should calculate correct dimensions', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([makeModule({ name: 'x' })]);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });
  });

  describe('generateFromGraph', () => {
    it('should list nodes with types', () => {
      const art = new ASCIIArt({ showTypes: true });
      const graph: GraphData = {
        nodes: [
          { id: 'n1', label: 'Node 1', type: 'agent' },
          { id: 'n2', label: 'Node 2', type: 'tool' },
        ],
        edges: [],
        metadata: { nodeCount: 2, edgeCount: 0, depth: 0 },
      };

      const result = art.generateFromGraph(graph);

      expect(result.art).toContain('n1');
      expect(result.art).toContain('n2');
      expect(result.art).toContain('[agent]');
      expect(result.art).toContain('[tool]');
    });

    it('should list edges with labels', () => {
      const art = new ASCIIArt();
      const graph: GraphData = {
        nodes: [{ id: 'a', label: 'A', type: 'module' }],
        edges: [{ from: 'a', to: 'b', type: 'direct', label: 'calls' }],
        metadata: { nodeCount: 1, edgeCount: 1, depth: 1 },
      };

      const result = art.generateFromGraph(graph);

      expect(result.art).toContain('a --> b');
      expect(result.art).toContain('(calls)');
    });

    it('should show stats', () => {
      const art = new ASCIIArt();
      const graph: GraphData = {
        nodes: [{ id: 'a', label: 'A', type: 'module' }],
        edges: [],
        metadata: { nodeCount: 1, edgeCount: 0, depth: 0 },
      };

      const result = art.generateFromGraph(graph);

      expect(result.art).toContain('Nodes: 1');
      expect(result.art).toContain('Edges: 0');
    });

    it('should include MAM System Graph title', () => {
      const art = new ASCIIArt();
      const graph: GraphData = {
        nodes: [],
        edges: [],
        metadata: { nodeCount: 0, edgeCount: 0, depth: 0 },
      };

      const result = art.generateFromGraph(graph);

      expect(result.art).toContain('MAM System Graph');
    });
  });

  describe('empty inputs', () => {
    it('should handle empty modules array', () => {
      const art = new ASCIIArt();
      const result = art.generateFromModules([]);

      expect(result.art).toContain('MAM System');
      expect(result.width).toBeGreaterThan(0);
    });

    it('should handle empty graph', () => {
      const art = new ASCIIArt();
      const graph: GraphData = {
        nodes: [],
        edges: [],
        metadata: { nodeCount: 0, edgeCount: 0, depth: 0 },
      };
      const result = art.generateFromGraph(graph);

      expect(result.art).toContain('MAM System Graph');
    });
  });
});
