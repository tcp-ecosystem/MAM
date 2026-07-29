/**
 * MAM Migrate Command
 *
 * Migrates MAM modules from v1 to v2 format with full transformation rules,
 * backup support, dry-run mode, batch migration, rollback, and detailed reporting.
 */

import { readFile, writeFile, readdir, stat, access, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, relative, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export type MigrationFormat = 'text' | 'json' | 'markdown';

export interface MigrateOptions {
  file?: string;
  dir?: string;
  inPlace?: boolean;
  backup?: boolean;
  dryRun?: boolean;
  format?: MigrationFormat;
  rollback?: boolean;
  rollbackFile?: string;
  batch?: boolean;
  customRules?: string;
  verbose?: boolean;
  json?: boolean;
  markdown?: boolean;
  force?: boolean;
}

export interface MigrationChange {
  type: 'frontmatter' | 'section' | 'codeblock' | 'reference' | 'dependency' | 'structural' | 'metadata';
  category: string;
  description: string;
  before?: string;
  after?: string;
  line?: number;
  severity: 'info' | 'warning' | 'error';
}

export interface MigrationReport {
  file: string;
  originalVersion: string;
  targetVersion: string;
  timestamp: string;
  changes: MigrationChange[];
  summary: {
    total: number;
    frontmatter: number;
    sections: number;
    codeblocks: number;
    references: number;
    dependencies: number;
    structural: number;
    metadata: number;
  };
  success: boolean;
  dryRun: boolean;
  backupPath?: string;
  outputPath?: string;
  durationMs: number;
  errors: string[];
  warnings: string[];
}

export interface FrontmatterData {
  [key: string]: unknown;
}

export interface ParsedModule {
  frontmatter: FrontmatterData;
  frontmatterRaw: string;
  body: string;
  sections: ParsedSection[];
}

export interface ParsedSection {
  title: string;
  level: number;
  content: string;
  codeBlocks: CodeBlock[];
  line: number;
}

export interface CodeBlock {
  language: string;
  content: string;
  line: number;
}

export interface MigrationRule {
  name: string;
  description: string;
  transform: (module: ParsedModule, changes: MigrationChange[]) => ParsedModule;
}

// ============================================================================
// Constants
// ============================================================================

const MAM_V1_VERSION = '1.0.0';
const MAM_V2_VERSION = '2.0.0';

const V1_TO_V2_FRONTMATTER_RENAMES: Record<string, string> = {
  title: 'name',
  module_name: 'name',
  module_name_en: 'name',
  module_version: 'version',
  mod_version: 'version',
  module_description: 'description',
  mod_description: 'description',
  lang: 'runtime',
  language: 'runtime',
  module_lang: 'runtime',
  module_runtime: 'runtime',
  author_name: 'author',
  author_email: 'author',
  maintainer: 'author',
  keywords: 'tags',
  categories: 'tags',
  module_tags: 'tags',
  req_permissions: 'permissions',
  required_permissions: 'permissions',
  module_permissions: 'permissions',
  api_version: 'apiVersion',
  mam_version: 'mamVersion',
  min_mam_version: 'minMamVersion',
  format_version: 'formatVersion',
};

const V2_REQUIRED_FIELDS = ['name', 'version', 'runtime'];
const V2_RECOMMENDED_FIELDS = ['description', 'author', 'tags'];

const CODEBLOCK_LANGUAGE_MIGRATIONS: Record<string, string> = {
  'py': 'python',
  'js': 'javascript',
  'ts': 'typescript',
  'rb': 'ruby',
  'sh': 'bash',
  'shell': 'bash',
  'yml': 'yaml',
  'dockerfile': 'docker',
  'tf': 'hcl',
  'rs': 'rust',
  'kt': 'kotlin',
  'cs': 'csharp',
  'objc': 'objective-c',
  'objc++': 'objective-cpp',
  'plain': 'text',
  'plaintext': 'text',
  'txt': 'text',
  'src': 'text',
  'output': 'text',
  'console': 'text',
  'text': 'text',
};

const REFERENCE_URL_UPDATES: Record<string, string> = {
  'https://mam.dev/v1': 'https://mam.dev/v2',
  'https://mam.dev/docs/v1': 'https://mam.dev/docs/v2',
  'https://mam.dev/api/v1': 'https://mam.dev/api/v2',
  'https://github.com/mam/mam/blob/main/README.md': 'https://github.com/mam/mam',
  'https://raw.githubusercontent.com/mam/mam/main/README.md': 'https://mam.dev',
};

const SECTION_RENAMES: Record<string, string> = {
  'Module Overview': 'Overview',
  'Module Description': 'Description',
  'Dependencies': 'Requirements',
  'Usage Example': 'Examples',
  'API Reference': 'API',
  'Error Handling': 'Errors',
  'Configuration Options': 'Configuration',
  'Environment Variables': 'Environment',
  'Testing Instructions': 'Testing',
  'Deployment Guide': 'Deployment',
  'Changelog': 'Changes',
  'License Information': 'License',
};

const DEPENDENCY_MIGRATIONS: Record<string, string> = {
  'mam-parser@1': '@mam/parser@2',
  'mam-compiler@1': '@mam/compiler@2',
  'mam-validator@1': '@mam/validator@2',
  'mam-runtime@1': '@mam/runtime@2',
  'mam-ast@1': '@mam/ast@2',
  'mam-core@1': '@mam/core@2',
  'mam-utils@1': '@mam/utils@2',
};

// ============================================================================
// Parsing
// ============================================================================

function parseFrontmatter(raw: string): FrontmatterData {
  const data: FrontmatterData = {};
  const lines = raw.split('\n');
  let currentKey = '';
  let inList = false;
  let listItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (inList && (trimmed.startsWith('- ') || trimmed.startsWith('  - '))) {
      listItems.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }

    if (inList && currentKey) {
      data[currentKey] = listItems;
      inList = false;
      listItems = [];
      currentKey = '';
    }

    const colonMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (colonMatch) {
      const [, key, value] = colonMatch;
      currentKey = key;

      if (!value || value === '') {
        inList = true;
        listItems = [];
      } else if (value.startsWith('[')) {
        try {
          data[key] = JSON.parse(value);
        } catch {
          data[key] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
      } else if (value === 'true') {
        data[key] = true;
      } else if (value === 'false') {
        data[key] = false;
      } else if (/^\d+(\.\d+)?$/.test(value)) {
        data[key] = Number(value);
      } else {
        data[key] = value;
      }
    }
  }

  if (inList && currentKey) {
    data[currentKey] = listItems;
  }

  return data;
}

function parseSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = body.split('\n');
  let currentSection: ParsedSection | null = null;
  let contentLines: string[] = [];
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
      }

      const level = headingMatch[1].length;
      currentSection = {
        title: headingMatch[2].trim(),
        level,
        content: '',
        codeBlocks: [],
        line: lineNum,
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  for (const section of sections) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(section.content)) !== null) {
      section.codeBlocks.push({
        language: match[1] || '',
        content: match[2].trim(),
        line: section.line + (section.content.slice(0, match.index).split('\n').length - 1),
      });
    }
  }

  return sections;
}

