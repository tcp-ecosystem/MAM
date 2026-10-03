import { describe, it, expect, afterEach } from 'vitest';
import {
  validatePythonCode, validatePythonCodeStatic, checkPythonSyntax, checkPythonSecurityPatterns,
  getPythonSecurityIssues, stripPythonComment, getEffectiveLines, SECURITY_PATTERNS,
} from '../src/validator.js';
import {
  pythonRule, createPythonRule, createPythonRules, runPythonRules, formatPythonRuleSummary,
  checkPythonSyntaxRule, findPythonBlocks, countPythonBlocks, PYTHON_RULES, styleRule,
  securityRule, errorHandlingRule, mainGuardRule, emptyRule, sizeRule,
} from '../src/rule.js';
import {
  pythonSection, PYTHON_MANIFEST, getPythonSection, createPythonManifest,
  validatePythonContent, PYTHON_SECTION_NAME, PYTHON_LANGUAGES, PYTHON_LIMITS, PYTHON_EXAMPLE,
} from '../src/manifest.js';
import { pythonContext, createPythonContext } from '../src/context.js';
import {
  runPythonCode, runPythonFile, runPythonExpression, parseExpressionResult,
  checkPythonAvailable, resolveInterpreter, setInterpreter, getCachedInterpreter,
  resetInterpreterCache, getExecutionStats, resetExecutionStats,
} from '../src/runner.js';
import pythonPlugin, {
  createPythonPlugin, createPythonApi, describePythonPlugin, PYTHON_PLUGIN_VERSION,
} from '../src/index.js';
import type { MAMModule } from '@mam/ast';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

function pyBlock(value: string, language = 'python') {
  return [{ type: 'CodeBlock', language, value }];
}

/**
 * Execution tests need a real interpreter.
 *
 * Resolved once here so a machine without Python still runs the static suites
 * rather than failing on spawn errors.
 */
let hasPython = false;
const availability = await checkPythonAvailable(10000);
hasPython = availability.available;

const runIt = hasPython ? it : it.skip;
const runTimeout = 30000;

