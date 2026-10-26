# MAM Current State

> **Last Updated: 2026-10-24**
>
> Totals in this document were verified by running the suites on 2026-10-07.
> Earlier "7,000+ tests / 58 packages / 45 commands" figures were carried over
> from earlier drafts and never re-measured; see the corrected totals below.

---

## Overview

MAM (Machine Agent Modules) is a System Description Language (SDL) whose reference syntax is Markdown. It describes intelligent systems — agents, tools, workflows, teams, policies — and compiles them to 16 target languages.

**Status: Launched.** All packages build, **4,039 tests pass** across 30 packages, full pipeline works end-to-end. V2 Runtime: 100% complete (22/22 engines). `.mam` executes standalone. **MAM Hub registry is live publicly** with 20 founding modules (see [achievement.md](achievement.md)). All 30 publishable packages are at **2.0.0**, matching `MAM_VERSION`.

---

## Recent Changes (2026-10-24)

- **Language Interoperability Runtime (LIR) implemented.** `@mam/runtime/lir`
  lets a `.mam` system orchestrate ordinary Python, JavaScript and TypeScript
  files without compiling the module. Implementations are declared under
  `implementations:` in frontmatter; the registry enforces language/id
  allowlists, `process:spawn`, declaration permissions and environment names,
  project-root path containment (including symlink resolution), filtered child
  environments, timeouts with process-tree termination, output caps, and an
  audit record per invocation. Python uses `importlib`; TypeScript uses Node
  built-in type stripping (Node >= 22.6, default in Node 24) with no implicit
  package installs. `mam lir probe|list|invoke` and `mam run` are wired;
  `mam run` composes declarations in order and supports `inputFrom` envelopes.
  New `LIR001` validator rule; docs in `docs/architecture/LIR.md`; runnable example in
  `modules/examples/interop/` (Python → TypeScript, 0/0/0 validation, tests).
  Suites: **runtime 513/513** (20 LIR), **cli 86/86** (4 LIR command, 4 run
  integration), example Python 3/3 and Node 2/2.
- **Examples are now exactly `advanced/`-shaped.** Removed 24 stale `.mam.md`
  duplicates (14 root-level per-folder copies and 10 loose root files whose real
  sources already live in `scenarios/modules/`) plus the checked-in
  `.mam-cache/`. Twin audit: every `.mam` under `modules/examples/` has a
  byte-identical `.mam.md`; layout audit: 26/26 folders carry `system.mam` +
  twin, `mam.toml`, `README.md` and `modules/`. Verified **81/81 validate clean**
  and **81/81 `mam run` pass** (the interop example uses its sample
  `input.json`).
- **CLI templates contain real modules.** `cli/src/templates/examples/`
  (`auth`, `memory`, `planner`) now hold production content instead of 0-byte
  files, each with a byte-identical `.mam` twin: password hashing + HMAC tokens,
  a TTL session store with eviction and blocked keys, and a dependency planner
  with topological order, parallel waves and critical path. All three validate
  0/0/0 and pass their 30 tests.
- **`mam init` ships five templates, loaded from disk.** `cli/src/templates/init/`
  contains `basic`, `advanced`, `workflow`, `agent` and `service` as canonical
  `.mam.md`, replacing the inline placeholder strings in `init.ts`. `init` writes
  both `<name>.mam` and `<name>.mam.md`; `mam init --project` does the same under
  `modules/`. A `copy-templates.mjs` build step keeps `dist/` and `src/` in sync.
  Every generated module validates 0/0/0 and runs (45 template tests).
- Suite status: **cli 86/86**, **17 init tests**, **runtime 513/513**, examples 81/81 validate + run.

## Recent Changes (2026-10-23)

- **`mam run` executes behaviour.** Modules with a `## Python` section run that
  implementation plus the demo calls from `## Examples` (Python 3.12+, sandboxed
  temp file, `INPUTS` injected). Output now carries an `execution` block with
  `status`, `stdout`, `result`, `variables` and `durationMs`; execution errors
  fail the run instead of being hidden. Verified on all 7 `advanced/` modules —
  each returns real results (e.g. knowledge-graph → `entity_count: 1`).
- **Validator reports root causes, not cascades.** An empty `.mam` now produces
  exactly one error (`FM001`) instead of six; frontmatter, section, link, code
  and parse diagnostics are suppressed when the frontmatter itself is missing.
