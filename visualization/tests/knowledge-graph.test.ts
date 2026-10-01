import { describe, expect, it } from 'vitest';
import { GraphEngine } from '@mam/intelligence-layer';
import {
  graphDataFromKnowledge,
  knowledgeGraphToMermaid,
  knowledgeGraphToDot,
  summarizeKnowledgeGraph,
  computeMetadata,
} from '../src/index.js';

function buildEngine(): GraphEngine {
  const engine = new GraphEngine();
  engine.addTriplet({ subject: 'MAM', predicate: 'is a', object: 'markdown language' });
  engine.addTriplet({ subject: 'MAM', predicate: 'compiles to', object: 'Python' });
  engine.addTriplet({ subject: 'MAM', predicate: 'powers', object: 'Agents' });
  return engine;
}

describe('knowledge graph visualization', () => {
  it('converts a knowledge graph into GraphData', () => {
    const engine = buildEngine();
    const data = graphDataFromKnowledge(engine);
    expect(data.nodes.length).toBe(4); // MAM, markdown language, Python, Agents
    expect(data.edges.length).toBe(3);
    const mam = data.nodes.find((n) => n.label === 'MAM');
    expect(mam).toBeDefined();
    expect(mam!.type.length).toBeGreaterThan(0);
    expect(data.metadata.nodeCount).toBe(4);
    expect(data.metadata.edgeCount).toBe(3);
    const edge = data.edges[0];
    expect(edge.label).toBeDefined();
    expect(edge.type).toBe('direct');
  });

  it('skips excluded entity types', () => {
    const engine = buildEngine();
    const data = graphDataFromKnowledge(engine, { excludeEntityTypes: ['markdown'] });
    expect(data.nodes.every((n) => n.type.toLowerCase() !== 'markdown')).toBe(true);
  });

  it('renders knowledge graph to mermaid', () => {
    const engine = buildEngine();
    const out = knowledgeGraphToMermaid(engine);
    expect(out.code).toContain('flowchart');
    expect(out.code).toContain('MAM');
  });

  it('renders knowledge graph to dot', () => {
    const engine = buildEngine();
    const out = knowledgeGraphToDot(engine);
    expect(out.dot).toContain('digraph');
    expect(out.dot).toContain('MAM');
  });

  it('summarizes and computes metadata', () => {
    const engine = buildEngine();
    const summary = summarizeKnowledgeGraph(engine);
    expect(summary.nodeCount).toBe(4);
    expect(summary.nodeIds).toContain(engine.store.listEntities()[0].id);
    const meta = computeMetadata([{ id: 'a', label: 'A', type: 'x' }], [{ from: 'a', to: 'b', type: 'direct' }]);
    expect(meta.nodeCount).toBe(1);
    expect(meta.edgeCount).toBe(1);
  });
});