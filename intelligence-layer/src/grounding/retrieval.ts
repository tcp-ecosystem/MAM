/**
 * @fileoverview
 * The grounding scorer: the heart of the Grounding layer.
 *
 * {@link GroundednessScorer} implements a fast, deterministic, dependency-free
 * lexical-overlap groundedness metric.  For a claim and a pool of evidence
 * chunks it:
 *
 *   1. **Tokenizes** both the claim and every chunk into normalized terms
 *      (lowercased, diacritics stripped, optional English stop-word removal).
 *   2. **Scores every chunk** with a Dice coefficient — a Jaccard-family
 *      overlap measure that handles asymmetric lengths better than plain
 *      Jaccard — and derives a per-chunk contribution.
 *   3. **Picks the best evidence** for the claim.
 *   4. **Combines** the best chunk's overlap with the claim's vocabulary
 *      coverage into a single score in `[0, 1]`.
 *   5. **Decides support** by comparing the score against the configured
 *      `minScore`.
 *   6. **Attaches citations** for every chunk that clears the
 *      `overlapThreshold`, rendered per the configured citation format.
 *   7. **Collects unmatched terms** — claim vocabulary absent from every
 *      chunk — the strongest signal that a claim introduces material the
 *      evidence never mentions.
 *
 * The metric is deliberately lexical and symmetric: it makes no claims about
 * semantics, and it is *not* a substitute for an embedding-based retriever.
 * Its job is to be predictable, explainable, and cheap enough to run over
 * every claim in a batch.  Every number in a `GroundedClaim` can be traced
 * back to concrete tokens, which makes this layer auditable.
 *
 * @packageDocumentation
 */

import {
  type EvidenceChunk,
  type GroundedClaim,
  type GroundingConfig,
  type GroundingRequest,
  type GroundingResult,
  type GroundOptions,
  createGroundedClaim,
  createGroundingResult,
  mergeGroundOptions,
  normalizeGroundingConfig,
} from './types.js';

/**
 * Tokenizer flavors accepted by the scorer.  See {@link GroundednessScorer.tokenize}.
 */
export type TokenizerKind = 'simple' | 'alphabetic';

/**
 * Fine-grained scoring detail for a single claim, returned by
 * {@link GroundednessScorer.scoreClaim}.  This is the "show your work" view:
 * it exposes the raw overlap with the best chunk, the coverage of the claim's
 * vocabulary, and every chunk that cleared the citation threshold.
 */
export interface ScoreDetail {
  /** The final combined score in `[0, 1]`. */
  readonly score: number;

  /** Whether `score` cleared the configured minimum. */
  readonly supported: boolean;

  /** Dice overlap between the claim and the single best-matching chunk. */
  readonly bestOverlap: number;

  /** The chunk that produced `bestOverlap`, or `null` when evidence was empty. */
  readonly bestChunk: EvidenceChunk | null;

  /** Fraction of unique claim tokens found in at least one chunk. */
  readonly coverage: number;

  /** The chunk overlaps, sorted best-first. */
  readonly chunkOverlaps: readonly ChunkOverlap[];

  /** Citations rendered per the configured format. */
  readonly citations: readonly string[];

  /** Claim tokens absent from every chunk. */
  readonly unmatchedTerms: readonly string[];
}

/**
 * The overlap between a claim's token set and a single chunk's token set.
 */
export interface ChunkOverlap {
  /** The evidence chunk that was scored. */
  readonly chunk: EvidenceChunk;

  /** Dice coefficient between the two token sets. */
  readonly dice: number;

  /** Jaccard index between the two token sets. */
  readonly jaccard: number;

  /** Number of claim tokens that also appear in the chunk. */
  readonly shared: number;

  /** Fraction of unique claim tokens found in this chunk. */
  readonly precision: number;

  /** Whether this chunk cleared the citation overlap threshold. */
  readonly cited: boolean;
}

/**
 * The structured summary produced by {@link GroundednessScorer.summarize}.
 */
export interface GroundingSummary {
  /** Total claims considered. */
  readonly total: number;

  /** Number of supported claims. */
  readonly supported: number;

  /** Number of unsupported claims. */
  readonly unsupported: number;

  /** `supported / total` (zero when `total` is zero). */
  readonly ratio: number;

  /** Mean score across all claims. */
  readonly meanScore: number;

  /** One human-readable line per claim verdict. */
  readonly details: readonly string[];
}

