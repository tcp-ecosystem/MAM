/**
 * MAM Source Positions
 *
 * Utilities for representing and manipulating positions within a source
 * document. A `LexerPosition` records both the one-based line and the
 * zero-based column and offset of a point in the input so that diagnostics can
 * reference exact locations.
 *
 * These helpers are pure and allocation-light where possible; they are used by
 * the tokenizer and by lexer tooling that needs to convert between offset and
 * line/column coordinates.
 */

/**
 * A position within a source document.
 *
 * Line numbers are one-based; column numbers and character offsets are
 * zero-based. The `offset` is the absolute character index into the source
 * string, which is independent of line and column bookkeeping.
 */
export interface LexerPosition {
  /** One-based line number within the document. */
  line: number;
  /** Zero-based column number within the line. */
  column: number;
  /** Zero-based absolute character offset into the document. */
  offset: number;
}

/**
 * Create a {@link LexerPosition} from explicit coordinates.
 *
 * All values are clamped to non-negative numbers; the line is additionally
 * clamped to at least `1` so that a position always refers to a real line.
 *
 * @param line - One-based line number.
 * @param column - Zero-based column number.
 * @param offset - Zero-based character offset.
 * @returns A fully initialized `LexerPosition`.
 */
export function createPosition(line: number, column: number, offset: number): LexerPosition {
  const safeLine = Math.max(1, Math.floor(line));
  const safeColumn = Math.max(0, Math.floor(column));
  const safeOffset = Math.max(0, Math.floor(offset));
  return { line: safeLine, column: safeColumn, offset: safeOffset };
}

/**
 * Advance a position by a single character.
 *
 * When the character is a line feed, the position moves to the start of the
 * next line (column resets to `0`, offset increments by one). Otherwise the
 * column and offset both advance by one. A carriage return is treated as a
 * column advance only; callers handling CRLF sequences should normalize line
 * endings before scanning.
 *
 * @param position - The position to advance.
 * @param char - The character that was consumed.
 * @returns A new `LexerPosition` one character further into the document.
 */
export function advancePosition(position: LexerPosition, char: string): LexerPosition {
  if (char === '\n') {
    return { line: position.line + 1, column: 0, offset: position.offset + 1 };
  }
  return { line: position.line, column: position.column + 1, offset: position.offset + 1 };
}

/**
 * Move a position to the start of the following line.
 *
 * This is useful when consuming a multi-character line terminator such as
 * `\r\n`: the caller advances past the `\r` with {@link advancePosition} and
 * then calls this helper for the `\n`.
 *
 * @param position - The position to advance.
 * @returns A new `LexerPosition` on the next line with column `0` and an
 *   offset advanced by one.
 */
export function advanceLine(position: LexerPosition): LexerPosition {
  return { line: position.line + 1, column: 0, offset: position.offset + 1 };
}

/**
 * Convert an absolute character offset into a line/column position.
 *
 * The scan is performed by counting line terminators (`\n`) before the given
 * offset. When `offset` points exactly at a line terminator, the resulting
 * position is on the following line at column `0`.
 *
 * @param source - The source text the offset refers to.
 * @param offset - Zero-based character offset into `source`.
 * @returns A {@link LexerPosition} with the matching line and column. Offsets
 *   beyond the end of the source are clamped to the end of the document.
 */
export function offsetToLineColumn(source: string, offset: number): LexerPosition {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 0;
  for (let i = 0; i < safeOffset; i++) {
    if (source.charCodeAt(i) === 0x0a) {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column, offset: safeOffset };
}

/**
 * Compute the absolute character offset of a given line and column.
 *
 * The line is one-based and the column is zero-based. When `line` exceeds the
 * number of lines in the source, the offset of the end of the document is
 * returned. When `column` exceeds the length of the line, the offset is
 * clamped to the end of that line.
 *
 * @param source - The source text to search within.
 * @param line - One-based line number.
 * @param column - Zero-based column number.
 * @returns The zero-based character offset matching the requested position.
 */
export function lineColumnToOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (offset < source.length && currentLine < line) {
    if (source.charCodeAt(offset) === 0x0a) {
      currentLine++;
    }
    offset++;
  }
  if (currentLine < line) {
    return source.length;
  }
  const lineStart = offset;
  while (offset < source.length && source.charCodeAt(offset) !== 0x0a) {
    offset++;
  }
  return Math.min(lineStart + Math.max(0, column), offset);
}

