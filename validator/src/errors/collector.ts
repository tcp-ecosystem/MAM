/**
 * MAM Validation Issue Collector
 *
 * An accumulating, mutable store for `ValidationIssue` objects. The collector
 * offers fluent `addError`/`addWarning`/`addInfo` convenience methods, a full
 * set of read queries, and the ability to produce a standard
 * `ValidationReport` for a given source file.
 */

import type { SourceLocation } from '@mam/ast';
import type {
  ErrorCode,
  ValidationError,
  ValidationReport,
  ValidationStats,
  ValidationWarning,
  WarningCode,
} from './index.js';
import type { SeverityCounts, SourceRange, ValidationIssue } from './types.js';
import { countBySeverity as countIssuesBySeverity } from './issues.js';

/**
 * A mutable collector that accumulates validation issues and can materialize
 * them into a standard `ValidationReport`.
 *
 * @remarks
 * Issues are stored in insertion order. The collector never mutates the issues
 * it is handed. `toReport` converts issues into the stricter
 * `ValidationError`/`ValidationWarning` shapes used by the public validator
 * API; issues at severity `'info'` are not represented in the report's
 * `errors`/`warnings` arrays but are still returned by `getAll`.
 */
export class ValidationIssueCollector {
  private issues: ValidationIssue[] = [];

  /**
   * Add an already-constructed issue to the collector.
   *
   * @param issue - The issue to add.
   * @returns `this` for chaining.
   */
  add(issue: ValidationIssue): this {
    this.issues.push(issue);
    return this;
  }

  /**
   * Add an error issue.
   *
   * @param code - The error code.
   * @param message - The error message.
   * @param location - Optional source range.
   * @param path - Optional AST path.
   * @returns `this` for chaining.
   */
  addError(
    code: ErrorCode | string,
    message: string,
    location?: SourceRange,
    path?: string
  ): this {
    return this.add({ code, message, severity: 'error', location, path });
  }

  /**
   * Add a warning issue.
   *
   * @param code - The warning code.
   * @param message - The warning message.
   * @param location - Optional source range.
   * @param path - Optional AST path.
   * @returns `this` for chaining.
   */
  addWarning(
    code: WarningCode | string,
    message: string,
    location?: SourceRange,
    path?: string
  ): this {
    return this.add({ code, message, severity: 'warning', location, path });
  }

  /**
   * Add an informational issue.
   *
   * @param code - The issue code.
   * @param message - The informational message.
   * @param location - Optional source range.
   * @param path - Optional AST path.
   * @returns `this` for chaining.
   */
  addInfo(
    code: ErrorCode | WarningCode | string,
    message: string,
    location?: SourceRange,
    path?: string
  ): this {
    return this.add({ code, message, severity: 'info', location, path });
  }

  /**
   * Get all issues at severity `'error'`.
   *
   * @returns A new array of error issues, in insertion order.
   */
  getErrors(): ValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === 'error');
  }

  /**
   * Get all issues at severity `'warning'`.
   *
   * @returns A new array of warning issues, in insertion order.
   */
  getWarnings(): ValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === 'warning');
  }

  /**
   * Get all issues at severity `'info'`.
   *
   * @returns A new array of informational issues, in insertion order.
   */
  getInfo(): ValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === 'info');
  }

  /**
   * Get a copy of every collected issue.
   *
   * @returns A new array containing all issues, in insertion order.
   */
  getAll(): ValidationIssue[] {
    return [...this.issues];
  }

  /**
   * Count the total number of collected issues.
   *
   * @returns The number of issues in the collector.
   */
  count(): number {
    return this.issues.length;
  }

  /**
   * Count issues per severity.
   *
   * @returns An object with `error`, `warning`, and `info` totals.
   */
  countBySeverity(): SeverityCounts {
    return countIssuesBySeverity(this.issues);
  }

  /**
   * Materialize the collected issues into a standard `ValidationReport`.
   *
   * Error issues become `ValidationError`s and warning issues become
   * `ValidationWarning`s. Informational issues are excluded from the report's
   * `errors`/`warnings` arrays. `rulesChecked` reflects the number of distinct
   * rule names referenced by collected issues.
   *
   * @param file - Source file name used to populate each location's `source`.
   * @returns A fully-populated `ValidationReport`.
   */
  toReport(file: string): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const rules = new Set<string>();

    for (const issue of this.issues) {
      if (issue.rule) rules.add(issue.rule);
      const location = toSourceLocation(issue.location, file);
      if (issue.severity === 'error') {
        errors.push({
          code: issue.code as ErrorCode,
          message: issue.message,
          severity: 'error',
          location,
          path: issue.path,
          context: issue.context,
        });
      } else if (issue.severity === 'warning') {
        warnings.push({
          code: issue.code as WarningCode,
          message: issue.message,
          location,
          path: issue.path,
        });
      }
    }

    const stats: ValidationStats = {
      errorCount: errors.length,
      warningCount: warnings.length,
      rulesChecked: rules.size,
      timeMs: 0,
    };

    return {
      errors,
      warnings,
      valid: errors.length === 0,
      stats,
    };
  }

  /**
   * Remove all collected issues.
   */
  clear(): void {
    this.issues = [];
  }

  /**
   * Whether the collector currently holds no issues.
   *
   * @returns `true` when no issues have been collected.
   */
  isEmpty(): boolean {
    return this.issues.length === 0;
  }
}

/**
 * Convert a `SourceRange` into an AST `SourceLocation` for a given source file.
 * Missing offsets default to `0`.
 */
function toSourceLocation(
  range: SourceRange | undefined,
  file: string
): SourceLocation | undefined {
  if (!range) return undefined;
  return {
    start: {
      line: range.start.line,
      column: range.start.column,
      offset: range.start.offset ?? 0,
    },
    end: {
      line: range.end.line,
      column: range.end.column,
      offset: range.end.offset ?? 0,
    },
    source: file,
  };
}