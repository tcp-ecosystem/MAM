/**
 * MAM LIR Command
 *
 * Inspects and invokes host-language implementations declared in a module's
 * frontmatter. Execution is explicit: nothing runs unless the user invokes
 * `mam lir invoke` or `mam run` on a module that declares implementations.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import {
  createDefaultLirRegistry,
  parseImplementationDeclarations,
  type ImplementationDeclaration,
  type LirInvocationFailure,
  type LirInvocationSuccess,
  type LirLanguage,
  type LirProbeResult,
} from '@mam/runtime/lir';
import chalk from 'chalk';

export type LirAction = 'probe' | 'list' | 'invoke';
export type LirFormat = 'text' | 'json';

export interface LirCommandOptions {
  action: LirAction;
  file?: string;
  id?: string;
  language?: string;
  input?: string;
  timeout?: number;
  format?: LirFormat;
  python?: string;
  node?: string;
  quiet?: boolean;
}

interface ParsedModule {
  projectRoot: string;
  declarations: ImplementationDeclaration[];
}

function findProjectRoot(filePath: string): string {
  const start = dirname(resolve(filePath));
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'mam.toml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

async function parseModule(filePath: string): Promise<ParsedModule> {
  const absolute = resolve(filePath);
  const content = await readFile(absolute, 'utf8');
  const parsed = parseMAM(content, { source: absolute });
  if (parsed.errors.length > 0) {
    const message = parsed.errors.map((error) => error.toFormattedString()).join('\n');
    throw new Error(`Cannot read implementations: ${message}`);
  }

  const projectRoot = findProjectRoot(absolute);
  const data = parsed.ast.frontmatter?.data as Record<string, unknown> | undefined;
  const declarations = parseImplementationDeclarations(data?.implementations, {
    source: 'implementations',
    projectRoot,
  });

  return { projectRoot, declarations };
}

function createRegistry(options: LirCommandOptions, projectRoot: string) {
  return createDefaultLirRegistry({
    projectRoot,
    python: options.python ? { pythonPath: options.python } : undefined,
    node: options.node ? { nodePath: options.node } : undefined,
  });
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function probeLine(probe: LirProbeResult): string {
  const status = probe.available ? chalk.green('available') : chalk.red('unavailable');
  const version = probe.version ? ` ${probe.version}` : '';
  const ts = probe.languages.includes('typescript')
    ? (probe.typescript ? chalk.gray(' (typescript: on)') : chalk.yellow(' (typescript: off)'))
    : '';
  const reason = probe.available
    ? (probe.reason ? chalk.gray(` - ${probe.reason}`) : '')
    : chalk.gray(` - ${probe.reason ?? 'not found'}`);
  return `  ${probe.adapter}${version}: ${status}${ts}${reason}`;
}

async function probeCommand(options: LirCommandOptions): Promise<void> {
  const registry = createRegistry(options, process.cwd());
  let probes = await registry.probeAll();

  if (options.language) {
    const language = options.language.toLowerCase();
    probes = probes.filter((probe) => probe.languages.includes(language as LirLanguage));
  }

  const wantsTypeScript = options.language?.toLowerCase() === 'typescript';
  const success = probes.length > 0 && probes.every(
    (probe) => probe.available && (!wantsTypeScript || probe.typescript === true),
  );
  if (options.format === 'json') {
    printJson({ success, adapters: probes });
  } else {
    console.log(chalk.bold('LIR adapters'));
    for (const probe of probes) console.log(probeLine(probe));
    if (probes.length === 0) {
      console.log(chalk.yellow(`  No adapter supports language "${options.language}".`));
    }
  }

  process.exitCode = success ? 0 : 1;
}

async function listCommand(options: LirCommandOptions): Promise<void> {
  if (!options.file) {
    throw new Error('mam lir list requires a .mam file');
  }

  const { projectRoot, declarations } = await parseModule(options.file);
  const registry = createRegistry(options, projectRoot);
  const probes = await registry.probeAll();
  const byLanguage = new Map(probes.flatMap((probe) => probe.languages.map((language) => [language, probe] as const)));

  const implementations = declarations.map((declaration) => {
    let entry = declaration.entry;
    let resolveError: string | undefined;
    try {
      entry = registry.resolve(declaration).entry;
    } catch (error) {
      resolveError = error instanceof Error ? error.message : String(error);
    }
    const probe = byLanguage.get(declaration.language);
    return {
      ...declaration,
      entry,
      adapter: registry.getAdapter(declaration.language)?.name,
      runtimeAvailable: probe?.available ?? false,
      typescriptAvailable: probe?.typescript,
      resolveError,
    };
  });

  if (options.format === 'json') {
    printJson({
      success: implementations.every((item) => !item.resolveError),
      file: resolve(options.file),
      projectRoot,
      implementations,
    });
  } else {
    console.log(chalk.bold(`Implementations in ${options.file}`));
    if (implementations.length === 0) {
      console.log(chalk.gray('  none declared'));
    }
    for (const item of implementations) {
      const runtime = item.runtimeAvailable ? chalk.green('runtime ok') : chalk.red('runtime missing');
      const upstream = item.inputFrom ? chalk.gray(` <- ${item.inputFrom}`) : '';
      console.log(`  ${chalk.cyan(item.id)} [${item.language}] ${item.entry}${upstream} (${runtime})`);
      if (item.resolveError) console.log(chalk.red(`    ${item.resolveError}`));
    }
  }

  process.exitCode = implementations.some((item) => item.resolveError) ? 1 : 0;
}

async function readInput(raw: string | undefined): Promise<unknown> {
  if (!raw) return {};
  if (raw.startsWith('@')) {
    return JSON.parse(await readFile(resolve(raw.slice(1)), 'utf8'));
  }
  return JSON.parse(raw);
}

async function invokeCommand(options: LirCommandOptions): Promise<void> {
  if (!options.file || !options.id) {
    throw new Error('mam lir invoke requires a .mam file and an implementation id');
  }

  const { projectRoot, declarations } = await parseModule(options.file);
  const declaration = declarations.find((item) => item.id === options.id);
  if (!declaration) {
    const known = declarations.map((item) => item.id).join(', ') || 'none';
    throw new Error(`Implementation "${options.id}" is not declared in ${options.file} (declared: ${known})`);
  }

  let input: unknown;
  try {
    input = await readInput(options.input);
  } catch (error) {
    throw new Error(`Invalid --input JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const registry = createRegistry(options, projectRoot);
  const result = await registry.invoke(declaration, input, {
    timeoutMs: options.timeout,
  });

  if (options.format === 'json') {
    printJson(result);
  } else if (!result.ok) {
    const failure = result as LirInvocationFailure;
    console.error(chalk.red(`✗ ${declaration.id}: ${failure.error.code}`));
    console.error(failure.error.message);
    if (failure.stdout.trim()) console.error(chalk.gray('stdout:\n') + failure.stdout.trimEnd());
    if (failure.stderr.trim()) console.error(chalk.gray('stderr:\n') + failure.stderr.trimEnd());
  } else {
    const success = result as LirInvocationSuccess;
    console.log(chalk.green(`✓ ${declaration.id} (${declaration.language}) ${success.durationMs}ms`));
    console.log(JSON.stringify(success.value, null, 2));
    if (success.stdout.trim()) console.log(chalk.gray('stdout:\n') + success.stdout.trimEnd());
    if (success.stderr.trim()) console.log(chalk.gray('stderr:\n') + success.stderr.trimEnd());
  }

  process.exitCode = result.ok ? 0 : 1;
}

export async function lirCommand(options: LirCommandOptions): Promise<void> {
  try {
    switch (options.action) {
      case 'probe':
        await probeCommand(options);
        return;
      case 'list':
        await listCommand(options);
        return;
      case 'invoke':
        await invokeCommand(options);
        return;
      default:
        throw new Error(`Unknown lir action: ${options.action as string}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.format === 'json') {
      printJson({ success: false, error: message });
    } else {
      console.error(chalk.red(message));
    }
    process.exitCode = 1;
  }
}
