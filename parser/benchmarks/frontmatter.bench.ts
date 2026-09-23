/**
 * Front Matter Benchmark
 *
 * Benchmarks `parseMAM` over full-MAM modules whose cost is dominated by
 * rich front matter: structured runtime object, type, capabilities,
 * structured permissions object, dependencies ({name, version}), and
 * inputs/outputs arrays. Reports chars, ms/iter, front matter throughput,
 * error count, and heap delta per fixture, with a warmup phase.
 */

import { parseMAM } from '../src/index.js';

// ============================================================================
// Fixture builders
// ============================================================================

interface FrontMatterSummary {
  deps: number;
  caps: number;
  permissionScopes: number;
  inputs: number;
  outputs: number;
}

function frontMatterModule(
  id: string,
  depCount: number,
  capCount: number,
  permissionScopes: number,
  inputCount: number,
  outputCount: number
): { text: string; summary: FrontMatterSummary } {
  const deps = Array.from(
    { length: depCount },
    (_, i) => `  - name: dep-${i}\n    version: "^${i % 5}.${i % 9}"`
  ).join('\n');

  const caps = Array.from(
    { length: capCount },
    (_, i) => `  - capability-${i}`
  ).join('\n');

  const scopeActions = ['internet', 'read', 'write', 'sandbox', 'execute'];
  const permissions = Array.from({ length: permissionScopes }, (_, i) => {
    const action = scopeActions[i % scopeActions.length]!;
    return `  scope-${i}:\n    - ${action}\n    - ${scopeActions[(i + 1) % scopeActions.length]}`;
  }).join('\n');

  const inputs = Array.from(
    { length: inputCount },
    (_, i) => `  - input-${i}`
  ).join('\n');
  const outputs = Array.from(
    { length: outputCount },
    (_, i) => `  - output-${i}`
  ).join('\n');

  const text = `---
id: ${id}
name: Front Matter Benchmark
version: 2.0.0
type: module
author: LifeJiggy
runtime:
  language: python
  version: ">=3.12"
tags:
  - benchmark
  - frontmatter
dependencies:
${deps}
capabilities:
${caps}
permissions:
${permissions}
inputs:
${inputs}
outputs:
${outputs}
---

# Front Matter Benchmark

## Purpose

Module whose front matter dominates parsing cost.

## Capabilities

### primary

Primary capability exercised by this module.

## Inputs

${inputs}

## Outputs

${outputs}
`;

  return {
    text,
    summary: {
      deps: depCount,
      caps: capCount,
      permissionScopes,
      inputs: inputCount,
      outputs: outputCount,
    },
  };
}

// ============================================================================
// Benchmark driver
// ============================================================================

function benchmarkFixture(
  name: string,
  text: string,
  summary: FrontMatterSummary,
  iterations: number,
  warmup: number
): void {
  const probe = parseMAM(text, { source: 'frontmatter.bench.mam' });
  const runtime = probe.ast.frontmatter?.data.runtime as
    | unknown
    | undefined;
  const runtimeObj =
    runtime !== undefined &&
    typeof runtime === 'object' &&
    runtime !== null &&
    !Array.isArray(runtime)
      ? (runtime as Record<string, unknown>)
      : null;
  const runtimeOk =
    runtimeObj !== null && String(runtimeObj.language ?? '') === 'python';

  for (let i = 0; i < warmup; i++) {
    parseMAM(text, { source: 'frontmatter.bench.mam' });
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let errorCount = 0;
  for (let i = 0; i < iterations; i++) {
    errorCount = parseMAM(text, { source: 'frontmatter.bench.mam' }).errors.length;
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const perSec = msPerIter > 0 ? 1000 / msPerIter : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  console.log(`\n${name}`);
  console.log(`  chars:               ${text.length.toLocaleString()}`);
  console.log(`  frontmatter:         deps=${summary.deps} caps=${summary.caps} scopes=${summary.permissionScopes} inputs=${summary.inputs} outputs=${summary.outputs}`);
  console.log(`  runtime object:      ${runtimeOk ? 'ok' : 'FAILED'}`);
  console.log(`  ms/iter:             ${msPerIter.toFixed(4)}`);
  console.log(`  frontmatter/sec:     ${perSec.toFixed(0)}`);
  console.log(`  errors:              ${errorCount} (should be 0)`);
  console.log(`  heap delta:          ${heapDeltaMB} MB`);
}

console.log('=== Front Matter Benchmark (full-MAM modules) ===');

const small = frontMatterModule('fm-small', 6, 4, 3, 8, 8);
const medium = frontMatterModule('fm-medium', 30, 15, 6, 40, 40);
const large = frontMatterModule('fm-large', 120, 60, 12, 200, 200);

const fixtures = [
  { name: 'small', ...small, iterations: 1500 },
  { name: 'medium', ...medium, iterations: 800 },
  { name: 'large', ...large, iterations: 150 },
];

for (const fx of fixtures) {
  const warmup = Math.min(500, Math.floor(fx.iterations / 4));
  benchmarkFixture(fx.name, fx.text, fx.summary, fx.iterations, warmup);
}

console.log('\nDone.');