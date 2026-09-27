import { describe, it, expect } from 'vitest';
import {
  MarkdownReporter,
  MarkdownOutput,
  formatMarkdownTable,
  escapeMarkdownCell,
  markdownSectionHeading,
  DEFAULT_MARKDOWN_TITLE,
} from '../src/markdown.js';
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

describe('MarkdownReporter', () => {
  it('should report on modules with toc', () => {
    const reporter = new MarkdownReporter();
    const result = reporter.generateFromModules([
      makeModule({ name: 'alpha', role: 'helper', goal: 'help', handoff: ['beta'], tools: ['t'] }),
    ]);

    expect(result.markdown).toContain('# MAM System Report');
    expect(result.markdown).toContain('## Contents');
    expect(result.markdown).toContain('helper');
    expect(result.sections).toBeGreaterThan(0);
  });

  it('should report graph tables and stats', () => {
    const reporter = new MarkdownReporter();
    const result = reporter.generateFromGraph(graph);

    expect(result.markdown).toContain('| ID | Label | Type |');
    expect(result.markdown).toContain('| From | To | Label | Type |');
    expect(result.markdown).toContain('Nodes: 2');
    expect(result.tables).toBe(2);
  });

  it('should list without tables when disabled', () => {
    const reporter = new MarkdownReporter({ includeTables: false });
    const result = reporter.generateFromGraph(graph);

    expect(result.markdown).toContain('- **a** (agent)');
    expect(result.markdown).toContain('a -> b');
    expect(result.tables).toBe(0);
  });

  it('should report dependencies', () => {
    const reporter = new MarkdownReporter();
    const result = reporter.generateDependencyGraph([
      makeModule({ name: 'a', requires: ['b'] }),
      makeModule({ name: 'lonely' }),
    ]);

    expect(result.markdown).toContain('depends on: b');
    expect(result.markdown).toContain('no dependencies');
  });

  it('should report workflows', () => {
    const loc = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: 't' };
    const reporter = new MarkdownReporter();
    const result = reporter.generateWorkflowGraph([
      makeModule({ name: 'flow', steps: [{ type: 'StepNode', location: loc, name: 'first' }] }),
    ]);

    expect(result.markdown).toContain('1. first');
  });

  it('should customize config fluently', () => {
    const reporter = new MarkdownReporter().withTitle('Custom').withoutToc().withoutStats().withoutTables();
    expect(reporter.getConfig().title).toBe('Custom');
    const result = reporter.generateFromModules([makeModule({ name: 'a' })]);
    expect(result.markdown).toContain('# Custom');
    expect(result.markdown).not.toContain('## Contents');
  });

  it('should expose config', () => {
    expect(new MarkdownReporter({ title: 'T' }).getConfig().title).toBe('T');
  });
});

describe('markdown helpers', () => {
  it('should format tables', () => {
    const table = formatMarkdownTable(['A', 'B'], [['1', '2'], ['3', '4']]);
    expect(table).toContain('| A | B |');
    expect(table).toContain('| --- | --- |');
    expect(table).toContain('| 1 | 2 |');
  });

  it('should escape cells', () => {
    expect(escapeMarkdownCell('a|b')).toBe('a\\|b');
    expect(escapeMarkdownCell('a\nb')).toBe('a<br>b');
  });

  it('should build headings', () => {
    expect(markdownSectionHeading('Hi')).toBe('## Hi');
    expect(markdownSectionHeading('Hi', 1)).toBe('# Hi');
    expect(markdownSectionHeading('Hi', 99)).toBe('###### Hi');
  });

  it('should expose the default title', () => {
    expect(DEFAULT_MARKDOWN_TITLE).toBe('MAM System Report');
  });
});
