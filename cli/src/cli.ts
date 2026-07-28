#!/usr/bin/env node

/**
 * MAM CLI Entry Point
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('mam')
  .description('MAM — Markdown as Module CLI')
  .version(pkg.version);

// Register commands
program.command('init').description('Initialize a new MAM module').action(async () => {
  const { initCommand } = await import('./commands/init.js');
  await initCommand({});
});

program.command('build').description('Build module to AST').argument('[file]').action(async (file: string) => {
  const { buildCommand } = await import('./commands/build.js');
  await buildCommand({ file });
});

program.command('validate').description('Validate a MAM module').argument('<file>').action(async (file: string) => {
  const { validateCommand } = await import('./commands/validate.js');
  await validateCommand({ file });
});

program.command('lint').description('Lint a MAM module').argument('<file>').action(async (file: string) => {
  const { lintCommand } = await import('./commands/lint.js');
  await lintCommand({ file });
});

program.command('format').description('Format a MAM module').argument('<file>').action(async (file: string) => {
  const { formatCommand } = await import('./commands/format.js');
  await formatCommand({ file, inPlace: true });
});

program.command('graph').description('Show dependency graph').action(async () => {
  const { graphCommand } = await import('./commands/graph.js');
  await graphCommand({});
});

program.command('ast').description('Dump AST').argument('<file>').action(async (file: string) => {
  const { astCommand } = await import('./commands/ast.js');
  await astCommand({ file });
});

program.command('compile').description('Compile to target language').argument('<file>').option('-t, --target <target>', 'target language').action(async (file: string, options: { target?: string }) => {
  const { compileCommand } = await import('./commands/compile.js');
  await compileCommand({ file, target: (options.target || 'python') as any });
});

program.command('run').description('Run a MAM module').argument('<file>').action(async (file: string) => {
  const { runCommand } = await import('./commands/run.js');
  await runCommand({ file });
});

program.command('migrate').description('Migrate v1 to v2').argument('<file>').action(async (file: string) => {
  const { migrateCommand } = await import('./commands/migrate.js');
  await migrateCommand({ file });
});

program.parse();
