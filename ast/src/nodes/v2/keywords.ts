/**
 * MAM v2 DSL Syntax Keywords
 */

import { ModuleType, ModuleTypeDefinition } from './base.js';

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

// ============================================================================
// Type-Specific Keywords
// ============================================================================

export const AGENT_KEYWORDS = new Set([
  'role', 'goal', 'memory', 'tools', 'handoff', 'permissions',
  'rules', 'prompts', 'context', 'constraints', 'behaviors',
  'persona', 'expertise', 'domains', 'response', 'tone',
]);

export const TOOL_KEYWORDS = new Set([
  'provider', 'permissions', 'capabilities', 'configuration',
  'runtime', 'version', 'entrypoint', 'dependencies', 'env',
  'schema', 'parameters', 'returns', 'examples', 'errors',
]);

export const MEMORY_KEYWORDS = new Set([
  'format', 'backend', 'scope', 'ttl', 'configuration',
  'indices', 'embedding', 'dimensions', 'similarity',
  'persistence', 'eviction', 'sharding', 'replication',
]);

export const WORKFLOW_KEYWORDS = new Set([
  'steps', 'edges', 'description', 'parallel', 'sequential',
  'conditions', 'loops', 'errorHandling', 'compensation',
  'timeout', 'retry', 'rollback', 'checkpoints',
]);

export const TEAM_KEYWORDS = new Set([
  'members', 'policy', 'description', 'leader', 'roles',
  'communication', 'escalation', 'collaboration', 'consensus',
  'delegation', 'scheduling', 'workload', 'handoff',
]);

export const POLICY_KEYWORDS = new Set([
  'allow', 'deny', 'permissions', 'description', 'scope',
  'conditions', 'exceptions', 'enforcement', 'priority',
  'overrides', 'inheritance', 'audit', 'logging',
]);

export const SYSTEM_KEYWORDS = new Set([
  'agents', 'modules', 'tools', 'memory', 'policy', 'edges',
  'description', 'composition', 'topology', 'routing',
  'scaling', 'monitoring', 'health', 'deployment',
]);

// ============================================================================
// Reserved Keywords
// ============================================================================

export const RESERVED_KEYWORDS = new Set([
  'if', 'else', 'then', 'end', 'true', 'false', 'null',
  'undefined', 'function', 'return', 'import', 'export',
  'default', 'class', 'new', 'this', 'super', 'extends',
  'implements', 'interface', 'type', 'enum', 'const', 'let',
  'var', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'try', 'catch', 'finally', 'throw', 'async',
  'await', 'yield', 'delete', 'void', 'typeof', 'instanceof',
]);

// ============================================================================
// Keyword Descriptions
// ============================================================================

export const KEYWORD_DESCRIPTIONS: Record<string, string> = {
  'module': 'Generic module declaration',
  'agent': 'AI agent with role and goal',
  'tool': 'Executable tool with provider',
  'memory': 'Persistent memory store',
  'workflow': 'Process workflow with steps and edges',
  'team': 'Agent team with members',
  'policy': 'Behavioral policy with allow/deny rules',
  'system': 'Complete system composition',
  'service': 'Running service',
  'component': 'System component',
  'resource': 'External resource',
  'interface': 'Public interface definition',
  'contract': 'API contract specification',
  'plugin': 'Extension plugin',
  'extension': 'Domain extension',
  'runtime': 'Execution runtime',
  'package': 'Distributable package',
  'repository': 'Source repository',
  'documentation': 'Documentation',
  'type': 'Module type specification',
  'role': 'Agent role definition',
  'goal': 'Agent goal definition',
  'provider': 'Tool or service provider',
  'format': 'Memory storage format',
  'backend': 'Memory backend system',
  'scope': 'Memory or permission scope',
  'ttl': 'Time-to-live for data',
  'members': 'Team member references',
  'steps': 'Workflow step definitions',
  'edges': 'Workflow edge connections',
  'tools': 'Tool references',
  'handoff': 'Handoff targets',
  'allow': 'Allowed actions',
  'deny': 'Denied actions',
  'permissions': 'Permission set',
  'requires': 'Dependency requirements',
  'inputs': 'Input port definitions',
  'outputs': 'Output port definitions',
  'capabilities': 'Capability declarations',
  'events': 'Event definitions',
  'state': 'State definitions',
  'lifecycle': 'Lifecycle hooks',
  'rules': 'Behavioral rules',
  'prompts': 'Prompt templates',
  'tests': 'Test specifications',
  'examples': 'Example usage',
  'description': 'Human-readable description',
  'name': 'Module name',
  'source': 'Source reference',
  'target': 'Target reference',
  'condition': 'Conditional expression',
  'action': 'Action to perform',
  'retry': 'Retry configuration',
  'timeout': 'Timeout configuration',
  'label': 'Human-readable label',
  'filesystem': 'Filesystem permission',
  'network': 'Network permission',
  'python': 'Python runtime permission',
  'exec': 'Execution permission',
  'custom': 'Custom permission map',
};

