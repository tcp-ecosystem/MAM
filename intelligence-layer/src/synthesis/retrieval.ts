/**
 * @fileoverview
 * The answer synthesizer: the heart of the Answer synthesis layer.
 *
 * {@link AnswerSynthesizer} implements a deterministic, dependency-free,
 * extractive assembly pipeline.  Given a query and a pool of evidence parts
 * it:
 *
 *   1. **Ranks evidence.**  Each evidence part is scored as a blend of the
 *      retriever's explicit `score` (when present) and a lexical overlap with
 *      the query.  Parts below the configured `minScore` are dropped, and the
 *      rest are capped to `maxEvidence`.
 *   2. **Extracts sentences.**  Every surviving part is split into sentences
 *      with an abbreviation-aware splitter
 *      ({@link AnswerSynthesizer.extractSentences}) so "Dr. Smith" and
 *      "e.g. 3.14" are not mangled.
 *   3. **Scores sentences.**  Each sentence is scored against the query by
 *      term overlap ({@link AnswerSynthesizer.scoreSentences}); the best
 *      `maxSentencesPerPart` sentences from each part are kept.
 *   4. **Dedupes.**  Near-duplicate sentences (sentences that overlap heavily
 *      with an already-selected sentence) are removed
 *      ({@link AnswerSynthesizer.dedupeSentences}).
 *   5. **Fuses.**  The surviving sentences are grouped into coherent
 *      paragraphs, joined with light transitions
 *      ({@link AnswerSynthesizer.fuse}).
 *   6. **Confidence.**  The answer-level confidence is the weighted mean of
 *      the evidence scores that actually contributed sentences.
 *   7. **Citations.**  Each contributing evidence part is rendered as a
 *      citation string and attached to the answer.
 *
 * The pipeline is deliberately lexical and deterministic: it makes no claims
 * about semantics and is not a substitute for an LLM.  Its job is to be
 * predictable, explainable, and cheap enough to run for every chat turn.  A
 * grounded, well-attributed answer that surfaces the exact sentences the
 * evidence supports is almost always safer than a fluent paraphrase.
 *
 * @packageDocumentation
 */

import {
  type Answer,
  type AnswerRequest,
  type EffectiveSynthesisOptions,
  type EvidencePart,
  type SentenceScore,
  type SynthesisConfig,
  type SynthesisPart,
  type SynthesizeOptions,
  assertAnswerRequest,
  createAnswer,
  createSynthesisPart,
  mergeSynthesizeOptions,
  normalizeSynthesisConfig,
} from './types.js';

/**
 * A small English stop-word list used by the sentence scorer when stripping
 * high-frequency function words.  Keeping the list compact preserves recall
 * for short queries while removing the words that carry the least signal.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
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
 * Abbreviations whose terminal period must survive sentence splitting.  Each
 * entry is matched case-insensitively at a word boundary; the period is
 * protected with a sentinel character and restored after the split.
 */
export const ABBREVIATIONS: ReadonlyArray<{ readonly abbr: string; readonly trailing?: string }> = [
  { abbr: 'dr' }, { abbr: 'mr' }, { abbr: 'mrs' }, { abbr: 'ms' },
  { abbr: 'prof' }, { abbr: 'sr' }, { abbr: 'jr' }, { abbr: 'st' },
  { abbr: 'mt' }, { abbr: 'fig' }, { abbr: 'vol' }, { abbr: 'pp' },
  { abbr: 'no' }, { abbr: 'vs' }, { abbr: 'etc' }, { abbr: 'inc' },
  { abbr: 'corp' }, { abbr: 'ltd' }, { abbr: 'co' }, { abbr: 'dept' },
  { abbr: 'est' }, { abbr: 'approx' }, { abbr: 'e.g' }, { abbr: 'i.e' },
  { abbr: 'c.f' }, { abbr: 'et al' }, { abbr: 'ph.d' }, { abbr: 'm.d' },
];

