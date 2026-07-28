/**
 * MAM Range Utilities
 * 
 * Provides range-based position tracking for MAM documents.
 */

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export function createPosition(line: number, column: number, offset: number): Position {
  return { line, column, offset };
}

export function createRange(start: Position, end: Position): Range {
  return { start, end };
}

export function positionBefore(a: Position, b: Position): boolean {
  return a.offset < b.offset;
}

export function positionAfter(a: Position, b: Position): boolean {
  return a.offset > b.offset;
}

export function positionEqual(a: Position, b: Position): boolean {
  return a.offset === b.offset && a.line === b.line && a.column === b.column;
}

export function rangeContains(range: Range, position: Position): boolean {
  return !positionBefore(position, range.start) && !positionAfter(position, range.end);
}

export function rangesOverlap(a: Range, b: Range): boolean {
  return !positionBefore(a.end, b.start) && !positionBefore(b.end, a.start);
}

export function positionToString(position: Position): string {
  return `${position.line}:${position.column}:${position.offset}`;
}

export function rangeToString(range: Range): string {
  return `${positionToString(range.start)}-${positionToString(range.end)}`;
}
