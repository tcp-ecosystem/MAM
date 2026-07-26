/**
 * MAM AST Command
 * 
 * Displays the AST of a MAM module.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON, prettyPrint, getASTStats } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

export interface ASTOptions {
  file: string;
  format?: 'json' | 'pretty' | 'stats';
  indent?: number;
}

export async function astCommand(options: ASTOptions): Promise<void> {
  const spinner = ora('Parsing module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of parseResult.errors) {
        console.error(chalk.red(error.toFormattedString()));
      }
      process.exit(1);
    }

    spinner.stop();

    switch (options.format) {
      case 'json':
        console.log(serializeToJSON(parseResult.ast as any));
        break;
      
      case 'stats':
        const stats = getASTStats(parseResult.ast as any);
        console.log(chalk.cyan('\nAST Statistics:\n'));
        console.log(`  Sections:      ${stats.totalSections}`);
        console.log(`  Total Nodes:   ${stats.totalNodes}`);
        console.log(`  Code Blocks:   ${stats.totalCodeBlocks}`);
        console.log(`  Tables:        ${stats.totalTables}`);
        console.log(`  Lists:         ${stats.totalLists}`);
        console.log(`  Languages:     ${stats.languages.join(', ') || 'none'}`);
        break;
      
      case 'pretty':
      default:
        console.log(chalk.cyan('\nAST Structure:\n'));
        console.log(prettyPrint(parseResult.ast as any));
        break;
    }

    console.log(chalk.gray(`\nParse time: ${parseResult.stats.parseTimeMs.toFixed(2)}ms`));
    console.log(chalk.gray(`Tokens: ${parseResult.stats.totalTokens}`));
    console.log(chalk.gray(`Lines: ${parseResult.stats.totalLines}`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}