/**
 * HTML Output Formatter
 *
 * Full HTML5 output with theming, table of contents, syntax-highlighted
 * code blocks, responsive tables, and semantic markup.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HTMLOutputOptions {
  /** Document title. */
  title?: string;
  /** Built-in theme name or custom CSS string. */
  theme?: 'default' | 'dark' | 'github' | 'minimal' | 'print' | string;
  /** Additional CSS to inject in a <style> tag. */
  css?: string;
  /** Additional scripts to inject before </body>. */
  scripts?: string[];
  /** Show a navigation sidebar. */
  navigation?: boolean;
  /** Enable code block highlighting via CSS classes. */
  codeHighlight?: boolean;
  /** Auto-generate a table of contents. */
  tableOfContents?: boolean;
  /** HTML lang attribute. */
  lang?: string;
  /** Max heading level for TOC generation. */
  tocDepth?: number;
}

interface SectionData {
  name: string;
  content?: unknown;
  level?: number;
  id?: string;
  type?: string;
  language?: string;
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

const DEFAULT_OPTIONS: Required<HTMLOutputOptions> = {
  title: 'MAM Module',
  theme: 'default',
  css: '',
  scripts: [],
  navigation: false,
  codeHighlight: true,
  tableOfContents: false,
  lang: 'en',
  tocDepth: 3,
};

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export class HTMLOutput {
  private opts: Required<HTMLOutputOptions>;

  constructor(options?: HTMLOutputOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  // -----------------------------------------------------------------------
  // Core
  // -----------------------------------------------------------------------

  format(data: unknown): string {
    const doc = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const fm = (doc.frontmatter ?? doc.meta ?? {}) as FrontmatterData;
    const sections = ((doc.sections ?? []) as SectionData[]).filter(Boolean);

    const bodyParts: string[] = [];

    if (Object.keys(fm).length > 0) {
      bodyParts.push(this.renderFrontmatter(fm));
    }

    if (this.opts.tableOfContents && sections.length > 0) {
      bodyParts.push(this.generateTOC(sections));
    }

    bodyParts.push(this.formatSections(sections));

    const body = bodyParts.join('\n\n');
    return this.wrapDocument(body, this.opts);
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
    const rows = Object.entries(data)
      .map(
        ([key, value]) =>
          `        <tr>\n          <th>${this.escapeHtml(key)}</th>\n          <td>${this.escapeHtml(String(value ?? ''))}</td>\n        </tr>`,
      )
      .join('\n');

    return `    <aside class="frontmatter">
      <table>
        <thead><tr><th colspan="2">Metadata</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </aside>`;
  }

  renderSection(section: SectionData): string {
    const level = section.level ?? 2;
    const id = section.id ?? this.slugify(section.name);
    const tag = `h${level}`;

    let contentHtml = '';
    if (section.content !== undefined && section.content !== null) {
      contentHtml = this.renderSectionContent(section);
    }

    return `    <section id="${this.escapeHtml(id)}" data-type="${this.escapeHtml(section.type ?? 'default')}">
      <${tag}>${this.escapeHtml(section.name)}</${tag}>
${contentHtml}
    </section>`;
  }

  renderCodeBlock(code: string, language?: string): string {
    const langAttr = language ? ` data-language="${this.escapeHtml(language)}"` : '';
    const langLabel = language
      ? `<span class="code-lang">${this.escapeHtml(language)}</span>`
      : '';

    return `    <div class="code-block"${langAttr}>
      ${langLabel}
      <pre><code class="${language ? `language-${this.escapeHtml(language)}` : ''}">${this.escapeHtml(code)}</code></pre>
    </div>`;
  }

  renderTable(table: TableData): string {
    const alignmentMap = (align: string | undefined) => {
      switch (align) {
        case 'left': return ' style="text-align:left"';
        case 'center': return ' style="text-align:center"';
        case 'right': return ' style="text-align:right"';
        default: return '';
      }
    };

    const headerRow = table.headers
      .map((h, i) => {
        const align = table.alignments?.[i];
        return `          <th${alignmentMap(align)}>${this.escapeHtml(h)}</th>`;
      })
      .join('\n');

    const bodyRows = table.rows
      .map((row) => {
        const cells = row
          .map((cell, i) => {
            const align = table.alignments?.[i];
            return `            <td${alignmentMap(align)}>${this.escapeHtml(cell)}</td>`;
          })
          .join('\n');
        return `          <tr>\n${cells}\n          </tr>`;
      })
      .join('\n');

    return `    <div class="table-wrap">
      <table>
        <thead>
          <tr>
${headerRow}
          </tr>
        </thead>
        <tbody>
${bodyRows}
        </tbody>
      </table>
    </div>`;
  }

  renderList(list: ListItem[], ordered = false): string {
    const tag = ordered ? 'ol' : 'ul';
    const items = list
      .map((item) => {
        let inner = this.escapeHtml(item.text);
        if (item.items && item.items.length > 0) {
          inner += `\n${this.renderList(item.items, ordered)}`;
        }
        return `        <li>\n          ${inner}\n        </li>`;
      })
      .join('\n');

    return `    <${tag}>\n${items}\n    </${tag}>`;
  }

  renderDiagram(mermaid: string): string {
    return `    <div class="diagram">
      <pre class="mermaid">${this.escapeHtml(mermaid)}</pre>
    </div>`;
  }

  renderInline(nodes: unknown[]): string {
    return nodes
      .map((node) => {
        const n = node as Record<string, unknown>;
        const value = String(n.value ?? '');
        switch (n.type) {
          case 'bold':
          case 'strong':
            return `<strong>${this.escapeHtml(value)}</strong>`;
          case 'italic':
          case 'emphasis':
            return `<em>${this.escapeHtml(value)}</em>`;
          case 'code':
            return `<code>${this.escapeHtml(value)}</code>`;
          case 'link': {
            const href = this.escapeHtml(String(n.url ?? '#'));
            return `<a href="${href}">${this.escapeHtml(value)}</a>`;
          }
          case 'image': {
            const src = this.escapeHtml(String(n.url ?? ''));
            return `<img src="${src}" alt="${this.escapeHtml(value)}" />`;
          }
          case 'strikethrough':
            return `<del>${this.escapeHtml(value)}</del>`;
          default:
            return this.escapeHtml(value);
        }
      })
      .join('');
  }

  // -----------------------------------------------------------------------
  // TOC
  // -----------------------------------------------------------------------

  generateTOC(sections: SectionData[]): string {
    const maxDepth = this.opts.tocDepth;
    const items: string[] = [];

    for (const section of sections) {
      const level = section.level ?? 2;
      if (level > maxDepth) continue;
      const indent = '    ' + '  '.repeat(level - 2);
      const id = this.slugify(section.name);
      items.push(`${indent}<li><a href="#${this.escapeHtml(id)}">${this.escapeHtml(section.name)}</a></li>`);
    }

    if (items.length === 0) return '';

    return `    <nav class="toc" aria-label="Table of Contents">
      <h2>Table of Contents</h2>
      <ul>
${items.join('\n')}
      </ul>
    </nav>`;
  }

  // -----------------------------------------------------------------------
  // Document wrapper
  // -----------------------------------------------------------------------

  wrapDocument(body: string, options?: HTMLOutputOptions): string {
    const opts = { ...this.opts, ...options };
    const css = this.generateCSS(opts.theme);
    const scripts = opts.scripts.map((s) => `    <script>${s}</script>`).join('\n');

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(opts.lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(opts.title)}</title>
  <style>
${css}
${opts.css}
  </style>
</head>
<body>
${body}
${scripts}
</body>
</html>`;
  }

  // -----------------------------------------------------------------------
  // CSS
  // -----------------------------------------------------------------------

  generateCSS(theme: string): string {
    const base = `
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 52rem; margin: 0 auto; padding: 2rem 1rem; color: #1a1a1a; background: #fff; }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
    h1 { font-size: 2rem; } h2 { font-size: 1.5rem; } h3 { font-size: 1.25rem; }
    pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 1rem; overflow-x: auto; font-size: 0.875rem; }
    code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.875em; }
    :not(pre) > code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e1e4e8; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    .frontmatter { background: #f8f9fb; border: 1px solid #e1e4e8; border-radius: 6px; padding: 1rem; margin-bottom: 2rem; }
    .frontmatter th { width: 30%; }
    .code-block { margin: 1rem 0; position: relative; }
    .code-lang { position: absolute; top: 0.5rem; right: 0.5rem; font-size: 0.75rem; color: #6a737d; }
    .toc { background: #f8f9fb; border: 1px solid #e1e4e8; border-radius: 6px; padding: 1rem 1.5rem; margin-bottom: 2rem; }
    .toc ul { margin: 0; padding-left: 1.25rem; }
    .toc li { margin: 0.25rem 0; }
    .diagram { background: #f8f9fb; border: 1px solid #e1e4e8; border-radius: 6px; padding: 1rem; margin: 1rem 0; overflow-x: auto; }
    section { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #e1e4e8; }
    section:last-child { border-bottom: none; }
    img { max-width: 100%; height: auto; }
    a { color: #0366d6; }
    .table-wrap { overflow-x: auto; margin: 1rem 0; }`;

    switch (theme) {
      case 'dark':
        return base + `
    body { background: #0d1117; color: #c9d1d9; }
    th { background: #161b22; }
    pre, .code-block { background: #161b22; border-color: #30363d; }
    :not(pre) > code { background: #161b22; }
    .frontmatter, .toc, .diagram { background: #161b22; border-color: #30363d; }
    th, td { border-color: #30363d; }
    a { color: #58a6ff; }`;

      case 'github':
        return base + `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; }`;

      case 'minimal':
        return `
    body { font-family: Georgia, serif; max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.8; color: #333; }
    pre { background: #fafafa; border-left: 3px solid #333; padding: 0.75rem 1rem; }
    code { font-family: 'Courier New', monospace; }
    table { border: 1px solid #ccc; }`;

      case 'print':
        return base + `
    body { max-width: none; padding: 0; font-size: 12pt; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
    section { page-break-inside: avoid; }`;

      default:
        return base;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getMimeType(): string {
    return 'text/html';
  }

  getExtension(): string {
    return '.html';
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private renderSectionContent(section: SectionData): string {
    const content = section.content;

    if (typeof content === 'string') {
      return `      <div class="section-content">${content}</div>`;
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
              return this.renderList(node.items as ListItem[], node.ordered as boolean);
            case 'diagram':
              return this.renderDiagram(String(node.value ?? ''));
            case 'paragraph':
              return `      <p>${this.escapeHtml(String(node.value ?? ''))}</p>`;
            default:
              return `      <div>${this.escapeHtml(String(node.value ?? JSON.stringify(node)))}</div>`;
          }
        })
        .join('\n');
    }

    return `      <pre>${this.escapeHtml(JSON.stringify(content, null, 2))}</pre>`;
  }
}
