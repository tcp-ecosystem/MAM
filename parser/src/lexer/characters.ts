/**
 * MAM Character Classification
 *
 * Low-level single-character predicates and character-class metadata used by
 * the MAM lexer. These helpers are deliberately allocation-free and operate on
 * a single character (a one-code-unit string) so they are safe to call from
 * hot paths inside the tokenizer.
 *
 * Every function in this module treats a string of length greater than one as
 * not matching, so callers can safely pass arbitrary input without needing to
 * slice first.
 */

/**
 * The character classes recognized by the MAM lexer.
 *
 * Each class groups characters by their syntactic role. The `'other'` class is
 * the fallback for any character that does not fit a more specific category.
 */
export type CharacterClass =
  | 'whitespace'
  | 'horizontal-whitespace'
  | 'line-break'
  | 'digit'
  | 'alpha'
  | 'alnum'
  | 'punctuation'
  | 'bracket'
  | 'quote'
  | 'other';

/**
 * Check whether a character is any form of whitespace, including line breaks.
 *
 * @param char - The character to test.
 * @returns `true` for spaces, tabs, newlines, carriage returns, and other
 *   Unicode whitespace.
 */
export function isWhitespace(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\v' ||
    char === '\f' ||
    char === '\u00a0' ||
    char === '\u3000'
  );
}

/**
 * Check whether a character is horizontal whitespace (space or tab).
 *
 * Line breaks are intentionally excluded so callers can distinguish
 * "whitespace on a line" from "the end of a line".
 *
 * @param char - The character to test.
 * @returns `true` for a space or a tab character.
 */
export function isHorizontalWhitespace(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  return char === ' ' || char === '\t' || char === '\u00a0' || char === '\u3000';
}

/**
 * Check whether a character is a line break.
 *
 * Both `\n` (LF) and `\r` (CR) are recognized. The CRLF sequence is two
 * characters, so callers scanning for line breaks should treat `\r\n` as a
 * single logical break when advancing source positions.
 *
 * @param char - The character to test.
 * @returns `true` for `\n` or `\r`.
 */
export function isLineBreak(char: string): boolean {
  return char === '\n' || char === '\r';
}

/**
 * Check whether a character is an ASCII digit.
 *
 * @param char - The character to test.
 * @returns `true` for characters in the range `0`–`9`.
 */
export function isDigit(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  const code = char.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}

/**
 * Check whether a character is an ASCII letter.
 *
 * @param char - The character to test.
 * @returns `true` for characters in the ranges `a`–`z` and `A`–`Z`.
 */
