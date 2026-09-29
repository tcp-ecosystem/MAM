/**
 * AssemblyIndex — a denormalised lookup index over {@link ContextPart}s for
 * the Context Assembly layer of the standalone MAM Context Engine.
 *
 * The {@link ContextAssemblyStore} is a flat, insertion-ordered registry: it
 * answers "what is this id?" in O(1) but answers "all tool parts", "all parts
 * from this source" or "all parts tagged X" by scanning every entry. The
 * {@link AssemblyIndex} turns those scans into O(1) lookups by maintaining
 * three secondary maps — by role, by source and by tag — that point back at
 * the canonical parts.
 *
 * - `indexPart` / `removePart` / `reindex` keep the index in step with a
 *   store, so callers can `add` to the store and mirror the change into the
 *   index in the same breath.
 * - `findByRole`, `findBySource` and `findByTags` are the three primary
 *   entry points; `query` intersects them for composite lookups ("tool parts
 *   tagged `safety` from source `manual`").
 * - `rebuild` re-derives the whole index from a fresh part list — used when a
 *   store is loaded from a snapshot or restored from disk.
 * - `stats`, `countByRole`, `sources` and `tags` expose the index's shape for
 *   diagnostics, cache sizing and logging.
 *
 * The index keeps its own copy of each indexed part (keyed by id), so it is
 * fully self-contained and does not need a live reference to the store to
 * answer lookups. For memory-sensitive deployments the copies are shallow
 * (the index shares the same part objects the store handed it), so the cost is
 * the three secondary maps plus the id keys, not duplicated content.
 *
 * @packageDocumentation
 * @module context-assembly/index
 */

import { isContextRole, normalizeRole } from './types.js';
import type {
  ContextPart,
  ContextRole,
  PartId,
  TagMode,
} from './types.js';

/**
 * Aggregate, on-demand statistics describing the index's current shape.
 */
export interface IndexStats {
  /**
   * Number of parts currently indexed.
   */
  readonly parts: number;

  /**
   * Number of distinct roles represented in the index.
   */
  readonly roles: number;

  /**
   * Number of distinct source labels represented in the index.
   */
  readonly sources: number;

  /**
   * Number of distinct tags represented in the index.
   */
  readonly tags: number;

  /**
   * Total number of role→part membership edges (always equals `parts`).
   */
  readonly roleEntries: number;

  /**
   * Total number of source→part membership edges.
   */
  readonly sourceEntries: number;

  /**
   * Total number of tag→part membership edges (parts without tags contribute
   * none).
   */
  readonly tagEntries: number;
}

/**
 * A composite lookup description for {@link AssemblyIndex.query}.
 *
 * Every field is optional; present fields combine with an implicit AND.
 */
export interface IndexQuery {
  /**
   * Keep only parts whose `role` is one of these values.
   */
  readonly roles?: readonly ContextRole[];

  /**
   * Keep only parts whose `source` is one of these values.
   */
  readonly sources?: readonly string[];

  /**
   * Keep only parts carrying the given tags (see {@link IndexQuery.tagMode}).
   */
  readonly tags?: readonly string[];

  /**
   * `'all'` (default) requires every tag; `'any'` accepts a single match.
   */
  readonly tagMode?: TagMode;
}

/**
 * The canonical denormalised lookup index over context parts.
 *
 * Maintains three secondary maps — by role, by source and by tag — alongside a
 * primary id→part map. Each secondary map points to a `Set<PartId>` so
 * membership tests and lookups are O(1); results are materialised on demand.
 *
 * @example
 * ```ts
 * const index = new AssemblyIndex();
 * index.indexPart({ id: 't-1', role: 'tool', content: 'ok', source: 'calc', tags: ['math'] });
 * index.findByRole('tool').length;      // 1
 * index.findByTags(['math']).length;    // 1
 * index.query({ roles: ['tool'], sources: ['calc'] }).length; // 1
 * ```
 */
