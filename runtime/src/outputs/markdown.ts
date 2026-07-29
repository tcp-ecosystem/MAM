/**
 * Markdown Output Formatter
 *
 * Generates clean, portable Markdown with YAML frontmatter, fenced code
 * blocks, aligned tables, and a table of contents.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkdownOutputOptions {
  /** ATX (#) or setext (===/---) heading style. */
  headingStyle?: 'atx' | 'setext';
  /** List bullet marker. */
  listMarker?: '-' | '*' | '+';
  /** Fenced code block delimiter. */
  codeBlockStyle?: 'backtick' | 'tilde';
  /** Include YAML frontmatter block. */
  includeFrontmatter?: boolean;
  /** Prepend a table of contents. */
  toc?: boolean;
  /** Max heading level for TOC. */
  tocDepth?: number;
  /** Line ending style. */
  lineEnding?: '\n' | '\r\n';
}

interface SectionData {
  name: string;
  content?: unknown;
  level?: number;
  id?: string;
}

interface FrontmatterData {
  [key: string]: unknown;
}

interface CodeBlockData {
  code: string;
  language?: string;
  filename?: string;
}

interface TableData {
  headers: string[];
  rows: string[][];
  alignments?: ('left' | 'center' | 'right')[];
}

interface ListItem {
  text: string;
  items?: ListItem[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<MarkdownOutputOptions> = {
  headingStyle: 'atx',
  listMarker: '-',
  codeBlockStyle: 'backtick',
  includeFrontmatter: true,
  toc: false,
  tocDepth: 3,
  lineEnding: '\n',
};

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export class MarkdownOutput {
  private opts: Required<MarkdownOutputOptions>;

  constructor(options?: MarkdownOutputOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  // -----------------------------------------------------------------------
  // Core
  // -----------------------------------------------------------------------

  format(data: unknown): string {
    const doc = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const fm = (doc.frontmatter ?? {}) as FrontmatterData;
    const sections = ((doc.sections ?? []) as SectionData[]).filter(Boolean);

    const parts: string[] = [];

    if (this.opts.includeFrontmatter && Object.keys(fm).length > 0) {
      parts.push(this.renderFrontmatter(fm));
    }

    if (this.opts.toc && sections.length > 0) {
      parts.push(this.generateTOC(sections));
    }

    parts.push(this.formatSections(sections));

    return this.wrapDocument(parts.join('\n'));
  }

  formatSections(sections: unknown[]): string {
    return (sections as SectionData[])
      .map((s) => this.renderSection(s))
      .join('\n\n');
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  renderFrontmatter(data: FrontmatterData): string {
    const lines = Object.entries(data).map(([key, value]) => {
      const val = this.formatYamlValue(value);
      return `${key}: ${val}`;
    });

    return ['---', ...lines, '---'].join(this.eol());
  }

  renderSection(section: SectionData): string {
    const level = section.level ?? 2;
    const heading = this.renderHeading(section.name, level);

    let contentBlock = '';
    if (section.content !== undefined && section.content !== null) {
      contentBlock = this.renderSectionContent(section);
    }

    return contentBlock ? `${heading}\n\n${contentBlock}` : heading;
  }

  renderCodeBlock(code: string, language?: string): string {
    const fence = this.opts.codeBlockStyle === 'tilde' ? '~~~' : '```';
    const lang = language ? ` ${language}` : '';
    return `${fence}${lang}\n${code}\n${fence}`;
  }

  renderTable(table: TableData): string {
    const alignmentMap = (align: string | undefined): string => {
      switch (align) {
        case 'left': return ':--';
        case 'center': return ':-:';
        case 'right': return '--:';
        default: return '---';
      }
    };

    const pad = (text: string, width: number, align: string | undefined): string => {
      const stripped = text.replace(/\u001b\[[0-9;]*m/g, '');
      const padding = width - stripped.length;
      if (padding <= 0) return text;
      switch (align) {
        case 'left': return text + ' '.repeat(padding);
        case 'right': return ' '.repeat(padding) + text;
        case 'center': {
          const left = Math.floor(padding / 2);
          return ' '.repeat(left) + text + ' '.repeat(padding - left);
        }
        default: return text + ' '.repeat(padding);
      }
    };

    const headers = table.headers.map((h, i) => {
      const align = table.alignments?.[i];
      const width = Math.max(h.length, ...table.rows.map((r) => (r[i] ?? '').length));
      return pad(h, width, align);
    });

    const sep = table.headers.map((_, i) => alignmentMap(table.alignments?.[i]));

    const dataRows = table.rows.map((row) =>
      row.map((cell, i) => {
        const align = table.alignments?.[i];
        const width = Math.max(table.headers[i]?.length ?? 0, ...table.rows.map((r) => (r[i] ?? '').length));
        return pad(cell, width, align);
      }),
    );

    const lines = [
      `| ${headers.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...dataRows.map((row) => `| ${row.join(' | ')} |`),
    ];

    return lines.join(this.eol());
  }

  renderList(list: ListItem[], depth = 0): string {
    const marker = '  '.repeat(depth) + this.opts.listMarker;
    return list
      .map((item) => {
        let line = `${marker} ${item.text}`;
        if (item.items && item.items.length > 0) {
          line += this.eol() + this.renderList(item.items, depth + 1);
        }
        return line;
      })
      .join(this.eol());
  }

  renderInline(nodes: unknown[]): string {
    return nodes
      .map((node) => {
        const n = node as Record<string, unknown>;
        const value = String(n.value ?? '');
        switch (n.type) {
          case 'bold':
          case 'strong':
            return `**${value}**`;
          case 'italic':
          case 'emphasis':
            return `*${value}*`;
          case 'code':
            return `\`${value}\``;
          case 'link':
            return `[${value}](${String(n.url ?? '#')})`;
          case 'image':
            return `![${value}](${String(n.url ?? '')})`;
          case 'strikethrough':
            return `~~${value}~~`;
          case 'html':
            return value;
          default:
            return value;
        }
      })
      .join('');
  }

  // -----------------------------------------------------------------------
  // TOC
  // -----------------------------------------------------------------------

  generateTOC(sections: SectionData[]): string {
    const maxDepth = this.opts.tocDepth;
    const lines: string[] = ['## Table of Contents', ''];

    for (const section of sections) {
      const level = section.level ?? 2;
      if (level > maxDepth) continue;
      const indent = '  '.repeat(level - 2);
      const anchor = this.slugify(section.name);
      lines.push(`${indent}- [${section.name}](#${anchor})`);
    }

    return lines.join(this.eol());
  }

  // -----------------------------------------------------------------------
  // Document wrapper
  // -----------------------------------------------------------------------

  wrapDocument(body: string): string {
    const eol = this.eol();
    return body.trim() + eol;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  getMimeType(): string {
    return 'text/markdown';
  }

  getExtension(): string {
    return '.md';
  }

  private renderHeading(text: string, level: number): string {
    if (this.opts.headingStyle === 'setext' && level <= 2) {
      const marker = level === 1 ? '=' : '-';
      return `${text}${this.eol()}${marker.repeat(text.length)}`;
    }
    return `${'#'.repeat(level)} ${text}`;
  }

  private renderSectionContent(section: SectionData): string {
    const content = section.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          const node = item as Record<string, unknown>;
          switch (node.type) {
            case 'code':
              return this.renderCodeBlock(String(node.value ?? ''), node.language as string | undefined);
            case 'table':
              return this.renderTable(node as unknown as TableData);
            case 'list':
              return this.renderList(node.items as ListItem[]);
            case 'paragraph':
              return String(node.value ?? '');
            case 'heading':
              return this.renderHeading(String(node.value ?? ''), (node.level as number) ?? 2);
            case 'thematicBreak':
              return '---';
            case 'blockquote':
              return String(node.value ?? '')
                .split('\n')
                .map((l) => `> ${l}`)
                .join(this.eol());
            default:
              return String(node.value ?? JSON.stringify(node));
          }
        })
        .join(this.eol() + this.eol());
    }

    return JSON.stringify(content, null, 2);
  }

  private formatYamlValue(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
      if (/[:{}\[\],&*?|>!%@`#]/.test(value) || value.includes('\n') || value.startsWith(' ') || value.startsWith('"') || value.startsWith("'")) {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return this.eol() + value.map((v) => `  - ${this.formatYamlValue(v)}`).join(this.eol());
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      return this.eol() + entries.map(([k, v]) => `  ${k}: ${this.formatYamlValue(v)}`).join(this.eol());
    }
    return String(value);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private eol(): string {
    return this.opts.lineEnding;
  }
}
