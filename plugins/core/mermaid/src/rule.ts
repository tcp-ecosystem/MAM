/**
 * Mermaid Plugin - Validation Rules
 *
 * A rule family over Mermaid code blocks. The original `valid-mermaid` rule
 * only reported empty diagrams, so an unrecognised header or an unclosed
 * `subgraph` passed validation and then failed to render.
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule, ContentNode } from '@mam/ast';
import {
  validateMermaidDiagram, extractMermaidBlocks, getDiagramTypeLabel,
  type MermaidHeader, type MermaidValidationResult, type MermaidValidationOptions,
} from './validator.js';
import { getDiagramInfo, gradeComplexity, DEFAULT_THRESHOLDS, type ComplexityThresholds } from './types.js';

export type MermaidSeverity = 'error' | 'warning' | 'info';

export interface MermaidRuleOptions {
  /** Diagrams longer than this are flagged. Off by default. */
  maxLines?: number;
  /** Diagrams with more nodes than this are flagged. Off by default. */
  maxNodes?: number;
  /** Require every diagram to declare at least one node. Default true. */
  requireNodes?: boolean;
  /** Require balanced subgraphs. Default true. */
  requireBalancedSubgraphs?: boolean;
  /** Require at least one edge. Off by default; several types have none. */
  requireEdges?: boolean;
  /** Severity applied to the rules. */
  severity?: MermaidSeverity;
  /** Complexity grading thresholds. */
  thresholds?: ComplexityThresholds;
  /** Forwarded to the validator. */
  validation?: MermaidValidationOptions;
}

const DEFAULTS = {
  maxLines: undefined as number | undefined,
  maxNodes: undefined as number | undefined,
  requireNodes: true,
  requireBalancedSubgraphs: true,
  requireEdges: false,
  severity: 'warning' as MermaidSeverity,
  thresholds: DEFAULT_THRESHOLDS,
};

/** Collects every Mermaid code block in a module, with its node for locations. */
export function findMermaidBlocks(module: MAMModule): Array<{ code: string; node: ContentNode }> {
  const found: Array<{ code: string; node: ContentNode }> = [];
  for (const section of module.sections) {
    for (const node of section.content) {
      const n = node as { type?: string; language?: string; value?: string };
      if (n.type === 'CodeBlock' && n.language === 'mermaid') {
        found.push({ code: n.value ?? '', node });
      }
    }
  }
  return found;
}

function locationOf(node: ContentNode): { line: number; column: number } | undefined {
  return node.location?.start;
}

function toResult(
  message: string,
  valid: boolean,
  severity: MermaidSeverity,
  rule: string,
  node: ContentNode,
): ValidationResult {
  return {
    valid,
    message,
    severity,
    rule,
    ...(locationOf(node) ? { location: locationOf(node) } : {}),
  };
}

/** Validates one diagram and converts its issues into rule results. */
function resultsFor(
  validation: MermaidValidationResult,
  rule: string,
  node: ContentNode,
): ValidationResult[] {
  return validation.issues.map((issue) =>
    toResult(issue.message, issue.severity !== 'error', issue.severity, rule, node),
  );
}

/** Options for the whole rule family. */
function validatorOptions(): MermaidValidationOptions {
  return {
    requireNodes: DEFAULTS.requireNodes,
    requireBalancedSubgraphs: DEFAULTS.requireBalancedSubgraphs,
    requireEdges: DEFAULTS.requireEdges,
    ...(DEFAULTS.maxLines !== undefined ? { maxLines: DEFAULTS.maxLines } : {}),
    ...(DEFAULTS.maxNodes !== undefined ? { maxNodes: DEFAULTS.maxNodes } : {}),
  };
}

// ─── Individual Rules ─────────────────────────────────────────────

/** Reports empty Mermaid blocks. */
export const emptyDiagramRule: ValidationRule = {
  name: 'mermaid-empty',
  description: 'Mermaid code blocks should not be empty',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) {
        results.push(toResult('Empty Mermaid diagram', false, 'error', 'mermaid-empty', node));
      }
    }
    return results;
  },
};

