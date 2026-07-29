/**
 * MAM Range Utilities
 *
 * Provides range-based position tracking for MAM documents.
 * Supports creation, comparison, merging, clipping, and string
 * representation of ranges and positions.
 */

// ============================================================================
// Types
// ============================================================================

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Position object from line, column, and offset.
 */
export function createPosition(line: number, column: number, offset: number): Position {
  return { line, column, offset };
}

/**
 * Create a Range from two Position objects.
 */
export function createRange(start: Position, end: Position): Range {
  return { start, end };
}

/**
 * Create a Range from raw line/column numbers (offsets default to 0).
 */
export function createRangeFromLines(
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): Range {
  return {
    start: createPosition(startLine, startCol, 0),
    end: createPosition(endLine, endCol, 0),
  };
}

// ============================================================================
// Position Comparison
// ============================================================================

/**
 * Check if position `a` is strictly before position `b`.
 */
export function positionBefore(a: Position, b: Position): boolean {
  return a.offset < b.offset;
}

/**
 * Check if position `a` is strictly after position `b`.
 */
export function positionAfter(a: Position, b: Position): boolean {
  return a.offset > b.offset;
}

/**
 * Check if two positions are equal.
 */
export function positionEqual(a: Position, b: Position): boolean {
  return a.offset === b.offset && a.line === b.line && a.column === b.column;
}

/**
 * Compare two positions for sorting. Returns negative if a < b, 0 if equal,
 * positive if a > b.
 */
export function positionCompare(a: Position, b: Position): number {
  if (a.offset !== b.offset) return a.offset - b.offset;
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

/**
 * Return the earlier of two positions.
 */
export function positionMin(a: Position, b: Position): Position {
  return positionBefore(a, b) ? a : b;
}

/**
 * Return the later of two positions.
 */
export function positionMax(a: Position, b: Position): Position {
  return positionAfter(a, b) ? a : b;
}

// ============================================================================
// Range Operations
// ============================================================================

/**
 * Check if a position falls within a range (inclusive).
 */
export function rangeContains(range: Range, position: Position): boolean {
  return !positionBefore(position, range.start) && !positionAfter(position, range.end);
}

/**
 * Check if a range fully contains another range.
 */
export function rangeContainsRange(outer: Range, inner: Range): boolean {
  return !positionBefore(inner.start, outer.start) && !positionAfter(inner.end, outer.end);
}

/**
 * Check if two ranges overlap.
 */
export function rangesOverlap(a: Range, b: Range): boolean {
  return !positionBefore(a.end, b.start) && !positionBefore(b.end, a.start);
}

/**
 * Merge two ranges into the smallest encompassing range.
 */
export function rangeMerge(a: Range, b: Range): Range {
  return {
    start: positionMin(a.start, b.start),
    end: positionMax(a.end, b.end),
  };
}

/**
 * Compare two ranges for sorting (by start position).
 */
export function rangeCompare(a: Range, b: Range): number {
  return positionCompare(a.start, b.start);
}

/**
 * Get the string representation of a position.
 */
export function positionToString(position: Position): string {
  return `${position.line}:${position.column}:${position.offset}`;
}

/**
 * Get the string representation of a range.
 */
export function rangeToString(range: Range): string {
  return `${positionToString(range.start)}-${positionToString(range.end)}`;
}

/**
 * Calculate the character length of a range (end offset - start offset).
 */
export function rangeLength(range: Range): number {
  return range.end.offset - range.start.offset;
}

/**
 * Expand a range by N lines on each side. Lines are clamped to >= 1.
 */
export function expandRange(range: Range, lines: number): Range {
  return {
    start: createPosition(
      Math.max(1, range.start.line - lines),
      0,
      Math.max(0, range.start.offset - lines * 80)
    ),
    end: createPosition(
      range.end.line + lines,
      range.end.column,
      range.end.offset + lines * 80
    ),
  };
}

/**
 * Clip `range` so it does not extend outside `container`.
 */
export function clipRange(range: Range, container: Range): Range {
  return {
    start: positionMax(range.start, container.start),
    end: positionMin(range.end, container.end),
  };
}

/**
 * Check if a range is empty (start equals end).
 */
export function rangeIsEmpty(range: Range): boolean {
  return positionEqual(range.start, range.end);
}

/**
 * Create a zero-width range at a single position.
 */
export function positionToRange(position: Position): Range {
  return { start: position, end: position };
}
