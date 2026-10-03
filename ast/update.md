# Update — Harden @mam/ast (7 New Features Per File)

## Status: DONE except lint (blocked by environment)

All 35 `src/` files gained exactly 7 new additive exports, all 5 test files
gained >=7 new `it` cases, `typecheck` and `test` pass. `lint` cannot run:
ESLint is missing `@typescript-eslint/eslint-plugin` in this environment
(pre-existing install issue, unrelated to these changes).

## Verification results

- `pnpm --filter @mam/ast typecheck` — PASS
- `pnpm --filter @mam/ast test` — PASS: 5 files, 617 tests
  (visitor 86, serializer 61, section-nodes 172, nodes 210, location 88)
- `pnpm --filter @mam/ast lint` — BLOCKED: `ESLint couldn't find the
  plugin "@typescript-eslint/eslint-plugin"`

## Fixes applied during integration

1. `src/nodes/rules.ts` — `countActiveRules(node).length` changed to
   `countActiveRules(node)` (it returns a number; TS2339).
2. `src/index.ts` — traverser re-export `traverseTree` changed to
   `traverse as traverseTree` (traverser exports `traverse`; TS2724).
3. `src/nodes/plugins.ts` — implemented the missing 7 features by hand
   (a worker agent reported success without modifying the file).

## Per-file feature list — `src/`

### location / visitor / serializer

- `src/location/index.ts`: `positionEquals`, `positionCompare`,
  `locationLength`, `locationContainsPosition`, `isPositionBefore`,
  `shiftLocation`, `cloneLocation`
- `src/location/span.ts`: `isValidSpan`, `spanContainsSpan`,
  `spanIntersection`, `spanGrow`, `spanIsBefore`, `sortSpans`,
  `spanFromOffsets`
- `src/visitor/visitor.ts`: `traverseWithHooks`, `findFirstNode`,
  `hasNodeType`, `collectNodeTypes`, `collectCodeBlockLanguages`,
  `mapParagraphValues`, `MAMProfiler`
- `src/visitor/traverser.ts`: `findNodesByType`, `getNodeTypes`,
  `getMaxDepth`, `collectPaths`, `someNode`, `everyNodeShallow`,
  `collectValuesByKey`
- `src/visitor/index.ts`: 7 new re-exports (incl.
  `traverse as traverseTree`)
- `src/serializer/json.ts`: `estimateJSONSize`, `canonicalSerialize`,
  `stripLocations`, `diffAST`, `hashAST`, `validateRoundTrip`,
  `isPlainASTObject`
- `src/serializer/yaml.ts`: `escapeYAMLString`, `detectYAMLIndent`,
  `normalizeYAMLIndent`, `validateYAMLShape`,
  `serializeFrontMatterToYAML`, `parseFlatYAMLMap`,
  `yamlHasDocumentMarkers`
- `src/serializer/index.ts`: `findSectionByName`, `getSectionSummaries`,
  `collectLanguages`, `countInlineNodes`, `astOutline`, `roundTripClone`,
  `getASTComplexity`

### Section nodes

- `capabilities.ts`: `hasCapabilities`, `countCapabilities`,
  `summarizeCapabilities`, `withCapability`, `withoutCapability`,
  `cloneCapabilitiesNode`, `mergeCapabilitiesNodes`
- `dependencies.ts`: `hasDependencies`, `countDependenciesByType` (sub),
  `summarizeDependencies`, `withDependency`, `withoutDependency`,
  `cloneDependenciesNode`, `mergeDependenciesNodes`
- `examples.ts`: `hasExamples`, `countExamplesByTag` (sub),
  `summarizeExamples`, `withExample`, `withoutExample`,
  `cloneExamplesNode`, `mergeExamplesNodes`
- `exports.ts`: `hasExports`, `countExportsByType` (sub),
  `summarizeExports`, `withExport`, `withoutExport`, `cloneExportsNode`,
  `mergeExportsNodes`
- `imports.ts`: `hasImports`, `countImportsBySource` (sub),
  `summarizeImports`, `withImport`, `withoutImport`, `cloneImportsNode`,
  `mergeImportsNodes`
- `inputs.ts`: `hasInputs`, `countInputs`, `summarizeInputs`, `withInput`,
  `withoutInput`, `cloneInputsNode`, `mergeInputsNodes`
- `memory.ts`: `hasMemoryIndexes`, `countMemoryIndexes`,
  `summarizeMemory`, `withMemoryIndex`, `withoutMemoryIndex`,
  `cloneMemoryNode`, `mergeMemoryConfigurations`
- `mermaid.ts`: `summarizeMermaid`, `addMermaidParsedNode`,
  `removeMermaidParsedNode`, `cloneMermaidNode`, `mergeMermaidNodes`,
  `getMermaidAdjacency`, `hasMermaidCycle`
- `metadata.ts`: `hasMetadataPermissions`, `countMetadataPermissions`,
  `summarizeMetadata`, `withMetadataPermission`,
  `withoutMetadataPermission`, `cloneMetadataNode`,
  `mergeMetadataPermissions` (sub; returns `MetadataPermission[]`)
- `outputs.ts`: `hasOutputs`, `countOutputs`, `summarizeOutputs`,
  `withOutput`, `withoutOutput`, `cloneOutputsNode`, `mergeOutputsNodes`
- `permissions.ts`: `hasPermissions`, `countPermissionConditions` (sub),
  `summarizePermissions`, `withPermission`, `withoutPermission`,
  `clonePermissionsNode`, `mergePermissionsNodes`
- `plugins.ts`: `hasPlugins`, `countEnabledPlugins` (sub),
  `summarizePlugins`, `withPlugin`, `withoutPlugin`,
  `clonePluginsNode`, `mergePluginsNodes`
