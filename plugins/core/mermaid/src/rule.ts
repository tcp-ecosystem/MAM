/**
 * Mermaid Plugin - Validation Rule
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';

export const mermaidRule: ValidationRule = {
  name: 'valid-mermaid',
  description: 'Validate Mermaid diagram syntax',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'mermaid') {
          const value = (nodeValue(content));
          if (value.trim().length === 0) {
            results.push({
              valid: false,
              message: 'Empty Mermaid diagram',
              location: content.location?.start,
            });
          }
        }
      }
    }
    return results;
  },
};

function nodeValue(node: { value?: string }): string {
  return (node as { value: string }).value || '';
}

export function createMermaidRule(severity?: 'error' | 'warning' | 'info'): ValidationRule {
  return { ...mermaidRule, severity: severity || mermaidRule.severity };
}
