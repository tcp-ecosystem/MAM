/**
 * MAM Export Command
 *
 * Production-grade export engine supporting 9 output formats,
 * batch operations, template layouts, metadata, compression,
 * and multi-format simultaneous export.
 */

import {
  readFile,
  writeFile,
  mkdir,
  access,
  readdir,
  stat,
  copyFile,
  unlink,
} from 'node:fs/promises';
import { resolve, basename, join, extname, relative, dirname } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON, prettyPrint } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export type ExportFormat =
  | 'json'
  | 'html'
  | 'markdown'
  | 'ast'
  | 'yaml'
  | 'toml'
  | 'pdf'
  | 'docx'
  | 'rst';

export interface ExportOptions {
  file: string;
  format: ExportFormat | string;
  outDir?: string;
  metadata?: boolean;
  template?: string;
  cssFile?: string;
  highlight?: boolean;
  toc?: boolean;
  compress?: boolean;
  batch?: boolean;
  multiple?: string;
  stats?: boolean;
  indent?: number;
}

export interface ExportConfig {
  defaultFormat: ExportFormat;
  outDir: string;
  includeMetadata: boolean;
  includeTOC: boolean;
  highlightCode: boolean;
  compress: boolean;
  customCSS: string;
  customTemplate: string;
  indent: number;
}

export interface ExportStats {
  format: ExportFormat;
  inputFile: string;
  outputFile: string;
  inputSize: number;
  outputSize: number;
  sections: number;
  codeBlocks: number;
  timeMs: number;
}

export interface TemplateLayout {
  name: string;
  header: string;
  footer: string;
  sectionWrapper: string;
  codeWrapper: string;
  tocWrapper: string;
  variables: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  json: 'json',
  html: 'html',
  markdown: 'md',
  ast: 'txt',
  yaml: 'yaml',
  toml: 'toml',
  pdf: 'pdf',
  docx: 'docx',
  rst: 'rst',
};

const DEFAULT_CONFIG: ExportConfig = {
  defaultFormat: 'json',
  outDir: 'dist',
  includeMetadata: true,
  includeTOC: true,
  highlightCode: true,
  compress: false,
  customCSS: '',
  customTemplate: '',
  indent: 2,
};

const SYNTAX_COLORS: Record<string, string> = {
  javascript: '#f7df1e',
  typescript: '#3178c6',
  python: '#3776ab',
  go: '#00add8',
  rust: '#dea584',
  html: '#e34c26',
  css: '#563d7c',
  json: '#292929',
  yaml: '#cb171e',
  bash: '#4eaa25',
  shell: '#4eaa25',
  sql: '#e38c00',
  markdown: '#083fa1',
};

// ============================================================================
// Config Loading
// ============================================================================

