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