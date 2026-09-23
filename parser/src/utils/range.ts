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

// ============================================================================
// Range Algebra
// ============================================================================

/**
 * Compute the intersection of two ranges.
 *
 * The intersection is the region shared by both ranges, formed from the later
 * start position and the earlier end position. Because offsets are compared
 * directly, an empty or zero-width intersection is never produced; disjoint
 * ranges yield `null`.
 *
 * @param a - The first range.
 * @param b - The second range.
 * @returns A range covering exactly the region common to both inputs, or
 * `null` if they do not overlap.
 *
 * @example
 * rangeIntersection(
 *   createRangeFromLines(1, 0, 3, 0),
 *   createRangeFromLines(2, 0, 4, 0)
 * );
 * // => range from (2, 0) to (3, 0)
 */
export function rangeIntersection(a: Range, b: Range): Range | null {
  if (!rangesOverlap(a, b)) {
    return null;
  }
  return {
    start: positionMax(a.start, b.start),
    end: positionMin(a.end, b.end),
  };
}

/**
 * Subtract range `b` from range `a`, returning the pieces of `a` not covered
 * by `b`.
 *
 * Since both inputs are contiguous ranges the result contains at most two
 * pieces: the left part of `a` before `b.start` (if any) and the right part of
 * `a` after `b.end` (if any). Disjoint ranges return `[a]` unchanged, and a
 * fully containing `b` returns an empty array.
 *
 * @param a - The range to subtract from.
 * @param b - The range to remove.
 * @returns An array of ranges making up `a` minus `b`.
 *
 * @example
 * rangeSubtract(
 *   createRangeFromLines(1, 0, 5, 0),
 *   createRangeFromLines(2, 0, 3, 0)
 * ).length; // => 2
 */
export function rangeSubtract(a: Range, b: Range): Range[] {
  if (!rangesOverlap(a, b)) {
    return [a];
  }
  const result: Range[] = [];
  if (positionBefore(a.start, b.start)) {
    result.push(createRange(a.start, positionMin(b.start, a.end)));
  }
  if (positionAfter(a.end, b.end)) {
    result.push(createRange(positionMax(b.end, a.start), a.end));
  }
  return result;
}

/**
 * Translate (shift) a range by deltas applied to every position.
 *
 * The same line, column, and offset deltas are added to both the start and the
 * end position. This is useful for rebasing a range after an insert/delete
 * operation or when relocating diagnostics within a transformed document.
 *
 * @param range - The range to translate.
 * @param dLine - The line delta (may be negative).
 * @param dCol - The column delta (may be negative).
 * @param dOffset - The offset delta (may be negative).
 * @returns A new range with both positions shifted by the deltas.
 *
 * @example
 * rangeTranslate(createRangeFromLines(2, 0, 2, 3), 1, 0, 10);
 * // => range from (3, 0) to (3, 3)
 */
export function rangeTranslate(
  range: Range,
  dLine: number,
  dCol: number,
  dOffset: number
): Range {
  return {
    start: positionTranslate(range.start, dLine, dCol, dOffset),
    end: positionTranslate(range.end, dLine, dCol, dOffset),
  };
}

/**
 * Check whether a position falls within a range (inclusive).
 *
 * This is an alias of {@link rangeContains} that emphasizes the argument order
 * for callers passing a range and a position. It is provided for readability
 * and API consistency with `rangeContainsRange`.
 *
 * @param range - The range to test against.
 * @param position - The position to test.
 * @returns `true` if `position` is not before the range start and not after
 * the range end.
 *
 * @example
 * rangeContainsPosition(
 *   createRangeFromLines(1, 0, 3, 0),
 *   createPosition(2, 5, 0)
 * ); // => true
 */
export function rangeContainsPosition(range: Range, position: Position): boolean {
  return rangeContains(range, position);
}

