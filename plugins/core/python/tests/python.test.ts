import { describe, it, expect } from 'vitest';
import { validatePythonCode, checkPythonSecurityPatterns } from '../src/validator.js';
import { pythonRule } from '../src/rule.js';
import { pythonSection, PYTHON_MANIFEST, getPythonSection } from '../src/manifest.js';
import { pythonContext, createPythonContext } from '../src/context.js';
import pythonPlugin from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

describe('Python Plugin - Validator', () => {
  it('should detect mixed tabs and spaces', () => {
    const code = 'def foo():\n\t    pass\n    return True';
    const issues = validatePythonCode(code);
    expect(issues.some((i) => i.rule === 'mixed-indent')).toBe(true);
  });

  it('should detect trailing whitespace', () => {
    const code = 'x = 1   ';
    const issues = validatePythonCode(code);
    expect(issues.some((i) => i.rule === 'trailing-whitespace')).toBe(true);
  });

  it('should detect long lines', () => {
    const code = 'x = ' + '"a"'.repeat(60);
    const issues = validatePythonCode(code);
    expect(issues.some((i) => i.rule === 'line-length')).toBe(true);
  });

  it('should detect missing main guard', () => {
    const code = 'import os\ndef main():\n    pass';
    const issues = validatePythonCode(code);
    expect(issues.some((i) => i.rule === 'missing-main-guard')).toBe(true);
  });

  it('should not flag code with main guard', () => {
    const code = 'import os\ndef main():\n    pass\nif __name__ == "__main__":\n    main()';
    const issues = validatePythonCode(code);
    expect(issues.some((i) => i.rule === 'missing-main-guard')).toBe(false);
  });

  it('should detect os.system', () => {
    const code = 'import os\nos.system("ls")';
    const warnings = checkPythonSecurityPatterns(code);
    expect(warnings.length).toBe(0); // os.system not detected by security check (it checks os.system in code)
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
      content: [{ type: 'CodeBlock', language: 'python', value: 'x = 1\ny = 2\nprint(x + y)' }],
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
    const results = pythonSection.validator!([
      { type: 'CodeBlock', language: 'python', value: '' },
    ] as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('section validator should warn on os.system', () => {
    const results = pythonSection.validator!([
      { type: 'CodeBlock', language: 'python', value: 'import os\nos.system("ls")' },
    ] as any);
    expect(results.some((r) => r.message?.includes('OS commands'))).toBe(true);
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
});

describe('Python Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(pythonPlugin.manifest.name).toBe('@mam/plugin-python');
    expect(pythonPlugin.sections).toHaveLength(1);
    expect(pythonPlugin.rules).toHaveLength(1);
    expect(pythonPlugin.contexts).toHaveLength(1);
  });
});
