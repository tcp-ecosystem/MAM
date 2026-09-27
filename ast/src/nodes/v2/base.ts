/**
 * MAM v2 AST Base Types
 */

import { SourceLocation } from '../../location/index.js';

// ============================================================================
// Base Types
// ============================================================================

export type V2NodeType =
  | 'ModuleNode'
  | 'AgentNode'
  | 'ToolNode'
  | 'MemoryNode'
  | 'WorkflowNode'
  | 'TeamNode'
  | 'PolicyNode'
  | 'SystemNode'
  | 'EdgeNode'
  | 'StepNode'
  | 'InterfaceNode'
  | 'ContractNode'
  | 'ResourceNode'
  | 'EventNode'
  | 'StateNode'
  | 'CapabilityNode'
  | 'PermissionNode'
  | 'DependencyNode'
  | 'PluginNode'
  | 'ExtensionNode'
  | 'RuntimeNode'
  | 'PackageNode'
  | 'RepositoryNode'
  | 'DocumentationNode';

export interface V2BaseNode {
  type: V2NodeType;
  location: SourceLocation;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Module Type System
// ============================================================================

export type ModuleType =
  | 'module'
  | 'agent'
  | 'tool'
  | 'memory'
  | 'workflow'
  | 'team'
  | 'policy'
  | 'system'
  | 'service'
  | 'component'
  | 'resource'
  | 'interface'
  | 'contract'
  | 'plugin'
  | 'extension'
  | 'runtime'
  | 'package'
  | 'repository'
  | 'documentation';

export interface ModuleTypeDefinition {
  type: ModuleType;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  extends?: ModuleType;
  capabilities: string[];
}

// ============================================================================
// Node Type Guard Functions
// ============================================================================

export function isV2ModuleNode(node: V2BaseNode): node is V2BaseNode & { type: 'ModuleNode' } {
  return node.type === 'ModuleNode';
}

export function isV2AgentNode(node: V2BaseNode): node is V2BaseNode & { type: 'AgentNode' } {
  return node.type === 'AgentNode';
}

export function isV2ToolNode(node: V2BaseNode): node is V2BaseNode & { type: 'ToolNode' } {
  return node.type === 'ToolNode';
}

export function isV2MemoryNode(node: V2BaseNode): node is V2BaseNode & { type: 'MemoryNode' } {
  return node.type === 'MemoryNode';
}

export function isV2WorkflowNode(node: V2BaseNode): node is V2BaseNode & { type: 'WorkflowNode' } {
  return node.type === 'WorkflowNode';
}

export function isV2TeamNode(node: V2BaseNode): node is V2BaseNode & { type: 'TeamNode' } {
  return node.type === 'TeamNode';
}

export function isV2PolicyNode(node: V2BaseNode): node is V2BaseNode & { type: 'PolicyNode' } {
  return node.type === 'PolicyNode';
}

export function isV2SystemNode(node: V2BaseNode): node is V2BaseNode & { type: 'SystemNode' } {
  return node.type === 'SystemNode';
}

export function isV2EdgeNode(node: V2BaseNode): node is V2BaseNode & { type: 'EdgeNode' } {
  return node.type === 'EdgeNode';
}

export function isV2StepNode(node: V2BaseNode): node is V2BaseNode & { type: 'StepNode' } {
  return node.type === 'StepNode';
}

export function isV2InterfaceNode(node: V2BaseNode): node is V2BaseNode & { type: 'InterfaceNode' } {
  return node.type === 'InterfaceNode';
}

export function isV2ContractNode(node: V2BaseNode): node is V2BaseNode & { type: 'ContractNode' } {
  return node.type === 'ContractNode';
}

export function isV2ResourceNode(node: V2BaseNode): node is V2BaseNode & { type: 'ResourceNode' } {
  return node.type === 'ResourceNode';
}

export function isV2EventNode(node: V2BaseNode): node is V2BaseNode & { type: 'EventNode' } {
  return node.type === 'EventNode';
}

export function isV2StateNode(node: V2BaseNode): node is V2BaseNode & { type: 'StateNode' } {
  return node.type === 'StateNode';
}

export function isV2CapabilityNode(node: V2BaseNode): node is V2BaseNode & { type: 'CapabilityNode' } {
  return node.type === 'CapabilityNode';
}

export function isV2PermissionNode(node: V2BaseNode): node is V2BaseNode & { type: 'PermissionNode' } {
  return node.type === 'PermissionNode';
}

export function isV2DependencyNode(node: V2BaseNode): node is V2BaseNode & { type: 'DependencyNode' } {
  return node.type === 'DependencyNode';
}

export function isV2PluginNode(node: V2BaseNode): node is V2BaseNode & { type: 'PluginNode' } {
  return node.type === 'PluginNode';
}

export function isV2ExtensionNode(node: V2BaseNode): node is V2BaseNode & { type: 'ExtensionNode' } {
  return node.type === 'ExtensionNode';
}

export function isV2RuntimeNode(node: V2BaseNode): node is V2BaseNode & { type: 'RuntimeNode' } {
  return node.type === 'RuntimeNode';
}

export function isV2PackageNode(node: V2BaseNode): node is V2BaseNode & { type: 'PackageNode' } {
  return node.type === 'PackageNode';
}

export function isV2RepositoryNode(node: V2BaseNode): node is V2BaseNode & { type: 'RepositoryNode' } {
  return node.type === 'RepositoryNode';
}

export function isV2DocumentationNode(node: V2BaseNode): node is V2BaseNode & { type: 'DocumentationNode' } {
  return node.type === 'DocumentationNode';
}

// ============================================================================
// Module Type Categories
// ============================================================================

export type ModuleTypeCategory =
  | 'core'
  | 'composable'
  | 'behavioral'
  | 'infrastructure'
  | 'distribution'
  | 'documentation';

export const NODE_TYPE_CATEGORIES: Record<ModuleTypeCategory, ModuleType[]> = {
  core: ['module', 'component', 'service'],
  composable: ['system', 'team', 'workflow'],
  behavioral: ['agent', 'policy', 'tool'],
  infrastructure: ['memory', 'resource', 'runtime', 'plugin', 'extension'],
  distribution: ['package', 'repository', 'contract', 'interface'],
  documentation: ['documentation'],
};

// ============================================================================
// Node Factory Interface
// ============================================================================

export interface V2NodeFactory {
  createModule(name: string, location: SourceLocation): V2BaseNode;
  createAgent(name: string, location: SourceLocation): V2BaseNode;
  createTool(name: string, location: SourceLocation): V2BaseNode;
  createMemory(name: string, location: SourceLocation): V2BaseNode;
  createWorkflow(name: string, location: SourceLocation): V2BaseNode;
  createTeam(name: string, location: SourceLocation): V2BaseNode;
  createPolicy(name: string, location: SourceLocation): V2BaseNode;
  createSystem(name: string, location: SourceLocation): V2BaseNode;
}

// ============================================================================
// Type Registry Interface
// ============================================================================

export interface V2TypeRegistry {
  register(type: ModuleType, definition: ModuleTypeDefinition): void;
  get(type: ModuleType): ModuleTypeDefinition | undefined;
  has(type: ModuleType): boolean;
  list(): ModuleType[];
  getRequiredFields(type: ModuleType): string[];
  getOptionalFields(type: ModuleType): string[];
}

// ============================================================================
// Type Hierarchy Interface
// ============================================================================

export interface V2TypeHierarchy {
  getParents(type: ModuleType): ModuleType[];
  getChildren(type: ModuleType): ModuleType[];
  isSubtype(child: ModuleType, parent: ModuleType): boolean;
  getAncestors(type: ModuleType): ModuleType[];
}

// ============================================================================
// Node Visitor Interface
// ============================================================================

export interface V2NodeVisitor<T = void> {
  visitModule(node: V2BaseNode): T;
  visitAgent(node: V2BaseNode): T;
  visitTool(node: V2BaseNode): T;
  visitMemory(node: V2BaseNode): T;
  visitWorkflow(node: V2BaseNode): T;
  visitTeam(node: V2BaseNode): T;
  visitPolicy(node: V2BaseNode): T;
  visitSystem(node: V2BaseNode): T;
  visitEdge(node: V2BaseNode): T;
  visitStep(node: V2BaseNode): T;
  visitInterface(node: V2BaseNode): T;
  visitContract(node: V2BaseNode): T;
  visitResource(node: V2BaseNode): T;
  visitEvent(node: V2BaseNode): T;
  visitState(node: V2BaseNode): T;
  visitCapability(node: V2BaseNode): T;
  visitPermission(node: V2BaseNode): T;
  visitDependency(node: V2BaseNode): T;
  visitPlugin(node: V2BaseNode): T;
  visitExtension(node: V2BaseNode): T;
  visitRuntime(node: V2BaseNode): T;
  visitPackage(node: V2BaseNode): T;
  visitRepository(node: V2BaseNode): T;
  visitDocumentation(node: V2BaseNode): T;
}

// ============================================================================
// Node Transformer Interface
// ============================================================================

export interface V2NodeTransformer {
  transform(node: V2BaseNode): V2BaseNode;
  transformModule(node: V2BaseNode): V2BaseNode;
  transformAgent(node: V2BaseNode): V2BaseNode;
  transformTool(node: V2BaseNode): V2BaseNode;
  transformMemory(node: V2BaseNode): V2BaseNode;
  transformWorkflow(node: V2BaseNode): V2BaseNode;
  transformTeam(node: V2BaseNode): V2BaseNode;
  transformPolicy(node: V2BaseNode): V2BaseNode;
  transformSystem(node: V2BaseNode): V2BaseNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getNodeTypeCategory(type: ModuleType): ModuleTypeCategory {
  for (const [category, types] of Object.entries(NODE_TYPE_CATEGORIES)) {
    if (types.includes(type)) {
      return category as ModuleTypeCategory;
    }
  }
  return 'core';
}

export function getAllNodeTypes(): V2NodeType[] {
  return [
    'ModuleNode', 'AgentNode', 'ToolNode', 'MemoryNode', 'WorkflowNode',
    'TeamNode', 'PolicyNode', 'SystemNode', 'EdgeNode', 'StepNode',
    'InterfaceNode', 'ContractNode', 'ResourceNode', 'EventNode', 'StateNode',
    'CapabilityNode', 'PermissionNode', 'DependencyNode', 'PluginNode',
    'ExtensionNode', 'RuntimeNode', 'PackageNode', 'RepositoryNode', 'DocumentationNode',
  ];
}

export function isV2BaseNode(value: unknown): value is V2BaseNode {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && obj.location !== undefined;
}

export function getNodeTypeName(node: V2BaseNode): string {
  return node.type;
}

export function getNodeLocation(node: V2BaseNode): SourceLocation {
  return node.location;
}

export function setNodeMetadata(node: V2BaseNode, key: string, value: unknown): void {
  if (!node.metadata) node.metadata = {};
  node.metadata[key] = value;
}

export function getNodeMetadata(node: V2BaseNode, key: string): unknown {
  return node.metadata?.[key];
}

export function hasNodeMetadata(node: V2BaseNode, key: string): boolean {
  return node.metadata !== undefined && key in node.metadata;
}

export function removeNodeMetadata(node: V2BaseNode, key: string): void {
  if (node.metadata) {
    delete node.metadata[key];
  }
}

export function clearNodeMetadata(node: V2BaseNode): void {
  node.metadata = undefined;
}

export function cloneNodeMetadata(node: V2BaseNode): Record<string, unknown> | undefined {
  if (!node.metadata) return undefined;
  return { ...node.metadata };
}

export function mergeNodeMetadata(target: V2BaseNode, source: Record<string, unknown>): void {
  if (!target.metadata) target.metadata = {};
  Object.assign(target.metadata, source);
}

export function getModuleTypeParent(type: ModuleType): ModuleType | null {
  for (const [parent, children] of Object.entries(NODE_TYPE_CATEGORIES)) {
    if (children.includes(type)) {
      return parent as ModuleType;
    }
  }
  return null;
}

export function isModuleTypeCompatible(source: ModuleType, target: ModuleType): boolean {
  if (source === target) return true;
  const parent = getModuleTypeParent(source);
  if (parent === target) return true;
  return false;
}

// ============================================================================
// Extended Utilities
// ============================================================================

export function isV2NodeType(value: unknown): value is V2NodeType {
  return typeof value === 'string' && getAllNodeTypes().includes(value as V2NodeType);
}

export function createV2BaseNode(
  type: V2NodeType,
  location: SourceLocation,
  metadata?: Record<string, unknown>
): V2BaseNode {
  const node: V2BaseNode = { type, location };
  if (metadata !== undefined) {
    node.metadata = metadata;
  }
  return node;
}

export function cloneV2Node<T extends V2BaseNode>(node: T): T {
  const clone = { ...node };
  clone.location = {
    start: { ...node.location.start },
    end: { ...node.location.end },
    source: node.location.source,
  };
  if (node.metadata !== undefined) {
    clone.metadata = { ...node.metadata };
  }
  return clone;
}

export function getV2NodeType(node: V2BaseNode): V2NodeType {
  return node.type;
}

export function isModuleTypeDefinition(value: unknown): value is ModuleTypeDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    typeof obj.description === 'string' &&
    Array.isArray(obj.requiredFields) &&
    Array.isArray(obj.optionalFields) &&
    Array.isArray(obj.capabilities)
  );
}

export function compareModuleTypes(a: ModuleType, b: ModuleType): number {
  const categories = Object.values(NODE_TYPE_CATEGORIES);
  const indexA = categories.findIndex((types) => types.includes(a));
  const indexB = categories.findIndex((types) => types.includes(b));
  if (indexA !== indexB) return indexA - indexB;
  return a.localeCompare(b);
}

export function createModuleTypeDefinition(
  type: ModuleType,
  description: string,
  options?: {
    requiredFields?: string[];
    optionalFields?: string[];
    extends?: ModuleType;
    capabilities?: string[];
  }
): ModuleTypeDefinition {
  const definition: ModuleTypeDefinition = {
    type,
    description,
    requiredFields: options?.requiredFields ?? [],
    optionalFields: options?.optionalFields ?? [],
    capabilities: options?.capabilities ?? [],
  };
  if (options?.extends !== undefined) {
    definition.extends = options.extends;
  }
  return definition;
}
