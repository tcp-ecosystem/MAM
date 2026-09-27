import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

export interface SVGConfig {
  width?: number;
  height?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  fontSize?: number;
  background?: string;
}

export interface SVGOutput {
  svg: string;
  width: number;
  height: number;
  nodeCount: number;
  edgeCount: number;
}

export const DEFAULT_SVG_COLORS: Record<string, string> = {
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
  step: '#9E9E9E',
  default: '#9E9E9E',
};

export function getSvgColorForType(type: string): string {
  return DEFAULT_SVG_COLORS[type] ?? DEFAULT_SVG_COLORS.default as string;
}

export function sanitizeSvgId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_');
  if (cleaned.length === 0) return 'node';
  if (/^[0-9-]/.test(cleaned)) return `n_${cleaned}`;
  return cleaned;
}

export function createSvgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

export class SVGRenderer {
  private config: Required<SVGConfig>;

  constructor(config: SVGConfig = {}) {
    this.config = {
      width: 900,
      height: 600,
      nodeWidth: 150,
      nodeHeight: 60,
      horizontalGap: 60,
      verticalGap: 80,
      fontSize: 13,
      background: '#ffffff',
      ...config,
    };
  }

  generateFromModules(modules: V2ModuleNode[]): SVGOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const mod of modules) {
      nodes.push({ id: mod.name, label: mod.name, type: mod.moduleType });
      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({ from: edge.source, to: edge.target, label: edge.label, type: 'direct' });
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

  generateFromGraph(data: GraphData): SVGOutput {
    return this.buildOutput(data.nodes, data.edges);
  }

  generateDependencyGraph(modules: V2ModuleNode[]): SVGOutput {
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

  generateWorkflowGraph(modules: V2ModuleNode[]): SVGOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const mod of modules) {
      if (mod.steps) {
        for (const step of mod.steps) {
          nodes.push({ id: `${mod.name}-${step.name}`, label: step.name, type: 'step' });
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

  getConfig(): Required<SVGConfig> {
    return { ...this.config };
  }

  private buildOutput(nodes: GraphNode[], edges: GraphEdge[]): SVGOutput {
    const positions = this.layoutNodes(nodes, edges);
    const parts: string[] = [];
    parts.push(this.renderBackground());
    for (const edge of edges) {
      parts.push(this.renderEdgeSvg(edge, positions));
    }
    for (const node of nodes) {
      const position = positions.get(node.id) ?? { x: 0, y: 0 };
      parts.push(this.renderNodeSvg(node, position.x, position.y));
    }
    parts.push(this.renderLegend(nodes));
    const width = this.config.width;
    const height = this.config.height;
    return {
      svg: createSvgDocument(width, height, parts.join('')),
      width,
      height,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  private renderLegend(nodes: GraphNode[]): string {
    const types = Array.from(new Set(nodes.map((node) => node.type))).sort();
    if (types.length === 0) return '';
    const items = types.map((type, index) => {
      const color = getSvgColorForType(type);
      const y = this.config.height - 20 - index * 22;
      const label = buildSvgTextElement(34, y + 4, type, this.config.fontSize - 2);
      return `<rect x="10" y="${y - 8}" width="14" height="14" fill="${color}"/>${label}`;
    });
    return buildSvgGroup('legend', items.join(''));
  }

  private layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const levels = this.computeLevels(nodes, edges);
    const perLevel = new Map<number, number>();
    const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, nodes.length))));
    nodes.forEach((node, index) => {
      const level = levels.get(node.id) ?? Math.floor(index / columns);
      const slot = perLevel.get(level) ?? 0;
      perLevel.set(level, slot + 1);
      positions.set(node.id, {
        x: 20 + slot * (this.config.nodeWidth + this.config.horizontalGap),
        y: 20 + level * (this.config.nodeHeight + this.config.verticalGap),
      });
    });
    return positions;
  }

  private computeLevels(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
    const levels = new Map<string, number>();
    for (const node of nodes) {
      levels.set(node.id, 0);
    }
    let changed = true;
    let rounds = 0;
    while (changed && rounds < nodes.length + 1) {
      changed = false;
      rounds++;
      for (const edge of edges) {
        const fromLevel = levels.get(edge.from) ?? 0;
        const toLevel = levels.get(edge.to) ?? 0;
        if (toLevel <= fromLevel && levels.has(edge.from) && levels.has(edge.to)) {
          levels.set(edge.to, fromLevel + 1);
          changed = true;
        }
      }
    }
    return levels;
  }

  private renderBackground(): string {
    return `<rect x="0" y="0" width="${this.config.width}" height="${this.config.height}" fill="${escapeSvgAttr(this.config.background)}"/>`;
  }

  private renderNodeSvg(node: GraphNode, x: number, y: number): string {
    const id = sanitizeSvgId(node.id);
    const color = getSvgColorForType(node.type);
    const w = this.config.nodeWidth;
    const h = this.config.nodeHeight;
    const label = escapeSvgText(truncateSvgLabel(node.label, 22));
    const sub = escapeSvgText(node.type);
    const fontSize = this.config.fontSize;
    return `<g id="node-${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2"/><text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" font-size="${fontSize}" font-family="sans-serif" fill="#222">${label}</text><text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="${fontSize - 2}" font-family="sans-serif" fill="#666">${sub}</text></g>`;
  }

  private renderEdgeSvg(edge: GraphEdge, positions: Map<string, { x: number; y: number }>): string {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const x1 = from.x + this.config.nodeWidth / 2;
    const y1 = from.y + this.config.nodeHeight;
    const x2 = to.x + this.config.nodeWidth / 2;
    const y2 = to.y;
    const dash = edge.type === 'handoff' ? ' stroke-dasharray="6,4"' : '';
    const width = edge.type === 'direct' ? 2 : 1.5;
    const label = edge.label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#444">${escapeSvgText(edge.label)}</text>` : '';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="${width}"${dash}/>${label}`;
  }
}

function escapeSvgText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeSvgAttr(text: string): string {
  return escapeSvgText(text).replace(/"/g, '&quot;');
}

function truncateSvgLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 3) + '...';
}

function getSvgNodeShape(type: string): 'rect' | 'ellipse' {
  if (type === 'agent' || type === 'memory') return 'ellipse';
  return 'rect';
}

function getSvgEdgeDash(type: string): string | undefined {
  if (type === 'handoff') return '6,4';
  if (type === 'dependency') return '2,2';
  return undefined;
}

function buildSvgTextElement(x: number, y: number, content: string, fontSize: number): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fontSize}" font-family="sans-serif">${escapeSvgText(content)}</text>`;
}

function buildSvgGroup(id: string, children: string): string {
  return `<g id="${sanitizeSvgId(id)}">${children}</g>`;
}

function countSvgElements(svg: string, tag: string): number {
  const matches = svg.match(new RegExp(`<${tag}[\\s>]`, 'g'));
  return matches ? matches.length : 0;
}

function getSvgViewBox(svg: string): string | undefined {
  const match = svg.match(/viewBox="([^"]*)"/);
  return match ? match[1] : undefined;
}

function getSvgDimensions(svg: string): { width: number; height: number } | undefined {
  const width = svg.match(/width="(\d+)"/);
  const height = svg.match(/height="(\d+)"/);
  if (!width || !height) return undefined;
  return { width: Number(width[1]), height: Number(height[1]) };
}

function hasSvgBackground(svg: string): boolean {
  return /<rect[^>]*fill=/.test(svg);
}
