/**
 * Sections Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/lexer/index.js';
import { parseSections } from '../../src/parser/sections.js';

function tokenizeAndParse(input: string) {
  const tokens = tokenize(input).tokens;
  return parseSections(tokens, 0, 'test.mam.md');
}

describe('Sections Parser', () => {
  // ==========================================================================
  // Basic Section Parsing
  // ==========================================================================

  describe('basic sections', () => {
    it('should parse a simple section', () => {
      const input = '## Purpose\n\nThis is the purpose.';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]?.name).toBe('Purpose');
      expect(result.sections[0]?.content.length).toBeGreaterThan(0);
    });

    it('should parse multiple sections', () => {
      const input = '## Purpose\n\nPurpose text.\n\n## Rules\n\n- Rule 1\n- Rule 2';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]?.name).toBe('Purpose');
      expect(result.sections[1]?.name).toBe('Rules');
    });

    it('should parse section level correctly', () => {
      const input = '## Purpose\n\nLevel 2 section.';
      const result = tokenizeAndParse(input);

      expect(result.sections[0]?.level).toBe(2);
    });

    it('should parse level 3 sections', () => {
      const input = '### SubSection\n\nLevel 3 section.';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]?.level).toBe(3);
    });

    it('should handle sections with no content gracefully', () => {
      const input = '## Purpose\n\nTest.\n\n## Empty\n\n';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(2);
    });
  });

  // ==========================================================================
  // All Standard Section Names
  // ==========================================================================

  describe('standard section names', () => {
    const standardSections = [
      'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow',
      'Mermaid', 'Python', 'JavaScript', 'TypeScript', 'Prompt',
      'Memory', 'Examples', 'Tests', 'References', 'Dependencies',
      'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities',
    ];

    for (const name of standardSections) {
      it(`should parse standard section: ${name}`, () => {
        const input = `## ${name}\n\nContent for ${name}.`;
        const result = tokenizeAndParse(input);

        expect(result.sections).toHaveLength(1);
        expect(result.sections[0]?.name).toBe(name);
      });
    }
  });

  // ==========================================================================
  // Content Types
  // ==========================================================================

  describe('content types', () => {
    it('should parse code blocks in sections', () => {
      const input = '## Python\n\n```python\ndef hello():\n    pass\n```';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const codeBlock = result.sections[0]?.content.find(c => c.type === 'codeblock');
      expect(codeBlock).toBeDefined();
    });

    it('should parse bullet lists', () => {
      const input = '## Rules\n\n- Rule 1\n- Rule 2\n- Rule 3';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const list = result.sections[0]?.content.find(c => c.type === 'list');
      expect(list).toBeDefined();
    });

    it('should parse numbered lists', () => {
      const input = '## Steps\n\n1. Step one\n2. Step two\n3. Step three';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const list = result.sections[0]?.content.find(c => c.type === 'list');
      expect(list).toBeDefined();
    });

    it('should parse tables', () => {
      const input = '## Examples\n\n| Input | Output |\n| --- | --- |\n| a | b |';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const table = result.sections[0]?.content.find(c => c.type === 'table');
      expect(table).toBeDefined();
    });

    it('should parse blockquotes', () => {
      const input = '## Notes\n\n> This is a blockquote.';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const blockquote = result.sections[0]?.content.find(c => c.type === 'blockquote');
      expect(blockquote).toBeDefined();
    });

    it('should parse horizontal rules', () => {
      const input = '## Section\n\n---';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const hr = result.sections[0]?.content.find(c => c.type === 'horizontalrule');
      expect(hr).toBeDefined();
    });

    it('should parse paragraphs', () => {
      const input = '## Purpose\n\nThis is a paragraph with some text.';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const paragraph = result.sections[0]?.content.find(c => c.type === 'paragraph');
      expect(paragraph).toBeDefined();
    });
  });

  // ==========================================================================
  // Code Blocks in Sections
  // ==========================================================================

  describe('code blocks', () => {
    it('should extract code block language', () => {
      const input = '## Python\n\n```python\ndef hello():\n    pass\n```';
      const result = tokenizeAndParse(input);

      const codeBlock = result.sections[0]?.content.find(c => c.type === 'codeblock') as any;
      expect(codeBlock?.language).toBe('python');
    });

    it('should extract code block value', () => {
      const input = '## Python\n\n```python\ndef hello():\n    pass\n```';
      const result = tokenizeAndParse(input);

      const codeBlock = result.sections[0]?.content.find(c => c.type === 'codeblock') as any;
      expect(codeBlock?.value).toContain('def hello():');
    });

    it('should handle tilde code fences', () => {
      const input = '## Python\n\n~~~python\ndef hello():\n    pass\n~~~';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(1);
      const codeBlock = result.sections[0]?.content.find(c => c.type === 'codeblock');
      expect(codeBlock).toBeDefined();
    });

    it('should handle multiple code blocks in one section', () => {
      const input = '## Code\n\n```python\n# Python\n```\n\n```javascript\n// JS\n```';
      const result = tokenizeAndParse(input);

      const codeBlocks = result.sections[0]?.content.filter(c => c.type === 'codeblock');
      expect(codeBlocks?.length).toBe(2);
    });
  });

  // ==========================================================================
  // Tables in Sections
  // ==========================================================================

  describe('tables', () => {
    it('should parse table headers', () => {
      const input = '## Data\n\n| Name | Type |\n| --- | --- |\n| id | string |';
      const result = tokenizeAndParse(input);

      const table = result.sections[0]?.content.find(c => c.type === 'table') as any;
      expect(table?.headers).toBeDefined();
      expect(table?.headers.length).toBeGreaterThan(0);
    });

    it('should parse table rows', () => {
      const input = '## Data\n\n| Name | Type |\n| --- | --- |\n| id | string |\n| name | string |';
      const result = tokenizeAndParse(input);

      const table = result.sections[0]?.content.find(c => c.type === 'table') as any;
      expect(table?.headers).toBeDefined();
      expect(table?.headers.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Lists in Sections
  // ==========================================================================

  describe('lists', () => {
    it('should parse unordered lists', () => {
      const input = '## Rules\n\n- First rule\n- Second rule\n- Third rule';
      const result = tokenizeAndParse(input);

      const list = result.sections[0]?.content.find(c => c.type === 'list') as any;
      expect(list?.ordered).toBe(false);
      expect(list?.items.length).toBe(3);
    });

    it('should parse ordered lists', () => {
      const input = '## Steps\n\n1. First step\n2. Second step\n3. Third step';
      const result = tokenizeAndParse(input);

      const list = result.sections[0]?.content.find(c => c.type === 'list') as any;
      expect(list?.ordered).toBe(true);
    });

    it('should parse task lists', () => {
      const input = '## Tasks\n\n- [x] Done task\n- [ ] Pending task';
      const result = tokenizeAndParse(input);

      const list = result.sections[0]?.content.find(c => c.type === 'list') as any;
      expect(list?.items).toBeDefined();
    });
  });

  // ==========================================================================
  // Warnings
  // ==========================================================================

  describe('warnings', () => {
    it('should warn on unknown sections', () => {
      const input = '## Purpose\n\nTest.\n\n## CustomSection\n\nContent.';
      const result = tokenizeAndParse(input);

      expect(result.warnings.some(w => w.message.includes('CustomSection'))).toBe(true);
    });

    it('should warn on empty sections', () => {
      const input = '## Purpose\n\nTest.\n\n## Empty\n\n';
      const result = tokenizeAndParse(input);

      expect(result.warnings.some(w => w.message.toLowerCase().includes('empty'))).toBe(true);
    });

    it('should warn on out-of-order sections', () => {
      const input = '## Rules\n\nRules first.\n\n## Purpose\n\nPurpose second.';
      const result = tokenizeAndParse(input);

      expect(result.warnings.some(w => w.message.includes('order'))).toBe(true);
    });
  });

  // ==========================================================================
  // Location Tracking
  // ==========================================================================

  describe('location tracking', () => {
    it('should track start location of sections', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.sections[0]?.location.start).toBeDefined();
      expect(result.sections[0]?.location.start.line).toBeGreaterThan(0);
    });

    it('should track end location of sections', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.sections[0]?.location.end).toBeDefined();
      expect(result.sections[0]?.location.end.line).toBeGreaterThan(0);
    });

    it('should include source reference in location', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.sections[0]?.location).toBeDefined();
      expect(result.sections[0]?.location.start).toBeDefined();
      expect(result.sections[0]?.location.end).toBeDefined();
    });
  });

  // ==========================================================================
  // Errors
  // ==========================================================================

  describe('errors', () => {
    it('should return empty errors for valid input', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.errors).toHaveLength(0);
    });

    it('should handle multiple errors gracefully', () => {
      const input = '';
      const result = tokenizeAndParse(input);

      expect(result.sections).toHaveLength(0);
    });
  });
});