export class AssemblyIndex {
  /**
   * Primary map: partId → part.
   */
  private readonly partsById = new Map<PartId, ContextPart>();

  /**
   * Secondary map: role → set of part ids carrying that role.
   */
  private readonly byRole = new Map<ContextRole, Set<PartId>>();

  /**
   * Secondary map: source label → set of part ids carrying that source.
   */
  private readonly bySource = new Map<string, Set<PartId>>();

  /**
   * Secondary map: tag → set of part ids carrying that tag.
   */
  private readonly byTag = new Map<string, Set<PartId>>();

  /**
   * Index a single part.
   *
   * Inserts (or re-inserts) the part into the primary map and wires every
   * secondary map edge — role, each source, each tag. Re-indexing an existing
   * id first removes its stale edges, so repeated calls are idempotent.
   *
   * @param part - the part to index
   * @returns the indexed part
   */
  indexPart(part: ContextPart): ContextPart {
    const existing = this.partsById.get(part.id);
    if (existing) {
      this.removePart(part.id);
    }
    this.partsById.set(part.id, part);
    this.addToSet(this.byRole, part.role, part.id);
    if (part.source !== undefined) {
      this.addToSet(this.bySource, part.source, part.id);
    }
    for (const tag of part.tags ?? []) {
      this.addToSet(this.byTag, tag, part.id);
    }
    return part;
  }

  /**
   * Remove a part and all of its index edges.
   *
   * @param partId - the id of the part to remove
   * @returns `true` when a part was removed, `false` when it was not indexed
   */
  removePart(partId: PartId): boolean {
    const part = this.partsById.get(partId);
    if (!part) {
      return false;
    }
    this.partsById.delete(partId);
    this.removeFromSet(this.byRole, part.role, partId);
    if (part.source !== undefined) {
      this.removeFromSet(this.bySource, part.source, partId);
    }
    for (const tag of part.tags ?? []) {
      this.removeFromSet(this.byTag, tag, partId);
    }
    return true;
  }

  /**
   * Re-index an already-indexed part after it changed.
   *
   * Equivalent to `removePart(id)` followed by `indexPart(part)`; keeps the
   * index consistent when a part's role, source or tags are updated in place.
   *
   * @param part - the updated part
   * @returns the re-indexed part
   */
  reindex(part: ContextPart): ContextPart {
    return this.indexPart(part);
  }

  /**
   * Test whether a part id is indexed.
   *
   * @param partId - the id to test
   * @returns `true` when the id is present
   */
  has(partId: PartId): boolean {
    return this.partsById.has(partId);
  }

  /**
   * Fetch the indexed part for a given id.
   *
   * @param partId - the id to look up
   * @returns the indexed part, or `undefined` when absent
   */
  get(partId: PartId): ContextPart | undefined {
    return this.partsById.get(partId);
  }

  /**
   * Return all indexed part ids, in insertion order.
   *
   * @returns a fresh array of ids
   */
  keys(): PartId[] {
    return [...this.partsById.keys()];
  }

  /**
   * Return all indexed parts, in insertion order, as a fresh array.
   *
   * @returns a shallow copy of the indexed parts
   */
  all(): ContextPart[] {
    return [...this.partsById.values()];
  }

  /**
   * Number of parts currently indexed.
   */
  get size(): number {
    return this.partsById.size;
  }

  /**
   * Fetch every indexed part with a given role, in insertion order.
   *
   * @param role - the role to match
   * @returns matching parts (possibly empty)
   */
  findByRole(role: ContextRole): ContextPart[] {
    return this.materialize(this.byRole.get(role));
  }

  /**
   * Fetch every indexed part with any of the given roles, in insertion order.
   *
   * @param roles - the roles to match
   * @returns matching parts, deduplicated by id
   */
  findByRoles(roles: readonly ContextRole[]): ContextPart[] {
    const ids = new Set<PartId>();
    for (const role of roles) {
      const bucket = this.byRole.get(role);
      if (bucket) {
        for (const id of bucket) {
          ids.add(id);
        }
      }
    }
    return this.materialize(ids);
  }

