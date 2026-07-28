/**
 * Reference Validation Rules
 */

export function validateReferences(ast: unknown): Array<{ rule: string; message: string; severity: 'error' | 'warning' }> {
  const issues: Array<{ rule: string; message: string; severity: 'error' | 'warning' }> = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{ name: string; content?: Array<{ type: string; value?: string }> }>) || [];

  for (const section of sections) {
    if (section.content) {
      for (const item of section.content) {
        if (item.type === 'paragraph' && item.value) {
          const urlMatches = item.value.match(/https?:\/\/[^\s)]+/g);
          if (urlMatches) {
            for (const url of urlMatches) {
              if (url.endsWith('/') === false && !url.match(/\.\w+$/)) {
                issues.push({
                  rule: 'references',
                  message: `URL may be incomplete: ${url}`,
                  severity: 'warning',
                });
              }
            }
          }
        }
      }
    }
  }

  return issues;
}
