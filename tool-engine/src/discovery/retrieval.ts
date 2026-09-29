/**
 * retrieval.ts
 *
 * The `ToolSearcher` — ranked retrieval over the Discovery index.
 *
 * This module turns free-text queries and structured filters into ordered,
 * scored tool suggestions. It is deliberately dependency-free: the ranking is
 * a transparent, deterministic blend of three signals:
 *
 *   1. **Name match** — how well the query overlaps the tool's name. Exact
 *      name matches score highest; then full-name containment; then
 *      prefix/token overlap. The name is the strongest signal because tool
 *      names are the most reliable identifier a caller has.
 *   2. **Description overlap** — what fraction of the query tokens appear in
 *      the tool's description. Weaker than the name signal but essential for
 *      natural-language-ish queries such as "fetch a url over http".
 *   3. **Tag / capability match** — when the query happens to equal or
 *      contain a known tag or capability, matching tools are boosted. This
 *      makes `byTag`-style faceted intent flow naturally through the free
 *      text path.
 *
 * Scoring is additive and normalised so that results are comparable across
 * queries. A result's score is a float in `[0, 1]`; callers can filter with
 * `minScore` and cap volume with `limit`.
 *
 * Every public method is deterministic and side-effect free with respect to
 * the index, so the searcher can be called concurrently from many places
 * without locking.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type DiscoveryConfig,
  type DiscoveryStats,
  type SearchOptions,
  type ToolDefinition,
  DEFAULT_DISCOVERY_CONFIG,
  normalizeToken,
  overlapCount,
  tokenizeText,
} from './types.js';
import { ToolIndex } from './index.js';

/**
 * Weight applied to the name-match signal. Kept highest because the tool name
 * is the most precise identifier a caller has.
 */
const NAME_WEIGHT = 0.5;

/**
 * Weight applied to the description-overlap signal.
 */
const DESCRIPTION_WEIGHT = 0.3;

/**
 * Weight applied to the tag/capability overlap signal.
 */
const TAXONOMY_WEIGHT = 0.2;

/**
 * Maximum number of distinct tool names a single free-text query may
 * contribute to the candidate set before scoring kicks in. Beyond this we
 * still honour structured filters but ignore the description-token fan-out to
 * keep worst-case cost bounded.
 */
const MAX_FREE_TEXT_CANDIDATES = 2000;

/**
 * A single ranked search result.
 */
export interface SearchResult {
  /** The matching tool definition. */
  tool: ToolDefinition;

  /**
   * Rank score in `[0, 1]` — higher is a better match. Scores are comparable
   * only within a single query invocation.
   */
  score: number;

  /**
   * The name-match component of the score (`[0, 1]`). Useful for callers
   * that want to explain ranking decisions.
   */
  nameScore: number;

  /**
   * The description-overlap component (`[0, 1]`).
   */
  descriptionScore: number;

  /**
   * The tag/capability-overlap component (`[0, 1]`).
   */
  taxonomyScore: number;
}

/**
 * Scores a tool against a query by combining the three signals described at
 * the top of this module. Pure function — safe to unit test in isolation.
 *
 * @param tool the tool to score.
 * @param query normalized lower-cased query string.
 * @param queryTokens tokenized query (lower-cased).
 * @param config configuration controlling case sensitivity and whether
 *   description scoring is enabled.
 */
