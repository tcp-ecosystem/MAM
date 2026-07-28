/**
 * MAM v2 AST Node Types
 * 
 * System Description Language (SDL) node definitions.
 * Extends v1 nodes with module types, agents, tools, workflows, teams, policies, and systems.
 */

import { SourceLocation } from '../location/index.js';

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
// Module Node (v2)
// ============================================================================

export interface V2ModuleNode extends V2BaseNode {
  type: 'ModuleNode';
  name: string;
  moduleType: ModuleType;
  description?: string;

  // Type-specific sections
  role?: string;
  goal?: string;
  provider?: string;
  format?: string;
  backend?: string;
  scope?: string;
  ttl?: string;
  members?: string[];
  steps?: V2StepNode[];
  edges?: V2EdgeNode[];
  tools?: string[];
  memory?: V2MemoryReference;
  handoff?: string[];
  allow?: string[];
  deny?: string[];
  permissions?: V2PermissionSet;
  requires?: string[];
  inputs?: V2PortDefinition[];
  outputs?: V2PortDefinition[];
  capabilities?: string[];
  events?: V2EventDefinition[];
  state?: V2StateDefinition;
  lifecycle?: V2LifecycleDefinition;
  documentation?: string;
  tests?: string;
  examples?: string;

  // System-specific fields
  agents?: string[];
  modules?: string[];
  policy?: string;
}

// ============================================================================
// Agent Node
// ============================================================================

export interface V2AgentNode extends V2BaseNode {
  type: 'AgentNode';
  name: string;
  role: string;
  goal: string;
  memory?: V2MemoryReference;
  tools?: string[];
  handoff?: string[];
  permissions?: V2PermissionSet;
  rules?: string[];
  prompts?: string[];
}

// ============================================================================
// Tool Node
// ============================================================================

export interface V2ToolNode extends V2BaseNode {
  type: 'ToolNode';
  name: string;
  provider: string;
  permissions?: V2PermissionSet;
  capabilities?: string[];
  configuration?: Record<string, unknown>;
}

// ============================================================================
// Memory Node
// ============================================================================

export interface V2MemoryNode extends V2BaseNode {
  type: 'MemoryNode';
  name: string;
  format: 'vector' | 'key-value' | 'relational' | 'graph' | 'document';
  backend: string;
  scope: 'module' | 'workspace' | 'global';
  ttl?: string;
  configuration?: Record<string, unknown>;
}

export interface V2MemoryReference {
  type: 'local' | 'shared' | 'external';
  name?: string;
  backend?: string;
  scope?: string;
}

// ============================================================================
// Workflow Node
// ============================================================================

export interface V2WorkflowNode extends V2BaseNode {
  type: 'WorkflowNode';
  name: string;
  steps: V2StepNode[];
  edges: V2EdgeNode[];
  description?: string;
}

export interface V2StepNode extends V2BaseNode {
  type: 'StepNode';
  name: string;
  agent?: string;
  tool?: string;
  action?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  condition?: string;
  retry?: number;
  timeout?: string;
}

export interface V2EdgeNode extends V2BaseNode {
  type: 'EdgeNode';
  source: string;
  target: string;
  condition?: string;
  label?: string;
}

// ============================================================================
// Team Node
// ============================================================================

export interface V2TeamNode extends V2BaseNode {
  type: 'TeamNode';
  name: string;
  members: string[];
  policy?: string;
  description?: string;
}

// ============================================================================
// Policy Node
// ============================================================================

export interface V2PolicyNode extends V2BaseNode {
  type: 'PolicyNode';
  name: string;
  allow: string[];
  deny: string[];
  permissions?: V2PermissionSet;
  description?: string;
}

// ============================================================================
// System Node
// ============================================================================

export interface V2SystemNode extends V2BaseNode {
  type: 'SystemNode';
  name: string;
  agents?: string[];
  modules?: string[];
  tools?: string[];
  memory?: V2MemoryReference;
  policy?: string;
  edges?: V2EdgeNode[];
  description?: string;
}

// ============================================================================
// Supporting Types
// ============================================================================

export interface V2PortDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface V2PermissionSet {
  filesystem?: 'read' | 'write' | 'none';
  network?: 'internet' | 'internal' | 'none';
  python?: 'sandbox' | 'full' | 'none';
  memory?: 'local' | 'shared' | 'none';
  exec?: 'allowed' | 'denied';
  custom?: Record<string, string>;
}

export interface V2EventDefinition {
  name: string;
  trigger: string;
  payload?: Record<string, string>;
  description?: string;
}

export interface V2StateDefinition {
  name: string;
  type: string;
  initial?: unknown;
  description?: string;
}

export interface V2LifecycleDefinition {
  created?: string;
  started?: string;
  stopped?: string;
  destroyed?: string;
}

// ============================================================================
// DSL Syntax
// ============================================================================

export const MODULE_TYPE_KEYWORDS = new Set([
  'module', 'agent', 'tool', 'memory', 'workflow', 'team',
  'policy', 'system', 'service', 'component', 'resource',
  'interface', 'contract', 'plugin', 'extension', 'runtime',
  'package', 'repository', 'documentation',
]);

