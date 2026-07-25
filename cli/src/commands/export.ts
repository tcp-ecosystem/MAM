/**
 * MAM Export Command
 * 
 * Exports MAM modules to various formats.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON, prettyPrint } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

export interface ExportOptions {
  file: string;
  format: 'json' | 'html' | 'markdown' | 'ast';
  outDir?: string;
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  const spinner = ora('Exporting module...').start();

  try {
    const filePath = resolve(options.file);
    const content = await readFile(filePath, 'utf-8');
    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Parse errors found');
      process.exit(1);
    }

    let output: string;
    let ext: string;

    switch (options.format) {
      case 'json':
        output = serializeToJSON(parseResult.ast);
        ext = 'json';
        break;
      case 'ast':
        output = prettyPrint(parseResult.ast);
        ext = 'txt';
        break;
      case 'html':
        output = generateHTML(parseResult.ast);
        ext = 'html';
        break;
      case 'markdown':
        output = generateMarkdown(parseResult.ast);
        ext = 'md';
        break;
      default:
        spinner.fail(`Unknown format: ${options.format}`);
        process.exit(1);
    }

    const outDir = options.outDir || join(process.cwd(), 'dist');
    try {
      await access(outDir);
    } catch {
      await mkdir(outDir, { recursive: true });
    }

    const outFile = join(outDir, `${basename(options.file, '.mam.md')}.${ext}`);
    await writeFile(outFile, output, 'utf-8');

    spinner.succeed(`Exported: ${outFile}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

function generateHTML(ast: any): string {
  const lines: string[] = ['<!DOCTYPE html>', '<html>', '<head>', '<title>MAM Module</title>', '</head>', '<body>'];
  
  if (ast.frontmatter) {
    lines.push(`<h1>${ast.frontmatter.data.name || ast.frontmatter.data.id}</h1>`);
  }
  
  for (const section of ast.sections || []) {
    lines.push(`<h2>${section.name}</h2>`);
    for (const content of section.content || []) {
      if (content.type === 'paragraph') lines.push(`<p>${content.value || ''}</p>`);
      if (content.type === 'codeblock') lines.push(`<pre><code class="${content.language || ''}">${content.value || ''}</code></pre>`);
    }
  }
  
  lines.push('</body>', '</html>');
  return lines.join('\n');
}

function generateMarkdown(ast: any): string {
  const lines: string[] = [];
  
  if (ast.frontmatter) {
    lines.push(`# ${ast.frontmatter.data.name || ast.frontmatter.data.id}`);
    lines.push('');
  }
  
  for (const section of ast.sections || []) {
    lines.push(`## ${section.name}`);
    lines.push('');
    for (const content of section.content || []) {
      if (content.type === 'paragraph') lines.push(content.value || '');
    }
    lines.push('');
  }
  
  return lines.join('\n');
}