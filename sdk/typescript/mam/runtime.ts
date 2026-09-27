import { spawnSync } from 'node:child_process';
import { CodeBlock, Module, allCodeBlocks } from './ast.js';

/** Runtime controls for a single execution request. */
export interface ExecutionConfig {
  timeout_ms: number;
  env: Record<string, string>;
  working_dir: string;
  max_output_bytes: number;
}

/** Result returned for one code block. */
export interface ExecutionResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  language: string;
  code: string;
}

/** Returns the default runtime configuration. */
export function defaultExecutionConfig(): ExecutionConfig {
  return { timeout_ms: 30_000, env: {}, working_dir: process.cwd(), max_output_bytes: 1_048_576 };
}

/** Normalizes a partial configuration, filling safe defaults. */
export function normalizeExecutionConfig(config: Partial<ExecutionConfig> = {}): ExecutionConfig {
  const defaults = defaultExecutionConfig();
  return { ...defaults, ...config, env: { ...defaults.env, ...(config.env ?? {}) } };
}

/** Returns whether a language is supported by the host runtime. */
export function isSupportedLanguage(language: string): boolean {
  return ['javascript', 'js', 'node', 'typescript', 'ts', 'python', 'python3', 'py', 'bash', 'sh', 'shell'].includes(language.toLowerCase());
}

/** Returns the canonical runtime language name. */
export function normalizeLanguage(language: string): string {
  const value = language.toLowerCase().trim();
  if (value === 'js' || value === 'node') return 'javascript';
  if (value === 'ts') return 'typescript';
  if (value === 'py' || value === 'python3') return 'python';
  if (value === 'sh' || value === 'shell') return 'bash';
  return value;
}

/** Executes one code block synchronously and always returns a result. */
export function executeBlock(block: CodeBlock, config: Partial<ExecutionConfig> = {}): ExecutionResult {
  const normalized = normalizeExecutionConfig(config);
  const start = Date.now();
  if (!block.language.trim()) return failed('unknown', block, 'code block has no language', start);
  if (!isSupportedLanguage(block.language)) return failed(block.language, block, `unsupported language: ${block.language}`, start);
  const language = normalizeLanguage(block.language);
  if (language === 'typescript') return failed(language, block, 'TypeScript execution requires a configured transpiler', start);
  const command = language === 'javascript' ? process.execPath : language;
  const args = language === 'javascript' ? ['-e', block.code] : language === 'python' ? ['-c', block.code] : ['-c', block.code];
  const env = { ...process.env, ...normalized.env };
  const child = spawnSync(command, args, { cwd: normalized.working_dir, env, timeout: normalized.timeout_ms, encoding: 'utf8', maxBuffer: normalized.max_output_bytes });
  return { exit_code: child.status ?? (child.error ? 1 : 0), stdout: truncate(child.stdout ?? ''), stderr: truncate(child.stderr ?? child.error?.message ?? ''), duration_ms: Date.now() - start, language, code: block.code };
}

/** Executes every code block in a module in source order. */
export function executeModule(module: Module, config: Partial<ExecutionConfig> = {}): ExecutionResult[] {
  return allCodeBlocks(module).map((block) => executeBlock(block, config));
}

/** Executes blocks selected by section title. */
export function executeSections(module: Module, titles: string[], config: Partial<ExecutionConfig> = {}): ExecutionResult[] {
  const wanted = new Set(titles.map((title) => title.toLowerCase()));
  return module.sections.filter((section) => wanted.has(section.title.toLowerCase())).flatMap((section) => section.content.filter((node): node is CodeBlock => node.kind === 'CodeBlock').map((block) => executeBlock(block, config)));
}

/** Returns whether an execution result exited successfully. */
export function succeeded(result: ExecutionResult): boolean {
  return result.exit_code === 0;
}

/** Returns a combined stdout and stderr value without losing empty streams. */
export function combinedOutput(result: ExecutionResult): string {
  return [result.stdout, result.stderr].filter((value) => value.length > 0).join('\n');
}

/** Counts results by canonical language. */
export function countResultsByLanguage(results: ExecutionResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) counts[normalizeLanguage(result.language)] = (counts[normalizeLanguage(result.language)] ?? 0) + 1;
  return counts;
}

