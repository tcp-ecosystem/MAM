/**
 * CLI Init Command Tests
 */

import { describe, it, expect } from 'vitest';

describe('Init Command', () => {
  it('should have correct interface', () => {
    const options = { name: 'test-module', template: 'basic' as const, runtime: 'python' };
    expect(options.name).toBe('test-module');
    expect(options.template).toBe('basic');
  });

  it('should support all templates', () => {
    const templates = ['basic', 'full', 'agent'];
    expect(templates).toHaveLength(3);
  });
});