# Update — Harden @mam/lsp (7 Per File + 7 New Feature Files)

## Status: DONE except lint (blocked by environment)

All 10 existing `src/` files gained exactly 7 new additive exports, 7 new
feature files (300+ lines each) were created in `src/features/`, both test
files gained >=7 new `it` cases, `typecheck` and `test` pass. `lint`
cannot run: ESLint is missing `@typescript-eslint/eslint-plugin` in this
environment (pre-existing, repo-wide, unrelated to these changes).

## Verification results

- `pnpm --filter @mam/lsp typecheck` — PASS
- `pnpm --filter @mam/lsp test` — PASS: 2 files, 85 tests
  (server.test.ts 22 = 15 existing + 7 new;
  features.test.ts 63 = 49 existing + 14 new)
- `pnpm --filter @mam/lsp lint` — BLOCKED (missing plugin, see above)

## Fixes applied during integration

1. `src/protocol/mam.ts` — `V1_SECTIONS.includes(name)` needed
   `name as any` (const-asserted tuple; TS2345). Matches existing style
   used elsewhere in the package.
2. `src/features/signatureHelp.ts` — `getActiveParameterIndex` treated a
   trailing space after `->` as "no target yet"; fixed so any character
   after the arrow selects parameter 1 (test caught this).
3. `tests/features.test.ts` — workspace-symbol test reused the default
   doc URI for both documents, so grouping produced 1 group instead of 2;
   gave the second doc its own URI (test bug, not source bug).

## Per-file feature list — existing `src/` (10 files x 7)

- `src/index.ts`: `MAMServer` re-export, `LSP_SERVER_NAME`,
  `LSP_SERVER_VERSION`, `createMAMServer(connection)`,
  `registerMAMServerHandlers(connection, server)`, `getMAMServerInfo()`,
  `isMAMLanguageId(languageId)`
- `src/server.ts`: `getDocument(uri)`, `getCachedAST(uri)`,
  `getOpenUris()`, `hasDocument(uri)`, `getDocumentCount()`,
  `refreshDocument(uri, text, version?)`, `clearCache()`
- `src/features/completion.ts`: `filterCompletionsByPrefix`,
  `sortCompletionsByLabel`, `deduplicateCompletions`,
  `getTTLValueCompletions`, `getBooleanValueCompletions`,
  `getFrontmatterSnippetCompletion`, `mergeCompletionLists`
- `src/features/hover.ts`: `getContentTypesForSection`,
  `getRequiredSections`, `getCommonSections`, `getValueHint`,
  `getYAMLKeyTypeInfo`, `getYAMLKeyExampleText`, `hasSectionDoc`
  (public wrappers over the existing private helpers/tables)
- `src/features/diagnostics.ts`: `getRecommendedSectionOrder`,
  `countDiagnosticsBySeverity`, `filterDiagnosticsByCode`,
  `hasBlockingErrors`, `validateRequiredSectionsOnly`,
  `validateDuplicateSectionsOnly`, `getDiagnosticSummary`
- `src/features/definition.ts`: `getDefinitionAtWord`,
  `findAllSectionDefinitions`, `findAllModuleDefinitions`,
  `hasDefinition`, `getDefinitionKind`, `escapeDefinitionPattern`,
  `collectDefinitionTargets`
- `src/features/references.ts`: `countReferences`, `hasReferences`,
  `findWordReferences`, `groupReferencesByLine`,
  `sortReferencesByPosition`, `deduplicateLocations`,
  `escapeReferencePattern`
- `src/features/codeAction.ts`: `getOrganizeSectionEdits`,
  `getMissingSectionEdits`, `suggestClosestRuntime`,
  `hasFixableDiagnostics`, `filterActionsByKind`, `countActionsByKind`,
  `getActionTitles`
- `src/features/formatting.ts`: `MAMFormattingOptions` interface,
  `DEFAULT_FORMATTING_OPTIONS`, `isFormatted`, `formatLine`,
  `trimTrailingWhitespace`, `normalizeBlankLines`, `getFormattingSummary`
- `src/protocol/mam.ts`: `isValidSectionName`, `isValidModuleType`,
  `isValidLanguage`, `isValidRuntime`, `getSectionDoc`,
  `getModuleTypeDoc`, `findFrontmatterRange`

## New `src/features/` files (7 files x 7, all 300+ lines)

- `documentSymbol.ts` (336 lines): `getDocumentSymbols`,
  `hasDocumentSymbols`, `countDocumentSymbols`, `findSymbolByName`,
  `filterSymbolsByKind`, `flattenSymbols`, `getSymbolNames`
  (sections nest code blocks, tables, lists, variables; module
  declarations as top symbols; python/js function/class extraction)
- `rename.ts` (308 lines): `prepareRename`, `getRenameEdits`,
  `isRenameableAt`, `getRenameRange`, `countRenameTargets`,
  `validateNewName`, `findRenameTargets`
  (per-kind targets: section/module/function/variable; reserved words)
- `documentHighlight.ts` (309 lines): `getDocumentHighlights`,
  `hasHighlights`, `countHighlights`, `getHighlightRanges`,
  `groupHighlightsByKind`, `isHighlightableAt`, `sortHighlights`
  (Write kind for declarations, Read for references; merged ranges)
- `foldingRange.ts` (302 lines): `getFoldingRanges`, `hasFoldingRanges`,
  `countFoldingRanges`, `getSectionFoldingRanges`,
  `getCodeBlockFoldingRanges`, `getFrontmatterFoldingRange`,
  `findLargestFoldingRange`
  (also folds mermaid blocks, comments, lists, tables, indented blocks)
- `signatureHelp.ts` (322 lines): `getSignatureHelp`,
  `hasSignatureHelp`, `getActiveParameterIndex`, `getEdgeSignatureItems`,
  `formatSignatureLabel`, `isSignatureTriggerCharacter`, `countSignatures`
  (edge `source -> target`, `key: value` pairs, code fences, frontmatter
  fields, permission values, module declarations)
- `codeLens.ts` (311 lines): `getCodeLenses`, `hasCodeLenses`,
  `countCodeLenses`, `getSectionCodeLenses`, `getCodeBlockCodeLenses`,
  `filterCodeLensesByCommand`, `getCodeLensCommands`
  (reference counts, run-block, word count, validate, outline, mermaid
  preview, table inspect lenses)
- `workspaceSymbol.ts` (326 lines): `getWorkspaceSymbols`,
  `hasWorkspaceSymbol`, `countWorkspaceSymbols`, `filterSymbolsByQuery`,
  `sortWorkspaceSymbols`, `getWorkspaceSymbolNames`,
  `groupSymbolsByDocument`
  (sections, modules, code blocks, YAML keys, functions, tables, lists;
  fuzzy match + relevance scoring helpers)

New files are standalone (not wired into `MAMServer` handlers — wiring
would change existing server behavior). No new dependencies; only
`vscode-languageserver-protocol` types, `TextDocument`, `@mam/parser`
types, and `../protocol/mam.js` helpers.

## Per-file additions — `tests/`

- `tests/features.test.ts`: +14 `it` cases across 7 new describes
  (documentSymbol x2, rename x2, documentHighlight x2, foldingRange x1,
  signatureHelp x2, codeLens x2, workspaceSymbol x2, plus protocol
  `MAMSymbolKind` import)
- `tests/server.test.ts`: +7 `it` cases in a new
  `MAMServer document accessors` describe (one per new server method)

All additions are append-only; no existing test was modified.
