import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

export interface CSVConfig {
  delimiter?: string;
  includeHeader?: boolean;
  lineEnding?: '\n' | '\r\n';
  quoteAll?: boolean;
}

export interface CSVOutput {
  nodesCsv: string;
  edgesCsv: string;
  nodeCount: number;
  edgeCount: number;
}

export const CSV_MIME_TYPE = 'text/csv';

export function escapeCsvField(field: string, delimiter = ','): string {
  const needsQuotes = field.includes(delimiter) || field.includes('"') ||
    field.includes('\n') || field.includes('\r');
  const escaped = field.replace(/"/g, '""');
  if (needsQuotes) {
    return `"${escaped}"`;
  }
  return escaped;
}

export function nodesToCsvRecords(nodes: GraphNode[]): string[][] {
  return nodes.map((node) => [node.id, node.label, node.type]);
}

export function edgesToCsvRecords(edges: GraphEdge[]): string[][] {
  return edges.map((edge) => [edge.from, edge.to, edge.label ?? '', edge.type]);
}

export class CSVExporter {
  private config: Required<CSVConfig>;

  constructor(config: CSVConfig = {}) {
    this.config = {
      delimiter: ',',
      includeHeader: true,
      lineEnding: '\n',
      quoteAll: false,
      ...config,
    };
  }

  generateFromModules(modules: V2ModuleNode[]): CSVOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const mod of modules) {
      nodes.push({ id: mod.name, label: mod.name, type: mod.moduleType });
      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({ from: edge.source, to: edge.target, label: edge.label, type: 'direct' });
        }
      }
      if (mod.handoff) {
        for (const target of mod.handoff) {
          edges.push({ from: mod.name, to: target, type: 'handoff' });
        }
      }
      if (mod.tools) {
        for (const tool of mod.tools) {
          edges.push({ from: mod.name, to: tool, type: 'dependency' });
        }
      }
    }
    return this.buildOutput(nodes, edges);
  }

  generateFromGraph(data: GraphData): CSVOutput {
    return this.buildOutput(data.nodes, data.edges);
  }

  generateDependencyGraph(modules: V2ModuleNode[]): CSVOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const mod of modules) {
      nodes.push({ id: mod.name, label: mod.name, type: mod.moduleType });
      if (mod.requires) {
        for (const req of mod.requires) {
          edges.push({ from: mod.name, to: req, type: 'dependency' });
        }
      }
    }
    return this.buildOutput(nodes, edges);
  }

  generateWorkflowGraph(modules: V2ModuleNode[]): CSVOutput {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const mod of modules) {
      if (mod.steps) {
        for (const step of mod.steps) {
          nodes.push({ id: `${mod.name}-${step.name}`, label: step.name, type: 'step' });
        }
      }
      if (mod.edges) {
        for (const edge of mod.edges) {
          edges.push({
            from: `${mod.name}-${edge.source}`,
            to: `${mod.name}-${edge.target}`,
            label: edge.label,
            type: 'direct',
          });
        }
      }
    }
    return this.buildOutput(nodes, edges);
  }

  getConfig(): Required<CSVConfig> {
    return { ...this.config };
  }

  get dialect(): string {
    return this.config.delimiter === '\t' ? 'tsv' : 'csv';
  }

  getNodeCsv(data: GraphData): string {
    return this.formatTable(
      this.config.includeHeader ? [['id', 'label', 'type']] : [],
      nodesToCsvRecords(data.nodes),
    );
  }

  getEdgeCsv(data: GraphData): string {
    return this.formatTable(
      this.config.includeHeader ? [['from', 'to', 'label', 'type']] : [],
      edgesToCsvRecords(data.edges),
    );
  }

  getCombinedCsv(data: GraphData): string {
    const sections: string[] = [];
    sections.push('# nodes');
    sections.push(this.getNodeCsv(data).trimEnd());
    sections.push('# edges');
    sections.push(this.getEdgeCsv(data).trimEnd());
    return sections.join(this.config.lineEnding) + this.config.lineEnding;
  }

  withDelimiter(delimiter: string): CSVExporter {
    return new CSVExporter({ ...this.config, delimiter });
  }

  withHeader(includeHeader: boolean): CSVExporter {
    return new CSVExporter({ ...this.config, includeHeader });
  }

  private buildOutput(nodes: GraphNode[], edges: GraphEdge[]): CSVOutput {
    const nodesCsv = this.formatTable(
      this.config.includeHeader ? [['id', 'label', 'type']] : [],
      nodesToCsvRecords(nodes),
    );
    const edgesCsv = this.formatTable(
      this.config.includeHeader ? [['from', 'to', 'label', 'type']] : [],
      edgesToCsvRecords(edges),
    );
    return {
      nodesCsv,
      edgesCsv,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  private formatTable(header: string[][], rows: string[][]): string {
    const lines: string[] = [];
    for (const row of [...header, ...rows]) {
      lines.push(this.formatRow(row));
    }
    if (lines.length === 0) return '';
    return lines.join(this.config.lineEnding) + this.config.lineEnding;
  }

  private formatRow(fields: string[]): string {
    return fields
      .map((field) => this.formatField(field))
      .join(this.config.delimiter);
  }

  private formatField(field: string): string {
    if (this.config.quoteAll) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return escapeCsvField(field, this.config.delimiter);
  }
}

function formatCsvRow(fields: string[], delimiter = ','): string {
  return fields.map((field) => escapeCsvField(field, delimiter)).join(delimiter);
}

function formatCsvTable(header: string[], rows: string[][], delimiter = ','): string {
  const lines = rows.map((row) => formatCsvRow(row, delimiter));
  if (header.length > 0) {
    lines.unshift(formatCsvRow(header, delimiter));
  }
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n';
}

function countCsvRows(csv: string): number {
  const trimmed = csv.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split('\n').length;
}

function countCsvColumns(headerRow: string, delimiter = ','): number {
  if (headerRow.trim().length === 0) return 0;
  return splitCsvLine(headerRow, delimiter).length;
}

function splitCsvLine(line: string, delimiter = ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function validateCsvRectangular(csv: string, delimiter = ','): boolean {
  const lines = csv.trim().split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return true;
  const width = splitCsvLine(lines[0] as string, delimiter).length;
  return lines.every((line) => splitCsvLine(line, delimiter).length === width);
}

function getCsvHeader(csv: string, delimiter = ','): string[] {
  const first = csv.split('\n')[0] ?? '';
  if (first.trim().length === 0) return [];
  return splitCsvLine(first, delimiter);
}

function detectDelimiter(sample: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const first = sample.split('\n')[0] ?? '';
    const count = splitCsvLine(first, candidate).length;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

function normalizeLineEndings(csv: string, ending: '\n' | '\r\n'): string {
  return csv.replace(/\r\n|\r|\n/g, ending);
}

function stripCsvHeader(csv: string): string {
  const index = csv.indexOf('\n');
  if (index < 0) return '';
  return csv.slice(index + 1);
}

function getCsvBodyRowCount(csv: string, hasHeader: boolean): number {
  const rows = countCsvRows(csv);
  if (rows === 0) return 0;
  return hasHeader ? Math.max(0, rows - 1) : rows;
}

function findCsvColumnIndex(header: string[], name: string): number {
  return header.findIndex((column) => column.trim().toLowerCase() === name.toLowerCase());
}

function getCsvColumn(csv: string, name: string, delimiter = ','): string[] {
  const lines = csv.trim().split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0] as string, delimiter);
  const index = findCsvColumnIndex(header, name);
  if (index < 0) return [];
  return lines.slice(1).map((line) => splitCsvLine(line, delimiter)[index] ?? '');
}

function joinCsvTables(tables: string[]): string {
  return tables.filter((table) => table.trim().length > 0).join('');
}