export function scoreTool(
  tool: ToolDefinition,
  query: string,
  queryTokens: string[],
  config: DiscoveryConfig,
): {
  nameScore: number;
  descriptionScore: number;
  taxonomyScore: number;
} {
  const normalizedName = normalizeToken(tool.name, config.caseSensitiveNames);
  const normalizedQuery = normalizeToken(query, config.caseSensitiveNames);

  /* --- name signal ---------------------------------------------------- */
  let nameScore = 0;
  if (normalizedName === normalizedQuery) {
    nameScore = 1; // exact name match — best possible result
  } else if (normalizedName.includes(normalizedQuery)) {
    nameScore = 0.9; // query is a contiguous substring of the name
  } else if (normalizedQuery.includes(normalizedName)) {
    nameScore = 0.8; // full name contained in the query (query is longer)
  } else {
    const nameTokens = tokenizeText(normalizedName, config.caseSensitiveNames);
    if (nameTokens.length > 0) {
      const shared = overlapCount(queryTokens, nameTokens);
      nameScore = shared / Math.max(nameTokens.length, queryTokens.length, 1);
    }
  }

  /* --- description signal --------------------------------------------- */
  let descriptionScore = 0;
  if (config.scoreDescriptions) {
    const descTokens = tokenizeText(tool.description);
    if (descTokens.length > 0 && queryTokens.length > 0) {
      const shared = overlapCount(queryTokens, descTokens);
      descriptionScore =
        shared / Math.max(descTokens.length, queryTokens.length, 1);
    }
  }

  /* --- taxonomy signal (tags + capabilities) -------------------------- */
  const taxonomy = [...(tool.tags ?? []), ...(tool.capabilities ?? [])].map(
    (entry) => normalizeToken(entry, config.caseSensitiveNames),
  );
  const taxonomyScore =
    taxonomy.length === 0 || queryTokens.length === 0
      ? 0
      : overlapCount(queryTokens, taxonomy) /
        Math.max(taxonomy.length, queryTokens.length, 1);

  return { nameScore, descriptionScore, taxonomyScore };
}

/**
 * Composes the three signal scores into a final `[0, 1]` score.
 */
function combineScore(parts: {
  nameScore: number;
  descriptionScore: number;
  taxonomyScore: number;
}): number {
  return (
    parts.nameScore * NAME_WEIGHT +
    parts.descriptionScore * DESCRIPTION_WEIGHT +
    parts.taxonomyScore * TAXONOMY_WEIGHT
  );
}

/**
 * Ranked retrieval over a {@link ToolIndex}.
 *
 * @example
 * const searcher = new ToolSearcher(index);
 * const results = searcher.search('http get');
 * for (const { tool, score } of results) {
 *   console.log(tool.name, score.toFixed(3));
 * }
 */
export class ToolSearcher {
  /** The index this searcher reads from. */
  private readonly index: ToolIndex;

  /** Effective configuration. */
  private readonly config: DiscoveryConfig;

