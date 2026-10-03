/**
 * Python Plugin - Validation Rules
 *
 * A rule family over Python code blocks.
 *
 * Rules are synchronous by contract, so they use the interpreter-free static
 * analyser. The real syntax check needs a subprocess and is exposed separately
 * through {@link createPythonSyntaxRule}, for hosts that can await it.
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule, ContentNode } from '@mam/ast';
import {
  validatePythonCodeStatic, getPythonSecurityIssues, checkPythonSyntax,
  type PythonValidationIssue, type PythonValidationOptions,
} from './validator.js';
import { getExecutionStats } from './runner.js';

export type PythonSeverity = 'error' | 'warning' | 'info';

export interface PythonBlock {
  code: string;
  node: ContentNode;
  sectionName: string;
}

/** Collects every Python code block in a module. */
export function findPythonBlocks(module: MAMModule): PythonBlock[] {
  const found: PythonBlock[] = [];
  for (const section of module.sections) {
    for (const node of section.content) {
      const n = node as { type?: string; language?: string; value?: string };
      if (n.type === 'CodeBlock' && (n.language === 'python' || n.language === 'py')) {
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
  issue: PythonValidationIssue,
  node: ContentNode,
  rule?: string,
): ValidationResult {
  return {
    valid: issue.severity !== 'error',
    message: issue.message,
    severity: issue.severity,
    rule: rule ?? issue.rule,
    // Prefer the in-file line the analyser found, falling back to the node.
    location: issue.line > 0 ? { line: issue.line, column: issue.column } : locationOf(node),
  };
}

// ─── Individual Rules ─────────────────────────────────────────────

/** Reports style and structure problems. */
export const styleRule: ValidationRule = {
  name: 'python-style',
  description: 'Python code should follow basic style conventions',
  severity: 'info',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      for (const issue of validatePythonCodeStatic(code, { checkSyntax: false, checkMainGuard: false })) {
        if (issue.rule === 'mixed-indent' || issue.rule === 'trailing-whitespace'
          || issue.rule === 'line-length' || issue.rule === 'debug-print'
          || issue.rule === 'none-comparison') {
          results.push(toResult(issue, node, 'python-style'));
        }
      }
    }
    return results;
  },
};

/** Reports risky constructs, for a human to judge. */
export const securityRule: ValidationRule = {
  name: 'python-security',
  description: 'Python code should avoid dangerous constructs',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      for (const issue of getPythonSecurityIssues(code)) {
        results.push(toResult(issue, node, 'python-security'));
      }
    }
    return results;
  },
};

/** Reports bare `except:` and unterminated strings. */
export const errorHandlingRule: ValidationRule = {
  name: 'python-error-handling',
  description: 'Python code should handle errors precisely',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      for (const issue of validatePythonCodeStatic(code, { checkSyntax: false, checkMainGuard: false })) {
        if (issue.rule === 'bare-except' || issue.rule === 'unterminated-string'
          || issue.rule === 'unbalanced-quotes') {
          results.push(toResult(issue, node, 'python-error-handling'));
        }
      }
    }
    return results;
  },
};

/** Reports a module with imports and functions but no `__main__` guard. */
export const mainGuardRule: ValidationRule = {
  name: 'python-main-guard',
  description: 'A script with imports and functions should guard its entry point',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      const issues = validatePythonCodeStatic(code, { checkSyntax: false, checkMainGuard: true });
      for (const issue of issues.filter((i) => i.rule === 'missing-main-guard')) {
        results.push(toResult(issue, node, 'python-main-guard'));
      }
    }
    return results;
  },
};

/** Reports empty Python blocks. */
export const emptyRule: ValidationRule = {
  name: 'python-not-empty',
  description: 'Python code blocks should not be empty',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      if (code.trim().length === 0) {
        results.push({
          valid: false,
          message: 'Empty Python code block',
          severity: 'error',
          rule: 'python-not-empty',
          ...(locationOf(node) ? { location: locationOf(node) } : {}),
        });
      }
    }
    return results;
  },
};

