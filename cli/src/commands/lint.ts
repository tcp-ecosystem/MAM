/**
 * MAM Lint Command
 * 
 * Lints MAM modules for style, best practices, and security issues.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { MAMLinter, LintConfig } from '../utils/linter.js';

export interface LintOptions {
  file: string;
  level?: 'error' | 'warning' | 'info';
  format?: 'text' | 'json';
  fix?: boolean;
}

export async function lintCommand(options: LintOptions): Promise<void> {
  const spinner = ora('Linting module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    const config: Partial<LintConfig> = {};
    if (options.level) config.level = options.level;

    const linter = new MAMLinter(config);
    const result = linter.lint(content, filePath);

    spinner.stop();

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.issues.length > 0) {
        console.log(chalk.cyan(`\n${result.summary.total} issue(s) found:\n`));

        for (const issue of result.issues) {
          const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
          const color = issue.severity === 'error' ? chalk.red : issue.severity === 'warning' ? chalk.yellow : chalk.blue;
          
          console.log(color(`  ${icon} ${issue.line}:${issue.column} ${issue.message}`));
          console.log(chalk.gray(`     Rule: ${issue.rule} | Code: ${issue.code}`));
          if (issue.fix) {
            console.log(chalk.gray(`     Fix: ${issue.fix}`));
          }
        }
      } else {
        console.log(chalk.green('\n✓ No issues found'));
      }

      console.log(chalk.gray(`\nSummary: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.info} info`));
    }

    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}