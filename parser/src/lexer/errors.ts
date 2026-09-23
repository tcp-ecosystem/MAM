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

// ============================================================================
// Severity helpers
// ============================================================================

/**
 * The severity level associated with a {@link LexerError}.
 *
 * Errors marked as `'warning'` are still surfaced through the `errors` channel
 * but are non-fatal and typically indicate recoverable or stylistic problems.
 * Errors marked as `'error'` represent genuine lexical failures.
 */
export type LexerSeverity = 'error' | 'warning';

/**
 * The set of severities accepted by `normalizeSeverity`, kept for easy reuse.
 */
export const LEXER_SEVERITIES: readonly LexerSeverity[] = ['error', 'warning'];

/**
 * Normalize an arbitrary severity input to the canonical union.
 *
 * Any value other than the string `'warning'` is treated as `'error'`, which
 * makes this helper safe to call with untrusted or loosely typed input (for
 * example values parsed from JSON or command-line configuration).
 *
 * @param severity - Raw severity value. Only the literal string `'warning'`
 *   is mapped to `'warning'`; everything else maps to `'error'`.
 * @returns A canonical `'error' | 'warning'` severity.
 */
export function normalizeSeverity(severity: unknown): LexerSeverity {
  return severity === 'warning' ? 'warning' : 'error';
}

/**
 * Check whether a value represents the `'warning'` severity.
 *
 * @param severity - The value to inspect.
 * @returns `true` when `severity === 'warning'`, `false` otherwise.
 */
export function isWarningSeverity(severity: unknown): boolean {
  return severity === 'warning';
}

// ============================================================================
// Predicates and formatting
// ============================================================================

/**
 * Type guard that narrows an arbitrary value to a {@link LexerError}.
 *
 * The check is structural rather than instanceof-based so that errors created
 * across module boundaries or reconstructed from JSON still pass. A value is
 * considered a `LexerError` when it looks like an object carrying a `name` of
 * `'LexerError'`, a valid {@link LexerErrorCode} in `code`, and numeric
 * `line`/`column`/`source` fields.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a valid `LexerError`-shaped object.
 */
export function isLexerError(value: unknown): value is LexerError {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<LexerError>;
  return (
    typeof candidate.message === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.line === 'number' &&
    typeof candidate.column === 'number' &&
    typeof candidate.code === 'string' &&
    (candidate.code as string) in LexerErrorCode
  );
}

/**
 * Render a {@link LexerError} as a single-line, human-readable string.
 *
 * This is a standalone counterpart to `LexerError#toFormattedString`. It always
 * produces a compact one-line form; the multi-line context rendering is
 * available through the instance method instead.
 *
 * @param error - The lexer error to format.
 * @returns A string shaped like
 *   `source:line:column: severity: [CODE] message`.
 */
export function formatLexerError(error: LexerError): string {
  return `${error.source}:${error.line}:${error.column}: ${error.severity}: [${error.code}] ${error.message}`;
}

/**
 * Render a {@link LexerWarning} as a single-line, human-readable string.
 *
 * The output mirrors `LexerWarning#toFormattedString` and is provided as a
 * free function so warnings can be formatted uniformly in arrays and streams.
 *
 * @param warning - The lexer warning to format.
 * @returns A string shaped like `source:line:column: warning: [CODE] message`.
 */
export function formatLexerWarning(warning: LexerWarning): string {
  return `${warning.source}:${warning.line}:${warning.column}: warning: [${warning.code}] ${warning.message}`;
}

// ============================================================================
// Error factory
// ============================================================================

/**
 * Create a {@link LexerError} using positional arguments.
 *
 * This factory mirrors the `LexerError` constructor but is convenient when the
 * severity and context are optional or derived programmatically. The `code`
 * defaults to `LexerErrorCode.UNEXPECTED_CHARACTER` and the severity defaults
 * to `'error'`, matching the constructor defaults.
 *
 * @param message - Human-readable description of the failure.
 * @param source - The source name (file path or synthetic label) being lexed.
 * @param line - One-based line number where the problem occurred.
 * @param column - Zero-based column number where the problem occurred.
 * @param code - The {@link LexerErrorCode} categorizing the failure.
 * @param severity - `'error'` (default) or `'warning'`.
 * @param context - Optional snippet of the offending input line.
 * @returns A fully initialized `LexerError`.
 */
