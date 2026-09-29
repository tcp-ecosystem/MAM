/**
 * Deterministic summarization engine for the Summarization layer of the
 * standalone MAM Context Engine.
 *
 * {@link TextSummarizer} is the layer's **brain**. Where the store and index
 * merely hold and organise summaries, this class *produces* them — with
 * classical, reproducible heuristics and, deliberately, **no LLM in the loop**.
 * Every method is a pure function of its input: the same text fed to the same
 * summarizer yields the same summary, every time, which is what makes the rest
 * of the engine willing to cache and reuse the results.
 *
 * The core ranking model, shared by every technique, scores a sentence from
 * three signals:
 *
 * - **Frequency** — how often the sentence's (non-stopword) terms appear in
 *   the whole document. Frequent terms signal topical importance.
 * - **IDF-ish correction** — when a caller supplies a corpus of
 *   document-frequency statistics (via {@link TextSummarizerOptions
 *   .documentFrequencies} or {@link TextSummarizer.usingIdf}), a term that is
 *   frequent *in this document* but rare *in the corpus* is boosted; without a
 *   corpus the correction is neutral, so behaviour is pure frequency and fully
 *   deterministic.
 * - **Position** — earlier sentences get a gentle bonus, because lead
 *   sentences in well-written prose carry the topic.
 * - **Length** — sentences that are too short (under ~4 words) or too long
 *   (over ~60 words) are discounted.
 *
 * Scores are normalised to `[0, 1]` relative to the document's best sentence,
 * which makes {@link SummarizationConfig.minScore} a meaningful threshold.
 *
 * The class exposes one method per technique, plus the text-processing
 * primitives (`splitSentences`, `tokenize`, `normalize`) and the bookkeeping
 * (`stats`), so callers can either use the high-level
 * {@link TextSummarizer.summarize} dispatcher or drive a single technique
 * directly.
 *
 * @module summarization/retrieval
 */

import {
  clampLength,
  clampScore,
  createSummaryResult,
  mergeSummarizationConfig,
  resolveMaxSentences,
} from './types.js';
import type {
  KeyPoint,
  SummarizationConfig,
  SummarizeOptions,
  SummarizeTechnique,
  SummaryResult,
  Timestamp,
} from './types.js';

/**
 * A single sentence with its computed salience score.
 *
 * Scores are normalised to `[0, 1]` relative to the best sentence of the same
 * document, so a score of `1` means "this document's most salient sentence".
 */
export interface ScoredSentence {
  /**
   * The sentence text (trimmed).
   */
  readonly text: string;

  /**
   * The sentence's 0-based position in the original document.
   */
  readonly index: number;

  /**
   * The normalised salience score in `[0, 1]`.
   */
  readonly score: number;
}

/**
 * A single section's gist, produced by {@link TextSummarizer.sectionGists}.
 */
export interface SectionGist {
  /**
   * The 0-based index of the section (paragraph) within the source.
   */
  readonly sectionIndex: number;

  /**
   * An optional heading — a short single-line paragraph ending in `:` that
   * immediately precedes the section. `undefined` when the section had none.
   */
  readonly heading?: string;

  /**
   * The section's gist sentence (or the whole trimmed paragraph when the
   * section is a single sentence).
   */
  readonly summary: string;
}

/**
 * Options accepted by {@link TextSummarizer.rolling}.
 */
export interface RollingOptions {
  /**
   * Target maximum length in characters for the final digest. `0` (the
   * default) means "keep rolling until the digest stops shrinking".
   */
  readonly maxLength?: number;

  /**
   * Maximum number of shortening passes before giving up. Defaults to
   * {@link DEFAULT_MAX_STEPS} (`5`).
   */
  readonly maxSteps?: number;

  /**
   * Minimum length in characters below which a rolling pass refuses to keep
   * shortening (avoids shredding a small digest into fragments). Defaults to
   * `1`.
   */
  readonly minLength?: number;

  /**
   * Minimum sentence score (in `[0, 1]`) applied within each chunk's
   * extractive pass. Defaults to the configured `minScore`.
   */
  readonly minScore?: number;

