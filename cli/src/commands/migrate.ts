/**
 * MAM Migration Command
 * 
 * Migrates v1 MAM modules to v2 format.
 */

import { readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { parseMAM } from '@mam/parser';

export interface MigrateOptions {
  file: string;
  inPlace?: boolean;
  backup?: boolean;
  dryRun?: boolean;
}

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const spinner = ora('Migrating module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');

    spinner.text = 'Analyzing module...';
    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      for (const error of parseResult.errors) {
        console.error(chalk.red(`  ${error.message}`));
      }
      process.exit(1);
    }

    // Generate v2 format
    spinner.text = 'Generating v2 format...';
    const v2Content = generateV2Content(parseResult.ast, content);

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan('\nGenerated v2 format:\n'));
      console.log(v2Content);
      return;
    }

    // Create backup
    if (options.backup !== false) {
      const backupPath = filePath + '.bak';
      await writeFile(backupPath, content, 'utf-8');
      console.log(chalk.gray(`  Backup created: ${backupPath}`));
    }

    // Write new format
    if (options.inPlace) {
      await writeFile(filePath, v2Content, 'utf-8');
      console.log(chalk.green(`\n✓ Migrated: ${filePath}`));
    } else {
      const outPath = filePath.replace('.mam.md', '.v2.mam.md');
      await writeFile(outPath, v2Content, 'utf-8');
      console.log(chalk.green(`\n✓ Migrated: ${outPath}`));
    }

    console.log(chalk.gray(`  Sections: ${parseResult.ast.sections.length}`));
    console.log(chalk.gray(`  Code blocks: ${parseResult.ast.metadata.codeBlockCount}`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

function generateV2Content(ast: any, original: string): string {
  const lines: string[] = [];
  const fm = ast.frontmatter?.data;

  // Generate v2 front matter
  lines.push('---');
  if (fm) {
    lines.push(`id: ${fm.id || 'module'}`);
    lines.push(`version: ${fm.version || '1.0.0'}`);
    lines.push(`name: ${fm.name || 'Module'}`);
    lines.push(`author: ${fm.author || 'Unknown'}`);
    lines.push(`runtime: ${fm.runtime || 'python'}`);
    if (fm.tags && fm.tags.length > 0) {
      lines.push('tags:');
      for (const tag of fm.tags) {
        lines.push(`  - ${tag}`);
      }
    }
    if (fm.description) {
      lines.push(`description: ${fm.description}`);
    }
    if (fm.permissions && fm.permissions.length > 0) {
      lines.push('permissions:');
      for (const perm of fm.permissions) {
        lines.push(`  - ${perm}`);
      }
    }
  }
  lines.push('---');
  lines.push('');

  // Generate v2 sections
  for (const section of ast.sections || []) {
    lines.push(`## ${section.name}`);
    lines.push('');

    for (const content of section.content || []) {
      if (content.type === 'paragraph') {
        lines.push(content.value);
        lines.push('');
      } else if (content.type === 'list') {
        for (const item of content.items || []) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      } else if (content.type === 'codeblock') {
        lines.push('```' + (content.language || ''));
        lines.push(content.value);
        lines.push('```');
        lines.push('');
      } else if (content.type === 'table') {
        if (content.headers) {
          lines.push('| ' + content.headers.join(' | ') + ' |');
          lines.push('|' + content.headers.map(() => '---').join('|') + '|');
          for (const row of content.rows || []) {
            lines.push('| ' + row.join(' | ') + ' |');
          }
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}