/** Returns the total duration of an execution list. */
export function totalDuration(results: ExecutionResult[]): number {
  return results.reduce((sum, result) => sum + result.duration_ms, 0);
}

/** Returns only failed execution results. */
export function failedResults(results: ExecutionResult[]): ExecutionResult[] {
  return results.filter((result) => !succeeded(result));
}

/** Returns the first non-zero exit code, or zero. */
export function firstFailureCode(results: ExecutionResult[]): number {
  return failedResults(results)[0]?.exit_code ?? 0;
}

/** Returns a stable one-line execution summary. */
export function summarizeExecution(results: ExecutionResult[]): string {
  const passed = results.length - failedResults(results).length;
  return `Execution ${passed}/${results.length} blocks succeeded (failed: ${results.length - passed})`;
}

/** Creates a safe result for an unsupported or unconfigured block. */
export function failed(language: string, block: CodeBlock, message: string, start: number): ExecutionResult {
  return { exit_code: 1, stdout: '', stderr: message, duration_ms: Date.now() - start, language, code: block.code };
}

/** Truncates a stream while preserving a visible suffix marker. */
export function truncate(value: string, maxBytes = 1_048_576): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  return `${value.slice(0, Math.max(0, maxBytes - 20))}\n...[truncated]`;
}

/** Returns a defensive copy of runtime configuration. */
export function copyExecutionConfig(config: ExecutionConfig): ExecutionConfig {
  return { ...config, env: { ...config.env } };
}

/** Returns the configured environment with a single key changed. */
export function withEnvironment(config: ExecutionConfig, key: string, value: string): ExecutionConfig {
  return { ...config, env: { ...config.env, [key]: value } };
}

/** Returns a short description of the runtime configuration. */
export function describeExecutionConfig(config: ExecutionConfig): string {
  return `timeout=${config.timeout_ms}ms working_dir=${config.working_dir} max_output_bytes=${config.max_output_bytes}`;
}

/** Checks whether a block is executable under the supplied configuration. */
export function canExecute(block: CodeBlock, config: Partial<ExecutionConfig> = {}): boolean {
  return isSupportedLanguage(block.language) && normalizeLanguage(block.language) !== 'typescript' && normalizeExecutionConfig(config).timeout_ms > 0;
}

/** Returns the first supported language in a module. */
export function detectRuntime(module: Module): string | undefined {
  return allCodeBlocks(module).map((block) => normalizeLanguage(block.language)).find((language) => isSupportedLanguage(language));
}

/** Returns an execution result for a module with no blocks. */
export function emptyExecutionResult(): ExecutionResult {
  return { exit_code: 0, stdout: '', stderr: '', duration_ms: 0, language: '', code: '' };
}

/** Returns true when all blocks succeeded. */
export function allSucceeded(results: ExecutionResult[]): boolean {
  return results.every(succeeded);
}

/** Returns a successful aggregate result. */
export function aggregateExecution(results: ExecutionResult[]): ExecutionResult {
  return { exit_code: firstFailureCode(results), stdout: results.map((result) => result.stdout).filter(Boolean).join('\n'), stderr: results.map((result) => result.stderr).filter(Boolean).join('\n'), duration_ms: totalDuration(results), language: '', code: '' };
}

/** Returns the number of passed blocks. */
export function successfulCount(results: ExecutionResult[]): number {
  return results.filter(succeeded).length;
}

/** Returns distinct languages used by results. */
export function executionLanguages(results: ExecutionResult[]): string[] {
  return [...new Set(results.map((result) => normalizeLanguage(result.language)))];
}

/** Returns a result count by exit code. */
export function countExitCodes(results: ExecutionResult[]): Record<number, number> {
  return results.reduce<Record<number, number>>((counts, result) => { counts[result.exit_code] = (counts[result.exit_code] ?? 0) + 1; return counts; }, {});
}

/** Returns the slowest result. */
export function slowestResult(results: ExecutionResult[]): ExecutionResult | undefined {
  return [...results].sort((a, b) => b.duration_ms - a.duration_ms)[0];
}

/** Returns whether a result has stderr. */
export function hasStandardError(result: ExecutionResult): boolean {
  return result.stderr.trim().length > 0;
}