/** Reports blocks whose header is not a recognised Mermaid diagram type. */
export const unknownTypeRule: ValidationRule = {
  name: 'mermaid-unknown-type',
  description: 'Mermaid blocks should start with a supported diagram type',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) continue;
      const validation = validateMermaidDiagram(code, { requireNodes: false, requireBalancedSubgraphs: false });
      for (const issue of validation.issues.filter((i) => i.code === 'unknown-type')) {
        results.push(toResult(issue.message, false, 'error', 'mermaid-unknown-type', node));
      }
    }
    return results;
  },
};

/** Reports `subgraph` blocks that are never closed with `end`. */
export const subgraphRule: ValidationRule = {
  name: 'mermaid-subgraph-balance',
  description: 'Every Mermaid subgraph should be closed with "end"',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) continue;
      const validation = validateMermaidDiagram(code, { requireNodes: false });
      for (const issue of validation.issues.filter((i) => i.code === 'unclosed-subgraph')) {
        results.push(toResult(issue.message, false, 'error', 'mermaid-subgraph-balance', node));
      }
    }
    return results;
  },
};

/** Reports diagrams with no nodes, which cannot render. */
export const emptyNodeRule: ValidationRule = {
  name: 'mermaid-has-nodes',
  description: 'Mermaid diagrams should declare at least one node',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) continue;
      const validation = validateMermaidDiagram(code, { requireBalancedSubgraphs: false });
      for (const issue of validation.issues.filter((i) => i.code === 'no-nodes')) {
        results.push(toResult(issue.message, false, 'error', 'mermaid-has-nodes', node));
      }
    }
    return results;
  },
};

/** Reports diagrams past the configured size limits. */
export const sizeRule: ValidationRule = {
  name: 'mermaid-size',
  description: 'Mermaid diagrams should stay within reasonable size limits',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    if (DEFAULTS.maxLines === undefined && DEFAULTS.maxNodes === undefined) return results;

    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) continue;
      const info = getDiagramInfo(code);
      if (DEFAULTS.maxLines !== undefined && info.lineCount > DEFAULTS.maxLines) {
        results.push(
          toResult(
            `Mermaid diagram has ${info.lineCount} lines (max ${DEFAULTS.maxLines})`,
            true, 'warning', 'mermaid-size', node,
          ),
        );
      }
      if (DEFAULTS.maxNodes !== undefined && info.nodeCount > DEFAULTS.maxNodes) {
        results.push(
          toResult(
            `Mermaid diagram has ${info.nodeCount} nodes (max ${DEFAULTS.maxNodes})`,
            true, 'warning', 'mermaid-size', node,
          ),
        );
      }
    }
    return results;
  },
};

/** Reports diagrams complex enough to be hard to read. */
export const complexityRule: ValidationRule = {
  name: 'mermaid-complexity',
  description: 'Very large diagrams are hard to read and slow to render',
  severity: 'info',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) continue;
      const info = getDiagramInfo(code);
      if (gradeComplexity(info, DEFAULTS.thresholds) === 'complex') {
        results.push(
          toResult(
            `${getDiagramTypeLabel(info.type)} is complex: ${info.nodeCount} nodes, ${info.lineCount} lines`,
            true, 'info', 'mermaid-complexity', node,
          ),
        );
      }
    }
    return results;
  },
};

/** Every built-in rule, in the order they should run. */
export const MERMAID_RULES: ValidationRule[] = [
  emptyDiagramRule,
  unknownTypeRule,
  subgraphRule,
  emptyNodeRule,
  sizeRule,
  complexityRule,
];

// ─── Composite Rule ───────────────────────────────────────────────

/**
 * The original rule: reports empty diagrams and nothing else.
 *
 * Kept so a module that already relies on this rule keeps its exact previous
 * behaviour; {@link createMermaidRules} is the stricter opt-in.
 */
