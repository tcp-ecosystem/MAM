/**
 * Episodic memory layer tests.
 */

import { describe, it, expect } from 'vitest';

import { EpisodicStore } from '../src/episodic/store.js';
import { EpisodicIndex, createIndex } from '../src/episodic/index.js';
import { EpisodicRetriever } from '../src/episodic/retrieval.js';
import { EpisodicLifecycle } from '../src/episodic/lifecycle.js';
import {
  createEpisodicAdapter,
  EpisodeRecorder,
} from '../src/episodic/integration.js';

describe('EpisodicStore', () => {
  it('records episodes and appends events', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 100,
      events: [{ id: 'x', action: 'search', actor: 'alice', timestamp: 100 }],
    });
    expect(store.getEpisode('e1')?.id).toBe('e1');
    store.appendEvent('e1', { id: 'y', action: 'click', actor: 'alice', timestamp: 200 });
    expect(store.getEvents('e1').length).toBe(2);
    expect(store.size()).toBe(1);
  });

  it('sets outcomes and finalises episodes', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 100,
      events: [{ id: 'x', action: 'search', timestamp: 100 }],
    });
    store.setOutcome('e1', 'success');
    expect(store.getEpisode('e1')?.outcome).toBe('success');
    expect(store.getEpisode('e1')?.endedAt).not.toBeNull();
    expect(() =>
      store.appendEvent('e1', { action: 'click', timestamp: 300 }),
    ).toThrow();
  });

  it('normalises tags on record', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 0,
      tags: ['Checkout', 'checkout', '  ECommerce '],
      events: [],
    });
    expect(store.getEpisode('e1')?.tags).toEqual(['checkout', 'ecommerce']);
  });

  it('round-trips through JSON', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 100,
      events: [{ id: 'x', action: 'search', timestamp: 100 }],
    });
    const restored = EpisodicStore.fromJSON(JSON.stringify(store.toJSON()));
    expect(restored.getEpisode('e1')?.events.length).toBe(1);
  });

  it('consolidates episodes into one', () => {
    const store = new EpisodicStore();
    store.recordEpisode({ id: 'a', startedAt: 100, events: [{ id: '1', action: 'x', timestamp: 100 }] });
    store.recordEpisode({ id: 'b', startedAt: 200, events: [{ id: '2', action: 'y', timestamp: 200 }] });
    const result = store.consolidate(['a', 'b'], 'merged-ep');
    expect(result.targetId).toBe('merged-ep');
    expect(result.events).toBe(2);
    expect(store.hasEpisode('a')).toBe(false);
    expect(store.size()).toBe(1);
  });
});

describe('EpisodicIndex', () => {
  it('indexes actors, actions, tags, outcomes and dates', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 100,
      tags: ['shop'],
      outcome: 'success',
      events: [
        { id: '1', action: 'search', actor: 'alice', timestamp: 100 },
        { id: '2', action: 'buy', actor: 'alice', timestamp: 200 },
      ],
    });
    store.recordEpisode({
      id: 'e2',
      startedAt: 50,
      outcome: 'failure',
      events: [{ id: '3', action: 'search', actor: 'bob', timestamp: 50 }],
    });
    const index = createIndex(store);
    expect(index.findByActor('alice')).toEqual(['e1']);
    expect(index.findByAction('search').sort()).toEqual(['e1', 'e2']);
    expect(index.findByOutcome('failure')).toEqual(['e2']);
    expect(index.findByTags(['shop'])).toEqual(['e1']);
    expect(index.findByDateRange(0, 60)).toEqual(['e2']);
    expect(index.stats().episodes).toBe(2);
  });
});

describe('EpisodicRetriever', () => {
  function setup() {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 100,
      tags: ['shop'],
      outcome: 'success',
      events: [
        { id: '1', action: 'search', actor: 'alice', timestamp: 100 },
        { id: '2', action: 'buy', actor: 'alice', timestamp: 200 },
      ],
    });
    store.recordEpisode({
      id: 'e2',
      startedAt: 50,
      outcome: 'failure',
      events: [{ id: '3', action: 'search', actor: 'bob', timestamp: 50 }],
    });
    return new EpisodicRetriever(store);
  }

  it('finds episodes by actor', () => {
    const retriever = setup();
    expect(retriever.byActor('alice').map((e) => e.id)).toEqual(['e1']);
  });

  it('finds episodes by action', () => {
    const retriever = setup();
    expect(retriever.byAction('search').length).toBe(2);
  });

  it('walks an episode timeline in order', () => {
    const retriever = setup();
    expect(retriever.timeline('e1').map((ev) => ev.action)).toEqual(['search', 'buy']);
  });

  it('matches action patterns', () => {
    const retriever = setup();
    const matches = retriever.pattern(
      [{ action: 'search' }, { action: 'buy' }],
      { scoreCompleteness: false },
    );
    expect(matches.length).toBe(1);
    expect(matches[0].episode.id).toBe('e1');
    expect(matches[0].score).toBe(1);
  });

  it('recalls episodes relevant to a context', () => {
    const retriever = setup();
    const hits = retriever.recall('alice buy');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].episode.id).toBe('e1');
    expect(hits[0].reason.length).toBeGreaterThan(0);
  });
});

