/**
 * MAM List Content Parsing
 *
 * Line-oriented helpers for recognizing and parsing Markdown list blocks:
 * detecting list markers, extracting item text, recognizing task checkboxes,
 * and assembling a structured list result. These helpers work on raw lines and
 * complement the token-level list parsing in `sections.ts`.
 */

import { isListMarker, ListMarkerInfo } from '../lexer/blocks.js';

/**
 * A single parsed list item.
 *
 * Produced by {@link parseListItems}. The `text` field holds the item content
 * with the marker and any task checkbox stripped.
 */
export interface ParsedListItem {
  /** The zero-based position of the item within the list. */
  index: number;
  /** The marker text (for example `-` or `1.`), with surrounding whitespace removed. */
  marker: string;
  /** Whether the item uses a numbered (`1.`) rather than a bullet marker. */
  ordered: boolean;
  /** For task items, whether the checkbox is checked. Absent for plain items. */
  checked?: boolean;
  /** The item content with the marker and checkbox stripped and trimmed. */
  text: string;
  /** The original unmodified source line. */
  raw: string;
  /** The one-based line number of the item within the supplied block. */
  line: number;
}

/**
 * The structured result of parsing a list block.
 *
 * Produced by {@link parseListItems}. When `ok` is `true` the list is
 * well-formed and `errors` is empty.
 */
export interface ListParseResult {
  /** The parsed items in source order. */
  items: ParsedListItem[];
  /** Whether the list uses numbered markers. */
  ordered: boolean;
  /** Human-readable descriptions of any problems found. */
  errors: string[];
  /** `true` when no errors were detected. */
  ok: boolean;
}

/**
 * Determine whether a line begins a list item marker.
 *
 * This delegates to the lexer's {@link isListMarker} detector so both layers
 * agree on what counts as a bullet (`-`, `*`, `+`) or numbered (`1.`) marker.
 *
 * @param line - The line to test.
 * @returns `true` when the line begins a valid list marker.
 */
export function isListMarkerLine(line: string): boolean {
  return isListMarker(line).isList;
}

/**
 * Determine whether a block of lines is an ordered list.
 *
 * The first line that carries a list marker decides the ordering. Lines that
 * are blank or do not begin with a marker are skipped.
 *
 * @param lines - The lines of the block.
 * @returns `true` when the first marker found is numbered, otherwise `false`.
 */
export function detectListOrdered(lines: readonly string[]): boolean {
  for (const line of lines) {
    const info = isListMarker(line);
    if (info.isList) {
      return info.ordered;
    }
  }
  return false;
}

/**
 * Extract the content text of a list item line.
 *
 * The marker is stripped and, when present, a task checkbox is removed as
 * well. Lines that do not begin a marker are returned trimmed unchanged.
 *
 * @param line - The raw list item line.
 * @returns The item content with markers stripped.
 */
export function extractListItemText(line: string): string {
  const info = isListMarker(line);
  if (!info.isList) {
    return line.trim();
  }
  let content = line.slice(info.contentStart);
  const task = parseTaskItem(content);
  if (task) {
    content = task.text;
  }
  return content.trim();
}

/**
 * Parse a task checkbox from the start of an item's content.
 *
 * Recognizes the CommonMark-style markers `[ ]` (unchecked), `[x]`, and `[X]`
 * (checked). The marker must be followed by optional whitespace and at least
 * the start of the item text.
 *
 * @param text - The item content text, without the list marker.
 * @returns An object describing the checkbox and the remaining text, or `null`
 *   when the text does not begin with a task marker.
 */
export function parseTaskItem(text: string): { checked: boolean; text: string } | null {
  const match = /^\[([ xX])\]\s*/.exec(text);
  if (!match) {
    return null;
  }
  return {
    checked: match[1] !== ' ',
    text: text.slice(match[0].length).trim(),
  };
}

/**
 * Parse a block of lines into a structured list result.
 *
 * Lines that begin a list marker start new items; blank lines are skipped; and
 * other non-blank lines are treated as continuation lines appended to the most
 * recent item. A non-marker line that appears before any item is recorded as
 * an error.
 *
 * @param lines - The raw lines of the list block.
 * @returns A {@link ListParseResult} describing the parsed list.
 */
export function parseListItems(lines: readonly string[]): ListParseResult {
  const items: ParsedListItem[] = [];
  const errors: string[] = [];
  const ordered = detectListOrdered(lines);

  lines.forEach((line, index) => {
    const info: ListMarkerInfo = isListMarker(line);
    if (info.isList) {
      let content = line.slice(info.contentStart);
      let checked: boolean | undefined;
      const task = parseTaskItem(content);
      if (task) {
        checked = task.checked;
        content = task.text;
      }
      items.push({
        index: items.length,
        marker: info.marker.trim(),
        ordered: info.ordered,
        checked,
        text: content.trim(),
        raw: line,
        line: index + 1,
      });
    } else if (line.trim().length === 0) {
      // Blank lines are structural separators, not errors.
    } else if (items.length > 0) {
      const last = items[items.length - 1]!;
      last.text = `${last.text} ${line.trim()}`.trim();
    } else {
      errors.push(`Line ${index + 1} is not a list item: "${line}"`);
    }
  });

  if (items.length === 0) {
    errors.push('No list items were found in the block');
  }

  return { items, ordered, errors, ok: errors.length === 0 };
}