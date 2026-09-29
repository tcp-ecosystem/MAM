/**
 * Compression algorithms for the **Compression** layer of the standalone MAM
 * Context Engine.
 *
 * {@link TextCompressor} is the layer's **worker**: it turns raw context text
 * into smaller context text using purely deterministic, dependency-free
 * transforms. No LLM, no network, no randomness — the same input plus the same
 * options always yields the same output, which is what makes the layer safe to
 * run inside a hot prompt-assembly loop.
 *
 * Responsibilities:
 *
 * - **Compress** — {@link TextCompressor.compress} applies the configured
 *   technique to a piece of text and returns a full {@link CompressionResult}
 *   (text, lengths, ratio, token estimate, dropped-block count, effective
 *   config). It honours the effective `maxLength` as a hard cap.
 * - **Truncate** — {@link TextCompressor.truncate} hard-cuts text to a
 *   character cap, preferring a word boundary.
 * - **Collapse** — {@link TextCompressor.collapseWhitespace} squeezes runs of
 *   whitespace into single separators while preserving paragraph structure.
 * - **Dedupe** — {@link TextCompressor.dedupeBlocks} removes duplicated
 *   paragraph blocks, keeping the first occurrence of each.
 * - **Strip** — {@link TextCompressor.stripMarkdown} removes markdown syntax
 *   while keeping the words, optionally preserving fenced code blocks verbatim.
 * - **Extract** — {@link TextCompressor.keywordExtract} (via
 *   {@link TextCompressor.scoreKeywords}) distills text into its top-N most
 *   significant keywords by frequency, position and length weighting.
 *
 * The technique dispatch in {@link TextCompressor.compress} is deliberately a
 * switch over {@link CompressionTechnique} so the exact pass order is explicit
 * and testable. For the default `'tiered'` technique the order is always
 * **lossless first, lossy second, truncate last**: collapse whitespace → dedupe
 * blocks → strip markdown → (optional keyword summary) → hard cap.
 *
 * @module compression/retrieval
 */

import {
  clampKeywordCount,
  clampLength,
  computeRatio,
  estimateTokens,
  mergeCompressionConfig,
} from './types.js';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionTechnique,
  CompressOptions,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link TextCompressor}.
 */
export interface TextCompressorOptions {
  /**
   * Clock used for the result timestamp. Injecting a clock makes the
   * compressor deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The outcome of {@link TextCompressor.dedupeBlocks}.
 */
export interface DedupeResult {
  /**
   * The deduplicated text (blocks rejoined with `\n\n`).
   */
  readonly text: string;

  /**
   * Number of duplicate blocks removed.
   */
  readonly dropped: number;
}

/**
 * The outcome of {@link TextCompressor.stripMarkdown}.
 */
export interface StripMarkdownResult {
  /**
   * The stripped text (markdown syntax removed, words retained).
   */
  readonly text: string;

  /**
   * Number of markdown constructs removed (images, links, headings, emphasis,
   * inline code, blockquotes, list markers, horizontal rules).
   */
  readonly dropped: number;
}

/**
 * A single keyword candidate with its frequency score.
 */
export interface KeywordScore {
  /**
   * The keyword, lowercased.
   */
  readonly word: string;

  /**
   * How many times the word appears in the source text.
   */
  readonly count: number;

  /**
   * Composite score: `count + positionBonus + lengthBonus`, where the position
   * bonus favours words that appear early in the text and the length bonus
   * favours words long enough to be distinctive.
   */
  readonly score: number;
}

/**
 * The deterministic compression worker.
 *
 * See the module documentation for the full responsibility list. The
 * compressor is stateless apart from its configuration and clock, so a single
 * instance can be shared across an entire engine (and is, by the integration
 * facades).
 *
 * @example
 * ```ts
 * const compressor = new TextCompressor({ stripMarkdown: true, maxLength: 8000 });
 * const result = compressor.compress(rawKnowledgeDump);
 * console.log(`${result.ratio * 100}% smaller; ${result.droppedBlocks} blocks dropped`);
 * ```
 */
export class TextCompressor {
  /**
   * The effective configuration this compressor applies (merged over the
   * defaults at construction time).
   */
  readonly config: CompressionConfig;

