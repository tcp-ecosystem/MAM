/**
 * MAM Execute Command
 *
 * Production-grade execution engine with sandboxing, section-by-section
 * execution, input injection, output capture, breakpoints, variable
 * inspection, resource monitoring, and execution replay.
 */

import { readFile, writeFile, readdir, access, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { parseMAM } from '@mam/parser';
import { executeModule } from '@mam/runtime';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export type SandboxMode = 'process' | 'vm' | 'none';
export type OutputFormat = 'text' | 'json' | 'structured';

export interface ExecuteOptions {
  file: string;
  sections?: string[];
  inputs?: string;
  timeout?: number;
  sandbox?: SandboxMode | string;
  format?: OutputFormat | string;
  dryRun?: boolean;
  step?: boolean;
  breakpoints?: string;
  inspect?: string;
  replay?: string;
  history?: boolean;
  resourceMonitor?: boolean;
  verbose?: boolean;
  envFile?: string;
  cwd?: string;
}

export interface ExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  validation?: { valid: boolean; errors: { message: string }[] };
  timeMs: number;
  sections: SectionResult[];
  resources: ResourceSnapshot;
  steps: StepRecord[];
  history: HistoryEntry[];
}

export interface SectionResult {
  name: string;
  success: boolean;
  output: unknown;
  error?: string;
  timeMs: number;
  iterations: number;
  resources: ResourceSnapshot;
}

export interface ResourceSnapshot {
  memoryMB: number;
  cpuPercent: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  uptime: number;
}

export interface StepRecord {
  index: number;
  sectionName: string;
  action: string;
  input: unknown;
  output: unknown;
  timeMs: number;
  breakpointHit: boolean;
  variables: Record<string, unknown>;
}

export interface HistoryEntry {
  timestamp: string;
  file: string;
  success: boolean;
  timeMs: number;
  sections: number;
  inputHash: string;
}

export interface Breakpoint {
  id: string;
  section: string;
  line?: number;
  enabled: boolean;
  hitCount: number;
  condition?: string;
}

export interface VariableSnapshot {
  name: string;
  value: unknown;
  type: string;
  scope: string;
  definedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 30000;
const MAX_HISTORY = 100;
const HISTORY_FILE = '.mam-execution-history.json';
const RESOURCE_SAMPLE_INTERVAL = 100;

// ============================================================================
// Resource Monitor
// ============================================================================

class ResourceMonitor {
  private samples: ResourceSnapshot[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    this.running = true;
    this.sample();
    this.interval = setInterval(() => this.sample(), RESOURCE_SAMPLE_INTERVAL);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  sample(): void {
    if (!this.running) return;
    const mem = process.memoryUsage();
    this.samples.push({
      memoryMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      cpuPercent: 0,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      uptime: process.uptime(),
    });
  }

  getLatest(): ResourceSnapshot {
    if (this.samples.length === 0) {
      return { memoryMB: 0, cpuPercent: 0, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, uptime: 0 };
    }
    return this.samples[this.samples.length - 1]!;
  }

  getPeak(): ResourceSnapshot {
    if (this.samples.length === 0) {
      return { memoryMB: 0, cpuPercent: 0, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, uptime: 0 };
    }
    return this.samples.reduce((peak, s) => ({
      memoryMB: Math.max(peak.memoryMB, s.memoryMB),
      cpuPercent: Math.max(peak.cpuPercent, s.cpuPercent),
      heapUsedMB: Math.max(peak.heapUsedMB, s.heapUsedMB),
      heapTotalMB: Math.max(peak.heapTotalMB, s.heapTotalMB),
      rssMB: Math.max(peak.rssMB, s.rssMB),
      uptime: s.uptime,
    }));
  }

  getAll(): ResourceSnapshot[] {
    return [...this.samples];
  }
}

// ============================================================================
// Breakpoint Manager
// ============================================================================

class BreakpointManager {
  private breakpoints: Map<string, Breakpoint> = new Map();
  private hitCounts: Map<string, number> = new Map();

  parse(breakpointStr: string): void {
    const entries = breakpointStr.split(',');
    for (const entry of entries) {
      const parts = entry.trim().split('@');
      const section = parts[0] || '';
      const line = parts[1] ? parseInt(parts[1], 10) : undefined;
      const id = `${section}:${line || '*'}`;
      this.breakpoints.set(id, {
        id,
        section,
        line,
        enabled: true,
        hitCount: 0,
      });
    }
  }