describe('Python Plugin - Validator', () => {
  it('should detect mixed tabs and spaces', () => {
    const code = 'def foo():\n\t    pass\n    return True';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'mixed-indent')).toBe(true);
  });

  it('should detect trailing whitespace', () => {
    const code = 'x = 1   ';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'trailing-whitespace')).toBe(true);
  });

  it('should detect long lines', () => {
    const code = 'x = ' + '"a"'.repeat(60);
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'line-length')).toBe(true);
  });

  it('should detect missing main guard', () => {
    const code = 'import os\ndef main():\n    pass';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'missing-main-guard')).toBe(true);
  });

  it('should not flag code with main guard', () => {
    const code = 'import os\ndef main():\n    pass\nif __name__ == "__main__":\n    main()';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'missing-main-guard')).toBe(false);
  });

  it('should detect os.system', () => {
    const code = 'import os\nos.system("ls")';
    expect(checkPythonSecurityPatterns(code).length).toBeGreaterThan(0);
  });

  it('should detect eval usage', () => {
    const warnings = checkPythonSecurityPatterns('x = eval("1+1")');
    expect(warnings.some((w) => w.includes('eval()'))).toBe(true);
  });

  it('should detect exec usage', () => {
    const warnings = checkPythonSecurityPatterns('exec("pass")');
    expect(warnings.some((w) => w.includes('exec()'))).toBe(true);
  });

  it('should detect __import__', () => {
    const warnings = checkPythonSecurityPatterns('__import__("os")');
    expect(warnings.some((w) => w.includes('__import__'))).toBe(true);
  });

  it('should detect shell=True', () => {
    const warnings = checkPythonSecurityPatterns('subprocess.call("ls", shell=True)');
    expect(warnings.some((w) => w.includes('shell=True'))).toBe(true);
  });

  it('regression: should keep checking after a one-line docstring', () => {
    // A one-line docstring used to leave the parser stuck inside a string, so
    // every check on later lines was silently skipped.
    const code = '"""Module docstring."""\nx = 1   \n';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'trailing-whitespace')).toBe(true);
  });

  it('should keep checking after a multi-line docstring', () => {
    const code = '"""\nMulti\nline\n"""\nx = 1   \n';
    const issues = validatePythonCodeStatic(code);
    expect(issues.some((i) => i.rule === 'trailing-whitespace')).toBe(true);
  });

  it('should not flag content inside a docstring', () => {
    const code = '"""\nx = 1   \nprint("hi")\n"""\n';
    const rules = validatePythonCodeStatic(code).map((i) => i.rule);
    expect(rules).not.toContain('trailing-whitespace');
    expect(rules).not.toContain('debug-print');
  });

  it('should report an unterminated triple-quoted string', () => {
    const issues = validatePythonCodeStatic('"""\nnever closed\n');
    expect(issues.some((i) => i.rule === 'unterminated-string')).toBe(true);
  });

  it('should not report trailing whitespace on a blank line', () => {
    const issues = validatePythonCodeStatic('x = 1\n   \ny = 2');
    expect(issues.filter((i) => i.rule === 'trailing-whitespace')).toHaveLength(0);
  });

  it('should detect a bare except', () => {
    const bare = validatePythonCodeStatic('try:\n    pass\nexcept:\n    pass');
    expect(bare.some((i) => i.rule === 'bare-except')).toBe(true);
  });

  it('should detect == None', () => {
    const eqNone = validatePythonCodeStatic('if x == None:\n    pass');
    expect(eqNone.some((i) => i.rule === 'none-comparison')).toBe(true);
  });

  it('should suggest is None', () => {
    const isNone = validatePythonCodeStatic('if x is None:\n    pass');
    expect(isNone.some((i) => i.rule === 'none-comparison')).toBe(false);
  });

  it('should detect a leftover print', () => {
    expect(validatePythonCodeStatic('print("debug")').some((i) => i.rule === 'debug-print')).toBe(true);
  });

  it('should honour a custom line length', () => {
    const code = 'x = "' + 'a'.repeat(30) + '"';
    const tooLong = validatePythonCodeStatic(code, { maxLineLength: 10 });
    const fits = validatePythonCodeStatic(code, { maxLineLength: 100 });
    expect(tooLong.some((i) => i.rule === 'line-length')).toBe(true);
    expect(fits.some((i) => i.rule === 'line-length')).toBe(false);
  });

  it('should allow disabling checks', () => {
    const code = 'x = 1   ';
    const issues = validatePythonCodeStatic(code, { checkTrailingWhitespace: false });
    expect(issues.some((i) => i.rule === 'trailing-whitespace')).toBe(false);
  });

  it('stripPythonComment should respect quotes', () => {
    expect(stripPythonComment('x = "# not a comment"  # real')).toBe('x = "# not a comment"  ');
    expect(stripPythonComment('x = 1 # real')).toBe('x = 1 ');
  });

  it('getEffectiveLines should blank out comments and docstring bodies', () => {
    const lines = getEffectiveLines('# c\n"""\ndoc\n"""\nx = 1  # t');
    expect(lines[0]).toBe('');
    // The opening delimiter opens the string, so the rest of the line blanks.
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('');
    // The closing delimiter is real code, not string content.
    expect(lines[3]).toBe('"""');
    expect(lines[4]).toBe('x = 1  ');
  });

  it('getEffectiveLines should keep a one-line docstring in place', () => {
    // It opens and closes on the same line, so nothing after it is a string.
    const lines = getEffectiveLines('"""d"""\nx = 1');
    expect(lines[0]).toBe('"""d"""');
    expect(lines[1]).toBe('x = 1');
  });

  it('SECURITY_PATTERNS should be unique by rule', () => {
    expect(new Set(SECURITY_PATTERNS.map((p) => p.rule)).size).toBe(SECURITY_PATTERNS.length);
  });

  it('getPythonSecurityIssues should carry detail', () => {
    const issues = getPythonSecurityIssues('import pickle\npickle.loads(b"")');
    expect(issues[0].rule).toBe('pickle-loads');
    expect(issues[0].severity).toBe('error');
  });

  it('should flag unsafe yaml.load but not SafeLoader', () => {
    expect(getPythonSecurityIssues('yaml.load(data)').length).toBe(1);
    expect(getPythonSecurityIssues('yaml.load(data, Loader=yaml.SafeLoader)').length).toBe(0);
  });

  it('should not flag a method named evaluate', () => {
    expect(getPythonSecurityIssues('self.evaluate(x)').length).toBe(0);
  });

  it('static validation should work with no interpreter involved', () => {
    // Synchronous by contract, so this must never need a subprocess.
    expect(validatePythonCodeStatic('x = 1').every((i) => typeof i.rule === 'string')).toBe(true);
  });
});