  /**
   * When `false`, the produced summary is returned without an attached
   * {@link SummaryResult.keyPoints} list. Defaults to `true`.
   */
  readonly withKeyPoints?: boolean;
}

/**
 * Construction options for a {@link TextSummarizer}.
 */
export interface TextSummarizerOptions {
  /**
   * Partial {@link SummarizationConfig}; merged over the defaults. Controls
   * the default technique, sentence budget, length target and minimum score.
   */
  readonly config?: Partial<SummarizationConfig>;

  /**
   * Custom stopword list for keyword extraction. Replaces the built-in
   * {@link DEFAULT_STOPWORDS} list entirely when provided.
   */
  readonly stopwords?: readonly string[];

  /**
   * Optional corpus document-frequencies for the IDF-ish term correction,
   * keyed by term. Build one with {@link TextSummarizer.buildDocumentFrequencies}.
   */
  readonly documentFrequencies?: Readonly<Record<string, number>>;

  /**
   * The number of documents {@link TextSummarizerOptions.documentFrequencies}
   * was built over. Defaults to `0`, which keeps the IDF correction neutral.
   */
  readonly documentCount?: number;

  /**
   * Clock used for all timestamps. Overrides any `now` supplied through the
   * config; injecting a clock makes the summarizer deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Rolling aggregate counters describing a summarizer's lifetime behaviour.
 *
 * Returned by {@link TextSummarizer.stats}. These accumulate across every
 * summarization call and are useful for monitoring and evals.
 */
export interface TextSummarizerStats {
  /**
   * Number of summarization operations executed (including keyword digests).
   */
  readonly runs: number;

  /**
   * How many runs each technique produced.
   */
  readonly byTechnique: Readonly<Record<SummarizeTechnique, number>>;

  /**
   * Total characters of source text summarised across all runs.
   */
  readonly totalOriginalChars: number;

  /**
   * Total characters of summary text produced across all runs.
   */
  readonly totalSummaryChars: number;

  /**
   * Mean compression ratio across all runs (`0` when no run has completed).
   */
  readonly averageRatio: number;

  /**
   * Epoch-millisecond time the summarizer was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent run.
   */
  readonly updatedAt: Timestamp;
}

/**
 * Default chunk size in characters for {@link TextSummarizer.rolling}.
 */
export const DEFAULT_CHUNK_SIZE = 2000;

/**
 * Default maximum number of shortening passes for {@link TextSummarizer.rolling}.
 */
export const DEFAULT_MAX_STEPS = 5;

/**
 * Common English abbreviations whose trailing period must not be treated as a
 * sentence boundary by {@link TextSummarizer.splitSentences}.
 *
 * The list is deliberately conservative; longer dotted abbreviations
 * (`"U.S."`, `"Ph.D."`) are additionally caught by the single/double-letter
 * heuristic in the splitter.
 */
export const SENTENCE_ABBREVIATIONS: readonly string[] = [
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'rev',
  'hon',
  'st',
  'sr',
  'jr',
  'e.g',
  'i.e',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'dept',
  'no',
  'fig',
  'vol',
  'approx',
  'est',
  'min',
  'max',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
];

/**
 * The built-in English stopword list used by keyword extraction.
 *
 * A conservative set of function words that carry little topical signal in
 * English prose. Callers may replace it wholesale via
 * {@link TextSummarizerOptions.stopwords} for domain-tuned extraction.
 */
export const DEFAULT_STOPWORDS: readonly string[] = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'while',
  'as',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'up',
  'down',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'once',
  'here',
  'there',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'will',
  'just',
  'should',
  'would',
  'could',
  'may',
  'might',
  'must',
  'shall',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'about',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'against',
];

/**
 * The deterministic summarization engine.
 *
 * See the module documentation for the ranking model. Construct with an
 * optional partial configuration (merged over the defaults), then call
 * {@link TextSummarizer.summarize} for the one-stop path or a technique method
 * directly.
 *
 * @example
 * ```ts
 * const summarizer = new TextSummarizer({ config: { maxSentences: 3 } });
 * const digest = summarizer.summarize(longText);
 * const terms = summarizer.keywords(longText, 10);
 * const takeAways = summarizer.keyPoints(longText, 3);
 * const rolling = summarizer.rolling(longText, 800);
 * ```
 */
