/**
 * MAM Docs Command
 *
 * Full documentation generator with sections, templates, cross-referencing,
 * coverage metrics, link validation, search index, and multi-format output.
 */

import { readFile, writeFile, readdir, mkdir, access, stat } from 'node:fs/promises';
import { resolve, join, basename, extname, relative, dirname } from 'node:path';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export interface DocsOptions {
  file?: string;
  dir?: string;
  outDir?: string;
  format?: 'markdown' | 'html' | 'json' | 'pdf';
  template?: string;
  includePrivate?: boolean;
  includeExamples?: boolean;
  toc?: boolean;
  validate?: boolean;
  search?: boolean;
  coverage?: boolean;
  lang?: string;
  title?: string;
  theme?: string;
}

interface DocSection {
  id: string;
  title: string;
  content: string;
  level: number;
  type: 'text' | 'code' | 'table' | 'list' | 'heading' | 'example' | 'api' | 'note' | 'warning';
  language?: string;
  metadata?: Record<string, unknown>;
}

interface DocPage {
  title: string;
  description: string;
  version: string;
  author: string;
  generatedAt: string;
  sections: DocSection[];
  tableOfContents: TOCEntry[];
  examples: CodeExample[];
  apiDocs: APIDoc[];
  crossReferences: CrossReference[];
  metadata: Record<string, unknown>;
}

interface TOCEntry {
  id: string;
  title: string;
  level: number;
  children: TOCEntry[];
}

interface CodeExample {
  id: string;
  title: string;
  language: string;
  code: string;
  description: string;
  tags: string[];
}

interface APIDoc {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant';
  description: string;
  parameters: APIParameter[];
  returnType: string;
  examples: string[];
  since?: string;
  deprecated?: boolean;
  tags: string[];
}

interface APIParameter {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

interface CrossReference {
  source: string;
  target: string;
  type: 'see-also' | 'extends' | 'implements' | 'uses' | 'depends-on';
  description?: string;
}

interface DocTemplate {
  name: string;
  layout: string[];
  header?: string;
  footer?: string;
  styles?: string;
  partials?: Record<string, string>;
}

interface DocCoverage {
  totalModules: number;
  documentedModules: number;
  totalSections: number;
  documentedSections: number;
  percentage: number;
  undocumentedItems: UndocumentedItem[];
}

interface UndocumentedItem {
  name: string;
  type: 'module' | 'section' | 'parameter' | 'example';
  file: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  type: 'broken-link' | 'missing-section' | 'invalid-example' | 'incomplete-api';
  message: string;
  file?: string;
  line?: number;
}

interface ValidationWarning {
  type: 'missing-description' | 'long-line' | 'deprecated-usage' | 'missing-example';
  message: string;
  file?: string;
}

interface SearchIndex {
  entries: SearchEntry[];
  totalWords: number;
}

interface SearchEntry {
  id: string;
  title: string;
  section: string;
  content: string;
  keywords: string[];
  file: string;
  score: number;
}

// ============================================================================
// Doc Generator
// ============================================================================

class DocGenerator {
  private pages: DocPage[] = [];
  private modules: ModuleInfo[] = [];
  private templates: Map<string, DocTemplate> = new Map();
  private crossReferences: CrossReference[] = [];

  constructor(private options: DocsOptions) {
    this.registerDefaultTemplates();
  }

  async generate(): Promise<void> {
    if (this.options.file) {
      await this.processFile(resolve(this.options.file));
    } else {
      const dir = resolve(this.options.dir || process.cwd());
      await this.processDirectory(dir);
    }

    this.buildCrossReferences();
  }

  private async processFile(filePath: string): Promise<void> {
    const content = await readFile(filePath, 'utf-8');
    const result = parseMAM(content, { source: filePath });

    if (result.errors.length > 0) {
      throw new Error(`Parse errors in ${filePath}: ${result.errors.map(e => e.message).join(', ')}`);
    }

    const page = this.buildDocPage(result.ast, filePath);
    this.pages.push(page);

    this.modules.push({
      name: (result.ast.frontmatter?.data?.name || basename(filePath)) as string,
      file: filePath,
      description: (result.ast.frontmatter?.data?.description || '') as string,
      version: (result.ast.frontmatter?.data?.version || '') as string,
      public: (result.ast.frontmatter?.data?.public ?? true) as boolean,
    });
  }

