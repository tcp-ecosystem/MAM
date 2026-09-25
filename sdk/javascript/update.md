# sdk/javascript — Update

## Status

| Check | Result |
| --- | --- |
| `pnpm --filter @mam/sdk-javascript typecheck` | PASS |
| `pnpm --filter @mam/sdk-javascript test` | PASS — 10 files, 196 tests |
| `lint` | BLOCKED (repo-wide, pre-existing) |

## Existing files — 7 new features each

### `mam/mam.ts`
`MAMModule` gained seven additive methods:

| Feature | Behavior |
| --- | --- |
| `getName()` | Returns current module name |
| `getVersion()` | Returns version, or `'0.1.0'` when unset |
| `getConfig()` | Returns a deep-ish defensive copy of the config object (mutating the result does not affect the module) |
| `sectionCount()` | Number of sections held by the module |
| `isEmpty()` | `true` when the module has no sections |
| `hasContent(name)` | `true` when the named section has at least one content node |
| `toSummary()` | One-line human-readable summary; falls back to `(untitled)` and reports section/code-block totals |

### `mam/parser.ts`
Seven new exported query helpers over `AST`:

| Feature | Behavior |
| --- | --- |
| `hasFrontMatter(ast)` | Whether the module has a YAML front-matter block |
| `getSectionNames(ast)` | Section titles in document order |
| `countSections(ast)` | Total section count |
| `countCodeBlocks(ast)` | Total `CodeBlock` nodes across all sections |
| `getCodeBlockLanguages(ast)` | Distinct code-block languages, first-seen order |
| `findSection(ast, name)` | Case-insensitive section lookup, or `undefined` |
| `isValidSectionName(name)` | Whether a name is a recognized standard section |

### `mam/runtime.ts`
Seven new exported helpers over execution results:

| Feature | Behavior |
| --- | --- |
| `isExecutionSuccess(result)` | Mirrors the `success` flag |
| `countSuccessfulSections(result)` | Number of passing section results |
| `getFailedSections(result)` | Only the failing section results |
| `getExecutionLanguages(result)` | Distinct languages used, first-seen order |
| `summarizeExecution(result)` | Human-readable success/failure line with `passed/total` |
| `recordExecution(history, entry)` | Appends an entry to an execution history |
| `getExecutionHistorySize(history)` | Current history length |

### `mam/validator.ts`
Seven new exported helpers over `ValidationIssue[]`:

| Feature | Behavior |
| --- | --- |
| `countIssuesBySeverity(issues)` | Counts keyed by `error` / `warning` / `info` |
| `hasErrors(issues)` | Any `error`-severity issue present |
| `hasWarnings(issues)` | Any `warning`-severity issue present |
| `filterIssuesBySeverity(issues, severity)` | Subset with the given severity |
| `getIssueMessages(issues)` | Ordered message strings |
| `isValid(issues)` | `true` only when no `error`-severity issue exists |
| `summarizeIssues(issues)` | Counts line, or `no issues` when empty |

### `mam/index.ts`
Barrel re-exports every new family (`config`, `cache`, `format`, `graph`, `template`) plus the `DiffChangeType` type.

## New files (all ≥ 300 lines)

| File | Lines | Exports |
| --- | --- | --- |
| `mam/config.ts` | 302 | `SDKConfig`, `DEFAULT_SDK_CONFIG`, `loadSDKConfig`, `saveSDKConfig` (returns `Promise<string>`, atomic temp-file write), `validateSDKConfig`, `mergeSDKConfigs` (merges `extra` maps), `resolveSDKConfigPath`, `isSupportedSDKTarget`, `listSDKTargets` |
| `mam/cache.ts` | 303 | `CacheEntry`, `CacheStats`, `DEFAULT_CACHE_TTL`, `hashCacheKey` (SHA-256, delimiter-safe), `formatCacheStats`, `isValidCacheKey`, `createResultCache`, `ResultCache` (`get`/`set`/`has`/`delete`/`clear`/`size`/`prune`/`stats`/`hitRate`/`keys`/`getOrSet`/`getRemainingTTL`/`saveToFile`/`loadFromFile`) |
| `mam/format.ts` | 301 | `formatModuleSummary`, `formatModuleJSON`, `formatSectionList`, `formatValidationReport`, `formatExecutionResults`, `formatCodeBlockList`, `formatFrontMatter` |
| `mam/graph.ts` | 307 | `DepNode`, `DepEdge`, `DepGraph`, `buildDepGraph`, `topoSortDepGraph` (cycle-detecting), `getDepNodeNames`, `summarizeDepGraph`, `getDepSuccessors`, `getDepPredecessors`, `hasDepEdge`, `getDepEdgeLabels`, `findDepLeafNodes`, `findDepRootNodes`, `formatDepGraphText`, `getDepNodesOfType`, `countDepEdgesByLabel`, `countDepNodesByType`, `hasDepNode`, `getDepNodeType` |
| `mam/template.ts` | 314 | `STARTER_KINDS`, `listStarterKinds`, `getStarterTemplate` (module/agent/tool; aliases `mod`, `bot`, `assistant`, `utility`, `cli`), `renderStarter` (case-insensitive placeholders, unknown placeholders preserved), `starterVariables`, `newModuleStarter`, `validateStarterName` |

## Pre-existing breakage fixed

These were broken before this work and blocked all test runs:

1. **`tsconfig.json` pointed at a non-existent `src/`** — `rootDir: "./src"` → `"./mam"`, `include: ["src/**/*.ts"]` → `["mam/**/*.ts"]`. Previously `tsc` failed with TS18003 "No inputs were found"; the stale turbo log had masked this.
2. **All 4 existing test files imported `../src/*.js`** — changed to `../mam/*.js`.
3. **2 stale version assertions** — `tests/parser.test.ts` (`data.version` `1.0.0` → `2.0.0`) and `tests/mam.test.ts` (`fromAST` module version `1.0.0` → `2.0.0`), matching the fixture version used across the package.

## Tests

- Existing 4 files extended with **7 new `it` cases each** covering every new export (`mam`, `parser`, `runtime`, `validator`).
- **6 new test files**, each with ≥ 7 `it` cases:
  - `tests/index.test.ts` (9 cases) — barrel export coverage across all nine families
  - `tests/config.test.ts` (14 cases) — defaults, validation, merge semantics, temp-file round-trip, invalid-save rejection
  - `tests/cache.test.ts` (13 cases) — set/get/delete/clear, TTL expiry, pruning, `getOrSet` single-compute, hit/miss stats, key validation, persistence
  - `tests/format.test.ts` (11 cases) — every formatter incl. empty-module and empty-collection fallbacks
  - `tests/graph.test.ts` (12 cases) — build, dedup, topological order, cycle throw, successor/predecessor, edge labels, type filters, counts, summary
  - `tests/template.test.ts` (14 cases) — kinds, aliases, unknown-kind throw, placeholder substitution, variable extraction, invalid names
- Total: **196 tests across 10 files, all passing.**

## Notes and deviations

- `config.ts`, `cache.ts`, and `graph.ts` intentionally export more than 7 symbols, since these APIs are cohesive families (config loader + validator + target registry; cache class + constants + hashing; graph builder + query surface). The "7 new features" target is met or exceeded for every file.
- No new runtime or dev dependencies were added. All imports use ESM `.js` suffixes.
- `lint` remains blocked repo-wide by a missing `@typescript-eslint/eslint-plugin` in the ESLint install; this is unrelated to this package and affects every package in the monorepo equally.
