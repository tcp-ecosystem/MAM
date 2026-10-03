/**
 * Mermaid Plugin - Type Utilities
 *
 * Diagram metrics and Mermaid runtime configuration: presets, deep merging and
 * validation of the config object handed to `mermaid.initialize`.
 */

import {
  detectDiagramType,
  extractNodes,
  countArrows,
  countUnclosedSubgraphs,
  getDiagramTypeLabel,
  getCodeLines,
  findSubgraphLines,
  stripComments,
  VALID_DIAGRAM_TYPES,
  DIAGRAM_TYPE_VARIANTS,
  type MermaidDiagramType,
  type MermaidHeader,
} from './validator.js';

export type MermaidTheme = 'default' | 'forest' | 'dark' | 'neutral' | 'base';
export type MermaidLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type MermaidSecurityLevel = 'strict' | 'loose' | 'sandbox';
export type MermaidCurve = 'basis' | 'linear' | 'step-after' | 'step-before';
export type MermaidComplexity = 'simple' | 'moderate' | 'complex';

export interface MermaidConfig {
  theme?: MermaidTheme;
  startOnLoad?: boolean;
  logLevel?: MermaidLogLevel;
  securityLevel?: MermaidSecurityLevel;
  fontFamily?: string;
  fontSize?: number;
  /** Emit deterministic ids so repeated renders diff cleanly. */
  deterministicIds?: boolean;
  /** Inject the rendered SVG into the surrounding document. */
  suppressErrorRendering?: boolean;
  sequence?: {
    diagramMarginX?: number;
    diagramMarginY?: number;
    actorMargin?: number;
    width?: number;
    height?: number;
    boxMargin?: number;
    boxTextMargin?: number;
    noteMargin?: number;
    messageMargin?: number;
    mirrorActors?: boolean;
    useMaxWidth?: boolean;
  };
  flowchart?: {
    useMaxWidth?: boolean;
    htmlLabels?: boolean;
    curve?: MermaidCurve;
    nodeSpacing?: number;
    rankSpacing?: number;
  };
  gantt?: {
    useMaxWidth?: boolean;
    barHeight?: number;
    topPadding?: number;
  };
  pie?: { useMaxWidth?: boolean };
  er?: { useMaxWidth?: boolean };
  class?: { useMaxWidth?: boolean };
  state?: { useMaxWidth?: boolean; defaultRenderer?: string };
}

export interface MermaidDiagramInfo {
  type: MermaidHeader;
  label: string;
  lineCount: number;
  nodeCount: number;
  subgraphCount: number;
  arrowCount: number;
  complexity: MermaidComplexity;
  /** Non-empty lines, ignoring comments and blank lines. */
  statementCount: number;
  /** Longest line, for spotting minified or runaway diagrams. */
  longestLine: number;
  unclosedSubgraphs: number;
  /** 1-based line of the header, for editor navigation. */
  headerLine: number;
}

export interface ComplexityThresholds {
  /** Line count above which a diagram is complex. */
  complexLines: number;
  /** Node count above which a diagram is complex. */
  complexNodes: number;
  /** Subgraph count above which a diagram is complex. */
  complexSubgraphs: number;
  /** Line count above which a diagram is at least moderate. */
  moderateLines: number;
  /** Node count above which a diagram is at least moderate. */
  moderateNodes: number;
}

export const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  complexLines: 30,
  complexNodes: 15,
  complexSubgraphs: 2,
  moderateLines: 10,
  moderateNodes: 5,
};

const THEMES: readonly MermaidTheme[] = ['default', 'forest', 'dark', 'neutral', 'base'];
const LOG_LEVELS: readonly MermaidLogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
const SECURITY_LEVELS: readonly MermaidSecurityLevel[] = ['strict', 'loose', 'sandbox'];
const CURVES: readonly MermaidCurve[] = ['basis', 'linear', 'step-after', 'step-before'];

export const MERMAID_THEMES = THEMES;
export const MERMAID_LOG_LEVELS = LOG_LEVELS;
export const MERMAID_SECURITY_LEVELS = SECURITY_LEVELS;
export const MERMAID_CURVES = CURVES;

export const DEFAULT_MERMAID_CONFIG: MermaidConfig = {
  theme: 'default',
  startOnLoad: true,
  securityLevel: 'strict',
  fontFamily: 'trebuchet ms, verdana, arial',
  fontSize: 14,
  deterministicIds: true,
  suppressErrorRendering: true,
};

// ─── Metrics ──────────────────────────────────────────────────────

/** Counts non-empty, non-comment lines. */
export function countStatements(code: string): number {
  return getCodeLines(code).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('%%');
  }).length;
}

/** Returns the length of the longest line. */
export function longestLine(code: string): number {
  return getCodeLines(code).reduce((max, line) => Math.max(max, line.length), 0);
}

/** Grades a diagram's complexity against explicit thresholds. */
export function gradeComplexity(
  stats: { lineCount: number; nodeCount: number; subgraphCount: number },
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS,
): MermaidComplexity {
  if (
    stats.lineCount > thresholds.complexLines ||
    stats.nodeCount > thresholds.complexNodes ||
    stats.subgraphCount > thresholds.complexSubgraphs
  ) {
    return 'complex';
  }
  if (
    stats.lineCount > thresholds.moderateLines ||
    stats.nodeCount > thresholds.moderateNodes ||
    stats.subgraphCount > 0
  ) {
    return 'moderate';
  }
  return 'simple';
}

/**
 * Collects structural metrics for a diagram.
 *
 * Detects the type itself when none is supplied, so callers do not have to run
 * `detectDiagramType` separately.
 */
