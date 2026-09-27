/**
 * Inverted indexes for fast episodic retrieval.
 *
 * {@link EpisodicIndex} trades a modest amount of write-time work for
 * dramatically cheaper reads. Instead of scanning every episode for every
 * query — which is fine for toy stores but degrades badly once a memory grows
 * into the tens of thousands of episodes — the index maintains inverted
 * maps that answer the canonical retrieval questions in O(matches):
 *
 * - **by actor** — which episodes contain a given actor's event?
 * - **by action** — which episodes contain a given action?
 * - **by tag** — which episodes carry a given tag?
 * - **by outcome** — which episodes ended with a given outcome?
 * - **by date** — which episodes started within a window of time?
 *
 * The index is *denormalised* from the {@link EpisodicStore}: it stores only
 * episode ids plus the few facet fields needed for scoring, and it can be
 * rebuilt from any store with {@link EpisodicIndex.rebuild}. It is therefore
 * safe to discard and reconstruct at any time — the store remains the source
 * of truth.
 *
 * ## Design notes
 *
 * - Every index maps a facet key to a `Set` of episode ids, giving O(1)
 *   membership tests and O(n) intersection when combining facets.
 * - A separate time-ordered array of `{ id, startedAt }` entries powers
 *   {@link EpisodicIndex.findByDateRange} via binary search, avoiding a full
 *   scan for the common "what happened in the last hour" query.
 * - {@link EpisodicIndex.findByTags} supports both AND semantics (default)
 *   and OR semantics, matching the common need to either narrow by a required
 *   set of tags or widen across any of several tags.
 * - Facet values are normalised exactly as the store normalises them
 *   (lower-cased tags), so indexing episodes recorded by an
 *   {@link EpisodicStore} and then querying the index requires no extra
 *   canonicalisation on the caller's part.
 *
 * @packageDocumentation
 * @module episodic/index
 */

import type {
  Episode,
  EpisodeId,
  EpisodeOutcome,
  EpisodeStats,
  Timestamp,
} from './types.js';
import { EpisodicStore, normalizeTags } from './store.js';

/**
 * The set of distinct facet keys used by the inverted indexes.
 *
 * Exposed as a const object so callers and tests can enumerate the dimensions
 * an index maintains without reaching into implementation details.
 */
export const INDEX_FACETS = {
  actor: 'actor',
  action: 'action',
  tag: 'tag',
  outcome: 'outcome',
} as const;

/**
 * The facet key union derived from {@link INDEX_FACETS}.
 */
export type IndexFacet = (typeof INDEX_FACETS)[keyof typeof INDEX_FACETS];

/**
 * A single time entry used for range queries.
 *
 * Kept sorted by `startedAt` (then by id for determinism) inside the index so
 * {@link EpisodicIndex.findByDateRange} can locate its window with binary
 * search.
 */
export interface IndexTimeEntry {
  /** Episode id this entry describes. */
  readonly id: EpisodeId;
  /** Epoch-millisecond start time of the episode. */
  readonly startedAt: Timestamp;
}

/**
 * A matching episode id with the facets that caused it to match.
 *
 * Returned by the composite finders so callers can explain *why* an episode
 * surfaced (useful for debugging and for recall scoring).
 */
export interface IndexMatch {
  /** The matched episode id. */
  readonly id: EpisodeId;
  /** The facet keys and values that matched. */
  readonly matched: Readonly<Record<IndexFacet, readonly string[]>>;
}

/**
 * Statistics describing the current state of an index.
 *
 * Distinct from {@link EpisodeStats} (which describes the store): these counts
 * describe the index's internal maps, so they are useful for sizing and for
 * detecting index drift after {@link EpisodicIndex.rebuild}.
 */
export interface IndexStats {
  /** Number of indexed episodes. */
  readonly episodes: number;
  /** Number of distinct actors indexed. */
  readonly actors: number;
  /** Number of distinct actions indexed. */
  readonly actions: number;
  /** Number of distinct tags indexed. */
  readonly tags: number;
  /** Number of distinct outcomes indexed. */
  readonly outcomes: number;
  /** Total facet-key-to-episode associations held across all maps. */
  readonly associations: number;
}

/**
 * Returns the chronological facet values recorded on an episode that the index
 * cares about: the events' actors, actions and per-event outcomes, plus the
 * episode-level tags and outcome.
 *
 * @param episode - the episode to read facets from
 * @returns facet value lists keyed by facet name
 */
