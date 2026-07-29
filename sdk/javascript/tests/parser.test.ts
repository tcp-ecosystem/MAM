import { describe, it, expect } from 'vitest';
import { parseMAM } from '../src/parser.js';

// ---------------------------------------------------------------------------
// Minimal module
// ---------------------------------------------------------------------------

const MINIMAL_MAM = `---
id: minimal
version: 1.0.0
name: Minimal Module
author: Test
runtime: python
---

## Purpose

Minimal module.
`;

// ---------------------------------------------------------------------------
// Basic module
// ---------------------------------------------------------------------------

const BASIC_MAM = `---
id: basic-module
version: 1.0.0
name: Basic Module
author: TestAuthor
runtime: python
---

## Purpose

A basic MAM module for testing.

## Rules

- Rule 1
- Rule 2

## Examples

Example usage here.
`;

// ---------------------------------------------------------------------------
// Full module
// ---------------------------------------------------------------------------

const FULL_MAM = `---
id: full-module
version: 2.0.0
name: Full Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
description: Full module example
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

\`\`\`python
result = process("hello")
print(result)
\`\`\`

## Tests

\`\`\`python
def test_process():
    result = process("test")
    assert result["output1"] == "test"
\`\`\`

## References

- [Reference](https://example.com)

## Dependencies

- PyJWT >= 2.8.0
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseMAM', () => {
  describe('empty document', () => {
    it('returns error for empty string', () => {
      const result = parseMAM('');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('EMPTY_DOCUMENT');
      expect(result.ast.sections).toHaveLength(0);
    });

    it('returns error for whitespace-only string', () => {
      const result = parseMAM('   \n  \n  ');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('EMPTY_DOCUMENT');
    });
  });

  describe('frontmatter', () => {
    it('parses minimal frontmatter', () => {
      const result = parseMAM(MINIMAL_MAM);
      expect(result.ast.frontmatter).not.toBeNull();
      expect(result.ast.frontmatter?.data.id).toBe('minimal');
      expect(result.ast.frontmatter?.data.version).toBe('1.0.0');
      expect(result.ast.frontmatter?.data.name).toBe('Minimal Module');
      expect(result.ast.frontmatter?.data.author).toBe('Test');
      expect(result.ast.frontmatter?.data.runtime).toBe('python');
    });

    it('parses array fields in frontmatter', () => {
      const result = parseMAM(FULL_MAM);
      expect(result.ast.frontmatter?.data.tags).toEqual(['auth', 'security']);
      expect(result.ast.frontmatter?.data.permissions).toEqual(['network', 'filesystem']);
    });

    it('parses numeric fields', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
count: 42
price: 9.99
---

## Purpose

Test.
`;
      const result = parseMAM(content);
      expect(result.ast.frontmatter?.data.count).toBe(42);
      expect(result.ast.frontmatter?.data.price).toBe(9.99);
    });

    it('parses boolean fields', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
enabled: true
debug: false
---

## Purpose

Test.
`;
      const result = parseMAM(content);
      expect(result.ast.frontmatter?.data.enabled).toBe(true);
      expect(result.ast.frontmatter?.data.debug).toBe(false);
    });

    it('reports error for missing frontmatter', () => {
      const content = `## Purpose

No frontmatter here.
`;
      const result = parseMAM(content);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('FRONTMATTER_NOT_FOUND');
    });

    it('reports error for unclosed frontmatter', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python

## Purpose

No closing delimiter.
`;
      const result = parseMAM(content);
      expect(result.errors.some((e) => e.code === 'FRONTMATTER_UNCLOSED')).toBe(true);
    });
  });

  describe('sections', () => {
    it('parses basic sections', () => {
      const result = parseMAM(BASIC_MAM);
      expect(result.ast.sections).toHaveLength(3);
      expect(result.ast.sections[0].name).toBe('Purpose');
      expect(result.ast.sections[1].name).toBe('Rules');
      expect(result.ast.sections[2].name).toBe('Examples');
    });

    it('parses section levels', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Level 2.

### Sub Heading

Level 3.
`;
      const result = parseMAM(content);
      expect(result.ast.sections[0].level).toBe(2);
    });

    it('parses full module sections', () => {
      const result = parseMAM(FULL_MAM);
      expect(result.ast.sections.length).toBeGreaterThanOrEqual(9);
      const names = result.ast.sections.map((s) => s.name);
      expect(names).toContain('Purpose');
      expect(names).toContain('Inputs');
      expect(names).toContain('Outputs');
      expect(names).toContain('Rules');
      expect(names).toContain('Workflow');
      expect(names).toContain('Python');
      expect(names).toContain('Examples');
      expect(names).toContain('Tests');
      expect(names).toContain('References');
    });

    it('tracks source locations for sections', () => {
      const result = parseMAM(BASIC_MAM);
      const purposeSection = result.ast.sections[0];
      expect(purposeSection.location.start.line).toBeGreaterThan(0);
      expect(purposeSection.location.end.line).toBeGreaterThan(0);
      expect(purposeSection.location.source).toBeDefined();
    });

    it('reports error for duplicate sections', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

First purpose.

## Purpose

Duplicate purpose.
`;
      const result = parseMAM(content);
      expect(result.errors.some((e) => e.code === 'SECTION_DUPLICATE')).toBe(true);
    });

    it('warns on unknown sections by default', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## CustomSection

Custom content.
`;
      const result = parseMAM(content);
      expect(result.warnings.some((w) => w.code === 'UNKNOWN_SECTION')).toBe(true);
    });

    it('does not warn on unknown sections when allowUnknownSections is true', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## CustomSection

Custom content.
`;
      const result = parseMAM(content, { allowUnknownSections: true });
      expect(result.warnings.some((w) => w.code === 'UNKNOWN_SECTION')).toBe(false);
    });

    it('warns on empty sections', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## EmptySection
`;
      const result = parseMAM(content);
      expect(result.warnings.some((w) => w.code === 'EMPTY_SECTION')).toBe(true);
    });
  });

  describe('code blocks', () => {
    it('parses code blocks with language', () => {
      const result = parseMAM(FULL_MAM);
      const pythonSection = result.ast.sections.find((s) => s.name === 'Python');
      expect(pythonSection).toBeDefined();
      const codeBlock = pythonSection!.content.find((c) => c.type === 'CodeBlock');
      expect(codeBlock).toBeDefined();
      expect(codeBlock!.language).toBe('python');
      expect(codeBlock!.value).toContain('def process');
    });

    it('parses multiple code blocks in different sections', () => {
      const result = parseMAM(FULL_MAM);
      const codeBlocks = result.ast.sections.flatMap((s) =>
        s.content.filter((c) => c.type === 'CodeBlock'),
      );
      expect(codeBlocks.length).toBeGreaterThanOrEqual(3);
    });

    it('counts code blocks in metadata', () => {
      const result = parseMAM(FULL_MAM);
      expect(result.ast.metadata.totalCodeBlocks).toBeGreaterThanOrEqual(3);
    });

    it('reports error for unclosed code block', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## Python

\`\`\`python
def broken():
    return "no closing fence"
`;
      const result = parseMAM(content);
      expect(result.errors.some((e) => e.code === 'CODE_BLOCK_UNCLOSED')).toBe(true);
    });
  });

  describe('lists', () => {
    it('parses unordered lists', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## Rules

- Rule 1
- Rule 2
- Rule 3
`;
      const result = parseMAM(content);
      const rulesSection = result.ast.sections.find((s) => s.name === 'Rules');
      expect(rulesSection).toBeDefined();
      const list = rulesSection!.content.find((c) => c.type === 'List');
      expect(list).toBeDefined();
      expect(list!.items).toEqual(['Rule 1', 'Rule 2', 'Rule 3']);
    });
  });

  describe('tables', () => {
    it('parses tables', () => {
      const result = parseMAM(FULL_MAM);
      const inputsSection = result.ast.sections.find((s) => s.name === 'Inputs');
      expect(inputsSection).toBeDefined();
      const table = inputsSection!.content.find((c) => c.type === 'Table');
      expect(table).toBeDefined();
      expect(table!.rows).toBeDefined();
      expect(table!.rows!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('blockquotes', () => {
    it('parses blockquotes', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## Notes

> This is a blockquote.
> It spans multiple lines.
`;
      const result = parseMAM(content);
      const notesSection = result.ast.sections.find((s) => s.name === 'Notes');
      expect(notesSection).toBeDefined();
      const bq = notesSection!.content.find((c) => c.type === 'Blockquote');
      expect(bq).toBeDefined();
      expect(bq!.value).toContain('This is a blockquote.');
    });
  });

  describe('horizontal rules', () => {
    it('parses horizontal rules', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

---

## After Rule

Content.
`;
      const result = parseMAM(content);
      const hasHR = result.ast.sections.some((s) =>
        s.content.some((c) => c.type === 'HorizontalRule'),
      );
      expect(hasHR).toBe(true);
    });
  });

  describe('stats', () => {
    it('reports parse statistics', () => {
      const result = parseMAM(FULL_MAM);
      expect(result.stats.totalSections).toBeGreaterThan(0);
      expect(result.stats.totalCodeBlocks).toBeGreaterThan(0);
      expect(result.stats.totalLines).toBeGreaterThan(0);
      expect(result.stats.parseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('source location tracking', () => {
    it('tracks locations on all nodes', () => {
      const result = parseMAM(BASIC_MAM);
      for (const section of result.ast.sections) {
        expect(section.location.start.line).toBeGreaterThan(0);
        expect(section.location.end.line).toBeGreaterThan(0);
        expect(section.location.source).toBeDefined();
        for (const node of section.content) {
          expect(node.location.start.line).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('custom source name', () => {
    it('uses provided source name in locations', () => {
      const result = parseMAM(BASIC_MAM, { source: 'test.mam.md' });
      expect(result.ast.location.source).toBe('test.mam.md');
      expect(result.ast.frontmatter?.location.source).toBe('test.mam.md');
    });
  });

  describe('paragraphs', () => {
    it('parses paragraphs as content', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

This is a paragraph with multiple lines
that should be captured as a single paragraph.
`;
      const result = parseMAM(content);
      const purpose = result.ast.sections.find((s) => s.name === 'Purpose');
      expect(purpose).toBeDefined();
      const para = purpose!.content.find((c) => c.type === 'Paragraph');
      expect(para).toBeDefined();
      expect(para!.value).toContain('This is a paragraph');
    });
  });

  describe('inline code blocks in sections', () => {
    it('handles code blocks without language', () => {
      const content = `---
id: test
version: 1.0.0
name: Test
author: T
runtime: python
---

## Purpose

Test.

## Example

\`\`\`
some code without language
\`\`\`
`;
      const result = parseMAM(content);
      const exampleSection = result.ast.sections.find((s) => s.name === 'Example');
      expect(exampleSection).toBeDefined();
      const code = exampleSection!.content.find((c) => c.type === 'CodeBlock');
      expect(code).toBeDefined();
      expect(code!.value).toContain('some code without language');
    });
  });
});
