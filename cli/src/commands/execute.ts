/**
 * MAM Execute Command
 * 
 * Executes a MAM module.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { executeModule } from '@mam/runtime';
import chalk from 'chalk';
import ora from 'ora';

export interface ExecuteOptions {
  file: string;
  sections?: string[];
  inputs?: string;
  timeout?: number;
  sandbox?: 'process' | 'vm';
  format?: 'text' | 'json';
}

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  const spinner = ora('Loading module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    spinner.text = 'Parsing module...';
    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of parseResult.errors) {
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

    spinner.text = 'Executing module...';
    
    const result = await executeModule(parseResult.ast as any, {
      defaultTimeout: options.timeout || 30000,
    }, {
      inputs,
    });

    spinner.stop();

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.validation && !result.validation.valid) {
        console.error(chalk.red('\nValidation failed:'));
        for (const error of result.validation.errors) {
          console.error(chalk.red(`  ${error.message}`));
        }
      }

      if (result.errors.length > 0) {
        console.error(chalk.red('\nExecution errors:'));
        for (const error of result.errors) {
          console.error(chalk.red(`  ${error}`));
        }
      }

      if (result.success) {
        console.log(chalk.green('\n✓ Module executed successfully'));
        
        if (Object.keys(result.output).length > 0) {
          console.log(chalk.cyan('\nOutput:'));
          console.log(JSON.stringify(result.output, null, 2));
        }
      } else {
        console.log(chalk.red('\n✗ Module execution failed'));
      }

      console.log(chalk.gray(`\nExecution time: ${result.timeMs.toFixed(2)}ms`));
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}