/** Light transitions applied to non-first paragraphs during fusion. */
export const PARAGRAPH_TRANSITIONS: readonly string[] = [
  'Additionally,',
  'Furthermore,',
  'In addition,',
  'Moreover,',
  'Beyond that,',
];

/**
 * The result of fusing parts into prose: the joined text plus the (possibly
 * lightly rewritten) parts in their final order.
 */
export interface FuseResult {
  /** The fused, human-facing prose. */
  readonly text: string;
  /** The parts in their final assembly order, after dedup and rewriting. */
  readonly parts: readonly SynthesisPart[];
}

/**
 * An evidence part together with its blended relevance score, produced by
 * {@link AnswerSynthesizer.rankEvidence}.
 */
export interface RankedEvidence {
  /** The evidence part. */
  readonly part: EvidencePart;
  /** The blended score in `[0, 1]`. */
  readonly score: number;
  /** The lexical query-overlap component in `[0, 1]`. */
  readonly overlap: number;
  /** The explicit retriever score component in `[0, 1]`. */
  readonly explicit: number;
}

/**
 * The structured detail of a single synthesis run, returned by
 * {@link AnswerSynthesizer.synthesizeDetailed}.  This is the "show your work"
 * view: every intermediate stage (ranked evidence, per-evidence selected
 * sentences, dedup counts, fusion) is exposed for audit and debugging.
 */
export interface SynthesisDetail {
  /** The final answer. */
  readonly answer: Answer;
  /** The evidence parts that cleared the score bar, best-first. */
  readonly ranked: readonly RankedEvidence[];
  /** The deduplicated sentence pool that survived assembly. */
  readonly sentences: readonly SentenceScore[];
  /** Number of candidate sentences before deduplication. */
  readonly candidatesBeforeDedupe: number;
  /** Number of sentences removed as near-duplicates. */
  readonly deduped: number;
  /** The fusion output before the final answer was built. */
  readonly fusion: FuseResult;
}

/**
 * The synthesizer that turns queries and evidence into answers.
 *
 * Create one instance per config (or per pipeline) and reuse it — the only
 * mutable state is the normalized config snapshot, so instances are cheap.
 * For one-off synthesis, {@link AnswerSynthesizer.synthesize} accepts a full
 * {@link AnswerRequest} and can also be used via the static helper
 * {@link AnswerSynthesizer.quick}.
 */
export class AnswerSynthesizer {
  /** The normalized, fully-populated config this synthesizer was built with. */
  private readonly config: Required<SynthesisConfig>;

  /**
   * Creates a synthesizer.  `config` is normalized immediately; invalid
   * values throw at construction time rather than mid-run.
   */
  constructor(config?: SynthesisConfig) {
    this.config = normalizeSynthesisConfig(config);
  }

  /** Returns a copy of the effective config (safe to read and inspect). */
  getConfig(): Required<SynthesisConfig> {
    return { ...this.config };
  }

  /**
   * Synthesizes an answer for a request.
   *
   * This is the primary entry point.  An empty evidence pool (or a pool in
   * which nothing clears the score bar) produces an ungrounded fallback
   * answer with confidence `0` and no parts.
   */
  synthesize(request: AnswerRequest, options?: SynthesizeOptions): Answer {
    return this.synthesizeDetailed(request, options).answer;
  }

