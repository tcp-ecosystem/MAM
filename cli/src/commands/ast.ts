/**
 * MAM AST Command
 *
 * Full AST explorer with tree visualization, node filtering,
 * AST diff, statistics, serialization, search, and manipulation.
 */

import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, basename, join, extname } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON, prettyPrint, getASTStats } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export type ASTFormat = 'json' | 'compact' | 'pretty' | 'tree' | 'stats';

export interface ASTOptions {
  file: string;
  format?: ASTFormat | string;
  indent?: number;
  filter?: string;
  search?: string;
  depth?: number;
  diff?: string;
  export?: string;
  transform?: string;
  verbose?: boolean;
  path?: string;
}

export interface ASTNodeInfo {
  type: string;
  name?: string;
  value?: string;
  depth: number;
  path: string;
  children: ASTNodeInfo[];
  sourceLocation?: SourceLocation;
  metadata: Record<string, unknown>;
}

export interface SourceLocation {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

export interface ASTStatistics {
  totalNodes: number;
  totalSections: number;
  totalCodeBlocks: number;
  totalTables: number;
  totalLists: number;
  totalParagraphs: number;
  totalHeadings: number;
  totalLinks: number;
  totalImages: number;
  totalBlockquotes: number;
  totalHorizontalRules: number;
  maxDepth: number;
  avgDepth: number;
  languages: string[];
  nodeTypeDistribution: Record<string, number>;
  complexityScore: number;
  parseTimeMs: number;
  totalTokens: number;
  totalLines: number;
}

export interface ASTDiffResult {
  added: ASTDiffEntry[];
  removed: ASTDiffEntry[];
  modified: ASTDiffEntry[];
  unchanged: ASTDiffEntry[];
  stats: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    unchangedCount: number;
  };
}

export interface ASTDiffEntry {
  path: string;
  type: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface SearchResult {
  path: string;
  type: string;
  name?: string;
  value?: string;
  depth: number;
  line: number;
  column: number;
  context: string;
}

export interface TransformPreview {
  original: string;
  transformed: string;
  changes: string[];
  description: string;
}

// ============================================================================
// AST Tree Builder
// ============================================================================

function buildASTTree(ast: any, maxDepth: number = Infinity): ASTNodeInfo {
  const root: ASTNodeInfo = {
    type: 'Document',
    depth: 0,
    path: '',
    children: [],
    metadata: {},
  };

  if (ast.frontmatter) {
    root.metadata = ast.frontmatter.data || {};
    root.children.push({
      type: 'Frontmatter',
      name: 'frontmatter',
      depth: 1,
      path: 'frontmatter',
      children: [],
      metadata: ast.frontmatter.data || {},
    });
  }

  for (let i = 0; i < (ast.sections || []).length; i++) {
    const section = ast.sections[i];
    root.children.push(buildSectionNode(section, i, 1, maxDepth));
  }

  return root;
}

function buildSectionNode(section: any, index: number, depth: number, maxDepth: number): ASTNodeInfo {
  const node: ASTNodeInfo = {
    type: 'Section',
    name: section.name,
    depth,
    path: `sections[${index}]`,
    children: [],
    metadata: { index },
  };

  if (depth >= maxDepth) return node;

  for (let i = 0; i < (section.content || []).length; i++) {
    const content = section.content[i];
    node.children.push(buildContentNode(content, i, depth + 1, maxDepth, `sections[${index}].content[${i}]`));
  }

  for (let i = 0; i < (section.children || []).length; i++) {
    const child = section.children[i];
    node.children.push(buildSectionNode(child, index, depth + 1, maxDepth));
  }

  return node;
}

function buildContentNode(content: any, index: number, depth: number, maxDepth: number, path: string): ASTNodeInfo {
  const node: ASTNodeInfo = {
    type: content.type || 'Unknown',
    value: content.value,
    depth,
    path,
    children: [],
    metadata: {},
  };

  if (content.language) node.metadata.language = content.language;
  if (content.items) node.metadata.itemCount = content.items.length;
  if (content.headers) node.metadata.headerCount = content.headers.length;
  if (content.rows) node.metadata.rowCount = content.rows.length;
  if (content.src) node.metadata.src = content.src;
  if (content.alt) node.metadata.alt = content.alt;
  if (content.href) node.metadata.href = content.href;

  return node;
}

// ============================================================================
// Tree Renderer
// ============================================================================

function renderTree(node: ASTNodeInfo, isLast: boolean = true, prefix: string = '', showValues: boolean = false): string {
  const lines: string[] = [];
  const connector = isLast ? '└── ' : '├── ';
  const extension = isLast ? '    ' : '│   ';

  let label = `${connector}${chalk.yellow(node.type)}`;
  if (node.name) label += ` ${chalk.cyan(node.name)}`;
  if (showValues && node.value) {
    const truncated = node.value.length > 60 ? node.value.substring(0, 57) + '...' : node.value;
    label += ` ${chalk.gray(`"${truncated}"`)}`;
  }

  const metaEntries = Object.entries(node.metadata);
  if (metaEntries.length > 0) {
    label += chalk.gray(` {${metaEntries.map(([k, v]) => `${k}:${v}`).join(', ')}}`);
  }

  lines.push(prefix + label);

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childIsLast = i === node.children.length - 1;
    lines.push(renderTree(child, childIsLast, prefix + extension, showValues));
  }

