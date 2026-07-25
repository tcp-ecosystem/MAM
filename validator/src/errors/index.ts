/**
 * MAM Validator Errors
 * 
 * Error types and utilities for MAM validation.
 */

import { SourceLocation } from '@mam/ast';

export interface ValidationError {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Error severity */
  severity: Severity;
  /** Source location of the error */
  location?: SourceLocation;
  /** Path to the error in the AST */
  path?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

export interface ValidationWarning {
  /** Warning code for programmatic handling */
  code: WarningCode;
  /** Human-readable warning message */
  message: string;
  /** Source location of the warning */
  location?: SourceLocation;
  /** Path to the warning in the AST */
  path?: string;
}

export type Severity = 'error' | 'warning' | 'info';

export enum ErrorCode {
  // Front matter errors
  MISSING_FRONTMATTER = 'MISSING_FRONTMATTER',
  INVALID_YAML = 'INVALID_YAML',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FIELD_TYPE = 'INVALID_FIELD_TYPE',
  INVALID_ID_FORMAT = 'INVALID_ID_FORMAT',
  INVALID_VERSION_FORMAT = 'INVALID_VERSION_FORMAT',
  INVALID_RUNTIME = 'INVALID_RUNTIME',
  INVALID_PERMISSION = 'INVALID_PERMISSION',
  
  // Section errors
  MISSING_SECTION = 'MISSING_SECTION',
  DUPLICATE_SECTION = 'DUPLICATE_SECTION',
  EMPTY_SECTION = 'EMPTY_SECTION',
  INVALID_SECTION_NAME = 'INVALID_SECTION_NAME',
  INVALID_SECTION_ORDER = 'INVALID_SECTION_ORDER',
  
  // Content errors
  INVALID_CONTENT_TYPE = 'INVALID_CONTENT_TYPE',
  MALFORMED_TABLE = 'MALFORMED_TABLE',
  UNTERMINATED_CODE_BLOCK = 'UNTERMINATED_CODE_BLOCK',
  INVALID_LANGUAGE = 'INVALID_LANGUAGE',
  
  // Reference errors
  UNRESOLVED_DEPENDENCY = 'UNRESOLVED_DEPENDENCY',
  INVALID_URL = 'INVALID_URL',
  BROKEN_REFERENCE = 'BROKEN_REFERENCE',
  
  // Schema errors
  SCHEMA_VIOLATION = 'SCHEMA_VIOLATION',
  EXTRA_PROPERTY = 'EXTRA_PROPERTY',
  TYPE_MISMATCH = 'TYPE_MISMATCH',
}

export enum WarningCode {
  // Style warnings
  DEPRECATED_SYNTAX = 'DEPRECATED_SYNTAX',
  INCONSISTENT_STYLE = 'INCONSISTENT_STYLE',
  LONG_LINE = 'LONG_LINE',
  TRAILING_WHITESPACE = 'TRAILING_WHITESPACE',
  
  // Best practice warnings
  MISSING_DESCRIPTION = 'MISSING_DESCRIPTION',
  MISSING_TAGS = 'MISSING_TAGS',
  MISSING_EXAMPLES = 'MISSING_EXAMPLES',
  MISSING_TESTS = 'MISSING_TESTS',
  MISSING_REFERENCES = 'MISSING_REFERENCES',
  
  // Future warnings
  FUTURE_DEPRECATION = 'FUTURE_DEPRECATION',
}

export interface ValidationReport {
  /** All errors found */
  errors: ValidationError[];
  /** All warnings found */
  warnings: ValidationWarning[];
  /** Whether validation passed */
  valid: boolean;
  /** Validation statistics */
  stats: ValidationStats;
}

export interface ValidationStats {
  /** Number of errors */
  errorCount: number;
  /** Number of warnings */
  warningCount: number;
  /** Number of rules checked */
  rulesChecked: number;
  /** Validation time in milliseconds */
  timeMs: number;
}

export function createValidationError(
  code: ErrorCode,
  message: string,
  location?: SourceLocation,
  path?: string,
  context?: Record<string, unknown>
): ValidationError {
  return {
    code,
    message,
    severity: 'error',
    location,
    path,
    context,
  };
}

export function createValidationWarning(
  code: WarningCode,
  message: string,
  location?: SourceLocation,
  path?: string
): ValidationWarning {
  return {
    code,
    message,
    location,
    path,
  };
}

export function formatValidationError(error: ValidationError): string {
  let msg = '';
  if (error.location) {
    msg += `${error.location.source}:${error.location.start.line}:${error.location.start.column}: `;
  }
  msg += `error [${error.code}]: ${error.message}`;
  if (error.path) {
    msg += `\n  at: ${error.path}`;
  }
  return msg;
}

export function formatValidationWarning(warning: ValidationWarning): string {
  let msg = '';
  if (warning.location) {
    msg += `${warning.location.source}:${warning.location.start.line}:${warning.location.start.column}: `;
  }
  msg += `warning [${warning.code}]: ${warning.message}`;
  if (warning.path) {
    msg += `\n  at: ${warning.path}`;
  }
  return msg;
}