export function createLexerError(
  message: string,
  source: string,
  line: number,
  column: number,
  code: LexerErrorCode = LexerErrorCode.UNEXPECTED_CHARACTER,
  severity: LexerSeverity = 'error',
  context?: string
): LexerError {
  return new LexerError(message, source, line, column, code, severity, context);
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * The shape of a {@link LexerError} when serialized to JSON.
 *
 * This mirrors the public fields of `LexerError` plus `name`, which allows the
 * round-trip through {@link lexerErrorFromJSON} to reconstruct a faithful
 * instance. The `context` field is omitted when `undefined`.
 */
export interface LexerErrorJSON {
  name: string;
  message: string;
  source: string;
  line: number;
  column: number;
  code: LexerErrorCode;
  severity: LexerSeverity;
  context?: string;
}

/**
 * Serialize a {@link LexerError} to a plain JSON-compatible object.
 *
 * The result contains only primitive values, so it can be passed directly to
 * `JSON.stringify`, stored, logged, or transmitted to another process.
 *
 * @param error - The lexer error to serialize.
 * @returns A {@link LexerErrorJSON} object with all error fields.
 */
export function lexerErrorToJSON(error: LexerError): LexerErrorJSON {
  const json: LexerErrorJSON = {
    name: error.name,
    message: error.message,
    source: error.source,
    line: error.line,
    column: error.column,
    code: error.code,
    severity: error.severity,
  };
  if (error.context !== undefined) {
    json.context = error.context;
  }
  return json;
}

/**
 * Reconstruct a {@link LexerError} from a JSON-compatible object.
 *
 * The input is validated defensively: when it is not a well-formed error
 * object, `null` is returned instead of throwing, so callers can safely feed
 * untrusted input. All numeric and string fields are normalized with sensible
 * fallbacks.
 *
 * @param json - The object previously produced by {@link lexerErrorToJSON} (or
 *   any structurally compatible object).
 * @returns A reconstructed `LexerError`, or `null` when the input is invalid.
 */
export function lexerErrorFromJSON(json: unknown): LexerError | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const candidate = json as Record<string, unknown>;
  if (typeof candidate.message !== 'string' || typeof candidate.source !== 'string') {
    return null;
  }
  const line = typeof candidate.line === 'number' ? candidate.line : 0;
  const column = typeof candidate.column === 'number' ? candidate.column : 0;
  const code =
    typeof candidate.code === 'string' && (candidate.code as string) in LexerErrorCode
      ? (candidate.code as LexerErrorCode)
      : LexerErrorCode.UNEXPECTED_CHARACTER;
  const severity = normalizeSeverity(candidate.severity);
  const context = typeof candidate.context === 'string' ? candidate.context : undefined;
  return new LexerError(candidate.message, candidate.source, line, column, code, severity, context);
}

/**
 * Serialize a {@link LexerWarning} to a plain JSON-compatible object.
 *
 * @param warning - The lexer warning to serialize.
 * @returns A JSON object containing `message`, `source`, `line`, `column`, and
 *   `code` fields.
 */
export function lexerWarningToJSON(warning: LexerWarning): Record<string, unknown> {
  return {
    name: 'LexerWarning',
    message: warning.message,
    source: warning.source,
    line: warning.line,
    column: warning.column,
    code: warning.code,
  };
}

/**
 * Reconstruct a {@link LexerWarning} from a JSON-compatible object.
 *
 * @param json - The object previously produced by {@link lexerWarningToJSON}.
 * @returns A reconstructed `LexerWarning`, or `null` when the input is invalid.
 */
export function lexerWarningFromJSON(json: unknown): LexerWarning | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const candidate = json as Record<string, unknown>;
  if (typeof candidate.message !== 'string' || typeof candidate.source !== 'string') {
    return null;
  }
  const line = typeof candidate.line === 'number' ? candidate.line : 0;
  const column = typeof candidate.column === 'number' ? candidate.column : 0;
  const code =
    typeof candidate.code === 'string' && (candidate.code as string) in LexerWarningCode
      ? (candidate.code as LexerWarningCode)
      : LexerWarningCode.LONG_LINE;
  return new LexerWarning(candidate.message, candidate.source, line, column, code);
}

