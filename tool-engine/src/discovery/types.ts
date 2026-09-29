/**
 * types.ts
 *
 * Core type definitions, guards, factories and defaults for the Discovery layer
 * of the standalone MAM Tool Engine.
 *
 * The Discovery layer registers, indexes and searches MAM tools by name,
 * description, tags and capabilities. This module is the single source of
 * truth for the shapes that travel through the registry (`store.ts`), the
 * search index (`index.ts`), the retrieval / scoring layer (`retrieval.ts`),
 * the lifecycle manager (`lifecycle.ts`) and the high-level facade
 * (`integration.ts`).
 *
 * The reference runtime model for a tool is:
 *
 *     ToolDefinition {
 *       name, description, parameters, handler,
 *       tags?, capabilities?
 *     }
 *
 * This module extends that model with optional `version` and `metadata`
 * fields so that discovery can version, compare and classify tools without
 * coupling to any particular execution runtime.
 *
 * All shapes here are plain data-friendly interfaces so that serialization
 * via `JSON.stringify` / `JSON.parse` round-trips without surprises. The
 * `handler` field is typed as an opaque function; consumers that actually
 * invoke handlers are expected to narrow the function signature themselves.
 */

import type { EventEmitter } from 'node:events';

/* -------------------------------------------------------------------------- *
 * Type parameter metadata
 * -------------------------------------------------------------------------- */

/**
 * Describes a single declared input parameter of a tool.
 *
 * Parameters form the *schema* of a tool: what a caller must (or may) supply
 * in order to invoke it. Discovery uses parameters purely as metadata for
 * indexing, search scoring and schema emission; it never invokes the tool.
 */
export interface ToolParameter {
  /**
   * The canonical parameter name. Names are treated as case-sensitive by the
   * discovery layer and must be unique within a tool's parameter list.
   */
  name: string;

  /**
   * The expected type of the value. Discovery accepts a small set of well
   * known types and will happily pass through any other string so that exotic
   * runtimes can attach custom type names.
   */
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'integer'
    | 'array'
    | 'object'
    | 'null'
    | (string & {});

  /**
   * Whether the caller must always supply this parameter. Optional parameters
   * must supply `default` if a default exists; required parameters may still
   * carry a `default` for documentation purposes.
   */
  required: boolean;

  /**
   * Free-form human description used by the search index to match tool
   * descriptions and by schema emission to document the parameter.
   */
  description?: string;

  /**
   * The value assumed when the parameter is omitted. Used by consumers that
   * resolve parameter values before invoking a tool.
   */
  default?: unknown;

  /**
   * An optional closed set of allowed values. When present, callers should
   * restrict the supplied value to one of these members.
   */
  enum?: unknown[];
}

/* -------------------------------------------------------------------------- *
 * Tool definition
 * -------------------------------------------------------------------------- */

/**
 * A fully registered tool in the Discovery layer.
 *
 * This is the reference model of the MAM runtime tool engine, extended with
 * optional `version` and `metadata` fields for richer indexing and
 * lifecycle handling. The `handler` is intentionally opaque: Discovery only
 * stores and moves it around, it never calls it.
 */
export interface ToolDefinition {
  /** Unique, stable tool name, e.g. `"http.get"`. */
  name: string;

  /** Short human readable summary of what the tool does. */
  description: string;

  /** Declared input schema, in declaration order. */
  parameters: ToolParameter[];

  /**
   * The callable implementation. Typed opaquely here; runtimes that actually
   * execute tools narrow this to a concrete signature.
   */
  handler: (...args: never[]) => unknown;

  /** Optional free-form classification tags used for faceted search. */
  tags?: string[];

  /** Optional capability names the tool provides, e.g. `"filesystem.read"`. */
  capabilities?: string[];

  /** Optional semantic version string, e.g. `"1.2.0"`. */
  version?: string;

