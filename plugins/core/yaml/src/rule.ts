/**
 * YAML Plugin - Validation Rules
 *
 * A rule family over YAML code blocks. The original `valid-yaml` rule only
 * checked key shape, so malformed nesting and duplicate keys passed.
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule, ContentNode } from '@mam/ast';
import {
  parseYAML, validateYAMLContent, countDocuments,
  type YAMLValidationOptions, type YAMLError,
} from './parser.js';
import { describeYAMLShape } from './utils.js';

export type YAMLSeverity = 'error' | 'warning' | 'info';

export interface YAMLRuleOptions {
  /** Blocks longer than this are flagged. Off by default. */
  maxLines?: number;
  /** Blocks with more top-level keys than this are flagged. Off by default. */
  maxKeys?: number;
  /** Reject duplicate keys. Default true. */
  rejectDuplicates?: boolean;
  /** Reject tab indentation. Default true. */
  rejectTabs?: boolean;
  /** Reject a block that parses to an empty record. Default false. */
  rejectEmpty?: boolean;
  /** Reject multi-document blocks. Default false. */
  rejectMultiDocument?: boolean;
  /** Severity applied to the rules. */
  severity?: YAMLSeverity;
  /** Forwarded to the validator. */
  validation?: YAMLValidationOptions;
}

const DEFAULTS = {
  maxLines: undefined as number | undefined,
  maxKeys: undefined as number | undefined,
  rejectDuplicates: true,
  rejectTabs: true,
  rejectEmpty: false,
  rejectMultiDocument: false,
  severity: 'error' as YAMLSeverity,
  validation: {} as YAMLValidationOptions,
};

export interface YAMLBlock {
  code: string;
  node: ContentNode;
  sectionName: string;
}

/** Collects every YAML code block in a module. */
export function findYAMLBlocks(module: MAMModule): YAMLBlock[] {
  const found: YAMLBlock[] = [];
  for (const section of module.sections) {
    for (const node of section.content) {
      const n = node as { type?: string; language?: string; value?: string };
      if (n.type === 'CodeBlock' && (n.language === 'yaml' || n.language === 'yml')) {
        found.push({ code: n.value ?? '', node, sectionName: section.name });
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
  severity: YAMLSeverity,
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

/** Converts parser issues into rule results. Every parse issue is fatal. */
function issueResults(
  issues: YAMLError[],
  rule: string,
  node: ContentNode,
  severity: YAMLSeverity = DEFAULTS.severity,
): ValidationResult[] {
  return issues.map((issue) => toResult(issue.message, false, severity, rule, node));
}

// ─── Individual Rules ─────────────────────────────────────────────

/** Reports YAML that does not parse. */
export const syntaxRule: ValidationRule = {
  name: 'yaml-syntax',
  description: 'YAML blocks should parse without syntax errors',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const parsed = parseYAML(code);
      const fatal = parsed.details.filter((i) => i.code !== 'duplicate-key');
      results.push(...issueResults(fatal, 'yaml-syntax', node));
    }
    return results;
  },
};

/** Reports keys defined twice in the same mapping. */
export const duplicateKeyRule: ValidationRule = {
  name: 'yaml-duplicate-keys',
  description: 'A YAML key should be defined only once',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    if (!DEFAULTS.rejectDuplicates) return [];
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const dupes = parseYAML(code).details.filter((i) => i.code === 'duplicate-key');
      results.push(...issueResults(dupes, 'yaml-duplicate-keys', node));
    }
    return results;
  },
};

/** Reports tab characters used for indentation. */
export const tabIndentRule: ValidationRule = {
  name: 'yaml-tab-indent',
  description: 'YAML indentation must use spaces, not tabs',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    if (!DEFAULTS.rejectTabs) return [];
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const tabs = validateYAMLContent(code).errors.filter((i) => i.code === 'tab-indent');
      results.push(...issueResults(tabs, 'yaml-tab-indent', node));
    }
    return results;
  },
};

