# MAM Relevant Files

> **Complete file listing for the MAM project**

---

## Project Statistics

| Metric | Value |
|--------|-------|
| Total Files | 205 |
| TypeScript Files | 122 |
| Documentation Files | 15 |
| Configuration Files | 8 |
| Total Size | ~580KB |

---

## Root Files

| File | Size | Description |
|------|------|-------------|
| `README.md` | 8.7KB | Project introduction |
| `MAM.md` | 8.7KB | Complete system overview |
| `ARCHITECTURE.md` | 6.5KB | System architecture |
| `plan.md` | 45KB | Project plan (v1) |
| `build-prompt.md` | 6.9KB | Build prompt |
| `personal.md` | 9.8KB | Design notes |
| `talk.md` | - | Presentation notes |
| `package.json` | 1.2KB | Workspace config |
| `pnpm-workspace.yaml` | 200B | pnpm config |
| `turbo.json` | 500B | Turbo config |
| `tsconfig.json` | 700B | TypeScript config |

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

| File | Size | Description |
|------|------|-------------|
| `cli/src/index.ts` | 7.3KB | CLI entry point |
| `cli/src/commands/init.ts` | 4.6KB | Init command |
| `cli/src/commands/build.ts` | 1.9KB | Build command |
| `cli/src/commands/validate.ts` | 2.5KB | Validate command |
| `cli/src/commands/lint.ts` | 2KB | Lint command |
| `cli/src/commands/format.ts` | 1.8KB | Format command |
| `cli/src/commands/fmt.ts` | 1.8KB | Format (alias) |
| `cli/src/commands/graph.ts` | 3KB | Graph command |
| `cli/src/commands/ast.ts` | 2.1KB | AST command |
| `cli/src/commands/execute.ts` | 2.6KB | Execute command |
| `cli/src/commands/run.ts` | 2.1KB | Run command |
| `cli/src/commands/compile.ts` | 3KB | Compile command |
| `cli/src/commands/export.ts` | 3.1KB | Export command |
| `cli/src/commands/doctor.ts` | 1.9KB | Doctor command |
| `cli/src/commands/docs.ts` | 2.2KB | Docs command |
| `cli/src/commands/test.ts` | 3KB | Test command |
| `cli/src/commands/serve.ts` | 3.9KB | Serve command |
| `cli/src/commands/install.ts` | 2.2KB | Install command |
| `cli/src/commands/publish.ts` | 1.7KB | Publish command |
| `cli/src/commands/migrate.ts` | 4.1KB | Migrate command |
| `cli/src/utils/config.ts` | 3.7KB | Config manager |
| `cli/src/utils/logger.ts` | 4KB | Logger |
| `cli/src/utils/spinner.ts` | 3.3KB | Spinner |
| `cli/src/utils/formatter.ts` | 6KB | Formatter |
| `cli/src/utils/linter.ts` | 10.7KB | Linter |
| `cli/src/utils/docs.ts` | 9KB | Docs generator |
| `cli/tests/commands/*.test.ts` | 3 files | Command tests |
| `cli/package.json` | 1KB | Package config |

---

## Compiler Files

| File | Size | Description |
|------|------|-------------|
| `compiler/src/index.ts` | 690B | Compiler exports |
| `compiler/src/compiler.ts` | 13.8KB | Main compiler |
| `compiler/src/analyzer/index.ts` | 13.5KB | Semantic analyzer |
| `compiler/src/targets/python.ts` | 6.9KB | Python target |
| `compiler/src/targets/javascript.ts` | 2.4KB | JavaScript target |
| `compiler/src/targets/go.ts` | 2.4KB | Go target |
| `compiler/src/targets/rust.ts` | 19.1KB | Rust target |
| `compiler/src/targets/openai.ts` | 4.5KB | OpenAI SDK target |
| `compiler/src/targets/langgraph.ts` | 3.9KB | LangGraph target |
| `compiler/src/targets/crewai.ts` | 4.6KB | CrewAI target |
| `compiler/src/targets/claude.ts` | 1.6KB | Claude SDK target |
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

## Registry Files

| File | Size | Description |
|------|------|-------------|
| `registry/server/src/index.ts` | 478B | Registry exports |
| `registry/server/src/server.ts` | 5.7KB | Registry server |
| `registry/server/src/store.ts` | 5.9KB | Module store |
| `registry/server/src/auth.ts` | 4.4KB | Authentication |
| `registry/server/src/search.ts` | 6.5KB | Search engine |
| `registry/server/package.json` | 1KB | Package config |

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

| File | Size | Description |
|------|------|-------------|
| `modules/examples/authentication.mam.md` | 4KB | Auth module |
| `modules/examples/bug-hunter.mam.md` | 5KB | Multi-agent system |
| `modules/templates/basic.mam.md` | 1KB | Basic template |

---

**Last Updated:** 2026-07-24
**Total Files:** 205
**Total Size:** ~580KB