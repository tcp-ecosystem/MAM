# LIR Phase 0 Audit

> Date: 2026-10-24
> Scope: `plan-doc/Mam-LIR.md` implementation readiness.

## Existing reusable interfaces

- **Parser / AST.** `parser/src/parser/frontmatter.ts` parses frontmatter as
  YAML and preserves arbitrary keys via `[key: string]: unknown`. Nested
  `implementations:` arrays therefore need no grammar change. The AST exposes
  `ast.frontmatter.data`; `parseMAM()` also returns diagnostics.
- **Project composition.** `cli/src/project/` discovers `mam.toml` and loads
  project modules. LIR only needs the nearest project root, not full project
  graph loading, so the CLI reuses a small upward `mam.toml` walk.
- **Runtime v2.** `runtime/src/v2/` provides permissions, sandbox, policy and
  resource-manager concepts. LIR uses the same safety intent but owns its
  process contract because host implementations are per-call subprocesses with
  a JSON protocol, not MAM code blocks.
- **CLI native execution.** `cli/src/commands/run.ts` already routes `.mam`
  files to the native V2 runtime, supports `--format json`, `--dry-run`,
  inputs, timeouts, and a `process.exitCode`-based contract.
- **Workspace conventions.** `runtime/package.json` uses an exports map;
  adding `./lir` keeps LIR inside `@mam/runtime` without a new workspace
  package or lockfile churn.

## How Python execution worked before LIR

`cli/src/commands/run.ts` embeds a harness that extracts `## Python` code
blocks, appends `## Tests` and `## Examples` blocks, writes a temporary
script, injects `INPUTS` as JSON, and captures a JSON payload of known result
variables. This is module-embedded code, not an external implementation file,
so LIR does not reuse the harness. It reuses the operational pattern: temporary
runner, JSON input, structured result, timeout, and visible failure.

## Target-artifact routing

`detectTargetRuntime()` maps compiled artifacts (`.mam.py`, `.mam.js`, `.mam.ts`,
`.mam.go`, `.mam.rs`, `.mam.sh`) to their runtimes. Native `.mam` / `.mam.md`
files take the V2 path. LIR adds a third execution source: declarations inside a
native module that point at external host-language files.

## Gaps found

- No adapter contract or registry for host-language implementations.
- No frontmatter declaration parser or path policy for external entries.
- No permission/environment/timeout/output policy specific to host files.
- No CLI surface for probing, listing, or invoking implementations.
- No integration in `mam run`, no validator rule, no audit records, no docs,
  and no runnable mixed-language example.

## Decisions

1. **Placement:** `runtime/src/lir/`, exported as `@mam/runtime/lir`.
2. **Declaration syntax:** frontmatter `implementations:` list. No new grammar.
3. **Boundary:** subprocess + JSON-in/JSON-out. No cross-language objects.
4. **Python:** `importlib` runner; async callables via `asyncio.run`.
5. **JavaScript/TypeScript:** Node adapter; TS through built-in type stripping
   (Node >= 22.6, default on Node 24). No implicit installs; no `tsx` fallback.
6. **Policy:** language/id allowlists, `process:spawn`, declaration permissions,
   environment allowlist, project-root containment + realpath check, timeouts
   with process-tree termination, output caps, and an audit record per call.
7. **Composition:** declarations run in document order; `inputFrom` supplies
   `{ inputs, upstream }`.
8. **Failure:** every failure is structured and fails `mam run`; no silent
   success and no fallback to a different toolchain.

## Integration points

| Layer | Change |
|-------|--------|
| `runtime/src/lir/` | types, errors, process runner, manifest parser, registry, Python + Node adapters |
| `runtime/src/index.ts`, `runtime/package.json` | public exports and `./lir` subpath |
| `cli/src/commands/lir.ts`, `cli/src/index.ts` | `mam lir probe\|list\|invoke` |
| `cli/src/commands/run.ts` | ordered LIR execution, `inputFrom`, dry-run listing, error aggregation |
| `cli/src/commands/validate.ts` | `LIR001` declaration rule |
| `modules/examples/interop/` | runnable Python → TypeScript example + tests |
| `docs/architecture/LIR.md`, `docs/index.md` | user and operator documentation |

## Verification

- `runtime`: 513/513 tests (20 LIR).
- `cli`: 86/86 tests (4 LIR command, 4 run integration).
- Example: Python 3/3, Node 2/2; both `.mam` files and twins validate 0/0/0
  and run successfully. All examples: 81/81 validate clean, 81/81 run with
  their declared inputs.
- JSON contract: `--format json` stdout parses as JSON; observability remains
  on stderr.
