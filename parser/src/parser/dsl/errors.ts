/**
 * MAM DSL Diagnostics
 *
 * DSL-specific error types and helpers layered on top of the shared parser
 * `ParseError`. These provide richer, DSL-oriented error codes and formatting
 * for the v2 DSL parser pipeline without mutating the generic parser errors.
 */

import { ParseError, ParseErrorCode } from '../errors.js';

// ============================================================================
// DSL Error Codes
// ============================================================================

/**
 * DSL-specific error codes describing problems that occur while parsing or
 * validating v2 DSL module declarations.
 */
export enum DSLErrorCode {
  /** A module declaration is malformed (e.g. missing a name). */
  INVALID_MODULE_DECL = 'INVALID_MODULE_DECL',
  /** A section key is not recognized for the current module. */
  UNKNOWN_SECTION_KEY = 'UNKNOWN_SECTION_KEY',
  /** A `type:` value does not map to a known module type. */
  UNKNOWN_TYPE = 'UNKNOWN_TYPE',
  /** An edge is malformed or references unknown nodes. */
  INVALID_EDGE = 'INVALID_EDGE',
  /** A section was declared more than once on the same module. */
  DUPLICATE_SECTION = 'DUPLICATE_SECTION',
  /** A module is missing its required `type:` declaration. */
  MISSING_TYPE = 'MISSING_TYPE',
  /** A module is missing its name. */
  MISSING_NAME = 'MISSING_NAME',
  /** A block (`{ ... }`) was opened but never closed. */
  UNTERMINATED_BLOCK = 'UNTERMINATED_BLOCK',
  /** The token scanner encountered an unexpected token. */
  UNEXPECTED_TOKEN = 'UNEXPECTED_TOKEN',
  /** The token scanner ran out of input unexpectedly. */
  UNEXPECTED_EOF = 'UNEXPECTED_EOF',
  /** A section value is malformed for the section key. */
  INVALID_SECTION_VALUE = 'INVALID_SECTION_VALUE',
  /** A list item was declared more than once in the same list. */
  DUPLICATE_LIST_ITEM = 'DUPLICATE_LIST_ITEM',
  /** A module declaration produced no parseable content. */
  EMPTY_MODULE = 'EMPTY_MODULE',
}

// ============================================================================
// DSL Error
// ============================================================================

/**
 * A DSL-specific parse error.
 *
 * Extends the shared `ParseError` with a DSL-oriented error code and keeps the
 * error referenceable through the generic `ParseError` machinery so DSL errors
 * can flow through existing parser pipelines unchanged.
 */
export class DSLError extends ParseError {
  /** DSL-specific error code describing the failure. */
  public readonly dslCode: DSLErrorCode;

  /**
   * Creates a new DSL error.
   *
   * @param message - Human-readable description of the problem.
   * @param source - Name or identifier of the source document.
   * @param line - 1-based line where the error occurred.
   * @param column - 1-based column where the error occurred.
   * @param code - DSL-specific error code.
   * @param severity - Whether this is reported as an error or a warning.
   * @param expected - Optional list of expected token types or values.
   * @param found - Optional description of what was actually found.
   * @param context - Optional additional context string.
   */
  constructor(
    message: string,
    source: string,
    line: number,
    column: number,
    code: DSLErrorCode = DSLErrorCode.UNEXPECTED_TOKEN,
    severity: 'error' | 'warning' = 'error',
    expected?: string[],
    found?: string,
    context?: string
  ) {
    super(message, source, line, column, code as unknown as ParseErrorCode, severity, expected, found, context);
    this.name = 'DSLError';
    this.dslCode = code;
  }

  /**
   * Formats this error as a multi-line human-readable string including the
   * DSL-specific code description.
   */
  override toFormattedString(): string {
    let msg = `${this.source}:${this.line}:${this.column}: ${this.severity}: [${this.dslCode}] ${this.message}`;
    msg += `\n  ${describeDSLErrorCode(this.dslCode)}`;
    if (this.expected && this.found) {
      msg += `\n  expected: ${this.expected.join(' | ')}`;
      msg += `\n  found: ${this.found}`;
    }
    if (this.context) {
      msg += `\n  ${this.context}`;
    }
    return msg;
  }
}

