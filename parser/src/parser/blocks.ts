/**
 * MAM Block Content Helpers
 *
 * Line-oriented helpers for recognizing block-level constructs and producing
 * content nodes for paragraphs, blockquotes, and horizontal rules. This module
 * complements `lexer/blocks.ts`: the lexer module answers "what kind of line is
 * this?" while this module answers "what AST node does this block become?".
 */

import type {
  BlockquoteNode,
  ContentNode,
  HorizontalRuleNode,
  ParagraphNode,
  SourceLocation,
} from './sections.js';
import { parseInline } from './inline.js';
import {
  isBlockquoteLine,
  isFenceStart,
  isHeadingLine,
  isHorizontalRuleLine,
  isListMarker,
  isTableRow,
} from '../lexer/blocks.js';

/**
 * The block-level construct a line represents.
 *
 * Returned by {@link detectBlockType}. The `'blank'` kind marks empty or
 * whitespace-only lines, and `'unknown'` is reserved for cases where the line
 * cannot be classified by any built-in rule.
 */
export type BlockKind =
  | 'paragraph'
  | 'blockquote'
  | 'horizontalrule'
  | 'heading'
  | 'list'
  | 'code'
  | 'table'
  | 'blank'
  | 'unknown';

/**
 * Detect the kind of block construct a line begins.
 *
 * Classification order matters because several constructs share leading
 * characters: fences are checked before headings, headings before horizontal
 * rules, and list markers before table rows. A line that matches no structural
 * rule is classified as a paragraph.
 *
 * @param line - The line of text to classify (without a trailing newline).
 * @returns The {@link BlockKind} of the line.
 */
export function detectBlockType(line: string): BlockKind {
  if (line.trim().length === 0) {
    return 'blank';
  }
  if (isFenceStart(line).isFence) {
    return 'code';
  }
  if (isHeadingLine(line).isHeading) {
    return 'heading';
  }
  if (isHorizontalRuleLine(line)) {
    return 'horizontalrule';
  }
  if (isBlockquoteLine(line)) {
    return 'blockquote';
  }
  if (isListMarker(line).isList) {
    return 'list';
  }
  if (isTableRow(line)) {
    return 'table';
  }
  return 'paragraph';
}

/**
 * Determine whether a line continues a paragraph block.
 *
 * A line continues a paragraph when it is not a structural block start — that
 * is, when it would be classified as a paragraph itself. Blank lines and block
 * markers do not continue paragraphs.
 *
 * @param line - The line of text to test.
 * @returns `true` when the line can be appended to a paragraph.
 */
export function isParagraphContinuation(line: string): boolean {
  return detectBlockType(line) === 'paragraph';
}

/**
 * Parse a paragraph block into a {@link ParagraphNode}.
 *
 * The given lines are trimmed and joined with single spaces to form the
 * paragraph value, and the value is passed through {@link parseInline} to
 * produce inline nodes. The source location spans the first and last lines.
 *
 * @param lines - The raw lines of the paragraph.
 * @param source - A label for the source document. Defaults to `'<input>'`.
 * @param startLine - The one-based line number of the first line. Defaults to `1`.
 * @returns A {@link ParagraphNode} describing the paragraph.
 */
export function parseParagraphBlock(
  lines: readonly string[],
  source = '<input>',
  startLine = 1
): ParagraphNode {
  const cleaned = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const value = cleaned.join(' ').trim();
  const location = makeLocation(cleaned, source, startLine);
  return {
    type: 'paragraph',
    value,
    inlineNodes: parseInline(value),
    location,
  };
}

/**
 * Parse a blockquote block into a {@link BlockquoteNode}.
 *
 * Each line has its blockquote marker (`>` with optional leading indentation)
 * stripped. The remaining text is joined with newlines to form the value, and
 * the children array is left empty — nested parsing of the quoted content is
 * the caller's responsibility.
 *
 * @param lines - The raw lines of the blockquote.
 * @param source - A label for the source document. Defaults to `'<input>'`.
 * @param startLine - The one-based line number of the first line. Defaults to `1`.
 * @returns A {@link BlockquoteNode} describing the blockquote.
 */
export function parseBlockquoteBlock(
  lines: readonly string[],
  source = '<input>',
  startLine = 1
): BlockquoteNode {
  const cleaned = lines.filter((line) => line.trim().length > 0);
  const value = cleaned
    .map((line) => line.replace(/^ {0,3}>[ \t]?/, ''))
    .join('\n');
  const location = makeLocation(cleaned, source, startLine);
  return {
    type: 'blockquote',
    value,
    children: [] as ContentNode[],
    location,
  };
}

/**
 * Parse a horizontal rule line into a {@link HorizontalRuleNode}.
 *
 * @param line - The raw horizontal rule line.
 * @param source - A label for the source document. Defaults to `'<input>'`.
 * @param lineNumber - The one-based line number of the rule. Defaults to `1`.
 * @returns A {@link HorizontalRuleNode} describing the rule.
 */
export function parseHorizontalRuleBlock(
  line: string,
  source = '<input>',
  lineNumber = 1
): HorizontalRuleNode {
  const value = line.trim();
  const location: SourceLocation = {
    start: { line: lineNumber, column: 0, offset: 0 },
    end: { line: lineNumber, column: value.length, offset: value.length },
    source,
  };
  return {
    type: 'horizontalrule',
    value,
    location,
  };
}

/**
 * Build a {@link SourceLocation} spanning an array of lines.
 *
 * The start position is the first line at column zero and the end position is
 * the end of the final line. Offsets are computed by summing the lengths of
 * the lines plus one for each newline separator.
 *
 * @param lines - The lines the location should span.
 * @param source - The source document label.
 * @param startLine - The one-based line number of the first line.
 * @returns A {@link SourceLocation} covering the lines.
 */
function makeLocation(
  lines: readonly string[],
  source: string,
  startLine: number
): SourceLocation {
  if (lines.length === 0) {
    return {
      start: { line: startLine, column: 0, offset: 0 },
      end: { line: startLine, column: 0, offset: 0 },
      source,
    };
  }
  let totalLength = 0;
  for (const line of lines) {
    totalLength += line.length + 1;
  }
  const lastLine = lines[lines.length - 1]!;
  return {
    start: { line: startLine, column: 0, offset: 0 },
    end: {
      line: startLine + lines.length - 1,
      column: lastLine.length,
      offset: totalLength - 1,
    },
    source,
  };
}