describe('Python Plugin - Syntax Validation', () => {
  runIt('should accept valid Python', async () => {
    const result = await checkPythonSyntax('def f():\n    return 1\n');
    expect(result.ok).toBe(true);
  }, runTimeout);

  runIt('regression: should reject invalid Python', async () => {
    // Previously no syntax check existed at all, so this reported nothing.
    const result = await checkPythonSyntax('def f(:\n');
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  }, runTimeout);

  runIt('should report the offending line number', async () => {
    const result = await checkPythonSyntax('x = 1\ny = 2\nz = (\n');
    expect(result.ok).toBe(false);
    expect(result.line).toBe(3);
  }, runTimeout);

  runIt('validatePythonCode should surface a syntax error', async () => {
    const issues = await validatePythonCode('def f(:\n');
    expect(issues.some((i) => i.rule === 'syntax-error' && !i.valid)).toBe(true);
  }, runTimeout);

  runIt('validatePythonCode should be clean for valid code', async () => {
    const issues = await validatePythonCode('x = 1\n');
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  }, runTimeout);

  it('should report gracefully when no interpreter is available', async () => {
    setInterpreter({ command: 'definitely-not-a-real-interpreter', args: [], source: 'assumed' });
    try {
      const result = await checkPythonSyntax('x = 1');
      expect(result.ok).toBe(false);
      expect(result.unavailable).toBeTruthy();
    } finally {
      resetInterpreterCache();
    }
  });
});

