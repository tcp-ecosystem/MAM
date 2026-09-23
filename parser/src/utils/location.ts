/**
 * MAM Source Location Utilities
 *
 * Provides utilities for tracking and manipulating source locations
 * in MAM documents. Supports conversion between Range, SourceLocation,
 * SourceSpan, and linear offsets.
 */

// ============================================================================
// Types
// ============================================================================

export interface SourceLocation {
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a SourceLocation from line and column.
 */
export function createLocation(line: number, column: number): SourceLocation {
  return { line, column };
}

/**
 * Create a SourceSpan from two SourceLocation objects.
 */
export function createSpan(start: SourceLocation, end: SourceLocation): SourceSpan {
  return { start, end };
}

// ============================================================================
// Location Comparison
// ============================================================================

/**
 * Check if location `a` is strictly before `b`.
 */
export function locationBefore(a: SourceLocation, b: SourceLocation): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

/**
 * Check if location `a` is strictly after `b`.
 */
export function locationAfter(a: SourceLocation, b: SourceLocation): boolean {
  return a.line > b.line || (a.line === b.line && a.column > b.column);
}

/**
 * Check if two locations are equal.
 */
export function locationEqual(a: SourceLocation, b: SourceLocation): boolean {
  return a.line === b.line && a.column === b.column;
}

/**
 * Compare two locations for sorting. Returns negative if a < b, 0 if equal,
 * positive if a > b.
 */
export function locationCompare(a: SourceLocation, b: SourceLocation): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

// ============================================================================
// Span Operations
// ============================================================================

/**
 * Check if a span contains a location (inclusive).
 */
export function spanContains(span: SourceSpan, location: SourceLocation): boolean {
  return !locationBefore(location, span.start) && !locationAfter(location, span.end);
}

/**
 * Check if two spans overlap.
 */
export function spansOverlap(a: SourceSpan, b: SourceSpan): boolean {
  return !locationBefore(a.end, b.start) && !locationBefore(b.end, a.start);
}

/**
 * Merge two spans into the smallest encompassing span.
 */
export function spanMerge(a: SourceSpan, b: SourceSpan): SourceSpan {
  return {
    start: locationBefore(a.start, b.start) ? a.start : b.start,
    end: locationAfter(a.end, b.end) ? a.end : b.end,
  };
}

// ============================================================================
// String Representations
// ============================================================================

/**
 * Get the string representation of a location.
 */
export function locationToString(location: SourceLocation): string {
  return `${location.line}:${location.column}`;
}

/**
 * Get the string representation of a span.
 */
export function spanToString(span: SourceSpan): string {
  return `${locationToString(span.start)}-${locationToString(span.end)}`;
}

// ============================================================================
// Range ↔ Location Conversion
// ============================================================================

import type { Range } from './range.js';

/**
 * Convert a Range (with offset) to a SourceLocation.
 */
export function rangeToLocation(range: Range): SourceLocation {
  return createLocation(range.start.line, range.start.column);
}

/**
 * Convert a Range (with offset) to a SourceSpan.
 */
export function rangeToSpan(range: Range): SourceSpan {
  return createSpan(
    createLocation(range.start.line, range.start.column),
    createLocation(range.end.line, range.end.column)
  );
}

/**
 * Convert a SourceLocation back to a minimal Range (offsets = 0).
 */
export function locationToRange(loc: SourceLocation): Range {
  return {
    start: { line: loc.line, column: loc.column, offset: 0 },
    end: { line: loc.line, column: loc.column, offset: 0 },
  };
}

/**
 * Convert a SourceSpan back to a Range (offsets = 0).
 */
export function spanToRange(span: SourceSpan): Range {
  return {
    start: { line: span.start.line, column: span.start.column, offset: 0 },
    end: { line: span.end.line, column: span.end.column, offset: 0 },
  };
}

// ============================================================================
// Offset Conversion
// ============================================================================

/**
 * Get the line and column for a linear offset in text.
 */
export function getLineColumn(text: string, offset: number): SourceLocation {
  let line = 1;
  let column = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return createLocation(line, column);
}

/**
 * Convert a linear offset to a full SourceLocation (with offset field).
 */
export function offsetToLocation(
  text: string,
  offset: number
): SourceLocation & { offset: number } {
  const loc = getLineColumn(text, offset);
  return { line: loc.line, column: loc.column, offset };
}

/**
 * Convert a SourceLocation to a linear offset in text.
 */
export function locationToOffset(text: string, loc: SourceLocation): number {
  let offset = 0;
  let line = 1;
  let column = 0;

  for (let i = 0; i < text.length; i++) {
    if (line === loc.line && column === loc.column) {
      return offset;
    }
    if (text[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
    offset++;
  }

  return offset;
}

/**
 * Get the start and end offsets of a line (1-indexed).
 * Returns { start, end } where end is the offset of the newline or EOF.
 */
export function getLineRange(
  text: string,
  line: number
): { start: number; end: number } | null {
  let currentLine = 1;
  let start = 0;

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      if (currentLine === line) {
        return { start, end: i };
      }
      currentLine++;
      start = i + 1;
    }
  }

  return null;
}

/**
 * Extract text at a SourceLocation range from the source string.
 */
export function extractText(text: string, span: SourceSpan): string {
  const startOffset = locationToOffset(text, span.start);
  const endOffset = locationToOffset(text, span.end);
  return text.slice(startOffset, endOffset);
}

// ============================================================================
// Location Distance, Clamping, and Translation
// ============================================================================

/**
 * Compute the Manhattan distance between two source locations.
 *
 * The Manhattan distance is the sum of the absolute differences of their
 * line and column components. It is useful for ranking how "far apart" two
 * locations are for diagnostics, ordering heuristics, or similarity checks
 * without allocating or traversing the source text.
 *
 * @param a - The first source location.
 * @param b - The second source location.
 * @returns The sum `|a.line - b.line| + |a.column - b.column|`. Always non-negative.
 *
 * @example
 * locationDistance({ line: 1, column: 0 }, { line: 3, column: 4 }); // => 6
 */
export function locationDistance(a: SourceLocation, b: SourceLocation): number {
  return Math.abs(a.line - b.line) + Math.abs(a.column - b.column);
}

/**
 * Clamp a source location so that both of its components fall between the
 * components of `min` and `max`.
 *
 * Both line and column are clamped independently using
 * `Math.min`/`Math.max`. If `min` and `max` are inverted (e.g. `min.line`
 * greater than `max.line`) the result follows the supplied bounds and is
 * undefined in the mathematical sense; callers should pass well-formed bounds.
 *
 * @param loc - The location to clamp.
 * @param min - The lower bound for each component.
 * @param max - The upper bound for each component.
 * @returns A new `SourceLocation` whose `line` is within `[min.line, max.line]`
 * and whose `column` is within `[min.column, max.column]`.
 *
 * @example
 * locationClamp({ line: 0, column: 99 }, { line: 1, column: 0 }, { line: 10, column: 20 });
 * // => { line: 1, column: 20 }
 */
export function locationClamp(
  loc: SourceLocation,
  min: SourceLocation,
  max: SourceLocation
): SourceLocation {
  return {
    line: Math.min(Math.max(loc.line, min.line), max.line),
    column: Math.min(Math.max(loc.column, min.column), max.column),
  };
}

/**
 * Translate (shift) a source location by a line and column delta.
 *
 * The deltas may be negative, positive, or zero. No clamping is performed;
 * callers are responsible for ensuring the translated location remains within
 * the source document.
 *
 * @param loc - The location to translate.
 * @param dLine - The number of lines to shift (may be negative).
 * @param dCol - The number of columns to shift (may be negative).
 * @returns A new `SourceLocation` at `(loc.line + dLine, loc.column + dCol)`.
 *
 * @example
 * locationTranslate({ line: 2, column: 5 }, 1, -2); // => { line: 3, column: 3 }
 */
export function locationTranslate(
  loc: SourceLocation,
  dLine: number,
  dCol: number
): SourceLocation {
  return createLocation(loc.line + dLine, loc.column + dCol);
}

// ============================================================================
// Span Measurement and Algebra
// ============================================================================

/**
 * Estimate the number of characters covered by a span.
 *
 * Because a `SourceSpan` carries only line/column information (no offsets and
 * no source text), the length is computed as the Manhattan distance between
 * its endpoints: every crossed line boundary contributes 1 (a newline) and the
 * final column delta contributes the remaining characters. This treats any
 * intermediate lines as empty and is therefore a lower-bound estimate; for an
 * exact character count use the text-aware helpers in this module.
 *
 * @param span - The span to measure.
 * @returns A non-negative integer approximating the character length.
 *
 * @example
 * spanLengthChars({ start: { line: 1, column: 0 }, end: { line: 3, column: 4 } }); // => 6
 */
export function spanLengthChars(span: SourceSpan): number {
  const s = normalizeSpan(span);
  return Math.abs(s.end.line - s.start.line) + Math.abs(s.end.column - s.start.column);
}

/**
 * Check whether a span is empty, i.e. its start equals its end.
 *
 * An empty span has zero length and typically represents a cursor or insertion
 * point rather than a selection.
 *
 * @param span - The span to test.
 * @returns `true` if the start and end locations are equal, otherwise `false`.
 *
 * @example
 * spanIsEmpty({ start: { line: 1, column: 2 }, end: { line: 1, column: 2 } }); // => true
 */
export function spanIsEmpty(span: SourceSpan): boolean {
  return locationEqual(span.start, span.end);
}

/**
 * Check whether the outer span fully contains the inner span.
 *
 * Containment is inclusive at both boundaries: an inner span equal to the outer
 * span is considered contained.
 *
 * @param outer - The span that should contain `inner`.
 * @param inner - The span that should be contained by `outer`.
 * @returns `true` if `inner.start` is not before `outer.start` and `inner.end`
 * is not after `outer.end`.
 *
 * @example
 * const outer = { start: { line: 1, column: 0 }, end: { line: 5, column: 10 } };
 * const inner = { start: { line: 2, column: 1 }, end: { line: 3, column: 8 } };
 * spanContainsSpan(outer, inner); // => true
 */
export function spanContainsSpan(outer: SourceSpan, inner: SourceSpan): boolean {
  return (
    !locationBefore(inner.start, outer.start) && !locationAfter(inner.end, outer.end)
  );
}

/**
 * Compute the intersection of two spans.
 *
 * The intersection is the region shared by both spans, formed from the later
 * start and the earlier end. If the spans do not overlap, `null` is returned.
 *
 * @param a - The first span.
 * @param b - The second span.
 * @returns A span covering exactly the region common to both inputs, or `null`
 * if they are disjoint.
 *
 * @example
 * spanIntersection(
 *   { start: { line: 1, column: 0 }, end: { line: 3, column: 0 } },
 *   { start: { line: 2, column: 0 }, end: { line: 4, column: 0 } }
 * );
 * // => { start: { line: 2, column: 0 }, end: { line: 3, column: 0 } }
 */
export function spanIntersection(a: SourceSpan, b: SourceSpan): SourceSpan | null {
  if (!spansOverlap(a, b)) {
    return null;
  }
  return {
    start: locationBefore(a.start, b.start) ? b.start : a.start,
    end: locationAfter(a.end, b.end) ? b.end : a.end,
  };
}

/**
 * Subtract span `b` from span `a`, returning the pieces of `a` not covered by
 * `b`.
 *
 * Because both inputs are contiguous spans, the result contains at most two
 * pieces: the left part of `a` before `b.start` (if any) and the right part of
 * `a` after `b.end` (if any). When the spans do not overlap, the original span
 * `a` is returned unchanged as a single-element array.
 *
 * @param a - The span to subtract from.
 * @param b - The span to remove.
 * @returns An array of spans making up `a` minus `b`. May be empty only when
 * `b` fully covers `a`.
 *
 * @example
 * spanSubtract(
 *   { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } },
 *   { start: { line: 2, column: 0 }, end: { line: 3, column: 0 } }
 * );
 * // => [
 * //      { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
 * //      { start: { line: 3, column: 0 }, end: { line: 5, column: 0 } },
 * //    ]
 */
export function spanSubtract(a: SourceSpan, b: SourceSpan): SourceSpan[] {
  if (!spansOverlap(a, b)) {
    return [a];
  }
  const result: SourceSpan[] = [];
  if (locationBefore(a.start, b.start)) {
    result.push({ start: a.start, end: b.start });
  }
  if (locationAfter(a.end, b.end)) {
    result.push({ start: b.end, end: a.end });
  }
  return result;
}

// ============================================================================
// Offset Helpers
// ============================================================================

/**
 * Resolve a linear character offset in `text` to a `SourceLocation`.
 *
 * This is an alias of {@link offsetToLocation} provided for callers who prefer
 * an offset-first naming convention. The returned object carries the `offset`
 * itself alongside the computed `line`/`column` so the result can be used as a
 * full position without an extra lookup.
 *
 * @param text - The source text the offset refers to.
 * @param offset - The zero-based character offset into `text`.
 * @returns A `SourceLocation` extended with an `offset` property.
 *
 * @example
 * locationFromOffset('a\nbc', 3); // => { line: 2, column: 1, offset: 3 }
 */
export function locationFromOffset(
  text: string,
  offset: number
): SourceLocation & { offset: number } {
  return offsetToLocation(text, offset);
}

/**
 * Build a `SourceSpan` from two linear character offsets into `text`.
 *
 * Both offsets are resolved to line/column pairs using {@link getLineColumn}
 * and wrapped into a span. The resulting span carries no offset information;
 * use `rangeToSpan`/`spanToRange` if you need offset-preserving conversions.
 *
 * @param text - The source text the offsets refer to.
 * @param startOffset - The zero-based offset of the span start.
 * @param endOffset - The zero-based offset of the span end.
 * @returns A span from the location of `startOffset` to the location of
 * `endOffset`.
 *
 * @example
 * offsetToSpan('ab\ncd', 1, 4); // => { start: { line: 1, column: 1 }, end: { line: 2, column: 1 } }
 */
export function offsetToSpan(
  text: string,
  startOffset: number,
  endOffset: number
): SourceSpan {
  return createSpan(getLineColumn(text, startOffset), getLineColumn(text, endOffset));
}

// ============================================================================
// Line Inspection
// ============================================================================

/**
 * Get the text of a single line without its trailing newline.
 *
 * Lines are 1-indexed to match `getLineColumn`. The returned string excludes
 * the terminating `\n` character (or the EOF position for the final line).
 *
 * @param text - The source text to inspect.
 * @param line - The 1-indexed line number to extract.
 * @returns The content of that line, or `null` if `line` is out of range
 * (less than 1 or greater than the number of lines in `text`).
 *
 * @example
 * getLineText('one\ntwo\nthree', 2); // => 'two'
 * getLineText('one', 5);             // => null
 */
export function getLineText(text: string, line: number): string | null {
  const range = getLineRange(text, line);
  if (range === null) {
    return null;
  }
  return text.slice(range.start, range.end);
}

/**
 * Count the number of lines in a piece of text.
 *
 * A trailing newline does not begin a new (empty) line, and the empty string
 * contains zero lines. This is consistent with `getLineRange`/`getLineColumn`
 * which treat lines as 1-indexed newline-terminated segments.
 *
 * @param text - The text to count lines in.
 * @returns The number of lines, which is 0 for the empty string.
 *
 * @example
 * countLines('');        // => 0
 * countLines('hello');   // => 1
 * countLines('a\nb\n');  // => 2
 */
export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines++;
    }
  }
  if (text[text.length - 1] === '\n') {
    lines--;
  }
  return lines;
}

