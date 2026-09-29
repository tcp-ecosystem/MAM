/**
 * @fileoverview
 * The in-memory registry that holds the knowledge graph's data.
 *
 * The {@link GraphStore} is the canonical owner of entities and relations:
 * it answers "do we know this entity?", "what does it connect to?", and "how
 * connected is it?" against adjacency structures that are maintained as edges
 * are added and removed, so `neighbors()` and `degree()` are O(degree) rather
 * than O(relations).
 *
 * Design notes:
 *
 *   - **Registries.**  Entities and relations live in flat `Map`s keyed by
 *     their ids.  The store enforces the cardinal invariant of the graph: a
 *     relation's `source` and `target` must name entities that actually exist.
 *     Adding a relation for a missing endpoint throws immediately, so dangling
 *     edges can never enter the store through the public API.
 *
 *   - **Maintained adjacency.**  Rather than scanning every relation on
 *     demand, the store keeps four inverted indexes in sync with every write:
 *     outgoing neighbor ids, incoming neighbor ids, outgoing relation ids,
 *     and incoming relation ids per entity.  This is what makes traversal
 *     (used by {@link GraphEngine.paths} and `shortestPath`) cheap on graphs
 *     with tens of thousands of edges.
 *
 *   - **Removal cascade.**  Removing an entity removes every relation that
 *     touches it, because a graph with an edge to a missing node is broken.
 *     {@link removeEntity} returns the number of relations that were removed
 *     as a side effect so callers (and the lifecycle layer) can account for
 *     them.
 *
 *   - **Durability.**  {@link GraphStore.toJSON} emits a flat, dependency-free
 *     snapshot and {@link GraphStore.fromJSON} restores it, re-validating
 *     every entity and relation and the store's endpoint invariant before
 *     anything is applied.
 *
 * @packageDocumentation
 */

import {
  type EntityType,
  type GraphEntity,
  type GraphRelation,
  type GraphStats,
  assertGraphEntity,
  assertGraphRelation,
  createGraphStats,
  isGraphEntity,
  isGraphRelation,
} from './types.js';

/**
 * The upper bound on entries accepted by `fromJSON`, guarding against
 * unbounded allocation when restoring untrusted snapshots.
 */
export const MAX_RESTORE_ENTITIES = 1_000_000;

/** The upper bound on relations accepted by `fromJSON`. */
export const MAX_RESTORE_RELATIONS = 2_000_000;

/**
 * A coarse shape snapshot of the store, returned by {@link GraphStore.size}.
 */
export interface GraphSize {
  /** Number of resident entities. */
  readonly entities: number;
  /** Number of resident relations. */
  readonly relations: number;
}

/**
 * One hop in a traversal: the neighbor entity together with the relation that
 * leads to it.
 */
export interface Neighbor {
  /** The relation that connects the queried entity to `entity`. */
  readonly relation: GraphRelation;
  /** The neighboring entity (the endpoint opposite the queried one). */
  readonly entity: GraphEntity;
}

/**
 * The direction of traversal for neighbor lookups.
 */
export type NeighborDirection = 'out' | 'in' | 'both';

/**
 * The in/out breakdown of an entity's connectivity, returned by
 * {@link GraphStore.degree}.
 */
export interface DegreeInfo {
  /** Number of outgoing relations (this entity is the source). */
  readonly out: number;
  /** Number of incoming relations (this entity is the target). */
  readonly in: number;
  /** `out + in`. */
  readonly total: number;
}

/**
 * Snapshot shape produced by {@link GraphStore.toJSON} and consumed by
 * {@link GraphStore.fromJSON}.  Deliberately flat and JSON-friendly so it can
 * round-trip through `JSON.stringify`/`JSON.parse`, a database column, or a
 * file.
 */
export interface GraphStoreSnapshot {
  /** Store version; used by `fromJSON` to reject incompatible snapshots. */
  readonly version: 1;
  /** All resident entities, in insertion order. */
  readonly entities: readonly GraphEntity[];
  /** All resident relations, in insertion order. */
  readonly relations: readonly GraphRelation[];
}

