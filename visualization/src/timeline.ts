import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode } from './graph.js';

export interface TimelineConfig {
  columns?: number;
  barChar?: string;
  emptyChar?: string;
  showLabels?: boolean;
  maxRows?: number;
}

export interface TimelineRow {
  label: string;
  start: number;
  end: number;
  kind: string;
}

export interface TimelineOutput {
  text: string;
  rows: number;
  columns: number;
  min: number;
  max: number;
}

export function scaleTimeToColumns(value: number, min: number, max: number, columns: number): number {
  if (columns <= 0) return 0;
  if (max <= min) return 0;
  const ratio = (value - min) / (max - min);
  return Math.min(columns, Math.max(0, Math.round(ratio * columns)));
}

export function formatDurationLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function clampTimelineRange(start: number, end: number): { start: number; end: number } {
  if (end < start) return { start: end, end: start };
  return { start, end };
}

export class TimelineGenerator {
  private config: Required<TimelineConfig>;

  constructor(config: TimelineConfig = {}) {
    this.config = {
      columns: 50,
      barChar: '#',
      emptyChar: '-',
      showLabels: true,
      maxRows: 30,
      ...config,
    };
  }

  generateFromModules(modules: V2ModuleNode[]): TimelineOutput {
    const rows: TimelineRow[] = [];
    let order = 0;
    for (const mod of modules) {
      if (mod.steps && mod.steps.length > 0) {
        for (const step of mod.steps) {
          rows.push({
            label: `${mod.name}/${step.name}`,
            start: order,
            end: order + 1,
            kind: step.agent ? 'agent' : step.tool ? 'tool' : 'step',
          });
          order++;
        }
      } else {
        rows.push({ label: mod.name, start: order, end: order + 1, kind: mod.moduleType });
        order++;
      }
    }
    return this.buildOutput(rows);
  }

  generateFromGraph(data: GraphData): TimelineOutput {
    const rows: TimelineRow[] = data.nodes.map((node, index) => ({
      label: node.label,
      start: index,
      end: index + 1,
      kind: node.type,
    }));
    return this.buildOutput(rows);
  }

  generateWorkflowTimeline(modules: V2ModuleNode[]): TimelineOutput {
    const rows: TimelineRow[] = [];
    for (const mod of modules) {
      if (!mod.steps) continue;
      let cursor = 0;
      for (const step of mod.steps) {
        const duration = parseDurationHint(step.timeout) ?? 1;
        rows.push({
          label: `${mod.name}/${step.name}`,
          start: cursor,
          end: cursor + duration,
          kind: 'step',
        });
        cursor += duration;
      }
    }
    return this.buildOutput(rows);
  }

  generateCustomTimeline(rows: TimelineRow[]): TimelineOutput {
    return this.buildOutput(rows);
  }

  getConfig(): Required<TimelineConfig> {
    return { ...this.config };
  }

  withColumns(columns: number): TimelineGenerator {
    return new TimelineGenerator({ ...this.config, columns });
  }

  withoutLabels(): TimelineGenerator {
    return new TimelineGenerator({ ...this.config, showLabels: false });
  }

  withMaxRows(maxRows: number): TimelineGenerator {
    return new TimelineGenerator({ ...this.config, maxRows });
  }

  withBarChar(barChar: string): TimelineGenerator {
    return new TimelineGenerator({ ...this.config, barChar });
  }

  private buildOutput(input: TimelineRow[]): TimelineOutput {
    const rows = input.slice(0, this.config.maxRows);
    if (rows.length === 0) {
      return { text: '', rows: 0, columns: this.config.columns, min: 0, max: 0 };
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const range = clampTimelineRange(row.start, row.end);
      min = Math.min(min, range.start);
      max = Math.max(max, range.end);
    }
    const labelWidth = this.config.showLabels
      ? rows.reduce((width, row) => Math.max(width, row.label.length), 0)
      : 0;
    const lines = rows.map((row) => this.renderRow(row, min, max, labelWidth));
    const header = this.config.showLabels
      ? `${' '.repeat(labelWidth)} |${formatDurationLabel(min)}${' '.repeat(Math.max(0, this.config.columns - 12))}${formatDurationLabel(max)}`
      : '';
    const text = header.length > 0 ? [header, ...lines].join('\n') : lines.join('\n');
    return { text, rows: rows.length, columns: this.config.columns, min, max };
  }

