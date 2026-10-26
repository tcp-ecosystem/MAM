---
# MAM Metadata
id: interop-demo
name: Interop Demo
version: 1.0.0
type: system

author: MAM Team

description: >
  A production-shaped example that keeps MAM as the system description and
  delegates two capabilities to ordinary Python and TypeScript files.

license: MIT

runtime:
  language: python
  version: ">=3.10"

tags:
  - example
  - lir
  - interoperability
  - python
  - typescript

implementations:
  - id: normalize
    language: python
    entry: src/normalize.py
    export: normalize
    description: Trim and lowercase a display name.

  - id: score
    language: typescript
    entry: src/score.ts
    export: score
    inputFrom: normalize
    description: Score the normalized name using the Python result.
---

# Interop Demo

This system shows how a `.mam` description orchestrates independently authored
Python and TypeScript implementations without compiling the MAM module into
either language.

## Purpose

Normalize a human name with Python, then score the normalized result with
TypeScript. The two implementations exchange JSON through the Language
Interoperability Runtime (LIR).

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Display name to normalize and score |

## Outputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| score | number | Yes | Length-based score produced by TypeScript |
| label | string | Yes | Uppercase display label |
| tokenCount | number | Yes | Number of normalized name tokens |

## Rules

- Both implementations are required; a failure must fail the run.
- Python receives the system inputs directly.
- TypeScript receives `{ inputs, upstream }`, where `upstream` is the Python result.
- Implementations return JSON-compatible values only.
- Implementation stdout and stderr are captured separately from the result.

## Composition

The declarations run in document order:

1. `normalize` (Python) trims and lowercases `name`.
2. `score` (TypeScript) reads `upstream.name`, `upstream.length`, and
   `upstream.tokens`, then returns the final score.

`inputFrom: normalize` is what makes the TypeScript call a composition step
rather than an independent invocation.

## Failure Modes

- Missing Python or Node runtime: the run fails with `LIR_RUNTIME_MISSING`.
- Missing entry file: the run fails with `LIR_ENTRY_MISSING`.
- Implementation exception: the run fails with `LIR_INVOKE_FAILED` and includes
  the exception message.
- Timeout: the run fails with `LIR_TIMEOUT`.
- Non-JSON return value: the run fails with `LIR_INVOKE_FAILED` and a
  serialization diagnostic.
- Upstream failure: dependent implementations are skipped and reported.

## Quick Reference

```text
mam lir probe
mam lir list system.mam
mam lir invoke system.mam normalize --input "@input.json"
mam run system.mam --inputs "@input.json" --format json
```

Expected final values: `score: 122`, `label: "ADA LOVELACE (12)"`,
`tokenCount: 2`.
