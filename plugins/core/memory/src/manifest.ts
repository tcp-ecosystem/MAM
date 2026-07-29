/**
 * Memory Plugin - Manifest & Section Definition
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';

export const MEMORY_MANIFEST: PluginManifest = {
  name: '@mam/plugin-memory',
  version: '1.0.0',
  description: 'Memory and state management for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['memory', 'state', 'persistence'],
  main: './index.js',
};

export const MEMORY_CONTENT_TYPES = ['text', 'code'] as const;

export const memorySection: SectionDefinition = {
  name: 'Memory',
  description: 'Persistent memory and state for the module',
  required: false,
  contentTypes: [...MEMORY_CONTENT_TYPES],
  validator: (content) => {
    const results: ValidationResult[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'json') {
        try {
          JSON.parse((node as { value: string }).value);
        } catch (error) {
          results.push({
            valid: false,
            message: `Invalid JSON in Memory: ${(error as Error).message}`,
          });
        }
      }
    }
    return results;
  },
};

export function getMemorySection(): SectionDefinition {
  return { ...memorySection };
}
