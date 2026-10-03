# Task — Harden @mam/ast with 7 New Features Per File

## Objective

Add exactly **7 new features to each `.ts` file** in `ast/src` (35 files) and **7 additions to each test file** in `ast/tests` (5 files) — 280 additions total — **without interrupting anything that already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the behavior/signature of any existing export, type, or function. Existing tests must keep passing untouched.
2. **No new dependencies.** Pure TypeScript only.
3. **No comments** in new code (project rule).
4. **Exactly 7 new exported symbols per src file** (function, class, constant, interface/type, or barrel re-export). Each must be a genuinely useful utility — no trivial aliases, no duplicates of existing exports.
5. **Barrel files** (`index.ts`, `mam.ts`) count re-exports as features: 7 new named re-exports each.
6. **Style:** match the host file (ESM imports with `.js` suffix, section banner headers where present, JSDoc-free new code, existing naming conventions).
7. **Tests:** each of the 5 test files gains **≥7 new `it` cases or helpers**, prioritizing coverage of the new src features.
8. **Verification (all must pass):**
   - `pnpm --filter @mam/ast typecheck`
   - `pnpm --filter @mam/ast lint`
   - `pnpm --filter @mam/ast test`

## Feature Template for Section Node Files

Section nodes in `src/nodes/*.ts` follow Types → Validation → Factory → Type Guard → Utilities. Their 7 features follow this domain-tailored template (names use the file’s domain noun; skip any that already exist and substitute an equal-value helper):

1. `has<Domain>(node)` — non-empty predicate
2. `count<Domain>(node)` — total element count
3. `summarize<Domain>(node): string` — one-line human-readable summary
4. `with<Domain>Item(node, item)` — immutable append, returns new node
5. `without<Domain>Item(node, nameOrPredicate)` — immutable remove, returns new node
6. `clone<Domain>Node(node, options?)` — deep clone (optionally strip `location`)
7. `merge<Domain>Nodes(a, b)` — combine elements of two nodes

---

## Plan — `src/` (35 files × 7)

### Group 1 — location / visitor / serializer (8 files)

| File | The 7 features |
|---|---|
| `src/location/index.ts` | `positionEquals`, `positionCompare`, `locationLength` (offset span), `locationContainsPosition`, `isPositionBefore`, `shiftLocation`, `cloneLocation` |
| `src/location/span.ts` | `isValidSpan`, `spanContainsSpan`, `spanIntersection` (`SourceSpan \| null`), `spanGrow`, `spanIsBefore`, `sortSpans`, `spanFromOffsets(text, start, end)` |
| `src/visitor/visitor.ts` | `traverseWithHooks(ast, {enter, leave})`, `findFirstNode(ast, predicate)`, `hasNodeType(ast, type)`, `collectNodeTypes(ast)`, `collectCodeBlockLanguages(ast)`, `mapParagraphValues(ast, fn)`, class `MAMProfiler` (visit counts per node type) |
| `src/visitor/traverser.ts` | `findNodesByType(node, type)` (plural), `getNodeTypes(node)`, `getMaxDepth(node)`, `collectPaths(node)`, `someNode(node, predicate)`, `everyNodeShallow(node, predicate)`, `collectValuesByKey(node, key)` |
| `src/visitor/index.ts` | 7 new re-exports from `visitor.ts` + `traverser.ts` (new symbols above, incl. `traverse as traverseTree` for the traverser variant) |
| `src/serializer/json.ts` | `estimateJSONSize`, `canonicalSerialize` (stable key order), `stripLocations`, `diffAST(a, b)`, `hashAST` (FNV-1a, no deps), `validateRoundTrip(ast)`, `isPlainASTObject(value)` |
| `src/serializer/yaml.ts` | `escapeYAMLString`, `detectYAMLIndent`, `normalizeYAMLIndent`, `validateYAMLShape`, `serializeFrontMatterToYAML`, `parseFlatYAMLMap`, `yamlHasDocumentMarkers` |
| `src/serializer/index.ts` | `findSectionByName`, `getSectionSummaries`, `collectLanguages`, `countInlineNodes`, `astOutline` (string[] of section/content types), `roundTripClone`, `getASTComplexity` (depth + counts) |

