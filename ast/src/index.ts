/**
 * MAM AST
 * 
 * Abstract Syntax Tree for Markdown as Module (MAM) documents.
 * Provides node definitions, visitor pattern, and serialization.
 */

// Location types
export {
  type SourceLocation,
  type Position,
  createPosition,
  createLocation,
  mergeLocations,
  locationToString,
} from './location/index.js';

// Node definitions (v1)
export {
  type NodeType,
  type BaseNode,
  type MAMModule,
  type FrontMatter,
  type FrontMatterData,
  type RuntimeType,
  type Permission,
  type Section,
  type SectionName,
  type SectionAttributes,
  type ContentType,
  type ContentNode,
  type Paragraph,
  type InlineNode,
  type InlineText,
  type InlineCode,
  type Bold,
  type Italic,
  type Link,
  type Image,
  type List,
  type ListItem,
  type CodeBlock,
  type Language,
  type CodeMetadata,
  type Table,
  type TableCell,
  type TableRow,
  type TableColumnAlignment,
  type MermaidDiagram,
  type MermaidDiagramType,
  type Heading,
  type Blockquote,
  REQUIRED_SECTIONS,
  STANDARD_SECTIONS,
  isStandardSection,
  isRequiredSection,
  getNodeType,
  isNodeType,
} from './nodes/index.js';

// Node definitions (v2 - SDL)
export {
  type V2NodeType,
  type V2BaseNode,
  type ModuleType,
  type ModuleTypeDefinition,
  type V2ModuleNode,
  type V2AgentNode,
  type V2ToolNode,
  type V2MemoryNode,
  type V2MemoryReference,
  type V2WorkflowNode,
  type V2StepNode,
  type V2EdgeNode,
  type V2TeamNode,
  type V2PolicyNode,
  type V2SystemNode,
  type V2PortDefinition,
  type V2PermissionSet,
  type V2EventDefinition,
  type V2StateDefinition,
  type V2LifecycleDefinition,
  type V2DependencyDefinition,
  type V2ExportDefinition,
  type V2ImportDefinition,
  type V2HookDefinition,
  type V2ConfigDefinition,
  type V2TransformDefinition,
  type V2ConstraintDefinition,
  MODULE_TYPE_KEYWORDS,
  V2_SECTION_KEYWORDS,
  VALID_MODULE_TYPES,
  isModuleType,
  getModuleTypeDefinition,
} from './nodes/v2/index.js';

// Visitor pattern
export {
  type MAMVisitor,
  DefaultMAMVisitor,
  MAMTransformer,
  MAMCollector,
  traverse,
} from './visitor/index.js';

// Serialization
export {
  type SerializationFormat,
  serializeToJSON,
  deserializeFromJSON,
  prettyPrint,
  getASTStats,
  type ASTStats,
} from './serializer/index.js';

export {
  type SourceSpan,
  type SourcePosition,
  type SpanOptions,
  createSpan,
  spanFromLocation,
  spanAt,
  spanContains,
  spanContainsLine,
  spanOverlap,
  spanMerge,
  spanLineCount,
  spanLength,
  spanCompare,
  spanEquals,
  splitSpanAt,
  spanOffset,
  offsetToPosition,
  positionToOffset,
  spanToString,
  spanToLineRange,
  isValidSpan,
  spanContainsSpan,
  spanIntersection,
  spanGrow,
  spanIsBefore,
  sortSpans,
  spanFromOffsets,
} from './location/span.js';

export {
  positionEquals,
  positionCompare,
  locationLength,
  locationContainsPosition,
  isPositionBefore,
  shiftLocation,
  cloneLocation,
} from './location/index.js';

export {
  traverseWithHooks,
  findFirstNode,
  hasNodeType,
  collectNodeTypes,
  collectCodeBlockLanguages,
  mapParagraphValues,
  MAMProfiler,
} from './visitor/visitor.js';

export {
  findNodes,
  findNodeByType,
  findNodesByType,
  getNodeTypes,
  getMaxDepth,
  collectPaths,
  someNode,
  everyNodeShallow,
  collectValuesByKey,
  countNodes,
  collectText,
  traverse as traverseTree,
} from './visitor/traverser.js';

export {
  estimateJSONSize,
  canonicalSerialize,
  stripLocations,
  diffAST,
  hashAST,
  validateRoundTrip,
  isPlainASTObject,
} from './serializer/json.js';

export {
  escapeYAMLString,
  detectYAMLIndent,
  normalizeYAMLIndent,
  validateYAMLShape,
  serializeFrontMatterToYAML,
  parseFlatYAMLMap,
  yamlHasDocumentMarkers,
} from './serializer/yaml.js';

export {
  getSectionSummaries,
  collectLanguages,
  countInlineNodes,
  astOutline,
  roundTripClone,
  getASTComplexity,
} from './serializer/index.js';

export {
  hasCapabilities,
  countCapabilities,
  summarizeCapabilities,
  withCapability,
  withoutCapability,
  cloneCapabilitiesNode,
  mergeCapabilitiesNodes,
} from './nodes/capabilities.js';

