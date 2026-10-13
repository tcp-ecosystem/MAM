/**
 * CLI Convert Command Tests
 *
 * convertContent is pure (no I/O): the matrix below proves inference,
 * frontmatter synthesis, and the Purpose guarantee without touching disk.
 * convertCommand is exercised through tmp files for the write path and the
 * missing-file / empty-file rejections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  convertContent,
  convertCommand,
  slugify,
  inferType,
  extractTitle,
  extractFirstParagraph,
  hasPurpose,
} from '../../src/commands/convert.js';

const AGENTS_MD = `# Support Bot

Answers customer questions from the help center.

## Role

Front-line support.

## Goal

Resolve tickets without escalation.

## Rules

- Never invent an answer.
`;

const PLAIN_MD = `# Shopping List

Buy milk and eggs before Friday.
`;

describe('slugify', () => {
  it('derives ids from filenames', () => {
    expect(slugify('AGENTS.md')).toBe('agents');
    expect(slugify('CLAUDE.md')).toBe('claude');
    expect(slugify('my skill.markdown')).toBe('my-skill');
  });
});

describe('inferType', () => {
  it('detects agents by filename', () => {
    expect(inferType('AGENTS.md', PLAIN_MD).type).toBe('agent');
    expect(inferType('CLAUDE.md', PLAIN_MD).type).toBe('agent');
  });

  it('detects agents by structure', () => {
    const { type, reasons } = inferType('notes.md', AGENTS_MD);
    expect(type).toBe('agent');
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('defaults to module with a reason', () => {
    const { type, reasons } = inferType('notes.md', PLAIN_MD);
    expect(type).toBe('module');
    expect(reasons).toEqual(['no agent signals; default module']);
  });
});

describe('extractors', () => {
  it('finds titles and paragraphs, skips fences and tables', () => {
    expect(extractTitle(AGENTS_MD)).toBe('Support Bot');
    expect(extractFirstParagraph(AGENTS_MD)).toBe('Answers customer questions from the help center.');
    expect(extractFirstParagraph('# T\n\n| a | b |\n|---|---|\n\nReal text.\n')).toBe('Real text.');
  });

  it('detects existing purpose sections', () => {
    expect(hasPurpose(['Purpose', 'Rules'])).toBe(true);
    expect(hasPurpose(['Overview'])).toBe(true);
    expect(hasPurpose(['Rules'])).toBe(false);
  });
});

describe('convertContent', () => {
  it('emits frontmatter plus the untouched body', () => {
    const { mam, type } = convertContent('AGENTS.md', AGENTS_MD, 'tester');
    expect(type).toBe('agent');
    expect(mam).toContain('id: agents');
    expect(mam).toContain('type: agent');
    expect(mam).toContain('## Role');
    expect(mam).toContain('Answers customer questions');
  });

  it('inserts ## Purpose only when missing', () => {
    const withPurpose = convertContent('x.md', '# T\n\n## Purpose\n\nExists.\n', 't');
    expect(withPurpose.mam.match(/## Purpose/g)?.length).toBe(1);
    const without = convertContent('x.md', PLAIN_MD, 't');
    expect(without.mam).toContain('## Purpose');
    expect(without.mam).toContain('Buy milk and eggs');
  });

  it('honours --type and records it', () => {
    const { type, reasons } = convertContent('AGENTS.md', AGENTS_MD, 't', 'module');
    expect(type).toBe('module');
    expect(reasons).toContain('forced via --type module');
    expect(reasons).toContain('inserted ## Purpose from the leading paragraph (none existed)');
  });

  it('refuses empty input instead of hallucinating', () => {
    expect(() => convertContent('x.md', '   \n', 't')).toThrow('empty');
  });
});

describe('convertCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mam-convert-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a valid .mam next to the source by default', async () => {
    const src = join(dir, 'AGENTS.md');
    await writeFile(src, AGENTS_MD, 'utf-8');
    const result = await convertCommand({ file: src, author: 'tester' });
    expect(result.valid).toBe(true);
    expect(result.type).toBe('agent');
    expect(result.written).toBe(true);
    expect(result.output).toBe(join(dir, 'agents.mam'));
    expect(await readFile(result.output, 'utf-8')).toContain('id: agents');
  });

  it('dry-run prints without writing', async () => {
    const src = join(dir, 'notes.md');
    await writeFile(src, PLAIN_MD, 'utf-8');
    const result = await convertCommand({ file: src, author: 't', dryRun: true, json: true });
    expect(result.valid).toBe(true);
    expect(result.written).toBe(false);
    await expect(readFile(join(dir, 'notes.mam'), 'utf-8')).rejects.toThrow();
  });

  it('rejects a missing file with a usable message', async () => {
    await expect(convertCommand({ file: join(dir, 'nope.md') })).rejects.toThrow();
  });
});