export function isAlpha(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  const code = char.charCodeAt(0);
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Check whether a character is an ASCII letter or digit.
 *
 * @param char - The character to test.
 * @returns `true` for characters matched by either {@link isAlpha} or
 *   {@link isDigit}.
 */
export function isAlnum(char: string): boolean {
  return isAlpha(char) || isDigit(char);
}

/**
 * ASCII punctuation characters used by MAM/Markdown syntax.
 *
 * This includes the characters that introduce or terminate markup: hashes,
 * asterisks, backticks, tildes, pipes, colons, brackets, and so on.
 */
const PUNCTUATION_CHARS =
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/**
 * Check whether a character is an ASCII punctuation mark.
 *
 * The set matches the printable ASCII characters that are neither letters,
 * digits, nor whitespace.
 *
 * @param char - The character to test.
 * @returns `true` when the character is a printable punctuation character.
 */
export function isPunctuation(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  return PUNCTUATION_CHARS.includes(char);
}

/**
 * The set of bracket characters recognized by the lexer.
 */
const BRACKET_CHARS = '()[]{}<>';

/**
 * Check whether a character is a bracket (parenthesis, square, curly, or angle).
 *
 * @param char - The character to test.
 * @returns `true` when the character is one of `(`, `)`, `[`, `]`, `{`, `}`,
 *   `<`, or `>`.
 */
export function isBracket(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  return BRACKET_CHARS.includes(char);
}

/**
 * The set of quote characters recognized by the lexer.
 */
const QUOTE_CHARS = '\'"`';

/**
 * Check whether a character is a quote character.
 *
 * Both single and double quotes are recognized, as well as the backtick used
 * for inline code spans.
 *
 * @param char - The character to test.
 * @returns `true` for `'`, `"`, or `` ` ``.
 */
export function isQuote(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  return QUOTE_CHARS.includes(char);
}

/**
 * Classify a single character into a {@link CharacterClass}.
 *
 * The classification order matters: line breaks are reported before generic
 * whitespace, and letters are reported before the combined alphanumeric
 * category so that callers inspecting the result can rely on specific classes
 * being returned first.
 *
 * @param char - The character to classify.
 * @returns The most specific {@link CharacterClass} for the character, or
 *   `'other'` for an empty string, a multi-character string, or any character
 *   that does not match a known class.
 */
export function classifyCharacter(char: string): CharacterClass {
  if (char.length !== 1) {
    return 'other';
  }
  if (isLineBreak(char)) {
    return 'line-break';
  }
  if (isHorizontalWhitespace(char)) {
    return 'horizontal-whitespace';
  }
  if (isWhitespace(char)) {
    return 'whitespace';
  }
  if (isDigit(char)) {
    return 'digit';
  }
  if (isAlpha(char)) {
    return 'alpha';
  }
  if (isPunctuation(char)) {
    if (isBracket(char)) {
      return 'bracket';
    }
    if (isQuote(char)) {
      return 'quote';
    }
    return 'punctuation';
  }
  return 'other';
}

/**
 * Check whether a character can begin an identifier.
 *
 * Identifiers in MAM start with a letter or an underscore.
 *
 * @param char - The character to test.
 * @returns `true` when the character is a letter or `_`.
 */
export function isValidIdentifierStart(char: string): boolean {
  return isAlpha(char) || char === '_';
}

/**
 * Check whether a character can appear inside an identifier.
 *
 * Identifiers in MAM continue with letters, digits, underscores, and hyphens.
 *
 * @param char - The character to test.
 * @returns `true` when the character is a letter, digit, `_`, or `-`.
 */
export function isValidIdentifierChar(char: string): boolean {
  return isAlnum(char) || char === '_' || char === '-';
}

/**
 * Character classes as compact string sets, keyed by class name.
 *
 * Each value is a string that can be passed to `includes` for membership
 * tests. The sets cover only ASCII characters; non-ASCII characters never
 * appear in these strings and fall through to {@link classifyCharacter}'s
 * `'other'` handling.
 */
export const CHARACTER_CLASSES: Readonly<Record<CharacterClass, string>> = {
  whitespace: ' \t\n\r\v\f\u00a0\u3000',
  'horizontal-whitespace': ' \t\u00a0\u3000',
  'line-break': '\n\r',
  digit: '0123456789',
  alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alnum: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  punctuation: PUNCTUATION_CHARS,
  bracket: BRACKET_CHARS,
  quote: QUOTE_CHARS,
  other: '',
};

/**
 * Return a description of a {@link CharacterClass} for diagnostics and tooling.
 *
 * @param cls - The character class to describe.
 * @returns A short human-readable description of the class.
 */
export function describeCharacterClass(cls: CharacterClass): string {
  switch (cls) {
    case 'whitespace':
      return 'Any whitespace character, including line breaks.';
    case 'horizontal-whitespace':
      return 'A space, tab, or other horizontal whitespace character.';
    case 'line-break':
      return 'A line feed or carriage return.';
    case 'digit':
      return 'An ASCII digit from 0 to 9.';
    case 'alpha':
      return 'An ASCII letter, upper or lower case.';
    case 'alnum':
      return 'An ASCII letter or digit.';
    case 'punctuation':
      return 'A printable ASCII punctuation character.';
    case 'bracket':
      return 'A parenthetical, square, curly, or angle bracket.';
    case 'quote':
      return 'A single quote, double quote, or backtick.';
    case 'other':
      return 'Any character that does not match a more specific class.';
  }
}