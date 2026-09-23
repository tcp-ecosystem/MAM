/**
 * MAM Block Detection
 *
 * Line-oriented helpers for recognizing Markdown block-level constructs such
 * as fenced code blocks, tables, lists, headings, horizontal rules, blockquote
 * markers, and blank lines.
 *
 * These functions operate on single lines (with the leading content already
 * stripped of a trailing newline) and are used both by the tokenizer and by
 * tools that scan document structure without building a full token stream.
 */

/**
 * The result of {@link isFenceStart}: whether a line begins a fenced code
 * block, the fence character, and the fence length.
 */
export interface FenceStartInfo {
  /** Whether the line begins a valid fence. */
  isFence: boolean;
  /** The fence character (` ` ` or `~`), or an empty string when not a fence. */
  char: string;
  /** The number of consecutive fence characters at the start of the line. */
  length: number;
}

/**
 * Detect whether a line begins a fenced code block.
 *
 * A fence must consist of three or more consecutive backticks or tildes at the
 * start of the line, optionally followed by a language identifier or other
 * text. Backtick fences may not contain backticks in the info string per the
 * CommonMark rule, which this helper enforces.
 *
 * @param line - The line of text to inspect (without a trailing newline).
 * @returns A {@link FenceStartInfo} describing the fence, or an object with
 *   `isFence: false` when the line is not a fence opener.
 */
export function isFenceStart(line: string): FenceStartInfo {
  let length = 0;
  const first = line.length > 0 ? line[0] : '';
  if (first !== '`' && first !== '~') {
    return { isFence: false, char: '', length: 0 };
  }
  while (length < line.length && line[length] === first) {
    length++;
  }
  if (length < 3) {
    return { isFence: false, char: '', length: 0 };
  }
  if (first === '`' && line.slice(length).includes('`')) {
    return { isFence: false, char: '', length: 0 };
  }
  return { isFence: true, char: first, length };
}

/**
 * Find the offset of the closing fence for a fenced code block.
 *
 * The search begins at `startLine` and scans forward. A closing fence must
 * consist of at least `fenceLength` consecutive copies of `fenceChar` and may
 * contain only trailing whitespace after the fence characters.
 *
 * @param lines - The full array of lines in the document.
 * @param startLine - The index of the line after the opening fence.
 * @param fenceChar - The fence character used by the opener.
 * @param fenceLength - The length of the opening fence.
 * @returns The index of the closing fence line, or `-1` when no matching
 *   closing fence exists before the end of the document.
 */
export function findFenceClose(
  lines: readonly string[],
  startLine: number,
  fenceChar: string,
  fenceLength: number
): number {
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    if (line[0] !== fenceChar) {
      continue;
    }
    let length = 0;
    while (length < line.length && line[length] === fenceChar) {
      length++;
    }
    if (length < fenceLength) {
      continue;
    }
    if (line.slice(length).trim().length === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Check whether a line is a table row.
 *
 * A table row is any line that contains a pipe character that is not escaped
 * and is not part of a fenced code block or inline code span. This is a
 * heuristic helper; precise pipe counting is left to the tokenizer.
 *
 * @param line - The line of text to inspect.
 * @returns `true` when the line contains at least one unescaped pipe.
 */
export function isTableRow(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
      continue;
    }
    if (line[i] === '|') {
      return true;
    }
  }
  return false;
}

/**
 * Check whether a line is a table separator row.
 *
 * A separator row consists of cells made only of hyphens and optional colons,
 * separated by pipes. The line must contain at least one pipe.
 *
 * @param line - The line of text to inspect.
 * @returns `true` when the line is a valid table separator row.
 */
export function isTableSeparatorRow(line: string): boolean {
  if (!line.includes('|')) {
    return false;
  }
  const cells = line.split('|').filter((cell, index, all) => {
    return index > 0 || all.length === 1;
  });
  if (cells.length === 0) {
    return false;
  }
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!/^:?-+:?$/.test(trimmed)) {
      return false;
    }
  }
  return true;
}

/**
 * The result of {@link isListMarker}: whether a line begins a list item and
 * the kind of marker used.
 */
export interface ListMarkerInfo {
  /** Whether the line begins a list item. */
  isList: boolean;
  /** Whether the marker is a numbered marker (`1.`) as opposed to a bullet. */
  ordered: boolean;
  /** The marker text itself, including the trailing space when present. */
  marker: string;
  /** The index at which the item content begins. */
  contentStart: number;
}

