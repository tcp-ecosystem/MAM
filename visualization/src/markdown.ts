import { V2ModuleNode } from '@mam/ast';
import { GraphData, GraphNode, GraphEdge } from './graph.js';

export interface MarkdownConfig {
  title?: string;
  includeToc?: boolean;
  includeStats?: boolean;
  includeTables?: boolean;
  maxLabelLength?: number;
}

export interface MarkdownOutput {
  markdown: string;
  sections: number;
  tables: number;
}

export const DEFAULT_MARKDOWN_TITLE = 'MAM System Report';

export function formatMarkdownTable(headers: string[], rows: string[][]): string {
  const escapedHeaders = headers.map(escapeMarkdownCell);
  const lines: string[] = [];
  lines.push(`| ${escapedHeaders.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    const cells = headers.map((_, index) => escapeMarkdownCell(row[index] ?? ''));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function escapeMarkdownCell(cell: string): string {
  return cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

export function markdownSectionHeading(title: string, level = 2): string {
  const clamped = Math.min(Math.max(Math.floor(level), 1), 6);
  return `${'#'.repeat(clamped)} ${title}`;
}

export class MarkdownReporter {
  private config: Required<MarkdownConfig>;

  constructor(config: MarkdownConfig = {}) {
    this.config = {
      title: DEFAULT_MARKDOWN_TITLE,
      includeToc: true,
      includeStats: true,
      includeTables: true,
      maxLabelLength: 40,
      ...config,
    };
  }

  generateFromModules(modules: V2ModuleNode[]): MarkdownOutput {
    const lines: string[] = [];
    let tables = 0;
    lines.push(`# ${this.config.title}`, '');
    const sections = this.collectModuleSections(modules);
    if (this.config.includeToc && sections.length > 0) {
      lines.push('## Contents', '');
      for (const section of sections) {
        lines.push(`- [${section}](#${slugifyMarkdownAnchor(section)})`);
      }
      lines.push('');
    }
    for (const mod of modules) {
      lines.push(markdownSectionHeading(mod.name, 2), '');
      lines.push(`Type: \`${mod.moduleType}\``, '');
      if (mod.role) lines.push(`Role: ${mod.role}`, '');
      if (mod.goal) lines.push(`Goal: ${mod.goal}`, '');
      if (mod.handoff && mod.handoff.length > 0) {
        lines.push('Handoff:', '');
        for (const target of mod.handoff) {
          lines.push(`- ${target}`);
        }
        lines.push('');
      }
      if (mod.tools && mod.tools.length > 0) {
        lines.push('Tools:', '');
        for (const tool of mod.tools) {
          lines.push(`- ${tool}`);
        }
        lines.push('');
      }
    }
    if (this.config.includeStats) {
      lines.push(markdownSectionHeading('Statistics', 2), '');
      lines.push(`Modules: ${modules.length}`, '');
    }
    return {
      markdown: lines.join('\n'),
      sections: sections.length + 1,
      tables,
    };
  }

  generateFromGraph(data: GraphData): MarkdownOutput {
    const lines: string[] = [];
    let tables = 0;
    lines.push(`# ${this.config.title}`, '');
    if (this.config.includeStats) {
      lines.push(markdownSectionHeading('Statistics', 2), '');
      lines.push(`Nodes: ${data.nodes.length}`, '');
      lines.push(`Edges: ${data.edges.length}`, '');
      lines.push(`Depth: ${data.metadata.depth}`, '');
    }
    if (this.config.includeTables) {
      lines.push(markdownSectionHeading('Nodes', 2), '');
      lines.push(formatMarkdownTable(
        ['ID', 'Label', 'Type'],
        data.nodes.map((node) => [
          this.shorten(node.id),
          this.shorten(node.label),
          node.type,
        ]),
      ), '');
      tables++;
      lines.push(markdownSectionHeading('Edges', 2), '');
      lines.push(formatMarkdownTable(
        ['From', 'To', 'Label', 'Type'],
        data.edges.map((edge) => [edge.from, edge.to, edge.label ?? '', edge.type]),
      ), '');
      tables++;
    } else {
      lines.push(markdownSectionHeading('Nodes', 2), '');
      for (const node of data.nodes) {
        lines.push(`- **${this.shorten(node.id)}** (${node.type})`);
      }
      lines.push('');
      lines.push(markdownSectionHeading('Edges', 2), '');
      for (const edge of data.edges) {
        lines.push(`- ${edge.from} -> ${edge.to}`);
      }
      lines.push('');
    }
    return {
      markdown: lines.join('\n'),
      sections: 3,
      tables,
    };
  }

  generateDependencyGraph(modules: V2ModuleNode[]): MarkdownOutput {
    const lines: string[] = [];
    lines.push(`# ${this.config.title}`, '');
    lines.push(markdownSectionHeading('Dependencies', 2), '');
    for (const mod of modules) {
      if (mod.requires && mod.requires.length > 0) {
        lines.push(`- **${mod.name}** depends on: ${mod.requires.join(', ')}`);
      } else {
        lines.push(`- **${mod.name}** has no dependencies`);
      }
    }
    lines.push('');
    return { markdown: lines.join('\n'), sections: 2, tables: 0 };
  }

  generateWorkflowGraph(modules: V2ModuleNode[]): MarkdownOutput {
    const lines: string[] = [];
    lines.push(`# ${this.config.title}`, '');
    lines.push(markdownSectionHeading('Workflows', 2), '');
    for (const mod of modules) {
      if (!mod.steps || mod.steps.length === 0) continue;
      lines.push(markdownSectionHeading(mod.name, 3), '');
      let index = 1;
      for (const step of mod.steps) {
        lines.push(`${index}. ${step.name}`);
        index++;
      }
      lines.push('');
    }
    return { markdown: lines.join('\n'), sections: 2, tables: 0 };
  }

  getConfig(): Required<MarkdownConfig> {
    return { ...this.config };
  }

  withTitle(title: string): MarkdownReporter {
    return new MarkdownReporter({ ...this.config, title });
  }

  withoutToc(): MarkdownReporter {
    return new MarkdownReporter({ ...this.config, includeToc: false });
  }

  withoutStats(): MarkdownReporter {
    return new MarkdownReporter({ ...this.config, includeStats: false });
  }

  withoutTables(): MarkdownReporter {
    return new MarkdownReporter({ ...this.config, includeTables: false });
  }

  private collectModuleSections(modules: V2ModuleNode[]): string[] {
    return modules.map((mod) => mod.name);
  }

  private shorten(text: string): string {
    const max = this.config.maxLabelLength;
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + '...';
  }
}

