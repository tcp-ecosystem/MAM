import { describe, it, expect } from 'vitest';
import { GraphEngine } from '../src/graph/retrieval.js';
import { GraphStore } from '../src/graph/store.js';
import { GraphLifecycle } from '../src/graph/lifecycle.js';
import {
  createGraphEntity,
  createGraphRelation,
  entityIdFromName,
  DEFAULT_GRAPH_CONFIG,
} from '../src/graph/types.js';

describe('graph', () => {
  it('GraphEngine.extractEntities finds typed candidates', () => {
    const engine = new GraphEngine();
    const extraction = engine.extractEntities('Sir John Smith works at Acme Inc.');

    const names = extraction.candidates.map((c) => c.name);
    expect(names).toContain('Sir John Smith');
    expect(names).toContain('Acme Inc');

    const person = extraction.candidates.find((c) => c.name === 'Sir John Smith');
    expect(person?.type).toBe('person');
    expect(person?.mentions.length).toBeGreaterThan(0);
    expect(person?.confidence).toBeGreaterThan(0.8);
  });

  it('GraphEngine.extractTriplets emits subject-verb-object triplets', () => {
    const engine = new GraphEngine();
    const triplets = engine.extractTriplets('Ada Lovelace founded DeepMind.');

    expect(triplets).toHaveLength(1);
    expect(triplets[0].subject).toBe('Ada Lovelace');
    expect(triplets[0].predicate).toBe('founded');
    expect(triplets[0].object).toBe('DeepMind');
  });

  it('GraphEngine.addTriplet ingests facts idempotently', () => {
    const engine = new GraphEngine();
    const result = engine.addTriplet({
      subject: 'Ada Lovelace',
      predicate: 'worked_at',
      object: 'DeepMind',
    });

    expect(result.created).toBe(true);
    expect(result.relationId).toBeTruthy();
    expect(engine.store.hasEntity(result.subjectId)).toBe(true);
    expect(result.subjectId).toBe(entityIdFromName('Ada Lovelace'));

    const again = engine.addTriplet({
      subject: 'Ada Lovelace',
      predicate: 'worked_at',
      object: 'DeepMind',
    });
    expect(again.created).toBe(false);
  });

  it('GraphEngine.query returns neighbors and relations', () => {
    const engine = new GraphEngine();
    const result = engine.addTriplet({
      subject: 'Ada Lovelace',
      predicate: 'worked_at',
      object: 'DeepMind',
    });

    const q = engine.query(result.subjectId);
    expect(q.entity?.name).toBe('Ada Lovelace');
    expect(q.neighbors.map((n) => n.entity.name)).toContain('DeepMind');
    expect(q.relations).toHaveLength(1);

    const unknown = engine.query('missing-id');
    expect(unknown.entity).toBeUndefined();
    expect(unknown.neighbors).toHaveLength(0);
  });

  it('GraphEngine.paths and shortestPath traverse the graph', () => {
    const engine = new GraphEngine();
    const r1 = engine.addTriplet({ subject: 'Alpha Corp', predicate: 'owns', object: 'Beta Corp' });
    const r2 = engine.addTriplet({ subject: 'Beta Corp', predicate: 'owns', object: 'Gamma Corp' });

    expect(engine.shortestPath(r1.subjectId, r2.objectId)).toEqual([
      r1.subjectId,
      r2.subjectId,
      r2.objectId,
    ]);

    const paths = engine.paths(r1.subjectId, r2.objectId, 3);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].length).toBe(2);
    expect(paths[0].nodes).toEqual([r1.subjectId, r2.subjectId, r2.objectId]);

    const centrality = engine.degreeCentrality();
    expect(centrality.map((e) => e.entityId)).toContain(r2.subjectId);
    expect(centrality[0].degree).toBeGreaterThanOrEqual(2);
  });

  it('GraphStore round-trips entities and relations through toJSON/fromJSON', () => {
    const store = new GraphStore();
    const alpha = createGraphEntity({ name: 'Alpha Corp', type: 'org' });
    const beta = createGraphEntity({ name: 'Beta Corp', type: 'org' });
    store.addEntity(alpha);
    store.addEntity(beta);

    const relation = createGraphRelation({
      source: alpha.id,
      target: beta.id,
      predicate: 'partners_with',
    });
    store.addRelation(relation);

    expect(store.entityCount).toBe(2);
    expect(store.relationCount).toBe(1);
    expect(store.degree(alpha.id).total).toBe(1);

    store.fromJSON(store.toJSON());
    expect(store.entityCount).toBe(2);
    expect(store.relationCount).toBe(1);
    expect(store.getEntity(alpha.id)?.name).toBe('Alpha Corp');
    expect(store.getRelation(relation.id)?.predicate).toBe('partners_with');
  });

  it('GraphLifecycle.addEntity/addRelation emit typed events', () => {
    const store = new GraphStore();
    const lifecycle = new GraphLifecycle(store);

    let entityAdded = 0;
    lifecycle.onEntityAdded(() => {
      entityAdded += 1;
    });

    const entity = createGraphEntity({ name: 'Orion Systems', type: 'org' });
    expect(lifecycle.addEntity(entity)).toBe(true);
    expect(entityAdded).toBe(1);
    expect(store.hasEntity(entity.id)).toBe(true);
    lifecycle.dispose();
  });

  it('GraphLifecycle.prune evicts least-connected entities first', () => {
    const store = new GraphStore();
    const lifecycle = new GraphLifecycle(store);

    for (let i = 0; i < 20; i += 1) {
      lifecycle.addEntity(createGraphEntity({ name: `Entity ${i}`, type: 'other' }));
    }
    expect(store.entityCount).toBe(20);

    const pruned = lifecycle.prune(10);
    expect(pruned).toBe(10);
    expect(store.entityCount).toBe(10);
    expect(lifecycle.stats().entities).toBe(10);
    lifecycle.dispose();
  });

  it('factories and defaults are available', () => {
    const entity = createGraphEntity({ name: 'DeepMind', type: 'org' });
    expect(entity.id).toBe(entityIdFromName('DeepMind'));
    expect(entity.type).toBe('org');

    expect(DEFAULT_GRAPH_CONFIG.maxEntities).toBe(10_000);
    expect(DEFAULT_GRAPH_CONFIG.minMentions).toBe(1);
  });
});