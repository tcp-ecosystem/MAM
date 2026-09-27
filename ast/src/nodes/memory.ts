/**
 * MAM Memory Section Node
 *
 * Defines the MemoryNode and related types for the Memory section.
 * Memory configuration describes how the module persists and retrieves state,
 * including the storage format, backend, scope, TTL, indexes, and custom
 * configuration.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** The storage format used by a memory backend. */
export type MemoryFormat =
  | 'vector'
  | 'key-value'
  | 'relational'
  | 'graph'
  | 'document'
  | string;

/** The storage backend implementation. */
export type MemoryBackend =
  | 'sqlite'
  | 'redis'
  | 'postgres'
  | 'mongo'
  | 'faiss'
  | 'chroma'
  | 'pinecone'
  | 'weaviate'
  | 'memory'
  | string;

/** Scope that controls memory visibility. */
export type MemoryScope =
  | 'module'
  | 'session'
  | 'workspace'
  | 'global'
  | string;

/** An index definition for efficient lookups. */
export interface MemoryIndex {
  /** Index name. */
  name: string;
  /** Fields to index. */
  fields: string[];
  /** Index type. */
  type?: 'hash' | 'btree' | 'fulltext' | 'vector' | 'unique';
  /** Whether the index is unique. */
  unique?: boolean;
}

/** Custom configuration key-value pair. */
export interface MemoryConfiguration {
  /** Configuration key. */
  key: string;
  /** Configuration value (JSON-encoded). */
  value: string;
  /** Optional description. */
  description?: string;
}

/** The Memory section AST node. */
export interface MemoryNode {
  /** Discriminant – always `'Memory'`. */
  type: 'Memory';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Storage format. */
  format?: MemoryFormat;
  /** Storage backend. */
  backend?: MemoryBackend;
  /** Memory scope. */
  scope?: MemoryScope;
  /** Time-to-live string (e.g. `"1h"`, `"7d"`). */
  ttl?: string;
  /** Custom configuration entries. */
  configuration?: MemoryConfiguration[];
  /** Index definitions. */
  indexes?: MemoryIndex[];
  /** Maximum capacity (entries or bytes, expressed as string). */
  capacity?: string;
  /** Whether to enable compression. */
  compressed?: boolean;
  /** Encryption at rest flag. */
  encrypted?: boolean;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

const VALID_MEMORY_FORMATS = new Set([
  'vector', 'key-value', 'relational', 'graph', 'document',
]);

const VALID_MEMORY_SCOPES = new Set([
  'module', 'session', 'workspace', 'global',
]);

/**
 * Validate a MemoryNode.
 * Returns an empty array when the node is valid.
 */
export function validateMemoryNode(node: MemoryNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'MemoryNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Memory') {
    errors.push({ path: 'type', message: `Expected type "Memory", got "${node.type}".` });
  }

  if (node.format !== undefined && !VALID_MEMORY_FORMATS.has(node.format)) {
    errors.push({
      path: 'format',
      message: `format "${node.format}" is not a standard format. Allowed: ${Array.from(VALID_MEMORY_FORMATS).join(', ')}.`,
    });
  }

  if (node.scope !== undefined && !VALID_MEMORY_SCOPES.has(node.scope)) {
    errors.push({
      path: 'scope',
      message: `scope "${node.scope}" is not a standard scope. Allowed: ${Array.from(VALID_MEMORY_SCOPES).join(', ')}.`,
    });
  }

  if (node.ttl !== undefined) {
    if (typeof node.ttl !== 'string') {
      errors.push({ path: 'ttl', message: 'ttl must be a string (e.g. "1h", "7d").' });
    } else if (!/^\d+\s*[smhdw]?$/.test(node.ttl.trim())) {
      errors.push({ path: 'ttl', message: `ttl "${node.ttl}" does not match expected format.` });
    }
  }

  if (node.indexes) {
    if (!Array.isArray(node.indexes)) {
      errors.push({ path: 'indexes', message: 'indexes must be an array.' });
    } else {
      node.indexes.forEach((idx, i) => {
        const base = `indexes[${i}]`;
        if (!idx.name || typeof idx.name !== 'string') {
          errors.push({ path: `${base}.name`, message: 'Index name must be a non-empty string.' });
        }
        if (!Array.isArray(idx.fields) || idx.fields.length === 0) {
          errors.push({ path: `${base}.fields`, message: 'Index fields must be a non-empty array.' });
        }
      });
    }
  }