describe('EpisodicLifecycle', () => {
  it('prunes episodes older than a retention window', () => {
    const now = 1000;
    const store = new EpisodicStore({ now: () => now });
    store.recordEpisode({ id: 'old', startedAt: 100, events: [{ id: '1', action: 'a', timestamp: 100 }] });
    store.recordEpisode({ id: 'new', startedAt: 900, events: [{ id: '2', action: 'b', timestamp: 900 }] });
    const lifecycle = new EpisodicLifecycle(store, () => now);
    let eventDetail: unknown;
    lifecycle.events.on('prune', (event) => {
      eventDetail = event.detail;
    });
    const removed = lifecycle.prune(500);
    expect(removed).toBe(1);
    expect(store.hasEpisode('old')).toBe(false);
    expect(store.hasEpisode('new')).toBe(true);
    expect(eventDetail).toBe(1);
  });

  it('summarises episodes as prose', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      name: 'Checkout attempt',
      startedAt: 100,
      outcome: 'success',
      events: [
        { id: '1', action: 'search', actor: 'alice', timestamp: 100 },
        { id: '2', action: 'buy', actor: 'alice', timestamp: 200 },
      ],
    });
    const lifecycle = new EpisodicLifecycle(store);
    const summary = lifecycle.summarizeEpisode('e1');
    expect(typeof summary).toBe('string');
    expect(summary).toContain('Checkout attempt');
    expect(summary).toContain('alice');
  });

  it('consolidates episodes through the lifecycle', () => {
    const store = new EpisodicStore();
    store.recordEpisode({ id: 'a', startedAt: 100, events: [{ id: '1', action: 'x', timestamp: 100 }] });
    store.recordEpisode({ id: 'b', startedAt: 200, events: [{ id: '2', action: 'y', timestamp: 200 }] });
    const lifecycle = new EpisodicLifecycle(store);
    const result = lifecycle.consolidate(['a', 'b']);
    expect(result.events).toBe(2);
    expect(store.size()).toBe(1);
  });

  it('trims episodes to a max event count', () => {
    const store = new EpisodicStore();
    store.recordEpisode({
      id: 'e1',
      startedAt: 0,
      events: [
        { id: '1', action: 'a', timestamp: 1 },
        { id: '2', action: 'b', timestamp: 2 },
        { id: '3', action: 'c', timestamp: 3 },
      ],
    });
    const lifecycle = new EpisodicLifecycle(store);
    const result = lifecycle.trim('e1', 2);
    expect(result.removed).toBe(1);
    expect(store.getEvents('e1').length).toBe(2);
  });
});

describe('EpisodicRuntimeAdapter', () => {
  it('implements the runtime memory surface', async () => {
    const adapter = createEpisodicAdapter();
    await adapter.set('e1', 'checkout attempt with socks', {});
    expect(await adapter.get('e1')).toBeDefined();
    expect(await adapter.has('e1')).toBe(true);
    expect((await adapter.keys()).length).toBe(1);
    const results = adapter.search('socks');
    expect(results.length).toBeGreaterThan(0);
    expect(await adapter.delete('e1')).toBe(true);
    expect(await adapter.has('e1')).toBe(false);
    await adapter.clear();
  });

  it('records episodes and searches by facet', async () => {
    const adapter = createEpisodicAdapter();
    adapter.record({
      id: 'ep-facet',
      startedAt: 100,
      tags: ['checkout'],
      events: [{ id: '1', action: 'buy', actor: 'alice', timestamp: 100 }],
    });
    const results = adapter.search({ clauses: [{ facet: 'actor', values: ['alice'] }] });
    expect(results.length).toBe(1);
    expect(results[0].episode.id).toBe('ep-facet');
    expect(results[0].facets.actor).toEqual(['alice']);
  });
});

describe('EpisodeRecorder', () => {
  it('builds episodes fluently', () => {
    const episode = new EpisodeRecorder('ep-rec')
      .named('Test flow')
      .actor('alice')
      .act('search', { query: 'socks' })
      .act('buy')
      .finish('success')
      .tag('checkout')
      .build();
    expect(episode.events.length).toBe(2);
    expect(episode.outcome).toBe('success');
    expect(episode.tags).toContain('checkout');
    expect(episode.events[0].actor).toBe('alice');
  });

  it('records into a store', () => {
    const store = new EpisodicStore();
    new EpisodeRecorder('ep-1').act('search').record(store);
    expect(store.hasEpisode('ep-1')).toBe(true);
    expect(store.getEvents('ep-1').length).toBe(1);
  });
});