/**
 * Count the number of columns (characters) in a single line.
 *
 * Lines are 1-indexed. The count is the length of the line's text as returned
 * by {@link getLineText}, i.e. excluding the trailing newline. For an out of
 * range line number `0` is returned.
 *
 * @param text - The source text to inspect.
 * @param line - The 1-indexed line number.
 * @returns The number of characters in that line, or `0` if the line does not
 * exist.
 *
 * @example
 * countColumns('one\ntwo\nthree', 2); // => 3
 * countColumns('one\ntwo', 99);       // => 0
 */
export function countColumns(text: string, line: number): number {
  const lineText = getLineText(text, line);
  return lineText === null ? 0 : lineText.length;
}

// ============================================================================
// JSON Serialization
// ============================================================================

/**
 * Serialize a `SourceLocation` into a plain JSON-compatible object.
 *
 * The result is a stable, stringify-safe shape `{ line, column }` that can be
 * round-tripped through {@link locationFromJSON}.
 *
 * @param loc - The location to serialize.
 * @returns A plain object with numeric `line` and `column` fields.
 *
 * @example
 * locationToJSON({ line: 3, column: 7 }); // => { line: 3, column: 7 }
 */
export function locationToJSON(loc: SourceLocation): { line: number; column: number } {
  return { line: loc.line, column: loc.column };
}

