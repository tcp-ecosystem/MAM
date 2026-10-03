# Task — Harden @mam/reference with 7 New Features Per File + 7 New Files

## Objective

Add exactly **7 new features to each existing `.ts` file** in
`reference/src` (7 files), **create 7 new files** in `reference/src/`
with 7 exports each (300+ lines each), and add **>=7 new `it` cases to
each test file** in `reference/tests` (6 files) plus a new
`tests/index.test.ts` with >=7 cases — 98 src additions total —
**without interrupting anything that already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the
   behavior/signature of any existing export, type, or function. Existing
   tests must keep passing untouched.
2. **No new dependencies.** Only node built-ins (`node:fs/promises`,
   `node:path`, `node:os`) and workspace packages already declared.
3. **No comments** in new code (project rule).
4. **Exactly 7 new exported symbols per file** (function, class, constant,
   interface/type). Each must be genuinely useful — no trivial aliases, no
   duplicates of existing exports. New exported functions in existing files
   delegate to existing private helpers where possible.
5. **New source files live in `src/`** (flat layout, no subfolders).
6. **Style:** match the host file (ESM imports with `.js` suffix for local
   modules, JSDoc-free new code, existing naming conventions).
7. **Tests:** the 6 existing test files gain **>=7 new `it` cases** each;
   new `tests/index.test.ts` covers the new `index.ts` exports; new
   `tests/cache.test.ts`, `progress.test.ts`, `reporter.test.ts`,
   `pipeline.test.ts`, `doctor.test.ts`, `template.test.ts`,
   `lockfile.test.ts` cover the 7 new files.
8. **Verification (must pass):**
   - `pnpm --filter @mam/reference typecheck`
   - `pnpm --filter @mam/reference test`
   - (`lint` is blocked repo-wide: missing
     `@typescript-eslint/eslint-plugin` in this environment.)

---

## Plan — existing `src/` files (7 files x 7)

| File | The 7 features |
|---|---|
| `src/config.ts` | `cloneConfig(config)`, `getConfigValue(config, path)`, `setConfigValue(config, path, value)`, `listConfiguredTargets(config)`, `hasTarget(config, target)`, `diffConfigKeys(a, b)`, `isDefaultConfig(config)` |
| `src/errors.ts` | `isMAMError(err)`, `asMAMError(err)`, `getErrorCode(err)`, `getErrorMessage(err)`, `isErrorCode(err, code)`, `formatUnknownError(err)`, `collectErrorMessages(errors)` |
| `src/index.ts` | `CLI_NAME`, `CLI_VERSION`, `CLI_DESCRIPTION` consts, `getCommandNames()`, `hasCommand(name)`, `getCommandDescription(name)`, `getExtensionForTarget(target)` (delegates to private `getExtension`) |
| `src/logger.ts` | `LOG_LEVELS` const, `isLogLevel(value)`, `compareLogLevels(a, b)`, `isLevelEnabled(current, level)`, `formatLogMessage(level, message, prefix?)`, `createSilentLogger()`, `createMemoryLogger()` (returns `{ logger, lines }`) |
| `src/plugin.ts` | `isCLIPlugin(value)`, `validatePlugin(plugin)`, `getPluginCommandNames(plugin)`, `findPluginCommand(plugin, name)`, `hasPluginHook(plugin, hook)`, `getLoadedPluginNames(manager)`, `countPluginCommands(manager)` |
| `src/types.ts` | `PipelineStage`, `PipelineContext`, `PipelineResult`, `PipelineOptions`, `ReportOptions`, `ReportSummary` interfaces + `EXIT_CODES` const |
| `src/utils.ts` | `capitalize(text)`, `pluralize(count, singular, plural?)`, `formatList(items)`, `chunk(array, size)`, `unique(array)`, `groupBy(array, keyFn)`, `parseKeyValue(line)` |

---

## Plan — new `src/` files (7 files x 7, 300+ lines each)

