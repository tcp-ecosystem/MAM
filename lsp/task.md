# Task — Harden @mam/lsp with 7 New Features Per File + 7 New Feature Files

## Objective

Add exactly **7 new features to each existing `.ts` file** in `lsp/src`
(10 files), **create 7 new feature files** in `lsp/src/features/` with 7
exports each, and add **>=7 new `it` cases to each test file** in
`lsp/tests` (2 files) — 119 src additions total — **without interrupting
anything that already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the
   behavior/signature of any existing export, type, or function. Existing
   tests must keep passing untouched.
2. **No new dependencies.** Only `vscode-languageserver`,
   `vscode-languageserver-protocol`, `vscode-languageserver-textdocument`,
   `@mam/parser` (already declared).
3. **No comments** in new code (project rule).
4. **Exactly 7 new exported symbols per file** (function, class, constant,
   interface/type, or re-export). Each must be genuinely useful — no trivial
   aliases, no duplicates of existing exports. New exported functions in
   existing feature files delegate to existing private helpers where
   possible instead of duplicating logic.
5. **New files live ONLY in `src/features/`.**
6. **Style:** match the host file (ESM imports with `.js` suffix for local
   modules, JSDoc-free new code, existing naming conventions).
7. **Tests:** each of the 2 test files gains **>=7 new `it` cases**,
   prioritizing coverage of the new features.
8. **Verification (must pass):**
   - `pnpm --filter @mam/lsp typecheck`
   - `pnpm --filter @mam/lsp test`
   - (`lint` is blocked repo-wide: missing
     `@typescript-eslint/eslint-plugin` in this environment.)

---

## Plan — existing `src/` files (10 files x 7)

| File | The 7 features |
|---|---|
| `src/index.ts` | `MAMServer` re-export, `LSP_SERVER_NAME`, `LSP_SERVER_VERSION`, `createMAMServer(connection)`, `registerMAMServerHandlers(connection, server)`, `getMAMServerInfo()`, `isMAMLanguageId(languageId)` |
| `src/server.ts` | `getDocument(uri)`, `getCachedAST(uri)`, `getOpenUris()`, `hasDocument(uri)`, `getDocumentCount()`, `refreshDocument(uri, text, version?)`, `clearCache()` (new public methods; existing handlers untouched) |
| `src/features/completion.ts` | `filterCompletionsByPrefix(items, prefix)`, `sortCompletionsByLabel(items)`, `deduplicateCompletions(items)`, `getTTLValueCompletions()`, `getBooleanValueCompletions()`, `getFrontmatterSnippetCompletion()`, `mergeCompletionLists(...lists)` |
| `src/features/hover.ts` | `getContentTypesForSection(name)`, `getRequiredSections(type)`, `getCommonSections(type)`, `getValueHint(key)`, `getYAMLKeyTypeInfo(key)`, `getYAMLKeyExampleText(key)`, `hasSectionDoc(name)` (public wrappers over existing private helpers/tables) |
| `src/features/diagnostics.ts` | `getRecommendedSectionOrder()`, `countDiagnosticsBySeverity(diagnostics)`, `filterDiagnosticsByCode(diagnostics, code)`, `hasBlockingErrors(diagnostics)`, `validateRequiredSectionsOnly(content, uri?)`, `validateDuplicateSectionsOnly(content, uri?)`, `getDiagnosticSummary(diagnostics)` |
| `src/features/definition.ts` | `getDefinitionAtWord(uri, word, document, ast)`, `findAllSectionDefinitions(document)`, `findAllModuleDefinitions(document)`, `hasDefinition(uri, position, document, ast)`, `getDefinitionKind(uri, position, document, ast)`, `escapeDefinitionPattern(str)`, `collectDefinitionTargets(document)` |
| `src/features/references.ts` | `countReferences(uri, position, document, ast, includeDeclaration)`, `hasReferences(...)`, `findWordReferences(uri, word, document, ast, includeDeclaration)`, `groupReferencesByLine(refs)`, `sortReferencesByPosition(refs)`, `deduplicateLocations(refs)`, `escapeReferencePattern(str)` |
| `src/features/codeAction.ts` | `getOrganizeSectionEdits(text)`, `getMissingSectionEdits(text)`, `suggestClosestRuntime(input)`, `hasFixableDiagnostics(diagnostics)`, `filterActionsByKind(actions, kind)`, `countActionsByKind(actions)`, `getActionTitles(actions)` |
| `src/features/formatting.ts` | `MAMFormattingOptions` interface, `DEFAULT_FORMATTING_OPTIONS`, `isFormatted(content, options?)`, `formatLine(line, options?)`, `trimTrailingWhitespace(content)`, `normalizeBlankLines(content)`, `getFormattingSummary(content, options?)` (formatting.ts takes 1 interface + 1 const + 5 functions = 7) |
| `src/protocol/mam.ts` | `isValidSectionName(name)`, `isValidModuleType(type)`, `isValidLanguage(lang)`, `isValidRuntime(runtime)`, `getSectionDoc(name)`, `getModuleTypeDoc(type)`, `findFrontmatterRange(text)` |

