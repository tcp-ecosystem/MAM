/**
 * MAM Token Scanner
 *
 * A small cursor abstraction over a `Token[]` stream that makes the parser
 * code easier to read and less error-prone than manually threading an index
 * through every helper. The scanner supports peeking, matching, expecting,
 * consuming runs of tokens, slicing ranges, and save/restore of positions.
 *
 * The scanner never mutates the tokens themselves; it only tracks a cursor.
 * It is intentionally dependency-free apart from the lexer token definitions
 * so it can be reused by any parser stage.
 */

import { Token, TokenType } from '../lexer/tokens.js';

/**
 * The outcome of a lookahead test against a scanner.
 *
 * When `matched` is `true` the `token` field is guaranteed to be present and
 * `index` is the position the token was found at. When `matched` is `false`
 * the `token` is `null` and `index` reports where the test was performed.
 */
export type TokenMatch =
  | { matched: true; token: Token; index: number }
  | { matched: false; token: null; index: number };

/**
 * A forward-only cursor over a token stream with bounded lookahead.
 *
 * The scanner is the workhorse of hand-written recursive-descent parsing: it
 * centralizes the index bookkeeping so grammar rules can be expressed in terms
 * of `peek`, `next`, `match`, and `expect` rather than raw array arithmetic.
 *
 * @example
 * ```ts
 * const scanner = new TokenScanner(tokens);
 * if (scanner.match(TokenType.HEADING_2)) {
 *   const marker = scanner.next()!;
 *   const text = scanner.expect(TokenType.HEADING_TEXT).value;
 * }
 * ```
 */
export class TokenScanner {
  private readonly tokens: Token[];
  private cursor: number;
  private readonly marks: number[];

  /**
   * Create a scanner positioned at the first token.
   *
   * @param tokens - The token stream to scan. The array is copied so later
   *   mutation of the caller's array cannot corrupt the scanner's view.
   */
  constructor(tokens: readonly Token[]) {
    this.tokens = [...tokens];
    this.cursor = 0;
    this.marks = [];
  }

  /**
   * Look at the token `offset` positions ahead of the cursor without moving it.
   *
   * A negative offset is allowed and looks backwards. When the requested
   * position falls outside the stream, `null` is returned.
   *
   * @param offset - The relative distance from the cursor. Defaults to `0`.
   * @returns The token at the requested position, or `null` when out of range.
   */
  peek(offset = 0): Token | null {
    const index = this.cursor + offset;
    if (index < 0 || index >= this.tokens.length) {
      return null;
    }
    return this.tokens[index]!;
  }

  /**
   * The token under the cursor, or `null` at the end of the stream.
   *
   * @returns The current token or `null`.
   */
  current(): Token | null {
    return this.peek(0);
  }

  /**
   * Consume and return the token under the cursor.
   *
   * @returns The consumed token, or `null` when the cursor is past the end.
   */
  next(): Token | null {
    const token = this.peek(0);
    if (token !== null) {
      this.cursor += 1;
    }
    return token;
  }

  /**
   * Test whether the token under the cursor has one of the given types.
   *
   * The cursor is not moved, which makes this suitable for lookahead in
   * `if` conditions before calling {@link next}.
   *
   * @param type - A single token type or a list of acceptable types.
   * @returns `true` when the current token matches one of the types.
   */
  match(type: TokenType | readonly TokenType[]): boolean {
    const token = this.peek(0);
    if (token === null) {
      return false;
    }
    return isOneOf(token.type, type);
  }

