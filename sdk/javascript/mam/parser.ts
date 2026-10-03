/**
 * MAM Parser for JavaScript
 *
 * Full-featured parser for MAM (Machine Agent Modules) documents.
 * Produces a structured AST from raw Markdown content.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface SourceLocation {
  start: Position;
  end: Position;
  source: string;
}

export type SectionType =
  | 'Purpose'
  | 'Inputs'
  | 'Outputs'
  | 'Rules'
  | 'Workflow'
  | 'Mermaid'
  | 'Python'
  | 'JavaScript'
  | 'Prompt'
  | 'Memory'
  | 'Examples'
  | 'Tests'
  | 'References'
  | 'Dependencies'
  | 'Exports'
  | 'Imports'
  | 'Plugins'
  | 'Permissions'
  | 'Capabilities'
  | 'TypeScript'
  | 'Rust'
  | 'Go'
  | 'Shell'
  | string;

export type ContentNodeType =
  | 'Paragraph'
  | 'List'
  | 'CodeBlock'
  | 'Table'
  | 'Heading'
  | 'Blockquote'
  | 'HorizontalRule'
  | 'Mermaid';

export interface ContentNode {
  type: ContentNodeType;
  value: string;
  language?: string;
  metadata?: Record<string, string>;
  location: SourceLocation;
  items?: string[];
  rows?: string[][];
  level?: number;
}

export interface FrontMatter {
  type: 'FrontMatter';
  data: Record<string, unknown>;
  location: SourceLocation;
}

export interface Section {
  type: 'Section';
  name: string;
  level: number;
  content: ContentNode[];
  location: SourceLocation;
}

export interface AST {
  type: 'MAMModule';
  frontmatter: FrontMatter | null;
  sections: Section[];
  location: SourceLocation;
  metadata: ModuleMetadata;
}

export interface ModuleMetadata {
  totalSections: number;
  totalCodeBlocks: number;
  totalLines: number;
  sourceName: string;
}

export interface CodeBlock {
  language: string;
  value: string;
  metadata: Record<string, string>;
  location: SourceLocation;
}

export type ParseErrorCode =
  | 'FRONTMATTER_NOT_FOUND'
  | 'FRONTMATTER_INVALID'
  | 'FRONTMATTER_UNCLOSED'
  | 'SECTION_EXPECTED'
  | 'SECTION_DUPLICATE'
  | 'CODE_BLOCK_UNCLOSED'
  | 'INVALID_METADATA'
  | 'UNEXPECTED_TOKEN'
  | 'EMPTY_DOCUMENT';

export type ParseWarningCode =
  | 'UNKNOWN_SECTION'
  | 'EMPTY_SECTION'
  | 'DEPRECATED_FIELD'
  | 'MISSING_LANGUAGE'
  | 'TRAILING_WHITESPACE'
  | 'INCONSISTENT_INDENTATION'
  | 'UNUSED_METADATA';

export interface ParseError {
  type: 'error';
  code: ParseErrorCode;
  message: string;
  location: SourceLocation;
  context?: string;
}

export interface ParseWarning {
  type: 'warning';
  code: ParseWarningCode;
  message: string;
  location: SourceLocation;
}

export interface ParserStats {
  totalSections: number;
  totalCodeBlocks: number;
  totalLines: number;
  parseTimeMs: number;
}

export interface ParseResult {
  ast: AST;
  errors: ParseError[];
  warnings: ParseWarning[];
  stats: ParserStats;
}

export interface ParseOptions {
  source?: string;
  allowUnknownSections?: boolean;
  strict?: boolean;
  maxDepth?: number;
}

// ---------------------------------------------------------------------------
// Known section names (spec §3.2)
// ---------------------------------------------------------------------------

const STANDARD_SECTIONS: ReadonlySet<string> = new Set([
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
  'TypeScript',
  'Rust',
  'Go',
  'Shell',
]);

// ---------------------------------------------------------------------------
// Recommended section order (spec §3.3)
// ---------------------------------------------------------------------------

const RECOMMENDED_ORDER: readonly string[] = [
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pos(
  line: number,
  column: number,
  offset: number,
  source: string,
): Position {
  return { line, column, offset };
}

function loc(
  start: Position,
  end: Position,
  source: string,
): SourceLocation {
  return { start, end, source };
}

function locFromTo(
  startLine: number,
  startCol: number,
  startOff: number,
  endLine: number,
  endCol: number,
  endOff: number,
  source: string,
): SourceLocation {
  return {
    start: pos(startLine, startCol, startOff, source),
    end: pos(endLine, endCol, endOff, source),
    source,
  };
}

function clonePos(p: Position): Position {
  return { line: p.line, column: p.column, offset: p.offset };
}

function mergeLoc(a: SourceLocation, b: SourceLocation): SourceLocation {
  return {
    start: { ...a.start },
    end: { ...b.end },
    source: a.source,
  };
}

// ---------------------------------------------------------------------------
// Simple YAML-ish frontmatter parser (handles the subset MAM needs)
// ---------------------------------------------------------------------------

function parseYAML(
  raw: string,
  source: string,
  baseLine: number,
  baseOffset: number,
): { data: Record<string, unknown>; errors: ParseError[] } {
  const data: Record<string, unknown> = {};
  const errors: ParseError[] = [];
  const lines = raw.split('\n');
  let currentKey: string | null = null;
  let currentIndent = 0;
  let listAccum: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = baseLine + i;
    const lineOffset = baseOffset + [...lines.slice(0, i)].join('\n').length;

    // Skip blank lines
    if (line.trim() === '') {
      if (listAccum !== null && currentKey !== null) {
        data[currentKey] = listAccum;
        listAccum = null;
        currentKey = null;
      }
      continue;
    }

    // List item
    const listItemMatch = line.match(/^(\s*)- (.+)$/);
    if (listItemMatch && currentKey !== null) {
      if (listAccum === null) listAccum = [];
      listAccum.push(listItemMatch[2].trim());
      continue;
    }

    // Flush list if we hit a non-list line
    if (listAccum !== null && currentKey !== null) {
      data[currentKey] = listAccum;
      listAccum = null;
      currentKey = null;
    }

    // key: value
    const kvMatch = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const indent = kvMatch[1].length;
      const key = kvMatch[2];
      const rawVal = kvMatch[3].trim();

      // Nested list (same indent)
      if (rawVal === '' && indent <= currentIndent && currentKey !== null) {
        // value is a list starting on next lines
      }

      currentKey = key;
      currentIndent = indent;

      if (rawVal === '') {
        // Could be a list — check next line
        data[key] = '';
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        // Inline array: []
        const items = rawVal
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s) => s !== '');
        data[key] = items;
      } else if (rawVal === 'true') {
        data[key] = true;
      } else if (rawVal === 'false') {
        data[key] = false;
      } else if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
        data[key] = Number(rawVal);
      } else {
        data[key] = rawVal.replace(/^["']|["']$/g, '');
      }
    } else {
      errors.push({
        type: 'error',
        code: 'FRONTMATTER_INVALID',
        message: `Invalid YAML line: "${line.trim()}"`,
        location: locFromTo(lineNum, 0, lineOffset, lineNum, line.length, lineOffset + line.length, source),
      });
    }
  }

  // Flush trailing list
  if (listAccum !== null && currentKey !== null) {
    data[currentKey] = listAccum;
  }

  return { data, errors };
}

// ---------------------------------------------------------------------------
// Code block metadata parser
// ---------------------------------------------------------------------------

function parseCodeMetadata(
  comment: string,
): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = comment.split('\n');
  for (const line of lines) {
    const match = line.match(/^#\s*@mam:(\w+)(?:=(.+))?$/);
    if (match) {
      meta[match[1]] = match[2] ?? 'true';
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Content parsers
// ---------------------------------------------------------------------------

function parseInlineList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter((l) => l !== '');
}

function parseTableRows(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip separator rows (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
    if (trimmed === '') continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1) // remove leading/trailing empty from leading/trailing |
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

function parseBlockquote(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^>\s?/, ''))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

export function parseMAM(
  content: string,
  options?: ParseOptions,
): ParseResult {
  const source = options?.source ?? '<input>';
  const startTime = Date.now();
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];

  // Handle empty input
  if (content.trim() === '') {
    return {
      ast: {
        type: 'MAMModule',
        frontmatter: null,
        sections: [],
        location: locFromTo(1, 0, 0, 1, 0, 0, source),
        metadata: { totalSections: 0, totalCodeBlocks: 0, totalLines: 0, sourceName: source },
      },
      errors: [
        {
          type: 'error',
          code: 'EMPTY_DOCUMENT',
          message: 'Document is empty',
          location: locFromTo(1, 0, 0, 1, 0, 0, source),
        },
      ],
      warnings: [],
      stats: { totalSections: 0, totalCodeBlocks: 0, totalLines: 0, parseTimeMs: Date.now() - startTime },
    };
  }

  const lines = content.split('\n');
  let offset = 0;
  let lineNum = 1;
  let colNum = 0;

  const advance = (chars: number) => {
    for (let i = 0; i < chars; i++) {
      if (content[offset] === '\n') {
        lineNum++;
        colNum = 0;
      } else {
        colNum++;
      }
      offset++;
    }
  };

  const peekLine = (fromOffset?: number): string => {
    const o = fromOffset ?? offset;
    const nlIdx = content.indexOf('\n', o);
    return content.substring(o, nlIdx === -1 ? content.length : nlIdx);
  };

  // --- Frontmatter ---
  let frontmatter: FrontMatter | null = null;

  const trimmedStart = content.trimStart();
  if (trimmedStart.startsWith('---')) {
    const fmStartLine = 1;
    const fmStartOff = content.length - content.trimStart().length;
    advance(3); // skip opening ---

    const closeIdx = content.indexOf('\n---', offset);
    if (closeIdx === -1) {
      errors.push({
        type: 'error',
        code: 'FRONTMATTER_UNCLOSED',
        message: 'Unclosed front matter block (missing closing ---)',
        location: locFromTo(fmStartLine, 0, fmStartOff, lineNum, colNum, offset, source),
      });
    } else {
      const fmRaw = content.substring(offset, closeIdx);
      const fmLines = fmRaw.split('\n');
      const fmEndOff = closeIdx + 4; // \n---
      const fmEndLine = fmStartLine + fmLines.length + 1;

      const result = parseYAML(fmRaw, source, fmStartLine + 1, offset);
      errors.push(...result.errors);

      frontmatter = {
        type: 'FrontMatter',
        data: result.data,
        location: locFromTo(fmStartLine, 0, fmStartOff, fmEndLine, 3, fmEndOff, source),
      };

      advance(closeIdx - offset + 4); // skip content + \n---
    }

    // Skip blank line after frontmatter
    while (offset < content.length && content[offset] === '\n') {
      advance(1);
    }
  } else {
    errors.push({
      type: 'error',
      code: 'FRONTMATTER_NOT_FOUND',
      message: 'Missing front matter block (document must start with ---)',
      location: locFromTo(1, 0, 0, 1, 0, 0, source),
    });
  }

  // --- Sections ---
  const sections: Section[] = [];
  let totalCodeBlocks = 0;

  while (offset < content.length) {
    const line = peekLine();
    const lineStartOffset = offset;

    // Match heading: ## Name
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const name = headingMatch[2].trim();
      const headingStartLine = lineNum;
      const headingStartCol = 0;

      advance(line.length);

      // Skip blank lines after heading
      while (offset < content.length && content[offset] === '\n') {
        advance(1);
      }

      // Collect content until next heading of equal/higher level or EOF
      const contentNodes: ContentNode[] = [];
      let sectionEnded = false;

      while (offset < content.length && !sectionEnded) {
        const innerLine = peekLine();
        const innerMatch = innerLine.match(/^(#{1,6})\s+(.+)$/);

        // Stop at heading of equal or higher level
        if (innerMatch && innerMatch[1].length <= level) {
          sectionEnded = true;
          break;
        }

        // Code block
        if (innerLine.trimStart().startsWith('```')) {
          const codeFenceLine = innerLine;
          const fenceMatch = codeFenceLine.trimStart().match(/^`{3,}(\w*)/);
          const language = fenceMatch?.[1] ?? '';
          const codeStartLine = lineNum;
          const codeStartCol = colNum;

          advance(innerLine.length);
          const codeContentStart = offset;

          // Find closing fence
          let codeEnd = content.indexOf('\n```', offset);
          if (codeEnd === -1) {
            // Check if it ends at EOF without newline before closing
            if (content.substring(offset).trimEnd().endsWith('```')) {
              codeEnd = content.lastIndexOf('```');
            } else {
              errors.push({
                type: 'error',
                code: 'CODE_BLOCK_UNCLOSED',
                message: 'Unclosed code block',
                location: locFromTo(codeStartLine, codeStartCol, lineStartOffset, lineNum, colNum, offset, source),
              });
              break;
            }
          }

          const codeRaw = content.substring(codeContentStart, codeEnd);
          const codeLines = codeRaw.split('\n');
          const codeEndLine = codeStartLine + codeLines.length + 1;
          const codeEndOff = codeEnd + 4; // \n```

          // Parse metadata from leading comments
          const firstLine = codeLines[0]?.trim() ?? '';
          let metadata: Record<string, string> | undefined;
          if (firstLine.startsWith('# @mam:')) {
            const commentLines: string[] = [];
            for (const cl of codeLines) {
              if (cl.trimStart().startsWith('#')) {
                commentLines.push(cl);
              } else break;
            }
            metadata = parseCodeMetadata(commentLines.join('\n'));
          }

          const codeValue = codeRaw.replace(/^#\s*@mam:.*\n?/gm, '').trim();

          contentNodes.push({
            type: 'CodeBlock',
            value: codeValue,
            language: language || undefined,
            metadata,
            location: locFromTo(codeStartLine, codeStartCol, lineStartOffset, codeEndLine, 3, codeEndOff, source),
          });
          totalCodeBlocks++;

          advance(codeEnd - offset + 4); // skip to after closing ```
          // Skip newline after closing fence
          if (offset < content.length && content[offset] === '\n') advance(1);
          continue;
        }

        // Horizontal rule
        if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(innerLine.trim())) {
          const hrLine = lineNum;
          advance(innerLine.length);
          contentNodes.push({
            type: 'HorizontalRule',
            value: '',
            location: locFromTo(hrLine, 0, lineStartOffset, hrLine, innerLine.length, offset, source),
          });
          if (offset < content.length && content[offset] === '\n') advance(1);
          continue;
        }

        // Table (line starts with |)
        if (innerLine.trimStart().startsWith('|')) {
          const tableLines: string[] = [];
          const tableStartLine = lineNum;
          const tableStartOff = offset;
          while (offset < content.length) {
            const tl = peekLine();
            if (!tl.trimStart().startsWith('|') && tl.trim() !== '') break;
            if (tl.trim() === '' && tableLines.length > 0) break;
            tableLines.push(tl);
            advance(tl.length);
            if (offset < content.length && content[offset] === '\n') advance(1);
          }
          const rows = parseTableRows(tableLines.join('\n'));
          contentNodes.push({
            type: 'Table',
            value: tableLines.join('\n'),
            rows,
            location: locFromTo(tableStartLine, 0, tableStartOff, lineNum, 0, offset, source),
          });
          continue;
        }

        // Blockquote
        if (innerLine.trimStart().startsWith('>')) {
          const bqLines: string[] = [];
          const bqStartLine = lineNum;
          const bqStartOff = offset;
          while (offset < content.length) {
            const bl = peekLine();
            if (!bl.trimStart().startsWith('>') && bl.trim() !== '') break;
            if (bl.trim() === '' && bqLines.length > 0) break;
            bqLines.push(bl);
            advance(bl.length);
            if (offset < content.length && content[offset] === '\n') advance(1);
          }
          contentNodes.push({
            type: 'Blockquote',
            value: parseBlockquote(bqLines.join('\n')),
            location: locFromTo(bqStartLine, 0, bqStartOff, lineNum, 0, offset, source),
          });
          continue;
        }

        // List item
        if (/^\s*[-*+]\s/.test(innerLine) || /^\s*\d+\.\s/.test(innerLine)) {
          const listLines: string[] = [];
          const listStartLine = lineNum;
          const listStartOff = offset;
          while (offset < content.length) {
            const ll = peekLine();
            if (/^\s*[-*+]\s/.test(ll) || /^\s*\d+\.\s/.test(ll)) {
              listLines.push(ll);
              advance(ll.length);
              if (offset < content.length && content[offset] === '\n') advance(1);
            } else if (ll.trim() === '' && listLines.length > 0) {
              // blank line might be between list items
              advance(ll.length);
              if (offset < content.length && content[offset] === '\n') advance(1);
              // Check if next line is still a list item
              const nextLl = peekLine();
              if (/^\s*[-*+]\s/.test(nextLl) || /^\s*\d+\.\s/.test(nextLl)) {
                continue;
              }
              break;
            } else {
              break;
            }
          }
          contentNodes.push({
            type: 'List',
            value: listLines.join('\n'),
            items: parseInlineList(listLines.join('\n')),
            location: locFromTo(listStartLine, 0, listStartOff, lineNum, 0, offset, source),
          });
          continue;
        }

        // Empty line
        if (innerLine.trim() === '') {
          advance(innerLine.length);
          if (offset < content.length && content[offset] === '\n') advance(1);
          continue;
        }

        // Paragraph — consume consecutive non-empty, non-special lines
        const paraLines: string[] = [];
        const paraStartLine = lineNum;
        const paraStartOff = offset;
        while (offset < content.length) {
          const pl = peekLine();
          const plMatch = pl.match(/^(#{1,6})\s+(.+)$/);
          if (plMatch && plMatch[1].length <= level) break;
          if (pl.trimStart().startsWith('```')) break;
          if (pl.trimStart().startsWith('|')) break;
          if (pl.trimStart().startsWith('>')) break;
          if (/^\s*[-*+]\s/.test(pl) || /^\s*\d+\.\s/.test(pl)) break;
          if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(pl.trim())) break;
          if (pl.trim() === '' && paraLines.length > 0) break;
          if (pl.trim() === '') {
            advance(pl.length);
            if (offset < content.length && content[offset] === '\n') advance(1);
            continue;
          }
          paraLines.push(pl);
          advance(pl.length);
          if (offset < content.length && content[offset] === '\n') advance(1);
        }
        if (paraLines.length > 0) {
          contentNodes.push({
            type: 'Paragraph',
            value: paraLines.join('\n'),
            location: locFromTo(paraStartLine, 0, paraStartOff, lineNum, 0, offset, source),
          });
        }
      }

      // Warn on unknown sections
      if (!STANDARD_SECTIONS.has(name) && !options?.allowUnknownSections) {
        warnings.push({
          type: 'warning',
          code: 'UNKNOWN_SECTION',
          message: `Unknown section "${name}"`,
          location: locFromTo(headingStartLine, headingStartCol, lineStartOffset, lineNum, 0, offset, source),
        });
      }

      // Warn on empty sections
      if (contentNodes.length === 0) {
        warnings.push({
          type: 'warning',
          code: 'EMPTY_SECTION',
          message: `Section "${name}" has no content`,
          location: locFromTo(headingStartLine, headingStartCol, lineStartOffset, lineNum, 0, offset, source),
        });
      }

      sections.push({
        type: 'Section',
        name,
        level,
        content: contentNodes,
        location: locFromTo(headingStartLine, headingStartCol, lineStartOffset, lineNum, 0, offset, source),
      });

      continue;
    }

    // Non-heading line outside sections — skip
    advance(line.length);
    if (offset < content.length && content[offset] === '\n') advance(1);
  }

  // Detect duplicate sections
  const seenSections = new Map<string, number>();
  for (const s of sections) {
    const count = (seenSections.get(s.name) ?? 0) + 1;
    seenSections.set(s.name, count);
    if (count > 1) {
      errors.push({
        type: 'error',
        code: 'SECTION_DUPLICATE',
        message: `Duplicate section "${s.name}"`,
        location: s.location,
      });
    }
  }

  const totalLines = lines.length;
  const parseTimeMs = Date.now() - startTime;

  const ast: AST = {
    type: 'MAMModule',
    frontmatter,
    sections,
    location: locFromTo(1, 0, 0, totalLines, 0, content.length, source),
    metadata: {
      totalSections: sections.length,
      totalCodeBlocks,
      totalLines,
      sourceName: source,
    },
  };

  return {
    ast,
    errors,
    warnings,
    stats: { totalSections: sections.length, totalCodeBlocks, totalLines, parseTimeMs },
  };
}

export function hasFrontMatter(content: string): boolean {
  const first = content.split('\n')[0]?.trim() ?? '';
  return first === '---';
}

export function getSectionNames(ast: AST): string[] {
  return ast.sections.map((section) => section.name);
}

export function countSections(ast: AST): number {
  return ast.sections.length;
}

export function countCodeBlocks(ast: AST): number {
  let total = 0;
  for (const section of ast.sections) {
    for (const node of section.content) {
      if (node.type === 'CodeBlock') {
        total++;
      }
    }
  }
  return total;
}

export function getCodeBlockLanguages(ast: AST): string[] {
  const languages: string[] = [];
  const seen = new Set<string>();
  for (const section of ast.sections) {
    for (const node of section.content) {
      if (node.type === 'CodeBlock') {
        const language = node.language ?? 'unknown';
        if (!seen.has(language)) {
          seen.add(language);
          languages.push(language);
        }
      }
    }
  }
  return languages;
}

export function findSection(ast: AST, name: string): Section | undefined {
  const lower = name.toLowerCase();
  return ast.sections.find((section) => section.name.toLowerCase() === lower);
}

export function isValidSectionName(name: string): boolean {
  return STANDARD_SECTIONS.has(name);
}
