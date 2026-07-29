import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestRunner, type TestConfig } from '../src/runner.js';

vi.mock('@mam/parser', () => ({
  parseMAM: vi.fn().mockReturnValue({
    ast: {
      frontmatter: { data: { id: 'test', version: '1.0.0', name: 'test' } },
      sections: [{ name: 'Purpose', level: 2, content: 'Test module' }],
      metadata: { codeBlockCount: 0 },
    },
    errors: [],
    warnings: [],
  }),
}));

describe('TestRunner', () => {
  let runner: TestRunner;

  beforeEach(() => {
    runner = new TestRunner({ dir: '/tmp/mam-test', verbose: false, timeout: 5000 });
  });

  describe('constructor', () => {
    it('should create a runner with default config', () => {
      const r = new TestRunner({ dir: '/tmp' });
      expect(r).toBeInstanceOf(TestRunner);
    });

    it('should override defaults with provided config', () => {
      const r = new TestRunner({
        dir: '/tmp',
        verbose: true,
        timeout: 10000,
        parallel: true,
        pattern: '*.spec.mam.md',
      });
      expect(r).toBeInstanceOf(TestRunner);
    });
  });

  describe('run', () => {
    it('should return a TestResult with summary', async () => {
      const r = new TestRunner({ dir: '/nonexistent-dir' });
      const result = await r.run();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('suites');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('timeMs');
      expect(Array.isArray(result.suites)).toBe(true);
      expect(result.summary).toHaveProperty('total');
      expect(result.summary).toHaveProperty('passed');
      expect(result.summary).toHaveProperty('failed');
      expect(result.summary).toHaveProperty('skipped');
    });

    it('should handle non-existent directory gracefully', async () => {
      const r = new TestRunner({ dir: '/nonexistent-dir-12345' });
      const result = await r.run();

      expect(result.suites).toEqual([]);
      expect(result.summary.total).toBe(0);
    });

    it('should set timeMs to a non-negative number', async () => {
      const r = new TestRunner({ dir: '/nonexistent-dir' });
      const result = await r.run();

      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('runTestCase', () => {
    it('should return pass for a successful test', async () => {
      const test = () => { /* noop */ };
      const result = await runner.runTestCase(test, 'passing test');

      expect(result.name).toBe('passing test');
      expect(result.status).toBe('pass');
      expect(result.type).toBe('custom');
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return fail for a throwing test', async () => {
      const test = () => { throw new Error('test error'); };
      const result = await runner.runTestCase(test, 'failing test');

      expect(result.name).toBe('failing test');
      expect(result.status).toBe('fail');
      expect(result.error).toBe('test error');
    });

    it('should return fail for an async rejection', async () => {
      const test = async () => { throw new Error('async error'); };
      const result = await runner.runTestCase(test, 'async failing test');

      expect(result.status).toBe('fail');
      expect(result.error).toBe('async error');
    });

    it('should measure time for a slow test', async () => {
      const test = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      const result = await runner.runTestCase(test, 'slow test');

      expect(result.timeMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe('runTestFile', () => {
    it('should handle non-existent file', async () => {
      const suite = await runner.runTestFile('/nonexistent/file.mam.md');

      expect(suite.success).toBe(false);
      expect(suite.cases.length).toBeGreaterThan(0);
      expect(suite.cases[0].status).toBe('fail');
    });
  });
});
