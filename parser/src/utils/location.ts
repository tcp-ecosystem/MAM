/**
 * MAM Source Location Utilities
 * 
 * Provides utilities for tracking and manipulating source locations
 * in MAM documents.
 */

export interface SourceLocation {
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

export function createLocation(line: number, column: number): SourceLocation {
  return { line, column };
}

export function createSpan(start: SourceLocation, end: SourceLocation): SourceSpan {
  return { start, end };
}

export function locationBefore(a: SourceLocation, b: SourceLocation): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

export function locationAfter(a: SourceLocation, b: SourceLocation): boolean {
  return a.line > b.line || (a.line === b.line && a.column > b.column);
}

export function locationEqual(a: SourceLocation, b: SourceLocation): boolean {
  return a.line === b.line && a.column === b.column;
}

export function spanContains(span: SourceSpan, location: SourceLocation): boolean {
  return !locationBefore(location, span.start) && !locationAfter(location, span.end);
}

export function spansOverlap(a: SourceSpan, b: SourceSpan): boolean {
  return !locationBefore(a.end, b.start) && !locationBefore(b.end, a.start);
}

export function locationToString(location: SourceLocation): string {
  return `${location.line}:${location.column}`;
}

export function spanToString(span: SourceSpan): string {
  return `${locationToString(span.start)}-${locationToString(span.end)}`;
}
