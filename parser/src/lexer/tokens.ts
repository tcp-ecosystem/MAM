/**
 * MAM Token Definitions
 * 
 * Complete token type definitions for the MAM lexer.
 * Tokens represent the smallest meaningful units in a MAM document.
 */

export enum TokenType {
  // Special tokens
  EOF = 'EOF',
  ERROR = 'ERROR',

  // Front matter
  FRONTMATTER_SEPARATOR = 'FRONTMATTER_SEPARATOR',  // ---

  // Headings
  HEADING_1 = 'HEADING_1',    // #
  HEADING_2 = 'HEADING_2',    // ##
  HEADING_3 = 'HEADING_3',    // ###
  HEADING_4 = 'HEADING_4',    // ####
  HEADING_5 = 'HEADING_5',    // #####
  HEADING_6 = 'HEADING_6',    // ######
  HEADING_TEXT = 'HEADING_TEXT',

  // Code
  CODE_FENCE_BACKTICK = 'CODE_FENCE_BACKTICK',  // ```
  CODE_FENCE_TILDE = 'CODE_FENCE_TILDE',        // ~~~
  CODE_LANGUAGE = 'CODE_LANGUAGE',
  CODE_CONTENT = 'CODE_CONTENT',
  CODE_METADATA = 'CODE_METADATA',  // @mam:key=value

  // Lists
  BULLET_LIST = 'BULLET_LIST',        // -, *, +
  NUMBERED_LIST = 'NUMBERED_LIST',    // 1.
  LIST_ITEM_TEXT = 'LIST_ITEM_TEXT',
  TASK_CHECKED = 'TASK_CHECKED',     // [x]
  TASK_UNCHECKED = 'TASK_UNCHECKED', // [ ]

  // Tables
  TABLE_PIPE = 'TABLE_PIPE',          // |
  TABLE_HYPHEN = 'TABLE_HYPHEN',      // ---
  TABLE_COLON = 'TABLE_COLON',        // :
  TABLE_HEADER_CELL = 'TABLE_HEADER_CELL',
  TABLE_ROW_CELL = 'TABLE_ROW_CELL',
  TABLE_NEWLINE = 'TABLE_NEWLINE',

  // Inline formatting
  BOLD_OPEN = 'BOLD_OPEN',           // **
  BOLD_CLOSE = 'BOLD_CLOSE',         // **
  ITALIC_OPEN = 'ITALIC_OPEN',       // *
  ITALIC_CLOSE = 'ITALIC_CLOSE',     // *
  STRIKETHROUGH_OPEN = 'STRIKETHROUGH_OPEN',   // ~~
  STRIKETHROUGH_CLOSE = 'STRIKETHROUGH_CLOSE', // ~~
  CODE_INLINE = 'CODE_INLINE',       // `code`
  LINK_OPEN = 'LINK_OPEN',           // [
  LINK_TEXT = 'LINK_TEXT',
  LINK_SEPARATOR = 'LINK_SEPARATOR', // ](
  LINK_URL = 'LINK_URL',
  LINK_TITLE = 'LINK_TITLE',
  LINK_CLOSE = 'LINK_CLOSE',         // )
  IMAGE_OPEN = 'IMAGE_OPEN',         // ![
  IMAGE_ALT = 'IMAGE_ALT',
  IMAGE_SEPARATOR = 'IMAGE_SEPARATOR',

  // Block elements
  BLOCKQUOTE = 'BLOCKQUOTE',         // >
  HORIZONTAL_RULE = 'HORIZONTAL_RULE', // ---, ***, ___
  PARAGRAPH_BREAK = 'PARAGRAPH_BREAK',

  // YAML
  YAML_KEY = 'YAML_KEY',
  YAML_VALUE = 'YAML_VALUE',
  YAML_SEPARATOR = 'YAML_SEPARATOR', // :
  YAML_LIST_ITEM = 'YAML_LIST_ITEM', // -

