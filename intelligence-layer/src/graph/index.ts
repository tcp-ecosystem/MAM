/**
 * @fileoverview
 * In-memory secondary index over graph entities and relations.
 *
 * The {@link GraphStore} is great at answering "what does this id connect
 * to?", but it is deliberately id-blind about *names*: it cannot answer
 * "which entity is called 'Acme'?" or "which relations carry the predicate
 * 'works_at'?" without scanning everything.  The {@link GraphIndex} fills that
 * gap.  It is the navigation layer of the graph package:
 *
 *   - `findByName`  — resolve a surface form (name or alias) to entities;
 *   - `findByType`  — pull every person, org, location, ... for type-scoped
 *     scans;
 *   - `findByPredicate` — collect every relation that uses a predicate, which
 *     is how the retrieval layer answers "what does Acme do?" style queries;
 *   - `rebuild`     — cheaply bulk-load a fresh index;
 *   - `stats`       — report index shape for telemetry.
 *
 * The index is **derived**: it never owns authoritative data, so every
 * mutating operation (`indexEntity`, `removeEntity`, ...) keeps its secondary
 * maps consistent with the canonical records it was given.  Callers keep the
 * store and index in sync by driving both from the same write path — the
 * {@link GraphEngine} does this for you, and the lifecycle layer re-syncs on
 * prune and reset.
 *
 * All name and predicate lookups are **case-insensitive** by normalizing to
 * lowercase at index time, matching the canonicalization used by the entity
 * id factory in `types.ts`.
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
} from './types.js';

/**
 * The summary shape returned by {@link GraphIndex.stats}.
 */
export interface IndexStats {
  /** Number of indexed entities. */
  readonly entities: number;

  /** Number of indexed relations. */
  readonly relations: number;

  /** Number of distinct normalized name/alias keys in the name index. */
  readonly names: number;

  /** Number of distinct entity types present. */
  readonly types: number;

  /** Number of distinct normalized predicates in the predicate index. */
  readonly predicates: number;

  /** Graph-shape stats rolled up across the indexed data. */
  readonly graph: GraphStats;
}

/**
 * Snapshot shape produced by {@link GraphIndex.toJSON} and consumed by
 * {@link GraphIndex.fromJSON}.
 */
export interface GraphIndexSnapshot {
  /** Index version; used by `fromJSON` to reject incompatible snapshots. */
  readonly version: 1;
  /** Indexed entities, in insertion order. */
  readonly entities: readonly GraphEntity[];
  /** Indexed relations, in insertion order. */
  readonly relations: readonly GraphRelation[];
}

/**
 * An in-memory secondary index over graph entities and relations.
 *
 * Keys are normalized (lowercased/trimmed) surface forms, so lookups are
 * case-insensitive.  Multi-valued buckets are `Set`s of ids, and the index
 * never returns a bucket entry whose canonical record is no longer present —
 * removal cleans up every row synchronously.
 */
export class GraphIndex {
  /** entity id -> entity.  Canonical copy for resolving lookups. */
  private readonly byId = new Map<string, GraphEntity>();

  /** relation id -> relation.  Canonical copy for resolving lookups. */
  private readonly byRelationId = new Map<string, GraphRelation>();

  /** normalized name/alias -> set of entity ids that answer to that name. */
  private readonly byName = new Map<string, Set<string>>();

  /** entity type -> set of entity ids of that type. */
  private readonly byType = new Map<EntityType, Set<string>>();

  /** normalized predicate -> set of relation ids that use that predicate. */
  private readonly byPredicate = new Map<string, Set<string>>();

