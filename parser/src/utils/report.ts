/**
 * MAM Diagnostic Utilities
 *
 * Structured diagnostics for reporting parser and tooling issues. Provides a
 * lightweight `Diagnostic` shape, formatting helpers, severity ordering, and a
 * `DiagnosticCollection` for accumulating and sorting issues.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Severity levels for diagnostics, ordered from least to most severe.
 */
export type DiagnosticSeverity = 'debug' | 'info' | 'warning' | 'error';

/**
 * A single structured diagnostic message.
 */
export interface Diagnostic {
  /** The human-readable message describing the issue. */
  message: string;
  /** The source document or file the diagnostic refers to. */
  source?: string;
  /** The 1-indexed line the diagnostic points at. */
  line?: number;
  /** The column the diagnostic points at. */
  column?: number;
  /** A stable machine-readable code identifying the diagnostic kind. */
  code?: string;
  /** The severity level; defaults to `'error'` when formatted. */
  severity?: DiagnosticSeverity;
}

// ============================================================================
// Construction
// ============================================================================

/**
 * Create a diagnostic from a message and optional metadata.
 *
 * A convenience factory that keeps the required `message` field distinct from
 * the optional fields, reducing boilerplate when building diagnostics inline.
 *
 * @param message - The diagnostic message.
 * @param options - Optional metadata (source, line, column, code, severity).
 * @returns A fully-formed `Diagnostic`.
 *
 * @example
 * createDiagnostic('Missing section', { code: 'E100', severity: 'warning' });
 */
export function createDiagnostic(
  message: string,
  options?: Omit<Diagnostic, 'message'>
): Diagnostic {
  return { message, ...options };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a single diagnostic as a human-readable string.
 *
 * The format is `source:line:column [code] severity: message`, omitting any
 * component that is not present. When `severity` is undefined it is assumed to
 * be `'error'`.
 *
 * @param diagnostic - The diagnostic to format.
 * @returns A single formatted line.
 *
 * @example
 * formatDiagnostic({ message: 'boom', source: 'a.mam', line: 2, code: 'E1' });
 * // => 'a.mam:2 [E1] error: boom'
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const parts: string[] = [];
  const location: string[] = [];
  if (diagnostic.source !== undefined) {
    location.push(diagnostic.source);
  }
  if (diagnostic.line !== undefined) {
    location.push(String(diagnostic.line));
  }
  if (diagnostic.column !== undefined) {
    location.push(String(diagnostic.column));
  }
  if (location.length > 0) {
    parts.push(location.join(':'));
  }
  if (diagnostic.code !== undefined) {
    parts.push(`[${diagnostic.code}]`);
  }
  parts.push(`${diagnostic.severity ?? 'error'}: ${diagnostic.message}`);
  return parts.join(' ');
}

/**
 * Format a list of diagnostics, one per line.
 *
 * @param diagnostics - The diagnostics to format.
 * @returns A newline-joined string of formatted diagnostics.
 *
 * @example
 * formatDiagnostics([
 *   createDiagnostic('a', { code: 'E1' }),
 *   createDiagnostic('b', { severity: 'info' }),
 * ]);
 * // => '[E1] error: a\ninfo: b'
 */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n');
}

// ============================================================================
// Severity Ordering
// ============================================================================

/**
 * Compare two severities by how severe they are.
 *
 * Returns a negative number when `a` is more severe than `b`, `0` when they
 * are equal, and a positive number when `a` is less severe. Useful as a
 * comparator for `Array.prototype.sort`.
 *
 * @param a - The first severity.
 * @param b - The second severity.
 * @returns A numeric ordering indicator.
 *
 * @example
 * severityCompare('error', 'info');   // => negative (error is more severe)
 * severityCompare('info', 'warning'); // => positive (info is less severe)
 */
export function severityCompare(a: DiagnosticSeverity, b: DiagnosticSeverity): number {
  const rank: Record<DiagnosticSeverity, number> = {
    error: 4,
    warning: 3,
    info: 2,
    debug: 1,
  };
  return rank[b] - rank[a];
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Remove duplicate diagnostics from a list.
 *
 * Two diagnostics are considered duplicates when their message, source, line,
 * column, code, and severity all match. The first occurrence of each unique
 * diagnostic is kept, preserving original order.
 *
 * @param diagnostics - The list to deduplicate.
 * @returns A new array without duplicates.
 *
 * @example
 * dedupeDiagnostics([
 *   createDiagnostic('x', { line: 1 }),
 *   createDiagnostic('x', { line: 1 }),
 *   createDiagnostic('y', { line: 1 }),
 * ]).length; // => 2
 */
export function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.message,
      diagnostic.source ?? '',
      diagnostic.line ?? '',
      diagnostic.column ?? '',
      diagnostic.code ?? '',
      diagnostic.severity ?? '',
    ].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(diagnostic);
    }
  }
  return result;
}

