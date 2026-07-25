/**
 * Parser Benchmark
 */

import { parseMAM } from '../src/index.js';

const fullModule = `---
id: benchmark-module
version: 1.0.0
name: Benchmark Module
author: LifeJiggy
runtime: python
tags:
  - benchmark
  - performance
---

## Purpose

Benchmark parsing performance.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | string | Yes | Input data |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | dict | Processed result |

## Rules

- Validate inputs
- Handle errors gracefully

## Python

\`\`\`python
def process(data: str) -> dict:
    return {"result": data}
\`\`\`

## Tests

\`\`\`python
def test_process():
    assert process("test") == {"result": "test"}
\`\`\`
`;

console.log('=== Parser Benchmark ===');
console.log(`Module: ${fullModule.length} chars`);

const iterations = 500;
console.log(`Running ${iterations} iterations...`);

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  parseMAM(fullModule);
}
const elapsed = performance.now() - start;

console.log(`Total: ${elapsed.toFixed(2)}ms`);
console.log(`Per iteration: ${(elapsed / iterations).toFixed(3)}ms`);
console.log(`Throughput: ${((iterations / elapsed) * 1000).toFixed(0)} modules/sec`);