/**
 * Compute the smallest range that fully contains every range in `ranges`.
 *
 * The union is the minimal bounding box: the earliest start and the latest end
 * across all inputs. Overlapping, adjacent, and disjoint inputs are all
 * handled the same way.
 *
 * @param ranges - The ranges to union. Must contain at least one range.
 * @returns A single range spanning all inputs.
 * @throws {RangeError} If `ranges` is empty.
 *
 * @example
 * rangeUnion([
 *   createRangeFromLines(1, 0, 2, 0),
 *   createRangeFromLines(4, 0, 5, 0),
 * ]);
 * // => range from (1, 0) to (5, 0)
 */
export function rangeUnion(ranges: Range[]): Range {
  if (ranges.length === 0) {
    throw new RangeError('rangeUnion requires at least one range');
  }
  let start = ranges[0].start;
  let end = ranges[0].end;
  for (const range of ranges) {
    start = positionMin(start, range.start);
    end = positionMax(end, range.end);
  }
  return createRange(start, end);
}

/**
 * Compare two ranges for exact equality.
 *
 * Both the start and the end positions must be equal (line, column, and offset
 * all match) for the ranges to be considered equal.
 *
 * @param a - The first range.
 * @param b - The second range.
 * @returns `true` if both endpoints are positionally identical.
 *
 * @example
 * rangeEquals(
 *   createRangeFromLines(1, 0, 2, 0),
 *   createRangeFromLines(1, 0, 2, 0)
 * ); // => true
 */
export function rangeEquals(a: Range, b: Range): boolean {
  return positionEqual(a.start, b.start) && positionEqual(a.end, b.end);
}

// ============================================================================
// Range Measurement
// ============================================================================

/**
 * Measure the width of a range in columns.
 *
 * The width is the absolute difference between the end and start columns and
 * is independent of the offset values. For a range spanning multiple lines this
 * only reflects the column delta of the endpoints; see `rangeHeight` for the
 * line span.
 *
 * @param range - The range to measure.
 * @returns A non-negative column width.
 *
 * @example
 * rangeWidth(createRangeFromLines(1, 1, 1, 5)); // => 4
 */
export function rangeWidth(range: Range): number {
  return Math.abs(range.end.column - range.start.column);
}

/**
 * Measure the height of a range in lines.
 *
 * The height is the absolute difference between the end and start lines and is
 * independent of the offset values. A range confined to a single line has a
 * height of `0`.
 *
 * @param range - The range to measure.
 * @returns A non-negative line height.
 *
 * @example
 * rangeHeight(createRangeFromLines(1, 0, 4, 0)); // => 3
 */
export function rangeHeight(range: Range): number {
  return Math.abs(range.end.line - range.start.line);
}

// ============================================================================
// Position Helpers
// ============================================================================

/**
 * Compute the Manhattan distance between two positions.
 *
 * The distance is the sum of the absolute differences of their line and column
 * components. The offset fields are ignored for this computation since they
 * are redundant with line/column.
 *
 * @param a - The first position.
 * @param b - The second position.
 * @returns `|a.line - b.line| + |a.column - b.column|`.
 *
 * @example
 * positionDistance(
 *   createPosition(1, 0, 0),
 *   createPosition(3, 4, 99)
 * ); // => 6
 */
export function positionDistance(a: Position, b: Position): number {
  return Math.abs(a.line - b.line) + Math.abs(a.column - b.column);
}

/**
 * Translate (shift) a position by line, column, and offset deltas.
 *
 * All three deltas are added to the corresponding component of `pos`. This is
 * the per-position building block used by {@link rangeTranslate}.
 *
 * @param pos - The position to translate.
 * @param dLine - The line delta (may be negative).
 * @param dCol - The column delta (may be negative).
 * @param dOffset - The offset delta (may be negative).
 * @returns A new position shifted by the given deltas.
 *
 * @example
 * positionTranslate(createPosition(1, 2, 3), 1, -1, 10);
 * // => { line: 2, column: 1, offset: 13 }
 */
export function positionTranslate(
  pos: Position,
  dLine: number,
  dCol: number,
  dOffset: number
): Position {
  return createPosition(pos.line + dLine, pos.column + dCol, pos.offset + dOffset);
}

// ============================================================================
// Sorting and Merging
// ============================================================================

