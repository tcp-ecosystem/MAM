/**
 * MAM Validate Command
 * 
 * Validates MAM modules against the specification.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { validate, formatValidationError, formatValidationWarning } from '@mam/validator';
import chalk from 'chalk';
import ora from 'ora';

export interface ValidateOptions {
  file: string;
  level?: 'syntax' | 'schema' | 'semantic' | 'strict';
  format?: 'text' | 'json';
  warnings?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const spinner = ora('Validating module...').start();

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

    spinner.text = 'Validating module...';
    const validationResult = validate(parseResult.ast, {
      level: options.level || 'schema',
    });

    spinner.stop();

    if (options.format === 'json') {
      console.log(JSON.stringify(validationResult, null, 2));
    } else {
      if (validationResult.errors.length > 0) {
        console.error(chalk.red(`\n${validationResult.errors.length} error(s) found:\n`));
        for (const error of validationResult.errors) {
          console.error(chalk.red(formatValidationError(error)));
        }
      }

      if (options.warnings !== false && validationResult.warnings.length > 0) {
        console.log(chalk.yellow(`\n${validationResult.warnings.length} warning(s) found:\n`));
        for (const warning of validationResult.warnings) {
          console.log(chalk.yellow(formatValidationWarning(warning)));
        }
      }

      if (validationResult.valid) {
        console.log(chalk.green('\n✓ Module is valid'));
      } else {
        console.log(chalk.red('\n✗ Module is invalid'));
      }

      console.log(chalk.gray(`\nValidation completed in ${validationResult.stats.timeMs.toFixed(2)}ms`));
      console.log(chalk.gray(`Rules checked: ${validationResult.stats.rulesChecked}`));
    }

    process.exit(validationResult.valid ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}