  shouldStop(sectionName: string, line?: number): boolean {
    for (const bp of this.breakpoints.values()) {
      if (!bp.enabled) continue;
      if (bp.section === sectionName || bp.section === '*') {
        if (bp.line === undefined || bp.line === line) {
          bp.hitCount++;
          return true;
        }
      }
    }
    return false;
  }

  getBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  toggle(id: string): void {
    const bp = this.breakpoints.get(id);
    if (bp) bp.enabled = !bp.enabled;
  }

  clear(): void {
    this.breakpoints.clear();
  }
}

// ============================================================================
// Execution History
// ============================================================================

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(resolve(HISTORY_FILE), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const trimmed = entries.slice(-MAX_HISTORY);
  await writeFile(resolve(HISTORY_FILE), JSON.stringify(trimmed, null, 2), 'utf-8');
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

// ============================================================================
// Replay Engine
// ============================================================================

async function loadReplay(replayPath: string): Promise<ExecutionResult> {
  const raw = await readFile(resolve(replayPath), 'utf-8');
  return JSON.parse(raw);
}

async function saveReplay(result: ExecutionResult, filePath: string): Promise<void> {
  const replayPath = join(
    resolve('.'),
    'replays',
    `${basename(filePath, '.mam.md')}-${Date.now()}.json`,
  );
  await mkdir(join(resolve('.'), 'replays'), { recursive: true });
  await writeFile(replayPath, JSON.stringify(result, null, 2), 'utf-8');
}

// ============================================================================
// Section Executor
// ============================================================================

async function executeSectionBySection(
  ast: any,
  options: {
    inputs: Record<string, unknown>;
    timeout: number;
    sandbox: SandboxMode;
    breakpoints: BreakpointManager;
    monitor: ResourceMonitor;
    stepMode: boolean;
    verbose: boolean;
  },
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const sections: SectionResult[] = [];
  const steps: StepRecord[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let stepIndex = 0;

  const moduleSections = ast.sections || [];

  for (const section of moduleSections) {
    // Check breakpoints
    if (options.breakpoints.shouldStop(section.name)) {
      const step: StepRecord = {
        index: stepIndex++,
        sectionName: section.name,
        action: 'breakpoint',
        input: null,
        output: null,
        timeMs: 0,
        breakpointHit: true,
        variables: { ...options.inputs },
      };
      steps.push(step);

      if (options.stepMode) {
        console.log(chalk.yellow(`\n  Breakpoint hit at section: ${section.name}`));
        console.log(chalk.gray(`  Variables: ${JSON.stringify(options.inputs, null, 2)}`));
      }
    }

    const sectionStart = Date.now();

    try {
      // Create a mini-AST with just this section
      const miniAst = {
        ...ast,
        sections: [section],
      };

      const result = await executeModule(miniAst as any, {
        defaultTimeout: options.timeout,
      }, {
        inputs: options.inputs,
      });

      const sectionTime = Date.now() - sectionStart;
      const resources = options.monitor.getLatest();

      sections.push({
        name: section.name,
        success: result.success,
        output: result.output,
        error: result.errors.length > 0 ? result.errors.join(', ') : undefined,
        timeMs: sectionTime,
        iterations: 1,
        resources,
      });

      steps.push({
        index: stepIndex++,
        sectionName: section.name,
        action: 'execute',
        input: options.inputs,
        output: result.output,
        timeMs: sectionTime,
        breakpointHit: false,
        variables: { ...options.inputs, ...(result.output as Record<string, unknown> || {}) },
      });

      if (options.verbose) {
        console.log(chalk.gray(`  [${section.name}] ${sectionTime.toFixed(2)}ms ${result.success ? chalk.green('OK') : chalk.red('FAIL')}`));
      }
    } catch (err) {
      const sectionTime = Date.now() - sectionStart;
      const errorMsg = (err as Error).message;
      errors.push(`Section "${section.name}": ${errorMsg}`);

      sections.push({
        name: section.name,
        success: false,
        output: null,
        error: errorMsg,
        timeMs: sectionTime,
        iterations: 0,
        resources: options.monitor.getLatest(),
      });

      steps.push({
        index: stepIndex++,
        sectionName: section.name,
        action: 'error',
        input: options.inputs,
        output: null,
        timeMs: sectionTime,
        breakpointHit: false,
        variables: { ...options.inputs },
      });
    }
  }

  // Aggregate results
  const aggregatedOutput: Record<string, unknown> = {};
  for (const s of sections) {
    if (s.output && typeof s.output === 'object') {
      Object.assign(aggregatedOutput, s.output);
    }
  }

  return {
    success: errors.length === 0 && sections.every((s) => s.success),
    output: aggregatedOutput,
    errors,
    warnings,
    timeMs: Date.now() - startTime,
    sections,
    resources: options.monitor.getPeak(),
    steps,
    history: [],
  };
}

// ============================================================================
// Dry Run
// ============================================================================

function dryRun(ast: any, inputs: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push(chalk.cyan('\n  Dry Run — Execution Plan'));
  lines.push(chalk.gray('  ' + '='.repeat(50)));
  lines.push('');

  const fm = ast.frontmatter?.data;
  if (fm?.name) {
    lines.push(chalk.white(`  Module:  ${fm.name}`));
  }
  if (fm?.version) {
    lines.push(chalk.white(`  Version: ${fm.version}`));
  }
  lines.push('');

  lines.push(chalk.white('  Input Parameters:'));
  if (Object.keys(inputs).length === 0) {
    lines.push(chalk.gray('    (none)'));
  } else {
    for (const [key, value] of Object.entries(inputs)) {
      lines.push(chalk.gray(`    ${key}: ${JSON.stringify(value)}`));
    }
  }
  lines.push('');

  lines.push(chalk.white('  Execution Steps:'));
  const sections = ast.sections || [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const contentCount = (section.content || []).length;
    const childCount = (section.children || []).length;

    lines.push(chalk.gray(`    ${i + 1}. ${section.name}`));
    lines.push(chalk.gray(`       Content items: ${contentCount}, Children: ${childCount}`));

    for (const content of section.content || []) {
      switch (content.type) {
        case 'codeblock':
          lines.push(chalk.gray(`       [CODE: ${content.language || 'text'}] ${(content.value || '').substring(0, 50)}...`));
          break;
        case 'paragraph':
          lines.push(chalk.gray(`       [TEXT] ${(content.value || '').substring(0, 50)}...`));
          break;
        case 'table':
          lines.push(chalk.gray(`       [TABLE] ${content.headers?.length || 0} columns, ${content.rows?.length || 0} rows`));
          break;
        case 'list':
          lines.push(chalk.gray(`       [LIST] ${content.items?.length || 0} items`));
          break;
        default:
          lines.push(chalk.gray(`       [${content.type}]`));
          break;
      }
    }
  }

  lines.push('');
  lines.push(chalk.gray(`  Estimated sections: ${sections.length}`));

  return lines.join('\n');
}

// ============================================================================
// Variable Inspector
// ============================================================================

function inspectVariables(result: ExecutionResult, sectionName?: string): string {
  const lines: string[] = [];

  lines.push(chalk.cyan('\n  Variable Inspection'));
  lines.push(chalk.gray('  ' + '='.repeat(50)));

  const steps = sectionName
    ? result.steps.filter((s) => s.sectionName === sectionName)
    : result.steps;

  if (steps.length === 0) {
    lines.push(chalk.gray('  No steps recorded'));
    return lines.join('\n');
  }

  // Collect all variables across steps
  const allVars = new Map<string, VariableSnapshot>();

  for (const step of steps) {
    for (const [name, value] of Object.entries(step.variables)) {
      allVars.set(name, {
        name,
        value,
        type: typeof value,
        scope: step.sectionName,
        definedAt: `step[${step.index}]`,
      });
    }
  }

  lines.push('');
  for (const [name, snapshot] of allVars) {
    const typeColor = snapshot.type === 'string' ? chalk.green : snapshot.type === 'number' ? chalk.blue : chalk.white;
    lines.push(`  ${chalk.cyan(name)} ${typeColor(`(${snapshot.type})`)}`);
    lines.push(chalk.gray(`    scope: ${snapshot.scope}, defined at: ${snapshot.definedAt}`));
    lines.push(chalk.gray(`    value: ${JSON.stringify(snapshot.value).substring(0, 80)}`));
  }

  return lines.join('\n');
}

// ============================================================================
// Output Formatter
// ============================================================================

function formatText(result: ExecutionResult): string {
  const lines: string[] = [];

  if (result.validation && !result.validation.valid) {
    console.error(chalk.red('\n  Validation failed:'));
    for (const error of result.validation.errors) {
      console.error(chalk.red(`    ${error.message}`));
    }
  }

  if (result.errors.length > 0) {
    console.error(chalk.red('\n  Execution errors:'));
    for (const error of result.errors) {
      console.error(chalk.red(`    ${error}`));
    }
  }

  if (result.success) {
    lines.push(chalk.green('\n  Module executed successfully'));
  } else {
    lines.push(chalk.red('\n  Module execution failed'));
  }

  if (Object.keys(result.output).length > 0) {
    lines.push(chalk.cyan('\n  Output:'));
    lines.push(JSON.stringify(result.output, null, 2));
  }

  lines.push(chalk.gray(`\n  Execution time: ${result.timeMs.toFixed(2)}ms`));
  lines.push(chalk.gray(`  Sections: ${result.sections.length}`));
  lines.push(chalk.gray(`  Memory: ${result.resources.memoryMB}MB`));

  return lines.join('\n');
}

function formatStructured(result: ExecutionResult): string {
  return JSON.stringify(result, null, 2);
}

// ============================================================================
// Input Parser
// ============================================================================

function parseInputs(inputsStr?: string, envFile?: string): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  if (inputsStr) {
    try {
      Object.assign(inputs, JSON.parse(inputsStr));
    } catch {
      // Try key=value,key=value format
      const pairs = inputsStr.split(',');
      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split('=');
        if (key) {
          const value = valueParts.join('=');
          try {
            inputs[key.trim()] = JSON.parse(value.trim());
          } catch {
            inputs[key.trim()] = value.trim();
          }
        }
      }
    }
  }

  return inputs;
}

// ============================================================================
// Env File Loader
// ============================================================================

async function loadEnvFile(envPath: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  try {
    const content = await readFile(resolve(envPath), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // Env file not found, continue without it
  }
  return env;
}

// ============================================================================
// Sandbox Executor
// ============================================================================

async function executeWithSandbox(
  ast: any,
  options: {
    inputs: Record<string, unknown>;
    timeout: number;
    sandbox: SandboxMode;
  },
): Promise<ExecutionResult> {
  const startTime = Date.now();

  switch (options.sandbox) {
    case 'vm': {
      // Use Node.js VM sandbox
      const { createContext, Script } = await import('node:vm');

      const sandboxContext = createContext({
        console,
        inputs: options.inputs,
        result: {} as Record<string, unknown>,
        module: { exports: {} as Record<string, unknown> },
      });

      // Build execution script from sections
      const scriptLines: string[] = [];
      for (const section of ast.sections || []) {
        for (const content of section.content || []) {
          if (content.type === 'codeblock') {
            scriptLines.push(`// Section: ${section.name}`);
            scriptLines.push(content.value || '');
          }
        }
      }

      const script = new Script(scriptLines.join('\n'), { filename: 'mam-module.mjs' });

      try {
        script.runInContext(sandboxContext, { timeout: options.timeout });

        const moduleExports = (sandboxContext as any).module?.exports || {};

        return {
          success: true,
          output: moduleExports,
          errors: [],
          warnings: [],
          timeMs: Date.now() - startTime,
          sections: [],
          resources: { memoryMB: 0, cpuPercent: 0, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, uptime: 0 },
          steps: [],
          history: [],
        };
      } catch (err) {
        return {
          success: false,
          output: {},
          errors: [`VM execution failed: ${(err as Error).message}`],
          warnings: [],
          timeMs: Date.now() - startTime,
          sections: [],
          resources: { memoryMB: 0, cpuPercent: 0, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, uptime: 0 },
          steps: [],
          history: [],
        };
      }
    }

    case 'none':
    case 'process':
    default: {
      // Direct process execution via runtime
      const result = await executeModule(ast, {
        defaultTimeout: options.timeout,
      }, {
        inputs: options.inputs,
      });

      return {
        success: result.success,
        output: result.output as Record<string, unknown>,
        errors: result.errors.map(String),
        warnings: [],
        validation: result.validation as any,
        timeMs: Date.now() - startTime,
        sections: [],
        resources: { memoryMB: 0, cpuPercent: 0, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, uptime: 0 },
        steps: [],
        history: [],
      };
    }
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  const spinner = ora('Loading module...').start();

  try {
    const filePath = resolve(options.file);

    // Load env file if specified
    let envInputs: Record<string, string> = {};
    if (options.envFile) {
      envInputs = await loadEnvFile(options.envFile);
    }

    // Parse inputs from CLI and env file
    const cliInputs = parseInputs(options.inputs);
    const inputs = { ...envInputs, ...cliInputs };

    // Set working directory if specified
    if (options.cwd) {
      process.chdir(resolve(options.cwd));
    }

    spinner.text = 'Parsing module...';
    const content = await readFile(filePath, 'utf-8');
    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of parseResult.errors) {
        console.error(chalk.red(error.toFormattedString()));
      }
      process.exit(1);
    }

    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const sandbox = (options.sandbox || 'process') as SandboxMode;
    const format = (options.format || 'text') as OutputFormat;

    // Dry run mode
    if (options.dryRun) {
      spinner.stop();
      console.log(dryRun(parseResult.ast, inputs));
      return;
    }

    // Set up breakpoints
    const breakpointManager = new BreakpointManager();
    if (options.breakpoints) {
      breakpointManager.parse(options.breakpoints);
    }

    // Set up resource monitor
    const monitor = new ResourceMonitor();
    if (options.resourceMonitor) {
      monitor.start();
    }

    // Filter sections if specified
    let ast = parseResult.ast as any;
    if (options.sections && options.sections.length > 0) {
      const sectionNames = new Set(options.sections);
      ast = {
        ...ast,
        sections: (ast.sections || []).filter((s: any) => sectionNames.has(s.name)),
      };
    }

    spinner.text = 'Executing module...';

    let result: ExecutionResult;

    if (options.step || options.breakpoints) {
      // Section-by-section execution with step/breakpoint support
      result = await executeSectionBySection(ast, {
        inputs,
        timeout,
        sandbox,
        breakpoints: breakpointManager,
        monitor,
        stepMode: options.step || false,
        verbose: options.verbose || false,
      });
    } else {
      // Standard execution
      result = await executeWithSandbox(ast, {
        inputs,
        timeout,
        sandbox,
      });
    }

    // Stop resource monitor
    if (options.resourceMonitor) {
      monitor.stop();
      result.resources = monitor.getPeak();
    }

    spinner.stop();

    // Save execution history
    const history = await loadHistory();
    const entry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      file: filePath,
      success: result.success,
      timeMs: result.timeMs,
      sections: result.sections.length,
      inputHash: simpleHash(JSON.stringify(inputs)),
    };
    history.push(entry);
    await saveHistory(history);

    // Save replay if requested
    if (options.replay) {
      result.history = history;
      await saveReplay(result, filePath);
      console.log(chalk.green(`Replay saved to replays/`));
    }

    // Show execution history if requested
    if (options.history) {
      console.log(chalk.cyan('\n  Execution History'));
      console.log(chalk.gray('  ' + '='.repeat(50)));
      for (const h of history.slice(-10)) {
        const status = h.success ? chalk.green('OK') : chalk.red('FAIL');
        console.log(chalk.gray(`  ${h.timestamp} ${status} ${h.timeMs.toFixed(0)}ms [${h.file}]`));
      }
      return;
    }

    // Variable inspection
    if (options.inspect) {
      console.log(inspectVariables(result, options.inspect));
      return;
    }

    // Format output
    switch (format) {
      case 'json':
        console.log(formatStructured(result));
        break;

      case 'structured':
        console.log(formatStructured(result));
        break;

      case 'text':
      default:
        console.log(formatText(result));
        break;
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export {
  ResourceMonitor,
  BreakpointManager,
  loadHistory,
  saveHistory,
  loadReplay,
  saveReplay,
  parseInputs,
  inspectVariables,
  dryRun,
};