function parseModule(content: string): ParsedModule {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  let frontmatterRaw = '';
  let frontmatter: FrontmatterData = {};
  let body = content;

  if (frontmatterMatch) {
    frontmatterRaw = frontmatterMatch[1];
    frontmatter = parseFrontmatter(frontmatterRaw);
    body = content.slice(frontmatterMatch[0].length).trim();
  }

  const sections = parseSections(body);

  return { frontmatter, frontmatterRaw, body, sections };
}

// ============================================================================
// Built-in Migration Rules
// ============================================================================

function ruleRenameFrontmatterFields(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter: FrontmatterData = {};

  for (const [key, value] of Object.entries(module.frontmatter)) {
    const newKey = V1_TO_V2_FRONTMATTER_RENAMES[key];
    if (newKey && newKey !== key) {
      changes.push({
        type: 'frontmatter',
        category: 'renamed',
        description: `Renamed field "${key}" to "${newKey}"`,
        before: `${key}: ${JSON.stringify(value)}`,
        after: `${newKey}: ${JSON.stringify(value)}`,
        severity: 'info',
      });
      if (!newFrontmatter[newKey]) {
        newFrontmatter[newKey] = value;
      }
    } else {
      newFrontmatter[key] = value;
    }
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleAddRequiredFields(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };

  if (!newFrontmatter.id) {
    const name = (newFrontmatter.name as string) || 'module';
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    newFrontmatter.id = id;
    changes.push({
      type: 'frontmatter',
      category: 'added',
      description: `Added required field "id" (derived from name: "${id}")`,
      after: `id: ${id}`,
      severity: 'info',
    });
  }

  if (!newFrontmatter.version) {
    newFrontmatter.version = MAM_V2_VERSION;
    changes.push({
      type: 'frontmatter',
      category: 'added',
      description: `Added required field "version" (set to "${MAM_V2_VERSION}")`,
      after: `version: ${MAM_V2_VERSION}`,
      severity: 'info',
    });
  }

  if (!newFrontmatter.runtime) {
    newFrontmatter.runtime = 'python';
    changes.push({
      type: 'frontmatter',
      category: 'added',
      description: 'Added required field "runtime" (default: python)',
      after: 'runtime: python',
      severity: 'warning',
    });
  }

  if (!newFrontmatter.mamVersion) {
    newFrontmatter.mamVersion = MAM_V2_VERSION;
    changes.push({
      type: 'frontmatter',
      category: 'added',
      description: `Added field "mamVersion" (set to "${MAM_V2_VERSION}")`,
      after: `mamVersion: ${MAM_V2_VERSION}`,
      severity: 'info',
    });
  }

  for (const field of V2_RECOMMENDED_FIELDS) {
    if (!newFrontmatter[field]) {
      changes.push({
        type: 'frontmatter',
        category: 'missing',
        description: `Recommended field "${field}" is missing`,
        severity: 'warning',
      });
    }
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleRemoveDeprecatedFields(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };
  const deprecatedFields = ['deprecated', 'obsolete', 'legacy', 'internal', 'private'];

  for (const field of deprecatedFields) {
    if (field in newFrontmatter) {
      delete newFrontmatter[field];
      changes.push({
        type: 'frontmatter',
        category: 'removed',
        description: `Removed deprecated field "${field}"`,
        before: `${field}: ${JSON.stringify(newFrontmatter[field])}`,
        severity: 'info',
      });
    }
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleNormalizeVersion(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };
  const version = newFrontmatter.version;

  if (typeof version === 'string') {
    const cleaned = version.replace(/^[vV]/, '');
    if (cleaned !== version) {
      newFrontmatter.version = cleaned;
      changes.push({
        type: 'frontmatter',
        category: 'normalized',
        description: `Normalized version from "${version}" to "${cleaned}"`,
        before: `version: ${version}`,
        after: `version: ${cleaned}`,
        severity: 'info',
      });
    }

    const parts = cleaned.split('.');
    if (parts.length === 2) {
      newFrontmatter.version = `${cleaned}.0`;
      changes.push({
        type: 'frontmatter',
        category: 'normalized',
        description: `Expanded version from "${cleaned}" to "${newFrontmatter.version}"`,
        before: `version: ${cleaned}`,
        after: `version: ${newFrontmatter.version}`,
        severity: 'info',
      });
    }
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleNormalizeTags(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };
  const tags = newFrontmatter.tags;

  if (typeof tags === 'string') {
    const parsed = (tags as string).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    newFrontmatter.tags = parsed;
    changes.push({
      type: 'frontmatter',
      category: 'normalized',
      description: `Normalized tags from string to array`,
      before: `tags: ${tags}`,
      after: `tags: [${parsed.join(', ')}]`,
      severity: 'info',
    });
  } else if (Array.isArray(tags)) {
    const normalized = (tags as string[]).map(t => String(t).trim().toLowerCase()).filter(Boolean);
    const original = JSON.stringify(tags);
    const updated = JSON.stringify(normalized);
    if (original !== updated) {
      newFrontmatter.tags = normalized;
      changes.push({
        type: 'frontmatter',
        category: 'normalized',
        description: `Normalized tags (lowercased, trimmed)`,
        before: `tags: ${original}`,
        after: `tags: ${updated}`,
        severity: 'info',
      });
    }
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleRenameSections(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newBody = module.body;
  let modified = false;

  for (const [oldName, newName] of Object.entries(SECTION_RENAMES)) {
    const regex = new RegExp(`^(#{1,6})\\s+${escapeRegex(oldName)}\\s*$`, 'gm');
    const match = regex.exec(newBody);
    if (match) {
      changes.push({
        type: 'section',
        category: 'renamed',
        description: `Renamed section "${oldName}" to "${newName}"`,
        before: `## ${oldName}`,
        after: `## ${newName}`,
        line: newBody.slice(0, match.index).split('\n').length,
        severity: 'info',
      });
      modified = true;
    }
  }

  if (!modified) return module;

  let result = newBody;
  for (const [oldName, newName] of Object.entries(SECTION_RENAMES)) {
    const regex = new RegExp(`^(#{1,6})\\s+${escapeRegex(oldName)}\\s*$`, 'gm');
    result = result.replace(regex, `$1 ${newName}`);
  }

  return { ...module, body: result };
}

function ruleUpdateCodeBlockLanguages(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  let result = module.body;
  let modified = false;

  const regex = /```(\w+)\n/g;
  let match;

  while ((match = regex.exec(module.body)) !== null) {
    const oldLang = match[1].toLowerCase();
    const newLang = CODEBLOCK_LANGUAGE_MIGRATIONS[oldLang];

    if (newLang && newLang !== oldLang) {
      changes.push({
        type: 'codeblock',
        category: 'language',
        description: `Updated code block language from "${oldLang}" to "${newLang}"`,
        before: '```' + oldLang,
        after: '```' + newLang,
        line: module.body.slice(0, match.index).split('\n').length,
        severity: 'info',
      });
      modified = true;
    }
  }

  if (!modified) return module;

  result = module.body;
  for (const [oldLang, newLang] of Object.entries(CODEBLOCK_LANGUAGE_MIGRATIONS)) {
    const langRegex = new RegExp(`^\`\`\`${escapeRegex(oldLang)}\\s*$`, 'gm');
    result = result.replace(langRegex, '```' + newLang);
  }

  return { ...module, body: result };
}

function ruleUpdateReferences(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  let result = module.body;
  let modified = false;

  for (const [oldUrl, newUrl] of Object.entries(REFERENCE_URL_UPDATES)) {
    if (result.includes(oldUrl)) {
      changes.push({
        type: 'reference',
        category: 'url',
        description: `Updated reference URL`,
        before: oldUrl,
        after: newUrl,
        severity: 'info',
      });
      modified = true;
    }
  }

  if (!modified) return module;

  result = module.body;
  for (const [oldUrl, newUrl] of Object.entries(REFERENCE_URL_UPDATES)) {
    result = result.split(oldUrl).join(newUrl);
  }

  return { ...module, body: result };
}

function ruleMigrateDependencies(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };
  const deps = newFrontmatter.dependencies;

  if (!Array.isArray(deps)) return module;

  const newDeps: string[] = [];
  let modified = false;

  for (const dep of deps) {
    const depStr = String(dep);
    const migrated = DEPENDENCY_MIGRATIONS[depStr];
    if (migrated) {
      changes.push({
        type: 'dependency',
        category: 'migration',
        description: `Migrated dependency`,
        before: depStr,
        after: migrated,
        severity: 'info',
      });
      newDeps.push(migrated);
      modified = true;
    } else {
      newDeps.push(depStr);
    }
  }

  if (modified) {
    newFrontmatter.dependencies = newDeps;
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleAddMetadata(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  const newFrontmatter = { ...module.frontmatter };

  if (!newFrontmatter.formatVersion) {
    newFrontmatter.formatVersion = 2;
    changes.push({
      type: 'metadata',
      category: 'added',
      description: 'Added formatVersion: 2',
      after: 'formatVersion: 2',
      severity: 'info',
    });
  }

  if (!newFrontmatter.migratedFrom) {
    newFrontmatter.migratedFrom = 'v1';
    changes.push({
      type: 'metadata',
      category: 'added',
      description: 'Added migratedFrom: v1',
      after: 'migratedFrom: v1',
      severity: 'info',
    });
  }

  if (!newFrontmatter.migratedAt) {
    newFrontmatter.migratedAt = new Date().toISOString();
    changes.push({
      type: 'metadata',
      category: 'added',
      description: 'Added migratedAt timestamp',
      after: `migratedAt: ${newFrontmatter.migratedAt}`,
      severity: 'info',
    });
  }

  return { ...module, frontmatter: newFrontmatter };
}

function ruleNormalizeWhitespace(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  let result = module.body;
  let modified = false;

  const trailingWhitespace = /[ \t]+$/gm;
  if (trailingWhitespace.test(result)) {
    modified = true;
    result = result.replace(trailingWhitespace, '');
  }

  const multipleBlankLines = /\n{3,}/g;
  if (multipleBlankLines.test(result)) {
    modified = true;
    result = result.replace(multipleBlankLines, '\n\n');
  }

  if (modified) {
    changes.push({
      type: 'structural',
      category: 'whitespace',
      description: 'Normalized whitespace (trailing spaces, multiple blank lines)',
      severity: 'info',
    });
  }

  return { ...module, body: result };
}

function ruleEnsureTrailingNewline(module: ParsedModule, changes: MigrationChange[]): ParsedModule {
  if (module.body.length > 0 && !module.body.endsWith('\n')) {
    changes.push({
      type: 'structural',
      category: 'formatting',
      description: 'Added trailing newline',
      severity: 'info',
    });
    return { ...module, body: module.body + '\n' };
  }
  return module;
}

// ============================================================================
// Built-in Rules Registry
// ============================================================================

function getBuiltinRules(): MigrationRule[] {
  return [
    { name: 'rename-frontmatter-fields', description: 'Rename v1 frontmatter fields to v2 equivalents', transform: ruleRenameFrontmatterFields },
    { name: 'add-required-fields', description: 'Add required v2 fields (id, version, runtime, mamVersion)', transform: ruleAddRequiredFields },
    { name: 'remove-deprecated-fields', description: 'Remove deprecated frontmatter fields', transform: ruleRemoveDeprecatedFields },
    { name: 'normalize-version', description: 'Normalize version strings (remove v prefix, expand to 3 parts)', transform: ruleNormalizeVersion },
    { name: 'normalize-tags', description: 'Normalize tags to lowercase trimmed array', transform: ruleNormalizeTags },
    { name: 'rename-sections', description: 'Rename v1 section titles to v2 equivalents', transform: ruleRenameSections },
    { name: 'update-codeblock-languages', description: 'Update shorthand code block languages', transform: ruleUpdateCodeBlockLanguages },
    { name: 'update-references', description: 'Update v1 URLs to v2 equivalents', transform: ruleUpdateReferences },
    { name: 'migrate-dependencies', description: 'Migrate v1 package names to v2 scoped packages', transform: ruleMigrateDependencies },
    { name: 'add-metadata', description: 'Add v2 metadata (formatVersion, migratedFrom, migratedAt)', transform: ruleAddMetadata },
    { name: 'normalize-whitespace', description: 'Normalize trailing whitespace and multiple blank lines', transform: ruleNormalizeWhitespace },
    { name: 'ensure-trailing-newline', description: 'Ensure file ends with a newline', transform: ruleEnsureTrailingNewline },
  ];
}

// ============================================================================
// Output Generation
// ============================================================================

function generateFrontmatterString(data: FrontmatterData): string {
  const lines: string[] = [];

  const fieldOrder = ['id', 'name', 'version', 'runtime', 'mamVersion', 'formatVersion', 'description', 'author', 'tags', 'permissions', 'dependencies', 'migratedFrom', 'migratedAt'];

  const written = new Set<string>();

  for (const key of fieldOrder) {
    if (key in data) {
      lines.push(formatFrontmatterLine(key, data[key]));
      written.add(key);
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (!written.has(key)) {
      lines.push(formatFrontmatterLine(key, value));
    }
  }

  return lines.join('\n');
}

function formatFrontmatterLine(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    const items = value.map(v => `  - ${v}`).join('\n');
    return `${key}:\n${items}`;
  }

  if (typeof value === 'boolean') return `${key}: ${value}`;
  if (typeof value === 'number') return `${key}: ${value}`;
  if (typeof value === 'string') {
    if (value.includes(':') || value.includes('#') || value.startsWith('"') || value.includes('\n')) {
      return `${key}: "${value.replace(/"/g, '\\"')}"`;
    }
    return `${key}: ${value}`;
  }

  return `${key}: ${JSON.stringify(value)}`;
}

function assembleModule(module: ParsedModule): string {
  const parts: string[] = [];

  const fmString = generateFrontmatterString(module.frontmatter);
  if (fmString) {
    parts.push('---');
    parts.push(fmString);
    parts.push('---');
    parts.push('');
  }

  parts.push(module.body);

  return parts.join('\n');
}

function detectVersion(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return 'unknown';

  const fm = fmMatch[1];
  const versionMatch = fm.match(/version:\s*(.+)/);
  if (versionMatch) {
    const v = versionMatch[1].trim();
    if (v.startsWith('2.') || v === '2.0.0') return '2';
    if (v.startsWith('1.')) return '1';
  }

  const mamVersionMatch = fm.match(/mamVersion:\s*(.+)/);
  if (mamVersionMatch) {
    const v = mamVersionMatch[1].trim();
    if (v.startsWith('2.')) return '2';
    if (v.startsWith('1.')) return '1';
  }

  const hasV2Fields = fm.includes('id:') && fm.includes('mamVersion:');
  if (hasV2Fields) return '2';

  return '1';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFileHash(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 12);
}

// ============================================================================
// Backup & Rollback
// ============================================================================

async function createBackup(filePath: string): Promise<string> {
  const backupPath = filePath + '.v1.bak';
  await copyFile(filePath, backupPath);
  return backupPath;
}

async function rollbackMigration(rollbackFile: string, targetFile: string): Promise<void> {
  const backupPath = rollbackFile || targetFile + '.v1.bak';
  try {
    await access(backupPath);
    await copyFile(backupPath, targetFile);
  } catch {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
}

// ============================================================================
// Report Formatting
// ============================================================================

function formatTextReport(report: MigrationReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push(chalk.bold.cyan('          MAM Migration Report'));
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push('');
  lines.push(`  ${chalk.gray('File:')}        ${report.file}`);
  lines.push(`  ${chalk.gray('Version:')}     ${report.originalVersion} → ${report.targetVersion}`);
  lines.push(`  ${chalk.gray('Timestamp:')}   ${report.timestamp}`);
  lines.push(`  ${chalk.gray('Duration:')}    ${report.durationMs}ms`);
  lines.push(`  ${chalk.gray('Dry Run:')}     ${report.dryRun ? 'Yes' : 'No'}`);
  lines.push('');

  if (report.backupPath) {
    lines.push(`  ${chalk.gray('Backup:')}      ${report.backupPath}`);
  }
  if (report.outputPath) {
    lines.push(`  ${chalk.gray('Output:')}      ${report.outputPath}`);
  }
  lines.push('');

  if (report.changes.length > 0) {
    lines.push(chalk.bold.white('  Changes:'));
    lines.push('');

    const byType = new Map<string, MigrationChange[]>();
    for (const change of report.changes) {
      const list = byType.get(change.type) || [];
      list.push(change);
      byType.set(change.type, list);
    }

    for (const [type, changes] of byType) {
      lines.push(chalk.bold.gray(`    ${type.charAt(0).toUpperCase() + type.slice(1)} (${changes.length})`));
      for (const change of changes) {
        const icon = change.severity === 'error' ? chalk.red('  ✗') : change.severity === 'warning' ? chalk.yellow('  !') : chalk.green('  ✓');
        lines.push(`    ${icon} ${change.description}`);
        if (change.before) lines.push(chalk.gray(`      Before: ${change.before}`));
        if (change.after) lines.push(chalk.gray(`      After:  ${change.after}`));
        if (change.line) lines.push(chalk.gray(`      Line:   ${change.line}`));
      }
      lines.push('');
    }
  }

  lines.push(chalk.bold.cyan('───────────────────────────────────────────'));
  lines.push('');
  lines.push(`  ${chalk.gray('Total Changes:')}     ${report.summary.total}`);
  lines.push(`  ${chalk.green('Frontmatter:')}      ${report.summary.frontmatter}`);
  lines.push(`  ${chalk.green('Sections:')}         ${report.summary.sections}`);
  lines.push(`  ${chalk.green('Code Blocks:')}      ${report.summary.codeblocks}`);
  lines.push(`  ${chalk.green('References:')}       ${report.summary.references}`);
  lines.push(`  ${chalk.green('Dependencies:')}     ${report.summary.dependencies}`);
  lines.push(`  ${chalk.green('Structural:')}       ${report.summary.structural}`);
  lines.push(`  ${chalk.green('Metadata:')}         ${report.summary.metadata}`);
  lines.push('');

  if (report.errors.length > 0) {
    lines.push(chalk.red(`  Errors (${report.errors.length}):`));
    for (const err of report.errors) {
      lines.push(chalk.red(`    ✗ ${err}`));
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push(chalk.yellow(`  Warnings (${report.warnings.length}):`));
    for (const warn of report.warnings) {
      lines.push(chalk.yellow(`    ! ${warn}`));
    }
    lines.push('');
  }

  const statusLabel = report.success ? chalk.green('✓ Migration Complete') : chalk.red('✗ Migration Failed');
  lines.push(`  ${statusLabel}`);
  lines.push('');
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push('');

  return lines.join('\n');
}

function formatJsonReport(report: MigrationReport): string {
  return JSON.stringify(report, null, 2);
}

function formatMarkdownReport(report: MigrationReport): string {
  const lines: string[] = [];

  lines.push('# MAM Migration Report');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| File | \`${report.file}\` |`);
  lines.push(`| Version | ${report.originalVersion} → ${report.targetVersion} |`);
  lines.push(`| Timestamp | ${report.timestamp} |`);
  lines.push(`| Duration | ${report.durationMs}ms |`);
  lines.push(`| Dry Run | ${report.dryRun ? 'Yes' : 'No'} |`);
  lines.push(`| Status | ${report.success ? 'Success' : 'Failed'} |`);
  lines.push('');

  if (report.backupPath) {
    lines.push(`**Backup:** \`${report.backupPath}\``);
    lines.push('');
  }
  if (report.outputPath) {
    lines.push(`**Output:** \`${report.outputPath}\``);
    lines.push('');
  }

  if (report.changes.length > 0) {
    lines.push('## Changes');
    lines.push('');
    lines.push('| Type | Severity | Description | Before | After |');
    lines.push('|------|----------|-------------|--------|-------|');
    for (const change of report.changes) {
      const sev = change.severity === 'error' ? '🔴' : change.severity === 'warning' ? '🟡' : '🟢';
      lines.push(`| ${change.type} | ${sev} ${change.severity} | ${change.description} | \`${change.before || '-'}\` | \`${change.after || '-'}\` |`);
    }
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${report.summary.total} |`);
  lines.push(`| Frontmatter | ${report.summary.frontmatter} |`);
  lines.push(`| Sections | ${report.summary.sections} |`);
  lines.push(`| Code Blocks | ${report.summary.codeblocks} |`);
  lines.push(`| References | ${report.summary.references} |`);
  lines.push(`| Dependencies | ${report.summary.dependencies} |`);
  lines.push(`| Structural | ${report.summary.structural} |`);
  lines.push(`| Metadata | ${report.summary.metadata} |`);
  lines.push('');

  if (report.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const err of report.errors) {
      lines.push(`- ${err}`);
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warn of report.warnings) {
      lines.push(`- ${warn}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Migration Engine
// ============================================================================

async function migrateFile(filePath: string, options: MigrateOptions): Promise<MigrationReport> {
  const startTime = Date.now();
  const changes: MigrationChange[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const report: MigrationReport = {
    file: filePath,
    originalVersion: '',
    targetVersion: MAM_V2_VERSION,
    timestamp: new Date().toISOString(),
    changes,
    summary: { total: 0, frontmatter: 0, sections: 0, codeblocks: 0, references: 0, dependencies: 0, structural: 0, metadata: 0 },
    success: false,
    dryRun: options.dryRun || false,
    durationMs: 0,
    errors,
    warnings,
  };

  try {
    const content = await readFile(filePath, 'utf-8');
    const originalVersion = detectVersion(content);
    report.originalVersion = originalVersion;

    if (originalVersion === '2' && !options.force) {
      warnings.push('File appears to already be v2 format. Use --force to re-migrate.');
      report.success = true;
      report.warnings = warnings;
      report.durationMs = Date.now() - startTime;
      return report;
    }

    if (originalVersion === 'unknown') {
      warnings.push('Could not determine module version. Proceeding with migration.');
    }

    let module = parseModule(content);

    const rules = getBuiltinRules();

    for (const rule of rules) {
      try {
        module = rule.transform(module, changes);
      } catch (err) {
        errors.push(`Rule "${rule.name}" failed: ${(err as Error).message}`);
      }
    }

    if (options.customRules) {
      try {
        const customRulesModule = await import(resolve(options.customRules));
        const customRules: MigrationRule[] = customRulesModule.default || customRulesModule.rules || [];
        for (const rule of customRules) {
          try {
            module = rule.transform(module, changes);
          } catch (err) {
            errors.push(`Custom rule "${rule.name}" failed: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to load custom rules: ${(err as Error).message}`);
      }
    }

    const migratedContent = assembleModule(module);

    const summary = {
      total: changes.length,
      frontmatter: changes.filter(c => c.type === 'frontmatter').length,
      sections: changes.filter(c => c.type === 'section').length,
      codeblocks: changes.filter(c => c.type === 'codeblock').length,
      references: changes.filter(c => c.type === 'reference').length,
      dependencies: changes.filter(c => c.type === 'dependency').length,
      structural: changes.filter(c => c.type === 'structural').length,
      metadata: changes.filter(c => c.type === 'metadata').length,
    };

    report.summary = summary;

    if (!options.dryRun) {
      if (options.backup !== false) {
        report.backupPath = await createBackup(filePath);
      }

      const outputPath = options.inPlace ? filePath : filePath.replace(/\.mam\.md$/, '.v2.mam.md').replace(/\.mam$/, '.v2.mam');
      await writeFile(outputPath, migratedContent, 'utf-8');
      report.outputPath = outputPath;
    }

    report.success = errors.length === 0;
  } catch (err) {
    errors.push((err as Error).message);
    report.success = false;
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

async function migrateDirectory(dirPath: string, options: MigrateOptions): Promise<MigrationReport[]> {
  const reports: MigrationReport[] = [];

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          await walkDir(fullPath);
        } else if (entry.name.endsWith('.mam.md') || entry.name.endsWith('.mam')) {
          const report = await migrateFile(fullPath, options);
          reports.push(report);
        }
      }
    } catch {
      // permission denied
    }
  }

  await walkDir(dirPath);
  return reports;
}

// ============================================================================
// Main Command
// ============================================================================

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const format: MigrationFormat = options.json ? 'json' : options.markdown ? 'markdown' : options.format || 'text';

  if (options.rollback) {
    if (!options.file) {
      console.error(chalk.red('Error: --rollback requires a file path'));
      process.exit(1);
    }
    const spinner = ora('Rolling back migration...').start();
    try {
      const filePath = resolve(options.file);
      const targetFile = filePath.replace(/\.v2\.mam\.md$/, '.mam.md').replace(/\.v2\.mam$/, '.mam');
      await rollbackMigration(options.rollbackFile || filePath + '.v1.bak', targetFile);
      spinner.succeed(`Rolled back: ${targetFile}`);
      return;
    } catch (err) {
      spinner.fail(`Rollback failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (options.dir || options.batch) {
    const dirPath = resolve(options.dir || process.cwd());
    const spinner = ora(`Scanning directory: ${dirPath}`).start();

    try {
      await access(dirPath);
    } catch {
      spinner.fail(`Directory not found: ${dirPath}`);
      process.exit(1);
    }

    spinner.text = 'Finding MAM modules...';
    const reports = await migrateDirectory(dirPath, options);
    spinner.stop();

    if (reports.length === 0) {
      console.log(chalk.yellow('No MAM modules found in directory.'));
      return;
    }

    const totalChanges = reports.reduce((sum, r) => sum + r.summary.total, 0);
    const successful = reports.filter(r => r.success).length;

    if (format === 'json') {
      console.log(JSON.stringify({ reports, totalFiles: reports.length, totalChanges, successful }, null, 2));
    } else if (format === 'markdown') {
      for (const report of reports) {
        console.log(formatMarkdownReport(report));
      }
    } else {
      console.log(chalk.bold.cyan(`\nBatch Migration: ${reports.length} files\n`));
      for (const report of reports) {
        if (report.summary.total > 0) {
          const status = report.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${status} ${report.file} — ${report.summary.total} changes`);
        } else {
          console.log(`  ${chalk.gray('○')} ${report.file} — no changes needed`);
        }
      }
      console.log(chalk.gray(`\n  Total: ${reports.length} files, ${totalChanges} changes, ${successful} successful`));
    }

    if (reports.some(r => !r.success)) {
      process.exit(1);
    }
    return;
  }

  if (!options.file) {
    console.error(chalk.red('Error: --file or --dir is required'));
    console.log(chalk.gray('Usage: mam migrate <file> or mam migrate --dir <directory>'));
    process.exit(1);
  }

  const spinner = ora('Migrating module...').start();

  try {
    const filePath = resolve(options.file);

    try {
      await access(filePath);
    } catch {
      spinner.fail(`File not found: ${filePath}`);
      process.exit(1);
    }

    spinner.text = 'Analyzing module and applying transformations...';
    const report = await migrateFile(filePath, options);
    spinner.stop();

    switch (format) {
      case 'json':
        console.log(formatJsonReport(report));
        break;
      case 'markdown':
        console.log(formatMarkdownReport(report));
        break;
      default:
        console.log(formatTextReport(report));
    }

    process.exit(report.success ? 0 : 1);
  } catch (err) {
    spinner.fail(`Migration failed: ${(err as Error).message}`);
    if (options.verbose) {
      console.error(err);
    }
    process.exit(1);
  }
}
