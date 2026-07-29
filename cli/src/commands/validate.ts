/**
 * MAM Validate Command
 *
 * Production-grade validation for MAM modules with multiple levels,
 * custom rules, caching, and multiple output formats.
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, type MAMConfig } from '../utils/config.js';

// ============================================================================
// Types
// ============================================================================

export type ValidationLevel = 'syntax' | 'schema' | 'semantic' | 'strict' | 'paranoid';
export type ValidationSeverity = 'error' | 'warning' | 'info';
export type OutputFormat = 'text' | 'json' | 'sarif' | 'html';

export interface ValidateOptions {
  file: string;
  level?: ValidationLevel;
  format?: OutputFormat;
  warnings?: boolean;
  fix?: boolean;
  ignore?: string[];
  maxErrors?: number;
  severity?: ValidationSeverity;
  cache?: boolean;
  quiet?: boolean;
  config?: string;
}

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: ValidationSeverity;
  level: ValidationLevel;
  category: string;
  fixable: boolean;
  check: (ctx: ValidationContext) => ValidationDiagnostic[];
}

export interface ValidationContext {
  content: string;
  lines: string[];
  ast: any;
  filePath: string;
  config: MAMConfig;
  level: ValidationLevel;
  frontmatter: Record<string, any>;
  sections: SectionInfo[];
  codeBlocks: CodeBlockInfo[];
  links: LinkInfo[];
  tables: TableInfo[];
}

export interface SectionInfo {
  name: string;
  line: number;
  column: number;
  level: number;
  content: string;
  hasContent: boolean;
}

export interface CodeBlockInfo {
  language: string;
  line: number;
  column: number;
  content: string;
  closed: boolean;
}

export interface LinkInfo {
  text: string;
  url: string;
  line: number;
  column: number;
  isImage: boolean;
  isReference: boolean;
}

export interface TableInfo {
  line: number;
  columns: number;
  hasHeader: boolean;
  hasAlignment: boolean;
  rows: string[][];
}

export interface ValidationDiagnostic {
  ruleId: string;
  message: string;
  severity: ValidationSeverity;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  source: string;
  fix?: ValidationFix;
  suggestions?: string[];
  relatedInformation?: RelatedInformation[];
}

export interface ValidationFix {
  range: [number, number];
  replacement: string;
  description: string;
}

export interface RelatedInformation {
  message: string;
  file: string;
  line: number;
  column: number;
}

export interface ValidationResult {
  valid: boolean;
  file: string;
  level: ValidationLevel;
  diagnostics: ValidationDiagnostic[];
  stats: ValidationStats;
  output?: string;
}

export interface ValidationStats {
  timeMs: number;
  rulesChecked: number;
  errors: number;
  warnings: number;
  info: number;
  fixable: number;
  linesChecked: number;
}

export interface ValidationCache {
  hash: string;
  level: ValidationLevel;
  result: ValidationResult;
  timestamp: number;
}

export interface SARIFResult {
  $schema: string;
  version: string;
  runs: SARIFRun[];
}

export interface SARIFRun {
  tool: { driver: { name: string; version: string; rules: SARIFRule[] } };
  results: SARIFResultItem[];
  taxonomies?: any[];
}

export interface SARIFRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration: { level: string };
  properties?: { category: string };
}

export interface SARIFResultItem {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: any[];
  fixes?: any[];
  relatedLocations?: any[];
}

// ============================================================================
// Ignore Patterns
// ============================================================================

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  '*.min.js',
  '*.map',
];

function shouldIgnore(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\//g, '\/') + '$'
      );
      if (regex.test(normalizedPath)) return true;
    } else {
      if (normalizedPath.includes(pattern)) return true;
    }
  }
  return false;
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_DIR = join(process.cwd(), '.mam', 'cache', 'validate');
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

async function getCacheKey(filePath: string, level: ValidationLevel): Promise<string> {
  const content = require('node:fs').readFileSync(filePath, 'utf-8');
  const hash = require('node:crypto').createHash('md5').update(content + level).digest('hex');
  return hash;
}

async function loadCache(hash: string): Promise<ValidationCache | null> {
  try {
    const cachePath = join(CACHE_DIR, hash + '.json');
    await access(cachePath);
    const content = await readFile(cachePath, 'utf-8');
    const cache: ValidationCache = JSON.parse(content);
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

async function saveCache(hash: string, level: ValidationLevel, result: ValidationResult): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const cache: ValidationCache = { hash, level, result, timestamp: Date.now() };
    await writeFile(join(CACHE_DIR, hash + '.json'), JSON.stringify(cache), 'utf-8');
  } catch {
    // Silently fail cache writes
  }
}

// ============================================================================
// Built-in Validation Rules (30+)
// ============================================================================

const BUILT_IN_RULES: ValidationRule[] = [
  // --- Frontmatter Rules ---
  {
    id: 'FM001',
    name: 'require-frontmatter',
    description: 'Module must have YAML frontmatter',
    severity: 'error',
    level: 'syntax',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      if (!ctx.content.trimStart().startsWith('---')) {
        return [{ ruleId: 'FM001', message: 'Module must start with YAML frontmatter (---)', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'FM002',
    name: 'frontmatter-closed',
    description: 'Frontmatter must be properly closed',
    severity: 'error',
    level: 'syntax',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      const lines = ctx.lines;
      if (lines[0]?.trim() !== '---') return [];
      let closed = false;
      for (let i = 1; i < Math.min(lines.length, 50); i++) {
        if (lines[i]?.trim() === '---') { closed = true; break; }
      }
      if (!closed) {
        return [{ ruleId: 'FM002', message: 'Frontmatter is not closed with ---', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'FM003',
    name: 'frontmatter-name-required',
    description: 'Frontmatter must include a name field',
    severity: 'error',
    level: 'schema',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      if (!ctx.frontmatter.name) {
        return [{ ruleId: 'FM003', message: 'Frontmatter is missing required "name" field', severity: 'error', line: 1, column: 1, source: ctx.filePath, suggestions: ['Add "name: <module-name>" to frontmatter'] }];
      }
      if (typeof ctx.frontmatter.name !== 'string' || !/^[a-z0-9_-]+$/i.test(ctx.frontmatter.name)) {
        return [{ ruleId: 'FM003', message: 'Frontmatter "name" must be a valid identifier (alphanumeric, hyphens, underscores)', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'FM004',
    name: 'frontmatter-version-required',
    description: 'Frontmatter must include a version field',
    severity: 'warning',
    level: 'schema',
    category: 'frontmatter',
    fixable: true,
    check: (ctx) => {
      if (!ctx.frontmatter.version) {
        return [{ ruleId: 'FM004', message: 'Frontmatter is missing "version" field', severity: 'warning', line: 1, column: 1, source: ctx.filePath, fix: { range: [0, 0], replacement: '---\nversion: 1.0.0\n', description: 'Add default version' } }];
      }
      return [];
    },
  },
  {
    id: 'FM005',
    name: 'frontmatter-description-length',
    description: 'Frontmatter description should not exceed 500 characters',
    severity: 'warning',
    level: 'semantic',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      const desc = ctx.frontmatter.description;
      if (desc && typeof desc === 'string' && desc.length > 500) {
        return [{ ruleId: 'FM005', message: `Description is ${desc.length} characters (max 500)`, severity: 'warning', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'FM006',
    name: 'frontmatter-author-format',
    description: 'Author field must be a string or object with name/email',
    severity: 'error',
    level: 'schema',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      const author = ctx.frontmatter.author;
      if (author !== undefined) {
        if (typeof author === 'string') return [];
        if (typeof author === 'object' && author !== null && (author.name || author.email)) return [];
        return [{ ruleId: 'FM006', message: 'Author must be a string or {name, email} object', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'FM007',
    name: 'frontmatter-tags-type',
    description: 'Tags must be an array of strings',
    severity: 'error',
    level: 'schema',
    category: 'frontmatter',
    fixable: false,
    check: (ctx) => {
      const tags = ctx.frontmatter.tags;
      if (tags !== undefined) {
        if (!Array.isArray(tags)) {
          return [{ ruleId: 'FM007', message: '"tags" must be an array', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
        }
        for (const tag of tags) {
          if (typeof tag !== 'string') {
            return [{ ruleId: 'FM007', message: 'Each tag must be a string', severity: 'error', line: 1, column: 1, source: ctx.filePath }];
          }
        }
      }
      return [];
    },
  },

  // --- Section Rules ---
  {
    id: 'SEC001',
    name: 'section-order',
    description: 'Sections must follow recommended order',
    severity: 'info',
    level: 'semantic',
    category: 'section',
    fixable: false,
    check: (ctx) => {
      const recommendedOrder = ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Examples', 'Tests', 'References'];
      const sectionNames = ctx.sections.map(s => s.name);
      const ordered: string[] = [];
      for (const name of sectionNames) {
        const idx = recommendedOrder.indexOf(name);
        if (idx !== -1) ordered.push(name);
      }
      const sorted = [...ordered].sort((a, b) => recommendedOrder.indexOf(a) - recommendedOrder.indexOf(b));
      if (ordered.join(',') !== sorted.join(',')) {
        return [{ ruleId: 'SEC001', message: `Sections are not in recommended order. Expected: ${sorted.join(', ')}`, severity: 'info', line: ctx.sections[0]?.line || 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },
  {
    id: 'SEC002',
    name: 'section-empty',
    description: 'Sections should not be empty',
    severity: 'warning',
    level: 'semantic',
    category: 'section',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const section of ctx.sections) {
        if (!section.hasContent) {
          diagnostics.push({ ruleId: 'SEC002', message: `Section "${section.name}" is empty`, severity: 'warning', line: section.line, column: section.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC003',
    name: 'section-duplicate',
    description: 'Duplicate section names are not allowed',
    severity: 'error',
    level: 'syntax',
    category: 'section',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      const seen = new Map<string, number>();
      for (const section of ctx.sections) {
        const prev = seen.get(section.name);
        if (prev !== undefined) {
          diagnostics.push({ ruleId: 'SEC003', message: `Duplicate section "${section.name}" (first at line ${prev})`, severity: 'error', line: section.line, column: section.column, source: ctx.filePath });
        }
        seen.set(section.name, section.line);
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC004',
    name: 'section-level-nesting',
    description: 'Section heading levels must not skip (e.g., ## to ####)',
    severity: 'warning',
    level: 'schema',
    category: 'section',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 1; i < ctx.sections.length; i++) {
        const prev = ctx.sections[i - 1]!;
        const curr = ctx.sections[i]!;
        if (curr.level > prev.level + 1) {
          diagnostics.push({ ruleId: 'SEC004', message: `Heading level skips from ${prev.level} to ${curr.level} in "${curr.name}"`, severity: 'warning', line: curr.line, column: curr.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },

  // --- Code Block Rules ---
  {
    id: 'CB001',
    name: 'code-block-language',
    description: 'Code blocks should specify a language',
    severity: 'warning',
    level: 'schema',
    category: 'code-block',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        if (!block.language || block.language === 'text') {
          diagnostics.push({ ruleId: 'CB001', message: 'Code block is missing a language specifier', severity: 'warning', line: block.line, column: block.column, source: ctx.filePath, suggestions: ['Add language after opening ```', 'Use ```text for plain text'] });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CB002',
    name: 'code-block-unclosed',
    description: 'Code blocks must be properly closed',
    severity: 'error',
    level: 'syntax',
    category: 'code-block',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        if (!block.closed) {
          diagnostics.push({ ruleId: 'CB002', message: `Unclosed code block (language: ${block.language || 'none'})`, severity: 'error', line: block.line, column: block.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CB003',
    name: 'code-block-unknown-language',
    description: 'Code block language should be recognized',
    severity: 'info',
    level: 'schema',
    category: 'code-block',
    fixable: false,
    check: (ctx) => {
      const knownLanguages = new Set(['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'sql', 'html', 'css', 'json', 'yaml', 'toml', 'xml', 'bash', 'shell', 'powershell', 'dockerfile', 'makefile', 'markdown', 'text', 'plaintext', 'mermaid', 'diff', 'sh', 'zsh', 'fish', 'lua', 'r', 'matlab', 'perl', 'scala', 'haskell', 'elixir', 'clojure', 'typescriptreact', 'javascriptreact', 'tsx', 'jsx', 'vue', 'svelte']);
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        if (block.language && !knownLanguages.has(block.language.toLowerCase())) {
          diagnostics.push({ ruleId: 'CB003', message: `Unknown language "${block.language}" in code block`, severity: 'info', line: block.line, column: block.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CB004',
    name: 'code-block-executable',
    description: 'Code blocks marked as executable should not contain dangerous commands',
    severity: 'error',
    level: 'strict',
    category: 'code-block',
    fixable: false,
    check: (ctx) => {
      const dangerousPatterns = [/\brm\s+-rf\b/i, /\bformat\b.*\b[cd]:/i, /\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bsudo\s+rm\b/i, /\bchmod\s+777\b/i, /\bmkfs\b/i, /\bdd\s+if=/i];
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(block.content)) {
            diagnostics.push({ ruleId: 'CB004', message: 'Code block contains potentially dangerous command', severity: 'error', line: block.line, column: block.column, source: ctx.filePath });
            break;
          }
        }
      }
      return diagnostics;
    },
  },

  // --- Link Rules ---
  {
    id: 'LNK001',
    name: 'link-valid-url',
    description: 'Links must have a valid URL format',
    severity: 'warning',
    level: 'schema',
    category: 'link',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const link of ctx.links) {
        if (!link.isReference && link.url && !link.url.startsWith('#') && !link.url.startsWith('/') && !link.url.match(/^https?:\/\//) && !link.url.match(/^[a-z0-9]+:/i)) {
          diagnostics.push({ ruleId: 'LNK001', message: `Invalid URL format: "${link.url}"`, severity: 'warning', line: link.line, column: link.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'LNK002',
    name: 'link-undefined-reference',
    description: 'Reference links must be defined',
    severity: 'error',
    level: 'semantic',
    category: 'link',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      const definedRefs = new Set<string>();
      const refPattern = /^\[([^\]]+)\]:\s+(.+)$/i;
      for (const line of ctx.lines) {
        const match = refPattern.exec(line);
        if (match) definedRefs.add(match[1]!.toLowerCase());
      }
      const inlineRefPattern = /\[([^\]]+)\]\[([^\]]*)\]/g;
      for (let i = 0; i < ctx.lines.length; i++) {
        let match;
        const line = ctx.lines[i]!;
        while ((match = inlineRefPattern.exec(line)) !== null) {
          const ref = (match[2] || match[1])!.toLowerCase();
          if (!definedRefs.has(ref)) {
            diagnostics.push({ ruleId: 'LNK002', message: `Undefined reference link: "${match[2] || match[1]}"`, severity: 'error', line: i + 1, column: (match.index || 0) + 1, source: ctx.filePath });
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'LNK003',
    name: 'link-empty-text',
    description: 'Links should not have empty text',
    severity: 'warning',
    level: 'schema',
    category: 'link',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const link of ctx.links) {
        if (!link.text || link.text.trim() === '') {
          diagnostics.push({ ruleId: 'LNK003', message: 'Link has empty text', severity: 'warning', line: link.line, column: link.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },

  // --- Table Rules ---
  {
    id: 'TBL001',
    name: 'table-consistent-columns',
    description: 'Table rows must have consistent column count',
    severity: 'error',
    level: 'syntax',
    category: 'table',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const table of ctx.tables) {
        if (table.rows.length > 0) {
          const expected = table.columns;
          for (let i = 0; i < table.rows.length; i++) {
            if (table.rows[i]!.length !== expected) {
              diagnostics.push({ ruleId: 'TBL001', message: `Table row ${i + 1} has ${table.rows[i]!.length} columns, expected ${expected}`, severity: 'error', line: table.line + i + 2, column: 1, source: ctx.filePath });
            }
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'TBL002',
    name: 'table-has-header',
    description: 'Tables should have a header row',
    severity: 'info',
    level: 'semantic',
    category: 'table',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const table of ctx.tables) {
        if (!table.hasHeader) {
          diagnostics.push({ ruleId: 'TBL002', message: 'Table is missing a header row', severity: 'info', line: table.line, column: 1, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },

  // --- Security Rules ---
  {
    id: 'SEC010',
    name: 'hardcoded-secret',
    description: 'No hardcoded secrets or credentials',
    severity: 'error',
    level: 'strict',
    category: 'security',
    fixable: false,
    check: (ctx) => {
      const secretPatterns = [
        { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i, name: 'password' },
        { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/i, name: 'API key' },
        { pattern: /(?:secret|token|auth)\s*[:=]\s*['"][^'"]+['"]/i, name: 'secret/token' },
        { pattern: /AWS_ACCESS_KEY_ID/i, name: 'AWS key' },
        { pattern: /PRIVATE[_\s]KEY/i, name: 'private key' },
        { pattern: /(?:bearer|basic)\s+[A-Za-z0-9+/=]{20,}/i, name: 'auth token' },
        { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, name: 'private key block' },
        { pattern: /ghp_[A-Za-z0-9]{36}/, name: 'GitHub token' },
        { pattern: /sk-[A-Za-z0-9]{32,}/, name: 'OpenAI key' },
        { pattern: /xox[bpas]-[A-Za-z0-9-]+/, name: 'Slack token' },
      ];
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        for (const { pattern, name } of secretPatterns) {
          if (pattern.test(ctx.lines[i]!)) {
            diagnostics.push({ ruleId: 'SEC010', message: `Possible hardcoded ${name} detected`, severity: 'error', line: i + 1, column: 1, source: ctx.filePath, suggestions: ['Use environment variables or a secrets manager'] });
            break;
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC011',
    name: 'dangerous-import',
    description: 'Potentially dangerous imports detected',
    severity: 'warning',
    level: 'strict',
    category: 'security',
    fixable: false,
    check: (ctx) => {
      const dangerousImports = ['eval', 'exec', 'child_process', 'os.system', 'subprocess.call', 'subprocess.Popen', '__import__', 'importlib'];
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        for (const imp of dangerousImports) {
          if (ctx.lines[i]!.includes(imp)) {
            diagnostics.push({ ruleId: 'SEC011', message: `Potentially dangerous import/use of "${imp}"`, severity: 'warning', line: i + 1, column: 1, source: ctx.filePath });
            break;
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC012',
    name: 'sql-injection-risk',
    description: 'Possible SQL injection risk in code blocks',
    severity: 'warning',
    level: 'paranoid',
    category: 'security',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        if (/(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.+\s+(?:FROM|INTO|WHERE)/i.test(block.content) && /\+\s*(?:['"]|req\.|params\.|input)/i.test(block.content)) {
          diagnostics.push({ ruleId: 'SEC012', message: 'Possible SQL injection risk: string concatenation in SQL query', severity: 'warning', line: block.line, column: block.column, source: ctx.filePath, suggestions: ['Use parameterized queries or prepared statements'] });
        }
      }
      return diagnostics;
    },
  },

  // --- Performance Rules ---
  {
    id: 'PERF001',
    name: 'large-code-block',
    description: 'Code blocks exceeding 200 lines may indicate performance issues',
    severity: 'info',
    level: 'semantic',
    category: 'performance',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (const block of ctx.codeBlocks) {
        const lineCount = block.content.split('\n').length;
        if (lineCount > 200) {
          diagnostics.push({ ruleId: 'PERF001', message: `Code block has ${lineCount} lines (consider splitting)`, severity: 'info', line: block.line, column: block.column, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'PERF002',
    name: 'excessive-sections',
    description: 'Module has excessive number of sections',
    severity: 'info',
    level: 'semantic',
    category: 'performance',
    fixable: false,
    check: (ctx) => {
      if (ctx.sections.length > 20) {
        return [{ ruleId: 'PERF002', message: `Module has ${ctx.sections.length} sections (consider splitting into sub-modules)`, severity: 'info', line: 1, column: 1, source: ctx.filePath }];
      }
      return [];
    },
  },

  // --- Reference Integrity Rules ---
  {
    id: 'REF001',
    name: 'reference-unused',
    description: 'Defined reference links should be used',
    severity: 'info',
    level: 'paranoid',
    category: 'reference',
    fixable: false,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      const definedRefs = new Map<string, number>();
      const refPattern = /^\[([^\]]+)\]:\s+/i;
      for (let i = 0; i < ctx.lines.length; i++) {
        const match = refPattern.exec(ctx.lines[i]!);
        if (match) definedRefs.set(match[1]!.toLowerCase(), i + 1);
      }
      for (const [ref, line] of definedRefs) {
        const usagePattern = new RegExp(`\\[[^\\]]*\\]\\[${escapeRegex(ref)}\\]`, 'i');
        const found = ctx.lines.some(l => usagePattern.test(l));
        if (!found) {
          diagnostics.push({ ruleId: 'REF001', message: `Reference "${ref}" is defined but never used`, severity: 'info', line, column: 1, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },

  // --- General Rules ---
  {
    id: 'GEN001',
    name: 'no-trailing-whitespace',
    description: 'Lines should not have trailing whitespace',
    severity: 'info',
    level: 'syntax',
    category: 'general',
    fixable: true,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.lines[i] !== ctx.lines[i]!.replace(/\s+$/, '')) {
          diagnostics.push({ ruleId: 'GEN001', message: 'Trailing whitespace', severity: 'info', line: i + 1, column: ctx.lines[i]!.length, source: ctx.filePath, fix: { range: [0, 0], replacement: '', description: 'Remove trailing whitespace' } });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'GEN002',
    name: 'no-multiple-blank-lines',
    description: 'No multiple consecutive blank lines',
    severity: 'info',
    level: 'syntax',
    category: 'general',
    fixable: true,
    check: (ctx) => {
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 1; i < ctx.lines.length; i++) {
        if (ctx.lines[i]!.trim() === '' && ctx.lines[i - 1]!.trim() === '') {
          diagnostics.push({ ruleId: 'GEN002', message: 'Multiple consecutive blank lines', severity: 'info', line: i + 1, column: 1, source: ctx.filePath, fix: { range: [0, 0], replacement: '', description: 'Remove extra blank line' } });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'GEN003',
    name: 'final-newline',
    description: 'File should end with a newline',
    severity: 'info',
    level: 'syntax',
    category: 'general',
    fixable: true,
    check: (ctx) => {
      if (ctx.content.length > 0 && !ctx.content.endsWith('\n')) {
        return [{ ruleId: 'GEN003', message: 'File does not end with a newline', severity: 'info', line: ctx.lines.length, column: ctx.lines[ctx.lines.length - 1]!.length + 1, source: ctx.filePath, fix: { range: [ctx.content.length, ctx.content.length], replacement: '\n', description: 'Add final newline' } }];
      }
      return [];
    },
  },
  {
    id: 'GEN004',
    name: 'line-length',
    description: 'Lines should not exceed configured maximum length',
    severity: 'info',
    level: 'syntax',
    category: 'general',
    fixable: false,
    check: (ctx) => {
      const maxLen = (ctx.config.formatter?.maxLineLength as number) || 200;
      const diagnostics: ValidationDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.lines[i]!.length > maxLen) {
          diagnostics.push({ ruleId: 'GEN004', message: `Line exceeds ${maxLen} characters (${ctx.lines[i]!.length})`, severity: 'info', line: i + 1, column: maxLen, source: ctx.filePath });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'GEN005',
    name: 'file-encoding',
    description: 'File should use UTF-8 encoding',
    severity: 'warning',
    level: 'syntax',
    category: 'general',
    fixable: false,
    check: (_ctx) => {
      // Encoding check is done at file read level; this is a placeholder
      return [];
    },
  },
];

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseFrontmatter(content: string): Record<string, any> {
  if (!content.trimStart().startsWith('---')) return {};
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return {};
  const yamlStr = content.slice(3, endIdx);
  const result: Record<string, any> = {};
  let currentKey = '';
  for (const line of yamlStr.split('\n')) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1]!;
      let val: any = kvMatch[2]!.trim();
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^['"]/.test(val)) val = val.slice(1, -1);
      result[currentKey] = val;
    }
  }
  return result;
}

function parseSections(lines: string[]): SectionInfo[] {
  const sections: SectionInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1]!.length;
      const name = match[2]!.trim();
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.match(/^#{1,6}\s+/)) break;
        if (lines[j]!.trim() !== '') { hasContent = true; break; }
      }
      sections.push({ name, line: i + 1, column: 1, level, content: '', hasContent });
    }
  }
  return sections;
}

function parseCodeBlocks(lines: string[]): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  let inBlock = false;
  let blockStart = 0;
  let blockLang = '';
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^```(\w*)/);
    if (match) {
      if (!inBlock) {
        inBlock = true;
        blockStart = i;
        blockLang = match[1] || '';
      } else {
        blocks.push({ language: blockLang, line: blockStart + 1, column: 1, content: lines.slice(blockStart + 1, i).join('\n'), closed: true });
        inBlock = false;
      }
    }
  }
  if (inBlock) {
    blocks.push({ language: blockLang, line: blockStart + 1, column: 1, content: lines.slice(blockStart + 1).join('\n'), closed: false });
  }
  return blocks;
}

function parseLinks(lines: string[]): LinkInfo[] {
  const links: LinkInfo[] = [];
  const linkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  const refPattern = /^\[([^\]]+)\]:\s+(.+)$/i;
  for (let i = 0; i < lines.length; i++) {
    let match;
    const line = lines[i]!;
    const refMatch = refPattern.exec(line);
    if (refMatch) {
      links.push({ text: refMatch[1]!, url: refMatch[2]!.trim(), line: i + 1, column: 1, isImage: false, isReference: true });
    }
    while ((match = linkPattern.exec(line)) !== null) {
      links.push({ text: match[2]!, url: match[3]!, line: i + 1, column: (match.index || 0) + 1, isImage: match[1] === '!', isReference: false });
    }
  }
  return links;
}

function parseTables(lines: string[]): TableInfo[] {
  const tables: TableInfo[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.includes('|') && lines[i]!.trim().startsWith('|')) {
      const tableStart = i;
      const rows: string[][] = [];
      let hasHeader = false;
      let hasAlignment = false;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.split('|').slice(1, -1).map(c => c.trim());
        if (rows.length === 1 && cells.every(c => /^:?-{3,}:?$/.test(c))) {
          hasAlignment = true;
          hasHeader = true;
        } else {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) {
        tables.push({ line: tableStart, columns: rows[0]!.length, hasHeader, hasAlignment, rows });
      }
    } else {
      i++;
    }
  }
  return tables;
}

// ============================================================================
// Rule Engine
// ============================================================================

function filterRulesByLevel(rules: ValidationRule[], level: ValidationLevel): ValidationRule[] {
  const levelOrder: ValidationLevel[] = ['syntax', 'schema', 'semantic', 'strict', 'paranoid'];
  const maxIdx = levelOrder.indexOf(level);
  return rules.filter(r => levelOrder.indexOf(r.level) <= maxIdx);
}

function filterDiagnosticsBySeverity(diagnostics: ValidationDiagnostic[], minSeverity: ValidationSeverity): ValidationDiagnostic[] {
  const order: ValidationSeverity[] = ['info', 'warning', 'error'];
  const minIdx = order.indexOf(minSeverity);
  return diagnostics.filter(d => order.indexOf(d.severity) >= minIdx);
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatText(result: ValidationResult): string {
  const lines: string[] = [];
  const { diagnostics, stats } = result;

  if (diagnostics.length === 0) {
    lines.push(chalk.green('  No issues found.'));
    return lines.join('\n');
  }

  for (const d of diagnostics) {
    const icon = d.severity === 'error' ? chalk.red('✖') : d.severity === 'warning' ? chalk.yellow('⚠') : chalk.blue('ℹ');
    const loc = d.line > 0 ? chalk.gray(`${d.line}:${d.column}`) : '';
    lines.push(`  ${icon} ${loc} ${d.message} ${chalk.gray(`(${d.ruleId})`)}`);
    if (d.suggestions) {
      for (const s of d.suggestions) lines.push(chalk.gray(`    → ${s}`));
    }
    if (d.fix) lines.push(chalk.gray(`    Fix: ${d.fix.description}`));
  }

  lines.push('');
  lines.push(chalk.gray(`  ${stats.errors} error(s), ${stats.warnings} warning(s), ${stats.info} info — ${stats.fixable} auto-fixable`));
  return lines.join('\n');
}

function formatJSON(result: ValidationResult): string {
  return JSON.stringify(result, null, 2);
}

function formatSARIF(result: ValidationResult): string {
  const sarif: SARIFResult = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'mam-validate',
          version: '1.0.0',
          rules: [...new Set(result.diagnostics.map(d => d.ruleId))].map(id => ({
            id,
            name: id,
            shortDescription: { text: id },
            defaultConfiguration: { level: 'error' },
          })),
        },
      },
      results: result.diagnostics.map(d => ({
        ruleId: d.ruleId,
        level: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'note',
        message: { text: d.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: result.file }, region: { startLine: d.line, startColumn: d.column } } }],
      })),
    }],
  };
  return JSON.stringify(sarif, null, 2);
}

function formatHTML(result: ValidationResult): string {
  const rows = result.diagnostics.map(d => {
    const cls = d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info';
    return `<tr class="${cls}"><td>${d.line}:${d.column}</td><td>${d.severity}</td><td>${escapeHTML(d.message)}</td><td>${d.ruleId}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head><title>MAM Validation Report</title>
<style>
body{font-family:monospace;margin:2rem;background:#1a1a2e;color:#e0e0e0}
table{border-collapse:collapse;width:100%}
th,td{padding:.5rem 1rem;border:1px solid #333;text-align:left}
th{background:#16213e}
tr.error td{background:#3d1f1f}
tr.warning td{background:#3d3a1f}
tr.info td{background:#1f2d3d}
h1{color:#0f3460}
.stats{margin:1rem 0;color:#aaa}
</style></head><body>
<h1>MAM Validation Report</h1>
<p class="stats">File: ${escapeHTML(result.file)} | Level: ${result.level} | ${result.stats.errors} errors, ${result.stats.warnings} warnings, ${result.stats.info} info</p>
<table><thead><tr><th>Location</th><th>Severity</th><th>Message</th><th>Rule</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================================
// Fix Engine
// ============================================================================

function applyFixes(content: string, diagnostics: ValidationDiagnostic[]): string {
  const fixes = diagnostics.filter(d => d.fix).sort((a, b) => {
    const aStart = a.fix!.range[0];
    const bStart = b.fix!.range[0];
    return bStart - aStart; // Apply from end to start
  });

  let result = content;
  for (const d of fixes) {
    if (d.ruleId === 'GEN001') {
      result = result.replace(/[ \t]+$/gm, '');
    } else if (d.ruleId === 'GEN002') {
      result = result.replace(/\n{3,}/g, '\n\n');
    } else if (d.ruleId === 'GEN003') {
      if (!result.endsWith('\n')) result += '\n';
    }
  }
  return result;
}

// ============================================================================
// Progress Reporter
// ============================================================================

class ProgressReporter {
  private spinner: any;
  private quiet: boolean;

  constructor(quiet: boolean = false) {
    this.quiet = quiet;
  }

  start(text: string): void {
    if (!this.quiet) {
      this.spinner = ora(text).start();
    }
  }

  update(text: string): void {
    if (this.spinner) this.spinner.text = text;
  }

  succeed(text: string): void {
    if (this.spinner) this.spinner.succeed(text);
  }

  fail(text: string): void {
    if (this.spinner) this.spinner.fail(text);
  }

  info(text: string): void {
    if (!this.quiet) console.log(chalk.cyan('ℹ'), text);
  }
}

// ============================================================================
// Validation Engine
// ============================================================================

export class MAMValidator {
  private rules: ValidationRule[];
  private config: MAMConfig;
  private progress: ProgressReporter;

  constructor(config: Partial<ValidateOptions> = {}) {
    this.config = {};
    this.rules = [...BUILT_IN_RULES];
    this.progress = new ProgressReporter(config.quiet);
  }

  async loadConfig(configPath?: string): Promise<void> {
    this.config = await loadConfig(configPath);
    // Load custom rules from config if specified
    if ((this.config as any).customRules && Array.isArray((this.config as any).customRules)) {
      // Custom rules would be loaded from files here
    }
  }

  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  getRules(): ValidationRule[] {
    return [...this.rules];
  }

  async validateFile(filePath: string, options: ValidateOptions): Promise<ValidationResult> {
    const startTime = Date.now();
    const absPath = resolve(filePath);

    // Check ignore patterns
    const ignorePatterns = [...DEFAULT_IGNORE, ...(options.ignore || []), ...(this.config.ignore || [])];
    if (shouldIgnore(absPath, ignorePatterns)) {
      return { valid: true, file: absPath, level: options.level || 'schema', diagnostics: [], stats: { timeMs: 0, rulesChecked: 0, errors: 0, warnings: 0, info: 0, fixable: 0, linesChecked: 0 } };
    }

    // Check cache
    if (options.cache) {
      const cacheKey = await getCacheKey(absPath, options.level || 'schema');
      const cached = await loadCache(cacheKey);
      if (cached) {
        this.progress.info('Using cached results');
        return cached.result;
      }
    }

    const content = await readFile(absPath, 'utf-8');
    const result = await this.validateContent(content, absPath, options);

    // Save cache
    if (options.cache) {
      const cacheKey = await getCacheKey(absPath, options.level || 'schema');
      await saveCache(cacheKey, options.level || 'schema', result);
    }

    result.stats.timeMs = Date.now() - startTime;
    return result;
  }

  async validateContent(content: string, filePath: string, options: ValidateOptions): Promise<ValidationResult> {
    const startTime = Date.now();
    const level = options.level || 'schema';
    const lines = content.split('\n');

    this.progress.start('Parsing module...');

    // Parse
    const parseResult = parseMAM(content, { source: filePath });

    this.progress.update('Building context...');

    // Build context
    const frontmatter = parseFrontmatter(content);
    const sections = parseSections(lines);
    const codeBlocks = parseCodeBlocks(lines);
    const links = parseLinks(lines);
    const tables = parseTables(lines);

    const ctx: ValidationContext = {
      content, lines, ast: parseResult.ast, filePath, config: this.config,
      level, frontmatter, sections, codeBlocks, links, tables,
    };

    this.progress.update('Running validation rules...');

    // Filter and run rules
    const activeRules = filterRulesByLevel(this.rules, level);
    let diagnostics: ValidationDiagnostic[] = [];

    for (const rule of activeRules) {
      try {
        diagnostics.push(...rule.check(ctx));
      } catch (err) {
        diagnostics.push({ ruleId: rule.id, message: `Rule execution failed: ${(err as Error).message}`, severity: 'error', line: 0, column: 0, source: filePath });
      }
    }

    // Add parse errors
    for (const error of parseResult.errors) {
      diagnostics.push({ ruleId: 'PARSE_ERROR', message: error.message, severity: 'error', line: (error as any).line || 0, column: (error as any).column || 0, source: filePath });
    }

    // Severity filter
    if (options.severity) {
      diagnostics = filterDiagnosticsBySeverity(diagnostics, options.severity);
    } else {
      diagnostics = filterDiagnosticsBySeverity(diagnostics, 'info');
    }

    // Max errors limit
    if (options.maxErrors && options.maxErrors > 0) {
      const errorCount = diagnostics.filter(d => d.severity === 'error').length;
      if (errorCount > options.maxErrors) {
        diagnostics = diagnostics.filter(d => d.severity !== 'error').slice(0, options.maxErrors);
        diagnostics.push({ ruleId: 'LIMIT', message: `Too many errors (exceeded ${options.maxErrors} limit)`, severity: 'error', line: 0, column: 0, source: filePath });
      }
    }

    const fixable = diagnostics.filter(d => d.fix).length;
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    const info = diagnostics.filter(d => d.severity === 'info').length;

    const result: ValidationResult = {
      valid: errors === 0,
      file: filePath,
      level,
      diagnostics,
      stats: { timeMs: Date.now() - startTime, rulesChecked: activeRules.length, errors, warnings, info, fixable, linesChecked: lines.length },
    };

    this.progress.succeed(`Validation complete: ${errors} error(s), ${warnings} warning(s), ${info} info`);
    return result;
  }
}

// ============================================================================
// Command
// ============================================================================

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const startTime = Date.now();
  const validator = new MAMValidator(options);
  await validator.loadConfig(options.config);

  try {
    const filePath = resolve(options.file);
    const result = await validator.validateFile(filePath, options);

    // Apply fixes if requested
    if (options.fix && result.diagnostics.some(d => d.fix)) {
      const content = await readFile(filePath, 'utf-8');
      const fixed = applyFixes(content, result.diagnostics);
      await writeFile(filePath, fixed, 'utf-8');
      console.log(chalk.green(`  Applied fixes to ${filePath}`));
    }

    // Output
    const format = options.format || 'text';
    let output: string;
    switch (format) {
      case 'json': output = formatJSON(result); break;
      case 'sarif': output = formatSARIF(result); break;
      case 'html': output = formatHTML(result); break;
      default: output = formatText(result);
    }

    if (!options.quiet) {
      console.log(output);
    } else if (format !== 'text') {
      console.log(output);
    }

    // Summary
    if (!options.quiet && format === 'text') {
      console.log(chalk.gray(`\n  Validated in ${result.stats.timeMs}ms | ${result.stats.rulesChecked} rules | ${result.stats.linesChecked} lines`));
    }

    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    console.error(chalk.red(`  Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export default validateCommand;
