/**
 * MAM Parser Tests
 * 
 * Comprehensive tests for the MAM parser.
 */

import { describe, it, expect } from 'vitest';
import { MAM_VERSION } from '@mam/ast';
import { parseMAM, parse } from '../../src/index.js';
import { tokenize } from '../../src/lexer/index.js';

describe('MAM Parser', () => {
  describe('parseMAM - Full Integration', () => {
    it('should parse a minimal valid MAM module', () => {
      const input = `---
id: test-module
version: 2.0.0
name: Test Module
author: TestAuthor
runtime: python
---

## Purpose

Test module purpose.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
      expect(result.ast.frontmatter).not.toBeNull();
      expect(result.ast.frontmatter?.data.id).toBe('test-module');
      expect(result.ast.frontmatter?.data.version).toBe(MAM_VERSION);
      expect(result.ast.frontmatter?.data.name).toBe('Test Module');
      expect(result.ast.frontmatter?.data.author).toBe('TestAuthor');
      expect(result.ast.frontmatter?.data.runtime).toBe('python');
      expect(result.ast.sections).toHaveLength(1);
      expect(result.ast.sections[0]?.name).toBe('Purpose');
    });

    it('should parse a full MAM module with all sections', () => {
      const input = `---
id: full-module
version: 2.0.0
name: Full Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
description: A full module example
permissions:
  - network
  - filesystem
---

## Purpose

Full module purpose.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | Yes | First input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | First output |

## Rules

- Rule 1
- Rule 2

## Workflow

\`\`\`mermaid
flowchart TD
    A[Start] --> B[End]
\`\`\`

## Python

\`\`\`python
def process(input1: str) -> dict:
    return {"output1": input1}
\`\`\`

## Examples

Example usage here.

## Tests

\`\`\`python
def test_process():
    assert process("test") == {"output1": "test"}
\`\`\`
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
      expect(result.ast.frontmatter?.data.id).toBe('full-module');
      expect(result.ast.frontmatter?.data.tags).toEqual(['auth', 'security']);
      expect(result.ast.frontmatter?.data.permissions).toEqual(['network', 'filesystem']);
      expect(result.ast.sections.length).toBeGreaterThanOrEqual(4);
      
      const sectionNames = result.ast.sections.map(s => s.name);
      expect(sectionNames).toContain('Purpose');
      expect(sectionNames).toContain('Inputs');
      expect(sectionNames).toContain('Outputs');
      expect(sectionNames).toContain('Rules');
    });

    it('should parse metadata with all optional fields', () => {
      const input = `---
id: complete
version: 2.0.0
name: Complete Module
author: Test
runtime: python
tags:
  - tag1
  - tag2
description: Full description
dependencies:
  - dep1
  - dep2
permissions:
  - network
license: MIT
repository: https://github.com/test/repo
mam_version: 2.0.0
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
      expect(result.ast.frontmatter?.data.tags).toEqual(['tag1', 'tag2']);
      expect(result.ast.frontmatter?.data.description).toBe('Full description');
      expect(result.ast.frontmatter?.data.dependencies).toEqual(['dep1', 'dep2']);
      expect(result.ast.frontmatter?.data.permissions).toEqual(['network']);
      expect(result.ast.frontmatter?.data.license).toBe('MIT');
      expect(result.ast.frontmatter?.data.repository).toBe('https://github.com/test/repo');
      expect(result.ast.frontmatter?.data.mam_version).toBe(MAM_VERSION);
    });
  });

  describe('parseMAM - Front Matter', () => {
    it('should handle errors for missing front matter', () => {
      const input = `## Purpose

Module without front matter.
`;

      const result = parseMAM(input);

      expect(result.errors.length).toBeGreaterThan(0);
      const hasFrontMatterError = result.errors.some(e => 
        e.message.includes('front matter') || e.message.includes('Missing')
      );
      expect(hasFrontMatterError).toBe(true);
    });

    it('should handle errors for invalid ID format', () => {
      const input = `---
id: Invalid_ID!
version: 2.0.0
name: Bad ID Module
author: Test
runtime: python
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.errors.length).toBeGreaterThan(0);
      const idError = result.errors.find(e => e.message.includes('ID'));
      expect(idError).toBeDefined();
    });

    it('should handle errors for invalid version format', () => {
      const input = `---
id: test
version: not-a-version
name: Bad Version
author: Test
runtime: python
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.errors.length).toBeGreaterThan(0);
      const versionError = result.errors.find(e => e.message.includes('version'));
      expect(versionError).toBeDefined();
    });

    it('should handle errors for invalid runtime', () => {
      const input = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: invalid
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.errors.length).toBeGreaterThan(0);
      const runtimeError = result.errors.find(e => e.message.includes('runtime'));
      expect(runtimeError).toBeDefined();
    });

    it('should handle missing required fields', () => {
      const input = `---
id: test
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('parseMAM - Sections', () => {
    it('should parse all standard sections', () => {
      const input = `---
id: sections-test
version: 2.0.0
name: Sections Test
author: Test
runtime: python
---

## Purpose

Purpose content.

## Inputs

Inputs content.

## Outputs

Outputs content.

## Rules

Rules content.

## Examples

Examples content.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
      expect(result.ast.sections).toHaveLength(5);
      
      const sectionNames = result.ast.sections.map(s => s.name);
      expect(sectionNames).toEqual(['Purpose', 'Inputs', 'Outputs', 'Rules', 'Examples']);
    });

    it('should detect custom sections', () => {
      const input = `---
id: custom-test
version: 2.0.0
name: Custom Test
author: Test
runtime: python
---

## Purpose

Test.

## CustomSection

Custom content.
`;

      const result = parseMAM(input);

      expect(result.ast.metadata.customSections).toContain('CustomSection');
      expect(result.warnings.some(w => w.message.includes('CustomSection'))).toBe(true);
    });

    it('should detect empty sections', () => {
      const input = `---
id: empty-test
version: 2.0.0
name: Empty Test
author: Test
runtime: python
---

## Purpose

Test.

## EmptySection

`;
      const result = parseMAM(input);
      
      expect(result.warnings.some(w => w.message.includes('EmptySection'))).toBe(true);
    });

    it('should detect duplicate sections', () => {
      const input = `---
id: dup-test
version: 2.0.0
name: Dup Test
author: Test
runtime: python
---

## Purpose

First purpose.

## Purpose

Second purpose.
`;

      const result = parseMAM(input);

      expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
    });

    it('should track section attributes', () => {
      const input = `---
id: attr-test
version: 2.0.0
name: Attr Test
author: Test
runtime: python
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      const purposeSection = result.ast.sections.find(s => s.name === 'Purpose');
      expect(purposeSection).toBeDefined();
      expect(purposeSection?.attributes.required).toBe(true);
      expect(purposeSection?.attributes.isCustom).toBe(false);
    });
  });

  describe('parseMAM - Content Nodes', () => {
    it('should parse code blocks', () => {
      const input = `---
id: code-test
version: 2.0.0
name: Code Test
author: Test
runtime: python
---

## Purpose

Test.

## Python

\`\`\`python
def hello():
    return "world"
\`\`\`
`;

      const result = parseMAM(input);

      const pythonSection = result.ast.sections.find(s => s.name === 'Python');
      expect(pythonSection).toBeDefined();
      
      const codeBlock = pythonSection?.content.find(c => c.type === 'codeblock');
      expect(codeBlock).toBeDefined();
      expect((codeBlock as any)?.language).toBe('python');
      expect((codeBlock as any)?.value).toContain('def hello()');
    });

    it('should parse code blocks with metadata', () => {
      const input = `---
id: meta-test
version: 2.0.0
name: Meta Test
author: Test
runtime: python
---

## Python

\`\`\`python
# @mam:timeout=10s
# @mam:requires=network

def fetch():
    pass
\`\`\`
`;

      const result = parseMAM(input);

      const pythonSection = result.ast.sections.find(s => s.name === 'Python');
      const codeBlock = pythonSection?.content.find(c => c.type === 'codeblock');
      
      expect(codeBlock).toBeDefined();
      expect((codeBlock as any)?.metadata?.timeout).toBe('10s');
      expect((codeBlock as any)?.metadata?.requires).toBe('network');
    });

    it('should parse lists', () => {
      const input = `---
id: list-test
version: 2.0.0
name: List Test
author: Test
runtime: python
---

## Purpose

Test.

## Rules

- Rule 1
- Rule 2
- Rule 3
`;

      const result = parseMAM(input);

      const rulesSection = result.ast.sections.find(s => s.name === 'Rules');
      expect(rulesSection).toBeDefined();
      
      const list = rulesSection?.content.find(c => c.type === 'list');
      expect(list).toBeDefined();
      expect((list as any)?.ordered).toBe(false);
      expect((list as any)?.items).toHaveLength(3);
    });

    it('should parse tables', () => {
      const input = `---
id: table-test
version: 2.0.0
name: Table Test
author: Test
runtime: python
---

## Purpose

Test.

## Inputs

| Name | Type | Required |
|------|------|----------|
| id | string | Yes |
| name | string | No |
`;

      const result = parseMAM(input);

      const inputsSection = result.ast.sections.find(s => s.name === 'Inputs');
      expect(inputsSection).toBeDefined();
      
      const table = inputsSection?.content.find(c => c.type === 'table');
      expect(table).toBeDefined();
      expect((table as any)?.headers).toHaveLength(3);
    });

    it('should parse blockquotes', () => {
      const input = `---
id: quote-test
version: 2.0.0
name: Quote Test
author: Test
runtime: python
---

## Purpose

> This is a blockquote.
> It spans multiple lines.
`;

      const result = parseMAM(input);

      const purposeSection = result.ast.sections.find(s => s.name === 'Purpose');
      expect(purposeSection).toBeDefined();
      
      const blockquote = purposeSection?.content.find(c => c.type === 'blockquote');
      expect(blockquote).toBeDefined();
    });

    it('should parse horizontal rules', () => {
      const input = `---
id: hr-test
version: 2.0.0
name: HR Test
author: Test
runtime: python
---

## Purpose

Test.

---

More content.
`;

      const result = parseMAM(input);

      const purposeSection = result.ast.sections.find(s => s.name === 'Purpose');
      expect(purposeSection).toBeDefined();
      
      const hr = purposeSection?.content.find(c => c.type === 'horizontalrule');
      expect(hr).toBeDefined();
    });
  });

  describe('parseMAM - Metadata', () => {
    it('should track section count', () => {
      const input = `---
id: meta-test
version: 2.0.0
name: Meta Test
author: Test
runtime: python
---

## Purpose

Test.

## Rules

Rules.

## Examples

Examples.
`;

      const result = parseMAM(input);

      expect(result.ast.metadata.sectionCount).toBe(3);
    });

    it('should track code block count', () => {
      const input = `---
id: code-count-test
version: 2.0.0
name: Code Count Test
author: Test
runtime: python
---

## Python

\`\`\`python
code1
\`\`\`

## JavaScript

\`\`\`javascript
code2
\`\`\`
`;

      const result = parseMAM(input);

      expect(result.ast.metadata.codeBlockCount).toBe(2);
    });

    it('should track languages used', () => {
      const input = `---
id: lang-test
version: 2.0.0
name: Lang Test
author: Test
runtime: python
---

## Python

\`\`\`python
code
\`\`\`

## JavaScript

\`\`\`javascript
code
\`\`\`
`;

      const result = parseMAM(input);

      expect(result.ast.metadata.languages).toContain('python');
      expect(result.ast.metadata.languages).toContain('javascript');
    });
  });

  describe('parseMAM - Statistics', () => {
    it('should track parse time', () => {
      const input = `---
id: time-test
version: 2.0.0
name: Time Test
author: Test
runtime: python
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.stats.parseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should track token count', () => {
      const input = `---
id: token-test
version: 2.0.0
name: Token Test
author: Test
runtime: python
---

## Purpose

Test.
`;

      const result = parseMAM(input);

      expect(result.stats.totalTokens).toBeGreaterThan(0);
    });

    it('should track section count', () => {
      const input = `---
id: section-count-test
version: 2.0.0
name: Section Count Test
author: Test
runtime: python
---

## Purpose

Test.

## Rules

Rules.
`;

      const result = parseMAM(input);

      expect(result.stats.totalSections).toBe(2);
    });
  });

  describe('parseMAM - Token Integration', () => {
    it('should work with pre-tokenized input', () => {
      const input = `---
id: pre-token-test
version: 2.0.0
name: Pre-Token Test
author: Test
runtime: python
---

## Purpose

Test.
`;

      const tokenizeResult = tokenize(input);
      const parseResult = parse(tokenizeResult.tokens);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.ast.frontmatter?.data.id).toBe('pre-token-test');
    });
  });

  describe('parseMAM - Inline Content', () => {
    it('should parse inline formatting', () => {
      const input = `---
id: inline-test
version: 2.0.0
name: Inline Test
author: Test
runtime: python
---

## Purpose

This has **bold** and *italic* text.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
      const purposeSection = result.ast.sections.find(s => s.name === 'Purpose');
      expect(purposeSection).toBeDefined();
    });

    it('should parse inline code', () => {
      const input = `---
id: inline-code-test
version: 2.0.0
name: Inline Code Test
author: Test
runtime: python
---

## Purpose

Use \`console.log()\` for output.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
    });

    it('should parse links', () => {
      const input = `---
id: link-test
version: 2.0.0
name: Link Test
author: Test
runtime: python
---

## Purpose

See [documentation](https://example.com) for details.
`;

      const result = parseMAM(input);

      expect(result.errors).toHaveLength(0);
    });
  });
});