  /**
   * Synthesizes an answer and returns the full pipeline detail alongside it.
   *
   * Useful for audit trails, debugging, and for consumers that want to render
   * "why this answer" panels.  The returned `answer` is identical to what
   * {@link synthesize} returns for the same inputs.
   */
  synthesizeDetailed(request: AnswerRequest, options?: SynthesizeOptions): SynthesisDetail {
    assertAnswerRequest(request);
    if (request.query.length > 5000) {
      throw new RangeError('request.query is too long; keep queries under 5000 characters');
    }
    const effective = mergeSynthesizeOptions(this.config, options);

    const ranked = this.rankEvidence(request.evidence, request.query)
      .filter((entry) => entry.score >= effective.minScore)
      .slice(0, effective.maxEvidence);

    // Stage 1: extract and score sentences per surviving evidence part.
    const queryTokens = this.tokenize(request.query, true);
    const candidates: SentenceScore[] = [];
    for (const entry of ranked) {
      const sentences = this.extractSentences(entry.part.text);
      const scored = this.scoreSentences(sentences, queryTokens);
      const kept = scored.slice(0, effective.maxSentencesPerPart);
      for (const sentence of kept) {
        candidates.push({
          ...sentence,
          evidenceId: entry.part.id,
          source: entry.part.source,
        });
      }
    }

    // Stage 2: dedupe near-duplicate sentences across all evidence.
    const candidatesBeforeDedupe = candidates.length;
    let deduped = 0;
    let pool: SentenceScore[] = candidates;
    if (effective.dedupeSentences && candidates.length > 1) {
      pool = this.dedupeSentences(candidates, effective.dedupeThreshold);
      deduped = candidatesBeforeDedupe - pool.length;
    }

    // Stage 3: budget the assembled sentences against the length cap.
    const selected = this.budgetSentences(pool, effective.maxLength);
    if (selected.length === 0) {
      const fallback = createAnswer({
        text: `No evidence above the minimum score (${effective.minScore.toFixed(2)}) was available for "${request.query}".`,
        confidence: 0,
        model: effective.model,
        grounded: false,
      });
      return {
        answer: fallback,
        ranked,
        sentences: [],
        candidatesBeforeDedupe,
        deduped,
        fusion: { text: fallback.text, parts: [] },
      };
    }

    // Stage 4: fuse selected sentences into coherent, cited parts.
    const parts = this.buildParts(selected, effective);
    const fusion = this.fuse(parts);

    // Stage 5: confidence as a weighted mean of contributing evidence scores.
    const confidence = this.computeConfidence(ranked, selected);
    const citations = this.collectCitations(fusion.parts);
    const answer = this.buildAnswer(
      fusion.text,
      fusion.parts,
      citations,
      confidence,
      effective.model,
      confidence >= effective.minScore,
    );

    return {
      answer,
      ranked,
      sentences: selected,
      candidatesBeforeDedupe,
      deduped,
      fusion,
    };
  }

  /**
   * Splits text into sentences without breaking on common abbreviations or
   * decimal points.
   *
   * The splitter has two phases:
   *   1. **Protection.**  Known abbreviations (Dr., e.g., etc., ...) and
   *      decimal numbers have their periods replaced with a sentinel
   *      character so the boundary matcher does not see them.
   *   2. **Boundary split.**  The protected text is split after every
   *      `.`/`!`/`?` that is followed by whitespace (or the end of the text),
   *      the sentinel is restored, and stray whitespace is trimmed.
   *
   * The result is a list of non-empty sentences; text with no terminal
   * punctuation is returned as a single sentence.
   */
  extractSentences(text: string): string[] {
    if (typeof text !== 'string') return [];
    const normalized = text.normalize('NFKD').trim();
    if (normalized.length === 0) return [];

    // Protect abbreviation periods (including "et al." which spans two words).
    let protectedText = normalized;
    for (const { abbr } of ABBREVIATIONS) {
      const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      protectedText = protectedText.replace(
        new RegExp(`\\b${escaped}\\.`, 'gi'),
        (match) => match.replace(/\./g, '\u0001'),
      );
    }
    // Protect decimal numbers like 3.14.
    protectedText = protectedText.replace(
      /\b(\d+)\.(\d+)\b/g,
      (_match, whole: string, frac: string) => `${whole}\u0001${frac}`,
    );

    // Split after each terminal punctuation followed by whitespace or EOS.
    const rawSegments = protectedText.split(/(?<=[.!?])(?:\s+|$)/);

    const sentences: string[] = [];
    for (const segment of rawSegments) {
      const restored = segment.replace(/\u0001/g, '.').trim();
      if (restored.length > 0) sentences.push(restored);
    }
    return sentences;
  }

