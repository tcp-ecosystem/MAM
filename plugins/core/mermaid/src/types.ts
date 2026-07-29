/**
 * Mermaid Plugin - Type Utilities
 */

import type { MermaidDiagramType } from './validator.js';

export interface MermaidConfig {
  theme?: 'default' | 'forest' | 'dark' | 'neutral' | 'base';
  startOnLoad?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  securityLevel?: 'strict' | 'loose' | 'sandbox';
  fontFamily?: string;
  fontSize?: number;
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
    curve?: 'basis' | 'linear' | 'step-after' | 'step-before';
  };
}

export interface MermaidDiagramInfo {
  type: MermaidDiagramType | 'unknown';
  label: string;
  lineCount: number;
  nodeCount: number;
  subgraphCount: number;
  arrowCount: number;
  complexity: 'simple' | 'moderate' | 'complex';
}

export function getDiagramInfo(code: string, type: MermaidDiagramType | 'unknown'): MermaidDiagramInfo {
  const lines = code.trim().split('\n');
  const subgraphCount = (code.match(/\bsubgraph\b/g) || []).length;
  const arrowCount = (code.match(/-->|-->|==>|---|-\->/g) || []).length;
  const nodeCount = (code.match(/[A-Za-z0-9_]+[\[\(\{]/g) || []).length;

  let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
  if (lines.length > 30 || nodeCount > 15 || subgraphCount > 2) complexity = 'complex';
  else if (lines.length > 10 || nodeCount > 5 || subgraphCount > 0) complexity = 'moderate';

  return {
    type,
    label: type,
    lineCount: lines.length,
    nodeCount,
    subgraphCount,
    arrowCount,
    complexity,
  };
}

export const DEFAULT_MERMAID_CONFIG: MermaidConfig = {
  theme: 'default',
  startOnLoad: true,
  securityLevel: 'strict',
  fontFamily: 'trebuchet ms, verdana, arial',
  fontSize: 14,
};

export function mergeConfig(base: MermaidConfig, override: Partial<MermaidConfig>): MermaidConfig {
  return { ...base, ...override };
}
