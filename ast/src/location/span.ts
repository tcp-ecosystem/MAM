/**
 * MAM Source Span Utilities
 *
 * Comprehensive span manipulation: creation, containment checks, merging,
 * overlap detection, length calculation, splitting, and offset/position conversion.
 */

// ============================================================================
// Types
// ============================================================================

export interface SourceSpan {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SpanOptions {
  /** Lines are 1-indexed by default. Set false for 0-indexed. */
  oneIndexed?: boolean;
}

// ============================================================================
// Creation
// ============================================================================

/**
 * Create a SourceSpan from line/column values.
 */
export function createSpan(
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): SourceSpan {
  return {
    start: { line: startLine, column: startCol },
    end: { line: endLine, column: endCol },
  };
}

/**
 * Create a SourceSpan from a SourceLocation-like object.
 */
export function spanFromLocation(loc: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): SourceSpan {
  return {
    start: { line: loc.start.line, column: loc.start.column },
    end: { line: loc.end.line, column: loc.end.column },
  };
}

/**
 * Create a single-line span at a given position.
 */
export function spanAt(line: number, column: number, length: number = 1): SourceSpan {
  return {
    start: { line, column },
    end: { line, column: column + length },
  };
}

// ============================================================================
// Containment Checks
// ============================================================================

/**
 * Check if a span contains a given line and column.
 */
export function spanContains(span: SourceSpan, line: number, column: number): boolean {
  if (line < span.start.line || line > span.end.line) return false;
  if (line === span.start.line && column < span.start.column) return false;
  if (line === span.end.line && column > span.end.column) return false;
  return true;
}

/**
 * Check if a span contains a given line (anywhere on that line).
 */
export function spanContainsLine(span: SourceSpan, line: number): boolean {
  return line >= span.start.line && line <= span.end.line;
}

// ============================================================================
// Overlap Detection
// ============================================================================

/**
 * Check if two spans overlap.
 */
export function spanOverlap(a: SourceSpan, b: SourceSpan): boolean {
  if (a.end.line < b.start.line) return false;
  if (a.start.line > b.end.line) return false;

  if (a.end.line === b.start.line && a.end.column < b.start.column) return false;
  if (a.start.line === b.end.line && a.start.column > b.end.column) return false;

  return true;
}

// ============================================================================
// Merging
// ============================================================================

/**
 * Merge two spans into a single span that covers both.
 */
export function spanMerge(a: SourceSpan, b: SourceSpan): SourceSpan {
  const startLine = Math.min(a.start.line, b.start.line);
  const startCol = startLine === a.start.line
    ? Math.min(a.start.column, b.start.column)
    : b.start.column;

  const endLine = Math.max(a.end.line, b.end.line);
  const endCol = endLine === a.end.line
    ? Math.max(a.end.column, b.end.column)
    : b.end.column;

  return {
    start: { line: startLine, column: startCol },
    end: { line: endLine, column: endCol },
  };
}

// ============================================================================
// Length / Distance
// ============================================================================

/**
 * Calculate the number of lines spanned.
 */
export function spanLineCount(span: SourceSpan): number {
  return span.end.line - span.start.line + 1;
}

/**
 * Calculate the length of a span in characters (approximate).
 * Uses column difference for single-line spans.
 */
export function spanLength(span: SourceSpan): number {
  if (span.start.line === span.end.line) {
    return span.end.column - span.start.column;
  }
  // Multi-line: approximate with line count
  return (span.end.line - span.start.line) * 80 + (span.end.column - span.start.column);
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare two spans for sorting. Returns negative if a < b, 0 if equal, positive if a > b.
 * Orders by start line, then start column, then end line, then end column.
 */
export function spanCompare(a: SourceSpan, b: SourceSpan): number {
  if (a.start.line !== b.start.line) return a.start.line - b.start.line;
  if (a.start.column !== b.start.column) return a.start.column - b.start.column;
  if (a.end.line !== b.end.line) return a.end.line - b.end.line;
  return a.end.column - b.end.column;
}

/**
 * Check if two spans are equal (same start and end).
 */
export function spanEquals(a: SourceSpan, b: SourceSpan): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.column === b.start.column &&
    a.end.line === b.end.line &&
    a.end.column === b.end.column
  );
}

// ============================================================================
// Transformation
// ============================================================================

/**
 * Split a span into two at a given position.
 * Returns [before, after].
 */