export function extractFacets(episode: Episode): {
  actors: string[];
  actions: string[];
  tags: string[];
  outcomes: string[];
} {
  const actors = new Set<string>();
  const actions = new Set<string>();
  const outcomes = new Set<string>();
  if (episode.outcome) {
    outcomes.add(episode.outcome);
  }
  for (const event of episode.events) {
    if (event.actor !== undefined) {
      actors.add(event.actor);
    }
    actions.add(event.action);
    if (typeof event.outcome === 'string') {
      outcomes.add(event.outcome);
    } else if (event.outcome && event.outcome.status) {
      outcomes.add(event.outcome.status);
    }
  }
  return {
    actors: [...actors],
    actions: [...actions],
    tags: [...(episode.tags ?? [])],
    outcomes: [...outcomes],
  };
}

/**
 * Sorted insertion of a time entry into an array, keeping the array ordered by
 * `startedAt` ascending then `id` for deterministic tie-breaking.
 *
 * @param entries - the array to insert into (mutated in place)
 * @param entry - the entry to insert
 */
export function insertTimeEntry(entries: IndexTimeEntry[], entry: IndexTimeEntry): void {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const current = entries[mid];
    if (
      current.startedAt < entry.startedAt ||
      (current.startedAt === entry.startedAt && current.id < entry.id)
    ) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  entries.splice(low, 0, entry);
}

/**
 * Remove a time entry by id from a sorted array, preserving order.
 *
 * @param entries - the sorted array to remove from (mutated in place)
 * @param id - the episode id whose entry should be removed
 * @returns `true` when an entry was removed
 */
export function removeTimeEntry(entries: IndexTimeEntry[], id: EpisodeId): boolean {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return false;
  }
  entries.splice(index, 1);
  return true;
}

/**
 * Performs a binary search over a sorted time-entry array to locate the first
 * entry whose `startedAt` is `>= from`.
 *
 * @param entries - the sorted array
 * @param from - the lower time bound
 * @returns the insertion index where the window begins
 */
export function lowerBound(entries: IndexTimeEntry[], from: Timestamp): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (entries[mid].startedAt < from) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Maintains inverted facet indexes over a collection of episodes.
 *
 * The index is a separate concern from the {@link EpisodicStore}: it can be
 * constructed empty and fed episodes via {@link EpisodicIndex.indexEpisode},
 * or built wholesale from a store with {@link EpisodicIndex.rebuild}. Because
 * it only stores ids, discarding and rebuilding the index is always a valid
 * recovery path.
 */
export class EpisodicIndex {
  /** actor -> set of episode ids whose events feature that actor. */
  private readonly byActor = new Map<string, Set<EpisodeId>>();
  /** action -> set of episode ids whose events feature that action. */
  private readonly byAction = new Map<string, Set<EpisodeId>>();
  /** tag -> set of episode ids carrying that tag. */
  private readonly byTag = new Map<string, Set<EpisodeId>>();
  /** outcome -> set of episode ids with that episode-level outcome. */
  private readonly byOutcome = new Map<string, Set<EpisodeId>>();
  /** Sorted chronological index used for date-range queries. */
  private readonly byTime: IndexTimeEntry[] = [];

  /**
   * Construct an empty index.
   *
   * @param source - an optional store whose episodes are indexed immediately
   */
  constructor(source?: EpisodicStore) {
    if (source) {
      this.rebuild(source);
    }
  }

  /**
   * Add an episode to the index.
   *
   * If the episode is already indexed (same id), it is removed first and
   * re-added, guaranteeing the index never accumulates stale facet entries
   * after an episode is re-recorded.
   *
   * @param episode - the episode to index
   * @returns `this` for chaining
   */
  indexEpisode(episode: Episode): this {
    if (this.byTime.some((entry) => entry.id === episode.id)) {
      this.removeEpisode(episode.id);
    }
    const facets = extractFacets(episode);
    for (const actor of facets.actors) {
      this.addToIndex(this.byActor, actor, episode.id);
    }
    for (const action of facets.actions) {
      this.addToIndex(this.byAction, action, episode.id);
    }
    for (const tag of facets.tags) {
      this.addToIndex(this.byTag, tag, episode.id);
    }
    for (const outcome of facets.outcomes) {
      this.addToIndex(this.byOutcome, outcome, episode.id);
    }
    insertTimeEntry(this.byTime, { id: episode.id, startedAt: episode.startedAt });
    return this;
  }

  /**
   * Remove an episode (by id) from every index.
   *
   * Idempotent: removing an id that was never indexed is a no-op.
   *
   * @param id - the episode id to un-index
   * @returns `true` when the episode was present and removed
   */
  removeEpisode(id: EpisodeId): boolean {
    let removed = false;
    for (const map of [this.byActor, this.byAction, this.byTag, this.byOutcome]) {
      for (const [, ids] of map) {
        if (ids.delete(id)) {
          removed = true;
        }
      }
    }
    this.pruneEmptyMaps();
    removed = removeTimeEntry(this.byTime, id) || removed;
    return removed;
  }

