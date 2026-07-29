/**
 * Python Plugin - Code Validation
 */

export interface PythonValidationIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule: string;
}

export function validatePythonCode(code: string): PythonValidationIssue[] {
  const issues: PythonValidationIssue[] = [];
  const lines = code.split('\n');

  let lastWasBlank = false;
  let inDocstring = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (line.includes('"""') || line.includes("'''")) {
      inDocstring = !inDocstring;
    }
    if (inDocstring) continue;

    if (line.includes('\t') && line.includes('    ')) {
      issues.push({ line: lineNum, column: 1, severity: 'warning', message: 'Mixed tabs and spaces', rule: 'mixed-indent' });
    }

    const trailingWhitespace = line.match(/(\s+)$/);
    if (trailingWhitespace && trailingWhitespace[1] !== '') {
      issues.push({ line: lineNum, column: line.length - trailingWhitespace[1].length + 1, severity: 'info', message: 'Trailing whitespace', rule: 'trailing-whitespace' });
    }

    if (line.length > 120) {
      issues.push({ line: lineNum, column: 121, severity: 'info', message: `Line exceeds 120 characters (${line.length})`, rule: 'line-length' });
    }

    const isBlank = line.trim().length === 0;
    if (isBlank && lastWasBlank) {
      // consecutive blank lines
    }
    lastWasBlank = isBlank;
  }

  const hasMainGuard = lines.some((l) => l.includes('__name__') && l.includes('__main__'));
  const hasImport = lines.some((l) => l.trimStart().startsWith('import ') || l.trimStart().startsWith('from '));
  const hasDef = lines.some((l) => l.trimStart().startsWith('def '));

  if (hasImport && hasDef && !hasMainGuard) {
    issues.push({ line: 1, column: 1, severity: 'warning', message: 'Module has imports and functions but no __main__ guard', rule: 'missing-main-guard' });
  }

  const hasOsSystem = lines.some((l) => l.includes('os.system'));
  if (hasOsSystem) {
    issues.push({ line: 1, column: 1, severity: 'warning', message: 'Direct os.system() usage detected; prefer subprocess', rule: 'os-system' });
  }

  return issues;
}

export function checkPythonSecurityPatterns(code: string): string[] {
  const warnings: string[] = [];
  if (code.includes('eval(')) warnings.push('eval() usage detected');
  if (code.includes('exec(')) warnings.push('exec() usage detected');
  if (code.includes('__import__(')) warnings.push('__import__() usage detected');
  if (code.includes('subprocess.call') && code.includes('shell=True')) warnings.push('shell=True in subprocess');
  if (code.includes('os.popen')) warnings.push('os.popen() usage detected');
  return warnings;
}