export function getDiagramInfo(
  code: string,
  type?: MermaidHeader,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS,
): MermaidDiagramInfo {
  const lines = getCodeLines(code);
  const lineCount = lines.length;
  const nodeCount = extractNodes(code).length;
  const arrowCount = countArrows(code);
  const subgraphCount = findSubgraphLines(code).length;
  const diagramType = type ?? detectDiagramType(code);
  const headerLine = lines.findIndex((line) => line.trim().length > 0) + 1;

  return {
    type: diagramType,
    label: getDiagramTypeLabel(diagramType),
    lineCount,
    nodeCount,
    subgraphCount,
    arrowCount,
    complexity: gradeComplexity({ lineCount, nodeCount, subgraphCount }, thresholds),
    statementCount: countStatements(code),
    longestLine: longestLine(code),
    unclosedSubgraphs: countUnclosedSubgraphs(code),
    headerLine: headerLine > 0 ? headerLine : 1,
  };
}

/** One-line human summary, e.g. `Flowchart: 12 lines, 8 nodes, moderate`. */
export function formatDiagramInfo(info: MermaidDiagramInfo): string {
  return `${info.label}: ${info.lineCount} lines, ${info.nodeCount} nodes, ` +
    `${info.arrowCount} edges, ${info.complexity}`;
}

// ─── Configuration ────────────────────────────────────────────────

/**
 * Merges config, recursing into the per-diagram sections.
 *
 * A shallow spread would replace the whole `flowchart` object when only one of
 * its fields was meant to change, silently dropping the rest.
 */
export function mergeConfig(base: MermaidConfig, override: Partial<MermaidConfig>): MermaidConfig {
  // Built as a loose record: the config has ~10 optional keys of differing
  // shapes, and writing through a `keyof MermaidConfig` index resolves to the
  // intersection of every value type, which is `never`.
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = result[key];
    const bothPlainObjects =
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof current === 'object' && current !== null && !Array.isArray(current);
    result[key] = bothPlainObjects ? { ...current, ...value } : value;
  }
  return result as MermaidConfig;
}

/** Layers several overrides left to right. */
export function mergeConfigs(
  ...configs: Array<Partial<MermaidConfig> | undefined>
): MermaidConfig {
  return configs.reduce<MermaidConfig>(
    (acc, config) => (config ? mergeConfig(acc, config) : acc),
    { ...DEFAULT_MERMAID_CONFIG },
  );
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/** Checks enum-valued config fields, returning every problem found. */
export function validateConfig(config: MermaidConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  const checkEnum = <T extends string>(path: string, value: unknown, allowed: readonly T[]): void => {
    if (value !== undefined && !(allowed as readonly unknown[]).includes(value)) {
      issues.push({ path, message: `"${String(value)}" is not one of: ${allowed.join(', ')}` });
    }
  };

  checkEnum('theme', config.theme, THEMES);
  checkEnum('logLevel', config.logLevel, LOG_LEVELS);
  checkEnum('securityLevel', config.securityLevel, SECURITY_LEVELS);
  checkEnum('flowchart.curve', config.flowchart?.curve, CURVES);

  if (config.fontSize !== undefined && (config.fontSize < 1 || config.fontSize > 100)) {
    issues.push({ path: 'fontSize', message: 'Must be between 1 and 100' });
  }
  if (
    config.flowchart?.htmlLabels === true &&
    config.securityLevel === 'strict'
  ) {
    issues.push({
      path: 'flowchart.htmlLabels',
      message: 'htmlLabels renders raw HTML and is ignored under securityLevel "strict"',
    });
  }
  return issues;
}

/** Returns a config copy with every field filled in. */
export function normalizeConfig(config: MermaidConfig = {}): MermaidConfig {
  return mergeConfig(DEFAULT_MERMAID_CONFIG, config);
}

/**
 * Presets per diagram type.
 *
 * Only carries the settings that genuinely differ; everything else falls
 * through to the defaults.
 */
export const DIAGRAM_PRESETS: Record<MermaidDiagramType, Partial<MermaidConfig>> = {
  flowchart: { flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' } },
  graph: { flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' } },
  sequenceDiagram: { sequence: { useMaxWidth: true, mirrorActors: true, actorMargin: 50 } },
  classDiagram: { class: { useMaxWidth: true } },
  stateDiagram: { state: { useMaxWidth: true } },
  erDiagram: { er: { useMaxWidth: true } },
  gantt: { gantt: { useMaxWidth: true, barHeight: 20, topPadding: 50 } },
  pie: { pie: { useMaxWidth: true } },
  gitgraph: {},
  mindmap: {},
  timeline: {},
  'block-beta': {},
  journey: {},
  quadrantChart: {},
  requirementDiagram: {},
  xychart: {},
  sankey: {},
  architecture: {},
};

/** Returns the preset for a diagram type, defaulting to the flowchart preset. */
export function getPresetForType(type: MermaidHeader): Partial<MermaidConfig> {
  if (type in DIAGRAM_PRESETS) return DIAGRAM_PRESETS[type as MermaidDiagramType];
  return DIAGRAM_PRESETS.flowchart;
}

/** Builds a ready-to-use config for one diagram. */
export function getConfigForDiagram(
  code: string,
  overrides: Partial<MermaidConfig> = {},
  type?: MermaidHeader,
): MermaidConfig {
  const diagramType = type ?? detectDiagramType(code);
  return mergeConfigs(getPresetForType(diagramType), overrides);
}

/** Every diagram header this plugin recognises, variants included. */
export function getAllSupportedTypes(): MermaidHeader[] {
  return [...VALID_DIAGRAM_TYPES, ...DIAGRAM_TYPE_VARIANTS];
}

/** Returns the diagram source with comments removed. */
export function stripDiagramComments(code: string): string {
  return stripComments(code);
}
