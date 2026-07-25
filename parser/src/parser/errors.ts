/**
 * MAM Parser Errors
 * 
 * Comprehensive error types for syntax analysis.
 */

export class ParseError extends Error {
  public readonly source: string;
  public readonly line: number;
  public readonly column: number;
  public readonly code: ParseErrorCode;
  public readonly expected?: string[];
  public readonly found?: string;
  public readonly severity: 'error' | 'warning';
  public readonly context?: string;

  constructor(
    message: string,
    source: string,
    line: number,
    column: number,
    code: ParseErrorCode = ParseErrorCode.UNEXPECTED_TOKEN,
    severity: 'error' | 'warning' = 'error',
    expected?: string[],
    found?: string,
    context?: string
  ) {
    super(message);
    this.name = 'ParseError';
    this.source = source;
    this.line = line;
    this.column = column;
    this.code = code;
    this.severity = severity;
    this.expected = expected;
    this.found = found;
    this.context = context;
  }

  toFormattedString(): string {
    let msg = `${this.source}:${this.line}:${this.column}: ${this.severity}: [${this.code}] ${this.message}`;
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

export enum ParseErrorCode {
  UNEXPECTED_TOKEN = 'UNEXPECTED_TOKEN',
  EXPECTED_FRONTMATTER = 'EXPECTED_FRONTMATTER',
  EXPECTED_HEADING = 'EXPECTED_HEADING',
  EXPECTED_SECTION_NAME = 'EXPECTED_SECTION_NAME',
  EXPECTED_CODE_FENCE = 'EXPECTED_CODE_FENCE',
  EXPECTED_LIST_ITEM = 'EXPECTED_LIST_ITEM',
  EXPECTED_TABLE = 'EXPECTED_TABLE',
  UNTERMINATED_CODE_BLOCK = 'UNTERMINATED_CODE_BLOCK',
  UNTERMINATED_FRONTMATTER = 'UNTERMINATED_FRONTMATTER',
  UNTERMINATED_LIST = 'UNTERMINATED_LIST',
  UNTERMINATED_TABLE = 'UNTERMINATED_TABLE',
  INVALID_YAML = 'INVALID_YAML',
  DUPLICATE_SECTION = 'DUPLICATE_SECTION',
  MISSING_REQUIRED_SECTION = 'MISSING_REQUIRED_SECTION',
  INVALID_SECTION_ORDER = 'INVALID_SECTION_ORDER',
  MAX_DEPTH_EXCEEDED = 'MAX_DEPTH_EXCEEDED',
  INVALID_NESTING = 'INVALID_NESTING',
  MISSING_CLOSING_FENCE = 'MISSING_CLOSING_FENCE',
  INVALID_TABLE_SYNTAX = 'INVALID_TABLE_SYNTAX',
  INVALID_HEADING_LEVEL = 'INVALID_HEADING_LEVEL',
}

export class ParseWarning {
  public readonly message: string;
  public readonly source: string;
  public readonly line: number;
  public readonly column: number;
  public readonly code: ParseWarningCode;

  constructor(
    message: string,
    source: string,
    line: number,
    column: number,
    code: ParseWarningCode
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

export enum ParseWarningCode {
  DEPRECATED_SYNTAX = 'DEPRECATED_SYNTAX',
  INCONSISTENT_HEADING_LEVEL = 'INCONSISTENT_HEADING_LEVEL',
  EMPTY_SECTION = 'EMPTY_SECTION',
  UNKNOWN_SECTION = 'UNKNOWN_SECTION',
  SECTION_ORDER = 'SECTION_ORDER',
  MISSING_CONTENT = 'MISSING_CONTENT',
  DUPLICATE_HEADING = 'DUPLICATE_HEADING',
}