  private async processDirectory(dir: string): Promise<void> {
    const files = await this.findMAMFiles(dir);
    if (files.length === 0) return;

    for (const file of files) {
      try {
        await this.processFile(file);
      } catch {
        // Skip files with parse errors
      }
    }
  }

  private buildDocPage(ast: any, filePath: string): DocPage {
    const fm = ast.frontmatter?.data || {};
    const sections: DocSection[] = [];
    const examples: CodeExample[] = [];
    const apiDocs: APIDoc[] = [];

    // Parse frontmatter into metadata
    const metadata: Record<string, unknown> = { ...fm };

    // Process sections
    if (ast.sections) {
      for (const section of ast.sections) {
        const sectionId = this.slugify(section.name);

        sections.push({
          id: sectionId,
          title: section.name,
          content: this.extractSectionText(section),
          level: 2,
          type: this.classifySection(section.name),
          metadata: { source: filePath },
        });

        // Extract code examples
        if (section.content) {
          for (const node of section.content) {
            if (node.type === 'codeblock') {
              const example: CodeExample = {
                id: `${sectionId}-example-${examples.length}`,
                title: `${section.name} Example`,
                language: node.language || 'text',
                code: node.value || '',
                description: '',
                tags: this.extractTags(node.value || ''),
              };
              examples.push(example);

              sections.push({
                id: example.id,
                title: example.title,
                content: `\`\`\`${example.language}\n${example.code}\n\`\`\``,
                level: 3,
                type: 'example',
                language: example.language,
              });
            }
          }
        }
      }
    }

    return {
      title: (fm.name || fm.id || basename(filePath, extname(filePath))) as string,
      description: (fm.description || '') as string,
      version: (fm.version || '0.0.0') as string,
      author: (fm.author || 'Unknown') as string,
      generatedAt: new Date().toISOString(),
      sections,
      tableOfContents: this.buildTOC(sections),
      examples,
      apiDocs,
      crossReferences: [],
      metadata,
    };
  }

