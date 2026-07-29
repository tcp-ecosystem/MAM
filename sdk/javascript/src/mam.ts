/**
 * MAM Module Builder and Utilities
 *
 * Fluent API for constructing, serializing, comparing, and diffing MAM modules.
 */

import type {
  AST,
  FrontMatter,
  Section,
  ContentNode,
  SourceLocation,
  ModuleMetadata,
  ParseResult,
} from './parser.js';
import { parseMAM } from './parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MAMModuleConfig {
  name: string;
  version?: string;
  author?: string;
  description?: string;
  id?: string;
  runtime?: string;
  tags?: string[];
  permissions?: string[];
  dependencies?: string[];
  mamVersion?: string;
  license?: string;
  repository?: string;
}

export type DiffChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffChange {
  type: DiffChangeType;
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffResult {
  changes: DiffChange[];
  identical: boolean;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export interface ModuleDiff {
  frontmatter: DiffChange[];
  sections: DiffChange[];
  content: DiffChange[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultLocation(source: string = '<generated>'): SourceLocation {
  return {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 0, offset: 0 },
    source,
  };
}

function buildFrontMatter(data: Record<string, unknown>, source?: string): FrontMatter {
  return {
    type: 'FrontMatter',
    data,
    location: defaultLocation(source),
  };
}

function buildSection(name: string, content: ContentNode[], source?: string): Section {
  return {
    type: 'Section',
    name,
    level: 2,
    content,
    location: defaultLocation(source),
  };
}

function buildParagraph(value: string, source?: string): ContentNode {
  return {
    type: 'Paragraph',
    value,
    location: defaultLocation(source),
  };
}

function buildCodeBlock(language: string, value: string, source?: string): ContentNode {
  return {
    type: 'CodeBlock',
    value,
    language,
    location: defaultLocation(source),
  };
}

function buildList(items: string[], source?: string): ContentNode {
  return {
    type: 'List',
    value: items.map((i) => `- ${i}`).join('\n'),
    items,
    location: defaultLocation(source),
  };
}

// ---------------------------------------------------------------------------
// MAMModule class
// ---------------------------------------------------------------------------

export class MAMModule {
  private _config: MAMModuleConfig;
  private _sections: Section[];
  private _rawMarkdown: string;
  private _source: string;

  constructor(config: MAMModuleConfig) {
    this._config = {
      version: '0.1.0',
      runtime: 'python',
      tags: [],
      permissions: [],
      dependencies: [],
      mamVersion: '1.0.0',
      license: 'MIT',
      ...config,
    };
    this._sections = [];
    this._rawMarkdown = '';
    this._source = '<generated>';
  }

  // --- Getters ---

  get name(): string { return this._config.name; }
  get version(): string { return this._config.version ?? '0.1.0'; }
  get author(): string | undefined { return this._config.author; }
  get description(): string | undefined { return this._config.description; }
  get id(): string { return this._config.id ?? this._config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  get runtime(): string { return this._config.runtime ?? 'python'; }
  get tags(): string[] { return this._config.tags ?? []; }
  get permissions(): string[] { return this._config.permissions ?? []; }
  get dependencies(): string[] { return this._config.dependencies ?? []; }
  get sections(): readonly Section[] { return this._sections; }
  get rawMarkdown(): string { return this._rawMarkdown; }

  // --- Setters (fluent) ---

  setName(name: string): this {
    this._config.name = name;
    return this;
  }

  setVersion(version: string): this {
    this._config.version = version;
    return this;
  }

  setAuthor(author: string): this {
    this._config.author = author;
    return this;
  }

  setDescription(description: string): this {
    this._config.description = description;
    return this;
  }

  setRuntime(runtime: string): this {
    this._config.runtime = runtime;
    return this;
  }

  setTags(tags: string[]): this {
    this._config.tags = tags;
    return this;
  }

  setPermissions(permissions: string[]): this {
    this._config.permissions = permissions;
    return this;
  }

  setDependencies(dependencies: string[]): this {
    this._config.dependencies = dependencies;
    return this;
  }

  // --- Section management ---

  addSection(name: string, content: ContentNode[]): this {
    const existing = this._sections.findIndex((s) => s.name === name);
    const section = buildSection(name, content, this._source);
    if (existing >= 0) {
      this._sections[existing] = section;
    } else {
      this._sections.push(section);
    }
    return this;
  }

  addSectionText(name: string, text: string): this {
    return this.addSection(name, [buildParagraph(text, this._source)]);
  }

  addSectionList(name: string, items: string[]): this {
    return this.addSection(name, [buildList(items, this._source)]);
  }

  addSectionCode(name: string, language: string, code: string): this {
    return this.addSection(name, [buildCodeBlock(language, code, this._source)]);
  }

  getSection(name: string): Section | undefined {
    return this._sections.find((s) => s.name === name);
  }

  getSectionContent(name: string): ContentNode[] | undefined {
    return this.getSection(name)?.content;
  }

  removeSection(name: string): this {
    this._sections = this._sections.filter((s) => s.name !== name);
    return this;
  }

  hasSection(name: string): boolean {
    return this._sections.some((s) => s.name === name);
  }

  sectionNames(): string[] {
    return this._sections.map((s) => s.name);
  }

  // --- Build frontmatter data ---

  private buildFrontMatterData(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      id: this.id,
      version: this.version,
      name: this._config.name,
      author: this._config.author ?? 'Unknown',
      runtime: this.runtime,
    };

    if (this._config.description) data.description = this._config.description;
    if (this._config.tags && this._config.tags.length > 0) data.tags = this._config.tags;
    if (this._config.permissions && this._config.permissions.length > 0) data.permissions = this._config.permissions;
    if (this._config.dependencies && this._config.dependencies.length > 0) data.dependencies = this._config.dependencies;
    if (this._config.mamVersion) data.mam_version = this._config.mamVersion;
    if (this._config.license) data.license = this._config.license;
    if (this._config.repository) data.repository = this._config.repository;

    return data;
  }

  // --- Build AST ---

  toAST(): AST {
    const frontmatter = buildFrontMatter(this.buildFrontMatterData(), this._source);
    return {
      type: 'MAMModule',
      frontmatter,
      sections: [...this._sections],
      location: defaultLocation(this._source),
      metadata: {
        totalSections: this._sections.length,
        totalCodeBlocks: this._sections.reduce(
          (acc, s) => acc + s.content.filter((c) => c.type === 'CodeBlock').length,
          0,
        ),
        totalLines: 0,
        sourceName: this._source,
      },
    };
  }

  // --- Serialization ---

  toJSON(): Record<string, unknown> {
    const fm = this.buildFrontMatterData();
    return {
      frontmatter: fm,
      sections: this._sections.map((s) => ({
        name: s.name,
        level: s.level,
        content: s.content.map((c) => ({
          type: c.type,
          value: c.value,
          ...(c.language ? { language: c.language } : {}),
          ...(c.items ? { items: c.items } : {}),
          ...(c.rows ? { rows: c.rows } : {}),
        })),
      })),
    };
  }

  toYAML(): string {
    const fm = this.buildFrontMatterData();
    const lines: string[] = ['---'];

    for (const [key, value] of Object.entries(fm)) {
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      } else if (typeof value === 'string' && value.includes('\n')) {
        lines.push(`${key}: |`);
        for (const line of value.split('\n')) {
          lines.push(`  ${line}`);
        }
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    lines.push('---');
    lines.push('');

    for (const section of this._sections) {
      lines.push(`## ${section.name}`);
      lines.push('');
      for (const node of section.content) {
        switch (node.type) {
          case 'CodeBlock':
            lines.push('```' + (node.language ?? ''));
            lines.push(node.value);
            lines.push('```');
            break;
          case 'List':
            for (const item of (node.items ?? [])) {
              lines.push(`- ${item}`);
            }
            break;
          case 'Table':
            lines.push(node.value);
            break;
          default:
            lines.push(node.value);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  toMarkdown(): string {
    return this.toYAML();
  }

  // --- Clone ---

  clone(): MAMModule {
    const mod = new MAMModule({ ...this._config });
    mod._sections = JSON.parse(JSON.stringify(this._sections));
    mod._rawMarkdown = this._rawMarkdown;
    mod._source = this._source;
    return mod;
  }
}

// ---------------------------------------------------------------------------
// Static factory: from parsed AST
// ---------------------------------------------------------------------------

export function fromAST(ast: AST): MAMModule {
  const fm = ast.frontmatter?.data ?? {};
  const mod = new MAMModule({
    name: (fm.name as string) ?? 'unnamed',
    version: (fm.version as string) ?? '0.1.0',
    author: fm.author as string | undefined,
    description: fm.description as string | undefined,
    id: fm.id as string | undefined,
    runtime: fm.runtime as string | undefined,
    tags: fm.tags as string[] | undefined,
    permissions: fm.permissions as string[] | undefined,
    dependencies: fm.dependencies as string[] | undefined,
    mamVersion: (fm.mam_version as string) ?? '1.0.0',
    license: fm.license as string | undefined,
    repository: fm.repository as string | undefined,
  });
  for (const section of ast.sections) {
    mod.addSection(section.name, section.content);
  }
  return mod;
}

// ---------------------------------------------------------------------------
// Static factory: from raw markdown
// ---------------------------------------------------------------------------

export function fromMarkdown(content: string, source?: string): MAMModule {
  const result = parseMAM(content, { source });
  return fromAST(result.ast);
}

// ---------------------------------------------------------------------------
// Module comparison and diffing
// ---------------------------------------------------------------------------

function diffValues(a: unknown, b: unknown, path: string): DiffChange[] {
  if (a === b) return [];
  if (a === undefined || a === null) {
    return [{ type: 'added', path, newValue: b }];
  }
  if (b === undefined || b === null) {
    return [{ type: 'removed', path, oldValue: a }];
  }
  if (typeof a !== typeof b) {
    return [{ type: 'modified', path, oldValue: a, newValue: b }];
  }
  if (typeof a !== 'object') {
    if (a !== b) return [{ type: 'modified', path, oldValue: a, newValue: b }];
    return [];
  }
  // Both are arrays or objects
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const changes: DiffChange[] = [];
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of allKeys) {
    changes.push(...diffValues(aObj[key], bObj[key], `${path}.${key}`));
  }
  return changes;
}

export function diffModules(a: MAMModule, b: MAMModule): DiffResult {
  const changes: DiffChange[] = [];

  // Diff frontmatter
  const aFm = a.toJSON().frontmatter as Record<string, unknown>;
  const bFm = b.toJSON().frontmatter as Record<string, unknown>;
  changes.push(...diffValues(aFm, bFm, 'frontmatter'));

  // Diff sections
  const aSections = a.sections;
  const bSections = b.sections;
  const aNames = new Set(aSections.map((s) => s.name));
  const bNames = new Set(bSections.map((s) => s.name));

  for (const name of aNames) {
    if (!bNames.has(name)) {
      changes.push({ type: 'removed', path: `sections.${name}`, oldValue: a.getSection(name) });
    }
  }
  for (const name of bNames) {
    if (!aNames.has(name)) {
      changes.push({ type: 'added', path: `sections.${name}`, newValue: b.getSection(name) });
    }
  }

  // Diff shared sections
  for (const name of aNames) {
    if (!bNames.has(name)) continue;
    const secA = a.getSection(name)!;
    const secB = b.getSection(name)!;
    changes.push(...diffValues(secA.content, secB.content, `sections.${name}.content`));
  }

  const summary = {
    added: changes.filter((c) => c.type === 'added').length,
    removed: changes.filter((c) => c.type === 'removed').length,
    modified: changes.filter((c) => c.type === 'modified').length,
    unchanged: 0,
  };

  return {
    changes,
    identical: changes.length === 0,
    summary,
  };
}

export function compareModules(a: MAMModule, b: MAMModule): ModuleDiff {
  const frontmatterChanges: DiffChange[] = [];
  const sectionChanges: DiffChange[] = [];
  const contentChanges: DiffChange[] = [];

  // Compare frontmatter
  const aFm = a.toJSON().frontmatter as Record<string, unknown>;
  const bFm = b.toJSON().frontmatter as Record<string, unknown>;
  frontmatterChanges.push(...diffValues(aFm, bFm, 'frontmatter'));

  // Compare sections
  const aSecs = a.sections;
  const bSecs = b.sections;
  const aNames = new Set(aSecs.map((s) => s.name));
  const bNames = new Set(bSecs.map((s) => s.name));

  for (const name of aNames) {
    if (!bNames.has(name)) {
      sectionChanges.push({ type: 'removed', path: name, oldValue: a.getSection(name) });
    }
  }
  for (const name of bNames) {
    if (!aNames.has(name)) {
      sectionChanges.push({ type: 'added', path: name, newValue: b.getSection(name) });
    }
  }

  // Compare content of shared sections
  for (const name of aNames) {
    if (!bNames.has(name)) continue;
    const secA = a.getSection(name)!;
    const secB = b.getSection(name)!;
    const maxLen = Math.max(secA.content.length, secB.content.length);
    for (let i = 0; i < maxLen; i++) {
      const cA = secA.content[i];
      const cB = secB.content[i];
      if (!cA) {
        contentChanges.push({ type: 'added', path: `${name}[${i}]`, newValue: cB });
      } else if (!cB) {
        contentChanges.push({ type: 'removed', path: `${name}[${i}]`, oldValue: cA });
      } else if (cA.type !== cB.type || cA.value !== cB.value || cA.language !== cB.language) {
        contentChanges.push({ type: 'modified', path: `${name}[${i}]`, oldValue: cA, newValue: cB });
      }
    }
  }

  return { frontmatter: frontmatterChanges, sections: sectionChanges, content: contentChanges };
}
