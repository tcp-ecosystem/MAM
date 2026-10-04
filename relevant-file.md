# MAM Relevant Files

> **Complete file listing for the MAM project**

---

## Project Statistics

| Metric | Value |
|--------|-------|
| Workspace Packages | 58 (+ root) |
| Source TypeScript Files | 225+ |
| Test TypeScript Files | 264 |
| Total Tests | 7,000+ (all passing) |
| CLI Commands | 45 (+ `help`, `version`, aliases) |
| Compiler Targets | 16 |
| Module Types | 19 |
| Registry Tests | 654 (400 server + 123 api + 131 client) + 11 e2e |

---

## Root Files

| File | Size | Description |
|------|------|-------------|
| `README.md` | 30KB+ | Project introduction |
| `MAM.md` | 8.7KB | Complete system overview |
| `ARCHITECTURE.md` | 6.5KB | System architecture |
| `purpose.md` / `goal.md` / `scope.md` / `brain.md` | 7–8KB ea | Purpose, goals, scope, intelligence layer |
| `usage.md` | 25KB+ | Complete usage guide |
| `relevant-file.md` | — | This file listing |
| `SECURITY.md` | — | Security policy |
| `CONTRIBUTING.md` | — | Contributor guide |
| `plan.md` | 45KB | Project plan (v1) |
| `package.json` | 1.2KB | Workspace config |
| `pnpm-workspace.yaml` | 1KB+ | pnpm config (25 workspace globs) |

---

## Plan Documents

| File | Size | Description |
|------|------|-------------|
| `plan-doc/plan.md` | 45KB | Project plan (v1) |
| `plan-doc/plan-v2.md` | 22KB | Project plan (v2) |
| `plan-doc/personl-v2.md` | 47KB | Design philosophy |
| `plan-doc/build-prompt-v2-DSL.md` | 20KB | DSL architect prompt |
| `plan-doc/build-prompt-v2-SYSTEM.md` | 20KB | System architect prompt |
| `plan-doc/build-prompt.md` | 6.9KB | Original build prompt |
| `plan-doc/personal.md` | 9.8KB | Design notes |

---

## Documentation Files

| File | Size | Description |
|------|------|-------------|
| `docs/index.md` | 5KB | Documentation index |
| `docs/usage.md` | 13KB | Complete usage guide |
| `docs/brain.md` | 5.5KB | Intelligence layer |
| `docs/scope.md` | 5.9KB | What MAM covers |
| `docs/purpose.md` | 6.3KB | Why MAM exists |
| `docs/goal.md` | 7.1KB | What MAM aims to achieve |
| `ARCHITECTURE.md` | 6.5KB | System architecture |

---

## Specification Files

| File | Size | Description |
|------|------|-------------|
| `spec/SPEC.md` | 25KB | Formal specification |
| `spec/CHANGELOG.md` | 2KB | Version history |
| `spec/grammar/grammar.bnf` | 4KB | BNF grammar |
| `spec/grammar/grammar-v2.bnf` | 8KB | v2 DSL grammar |
| `spec/grammar/tokens.md` | 2KB | Token definitions |
| `spec/schema/mam.schema.json` | 5KB | JSON Schema |
| `spec/schema/metadata.schema.json` | 3KB | Metadata schema |
| `spec/schema/sections/*.schema.json` | 14 files | Section schemas |
| `spec/sections/*.md` | 19 files | Section definitions |

---

## Parser Files

| File | Size | Description |
|------|------|-------------|
| `parser/src/index.ts` | 3.5KB | Parser entry point |
| `parser/src/lexer/index.ts` | 480B | Lexer exports |
| `parser/src/lexer/tokenizer.ts` | 32KB | Tokenizer (main) |
| `parser/src/lexer/tokens.ts` | 4KB | Token definitions |
| `parser/src/lexer/errors.ts` | 2.7KB | Error types |
| `parser/src/parser/index.ts` | 891B | Parser exports |
| `parser/src/parser/mam.ts` | 10.5KB | Main parser |
| `parser/src/parser/dsl.ts` | 23KB | DSL parser (v2) |
| `parser/src/parser/sections.ts` | 23KB | Section parser |
| `parser/src/parser/frontmatter.ts` | 5.5KB | YAML parser |
| `parser/src/parser/errors.ts` | 3.2KB | Parser errors |
| `parser/tests/lexer/tokenizer.test.ts` | 10.4KB | Tokenizer tests |
| `parser/tests/lexer/tokens.test.ts` | 1.7KB | Token tests |
| `parser/tests/parser/mam.test.ts` | 15.3KB | Parser tests |
| `parser/tests/parser/sections.test.ts` | 2.4KB | Section tests |
| `parser/tests/parser/frontmatter.test.ts` | 1.7KB | Front matter tests |
| `parser/tests/fixtures/valid/*.mam.md` | 3 files | Valid fixtures |
| `parser/tests/fixtures/invalid/*.md` | 2 files | Invalid fixtures |
| `parser/benchmarks/lex.bench.ts` | 1.7KB | Lexer benchmark |
| `parser/benchmarks/parse.bench.ts` | 1.3KB | Parser benchmark |
| `parser/package.json` | 1KB | Package config |