/**
 * The canonical in-memory registry of graph entities and relations.
 *
 * Instances are **not** thread-safe; callers in concurrent environments
 * (worker threads, multiple async pipelines sharing one store) should guard
 * access with a mutex or construct one store per worker.
 */
export class GraphStore {
  /** entity id -> entity.  Insertion order is preserved for listing. */
  private readonly entities = new Map<string, GraphEntity>();

  /** relation id -> relation. */
  private readonly relations = new Map<string, GraphRelation>();

  /** entity id -> set of neighbor ids reachable via an outgoing relation. */
  private readonly outEdges = new Map<string, Set<string>>();

  /** entity id -> set of neighbor ids that reach it via an incoming relation. */
  private readonly inEdges = new Map<string, Set<string>>();

  /** entity id -> set of relation ids where the entity is the source. */
  private readonly outRelationIds = new Map<string, Set<string>>();

  /** entity id -> set of relation ids where the entity is the target. */
  private readonly inRelationIds = new Map<string, Set<string>>();

  /**
   * Adds an entity to the store.
   *
   * The entity is validated before it touches any structure.  Inserting an id
   * that already exists is a no-op returning `false` — callers that want an
   * "upsert" should consult the index or {@link getEntity} first and merge
   * aliases explicitly.
   *
   * @returns `true` when the entity was newly inserted, `false` when an
   *   entity with the same id was already resident.
   */
  addEntity(entity: GraphEntity): boolean {
    assertGraphEntity(entity);
    if (this.entities.has(entity.id)) return false;
    this.entities.set(entity.id, entity);
    return true;
  }

  /**
   * Replaces the stored entity with the same id, preserving insertion order.
   *
   * Unlike {@link addEntity} this is unconditional: the incoming entity is
   * validated and becomes the canonical record for its id.  This is how the
   * retrieval layer merges aliases and bumps mention counts.
   *
   * @returns `true` when an entity was replaced, `false` when the id was not
   *   resident (the entity is still inserted).
   */
  upsertEntity(entity: GraphEntity): boolean {
    assertGraphEntity(entity);
    const existed = this.entities.has(entity.id);
    this.entities.set(entity.id, entity);
    return existed;
  }

  /**
   * Returns the entity with `id`, or `undefined` when absent.
   */
  getEntity(id: string): GraphEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * Returns whether an entity with `id` is resident.
   */
  hasEntity(id: string): boolean {
    return this.entities.has(id);
  }

  /**
   * Returns all resident entities, in insertion order.
   */
  listEntities(): GraphEntity[] {
    return [...this.entities.values()];
  }

  /**
   * Returns all resident entity ids, in insertion order.
   */
  entityIds(): string[] {
    return [...this.entities.keys()];
  }

  /**
   * Removes an entity and every relation that touches it.
   *
   * The cascade is required to preserve the store's endpoint invariant: a
   * relation whose source or target no longer exists would break
   * {@link neighbors} and traversal.  The touching relations are removed
   * first via {@link removeRelation}, so their adjacency bookkeeping is
   * cleaned up exactly once.
   *
   * @returns The number of relations removed as a side effect; `-1` when the
   *   entity itself was not resident.
   */
  removeEntity(id: string): number {
    if (!this.entities.has(id)) return -1;

    const touching = this.relationIdsFor(id);
    let relationsRemoved = 0;
    for (const relationId of touching) {
      if (this.removeRelation(relationId)) relationsRemoved += 1;
    }

    this.entities.delete(id);
    this.outEdges.delete(id);
    this.inEdges.delete(id);
    this.outRelationIds.delete(id);
    this.inRelationIds.delete(id);
    return relationsRemoved;
  }