  /**
   * Clock used for result timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * Construct a compressor.
   *
   * @param config - partial configuration, merged over the defaults
   * @param options - construction options (notably the clock)
   */
  constructor(
    config: Partial<CompressionConfig> | undefined = undefined,
    options: TextCompressorOptions = {},
  ) {
    this.config = mergeCompressionConfig(config);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Resolve the effective options for a single call by layering per-call
   * overrides over the constructor configuration.
   *
   * Only fields *explicitly defined* on `options` replace the configured
   * value, so a call that passes just `{ maxLength: 2000 }` keeps every other
   * configured behaviour.
   *
   * @param options - the per-call overrides, or `undefined`
   * @returns the fully-resolved {@link CompressionConfig} for this call
   */
  private effectiveConfig(options: CompressOptions | undefined): CompressionConfig {
    const base = this.config;
    if (!options) {
      return base;
    }
    return {
      maxLength: options.maxLength !== undefined ? options.maxLength : base.maxLength,
      collapseWhitespace:
        options.collapseWhitespace !== undefined
          ? options.collapseWhitespace
          : base.collapseWhitespace,
      dedupeBlocks:
        options.dedupeBlocks !== undefined ? options.dedupeBlocks : base.dedupeBlocks,
      stripMarkdown:
        options.stripMarkdown !== undefined ? options.stripMarkdown : base.stripMarkdown,
      preserveCodeBlocks:
        options.preserveCodeBlocks !== undefined
          ? options.preserveCodeBlocks
          : base.preserveCodeBlocks,
      technique: options.technique !== undefined ? options.technique : base.technique,
    };
  }

  /**
   * Compress a piece of text deterministically.
   *
   * Applies the effective technique (from config + options) in the fixed pass
   * order described in the module documentation, then enforces the effective
   * `maxLength` as a hard cap (marking the result `truncated` when it bites).
   * Returns a full {@link CompressionResult} with the ratio, token estimate and
   * dropped-block count so callers can judge and log what was saved.
   *
   * @param text - the text to compress
   * @param options - per-call overrides on top of the configured behaviour
   * @returns a {@link CompressionResult} describing the compression
   */
  compress(text: string, options: CompressOptions = {}): CompressionResult {
    const effective = this.effectiveConfig(options);
    const technique: CompressionTechnique = effective.technique ?? 'tiered';
    let working = text;
    let dropped = 0;
    let truncated = false;

    switch (technique) {
      case 'none':
        break;
      case 'truncate':
        break;
      case 'collapse':
        if (effective.collapseWhitespace) {
          working = this.collapseWhitespace(working);
        }
        break;
      case 'dedupe':
        if (effective.dedupeBlocks) {
          const deduped = this.dedupeBlocks(working);
          dropped += deduped.dropped;
          working = deduped.text;
        }
        break;
      case 'strip-markdown':
        if (effective.stripMarkdown) {
          const stripped = this.stripMarkdown(working, effective.preserveCodeBlocks);
          dropped += stripped.dropped;
          working = stripped.text;
        }
        break;
      case 'keywords': {
        const keywords = this.keywordExtract(working, options.topN);
        if (keywords.length > 0) {
          dropped += Math.max(0, this.scoreKeywords(working).length - keywords.length);
          working = keywords.join(', ');
        }
        break;
      }
      case 'tiered':
        if (effective.collapseWhitespace) {
          working = this.collapseWhitespace(working);
        }
        if (effective.dedupeBlocks) {
          const deduped = this.dedupeBlocks(working);
          dropped += deduped.dropped;
          working = deduped.text;
        }
        if (effective.stripMarkdown) {
          const stripped = this.stripMarkdown(working, effective.preserveCodeBlocks);
          dropped += stripped.dropped;
          working = stripped.text;
        }
        break;
    }

    if (
      effective.maxLength !== undefined &&
      working.length > effective.maxLength
    ) {
      working = this.truncate(working, effective.maxLength);
      truncated = true;
    }

    return this.buildResult(text, working, effective, technique, dropped, truncated);
  }

  /**
   * Hard-truncate text to a maximum length, preferring a word boundary.
   *
   * Cuts at the last space that still leaves the text at or under the cap (when
   * one exists past 70% of the budget); otherwise cuts at the character cap
   * directly. An optional `suffix` (e.g. an ellipsis) is appended only when it
   * fits within the cap. A cap of `0` (or any non-finite value) yields `''`.
   *
   * @param text - the text to truncate
   * @param max - the maximum length in characters
   * @param suffix - optional suffix to append when it fits
   * @returns the truncated text
   */
  truncate(text: string, max: number, suffix = ''): string {
    const cap = clampLength(max);
    if (cap === 0) {
      return '';
    }
    if (text.length <= cap) {
      return text;
    }
    const budget = Math.max(0, cap - suffix.length);
    let cut = text.slice(0, budget);
    const boundary = cut.lastIndexOf(' ');
    if (boundary > 0 && boundary > budget * 0.7) {
      cut = cut.slice(0, boundary);
    }
    cut = cut.replace(/\s+$/g, '');
    const out = cut + suffix;
    return out.length > cap ? out.slice(0, cap) : out;
  }

  /**
   * Collapse runs of whitespace into single separators.
   *
   * Horizontal whitespace (spaces, tabs, form-feeds) collapses to a single
   * space; three or more consecutive newlines collapse to a single paragraph
   * break (`\n\n`); trailing spaces are trimmed from the end of each line and
   * the whole string is trimmed. Paragraph *structure* is preserved, which is
   * what makes this pass effectively lossless.
   *
   * @param text - the text to collapse
   * @returns the collapsed text
   */
  collapseWhitespace(text: string): string {
    if (!text) {
      return text;
    }
    return text
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[^\S\n]+$/gm, '')
      .replace(/^\s+|\s+$/g, '');
  }