// ============================================================================
// Collection
// ============================================================================

/**
 * An ordered, mutable collection of diagnostics with formatting and filtering
 * helpers.
 *
 * Diagnostics accumulate in insertion order until {@link sort} is called, at
 * which point they are ordered by position (source, then line, then column)
 * with errors ranked first among equal positions.
 */
export class DiagnosticCollection {
  private _diagnostics: Diagnostic[];

  /**
   * @param initial - Optional diagnostics to seed the collection with.
   */
  constructor(initial: Diagnostic[] = []) {
    this._diagnostics = [...initial];
  }

  /**
   * Add a single diagnostic to the collection.
   *
   * @param diagnostic - The diagnostic to add.
   * @returns `this` for chaining.
   */
  add(diagnostic: Diagnostic): this {
    this._diagnostics.push(diagnostic);
    return this;
  }

  /**
   * Add multiple diagnostics to the collection.
   *
   * @param diagnostics - The diagnostics to add.
   * @returns `this` for chaining.
   */
  addAll(diagnostics: Diagnostic[]): this {
    for (const diagnostic of diagnostics) {
      this.add(diagnostic);
    }
    return this;
  }

  /**
   * Remove all diagnostics from the collection.
   */
  clear(): void {
    this._diagnostics = [];
  }

  /**
   * Sort the collection by position, then by severity (most severe first).
   *
   * Diagnostics without a position sort after positioned ones. The in-memory
   * ordering of the collection is modified in place.
   *
   * @returns `this` for chaining.
   */
  sort(): this {
    this._diagnostics.sort((a, b) => {
      const bySource = compareOptional(a.source, b.source);
      if (bySource !== 0) return bySource;
      const byLine = (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
      if (byLine !== 0) return byLine;
      const byColumn =
        (a.column ?? Number.MAX_SAFE_INTEGER) - (b.column ?? Number.MAX_SAFE_INTEGER);
      if (byColumn !== 0) return byColumn;
      const bySeverity = severityCompare(
        a.severity ?? 'error',
        b.severity ?? 'error'
      );
      if (bySeverity !== 0) return bySeverity;
      return compareOptional(a.message, b.message);
    });
    return this;
  }

  /**
   * Return the diagnostics whose severity equals `severity`.
   *
   * Diagnostics with an undefined severity are treated as `'error'`.
   *
   * @param severity - The severity to filter by.
   * @returns A new array of matching diagnostics.
   */
  filterBySeverity(severity: DiagnosticSeverity): Diagnostic[] {
    return this._diagnostics.filter((d) => (d.severity ?? 'error') === severity);
  }

  /**
   * Format every diagnostic in the collection, one per line.
   *
   * @returns The formatted output, or `''` when empty.
   */
  formatAll(): string {
    return formatDiagnostics(this._diagnostics);
  }

  /**
   * Return a shallow copy of the diagnostics as a plain array.
   *
   * @returns A copy of the internal array.
   */
  toArray(): Diagnostic[] {
    return [...this._diagnostics];
  }

  /**
   * The number of diagnostics currently in the collection.
   */
  get count(): number {
    return this._diagnostics.length;
  }

  /**
   * Alias of {@link count} for array-like ergonomics.
   */
  get size(): number {
    return this._diagnostics.length;
  }

  /**
   * Check whether the collection contains at least one error-severity
   * diagnostic.
   *
   * @returns `true` if any diagnostic has severity `'error'` (or is unset).
   */
  hasErrors(): boolean {
    return this._diagnostics.some((d) => (d.severity ?? 'error') === 'error');
  }

  /**
   * Iterate over the diagnostics in insertion (or sorted) order.
   */
  [Symbol.iterator](): Iterator<Diagnostic> {
    return this._diagnostics[Symbol.iterator]();
  }
}

function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}