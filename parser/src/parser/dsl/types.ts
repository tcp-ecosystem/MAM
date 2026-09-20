import { V2ModuleNode } from '@mam/ast';
import { ParseError, ParseWarning } from '../errors.js';

export interface DSLParserOptions {
  source?: string;
  strict?: boolean;
  allowUnknownTypes?: boolean;
}

export interface DSLParseResult {
  modules: V2ModuleNode[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

// ============================================================================
// DSL Token Types
// ============================================================================

export enum DSLTokenType {
  MODULE_DECL = 'MODULE_DECL',
  SECTION_KEY = 'SECTION_KEY',
  SECTION_VALUE = 'SECTION_VALUE',
  LIST_ITEM = 'LIST_ITEM',
  EDGE = 'EDGE',
  COMMENT = 'COMMENT',
  ANNOTATION = 'ANNOTATION',
  METADATA = 'METADATA',
  BLOCK_START = 'BLOCK_START',
  BLOCK_END = 'BLOCK_END',
  EOF = 'EOF',
}

// ============================================================================
// DSL Node Types
// ============================================================================

export enum DSLNodeType {
  MODULE = 'MODULE',
  SECTION = 'SECTION',
  LIST = 'LIST',
  EDGE = 'EDGE',
  ANNOTATION = 'ANNOTATION',
  METADATA = 'METADATA',
  COMMENT = 'COMMENT',
  BLOCK = 'BLOCK',
}

// ============================================================================
// DSL Section Types
// ============================================================================

export enum DSLSectionType {
  TYPE = 'type',
  ROLE = 'role',
  GOAL = 'goal',
  DESCRIPTION = 'description',
  PROVIDER = 'provider',
  FORMAT = 'format',
  BACKEND = 'backend',
  SCOPE = 'scope',
  TTL = 'ttl',
  MEMORY = 'memory',
  REQUIRES = 'requires',
  INPUTS = 'inputs',
  OUTPUTS = 'outputs',
  TOOLS = 'tools',
  MEMBERS = 'members',
  HANDOFF = 'handoff',
  ALLOW = 'allow',
  DENY = 'deny',
  PERMISSIONS = 'permissions',
  STEPS = 'steps',
  EDGES = 'edges',
  CAPABILITIES = 'capabilities',
  EVENTS = 'events',
  STATE = 'state',
  LIFECYCLE = 'lifecycle',
  DOCUMENTATION = 'documentation',
  RULES = 'rules',
  PROMPTS = 'prompts',
  TESTS = 'tests',
  EXAMPLES = 'examples',
}

// ============================================================================
// DSL Validation Result
// ============================================================================

export interface DSLValidationResult {
  valid: boolean;
  errors: DSLError[];
  warnings: DSLWarning[];
}

// ============================================================================
// DSL Error
// ============================================================================

export interface DSLError {
  code: string;
  message: string;
  line: number;
  column: number;
  source: string;
  severity: 'error' | 'warning';
  expected?: string[];
  found?: string;
  context?: string;
}

// ============================================================================
// DSL Warning
// ============================================================================

export interface DSLWarning {
  code: string;
  message: string;
  line: number;
  column: number;
  source: string;
}

// ============================================================================
// DSL Export Options
// ============================================================================

export interface DSLExportOptions {
  format: 'mam' | 'yaml' | 'json';
  includeMetadata: boolean;
  prettyPrint: boolean;
  indent: number;
  includeComments: boolean;
  includeSourceMaps: boolean;
}

// ============================================================================
// DSL Import Options
// ============================================================================

export interface DSLImportOptions {
  strict: boolean;
  allowUnknown: boolean;
  source: string;
  encoding: string;
  preserveComments: boolean;
  resolveReferences: boolean;
}

// ============================================================================
// DSL Metadata
// ============================================================================

export interface DSLMetadata {
  source: string;
  parseTime: number;
  moduleCount: number;
  sectionCount: number;
  edgeCount: number;
  errorCount: number;
  warningCount: number;
  tokenCount: number;
  lineCount: number;
  version: string;
  encoding: string;
}

// ============================================================================
// DSL Parse Stats
// ============================================================================

export interface DSLParseStats {
  tokensProcessed: number;
  modulesParsed: number;
  sectionsParsed: number;
  edgesParsed: number;
  errorsFound: number;
  warningsFound: number;
  durationMs: number;
  startTime: number;
  endTime: number;
  averageModuleTime: number;
  peakMemoryUsage: number;
}

// ============================================================================
// DSL Module Summary
// ============================================================================

export interface DSLModuleSummary {
  name: string;
  type: string;
  sections: string[];
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  edgeCount: number;
  lineCount: number;
  hasDocumentation: boolean;
  hasTests: boolean;
}

// ============================================================================
// DSL Document Info
// ============================================================================

export interface DSLDocumentInfo {
  format: string;
  version: string;
  encoding: string;
  lineCount: number;
  moduleCount: number;
  hasFrontmatter: boolean;
  hasMetadata: boolean;
  parseDuration: number;
}

// ============================================================================
// DSL Syntax Version
// ============================================================================

export type DSLSyntaxVersion = 'V1' | 'V2' | 'AUTO';

// ============================================================================
// DSL Parser Config
// ============================================================================

export interface DSLParserConfig {
  source?: string;
  strict: boolean;
  allowUnknownTypes: boolean;
  syntaxVersion: DSLSyntaxVersion;
  maxDepth: number;
  maxModules: number;
  maxSections: number;
  enableComments: boolean;
  enableAnnotations: boolean;
  enableMetadata: boolean;
  preserveWhitespace: boolean;
  trackLocations: boolean;
  errorRecovery: boolean;
  maxErrors: number;
  maxWarnings: number;
}

// ============================================================================
// DSL Token Info
// ============================================================================

export interface DSLTokenInfo {
  type: DSLTokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
  length: number;
  raw: string;
}

// ============================================================================
// DSL Parse Context
// ============================================================================

export interface DSLParseContext {
  currentModule: V2ModuleNode | null;
  currentSection: string | null;
  inBlock: boolean;
  blockDepth: number;
  lineCount: number;
  errorCount: number;
  warningCount: number;
}

// ============================================================================
// DSL Serializer Options
// ============================================================================

export interface DSLSerializerOptions {
  indent: number;
  includeSource: boolean;
  includeMetadata: boolean;
  sortKeys: boolean;
  compact: boolean;
}

// ============================================================================
// DSL Deserializer Options
// ============================================================================

export interface DSLDeserializerOptions {
  strict: boolean;
  allowUnknown: boolean;
  resolveReferences: boolean;
  validateTypes: boolean;
  defaultLanguage: string;
}

// ============================================================================
// DSL Plugin Interface
// ============================================================================

export interface DSLPlugin {
  name: string;
  version: string;
  beforeParse?(input: string): string;
  afterParse?(result: DSLParseResult): DSLParseResult;
  onModule?(module: V2ModuleNode): V2ModuleNode;
  onError?(error: DSLError): DSLError | null;
}

// ============================================================================
// DSL Event Types
// ============================================================================

export type DSLParseEvent =
  | { type: 'start'; timestamp: number }
  | { type: 'module_found'; name: string; line: number }
  | { type: 'section_found'; name: string; line: number }
  | { type: 'edge_found'; source: string; target: string; line: number }
  | { type: 'error'; error: DSLError }
  | { type: 'warning'; warning: DSLWarning }
  | { type: 'complete'; stats: DSLParseStats }
  | { type: 'module_complete'; name: string; duration: number };

// ============================================================================
// DSL Formatter Options
// ============================================================================

export interface DSLFormatterOptions {
  indent: number;
  lineWidth: number;
  trailingCommas: boolean;
  semicolons: boolean;
  quoteStyle: 'single' | 'double';
  sortKeys: boolean;
  includeComments: boolean;
}

// ============================================================================
// DSL Lint Rule
// ============================================================================

export interface DSLLintRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
  options?: Record<string, unknown>;
}

// ============================================================================
// DSL Lint Result
// ============================================================================

export interface DSLLintResult {
  file: string;
  errors: DSLLintError[];
  warnings: DSLLintWarning[];
  info: DSLLintInfo[];
  fixable: number;
  total: number;
}

export interface DSLLintError {
  rule: string;
  message: string;
  line: number;
  column: number;
  fix?: DSLLintFix;
}

export interface DSLLintWarning {
  rule: string;
  message: string;
  line: number;
  column: number;
  fix?: DSLLintFix;
}

export interface DSLLintInfo {
  rule: string;
  message: string;
  line: number;
  column: number;
}

export interface DSLLintFix {
  range: [number, number];
  text: string;
}

// ============================================================================
// DSL Completion Provider
// ============================================================================

export interface DSLCompletionItem {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insertText: string;
  sortOrder: number;
  deprecated?: boolean;
}

// ============================================================================
// DSL Hover Provider
// ============================================================================

export interface DSLHoverResult {
  contents: string;
  range?: { start: number; end: number };
}

// ============================================================================
// DSL Definition Provider
// ============================================================================

export interface DSLDefinitionResult {
  file: string;
  line: number;
  column: number;
  range: { start: number; end: number };
}

// ============================================================================
// DSL Reference Provider
// ============================================================================

export interface DSLReferenceResult {
  file: string;
  line: number;
  column: number;
  context: string;
}

// ============================================================================
// DSL Document Symbol
// ============================================================================

export interface DSLDocumentSymbol {
  name: string;
  kind: string;
  range: { start: number; end: number };
  children?: DSLDocumentSymbol[];
}

// ============================================================================
// DSL Workspace Edit
// ============================================================================

export interface DSLWorkspaceEdit {
  changes: Record<string, Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>>;
}
