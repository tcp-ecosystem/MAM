import { describe, it, expect } from 'vitest';
import { JSONExporter, JSONOutput } from '../src/json.js';
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

describe('JSONExporter', () => {
  describe('constructor', () => {
    it('should create with defaults', () => {
      const exporter = new JSONExporter();
      expect(exporter).toBeInstanceOf(JSONExporter);
    });

    it('should accept partial config', () => {
      const exporter = new JSONExporter({ indent: 4, format: 'compact' });
      expect(exporter).toBeInstanceOf(JSONExporter);
    });
  });

  describe('generateFromModules (full format)', () => {
    it('should return JSONOutput with data and format', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([makeModule({ name: 'a' })]);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('format');
      expect(result.format).toBe('full');
    });

    it('should include nodes array', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([
        makeModule({ name: 'alpha', moduleType: 'agent' }),
      ]);

      const data = result.data as { nodes: Array<{ id: string; type: string }> };
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].id).toBe('alpha');
      expect(data.nodes[0].type).toBe('agent');
    });

    it('should include edges from edges array', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ]);

      const data = result.data as { edges: Array<{ from: string; to: string }> };
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].from).toBe('a');
      expect(data.edges[0].to).toBe('b');
    });

    it('should include handoff edges', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([
        makeModule({ name: 'a', handoff: ['b'] }),
      ]);

      const data = result.data as { edges: Array<{ from: string; to: string; type: string }> };
      expect(data.edges[0].type).toBe('handoff');
    });

    it('should include metadata when includeMetadata is true', () => {
      const exporter = new JSONExporter({ includeMetadata: true });
      const result = exporter.generateFromModules([makeModule({ name: 'a' })]);

      const data = result.data as { metadata: { nodeCount: number } };
      expect(data.metadata).toBeDefined();
      expect(data.metadata.nodeCount).toBe(1);
    });

    it('should exclude metadata when includeMetadata is false', () => {
      const exporter = new JSONExporter({ includeMetadata: false });
      const result = exporter.generateFromModules([makeModule({ name: 'a' })]);

      const data = result.data as Record<string, unknown>;
      expect(data.metadata).toBeUndefined();
    });
  });

  describe('generateFromModules (compact format)', () => {
    it('should output compact tuple format', () => {
      const exporter = new JSONExporter({ format: 'compact' });
      const result = exporter.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ]);

      const data = result.data as { nodes: Array<[string, string]>; edges: Array<[string, string, string]> };
      expect(data.nodes[0]).toEqual(['a', 'module']);
      expect(data.edges[0]).toEqual(['a', 'b', 'direct']);
      expect(result.format).toBe('compact');
    });
  });

  describe('generateFromModules (cytoscape format)', () => {
    it('should output Cytoscape.js element format', () => {
      const exporter = new JSONExporter({ format: 'cytoscape' });
      const result = exporter.generateFromModules([
        makeModule({ name: 'n1', moduleType: 'agent' }),
      ]);

      const data = result.data as { elements: Array<{ group: string; data: { id: string } }> };
      expect(result.format).toBe('cytoscape');
      expect(data.elements).toHaveLength(1);
      expect(data.elements[0].group).toBe('nodes');
      expect(data.elements[0].data.id).toBe('n1');
    });

    it('should include edge elements', () => {
      const exporter = new JSONExporter({ format: 'cytoscape' });
      const result = exporter.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ]);

      const data = result.data as { elements: Array<{ group: string; data: { source: string; target: string } }> };
      const edge = data.elements.find(e => e.group === 'edges');
      expect(edge).toBeDefined();
      expect(edge!.data.source).toBe('a');
      expect(edge!.data.target).toBe('b');
    });
  });

  describe('generateFromModules (d3 format)', () => {
    it('should output D3.js nodes/links format', () => {
      const exporter = new JSONExporter({ format: 'd3' });
      const result = exporter.generateFromModules([
        makeModule({ name: 'n1' }),
      ]);

      const data = result.data as { nodes: Array<{ id: string; name: string }>; links: Array<unknown> };
      expect(result.format).toBe('d3');
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].id).toBe('n1');
      expect(data.nodes[0].name).toBe('n1');
      expect(Array.isArray(data.links)).toBe(true);
    });
  });

  describe('generateFromGraph', () => {
    it('should export graph data in specified format', () => {
      const exporter = new JSONExporter({ format: 'd3' });
      const graph: GraphData = {
        nodes: [{ id: 'a', label: 'A', type: 'module' }],
        edges: [{ from: 'a', to: 'b', type: 'direct' }],
        metadata: { nodeCount: 1, edgeCount: 1, depth: 1 },
      };

      const result = exporter.generateFromGraph(graph);
      const data = result.data as { nodes: Array<{ id: string }>; links: Array<{ source: string; target: string }> };

      expect(data.nodes).toHaveLength(1);
      expect(data.links).toHaveLength(1);
      expect(data.links[0].source).toBe('a');
      expect(data.links[0].target).toBe('b');
    });
  });

  describe('generateDependencyGraph', () => {
    it('should include requires edges', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateDependencyGraph([
        makeModule({ name: 'a', requires: ['b', 'c'] }),
      ]);

      const data = result.data as { edges: Array<{ from: string; to: string }> };
      expect(data.edges).toHaveLength(2);
      expect(data.edges[0].from).toBe('a');
    });
  });

  describe('generateWorkflowGraph', () => {
    it('should create step nodes with prefixed IDs', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateWorkflowGraph([
        makeModule({
          name: 'wf',
          moduleType: 'workflow',
          steps: [
            { type: 'StepNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, name: 's1' },
          ],
        }),
      ]);

      const data = result.data as { nodes: Array<{ id: string }> };
      expect(data.nodes[0].id).toBe('wf-s1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty modules', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([]);

      const data = result.data as { nodes: unknown[]; edges: unknown[] };
      expect(data.nodes).toHaveLength(0);
      expect(data.edges).toHaveLength(0);
    });

    it('should handle modules without edges', () => {
      const exporter = new JSONExporter();
      const result = exporter.generateFromModules([makeModule({ name: 'solo' })]);

      const data = result.data as { edges: unknown[] };
      expect(data.edges).toHaveLength(0);
    });
  });
});
