/**
 * MAM Graph Command
 * 
 * Shows dependency graph for MAM modules.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

export interface GraphOptions {
  dir?: string;
  format?: 'text' | 'json' | 'mermaid' | 'ascii';
  outDir?: string;
}

export async function graphCommand(options: GraphOptions): Promise<void> {
  const spinner = ora('Generating graph...').start();

  try {
    // Dynamically import visualization package — only needed for some formats
    let MermaidGenerator: any = null;
    let ASCIIArt: any = null;
    try {
      const vizMod = await import('@mam/visualization' as any);
      MermaidGenerator = vizMod.MermaidGenerator;
      ASCIIArt = vizMod.ASCIIArt;
    } catch {
      // Visualization package not available; only text/json will work
    }

    const dir = options.dir || process.cwd();
    const files = await findMAMFiles(dir);
    
    if (files.length === 0) {
      spinner.warn('No MAM files found');
      return;
    }

    const allModules: any[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const result = parseMAM(content, { source: file });
      if (result.ast.frontmatter) {
        allModules.push({
          name: result.ast.frontmatter.data.name || result.ast.frontmatter.data.id,
          type: result.ast.frontmatter.data.runtime || 'module',
          file: file,
        });
      }
    }

    spinner.stop();

    if (options.format === 'json') {
      console.log(JSON.stringify(allModules, null, 2));
    } else if (options.format === 'mermaid') {
      const mermaid = new MermaidGenerator();
      // Create mock modules for mermaid
      const mockModules = allModules.map(m => ({
        name: m.name,
        moduleType: m.type,
        edges: [],
        handoff: [],
        tools: [],
      }));
      const result = mermaid.generateFromModules(mockModules as any);
      console.log(result.code);
    } else if (options.format === 'ascii') {
      const ascii = new ASCIIArt();
      const mockModules = allModules.map(m => ({
        name: m.name,
        moduleType: m.type,
        edges: [],
        handoff: [],
        tools: [],
      }));
      const result = ascii.generateFromModules(mockModules as any);
      console.log(result.art);
    } else {
      // Text format
      console.log(chalk.cyan('\nDependency Graph:\n'));
      
      if (allModules.length === 0) {
        console.log(chalk.gray('No MAM modules found'));
        return;
      }

      for (const mod of allModules) {
        console.log(chalk.green(`  ${mod.name}`));
        console.log(chalk.gray(`    Type: ${mod.type}`));
        console.log(chalk.gray(`    File: ${mod.file}`));
      }
    }

    console.log(chalk.gray(`\nFound ${allModules.length} module(s)`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

async function findMAMFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.mam.md') || entry.endsWith('.mam')) {
        files.push(join(dir, entry));
      }
    }
  } catch { /* ignore */ }
  return files;
}