  /**
   * Indexes an entity under its id, name, aliases, and type.
   *
   * If an entity with the same id is already indexed it is replaced: the old
   * entity's rows are removed first, so no stale rows survive the swap.  This
   * is how alias merges and mention bumps stay reflected in lookups.
   *
   * @returns The entity id.
   */
  indexEntity(entity: GraphEntity): string {
    assertGraphEntity(entity);
    if (this.byId.has(entity.id)) {
      this.removeEntity(entity.id);
    }
    this.byId.set(entity.id, entity);
    GraphIndex.addToSet(this.byType, entity.type, entity.id);
    GraphIndex.addToSet(this.byName, GraphIndex.normalize(entity.name), entity.id);
    for (const alias of entity.aliases ?? []) {
      GraphIndex.addToSet(this.byName, GraphIndex.normalize(alias), entity.id);
    }
    return entity.id;
  }

  /**
   * Indexes a relation under its id and predicate.
   *
   * A relation id already present is replaced (removed first, then
   * re-indexed).  Endpoint existence is **not** checked here — the store owns
   * that invariant — but callers should not index a relation whose endpoints
   * they have not also indexed, or lookups will resolve to missing entities.
   *
   * @returns The relation id.
   */
  indexRelation(relation: GraphRelation): string {
    assertGraphRelation(relation);
    if (this.byRelationId.has(relation.id)) {
      this.removeRelation(relation.id);
    }
    this.byRelationId.set(relation.id, relation);
    GraphIndex.addToSet(this.byPredicate, GraphIndex.normalize(relation.predicate), relation.id);
    return relation.id;
  }

  /**
   * Indexes many entities in a single call.
   *
   * @returns The number of entities indexed.
   */
  indexEntities(entities: readonly GraphEntity[]): number {
    for (const entity of entities) this.indexEntity(entity);
    return entities.length;
  }

  /**
   * Indexes many relations in a single call.
   *
   * @returns The number of relations indexed.
   */
  indexRelations(relations: readonly GraphRelation[]): number {
    for (const relation of relations) this.indexRelation(relation);
    return relations.length;
  }

  /**
   * Removes an entity and every index row that points at it.
   *
   * @returns `true` when the entity was indexed and has been removed.
   */
  removeEntity(id: string): boolean {
    const entity = this.byId.get(id);
    if (entity === undefined) return false;

    this.byId.delete(id);
    this.removeFromNameBuckets(entity.id, entity.name, entity.aliases ?? []);

    const typeBucket = this.byType.get(entity.type);
    typeBucket?.delete(id);
    if (typeBucket !== undefined && typeBucket.size === 0) this.byType.delete(entity.type);
    return true;
  }

  /**
   * Removes a relation and its predicate bucket row.
   *
   * @returns `true` when the relation was indexed and has been removed.
   */
  removeRelation(id: string): boolean {
    const relation = this.byRelationId.get(id);
    if (relation === undefined) return false;

    this.byRelationId.delete(id);
    const predicateBucket = this.byPredicate.get(GraphIndex.normalize(relation.predicate));
    predicateBucket?.delete(id);
    if (predicateBucket !== undefined && predicateBucket.size === 0) {
      this.byPredicate.delete(GraphIndex.normalize(relation.predicate));
    }
    return true;
  }

  /**
   * Returns every entity that answers to `name` — its primary name or any
   * alias — compared case-insensitively.
   *
   * Ordered by insertion.  Multiple entities can share a surface form (two
   * people named "Alex"); disambiguate with {@link findByType} or inspect the
   * returned entities' `type` and `attributes`.
   */
  findByName(name: string): GraphEntity[] {
    const bucket = this.byName.get(GraphIndex.normalize(name));
    if (bucket === undefined) return [];
    return this.entitiesForIds(bucket);
  }

  /**
   * Returns `true` when at least one entity answers to `name`.  Cheaper than
   * {@link findByName} when only existence matters.
   */
  hasName(name: string): boolean {
    return this.byName.has(GraphIndex.normalize(name));
  }

  /**
   * Returns the first entity that answers to `name`, or `undefined`.
   *
   * Convenience for callers (like the retrieval layer's entity resolution)
   * that assume names are unique enough for a single match and only need one
   * record back.
   */
  findOneByName(name: string): GraphEntity | undefined {
    const bucket = this.byName.get(GraphIndex.normalize(name));
    if (bucket === undefined) return undefined;
    for (const id of bucket) {
      const entity = this.byId.get(id);
      if (entity !== undefined) return entity;
    }
    return undefined;
  }

