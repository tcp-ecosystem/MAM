/**
 * MAM Mermaid Generator
 * 
 * Generates Mermaid diagrams from MAM modules.
 */

import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

// ============================================================================
// Types
// ============================================================================

export interface MermaidConfig {
  /** Diagram type */
  type: 'flowchart' | 'graph' | 'sequence' | 'class';
  /** Direction */
  direction: 'TD' | 'LR' | 'BT' | 'RL';
  /** Show node types */
  showTypes: boolean;
  /** Style nodes by type */
  styleByType: boolean;
}

export interface MermaidOutput {
  /** Mermaid code */
  code: string;
  /** Diagram type */
  type: string;
  /** Node count */
  nodeCount: number;
  /** Edge count */
  edgeCount: number;
}

// ============================================================================
// Mermaid Generator
// ============================================================================

export class MermaidGenerator {
  private config: MermaidConfig;

  constructor(config: Partial<MermaidConfig> = {}) {
    this.config = {
      type: 'flowchart',
      direction: 'TD',
      showTypes: true,
      styleByType: true,
      ...config,
    };
  }

  /**
   * Generate Mermaid from modules
   */
  generateFromModules(modules: V2ModuleNode[]): MermaidOutput {
    const lines: string[] = [];

    // Header
    lines.push(`flowchart ${this.config.direction}`);
    lines.push('');

    // Generate nodes
    for (const mod of modules) {
      const nodeDef = this.generateNodeDefinition(mod);
      lines.push(nodeDef);
    }

    lines.push('');

    // Generate edges
    for (const mod of modules) {
      if (mod.edges) {
        for (const edge of mod.edges) {
          lines.push(`    ${edge.source} --> ${edge.target}`);
        }
      }
      if (mod.handoff) {
        for (const target of mod.handoff) {
          lines.push(`    ${mod.name} -.-> ${target}`);
        }
      }
    }

    lines.push('');

    // Add styles
    if (this.config.styleByType) {
      lines.push(...this.generateStyles(modules));
    }

    return {
      code: lines.join('\n'),
      type: 'flowchart',
      nodeCount: modules.length,
      edgeCount: this.countEdges(modules),
    };
  }

  /**
   * Generate Mermaid from graph data
   */
  generateFromGraph(graph: GraphData): MermaidOutput {
    const lines: string[] = [];

    lines.push(`flowchart ${this.config.direction}`);
    lines.push('');

    // Generate nodes
    for (const node of graph.nodes) {
      const shape = this.getNodeShape(node.type);
      lines.push(`    ${node.id}${shape.start}"${node.label}"${shape.end}`);
    }

    lines.push('');

    // Generate edges
    for (const edge of graph.edges) {
      const style = this.getEdgeStyle(edge.type);
      if (edge.label) {
        lines.push(`    ${edge.from} ${style.arrow}"${edge.label}"${style.end} ${edge.to}`);
      } else {
        lines.push(`    ${edge.from} ${style.arrow} ${edge.to}`);
      }
    }

    return {
      code: lines.join('\n'),
      type: 'flowchart',
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    };
  }

  private generateNodeDefinition(mod: V2ModuleNode): string {
    const shape = this.getNodeShape(mod.moduleType);
    const label = this.config.showTypes 
      ? `${mod.name}\\n[${mod.moduleType}]`
      : mod.name;
    
    return `    ${mod.name}${shape.start}"${label}"${shape.end}`;
  }

  private getNodeShape(type: string): { start: string; end: string } {
    switch (type) {
      case 'agent':
        return { start: '([', end: '])' }; // Stadium
      case 'tool':
        return { start: '[[', end: ']]' }; // Subroutine
      case 'memory':
        return { start: '[((', end: '))]' }; // Cylindrical
      case 'workflow':
        return { start: '{{', end: '}}' }; // Hexagon
      case 'team':
        return { start: '{', end: '}' }; // Rhombus
      case 'policy':
        return { start: '>{{', end: '}}>' }; // Flag
      case 'system':
        return { start: '[[[', end: ']]]' }; // Double circle
      default:
        return { start: '(', end: ')' }; // Circle
    }
  }

  private getEdgeStyle(type: string): { arrow: string; end: string } {
    switch (type) {
      case 'handoff':
        return { arrow: '-.->', end: '' };
      case 'dependency':
        return { arrow: '-->', end: '' };
      case 'communication':
        return { arrow: '-.->', end: '' };
      default:
        return { arrow: '-->', end: '' };
    }
  }

  private generateStyles(modules: V2ModuleNode[]): string[] {
    const lines: string[] = [];
    const typeColors: Record<string, string> = {
      agent: '#4CAF50',
      tool: '#2196F3',
      memory: '#FF9800',
      workflow: '#9C27B0',
      team: '#F44336',
      policy: '#795548',
      system: '#607D8B',
      module: '#9E9E9E',
    };

    lines.push('    %% Styles');
    for (const mod of modules) {
      const color = typeColors[mod.moduleType] || '#9E9E9E';
      lines.push(`    style ${mod.moduleType === 'module' ? mod.name : mod.name} fill:${color},stroke:#333,stroke-width:2px`);
    }

    return lines;
  }

  private countEdges(modules: V2ModuleNode[]): number {
    let count = 0;
    for (const mod of modules) {
      if (mod.edges) count += mod.edges.length;
      if (mod.handoff) count += mod.handoff.length;
    }
    return count;
  }
}