### Group 2 — section nodes A (7 files)

| File | The 7 features |
|---|---|
| `src/nodes/capabilities.ts` | `hasCapabilities`, `countCapabilities`, `summarizeCapabilities`, `withCapability`, `withoutCapability`, `cloneCapabilitiesNode`, `mergeCapabilitiesNodes` |
| `src/nodes/dependencies.ts` | `hasDependencies`, `countDependencies`, `summarizeDependencies`, `withDependency`, `withoutDependency`, `cloneDependenciesNode`, `mergeDependenciesNodes` |
| `src/nodes/examples.ts` | `hasExamples`, `countExamples`, `summarizeExamples`, `withExample`, `withoutExample`, `cloneExamplesNode`, `mergeExamplesNodes` |
| `src/nodes/exports.ts` | `hasExports`, `countExports`, `summarizeExports`, `withExport`, `withoutExport`, `cloneExportsNode`, `mergeExportsNodes` |
| `src/nodes/imports.ts` | `hasImports`, `countImports`, `summarizeImports`, `withImport`, `withoutImport`, `cloneImportsNode`, `mergeImportsNodes` |
| `src/nodes/inputs.ts` | `hasInputs`, `countInputs`, `summarizeInputs`, `withInput`, `withoutInput`, `cloneInputsNode`, `mergeInputsNodes` |
| `src/nodes/memory.ts` | `hasMemoryIndexes`, `countMemoryIndexes`, `summarizeMemory`, `withMemoryIndex`, `withoutMemoryIndex`, `cloneMemoryNode`, `mergeMemoryConfigurations` |

### Group 3 — section nodes B (7 files)

| File | The 7 features |
|---|---|
| `src/nodes/mermaid.ts` | `summarizeMermaid`, `addMermaidParsedNode`, `removeMermaidParsedNode`, `cloneMermaidNode`, `mergeMermaidNodes`, `getMermaidAdjacency`, `hasMermaidCycle` |
| `src/nodes/metadata.ts` | `hasMetadataPermissions`, `countMetadataPermissions`, `summarizeMetadata`, `withMetadataPermission`, `withoutMetadataPermission`, `cloneMetadataNode`, `mergeMetadataNodes` |
| `src/nodes/outputs.ts` | `hasOutputs`, `countOutputs`, `summarizeOutputs`, `withOutput`, `withoutOutput`, `cloneOutputsNode`, `mergeOutputsNodes` |
| `src/nodes/permissions.ts` | `hasPermissions`, `countPermissions`, `summarizePermissions`, `withPermission`, `withoutPermission`, `clonePermissionsNode`, `mergePermissionsNodes` |
| `src/nodes/plugins.ts` | `hasPlugins`, `countPlugins`, `summarizePlugins`, `withPlugin`, `withoutPlugin`, `clonePluginsNode`, `mergePluginsNodes` |
| `src/nodes/prompt.ts` | `hasPromptVariables`, `countPromptVariables`, `summarizePrompt`, `withPromptVariable`, `withoutPromptVariable`, `clonePromptNode`, `mergePromptNodes` |
| `src/nodes/purpose.ts` | `hasGoals`, `countGoals`, `summarizePurpose`, `withGoal`, `withoutGoal`, `clonePurposeNode`, `mergePurposeNodes` |

### Group 4 — section nodes C (5 files)

| File | The 7 features |
|---|---|
| `src/nodes/python.ts` | `hasPythonFunctions`, `countPythonElements`, `summarizePython`, `withPythonFunction`, `withoutPythonFunction`, `clonePythonNode`, `mergePythonNodes` |
| `src/nodes/references.ts` | `hasReferences`, `countReferences`, `summarizeReferences`, `withReference`, `withoutReference`, `cloneReferencesNode`, `mergeReferencesNodes` |
| `src/nodes/rules.ts` | `hasRules`, `countRules`, `summarizeRules`, `withRule`, `withoutRule`, `cloneRulesNode`, `mergeRulesNodes` |
| `src/nodes/tests.ts` | `hasTestCases`, `countTestCases`, `summarizeTestStatus` (pass/fail/pending counts), `withTestCase`, `withoutTestCase`, `cloneTestsNode`, `mergeTestsNodes` |
| `src/nodes/workflow.ts` | `summarizeWorkflow`, `withWorkflowStep`, `withoutWorkflowStep`, `cloneWorkflowNode`, `mergeWorkflowNodes`, `getIsolatedSteps`, `getLongestPathLength` (0 if cyclic) |

