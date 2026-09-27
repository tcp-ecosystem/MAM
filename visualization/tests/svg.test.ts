import { describe, it, expect } from 'vitest';
import {
  SVGRenderer,
  SVGOutput,
  DEFAULT_SVG_COLORS,
  getSvgColorForType,
  sanitizeSvgId,
  createSvgDocument,
} from '../src/svg.js';
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

const graph: GraphData = {
  nodes: [
    { id: 'a', label: 'A', type: 'agent' },
    { id: 'b', label: 'B', type: 'tool' },
  ],
  edges: [{ from: 'a', to: 'b', label: 'uses', type: 'direct' }],
  metadata: { nodeCount: 2, edgeCount: 1, depth: 1 },
};

describe('SVGRenderer', () => {
  it('should render svg documents from modules', () => {
    const renderer = new SVGRenderer();
    const result = renderer.generateFromModules([makeModule({ name: 'alpha' })]);

    expect(result.svg).toContain('<svg');
    expect(result.nodeCount).toBe(1);
    expect(result.width).toBeGreaterThan(0);
  });

  it('should render nodes and edges from graph data', () => {
    const renderer = new SVGRenderer();
    const result = renderer.generateFromGraph(graph);

    expect(result.svg).toContain('node-a');
    expect(result.svg).toContain('<line');
    expect(result.edgeCount).toBe(1);
  });

  it('should include a legend', () => {
    const renderer = new SVGRenderer();
    const result = renderer.generateFromGraph(graph);

    expect(result.svg).toContain('legend');
  });

  it('should render dependency graphs', () => {
    const renderer = new SVGRenderer();
    const result = renderer.generateDependencyGraph([
      makeModule({ name: 'a', requires: ['b'] }),
      makeModule({ name: 'b' }),
    ]);

    expect(result.edgeCount).toBe(1);
  });

  it('should render workflow graphs', () => {
    const loc = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: 't' };
    const renderer = new SVGRenderer();
    const result = renderer.generateWorkflowGraph([
      makeModule({
        name: 'flow',
        steps: [
          { type: 'StepNode', location: loc, name: 'one', agent: 'a' },
          { type: 'StepNode', location: loc, name: 'two', tool: 't' },
        ],
      }),
    ]);

    expect(result.nodeCount).toBe(2);
  });

  it('should handle empty inputs', () => {
    const renderer = new SVGRenderer();
    const result = renderer.generateFromModules([]);

    expect(result.svg).toContain('<svg');
    expect(result.nodeCount).toBe(0);
  });

  it('should expose config', () => {
    const renderer = new SVGRenderer({ width: 400 });
    expect(renderer.getConfig().width).toBe(400);
  });
});

describe('svg helpers', () => {
  it('should map types to colors', () => {
    expect(getSvgColorForType('agent')).toBe(DEFAULT_SVG_COLORS.agent);
    expect(getSvgColorForType('unknown-type-xyz')).toBe(DEFAULT_SVG_COLORS.default);
  });

  it('should sanitize ids', () => {
    expect(sanitizeSvgId('a b')).toBe('a_b');
    expect(sanitizeSvgId('')).toBe('node');
    expect(sanitizeSvgId('9x')).toBe('n_9x');
  });

  it('should build svg documents', () => {
    const doc = createSvgDocument(100, 50, '<rect/>');
    expect(doc).toContain('viewBox="0 0 100 50"');
    expect(doc).toContain('<rect/>');
  });
});
