/**
 * High-level retrieval over episodic memory.
 *
 * {@link EpisodicRetriever} sits on top of an {@link EpisodicStore} and (when
 * available) an {@link EpisodicIndex} and answers the questions a memory
 * consumer actually asks:
 *
 * - **"What happened recently?"** — {@link EpisodicRetriever.recent}
 * - **"What did *this* actor do?"** — {@link EpisodicRetriever.byActor}
 * - **"When did we perform *this* action?"** — {@link EpisodicRetriever.byAction}
 * - **"Which attempts succeeded / failed?"** — {@link EpisodicRetriever.byOutcome}
 * - **"What experiences are tagged X?"** — {@link EpisodicRetriever.byTags}
 * - **"Walk me through this one episode in order."** — {@link EpisodicRetriever.timeline}
 * - **"Has this sequence of actions ever been performed before?"** —
 *   {@link EpisodicRetriever.pattern}
 * - **"Given this context, what experiences are most relevant?"** —
 *   {@link EpisodicRetriever.recall}
 *
 * The retriever deliberately returns *episodes*, not ids, so consumers never
 * have to reach back into the store. Where an index is present, facet queries
 * resolve candidate ids through the index and then hydrate full episodes from
 * the store, keeping the index cheap and the results rich.
 *
 * ## Sorting
 *
 * All episode-level queries sort by `startedAt` (descending by default) with
 * the episode id as a deterministic tie-breaker. Timeline queries sort events
 * by their stored order, which is chronological by construction.
 *
 * @packageDocumentation
 * @module episodic/retrieval
 */

import type {
  Episode,
  EpisodeEvent,
  EpisodeHit,
  EpisodeId,
  EpisodeOptions,
  EpisodeOutcome,
  Timestamp,
} from './types.js';
import type { EpisodicIndex } from './index.js';
import type { EpisodicStore } from './store.js';
import { normalizeTags } from './store.js';

/**
 * Default result limit applied when the caller supplies none.
 */
export const DEFAULT_RETRIEVAL_LIMIT = 20;

/**
 * Stable sort of episodes by start time with deterministic tie-breaking.
 *
 * @param episodes - the episodes to sort
 * @param newestFirst - `true` for most-recent-first ordering
 * @returns a new array, sorted in place-safe fashion (does not mutate input)
 */
export function sortEpisodes(episodes: Episode[], newestFirst = true): Episode[] {
  return [...episodes].sort((a, b) => {
    if (a.startedAt !== b.startedAt) {
      return newestFirst ? b.startedAt - a.startedAt : a.startedAt - b.startedAt;
    }
    return newestFirst ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
  });
}

/**
 * Resolve a limit from options, applying the config default.
 *
 * A limit of `0` or `undefined` means "unbounded"; a negative value is
 * clamped to zero (unbounded). The result is the effective limit to apply.
 *
 * @param requested - the caller-supplied limit (may be absent)
 * @param fallback - the configured default limit
 * @returns the effective limit, or `Number.POSITIVE_INFINITY` for unbounded
 */