  if (node.configuration) {
    if (!Array.isArray(node.configuration)) {
      errors.push({ path: 'configuration', message: 'configuration must be an array.' });
    } else {
      node.configuration.forEach((cfg, i) => {
        const base = `configuration[${i}]`;
        if (!cfg.key || typeof cfg.key !== 'string') {
          errors.push({ path: `${base}.key`, message: 'Configuration key must be a non-empty string.' });
        }
      });
    }
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateMemoryNodeOptions {
  format?: MemoryFormat;
  backend?: MemoryBackend;
  scope?: MemoryScope;
  ttl?: string;
  configuration?: MemoryConfiguration[];
  indexes?: MemoryIndex[];
  capacity?: string;
  compressed?: boolean;
  encrypted?: boolean;
  location?: SourceLocation;
}

/** Create a MemoryNode with sensible defaults. */
export function createMemoryNode(options: CreateMemoryNodeOptions = {}): MemoryNode {
  return {
    type: 'Memory',
    format: options.format,
    backend: options.backend,
    scope: options.scope,
    ttl: options.ttl,
    configuration: options.configuration,
    indexes: options.indexes,
    capacity: options.capacity,
    compressed: options.compressed,
    encrypted: options.encrypted,
    location: options.location,
  };
}

/** Create a MemoryIndex. */
export function createMemoryIndex(
  name: string,
  fields: string[],
  overrides: Partial<Omit<MemoryIndex, 'name' | 'fields'>> = {},
): MemoryIndex {
  return { name, fields, ...overrides };
}

/** Create a MemoryConfiguration entry. */
export function createMemoryConfiguration(
  key: string,
  value: string,
  description?: string,
): MemoryConfiguration {
  return { key, value, description };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a MemoryNode. */
export function isMemoryNode(value: unknown): value is MemoryNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as MemoryNode).type === 'Memory'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all index names. */
export function getIndexNames(node: MemoryNode): string[] {
  return (node.indexes ?? []).map((i) => i.name);
}

/** Find an index by name. */
export function findIndexByName(node: MemoryNode, name: string): MemoryIndex | undefined {
  return node.indexes?.find((i) => i.name === name);
}

/** Return all configuration keys. */
export function getConfigurationKeys(node: MemoryNode): string[] {
  return (node.configuration ?? []).map((c) => c.key);
}

/** Find a configuration entry by key. */
export function findConfigurationByKey(node: MemoryNode, key: string): MemoryConfiguration | undefined {
  return node.configuration?.find((c) => c.key === key);
}

/** Check whether the memory is vector-based. */
export function isVectorMemory(node: MemoryNode): boolean {
  return node.format === 'vector';
}

/** Check whether the memory is encrypted. */
export function isEncrypted(node: MemoryNode): boolean {
  return node.encrypted === true;
}

/** Count total indexes. */
export function countIndexes(node: MemoryNode): number {
  return node.indexes?.length ?? 0;
}

export function hasMemoryIndexes(node: MemoryNode): boolean {
  return (node.indexes?.length ?? 0) > 0;
}

export function countMemoryIndexes(node: MemoryNode): number {
  return node.indexes?.length ?? 0;
}

export function summarizeMemory(node: MemoryNode): string {
  const parts: string[] = [];
  if (node.format) {
    parts.push(`format=${node.format}`);
  }
  if (node.backend) {
    parts.push(`backend=${node.backend}`);
  }
  if (node.scope) {
    parts.push(`scope=${node.scope}`);
  }
  if (node.ttl) {
    parts.push(`ttl=${node.ttl}`);
  }
  parts.push(`${node.indexes?.length ?? 0} indexes`);
  parts.push(`${node.configuration?.length ?? 0} configurations`);
  return `Memory: ${parts.join(', ')}`;
}

export function withMemoryIndex(node: MemoryNode, index: MemoryIndex): MemoryNode {
  return {
    ...node,
    indexes: [...(node.indexes ?? []), index],
  };
}

export function withoutMemoryIndex(
  node: MemoryNode,
  match: string | ((index: MemoryIndex) => boolean),
): MemoryNode {
  if (!node.indexes) {
    return { ...node };
  }
  const remove =
    typeof match === 'string'
      ? (index: MemoryIndex) => index.name === match
      : match;
  return {
    ...node,
    indexes: node.indexes.filter((index) => !remove(index)),
  };
}

export function cloneMemoryNode(
  node: MemoryNode,
  options: { stripLocation?: boolean } = {},
): MemoryNode {
  const copy: MemoryNode = { ...node };
  if (node.indexes) {
    copy.indexes = node.indexes.map((index) => ({
      ...index,
      fields: [...index.fields],
    }));
  }
  if (node.configuration) {
    copy.configuration = node.configuration.map((entry) => ({ ...entry }));
  }
  if (options.stripLocation) {
    delete copy.location;
  } else if (copy.location) {
    copy.location = {
      source: copy.location.source,
      start: { ...copy.location.start },
      end: { ...copy.location.end },
    };
  }
  return copy;
}

export function mergeMemoryConfigurations(a: MemoryNode, b: MemoryNode): MemoryNode {
  const merged: MemoryNode = { ...a };
  if (a.configuration || b.configuration) {
    const byKey = new Map<string, MemoryConfiguration>();
    for (const entry of a.configuration ?? []) {
      byKey.set(entry.key, entry);
    }
    for (const entry of b.configuration ?? []) {
      byKey.set(entry.key, entry);
    }
    merged.configuration = Array.from(byKey.values());
  }
  return merged;
}
