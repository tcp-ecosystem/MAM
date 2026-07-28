/**
 * MAM Source Span Utilities
 */

export interface SourceSpan {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export function createSpan(startLine: number, startCol: number, endLine: number, endCol: number): SourceSpan {
  return {
    start: { line: startLine, column: startCol },
    end: { line: endLine, column: endCol },
  };
}

export function spanContains(span: SourceSpan, line: number, column: number): boolean {
  if (line < span.start.line || line > span.end.line) return false;
  if (line === span.start.line && column < span.start.column) return false;
  if (line === span.end.line && column > span.end.column) return false;
  return true;
}

export function spanToString(span: SourceSpan): string {
  return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}
