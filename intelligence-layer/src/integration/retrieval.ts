/**
 * @fileoverview
 * The consolidator: the heart of the Knowledge integration layer.
 *
 * {@link Consolidator} implements a deterministic, dependency-free pipeline
 * that turns a noisy pool of {@link KnowledgeEntry} values into a single,
 * canonical, self-consistent set.  Given an entry pool it:
 *
 *   1. **Filters** low-confidence entries out (below the configured
 *      `minConfidence`).
 *   2. **Orders** the survivors by quality — confidence first, then
 *      information content (token count), then recency — so the best entries
 *      are always the ones consolidation keeps.
 *   3. **Dedupes** near-duplicates: entries whose token-level similarity
 *      reaches the `dedupeThreshold` collapse by keeping the
 *      higher-confidence / higher-information survivor and dropping the rest.
 *   4. **Detects contradictions**: highly similar entries that nonetheless
 *      disagree — one says "yes" while the other says "no", or one asserts a
 *      term while the other negates it — are surfaced as {@link Conflict}
 *      records.  When `mergeConflicts` is enabled the higher-confidence side
 *      wins and the loser is removed; otherwise both survive for a human or
 *      policy to resolve.
 *   5. **Merges** compatible entries: entries that overlap enough to be
 *      clearly about the same thing but are not duplicates are fused into a
 *      canonical form that concatenates their content, unions their metadata,
 *      and keeps the maximum confidence.
 *   6. **Caps** the result at `maxEntries`, dropping the lowest-quality tail.
 *
 * Everything here is lexical and deterministic: it makes no claims about deep
 * semantics and is not a substitute for an LLM.  Its job is to be predictable,
 * explainable, and cheap enough to run on every batch of incoming knowledge.
 *
 * The pairwise primitives are all public so consumers can reuse them:
 * {@link Consolidator.similarity} (token Dice/Jaccard), {@link Consolidator.isContradiction}
 * (shared terms plus opposite-polarity / negation checks),
 * {@link Consolidator.merge} (canonical fusion), and
 * {@link Consolidator.canonicalize} (normalization).
 *
 * @packageDocumentation
 */

import {
  type Conflict,
  type ConsolidationResult,
  type IntegrateConfig,
  type IntegrateOptions,
  type KnowledgeEntry,
  type MergeDecision,
  assertKnowledgeEntry,
  clampScore,
  confidenceOf,
  createConflict,
  createConsolidationResult,
  createMergeDecision,
  hasOwn,
  INTEGRATE_LIMITS,
  isKnowledgeEntry,
  mergeIntegrateOptions,
  normalizeIntegrateConfig,
} from './types.js';

/**
 * A small English stop-word list used by the tokenizer when stripping
 * high-frequency function words.
 *
 * Negation words are deliberately **not** in this list: `not`, `no`, `never`,
 * and friends must survive tokenization so the contradiction detector can see
 * them.  Keeping the list compact preserves recall for short entries while
 * removing the words that carry the least signal.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'ours',
  'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would',
  'you', 'your', 'yours',
]);

/**
 * The words that flip the polarity of the term that follows them.
 *
 * Contradiction detection uses these in a negation-aware pass: if one entry
 * contains a negation word immediately followed by term `t`, and the other
 * entry asserts `t` bare, the pair is treated as a contradiction.
 */
export const NEGATION_WORDS: ReadonlySet<string> = new Set([
  'not', 'no', 'never', 'none', 'nor', 'without', 'lacks', 'lacking',
  'absent', 'unable', 'fails', 'denies', 'disagrees',
]);

/**
 * Opposite-polarity word pairs used by the contradiction detector.
 *
 * A pair of highly similar entries is flagged as a contradiction when one
 * entry contains the positive member and the other contains the negative
 * member (in either direction).  Each pair is a tuple `[positive, negative]`
 * purely by convention; detection is symmetric.
 */
