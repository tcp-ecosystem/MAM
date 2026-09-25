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
  DiffChangeType,
} from './mam.js';
export { DEFAULT_SDK_CONFIG, loadSDKConfig, saveSDKConfig, validateSDKConfig, mergeSDKConfigs, resolveSDKConfigPath } from './config.js';
export type { SDKConfig } from './config.js';
export { ResultCache, createResultCache, DEFAULT_CACHE_TTL, hashCacheKey, formatCacheStats, isValidCacheKey } from './cache.js';
export type { CacheEntry, CacheStats } from './cache.js';
export { formatModuleSummary, formatModuleJSON, formatSectionList, formatValidationReport, formatExecutionResults, formatCodeBlockList, formatFrontMatter } from './format.js';
export { buildDepGraph, topoSortDepGraph, getDepNodeNames, summarizeDepGraph, getDepSuccessors, getDepPredecessors, hasDepEdge, getDepEdgeLabels } from './graph.js';
export type { DepNode, DepEdge, DepGraph } from './graph.js';
export { STARTER_KINDS, listStarterKinds, getStarterTemplate, renderStarter, starterVariables, newModuleStarter, validateStarterName } from './template.js';
