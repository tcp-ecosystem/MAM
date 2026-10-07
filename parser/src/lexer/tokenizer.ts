/**
 * MAM Tokenizer
 * 
 * Production-grade lexer for MAM documents.
 * Converts raw Markdown text into a stream of tokens with full source location tracking.
 * 
 * Features:
 * - Complete Markdown syntax support
 * - Front matter parsing (YAML)
 * - Code block detection with language identifiers
 * - Table parsing
 * - Inline formatting detection
 * - Error recovery and reporting
 * - Source location tracking
 * - Performance optimized with minimal allocations
 */

import {
  TokenType,
  Token,
  TokenMetadata,
  createToken,
  VALID_LANGUAGES,
} from './tokens.js';
import { LexerError, LexerWarning, LexerErrorCode, LexerWarningCode } from './errors.js';

// ============================================================================
// Configuration
// ============================================================================

export interface TokenizerOptions {
  /** Start line number (for incremental parsing) */
  startLine?: number;
  /** Start column number */
  startColumn?: number;
  /** Source filename for error reporting */
  source?: string;
  /** Maximum token length to prevent DoS */
  maxTokenLength?: number;
  /** Maximum nesting depth */
  maxDepth?: number;
  /** Enable strict mode (more errors) */
  strict?: boolean;
  /** Track inline formatting */
  trackInline?: boolean;
}

export interface TokenizeResult {
  tokens: Token[];
  errors: LexerError[];
  warnings: LexerWarning[];
  stats: TokenizerStats;
}

export interface TokenizerStats {
  totalTokens: number;
  totalLines: number;
  totalChars: number;
  timeMs: number;
  tokensPerMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKEN_LENGTH = 100_000;
const DEFAULT_MAX_DEPTH = 50;
const LONG_LINE_THRESHOLD = 500;

// ============================================================================
// Tokenizer Class
// ============================================================================

export class Tokenizer {
  private input: string = '';
  private pos: number = 0;
  private line: number = 1;
  private column: number = 0;
  private tokens: Token[] = [];
  private errors: LexerError[] = [];
  private warnings: LexerWarning[] = [];
  private source: string;
  private maxTokenLength: number;
  private maxDepth: number;
  private strict: boolean;
  private trackInline: boolean;
  private startTime: number = 0;
  private depth: number = 0;

  // State tracking
  private inFrontMatter: boolean = false;
  private inCodeBlock: boolean = false;
  private codeBlockLanguage: string = '';
  private codeBlockDepth: number = 0;
  private lastTokenType: TokenType | null = null;
  private atLineStart: boolean = false;

  constructor(options: TokenizerOptions = {}) {
    this.source = options.source || '<input>';
    this.maxTokenLength = options.maxTokenLength || DEFAULT_MAX_TOKEN_LENGTH;
    this.maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
    this.strict = options.strict || false;
    this.trackInline = options.trackInline !== false;
  }

  /**
   * Tokenize the entire input string
   */
  tokenize(input: string): TokenizeResult {
    this.input = input;
    this.pos = 0;
    this.line = 1;
    this.column = 0;
    this.tokens = [];
    this.errors = [];
    this.warnings = [];
    this.depth = 0;
    this.inFrontMatter = false;
    this.inCodeBlock = false;
    this.codeBlockLanguage = '';
    this.lastTokenType = null;
    this.startTime = performance.now();

    // Check for missing newline at EOF
    if (input.length > 0 && !input.endsWith('\n')) {
      this.warnings.push(
        new LexerWarning(
          'Missing newline at end of file',
          this.source,
          this.line,
          this.column,
          LexerWarningCode.MISSING_NEWLINE_AT_EOF
        )
      );
    }

    // Main tokenization loop
    while (this.pos < this.input.length) {
      this.nextToken();
    }

    // Add EOF token
    this.tokens.push(
      createToken(TokenType.EOF, '', this.line, this.column, this.pos)
    );

    const elapsedMs = performance.now() - this.startTime;
    const stats: TokenizerStats = {
      totalTokens: this.tokens.length,
      totalLines: this.line,
      totalChars: this.input.length,
      timeMs: elapsedMs,
      tokensPerMs: elapsedMs > 0 ? this.tokens.length / elapsedMs : 0,
    };

    return {
      tokens: this.tokens,
      errors: this.errors,
      warnings: this.warnings,
      stats,
    };
  }

