/**
 * MAM v2 AST Node Types
 */

import { V2BaseNode, ModuleType } from './base.js';
import {
  V2PortDefinition,
  V2PermissionSet,
  V2EventDefinition,
  V2StateDefinition,
  V2LifecycleDefinition,
  V2MemoryReference,
  V2ConfigDefinition,
  V2DependencyDefinition,
  V2ExportDefinition,
  V2ImportDefinition,
  V2HookDefinition,
  V2TriggerDefinition,
  V2ConditionDefinition,
  V2RetryDefinition,
  V2TimeoutDefinition,
  V2CacheDefinition,
  V2RateLimitDefinition,
  V2AuthDefinition,
  V2ValidationDefinition,
  V2TransformDefinition,
  V2ConstraintDefinition,
  V2MappingDefinition,
  V2MetadataDefinition,
  V2TagDefinition,
  V2AnnotationDefinition,
} from './supporting.js';

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
  rules?: string[];
  prompts?: string[];
  tests?: string;
  examples?: string;

  // System-specific fields
  agents?: string[];
  modules?: string[];
  policy?: string;

  // Extended fields
  config?: V2ConfigDefinition[];
  dependencies?: V2DependencyDefinition[];
  exports?: V2ExportDefinition[];
  imports?: V2ImportDefinition[];
  hooks?: V2HookDefinition[];
  triggers?: V2TriggerDefinition[];
  validations?: V2ValidationDefinition[];
  transforms?: V2TransformDefinition[];
  constraints?: V2ConstraintDefinition[];
  mappings?: V2MappingDefinition[];
  metadata?: Record<string, unknown>;
  tags?: V2TagDefinition[];
  annotations?: V2AnnotationDefinition[];
  version?: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
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
  context?: string;
  constraints?: V2ConstraintDefinition[];
  behaviors?: string[];
  persona?: string;
  expertise?: string[];
  domains?: string[];
  responseFormat?: string;
  tone?: string;
  maxTokens?: number;
  temperature?: number;
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
  runtime?: string;
  version?: string;
  entrypoint?: string;
  dependencies?: string[];
  env?: Record<string, string>;
  schema?: Record<string, unknown>;
  parameters?: V2PortDefinition[];
  returns?: V2PortDefinition[];
  examples?: string[];
  errors?: string[];
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
  indices?: string[];
  embedding?: string;
  dimensions?: number;
  similarity?: string;
  persistence?: string;
  eviction?: string;
  sharding?: string;
  replication?: string;
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
  parallel?: boolean;
  sequential?: boolean;
  conditions?: V2ConditionDefinition[];
  errorHandling?: string;
  compensation?: string;
  timeout?: V2TimeoutDefinition;
  retry?: V2RetryDefinition;
  rollback?: string;
  checkpoints?: string[];
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
  onError?: string;
  async?: boolean;
  parallel?: boolean;
  subworkflow?: string;
}

export interface V2EdgeNode extends V2BaseNode {
  type: 'EdgeNode';
  source: string;
  target: string;
  condition?: string;
  label?: string;
  weight?: number;
  metadata?: Record<string, unknown>;
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
  leader?: string;
  roles?: Record<string, string>;
  communication?: string;
  escalation?: string;
  collaboration?: string;
  consensus?: string;
  delegation?: string;
  scheduling?: string;
  workload?: string;
  handoff?: string[];
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
  scope?: string;
  conditions?: V2ConditionDefinition[];
  exceptions?: string[];
  enforcement?: string;
  priority?: number;
  overrides?: string[];
  inheritance?: string;
  audit?: boolean;
  logging?: boolean;
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
  composition?: string;
  topology?: string;
  routing?: string;
  scaling?: string;
  monitoring?: string;
  health?: string;
  deployment?: string;
}

// ============================================================================
// Interface Node
// ============================================================================

export interface V2InterfaceNode extends V2BaseNode {
  type: 'InterfaceNode';
  name: string;
  ports: V2PortDefinition[];
  protocols?: string[];
  version?: string;
  description?: string;
  extends?: string[];
  implements?: string[];
  events?: V2EventDefinition[];
}

// ============================================================================
// Contract Node
// ============================================================================

export interface V2ContractNode extends V2BaseNode {
  type: 'ContractNode';
  name: string;
  provider: string;
  consumer?: string;
  terms?: string;
  version?: string;
  description?: string;
  inputs?: V2PortDefinition[];
  outputs?: V2PortDefinition[];
  constraints?: V2ConstraintDefinition[];
  sla?: Record<string, unknown>;
  penalties?: Record<string, unknown>;
}

// ============================================================================
// Resource Node
// ============================================================================

export interface V2ResourceNode extends V2BaseNode {
  type: 'ResourceNode';
  name: string;
  resourceType: string;
  provider?: string;
  configuration?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  description?: string;
  lifecycle?: V2LifecycleDefinition;
  events?: V2EventDefinition[];
  state?: V2StateDefinition;
  monitoring?: string;
  alerts?: string[];
}

// ============================================================================
// Event Node
// ============================================================================

