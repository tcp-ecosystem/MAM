/**
 * MAM Format Command
 * 
 * Formats MAM modules with consistent style.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

export interface FormatOptions {
  file: string;
  inPlace?: boolean;
  check?: boolean;
}

export async function formatCommand(options: FormatOptions): Promise<void> {
  const spinner = ora('Formatting module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const formatted: string[] = [];
    let lastEmpty = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!.replace(/\s+$/, ''); // Remove trailing whitespace

      // Normalize multiple blank lines to single
      if (line.trim() === '') {
        if (lastEmpty) continue;
        lastEmpty = true;
      } else {
        lastEmpty = false;
      }

      // Ensure file ends with newline
      if (i === lines.length - 1 && line.length > 0) {
        formatted.push(line);
        formatted.push('');
      } else {
        formatted.push(line);
      }
    }

    const result = formatted.join('\n');
    spinner.stop();

    if (options.check) {
      if (result === content) {
        console.log(chalk.green('File is already formatted'));
        process.exit(0);
      } else {
        console.log(chalk.yellow('File needs formatting'));
        process.exit(1);
      }
    }

    if (options.inPlace) {
      await writeFile(filePath, result, 'utf-8');
      console.log(chalk.green(`Formatted: ${filePath}`));
    } else {
      console.log(result);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}