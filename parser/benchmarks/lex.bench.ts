/**
 * Lexer Benchmark
 */

import { tokenize } from '../src/lexer/index.js';

const smallModule = `---
id: test
version: 1.0.0
name: Test
author: Author
runtime: python
---

## Purpose

Test module.
`;

const largeModule = `---
id: large-test
version: 2.0.0
name: Large Test Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
  - tokens
description: A large module for benchmarking
permissions:
  - network
  - filesystem
---

## Purpose

Large module purpose.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | Yes | First input |
| input2 | int | No | Second input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | First output |

## Rules

- Rule 1
- Rule 2
- Rule 3

## Python

\`\`\`python
def process(input1: str, input2: int = 0) -> dict:
    return {"output1": input1}
\`\`\`

## Tests

\`\`\`python
def test_process():
    result = process("test")
    assert result["output1"] == "test"
\`\`\`
`;

console.log('=== Lexer Benchmark ===');
console.log(`Small module: ${smallModule.length} chars`);
console.log(`Large module: ${largeModule.length} chars`);

const iterations = 1000;

console.log(`\nRunning ${iterations} iterations...`);

const smallStart = performance.now();
for (let i = 0; i < iterations; i++) {
  tokenize(smallModule);
}
const smallTime = performance.now() - smallStart;
console.log(`Small: ${(smallTime / iterations).toFixed(3)}ms per iteration`);

const largeStart = performance.now();
for (let i = 0; i < iterations; i++) {
  tokenize(largeModule);
}
const largeTime = performance.now() - largeStart;
console.log(`Large: ${(largeTime / iterations).toFixed(3)}ms per iteration`);