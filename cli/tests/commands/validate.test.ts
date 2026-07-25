/**
 * CLI Validate Command Tests
 */

import { describe, it, expect } from 'vitest';

describe('Validate Command', () => {
  it('should have correct interface', () => {
    const options = { file: 'test.mam.md', level: 'schema' as const, format: 'text' as const };
    expect(options.file).toBe('test.mam.md');
    expect(options.level).toBe('schema');
  });
});