/**
 * Sandbox Tests
 */

import { describe, it, expect } from 'vitest';
import { ProcessSandbox, VMSandbox } from '../src/sandboxes/index.js';
import { createLocation } from '@mam/ast';

describe('Sandboxes', () => {
  it('should initialize process sandbox', async () => {
    const sandbox = new ProcessSandbox();
    await sandbox.init({ timeout: 5000 });
    expect(sandbox).toBeDefined();
  });

  it('should check permissions', async () => {
    const sandbox = new ProcessSandbox();
    await sandbox.init({ networkHosts: ['example.com'] });
    expect(sandbox.checkPermission('network')).toBe(true);
    expect(sandbox.checkPermission('filesystem')).toBe(false);
  });

  it('should initialize VM sandbox', async () => {
    const sandbox = new VMSandbox();
    await sandbox.init({ timeout: 5000 });
    expect(sandbox).toBeDefined();
  });

  it('should execute in VM sandbox', async () => {
    const sandbox = new VMSandbox();
    await sandbox.init({ timeout: 5000 });
    const result = await sandbox.execute({
      type: 'CodeBlock', language: 'javascript', value: '2 * 3', metadata: {},
      location: createLocation(1, 0, 0, 1, 0, 0, 'test'),
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe(6);
  });
});