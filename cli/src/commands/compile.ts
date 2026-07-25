/**
 * MAM Compile Command
 * 
 * Compiles MAM modules to target languages.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { parseMAM } from '@mam/parser';
import { MAMCompiler, type CompileTarget } from '@mam/compiler';
import chalk from 'chalk';
import ora from 'ora';

export interface CompileOptions {
  file: string;
  target: CompileTarget;
  outDir?: string;
  indent?: number;
  comments?: boolean;
  verbose?: boolean;
}

export async function compileCommand(options: CompileOptions): Promise<void> {
  const spinner = ora('Compiling module...').start();

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

    spinner.text = `Compiling to ${options.target}...`;
    const compiler = new MAMCompiler();
    const compileResult = compiler.compile(result.ast.sections as any[], {
      target: options.target,
      indent: options.indent || 4,
      includeComments: options.comments || false,
    });

    if (!compileResult.success) {
      spinner.fail('Compilation failed');
      for (const error of compileResult.errors) {
        console.error(chalk.red(`  ${error}`));
      }
      process.exit(1);
    }

    // Write output
    const outDir = options.outDir || join(process.cwd(), 'dist');
    try {
      await access(outDir);
    } catch {
      await mkdir(outDir, { recursive: true });
    }

    const ext = getExtension(options.target);
    const outFile = join(outDir, `${basename(options.file, '.mam.md')}.${ext}`);
    await writeFile(outFile, compileResult.output, 'utf-8');

    spinner.succeed(`Compiled: ${outFile}`);

    if (options.verbose) {
      console.log(chalk.gray(`  Target: ${compileResult.target}`));
      console.log(chalk.gray(`  Modules: ${compileResult.stats.modulesCompiled}`));
      console.log(chalk.gray(`  Lines: ${compileResult.stats.linesGenerated}`));
      console.log(chalk.gray(`  Time: ${compileResult.stats.timeMs.toFixed(2)}ms`));
    }

    if (compileResult.warnings.length > 0) {
      for (const warning of compileResult.warnings) {
        console.log(chalk.yellow(`  Warning: ${warning}`));
      }
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

function getExtension(target: CompileTarget): string {
  switch (target) {
    case 'python': return 'py';
    case 'javascript': return 'js';
    case 'typescript': return 'ts';
    case 'go': return 'go';
    case 'rust': return 'rs';
    case 'json': return 'json';
    case 'yaml': return 'yaml';
    default: return 'txt';
  }
}