export function splitSpanAt(
  span: SourceSpan,
  position: SourcePosition,
): [SourceSpan, SourceSpan] | null {
  if (!spanContains(span, position.line, position.column)) return null;
  if (position.line === span.start.line && position.column === span.start.column) return null;
  if (position.line === span.end.line && position.column === span.end.column) return null;

  const before: SourceSpan = {
    start: { ...span.start },
    end: { line: position.line, column: position.column },
  };

  const after: SourceSpan = {
    start: { line: position.line, column: position.column },
    end: { ...span.end },
  };

  return [before, after];
}

/**
 * Offset a span by a given line and column delta.
 */
export function spanOffset(
  span: SourceSpan,
  lineDelta: number,
  columnDelta: number,
): SourceSpan {
  return {
    start: {
      line: span.start.line + lineDelta,
      column: span.start.column + columnDelta,
    },
    end: {
      line: span.end.line + lineDelta,
      column: span.end.column + columnDelta,
    },
  };
}

// ============================================================================
// Offset / Position Conversion
// ============================================================================

/**
 * Convert a linear character offset to a line:column position.
 */
export function offsetToPosition(text: string, offset: number): SourcePosition {
  if (offset <= 0) return { line: 1, column: 0 };
  if (offset >= text.length) {
    const lastNewline = text.lastIndexOf('\n');
    const lastLine = text.substring(lastNewline + 1);
    return { line: text.split('\n').length, column: lastLine.length };
  }

  let line = 1;
  let col = 0;

  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }

  return { line, column: col };
}

/**
 * Convert a line:column position to a linear character offset.
 */
export function positionToOffset(text: string, pos: SourcePosition): number {
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < pos.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  const targetLine = lines[pos.line - 1];
  if (targetLine) {
    offset += Math.min(pos.column, targetLine.length);
  }

  return offset;
}

// ============================================================================
// String Output
// ============================================================================

/**
 * Format a span as a human-readable string.
 */
export function spanToString(span: SourceSpan): string {
  return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}

/**
 * Format a span as a range string (start line - end line).
 */
export function spanToLineRange(span: SourceSpan): string {
  if (span.start.line === span.end.line) return `line ${span.start.line}`;
  return `lines ${span.start.line}-${span.end.line}`;
}

export function isValidSpan(span: SourceSpan): boolean {
  if (!Number.isFinite(span.start.line) || !Number.isFinite(span.start.column)) return false;
  if (!Number.isFinite(span.end.line) || !Number.isFinite(span.end.column)) return false;
  if (span.start.line < 1 || span.end.line < 1) return false;
  if (span.start.column < 0 || span.end.column < 0) return false;
  if (span.start.line > span.end.line) return false;
  if (span.start.line === span.end.line && span.start.column > span.end.column) return false;
  return true;
}

export function spanContainsSpan(outer: SourceSpan, inner: SourceSpan): boolean {
  return (
    spanContains(outer, inner.start.line, inner.start.column) &&
    spanContains(outer, inner.end.line, inner.end.column)
  );
}

export function spanIntersection(a: SourceSpan, b: SourceSpan): SourceSpan | null {
  const start = pointMax(a.start, b.start);
  const end = pointMin(a.end, b.end);
  if (start.line > end.line || (start.line === end.line && start.column > end.column)) {
    return null;
  }
  return {
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

export function spanGrow(span: SourceSpan, lineDelta: number, columnDelta: number = 0): SourceSpan {
  return {
    start: {
      line: Math.max(1, span.start.line - lineDelta),
      column: Math.max(0, span.start.column - columnDelta),
    },
    end: {
      line: span.end.line + lineDelta,
      column: Math.max(0, span.end.column + columnDelta),
    },
  };
}

export function spanIsBefore(a: SourceSpan, b: SourceSpan): boolean {
  if (a.end.line !== b.start.line) return a.end.line < b.start.line;
  return a.end.column < b.start.column;
}

export function sortSpans(spans: SourceSpan[]): SourceSpan[] {
  return [...spans].sort(spanCompare);
}

export function spanFromOffsets(text: string, start: number, end: number): SourceSpan {
  const from = Math.max(0, Math.min(Math.min(start, end), text.length));
  const to = Math.max(0, Math.min(Math.max(start, end), text.length));
  return {
    start: offsetToPosition(text, from),
    end: offsetToPosition(text, to),
  };
}

function pointMax(p: SourcePosition, q: SourcePosition): SourcePosition {
  if (q.line > p.line || (q.line === p.line && q.column > p.column)) return q;
  return p;
}

function pointMin(p: SourcePosition, q: SourcePosition): SourcePosition {
  if (q.line < p.line || (q.line === p.line && q.column < p.column)) return q;
  return p;
}
