/**
 * Python Plugin - Manifest & Section Definition
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';

export const PYTHON_MANIFEST: PluginManifest = {
  name: '@mam/plugin-python',
  version: '1.0.0',
  description: 'Python code execution for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['python', 'runtime', 'execution'],
  main: './index.js',
};

export const pythonSection: SectionDefinition = {
  name: 'Python',
  description: 'Python code block',
  required: false,
  contentTypes: ['code'],
  validator: (content) => {
    const results: ValidationResult[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'python') {
        const value = (node as { value: string }).value;
        if (value.trim().length === 0) {
          results.push({ valid: false, message: 'Empty Python code block' });
        }
        if (value.includes('import os') && value.includes('os.system')) {
          results.push({ valid: true, message: 'Warning: Direct OS commands detected' });
        }
      }
    }
    return results;
  },
};

export function getPythonSection(): SectionDefinition {
  return { ...pythonSection };
}
