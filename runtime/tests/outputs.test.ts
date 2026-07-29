/**
 * Output Formatter Tests
 *
 * Comprehensive tests for JSONOutput, HTMLOutput, MarkdownOutput,
 * TextOutput (via createFormatter), createFormatter factory,
 * OutputFormatter interface compliance, and edge cases.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  JSONOutput,
  HTMLOutput,
  MarkdownOutput,
  createFormatter,
  type OutputFormatter,
} from '../src/outputs/index.js';

// ---------------------------------------------------------------------------
// Tests: JSONOutput
// ---------------------------------------------------------------------------

describe('JSONOutput', () => {
  let formatter: JSONOutput;

  beforeEach(() => {
    formatter = new JSONOutput();
  });

  describe('format', () => {
    it('should format simple object', () => {
      const result = formatter.format({ key: 'value' });
      expect(result).toContain('"key"');
      expect(result).toContain('"value"');
    });

    it('should format string data', () => {
      const result = formatter.format('hello');
      expect(result).toBe('"hello"');
    });

    it('should format number data', () => {
      const result = formatter.format(42);
      expect(result).toBe('42');
    });

    it('should format null data', () => {
      const result = formatter.format(null);
      expect(result).toBe('null');
    });

    it('should format undefined data', () => {
      const result = formatter.format(undefined);
      expect(result).toBe('null');
    });

    it('should format array data', () => {
      const result = formatter.format([1, 2, 3]);
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    it('should format nested objects', () => {
      const result = formatter.format({ a: { b: { c: 1 } } });
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
      expect(result).toContain('"c"');
    });

    it('should handle special characters', () => {
      const result = formatter.format({ key: 'line1\nline2\ttab' });
      expect(result).toContain('\\n');
      expect(result).toContain('\\t');
    });

    it('should format with compact option', () => {
      const compact = new JSONOutput({ compact: true });
      const result = compact.format({ a: 1, b: 2 });
      expect(result).not.toContain('\n');
    });

    it('should format with custom indent', () => {
      const indented = new JSONOutput({ indent: 4 });
      const result = indented.format({ key: 'value' });
      expect(result).toContain('    ');
    });

    it('should format with sortKeys', () => {
      const sorted = new JSONOutput({ sortKeys: true });
      const result = sorted.format({ z: 1, a: 2, m: 3 });
      const keys = Object.keys(JSON.parse(result));
      expect(keys).toEqual(['a', 'm', 'z']);
    });

    it('should format with metadata envelope', () => {
      const withMeta = new JSONOutput({ includeMetadata: true });
      const result = withMeta.format({ data: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('meta');
      expect(parsed.meta).toHaveProperty('formattedAt');
      expect(parsed.meta).toHaveProperty('formatVersion', '1.0.0');
    });

    it('should format JSON string input', () => {
      const result = formatter.format('{"key": "value"}');
      expect(result).toContain('"key"');
    });

    it('should format invalid JSON string as-is', () => {
      const result = formatter.format('not json');
      expect(result).toBe('"not json"');
    });
  });

  describe('formatSections', () => {
    it('should format sections array', () => {
      const sections = [
        { name: 'Section 1', content: 'Content 1' },
        { name: 'Section 2', content: 'Content 2' },
      ];
      const result = formatter.formatSections(sections);
      expect(result).toContain('Section 1');
      expect(result).toContain('Section 2');
    });

    it('should handle empty sections', () => {
      const result = formatter.formatSections([]);
      expect(result).toBe('[]');
    });
  });

  describe('specialized formatters', () => {
    it('should format frontmatter', () => {
      const result = formatter.formatFrontmatter({ id: 'test', version: '1.0.0' });
      expect(result).toContain('"id"');
      expect(result).toContain('"test"');
    });

    it('should format code block', () => {
      const result = formatter.formatCodeBlock({
        code: 'console.log("hello")',
        language: 'javascript',
        filename: 'test.js',
      });
      expect(result).toContain('console.log');
      expect(result).toContain('javascript');
    });

    it('should format table', () => {
      const result = formatter.formatTable({
        headers: ['Name', 'Age'],
        rows: [['Alice', '30'], ['Bob', '25']],
      });
      expect(result).toContain('Name');
      expect(result).toContain('Alice');
    });

    it('should format error', () => {
      const result = formatter.formatError({
        message: 'Something went wrong',
        code: 'ERR_001',
        stack: 'at test.ts:1:1',
      });
      expect(result).toContain('Something went wrong');
      expect(result).toContain('ERR_001');
    });
  });

  describe('minify and prettify', () => {
    it('should minify data', () => {
      const result = formatter.minify({ a: 1, b: 2 });
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should prettify JSON string', () => {
      const result = formatter.prettify('{"a":1}');
      expect(result).toContain('\n');
    });
  });

  describe('getMimeType and getExtension', () => {
    it('should return correct MIME type', () => {
      expect(formatter.getMimeType()).toBe('application/json');
    });

    it('should return correct extension', () => {
      expect(formatter.getExtension()).toBe('.json');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: HTMLOutput
// ---------------------------------------------------------------------------

describe('HTMLOutput', () => {
  let formatter: HTMLOutput;

  beforeEach(() => {
    formatter = new HTMLOutput();
  });

  describe('format', () => {
    it('should format empty object', () => {
      const result = formatter.format({});
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<html');
      expect(result).toContain('</html>');
    });

    it('should format document with sections', () => {
      const result = formatter.format({
        sections: [
          { name: 'Introduction', content: 'Hello world', level: 2 },
        ],
      });
      expect(result).toContain('Introduction');
      expect(result).toContain('Hello world');
    });

    it('should format document with frontmatter', () => {
      const result = formatter.format({
        frontmatter: { title: 'My Doc', version: '1.0' },
        sections: [],
      });
      expect(result).toContain('My Doc');
      expect(result).toContain('Metadata');
    });

    it('should generate table of contents when enabled', () => {
      const tocFormatter = new HTMLOutput({ tableOfContents: true });
      const result = tocFormatter.format({
        sections: [
          { name: 'First', content: 'Content 1', level: 2 },
          { name: 'Second', content: 'Content 2', level: 2 },
        ],
      });
      expect(result).toContain('Table of Contents');
      expect(result).toContain('First');
      expect(result).toContain('Second');
    });

    it('should handle code blocks in sections', () => {
      const result = formatter.format({
        sections: [
          {
            name: 'Code',
            content: [{ type: 'code', value: 'console.log("hello")', language: 'javascript' }],
            level: 2,
          },
        ],
      });
      expect(result).toContain('console.log');
      expect(result).toContain('javascript');
    });

    it('should handle tables in sections', () => {
      const result = formatter.format({
        sections: [
          {
            name: 'Data',
            content: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }],
            level: 2,
          },
        ],
      });
      expect(result).toContain('<table');
    });
  });

  describe('formatSections', () => {
    it('should format multiple sections', () => {
      const result = formatter.formatSections([
        { name: 'A', content: 'Content A' },
        { name: 'B', content: 'Content B' },
      ]);
      expect(result).toContain('A');
      expect(result).toContain('B');
    });
  });

  describe('renderFrontmatter', () => {
    it('should render frontmatter as table', () => {
      const result = formatter.renderFrontmatter({ key: 'value' });
      expect(result).toContain('<table');
      expect(result).toContain('key');
      expect(result).toContain('value');
    });
  });

  describe('renderSection', () => {
    it('should render section with heading', () => {
      const result = formatter.renderSection({ name: 'Test', level: 2 });
      expect(result).toContain('<h2');
      expect(result).toContain('Test');
    });

    it('should render section with custom level', () => {
      const result = formatter.renderSection({ name: 'Deep', level: 4 });
      expect(result).toContain('<h4');
    });
  });

  describe('renderCodeBlock', () => {
    it('should render code block with language', () => {
      const result = formatter.renderCodeBlock('const x = 1;', 'javascript');
      expect(result).toContain('<pre><code');
      expect(result).toContain('javascript');
      expect(result).toContain('const x = 1;');
    });

    it('should render code block without language', () => {
      const result = formatter.renderCodeBlock('hello');
      expect(result).toContain('<pre><code');
      expect(result).toContain('hello');
    });
  });

  describe('renderTable', () => {
    it('should render table with headers and rows', () => {
      const result = formatter.renderTable({
        headers: ['Name', 'Value'],
        rows: [['test', '123']],
      });
      expect(result).toContain('<table');
      expect(result).toContain('<th');
      expect(result).toContain('<td');
      expect(result).toContain('Name');
      expect(result).toContain('test');
    });

    it('should handle alignments', () => {
      const result = formatter.renderTable({
        headers: ['A', 'B', 'C'],
        rows: [['1', '2', '3']],
        alignments: ['left', 'center', 'right'],
      });
      expect(result).toContain('text-align:left');
      expect(result).toContain('text-align:center');
      expect(result).toContain('text-align:right');
    });
  });

  describe('escapeHtml', () => {
    it('should escape special characters', () => {
      expect(formatter.escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(formatter.escapeHtml('a&b')).toBe('a&amp;b');
      expect(formatter.escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(formatter.escapeHtml("it's")).toBe("it&#039;s");
    });
  });

  describe('getMimeType and getExtension', () => {
    it('should return correct MIME type', () => {
      expect(formatter.getMimeType()).toBe('text/html');
    });

    it('should return correct extension', () => {
      expect(formatter.getExtension()).toBe('.html');
    });
  });

  describe('themes', () => {
    it('should generate CSS for default theme', () => {
      const css = formatter.generateCSS('default');
      expect(css).toContain('body');
      expect(css).toContain('font-family');
    });

    it('should generate CSS for dark theme', () => {
      const css = formatter.generateCSS('dark');
      expect(css).toContain('#0d1117');
    });

    it('should generate CSS for github theme', () => {
      const css = formatter.generateCSS('github');
      expect(css).toContain('apple-system');
    });

    it('should generate CSS for minimal theme', () => {
      const css = formatter.generateCSS('minimal');
      expect(css).toContain('Georgia');
    });

    it('should generate CSS for print theme', () => {
      const css = formatter.generateCSS('print');
      expect(css).toContain('page-break-inside');
    });
  });

  describe('wrapDocument', () => {
    it('should wrap body in full HTML document', () => {
      const result = formatter.wrapDocument('<p>test</p>');
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<p>test</p>');
    });

    it('should include custom title', () => {
      const f = new HTMLOutput({ title: 'Custom Title' });
      const result = f.wrapDocument('');
      expect(result).toContain('Custom Title');
    });

    it('should include custom CSS', () => {
      const f = new HTMLOutput({ css: '.custom { color: red; }' });
      const result = f.wrapDocument('');
      expect(result).toContain('.custom');
    });

    it('should include scripts', () => {
      const f = new HTMLOutput({ scripts: ['console.log("hi")'] });
      const result = f.wrapDocument('');
      expect(result).toContain('<script>');
      expect(result).toContain('console.log');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: MarkdownOutput
// ---------------------------------------------------------------------------

describe('MarkdownOutput', () => {
  let formatter: MarkdownOutput;

  beforeEach(() => {
    formatter = new MarkdownOutput();
  });

  describe('format', () => {
    it('should format empty document', () => {
      const result = formatter.format({});
      expect(typeof result).toBe('string');
    });

    it('should format document with sections', () => {
      const result = formatter.format({
        sections: [
          { name: 'Introduction', content: 'Hello world', level: 2 },
        ],
      });
      expect(result).toContain('## Introduction');
      expect(result).toContain('Hello world');
    });

    it('should format document with frontmatter', () => {
      const result = formatter.format({
        frontmatter: { title: 'My Doc', version: '1.0' },
        sections: [],
      });
      expect(result).toContain('---');
      expect(result).toContain('title: My Doc');
    });

    it('should generate TOC when enabled', () => {
      const tocFormatter = new MarkdownOutput({ toc: true });
      const result = tocFormatter.format({
        sections: [
          { name: 'First', content: 'Content 1', level: 2 },
          { name: 'Second', content: 'Content 2', level: 3 },
        ],
      });
      expect(result).toContain('Table of Contents');
      expect(result).toContain('[First]');
      expect(result).toContain('[Second]');
    });

    it('should handle code blocks in sections', () => {
      const result = formatter.format({
        sections: [
          {
            name: 'Code',
            content: [{ type: 'code', value: 'console.log("hello")', language: 'javascript' }],
            level: 2,
          },
        ],
      });
      expect(result).toContain('```');
      expect(result).toContain('javascript');
      expect(result).toContain('console.log');
    });

    it('should handle tables in sections', () => {
      const result = formatter.format({
        sections: [
          {
            name: 'Data',
            content: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }],
            level: 2,
          },
        ],
      });
      expect(result).toContain('| A | B |');
      expect(result).toContain('| --- |');
    });
  });

  describe('formatSections', () => {
    it('should format multiple sections', () => {
      const result = formatter.formatSections([
        { name: 'A', content: 'Content A' },
        { name: 'B', content: 'Content B' },
      ]);
      expect(result).toContain('A');
      expect(result).toContain('B');
    });
  });

  describe('renderFrontmatter', () => {
    it('should render YAML frontmatter', () => {
      const result = formatter.renderFrontmatter({ title: 'Test', version: '1.0' });
      expect(result).toContain('---');
      expect(result).toContain('title: Test');
    });

    it('should handle special YAML characters', () => {
      const result = formatter.renderFrontmatter({ key: 'value: with: colons' });
      expect(result).toContain('"value: with: colons"');
    });

    it('should handle null values', () => {
      const result = formatter.renderFrontmatter({ key: null });
      expect(result).toContain('null');
    });

    it('should handle array values', () => {
      const result = formatter.renderFrontmatter({ tags: ['a', 'b'] });
      expect(result).toContain('- a');
      expect(result).toContain('- b');
    });
  });

  describe('renderSection', () => {
    it('should render section with ATX heading', () => {
      const result = formatter.renderSection({ name: 'Test', level: 2 });
      expect(result).toContain('## Test');
    });

    it('should render section with setext heading', () => {
      const setext = new MarkdownOutput({ headingStyle: 'setext' });
      const result = setext.renderSection({ name: 'Title', level: 1 });
      expect(result).toContain('Title');
      expect(result).toContain('===');
    });

    it('should render section with content', () => {
      const result = formatter.renderSection({ name: 'Test', content: 'Body text', level: 2 });
      expect(result).toContain('Body text');
    });
  });

  describe('renderCodeBlock', () => {
    it('should render with backtick fence', () => {
      const result = formatter.renderCodeBlock('const x = 1;', 'javascript');
      expect(result).toContain('```');
      expect(result).toContain('javascript');
      expect(result).toContain('const x = 1;');
    });

    it('should render with tilde fence', () => {
      const tilde = new MarkdownOutput({ codeBlockStyle: 'tilde' });
      const result = tilde.renderCodeBlock('hello');
      expect(result).toContain('~~~');
    });
  });

  describe('renderTable', () => {
    it('should render markdown table', () => {
      const result = formatter.renderTable({
        headers: ['Name', 'Value'],
        rows: [['test', '123']],
      });
      expect(result).toContain('| Name | Value |');
      expect(result).toContain('| --- |');
      expect(result).toContain('test');
      expect(result).toContain('123');
    });

    it('should handle alignments', () => {
      const result = formatter.renderTable({
        headers: ['A', 'B', 'C'],
        rows: [['1', '2', '3']],
        alignments: ['left', 'center', 'right'],
      });
      expect(result).toContain(':--');
      expect(result).toContain(':-:');
      expect(result).toContain('--:');
    });
  });

  describe('renderList', () => {
    it('should render unordered list', () => {
      const result = formatter.renderList([
        { text: 'Item 1' },
        { text: 'Item 2' },
      ]);
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
    });

    it('should render nested list', () => {
      const result = formatter.renderList([
        { text: 'Parent', items: [{ text: 'Child' }] },
      ]);
      expect(result).toContain('- Parent');
      expect(result).toContain('  - Child');
    });
  });

  describe('renderInline', () => {
    it('should render bold', () => {
      const result = formatter.renderInline([{ type: 'bold', value: 'strong' }]);
      expect(result).toBe('**strong**');
    });

    it('should render italic', () => {
      const result = formatter.renderInline([{ type: 'italic', value: 'emphasis' }]);
      expect(result).toBe('*emphasis*');
    });

    it('should render code', () => {
      const result = formatter.renderInline([{ type: 'code', value: 'inline' }]);
      expect(result).toBe('`inline`');
    });

    it('should render link', () => {
      const result = formatter.renderInline([
        { type: 'link', value: 'click here', url: 'https://example.com' },
      ]);
      expect(result).toBe('[click here](https://example.com)');
    });

    it('should render image', () => {
      const result = formatter.renderInline([
        { type: 'image', value: 'alt text', url: 'img.png' },
      ]);
      expect(result).toBe('![alt text](img.png)');
    });

    it('should render strikethrough', () => {
      const result = formatter.renderInline([{ type: 'strikethrough', value: 'deleted' }]);
      expect(result).toBe('~~deleted~~');
    });
  });

  describe('getMimeType and getExtension', () => {
    it('should return correct MIME type', () => {
      expect(formatter.getMimeType()).toBe('text/markdown');
    });

    it('should return correct extension', () => {
      expect(formatter.getExtension()).toBe('.md');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: TextOutput (via createFormatter)
// ---------------------------------------------------------------------------

describe('TextOutput', () => {
  let formatter: OutputFormatter;

  beforeEach(() => {
    formatter = createFormatter('text');
  });

  describe('format', () => {
    it('should format string as-is', () => {
      expect(formatter.format('hello')).toBe('hello');
    });

    it('should format null as empty', () => {
      expect(formatter.format(null)).toBe('');
    });

    it('should format undefined as empty', () => {
      expect(formatter.format(undefined)).toBe('');
    });

    it('should format object as JSON', () => {
      const result = formatter.format({ key: 'value' });
      expect(result).toContain('"key"');
    });

    it('should format number as JSON', () => {
      expect(formatter.format(42)).toBe('42');
    });
  });

  describe('formatSections', () => {
    it('should format sections with headers', () => {
      const result = formatter.formatSections([
        { name: 'Section 1', content: 'Body text' },
      ]);
      expect(result).toContain('Section 1');
      expect(result).toContain('========');
      expect(result).toContain('Body text');
    });
  });

  describe('getMimeType and getExtension', () => {
    it('should return correct MIME type', () => {
      expect(formatter.getMimeType()).toBe('text/plain');
    });

    it('should return correct extension', () => {
      expect(formatter.getExtension()).toBe('.txt');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: createFormatter factory
// ---------------------------------------------------------------------------

describe('createFormatter', () => {
  it('should create JSON formatter', () => {
    const f = createFormatter('json');
    expect(f).toBeInstanceOf(JSONOutput);
    expect(f.getMimeType()).toBe('application/json');
  });

  it('should create HTML formatter', () => {
    const f = createFormatter('html');
    expect(f).toBeInstanceOf(HTMLOutput);
    expect(f.getMimeType()).toBe('text/html');
  });

  it('should create Markdown formatter', () => {
    const f = createFormatter('markdown');
    expect(f).toBeInstanceOf(MarkdownOutput);
    expect(f.getMimeType()).toBe('text/markdown');
  });

  it('should create Text formatter', () => {
    const f = createFormatter('text');
    expect(f.getMimeType()).toBe('text/plain');
    expect(f.getExtension()).toBe('.txt');
  });

  it('should throw for unknown type', () => {
    expect(() => createFormatter('unknown' as any)).toThrow('Unknown output type');
  });
});

// ---------------------------------------------------------------------------
// Tests: OutputFormatter interface compliance
// ---------------------------------------------------------------------------

describe('OutputFormatter interface compliance', () => {
  const formatters: Array<{ type: string; mime: string; ext: string }> = [
    { type: 'json', mime: 'application/json', ext: '.json' },
    { type: 'html', mime: 'text/html', ext: '.html' },
    { type: 'markdown', mime: 'text/markdown', ext: '.md' },
    { type: 'text', mime: 'text/plain', ext: '.txt' },
  ];

  for (const { type, mime, ext } of formatters) {
    describe(`${type} formatter`, () => {
      it('should implement format', () => {
        const f = createFormatter(type as any);
        expect(typeof f.format).toBe('function');
      });

      it('should implement getMimeType', () => {
        const f = createFormatter(type as any);
        expect(f.getMimeType()).toBe(mime);
      });

      it('should implement getExtension', () => {
        const f = createFormatter(type as any);
        expect(f.getExtension()).toBe(ext);
      });

      it('should implement formatSections', () => {
        const f = createFormatter(type as any);
        expect(typeof f.formatSections).toBe('function');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('JSONOutput should handle deeply nested objects', () => {
    const f = new JSONOutput();
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
    const result = f.format(deep);
    expect(result).toContain('deep');
  });

  it('JSONOutput should handle empty object', () => {
    const f = new JSONOutput();
    expect(f.format({})).toBe('{}');
  });

  it('JSONOutput should handle empty array', () => {
    const f = new JSONOutput();
    expect(f.format([])).toBe('[]');
  });

  it('HTMLOutput should handle sections with no content', () => {
    const f = new HTMLOutput();
    const result = f.format({ sections: [{ name: 'Empty' }] });
    expect(result).toContain('Empty');
  });

  it('MarkdownOutput should handle empty frontmatter', () => {
    const f = new MarkdownOutput();
    const result = f.format({ frontmatter: {}, sections: [] });
    expect(typeof result).toBe('string');
  });

  it('MarkdownOutput should handle CRLF line endings', () => {
    const f = new MarkdownOutput({ lineEnding: '\r\n' });
    const result = f.renderList([{ text: 'A' }, { text: 'B' }]);
    expect(result).toContain('\r\n');
  });

  it('HTMLOutput should handle special characters in content', () => {
    const f = new HTMLOutput();
    const result = f.format({
      sections: [{ name: 'Test <script>', content: 'Content & more', level: 2 }],
    });
    expect(result).toContain('&lt;script&gt;');
    // Note: section string content is rendered as-is (not escaped) by design
    expect(result).toContain('Content & more');
  });
});
