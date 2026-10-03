/**
 * MAM Plugin API Types
 *
 * Core type definitions for the MAM plugin system.
 * Every plugin, hook, renderer, exporter, and runtime context
 * is typed through this module.
 */

import { MAMModule, Section, ContentNode, CodeBlock } from '@mam/ast';
import { ValidationReport } from '@mam/validator';

// ─── Plugin Manifest ────────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  mamVersion: string;
  keywords: string[];
  repository?: string;
  homepage?: string;
  main: string;
  dependencies?: string[];
  peerDependencies?: string[];
  engines?: Record<string, string>;
  categories?: PluginCategory[];
  icon?: string;
  changelog?: string;
}

export type PluginCategory =
  | 'language'
  | 'renderer'
  | 'validator'
  | 'exporter'
  | 'runtime'
  | 'storage'
  | 'testing'
  | 'tooling'
  | 'integration'
  | 'theme';

// ─── Plugin Definition ──────────────────────────────────────────────

export interface MAMPlugin {
  manifest: PluginManifest;
  onLoad?(): Promise<void> | void;
  onUnload?(): Promise<void> | void;
  onEnable?(): Promise<void> | void;
  onDisable?(): Promise<void> | void;
  sections?: SectionDefinition[];
  rules?: ValidationRule[];
  hooks?: PluginHooks;
  contexts?: RuntimeContext[];
  exporters?: Exporter[];
  renderers?: Renderer[];
  transformers?: Transformer[];
  middleware?: PluginMiddleware[];
}

// ─── Section Definition ─────────────────────────────────────────────

export interface SectionDefinition {
  name: string;
  description: string;
  required: boolean;
  contentTypes: ContentType[];
  aliases?: string[];
  validator?: (content: ContentNode[]) => ValidationResult[];
  renderer?: (content: ContentNode[]) => string;
  parser?: (raw: string) => ContentNode[];
  examples?: SectionExample[];
}

export interface SectionExample {
  title: string;
  input: string;
  expectedOutput?: string;
  description?: string;
}

export type ContentType = 'text' | 'list' | 'code' | 'table' | 'diagram' | 'mixed';

// ─── Validation ─────────────────────────────────────────────────────

export interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  category?: string;
  tags?: string[];
  fixable?: boolean;
  check(ast: MAMModule): ValidationResult[];
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  location?: { line: number; column: number };
  path?: string;
  rule?: string;
  severity?: 'error' | 'warning' | 'info';
  fix?: ValidationFix;
  related?: ValidationResult[];
}

export interface ValidationFix {
  description: string;
  replacements: ValidationFixReplacement[];
  autoFixable: boolean;
}

