/**
 * Lexer Benchmark
 *
 * Benchmarks the MAM tokenizer (`tokenize`) over full-MAM fixtures:
 * minimal, standard, workflow-with-mermaid, multi-agent DSL system, and
 * large generated tables. Reports chars, tokens, ms/iter, tokens/sec, and
 * heap delta per fixture, with a warmup phase.
 */

import { tokenize } from '../src/lexer/index.js';

// ============================================================================
// Helpers
// ============================================================================

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function benchmarkFixture(
  name: string,
  text: string,
  iterations: number,
  warmup: number
): void {
  const totalTokens = tokenize(text).stats.totalTokens;

  for (let i = 0; i < warmup; i++) {
    tokenize(text);
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    tokenize(text);
  }
  const elapsedMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  const msPerIter = elapsedMs / iterations;
  const tokensPerSec = msPerIter > 0 ? totalTokens / (msPerIter / 1000) : 0;
  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

  console.log(`\n${name}`);
  console.log(`  chars:      ${text.length.toLocaleString()}`);
  console.log(`  tokens:     ${totalTokens.toLocaleString()}`);
  console.log(`  ms/iter:    ${msPerIter.toFixed(4)}`);
  console.log(`  tokens/sec: ${Math.round(tokensPerSec).toLocaleString()}`);
  console.log(`  heap delta: ${heapDeltaMB} MB`);
}

// ============================================================================
// Full-MAM fixtures
// ============================================================================

const minimalModule = `---
id: minimal-module
name: Minimal Module
version: 2.0.0
type: module
author: LifeJiggy
runtime:
  language: python
  version: ">=3.12"
tags:
  - minimal
capabilities:
  - process
permissions:
  filesystem:
    - read
---

# Minimal Module

## Purpose

A minimal full-MAM module used for benchmarking.

## Capabilities

### process

Process a single item and return a result.

## Rules

- Keep it minimal.
`;

const standardModule = `---
id: benchmark-module
name: Benchmark Module
version: 2.0.0
type: module
author: LifeJiggy
description: >
  A standard full-MAM module exercising structured front matter, capabilities,
  dependencies, and permissions for parser benchmarking.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - benchmark
  - performance
  - full-mam
dependencies:
  - name: http-client
    version: "^1.2"
  - name: json-utils
    version: "~2.4"
capabilities:
  - analyze
  - transform
  - report
permissions:
  network:
    - internet
  filesystem:
    - read
    - write
  python:
    - sandbox
---

# Benchmark Module

## Purpose

Benchmark the full-MAM parsing pipeline on a standard module.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | string | Yes | Input data to process |
| config | object | No | Processing options |
| depth | int | No | Recursion depth |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | dict | Processed result |
| meta | dict | Processing metadata |

## Capabilities

### analyze

Inspect the input data and extract structure.

### transform

Apply transformations to normalized data.

### report

Emit a human-readable report.

## Rules

- Validate all inputs before processing.
- Handle errors gracefully.
- Never log secrets.

## Workflow

\`\`\`mermaid
flowchart TD
    A[Input] --> B[Analyze]
    B --> C[Transform]
    C --> D[Report]
\`\`\`

## Python

\`\`\`python
def process(data: str, config: dict = None) -> dict:
    return {"result": data, "meta": {"config": config}}
\`\`\`

## Tests

\`\`\`python
def test_process():
    assert process("test")["result"] == "test"
\`\`\`

## References

- MAM Benchmark Suite
- Full-MAM specification
`;

const workflowModule = `---
id: workflow-module
name: Workflow Pipeline
version: 2.0.0
type: workflow
author: LifeJiggy
runtime:
  language: python
  version: ">=3.11"
capabilities:
  - orchestrate
permissions:
  network:
    - internet
---

# Workflow Pipeline

## Purpose

An orchestration workflow module with large mermaid diagrams.

## Inputs

- job_spec

## Outputs

- job_result

## Workflow

\`\`\`mermaid
flowchart TD
    A[Start] --> B{Fetch}
    B -->|ok| C[Parse]
    B -->|err| Z[Retry]
    C --> D[Transform]
    D --> E{Validate}
    E -->|pass| F[Emit]
    E -->|fail| G[Log]
    G --> Z
    Z --> B
    F --> H[End]
\`\`\`

## Mermaid

\`\`\`mermaid
sequenceDiagram
    participant A as Orchestrator
    participant B as Worker
    A->>B: dispatch(job)
    B-->>A: ack
    A->>B: poll
    B-->>A: result
\`\`\`

## Rules

- Retry at most three times.
- Preserve ordering across stages.

## Python

\`\`\`python
def run(spec: dict) -> dict:
    return {"status": "ok", "result": spec}
\`\`\`

## Tests

\`\`\`python
def test_run():
    assert run({})["status"] == "ok"
\`\`\`
`;