function slugifyMarkdownAnchor(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function markdownBold(text: string): string {
  return `**${text}**`;
}

function markdownCode(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function markdownOrderedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function countMarkdownHeadings(markdown: string): number {
  return markdown.split('\n').filter((line) => /^#{1,6}\s+/.test(line)).length;
}

function countMarkdownTables(markdown: string): number {
  const lines = markdown.split('\n');
  let tables = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = lines[i] as string;
    const separator = lines[i + 1] as string;
    if (header.trim().startsWith('|') && /^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(separator)) {
      tables++;
    }
  }
  return tables;
}

function extractMarkdownTitles(markdown: string): string[] {
  const titles: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+)/);
    if (match) {
      titles.push((match[1] as string).trim());
    }
  }
  return titles;
}

function truncateMarkdownCell(cell: string, maxLength: number): string {
  const escaped = escapeMarkdownCell(cell);
  if (escaped.length <= maxLength) return escaped;
  return escaped.slice(0, maxLength - 3) + '...';
}

function markdownQuote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

function markdownCodeBlock(language: string, code: string): string {
  return ['```' + language, code, '```'].join('\n');
}

function markdownHorizontalRule(): string {
  return '---';
}

function markdownLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

function markdownImage(alt: string, url: string): string {
  return `![${alt}](${url})`;
}

function markdownTaskItem(text: string, done: boolean): string {
  return `- [${done ? 'x' : ' '}] ${text}`;
}

function buildMarkdownToc(titles: string[]): string {
  return titles.map((title) => `- [${title}](#${slugifyMarkdownAnchor(title)})`).join('\n');
}

function getMarkdownSectionBodies(markdown: string): string[][] {
  const bodies: string[][] = [];
  let current: string[] = [];
  let started = false;
  for (const line of markdown.split('\n')) {
    if (/^#{1,6}\s+/.test(line)) {
      if (started) {
        bodies.push(current);
      }
      current = [];
      started = true;
      continue;
    }
    if (started) {
      current.push(line);
    }
  }
  if (started) {
    bodies.push(current);
  }
  return bodies;
}