---

## AST Files

| File | Size | Description |
|------|------|-------------|
| `ast/src/index.ts` | 2KB | AST entry point |
| `ast/src/nodes/index.ts` | 8.3KB | v1 node types |
| `ast/src/nodes/v2.ts` | 12.3KB | v2 node types |
| `ast/src/visitor/index.ts` | 218B | Visitor exports |
| `ast/src/visitor/visitor.ts` | 7KB | Visitor pattern |
| `ast/src/serializer/index.ts` | 10.5KB | JSON serializer |
| `ast/src/location/index.ts` | 1.1KB | Source locations |
| `ast/tests/nodes.test.ts` | 1KB | Node tests |
| `ast/tests/visitor.test.ts` | 1.6KB | Visitor tests |
| `ast/tests/serializer.test.ts` | 1.9KB | Serializer tests |
| `ast/package.json` | 1KB | Package config |

---

## Validator Files

| File | Size | Description |
|------|------|-------------|
| `validator/src/index.ts` | 670B | Validator exports |
| `validator/src/validator.ts` | 6.8KB | Main validator |
| `validator/src/rules/schema.ts` | 10.8KB | Schema rules |
| `validator/src/errors/index.ts` | 4.3KB | Error types |
| `validator/tests/validator.test.ts` | 5.9KB | Validator tests |
| `validator/tests/rules/schema.test.ts` | 2KB | Schema tests |
| `validator/tests/rules/custom.test.ts` | 1.7KB | Custom rule tests |
| `validator/package.json` | 1KB | Package config |

---

## Runtime Files

| File | Size | Description |
|------|------|-------------|
| `runtime/src/index.ts` | 564B | Runtime exports |
| `runtime/src/runtime.ts` | 8KB | Main runtime |
| `runtime/src/contexts/index.ts` | 4.8KB | Execution contexts |
| `runtime/src/sandboxes/index.ts` | 7KB | Sandboxes |
| `runtime/src/v2/index.ts` | 8.4KB | v2 runtime spec |
| `runtime/tests/runtime.test.ts` | 1.6KB | Runtime tests |
| `runtime/tests/contexts.test.ts` | 1.6KB | Context tests |
| `runtime/tests/sandboxes.test.ts` | 1.3KB | Sandbox tests |
| `runtime/package.json` | 1KB | Package config |

---

## CLI Files

| File | Description |
|------|-------------|
| `cli/src/index.ts` | CLI entry point (all 45 commands registered) |
| `cli/src/cli.ts` | Alternate entry |
| `cli/src/commands/init.ts` | Init command |
| `cli/src/commands/new.ts` | New-from-template command |
| `cli/src/commands/create.ts` | Scaffold command |
| `cli/src/commands/build.ts` | Build command |
| `cli/src/commands/compile.ts` | Compile command |
| `cli/src/commands/run.ts` | Native run command |
| `cli/src/commands/execute.ts` | Execute command (v1 compat) |
| `cli/src/commands/validate.ts` | Validate command |
| `cli/src/commands/lint.ts` | Lint command |
| `cli/src/commands/format.ts` / `fmt.ts` | Format command + alias |
| `cli/src/commands/test.ts` / `smoke.ts` | Test + end-to-end smoke |
| `cli/src/commands/inspect.ts` | Deep module inspection |
| `cli/src/commands/harmony.ts` | Module-set consistency |
| `cli/src/commands/graph.ts` | Dependency graph |
| `cli/src/commands/ast.ts` | AST dump |
| `cli/src/commands/docs.ts` / `export.ts` | Docs + export |
| `cli/src/commands/doctor.ts` | Environment check |
| `cli/src/commands/serve.ts` | Dev server |
| `cli/src/commands/install.ts` / `uninstall.ts` / `update.ts` | Package management |
| `cli/src/commands/publish.ts` | Registry publish |
| `cli/src/commands/migrate.ts` | v1→v2 migration |
| `cli/src/commands/memory.ts` | Working memory |
| `cli/src/commands/global.ts` | Global installation |
| `cli/src/commands/system.ts` / `optimize.ts` | Engines + token optimization |
| `cli/src/project/` | `mam.toml` loading, graphs |
| `cli/src/templates/init/` | `agent.mam.md`, `basic.mam.md`, `full.mam.md` |
| `cli/package.json` | Package config |