// ============================================================================
// Keyword Category Map
// ============================================================================

export type KeywordCategory =
  | 'module-type'
  | 'section'
  | 'reserved'
  | 'permission'
  | 'agent'
  | 'tool'
  | 'memory'
  | 'workflow'
  | 'team'
  | 'policy'
  | 'system';

export const KEYWORD_CATEGORY_MAP: Record<KeywordCategory, Set<string>> = {
  'module-type': MODULE_TYPE_KEYWORDS,
  'section': V2_SECTION_KEYWORDS,
  'reserved': RESERVED_KEYWORDS,
  'permission': new Set(['filesystem', 'network', 'python', 'exec', 'custom']),
  'agent': AGENT_KEYWORDS,
  'tool': TOOL_KEYWORDS,
  'memory': MEMORY_KEYWORDS,
  'workflow': WORKFLOW_KEYWORDS,
  'team': TEAM_KEYWORDS,
  'policy': POLICY_KEYWORDS,
  'system': SYSTEM_KEYWORDS,
};

// ============================================================================
// Section-to-Type Mapping
// ============================================================================

export const SECTION_TYPE_MAP: Record<string, ModuleType[]> = {
  'role': ['agent'],
  'goal': ['agent'],
  'provider': ['tool'],
  'format': ['memory'],
  'backend': ['memory'],
  'scope': ['memory'],
  'ttl': ['memory'],
  'members': ['team'],
  'steps': ['workflow'],
  'edges': ['workflow', 'system'],
  'tools': ['agent', 'system'],
  'memory': ['agent', 'system'],
  'handoff': ['agent'],
  'allow': ['policy'],
  'deny': ['policy'],
  'permissions': ['agent', 'tool', 'policy'],
  'requires': ['module', 'tool'],
  'inputs': ['module', 'tool', 'interface'],
  'outputs': ['module', 'tool', 'interface'],
  'capabilities': ['module', 'tool'],
  'events': ['module', 'resource'],
  'state': ['module', 'resource'],
  'lifecycle': ['module', 'resource'],
  'documentation': ['module'],
  'rules': ['agent', 'policy'],
  'prompts': ['agent'],
  'tests': ['module'],
  'examples': ['module'],
  'agents': ['system'],
  'modules': ['system', 'extension'],
  'policy': ['team', 'system'],
};

// ============================================================================
// Required Sections Per Type
// ============================================================================

export const REQUIRED_SECTIONS_PER_TYPE: Record<ModuleType, string[]> = {
  'module': [],
  'agent': ['role', 'goal'],
  'tool': ['provider'],
  'memory': ['format', 'backend', 'scope'],
  'workflow': ['steps'],
  'team': ['members'],
  'policy': ['allow', 'deny'],
  'system': [],
  'service': [],
  'component': [],
  'resource': [],
  'interface': [],
  'contract': [],
  'plugin': [],
  'extension': [],
  'runtime': [],
  'package': [],
  'repository': [],
  'documentation': [],
};

