/**
 * MAM Optimize Command
 *
 * Wired directly against `@mam/token-optimization`: reads a prompt file,
 * splits it into sections, runs `PromptOptimizer.optimize()` and prints the
 * savings report (originalTokens / optimizedTokens / savedPercent).
 */

import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { PromptOptimizer, section, type PromptSection } from '@mam/token-optimization';
import chalk from 'chalk';

export interface OptimizeOptions {
  file: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function roleFor(title: string): string {
  const lower = title.toLowerCase();
  if (/system|purpose|overview|intent/.test(lower)) return 'system';
  if (/memory|context|history/.test(lower)) return 'memory';
  if (/knowledge|source|reference|docs/.test(lower)) return 'knowledge';
  if (/tool|function|api/.test(lower)) return 'tool';
  return 'user';
}

export function buildSections(content: string): PromptSection[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/^##\s+/m);
  const sections: PromptSection[] = [];

  for (const raw of parts) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const firstNewline = chunk.indexOf('\n');
    const title = (firstNewline === -1 ? chunk : chunk.slice(0, firstNewline)).trim();
    const body = (firstNewline === -1 ? '' : chunk.slice(firstNewline + 1)).trim();
    if (!title && !body) continue;
    sections.push(
      section(roleFor(title), body || title, {
        id: slugify(title || 'section'),
      }),
    );
  }

  return sections;
}

export async function optimizeCommand(options: OptimizeOptions): Promise<void> {
  const filePath = resolve(options.file);
  const content = await readFile(filePath, 'utf-8');

  const sections = buildSections(content);
  if (sections.length === 0) {
    console.log(chalk.yellow(`No sections found in ${basename(filePath)}`));
    return;
  }

  const optimizer = new PromptOptimizer();
  const result = optimizer.optimize(sections);

  const savedPct = result.savedPercent.toFixed(1);
  console.log(chalk.cyan(`\n  Optimization Report — ${basename(filePath)}\n`));
  console.log(`  ${chalk.gray('originalTokens:')} ${chalk.white(String(result.originalTokens))}`);
  console.log(`  ${chalk.gray('optimizedTokens:')} ${chalk.white(String(result.optimizedTokens))}`);
  console.log(`  ${chalk.gray('savedPercent:')}   ${chalk.green(`${savedPct}%`)}`);
  console.log(`  ${chalk.gray('savedTokens:')}    ${chalk.white(String(result.savedTokens))}`);
  console.log(`  ${chalk.gray('applied:')}        ${chalk.white(result.applied.join(', ') || 'none')}`);
  console.log('');
}