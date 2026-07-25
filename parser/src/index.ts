/**
 * MAM Parser
 * 
 * Complete parser for Markdown as Module (MAM) documents.
 * Provides lexing, parsing, and AST generation capabilities.
 */

// ============================================================================
// Lexer Exports
// ============================================================================

export {
  Tokenizer,
  tokenize,
  type TokenizerOptions,
  type TokenizeResult,
  type TokenizerStats,
  TokenType,
  type Token,
  type TokenMetadata,
  createToken,
  VALID_LANGUAGES,
  STANDARD_SECTIONS,
  LexerError,
  LexerWarning,
  LexerErrorCode,
  LexerWarningCode,
} from './lexer/index.js';

// ============================================================================
// Parser Exports
// ============================================================================

export {
  MAMParser,
  parse,
  parseMarkdown,
  type ParserOptions,
  type ParseResult,
  type ParserStats,
  type MAMModule,
  type FrontMatter,
  type Section,
  type SectionAttributes,
  type ModuleMetadata,
  parseFrontMatter,
  type FrontMatterData,
  type FrontMatterResult,
  parseSections,
  type SectionData,
  type ContentNode,
  type ParagraphNode,
  type ListNode,
  type CodeBlockNode,
  type TableNode,
  type MermaidNode,
  type HeadingNode,
  type BlockquoteNode,
  type HorizontalRuleNode,
  type InlineNode,
  type SourceLocation,
  type SectionParseResult,
  ParseError,
  ParseErrorCode,
  ParseWarning,
  ParseWarningCode,
} from './parser/index.js';

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse a MAM document from raw Markdown text
 * 
 * @param input - Raw Markdown text
 * @param options - Parser options
 * @returns Parse result with AST, errors, and warnings
 * 
 * @example
 * ```typescript
 * import { parseMAM } from '@mam/parser';
 * 
 * const mamContent = `---
 * id: auth
 * version: 1.0.0
 * name: Authentication
 * author: LifeJiggy
 * runtime: python
 * ---
 * 
 * ## Purpose
 * 
 * Authenticate users securely.
 * `;
 * 
 * const result = parseMAM(mamContent);
 * console.log(result.ast.frontmatter?.data.id); // "auth"
 * ```
 */
export function parseMAM(
  input: string,
  options?: {
    source?: string;
    maxDepth?: number;
    strict?: boolean;
    allowUnknownSections?: boolean;
    trackInline?: boolean;
  }
): {
  ast: import('./parser/mam.js').MAMModule;
  errors: (import('./parser/errors.js').ParseError | import('./lexer/errors.js').LexerError)[];
  warnings: (import('./parser/errors.js').ParseWarning | import('./lexer/errors.js').LexerWarning)[];
  stats: import('./parser/mam.js').ParserStats & import('./lexer/tokenizer.js').TokenizerStats;
} {
  // Step 1: Tokenize
  const tokenizeResult = tokenize(input, {
    source: options?.source,
    maxDepth: options?.maxDepth,
    strict: options?.strict,
    trackInline: options?.trackInline,
  });

  // Step 2: Parse tokens
  const parseResult = parse(tokenizeResult.tokens, {
    source: options?.source,
    maxDepth: options?.maxDepth,
    strict: options?.strict,
    allowUnknownSections: options?.allowUnknownSections,
  });

  return {
    ast: parseResult.ast,
    errors: [...tokenizeResult.errors, ...parseResult.errors],
    warnings: [...tokenizeResult.warnings, ...parseResult.warnings],
    stats: {
      ...tokenizeResult.stats,
      ...parseResult.stats,
    },
  };
}