### Group 5 — core v1 index + v2 (7 files)

| File | The 7 features |
|---|---|
| `src/nodes/index.ts` | `findSectionByName`, `getSectionNames`, `hasSection`, `countContentNodes`, `isContentNode(value)` guard, `isInlineNode(value)` guard, `createEmptyModule(location?)` factory |
| `src/nodes/mam.ts` | 7 new re-exports from `./v2/index.js`: `V2NodeType`, `V2BaseNode`, `ModuleTypeDefinition`, `V2DependencyDefinition`, `V2ExportDefinition`, `V2ImportDefinition`, `V2HookDefinition` (all `export type`) |
| `src/nodes/v2/base.ts` | `isV2BaseNode`, `createV2BaseNode`, `cloneV2Node`, `getV2NodeType`, `isModuleTypeDefinition`, `compareModuleTypes`, `createModuleTypeDefinition` (or closest domain equivalent after reading) |
| `src/nodes/v2/nodes.ts` | `isV2ModuleNode`, `isV2AgentNode`, `isV2ToolNode`, `isV2WorkflowNode`, `isV2TeamNode`, `createV2ModuleNode`, `V2_NODE_TYPES` const array |
| `src/nodes/v2/supporting.ts` | `createPortDefinition`, `createDefaultPermissionSet`, `isPortDefinition`, `isPermissionSet`, `mergePermissionSets`, `countPorts`, `createMemoryReference` |
| `src/nodes/v2/keywords.ts` | `isV2SectionKeyword`, `assertModuleType` (throwing), `suggestModuleType` (nearest valid type), `getModuleTypeCapabilities`, `getSectionKeywordsForModuleType`, `MODULE_TYPE_COUNT`, `findModuleTypeByAlias` |
| `src/nodes/v2/index.ts` | 7 new re-exports of the new symbols from `base.ts`, `nodes.ts`, `supporting.ts`, `keywords.ts` |

### Root barrel (owned by integrator)

| File | The 7 features |
|---|---|
| `src/index.ts` | Re-export groups promised by README or introduced by this task: (1) span utilities from `location/span.js`, (2) new location helpers, (3) new traverser/visitor helpers, (4) new serializer helpers, (5) new section-node helper families, (6) new v2 runtime helpers/guards, (7) new nodes/index helpers |

---

## Plan — `tests/` (5 files × 7)

| File | The 7 additions |
|---|---|
| `tests/location.test.ts` | New `it` cases for: position compare/equal, location length/contains/shift/clone, span validity, span containment of spans, intersection, grow, is-before, sortSpans, spanFromOffsets |
| `tests/visitor.test.ts` | New `it` cases for: traverseWithHooks, findFirstNode/hasNodeType, collectNodeTypes, code-block language collection, mapParagraphValues, MAMProfiler, traverser depth/path/type helpers |
| `tests/serializer.test.ts` | New `it` cases for: canonicalSerialize stability, hashAST determinism, stripLocations, diffAST, round-trip validation, YAML helpers, serializer/index helpers (outline/complexity/roundTripClone) |
| `tests/nodes.test.ts` | New `it` cases covering Group 2 + Group 4 section-node features (has/count/summarize/with/without/clone/merge samples) |
| `tests/section-nodes.test.ts` | New `it` cases covering Group 3 + workflow/v1-index/v2 features (guards, factories, merge/clone, keyword helpers) |

---

## Execution Order

1. Groups 1–5 implement src features in parallel (disjoint file sets; no cross-group edits).
2. Test agents extend the 5 test files (≥7 new cases each).
3. Integrator adds the 7 root `src/index.ts` re-export groups.
4. Run typecheck + lint + test; fix any regressions.
5. Record results in `update.md`.