  /**
   * Arbitrary application metadata. Values should be JSON-serializable so
   * that `toJSON`/`fromJSON` round-trips preserve them.
   */
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- *
 * Schema & capability descriptors
 * -------------------------------------------------------------------------- */

/**
 * The serializable representation of a tool's shape: name, description,
 * schema (parameters) and classification (tags / capabilities / version).
 *
 * `ToolSchema` deliberately omits `handler` and `metadata` so it can be
 * shipped to untrusted or remote consumers without leaking implementation.
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
  tags: string[];
  capabilities: string[];
  version?: string;
}

/**
 * A single named capability, bundled with the names of every tool currently
 * registered as providing it.
 */
export interface ToolCapability {
  /** Canonical capability name, e.g. `"http.request"`. */
  name: string;

  /** Names of all registered tools that advertise this capability. */
  tools: string[];
}

/* -------------------------------------------------------------------------- *
 * Configuration
 * -------------------------------------------------------------------------- */

/**
 * Tunables controlling the behaviour of the Discovery layer.
 */
export interface DiscoveryConfig {
  /**
   * Whether description tokens participate in search scoring. Defaults to
   * `true`. Disable to get a purely name/tag/capability driven searcher.
   */
  scoreDescriptions: boolean;

  /**
   * Case sensitivity for name matching during search. Defaults to `false`.
   * When disabled, names are compared in lower-case.
   */
  caseSensitiveNames: boolean;

  /**
   * If `true`, the lifecycle manager periodically re-indexes every registered
   * tool using `setInterval`. Defaults to `true`.
   */
  autoReindex: boolean;

  /**
   * Interval in milliseconds between automatic re-index passes. Defaults to
   * `60000`. Only used when `autoReindex` is true.
   */
  reindexIntervalMs: number;

  /**
   * Maximum number of results returned by any search operation unless the
   * caller overrides it via options. Defaults to `25`.
   */
  defaultLimit: number;

  /**
   * Minimum score a candidate must reach to appear in search results.
   * Defaults to `0`. Raise it to filter out weak matches.
   */
  minScore: number;

  /**
   * Maximum number of suggestion candidates gathered before ranking. Defaults
   * to `100`. Raise it for exhaustive suggestion over very large registries.
   */
  maxSuggestCandidates: number;
}

/* -------------------------------------------------------------------------- *
 * Search options
 * -------------------------------------------------------------------------- */

/**
 * Per-call knobs for a single search request.
 */
export interface SearchOptions {
  /**
   * Maximum number of results to return. Defaults to the config
   * `defaultLimit`.
   */
  limit?: number;

  /** Lower-bound score filter. Defaults to the config `minScore`. */
  minScore?: number;

  /**
   * Restrict results to tools that carry at least one of these tags.
   */
  tags?: string[];

  /**
   * Restrict results to tools that advertise at least one of these
   * capabilities.
   */
  capabilities?: string[];
}

/* -------------------------------------------------------------------------- *
 * Discovery options (constructor)
 * -------------------------------------------------------------------------- */

/**
 * Options accepted by the high-level `ToolDiscovery` constructor. Extends the
 * base config with an optional key-value store for persistent registries.
 */
export interface DiscoveryOptions extends DiscoveryConfig {
  /**
   * A persistent `Map`-compatible store to seed the registry with. Useful for
   * restoring state across process restarts.
   */
  store?: Map<string, ToolDefinition>;
}

/* -------------------------------------------------------------------------- *
 * Stats
 * -------------------------------------------------------------------------- */

/**
 * A point-in-time snapshot of the Discovery layer.
 */
export interface DiscoveryStats {
  /** Total number of registered tools. */
  toolCount: number;

  /** Total number of indexed tags across all tools. */
  tagCount: number;

  /** Total number of indexed capabilities across all tools. */
  capabilityCount: number;

  /** Total number of distinct tags known to the index. */
  distinctTags: number;

  /** Total number of distinct capabilities known to the index. */
  distinctCapabilities: number;

  /** Total number of indexed description tokens. */
  tokenCount: number;

