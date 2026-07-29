/**
 * MAM Lint Command
 *
 * Production-grade linter for MAM modules with 40+ rules,
 * configurable severity, auto-fix, and multiple output formats.
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, type MAMConfig } from '../utils/config.js';

// ============================================================================
// Types
// ============================================================================

export type LintSeverity = 'error' | 'warning' | 'info' | 'off';
export type LintOutputFormat = 'text' | 'json' | 'stylish' | 'compact';
export type LintRuleGroup = 'recommended' | 'strict' | 'style' | 'security' | 'performance' | 'accessibility' | 'custom';

export interface LintOptions {
  file: string;
  level?: LintSeverity;
  format?: LintOutputFormat;
  fix?: boolean;
  ignore?: string[];
  group?: LintRuleGroup[];
  maxErrors?: number;
  config?: string;
  quiet?: boolean;
  cache?: boolean;
  baseline?: string;
  rules?: string[];
}

export interface LintRuleDefinition {
  id: string;
  name: string;
  description: string;
  severity: LintSeverity;
  group: LintRuleGroup[];
  category: string;
  fixable: boolean;
  hasSuggestions: boolean;
  check: (ctx: LintContext) => LintDiagnostic[];
}

export interface LintContext {
  content: string;
  lines: string[];
  ast: any;
  filePath: string;
  config: MAMConfig;
  frontmatter: Record<string, any>;
  sections: LintSectionInfo[];
  codeBlocks: LintCodeBlockInfo[];
  links: LintLinkInfo[];
  tables: LintTableInfo[];
  lineLengths: number[];
}

export interface LintSectionInfo {
  name: string;
  line: number;
  level: number;
  content: string;
  wordCount: number;
  hasCodeBlocks: boolean;
}

export interface LintCodeBlockInfo {
  language: string;
  line: number;
  content: string;
  lineCount: number;
  hasComments: boolean;
}

export interface LintLinkInfo {
  text: string;
  url: string;
  line: number;
  isImage: boolean;
}

export interface LintTableInfo {
  line: number;
  columns: number;
  rows: string[][];
  hasAlignment: boolean;
}

export interface LintDiagnostic {
  ruleId: string;
  message: string;
  severity: LintSeverity;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  source: string;
  fix?: LintFix;
  suggestions?: string[];
  group: LintRuleGroup;
  category: string;
  documentation?: string;
}

export interface LintFix {
  range: [number, number];
  replacement: string;
  description: string;
}

export interface LintResult {
  file: string;
  passed: boolean;
  diagnostics: LintDiagnostic[];
  stats: LintStats;
  baseline?: LintBaseline;
  score: number;
}

export interface LintStats {
  timeMs: number;
  rulesChecked: number;
  errors: number;
  warnings: number;
  info: number;
  fixable: number;
  linesChecked: number;
  filesScanned: number;
}

export interface LintBaseline {
  file: string;
  timestamp: number;
  diagnostics: LintDiagnostic[];
  stats: LintStats;
}

export interface LintConfigFile {
  extends?: string[];
  rules?: Record<string, LintSeverity | { severity: LintSeverity; options?: any }>;
  group?: LintRuleGroup[];
  ignore?: string[];
  maxLineLength?: number;
  fix?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', '.turbo', '*.min.js', '*.map', 'CHANGELOG.md'];

const SEVERITY_ORDER: LintSeverity[] = ['off', 'info', 'warning', 'error'];

// ============================================================================
// Helpers
// ============================================================================

function shouldIgnore(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\//g, '\/') + '$');
      if (regex.test(normalized)) return true;
    } else if (normalized.includes(pattern)) return true;
  }
  return false;
}

function parseFrontmatter(content: string): Record<string, any> {
  if (!content.trimStart().startsWith('---')) return {};
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return {};
  const yaml = content.slice(3, endIdx);
  const result: Record<string, any> = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^([\w][\w-]*):\s*(.*)$/);
    if (m) {
      let val: any = m[2]!.trim();
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      else if (/^['"]/.test(val)) val = val.slice(1, -1);
      result[m[1]!] = val;
    }
  }
  return result;
}

function parseSections(lines: string[]): LintSectionInfo[] {
  const sections: LintSectionInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const level = m[1]!.length;
      const name = m[2]!.trim();
      const contentLines: string[] = [];
      let hasCodeBlocks = false;
      let inCode = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.match(/^#{1,6}\s+/)) break;
        if (lines[j]!.trim().startsWith('```')) { inCode = !inCode; hasCodeBlocks = true; }
        if (!inCode) contentLines.push(lines[j]!);
      }
      const content = contentLines.join(' ');
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      sections.push({ name, line: i + 1, level, content, wordCount, hasCodeBlocks });
    }
  }
  return sections;
}

function parseCodeBlocks(lines: string[]): LintCodeBlockInfo[] {
  const blocks: LintCodeBlockInfo[] = [];
  let inBlock = false;
  let start = 0;
  let lang = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^```(\w*)/);
    if (m) {
      if (!inBlock) { inBlock = true; start = i; lang = m[1] || ''; }
      else {
        const blockLines = lines.slice(start + 1, i);
        const content = blockLines.join('\n');
        const hasComments = /^\s*(?:#|\/\/|\/\*|\*|<!--)/m.test(content);
        blocks.push({ language: lang, line: start + 1, content, lineCount: blockLines.length, hasComments });
        inBlock = false;
      }
    }
  }
  return blocks;
}

function parseLinks(lines: string[]): LintLinkInfo[] {
  const links: LintLinkInfo[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    while ((m = pattern.exec(lines[i]!)) !== null) {
      links.push({ text: m[2]!, url: m[3]!, line: i + 1, isImage: m[1] === '!' });
    }
  }
  return links;
}

function parseTables(lines: string[]): LintTableInfo[] {
  const tables: LintTableInfo[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.includes('|') && lines[i]!.trim().startsWith('|')) {
      const start = i;
      const rows: string[][] = [];
      let hasAlignment = false;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.split('|').slice(1, -1).map(c => c.trim());
        if (rows.length === 1 && cells.every(c => /^:?-{3,}:?$/.test(c))) {
          hasAlignment = true;
        } else {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) tables.push({ line: start, columns: rows[0]!.length, rows, hasAlignment });
    } else { i++; }
  }
  return tables;
}

// ============================================================================
// Built-in Lint Rules (40+)
// ============================================================================

const BUILT_IN_RULES: LintRuleDefinition[] = [
  // ── Naming Conventions ──
  {
    id: 'NAM001', name: 'module-name-kebab', description: 'Module name should use kebab-case',
    severity: 'warning', group: ['recommended'], category: 'naming', fixable: false, hasSuggestions: true,
    check: (ctx) => {
      const name = ctx.frontmatter.name;
      if (name && typeof name === 'string' && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
        return [{ ruleId: 'NAM001', message: `Module name "${name}" should use kebab-case`, severity: 'warning', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'naming', suggestions: [name.toLowerCase().replace(/[_\s]+/g, '-')] }];
      }
      return [];
    },
  },
  {
    id: 'NAM002', name: 'section-name-pascal', description: 'Section names should use PascalCase',
    severity: 'info', group: ['style'], category: 'naming', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const s of ctx.sections) {
        if (s.name !== s.name.charAt(0).toUpperCase() + s.name.slice(1) && !/^[A-Z]/.test(s.name)) {
          diagnostics.push({ ruleId: 'NAM002', message: `Section "${s.name}" should use PascalCase`, severity: 'info', line: s.line, column: 1, source: ctx.filePath, group: 'style', category: 'naming' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'NAM003', name: 'no-special-chars-section', description: 'Section names should not contain special characters',
    severity: 'warning', group: ['recommended'], category: 'naming', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const s of ctx.sections) {
        if (/[!@#$%^&*()=+\[\]{};:'"\\|,.<>/?`~]/.test(s.name)) {
          diagnostics.push({ ruleId: 'NAM003', message: `Section "${s.name}" contains special characters`, severity: 'warning', line: s.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'naming' });
        }
      }
      return diagnostics;
    },
  },

  // ── Section Completeness ──
  {
    id: 'SEC100', name: 'require-purpose', description: 'Module should have a Purpose section',
    severity: 'warning', group: ['recommended'], category: 'section', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.sections.some(s => s.name === 'Purpose')) {
        return [{ ruleId: 'SEC100', message: 'Module is missing a Purpose section', severity: 'warning', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'section', suggestions: ['Add a ## Purpose section'] }];
      }
      return [];
    },
  },
  {
    id: 'SEC101', name: 'purpose-concise', description: 'Purpose section should be concise (under 100 words)',
    severity: 'info', group: ['recommended'], category: 'section', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const purpose = ctx.sections.find(s => s.name === 'Purpose');
      if (purpose && purpose.wordCount > 100) {
        return [{ ruleId: 'SEC101', message: `Purpose section has ${purpose.wordCount} words (recommended: under 100)`, severity: 'info', line: purpose.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'section' }];
      }
      return [];
    },
  },
  {
    id: 'SEC102', name: 'require-inputs-outputs', description: 'Module should define Inputs and/or Outputs',
    severity: 'info', group: ['recommended'], category: 'section', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const hasInputs = ctx.sections.some(s => s.name === 'Inputs');
      const hasOutputs = ctx.sections.some(s => s.name === 'Outputs');
      if (!hasInputs && !hasOutputs) {
        return [{ ruleId: 'SEC102', message: 'Module should define Inputs and/or Outputs sections', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'section' }];
      }
      return [];
    },
  },
  {
    id: 'SEC103', name: 'section-min-words', description: 'Sections should have at least 3 words of content',
    severity: 'info', group: ['style'], category: 'section', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const s of ctx.sections) {
        if (s.wordCount > 0 && s.wordCount < 3 && !s.hasCodeBlocks) {
          diagnostics.push({ ruleId: 'SEC103', message: `Section "${s.name}" has only ${s.wordCount} words`, severity: 'info', line: s.line, column: 1, source: ctx.filePath, group: 'style', category: 'section' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC104', name: 'unknown-section', description: 'Section name should be a recognized MAM section',
    severity: 'info', group: ['style'], category: 'section', fixable: false, hasSuggestions: true,
    check: (ctx) => {
      const known = new Set(['Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid', 'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples', 'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities', 'Configuration', 'Environment', 'Setup', 'Usage', 'API', 'Changelog', 'License']);
      const diagnostics: LintDiagnostic[] = [];
      for (const s of ctx.sections) {
        if (!known.has(s.name)) {
          diagnostics.push({ ruleId: 'SEC104', message: `Unknown section "${s.name}"`, severity: 'info', line: s.line, column: 1, source: ctx.filePath, group: 'style', category: 'section' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC105', name: 'section-depth', description: 'Sections should not nest deeper than 3 levels',
    severity: 'warning', group: ['recommended'], category: 'section', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const s of ctx.sections) {
        if (s.level > 4) {
          diagnostics.push({ ruleId: 'SEC105', message: `Section "${s.name}" is at heading level ${s.level} (max recommended: 4)`, severity: 'warning', line: s.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'section' });
        }
      }
      return diagnostics;
    },
  },

  // ── Code Quality ──
  {
    id: 'CODE001', name: 'code-block-language-required', description: 'Code blocks must specify a language',
    severity: 'warning', group: ['recommended'], category: 'code', fixable: false, hasSuggestions: true,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        if (!b.language) {
          diagnostics.push({ ruleId: 'CODE001', message: 'Code block is missing a language specifier', severity: 'warning', line: b.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'code', suggestions: ['Add language after opening ```'] });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CODE002', name: 'code-block-no-debug', description: 'Code blocks should not contain debug statements',
    severity: 'warning', group: ['recommended'], category: 'code', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const debugPatterns = [/\bconsole\.log\b/, /\bprint\s*\(/, /\bdebugger\b/, /\bfmt\.Println\b/, /\bSystem\.out\.print\b/, /\bdump\(/, /\bvar_dump\b/, /\bprint_r\b/];
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        for (const p of debugPatterns) {
          if (p.test(b.content)) {
            diagnostics.push({ ruleId: 'CODE002', message: 'Code block contains debug statement', severity: 'warning', line: b.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'code' });
            break;
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CODE003', name: 'code-block-no-todo', description: 'Code blocks should not contain TODO/FIXME/HACK',
    severity: 'info', group: ['style'], category: 'code', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        if (/\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b/i.test(b.content)) {
          diagnostics.push({ ruleId: 'CODE003', message: 'Code block contains TODO/FIXME/HACK comment', severity: 'info', line: b.line, column: 1, source: ctx.filePath, group: 'style', category: 'code' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CODE004', name: 'code-block-length', description: 'Code blocks should not exceed 100 lines',
    severity: 'info', group: ['style'], category: 'code', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        if (b.lineCount > 100) {
          diagnostics.push({ ruleId: 'CODE004', message: `Code block has ${b.lineCount} lines (recommended: under 100)`, severity: 'info', line: b.line, column: 1, source: ctx.filePath, group: 'style', category: 'code' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CODE005', name: 'code-block-commented', description: 'Code blocks should have explanatory comments for complex logic',
    severity: 'info', group: ['style'], category: 'code', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        if (b.lineCount > 20 && !b.hasComments) {
          diagnostics.push({ ruleId: 'CODE005', message: 'Long code block has no comments', severity: 'info', line: b.line, column: 1, source: ctx.filePath, group: 'style', category: 'code' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'CODE006', name: 'no-hardcoded-urls', description: 'Code blocks should not contain hardcoded URLs',
    severity: 'info', group: ['security'], category: 'code', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const b of ctx.codeBlocks) {
        if (/https?:\/\/[^\s'"]+/i.test(b.content) && !/example\.com|localhost|127\.0\.0\.1/i.test(b.content)) {
          diagnostics.push({ ruleId: 'CODE006', message: 'Code block contains hardcoded URL', severity: 'info', line: b.line, column: 1, source: ctx.filePath, group: 'security', category: 'code' });
        }
      }
      return diagnostics;
    },
  },

  // ── Documentation Coverage ──
  {
    id: 'DOC001', name: 'require-description', description: 'Frontmatter should include a description',
    severity: 'warning', group: ['recommended'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.frontmatter.description) {
        return [{ ruleId: 'DOC001', message: 'Frontmatter is missing a description', severity: 'warning', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'documentation' }];
      }
      return [];
    },
  },
  {
    id: 'DOC002', name: 'require-version', description: 'Frontmatter should include a version',
    severity: 'info', group: ['recommended'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.frontmatter.version) {
        return [{ ruleId: 'DOC002', message: 'Frontmatter is missing a version', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'documentation' }];
      }
      return [];
    },
  },
  {
    id: 'DOC003', name: 'require-author', description: 'Frontmatter should include an author',
    severity: 'info', group: ['style'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.frontmatter.author) {
        return [{ ruleId: 'DOC003', message: 'Frontmatter is missing an author', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'style', category: 'documentation' }];
      }
      return [];
    },
  },
  {
    id: 'DOC004', name: 'require-tags', description: 'Frontmatter should include tags',
    severity: 'info', group: ['style'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.frontmatter.tags) {
        return [{ ruleId: 'DOC004', message: 'Frontmatter is missing tags', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'style', category: 'documentation' }];
      }
      return [];
    },
  },
  {
    id: 'DOC005', name: 'require-examples', description: 'Module should include an Examples section',
    severity: 'info', group: ['recommended'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.sections.some(s => s.name === 'Examples')) {
        return [{ ruleId: 'DOC005', message: 'Module is missing an Examples section', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'documentation' }];
      }
      return [];
    },
  },
  {
    id: 'DOC006', name: 'require-references', description: 'Module should include a References section',
    severity: 'info', group: ['style'], category: 'documentation', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (!ctx.sections.some(s => s.name === 'References')) {
        return [{ ruleId: 'DOC006', message: 'Module is missing a References section', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'style', category: 'documentation' }];
      }
      return [];
    },
  },

  // ── Security Best Practices ──
  {
    id: 'SEC200', name: 'no-secrets', description: 'No hardcoded secrets or credentials',
    severity: 'error', group: ['strict', 'security'], category: 'security', fixable: false, hasSuggestions: true,
    check: (ctx) => {
      const patterns = [
        /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i,
        /(?:api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i,
        /(?:secret|token)\s*[:=]\s*['"][^'"]+['"]/i,
        /AWS_ACCESS_KEY_ID/i, /PRIVATE_KEY/i,
        /ghp_[A-Za-z0-9]{36}/, /sk-[A-Za-z0-9]{32,}/, /xox[bpas]-[A-Za-z0-9-]+/,
      ];
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        for (const p of patterns) {
          if (p.test(ctx.lines[i]!)) {
            diagnostics.push({ ruleId: 'SEC200', message: 'Possible hardcoded secret', severity: 'error', line: i + 1, column: 1, source: ctx.filePath, group: 'security', category: 'security', suggestions: ['Use environment variables'] });
            break;
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC201', name: 'no-dangerous-imports', description: 'No dangerous imports (eval, exec, child_process)',
    severity: 'warning', group: ['strict', 'security'], category: 'security', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const dangerous = ['eval', 'exec', 'child_process', 'os.system', 'subprocess.call', '__import__'];
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        for (const d of dangerous) {
          if (ctx.lines[i]!.includes(d)) {
            diagnostics.push({ ruleId: 'SEC201', message: `Dangerous import/use of "${d}"`, severity: 'warning', line: i + 1, column: 1, source: ctx.filePath, group: 'security', category: 'security' });
            break;
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC202', name: 'no-unsafe-eval', description: 'No eval() usage',
    severity: 'error', group: ['strict', 'security'], category: 'security', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (/\beval\s*\(/.test(ctx.lines[i]!)) {
          diagnostics.push({ ruleId: 'SEC202', message: 'eval() usage is unsafe', severity: 'error', line: i + 1, column: 1, source: ctx.filePath, group: 'security', category: 'security' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'SEC203', name: 'no-inner-html', description: 'No innerHTML usage (XSS risk)',
    severity: 'warning', group: ['strict', 'security'], category: 'security', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (/\.innerHTML\s*=/.test(ctx.lines[i]!)) {
          diagnostics.push({ ruleId: 'SEC203', message: 'innerHTML usage is an XSS risk', severity: 'warning', line: i + 1, column: 1, source: ctx.filePath, group: 'security', category: 'security' });
        }
      }
      return diagnostics;
    },
  },

  // ── Accessibility ──
  {
    id: 'A11Y001', name: 'images-require-alt', description: 'Images should have alt text',
    severity: 'warning', group: ['recommended', 'accessibility'], category: 'accessibility', fixable: false, hasSuggestions: true,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const link of ctx.links) {
        if (link.isImage && (!link.text || link.text.trim() === '')) {
          diagnostics.push({ ruleId: 'A11Y001', message: 'Image is missing alt text', severity: 'warning', line: link.line, column: 1, source: ctx.filePath, group: 'accessibility', category: 'accessibility', suggestions: ['Add descriptive alt text'] });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'A11Y002', name: 'link-text-descriptive', description: 'Link text should be descriptive',
    severity: 'info', group: ['recommended', 'accessibility'], category: 'accessibility', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const badTexts = ['click here', 'here', 'link', 'read more', 'more', 'this'];
      const diagnostics: LintDiagnostic[] = [];
      for (const link of ctx.links) {
        if (!link.isImage && badTexts.includes(link.text.toLowerCase().trim())) {
          diagnostics.push({ ruleId: 'A11Y002', message: `Link text "${link.text}" is not descriptive`, severity: 'info', line: link.line, column: 1, source: ctx.filePath, group: 'accessibility', category: 'accessibility' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'A11Y003', name: 'heading-order', description: 'Heading levels should not skip',
    severity: 'warning', group: ['recommended', 'accessibility'], category: 'accessibility', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 1; i < ctx.sections.length; i++) {
        const prev = ctx.sections[i - 1]!;
        const curr = ctx.sections[i]!;
        if (curr.level > prev.level + 1) {
          diagnostics.push({ ruleId: 'A11Y003', message: `Heading level skips from ${prev.level} to ${curr.level}`, severity: 'warning', line: curr.line, column: 1, source: ctx.filePath, group: 'accessibility', category: 'accessibility' });
        }
      }
      return diagnostics;
    },
  },

  // ── Performance ──
  {
    id: 'PERF100', name: 'large-module', description: 'Module exceeds 500 lines',
    severity: 'info', group: ['performance'], category: 'performance', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (ctx.lines.length > 500) {
        return [{ ruleId: 'PERF100', message: `Module has ${ctx.lines.length} lines (recommended: under 500)`, severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'performance', category: 'performance' }];
      }
      return [];
    },
  },
  {
    id: 'PERF101', name: 'many-sections', description: 'Module has more than 15 sections',
    severity: 'info', group: ['performance'], category: 'performance', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (ctx.sections.length > 15) {
        return [{ ruleId: 'PERF101', message: `Module has ${ctx.sections.length} sections (recommended: under 15)`, severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'performance', category: 'performance' }];
      }
      return [];
    },
  },
  {
    id: 'PERF102', name: 'many-code-blocks', description: 'Module has more than 10 code blocks',
    severity: 'info', group: ['performance'], category: 'performance', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      if (ctx.codeBlocks.length > 10) {
        return [{ ruleId: 'PERF102', message: `Module has ${ctx.codeBlocks.length} code blocks (recommended: under 10)`, severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'performance', category: 'performance' }];
      }
      return [];
    },
  },

  // ── Style ──
  {
    id: 'STY001', name: 'trailing-whitespace', description: 'No trailing whitespace',
    severity: 'info', group: ['style'], category: 'style', fixable: true, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.lines[i] !== ctx.lines[i]!.replace(/\s+$/, '')) {
          diagnostics.push({ ruleId: 'STY001', message: 'Trailing whitespace', severity: 'info', line: i + 1, column: ctx.lines[i]!.length, source: ctx.filePath, group: 'style', category: 'style', fix: { range: [0, 0], replacement: '', description: 'Remove trailing whitespace' } });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'STY002', name: 'multiple-blank-lines', description: 'No multiple consecutive blank lines',
    severity: 'info', group: ['style'], category: 'style', fixable: true, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 1; i < ctx.lines.length; i++) {
        if (ctx.lines[i]!.trim() === '' && ctx.lines[i - 1]!.trim() === '') {
          diagnostics.push({ ruleId: 'STY002', message: 'Multiple consecutive blank lines', severity: 'info', line: i + 1, column: 1, source: ctx.filePath, group: 'style', category: 'style', fix: { range: [0, 0], replacement: '', description: 'Remove extra blank line' } });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'STY003', name: 'final-newline', description: 'File should end with a newline',
    severity: 'info', group: ['style'], category: 'style', fixable: true, hasSuggestions: false,
    check: (ctx) => {
      if (ctx.content.length > 0 && !ctx.content.endsWith('\n')) {
        return [{ ruleId: 'STY003', message: 'File does not end with a newline', severity: 'info', line: ctx.lines.length, column: ctx.lines[ctx.lines.length - 1]!.length + 1, source: ctx.filePath, group: 'style', category: 'style', fix: { range: [ctx.content.length, ctx.content.length], replacement: '\n', description: 'Add final newline' } }];
      }
      return [];
    },
  },
  {
    id: 'STY004', name: 'line-length', description: 'Lines should not exceed 200 characters',
    severity: 'info', group: ['style'], category: 'style', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.lines[i]!.length > 200) {
          diagnostics.push({ ruleId: 'STY004', message: `Line exceeds 200 characters (${ctx.lines[i]!.length})`, severity: 'info', line: i + 1, column: 200, source: ctx.filePath, group: 'style', category: 'style' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'STY005', name: 'consistent-quotes', description: 'Frontmatter string values should use consistent quoting',
    severity: 'info', group: ['style'], category: 'style', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      // Placeholder: consistency check across frontmatter values
      return [];
    },
  },

  // ── Dependency Freshness ──
  {
    id: 'DEP001', name: 'require-dependencies', description: 'Module with code should declare Dependencies section',
    severity: 'info', group: ['recommended'], category: 'dependency', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const hasCode = ctx.codeBlocks.length > 0;
      const hasDeps = ctx.sections.some(s => s.name === 'Dependencies');
      if (hasCode && !hasDeps) {
        return [{ ruleId: 'DEP001', message: 'Module with code blocks should declare dependencies', severity: 'info', line: 1, column: 1, source: ctx.filePath, group: 'recommended', category: 'dependency' }];
      }
      return [];
    },
  },

  // ── Link Quality ──
  {
    id: 'LNK100', name: 'no-broken-links', description: 'Internal links should reference valid sections',
    severity: 'warning', group: ['recommended'], category: 'link', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      const sectionNames = new Set(ctx.sections.map(s => s.name.toLowerCase().replace(/\s+/g, '-')));
      for (const link of ctx.links) {
        if (link.url.startsWith('#')) {
          const anchor = link.url.slice(1).toLowerCase();
          if (!sectionNames.has(anchor)) {
            diagnostics.push({ ruleId: 'LNK100', message: `Broken internal link: "${link.url}"`, severity: 'warning', line: link.line, column: 1, source: ctx.filePath, group: 'recommended', category: 'link' });
          }
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'LNK101', name: 'no-http-links', description: 'Prefer HTTPS links over HTTP',
    severity: 'info', group: ['security'], category: 'link', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const link of ctx.links) {
        if (link.url.startsWith('http://') && !link.url.includes('localhost') && !link.url.includes('127.0.0.1')) {
          diagnostics.push({ ruleId: 'LNK101', message: `HTTP link found: "${link.url}" (prefer HTTPS)`, severity: 'info', line: link.line, column: 1, source: ctx.filePath, group: 'security', category: 'link' });
        }
      }
      return diagnostics;
    },
  },

  // ── Table Quality ──
  {
    id: 'TBL100', name: 'table-alignment', description: 'Tables should have alignment specified',
    severity: 'info', group: ['style'], category: 'table', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const t of ctx.tables) {
        if (!t.hasAlignment) {
          diagnostics.push({ ruleId: 'TBL100', message: 'Table is missing column alignment', severity: 'info', line: t.line, column: 1, source: ctx.filePath, group: 'style', category: 'table' });
        }
      }
      return diagnostics;
    },
  },
  {
    id: 'TBL101', name: 'table-rows-consistent', description: 'Table rows should have consistent column count',
    severity: 'error', group: ['recommended'], category: 'table', fixable: false, hasSuggestions: false,
    check: (ctx) => {
      const diagnostics: LintDiagnostic[] = [];
      for (const t of ctx.tables) {
        const expected = t.columns;
        for (let i = 0; i < t.rows.length; i++) {
          if (t.rows[i]!.length !== expected) {
            diagnostics.push({ ruleId: 'TBL101', message: `Row ${i + 1} has ${t.rows[i]!.length} columns, expected ${expected}`, severity: 'error', line: t.line + i + 2, column: 1, source: ctx.filePath, group: 'recommended', category: 'table' });
          }
        }
      }
      return diagnostics;
    },
  },

  // ── Custom Rule Placeholder ──
  {
    id: 'CUSTOM001', name: 'custom-placeholder', description: 'Placeholder for custom rules',
    severity: 'off', group: ['custom'], category: 'custom', fixable: false, hasSuggestions: false,
    check: () => [],
  },
];

// ============================================================================
// Rule Engine
// ============================================================================

function resolveSeverity(rule: LintRuleDefinition, config?: Record<string, any>): LintSeverity {
  if (!config) return rule.severity;
  const override = config[rule.id];
  if (!override) return rule.severity;
  if (typeof override === 'string') return override as LintSeverity;
  if (typeof override === 'object' && override.severity) return override.severity as LintSeverity;
  return rule.severity;
}

function filterByGroup(rules: LintRuleDefinition[], groups?: LintRuleGroup[]): LintRuleDefinition[] {
  if (!groups || groups.length === 0) return rules;
  return rules.filter(r => r.group.some(g => groups.includes(g)));
}

function filterByRules(rules: LintRuleDefinition[], ruleIds?: string[]): LintRuleDefinition[] {
  if (!ruleIds || ruleIds.length === 0) return rules;
  return rules.filter(r => ruleIds.includes(r.id));
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatText(result: LintResult): string {
  const lines: string[] = [];
  const { diagnostics, stats, score } = result;

  if (diagnostics.length === 0) {
    lines.push(chalk.green('  No issues found.'));
    lines.push(chalk.gray(`  Score: ${score}/100`));
    return lines.join('\n');
  }

  for (const d of diagnostics) {
    const icon = d.severity === 'error' ? chalk.red('✖') : d.severity === 'warning' ? chalk.yellow('⚠') : chalk.blue('ℹ');
    const loc = d.line > 0 ? chalk.gray(`${d.line}:${d.column}`) : '';
    lines.push(`  ${icon} ${loc} ${d.message}`);
    lines.push(chalk.gray(`    Rule: ${d.ruleId} | ${d.category} | ${d.group}`));
    if (d.suggestions) {
      for (const s of d.suggestions) lines.push(chalk.gray(`    → ${s}`));
    }
    if (d.fix) lines.push(chalk.gray(`    Fix: ${d.fix.description}`));
  }

  lines.push('');
  lines.push(chalk.gray(`  ${stats.errors} error(s), ${stats.warnings} warning(s), ${stats.info} info — ${stats.fixable} fixable`));
  lines.push(chalk.gray(`  Score: ${score}/100`));
  return lines.join('\n');
}

function formatStylish(result: LintResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.underline(result.file));
  for (const d of result.diagnostics) {
    const icon = d.severity === 'error' ? chalk.red('✖') : d.severity === 'warning' ? chalk.yellow('⚠') : chalk.blue('ℹ');
    lines.push(`  ${icon} ${chalk.gray(`${d.line}:${d.column}`)} ${d.message} ${chalk.gray(d.ruleId)}`);
  }
  if (result.diagnostics.length === 0) {
    lines.push(chalk.green('  No issues.'));
  }
  lines.push('');
  return lines.join('\n');
}

function formatCompact(result: LintResult): string {
  const parts: string[] = [];
  for (const d of result.diagnostics) {
    parts.push(`${result.file}:${d.line}:${d.column}: ${d.severity} ${d.ruleId} ${d.message}`);
  }
  if (parts.length === 0) {
    parts.push(`${result.file}: no issues`);
  }
  return parts.join('\n');
}

function formatJSON(result: LintResult): string {
  return JSON.stringify(result, null, 2);
}

// ============================================================================
// Fix Engine
// ============================================================================

function applyFixes(content: string, diagnostics: LintDiagnostic[]): string {
  let result = content;
  for (const d of diagnostics) {
    if (!d.fix) continue;
    if (d.ruleId === 'STY001') result = result.replace(/[ \t]+$/gm, '');
    else if (d.ruleId === 'STY002') result = result.replace(/\n{3,}/g, '\n\n');
    else if (d.ruleId === 'STY003' && !result.endsWith('\n')) result += '\n';
  }
  return result;
}

// ============================================================================
// Baseline
// ============================================================================

async function loadBaseline(filePath: string): Promise<LintBaseline | null> {
  try {
    const basePath = filePath + '.lint-baseline.json';
    await access(basePath);
    const content = await readFile(basePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveBaseline(filePath: string, result: LintResult): Promise<void> {
  try {
    const basePath = filePath + '.lint-baseline.json';
    const baseline: LintBaseline = { file: filePath, timestamp: Date.now(), diagnostics: result.diagnostics, stats: result.stats };
    await writeFile(basePath, JSON.stringify(baseline, null, 2), 'utf-8');
  } catch {
    // Silently fail
  }
}

function compareWithBaseline(current: LintDiagnostic[], baseline: LintBaseline | null): { new: LintDiagnostic[]; fixed: LintDiagnostic[] } {
  if (!baseline) return { new: current, fixed: [] };
  const baselineIds = new Set(baseline.diagnostics.map(d => `${d.ruleId}:${d.line}:${d.column}`));
  const currentIds = new Set(current.map(d => `${d.ruleId}:${d.line}:${d.column}`));
  return {
    new: current.filter(d => !baselineIds.has(`${d.ruleId}:${d.line}:${d.column}`)),
    fixed: baseline.diagnostics.filter(d => !currentIds.has(`${d.ruleId}:${d.line}:${d.column}`)),
  };
}

// ============================================================================
// Scoring
// ============================================================================

function calculateScore(diagnostics: LintDiagnostic[]): number {
  let score = 100;
  for (const d of diagnostics) {
    if (d.severity === 'error') score -= 10;
    else if (d.severity === 'warning') score -= 3;
    else if (d.severity === 'info') score -= 1;
  }
  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// Linter
// ============================================================================

export class MAMLinter {
  private rules: LintRuleDefinition[];
  private config: MAMConfig;
  private configOverrides?: Record<string, any>;

  constructor(options: Partial<LintOptions> = {}) {
    this.config = {};
    this.rules = [...BUILT_IN_RULES];
    this.configOverrides = undefined;
  }

  async loadConfig(configPath?: string): Promise<void> {
    this.config = await loadConfig(configPath);
    // Try loading .mamlintrc.json
    try {
      const rcPath = join(process.cwd(), '.mamlintrc.json');
      await access(rcPath);
      const content = await readFile(rcPath, 'utf-8');
      const rc: LintConfigFile = JSON.parse(content);
      this.configOverrides = rc.rules;
      if (rc.ignore) {
        (this.config.ignore as string[]) = [...(this.config.ignore || []), ...rc.ignore];
      }
    } catch {
      // No .mamlintrc.json found
    }
  }

  addRule(rule: LintRuleDefinition): void {
    this.rules.push(rule);
  }

  getRules(): LintRuleDefinition[] {
    return [...this.rules];
  }

  async lintFile(filePath: string, options: LintOptions): Promise<LintResult> {
    const absPath = resolve(filePath);

    const ignorePatterns = [...DEFAULT_IGNORE, ...(options.ignore || []), ...(this.config.ignore || [])];
    if (shouldIgnore(absPath, ignorePatterns)) {
      return { file: absPath, passed: true, diagnostics: [], stats: { timeMs: 0, rulesChecked: 0, errors: 0, warnings: 0, info: 0, fixable: 0, linesChecked: 0, filesScanned: 0 }, score: 100 };
    }

    const content = await readFile(absPath, 'utf-8');
    return this.lintContent(content, absPath, options);
  }

  lintContent(content: string, filePath: string, options: LintOptions): LintResult {
    const startTime = Date.now();
    const lines = content.split('\n');

    const parseResult = parseMAM(content, { source: filePath });
    const frontmatter = parseFrontmatter(content);
    const sections = parseSections(lines);
    const codeBlocks = parseCodeBlocks(lines);
    const links = parseLinks(lines);
    const tables = parseTables(lines);
    const lineLengths = lines.map(l => l.length);

    const ctx: LintContext = {
      content, lines, ast: parseResult.ast, filePath, config: this.config,
      frontmatter, sections, codeBlocks, links, tables, lineLengths,
    };

    // Determine active rules
    let activeRules = filterByGroup(this.rules, options.group);
    activeRules = filterByRules(activeRules, options.rules);

    // Run rules
    let diagnostics: LintDiagnostic[] = [];
    for (const rule of activeRules) {
      const severity = resolveSeverity(rule, this.configOverrides);
      if (severity === 'off') continue;
      try {
        const results = rule.check(ctx);
        for (const r of results) {
          r.severity = severity;
          diagnostics.push(r);
        }
      } catch (err) {
        diagnostics.push({ ruleId: rule.id, message: `Rule failed: ${(err as Error).message}`, severity: 'error', line: 0, column: 0, source: filePath, group: rule.group[0] || 'custom', category: rule.category });
      }
    }

    // Add parse errors
    for (const error of parseResult.errors) {
      diagnostics.push({ ruleId: 'PARSE_ERROR', message: error.message, severity: 'error', line: (error as any).line || 0, column: (error as any).column || 0, source: filePath, group: 'recommended', category: 'parse' });
    }

    // Severity filtering
    if (options.level) {
      const minIdx = SEVERITY_ORDER.indexOf(options.level);
      diagnostics = diagnostics.filter(d => SEVERITY_ORDER.indexOf(d.severity as LintSeverity) >= minIdx);
    }

    // Max errors
    if (options.maxErrors && options.maxErrors > 0) {
      const errCount = diagnostics.filter(d => d.severity === 'error').length;
      if (errCount > options.maxErrors) {
        diagnostics = diagnostics.filter(d => d.severity !== 'error').slice(0, options.maxErrors);
        diagnostics.push({ ruleId: 'LIMIT', message: `Too many errors (exceeded ${options.maxErrors})`, severity: 'error', line: 0, column: 0, source: filePath, group: 'recommended', category: 'limit' });
      }
    }

    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    const info = diagnostics.filter(d => d.severity === 'info').length;
    const fixable = diagnostics.filter(d => d.fix).length;
    const score = calculateScore(diagnostics);

    return {
      file: filePath,
      passed: errors === 0,
      diagnostics,
      stats: { timeMs: Date.now() - startTime, rulesChecked: activeRules.length, errors, warnings, info, fixable, linesChecked: lines.length, filesScanned: 1 },
      score,
    };
  }
}

// ============================================================================
// Command
// ============================================================================

export async function lintCommand(options: LintOptions): Promise<void> {
  const startTime = Date.now();
  const spinner = options.quiet ? null : ora('Linting module...').start();

  try {
    const linter = new MAMLinter(options);
    await linter.loadConfig(options.config);

    const filePath = resolve(options.file);
    const result = await linter.lintFile(filePath, options);

    if (spinner) spinner.stop();

    // Baseline comparison
    let baseline: LintBaseline | null = null;
    if (options.baseline) {
      baseline = await loadBaseline(options.baseline);
    } else {
      baseline = await loadBaseline(filePath);
    }
    const changes = compareWithBaseline(result.diagnostics, baseline);

    // Apply fixes
    if (options.fix && result.diagnostics.some(d => d.fix)) {
      const content = await readFile(filePath, 'utf-8');
      const fixed = applyFixes(content, result.diagnostics);
      await writeFile(filePath, fixed, 'utf-8');
      if (!options.quiet) console.log(chalk.green(`  Applied fixes to ${filePath}`));
    }

    // Save new baseline
    await saveBaseline(filePath, result);

    // Output
    const format = options.format || 'text';
    let output: string;
    switch (format) {
      case 'json': output = formatJSON(result); break;
      case 'stylish': output = formatStylish(result); break;
      case 'compact': output = formatCompact(result); break;
      default: output = formatText(result);
    }

    if (!options.quiet || format !== 'text') {
      console.log(output);
    }

    // Baseline summary
    if (!options.quiet && changes.new.length > 0) {
      console.log(chalk.yellow(`\n  ${changes.new.length} new issue(s) since baseline`));
    }
    if (!options.quiet && changes.fixed.length > 0) {
      console.log(chalk.green(`  ${changes.fixed.length} issue(s) fixed since baseline`));
    }

    // Summary
    if (!options.quiet && format === 'text') {
      const totalTime = Date.now() - startTime;
      console.log(chalk.gray(`\n  Linted in ${totalTime}ms | ${result.stats.rulesChecked} rules | Score: ${result.score}/100`));
    }

    // Save baseline if requested
    if (options.baseline) {
      await saveBaseline(options.baseline, result);
      if (!options.quiet) console.log(chalk.gray(`  Baseline saved to ${options.baseline}`));
    }

    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    if (spinner) spinner.fail((error as Error).message);
    else console.error(chalk.red(`  Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export default lintCommand;
