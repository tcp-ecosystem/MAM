/**
 * MAM DSL Module Model Builders
 *
 * Normalized, framework-agnostic model for a parsed DSL module. This module
 * provides factory functions and a builder class that accumulate raw parsed
 * sections, list items, and edges into a canonical `DSLModule` shape.
 */

// ============================================================================
// DSL Module Model
// ============================================================================

/**
 * A single directed edge between two module nodes.
 */
export interface DSLEdgeModel {
  /** Source node name. */
  from: string;
  /** Target node name. */
  to: string;
  /** Optional condition under which the edge is traversed. */
  condition?: string;
}

/**
 * Normalized DSL module model.
 *
 * Sections hold scalar `key: value` pairs, `lists` hold repeated `- item`
 * entries grouped by section key, and `edges` hold `from -> to` connections.
 */
export interface DSLModule {
  /** Module name (trimmed, non-empty). */
  name: string;
  /** Optional module type (e.g. `agent`, `tool`, `workflow`). */
  type?: string;
  /** Scalar sections keyed by lower-cased section name. */
  sections: Record<string, string>;
  /** List sections keyed by lower-cased section name. */
  lists: Record<string, string[]>;
  /** Directed edges between nodes. */
  edges: DSLEdgeModel[];
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a new empty `DSLModule`.
 *
 * @param name - Module name.
 * @param type - Optional module type.
 * @returns An empty module model.
 */
export function createDSLModule(name: string, type?: string): DSLModule {
  return { name, type, sections: {}, lists: {}, edges: [] };
}

/**
 * Adds (or overwrites) a scalar section on the module.
 *
 * @param module - Module to mutate.
 * @param key - Section key.
 * @param value - Section value.
 * @returns The same module for chaining.
 */
export function addSection(module: DSLModule, key: string, value: string): DSLModule {
  module.sections[key] = value;
  return module;
}

/**
 * Appends an item to a list section on the module, creating it if needed.
 *
 * @param module - Module to mutate.
 * @param key - List section key.
 * @param item - Item to append.
 * @returns The same module for chaining.
 */
export function addListItem(module: DSLModule, key: string, item: string): DSLModule {
  if (!module.lists[key]) module.lists[key] = [];
  module.lists[key]!.push(item);
  return module;
}

/**
 * Appends a directed edge to the module.
 *
 * @param module - Module to mutate.
 * @param from - Source node name.
 * @param to - Target node name.
 * @param condition - Optional edge condition.
 * @returns The same module for chaining.
 */
export function addEdge(module: DSLModule, from: string, to: string, condition?: string): DSLModule {
  const edge: DSLEdgeModel =
    condition !== undefined && condition.trim().length > 0
      ? { from, to, condition: condition.trim() }
      : { from, to };
  module.edges.push(edge);
  return module;
}

// ============================================================================
// DSL Model Builder
// ============================================================================

/**
 * Fluent builder that accumulates a `DSLModule` from parsed sections and emits
 * a normalized module model on `build()`.
 */
export class DSLModelBuilder {
  private name: string;
  private type?: string;
  private sections: Record<string, string> = {};
  private lists: Record<string, string[]> = {};
  private edges: DSLEdgeModel[] = [];

  /**
   * Creates a new builder.
   *
   * @param name - Module name (defaults to `unnamed`).
   * @param type - Optional module type.
   */
  constructor(name: string = 'unnamed', type?: string) {
    this.name = name;
    this.type = type;
  }

  /**
   * Sets the module name.
   *
   * @param name - New module name.
   * @returns This builder for chaining.
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Sets the module type.
   *
   * @param type - New module type, or `undefined` to clear it.
   * @returns This builder for chaining.
   */
  setType(type: string | undefined): this {
    this.type = type;
    return this;
  }

  /**
   * Adds (or overwrites) a scalar section.
   *
   * @param key - Section key.
   * @param value - Section value.
   * @returns This builder for chaining.
   */
  addSection(key: string, value: string): this {
    this.sections[key] = value;
    return this;
  }

  /**
   * Appends an item to a list section, creating it if needed.
   *
   * @param key - List section key.
   * @param item - Item to append.
   * @returns This builder for chaining.
   */
  addListItem(key: string, item: string): this {
    if (!this.lists[key]) this.lists[key] = [];
    this.lists[key]!.push(item);
    return this;
  }

  /**
   * Appends a directed edge.
   *
   * @param from - Source node name.
   * @param to - Target node name.
   * @param condition - Optional edge condition.
   * @returns This builder for chaining.
   */
  addEdge(from: string, to: string, condition?: string): this {
    this.edges.push(
      condition !== undefined && condition.trim().length > 0
        ? { from, to, condition: condition.trim() }
        : { from, to }
    );
    return this;
  }

  /**
   * Emits a normalized, deep-copied `DSLModule` from the accumulated state.
   *
   * Normalization applies trimming to names and values, lower-cases section
   * keys and the module type, de-duplicates list items, and de-duplicates
   * edges (by source/target/condition).
   *
   * @returns A normalized module model.
   */
  build(): DSLModule {
    const sections: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.sections)) {
      const normalizedKey = key.trim().toLowerCase();
      const normalizedValue = value.trim();
      if (normalizedKey.length > 0 && normalizedValue.length > 0) {
        sections[normalizedKey] = normalizedValue;
      }
    }

    const lists: Record<string, string[]> = {};
    for (const [key, items] of Object.entries(this.lists)) {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey.length === 0) continue;
      const unique = Array.from(
        new Set(items.map(item => item.trim()).filter(item => item.length > 0))
      );
      if (unique.length > 0) lists[normalizedKey] = unique;
    }

    const edges: DSLEdgeModel[] = [];
    const seen = new Set<string>();
    for (const edge of this.edges) {
      const from = edge.from.trim();
      const to = edge.to.trim();
      if (from.length === 0 || to.length === 0) continue;
      const condition = edge.condition?.trim() || undefined;
      const signature = `${from}->${to}${condition !== undefined ? `[${condition}]` : ''}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      edges.push(condition !== undefined ? { from, to, condition } : { from, to });
    }

    return {
      name: this.name.trim() || 'unnamed',
      type: this.type ? this.type.trim().toLowerCase() : undefined,
      sections,
      lists,
      edges,
    };
  }

  /**
   * Resets the builder to its initial state.
   *
   * @param name - New module name (defaults to `unnamed`).
   * @param type - Optional new module type.
   */
  reset(name: string = 'unnamed', type?: string): void {
    this.name = name;
    this.type = type;
    this.sections = {};
    this.lists = {};
    this.edges = [];
  }
}