---

## Plan — new `src/features/` files (7 files x 7)

| File | The 7 features |
|---|---|
| `src/features/documentSymbol.ts` | `getDocumentSymbols(document, ast?)`, `hasDocumentSymbols(document, ast?)`, `countDocumentSymbols(document, ast?)`, `findSymbolByName(document, name, ast?)`, `filterSymbolsByKind(document, kind, ast?)`, `flattenSymbols(symbols)`, `getSymbolNames(document, ast?)` (returns `MAMDocumentSymbol[]`; sections nest code blocks as children) |
| `src/features/rename.ts` | `prepareRename(document, position)`, `getRenameEdits(document, position, newName)`, `isRenameableAt(document, position)`, `getRenameRange(document, position)`, `countRenameTargets(document, position)`, `validateNewName(name)`, `findRenameTargets(document, position)` |
| `src/features/documentHighlight.ts` | `getDocumentHighlights(document, position)`, `hasHighlights(document, position)`, `countHighlights(document, position)`, `getHighlightRanges(document, position)`, `groupHighlightsByKind(highlights)`, `isHighlightableAt(document, position)`, `sortHighlights(highlights)` |
| `src/features/foldingRange.ts` | `getFoldingRanges(document)`, `hasFoldingRanges(document)`, `countFoldingRanges(document)`, `getSectionFoldingRanges(document)`, `getCodeBlockFoldingRanges(document)`, `getFrontmatterFoldingRange(document)`, `findLargestFoldingRange(document)` |
| `src/features/signatureHelp.ts` | `getSignatureHelp(line, character)`, `hasSignatureHelp(line, character)`, `getActiveParameterIndex(line, character)`, `getEdgeSignatureItems()`, `formatSignatureLabel(signature)`, `isSignatureTriggerCharacter(ch)`, `countSignatures()` (edge `source -> target` and `name: type` pair signatures) |
| `src/features/codeLens.ts` | `getCodeLenses(document)`, `hasCodeLenses(document)`, `countCodeLenses(document)`, `getSectionCodeLenses(document)`, `getCodeBlockCodeLenses(document)`, `filterCodeLensesByCommand(lenses, command)`, `getCodeLensCommands(document)` |
| `src/features/workspaceSymbol.ts` | `getWorkspaceSymbols(documents, query)`, `hasWorkspaceSymbol(documents, query)`, `countWorkspaceSymbols(documents, query)`, `filterSymbolsByQuery(symbols, query)`, `sortWorkspaceSymbols(symbols)`, `getWorkspaceSymbolNames(documents, query)`, `groupSymbolsByDocument(symbols)` (returns classic `SymbolInformation[]`) |

New files are standalone (not wired into `MAMServer` handlers — wiring
would change existing server behavior). They are covered by tests via
direct relative imports, like the existing feature tests.

---

## Plan — `tests/` (2 files x >=7)

| File | The additions |
|---|---|
| `tests/features.test.ts` | New `describe` blocks + `it` cases for all 7 new feature files (symbols, rename, highlights, folding, signature help, code lens, workspace symbols) |
| `tests/server.test.ts` | New `it` cases for the 7 new `MAMServer` methods (getDocument, getCachedAST, getOpenUris, hasDocument, getDocumentCount, refreshDocument, clearCache) |

---

## Execution Order

1. Extend the 10 existing src files (disjoint files; no cross-file edits
   except none needed).
2. Create the 7 new `src/features/` files.
3. Extend the 2 test files (>=7 new cases each).
4. Run typecheck + test; fix any regressions.
5. Record results in `update.md`.