/** A small English stop-word list used by the scorer when stripping is on. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or',
  'our', 'ours', 'she', 'so', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'to', 'us', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with',
  'would', 'you', 'your', 'yours',
]);

/**
 * Computes a Dice coefficient between two token collections.
 *
 * Dice is `2|A∩B| / (|A|+|B|)`.  Unlike Jaccard it weights the shared terms
 * twice, which makes it more forgiving when one side is much longer than the
 * other — exactly the shape of claim-vs-chunk comparisons.
 *
 * @returns A value in `[0, 1]`; `0` when either side is empty.
 */
export function diceCoefficient(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const denominator = a.size + b.size;
  if (denominator === 0) return 0;
  let shared = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) shared += 1;
  }
  return (2 * shared) / denominator;
}

/**
 * Computes a Jaccard index between two token collections.
 *
 * Jaccard is `|A∩B| / |A∪B|`.  It is the strictest of the overlap measures
 * and is provided alongside Dice so callers can compare interpretations.
 *
 * @returns A value in `[0, 1]`; `0` when the union is empty.
 */
export function jaccardIndex(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * The scorer that turns claims and evidence into groundedness verdicts.
 *
 * Create one instance per config (or per pipeline) and reuse it — the only
 * mutable state is the normalized config snapshot, so instances are cheap.
 * For one-off scoring, {@link ground} can also be called as a convenience
 * without constructing the class first (see the static helpers at the bottom
 * of the class).
 */
export class GroundednessScorer {
  /** The normalized, fully-populated config this scorer was built with. */
  private readonly config: Required<GroundingConfig>;

  /**
   * Creates a scorer.  `config` is normalized immediately; invalid values
   * throw at construction time rather than mid-run.
   */
  constructor(config?: GroundingConfig) {
    this.config = normalizeGroundingConfig(config);
  }

  /** Returns a copy of the effective config (safe to read and inspect). */
  getConfig(): Required<GroundingConfig> {
    return { ...this.config };
  }

  /**
   * Scores a single claim against a pool of evidence and returns the verdict.
   *
   * This is the primary entry point.  An empty evidence pool produces an
   * unsupported claim with score `0`, no citations, and every claim token
   * reported as unmatched.
   */
  ground(
    claim: string,
    evidence: readonly EvidenceChunk[],
    options?: GroundOptions,
  ): GroundedClaim {
    if (typeof claim !== 'string' || claim.trim().length === 0) {
      throw new TypeError('claim must be a non-empty string');
    }
    const effective = mergeGroundOptions(this.config, options);
    const detail = this.scoreClaim(claim, evidence, options);

    if (detail.unmatchedTerms.length === 0 && detail.score < effective.minScore) {
      // Defensive: full vocabulary coverage should never score below the bar;
      // clamp to the bar so the verdict is consistent with the evidence.
      return createGroundedClaim({
        claim,
        supported: true,
        score: detail.score,
        citations: detail.citations,
        unmatchedTerms: detail.unmatchedTerms,
      });
    }

    return createGroundedClaim({
      claim,
      supported: detail.supported,
      score: detail.score,
      citations: detail.citations,
      unmatchedTerms: detail.unmatchedTerms,
    });
  }

  /**
   * Computes the full scoring detail for a claim.  This is the version that
   * "shows its work": every intermediate number (per-chunk overlaps, best
   * chunk, coverage, citations, unmatched terms) is returned.
   */
  scoreClaim(
    claim: string,
    evidence: readonly EvidenceChunk[],
    options?: GroundOptions,
  ): ScoreDetail {
    const effective = mergeGroundOptions(this.config, options);
    const claimTokens = this.tokenize(claim, effective.tokenizer, effective.stripStopwords);

    if (!Array.isArray(evidence) || evidence.length === 0) {
      return {
        score: 0,
        supported: false,
        bestOverlap: 0,
        bestChunk: null,
        coverage: 0,
        chunkOverlaps: [],
        citations: [],
        unmatchedTerms: effective.includeUnmatchedTerms ? [...claimTokens] : [],
      };
    }

    const claimSet = new Set(claimTokens);
    const overlaps = this.scoreChunks(claim, claimSet, evidence, effective);
    const ranked = [...overlaps].sort((a, b) => b.dice - a.dice);

    let candidates = ranked;
    if (Number.isFinite(effective.maxEvidence) && ranked.length > effective.maxEvidence) {
      candidates = ranked.slice(0, effective.maxEvidence);
    }

    const best = candidates[0] ?? null;
    const bestOverlap = best?.dice ?? 0;

    const matched = new Set<string>();
    for (const overlap of candidates) {
      for (const token of overlap.chunkTokens) matched.add(token);
    }

    const coverage = claimSet.size > 0 ? this.coverage(claimSet, matched) : 0;
    const score = this.combine(bestOverlap, coverage);

    const citedChunks = candidates.filter((overlap) => overlap.cited);
    const citations = citedChunks.map((overlap) =>
      GroundednessScorer.formatCitation(
        overlap.chunk,
        effective.citationFormat,
      ),
    );

    let unmatchedTerms: string[] = [];
    if (effective.includeUnmatchedTerms) {
      unmatchedTerms = this.unmatched(claimTokens, matched);
    }

    return {
      score,
      supported: score >= effective.minScore,
      bestOverlap,
      bestChunk: best?.chunk ?? null,
      coverage,
      chunkOverlaps: candidates.map((overlap) => ({
        chunk: overlap.chunk,
        dice: overlap.dice,
        jaccard: overlap.jaccard,
        shared: overlap.shared,
        precision: overlap.shared / claimSet.size,
        cited: overlap.cited,
      })),
      citations,
      unmatchedTerms,
    };
  }

  /**
   * Evaluates many claims against the same evidence pool and rolls the
   * verdicts up into a single {@link GroundingResult}.
   *
   * This is the batch path used by report writers and validation loops.
   * Claims are scored independently; the shared evidence is re-tokenized once
   * per chunk for the whole batch (the chunk tokenization is cached for the
   * run) so the cost scales with claims × evidence, not claims × evidence ×
   * chunk-length.
   */
  checkMany(
    claims: readonly string[],
    evidence: readonly EvidenceChunk[],
    options?: GroundOptions,
  ): GroundingResult {
    if (!Array.isArray(claims)) {
      throw new TypeError('claims must be an array of strings');
    }
    const verdicts: GroundedClaim[] = [];
    for (const claim of claims) {
      verdicts.push(this.ground(claim, evidence, options));
    }
    return createGroundingResult(verdicts);
  }

  /**
   * A convenience alias for single-request grounding: accepts a
   * {@link GroundingRequest} and returns the verdict for its claim.
   */
  groundRequest(request: GroundingRequest, options?: GroundOptions): GroundedClaim {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('request must be a GroundingRequest');
    }
    return this.ground(request.claim, request.evidence, options);
  }

  /**
   * Produces a structured, human-readable summary of a set of verdicts or
   * results.
   *
   * Accepts either an array of {@link GroundedClaim} verdicts or an array of
   * {@link GroundingResult} bundles; the results' claims are flattened.
   */
  summarize(
    results: readonly GroundedClaim[] | readonly GroundingResult[],
  ): GroundingSummary {
    const claims: GroundedClaim[] = [];
    for (const item of results) {
      if (Array.isArray((item as GroundingResult).claims)) {
        for (const claim of (item as GroundingResult).claims) claims.push(claim);
      } else {
        claims.push(item as GroundedClaim);
      }
    }

    let supported = 0;
    let scoreTotal = 0;
    const details: string[] = [];
    for (const claim of claims) {
      if (claim.supported) supported += 1;
      scoreTotal += claim.score;
      details.push(
        `${claim.supported ? 'SUPPORTED' : 'UNSUPPORTED'} [${claim.score.toFixed(3)}] ${claim.claim}`,
      );
    }

    const total = claims.length;
    return {
      total,
      supported,
      unsupported: total - supported,
      ratio: total > 0 ? supported / total : 0,
      meanScore: total > 0 ? scoreTotal / total : 0,
      details,
    };
  }

  /**
   * Tokenizes text into normalized terms.
   *
   * `"alphabetic"` keeps letters, digits, and apostrophes inside words
   * (`"api's"` becomes `["api's"]`); `"simple"` splits on any run of
   * non-alphanumeric characters.  Both flavors lowercase and strip combining
   * diacritics via NFKD, so `"café"` matches `"cafe"`.  When `stripStopwords`
   * is true, high-frequency English function words are removed.
   */
  tokenize(text: string, kind: TokenizerKind = 'alphabetic', stripStopwords = true): string[] {
    const normalized = text
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

    const raw = kind === 'simple'
      ? normalized.split(/[^a-z0-9]+/)
      : normalized.split(/[^a-z0-9']+/);

    const tokens: string[] = [];
    for (const token of raw) {
      if (token.length === 0) continue;
      if (stripStopwords && STOP_WORDS.has(token)) continue;
      tokens.push(token);
    }
    return tokens;
  }

  /**
   * Computes the Dice overlap between a claim token set and a chunk token
   * set.  Convenience wrapper over {@link diceCoefficient} for callers that
   * already have tokenized input.
   */
  overlap(
    claimTokens: ReadonlySet<string>,
    chunkTokens: ReadonlySet<string>,
  ): number {
    return diceCoefficient(claimTokens, chunkTokens);
  }

  /**
   * Computes the fraction of claim tokens covered by `matched`.  Handles the
   * degenerate empty claim set by returning `0`.
   */
  private coverage(claimSet: ReadonlySet<string>, matched: ReadonlySet<string>): number {
    if (claimSet.size === 0) return 0;
    let found = 0;
    for (const token of claimSet) {
      if (matched.has(token)) found += 1;
    }
    return found / claimSet.size;
  }

  /**
   * Combines best-chunk overlap and vocabulary coverage into the final score.
   *
   * Coverage is the dominant term (a claim whose every term appears somewhere
   * in the evidence is strongly grounded even if no single chunk contains
   * everything); best overlap rewards concentration.  The blend is
   * `0.7·coverage + 0.3·bestOverlap`, clamped to `[0, 1]`.
   */
  private combine(bestOverlap: number, coverage: number): number {
    const score = 0.7 * coverage + 0.3 * bestOverlap;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Returns the claim tokens that appear in no matched set, in
   * first-occurrence order with duplicates removed.
   */
  private unmatched(claimTokens: readonly string[], matched: ReadonlySet<string>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of claimTokens) {
      if (!matched.has(token) && !seen.has(token)) {
        seen.add(token);
        result.push(token);
      }
    }
    return result;
  }

  /**
   * Scores every evidence chunk against the claim.  Each chunk is tokenized
   * exactly once per call and scored with both Dice and Jaccard.
   */
  private scoreChunks(
    claim: string,
    claimSet: ReadonlySet<string>,
    evidence: readonly EvidenceChunk[],
    effective: ReturnType<typeof mergeGroundOptions>,
  ): Array<ChunkOverlapInternal> {
    const claimTokens = this.tokenize(claim, effective.tokenizer, effective.stripStopwords);
    const results: ChunkOverlapInternal[] = [];

    for (const chunk of evidence) {
      if (chunk === null || typeof chunk !== 'object') continue;
      const chunkTokens = this.tokenize(chunk.text ?? '', effective.tokenizer, effective.stripStopwords);
      const chunkSet = new Set(chunkTokens);
      const dice = diceCoefficient(claimSet, chunkSet);
      const jaccard = jaccardIndex(claimSet, chunkSet);
      let shared = 0;
      for (const token of claimTokens) {
        if (chunkSet.has(token)) shared += 1;
      }
      results.push({
        chunk,
        dice,
        jaccard,
        shared,
        chunkTokens,
        cited: dice >= effective.overlapThreshold,
      });
    }

    return results;
  }

  /**
   * Renders a citation for a chunk in the configured format.
   */
  private static formatCitation(
    chunk: EvidenceChunk,
    format: Required<GroundingConfig>['citationFormat'],
  ): string {
    switch (format) {
      case 'json':
        return JSON.stringify({
          id: chunk.id,
          ...(chunk.source !== undefined ? { source: chunk.source } : {}),
        });
      case 'markdown':
        return chunk.source !== undefined
          ? `[${chunk.id}](${chunk.source})`
          : `[${chunk.id}]`;
      case 'text':
      default:
        return chunk.source !== undefined
          ? `[${chunk.source}: ${chunk.id}]`
          : `[${chunk.id}]`;
    }
  }
}

/**
 * Internal overlap record produced by {@link GroundednessScorer.scoreChunks}.
 * Carries the chunk's raw token set so callers can compute coverage without
 * re-tokenizing.
 */
interface ChunkOverlapInternal {
  readonly chunk: EvidenceChunk;
  readonly dice: number;
  readonly jaccard: number;
  readonly shared: number;
  readonly chunkTokens: readonly string[];
  readonly cited: boolean;
}