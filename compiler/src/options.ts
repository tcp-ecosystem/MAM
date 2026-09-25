/**
 * MAM Compiler Options
 *
 * Defaults, normalization, validation, and target alias resolution
 * for CompilerConfig.
 */

import type { CompilerConfig, CompileTarget } from './compiler.js';

// ============================================================================
// Known Targets & Aliases
// ============================================================================

export const TARGET_ALIASES: Record<string, CompileTarget> = {
  py: 'python',
  python: 'python',
  js: 'javascript',
  javascript: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  openai: 'openai',
  langgraph: 'langgraph',
  crewai: 'crewai',
};

const KNOWN_TARGETS: readonly CompileTarget[] = [
  'python',
  'javascript',
  'go',
  'rust',
  'typescript',
  'json',
  'yaml',
  'openai',
  'langgraph',
  'crewai',
];

/** Resolve a target name (with alias support) to a canonical CompileTarget. */
export function resolveTarget(name: string): CompileTarget | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  const alias = TARGET_ALIASES[key];
  if (alias) return alias;
  if ((KNOWN_TARGETS as readonly string[]).includes(key)) return key as CompileTarget;
  return undefined;
}

// ============================================================================
// Defaults & Normalization
// ============================================================================

export function defaultCompilerConfig(): CompilerConfig {
  return {
    target: 'python',
    indent: 4,
    includeComments: false,
    includeMetadata: true,
    optimize: false,
  };
}

/** Fill in defaults for any missing config fields. */
export function normalizeCompilerConfig(config?: CompilerConfig): CompilerConfig {
  const defaults = defaultCompilerConfig();
  return {
    target: config?.target ?? defaults.target,
    indent: config?.indent ?? defaults.indent,
    includeComments: config?.includeComments ?? defaults.includeComments,
    includeMetadata: config?.includeMetadata ?? defaults.includeMetadata,
    optimize: config?.optimize ?? defaults.optimize,
  };
}

// ============================================================================
// Validation
// ============================================================================

/** Return a list of validation errors (empty when the config is valid). */
export function validateCompilerConfig(config: CompilerConfig): string[] {
  const errors: string[] = [];

  if (!resolveTarget(config.target)) {
    errors.push(
      `Unknown target: '${config.target}'. Known targets: ${KNOWN_TARGETS.join(', ')}`,
    );
  }

  if (config.indent !== undefined) {
    if (!Number.isInteger(config.indent) || config.indent < 1 || config.indent > 16) {
      errors.push(`indent must be an integer between 1 and 16, got: ${config.indent}`);
    }
  }

  return errors;
}