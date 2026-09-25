# Task — Harden @mam/sdk-javascript (7 Per File + 5 New Files)

## Objective

Add exactly **7 new features to each existing `.ts` file** in
`sdk/javascript/mam/` (5 files), **create 5 new files** in `mam/` with 7
exports each (300+ lines each), and add **>=7 new `it` cases to each test
file** in `sdk/javascript/tests/` (4 files) plus new `tests/index.test.ts`
and 5 new test files — 35 + 35 = 70 src additions — **without interrupting
anything that already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the
   behavior/signature of any existing export, type, class, or method.
   Existing tests must keep passing untouched. (Note: `"strict": true`.)
2. **No new dependencies.** Only node built-ins (`node:fs/promises`,
   `node:path`, `node:os`, `node:crypto`) plus relative imports.
3. **No comments** in new code (project rule).
4. **Exactly 7 planned exports per file.** For class-bearing files the 7
   are the planned top-level API surface (config/output/const + class +
   helpers); class methods are the class's own API (precedent:
   visualization renderers). Renderer-style helpers analyze existing
   outputs instead of duplicating private logic.
5. **New source files live in `mam/`** (flat layout); **new test files
   live in `tests/`** (existing JS convention: tests import from
   `../mam/*.js`).
6. **Style:** match host files (ESM `.js` suffixes, JSDoc-free new code).
7. **Tests:** the 4 existing test files gain **>=7 new `it` cases** each;
   new `tests/index.test.ts` + 5 new test files cover the new modules.
8. **Verification (must pass):**
   - `pnpm --filter @mam/sdk-javascript typecheck`
   - `pnpm --filter @mam/sdk-javascript test`
   - (`lint` is blocked repo-wide: missing
     `@typescript-eslint/eslint-plugin`.)

---

## Plan — existing `mam/` files (5 files x 7)

| File | The 7 features |
|---|---|
| `mam/mam.ts` | `getName()`, `getVersion()`, `getConfig()` (copy), `sectionCount()`, `isEmpty()`, `hasContent(name)`, `toSummary()` (new `MAMModule` methods; no new imports) |
| `mam/parser.ts` | `hasFrontMatter(content)`, `getSectionNames(ast)`, `countSections(ast)`, `countCodeBlocks(ast)`, `getCodeBlockLanguages(ast)`, `findSection(ast, name)`, `isValidSectionName(name)` (delegates to private `STANDARD_SECTIONS`) |
| `mam/runtime.ts` | `isExecutionSuccess(result)`, `countSuccessfulSections(result)`, `getFailedSections(result)`, `getExecutionLanguages(result)`, `summarizeExecution(result)`, `recordExecution(history, entry)`, `getExecutionHistorySize(history)` |
| `mam/validator.ts` | `countIssuesBySeverity(issues)`, `hasErrors(issues)`, `hasWarnings(issues)`, `filterIssuesBySeverity(issues, s)`, `getIssueMessages(issues)`, `isValid(issues)`, `summarizeIssues(issues)` |
| `mam/index.ts` | 6 new re-export statements: svg→(n/a)… i.e. config/cache/format/graph/template families + the missing `DiffChangeType` (5 files → 5 lines + 1 type line; documented as 6, not 7 — no 7th family exists) |

---

## Plan — new `mam/` files (5 files x 7, 300+ lines each)

| File | The 7 features |
|---|---|
| `mam/config.ts` | `SDKConfig`, `DEFAULT_SDK_CONFIG`, `loadSDKConfig(path)`, `saveSDKConfig(config, path)`, `validateSDKConfig(config)`, `mergeSDKConfigs(base, override)`, `resolveSDKConfigPath(dir)` (JSON via `node:fs/promises`) |
| `mam/cache.ts` | `CacheEntry`, `CacheStats`, `ResultCache` class (get/set/has/delete/clear/size/prune/stats), `createResultCache(ttlMs?)`, `DEFAULT_CACHE_TTL`, `hashCacheKey(parts)`, `formatCacheStats(stats)` |
| `mam/format.ts` | `formatModuleSummary(mod)`, `formatModuleJSON(mod)`, `formatSectionList(mod)`, `formatValidationReport(report)`, `formatExecutionResults(results)`, `formatCodeBlockList(mod)`, `formatFrontMatter(fm)` (+ table/wrap/indent private helpers) |
| `mam/graph.ts` | `DepNode`, `DepEdge`, `DepGraph`, `buildDepGraph(ast)`, `topoSortDepGraph(graph)`, `getDepNodeNames(graph)`, `summarizeDepGraph(graph)` (+ cycle detection, adjacency privates) |
| `mam/template.ts` | `STARTER_KINDS`, `listStarterKinds()`, `getStarterTemplate(kind)`, `renderStarter(template, vars)`, `starterVariables(template)`, `newModuleStarter(name, kind, vars?)`, `validateStarterName(name)` (module/agent/tool starters, `{{var}}`) |

---

## Plan — `tests/` (4 existing + 6 new files)

| File | The additions |
|---|---|
| `tests/mam.test.ts` | >=7 new `it` for the 7 new `MAMModule` methods |
| `tests/parser.test.ts` | >=7 new `it` for the 7 parser helpers |
| `tests/runtime.test.ts` | >=7 new `it` for the 7 runtime helpers |
| `tests/validator.test.ts` | >=7 new `it` for the 7 validator helpers |
| `tests/index.test.ts` (new) | >=7 `it` for the barrel |
| `tests/config/cache/format/graph/template.test.ts` (new) | coverage per new file |

---

## Execution Order

1. Extend the 5 existing `mam/` files.
2. Create the 5 new `mam/` files (+ barrel lines).
3. Extend the 4 test files + add 6 new test files.
4. Run typecheck + test; fix any regressions.
5. Record results in `sdk/javascript/update.md`.