  /**
   * Remove duplicated paragraph blocks.
   *
   * Splits the text on blank-line separators, trims each block, and keeps only
   * the *first* occurrence of each distinct block (exact, case-sensitive match
   * after trimming). Empty blocks are dropped. The surviving blocks are joined
   * back with `\n\n`. Returns how many duplicates were removed so callers can
   * judge how lossy the pass was.
   *
   * @param text - the text to deduplicate
   * @returns a {@link DedupeResult} with the deduplicated text and drop count
   */
  dedupeBlocks(text: string): DedupeResult {
    if (!text) {
      return { text, dropped: 0 };
    }
    const blocks = text.split(/\n{2,}/);
    const seen = new Set<string>();
    const out: string[] = [];
    let dropped = 0;
    for (const block of blocks) {
      const key = block.trim();
      if (key.length === 0) {
        continue;
      }
      if (seen.has(key)) {
        dropped += 1;
        continue;
      }
      seen.add(key);
      out.push(key);
    }
    return { text: out.join('\n\n'), dropped };
  }

  /**
   * Remove markdown syntax while keeping the words.
   *
   * Strips images (`![alt](url)` → alt text), links (`[label](url)` → label),
   * ATX headings (`### text` → text), bold/italic/underline emphasis, inline
   * code (`` `x` `` → x), blockquotes (`> line` → line), unordered and ordered
   * list markers, and horizontal rules. Returns the number of constructs
   * removed. When `preserveCodeBlocks` is set (default `true`), fenced code
   * blocks (```…``` / ~~~…~~~) are protected first and restored verbatim, so
   * code survives the pass intact.
   *
   * This is deliberately a *basic* stripper — it targets the constructs that
   * dominate real prompt text and does not attempt full CommonMark parsing.
   *
   * @param text - the markdown text to strip
   * @param preserveCodeBlocks - keep fenced code blocks verbatim (default
   *   `true`)
   * @returns a {@link StripMarkdownResult} with the stripped text and drop count
   */
  stripMarkdown(text: string, preserveCodeBlocks = true): StripMarkdownResult {
    if (!text) {
      return { text, dropped: 0 };
    }
    let dropped = 0;
    let working = text;
    const protectedBlocks = new Map<string, string>();

    if (preserveCodeBlocks) {
      working = working.replace(
        /```[^`\n]*\n[\s\S]*?```|~~~[^~\n]*\n[\s\S]*?~~~/g,
        (block) => {
          const token = `\u0000CB${protectedBlocks.size}\u0000`;
          protectedBlocks.set(token, block);
          return token;
        },
      );
    }

    working = working.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => {
      dropped += 1;
      return alt ?? '';
    });
    working = working.replace(/\[([^\]]+)\]\([^)]*\)/g, (_match, label: string) => {
      dropped += 1;
      return label;
    });
    working = working.replace(/^#{1,6}\s+(.*)$/gm, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/\*\*([^*]+)\*\*/g, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/\*([^*]+)\*/g, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/__([^_]+)__/g, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/~~([^~]+)~~/g, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/_([^_]+)_/g, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/`([^`]+)`/g, (_match, code: string) => {
      dropped += 1;
      return code;
    });
    working = working.replace(/^\s*>\s?(.*)$/gm, (_match, body: string) => {
      dropped += 1;
      return body;
    });
    working = working.replace(/^\s*[-*+]\s+/gm, () => {
      dropped += 1;
      return '';
    });
    working = working.replace(/^\s*\d+[.)]\s+/gm, () => {
      dropped += 1;
      return '';
    });
    working = working.replace(/^\s*([-*_])\1{2,}\s*$/gm, () => {
      dropped += 1;
      return '';
    });

    if (protectedBlocks.size > 0) {
      for (const [token, block] of protectedBlocks) {
        working = working.split(token).join(block);
      }
    }

    return { text: working, dropped };
  }

  /**
   * Extract the top-N most significant keywords from text.
   *
   * Words are lowercased, tokenised, filtered against a stopword list, and
   * scored by frequency, position (earlier is better) and length (longer is
   * more distinctive). Returns the top `topN` words (clamped to `[1, 50]`,
   * default 10) in descending score order.
   *
   * @param text - the text to extract keywords from
   * @param topN - how many keywords to return (clamped to `[1, 50]`)
   * @returns a fresh array of the top keywords, highest-score first
   */
  keywordExtract(text: string, topN = 10): string[] {
    const count = clampKeywordCount(topN);
    return this.scoreKeywords(text)
      .slice(0, count)
      .map((score) => score.word);
  }

  /**
   * Score every keyword candidate in text.
   *
   * The full ranking behind {@link TextCompressor.keywordExtract}: each word's
   * score is `count + positionBonus + lengthBonus`, where `positionBonus`
   * falls from `2` (first word) to `0` (last word) and `lengthBonus` rises to
   * `0.5` as a word approaches 12 characters. Ties break by higher count, then
   * alphabetically.
   *
   * @param text - the text to score
   * @returns a fresh array of {@link KeywordScore}s, highest-score first
   */
  scoreKeywords(text: string): KeywordScore[] {
    const words = this.tokenize(text);
    const counts = new Map<string, number>();
    const firstPos = new Map<string, number>();
    words.forEach((word, index) => {
      counts.set(word, (counts.get(word) ?? 0) + 1);
      if (!firstPos.has(word)) {
        firstPos.set(word, index);
      }
    });
    const total = Math.max(1, words.length);
    const scored: KeywordScore[] = [];
    for (const [word, count] of counts) {
      const position = firstPos.get(word) ?? 0;
      const positionBonus = 1 - position / total;
      const lengthBonus = Math.min(1, word.length / 12) * 0.5;
      scored.push({ word, count, score: count + positionBonus * 2 + lengthBonus });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.word.localeCompare(b.word);
    });
    return scored;
  }