/**
 * Serialize a `SourceSpan` into a plain JSON-compatible object.
 *
 * The result is `{ start: { line, column }, end: { line, column } }` and can be
 * round-tripped through {@link spanFromJSON}.
 *
 * @param span - The span to serialize.
 * @returns A plain JSON-safe representation of the span.
 *
 * @example
 * spanToJSON({
 *   start: { line: 1, column: 0 },
 *   end: { line: 1, column: 4 },
 * }); // => { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } }
 */
export function spanToJSON(span: SourceSpan): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  return { start: locationToJSON(span.start), end: locationToJSON(span.end) };
}

/**
 * Parse a `SourceLocation` from a JSON value.
 *
 * Accepts either the output of {@link locationToJSON} (`{ line, column }`) or
 * any structurally compatible object. Numeric-looking values are coerced with
 * `Number()` so e.g. string payloads from untyped serializers still work.
 *
 * @param json - The value to parse.
 * @returns A new `SourceLocation`.
 * @throws {TypeError} If `json` is not an object or does not contain numeric
 * `line` and `column` fields.
 *
 * @example
 * locationFromJSON({ line: 2, column: 5 }); // => { line: 2, column: 5 }
 */
export function locationFromJSON(json: unknown): SourceLocation {
  if (typeof json !== 'object' || json === null) {
    throw new TypeError('Invalid location JSON: expected an object');
  }
  const obj = json as Record<string, unknown>;
  const line = typeof obj.line === 'number' ? obj.line : Number(obj.line);
  const column = typeof obj.column === 'number' ? obj.column : Number(obj.column);
  if (Number.isNaN(line) || Number.isNaN(column)) {
    throw new TypeError('Invalid location JSON: line and column must be numeric');
  }
  return createLocation(line, column);
}

