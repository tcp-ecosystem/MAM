import { describe, it, expect } from 'vitest';
import {
  STARTER_KINDS,
  listStarterKinds,
  getStarterTemplate,
  renderStarter,
  starterVariables,
  newModuleStarter,
  validateStarterName,
} from '../mam/template.js';

describe('listStarterKinds', () => {
  it('returns the canonical kinds', () => {
    expect(listStarterKinds()).toEqual(['agent', 'module', 'tool']);
    expect(STARTER_KINDS).toContain('module');
  });
});

describe('getStarterTemplate', () => {
  it('returns templates with placeholders', () => {
    const template = getStarterTemplate('module');
    expect(template).toContain('{{name}}');
    expect(template).toContain('## Purpose');
  });

  it('resolves aliases case-insensitively', () => {
    const agent = getStarterTemplate('bot');
    expect(agent).toContain('role');
    expect(getStarterTemplate('MODULE')).toContain('## Purpose');
  });

  it('throws for unknown kinds', () => {
    expect(() => getStarterTemplate('spaceship')).toThrow(/Unknown starter kind/);
  });
});

describe('renderStarter', () => {
  it('substitutes placeholders', () => {
    expect(renderStarter('Hello {{name}}!', { name: 'MAM' })).toBe('Hello MAM!');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderStarter('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });

  it('resolves case-insensitively', () => {
    expect(renderStarter('{{Name}}', { name: 'x' })).toBe('x');
  });
});

describe('starterVariables', () => {
  it('lists unique placeholders in order', () => {
    expect(starterVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(starterVariables('none')).toEqual([]);
  });
});

describe('newModuleStarter', () => {
  it('renders a complete starter', () => {
    const rendered = newModuleStarter('Demo', 'module');
    expect(rendered).toContain('title: Demo');
    expect(rendered).toContain('## Purpose');
    expect(rendered).not.toContain('{{');
  });

  it('supports agent and tool kinds', () => {
    expect(newModuleStarter('Bot', 'agent')).toContain('role');
    expect(newModuleStarter('Runner', 'tool')).toContain('Capabilities');
  });

  it('throws for invalid names', () => {
    expect(() => newModuleStarter('   ', 'module')).toThrow(/Invalid starter name/);
    expect(() => newModuleStarter('bad/name', 'module')).toThrow(/Invalid starter name/);
  });

  it('throws for unknown kinds', () => {
    expect(() => newModuleStarter('Demo', 'spaceship')).toThrow(/Unknown starter kind/);
  });
});

describe('validateStarterName', () => {
  it('accepts valid names', () => {
    expect(validateStarterName('Good Name-1')).toEqual([]);
  });

  it('rejects blank, overlong, and invalid names', () => {
    expect(validateStarterName('  ').length).toBeGreaterThan(0);
    expect(validateStarterName('a'.repeat(65)).length).toBeGreaterThan(0);
    expect(validateStarterName('bad/name').length).toBeGreaterThan(0);
    expect(validateStarterName('___').length).toBeGreaterThan(0);
  });
});