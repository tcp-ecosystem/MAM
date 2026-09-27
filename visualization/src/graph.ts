/**
 * MAM Graph Visualizer
 * 
 * Generates graph data structures from MAM modules.
 */

import { V2ModuleNode, V2EdgeNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface GraphConfig {
  /** Graph direction */
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  /** Show labels */
  showLabels: boolean;
  /** Show types */
  showTypes: boolean;
  /** Node shape */
  nodeShape: 'circle' | 'rectangle' | 'diamond' | 'ellipse';
  /** Edge style */
  edgeStyle: 'solid' | 'dashed' | 'dotted';
}

export interface GraphData {
  /** Graph nodes */
  nodes: GraphNode[];
  /** Graph edges */
  edges: GraphEdge[];
  /** Graph metadata */
  metadata: GraphMetadata;
}

export interface GraphNode {
  /** Node ID */
  id: string;
  /** Node label */
  label: string;
  /** Node type */
  type: string;
  /** Node metadata */
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  /** Source node */
  from: string;
  /** Target node */
  to: string;
  /** Edge label */
  label?: string;
  /** Edge type */
  type: 'direct' | 'dependency' | 'handoff' | 'communication';
}

export interface GraphMetadata {
  /** Total nodes */
  nodeCount: number;
  /** Total edges */
  edgeCount: number;
  /** Graph depth */
  depth: number;
}

// ============================================================================
// Graph Visualizer
// ============================================================================

export class GraphVisualizer {
  private config: GraphConfig;

  constructor(config: Partial<GraphConfig> = {}) {
    this.config = {
      direction: 'TB',
      showLabels: true,
      showTypes: true,
      nodeShape: 'rectangle',
      edgeStyle: 'solid',
      ...config,
    };
  }

  /**
   * Generate graph from modules
   */
  generate(modules: V2ModuleNode[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      // Add node
      nodes.push({
        id: mod.name,
        label: this.config.showLabels ? mod.name : mod.name.substring(0, 3),
        type: mod.moduleType,
        metadata: {
          role: mod.role,
          goal: mod.goal,
          provider: mod.provider,
        },
      });

      // Add edges from module
      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({
            from: edge.source,
            to: edge.target,
            label: edge.label || edge.condition,
            type: 'direct',
          });
        }
      }

      // Add handoff edges
      if (mod.handoff) {
        for (const target of mod.handoff) {
          edges.push({
            from: mod.name,
            to: target,
            type: 'handoff',
          });
        }
      }

      // Add tool references
      if (mod.tools) {
        for (const tool of mod.tools) {
          edges.push({
            from: mod.name,
            to: tool,
            type: 'dependency',
          });
        }
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        depth: this.calculateDepth(nodes, edges),
      },
    };
  }

  /**
   * Generate dependency graph
   */
  generateDependencyGraph(modules: V2ModuleNode[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      nodes.push({
        id: mod.name,
        label: mod.name,
        type: mod.moduleType,
      });

      if (mod.requires) {
        for (const req of mod.requires) {
          edges.push({
            from: mod.name,
            to: req,
            type: 'dependency',
          });
        }
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        depth: this.calculateDepth(nodes, edges),
      },
    };
  }

  /**
   * Generate workflow graph
   */
  generateWorkflowGraph(modules: V2ModuleNode[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      if (mod.steps) {
        for (const step of mod.steps) {
          nodes.push({
            id: `${mod.name}-${step.name}`,
            label: step.name,
            type: 'step',
            metadata: {
              agent: step.agent,
              tool: step.tool,
            },
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

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        depth: this.calculateDepth(nodes, edges),
      },
    };
  }

  private calculateDepth(nodes: GraphNode[], edges: GraphEdge[]): number {
    if (nodes.length === 0) return 0;

    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from)!.push(edge.to);
    }

    let maxDepth = 0;
    const visited = new Set<string>();

    const dfs = (node: string, depth: number) => {
      if (visited.has(node)) return;
      visited.add(node);
      maxDepth = Math.max(maxDepth, depth);

      const neighbors = adjacency.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor, depth + 1);
      }
    };

    for (const node of nodes) {
      dfs(node.id, 0);
    }

    return maxDepth;
  }
}

export function createGraphNode(id: string, label: string, type: string): GraphNode {
  return { id, label, type };
}

export function createGraphEdge(
  from: string,
  to: string,
  type: GraphEdge['type'] = 'direct',
): GraphEdge {
  return { from, to, type };
}

export function createEmptyGraph(): GraphData {
  return { nodes: [], edges: [], metadata: { nodeCount: 0, edgeCount: 0, depth: 0 } };
}

export function getNodeIds(graph: GraphData): string[] {
  return graph.nodes.map((node) => node.id);
}

export function findNodeById(graph: GraphData, id: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

export function getSuccessors(graph: GraphData, id: string): string[] {
  return graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to);
}

export function getPredecessors(graph: GraphData, id: string): string[] {
  return graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
}