  /**
   * Returns every entity whose name or alias starts with `prefix`
   * (case-insensitive).  Useful for autocomplete and "fuzzy-ish" retrieval
   * when the caller does not know the exact surface form.
   *
   * Ordered by insertion order of the matching ids.
   */
  findByNamePrefix(prefix: string): GraphEntity[] {
    const normalized = GraphIndex.normalize(prefix);
    if (normalized.length === 0) return [];
    const ids = new Set<string>();
    for (const [key, bucket] of this.byName) {
      if (key.startsWith(normalized)) {
        for (const id of bucket) ids.add(id);
      }
    }
    return this.entitiesForIds(ids);
  }

  /**
   * Returns every entity of the given type, in insertion order.
   */
  findByType(type: EntityType): GraphEntity[] {
    const bucket = this.byType.get(type);
    if (bucket === undefined) return [];
    return this.entitiesForIds(bucket);
  }

  /**
   * Returns every entity whose type is in `types`, deduplicated across type
   * buckets.  Ordered by first appearance.
   */
  findByTypes(types: readonly EntityType[]): GraphEntity[] {
    const ids = new Set<string>();
    for (const type of types) {
      for (const id of this.byType.get(type) ?? []) ids.add(id);
    }
    return this.entitiesForIds(ids);
  }

  /**
   * Returns every relation that uses `predicate`, compared case-insensitively,
   * in insertion order.
   */
  findByPredicate(predicate: string): GraphRelation[] {
    const bucket = this.byPredicate.get(GraphIndex.normalize(predicate));
    if (bucket === undefined) return [];
    return this.relationsForIds(bucket);
  }

  /**
   * Returns every relation with source `from` and target `to` — the raw edges
   * of a pair.  Ordered by insertion.
   */
  findRelationsBetween(from: string, to: string): GraphRelation[] {
    const result: GraphRelation[] = [];
    for (const relation of this.byRelationId.values()) {
      if (relation.source === from && relation.target === to) result.push(relation);
    }
    return result;
  }

  /**
   * Returns the entity with `id`, or `undefined` when not indexed.
   */
  getEntity(id: string): GraphEntity | undefined {
    return this.byId.get(id);
  }

  /**
   * Returns the relation with `id`, or `undefined` when not indexed.
   */
  getRelation(id: string): GraphRelation | undefined {
    return this.byRelationId.get(id);
  }

