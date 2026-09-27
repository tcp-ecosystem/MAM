import { describe, it, expect } from 'vitest';
import {
  TimelineGenerator,
  TimelineOutput,
  scaleTimeToColumns,
  formatDurationLabel,
  clampTimelineRange,
} from '../src/timeline.js';
import { GraphData } from '../src/graph.js';
import { V2ModuleNode } from '@mam/ast';

function makeModule(overrides: Partial<V2ModuleNode> = {}): V2ModuleNode {
  return {
    type: 'ModuleNode',
    location: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 10, offset: 10 }, source: 'test.mam' },
    name: 'test-module',
    moduleType: 'module',
    ...overrides,
  } as V2ModuleNode;
}

const loc = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 1 }, source: 't' };

describe('TimelineGenerator', () => {
  it('should render module timelines', () => {
    const gen = new TimelineGenerator({ columns: 20 });
    const result = gen.generateFromModules([
      makeModule({
        name: 'flow',
        steps: [
          { type: 'StepNode', location: loc, name: 'one', agent: 'a' },
          { type: 'StepNode', location: loc, name: 'two', tool: 't' },
        ],
      }),
    ]);

    expect(result.rows).toBe(2);
    expect(result.text).toContain('flow/one');
    expect(result.columns).toBe(20);
  });

  it('should render modules without steps', () => {
    const gen = new TimelineGenerator();
    const result = gen.generateFromModules([makeModule({ name: 'solo' })]);

    expect(result.rows).toBe(1);
    expect(result.text).toContain('solo');
  });

  it('should render graph timelines', () => {
    const gen = new TimelineGenerator();
    const graph: GraphData = {
      nodes: [{ id: 'a', label: 'A', type: 'agent' }],
      edges: [],
      metadata: { nodeCount: 1, edgeCount: 0, depth: 0 },
    };
    const result = gen.generateFromGraph(graph);

    expect(result.rows).toBe(1);
    expect(result.min).toBe(0);
  });

  it('should scale workflow durations', () => {
    const gen = new TimelineGenerator();
    const result = gen.generateWorkflowTimeline([
      makeModule({
        name: 'flow',
        steps: [
          { type: 'StepNode', location: loc, name: 'quick', timeout: '30s' },
          { type: 'StepNode', location: loc, name: 'slow', timeout: '5m' },
        ],
      }),
    ]);

    expect(result.rows).toBe(2);
    expect(result.max).toBeGreaterThan(result.min);
  });

  it('should render custom rows', () => {
    const gen = new TimelineGenerator();
    const result = gen.generateCustomTimeline([
      { label: 'task', start: 0, end: 10, kind: 'step' },
    ]);

    expect(result.rows).toBe(1);
    expect(result.text).toContain('task');
  });

  it('should handle empty input', () => {
    const gen = new TimelineGenerator();
    const result = gen.generateCustomTimeline([]);

    expect(result.rows).toBe(0);
    expect(result.text).toBe('');
  });

  it('should customize fluently', () => {
    const gen = new TimelineGenerator().withColumns(10).withoutLabels().withMaxRows(5).withBarChar('*');
    expect(gen.getConfig().columns).toBe(10);
    const result = gen.generateCustomTimeline([{ label: 't', start: 0, end: 1, kind: 's' }]);
    expect(result.text).toContain('*');
  });
});

describe('timeline helpers', () => {
  it('should scale values to columns', () => {
    expect(scaleTimeToColumns(5, 0, 10, 10)).toBe(5);
    expect(scaleTimeToColumns(-5, 0, 10, 10)).toBe(0);
    expect(scaleTimeToColumns(99, 0, 10, 10)).toBe(10);
    expect(scaleTimeToColumns(5, 5, 5, 10)).toBe(0);
  });

  it('should format durations', () => {
    expect(formatDurationLabel(500)).toBe('500ms');
    expect(formatDurationLabel(1500)).toBe('1.5s');
    expect(formatDurationLabel(120000)).toBe('2m');
    expect(formatDurationLabel(90000)).toBe('1m 30s');
  });

  it('should clamp ranges', () => {
    expect(clampTimelineRange(0, 5)).toEqual({ start: 0, end: 5 });
    expect(clampTimelineRange(5, 0)).toEqual({ start: 0, end: 5 });
  });
});
