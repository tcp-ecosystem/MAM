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