  /**
   * Adds a relation to the store, enforcing the endpoint invariant.
   *
   * The relation is validated and its `source` and `target` must both name
   * resident entities; a missing endpoint throws a {@link RangeError} rather
   * than silently creating a dangling edge.  A relation id that already
   * exists is a no-op returning `false`.
   *
   * @returns `true` when the relation was newly inserted, `false` when a
   *   relation with the same id was already resident.
   */
  addRelation(relation: GraphRelation): boolean {
    assertGraphRelation(relation);
    if (this.relations.has(relation.id)) return false;
    if (!this.entities.has(relation.source)) {
      throw new RangeError(
        `Cannot add relation "${relation.id}": source entity "${relation.source}" does not exist`,
      );
    }
    if (!this.entities.has(relation.target)) {
      throw new RangeError(
        `Cannot add relation "${relation.id}": target entity "${relation.target}" does not exist`,
      );
    }

    this.relations.set(relation.id, relation);
    GraphStore.link(this.outEdges, relation.source, relation.target);
    GraphStore.link(this.inEdges, relation.target, relation.source);
    GraphStore.link(this.outRelationIds, relation.source, relation.id);
    GraphStore.link(this.inRelationIds, relation.target, relation.id);
    return true;
  }

  /**
   * Returns the relation with `id`, or `undefined` when absent.
   */
  getRelation(id: string): GraphRelation | undefined {
    return this.relations.get(id);
  }

  /**
   * Returns whether a relation with `id` is resident.
   */
  hasRelation(id: string): boolean {
    return this.relations.has(id);
  }

  /**
   * Returns all resident relations, in insertion order.
   */
  listRelations(): GraphRelation[] {
    return [...this.relations.values()];
  }

  /**
   * Returns all resident relation ids, in insertion order.
   */
  relationIds(): string[] {
    return [...this.relations.keys()];
  }

  /**
   * Removes a relation and its adjacency bookkeeping.
   *
   * @returns `true` when the relation was resident and has been removed.
   */
  removeRelation(id: string): boolean {
    const relation = this.relations.get(id);
    if (relation === undefined) return false;

    this.relations.delete(id);
    GraphStore.unlink(this.outEdges, relation.source, relation.target);
    GraphStore.unlink(this.inEdges, relation.target, relation.source);
    GraphStore.unlinkId(this.outRelationIds, relation.source, id);
    GraphStore.unlinkId(this.inRelationIds, relation.target, id);
    return true;
  }

  /**
   * Returns the neighbors of an entity: for each incident relation the other
   * endpoint, together with the relation itself.
   *
   * `direction` selects outgoing, incoming, or both kinds of edge.  The
   * result is ordered by relation insertion (outgoing first, then incoming
   * for `'both'`).  Returns an empty array when `entityId` is not resident.
   */
  neighbors(entityId: string, direction: NeighborDirection = 'both'): Neighbor[] {
    const result: Neighbor[] = [];
    const seenRelations = new Set<string>();

    const collect = (relationId: string, isOutgoing: boolean) => {
      const relation = this.relations.get(relationId);
      if (relation === undefined || seenRelations.has(relationId)) return;
      seenRelations.add(relationId);
      const neighborId = isOutgoing ? relation.target : relation.source;
      const entity = this.entities.get(neighborId);
      if (entity === undefined) return;
      result.push({ relation, entity });
    };

    if (direction === 'out' || direction === 'both') {
      for (const relationId of this.outRelationIds.get(entityId) ?? []) {
        collect(relationId, true);
      }
    }
    if (direction === 'in' || direction === 'both') {
      for (const relationId of this.inRelationIds.get(entityId) ?? []) {
        collect(relationId, false);
      }
    }
    return result;
  }

  /**
   * Returns the ids of every neighbor entity reachable in `direction`.
   *
   * Convenience for traversal code that only needs ids, avoiding the
   * allocation of full {@link Neighbor} records.  The returned set is
   * deduplicated (a pair connected by multiple relations counts once).
   */
  neighborIds(entityId: string, direction: NeighborDirection = 'both'): string[] {
    const result = new Set<string>();
    if (direction === 'out' || direction === 'both') {
      for (const neighborId of this.outEdges.get(entityId) ?? []) {
        result.add(neighborId);
      }
    }
    if (direction === 'in' || direction === 'both') {
      for (const neighborId of this.inEdges.get(entityId) ?? []) {
        result.add(neighborId);
      }
    }
    return [...result];
  }

