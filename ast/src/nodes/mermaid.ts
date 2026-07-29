/**
 * MAM Mermaid Diagram Node
 *
 * Defines the MermaidNode and related types for Mermaid diagram sections.
 * Wraps a Mermaid code block with diagram-type detection, metadata about
 * nodes and edges, and validation helpers.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Supported Mermaid diagram types (section-level). */
export type SectionDiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'gantt'
  | 'pie'
  | 'gitgraph'
  | 'mindmap'
  | 'timeline'
  | 'journey'
  | 'requirement'
  | 'unknown';

/** Direction hint for flowchart / graph diagrams. */
export type MermaidDirection =
  | 'TB'
  | 'TD'
  | 'BT'
  | 'LR'
  | 'RL';

/** A parsed node from a Mermaid diagram. */
export interface MermaidParsedNode {
  /** Node identifier in the diagram. */
  id: string;
  /** Display label. */
  label?: string;
  /** Node shape type (e.g. "rectangle", "diamond", "circle"). */
  shape?: string;
}

/** A parsed edge from a Mermaid diagram. */
export interface MermaidParsedEdge {
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Edge label. */
  label?: string;
  /** Edge style (e.g. "solid", "dashed", "dotted"). */
  style?: string;
}

/** Metadata about the diagram content. */
export interface MermaidDiagramMetadata {
  /** Number of nodes detected. */
  nodeCount: number;
  /** Number of edges detected. */
  edgeCount: number;
  /** Detected diagram direction (flowchart/graph only). */
  direction?: MermaidDirection;
  /** Whether the diagram has syntax issues (best-effort). */
  hasSyntaxIssues?: boolean;
}

/** The Mermaid section AST node. */
export interface MermaidNode {
  /** Discriminant – always `'Mermaid'`. */
  type: 'Mermaid';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Detected diagram type. */
  diagramType: SectionDiagramType;
  /** Raw Mermaid content string. */
  content: string;
  /** Parsed nodes (best-effort). */
  parsedNodes?: MermaidParsedNode[];
  /** Parsed edges (best-effort). */
  parsedEdges?: MermaidParsedEdge[];
  /** Diagram metadata. */
  metadata?: MermaidDiagramMetadata;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

const DIAGRAM_TYPE_KEYWORDS: Record<string, SectionDiagramType> = {
  flowchart: 'flowchart',
  graph: 'flowchart',
  sequenceDiagram: 'sequence',
  sequence: 'sequence',
  classDiagram: 'class',
  class: 'class',
  stateDiagram: 'state',
  state: 'state',
  erDiagram: 'er',
  er: 'er',
  gantt: 'gantt',
  pie: 'pie',
  gitGraph: 'gitgraph',
  mindmap: 'mindmap',
  timeline: 'timeline',
  journey: 'journey',
  requirementDiagram: 'requirement',
};

/**
 * Detect the Mermaid diagram type from the raw content string.
 */
export function detectDiagramType(content: string): SectionDiagramType {
  const trimmed = content.trim();
  for (const [keyword, type] of Object.entries(DIAGRAM_TYPE_KEYWORDS)) {
    if (trimmed.startsWith(keyword) || trimmed.includes(`${keyword} `)) {
      return type;
    }
  }
  return 'unknown';
}

/**
 * Detect the diagram direction from the raw content.
 */
export function detectDiagramDirection(content: string): MermaidDirection | undefined {
  const match = content.match(/(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/);
  return match ? (match[1] as MermaidDirection) : undefined;
}

/**
 * Best-effort node extraction from raw Mermaid content.
 * Returns a list of node ids and labels.
 */
export function parseNodes(content: string): MermaidParsedNode[] {
  const nodes: MermaidParsedNode[] = [];
  const nodePattern = /^\s*(\w+)\s*\[([^\]]+)\]/gm;
  const idOnlyPattern = /^\s*(\w+)\s*$/gm;

  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = nodePattern.exec(content)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({ id, label: match[2], shape: 'rectangle' });
    }
  }

  const diamondPattern = /^\s*(\w+)\s*\{([^}]+)\}/gm;
  while ((match = diamondPattern.exec(content)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({ id, label: match[2], shape: 'diamond' });
    }
  }

  const circlePattern = /^\s*(\w+)\s*\(([^)]+)\)/gm;
  while ((match = circlePattern.exec(content)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({ id, label: match[2], shape: 'circle' });
    }
  }

  while ((match = idOnlyPattern.exec(content)) !== null) {
    const id = match[1];
    if (!seen.has(id) && id !== 'end' && id !== 'subgraph') {
      seen.add(id);
      nodes.push({ id, shape: 'id' });
    }
  }

  return nodes;
}