// ============================================================================
// Optional Sections Per Type
// ============================================================================

export const OPTIONAL_SECTIONS_PER_TYPE: Record<ModuleType, string[]> = {
  'module': ['description', 'requires', 'inputs', 'outputs', 'capabilities', 'documentation', 'tests', 'examples'],
  'agent': ['memory', 'tools', 'handoff', 'permissions', 'rules', 'prompts', 'description'],
  'tool': ['permissions', 'capabilities', 'configuration', 'description'],
  'memory': ['ttl', 'configuration', 'description'],
  'workflow': ['edges', 'description'],
  'team': ['policy', 'description'],
  'policy': ['permissions', 'description'],
  'system': ['agents', 'modules', 'tools', 'memory', 'policy', 'edges', 'description'],
  'service': ['description', 'requires', 'inputs', 'outputs'],
  'component': ['description', 'requires', 'inputs', 'outputs'],
  'resource': ['description', 'configuration', 'events', 'state'],
  'interface': ['description', 'inputs', 'outputs'],
  'contract': ['description', 'inputs', 'outputs'],
  'plugin': ['description', 'requires', 'capabilities'],
  'extension': ['description', 'modules', 'overrides'],
  'runtime': ['description', 'requires', 'configuration'],
  'package': ['description', 'requires', 'version'],
  'repository': ['description', 'url', 'modules'],
  'documentation': ['description', 'content'],
};

// ============================================================================
// Validation Functions
// ============================================================================

export function isValidKeyword(value: string): boolean {
  return (
    MODULE_TYPE_KEYWORDS.has(value) ||
    V2_SECTION_KEYWORDS.has(value) ||
    RESERVED_KEYWORDS.has(value)
  );
}

export function getKeywordCategory(value: string): KeywordCategory | null {
  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORY_MAP)) {
    if (keywords.has(value)) {
      return category as KeywordCategory;
    }
  }
  return null;
}

export function getKeywordsByCategory(category: KeywordCategory): string[] {
  const keywords = KEYWORD_CATEGORY_MAP[category];
  if (!keywords) return [];
  return Array.from(keywords);
}

