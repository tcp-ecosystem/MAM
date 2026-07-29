/**
 * YAML Plugin - Manifest & Section Definition
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import { validateYAMLContent } from './parser.js';

export const YAML_MANIFEST: PluginManifest = {
  name: '@mam/plugin-yaml',
  version: '1.0.0',
  description: 'YAML section parser and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['yaml', 'parser', 'validator'],
  main: './index.js',
};

export const yamlSection: SectionDefinition = {
  name: 'Config',
  description: 'YAML configuration section',
  required: false,
  contentTypes: ['code'],
  validator: (content) => {
    const results: ValidationResult[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'yaml') {
        const result = validateYAMLContent((node as { value: string }).value);
        if (!result.valid) {
          results.push({ valid: false, message: result.error || 'Invalid YAML' });
        }
      }
    }
    return results;
  },
};

export function getYamlSection(): SectionDefinition {
  return { ...yamlSection };
}