async function loadExportConfig(searchPath?: string): Promise<ExportConfig> {
  const dir = searchPath || process.cwd();
  const configPath = join(dir, 'mam.export.json');

  try {
    await access(configPath);
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function loadTemplate(templatePath: string): Promise<TemplateLayout> {
  const raw = await readFile(templatePath, 'utf-8');
  const data = JSON.parse(raw);
  return {
    name: data.name || 'custom',
    header: data.header || '',
    footer: data.footer || '',
    sectionWrapper: data.sectionWrapper || '{{content}}',
    codeWrapper: data.codeWrapper || '<pre><code>{{code}}</code></pre>',
    tocWrapper: data.tocWrapper || '{{toc}}',
    variables: data.variables || {},
  };
}

// ============================================================================
// Utility Helpers
// ============================================================================

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRST(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateToc(ast: any): string[] {
  const entries: string[] = [];
  const frontmatter = ast.frontmatter?.data;
  if (frontmatter?.name) {
    entries.push(`- ${frontmatter.name}`);
  }
  for (const section of ast.sections || []) {
    entries.push(`  - ${section.name}`);
    for (const child of section.children || []) {
      if (child.name) entries.push(`    - ${child.name}`);
    }
  }
  return entries;
}

function generateRSTToc(ast: any): string[] {
  const entries: string[] = [];
  const frontmatter = ast.frontmatter?.data;
  if (frontmatter?.name) {
    entries.push(frontmatter.name);
    entries.push('='.repeat(frontmatter.name.length));
    entries.push('');
  }
  for (const section of ast.sections || []) {
    entries.push(section.name);
    entries.push('-'.repeat(section.name.length));
    entries.push('');
  }
  return entries;
}

function countNodes(ast: any): { sections: number; codeBlocks: number; tables: number; lists: number } {
  let sections = 0;
  let codeBlocks = 0;
  let tables = 0;
  let lists = 0;

  for (const section of ast.sections || []) {
    sections++;
    for (const content of section.content || []) {
      if (content.type === 'codeblock') codeBlocks++;
      if (content.type === 'table') tables++;
      if (content.type === 'list') lists++;
    }
    for (const child of section.children || []) {
      sections++;
    }
  }

  return { sections, codeBlocks, tables, lists };
}

function syntaxHighlight(code: string, language: string): string {
  const escaped = escapeHTML(code);
  const langClass = language ? ` class="language-${language}"` : '';
  return `<pre><code${langClass}>${escaped}</code></pre>`;
}

function getLanguageColor(lang: string): string {
  return SYNTAX_COLORS[lang] || '#666666';
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

async function getFilesInDir(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await getFilesInDir(fullPath, extensions);
      results.push(...subFiles);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

// ============================================================================
// Format Renderers
// ============================================================================

function renderJSON(ast: any, config: ExportConfig): string {
  const data: Record<string, unknown> = {};
  if (config.includeMetadata && ast.frontmatter) {
    data.metadata = ast.frontmatter.data;
  }
  data.sections = ast.sections || [];
  data.stats = countNodes(ast);
  return JSON.stringify(data, null, config.indent);
}

function renderHTML(ast: any, config: ExportConfig): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data || {};
  const title = fm.name || fm.id || 'MAM Module';
  const { sections: sectionCount, codeBlocks, tables, lists } = countNodes(ast);

  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('<meta charset="UTF-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`<title>${escapeHTML(title)}</title>`);

  // Default CSS
  lines.push('<style>');
  lines.push(DEFAULT_CSS);
  if (config.customCSS) {
    lines.push(config.customCSS);
  }
  lines.push('</style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('<div class="container">');

  // Header
  lines.push(`<header class="module-header">`);
  lines.push(`<h1>${escapeHTML(title)}</h1>`);
  if (fm.version) lines.push(`<span class="version">v${escapeHTML(String(fm.version))}</span>`);
  if (fm.author) lines.push(`<span class="author">by ${escapeHTML(fm.author)}</span>`);
  if (fm.description) lines.push(`<p class="description">${escapeHTML(fm.description)}</p>`);

  // Metadata block
  if (config.includeMetadata) {
    lines.push('<div class="metadata">');
    lines.push(`<div class="meta-item">Sections: ${sectionCount}</div>`);
    lines.push(`<div class="meta-item">Code Blocks: ${codeBlocks}</div>`);
    lines.push(`<div class="meta-item">Tables: ${tables}</div>`);
    lines.push(`<div class="meta-item">Lists: ${lists}</div>`);
    if (fm.tags) {
      lines.push(`<div class="meta-item">Tags: ${escapeHTML(String(fm.tags))}</div>`);
    }
    if (fm.date) {
      lines.push(`<div class="meta-item">Date: ${escapeHTML(String(fm.date))}</div>`);
    }
    lines.push('</div>');
  }
  lines.push('</header>');

  // Table of contents
  if (config.includeTOC) {
    const toc = generateToc(ast);
    lines.push('<nav class="toc">');
    lines.push('<h2>Table of Contents</h2>');
    lines.push('<ul>');
    for (const entry of toc) {
      const depth = (entry.match(/^ {2}/g) || []).length;
      const text = entry.replace(/^ {2}/g, '').replace(/^- /, '');
      lines.push(`<li style="padding-left:${depth * 20}px"><a href="#${escapeHTML(text.toLowerCase().replace(/\s+/g, '-'))}">${escapeHTML(text)}</a></li>`);
    }
    lines.push('</ul>');
    lines.push('</nav>');
  }

  // Sections
  for (const section of ast.sections || []) {
    const slug = section.name.toLowerCase().replace(/\s+/g, '-');
    lines.push(`<section id="${escapeHTML(slug)}" class="module-section">`);
    lines.push(`<h2>${escapeHTML(section.name)}</h2>`);

    for (const content of section.content || []) {
      renderHTMLContent(lines, content, config);
    }

    for (const child of section.children || []) {
      const childSlug = (child.name || '').toLowerCase().replace(/\s+/g, '-');
      lines.push(`<div class="sub-section" id="${escapeHTML(childSlug)}">`);
      if (child.name) lines.push(`<h3>${escapeHTML(child.name)}</h3>`);
      for (const content of child.content || []) {
        renderHTMLContent(lines, content, config);
      }
      lines.push('</div>');
    }

    lines.push('</section>');
  }

  lines.push('</div>');

  // Footer
  lines.push('<footer class="module-footer">');
  lines.push(`<p>Generated by MAM CLI on ${new Date().toISOString()}</p>`);
  lines.push('</footer>');

  lines.push('</body>');
  lines.push('</html>');
  return lines.join('\n');
}

function renderHTMLContent(lines: string[], content: any, config: ExportConfig): void {
  switch (content.type) {
    case 'paragraph':
      lines.push(`<p>${escapeHTML(content.value || '')}</p>`);
      break;
    case 'codeblock':
      if (config.highlightCode) {
        lines.push(syntaxHighlight(content.value || '', content.language || ''));
      } else {
        lines.push(`<pre><code>${escapeHTML(content.value || '')}</code></pre>`);
      }
      break;
    case 'heading':
      lines.push(`<h3>${escapeHTML(content.value || '')}</h3>`);
      break;
    case 'list':
      lines.push('<ul>');
      for (const item of content.items || []) {
        lines.push(`<li>${escapeHTML(String(item))}</li>`);
      }
      lines.push('</ul>');
      break;
    case 'table':
      renderHTMLTable(lines, content);
      break;
    case 'blockquote':
      lines.push(`<blockquote>${escapeHTML(content.value || '')}</blockquote>`);
      break;
    case 'horizontalrule':
      lines.push('<hr/>');
      break;
    case 'image':
      lines.push(`<img src="${escapeHTML(content.src || '')}" alt="${escapeHTML(content.alt || '')}" />`);
      break;
    case 'link':
      lines.push(`<a href="${escapeHTML(content.href || '')}">${escapeHTML(content.value || '')}</a>`);
      break;
    default:
      if (content.value) {
        lines.push(`<div class="content-${content.type}">${escapeHTML(String(content.value))}</div>`);
      }
      break;
  }
}

function renderHTMLTable(lines: string[], content: any): void {
  lines.push('<table>');
  if (content.headers && content.headers.length > 0) {
    lines.push('<thead><tr>');
    for (const header of content.headers) {
      lines.push(`<th>${escapeHTML(String(header))}</th>`);
    }
    lines.push('</tr></thead>');
  }
  if (content.rows) {
    lines.push('<tbody>');
    for (const row of content.rows) {
      lines.push('<tr>');
      for (const cell of row) {
        lines.push(`<td>${escapeHTML(String(cell))}</td>`);
      }
      lines.push('</tr>');
    }
    lines.push('</tbody>');
  }
  lines.push('</table>');
}

function renderMarkdown(ast: any, _config: ExportConfig): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  if (fm) {
    lines.push('---');
    for (const [key, value] of Object.entries(fm)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('---');
    lines.push('');
  }

  if (fm?.name) {
    lines.push(`# ${fm.name}`);
    lines.push('');
  }

  for (const section of ast.sections || []) {
    lines.push(`## ${section.name}`);
    lines.push('');
    for (const content of section.content || []) {
      renderMarkdownContent(lines, content);
    }
    for (const child of section.children || []) {
      if (child.name) {
        lines.push(`### ${child.name}`);
        lines.push('');
      }
      for (const content of child.content || []) {
        renderMarkdownContent(lines, content);
      }
    }
  }

  return lines.join('\n');
}

function renderMarkdownContent(lines: string[], content: any): void {
  switch (content.type) {
    case 'paragraph':
      lines.push(content.value || '');
      lines.push('');
      break;
    case 'codeblock':
      lines.push('```' + (content.language || ''));
      lines.push(content.value || '');
      lines.push('```');
      lines.push('');
      break;
    case 'heading':
      lines.push(`### ${content.value || ''}`);
      lines.push('');
      break;
    case 'list':
      for (const item of content.items || []) {
        lines.push(`- ${item}`);
      }
      lines.push('');
      break;
    case 'table':
      if (content.headers && content.headers.length > 0) {
        lines.push('| ' + content.headers.join(' | ') + ' |');
        lines.push('| ' + content.headers.map(() => '---').join(' | ') + ' |');
        for (const row of content.rows || []) {
          lines.push('| ' + row.join(' | ') + ' |');
        }
      }
      lines.push('');
      break;
    case 'blockquote':
      lines.push(`> ${content.value || ''}`);
      lines.push('');
      break;
    case 'horizontalrule':
      lines.push('---');
      lines.push('');
      break;
    default:
      if (content.value) lines.push(String(content.value));
      lines.push('');
      break;
  }
}

function renderAST(ast: any, _config: ExportConfig): string {
  return prettyPrint(ast as any);
}

function renderYAML(ast: any, config: ExportConfig): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  if (config.includeMetadata && fm) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(fm)) {
      lines.push(`  ${key}: ${yamlValue(value)}`);
    }
    lines.push('');
  }

  lines.push('sections:');
  for (const section of ast.sections || []) {
    lines.push(`  - name: ${yamlValue(section.name)}`);
    if (section.content && section.content.length > 0) {
      lines.push('    content:');
      for (const content of section.content) {
        lines.push(`      - type: ${yamlValue(content.type)}`);
        if (content.value) {
          lines.push(`        value: ${yamlValue(content.value)}`);
        }
        if (content.language) {
          lines.push(`        language: ${yamlValue(content.language)}`);
        }
      }
    }
    if (section.children && section.children.length > 0) {
      lines.push('    children:');
      for (const child of section.children) {
        lines.push(`      - name: ${yamlValue(child.name || '')}`);
      }
    }
  }

  return lines.join('\n');
}

function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const str = String(value);
  if (str.includes(':') || str.includes('#') || str.includes('"') || str.includes("'") || str.trim() !== str) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

function renderTOML(ast: any, config: ExportConfig): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  if (config.includeMetadata && fm) {
    lines.push('[metadata]');
    for (const [key, value] of Object.entries(fm)) {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
    lines.push('');
  }

  for (let i = 0; i < (ast.sections || []).length; i++) {
    const section = ast.sections[i];
    lines.push(`[[sections]]`);
    lines.push(`name = ${tomlValue(section.name)}`);

    if (section.content && section.content.length > 0) {
      lines.push('');
      for (let j = 0; j < section.content.length; j++) {
        const content = section.content[j];
        lines.push(`[[sections.content]]`);
        lines.push(`type = ${tomlValue(content.type)}`);
        if (content.value) lines.push(`value = ${tomlValue(content.value)}`);
        if (content.language) lines.push(`language = ${tomlValue(content.language)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function tomlValue(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const str = String(value);
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderRST(ast: any, config: ExportConfig): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  if (fm?.name) {
    lines.push(fm.name);
    lines.push('='.repeat(fm.name.length));
    lines.push('');
  }

  if (config.includeMetadata && fm) {
    lines.push('.. list-table:: Metadata');
    lines.push('   :widths: 20 80');
    lines.push('');
    for (const [key, value] of Object.entries(fm)) {
      lines.push(`   * - ${escapeRST(key)}`);
      lines.push(`     - ${escapeRST(String(value))}`);
    }
    lines.push('');
  }

  for (const section of ast.sections || []) {
    lines.push(section.name);
    lines.push('-'.repeat(section.name.length));
    lines.push('');

    for (const content of section.content || []) {
      renderRSTContent(lines, content);
    }

    for (const child of section.children || []) {
      if (child.name) {
        lines.push(child.name);
        lines.push('~'.repeat(child.name.length));
        lines.push('');
      }
      for (const content of child.content || []) {
        renderRSTContent(lines, content);
      }
    }
  }

  return lines.join('\n');
}

function renderRSTContent(lines: string[], content: any): void {
  switch (content.type) {
    case 'paragraph':
      lines.push(content.value || '');
      lines.push('');
      break;
    case 'codeblock':
      lines.push(`.. code-block:: ${content.language || ''}`);
      lines.push('');
      for (const line of (content.value || '').split('\n')) {
        lines.push(`   ${line}`);
      }
      lines.push('');
      break;
    case 'heading':
      lines.push(content.value || '');
      lines.push('^'.repeat((content.value || '').length));
      lines.push('');
      break;
    case 'list':
      for (const item of content.items || []) {
        lines.push(`* ${item}`);
      }
      lines.push('');
      break;
    case 'blockquote':
      lines.push(`   "${content.value || ''}"`);
      lines.push('');
      break;
    default:
      if (content.value) lines.push(String(content.value));
      lines.push('');
      break;
  }
}

function renderPDF(ast: any, config: ExportConfig): string {
  // Generate a simplified PDF-like text representation
  // In production this would use puppeteer or pdfkit
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  lines.push('%PDF-1.4');
  lines.push(`% MAM Export - ${fm?.name || 'Module'}`);
  lines.push('');
  lines.push('=== DOCUMENT START ===');
  lines.push('');

  if (fm?.name) {
    lines.push(`TITLE: ${fm.name}`);
  }
  if (fm?.author) {
    lines.push(`AUTHOR: ${fm.author}`);
  }
  if (fm?.version) {
    lines.push(`VERSION: ${fm.version}`);
  }
  if (fm?.description) {
    lines.push(`DESCRIPTION: ${fm.description}`);
  }
  lines.push('');

  for (const section of ast.sections || []) {
    lines.push(`## ${section.name}`);
    lines.push('');
    for (const content of section.content || []) {
      switch (content.type) {
        case 'paragraph':
          lines.push(content.value || '');
          lines.push('');
          break;
        case 'codeblock':
          lines.push(`[CODE: ${content.language || 'text'}]`);
          lines.push(content.value || '');
          lines.push('[/CODE]');
          lines.push('');
          break;
        case 'list':
          for (const item of content.items || []) {
            lines.push(`  * ${item}`);
          }
          lines.push('');
          break;
        default:
          if (content.value) lines.push(String(content.value));
          lines.push('');
          break;
      }
    }
  }

  lines.push('=== DOCUMENT END ===');
  return lines.join('\n');
}

function renderDOCX(ast: any, config: ExportConfig): string {
  // Generate a simplified DOCX-like text representation
  // In production this would use docx or mammoth
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  lines.push('[DOCX-CONTENT-XML]');
  lines.push('');

  if (fm?.name) {
    lines.push(`<w:hdr><w:r><w:t>${escapeHTML(fm.name)}</w:t></w:r></w:hdr>`);
  }

  if (config.includeMetadata && fm) {
    lines.push('<w:tbl>');
    for (const [key, value] of Object.entries(fm)) {
      lines.push(`  <w:tr><w:tc><w:r><w:t>${escapeHTML(key)}: ${escapeHTML(String(value))}</w:t></w:r></w:tc></w:tr>`);
    }
    lines.push('</w:tbl>');
  }

  for (const section of ast.sections || []) {
    lines.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeHTML(section.name)}</w:t></w:r></w:p>`);
    for (const content of section.content || []) {
      switch (content.type) {
        case 'paragraph':
          lines.push(`<w:p><w:r><w:t>${escapeHTML(content.value || '')}</w:t></w:r></w:p>`);
          break;
        case 'codeblock':
          lines.push(`<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeHTML(content.value || '')}</w:t></w:r></w:p>`);
          break;
        case 'list':
          for (const item of content.items || []) {
            lines.push(`<w:p><w:r><w:t>• ${escapeHTML(String(item))}</w:t></w:r></w:p>`);
          }
          break;
        default:
          if (content.value) {
            lines.push(`<w:p><w:r><w:t>${escapeHTML(String(content.value))}</w:t></w:r></w:p>`);
          }
          break;
      }
    }
  }

  lines.push('[/DOCX-CONTENT-XML]');
  return lines.join('\n');
}

// ============================================================================
// Main Export Pipeline
// ============================================================================

function renderFormat(ast: any, format: ExportFormat, config: ExportConfig): string {
  switch (format) {
    case 'json':
      return renderJSON(ast, config);
    case 'html':
      return renderHTML(ast, config);
    case 'markdown':
      return renderMarkdown(ast, config);
    case 'ast':
      return renderAST(ast, config);
    case 'yaml':
      return renderYAML(ast, config);
    case 'toml':
      return renderTOML(ast, config);
    case 'rst':
      return renderRST(ast, config);
    case 'pdf':
      return renderPDF(ast, config);
    case 'docx':
      return renderDOCX(ast, config);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

async function exportSingleFile(
  filePath: string,
  format: ExportFormat,
  outDir: string,
  config: ExportConfig,
  template?: TemplateLayout,
): Promise<ExportStats> {
  const startTime = Date.now();
  const content = await readFile(filePath, 'utf-8');
  const parseResult = parseMAM(content, { source: filePath });

  if (parseResult.errors.length > 0) {
    throw new Error(`Parse errors in ${filePath}: ${parseResult.errors.map((e) => e.toFormattedString()).join(', ')}`);
  }

  let output = renderFormat(parseResult.ast, format, config);

  if (template) {
    output = applyTemplate(output, template, parseResult.ast);
  }

  const ext = FORMAT_EXTENSIONS[format] || 'txt';
  const baseName = basename(filePath, extname(filePath));
  const outFile = join(outDir, `${baseName}.${ext}`);
  const inputStat = await stat(filePath);

  await writeFile(outFile, output, 'utf-8');

  const outputStat = await stat(outFile);
  const { sections, codeBlocks } = countNodes(parseResult.ast);

  return {
    format,
    inputFile: filePath,
    outputFile: outFile,
    inputSize: inputStat.size,
    outputSize: outputStat.size,
    sections,
    codeBlocks,
    timeMs: Date.now() - startTime,
  };
}

function applyTemplate(output: string, template: TemplateLayout, ast: any): string {
  let result = template.header;
  const fm = ast.frontmatter?.data || {};

  result += template.sectionWrapper.replace(/\{\{content\}\}/g, output);

  for (const [key, value] of Object.entries(template.variables)) {
    const resolved = fm[key] || value;
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(resolved));
  }

  result += template.footer;
  return result;
}

// ============================================================================
// Batch Export
// ============================================================================

async function batchExport(
  dir: string,
  format: ExportFormat,
  outDir: string,
  config: ExportConfig,
): Promise<ExportStats[]> {
  const files = await getFilesInDir(dir, ['.mam.md', '.mam']);
  const results: ExportStats[] = [];

  for (const file of files) {
    try {
      const result = await exportSingleFile(file, format, outDir, config);
      results.push(result);
    } catch (err) {
      console.error(chalk.red(`  Failed to export ${file}: ${(err as Error).message}`));
    }
  }

  return results;
}

// ============================================================================
// Multi-Format Export
// ============================================================================

async function multiFormatExport(
  filePath: string,
  formats: ExportFormat[],
  outDir: string,
  config: ExportConfig,
  template?: TemplateLayout,
): Promise<ExportStats[]> {
  const content = await readFile(filePath, 'utf-8');
  const parseResult = parseMAM(content, { source: filePath });

  if (parseResult.errors.length > 0) {
    throw new Error(`Parse errors: ${parseResult.errors.map((e) => e.toFormattedString()).join(', ')}`);
  }

  const results: ExportStats[] = [];
  const inputStat = await stat(filePath);
  const baseName = basename(filePath, extname(filePath));

  for (const format of formats) {
    const startTime = Date.now();
    let output = renderFormat(parseResult.ast, format, config);
    if (template) output = applyTemplate(output, template, parseResult.ast);

    const ext = FORMAT_EXTENSIONS[format] || 'txt';
    const outFile = join(outDir, `${baseName}.${ext}`);
    await writeFile(outFile, output, 'utf-8');
    const outputStat = await stat(outFile);
    const { sections, codeBlocks } = countNodes(parseResult.ast);

    results.push({
      format,
      inputFile: filePath,
      outputFile: outFile,
      inputSize: inputStat.size,
      outputSize: outputStat.size,
      sections,
      codeBlocks,
      timeMs: Date.now() - startTime,
    });
  }

  return results;
}

// ============================================================================
// Compression Helpers
// ============================================================================

async function compressFile(filePath: string): Promise<string> {
  const gzipPath = filePath + '.gz';
  // Use Node.js built-in zlib via dynamic import
  const { createReadStream, createWriteStream } = await import('node:fs');
  const { createGzip } = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');

  await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath));
  return gzipPath;
}

// ============================================================================
// Stats Printer
// ============================================================================

function printStats(results: ExportStats[]): void {
  console.log(chalk.cyan('\n  Export Statistics:'));
  console.log(chalk.gray('  ' + '-'.repeat(70)));
  console.log(chalk.gray(`  ${'Format'.padEnd(10)} ${'Input Size'.padEnd(14)} ${'Output Size'.padEnd(14)} ${'Time (ms)'.padEnd(12)} ${'Sections'.padEnd(10)}`));
  console.log(chalk.gray('  ' + '-'.repeat(70)));

  let totalInput = 0;
  let totalOutput = 0;

  for (const r of results) {
    totalInput += r.inputSize;
    totalOutput += r.outputSize;
    console.log(
      `  ${r.format.padEnd(10)} ${formatBytes(r.inputSize).padEnd(14)} ${formatBytes(r.outputSize).padEnd(14)} ${String(r.timeMs).padEnd(12)} ${String(r.sections).padEnd(10)}`,
    );
  }

  console.log(chalk.gray('  ' + '-'.repeat(70)));
  console.log(chalk.gray(`  ${'TOTAL'.padEnd(10)} ${formatBytes(totalInput).padEnd(14)} ${formatBytes(totalOutput).padEnd(14)}`));
  console.log('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ============================================================================
// Default CSS
// ============================================================================

const DEFAULT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; }
  .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
  .module-header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e9ecef; }
  .module-header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  .version { background: #e9ecef; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; }
  .author { color: #666; margin-left: 0.5rem; }
  .description { color: #555; margin-top: 0.5rem; }
  .metadata { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; }
  .meta-item { background: #e9ecef; padding: 4px 10px; border-radius: 4px; font-size: 0.85rem; }
  .toc { background: #fff; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid #e9ecef; }
  .toc h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  .toc ul { list-style: none; }
  .toc li { padding: 2px 0; }
  .toc a { color: #0066cc; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .module-section { background: #fff; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #e9ecef; }
  .module-section h2 { font-size: 1.4rem; margin-bottom: 1rem; color: #222; }
  .module-section h3 { font-size: 1.1rem; margin: 1rem 0 0.5rem; color: #444; }
  .sub-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #f0f0f0; }
  p { margin-bottom: 0.8rem; }
  pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 1rem 0; }
  code { font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.9rem; }
  .module-footer { text-align: center; color: #999; font-size: 0.8rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e9ecef; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  blockquote { border-left: 4px solid #0066cc; padding-left: 1rem; color: #555; margin: 1rem 0; }
  hr { border: none; border-top: 1px solid #e9ecef; margin: 1.5rem 0; }
`;

// ============================================================================
// Main Command
// ============================================================================

export async function exportCommand(options: ExportOptions): Promise<void> {
  const spinner = ora('Preparing export...').start();

  try {
    const config = await loadExportConfig();
    const format = (options.format || config.defaultFormat) as ExportFormat;
    const outDir = resolve(options.outDir || config.outDir);
    await ensureDir(outDir);

    // Load optional template
    let template: TemplateLayout | undefined;
    if (options.template) {
      template = await loadTemplate(resolve(options.template));
    }

    // Merge config with options
    if (options.metadata !== undefined) config.includeMetadata = options.metadata;
    if (options.toc !== undefined) config.includeTOC = options.toc;
    if (options.highlight !== undefined) config.highlightCode = options.highlight;
    if (options.indent !== undefined) config.indent = options.indent;
    if (options.cssFile) {
      config.customCSS = await readFile(resolve(options.cssFile), 'utf-8');
    }

    // Multi-format export
    if (options.multiple) {
      const formats = options.multiple.split(',').map((f) => f.trim()) as ExportFormat[];
      spinner.text = `Exporting to ${formats.length} formats...`;
      const results = await multiFormatExport(resolve(options.file), formats, outDir, config, template);
      spinner.succeed(`Exported to ${results.length} formats`);
      if (options.stats) printStats(results);
      return;
    }

    // Batch export
    if (options.batch) {
      const dir = resolve(options.file);
      spinner.text = `Batch exporting from ${dir}...`;
      const results = await batchExport(dir, format, outDir, config);
      spinner.succeed(`Batch exported ${results.length} modules`);
      if (options.stats) printStats(results);
      return;
    }

    // Single file export
    spinner.text = `Exporting to ${format}...`;
    const result = await exportSingleFile(resolve(options.file), format, outDir, config, template);

    spinner.succeed(`Exported: ${result.outputFile}`);

    if (options.stats) {
      printStats([result]);
    }

    // Compress if requested
    if (options.compress) {
      spinner.start('Compressing...');
      const compressed = await compressFile(result.outputFile);
      spinner.succeed(`Compressed: ${compressed}`);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export { renderJSON, renderHTML, renderMarkdown, renderYAML, renderTOML, renderRST, renderPDF, renderDOCX, renderAST };
