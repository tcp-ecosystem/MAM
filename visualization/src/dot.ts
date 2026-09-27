/**
 * MAM DOT Renderer
 *
 * Generates Graphviz DOT format output from MAM modules.
 */

import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

// ============================================================================
// Types
// ============================================================================

export interface DOTConfig {
  /** Graph direction */
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Rank separation */
  ranksep?: number;
  /** Node separation */
  nodesep?: number;
  /** Dots per inch */
  dpi?: number;
  /** Output format hint */
  format?: 'svg' | 'png' | 'pdf';
  /** Default node shape */
  nodeShape?: string;
  /** Default edge style */
  edgeStyle?: string;
}

export interface DOTOutput {
  /** DOT source code */
  dot: string;
  /** Target format */
  format: string;
}

// ============================================================================
// Constants
// ============================================================================

const TYPE_COLORS: Record<string, string> = {
  agent: '#4CAF50',
  tool: '#2196F3',
  memory: '#FF9800',
  workflow: '#9C27B0',
  team: '#F44336',
  policy: '#795548',
  system: '#607D8B',
  module: '#9E9E9E',
  service: '#00BCD4',
  component: '#3F51B5',
  resource: '#CDDC39',
  interface: '#E91E63',
  contract: '#009688',
  plugin: '#FF5722',
  extension: '#673AB7',
  runtime: '#8BC34A',
  package: '#FFC107',
  repository: '#795548',
  documentation: '#607D8B',
};

const TYPE_SHAPES: Record<string, string> = {
  agent: 'ellipse',
  tool: 'box',
  memory: 'cylinder',
  workflow: 'hexagon',
  team: 'diamond',
  policy: 'note',
  system: 'doublecircle',
  module: 'box',
  service: 'component',
  component: 'box3d',
  resource: 'folder',
  interface: 'interface',
  contract: 'record',
  plugin: 'tab',
  extension: 'folder',
  runtime: 'oval',
  package: 'package',
  repository: 'folder',
  documentation: 'document',
};

// ============================================================================
// DOT Renderer
// ============================================================================

export class DOTRenderer {
  private config: Required<DOTConfig>;

  constructor(config: DOTConfig = {}) {
    this.config = {
      rankdir: 'TB',
      ranksep: 1.0,
      nodesep: 0.8,
      dpi: 96,
      format: 'svg',
      nodeShape: 'box',
      edgeStyle: 'solid',
      ...config,
    };
  }

  /**
   * Generate DOT from modules
   */
  generateFromModules(modules: V2ModuleNode[]): DOTOutput {
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

    return this.buildOutput(nodes, edges);
  }

  /**
   * Generate DOT from graph data
   */
  generateFromGraph(data: GraphData): DOTOutput {
    return this.buildOutput(data.nodes, data.edges);
  }

  /**
   * Generate dependency graph DOT
   */
  generateDependencyGraph(modules: V2ModuleNode[]): DOTOutput {
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

    return this.buildOutput(nodes, edges);
  }

