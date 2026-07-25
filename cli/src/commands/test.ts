/**
 * MAM Test Command
 * 
 * Runs tests for MAM modules.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { validate } from '@mam/validator';
import chalk from 'chalk';
import ora from 'ora';

export interface TestOptions {
  file?: string;
  dir?: string;
  verbose?: boolean;
}

export async function testCommand(options: TestOptions): Promise<void> {
  const spinner = ora('Running tests...').start();

  try {
    if (options.file) {
      // Test single file
      const filePath = resolve(options.file);
      const content = await readFile(filePath, 'utf-8');
      
      spinner.text = 'Parsing module...';
      const parseResult = parseMAM(content, { source: filePath });

      if (parseResult.errors.length > 0) {
        spinner.fail('Parse errors found');
        for (const error of parseResult.errors) {
          console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
      }

      spinner.text = 'Validating module...';
      const validationResult = validate(parseResult.ast);

      spinner.stop();

      if (validationResult.valid) {
        console.log(chalk.green('✓ Module tests passed'));
      } else {
        console.log(chalk.red('✗ Module tests failed'));
        for (const error of validationResult.errors) {
          console.error(chalk.red(`  ${error.message}`));
        }
        process.exit(1);
      }
    } else {
      // Test all modules in directory
      spinner.text = 'Scanning for modules...';
      const dir = resolve(options.dir || '.');
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dir);
      const mamFiles = entries.filter(e => e.endsWith('.mam.md') || e.endsWith('.mam'));

      if (mamFiles.length === 0) {
        spinner.warn('No MAM modules found');
        return;
      }

      let passed = 0;
      let failed = 0;

      for (const file of mamFiles) {
        spinner.text = `Testing ${file}...`;
        const content = await readFile(join(dir, file), 'utf-8');
        const parseResult = parseMAM(content, { source: file });

        if (parseResult.errors.length > 0) {
          console.log(chalk.red(`  ✗ ${file}: Parse errors`));
          failed++;
          continue;
        }

        const validationResult = validate(parseResult.ast);
        if (validationResult.valid) {
          console.log(chalk.green(`  ✓ ${file}`));
          passed++;
        } else {
          console.log(chalk.red(`  ✗ ${file}: ${validationResult.errors.length} error(s)`));
          failed++;
        }
      }

      spinner.stop();
      console.log(chalk.gray(`\n${passed} passed, ${failed} failed`));
      process.exit(failed > 0 ? 1 : 0);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

function join(...paths: string[]): string {
  return paths.join('/');
}