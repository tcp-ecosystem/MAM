/**
 * index.ts
 *
 * The `ToolIndex` — an in-memory inverted index over the Discovery registry.
 *
 * While `store.ts` keeps the authoritative, name-keyed tool definitions, this
 * module maintains the derived structures that make search fast:
 *
 *   - `byName`          — name → tool definition (mirrors the registry).
 *   - `byToken`         — description token → set of tool names. Tokens are
 *                         lower-cased alphanumeric runs extracted by
 *                         `tokenizeText`.
 *   - `byTag`           — tag → set of tool names (faceted navigation).
 *   - `byCapability`    — capability → set of tool names.
 *   - `byNamePrefix`    — prefix → set of tool names, used for prefix
 *                         autocompletion. Prefixes are built from the first
 *                         characters of every name up to a configurable
 *                         depth.
 *
 * The index is *eventually consistent* with the registry: callers push tools
 * in via `indexTool` and remove them via `removeTool`, or ask the lifecycle
 * layer to rebuild from scratch with `rebuild`. Duplicate indexes for the
 * same tool are idempotent — re-indexing a name replaces, never duplicates.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type DiscoveryConfig,
  type DiscoveryStats,
  type ToolDefinition,
  DEFAULT_DISCOVERY_CONFIG,
  tokenizeText,
  uniqueStrings,
} from './types.js';

/**
 * Maximum number of prefix lengths kept per tool name. Names longer than this
 * still index a prefix of this many characters, which is plenty for
 * autocomplete use cases and keeps memory bounded.
 */
const MAX_PREFIX_DEPTH = 24;

/**
 * An inverted index over a collection of MAM tools.
 *
 * @example
 * const index = new ToolIndex();
 * index.indexTool(tool);
 * index.findByTag('network');         // Set { 'http.get' }
 * index.findByCapability('http.request'); // Set { 'http.get' }
 * index.findByNamePrefix('http');     // Set { 'http.get' }
 * index.rebuild([toolA, toolB]);      // full rebuild from a list
 */
export class ToolIndex {
  /** Name → normalised tool definition. */
  private readonly byName = new Map<string, ToolDefinition>();

  /** Description token → tool names containing that token. */
  private readonly byToken = new Map<string, Set<string>>();

  /** Tag → tool names advertising that tag. */
  private readonly byTag = new Map<string, Set<string>>();

  /** Capability → tool names advertising that capability. */
  private readonly byCapability = new Map<string, Set<string>>();

  /** Name prefix → tool names starting with that prefix. */
  private readonly byNamePrefix = new Map<string, Set<string>>();

  /** Config governing tokenization and prefix building. */
  private readonly config: DiscoveryConfig;

  /** Epoch ms of the most recent rebuild or significant mutation. */
  private lastIndexedAt = 0;