  /**
   * Tokenize incrementally (for editor support)
   */
  tokenizeRange(start: number, end: number): Token[] {
    const slice = this.input.slice(start, end);
    const result = this.tokenize(slice);
    return result.tokens;
  }

  // ==========================================================================
  // Main Token Dispatch
  // ==========================================================================

  private nextToken(): void {
    if (this.depth >= this.maxDepth) {
      this.errors.push(
        new LexerError(
          'Maximum tokenization depth exceeded',
          this.source,
          this.line,
          this.column,
          LexerErrorCode.DEPTH_EXCEEDED
        )
      );
      return;
    }

    this.depth++;

    try {
      // Handle code block content specially
      if (this.inCodeBlock) {
        this.readCodeBlockContent();
        return;
      }

      // Handle front matter content specially
      if (this.inFrontMatter) {
        this.readFrontMatterContent();
        return;
      }

      this.skipWhitespace();

      if (this.pos >= this.input.length) {
        return;
      }

      const char = this.input[this.pos]!;
      const remaining = this.input.slice(this.pos);

      // Detect unexpected control/non-printable characters
      const charCode = char.charCodeAt(0);
      if (charCode < 32 && char !== '\n' && char !== '\t') {
        this.errors.push(
          new LexerError(
            `Unexpected character: ${char}`,
            this.source,
            this.line,
            this.column,
            LexerErrorCode.UNEXPECTED_CHARACTER
          )
        );
        this.consumeChar();
        return;
      }

      // Priority 1: Front matter separator
      if (this.isAtLineStart() && this.isFrontMatterSeparator(remaining)) {
        this.readFrontMatterSeparator();
        this.atLineStart = false;
        return;
      }

      // Priority 2: Code fence
      if (this.isCodeFence(remaining)) {
        this.readCodeFence();
        this.atLineStart = false;
        return;
      }

      // Priority 3: Headings (must be at line start)
      if (char === '#' && this.isAtLineStart()) {
        this.readHeading();
        this.atLineStart = false;
        return;
      }

      // Priority 4: Horizontal rule (must be at line start)
      if (this.isAtLineStart() && this.isHorizontalRule(remaining)) {
        this.readHorizontalRule();
        this.atLineStart = false;
        return;
      }

      // Priority 5: Blockquote
      if (char === '>' && this.isAtLineStart()) {
        this.readBlockquote();
        this.atLineStart = false;
        return;
      }

      // Priority 6: Table
      if (char === '|' && this.isAtLineStart()) {
        this.readTableRow();
        this.atLineStart = false;
        return;
      }

      // Priority 7: List items
      if (this.isAtLineStart() && this.isListMarker(remaining)) {
        this.readListItem();
        return;
      }

      // Priority 8: Inline formatting
      if (this.trackInline && this.isInlineFormatting(remaining)) {
        this.readInlineFormatting();
        this.atLineStart = false;
        return;
      }

      // Priority 9: Regular text
      this.readText();
      this.atLineStart = false;
    } finally {
      this.depth--;
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private peekAhead(n: number): string {
    return this.input.slice(this.pos, this.pos + n);
  }

  private peekChar(offset: number = 0): string {
    return this.input[this.pos + offset] || '';
  }

  private peekLine(): string {
    const lineEnd = this.input.indexOf('\n', this.pos);
    return lineEnd === -1 ? this.input.slice(this.pos) : this.input.slice(this.pos, lineEnd);
  }

  private isAtLineStart(): boolean {
    return this.column === 0 || this.pos === 0 || this.atLineStart;
  }

  private isEOF(): boolean {
    return this.pos >= this.input.length;
  }

  private consumeChar(): string {
    const char = this.input[this.pos]!;
    this.pos++;
    this.column++;
    return char;
  }

  private consumeChars(n: number): string {
    const chars = this.input.slice(this.pos, this.pos + n);
    this.pos += n;
    this.column += n;
    return chars;
  }

  private advanceToLineEnd(): void {
    while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
      this.pos++;
      this.column++;
    }
  }

  private advanceTo(offset: number): void {
    while (this.pos < offset && this.pos < this.input.length) {
      if (this.input[this.pos] === '\n') {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  // ==========================================================================
  // Whitespace Handling
  // ==========================================================================

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos]!;
      if (char === '\n') {
        this.tokens.push(
          createToken(TokenType.NEWLINE, '\n', this.line, this.column, this.pos)
        );
        this.pos++;
        this.line++;
        this.column = 0;
        this.lastTokenType = TokenType.NEWLINE;
        this.atLineStart = true;
      } else if (char === ' ' || char === '\t') {
        const startCol = this.column;
        const startOffset = this.pos;
        let indent = '';
        while (this.pos < this.input.length && (this.input[this.pos] === ' ' || this.input[this.pos] === '\t')) {
          indent += this.consumeChar();
        }
        // Only emit INDENT token if at line start and significant
        if (this.isAtLineStart() && indent.length >= 2) {
          this.tokens.push(
            createToken(TokenType.INDENT, indent, this.line, startCol, startOffset, {
              indentation: indent.length,
            })
          );
        }
      } else {
        break;
      }
    }
  }

  // ==========================================================================
  // Front Matter
  // ==========================================================================

  private isFrontMatterSeparator(remaining: string): boolean {
    const line = remaining.split('\n')[0]!;
    // Only match --- as front matter if at absolute document start (pos 0)
    // Otherwise --- is a horizontal rule, not front matter
    if (this.pos !== 0) return false;
    return /^---\s*$/.test(line);
  }

  private readFrontMatterSeparator(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    this.consumeChars(3); // ---

    this.tokens.push(
      createToken(TokenType.FRONTMATTER_SEPARATOR, '---', startLine, startCol, startOffset)
    );

    this.inFrontMatter = !this.inFrontMatter;
  }

  private readFrontMatterContent(): void {
    const line = this.peekLine();
    
    // Check for closing separator
    if (/^---\s*$/.test(line)) {
      this.readFrontMatterSeparator();
      return;
    }

    // Parse YAML line
    this.readYAMLLine();
  }

  private readYAMLLine(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine();

    // Skip to end of line
    this.advanceToLineEnd();
    if (!this.isEOF()) {
      this.consumeChar(); // newline
      this.line++;
      this.column = 0;
    }

    // Check for list item
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      this.tokens.push(
        createToken(TokenType.YAML_LIST_ITEM, trimmed.slice(2), startLine, startCol, startOffset, {
          yamlValue: trimmed.slice(2),
        })
      );
      return;
    }

    // Check for key-value pair
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      
      this.tokens.push(
        createToken(TokenType.YAML_KEY, key, startLine, startCol, startOffset, {
          yamlKey: key,
        })
      );
      
      if (value.length > 0) {
        this.tokens.push(
          createToken(TokenType.YAML_VALUE, value, startLine, startCol + colonIndex + 1, startOffset + colonIndex + 1, {
            yamlValue: value,
          })
        );
      }
      return;
    }