  /**
   * Returns every relation that touches `entityId` (outgoing and incoming).
   * Empty when the entity is absent or isolated.
   */
  relationsFor(entityId: string): GraphRelation[] {
    const result: GraphRelation[] = [];
    for (const relationId of this.relationIdsFor(entityId)) {
      const relation = this.relations.get(relationId);
      if (relation !== undefined) result.push(relation);
    }
    return result;
  }

  /**
   * Returns the in/out degree breakdown for an entity.
   *
   * `out` counts relations where the entity is the source; `in` counts
   * relations where it is the target.  An unknown entity returns `{0, 0, 0}`.
   */
  degree(entityId: string): DegreeInfo {
    const out = this.outRelationIds.get(entityId)?.size ?? 0;
    const inCount = this.inRelationIds.get(entityId)?.size ?? 0;
    return { out, in: inCount, total: out + inCount };
  }

  /**
   * Returns the total (out + in) degree for an entity.  Convenience for
   * centrality computations that do not need the breakdown.
   */
  degreeTotal(entityId: string): number {
    return this.degree(entityId).total;
  }

  /**
   * Returns whether `entityId` is a leaf: resident and connected to at most
   * one other entity.  Leaves are the first targets of the lifecycle pruner.
   */
  isLeaf(entityId: string): boolean {
    if (!this.entities.has(entityId)) return false;
    return this.degreeTotal(entityId) <= 1;
  }

  /**
   * Removes every entity and relation, leaving the store pristine.  Counters
   * are not retained (the store keeps no lifetime counters by design; the
   * lifecycle layer does).
   */
  clear(): void {
    this.entities.clear();
    this.relations.clear();
    this.outEdges.clear();
    this.inEdges.clear();
    this.outRelationIds.clear();
    this.inRelationIds.clear();
  }

  /**
   * Returns the current number of entities and relations.
   */
  size(): GraphSize {
    return { entities: this.entities.size, relations: this.relations.size };
  }

  /**
   * Returns the number of resident entities.
   */
  get entityCount(): number {
    return this.entities.size;
  }

  /**
   * Returns the number of resident relations.
   */
  get relationCount(): number {
    return this.relations.size;
  }

  /**
   * Computes a {@link GraphStats} snapshot over the current graph shape.
   *
   * `averageDegree` is `2·relations / entities` (each edge contributes to two
   * endpoint degrees); `density` is the fraction of the `n·(n-1)/2` possible
   * directed pairs that are connected; `totalMentions` sums entity mention
   * counts.  Both metrics are `0` when there are no entities.
   */
  stats(): GraphStats {
    const n = this.entities.size;
    const m = this.relations.size;

    const byType: Record<EntityType, number> = {
      person: 0,
      org: 0,
      concept: 0,
      location: 0,
      product: 0,
      other: 0,
    };
    let totalMentions = 0;
    for (const entity of this.entities.values()) {
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
      totalMentions += entity.mentions ?? 0;
    }

    const averageDegree = n > 0 ? (2 * m) / n : 0;
    const density = n > 1 ? m / ((n * (n - 1)) / 2) : 0;

    return createGraphStats({
      entities: n,
      relations: m,
      byType,
      totalMentions,
      averageDegree,
      density,
      updatedAt: Date.now(),
    });
  }

  /**
   * Serializes the store to a flat, JSON-friendly snapshot.
   *
   * Entities are emitted in insertion order, then relations.  The snapshot is
   * self-contained — relation endpoints are entity ids and nothing refers
   * outside the payload — so it round-trips through any JSON transport.
   */
  toJSON(): GraphStoreSnapshot {
    return {
      version: 1,
      entities: this.listEntities(),
      relations: this.listRelations(),
    };
  }