  /**
   * Creates a searcher over the given index.
   *
   * @param index the index to query. Owned by the caller; the searcher never
   *   mutates it.
   * @param config configuration overrides; defaults to
   *   {@link DEFAULT_DISCOVERY_CONFIG}.
   */
  constructor(index: ToolIndex, config: Partial<DiscoveryConfig> = {}) {
    this.index = index;
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /* ------------------------------------------------------------------ *
   * Free-text search
   * ------------------------------------------------------------------ */

  /**
   * Searches the index with a free-text query, returning ranked results.
   *
   * Candidates are gathered from name-prefix matches, description-token
   * matches and, when the query equals a known tag or capability, faceted
   * matches. Every candidate is scored and filtered by `minScore`, then
   * sorted descending by score (ties broken by name for determinism) and
   * truncated to `limit`.
   *
   * Structured filters in {@link SearchOptions} (`tags`, `capabilities`) act
   * as hard filters — a tool must carry at least one of each requested facet
   * to survive, regardless of score.
   *
   * @param query the free-text query. Empty or whitespace-only queries return
   *   an empty result set (use `all()` to enumerate everything).
   * @param options per-call search options; `limit` and `minScore` fall back
   *   to config defaults.
   * @returns a list of ranked results, best first. Never `null`; may be empty.
   */
  search(
    query: string,
    options: SearchOptions = {},
  ): SearchResult[] {
    const limit = options.limit ?? this.config.defaultLimit;
    const minScore = options.minScore ?? this.config.minScore;

    const candidateNames = this.gatherCandidates(query);
    const facetFilter = this.buildFacetFilter(options);

    const scored: SearchResult[] = [];
    for (const name of candidateNames) {
      if (facetFilter !== null && !facetFilter(name)) {
        continue;
      }
      const tool = this.index.get(name);
      if (tool === undefined) {
        continue; // index changed underneath us — skip defensively
      }
      const parts = scoreTool(
        tool,
        query,
        tokenizeText(query),
        this.config,
      );
      const score = combineScore(parts);
      if (score < minScore) {
        continue;
      }
      scored.push({
        tool,
        score,
        nameScore: parts.nameScore,
        descriptionScore: parts.descriptionScore,
        taxonomyScore: parts.taxonomyScore,
      });
    }

    scored.sort(
      (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
    );
    return scored.slice(0, limit);
  }

  /**
   * Returns the top `limit` tools advertising the given capability, ranked by
   * name-match strength against the capability's most likely aliases. Because
   * a capability query is structural rather than free text, scoring prefers
   * tools whose *name* echoes the capability, then falls back to taxonomy
   * overlap.
   *
   * @param capability the exact capability name to match.
   * @param limit maximum results; defaults to config `defaultLimit`.
   */
  byCapability(capability: string, limit?: number): SearchResult[] {
    const max = limit ?? this.config.defaultLimit;
    const matches = this.index.findByCapability(capability);
    const queryTokens = tokenizeText(capability);
    const results: SearchResult[] = [];
    for (const name of matches) {
      const tool = this.index.get(name);
      if (tool === undefined) {
        continue;
      }
      const parts = scoreTool(tool, capability, queryTokens, this.config);
      results.push({
        tool,
        score: combineScore(parts),
        nameScore: parts.nameScore,
        descriptionScore: parts.descriptionScore,
        taxonomyScore: parts.taxonomyScore,
      });
    }
    results.sort(
      (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
    );
    return results.slice(0, max);
  }

  /**
   * Returns the top `limit` tools carrying the given tag, ranked the same way
   * as {@link ToolSearcher.byCapability}.
   *
   * @param tag the exact tag name to match.
   * @param limit maximum results; defaults to config `defaultLimit`.
   */
  byTag(tag: string, limit?: number): SearchResult[] {
    const max = limit ?? this.config.defaultLimit;
    const matches = this.index.findByTag(tag);
    const queryTokens = tokenizeText(tag);
    const results: SearchResult[] = [];
    for (const name of matches) {
      const tool = this.index.get(name);
      if (tool === undefined) {
        continue;
      }
      const parts = scoreTool(tool, tag, queryTokens, this.config);
      results.push({
        tool,
        score: combineScore(parts),
        nameScore: parts.nameScore,
        descriptionScore: parts.descriptionScore,
        taxonomyScore: parts.taxonomyScore,
      });
    }
    results.sort(
      (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
    );
    return results.slice(0, max);
  }

  /**
   * Returns tools whose name starts with `prefix`, ranked by name proximity to
   * the prefix (shorter names first on ties). Prefix matching honours
   * `caseSensitiveNames`.
   *
   * @param prefix the name prefix to match.
   * @param limit maximum results; defaults to config `defaultLimit`.
   */
  byNamePrefix(prefix: string, limit?: number): SearchResult[] {
    const max = limit ?? this.config.defaultLimit;
    const matches = this.index.findByNamePrefix(prefix);
    const results: SearchResult[] = [];
    for (const name of matches) {
      const tool = this.index.get(name);
      if (tool === undefined) {
        continue;
      }
      const normalizedName = normalizeToken(
        tool.name,
        this.config.caseSensitiveNames,
      );
      const normalizedPrefix = normalizeToken(
        prefix,
        this.config.caseSensitiveNames,
      );
      const nameScore = normalizedName === normalizedPrefix
        ? 1
        : normalizedName.length === 0
          ? 0
          : normalizedPrefix.length / normalizedName.length;
      results.push({
        tool,
        score: nameScore,
        nameScore,
        descriptionScore: 0,
        taxonomyScore: 0,
      });
    }
    results.sort(
      (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
    );
    return results.slice(0, max);
  }

  /**
   * Generates compact autocomplete suggestions for a partial query. Unlike
   * {@link ToolSearcher.search}, suggestions favour *short, name-anchored*
   * results: exact name matches first, then prefix matches, then token
   * matches, each capped so the list stays tight.
   *
   * @param query the partial query text.
   * @param limit maximum suggestions; defaults to `5`.
   */
  suggest(query: string, limit = 5): string[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const maxCandidates = this.config.maxSuggestCandidates;

    const exact: string[] = [];
    const prefixes: string[] = [];
    const tokenMatches: string[] = [];

    const prefixSet = this.index.findByNamePrefix(trimmed);
    for (const name of prefixSet) {
      if (this.config.caseSensitiveNames
        ? name === trimmed
        : name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()) {
        exact.push(name);
      } else {
        prefixes.push(name);
      }
    }

    if (exact.length + prefixes.length < maxCandidates) {
      const tokens = tokenizeText(trimmed);
      const tokenSet = this.index.findByDescriptionTokens(trimmed);
      for (const name of tokenSet) {
        if (prefixSet.has(name)) {
          continue;
        }
        const tool = this.index.get(name);
        if (tool !== undefined) {
          const toolTokens = tokenizeText(tool.name);
          const shared = overlapCount(tokens, toolTokens);
          if (shared > 0) {
            tokenMatches.push(name);
          }
        }
      }
    }

    tokenMatches.sort(
      (a, b) => a.length - b.length || a.localeCompare(b),
    );
    prefixes.sort(
      (a, b) => a.length - b.length || a.localeCompare(b),
    );

    const result = uniquePreservingOrder([...exact, ...prefixes, ...tokenMatches]);
    return result.slice(0, limit);
  }

  /**
   * Returns every indexed tool as a one-element-each result list, unsorted
   * beyond the index's insertion order. Convenient for enumeration, dumps and
   * `stats` workflows.
   */
  all(): ToolDefinition[] {
    return this.index.all();
  }

  /**
   * Delegates to the index for a {@link DiscoveryStats} snapshot scoped to
   * what the searcher can observe.
   */
  stats(): DiscoveryStats {
    return this.index.stats();
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Collects the candidate tool names for a free-text query. The union of:
   * name-prefix matches, description-token matches, and exact tag /
   * capability matches. Returns an empty set for blank queries.
   */
  private gatherCandidates(query: string): Set<string> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return new Set();
    }

    const candidates = new Set<string>();

    for (const name of this.index.findByNamePrefix(trimmed)) {
      candidates.add(name);
    }

    const tagSet = this.index.findByTag(trimmed);
    for (const name of tagSet) {
      candidates.add(name);
    }

    const capSet = this.index.findByCapability(trimmed);
    for (const name of capSet) {
      candidates.add(name);
    }

    const tokenNames = this.index.findByDescriptionTokens(trimmed);
    if (candidates.size + tokenNames.size <= MAX_FREE_TEXT_CANDIDATES) {
      for (const name of tokenNames) {
        candidates.add(name);
      }
    }

    return candidates;
  }

  /**
   * Builds a predicate implementing the structured facet filters from
   * `options`, or `null` when no facets were requested.
   */
  private buildFacetFilter(
    options: SearchOptions,
  ): ((name: string) => boolean) | null {
    const tags = options.tags ?? [];
    const capabilities = options.capabilities ?? [];
    if (tags.length === 0 && capabilities.length === 0) {
      return null;
    }
    return (name: string): boolean => {
      const tool = this.index.get(name);
      if (tool === undefined) {
        return false;
      }
      if (tags.length > 0) {
        const hasTag = tags.some((tag) => (tool.tags ?? []).includes(tag));
        if (!hasTag) {
          return false;
        }
      }
      if (capabilities.length > 0) {
        const hasCap = capabilities.some((cap) =>
          (tool.capabilities ?? []).includes(cap),
        );
        if (!hasCap) {
          return false;
        }
      }
      return true;
    };
  }
}

/**
 * Deduplicates a string array while preserving first-seen order.
 */
function uniquePreservingOrder(values: string[]): string[] {
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
 * Default exported convenience factory mirroring the class.
 *
 * @param index the index to search over.
 * @param config configuration overrides.
 * @returns a new {@link ToolSearcher}.
 */
export default function createSearcher(
  index: ToolIndex,
  config: Partial<DiscoveryConfig> = {},
): ToolSearcher {
  return new ToolSearcher(index, config);
}