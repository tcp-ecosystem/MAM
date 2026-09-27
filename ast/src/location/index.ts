/**
 * MAM Source Location
 * 
 * Defines source location types for AST nodes.
 */

export interface SourceLocation {
  start: Position;
  end: Position;
  source: string;
}

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export function createPosition(line: number, column: number, offset: number): Position {
  return { line, column, offset };
}

export function createLocation(
  startLine: number,
  startCol: number,
  startOffset: number,
  endLine: number,
  endCol: number,
  endOffset: number,
  source: string
): SourceLocation {
  return {
    start: createPosition(startLine, startCol, startOffset),
    end: createPosition(endLine, endCol, endOffset),
    source,
  };
}

export function mergeLocations(a: SourceLocation, b: SourceLocation): SourceLocation {
  return {
    start: a.start.offset <= b.start.offset ? a.start : b.start,
    end: a.end.offset >= b.end.offset ? a.end : b.end,
    source: a.source,
  };
}

export function locationToString(loc: SourceLocation): string {
  return `${loc.source}:${loc.start.line}:${loc.start.column}`;
}

export function positionEquals(a: Position, b: Position): boolean {
  return a.line === b.line && a.column === b.column && a.offset === b.offset;
}

export function positionCompare(a: Position, b: Position): number {
  return a.offset - b.offset;
}

export function locationLength(loc: SourceLocation): number {
  return loc.end.offset - loc.start.offset;
}

export function locationContainsPosition(loc: SourceLocation, pos: Position): boolean {
  return pos.offset >= loc.start.offset && pos.offset <= loc.end.offset;
}

export function isPositionBefore(a: Position, b: Position): boolean {
  return positionCompare(a, b) < 0;
}

export function shiftLocation(
  loc: SourceLocation,
  lineDelta: number,
  columnDelta: number,
  offsetDelta: number = 0,
): SourceLocation {
  return {
    start: {
      line: loc.start.line + lineDelta,
      column: loc.start.column + columnDelta,
      offset: loc.start.offset + offsetDelta,
    },
    end: {
      line: loc.end.line + lineDelta,
      column: loc.end.column + columnDelta,
      offset: loc.end.offset + offsetDelta,
    },
    source: loc.source,
  };
}

export function cloneLocation(loc: SourceLocation): SourceLocation {
  return {
    start: { line: loc.start.line, column: loc.start.column, offset: loc.start.offset },
    end: { line: loc.end.line, column: loc.end.column, offset: loc.end.offset },
    source: loc.source,
  };
}