/**
 * Tables Benchmark
 *
 * Benchmarks `parseMAM` over full-MAM modules with large generated
 * Inputs / Outputs / Permissions tables (50-200 rows each). Reports rows,
 * chars, ms/iter, rows/sec, error count, and heap delta per fixture, with
 * a warmup phase.
 */

import { parseMAM } from '../src/index.js';

// ============================================================================
// Fixture builders
// ============================================================================

function buildTable(sectionName: string, rows: number): string {
  const lines: string[] = [
    `## ${sectionName}`,
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
  ];
  for (let i = 0; i < rows; i++) {
    const req = i % 3 === 0 ? 'Yes' : 'No';
    lines.push(
      `| ${sectionName.toLowerCase()}_${i} | string | ${req} | Synthetic ${sectionName.toLowerCase()} row ${i} for table benchmarking |`
    );
  }
  return lines.join('\n');
}

function tablesModule(
  inputRows: number,
  outputRows: number,
  permissionRows: number
): string {
  const permissionLines = Array.from(
    { length: permissionRows },
    (_, i) =>
      `| scope_${i} | ${i % 2 === 0 ? 'read' : 'write'} | Synthetic permission row ${i} |`
  ).join('\n');

  return `---
id: tables-module
name: Tables Module
version: 2.0.0
type: module
author: LifeJiggy
runtime:
  language: python
  version: ">=3.12"
capabilities:
  - process
permissions:
  network:
    - internet
  filesystem:
    - read
---

# Tables Module

## Purpose

Module with large generated tables for benchmarking.

${buildTable('Inputs', inputRows)}

${buildTable('Outputs', outputRows)}

## Permissions

| Scope | Action | Description |
|-------|--------|-------------|
${permissionLines}
`;
}

// ============================================================================
// Benchmark driver
// ============================================================================

function benchmarkFixture(
  name: string,
  text: string,
  rowCount: number,
  iterations: number,
  warmup: number
): void {
  for (let i = 0; i < warmup; i++) {
    parseMAM(text, { source: 'tables.bench.mam' });
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let errorCount = 0;
  for (let i = 0; i < iterations; i++) {
    errorCount = parseMAM(text, { source: 'tables.bench.mam' }).errors.length;
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const rowsPerSec = msPerIter > 0 ? rowCount / (msPerIter / 1000) : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  console.log(`\n${name}`);
  console.log(`  table rows:  ${rowCount.toLocaleString()} (inputs + outputs + permissions)`);
  console.log(`  chars:       ${text.length.toLocaleString()}`);
  console.log(`  ms/iter:     ${msPerIter.toFixed(4)}`);
  console.log(`  rows/sec:    ${Math.round(rowsPerSec).toLocaleString()}`);
  console.log(`  errors:      ${errorCount} (should be 0)`);
  console.log(`  heap delta:  ${heapDeltaMB} MB`);
}

console.log('=== Tables Benchmark (large generated tables) ===');

const fixtures = [
  { name: 'tables-50', rows: [50, 40, 30] as const, iterations: 1200 },
  { name: 'tables-100', rows: [100, 80, 60] as const, iterations: 600 },
  { name: 'tables-200', rows: [200, 150, 120] as const, iterations: 200 },
];

for (const fx of fixtures) {
  const text = tablesModule(fx.rows[0], fx.rows[1], fx.rows[2]);
  const totalRows = fx.rows[0] + fx.rows[1] + fx.rows[2];
  const warmup = Math.min(400, Math.floor(fx.iterations / 4));
  benchmarkFixture(fx.name, text, totalRows, fx.iterations, warmup);
}

console.log('\nDone.');