  private extractSectionText(section: any): string {
    if (!section.content) return '';
    return section.content
      .map((node: any) => {
        if (node.type === 'paragraph') return node.value || '';
        if (node.type === 'list' && node.items) return node.items.map((i: string) => `- ${i}`).join('\n');
        if (node.type === 'codeblock') return `\`\`\`${node.language || ''}\n${node.value || ''}\n\`\`\``;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private classifySection(name: string): DocSection['type'] {
    const lower = name.toLowerCase();
    if (lower.includes('example')) return 'example';
    if (lower.includes('api') || lower.includes('reference')) return 'api';
    if (lower.includes('install') || lower.includes('setup')) return 'heading';
    if (lower.includes('note') || lower.includes('warning')) return 'note';
    return 'text';
  }

  private extractTags(code: string): string[] {
    const tags: string[] = [];
    const tagMatch = code.match(/@tags?\s+(.+)/);
    if (tagMatch) tags.push(...tagMatch[1].split(/[,\s]+/).filter(Boolean));
    return tags;
  }

  private buildTOC(sections: DocSection[]): TOCEntry[] {
    const toc: TOCEntry[] = [];
    const stack: TOCEntry[] = [];

    for (const section of sections) {
      const entry: TOCEntry = {
        id: section.id,
        title: section.title,
        level: section.level,
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        toc.push(entry);
      } else {
        stack[stack.length - 1].children.push(entry);
      }

      stack.push(entry);
    }

    return toc;
  }

  private buildCrossReferences(): void {
    for (const page of this.pages) {
      for (const section of page.sections) {
        // Look for cross-references in content
        const refs = section.content.match(/(?:see|refer to|see also|depends on)\s+(\w+)/gi) || [];
        for (const ref of refs) {
          const target = ref.replace(/^(?:see|refer to|see also|depends on)\s+/i, '').trim();
          this.crossReferences.push({
            source: `${page.title} > ${section.title}`,
            target,
            type: 'see-also',
          });
        }
      }
    }
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private async findMAMFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const scanDir = async (currentDir: string): Promise<void> => {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
            await scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.mam.md') || entry.name.endsWith('.mam'))) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip
      }
    };
    await scanDir(dir);
    return files;
  }

  getPages(): DocPage[] { return this.pages; }
  getModules(): ModuleInfo[] { return this.modules; }
  getCrossReferences(): CrossReference[] { return this.crossReferences; }

  private registerDefaultTemplates(): void {
    this.templates.set('default', {
      name: 'default',
      layout: ['header', 'toc', 'content', 'footer'],
      header: '# {{title}}\n\n{{description}}\n\n**Version:** {{version}} | **Author:** {{author}}\n',
      footer: '\n---\n*Generated at {{generatedAt}} by MAM Docs*\n',
    });

    this.templates.set('minimal', {
      name: 'minimal',
      layout: ['content'],
    });

    this.templates.set('api', {
      name: 'api',
      layout: ['header', 'toc', 'api-reference', 'examples', 'footer'],
      header: '# {{title}} API Reference\n\n{{description}}\n',
      footer: '\n---\n*API Reference generated at {{generatedAt}}*\n',
    });
  }
}

interface ModuleInfo {
  name: string;
  file: string;
  description: string;
  version: string;
  public: boolean;
}

// ============================================================================
// Formatters
// ============================================================================

class MarkdownFormatter {
  static format(pages: DocPage[], options: DocsOptions): string {
    const parts: string[] = [];

    // Title page
    if (pages.length === 1) {
      const page = pages[0];
      parts.push(`# ${page.title}\n`);
      if (page.description) parts.push(`${page.description}\n`);
      parts.push(`**Version:** ${page.version} | **Author:** ${page.author}\n`);

      // Table of contents
      if (options.toc !== false && page.tableOfContents.length > 0) {
        parts.push('## Table of Contents\n');
        for (const entry of page.tableOfContents) {
          parts.push(MarkdownFormatter.renderTOCEntry(entry, 0));
        }
        parts.push('');
      }
    } else {
      parts.push(`# ${options.title || 'Documentation'}\n`);
      if (options.toc !== false) {
        parts.push('## Modules\n');
        for (const page of pages) {
          parts.push(`- [${page.title}](#${MarkdownFormatter.slugify(page.title)}) — ${page.description || 'No description'}`);
        }
        parts.push('');
      }
    }

    // Sections
    for (const page of pages) {
      if (pages.length > 1) {
        parts.push(`## ${page.title}\n`);
        if (page.description) parts.push(`${page.description}\n`);
      }

      for (const section of page.sections) {
        const prefix = '#'.repeat(Math.min(section.level + 1, 6));
        parts.push(`${prefix} ${section.title}\n`);
        parts.push(`${section.content}\n`);
      }

      // Examples
      if (options.includeExamples !== false && page.examples.length > 0) {
        parts.push('### Examples\n');
        for (const example of page.examples) {
          parts.push(`**${example.title}**\n`);
          if (example.description) parts.push(`${example.description}\n`);
          parts.push('```' + example.language);
          parts.push(example.code);
          parts.push('```\n');
        }
      }

      parts.push('');
    }

    // Cross references
    if (pages.length > 1) {
      const allRefs = pages.flatMap(p => p.crossReferences);
      if (allRefs.length > 0) {
        parts.push('## Cross References\n');
        for (const ref of allRefs) {
          parts.push(`- ${ref.source} → ${ref.target} (${ref.type})`);
        }
        parts.push('');
      }
    }

    // Footer
    parts.push(`---\n*Generated at ${new Date().toISOString()} by MAM Docs*\n`);

    return parts.join('\n');
  }

  private static renderTOCEntry(entry: TOCEntry, depth: number): string {
    const indent = '  '.repeat(depth);
    let result = `${indent}- [${entry.title}](#${entry.id})\n`;
    for (const child of entry.children) {
      result += MarkdownFormatter.renderTOCEntry(child, depth + 1);
    }
    return result;
  }

  private static slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

class HTMLFormatter {
  static format(pages: DocPage[], options: DocsOptions): string {
    const themeCSS = HTMLFormatter.getThemeCSS(options.theme);
    const searchScript = options.search ? HTMLFormatter.getSearchScript() : '';

    let html = `<!DOCTYPE html>
<html lang="${options.lang || 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title || 'Documentation'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 900px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 1rem; color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin: 2rem 0 1rem; color: #2c3e50; }
    h3 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; color: #34495e; }
    p { margin-bottom: 1rem; }
    pre { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; padding: 1rem; overflow-x: auto; margin: 1rem 0; }
    code { font-family: 'Monaco', 'Consolas', monospace; font-size: 0.9em; }
    :not(pre) > code { background: #f8f9fa; padding: 0.2em 0.4em; border-radius: 3px; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #dee2e6; padding: 0.75rem; text-align: left; }
    th { background: #f8f9fa; font-weight: 600; }
    .toc { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; padding: 1rem 2rem; margin: 1rem 0; }
    .toc ul { list-style: none; padding-left: 1.5rem; }
    .toc li { margin: 0.25rem 0; }
    .toc a { color: #3498db; text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
    .example { border-left: 3px solid #3498db; padding-left: 1rem; margin: 1rem 0; }
    .note { border-left: 3px solid #f39c12; padding-left: 1rem; margin: 1rem 0; background: #fef9e7; }
    .warning { border-left: 3px solid #e74c3c; padding-left: 1rem; margin: 1rem 0; background: #fdedec; }
    .search-input { width: 100%; padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; font-size: 1rem; margin: 1rem 0; }
    .search-results { border: 1px solid #dee2e6; border-radius: 4px; max-height: 300px; overflow-y: auto; display: none; }
    .search-result { padding: 0.5rem 1rem; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
    .search-result:hover { background: #f8f9fa; }
    .badge { display: inline-block; padding: 0.2em 0.6em; font-size: 0.75rem; font-weight: 600; border-radius: 3px; }
    .badge-version { background: #3498db; color: white; }
    .badge-deprecated { background: #e74c3c; color: white; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e0e0e0; color: #7f8c8d; font-size: 0.9rem; }
    ${themeCSS}
  </style>
</head>
<body>
  <div id="app">
`;

    if (options.search) {
      html += `    <input type="text" class="search-input" placeholder="Search documentation..." id="search-input">
    <div class="search-results" id="search-results"></div>
`;
    }

    for (const page of pages) {
      html += `    <h1>${HTMLFormatter.escape(page.title)}</h1>\n`;
      if (page.description) html += `    <p>${HTMLFormatter.escape(page.description)}</p>\n`;
      html += `    <p><span class="badge badge-version">v${HTMLFormatter.escape(page.version)}</span> | ${HTMLFormatter.escape(page.author)}</p>\n`;

      // TOC
      if (options.toc !== false && page.tableOfContents.length > 0) {
        html += '    <nav class="toc">\n      <h2>Table of Contents</h2>\n      <ul>\n';
        html += HTMLFormatter.renderTOCHTML(page.tableOfContents);
        html += '      </ul>\n    </nav>\n';
      }

      // Sections
      for (const section of page.sections) {
        const tag = `h${Math.min(section.level + 1, 6)}`;
        const sectionClass = section.type === 'note' ? 'note' : section.type === 'warning' ? 'warning' : '';
        html += `    <${tag} id="${section.id}">${HTMLFormatter.escape(section.title)}</${tag}>\n`;
        if (sectionClass) {
          html += `    <div class="${sectionClass}">\n`;
          html += `      ${HTMLFormatter.markdownToHTML(section.content)}\n`;
          html += '    </div>\n';
        } else {
          html += `    ${HTMLFormatter.markdownToHTML(section.content)}\n`;
        }
      }

      // Examples
      if (options.includeExamples !== false && page.examples.length > 0) {
        html += '    <h2>Examples</h2>\n';
        for (const example of page.examples) {
          html += `    <div class="example">\n`;
          html += `      <h3>${HTMLFormatter.escape(example.title)}</h3>\n`;
          if (example.description) html += `      <p>${HTMLFormatter.escape(example.description)}</p>\n`;
          html += `      <pre><code>${HTMLFormatter.escape(example.code)}</code></pre>\n`;
          html += '    </div>\n';
        }
      }
    }

    html += `  </div>
  ${searchScript}
</body>
</html>`;

    return html;
  }

  private static escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private static markdownToHTML(md: string): string {
    let html = md;
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;
    return html;
  }

  private static renderTOCHTML(entries: TOCEntry[]): string {
    let html = '';
    for (const entry of entries) {
      html += `        <li><a href="#${entry.id}">${HTMLFormatter.escape(entry.title)}</a></li>\n`;
      if (entry.children.length > 0) {
        html += '        <ul>\n';
        html += HTMLFormatter.renderTOCHTML(entry.children);
        html += '        </ul>\n';
      }
    }
    return html;
  }

  private static getThemeCSS(theme?: string): string {
    switch (theme) {
      case 'dark': return 'body { background: #1a1a1a; color: #e0e0e0; } pre { background: #2d2d2d; }';
      case 'minimal': return 'body { max-width: 700px; }';
      default: return '';
    }
  }

  private static getSearchScript(): string {
    return `
  <script>
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const entries = ${JSON.stringify([])};
    searchInput?.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      if (!query) { searchResults.style.display = 'none'; return; }
      const matches = entries.filter(e => e.content.toLowerCase().includes(query));
      searchResults.innerHTML = matches.map(m => '<div class="search-result">' + m.title + '</div>').join('');
      searchResults.style.display = matches.length ? 'block' : 'none';
    });
  </script>`;
  }
}

class JSONDocFormatter {
  static format(pages: DocPage[]): string {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      pages: pages.map(p => ({
        title: p.title,
        description: p.description,
        version: p.version,
        author: p.author,
        sections: p.sections.map(s => ({
          id: s.id,
          title: s.title,
          content: s.content,
          type: s.type,
        })),
        tableOfContents: p.tableOfContents,
        examples: p.examples,
        apiDocs: p.apiDocs,
        crossReferences: p.crossReferences,
      })),
    }, null, 2);
  }
}

// ============================================================================
// Documentation Coverage
// ============================================================================

class CoverageAnalyzer {
  static analyze(pages: DocPage[]): DocCoverage {
    const undocumentedItems: UndocumentedItem[] = [];
    let totalSections = 0;
    let documentedSections = 0;

    for (const page of pages) {
      for (const section of page.sections) {
        totalSections++;
        if (section.content && section.content.trim().length > 0) {
          documentedSections++;
        } else {
          undocumentedItems.push({
            name: section.title,
            type: 'section',
            file: section.metadata?.source as string || 'unknown',
          });
        }
      }

      // Check API docs
      for (const api of page.apiDocs) {
        if (!api.description) {
          undocumentedItems.push({
            name: api.name,
            type: 'module',
            file: 'unknown',
          });
        }
      }
    }

    const totalModules = pages.length;
    const documentedModules = pages.filter(p => p.description && p.description.trim().length > 0).length;

    const total = totalSections + totalModules;
    const documented = documentedSections + documentedModules;
    const percentage = total > 0 ? (documented / total) * 100 : 100;

    return {
      totalModules,
      documentedModules,
      totalSections,
      documentedSections,
      percentage,
      undocumentedItems,
    };
  }
}

// ============================================================================
// Link Validator
// ============================================================================

class LinkValidator {
  static validate(pages: DocPage[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const page of pages) {
      // Check for missing descriptions
      if (!page.description) {
        warnings.push({
          type: 'missing-description',
          message: `Module "${page.title}" has no description`,
        });
      }

      // Check sections
      for (const section of page.sections) {
        // Broken internal links
        const links = section.content.match(/\[([^\]]+)\]\(#([^)]+)\)/g) || [];
        for (const link of links) {
          const match = link.match(/\[([^\]]+)\]\(#([^)]+)\)/);
          if (match) {
            const targetId = match[2];
            const exists = page.sections.some(s => s.id === targetId);
            if (!exists) {
              errors.push({
                type: 'broken-link',
                message: `Broken link to #${targetId} in section "${section.title}"`,
              });
            }
          }
        }

        // Empty sections
        if (!section.content || section.content.trim().length === 0) {
          warnings.push({
            type: 'missing-description',
            message: `Section "${section.title}" is empty`,
          });
        }

        // Long lines
        const lines = section.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > 200) {
            warnings.push({
              type: 'long-line',
              message: `Line ${i + 1} in "${section.title}" exceeds 200 characters`,
            });
          }
        }
      }

      // Check for missing examples
      if (page.examples.length === 0) {
        warnings.push({
          type: 'missing-example',
          message: `Module "${page.title}" has no code examples`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// ============================================================================
// Search Index Builder
// ============================================================================

class SearchIndexBuilder {
  static build(pages: DocPage[]): SearchIndex {
    const entries: SearchEntry[] = [];
    let totalWords = 0;

    for (const page of pages) {
      for (const section of page.sections) {
        const words = section.content.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        totalWords += words.length;

        const titleWords = page.title.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        const sectionWords = section.title.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        const keywords = [...new Set([...titleWords, ...sectionWords, ...words.slice(0, 20)])];

        entries.push({
          id: section.id,
          title: section.title,
          section: page.title,
          content: section.content.substring(0, 500),
          keywords,
          file: (section.metadata?.source as string) || 'unknown',
          score: section.level === 2 ? 1.0 : section.level === 3 ? 0.8 : 0.5,
        });
      }
    }

    return { entries, totalWords };
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function docsCommand(options: DocsOptions): Promise<void> {
  const spinner = ora('Generating documentation...').start();

  try {
    const generator = new DocGenerator(options);
    spinner.text = 'Processing modules...';
    await generator.generate();

    const pages = generator.getPages();
    if (pages.length === 0) {
      spinner.warn('No MAM modules found');
      return;
    }

    spinner.text = 'Formatting output...';
    const outDir = resolve(options.outDir || './docs');
    await mkdir(outDir, { recursive: true });

    const format = options.format || 'markdown';
    let output: string;
    let extension: string;

    switch (format) {
      case 'html':
        output = HTMLFormatter.format(pages, options);
        extension = '.html';
        break;
      case 'json':
        output = JSONDocFormatter.format(pages);
        extension = '.json';
        break;
      default:
        output = MarkdownFormatter.format(pages, options);
        extension = '.md';
    }

    const outFile = join(outDir, `index${extension}`);
    await writeFile(outFile, output, 'utf-8');

    spinner.succeed(`Documentation generated: ${outFile}`);

    // Coverage report
    if (options.coverage) {
      const coverage = CoverageAnalyzer.analyze(pages);
      console.log(chalk.cyan('\n  Documentation Coverage:\n'));
      console.log(chalk.gray(`    Modules: ${coverage.documentedModules}/${coverage.totalModules}`));
      console.log(chalk.gray(`    Sections: ${coverage.documentedSections}/${coverage.totalSections}`));
      console.log(chalk.gray(`    Coverage: ${coverage.percentage.toFixed(1)}%`));

      if (coverage.undocumentedItems.length > 0) {
        console.log(chalk.yellow('\n  Undocumented items:'));
        for (const item of coverage.undocumentedItems.slice(0, 10)) {
          console.log(chalk.gray(`    - ${item.name} (${item.type})`));
        }
      }
    }

    // Link validation
    if (options.validate) {
      const validation = LinkValidator.validate(pages);
      if (validation.errors.length > 0) {
        console.log(chalk.red('\n  Validation Errors:'));
        for (const error of validation.errors) {
          console.log(chalk.red(`    [${error.type}] ${error.message}`));
        }
      }
      if (validation.warnings.length > 0) {
        console.log(chalk.yellow('\n  Validation Warnings:'));
        for (const warning of validation.warnings) {
          console.log(chalk.yellow(`    [${warning.type}] ${warning.message}`));
        }
      }
      if (validation.valid && validation.warnings.length === 0) {
        console.log(chalk.green('\n  Documentation validation passed'));
      }
    }

    // Search index
    if (options.search) {
      const searchIndex = SearchIndexBuilder.build(pages);
      const searchFile = join(outDir, 'search-index.json');
      await writeFile(searchFile, JSON.stringify(searchIndex, null, 2), 'utf-8');
      console.log(chalk.gray(`\n  Search index generated: ${searchFile}`));
      console.log(chalk.gray(`  ${searchIndex.entries.length} entries, ${searchIndex.totalWords} words indexed`));
    }

    // Summary
    console.log(chalk.gray(`\n  ${pages.length} module(s) documented`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  DocGenerator,
  MarkdownFormatter,
  HTMLFormatter,
  JSONDocFormatter,
  CoverageAnalyzer,
  LinkValidator,
  SearchIndexBuilder,
};