export class TextSummarizer {
  /**
   * Effective configuration (constructor config merged over defaults).
   */
  readonly config: SummarizationConfig;

  /**
   * Effective stopword set (custom, or the built-in list).
   */
  private readonly stopwords: ReadonlySet<string>;

  /**
   * Optional corpus document-frequencies for the IDF-ish correction.
   */
  private readonly documentFrequencies: Readonly<Record<string, number>>;

  /**
   * The number of documents {@link TextSummarizer.documentFrequencies} was
   * built over (`0` = neutral IDF).
   */
  private readonly documentCount: number;

  /**
   * Clock used for timestamps; injectable for deterministic tests.
   */
  private readonly now: () => Timestamp;

  /**
   * Epoch-millisecond time the summarizer was constructed.
   */
  private readonly createdAt: Timestamp;

  /**
   * Number of runs executed since construction.
   */
  private runCount = 0;

  /**
   * Runs per technique since construction.
   */
  private readonly techniqueCounts: Record<SummarizeTechnique, number> = {
    extractive: 0,
    keyword: 0,
    rolling: 0,
  };

  /**
   * Total source characters summarised since construction.
   */
  private totalOriginal = 0;

  /**
   * Total summary characters produced since construction.
   */
  private totalSummary = 0;

  /**
   * Epoch-millisecond time of the most recent run.
   */
  private lastRunAt: Timestamp;

  /**
   * The built-in stopword set, shared across instances so it is built once.
   */
  private static readonly defaultStopwordSet: ReadonlySet<string> = new Set(
    DEFAULT_STOPWORDS,
  );

  /**
   * The built-in abbreviation set, shared across instances.
   */
  private static readonly abbreviationSet: ReadonlySet<string> = new Set(
    SENTENCE_ABBREVIATIONS,
  );

  /**
   * Construct a summarizer.
   *
   * @param options - optional config, stopwords and corpus statistics
   */
  constructor(options: TextSummarizerOptions = {}) {
    this.config = mergeSummarizationConfig(options.config);
    this.stopwords = options.stopwords
      ? new Set(options.stopwords)
      : TextSummarizer.defaultStopwordSet;
    this.documentFrequencies = options.documentFrequencies ?? {};
    this.documentCount =
      options.documentCount !== undefined && options.documentCount > 0
        ? Math.floor(options.documentCount)
        : 0;
    this.now = options.now ?? this.config.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.lastRunAt = this.createdAt;
  }

  /**
   * Normalise source text for summarization.
   *
   * Trims leading/trailing whitespace and collapses every internal run of
   * whitespace (spaces, tabs, newlines) to a single space, so sentence
   * boundaries are determined by punctuation alone and token counts are stable.
   *
   * @param text - the raw text
   * @returns the normalised text
   */
  normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Split text into sentences.
   *
   * Boundaries are `.`, `!`, `?` followed by whitespace (or end-of-input), and
   * newlines. A trailing period is **not** a boundary when it terminates a
   * known abbreviation ({@link SENTENCE_ABBREVIATIONS}) or a single/double
   * letter token (`"U.S."`, `"Ph.D."`), so abbreviations do not shred a
   * document into fragments. Each returned sentence is trimmed of surrounding
   * whitespace; empty fragments are dropped.
   *
   * @param text - the text to split
   * @returns the sentences, in document order
   */
  splitSentences(text: string): string[] {
    const normalized = this.normalize(text);
    const out: string[] = [];
    let current = '';
    let index = 0;
    while (index < normalized.length) {
      const char = normalized[index];
      current += char;
      if (char === '.' || char === '!' || char === '?') {
        const previous = this.wordBefore(normalized, index);
        if (char === '.' && this.isAbbreviation(previous)) {
          index += 1;
          continue;
        }
        const next = normalized[index + 1];
        if (next === undefined || /\s/.test(next)) {
          const sentence = current.trim();
          if (sentence.length > 0) {
            out.push(sentence);
          }
          current = '';
        }
      }
      index += 1;
    }
    const tail = current.trim();
    if (tail.length > 0) {
      out.push(tail);
    }
    return out;
  }

