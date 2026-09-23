/**
 * MAM DSL Token Stream Helpers
 *
 * Lightweight token types and a cursor-based scanner over an in-memory token
 * stream for the v2 DSL parser. Tokens are plain objects (not the lexer's
 * `Token`) so DSL tooling can work without depending on the lexer package.
 */

import { DSLTokenType } from './types.js';
import { DSLError, DSLErrorCode } from './errors.js';

// ============================================================================
// DSL Token
// ============================================================================

/**
 * A single DSL token.
 *
 * Unlike the lexer's `Token`, this is a minimal, plain object carrying just
 * the token type, its raw value, and its source location.
 */
export interface DSLToken {
  /** The semantic kind of the token. */
  type: DSLTokenType;
  /** Raw text value of the token. */
  value: string;
  /** 1-based line number where the token starts. */
  line: number;
  /** 1-based column number where the token starts. */
  column: number;
}

/**
 * Creates a new `DSLToken`.
 *
 * @param type - Semantic kind of the token.
 * @param value - Raw text value of the token.
 * @param line - 1-based line number (defaults to 0).
 * @param column - 1-based column number (defaults to 0).
 * @returns A new DSL token.
 */
export function createDSLToken(
  type: DSLTokenType,
  value: string,
  line: number = 0,
  column: number = 0
): DSLToken {
  return { type, value, line, column };
}

// ============================================================================
// DSL Token Scanner
// ============================================================================

/**
 * Cursor-based scanner over a `DSLToken` array.
 *
 * Provides single-token lookahead (`peek`), consumption (`next`), pattern
 * matching (`match` / `expect`), and block consumption (`consumeWhile`) useful
 * for building recursive-descent parsers over DSL token streams.
 */
export class DSLTokenScanner {
  private readonly tokens: DSLToken[];
  private readonly source: string;
  private pos: number;

  /**
   * Creates a new scanner.
   *
   * @param tokens - The token stream to scan (defaults to an empty array).
   * @param source - Source identifier used in error messages (defaults to `<dsl>`).
   */
  constructor(tokens: DSLToken[] = [], source: string = '<dsl>') {
    this.tokens = tokens;
    this.source = source;
    this.pos = 0;
  }

  /**
   * Current read position in the token stream.
   */
  get position(): number {
    return this.pos;
  }

  /**
   * Sets the read position in the token stream.
   */
  set position(value: number) {
    this.pos = Math.max(0, Math.min(value, this.tokens.length));
  }

  /**
   * Total number of tokens in the underlying stream.
   */
  get length(): number {
    return this.tokens.length;
  }

  /**
   * Read-only view of the underlying token stream.
   */
  get stream(): readonly DSLToken[] {
    return this.tokens;
  }

  /**
   * Returns `true` when the scanner has reached the end of the stream.
   */
  atEof(): boolean {
    return this.pos >= this.tokens.length || this.tokens[this.pos]?.type === DSLTokenType.EOF;
  }

  /**
   * Peeks at a token ahead of the current position without consuming it.
   *
   * @param offset - Number of tokens to look ahead (defaults to 0).
   * @returns The token at the lookahead position, or `undefined` when out of range.
   */
  peek(offset: number = 0): DSLToken | undefined {
    return this.tokens[this.pos + offset];
  }

  /**
   * Returns the current token and advances the scanner.
   *
   * @returns The consumed token, or `undefined` at the end of the stream.
   */
  next(): DSLToken | undefined {
    if (this.pos >= this.tokens.length) return undefined;
    return this.tokens[this.pos++];
  }

  /**
   * Consumes the current token if its type matches the given type.
   *
   * @param type - The token type to match.
   * @returns The consumed token, or `undefined` when the type does not match.
   */
  match(type: DSLTokenType): DSLToken | undefined {
    const token = this.peek();
    if (token && token.type === type) {
      this.pos++;
      return token;
    }
    return undefined;
  }

  /**
   * Consumes the current token if its type matches, otherwise throws a `DSLError`.
   *
   * @param type - The token type to require.
   * @param message - Optional custom error message.
   * @returns The consumed token.
   * @throws {@link DSLError} when the current token does not match.
   */
  expect(type: DSLTokenType, message?: string): DSLToken {
    const token = this.match(type);
    if (!token) {
      const found = this.peek();
      throw new DSLError(
        message ?? `Expected token ${type}, found ${found ? found.type : 'EOF'}`,
        this.source,
        found?.line ?? 0,
        found?.column ?? 0,
        DSLErrorCode.UNEXPECTED_TOKEN,
        'error',
        [type],
        found?.type
      );
    }
    return token;
  }

  /**
   * Consumes tokens while the predicate returns `true`.
   *
   * @param predicate - Receives each candidate token and its index within the
   *   consumed run; return `true` to keep consuming.
   * @returns The consumed tokens (may be empty).
   */
  consumeWhile(predicate: (token: DSLToken, index: number) => boolean): DSLToken[] {
    const collected: DSLToken[] = [];
    let index = 0;
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos]!;
      if (!predicate(token, index)) break;
      collected.push(token);
      this.pos++;
      index++;
    }
    return collected;
  }

  /**
   * Returns all remaining tokens without consuming them.
   *
   * @returns The remainder of the token stream from the current position.
   */
  toArray(): DSLToken[] {
    return this.tokens.slice(this.pos);
  }

  /**
   * Resets the scanner to the start of the stream.
   */
  reset(): void {
    this.pos = 0;
  }
}

// ============================================================================
// Token Predicates
// ============================================================================

/**
 * Returns `true` when the token is a section key token.
 *
 * @param token - Token to inspect (may be `undefined`).
 * @returns `true` for a `SECTION_KEY` token.
 */
export function isSectionKey(token: DSLToken | undefined): boolean {
  return token?.type === DSLTokenType.SECTION_KEY;
}

/**
 * Returns `true` when the token is a list item token.
 *
 * @param token - Token to inspect (may be `undefined`).
 * @returns `true` for a `LIST_ITEM` token.
 */
export function isListItem(token: DSLToken | undefined): boolean {
  return token?.type === DSLTokenType.LIST_ITEM;
}

/**
 * Returns `true` when the token is an edge token.
 *
 * @param token - Token to inspect (may be `undefined`).
 * @returns `true` for an `EDGE` token.
 */
export function isEdge(token: DSLToken | undefined): boolean {
  return token?.type === DSLTokenType.EDGE;
}

/**
 * Joins the values of a token array into a single text string.
 *
 * @param tokens - Tokens to concatenate.
 * @returns The combined token text, space-delimited.
 */
export function tokensToText(tokens: readonly DSLToken[]): string {
  return tokens.map(token => token.value).join(' ');
}