/**
 * Best-effort edge extraction from raw Mermaid content.
 */
export function parseEdges(content: string): MermaidParsedEdge[] {
  const edges: MermaidParsedEdge[] = [];
  const edgePattern = /(\w+)(?:\[([^\]]*)\])?\s*-->(?:\s*\|([^|]*)\|)?\s*(\w+)(?:\[([^\]]*)\])?/g;

  let match: RegExpExecArray | null;
  while ((match = edgePattern.exec(content)) !== null) {
    edges.push({
      from: match[1],
      to: match[4],
      label: match[3]?.trim() || undefined,
    });
  }

  return edges;
}

/**
 * Compute diagram metadata from the raw content.
 */
export function computeDiagramMetadata(content: string): MermaidDiagramMetadata {
  const parsedNodes = parseNodes(content);
  const parsedEdges = parseEdges(content);
  const direction = detectDiagramDirection(content);

  return {
    nodeCount: parsedNodes.length,
    edgeCount: parsedEdges.length,
    direction,
  };
}

/**
 * Validate a MermaidNode.
 * Returns an empty array when the node is valid.
 */
export function validateMermaidNode(node: MermaidNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'MermaidNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Mermaid') {
    errors.push({ path: 'type', message: `Expected type "Mermaid", got "${node.type}".` });
  }

  if (!node.content || typeof node.content !== 'string') {
    errors.push({ path: 'content', message: 'content must be a non-empty string.' });
  }

  if (!node.diagramType || typeof node.diagramType !== 'string') {
    errors.push({ path: 'diagramType', message: 'diagramType must be a non-empty string.' });
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateMermaidNodeOptions {
  content: string;
  diagramType?: SectionDiagramType;
  location?: SourceLocation;
  autoParse?: boolean;
}

/** Create a MermaidNode with optional auto-parsing. */
export function createMermaidNode(options: CreateMermaidNodeOptions): MermaidNode {
  const diagramType = options.diagramType ?? detectDiagramType(options.content);
  const node: MermaidNode = {
    type: 'Mermaid',
    diagramType,
    content: options.content,
    location: options.location,
  };

  if (options.autoParse !== false) {
    node.parsedNodes = parseNodes(options.content);
    node.parsedEdges = parseEdges(options.content);
    node.metadata = computeDiagramMetadata(options.content);
  }

  return node;
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a MermaidNode. */
export function isMermaidNode(value: unknown): value is MermaidNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as MermaidNode).type === 'Mermaid' &&
    typeof (value as MermaidNode).content === 'string'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all parsed node ids. */
export function getMermaidNodeIds(node: MermaidNode): string[] {
  return (node.parsedNodes ?? []).map((n) => n.id);
}

/** Return all parsed edge source-target pairs. */
export function getMermaidEdgePairs(node: MermaidNode): Array<{ from: string; to: string }> {
  return (node.parsedEdges ?? []).map((e) => ({ from: e.from, to: e.to }));
}

/** Check whether the diagram contains a specific node id. */
export function hasMermaidNode(node: MermaidNode, id: string): boolean {
  return (node.parsedNodes ?? []).some((n) => n.id === id);
}

/** Count nodes and edges. */
export function countMermaidElements(node: MermaidNode): { nodes: number; edges: number } {
  return {
    nodes: node.parsedNodes?.length ?? 0,
    edges: node.parsedEdges?.length ?? 0,
  };
}
