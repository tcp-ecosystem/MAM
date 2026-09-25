import { describe, it, expect } from 'vitest';
import {
  execute,
  createExecutionHistory,
  isExecutionSuccess,
  countSuccessfulSections,
  getFailedSections,
  getExecutionLanguages,
  summarizeExecution,
  recordExecution,
  getExecutionHistorySize,
} from '../mam/runtime.js';
import { parseMAM } from '../mam/parser.js';
import type { AST } from '../mam/parser.js';
import type { ModuleExecutionResult } from '../mam/runtime.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAST(content: string): AST {
  return parseMAM(content).ast;
}

const JS_MODULE = `---
id: js-test
version: 2.0.0
name: JS Test
author: Test
runtime: javascript
---

## Purpose

Test JavaScript execution.

## JavaScript

\`\`\`javascript
output = 2 + 2;
\`\`\`
`;

const JS_MODULE_WITH_INPUTS = `---
id: js-inputs
version: 2.0.0
name: JS Inputs
author: Test
runtime: javascript
---

## Purpose

Test inputs.

## JavaScript

\`\`\`javascript
output = name + " says hello";
\`\`\`
`;

const PYTHON_MODULE = `---
id: py-test
version: 2.0.0
name: Python Test
author: Test
runtime: python
---

## Purpose

Test Python execution.

## Python

\`\`\`python
output = "hello from python"
\`\`\`
`;

const MULTI_SECTION_MODULE = `---
id: multi
version: 2.0.0
name: Multi
author: Test
runtime: javascript
---

## Purpose

Multi section test.

## Step1

\`\`\`javascript
output = "step1";
\`\`\`

## Step2

\`\`\`javascript
output = "step2";
\`\`\`
`;

const EMPTY_CODE_MODULE = `---
id: empty
version: 2.0.0
name: Empty
author: Test
runtime: javascript
---

## Purpose

Empty code test.

## JavaScript

\`\`\`javascript

\`\`\`
`;

const TIMEOUT_MODULE = `---
id: timeout
version: 2.0.0
name: Timeout
author: Test
runtime: javascript
---

## Purpose

Timeout test.

## JavaScript

\`\`\`javascript
# @mam:timeout=100
while(true) {}
\`\`\`
`;

const CONSOLE_LOG_MODULE = `---
id: console
version: 2.0.0
name: Console
author: Test
runtime: javascript
---

## Purpose

Console test.

## JavaScript

\`\`\`javascript
console.log("hello");
console.warn("warning");
console.error("error");
output = "done";
\`\`\`
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('execute', () => {
  describe('basic execution', () => {
    it('executes a simple JavaScript module', async () => {
      const ast = makeAST(JS_MODULE);
      const result = await execute(ast);
      expect(result.success).toBe(true);
      expect(result.output.JavaScript).toBe(4);
    });

    it('returns section results', async () => {
      const ast = makeAST(JS_MODULE);
      const result = await execute(ast);
      expect(result.sectionResults.length).toBeGreaterThanOrEqual(1);
      expect(result.sectionResults[0].success).toBe(true);
      expect(result.sectionResults[0].language).toBe('javascript');
    });

    it('reports duration', async () => {
      const ast = makeAST(JS_MODULE);
      const result = await execute(ast);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('inputs', () => {
    it('injects inputs as variables', async () => {
      const ast = makeAST(JS_MODULE_WITH_INPUTS);
      const result = await execute(ast, { inputs: { name: 'Alice' } });
      expect(result.success).toBe(true);
      expect(result.output.JavaScript).toBe('Alice says hello');
    });
  });

  describe('Python (stub)', () => {
    it('returns stub result for Python code', async () => {
      const ast = makeAST(PYTHON_MODULE);
      const result = await execute(ast);
      expect(result.success).toBe(true);
      expect(result.sectionResults[0].language).toBe('python');
    });
  });

  describe('shell (stub)', () => {
    it('returns stub result for shell code', async () => {
      const content = `---
