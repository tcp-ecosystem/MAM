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
  type ParserOptions,
  type ParseResult,
  type ParserStats,
  type MAMModule,
  type FrontMatter,
  type FrontMatterData,
  type Section,
  type SectionAttributes,
  type ContentNode,
  parseFrontMatter,
  type FrontMatterResult,
  parseSections,
  type SectionData,
  type InlineNode,
  type SourceLocation,
  type SectionParseResult,
  ParseError,
  ParseErrorCode,
  ParseWarning,
  ParseWarningCode,
  DSLParser,
  parseDSL,
  type DSLParserOptions,
  type DSLParseResult,
} from './parser/index.js';

// ============================================================================
// Convenience Functions
// ============================================================================

import { tokenize as _tokenize } from './lexer/index.js';
import { parse as _parse } from './parser/index.js';

/**
 * Parse a MAM document from raw Markdown text
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
  const tokenizeResult = _tokenize(input, {
    source: options?.source,
    maxDepth: options?.maxDepth,
    strict: options?.strict,
    trackInline: options?.trackInline,
  });

  // Step 2: Parse tokens
  const parseResult = _parse(tokenizeResult.tokens, {
    source: options?.source,
    maxDepth: options?.maxDepth,
    strict: options?.strict,
    allowUnknownSections: options?.allowUnknownSections,
    content: input,
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