// ============================================================================
// Error code descriptions
// ============================================================================

/**
 * A mapping from every {@link LexerErrorCode} to a human-readable description
 * of the condition it represents.
 *
 * This map is used by {@link describeLexerErrorCode} and is exported so that
 * tooling (CLI reporters, IDE plugins, documentation generators) can iterate
 * over every known error code.
 */
export const LEXER_ERROR_CODE_DESCRIPTIONS: Record<LexerErrorCode, string> = {
  [LexerErrorCode.UNEXPECTED_CHARACTER]:
    'A character was encountered that does not begin any valid MAM/Markdown token.',
  [LexerErrorCode.UNTERMINATED_STRING]:
    'An inline code span or quoted string was opened but never closed before the end of input.',
  [LexerErrorCode.INVALID_FRONTMATTER]:
    'The front matter block is malformed, for example a missing closing delimiter or invalid content.',
  [LexerErrorCode.UNTERMINATED_FRONTMATTER]:
    'The front matter block was opened with a `---` separator but never closed.',
  [LexerErrorCode.INVALID_HEADING]:
    'A heading marker was malformed, such as a heading with no following text or invalid spacing.',
  [LexerErrorCode.INVALID_CODE_BLOCK]:
    'A code fence is malformed, for example a fence with mixed backtick and tilde delimiters.',
  [LexerErrorCode.UNTERMINATED_CODE_BLOCK]:
    'A code block was opened with a fence but the closing fence was never found.',
  [LexerErrorCode.INVALID_LANGUAGE]:
    'The language identifier on a code fence is empty, malformed, or otherwise unusable.',
  [LexerErrorCode.INVALID_LIST_MARKER]:
    'A list marker is malformed, such as a numbered list item without a valid number and period.',
  [LexerErrorCode.INVALID_TABLE_SYNTAX]:
    'A table row or separator is malformed, such as a separator row with inconsistent column counts.',
  [LexerErrorCode.INVALID_LINK_SYNTAX]:
    'A link is malformed, such as a missing closing bracket or an empty destination URL.',
  [LexerErrorCode.INVALID_IMAGE_SYNTAX]:
    'An image reference is malformed, such as an empty alt text or a missing destination URL.',
  [LexerErrorCode.INVALID_YAML]:
    'A YAML line inside front matter is malformed and cannot be tokenized into key/value pairs.',
  [LexerErrorCode.TOKEN_TOO_LONG]:
    'A single token exceeded the configured maximum token length, which guards against pathological input.',
  [LexerErrorCode.DEPTH_EXCEEDED]:
    'The tokenizer nesting depth exceeded the configured maximum, usually due to deeply nested structures.',
  [LexerErrorCode.ENCODING_ERROR]:
    'The input could not be decoded as valid text, such as malformed UTF-8 byte sequences.',
};

/**
 * Return a human-readable description for a {@link LexerErrorCode}.
 *
 * Unknown or foreign codes fall back to a generic description so callers never
 * receive `undefined` when iterating over error collections.
 *
 * @param code - The error code to describe.
 * @returns A descriptive sentence about the condition the code represents.
 */
export function describeLexerErrorCode(code: LexerErrorCode): string {
  return LEXER_ERROR_CODE_DESCRIPTIONS[code] ?? 'An unknown lexer error occurred.';
}

/**
 * A mapping from every {@link LexerWarningCode} to a human-readable description.
 */
export const LEXER_WARNING_CODE_DESCRIPTIONS: Record<LexerWarningCode, string> = {
  [LexerWarningCode.DEPRECATED_SYNTAX]:
    'A syntax construct was used that is deprecated and should be migrated to the modern form.',
  [LexerWarningCode.INCONSISTENT_STYLE]:
    'The document mixes stylistic conventions, such as inconsistent list markers or heading styles.',
  [LexerWarningCode.LONG_LINE]:
    'A line is longer than the recommended threshold, which can hurt readability.',
  [LexerWarningCode.TRAILING_WHITESPACE]:
    'A line ends with trailing whitespace that should be trimmed.',
  [LexerWarningCode.MULTIPLE_BLANK_LINES]:
    'Multiple consecutive blank lines were found; a single blank line is usually sufficient.',
  [LexerWarningCode.MISSING_NEWLINE_AT_EOF]:
    'The file does not end with a final newline character.',
};