  /**
   * Consume a token of an expected type or throw a descriptive error.
   *
   * This is the assertion form of {@link match}: when the current token does
   * not match, parsing cannot continue and an error is raised. The scanner is
   * left untouched on failure so callers can inspect the offending position.
   *
   * @param type - A single token type or a list of acceptable types.
   * @param message - Optional custom error message.
   * @returns The consumed token.
   * @throws {Error} When the current token does not match `type`.
   */
  expect(type: TokenType | readonly TokenType[], message?: string): Token {
    const token = this.peek(0);
    if (token === null) {
      throw new Error(message ?? `Expected ${describeTypes(type)} but reached end of input`);
    }
    if (!isOneOf(token.type, type)) {
      throw new Error(
        message ??
          `Expected ${describeTypes(type)} but found ${token.type} at ${token.line}:${token.column}`
      );
    }
    this.cursor += 1;
    return token;
  }

  /**
   * Consume tokens while a predicate holds, returning everything consumed.
   *
   * The predicate receives the candidate token and its absolute index. The
   * first token for which the predicate returns `false` is left under the
   * cursor, so the scanner stops just before the non-matching token.
   *
   * @param predicate - Returns `true` for tokens that should be consumed.
   * @returns The consumed tokens in stream order.
   */
  consumeWhile(predicate: (token: Token, index: number) => boolean): Token[] {
    const consumed: Token[] = [];
    while (this.cursor < this.tokens.length) {
      const token = this.tokens[this.cursor]!;
      if (!predicate(token, this.cursor)) {
        break;
      }
      consumed.push(token);
      this.cursor += 1;
    }
    return consumed;
  }

  /**
   * Determine whether the scanner has reached the end of meaningful input.
   *
   * This is `true` when the cursor is past the last token or when the token
   * under the cursor is an explicit `EOF` token.
   *
   * @returns `true` when no more content remains to be parsed.
   */
  atEof(): boolean {
    const token = this.peek(0);
    return token === null || token.type === TokenType.EOF;
  }

  /**
   * The absolute index of the token currently under the cursor.
   *
   * @returns The zero-based cursor position.
   */
  position(): number {
    return this.cursor;
  }

  /**
   * Return a copy of a range of tokens from the stream.
   *
   * The `from` index is inclusive and the optional `to` index is exclusive.
   * Indices are clamped to the bounds of the stream, and an inverted range
   * yields an empty array rather than throwing.
   *
   * @param from - The inclusive start index.
   * @param to - The exclusive end index. Defaults to the current cursor.
   * @returns A new array containing the sliced tokens.
   */
  slice(from: number, to?: number): Token[] {
    const end = to ?? this.cursor;
    const start = Math.max(0, Math.min(from, this.tokens.length));
    const stop = Math.max(0, Math.min(end, this.tokens.length));
    if (stop <= start) {
      return [];
    }
    return this.tokens.slice(start, stop);
  }

  /**
   * Move the cursor to an absolute index.
   *
   * The index is clamped to the valid range so out-of-range rewinds cannot
   * place the scanner into an unrecoverable state.
   *
   * @param index - The absolute index to move to.
   */
  rewindTo(index: number): void {
    this.cursor = Math.max(0, Math.min(index, this.tokens.length));
  }

  /**
   * Push the current cursor position onto an internal save stack.
   *
   * Use together with {@link restore} to implement speculative parsing: back
   * up, try a rule, and either keep the result or roll the cursor back.
   */
  backup(): void {
    this.marks.push(this.cursor);
  }

  /**
   * Restore the cursor to the most recently saved position.
   *
   * If no position has been saved, the cursor is left unchanged.
   */
  restore(): void {
    const mark = this.marks.pop();
    if (mark !== undefined) {
      this.cursor = mark;
    }
  }

  /**
   * Discard the most recently saved position without restoring it.
   *
   * This is useful when speculative parsing succeeded and the saved mark is no
   * longer needed.
   */
  commit(): void {
    this.marks.pop();
  }

  /**
   * Move the cursor back to the beginning of the stream and clear all marks.
   */
  reset(): void {
    this.cursor = 0;
    this.marks.length = 0;
  }

  /**
   * The number of tokens remaining from the cursor to the end of the stream.
   *
   * @returns The remaining token count.
   */
  remaining(): number {
    return Math.max(0, this.tokens.length - this.cursor);
  }

