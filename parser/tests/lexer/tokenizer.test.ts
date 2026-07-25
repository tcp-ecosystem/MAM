/**
 * MAM Tokenizer Tests
 * 
 * Comprehensive tests for the MAM lexer/tokenizer.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, TokenType, Tokenizer } from '../../src/lexer/index.js';

describe('Tokenizer', () => {
  describe('Front Matter', () => {
    it('should tokenize front matter separators', () => {
      const input = `---
id: test
---`;
      
      const result = tokenize(input);
      const separators = result.tokens.filter(t => t.type === TokenType.FRONTMATTER_SEPARATOR);
      
      expect(separators).toHaveLength(2);
    });

    it('should tokenize YAML key-value pairs', () => {
      const input = `---
id: test-module
version: 1.0.0
name: Test Module
---`;
      
      const result = tokenize(input);
      const keys = result.tokens.filter(t => t.type === TokenType.YAML_KEY);
      
      expect(keys.length).toBeGreaterThanOrEqual(3);
      expect(keys[0]!.metadata?.yamlKey).toBe('id');
      expect(keys[1]!.metadata?.yamlKey).toBe('version');
      expect(keys[2]!.metadata?.yamlKey).toBe('name');
    });

    it('should tokenize YAML list items', () => {
      const input = `---
tags:
  - auth
  - security
---`;
      
      const result = tokenize(input);
      const listItems = result.tokens.filter(t => t.type === TokenType.YAML_LIST_ITEM);
      
      expect(listItems).toHaveLength(2);
      expect(listItems[0]!.metadata?.yamlValue).toBe('auth');
      expect(listItems[1]!.metadata?.yamlValue).toBe('security');
    });
  });

  describe('Headings', () => {
    it('should tokenize all heading levels', () => {
      const input = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;
      
      const result = tokenize(input);
      const headings = result.tokens.filter(t => 
        t.type >= TokenType.HEADING_1 && t.type <= TokenType.HEADING_6
      );
      
      expect(headings).toHaveLength(6);
      expect(headings[0]!.type).toBe(TokenType.HEADING_1);
      expect(headings[1]!.type).toBe(TokenType.HEADING_2);
      expect(headings[2]!.type).toBe(TokenType.HEADING_3);
      expect(headings[3]!.type).toBe(TokenType.HEADING_4);
      expect(headings[4]!.type).toBe(TokenType.HEADING_5);
      expect(headings[5]!.type).toBe(TokenType.HEADING_6);
    });

    it('should capture heading text', () => {
      const input = '## Purpose';
      
      const result = tokenize(input);
      const headingText = result.tokens.find(t => t.type === TokenType.HEADING_TEXT);
      
      expect(headingText).toBeDefined();
      expect(headingText!.value).toBe('Purpose');
    });

    it('should track heading level in metadata', () => {
      const input = '### Inputs';
      
      const result = tokenize(input);
      const heading = result.tokens.find(t => t.type === TokenType.HEADING_3);
      
      expect(heading).toBeDefined();
      expect(heading!.metadata?.headingLevel).toBe(3);
    });
  });

  describe('Code Blocks', () => {
    it('should tokenize code fences', () => {
      const input = `\`\`\`python
def hello():
    pass
\`\`\``;
      
      const result = tokenize(input);
      const fences = result.tokens.filter(t => 
        t.type === TokenType.CODE_FENCE_BACKTICK || t.type === TokenType.CODE_FENCE_TILDE
      );
      
      expect(fences).toHaveLength(2);
    });

    it('should capture language identifier', () => {
      const input = '```javascript\nconsole.log("hello");\n```';
      
      const result = tokenize(input);
      const lang = result.tokens.find(t => t.type === TokenType.CODE_LANGUAGE);
      
      expect(lang).toBeDefined();
      expect(lang!.metadata?.language).toBe('javascript');
    });

    it('should capture code content', () => {
      const input = '```python\nx = 1\ny = 2\n```';
      
      const result = tokenize(input);
      const codeContent = result.tokens.filter(t => t.type === TokenType.CODE_CONTENT);
      
      expect(codeContent.length).toBeGreaterThanOrEqual(1);
    });

    it('should capture MAM metadata comments', () => {
      const input = '```python\n# @mam:timeout=10s\ndef test(): pass\n```';
      
      const result = tokenize(input);
      const meta = result.tokens.filter(t => t.type === TokenType.CODE_METADATA);
      
      expect(meta.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle tilde code fences', () => {
      const input = `~~~python
code
~~~`;
      
      const result = tokenize(input);
      const fences = result.tokens.filter(t => t.type === TokenType.CODE_FENCE_TILDE);
      
      expect(fences).toHaveLength(2);
    });
  });

  describe('Lists', () => {
    it('should tokenize bullet lists', () => {
      const input = `- Item 1
- Item 2
- Item 3`;
      
      const result = tokenize(input);
      const listItems = result.tokens.filter(t => t.type === TokenType.BULLET_LIST);
      
      expect(listItems).toHaveLength(3);
    });

    it('should tokenize numbered lists', () => {
      const input = `1. First
2. Second
3. Third`;
      
      const result = tokenize(input);
      const listItems = result.tokens.filter(t => t.type === TokenType.NUMBERED_LIST);
      
      expect(listItems).toHaveLength(3);
    });

    it('should detect task lists', () => {
      const input = `- [x] Completed
- [ ] Not completed`;
      
      const result = tokenize(input);
      const checked = result.tokens.filter(t => t.type === TokenType.TASK_CHECKED);
      const unchecked = result.tokens.filter(t => t.type === TokenType.TASK_UNCHECKED);
      
      expect(checked).toHaveLength(1);
      expect(unchecked).toHaveLength(1);
    });
  });

  describe('Tables', () => {
    it('should tokenize table syntax', () => {
      const input = `| Name | Type |
|------|------|
| id | string |`;
      
      const result = tokenize(input);
      const pipes = result.tokens.filter(t => t.type === TokenType.TABLE_PIPE);
      
      expect(pipes.length).toBeGreaterThanOrEqual(4);
    });

    it('should detect table separator', () => {
      const input = `|------|------|`;
      
      const result = tokenize(input);
      const separator = result.tokens.find(t => t.type === TokenType.TABLE_HYPHEN);
      
      expect(separator).toBeDefined();
    });
  });

  describe('Blockquotes', () => {
    it('should tokenize blockquotes', () => {
      const input = '> This is a quote';
      
      const result = tokenize(input);
      const quote = result.tokens.find(t => t.type === TokenType.BLOCKQUOTE);
      
      expect(quote).toBeDefined();
    });
  });

  describe('Horizontal Rules', () => {
    it('should tokenize horizontal rules', () => {
      const inputs = ['---', '***', '___'];
      
      for (const input of inputs) {
        const result = tokenize(input);
        const hr = result.tokens.find(t => t.type === TokenType.HORIZONTAL_RULE);
        expect(hr).toBeDefined();
      }
    });
  });

  describe('Inline Formatting', () => {
    it('should tokenize bold text', () => {
      const input = 'This is **bold** text';
      
      const result = tokenize(input);
      const bold = result.tokens.filter(t => 
        t.type === TokenType.BOLD_OPEN || t.type === TokenType.BOLD_CLOSE
      );
      
      expect(bold).toHaveLength(2);
    });

    it('should tokenize inline code', () => {
      const input = 'Use `console.log()` for output';
      
      const result = tokenize(input);
      const code = result.tokens.find(t => t.type === TokenType.CODE_INLINE);
      
      expect(code).toBeDefined();
    });

    it('should tokenize links', () => {
      const input = '[Link](https://example.com)';
      
      const result = tokenize(input);
      const link = result.tokens.find(t => t.type === TokenType.LINK_OPEN);
      
      expect(link).toBeDefined();
      expect(link!.metadata?.linkUrl).toBe('https://example.com');
    });

    it('should tokenize images', () => {
      const input = '![Alt text](image.png)';
      
      const result = tokenize(input);
      const image = result.tokens.find(t => t.type === TokenType.IMAGE_OPEN);
      
      expect(image).toBeDefined();
      expect(image!.metadata?.imageUrl).toBe('image.png');
      expect(image!.metadata?.imageAlt).toBe('Alt text');
    });
  });

  describe('Source Locations', () => {
    it('should track line numbers correctly', () => {
      const input = `Line 1
Line 2
Line 3`;
      
      const result = tokenize(input);
      const newlines = result.tokens.filter(t => t.type === TokenType.NEWLINE);
      
      expect(newlines[0]!.line).toBe(1);
      expect(newlines[1]!.line).toBe(2);
    });

    it('should track column numbers correctly', () => {
      const input = 'abc';
      
      const result = tokenize(input);
      const text = result.tokens.find(t => t.type === TokenType.TEXT);
      
      expect(text).toBeDefined();
      expect(text!.column).toBe(0);
    });

    it('should track offsets correctly', () => {
      const input = 'hello world';
      
      const result = tokenize(input);
      const text = result.tokens.find(t => t.type === TokenType.TEXT);
      
      expect(text).toBeDefined();
      expect(text!.offset).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should report errors for unexpected characters', () => {
      const input = '\x00';
      
      const result = tokenize(input);
      
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should continue tokenizing after errors', () => {
      const input = 'text1 \x00 text2';
      
      const result = tokenize(input);
      
      // Should have errors but also some tokens
      expect(result.tokens.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics', () => {
    it('should track token count', () => {
      const input = 'hello world';
      
      const result = tokenize(input);
      
      expect(result.stats.totalTokens).toBeGreaterThan(0);
    });

    it('should track line count', () => {
      const input = `line1
line2
line3`;
      
      const result = tokenize(input);
      
      expect(result.stats.totalLines).toBe(3);
    });

    it('should track character count', () => {
      const input = 'hello';
      
      const result = tokenize(input);
      
      expect(result.stats.totalChars).toBe(5);
    });

    it('should track timing', () => {
      const input = 'test';
      
      const result = tokenize(input);
      
      expect(result.stats.timeMs).toBeGreaterThanOrEqual(0);
    });
  });
});