  return lines.join('\n');
}

// ============================================================================
// Node Filter
// ============================================================================

function filterNodes(
  node: ASTNodeInfo,
  predicate: (node: ASTNodeInfo) => boolean,
): ASTNodeInfo[] {
  const results: ASTNodeInfo[] = [];

  if (predicate(node)) results.push(node);

  for (const child of node.children) {
    results.push(...filterNodes(child, predicate));
  }

  return results;
}

function parseFilter(filterStr: string): (node: ASTNodeInfo) => boolean {
  const parts = filterStr.split(':');
  const key = parts[0];
  const value = parts.slice(1).join(':');

  return (node: ASTNodeInfo) => {
    switch (key) {
      case 'type':
        return node.type.toLowerCase() === value.toLowerCase();
      case 'name':
        return (node.name || '').toLowerCase().includes(value.toLowerCase());
      case 'depth':
        return node.depth === parseInt(value, 10);
      case 'has-value':
        return !!node.value;
      case 'value-contains':
        return (node.value || '').toLowerCase().includes(value.toLowerCase());
      case 'has-children':
        return node.children.length > 0;
      case 'leaf':
        return node.children.length === 0;
      default:
        return true;
    }
  };
}

// ============================================================================
// Node Search
// ============================================================================

function searchNodes(root: ASTNodeInfo, query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  function walk(node: ASTNodeInfo): void {
    if (
      (node.type && node.type.toLowerCase().includes(lowerQuery)) ||
      (node.name && node.name.toLowerCase().includes(lowerQuery)) ||
      (node.value && node.value.toLowerCase().includes(lowerQuery))
    ) {
      results.push({
        path: node.path,
        type: node.type,
        name: node.name,
        value: node.value,
        depth: node.depth,
        line: 0,
        column: 0,
        context: node.value ? node.value.substring(0, 80) : node.name || node.type,
      });
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  return results;
}

// ============================================================================
// AST Statistics Calculator
// ============================================================================

function calculateStatistics(ast: any, parseResult: any): ASTStatistics {
  const dist: Record<string, number> = {};
  let maxDepth = 0;
  let totalDepth = 0;
  let nodeCount = 0;
  let totalParagraphs = 0;
  let totalHeadings = 0;
  let totalLinks = 0;
  let totalImages = 0;
  let totalBlockquotes = 0;
  let totalHorizontalRules = 0;
  const langs = new Set<string>();

  function countNode(node: any, depth: number): void {
    if (!node || typeof node !== 'object') return;

    const type = node.type || node.kind || 'unknown';
    dist[type] = (dist[type] || 0) + 1;
    nodeCount++;

    if (depth > maxDepth) maxDepth = depth;
    totalDepth += depth;

    if (type === 'paragraph') totalParagraphs++;
    if (type === 'heading' || type === 'h1' || type === 'h2' || type === 'h3') totalHeadings++;
    if (type === 'link') totalLinks++;
    if (type === 'image') totalImages++;
    if (type === 'blockquote') totalBlockquotes++;
    if (type === 'horizontalrule' || type === 'hr') totalHorizontalRules++;
    if (node.language) langs.add(node.language);

    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key])) {
        for (const item of node[key]) {
          if (typeof item === 'object' && item !== null) {
            countNode(item, depth + 1);
          }
        }
      }
    }
  }

  // Count frontmatter
  if (ast.frontmatter) {
    dist['Frontmatter'] = 1;
    nodeCount++;
  }

  for (const section of ast.sections || []) {
    countNode(section, 1);
  }

  const baseStats = getASTStats(ast as any);

  return {
    totalNodes: nodeCount,
    totalSections: baseStats.totalSections,
    totalCodeBlocks: baseStats.totalCodeBlocks,
    totalTables: baseStats.totalTables,
    totalLists: baseStats.totalLists,
    totalParagraphs,
    totalHeadings,
    totalLinks,
    totalImages,
    totalBlockquotes,
    totalHorizontalRules,
    maxDepth,
    avgDepth: nodeCount > 0 ? totalDepth / nodeCount : 0,
    languages: Array.from(langs),
    nodeTypeDistribution: dist,
    complexityScore: calculateComplexity(dist),
    parseTimeMs: parseResult.stats.parseTimeMs,
    totalTokens: parseResult.stats.totalTokens,
    totalLines: parseResult.stats.totalLines,
  };
}