// ============================================================================
// Factory Helpers
// ============================================================================

/**
 * Creates a new `DSLError` with sensible defaults for missing location info.
 *
 * @param code - DSL-specific error code.
 * @param message - Human-readable description of the problem.
 * @param source - Name or identifier of the source document (defaults to `<dsl>`).
 * @param line - 1-based line where the error occurred (defaults to 0).
 * @param column - 1-based column where the error occurred (defaults to 0).
 * @param severity - Whether this is reported as an error or a warning.
 * @param expected - Optional list of expected token types or values.
 * @param found - Optional description of what was actually found.
 * @param context - Optional additional context string.
 */
export function createDSLError(
  code: DSLErrorCode,
  message: string,
  source: string = '<dsl>',
  line: number = 0,
  column: number = 0,
  severity: 'error' | 'warning' = 'error',
  expected?: string[],
  found?: string,
  context?: string
): DSLError {
  return new DSLError(message, source, line, column, code, severity, expected, found, context);
}

/**
 * Type guard that narrows an unknown value to `DSLError`.
 *
 * @param value - Value to inspect.
 * @returns `true` when `value` is a `DSLError` instance.
 */
export function isDSLError(value: unknown): value is DSLError {
  return value instanceof DSLError;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Formats a `DSLError` as a human-readable, multi-line string.
 *
 * @param error - The DSL error to format.
 * @returns A formatted diagnostic string.
 */
export function formatDSLError(error: DSLError): string {
  const parts: string[] = [
    `${error.source}:${error.line}:${error.column}: ${error.severity}: [${error.dslCode}] ${error.message}`,
    `  ${describeDSLErrorCode(error.dslCode)}`,
  ];
  if (error.expected && error.found) {
    parts.push(`  expected: ${error.expected.join(' | ')}`);
    parts.push(`  found: ${error.found}`);
  }
  if (error.context) {
    parts.push(`  ${error.context}`);
  }
  return parts.join('\n');
}

/**
 * Returns a short human-readable description for a DSL error code.
 *
 * @param code - The DSL error code to describe.
 * @returns A description string.
 */
export function describeDSLErrorCode(code: DSLErrorCode): string {
  switch (code) {
    case DSLErrorCode.INVALID_MODULE_DECL:
      return 'The module declaration is malformed.';
    case DSLErrorCode.UNKNOWN_SECTION_KEY:
      return 'The section key is not recognized for this module.';
    case DSLErrorCode.UNKNOWN_TYPE:
      return 'The declared type does not map to a known module type.';
    case DSLErrorCode.INVALID_EDGE:
      return 'The edge is malformed or references unknown nodes.';
    case DSLErrorCode.DUPLICATE_SECTION:
      return 'A section was declared more than once on the same module.';
    case DSLErrorCode.MISSING_TYPE:
      return 'The module is missing its required type declaration.';
    case DSLErrorCode.MISSING_NAME:
      return 'The module is missing a name.';
    case DSLErrorCode.UNTERMINATED_BLOCK:
      return 'A block was opened but never closed.';
    case DSLErrorCode.UNEXPECTED_TOKEN:
      return 'An unexpected token was encountered.';
    case DSLErrorCode.UNEXPECTED_EOF:
      return 'Input ended unexpectedly.';
    case DSLErrorCode.INVALID_SECTION_VALUE:
      return 'The section value is malformed for its section key.';
    case DSLErrorCode.DUPLICATE_LIST_ITEM:
      return 'A list item was declared more than once in the same list.';
    case DSLErrorCode.EMPTY_MODULE:
      return 'The module declaration produced no parseable content.';
    default:
      return 'Unknown DSL error code.';
  }
}