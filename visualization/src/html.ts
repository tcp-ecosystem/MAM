/**
 * MAM HTML Renderer
 *
 * Generates interactive HTML/SVG graph visualizations from MAM modules.
 */

import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

// ============================================================================
// Types
// ============================================================================

export interface HTMLConfig {
  /** Page title */
  title?: string;
  /** Color theme */
  theme?: 'light' | 'dark' | 'auto';
  /** Layout algorithm */
  layout?: 'dagre' | 'force' | 'circular' | 'tree';
  /** Canvas width in pixels */
  width?: number;
  /** Canvas height in pixels */
  height?: number;
  /** Enable interactive features (drag, zoom, tooltips) */
  interactive?: boolean;
  /** Show node labels */
  showLabels?: boolean;
  /** Show edge labels */
  showEdgeLabels?: boolean;
  /** Node visual style */
  nodeStyle?: HTMLNodeStyle;
  /** Edge visual style */
  edgeStyle?: HTMLNodeStyle;
  /** Custom CSS injected into <style> */
  css?: string;
  /** External script URLs to include */
  scripts?: string[];
}

export interface HTMLNodeStyle {
  color?: string;
  shape?: 'rect' | 'circle' | 'diamond' | 'ellipse';
  fontSize?: number;
  borderWidth?: number;
}

export interface HTMLOutput {
  /** Complete HTML document */
  html: string;
  /** Stylesheet content */
  css: string;
  /** Script content / URLs */
  scripts: string[];
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

const THEME_COLORS: Record<string, { bg: string; text: string; border: string; canvas: string }> = {
  light: { bg: '#ffffff', text: '#1a1a1a', border: '#cccccc', canvas: '#f8f9fa' },
  dark: { bg: '#1e1e1e', text: '#e0e0e0', border: '#444444', canvas: '#121212' },
  auto: { bg: '#ffffff', text: '#1a1a1a', border: '#cccccc', canvas: '#f8f9fa' },
};

// ============================================================================
// HTML Renderer
// ============================================================================

export class HTMLRenderer {
  private config: Required<HTMLConfig>;

  constructor(config: HTMLConfig = {}) {
    this.config = {
      title: 'MAM Graph',
      theme: 'light',
      layout: 'dagre',
      width: 960,
      height: 600,
      interactive: true,
      showLabels: true,
      showEdgeLabels: true,
      nodeStyle: {},
      edgeStyle: {},
      css: '',
      scripts: [],
      ...config,
    };
  }

