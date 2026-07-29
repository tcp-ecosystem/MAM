/**
 * Memory Plugin - Validation Rule
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { parseMemoryContent } from './parser.js';

export const memoryRule: ValidationRule = {
  name: 'memory-consistency',
  description: 'Check memory section for consistency',
  severity: 'info',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const memSection = module.sections.find((s) => s.name === 'Memory');

    if (!memSection) {
      return [{ valid: true, message: 'No Memory section found' }];
    }

    const { flat, keys, entries } = parseMemoryContent(memSection.content);

    if (keys.length === 0) {
      results.push({ valid: true, message: 'Memory section is empty' });
      return results;
    }

    const duplicateKeys = findDuplicateKeys(entries);
    for (const dup of duplicateKeys) {
      results.push({
        valid: false,
        message: `Duplicate memory key: "${dup}"`,
      });
    }

    const emptyKeys = keys.filter((k) => flat[k] === '' || flat[k] === null || flat[k] === undefined);
    for (const k of emptyKeys) {
      results.push({
        valid: false,
        message: `Empty value for memory key: "${k}"`,
      });
    }

    if (results.length === 0) {
      results.push({ valid: true, message: `Memory section has ${keys.length} valid entries` });
    }

    return results;
  },
};

function findDuplicateKeys(entries: { key: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      duplicates.add(entry.key);
    }
    seen.add(entry.key);
  }
  return Array.from(duplicates);
}

export function createMemoryRule(severity?: 'error' | 'warning' | 'info'): ValidationRule {
  return { ...memoryRule, severity: severity || memoryRule.severity };
}
