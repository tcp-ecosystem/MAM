/**
 * MAM Text Utilities
 *
 * General-purpose helpers for normalizing, inspecting, and shaping plain
 * text. These functions are intentionally dependency-free and operate purely
 * on strings so they can be reused across the parser, lexer, and tooling.
 */

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize all line endings in a string to a single style.
 *
 * Both CRLF (`\r\n`) and legacy CR (`\r`) sequences are converted to the
 * chosen newline. This is essential before offset/line math so that line
 * counts are stable regardless of the source document's platform.
 *
 * @param text - The text to normalize.
 * @param newline - The newline sequence to use (default `'\n'`).
 * @returns The normalized text.
 *
 * @example
 * normalizeNewlines('a\r\nb\rc'); // => 'a\nb\nc'
 */
export function normalizeNewlines(text: string, newline: string = '\n'): string {
  return text.replace(/\r\n|\r/g, newline);
}

/**
 * Remove a Unicode byte-order mark (BOM) from the start of a string.
 *
 * Many editors and exported documents prefix files with U+FEFF. Removing it
 * up-front avoids the BOM being treated as visible content or corrupting
 * offset/column calculations.
 *
 * @param text - The text to strip the BOM from.
 * @returns The text without a leading `\uFEFF` (or unchanged if none exists).
 *
 * @example
 * stripBOM('\uFEFFhello'); // => 'hello'
 */
export function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

// ============================================================================
// Inspection
// ============================================================================

/**
 * Truncate a string to a maximum length, appending a suffix when cut.
 *
 * The returned string never exceeds `maxLen` characters: if `suffix` does not
 * fit alongside the truncated content, the suffix itself is trimmed first.
 *
 * @param text - The text to truncate.
 * @param maxLen - The maximum number of characters allowed.
 * @param suffix - The marker appended when truncation occurs (default `'…'`).
 * @returns The truncated string, or `text` unchanged if it already fits.
 *
 * @example
 * truncate('abcdefghij', 8);       // => 'abcde…'
 * truncate('abcdefghij', 3, '..'); // => 'a..'
 */
export function truncate(text: string, maxLen: number, suffix: string = '…'): string {
  if (maxLen <= 0) {
    return '';
  }
  if (text.length <= maxLen) {
    return text;
  }
  if (suffix.length >= maxLen) {
    return suffix.slice(0, maxLen);
  }
  return text.slice(0, maxLen - suffix.length) + suffix;
}

/**
 * Count the non-overlapping occurrences of `needle` within `text`.
 *
 * An empty `needle` returns `0` because an empty string technically matches
 * everywhere and that result is rarely what callers want.
 *
 * @param text - The text to search.
 * @param needle - The substring to count.
 * @returns The number of non-overlapping occurrences.
 *
 * @example
 * countOccurrences('banana', 'an'); // => 2
 * countOccurrences('aaa', 'aa');    // => 1
 */
export function countOccurrences(text: string, needle: string): number {
  if (needle === '') {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

/**
 * Check whether a string is blank, i.e. empty or whitespace-only.
 *
 * Whitespace includes spaces, tabs, and other Unicode whitespace via
 * `String.prototype.trim`.
 *
 * @param text - The text to test.
 * @returns `true` if the text is empty or contains only whitespace.
 *
 * @example
 * isBlank('');        // => true
 * isBlank('   \t ');  // => true
 * isBlank('  hi  ');  // => false
 */
export function isBlank(text: string): boolean {
  return text.trim() === '';
}

// ============================================================================
// Line Handling
// ============================================================================

/**
 * Split text into an array of lines.
 *
 * Lines are separated by `\n`; a trailing newline does not produce a trailing
 * empty element (so `'a\n'` yields `['a']`), and the empty string yields an
 * empty array. This mirrors {@link countLines} and the location helpers'
 * 1-indexed newline-terminated line model.
 *
 * @param text - The text to split.
 * @returns An array of lines without their terminating newlines.
 *
 * @example
 * lines('');          // => []
 * lines('a\nb\n');    // => ['a', 'b']
 * lines('a\n\nb');    // => ['a', '', 'b']
 */
export function lines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Get the last line of a string.
 *
 * This is a convenience over {@link lines} for callers that only need the
 * final line (e.g. trailing content after the last newline).
 *
 * @param text - The text to inspect.
 * @returns The last line, or `''` when the text is empty.
 *
 * @example
 * lastLine('one\ntwo\nthree'); // => 'three'
 * lastLine('');                // => ''
 */
export function lastLine(text: string): string {
  const parts = lines(text);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// ============================================================================
// Shaping
// ============================================================================

/**
 * Indent every line of a string by a given number of spaces.
 *
 * The first line is indented as well. A trailing newline is preserved so the
 * final (empty) segment is not given a spurious indent.
 *
 * @param text - The text to indent.
 * @param spaces - The number of space characters to prefix each line with.
 * @returns The indented text.
 *
 * @example
 * indent('a\nb', 2); // => '  a\n  b'
 */
export function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(Math.max(0, spaces));
  if (text === '') {
    return '';
  }
  return prefix + text.replace(/\n/g, `\n${prefix}`);
}

/**
 * Remove the common leading indentation shared by all non-blank lines.
 *
 * The minimum number of leading whitespace characters across non-blank lines
 * is computed and stripped from every line. This is useful for normalizing
 * nested template literals and code blocks.
 *
 * @param text - The text to dedent.
 * @returns The dedented text.
 *
 * @example
 * dedent('    a\n      b\n'); // => 'a\n  b\n'
 */
export function dedent(text: string): string {
  const lns = lines(text);
  const indents = lns
    .filter((ln) => ln.trim() !== '')
    .map((ln) => ln.match(/^[ \t]*/)?.[0].length ?? 0);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return lns.map((ln) => ln.slice(min)).join('\n');
}

/**
 * Wrap text to a maximum line width using greedy word wrapping.
 *
 * Words longer than `width` are kept whole on their own line (they are not
 * hard-broken). Existing line breaks are preserved as wrapping boundaries.
 *
 * @param text - The text to wrap.
 * @param width - The maximum number of characters per line.
 * @returns The wrapped text.
 *
 * @example
 * wrapLines('one two three', 7); // => 'one two\nthree'
 */
export function wrapLines(text: string, width: number): string {
  if (width <= 0) {
    return text;
  }
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      if (current === '') {
        current = word;
      } else if ((current + ' ' + word).length <= width) {
        current += ' ' + word;
      } else {
        out.push(current);
        current = word;
      }
    }
    out.push(current);
  }
  return out.join('\n');
}

/**
 * Split a string into words on whitespace boundaries.
 *
 * Runs of whitespace are treated as a single separator and empty elements are
 * dropped, so leading/trailing whitespace never produces empty words.
 *
 * @param text - The text to split.
 * @returns An array of words.
 *
 * @example
 * splitWords('  hello   world  '); // => ['hello', 'world']
 * splitWords('');                  // => []
 */
export function splitWords(text: string): string[] {
  const words = text.trim().split(/\s+/);
  return text.trim() === '' ? [] : words;
}