export function resolveLimit(requested: number | undefined, fallback: number): number {
  if (requested === undefined || requested === 0) {
    return fallback > 0 ? fallback : Number.POSITIVE_INFINITY;
  }
  if (requested < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return requested;
}

/**
 * Slice an array to a positive limit.
 *
 * @param items - the items to slice
 * @param limit - the effective limit (may be `Infinity`)
 * @returns the sliced array
 */
export function applyLimit<T>(items: readonly T[], limit: number): T[] {
  if (!Number.isFinite(limit)) {
    return [...items];
  }
  return items.slice(0, limit);
}

/**
 * Case-insensitive containment test used by full-text scoring.
 *
 * @param haystack - the text to search within
 * @param needle - the query fragment
 * @returns `true` when `haystack` contains `needle` (case-insensitive)
 */
export function containsText(haystack: string | undefined, needle: string): boolean {
  if (!haystack) {
    return false;
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * A sequence step used by the pattern matcher.
 *
 * A step names an action that must appear at some event in the episode. When
 * {@link PatternStep.actor} is set, only events by that actor count; when
 * {@link PatternStep.required} is `false` (default `true`), the step is
 * *optional* — it may be skipped without breaking the match.
 */
export interface PatternStep {
  /** The action name to look for (exact match against event actions). */
  readonly action: string;
  /** When set, only events by this actor are considered. */
  readonly actor?: string;
  /** When `false`, this step is optional and may be skipped. */
  readonly required?: boolean;
}

/**
 * Options accepted by {@link EpisodicRetriever.pattern}.
 */
export interface PatternOptions {
  /**
   * Maximum number of episodes to return. Defaults to the configured limit.
   */
  readonly limit?: number;
  /**
   * When `true`, only episodes whose *contiguous* event sequence contains the
   * pattern are returned. When `false` (default), the pattern's actions may be
   * interleaved with other actions. Contiguous matching is stricter and
   * corresponds to "this exact subroutine ran".
   */
  readonly contiguous?: boolean;
  /**
   * When `true`, matches are scored by pattern completeness so that episodes
   * satisfying *all* steps rank above episodes satisfying only some. Defaults
   * to `true`.
   */
  readonly scoreCompleteness?: boolean;
}

/**
 * A single pattern match: the episode plus a score in `[0, 1]`.
 *
 * A score of `1` means every required step was satisfied in the requested
 * order; lower scores mean some required steps were missed (only returned when
 * the caller asks for partial matches).
 */
export interface PatternMatch {
  /** The matching episode. */
  readonly episode: Episode;
  /** Completeness score in `[0, 1]`. */
  readonly score: number;
  /** The event ids that satisfied each required step, in step order. */
  readonly matchedEventIds: readonly EpisodeId[];
}

/**
 * Retrieval engine over an episodic store.
 *
 * Construct a retriever over a store, optionally supplying an index for fast
 * facet lookups. The retriever is stateless apart from its references, so a
 * single instance may be shared safely across concurrent consumers.
 */
export class EpisodicRetriever {
  /** The store episodes are read from. */
  readonly store: EpisodicStore;
  /** The index used for facet acceleration, when supplied. */
  readonly index: EpisodicIndex | null;
  /** Default limit applied when callers omit one. */
  readonly defaultLimit: number;

  /**
   * Construct a retriever.
   *
   * @param store - the store to read episodes from
   * @param index - an optional index used to accelerate facet queries
   * @param defaultLimit - optional default result limit
   */
  constructor(store: EpisodicStore, index?: EpisodicIndex | null, defaultLimit = DEFAULT_RETRIEVAL_LIMIT) {
    this.store = store;
    this.index = index ?? null;
    this.defaultLimit = defaultLimit;
  }

  /**
   * The most recent episodes, newest first.
   *
   * @param limit - maximum results; defaults to the configured limit
   * @returns episodes sorted by start time descending
   */
  recent(limit?: number): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    return applyLimit(sortEpisodes(this.store.listEpisodes(), true), effective);
  }

  /**
   * Episodes featuring events by a given actor.
   *
   * Uses the index when present, otherwise scans the store.
   *
   * @param actor - the actor to search for
   * @param limit - maximum results
   * @returns matching episodes, newest first
   */
  byActor(actor: string, limit?: number): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    const ids = this.index
      ? this.index.findByActor(actor)
      : this.scanIds((episode) => episode.events.some((event) => event.actor === actor));
    return this.hydrateSorted(ids, effective);
  }

  /**
   * Episodes featuring events with a given action.
   *
   * @param action - the action name to search for
   * @param limit - maximum results
   * @returns matching episodes, newest first
   */
  byAction(action: string, limit?: number): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    const ids = this.index
      ? this.index.findByAction(action)
      : this.scanIds((episode) => episode.events.some((event) => event.action === action));
    return this.hydrateSorted(ids, effective);
  }

  /**
   * Episodes whose aggregate outcome matches the given outcome.
   *
   * @param outcome - the outcome to match (e.g. `'success'`)
   * @param limit - maximum results
   * @returns matching episodes, newest first
   */
  byOutcome(outcome: string | EpisodeOutcome, limit?: number): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    const ids = this.index
      ? this.index.findByOutcome(outcome)
      : this.scanIds((episode) => episode.outcome === outcome);
    return this.hydrateSorted(ids, effective);
  }

  /**
   * Episodes carrying the given tags.
   *
   * @param tags - the tags to match
   * @param limit - maximum results
   * @param mode - `'all'` (default) requires every tag; `'any'` matches one
   * @returns matching episodes, newest first
   */
  byTags(tags: readonly string[], limit?: number, mode: 'all' | 'any' = 'all'): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    const normalised = normalizeTags(tags, true);
    const ids = this.index
      ? this.index.findByTags(normalised, mode)
      : this.scanIds((episode) => {
          const owned = normalizeTags(episode.tags, true);
          if (mode === 'all') {
            return normalised.every((tag) => owned.includes(tag));
          }
          return normalised.some((tag) => owned.includes(tag));
        });
    return this.hydrateSorted(ids, effective);
  }

  /**
   * Episodes whose start time falls within `[from, to]`.
   *
   * @param from - inclusive lower bound (epoch ms), or `null` for open start
   * @param to - inclusive upper bound (epoch ms), or `null` for open end
   * @param limit - maximum results
   * @returns matching episodes in chronological order (oldest first)
   */
  byDateRange(from: Timestamp | null, to: Timestamp | null, limit?: number): Episode[] {
    const effective = resolveLimit(limit, this.defaultLimit);
    const ids = this.index
      ? this.index.findByDateRange(from, to)
      : this.scanIds((episode) => {
          if (from !== null && episode.startedAt < from) {
            return false;
          }
          if (to !== null && episode.startedAt > to) {
            return false;
          }
          return true;
        }).sort(
          (a, b) =>
            (this.store.getEpisode(a)?.startedAt ?? 0) -
            (this.store.getEpisode(b)?.startedAt ?? 0),
        );
    return this.hydrateSorted(ids, effective, false);
  }

  /**
   * The ordered event timeline of a single episode.
   *
   * Events are returned in stored (chronological) order, optionally filtered
   * to a window of time.
   *
   * @param episodeId - the episode to walk
   * @param opts - optional time window and ordering controls
   * @returns the episode's events
   * @throws {Error} when the episode does not exist
   */
  timeline(episodeId: EpisodeId, opts?: EpisodeOptions): EpisodeEvent[] {
    const episode = this.store.requireEpisode(episodeId);
    let events = episode.events;
    if (opts?.from !== undefined || opts?.to !== undefined) {
      events = events.filter(
        (event) =>
          (opts.from === undefined || event.timestamp >= opts.from) &&
          (opts.to === undefined || event.timestamp <= opts.to),
      );
    }
    const ordered = [...events];
    if (opts?.newestFirst === true) {
      ordered.reverse();
    }
    return ordered;
  }

  /**
   * Match a *sequence* of actions against stored episodes.
   *
   * The pattern matcher answers "has this sequence of actions happened
   * before?" Each {@link PatternStep} names an action; the matcher walks each
   * episode's events in order and checks whether the steps are satisfied in
   * sequence. With `contiguous: true` the actions must appear back-to-back
   * with no unrelated events between them — the strictest reading of "this
   * exact subroutine ran".
   *
   * @param query - the sequence of steps to match
   * @param opts - matching controls; see {@link PatternOptions}
   * @returns ranked matches, best (most complete, most recent) first
   */
  pattern(query: readonly PatternStep[], opts?: PatternOptions): PatternMatch[] {
    if (query.length === 0) {
      return [];
    }
    const effective = resolveLimit(opts?.limit, this.defaultLimit);
    const matches: PatternMatch[] = [];

    for (const episode of this.store.listEpisodes()) {
      const result = matchPattern(episode, query, {
        contiguous: opts?.contiguous ?? false,
        scoreCompleteness: opts?.scoreCompleteness ?? true,
      });
      if (result) {
        matches.push(result);
      }
    }

    matches.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.episode.startedAt - a.episode.startedAt;
    });

    return applyLimit(matches, effective);
  }

  /**
   * Recall the experiences most relevant to a textual context.
   *
   * Scoring combines:
   *
   * 1. **Action affinity** — episodes whose actions appear in the context text
   *    score higher (weighted, since actions are the most discriminative
   *    signal in an episodic store).
   * 2. **Tag affinity** — episodes sharing tags with those extracted from the
   *    context score higher.
 3. **Actor affinity** — episodes featuring actors named in the context.
   * 4. **Recency** — a small recency bonus so recent experiences float to the
   *    top among equally-scored matches.
   *
   * Every episode in the store is scored, then the top `lookback` candidates
   * are reduced to `limit` hits; all returned hits are decorated with a human
   * readable `reason`.
   *
   * @param context - the natural-language or keyword context to recall against
   * @param opts - retrieval options; see {@link EpisodeOptions}
   * @returns ranked {@link EpisodeHit}s, strongest first
   */
  recall(context: string, opts?: EpisodeOptions): EpisodeHit[] {
    const limit = resolveLimit(opts?.limit, this.defaultLimit);
    const lookback = resolveLimit(opts?.lookback, Math.max(this.defaultLimit, limit > 0 ? limit : 20));
    const text = context.trim().toLowerCase();

    const scored: Array<{ episode: Episode; score: number; reason: string }> = [];
    const now = Date.now();
    const recencySpan = 7 * 24 * 60 * 60 * 1000;

    for (const episode of this.store.listEpisodes()) {
      const { score, reason } = scoreEpisode(episode, text, {
        fullText: opts?.fullText ?? false,
        now,
        recencySpan,
      });
      scored.push({ episode, score, reason });
    }

    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.episode.startedAt - a.episode.startedAt;
    });

    const candidates = applyLimit(scored, lookback);
    return applyLimit(candidates, limit).map(({ episode, score, reason }) => ({
      episode,
      score,
      reason,
    }));
  }

  /**
   * Aggregate statistics about the retrievable corpus.
   *
   * Delegates to the store; provided for symmetry with the other layers.
   *
   * @returns store statistics
   */
  stats() {
    return this.store.stats();
  }

  /**
   * Scan every episode and collect ids passing a predicate.
   *
   * Fallback path used when no index is available.
   *
   * @param predicate - the filter to apply
   * @returns matching episode ids
   */
  private scanIds(predicate: (episode: Episode) => boolean): EpisodeId[] {
    const ids: EpisodeId[] = [];
    for (const episode of this.store.listEpisodes()) {
      if (predicate(episode)) {
        ids.push(episode.id);
      }
    }
    return ids;
  }

  /**
   * Resolve ids to episodes and sort by start time.
   *
   * @param ids - candidate episode ids
   * @param limit - maximum results
   * @param newestFirst - sort direction (default most recent first)
   * @returns hydrated, sorted episodes
   */
  private hydrateSorted(ids: readonly EpisodeId[], limit: number, newestFirst = true): Episode[] {
    const episodes: Episode[] = [];
    for (const id of ids) {
      const episode = this.store.getEpisode(id);
      if (episode) {
        episodes.push(episode);
      }
    }
    return applyLimit(sortEpisodes(episodes, newestFirst), limit);
  }
}