export const V2_SECTION_KEYWORDS = new Set([
  'type', 'role', 'goal', 'provider', 'format', 'backend',
  'scope', 'ttl', 'members', 'steps', 'edges', 'tools',
  'memory', 'handoff', 'allow', 'deny', 'permissions',
  'requires', 'inputs', 'outputs', 'capabilities', 'events',
  'state', 'lifecycle', 'documentation', 'tests', 'examples',
  'description', 'name', 'source', 'target', 'condition',
  'agent', 'action', 'retry', 'timeout', 'label',
  'filesystem', 'network', 'python', 'exec', 'custom',
]);

export const VALID_MODULE_TYPES: ModuleType[] = [
  'module', 'agent', 'tool', 'memory', 'workflow', 'team',
  'policy', 'system', 'service', 'component', 'resource',
  'interface', 'contract', 'plugin', 'extension', 'runtime',
  'package', 'repository', 'documentation',
];

export function isModuleType(value: string): value is ModuleType {
  return VALID_MODULE_TYPES.includes(value as ModuleType);
}

export function getModuleTypeDefinition(type: ModuleType): ModuleTypeDefinition {
  const definitions: Record<ModuleType, ModuleTypeDefinition> = {
    module: { type: 'module', description: 'Generic module', requiredFields: ['name'], optionalFields: ['description', 'requires', 'inputs', 'outputs', 'capabilities'], capabilities: [] },
    agent: { type: 'agent', description: 'AI agent module', requiredFields: ['name', 'role', 'goal'], optionalFields: ['memory', 'tools', 'handoff', 'permissions', 'rules', 'prompts'], extends: 'module', capabilities: ['think', 'plan', 'execute', 'communicate'] },
    tool: { type: 'tool', description: 'Executable tool', requiredFields: ['name', 'provider'], optionalFields: ['permissions', 'capabilities', 'configuration'], extends: 'module', capabilities: ['execute'] },
    memory: { type: 'memory', description: 'Persistent memory store', requiredFields: ['name', 'format', 'backend', 'scope'], optionalFields: ['ttl', 'configuration'], extends: 'module', capabilities: ['store', 'retrieve', 'query'] },
    workflow: { type: 'workflow', description: 'Process workflow', requiredFields: ['name', 'steps'], optionalFields: ['edges', 'description'], extends: 'module', capabilities: ['orchestrate'] },
    team: { type: 'team', description: 'Agent team', requiredFields: ['name', 'members'], optionalFields: ['policy', 'description'], extends: 'module', capabilities: ['coordinate'] },
    policy: { type: 'policy', description: 'Behavioral policy', requiredFields: ['name', 'allow', 'deny'], optionalFields: ['permissions', 'description'], extends: 'module', capabilities: ['enforce'] },
    system: { type: 'system', description: 'Complete system', requiredFields: ['name'], optionalFields: ['agents', 'modules', 'tools', 'memory', 'policy', 'edges', 'description'], extends: 'module', capabilities: ['compose'] },
    service: { type: 'service', description: 'Running service', requiredFields: ['name'], optionalFields: ['description', 'requires', 'inputs', 'outputs'], extends: 'module', capabilities: ['serve'] },
    component: { type: 'component', description: 'System component', requiredFields: ['name'], optionalFields: ['description', 'requires', 'inputs', 'outputs'], extends: 'module', capabilities: ['process'] },
    resource: { type: 'resource', description: 'External resource', requiredFields: ['name'], optionalFields: ['description', 'type', 'configuration'], extends: 'module', capabilities: ['provide'] },
    interface: { type: 'interface', description: 'Public interface', requiredFields: ['name'], optionalFields: ['description', 'inputs', 'outputs'], extends: 'module', capabilities: ['define'] },
    contract: { type: 'contract', description: 'API contract', requiredFields: ['name'], optionalFields: ['description', 'inputs', 'outputs'], extends: 'module', capabilities: ['specify'] },
    plugin: { type: 'plugin', description: 'Extension plugin', requiredFields: ['name'], optionalFields: ['description', 'version', 'dependencies'], extends: 'module', capabilities: ['extend'] },
    extension: { type: 'extension', description: 'Domain extension', requiredFields: ['name'], optionalFields: ['description', 'modules'], extends: 'module', capabilities: ['extend'] },
    runtime: { type: 'runtime', description: 'Execution runtime', requiredFields: ['name'], optionalFields: ['description', 'language', 'version'], extends: 'module', capabilities: ['execute'] },
    package: { type: 'package', description: 'Distributable package', requiredFields: ['name'], optionalFields: ['description', 'version', 'dependencies'], extends: 'module', capabilities: ['distribute'] },
    repository: { type: 'repository', description: 'Source repository', requiredFields: ['name'], optionalFields: ['description', 'url', 'modules'], extends: 'module', capabilities: ['host'] },
    documentation: { type: 'documentation', description: 'Documentation', requiredFields: ['name'], optionalFields: ['description', 'content'], extends: 'module', capabilities: ['document'] },
  };
  return definitions[type];
}