  /**
   * Fetch every indexed part with a given source label, in insertion order.
   *
   * @param source - the source label to match
   * @returns matching parts (possibly empty)
   */
  findBySource(source: string): ContextPart[] {
    return this.materialize(this.bySource.get(source));
  }

  /**
   * Fetch every indexed part carrying the given tags.
   *
   * @param tags - the tags to match
   * @param mode - `'all'` (default) requires every tag; `'any'` accepts one
   * @returns matching parts, in insertion order
   */
  findByTags(tags: readonly string[], mode: TagMode = 'all'): ContextPart[] {
    if (tags.length === 0) {
      return [];
    }
    if (mode === 'all') {
      let ids: Set<PartId> | undefined;
      for (const tag of tags) {
        const bucket = this.byTag.get(tag);
        if (!bucket) {
          return [];
        }
        ids = ids ? this.intersect(ids, bucket) : new Set(bucket);
        if (ids.size === 0) {
          return [];
        }
      }
      return this.materialize(ids);
    }
    const ids = new Set<PartId>();
    for (const tag of tags) {
      const bucket = this.byTag.get(tag);
      if (bucket) {
        for (const id of bucket) {
          ids.add(id);
        }
      }
    }
    return this.materialize(ids);
  }

  /**
   * Composite lookup that intersects role, source and tag constraints.
   *
   * All present constraints combine with an implicit AND; tags themselves
   * combine according to {@link IndexQuery.tagMode}. This is the workhorse
   * entry point used by higher layers that need "tool parts tagged `safety`
   * from source `manual`" in one call.
   *
   * @param query - the composite lookup description
   * @returns matching parts, in insertion order
   */
  query(query: IndexQuery = {}): ContextPart[] {
    let ids: Set<PartId> | undefined;

    if (query.roles && query.roles.length > 0) {
      ids = new Set<PartId>();
      for (const role of query.roles) {
        const bucket = this.byRole.get(role);
        if (bucket) {
          for (const id of bucket) {
            ids.add(id);
          }
        }
      }
      if (ids.size === 0) {
        return [];
      }
    }

    if (query.sources && query.sources.length > 0) {
      const sources = new Set<PartId>();
      for (const source of query.sources) {
        const bucket = this.bySource.get(source);
        if (bucket) {
          for (const id of bucket) {
            sources.add(id);
          }
        }
      }
      ids = ids ? this.intersect(ids, sources) : sources;
      if (ids.size === 0) {
        return [];
      }
    }

    if (query.tags && query.tags.length > 0) {
      const tagIds = new Set<PartId>();
      if (query.tagMode === 'all') {
        let acc: Set<PartId> | undefined;
        for (const tag of query.tags) {
          const bucket = this.byTag.get(tag);
          if (!bucket) {
            return [];
          }
          acc = acc ? this.intersect(acc, bucket) : new Set(bucket);
          if (acc.size === 0) {
            return [];
          }
        }
        for (const id of acc) {
          tagIds.add(id);
        }
      } else {
        for (const tag of query.tags) {
          const bucket = this.byTag.get(tag);
          if (bucket) {
            for (const id of bucket) {
              tagIds.add(id);
            }
          }
        }
      }
      ids = ids ? this.intersect(ids, tagIds) : tagIds;
    }

    return ids ? this.materialize(ids) : this.all();
  }

  /**
   * Rebuild the entire index from a fresh collection of parts.
   *
   * Clears every map and re-derives all edges from the given parts. Used when
   * a store is loaded from a snapshot, restored from disk or hot-reloaded.
   *
   * @param parts - the parts to index
   * @returns the number of parts indexed
   */
  rebuild(parts: Iterable<ContextPart>): number {
    this.clear();
    let count = 0;
    for (const part of parts) {
      this.indexPart(part);
      count += 1;
    }
    return count;
  }

  /**
   * Remove every part and every secondary-map edge from the index.
   */
  clear(): void {
    this.partsById.clear();
    this.byRole.clear();
    this.bySource.clear();
    this.byTag.clear();
  }

