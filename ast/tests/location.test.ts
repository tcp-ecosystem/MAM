/**
 * Location & Span Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createPosition,
  createLocation,
  mergeLocations,
  locationToString,
} from '../src/location/index.js';
import {
  createSpan,
  spanFromLocation,
  spanAt,
  spanContains,
  spanContainsLine,
  spanOverlap,
  spanMerge,
  spanLineCount,
  spanLength,
  spanCompare,
  spanEquals,
  splitSpanAt,
  spanOffset,
  offsetToPosition,
  positionToOffset,
  spanToString,
  spanToLineRange,
} from '../src/location/span.js';

describe('Position & Location', () => {
  it('should create position', () => {
    const pos = createPosition(5, 10, 42);
    expect(pos).toEqual({ line: 5, column: 10, offset: 42 });
  });

  it('should create location', () => {
    const loc = createLocation(1, 0, 0, 10, 5, 100, 'file.md');
    expect(loc.start).toEqual({ line: 1, column: 0, offset: 0 });
    expect(loc.end).toEqual({ line: 10, column: 5, offset: 100 });
    expect(loc.source).toBe('file.md');
  });

  it('should merge locations picking earliest start', () => {
    const a = createLocation(3, 5, 20, 10, 0, 100, 'a.md');
    const b = createLocation(1, 0, 0, 5, 10, 50, 'b.md');
    const merged = mergeLocations(a, b);
    expect(merged.start.offset).toBe(0);
    expect(merged.end.offset).toBe(100);
  });

  it('should merge locations picking latest end', () => {
    const a = createLocation(1, 0, 0, 5, 10, 50, 'a.md');
    const b = createLocation(3, 5, 20, 10, 0, 100, 'b.md');
    const merged = mergeLocations(a, b);
    expect(merged.start.offset).toBe(0);
    expect(merged.end.offset).toBe(100);
  });

  it('should use first location source on merge', () => {
    const a = createLocation(1, 0, 0, 5, 0, 0, 'first.md');
    const b = createLocation(1, 0, 0, 5, 0, 0, 'second.md');
    const merged = mergeLocations(a, b);
    expect(merged.source).toBe('first.md');
  });

  it('should format location to string', () => {
    const loc = createLocation(5, 3, 0, 10, 0, 0, 'file.md');
    expect(locationToString(loc)).toBe('file.md:5:3');
  });
});

describe('Span Creation', () => {
  it('should create span', () => {
    const span = createSpan(1, 0, 5, 10);
    expect(span).toEqual({
      start: { line: 1, column: 0 },
      end: { line: 5, column: 10 },
    });
  });

  it('should create span from location', () => {
    const loc = createLocation(2, 3, 0, 7, 8, 0, 'test.md');
    const span = spanFromLocation(loc);
    expect(span.start).toEqual({ line: 2, column: 3 });
    expect(span.end).toEqual({ line: 7, column: 8 });
  });

  it('should create single-line span', () => {
    const span = spanAt(5, 10, 20);
    expect(span.start).toEqual({ line: 5, column: 10 });
    expect(span.end).toEqual({ line: 5, column: 30 });
  });

  it('should create single-line span with default length', () => {
    const span = spanAt(5, 10);
    expect(span.end.column).toBe(11);
  });
});

describe('Span Containment', () => {
  const span = createSpan(2, 5, 4, 10);

  it('should contain point inside', () => {
    expect(spanContains(span, 3, 0)).toBe(true);
  });

  it('should contain start point', () => {
    expect(spanContains(span, 2, 5)).toBe(true);
  });

  it('should not contain point before start', () => {
    expect(spanContains(span, 1, 10)).toBe(false);
  });

  it('should not contain point after end', () => {
    expect(spanContains(span, 5, 0)).toBe(false);
  });

  it('should not contain point on same line but before column', () => {
    expect(spanContains(span, 2, 4)).toBe(false);
  });

  it('should not contain point on same end line but after column', () => {
    expect(spanContains(span, 4, 11)).toBe(false);
  });

  it('should contain line', () => {
    expect(spanContainsLine(span, 3)).toBe(true);
    expect(spanContainsLine(span, 2)).toBe(true);
    expect(spanContainsLine(span, 4)).toBe(true);
  });

  it('should not contain line outside', () => {
    expect(spanContainsLine(span, 1)).toBe(false);
    expect(spanContainsLine(span, 5)).toBe(false);
  });
});

describe('Span Overlap', () => {
  it('should detect overlapping spans', () => {
    const a = createSpan(1, 0, 3, 10);
    const b = createSpan(2, 0, 4, 10);
    expect(spanOverlap(a, b)).toBe(true);
  });

  it('should detect non-overlapping spans (a before b)', () => {
    const a = createSpan(1, 0, 2, 10);
    const b = createSpan(3, 0, 4, 10);
    expect(spanOverlap(a, b)).toBe(false);
  });

  it('should detect non-overlapping spans (b before a)', () => {
    const a = createSpan(5, 0, 6, 10);
    const b = createSpan(1, 0, 4, 10);
    expect(spanOverlap(a, b)).toBe(false);
  });

  it('should detect same-line overlap', () => {
    const a = createSpan(1, 0, 1, 10);
    const b = createSpan(1, 5, 1, 15);
    expect(spanOverlap(a, b)).toBe(true);
  });

  it('should detect same-line non-overlap', () => {
    const a = createSpan(1, 0, 1, 5);
    const b = createSpan(1, 10, 1, 15);
    expect(spanOverlap(a, b)).toBe(false);
  });
});

describe('Span Merge', () => {
  it('should merge overlapping spans', () => {
    const a = createSpan(1, 5, 3, 10);
    const b = createSpan(2, 0, 4, 5);
    const merged = spanMerge(a, b);
    expect(merged.start.line).toBe(1);
    expect(merged.start.column).toBe(0);
    expect(merged.end.line).toBe(4);
    // spanMerge: endLine != a.end.line (4 != 3) => endCol = b.end.column = 5
    expect(merged.end.column).toBe(5);
  });

  it('should merge non-overlapping spans', () => {
    const a = createSpan(1, 0, 2, 5);
    const b = createSpan(3, 0, 4, 5);
    const merged = spanMerge(a, b);
    expect(merged.start.line).toBe(1);
    expect(merged.end.line).toBe(4);
  });
});

describe('Span Length & Line Count', () => {
  it('should count single-line span length', () => {
    const span = createSpan(1, 0, 1, 20);
    expect(spanLength(span)).toBe(20);
  });

  it('should approximate multi-line span length', () => {
    const span = createSpan(1, 0, 3, 10);
    const len = spanLength(span);
    expect(len).toBeGreaterThan(0);
  });

  it('should count lines', () => {
    const span = createSpan(1, 0, 5, 0);
    expect(spanLineCount(span)).toBe(5);
  });

  it('should count single line', () => {
    const span = createSpan(3, 0, 3, 10);
    expect(spanLineCount(span)).toBe(1);
  });
});

describe('Span Comparison', () => {
  it('should compare spans by start line', () => {
    const a = createSpan(1, 0, 5, 0);
    const b = createSpan(3, 0, 5, 0);
    expect(spanCompare(a, b)).toBeLessThan(0);
    expect(spanCompare(b, a)).toBeGreaterThan(0);
  });

  it('should compare spans by start column when same line', () => {
    const a = createSpan(1, 0, 5, 0);
    const b = createSpan(1, 5, 5, 0);
    expect(spanCompare(a, b)).toBeLessThan(0);
  });

  it('should compare equal spans', () => {
    const a = createSpan(1, 0, 5, 10);
    const b = createSpan(1, 0, 5, 10);
    expect(spanCompare(a, b)).toBe(0);
  });

  it('should check equality', () => {
    const a = createSpan(1, 0, 5, 10);
    const b = createSpan(1, 0, 5, 10);
    const c = createSpan(1, 0, 5, 11);
    expect(spanEquals(a, b)).toBe(true);
    expect(spanEquals(a, c)).toBe(false);
  });
});

describe('Split Span', () => {
  it('should split span at valid position', () => {
    const span = createSpan(1, 0, 3, 10);
    const result = splitSpanAt(span, { line: 2, column: 5 });
    expect(result).not.toBeNull();
    const [before, after] = result!;
    expect(before.start).toEqual({ line: 1, column: 0 });
    expect(before.end).toEqual({ line: 2, column: 5 });
    expect(after.start).toEqual({ line: 2, column: 5 });
    expect(after.end).toEqual({ line: 3, column: 10 });
  });

  it('should return null if position outside span', () => {
    const span = createSpan(2, 0, 4, 10);
    expect(splitSpanAt(span, { line: 1, column: 0 })).toBeNull();
    expect(splitSpanAt(span, { line: 5, column: 0 })).toBeNull();
  });

  it('should return null if at start', () => {
    const span = createSpan(1, 0, 3, 10);
    expect(splitSpanAt(span, { line: 1, column: 0 })).toBeNull();
  });

  it('should return null if at end', () => {
    const span = createSpan(1, 0, 3, 10);
    expect(splitSpanAt(span, { line: 3, column: 10 })).toBeNull();
  });
});

describe('Span Offset', () => {
  it('should offset span', () => {
    const span = createSpan(2, 5, 4, 10);
    const offset = spanOffset(span, 3, 2);
    expect(offset.start).toEqual({ line: 5, column: 7 });
    expect(offset.end).toEqual({ line: 7, column: 12 });
  });
});

describe('Offset/Position Conversion', () => {
  const text = 'hello\nworld\nfoo';

  it('should convert offset to position', () => {
    expect(offsetToPosition(text, 0)).toEqual({ line: 1, column: 0 });
    expect(offsetToPosition(text, 5)).toEqual({ line: 1, column: 5 });
    expect(offsetToPosition(text, 6)).toEqual({ line: 2, column: 0 });
    expect(offsetToPosition(text, 11)).toEqual({ line: 2, column: 5 });
    expect(offsetToPosition(text, 12)).toEqual({ line: 3, column: 0 });
  });

  it('should handle offset <= 0', () => {
    expect(offsetToPosition(text, -1)).toEqual({ line: 1, column: 0 });
    expect(offsetToPosition(text, 0)).toEqual({ line: 1, column: 0 });
  });

  it('should handle offset >= text length', () => {
    const pos = offsetToPosition(text, 100);
    expect(pos.line).toBe(3);
  });

  it('should convert position to offset', () => {
    expect(positionToOffset(text, { line: 1, column: 0 })).toBe(0);
    expect(positionToOffset(text, { line: 1, column: 5 })).toBe(5);
    expect(positionToOffset(text, { line: 2, column: 0 })).toBe(6);
    expect(positionToOffset(text, { line: 2, column: 5 })).toBe(11);
    expect(positionToOffset(text, { line: 3, column: 0 })).toBe(12);
  });

  it('should clamp column to line length', () => {
    const pos = positionToOffset(text, { line: 1, column: 999 });
    expect(pos).toBe(5);
  });

  it('should roundtrip offset -> position -> offset', () => {
    for (let i = 0; i <= text.length; i++) {
      const pos = offsetToPosition(text, i);
      const offset = positionToOffset(text, pos);
      expect(offset).toBe(Math.min(i, text.length));
    }
  });
});

describe('Span String Output', () => {
  it('should format span to string', () => {
    const span = createSpan(1, 0, 5, 10);
    expect(spanToString(span)).toBe('1:0-5:10');
  });

  it('should format single-line range', () => {
    const span = createSpan(3, 0, 3, 10);
    expect(spanToLineRange(span)).toBe('line 3');
  });

  it('should format multi-line range', () => {
    const span = createSpan(2, 0, 5, 10);
    expect(spanToLineRange(span)).toBe('lines 2-5');
  });
});