function calculateComplexity(dist: Record<string, number>): number {
  let score = 0;
  const weights: Record<string, number> = {
    codeblock: 3,
    table: 4,
    list: 2,
    paragraph: 1,
    heading: 1,
    link: 1,
    image: 1,
    blockquote: 1,
    section: 2,
    frontmatter: 1,
  };

  for (const [type, count] of Object.entries(dist)) {
    score += count * (weights[type] || 1);
  }

  return Math.round(score * 10) / 10;
}

// ============================================================================
// AST Diff Engine
// ============================================================================

function diffASTs(ast1: any, ast2: any): ASTDiffResult {
  const added: ASTDiffEntry[] = [];
  const removed: ASTDiffEntry[] = [];
  const modified: ASTDiffEntry[] = [];
  const unchanged: ASTDiffEntry[] = [];

  // Diff sections
  const sections1 = ast1.sections || [];
  const sections2 = ast2.sections || [];
  const maxSections = Math.max(sections1.length, sections2.length);

  for (let i = 0; i < maxSections; i++) {
    const s1 = sections1[i];
    const s2 = sections2[i];
    const path = `sections[${i}]`;

    if (!s1) {
      added.push({ path, type: 'Section', newValue: s2.name });
      continue;
    }
    if (!s2) {
      removed.push({ path, type: 'Section', oldValue: s1.name });
      continue;
    }

    if (s1.name !== s2.name) {
      modified.push({ path, type: 'Section.name', oldValue: s1.name, newValue: s2.name });
    }

    const content1 = s1.content || [];
    const content2 = s2.content || [];
    const maxContent = Math.max(content1.length, content2.length);

    for (let j = 0; j < maxContent; j++) {
      const c1 = content1[j];
      const c2 = content2[j];
      const cPath = `${path}.content[${j}]`;

      if (!c1) {
        added.push({ path: cPath, type: c2?.type || 'Content', newValue: c2?.value });
        continue;
      }
      if (!c2) {
        removed.push({ path: cPath, type: c1.type || 'Content', oldValue: c1.value });
        continue;
      }

      if (JSON.stringify(c1) === JSON.stringify(c2)) {
        unchanged.push({ path: cPath, type: c1.type || 'Content' });
      } else {
        modified.push({
          path: cPath,
          type: c1.type || 'Content',
          oldValue: c1.value,
          newValue: c2.value,
        });
      }
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged,
    stats: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: unchanged.length,
    },
  };
}

// ============================================================================
// AST Transform Preview
// ============================================================================