  /**
   * Creates an empty index.
   *
   * @param config configuration overrides; defaults to
   *   {@link DEFAULT_DISCOVERY_CONFIG}. `caseSensitiveNames` affects prefix
   *   matching only — description tokens are always lower-cased so scoring
   *   behaves predictably regardless of input casing.
   */
  constructor(config: Partial<DiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  /**
   * Indexes a tool. If the tool was already indexed under the same name, the
   * old entry is fully removed first so that stale tags / capabilities /
   * tokens never linger.
   *
   * @param tool the tool to index.
   * @returns `this` for chaining.
   */
  indexTool(tool: ToolDefinition): this {
    if (typeof tool?.name !== 'string' || tool.name.length === 0) {
      throw new TypeError(
        'ToolIndex.indexTool: a tool must have a non-empty string name.',
      );
    }
    if (this.byName.has(tool.name)) {
      this.removeTool(tool.name);
    }

    this.byName.set(tool.name, tool);

    const tokens = uniqueStrings(tokenizeText(tool.description));
    for (const token of tokens) {
      this.addToSet(this.byToken, token, tool.name);
    }

    for (const tag of tool.tags ?? []) {
      this.addToSet(this.byTag, tag, tool.name);
    }

    for (const capability of tool.capabilities ?? []) {
      this.addToSet(this.byCapability, capability, tool.name);
    }

    this.indexPrefixes(tool.name);
    this.lastIndexedAt = Date.now();
    return this;
  }

  /**
   * Removes a tool and every index entry that references it.
   *
   * @param name the tool name to drop from the index.
   * @returns `true` when the tool was indexed and removed, `false` when it
   *   was unknown.
   */
  removeTool(name: string): boolean {
    const tool = this.byName.get(name);
    if (tool === undefined) {
      return false;
    }

    this.byName.delete(name);

    const tokens = uniqueStrings(tokenizeText(tool.description));
    for (const token of tokens) {
      this.removeFromSet(this.byToken, token, name);
    }
    for (const tag of tool.tags ?? []) {
      this.removeFromSet(this.byTag, tag, name);
    }
    for (const capability of tool.capabilities ?? []) {
      this.removeFromSet(this.byCapability, capability, name);
    }

    this.removePrefixes(name);
    this.lastIndexedAt = Date.now();
    return true;
  }

  /**
   * Rebuilds the entire index from a list of tool definitions. This is the
   * canonical reconciliation path: it guarantees the index matches the
   * registry exactly, which matters after bulk unregister operations.
   *
   * @param tools the tools to index.
   * @returns `this` for chaining.
   */
  rebuild(tools: Iterable<ToolDefinition>): this {
    this.clear();
    for (const tool of tools) {
      this.indexTool(tool);
    }
    this.lastIndexedAt = Date.now();
    return this;
  }

  /**
   * Removes every entry from the index, leaving it empty but reusable.
   */
  clear(): void {
    this.byName.clear();
    this.byToken.clear();
    this.byTag.clear();
    this.byCapability.clear();
    this.byNamePrefix.clear();
    this.lastIndexedAt = 0;
  }

  /* ------------------------------------------------------------------ *
   * Lookups
   * ------------------------------------------------------------------ */

  /**
   * Returns the indexed tool definition for `name`, or `undefined`.
   */
  get(name: string): ToolDefinition | undefined {
    return this.byName.get(name);
  }

  /**
   * Returns `true` when `name` is present in the index.
   */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /**
   * Returns the number of indexed tools.
   */
  get size(): number {
    return this.byName.size;
  }

  /**
   * Returns every indexed tool definition as an array, in insertion order.
   */
  all(): ToolDefinition[] {
    return Array.from(this.byName.values());
  }

  /**
   * Returns every indexed tool name as an array.
   */
  names(): string[] {
    return Array.from(this.byName.keys());
  }

  /**
   * Returns the names of all tools that advertise the given capability.
   * Exact string match. Empty result set is returned when the capability is
   * unknown.
   */
  findByCapability(capability: string): Set<string> {
    return new Set(this.byCapability.get(capability) ?? []);
  }

  /**
   * Returns the names of all tools that carry the given tag. Exact string
   * match.
   */
  findByTag(tag: string): Set<string> {
    return new Set(this.byTag.get(tag) ?? []);
  }

  /**
   * Returns the names of all tools whose name starts with `prefix`.
   *
   * Matching honours `caseSensitiveNames` from the config: when disabled
   * (default) both the query and indexed prefixes are compared in lower case,
   * so `findByNamePrefix('HTTP')` matches `http.get`.
   */
  findByNamePrefix(prefix: string): Set<string> {
    if (prefix.length === 0) {
      return new Set(this.byName.keys());
    }
    const key = this.config.caseSensitiveNames
      ? prefix
      : prefix.toLocaleLowerCase();
    return new Set(this.byNamePrefix.get(key) ?? []);
  }

  /**
   * Returns the names of all tools whose description contains every token of
   * `text` (AND semantics). Useful for building a coarse candidate set before
   * scoring.
   */
  findByDescriptionTokens(text: string): Set<string> {
    const tokens = uniqueStrings(tokenizeText(text));
    if (tokens.length === 0) {
      return new Set();
    }
    const matches = tokens.map(
      (token) => this.byToken.get(token) ?? new Set<string>(),
    );
    const intersection = new Set<string>(matches[0]);
    for (let i = 1; i < matches.length; i += 1) {
      for (const name of intersection) {
        if (!matches[i].has(name)) {
          intersection.delete(name);
        }
      }
    }
    return intersection;
  }

  /**
   * Returns the names of all tools that match *any* of the given tags or
   * capabilities (OR semantics), deduplicated. Used by the searcher for
   * faceted filtering.
   */
  findByAny(tags: string[], capabilities: string[]): Set<string> {
    const result = new Set<string>();
    for (const tag of tags) {
      for (const name of this.byTag.get(tag) ?? []) {
        result.add(name);
      }
    }
    for (const capability of capabilities) {
      for (const name of this.byCapability.get(capability) ?? []) {
        result.add(name);
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  /**
   * Returns every distinct tag known to the index, sorted for determinism.
   */
  tags(): string[] {
    return Array.from(this.byTag.keys()).sort();
  }

  /**
   * Returns every distinct capability known to the index, sorted.
   */
  capabilities(): string[] {
    return Array.from(this.byCapability.keys()).sort();
  }

  /**
   * Returns the distinct description tokens currently indexed, sorted.
   * Primarily useful for diagnostics and tests.
   */
  tokens(): string[] {
    return Array.from(this.byToken.keys()).sort();
  }

  /**
   * Computes an {@link DiscoveryStats} snapshot for the index. The registry
   * fields (`toolCount`, `tagCount`, etc.) are derived purely from the index
   * contents, so calling this directly on a stale index reflects the index,
   * not the registry — prefer lifecycle-managed stats for authoritative
   * numbers.
   */
  stats(): DiscoveryStats {
    let tagCount = 0;
    let capabilityCount = 0;
    for (const tool of this.byName.values()) {
      tagCount += tool.tags?.length ?? 0;
      capabilityCount += tool.capabilities?.length ?? 0;
    }
    return {
      toolCount: this.byName.size,
      tagCount,
      capabilityCount,
      distinctTags: this.byTag.size,
      distinctCapabilities: this.byCapability.size,
      tokenCount: this.byToken.size,
      lastIndexedAt: this.lastIndexedAt,
      running: false,
    };
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /** Adds `name` to the set behind `key` in `map`, creating it on demand. */
  private addToSet(
    map: Map<string, Set<string>>,
    key: string,
    name: string,
  ): void {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set();
      map.set(key, set);
    }
    set.add(name);
  }

  /** Removes `name` from the set behind `key`; drops empty sets. */
  private removeFromSet(
    map: Map<string, Set<string>>,
    key: string,
    name: string,
  ): void {
    const set = map.get(key);
    if (set === undefined) {
      return;
    }
    set.delete(name);
    if (set.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Indexes every non-empty prefix of `name` up to `MAX_PREFIX_DEPTH`
   * characters, honouring case sensitivity from the config. Prefixes shorter
   * than two characters are skipped to avoid a noisy, low-value prefix map.
   */
  private indexPrefixes(name: string): void {
    const working = this.config.caseSensitiveNames ? name : name.toLowerCase();
    const depth = Math.min(working.length, MAX_PREFIX_DEPTH);
    for (let length = 2; length <= depth; length += 1) {
      const prefix = working.slice(0, length);
      this.addToSet(this.byNamePrefix, prefix, name);
    }
  }

  /** Removes every indexed prefix of `name`. */
  private removePrefixes(name: string): void {
    const working = this.config.caseSensitiveNames ? name : name.toLowerCase();
    const depth = Math.min(working.length, MAX_PREFIX_DEPTH);
    for (let length = 2; length <= depth; length += 1) {
      const prefix = working.slice(0, length);
      this.removeFromSet(this.byNamePrefix, prefix, name);
    }
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param tools optional tools to index immediately.
 * @param config configuration overrides.
 * @returns a new {@link ToolIndex}.
 */
export function createIndex(
  tools: Iterable<ToolDefinition> = [],
  config: Partial<DiscoveryConfig> = {},
): ToolIndex {
  const index = new ToolIndex(config);
  if (Array.isArray(tools)) {
    index.rebuild(tools);
  } else {
    for (const tool of tools) {
      index.indexTool(tool);
    }
  }
  return index;
}