---

## Compiler Files

| File | Size | Description |
|------|------|-------------|
| `compiler/src/index.ts` | 690B | Compiler exports |
| `compiler/src/compiler.ts` | 13.8KB | Main compiler |
| `compiler/src/transformer.ts` | 15KB | MAMModule → V2ModuleNode transformer |
| `compiler/src/analyzer/index.ts` | 13.5KB | Semantic analyzer |
| `compiler/src/targets/python.ts` | 6.9KB | Python target |
| `compiler/src/targets/javascript.ts` | 2.4KB | JavaScript target |
| `compiler/src/targets/go.ts` | 2.4KB | Go target |
| `compiler/src/targets/rust.ts` | 19.1KB | Rust target |
| `compiler/src/targets/csharp.ts` | 5KB | C# target |
| `compiler/src/targets/java.ts` | 5KB | Java target |
| `compiler/src/targets/wasm.ts` | 4KB | WebAssembly target |
| `compiler/src/targets/openai.ts` | 4.5KB | OpenAI SDK target |
| `compiler/src/targets/langgraph.ts` | 3.9KB | LangGraph target |
| `compiler/src/targets/crewai.ts` | 4.6KB | CrewAI target |
| `compiler/src/targets/gemini.ts` | 4KB | Gemini target |
| `compiler/src/targets/autogen.ts` | 4KB | AutoGen target |
| `compiler/src/targets/claude.ts` | 1.6KB | Claude SDK target |
| `compiler/src/targets/kubernetes.ts` | 4KB | Kubernetes target |
| `compiler/src/targets/terraform.ts` | 4KB | Terraform target |
| `compiler/src/targets/docker.ts` | 1.4KB | Docker target |
| `compiler/package.json` | 1KB | Package config |

---

## Plugin Files

| File | Size | Description |
|------|------|-------------|
| `plugins/api/src/index.ts` | 545B | Plugin API exports |
| `plugins/api/src/types.ts` | 3.2KB | Plugin types |
| `plugins/api/src/hooks.ts` | 2.2KB | Hook manager |
| `plugins/api/src/registry.ts` | 3.3KB | Plugin registry |
| `plugins/core/yaml/src/index.ts` | 3.2KB | YAML plugin |
| `plugins/core/mermaid/src/index.ts` | 3KB | Mermaid plugin |
| `plugins/core/python/src/index.ts` | 4.1KB | Python plugin |
| `plugins/core/memory/src/index.ts` | 3.8KB | Memory plugin |
| `plugins/*/package.json` | 5 files | Package configs |

---

## LSP Files

| File | Size | Description |
|------|------|-------------|
| `lsp/src/index.ts` | 456B | LSP entry point |
| `lsp/src/server.ts` | 18.6KB | LSP server |
| `lsp/src/features/completion.ts` | 1.5KB | Completion |
| `lsp/src/features/diagnostics.ts` | 682B | Diagnostics |
| `lsp/src/features/hover.ts` | 1.7KB | Hover |
| `lsp/src/features/definition.ts` | 307B | Definition |
| `lsp/src/features/references.ts` | 296B | References |
| `lsp/src/features/formatting.ts` | 731B | Formatting |
| `lsp/src/features/codeAction.ts` | 521B | Code actions |
| `lsp/src/protocol/mam.ts` | 658B | MAM protocol |
| `lsp/package.json` | 1KB | Package config |

---

## Package Manager Files

| File | Size | Description |
|------|------|-------------|
| `package-manager/src/index.ts` | 508B | PM exports |
| `package-manager/src/package.ts` | 6.7KB | Package manager |
| `package-manager/src/registry.ts` | 5.2KB | Registry client |
| `package-manager/src/resolver.ts` | 5.3KB | Dependency resolver |
| `package-manager/src/lockfile.ts` | 4.1KB | Lock file manager |
| `package-manager/package.json` | 1KB | Package config |

---

## Registry Files (MAM Hub — production service, 654 + 11 tests)