id: shell-test
version: 2.0.0
name: Shell Test
author: Test
runtime: shell
---

## Purpose

Shell test.

## Shell

\`\`\`bash
echo "hello"
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast);
      expect(result.success).toBe(true);
    });
  });

  describe('section filtering', () => {
    it('executes only specified sections', async () => {
      const ast = makeAST(MULTI_SECTION_MODULE);
      const result = await execute(ast, { sections: ['Step1'] });
      expect(result.sectionResults.length).toBe(1);
      expect(result.sectionResults[0].sectionName).toBe('Step1');
    });
  });

  describe('console output', () => {
    it('captures console.log output', async () => {
      const ast = makeAST(CONSOLE_LOG_MODULE);
      const result = await execute(ast);
      expect(result.success).toBe(true);
    });
  });

  describe('stopOnError', () => {
    it('stops on first error when stopOnError is true', async () => {
      const content = `---
id: stop
version: 2.0.0
name: Stop
author: Test
runtime: javascript
---

## Purpose

Stop test.

## Step1

\`\`\`javascript
throw new Error("fail");
\`\`\`

## Step2

\`\`\`javascript
output = "should not run";
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast, { stopOnError: true });
      expect(result.success).toBe(false);
      // Step2 should not have executed
      const step2Result = result.sectionResults.find((r) => r.sectionName === 'Step2');
      expect(step2Result).toBeUndefined();
    });

    it('continues after error when stopOnError is false', async () => {
      const content = `---
id: continue
version: 2.0.0
name: Continue
author: Test
runtime: javascript
---

## Purpose

Continue test.

## Step1

\`\`\`javascript
throw new Error("fail");
\`\`\`

## Step2

\`\`\`javascript
output = "ran";
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast, { stopOnError: false });
      expect(result.sectionResults.length).toBe(2);
      expect(result.sectionResults[1].success).toBe(true);
    });
  });

  describe('memory', () => {
    it('initializes with provided memory', async () => {
      const content = `---
id: mem
version: 2.0.0
name: Mem
author: Test
runtime: javascript
---

## Purpose

Memory test.

## JavaScript

\`\`\`javascript
output = memory.count ?? 0;
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast, { memory: { count: 42 } });
      expect(result.memory.count).toBe(42);
    });
  });

  describe('env', () => {
    it('injects environment variables', async () => {
      const content = `---
id: env
version: 2.0.0
name: Env
author: Test
runtime: javascript
---

## Purpose

Env test.

## JavaScript

\`\`\`javascript
output = env.MY_VAR;
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast, { env: { MY_VAR: 'hello' } });
      expect(result.output.JavaScript).toBe('hello');
    });
  });

  describe('no code blocks', () => {
    it('returns success with no section results for text-only module', async () => {
      const content = `---
id: text-only
version: 2.0.0
name: Text Only
author: Test
runtime: javascript
---

## Purpose