/**
 * Return a human-readable description for a {@link LexerWarningCode}.
 *
 * @param code - The warning code to describe.
 * @returns A descriptive sentence about the condition the code represents.
 */
export function describeLexerWarningCode(code: LexerWarningCode): string {
  return LEXER_WARNING_CODE_DESCRIPTIONS[code] ?? 'An unknown lexer warning occurred.';
}

// ============================================================================
// Error details
// ============================================================================

/**
 * A fully deconstructed view of a {@link LexerError}.
 *
 * `LexerErrorDetails` separates the raw positional fields (`line`, `column`)
 * from computed convenience fields (`offset`-free one-based display column,
 * description, formatted string) so that consumers such as syntax highlighters
 * and error panels can render rich diagnostics without re-parsing the message.
 */
export interface LexerErrorDetails {
  /** The original message attached to the error. */
  message: string;
  /** The source name being lexed. */
  source: string;
  /** One-based line number where the error occurred. */
  line: number;
  /** Zero-based column number where the error occurred. */
  column: number;
  /** One-based column number, convenient for most editors and terminals. */
  displayColumn: number;
  /** The error code categorizing the failure. */
  code: LexerErrorCode;
  /** The severity of the failure. */
  severity: LexerSeverity;
  /** Optional context snippet from the offending line. */
  context?: string;
  /** Human-readable description derived from the error code. */
  description: string;
  /** The fully formatted, ready-to-display diagnostic string. */
  formatted: string;
}

/**
 * Build a {@link LexerErrorDetails} object from a {@link LexerError}.
 *
 * @param error - The lexer error to expand into details.
 * @returns A `LexerErrorDetails` object with both raw and computed fields.
 */
export function createLexerErrorDetails(error: LexerError): LexerErrorDetails {
  return {
    message: error.message,
    source: error.source,
    line: error.line,
    column: error.column,
    displayColumn: error.column + 1,
    code: error.code,
    severity: error.severity,
    context: error.context,
    description: describeLexerErrorCode(error.code),
    formatted: formatLexerError(error),
  };
}

// ============================================================================
// Error summaries and counting
// ============================================================================

/**
 * Count occurrences of each {@link LexerErrorCode} across a collection.
 *
 * Every known error code is present in the result initialized to `0`, so callers
 * can safely index into the record without checking for `undefined`.
 *
 * @param errors - The errors to tally.
 * @returns A `Record<LexerErrorCode, number>` with one key per error code.
 */
export function countErrorsByCode(errors: readonly LexerError[]): Record<LexerErrorCode, number> {
  const counts = {} as Record<LexerErrorCode, number>;
  for (const code of Object.values(LexerErrorCode)) {
    counts[code] = 0;
  }
  for (const error of errors) {
    counts[error.code] = (counts[error.code] ?? 0) + 1;
  }
  return counts;
}

/**
 * Count occurrences of each {@link LexerWarningCode} across a collection.
 *
 * @param warnings - The warnings to tally.
 * @returns A `Record<LexerWarningCode, number>` with one key per warning code.
 */
export function countWarningsByCode(warnings: readonly LexerWarning[]): Record<LexerWarningCode, number> {
  const counts = {} as Record<LexerWarningCode, number>;
  for (const code of Object.values(LexerWarningCode)) {
    counts[code] = 0;
  }
  for (const warning of warnings) {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  }
  return counts;
}

/**
 * An aggregate statistical view of a collection of {@link LexerError}s.
 *
 * Produced by {@link summarizeLexerErrors}, this is convenient for reporting
 * tools, CI output, and dashboards that need a compact digest of a parse run.
 */
export interface LexerErrorSummary {
  /** Total number of errors in the collection. */
  total: number;
  /** Number of errors with severity `'error'`. */
  errorCount: number;
  /** Number of errors with severity `'warning'`. */
  warningCount: number;
  /** The source name reported by the first error, if any. */
  source: string;
  /** Tally of errors grouped by {@link LexerErrorCode}. */
  byCode: Record<LexerErrorCode, number>;
  /** The most frequently occurring error code, or `null` for an empty set. */
  mostCommonCode: LexerErrorCode | null;
  /** `true` when at least one error exists. */
  hasErrors: boolean;
  /** The distinct line numbers on which errors occurred, sorted ascending. */
  lines: number[];
}

