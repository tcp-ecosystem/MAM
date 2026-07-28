/**
 * Section Ordering Validation Rules
 */

export const STANDARD_SECTION_ORDER = [
  'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid',
  'Python', 'Prompt', 'Memory', 'Examples', 'Tests', 'References',
  'Dependencies', 'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities',
];

export function validateOrdering(ast: unknown): Array<{ rule: string; message: string; severity: 'error' | 'warning' }> {
  const issues: Array<{ rule: string; message: string; severity: 'error' | 'warning' }> = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{ name: string }>) || [];

  let lastKnownIndex = -1;
  for (const section of sections) {
    const standardIndex = STANDARD_SECTION_ORDER.indexOf(section.name);
    if (standardIndex !== -1) {
      if (standardIndex < lastKnownIndex) {
        issues.push({
          rule: 'ordering',
          message: `Section "${section.name}" is out of standard order`,
          severity: 'warning',
        });
      }
      lastKnownIndex = standardIndex;
    }
  }

  return issues;
}