  /**
   * Extract the word (possibly dotted, e.g. `"e.g"`) immediately before a
   * punctuation character.
   *
   * @param text - the normalised text
   * @param at - the index of the punctuation character
   * @returns the preceding word, lowercased
   */
  private wordBefore(text: string, at: number): string {
    let end = at;
    while (end > 0 && /\s/.test(text[end - 1])) {
      end -= 1;
    }
    let start = end;
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start -= 1;
    }
    return text.slice(start, end).toLowerCase();
  }

  /**
   * Test whether a lowercased token is an abbreviation whose trailing period
   * should not end a sentence.
   *
   * Matches {@link SENTENCE_ABBREVIATIONS} exactly, or any token of one or two
   * letters (covers `"U.S."`, `"Ph.D."`, initials in citations).
   *
   * @param token - the lowercased preceding word
   * @returns `true` when the period is likely part of an abbreviation
   */
  private isAbbreviation(token: string): boolean {
    if (TextSummarizer.abbreviationSet.has(token)) {
      return true;
    }
    return /^[a-z]{1,2}$/.test(token);
  }

  /**
   * Tokenise text into lowercased, stopword-free terms.
   *
   * Uses a Unicode-aware match (`letters` and `numbers`), lowercases every
   * term, drops single-character fragments and filters {@link DEFAULT_STOPWORDS}
   * (or the configured custom list). This is the term stream used by both
   * keyword extraction and sentence scoring, so both share one definition of
   * "meaningful token".
   *
   * @param text - the text to tokenise
   * @returns the meaningful terms, in document order
   */
  tokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    if (!matches) {
      return [];
    }
    const out: string[] = [];
    for (const term of matches) {
      if (term.length < 2 || this.stopwords.has(term)) {
        continue;
      }
      out.push(term);
    }
    return out;
  }

  /**
   * Count term frequencies across a term stream.
   *
   * @param terms - the terms to count
   * @returns term→count map
   */
  private frequencyMap(terms: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * The IDF-ish correction for a term.
   *
   * When a corpus was supplied, a term that appears in few corpus documents is
   * boosted relative to a term that appears in many:
   * `log((docs + 1) / (docFreq + 0.5)) + 1`. Without a corpus (`documentCount`
   * `0`) the correction is exactly `1`, so salience is pure term frequency —
   * deterministic and corpus-free.
   *
   * @param term - the term to correct
   * @returns the term's IDF weight (`1` = neutral)
   */
  idfOf(term: string): number {
    if (this.documentCount <= 0) {
      return 1;
    }
    const docFreq = this.documentFrequencies[term];
    if (docFreq === undefined || docFreq <= 0) {
      return 1;
    }
    return Math.log((this.documentCount + 1) / (docFreq + 0.5)) + 1;
  }

  /**
   * Compute the raw (unnormalised) salience of a single sentence.
   *
   * Sums each term's `frequency × idf × lengthBonus`, normalised by the square
   * root of the sentence's word count (so long sentences are not automatically
   * winners), then applies length penalties for very short (< 4 words) and very
   * long (> 60 words) sentences.
   *
   * @param sentence - the sentence to score
   * @param frequencies - the document's term frequencies
   * @returns the raw salience score
   */
  private sentenceScore(
    sentence: string,
    frequencies: ReadonlyMap<string, number>,
  ): number {
    const words = this.tokenize(sentence);
    if (words.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const term of words) {
      const frequency = frequencies.get(term);
      if (frequency === undefined || frequency === 0) {
        continue;
      }
      const lengthBonus = 1 + Math.min(1, term.length / 6) * 0.5;
      sum += frequency * this.idfOf(term) * lengthBonus;
    }
    let score = sum / Math.sqrt(words.length);
    if (words.length < 4) {
      score *= 0.5;
    } else if (words.length > 60) {
      score *= 0.7;
    }
    return score;
  }

  /**
   * Rank a list of sentences by salience.
   *
   * Scores each sentence against the term frequencies of the *whole* supplied
   * set, applies the position bonus (earlier sentences get `× max(0.05, 1 −
   * index × 0.05)`), normalises to `[0, 1]` against the best sentence, and
   * filters out sentences below `minScore`.
   *
   * @param sentences - the sentences to rank (in document order)
   * @param minScore - the minimum normalised score to keep
   * @returns the sentences with their normalised scores, in document order
   */
  private rankSentences(
    sentences: readonly string[],
    minScore: number,
  ): ScoredSentence[] {
    const frequencies = this.frequencyMap(this.tokenize(sentences.join(' ')));
    const scored = sentences.map((text, index) => {
      const raw =
        this.sentenceScore(text, frequencies) *
        Math.max(0.05, 1 - index * 0.05);
      return { text, index, score: raw };
    });
    let maxScore = 1;
    for (const entry of scored) {
      if (entry.score > maxScore) {
        maxScore = entry.score;
      }
    }
    return scored
      .map((entry) => ({ text: entry.text, index: entry.index, score: entry.score / maxScore }))
      .filter((entry) => entry.score >= minScore);
  }

  /**
   * Produce an extractive summary of a document.
   *
   * Sentences are ranked by {@link TextSummarizer.rankSentences}; the top
   * `maxSentences` are selected and re-ordered into their original sequence.
   * When {@link SummarizationConfig.maxLength} is set and the selected summary
   * still exceeds it, the lowest-scored selected sentence is dropped first
   * (repeatedly), then any overflow is clipped at a word boundary.
   *
   * @param text - the source text
   * @param maxSentences - maximum sentences to keep (defaults to the configured
   *   `maxSentences`)
   * @param options - per-call overrides (`minScore`, `maxLength`,
   *   `withKeyPoints`)
   * @returns an `'extractive'` {@link SummaryResult}
   */
  extractive(
    text: string,
    maxSentences?: number,
    options: Omit<SummarizeOptions, 'technique'> = {},
  ): SummaryResult {
    const original = text.length;
    const normalized = this.normalize(text);
    const maximum = resolveMaxSentences(maxSentences ?? this.config.maxSentences);
    const minScore = clampScore(options.minScore ?? this.config.minScore);
    const sentences = this.splitSentences(normalized);
    if (sentences.length === 0) {
      return this.finish(createSummaryResult('', 'extractive', original), 'extractive');
    }
    const ranked = this.rankSentences(sentences, minScore);
    const top = ranked
      .slice()
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, maximum);
    const selected = top.slice().sort((a, b) => a.index - b.index);

    let summary = selected.map((entry) => entry.text).join(' ');
    const maxLength = clampLength(options.maxLength ?? this.config.maxLength);
    if (maxLength > 0 && summary.length > maxLength) {
      const working = selected.slice();
      while (
        working.length > 1 &&
        working.reduce((length, entry) => length + entry.text.length + 1, 0) >
          maxLength
      ) {
        working.sort((a, b) => a.score - b.score);
        working.shift();
        working.sort((a, b) => a.index - b.index);
      }
      summary = working.map((entry) => entry.text).join(' ');
      if (summary.length > maxLength) {
        summary = this.clipToLength(summary, maxLength);
      }
    }

    const keyPoints =
      options.withKeyPoints === false
        ? undefined
        : top.map((entry, rank) => ({
            text: entry.text,
            rank: rank + 1,
            score: entry.score,
          }));
    return this.finish(
      createSummaryResult(summary, 'extractive', original, keyPoints),
      'extractive',
    );
  }

  /**
   * Extract the document's most salient keywords.
   *
   * Terms are tokenised (lowercased, stopword-free), counted for frequency,
   * weighted by the IDF-ish correction and a length bonus, then sorted by
   * descending salience with ties broken alphabetically (deterministic).
   *
   * @param text - the source text
   * @param topN - how many keywords to return (defaults to `8`)
   * @returns the top `topN` keywords, most salient first
   */
  keywords(text: string, topN?: number): string[] {
    const limit = topN !== undefined && topN > 0 ? Math.floor(topN) : 8;
    const frequencies = this.frequencyMap(this.tokenize(text));
    const scored: Array<{ term: string; score: number }> = [];
    for (const [term, frequency] of frequencies) {
      const lengthBonus = 1 + Math.min(1, term.length / 6) * 0.5;
      scored.push({ term, score: frequency * this.idfOf(term) * lengthBonus });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
    });
    return scored.slice(0, limit).map((entry) => entry.term);
  }

  /**
   * Produce a rolling ("summary of summaries") digest of a document.
   *
   * The source is chopped into sentence-aligned chunks of at most `chunkSize`
   * characters; each chunk is summarised extractively to roughly half its
   * sentences; the chunk digests are joined and the whole process repeats until
   * the digest stops shrinking, reaches `maxLength` (when set), or exhausts
   * {@link RollingOptions.maxSteps}. The result is a digest that has been
   * compressed *in layers* — hence "rolling".
   *
   * @param text - the source text
   * @param chunkSize - maximum characters per chunk (defaults to
   *   {@link DEFAULT_CHUNK_SIZE})
   * @param options - rolling-specific overrides (`maxLength`, `maxSteps`,
   *   `minLength`)
   * @returns a `'rolling'` {@link SummaryResult}
   */
  rolling(
    text: string,
    chunkSize?: number,
    options: RollingOptions = {},
  ): SummaryResult {
    const original = text.length;
    const normalized = this.normalize(text);
    const chunk = clampLength(chunkSize) || DEFAULT_CHUNK_SIZE;
    const maxSteps = clampLength(options.maxSteps) || DEFAULT_MAX_STEPS;
    const maxLength = clampLength(options.maxLength ?? this.config.maxLength);
    const minLength = clampLength(options.minLength) || 1;
    const minScore = clampScore(options.minScore ?? this.config.minScore);

    let current = normalized;
    let previousLength = current.length;
    for (let step = 0; step < maxSteps; step += 1) {
      const sentences = this.splitSentences(current);
      if (sentences.length <= 1) {
        break;
      }
      if (current.length <= minLength) {
        break;
      }
      const chunks = this.chunkBySentences(sentences, chunk);
      const digests: string[] = [];
      for (const part of chunks) {
        if (part.length === 1) {
          digests.push(part[0]);
          continue;
        }
        const target = Math.max(1, Math.round(part.length * 0.5));
        const ranked = this.rankSentences(part, minScore);
        const top = ranked
          .slice()
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, target)
          .sort((a, b) => a.index - b.index);
        digests.push(top.map((entry) => entry.text).join(' '));
      }
      const joined = digests.join('\n\n');
      if (joined.length >= previousLength) {
        break;
      }
      current = joined;
      previousLength = joined.length;
      if (maxLength > 0 && current.length <= maxLength) {
        break;
      }
    }

    let summary = current;
    if (maxLength > 0 && summary.length > maxLength) {
      summary = this.clipToLength(summary, maxLength);
    }

    const keyPoints =
      options.withKeyPoints === false
        ? undefined
        : this.keyPoints(summary, resolveMaxSentences(this.config.maxSentences));
    return this.finish(
      createSummaryResult(summary, 'rolling', original, keyPoints),
      'rolling',
    );
  }

  /**
   * Split sentences into greedy chunks of at most `chunkSize` characters.
   *
   * Each chunk receives at least one sentence (a single oversized sentence
   * forms its own chunk), and sentences are never split mid-sentence.
   *
   * @param sentences - the sentences, in document order
   * @param chunkSize - the maximum chunk size in characters
   * @returns an array of chunks, each an array of sentences
   */
  private chunkBySentences(
    sentences: readonly string[],
    chunkSize: number,
  ): string[][] {
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLength = 0;
    for (const sentence of sentences) {
      const nextLength = currentLength + sentence.length + 1;
      if (current.length > 0 && nextLength > chunkSize) {
        chunks.push(current);
        current = [];
        currentLength = 0;
      }
      current.push(sentence);
      currentLength += sentence.length + 1;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }

  /**
   * Extract the document's top key points.
   *
   * Sentences are ranked by salience and the top `n` (distinct) sentences are
   * returned as {@link KeyPoint}s, ordered by descending score with 1-based
   * ranks.
   *
   * @param text - the source text
   * @param n - how many key points to extract (defaults to the configured
   *   `maxSentences`)
   * @returns the top key points, most salient first
   */
  keyPoints(text: string, n?: number): KeyPoint[] {
    const limit = resolveMaxSentences(n ?? this.config.maxSentences);
    const sentences = this.splitSentences(text);
    if (sentences.length === 0) {
      return [];
    }
    const ranked = this.rankSentences(sentences, 0);
    return ranked
      .slice()
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((entry, rank) => ({
        text: entry.text,
        rank: rank + 1,
        score: entry.score,
      }));
  }

  /**
   * Produce a gist per section (paragraph) of a document.
   *
   * Sections are split on blank lines. A short single-line paragraph ending in
   * `:` is treated as a *heading* and attached to the next section's gist
   * rather than summarised itself. Each section's gist is its topic sentence —
   * the first sentence when it scores within 70% of the section's best
   * sentence (lead-sentence convention), otherwise the best-scored sentence.
   *
   * @param text - the raw source text (paragraph breaks preserved)
   * @returns the per-section gists, in document order
   */
  sectionGists(text: string): SectionGist[] {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    const gists: SectionGist[] = [];
    let pendingHeading: string | undefined;
    let index = 0;
    for (const paragraph of paragraphs) {
      const singleLine = !/\n/.test(paragraph);
      const looksLikeHeading =
        singleLine && paragraph.length <= 60 && paragraph.trimEnd().endsWith(':');
      if (looksLikeHeading) {
        pendingHeading = paragraph.replace(/:$/, '').trim();
        continue;
      }
      const sentences = this.splitSentences(paragraph);
      let summary: string;
      if (sentences.length <= 1) {
        summary = sentences[0] ?? paragraph;
      } else {
        const ranked = this.rankSentences(sentences, 0);
        const best = ranked.reduce(
          (current, entry) => (entry.score > current.score ? entry : current),
          ranked[0],
        );
        const first = ranked[0];
        summary =
          first.score >= best.score * 0.7 && first.index === 0
            ? first.text
            : best.text;
      }
      gists.push({
        sectionIndex: index,
        ...(pendingHeading ? { heading: pendingHeading } : {}),
        summary,
      });
      pendingHeading = undefined;
      index += 1;
    }
    return gists;
  }

  /**
   * Clip text to a maximum length at a word boundary.
   *
   * Cuts at the last space within the first `maxLength − 1` characters (when
   * one exists reasonably close to the cut), appends `…`, and guarantees the
   * result never exceeds `maxLength` characters.
   *
   * @param text - the text to clip
   * @param maxLength - the maximum output length in characters
   * @returns the clipped text
   */
  private clipToLength(text: string, maxLength: number): string {
    if (maxLength <= 0 || text.length <= maxLength) {
      return text;
    }
    let cut = text.slice(0, maxLength - 1);
    const boundary = cut.lastIndexOf(' ');
    if (boundary > maxLength * 0.6) {
      cut = cut.slice(0, boundary);
    }
    return `${cut}…`;
  }

  /**
   * The one-stop summarization dispatcher.
   *
   * Normalises the text, dispatches to the effective technique
   * ({@link SummarizationConfig.technique} unless overridden per-call), and
   * returns a {@link SummaryResult} carrying the raw input's original length.
   * The `'keyword'` technique produces a comma-joined digest of the top
   * keywords as its `summary`; `'extractive'` and `'rolling'` produce fluent
   * sentence digests.
   *
   * @param text - the source text
   * @param options - per-call overrides (technique, sentence budget, length
   *   target, minimum score, key points)
   * @returns the produced {@link SummaryResult}
   */
  summarize(text: string, options: SummarizeOptions = {}): SummaryResult {
    const technique: SummarizeTechnique =
      options.technique ?? this.config.technique;
    if (technique === 'keyword') {
      const maximum = resolveMaxSentences(
        options.maxSentences ?? this.config.maxSentences,
      );
      const terms = this.keywords(text, maximum);
      const keyPoints =
        options.withKeyPoints === false
          ? undefined
          : this.keyPoints(text, maximum);
      return this.finish(
        createSummaryResult(
          terms.join(', '),
          'keyword',
          text.length,
          keyPoints,
        ),
        'keyword',
      );
    }
    if (technique === 'rolling') {
      return this.rolling(text, undefined, {
        maxLength: options.maxLength,
        minScore: options.minScore,
        withKeyPoints: options.withKeyPoints,
      });
    }
    return this.extractive(text, options.maxSentences, {
      maxLength: options.maxLength,
      minScore: options.minScore,
      withKeyPoints: options.withKeyPoints,
    });
  }

  /**
   * Account for a finished run in the rolling counters.
   *
   * @param result - the produced result
   * @param technique - the technique that produced it
   * @returns the result, unchanged
   */
  private finish<T extends SummaryResult>(
    result: T,
    technique: SummarizeTechnique,
  ): T {
    this.runCount += 1;
    this.techniqueCounts[technique] += 1;
    this.totalOriginal += result.originalLength;
    this.totalSummary += result.summaryLength;
    this.lastRunAt = this.now();
    return result;
  }

  /**
   * Derive a new summarizer with an IDF corpus attached.
   *
   * Returns a *new* instance sharing the same config and stopwords but carrying
   * `documentFrequencies` and `documentCount`, so salience becomes IDF-corrected
   * across a corpus while the original summarizer stays corpus-free and fully
   * deterministic.
   *
   * @param documentFrequencies - term→document-frequency map (see
   *   {@link TextSummarizer.buildDocumentFrequencies})
   * @param documentCount - the number of documents the map was built over
   * @returns a corpus-aware {@link TextSummarizer}
   */
  usingIdf(
    documentFrequencies: Readonly<Record<string, number>>,
    documentCount: number,
  ): TextSummarizer {
    return new TextSummarizer({
      config: this.config,
      stopwords: [...this.stopwords],
      documentFrequencies,
      documentCount,
    });
  }

  /**
   * Rolling aggregate counters for this summarizer.
   *
   * @returns a {@link TextSummarizerStats} snapshot
   */
  stats(): TextSummarizerStats {
    return {
      runs: this.runCount,
      byTechnique: { ...this.techniqueCounts },
      totalOriginalChars: this.totalOriginal,
      totalSummaryChars: this.totalSummary,
      averageRatio:
        this.totalOriginal === 0 ? 0 : this.totalSummary / this.totalOriginal,
      createdAt: this.createdAt,
      updatedAt: this.lastRunAt,
    };
  }

  /**
   * Build term→document-frequency statistics over a corpus of documents.
   *
   * Each document's *distinct* terms are counted once, so the result maps a
   * term to the number of corpus documents containing it — exactly the shape
   * {@link TextSummarizerOptions.documentFrequencies} expects.
   *
   * @param documents - the corpus documents
   * @returns a term→document-frequency map
   */
  static buildDocumentFrequencies(
    documents: Iterable<string>,
  ): Record<string, number> {
    const frequencies: Record<string, number> = {};
    for (const document of documents) {
      const seen = new Set<string>();
      for (const term of document.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        if (term.length < 2 || TextSummarizer.defaultStopwordSet.has(term)) {
          continue;
        }
        seen.add(term);
      }
      for (const term of seen) {
        frequencies[term] = (frequencies[term] ?? 0) + 1;
      }
    }
    return frequencies;
  }

  /**
   * The built-in stopword list, for callers that want to inspect or extend it.
   *
   * @returns a copy of {@link DEFAULT_STOPWORDS}
   */
  static stopwords(): string[] {
    return [...DEFAULT_STOPWORDS];
  }

  /**
   * The configured default technique.
   */
  get technique(): SummarizeTechnique {
    return this.config.technique;
  }
}