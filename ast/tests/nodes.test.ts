/**
 * AST Node Tests
 */

import { describe, it, expect } from 'vitest';
import { isStandardSection, isRequiredSection, getNodeType } from '../src/nodes/index.js';
import { createLocation } from '../src/location/index.js';

describe('AST Nodes', () => {
  it('should identify standard sections', () => {
    expect(isStandardSection('Purpose')).toBe(true);
    expect(isStandardSection('Inputs')).toBe(true);
    expect(isStandardSection('Custom')).toBe(false);
  });

  it('should identify required sections', () => {
    expect(isRequiredSection('Purpose')).toBe(true);
    expect(isRequiredSection('Inputs')).toBe(false);
  });

  it('should create location', () => {
    const loc = createLocation(1, 0, 0, 10, 5, 100, 'test.mam.md');
    expect(loc.start.line).toBe(1);
    expect(loc.end.line).toBe(10);
    expect(loc.source).toBe('test.mam.md');
  });

  it('should get node type', () => {
    const node = { type: 'MAMModule' as const, location: createLocation(1, 0, 0, 1, 0, 0, 'test') };
    expect(getNodeType(node)).toBe('MAMModule');
  });
});