/** Reports keys that cannot be addressed as a dotted path. */
export const keyFormatRule: ValidationRule = {
  name: 'yaml-key-format',
  description: 'YAML keys should be identifiers, optionally dotted',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const bad = validateYAMLContent(code, DEFAULTS.validation).errors
        .filter((i) => i.code === 'invalid-key');
      results.push(...issueResults(bad, 'yaml-key-format', node));
    }
    return results;
  },
};

/** Reports blocks that carry no data. */
export const emptyRule: ValidationRule = {
  name: 'yaml-not-empty',
  description: 'YAML blocks should declare at least one key',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    if (!DEFAULTS.rejectEmpty) return [];
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      if (Object.keys(parseYAML(code).data).length === 0) {
        results.push(toResult('YAML block is empty', false, 'warning', 'yaml-not-empty', node));
      }
    }
    return results;
  },
};

/** Reports multi-document blocks, which most hosts do not expect. */
export const multiDocumentRule: ValidationRule = {
  name: 'yaml-single-document',
  description: 'A YAML block should hold a single document',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    if (!DEFAULTS.rejectMultiDocument) return [];
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      if (countDocuments(code) > 1) {
        results.push(
          toResult(
            `YAML block holds ${countDocuments(code)} documents; only the first is used`,
            true, 'warning', 'yaml-single-document', node,
          ),
        );
      }
    }
    return results;
  },
};

/** Reports blocks past the configured size limits. */
export const sizeRule: ValidationRule = {
  name: 'yaml-size',
  description: 'YAML blocks should stay within reasonable size limits',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    if (DEFAULTS.maxLines === undefined && DEFAULTS.maxKeys === undefined) return [];
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const lineCount = code.split(/\r?\n/).length;
      if (DEFAULTS.maxLines !== undefined && lineCount > DEFAULTS.maxLines) {
        results.push(
          toResult(
            `YAML block has ${lineCount} lines (max ${DEFAULTS.maxLines})`,
            true, 'warning', 'yaml-size', node,
          ),
        );
      }
      if (DEFAULTS.maxKeys !== undefined) {
        const keys = Object.keys(parseYAML(code).data).length;
        if (keys > DEFAULTS.maxKeys) {
          results.push(
            toResult(
              `YAML block has ${keys} top-level keys (max ${DEFAULTS.maxKeys})`,
              true, 'warning', 'yaml-size', node,
            ),
          );
        }
      }
    }
    return results;
  },
};

/** Reports blocks deep enough to be hard to read. */
export const depthRule: ValidationRule = {
  name: 'yaml-depth',
  description: 'Very deeply nested YAML is hard to read and to diff',
  severity: 'info',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findYAMLBlocks(module)) {
      const shape = describeYAMLShape(parseYAML(code).data);
      if (shape.maxDepth > 5) {
        results.push(
          toResult(
            `YAML block nests ${shape.maxDepth} levels deep`,
            true, 'info', 'yaml-depth', node,
          ),
        );
      }
    }
    return results;
  },
};

/** Every built-in rule, in the order they should run. */
export const YAML_RULES: ValidationRule[] = [
  syntaxRule,
  duplicateKeyRule,
  tabIndentRule,
  keyFormatRule,
  emptyRule,
  multiDocumentRule,
  sizeRule,
  depthRule,
];

// ─── Composite Rule ───────────────────────────────────────────────

/**
 * The original rule: reports key-shape problems only.
 *
 * Kept so a module relying on it behaves exactly as before;
 * {@link createYAMLValidationRule} is the strict opt-in.
 */