const TRANSFORMS: Record<string, (ast: any) => { result: any; description: string }> = {
  'strip-metadata': (ast) => ({
    result: { ...ast, frontmatter: null },
    description: 'Remove frontmatter metadata from the AST',
  }),
  'flatten-sections': (ast) => {
    const flat: any[] = [];
    function flatten(sections: any[]): void {
      for (const s of sections || []) {
        flat.push({ name: s.name, content: s.content || [] });
        flatten(s.children || []);
      }
    }
    flatten(ast.sections || []);
    return { result: { ...ast, sections: flat }, description: 'Flatten nested sections into a single level' };
  },
  'extract-code': (ast) => {
    const codeBlocks: any[] = [];
    function walk(sections: any[]): void {
      for (const s of sections || []) {
        for (const c of s.content || []) {
          if (c.type === 'codeblock') {
            codeBlocks.push(c);
          }
        }
        walk(s.children || []);
      }
    }
    walk(ast.sections || []);
    return { result: { sections: [{ name: 'Code Blocks', content: codeBlocks }] }, description: 'Extract all code blocks into a single section' };
  },
  'sort-sections': (ast) => {
    const sorted = [...(ast.sections || [])].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
    return { result: { ...ast, sections: sorted }, description: 'Sort sections alphabetically by name' };
  },
  'summary-only': (ast) => {
    const summary: any[] = [];
    for (const s of ast.sections || []) {
      const firstParagraph = (s.content || []).find((c: any) => c.type === 'paragraph');
      if (firstParagraph) {
        summary.push({ name: s.name, content: [firstParagraph] });
      }
    }
    return { result: { ...ast, sections: summary }, description: 'Keep only the first paragraph of each section' };
  },
};

function previewTransform(ast: any, transformName: string): TransformPreview {
  const transform = TRANSFORMS[transformName];
  if (!transform) {
    return {
      original: prettyPrint(ast as any),
      transformed: `Unknown transform: ${transformName}. Available: ${Object.keys(TRANSFORMS).join(', ')}`,
      changes: [],
      description: `Unknown transform: ${transformName}`,
    };
  }

  const { result, description } = transform(ast);
  const originalStr = prettyPrint(ast as any);
  const transformedStr = prettyPrint(result as any);

  const changes: string[] = [];
  if (originalStr !== transformedStr) {
    changes.push(`Transform applied: ${description}`);
  }

  return {
    original: originalStr,
    transformed: transformedStr,
    changes,
    description,
  };
}

// ============================================================================
// Compact Serializer
// ============================================================================