/** Returns whether a result has stdout. */
export function hasStandardOutput(result: ExecutionResult): boolean {
  return result.stdout.trim().length > 0;
}

/** Returns a copy of a result. */
export function copyExecutionResult(result: ExecutionResult): ExecutionResult {
  return { ...result };
}

/** Applies a maximum output size to a result. */
export function boundExecutionResult(result: ExecutionResult, maxBytes = 1_048_576): ExecutionResult {
  return { ...result, stdout: truncate(result.stdout, maxBytes), stderr: truncate(result.stderr, maxBytes) };
}

/** Returns a safe timeout. */
export function normalizeTimeout(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 30_000 : Math.max(1, Math.floor(value));
}

/** Returns a safe output cap. */
export function normalizeMaxOutput(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 1_048_576 : Math.max(1, Math.floor(value));
}

/** Returns a config with bounded limits. */
export function boundedExecutionConfig(config: Partial<ExecutionConfig> = {}): ExecutionConfig {
  const normalized = normalizeExecutionConfig(config);
  return { ...normalized, timeout_ms: normalizeTimeout(config.timeout_ms), max_output_bytes: normalizeMaxOutput(config.max_output_bytes) };
}

/** Returns a list of executable language aliases. */
export function supportedRuntimeLanguages(): string[] {
  return ['javascript', 'js', 'node', 'typescript', 'ts', 'python', 'python3', 'py', 'bash', 'sh', 'shell'];
}

/** Reports whether a language maps to Node. */
export function isNodeLanguage(language: string): boolean {
  return normalizeLanguage(language) === 'javascript';
}

/** Reports whether a language maps to Python. */
export function isPythonLanguage(language: string): boolean {
  return normalizeLanguage(language) === 'python';
}

/** Returns a safe display path. */
export function displayWorkingDirectory(config: ExecutionConfig): string {
  return config.working_dir || process.cwd();
}

/** Returns whether a result represents a timeout. */
export function isTimeoutResult(result: ExecutionResult): boolean {
  return result.exit_code !== 0 && /timed out|timeout/i.test(result.stderr);
}

/** Returns a short result label. */
export function executionLabel(result: ExecutionResult): string {
  return `${result.language || 'unknown'}:${result.exit_code}`;
}

/** Returns a deterministic list of result labels. */
export function resultLabels(results: ExecutionResult[]): string[] {
  return results.map(executionLabel);
}

/** Returns results with a language filter. */
export function resultsForLanguage(results: ExecutionResult[], language: string): ExecutionResult[] {
  return results.filter((result) => normalizeLanguage(result.language) === normalizeLanguage(language));
}

/** Returns a module's total code block count. */
export function executionBlockCount(module: Module): number {
  return allCodeBlocks(module).length;
}

/** Returns a normalized execution result list. */
export function normalizeExecutionResults(results: ExecutionResult[]): ExecutionResult[] {
  return results.map((result) => boundExecutionResult(copyExecutionResult(result)));
}

/** Returns a compact result report. */
export function resultReport(results: ExecutionResult[]): string {
  return `${summarizeExecution(results)}; languages: ${executionLanguages(results).join(', ') || 'none'}`;
}

/** Returns whether every result has a zero exit code. */
export function successfulExecution(results: ExecutionResult[]): boolean {
  return allSucceeded(results);
}

/** Returns the average duration. */
export function averageDuration(results: ExecutionResult[]): number {
  return results.length ? totalDuration(results) / results.length : 0;
}

/** Returns the longest output stream. */
export function largestOutput(results: ExecutionResult[]): number {
  return results.reduce((largest, result) => Math.max(largest, result.stdout.length, result.stderr.length), 0);
}

/** Returns a result list with failed results first. */
export function failuresFirst(results: ExecutionResult[]): ExecutionResult[] {
  return [...failedResults(results), ...results.filter(succeeded)];
}

/** Returns whether a result has a non-empty code body. */
export function hasCodeBody(result: ExecutionResult): boolean {
  return result.code.trim().length > 0;
}

/** Returns a safe language label. */
export function safeLanguageLabel(language: string): string {
  return language.trim() || 'unknown';
}