  /**
   * Restores the store from a snapshot, replacing all current contents.
   *
   * The snapshot is fully validated before anything is applied: the version
   * must match, counts must be within {@link MAX_RESTORE_ENTITIES} /
   * {@link MAX_RESTORE_RELATIONS}, every entity and relation must pass its
   * runtime guard, relation ids must be unique, and every relation's
   * endpoints must name a restored entity.  On failure nothing is changed and
   * a {@link TypeError} is thrown.
   */
  fromJSON(snapshot: GraphStoreSnapshot): void {
    if (!isRecordLike(snapshot) || snapshot.version !== 1) {
      throw new TypeError(`Unsupported GraphStore snapshot version ${(snapshot as { version?: unknown }).version}`);
    }
    if (!Array.isArray(snapshot.entities) || !Array.isArray(snapshot.relations)) {
      throw new TypeError('GraphStore snapshot must contain entities and relations arrays');
    }
    if (snapshot.entities.length > MAX_RESTORE_ENTITIES) {
      throw new RangeError(
        `Snapshot has ${snapshot.entities.length} entities; refusing to restore more than ${MAX_RESTORE_ENTITIES}`,
      );
    }
    if (snapshot.relations.length > MAX_RESTORE_RELATIONS) {
      throw new RangeError(
        `Snapshot has ${snapshot.relations.length} relations; refusing to restore more than ${MAX_RESTORE_RELATIONS}`,
      );
    }

    const nextEntities = new Map<string, GraphEntity>();
    for (const entity of snapshot.entities) {
      if (!isGraphEntity(entity)) {
        throw new TypeError('Snapshot contains an entity that is not a valid GraphEntity');
      }
      if (nextEntities.has(entity.id)) {
        throw new TypeError(`Snapshot contains duplicate entity id "${entity.id}"`);
      }
      nextEntities.set(entity.id, entity);
    }

    const nextRelations = new Map<string, GraphRelation>();
    for (const relation of snapshot.relations) {
      if (!isGraphRelation(relation)) {
        throw new TypeError('Snapshot contains a relation that is not a valid GraphRelation');
      }
      if (nextRelations.has(relation.id)) {
        throw new TypeError(`Snapshot contains duplicate relation id "${relation.id}"`);
      }
      if (!nextEntities.has(relation.source) || !nextEntities.has(relation.target)) {
        throw new TypeError(
          `Snapshot relation "${relation.id}" references a missing entity endpoint`,
        );
      }
      nextRelations.set(relation.id, relation);
    }

    this.clear();
    for (const entity of nextEntities.values()) this.entities.set(entity.id, entity);
    for (const relation of nextRelations.values()) {
      this.relations.set(relation.id, relation);
      GraphStore.link(this.outEdges, relation.source, relation.target);
      GraphStore.link(this.inEdges, relation.target, relation.source);
      GraphStore.link(this.outRelationIds, relation.source, relation.id);
      GraphStore.link(this.inRelationIds, relation.target, relation.id);
    }
  }

  /**
   * Returns the ids of every relation that touches `entityId`.
   */
  private relationIdsFor(entityId: string): string[] {
    const result = new Set<string>();
    for (const relationId of this.outRelationIds.get(entityId) ?? []) result.add(relationId);
    for (const relationId of this.inRelationIds.get(entityId) ?? []) result.add(relationId);
    return [...result];
  }

  /**
   * Adds `value` to the set under `key` in `map`, creating the set if needed.
   */
  private static link(map: Map<string, Set<string>>, key: string, value: string): void {
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      map.set(key, bucket);
    }
    bucket.add(value);
  }

  /**
   * Removes `value` from the set under `key` in `map`, dropping the set when
   * it becomes empty.
   */
  private static unlink(map: Map<string, Set<string>>, key: string, value: string): void {
    const bucket = map.get(key);
    if (bucket === undefined) return;
    bucket.delete(value);
    if (bucket.size === 0) map.delete(key);
  }

  /**
   * Removes `id` from the set under `key`, dropping the set when it becomes
   * empty.
   */
  private static unlinkId(map: Map<string, Set<string>>, key: string, id: string): void {
    const bucket = map.get(key);
    if (bucket === undefined) return;
    bucket.delete(id);
    if (bucket.size === 0) map.delete(key);
  }
}

/**
 * Returns `true` when `value` is a non-null, non-array object.  Local helper
 * used by `fromJSON` so the store does not depend on the types module's guard
 * set for snapshot shape checks.
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}