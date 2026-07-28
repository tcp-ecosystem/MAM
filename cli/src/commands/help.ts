/**
 * MAM Help Command
 */

import chalk from 'chalk';

export function showHelp(): void {
  console.log(chalk.cyan('\nMAM — Markdown as Module\n'));
  console.log(chalk.white('Usage: mam <command> [options]\n'));
  console.log(chalk.yellow('Module Management:'));
  console.log('  init [name]          Initialize a new MAM module');
  console.log('  build <file>         Build module to AST');
  console.log('  validate <file>      Validate a MAM module');
  console.log('  run <file>           Run a MAM module');
  console.log('  compile <file>       Compile to target language');
  console.log('');
  console.log(chalk.yellow('Development:'));
  console.log('  lint <file>          Lint a MAM module');
  console.log('  format <file>        Format a MAM module');
  console.log('  graph                Show dependency graph');
  console.log('  ast <file>           Dump AST');
  console.log('  test [file]          Run module tests');
  console.log('');
  console.log(chalk.yellow('Execution:'));
  console.log('  execute <file>       Execute module');
  console.log('  export <file>        Export to format');
  console.log('');
  console.log(chalk.yellow('Package Management:'));
  console.log('  install              Install dependencies');
  console.log('  publish              Publish to registry');
  console.log('');
  console.log(chalk.yellow('Utilities:'));
  console.log('  doctor               Check environment');
  console.log('  docs <file>          Generate documentation');
  console.log('  serve                Start dev server');
  console.log('  migrate <file>       Migrate v1 to v2');
  console.log('');
}
