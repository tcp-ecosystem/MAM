/**
 * Python Plugin - Code Validation
 *
 * Static checks over Python source. Syntax is validated by the interpreter's
 * own parser (via `ast.parse`) rather than a regex, because only the real
 * parser can tell a valid file from an invalid one; everything else here is
 * style and security heuristics.
 */

import { runPythonCode, type PythonInterpreter } from './runner.js';

export interface PythonValidationIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule: string;
}

export interface PythonValidationOptions {
  /** Warn past this column. Off by default. */
  maxLineLength?: number;
  /** Report trailing whitespace. Default true. */
  checkTrailingWhitespace?: boolean;
  /** Report lines over the limit. Default true. */
  checkLineLength?: boolean;
  /** Report a module with imports and functions but no `__main__` guard. */
  checkMainGuard?: boolean;
  /** Include the interpreter's syntax errors. Default true. */
  checkSyntax?: boolean;
  /** Timeout for the syntax check. Default 15000. */
  timeout?: number;
}

// ─── Tokenisation Helpers ─────────────────────────────────────────

/** True when a line's quotes are balanced, ignoring escaped characters. */
function quotesBalanced(line: string): boolean {
  let single = 0;
  let double = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '\\') {
      i++;
      continue;
    }
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = !inSingle;
    else if (char === '"') inDouble = !inDouble;
  }
  void single; void double;
  return !inSingle && !inDouble;
}

/**
 * Tracks triple-quoted string state across lines.
 *
 * A one-line docstring such as `"""Docs."""` opens and closes on the same
 * line; toggling a single flag on any line containing `"""` left the state
 * stuck open, so every check after the first docstring was silently skipped.
 */
class TripleQuoteTracker {
  private state: string | null = null;

  /** Feeds one line and returns true when the line is inside a triple-quoted string. */
  update(line: string): boolean {
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '\\') {
        i++;
        continue;
      }
      if (this.state === null) {
        if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
          this.state = line.slice(i, i + 3);
          i += 2;
        }
      } else if (line.startsWith(this.state, i)) {
        this.state = null;
        i += 2;
      }
    }
    return this.state !== null;
  }

  get open(): boolean {
    return this.state !== null;
  }
}

/** Strips a `#` comment, respecting quotes. */
export function stripPythonComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '\\') {
      i++;
      continue;
    }
    if (inSingle) { if (char === "'") inSingle = false; continue; }
    if (inDouble) { if (char === '"') inDouble = false; continue; }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Returns the code with comments and docstrings removed, for line mapping. */
export function getEffectiveLines(code: string): string[] {
  const tracker = new TripleQuoteTracker();
  return code.split('\n').map((line) => {
    const inside = tracker.update(line);
    return inside ? '' : stripPythonComment(line);
  });
}

// ─── Syntax Validation ────────────────────────────────────────────

/**
 * A program that prints a JSON description of a syntax error, or nothing.
 *
 * `ast.parse` is CPython's own parser, so this accepts exactly the syntax the
 * installed interpreter accepts rather than an approximation of it.
 */
const SYNTAX_PROBE = [
  'import ast, json, sys',
  'try:',
  '    ast.parse(json.loads(sys.stdin.read()))',
  '    print(json.dumps({"ok": True}))',
  'except SyntaxError as e:',
  '    print(json.dumps({',
  '        "ok": False,',
  '        "line": e.lineno or 0,',
  '        "offset": e.offset or 0,',
  '        "message": e.msg or str(e),',
  '    }))',
].join('\n');

export interface PythonSyntaxResult {
  ok: boolean;
  line?: number;
  column?: number;
  message?: string;
  /** Set when the check could not run at all. */
  unavailable?: string;
}

/** Validates Python syntax using the interpreter's own parser. */
export async function checkPythonSyntax(
  code: string,
  options: { timeout?: number; interpreter?: PythonInterpreter } = {},
): Promise<PythonSyntaxResult> {
  const result = await runPythonCode(SYNTAX_PROBE, {
    timeout: options.timeout ?? 15000,
    ...(options.interpreter ? { interpreter: options.interpreter } : {}),
    stdin: JSON.stringify(code),
    trimOutput: true,
  });

  if (!result.success) {
    return { ok: false, unavailable: result.stderr || 'Syntax check could not run' };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean; line?: number; offset?: number; message?: string;
    };
    if (parsed.ok) return { ok: true };
    return {
      ok: false,
      line: parsed.line,
      column: parsed.offset,
      message: parsed.message,
    };
  } catch (error) {
    return { ok: false, unavailable: `Unparsable probe output: ${(error as Error).message}` };
  }
}

