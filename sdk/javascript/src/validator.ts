/**
 * MAM Validator for JavaScript
 */

export interface ValidationIssue {
  rule: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function validate(module: unknown): ValidationIssue[] {
  return [];
}
