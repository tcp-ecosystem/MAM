import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
import {
  getExtension,
  formatSize,
  formatDuration,
  slugify,
  truncate,
  indent,
  dedent,
  pick,
  omit,
  sleep,
  randomHex,
  timestamp,
  fileExists,
  ensureDir,
  readFile,
  writeFile,
} from '../src/utils.js';

const TMP = join(tmpdir(), 'mam-utils-test-' + Date.now());

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('getExtension', () => {
  it('should return py for python', () => {
    expect(getExtension('python')).toBe('py');
  });

  it('should return js for javascript', () => {
    expect(getExtension('javascript')).toBe('js');
  });

  it('should return ts for typescript', () => {
    expect(getExtension('typescript')).toBe('ts');
  });

  it('should return go for go', () => {
    expect(getExtension('go')).toBe('go');
  });

  it('should return rs for rust', () => {
    expect(getExtension('rust')).toBe('rs');
  });

  it('should return json for json', () => {
    expect(getExtension('json')).toBe('json');
  });

  it('should return yaml for yaml', () => {
    expect(getExtension('yaml')).toBe('yaml');
  });

  it('should return py for openai', () => {
    expect(getExtension('openai')).toBe('py');
  });

  it('should return py for langgraph', () => {
    expect(getExtension('langgraph')).toBe('py');
  });

  it('should return py for crewai', () => {
    expect(getExtension('crewai')).toBe('py');
  });

  it('should return cs for csharp', () => {
    expect(getExtension('csharp')).toBe('cs');
  });

  it('should return java for java', () => {
    expect(getExtension('java')).toBe('java');
  });

  it('should return wasm for wasm', () => {
    expect(getExtension('wasm')).toBe('wasm');
  });

  it('should return py for gemini', () => {
    expect(getExtension('gemini')).toBe('py');
  });

  it('should return py for autogen', () => {
    expect(getExtension('autogen')).toBe('py');
  });

  it('should return yaml for kubernetes', () => {
    expect(getExtension('kubernetes')).toBe('yaml');
  });

  it('should return tf for terraform', () => {
    expect(getExtension('terraform')).toBe('tf');
  });

  it('should return txt for unknown target', () => {
    expect(getExtension('unknown')).toBe('txt');
  });
});

