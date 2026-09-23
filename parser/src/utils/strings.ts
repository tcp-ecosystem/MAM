/**
 * MAM String Helpers
 *
 * Small, dependency-free utilities for escaping, casing, quoting, and general
 * string manipulation. These helpers are used when emitting generated content,
 * sanitizing user input, and converting identifiers between conventions.
 */

// ============================================================================
// Escaping
// ============================================================================

/**
 * Escape a string so it can be used literally inside a `RegExp` constructor.
 *
 * Every character with special meaning in a regular expression is prefixed
 * with a backslash. Use the result with `new RegExp(escapeRegExp(s))` to match
 * `s` literally.
 *
 * @param value - The string to escape.
 * @returns The regex-safe form of `value`.
 *
 * @example
 * escapeRegExp('a.b*'); // => 'a\\.b\\*'
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape characters that have special meaning in Markdown.
 *
 * The escaped set covers heading markers, emphasis, code spans, links, lists,
 * and HTML-ish punctuation. Escaping prevents user-provided text from being
 * interpreted as formatting when embedded in generated Markdown.
 *
 * @param value - The text to escape.
 * @returns Markdown-safe text.
 *
 * @example
 * escapeMarkdown('*bold* [x](y)'); // => '\\*bold\\* \\[x\\]\\(y\\)'
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!>|])/g, '\\$1');
}

/**
 * Unescape backslash-escaped Markdown characters.
 *
 * Reverses {@link escapeMarkdown}: a backslash immediately preceding a
 * Markdown-significant character is removed while the character itself is
 * kept. Backslashes not followed by such a character are left intact.
 *
 * @param value - The escaped text to unescape.
 * @returns The unescaped text.
 *
 * @example
 * unescapeMarkdown('\\*bold\\*'); // => '*bold*'
 */
export function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1');
}

// ============================================================================
// Casing
// ============================================================================

/**
 * Split a string into its constituent words.
 *
 * Words are split on camelCase boundaries (`fooBar` → `foo`, `Bar`), digit
 * boundaries, and any run of non-alphanumeric characters. The result is useful
 * as the shared building block for all case-conversion helpers in this module.
 *
 * @param value - The string to split.
 * @returns Lowercased word tokens.
 *
 * @example
 * splitCaseWords('fooBar-baz 42'); // => ['foo', 'bar', 'baz', '42']
 */
export function splitCaseWords(value: string): string[] {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
  return words;
}

/**
 * Convert a string to kebab-case (`foo-bar-baz`).
 *
 * @param value - The string to convert.
 * @returns The kebab-cased form.
 *
 * @example
 * toKebabCase('FooBar baz'); // => 'foo-bar-baz'
 */
export function toKebabCase(value: string): string {
  return splitCaseWords(value).join('-');
}

/**
 * Convert a string to snake_case (`foo_bar_baz`).
 *
 * @param value - The string to convert.
 * @returns The snake-cased form.
 *
 * @example
 * toSnakeCase('FooBar baz'); // => 'foo_bar_baz'
 */
export function toSnakeCase(value: string): string {
  return splitCaseWords(value).join('_');
}

/**
 * Convert a string to camelCase (`fooBarBaz`).
 *
 * @param value - The string to convert.
 * @returns The camel-cased form.
 *
 * @example
 * toCamelCase('Foo-bar baz'); // => 'fooBarBaz'
 */
export function toCamelCase(value: string): string {
  const words = splitCaseWords(value);
  return words
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * Convert a string to PascalCase (`FooBarBaz`).
 *
 * @param value - The string to convert.
 * @returns The Pascal-cased form.
 *
 * @example
 * toPascalCase('foo-bar baz'); // => 'FooBarBaz'
 */
export function toPascalCase(value: string): string {
  return splitCaseWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

// ============================================================================
// Capitalization
// ============================================================================

/**
 * Uppercase the first character of a string.
 *
 * The remainder of the string is left untouched. For an empty string an empty
 * string is returned.
 *
 * @param value - The string to capitalize.
 * @returns The string with its first character uppercased.
 *
 * @example
 * capitalize('hello world'); // => 'Hello world'
 */
export function capitalize(value: string): string {
  if (value === '') {
    return '';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Lowercase the first character of a string.
 *
 * The remainder of the string is left untouched. For an empty string an empty
 * string is returned.
 *
 * @param value - The string to uncapitalize.
 * @returns The string with its first character lowercased.
 *
 * @example
 * uncapitalize('Hello World'); // => 'hello World'
 */
export function uncapitalize(value: string): string {
  if (value === '') {
    return '';
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// ============================================================================
// Quoting
// ============================================================================

/**
 * Wrap a value in a quote character.
 *
 * The value is never escaped and is always wrapped, even if it already begins
 * and ends with the same quote character.
 *
 * @param value - The value to quote.
 * @param char - The quote character to use (default `'"'`).
 * @returns The quoted string.
 *
 * @example
 * quote('hello');          // => '"hello"'
 * quote('hello', "'");     // => "'hello'"
 */
export function quote(value: string, char: string = '"'): string {
  return char + value + char;
}

/**
 * Remove a matching pair of surrounding quotes from a string.
 *
 * Single quotes, double quotes, and backticks are recognized. If the string
 * does not begin and end with the same quote character it is returned
 * unchanged.
 *
 * @param value - The value to unquote.
 * @returns The unquoted string, or the input unchanged when not quoted.
 *
 * @example
 * unquote('"hello"');  // => 'hello'
 * unquote("'hello'");  // => 'hello'
 * unquote('`hello`');  // => 'hello'
 * unquote('hello');    // => 'hello'
 */
export function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if (
      (first === '"' || first === "'" || first === '`') &&
      first === last
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}