/**
 * MAM JSON Exporter
 *
 * Exports graph data in various JSON formats for external visualization libraries.
 */

import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

// ============================================================================
// Types
// ============================================================================

export interface JSONConfig {
  /** JSON indentation spaces */
  indent?: number;
  /** Include metadata in output */
  includeMetadata?: boolean;
  /** Include node positions */
  includePositions?: boolean;
  /** Output format variant */
  format?: 'full' | 'compact' | 'cytoscape' | 'd3';
}

export interface JSONOutput {
  /** Serialized data */
  data: unknown;
  /** Format name */
  format: string;
}

// ============================================================================
// JSON Exporter
// ============================================================================

export class JSONExporter {
  private config: Required<JSONConfig>;

  constructor(config: JSONConfig = {}) {
    this.config = {
      indent: 2,
      includeMetadata: true,
      includePositions: false,
      format: 'full',
      ...config,
    };
  }

  /**
   * Export from modules
   */
  generateFromModules(modules: V2ModuleNode[]): JSONOutput {
    const graphData = this.modulesToGraph(modules);
    return this.generateFromGraph(graphData);
  }

  /**
   * Export from graph data
   */
  generateFromGraph(data: GraphData): JSONOutput {
    switch (this.config.format) {
      case 'cytoscape':
        return { data: this.toCytoscape(data.nodes, data.edges), format: 'cytoscape' };
      case 'd3':
        return { data: this.toD3(data.nodes, data.edges), format: 'd3' };
      case 'compact':
        return { data: this.toCompact(data), format: 'compact' };
      case 'full':
      default:
        return { data: this.toFull(data), format: 'full' };
    }
  }

  /**
   * Export dependency graph
   */
  generateDependencyGraph(modules: V2ModuleNode[]): JSONOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      nodes.push({ id: mod.name, label: mod.name, type: mod.moduleType });
      if (mod.requires) {
        for (const req of mod.requires) {
          edges.push({ from: mod.name, to: req, type: 'dependency' });
        }
      }
    }

    const graphData: GraphData = {
      nodes,
      edges,
      metadata: { nodeCount: nodes.length, edgeCount: edges.length, depth: 0 },
    };

    return this.generateFromGraph(graphData);
  }

  /**
   * Export workflow graph
   */
  generateWorkflowGraph(modules: V2ModuleNode[]): JSONOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      if (mod.steps) {
        for (const step of mod.steps) {
          nodes.push({
            id: `${mod.name}-${step.name}`,
            label: step.name,
            type: 'step',
            metadata: { agent: step.agent, tool: step.tool },
          });
        }
      }
      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({
            from: `${mod.name}-${edge.source}`,
            to: `${mod.name}-${edge.target}`,
            label: edge.label,
            type: 'direct',
          });
        }
      }
    }

    const graphData: GraphData = {
      nodes,
      edges,
      metadata: { nodeCount: nodes.length, edgeCount: edges.length, depth: 0 },
    };

    return this.generateFromGraph(graphData);
  }

  // --------------------------------------------------------------------------
  // Format converters
  // --------------------------------------------------------------------------

  private toFull(data: GraphData): object {
    const result: Record<string, unknown> = {
      nodes: data.nodes.map(n => {
        const node: Record<string, unknown> = {
          id: n.id,
          label: n.label,
          type: n.type,
        };
        if (this.config.includeMetadata && n.metadata) {
          node.metadata = n.metadata;
        }
        return node;
      }),
      edges: data.edges.map(e => {
        const edge: Record<string, unknown> = {
          from: e.from,
          to: e.to,
          type: e.type,
        };
        if (e.label) edge.label = e.label;
        return edge;
      }),
    };

    if (this.config.includeMetadata) {
      result.metadata = data.metadata;
    }

    return result;
  }

  private toCompact(data: GraphData): object {
    return {
      nodes: data.nodes.map(n => [n.id, n.type]),
      edges: data.edges.map(e => [e.from, e.to, e.type]),
    };
  }

  toCytoscape(nodes: GraphNode[], edges: GraphEdge[]): object {
    const elements: object[] = [];

    for (const node of nodes) {
      const data: Record<string, unknown> = { id: node.id, label: node.label, type: node.type };
      if (this.config.includeMetadata && node.metadata) {
        data.metadata = node.metadata;
      }
      elements.push({ group: 'nodes', data });
    }

    for (const edge of edges) {
      const data: Record<string, unknown> = {
        id: `${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: edge.type,
      };
      if (edge.label) data.label = edge.label;
      elements.push({ group: 'edges', data });
    }

    return { elements };
  }

  toD3(nodes: GraphNode[], edges: GraphEdge[]): object {
    const graphNodes = nodes.map(n => {
      const node: Record<string, unknown> = {
        id: n.id,
        name: n.label,
        type: n.type,
      };
      if (this.config.includeMetadata && n.metadata) {
        node.metadata = n.metadata;
      }
      return node;
    });

    const graphLinks = edges.map(e => {
      const link: Record<string, unknown> = {
        source: e.from,
        target: e.to,
        type: e.type,
      };
      if (e.label) link.label = e.label;
      return link;
    });

    return { nodes: graphNodes, links: graphLinks };
  }

  private modulesToGraph(modules: V2ModuleNode[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      nodes.push({
        id: mod.name,
        label: mod.name,
        type: mod.moduleType,
        metadata: { role: mod.role, goal: mod.goal, provider: mod.provider },
      });

      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({ from: edge.source, to: edge.target, label: edge.label || edge.condition, type: 'direct' });
        }
      }
      if (mod.handoff) {
        for (const target of mod.handoff) {
          edges.push({ from: mod.name, to: target, type: 'handoff' });
        }
      }
      if (mod.tools) {
        for (const tool of mod.tools) {
          edges.push({ from: mod.name, to: tool, type: 'dependency' });
        }
      }
    }

    return {
      nodes,
      edges,
      metadata: { nodeCount: nodes.length, edgeCount: edges.length, depth: 0 },
    };
  }
}

export function stringifyJsonOutput(output: JSONOutput, indent = 2): string {
  return JSON.stringify(output.data, null, indent);
}

export function getJsonOutputFormat(output: JSONOutput): string {
  return output.format;
}

export function isJsonOutputFormat(output: JSONOutput, format: string): boolean {
  return output.format === format;
}

export function minifyJsonString(json: string): string {
  return JSON.stringify(JSON.parse(json));
}

export function prettifyJsonString(json: string, indent = 2): string {
  return JSON.stringify(JSON.parse(json), null, indent);
}

export function isValidJsonString(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function getJsonByteLength(output: JSONOutput): number {
  return Buffer.byteLength(stringifyJsonOutput(output), 'utf-8');
}
