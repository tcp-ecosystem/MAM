import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAMAssert,
  MAMAssertionError,
  type MAMASTPartial,
} from '../src/assertions.js';

describe('MAMAssert', () => {
  let assert: MAMAssert;

  beforeEach(() => {
    assert = new MAMAssert();
  });

  describe('assertEqual', () => {
    it('should pass for equal values', () => {
      assert.assertEqual(1, 1);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for unequal values', () => {
      assert.assertEqual(1, 2);
      expect(assert.allPassed()).toBe(false);
    });

    it('should support deep equality for objects', () => {
      assert.assertEqual({ a: 1 }, { a: 1 });
      expect(assert.allPassed()).toBe(true);
    });
  });

  describe('assertStrictEqual', () => {
    it('should pass for strict equality', () => {
      assert.assertStrictEqual(1, 1);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for loose equality', () => {
      assert.assertStrictEqual(1, '1' as unknown);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertTrue', () => {
    it('should pass for truthy values', () => {
      assert.assertTrue(true);
      assert.assertTrue(1);
      assert.assertTrue('yes');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for falsy values', () => {
      assert.assertTrue(false);
      assert.assertTrue(0);
      assert.assertTrue('');
      expect(assert.getFailures().length).toBe(3);
    });
  });

  describe('assertFalse', () => {
    it('should pass for falsy values', () => {
      assert.assertFalse(false);
      assert.assertFalse(0);
      assert.assertFalse('');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for truthy values', () => {
      assert.assertFalse(true);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertNull', () => {
    it('should pass for null/undefined', () => {
      assert.assertNull(null);
      assert.assertNull(undefined);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for non-null values', () => {
      assert.assertNull(0);
      assert.assertNull('');
      expect(assert.getFailures().length).toBe(2);
    });
  });

  describe('assertNotNull', () => {
    it('should pass for non-null values', () => {
      assert.assertNotNull(0);
      assert.assertNotNull('');
      assert.assertNotNull(false);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for null', () => {
      assert.assertNotNull(null);
      expect(assert.allPassed()).toBe(false);
    });

    it('should fail for undefined', () => {
      assert.assertNotNull(undefined);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertMatch', () => {
    it('should pass for matching pattern', () => {
      assert.assertMatch('hello world', /hello/);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for non-matching pattern', () => {
      assert.assertMatch('hello world', /^xyz/);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertContains', () => {
    it('should pass when array contains element', () => {
      assert.assertContains([1, 2, 3], 2);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when array does not contain element', () => {
      assert.assertContains([1, 2, 3], 4);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertType', () => {
    it('should pass for correct type', () => {
      assert.assertType('hello', 'string');
      assert.assertType(42, 'number');
      assert.assertType(true, 'boolean');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for wrong type', () => {
      assert.assertType('hello', 'number');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertInstanceOf', () => {
    it('should pass for correct instance', () => {
      assert.assertInstanceOf(new Error('test'), Error);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for wrong instance', () => {
      assert.assertInstanceOf('test', Error);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertSection', () => {
    it('should pass when section exists', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'Purpose', level: 2, content: 'Test' }],
      };
      assert.assertSection(ast, 'Purpose');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when section missing', () => {
      const ast: MAMASTPartial = { sections: [] };
      assert.assertSection(ast, 'Purpose');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertCodeBlock', () => {
    it('should pass when code block exists', () => {
      const ast: MAMASTPartial = {
        sections: [
          {
            name: 'Config',
            level: 2,
            codeBlocks: [{ language: 'json', content: '{}' }],
          },
        ],
      };
      assert.assertCodeBlock(ast, 'Config', 'json');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when code block missing', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'Config', level: 2 }],
      };
      assert.assertCodeBlock(ast, 'Config', 'json');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertFrontmatter', () => {
    it('should pass when frontmatter matches', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { id: 'test', version: '1.0.0' } },
      };
      assert.assertFrontmatter(ast, { id: 'test' });
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when frontmatter missing key', () => {
      const ast: MAMASTPartial = { frontmatter: { data: {} } };
      assert.assertFrontmatter(ast, { id: 'test' });
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertNoErrors', () => {
    it('should pass when no errors', () => {
      const ast: MAMASTPartial = { errors: [] };
      assert.assertNoErrors(ast);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when errors exist', () => {
      const ast: MAMASTPartial = {
        errors: [{ message: 'parse error' }],
      };
      assert.assertNoErrors(ast);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertMetadata', () => {
    it('should pass when metadata matches', () => {
      const ast: MAMASTPartial = {
        metadata: { codeBlockCount: 3 },
      };
      assert.assertMetadata(ast, 'codeBlockCount', 3);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when metadata differs', () => {
      const ast: MAMASTPartial = {
        metadata: { codeBlockCount: 5 },
      };
      assert.assertMetadata(ast, 'codeBlockCount', 3);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertDependency', () => {
    it('should pass when dependency exists', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { dependencies: ['lodash', 'express'] } },
      };
      assert.assertDependency(ast, 'lodash');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when dependency missing', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { dependencies: [] } },
      };
      assert.assertDependency(ast, 'lodash');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertPermission', () => {
    it('should pass when permission exists', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { permissions: ['read', 'write'] } },
      };
      assert.assertPermission(ast, 'read');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when permission missing', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { permissions: [] } },
      };
      assert.assertPermission(ast, 'admin');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertHook', () => {
    it('should pass when hook exists', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { hooks: { onInit: 'setup.js' } } },
      };
      assert.assertHook(ast, 'onInit');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when hook missing', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { hooks: {} } },
      };
      assert.assertHook(ast, 'onInit');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertRuntime', () => {
    it('should pass when runtime matches', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { runtime: 'node' } },
      };
      assert.assertRuntime(ast, 'node');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when runtime differs', () => {
      const ast: MAMASTPartial = {
        frontmatter: { data: { runtime: 'browser' } },
      };
      assert.assertRuntime(ast, 'node');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertSectionCount', () => {
    it('should pass for correct count', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'A', level: 1 }, { name: 'B', level: 1 }],
      };
      assert.assertSectionCount(ast, 2);
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail for wrong count', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'A', level: 1 }],
      };
      assert.assertSectionCount(ast, 3);
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('assertSectionContent', () => {
    it('should pass when content contains substring', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'Purpose', level: 2, content: 'This module does X' }],
      };
      assert.assertSectionContent(ast, 'Purpose', 'does X');
      expect(assert.allPassed()).toBe(true);
    });

    it('should fail when content missing substring', () => {
      const ast: MAMASTPartial = {
        sections: [{ name: 'Purpose', level: 2, content: 'Hello' }],
      };
      assert.assertSectionContent(ast, 'Purpose', 'missing');
      expect(assert.allPassed()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear results', () => {
      assert.assertTrue(true);
      assert.assertTrue(false);
      expect(assert.allPassed()).toBe(false);

      assert.reset();
      expect(assert.allPassed()).toBe(true);
    });
  });

  describe('getResults', () => {
    it('should return all results', () => {
      assert.assertTrue(true);
      assert.assertTrue(false);
      const results = assert.getResults();
      expect(results.length).toBe(2);
    });
  });

  describe('getSummary', () => {
    it('should return correct counts', () => {
      assert.assertTrue(true);
      assert.assertTrue(false);
      assert.assertTrue(true);

      const summary = assert.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(1);
    });
  });

  describe('throwOnFail', () => {
    it('should throw MAMAssertionError on failure', () => {
      const throwAssert = new MAMAssert({ throwOnFail: true });

      expect(() => {
        throwAssert.assertTrue(false, 'should fail');
      }).toThrow(MAMAssertionError);
    });

    it('should not throw on success', () => {
      const throwAssert = new MAMAssert({ throwOnFail: true });

      expect(() => {
        throwAssert.assertTrue(true);
      }).not.toThrow();
    });

    it('should include assertion name in error', () => {
      const throwAssert = new MAMAssert({ throwOnFail: true });

      try {
        throwAssert.assertTrue(false);
      } catch (e) {
        expect(e).toBeInstanceOf(MAMAssertionError);
        expect((e as MAMAssertionError).assertionName).toBe('assertTrue');
      }
    });
  });

  describe('messagePrefix', () => {
    it('should prepend prefix to messages', () => {
      const prefixed = new MAMAssert({ messagePrefix: 'MY_TEST' });
      prefixed.assertTrue(false);

      const failures = prefixed.getFailures();
      expect(failures[0].message).toContain('MY_TEST');
    });
  });
});