/**
 * Sort ranges by their start position.
 *
 * The input array is not mutated; a new array sorted by {@link rangeCompare}
 * (offset-first ordering) is returned. Equal-start ranges keep their relative
 * order because `Array.prototype.sort` is stable.
 *
 * @param ranges - The ranges to sort.
 * @returns A new array sorted by start position.
 *
 * @example
 * sortRanges([
 *   createRangeFromLines(3, 0, 3, 2),
 *   createRangeFromLines(1, 0, 1, 2),
 * ])[0].start.line; // => 1
 */
export function sortRanges(ranges: Range[]): Range[] {
  return [...ranges].sort(rangeCompare);
}

/**
 * Merge overlapping and adjacent ranges into a minimal set of disjoint ranges.
 *
 * Ranges are first sorted by start position, then folded: any range whose start
 * is not after the previous merged range's end is absorbed into it (extending
 * the end when necessary). Non-contiguous ranges are preserved as separate
 * entries. The input array is not mutated.
 *
 * @param ranges - The ranges to merge.
 * @returns A new array of merged, disjoint ranges in start order.
 *
 * @example
 * mergeAdjacentRanges([
 *   createRangeFromLines(1, 0, 1, 5),
 *   createRangeFromLines(1, 5, 2, 0),
 *   createRangeFromLines(5, 0, 5, 1),
 * ]).length; // => 2
 */