| File | Description |
|------|-------------|
| `registry/api/openapi.yaml` | REST contract |
| `registry/api/graphql/schema.graphql` | GraphQL SDL (reference-parsed in tests) |
| `registry/api/src/index.ts` | Contract exports, `readOpenAPI`, `readGraphQLSchema`, parity checker |
| `registry/api/src/resolvers.ts` | Query/Mutation/Module resolvers against the shared store |
| `registry/api/tests/contract.test.ts` | Contract + SDL validity (42 tests) |
| `registry/api/tests/resolvers.test.ts` | Resolver behavior (81 tests) |
| `registry/server/src/server.ts` | `RegistryServer`: handlers, gating, rate limiting, CORS |
| `registry/server/src/http.ts` | `RegistryHttpServer`: node:http routing, middleware, shutdown |
| `registry/server/src/graphql.ts` | Schema build, JSON scalar, execution |
| `registry/server/src/store.ts` | Atomic flat-file store, per-module locks, path safety |
| `registry/server/src/auth.ts` | scrypt auth, lockout, persistent users/tokens |
| `registry/server/src/search.ts` | N-gram inverted index + scoring |
| `registry/server/tests/http.test.ts` | Live-socket HTTP suite (58 tests) |
| `registry/server/tests/graphql.test.ts` | Live GraphQL execution (24 tests) |
| `registry/server/tests/client-integration.test.ts` | Published client vs live server (11 tests) |
| `registry/server/tests/auth/store/search/server.test.ts` | Unit suites (307 tests) |
| `registry/client/src/client.ts` | Typed client: retry, timeout, 401 replay, pagination |
| `registry/client/src/auth.ts` | Login, refresh lock, tokenStorage hydration |
| `registry/client/src/errors.ts` | `RegistryError`, retry classification |
| `registry/client/tests/auth.test.ts` / `client.test.ts` | 67 + 64 tests |

---

## SDK Files

| Directory | Files | Description |
|-----------|-------|-------------|
| `sdk/javascript/` | 9 TS files | JavaScript SDK (96 tests) |
| `sdk/typescript/` | TS files | TypeScript SDK |
| `sdk/python/` | Python files | Python SDK |
| `sdk/go/` | Go files | Go SDK |
| `sdk/rust/` | Rust files | Rust SDK |
| `sdk/c/` / `sdk/cpp/` | C headers / CMake | C / C++ SDKs |
| `sdk/csharp/` / `sdk/java/` | C# / Java sources | C# / Java SDKs |
| `sdk/ruby/` / `sdk/sql/` | Ruby / SQL | Ruby / SQL SDKs |

---

## Testing Files

| File | Size | Description |
|------|------|-------------|
| `testing/src/index.ts` | 496B | Testing exports |
| `testing/src/runner.ts` | 6KB | Test runner |
| `testing/src/module-test.ts` | 3.9KB | Module tests |
| `testing/src/system-test.ts` | 3.7KB | System tests |
| `testing/src/snapshot.ts` | 3.2KB | Snapshot tests |
| `testing/package.json` | 1KB | Package config |

---

## Visualization Files

| File | Size | Description |
|------|------|-------------|
| `visualization/src/index.ts` | 380B | Visualization exports |
| `visualization/src/graph.ts` | 5.8KB | Graph visualizer |
| `visualization/src/mermaid.ts` | 5.4KB | Mermaid generator |
| `visualization/src/ascii.ts` | 4.6KB | ASCII art generator |
| `visualization/package.json` | 1KB | Package config |

---

## Reference Implementation

| File | Size | Description |
|------|------|-------------|
| `reference/src/index.ts` | 13KB | Reference CLI |
| `reference/package.json` | 1KB | Package config |

---

## Example Modules

One runnable example per type (`modules/examples/<type>/<type>.mam` + `.mam.md`
twin), plus five composed `mam.toml` suites:

| Location | Contents |
|----------|----------|
| `modules/examples/{agent,component,contract,documentation,extension,interface,memory,module,package}/` | One full example each |
| `modules/examples/{plugin,policy,repository,resource,runtime,service,system,team,tool,workflow}/` | One full example each |
| `modules/examples/{core,basic,advanced,plugins,security-system}/` | Composed suites, each a full `mam.toml` project |
| `modules/templates/<19 types>/` | Basic + advanced scaffolds per type (`mam new <type> <name>`) |


---

## Compiled Outputs

| Directory | Files | Description |
|-----------|-------|-------------|
| `output/examples/` | 143 | Compiled from 13 real modules × 16 targets |
| `output/minimal/` | 13 | Minimal example outputs |
| `output/basic/` | 13 | Basic example outputs |
| `output/full/` | 13 | Full example outputs |
| `output/agent/` | 13 | Agent example outputs |
| `output/tool/` | 13 | Tool example outputs |

---

**Last Updated:** 2026-10-03
**Workspace Packages:** 58 (+ root)
**Total Tests:** 7,000+ across 264 files
