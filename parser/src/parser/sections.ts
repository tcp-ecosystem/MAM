/**
 * MAM Sections Parser
 * 
 * Parses sections from token stream into structured content nodes.
 */

import { Token, TokenType, STANDARD_SECTIONS } from '../lexer/tokens.js';
import { ParseError, ParseErrorCode, ParseWarning, ParseWarningCode } from './errors.js';

export interface SectionData {
  name: string;
  level: number;
  content: ContentNode[];
  location: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
}

export type ContentNode = 
  | ParagraphNode 
  | ListNode 
  | CodeBlockNode 
  | TableNode 
  | MermaidNode
  | HeadingNode
  | BlockquoteNode
  | HorizontalRuleNode;

export interface ParagraphNode {
  type: 'paragraph';
  value: string;
  inlineNodes: InlineNode[];
  location: SourceLocation;
}

export interface ListNode {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
  location: SourceLocation;
}

export interface ListItem {
  content: ContentNode[];
  checked?: boolean;
}

export interface CodeBlockNode {
  type: 'codeblock';
  language: string;
  value: string;
  metadata: Record<string, string>;
  location: SourceLocation;
}

export interface TableNode {
  type: 'table';
  headers: string[];
  rows: string[][];
  alignments: string[];
  location: SourceLocation;
}

export interface MermaidNode {
  type: 'mermaid';
  value: string;
  location: SourceLocation;
}

export interface HeadingNode {
  type: 'heading';
  level: number;
  value: string;
  location: SourceLocation;
}

export interface BlockquoteNode {
  type: 'blockquote';
  value: string;
  children: ContentNode[];
  location: SourceLocation;
}

export interface HorizontalRuleNode {
  type: 'horizontalrule';
  value: string;
  location: SourceLocation;
}

export interface InlineNode {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'image' | 'strikethrough';
  value: string;
  url?: string;
  title?: string;
}

export interface SourceLocation {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
  source: string;
}