  /**
   * The total number of tokens in the scanned stream.
   *
   * @returns The stream length.
   */
  get length(): number {
    return this.tokens.length;
  }

  /**
   * Collect every remaining token and advance the cursor to the end.
   *
   * @returns The remaining tokens in stream order.
   */
  rest(): Token[] {
    const remaining = this.tokens.slice(this.cursor);
    this.cursor = this.tokens.length;
    return remaining;
  }

  /**
   * Look ahead for the nearest token of a given type without moving the cursor.
   *
   * @param type - A single token type or a list of acceptable types.
   * @param fromOffset - The relative offset at which the search begins.
   * @returns A {@link TokenMatch} describing whether and where a match was found.
   */
  lookaheadFor(
    type: TokenType | readonly TokenType[],
    fromOffset = 0
  ): TokenMatch {
    let index = this.cursor + fromOffset;
    while (index >= 0 && index < this.tokens.length) {
      const token = this.tokens[index]!;
      if (isOneOf(token.type, type)) {
        return { matched: true, token, index };
      }
      index += 1;
    }
    return { matched: false, token: null, index: this.cursor };
  }
}

/**
 * Check whether a token type is contained in a single type or a list of types.
 *
 * @param candidate - The token type under test.
 * @param type - A single type or a readonly list of types.
 * @returns `true` when `candidate` equals the single type or is in the list.
 */
function isOneOf(candidate: TokenType, type: TokenType | readonly TokenType[]): boolean {
  return typeof type === 'string' ? candidate === type : type.includes(candidate);
}

/**
 * Render a token type (or list of types) for use in error messages.
 *
 * @param type - A single type or a list of types.
 * @returns A human-readable representation such as `HEADING_2` or `TEXT | EOF`.
 */
function describeTypes(type: TokenType | readonly TokenType[]): string {
  return typeof type === 'string' ? type : type.join(' | ');
}

/**
 * Concatenate the raw values of a token range into a single string.
 *
 * This reconstructs the source text represented by a span of tokens. It is
 * mostly useful for paragraphs and list items where the original whitespace
 * and line breaks were split into separate tokens.
 *
 * @param tokens - The tokens to join.
 * @param separator - A string inserted between token values. Defaults to an
 *   empty string, which reproduces the original contiguous source.
 * @returns The concatenated text.
 */
export function tokensToText(tokens: readonly Token[], separator = ''): string {
  return tokens.map((token) => token.value).join(separator);
}

/**
 * Find the index of the first token of a given type in a stream.
 *
 * The search begins at `fromIndex` and scans forward. A negative or
 * out-of-range start is clamped to a valid position.
 *
 * @param tokens - The token stream to search.
 * @param type - The token type to look for.
 * @param fromIndex - The inclusive index at which to begin. Defaults to `0`.
 * @returns The index of the first matching token, or `-1` when none is found.
 */
export function findToken(tokens: readonly Token[], type: TokenType, fromIndex = 0): number {
  const start = Math.max(0, fromIndex);
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i]!.type === type) {
      return i;
    }
  }
  return -1;
}

/**
 * Count the number of tokens of a given type in a stream.
 *
 * @param tokens - The token stream to count.
 * @param type - The token type to count.
 * @returns The number of matching tokens.
 */
export function countTokens(tokens: readonly Token[], type: TokenType): number {
  let count = 0;
  for (const token of tokens) {
    if (token.type === type) {
      count += 1;
    }
  }
  return count;
}

/**
 * Collect every token of a given type from a stream.
 *
 * @param tokens - The token stream to filter.
 * @param type - The token type to keep.
 * @returns A new array containing only matching tokens.
 */
export function filterTokens(tokens: readonly Token[], type: TokenType): Token[] {
  return tokens.filter((token) => token.type === type);
}