- **Examples follow one layout.** Every folder under `modules/examples/` now
  matches `advanced/`: `system.mam` + `system.mam.md`, `mam.toml`, `README.md`,
  and `modules/` with byte-identical `.mam`/`.mam.md` pairs. Loose top-level
  examples moved to `scenarios/`. Counts: 25 folders, 79 `.mam` files, **79/79
  validate clean (0 errors, 0 warnings, 0 info)** and **79/79 `mam run` pass**.
- **Fence-aware CLI rules.** `CB001` accepts `text`, `GEN002` ignores code
  fences (PEP8 blank lines survive), `GEN004` skips fenced code, and link /
  section parsing ignores fenced content (`d[key](value)` is not a Markdown
  link, embedded `## headings` are not module sections).
- **VS Code extension v2.0.1.** Fenced blocks (`yaml`, `python`, `mermaid`,
  `json`, `bash`, `powershell`, `typescript`, `sql`, `html`, `diff`, markdown)
  delegate to embedded grammars like a normal Markdown file; packaged as
  `desktop-extension/vscode/mam-language-2.0.1.vsix`.
- **Transformer fixes.** Agent declarations are read from frontmatter or
  `## Agent Definition` blocks; Mermaid is parsed from the `## Workflow` fence
  (all nodes per line, edges resolved after the id map); workflow steps, agent
  role/goal/tools and memory now survive into the V2 graph.

Suite status after these changes: **cli 58/59** (one `npm pack` test is a
network/parallel-load flake that passes 7/7 alone), **compiler 74/74**,
**runtime 493/493**, examples 79/79 run + validate clean.

---

## Build Status

| Package | Status | Build | Tests |
|---------|--------|-------|-------|
| spec/ | ✅ | N/A | N/A |
| parser/ | ✅ | Clean | Passing |
| ast/ | ✅ | Clean | Passing |
| compiler/ | ✅ | Clean | Passing |
| validator/ | ✅ | Clean | Passing |
| runtime/ | ✅ | Clean | Passing |
| cli/ | ✅ | Clean | Passing |
| plugins/ | ✅ | Clean | Passing |
| lsp/ | ✅ | Clean | Passing |
| package-manager/ | ✅ | Clean | Passing |
| registry/api/ | ✅ | Clean | 123 tests (contract + SDL validity + resolvers) |
| registry/server/ | ✅ | Clean | 400 tests (handlers, HTTP, GraphQL, e2e) |
| registry/client/ | ✅ | Clean | 131 tests (auth, retry, hydration) |
| testing/ | ✅ | Clean | Passing |
| visualization/ | ✅ | Clean | Passing |
| reference/ | ✅ | Clean | Passing |
| sdk/python/ | ✅ | Clean | Passing |
| sdk/javascript/ | ✅ | Clean | Passing |
| sdk/rust/ | ✅ | Clean | N/A |
| sdk/go/ | ✅ | Clean | Passing |

**31 leaf workspace packages (30 publishable + 1 private) build successfully. 4,039 tests pass. MAM Hub is live with 20 modules.**

---

## Compilation Pipeline

The full `.mam.md → .mam.<target>` pipeline works:

```
.mam.md → Parser → AST (MAMModule) → Transformer → V2ModuleNode → Compiler → .mam.{target}
```

### Components

1. **Parser** (`parser/src/`): Tokenizes and parses `.mam.md` files into `MAMModule` AST
   - Frontmatter (YAML) → metadata, rules
   - Sections → content blocks
   - Tables, lists, code blocks supported
   - ✅ Fixed: standalone hyphens in prose (`a - b`, `value -5`) no longer
     raise `UNEXPECTED_CHARACTER`; a line containing only `-` no longer hangs
     the tokenizer. Regression coverage in
     `parser/tests/lexer/hyphen-regression.test.ts`.

2. **Transformer** (`compiler/src/transformer.ts`): Converts `MAMModule → V2ModuleNode`
   - Infers module type from sections (role+goal → agent, provider → tool, etc.)
   - Extracts type-specific fields (agent, tool, memory, workflow, team, policy, system)
   - Parses table sections (inputs, outputs, permissions)
   - Rules → `documentation` field
   - Prompt section → appended to `documentation`

3. **Compiler** (`compiler/src/`): Generates target code from `V2ModuleNode`
   - 16 target backends
   - Type-specific dispatch (agent, tool, etc.)

4. **CLI** (`cli/src/commands/compile.ts`): User-facing compile command
   - `mam compile <file> --target <target> -o <dir>`
   - Output naming: `basename(filePath, '.md') + '.' + ext`

### Full MAM Spec Support (plan-doc/full-mam.md)

The parser and transformer support the canonical MAM specification:

| Feature | Support |
|---------|---------|
| Structured runtime (`runtime: {language, version}`) | ✅ Parsed + validated |
| Structured permissions (`permissions: {network: [internet], ...}`) | ✅ Mapped to `V2PermissionSet` |
| Dependency version constraints (`{name, version}`) | ✅ `requires` (string) + `dependencies` (`V2DependencyDefinition[]`) |
| Front-matter `capabilities` + `## Capabilities` (`### name`) | ✅ Merged into module capabilities |
| Structured front-matter `inputs`/`outputs` | ✅ Mapped to `V2PortDefinition[]` |
| `## Exports` section | ✅ Mapped to `V2ExportDefinition[]` |
| `## Prompt` section | ✅ Mapped to `prompts[]` |
| `## Modules` (system composition) | ✅ Mapped to `modules[]` |
| Top-level `version`, `author`, `license`, `keywords` | ✅ Set on node |
| Canonical metadata fields (`type`, `license`, `description`) | ✅ |
| `runtime: python >=3.12` shorthand | ✅ Still supported |

Canonical modules ship in **both** `.mam` (canonical) and `.mam.md` (source)
form with identical content:

- **Examples** (`modules/examples/`): one runnable example per type
  (`agent`, `component`, `contract`, `documentation`, `extension`, `interface`,
  `memory`, `module`, `package`, `plugin`, `policy`, `repository`, `resource`,
  `runtime`, `service`, `system`, `team`, `tool`, `workflow`), plus complete
  projects `core`, `basic`, `advanced`, `plugins`, `security-system` and
  `scenarios`. Every folder follows the `advanced/` layout: a composing
  `system.mam` at the root and `.mam`/`.mam.md` pairs in `modules/`.
- **Templates** (`modules/templates/`): 19 type folders (basic + advanced)

### Project Composition (`mam.toml`)

Multi-file projects compose modules into a system (full-mam §19). A project is
described by `mam.toml`. The project-aware commands are first-class `mam`
commands: when run inside a directory containing `mam.toml` (and no explicit
file argument), they operate on the whole project.

```toml
[project]
name = "security-system"
version = "2.0.0"

[build]
entry = "system.mam"
modules = ["modules/**/*.mam", "modules/**/*.mam.md"]
outDir = "dist"
targets = ["python"]
```

| Command | File mode | Project mode (inside a `mam.toml` project) |
|---------|-----------|---------------------------------------------|
| `mam init` | `mam init <name>` creates a module | `mam init` scaffolds `mam.toml`, `modules/`, `system.mam` |
| `mam build [file]` | Builds one module | Compiles all modules + entry to targets |
| `mam run [file]` | Runs one module natively | Runs the project entry system natively |
| `mam validate [file]` | Validates one module | Validates all modules (dupes, cycles, missing deps) |
| `mam graph` | Directory scan | Project dependency graph (text/json/mermaid) |
| `mam test [file]` | Tests one module | Tests all project modules |
| `mam info [file]` | Module summary | Project summary (entry, targets, modules) |
| `mam new <type> <name>` | — | Scaffolds a module from a template (`.mam` + `.mam.md`) |

Supporting library: `cli/src/project/` (TOML parser, manifest, loader, graph).
Sample project: `modules/examples/security-system/`.



### All 16 Targets

| Target | Extension | Status |
|--------|-----------|--------|
| python | .py | ✅ |
| javascript | .js | ✅ |
| go | .go | ✅ |
| rust | .rs | ✅ |
| csharp | .cs | ✅ |
| java | .java | ✅ |
| wasm | .wasm | ✅ |
| kubernetes | .yaml | ✅ |
| terraform | .tf | ✅ |
| docker | Dockerfile | ✅ |
| openai | .json | ✅ |
| langgraph | .py | ✅ |
| crewai | .py | ✅ |
| gemini | .py | ✅ |
| autogen | .py | ✅ |
| claude | .ts | ✅ |

### Verified Pipeline Results

| Fixture | Type | Outputs Generated |
|---------|------|-------------------|
| minimal.mam.md | module | 16 files ✅ |
| basic.mam.md | module | 16 files ✅ |
| full.mam.md | module | 16 files ✅ |
| agent.mam.md | agent | 16 files ✅ |
| tool.mam.md | tool | 16 files ✅ |

**Total: 80 output files (5 fixtures × 16 targets)**

---

## Test Coverage