export interface ValidationFixReplacement {
  range: { start: number; end: number };
  replacement: string;
  description: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────

export interface PluginHooks {
  beforeParse?: (input: string) => Promise<string> | string;
  afterParse?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  beforeValidation?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  afterValidation?: (report: ValidationReport) => Promise<ValidationReport> | ValidationReport;
  beforeExecution?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  afterExecution?: (result: ExecutionResult) => Promise<ExecutionResult> | ExecutionResult;
  beforeExport?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  afterExport?: (output: ExportOutput) => Promise<ExportOutput> | ExportOutput;
  onError?: (error: PluginError) => Promise<PluginError | void> | PluginError | void;
  onSection?: (section: Section) => Promise<Section | null> | Section | null;
  onCodeBlock?: (block: CodeBlock) => Promise<CodeBlock | null> | CodeBlock | null;
  onModuleLoad?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  onModuleSave?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  onConfigChange?: (config: PluginConfig) => Promise<PluginConfig> | PluginConfig;
}

export interface PluginError {
  error: Error;
  phase: string;
  plugin?: string;
  module?: string;
  handled: boolean;
  recovery?: string;
}

export interface ExportOutput {
  format: string;
  content: string;
  filename?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginConfig {
  [key: string]: unknown;
}

// ─── Runtime Context ────────────────────────────────────────────────

export interface RuntimeContext {
  name: string;
  language: string;
  version?: string;
  execute(code: string, context: ExecutionContext): Promise<ExecutionResult>;
  canHandle(language: string): boolean;
  getCapabilities?(): RuntimeCapability[];
  getExtensions?(): string[];
  getBinaryPath?(): string | null;
  isAvailable?(): Promise<boolean>;
}

export interface RuntimeCapability {
  name: string;
  description: string;
  supported: boolean;
  version?: string;
}

export interface ExecutionContext {
  module: MAMModule;
  inputs: Record<string, unknown>;
  memory: Record<string, unknown>;
  timeout: number;
  cwd?: string;
  env?: Record<string, string>;
  maxOutputSize?: number;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  timeMs: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  memory?: Record<string, unknown>;
  artifacts?: ExecutionArtifact[];
}

export interface ExecutionArtifact {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'url';
  size?: number;
  mimeType?: string;
}

// ─── Exporter ───────────────────────────────────────────────────────

export interface Exporter {
  name: string;
  format: string;
  export(module: MAMModule, options?: ExportOptions): Promise<string>;
  extension: string;
  mimeType?: string;
  supportsBatch?: boolean;
  getOptions?(): ExportOptionDefinition[];
}

export interface ExportOptions {
  pretty?: boolean;
  indent?: number;
  includeSource?: boolean;
  includeMetadata?: boolean;
  minify?: boolean;
  template?: string;
}

export interface ExportOptionDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  default?: unknown;
  choices?: string[];
  required?: boolean;
}

// ─── Renderer ───────────────────────────────────────────────────────

export interface Renderer {
  name: string;
  target: RenderTarget;
  render(content: ContentNode[], options?: RenderOptions): string;
  getStyles?(): string;
  getScripts?(): string[];
  supportsPartial?(): boolean;
}

export type RenderTarget = 'html' | 'markdown' | 'json' | 'text' | 'svg' | 'pdf';

export interface RenderOptions {
  indent?: number;
  theme?: string;
  css?: Record<string, string>;
  wrapper?: boolean;
  sanitize?: boolean;
}

// ─── Transformer ────────────────────────────────────────────────────

export interface Transformer {
  name: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  transform(input: string, context: TransformContext): Promise<string> | string;
  canTransform(from: string, to: string): boolean;
}

export interface TransformContext {
  module?: MAMModule;
  options?: Record<string, unknown>;
  variables?: Record<string, string>;
}

// ─── Middleware ──────────────────────────────────────────────────────

export interface PluginMiddleware {
  name: string;
  phase: MiddlewarePhase;
  handler(data: unknown, next: () => Promise<unknown>): Promise<unknown>;
  priority?: number;
}

export type MiddlewarePhase =
  | 'pre-parse'
  | 'post-parse'
  | 'pre-validate'
  | 'post-validate'
  | 'pre-export'
  | 'post-export'
  | 'pre-execute'
  | 'post-execute';

// ─── Hook System Types ──────────────────────────────────────────────

export type HookName =
  | 'beforeParse'
  | 'afterParse'
  | 'beforeValidate'
  | 'afterValidate'
  | 'beforeExecute'
  | 'afterExecute'
  | 'beforeExport'
  | 'afterExport'
  | 'onError'
  | 'onModuleLoad'
  | 'onModuleSave'
  | 'onConfigChange';

export const ALL_HOOK_NAMES: HookName[] = [
  'beforeParse', 'afterParse',
  'beforeValidate', 'afterValidate',
  'beforeExecute', 'afterExecute',
  'beforeExport', 'afterExport',
  'onError', 'onModuleLoad', 'onModuleSave', 'onConfigChange',
];

export interface HookRegistration {
  plugin: MAMPlugin;
  hook: HookName;
  handler: (...args: unknown[]) => Promise<unknown> | unknown;
  priority: number;
  id: string;
  enabled: boolean;
  createdAt: Date;
}

// ─── Registry Types ─────────────────────────────────────────────────

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  plugin: MAMPlugin;
  path: string;
  enabled: boolean;
  loadedAt: Date;
  loadCount: number;
  errorCount: number;
  lastError?: Error;
  dependencies: string[];
  dependents: string[];
}

export interface PluginRegistryConfig {
  searchPaths: string[];
  autoDiscover: boolean;
  autoLoad: boolean;
  enableDependencyResolution: boolean;
  maxPlugins: number;
  timeout: number;
}

// ─── Event Types ────────────────────────────────────────────────────

