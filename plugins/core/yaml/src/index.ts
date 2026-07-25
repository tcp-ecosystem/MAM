/**
 * MAM YAML Plugin
 * 
 * Provides YAML section parsing and validation for MAM modules.
 */

import { MAMPlugin, PluginManifest, SectionDefinition, ValidationRule } from '@mam/plugin-api';

const manifest: PluginManifest = {
  name: '@mam/plugin-yaml',
  version: '1.0.0',
  description: 'YAML section parser and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['yaml', 'parser', 'validator'],
  main: './index.js',
};

function parseYAMLValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function validateYAMLContent(value: string): { valid: boolean; error?: string } {
  try {
    const lines = value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      if (line.startsWith('- ')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key)) {
          return { valid: false, error: `Invalid YAML key "${key}" at line ${i + 1}` };
        }
      }
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

const yamlSection: SectionDefinition = {
  name: 'Config',
  description: 'YAML configuration section',
  required: false,
  contentTypes: ['code'],
  validator: (content) => {
    const results = [];
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

const yamlRule: ValidationRule = {
  name: 'valid-yaml',
  description: 'Validate YAML syntax in code blocks',
  severity: 'error',
  check: (module) => {
    const results = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'yaml') {
          const result = validateYAMLContent((content as { value: string }).value);
          if (!result.valid) {
            results.push({
              valid: false,
              message: `Invalid YAML in "${section.name}": ${result.error}`,
              location: content.location?.start,
            });
          }
        }
      }
    }
    return results;
  },
};

const yamlPlugin: MAMPlugin = { manifest, sections: [yamlSection], rules: [yamlRule] };
export default yamlPlugin;