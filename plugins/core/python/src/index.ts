/**
 * MAM Python Plugin
 *
 * Provides Python execution for MAM modules: a subprocess runner that resolves
 * the interpreter at runtime, a static analyser plus a real syntax check via
 * the interpreter's own parser, and a rule family for build-time checks.
 *
 * The plugin is deliberately *not* a sandbox. It runs the host's Python in a
 * child process with a timeout and an output cap, and reports risky constructs
 * for review. Untrusted code needs an OS-level sandbox.
 */

import type { MAMPlugin, ValidationRule } from '@mam/plugin-api';
import {
  PYTHON_MANIFEST, pythonSection, PYTHON_SECTION_NAME, PYTHON_LIMITS, PYTHON_EXAMPLE,
} from './manifest.js';
import { PYTHON_RULES, pythonRule, type PythonSeverity } from './rule.js';
import { pythonContext, createPythonContext, type PythonContextOptions } from './context.js';
import {
  checkPythonAvailable, runPythonCode, runPythonExpression, parseExpressionResult,
  type PythonRunResult, type PythonRunOptions,
} from './runner.js';

// ─── Manifest ──────────────────────────────────────────────────────
export {
  PYTHON_MANIFEST,
  pythonSection,
  getPythonSection,
  createPythonManifest,
  validatePythonContent,
  PYTHON_SECTION_NAME,
  PYTHON_LANGUAGES,
  PYTHON_CONTENT_TYPES,
  PYTHON_LIMITS,
  PYTHON_EXAMPLE,
} from './manifest.js';
export type { PythonContentOptions } from './manifest.js';

// ─── Runner ────────────────────────────────────────────────────────
export {
  runPythonCode,
  runPythonFile,
  runPythonExpression,
  parseExpressionResult,
  checkPythonAvailable,
  resolveInterpreter,
  getCachedInterpreter,
  setInterpreter,
  resetInterpreterCache,
  getExecutionStats,
  resetExecutionStats,
} from './runner.js';
export type {
  PythonRunOptions,
  PythonRunResult,
  PythonInterpreter,
  PythonAvailability,
  PythonExecutionStats,
} from './runner.js';

// ─── Validator ─────────────────────────────────────────────────────
export {
  validatePythonCode,
  validatePythonCodeStatic,
  checkPythonSyntax,
  checkPythonSecurityPatterns,
  getPythonSecurityIssues,
  stripPythonComment,
  getEffectiveLines,
  SECURITY_PATTERNS,
} from './validator.js';
export type {
  PythonValidationIssue,
  PythonValidationOptions,
  PythonSecurityPattern,
  PythonSyntaxResult,
} from './validator.js';

// ─── Rules ─────────────────────────────────────────────────────────
export {
  PYTHON_RULES,
  pythonRule,
  createPythonRule,
  createPythonRules,
  runPythonRules,
  formatPythonRuleSummary,
  checkPythonSyntaxRule,
  findPythonBlocks,
  countPythonBlocks,
  getPythonExecutionStats,
  styleRule,
  securityRule,
  errorHandlingRule,
  mainGuardRule,
  emptyRule,
  sizeRule,
  PYTHON_LIMITS as PYTHON_RULE_LIMITS,
} from './rule.js';
export type { PythonBlock, PythonSeverity } from './rule.js';

// ─── Context ───────────────────────────────────────────────────────
export { pythonContext, createPythonContext, checkPythonReady } from './context.js';
export type { PythonContextOptions } from './context.js';

// ─── Plugin Factory ────────────────────────────────────────────────

import { pythonSection as section } from './manifest.js';
import { PYTHON_RULES as rules } from './rule.js';

/** The default singleton plugin, for callers that just want the plugin. */
const pythonPlugin: MAMPlugin = {
  manifest: PYTHON_MANIFEST,
  sections: [section],
  rules: [pythonRule],
  contexts: [pythonContext],
};

export const PYTHON_PLUGIN_VERSION = '0.1.0';

export interface PythonPluginOptions {
  /** Install the full rule family instead of just the composite rule. */
  allRules?: boolean;
  /** Re-level every installed rule. */
  severity?: PythonSeverity;
  /** Options for the installed execution context. */
  context?: PythonContextOptions;
  /** Manifest fields to override. */
  manifest?: Partial<typeof PYTHON_MANIFEST>;
}

/** Builds a Python plugin with a chosen rule set and run options. */
export function createPythonPlugin(options: PythonPluginOptions = {}): MAMPlugin {
  const installedRules: ValidationRule[] = options.allRules
    ? rules.map((rule) => (options.severity ? { ...rule, severity: options.severity } : { ...rule }))
    : [options.severity ? { ...pythonRule, severity: options.severity } : pythonRule];

  return {
    manifest: { ...PYTHON_MANIFEST, ...options.manifest },
    sections: [section],
    rules: installedRules,
    contexts: [createPythonContext(options.context ?? {})],
  };
}

export interface PythonApi {
  version: string;
  sectionName: string;
  rules: ValidationRule[];
  limits: typeof PYTHON_LIMITS;
  example: string;
  /** Reports whether a Python interpreter is available. */
  available(timeout?: number): ReturnType<typeof checkPythonAvailable>;
  /** Runs Python source. */
  run(code: string, options?: PythonRunOptions): Promise<PythonRunResult>;
  /** Evaluates a Python expression and returns its value. */
  evaluate(expression: string, options?: PythonRunOptions): Promise<{ value?: unknown; error?: string }>;
}

/**
 * Bundles the runner, rules and limits behind one object.
 *
 * For hosts that want to execute Python without the full plugin wiring, such
 * as a CLI or a sandbox health check.
 */
export function createPythonApi(defaults: PythonRunOptions = {}): PythonApi {
  return {
    version: PYTHON_PLUGIN_VERSION,
    sectionName: PYTHON_SECTION_NAME,
    rules: [...PYTHON_RULES],
    limits: { ...PYTHON_LIMITS },
    example: PYTHON_EXAMPLE,
    available: (timeout) => checkPythonAvailable(timeout ?? 5000),
    run: (code, options) => runPythonCode(code, { ...defaults, ...options }),
    evaluate: async (expression, options) =>
      parseExpressionResult(await runPythonExpression(expression, { ...defaults, ...options })),
  };
}

/** One-line summary of the plugin's surface, for diagnostics. */
export function describePythonPlugin(): string {
  return `MAM Python Plugin v${PYTHON_PLUGIN_VERSION} — ${PYTHON_RULES.length} rules, ` +
    `section "${PYTHON_SECTION_NAME}", subprocess execution (not a sandbox)`;
}

export default pythonPlugin;
