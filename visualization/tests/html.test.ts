import { describe, it, expect } from 'vitest';
import { HTMLRenderer, HTMLOutput } from '../src/html.js';
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

describe('HTMLRenderer', () => {
  describe('constructor', () => {
    it('should create with defaults', () => {
      const renderer = new HTMLRenderer();
      expect(renderer).toBeInstanceOf(HTMLRenderer);
    });

    it('should accept partial config', () => {
      const renderer = new HTMLRenderer({ theme: 'dark', layout: 'circular', width: 1200 });
      expect(renderer).toBeInstanceOf(HTMLRenderer);
    });
  });

  describe('generateFromModules', () => {
    it('should return HTMLOutput with html, css, scripts', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('css');
      expect(result).toHaveProperty('scripts');
      expect(typeof result.html).toBe('string');
      expect(typeof result.css).toBe('string');
      expect(Array.isArray(result.scripts)).toBe(true);
    });

    it('should produce valid HTML document', () => {
      const renderer = new HTMLRenderer({ title: 'Test Graph' });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<html lang="en">');
      expect(result.html).toContain('</html>');
      expect(result.html).toContain('<title>Test Graph</title>');
    });

    it('should include SVG element', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('<svg');
      expect(result.html).toContain('</svg>');
    });

    it('should include node IDs in SVG', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateFromModules([
        makeModule({ name: 'agent1', moduleType: 'agent' }),
      ]);

      expect(result.html).toContain('data-id="agent1"');
      expect(result.html).toContain('data-type="agent"');
    });

    it('should include edge lines in SVG', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b' }],
        }),
      ]);

      expect(result.html).toContain('<line');
      expect(result.html).toContain('data-from="a"');
      expect(result.html).toContain('data-to="b"');
    });

    it('should include edge labels when showEdgeLabels is true', () => {
      const renderer = new HTMLRenderer({ showEdgeLabels: true });
      const result = renderer.generateFromModules([
        makeModule({
          name: 'a',
          edges: [{ type: 'EdgeNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, source: 'a', target: 'b', label: 'calls' }],
        }),
      ]);

      expect(result.html).toContain('calls');
    });

    it('should include interactive script when interactive is true', () => {
      const renderer = new HTMLRenderer({ interactive: true });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.scripts.length).toBeGreaterThan(0);
      const hasInteractive = result.scripts.some(s => s.includes('.mam-node'));
      expect(hasInteractive).toBe(true);
    });

    it('should not include interactive script when interactive is false', () => {
      const renderer = new HTMLRenderer({ interactive: false });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      const hasInteractive = result.scripts.some(s => s.includes('.mam-node'));
      expect(hasInteractive).toBe(false);
    });

    it('should apply dark theme', () => {
      const renderer = new HTMLRenderer({ theme: 'dark' });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('#121212');
    });

    it('should apply light theme', () => {
      const renderer = new HTMLRenderer({ theme: 'light' });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('#f8f9fa');
    });

    it('should use custom CSS when provided', () => {
      const renderer = new HTMLRenderer({ css: '.custom { color: red; }' });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('.custom { color: red; }');
    });

    it('should include external scripts', () => {
      const renderer = new HTMLRenderer({ scripts: ['https://example.com/lib.js'] });
      const result = renderer.generateFromModules([makeModule({ name: 'a' })]);

      expect(result.html).toContain('https://example.com/lib.js');
    });
  });

  describe('generateFromGraph', () => {
    it('should render nodes and edges', () => {
      const renderer = new HTMLRenderer();
      const graph: GraphData = {
        nodes: [{ id: 'n1', label: 'Node 1', type: 'agent' }],
        edges: [{ from: 'n1', to: 'n2', type: 'direct' }],
        metadata: { nodeCount: 1, edgeCount: 1, depth: 1 },
      };

      const result = renderer.generateFromGraph(graph);

      expect(result.html).toContain('data-id="n1"');
    });
  });

  describe('generateDependencyGraph', () => {
    it('should include requires edges', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateDependencyGraph([
        makeModule({ name: 'a', requires: ['b', 'c'] }),
      ]);

      expect(result.html).toContain('data-from="a"');
      expect(result.html).toContain('data-to="b"');
      expect(result.html).toContain('data-to="c"');
    });
  });

  describe('generateWorkflowGraph', () => {
    it('should create step nodes with prefixed IDs', () => {
      const renderer = new HTMLRenderer();
      const result = renderer.generateWorkflowGraph([
        makeModule({
          name: 'wf',
          moduleType: 'workflow',
          steps: [
            { type: 'StepNode', location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: '' }, name: 's1' },
          ],
        }),
      ]);

      expect(result.html).toContain('data-id="wf-s1"');
    });
  });

  describe('layout modes', () => {
    it('should support circular layout', () => {
      const renderer = new HTMLRenderer({ layout: 'circular' });
      const modules = [
        makeModule({ name: 'a' }),
        makeModule({ name: 'b' }),
        makeModule({ name: 'c' }),
      ];
      const result = renderer.generateFromModules(modules);

      expect(result.html).toContain('<svg');
    });

    it('should support tree layout', () => {
      const renderer = new HTMLRenderer({ layout: 'tree' });
      const result = renderer.generateFromModules([makeModule({ name: 'root' })]);

      expect(result.html).toContain('<svg');
    });
  });
});
