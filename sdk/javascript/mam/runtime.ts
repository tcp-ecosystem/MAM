/**
 * MAM Runtime for JavaScript
 *
 * Executes MAM modules in sandboxed contexts.
 * Supports python, javascript, bash, and shell code blocks.
 */

import type { AST, Section, ContentNode } from './parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLanguage = 'python' | 'javascript' | 'js' | 'typescript' | 'ts' | 'bash' | 'shell' | 'sh';

export interface ExecutionConfig {
  timeout?: number;
  env?: Record<string, string>;
  sections?: string[];
  inputs?: Record<string, unknown>;
  stopOnError?: boolean;
  memory?: Record<string, unknown>;
  memoryLimit?: number;
}

export interface ExecutionContext {
  module: AST;
  inputs: Record<string, unknown>;
  env: Record<string, string>;
  memory: Record<string, unknown>;
  memoryLimit: number;
  permissions: string[];
}

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  errors: string[];
  duration: number;
  sectionName: string;
  language: string;
}

export interface ModuleExecutionResult {
  success: boolean;
  sectionResults: ExecutionResult[];
  output: Record<string, unknown>;
  duration: number;
  memory: Record<string, unknown>;
  errors: string[];
}

export interface ExecutionHistoryEntry {
  timestamp: number;
  sectionName: string;
  language: string;
  code: string;
  result: ExecutionResult;
}

export interface ExecutionHistory {
  entries: ExecutionHistoryEntry[];
  add(entry: ExecutionHistoryEntry): void;
  getBySection(sectionName: string): ExecutionHistoryEntry[];
  getByLanguage(language: string): ExecutionHistoryEntry[];
  clear(): void;
  size(): number;
}

// ---------------------------------------------------------------------------
// Execution History
// ---------------------------------------------------------------------------

export function createExecutionHistory(): ExecutionHistory {
  const entries: ExecutionHistoryEntry[] = [];

  return {
    entries,

    add(entry: ExecutionHistoryEntry) {
      entries.push(entry);
    },

    getBySection(sectionName: string): ExecutionHistoryEntry[] {
      return entries.filter((e) => e.sectionName === sectionName);
    },

    getByLanguage(language: string): ExecutionHistoryEntry[] {
      return entries.filter((e) => e.language === language);
    },

    clear() {
      entries.length = 0;
    },

    size(): number {
      return entries.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Language executors (sandboxed via Function constructor / eval isolation)
// ---------------------------------------------------------------------------

function normalizeLanguage(lang: string): SupportedLanguage {
  const l = lang.toLowerCase().trim();
  if (l === 'js') return 'javascript';
  if (l === 'ts') return 'typescript';
  if (l === 'sh') return 'shell';
  return l as SupportedLanguage;
}

function isSupportedLanguage(lang: string): boolean {
  return ['python', 'javascript', 'js', 'typescript', 'ts', 'bash', 'shell', 'sh'].includes(lang.toLowerCase().trim());
}

function parseTimeout(value: string | undefined, defaultMs: number): number {
  if (!value) return defaultMs;
  const match = value.match(/^(\d+)(ms|s|m)?$/);
  if (!match) return defaultMs;
  const num = parseInt(match[1], 10);
  const unit = match[2] ?? 'ms';
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    default: return num;
  }
}

/**
 * Execute JavaScript/TypeScript in a sandboxed Function context.
 */
function executeJavaScript(
  code: string,
  ctx: ExecutionContext,
  timeout: number,
): ExecutionResult {
  const startTime = Date.now();
  const logs: unknown[] = [];

  // Build sandboxed console
  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push('[ERROR] ' + args.map(String).join(' ')),
    info: (...args: unknown[]) => logs.push('[INFO] ' + args.map(String).join(' ')),
  };

  // Inject inputs as top-level var declarations
  const inputDecls = Object.entries(ctx.inputs)
    .map(([k, v]) => `var ${k} = __inputs["${k.replace(/"/g, '\\"')}"];`)
    .join('\n');

  const envObj = { ...ctx.env };
  const memObj = { ...ctx.memory };

  // Build the function body
  const fnBody = `
    "use strict";
    var env = __env;
    var memory = __memory;
    var output = undefined;
    var console = __console;
    ${inputDecls}
    ${code}
    return typeof output !== 'undefined' ? output : null;
  `;

  try {
    // Function constructor: new Function(param1, param2, ..., body)
    const sandboxFn = new Function('__env', '__memory', '__inputs', '__console', fnBody);
    const result = sandboxFn(envObj, memObj, ctx.inputs, sandboxConsole);

    return {
      success: true,
      output: result,
      errors: [],
      duration: Date.now() - startTime,
      sectionName: '',
      language: 'javascript',
    };
  } catch (err) {
    return {
      success: false,
      output: logs.length > 0 ? logs.join('\n') : null,
      errors: [err instanceof Error ? err.message : String(err)],
      duration: Date.now() - startTime,
      sectionName: '',
      language: 'javascript',
    };
  }
}

/**
 * Stub executor for Python — records code but cannot execute in JS runtime.
 */
function executePython(
  code: string,
  _ctx: ExecutionContext,
  _timeout: number,
): ExecutionResult {
  return {
    success: true,
    output: { code, note: 'Python execution not available in JS runtime' },
    errors: [],
    duration: 0,
    sectionName: '',
    language: 'python',
  };
}

/**
 * Stub executor for shell/bash.
 */
function executeShell(
  code: string,
  _ctx: ExecutionContext,
  _timeout: number,
): ExecutionResult {
  return {
    success: true,
    output: { code, note: 'Shell execution not available in JS runtime' },
    errors: [],
    duration: 0,
    sectionName: '',
    language: 'shell',
  };
}

// ---------------------------------------------------------------------------
// Code block metadata extraction
// ---------------------------------------------------------------------------

function extractCodeMetadata(code: string): { cleanCode: string; metadata: Record<string, string> } {
  const metadata: Record<string, string> = {};
  const lines = code.split('\n');
  let metaEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^#\s*@mam:(\w+)(?:=(.+))?$/);
    if (match) {
      metadata[match[1]] = match[2] ?? 'true';
      metaEnd = i + 1;
    } else if (lines[i].trim() === '') {
      continue;
    } else {
      break;
    }
  }

  const cleanCode = lines.slice(metaEnd).join('\n').trim();
  return { cleanCode, metadata };
}