/**
 * Detect whether a line begins a list item marker.
 *
 * Bullet markers are `-`, `*`, or `+` followed by whitespace. Numbered markers
 * are one or more digits followed by a period and whitespace. Task list
 * checkboxes are not considered here; they are recognized by the tokenizer.
 *
 * @param line - The line of text to inspect.
 * @returns A {@link ListMarkerInfo} describing the marker, or an object with
 *   `isList: false` when the line is not a list item.
 */
export function isListMarker(line: string): ListMarkerInfo {
  const bulletMatch = /^([-*+])([ \t]+)/.exec(line);
  if (bulletMatch) {
    const marker = bulletMatch[0];
    return {
      isList: true,
      ordered: false,
      marker,
      contentStart: marker.length,
    };
  }
  const orderedMatch = /^(\d{1,9}\.)([ \t]+)/.exec(line);
  if (orderedMatch) {
    const marker = orderedMatch[0];
    return {
      isList: true,
      ordered: true,
      marker,
      contentStart: marker.length,
    };
  }
  return { isList: false, ordered: false, marker: '', contentStart: 0 };
}

/**
 * The result of {@link isHeadingLine}: whether a line is a heading and, when
 * it is, the heading level and text.
 */
export interface HeadingLineInfo {
  /** Whether the line is a valid ATX heading. */
  isHeading: boolean;
  /** The heading level (1–6), or `0` when the line is not a heading. */
  level: number;
  /** The heading text with the leading marker and optional closing hashes removed. */
  text: string;
}

/**
 * Detect whether a line is an ATX heading.
 *
 * An ATX heading begins with one to six `#` characters followed by a space or
 * the end of the line. Optional closing hashes are stripped from the text.
 *
 * @param line - The line of text to inspect.
 * @returns A {@link HeadingLineInfo} describing the heading.
 */
export function isHeadingLine(line: string): HeadingLineInfo {
  let level = 0;
  while (level < line.length && line[level] === '#' && level < 6) {
    level++;
  }
  if (level === 0 || level > 6) {
    return { isHeading: false, level: 0, text: '' };
  }
  if (level < line.length && line[level] !== ' ' && line[level] !== '\t') {
    return { isHeading: false, level: 0, text: '' };
  }
  let text = line.slice(level).trim();
  text = text.replace(/\s+#+\s*$/, '');
  return { isHeading: true, level, text: text.trim() };
}

/**
 * Check whether a line is a horizontal rule.
 *
 * A horizontal rule is a line containing three or more identical markers drawn
 * from `-`, `*`, or `_`, with optional spaces between them and nothing else.
 *
 * @param line - The line of text to inspect.
 * @returns `true` when the line is a valid horizontal rule.
 */
export function isHorizontalRuleLine(line: string): boolean {
  const compact = line.replace(/[ \t]+/g, '');
  if (compact.length < 3) {
    return false;
  }
  const first = compact[0];
  if (first !== '-' && first !== '*' && first !== '_') {
    return false;
  }
  for (let i = 0; i < compact.length; i++) {
    if (compact[i] !== first) {
      return false;
    }
  }
  return true;
}

/**
 * Check whether a line begins with a blockquote marker.
 *
 * A blockquote marker is a `>` optionally preceded by up to three spaces of
 * indentation and optionally followed by a space.
 *
 * @param line - The line of text to inspect.
 * @returns `true` when the line begins with a blockquote marker.
 */
export function isBlockquoteLine(line: string): boolean {
  return /^ {0,3}>[ \t]?/.test(line);
}

/**
 * Check whether a line is blank (empty or containing only whitespace).
 *
 * @param line - The line of text to inspect.
 * @returns `true` when the line has no non-whitespace characters.
 */
export function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Count the number of leading space characters on a line.
 *
 * Tabs count as a single character for this count; callers that need visual
 * column alignment should expand tabs separately.
 *
 * @param line - The line of text to inspect.
 * @returns The number of leading spaces on the line.
 */
export function countLeadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') {
    count++;
  }
  return count;
}

/**
 * Check whether a line is indented.
 *
 * A line is indented when it begins with at least `spaces` space characters
 * (defaulting to 4, the CommonMark code-block threshold). An empty line is
 * never considered indented.
 *
 * @param line - The line of text to inspect.
 * @param spaces - The number of leading spaces required (default `4`).
 * @returns `true` when the line begins with at least `spaces` spaces.
 */
export function isIndented(line: string, spaces = 4): boolean {
  if (line.length === 0) {
    return false;
  }
  return countLeadingSpaces(line) >= spaces;
}