import { describe, it, expect } from 'vitest';
import {
  CSVExporter,
  CSVOutput,
  escapeCsvField,
  nodesToCsvRecords,
  edgesToCsvRecords,
  CSV_MIME_TYPE,
} from '../src/csv.js';
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

describe('CSVExporter', () => {
  it('should export nodes and edges csv', () => {
    const exporter = new CSVExporter();
    const result = exporter.generateFromGraph(graph);

    expect(result.nodesCsv).toContain('id,label,type');
    expect(result.nodesCsv).toContain('a,A,agent');
    expect(result.edgesCsv).toContain('from,to,label,type');
    expect(result.edgesCsv).toContain('a,b,uses,direct');
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
  });

  it('should export from modules with handoffs and tools', () => {
    const exporter = new CSVExporter();
    const result = exporter.generateFromModules([
      makeModule({ name: 'a', handoff: ['b'], tools: ['t'] }),
    ]);

    expect(result.edgeCount).toBe(2);
  });

  it('should omit headers when configured', () => {
    const exporter = new CSVExporter({ includeHeader: false });
    const result = exporter.generateFromGraph(graph);

    expect(result.nodesCsv.startsWith('id')).toBe(false);
  });

  it('should support custom delimiters', () => {
    const exporter = new CSVExporter({ delimiter: ';' });
    const result = exporter.generateFromGraph(graph);

    expect(result.nodesCsv).toContain('id;label;type');
    expect(exporter.dialect).toBe('csv');
    expect(new CSVExporter({ delimiter: '\t' }).dialect).toBe('tsv');
  });

  it('should expose node/edge csv separately', () => {
    const exporter = new CSVExporter();
    expect(exporter.getNodeCsv(graph)).toContain('agent');
    expect(exporter.getEdgeCsv(graph)).toContain('uses');
    expect(exporter.getCombinedCsv(graph)).toContain('# nodes');
  });

  it('should clone config with builders', () => {
    const exporter = new CSVExporter().withDelimiter(';').withHeader(false);
    expect(exporter.getConfig().delimiter).toBe(';');
    expect(exporter.getConfig().includeHeader).toBe(false);
  });

  it('should render dependency and workflow graphs', () => {
    const exporter = new CSVExporter();
    const dep = exporter.generateDependencyGraph([makeModule({ name: 'a', requires: ['b'] })]);
    expect(dep.edgeCount).toBe(1);
    const loc = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: 't' };
    const flow = exporter.generateWorkflowGraph([
      makeModule({ name: 'f', steps: [{ type: 'StepNode', location: loc, name: 's' }] }),
    ]);
    expect(flow.nodeCount).toBe(1);
  });
});

describe('csv helpers', () => {
  it('should escape fields', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('should expose the mime type', () => {
    expect(CSV_MIME_TYPE).toBe('text/csv');
  });

  it('should convert nodes and edges to records', () => {
    expect(nodesToCsvRecords(graph.nodes)).toEqual([['a', 'A', 'agent'], ['b', 'B', 'tool']]);
    expect(edgesToCsvRecords(graph.edges)).toEqual([['a', 'b', 'uses', 'direct']]);
    expect(edgesToCsvRecords([{ from: 'x', to: 'y', type: 'handoff' }])).toEqual([['x', 'y', '', 'handoff']]);
  });
});
