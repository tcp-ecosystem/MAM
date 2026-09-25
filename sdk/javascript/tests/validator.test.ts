import { describe, it, expect } from 'vitest';
import {
  validate,
  countIssuesBySeverity,
  hasErrors,
  hasWarnings,
  filterIssuesBySeverity,
  getIssueMessages,
  isValid,
  summarizeIssues,
} from '../mam/validator.js';
import { parseMAM } from '../mam/parser.js';
import type { AST, ValidationRule, ValidationIssue } from '../mam/validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAST(content: string): AST {
  return parseMAM(content).ast;
}

const VALID_MAM = `---
id: test-module
version: 2.0.0
name: Test Module
author: TestAuthor
runtime: python
---

## Purpose

A test module.
`;

const INVALID_ID_MAM = `---
id: Invalid_ID!
version: 2.0.0
name: Bad Module
author: Test
runtime: python
---

## Purpose

Test.
`;

const INVALID_VERSION_MAM = `---
id: test
version: not-a-version
name: Bad Module
author: Test
runtime: python
---

## Purpose

Test.
`;

const INVALID_RUNTIME_MAM = `---
id: test
version: 2.0.0
name: Bad Module
author: Test
runtime: invalid
---

## Purpose

Test.
`;

const NO_FRONTMATTER = `## Purpose

No frontmatter.
`;

const MISSING_SECTIONS = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Rules

- A rule.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validate', () => {
  describe('schema level', () => {
    it('passes for valid module', () => {
      const ast = makeAST(VALID_MAM);
      const issues = validate(ast, { level: 'schema' });
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('errors when frontmatter is missing', () => {
      const ast = makeAST(NO_FRONTMATTER);
      const issues = validate(ast, { level: 'schema' });
      expect(issues.some((i) => i.code === 'FRONTMATTER_MISSING')).toBe(true);
    });

    it('errors for invalid ID format', () => {
      const ast = makeAST(INVALID_ID_MAM);
      const issues = validate(ast, { level: 'schema' });
      expect(issues.some((i) => i.code === 'FIELD_FORMAT' && i.rule === 'id-format')).toBe(true);
    });

    it('errors for invalid version format', () => {
      const ast = makeAST(INVALID_VERSION_MAM);
      const issues = validate(ast, { level: 'schema' });
      expect(issues.some((i) => i.code === 'FIELD_FORMAT' && i.rule === 'version-format')).toBe(true);
    });

    it('errors for invalid runtime', () => {
      const ast = makeAST(INVALID_RUNTIME_MAM);
      const issues = validate(ast, { level: 'schema' });
      expect(issues.some((i) => i.code === 'FIELD_INVALID' && i.rule === 'runtime-valid')).toBe(true);
    });

    it('validates all required fields', () => {
      const content = `---
id: test
---

## Purpose

Test.
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'schema' });
      const requiredErrors = issues.filter((i) => i.code === 'FIELD_REQUIRED');
      expect(requiredErrors.length).toBeGreaterThanOrEqual(4); // version, name, author, runtime
    });
  });

  describe('semantic level', () => {
    it('errors when required sections are missing', () => {
      const ast = makeAST(MISSING_SECTIONS);
      const issues = validate(ast, { level: 'semantic' });
      expect(issues.some((i) => i.code === 'SECTION_MISSING')).toBe(true);
    });

    it('warns on empty code blocks', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test.

## Python

\`\`\`python

\`\`\`
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'semantic' });
      expect(issues.some((i) => i.code === 'CODEBLOCK_EMPTY')).toBe(true);
    });

    it('warns on code blocks without language', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test.

## Example

\`\`\`
some code
\`\`\`
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'semantic' });
      expect(issues.some((i) => i.code === 'CODEBLOCK_NO_LANGUAGE')).toBe(true);
    });

    it('validates dependency format', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
dependencies:
  - PyJWT >= 2.8.0
  - !!!invalid-dep
---

## Purpose

Test.
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'semantic' });
      expect(issues.some((i) => i.code === 'DEPENDENCY_INVALID_FORMAT')).toBe(true);
    });

    it('validates reference URLs', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test.

## References

- [Good](https://example.com)
- [Bad](not-a-url)
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'semantic' });
      expect(issues.some((i) => i.code === 'REFERENCE_INVALID_URL')).toBe(true);
    });
  });

  describe('strict level', () => {
    it('validates section ordering', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Examples

Example here.

## Purpose

Should come first.
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'strict' });
      expect(issues.some((i) => i.code === 'SECTION_ORDER')).toBe(true);
    });
  });

  describe('custom rules', () => {
    it('runs custom validation rules', () => {
      const customRule: ValidationRule = {
        name: 'custom-check',
        description: 'Always fails',
        severity: 'error',
        check: (ast) => [
          {
            rule: 'custom-check',
            code: 'CUSTOM_RULE_FAILED',
            message: 'Custom rule triggered',
            severity: 'error',
          },
        ],
      };
      const ast = makeAST(VALID_MAM);
      const issues = validate(ast, { level: 'schema', customRules: [customRule] });
      expect(issues.some((i) => i.rule === 'custom-check')).toBe(true);
    });

    it('handles custom rule that throws', () => {
      const badRule: ValidationRule = {
        name: 'bad-rule',
        description: 'Throws',
        severity: 'error',
        check: () => {
          throw new Error('Intentional failure');
        },
      };
      const ast = makeAST(VALID_MAM);
      const issues = validate(ast, { level: 'schema', customRules: [badRule] });
      expect(issues.some((i) => i.code === 'CUSTOM_RULE_FAILED')).toBe(true);
    });
  });

  describe('config options', () => {
    it('respects maxErrors', () => {
      const content = `---
id: test
version: not-valid
name: Test
author: Test
runtime: invalid
---

## Rules

- A rule.
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'schema', maxErrors: 2 });
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors.length).toBeLessThanOrEqual(2);
    });

    it('filters warnings when collectWarnings is false', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test.

## CustomSection

Content.
`;
      const ast = makeAST(content);
      const issues = validate(ast, { level: 'semantic', collectWarnings: false });
      expect(issues.every((i) => i.severity !== 'warning')).toBe(true);
    });

    it('accepts custom idPattern', () => {
      const content = `---
id: UPPERCASE_ID
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test.
`;
      const ast = makeAST(content);
      // Default pattern rejects uppercase
      const issuesDefault = validate(ast, { level: 'schema' });
      expect(issuesDefault.some((i) => i.rule === 'id-format')).toBe(true);

      // Custom pattern allows uppercase
      const issuesCustom = validate(ast, {
        level: 'schema',
        schema: { idPattern: /^[A-Za-z_][A-Za-z0-9_]*$/ },
      });
      expect(issuesCustom.some((i) => i.rule === 'id-format')).toBe(false);
    });

    it('accepts custom requiredSections', () => {
      const content = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## CustomRequired

Some content.
`;
      const ast = makeAST(content);
      const issues = validate(ast, {
        level: 'semantic',
        schema: { requiredSections: ['CustomRequired'] },
      });
      expect(issues.some((i) => i.code === 'SECTION_MISSING' && i.message.includes('CustomRequired'))).toBe(false);
    });
  });

  describe('severity levels', () => {
    it('uses correct severity for each issue type', () => {
      const ast = makeAST(NO_FRONTMATTER);
      const issues = validate(ast, { level: 'strict' });
      const fmIssue = issues.find((i) => i.code === 'FRONTMATTER_MISSING');
      expect(fmIssue?.severity).toBe('error');
    });
  });

  describe('location tracking', () => {
    it('includes location on issues when available', () => {
      const ast = makeAST(NO_FRONTMATTER);
      const issues = validate(ast, { level: 'schema' });
      const fmIssue = issues.find((i) => i.code === 'FRONTMATTER_MISSING');
      expect(fmIssue?.location).toBeDefined();
      expect(fmIssue?.location?.start.line).toBeGreaterThan(0);
    });
  });
});