- `prompt.ts`: `hasPromptVariables`, `countPromptVariables`,
  `summarizePrompt`, `withPromptVariable`, `withoutPromptVariable`,
  `clonePromptNode`, `mergePromptNodes`
- `purpose.ts`: `hasGoals`, `countGoals`, `summarizeSuccessCriteria`
  (sub for existing `summarizePurpose`), `withGoal`, `withoutGoal`,
  `clonePurposeNode`, `mergePurposeNodes`
- `python.ts`: `hasPythonFunctions`, `countPythonElements`,
  `summarizePython`, `withPythonFunction`, `withoutPythonFunction`,
  `clonePythonNode`, `mergePythonNodes`
- `references.ts`: `hasReferences`, `countReferencesByType` (sub),
  `summarizeReferences`, `withReference`, `withoutReference`,
  `cloneReferencesNode`, `mergeReferencesNodes`
- `rules.ts`: `hasRules`, `countRulesByPriority` (sub),
  `summarizeRules`, `withRule`, `withoutRule`, `cloneRulesNode`,
  `mergeRulesNodes`
- `tests.ts`: `hasTestCases`, `countTestCasesByStatus` (sub),
  `summarizeTestStatus`, `withTestCase`, `withoutTestCase`,
  `cloneTestsNode`, `mergeTestsNodes`
- `workflow.ts`: `summarizeWorkflow`, `withWorkflowStep`,
  `withoutWorkflowStep`, `cloneWorkflowNode`, `mergeWorkflowNodes`,
  `getIsolatedSteps`, `getLongestPathLength`

### Core v1 index + v2

- `src/nodes/index.ts`: `findSectionByName`, `getSectionNames`,
  `hasSection`, `countContentNodes`, `isContentNode`, `isInlineNode`,
  `createEmptyModule`
- `src/nodes/mam.ts`: 7 type re-exports from `./v2/index.js`
  (`V2NodeType`, `V2BaseNode`, `ModuleTypeDefinition`,
  `V2DependencyDefinition`, `V2ExportDefinition`, `V2ImportDefinition`,
  `V2HookDefinition`)
- `src/nodes/v2/base.ts`: `isV2NodeType` (sub), `createV2BaseNode`,
  `cloneV2Node`, `getV2NodeType`, `isModuleTypeDefinition`,
  `compareModuleTypes`, `createModuleTypeDefinition`
- `src/nodes/v2/nodes.ts`: `isV2ModuleNode`, `isV2AgentNode`,
  `isV2ToolNode`, `isV2WorkflowNode`, `isV2TeamNode`,
  `createV2ModuleNode`, `V2_NODE_TYPES`
- `src/nodes/v2/supporting.ts`: `createPortDefinition`,
  `createPermissionSet`, `isPortDefinition`, `isPermissionSet`,
  `mergePermissionSets`, `countPorts`, `createMemoryReference`
- `src/nodes/v2/keywords.ts`: `MODULE_TYPE_COUNT`,
  `isV2SectionKeyword`, `assertModuleType`, `suggestModuleType`,
  `hasModuleTypeCapability`, `getSectionKeywordsForModuleType`,
  `findModuleTypeByAlias`
- `src/nodes/v2/index.ts`: 7 re-exports of the new base/nodes/
  supporting/keywords symbols
- `src/index.ts` (root): re-export groups for span utilities, location
  helpers, visitor/traverser helpers, serializer helpers, all 19
  section-node families, v2 helpers/guards, and nodes/index helpers

## Substitutions (name already existed, equal-value helper used)

`countDependenciesByType`, `countExamplesByTag`, `countExportsByType`,
`countImportsBySource`, `countPermissionConditions`,
`countReferencesByType`, `countRulesByPriority`,
`countTestCasesByStatus`, `countEnabledPlugins`,
`mergeMetadataPermissions` (array merge; `mergeMetadataNodes` existed),
`summarizeSuccessCriteria` (purpose; `summarizePurpose` existed),
`isV2NodeType` (base; `isV2BaseNode` existed).

Known collisions left as-is: `findSectionByName` exists in both
`serializer/index.ts` and `nodes/index.ts` (root exports only the nodes
version); `countPorts` exists in `capabilities.ts` and `v2/supporting.ts`
(root exports only the v2 version); `isV2ModuleNode` etc. exist in both
`v2/base.ts` and `v2/nodes.ts` (root exports only the nodes version).

## Per-file additions — `tests/`

- `tests/location.test.ts`: +41 `it` cases (position compare/equal,
  location length/contains/shift/clone, span validity/containment/
  intersection/grow/is-before/sort/from-offsets)
- `tests/visitor.test.ts`: new `it` cases (traverseWithHooks,
  findFirstNode/hasNodeType, collectNodeTypes, code-block languages,
  mapParagraphValues, MAMProfiler, depth/path/type helpers)
- `tests/serializer.test.ts`: +17 `it` cases (canonicalSerialize,
  hashAST, stripLocations, diffAST, round-trip, YAML helpers,
  outline/complexity/roundTripClone)
- `tests/nodes.test.ts`: +11 `it` cases (Group 2 + Group 4
  has/count/summarize/with/without/clone/merge samples)
- `tests/section-nodes.test.ts`: +24 `it` cases across 10 new describes
  (mermaid graph ops + cycle, workflow summarize/add/remove/clone/merge/
  isolated/longest-path, metadata, outputs, permissions, prompt, purpose,
  plugins, v1 index helpers, v2 nodes/ports/keywords)

All additions are append-only; no existing test was modified.