This module has no code blocks.
`;
      const ast = makeAST(content);
      const result = await execute(ast);
      expect(result.success).toBe(true);
      expect(result.sectionResults).toHaveLength(0);
    });
  });

  describe('execution history', () => {
    it('tracks execution history', () => {
      const history = createExecutionHistory();
      expect(history.size()).toBe(0);

      history.add({
        timestamp: Date.now(),
        sectionName: 'Test',
        language: 'javascript',
        code: 'output = 1;',
        result: { success: true, output: 1, errors: [], duration: 0, sectionName: 'Test', language: 'javascript' },
      });

      expect(history.size()).toBe(1);
      expect(history.getBySection('Test')).toHaveLength(1);
      expect(history.getByLanguage('javascript')).toHaveLength(1);
      expect(history.getBySection('Other')).toHaveLength(0);
    });

    it('clears history', () => {
      const history = createExecutionHistory();
      history.add({
        timestamp: Date.now(),
        sectionName: 'A',
        language: 'javascript',
        code: '',
        result: { success: true, output: null, errors: [], duration: 0, sectionName: 'A', language: 'javascript' },
      });
      expect(history.size()).toBe(1);
      history.clear();
      expect(history.size()).toBe(0);
    });

    it('filters by language', () => {
      const history = createExecutionHistory();
      history.add({
        timestamp: Date.now(),
        sectionName: 'A',
        language: 'javascript',
        code: '',
        result: { success: true, output: null, errors: [], duration: 0, sectionName: 'A', language: 'javascript' },
      });
      history.add({
        timestamp: Date.now(),
        sectionName: 'B',
        language: 'python',
        code: '',
        result: { success: true, output: null, errors: [], duration: 0, sectionName: 'B', language: 'python' },
      });
      expect(history.getByLanguage('javascript')).toHaveLength(1);
      expect(history.getByLanguage('python')).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('captures JavaScript runtime errors', async () => {
      const content = `---
id: err
version: 2.0.0
name: Err
author: Test
runtime: javascript
---

## Purpose

Error test.

## JavaScript

\`\`\`javascript
throw new Error("intentional error");
\`\`\`
`;
      const ast = makeAST(content);
      const result = await execute(ast);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('intentional error');
    });
  });
});

describe('runtime helpers', () => {
  function makeResult(success: boolean, results: ModuleExecutionResult['sectionResults']): ModuleExecutionResult {
    return {
      success,
      sectionResults: results,
      output: {},
      duration: 12,
      memory: {},
      errors: success ? [] : ['boom'],
    };
  }

  it('isExecutionSuccess mirrors the success flag', () => {
    expect(isExecutionSuccess(makeResult(true, []))).toBe(true);
    expect(isExecutionSuccess(makeResult(false, []))).toBe(false);
  });

  it('countSuccessfulSections tallies passing sections', () => {
    const result = makeResult(true, [
      { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
      { success: false, output: 'b', errors: ['e'], duration: 1, sectionName: 'B', language: 'python' },
    ]);
    expect(countSuccessfulSections(result)).toBe(1);
  });

  it('getFailedSections returns only failures', () => {
    const result = makeResult(false, [
      { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
      { success: false, output: 'b', errors: ['e'], duration: 1, sectionName: 'B', language: 'js' },
    ]);
    const failed = getFailedSections(result);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.sectionName).toBe('B');
  });

  it('getExecutionLanguages lists distinct languages', () => {
    const result = makeResult(true, [
      { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
      { success: true, output: 'b', errors: [], duration: 1, sectionName: 'B', language: 'python' },
      { success: true, output: 'c', errors: [], duration: 1, sectionName: 'C', language: 'js' },
    ]);
    expect(getExecutionLanguages(result)).toEqual(['python', 'js']);
  });

  it('summarizeExecution describes the run', () => {
    const ok = makeResult(true, [
      { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
    ]);
    expect(summarizeExecution(ok)).toContain('succeeded');
    expect(summarizeExecution(ok)).toContain('1/1');
    expect(summarizeExecution(makeResult(false, []))).toContain('failed');
  });

  it('recordExecution and getExecutionHistorySize manage history', () => {
    const history = createExecutionHistory();
    expect(getExecutionHistorySize(history)).toBe(0);
    recordExecution(history, {
      timestamp: 1,
      sectionName: 'A',
      language: 'python',
      code: 'x',
      result: { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
    });
    expect(getExecutionHistorySize(history)).toBe(1);
    recordExecution(history, {
      timestamp: 2,
      sectionName: 'B',
      language: 'js',
      code: 'y',
      result: { success: false, output: '', errors: ['e'], duration: 1, sectionName: 'B', language: 'js' },
    });
    expect(getExecutionHistorySize(history)).toBe(2);
    expect(history.getBySection('A')).toHaveLength(1);
  });
});
