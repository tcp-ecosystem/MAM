/**
 * Mermaid Plugin - Diagram Validation
 *
 * Structural checks on Mermaid source, done without executing Mermaid itself.
 * A real render is the only way to be certain, so these checks target the
 * mistakes that are reliably detectable by inspection: an unrecognised header,
 * an unclosed `subgraph`, an empty body.
 */

export const VALID_DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
  'mindmap', 'timeline', 'block-beta', 'journey', 'quadrantChart',
  'requirementDiagram', 'xychart', 'sankey', 'architecture',
] as const;

export type MermaidDiagramType = (typeof VALID_DIAGRAM_TYPES)[number];

/**
 * Header variants that mermaid accepts as a separate type.
 *
 * `stateDiagram-v2` is a distinct renderer from `stateDiagram`, so detecting it
 * as the older form would report a diagram as valid when it uses v2-only syntax.
 */
export const DIAGRAM_TYPE_VARIANTS = ['stateDiagram-v2'] as const;

export type MermaidDiagramVariant = (typeof DIAGRAM_TYPE_VARIANTS)[number];

/** Any header this plugin recognises. */
export type MermaidHeader = MermaidDiagramType | MermaidDiagramVariant | 'unknown';

export type MermaidIssueSeverity = 'error' | 'warning' | 'info';

export interface MermaidIssue {
  severity: MermaidIssueSeverity;
  /** Machine-readable code, e.g. `unknown-type`. */
  code: string;
  message: string;
  /** 1-based line number within the diagram source. */
  line?: number;
  /** The offending text, when it fits on one line. */
  excerpt?: string;
}

export interface MermaidValidationResult {
  valid: boolean;
  diagramType: MermaidHeader;
  message?: string;
  lineCount: number;
  nodeCount: number;
  hasSubgraphs: boolean;
  hasArrows: boolean;
  /** Every problem found, most severe first. */
  issues: MermaidIssue[];
  /** Distinct node identifiers referenced by the diagram. */
  nodes: string[];
  /** Unclosed `subgraph` depth at end of input, or 0 when balanced. */
  unclosedSubgraphs: number;
}

const LABELS: Record<string, string> = {
  flowchart: 'Flowchart',
  graph: 'Graph',
  sequenceDiagram: 'Sequence Diagram',
  classDiagram: 'Class Diagram',
  stateDiagram: 'State Diagram',
  'stateDiagram-v2': 'State Diagram (v2)',
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

// ─── Source Preprocessing ─────────────────────────────────────────

/**
 * Removes `%%` comments and the `%%{init: ...}%%` directive block.
 *
 * A directive can sit on the first line, ahead of the real header, so it has
 * to go before type detection or `stateDiagram-v2` reads as unknown.
 */
export function stripComments(code: string): string {
  return code.replace(/^\s*%%\{\s*init:[\s\S]*?\}%%\s*$/gm, '').replace(/%%[^\n]*/g, '');
}

/** Pulls the Mermaid code blocks out of a content list. */
export function extractMermaidBlocks(
  content: Array<{ type?: string; language?: string; value?: string }>,
): string[] {
  const blocks: string[] = [];
  for (const node of content) {
    if (node.type === 'CodeBlock' && node.language === 'mermaid') {
      blocks.push(node.value ?? '');
    }
  }
  return blocks;
}

/** Returns the diagram's lines with comments removed, preserving line numbers. */
export function getCodeLines(code: string): string[] {
  return stripComments(code).split('\n');
}

/** Removes a leading `---` frontmatter fence if present. */
function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end !== -1) return lines.slice(end + 1);
  }
  return lines;
}

// ─── Type Detection ───────────────────────────────────────────────

/**
 * Detects the diagram header.
 *
 * Matches the whole first word, so `graphicalLayout` is not read as `graph`.
 * Matching longest-first keeps `stateDiagram-v2` from being read as
 * `stateDiagram`.
 */
export function detectDiagramType(code: string): MermaidHeader {
  const lines = stripFrontmatter(getCodeLines(code));
  let firstLine = (lines.find((line) => line.trim().length > 0) ?? '').trim();
  if (!firstLine) return 'unknown';

  // Mermaid allows a direction/flags suffix on the same line (`graph TD`).
  const header = firstLine.split(/[\s:]/)[0]!;

  for (const variant of DIAGRAM_TYPE_VARIANTS) {
    if (header === variant) return variant;
  }
  for (const type of VALID_DIAGRAM_TYPES) {
    if (header === type) return type;
  }

  // Fall back to a prefix match, but only for headers that genuinely extend a
  // known type (e.g. `flowchart-elk`).
  const base = header.replace(/-[a-z0-9]+$/i, '');
  if ((VALID_DIAGRAM_TYPES as readonly string[]).includes(base)) return base as MermaidDiagramType;
  return 'unknown';
}

