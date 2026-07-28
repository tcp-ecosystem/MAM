/**
 * Required Field Validation Rules
 */

export interface RequiredFieldRule {
  section: string;
  fields: string[];
}

export const DEFAULT_REQUIRED_FIELDS: RequiredFieldRule[] = [
  { section: 'frontmatter', fields: ['id', 'name', 'version'] },
];

export function validateRequired(ast: unknown, rules: RequiredFieldRule[] = DEFAULT_REQUIRED_FIELDS): Array<{ rule: string; message: string; severity: 'error' | 'warning' }> {
  const issues: Array<{ rule: string; message: string; severity: 'error' | 'warning' }> = [];
  const doc = ast as Record<string, unknown>;

  for (const rule of rules) {
    if (rule.section === 'frontmatter') {
      const fm = doc.frontmatter as Record<string, unknown> | undefined;
      for (const field of rule.fields) {
        if (!fm?.[field]) {
          issues.push({
            rule: 'required',
            message: `Missing required field "${field}" in frontmatter`,
            severity: 'error',
          });
        }
      }
    }
  }

  return issues;
}