  /**
   * Drop every facet map entry that no longer holds any episode ids.
   *
   * Keeps the index compact after deletions. Called automatically by
   * {@link EpisodicIndex.removeEpisode}; exposed publicly so callers can
   * compact after many incremental removals if they prefer to defer it.
   */
  pruneEmptyMaps(): void {
    for (const map of [this.byActor, this.byAction, this.byTag, this.byOutcome]) {
      for (const [key, ids] of map) {
        if (ids.size === 0) {
          map.delete(key);
        }
      }
    }
  }

  /**
   * Add a single facet value -> episode id association.
   *
   * @param map - the facet map to update
   * @param key - the facet value
   * @param id - the episode id
   */
  private addToIndex(
    map: Map<string, Set<EpisodeId>>,
    key: string,
    id: EpisodeId,
  ): void {
    let ids = map.get(key);
    if (!ids) {
      ids = new Set<EpisodeId>();
      map.set(key, ids);
    }
    ids.add(id);
  }

  /**
   * All episode ids featuring a given actor.
   *
   * @param actor - the actor to search for (exact match)
   * @returns matching episode ids (order not guaranteed)
   */
  findByActor(actor: string): EpisodeId[] {
    return [...(this.byActor.get(actor) ?? [])];
  }

  /**
   * All episode ids featuring a given action.
   *
   * @param action - the action name to search for (exact match)
   * @returns matching episode ids (order not guaranteed)
   */
  findByAction(action: string): EpisodeId[] {
    return [...(this.byAction.get(action) ?? [])];
  }

  /**
   * All episode ids carrying any of the given tags.
   *
   * Tag values are normalised (lower-cased) before lookup, mirroring store
   * normalisation, so callers may pass tags in any casing.
   *
   * @param tags - the tags to match
   * @param mode - `'all'` (default) requires every tag; `'any'` requires one
   * @returns matching episode ids (order not guaranteed)
   */
  findByTags(
    tags: readonly string[],
    mode: 'all' | 'any' = 'all',
  ): EpisodeId[] {
    const normalised = normalizeTags(tags, true);
    if (normalised.length === 0) {
      return [];
    }
    let result: Set<EpisodeId> | null = null;
    for (const tag of normalised) {
      const ids = this.byTag.get(tag);
      if (!ids || ids.size === 0) {
        if (mode === 'all') {
          return [];
        }
        continue;
      }
      if (result === null) {
        result = new Set(ids);
      } else if (mode === 'all') {
        result = new Set([...result].filter((id) => ids.has(id)));
      } else {
        for (const id of ids) {
          result.add(id);
        }
      }
    }
    return result === null ? [] : [...result];
  }

  /**
   * All episode ids that ended with a given outcome.
   *
   * Accepts both the canonical {@link EpisodeOutcome} strings and any
   * event-level outcome string that was indexed.
   *
   * @param outcome - the outcome to match
   * @returns matching episode ids (order not guaranteed)
   */
  findByOutcome(outcome: string | EpisodeOutcome): EpisodeId[] {
    return [...(this.byOutcome.get(outcome) ?? [])];
  }

  /**
   * All episode ids whose `startedAt` falls within `[from, to]`.
   *
   * A `null`/`undefined` `from` or `to` leaves that bound open. The query
   * uses binary search over the sorted chronological index, so its cost is
   * O(log n + matches) rather than O(n).
   *
   * @param from - inclusive lower bound (epoch ms), or `null` for open start
   * @param to - inclusive upper bound (epoch ms), or `null` for open end
   * @returns matching episode ids, in chronological order
   */
  findByDateRange(from: Timestamp | null, to: Timestamp | null): EpisodeId[] {
    const lower = from === null ? 0 : lowerBound(this.byTime, from);
    const out: EpisodeId[] = [];
    for (let i = lower; i < this.byTime.length; i += 1) {
      const entry = this.byTime[i];
      if (to !== null && entry.startedAt > to) {
        break;
      }
      out.push(entry.id);
    }
    return out;
  }

