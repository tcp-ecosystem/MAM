/**
 * MAM Reference Implementation — Shared Types
 *
 * Central type definitions used across the CLI, compiler, package manager,
 * and registry subsystems.
 */

import type { CompileTarget } from '@mam/compiler';
import type { CompileResult, CompileStats } from '@mam/compiler';
import type { SemanticResult, SemanticError, SemanticWarning } from '@mam/compiler';
import type { ValidationError, ValidationWarning, ValidationReport } from '@mam/validator';

// ============================================================================
// CLI Types
// ============================================================================

export type OutputFormat = 'text' | 'json' | 'yaml';

export interface CLIOptions {
  verbose?: boolean;
  quiet?: boolean;
  format?: OutputFormat;
  color?: boolean;
  config?: string;
}

export interface CLIContext {
  cwd: string;
  options: CLIOptions;
  startTime: number;
}

// ============================================================================
// Config Types
// ============================================================================

export interface MAMConfig {
  /** Config schema version */
  version: string;
  /** Project metadata */
  project?: ProjectConfig;
  /** Build settings */
  build?: BuildConfig;
  /** Registry connection */
  registry?: RegistryConfig;
  /** Plugin configuration */
  plugins?: PluginConfig[];
  /** Target-specific overrides */
  targets?: Record<string, Partial<BuildConfig>>;
}

export interface ProjectConfig {
  /** Package name */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Package author */
  author?: string;
  /** SPDX license identifier */
  license?: string;
  /** Default runtime target */
  runtime?: string;
  /** Searchable tags */
  tags?: string[];
}

export interface BuildConfig {
  /** Default compilation target */
  target?: CompileTarget;
  /** Output directory */
  output?: string;
  /** Generate source maps */
  sourceMap?: boolean;
  /** Minify generated code */
  minify?: boolean;
  /** Enable optimisations */
  optimize?: boolean;
  /** Include comments in output */
  includeComments?: boolean;
  /** Indent size for generated code */
  indent?: number;
}

export interface RegistryConfig {
  /** Registry server URL */
  url?: string;
  /** Authentication token or path to credentials */
  auth?: string;
  /** Package scope (e.g. @myorg) */
  scope?: string;
}

export interface PluginConfig {
  /** Plugin name */
  name: string;
  /** Whether the plugin is enabled */
  enabled?: boolean;
  /** Plugin-specific options */
  options?: Record<string, unknown>;
}

// ============================================================================
// Build Types
// ============================================================================

export interface BuildOptions {
  /** Compilation target */
  target: CompileTarget;
  /** Output directory */
  outDir?: string;
  /** Validate before building */
  validate?: boolean;
  /** Run semantic analysis */
  analyze?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

export interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;
  /** Generated output path */
  output?: string;
  /** Compilation result from @mam/compiler */
  compileResult?: CompileResult;
  /** Validation result if validation was enabled */
  validationResult?: ValidationReport;
  /** Semantic analysis result if analysis was enabled */
  semanticResult?: SemanticResult;
  /** Fatal errors */
  errors: string[];
  /** Non-fatal warnings */
  warnings: string[];
  /** Build performance stats */
  stats: BuildStats;
}

export interface BuildStats {
  /** Total build time in milliseconds */
  timeMs: number;
  /** Input file size in bytes */
  inputSize: number;
  /** Output file size in bytes */
  outputSize: number;
  /** Number of MAM sections processed */
  sections: number;
  /** Number of code blocks found */
  codeBlocks: number;
  /** Number of dependency edges */
  edges: number;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationOptions {
  /** Validation level: syntax, structural, or semantic */
  level?: 'syntax' | 'structural' | 'semantic' | 'strict';
  /** Enable strict mode */
  strict?: boolean;
}

export interface ValidationDetail {
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Machine-readable error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** File path if applicable */
  path?: string;
  /** Line number if applicable */
  line?: number;
  /** Column number if applicable */
  column?: number;
}

// ============================================================================
// Graph Types
// ============================================================================

export interface GraphNode {
  /** Unique node identifier */
  id: string;
  /** Node type (module, agent, tool, etc.) */
  type: string;
  /** Display label */
  label: string;
}

export interface GraphEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Optional edge label */
  label?: string;
  /** Edge type classification */
  kind?: 'direct' | 'dependency' | 'handoff' | 'communication';
}

