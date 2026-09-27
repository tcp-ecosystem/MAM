import { readFile } from 'node:fs/promises';
import {
  ContentNode, FrontMatter, Module, ParseError, Section, SectionKind, SourceLocation,
  isSectionKind, sectionKindOrder,
} from './ast.js';

/** Options accepted by the string and file parsers. */
export interface ParseOptions {
  filePath?: string;
  requireFrontmatter?: boolean;
  allowUnknownSections?: boolean;
}

/** Parses a file asynchronously; filesystem failures reject with a ParseError. */
export async function parseFile(path: string, options: ParseOptions = {}): Promise<Module> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ParseError('FILE_READ', `Unable to read ${path}: ${message}`, location(options.filePath ?? path, 1, 1));
  }
  return parseString(content, { ...options, filePath: path });
}

/** Parses raw content; malformed frontmatter follows the documented error path. */
export function parseString(content: string, options: ParseOptions = {}): Module {
  const filePath = options.filePath ?? '<string>';
  const text = content.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const { frontmatter, bodyStart } = parseFrontmatter(lines, filePath, options.requireFrontmatter === true);
  const sections = parseSections(lines.slice(bodyStart), bodyStart + 1, filePath, options.allowUnknownSections !== false);
  return {
    frontmatter,
    sections,
    raw_content: content,
    file_path: filePath,
    location: location(filePath, 1, 1),
  };
}

/** Parses content using the conventional string source name. */
export function parse(content: string, filePath = '<string>'): Module {
  return parseString(content, { filePath });
}

/** Parses content and throws on invalid input, for tests and static fixtures. */
export function mustParse(content: string, filePath = '<string>'): Module {
  const result = parseString(content, { filePath, requireFrontmatter: false });
  if (!result.frontmatter) throw new ParseError('FRONTMATTER_MISSING', 'MAM content must start with frontmatter', location(filePath, 1, 1));
  return result;
}

/** Returns the raw frontmatter text between delimiters, or an empty string. */
export function extractFrontmatter(content: string): string {
  const lines = normalizeLines(content);
  if (lines[0]?.trim() !== '---') return '';
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return close < 0 ? '' : lines.slice(1, close).join('\n');
}

/** Returns all Markdown heading titles in source order. */
export function listSectionTitles(content: string): string[] {
  return normalizeLines(content).map((line) => headingMatch(line)).filter((value): value is string => value !== undefined);
}

/** Counts fenced code blocks, including unterminated fences. */
export function countCodeBlocks(content: string): number {
  let count = 0;
  let open = false;
  for (const line of normalizeLines(content)) {
    if (!open && /^```/.test(line.trim())) { open = true; continue; }
    if (open && /^```\s*$/.test(line.trim())) { open = false; count += 1; }
  }
  return count;
}

/** Returns distinct fence language tags in first-seen order. */
export function detectLanguages(content: string): string[] {
  const result: string[] = [];
  for (const line of normalizeLines(content)) {
    const match = line.trim().match(/^```\s*([^\s`]*)/);
    if (match) {
      const language = match[1] || 'unknown';
      if (!result.includes(language)) result.push(language);
    }
  }
  return result;
}

/** Reports whether a path has the conventional MAM suffix. */
export function isMAMFile(path: string): boolean {
  return path.toLowerCase().endsWith('.mam.md');
}

/** Normalizes line endings and returns source lines. */
export function normalizeLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}

/** Returns a source location without exposing parser internals. */
export function location(file: string, line: number, column: number, offset = 0): SourceLocation {
  return { file, line, column, offset };
}

/** Returns a normalized title to the standard kind when one exists. */
export function classifySection(title: string): SectionKind {
  const normalized = title.trim().toLowerCase().replace(/^section\s+/, '').replace(/[^a-z0-9]+/g, '_');
  if (isSectionKind(normalized)) return normalized;
  for (const kind of ['metadata', 'purpose', 'inputs', 'outputs', 'rules', 'workflow', 'mermaid', 'python', 'prompt', 'memory', 'examples', 'tests', 'references', 'dependencies', 'exports', 'imports', 'plugins', 'permissions', 'capabilities']) {
    if (normalized.includes(kind)) return kind as SectionKind;
  }
  return 'Custom';
}

function headingMatch(line: string): string | undefined {
  const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match?.[2].trim();
}