/** Returns a human label for a diagram header. */
export function getDiagramTypeLabel(type: MermaidHeader): string {
  return LABELS[type] || 'Unknown';
}

// ─── Structure Extraction ─────────────────────────────────────────

/**
 * Mermaid edge operators.
 *
 * Covers solid (`-->`, `---`), dotted (`-.->`, `-.x`), thick (`==>`), and the
 * open (`--o`, `--x`) and double-arrow (`-->>`) forms. A previous version used
 * a `-\->` character class, which matches a literal dash, so every dotted arrow
 * went undetected.
 *
 * Deliberately has no capture groups: `String.split` with a capturing regex
 * splices the groups into the output, which was swallowing the node on the far
 * side of an arrow. Longest alternatives come first because alternation is
 * first-match-wins.
 */
const EDGE_PATTERN = /\.-+[ox]?[>x]?|-{2,}>+|-{2,}[ox]|={2,}>|={2,}|-{2,}/;

/** Matches a node token with an optional label, e.g. `A[Label]` or `B((x))`. */
const NODE_WITH_LABEL = /([A-Za-z_][\w-]*)[\s]*(\[\[|\[\(|\(\(|\[|\(|\{)/g;

/** A bare node reference: a bare identifier, or one wrapped in an edge. */
const BARE_NODE = /^[A-Za-z_][\w-]*$/;

/**
 * Extracts the distinct node identifiers a diagram references.
 *
 * Counts bare `A-->B` nodes as well as labelled `A[Label]` ones; a bracket-only
 * match ignored every unlabelled node, which is the most common way to write a
 * flowchart. Keys the label text so `A[x]` and `A[y]` stay one node.
 */
export function extractNodes(code: string): string[] {
  const nodes = new Set<string>();
  const lines = getCodeLines(code);

  for (let i = 0; i < lines.length; i++) {
    const line = stripFrontmatter(lines).slice(i)[0] ?? lines[i]!;
    if (i === 0 && lines[0]?.trim() === '') continue;
    if (/^\s*(subgraph|end|direction|classDef|class|style|linkStyle|click)\b/.test(line)) continue;

    for (const match of line.matchAll(NODE_WITH_LABEL)) {
      nodes.add(match[1]!);
    }

    // Strip labelled nodes, then look at what remains around the edges.
    const remainder = line.replace(NODE_WITH_LABEL, ' ');
    for (const segment of remainder.split(EDGE_PATTERN)) {
      const token = segment?.trim();
      if (token && BARE_NODE.test(token)) nodes.add(token);
    }
  }
  return [...nodes].sort();
}

/** Counts the node declarations on a line, for the simple counter. */
export function countNodes(code: string): number {
  return extractNodes(code).length;
}

/** Counts edge operators in the diagram. */
export function countArrows(code: string): number {
  let total = 0;
  for (const line of getCodeLines(code)) {
    total += (line.match(new RegExp(EDGE_PATTERN.source, 'g')) || []).length;
  }
  return total;
}

/** Returns true when the diagram contains at least one edge. */
export function hasArrows(code: string): boolean {
  return countArrows(code) > 0;
}

/** Returns true when the diagram opens a `subgraph`. */
export function hasSubgraphs(code: string): boolean {
  return /^\s*subgraph\b/m.test(stripComments(code));
}

/**
 * Returns how many `subgraph` blocks are still open at the end of input.
 *
 * An unclosed subgraph is the single most common Mermaid authoring mistake and
 * makes the whole diagram fail to render.
 */
export function countUnclosedSubgraphs(code: string): number {
  let depth = 0;
  let lowest = 0;
  for (const line of getCodeLines(code)) {
    if (/^\s*subgraph\b/.test(line)) depth++;
    else if (/^\s*end\b/.test(line)) {
      depth--;
      if (depth < lowest) lowest = depth;
    }
  }
  return Math.max(depth, 0);
}

/** Returns true when every `subgraph` has a matching `end`. */
export function hasBalancedSubgraphs(code: string): boolean {
  let depth = 0;
  for (const line of getCodeLines(code)) {
    if (/^\s*subgraph\b/.test(line)) depth++;
    else if (/^\s*end\b/.test(line)) depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Returns the 1-based line numbers of `subgraph` openings. */
export function findSubgraphLines(code: string): number[] {
  return getCodeLines(code)
    .map((line, index) => (/^\s*subgraph\b/.test(line) ? index + 1 : 0))
    .filter((line) => line > 0);
}

/** Returns the first non-empty line, which holds the diagram header. */
export function getHeaderLine(code: string): string {
  const lines = stripFrontmatter(getCodeLines(code));
  return (lines.find((line) => line.trim().length > 0) ?? '').trim();
}

// ─── Validation ───────────────────────────────────────────────────

export interface MermaidValidationOptions {
  /** Reject a diagram with no nodes. Default true. */
  requireNodes?: boolean;
  /** Reject a diagram with no edges. Default false, since some types have none. */
  requireEdges?: boolean;
  /** Reject an unclosed `subgraph`. Default true. */
  requireBalancedSubgraphs?: boolean;
  /** Flag diagrams longer than this. Off by default. */
  maxLines?: number;
  /** Flag diagrams with more nodes than this. Off by default. */
  maxNodes?: number;
}

/** Runs a rule and tags the result with its code, severity and line. */
function issue(
  code: string,
  message: string,
  severity: MermaidIssueSeverity,
  line?: number,
  excerpt?: string,
): MermaidIssue {
  return { code, message, severity, ...(line !== undefined ? { line } : {}), ...(excerpt ? { excerpt } : {}) };
}

const SEVERITY_ORDER: Record<MermaidIssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Validates a Mermaid diagram structurally.
 *
 * `valid` means no issue was recorded at `error` severity, so warnings do not
 * fail a diagram.
 */
export function validateMermaidDiagram(
  code: string,
  options: MermaidValidationOptions = {},
): MermaidValidationResult {
  const requireNodes = options.requireNodes ?? true;
  const requireEdges = options.requireEdges ?? false;
  const requireBalanced = options.requireBalancedSubgraphs ?? true;
  const trimmed = code.trim();

  const base = {
    diagramType: 'unknown' as MermaidHeader,
    lineCount: trimmed.length === 0 ? 0 : getCodeLines(code).length,
    nodeCount: 0,
    hasSubgraphs: false,
    hasArrows: false,
    issues: [] as MermaidIssue[],
    nodes: [] as string[],
    unclosedSubgraphs: 0,
  };

  if (trimmed.length === 0) {
    return {
      ...base,
      valid: false,
      diagramType: 'unknown',
      message: 'Empty diagram',
      issues: [issue('empty', 'Empty diagram', 'error', 1)],
    };
  }

  const issues: MermaidIssue[] = [];
  const diagramType = detectDiagramType(code);
  const nodes = extractNodes(code);
  const headerLine = getHeaderLine(code);
  const headerLineNumber = getCodeLines(code).findIndex((l) => l.trim() === headerLine) + 1;

  if (diagramType === 'unknown') {
    issues.push(
      issue(
        'unknown-type',
        `Unrecognized Mermaid diagram type: "${headerLine.split(/\s/)[0] ?? ''}"`,
        'error',
        headerLineNumber || 1,
        headerLine,
      ),
    );
  }

  const arrows = countArrows(code);
  const subgraphs = hasSubgraphs(code);
  const unclosed = countUnclosedSubgraphs(code);

  if (requireNodes && nodes.length === 0) {
    issues.push(issue('no-nodes', 'Diagram declares no nodes', 'error', headerLineNumber || 1));
  }
  if (requireEdges && arrows === 0) {
    issues.push(issue('no-edges', 'Diagram declares no connections', 'warning', headerLineNumber || 1));
  }
  if (requireBalanced && unclosed > 0) {
    const line = findSubgraphLines(code).pop() ?? 1;
    issues.push(
      issue('unclosed-subgraph', `Unclosed subgraph: ${unclosed} "end" missing`, 'error', line),
    );
  }
  if (options.maxLines !== undefined && base.lineCount > options.maxLines) {
    issues.push(
      issue('too-many-lines', `Diagram has ${base.lineCount} lines (max ${options.maxLines})`, 'warning'),
    );
  }
  if (options.maxNodes !== undefined && nodes.length > options.maxNodes) {
    issues.push(
      issue('too-many-nodes', `Diagram has ${nodes.length} nodes (max ${options.maxNodes})`, 'warning'),
    );
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    diagramType,
    message: issues.find((i) => i.severity === 'error')?.message,
    lineCount: base.lineCount,
    nodeCount: nodes.length,
    hasSubgraphs: subgraphs,
    hasArrows: arrows > 0,
    issues,
    nodes,
    unclosedSubgraphs: unclosed,
  };
}

/** Returns only the problems at a given severity. */
export function filterIssues(
  result: MermaidValidationResult,
  severity: MermaidIssueSeverity,
): MermaidIssue[] {
  return result.issues.filter((i) => i.severity === severity);
}

/** Summarises a validation result as `flowchart: 2 errors, 1 warning`. */
export function formatValidationSummary(result: MermaidValidationResult): string {
  const errors = filterIssues(result, 'error').length;
  const warnings = filterIssues(result, 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return `${getDiagramTypeLabel(result.diagramType)}: ${parts.length > 0 ? parts.join(', ') : 'no problems'}`;
}