export const OPPOSITE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['yes', 'no'],
  ['true', 'false'],
  ['increase', 'decrease'],
  ['increase', 'decline'],
  ['increase', 'reduce'],
  ['rise', 'fall'],
  ['rises', 'falls'],
  ['grow', 'shrink'],
  ['grows', 'shrinks'],
  ['on', 'off'],
  ['positive', 'negative'],
  ['supported', 'rejected'],
  ['supported', 'opposed'],
  ['accept', 'reject'],
  ['accepts', 'rejects'],
  ['allow', 'deny'],
  ['allows', 'denies'],
  ['enable', 'disable'],
  ['enabled', 'disabled'],
  ['present', 'absent'],
  ['correct', 'incorrect'],
  ['valid', 'invalid'],
  ['succeed', 'fail'],
  ['success', 'failure'],
  ['start', 'stop'],
  ['open', 'closed'],
  ['include', 'exclude'],
  ['includes', 'excludes'],
  ['agree', 'disagree'],
  ['above', 'below'],
  ['before', 'after'],
  ['more', 'less'],
  ['high', 'low'],
  ['large', 'small'],
  ['available', 'unavailable'],
  ['win', 'lose'],
  ['good', 'bad'],
  ['right', 'wrong'],
];

/**
 * The default canonical-merge threshold: entries with at least this much
 * token overlap and no detected contradiction are fused into a canonical
 * form.  Re-exported from {@link types} for convenience so callers can tune
 * one threshold without importing the types module.
 */
export { DEFAULT_CONFLICT_MIN_SIMILARITY, DEFAULT_MERGE_THRESHOLD } from './types.js';

/**
 * A breakdown of the token-level similarity between two entries.
 */
export interface SimilarityBreakdown {
  /** Dice coefficient: `2·|shared| / (|A| + |B|)`. */
  readonly dice: number;
  /** Jaccard coefficient: `|shared| / |A∪B|`. */
  readonly jaccard: number;
  /** Number of shared tokens. */
  readonly shared: number;
  /** Size of the union of the two token sets. */
  readonly union: number;
  /** Token set size of the first entry. */
  readonly sizeA: number;
  /** Token set size of the second entry. */
  readonly sizeB: number;
}

/**
 * Tokenizes text into normalized terms.
 *
 * Text is lowercased, combining diacritics are stripped (so `"café"` matches
 * `"cafe"`), and terms are split on runs of non-alphanumeric characters while
 * apostrophes inside words are kept (`"api's"` stays one term).  When
 * `stripStopwords` is true (the default), high-frequency English function
 * words are removed — but never negation words, which the contradiction
 * detector needs.  Output is capped at {@link INTEGRATE_LIMITS.MAX_TOKENS}.
 */
