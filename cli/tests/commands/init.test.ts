/**
 * CLI Init Command Tests
 *
 * These tests exercise the real scaffolding behaviour: the catalogue, template
 * personalisation, and the files written to disk (both `.mam` and `.mam.md`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  describeTemplate,
  initModule,
  initProject,
  listTemplates,
  renderTemplate,
  templateNames,
  toModuleId,
  validateModuleName,
  validateTemplate,
} from '../../src/commands/init.js';

const scratch: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mam-init-'));
  scratch.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('init template catalogue', () => {
  it('exposes five production templates', () => {
    expect(templateNames()).toEqual(['basic', 'advanced', 'workflow', 'agent', 'service']);
    expect(listTemplates()).toHaveLength(5);
  });

  it('reports the module type each template writes', () => {
    expect(describeTemplate('agent')?.moduleType).toBe('agent');
    expect(describeTemplate('service')?.moduleType).toBe('service');
    expect(describeTemplate('workflow')?.moduleType).toBe('workflow');
  });

  it('rejects an unknown template with the available names', () => {
    const result = validateTemplate('nope');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('basic');
    expect(result.error).toContain('service');
  });

  it('defaults to basic and normalises case', () => {
    expect(validateTemplate(undefined)).toEqual({ valid: true, template: 'basic' });
    expect(validateTemplate('  AGENT ')).toEqual({ valid: true, template: 'agent' });
  });
});

describe('module names', () => {
  it('accepts letters, numbers, hyphens and underscores', () => {
    expect(validateModuleName('support-triage')).toBe(true);
    expect(validateModuleName('job_runner')).toBe(true);
  });

  it('rejects path characters and empty names', () => {
    expect(validateModuleName('../escape')).toBe(false);
    expect(validateModuleName('with space')).toBe(false);
    expect(validateModuleName('')).toBe(false);
  });

  it('canonicalises a name into a MAM id', () => {
    expect(toModuleId('  My_Module  ')).toBe('my-module');
    expect(toModuleId('Already-Kebab')).toBe('already-kebab');
    expect(toModuleId('a///b')).toBe('ab');
  });
});

describe('renderTemplate', () => {
  it.each(['basic', 'advanced', 'workflow', 'agent', 'service'] as const)(
    'personalises the %s template',
    (template) => {
      const rendered = renderTemplate(template, 'billing-bot');
      expect(rendered).toContain('id: billing-bot');
      expect(rendered).toContain('# Billing Bot');
      expect(rendered).not.toContain(`template-${template}`);
      expect(rendered).not.toContain(`Template ${template[0].toUpperCase()}${template.slice(1)}`);
      expect(rendered.split('\n').length).toBeGreaterThan(100);
      expect(rendered).toContain('## Python');
      expect(rendered).toContain('## Tests');
    },
  );

  it('rejects a name that canonicalises to nothing', () => {
    expect(() => renderTemplate('basic', '///')).toThrow(/empty id/);
  });
});

describe('initModule', () => {
  it('writes byte-identical .mam and .mam.md files', async () => {
    const dir = await tempDir();
    const result = await initModule({ name: 'my-module', template: 'agent', dir });
    expect(result.success).toBe(true);

    const mam = await readFile(result.file, 'utf-8');
    const twin = await readFile(`${result.file}.md`, 'utf-8');
    expect(mam).toBe(twin);
    expect(mam).toContain('id: my-module');
    expect(mam).toContain('type: agent');
    expect((await stat(`${result.file}.md`)).isFile()).toBe(true);
  });

  it('refuses to overwrite an existing module', async () => {
    const dir = await tempDir();
    const first = await initModule({ name: 'taken', dir });
    expect(first.success).toBe(true);
    const second = await initModule({ name: 'taken', dir });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/i);
  });

  it('rejects invalid names before touching the filesystem', async () => {
    const dir = await tempDir();
    const result = await initModule({ name: '../escape', dir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid module name/i);
  });
});

describe('initProject', () => {
  it('scaffolds manifest, README, gitignore and both module forms', async () => {
    const dir = await tempDir();
    const result = await initProject({ name: 'demo-project', dir, quiet: true });
    expect(result.success).toBe(true);

    const manifest = await readFile(join(dir, 'mam.toml'), 'utf-8');
    expect(manifest).toContain('name = "demo-project"');

    const module = await readFile(join(dir, 'modules', 'demo-project.mam'), 'utf-8');
    const twin = await readFile(join(dir, 'modules', 'demo-project.mam.md'), 'utf-8');
    expect(module).toBe(twin);
    expect(module).toContain('id: demo-project');
  });
});