// ─── Static Checks ────────────────────────────────────────────────

function syntaxIssues(
  syntax: PythonSyntaxResult,
  fallbackCode: string,
): PythonValidationIssue[] {
  if (syntax.unavailable !== undefined) {
    return [{
      line: 1, column: 1, severity: 'warning', rule: 'syntax-unavailable',
      message: `Syntax check skipped: ${syntax.unavailable}`,
    }];
  }
  if (syntax.ok) return [];
  // A SyntaxError without a usable position still means the file is invalid.
  const lines = fallbackCode.split('\n');
  const issues: PythonValidationIssue[] = [{
    line: syntax.line && syntax.line > 0 ? syntax.line : 1,
    column: syntax.column && syntax.column > 0 ? syntax.column : 1,
    severity: 'error',
    rule: 'syntax-error',
    message: `Syntax error: ${syntax.message ?? 'invalid Python'}`,
  }];
  // Anchor the offending line so an editor can highlight it.
  if (syntax.line && syntax.line > 0 && syntax.line <= lines.length) {
    issues.push({
      line: syntax.line,
      column: 1,
      severity: 'info',
      rule: 'syntax-error-context',
      message: lines[syntax.line - 1]!.trim().slice(0, 80),
    });
  }
  return issues;
}

/**
 * Runs the style and heuristic checks.
 *
 * Synchronous and interpreter-free, so it is safe to call on every keystroke
 * or on a host with no Python available. Use
 * {@link validatePythonCode} for the full check including syntax.
 */
export function validatePythonCodeStatic(
  code: string,
  options: PythonValidationOptions = {},
): PythonValidationIssue[] {
  const maxLineLength = options.maxLineLength ?? 120;
  const issues: PythonValidationIssue[] = [];
  const lines = code.split('\n');
  const tracker = new TripleQuoteTracker();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const inString = tracker.update(line);
    if (inString) continue;

    const codeOnly = stripPythonComment(line);

    // A tab anywhere in the indentation conflicts with space-based indenting.
    if (/^[ ]*\t|^\t+[ ]/.test(codeOnly)) {
      issues.push({
        line: lineNum, column: line.length - codeOnly.trimStart().length + 1,
        severity: 'warning', rule: 'mixed-indent',
        message: 'Tab used for indentation; Python 3 rejects inconsistent tabs and spaces',
      });
    }

    if (options.checkTrailingWhitespace ?? true) {
      const trailing = /\s+$/.exec(line);
      if (trailing && trailing[0].length > 0 && line.trim().length > 0) {
        issues.push({
          line: lineNum, column: line.length - trailing[0].length + 1,
          severity: 'info', rule: 'trailing-whitespace',
          message: 'Trailing whitespace',
        });
      }
    }

    if ((options.checkLineLength ?? true) && line.length > maxLineLength) {
      issues.push({
        line: lineNum, column: maxLineLength + 1,
        severity: 'info', rule: 'line-length',
        message: `Line exceeds ${maxLineLength} characters (${line.length})`,
      });
    }

    if (/^\s*print\(/.test(codeOnly)) {
      issues.push({
        line: lineNum, column: codeOnly.indexOf('print') + 1,
        severity: 'info', rule: 'debug-print',
        message: 'print() left in code; consider logging or returning a value',
      });
    }

    if (/==\s*None|!=\s*None/.test(codeOnly)) {
      issues.push({
        line: lineNum, column: Math.max(1, codeOnly.search(/==\s*None|!=\s*None/)),
        severity: 'info', rule: 'none-comparison',
        message: 'Use "is None" rather than == None',
      });
    }

    if (/except\s*:/.test(codeOnly)) {
      issues.push({
        line: lineNum, column: 1, severity: 'warning', rule: 'bare-except',
        message: 'Bare except catches everything, including KeyboardInterrupt',
      });
    }

    if (/^\s*def\s+[A-Za-z_]\w*\([^)]*\)\s*:/.test(codeOnly) && !quotesBalanced(codeOnly)) {
      issues.push({
        line: lineNum, column: 1, severity: 'error', rule: 'unbalanced-quotes',
        message: 'Unterminated string on a def line',
      });
    }
  }

  if (tracker.open) {
    issues.push({
      line: lines.length, column: 1, severity: 'error', rule: 'unterminated-string',
      message: 'Unterminated triple-quoted string',
    });
  }

  if (options.checkMainGuard ?? true) {
    const hasMainGuard = /__name__\s*==\s*['"]__main__['"]/.test(code);
    const hasDef = /^\s*def\s+/m.test(code);
    const hasImport = /^\s*(import\s|from\s+\S+\s+import\s)/m.test(code);
    if (hasImport && hasDef && !hasMainGuard) {
      issues.push({
        line: 1, column: 1, severity: 'warning', rule: 'missing-main-guard',
        message: 'Module has imports and functions but no __main__ guard',
      });
    }
  }

  for (const finding of SECURITY_PATTERNS) {
    if (finding.pattern.test(code)) {
      issues.push({
        line: 1, column: 1, severity: finding.severity, rule: finding.rule,
        message: finding.message,
      });
    }
  }

  return issues;
}

