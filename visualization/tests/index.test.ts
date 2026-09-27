import { describe, it, expect } from 'vitest';
import {
  GraphVisualizer,
  MermaidGenerator,
  ASCIIArt,
  HTMLRenderer,
  DOTRenderer,
  JSONExporter,
  SVGRenderer,
  CSVExporter,
  MarkdownReporter,
  TimelineGenerator,
  createGraphNode,
  computeGraphStats,
  sanitizeMermaidId,
  countAsciiLines,
  sanitizeDotId,
  extractSvgNodeIds,
  stringifyJsonOutput,
} from '../src/index.js';

describe('visualization barrel', () => {
  it('should export the graph visualizer', () => {
    expect(new GraphVisualizer()).toBeInstanceOf(GraphVisualizer);
  });

  it('should export the mermaid generator', () => {
    expect(new MermaidGenerator()).toBeInstanceOf(MermaidGenerator);
  });

  it('should export the ascii renderer', () => {
    expect(new ASCIIArt()).toBeInstanceOf(ASCIIArt);
  });

  it('should export the html renderer', () => {
    expect(new HTMLRenderer()).toBeInstanceOf(HTMLRenderer);
  });

  it('should export the dot renderer', () => {
    expect(new DOTRenderer()).toBeInstanceOf(DOTRenderer);
  });

  it('should export the json exporter', () => {
    expect(new JSONExporter()).toBeInstanceOf(JSONExporter);
  });

  it('should export the svg renderer', () => {
    expect(new SVGRenderer()).toBeInstanceOf(SVGRenderer);
  });

  it('should export the csv exporter', () => {
    expect(new CSVExporter()).toBeInstanceOf(CSVExporter);
  });

  it('should export the markdown reporter', () => {
    expect(new MarkdownReporter()).toBeInstanceOf(MarkdownReporter);
  });

  it('should export the timeline generator', () => {
    expect(new TimelineGenerator()).toBeInstanceOf(TimelineGenerator);
  });

  it('should export graph helpers', () => {
    expect(createGraphNode('a', 'A', 'agent').id).toBe('a');
  });

  it('should export stats helpers', () => {
    const stats = computeGraphStats({ nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, depth: 0 } });
    expect(stats.nodeCount).toBe(0);
  });

  it('should export output helpers', () => {
    expect(sanitizeMermaidId('a b')).toBe('a_b');
    expect(countAsciiLines({ art: 'x', width: 1, height: 1 })).toBe(1);
    expect(sanitizeDotId('a b')).toBe('a_b');
    expect(extractSvgNodeIds('<svg></svg>')).toEqual([]);
    expect(stringifyJsonOutput({ data: { a: 1 }, format: 'full' })).toContain('"a"');
  });
});