| File | The 7 features |
|---|---|
| `src/cache.ts` | `CacheOptions` (imported from types), `MemoryCache` class (get/set/has/delete/clear/size + TTL), `createMemoryCache(ttlMs?)`, `getCacheKey(parts)`, `isExpired(entry, now?)`, `readJsonCacheFile(path)`, `writeJsonCacheFile(path, value)` |
| `src/progress.ts` | `PROGRESS_BAR_WIDTH` const, `ProgressTracker` class, `createProgressTracker(total)`, `formatProgressBar(done, total, width?)`, `formatPercentage(done, total)`, `estimateTimeRemaining(done, total, elapsedMs)`, `formatTimeRemaining(ms)` |
| `src/reporter.ts` | `REPORT_SEPARATOR` const, `summarizeBuildResult(result)`, `formatValidationDetails(details)`, `formatBuildStats(stats)`, `formatAsJson(value)`, `countBySeverity(details)`, `hasErrors(details)` |
| `src/pipeline.ts` | `Pipeline` class (use/run/getStageNames), `createPipeline(stages?)`, `runPipelineStages(stages, ctx)`, `getPipelineStageNames(pipeline)`, `isPipelineSuccess(result)`, `summarizePipelineResult(result)`, `DEFAULT_PIPELINE_OPTIONS` (uses `Pipeline*` types from types.ts) |
| `src/doctor.ts` | `checkNodeVersion()`, `checkPackageJson(dir)`, `checkConfigFile(dir)`, `runDoctorChecks(dir?)`, `formatDoctorReport(report)`, `hasFailingChecks(report)`, `countChecksByStatus(report)` (uses `DoctorCheckResult`/`DoctorReport` — add both to types.ts plan: fits inside the 7? No — types.ts already has 7 planned. Define `DoctorCheckResult`/`DoctorReport` locally in doctor.ts? That would exceed 7 exports. Instead: reuse generic shapes — define the 2 interfaces as NON-exported locals, export only the 7 functions. `formatDoctorReport` takes the local type — TS declaration emit with non-exported types is fine (non-exported interfaces in exported signatures are allowed, they just aren't importable). Cleaner: put DoctorCheckResult + DoctorReport in types.ts INSTEAD of two pipeline/report types? Recount types.ts: PipelineStage, PipelineContext, PipelineResult, PipelineOptions, ReportOptions, ReportSummary, EXIT_CODES = 7. To include doctor types, swap: drop ReportOptions/ReportSummary (reporter.ts can define local non-exported option shapes) and add DoctorCheckResult + DoctorReport. Final types.ts 7: `PipelineStage`, `PipelineContext`, `PipelineResult`, `PipelineOptions`, `DoctorCheckResult`, `DoctorReport`, `EXIT_CODES`. reporter.ts uses BuildResult/ValidationDetail/BuildStats (already in types.ts). |
| `src/template.ts` | `SUPPORTED_TEMPLATE_KINDS` const, `isTemplateKind(kind)`, `getStarterTemplate(kind)`, `renderTemplate(template, vars)`, `listTemplateVariables(template)`, `createModuleStarter(name, kind?)`, `getTemplateDescription(kind)` (`{{var}}` placeholders; kinds: module/agent/tool) |
| `src/lockfile.ts` | `LockfileEntry` interface, `createLockfileEntry(name, version, extra?)`, `parseLockfile(text)`, `serializeLockfile(entries)`, `mergeLockfiles(a, b)`, `verifyLockfile(entries)`, `sortLockfileEntries(entries)` |

---

## Plan — `tests/` (6 existing + 8 new files)

| File | The additions |
|---|---|
| `tests/config.test.ts` | >=7 new `it` cases for clone/get/set/listConfiguredTargets/hasTarget/diff/isDefault |
| `tests/errors.test.ts` | >=7 new `it` cases for isMAMError/asMAMError/getErrorCode/getErrorMessage/isErrorCode/format/collect |
| `tests/logger.test.ts` | >=7 new `it` cases for LOG_LEVELS/isLogLevel/compare/isEnabled/format/silent/memory |
| `tests/plugin.test.ts` | >=7 new `it` cases for isCLIPlugin/validate/commandNames/find/hasHook/loadedNames/count |
| `tests/types.test.ts` | >=7 new `it` cases for the 7 new types/const (shape + EXIT_CODES values) |
| `tests/utils.test.ts` | >=7 new `it` cases for capitalize/pluralize/formatList/chunk/unique/groupBy/parseKeyValue |
| `tests/index.test.ts` (new) | >=7 `it` cases for CLI_NAME/VERSION/DESCRIPTION/commands/has/describe/extension |
| 7 new test files (new) | `cache`, `progress`, `reporter`, `pipeline`, `doctor`, `template`, `lockfile` coverage |

---

## Execution Order

1. Extend the 7 existing src files (disjoint; no cross-file edits).
2. Create the 7 new `src/` files.
3. Extend the 6 test files + add 8 new test files.
4. Run typecheck + test; fix any regressions.
5. Record results in `update.md`.
