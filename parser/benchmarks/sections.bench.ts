/**
 * Sections Benchmark
 *
 * Benchmarks `parseMAM` over a full-MAM module that exercises all 20
 * standard sections (Purpose, Inputs, Outputs, Rules, Workflow, Mermaid,
 * Python, JavaScript, TypeScript, Prompt, Memory, Examples, Tests,
 * References, Dependencies, Exports, Imports, Plugins, Permissions,
 * Capabilities). Reports chars, section count, ms/iter, sections/sec,
 * error count, and heap delta, with a warmup phase.
 */

import { parseMAM } from '../src/index.js';

// ============================================================================
// Fixture: module with all 20 standard sections
// ============================================================================

const allSectionsModule = `---
id: all-sections
name: All Sections Module
version: 2.0.0
type: module
author: LifeJiggy
runtime:
  language: python
  version: ">=3.12"
capabilities:
  - run
permissions:
  filesystem:
    - read
---

# All Sections Module

## Purpose

Exercises all 20 standard MAM sections.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | string | Yes | Input data |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | dict | Result |

## Rules

- Rule one.
- Rule two.

## Workflow

\`\`\`mermaid
flowchart LR
    A[Input] --> B[Output]
\`\`\`

## Mermaid

\`\`\`mermaid
graph TD
    X --> Y
\`\`\`

## Python

\`\`\`python
def run(data: str) -> dict:
    return {"result": data}
\`\`\`

## JavaScript

\`\`\`javascript
function run(data) {
  return { result: data };
}
\`\`\`

## TypeScript

\`\`\`typescript
function run(data: string): { result: string } {
  return { result: data };
}
\`\`\`

## Prompt

You are a module that processes input data and returns a structured result.

## Memory

| Key | Type | TTL |
|-----|------|-----|
| cache | object | 5m |

## Examples

\`\`\`text
run("hello")
\`\`\`

## Tests

\`\`\`python
def test_run():
    assert run("hello") == {"result": "hello"}
\`\`\`

## References

- MAM specification
- Section documentation

## Dependencies

| Name | Version | Purpose |
|------|---------|---------|
| http-client | ^1.2 | HTTP calls |

## Exports

- run

## Imports

- http-client

## Plugins

- cache-plugin

## Permissions

| Scope | Action |
|-------|--------|
| filesystem | read |

## Capabilities

### run

Execute the module pipeline.
`;

const STANDARD_SECTION_NAMES = [
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'TypeScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
];
const STANDARD_SECTION_COUNT = STANDARD_SECTION_NAMES.length;

// ============================================================================
// Benchmark driver
// ============================================================================

function benchmarkFixture(
  name: string,
  text: string,
  iterations: number,
  warmup: number
): void {
  const probe = parseMAM(text, { source: 'sections.bench.mam' });
  const sectionNames = probe.ast.sections.map((s) => s.name);

  for (let i = 0; i < warmup; i++) {
    parseMAM(text, { source: 'sections.bench.mam' });
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let errorCount = 0;
  for (let i = 0; i < iterations; i++) {
    errorCount = parseMAM(text, { source: 'sections.bench.mam' }).errors.length;
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const sectionsPerSec = msPerIter > 0 ? STANDARD_SECTION_COUNT / (msPerIter / 1000) : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  const standardPresent = STANDARD_SECTION_NAMES.filter((n) =>
    sectionNames.includes(n)
  ).length;

  console.log(`\n${name}`);
  console.log(`  chars:           ${text.length.toLocaleString()}`);
  console.log(`  sections:        ${sectionNames.length} parsed (${standardPresent}/${STANDARD_SECTION_COUNT} standard present)`);
  console.log(`  ms/iter:         ${msPerIter.toFixed(4)}`);
  console.log(`  sections/sec:    ${Math.round(sectionsPerSec).toLocaleString()}`);
  console.log(`  errors:          ${errorCount} (should be 0)`);
  console.log(`  heap delta:      ${heapDeltaMB} MB`);
}

console.log('=== Sections Benchmark (all 20 standard sections) ===');

benchmarkFixture('all-20-sections', allSectionsModule, 2000, 500);

console.log('\nDone.');