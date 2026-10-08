# MAM Current State

> **Last Updated: 2026-10-07**

---

## Overview

MAM (Machine Agent Modules) is a System Description Language (SDL) whose reference syntax is Markdown. It describes intelligent systems — agents, tools, workflows, teams, policies — and compiles them to 16 target languages.

**Status: Launched.** All packages build, 7,000+ tests pass, full pipeline works end-to-end. V2 Runtime: 100% complete (22/22 engines). `.mam` executes standalone. **MAM Hub registry is live publicly** with 20 founding modules (see [achievement.md](achievement.md)).

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

**58 workspace packages (+ root) build successfully. 7,000+ tests pass across 264 test files. MAM Hub is live with 20 modules.**

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
   - Known bug: hyphens in text trigger UNEXPECTED_CHARACTER error

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
  projects `core`, `basic`, `advanced`, `plugins`, `security-system`
- **Templates** (`modules/templates/`): 19 type folders (basic + advanced)

### Project Composition (`mam.toml`)

Multi-file projects compose modules into a system (full-mam §19). A project is
described by `mam.toml`. The project-aware commands are first-class `mam`
commands: when run inside a directory containing `mam.toml` (and no explicit
file argument), they operate on the whole project.

```toml
[project]
name = "security-system"
version = "1.0.0"

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
| **Total** | **264 files** | **7,000+ tests** |

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
| Parser hyphen fix | High | Known bug, workaround exists |
| Workflow Engine (standalone) | Medium | ✅ Complete (~500 lines) |
| Module Registry (runtime-level) | Medium | ✅ Complete (349 lines) |
| Dependency Resolver (runtime-level) | Medium | ✅ Complete (topoSort + package-manager) |
| CLI `mam run` | High | ✅ Complete (sandbox, hooks, plugins, V2 runtime) |
| Dry-run mode | High | ✅ Complete |
| Evaluation Engine | Medium | ✅ Complete (~450 lines, quality scoring, benchmarks) |
| Standalone `.mam` execution | High | ✅ Complete (`mam run file.mam`, native runtime) |
| Observability System | Low | Basic metrics in each engine |
| Registry deployment | High | ✅ Live publicly (tunnel; VPS when funded) |
| Registry seeding | High | ✅ 20 founding modules live |
| VS Code Extension | Medium | ✅ Live on OpenVSX; Marketplace queued on account fix |
| Linguist recognition | Medium | Groundwork done; gated on ~200 public repos |
| Permanent URL | Medium | Named tunnel (free) or VPS; trycloudflare rotates |
| Runtime SDK | Low | Future |

---

## Commits (Recent)

| Hash | Description |
|------|-------------|
| live | Production registry launch (654 + 11 tests, 20 modules seeded) |
| live | OpenVSX extension published, namespace granted |
| live | Docs refresh (README, purpose/goal/scope/brain, usage, SECURITY, CONTRIBUTING) |

**All pushed to `https://github.com/tcp-ecosystem/MAM.git` on `main` branch.**
