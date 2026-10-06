/**
 * MAM Project Commands
 *
 * Project-level composition for multi-file MAM projects described by
 * `mam.toml`: init, info, graph, validate and build.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import chalk from 'chalk';
import { MAM_VERSION } from '@mam/ast';
import { Project } from '../project/loader.js';
import { graphToMermaid, graphToText } from '../project/graph.js';
import { renderManifest, DEFAULT_MODULE_GLOBS } from '../project/manifest.js';
import { MAMCompilerEngine, ConfigLoader, getExtension, type CompileTarget } from './compile.js';

export interface ProjectOptions {
  dir?: string;
  target?: string;
  format?: 'text' | 'json' | 'mermaid';
  quiet?: boolean;
  force?: boolean;
}

export interface ProjectBuildSummary {
  project: string;
  targets: string[];
  written: string[];
  errors: string[];
  moduleCount: number;
}

async function openProject(options: ProjectOptions): Promise<Project> {
  const start = options.dir ? resolve(options.dir) : process.cwd();
  return Project.load(start);
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const STARTER_MODULE = `---
id: hello
name: Hello
version: 2.0.0
type: module
author: MAM Team
description: >
  A starter MAM module.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - starter
capabilities:
  - greet
permissions:
  filesystem:
    - read
---

# Hello

## Purpose

A starter module created by \`mam project init\`.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | No | Name to greet |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| greeting | string | Greeting message |

## Capabilities

### greet

Return a greeting for the given name.

## Rules

- Always return a greeting.

## Workflow

\`\`\`mermaid
flowchart TD
    A[Input] --> B[Greet]
    B --> C[Output]
\`\`\`

## Python

\`\`\`python
def greet(name: str = "World") -> str:
    return f"Hello, {name}!"
\`\`\`

## Tests

### Input

\`\`\`yaml
name: World
\`\`\`

### Expected

\`\`\`yaml
greeting: Hello, World!
\`\`\`

## Examples

\`\`\`python
print(greet("MAM"))
\`\`\`

## References

- MAM documentation
`;

const STARTER_SYSTEM = `---
id: system
name: My System
version: 2.0.0
type: system
author: MAM Team
description: >
  Composes the modules in this project.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - system
dependencies:
  - name: hello
    version: ">=2.0.0"
capabilities:
  - orchestrate
permissions:
  filesystem:
    - read
---

# My System

## Purpose

Entry system that composes the project modules.

## Modules

- Hello

## Rules

- Compose modules in declared order.

## Workflow

\`\`\`mermaid
flowchart LR
    Hello --> Output
\`\`\`
`;

export async function projectInitCommand(options: ProjectOptions): Promise<void> {
  const root = options.dir ? resolve(options.dir) : process.cwd();
  const manifestPath = join(root, 'mam.toml');

  try {
    await readFile(manifestPath, 'utf-8');
    if (!options.force) {
      console.error(chalk.red(`mam.toml already exists at ${manifestPath}. Use --force to overwrite.`));
      process.exit(1);
    }
  } catch {
    // expected: no existing manifest
  }

  const name = basename(root);
  const manifest = renderManifest(
    { name, version: MAM_VERSION, description: `${name} MAM project`, license: 'MIT' },
    { entry: 'system.mam', modules: DEFAULT_MODULE_GLOBS, outDir: 'dist', targets: ['python'] },
  );

  await mkdir(join(root, 'modules'), { recursive: true });
  await writeFile(manifestPath, manifest, 'utf-8');
  await writeFile(join(root, 'modules', 'hello.mam'), STARTER_MODULE, 'utf-8');
  await writeFile(join(root, 'modules', 'hello.mam.md'), STARTER_MODULE, 'utf-8');
  await writeFile(join(root, 'system.mam'), STARTER_SYSTEM, 'utf-8');
  await writeFile(join(root, 'system.mam.md'), STARTER_SYSTEM, 'utf-8');

  console.log(chalk.green(`Initialized MAM project "${name}"`));
  console.log(chalk.gray(`  ${relative(process.cwd(), manifestPath)}`));
  console.log(chalk.gray(`  ${relative(process.cwd(), join(root, 'modules', 'hello.mam'))}`));
  console.log(chalk.gray(`  ${relative(process.cwd(), join(root, 'system.mam'))}`));
}

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------

export async function projectInfoCommand(options: ProjectOptions): Promise<void> {
  const project = await openProject(options);
  const modules = await project.loadAllModules();
  const entry = await project.loadEntry();

  if (options.format === 'json') {
    console.log(JSON.stringify({
      root: project.root,
      manifest: project.manifest.project,
      entry: entry ? entry.relativePath : null,
      targets: project.manifest.build.targets,
      outDir: project.manifest.build.outDir,
      moduleCount: modules.length,
      modules: modules.map((m) => ({ id: m.id, name: m.name, type: m.type, file: m.relativePath })),
    }, null, 2));
    return;
  }

  console.log(chalk.cyan(`\n  ${project.manifest.project.name} `) + chalk.gray(`v${project.manifest.project.version}`));
  console.log(chalk.gray(`  ${project.manifest.project.description ?? ''}`));
  console.log('');
  console.log(chalk.white('  Root:     ') + chalk.gray(project.root));
  console.log(chalk.white('  Entry:    ') + chalk.gray(entry ? entry.relativePath : '(none)'));
  console.log(chalk.white('  Targets:  ') + chalk.gray(project.manifest.build.targets.join(', ')));
  console.log(chalk.white('  Out dir:  ') + chalk.gray(project.manifest.build.outDir));
  console.log(chalk.white('  Modules:  ') + chalk.gray(String(modules.length)));
  console.log('');
  for (const mod of modules) {
    console.log(chalk.gray(`    - ${mod.id} `) + chalk.gray(`(${mod.type}) ${mod.relativePath}`));
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

export async function projectGraphCommand(options: ProjectOptions): Promise<void> {
  const project = await openProject(options);
  const modules = await project.loadAllModules();
  const graph = project.buildGraph(modules);

  if (options.format === 'json') {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  if (options.format === 'mermaid') {
    console.log(graphToMermaid(graph));
    return;
  }
  console.log(graphToText(graph));
  if (graph.cycles.length === 0) {
    console.log(chalk.gray(`\n${graph.nodes.filter((n) => !n.external).length} modules, ${graph.edges.length} edges`));
  }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export async function projectValidateCommand(options: ProjectOptions): Promise<void> {
  const project = await openProject(options);
  const result = await project.validate();

  if (options.format === 'json') {
    console.log(JSON.stringify({
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      moduleCount: result.modules.length,
      externalDependencies: result.externalDependencies,
    }, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  if (result.valid) {
    console.log(chalk.green(`Project valid: ${result.modules.length} modules`));
  } else {
    console.log(chalk.red(`Project invalid: ${result.errors.length} error(s)`));
  }
  for (const err of result.errors) console.log(chalk.red(`  ✗ ${err}`));
  for (const warn of result.warnings) console.log(chalk.yellow(`  ! ${warn}`));

  process.exit(result.valid ? 0 : 1);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export async function projectBuildCommand(options: ProjectOptions): Promise<ProjectBuildSummary> {
  const project = await openProject(options);
  const modules = await project.loadAllModules();

  const targets = options.target ? [options.target] : project.manifest.build.targets;
  const outDir = resolve(project.root, project.manifest.build.outDir);
  await mkdir(outDir, { recursive: true });

  const config = await ConfigLoader.load(project.root);
  const engine = new MAMCompilerEngine(config);

  const all = modules;

  const written: string[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    for (const mod of all) {
      if (mod.errors.length > 0) {
        errors.push(`${mod.relativePath}: ${mod.errors.join(', ')}`);
        continue;
      }
      const result = await engine.compileFile(mod.filePath, target as CompileTarget, { file: mod.filePath, target: target as CompileTarget });
      if (!result.success) {
        errors.push(`${mod.relativePath} [${target}]: ${result.errors.join(', ')}`);
        continue;
      }
      const base = basename(mod.relativePath).replace(/\.mam(\.md)?$/, '');
      const outPath = join(outDir, `${base}.mam.${getExtension(target as CompileTarget)}`);
      await writeFile(outPath, result.output, 'utf-8');
      written.push(relative(project.root, outPath).replace(/\\/g, '/'));
    }
  }

  const summary: ProjectBuildSummary = {
    project: project.manifest.project.name,
    targets,
    written,
    errors,
    moduleCount: all.length,
  };

  if (options.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log(chalk.cyan(`\n  Built ${summary.project} (${summary.moduleCount} modules × ${targets.length} target(s))`));
  for (const file of written) console.log(chalk.gray(`    ${file}`));
  for (const err of errors) console.log(chalk.red(`    ✗ ${err}`));
  if (errors.length === 0) console.log(chalk.green('\n  Build complete.'));

  return summary;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export interface ProjectRunOptions extends ProjectOptions {
  inputs?: string;
  timeout?: number;
  verbose?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

export async function projectRunCommand(options: ProjectRunOptions): Promise<void> {
  const project = await openProject(options);
  const entry = await project.loadEntry();
  if (!entry) {
    console.error(chalk.red('No entry system found. Set build.entry in mam.toml or add system.mam.'));
    process.exit(1);
  }

  const { runCommand } = await import('./run.js');
  await runCommand({
    file: entry.filePath,
    inputs: options.inputs,
    timeout: options.timeout,
    verbose: options.verbose,
    quiet: options.quiet,
    format: options.format === 'json' ? 'json' : 'text',
    dryRun: options.dryRun,
  });
}

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------

export async function projectTestCommand(
  options: ProjectOptions & { verbose?: boolean; timeout?: number },
): Promise<void> {
  const project = await openProject(options);
  const modules = await project.loadAllModules();
  const { runTests, formatTestResult } = await import('./test.js');

  let total = 0;
  let passed = 0;
  let failed = 0;

  for (const mod of modules) {
    const result = await runTests({ file: mod.filePath, verbose: options.verbose, timeout: options.timeout });
    total += result.total;
    passed += result.passed;
    failed += result.failed;
    if (result.total > 0) {
      console.log(chalk.cyan(`\n${mod.relativePath}`));
      console.log(formatTestResult(result, !!options.verbose));
    }
  }

  console.log(chalk.cyan(`\nProject tests: ${passed}/${total} passed, ${failed} failed (${modules.length} modules)`));
  process.exit(failed > 0 ? 1 : 0);
}