  // Whitespace and structure
  NEWLINE = 'NEWLINE',
  INDENT = 'INDENT',
  DEDENT = 'DEDENT',
  WHITESPACE = 'WHITESPACE',
  TEXT = 'TEXT',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
  length: number;
  metadata?: TokenMetadata;
}

export interface TokenMetadata {
  language?: string;
  headingLevel?: number;
  listOrdered?: boolean;
  indentation?: number;
  isTask?: boolean;
  taskChecked?: boolean;
  linkUrl?: string;
  linkTitle?: string;
  imageAlt?: string;
  imageUrl?: string;
  yamlKey?: string;
  yamlValue?: string;
  codeMetadata?: Record<string, string>;
}

export function createToken(
  type: TokenType,
  value: string,
  line: number,
  column: number,
  offset: number,
  metadata?: TokenMetadata
): Token {
  return {
    type,
    value,
    line,
    column,
    offset,
    length: value.length,
    metadata,
  };
}

export const VALID_LANGUAGES = new Set([
  'python', 'py',
  'javascript', 'js',
  'typescript', 'ts',
  'rust', 'rs',
  'go',
  'shell', 'bash', 'sh', 'zsh',
  'yaml', 'yml',
  'json',
  'mermaid',
  'markdown', 'md',
  'html',
  'css',
  'sql',
  'ruby',
  'java',
  'c',
  'cpp',
  'csharp', 'cs',
  'php',
  'swift',
  'kotlin',
  'dart',
  'lua',
  'r',
  'perl',
  'toml',
  'xml',
  'dockerfile',
  'makefile',
]);

export function isLanguageValid(language: string): boolean {
  return VALID_LANGUAGES.has(language.toLowerCase());
}

export const STANDARD_SECTIONS = new Set([
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'TypeScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
]);

export function isSectionNameValid(name: string): boolean {
  return STANDARD_SECTIONS.has(name);
}

// ============================================================================
// Token type categories
// ============================================================================

/**
 * The broad category a {@link TokenType} belongs to.
 *
 * Categories group the fine-grained token types into the semantic families
 * that the MAM grammar cares about (headings, lists, tables, inline
 * formatting, code, and so on). They are useful for highlighting, filtering,
 * and for building higher-level analyses on top of a raw token stream.
 */
export type TokenTypeCategory =
  | 'special'
  | 'frontmatter'
  | 'heading'
  | 'code'
  | 'list'
  | 'table'
  | 'inline'
  | 'block'
  | 'yaml'
  | 'whitespace'
  | 'text';

/**
 * A mapping from every {@link TokenType} to its {@link TokenTypeCategory}.
 *
 * The map is exhaustive over `TokenType`; adding a new token type without a
 * category here will be caught by the TypeScript compiler because the record
 * type is `Record<TokenType, TokenTypeCategory>`.
 */