    // Plain text
    this.tokens.push(
      createToken(TokenType.TEXT, line, startLine, startCol, startOffset)
    );
  }

  // ==========================================================================
  // Code Blocks
  // ==========================================================================

  private isCodeFence(remaining: string): boolean {
    const line = remaining.split('\n')[0]!;
    return /^`{3,}[^`]*/.test(line) || /^~{3,}[^~]*/.test(line);
  }

  private readCodeFence(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine();

    // Determine fence type
    const isBacktick = line.startsWith('`');
    const fenceChar = isBacktick ? '`' : '~';
    
    // Count fence characters
    let fenceCount = 0;
    while (fenceCount < line.length && line[fenceCount] === fenceChar) {
      fenceCount++;
    }

    const fence = fenceChar.repeat(fenceCount);
    this.consumeChars(fenceCount);

    // Emit fence token
    this.tokens.push(
      createToken(
        isBacktick ? TokenType.CODE_FENCE_BACKTICK : TokenType.CODE_FENCE_TILDE,
        fence,
        startLine,
        startCol,
        startOffset
      )
    );

    // Read language identifier
    const restOfLine = line.slice(fenceCount).trim();
    if (restOfLine.length > 0) {
      const lang = restOfLine.split(/\s/)[0]!.toLowerCase();
      
      if (VALID_LANGUAGES.has(lang)) {
        this.tokens.push(
          createToken(TokenType.CODE_LANGUAGE, restOfLine, startLine, startCol + fenceCount, startOffset + fenceCount, {
            language: lang,
          })
        );
        this.codeBlockLanguage = lang;
      } else if (restOfLine.length > 0) {
        // Unknown language - still track it
        this.tokens.push(
          createToken(TokenType.CODE_LANGUAGE, restOfLine, startLine, startCol + fenceCount, startOffset + fenceCount, {
            language: lang,
          })
        );
        this.codeBlockLanguage = lang;
      }
    }

    // Move to next line
    this.advanceToLineEnd();
    if (!this.isEOF()) {
      this.consumeChar(); // newline
      this.line++;
      this.column = 0;
    }

    // Check if this is a closing fence (empty code block)
    if (this.isCodeFence(this.peekLine())) {
      const closingLine = this.peekLine();
      const closingFenceChar = closingLine[0]!;
      const closingFence = closingFenceChar.repeat(Math.min(fenceCount, closingLine.length));
      
      if (closingFence === fence && this.peekLine().trim() === fence) {
        this.inCodeBlock = false;
        this.readCodeFence(); // Read closing fence
        return;
      }
    }

    this.inCodeBlock = true;
    this.codeBlockDepth = this.depth;
  }

  private readCodeBlockContent(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine();

    // Check for closing fence
    const fenceChar = this.input[this.pos] || '`';
    const isClosingFence = (fenceChar === '`' || fenceChar === '~') && 
                          /^`{3,}\s*$/.test(line) || /^~{3,}\s*$/.test(line);

    if (isClosingFence && line.trim().length > 0) {
      // Check if it matches opening fence
      const fenceCount = line.trim().length;
      const fence = fenceChar.repeat(fenceCount);
      
      this.readCodeFence();
      this.inCodeBlock = false;
      this.codeBlockLanguage = '';
      return;
    }

    // Check for MAM metadata comments
    const trimmed = line.trim();
    if (trimmed.startsWith('# @mam:')) {
      const metaMatch = trimmed.match(/^# @mam:([a-zA-Z_]+)=(.+)$/);
      if (metaMatch) {
        this.tokens.push(
          createToken(TokenType.CODE_METADATA, line, startLine, startCol, startOffset, {
            codeMetadata: { [metaMatch[1]!]: metaMatch[2]!.trim() },
          })
        );
        this.advanceToLineEnd();
        if (!this.isEOF()) {
          this.consumeChar();
          this.line++;
          this.column = 0;
        }
        return;
      }
    }

    // Regular code content
    this.advanceToLineEnd();
    const content = this.input.slice(startOffset, this.pos);
    
    this.tokens.push(
      createToken(TokenType.CODE_CONTENT, content, startLine, startCol, startOffset)
    );

    if (!this.isEOF()) {
      this.consumeChar(); // newline
      this.line++;
      this.column = 0;
    }
  }

  // ==========================================================================
  // Headings
  // ==========================================================================

  private readHeading(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    // Count heading level
    let level = 0;
    while (this.pos < this.input.length && this.input[this.pos] === '#' && level < 6) {
      level++;
      this.pos++;
      this.column++;
    }

    // Determine heading token type
    const headingTypes: TokenType[] = [
      TokenType.HEADING_1,
      TokenType.HEADING_2,
      TokenType.HEADING_3,
      TokenType.HEADING_4,
      TokenType.HEADING_5,
      TokenType.HEADING_6,
    ];

    this.tokens.push(
      createToken(headingTypes[level - 1]!, '#'.repeat(level), startLine, startCol, startOffset, {
        headingLevel: level,
      })
    );

    // Skip space after #
    if (this.pos < this.input.length && this.input[this.pos] === ' ') {
      this.pos++;
      this.column++;
    }

    // Read heading text
    const textStart = this.pos;
    this.advanceToLineEnd();
    const text = this.input.slice(textStart, this.pos).trim();

    if (text.length > 0) {
      this.tokens.push(
        createToken(TokenType.HEADING_TEXT, text, startLine, startCol + level + 1, textStart, {
          headingLevel: level,
        })
      );
    }

    // Move to next line
    if (!this.isEOF()) {
      this.consumeChar(); // newline
      this.line++;
      this.column = 0;
      this.atLineStart = true;
    }
  }

  // ==========================================================================
  // Tables
  // ==========================================================================
  // Lists
  // ==========================================================================

  private isListMarker(remaining: string): boolean {
    // A marker must be followed by a space or tab. Using \s here would also
    // match the newline itself, so a line holding only "-" would be accepted
    // as a list marker, yet readListItem (which matches against the line text)
    // would then consume nothing and emit no token, hanging the tokenizer.
    return /^[-*+][ \t]/.test(remaining) || /^\d+\.[ \t]/.test(remaining);
  }

  private readListItem(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine();

    // Check for unordered list
    const bulletMatch = line.match(/^([-*+])\s/);
    if (bulletMatch) {
      const marker = bulletMatch[1]!;
      this.consumeChars(marker.length + 1); // marker + space

      this.tokens.push(
        createToken(TokenType.BULLET_LIST, marker + ' ', startLine, startCol, startOffset, {
          listOrdered: false,
        })
      );

      // Check for task list
      const rest = this.peekLine();
      if (rest.startsWith('[x] ') || rest.startsWith('[X] ')) {
        this.consumeChars(4);
        this.tokens.push(
          createToken(TokenType.TASK_CHECKED, '[x] ', this.line, this.column - 4, this.pos - 4, {
            isTask: true,
            taskChecked: true,
          })
        );
      } else if (rest.startsWith('[ ] ')) {
        this.consumeChars(4);
        this.tokens.push(
          createToken(TokenType.TASK_UNCHECKED, '[ ] ', this.line, this.column - 4, this.pos - 4, {
            isTask: true,
            taskChecked: false,
          })
        );
      }

      // Read list item text
      this.readListItemText();
      return;
    }

    // Check for ordered list
    const orderedMatch = line.match(/^(\d+)\.\s/);
    if (orderedMatch) {
      const marker = orderedMatch[0]!;
      this.consumeChars(marker.length);

      this.tokens.push(
        createToken(TokenType.NUMBERED_LIST, marker, startLine, startCol, startOffset, {
          listOrdered: true,
        })
      );

      // Read list item text
      this.readListItemText();
    }

    // Defense in depth: never return without consuming input, otherwise the
    // tokenizer loop cannot make progress and would spin forever.
    if (this.pos === startOffset && !this.isEOF()) {
      this.consumeChar();
    }
  }

  private readListItemText(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    this.advanceToLineEnd();
    const text = this.input.slice(startOffset, this.pos).trim();

    if (text.length > 0) {
      this.tokens.push(
        createToken(TokenType.LIST_ITEM_TEXT, text, startLine, startCol, startOffset)
      );
    }

    // Move to next line
    if (!this.isEOF()) {
      this.consumeChar();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
      this.tokens.push(
        createToken(TokenType.NEWLINE, '\n', this.line - 1, 0, this.pos - 1)
      );
      this.lastTokenType = TokenType.NEWLINE;
    }
  }

  // ==========================================================================
  // Tables
  // ==========================================================================

  private readTableRow(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine();

    // Check if this is a separator line
    if (/^\|[\s|:-]+\|?\s*$/.test(line.trim())) {
      this.tokens.push(
        createToken(TokenType.TABLE_HYPHEN, line, startLine, startCol, startOffset)
      );
    } else {
      // Determine if this is a header or data row based on previous token
      const lastToken = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : null;
      const isData = lastToken && (lastToken.type === TokenType.TABLE_HYPHEN || lastToken.type === TokenType.TABLE_ROW_CELL);
      const cellType = isData ? TokenType.TABLE_ROW_CELL : TokenType.TABLE_HEADER_CELL;

      // Parse cells
      const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
      
      this.tokens.push(
        createToken(TokenType.TABLE_PIPE, '|', startLine, startCol, startOffset)
      );

      for (const cell of cells) {
        const cellStart = line.indexOf(cell, startOffset - this.pos);
        this.tokens.push(
          createToken(cellType, cell.trim(), startLine, startCol + cellStart, startOffset + cellStart)
        );
        this.tokens.push(
          createToken(TokenType.TABLE_PIPE, '|', startLine, startCol + cellStart + cell.length, startOffset + cellStart + cell.length)
        );
      }
    }

    // Move to next line
    this.advanceToLineEnd();
    if (!this.isEOF()) {
      this.consumeChar();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
    }
  }

  // ==========================================================================
  // Blockquotes
  // ==========================================================================

  private readBlockquote(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    // Count > characters
    let depth = 0;
    while (this.pos < this.input.length && this.input[this.pos] === '>') {
      depth++;
      this.pos++;
      this.column++;
    }

    // Skip space after >
    if (this.pos < this.input.length && this.input[this.pos] === ' ') {
      this.pos++;
      this.column++;
    }

    this.tokens.push(
      createToken(TokenType.BLOCKQUOTE, '>'.repeat(depth) + ' ', startLine, startCol, startOffset)
    );
  }

  // ==========================================================================
  // Horizontal Rules
  // ==========================================================================

  private isHorizontalRule(remaining: string): boolean {
    const line = remaining.split('\n')[0]!;
    return /^([-*_]\s*){3,}$/.test(line.trim());
  }

  private readHorizontalRule(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const line = this.peekLine().trim();

    this.tokens.push(
      createToken(TokenType.HORIZONTAL_RULE, line, startLine, startCol, startOffset)
    );

    this.advanceToLineEnd();
    if (!this.isEOF()) {
      this.consumeChar();
      this.line++;
      this.column = 0;
      this.atLineStart = true;
    }
  }

  // ==========================================================================
  // Inline Formatting
  // ==========================================================================

  private isInlineFormatting(remaining: string): boolean {
    return remaining.startsWith('**') || 
           remaining.startsWith('__') ||
           remaining.startsWith('*') ||
           remaining.startsWith('_') ||
           remaining.startsWith('~~') ||
           remaining.startsWith('`') ||
           remaining.startsWith('![') ||
           remaining.startsWith('[');
  }

  private readInlineFormatting(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;
    const char = this.input[this.pos]!;

    // Bold ** or __
    if (this.peekAhead(2) === '**' || this.peekAhead(2) === '__') {
      const marker = this.peekAhead(2);
      this.consumeChars(2);
      
      // Check if it's opening or closing
      const isClosing = this.lastTokenType === TokenType.BOLD_OPEN || 
                        this.lastTokenType === TokenType.TEXT;
      
      this.tokens.push(
        createToken(
          isClosing ? TokenType.BOLD_CLOSE : TokenType.BOLD_OPEN,
          marker,
          startLine,
          startCol,
          startOffset
        )
      );
      return;
    }

    // Strikethrough ~~
    if (this.peekAhead(2) === '~~') {
      this.consumeChars(2);
      this.tokens.push(
        createToken(TokenType.STRIKETHROUGH_OPEN, '~~', startLine, startCol, startOffset)
      );
      return;
    }

    // Italic * or _
    if (char === '*' || char === '_') {
      this.consumeChar();
      this.tokens.push(
        createToken(TokenType.ITALIC_OPEN, char, startLine, startCol, startOffset)
      );
      return;
    }

    // Code inline `
    if (char === '`') {
      this.readInlineCode();
      return;
    }

    // Image ![
    if (this.peekAhead(2) === '![') {
      this.readImage();
      return;
    }

    // Link [
    if (char === '[') {
      this.readLink();
      return;
    }

    // Fallback to text
    this.readText();
  }

  private readInlineCode(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    this.consumeChar(); // opening `

    // Find closing `
    let codeEnd = this.pos;
    while (codeEnd < this.input.length && this.input[codeEnd] !== '`') {
      codeEnd++;
    }

    if (codeEnd >= this.input.length) {
      this.errors.push(
        new LexerError(
          'Unterminated inline code',
          this.source,
          startLine,
          startCol,
          LexerErrorCode.UNTERMINATED_STRING
        )
      );
      return;
    }

    const code = this.input.slice(this.pos, codeEnd);
    this.advanceTo(codeEnd);
    this.consumeChar(); // closing `

    this.tokens.push(
      createToken(TokenType.CODE_INLINE, '`' + code + '`', startLine, startCol, startOffset)
    );
  }

  private readImage(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    this.consumeChars(2); // ! [

    // Find closing ]
    let bracketEnd = this.pos;
    let bracketDepth = 1;
    while (bracketEnd < this.input.length && bracketDepth > 0) {
      if (this.input[bracketEnd] === '[') bracketDepth++;
      if (this.input[bracketEnd] === ']') bracketDepth--;
      bracketEnd++;
    }

    const alt = this.input.slice(this.pos, bracketEnd - 1);
    this.advanceTo(bracketEnd);

    // Check for (url)
    if (this.peekChar() === '(') {
      this.consumeChar(); // (
      
      // Find closing )
      let parenEnd = this.pos;
      let parenDepth = 1;
      while (parenEnd < this.input.length && parenDepth > 0) {
        if (this.input[parenEnd] === '(') parenDepth++;
        if (this.input[parenEnd] === ')') parenDepth--;
        parenEnd++;
      }

      const url = this.input.slice(this.pos, parenEnd - 1);
      this.advanceTo(parenEnd);
      this.consumeChar(); // )

      this.tokens.push(
        createToken(TokenType.IMAGE_OPEN, this.input.slice(startOffset, this.pos), startLine, startCol, startOffset, {
          imageAlt: alt,
          imageUrl: url,
        })
      );
    }
  }

  private readLink(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    this.consumeChar(); // [

    // Find closing ]
    let bracketEnd = this.pos;
    let bracketDepth = 1;
    while (bracketEnd < this.input.length && bracketDepth > 0) {
      if (this.input[bracketEnd] === '[') bracketDepth++;
      if (this.input[bracketEnd] === ']') bracketDepth--;
      bracketEnd++;
    }

    const text = this.input.slice(this.pos, bracketEnd - 1);
    // Consume the ] at bracketEnd-1, then check position 6 for (
    this.advanceTo(bracketEnd - 1);
    this.consumeChar(); // ]

    this.tokens.push(
      createToken(TokenType.LINK_TEXT, text, startLine, startCol + 1, startOffset + 1)
    );

    // Check for (url) — now at correct position after consuming ]
    if (this.peekChar() === '(') {
      this.consumeChar(); // (
      
      // Find closing )
      let parenEnd = this.pos;
      let parenDepth = 1;
      while (parenEnd < this.input.length && parenDepth > 0) {
        if (this.input[parenEnd] === '(') parenDepth++;
        if (this.input[parenEnd] === ')') parenDepth--;
        parenEnd++;
      }

      const url = this.input.slice(this.pos, parenEnd - 1);
      this.advanceTo(parenEnd);
      this.consumeChar(); // )

      this.tokens.push(
        createToken(TokenType.LINK_OPEN, this.input.slice(startOffset, this.pos), startLine, startCol, startOffset, {
          linkUrl: url,
        })
      );
    }
  }

  // ==========================================================================
  // Text
  // ==========================================================================

  private readText(): void {
    const startLine = this.line;
    const startCol = this.column;
    const startOffset = this.pos;

    // Find end of text (newline or special character)
    let end = this.pos;
    while (end < this.input.length) {
      const char = this.input[end]!;
      
      // Stop at newlines and most special characters
      if (char === '\n' || char === '#' || char === '`' ||
          char === '*' || char === '_' || char === '|' ||
          char === '[' || char === '!' || char === '~') {
        break;
      }

      // Allow > in text when it's part of -> (MAM edge syntax)
      if (char === '>') {
        const prevChar = end > 0 ? this.input[end - 1] : '';
        if (prevChar !== '-') {
          break;
        }
      }

      // Special handling for hyphens: only stop at word boundaries
      // "well-sourced" should NOT break, but "- list item" or "---" should
      // "-> " (MAM edge syntax) should NOT break
      if (char === '-') {
        const prevChar = end > 0 ? this.input[end - 1] : '\n';
        const nextChar = end + 1 < this.input.length ? this.input[end + 1] : '\n';
        // Don't stop if this is part of -> (MAM edge syntax)
        if (nextChar === '>') {
          end += 2; // skip both - and >
          continue;
        }
        const isWordBoundary = (prevChar === ' ' || prevChar === '\t' || prevChar === '\n' || prevChar === '\r' || end === 0) ||
                               (nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r' || end + 1 >= this.input.length);
        if (isWordBoundary) {
          // A standalone hyphen inside running text is an ordinary dash or
          // minus sign ("a - b", "value -5"), so consume it as text. Breaking
          // here would re-lex the '-' on its own where nothing matches it,
          // producing a spurious UNEXPECTED_CHARACTER. Genuine MAM constructs
          // are unaffected because they are handled by higher-priority rules
          // before readText runs: "- item" (list marker), "---" (horizontal
          // rule) and "->" (edge syntax, handled just above).
          end++;
          continue;
        }
      }
      
      end++;
    }

    if (end === this.pos) {
      // Single character that doesn't match anything
      const char = this.input[this.pos]!;
      this.errors.push(
        new LexerError(
          `Unexpected character: '${char}' (0x${char.charCodeAt(0).toString(16)})`,
          this.source,
          this.line,
          this.column,
          LexerErrorCode.UNEXPECTED_CHARACTER,
          'error',
          this.peekLine()
        )
      );
      this.pos++;
      this.column++;
      return;
    }

    const value = this.input.slice(this.pos, end);

    if (value.length > this.maxTokenLength) {
      this.errors.push(
        new LexerError(
          `Token exceeds maximum length: ${value.length} > ${this.maxTokenLength}`,
          this.source,
          this.line,
          this.column,
          LexerErrorCode.TOKEN_TOO_LONG
        )
      );
    }

    // Check for long lines
    if (value.length > LONG_LINE_THRESHOLD) {
      this.warnings.push(
        new LexerWarning(
          `Line exceeds ${LONG_LINE_THRESHOLD} characters`,
          this.source,
          this.line,
          this.column,
          LexerWarningCode.LONG_LINE
        )
      );
    }

    this.tokens.push(
      createToken(TokenType.TEXT, value, startLine, startCol, startOffset)
    );

    this.lastTokenType = TokenType.TEXT;
    this.pos = end;
    this.column += end - startOffset;
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Tokenize a MAM document string
 */
export function tokenize(input: string, options?: TokenizerOptions): TokenizeResult {
  const tokenizer = new Tokenizer(options);
  return tokenizer.tokenize(input);
}