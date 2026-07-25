/**
 * MAM Format Command
 * 
 * Formats MAM modules with consistent style.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { MAMFormatter, FormatConfig } from '../utils/formatter.js';

export interface FormatOptions {
  file: string;
  inPlace?: boolean;
  check?: boolean;
  indent?: number;
  maxLineLength?: number;
}

export async function formatCommand(options: FormatOptions): Promise<void> {
  const spinner = ora('Formatting module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    const config: Partial<FormatConfig> = {};
    if (options.indent) config.indent = options.indent;
    if (options.maxLineLength) config.maxLineLength = options.maxLineLength;

    const formatter = new MAMFormatter(config);
    const result = formatter.format(content);

    spinner.stop();

    if (options.check) {
      if (result.changed) {
        console.log(chalk.yellow('File needs formatting'));
        console.log(chalk.gray(`  Changes: ${result.changeCount}`));
        process.exit(1);
      } else {
        console.log(chalk.green('File is already formatted'));
        process.exit(0);
      }
    }

    if (options.inPlace) {
      if (result.changed) {
        await writeFile(filePath, result.formatted, 'utf-8');
        console.log(chalk.green(`Formatted: ${filePath}`));
        console.log(chalk.gray(`  Changes: ${result.changeCount}`));
      } else {
        console.log(chalk.gray('No changes needed'));
      }
    } else {
      console.log(result.formatted);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}