  /**
   * Returns whether an entity with `id` is indexed.
   */
  hasEntity(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Returns whether a relation with `id` is indexed.
   */
  hasRelation(id: string): boolean {
    return this.byRelationId.has(id);
  }

  /**
   * Returns all indexed entity ids, in insertion order.
   */
  entityIds(): string[] {
    return [...this.byId.keys()];
  }

  /**
   * Returns all indexed entities, in insertion order.
   */
  entities(): GraphEntity[] {
    return [...this.byId.values()];
  }

  /**
   * Returns all indexed relations, in insertion order.
   */
  relations(): GraphRelation[] {
    return [...this.byRelationId.values()];
  }

  /**
   * Returns the number of indexed entities.
   */
  get entityCount(): number {
    return this.byId.size;
  }

  /**
   * Returns the number of indexed relations.
   */
  get relationCount(): number {
    return this.byRelationId.size;
  }

  /**
   * Drops every indexed record and clears all secondary structures.
   */
  clear(): void {
    this.byId.clear();
    this.byRelationId.clear();
    this.byName.clear();
    this.byType.clear();
    this.byPredicate.clear();
  }

  /**
   * Replaces the entire index contents with `entities` and `relations`.
   *
   * This is strictly cheaper than `clear()` + `indexMany` for bulk loads: it
   * clears first, then indexes each record under its id.  `relations` whose
   * endpoints are not in `entities` are still indexed (the index does not
   * enforce the store's endpoint invariant); callers should pass consistent
   * sets.
   *
   * @returns The number of records indexed (entities + relations).
   */
  rebuild(entities: readonly GraphEntity[], relations: readonly GraphRelation[]): number {
    this.clear();
    let count = 0;
    for (const entity of entities) {
      this.indexEntity(entity);
      count += 1;
    }
    for (const relation of relations) {
      this.indexRelation(relation);
      count += 1;
    }
    return count;
  }

  /**
   * Computes index shape statistics plus graph-shape stats rolled up across
   * the indexed data.
   */
  stats(): IndexStats {
    const byType: Record<EntityType, number> = {
      person: 0,
      org: 0,
      concept: 0,
      location: 0,
      product: 0,
      other: 0,
    };
    let totalMentions = 0;
    for (const entity of this.byId.values()) {
      byType[entity.type] = (byType[entity.type] ?? 0) + 1;
      totalMentions += entity.mentions ?? 0;
    }
    const n = this.byId.size;
    const m = this.byRelationId.size;
    const graph = createGraphStats({
      entities: n,
      relations: m,
      byType,
      totalMentions,
      averageDegree: n > 0 ? (2 * m) / n : 0,
      density: n > 1 ? m / ((n * (n - 1)) / 2) : 0,
      updatedAt: Date.now(),
    });

    return {
      entities: n,
      relations: m,
      names: this.byName.size,
      types: this.byType.size,
      predicates: this.byPredicate.size,
      graph,
    };
  }

  /**
   * Serializes the index to a flat, JSON-friendly snapshot.
   */
  toJSON(): GraphIndexSnapshot {
    return {
      version: 1,
      entities: this.entities(),
      relations: this.relations(),
    };
  }

  /**
   * Restores the index from a snapshot produced by {@link toJSON}, replacing
   * all current contents.  Every record is validated on the way in; on
   * failure nothing is changed.
   */
  fromJSON(snapshot: GraphIndexSnapshot): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported GraphIndex snapshot version ${snapshot.version}`);
    }
    if (!Array.isArray(snapshot.entities) || !Array.isArray(snapshot.relations)) {
      throw new TypeError('GraphIndex snapshot must contain entities and relations arrays');
    }
    const nextEntities: GraphEntity[] = [];
    const nextRelations: GraphRelation[] = [];
    for (const entity of snapshot.entities) {
      assertGraphEntity(entity);
      nextEntities.push(entity);
    }
    for (const relation of snapshot.relations) {
      assertGraphRelation(relation);
      nextRelations.push(relation);
    }
    this.rebuild(nextEntities, nextRelations);
  }

  /** Resolves an id set to its entities, skipping any missing records. */
  private entitiesForIds(ids: Iterable<string>): GraphEntity[] {
    const result: GraphEntity[] = [];
    for (const id of ids) {
      const entity = this.byId.get(id);
      if (entity !== undefined) result.push(entity);
    }
    return result;
  }

  /** Resolves an id set to its relations, skipping any missing records. */
  private relationsForIds(ids: Iterable<string>): GraphRelation[] {
    const result: GraphRelation[] = [];
    for (const id of ids) {
      const relation = this.byRelationId.get(id);
      if (relation !== undefined) result.push(relation);
    }
    return result;
  }

  /** Removes an entity id from every name bucket it was registered under. */
  private removeFromNameBuckets(id: string, name: string, aliases: readonly string[]): void {
    for (const surface of [name, ...aliases]) {
      const key = GraphIndex.normalize(surface);
      const bucket = this.byName.get(key);
      bucket?.delete(id);
      if (bucket !== undefined && bucket.size === 0) this.byName.delete(key);
    }
  }

  /** Adds `value` to the set under `key` in `map`, creating it if needed. */
  private static addToSet<T>(map: Map<T, Set<string>>, key: T, value: string): void {
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      map.set(key, bucket);
    }
    bucket.add(value);
  }

  /** Lowercases and trims a surface form for consistent keying. */
  private static normalize(value: string): string {
    return value.normalize('NFKD').toLowerCase().trim();
  }
}