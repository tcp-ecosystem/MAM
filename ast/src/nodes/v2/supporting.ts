/**
 * MAM v2 AST Supporting Types
 */

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

export interface V2MemoryReference {
  type: 'local' | 'shared' | 'external';
  name?: string;
  backend?: string;
  scope?: string;
}

export interface V2LifecycleDefinition {
  created?: string;
  started?: string;
  stopped?: string;
  destroyed?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface V2ConfigDefinition {
  key: string;
  type: string;
  default?: unknown;
  description?: string;
  required: boolean;
  sensitive: boolean;
}

export interface V2DependencyDefinition {
  name: string;
  version: string;
  source: string;
  optional: boolean;
  capabilities: string[];
}

export interface V2ExportDefinition {
  name: string;
  type: string;
  alias?: string;
  selective: boolean;
}

export interface V2ImportDefinition {
  name: string;
  source: string;
  alias?: string;
  selective: boolean;
}

// ============================================================================
// Hook Types
// ============================================================================

export interface V2HookDefinition {
  name: string;
  event: string;
  handler: string;
  priority: number;
  async: boolean;
}

export interface V2TriggerDefinition {
  name: string;
  type: string;
  source: string;
  condition?: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// Condition Types
// ============================================================================

export interface V2ConditionDefinition {
  field: string;
  operator: string;
  value: unknown;
  negate: boolean;
}

// ============================================================================
// Retry and Timeout Types
// ============================================================================

export interface V2RetryDefinition {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn: string[];
}

export interface V2TimeoutDefinition {
  value: number;
  unit: string;
  action: string;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface V2CacheDefinition {
  key: string;
  ttl: number;
  scope: string;
  invalidateOn: string[];
}

// ============================================================================
// Rate Limit Types
// ============================================================================

export interface V2RateLimitDefinition {
  maxRequests: number;
  windowMs: number;
  burst: number;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface V2AuthDefinition {
  type: string;
  provider: string;
  scopes: string[];
  tokenUrl?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface V2ValidationDefinition {
  field: string;
  rules: string[];
  message?: string;
}

// ============================================================================
// Transform Types
// ============================================================================

export interface V2TransformDefinition {
  input: string;
  output: string;
  expression: string;
}

// ============================================================================
// Constraint Types
// ============================================================================

export interface V2ConstraintDefinition {
  type: string;
  target: string;
  params: Record<string, unknown>;
}

// ============================================================================
// Mapping Types
// ============================================================================

export interface V2MappingDefinition {
  source: string;
  target: string;
  transform?: string;
}

// ============================================================================
// Metadata and Tag Types
// ============================================================================

export interface V2MetadataDefinition {
  key: string;
  value: unknown;
  source: string;
}

export interface V2TagDefinition {
  name: string;
  value?: string;
}

export interface V2AnnotationDefinition {
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// Rate Limit Configuration
// ============================================================================

export interface V2RateLimitConfig {
  enabled: boolean;
  maxRequests: number;
  windowMs: number;
  burst: number;
  message?: string;
  statusCode?: number;
}

// ============================================================================
// Cache Configuration
// ============================================================================

export interface V2CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize?: number;
  strategy?: string;
  invalidateOn?: string[];
}

// ============================================================================
// Logging Configuration
// ============================================================================

export interface V2LoggingConfig {
  level: string;
  format?: string;
  destination?: string;
  rotation?: string;
  retention?: string;
}

// ============================================================================
// Monitoring Configuration
// ============================================================================

export interface V2MonitoringConfig {
  enabled: boolean;
  metrics?: string[];
  alerts?: string[];
  dashboard?: string;
  sampling?: number;
}

// ============================================================================
// Deployment Configuration
// ============================================================================

export interface V2DeploymentConfig {
  environment: string;
  region?: string;
  replicas?: number;
  resources?: Record<string, unknown>;
  healthCheck?: string;
  readinessProbe?: string;
}

// ============================================================================
// Security Configuration
// ============================================================================

export interface V2SecurityConfig {
  tls?: boolean;
  cors?: Record<string, unknown>;
  rateLimit?: V2RateLimitConfig;
  auth?: V2AuthDefinition;
  encryption?: string;
}

// ============================================================================
// Performance Configuration
// ============================================================================

export interface V2PerformanceConfig {
  timeout?: V2TimeoutDefinition;
  retry?: V2RetryDefinition;
  cache?: V2CacheConfig;
  rateLimit?: V2RateLimitConfig;
  compression?: boolean;
  poolSize?: number;
}

// ============================================================================
// Type Guard Utilities
// ============================================================================

export function isV2PortDefinition(value: unknown): value is V2PortDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.type === 'string' && typeof obj.required === 'boolean';
}

export function isV2PermissionSet(value: unknown): value is V2PermissionSet {
  if (typeof value !== 'object' || value === null) return false;
  return true;
}

export function isV2EventDefinition(value: unknown): value is V2EventDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.trigger === 'string';
}

export function isV2StateDefinition(value: unknown): value is V2StateDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.type === 'string';
}

export function isV2MemoryReference(value: unknown): value is V2MemoryReference {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.type === 'local' || obj.type === 'shared' || obj.type === 'external';
}

export function isV2ConfigDefinition(value: unknown): value is V2ConfigDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.key === 'string' && typeof obj.type === 'string' && typeof obj.required === 'boolean';
}

export function isV2DependencyDefinition(value: unknown): value is V2DependencyDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.version === 'string' && typeof obj.source === 'string';
}