  /**
   * Generate HTML from modules
   */
  generateFromModules(modules: V2ModuleNode[]): HTMLOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const mod of modules) {
      nodes.push({
        id: mod.name,
        label: this.config.showLabels ? mod.name : mod.name.substring(0, 3),
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
   * Generate HTML from graph data
   */
  generateFromGraph(data: GraphData): HTMLOutput {
    return this.buildOutput(data.nodes, data.edges);
  }

  /**
   * Generate dependency graph HTML
   */
  generateDependencyGraph(modules: V2ModuleNode[]): HTMLOutput {
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
   * Generate workflow graph HTML
   */
  generateWorkflowGraph(modules: V2ModuleNode[]): HTMLOutput {
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

  private buildOutput(nodes: GraphNode[], edges: GraphEdge[]): HTMLOutput {
    const svg = this.generateSVG(nodes, edges);
    const css = this.generateStyles();
    const script = this.generateInteractiveScript();

    const scripts = [...this.config.scripts];
    if (this.config.interactive) {
      scripts.push(script);
    }

    const themeColors = THEME_COLORS[this.config.theme] || THEME_COLORS.light;

    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `  <title>${this.escapeHTML(this.config.title)}</title>`,
      `  <style>${css}</style>`,
      `  <style>body{background:${themeColors.canvas};color:${themeColors.text};}</style>`,
      this.config.css ? `  <style>${this.config.css}</style>` : '',
      '</head>',
      '<body>',
      `  <div class="mam-graph-container" style="width:${this.config.width}px;height:${this.config.height}px;">`,
      `    <h1 class="mam-graph-title">${this.escapeHTML(this.config.title)}</h1>`,
      `    <div class="mam-graph-viewport">${svg}</div>`,
      '  </div>',
      scripts.map(s => s.startsWith('<') || s.startsWith('http') ? `  <script src="${this.escapeHTML(s)}"></script>` : `  <script>${s}</script>`).join('\n'),
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n');

    return { html, css, scripts };
  }

  generateSVG(nodes: GraphNode[], edges: GraphEdge[]): string {
    const positions = this.layoutNodes(nodes, edges);
    const themeColors = THEME_COLORS[this.config.theme] || THEME_COLORS.light;

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.config.width} ${this.config.height}" width="${this.config.width}" height="${this.config.height}">`,
      `  <defs>`,
      `    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`,
      `      <polygon points="0 0, 10 3.5, 0 7" fill="${themeColors.border}" />`,
      `    </marker>`,
      `    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">`,
      `      <feDropShadow dx="1" dy="1" stdDeviation="2" flood-opacity="0.15" />`,
      `    </filter>`,
      `  </defs>`,
    ];

    // Render edges
    for (const edge of edges) {
      const fromPos = positions.get(edge.from);
      const toPos = positions.get(edge.to);
      if (!fromPos || !toPos) continue;

      const style = this.getEdgeStyle(edge.type);
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2;

      parts.push(`  <line x1="${fromPos.x}" y1="${fromPos.y}" x2="${toPos.x}" y2="${toPos.y}" stroke="${style.color}" stroke-width="${style.width}" ${style.dasharray ? `stroke-dasharray="${style.dasharray}"` : ''} marker-end="url(#arrowhead)" class="mam-edge" data-from="${this.escapeAttr(edge.from)}" data-to="${this.escapeAttr(edge.to)}" />`);

      if (this.config.showEdgeLabels && edge.label) {
        parts.push(`  <text x="${midX}" y="${midY - 6}" text-anchor="middle" class="mam-edge-label" font-size="11" fill="${themeColors.text}">${this.escapeHTML(edge.label)}</text>`);
      }
    }

    // Render nodes
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;

      const color = TYPE_COLORS[node.type] || '#9E9E9E';
      const shape = this.config.nodeStyle?.shape || this.getShapeForType(node.type);
      const nodeW = 140;
      const nodeH = 40;

      parts.push(this.renderNodeSVG(node, pos.x, pos.y, nodeW, nodeH, color, themeColors));
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  private renderNodeSVG(node: GraphNode, x: number, y: number, w: number, h: number, color: string, themeColors: { bg: string; text: string; border: string; canvas: string }): string {
    const hw = w / 2;
    const hh = h / 2;
    const fontSize = this.config.nodeStyle?.fontSize || 13;
    const borderWidth = this.config.nodeStyle?.borderWidth || 2;

    let shapeEl: string;
    switch (this.config.nodeStyle?.shape || 'rect') {
      case 'circle':
        shapeEl = `<circle cx="${x}" cy="${y}" r="${hw * 0.6}" fill="${themeColors.bg}" stroke="${color}" stroke-width="${borderWidth}" filter="url(#shadow)" />`;
        break;
      case 'ellipse':
        shapeEl = `<ellipse cx="${x}" cy="${y}" rx="${hw}" ry="${hh}" fill="${themeColors.bg}" stroke="${color}" stroke-width="${borderWidth}" filter="url(#shadow)" />`;
        break;
      case 'diamond':
        shapeEl = `<polygon points="${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}" fill="${themeColors.bg}" stroke="${color}" stroke-width="${borderWidth}" filter="url(#shadow)" />`;
        break;
      default:
        shapeEl = `<rect x="${x - hw}" y="${y - hh}" width="${w}" height="${h}" rx="6" fill="${themeColors.bg}" stroke="${color}" stroke-width="${borderWidth}" filter="url(#shadow)" />`;
    }

    const label = this.config.showLabels ? this.escapeHTML(node.label) : '';
    const typeBadge = this.config.showLabels ? `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="${fontSize - 2}" fill="${color}" class="mam-node-type">${this.escapeHTML(node.type)}</text>` : '';
    const textEl = this.config.showLabels
      ? `<text x="${x}" y="${y - 6}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="${themeColors.text}" class="mam-node-label">${label}</text>`
      : '';

    return `  <g class="mam-node" data-id="${this.escapeAttr(node.id)}" data-type="${this.escapeAttr(node.type)}">\n    ${shapeEl}\n    ${textEl}\n    ${typeBadge}\n  </g>`;
  }

  private layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const n = nodes.length;
    if (n === 0) return positions;

    const padding = 60;
    const areaW = this.config.width - padding * 2;
    const areaH = this.config.height - padding * 2;

    switch (this.config.layout) {
      case 'circular': {
        const cx = this.config.width / 2;
        const cy = this.config.height / 2;
        const r = Math.min(areaW, areaH) / 2;
        nodes.forEach((node, i) => {
          const angle = (2 * Math.PI * i) / n - Math.PI / 2;
          positions.set(node.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        });
        break;
      }
      case 'force':
      case 'dagre':
      default: {
        // Simple layered layout: group by depth from roots
        const adj = new Map<string, string[]>();
        const inDeg = new Map<string, number>();
        for (const node of nodes) {
          adj.set(node.id, []);
          inDeg.set(node.id, 0);
        }
        for (const edge of edges) {
          adj.get(edge.from)?.push(edge.to);
          inDeg.set(edge.to, (inDeg.get(edge.to) || 0) + 1);
        }

        const layers: string[][] = [];
        const queue = nodes.filter(n => (inDeg.get(n.id) || 0) === 0).map(n => n.id);
        const visited = new Set<string>();

        while (queue.length > 0) {
          layers.push([...queue]);
          const next: string[] = [];
          for (const id of queue) {
            if (visited.has(id)) continue;
            visited.add(id);
            for (const neighbor of adj.get(id) || []) {
              const deg = (inDeg.get(neighbor) || 1) - 1;
              inDeg.set(neighbor, deg);
              if (deg <= 0) next.push(neighbor);
            }
          }
          queue.length = 0;
          queue.push(...next);
        }

        // Add any unvisited nodes
        const remaining = nodes.filter(n => !visited.has(n.id));
        if (remaining.length > 0) {
          layers.push(remaining.map(n => n.id));
        }

        const maxLayers = layers.length || 1;
        layers.forEach((layer, layerIdx) => {
          const y = padding + (layerIdx / (maxLayers - 1 || 1)) * areaH;
          layer.forEach((id, nodeIdx) => {
            const x = padding + ((nodeIdx + 0.5) / layer.length) * areaW;
            positions.set(id, { x, y });
          });
        });
        break;
      }
      case 'tree': {
        const adj = new Map<string, string[]>();
        for (const node of nodes) adj.set(node.id, []);
        for (const edge of edges) adj.get(edge.from)?.push(edge.to);

        const roots = nodes.filter(n => !edges.some(e => e.to === n.id));
        if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

        const assignPositions = (nodeIds: string[], depth: number, startIdx: number): number => {
          if (nodeIds.length === 0) return startIdx;
          const y = padding + (depth / (nodes.length || 1)) * areaH;
          let idx = startIdx;
          for (const id of nodeIds) {
            const children = adj.get(id) || [];
            const childCount = this.countDescendants(id, adj, new Set());
            const span = Math.max(1, childCount);
            const x = padding + ((idx + span / 2) / nodes.length) * areaW;
            positions.set(id, { x, y });
            idx = assignPositions(children, depth + 1, idx);
          }
          return idx;
        };

        assignPositions(roots.map(r => r.id), 0, 0);

        // Place any remaining nodes in a row
        for (const node of nodes) {
          if (!positions.has(node.id)) {
            const idx = [...positions.keys()].length;
            const y = padding + areaH;
            const x = padding + ((idx + 0.5) / nodes.length) * areaW;
            positions.set(node.id, { x, y });
          }
        }
        break;
      }
    }

    return positions;
  }

  private countDescendants(id: string, adj: Map<string, string[]>, visited: Set<string>): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    let count = 1;
    for (const child of adj.get(id) || []) {
      count += this.countDescendants(child, adj, visited);
    }
    return count;
  }

  private getShapeForType(type: string): 'rect' | 'circle' | 'diamond' | 'ellipse' {
    switch (type) {
      case 'agent': return 'ellipse';
      case 'tool': return 'rect';
      case 'memory': return 'circle';
      case 'workflow': return 'diamond';
      default: return 'rect';
    }
  }

  private getEdgeStyle(type: string): { color: string; width: number; dasharray?: string } {
    switch (type) {
      case 'handoff': return { color: '#FF9800', width: 2, dasharray: '6,3' };
      case 'dependency': return { color: '#2196F3', width: 1.5, dasharray: '4,4' };
      case 'communication': return { color: '#9C27B0', width: 1.5, dasharray: '8,4' };
      default: return { color: '#666666', width: 2 };
    }
  }

  generateStyles(): string {
    const themeColors = THEME_COLORS[this.config.theme] || THEME_COLORS.light;
    return `
      .mam-graph-container { position: relative; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .mam-graph-title { text-align: center; margin: 12px 0; font-size: 18px; color: ${themeColors.text}; }
      .mam-graph-viewport { overflow: auto; border: 1px solid ${themeColors.border}; border-radius: 8px; background: ${themeColors.canvas}; }
      .mam-node { cursor: pointer; transition: transform 0.15s ease; }
      .mam-node:hover { transform: scale(1.05); }
      .mam-edge { transition: stroke-width 0.15s ease; }
      .mam-edge:hover { stroke-width: 3; }
      .mam-node-label { pointer-events: none; user-select: none; }
      .mam-node-type { pointer-events: none; user-select: none; opacity: 0.7; }
      .mam-edge-label { pointer-events: none; user-select: none; }
      .mam-tooltip { position: absolute; background: ${themeColors.bg}; color: ${themeColors.text}; border: 1px solid ${themeColors.border}; border-radius: 6px; padding: 8px 12px; font-size: 12px; pointer-events: none; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15); max-width: 250px; }
    `.trim();
  }

  generateInteractiveScript(): string {
    return `
(function(){
  var nodes=document.querySelectorAll('.mam-node');
  var viewport=document.querySelector('.mam-graph-viewport');
  if(!viewport)return;
  var tip=document.createElement('div');
  tip.className='mam-tooltip';
  tip.style.display='none';
  viewport.appendChild(tip);
  nodes.forEach(function(n){
    n.addEventListener('mouseenter',function(e){
      var id=n.getAttribute('data-id');
      var type=n.getAttribute('data-type');
      tip.innerHTML='<strong>'+id+'</strong><br><em>'+type+'</em>';
      tip.style.display='block';
    });
    n.addEventListener('mousemove',function(e){
      var rect=viewport.getBoundingClientRect();
      tip.style.left=(e.clientX-rect.left+12)+'px';
      tip.style.top=(e.clientY-rect.top-10)+'px';
    });
    n.addEventListener('mouseleave',function(){tip.style.display='none';});
  });
  var scale=1;
  viewport.addEventListener('wheel',function(e){
    if(e.ctrlKey||e.metaKey){
      e.preventDefault();
      scale+=e.deltaY>0?-0.1:0.1;
      scale=Math.max(0.2,Math.min(3,scale));
      var svg=viewport.querySelector('svg');
      if(svg)svg.style.transform='scale('+scale+')';
    }
  },{passive:false});
})();
    `.trim();
  }

  private escapeHTML(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

export function extractSvgNodeIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const pattern = /<g[^>]*data-id="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const id = match[1] as string;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function hasHtmlNode(html: string, id: string): boolean {
  if (extractSvgNodeIds(html).includes(id)) return true;
  return html.includes(`>${id}<`) || html.includes(`"${id}"`);
}

export function countHtmlScriptTags(output: HTMLOutput): number {
  const matches = output.html.match(/<script[\s>]/gi);
  return (matches ? matches.length : 0) + output.scripts.length;
}

export function getHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? (match[1] as string) : undefined;
}

export function hasDarkTheme(css: string): boolean {
  return /background\s*:\s*#([0-9a-f]{3}|[0-9a-f]{6})\b/i.test(css) &&
    css.toLowerCase().includes('color');
}

export function countCssRules(css: string): number {
  const matches = css.match(/\{[^}]*\}/g);
  return matches ? matches.length : 0;
}

export function isCompleteHtmlDocument(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('<!doctype html') && lower.includes('<html') &&
    lower.includes('</html>') && lower.includes('<body');
}