export function mergeAdjacentRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = sortRanges(ranges);
  const result: Range[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];
    if (positionCompare(current.start, last.end) <= 0) {
      if (positionAfter(current.end, last.end)) {
        result[result.length - 1] = createRange(last.start, current.end);
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

// ============================================================================
// Construction from Line/Column
// ============================================================================

/**
 * Build a fully-populated range from line/column coordinates and source text.
 *
 * Both offsets are computed by scanning `text` until the requested line/column
 * pair is reached, so the resulting range carries accurate offsets in addition
 * to line/column. If a coordinate exceeds the end of the text, the scan stops
 * at the end and the corresponding offset is `text.length`.
 *
 * @param text - The source text the coordinates refer to.
 * @param startLine - The 1-indexed start line.
 * @param startCol - The start column.
 * @param endLine - The 1-indexed end line.
 * @param endCol - The end column.
 * @returns A range with computed offsets.
 *
 * @example
 * rangeFromLineColumn('ab\ncd\nef', 2, 0, 3, 1);
 * // => start { line: 2, column: 0, offset: 3 }, end { line: 3, column: 1, offset: 6 }
 */
export function rangeFromLineColumn(
  text: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): Range {
  return createRange(
    createPosition(
      startLine,
      startCol,
      lineColumnToOffset(text, startLine, startCol)
    ),
    createPosition(endLine, endCol, lineColumnToOffset(text, endLine, endCol))
  );
}

function lineColumnToOffset(text: string, line: number, column: number): number {
  let currentLine = 1;
  let currentCol = 0;
  let offset = 0;
  while (offset < text.length) {
    if (currentLine === line && currentCol === column) {
      return offset;
    }
    if (text[offset] === '\n') {
      currentLine++;
      currentCol = 0;
    } else {
      currentCol++;
    }
    offset++;
  }
  return offset;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a range into a plain JSON-compatible object.
 *
 * The result is `{ start: { line, column, offset }, end: { line, column, offset } }`
 * and can be round-tripped through {@link rangeFromJSON}.
 *
 * @param range - The range to serialize.
 * @returns A plain JSON-safe representation of the range.
 *
 * @example
 * rangeToJSON(createRangeFromLines(1, 0, 1, 2));
 * // => {
 * //      start: { line: 1, column: 0, offset: 0 },
 * //      end: { line: 1, column: 2, offset: 0 },
 * //    }
 */
export function rangeToJSON(range: Range): {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
} {
  return {
    start: {
      line: range.start.line,
      column: range.start.column,
      offset: range.start.offset,
    },
    end: {
      line: range.end.line,
      column: range.end.column,
      offset: range.end.offset,
    },
  };
}

/**
 * Parse a range from a JSON value.
 *
 * Accepts the output of {@link rangeToJSON} (`{ start, end }` with `line`,
 * `column`, and `offset` on each bound) as well as array-tuple bounds such as
 * `{ start: [line, col, offset], end: [line, col, offset] }`. Numeric-looking
 * values are coerced with `Number()`.
 *
 * @param json - The value to parse.
 * @returns A new `Range`.
 * @throws {TypeError} If the value is malformed.
 *
 * @example
 * rangeFromJSON({ start: [1, 0, 0], end: { line: 2, column: 3, offset: 5 } });
 * // => range from (1, 0) to (2, 3)
 */
export function rangeFromJSON(json: unknown): Range {
  if (typeof json !== 'object' || json === null) {
    throw new TypeError('Invalid range JSON: expected an object');
  }
  const obj = json as Record<string, unknown>;
  return createRange(parsePosition(obj.start, 'start'), parsePosition(obj.end, 'end'));
}

function parsePosition(value: unknown, name: string): Position {
  if (Array.isArray(value)) {
    return createPosition(Number(value[0]), Number(value[1]), Number(value[2]));
  }
  if (typeof value === 'object' && value !== null) {
    const pos = value as Record<string, unknown>;
    const line = typeof pos.line === 'number' ? pos.line : Number(pos.line);
    const column = typeof pos.column === 'number' ? pos.column : Number(pos.column);
    const offset = typeof pos.offset === 'number' ? pos.offset : Number(pos.offset);
    if (Number.isNaN(line) || Number.isNaN(column) || Number.isNaN(offset)) {
      throw new TypeError(`Invalid range JSON: non-numeric ${name} position`);
    }
    return createPosition(line, column, offset);
  }
  throw new TypeError(`Invalid range JSON: missing ${name} position`);
}

/**
 * Create a range from two linear offsets.
 *
 * Because offsets alone do not encode line/column information, the resulting
 * range uses placeholder line/column values (`line: 1`, `column` equal to the
 * offset) while keeping the authoritative offsets intact. Callers that need
 * accurate line/column should use {@link rangeFromLineColumn} or a text-aware
 * conversion instead.
 *
 * @param startOffset - The zero-based offset of the range start.
 * @param endOffset - The zero-based offset of the range end.
 * @returns A range carrying the two offsets with placeholder line/column.
 *
 * @example
 * rangeFromOffsets(10, 20);
 * // => start { line: 1, column: 10, offset: 10 }, end { line: 1, column: 20, offset: 20 }
 */
export function rangeFromOffsets(startOffset: number, endOffset: number): Range {
  return createRange(
    createPosition(1, startOffset, startOffset),
    createPosition(1, endOffset, endOffset)
  );
}

// ============================================================================
// Human-Readable Descriptions
// ============================================================================

/**
 * Produce a concise human-readable description of a range.
 *
 * The description adapts to the shape of the range: zero-width ranges are
 * described as a single position, single-line ranges mention column spans, and
 * multi-line ranges mention both. Offsets are included so the description is
 * useful for both editing tools and end-user-facing messages.
 *
 * @param range - The range to describe.
 * @returns A natural-language description string.
 *
 * @example
 * describeRange(createRangeFromLines(3, 0, 3, 0));
 * // => 'at line 3, column 0 (offset 0)'
 * describeRange(createRangeFromLines(3, 0, 4, 2));
 * // => 'lines 3-4, columns 0-2 (offsets 0-0)'
 */
export function describeRange(range: Range): string {
  if (rangeIsEmpty(range)) {
    return `at line ${range.start.line}, column ${range.start.column} (offset ${range.start.offset})`;
  }
  if (range.start.line === range.end.line) {
    return `line ${range.start.line}, columns ${range.start.column}-${range.end.column} (offsets ${range.start.offset}-${range.end.offset})`;
  }
  return `lines ${range.start.line}-${range.end.line}, columns ${range.start.column}-${range.end.column} (offsets ${range.start.offset}-${range.end.offset})`;
}
