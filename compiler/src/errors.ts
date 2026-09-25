/**
 * MAM Compiler Diagnostics
 *
 * Structured errors, warnings, and a collector for reporting compiler issues.
 */

// ============================================================================
// Codes
// ============================================================================

export enum CompileErrorCode {
  UNKNOWN_TARGET = 'UNKNOWN_TARGET',
  INVALID_INPUT = 'INVALID_INPUT',
  TRANSFORM_FAILED = 'TRANSFORM_FAILED',
  EMIT_FAILED = 'EMIT_FAILED',
  INVALID_OPTION = 'INVALID_OPTION',
  INTERNAL = 'INTERNAL',
}

// ============================================================================
// Location
// ============================================================================

export interface CompileLocation {
  line: number;
  column: number;
  source?: string;
}

// ============================================================================
// Errors
// ============================================================================

export interface CompileErrorOptions {
  code?: CompileErrorCode;
  module?: string;
  location?: CompileLocation;
  cause?: unknown;
}

export class CompileError extends Error {
  readonly code: CompileErrorCode;
  readonly module?: string;
  readonly location?: CompileLocation;
  readonly cause?: unknown;

  constructor(message: string, options: CompileErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CompileError';
    this.code = options.code ?? CompileErrorCode.INTERNAL;
    this.module = options.module;
    this.location = options.location;
    this.cause = options.cause;
  }
}

// ============================================================================
// Warnings & Issues
// ============================================================================

export interface CompileWarning {
  code: CompileErrorCode | string;
  message: string;
  module?: string;
  location?: CompileLocation;
}

export type CompileIssue = CompileError | CompileWarning;

// ============================================================================
// Issue Collector
// ============================================================================

export class CompileIssueCollector {
  private issues: CompileIssue[] = [];

  addError(error: CompileError): this {
    this.issues.push(error);
    return this;
  }

  addWarning(warning: CompileWarning): this {
    this.issues.push(warning);
    return this;
  }

  getAll(): CompileIssue[] {
    return [...this.issues];
  }

  hasErrors(): boolean {
    return this.issues.some(issue => issue instanceof CompileError);
  }

  toFormattedString(): string {
    if (this.issues.length === 0) return '';
    return this.issues
      .map(issue =>
        issue instanceof CompileError ? formatCompileError(issue) : formatIssue(issue),
      )
      .join('\n');
  }

  clear(): void {
    this.issues = [];
  }
}

// ============================================================================
// Formatting
// ============================================================================

export function formatCompileError(err: CompileError): string {
  return formatIssue(err);
}

function formatIssue(issue: CompileIssue): string {
  const parts = [`[${issue.code}] ${issue.message}`];
  if (issue.module) parts.push(`module: ${issue.module}`);
  if (issue.location) {
    const src = issue.location.source ? `${issue.location.source}:` : '';
    parts.push(`at ${src}${issue.location.line}:${issue.location.column}`);
  }
  if (issue instanceof CompileError && issue.cause !== undefined) {
    parts.push(`cause: ${String(issue.cause)}`);
  }
  return parts.join(' | ');
}