| Area | Files | Tests |
|------|-------|-------|
| Parser | 5 | Passing |
| AST | 5 | Passing |
| Compiler | 3 | Passing |
| Validator | 12 | Passing |
| Runtime | 6 | Passing |
| CLI | 3 | Passing |
| Plugins | 13 | Passing |
| LSP | 2 | Passing |
| Package Manager | 4 | Passing |
| Registry | 11 | Passing (400 server + 123 api + 131 client + 11 e2e) |
| Testing | 2 | Passing |
| Visualization | 6 | Passing |
| Reference | 6 | Passing |
| SDKs | 20 | Passing |
| E2E | 1 | 65 tests ✅ |
| **Total** | — | **4,039 tests passing (30 packages)** |

---

## V2 Runtime (Next-Gen) Implementation

The V2 runtime implements the next-generation native execution engine for `.mam` files.

| Engine | File | Lines | Description |
|--------|------|-------|-------------|
| Core Runtime | `v2/runtime.ts` | 410 | Orchestrator with topological sort, type-based dispatch |
| Context Engine | `v2/context-engine.ts` | 464 | Priority-based assembly, caching, deduplication, compression |
| Events | `v2/events.ts` | 472 | Middleware, batching, replay, wildcard support |
| Knowledge/RAG | `v2/knowledge-engine.ts` | 658 | TF-IDF, cosine similarity, hybrid retrieval |
| Memory Engine | `v2/memory-engine.ts` | 529 | Search, consolidation, indexing |
| Memory Store | `v2/memory.ts` | 572 | TTL, LRU eviction, pressure monitoring, snapshots |
| Model Engine | `v2/model-engine.ts` | 539 | Fallback, retry, rate limiting, health checks |
| Permissions | `v2/permissions.ts` | 559 | Glob matching, inheritance, audit logging |
| Plugins | `v2/plugins.ts` | 687 | Lifecycle, hot reload, dependency resolution |
| Security | `v2/security.ts` | 841 | Secret detection, anomaly detection, policy validation |
| State | `v2/state.ts` | 584 | Transactions, locking, namespaces, watchers |
| Token Budget | `v2/token-budget.ts` | 407 | Allocation, defragmentation, warnings |
| Tool Engine | `v2/tool-engine.ts` | 589 | Validation, caching, retry, permissions |
| Types | `v2/types.ts` | 687 | 60+ interfaces defining the runtime contract |
| Workflow Engine | `v2/workflow-engine.ts` | ~500 | Standalone DAG executor with validation, events, pause/resume |
| Module Registry | `v2/module-registry.ts` | 349 | Dependency graph, cycle detection, topological sort, lifecycle |
| Evaluation Engine | `v2/evaluation-engine.ts` | 654 | Quality scoring, benchmarking, validation rules, quality gates |
| Observability | `v2/observability.ts` | 379 | Logs, metrics, traces, events, token usage, latency, cost |
| Agent Engine | `v2/agent-engine.ts` | 254 | Agent as a composition of model, context, memory, knowledge, tools |
| Resource Manager | `v2/resource-manager.ts` | 264 | Resource registration, acquisition, limits, permissions |
| Policy Engine | `v2/policy-engine.ts` | 194 | Operation/timeout/retry/execution-limit/network policies |
| Sandbox | `v2/sandbox.ts` | 194 | Filesystem/network/process policies, limits, timeout, guarded API |

**Total: 22 files, ~11,000+ lines of V2 runtime code**

### V2 Runtime Status

| Category | Engines | Status |
|----------|---------|--------|
| Core Runtime | Runtime, State, Events, Permissions, Plugins, Security, Resource Manager, Policy Engine | ✅ 8/8 Complete |
| Intelligence | Context, Token Budget, Memory, Knowledge, Model, Tool, Agent | ✅ 7/7 Complete |
| Orchestration | Workflow Engine, Module Registry, Dependency Resolver | ✅ 3/3 Complete |
| Quality | Evaluation Engine | ✅ 1/1 Complete |
| Operations | Observability, CLI Integration | ✅ 2/2 Complete |
| Isolation | Sandboxing | ✅ 1/1 Complete |

**Overall: 22/22 engines complete (100%)**

### Standalone Execution

`.mam` is the canonical standalone artifact and executes natively by default.
`.mam.md` remains source/legacy compatible and executes natively as well.
Compiled target artifacts execute through their own implementation runtime.

```bash
mam run hello.mam                       # Native MAM execution (no compiler)
mam run hello.mam --format json         # JSON output
mam run hello.mam --dry-run             # Show execution plan
mam run legacy.mam.md                   # .mam.md also executes natively
mam run hello.mam.py                    # Python target -> runs with python
mam run hello.mam.js                    # JavaScript target -> runs with node
mam run hello.mam.sh                    # Shell target -> runs with sh/bash
mam run hello.mam --sandbox vm          # Legacy sandbox execution (opt-in)
```

