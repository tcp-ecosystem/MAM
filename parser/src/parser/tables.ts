/**
 * MAM Table Content Parsing
 *
 * Helpers for turning raw Markdown table lines into structured headers, rows,
 * and column alignments. These functions complement the token-level table
 * parsing in `sections.ts` by working directly on the source lines, which is
 * convenient for tools that scan documents without building a full token
 * stream.
 *
 * The splitter understands escaped pipes (`\|`) so cell contents may contain a
 * literal pipe character.
 */

import { isTableSeparatorRow } from '../lexer/blocks.js';

/**
 * The alignment of a table column, derived from its separator cell.
 *
 * - `'left'`   — the separator starts with a colon (`:---`).
 * - `'right'`  — the separator ends with a colon (`---:`).
 * - `'center'` — the separator starts and ends with a colon (`:---:`).
 * - `'none'`   — the separator has no colons (`---`), so alignment is implicit.
 */
export type TableAlignment = 'left' | 'center' | 'right' | 'none';

/**
 * The structured result of parsing a complete table block.
 *
 * Produced by {@link parseTableBlock}. When `ok` is `true` the table is
 * well-formed and `errors` is empty; otherwise `errors` describes every
 * structural problem that was detected.
 */
export interface TableParseResult {
  /** The header cells, normalized and stripped of surrounding pipes. */
  headers: string[];
  /** The body rows, each an array of normalized cells. */
  rows: string[][];
  /** The alignment of each column, parallel to `headers`. */
  alignments: TableAlignment[];
  /** Human-readable descriptions of any structural problems found. */
  errors: string[];
  /** `true` when no errors were detected. */
  ok: boolean;
}

/**
 * Split a raw table line into its cell strings.
 *
 * Leading and trailing border pipes are removed, and an escaped pipe (`\|`)
 * is treated as literal content rather than a cell boundary. The returned
 * cells are not normalized; use {@link normalizeTableCell} for that.
 *
 * @param line - The raw table line, with or without outer border pipes.
 * @returns The cell strings in left-to-right order.
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (char === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 2;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  cells.push(current);

  // Drop empty border cells produced by leading/trailing pipes.
  if (cells.length > 0 && cells[0]!.trim() === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === '') {
    cells.pop();
  }
  return cells;
}

/**
 * Normalize a single table cell for storage in an AST.
 *
 * Normalization trims surrounding whitespace, converts escaped pipes back to
 * literal pipes, and collapses internal whitespace runs into single spaces.
 *
 * @param cell - The raw cell text.
 * @returns The normalized cell text.
 */
export function normalizeTableCell(cell: string): string {
  return cell
    .replace(/\\\|/g, '|')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parse the header line of a table into normalized header cells.
 *
 * @param line - The raw header line, with or without outer border pipes.
 * @returns The normalized header cells.
 */
export function parseTableHeaders(line: string): string[] {
  return splitTableRow(line).map((cell) => normalizeTableCell(cell));
}

/**
 * Parse a body line of a table into normalized row cells.
 *
 * @param line - The raw row line, with or without outer border pipes.
 * @returns The normalized row cells.
 */
export function parseTableRow(line: string): string[] {
  return splitTableRow(line).map((cell) => normalizeTableCell(cell));
}

/**
 * Determine whether a line is a table separator row.
 *
 * A separator row is made of cells containing only hyphens and optional
 * alignment colons, separated by pipes. This delegates to the lexer's
 * line-oriented detector so both layers agree on what a separator looks like.
 *
 * @param line - The line to test.
 * @returns `true` when the line is a valid separator row.
 */
export function isTableSeparator(line: string): boolean {
  return isTableSeparatorRow(line);
}

/**
 * Derive the alignment of a column from its separator cell.
 *
 * @param cell - A single separator cell such as `:---`, `---:`, `:---:`, or `---`.
 * @returns The {@link TableAlignment} encoded by the cell.
 */
export function detectTableAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  const hasLeft = trimmed.startsWith(':');
  const hasRight = trimmed.endsWith(':');
  if (hasLeft && hasRight) {
    return 'center';
  }
  if (hasRight) {
    return 'right';
  }
  if (hasLeft) {
    return 'left';
  }
  return 'none';
}

/**
 * Convert an array of raw table lines into an array of cell rows.
 *
 * Blank lines and separator rows are skipped, so the result contains only the
 * header and body rows. This is a convenient way to get at the data without
 * computing alignments or validating column counts.
 *
 * @param lines - The raw lines of a table block.
 * @returns The parsed rows, in source order.
 */
export function tableToRows(lines: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.trim().length === 0 || isTableSeparator(line)) {
      continue;
    }
    const cells = parseTableRow(line);
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * Parse a complete table block into headers, rows, and alignments.
 *
 * The first non-blank line is treated as the header. If the following
 * non-blank line is a separator, its cells determine the column alignments;
 * otherwise every column defaults to `'none'`. Remaining non-blank lines are
 * parsed as body rows. Rows whose cell count differs from the header count are
 * reported as errors but still included in the result.
 *
 * @param lines - The raw lines of the table block.
 * @param source - A label used in error messages. Defaults to `'<table>'`.
 * @returns A {@link TableParseResult} describing the parsed table.
 */
export function parseTableBlock(lines: readonly string[], source = '<table>'): TableParseResult {
  const errors: string[] = [];
  const content = [...lines];
  while (content.length > 0 && content[0]!.trim().length === 0) {
    content.shift();
  }
  while (content.length > 0 && content[content.length - 1]!.trim().length === 0) {
    content.pop();
  }

  if (content.length === 0) {
    return { headers: [], rows: [], alignments: [], errors: [`${source}: empty table block`], ok: false };
  }

  const headerLine = content[0]!;
  const headers = parseTableHeaders(headerLine);
  if (headers.length === 0) {
    errors.push(`${source}: table header has no cells`);
  }

  let cursor = 1;
  let alignments: TableAlignment[];
  if (cursor < content.length && isTableSeparator(content[cursor]!)) {
    alignments = parseTableRow(content[cursor]!).map((cell) => detectTableAlignment(cell));
    cursor += 1;
  } else {
    alignments = headers.map(() => 'none' as TableAlignment);
  }

  const rows: string[][] = [];
  let rowNumber = 1;
  for (; cursor < content.length; cursor++) {
    const line = content[cursor]!;
    if (line.trim().length === 0) {
      continue;
    }
    const cells = parseTableRow(line);
    if (cells.length !== headers.length) {
      errors.push(
        `${source}: row ${rowNumber} has ${cells.length} cells but header has ${headers.length}`
      );
    }
    rows.push(cells);
    rowNumber += 1;
  }

  return { headers, rows, alignments, errors, ok: errors.length === 0 };
}