/**
 * Produce an aggregate {@link LexerErrorSummary} for an error collection.
 *
 * The summary is stable for empty inputs: `total` is `0`, `mostCommonCode` is
 * `null`, and `lines` is an empty array.
 *
 * @param errors - The errors to summarize.
 * @returns A summary object describing the collection.
 */
export function summarizeLexerErrors(errors: readonly LexerError[]): LexerErrorSummary {
  const byCode = countErrorsByCode(errors);
  let errorCount = 0;
  let warningCount = 0;
  const lines = new Set<number>();
  let mostCommonCode: LexerErrorCode | null = null;
  let mostCommonCount = 0;

  for (const error of errors) {
    if (error.severity === 'warning') {
      warningCount++;
    } else {
      errorCount++;
    }
    lines.add(error.line);
    const count = byCode[error.code] ?? 0;
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonCode = error.code;
    }
  }

  return {
    total: errors.length,
    errorCount,
    warningCount,
    source: errors.length > 0 ? errors[0]!.source : '',
    byCode,
    mostCommonCode,
    hasErrors: errors.length > 0,
    lines: Array.from(lines).sort((a, b) => a - b),
  };
}

// ============================================================================
// Error collection
// ============================================================================

/**
 * An ordered, position-sortable collection of {@link LexerError}s.
 *
 * `LexerErrorCollection` wraps a plain array with conveniences for adding,
 * merging, sorting by source position, and rendering a consolidated diagnostic
 * string. It is useful for accumulating errors across multiple lexing passes or
 * multiple source files before reporting.
 */
export class LexerErrorCollection {
  private items: LexerError[];

  /**
   * Create a collection, optionally seeded with initial errors.
   *
   * @param initial - Initial errors to include in the collection.
   */
  constructor(initial?: readonly LexerError[]) {
    this.items = initial ? Array.from(initial) : [];
  }

  /**
   * The number of errors currently held in the collection.
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Whether the collection holds no errors.
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Append a single error to the collection.
   *
   * @param error - The error to add.
   * @returns `this` for method chaining.
   */
  add(error: LexerError): this {
    this.items.push(error);
    return this;
  }

  /**
   * Append many errors to the collection.
   *
   * @param errors - The errors to add.
   * @returns `this` for method chaining.
   */
  addAll(errors: readonly LexerError[]): this {
    for (const error of errors) {
      this.items.push(error);
    }
    return this;
  }

  /**
   * Remove all errors from the collection.
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Sort the contained errors by source position (line, then column).
   *
   * The sort is stable and mutates the collection in place.
   *
   * @returns `this` for method chaining.
   */
  sortByPosition(): this {
    this.items.sort((a, b) => a.line - b.line || a.column - b.column);
    return this;
  }

  /**
   * Merge another collection into this one.
   *
   * The input collection is not modified. When `sort` is `true`, the merged
   * result is sorted by position.
   *
   * @param other - The collection whose errors should be absorbed.
   * @param sort - When `true`, sort the merged collection by position.
   * @returns A new `LexerErrorCollection` containing both sets of errors.
   */
  merge(other: LexerErrorCollection, sort = true): LexerErrorCollection {
    const merged = new LexerErrorCollection(this.items);
    merged.addAll(other.items);
    if (sort) {
      merged.sortByPosition();
    }
    return merged;
  }

  /**
   * Return a defensive copy of the underlying error array.
   *
   * @returns A new array of the contained errors in current order.
   */
  toArray(): LexerError[] {
    return Array.from(this.items);
  }

  /**
   * Return all errors that share a particular {@link LexerErrorCode}.
   *
   * @param code - The error code to filter by.
   * @returns A new array containing only matching errors.
   */
  getErrorsByCode(code: LexerErrorCode): LexerError[] {
    return this.items.filter((error) => error.code === code);
  }

  /**
   * Render the whole collection as a single newline-delimited string.
   *
   * Each error is formatted with `formatLexerError`. An empty collection
   * produces an empty string.
   *
   * @returns The consolidated, human-readable diagnostic output.
   */
  toFormattedString(): string {
    return this.items.map((error) => formatLexerError(error)).join('\n');
  }
}