function parseFrontmatter(lines: string[], filePath: string, required: boolean): { frontmatter: FrontMatter | null; bodyStart: number } {
  if (lines[0]?.trim() !== '---') {
    if (required) throw new ParseError('FRONTMATTER_MISSING', 'MAM content must start with ---', location(filePath, 1, 1));
    return { frontmatter: null, bodyStart: 0 };
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) throw new ParseError('FRONTMATTER_UNTERMINATED', 'Frontmatter is missing its closing --- delimiter', location(filePath, 1, 1));
  const raw = lines.slice(1, close).join('\n');
  const data = parseScalarList(raw);
  const text = (key: string): string => typeof data[key] === 'string' ? data[key].trim() : '';
  const list = (key: string): string[] => Array.isArray(data[key]) ? data[key].map(String) : typeof data[key] === 'string' ? splitInlineList(data[key]) : [];
  const known = new Set(['schema_version', 'name', 'version', 'description', 'authors', 'author', 'tags', 'license', 'dependencies']);
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) if (!known.has(key)) metadata[key] = value;
  const typeErrors = frontmatterTypeErrors(raw);
  if (typeErrors.length) metadata.__typeErrors = typeErrors;
  return {
    frontmatter: {
      schema_version: text('schema_version'), name: text('name'), version: text('version'), description: text('description'),
      authors: list('authors').length ? list('authors') : list('author'), tags: list('tags'), license: text('license'),
      dependencies: list('dependencies'), metadata, raw,
      location: location(filePath, 2, 1, 4),
    },
    bodyStart: close + 1,
  };
}

