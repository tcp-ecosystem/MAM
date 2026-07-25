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