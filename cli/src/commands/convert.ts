/**
 * MAM Convert Command
 *
 * Converts what adopters already have (AGENTS.md, CLAUDE.md, skill files,
 * plain agent markdown) into a valid `.mam` module. The first-win principle:
 * value in under two minutes, lossless by design.
 *
 * Conversion rules (v1, deliberately conservative):
 *
 *   1. Nothing the author wrote is dropped or renamed — sections pass through
 *      byte-identical. A converter that rewrites prose is a liability, not a
 *      tool: the author can reorganize after it validates.
 *   2. Frontmatter is synthesized (id, name, version, type, author, license,
 *      description, tags) because validity requires it and markdown files do
 *      not carry it.
 *   3. `## Purpose` is guaranteed: if no purpose-like heading exists, one is
 *      inserted from the title + first paragraph. It is never synthesized
 *      from nothing — empty source yields an explicit error, not a hallucinated
 *      module.
 *   4. Type inference is `agent` when the evidence says agent (filename or
 *      headings mentioning role/goal/tools/handoff, CLAUDE.md by convention),
 *      otherwise `module`. `--type` overrides.
 *   5. The output must parse with zero errors or the command fails. A convert
 *      that emits an invalid module is worse than no convert.
 *
 * @module convert
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { userInfo } from 'node:os';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

/** Module type the converter may assign. */
export type ConvertedType = 'agent' | 'module';

/** Options accepted by {@link convertCommand}. */
export interface ConvertOptions {
  /** Markdown file to convert. */
  file?: string;
  /** Output path. Defaults to `<id>.mam` next to the source. */
  out?: string;
  /** Force a type instead of inferring. */
  type?: ConvertedType | 'auto';
  /** Author for frontmatter. Defaults to the OS user. */
  author?: string;
  /** Print the result instead of writing it. */
  dryRun?: boolean;
  /** Emit a JSON summary instead of human output. */
  json?: boolean;
  /** Verbose reporting. */
  verbose?: boolean;
}

/** Result of converting one file. */
export interface ConvertResult {
  /** Absolute source path. */
  source: string;
  /** Absolute output path (written or would-be). */
  output: string;
  /** Assigned module type and why. */
  type: ConvertedType;
  /** Reasons behind the type decision. */
  typeReasons: string[];
  /** Whether the output parsed with zero errors. */
  valid: boolean;
  /** Parser errors, when invalid. */
  errors: string[];
  /** Whether the file was written. */
  written: boolean;
}

// ============================================================================
// Inference
// ============================================================================

const AGENT_FILENAME = /(agent|claude|assistant|bot)/i;
const AGENT_HEADING = /^##\s+(role|goal|tools|handoff|capabilities|memory)\s*$/im;
const AGENT_KEYWORD = /\b(role|goal|handoff)\b.*:|[Tt]ools\s+(available|provided|you (have|can use))/;

/** Frontmatter `id`: lowercase slug of the basename without markdown extensions. */
export function slugify(filename: string): string {
  const base = basename(filename).replace(/\.mam\.md$|\.md$|\.markdown$/i, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'converted-module';
}

/** First `# ` title in the document, if any. */
export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

/** First non-empty, non-heading paragraph — the description candidate. */
export function extractFirstParagraph(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const paragraph: string[] = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed) || /^---$/.test(trimmed) || trimmed.startsWith('```')) {
      if (started) break;
      continue;
    }
    if (!trimmed) {
      if (started) break;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(line) || /^\s*\|/.test(line)) {
      if (started) break;
      continue;
    }
    started = true;
    paragraph.push(trimmed);
  }
  return paragraph.length > 0 ? paragraph.join(' ') : null;
}

