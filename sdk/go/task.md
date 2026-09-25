# Task — Harden sdk/go (7 New Features Per File + 6 New Files + tests/ Package)

## Objective

Add exactly **7 new features to each existing `.go` file** in `sdk/go/mam/`
(6 files), **create 6 new `.go` files** in `sdk/go/mam/` with 7 exports
each, and **create a new `sdk/go/tests/` package** with 6 black-box test
files (>=7 `Test` funcs each) — 42 + 42 = 84 additions — **without
interrupting anything that already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the
   behavior/signature of any existing type, function, or method. Existing
   tests (white-box `package mam` in `mam/`) stay untouched **in place** —
   Go requires test files to live beside the code they test.
2. **No new dependencies.** Only Go stdlib (`encoding/json`, `fmt`, `os`,
   `path/filepath`, `strings`, `time`, `sync`, `sort`, `context`,
   `runtime`) plus the already-required `gopkg.in/yaml.v3` (not even
   needed by the new code).
3. **Style:** match the host files (`//` doc comments on every export,
   tabs, existing naming conventions). No struct-field renames.
4. **Exactly 7 new exported identifiers per file** (types, funcs,
   methods, consts). Genuinely useful, no trivial aliases, no duplicates.
5. **New test package:** `sdk/go/tests/`, `package tests`, black-box via
   `mam "github.com/LifeJiggy/MAM/sdk/go/mam"`. Six files, one per new
   module, >=7 `Test` funcs each. Only exported API is used.
6. **Verification:** NO Go toolchain is installed (user declined
   installation), so `go vet` / `go test` cannot run. Every new line is
   instead manually reviewed for: balanced braces, used imports, correct
   signatures, no unused variables, stdlib-only imports.
7. Docs: this `task.md` + `update.md` in `sdk/go/`.

---

## Plan — existing `mam/` files (6 files x 7)

| File | The 7 features |
|---|---|
| `mam/ast.go` | `(m *Module) SectionNames()`, `(m *Module) SectionCount()`, `(m *Module) HasSection(t)`, `(m *Module) CodeBlockLanguages()`, `(s Section) HasCodeBlocks()`, `NewModule(path)`, `(m *Module) Clone()` (deep copy) |
| `mam/mam.go` | `SDKName` const, `UserAgent()`, `ParseBytes(data, filePath)`, `MustParse(content)` (panics on error), `IsValidModule(mod)`, `ValidateModule(mod)`, `ModuleSummary(mod)` |
| `mam/parser.go` | `HasFrontMatter(content)`, `ExtractFrontMatterRaw(content)`, `ListSectionTitles(content)`, `CountCodeBlocks(content)`, `DetectLanguages(content)`, `IsMAMFile(path)`, `SplitLines(content)` (text-level helpers reusing existing regexes) |
| `mam/plugins.go` | `(r *PluginRegistry) Get(name)`, `(r *PluginRegistry) MustRegister(p)` (panics), `(r *PluginRegistry) HookNames(hook)`, `(r *PluginRegistry) Count()`, `KnownHooks()`, `(r *PluginRegistry) Clear()`, `NewPluginContext(mod)` |
| `mam/runtime.go` | `(r *Runtime) Config()`, `DefaultRuntimeConfig()`, `(r *Runtime) IsLanguageAllowed(lang)`, `SupportedLanguages()`, `(res *ExecutionResult) Succeeded()`, `(res *ExecutionResult) CombinedOutput()`, `CountResultsByLanguage(results)` |
| `mam/validator.go` | `(r *ValidationReport) ErrorCount()`, `(r *ValidationReport) WarningCount()`, `(r *ValidationReport) HasRule(rule)`, `(r *ValidationReport) BySeverity(s)`, `(v *Validator) RuleIDs()`, `(v *Validator) RuleCount()`, `IsValidSeverity(s)` |

---

## Plan — new `mam/` files (6 files x 7)

| File | The 7 features |
|---|---|
| `mam/config.go` | `SDKConfig`, `DefaultSDKConfig()`, `LoadSDKConfig(path)`, `(c SDKConfig) Save(path)`, `(c SDKConfig) Validate()`, `MergeSDKConfig(base, override)`, `ResolveSDKConfigPath(dir)` (JSON via `encoding/json`) |
| `mam/cache.go` | `ResultCache`, `NewResultCache(ttl)`, `Get/Set/Delete/Clear/Size` methods (TTL expiry, hit/miss stats, `Prune`, `GetOrSet` as extra methods — methods beyond the 7 counted: keep class API tight; counted 7 = type + ctor + 5 methods; additional private helpers allowed) |
| `mam/format.go` | `FormatModuleSummary(mod)`, `FormatModuleJSON(mod)`, `FormatSectionList(mod)`, `FormatValidationReport(report)`, `FormatExecutionResults(results)`, `FormatCodeBlockList(mod)`, `FormatFrontMatter(fm)` |
| `mam/graph.go` | `DepNode`, `DepEdge`, `DepGraph`, `BuildDepGraph(mod)`, `(g *DepGraph) TopoSort()`, `(g *DepGraph) NodeNames()`, `(g *DepGraph) EdgeCount()` (Kahn's algorithm, deterministic via sort) |
| `mam/template.go` | `ListStarterKinds()`, `GetStarterTemplate(kind)`, `RenderStarter(template, vars)`, `StarterVariables(template)`, `NewModuleStarter(name, kind)`, `ValidateStarterName(name)`, `StarterFileName(name)` (`{{var}}` placeholders; kinds module/agent/tool) |
| `mam/doctor.go` | `CheckResult`, `RunDoctorChecks(workDir)`, `FormatCheckReport(checks)`, `HasFailingChecks(checks)`, `CountChecksByStatus(checks)`, `CheckGoRuntime()`, `CheckWorkDirReadable(dir)` |

---

## Plan — new `sdk/go/tests/` package (6 files x >=7)

| File | Coverage |
|---|---|
| `tests/config_test.go` | defaults, load/save round-trip (TempDir), validate, merge, resolve path |
| `tests/cache_test.go` | set/get/has, TTL expiry, delete/clear/size, stats, GetOrSet, prune |
| `tests/format_test.go` | summary, JSON round-trip, section list, validation report, exec results, code blocks, front matter |
| `tests/graph_test.go` | build graph, topo order, cycle error, node names, edge count, isolated modules |
| `tests/template_test.go` | kinds, get/render/variables, new starter, validate name, file name, unknown kind error |
| `tests/doctor_test.go` | go runtime check, workdir check (present + missing), run suite, format, failing/count helpers |

---

## Execution Order

1. Extend the 6 existing `mam/` files (disjoint; no cross-file edits
   except `mam.go` gains a `strings` import for `ModuleSummary`).
2. Create the 6 new `mam/` files.
3. Create the 6 `sdk/go/tests/` files.
4. Manual verification pass (imports used, signatures, brace balance,
   no unused vars) + `git status` review.
5. Record results in `sdk/go/update.md` (explicitly noting that `go vet`
   / `go test` could not run).