export {
  hasDependencies,
  countDependenciesByType,
  summarizeDependencies,
  withDependency,
  withoutDependency,
  cloneDependenciesNode,
  mergeDependenciesNodes,
} from './nodes/dependencies.js';

export {
  hasExamples,
  countExamplesByTag,
  summarizeExamples,
  withExample,
  withoutExample,
  cloneExamplesNode,
  mergeExamplesNodes,
} from './nodes/examples.js';

export {
  hasExports,
  countExportsByType,
  summarizeExports,
  withExport,
  withoutExport,
  cloneExportsNode,
  mergeExportsNodes,
} from './nodes/exports.js';

export {
  hasImports,
  countImportsBySource,
  summarizeImports,
  withImport,
  withoutImport,
  cloneImportsNode,
  mergeImportsNodes,
} from './nodes/imports.js';

export {
  hasInputs,
  countInputs,
  summarizeInputs,
  withInput,
  withoutInput,
  cloneInputsNode,
  mergeInputsNodes,
} from './nodes/inputs.js';

export {
  hasMemoryIndexes,
  countMemoryIndexes,
  summarizeMemory,
  withMemoryIndex,
  withoutMemoryIndex,
  cloneMemoryNode,
  mergeMemoryConfigurations,
} from './nodes/memory.js';

export {
  summarizeMermaid,
  addMermaidParsedNode,
  removeMermaidParsedNode,
  cloneMermaidNode,
  mergeMermaidNodes,
  getMermaidAdjacency,
  hasMermaidCycle,
} from './nodes/mermaid.js';

export {
  hasMetadataPermissions,
  countMetadataPermissions,
  summarizeMetadata,
  withMetadataPermission,
  withoutMetadataPermission,
  cloneMetadataNode,
  mergeMetadataPermissions,
} from './nodes/metadata.js';

export {
  hasOutputs,
  countOutputs,
  summarizeOutputs,
  withOutput,
  withoutOutput,
  cloneOutputsNode,
  mergeOutputsNodes,
} from './nodes/outputs.js';

export {
  hasPermissions,
  countPermissionConditions,
  summarizePermissions,
  withPermission,
  withoutPermission,
  clonePermissionsNode,
  mergePermissionsNodes,
} from './nodes/permissions.js';

export {
  hasPlugins,
  countEnabledPlugins,
  summarizePlugins,
  withPlugin,
  withoutPlugin,
  clonePluginsNode,
  mergePluginsNodes,
} from './nodes/plugins.js';

export {
  hasPromptVariables,
  countPromptVariables,
  summarizePrompt,
  withPromptVariable,
  withoutPromptVariable,
  clonePromptNode,
  mergePromptNodes,
} from './nodes/prompt.js';

export {
  hasGoals,
  countGoals,
  summarizeSuccessCriteria,
  withGoal,
  withoutGoal,
  clonePurposeNode,
  mergePurposeNodes,
} from './nodes/purpose.js';

export {
  hasPythonFunctions,
  countPythonElements,
  summarizePython,
  withPythonFunction,
  withoutPythonFunction,
  clonePythonNode,
  mergePythonNodes,
} from './nodes/python.js';

export {
  hasReferences,
  countReferencesByType,
  summarizeReferences,
  withReference,
  withoutReference,
  cloneReferencesNode,
  mergeReferencesNodes,
} from './nodes/references.js';

export {
  hasRules,
  countRulesByPriority,
  summarizeRules,
  withRule,
  withoutRule,
  cloneRulesNode,
  mergeRulesNodes,
} from './nodes/rules.js';

export {
  hasTestCases,
  countTestCasesByStatus,
  summarizeTestStatus,
  withTestCase,
  withoutTestCase,
  cloneTestsNode,
  mergeTestsNodes,
} from './nodes/tests.js';

export {
  summarizeWorkflow,
  withWorkflowStep,
  withoutWorkflowStep,
  cloneWorkflowNode,
  mergeWorkflowNodes,
  getIsolatedSteps,
  getLongestPathLength,
} from './nodes/workflow.js';

export {
  isV2NodeType,
  createV2BaseNode,
  cloneV2Node,
  getV2NodeType,
  isModuleTypeDefinition,
  compareModuleTypes,
  createModuleTypeDefinition,
} from './nodes/v2/base.js';

export {
  isV2ModuleNode,
  isV2AgentNode,
  isV2ToolNode,
  isV2WorkflowNode,
  isV2TeamNode,
  createV2ModuleNode,
  V2_NODE_TYPES,
} from './nodes/v2/nodes.js';

export {
  createPortDefinition,
  createPermissionSet,
  isPortDefinition,
  isPermissionSet,
  mergePermissionSets,
  countPorts,
  createMemoryReference,
} from './nodes/v2/supporting.js';

export {
  MODULE_TYPE_COUNT,
  isV2SectionKeyword,
  assertModuleType,
  suggestModuleType,
  hasModuleTypeCapability,
  getSectionKeywordsForModuleType,
  findModuleTypeByAlias,
} from './nodes/v2/keywords.js';

export {
  findSectionByName,
  getSectionNames,
  hasSection,
  countContentNodes,
  isContentNode,
  isInlineNode,
  createEmptyModule,
} from './nodes/index.js';