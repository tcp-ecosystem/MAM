/**
 * Section Node Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createCapabilitiesNode,
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
  createPermissionsNode,
  createPermission,
  hasPermission,
  countPermissions,
  getPermissionsByLevel,
  getPermissionsByResourceKind,
  getOptionalPermissions,
  getRequiredPermissions,
  requiresAdminAccess,
  getPermissionResources,
  findPermissionByResource,
} from '../src/nodes/permissions.js';
import {
  createMermaidNode,
  detectDiagramType,
  parseNodes,
  parseEdges,
  computeDiagramMetadata,
  getMermaidNodeIds,
  getMermaidEdgePairs,
  hasMermaidNode,
  countMermaidElements,
} from '../src/nodes/mermaid.js';
import {
  createPromptNode,
  createPromptVariable,
  createPromptTemplate,
  extractVariablesFromContent,
  buildFullPrompt,
  getDeclaredVariableNames,
  getReferencedVariableNames,
  findVariableByName,
  getRequiredVariables,
  hasVariable,
  findTemplateById,
  getTemplateIds,
} from '../src/nodes/prompt.js';
import {
  createWorkflowNode,
  createWorkflowStep,
  createWorkflowEdge,
  hasCycle,
  topologicalSort,
  getStepNames,
  findStepByName,
  getRootSteps,
  getLeafSteps,
  getSuccessors,
  getPredecessors,
  countWorkflowElements,
} from '../src/nodes/workflow.js';
import {
  createMetadataNode,
  createMetadataPermission,
  createMetadataDependency,
  getTags,
  hasTag,
  getPermissionResources as getMetaPermResources,
  findPermissionByResource as findMetaPermByResource,
  getDependencyNames,
  hasDependency as hasMetaDep,
  mergeMetadataNodes,
} from '../src/nodes/metadata.js';
import {
  createInputsNode,
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
  createOutputsNode,
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
  createExportsNode,
  createExportItem,
  getExportNames,
  findExportByName,
  findExportByAlias,
  getExportsByType,
  getReExports,
  getLocalExports,
  hasExport,
  countExports,
} from '../src/nodes/exports.js';
import {
  createImportsNode,
  createImportItem,
  getImportNames,
  findImportByName,
  findImportsBySource,
  findImportByAlias,
  getOptionalImports,
  getRequiredImports,
  getSourceModules,
  hasImport,
  countImports,
} from '../src/nodes/imports.js';
import {
  createExamplesNode,
  createExampleEntry,
  getExampleTitles,
  findExampleByTitle,
  findExamplesByTag,
  findExamplesByAnyTag,
  getNegativeExamples,
  getPositiveExamples,
  getExamplesWithExpected,
  getAllTags,
  countExamples,
} from '../src/nodes/examples.js';
import {
  createRulesNode,
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
  createReferencesNode,
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
  createPluginsNode,
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
  createPythonNode,
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
  hasImport as hasPythonImport,
  getRequiredPackages,
} from '../src/nodes/python.js';
import {
  createMemoryNode,
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

describe('Capabilities Utilities', () => {
  const node = createCapabilitiesNode({
    capabilities: [
      createCapability('chat', {
        description: 'Chat capability',
        level: 'advanced',
        inputs: [createCapabilityPort('msg', 'string', true)],
        outputs: [createCapabilityPort('reply', 'string', true)],
        requirements: [{ id: 'r1', description: 'needs net', type: 'permission' }],
      }),
      createCapability('summarize', { level: 'basic' }),
      createCapability('analyze', {
        level: 'advanced',
        inputs: [createCapabilityPort('data', 'object')],
      }),
    ],
  });

  it('should get all capability names', () => {
    expect(getCapabilityNames(node)).toEqual(['chat', 'summarize', 'analyze']);
  });

  it('should find capability by name', () => {
    expect(findCapabilityByName(node, 'chat')).toBeDefined();
    expect(findCapabilityByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by level', () => {
    expect(getCapabilitiesByLevel(node, 'advanced')).toHaveLength(2);
    expect(getCapabilitiesByLevel(node, 'basic')).toHaveLength(1);
    expect(getCapabilitiesByLevel(node, 'expert')).toHaveLength(0);
  });

  it('should get all input port names', () => {
    const names = getAllInputPortNames(node);
    expect(names).toEqual(expect.arrayContaining(['msg', 'data']));
  });

  it('should get all output port names', () => {
    expect(getAllOutputPortNames(node)).toEqual(['reply']);
  });

  it('should get all requirements (deduplicated)', () => {
    const reqs = getAllRequirements(node);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe('r1');
  });

  it('should count ports', () => {
    expect(countPorts(node)).toBe(3);
  });

  it('should handle empty node', () => {
    const empty = createCapabilitiesNode();
    expect(getCapabilityNames(empty)).toEqual([]);
    expect(getAllInputPortNames(empty)).toEqual([]);
    expect(getAllOutputPortNames(empty)).toEqual([]);
    expect(getAllRequirements(empty)).toEqual([]);
    expect(countPorts(empty)).toBe(0);
  });
});

describe('Dependencies Utilities', () => {
  const node = createDependenciesNode({
    dependencies: [
      createDependency('lodash', { version: '^4.0.0', source: 'npm', type: 'runtime' }),
      createDependency('pytest', { source: 'pip', type: 'test', optional: true }),
      createDependency('express', { source: 'npm', type: 'runtime' }),
    ],
  });

  it('should get dependency names', () => {
    expect(getDependencyNames(node)).toEqual(['lodash', 'pytest', 'express']);
  });

  it('should find dependency by name', () => {
    expect(findDependencyByName(node, 'lodash')).toBeDefined();
    expect(findDependencyByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by source', () => {
    expect(getDependenciesBySource(node, 'npm')).toHaveLength(2);
    expect(getDependenciesBySource(node, 'pip')).toHaveLength(1);
  });

  it('should filter by type', () => {
    expect(getDependenciesByType(node, 'runtime')).toHaveLength(2);
    expect(getDependenciesByType(node, 'test')).toHaveLength(1);
  });

  it('should separate optional and required', () => {
    expect(getOptionalDependencies(node)).toHaveLength(1);
    expect(getRequiredDependencies(node)).toHaveLength(2);
  });

  it('should get runtime dependencies', () => {
    expect(getRuntimeDependencies(node)).toHaveLength(2);
  });

  it('should check hasDependency', () => {
    expect(hasDependency(node, 'lodash')).toBe(true);
    expect(hasDependency(node, 'nope')).toBe(false);
  });

  it('should count dependencies', () => {
    expect(countDependencies(node)).toBe(3);
  });
});

describe('Permissions Utilities', () => {
  const node = createPermissionsNode({
    permissions: [
      createPermission('fs:/tmp/*', 'read', { resourceKind: 'filesystem' }),
      createPermission('net:api.com', 'write', { optional: true }),
      createPermission('admin:all', 'admin'),
    ],
  });

  it('should check hasPermission', () => {
    expect(hasPermission(node, 'fs:/tmp/*')).toBe(true);
    expect(hasPermission(node, 'nope')).toBe(false);
  });

  it('should count permissions', () => {
    expect(countPermissions(node)).toBe(3);
  });

  it('should filter by level', () => {
    expect(getPermissionsByLevel(node, 'read')).toHaveLength(1);
    expect(getPermissionsByLevel(node, 'write')).toHaveLength(1);
    expect(getPermissionsByLevel(node, 'admin')).toHaveLength(1);
  });

  it('should filter by resource kind', () => {
    expect(getPermissionsByResourceKind(node, 'filesystem')).toHaveLength(1);
    expect(getPermissionsByResourceKind(node, 'network')).toHaveLength(0);
  });

  it('should separate optional and required', () => {
    expect(getOptionalPermissions(node)).toHaveLength(1);
    expect(getRequiredPermissions(node)).toHaveLength(2);
  });

  it('should check admin access', () => {
    expect(requiresAdminAccess(node)).toBe(true);
    const noAdmin = createPermissionsNode({
      permissions: [createPermission('fs', 'read')],
    });
    expect(requiresAdminAccess(noAdmin)).toBe(false);
  });

  it('should get permission resources', () => {
    expect(getPermissionResources(node)).toEqual(
      expect.arrayContaining(['fs:/tmp/*', 'net:api.com', 'admin:all'])
    );
  });

  it('should find permission by resource', () => {
    expect(findPermissionByResource(node, 'net:api.com')).toBeDefined();
    expect(findPermissionByResource(node, 'nope')).toBeUndefined();
  });
});

describe('Mermaid Utilities', () => {
  const content = `flowchart LR
  A[Start] --> B[Process]
  B[Process] --> C[End]`;

  it('should detect diagram type', () => {
    expect(detectDiagramType('flowchart TD')).toBe('flowchart');
    expect(detectDiagramType('graph LR')).toBe('flowchart');
    expect(detectDiagramType('sequenceDiagram')).toBe('sequence');
    expect(detectDiagramType('classDiagram')).toBe('class');
    expect(detectDiagramType('stateDiagram-v2')).toBe('state');
    expect(detectDiagramType('erDiagram')).toBe('er');
    expect(detectDiagramType('gantt')).toBe('gantt');
    expect(detectDiagramType('pie')).toBe('pie');
    expect(detectDiagramType('mindmap')).toBe('mindmap');
    expect(detectDiagramType('timeline')).toBe('timeline');
    expect(detectDiagramType('unknown')).toBe('unknown');
  });

  it('should parse nodes from content', () => {
    const nodes = parseNodes(content);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse edges from content', () => {
    const edges = parseEdges(content);
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].from).toBeDefined();
    expect(edges[0].to).toBeDefined();
  });

  it('should compute diagram metadata', () => {
    const meta = computeDiagramMetadata(content);
    expect(meta.nodeCount).toBeGreaterThanOrEqual(1);
    expect(meta.edgeCount).toBeGreaterThanOrEqual(1);
    expect(meta.direction).toBe('LR');
  });

  it('should get mermaid node ids', () => {
    const node = createMermaidNode({ content });
    const ids = getMermaidNodeIds(node);
    expect(ids).toContain('A');
  });

  it('should get edge pairs', () => {
    const node = createMermaidNode({ content });
    const pairs = getMermaidEdgePairs(node);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it('should check hasMermaidNode', () => {
    const node = createMermaidNode({ content });
    expect(hasMermaidNode(node, 'A')).toBe(true);
    expect(hasMermaidNode(node, 'Z')).toBe(false);
  });

  it('should count mermaid elements', () => {
    const node = createMermaidNode({ content });
    const counts = countMermaidElements(node);
    expect(counts.nodes).toBeGreaterThanOrEqual(1);
    expect(counts.edges).toBeGreaterThanOrEqual(1);
  });
});

describe('Prompt Utilities', () => {
  it('should extract variables from content', () => {
    expect(extractVariablesFromContent('{{name}} {{age}}')).toEqual(
      expect.arrayContaining(['name', 'age'])
    );
  });

  it('should extract variables with different delimiters', () => {
    const vars = extractVariablesFromContent('{a} ${{b}} ${c}');
    expect(vars).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('should not duplicate variable names', () => {
    const vars = extractVariablesFromContent('{{x}} and {{x}}');
    expect(vars).toEqual(['x']);
  });

  it('should handle empty content', () => {
    expect(extractVariablesFromContent('')).toEqual([]);
    expect(extractVariablesFromContent('no vars here')).toEqual([]);
  });

  it('should build full prompt with system prompt', () => {
    const node = createPromptNode({
      content: 'User says hello',
      systemPrompt: 'You are helpful',
    });
    expect(buildFullPrompt(node)).toBe('You are helpful\nUser says hello');
  });

  it('should build full prompt without system prompt', () => {
    const node = createPromptNode({ content: 'Content only' });
    expect(buildFullPrompt(node)).toBe('Content only');
  });

  it('should get declared variable names', () => {
    const node = createPromptNode({
      content: '{{x}}',
      variables: [
        createPromptVariable('x'),
        createPromptVariable('y'),
      ],
    });
    expect(getDeclaredVariableNames(node)).toEqual(['x', 'y']);
  });

  it('should get referenced variable names', () => {
    const node = createPromptNode({ content: '{{a}} and {{b}}' });
    expect(getReferencedVariableNames(node)).toEqual(
      expect.arrayContaining(['a', 'b'])
    );
  });

  it('should find variable by name', () => {
    const node = createPromptNode({
      content: '{{x}}',
      variables: [createPromptVariable('x', { type: 'string' })],
    });
    expect(findVariableByName(node, 'x')).toBeDefined();
    expect(findVariableByName(node, 'y')).toBeUndefined();
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
    expect(getRequiredVariables(node)[0].name).toBe('a');
  });

  it('should check hasVariable', () => {
    const node = createPromptNode({
      content: '{{x}}',
      variables: [createPromptVariable('x')],
    });
    expect(hasVariable(node, 'x')).toBe(true);
    expect(hasVariable(node, 'y')).toBe(false);
  });

  it('should find template by id', () => {
    const node = createPromptNode({
      content: 'test',
      templates: [createPromptTemplate('t1', 'template')],
    });
    expect(findTemplateById(node, 't1')).toBeDefined();
    expect(findTemplateById(node, 'missing')).toBeUndefined();
  });

  it('should get template ids', () => {
    const node = createPromptNode({
      content: 'test',
      templates: [
        createPromptTemplate('a', 'x'),
        createPromptTemplate('b', 'y'),
      ],
    });
    expect(getTemplateIds(node)).toEqual(['a', 'b']);
  });
});

describe('Workflow Utilities', () => {
  const linear = createWorkflowNode({
    steps: [
      createWorkflowStep('start'),
      createWorkflowStep('process'),
      createWorkflowStep('end'),
    ],
    edges: [
      createWorkflowEdge('start', 'process'),
      createWorkflowEdge('process', 'end'),
    ],
  });

  const cyclic = createWorkflowNode({
    steps: [
      createWorkflowStep('a'),
      createWorkflowStep('b'),
    ],
    edges: [
      createWorkflowEdge('a', 'b'),
      createWorkflowEdge('b', 'a'),
    ],
  });

  it('should detect cycle', () => {
    expect(hasCycle(cyclic)).toBe(true);
  });

  it('should detect no cycle', () => {
    expect(hasCycle(linear)).toBe(false);
  });

  it('should topological sort linear workflow', () => {
    const order = topologicalSort(linear);
    expect(order).toEqual(['start', 'process', 'end']);
  });

  it('should throw on cyclic topological sort', () => {
    expect(() => topologicalSort(cyclic)).toThrow('cycle');
  });

  it('should get step names', () => {
    expect(getStepNames(linear)).toEqual(['start', 'process', 'end']);
  });

  it('should find step by name', () => {
    expect(findStepByName(linear, 'process')).toBeDefined();
    expect(findStepByName(linear, 'missing')).toBeUndefined();
  });

  it('should get root steps', () => {
    const roots = getRootSteps(linear);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe('start');
  });

  it('should get leaf steps', () => {
    const leaves = getLeafSteps(linear);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].name).toBe('end');
  });

  it('should get successors', () => {
    expect(getSuccessors(linear, 'start')).toEqual(['process']);
    expect(getSuccessors(linear, 'end')).toEqual([]);
  });

  it('should get predecessors', () => {
    expect(getPredecessors(linear, 'end')).toEqual(['process']);
    expect(getPredecessors(linear, 'start')).toEqual([]);
  });

  it('should count workflow elements', () => {
    const counts = countWorkflowElements(linear);
    expect(counts.steps).toBe(3);
    expect(counts.edges).toBe(2);
  });
});

describe('Metadata Utilities', () => {
  const node = createMetadataNode({
    id: 'mod-1',
    name: 'Test',
    tags: ['ai', 'ml', 'test'],
    permissions: [
      createMetadataPermission('fs', 'read'),
      createMetadataPermission('net', 'write'),
    ],
    dependencies: [
      createMetadataDependency('lodash', '^4.0.0'),
      createMetadataDependency('express'),
    ],
  });

  it('should get tags', () => {
    expect(getTags(node)).toEqual(['ai', 'ml', 'test']);
  });

  it('should check hasTag', () => {
    expect(hasTag(node, 'ai')).toBe(true);
    expect(hasTag(node, 'missing')).toBe(false);
  });

  it('should get permission resources', () => {
    expect(getMetaPermResources(node)).toEqual(['fs', 'net']);
  });

  it('should find permission by resource', () => {
    expect(findMetaPermByResource(node, 'fs')).toBeDefined();
    expect(findMetaPermByResource(node, 'nope')).toBeUndefined();
  });

  it('should get dependency names', () => {
    expect(getDependencyNames(node)).toEqual(['lodash', 'express']);
  });

  it('should check has dependency', () => {
    expect(hasMetaDep(node, 'lodash')).toBe(true);
    expect(hasMetaDep(node, 'missing')).toBe(false);
  });

  it('should merge metadata nodes', () => {
    const base = createMetadataNode({
      id: 'a',
      tags: ['x'],
      permissions: [createMetadataPermission('fs', 'read')],
    });
    const override = createMetadataNode({
      name: 'B',
      tags: ['y'],
      permissions: [createMetadataPermission('net', 'write')],
    });
    const merged = mergeMetadataNodes(base, override);
    expect(merged.id).toBe('a');
    expect(merged.name).toBe('B');
    expect(merged.tags).toEqual(expect.arrayContaining(['x', 'y']));
    expect(merged.permissions).toHaveLength(2);
  });

  it('should handle empty tags', () => {
    const empty = createMetadataNode();
    expect(getTags(empty)).toEqual([]);
    expect(hasTag(empty, 'x')).toBe(false);
  });
});

describe('Inputs Utilities', () => {
  const node = createInputsNode({
    ports: [
      createInputPort('query', 'string', true, { description: 'User query' }),
      createInputPort('count', 'number', false, { default: '10' }),
      createInputPort('filter', 'string', false),
    ],
  });

  it('should get port names', () => {
    expect(getInputPortNames(node)).toEqual(['query', 'count', 'filter']);
  });

  it('should find port by name', () => {
    expect(findInputPortByName(node, 'query')).toBeDefined();
    expect(findInputPortByName(node, 'missing')).toBeUndefined();
  });

  it('should get required ports', () => {
    expect(getRequiredInputPorts(node)).toHaveLength(1);
    expect(getRequiredInputPorts(node)[0].name).toBe('query');
  });

  it('should get optional ports', () => {
    expect(getOptionalInputPorts(node)).toHaveLength(2);
  });

  it('should filter by type', () => {
    expect(getInputPortsByType(node, 'string')).toHaveLength(2);
    expect(getInputPortsByType(node, 'number')).toHaveLength(1);
  });

  it('should check hasInputPort', () => {
    expect(hasInputPort(node, 'query')).toBe(true);
    expect(hasInputPort(node, 'missing')).toBe(false);
  });

  it('should count ports', () => {
    expect(countInputPorts(node)).toBe(3);
  });

  it('should summarize ports', () => {
    const summary = summarizeInputPorts(node);
    expect(summary).toContain('query');
    expect(summary).toContain('required');
    expect(summary).toContain('count');
  });
});

describe('Outputs Utilities', () => {
  const node = createOutputsNode({
    ports: [
      createOutputPort('result', 'json'),
      createOutputPort('error', 'string', {
        schema: createOutputSchema({ nullable: true }),
      }),
    ],
  });

  it('should get port names', () => {
    expect(getOutputPortNames(node)).toEqual(['result', 'error']);
  });

  it('should find port by name', () => {
    expect(findOutputPortByName(node, 'result')).toBeDefined();
    expect(findOutputPortByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by type', () => {
    expect(getOutputPortsByType(node, 'json')).toHaveLength(1);
    expect(getOutputPortsByType(node, 'string')).toHaveLength(1);
  });

  it('should check hasOutputPort', () => {
    expect(hasOutputPort(node, 'result')).toBe(true);
    expect(hasOutputPort(node, 'missing')).toBe(false);
  });

  it('should count output ports', () => {
    expect(countOutputPorts(node)).toBe(2);
  });

  it('should summarize output ports', () => {
    const summary = summarizeOutputPorts(node);
    expect(summary).toContain('result');
    expect(summary).toContain('error');
  });

  it('should get nullable ports', () => {
    expect(getNullableOutputPorts(node)).toHaveLength(1);
    expect(getNullableOutputPorts(node)[0].name).toBe('error');
  });
});

describe('Exports Utilities', () => {
  const node = createExportsNode({
    items: [
      createExportItem('myFunc', { type: 'function' }),
      createExportItem('MyClass', { type: 'class' }),
      createExportItem('re', { reexport: true, from: 'other', alias: 'aliased' }),
    ],
  });

  it('should get export names', () => {
    expect(getExportNames(node)).toEqual(['myFunc', 'MyClass', 're']);
  });

  it('should find export by name', () => {
    expect(findExportByName(node, 'myFunc')).toBeDefined();
    expect(findExportByName(node, 'missing')).toBeUndefined();
  });

  it('should find export by alias', () => {
    expect(findExportByAlias(node, 'aliased')).toBeDefined();
  });

  it('should filter by type', () => {
    expect(getExportsByType(node, 'function')).toHaveLength(1);
    expect(getExportsByType(node, 'class')).toHaveLength(1);
  });

  it('should separate re-exports and local', () => {
    expect(getReExports(node)).toHaveLength(1);
    expect(getLocalExports(node)).toHaveLength(2);
  });

  it('should check hasExport', () => {
    expect(hasExport(node, 'myFunc')).toBe(true);
    expect(hasExport(node, 'missing')).toBe(false);
  });

  it('should count exports', () => {
    expect(countExports(node)).toBe(3);
  });
});

describe('Imports Utilities', () => {
  const node = createImportsNode({
    items: [
      createImportItem('React', 'react'),
      createImportItem('useState', 'react', { selective: 'named' }),
      createImportItem('os', 'os', { optional: true }),
    ],
  });

  it('should get import names', () => {
    expect(getImportNames(node)).toEqual(['React', 'useState', 'os']);
  });

  it('should find import by name', () => {
    expect(findImportByName(node, 'React')).toBeDefined();
    expect(findImportByName(node, 'missing')).toBeUndefined();
  });

  it('should find imports by source', () => {
    expect(findImportsBySource(node, 'react')).toHaveLength(2);
    expect(findImportsBySource(node, 'os')).toHaveLength(1);
  });

  it('should find import by alias', () => {
    const nodeWithAlias = createImportsNode({
      items: [createImportItem('x', 'src', { alias: 'y' })],
    });
    expect(findImportByAlias(nodeWithAlias, 'y')).toBeDefined();
  });

  it('should separate optional and required', () => {
    expect(getOptionalImports(node)).toHaveLength(1);
    expect(getRequiredImports(node)).toHaveLength(2);
  });

  it('should get source modules', () => {
    expect(getSourceModules(node)).toEqual(expect.arrayContaining(['react', 'os']));
  });

  it('should check hasImport', () => {
    expect(hasImport(node, 'React')).toBe(true);
    expect(hasImport(node, 'missing')).toBe(false);
  });

  it('should count imports', () => {
    expect(countImports(node)).toBe(3);
  });
});

describe('Examples Utilities', () => {
  const node = createExamplesNode({
    examples: [
      createExampleEntry('Basic', 'input1', {
        expected: 'output1',
        tags: ['fast', 'basic'],
        negative: false,
      }),
      createExampleEntry('Error', 'bad input', {
        negative: true,
        tags: ['error'],
      }),
      createExampleEntry('Advanced', 'complex', {
        expected: 'result',
        tags: ['slow', 'advanced'],
      }),
    ],
  });

  it('should get example titles', () => {
    expect(getExampleTitles(node)).toEqual(['Basic', 'Error', 'Advanced']);
  });

  it('should find example by title', () => {
    expect(findExampleByTitle(node, 'Basic')).toBeDefined();
    expect(findExampleByTitle(node, 'missing')).toBeUndefined();
  });

  it('should find examples by tag', () => {
    expect(findExamplesByTag(node, 'fast')).toHaveLength(1);
    expect(findExamplesByTag(node, 'missing')).toHaveLength(0);
  });

  it('should find examples by any tag', () => {
    expect(findExamplesByAnyTag(node, ['fast', 'error'])).toHaveLength(2);
  });

  it('should get negative/positive examples', () => {
    expect(getNegativeExamples(node)).toHaveLength(1);
    expect(getPositiveExamples(node)).toHaveLength(2);
  });

  it('should get examples with expected', () => {
    expect(getExamplesWithExpected(node)).toHaveLength(2);
  });

  it('should collect all tags', () => {
    const tags = getAllTags(node);
    expect(tags).toEqual(expect.arrayContaining(['fast', 'basic', 'error', 'slow', 'advanced']));
  });

  it('should count examples', () => {
    expect(countExamples(node)).toBe(3);
  });
});

describe('Rules Utilities', () => {
  const node = createRulesNode({
    rules: [
      createRule('Be safe', { priority: 'critical', category: 'safety', severity: 'error', active: true, tags: ['core'] }),
      createRule('Be fast', { priority: 'medium', category: 'performance', severity: 'warning', active: true, tags: ['perf'] }),
      createRule('Deprecated', { priority: 'low', active: false }),
    ],
  });

  it('should get rules by priority (sorted)', () => {
    const sorted = getRulesByPriority(node);
    expect(sorted[0].priority).toBe('critical');
    expect(sorted[sorted.length - 1].priority).toBe('low');
  });

  it('should filter by category', () => {
    expect(getRulesByCategory(node, 'safety')).toHaveLength(1);
    expect(getRulesByCategory(node, 'performance')).toHaveLength(1);
  });

  it('should filter by severity', () => {
    expect(getRulesBySeverity(node, 'error')).toHaveLength(1);
    expect(getRulesBySeverity(node, 'warning')).toHaveLength(1);
  });

  it('should separate active/inactive', () => {
    expect(getActiveRules(node)).toHaveLength(2);
    expect(getInactiveRules(node)).toHaveLength(1);
  });

  it('should get all categories', () => {
    expect(getAllCategories(node)).toEqual(expect.arrayContaining(['safety', 'performance']));
  });

  it('should get all tags', () => {
    expect(getAllRuleTags(node)).toEqual(expect.arrayContaining(['core', 'perf']));
  });

  it('should count rules', () => {
    expect(countRules(node)).toBe(3);
    expect(countActiveRules(node)).toBe(2);
  });
});

describe('Tests Utilities', () => {
  const node = createTestsNode({
    cases: [
      createTestCase('basic', { input: 'a', expected: 'b', tags: ['unit'], skip: false, status: 'pass' }),
      createTestCase('skipped', { skip: true, tags: ['integration'] }),
      createTestCase('error', { status: 'error' }),
    ],
  });

  it('should get test case names', () => {
    expect(getTestCaseNames(node)).toEqual(['basic', 'skipped', 'error']);
  });

  it('should find test by name', () => {
    expect(findTestCaseByName(node, 'basic')).toBeDefined();
    expect(findTestCaseByName(node, 'missing')).toBeUndefined();
  });

  it('should find tests by tag', () => {
    expect(findTestCasesByTag(node, 'unit')).toHaveLength(1);
    expect(findTestCasesByTag(node, 'integration')).toHaveLength(1);
  });

  it('should get skipped tests', () => {
    expect(getSkippedTestCases(node)).toHaveLength(1);
  });

  it('should get active tests', () => {
    expect(getActiveTestCases(node)).toHaveLength(2);
  });

  it('should filter by status', () => {
    expect(getTestCasesByStatus(node, 'pass')).toHaveLength(1);
    expect(getTestCasesByStatus(node, 'error')).toHaveLength(1);
  });

  it('should collect all tags', () => {
    expect(getAllTestTags(node)).toEqual(expect.arrayContaining(['unit', 'integration']));
  });

  it('should count complete test cases', () => {
    expect(countCompleteTestCases(node)).toBe(1);
  });
});

describe('References Utilities', () => {
  const node = createReferencesNode({
    references: [
      createReference('Docs', { url: 'https://docs.example.com', type: 'documentation', tags: ['api'] }),
      createReference('Paper', { type: 'paper', tags: ['research'] }),
    ],
  });

  it('should get reference titles', () => {
    expect(getReferenceTitles(node)).toEqual(['Docs', 'Paper']);
  });

  it('should find reference by title (case-insensitive)', () => {
    expect(findReferenceByTitle(node, 'docs')).toBeDefined();
    expect(findReferenceByTitle(node, 'DOCS')).toBeDefined();
    expect(findReferenceByTitle(node, 'missing')).toBeUndefined();
  });

  it('should find references by type', () => {
    expect(findReferencesByType(node, 'documentation')).toHaveLength(1);
    expect(findReferencesByType(node, 'paper')).toHaveLength(1);
  });

  it('should find references by tag', () => {
    expect(findReferencesByTag(node, 'api')).toHaveLength(1);
    expect(findReferencesByTag(node, 'research')).toHaveLength(1);
  });

  it('should get references with url', () => {
    expect(getReferencesWithUrl(node)).toHaveLength(1);
  });

  it('should collect all tags', () => {
    expect(getAllReferenceTags(node)).toEqual(expect.arrayContaining(['api', 'research']));
  });

  it('should count references', () => {
    expect(countReferences(node)).toBe(2);
  });
});

describe('Plugins Utilities', () => {
  const node = createPluginsNode({
    plugins: [
      createPluginRef('auth', { source: 'npm', enabled: true, capabilities: ['auth', 'jwt'] }),
      createPluginRef('cache', { source: 'pip', enabled: false }),
    ],
  });

  it('should get plugin names', () => {
    expect(getPluginNames(node)).toEqual(['auth', 'cache']);
  });

  it('should find plugin by name', () => {
    expect(findPluginByName(node, 'auth')).toBeDefined();
    expect(findPluginByName(node, 'missing')).toBeUndefined();
  });

  it('should filter by source', () => {
    expect(getPluginsBySource(node, 'npm')).toHaveLength(1);
    expect(getPluginsBySource(node, 'pip')).toHaveLength(1);
  });

  it('should separate enabled/disabled', () => {
    expect(getEnabledPlugins(node)).toHaveLength(1);
    expect(getDisabledPlugins(node)).toHaveLength(1);
  });

  it('should get enabled plugin capabilities', () => {
    expect(getEnabledPluginCapabilities(node)).toEqual(
      expect.arrayContaining(['auth', 'jwt'])
    );
  });

  it('should check isPluginEnabled', () => {
    expect(isPluginEnabled(node, 'auth')).toBe(true);
    expect(isPluginEnabled(node, 'cache')).toBe(false);
    expect(isPluginEnabled(node, 'missing')).toBe(false);
  });

  it('should check hasPlugin', () => {
    expect(hasPlugin(node, 'auth')).toBe(true);
    expect(hasPlugin(node, 'missing')).toBe(false);
  });

  it('should count plugins', () => {
    expect(countPlugins(node)).toBe(2);
  });
});

describe('Python Utilities', () => {
  const node = createPythonNode({
    code: 'import os\nimport sys\ndef main(): pass\nclass Foo: pass',
    imports: [
      createPythonImport('os'),
      createPythonImport('sys'),
    ],
    functions: [
      createPythonFunction('main'),
    ],
    classes: [
      createPythonClass('Foo'),
    ],
  });

  it('should get import module names', () => {
    expect(getImportModuleNames(node)).toEqual(['os', 'sys']);
  });

  it('should get function names', () => {
    expect(getFunctionNames(node)).toEqual(['main']);
  });

  it('should find function by name', () => {
    expect(findFunctionByName(node, 'main')).toBeDefined();
    expect(findFunctionByName(node, 'missing')).toBeUndefined();
  });

  it('should get class names', () => {
    expect(getClassNames(node)).toEqual(['Foo']);
  });

  it('should find class by name', () => {
    expect(findClassByName(node, 'Foo')).toBeDefined();
    expect(findClassByName(node, 'Missing')).toBeUndefined();
  });

  it('should get async functions', () => {
    const asyncNode = createPythonNode({
      code: 'async def a(): pass\ndef b(): pass',
      functions: [
        createPythonFunction('a', { async: true }),
        createPythonFunction('b'),
      ],
    });
    expect(getAsyncFunctions(asyncNode)).toHaveLength(1);
  });

  it('should count lines', () => {
    expect(countLines(node)).toBe(4);
  });

  it('should check hasImport', () => {
    expect(hasPythonImport(node, 'os')).toBe(true);
    expect(hasPythonImport(node, 'missing')).toBe(false);
  });

  it('should get required packages', () => {
    expect(getRequiredPackages(node)).toEqual(expect.arrayContaining(['os', 'sys']));
  });
});

describe('Memory Utilities', () => {
  const node = createMemoryNode({
    format: 'vector',
    backend: 'chroma',
    scope: 'workspace',
    encrypted: true,
    indexes: [
      createMemoryIndex('vec_idx', ['embedding']),
      createMemoryIndex('hash_idx', ['id'], { type: 'hash' }),
    ],
    configuration: [
      createMemoryConfiguration('timeout', '30s'),
      createMemoryConfiguration('batch_size', '100'),
    ],
  });

  it('should get index names', () => {
    expect(getIndexNames(node)).toEqual(['vec_idx', 'hash_idx']);
  });

  it('should find index by name', () => {
    expect(findIndexByName(node, 'vec_idx')).toBeDefined();
    expect(findIndexByName(node, 'missing')).toBeUndefined();
  });

  it('should get configuration keys', () => {
    expect(getConfigurationKeys(node)).toEqual(['timeout', 'batch_size']);
  });

  it('should find configuration by key', () => {
    expect(findConfigurationByKey(node, 'timeout')).toBeDefined();
    expect(findConfigurationByKey(node, 'missing')).toBeUndefined();
  });

  it('should check isVectorMemory', () => {
    expect(isVectorMemory(node)).toBe(true);
    expect(isVectorMemory(createMemoryNode({ format: 'key-value' }))).toBe(false);
  });

  it('should check isEncrypted', () => {
    expect(isEncrypted(node)).toBe(true);
    expect(isEncrypted(createMemoryNode())).toBe(false);
  });

  it('should count indexes', () => {
    expect(countIndexes(node)).toBe(2);
    expect(countIndexes(createMemoryNode())).toBe(0);
  });
});