/**
 * Parse a `SourceSpan` from a JSON value.
 *
 * Accepts the output of {@link spanToJSON} (`{ start, end }` where each bound is
 * `{ line, column }`) as well as array-tuple bounds such as
 * `{ start: [line, col], end: [line, col] }` for compactness.
 *
 * @param json - The value to parse.
 * @returns A new `SourceSpan`.
 * @throws {TypeError} If the value is malformed.
 *
 * @example
 * spanFromJSON({ start: [1, 0], end: { line: 2, column: 3 } });
 * // => { start: { line: 1, column: 0 }, end: { line: 2, column: 3 } }
 */
export function spanFromJSON(json: unknown): SourceSpan {
  if (typeof json !== 'object' || json === null) {
    throw new TypeError('Invalid span JSON: expected an object');
  }
  const obj = json as Record<string, unknown>;
  return createSpan(parseBound(obj.start, 'start'), parseBound(obj.end, 'end'));
}

function parseBound(value: unknown, name: string): SourceLocation {
  if (Array.isArray(value)) {
    return createLocation(Number(value[0]), Number(value[1]));
  }
  if (typeof value === 'object' && value !== null) {
    return locationFromJSON(value);
  }
  throw new TypeError(`Invalid span JSON: missing ${name} bound`);
}

