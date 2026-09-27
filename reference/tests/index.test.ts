import { describe, it, expect, vi } from 'vitest';

vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
process.argv = ['node', 'mamc', '--help'];

const {
  CLI_NAME,
  CLI_VERSION,
  CLI_DESCRIPTION,
  getCommandNames,
  hasCommand,
  getCommandDescription,
  getExtensionForTarget,
} = await import('../src/index.js');

describe('CLI metadata', () => {
  it('should expose name, version, and description', () => {
    expect(CLI_NAME).toBe('mamc');
    expect(CLI_VERSION).toBe('2.0.0');
    expect(CLI_DESCRIPTION).toContain('MAM');
  });
});

describe('getCommandNames', () => {
  it('should list all registered commands', () => {
    expect(getCommandNames()).toEqual(
      expect.arrayContaining(['build', 'validate', 'analyze', 'graph', 'init', 'install']),
    );
  });

  it('should return six commands', () => {
    expect(getCommandNames()).toHaveLength(6);
  });
});

describe('hasCommand', () => {
  it('should detect known commands', () => {
    expect(hasCommand('build')).toBe(true);
    expect(hasCommand('graph')).toBe(true);
  });

  it('should reject unknown commands', () => {
    expect(hasCommand('deploy')).toBe(false);
    expect(hasCommand('')).toBe(false);
  });
});

describe('getCommandDescription', () => {
  it('should return descriptions for known commands', () => {
    expect(getCommandDescription('build')).toContain('Build');
    expect(getCommandDescription('validate')).toContain('Validat');
  });

  it('should return undefined for unknown commands', () => {
    expect(getCommandDescription('deploy')).toBeUndefined();
  });
});

describe('getExtensionForTarget', () => {
  it('should map targets to extensions', () => {
    expect(getExtensionForTarget('python')).toBe('py');
    expect(getExtensionForTarget('typescript')).toBe('ts');
    expect(getExtensionForTarget('rust')).toBe('rs');
    expect(getExtensionForTarget('unknown-target')).toBe('txt');
  });
});
