/**
 * MAM JavaScript SDK
 *
 * Barrel exports for the complete SDK.
 */

// Parser
export { parseMAM } from './parser.js';
export type {
  AST,
  FrontMatter,
  Section,
  ContentNode,
  ContentNodeType,
  SectionType,
  CodeBlock,
  SourceLocation,
  Position,
  ParseResult,
  ParseError,
  ParseWarning,
  ParseOptions,
  ParserStats,
  ParseErrorCode,
  ParseWarningCode,
  ModuleMetadata,
} from './parser.js';

// Validator
export { validate, validateContent } from './validator.js';
export type {
  ValidationIssue,
  ValidationRule,
  ValidationSeverity,
  ValidationLevel,
  ValidationErrorCode,
  ValidatorConfig,
  SchemaValidationConfig,
} from './validator.js';

// Runtime
export { execute, createExecutionHistory } from './runtime.js';
export type {
  ExecutionResult,
  ExecutionConfig,
  ExecutionContext,
  ExecutionHistory,
  ExecutionHistoryEntry,
  ModuleExecutionResult,
  SupportedLanguage,
} from './runtime.js';

// Module builder
export { MAMModule, fromAST, fromMarkdown, diffModules, compareModules } from './mam.js';
export type {
  MAMModuleConfig,
  DiffChange,
  DiffResult,
  ModuleDiff,
} from './mam.js';