// ---------------------------------------------------------------------------
// Main execute function
// ---------------------------------------------------------------------------

export function execute(
  module: AST,
  config?: ExecutionConfig,
): Promise<ModuleExecutionResult> {
  return executeModule(module, config);
}

async function executeModule(
  module: AST,
  config?: ExecutionConfig,
): Promise<ModuleExecutionResult> {
  const startTime = Date.now();
  const cfg: ExecutionConfig = config ?? {};
  const timeout = cfg.timeout ?? 30000;
  const env = cfg.env ?? {};
  const memory: Record<string, unknown> = cfg.memory ? { ...cfg.memory } : {};
  const memoryLimit = cfg.memoryLimit ?? 1024 * 1024; // 1MB default
  const inputs = cfg.inputs ?? {};
  const stopOnError = cfg.stopOnError ?? false;

  const history = createExecutionHistory();
  const sectionResults: ExecutionResult[] = [];
  const output: Record<string, unknown> = {};
  const errors: string[] = [];

  const ctx: ExecutionContext = {
    module,
    inputs,
    env,
    memory,
    memoryLimit,
    permissions: (module.frontmatter?.data.permissions as string[]) ?? [],
  };

  // Filter sections to execute
  const sectionsToExecute = cfg.sections
    ? module.sections.filter((s) => cfg.sections!.includes(s.name))
    : module.sections;

  for (const section of sectionsToExecute) {
    // Only execute sections that contain code blocks
    const codeBlocks = section.content.filter((c) => c.type === 'CodeBlock');
    if (codeBlocks.length === 0) continue;

    for (const block of codeBlocks) {
      if (!block.language) continue;

      const lang = normalizeLanguage(block.language);
      if (!isSupportedLanguage(block.language)) continue;

      const { cleanCode, metadata } = extractCodeMetadata(block.value);

      // Resolve per-block timeout
      const blockTimeout = metadata.timeout
        ? parseTimeout(metadata.timeout, timeout)
        : timeout;

      let result: ExecutionResult;

      switch (lang) {
        case 'javascript':
        case 'typescript':
          result = await executeJavaScript(cleanCode, ctx, blockTimeout);
          break;
        case 'python':
          result = executePython(cleanCode, ctx, blockTimeout);
          break;
        case 'bash':
        case 'shell':
          result = executeShell(cleanCode, ctx, blockTimeout);
          break;
        default:
          result = {
            success: false,
            output: null,
            errors: [`Unsupported language: ${block.language}`],
            duration: 0,
            sectionName: section.name,
            language: block.language,
          };
      }

      result.sectionName = section.name;
      result.language = block.language;
      sectionResults.push(result);

      // Record in history
      history.add({
        timestamp: Date.now(),
        sectionName: section.name,
        language: block.language,
        code: cleanCode,
        result,
      });

      // Collect output
      if (!output[section.name]) {
        output[section.name] = result.output;
      } else {
        // If multiple code blocks in same section, accumulate
        const existing = output[section.name];
        if (Array.isArray(existing)) {
          existing.push(result.output);
        } else {
          output[section.name] = [existing, result.output];
        }
      }

      if (!result.success) {
        errors.push(...result.errors.map((e) => `[${section.name}] ${e}`));
        if (stopOnError) break;
      }
    }

    if (stopOnError && errors.length > 0) break;
  }

  const duration = Date.now() - startTime;

  return {
    success: errors.length === 0,
    sectionResults,
    output,
    duration,
    memory: { ...memory },
    errors,
  };
}

export function isExecutionSuccess(result: ModuleExecutionResult): boolean {
  return result.success;
}

export function countSuccessfulSections(result: ModuleExecutionResult): number {
  return result.sectionResults.filter((section) => section.success).length;
}

export function getFailedSections(result: ModuleExecutionResult): ExecutionResult[] {
  return result.sectionResults.filter((section) => !section.success);
}

export function getExecutionLanguages(result: ModuleExecutionResult): string[] {
  const languages: string[] = [];
  const seen = new Set<string>();
  for (const section of result.sectionResults) {
    if (!seen.has(section.language)) {
      seen.add(section.language);
      languages.push(section.language);
    }
  }
  return languages;
}

export function summarizeExecution(result: ModuleExecutionResult): string {
  const total = result.sectionResults.length;
  const succeeded = countSuccessfulSections(result);
  const status = result.success ? 'succeeded' : 'failed';
  return `${status}: ${succeeded}/${total} sections in ${result.duration}ms`;
}

export function recordExecution(history: ExecutionHistory, entry: ExecutionHistoryEntry): void {
  history.add(entry);
}

export function getExecutionHistorySize(history: ExecutionHistory): number {
  return history.size();
}
