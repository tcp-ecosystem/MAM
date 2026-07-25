/**
 * MAM Run Command
 * 
 * Executes a MAM module (v2 compatible).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { executeModule } from '@mam/runtime';
import chalk from 'chalk';
import ora from 'ora';

export interface RunOptions {
  file: string;
  inputs?: string;
  timeout?: number;
  target?: string;
  verbose?: boolean;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const spinner = ora('Running module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    spinner.text = 'Parsing module...';
    const result = parseMAM(content, { source: filePath });

    if (result.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of result.errors) {
        console.error(chalk.red(error.toFormattedString()));
      }
      process.exit(1);
    }

    // Parse inputs
    let inputs: Record<string, unknown> = {};
    if (options.inputs) {
      try {
        inputs = JSON.parse(options.inputs);
      } catch {
        spinner.fail('Invalid inputs JSON');
        process.exit(1);
      }
    }

    spinner.text = 'Executing...';
    const execResult = await executeModule(result.ast, {
      defaultTimeout: options.timeout || 30000,
    }, {
      inputs,
    });

    spinner.stop();

    if (execResult.success) {
      console.log(chalk.green('\nExecution completed successfully'));
      if (execResult.output && Object.keys(execResult.output).length > 0) {
        console.log(chalk.cyan('\nOutput:'));
        console.log(JSON.stringify(execResult.output, null, 2));
      }
    } else {
      console.log(chalk.red('\nExecution failed'));
      for (const error of execResult.errors) {
        console.error(chalk.red(`  ${error}`));
      }
    }

    if (options.verbose) {
      console.log(chalk.gray(`\nTime: ${execResult.timeMs.toFixed(2)}ms`));
    }

    process.exit(execResult.success ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}