describe('validator helpers', () => {
  const bad = `## Purpose\n\nNo front matter.\n`;
  const warned = '## Python\n\n```\nprint(1)\n```\n';

  it('countIssuesBySeverity tallies severities', () => {
    const issues = validate(parseMAM(bad).ast);
    const counts = countIssuesBySeverity(issues);
    expect(counts.error).toBeGreaterThan(0);
    expect(counts.error! + (counts.warning ?? 0) + (counts.info ?? 0)).toBe(issues.length);
  });

  it('hasErrors detects error issues', () => {
    expect(hasErrors(validate(parseMAM(bad).ast))).toBe(true);
    expect(hasErrors([])).toBe(false);
  });

  it('hasWarnings detects warning issues', () => {
    expect(hasWarnings(validate(parseMAM(warned).ast, { level: 'semantic' }))).toBe(true);
    expect(hasWarnings([])).toBe(false);
  });

  it('filterIssuesBySeverity filters by severity', () => {
    const issues = validate(parseMAM(bad).ast);
    const errors = filterIssuesBySeverity(issues, 'error');
    expect(errors.every((issue) => issue.severity === 'error')).toBe(true);
    expect(errors.length).toBe(countIssuesBySeverity(issues).error);
  });

  it('getIssueMessages extracts messages', () => {
    const issues: ValidationIssue[] = [
      { rule: 'r', code: 'X', message: 'first', severity: 'error' },
      { rule: 'r', code: 'X', message: 'second', severity: 'warning' },
    ];
    expect(getIssueMessages(issues)).toEqual(['first', 'second']);
    expect(getIssueMessages([])).toEqual([]);
  });

  it('isValid is true only without errors', () => {
    expect(isValid([{ rule: 'r', code: 'X', message: 'w', severity: 'warning' }])).toBe(true);
    expect(isValid([{ rule: 'r', code: 'X', message: 'e', severity: 'error' }])).toBe(false);
    expect(isValid([])).toBe(true);
  });

  it('summarizeIssues summarizes counts', () => {
    const issues: ValidationIssue[] = [
      { rule: 'r', code: 'X', message: 'e1', severity: 'error' },
      { rule: 'r', code: 'X', message: 'e2', severity: 'error' },
      { rule: 'r', code: 'X', message: 'w', severity: 'warning' },
    ];
    const summary = summarizeIssues(issues);
    expect(summary).toContain('2 errors');
    expect(summary).toContain('1 warning');
    expect(summarizeIssues([])).toBe('no issues');
  });
});