  /**
   * Generate workflow graph DOT
   */
  generateWorkflowGraph(modules: V2ModuleNode[]): DOTOutput {
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

    return this.buildOutput(nodes, edges);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private buildOutput(nodes: GraphNode[], edges: GraphEdge[]): DOTOutput {
    const lines: string[] = [];

    lines.push('digraph MAM {');
    lines.push(`  rankdir=${this.config.rankdir};`);
    lines.push(`  ranksep=${this.config.ranksep};`);
    lines.push(`  nodesep=${this.config.nodesep};`);
    lines.push(`  dpi=${this.config.dpi};`);
    lines.push('  bgcolor="white";');
    lines.push('  fontname="Helvetica,Arial,sans-serif";');
    lines.push('  node [fontname="Helvetica,Arial,sans-serif", fontsize=12];');
    lines.push('  edge [fontname="Helvetica,Arial,sans-serif", fontsize=10];');
    lines.push('');

    // Subgraph for nodes
    lines.push('  subgraph cluster_nodes {');
    lines.push('    style="dashed";');
    lines.push('    color="#cccccc";');
    lines.push('    label="Modules";');
    lines.push('');

    for (const node of nodes) {
      lines.push(`    ${this.escapeDOT(node.id)} [${this.renderNode(node)}];`);
    }

    lines.push('  }');
    lines.push('');

    // Edges
    lines.push('  subgraph cluster_edges {');
    lines.push('    style="invis";');
    lines.push('');

    for (const edge of edges) {
      lines.push(`  ${this.escapeDOT(edge.from)} -> ${this.escapeDOT(edge.to)} [${this.renderEdge(edge)}];`);
    }

    lines.push('  }');
    lines.push('}');

    return {
      dot: lines.join('\n'),
      format: this.config.format,
    };
  }

  private renderNode(node: GraphNode): string {
    const attrs: string[] = [];

    // Label
    attrs.push(`label="${this.escapeDOT(node.label)}"`);

    // Shape
    const shape = TYPE_SHAPES[node.type] || this.config.nodeShape;
    attrs.push(`shape=${shape}`);

    // Color
    const color = TYPE_COLORS[node.type] || '#9E9E9E';
    attrs.push(`style="filled"`);
    attrs.push(`fillcolor="${color}"`);
    attrs.push(`color="#333333"`);

    // Tooltip from metadata
    if (node.metadata) {
      const tipParts: string[] = [];
      if (node.metadata.role) tipParts.push(`Role: ${node.metadata.role}`);
      if (node.metadata.goal) tipParts.push(`Goal: ${node.metadata.goal}`);
      if (tipParts.length > 0) {
        attrs.push(`tooltip="${this.escapeDOT(tipParts.join('\\n'))}"`);
      }
    }

    // Font color contrast
    attrs.push('fontcolor="white"');

    return attrs.join(', ');
  }

  private renderEdge(edge: GraphEdge): string {
    const attrs: string[] = [];

    if (edge.label) {
      attrs.push(`label="${this.escapeDOT(edge.label)}"`);
    }

    switch (edge.type) {
      case 'handoff':
        attrs.push('style="dashed"');
        attrs.push('color="#FF9800"');
        break;
      case 'dependency':
        attrs.push('style="dotted"');
        attrs.push('color="#2196F3"');
        break;
      case 'communication':
        attrs.push('style="dashed"');
        attrs.push('color="#9C27B0"');
        break;
      default:
        attrs.push('style="solid"');
        attrs.push('color="#666666"');
    }

    attrs.push('arrowhead="vee"');

    return attrs.join(', ');
  }

  private escapeDOT(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/</g, '\\<')
      .replace(/>/g, '\\>')
      .replace(/\n/g, '\\n');
  }
}

export function sanitizeDotId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, '_');
  if (cleaned.length === 0) return 'node';
  if (/^[0-9]/.test(cleaned)) return `n_${cleaned}`;
  return cleaned;
}

export function countDotNodes(output: DOTOutput): number {
  const matches = output.dot.match(/^\s*[A-Za-z0-9_]+\s*\[/gm);
  return matches ? matches.length : 0;
}

export function countDotEdges(output: DOTOutput): number {
  const matches = output.dot.match(/->/g);
  return matches ? matches.length : 0;
}

export function extractDotNodeIds(output: DOTOutput): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const pattern = /^\s*([A-Za-z0-9_]+)\s*\[/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output.dot)) !== null) {
    const id = match[1] as string;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function hasDotNode(output: DOTOutput, id: string): boolean {
  return extractDotNodeIds(output).includes(id);
}

export function validateDotBraces(output: DOTOutput): boolean {
  let depth = 0;
  for (const ch of output.dot) {
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function getDotRankdirLine(rankdir: string): string {
  return `rankdir=${rankdir};`;
}
