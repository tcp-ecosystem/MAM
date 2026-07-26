/**
 * MAM Build Command
 * 
 * Builds/compiles MAM modules.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

export interface BuildOptions {
  file: string;
  outDir?: string;
  format?: 'json' | 'ast';
  minify?: boolean;
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const spinner = ora('Building module...').start();

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

    spinner.text = 'Serializing...';
    const json = serializeToJSON(result.ast as any, options.minify ? 'compact' : 'json');

    const outDir = options.outDir || join(process.cwd(), 'dist');
    try {
      await access(outDir);
    } catch {
      await mkdir(outDir, { recursive: true });
    }

    const baseName = basename(options.file, '.mam.md');
    const outFile = join(outDir, `${baseName}.${options.format || 'json'}`);
    await writeFile(outFile, json, 'utf-8');

    spinner.succeed(`Built: ${outFile}`);
    console.log(chalk.gray(`Sections: ${result.ast.metadata.sectionCount}`));
    console.log(chalk.gray(`Code blocks: ${result.ast.metadata.codeBlockCount}`));
    console.log(chalk.gray(`Parse time: ${result.stats.parseTimeMs.toFixed(2)}ms`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}