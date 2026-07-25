#!/usr/bin/env node

/**
 * MAM CLI
 * 
 * Command-line interface for Markdown as Module (MAM).
 * v2: System Description Language support.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { validateCommand } from './commands/validate.js';
import { astCommand } from './commands/ast.js';
import { executeCommand } from './commands/execute.js';
import { runCommand } from './commands/run.js';
import { compileCommand } from './commands/compile.js';

const program = new Command();

program
  .name('mam')
  .description('MAM — Machine Agent Module CLI (System Description Language)')
  .version('2.0.0')
  .argument('[file]', 'MAM module file to process');

// Validate command
program
  .command('validate')
  .description('Validate a MAM module')
  .argument('<file>', 'MAM module file to validate')
  .option('-l, --level <level>', 'Validation level (syntax|schema|semantic|strict)', 'schema')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('-W, --no-warnings', 'Hide warnings')
  .action(async (file, options) => {
    await validateCommand({ file, ...options });
  });

// AST command
program
  .command('ast')
  .description('Display the AST of a MAM module')
  .argument('<file>', 'MAM module file')
  .option('-f, --format <format>', 'Output format (json|pretty|stats)', 'pretty')
  .action(async (file, options) => {
    await astCommand({ file, ...options });
  });

// Execute command (v1)
program
  .command('execute')
  .alias('exec')
  .description('Execute a MAM module (v1)')
  .argument('<file>', 'MAM module file to execute')
  .option('-s, --sections <sections>', 'Sections to execute (comma-separated)')
  .option('-i, --inputs <inputs>', 'Input parameters (JSON string)')
  .option('-t, --timeout <timeout>', 'Execution timeout in milliseconds', '30000')
  .option('--sandbox <sandbox>', 'Sandbox type (process|vm)', 'process')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (file, options) => {
    await executeCommand({
      file,
      sections: options.sections?.split(','),
      timeout: parseInt(options.timeout),
      ...options,
    });
  });

// Run command (v2)
program
  .command('run')
  .description('Run a MAM module (v2)')
  .argument('<file>', 'MAM module file to run')
  .option('-i, --inputs <inputs>', 'Input parameters (JSON string)')
  .option('-t, --timeout <timeout>', 'Execution timeout in milliseconds', '30000')
  .option('--target <target>', 'Execution target (python|javascript)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (file, options) => {
    await runCommand({ file, timeout: parseInt(options.timeout), ...options });
  });

// Compile command (v2)
program
  .command('compile')
  .description('Compile MAM module to target language (v2)')
  .argument('<file>', 'MAM module file to compile')
  .option('-t, --target <target>', 'Target (python|javascript|go|json|openai|langgraph|crewai)', 'python')
  .option('-o, --outDir <outDir>', 'Output directory', './dist')
  .option('--indent <indent>', 'Indentation size', '4')
  .option('--comments', 'Include comments')
  .option('-v, --verbose', 'Verbose output')
  .action(async (file, options) => {
    await compileCommand({ file, target: options.target, ...options });
  });

// Format command
program
  .command('format')
  .alias('fmt')
  .description('Format a MAM module')
  .argument('<file>', 'MAM module file to format')
  .option('-i, --in-place', 'Format in place')
  .option('-c, --check', 'Check if formatting is needed')
  .option('--indent <indent>', 'Indentation size', '4')
  .option('--max-line-length <length>', 'Max line length', '200')
  .action(async (file, options) => {
    const { formatCommand } = await import('./commands/fmt.js');
    await formatCommand({ file, ...options });
  });

// Lint command
program
  .command('lint')
  .description('Lint a MAM module')
  .argument('<file>', 'MAM module file to lint')
  .option('-l, --level <level>', 'Lint level (error|warning|info)', 'warning')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (file, options) => {
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand({ file, ...options });
  });

// Init command
program
  .command('init')
  .description('Initialize a new MAM module')
  .argument('[name]', 'Module name')
  .option('-t, --template <template>', 'Template (basic|full|agent|workflow|team)', 'basic')
  .action(async (name, options) => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand({ name, ...options });
  });

// Build command
program
  .command('build')
  .description('Build a MAM module to AST')
  .argument('<file>', 'MAM module file to build')
  .option('-o, --outDir <outDir>', 'Output directory', './dist')
  .option('-f, --format <format>', 'Output format (json|ast)', 'json')
  .action(async (file, options) => {
    const { buildCommand } = await import('./commands/build.js');
    await buildCommand({ file, ...options });
  });

// Test command
program
  .command('test')
  .description('Run tests for a MAM module')
  .argument('[file]', 'MAM module file (optional)')
  .action(async (file, options) => {
    console.log(chalk.yellow('Test command not yet implemented'));
  });

// Graph command
program
  .command('graph')
  .description('Show dependency graph')
  .option('-d, --dir <dir>', 'Directory to scan', '.')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    console.log(chalk.yellow('Graph command not yet implemented'));
  });

// Migrate command
program
  .command('migrate')
  .description('Migrate v1 module to v2 format')
  .argument('<file>', 'MAM module file to migrate')
  .option('-i, --in-place', 'Migrate in place')
  .option('--no-backup', 'Skip backup')
  .option('--dry-run', 'Show migration without applying')
  .action(async (file, options) => {
    const { migrateCommand } = await import('./commands/migrate.js');
    await migrateCommand({ file, ...options });
  });

// Docs command
program
  .command('docs')
  .description('Generate documentation for a MAM module')
  .argument('<file>', 'MAM module file')
  .option('-o, --outDir <outDir>', 'Output directory', './docs')
  .option('-f, --format <format>', 'Output format (markdown|html|json)', 'markdown')
  .option('--no-toc', 'Skip table of contents')
  .option('--no-examples', 'Skip examples')
  .option('--api', 'Include API reference')
  .action(async (file, options) => {
    console.log(chalk.yellow('Docs command not yet implemented'));
  });

// Doctor command
program
  .command('doctor')
  .description('Check environment and dependencies')
  .action(async () => {
    console.log(chalk.cyan('\nMAM Environment Check\n'));
    console.log(chalk.green('  Node.js: ' + process.version));
    console.log(chalk.green('  Platform: ' + process.platform));
    console.log(chalk.green('  Architecture: ' + process.arch));
  });

// Parse default argument (file to process)
program.action(async (file) => {
  if (file) {
    console.log(chalk.cyan(`Processing: ${file}`));
    await validateCommand({ file, level: 'schema' });
  } else {
    program.help();
  }
});

// Parse and execute
program.parse();