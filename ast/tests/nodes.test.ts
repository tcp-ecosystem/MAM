/**
 * AST Node Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isStandardSection,
  isRequiredSection,
  getNodeType,
  isNodeType,
  createLocation,
  createPosition,
  mergeLocations,
  locationToString,
  REQUIRED_SECTIONS,
  STANDARD_SECTIONS,
} from '../src/index.js';
import {
  createCapabilitiesNode,
  validateCapabilitiesNode,
  isCapabilitiesNode,
  createCapability,
  createCapabilityPort,
  getCapabilityNames,
  findCapabilityByName,
  getCapabilitiesByLevel,
  getAllInputPortNames,
  getAllOutputPortNames,
  getAllRequirements,
  countPorts,
} from '../src/nodes/capabilities.js';
import {
  createDependenciesNode,
  validateDependenciesNode,
  isDependenciesNode,
  createDependency,
  getDependencyNames,
  findDependencyByName,
  getDependenciesBySource,
  getDependenciesByType,
  getOptionalDependencies,
  getRequiredDependencies,
  getRuntimeDependencies,
  hasDependency,
  countDependencies,
} from '../src/nodes/dependencies.js';
import {
  createExamplesNode,
  validateExamplesNode,
  isExamplesNode,
  createExampleEntry,
  getExampleTitles,
  findExampleByTitle,
  findExamplesByTag,
  getNegativeExamples,
  getPositiveExamples,
  getExamplesWithExpected,
  getAllTags,
  countExamples,
} from '../src/nodes/examples.js';
import {
  createExportsNode,
  validateExportsNode,
  isExportsNode,
  createExportItem,
  getExportNames,
  findExportByName,
  getExportsByType,
  getReExports,
  getLocalExports,
  hasExport,
  countExports,
} from '../src/nodes/exports.js';
import {
  createImportsNode,
  validateImportsNode,
  isImportsNode,
  createImportItem,
  getImportNames,
  findImportByName,
  findImportsBySource,
  getSourceModules,
  hasImport as hasImportItem,
  countImports,
} from '../src/nodes/imports.js';
import {
  createInputsNode,
  validateInputsNode,
  isInputsNode,
  createInputPort,
  createInputValidation,
  getInputPortNames,
  findInputPortByName,
  getRequiredInputPorts,
  getOptionalInputPorts,
  getInputPortsByType,
  hasInputPort,
  countInputPorts,
  summarizeInputPorts,
} from '../src/nodes/inputs.js';
import {
  createMemoryNode,
  validateMemoryNode,
  isMemoryNode,
  createMemoryIndex,
  createMemoryConfiguration,
  getIndexNames,
  findIndexByName,
  getConfigurationKeys,
  findConfigurationByKey,
  isVectorMemory,
  isEncrypted,
  countIndexes,
} from '../src/nodes/memory.js';
import {
  createMermaidNode,
  validateMermaidNode,
  isMermaidNode,
  detectDiagramType,
  parseNodes,
  parseEdges,
  getMermaidNodeIds,
  hasMermaidNode,
  countMermaidElements,
} from '../src/nodes/mermaid.js';
import {
  createMetadataNode,
  validateMetadataNode,
  isMetadataNode,
  createMetadataPermission,
  createMetadataDependency,
  getTags,
  hasTag,
  getPermissionResources,
  findPermissionByResource,
  getDependencyNames as getMetadataDepNames,
  hasDependency as hasMetadataDep,
  mergeMetadataNodes,
} from '../src/nodes/metadata.js';
import {
  createOutputsNode,
  validateOutputsNode,
  isOutputsNode,
  createOutputPort,
  createOutputSchema,
  getOutputPortNames,
  findOutputPortByName,
  getOutputPortsByType,
  hasOutputPort,
  countOutputPorts,
  summarizeOutputPorts,
  getNullableOutputPorts,
} from '../src/nodes/outputs.js';
import {
  createPermissionsNode,
  validatePermissionsNode,
  isPermissionsNode,
  createPermission,
  createPermissionCondition,
  getPermissionResources as getPermResources,
  findPermissionByResource as findPermByResource,
  getPermissionsByLevel,
  getPermissionsByResourceKind,
  getOptionalPermissions,
  getRequiredPermissions,
  requiresAdminAccess,
  hasPermission,
  countPermissions,
} from '../src/nodes/permissions.js';
import {
  createPluginsNode,
  validatePluginsNode,
  isPluginsNode,
  createPluginRef,
  getPluginNames,
  findPluginByName,
  getPluginsBySource,
  getEnabledPlugins,
  getDisabledPlugins,
  getEnabledPluginCapabilities,
  isPluginEnabled,
  hasPlugin,
  countPlugins,
} from '../src/nodes/plugins.js';
import {
  createPromptNode,
  validatePromptNode,
  isPromptNode,
  createPromptVariable,
  createPromptTemplate,
  extractVariablesFromContent,
  getDeclaredVariableNames,
  getReferencedVariableNames,
  findVariableByName,
  getRequiredVariables,
  hasVariable,
  findTemplateById,
  getTemplateIds,
  buildFullPrompt,
} from '../src/nodes/prompt.js';
import {
  createPurposeNode,
  validatePurposeNode,
  isPurposeNode,
  createPurposeGoal,
  createSuccessCriterion,
  getGoalIds,
  findGoalById,
  getGoalsByPriority,
  getSuccessCriterionIds,
  findSuccessCriterionById,
  getConstraints,
  getNonGoals,
  summarizePurpose,
} from '../src/nodes/purpose.js';
import {
  createPythonNode,
  validatePythonNode,
  isPythonNode,
  createPythonImport,
  createPythonFunction,
  createPythonClass,
  getImportModuleNames,
  getFunctionNames,
  findFunctionByName,
  getClassNames,
  findClassByName,
  getAsyncFunctions,
  countLines,
  hasImport,
  getRequiredPackages,
} from '../src/nodes/python.js';
import {
  createReferencesNode,
  validateReferencesNode,
  isReferencesNode,
  createReference,
  getReferenceTitles,
  findReferenceByTitle,
  findReferencesByType,
  findReferencesByTag,
  getReferencesWithUrl,
  getAllReferenceTags,
  countReferences,
} from '../src/nodes/references.js';
import {
  createRulesNode,
  validateRulesNode,
  isRulesNode,
  createRule,
  getRulesByPriority,
  getRulesByCategory,
  getRulesBySeverity,
  getActiveRules,
  getInactiveRules,
  getAllCategories,
  getAllRuleTags,
  countRules,
  countActiveRules,
} from '../src/nodes/rules.js';
import {
  createTestsNode,
  validateTestsNode,
  isTestsNode,
  createTestCase,
  getTestCaseNames,
  findTestCaseByName,
  findTestCasesByTag,
  getSkippedTestCases,
  getActiveTestCases,
  getTestCasesByStatus,
  getAllTestTags,
  countTestCases,
  countCompleteTestCases,
} from '../src/nodes/tests.js';
import {
  createWorkflowNode,
  validateWorkflowNode,
  isWorkflowNode,
  createWorkflowStep,
  createWorkflowEdge,
  getStepNames,
  findStepByName,
  getRootSteps,
  getLeafSteps,
  getSuccessors,
  getPredecessors,
  hasCycle,
  topologicalSort,
  countWorkflowElements,
} from '../src/nodes/workflow.js';

function loc() {
  return createLocation(1, 0, 0, 10, 5, 100, 'test.mam.md');
}

describe('Location Utilities', () => {
  it('should create position', () => {
    const pos = createPosition(1, 0, 0);
    expect(pos).toEqual({ line: 1, column: 0, offset: 0 });
  });

  it('should create location', () => {
    const l = createLocation(1, 0, 0, 10, 5, 100, 'file.md');
    expect(l.start.line).toBe(1);
    expect(l.end.line).toBe(10);
    expect(l.source).toBe('file.md');
  });

  it('should merge locations picking earliest start and latest end', () => {
    const a = createLocation(1, 0, 0, 5, 10, 50, 'a.md');
    const b = createLocation(3, 0, 20, 8, 5, 80, 'b.md');
    const merged = mergeLocations(a, b);
    expect(merged.start.offset).toBe(0);
    expect(merged.end.offset).toBe(80);
    expect(merged.source).toBe('a.md');
  });

  it('should format location to string', () => {
    const l = createLocation(5, 3, 0, 10, 0, 0, 'file.md');
    expect(locationToString(l)).toBe('file.md:5:3');
  });
});

describe('Node Type Helpers', () => {
  it('should identify standard sections', () => {
    expect(isStandardSection('Purpose')).toBe(true);
    expect(isStandardSection('Inputs')).toBe(true);
    expect(isStandardSection('Custom')).toBe(false);
  });

  it('should identify required sections', () => {
    expect(isRequiredSection('Purpose')).toBe(true);
    expect(isRequiredSection('Inputs')).toBe(false);
  });

  it('should get node type', () => {
    const node = { type: 'MAMModule' as const, location: loc() };
    expect(getNodeType(node)).toBe('MAMModule');
  });

  it('should check node type with isNodeType', () => {
    const node = { type: 'MAMModule' as const, location: loc() };
    expect(isNodeType(node, 'MAMModule')).toBe(true);
    expect(isNodeType(node, 'Section')).toBe(false);
  });

  it('should have correct REQUIRED_SECTIONS', () => {
    expect(REQUIRED_SECTIONS).toContain('Purpose');
    expect(REQUIRED_SECTIONS).not.toContain('Inputs');
  });

  it('should have correct STANDARD_SECTIONS', () => {
    expect(STANDARD_SECTIONS).toContain('Purpose');
    expect(STANDARD_SECTIONS).toContain('Capabilities');
    expect(STANDARD_SECTIONS).toContain('Workflow');
    expect(STANDARD_SECTIONS.length).toBeGreaterThan(10);
  });
});

describe('CapabilitiesNode', () => {
  it('should create empty capabilities node', () => {
    const node = createCapabilitiesNode();
    expect(node.type).toBe('Capabilities');
    expect(node.capabilities).toEqual([]);
  });

  it('should create node with capabilities', () => {
    const cap = createCapability('chat', {
      description: 'Chat capability',
      level: 'advanced',
      inputs: [createCapabilityPort('message', 'string', true)],
      outputs: [createCapabilityPort('response', 'string', true)],
    });
    const node = createCapabilitiesNode({ capabilities: [cap] });
    expect(node.capabilities).toHaveLength(1);
    expect(node.capabilities[0].name).toBe('chat');
  });

  it('should validate valid node', () => {
    const node = createCapabilitiesNode({
      capabilities: [createCapability('test')],
    });
    expect(validateCapabilitiesNode(node)).toEqual([]);
  });

  it('should detect invalid type', () => {
    const errors = validateCapabilitiesNode({ type: 'Wrong', capabilities: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should detect non-array capabilities', () => {
    const errors = validateCapabilitiesNode({ type: 'Capabilities', capabilities: 'bad' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should detect invalid capability name', () => {
    const errors = validateCapabilitiesNode({
      type: 'Capabilities',
      capabilities: [{ name: '' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should detect invalid level', () => {
    const errors = validateCapabilitiesNode({
      type: 'Capabilities',
      capabilities: [{ name: 'test', level: 'invalid' as any }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should type guard correctly', () => {
    expect(isCapabilitiesNode({ type: 'Capabilities', capabilities: [] })).toBe(true);
    expect(isCapabilitiesNode({ type: 'Wrong' })).toBe(false);
    expect(isCapabilitiesNode(null)).toBe(false);
    expect(isCapabilitiesNode('string')).toBe(false);
  });

  it('should get capability names', () => {
    const node = createCapabilitiesNode({
      capabilities: [
        createCapability('a'),
        createCapability('b'),
      ],
    });
    expect(getCapabilityNames(node)).toEqual(['a', 'b']);
  });

  it('should find capability by name', () => {
    const node = createCapabilitiesNode({
      capabilities: [createCapability('target')],
    });
    expect(findCapabilityByName(node, 'target')).toBeDefined();
    expect(findCapabilityByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by level', () => {
    const node = createCapabilitiesNode({
      capabilities: [
        createCapability('a', { level: 'basic' }),
        createCapability('b', { level: 'advanced' }),
      ],
    });
    expect(getCapabilitiesByLevel(node, 'advanced')).toHaveLength(1);
    expect(getCapabilitiesByLevel(node, 'basic')).toHaveLength(1);
  });

  it('should get all input/output port names', () => {
    const node = createCapabilitiesNode({
      capabilities: [
        createCapability('a', {
          inputs: [createCapabilityPort('in1', 'string')],
          outputs: [createCapabilityPort('out1', 'number')],
        }),
      ],
    });
    expect(getAllInputPortNames(node)).toEqual(['in1']);
    expect(getAllOutputPortNames(node)).toEqual(['out1']);
  });

  it('should collect all requirements', () => {
    const node = createCapabilitiesNode({
      capabilities: [
        createCapability('a', {
          requirements: [{ id: 'r1', description: 'test', type: 'permission' }],
        }),
      ],
    });
    expect(getAllRequirements(node)).toHaveLength(1);
  });

  it('should count ports', () => {
    const node = createCapabilitiesNode({
      capabilities: [
        createCapability('a', {
          inputs: [createCapabilityPort('in1', 'string'), createCapabilityPort('in2', 'number')],
          outputs: [createCapabilityPort('out1', 'boolean')],
        }),
      ],
    });
    expect(countPorts(node)).toBe(3);
  });

  it('should handle empty capabilities in utilities', () => {
    const node = createCapabilitiesNode();
    expect(getCapabilityNames(node)).toEqual([]);
    expect(findCapabilityByName(node, 'x')).toBeUndefined();
    expect(getCapabilitiesByLevel(node, 'basic')).toEqual([]);
    expect(getAllInputPortNames(node)).toEqual([]);
    expect(getAllOutputPortNames(node)).toEqual([]);
    expect(getAllRequirements(node)).toEqual([]);
    expect(countPorts(node)).toBe(0);
  });
});

describe('DependenciesNode', () => {
  it('should create node', () => {
    const node = createDependenciesNode({
      dependencies: [createDependency('lodash', { version: '^4.0.0', source: 'npm' })],
    });
    expect(node.type).toBe('Dependencies');
    expect(node.dependencies).toHaveLength(1);
  });

  it('should validate valid node', () => {
    const node = createDependenciesNode({
      dependencies: [createDependency('pkg')],
    });
    expect(validateDependenciesNode(node)).toEqual([]);
  });

  it('should detect duplicate dependencies', () => {
    const errors = validateDependenciesNode({
      type: 'Dependencies',
      dependencies: [
        { name: 'pkg', optional: false },
        { name: 'pkg', optional: false },
      ],
    });
    expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isDependenciesNode({ type: 'Dependencies', dependencies: [] })).toBe(true);
    expect(isDependenciesNode(null)).toBe(false);
  });

  it('should find dependency by name', () => {
    const node = createDependenciesNode({
      dependencies: [createDependency('found')],
    });
    expect(findDependencyByName(node, 'found')).toBeDefined();
    expect(findDependencyByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by source', () => {
    const node = createDependenciesNode({
      dependencies: [
        createDependency('a', { source: 'npm' }),
        createDependency('b', { source: 'pip' }),
      ],
    });
    expect(getDependenciesBySource(node, 'npm')).toHaveLength(1);
  });

  it('should filter by type', () => {
    const node = createDependenciesNode({
      dependencies: [
        createDependency('a', { type: 'runtime' }),
        createDependency('b', { type: 'dev' }),
      ],
    });
    expect(getDependenciesByType(node, 'runtime')).toHaveLength(1);
  });

  it('should separate optional and required', () => {
    const node = createDependenciesNode({
      dependencies: [
        createDependency('a', { optional: true }),
        createDependency('b', { optional: false }),
        createDependency('c'),
      ],
    });
    expect(getOptionalDependencies(node)).toHaveLength(1);
    expect(getRequiredDependencies(node)).toHaveLength(2);
  });

  it('should get runtime dependencies', () => {
    const node = createDependenciesNode({
      dependencies: [
        createDependency('a', { type: 'runtime' }),
        createDependency('b'),
      ],
    });
    expect(getRuntimeDependencies(node)).toHaveLength(2);
  });

  it('should check hasDependency', () => {
    const node = createDependenciesNode({
      dependencies: [createDependency('exists')],
    });
    expect(hasDependency(node, 'exists')).toBe(true);
    expect(hasDependency(node, 'nope')).toBe(false);
  });

  it('should count dependencies', () => {
    const node = createDependenciesNode({
      dependencies: [createDependency('a'), createDependency('b')],
    });
    expect(countDependencies(node)).toBe(2);
  });
});

describe('ExamplesNode', () => {
  it('should create node with examples', () => {
    const node = createExamplesNode({
      examples: [createExampleEntry('Basic', 'input', { expected: 'output' })],
    });
    expect(node.type).toBe('Examples');
    expect(node.examples).toHaveLength(1);
  });

  it('should validate valid node', () => {
    const node = createExamplesNode({
      examples: [createExampleEntry('Test', 'input')],
    });
    expect(validateExamplesNode(node)).toEqual([]);
  });

  it('should detect invalid example title', () => {
    const errors = validateExamplesNode({
      type: 'Examples',
      examples: [{ title: '', input: 'data' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should type guard correctly', () => {
    expect(isExamplesNode({ type: 'Examples', examples: [] })).toBe(true);
    expect(isExamplesNode(null)).toBe(false);
  });

  it('should find examples by tag', () => {
    const node = createExamplesNode({
      examples: [
        createExampleEntry('A', 'in', { tags: ['fast'] }),
        createExampleEntry('B', 'in', { tags: ['slow'] }),
      ],
    });
    expect(findExamplesByTag(node, 'fast')).toHaveLength(1);
    expect(findExamplesByTag(node, 'missing')).toHaveLength(0);
  });

  it('should get negative/positive examples', () => {
    const node = createExamplesNode({
      examples: [
        createExampleEntry('Pos', 'in', { negative: false }),
        createExampleEntry('Neg', 'in', { negative: true }),
      ],
    });
    expect(getNegativeExamples(node)).toHaveLength(1);
    expect(getPositiveExamples(node)).toHaveLength(1);
  });

  it('should get examples with expected output', () => {
    const node = createExamplesNode({
      examples: [
        createExampleEntry('A', 'in', { expected: 'out' }),
        createExampleEntry('B', 'in'),
      ],
    });
    expect(getExamplesWithExpected(node)).toHaveLength(1);
  });

  it('should collect all tags', () => {
    const node = createExamplesNode({
      examples: [
        createExampleEntry('A', 'in', { tags: ['x', 'y'] }),
        createExampleEntry('B', 'in', { tags: ['y', 'z'] }),
      ],
    });
    expect(getAllTags(node)).toEqual(expect.arrayContaining(['x', 'y', 'z']));
  });

  it('should count examples', () => {
    const node = createExamplesNode({
      examples: [createExampleEntry('A', 'in'), createExampleEntry('B', 'in')],
    });
    expect(countExamples(node)).toBe(2);
  });
});

describe('ExportsNode', () => {
  it('should create node', () => {
    const node = createExportsNode({
      items: [createExportItem('myFunc', { type: 'function' })],
    });
    expect(node.type).toBe('Exports');
  });

  it('should validate valid node', () => {
    const node = createExportsNode({
      items: [createExportItem('func')],
    });
    expect(validateExportsNode(node)).toEqual([]);
  });

  it('should detect re-export without from', () => {
    const errors = validateExportsNode({
      type: 'Exports',
      items: [{ name: 'x', reexport: true }],
    });
    expect(errors.some(e => e.message.includes('from'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isExportsNode({ type: 'Exports', items: [] })).toBe(true);
    expect(isExportsNode(null)).toBe(false);
  });

  it('should find export by name', () => {
    const node = createExportsNode({
      items: [createExportItem('target')],
    });
    expect(findExportByName(node, 'target')).toBeDefined();
  });

  it('should filter by type', () => {
    const node = createExportsNode({
      items: [
        createExportItem('fn', { type: 'function' }),
        createExportItem('cls', { type: 'class' }),
      ],
    });
    expect(getExportsByType(node, 'function')).toHaveLength(1);
  });

  it('should separate re-exports and local', () => {
    const node = createExportsNode({
      items: [
        createExportItem('local'),
        createExportItem('re', { reexport: true, from: 'other' }),
      ],
    });
    expect(getReExports(node)).toHaveLength(1);
    expect(getLocalExports(node)).toHaveLength(1);
  });

  it('should check hasExport', () => {
    const node = createExportsNode({ items: [createExportItem('x')] });
    expect(hasExport(node, 'x')).toBe(true);
    expect(hasExport(node, 'y')).toBe(false);
  });

  it('should count exports', () => {
    const node = createExportsNode({
      items: [createExportItem('a'), createExportItem('b')],
    });
    expect(countExports(node)).toBe(2);
  });
});

describe('ImportsNode', () => {
  it('should create node', () => {
    const node = createImportsNode({
      items: [createImportItem('React', 'react')],
    });
    expect(node.type).toBe('Imports');
  });

  it('should validate valid node', () => {
    const node = createImportsNode({
      items: [createImportItem('pkg', 'source')],
    });
    expect(validateImportsNode(node)).toEqual([]);
  });

  it('should detect missing source', () => {
    const errors = validateImportsNode({
      type: 'Imports',
      items: [{ name: 'x', source: '' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should type guard correctly', () => {
    expect(isImportsNode({ type: 'Imports', items: [] })).toBe(true);
    expect(isImportsNode(null)).toBe(false);
  });

  it('should find import by name', () => {
    const node = createImportsNode({
      items: [createImportItem('found', 'src')],
    });
    expect(findImportByName(node, 'found')).toBeDefined();
  });

  it('should find imports by source', () => {
    const node = createImportsNode({
      items: [
        createImportItem('a', 'pkg'),
        createImportItem('b', 'pkg'),
        createImportItem('c', 'other'),
      ],
    });
    expect(findImportsBySource(node, 'pkg')).toHaveLength(2);
  });

  it('should get source modules', () => {
    const node = createImportsNode({
      items: [
        createImportItem('a', 'pkg1'),
        createImportItem('b', 'pkg2'),
      ],
    });
    expect(getSourceModules(node)).toEqual(expect.arrayContaining(['pkg1', 'pkg2']));
  });

  it('should check hasImport', () => {
    const node = createImportsNode({
      items: [createImportItem('exists', 'src')],
    });
    expect(hasImportItem(node, 'exists')).toBe(true);
    expect(hasImportItem(node, 'nope')).toBe(false);
  });

  it('should count imports', () => {
    const node = createImportsNode({
      items: [createImportItem('a', 's'), createImportItem('b', 's')],
    });
    expect(countImports(node)).toBe(2);
  });
});

describe('InputsNode', () => {
  it('should create node', () => {
    const node = createInputsNode({
      ports: [createInputPort('query', 'string', true)],
    });
    expect(node.type).toBe('Inputs');
  });

  it('should validate valid node', () => {
    const node = createInputsNode({
      ports: [createInputPort('p', 'string')],
    });
    expect(validateInputsNode(node)).toEqual([]);
  });

  it('should detect duplicate port names', () => {
    const errors = validateInputsNode({
      type: 'Inputs',
      ports: [
        { name: 'p', type: 'string', required: false },
        { name: 'p', type: 'number', required: false },
      ],
    });
    expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should validate input validation constraints', () => {
    const port = createInputPort('p', 'number', true, {
      validation: createInputValidation({ min: 0, max: 100 }),
    });
    const node = createInputsNode({ ports: [port] });
    expect(validateInputsNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isInputsNode({ type: 'Inputs', ports: [] })).toBe(true);
    expect(isInputsNode(null)).toBe(false);
  });

  it('should filter required/optional ports', () => {
    const node = createInputsNode({
      ports: [
        createInputPort('a', 'string', true),
        createInputPort('b', 'string', false),
      ],
    });
    expect(getRequiredInputPorts(node)).toHaveLength(1);
    expect(getOptionalInputPorts(node)).toHaveLength(1);
  });

  it('should filter by type', () => {
    const node = createInputsNode({
      ports: [
        createInputPort('a', 'string'),
        createInputPort('b', 'number'),
      ],
    });
    expect(getInputPortsByType(node, 'string')).toHaveLength(1);
  });

  it('should summarize ports', () => {
    const node = createInputsNode({
      ports: [createInputPort('q', 'string', true)],
    });
    expect(summarizeInputPorts(node)).toContain('q');
    expect(summarizeInputPorts(node)).toContain('required');
  });

  it('should count input ports', () => {
    const node = createInputsNode({
      ports: [createInputPort('a', 'string'), createInputPort('b', 'number')],
    });
    expect(countInputPorts(node)).toBe(2);
  });
});

describe('MemoryNode', () => {
  it('should create node', () => {
    const node = createMemoryNode({ format: 'vector', backend: 'chroma' });
    expect(node.type).toBe('Memory');
  });

  it('should validate valid node', () => {
    const node = createMemoryNode({ format: 'vector', scope: 'module' });
    expect(validateMemoryNode(node)).toEqual([]);
  });

  it('should detect invalid format', () => {
    const errors = validateMemoryNode({
      type: 'Memory',
      format: 'invalid' as any,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should detect invalid ttl format', () => {
    const errors = validateMemoryNode({
      type: 'Memory',
      ttl: 'invalid-ttl',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should validate indexes', () => {
    const node = createMemoryNode({
      indexes: [createMemoryIndex('idx', ['field1'])],
    });
    expect(validateMemoryNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isMemoryNode({ type: 'Memory' })).toBe(true);
    expect(isMemoryNode(null)).toBe(false);
  });

  it('should check vector memory', () => {
    expect(isVectorMemory(createMemoryNode({ format: 'vector' }))).toBe(true);
    expect(isVectorMemory(createMemoryNode({ format: 'key-value' }))).toBe(false);
  });

  it('should check encrypted', () => {
    expect(isEncrypted(createMemoryNode({ encrypted: true }))).toBe(true);
    expect(isEncrypted(createMemoryNode())).toBe(false);
  });

  it('should get index names', () => {
    const node = createMemoryNode({
      indexes: [createMemoryIndex('i1', ['f1']), createMemoryIndex('i2', ['f2'])],
    });
    expect(getIndexNames(node)).toEqual(['i1', 'i2']);
  });

  it('should find configuration by key', () => {
    const node = createMemoryNode({
      configuration: [createMemoryConfiguration('timeout', '30s')],
    });
    expect(findConfigurationByKey(node, 'timeout')).toBeDefined();
  });

  it('should count indexes', () => {
    const node = createMemoryNode({
      indexes: [createMemoryIndex('a', ['f'])],
    });
    expect(countIndexes(node)).toBe(1);
  });
});

describe('MermaidNode', () => {
  it('should create node with auto-parsing', () => {
    const content = 'flowchart LR\n  A[Start] --> B[End]';
    const node = createMermaidNode({ content });
    expect(node.type).toBe('Mermaid');
    expect(node.diagramType).toBe('flowchart');
    expect(node.parsedNodes?.length).toBeGreaterThan(0);
  });

  it('should detect diagram types', () => {
    expect(detectDiagramType('flowchart TD')).toBe('flowchart');
    expect(detectDiagramType('sequenceDiagram')).toBe('sequence');
    expect(detectDiagramType('classDiagram')).toBe('class');
    expect(detectDiagramType('stateDiagram')).toBe('state');
    expect(detectDiagramType('erDiagram')).toBe('er');
    expect(detectDiagramType('gantt')).toBe('gantt');
    expect(detectDiagramType('pie')).toBe('pie');
    expect(detectDiagramType('unknown stuff')).toBe('unknown');
  });

  it('should parse nodes', () => {
    const nodes = parseNodes('A[Label] --> B\nC{Decision}');
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse edges', () => {
    const edges = parseEdges('A --> B\nB --> C');
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it('should validate valid node', () => {
    const node = createMermaidNode({ content: 'flowchart LR' });
    expect(validateMermaidNode(node)).toEqual([]);
  });

  it('should detect missing content', () => {
    const errors = validateMermaidNode({
      type: 'Mermaid',
      diagramType: 'flowchart',
      content: '',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should type guard correctly', () => {
    expect(isMermaidNode({ type: 'Mermaid', content: 'x' })).toBe(true);
    expect(isMermaidNode(null)).toBe(false);
  });

  it('should get node ids', () => {
    const node = createMermaidNode({ content: 'A[Hello] --> B[World]' });
    expect(getMermaidNodeIds(node)).toContain('A');
  });

  it('should check has node', () => {
    const node = createMermaidNode({ content: 'A[Hello] --> B[World]' });
    expect(hasMermaidNode(node, 'A')).toBe(true);
    expect(hasMermaidNode(node, 'Z')).toBe(false);
  });

  it('should count elements', () => {
    const node = createMermaidNode({ content: 'A --> B' });
    const counts = countMermaidElements(node);
    expect(counts.nodes).toBeGreaterThanOrEqual(0);
  });
});

describe('MetadataNode', () => {
  it('should create node', () => {
    const node = createMetadataNode({ id: 'mod-1', name: 'Test Module' });
    expect(node.type).toBe('Metadata');
  });

  it('should validate valid node', () => {
    const node = createMetadataNode({ version: '1.0.0' });
    expect(validateMetadataNode(node)).toEqual([]);
  });

  it('should detect invalid semver', () => {
    const errors = validateMetadataNode({
      type: 'Metadata',
      version: 'not-a-version',
    });
    expect(errors.some(e => e.message.includes('semver'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isMetadataNode({ type: 'Metadata' })).toBe(true);
    expect(isMetadataNode(null)).toBe(false);
  });

  it('should get tags', () => {
    const node = createMetadataNode({ tags: ['ai', 'ml'] });
    expect(getTags(node)).toEqual(['ai', 'ml']);
  });

  it('should check hasTag', () => {
    const node = createMetadataNode({ tags: ['ai'] });
    expect(hasTag(node, 'ai')).toBe(true);
    expect(hasTag(node, 'ml')).toBe(false);
  });

  it('should merge metadata nodes', () => {
    const base = createMetadataNode({ id: 'a', tags: ['x'] });
    const override = createMetadataNode({ name: 'B', tags: ['y'] });
    const merged = mergeMetadataNodes(base, override);
    expect(merged.id).toBe('a');
    expect(merged.name).toBe('B');
    expect(merged.tags).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('should get permission resources', () => {
    const node = createMetadataNode({
      permissions: [createMetadataPermission('fs', 'read')],
    });
    expect(getPermissionResources(node)).toEqual(['fs']);
  });

  it('should find permission by resource', () => {
    const node = createMetadataNode({
      permissions: [createMetadataPermission('net', 'write')],
    });
    expect(findPermissionByResource(node, 'net')).toBeDefined();
  });

  it('should check has dependency', () => {
    const node = createMetadataNode({
      dependencies: [createMetadataDependency('pkg')],
    });
    expect(hasMetadataDep(node, 'pkg')).toBe(true);
    expect(hasMetadataDep(node, 'nope')).toBe(false);
  });
});

describe('OutputsNode', () => {
  it('should create node', () => {
    const node = createOutputsNode({
      ports: [createOutputPort('result', 'string')],
    });
    expect(node.type).toBe('Outputs');
  });

  it('should validate valid node', () => {
    const node = createOutputsNode({
      ports: [createOutputPort('out', 'json')],
    });
    expect(validateOutputsNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isOutputsNode({ type: 'Outputs', ports: [] })).toBe(true);
    expect(isOutputsNode(null)).toBe(false);
  });

  it('should find output port', () => {
    const node = createOutputsNode({
      ports: [createOutputPort('target', 'string')],
    });
    expect(findOutputPortByName(node, 'target')).toBeDefined();
  });

  it('should filter by type', () => {
    const node = createOutputsNode({
      ports: [
        createOutputPort('a', 'string'),
        createOutputPort('b', 'number'),
      ],
    });
    expect(getOutputPortsByType(node, 'string')).toHaveLength(1);
  });

  it('should get nullable ports', () => {
    const node = createOutputsNode({
      ports: [
        createOutputPort('a', 'string', {
          schema: createOutputSchema({ nullable: true }),
        }),
      ],
    });
    expect(getNullableOutputPorts(node)).toHaveLength(1);
  });

  it('should summarize output ports', () => {
    const node = createOutputsNode({
      ports: [createOutputPort('res', 'json')],
    });
    expect(summarizeOutputPorts(node)).toContain('res');
  });

  it('should count output ports', () => {
    const node = createOutputsNode({
      ports: [createOutputPort('a', 'string'), createOutputPort('b', 'number')],
    });
    expect(countOutputPorts(node)).toBe(2);
  });
});

describe('PermissionsNode', () => {
  it('should create node', () => {
    const node = createPermissionsNode({
      permissions: [createPermission('fs:/tmp/*', 'read')],
    });
    expect(node.type).toBe('Permissions');
  });

  it('should validate valid node', () => {
    const node = createPermissionsNode({
      permissions: [createPermission('net:api.com', 'write')],
    });
    expect(validatePermissionsNode(node)).toEqual([]);
  });

  it('should validate conditions', () => {
    const perm = createPermission('fs:/tmp', 'read', {
      conditions: [createPermissionCondition('env', 'prod', 'Only in prod')],
    });
    const node = createPermissionsNode({ permissions: [perm] });
    expect(validatePermissionsNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isPermissionsNode({ type: 'Permissions', permissions: [] })).toBe(true);
    expect(isPermissionsNode(null)).toBe(false);
  });

  it('should filter by level', () => {
    const node = createPermissionsNode({
      permissions: [
        createPermission('a', 'read'),
        createPermission('b', 'write'),
      ],
    });
    expect(getPermissionsByLevel(node, 'read')).toHaveLength(1);
  });

  it('should filter by resource kind', () => {
    const node = createPermissionsNode({
      permissions: [
        createPermission('a', 'read', { resourceKind: 'filesystem' }),
        createPermission('b', 'read', { resourceKind: 'network' }),
      ],
    });
    expect(getPermissionsByResourceKind(node, 'filesystem')).toHaveLength(1);
  });

  it('should separate optional/required', () => {
    const node = createPermissionsNode({
      permissions: [
        createPermission('a', 'read', { optional: true }),
        createPermission('b', 'write'),
      ],
    });
    expect(getOptionalPermissions(node)).toHaveLength(1);
    expect(getRequiredPermissions(node)).toHaveLength(1);
  });

  it('should check admin access', () => {
    const node = createPermissionsNode({
      permissions: [createPermission('a', 'admin')],
    });
    expect(requiresAdminAccess(node)).toBe(true);
  });

  it('should check hasPermission', () => {
    const node = createPermissionsNode({
      permissions: [createPermission('fs:/tmp', 'read')],
    });
    expect(hasPermission(node, 'fs:/tmp')).toBe(true);
    expect(hasPermission(node, 'nope')).toBe(false);
  });

  it('should count permissions', () => {
    const node = createPermissionsNode({
      permissions: [createPermission('a', 'read'), createPermission('b', 'write')],
    });
    expect(countPermissions(node)).toBe(2);
  });
});

describe('PluginsNode', () => {
  it('should create node', () => {
    const node = createPluginsNode({
      plugins: [createPluginRef('my-plugin')],
    });
    expect(node.type).toBe('Plugins');
  });

  it('should validate valid node', () => {
    const node = createPluginsNode({
      plugins: [createPluginRef('p')],
    });
    expect(validatePluginsNode(node)).toEqual([]);
  });

  it('should detect duplicate plugins', () => {
    const errors = validatePluginsNode({
      type: 'Plugins',
      plugins: [
        { name: 'p', enabled: true },
        { name: 'p', enabled: true },
      ],
    });
    expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isPluginsNode({ type: 'Plugins', plugins: [] })).toBe(true);
    expect(isPluginsNode(null)).toBe(false);
  });

  it('should separate enabled/disabled', () => {
    const node = createPluginsNode({
      plugins: [
        createPluginRef('a', { enabled: true }),
        createPluginRef('b', { enabled: false }),
      ],
    });
    expect(getEnabledPlugins(node)).toHaveLength(1);
    expect(getDisabledPlugins(node)).toHaveLength(1);
  });

  it('should get enabled plugin capabilities', () => {
    const node = createPluginsNode({
      plugins: [
        createPluginRef('a', { capabilities: ['feat1', 'feat2'] }),
      ],
    });
    expect(getEnabledPluginCapabilities(node)).toEqual(expect.arrayContaining(['feat1', 'feat2']));
  });

  it('should check isPluginEnabled', () => {
    const node = createPluginsNode({
      plugins: [createPluginRef('on', { enabled: true })],
    });
    expect(isPluginEnabled(node, 'on')).toBe(true);
    expect(isPluginEnabled(node, 'off')).toBe(false);
  });

  it('should check hasPlugin', () => {
    const node = createPluginsNode({
      plugins: [createPluginRef('exists')],
    });
    expect(hasPlugin(node, 'exists')).toBe(true);
    expect(hasPlugin(node, 'nope')).toBe(false);
  });

  it('should count plugins', () => {
    const node = createPluginsNode({
      plugins: [createPluginRef('a'), createPluginRef('b')],
    });
    expect(countPlugins(node)).toBe(2);
  });
});

describe('PromptNode', () => {
  it('should create node', () => {
    const node = createPromptNode({ content: 'Hello {{name}}' });
    expect(node.type).toBe('Prompt');
  });

  it('should extract variables from content', () => {
    const vars = extractVariablesFromContent('Hello {{name}}, you are {{age}} years old');
    expect(vars).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('should extract variables with different delimiters', () => {
    const vars = extractVariablesFromContent('{a} and {{b}} and ${c}');
    expect(vars).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('should validate valid node', () => {
    const node = createPromptNode({ content: 'test' });
    expect(validatePromptNode(node)).toEqual([]);
  });

  it('should detect invalid temperature', () => {
    const errors = validatePromptNode({
      type: 'Prompt',
      content: 'test',
      temperature: 5,
    });
    expect(errors.some(e => e.message.includes('temperature'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isPromptNode({ type: 'Prompt', content: 'x' })).toBe(true);
    expect(isPromptNode(null)).toBe(false);
  });

  it('should build full prompt', () => {
    const node = createPromptNode({
      content: 'User message',
      systemPrompt: 'System instruction',
    });
    expect(buildFullPrompt(node)).toBe('System instruction\nUser message');
  });

  it('should find variable by name', () => {
    const node = createPromptNode({
      content: '{{x}}',
      variables: [createPromptVariable('x', { type: 'string' })],
    });
    expect(findVariableByName(node, 'x')).toBeDefined();
  });

  it('should get required variables', () => {
    const node = createPromptNode({
      content: '{{a}} {{b}}',
      variables: [
        createPromptVariable('a', { required: true }),
        createPromptVariable('b', { required: false }),
      ],
    });
    expect(getRequiredVariables(node)).toHaveLength(1);
  });

  it('should find template by id', () => {
    const node = createPromptNode({
      content: '{{t}}',
      templates: [createPromptTemplate('t1', 'template content')],
    });
    expect(findTemplateById(node, 't1')).toBeDefined();
    expect(getTemplateIds(node)).toEqual(['t1']);
  });

  it('should get referenced variables from content', () => {
    const node = createPromptNode({ content: '{{a}} and {{b}}' });
    expect(getReferencedVariableNames(node)).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('PurposeNode', () => {
  it('should create node', () => {
    const node = createPurposeNode({ content: 'Module purpose' });
    expect(node.type).toBe('Purpose');
  });

  it('should validate valid node', () => {
    const node = createPurposeNode({ content: 'purpose' });
    expect(validatePurposeNode(node)).toEqual([]);
  });

  it('should validate goals and criteria', () => {
    const node = createPurposeNode({
      content: 'purpose',
      goals: [createPurposeGoal('g1', 'Goal description')],
      successCriteria: [createSuccessCriterion('c1', 'Criterion description')],
    });
    expect(validatePurposeNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isPurposeNode({ type: 'Purpose', content: 'x' })).toBe(true);
    expect(isPurposeNode(null)).toBe(false);
  });

  it('should get goals by priority', () => {
    const node = createPurposeNode({
      content: 'p',
      goals: [
        createPurposeGoal('low', 'Low goal', { priority: 'low' }),
        createPurposeGoal('high', 'High goal', { priority: 'high' }),
      ],
    });
    const sorted = getGoalsByPriority(node);
    expect(sorted[0].id).toBe('high');
  });

  it('should find goal by id', () => {
    const node = createPurposeNode({
      content: 'p',
      goals: [createPurposeGoal('g1', 'desc')],
    });
    expect(findGoalById(node, 'g1')).toBeDefined();
  });

  it('should get constraints and non-goals', () => {
    const node = createPurposeNode({
      content: 'p',
      constraints: ['c1'],
      nonGoals: ['ng1'],
    });
    expect(getConstraints(node)).toEqual(['c1']);
    expect(getNonGoals(node)).toEqual(['ng1']);
  });

  it('should summarize purpose', () => {
    const node = createPurposeNode({
      content: 'Main purpose',
      goals: [createPurposeGoal('g1', 'd')],
    });
    const summary = summarizePurpose(node);
    expect(summary).toContain('Main purpose');
    expect(summary).toContain('Goals: 1');
  });
});

describe('PythonNode', () => {
  it('should create node', () => {
    const node = createPythonNode({ code: 'print("hello")' });
    expect(node.type).toBe('Python');
    expect(node.executable).toBe(true);
  });

  it('should validate valid node', () => {
    const node = createPythonNode({ code: 'x = 1' });
    expect(validatePythonNode(node)).toEqual([]);
  });

  it('should validate imports', () => {
    const node = createPythonNode({
      code: 'import os',
      imports: [createPythonImport('os')],
    });
    expect(validatePythonNode(node)).toEqual([]);
  });

  it('should validate functions and classes', () => {
    const node = createPythonNode({
      code: 'def foo(): pass\nclass Bar: pass',
      functions: [createPythonFunction('foo')],
      classes: [createPythonClass('Bar')],
    });
    expect(validatePythonNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isPythonNode({ type: 'Python', code: 'x' })).toBe(true);
    expect(isPythonNode(null)).toBe(false);
  });

  it('should get function/class names', () => {
    const node = createPythonNode({
      code: 'def a(): pass\ndef b(): pass\nclass C: pass',
      functions: [createPythonFunction('a'), createPythonFunction('b')],
      classes: [createPythonClass('C')],
    });
    expect(getFunctionNames(node)).toEqual(['a', 'b']);
    expect(getClassNames(node)).toEqual(['C']);
  });

  it('should find function by name', () => {
    const node = createPythonNode({
      code: 'def test(): pass',
      functions: [createPythonFunction('test', { async: true })],
    });
    const fn = findFunctionByName(node, 'test');
    expect(fn).toBeDefined();
    expect(fn?.async).toBe(true);
  });

  it('should get async functions', () => {
    const node = createPythonNode({
      code: 'async def a(): pass\ndef b(): pass',
      functions: [
        createPythonFunction('a', { async: true }),
        createPythonFunction('b'),
      ],
    });
    expect(getAsyncFunctions(node)).toHaveLength(1);
  });

  it('should count lines', () => {
    const node = createPythonNode({ code: 'line1\nline2\nline3' });
    expect(countLines(node)).toBe(3);
  });

  it('should check hasImport', () => {
    const node = createPythonNode({
      code: 'import os',
      imports: [createPythonImport('os')],
    });
    expect(hasImport(node, 'os')).toBe(true);
    expect(hasImport(node, 'sys')).toBe(false);
  });

  it('should get required packages', () => {
    const node = createPythonNode({
      code: 'import numpy',
      imports: [createPythonImport('numpy')],
      execution: { packages: ['pandas'] },
    });
    const pkgs = getRequiredPackages(node);
    expect(pkgs).toEqual(expect.arrayContaining(['numpy', 'pandas']));
  });
});

describe('ReferencesNode', () => {
  it('should create node', () => {
    const node = createReferencesNode({
      references: [createReference('Docs', { url: 'https://example.com' })],
    });
    expect(node.type).toBe('References');
  });

  it('should validate valid node', () => {
    const node = createReferencesNode({
      references: [createReference('Ref')],
    });
    expect(validateReferencesNode(node)).toEqual([]);
  });

  it('should type guard correctly', () => {
    expect(isReferencesNode({ type: 'References', references: [] })).toBe(true);
    expect(isReferencesNode(null)).toBe(false);
  });

  it('should find reference by title', () => {
    const node = createReferencesNode({
      references: [createReference('My Ref')],
    });
    expect(findReferenceByTitle(node, 'my ref')).toBeDefined();
  });

  it('should find references by type', () => {
    const node = createReferencesNode({
      references: [
        createReference('A', { type: 'documentation' }),
        createReference('B', { type: 'paper' }),
      ],
    });
    expect(findReferencesByType(node, 'documentation')).toHaveLength(1);
  });

  it('should find references by tag', () => {
    const node = createReferencesNode({
      references: [createReference('A', { tags: ['ai'] })],
    });
    expect(findReferencesByTag(node, 'ai')).toHaveLength(1);
  });

  it('should get references with url', () => {
    const node = createReferencesNode({
      references: [
        createReference('A', { url: 'https://a.com' }),
        createReference('B'),
      ],
    });
    expect(getReferencesWithUrl(node)).toHaveLength(1);
  });

  it('should collect all tags', () => {
    const node = createReferencesNode({
      references: [
        createReference('A', { tags: ['x'] }),
        createReference('B', { tags: ['y'] }),
      ],
    });
    expect(getAllReferenceTags(node)).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('should count references', () => {
    const node = createReferencesNode({
      references: [createReference('A'), createReference('B')],
    });
    expect(countReferences(node)).toBe(2);
  });
});

describe('RulesNode', () => {
  it('should create node', () => {
    const node = createRulesNode({
      rules: [createRule('Always validate input')],
    });
    expect(node.type).toBe('Rules');
  });

  it('should validate valid node', () => {
    const node = createRulesNode({
      rules: [createRule('Rule text')],
    });
    expect(validateRulesNode(node)).toEqual([]);
  });

  it('should detect invalid priority', () => {
    const errors = validateRulesNode({
      type: 'Rules',
      rules: [{ text: 'rule', priority: 'invalid' as any }],
    });
    expect(errors.some(e => e.message.includes('priority'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isRulesNode({ type: 'Rules', rules: [] })).toBe(true);
    expect(isRulesNode(null)).toBe(false);
  });

  it('should get rules by priority', () => {
    const node = createRulesNode({
      rules: [
        createRule('Low', { priority: 'low' }),
        createRule('High', { priority: 'high' }),
      ],
    });
    const sorted = getRulesByPriority(node);
    expect(sorted[0].priority).toBe('high');
  });

  it('should filter by category', () => {
    const node = createRulesNode({
      rules: [
        createRule('Safety', { category: 'safety' }),
        createRule('Style', { category: 'style' }),
      ],
    });
    expect(getRulesByCategory(node, 'safety')).toHaveLength(1);
  });

  it('should separate active/inactive', () => {
    const node = createRulesNode({
      rules: [
        createRule('Active', { active: true }),
        createRule('Inactive', { active: false }),
      ],
    });
    expect(getActiveRules(node)).toHaveLength(1);
    expect(getInactiveRules(node)).toHaveLength(1);
  });

  it('should get all categories', () => {
    const node = createRulesNode({
      rules: [
        createRule('A', { category: 'safety' }),
        createRule('B', { category: 'style' }),
      ],
    });
    expect(getAllCategories(node)).toEqual(expect.arrayContaining(['safety', 'style']));
  });

  it('should count rules', () => {
    const node = createRulesNode({
      rules: [createRule('A'), createRule('B')],
    });
    expect(countRules(node)).toBe(2);
    expect(countActiveRules(node)).toBe(2);
  });
});

describe('TestsNode', () => {
  it('should create node', () => {
    const node = createTestsNode({
      cases: [createTestCase('Basic test')],
    });
    expect(node.type).toBe('Tests');
  });

  it('should validate valid node', () => {
    const node = createTestsNode({
      cases: [createTestCase('test')],
    });
    expect(validateTestsNode(node)).toEqual([]);
  });

  it('should detect duplicate test names', () => {
    const errors = validateTestsNode({
      type: 'Tests',
      cases: [
        { name: 'test', skip: false },
        { name: 'test', skip: false },
      ],
    });
    expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isTestsNode({ type: 'Tests', cases: [] })).toBe(true);
    expect(isTestsNode(null)).toBe(false);
  });

  it('should filter by status', () => {
    const node = createTestsNode({
      cases: [
        createTestCase('pass', { status: 'pass' }),
        createTestCase('fail', { status: 'fail' }),
      ],
    });
    expect(getTestCasesByStatus(node, 'pass')).toHaveLength(1);
    expect(getTestCasesByStatus(node, 'fail')).toHaveLength(1);
  });

  it('should separate skipped/active', () => {
    const node = createTestsNode({
      cases: [
        createTestCase('a', { skip: false }),
        createTestCase('b', { skip: true }),
      ],
    });
    expect(getSkippedTestCases(node)).toHaveLength(1);
    expect(getActiveTestCases(node)).toHaveLength(1);
  });

  it('should find test by name', () => {
    const node = createTestsNode({
      cases: [createTestCase('target')],
    });
    expect(findTestCaseByName(node, 'target')).toBeDefined();
  });

  it('should count complete test cases', () => {
    const node = createTestsNode({
      cases: [
        createTestCase('complete', { input: 'in', expected: 'out' }),
        createTestCase('incomplete'),
      ],
    });
    expect(countCompleteTestCases(node)).toBe(1);
  });

  it('should collect all test tags', () => {
    const node = createTestsNode({
      cases: [
        createTestCase('a', { tags: ['unit'] }),
        createTestCase('b', { tags: ['integration'] }),
      ],
    });
    expect(getAllTestTags(node)).toEqual(expect.arrayContaining(['unit', 'integration']));
  });
});

describe('WorkflowNode', () => {
  it('should create node', () => {
    const node = createWorkflowNode({
      steps: [createWorkflowStep('start')],
    });
    expect(node.type).toBe('Workflow');
  });

  it('should validate valid node', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
      ],
      edges: [createWorkflowEdge('a', 'b')],
    });
    expect(validateWorkflowNode(node)).toEqual([]);
  });

  it('should detect duplicate step names', () => {
    const errors = validateWorkflowNode({
      type: 'Workflow',
      steps: [
        { name: 'a' },
        { name: 'a' },
      ],
    });
    expect(errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should detect edge referencing unknown step', () => {
    const errors = validateWorkflowNode({
      type: 'Workflow',
      steps: [{ name: 'a' }],
      edges: [{ from: 'a', to: 'z' }],
    });
    expect(errors.some(e => e.message.includes('unknown step'))).toBe(true);
  });

  it('should type guard correctly', () => {
    expect(isWorkflowNode({ type: 'Workflow', steps: [] })).toBe(true);
    expect(isWorkflowNode(null)).toBe(false);
  });

  it('should detect cycles', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
      ],
      edges: [
        createWorkflowEdge('a', 'b'),
        createWorkflowEdge('b', 'a'),
      ],
    });
    expect(hasCycle(node)).toBe(true);
  });

  it('should detect no cycle', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
        createWorkflowStep('c'),
      ],
      edges: [
        createWorkflowEdge('a', 'b'),
        createWorkflowEdge('b', 'c'),
      ],
    });
    expect(hasCycle(node)).toBe(false);
  });

  it('should topological sort', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
        createWorkflowStep('c'),
      ],
      edges: [
        createWorkflowEdge('a', 'b'),
        createWorkflowEdge('b', 'c'),
      ],
    });
    const order = topologicalSort(node);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('should throw on cycle in topological sort', () => {
    const node = createWorkflowNode({
      steps: [createWorkflowStep('a'), createWorkflowStep('b')],
      edges: [createWorkflowEdge('a', 'b'), createWorkflowEdge('b', 'a')],
    });
    expect(() => topologicalSort(node)).toThrow('cycle');
  });

  it('should get root and leaf steps', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
        createWorkflowStep('c'),
      ],
      edges: [
        createWorkflowEdge('a', 'b'),
        createWorkflowEdge('b', 'c'),
      ],
    });
    expect(getRootSteps(node)).toHaveLength(1);
    expect(getRootSteps(node)[0].name).toBe('a');
    expect(getLeafSteps(node)).toHaveLength(1);
    expect(getLeafSteps(node)[0].name).toBe('c');
  });

  it('should get successors and predecessors', () => {
    const node = createWorkflowNode({
      steps: [
        createWorkflowStep('a'),
        createWorkflowStep('b'),
        createWorkflowStep('c'),
      ],
      edges: [
        createWorkflowEdge('a', 'b'),
        createWorkflowEdge('b', 'c'),
      ],
    });
    expect(getSuccessors(node, 'a')).toEqual(['b']);
    expect(getPredecessors(node, 'c')).toEqual(['b']);
  });

  it('should count workflow elements', () => {
    const node = createWorkflowNode({
      steps: [createWorkflowStep('a'), createWorkflowStep('b')],
      edges: [createWorkflowEdge('a', 'b')],
    });
    const counts = countWorkflowElements(node);
    expect(counts.steps).toBe(2);
    expect(counts.edges).toBe(1);
  });
});