export function validateModuleName(name: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!name || name.trim().length === 0) {
    errors.push('Module name cannot be empty');
  }
  if (name.length > 256) {
    errors.push('Module name exceeds maximum length of 256 characters');
  }
  if (/^\d/.test(name)) {
    errors.push('Module name cannot start with a digit');
  }
  if (/[^a-zA-Z0-9_-]/.test(name)) {
    errors.push('Module name contains invalid characters (only alphanumeric, underscore, and hyphen allowed)');
  }
  if (RESERVED_KEYWORDS.has(name)) {
    errors.push(`Module name "${name}" is a reserved keyword`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateKeyword(value: string): { valid: boolean; category: KeywordCategory | null; errors: string[] } {
  const errors: string[] = [];
  const category = getKeywordCategory(value);
  if (!category) {
    errors.push(`Unknown keyword: "${value}"`);
  }
  if (RESERVED_KEYWORDS.has(value)) {
    errors.push(`"${value}" is a reserved keyword and cannot be used as an identifier`);
  }
  return { valid: errors.length === 0, category, errors };
}

// ============================================================================
// Module Type Hierarchy
// ============================================================================

export const MODULE_TYPE_HIERARCHY: Record<ModuleType, ModuleType[]> = {
  'module': ['agent', 'tool', 'memory', 'workflow', 'team', 'policy', 'system', 'service', 'component', 'resource', 'interface', 'contract', 'plugin', 'extension', 'runtime', 'package', 'repository', 'documentation'],
  'agent': [],
  'tool': [],
  'memory': [],
  'workflow': [],
  'team': [],
  'policy': [],
  'system': [],
  'service': ['component'],
  'component': [],
  'resource': [],
  'interface': [],
  'contract': [],
  'plugin': [],
  'extension': [],
  'runtime': [],
  'package': [],
  'repository': [],
  'documentation': [],
};

// ============================================================================
// Module Type Capabilities
// ============================================================================

export function getModuleTypeCapabilities(type: ModuleType): string[] {
  const definition = getModuleTypeDefinition(type);
  return definition.capabilities;
}

// ============================================================================
// Extended Keyword Utilities
// ============================================================================

export const MODULE_TYPE_COUNT = VALID_MODULE_TYPES.length;

export function isV2SectionKeyword(value: unknown): value is string {
  return typeof value === 'string' && V2_SECTION_KEYWORDS.has(value);
}

export function assertModuleType(value: string): ModuleType {
  if (!isModuleType(value)) {
    throw new Error(`Invalid module type: "${value}"`);
  }
  return value;
}

export function suggestModuleType(value: string): ModuleType | undefined {
  const target = value.trim().toLowerCase();
  if (target.length === 0) return undefined;
  if (isModuleType(target)) return target;
  if (target.length < 3) return undefined;
  const prefixMatch = VALID_MODULE_TYPES.find((type) => type.startsWith(target));
  if (prefixMatch !== undefined) return prefixMatch;
  const distance = (a: string, b: string): number => {
    const rows = b.length + 1;
    let previous: number[] = [];
    for (let j = 0; j < rows; j++) previous[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const current: number[] = [i];
      for (let j = 1; j < rows; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      }
      previous = current;
    }
    return previous[rows - 1];
  };
  let best: ModuleType | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const threshold = Math.max(2, Math.floor(target.length / 2));
  for (const type of VALID_MODULE_TYPES) {
    const current = distance(target, type);
    if (current < bestDistance) {
      bestDistance = current;
      best = type;
    }
  }
  return bestDistance <= threshold ? best : undefined;
}

export function hasModuleTypeCapability(type: ModuleType, capability: string): boolean {
  return getModuleTypeCapabilities(type).includes(capability);
}

export function getSectionKeywordsForModuleType(type: ModuleType): string[] {
  const required = REQUIRED_SECTIONS_PER_TYPE[type];
  const optional = OPTIONAL_SECTIONS_PER_TYPE[type];
  const specific = Object.entries(SECTION_TYPE_MAP)
    .filter(([, types]) => types.includes(type))
    .map(([keyword]) => keyword);
  return Array.from(new Set([...required, ...optional, ...specific]));
}

export function findModuleTypeByAlias(alias: string): ModuleType | undefined {
  const value = alias.trim().toLowerCase();
  if (value.length === 0) return undefined;
  if (isModuleType(value)) return value;
  const aliases: Record<string, ModuleType> = {
    mod: 'module',
    ai: 'agent',
    llm: 'agent',
    bot: 'agent',
    mem: 'memory',
    store: 'memory',
    db: 'memory',
    wf: 'workflow',
    flow: 'workflow',
    pipeline: 'workflow',
    grp: 'team',
    group: 'team',
    org: 'team',
    pol: 'policy',
    sys: 'system',
    svc: 'service',
    comp: 'component',
    res: 'resource',
    int: 'interface',
    cont: 'contract',
    plug: 'plugin',
    ext: 'extension',
    rt: 'runtime',
    pkg: 'package',
    repo: 'repository',
    doc: 'documentation',
    docs: 'documentation',
  };
  const mapped: ModuleType | undefined = aliases[value];
  if (mapped !== undefined) return mapped;
  const prefix = VALID_MODULE_TYPES.find((type) => type.startsWith(value));
  if (prefix !== undefined) return prefix;
  const suffix = VALID_MODULE_TYPES.find((type) => value.length >= 3 && type.endsWith(value));
  return suffix;
}