function parseSections(lines: string[], baseLine: number, filePath: string, allowUnknown: boolean): Section[] {
  const sections: Section[] = [];
  let index = 0;
  while (index < lines.length) {
    const title = headingMatch(lines[index]);
    if (title === undefined) { index += 1; continue; }
    const level = lines[index].match(/^\s*(#+)/)?.[1].length ?? 2;
    const kind = classifySection(title);
    if (!allowUnknown && kind === 'Custom') throw new ParseError('SECTION_UNKNOWN', `Unknown section: ${title}`, location(filePath, baseLine + index, 1));
    const start = index;
    index += 1;
    const body: string[] = [];
    while (index < lines.length && headingMatch(lines[index]) === undefined) { body.push(lines[index]); index += 1; }
    sections.push({ kind, title, content: parseContent(body, baseLine + start + 1, filePath), location: location(filePath, baseLine + start, 1) });
  }
  return sections;
}

function parseContent(lines: string[], baseLine: number, filePath: string): ContentNode[] {
  const nodes: ContentNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    const text = raw.trim();
    const at = location(filePath, baseLine + index, 1);
    if (text === '') { index += 1; continue; }
    if (/^```/.test(text)) {
      const language = text.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) { code.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      nodes.push({ kind: 'CodeBlock', language, code: code.join('\n'), location: at });
      continue;
    }
    if (/^(---+|___+|\*\*\*+)$/.test(text)) { nodes.push({ kind: 'HorizontalRule', location: at }); index += 1; continue; }
    if (/^>\s?/.test(text)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) { quote.push(lines[index].replace(/^>\s?/, '')); index += 1; }
      nodes.push({ kind: 'Blockquote', text: quote.join('\n'), location: at });
      continue;
    }
    if (/^[-*+]\s+/.test(text)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) { items.push(lines[index].trim().replace(/^[-*+]\s+/, '')); index += 1; }
      nodes.push({ kind: 'List', items, location: at });
      continue;
    }
    if (text.startsWith('|')) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const trimmed = lines[index].trim();
        if (!/^\|[\s|:-]+\|$/.test(trimmed)) rows.push(trimmed.slice(1, -1).split('|').map((cell) => cell.trim()));
        index += 1;
      }
      nodes.push({ kind: 'Table', rows, location: at });
      continue;
    }
    const link = text.match(/^!?\[([^\]]*)\]\(([^)]+)\)$/);
    if (link) {
      if (text.startsWith('!')) nodes.push({ kind: 'Image', alt: link[1], url: link[2], location: at });
      else nodes.push({ kind: 'Link', text: link[1], url: link[2], location: at });
      index += 1;
      continue;
    }
    const heading = raw.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) { nodes.push({ kind: 'Heading', level: heading[1].length, text: heading[2].trim(), location: at }); index += 1; continue; }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() !== '' && !/^```|^(---+|___+|\*\*\*+)$/.test(lines[index].trim()) && headingMatch(lines[index]) === undefined) { paragraph.push(lines[index].trim()); index += 1; }
    nodes.push({ kind: 'Paragraph', text: paragraph.join('\n'), location: at });
  }
  return nodes;
}

function splitInlineList(value: string): string[] {
  return value.replace(/^\[/, '').replace(/\]$/, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function parseScalarList(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let current: string | undefined;
  let currentIndent = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const list = line.match(/^(\s*)-\s+(.+)$/);
    if (list && current) {
      if (!Array.isArray(result[current])) result[current] = [];
      (result[current] as string[]).push(unquote(list[2]));
      continue;
    }
    const pair = line.match(/^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!pair) continue;
    current = pair[2];
    currentIndent = pair[1].length;
    const value = pair[3].trim();
    result[current] = value === '' ? [] : value.startsWith('[') ? splitInlineList(value) : unquote(value);
  }
  return result;
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/** Returns a line number for an offset in normalized content. */
export function lineAtOffset(content: string, offset: number): number {
  return normalizeLines(content.slice(0, Math.max(0, offset))).length;
}

/** Returns a column number for a line and character offset. */
export function columnAtOffset(line: string, offset: number): number {
  return Math.min(line.length, Math.max(0, offset));
}

/** Returns whether a document contains a section title. */
export function hasSectionTitle(content: string, title: string): boolean {
  return listSectionTitles(content).some((value) => value.toLowerCase() === title.toLowerCase());
}

/** Returns the first section title after frontmatter. */
export function firstSectionTitle(content: string): string | undefined {
  return listSectionTitles(content).find((title) => title !== 'Metadata') ?? listSectionTitles(content)[0];
}

/** Returns a code block from source by index. */
export function extractCodeBlocks(content: string): Array<{ language: string; code: string; line: number }> {
  const result: Array<{ language: string; code: string; line: number }> = [];
  const lines = normalizeLines(content); let open = false; let language = ''; let code: string[] = []; let start = 0;
  lines.forEach((line, index) => {
    const match = line.trim().match(/^```\s*([^\s`]*)/);
    if (!open && match) { open = true; language = match[1] || ''; code = []; start = index + 1; return; }
    if (open && /^```\s*$/.test(line.trim())) { result.push({ language, code: code.join('\n'), line: start + 1 }); open = false; return; }
    if (open) code.push(line);
  });
  return result;
}

/** Strips fences while preserving paragraph text for analysis. */
export function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '```').replace(/```[^\n]*\n[\s\S]*$/, '```');
}

/** Returns whether a content string starts with valid frontmatter. */
export function hasFrontmatter(content: string): boolean {
  return normalizeLines(content)[0]?.trim() === '---';
}

/** Returns the number of Markdown headings. */
export function countHeadings(content: string): number {
  return normalizeLines(content).filter((line) => headingMatch(line) !== undefined).length;
}

/** Normalizes a Markdown title for classification. */
export function normalizeSectionTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** Returns whether a title is a known standard section. */
export function isKnownSection(title: string): boolean {
  return isSectionKind(normalizeSectionTitle(title));
}

/** Returns a safe empty parse location. */
export function parseLocation(file = '<string>'): SourceLocation {
  return location(file, 1, 1, 0);
}

/** Returns all recognized section kinds in source order. */
export function standardKinds(): SectionKind[] {
  return ['metadata', 'purpose', 'inputs', 'outputs', 'rules', 'workflow', 'mermaid', 'python', 'prompt', 'memory', 'examples', 'tests', 'references', 'dependencies', 'exports', 'imports', 'plugins', 'permissions', 'capabilities'];
}

/** Reports whether a section is a code-bearing execution section. */
export function isExecutionSection(section: Section): boolean {
  return ['python', 'Custom'].includes(section.kind) && section.content.some((node) => node.kind === 'CodeBlock');
}

/** Returns a list of code block language tags. */
export function codeBlockLanguagesInText(content: string): string[] {
  return detectLanguages(content);
}

function frontmatterTypeErrors(raw: string): string[] {
  const errors: string[] = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*(schema_version|name|version|description|authors|author|tags|license|dependencies)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (value && !value.startsWith('[') && !value.startsWith('"') && !value.startsWith("'") && (['schema_version', 'name', 'version', 'description', 'license'].includes(match[1]) ? /^(?:\d+(?:\.\d+)*|true|false)$/.test(value) : true)) errors.push(match[1]);
  }
  return errors;
}

void sectionKindOrder;
