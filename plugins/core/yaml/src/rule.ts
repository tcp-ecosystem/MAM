/**
 * YAML Plugin - Validation Rule
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { validateYAMLContent, parseYAML } from './parser.js';

export const yamlRule: ValidationRule = {
  name: 'valid-yaml',
  description: 'Validate YAML syntax in code blocks',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'yaml') {
          const value = (content as { value: string }).value;
          const validation = validateYAMLContent(value);
          if (!validation.valid) {
            results.push({
              valid: false,
              message: `Invalid YAML in "${section.name}": ${validation.error}`,
              location: content.location?.start,
            });
          }
          const parsed = parseYAML(value);
          for (const err of parsed.errors) {
            results.push({
              valid: false,
              message: `YAML parse error in "${section.name}": ${err}`,
              location: content.location?.start,
            });
          }
        }
      }
    }
    return results;
  },
};

export function createYamlRule(severity?: 'error' | 'warning' | 'info'): ValidationRule {
  return { ...yamlRule, severity: severity || yamlRule.severity };
}