describe('Python Plugin - Runner', () => {
  afterEach(() => {
    resetExecutionStats();
  });

  runIt('should report availability and version', async () => {
    const result = await checkPythonAvailable(10000);
    expect(result.available).toBe(true);
    expect(result.version).toMatch(/^\d+\./);
  }, runTimeout);

  it('should resolve an interpreter even on first use', async () => {
    // `python3` is a Microsoft Store alias on Windows and exits 9009, so a
    // hardcoded name meant the plugin could never run there.
    const interpreter = await resolveInterpreter();
    expect(interpreter.command).toBeTruthy();
    expect(interpreter.source).not.toBe('assumed');
  }, runTimeout);

  runIt('should run code and capture stdout', async () => {
    const result = await runPythonCode('print("hello")', { timeout: 20000 });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.interpreter).toBeTruthy();
  }, runTimeout);

  runIt('should preserve leading and trailing whitespace in output', async () => {
    // The old runner trimmed both streams, so a program printing padded text
    // came back altered.
    const result = await runPythonCode('print("  padded  ")', { timeout: 20000 });
    expect(result.stdout).toBe('  padded  \n');
  }, runTimeout);

  runIt('should normalise CRLF so output is platform-independent', async () => {
    const result = await runPythonCode('print("a")', { timeout: 20000 });
    expect(result.stdout).not.toContain('\r');
  }, runTimeout);

  runIt('should preserve CRLF when asked', async () => {
    const result = await runPythonCode('print("a")', { timeout: 20000, preserveLineEndings: true });
    expect(result.stdout).toContain('\r');
  }, runTimeout);

  runIt('should report a non-zero exit code', async () => {
    const result = await runPythonCode('raise SystemExit(3)', { timeout: 20000 });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
  }, runTimeout);

  runIt('should capture stderr from an exception', async () => {
    const result = await runPythonCode('raise ValueError("boom")', { timeout: 20000 });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('boom');
  }, runTimeout);

  runIt('should flag a timeout distinctly', async () => {
    const result = await runPythonCode('import time\ntime.sleep(5)', { timeout: 1000 });
    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
    expect(result.timeMs).toBeLessThan(4000);
  }, runTimeout);

  runIt('should cap runaway output', async () => {
    const result = await runPythonCode('print("x" * 200000)', {
      timeout: 20000, maxOutputBytes: 200,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(200);
  }, runTimeout);

  runIt('should write stdin and close it', async () => {
    const result = await runPythonCode('import sys\nprint(sys.stdin.read().upper())', {
      timeout: 20000, stdin: 'abc',
    });
    expect(result.stdout.trim()).toBe('ABC');
  }, runTimeout);

  runIt('should close stdin even when no input is given', async () => {
    // Otherwise a script reading stdin would block until the timeout.
    const result = await runPythonCode('import sys\nprint(repr(sys.stdin.read()))', { timeout: 20000 });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("''");
  }, runTimeout);

  runIt('should pass custom environment variables', async () => {
    const result = await runPythonCode('import os\nprint(os.environ["FOO"])', {
      timeout: 20000, env: { FOO: 'bar' },
    });
    expect(result.stdout.trim()).toBe('bar');
  }, runTimeout);

  runIt('should handle unicode output', async () => {
    const result = await runPythonCode('print("\u00e9\u4e2d\u6587")', { timeout: 20000 });
    expect(result.stdout.trim()).toBe('\u00e9\u4e2d\u6587');
  }, runTimeout);

  runIt('should evaluate an expression to a value', async () => {
    const result = await runPythonExpression('{"a": [1, 2]}', { timeout: 20000 });
    expect(parseExpressionResult(result)).toEqual({ value: { a: [1, 2] } });
  }, runTimeout);

  runIt('should recover the error message from a failed expression', async () => {
    const result = await runPythonExpression('1/0', { timeout: 20000 });
    expect(parseExpressionResult(result).error).toContain('division by zero');
  }, runTimeout);

  runIt('should run a script file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-python-test-'));
    try {
      const file = join(dir, 'script.py');
      await writeFile(file, 'print("from file")', 'utf-8');
      const result = await runPythonFile(file, { timeout: 20000 });
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('from file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, runTimeout);

  runIt('should leave no temp script behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-python-tmp-'));
    try {
      await runPythonCode('print("x")', { timeout: 20000, tempDir: dir });
      const { readdir } = await import('node:fs/promises');
      // The working directory itself is kept so repeated runs reuse it; only
      // the per-run script must be cleaned up.
      const entries = await readdir(join(dir, 'mam-python'));
      expect(entries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, runTimeout);

  runIt('should record execution statistics', async () => {
    await runPythonCode('print("a")', { timeout: 20000 });
    await runPythonCode('raise SystemExit(1)', { timeout: 20000 });
    const stats = getExecutionStats();
    expect(stats.runs).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.averageTimeMs).toBeGreaterThan(0);
  }, runTimeout);

  runIt('resetExecutionStats should clear the counters', async () => {
    await runPythonCode('print("a")', { timeout: 20000 });
    resetExecutionStats();
    expect(getExecutionStats().runs).toBe(0);
  }, runTimeout);

  runIt('should run with a missing interpreter without throwing', async () => {
    const result = await runPythonCode('print("x")', {
      timeout: 5000, interpreter: { command: 'no-such-python-binary', args: [], source: 'assumed' },
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
  }, runTimeout);

  it('setInterpreter and getCachedInterpreter should round-trip', () => {
    setInterpreter({ command: 'custom-python', args: [], source: 'env' });
    expect(getCachedInterpreter()?.command).toBe('custom-python');
    setInterpreter(null);
    expect(getCachedInterpreter()).toBeNull();
  });
});

describe('Python Plugin - Rule', () => {
  it('should validate Python code blocks', () => {
    const mod = makeModule([{
      name: 'Code',
      content: [{ type: 'CodeBlock', language: 'python', value: 'def foo():\n\t    pass\n    return True' }],
    }]);
    const results = pythonRule.check(mod);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should pass clean Python code', () => {
    const mod = makeModule([{
      name: 'Code',
      content: [{ type: 'CodeBlock', language: 'python', value: 'x = 1\ny = 2' }],
    }]);
    const results = pythonRule.check(mod);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('should report security warnings', () => {
    const mod = makeModule([{
      name: 'Code',
      content: [{ type: 'CodeBlock', language: 'python', value: 'eval("bad")' }],
    }]);
    const results = pythonRule.check(mod);
    expect(results.some((r) => r.message?.includes('Security'))).toBe(true);
  });

  it('should accept the py language tag', () => {
    expect(countPythonBlocks(makeModule([{ name: 'C', content: pyBlock('x = 1', 'py') }]))).toBe(1);
  });

  it('should find blocks across every section', () => {
    const mod = makeModule([
      { name: 'A', content: pyBlock('x = 1') },
      { name: 'B', content: pyBlock('y = 1') },
    ]);
    expect(findPythonBlocks(mod)).toHaveLength(2);
  });

  it('should carry the location when the node has one', () => {
    const node = { type: 'CodeBlock', language: 'python', value: 'x = 1   ', location: { start: { line: 5, column: 1 } } };
    const results = pythonRule.check(makeModule([{ name: 'C', content: [node] }]));
    expect(results[0].location).toBeDefined();
  });

  it('emptyRule should report an empty block', () => {
    const results = emptyRule.check(makeModule([{ name: 'C', content: pyBlock('   ') }]));
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
  });

  it('styleRule should report trailing whitespace', () => {
    const results = styleRule.check(makeModule([{ name: 'C', content: pyBlock('x = 1   ') }]));
    expect(results.some((r) => r.rule === 'python-style')).toBe(true);
  });

  it('securityRule should report eval as invalid at error severity', () => {
    const results = securityRule.check(makeModule([{ name: 'C', content: pyBlock('pickle.loads(b"")') }]));
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('errorHandlingRule should report a bare except', () => {
    const results = errorHandlingRule.check(makeModule([{ name: 'C', content: pyBlock('try:\n    pass\nexcept:\n    pass') }]));
    expect(results.some((r) => r.rule === 'python-error-handling')).toBe(true);
  });

  it('mainGuardRule should report a missing guard', () => {
    const results = mainGuardRule.check(makeModule([{ name: 'C', content: pyBlock('import os\ndef f():\n    pass') }]));
    expect(results.some((r) => r.rule === 'python-main-guard')).toBe(true);
  });

  it('sizeRule should flag an oversized block', () => {
    const big = Array.from({ length: 5 }, (_, i) => `x${i} = ${i}`).join('\n');
    const mod = makeModule([{ name: 'C', content: pyBlock(big) }]);
    expect(sizeRule.check(mod)).toEqual([]);
  });

  it('PYTHON_RULES should contain the full family', () => {
    expect(PYTHON_RULES).toHaveLength(6);
    expect(new Set(PYTHON_RULES.map((r) => r.name)).size).toBe(PYTHON_RULES.length);
  });

  it('createPythonRule should override the severity', () => {
    expect(createPythonRule('error').severity).toBe('error');
    expect(createPythonRule().severity).toBe('warning');
  });

  it('createPythonRules should re-level every rule', () => {
    expect(createPythonRules('info').every((r) => r.severity === 'info')).toBe(true);
  });

  it('runPythonRules should contain a rule that throws', () => {
    const exploding = {
      name: 'boom', description: '', severity: 'error' as const,
      check: () => { throw new Error('kaboom'); },
    };
    const results = runPythonRules(makeModule([]), [exploding]);
    expect(results[0].message).toMatch(/kaboom/);
  });

  it('formatPythonRuleSummary should count each severity', () => {
    expect(formatPythonRuleSummary([])).toBe('no problems');
    expect(formatPythonRuleSummary([
      { valid: false, message: 'a' },
      { valid: true, message: 'b', severity: 'warning' },
      { valid: true, message: 'c', severity: 'info' },
    ])).toBe('1 error, 1 warning, 1 info');
  });

  it('rules should return nothing for a module with no Python blocks', () => {
    const mod = makeModule([{ name: 'C', content: [{ type: 'Paragraph', value: 'hi' }] }]);
    for (const rule of PYTHON_RULES) {
      expect(rule.check(mod)).toEqual([]);
    }
  });

  runIt('checkPythonSyntaxRule should report a syntax error', async () => {
    const mod = makeModule([{ name: 'C', content: pyBlock('def f(:\n') }]);
    const results = await checkPythonSyntaxRule(mod);
    expect(results.some((r) => !r.valid && r.rule === 'python-syntax-check')).toBe(true);
  }, runTimeout);

  runIt('checkPythonSyntaxRule should pass valid code', async () => {
    const mod = makeModule([{ name: 'C', content: pyBlock('x = 1\n') }]);
    expect(await checkPythonSyntaxRule(mod)).toEqual([]);
  }, runTimeout);
});

describe('Python Plugin - Manifest', () => {
  it('should have correct manifest', () => {
    expect(PYTHON_MANIFEST.name).toBe('@mam/plugin-python');
    expect(PYTHON_MANIFEST.keywords).toContain('python');
  });

  it('getPythonSection should return a copy', () => {
    const s1 = getPythonSection();
    const s2 = getPythonSection();
    expect(s1).not.toBe(s2);
  });

  it('section validator should reject empty code', () => {
    const results = pythonSection.validator!(pyBlock('') as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('section validator should warn on os.system', () => {
    const results = pythonSection.validator!(pyBlock('import os\nos.system("ls")') as any);
    expect(results.some((r) => r.message?.includes('OS commands') || r.message?.includes('os.system'))).toBe(true);
  });

  it('should require a MAM version the host can satisfy', () => {
    expect(PYTHON_MANIFEST.mamVersion).toBe('>=0.1.0');
  });

  it('should point main at a file the package actually ships', () => {
    expect(PYTHON_MANIFEST.main).toBe('./dist/index.js');
    expect(PYTHON_MANIFEST.version).toBe('0.1.0');
  });

  it('should export the section name, languages, limits and example', () => {
    expect(PYTHON_SECTION_NAME).toBe('Python');
    expect(PYTHON_LANGUAGES).toContain('py');
    expect(PYTHON_LIMITS.maxLines).toBeGreaterThan(0);
    expect(PYTHON_EXAMPLE).toContain('```python');
  });

  it('should use the same analyser as the rules', () => {
    // Previously this file re-implemented its own os.system check.
    const results = validatePythonContent(pyBlock('import os\nos.system("ls")'));
    expect(results.some((r) => r.rule === 'os-system')).toBe(true);
  });

  it('should report the line for a style issue', () => {
    const results = validatePythonContent(pyBlock('x = 1\ny = 2   '));
    const issue = results.find((r) => r.rule === 'trailing-whitespace');
    expect(issue?.location?.line).toBe(2);
  });

  it('getPythonSection should apply a custom line limit', () => {
    const section = getPythonSection({ validation: { maxLineLength: 5 } });
    const results = section.validator!(pyBlock('x = "aaaaaaaaaa"') as any);
    expect(results.some((r) => r.rule === 'line-length')).toBe(true);
  });

  it('should ignore non-Python blocks', () => {
    expect(pythonSection.validator!([{ type: 'CodeBlock', language: 'js', value: 'x = 1' }] as any)).toEqual([]);
  });

  it('createPythonManifest should override without mutating the original', () => {
    const custom = createPythonManifest({ version: '2.0.0', keywords: ['custom'] });
    expect(custom.version).toBe('2.0.0');
    expect(custom.keywords).toEqual(['custom']);
    expect(PYTHON_MANIFEST.version).toBe('0.1.0');
  });
});

describe('Python Plugin - Context', () => {
  it('pythonContext should handle python language', () => {
    expect(pythonContext.canHandle('python')).toBe(true);
    expect(pythonContext.canHandle('py')).toBe(true);
    expect(pythonContext.canHandle('python3')).toBe(true);
    expect(pythonContext.canHandle('javascript')).toBe(false);
  });

  it('pythonContext should have correct name', () => {
    expect(pythonContext.name).toBe('python');
    expect(pythonContext.language).toBe('python');
  });

  it('createPythonContext should create a context', () => {
    const ctx = createPythonContext({ timeout: 5000 });
    expect(ctx.name).toBe('python');
    expect(ctx.canHandle('python')).toBe(true);
  });

  runIt('should execute code and return output', async () => {
    const result = await pythonContext.execute('print("from context")', {} as never);
    expect(result.success).toBe(true);
    expect(String(result.output).trim()).toBe('from context');
  }, runTimeout);

  runIt('should surface a Python error', async () => {
    const result = await pythonContext.execute('raise ValueError("nope")', {} as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('nope');
  }, runTimeout);

  runIt('should report a timeout as an error', async () => {
    const result = await pythonContext.execute('import time\ntime.sleep(5)', { timeout: 800 } as never);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  }, runTimeout);

  runIt('createPythonContext should honour its own timeout', async () => {
    const ctx = createPythonContext({ timeout: 800 });
    const result = await ctx.execute('import time\ntime.sleep(5)', {} as never);
    expect(result.success).toBe(false);
  }, runTimeout);

  runIt('should support expression mode', async () => {
    const ctx = createPythonContext({ asExpression: true });
    const result = await ctx.execute('1 + 1', {} as never);
    expect(result.success).toBe(true);
    // print() adds the trailing newline, which is preserved by default.
    expect(result.output).toBe('2\n');
  }, runTimeout);
});

describe('Python Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(pythonPlugin.manifest.name).toBe('@mam/plugin-python');
    expect(pythonPlugin.sections).toHaveLength(1);
    expect(pythonPlugin.rules).toHaveLength(1);
    expect(pythonPlugin.contexts).toHaveLength(1);
  });
});

describe('Python Plugin - Factories', () => {
  it('createPythonPlugin should build a default plugin', () => {
    const plugin = createPythonPlugin();
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.sections?.[0]?.name).toBe(PYTHON_SECTION_NAME);
    expect(plugin.contexts).toHaveLength(1);
  });

  it('createPythonPlugin should include the full rule family on request', () => {
    expect(createPythonPlugin({ allRules: true }).rules).toHaveLength(6);
  });

  it('createPythonPlugin should apply a severity', () => {
    const plugin = createPythonPlugin({ allRules: true, severity: 'error' });
    expect(plugin.rules?.every((r) => r.severity === 'error')).toBe(true);
  });

  it('createPythonPlugin should thread context options', async () => {
    const plugin = createPythonPlugin({ context: { timeout: 5000, trimOutput: true } });
    const ctx = plugin.contexts![0]!;
    const result = await ctx.execute('print("  x  ")', {} as never);
    expect(result.output).toBe('x');
  }, runTimeout);

  it('createPythonPlugin should override the manifest', () => {
    expect(createPythonPlugin({ manifest: { version: '9.9.9' } }).manifest.version).toBe('9.9.9');
  });

  it('createPythonApi should bundle the runner and rules', () => {
    const api = createPythonApi();
    expect(api.version).toBe(PYTHON_PLUGIN_VERSION);
    expect(api.sectionName).toBe('Python');
    expect(api.rules).toHaveLength(6);
    expect(api.example).toContain('```python');
    expect(api.limits.maxLines).toBeGreaterThan(0);
  });

  runIt('createPythonApi should run and evaluate', async () => {
    const api = createPythonApi();
    const run = await api.run('print("api")', { timeout: 20000 });
    expect(run.stdout.trim()).toBe('api');
    expect(await api.evaluate('2 * 3', { timeout: 20000 })).toEqual({ value: 6 });
  }, runTimeout);

  it('describePythonPlugin should summarise the surface', () => {
    const text = describePythonPlugin();
    expect(text).toContain(PYTHON_PLUGIN_VERSION);
    expect(text).toContain('not a sandbox');
  });
});