/** All `## ` headings in the document. */
export function extractHeadings(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

/** Whether a purpose-like section already exists. */
export function hasPurpose(headings: string[]): boolean {
  return headings.some((h) => /^(purpose|overview|introduction|summary|about)$/i.test(h));
}

/** Infer `agent` vs `module`, with reasons for transparency. */
export function inferType(filename: string, content: string): { type: ConvertedType; reasons: string[] } {
  const reasons: string[] = [];
  const base = basename(filename);
  if (AGENT_FILENAME.test(base)) reasons.push(`filename "${base}" suggests an agent`);
  const headings = extractHeadings(content);
  const agentHeading = headings.find((h) => AGENT_HEADING.test(`## ${h}`));
  if (agentHeading) reasons.push(`heading "## ${agentHeading}" is agent structure`);
  if (!agentHeading && AGENT_KEYWORD.test(content)) {
    reasons.push('body mentions role/goal/tools/handoff structure');
  }
  return reasons.length > 0 ? { type: 'agent', reasons } : { type: 'module', reasons: ['no agent signals; default module'] };
}

// ============================================================================
// Conversion
// ============================================================================

/** Wrap converted body in synthesized frontmatter. */
export function buildModule(id: string, name: string, type: ConvertedType, author: string, description: string, body: string): string {
  const tags = type === 'agent' ? ['agent', 'converted'] : ['converted'];
  return [
    '---',
    `id: ${id}`,
    `name: ${name}`,
    'version: 1.0.0',
    `type: ${type}`,
    `author: ${author}`,
    'license: MIT',
    `description: >`,
    `  ${description}`,
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    body.endsWith('\n') ? body : body + '\n',
  ].join('\n');
}

/** Convert one markdown file to `.mam` content (no I/O). */
export function convertContent(filename: string, content: string, author: string, forcedType?: ConvertedType): { mam: string; type: ConvertedType; reasons: string[] } {
  if (!content.trim()) throw new Error('Source file is empty: refusing to synthesize a module from nothing.');
  const id = slugify(filename);
  const title = extractTitle(content) ?? id;
  const headings = extractHeadings(content);
  const { type, reasons } = forcedType
    ? { type: forcedType, reasons: [`forced via --type ${forcedType}`] }
    : inferType(filename, content);

  let body = content;
  if (!hasPurpose(headings)) {
    const first = extractFirstParagraph(content) ?? title;
    body = `## Purpose\n\n${first}\n\n${content}`;
    reasons.push('inserted ## Purpose from the leading paragraph (none existed)');
  }
  const description = extractFirstParagraph(content) ?? title;
  return { mam: buildModule(id, title, type, author, description, body), type, reasons };
}

/** Default author: flag, else OS user, else explicit unknown. */
export function defaultAuthor(flag?: string): string {
  if (flag?.trim()) return flag.trim();
  try {
    const name = userInfo().username?.trim();
    if (name) return name;
  } catch {
    // Sandboxed or unusual environments have no user info; fall through.
  }
  return 'unknown';
}

// ============================================================================
// Command
// ============================================================================

/** Convert a markdown file to `.mam`, validating the result. */
export async function convertCommand(options: ConvertOptions): Promise<ConvertResult> {
  const spinner = options.json ? null : ora('Converting to .mam...').start();
  try {
    if (!options.file) throw new Error('No input file. Usage: mam convert <file> [-o out.mam]');
    const source = resolve(options.file);
    await access(source);
    const content = await readFile(source, 'utf-8');
    const author = defaultAuthor(options.author);
    const forced = options.type && options.type !== 'auto' ? options.type : undefined;

    const { mam, type, reasons } = convertContent(source, content, author, forced);
    const parsed = parseMAM(mam, { source: 'converted' });
    const errors = parsed.errors.map((e) => String((e as { message?: string }).message ?? e));
    const valid = errors.length === 0;

    const output = options.out ? resolve(options.out) : join(dirname(source), `${slugify(source)}.mam`);
    const result: ConvertResult = { source, output, type, typeReasons: reasons, valid, errors, written: false };

    if (!valid) {
      const detail = errors.slice(0, 5).join('; ');
      throw new Error(`Converted output does not validate (${errors.length} error(s)): ${detail}`);
    }
    if (!options.dryRun) {
      await writeFile(output, mam, 'utf-8');
      result.written = true;
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      spinner?.succeed(chalk.green(`Converted to ${type} → ${output} (valid, ${reasons.length} note(s))`));
      if (options.verbose) reasons.forEach((r) => console.log(chalk.dim(`  · ${r}`)));
      if (options.dryRun) console.log(mam);
    }
    return result;
  } catch (error) {
    spinner?.fail(chalk.red(`Convert failed: ${(error as Error).message}`));
    if (options.json) console.log(JSON.stringify({ success: false, error: (error as Error).message }));
    throw error;
  }
}