/**
 * Compute the distance between two positions.
 *
 * The distance is the absolute difference in character offsets when both
 * offsets are available and comparable. When they are not, the distance falls
 * back to a weighted combination of line and column differences.
 *
 * @param from - The starting position.
 * @param to - The ending position.
 * @returns A non-negative integer representing the positional distance.
 */
export function positionDistance(from: LexerPosition, to: LexerPosition): number {
  const offsetDelta = Math.abs(to.offset - from.offset);
  const lineDelta = Math.abs(to.line - from.line);
  const columnDelta = Math.abs(to.column - from.column);
  if (offsetDelta > 0) {
    return offsetDelta;
  }
  return lineDelta + columnDelta;
}

/**
 * Compare two positions for ordering.
 *
 * @param a - The first position.
 * @param b - The second position.
 * @returns A negative number when `a` precedes `b`, a positive number when
 *   `a` follows `b`, and `0` when the positions are equivalent.
 */
export function comparePositions(a: LexerPosition, b: LexerPosition): number {
  return a.line - b.line || a.column - b.column || a.offset - b.offset;
}

/**
 * Check whether two positions refer to the same point in the document.
 *
 * Equality is based on the absolute offset when both offsets are available;
 * otherwise line and column are compared.
 *
 * @param a - The first position.
 * @param b - The second position.
 * @returns `true` when both positions describe the same location.
 */
export function positionsEqual(a: LexerPosition, b: LexerPosition): boolean {
  return a.offset === b.offset && a.line === b.line && a.column === b.column;
}

/**
 * The position of the very start of a document: line `1`, column `0`,
 * offset `0`.
 */
export const START_POSITION: LexerPosition = { line: 1, column: 0, offset: 0 };

/**
 * Return a human-readable rendering of a {@link LexerPosition}.
 *
 * @param position - The position to render.
 * @returns A string shaped like `line:column` (for example `"12:4"`).
 */
export function formatPosition(position: LexerPosition): string {
  return `${position.line}:${position.column}`;
}

/**
 * Validate whether a value looks like a {@link LexerPosition}.
 *
 * The check is structural and accepts plain objects with numeric `line`,
 * `column`, and `offset` fields.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a well-formed `LexerPosition`.
 */
export function isLexerPosition(value: unknown): value is LexerPosition {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<LexerPosition>;
  return (
    typeof candidate.line === 'number' &&
    typeof candidate.column === 'number' &&
    typeof candidate.offset === 'number'
  );
}

/**
 * An inclusive span between two {@link LexerPosition}s.
 *
 * A span is useful for reporting diagnostics that cover a range of source
 * text rather than a single point.
 */
export interface LexerSpan {
  /** The position at which the span begins. */
  start: LexerPosition;
  /** The position at which the span ends (exclusive). */
  end: LexerPosition;
}

/**
 * Create a {@link LexerSpan} from two positions.
 *
 * The returned span is normalized so that `start` always precedes or equals
 * `end`.
 *
 * @param start - The beginning of the span.
 * @param end - The end of the span.
 * @returns A normalized `LexerSpan`.
 */
export function createSpan(start: LexerPosition, end: LexerPosition): LexerSpan {
  if (comparePositions(end, start) < 0) {
    return { start: end, end: start };
  }
  return { start, end };
}

/**
 * Return the number of lines covered by a {@link LexerSpan}.
 *
 * @param span - The span to measure.
 * @returns The difference between the span's end and start line numbers,
 *   plus one (a single-point span covers one line).
 */
export function spanLineCount(span: LexerSpan): number {
  return Math.max(1, span.end.line - span.start.line + 1);
}

/**
 * Return a human-readable rendering of a {@link LexerSpan}.
 *
 * @param span - The span to render.
 * @returns A string shaped like `startLine:startColumn-endLine:endColumn`.
 */
export function formatSpan(span: LexerSpan): string {
  return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}