/**
 * Internal scoring for a single episode against a recall context.
 *
 * @param episode - the episode to score
 * @param text - the lower-cased context text
 * @param opts - scoring controls
 * @returns the score in `[0, 1]` and a human-readable reason
 */
export function scoreEpisode(
  episode: Episode,
  text: string,
  opts: { fullText: boolean; now: number; recencySpan: number },
): { score: number; reason: string } {
  const tokens = new Set(text.split(/\s+/).filter((token) => token.length > 0));
  let actionHits = 0;
  const actionPool = new Set<string>();
  let actorHits = 0;
  const actorPool = new Set<string>();
  let tagHits = 0;
  const tagPool = new Set<string>();

  for (const event of episode.events) {
    actionPool.add(event.action.toLowerCase());
    if (event.actor) {
      actorPool.add(event.actor.toLowerCase());
    }
  }
  for (const tag of episode.tags ?? []) {
    tagPool.add(tag.toLowerCase());
  }

  for (const token of tokens) {
    if (actionPool.has(token)) {
      actionHits += 1;
    }
    if (actorPool.has(token)) {
      actorHits += 1;
    }
    if (tagPool.has(token)) {
      tagHits += 1;
    }
  }

  let fullTextHits = 0;
  if (opts.fullText) {
    if (episode.name && containsText(episode.name, text)) {
      fullTextHits += 1;
    }
    for (const event of episode.events) {
      if (event.payload) {
        for (const [, value] of Object.entries(event.payload)) {
          if (typeof value === 'string' && containsText(value, text)) {
            fullTextHits += 1;
          }
        }
      }
    }
  }

  const actionScore = actionPool.size > 0 ? actionHits / Math.max(actionPool.size, tokens.size) : 0;
  const actorScore = actorPool.size > 0 ? actorHits / Math.max(actorPool.size, tokens.size) : 0;
  const tagScore = tagPool.size > 0 ? tagHits / Math.max(tagPool.size, tokens.size) : 0;
  const recencyBonus = opts.now - episode.startedAt < opts.recencySpan ? 0.05 : 0;

  const score = Math.min(
    1,
    actionScore * 0.5 + actorScore * 0.2 + tagScore * 0.15 + fullTextHits * 0.05 + recencyBonus,
  );

  const reasons: string[] = [];
  if (actionHits > 0) {
    reasons.push(`matched ${actionHits} action token(s)`);
  }
  if (actorHits > 0) {
    reasons.push(`matched ${actorHits} actor token(s)`);
  }
  if (tagHits > 0) {
    reasons.push(`matched ${tagHits} tag token(s)`);
  }
  if (fullTextHits > 0) {
    reasons.push(`full-text match`);
  }
  if (reasons.length === 0) {
    reasons.push('no direct signal; recency-fallback');
  }

  return { score, reason: reasons.join(', ') };
}

