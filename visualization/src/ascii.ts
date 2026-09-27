/**
 * MAM ASCII Art Generator
 * 
 * Generates ASCII art representations of MAM modules and systems.
 */

import { V2ModuleNode } from '@mam/ast';
import { GraphData } from './graph.js';

// ============================================================================
// Types
// ============================================================================

export interface ASCIIConfig {
  /** Box style */
  style: 'simple' | 'double' | 'rounded' | 'bold';
  /** Show types */
  showTypes: boolean;
  /** Max width */
  maxWidth: number;
}

export interface ASCIIOutput {
  /** ASCII art string */
  art: string;
  /** Width */
  width: number;
  /** Height */
  height: number;
}

// ============================================================================
// ASCII Art Generator
// ============================================================================

export class ASCIIArt {
  private config: ASCIIConfig;

  constructor(config: Partial<ASCIIConfig> = {}) {
    this.config = {
      style: 'simple',
      showTypes: true,
      maxWidth: 80,
      ...config,
    };
  }

  /**
   * Generate ASCII art from modules
   */
  generateFromModules(modules: V2ModuleNode[]): ASCIIOutput {
    const lines: string[] = [];

    // Title
    lines.push(this.box('MAM System', 40, 'title'));
    lines.push('');

    // Modules
    for (const mod of modules) {
      lines.push(this.generateModuleBox(mod));
      lines.push('');
    }

    // Connections
    lines.push(this.generateConnections(modules));

    const art = lines.join('\n');
    return {
      art,
      width: Math.max(...lines.map(l => l.length)),
      height: lines.length,
    };
  }

  /**
   * Generate ASCII art from graph data
   */
  generateFromGraph(graph: GraphData): ASCIIOutput {
    const lines: string[] = [];

    // Title
    lines.push(this.box('MAM System Graph', 40, 'title'));
    lines.push('');

    // Nodes
    lines.push('Nodes:');
    for (const node of graph.nodes) {
      const type = this.config.showTypes ? ` [${node.type}]` : '';
      lines.push(`  • ${node.id}${type}`);
    }
    lines.push('');

    // Edges
    lines.push('Connections:');
    for (const edge of graph.edges) {
      const label = edge.label ? ` (${edge.label})` : '';
      lines.push(`  ${edge.from} --> ${edge.to}${label}`);
    }
    lines.push('');

    // Stats
    lines.push(`Nodes: ${graph.metadata.nodeCount} | Edges: ${graph.metadata.edgeCount}`);

    const art = lines.join('\n');
    return {
      art,
      width: Math.max(...lines.map(l => l.length)),
      height: lines.length,
    };
  }

  private generateModuleBox(mod: V2ModuleNode): string {
    const lines: string[] = [];
    const width = 40;

    // Header
    lines.push(this.box(mod.name, width, 'header'));

    // Type
    if (this.config.showTypes) {
      lines.push(`│ Type: ${mod.moduleType.padEnd(width - 10)}│`);
    }

    // Role
    if (mod.role) {
      lines.push(`│ Role: ${mod.role.padEnd(width - 10)}│`);
    }

    // Goal
    if (mod.goal) {
      const goalText = mod.goal.length > width - 10 ? mod.goal.substring(0, width - 13) + '...' : mod.goal;
      lines.push(`│ Goal: ${goalText.padEnd(width - 10)}│`);
    }

    // Tools
    if (mod.tools && mod.tools.length > 0) {
      lines.push(`│ Tools: ${mod.tools.join(', ').padEnd(width - 11)}│`);
    }

    // Bottom
    lines.push(this.box('', width, 'bottom'));

    return lines.join('\n');
  }

  private generateConnections(modules: V2ModuleNode[]): string {
    const lines: string[] = [];
    lines.push('Connections:');
    
    for (const mod of modules) {
      if (mod.edges) {
        for (const edge of mod.edges) {
          lines.push(`  ${edge.source} --> ${edge.target}`);
        }
      }
      if (mod.handoff) {
        for (const target of mod.handoff) {
          lines.push(`  ${mod.name} -.-> ${target}`);
        }
      }
    }

    return lines.join('\n');
  }

  private box(text: string, width: number, type: 'title' | 'header' | 'bottom'): string {
    const padding = Math.max(0, width - text.length - 4);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;

    switch (type) {
      case 'title':
        return `╔${'═'.repeat(width - 2)}╗\n║${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}║\n╚${'═'.repeat(width - 2)}╝`;
      case 'header':
        return `┌${'─'.repeat(width - 2)}┐\n│${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}│`;
      case 'bottom':
        return `└${'─'.repeat(width - 2)}┘`;
      default:
        return `│${text.padEnd(width - 2)}│`;
    }
  }
}

export function countAsciiLines(output: ASCIIOutput): number {
  if (output.art.length === 0) return 0;
  return output.art.split('\n').length;
}

export function getAsciiDimensions(output: ASCIIOutput): { width: number; height: number } {
  return { width: output.width, height: output.height };
}

export function hasAsciiContent(output: ASCIIOutput): boolean {
  return output.art.trim().length > 0;
}

export function getAsciiLine(output: ASCIIOutput, index: number): string | undefined {
  return output.art.split('\n')[index];
}

export function sliceAsciiLines(output: ASCIIOutput, start: number, end: number): string {
  return output.art.split('\n').slice(start, end).join('\n');
}

export function joinAsciiOutputs(outputs: ASCIIOutput[]): ASCIIOutput {
  const arts = outputs.map((output) => output.art).filter((art) => art.length > 0);
  const art = arts.join('\n');
  const lines = art.length === 0 ? [] : art.split('\n');
  return {
    art,
    width: lines.reduce((max, line) => Math.max(max, line.length), 0),
    height: lines.length,
  };
}

export function getAsciiLineWidths(output: ASCIIOutput): number[] {
  if (output.art.length === 0) return [];
  return output.art.split('\n').map((line) => line.length);
}