export interface Graph {
  /** Graph nodes */
  nodes: GraphNode[];
  /** Graph edges */
  edges: GraphEdge[];
  /** Graph metadata */
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  nodeCount: number;
  edgeCount: number;
  generatedAt?: string;
}

export interface GraphOptions {
  /** Output format */
  format?: 'mermaid' | 'ascii' | 'json';
  /** Graph direction (for mermaid) */
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Show node labels */
  showLabels?: boolean;
}

// ============================================================================
// Analysis Types
// ============================================================================

export interface AnalysisOptions {
  /** Run strict analysis */
  strict?: boolean;
  /** Allow undefined references */
  allowUndefinedRefs?: boolean;
  /** Maximum graph depth */
  maxGraphDepth?: number;
}

export interface AnalysisResult {
  /** Module information */
  modules: ModuleInfo[];
  /** Dependency information */
  dependencies: DependencyInfo[];
  /** Aggregate stats */
  stats: AnalysisStats;
  /** Semantic analysis result */
  semantic?: SemanticResult;
}

export interface ModuleInfo {
  /** Module name */
  name: string;
  /** Module type (agent, tool, memory, etc.) */
  type: string;
  /** Section headings found */
  sections: string[];
  /** Number of code blocks */
  codeBlocks: number;
  /** Module dependencies */
  dependencies: string[];
}

export interface DependencyInfo {
  /** Dependency name */
  name: string;
  /** Version constraint if any */
  version?: string;
  /** Source of the dependency (import, require, etc.) */
  source: string;
}

export interface AnalysisStats {
  /** Total modules found */
  totalModules: number;
  /** Total sections across all modules */
  totalSections: number;
  /** Total code blocks across all modules */
  totalCodeBlocks: number;
  /** Programming languages detected */
  languages: string[];
}

// ============================================================================
// Package Types
// ============================================================================

export interface PackageInitOptions {
  /** Package name */
  name?: string;
  /** Target directory */
  dir?: string;
  /** Package version */
  version?: string;
  /** Package description */
  description?: string;
  /** Package author */
  author?: string;
  /** Package license */
  license?: string;
}

export interface PackageManifest {
  /** Package name */
  name: string;
  /** Package version */
  version: string;
  /** Package description */
  description?: string;
  /** Package author */
  author?: string;
  /** Package license */
  license?: string;
  /** Runtime dependencies */
  dependencies: PackageDependency[];
  /** Dev dependencies */
  devDependencies: PackageDependency[];
}

export interface PackageDependency {
  /** Package name */
  name: string;
  /** Version constraint */
  version: string;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface RegistryPublishOptions {
  /** Package directory */
  dir?: string;
  /** Registry URL override */
  url?: string;
  /** Auth token override */
  token?: string;
  /** Dry run — validate but don't publish */
  dryRun?: boolean;
}

export interface RegistrySearchOptions {
  /** Search query */
  query: string;
  /** Limit results */
  limit?: number;
  /** Filter by tags */
  tags?: string[];
}

export interface RegistryPackageInfo {
  /** Package name */
  name: string;
  /** Latest version */
  version: string;
  /** Package description */
  description?: string;
  /** Package tags */
  tags?: string[];
  /** Download count */
  downloads?: number;
  /** Last publish time */
  publishedAt?: string;
}

// ============================================================================
// Target Helpers
// ============================================================================

export const TARGET_EXTENSIONS: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  go: 'go',
  rust: 'rs',
  json: 'json',
  yaml: 'yaml',
  openai: 'py',
  langgraph: 'py',
  crewai: 'py',
  csharp: 'cs',
  java: 'java',
  wasm: 'wasm',
  gemini: 'py',
  autogen: 'py',
  kubernetes: 'yaml',
  terraform: 'tf',
};

export const SUPPORTED_TARGETS = Object.keys(TARGET_EXTENSIONS);
