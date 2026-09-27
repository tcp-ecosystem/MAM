import { describe, expect, it } from 'vitest';
import { SDK_NAME, VERSION, VERSION as EXPORTED_VERSION, contractFeatures, parseString, standardSectionKinds, userAgent, validate, diagnosticsBySeverity, isValidModule, moduleSummary, countBySeverity, userAgent as userAgentAlias } from '../mam/index.js';

describe('public surface', () => {
  it('exports the TypeScript SDK name', () => {
    expect(SDK_NAME).toBe('mam-typescript');
  });

  it('exports a version', () => {
    expect(VERSION).toBe(EXPORTED_VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports a user agent', () => {
    expect(userAgent()).toBe(`${SDK_NAME}/${VERSION}`);
    expect(userAgentAlias()).toBe(userAgent());
  });

  it('exports the support feature list', () => {
    expect(contractFeatures()).toContain('parser');
    expect(contractFeatures()).toContain('doctor');
  });

  it('exports standard section kinds', () => {
    expect(standardSectionKinds()).toContain('purpose');
    expect(standardSectionKinds()).not.toContain('Custom');
  });

  it('exports module validity helpers', () => {
    const module = parseString('---\nname: Public\n---\n\n## Purpose\n\nText.\n');
    expect(isValidModule(module)).toBe(true);
    expect(moduleSummary(module)).toContain('Public');
  });

  it('exports validation result helpers', () => {
    const result = validate(parseString('## Purpose\n\nText.\n'));
    expect(result.is_valid).toBe(false);
    expect(diagnosticsBySeverity(result, 'Error').length).toBeGreaterThan(0);
  });

  it('exports severity counts', () => {
    const counts = countBySeverity(validate(parseString('## Purpose\n\nText.\n')));
    expect(counts.Error).toBeGreaterThan(0);
  });

  it('exports parsing entry points', () => {
    expect(typeof parseString).toBe('function');
    expect(parseString('## Purpose\n').sections[0].title).toBe('Purpose');
  });

  it('exports a stable feature contract', () => {
    expect(new Set(contractFeatures()).size).toBe(contractFeatures().length);
  });
});