/**
 * Attempt to match a pattern against a single episode.
 *
 * Walks the episode's events once, greedily satisfying steps in order.
 *
 * @param episode - the episode to test
 * @param steps - the ordered steps to satisfy
 * @param opts - matching controls
 * @returns a {@link PatternMatch} on success, or `null`
 */
export function matchPattern(
  episode: Episode,
  steps: readonly PatternStep[],
  opts: { contiguous: boolean; scoreCompleteness: boolean },
): PatternMatch | null {
  const matchedEventIds: EpisodeId[] = [];
  let stepIndex = 0;
  let cursor = 0;

  while (stepIndex < steps.length && cursor < episode.events.length) {
    const step = steps[stepIndex];
    const event = episode.events[cursor];
    const eventMatches =
      event.action === step.action && (step.actor === undefined || event.actor === step.actor);

    if (eventMatches) {
      matchedEventIds.push(event.id);
      stepIndex += 1;
      cursor += 1;
      continue;
    }

    if (opts.contiguous) {
      const remainingSteps = steps.slice(stepIndex);
      const optionalSatisfied = remainingSteps.every(
        (remaining) => remaining.required === false,
      );
      if (optionalSatisfied) {
        break;
      }
      return null;
    }

    cursor += 1;
  }

  if (opts.scoreCompleteness) {
    const requiredTotal = steps.filter((step) => step.required !== false).length;
    const requiredMatched = matchedEventIds.length;
    const score =
      requiredTotal === 0 ? 1 : Math.min(1, requiredMatched / requiredTotal);
    if (requiredMatched === 0 && requiredTotal > 0) {
      return null;
    }
    return { episode, score, matchedEventIds };
  }

  if (stepIndex < steps.length) {
    return null;
  }
  return { episode, score: 1, matchedEventIds };
}