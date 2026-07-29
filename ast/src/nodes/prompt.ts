/**
 * MAM Prompt Section Node
 *
 * Defines the PromptNode and related types for the Prompt section.
 * A prompt node captures the system/user prompt template, variable
 * definitions, reusable sub-templates, and template metadata.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Role of a prompt segment. */
export type PromptRole = 'system' | 'user' | 'assistant' | 'function' | string;

/** A variable referenced inside the prompt template. */
export interface PromptVariable {
  /** Variable name (without delimiters). */
  name: string;
  /** Variable type (e.g. "string", "number", "json"). */
  type?: string;
  /** Default value (JSON-encoded). */
  default?: string;
  /** Human-readable description. */
  description?: string;
  /** Whether the variable is required. */
  required?: boolean;
}

/** A reusable template block. */
export interface PromptTemplate {
  /** Template identifier. */
  id: string;
  /** Template content. */
  content: string;
  /** Role of the template. */
  role?: PromptRole;
  /** Priority (higher = applied later / overrides). */
  priority?: number;
}

/** The Prompt section AST node. */
export interface PromptNode {
  /** Discriminant – always `'Prompt'`. */
  type: 'Prompt';
  /** Source location of the section. */
  location?: SourceLocation;
  /** The prompt content (raw text / Markdown). */
  content: string;
  /** Variables referenced in the prompt. */
  variables?: PromptVariable[];
  /** Reusable sub-templates. */
  templates?: PromptTemplate[];
  /** The system-level prompt (if separated). */
  systemPrompt?: string;
  /** Prompt role. */
  role?: PromptRole;
  /** Temperature hint. */
  temperature?: number;
  /** Maximum tokens hint. */
  maxTokens?: number;
  /** Stop sequences. */
  stopSequences?: string[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Extract variable names from a prompt template string.
 * Matches `{{varName}}`, `{varName}`, and `${varName}` patterns.
 */
export function extractVariablesFromContent(content: string): string[] {
  const vars = new Set<string>();
  const patterns = [
    /\{\{(\w+)\}\}/g,
    /\{(\w+)\}/g,
    /\$\{(\w+)\}/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      vars.add(match[1]);
    }
  }
  return Array.from(vars);
}

/**
 * Validate a PromptNode.
 * Returns an empty array when the node is valid.
 */
export function validatePromptNode(node: PromptNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'PromptNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Prompt') {
    errors.push({ path: 'type', message: `Expected type "Prompt", got "${node.type}".` });
  }

  if (!node.content || typeof node.content !== 'string') {
    errors.push({ path: 'content', message: 'content must be a non-empty string.' });
  }

  if (node.variables) {
    if (!Array.isArray(node.variables)) {
      errors.push({ path: 'variables', message: 'variables must be an array.' });
    } else {
      node.variables.forEach((v, i) => {
        const base = `variables[${i}]`;
        if (!v.name || typeof v.name !== 'string') {
          errors.push({ path: `${base}.name`, message: 'Variable name must be a non-empty string.' });
        }
      });
    }
  }

  if (node.templates) {
    if (!Array.isArray(node.templates)) {
      errors.push({ path: 'templates', message: 'templates must be an array.' });
    } else {
      node.templates.forEach((t, i) => {
        const base = `templates[${i}]`;
        if (!t.id || typeof t.id !== 'string') {
          errors.push({ path: `${base}.id`, message: 'Template id must be a non-empty string.' });
        }
        if (!t.content || typeof t.content !== 'string') {
          errors.push({ path: `${base}.content`, message: 'Template content must be a non-empty string.' });
        }
      });
    }
  }

  if (node.temperature !== undefined) {
    if (typeof node.temperature !== 'number' || node.temperature < 0 || node.temperature > 2) {
      errors.push({ path: 'temperature', message: 'temperature must be a number between 0 and 2.' });
    }
  }

  if (node.maxTokens !== undefined) {
    if (typeof node.maxTokens !== 'number' || node.maxTokens < 0) {
      errors.push({ path: 'maxTokens', message: 'maxTokens must be a non-negative number.' });
    }
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreatePromptNodeOptions {
  content: string;
  variables?: PromptVariable[];
  templates?: PromptTemplate[];
  systemPrompt?: string;
  role?: PromptRole;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  location?: SourceLocation;
}

/** Create a PromptNode with sensible defaults. */
export function createPromptNode(options: CreatePromptNodeOptions): PromptNode {
  return {
    type: 'Prompt',
    content: options.content,
    variables: options.variables,
    templates: options.templates,
    systemPrompt: options.systemPrompt,
    role: options.role,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    stopSequences: options.stopSequences,
    location: options.location,
  };
}

/** Create a PromptVariable. */
export function createPromptVariable(
  name: string,
  overrides: Partial<Omit<PromptVariable, 'name'>> = {},
): PromptVariable {
  return { name, required: true, ...overrides };
}

/** Create a PromptTemplate. */
export function createPromptTemplate(
  id: string,
  content: string,
  overrides: Partial<Omit<PromptTemplate, 'id' | 'content'>> = {},
): PromptTemplate {
  return { id, content, ...overrides };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a PromptNode. */
export function isPromptNode(value: unknown): value is PromptNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PromptNode).type === 'Prompt' &&
    typeof (value as PromptNode).content === 'string'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all variable names declared on the node. */
export function getDeclaredVariableNames(node: PromptNode): string[] {
  return (node.variables ?? []).map((v) => v.name);
}

/** Return all variable names actually referenced in the content. */
export function getReferencedVariableNames(node: PromptNode): string[] {
  return extractVariablesFromContent(node.content);
}

/** Find a variable by name. */
export function findVariableByName(node: PromptNode, name: string): PromptVariable | undefined {
  return node.variables?.find((v) => v.name === name);
}

/** Return only required variables. */
export function getRequiredVariables(node: PromptNode): PromptVariable[] {
  return (node.variables ?? []).filter((v) => v.required !== false);
}

/** Check whether a variable is declared. */
export function hasVariable(node: PromptNode, name: string): boolean {
  return node.variables?.some((v) => v.name === name) ?? false;
}

/** Find a template by id. */
export function findTemplateById(node: PromptNode, id: string): PromptTemplate | undefined {
  return node.templates?.find((t) => t.id === id);
}

/** Return template ids. */
export function getTemplateIds(node: PromptNode): string[] {
  return (node.templates ?? []).map((t) => t.id);
}

/** Build the full prompt by merging system prompt and content. */
export function buildFullPrompt(node: PromptNode): string {
  const parts: string[] = [];
  if (node.systemPrompt) {
    parts.push(node.systemPrompt);
  }
  parts.push(node.content);
  return parts.join('\n');
}