Target routing by extension: `.mam.py` → python, `.mam.js`/`.mam.mjs`/`.mam.cjs`
→ node, `.mam.ts` → tsx, `.mam.sh`/`.mam.bash` → shell, `.mam.go` → go run,
`.mam.rs` → rustc + run.

---

## Known Issues

1. **Windows forced-exit assertion**: `UV_HANDLE_CLOSING` fires when a Node
   process is force-killed mid-shutdown. Cosmetic; graceful `close()` is clean.
   Workaround: always shut down via SIGINT/SIGTERM, not `Stop-Process -Force`.

2. **PowerShell mangles `curl.exe` payloads**: `-d` JSON gets re-encoded, so
   the server correctly reports "not valid JSON". Workaround: use
   `Invoke-RestMethod` (handles JSON properly) or Node `fetch`.

3. **Tunnel URLs are temporary**: trycloudflare addresses rotate on restart.
   Tracked fix: free Cloudflare account + named tunnel for a stable address.

---

## What's Missing for Full Release

| Item | Priority | Status |
|------|----------|--------|
| Parser hyphen fix | High | ✅ Complete (standalone hyphens + dash-only-line hang) |
| `.mam` document coverage | High | ✅ Complete (LSP selector + testing/cli/package-manager/reference) |
| Workflow Engine (standalone) | Medium | ✅ Complete (~500 lines) |
| Module Registry (runtime-level) | Medium | ✅ Complete (349 lines) |
| Dependency Resolver (runtime-level) | Medium | ✅ Complete (topoSort + package-manager) |
| CLI `mam run` | High | ✅ Complete (sandbox, hooks, plugins, V2 runtime, LIR orchestration) |
| Language Interoperability Runtime | High | ✅ Complete (Python + Node/JS/TS, policy, audit, CLI, example) |
| Dry-run mode | High | ✅ Complete |
| Evaluation Engine | Medium | ✅ Complete (~450 lines, quality scoring, benchmarks) |
| Standalone `.mam` execution | High | ✅ Complete (`mam run file.mam`, native runtime) |
| Observability System | Low | ✅ Standalone `@mam/observability` (traces/metrics/tokens/costs/evaluation) |
| Registry deployment | High | ✅ Live publicly (tunnel; VPS when funded) |
| Registry seeding | High | ✅ 20 founding modules live |
| VS Code Extension | Medium | ✅ Live on OpenVSX (426 downloads) **and** VS Code Marketplace |
| npm release | High | ⏳ Staged, not published. Needs a granular npm token with bypass-2FA (the `@mam` org enforces 2FA). Run `pnpm preflight:publish` then `pnpm -r publish --access public`. |
| Linguist recognition | Medium | Groundwork done; gated on ~200 public repos |
| Permanent URL | Medium | Named tunnel (free) or VPS; trycloudflare rotates |
| Runtime SDK | Low | Future |

---

## Commits (Recent)

| Hash | Description |
|------|-------------|
| `27a810f` | All 30 packages realigned to 2.0.0 |
| `48e9375` | `.mam` document coverage across LSP/CLI/testing/package-manager/reference |
| `d6095b8` | Publish preflight warns about the 2FA token requirement |
| `60e3530` | Parser: standalone hyphens + tokenizer hang on dash-only lines |
| live | Production registry launch (654 + 11 tests, 20 modules seeded) |
| live | OpenVSX + Marketplace extension published, 426 downloads |
| live | Docs refresh (README, purpose/goal/scope/brain, usage, SECURITY, CONTRIBUTING) |

**All pushed to `https://github.com/tcp-ecosystems/MAM.git` on `main` branch.**

---

## Standalone Engine Packages

Nine engines were extracted from `runtime/src/v2/` into first-class workspace
packages and wired into the runtime, CLI, compiler, testing, LSP, TypeScript
SDK and visualization:

| Package | Package | Package |
|---------|---------|---------|
| `@mam/memory-engine` | `@mam/knowledge-engine` | `@mam/observability` |
| `@mam/context-engine` | `@mam/security` | `@mam/tool-engine` |
| `@mam/mcp` | `@mam/token-optimization` | `@mam/intelligence-layer` |

`runtime/src/v2/system.ts` exposes them through `MAMSystem` / `createMAMSystem()`
with a shared registry and event bus.