export const mermaidRule: ValidationRule = {
  name: 'valid-mermaid',
  description: 'Validate Mermaid diagram syntax',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findMermaidBlocks(module)) {
      if (code.trim().length === 0) {
        results.push({
          valid: false,
          message: 'Empty Mermaid diagram',
          location: locationOf(node),
        });
      }
    }
    return results;
  },
};

// ─── Factories ────────────────────────────────────────────────────

/** Overrides the limits used by the built-in rules. */
export function configureMermaidRules(options: MermaidRuleOptions): void {
  if (options.maxLines !== undefined) DEFAULTS.maxLines = options.maxLines;
  if (options.maxNodes !== undefined) DEFAULTS.maxNodes = options.maxNodes;
  if (options.requireNodes !== undefined) DEFAULTS.requireNodes = options.requireNodes;
  if (options.requireBalancedSubgraphs !== undefined) {
    DEFAULTS.requireBalancedSubgraphs = options.requireBalancedSubgraphs;
  }
  if (options.requireEdges !== undefined) DEFAULTS.requireEdges = options.requireEdges;
  if (options.severity) DEFAULTS.severity = options.severity;
  if (options.thresholds) DEFAULTS.thresholds = { ...DEFAULTS.thresholds, ...options.thresholds };
}

/** Restores the default limits. */
export function resetMermaidRuleConfig(): void {
  DEFAULTS.maxLines = undefined;
  DEFAULTS.maxNodes = undefined;
  DEFAULTS.requireNodes = true;
  DEFAULTS.requireBalancedSubgraphs = true;
  DEFAULTS.requireEdges = false;
  DEFAULTS.severity = 'warning';
  DEFAULTS.thresholds = DEFAULT_THRESHOLDS;
}

/** Returns the composite rule, optionally re-levelled. */
export function createMermaidRule(severity?: MermaidSeverity): ValidationRule {
  return { ...mermaidRule, severity: severity || mermaidRule.severity };
}

/**
 * Returns a strict rule that reports every detected problem.
 *
 * Preferred over `createMermaidRule`, which only catches empty diagrams.
 */
export function createMermaidValidationRule(options?: MermaidRuleOptions): ValidationRule {
  if (options) configureMermaidRules(options);
  return {
    name: 'mermaid-validate',
    description: 'Full structural validation of Mermaid diagrams',
    severity: DEFAULTS.severity,
    check: (module: MAMModule): ValidationResult[] => {
      const results: ValidationResult[] = [];
      for (const { code, node } of findMermaidBlocks(module)) {
        if (code.trim().length === 0) continue;
        results.push(...resultsFor(validateMermaidDiagram(code, validatorOptions()), 'mermaid-validate', node));
      }
      return results;
    },
  };
}

/** Returns the full rule family, optionally re-levelled. */
export function createMermaidRules(severity?: MermaidSeverity): ValidationRule[] {
  return MERMAID_RULES.map((rule) => (severity ? { ...rule, severity } : { ...rule }));
}

/** Runs rules against a module and flattens their results. */
export function runMermaidRules(
  module: MAMModule,
  rules: ValidationRule[] = MERMAID_RULES,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const rule of rules) {
    try {
      results.push(...rule.check(module));
    } catch (error) {
      results.push({
        valid: false,
        message: `Rule "${rule.name}" threw: ${(error as Error).message}`,
        severity: 'error',
        rule: rule.name,
      });
    }
  }
  return results;
}

/** Summarises rule output as `2 errors, 1 warning, 3 info`. */
export function formatMermaidRuleSummary(results: ValidationResult[]): string {
  const errors = results.filter((r) => !r.valid).length;
  const warnings = results.filter((r) => r.valid && r.severity === 'warning').length;
  const info = results.filter((r) => r.valid && r.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (info > 0) parts.push(`${info} info`);
  return parts.length > 0 ? parts.join(', ') : 'no problems';
}

/** Counts the Mermaid diagrams a module contains. */
export function countMermaidDiagrams(module: MAMModule): number {
  return findMermaidBlocks(module).length;
}

/** Re-exported so hosts can extract blocks without importing the validator. */
export { extractMermaidBlocks };
export type { MermaidHeader };
