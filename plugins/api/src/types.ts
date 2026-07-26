/**
 * MAM Plugin API Types
 */

import { MAMModule, Section, ContentNode, CodeBlock } from '@mam/ast';
import { ValidationReport } from '@mam/validator';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  mamVersion: string;
  keywords: string[];
  repository?: string;
  main: string;
  dependencies?: string[];
}

export interface MAMPlugin {
  manifest: PluginManifest;
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
  sections?: SectionDefinition[];
  rules?: ValidationRule[];
  hooks?: PluginHooks;
  contexts?: RuntimeContext[];
  exporters?: Exporter[];
  renderers?: Renderer[];
}

export interface SectionDefinition {
  name: string;
  description: string;
  required: boolean;
  contentTypes: ContentType[];
  validator?: (content: ContentNode[]) => ValidationResult[];
  renderer?: (content: ContentNode[]) => string;
}

export type ContentType = 'text' | 'list' | 'code' | 'table' | 'diagram' | 'mixed';

export interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  check(ast: MAMModule): ValidationResult[];
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  location?: { line: number; column: number };
}

export interface PluginHooks {
  beforeParse?: (input: string) => Promise<string> | string;
  afterParse?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  beforeValidation?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  afterValidation?: (report: ValidationReport) => Promise<ValidationReport> | ValidationReport;
  beforeExecution?: (module: MAMModule) => Promise<MAMModule> | MAMModule;
  afterExecution?: (result: ExecutionResult) => Promise<ExecutionResult> | ExecutionResult;
  onError?: (error: Error) => Promise<void> | void;
  onSection?: (section: Section) => Promise<Section | null> | Section | null;
  onCodeBlock?: (block: CodeBlock) => Promise<CodeBlock | null> | CodeBlock | null;
}

export interface RuntimeContext {
  name: string;
  language: string;
  execute(code: string, context: ExecutionContext): Promise<ExecutionResult>;
  canHandle(language: string): boolean;
}

export interface ExecutionContext {
  module: MAMModule;
  inputs: Record<string, unknown>;
  memory: Record<string, unknown>;
  timeout: number;
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  timeMs: number;
}

export interface Exporter {
  name: string;
  format: string;
  export(module: MAMModule): Promise<string>;
  extension: string;
}

export interface Renderer {
  name: string;
  target: 'html' | 'markdown' | 'json' | 'text';
  render(content: ContentNode[]): string;
}

export type HookName =
  | 'beforeParse' | 'afterParse'
  | 'beforeValidate' | 'afterValidate'
  | 'beforeExecute' | 'afterExecute'
  | 'beforeExport' | 'afterExport'
  | 'onError';

export interface HookRegistration {
  plugin: MAMPlugin;
  hook: HookName;
  handler: (...args: unknown[]) => Promise<unknown> | unknown;
  priority: number;
}

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  plugin: MAMPlugin;
  path: string;
  enabled: boolean;
  loadedAt: Date;
}

export type PluginEvent =
  | 'plugin:loaded'
  | 'plugin:unloaded'
  | 'plugin:error'
  | 'parse:before'
  | 'parse:after'
  | 'validate:before'
  | 'validate:after'
  | 'execute:before'
  | 'execute:after';