  private renderRow(row: TimelineRow, min: number, max: number, labelWidth: number): string {
    const range = clampTimelineRange(row.start, row.end);
    const columns = this.config.columns;
    const from = scaleTimeToColumns(range.start, min, max, columns);
    const to = Math.max(from + 1, scaleTimeToColumns(range.end, min, max, columns));
    const bar = this.config.emptyChar.repeat(from) +
      this.config.barChar.repeat(Math.min(columns - from, to - from)) +
      this.config.emptyChar.repeat(Math.max(0, columns - to));
    if (!this.config.showLabels) {
      return `|${bar}|`;
    }
    return `${row.label.padEnd(labelWidth)} |${bar}| ${formatDurationLabel(range.end - range.start)}`;
  }
}

function parseDurationHint(timeout: string | undefined): number | undefined {
  if (!timeout) return undefined;
  const match = timeout.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] as string);
  const unit = (match[2] ?? 's').toLowerCase();
  if (unit === 'ms') return Math.max(1, Math.round(value / 1000));
  if (unit === 'm') return Math.max(1, Math.round(value * 60));
  if (unit === 'h') return Math.max(1, Math.round(value * 3600));
  return Math.max(1, Math.round(value));
}

function normalizeTimelineRows(rows: TimelineRow[]): TimelineRow[] {
  return rows.map((row) => {
    const range = clampTimelineRange(row.start, row.end);
    return { label: row.label, start: range.start, end: range.end, kind: row.kind };
  });
}

function sortTimelineRows(rows: TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => a.start - b.start || a.end - b.end);
}

function mergeOverlappingRows(rows: TimelineRow[]): TimelineRow[] {
  const sorted = sortTimelineRows(normalizeTimelineRows(rows));
  const merged: TimelineRow[] = [];
  for (const row of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.kind === row.kind && row.start <= last.end) {
      last.end = Math.max(last.end, row.end);
    } else {
      merged.push({ ...row });
    }
  }
  return merged;
}

function getTimelineBounds(rows: TimelineRow[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const range = clampTimelineRange(row.start, row.end);
    min = Math.min(min, range.start);
    max = Math.max(max, range.end);
  }
  if (rows.length === 0) {
    return { min: 0, max: 0 };
  }
  return { min, max };
}

function filterTimelineRows(rows: TimelineRow[], kind: string): TimelineRow[] {
  return rows.filter((row) => row.kind === kind);
}

function countTimelineRows(rows: TimelineRow[]): number {
  return rows.length;
}

function getTimelineSpan(rows: TimelineRow[]): number {
  const bounds = getTimelineBounds(rows);
  return bounds.max - bounds.min;
}

function buildTimelineBar(from: number, to: number, columns: number, barChar: string, emptyChar: string): string {
  const start = Math.min(columns, Math.max(0, from));
  const end = Math.min(columns, Math.max(start + 1, to));
  return emptyChar.repeat(start) + barChar.repeat(end - start) + emptyChar.repeat(Math.max(0, columns - end));
}

function getRowDuration(row: TimelineRow): number {
  const range = clampTimelineRange(row.start, row.end);
  return range.end - range.start;
}

function getTotalDuration(rows: TimelineRow[]): number {
  return rows.reduce((total, row) => total + getRowDuration(row), 0);
}

function getAverageDuration(rows: TimelineRow[]): number {
  if (rows.length === 0) return 0;
  return getTotalDuration(rows) / rows.length;
}

function getLongestRow(rows: TimelineRow[]): TimelineRow | undefined {
  let best: TimelineRow | undefined;
  for (const row of rows) {
    if (!best || getRowDuration(row) > getRowDuration(best)) {
      best = row;
    }
  }
  return best;
}

function padTimelineLabel(label: string, width: number): string {
  if (label.length >= width) return label.slice(0, width);
  return label + ' '.repeat(width - label.length);
}

function buildTimelineHeader(labelWidth: number, columns: number, min: number, max: number): string {
  const span = `${formatDurationLabel(min)}..${formatDurationLabel(max)}`;
  const padding = Math.max(0, columns - span.length);
  return `${' '.repeat(labelWidth)} |${span}${' '.repeat(padding)}|`;
}

function renderTimelineLegend(kinds: string[]): string {
  return kinds.map((kind) => `- ${kind}`).join('\n');
}

function collectTimelineKinds(rows: TimelineRow[]): string[] {
  return Array.from(new Set(rows.map((row) => row.kind))).sort();
}

function getRowLabels(rows: TimelineRow[]): string[] {
  return rows.map((row) => row.label);
}

function scaleRowsToColumns(rows: TimelineRow[], columns: number): Array<{ label: string; from: number; to: number }> {
  const bounds = getTimelineBounds(rows);
  return rows.map((row) => {
    const range = clampTimelineRange(row.start, row.end);
    return {
      label: row.label,
      from: scaleTimeToColumns(range.start, bounds.min, bounds.max, columns),
      to: scaleTimeToColumns(range.end, bounds.min, bounds.max, columns),
    };
  });
}