export function createDefaultPortDefinition(name: string, type: string): V2PortDefinition {
  return { name, type, required: true };
}

export function createDefaultPermissionSet(): V2PermissionSet {
  return {
    filesystem: 'none',
    network: 'none',
    python: 'none',
    memory: 'none',
    exec: 'denied',
  };
}

export function createDefaultMemoryReference(type: 'local' | 'shared' | 'external'): V2MemoryReference {
  return { type };
}

export function createDefaultRetryDefinition(): V2RetryDefinition {
  return { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, retryOn: [] };
}

export function createDefaultTimeoutDefinition(): V2TimeoutDefinition {
  return { value: 30, unit: 's', action: 'abort' };
}

// ============================================================================
// Extended Factories and Guards
// ============================================================================

export function createPortDefinition(
  name: string,
  type: string,
  options?: { required?: boolean; description?: string; default?: unknown }
): V2PortDefinition {
  const port: V2PortDefinition = { name, type, required: options?.required ?? true };
  if (options?.description !== undefined) {
    port.description = options.description;
  }
  if (options?.default !== undefined) {
    port.default = options.default;
  }
  return port;
}

export function createPermissionSet(overrides?: V2PermissionSet): V2PermissionSet {
  return { ...createDefaultPermissionSet(), ...overrides };
}

export function isPortDefinition(value: unknown): value is V2PortDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.required === 'boolean' &&
    (obj.description === undefined || typeof obj.description === 'string')
  );
}

export function isPermissionSet(value: unknown): value is V2PermissionSet {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    filesystem: ['read', 'write', 'none'],
    network: ['internet', 'internal', 'none'],
    python: ['sandbox', 'full', 'none'],
    memory: ['local', 'shared', 'none'],
    exec: ['allowed', 'denied'],
  };
  for (const key of Object.keys(obj)) {
    if (key !== 'custom' && !(key in allowed)) return false;
  }
  for (const [key, values] of Object.entries(allowed)) {
    const current = obj[key];
    if (current !== undefined && (typeof current !== 'string' || !values.includes(current))) {
      return false;
    }
  }
  if (obj.custom !== undefined) {
    if (typeof obj.custom !== 'object' || obj.custom === null || Array.isArray(obj.custom)) return false;
    const custom = obj.custom as Record<string, unknown>;
    for (const entry of Object.values(custom)) {
      if (typeof entry !== 'string') return false;
    }
  }
  return true;
}

export function mergePermissionSets(a: V2PermissionSet, b: V2PermissionSet): V2PermissionSet {
  const merged: V2PermissionSet = { ...a, ...b };
  if (a.custom !== undefined || b.custom !== undefined) {
    merged.custom = { ...a.custom, ...b.custom };
  }
  return merged;
}

export function countPorts(node: {
  ports?: V2PortDefinition[];
  inputs?: V2PortDefinition[];
  outputs?: V2PortDefinition[];
  parameters?: V2PortDefinition[];
  returns?: V2PortDefinition[];
}): number {
  return (
    (node.ports?.length ?? 0) +
    (node.inputs?.length ?? 0) +
    (node.outputs?.length ?? 0) +
    (node.parameters?.length ?? 0) +
    (node.returns?.length ?? 0)
  );
}

export function createMemoryReference(
  type: 'local' | 'shared' | 'external',
  options?: { name?: string; backend?: string; scope?: string }
): V2MemoryReference {
  const reference: V2MemoryReference = { type };
  if (options?.name !== undefined) {
    reference.name = options.name;
  }
  if (options?.backend !== undefined) {
    reference.backend = options.backend;
  }
  if (options?.scope !== undefined) {
    reference.scope = options.scope;
  }
  return reference;
}