const dslSystemModule = `---
id: bench-swarm
name: Bench Swarm System
version: 2.0.0
type: system
author: LifeJiggy
description: >
  Multi-agent benchmarking system built from v2 DSL blocks: agents, tools,
  memories, policies, and a system module with edges.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - benchmark
  - multi-agent
dependencies:
  - name: planner-core
    version: "^1.0"
  - name: executor-core
    version: "^1.0"
capabilities:
  - plan
  - execute
  - report
permissions:
  network:
    - internet
  filesystem:
    - read
  python:
    - sandbox
---

# Bench Swarm System

## Purpose

Multi-agent system that plans, executes, and reports benchmark workloads.

## Modules

- Planner
- Executor
- Reporter

## Capabilities

### plan

Create the execution strategy for a benchmark run.

### execute

Run the benchmark workloads across agents.

### report

Emit the benchmark results.

## System Definition

module BenchSwarm

type:
    system

agents:
    - Planner
    - Executor
    - Reporter

edges:
    Planner -> Executor
    Executor -> Reporter

memory:
    shared: SharedMemory

policy:
    SafeExecution

## Rules

- Only run authorized workloads.
- Preserve evidence and results.
- Validate output before reporting.

## Workflow

\`\`\`mermaid
flowchart LR
    Planner --> Executor
    Executor --> Reporter
\`\`\`

## Agent: Planner

module Planner

type:
    agent

role:
    Planning

goal:
    Create the benchmark execution strategy

memory:
    shared

tools:
    - PlannerTool

handoff:
    - Executor

## Agent: Executor

module Executor

type:
    agent

role:
    Execution

goal:
    Execute benchmark workloads

memory:
    shared

tools:
    - Python
    - Search

handoff:
    - Reporter

## Agent: Reporter

module Reporter

type:
    agent

role:
    Reporting

goal:
    Report benchmark results

memory:
    shared

tools:
    - Python

## Tool: PlannerTool

module PlannerTool

type:
    tool

provider:
    planner

capabilities:
    - plan
    - schedule

## Tool: Python

module PythonRuntime

type:
    tool

provider:
    python

permissions:
    python: sandbox

capabilities:
    - execute
    - analyze

## Tool: Search

module SearchTool

type:
    tool

provider:
    search-api

permissions:
    network: internet

capabilities:
    - search
    - crawl

## Memory: SharedMemory

module SharedMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

ttl:
    24h

## Policy: SafeExecution

module SafeExecution

type:
    policy

allow:
    - python
    - search

deny:
    - shell.rm
    - network.internal

permissions:
    filesystem: read
    network: internet
    python: sandbox

## Tests

\`\`\`python
def test_swarm():
    assert True
\`\`\`

## Examples

\`\`\`text
BenchSwarm.run(target="bench")
\`\`\`

## References

- MAM System Examples
- Multi-agent orchestration
`;

function buildTable(
  sectionName: string,
  rows: number,
  requiredColumn: boolean
): string {
  const lines: string[] = [
    `## ${sectionName}`,
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
  ];
  for (let i = 0; i < rows; i++) {
    const req = requiredColumn ? (i % 3 === 0 ? 'Yes' : 'No') : '';
    lines.push(
      `| ${sectionName.toLowerCase()}_${i} | string | ${req} | Synthetic ${sectionName.toLowerCase()} row ${i} for table benchmarking |`
    );
  }
  return lines.join('\n');
}

function largeTablesModule(
  inputRows: number,
  outputRows: number,
  permissionRows: number
): string {
  const rules = Array.from(
    { length: 100 },
    (_, i) => `- Synthetic rule ${i}: validate all inputs before proceeding.`
  ).join('\n');

  return `---
id: large-tables
name: Large Tables Module
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

# Large Tables Module

## Purpose

Module with large generated tables for benchmarking.

${buildTable('Inputs', inputRows, true)}

${buildTable('Outputs', outputRows, false)}

## Permissions

| Scope | Action | Description |
|-------|--------|-------------|
${Array.from(
  { length: permissionRows },
  (_, i) =>
    `| scope_${i} | ${i % 2 === 0 ? 'read' : 'write'} | Synthetic permission ${i} |`
).join('\n')}

## Rules

${rules}
`;
}

// ============================================================================
// Benchmark driver
// ============================================================================

console.log('=== Lexer Benchmark (full-MAM fixtures) ===');

const fixtures = [
  { name: 'minimal', text: minimalModule, iterations: 3000 },
  { name: 'standard', text: standardModule, iterations: 2000 },
  { name: 'workflow-mermaid', text: workflowModule, iterations: 2000 },
  { name: 'multi-agent-dsl', text: dslSystemModule, iterations: 1000 },
  {
    name: 'large-tables',
    text: largeTablesModule(150, 120, 80),
    iterations: 200,
  },
];

for (const fx of fixtures) {
  const warmup = Math.min(1000, Math.floor(fx.iterations / 4));
  benchmarkFixture(fx.name, fx.text, fx.iterations, warmup);
}

console.log('\nDone.');