export interface PythonSecurityPattern {
  rule: string;
  message: string;
  pattern: RegExp;
  severity: PythonValidationIssue['severity'];
}

/**
 * Security heuristics.
 *
 * Reported as findings for a human to judge: none of these is proof of a
 * vulnerability, and a static scan cannot see through indirection such as
 * `getattr(os, "system")`.
 */
export const SECURITY_PATTERNS: PythonSecurityPattern[] = [
  { rule: 'os-system', message: 'os.system() usage detected; prefer subprocess', pattern: /\bos\.system\s*\(/, severity: 'warning' },
  { rule: 'eval', message: 'eval() usage detected', pattern: /(?<![.\w])eval\s*\(/, severity: 'warning' },
  { rule: 'exec', message: 'exec() usage detected', pattern: /(?<![.\w])exec\s*\(/, severity: 'warning' },
  { rule: 'dunder-import', message: '__import__() usage detected', pattern: /__import__\s*\(/, severity: 'warning' },
  { rule: 'shell-true', message: 'shell=True in subprocess', pattern: /shell\s*=\s*True/, severity: 'warning' },
  { rule: 'os-popen', message: 'os.popen() usage detected', pattern: /\bos\.popen\s*\(/, severity: 'warning' },
  { rule: 'pickle-loads', message: 'pickle.loads() can execute arbitrary code on untrusted input', pattern: /\bpickle\.loads?\s*\(/, severity: 'error' },
  { rule: 'yaml-unsafe-load', message: 'yaml.load() without SafeLoader can construct arbitrary objects', pattern: /yaml\.load\s*\((?![^)]*Safe)/, severity: 'error' },
  { rule: 'assert-statement', message: 'assert is removed under python -O', pattern: /^\s*assert\b/m, severity: 'info' },
];

/** Returns the security findings for a block of code, as plain messages. */
export function checkPythonSecurityPatterns(code: string): string[] {
  return SECURITY_PATTERNS.filter((p) => p.pattern.test(code)).map((p) => p.message);
}

/** Returns the security findings for a block of code, with detail. */
export function getPythonSecurityIssues(code: string): PythonValidationIssue[] {
  return SECURITY_PATTERNS.filter((p) => p.pattern.test(code)).map((p) => ({
    line: 1, column: 1, severity: p.severity, rule: p.rule, message: p.message,
  }));
}

/**
 * Validates Python code, including a real syntax check.
 *
 * Async because the syntax check runs in the interpreter. Returns every issue
 * found rather than stopping at the first, so one pass surfaces them all.
 */
export async function validatePythonCode(
  code: string,
  options: PythonValidationOptions = {},
): Promise<PythonValidationIssue[]> {
  const issues = validatePythonCodeStatic(code, options);
  if (options.checkSyntax === false) return issues;

  const syntax = await checkPythonSyntax(code, {
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
  if (syntax.ok) return issues;

  // A syntax error makes the rest of the analysis unreliable.
  return syntaxIssues(syntax, code);
}