export const yamlRule: ValidationRule = {
  name: 'valid-yaml',
  description: 'Validate YAML syntax in code blocks',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        const n = content as { type?: string; language?: string; value?: string };
        if (n.type !== 'CodeBlock' || (n.language !== 'yaml' && n.language !== 'yml')) continue;
        const validation = validateYAMLContent(n.value ?? '');
        if (!validation.valid) {
          results.push({
            valid: false,
            message: `Invalid YAML in "${section.name}": ${validation.error}`,
            location: content.location?.start,
          });
        }
        const parsed = parseYAML(n.value ?? '');
        for (const err of parsed.errors) {
          results.push({
            valid: false,
            message: `YAML parse error in "${section.name}": ${err}`,
            location: content.location?.start,
          });
        }
      }
    }
    return results;
  },
};

// ─── Factories ────────────────────────────────────────────────────

/** Overrides the limits used by the built-in rules. */
export function configureYAMLRules(options: YAMLRuleOptions): void {
  if (options.maxLines !== undefined) DEFAULTS.maxLines = options.maxLines;
  if (options.maxKeys !== undefined) DEFAULTS.maxKeys = options.maxKeys;
  if (options.rejectDuplicates !== undefined) DEFAULTS.rejectDuplicates = options.rejectDuplicates;
  if (options.rejectTabs !== undefined) DEFAULTS.rejectTabs = options.rejectTabs;
  if (options.rejectEmpty !== undefined) DEFAULTS.rejectEmpty = options.rejectEmpty;
  if (options.rejectMultiDocument !== undefined) DEFAULTS.rejectMultiDocument = options.rejectMultiDocument;
  if (options.severity) DEFAULTS.severity = options.severity;
  if (options.validation) DEFAULTS.validation = { ...options.validation };
}

/** Restores the default limits. */
export function resetYAMLRuleConfig(): void {
  DEFAULTS.maxLines = undefined;
  DEFAULTS.maxKeys = undefined;
  DEFAULTS.rejectDuplicates = true;
  DEFAULTS.rejectTabs = true;
  DEFAULTS.rejectEmpty = false;
  DEFAULTS.rejectMultiDocument = false;
  DEFAULTS.severity = 'error';
  DEFAULTS.validation = {};
}

/** Returns the composite rule, optionally re-levelled. */
export function createYamlRule(severity?: YAMLSeverity): ValidationRule {
  return { ...yamlRule, severity: severity || yamlRule.severity };
}

/** Returns a strict rule that reports every detected problem. */
export function createYAMLValidationRule(options?: YAMLRuleOptions): ValidationRule {
  if (options) configureYAMLRules(options);
  return {
    name: 'yaml-validate',
    description: 'Full structural validation of YAML blocks',
    severity: DEFAULTS.severity,
    check: (module: MAMModule): ValidationResult[] => {
      const results: ValidationResult[] = [];
      for (const { code, node } of findYAMLBlocks(module)) {
        const issues = validateYAMLContent(code, DEFAULTS.validation).errors
          .filter((issue) => DEFAULTS.rejectDuplicates || issue.code !== 'duplicate-key')
          .filter((issue) => DEFAULTS.rejectTabs || issue.code !== 'tab-indent');
        results.push(...issueResults(issues, 'yaml-validate', node));
      }
      return results;
    },
  };
}

/** Returns the full rule family, optionally re-levelled. */
export function createYAMLRules(severity?: YAMLSeverity): ValidationRule[] {
  return YAML_RULES.map((rule) => (severity ? { ...rule, severity } : { ...rule }));
}

/** Runs rules against a module and flattens their results. */
export function runYAMLRules(
  module: MAMModule,
  rules: ValidationRule[] = YAML_RULES,
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

/** Summarises rule output as `2 errors, 1 warning`. */
export function formatYAMLRuleSummary(results: ValidationResult[]): string {
  const errors = results.filter((r) => !r.valid).length;
  const warnings = results.filter((r) => r.valid && r.severity === 'warning').length;
  const info = results.filter((r) => r.valid && r.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (info > 0) parts.push(`${info} info`);
  return parts.length > 0 ? parts.join(', ') : 'no problems';
}

/** Counts the YAML blocks a module contains. */
export function countYAMLBlocks(module: MAMModule): number {
  return findYAMLBlocks(module).length;
}