function serializeCompact(ast: any): string {
  const lines: string[] = [];

  if (ast.frontmatter?.data) {
    const fm = ast.frontmatter.data;
    if (fm.name) lines.push(`@name ${fm.name}`);
    if (fm.id) lines.push(`@id ${fm.id}`);
    if (fm.version) lines.push(`@version ${fm.version}`);
    if (fm.author) lines.push(`@author ${fm.author}`);
    lines.push('');
  }

  for (const section of ast.sections || []) {
    lines.push(`## ${section.name}`);
    for (const content of section.content || []) {
      switch (content.type) {
        case 'paragraph':
          lines.push(`  > ${content.value || ''}`);
          break;
        case 'codeblock':
          lines.push(`  \`\`\`${content.language || ''}`);
          lines.push(`  ${(content.value || '').split('\n').join('\n  ')}`);
          lines.push('  ```');
          break;
        case 'list':
          for (const item of content.items || []) {
            lines.push(`  - ${item}`);
          }
          break;
        case 'table':
          lines.push('  [TABLE]');
          break;
        default:
          if (content.value) lines.push(`  ${content.type}: ${content.value}`);
          break;
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Path Resolver
// ============================================================================

function resolveByPath(ast: any, pathStr: string): any {
  const parts = pathStr.split(/[.\[\]]+/).filter(Boolean);
  let current: any = ast;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (/^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = current[part];
    }
  }

  return current;
}

// ============================================================================
// Stats Formatter
// ============================================================================

function formatStatistics(stats: ASTStatistics, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(chalk.cyan('\n  AST Statistics'));
  lines.push(chalk.gray('  ' + '='.repeat(50)));

  lines.push(chalk.white('  Nodes'));
  lines.push(chalk.gray(`    Total:        ${stats.totalNodes}`));
  lines.push(chalk.gray(`    Max Depth:    ${stats.maxDepth}`));
  lines.push(chalk.gray(`    Avg Depth:    ${stats.avgDepth.toFixed(2)}`));
  lines.push('');

  lines.push(chalk.white('  Content'));
  lines.push(chalk.gray(`    Sections:     ${stats.totalSections}`));
  lines.push(chalk.gray(`    Code Blocks:  ${stats.totalCodeBlocks}`));
  lines.push(chalk.gray(`    Tables:       ${stats.totalTables}`));
  lines.push(chalk.gray(`    Lists:        ${stats.totalLists}`));
  lines.push(chalk.gray(`    Paragraphs:   ${stats.totalParagraphs}`));
  lines.push(chalk.gray(`    Headings:     ${stats.totalHeadings}`));
  lines.push(chalk.gray(`    Links:        ${stats.totalLinks}`));
  lines.push(chalk.gray(`    Images:       ${stats.totalImages}`));
  lines.push(chalk.gray(`    Blockquotes:  ${stats.totalBlockquotes}`));
  lines.push('');

  lines.push(chalk.white('  Parse Info'));
  lines.push(chalk.gray(`    Tokens:       ${stats.totalTokens}`));
  lines.push(chalk.gray(`    Lines:        ${stats.totalLines}`));
  lines.push(chalk.gray(`    Parse Time:   ${stats.parseTimeMs.toFixed(2)}ms`));
  lines.push(chalk.gray(`    Complexity:   ${stats.complexityScore}`));

  if (stats.languages.length > 0) {
    lines.push('');
    lines.push(chalk.white('  Languages'));
    for (const lang of stats.languages) {
      lines.push(chalk.gray(`    - ${lang}`));
    }
  }

  if (verbose) {
    lines.push('');
    lines.push(chalk.white('  Node Type Distribution'));
    const sorted = Object.entries(stats.nodeTypeDistribution).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted) {
      const bar = '█'.repeat(Math.min(Math.ceil(count / Math.max(...sorted.map((s) => s[1])) * 20), 20));
      lines.push(chalk.gray(`    ${type.padEnd(20)} ${String(count).padStart(5)} ${chalk.cyan(bar)}`));
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Diff Formatter
// ============================================================================

function formatDiff(diff: ASTDiffResult): string {
  const lines: string[] = [];

  lines.push(chalk.cyan('\n  AST Diff Results'));
  lines.push(chalk.gray('  ' + '='.repeat(50)));
  lines.push(chalk.green(`  Added:      ${diff.stats.addedCount}`));
  lines.push(chalk.red(`  Removed:    ${diff.stats.removedCount}`));
  lines.push(chalk.yellow(`  Modified:   ${diff.stats.modifiedCount}`));
  lines.push(chalk.gray(`  Unchanged:  ${diff.stats.unchangedCount}`));
  lines.push('');

  if (diff.added.length > 0) {
    lines.push(chalk.green('  + Added:'));
    for (const entry of diff.added) {
      lines.push(chalk.green(`    + ${entry.path} (${entry.type}) ${entry.newValue || ''}`));
    }
  }

  if (diff.removed.length > 0) {
    lines.push(chalk.red('  - Removed:'));
    for (const entry of diff.removed) {
      lines.push(chalk.red(`    - ${entry.path} (${entry.type}) ${entry.oldValue || ''}`));
    }
  }

  if (diff.modified.length > 0) {
    lines.push(chalk.yellow('  ~ Modified:'));
    for (const entry of diff.modified) {
      lines.push(chalk.yellow(`    ~ ${entry.path} (${entry.type})`));
      if (entry.oldValue) lines.push(chalk.red(`      - ${String(entry.oldValue).substring(0, 60)}`));
      if (entry.newValue) lines.push(chalk.green(`      + ${String(entry.newValue).substring(0, 60)}`));
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Main Command
// ============================================================================

export async function astCommand(options: ASTOptions): Promise<void> {
  const spinner = ora('Parsing module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of parseResult.errors) {
        console.error(chalk.red(error.toFormattedString()));
      }
      process.exit(1);
    }

    spinner.stop();

    const format = (options.format || 'pretty') as ASTFormat;
    const indent = options.indent || 2;

    // Diff mode
    if (options.diff) {
      const diffFilePath = resolve(options.diff);
      const diffContent = await readFile(diffFilePath, 'utf-8');
      const diffResult = parseMAM(diffContent, { source: diffFilePath });

      if (diffResult.errors.length > 0) {
        console.error(chalk.red(`Failed to parse diff target: ${diffResult.errors.map((e) => e.toFormattedString()).join(', ')}`));
        process.exit(1);
      }

      const diff = diffASTs(parseResult.ast as any, diffResult.ast as any);
      console.log(formatDiff(diff));
      return;
    }

    // Search mode
    if (options.search) {
      const tree = buildASTTree(parseResult.ast as any);
      const results = searchNodes(tree, options.search);

      if (results.length === 0) {
        console.log(chalk.yellow(`No nodes matching "${options.search}"`));
      } else {
        console.log(chalk.cyan(`\nFound ${results.length} nodes matching "${options.search}":\n`));
        for (const r of results) {
          console.log(`  ${chalk.yellow(r.type)} ${chalk.cyan(r.name || '')} @ ${chalk.gray(r.path)}`);
          if (r.context) console.log(chalk.gray(`    ${r.context}`));
        }
      }
      return;
    }

    // Filter mode
    if (options.filter) {
      const tree = buildASTTree(parseResult.ast as any, options.depth || Infinity);
      const predicate = parseFilter(options.filter);
      const matches = filterNodes(tree, predicate);

      if (matches.length === 0) {
        console.log(chalk.yellow(`No nodes matching filter "${options.filter}"`));
      } else {
        console.log(chalk.cyan(`\nFound ${matches.length} nodes matching filter "${options.filter}":\n`));
        for (const node of matches) {
          const indentStr = '  '.repeat(node.depth);
          console.log(`${indentStr}${chalk.yellow(node.type)} ${chalk.cyan(node.name || '')} ${chalk.gray(node.path)}`);
        }
      }
      return;
    }

    // Transform preview
    if (options.transform) {
      const preview = previewTransform(parseResult.ast, options.transform);
      console.log(chalk.cyan(`\nTransform: ${preview.description}\n`));
      console.log(chalk.gray('Original:'));
      console.log(preview.original.substring(0, 200) + '...');
      console.log(chalk.gray('\nTransformed:'));
      console.log(preview.transformed.substring(0, 200) + '...');
      if (preview.changes.length > 0) {
        console.log(chalk.yellow('\nChanges:'));
        for (const change of preview.changes) {
          console.log(chalk.yellow(`  - ${change}`));
        }
      }
      return;
    }

    // Export mode
    if (options.export) {
      const exportPath = resolve(options.export);
      let output: string;

      switch (format) {
        case 'json':
          output = serializeToJSON(parseResult.ast as any);
          break;
        case 'compact':
          output = serializeCompact(parseResult.ast);
          break;
        case 'tree':
          const tree = buildASTTree(parseResult.ast as any, options.depth || Infinity);
          output = renderTree(tree);
          break;
        default:
          output = prettyPrint(parseResult.ast as any);
      }

      await writeFile(exportPath, output, 'utf-8');
      console.log(chalk.green(`AST exported to ${exportPath}`));
      return;
    }

    // Path-specific view
    if (options.path) {
      const node = resolveByPath(parseResult.ast, options.path);
      if (node) {
        console.log(JSON.stringify(node, null, indent));
      } else {
        console.error(chalk.red(`Path not found: ${options.path}`));
        process.exit(1);
      }
      return;
    }

    // Standard output modes
    switch (format) {
      case 'json':
        console.log(serializeToJSON(parseResult.ast as any));
        break;

      case 'compact':
        console.log(serializeCompact(parseResult.ast));
        break;

      case 'tree': {
        const tree = buildASTTree(parseResult.ast as any, options.depth || Infinity);
        console.log(chalk.cyan('\nAST Tree:\n'));
        console.log(renderTree(tree, true, '', true));
        break;
      }

      case 'stats': {
        const stats = calculateStatistics(parseResult.ast, parseResult);
        console.log(formatStatistics(stats, options.verbose || false));
        break;
      }

      case 'pretty':
      default:
        console.log(chalk.cyan('\nAST Structure:\n'));
        console.log(prettyPrint(parseResult.ast as any));
        break;
    }

    // Always show parse stats at the end
    console.log(chalk.gray(`\nParse time: ${parseResult.stats.parseTimeMs.toFixed(2)}ms`));
    console.log(chalk.gray(`Tokens: ${parseResult.stats.totalTokens}`));
    console.log(chalk.gray(`Lines: ${parseResult.stats.totalLines}`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export {
  buildASTTree,
  filterNodes,
  searchNodes,
  diffASTs,
  calculateStatistics,
  previewTransform,
  renderTree,
  serializeCompact,
  resolveByPath,
  TRANSFORMS,
};
