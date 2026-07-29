/**
 * Mermaid Plugin - Diagram Validation
 */

export const VALID_DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
  'mindmap', 'timeline', 'block-beta', 'journey', 'quadrantChart',
  'requirementDiagram', 'xychart', 'sankey', 'architecture',
] as const;

export type MermaidDiagramType = (typeof VALID_DIAGRAM_TYPES)[number];

export interface MermaidValidationResult {
  valid: boolean;
  diagramType: MermaidDiagramType | 'unknown';
  message?: string;
  lineCount: number;
  nodeCount: number;
  hasSubgraphs: boolean;
  hasArrows: boolean;
}

export function detectDiagramType(code: string): MermaidDiagramType | 'unknown' {
  const firstLine = code.trim().split('\n')[0]!.trim();
  for (const dt of VALID_DIAGRAM_TYPES) {
    if (firstLine.startsWith(dt)) return dt;
  }
  return 'unknown';
}

export function countNodes(code: string): number {
  const lines = code.trim().split('\n').slice(1);
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%') || trimmed.startsWith('---')) continue;
    if (/[A-Za-z0-9_]+[\[\(\{]/.test(trimmed)) count++;
  }
  return Math.max(count, 1);
}

export function hasSubgraphs(code: string): boolean {
  return /\bsubgraph\b/.test(code);
}

export function hasArrows(code: string): boolean {
  return /-->|-->|==>|---|-\->|-->|-->/.test(code);
}

export function validateMermaidDiagram(code: string): MermaidValidationResult {
  const trimmed = code.trim();
  const lineCount = trimmed.split('\n').length;

  if (trimmed.length === 0) {
    return { valid: false, diagramType: 'unknown', message: 'Empty diagram', lineCount: 0, nodeCount: 0, hasSubgraphs: false, hasArrows: false };
  }

  const diagramType = detectDiagramType(trimmed);
  const nodeCount = countNodes(trimmed);
  const subgraphs = hasSubgraphs(trimmed);
  const arrows = hasArrows(trimmed);

  const valid = diagramType !== 'unknown' && nodeCount > 0;

  return {
    valid,
    diagramType,
    lineCount,
    nodeCount,
    hasSubgraphs: subgraphs,
    hasArrows: arrows,
  };
}

export function getDiagramTypeLabel(type: MermaidDiagramType | 'unknown'): string {
  const labels: Record<string, string> = {
    flowchart: 'Flowchart',
    graph: 'Graph',
    sequenceDiagram: 'Sequence Diagram',
    classDiagram: 'Class Diagram',
    stateDiagram: 'State Diagram',
    erDiagram: 'ER Diagram',
    gantt: 'Gantt Chart',
    pie: 'Pie Chart',
    gitgraph: 'Git Graph',
    mindmap: 'Mind Map',
    timeline: 'Timeline',
    'block-beta': 'Block Diagram',
    journey: 'User Journey',
    quadrantChart: 'Quadrant Chart',
    requirementDiagram: 'Requirement Diagram',
    xychart: 'XY Chart',
    sankey: 'Sankey Diagram',
    architecture: 'Architecture Diagram',
  };
  return labels[type] || 'Unknown';
}