export type PluginEvent =
  | 'plugin:loaded'
  | 'plugin:unloaded'
  | 'plugin:error'
  | 'plugin:enabled'
  | 'plugin:disabled'
  | 'plugin:dependency-added'
  | 'plugin:dependency-removed'
  | 'parse:before'
  | 'parse:after'
  | 'validate:before'
  | 'validate:after'
  | 'execute:before'
  | 'execute:after'
  | 'export:before'
  | 'export:after'
  | 'config:changed'
  | 'module:loaded'
  | 'module:saved';

/** Every {@link PluginEvent}, as a runtime value. */
export const ALL_PLUGIN_EVENTS: PluginEvent[] = [
  'plugin:loaded', 'plugin:unloaded', 'plugin:error',
  'plugin:enabled', 'plugin:disabled',
  'plugin:dependency-added', 'plugin:dependency-removed',
  'parse:before', 'parse:after',
  'validate:before', 'validate:after',
  'execute:before', 'execute:after',
  'export:before', 'export:after',
  'config:changed', 'module:loaded', 'module:saved',
];

/** Every {@link PluginCategory}, as a runtime value. */
export const ALL_PLUGIN_CATEGORIES: PluginCategory[] = [
  'language', 'renderer', 'validator', 'exporter', 'runtime',
  'storage', 'testing', 'tooling', 'integration', 'theme',
];

export interface PluginEventData {
  event: PluginEvent;
  plugin?: string;
  module?: string;
  timestamp: Date;
  data?: unknown;
  error?: Error;
}

// ─── Type Guards ────────────────────────────────────────────────────

export function isMAMPlugin(value: unknown): value is MAMPlugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    'manifest' in value &&
    typeof (value as MAMPlugin).manifest === 'object' &&
    typeof (value as MAMPlugin).manifest.name === 'string'
  );
}

export function isValidationResult(value: unknown): value is ValidationResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'valid' in value &&
    typeof (value as ValidationResult).valid === 'boolean' &&
    'message' in value &&
    typeof (value as ValidationResult).message === 'string'
  );
}

export function isExecutionResult(value: unknown): value is ExecutionResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as ExecutionResult).success === 'boolean' &&
    'timeMs' in value &&
    typeof (value as ExecutionResult).timeMs === 'number'
  );
}

export function isRuntimeContext(value: unknown): value is RuntimeContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'language' in value &&
    typeof (value as RuntimeContext).execute === 'function' &&
    typeof (value as RuntimeContext).canHandle === 'function'
  );
}

export function isRenderer(value: unknown): value is Renderer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'target' in value &&
    typeof (value as Renderer).render === 'function'
  );
}

export function isExporter(value: unknown): value is Exporter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'format' in value &&
    typeof (value as Exporter).export === 'function'
  );
}

export function isTransformer(value: unknown): value is Transformer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as Transformer).transform === 'function' &&
    typeof (value as Transformer).canTransform === 'function'
  );
}

export function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as PluginManifest;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.main === 'string'
  );
}

export function isHookName(value: unknown): value is HookName {
  return typeof value === 'string' && ALL_HOOK_NAMES.includes(value as HookName);
}

export function isPluginEvent(value: unknown): value is PluginEvent {
  return typeof value === 'string' && ALL_PLUGIN_EVENTS.includes(value as PluginEvent);
}

export function isPluginCategory(value: unknown): value is PluginCategory {
  return (
    typeof value === 'string' &&
    (ALL_PLUGIN_CATEGORIES as string[]).includes(value)
  );
}

export function isSectionDefinition(value: unknown): value is SectionDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as SectionDefinition;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    Array.isArray(candidate.contentTypes)
  );
}

export function isValidationRule(value: unknown): value is ValidationRule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as ValidationRule;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.check === 'function' &&
    typeof candidate.severity === 'string'
  );
}

export function isPluginMiddleware(value: unknown): value is PluginMiddleware {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as PluginMiddleware;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.phase === 'string' &&
    typeof candidate.handler === 'function'
  );
}

// ─── Utility Types ──────────────────────────────────────────────────

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type PluginMap = Map<string, MAMPlugin>;
export type RegistryMap = Map<string, PluginRegistryEntry>;
export type HookMap = Map<HookName, HookRegistration[]>;
export type EventMap = Map<string, EventSubscription[]>;

export interface EventSubscription {
  event: string;
  handler: (...args: unknown[]) => void | Promise<void>;
  once: boolean;
  id: string;
  plugin?: string;
}
