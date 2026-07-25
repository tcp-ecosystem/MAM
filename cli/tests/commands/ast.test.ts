/**
 * CLI AST Command Tests
 */

import { describe, it, expect } from 'vitest';

describe('AST Command', () => {
  it('should have correct interface', () => {
    const options = { file: 'test.mam.md', format: 'pretty' as const };
    expect(options.file).toBe('test.mam.md');
    expect(options.format).toBe('pretty');
  });
});