  /**
   * Tokenise text into candidate words.
   *
   * Lowercases, extracts `[a-z0-9]` word runs (including hyphenated and
   * apostrophe forms), and filters out stopwords and single-character tokens.
   * This is the shared tokeniser behind both keyword paths and keeps their
   * behaviour consistent.
   *
   * @param text - the text to tokenise
   * @returns a fresh array of candidate words
   */
  tokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g);
    if (!matches) {
      return [];
    }
    return matches.filter((word) => word.length > 1 && !STOPWORDS.has(word));
  }

  /**
   * Heuristic token estimate for a piece of text.
   *
   * @param text - the text to estimate
   * @returns the estimated token count (`0` for empty input)
   */
  estimate(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Assemble a {@link CompressionResult} from the pass outputs.
   *
   * Computes the ratio with {@link computeRatio}, estimates tokens, and stamps
   * the effective config and clock so the result is fully self-describing.
   *
   * @param original - the input text
   * @param text - the compressed text
   * @param config - the effective config this result was produced under
   * @param technique - the technique that was applied
   * @param dropped - the number of blocks removed
   * @param truncated - whether the hard cap bit
   * @returns a complete {@link CompressionResult}
   */
  private buildResult(
    original: string,
    text: string,
    config: CompressionConfig,
    technique: CompressionTechnique,
    dropped: number,
    truncated: boolean,
  ): CompressionResult {
    const originalLength = original.length;
    const compressedLength = text.length;
    return {
      text,
      originalLength,
      compressedLength,
      ratio: computeRatio(originalLength, compressedLength),
      tokens: estimateTokens(text),
      technique,
      droppedBlocks: dropped,
      truncated,
      config,
      at: this.now(),
    };
  }
}

/**
 * Common English stopwords excluded from keyword extraction.
 *
 * Function words carry little topic signal, so they are dropped before
 * frequency scoring. The list is intentionally conservative — real stopword
 * lists are longer, but over-filtering risks hiding short but meaningful
 * domain terms from the extractor.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'itself', 'just', 'me', 'might', 'more', 'most', 'must', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  'shall', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  'yourselves', 'also', 'etc', 'eg', 'ie', 'per', 'via', 'vs', 'though',
  'whether', 'well', 'ever', 'never', 'always', 'often', 'sometimes', 'still',
]);