  /**
   * Scores each sentence against the query by term overlap.
   *
   * `queryTokens` may be either the raw query string or a pre-tokenized term
   * list.  Each sentence receives a Dice-like score
   * `2·|shared| / (|query| + |sentence|)` over normalized terms, plus the list
   * of query terms it actually contained.  Results are sorted best-first so
   * callers can slice the top-N directly.
   */
  scoreSentences(
    sentences: readonly string[],
    queryTokens: readonly string[] | string,
  ): SentenceScore[] {
    const tokens: readonly string[] = typeof queryTokens === 'string'
      ? this.tokenize(queryTokens, true)
      : queryTokens;
    const querySet = new Set(tokens);
    const total = querySet.size + tokens.length;

    const scored: SentenceScore[] = [];
    for (const sentence of sentences) {
      const sentenceTokens = this.tokenize(sentence, true);
      const sentenceSet = new Set(sentenceTokens);
      const matched: string[] = [];
      for (const token of sentenceSet) {
        if (querySet.has(token)) matched.push(token);
      }
      const denominator = querySet.size + sentenceSet.size;
      const score = denominator === 0
        ? 0
        : (2 * matched.length) / denominator;
      scored.push({
        sentence,
        score: Math.max(0, Math.min(1, score)),
        evidenceId: '',
        terms: matched,
      });
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  /**
   * Removes near-duplicate sentences from a scored pool.
   *
   * Two sentences are considered duplicates when their token-set similarity
   * (Jaccard) is at or above `threshold`.  The pool is walked in order and
   * each sentence is kept only if it is not a duplicate of any already-kept
   * sentence, so earlier (higher-scored) sentences win ties.  Duplicates are
   * *not* merged — they are dropped, which is the right behaviour when the
   * same fact appears verbatim in several evidence parts.
   */
  dedupeSentences(sentences: readonly SentenceScore[], threshold = 0.6): SentenceScore[] {
    const kept: SentenceScore[] = [];
    const keptTokenSets: ReadonlySet<string>[] = [];

    for (const entry of sentences) {
      const tokens = this.tokenSet(entry.sentence);
      let duplicate = false;
      for (const prior of keptTokenSets) {
        if (this.jaccard(tokens, prior) >= threshold) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        kept.push(entry);
        keptTokenSets.push(tokens);
      }
    }
    return kept;
  }

  /**
   * Fuses parts into coherent, attributed prose.
   *
   * Parts whose text is textually identical are de-duplicated (keeping the
   * first).  The survivors are grouped into paragraphs by source, so sentences
   * from the same document stay together and readers can follow the
   * provenance.  Non-first paragraphs are prefixed with a light transition
   * word so the answer reads as connected prose rather than a bullet list.
   *
   * The returned text joins each paragraph's sentences with a single space
   * and separates paragraphs with a blank line.  The returned parts mirror
   * the final order (with any transition prefix folded into the first part of
   * each non-first paragraph).
   */
  fuse(parts: readonly SynthesisPart[]): FuseResult {
    const unique = this.dedupeParts(parts);
    const paragraphs: SynthesisPart[][] = [];
    for (const part of unique) {
      const current = paragraphs[paragraphs.length - 1];
      if (current !== undefined && current[0]?.source === part.source) {
        current.push(part);
      } else {
        paragraphs.push([part]);
      }
    }

    const finalParts: SynthesisPart[] = [];
    const blocks: string[] = [];
    paragraphs.forEach((group, index) => {
      if (index > 0 && group[0] !== undefined) {
        const transition = PARAGRAPH_TRANSITIONS[index % PARAGRAPH_TRANSITIONS.length];
        const first = group[0];
        group[0] = { ...first, text: `${transition} ${first.text}` };
      }
      const sentenceTexts: string[] = [];
      for (const part of group) {
        finalParts.push(part);
        sentenceTexts.push(part.text);
      }
      blocks.push(sentenceTexts.join(' '));
    });

    return { text: blocks.join('\n\n'), parts: finalParts };
  }

  /**
   * Constructs a fully-valid {@link Answer} from its parts.
   *
   * `confidence` is clamped to `[0, 1]`.  When `grounded` is omitted it is
   * derived by comparing `confidence` against the configured `minScore`.  This
   * is the standard factory used at the end of {@link synthesizeDetailed}.
   */
  buildAnswer(
    text: string,
    parts: readonly SynthesisPart[],
    citations: readonly string[],
    confidence: number,
    model?: string,
    grounded?: boolean,
  ): Answer {
    return createAnswer({
      text,
      parts,
      citations,
      confidence,
      ...(model !== undefined ? { model } : {}),
      ...(grounded !== undefined ? { grounded } : {}),
    });
  }

  /**
   * Ranks evidence parts by a blend of explicit retriever score and lexical
   * query overlap, best-first.
   *
   * Each part's score is `0.6·overlap + 0.4·explicit`, where `overlap` is the
   * Dice coefficient between the query term set and the part's term set, and
   * `explicit` is the retriever's `score` (defaulting to a neutral `0.5` when
   * absent).  The blend lets a retriever with real relevance signals steer the
   * answer while guaranteeing that parts with no query overlap never ride
   * purely on a noisy explicit score.
   */
  rankEvidence(
    evidence: readonly EvidencePart[],
    query: string,
  ): RankedEvidence[] {
    const queryTokens = this.tokenSet(query);
    const querySize = queryTokens.size;
    const ranked: RankedEvidence[] = [];
    for (const part of evidence) {
      const partTokens = this.tokenSet(part.text);
      const denominator = querySize + partTokens.size;
      let shared = 0;
      for (const token of partTokens) {
        if (queryTokens.has(token)) shared += 1;
      }
      const overlap = denominator === 0 ? 0 : (2 * shared) / denominator;
      const explicit =
        typeof part.score === 'number' && Number.isFinite(part.score)
          ? Math.max(0, Math.min(1, part.score))
          : 0.5;
      const score = Math.max(0, Math.min(1, 0.6 * overlap + 0.4 * explicit));
      ranked.push({ part, score, overlap, explicit });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  /**
   * Tokenizes text into normalized terms.
   *
   * Text is lowercased, combining diacritics are stripped (so `"café"`
   * matches `"cafe"`), and terms are split on runs of non-alphanumeric
   * characters while apostrophes inside words are kept (`"api's"` stays one
   * term).  When `stripStopwords` is true, high-frequency English function
   * words are removed.
   */
  tokenize(text: string, stripStopwords = true): string[] {
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
    }
    return tokens;
  }

  /**
   * Computes the Jaccard similarity between two token sets.
   *
   * Jaccard is `|A∩B| / |A∪B|`; it returns `0` when both sets are empty.
   * This is the similarity measure used by {@link dedupeSentences}.
   */
  jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let shared = 0;
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of smaller) {
      if (larger.has(token)) shared += 1;
    }
    return shared / (a.size + b.size - shared);
  }

  /**
   * A convenience one-shot synthesis helper for callers that do not want to
   * construct and hold an {@link AnswerSynthesizer}.  Equivalent to
   * `new AnswerSynthesizer(config).synthesize(request, options)`.
   */
  static quick(
    request: AnswerRequest,
    config?: SynthesisConfig,
    options?: SynthesizeOptions,
  ): Answer {
    return new AnswerSynthesizer(config).synthesize(request, options);
  }

  /**
   * Greedily fits the highest-scoring sentences into the length budget.
   *
   * Sentences are consumed in their (already rank-ordered) pool order.  A
   * sentence is added when it fits within the remaining budget; the scan stops
   * at the first sentence that would overflow.  The sole exception is an empty
   * selection facing a single oversized sentence, which is included truncated
   * so a good answer is never lost purely to its length.
   */
  private budgetSentences(pool: readonly SentenceScore[], maxLength: number): SentenceScore[] {
    const selected: SentenceScore[] = [];
    let remaining = maxLength;
    for (const entry of pool) {
      const cost = entry.sentence.length + 2;
      if (cost > remaining) {
        if (selected.length === 0) {
          selected.push({
            ...entry,
            sentence: entry.sentence.slice(0, Math.max(0, remaining)).trim(),
          });
        }
        break;
      }
      selected.push(entry);
      remaining -= cost;
    }
    return selected;
  }

  /**
   * Converts scored sentences into {@link SynthesisPart}s, attaching the
   * rendered citation when citations are enabled.
   */
  private buildParts(
    sentences: readonly SentenceScore[],
    effective: EffectiveSynthesisOptions,
  ): SynthesisPart[] {
    const parts: SynthesisPart[] = [];
    for (const entry of sentences) {
      const citation =
        effective.includeCitations && entry.evidenceId.length > 0
          ? AnswerSynthesizer.renderCitation(entry.evidenceId, entry.source)
          : undefined;
      parts.push(
        createSynthesisPart({
          id: entry.evidenceId,
          text: entry.sentence,
          source: entry.source,
          score: entry.score,
          ...(citation !== undefined ? { citation } : {}),
        }),
      );
    }
    return parts;
  }

  /**
   * Computes the answer-level confidence as a weighted mean of the evidence
   * scores that actually contributed sentences.
   *
   * Each contributing evidence part's blended score is weighted by how many
   * of the selected sentences it supplied, so a part that carried most of the
   * answer dominates the confidence.  When no sentence contributed, the
   * confidence is `0`.
   */
  private computeConfidence(
    ranked: readonly RankedEvidence[],
    selected: readonly SentenceScore[],
  ): number {
    const weightById = new Map<string, number>();
    for (const entry of selected) {
      weightById.set(entry.evidenceId, (weightById.get(entry.evidenceId) ?? 0) + 1);
    }
    let weighted = 0;
    let weightTotal = 0;
    for (const entry of ranked) {
      const weight = weightById.get(entry.part.id) ?? 0;
      if (weight <= 0) continue;
      weighted += entry.score * weight;
      weightTotal += weight;
    }
    if (weightTotal === 0) return 0;
    return Math.max(0, Math.min(1, weighted / weightTotal));
  }

  /**
   * Collects the de-duplicated, in-order citation set from a list of parts.
   */
  private collectCitations(parts: readonly SynthesisPart[]): string[] {
    const seen = new Set<string>();
    const citations: string[] = [];
    for (const part of parts) {
      const citation = part.citation ?? (part.id.length > 0 ? part.id : '');
      if (citation.length > 0 && !seen.has(citation)) {
        seen.add(citation);
        citations.push(citation);
      }
    }
    return citations;
  }

  /**
   * De-duplicates parts whose text is textually identical, keeping the first
   * occurrence.  Distinct sentences with the same text from different evidence
   * parts collapse to a single part (the first source wins the attribution).
   */
  private dedupeParts(parts: readonly SynthesisPart[]): SynthesisPart[] {
    const seen = new Set<string>();
    const unique: SynthesisPart[] = [];
    for (const part of parts) {
      const key = part.text.normalize('NFKD').toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(part);
    }
    return unique;
  }

  /** Returns the normalized, de-duplicated term set for a piece of text. */
  private tokenSet(text: string): Set<string> {
    return new Set(this.tokenize(text, true));
  }

  /** Renders a citation string for an evidence id and optional source. */
  private static renderCitation(id: string, source?: string): string {
    return source !== undefined && source.length > 0
      ? `[${source}: ${id}]`
      : `[${id}]`;
  }
}