  /** Timestamp (epoch ms) of the last index build. */
  lastIndexedAt: number;

  /** Whether the lifecycle manager is currently running. */
  running: boolean;
}

/* -------------------------------------------------------------------------- *
 * Guards & predicates
 * -------------------------------------------------------------------------- */

/**
 * Returns `true` when `value` looks like a {@link ToolParameter}: an object
 * with a string `name`, a string `type` and a boolean `required`.
 */
export function isToolParameter(value: unknown): value is ToolParameter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.required === 'boolean'
  );
}

/**
 * Returns `true` when `value` is a non-empty string array.
 */
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string')
  );
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link ToolDefinition}.
 *
 * The guard is deliberately strict about `name`, `description` and `handler`
 * (all must be present and correctly typed) and lenient about `parameters`,
 * `tags`, `capabilities`, `version` and `metadata`, normalising any missing
 * optional arrays to `[]`.
 *
 * @param value the value to test.
 * @param normalize when `true`, missing optional arrays are filled with `[]`
 *   via {@link normalizeToolDefinition}. Defaults to `false`.
 */
export function isToolDefinition(
  value: unknown,
  normalize = false,
): value is ToolDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const baseOk =
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    typeof record.description === 'string' &&
    typeof record.handler === 'function';

  if (!baseOk) {
    return false;
  }

  if (record.parameters !== undefined) {
    if (
      !Array.isArray(record.parameters) ||
      !record.parameters.every(isToolParameter)
    ) {
      return false;
    }
  }
  if (record.tags !== undefined && !isStringArray(record.tags)) {
    return false;
  }
  if (
    record.capabilities !== undefined &&
    !isStringArray(record.capabilities)
  ) {
    return false;
  }
  if (record.version !== undefined && typeof record.version !== 'string') {
    return false;
  }
  if (
    record.metadata !== undefined &&
    (typeof record.metadata !== 'object' || record.metadata === null)
  ) {
    return false;
  }

  if (normalize) {
    normalizeToolDefinition(record as unknown as ToolDefinition);
  }
  return true;
}

/**
 * Returns `true` when `value` is a plain object that only contains
 * `ToolDefinition` values. Used by lifecycle and persistence code that deals
 * with full registry snapshots.
 */
export function isToolDefinitionMap(
  value: unknown,
): value is Record<string, ToolDefinition> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) =>
    isToolDefinition(entry),
  );
}

/* -------------------------------------------------------------------------- *
 * Normalisation helpers
 * -------------------------------------------------------------------------- */

/**
 * Fills in empty defaults for the optional fields of a tool definition.
 *
 * Guarantees that `tags` and `capabilities` are always arrays, `metadata`
 * always an object, and `parameters` always an array. Mutates and returns the
 * same reference.
 */
export function normalizeToolDefinition(
  tool: ToolDefinition,
): ToolDefinition {
  if (!Array.isArray(tool.parameters)) {
    tool.parameters = [];
  }
  if (!Array.isArray(tool.tags)) {
    tool.tags = [];
  }
  if (!Array.isArray(tool.capabilities)) {
    tool.capabilities = [];
  }
  if (tool.metadata === undefined) {
    tool.metadata = {};
  }
  return tool;
}

/* -------------------------------------------------------------------------- *
 * Factories
 * -------------------------------------------------------------------------- */

/**
 * Creates a fully formed {@link ToolDefinition} from a minimal partial input.
 *
 * This is the recommended way to build tool definitions for the Discovery
 * layer because it guarantees the invariants that indexing code relies on
 * (`parameters`, `tags` and `capabilities` are always arrays).
 *
 * @example
 * const tool = createToolDefinition({
 *   name: 'http.get',
 *   description: 'Perform an HTTP GET request',
 *   handler: async () => {},
 *   parameters: [
 *     { name: 'url', type: 'string', required: true },
 *   ],
 *   tags: ['network', 'http'],
 *   capabilities: ['http.request'],
 * });
 *
 * @throws {TypeError} when the partial input does not satisfy the
 *   {@link isToolDefinition} guard.
 */