export const TOKEN_TYPE_CATEGORIES: Record<TokenType, TokenTypeCategory> = {
  // Special tokens
  [TokenType.EOF]: 'special',
  [TokenType.ERROR]: 'special',

  // Front matter
  [TokenType.FRONTMATTER_SEPARATOR]: 'frontmatter',

  // Headings
  [TokenType.HEADING_1]: 'heading',
  [TokenType.HEADING_2]: 'heading',
  [TokenType.HEADING_3]: 'heading',
  [TokenType.HEADING_4]: 'heading',
  [TokenType.HEADING_5]: 'heading',
  [TokenType.HEADING_6]: 'heading',
  [TokenType.HEADING_TEXT]: 'heading',

  // Code
  [TokenType.CODE_FENCE_BACKTICK]: 'code',
  [TokenType.CODE_FENCE_TILDE]: 'code',
  [TokenType.CODE_LANGUAGE]: 'code',
  [TokenType.CODE_CONTENT]: 'code',
  [TokenType.CODE_METADATA]: 'code',

  // Lists
  [TokenType.BULLET_LIST]: 'list',
  [TokenType.NUMBERED_LIST]: 'list',
  [TokenType.LIST_ITEM_TEXT]: 'list',
  [TokenType.TASK_CHECKED]: 'list',
  [TokenType.TASK_UNCHECKED]: 'list',

  // Tables
  [TokenType.TABLE_PIPE]: 'table',
  [TokenType.TABLE_HYPHEN]: 'table',
  [TokenType.TABLE_COLON]: 'table',
  [TokenType.TABLE_HEADER_CELL]: 'table',
  [TokenType.TABLE_ROW_CELL]: 'table',
  [TokenType.TABLE_NEWLINE]: 'table',

  // Inline formatting
  [TokenType.BOLD_OPEN]: 'inline',
  [TokenType.BOLD_CLOSE]: 'inline',
  [TokenType.ITALIC_OPEN]: 'inline',
  [TokenType.ITALIC_CLOSE]: 'inline',
  [TokenType.STRIKETHROUGH_OPEN]: 'inline',
  [TokenType.STRIKETHROUGH_CLOSE]: 'inline',
  [TokenType.CODE_INLINE]: 'inline',
  [TokenType.LINK_OPEN]: 'inline',
  [TokenType.LINK_TEXT]: 'inline',
  [TokenType.LINK_SEPARATOR]: 'inline',
  [TokenType.LINK_URL]: 'inline',
  [TokenType.LINK_TITLE]: 'inline',
  [TokenType.LINK_CLOSE]: 'inline',
  [TokenType.IMAGE_OPEN]: 'inline',
  [TokenType.IMAGE_ALT]: 'inline',
  [TokenType.IMAGE_SEPARATOR]: 'inline',

  // Block elements
  [TokenType.BLOCKQUOTE]: 'block',
  [TokenType.HORIZONTAL_RULE]: 'block',
  [TokenType.PARAGRAPH_BREAK]: 'block',

  // YAML
  [TokenType.YAML_KEY]: 'yaml',
  [TokenType.YAML_VALUE]: 'yaml',
  [TokenType.YAML_SEPARATOR]: 'yaml',
  [TokenType.YAML_LIST_ITEM]: 'yaml',

  // Whitespace and structure
  [TokenType.NEWLINE]: 'whitespace',
  [TokenType.INDENT]: 'whitespace',
  [TokenType.DEDENT]: 'whitespace',
  [TokenType.WHITESPACE]: 'whitespace',
  [TokenType.TEXT]: 'text',
};

/**
 * Return the {@link TokenTypeCategory} for a {@link TokenType}.
 *
 * @param type - The token type to classify.
 * @returns The category the type belongs to.
 */
export function tokenTypeCategory(type: TokenType): TokenTypeCategory {
  return TOKEN_TYPE_CATEGORIES[type];
}

// ============================================================================
// Token type groups
// ============================================================================

/**
 * Every {@link TokenType} that represents a heading construct, from the level
 * markers (`#` … `######`) to the heading text that follows them.
 */
export const HEADING_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.HEADING_1,
  TokenType.HEADING_2,
  TokenType.HEADING_3,
  TokenType.HEADING_4,
  TokenType.HEADING_5,
  TokenType.HEADING_6,
  TokenType.HEADING_TEXT,
];

/**
 * Every {@link TokenType} that participates in list structures, including
 * bullet and numbered markers, list item text, and task checkboxes.
 */
export const LIST_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.BULLET_LIST,
  TokenType.NUMBERED_LIST,
  TokenType.LIST_ITEM_TEXT,
  TokenType.TASK_CHECKED,
  TokenType.TASK_UNCHECKED,
];

/**
 * Every {@link TokenType} that participates in table structures, from pipes
 * and separators to header and body cells.
 */
export const TABLE_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.TABLE_PIPE,
  TokenType.TABLE_HYPHEN,
  TokenType.TABLE_COLON,
  TokenType.TABLE_HEADER_CELL,
  TokenType.TABLE_ROW_CELL,
  TokenType.TABLE_NEWLINE,
];

/**
 * Every {@link TokenType} that represents inline formatting, including bold,
 * italic, strikethrough, inline code, links, and images.
 */