export interface V2EventNode extends V2BaseNode {
  type: 'EventNode';
  name: string;
  eventType: string;
  source?: string;
  payload?: Record<string, string>;
  trigger?: string;
  description?: string;
  handlers?: string[];
  async?: boolean;
  deduplication?: boolean;
  retention?: string;
}

// ============================================================================
// State Node
// ============================================================================

export interface V2StateNode extends V2BaseNode {
  type: 'StateNode';
  name: string;
  stateType: string;
  initial?: unknown;
  transitions?: V2TransitionDefinition[];
  history?: boolean;
  description?: string;
  guards?: V2ConditionDefinition[];
  actions?: string[];
  entry?: string[];
  exit?: string[];
}

export interface V2TransitionDefinition {
  from: string;
  to: string;
  event: string;
  condition?: string;
  guard?: string;
  action?: string;
}

// ============================================================================
// Capability Node
// ============================================================================

export interface V2CapabilityNode extends V2BaseNode {
  type: 'CapabilityNode';
  name: string;
  capabilityType: string;
  inputs?: V2PortDefinition[];
  outputs?: V2PortDefinition[];
  permissions?: V2PermissionSet;
  description?: string;
  version?: string;
  dependencies?: string[];
  metrics?: Record<string, unknown>;
}

// ============================================================================
// Permission Node
// ============================================================================

export interface V2PermissionNode extends V2BaseNode {
  type: 'PermissionNode';
  name: string;
  resource: string;
  actions: string[];
  conditions?: V2ConditionDefinition[];
  effect: 'allow' | 'deny';
  description?: string;
  scope?: string;
  priority?: number;
  expires?: string;
}

// ============================================================================
// Dependency Node
// ============================================================================

export interface V2DependencyNode extends V2BaseNode {
  type: 'DependencyNode';
  name: string;
  source: string;
  version: string;
  optional: boolean;
  capabilities?: string[];
  description?: string;
  registry?: string;
  resolved?: boolean;
  integrity?: string;
}

// ============================================================================
// Plugin Node
// ============================================================================

export interface V2PluginNode extends V2BaseNode {
  type: 'PluginNode';
  name: string;
  pluginType: string;
  version?: string;
  entryPoint?: string;
  config?: Record<string, unknown>;
  description?: string;
  author?: string;
  license?: string;
  dependencies?: string[];
  hooks?: V2HookDefinition[];
  exports?: V2ExportDefinition[];
  permissions?: V2PermissionSet;
}

// ============================================================================
// Extension Node
// ============================================================================

export interface V2ExtensionNode extends V2BaseNode {
  type: 'ExtensionNode';
  name: string;
  extends: string;
  overrides?: Record<string, unknown>;
  patches?: V2PatchDefinition[];
  description?: string;
  version?: string;
  compatible?: string[];
  priority?: number;
}

export interface V2PatchDefinition {
  target: string;
  operation: string;
  value?: unknown;
  condition?: string;
}

// ============================================================================
// Runtime Node
// ============================================================================

export interface V2RuntimeNode extends V2BaseNode {
  type: 'RuntimeNode';
  name: string;
  language: string;
  version?: string;
  target?: string;
  description?: string;
  configuration?: Record<string, unknown>;
  capabilities?: string[];
  constraints?: V2ConstraintDefinition[];
  optimizations?: string[];
  debugging?: string;
  profiling?: string;
}

// ============================================================================
// Package Node
// ============================================================================

export interface V2PackageNode extends V2BaseNode {
  type: 'PackageNode';
  name: string;
  version?: string;
  registry?: string;
  dependencies?: V2DependencyDefinition[];
  description?: string;
  author?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
  entrypoint?: string;
  exports?: V2ExportDefinition[];
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
}

// ============================================================================
// Repository Node
// ============================================================================

export interface V2RepositoryNode extends V2BaseNode {
  type: 'RepositoryNode';
  name: string;
  url: string;
  repoType?: string;
  modules?: string[];
  description?: string;
  branch?: string;
  tags?: V2TagDefinition[];
  access?: string;
  authentication?: V2AuthDefinition;
  webhooks?: string[];
  ci?: string;
}

// ============================================================================
// Documentation Node
// ============================================================================

export interface V2DocumentationNode extends V2BaseNode {
  type: 'DocumentationNode';
  name: string;
  content: string;
  format?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  tags?: V2TagDefinition[];
  sections?: string[];
  references?: string[];
  examples?: string[];
  changelog?: string;
}

// ============================================================================
// Union Types
// ============================================================================

export type V2AnyNode =
  | V2ModuleNode
  | V2AgentNode
  | V2ToolNode
  | V2MemoryNode
  | V2WorkflowNode
  | V2StepNode
  | V2EdgeNode
  | V2TeamNode
  | V2PolicyNode
  | V2SystemNode
  | V2InterfaceNode
  | V2ContractNode
  | V2ResourceNode
  | V2EventNode
  | V2StateNode
  | V2CapabilityNode
  | V2PermissionNode
  | V2DependencyNode
  | V2PluginNode
  | V2ExtensionNode
  | V2RuntimeNode
  | V2PackageNode
  | V2RepositoryNode
  | V2DocumentationNode;
