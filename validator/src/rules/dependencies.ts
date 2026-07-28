/**
 * Dependency Validation Rules
 */

export function validateDependencies(ast: unknown): Array<{ rule: string; message: string; severity: 'error' | 'warning' }> {
  const issues: Array<{ rule: string; message: string; severity: 'error' | 'warning' }> = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const deps = fm?.dependencies as Record<string, string> | undefined;

  if (deps) {
    for (const [name, version] of Object.entries(deps)) {
      if (!name || name.trim() === '') {
        issues.push({ rule: 'dependencies', message: 'Empty dependency name', severity: 'error' });
      }
      if (version && !version.match(/^[\d.^~>*=]+$/)) {
        issues.push({ rule: 'dependencies', message: `Invalid version format for "${name}": ${version}`, severity: 'warning' });
      }
    }
  }

  return issues;
}