export interface SectionParseResult {
  sections: SectionData[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

/**
 * Parse sections from token stream
 */
export function parseSections(
  tokens: Token[],
  startIndex: number,
  source: string
): SectionParseResult {
  const sections: SectionData[] = [];
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  let pos = startIndex;

  while (pos < tokens.length) {
    // Skip whitespace
    while (pos < tokens.length && isWhitespace(tokens[pos]!)) {
      pos++;
    }

    // Check for EOF
    if (pos >= tokens.length || tokens[pos]!.type === TokenType.EOF) {
      break;
    }

    // Look for heading
    const token = tokens[pos]!;
    if (isHeadingToken(token.type)) {
      const result = parseSection(tokens, pos, source);
      sections.push(result.section);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      // Guarantee forward progress. `parseSection` returns the cursor it
      // stopped on; if a section body consumed nothing and the next token is
      // another heading of the same level, that cursor can equal `pos`, which
      // would spin this loop forever. Always advance by at least one token.
      pos = result.endIndex > pos ? result.endIndex : pos + 1;
    } else {
      // Skip unexpected tokens
      pos++;
    }
  }

  // Validate section order
  validateSectionOrder(sections, source, warnings);

  return { sections, errors, warnings };
}

/**
 * Parse a single section
 */
function parseSection(
  tokens: Token[],
  startIndex: number,
  source: string
): { section: SectionData; endIndex: number; errors: ParseError[]; warnings: ParseWarning[] } {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  let pos = startIndex;

  // Parse heading
  const headingToken = tokens[pos]!;
  const level = getHeadingLevel(headingToken.type);
  pos++;

  // Get heading text
  let headingText = '';
  if (pos < tokens.length && tokens[pos]!.type === TokenType.HEADING_TEXT) {
    headingText = tokens[pos]!.value;
    pos++;
  }

  const sectionName = headingText.trim();
  const isCustom = !STANDARD_SECTIONS.has(sectionName);

  if (isCustom) {
    warnings.push(
      new ParseWarning(
        `Unknown section: ${sectionName}`,
        source,
        headingToken.line,
        headingToken.column,
        ParseWarningCode.UNKNOWN_SECTION
      )
    );
  }

  const startLocation = {
    line: headingToken.line,
    column: headingToken.column,
    offset: headingToken.offset,
  };

  // Parse section content
  const content = parseSectionContent(tokens, pos, source, level, errors, warnings);
  pos = content.endIndex;

  const endLocation = pos < tokens.length
    ? { line: tokens[pos - 1]!.line, column: tokens[pos - 1]!.column + tokens[pos - 1]!.length, offset: tokens[pos - 1]!.offset + tokens[pos - 1]!.length }
    : startLocation;

  const section: SectionData = {
    name: sectionName,
    level,
    content: content.nodes,
    location: {
      start: startLocation,
      end: endLocation,
    },
  };

  // Check for empty section
  if (content.nodes.length === 0) {
    warnings.push(
      new ParseWarning(
        `Empty section: ${sectionName}`,
        source,
        headingToken.line,
        headingToken.column,
        ParseWarningCode.EMPTY_SECTION
      )
    );
  }

  return { section, endIndex: pos, errors, warnings };
}

/**
 * Parse section content until next heading of same or higher level
 */
function parseSectionContent(
  tokens: Token[],
  startIndex: number,
  source: string,
  parentLevel: number,
  errors: ParseError[],
  warnings: ParseWarning[]
): { nodes: ContentNode[]; endIndex: number } {
  const nodes: ContentNode[] = [];
  let pos = startIndex;

  while (pos < tokens.length) {
    const token = tokens[pos]!;

    // Stop at EOF
    if (token.type === TokenType.EOF) {
      break;
    }

    // Stop at heading of same or higher level
    // Special case: H1 is always the title, not a container — any new heading breaks it
    if (isHeadingToken(token.type)) {
      const nextLevel = getHeadingLevel(token.type);
      if (nextLevel <= parentLevel || parentLevel === 1) {
        break;
      }
    }

    // Skip whitespace
    if (isWhitespace(token.type)) {
      pos++;
      continue;
    }

    // Parse based on token type
    const result = parseContentNode(tokens, pos, source, errors, warnings);
    if (result.node) {
      nodes.push(result.node);
    }
    // Guarantee forward progress. A content node that recognises nothing can
    // return the cursor unchanged, which would spin this loop forever (this
    // is reachable with tokens such as an unmatched inline link). Always
    // advance by at least one token.
    pos = result.endIndex > pos ? result.endIndex : pos + 1;
  }

  return { nodes, endIndex: pos };
}

/**
 * Parse a single content node
 */
function parseContentNode(
  tokens: Token[],
  startIndex: number,
  source: string,
  errors: ParseError[],
  warnings: ParseWarning[]
): { node: ContentNode | null; endIndex: number } {
  const token = tokens[startIndex]!;

  switch (token.type) {
    case TokenType.CODE_FENCE_BACKTICK:
    case TokenType.CODE_FENCE_TILDE:
      return parseCodeBlock(tokens, startIndex, source, errors);

    case TokenType.BULLET_LIST:
    case TokenType.NUMBERED_LIST:
      return parseList(tokens, startIndex, source, errors);

    case TokenType.TABLE_PIPE:
    case TokenType.TABLE_HEADER_CELL:
      return parseTable(tokens, startIndex, source, errors);

    case TokenType.BLOCKQUOTE:
      return parseBlockquote(tokens, startIndex, source, errors);

    case TokenType.HORIZONTAL_RULE:
      return parseHorizontalRule(tokens, startIndex, source);

    case TokenType.HEADING_1:
    case TokenType.HEADING_2:
    case TokenType.HEADING_3:
    case TokenType.HEADING_4:
    case TokenType.HEADING_5:
    case TokenType.HEADING_6:
      return parseInlineHeading(tokens, startIndex, source);

    case TokenType.TEXT:
      return parseParagraph(tokens, startIndex, source);

    default:
      // Skip unknown tokens
      return { node: null, endIndex: startIndex + 1 };
  }
}

/**
 * Parse code block
 */
function parseCodeBlock(
  tokens: Token[],
  startIndex: number,
  source: string,
  errors: ParseError[]
): { node: CodeBlockNode; endIndex: number } {
  let pos = startIndex;
  const fenceToken = tokens[pos]!;
  const fenceChar = fenceToken.type === TokenType.CODE_FENCE_BACKTICK ? '`' : '~';

  pos++; // Skip opening fence

  // Get language
  let language = '';
  if (pos < tokens.length && tokens[pos]!.type === TokenType.CODE_LANGUAGE) {
    language = tokens[pos]!.metadata?.language || tokens[pos]!.value.toLowerCase();
    pos++;
  }

  // Collect code content
  const codeLines: string[] = [];
  const metadata: Record<string, string> = {};

  while (pos < tokens.length) {
    const token = tokens[pos]!;

    // Check for closing fence
    if ((token.type === TokenType.CODE_FENCE_BACKTICK || token.type === TokenType.CODE_FENCE_TILDE) &&
        token.value.startsWith(fenceChar.repeat(3))) {
      pos++; // Skip closing fence
      break;
    }

    // Check for EOF
    if (token.type === TokenType.EOF) {
      errors.push(
        new ParseError(
          'Unterminated code block',
          source,
          fenceToken.line,
          fenceToken.column,
          ParseErrorCode.UNTERMINATED_CODE_BLOCK
        )
      );
      break;
    }

    // Collect code content
    if (token.type === TokenType.CODE_CONTENT) {
      codeLines.push(token.value);
    } else if (token.type === TokenType.CODE_METADATA) {
      const meta = token.metadata?.codeMetadata;
      if (meta) {
        Object.assign(metadata, meta);
      }
    } else if (token.type === TokenType.NEWLINE) {
      codeLines.push('');
    }

    pos++;
  }

  const endPos = pos < tokens.length ? pos : tokens.length - 1;
  const endToken = tokens[endPos]!;

  return {
    node: {
      type: 'codeblock',
      language,
      value: codeLines.join('\n').trim(),
      metadata,
      location: {
        start: { line: fenceToken.line, column: fenceToken.column, offset: fenceToken.offset },
        end: { line: endToken.line, column: endToken.column + endToken.length, offset: endToken.offset + endToken.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse list
 */
function parseList(
  tokens: Token[],
  startIndex: number,
  source: string,
  errors: ParseError[]
): { node: ListNode; endIndex: number } {
  let pos = startIndex;
  const firstToken = tokens[pos]!;
  const ordered = firstToken.type === TokenType.NUMBERED_LIST;
  const items: ListItem[] = [];

  while (pos < tokens.length) {
    const token = tokens[pos]!;

    // Check for list item
    if (token.type !== TokenType.BULLET_LIST && token.type !== TokenType.NUMBERED_LIST) {
      break;
    }

    pos++; // Skip list marker

    // Check for task list
    let checked: boolean | undefined;
    if (pos < tokens.length) {
      if (tokens[pos]!.type === TokenType.TASK_CHECKED) {
        checked = true;
        pos++;
      } else if (tokens[pos]!.type === TokenType.TASK_UNCHECKED) {
        checked = false;
        pos++;
      }
    }

    // Get list item text
    let itemText = '';
    while (pos < tokens.length) {
      const itemToken = tokens[pos]!;
      
      if (itemToken.type === TokenType.NEWLINE) {
        pos++;
        // Check if next line continues the list
        if (pos < tokens.length && 
            (tokens[pos]!.type === TokenType.BULLET_LIST || tokens[pos]!.type === TokenType.NUMBERED_LIST)) {
          break;
        }
        // Check if next line is a heading or code fence - end the list
        if (pos < tokens.length &&
            (tokens[pos]!.type === TokenType.HEADING_1 ||
             tokens[pos]!.type === TokenType.HEADING_2 ||
             tokens[pos]!.type === TokenType.HEADING_3 ||
             tokens[pos]!.type === TokenType.HEADING_4 ||
             tokens[pos]!.type === TokenType.HEADING_5 ||
             tokens[pos]!.type === TokenType.HEADING_6 ||
             tokens[pos]!.type === TokenType.CODE_FENCE_BACKTICK ||
             tokens[pos]!.type === TokenType.CODE_FENCE_TILDE)) {
          break;
        }
        itemText += '\n';
        continue;
      }

      if (itemToken.type === TokenType.LIST_ITEM_TEXT) {
        itemText += itemToken.value;
        pos++;
        continue;
      }

      if (itemToken.type === TokenType.BULLET_LIST || itemToken.type === TokenType.NUMBERED_LIST) {
        break;
      }

      // Other content
      itemText += itemToken.value;
      pos++;
    }

    items.push({
      content: [{
        type: 'paragraph',
        value: itemText.trim(),
        inlineNodes: parseInlineContent(itemText.trim()),
        location: {
          start: { line: firstToken.line, column: firstToken.column, offset: firstToken.offset },
          end: { line: firstToken.line, column: firstToken.column + firstToken.length, offset: firstToken.offset + firstToken.length },
          source,
        },
      }],
      checked,
    });
  }

  const endToken = tokens[Math.min(pos, tokens.length - 1)]!;

  return {
    node: {
      type: 'list',
      ordered,
      items,
      location: {
        start: { line: firstToken.line, column: firstToken.column, offset: firstToken.offset },
        end: { line: endToken.line, column: endToken.column + endToken.length, offset: endToken.offset + endToken.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse table
 */
function parseTable(
  tokens: Token[],
  startIndex: number,
  source: string,
  errors: ParseError[]
): { node: TableNode; endIndex: number } {
  let pos = startIndex;
  const headers: string[] = [];
  const rows: string[][] = [];
  const alignments: string[] = [];

  // Parse header row
  while (pos < tokens.length) {
    const token = tokens[pos]!;
    
    if (token.type === TokenType.TABLE_HEADER_CELL) {
      headers.push(token.value);
      pos++;
    } else if (token.type === TokenType.TABLE_PIPE) {
      pos++;
    } else if (token.type === TokenType.TABLE_HYPHEN) {
      // Separator row - parse alignments
      const alignRow = token.value;
      const alignCells = alignRow.split('|').filter(c => c.trim().length > 0);
      for (const cell of alignCells) {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
          alignments.push('center');
        } else if (trimmed.endsWith(':')) {
          alignments.push('right');
        } else {
          alignments.push('left');
        }
      }
      pos++;
      break;
    } else {
      break;
    }
  }

  // Parse data rows
  while (pos < tokens.length) {
    // Skip whitespace between table rows
    while (pos < tokens.length && tokens[pos]!.type === TokenType.WHITESPACE) {
      pos++;
    }
    // Also skip TABLE_PIPE at the start of a row (left border)
    if (pos < tokens.length && tokens[pos]!.type === TokenType.TABLE_PIPE) {
      pos++;
    }

    const token = tokens[pos]!;
    
    if (token.type === TokenType.TABLE_ROW_CELL || token.type === TokenType.TABLE_HEADER_CELL) {
      const row: string[] = [];
      while (pos < tokens.length && 
             (tokens[pos]!.type === TokenType.TABLE_ROW_CELL || tokens[pos]!.type === TokenType.TABLE_HEADER_CELL)) {
        row.push(tokens[pos]!.value);
        pos++;
        if (pos < tokens.length && tokens[pos]!.type === TokenType.TABLE_PIPE) {
          pos++;
        }
      }
      if (row.length > 0) {
        rows.push(row);
      }
    } else {
      break;
    }
  }

  const endToken = tokens[Math.min(pos, tokens.length - 1)]!;

  return {
    node: {
      type: 'table',
      headers,
      rows,
      alignments,
      location: {
        start: { line: tokens[startIndex]!.line, column: tokens[startIndex]!.column, offset: tokens[startIndex]!.offset },
        end: { line: endToken.line, column: endToken.column + endToken.length, offset: endToken.offset + endToken.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse blockquote
 */
function parseBlockquote(
  tokens: Token[],
  startIndex: number,
  source: string,
  errors: ParseError[]
): { node: BlockquoteNode; endIndex: number } {
  let pos = startIndex;
  const firstToken = tokens[pos]!;
  const lines: string[] = [];

  while (pos < tokens.length) {
    const token = tokens[pos]!;
    
    if (token.type !== TokenType.BLOCKQUOTE) {
      break;
    }

    pos++; // Skip >

    // Collect text until newline
    let lineText = '';
    while (pos < tokens.length && tokens[pos]!.type !== TokenType.NEWLINE) {
      lineText += tokens[pos]!.value;
      pos++;
    }

    lines.push(lineText);

    if (pos < tokens.length && tokens[pos]!.type === TokenType.NEWLINE) {
      pos++;
    }
  }

  const endToken = tokens[Math.min(pos, tokens.length - 1)]!;

  return {
    node: {
      type: 'blockquote',
      value: lines.join('\n'),
      children: [],
      location: {
        start: { line: firstToken.line, column: firstToken.column, offset: firstToken.offset },
        end: { line: endToken.line, column: endToken.column + endToken.length, offset: endToken.offset + endToken.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse horizontal rule
 */
function parseHorizontalRule(
  tokens: Token[],
  startIndex: number,
  source: string
): { node: HorizontalRuleNode; endIndex: number } {
  const token = tokens[startIndex]!;
  
  return {
    node: {
      type: 'horizontalrule',
      value: token.value,
      location: {
        start: { line: token.line, column: token.column, offset: token.offset },
        end: { line: token.line, column: token.column + token.length, offset: token.offset + token.length },
        source,
      },
    },
    endIndex: startIndex + 1,
  };
}

/**
 * Parse inline heading (within section)
 */
function parseInlineHeading(
  tokens: Token[],
  startIndex: number,
  source: string
): { node: HeadingNode; endIndex: number } {
  let pos = startIndex;
  const token = tokens[pos]!;
  const level = getHeadingLevel(token.type);
  pos++;

  let text = '';
  if (pos < tokens.length && tokens[pos]!.type === TokenType.HEADING_TEXT) {
    text = tokens[pos]!.value;
    pos++;
  }

  return {
    node: {
      type: 'heading',
      level,
      value: text,
      location: {
        start: { line: token.line, column: token.column, offset: token.offset },
        end: { line: token.line, column: token.column + token.length, offset: token.offset + token.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse paragraph
 */
function parseParagraph(
  tokens: Token[],
  startIndex: number,
  source: string
): { node: ParagraphNode; endIndex: number } {
  let pos = startIndex;
  const firstToken = tokens[pos]!;
  let text = '';

  while (pos < tokens.length) {
    const token = tokens[pos]!;

    // Stop at structural elements
    if (isStructuralBreak(token.type)) {
      break;
    }

    text += token.value;
    pos++;

    // Add space between tokens if needed
    if (pos < tokens.length && !isWhitespace(tokens[pos]!.type) && 
        !isStructuralBreak(tokens[pos]!.type)) {
      // Check if we need a space
    }
  }

  const endToken = tokens[Math.min(pos - 1, tokens.length - 1)]!;

  return {
    node: {
      type: 'paragraph',
      value: text.trim(),
      inlineNodes: parseInlineContent(text.trim()),
      location: {
        start: { line: firstToken.line, column: firstToken.column, offset: firstToken.offset },
        end: { line: endToken.line, column: endToken.column + endToken.length, offset: endToken.offset + endToken.length },
        source,
      },
    },
    endIndex: pos,
  };
}

/**
 * Parse inline content (bold, italic, code, links)
 */
function parseInlineContent(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pos = 0;

  while (pos < text.length) {
    // Bold **
    if (text.slice(pos, pos + 2) === '**') {
      const end = text.indexOf('**', pos + 2);
      if (end !== -1) {
        nodes.push({ type: 'bold', value: text.slice(pos + 2, end) });
        pos = end + 2;
        continue;
      }
    }

    // Italic *
    if (text[pos] === '*' && (pos + 1 < text.length && text[pos + 1] !== '*')) {
      const end = text.indexOf('*', pos + 1);
      if (end !== -1 && text[end - 1] !== '*') {
        nodes.push({ type: 'italic', value: text.slice(pos + 1, end) });
        pos = end + 1;
        continue;
      }
    }

    // Code `
    if (text[pos] === '`') {
      const end = text.indexOf('`', pos + 1);
      if (end !== -1) {
        nodes.push({ type: 'code', value: text.slice(pos + 1, end) });
        pos = end + 1;
        continue;
      }
    }

    // Link [text](url)
    if (text[pos] === '[') {
      // Anchor the search at the current position. Searching from index 0 can
      // match a `](` that lies *before* `pos`, which made `pos` jump backwards
      // and spun this loop forever (e.g. "[x](y) and [z").
      const closeBracket = text.indexOf('](', pos + 1);
      if (closeBracket > pos + 1) {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(pos + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          nodes.push({ type: 'link', value: linkText, url });
          pos = closeParen + 1;
          continue;
        }
      }
    }

    // Image ![alt](url)
    if (text.slice(pos, pos + 2) === '![') {
      const closeBracket = text.indexOf('](', pos + 2);
      if (closeBracket !== -1) {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const alt = text.slice(pos + 2, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          nodes.push({ type: 'image', value: alt, url });
          pos = closeParen + 1;
          continue;
        }
      }
    }

    // Regular text
    let textEnd = pos + 1;
    while (textEnd < text.length && !isInlineMarker(text[textEnd]!)) {
      textEnd++;
    }
    nodes.push({ type: 'text', value: text.slice(pos, textEnd) });
    pos = textEnd;
  }

  return nodes;
}

function isInlineMarker(char: string): boolean {
  return char === '*' || char === '`' || char === '[' || char === '!';
}

// ============================================================================
// Helper Functions
// ============================================================================

function isWhitespace(token: TokenType | { type: TokenType }): boolean {
  const type = typeof token === 'string' ? token : token.type;
  return type === TokenType.NEWLINE || type === TokenType.WHITESPACE || type === TokenType.INDENT;
}

function isHeadingToken(token: TokenType | { type: TokenType }): boolean {
  const type = typeof token === 'string' ? token : token.type;
  return type >= TokenType.HEADING_1 && type <= TokenType.HEADING_6;
}

function getHeadingLevel(token: TokenType): number {
  const levels: Record<string, number> = {
    [TokenType.HEADING_1]: 1,
    [TokenType.HEADING_2]: 2,
    [TokenType.HEADING_3]: 3,
    [TokenType.HEADING_4]: 4,
    [TokenType.HEADING_5]: 5,
    [TokenType.HEADING_6]: 6,
  };
  return levels[token] || 1;
}

function isStructuralBreak(token: TokenType): boolean {
  return isHeadingToken(token) ||
         token === TokenType.CODE_FENCE_BACKTICK ||
         token === TokenType.CODE_FENCE_TILDE ||
         token === TokenType.BULLET_LIST ||
         token === TokenType.NUMBERED_LIST ||
         token === TokenType.TABLE_PIPE ||
         token === TokenType.BLOCKQUOTE ||
         token === TokenType.HORIZONTAL_RULE ||
         token === TokenType.FRONTMATTER_SEPARATOR ||
         token === TokenType.EOF;
}

function validateSectionOrder(
  sections: SectionData[],
  source: string,
  warnings: ParseWarning[]
): void {
  const idealOrder = [
    'Purpose',
    'Inputs',
    'Outputs',
    'Rules',
    'Workflow',
    'Mermaid',
    'Python',
    'JavaScript',
    'TypeScript',
    'Prompt',
    'Memory',
    'Examples',
    'Tests',
    'References',
  ];

  let lastIdealIndex = -1;

  for (const section of sections) {
    const idealIndex = idealOrder.indexOf(section.name);
    if (idealIndex !== -1) {
      if (idealIndex < lastIdealIndex) {
        warnings.push(
          new ParseWarning(
            `Section "${section.name}" is out of recommended order`,
            source,
            section.location.start.line,
            section.location.start.column,
            ParseWarningCode.SECTION_ORDER
          )
        );
      }
      lastIdealIndex = Math.max(lastIdealIndex, idealIndex);
    }
  }
}