export const INLINE_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.BOLD_OPEN,
  TokenType.BOLD_CLOSE,
  TokenType.ITALIC_OPEN,
  TokenType.ITALIC_CLOSE,
  TokenType.STRIKETHROUGH_OPEN,
  TokenType.STRIKETHROUGH_CLOSE,
  TokenType.CODE_INLINE,
  TokenType.LINK_OPEN,
  TokenType.LINK_TEXT,
  TokenType.LINK_SEPARATOR,
  TokenType.LINK_URL,
  TokenType.LINK_TITLE,
  TokenType.LINK_CLOSE,
  TokenType.IMAGE_OPEN,
  TokenType.IMAGE_ALT,
  TokenType.IMAGE_SEPARATOR,
];

/**
 * Every {@link TokenType} that represents a code construct, including block
 * fences, language identifiers, code content, inline code, and metadata.
 */
export const CODE_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.CODE_FENCE_BACKTICK,
  TokenType.CODE_FENCE_TILDE,
  TokenType.CODE_LANGUAGE,
  TokenType.CODE_CONTENT,
  TokenType.CODE_METADATA,
  TokenType.CODE_INLINE,
];

/**
 * Every {@link TokenType} that represents whitespace or structural separation,
 * such as newlines, indentation, and runs of spaces or tabs.
 */
export const WHITESPACE_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.NEWLINE,
  TokenType.INDENT,
  TokenType.DEDENT,
  TokenType.WHITESPACE,
];

/**
 * Every {@link TokenType} that participates in front matter parsing.
 */
export const FRONTMATTER_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.FRONTMATTER_SEPARATOR,
];

/**
 * Every {@link TokenType} that participates in YAML key/value parsing.
 */
export const YAML_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.YAML_KEY,
  TokenType.YAML_VALUE,
  TokenType.YAML_SEPARATOR,
  TokenType.YAML_LIST_ITEM,
];

/**
 * Every {@link TokenType} that represents a block-level element marker, such
 * as blockquotes, horizontal rules, and paragraph breaks.
 */
export const BLOCK_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.BLOCKQUOTE,
  TokenType.HORIZONTAL_RULE,
  TokenType.PARAGRAPH_BREAK,
];

// ============================================================================
// Token predicates
// ============================================================================

/**
 * Check whether a token type represents a heading construct.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a heading marker or heading text.
 */
