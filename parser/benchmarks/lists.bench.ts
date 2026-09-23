/**
 * Lists Benchmark
 *
 * Benchmarks `parseMAM` over full-MAM modules with large generated
 * Rules / Capabilities / References lists (100-500 items). Reports items,
 * chars, ms/iter, items/sec, error count, and heap delta per fixture, with
 * a warmup phase.
 */

import { parseMAM } from '../src/index.js';

// ============================================================================
// Fixture builders
// ============================================================================

function listsModule(
  ruleCount: number,
  capabilityCount: number,
  referenceCount: number
): string {
  const rules = Array.from(
    { length: ruleCount },
    (_, i) => `- Synthetic rule ${i}: always validate the input before proceeding.`
  ).join('\n');

  const capabilities = Array.from(
    { length: capabilityCount },
    (_, i) =>
      `### capability-${i}\n\nPerform the ${i}th synthetic capability operation.`
  ).join('\n\n');

  const references = Array.from(
    { length: referenceCount },
    (_, i) => `- Reference document ${i} for the MAM lists benchmark.`
  ).join('\n');

  return `---
id: lists-module
name: Lists Module
version: 2.0.0
type: module
author: LifeJiggy
runtime:
  language: python
  version: ">=3.12"
capabilities:
  - process
permissions:
  filesystem:
    - read
---

# Lists Module

## Purpose

Module with large generated lists for benchmarking.

## Rules

${rules}

## Capabilities

${capabilities}

## References

${references}
`;
}

// ============================================================================
// Benchmark driver
// ============================================================================

function benchmarkFixture(
  name: string,
  text: string,
  itemCount: number,
  iterations: number,
  warmup: number
): void {
  for (let i = 0; i < warmup; i++) {
    parseMAM(text, { source: 'lists.bench.mam' });
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let errorCount = 0;
  for (let i = 0; i < iterations; i++) {
    errorCount = parseMAM(text, { source: 'lists.bench.mam' }).errors.length;
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const itemsPerSec = msPerIter > 0 ? itemCount / (msPerIter / 1000) : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  console.log(`\n${name}`);
  console.log(`  list items:  ${itemCount.toLocaleString()} (rules + capabilities + references)`);
  console.log(`  chars:       ${text.length.toLocaleString()}`);
  console.log(`  ms/iter:     ${msPerIter.toFixed(4)}`);
  console.log(`  items/sec:   ${Math.round(itemsPerSec).toLocaleString()}`);
  console.log(`  errors:      ${errorCount} (should be 0)`);
  console.log(`  heap delta:  ${heapDeltaMB} MB`);
}

console.log('=== Lists Benchmark (large generated lists) ===');

const fixtures = [
  { name: 'lists-100', counts: [100, 60, 50] as const, iterations: 800 },
  { name: 'lists-250', counts: [250, 150, 100] as const, iterations: 200 },
  { name: 'lists-500', counts: [500, 250, 200] as const, iterations: 50 },
];

for (const fx of fixtures) {
  const text = listsModule(fx.counts[0], fx.counts[1], fx.counts[2]);
  const totalItems = fx.counts[0] + fx.counts[1] + fx.counts[2];
  const warmup = Math.min(400, Math.floor(fx.iterations / 4));
  benchmarkFixture(fx.name, text, totalItems, fx.iterations, warmup);
}

console.log('\nDone.');