/** Reports blocks past the configured size limits. */
export const sizeRule: ValidationRule = {
  name: 'python-size',
  description: 'Python code blocks should stay within reasonable size limits',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      const lines = code.split('\n').length;
      if (lines > PYTHON_LIMITS.maxLines) {
        results.push({
          valid: true,
          message: `Python block has ${lines} lines (max ${PYTHON_LIMITS.maxLines})`,
          severity: 'warning',
          rule: 'python-size',
          ...(locationOf(node) ? { location: locationOf(node) } : {}),
        });
      }
    }
    return results;
  },
};

/** Block-size limits enforced by the size rule. */
export const PYTHON_LIMITS = { maxLines: 2000 } as const;

/** Every built-in rule, in the order they should run. */
export const PYTHON_RULES: ValidationRule[] = [
  emptyRule,
  styleRule,
  errorHandlingRule,
  mainGuardRule,
  securityRule,
  sizeRule,
];

// ─── Composite Rule ───────────────────────────────────────────────

/**
 * The original rule, kept synchronous.
 *
 * Reports every static issue plus the security findings, exactly as before but
 * without the per-issue locations the old version dropped.
 */
export const pythonRule: ValidationRule = {
  name: 'python-syntax',
  description: 'Check Python code blocks for common issues',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const { code, node } of findPythonBlocks(module)) {
      for (const issue of validatePythonCodeStatic(code)) {
        results.push(toResult(issue, node));
      }
      for (const issue of getPythonSecurityIssues(code)) {
        results.push({
          valid: issue.severity !== 'error',
          message: `Security: ${issue.message}`,
          severity: issue.severity,
          rule: issue.rule,
          ...(locationOf(node) ? { location: locationOf(node) } : {}),
        });
      }
    }
    return results;
  },
};

// ─── Async Rule ───────────────────────────────────────────────────

/**
 * A rule that runs the interpreter's own parser.
 *
 * Not a `ValidationRule`, because that contract is synchronous. Hosts that can
 * await should call this and merge the results themselves.
 */
export function checkPythonSyntaxRule(
  module: MAMModule,
  options?: PythonValidationOptions,
): Promise<ValidationResult[]> {
  return Promise.all(findPythonBlocks(module).map(async ({ code, node }) => {
    const syntax = await checkPythonSyntax(code, options);
    if (syntax.unavailable !== undefined) {
      return [{
        valid: true,
        message: `Syntax check skipped: ${syntax.unavailable}`,
        severity: 'info' as const,
        rule: 'python-syntax-check',
        ...(locationOf(node) ? { location: locationOf(node) } : {}),
      }];
    }
    if (syntax.ok) return [];
    return [{
      valid: false,
      message: `Syntax error: ${syntax.message ?? 'invalid Python'}`,
      severity: 'error' as const,
      rule: 'python-syntax-check',
      location: {
        line: syntax.line && syntax.line > 0 ? syntax.line : (locationOf(node)?.line ?? 1),
        column: syntax.column && syntax.column > 0 ? syntax.column : 1,
      },
    }];
  })).then((groups) => groups.flat());
}

// ─── Factories ────────────────────────────────────────────────────

/** Returns the composite rule, optionally re-levelled. */
export function createPythonRule(severity?: PythonSeverity): ValidationRule {
  return { ...pythonRule, severity: severity || pythonRule.severity };
}

/** Returns the full rule family, optionally re-levelled. */
export function createPythonRules(severity?: PythonSeverity): ValidationRule[] {
  return PYTHON_RULES.map((rule) => (severity ? { ...rule, severity } : { ...rule }));
}

/** Runs rules against a module and flattens their results. */
export function runPythonRules(
  module: MAMModule,
  rules: ValidationRule[] = PYTHON_RULES,
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
export function formatPythonRuleSummary(results: ValidationResult[]): string {
  const errors = results.filter((r) => !r.valid).length;
  const warnings = results.filter((r) => r.valid && r.severity === 'warning').length;
  const info = results.filter((r) => r.valid && r.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (info > 0) parts.push(`${info} info`);
  return parts.length > 0 ? parts.join(', ') : 'no problems';
}

/** Counts the Python blocks a module contains. */
export function countPythonBlocks(module: MAMModule): number {
  return findPythonBlocks(module).length;
}

/** Returns interpreter execution statistics, for diagnostics. */
export function getPythonExecutionStats(): Readonly<ReturnType<typeof getExecutionStats>> {
  return getExecutionStats();
}