export function isHeadingTokenType(type: TokenType): boolean {
  return HEADING_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents a list construct.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a list marker, list text, or task token.
 */
export function isListTokenType(type: TokenType): boolean {
  return LIST_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents a table construct.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` participates in table parsing.
 */
export function isTableTokenType(type: TokenType): boolean {
  return TABLE_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents inline formatting.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is an inline formatting or inline code token.
 */
export function isInlineTokenType(type: TokenType): boolean {
  return INLINE_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents a code construct.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a fence, language, content, or inline code token.
 */
export function isCodeTokenType(type: TokenType): boolean {
  return CODE_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents whitespace or structural separation.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a newline, indent, dedent, or whitespace token.
 */
export function isWhitespaceTokenType(type: TokenType): boolean {
  return WHITESPACE_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type is the plain text token.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is `TokenType.TEXT`.
 */
export function isTextTokenType(type: TokenType): boolean {
  return type === TokenType.TEXT;
}

/**
 * Check whether a token type participates in front matter parsing.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is the front matter separator.
 */
export function isFrontMatterTokenType(type: TokenType): boolean {
  return FRONTMATTER_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type participates in YAML key/value parsing.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a YAML key, value, separator, or list item.
 */
export function isYamlTokenType(type: TokenType): boolean {
  return YAML_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a token type represents a block-level element marker.
 *
 * @param type - The token type to test.
 * @returns `true` when `type` is a blockquote, horizontal rule, or paragraph break.
 */
export function isBlockTokenType(type: TokenType): boolean {
  return BLOCK_TOKEN_TYPES.includes(type);
}

/**
 * Check whether a {@link Token} represents a heading construct.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a heading marker or heading text.
 */
export function isHeadingToken(token: Token): boolean {
  return isHeadingTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents a list construct.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a list marker, list text, or task token.
 */
export function isListToken(token: Token): boolean {
  return isListTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents a table construct.
 *
 * @param token - The token to test.
 * @returns `true` when the token participates in table parsing.
 */
export function isTableToken(token: Token): boolean {
  return isTableTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents inline formatting.
 *
 * @param token - The token to test.
 * @returns `true` when the token is inline formatting or inline code.
 */
export function isInlineToken(token: Token): boolean {
  return isInlineTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents a code construct.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a fence, language, content, or inline code token.
 */
export function isCodeToken(token: Token): boolean {
  return isCodeTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents whitespace or structural separation.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a newline, indent, dedent, or whitespace token.
 */
export function isWhitespaceToken(token: Token): boolean {
  return isWhitespaceTokenType(token.type);
}

/**
 * Check whether a {@link Token} is the plain text token.
 *
 * @param token - The token to test.
 * @returns `true` when the token type is `TokenType.TEXT`.
 */
export function isTextToken(token: Token): boolean {
  return isTextTokenType(token.type);
}

/**
 * Check whether a {@link Token} participates in front matter parsing.
 *
 * @param token - The token to test.
 * @returns `true` when the token is the front matter separator.
 */
export function isFrontMatterToken(token: Token): boolean {
  return isFrontMatterTokenType(token.type);
}

/**
 * Check whether a {@link Token} participates in YAML key/value parsing.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a YAML key, value, separator, or list item.
 */
export function isYamlToken(token: Token): boolean {
  return isYamlTokenType(token.type);
}

/**
 * Check whether a {@link Token} represents a block-level element marker.
 *
 * @param token - The token to test.
 * @returns `true` when the token is a blockquote, horizontal rule, or paragraph break.
 */
export function isBlockToken(token: Token): boolean {
  return isBlockTokenType(token.type);
}

// ============================================================================
// Token classification and labels
// ============================================================================

/**
 * Return the {@link TokenTypeCategory} of a given {@link Token}.
 *
 * This is a convenience wrapper around `tokenTypeCategory` that accepts a
 * whole token rather than just its type.
 *
 * @param token - The token to classify.
 * @returns The category the token belongs to.
 */
export function classifyToken(token: Token): TokenTypeCategory {
  return tokenTypeCategory(token.type);
}

/**
 * A short human-readable label for each {@link TokenType}.
 *
 * Used by {@link tokenLabel}, debugging output, and the visual stream printer
 * {@link printTokenStream}.
 */
export const TOKEN_LABELS: Record<TokenType, string> = {
  [TokenType.EOF]: 'end of input',
  [TokenType.ERROR]: 'error',
  [TokenType.FRONTMATTER_SEPARATOR]: 'front matter separator',
  [TokenType.HEADING_1]: 'heading 1',
  [TokenType.HEADING_2]: 'heading 2',
  [TokenType.HEADING_3]: 'heading 3',
  [TokenType.HEADING_4]: 'heading 4',
  [TokenType.HEADING_5]: 'heading 5',
  [TokenType.HEADING_6]: 'heading 6',
  [TokenType.HEADING_TEXT]: 'heading text',
  [TokenType.CODE_FENCE_BACKTICK]: 'backtick code fence',
  [TokenType.CODE_FENCE_TILDE]: 'tilde code fence',
  [TokenType.CODE_LANGUAGE]: 'code language',
  [TokenType.CODE_CONTENT]: 'code content',
  [TokenType.CODE_METADATA]: 'code metadata',
  [TokenType.BULLET_LIST]: 'bullet list',
  [TokenType.NUMBERED_LIST]: 'numbered list',
  [TokenType.LIST_ITEM_TEXT]: 'list item text',
  [TokenType.TASK_CHECKED]: 'checked task',
  [TokenType.TASK_UNCHECKED]: 'unchecked task',
  [TokenType.TABLE_PIPE]: 'table pipe',
  [TokenType.TABLE_HYPHEN]: 'table separator',
  [TokenType.TABLE_COLON]: 'table alignment colon',
  [TokenType.TABLE_HEADER_CELL]: 'table header cell',
  [TokenType.TABLE_ROW_CELL]: 'table row cell',
  [TokenType.TABLE_NEWLINE]: 'table newline',
  [TokenType.BOLD_OPEN]: 'bold open',
  [TokenType.BOLD_CLOSE]: 'bold close',
  [TokenType.ITALIC_OPEN]: 'italic open',
  [TokenType.ITALIC_CLOSE]: 'italic close',
  [TokenType.STRIKETHROUGH_OPEN]: 'strikethrough open',
  [TokenType.STRIKETHROUGH_CLOSE]: 'strikethrough close',
  [TokenType.CODE_INLINE]: 'inline code',
  [TokenType.LINK_OPEN]: 'link open',
  [TokenType.LINK_TEXT]: 'link text',
  [TokenType.LINK_SEPARATOR]: 'link separator',
  [TokenType.LINK_URL]: 'link url',
  [TokenType.LINK_TITLE]: 'link title',
  [TokenType.LINK_CLOSE]: 'link close',
  [TokenType.IMAGE_OPEN]: 'image open',
  [TokenType.IMAGE_ALT]: 'image alt text',
  [TokenType.IMAGE_SEPARATOR]: 'image separator',
  [TokenType.BLOCKQUOTE]: 'blockquote',
  [TokenType.HORIZONTAL_RULE]: 'horizontal rule',
  [TokenType.PARAGRAPH_BREAK]: 'paragraph break',
  [TokenType.YAML_KEY]: 'yaml key',
  [TokenType.YAML_VALUE]: 'yaml value',
  [TokenType.YAML_SEPARATOR]: 'yaml separator',
  [TokenType.YAML_LIST_ITEM]: 'yaml list item',
  [TokenType.NEWLINE]: 'newline',
  [TokenType.INDENT]: 'indent',
  [TokenType.DEDENT]: 'dedent',
  [TokenType.WHITESPACE]: 'whitespace',
  [TokenType.TEXT]: 'text',
};

/**
 * Return a short human-readable label for a {@link TokenType}.
 *
 * The label is suitable for debugging output, log messages, and editor
 * diagnostics. Every type in the enum maps to a label; there is no fallback
 * path because the record is exhaustive.
 *
 * @param type - The token type to describe.
 * @returns A short, lowercase, human-readable description of the type.
 */
export function tokenLabel(type: TokenType): string {
  return TOKEN_LABELS[type];
}

// ============================================================================
// Token constructors
// ============================================================================

/**
 * Create a synthetic end-of-input {@link Token}.
 *
 * The EOF token terminates token streams and carries the position one past
 * the final character of input so that consumers can detect trailing space.
 *
 * @param line - One-based line number of the position past the final character.
 * @param column - Zero-based column number of the position past the final character.
 * @param offset - Zero-based character offset past the final character.
 * @returns A token whose type is `TokenType.EOF` with an empty value.
 */
export function createEofToken(line: number, column: number, offset: number): Token {
  return createToken(TokenType.EOF, '', line, column, offset);
}

/**
 * Create a synthetic error {@link Token}.
 *
 * The error token marks a position in the stream where lexical analysis
 * failed. The `value` field carries the diagnostic message so downstream
 * consumers can recover and continue processing.
 *
 * @param message - The diagnostic message describing the failure.
 * @param line - One-based line number where the failure occurred.
 * @param column - Zero-based column number where the failure occurred.
 * @param offset - Zero-based character offset where the failure occurred.
 * @returns A token whose type is `TokenType.ERROR` with the message as value.
 */
export function createErrorToken(
  message: string,
  line: number,
  column: number,
  offset: number
): Token {
  return createToken(TokenType.ERROR, message, line, column, offset);
}

// ============================================================================
// Token membership tests
// ============================================================================

/**
 * Type guard that narrows a {@link Token} to a token of a specific type.
 *
 * When the guard passes, the narrowed type is `Token & { type: T }`, which
 * allows callers to access metadata fields without additional assertions.
 *
 * @param token - The token to test.
 * @param type - The exact `TokenType` to match.
 * @returns `true` when `token.type === type`.
 */
export function isTokenOfType<T extends TokenType>(token: Token, type: T): token is Token & { type: T } {
  return token.type === type;
}

/**
 * Check whether a {@link Token} type is one of a set of token types.
 *
 * @param token - The token to test.
 * @param types - The set of token types to match against.
 * @returns `true` when `token.type` is contained in `types`.
 */
export function isTokenIn(token: Token, types: readonly TokenType[]): boolean {
  return types.includes(token.type);
}

// ============================================================================
// Language helpers
// ============================================================================

/**
 * Canonical names for common language aliases.
 *
 * The keys are lowercased aliases and the values are the canonical language
 * names used by {@link languageNormalize} and the code block parser.
 */
export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
};

/**
 * Normalize a language identifier to its canonical lowercase name.
 *
 * The input is trimmed, lowercased, and then resolved through
 * {@link LANGUAGE_ALIASES}. Unknown languages are returned lowercased and
 * trimmed unchanged so that callers can still record them verbatim.
 *
 * @param language - The raw language identifier, for example `'Py'` or `'JS'`.
 * @returns The canonical lowercase language name.
 */
export function languageNormalize(language: string): string {
  const key = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

/**
 * Human-readable display names for known canonical languages.
 */
const LANGUAGE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  rust: 'Rust',
  go: 'Go',
  shell: 'Shell',
  yaml: 'YAML',
  json: 'JSON',
  mermaid: 'Mermaid',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  ruby: 'Ruby',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  perl: 'Perl',
  toml: 'TOML',
  xml: 'XML',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
};

/**
 * Return a human-readable display name for a language identifier.
 *
 * Aliases are normalized first, so `'ts'`, `'TS'`, and `'TypeScript'` all
 * resolve to `'TypeScript'`. Unknown languages are rendered in title case.
 *
 * @param language - The raw language identifier.
 * @returns A display name suitable for UI and documentation output.
 */
export function getLanguageDisplayName(language: string): string {
  const normalized = languageNormalize(language);
  const known = LANGUAGE_DISPLAY_NAMES[normalized];
  if (known) {
    return known;
  }
  if (normalized.length === 0) {
    return normalized;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ============================================================================
// Code metadata parsing
// ============================================================================

/**
 * Parse MAM code metadata directives from a line of code.
 *
 * MAM metadata comments use the shape `@mam:key=value`. An optional leading
 * `# ` (hash comment prefix) is tolerated so both raw and commented metadata
 * lines are accepted. Multiple directives on a single line are supported, and
 * a duplicate key overrides the earlier value.
 *
 * @param line - The raw line of code text to scan.
 * @returns A record of metadata key/value pairs. An empty record is returned
 *   when the line contains no directives.
 */
export function parseCodeMetadata(line: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const marker = '@mam:';
  let searchFrom = 0;
  while (true) {
    const start = line.indexOf(marker, searchFrom);
    if (start === -1) {
      break;
    }
    const afterMarker = start + marker.length;
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*/.exec(line.slice(afterMarker));
    if (!keyMatch) {
      searchFrom = afterMarker;
      continue;
    }
    const key = keyMatch[1]!;
    const valueStart = afterMarker + keyMatch[0].length;
    const nextMarker = line.indexOf(marker, valueStart);
    const valueEnd = nextMarker === -1 ? line.length : nextMarker;
    metadata[key] = line.slice(valueStart, valueEnd).trim();
    searchFrom = valueEnd;
  }
  return metadata;
}

// ============================================================================
// Section helpers
// ============================================================================

/**
 * The standard MAM section names as an ordered array.
 *
 * This is the array form of {@link STANDARD_SECTIONS}. It is derived from the
 * set so the two always stay in sync, and it is used by {@link sectionIndex}.
 */
export const STANDARD_SECTION_LIST: readonly string[] = Array.from(STANDARD_SECTIONS);

/**
 * Check whether a section name is a custom (non-standard) section.
 *
 * A custom section is any name that is not present in {@link STANDARD_SECTIONS}.
 * The check is case-sensitive and matches the exact spelling used by the set.
 *
 * @param name - The section name to test.
 * @returns `true` when the name is not a standard MAM section.
 */
export function isCustomSection(name: string): boolean {
  return !isSectionNameValid(name);
}

/**
 * Return the index of a section name within the standard section list.
 *
 * @param name - The section name to look up.
 * @returns The zero-based index in {@link STANDARD_SECTION_LIST}, or `-1` when
 *   the name is not a standard section.
 */
export function sectionIndex(name: string): number {
  return STANDARD_SECTION_LIST.indexOf(name);
}

// ============================================================================
// Token stream summaries and printing
// ============================================================================

/**
 * An aggregate summary of a token stream.
 *
 * Produced by {@link tokenSummary}, this object lets callers quickly gauge the
 * shape of a document without iterating the token array themselves.
 */
export interface TokenSummary {
  /** The total number of tokens in the stream. */
  total: number;
  /** Tally of tokens grouped by {@link TokenType}. */
  byType: Record<TokenType, number>;
  /** Tally of tokens grouped by {@link TokenTypeCategory}. */
  byCategory: Record<TokenTypeCategory, number>;
  /** The number of distinct token types present in the stream. */
  distinctTypes: number;
}

/**
 * Summarize a token stream by type and category.
 *
 * Every known type and category key is present in the returned records
 * initialized to `0`, so callers can index into them without `undefined`
 * checks.
 *
 * @param tokens - The token stream to summarize.
 * @returns A {@link TokenSummary} with counts by type and category.
 */
export function tokenSummary(tokens: readonly Token[]): TokenSummary {
  const byType = {} as Record<TokenType, number>;
  const byCategory = {} as Record<TokenTypeCategory, number>;
  for (const type of Object.values(TokenType)) {
    byType[type] = 0;
  }
  for (const category of TOKEN_TYPE_CATEGORY_NAMES) {
    byCategory[category] = 0;
  }
  for (const token of tokens) {
    byType[token.type] = (byType[token.type] ?? 0) + 1;
    byCategory[tokenTypeCategory(token.type)] =
      (byCategory[tokenTypeCategory(token.type)] ?? 0) + 1;
  }
  const distinctTypes = Object.values(byType).filter((count) => count > 0).length;
  return { total: tokens.length, byType, byCategory, distinctTypes };
}

/**
 * All category names in a fixed order, used to initialize summary records.
 */
const TOKEN_TYPE_CATEGORY_NAMES: readonly TokenTypeCategory[] = [
  'special',
  'frontmatter',
  'heading',
  'code',
  'list',
  'table',
  'inline',
  'block',
  'yaml',
  'whitespace',
  'text',
];

/**
 * Render a token stream as a fixed-width, human-readable table.
 *
 * Each line shows the token index, type, source position, and a truncated
 * representation of the token value. This is intended for debugging and for
 * lexer visualization tools.
 *
 * @param tokens - The token stream to render.
 * @returns A multi-line string, one row per token, with a trailing newline.
 */
export function printTokenStream(tokens: readonly Token[]): string {
  const header = `${'#'.padEnd(5)} ${'type'.padEnd(28)} ${'pos'.padEnd(12)} value`;
  const rows = tokens.map((token, index) => {
    const type = token.type.padEnd(28);
    const pos = `${token.line}:${token.column}`.padEnd(12);
    const value = token.value.length > 40 ? `${token.value.slice(0, 37)}...` : token.value;
    return `${String(index).padEnd(5)} ${type} ${pos} ${JSON.stringify(value)}`;
  });
  return [header, ...rows].join('\n') + '\n';
}