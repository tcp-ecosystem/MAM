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

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Determine whether an arbitrary value is a {@link ParseError} instance.
 *
 * This guard is intentionally narrow: it performs a runtime `instanceof` check
 * against the local {@link ParseError} class, so values that merely *look* like
 * parse errors (for example, plain objects decoded from JSON) are rejected.
 * Use {@link parseErrorFromJSON} to revive a serialized error into a real
 * instance before passing it here.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a {@link ParseError}.
 *
 * @example
 * ```ts
 * const errors: unknown[] = collectErrors();
 * const real = errors.filter(isParseError);
 * ```
 */
export function isParseError(value: unknown): value is ParseError {
  return value instanceof ParseError;
}

/**
 * Determine whether an arbitrary value is a {@link ParseWarning} instance.
 *
 * As with {@link isParseError}, this uses a runtime `instanceof` check so that
 * structurally similar plain objects are not mistaken for warnings.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a {@link ParseWarning}.
 */
export function isParseWarning(value: unknown): value is ParseWarning {
  return value instanceof ParseWarning;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Render a {@link ParseError} as a single, human-readable diagnostic string.
 *
 * This is a convenience wrapper around {@link ParseError.toFormattedString}
 * that is useful when the error is known to be a `ParseError` and a standalone
 * function reads better at the call site (for example inside `Array.map`).
 *
 * @param error - The parse error to format.
 * @returns A multi-line diagnostic string beginning with the source position.
 */
export function formatParseError(error: ParseError): string {
  return error.toFormattedString();
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a {@link ParseError} with a fully specified diagnostic payload.
 *
 * This factory mirrors the {@link ParseError} constructor but centralizes the
 * defaults for the optional arguments, which makes it convenient to build
 * errors in bulk without repeating the default code and severity.
 *
 * @param message - The human-readable description of the failure.
 * @param source - The name of the source document the error belongs to.
 * @param line - One-based line number where the failure occurred.
 * @param column - Zero-based column number where the failure occurred.
 * @param code - The machine-readable error code. Defaults to
 *   {@link ParseErrorCode.UNEXPECTED_TOKEN}.
 * @param severity - Whether the diagnostic is an `'error'` or a `'warning'`.
 *   Defaults to `'error'`.
 * @param expected - Optional list of token or construct descriptions that were
 *   expected at the failure position.
 * @param found - Optional description of what was actually found.
 * @param context - Optional snippet of surrounding source text.
 * @returns A new {@link ParseError} instance.
 */
export function createParseError(
  message: string,
  source: string,
  line: number,
  column: number,
  code: ParseErrorCode = ParseErrorCode.UNEXPECTED_TOKEN,
  severity: 'error' | 'warning' = 'error',
  expected?: string[],
  found?: string,
  context?: string
): ParseError {
  return new ParseError(message, source, line, column, code, severity, expected, found, context);
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * The plain-object representation of a {@link ParseError}.
 *
 * Instances of this interface are produced by {@link parseErrorToJSON} and
 * consumed by {@link parseErrorFromJSON}. Every field maps one-to-one onto the
 * corresponding {@link ParseError} property, with the optional fields omitted
 * when they are `undefined`.
 */
export interface SerializedParseError {
  /** The name of the error class, always `'ParseError'`. */
  name: string;
  /** The human-readable error message. */
  message: string;
  /** The source document the error belongs to. */
  source: string;
  /** One-based line number of the failure. */
  line: number;
  /** Zero-based column number of the failure. */
  column: number;
  /** The machine-readable {@link ParseErrorCode}. */
  code: ParseErrorCode;
  /** Whether the diagnostic is an `'error'` or a `'warning'`. */
  severity: 'error' | 'warning';
  /** The expected constructs, when recorded. */
  expected?: string[];
  /** A description of what was found, when recorded. */
  found?: string;
  /** A snippet of surrounding source text, when recorded. */
  context?: string;
}

/**
 * Serialize a {@link ParseError} into a plain JSON-compatible object.
 *
 * The resulting object can be passed to `JSON.stringify` and later revived
 * with {@link parseErrorFromJSON}. Optional fields are omitted rather than
 * emitted as `undefined` so the serialized form stays compact.
 *
 * @param error - The parse error to serialize.
 * @returns A {@link SerializedParseError} suitable for JSON encoding.
 */
export function parseErrorToJSON(error: ParseError): SerializedParseError {
  const json: SerializedParseError = {
    name: error.name,
    message: error.message,
    source: error.source,
    line: error.line,
    column: error.column,
    code: error.code,
    severity: error.severity,
  };
  if (error.expected !== undefined) {
    json.expected = [...error.expected];
  }
  if (error.found !== undefined) {
    json.found = error.found;
  }
  if (error.context !== undefined) {
    json.context = error.context;
  }
  return json;
}

/**
 * Revive a {@link ParseError} from its serialized representation.
 *
 * The input may be either a {@link SerializedParseError} object or the JSON
 * string produced by `JSON.stringify(parseErrorToJSON(error))`. Missing
 * optional fields are tolerated, and a missing `code` or `severity` falls back
 * to the same defaults used by the {@link ParseError} constructor.
 *
 * @param json - The serialized error, either as an object or a JSON string.
 * @returns A reconstructed {@link ParseError} instance.
 * @throws {SyntaxError} When `json` is a string that is not valid JSON.
 */
export function parseErrorFromJSON(json: SerializedParseError | string): ParseError {
  const data: SerializedParseError =
    typeof json === 'string' ? (JSON.parse(json) as SerializedParseError) : json;
  return new ParseError(
    data.message,
    data.source,
    data.line,
    data.column,
    data.code ?? ParseErrorCode.UNEXPECTED_TOKEN,
    data.severity ?? 'error',
    data.expected,
    data.found,
    data.context
  );
}

// ============================================================================
// Code descriptions
// ============================================================================

/**
 * Return a human-readable description for a {@link ParseErrorCode}.
 *
 * The description explains what the code means in the MAM grammar and is
 * suitable for documentation, tooltips, and diagnostic summaries. Every member
 * of the enum has a dedicated description.
 *
 * @param code - The error code to describe.
 * @returns A sentence describing the condition the code represents.
 */
export function describeParseErrorCode(code: ParseErrorCode): string {
  switch (code) {
    case ParseErrorCode.UNEXPECTED_TOKEN:
      return 'A token appeared that is not valid in the current grammar position.';
    case ParseErrorCode.EXPECTED_FRONTMATTER:
      return 'The document was expected to open with a YAML front matter block.';
    case ParseErrorCode.EXPECTED_HEADING:
      return 'A heading was required at this position but was not found.';
    case ParseErrorCode.EXPECTED_SECTION_NAME:
      return 'A section heading was found without a usable section name.';
    case ParseErrorCode.EXPECTED_CODE_FENCE:
      return 'A fenced code block was required but no opening fence was found.';
    case ParseErrorCode.EXPECTED_LIST_ITEM:
      return 'A list item was required but the line is not a valid list marker.';
    case ParseErrorCode.EXPECTED_TABLE:
      return 'A table was required but the content is not shaped like a table.';
    case ParseErrorCode.UNTERMINATED_CODE_BLOCK:
      return 'A fenced code block was opened but never closed before the end of input.';
    case ParseErrorCode.UNTERMINATED_FRONTMATTER:
      return 'A front matter block was opened but never closed before the end of input.';
    case ParseErrorCode.UNTERMINATED_LIST:
      return 'A list was started but could not be completed cleanly.';
    case ParseErrorCode.UNTERMINATED_TABLE:
      return 'A table was started but no terminating separator or row was found.';
    case ParseErrorCode.INVALID_YAML:
      return 'The YAML front matter could not be parsed because it is malformed.';
    case ParseErrorCode.DUPLICATE_SECTION:
      return 'The same section appears more than once in the document.';
    case ParseErrorCode.MISSING_REQUIRED_SECTION:
      return 'A section that the grammar requires is absent from the document.';
    case ParseErrorCode.INVALID_SECTION_ORDER:
      return 'Sections appear in an order that violates the MAM conventions.';
    case ParseErrorCode.MAX_DEPTH_EXCEEDED:
      return 'Nesting grew deeper than the parser is configured to allow.';
    case ParseErrorCode.INVALID_NESTING:
      return 'A nested construct appears in a position where nesting is not allowed.';
    case ParseErrorCode.MISSING_CLOSING_FENCE:
      return 'A fenced block is missing its matching closing fence.';
    case ParseErrorCode.INVALID_TABLE_SYNTAX:
      return 'A table row has a malformed pipe or separator structure.';
    case ParseErrorCode.INVALID_HEADING_LEVEL:
      return 'A heading uses a level outside the supported range of one to six.';
    default:
      return 'An unrecognized parse error code.';
  }
}

/**
 * Return a human-readable description for a {@link ParseWarningCode}.
 *
 * The description explains the non-fatal condition the warning represents.
 * Every member of the enum has a dedicated description.
 *
 * @param code - The warning code to describe.
 * @returns A sentence describing the condition the code represents.
 */
export function describeParseWarningCode(code: ParseWarningCode): string {
  switch (code) {
    case ParseWarningCode.DEPRECATED_SYNTAX:
      return 'The document uses syntax that is still accepted but discouraged.';
    case ParseWarningCode.INCONSISTENT_HEADING_LEVEL:
      return 'Heading levels skip or repeat in a way that may break the outline.';
    case ParseWarningCode.EMPTY_SECTION:
      return 'A section contains a heading but no content.';
    case ParseWarningCode.UNKNOWN_SECTION:
      return 'A section name is not one of the standard MAM section names.';
    case ParseWarningCode.SECTION_ORDER:
      return 'A section is present but appears out of the recommended order.';
    case ParseWarningCode.MISSING_CONTENT:
      return 'Expected content is missing from a section or block.';
    case ParseWarningCode.DUPLICATE_HEADING:
      return 'Two headings share the same text, which may cause ambiguity.';
    default:
      return 'An unrecognized parse warning code.';
  }
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * An aggregate summary of a collection of {@link ParseError} values.
 *
 * Produced by {@link summarizeParseErrors}, this object lets callers gauge the
 * health of a parse without iterating the error array themselves.
 */
export interface ParseErrorSummary {
  /** The total number of errors in the collection. */
  total: number;
  /** Tally of errors grouped by {@link ParseErrorCode}. */
  byCode: Record<string, number>;
  /** Tally of errors grouped by severity. */
  bySeverity: { error: number; warning: number };
}

/**
 * Count errors by their {@link ParseErrorCode}.
 *
 * Only codes that actually occur are present as keys in the returned record,
 * so callers can iterate the entries directly without filtering zero counts.
 *
 * @param errors - The errors to tally.
 * @returns A record mapping each encountered code to its occurrence count.
 */
export function countErrorsByCode(errors: readonly ParseError[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const error of errors) {
    counts[error.code] = (counts[error.code] ?? 0) + 1;
  }
  return counts;
}

/**
 * Summarize a collection of {@link ParseError} values.
 *
 * The summary reports the total count, a tally by {@link ParseErrorCode}, and
 * a tally by severity. It is useful for producing dashboards, log footers, and
 * quick pass/fail diagnostics.
 *
 * @param errors - The errors to summarize.
 * @returns A {@link ParseErrorSummary} describing the collection.
 */
export function summarizeParseErrors(errors: readonly ParseError[]): ParseErrorSummary {
  const bySeverity: { error: number; warning: number } = { error: 0, warning: 0 };
  for (const error of errors) {
    if (error.severity === 'error') {
      bySeverity.error += 1;
    } else {
      bySeverity.warning += 1;
    }
  }
  return {
    total: errors.length,
    byCode: countErrorsByCode(errors),
    bySeverity,
  };
}

/**
 * Return the most severe level present in a collection of parse errors.
 *
 * A single error with `'error'` severity outranks any number of warnings, so
 * the result is `'error'` whenever at least one error is present, `'warning'`
 * when only warnings are present, and `null` for an empty collection.
 *
 * @param errors - The errors to inspect.
 * @returns `'error'`, `'warning'`, or `null` when the collection is empty.
 */
export function highestSeverity(errors: readonly ParseError[]): 'error' | 'warning' | null {
  let highest: 'error' | 'warning' | null = null;
  for (const error of errors) {
    if (error.severity === 'error') {
      return 'error';
    }
    highest = 'warning';
  }
  return highest;
}

/**
 * Determine whether a collection contains any fatal (`'error'`) diagnostics.
 *
 * Warnings do not count as fatal, so a collection made up entirely of warnings
 * returns `false`.
 *
 * @param errors - The errors to inspect.
 * @returns `true` when at least one diagnostic has `'error'` severity.
 */
export function hasFatalErrors(errors: readonly ParseError[]): boolean {
  return errors.some((error) => error.severity === 'error');
}

// ============================================================================
// Collections
// ============================================================================

/**
 * An ordered, mutable collection of {@link ParseError} values.
 *
 * The collection is a thin convenience wrapper around an array that adds
 * bulk operations, formatting, position sorting, severity filtering, and
 * merging. Methods that add errors return `this` so calls can be chained.
 *
 * @example
 * ```ts
 * const collection = new ParseErrorCollection()
 *   .add(createParseError('boom', 'file.mam', 3, 7))
 *   .addAll(moreErrors);
 * console.log(collection.toFormattedString());
 * ```
 */
export class ParseErrorCollection {
  private readonly items: ParseError[] = [];

  /**
   * Append a single error to the collection.
   *
   * @param error - The error to append.
   * @returns This collection, for chaining.
   */
  add(error: ParseError): this {
    this.items.push(error);
    return this;
  }

  /**
   * Append every error from an iterable to the collection.
   *
   * @param errors - The errors to append.
   * @returns This collection, for chaining.
   */
  addAll(errors: Iterable<ParseError>): this {
    for (const error of errors) {
      this.items.push(error);
    }
    return this;
  }

  /**
   * Remove every error from the collection.
   *
   * @returns This collection, for chaining.
   */
  clear(): this {
    this.items.length = 0;
    return this;
  }

  /**
   * The number of errors currently held by the collection.
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Return a shallow copy of the underlying errors as a plain array.
   *
   * @returns A new array containing the collection's errors.
   */
  toArray(): ParseError[] {
    return [...this.items];
  }

  /**
   * Count the errors in the collection.
   *
   * @returns The number of errors.
   */
  count(): number {
    return this.items.length;
  }

  /**
   * Render every error as a formatted, newline-separated string.
   *
   * @param separator - The string placed between formatted errors. Defaults to
   *   a single newline.
   * @returns The concatenated formatted diagnostics.
   */
  toFormattedString(separator = '\n'): string {
    return this.items.map((error) => error.toFormattedString()).join(separator);
  }

  /**
   * Combine this collection with another collection or array of errors.
   *
   * The current collection is left untouched; a new collection containing the
   * errors from both sources is returned.
   *
   * @param other - A collection or array whose errors should be appended.
   * @returns A new collection containing the merged errors.
   */
  merge(other: ParseErrorCollection | readonly ParseError[]): ParseErrorCollection {
    const merged = new ParseErrorCollection();
    merged.addAll(this.items);
    const otherItems = other instanceof ParseErrorCollection ? other.toArray() : other;
    merged.addAll(otherItems);
    return merged;
  }

  /**
   * Return the errors sorted by source position.
   *
   * Sorting is by line first and column second, producing a stable reading
   * order that matches how a developer scans a document. The collection itself
   * is not mutated.
   *
   * @returns A new array of errors in source order.
   */
  sortByPosition(): ParseError[] {
    return [...this.items].sort((a, b) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.column - b.column;
    });
  }

  /**
   * Return the errors whose severity matches the requested level.
   *
   * @param severity - Either `'error'` or `'warning'`.
   * @returns A new array containing only matching errors.
   */
  filterBySeverity(severity: 'error' | 'warning'): ParseError[] {
    return this.items.filter((error) => error.severity === severity);
  }

  /**
   * Return the errors whose code matches the requested value.
   *
   * @param code - The {@link ParseErrorCode} to filter by.
   * @returns A new array containing only matching errors.
   */
  filterByCode(code: ParseErrorCode): ParseError[] {
    return this.items.filter((error) => error.code === code);
  }

  /**
   * Produce a summary of the errors currently in the collection.
   *
   * @returns A {@link ParseErrorSummary} for the collection contents.
   */
  summarize(): ParseErrorSummary {
    return summarizeParseErrors(this.items);
  }
}

/**
 * An ordered, mutable collection of {@link ParseWarning} values.
 *
 * This mirrors {@link ParseErrorCollection} but is specialized for warnings,
 * which carry a {@link ParseWarningCode} and no severity field. Adding methods
 * return `this` so calls can be chained.
 */
export class ParseWarningCollection {
  private readonly items: ParseWarning[] = [];

  /**
   * Append a single warning to the collection.
   *
   * @param warning - The warning to append.
   * @returns This collection, for chaining.
   */
  add(warning: ParseWarning): this {
    this.items.push(warning);
    return this;
  }

  /**
   * Append every warning from an iterable to the collection.
   *
   * @param warnings - The warnings to append.
   * @returns This collection, for chaining.
   */
  addAll(warnings: Iterable<ParseWarning>): this {
    for (const warning of warnings) {
      this.items.push(warning);
    }
    return this;
  }

  /**
   * Remove every warning from the collection.
   *
   * @returns This collection, for chaining.
   */
  clear(): this {
    this.items.length = 0;
    return this;
  }

  /**
   * The number of warnings currently held by the collection.
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Return a shallow copy of the underlying warnings as a plain array.
   *
   * @returns A new array containing the collection's warnings.
   */
  toArray(): ParseWarning[] {
    return [...this.items];
  }

  /**
   * Count the warnings in the collection.
   *
   * @returns The number of warnings.
   */
  count(): number {
    return this.items.length;
  }

  /**
   * Render every warning as a formatted, newline-separated string.
   *
   * @param separator - The string placed between formatted warnings. Defaults
   *   to a single newline.
   * @returns The concatenated formatted diagnostics.
   */
  toFormattedString(separator = '\n'): string {
    return this.items.map((warning) => warning.toFormattedString()).join(separator);
  }

  /**
   * Combine this collection with another collection or array of warnings.
   *
   * The current collection is left untouched; a new collection containing the
   * warnings from both sources is returned.
   *
   * @param other - A collection or array whose warnings should be appended.
   * @returns A new collection containing the merged warnings.
   */
  merge(other: ParseWarningCollection | readonly ParseWarning[]): ParseWarningCollection {
    const merged = new ParseWarningCollection();
    merged.addAll(this.items);
    const otherItems = other instanceof ParseWarningCollection ? other.toArray() : other;
    merged.addAll(otherItems);
    return merged;
  }

  /**
   * Return the warnings sorted by source position.
   *
   * Sorting is by line first and column second. The collection itself is not
   * mutated.
   *
   * @returns A new array of warnings in source order.
   */
  sortByPosition(): ParseWarning[] {
    return [...this.items].sort((a, b) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.column - b.column;
    });
  }

  /**
   * Return the warnings whose code matches the requested value.
   *
   * @param code - The {@link ParseWarningCode} to filter by.
   * @returns A new array containing only matching warnings.
   */
  filterByCode(code: ParseWarningCode): ParseWarning[] {
    return this.items.filter((warning) => warning.code === code);
  }

  /**
   * Count warnings by their {@link ParseWarningCode}.
   *
   * @returns A record mapping each encountered code to its occurrence count.
   */
  countByCode(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const warning of this.items) {
      counts[warning.code] = (counts[warning.code] ?? 0) + 1;
    }
    return counts;
  }
}