export function tokenize(text: string, stripStopwords = true): string[] {
  const normalized = text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const raw = normalized.split(/[^a-z0-9']+/);
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length === 0) continue;
    if (stripStopwords && STOP_WORDS.has(token)) continue;
    tokens.push(token);
    if (tokens.length >= INTEGRATE_LIMITS.MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * Returns the de-duplicated, normalized tokens for an entry: its precomputed
 * `tokens` field when present, otherwise a tokenization of its content.
 * Precomputed tokens are lowercased and deduplicated so a caller-supplied
 * vocabulary and the default tokenizer behave consistently in the index.
 */
export function entryTokens(entry: KnowledgeEntry): string[] {
  const source = entry.tokens !== undefined && entry.tokens.length > 0
    ? entry.tokens
    : tokenize(entry.content);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of source) {
    const normalized = token.normalize('NFKD').toLowerCase();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= INTEGRATE_LIMITS.MAX_TOKENS) break;
  }
  return out;
}

/**
 * Returns the number of tokens in an entry (used as its information-content
 * signal during quality ordering).
 */
export function entryTokenCount(entry: KnowledgeEntry): number {
  return entryTokens(entry).length;
}

/**
 * Compares two entries by quality, returning a negative number when `a`
 * ranks *below* `b` (i.e. `b` is the better survivor).
 *
 * Quality order: effective confidence descending, then token count
 * descending, then timestamp descending.  Used by the consolidator to ensure
 * the higher-confidence / higher-information entry always wins a tie.
 */
export function compareEntryQuality(a: KnowledgeEntry, b: KnowledgeEntry): number {
  const confidenceA = confidenceOf(a);
  const confidenceB = confidenceOf(b);
  if (confidenceA !== confidenceB) return confidenceB - confidenceA;
  const tokensA = entryTokenCount(a);
  const tokensB = entryTokenCount(b);
  if (tokensA !== tokensB) return tokensB - tokensA;
  return b.timestamp - a.timestamp;
}

/**
 * Computes the Jaccard similarity between two token sets.
 *
 * Jaccard is `|A∩B| / |A∪B|`; it returns `0` when both sets are empty.  This
 * is the more conservative of the two measures the consolidator can report.
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * Computes the Dice coefficient between two token sets.
 *
 * Dice is `2·|A∩B| / (|A| + |B|)`; it returns `0` when both sets are empty.
 * This is the similarity measure used by {@link Consolidator.similarity}.
 */
export function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

/**
 * The consolidator that turns a pool of knowledge entries into one canonical,
 * self-consistent set.
 *
 * Create one instance per config (or per pipeline) and reuse it — the only
 * mutable state is the normalized config snapshot, so instances are cheap.
 * For one-off consolidation, {@link Consolidator.quick} is a static shortcut.
 */
export class Consolidator {
  /** The normalized, fully-populated config this consolidator was built with. */
  private readonly config: Required<IntegrateConfig>;

  /**
   * Creates a consolidator.  `config` is normalized immediately; invalid
   * values throw at construction time rather than mid-run.
   */
  constructor(config?: IntegrateConfig) {
    this.config = normalizeIntegrateConfig(config);
  }

  /** Returns a copy of the effective config (safe to read and inspect). */
  getConfig(): Required<IntegrateConfig> {
    return { ...this.config };
  }

  /**
   * Consolidates an entry pool into a canonical, self-consistent set.
   *
   * The full pipeline (filter, order, dedupe, contradict, merge, cap) runs
   * deterministically over the input in the order described in the module
   * docs.  The input array is never mutated.  Each surviving entry in the
   * returned `kept` array is canonicalized, and any entry that was fused
   * during a merge is returned in its canonical form.
   *
   * @param entries - The candidate pool.  Every entry is validated; a
   *   malformed entry throws before any work happens.
   * @param options - Per-run overrides on top of the shared config.
   * @returns The {@link ConsolidationResult}: kept set plus merge/removal
   *   counts and the full conflict audit trail.
   */
  consolidate(
    entries: readonly KnowledgeEntry[],
    options?: IntegrateOptions,
  ): ConsolidationResult {
    const effective = mergeIntegrateOptions(this.config, options);

    let merged = 0;
    let removed = 0;
    const conflicts: Conflict[] = [];

    // Validate everything up front so a bad entry cannot partially corrupt a run.
    for (const entry of entries) {
      assertKnowledgeEntry(entry);
    }

    // Phase 1: input cap.
    let pool = entries;
    if (entries.length > effective.maxInput) {
      removed += entries.length - effective.maxInput;
      pool = entries.slice(0, effective.maxInput);
    }

    // Phase 2: confidence filter.
    const filtered: KnowledgeEntry[] = [];
    for (const entry of pool) {
      if (confidenceOf(entry) >= effective.minConfidence) {
        filtered.push(entry);
      } else {
        removed += 1;
      }
    }

    // Phase 3: order by quality, best first.
    filtered.sort(compareEntryQuality);

    // Phase 4: greedy pairwise consolidation.
    const kept: KnowledgeEntry[] = [];
    for (const candidate of filtered) {
      let settled = false;
      for (let i = 0; i < kept.length; i += 1) {
        const prior = kept[i];
        const similarity = this.similarity(prior, candidate);

        // Contradiction check first: polarity beats mere overlap.
        if (similarity >= effective.conflictMinSimilarity) {
          const reason = this.contradictionReason(prior, candidate);
          if (reason !== null) {
            conflicts.push(
              createConflict({
                entries: [prior.id, candidate.id],
                reason,
                similarity,
              }),
            );
            if (effective.mergeConflicts) {
              // Resolve toward the higher-quality survivor already in kept.
              removed += 1;
              settled = true;
              break;
            }
            // Otherwise keep both; never merge or dedupe a contradiction away.
            continue;
          }
        }

        if (similarity >= effective.dedupeThreshold) {
          // Near-duplicate: the higher-quality entry (prior) wins.
          removed += 1;
          settled = true;
          break;
        }

        if (similarity >= effective.mergeThreshold) {
          // Compatible overlap: fuse into a canonical form in place.
          kept[i] = this.merge(prior, candidate);
          merged += 1;
          settled = true;
          break;
        }
      }
      if (!settled) kept.push(this.canonicalize(candidate));
    }

    // Phase 5: cap the result at maxEntries, dropping the lowest-quality tail.
    if (kept.length > effective.maxEntries) {
      removed += kept.length - effective.maxEntries;
      kept.length = effective.maxEntries;
    }

    return createConsolidationResult({ kept, merged, removed, conflicts });
  }

  /**
   * Computes the token-level Dice similarity between two entries in `[0, 1]`.
   *
   * Uses each entry's precomputed `tokens` when present, otherwise its
   * content tokenization.  See {@link similarityBreakdown} for the full
   * Jaccard/Dice/coverage breakdown.
   */
  similarity(a: KnowledgeEntry, b: KnowledgeEntry): number {
    return this.similarityBreakdown(a, b).dice;
  }

  /**
   * Computes the full token-level similarity breakdown between two entries.
   *
   * Returns both the Dice and Jaccard coefficients plus the raw set sizes and
   * coverage counts, so consumers can decide which measure fits their use
   * case without re-tokenizing.
   */
  similarityBreakdown(a: KnowledgeEntry, b: KnowledgeEntry): SimilarityBreakdown {
    const setA = new Set(entryTokens(a));
    const setB = new Set(entryTokens(b));
    let shared = 0;
    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const token of smaller) {
      if (larger.has(token)) shared += 1;
    }
    const union = setA.size + setB.size - shared;
    return {
      dice: union === 0 ? 0 : (2 * shared) / (setA.size + setB.size),
      jaccard: union === 0 ? 0 : shared / union,
      shared,
      union,
      sizeA: setA.size,
      sizeB: setB.size,
    };
  }

  /**
   * Returns whether two entries are believed to contradict one another.
   *
   * A contradiction requires shared vocabulary **and** a polarity clash:
   * either one entry carries the positive member of an
   * {@link OPPOSITE_PAIRS} pair while the other carries the negative member,
   * or one entry negates a term (`"not", "no", "never", "without", ...`)
   * that the other asserts bare.  Pure lexical divergence is not a
   * contradiction — the entries must be talking about the same thing.
   */
  isContradiction(a: KnowledgeEntry, b: KnowledgeEntry): boolean {
    return this.contradictionReason(a, b) !== null;
  }

  /**
   * Returns a human-readable reason why `a` and `b` contradict each other, or
   * `null` when they are not detected as contradictory.
   *
   * The reason names the exact polarity pair or negated term that triggered
   * the flag, so audit logs and review queues can explain themselves.
   */
  contradictionReason(a: KnowledgeEntry, b: KnowledgeEntry): string | null {
    const tokensA = entryTokens(a);
    const tokensB = entryTokens(b);
    if (tokensA.length === 0 || tokensB.length === 0) return null;

    const setB = new Set(tokensB);

    // Shared vocabulary is a precondition: unrelated entries never conflict.
    let shared = 0;
    for (const token of tokensA) {
      if (setB.has(token)) shared += 1;
    }
    if (shared === 0) return null;

    // Pass 1: explicit opposite-polarity pairs, in either direction.
    for (const [positive, negative] of OPPOSITE_PAIRS) {
      const aHasPositive = tokensA.includes(positive);
      const aHasNegative = tokensA.includes(negative);
      const bHasPositive = setB.has(positive);
      const bHasNegative = setB.has(negative);
      if ((aHasPositive && bHasNegative) || (aHasNegative && bHasPositive)) {
        return `opposite polarity terms "${positive}"/"${negative}"`;
      }
    }

    // Pass 2: negation-aware.  "X is not supported" vs "X is supported".
    const setA = new Set(tokensA);
    for (let i = 0; i < tokensA.length - 1; i += 1) {
      if (NEGATION_WORDS.has(tokensA[i]) && setB.has(tokensA[i + 1])) {
        return `negated term "${tokensA[i + 1]}" in one entry but asserted in the other`;
      }
    }
    for (let i = 0; i < tokensB.length - 1; i += 1) {
      if (NEGATION_WORDS.has(tokensB[i]) && setA.has(tokensB[i + 1])) {
        return `negated term "${tokensB[i + 1]}" in one entry but asserted in the other`;
      }
    }

    return null;
  }

  /**
   * Fuses two compatible entries into a single canonical form.
   *
   * The survivor's `id` is preserved (it is the higher-quality member of the
   * pair).  The merged entry:
   *   - concatenates the two contents (deduplicated when they are verbatim);
   *   - keeps the survivor's `source`, recording the union in
   *     `metadata.mergedSources`;
   *   - re-derives `tokens` from the fused content;
   *   - keeps the **maximum** confidence (preserving `undefined` when neither
   *     entry had one);
   *   - keeps the **newest** timestamp;
   *   - unions `metadata`, preferring the higher-confidence contributor's
   *     value on key collisions, and records `mergedFrom: [a.id, b.id]`.
   */
  merge(a: KnowledgeEntry, b: KnowledgeEntry): KnowledgeEntry {
    assertKnowledgeEntry(a);
    assertKnowledgeEntry(b);

    const confidenceA = confidenceOf(a);
    const confidenceB = confidenceOf(b);
    const higher = confidenceA >= confidenceB ? a : b;

    const content = Consolidator.fuseContents(a.content, b.content);
    const tokens = tokenize(content);
    const confidence = higher.confidence;
    const metadata = Consolidator.mergeMetadata(a, b, higher);

    return {
      id: a.id,
      content,
      tokens,
      timestamp: Math.max(a.timestamp, b.timestamp),
      ...(confidence !== undefined ? { confidence: clampScore(confidence) } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(a.source !== undefined ? { source: a.source } : {}),
    };
  }

  /**
   * Normalizes an entry into its canonical form.
   *
   * Content whitespace is collapsed, tokens are re-derived (or the provided
   * tokens normalized and deduplicated), and the entry is validated end to
   * end.  Consolidation always stores canonicalized entries so the registry
   * holds a consistent shape regardless of how callers constructed inputs.
   */
  canonicalize(entry: KnowledgeEntry): KnowledgeEntry {
    assertKnowledgeEntry(entry);
    const content = Consolidator.normalizeWhitespace(entry.content);
    const tokens = entryTokens(entry);
    const out: KnowledgeEntry = {
      id: entry.id,
      content,
      tokens,
      timestamp: entry.timestamp,
      ...(entry.source !== undefined ? { source: entry.source } : {}),
      ...(entry.confidence !== undefined ? { confidence: clampScore(entry.confidence) } : {}),
      ...(entry.metadata !== undefined ? { metadata: { ...entry.metadata } } : {}),
    };
    assertKnowledgeEntry(out);
    return out;
  }

  /**
   * Decides what the consolidator would do with a pair of entries, without
   * mutating anything.
   *
   * This is the preview API for consumers that want to explain or simulate
   * consolidation before committing to it (review UIs, dry-run pipelines,
   * unit tests).  The returned {@link MergeDecision} mirrors exactly what
   * {@link consolidate} would perform internally for the same effective
   * options.
   */
  decide(a: KnowledgeEntry, b: KnowledgeEntry, options?: IntegrateOptions): MergeDecision {
    const effective = mergeIntegrateOptions(this.config, options);
    const similarity = this.similarity(a, b);

    const lower = compareEntryQuality(a, b) > 0 ? a : b;
    const primary = lower === a ? b.id : a.id;
    const secondary = lower === a ? a.id : b.id;

    if (similarity >= effective.conflictMinSimilarity) {
      const reason = this.contradictionReason(a, b);
      if (reason !== null) {
        return createMergeDecision({
          kind: effective.mergeConflicts ? 'merge' : 'conflict',
          primary,
          secondary,
          similarity,
          reason,
        });
      }
    }
    if (similarity >= effective.dedupeThreshold) {
      return createMergeDecision({
        kind: 'dedupe',
        primary,
        secondary,
        similarity,
        reason: `near-duplicate (similarity ${similarity.toFixed(3)} >= ${effective.dedupeThreshold})`,
      });
    }
    if (similarity >= effective.mergeThreshold) {
      return createMergeDecision({
        kind: 'merge',
        primary,
        secondary,
        similarity,
        reason: `compatible overlap (similarity ${similarity.toFixed(3)} >= ${effective.mergeThreshold})`,
      });
    }
    return createMergeDecision({
      kind: 'keep',
      primary,
      similarity,
      reason: `below merge threshold (similarity ${similarity.toFixed(3)} < ${effective.mergeThreshold})`,
    });
  }

  /**
   * A convenience one-shot consolidation helper for callers that do not want
   * to construct and hold a {@link Consolidator}.  Equivalent to
   * `new Consolidator(config).consolidate(entries, options)`.
   */
  static quick(
    entries: readonly KnowledgeEntry[],
    config?: IntegrateConfig,
    options?: IntegrateOptions,
  ): ConsolidationResult {
    return new Consolidator(config).consolidate(entries, options);
  }

  /**
   * Returns `true` when `value` is a valid {@link KnowledgeEntry}, exported
   * for consumers that want to guard input without importing the types module.
   */
  static isEntry(value: unknown): value is KnowledgeEntry {
    return isKnowledgeEntry(value);
  }

  /**
   * Collapses runs of whitespace and trims a piece of content.
   */
  private static normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Joins two contents into one canonical string, dropping the second when it
   * is a verbatim repeat of the first (case- and whitespace-insensitive).
   */
  private static fuseContents(a: string, b: string): string {
    const normalizedA = Consolidator.normalizeWhitespace(a);
    const normalizedB = Consolidator.normalizeWhitespace(b);
    if (normalizedA.toLowerCase() === normalizedB.toLowerCase()) return normalizedA;
    return `${normalizedA} ${normalizedB}`;
  }

  /**
   * Unions two metadata records, preferring the higher-confidence
   * contributor's value on key collisions, and appends the merge provenance
   * (`mergedFrom` and `mergedSources`).
   */
  private static mergeMetadata(
    a: KnowledgeEntry,
    b: KnowledgeEntry,
    higher: KnowledgeEntry,
  ): Record<string, unknown> | undefined {
    const hasA = hasOwn(a, 'metadata') && a.metadata !== undefined;
    const hasB = hasOwn(b, 'metadata') && b.metadata !== undefined;
    const lower = higher === a ? b : a;
    const hasLower = hasOwn(lower, 'metadata') && lower.metadata !== undefined;

    const out: Record<string, unknown> = {};
    if (hasA && a.metadata !== undefined) Object.assign(out, a.metadata);
    if (hasB && b.metadata !== undefined) {
      for (const key of Object.keys(b.metadata)) {
        if (!hasOwn(out, key)) out[key] = b.metadata[key];
      }
    }
    if (hasLower && lower.metadata !== undefined && hasOwn(lower.metadata, 'mergedFrom')) {
      out.mergedFrom = lower.metadata.mergedFrom;
    }

    const mergedFrom = Consolidator.mergeProvenance(
      hasA && a.metadata !== undefined ? a.metadata.mergedFrom : undefined,
      hasB && b.metadata !== undefined ? b.metadata.mergedFrom : undefined,
    );
    mergedFrom.push(a.id, b.id);
    out.mergedFrom = [...new Set(mergedFrom)];

    const mergedSources = Consolidator.mergeProvenance(
      hasA && a.metadata !== undefined ? a.metadata.mergedSources : undefined,
      hasB && b.metadata !== undefined ? b.metadata.mergedSources : undefined,
    );
    if (a.source !== undefined) mergedSources.push(a.source);
    if (b.source !== undefined) mergedSources.push(b.source);
    if (mergedSources.length > 0) out.mergedSources = [...new Set(mergedSources)];

    return out;
  }

  /**
   * Returns the provenance array from a metadata value (guarded), or an empty
   * array when the value is absent or not an array of strings.
   */
  private static mergeProvenance(a: unknown, b: unknown): string[] {
    const out: string[] = [];
    for (const value of [a, b]) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string' && entry.length > 0) out.push(entry);
        }
      }
    }
    return out;
  }
}