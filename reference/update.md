# Update — Harden @mam/reference (7 Per File + 7 New Files)

## Status: DONE except lint (blocked by environment)

All 7 existing `src/` files gained exactly 7 new additive exports, 7 new
files (300+ lines each) were created in `src/`, the 6 existing test files
gained >=7 new `it` cases each plus 8 new test files, `typecheck` and
`test` pass. `lint` cannot run: ESLint is missing
`@typescript-eslint/eslint-plugin` in this environment (pre-existing,
repo-wide, unrelated to these changes).

## Verification results

- `pnpm --filter @mam/reference typecheck` — PASS
- `pnpm --filter @mam/reference test` — PASS: 14 files, 361 tests
  (config 47, errors 46, logger 38, plugin 30, types 42, utils 78,
  index 8, cache 12, progress 13, reporter 8, pipeline 10, doctor 10,
  template 9, lockfile 10)
- `pnpm --filter @mam/reference lint` — BLOCKED (missing plugin, see above)

## Fixes applied during integration

1. `src/template.ts` — markdown fences inside a template literal
   terminated the string (syntax error); fences are now escaped
   (`` \` ``), so starters render real code blocks.
2. `src/config.ts` — `diffConfigKeys` casts needed `as unknown as
   Record<string, unknown>` (MAMConfig has no index signature; TS2352).
3. `src/index.ts` — commander `description` is a method, not a property;
   `getCommandDescription` now calls `.description()`.
4. `src/progress.ts` — `getSmoothedRemainingMs` returned seconds instead
   of milliseconds (missing x1000); fixed (test caught this).
5. `tests/logger.test.ts` — memory-logger test wrongly expected `info`
   output in the stream; `Logger` sends non-error levels to stdout
   (existing behavior, untouched). Test now asserts error capture + level
   filtering instead.

## Per-file feature list — existing `src/` (7 files x 7)

- `src/config.ts`: `cloneConfig`, `getConfigValue`, `setConfigValue`,
  `listConfiguredTargets`, `hasTarget`, `diffConfigKeys`,
  `isDefaultConfig`
- `src/errors.ts`: `isMAMError`, `asMAMError`, `getErrorCode`,
  `getErrorMessage`, `isErrorCode`, `formatUnknownError`,
  `collectErrorMessages`
- `src/index.ts`: `CLI_NAME`, `CLI_VERSION`, `CLI_DESCRIPTION`,
  `getCommandNames`, `hasCommand`, `getCommandDescription`,
  `getExtensionForTarget` (delegates to private `getExtension`)
- `src/logger.ts`: `LOG_LEVELS`, `isLogLevel`, `compareLogLevels`,
  `isLevelEnabled`, `formatLogMessage`, `createSilentLogger`,
  `createMemoryLogger`
- `src/plugin.ts`: `isCLIPlugin`, `validatePlugin`,
  `getPluginCommandNames`, `findPluginCommand`, `hasPluginHook`,
  `getLoadedPluginNames`, `countPluginCommands`
- `src/types.ts`: `PipelineStage`, `PipelineContext`, `PipelineResult`,
  `PipelineOptions`, `DoctorCheckResult`, `DoctorReport`, `EXIT_CODES`
- `src/utils.ts`: `capitalize`, `pluralize`, `formatList`, `chunk`,
  `unique`, `groupBy`, `parseKeyValue`

## New `src/` files (7 files x 7, all 300+ lines)

- `cache.ts` (359 lines): `CacheOptions`, `MemoryCache`
  (get/set/has/delete/clear/size + TTL, maxEntries, stats, getOrSet,
  refresh, prefix invalidation, clone/merge), `createMemoryCache`,
  `getCacheKey` (sha256), `isExpired`, `readJsonCacheFile`,
  `writeJsonCacheFile`
- `progress.ts` (302 lines): `PROGRESS_BAR_WIDTH`, `ProgressTracker`
  (advance/set/complete/reset, pause/resume, rate + smoothed ETA,
  listeners, JSON restore, render variants), `createProgressTracker`,
  `formatProgressBar`, `formatPercentage`, `estimateTimeRemaining`,
  `formatTimeRemaining`
- `reporter.ts` (302 lines): `REPORT_SEPARATOR`, `summarizeBuildResult`,
  `formatValidationDetails`, `formatBuildStats`, `formatAsJson`,
  `countBySeverity`, `hasErrors` (+ markdown renderers, tables, stats
  diffs as private helpers)
- `pipeline.ts` (309 lines): `DEFAULT_PIPELINE_OPTIONS`, `Pipeline`
  (use/insert/remove/fluent filter, clone/merge, run/runSingle/dryRun,
  validate/describe), `createPipeline`, `runPipelineStages`,
  `getPipelineStageNames`, `isPipelineSuccess`, `summarizePipelineResult`
- `doctor.ts` (304 lines): `checkNodeVersion`, `checkPackageJson`,
  `checkConfigFile`, `runDoctorChecks` (9 checks: node, package.json,
  config, cwd, dist writability, temp writability, home env, config
  targets, registry URL), `formatDoctorReport`, `hasFailingChecks`,
  `countChecksByStatus`
- `template.ts` (304 lines): `SUPPORTED_TEMPLATE_KINDS`,
  `isTemplateKind`, `getStarterTemplate`, `renderTemplate`,
  `listTemplateVariables`, `createModuleStarter`,
  `getTemplateDescription` (`{{var}}` placeholders; module/agent/tool
  starters with sections, tables, code samples)
- `lockfile.ts` (302 lines): `LockfileEntry`, `createLockfileEntry`,
  `parseLockfile`, `serializeLockfile`, `mergeLockfiles`,
  `verifyLockfile` (names, semver, integrity format, cycle detection),
  `sortLockfileEntries` (+ dependency-graph, semver-compare, transitive
  deps, integrity helpers)

No new dependencies; only node built-ins and existing workspace types.

## Per-file additions — `tests/`

- `tests/config.test.ts`: +8 `it` (clone/get/set/targets/diff/isDefault)
- `tests/errors.test.ts`: +8 `it` (guards/wrap/code/message/format/collect)
- `tests/logger.test.ts`: +8 `it` (levels/compare/enabled/format/silent/memory)
- `tests/plugin.test.ts`: +7 `it` (guard/validate/commands/hooks/manager)
- `tests/types.test.ts`: +7 `it` (pipeline x4, doctor x2, EXIT_CODES)
- `tests/utils.test.ts`: +7 `it` (one per new util)
- `tests/index.test.ts` (new): 8 `it` (metadata, commands, descriptions,
  extensions; argv/exit stubbed because importing the entry runs
  `program.parse()`)
- New: `cache` (12), `progress` (13), `reporter` (8), `pipeline` (10),
  `doctor` (10), `template` (9), `lockfile` (10)

All additions are append-only; no existing test was modified.