  /**
   * Compute on-demand statistics about the index's current shape.
   *
   * @returns an {@link IndexStats} summary
   */
  stats(): IndexStats {
    let sourceEntries = 0;
    let tagEntries = 0;
    for (const bucket of this.bySource.values()) {
      sourceEntries += bucket.size;
    }
    for (const bucket of this.byTag.values()) {
      tagEntries += bucket.size;
    }
    return {
      parts: this.partsById.size,
      roles: this.byRole.size,
      sources: this.bySource.size,
      tags: this.byTag.size,
      roleEntries: this.partsById.size,
      sourceEntries,
      tagEntries,
    };
  }

  /**
   * Count indexed parts per role, as a record of role → count.
   *
   * @returns a record of role → count (roles with zero parts are absent)
   */
  countByRole(): Partial<Record<ContextRole, number>> {
    const counts: Partial<Record<ContextRole, number>> = {};
    for (const [role, bucket] of this.byRole) {
      counts[role] = bucket.size;
    }
    return counts;
  }

  /**
   * All source labels represented in the index.
   *
   * @returns a fresh, sorted array of source labels
   */
  sources(): string[] {
    return [...this.bySource.keys()].sort();
  }

  /**
   * All tags represented in the index.
   *
   * @returns a fresh, sorted array of tags
   */
  tags(): string[] {
    return [...this.byTag.keys()].sort();
  }

  /**
   * Human-readable summary of the index's shape, for logging.
   *
   * @returns e.g. `"AssemblyIndex(parts=12, roles=4, tags=9)"`
   */
  inspect(): string {
    const stats = this.stats();
    return `AssemblyIndex(parts=${stats.parts}, roles=${stats.roles}, tags=${stats.tags})`;
  }

  /**
   * Add a part id to a bucket, creating the bucket when needed.
   *
   * @param map - the secondary map to write into
   * @param key - the bucket key
   * @param partId - the part id to add
   */
  private addToSet<K>(map: Map<K, Set<PartId>>, key: K, partId: PartId): void {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set<PartId>();
      map.set(key, bucket);
    }
    bucket.add(partId);
  }

  /**
   * Remove a part id from a bucket, pruning empty buckets.
   *
   * @param map - the secondary map to write into
   * @param key - the bucket key
   * @param partId - the part id to remove
   */
  private removeFromSet<K>(map: Map<K, Set<PartId>>, key: K, partId: PartId): void {
    const bucket = map.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(partId);
    if (bucket.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Intersect two id sets.
   *
   * @param a - the first set
   * @param b - the second set
   * @returns a new set containing ids present in both
   */
  private intersect(a: Set<PartId>, b: Set<PartId>): Set<PartId> {
    const out = new Set<PartId>();
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const id of small) {
      if (large.has(id)) {
        out.add(id);
      }
    }
    return out;
  }

  /**
   * Materialise an id bucket into a part array in insertion order.
   *
   * @param ids - the id bucket (or `undefined` for an empty result)
   * @returns the matching parts in insertion order
   */
  private materialize(ids: Set<PartId> | undefined): ContextPart[] {
    if (!ids || ids.size === 0) {
      return [];
    }
    const out: ContextPart[] = [];
    for (const [partId, part] of this.partsById) {
      if (ids.has(partId)) {
        out.push(part);
      }
    }
    return out;
  }
}

/**
 * Structural guard for a raw role value, re-exported for callers that want to
 * validate inputs before indexing.
 *
 * @param value - the value to test
 * @returns `true` when the value is a known role
 */
export function isValidIndexedRole(value: unknown): value is ContextRole {
  return isContextRole(value);
}

/**
 * Normalise a raw role for index queries.
 *
 * @param role - the raw role value
 * @returns a known role (falls back to `'user'` for unknown values)
 */
export function normalizeIndexRole(role: unknown): ContextRole {
  return normalizeRole(role);
}