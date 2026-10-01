/**
 * MAM Visualization — Knowledge Graph
 *
 * Bridges the MAM intelligence-layer knowledge graph into the visualization
 * engine: entities + relations become `GraphData`, which every renderer
 * (mermaid, dot, svg, ascii, json, ...) already consumes.
 */

import { GraphEngine, type GraphEntity, type GraphRelation } from '@mam/intelligence-layer';
import {
  GraphData,
  GraphNode,
  GraphEdge,
  GraphMetadata,
  createGraphNode,
  createGraphEdge,
  createEmptyGraph,
  getNodeIds,
} from './graph.js';
import { MermaidGenerator, type MermaidConfig } from './mermaid.js';
import { DOTRenderer, type DOTConfig } from './dot.js';
import { SVGRenderer, type SVGConfig } from './svg.js';

/** Options for converting a knowledge graph into GraphData. */
export interface KnowledgeGraphConfig {
  /** Include entity aliases in node metadata. */
  includeAliases?: boolean;
  /** Edge type used for every relation edge. */
  edgeType?: GraphEdge['type'];
  /** Skip entity types that should not be visualized. */
  excludeEntityTypes?: readonly string[];
}

/**
 * Convert an intelligence knowledge graph (a {@link GraphEngine}) into
 * visualization {@link GraphData}.
 *
 * @param engine - the knowledge graph engine.
 * @param config - optional conversion options.
 * @returns GraphData ready for any visualization renderer.
 */
export function graphDataFromKnowledge(engine: GraphEngine, config: KnowledgeGraphConfig = {}): GraphData {
  const data = createEmptyGraph();
  const store = engine.store;

  const entities = store.listEntities();
  const relations = store.listRelations();

  const excluded = new Set<string>((config.excludeEntityTypes ?? []).map((t) => t.trim().toLowerCase()));

  for (const entity of entities) {
    if (excluded.has(entity.type.toLowerCase())) continue;
    const node = createGraphNode(entity.id, entity.name, entity.type);
    node.metadata = {
      type: entity.type,
    };
    if (config.includeAliases && entity.aliases && entity.aliases.length > 0) {
      node.metadata.aliases = [...entity.aliases];
    }
    data.nodes.push(node);
  }

  const nodeIds = new Set(data.nodes.map((n) => n.id));

  for (const relation of relations) {
    if (!nodeIds.has(relation.source) || !nodeIds.has(relation.target)) continue;
    const edge = createGraphEdge(relation.source, relation.target, config.edgeType ?? 'direct');
    edge.label = relation.predicate;
    data.edges.push(edge);
  }

  data.metadata = computeMetadata(data.nodes, data.edges);
  return data;
}

/**
 * Render a knowledge graph as a Mermaid flowchart.
 *
 * @param engine - the knowledge graph engine.
 * @param config - optional mermaid config.
 * @returns the Mermaid output.
 */
export function knowledgeGraphToMermaid(engine: GraphEngine, config?: MermaidConfig) {
  return new MermaidGenerator(config).generateFromGraph(graphDataFromKnowledge(engine));
}

/**
 * Render a knowledge graph as a Graphviz DOT graph.
 *
 * @param engine - the knowledge graph engine.
 * @param config - optional DOT config.
 * @returns the DOT output.
 */
export function knowledgeGraphToDot(engine: GraphEngine, config?: DOTConfig) {
  return new DOTRenderer(config).generateFromGraph(graphDataFromKnowledge(engine));
}

/**
 * Render a knowledge graph as an SVG document.
 *
 * @param engine - the knowledge graph engine.
 * @param config - optional SVG config.
 * @returns the SVG output.
 */
export function knowledgeGraphToSvg(engine: GraphEngine, config?: SVGConfig) {
  return new SVGRenderer(config).generateFromGraph(graphDataFromKnowledge(engine));
}

/**
 * Compute GraphMetadata from node/edge lists.
 *
 * @param nodes - graph nodes.
 * @param edges - graph edges.
 * @returns metadata with counts.
 */
export function computeMetadata(nodes: GraphNode[], edges: GraphEdge[]): GraphMetadata {
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    depth: nodes.length > 0 ? 1 : 0,
  };
}

/**
 * Summarize a knowledge graph as GraphData.
 *
 * @param engine - the knowledge graph engine.
 * @returns a compact summary of the converted graph.
 */
export function summarizeKnowledgeGraph(engine: GraphEngine): { nodeCount: number; edgeCount: number; nodeIds: string[] } {
  const data = graphDataFromKnowledge(engine);
  return {
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    nodeIds: getNodeIds(data),
  };
}

export type { GraphEntity, GraphRelation, GraphData, GraphNode, GraphEdge, GraphMetadata };