// ============================================================================
// Span Normalization and Expansion
// ============================================================================

/**
 * Normalize a span so that its start is not after its end.
 *
 * If the span is inverted (end before start) the endpoints are swapped. If the
 * span is already well-ordered (or empty) it is returned unchanged. The return
 * value is always a fresh object, never a mutated input.
 *
 * @param span - The span to normalize.
 * @returns A span with `start <= end`, or the input's bounds in a new object.
 *
 * @example
 * normalizeSpan({
 *   start: { line: 3, column: 0 },
 *   end: { line: 1, column: 0 },
 * }); // => { start: { line: 1, column: 0 }, end: { line: 3, column: 0 } }
 */
export function normalizeSpan(span: SourceSpan): SourceSpan {
  if (locationBefore(span.end, span.start)) {
    return createSpan(span.end, span.start);
  }
  return createSpan(span.start, span.end);
}

/**
 * Expand a span so it covers full lines in the given source text.
 *
 * The result starts at column 0 of the span's start line and ends at the last
 * column of the span's end line (the line content length, excluding the
 * trailing newline). This is useful for "select the whole lines touched by
 * this span" operations such as block extraction or error framing.
 *
 * @param span - The span to expand.
 * @param text - The source text used to measure line lengths.
 * @returns A new span spanning the full start and end lines. If either
 * boundary line cannot be resolved in `text`, the normalized input span is
 * returned unchanged.
 *
 * @example
 * expandSpanToLine(
 *   { start: { line: 1, column: 2 }, end: { line: 2, column: 1 } },
 *   'hello\nworld!'
 * );
 * // => { start: { line: 1, column: 0 }, end: { line: 2, column: 6 } }
 */
export function expandSpanToLine(span: SourceSpan, text: string): SourceSpan {
  const s = normalizeSpan(span);
  const startRange = getLineRange(text, s.start.line);
  const endRange = getLineRange(text, s.end.line);
  if (startRange === null || endRange === null) {
    return s;
  }
  return createSpan(
    createLocation(s.start.line, 0),
    createLocation(s.end.line, endRange.end - endRange.start)
  );
}