/**
 * An ordered, position-sortable collection of {@link LexerWarning}s.
 *
 * `LexerWarningCollection` mirrors {@link LexerErrorCollection} for warnings,
 * providing the same add, merge, sort, and formatting conveniences.
 */
export class LexerWarningCollection {
  private items: LexerWarning[];

  /**
   * Create a collection, optionally seeded with initial warnings.
   *
   * @param initial - Initial warnings to include in the collection.
   */
  constructor(initial?: readonly LexerWarning[]) {
    this.items = initial ? Array.from(initial) : [];
  }

  /**
   * The number of warnings currently held in the collection.
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Whether the collection holds no warnings.
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Append a single warning to the collection.
   *
   * @param warning - The warning to add.
   * @returns `this` for method chaining.
   */
  add(warning: LexerWarning): this {
    this.items.push(warning);
    return this;
  }

  /**
   * Append many warnings to the collection.
   *
   * @param warnings - The warnings to add.
   * @returns `this` for method chaining.
   */
  addAll(warnings: readonly LexerWarning[]): this {
    for (const warning of warnings) {
      this.items.push(warning);
    }
    return this;
  }

  /**
   * Remove all warnings from the collection.
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Sort the contained warnings by source position (line, then column).
   *
   * @returns `this` for method chaining.
   */
  sortByPosition(): this {
    this.items.sort((a, b) => a.line - b.line || a.column - b.column);
    return this;
  }

  /**
   * Merge another collection into this one.
   *
   * @param other - The collection whose warnings should be absorbed.
   * @param sort - When `true`, sort the merged collection by position.
   * @returns A new `LexerWarningCollection` containing both sets of warnings.
   */
  merge(other: LexerWarningCollection, sort = true): LexerWarningCollection {
    const merged = new LexerWarningCollection(this.items);
    merged.addAll(other.items);
    if (sort) {
      merged.sortByPosition();
    }
    return merged;
  }

  /**
   * Return a defensive copy of the underlying warning array.
   *
   * @returns A new array of the contained warnings in current order.
   */
  toArray(): LexerWarning[] {
    return Array.from(this.items);
  }

  /**
   * Return all warnings that share a particular {@link LexerWarningCode}.
   *
   * @param code - The warning code to filter by.
   * @returns A new array containing only matching warnings.
   */
  getWarningsByCode(code: LexerWarningCode): LexerWarning[] {
    return this.items.filter((warning) => warning.code === code);
  }

  /**
   * Render the whole collection as a single newline-delimited string.
   *
   * Each warning is formatted with `formatLexerWarning`. An empty collection
   * produces an empty string.
   *
   * @returns The consolidated, human-readable diagnostic output.
   */
  toFormattedString(): string {
    return this.items.map((warning) => formatLexerWarning(warning)).join('\n');
  }
}

// ============================================================================
// Combined diagnostics
// ============================================================================

/**
 * A combined view of errors and warnings produced during a lexing pass.
 *
 * Returned by {@link createDiagnosticsSummary}, it pairs the raw collections
 * with formatted output so reporters can pick either representation.
 */
export interface LexerDiagnostics {
  /** All errors collected during the pass. */
  errors: LexerError[];
  /** All warnings collected during the pass. */
  warnings: LexerWarning[];
  /** The number of errors. */
  errorCount: number;
  /** The number of warnings. */
  warningCount: number;
  /** Newline-delimited formatted errors and warnings, errors first. */
  formatted: string;
}

/**
 * Build a combined {@link LexerDiagnostics} object from error and warning lists.
 *
 * @param errors - The errors from a lexing pass.
 * @param warnings - The warnings from a lexing pass.
 * @returns A `LexerDiagnostics` object with counts and formatted output.
 */
export function createDiagnosticsSummary(
  errors: readonly LexerError[],
  warnings: readonly LexerWarning[]
): LexerDiagnostics {
  const formatted = [
    ...errors.map((error) => formatLexerError(error)),
    ...warnings.map((warning) => formatLexerWarning(warning)),
  ].join('\n');
  return {
    errors: Array.from(errors),
    warnings: Array.from(warnings),
    errorCount: errors.length,
    warningCount: warnings.length,
    formatted,
  };
}