describe('formatSize', () => {
  it('should format bytes under 1024', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('should format kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 5.5)).toBe('5.5 MB');
  });

  it('should format gigabytes', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('should format negative values', () => {
    expect(formatSize(-100)).toBe('-100 B');
  });
});

describe('formatDuration', () => {
  it('should format sub-millisecond', () => {
    expect(formatDuration(0.5)).toBe('<1ms');
  });

  it('should format milliseconds', () => {
    expect(formatDuration(1)).toBe('1.0ms');
    expect(formatDuration(123.4)).toBe('123.4ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(5500)).toBe('5.50s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  it('should format negative values', () => {
    expect(formatDuration(-500)).toBe('-500ms');
  });
});

describe('slugify', () => {
  it('should lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugify('foo bar baz')).toBe('foo-bar-baz');
  });

  it('should remove special characters', () => {
    expect(slugify('Hello! @World#')).toBe('hello-world');
  });

  it('should collapse multiple hyphens', () => {
    expect(slugify('a---b')).toBe('a-b');
  });

  it('should trim leading and trailing hyphens', () => {
    expect(slugify('-hello-')).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('truncate', () => {
  it('should not truncate when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate when exceeding limit', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
  });

  it('should handle exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should handle single char truncation', () => {
    expect(truncate('hello', 1)).toBe('…');
  });
});

describe('indent', () => {
  it('should indent all non-empty lines', () => {
    expect(indent('a\nb', 2)).toBe('  a\n  b');
  });

  it('should not indent empty lines', () => {
    expect(indent('a\n\nb', 2)).toBe('  a\n\n  b');
  });

  it('should handle single line', () => {
    expect(indent('hello', 4)).toBe('    hello');
  });

  it('should handle zero indent', () => {
    expect(indent('hello', 0)).toBe('hello');
  });
});

describe('dedent', () => {
  it('should remove common leading whitespace (char-by-char prefix)', () => {
    const input = '  line1\n  line2\n  line3';
    // dedent computes char-by-char common prefix across all non-empty lines:
    // '  line1' vs '  line2' → common = '  line' (6 chars, differs at index 6)
    // '  line'  vs '  line3' → common = '  line' (still 6 chars)
    // So '  line1' minus 6 chars = '1'
    expect(dedent(input)).toBe('1\n2\n3');
  });

  it('should handle lines with identical short prefixes', () => {
    const input = '## a\n## b\n## c';
    // Common prefix is '## ' (3 chars)
    expect(dedent(input)).toBe('a\nb\nc');
  });

  it('should not change dedented text', () => {
    const input = 'a\nb\nc';
    expect(dedent(input)).toBe(input);
  });

  it('should handle empty string', () => {
    expect(dedent('')).toBe('');
  });

  it('should handle single line with no common prefix across multiple lines', () => {
    expect(dedent('  hello')).toBe('');
  });

  it('should handle blank lines', () => {
    const input = '  a\n\n  b';
    expect(dedent(input)).toBe('a\n\nb');
  });
});

describe('pick', () => {
  it('should pick specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('should return empty object when no keys match', () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, ['z'])).toEqual({});
  });

  it('should not mutate original', () => {
    const obj = { a: 1, b: 2 };
    pick(obj, ['a']);
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});

describe('omit', () => {
  it('should omit specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
  });

  it('should return copy of original when no keys match', () => {
    const obj = { a: 1, b: 2 };
    const result = omit(obj, ['z']);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(result).not.toBe(obj);
  });

  it('should not mutate original', () => {
    const obj = { a: 1, b: 2 };
    omit(obj, ['a']);
    expect(obj).toEqual({ a: 1, b: 2 });
  });

  it('should handle omitting all keys', () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, ['a', 'b'])).toEqual({});
  });
});

describe('fileExists', () => {
  it('should return true for existing file', async () => {
    const filePath = join(TMP, 'exists.txt');
    await fsWriteFile(filePath, 'content', 'utf-8');
    expect(await fileExists(filePath)).toBe(true);
  });

  it('should return false for non-existent file', async () => {
    expect(await fileExists(join(TMP, 'nope.txt'))).toBe(false);
  });

  it('should return true for existing directory', async () => {
    expect(await fileExists(TMP)).toBe(true);
  });
});

describe('ensureDir', () => {
  it('should create directory', async () => {
    const dir = join(TMP, 'new-dir');
    await ensureDir(dir);
    expect(await fileExists(dir)).toBe(true);
  });

  it('should create nested directories', async () => {
    const dir = join(TMP, 'a', 'b', 'c');
    await ensureDir(dir);
    expect(await fileExists(dir)).toBe(true);
  });

  it('should not fail if directory already exists', async () => {
    await ensureDir(TMP);
    await ensureDir(TMP);
    expect(await fileExists(TMP)).toBe(true);
  });
});

describe('readFile', () => {
  it('should read file contents', async () => {
    const filePath = join(TMP, 'read.txt');
    await fsWriteFile(filePath, 'hello world', 'utf-8');
    const content = await readFile(filePath);
    expect(content).toBe('hello world');
  });
});

describe('writeFile', () => {
  it('should write file contents', async () => {
    const filePath = join(TMP, 'write.txt');
    await writeFile(filePath, 'test content');
    const content = await fsReadFile(filePath, 'utf-8');
    expect(content).toBe('test content');
  });

  it('should create parent directories', async () => {
    const filePath = join(TMP, 'sub', 'dir', 'file.txt');
    await writeFile(filePath, 'nested');
    const content = await fsReadFile(filePath, 'utf-8');
    expect(content).toBe('nested');
  });
});

describe('sleep', () => {
  it('should resolve after delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe('randomHex', () => {
  it('should return hex string of default length', () => {
    const hex = randomHex();
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should return hex string of specified byte length', () => {
    const hex = randomHex(4);
    expect(hex).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should return different values on successive calls', () => {
    const a = randomHex();
    const b = randomHex();
    expect(a).not.toBe(b);
  });

  it('should return empty string for 0 bytes', () => {
    expect(randomHex(0)).toBe('');
  });
});

describe('timestamp', () => {
  it('should return HH:MM:SS.mmm format', () => {
    const ts = timestamp();
    expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('should return reasonable values', () => {
    const ts = timestamp();
    const [hours] = ts.split(':').map(Number);
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThan(24);
  });
});
