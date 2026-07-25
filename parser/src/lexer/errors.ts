/**
 * MAM Lexer Errors
 * 
 * Comprehensive error types and utilities for lexical analysis.
 */

export class LexerError extends Error {
  public readonly source: string;
  public readonly line: number;
  public readonly column: number;
  public readonly code: LexerErrorCode;
  public readonly severity: 'error' | 'warning';
  public readonly context?: string;

  constructor(
    message: string,
    source: string,
    line: number,
    column: number,
    code: LexerErrorCode = LexerErrorCode.UNEXPECTED_CHARACTER,
    severity: 'error' | 'warning' = 'error',
    context?: string
  ) {
    super(message);
    this.name = 'LexerError';
    this.source = source;
    this.line = line;
    this.column = column;
    this.code = code;
    this.severity = severity;
    this.context = context;
  }

  toFormattedString(): string {
    let msg = `${this.source}:${this.line}:${this.column}: ${this.severity}: [${this.code}] ${this.message}`;
    if (this.context) {
      msg += `\n  ${this.context}`;
      msg += `\n  ${'~'.repeat(Math.min(this.column, 20))}^`;
    }
    return msg;
  }
}

export enum LexerErrorCode {
  UNEXPECTED_CHARACTER = 'UNEXPECTED_CHARACTER',
  UNTERMINATED_STRING = 'UNTERMINATED_STRING',
  INVALID_FRONTMATTER = 'INVALID_FRONTMATTER',
  UNTERMINATED_FRONTMATTER = 'UNTERMINATED_FRONTMATTER',
  INVALID_HEADING = 'INVALID_HEADING',
  INVALID_CODE_BLOCK = 'INVALID_CODE_BLOCK',
  UNTERMINATED_CODE_BLOCK = 'UNTERMINATED_CODE_BLOCK',
  INVALID_LANGUAGE = 'INVALID_LANGUAGE',
  INVALID_LIST_MARKER = 'INVALID_LIST_MARKER',
  INVALID_TABLE_SYNTAX = 'INVALID_TABLE_SYNTAX',
  INVALID_LINK_SYNTAX = 'INVALID_LINK_SYNTAX',
  INVALID_IMAGE_SYNTAX = 'INVALID_IMAGE_SYNTAX',
  INVALID_YAML = 'INVALID_YAML',
  TOKEN_TOO_LONG = 'TOKEN_TOO_LONG',
  DEPTH_EXCEEDED = 'DEPTH_EXCEEDED',
  ENCODING_ERROR = 'ENCODING_ERROR',
}

export class LexerWarning {
  public readonly message: string;
  public readonly source: string;
  public readonly line: number;
  public readonly column: number;
  public readonly code: LexerWarningCode;

  constructor(
    message: string,
    source: string,
    line: number,
    column: number,
    code: LexerWarningCode
  ) {
    this.message = message;
    this.source = source;
    this.line = line;
    this.column = column;
    this.code = code;
  }

  toFormattedString(): string {
    return `${this.source}:${this.line}:${this.column}: warning: [${this.code}] ${this.message}`;
  }
}

export enum LexerWarningCode {
  DEPRECATED_SYNTAX = 'DEPRECATED_SYNTAX',
  INCONSISTENT_STYLE = 'INCONSISTENT_STYLE',
  LONG_LINE = 'LONG_LINE',
  TRAILING_WHITESPACE = 'TRAILING_WHITESPACE',
  MULTIPLE_BLANK_LINES = 'MULTIPLE_BLANK_LINES',
  MISSING_NEWLINE_AT_EOF = 'MISSING_NEWLINE_AT_EOF',
}