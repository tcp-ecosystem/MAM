/**
 * MAM Pattern Helpers
 *
 * Utilities for matching strings against prefixes, suffixes, substrings, and
 * glob patterns. These are used for section-name matching, tag filtering, and
 * other pattern-driven behavior in MAM tooling.
 */

// ============================================================================
// Prefix / Suffix / Substring
// ============================================================================

/**
 * Check whether a string starts with any of the given prefixes.
 *
 * @param text - The string to test.
 * @param prefixes - The candidate prefixes.
 * @returns `true` if `text` starts with at least one prefix.
 *
 * @example
 * startsWithAny('hello', ['he', 'wo']); // => true
 * startsWithAny('hello', ['ho']);       // => false
 */
export function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

/**
 * Check whether a string ends with any of the given suffixes.
 *
 * @param text - The string to test.
 * @param suffixes - The candidate suffixes.
 * @returns `true` if `text` ends with at least one suffix.
 *
 * @example
 * endsWithAny('hello.md', ['.md', '.txt']); // => true
 */
export function endsWithAny(text: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => text.endsWith(suffix));
}

/**
 * Check whether a string contains any of the given substrings.
 *
 * @param text - The string to test.
 * @param needles - The substrings to search for.
 * @returns `true` if `text` contains at least one needle.
 *
 * @example
 * containsAny('alpha beta', ['bet', 'gamma']); // => true
 */
export function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

// ============================================================================
// Glob Matching
// ============================================================================

/**
 * Convert a glob pattern into a `RegExp`.
 *
 * Supported syntax:
 * - `*` matches any run of characters within a path segment.
 * - `?` matches exactly one character.
 * - `**` matches any run of characters across path separators.
 *
 * All other characters are treated literally (regex metacharacters are
 * escaped). The returned expression is anchored so it matches the whole input.
 *
 * @param pattern - The glob pattern to compile.
 * @returns A compiled, anchored `RegExp`.
 *
 * @example
 * globToRegExp('src/**\/*.ts').test('src/utils/location.ts'); // => true
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += '\\' + char;
    } else {
      out += char;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Test whether a string matches a glob pattern.
 *
 * A convenience wrapper around {@link globToRegExp}.
 *
 * @param text - The string to test.
 * @param pattern - The glob pattern to match against.
 * @returns `true` if `text` matches the pattern.
 *
 * @example
 * matchGlob('README.md', '*.md'); // => true
 */
export function matchGlob(text: string, pattern: string): boolean {
  return globToRegExp(pattern).test(text);
}

// ============================================================================
// Prefix / Suffix Stripping
// ============================================================================

/**
 * Remove a leading prefix from a string if present.
 *
 * If `text` does not start with `prefix`, the original string is returned
 * unchanged.
 *
 * @param text - The string to modify.
 * @param prefix - The prefix to strip.
 * @returns The string without its leading prefix.
 *
 * @example
 * stripPrefix('file.md', 'file'); // => '.md'
 */
export function stripPrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Remove a trailing suffix from a string if present.
 *
 * If `text` does not end with `suffix`, the original string is returned
 * unchanged.
 *
 * @param text - The string to modify.
 * @param suffix - The suffix to strip.
 * @returns The string without its trailing suffix.
 *
 * @example
 * stripSuffix('file.md', '.md'); // => 'file'
 */
export function stripSuffix(text: string, suffix: string): string {
  return text.endsWith(suffix)
    ? text.slice(0, text.length - suffix.length)
    : text;
}

/**
 * Extract the portion of a string before the first occurrence of a delimiter.
 *
 * If the delimiter is absent the entire string is returned.
 *
 * @param text - The string to inspect.
 * @param delimiter - The delimiter marking the split point.
 * @returns The substring preceding `delimiter`.
 *
 * @example
 * extractBefore('a:b:c', ':'); // => 'a'
 */
export function extractBefore(text: string, delimiter: string): string {
  const index = text.indexOf(delimiter);
  return index === -1 ? text : text.slice(0, index);
}

/**
 * Extract the portion of a string after the first occurrence of a delimiter.
 *
 * If the delimiter is absent an empty string is returned.
 *
 * @param text - The string to inspect.
 * @param delimiter - The delimiter marking the split point.
 * @returns The substring following `delimiter`, or `''`.
 *
 * @example
 * extractAfter('a:b:c', ':'); // => 'b:c'
 */
export function extractAfter(text: string, delimiter: string): string {
  const index = text.indexOf(delimiter);
  return index === -1 ? '' : text.slice(index + delimiter.length);
}