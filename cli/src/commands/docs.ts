/**
 * MAM Docs Command
 * 
 * Generates documentation from MAM modules.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

export interface DocsOptions {
  file: string;
  outDir?: string;
}

export async function docsCommand(options: DocsOptions): Promise<void> {
  const spinner = ora('Generating docs...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');
    const result = parseMAM(content, { source: filePath });

    if (result.errors.length > 0) {
      spinner.fail('Parse errors found');
      process.exit(1);
    }

    const doc = generateDocumentation(result.ast);
    const outFile = basename(options.file, '.mam.md') + '.docs.md';
    await writeFile(outFile, doc, 'utf-8');
    spinner.succeed(`Documentation generated: ${outFile}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

function generateDocumentation(ast: { frontmatter: { data: Record<string, unknown> } | null; sections: Array<{ name: string; content: unknown[] }> }): string {
  const parts: string[] = [];
  const fm = ast.frontmatter?.data;

  parts.push(`# ${fm?.name || fm?.id || 'Module'}`);
  parts.push('');
  if (fm?.description) parts.push(fm.description as string);
  parts.push('');
  parts.push(`**Version:** ${fm?.version || 'N/A'}`);
  parts.push(`**Author:** ${fm?.author || 'N/A'}`);
  parts.push(`**Runtime:** ${fm?.runtime || 'N/A'}`);
  parts.push('');

  for (const section of ast.sections) {
    parts.push(`## ${section.name}`);
    parts.push('');
    for (const node of section.content) {
      const n = node as { type: string; value?: string; language?: string; items?: string[] };
      if (n.type === 'paragraph') parts.push(n.value || '');
      if (n.type === 'list' && n.items) parts.push(n.items.map((i: string) => `- ${i}`).join('\n'));
      if (n.type === 'codeblock') parts.push('```' + (n.language || '') + '\n' + (n.value || '') + '\n```');
    }
    parts.push('');
  }

  return parts.join('\n');
}