export function createToolDefinition(
  partial: ToolDefinition,
): ToolDefinition {
  if (!isToolDefinition(partial)) {
    const candidateName =
      typeof partial === 'object' && partial !== null
        ? String((partial as { name?: unknown }).name ?? '<unknown>')
        : '<unknown>';
    throw new TypeError(
      `createToolDefinition: invalid tool definition for "${candidateName}". ` +
        'A definition requires a string name, a string description and a ' +
        'callable handler.',
    );
  }
  return normalizeToolDefinition({ ...partial });
}

/**
 * Creates a {@link ToolSchema} view of a tool definition, omitting the
 * handler and metadata.
 */
export function toToolSchema(tool: ToolDefinition): ToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    parameters: (tool.parameters ?? []).slice(),
    tags: (tool.tags ?? []).slice(),
    capabilities: (tool.capabilities ?? []).slice(),
    version: tool.version,
  };
}

/* -------------------------------------------------------------------------- *
 * Config defaults
 * -------------------------------------------------------------------------- */

/**
 * Default configuration applied by every Discovery component unless the
 * caller overrides individual fields.
 */
export const DEFAULT_DISCOVERY_CONFIG: Readonly<DiscoveryConfig> = Object.freeze(
  {
    scoreDescriptions: true,
    caseSensitiveNames: false,
    autoReindex: true,
    reindexIntervalMs: 60_000,
    defaultLimit: 25,
    minScore: 0,
    maxSuggestCandidates: 100,
  } as DiscoveryConfig,
);

/**
 * Builds a concrete {@link DiscoveryConfig} by merging caller-provided values
 * over {@link DEFAULT_DISCOVERY_CONFIG}.
 */
export function resolveDiscoveryConfig(
  overrides?: Partial<DiscoveryConfig>,
): DiscoveryConfig {
  if (!overrides) {
    return { ...DEFAULT_DISCOVERY_CONFIG };
  }
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * Event payloads & emitter helpers
 * -------------------------------------------------------------------------- */

/**
 * Payload emitted on every `registered` / `unregistered` / `pruned` event.
 */
export interface DiscoveryEventPayload {
  /** The tool name affected by the event. */
  name: string;

  /** The current total number of registered tools. */
  toolCount: number;
}

/**
 * Structural type of the event emitter expected by lifecycle components.
 * Kept intentionally minimal so any EventEmitter-like object can be injected.
 */
export type DiscoveryEmitter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

/* -------------------------------------------------------------------------- *
 * Internal normalization utilities shared across the layer
 * -------------------------------------------------------------------------- */

/**
 * Lower-cases a token if the config says names are case-insensitive.
 * Mirrors the searcher's tokenization for consistent scoring.
 */
export function normalizeToken(
  value: string,
  caseSensitive = false,
): string {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

/**
 * Splits free text into lower-cased alphanumeric tokens, stripping
 * punctuation. Used to build the description token index.
 *
 * @param text the raw text to tokenize.
 * @param caseSensitive whether to preserve case. Defaults to `false`.
 */
export function tokenizeText(
  text: string,
  caseSensitive = false,
): string[] {
  const matches = text.match(/[a-zA-Z0-9]+(?:[-_.][a-zA-Z0-9]+)*/g) ?? [];
  if (caseSensitive) {
    return matches;
  }
  return matches.map((token) => token.toLocaleLowerCase());
}

/**
 * Deduplicates and orders a string array. Preserves insertion order of the
 * first occurrence.
 */
export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Counts the number of shared entries between two arrays, treating them as
 * multisets. Used by the retrieval scoring layer to reward tag and capability
 * overlap.
 */
export function overlapCount(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const entry of b) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  let shared = 0;
  for (const entry of a) {
    if ((counts.get(entry) ?? 0) > 0) {
      counts.set(entry, counts.get(entry) - 1);
      shared += 1;
    }
  }
  return shared;
}