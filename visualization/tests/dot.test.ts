import { describe, it, expect } from 'vitest';
import {
  DOTRenderer,
  DOTOutput,
  sanitizeDotId,
  countDotNodes,
  countDotEdges,
  extractDotNodeIds,
  hasDotNode,
  validateDotBraces,
  getDotRankdirLine,
} from '../src/dot.js';
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

describe('DOTRenderer', () => {
  describe('constructor', () => {
    it('should create with defaults', () => {
      const renderer = new DOTRenderer();
      expect(renderer).toBeInstanceOf(DOTRenderer);
    });

    it('should accept partial config', () => {
      const renderer = new DOTRenderer({ rankdir: 'LR', dpi: 150, format: 'png' });
      expect(renderer).toBeInstanceOf(DOTRenderer);
    });
  });

  describe('generateFromModules', () => {
    it('should return DOTOutput with dot and format', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result).toHaveProperty('dot');
      expect(result).toHaveProperty('format');
      expect(typeof result.dot).toBe('string');
      expect(result.format).toBe('svg');
    });

    it('should produce valid DOT syntax', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([makeModule({ name: 'mymod' })]);

      expect(result.dot).toContain('digraph MAM {');
      expect(result.dot).toContain('}');
      expect(result.dot).toContain('"mymod"');
    });

    it('should include graph attributes', () => {
      const renderer = new DOTRenderer({ rankdir: 'LR', ranksep: 2.0, nodesep: 1.5, dpi: 150 });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.dot).toContain('rankdir=LR');
      expect(result.dot).toContain('ranksep=2');
      expect(result.dot).toContain('nodesep=1.5');
      expect(result.dot).toContain('dpi=150');
    });

    it('should include node styles with colors', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([
        makeModule({ name: 'agent1', moduleType: 'agent' }),
      ]);

      expect(result.dot).toContain('fillcolor=');
      expect(result.dot).toContain('style="filled"');
    });

    it('should include edge definitions', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b', label: 'calls' }],
        }),
      ]);

      expect(result.dot).toContain('->');
      expect(result.dot).toContain('"calls"');
    });

    it('should style handoff edges with dashed lines', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([
        makeModule({ name: 'a', handoff: ['b'] }),
      ]);

      expect(result.dot).toContain('style="dashed"');
    });

    it('should escape special characters in node names', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateFromModules([
        makeModule({ name: 'node-with-"quotes"' }),
      ]);

      expect(result.dot).toContain('\\"');
    });
  });

  describe('generateFromGraph', () => {
    it('should render nodes and edges from GraphData', () => {
      const renderer = new DOTRenderer();
      const graph: GraphData = {
        nodes: [
          { id: 'n1', label: 'Node 1', type: 'agent', metadata: { role: 'helper' } },
          { id: 'n2', label: 'Node 2', type: 'tool' },
        ],
        edges: [{ from: 'n1', to: 'n2', type: 'direct', label: 'uses' }],
        metadata: { nodeCount: 2, edgeCount: 1, depth: 1 },
      };

      const result = renderer.generateFromGraph(graph);

      expect(result.dot).toContain('n1');
      expect(result.dot).toContain('n2');
      expect(result.dot).toContain('"uses"');
    });

    it('should include tooltips from metadata', () => {
      const renderer = new DOTRenderer();
      const graph: GraphData = {
        nodes: [{ id: 'a', label: 'A', type: 'agent', metadata: { role: 'orchestrator', goal: 'Help users' } }],
        edges: [],
        metadata: { nodeCount: 1, edgeCount: 0, depth: 0 },
      };

      const result = renderer.generateFromGraph(graph);

      expect(result.dot).toContain('tooltip=');
      expect(result.dot).toContain('orchestrator');
    });
  });

  describe('generateDependencyGraph', () => {
    it('should include requires edges', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateDependencyGraph([
        makeModule({ name: 'a', requires: ['b'] }),
      ]);

      expect(result.dot).toContain('a -> b');
    });
  });

  describe('generateWorkflowGraph', () => {
    it('should create step nodes with prefixed IDs', () => {
      const renderer = new DOTRenderer();
      const result = renderer.generateWorkflowGraph([
        makeModule({
          name: 'wf',
          moduleType: 'workflow',
          steps: [
            { type: 'StepNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, name: 's1' },
          ],
          edges: [
            { type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 's1', target: 's2' },
          ],
        }),
      ]);

      expect(result.dot).toContain('wf-s1');
    });
  });

  describe('config', () => {
    it('should use configured format', () => {
      const renderer = new DOTRenderer({ format: 'png' });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.format).toBe('png');
    });

    it('should use type-specific shape over config default', () => {
      const renderer = new DOTRenderer({ nodeShape: 'circle' });
      const result = renderer.generateFromModules([makeModule({ name: 'a', moduleType: 'module' })]);

      // module type maps to 'box' in TYPE_SHAPES, which takes precedence
      expect(result.dot).toContain('shape=box');
    });
  });
});

describe('dot output helpers', () => {
  const output: DOTOutput = {
    dot: 'digraph {\n  rankdir=LR;\n  alpha [label="Alpha"];\n  beta [label="Beta"];\n  alpha -> beta;\n}',
    format: 'svg',
  };

  it('should sanitize ids', () => {
    expect(sanitizeDotId('my-module')).toBe('my_module');
    expect(sanitizeDotId('')).toBe('node');
    expect(sanitizeDotId('9x')).toBe('n_9x');
  });

  it('should count nodes and edges', () => {
    expect(countDotNodes(output)).toBe(2);
    expect(countDotEdges(output)).toBe(1);
    expect(countDotNodes({ dot: '', format: 'svg' })).toBe(0);
  });

  it('should extract node ids', () => {
    expect(extractDotNodeIds(output)).toEqual(['alpha', 'beta']);
  });

  it('should check node presence', () => {
    expect(hasDotNode(output, 'alpha')).toBe(true);
    expect(hasDotNode(output, 'gamma')).toBe(false);
  });

  it('should validate braces', () => {
    expect(validateDotBraces(output)).toBe(true);
    expect(validateDotBraces({ dot: 'digraph {', format: 'svg' })).toBe(false);
    expect(validateDotBraces({ dot: '}', format: 'svg' })).toBe(false);
  });

  it('should build rankdir lines', () => {
    expect(getDotRankdirLine('LR')).toBe('rankdir=LR;');
  });

  it('should analyze real renderer output', () => {
    const renderer = new DOTRenderer();
    const result = renderer.generateFromModules([makeModule({ name: 'solo' })]);
    expect(validateDotBraces(result)).toBe(true);
    expect(hasDotNode(result, 'solo')).toBe(true);
  });
});
