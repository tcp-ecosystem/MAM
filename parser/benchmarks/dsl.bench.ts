/**
 * DSL Benchmark
 *
 * Benchmarks `parseMAM` over full-MAM system documents built from v2 DSL
 * blocks — module/agent/tool/system declarations with edges, formatted like
 * `modules/examples/bug-hunter.mam`. Reports DSL blocks, chars, ms/iter,
 * modules/sec, error count, and heap delta per fixture, with a warmup phase.
 */

import { parseMAM } from '../src/index.js';

// ============================================================================
// Fixture builder (bug-hunter.mam style)
// ============================================================================

function agentBlock(index: number, toolCount: number, agentCount: number): string {
  const toolIndex = index % toolCount;
  const handoff = index + 1 < agentCount ? `    - Agent${index + 1}` : '    - Reporter';
  return [
    `## Agent: Agent${index}`,
    '',
    `module Agent${index}`,
    '',
    'type:',
    '    agent',
    '',
    'role:',
    `    role-${index}`,
    '',
    'goal:',
    `    Goal for agent ${index}`,
    '',
    'memory:',
    '    shared',
    '',
    'tools:',
    `    - Tool${toolIndex}`,
    `    - Tool${(toolIndex + 1) % toolCount}`,
    '',
    'handoff:',
    handoff,
  ].join('\n');
}

function toolBlock(index: number): string {
  return [
    `## Tool: Tool${index}`,
    '',
    `module Tool${index}`,
    '',
    'type:',
    '    tool',
    '',
    'provider:',
    `    provider-${index}`,
    '',
    'permissions:',
    '    network: internet',
    '',
    'capabilities:',
    `    - capability-${index}`,
    `    - capability-${index + 1}`,
  ].join('\n');
}

function memoryBlock(index: number): string {
  return [
    `## Memory: Mem${index}`,
    '',
    `module Mem${index}`,
    '',
    'type:',
    '    memory',
    '',
    'format:',
    '    vector',
    '',
    'backend:',
    '    sqlite',
    '',
    'scope:',
    '    workspace',
    '',
    'ttl:',
    '    24h',
  ].join('\n');
}

function policyBlock(index: number): string {
  return [
    `## Policy: Policy${index}`,
    '',
    `module Policy${index}`,
    '',
    'type:',
    '    policy',
    '',
    'allow:',
    '    - execute',
    '',
    'deny:',
    '    - shell.rm',
    '',
    'permissions:',
    '    filesystem: read',
    '    network: internet',
  ].join('\n');
}

function dslSystemDoc(
  agentCount: number,
  toolCount: number,
  memoryCount: number,
  policyCount: number
): string {
  const modulesList = Array.from(
    { length: agentCount },
    (_, i) => `- Agent${i}`
  ).join('\n');

  const agents = Array.from({ length: agentCount }, (_, i) =>
    agentBlock(i, toolCount, agentCount)
  ).join('\n\n');

  const tools = Array.from({ length: toolCount }, (_, i) =>
    toolBlock(i)
  ).join('\n\n');

  const memories = Array.from({ length: memoryCount }, (_, i) =>
    memoryBlock(i)
  ).join('\n\n');

  const policies = Array.from({ length: policyCount }, (_, i) =>
    policyBlock(i)
  ).join('\n\n');

  const edges = Array.from(
    { length: agentCount },
    (_, i) =>
      i + 1 < agentCount
        ? `    Agent${i} -> Agent${i + 1}`
        : `    Agent${i} -> Reporter`
  ).join('\n');

  const systemAgents = Array.from(
    { length: agentCount },
    (_, i) => `    - Agent${i}`
  ).join('\n');

  const capabilities = Array.from(
    { length: Math.min(4, agentCount) },
    (_, i) =>
      `### cap-${i}\n\nCapability ${i} of the benchmark swarm system.`
  ).join('\n\n');

  const mermaidNodes = Array.from(
    { length: agentCount },
    (_, i) => `    Agent${i} --> ${i + 1 < agentCount ? `Agent${i + 1}` : 'Reporter'}`
  ).join('\n');

  return `---
id: bench-swarm
name: Bench Swarm
version: 2.0.0
type: system
author: LifeJiggy
description: >
  Generated multi-agent system with v2 DSL blocks for benchmarking.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - benchmark
  - multi-agent
capabilities:
  - plan
  - execute
  - report
permissions:
  network:
    - internet
  filesystem:
    - read
---

# Bench Swarm

## Purpose

Generated multi-agent system used to benchmark v2 DSL block parsing.

## Modules

${modulesList}

## Capabilities

${capabilities}

## System Definition

module BenchSwarm

type:
    system

agents:
${systemAgents}

edges:
${edges}

memory:
    shared: Mem0

policy:
    Policy0

## Rules

- Only run authorized workloads.
- Preserve evidence and results.

## Workflow

\`\`\`mermaid
flowchart LR
${mermaidNodes}
\`\`\`

${agents}

${tools}

${memories}

${policies}

## Tests

\`\`\`python
def test_swarm():
    assert True
\`\`\`

## References

- MAM System Examples
- Multi-agent orchestration
`;
}

// ============================================================================
// Benchmark driver
// ============================================================================

function benchmarkFixture(
  name: string,
  text: string,
  dslBlocks: number,
  iterations: number,
  warmup: number
): void {
  for (let i = 0; i < warmup; i++) {
    parseMAM(text, { source: 'dsl.bench.mam' });
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let errorCount = 0;
  for (let i = 0; i < iterations; i++) {
    errorCount = parseMAM(text, { source: 'dsl.bench.mam' }).errors.length;
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const modulesPerSec = msPerIter > 0 ? 1000 / msPerIter : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  console.log(`\n${name}`);
  console.log(`  DSL blocks:    ${dslBlocks} (agents + tools + memories + policies + system)`);
  console.log(`  chars:         ${text.length.toLocaleString()}`);
  console.log(`  ms/iter:       ${msPerIter.toFixed(4)}`);
  console.log(`  modules/sec:   ${modulesPerSec.toFixed(0)}`);
  console.log(`  errors:        ${errorCount} (should be 0)`);
  console.log(`  heap delta:    ${heapDeltaMB} MB`);
}

console.log('=== DSL Benchmark (v2 module/agent/tool/system blocks) ===');

const fixtures = [
  { name: 'dsl-small', counts: [3, 3, 1, 1] as const, iterations: 30 },
  { name: 'dsl-medium', counts: [10, 10, 2, 2] as const, iterations: 15 },
  { name: 'dsl-large', counts: [25, 25, 4, 4] as const, iterations: 8 },
];

for (const fx of fixtures) {
  const text = dslSystemDoc(fx.counts[0], fx.counts[1], fx.counts[2], fx.counts[3]);
  const dslBlocks = fx.counts[0] + fx.counts[1] + fx.counts[2] + fx.counts[3] + 1;
  const warmup = Math.min(500, Math.floor(fx.iterations / 4));
  benchmarkFixture(fx.name, text, dslBlocks, fx.iterations, warmup);
}

console.log('\nDone.');