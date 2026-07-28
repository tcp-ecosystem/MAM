/**
 * Custom Validation Rule Support
 */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface CustomRule {
  name: string;
  description?: string;
  severity: ValidationSeverity;
  validate: (ast: unknown) => Array<{ rule: string; message: string; severity: ValidationSeverity }>;
}

export function validateCustom(ast: unknown, rules: CustomRule[] = []): Array<{ rule: string; message: string; severity: ValidationSeverity }> {
  const issues: Array<{ rule: string; message: string; severity: ValidationSeverity }> = [];

  for (const rule of rules) {
    const ruleIssues = rule.validate(ast);
    issues.push(...ruleIssues);
  }

  return issues;
}
