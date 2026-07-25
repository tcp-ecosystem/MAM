/**
 * MAM Lexer Module
 * 
 * Exports the tokenizer and related types for lexical analysis of MAM documents.
 */

export {
  Tokenizer,
  tokenize,
  type TokenizerOptions,
  type TokenizeResult,
  type TokenizerStats,
} from './tokenizer.js';

export {
  TokenType,
  type Token,
  type TokenMetadata,
  createToken,
  VALID_LANGUAGES,
  STANDARD_SECTIONS,
} from './tokens.js';

export {
  LexerError,
  LexerWarning,
  LexerErrorCode,
  LexerWarningCode,
} from './errors.js';