/**
 * Python Plugin - Validation Rule
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { validatePythonCode, checkPythonSecurityPatterns } from './validator.js';

export const pythonRule: ValidationRule = {
  name: 'python-syntax',
  description: 'Check Python code blocks for common issues',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'python') {
          const value = (content as { value: string }).value;
          const issues = validatePythonCode(value);
          for (const issue of issues) {
            results.push({
              valid: issue.severity !== 'error',
              message: issue.message,
              location: { line: issue.line, column: issue.column },
            });
          }
          const secWarnings = checkPythonSecurityPatterns(value);
          for (const w of secWarnings) {
            results.push({ valid: true, message: `Security: ${w}`, location: content.location?.start });
          }
        }
      }
    }
    return results;
  },
};

export function createPythonRule(severity?: 'error' | 'warning' | 'info'): ValidationRule {
  return { ...pythonRule, severity: severity || pythonRule.severity };
}
