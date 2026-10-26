---
# MAM Metadata
id: interop-contracts
name: Interop Contracts
version: 1.0.0
type: module

author: MAM Team

description: >
  Documents the invocation contract shared by the Python and TypeScript
  implementations used by the Interop Demo system.

license: MIT

runtime: python

tags:
  - example
  - lir
  - contract
---

# Interop Contracts

The contract is deliberately process-oriented: MAM passes JSON in, receives
JSON out, and never shares runtime objects across languages.

## Purpose

Define the callable shape, data envelope, error behavior, and security
boundaries used by the Interop Demo.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Display name supplied to the system |

## Outputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| score | number | Yes | Final score returned by the TypeScript step |

## Rules

- A declared export receives exactly one positional JSON value.
- Python exports default to `main`; JavaScript and TypeScript exports default to `default`.
- A non-`inputFrom` implementation receives the system inputs object.
- An `inputFrom` implementation receives `{ inputs, upstream }`.
- Return values must be JSON-compatible; `undefined`, functions, symbols,
  `BigInt`, `NaN`, and `Infinity` are rejected.
- stdout and stderr are diagnostics, not the result channel.

## Invocation Contract

```text
MAM inputs
    ->
JSON serialization (validated)
    ->
Language adapter (python or node)
    ->
export(payload) -> JSON value
    ->
normalized LIR result
```

Every invocation returns an auditable record with implementation id, language,
entry, adapter, duration, exit code, timeout state, and error code.

## Failure Modes

- `LIR_DECLARATION_INVALID`: malformed frontmatter declaration.
- `LIR_PATH_ESCAPE`: entry resolves outside the project root.
- `LIR_ENTRY_MISSING`: declared entry does not exist.
- `LIR_PERMISSION_DENIED`: policy does not grant `process:spawn` or a requested
  permission/environment variable.
- `LIR_RUNTIME_MISSING`: interpreter or Node.js runtime is unavailable.
- `LIR_TIMEOUT`: the process exceeded its timeout and was terminated.
- `LIR_OUTPUT_LIMIT`: output exceeded the configured byte cap.
- `LIR_PROTOCOL`: the runner did not emit a valid result marker.
- `LIR_INVOKE_FAILED`: the implementation raised or returned an invalid value.

## Quick Reference

- Python adapter: `runtime/src/lir/adapters/python.ts`
- Node adapter: `runtime/src/lir/adapters/node.ts`
- Registry and policy: `runtime/src/lir/registry.ts`
- Contract types: `runtime/src/lir/types.ts`