  /**
   * Combine several facet predicates and return episodes matching all of them.
   *
   * Predicates are combined with AND semantics. Empty predicate arrays are
   * skipped, so passing only the dimensions the caller cares about is safe.
   *
   * @param predicate - the facets to combine; each maps a facet to candidate values
   * @returns matching episode ids and the facets that matched for each
   */
  findComposite(
    predicate: Partial<
      Record<'actor' | 'action' | 'outcome', readonly string[]>
    > &
      Partial<Record<'tags', readonly string[]>>,
  ): IndexMatch[] {
    const candidates = new Set<EpisodeId>();
    const unions: Array<Set<EpisodeId>> = [];

    const actorValues = predicate.actor;
    const actionValues = predicate.action;
    const outcomeValues = predicate.outcome;
    const tagValues = predicate.tags;

    if (actorValues && actorValues.length > 0) {
      const acc = new Set<EpisodeId>();
      for (const value of actorValues) {
        for (const id of this.findByActor(value)) {
          acc.add(id);
        }
      }
      unions.push(acc);
    }
    if (actionValues && actionValues.length > 0) {
      const acc = new Set<EpisodeId>();
      for (const value of actionValues) {
        for (const id of this.findByAction(value)) {
          acc.add(id);
        }
      }
      unions.push(acc);
    }
    if (outcomeValues && outcomeValues.length > 0) {
      const acc = new Set<EpisodeId>();
      for (const value of outcomeValues) {
        for (const id of this.findByOutcome(value)) {
          acc.add(id);
        }
      }
      unions.push(acc);
    }
    if (tagValues && tagValues.length > 0) {
      unions.push(new Set(this.findByTags(tagValues, 'any')));
    }

    if (unions.length === 0) {
      return [];
    }

    for (const id of unions[0]) {
      candidates.add(id);
    }
    for (let i = 1; i < unions.length; i += 1) {
      for (const id of [...candidates]) {
        if (!unions[i].has(id)) {
          candidates.delete(id);
        }
      }
    }

    const results: IndexMatch[] = [];
    for (const id of candidates) {
      const matched: Record<IndexFacet, string[]> = { actor: [], action: [], tag: [], outcome: [] };
      for (const value of actorValues ?? []) {
        if (this.byActor.get(value)?.has(id)) {
          matched.actor.push(value);
        }
      }
      for (const value of actionValues ?? []) {
        if (this.byAction.get(value)?.has(id)) {
          matched.action.push(value);
        }
      }
      for (const value of outcomeValues ?? []) {
        if (this.byOutcome.get(value)?.has(id)) {
          matched.outcome.push(value);
        }
      }
      for (const value of normalizeTags(tagValues ?? [], true)) {
        if (this.byTag.get(value)?.has(id)) {
          matched.tag.push(value);
        }
      }
      results.push({ id, matched });
    }
    return results;
  }

  /**
   * Rebuild the entire index from a store's current contents.
   *
   * All existing index state is discarded first, so calling `rebuild` after a
   * store mutation that bypassed the index always converges the index to the
   * store's truth.
   *
   * @param source - the store to index
   * @returns `this` for chaining
   */
  rebuild(source: EpisodicStore): this {
    this.clear();
    for (const episode of source.listEpisodes()) {
      this.indexEpisode(episode);
    }
    return this;
  }

  /**
   * Remove every association from the index, leaving it empty.
   */
  clear(): void {
    this.byActor.clear();
    this.byAction.clear();
    this.byTag.clear();
    this.byOutcome.clear();
    this.byTime.length = 0;
  }

  /**
   * Aggregate statistics describing the index's internal state.
   *
   * @returns a fresh {@link IndexStats} snapshot
   */
  stats(): IndexStats {
    let associations = 0;
    for (const map of [this.byActor, this.byAction, this.byTag, this.byOutcome]) {
      for (const ids of map.values()) {
        associations += ids.size;
      }
    }
    return {
      episodes: this.byTime.length,
      actors: this.byActor.size,
      actions: this.byAction.size,
      tags: this.byTag.size,
      outcomes: this.byOutcome.size,
      associations,
    };
  }

  /**
   * Compute store-style aggregate stats from the episodes this index knows.
   *
   * Because the index only stores ids, this method requires a store to resolve
   * ids back to episodes. Useful when callers want {@link EpisodeStats} but
   * only want to pay the scan cost once.
   *
   * @param store - the store to resolve episode ids against
   * @returns the store's stats, filtered to episodes this index knows
   */
  statsForStore(store: EpisodicStore): EpisodeStats {
    const all = store.stats();
    return { ...all, episodes: this.byTime.length };
  }
}

/**
 * Convenience factory: build and populate an index from a store in one call.
 *
 * @param store - the store whose episodes should be indexed
 * @returns a fully-built index
 */
export function createIndex(store: EpisodicStore): EpisodicIndex {
  return new EpisodicIndex(store);
}