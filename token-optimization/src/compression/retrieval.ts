/**
 * @fileoverview Deterministic token-compression engine for the Compression
 * layer.
 *
 * {@link TokenCompressor} is the public entry point of the Compression layer.
 * It reduces the token footprint of prompt text without any LLM involvement,
 * using five deterministic techniques (see {@link TECHNIQUES}):
 *
 *   - **collapse-whitespace** — collapse runs of whitespace into a single
 *     space per line and trim sentence edges; blank runs collapse to a single
 *     blank line. Code fences are preserved verbatim when
 *     {@link CompressConfig.preserveCode} is set.
 *   - **dedupe-blocks** — remove repeated paragraph blocks (and consecutive
 *     repeated lines) while keeping the *first* occurrence, so boilerplate
 *     like repeated headers / signatures is dropped.
 *   - **trim-stopwords** — drop common filler words at the *edges* of each
 *     sentence where they carry no information (`The`, `please`, `thanks`).
 *   - **abbreviate** — replace a fixed dictionary of common words / phrases
 *     with shorter equivalents (`please` → `pls`, `because` → `b/c`,
 *     `for example` → `e.g.`), preserving the case of the original.
 *   - **truncate** — cut at a word boundary once the text exceeds
 *     {@link CompressConfig.maxTokens}, appending an ellipsis.
 *
 * Techniques run in a fixed order (the order declared by {@link TECHNIQUES}),
 * so the output is fully deterministic across runs and processes. Every
 * technique reports its own token savings, and {@link TokenCompressor#compress}
 * aggregates them into a {@link CompressionResult}.
 *
 * When configured with a {@link ./store.js} `CompressionStore`, the compressor
 * consults and populates the cache on every call (subject to per-call
 * `useCache`), so re-compressing identical text is O(1). When configured with
 * an {@link ./index.js} `CompressionIndex`, fresh results are indexed
 * automatically.
 *
 * @module compression/retrieval
 */

import type { CompressionStore } from './store.js';
import type { CompressionIndex } from './index.js';
import type {
  CompressConfig,
  CompressOptions,
  CompressionResult,
  CompressionTechnique,
  TechniqueResult,
  TokenCounter,
} from './types.js';
import {
  DEFAULT_MIN_BLOCK_LENGTH,
  createCompressionResult,
  createTechniqueResult,
  defaultTokenCounter,
  isCompressionTechnique,
  normalizeCompressConfig,
} from './types.js';

/**
 * Stopwords removed from the *leading* edge of sentences by
 * {@link TokenCompressor#trimStopwords}. Matched case-insensitively, one or
 * more in sequence. These words rarely carry meaning when they open a
 * sentence.
 */
export const LEADING_STOPWORDS: readonly string[] = Object.freeze([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'so',
  'but',
  'and',
  'or',
  'well',
  'now',
  'then',
  'please',
  'basically',
  'actually',
  'just',
  'simply',
  'note',
  'also',
  'however',
  'moreover',
  'furthermore',
  'meanwhile',
  'therefore',
  'thus',
  'hence',
  'additionally',
  'first',
  'firstly',
  'secondly',
  'finally',
  'lastly',
  'ok',
  'okay',
  'yes',
  'right',
]);

/**
 * Stopwords removed from the *trailing* edge of sentences by
 * {@link TokenCompressor#trimStopwords}. Sign-off / filler words that add
 * nothing when they close a sentence.
 */
export const TRAILING_STOPWORDS: readonly string[] = Object.freeze([
  'please',
  'thanks',
  'thank',
  'you',
  'ok',
  'okay',
  'then',
  'though',
  'anyway',
  'regards',
  'sincerely',
  'cheers',
  'again',
  'too',
  'also',
  'actually',
  'basically',
  'indeed',
  'soon',
  'anyhow',
]);

/**
 * Abbreviation dictionary used by {@link TokenCompressor#abbreviate}. Entries
 * are applied longest-first (multi-word phrases before the single words they
 * contain) with word boundaries, case-insensitively, preserving the case of
 * the first letter of the matched text.
 */
export const ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  'for example': 'e.g.',
  'that is': 'i.e.',
  'in other words': 'i.e.',
  'please note': 'pls note',
  'with regard to': 're:',
  'in order to': 'to',
  'with respect to': 're:',
  'approximately': 'approx',
  'information': 'info',
  'configuration': 'config',
  'optimization': 'optim',
  'implementation': 'impl',
  'application': 'app',
  'regarding': 're:',
  'please': 'pls',
  'because': 'b/c',
  'about': 'abt',
  'and': '&',
  'with': 'w/',
  'without': 'w/o',
  'versus': 'vs',
  'number': 'no.',
  'example': 'ex.',
  'cannot': "can't",
  'will not': "won't",
  'do not': "don't",
  'does not': "doesn't",
  'did not': "didn't",
  'is not': "isn't",
  'are not': "aren't",
  'there is': "there's",
  'there are': "there're",
  'it is': "it's",
  'i am': "i'm",
  'you are': "you're",
  'we are': "we're",
  'they are': "they're",
  'let us': "let's",
  'what is': "what's",
  'that is not': "that isn't",
});

/**
 * Regex matching a fenced code-block opener / closer. A line whose trimmed
 * content starts with three or more backticks (or tildes) toggles the "inside
 * code fence" state used by whitespace collapse and block dedup.
 */
const CODE_FENCE_RE = /^\s*(```+|~~~+)/;

/**
 * Options accepted by the {@link TokenCompressor} constructor. All fields are
 * optional; defaults mirror {@link ./types.js} `DEFAULT_COMPRESS_CONFIG`.
 */
export interface TokenCompressorOptions {
  /** Compression configuration (see {@link CompressConfig}). */
  readonly config?: Readonly<CompressConfig>;
  /**
   * Optional cache the compressor reads from and writes to. When present,
   * `compress` consults it first (subject to `useCache`).
   */
  readonly store?: CompressionStore;
  /**
   * Optional index that fresh compression results are written into.
   */
  readonly index?: CompressionIndex;
  /**
   * Instance-level {@link TokenCounter}. When absent the built-in heuristic
   * {@link defaultTokenCounter} is used. Per-call overrides win.
   */
  readonly counter?: TokenCounter;
}

/**
 * Deterministic, LLM-free token compressor.
 *
 * Instances are cheap to construct and safe to share: the compressor keeps no
 * per-call mutable state (cache / index are injected), so a single instance
 * can serve an entire process.
 *
 * @example
 * ```ts
 * const compressor = new TokenCompressor();
 * const result = compressor.compress(
 *   'The quick   brown fox    please',
 *   { saveTechniqueResults: true },
 * );
 * console.log(result.savedTokens, result.techniques);
 * ```
 */
export class TokenCompressor {
  /** Normalized, immutable configuration governing every compression run. */
  readonly config: CompressConfig;

  /** Optional cache consulted / populated by {@link compress}. */
  readonly store: CompressionStore | undefined;

  /** Optional index that fresh results are written into. */
  readonly index: CompressionIndex | undefined;

  /** The resolved instance-level token counter. */
  readonly counter: TokenCounter;

  /** Per-process cache of escaped abbreviation patterns (lazy). */
  private readonly escapedPatterns: Map<string, string> = new Map();

  /**
   * @param options - Tuning options (see {@link TokenCompressorOptions}).
   */
  constructor(options: Readonly<TokenCompressorOptions> = {}) {
    this.config = normalizeCompressConfig(options.config);
    this.store = options.store;
    this.index = options.index;
    this.counter = options.counter ?? defaultTokenCounter;
  }

  /**
   * Compress a piece of text through the enabled techniques in order:
   * whitespace collapse → block dedup → stopword trimming → abbreviation →
   * truncation. Returns a {@link CompressionResult} with aggregate savings.
   *
   * When a {@link ./store.js} `CompressionStore` is configured (and per-call
   * `useCache` is not `false`), the original text is content-addressed first
   * and a cache hit short-circuits all work; fresh results are written back
   * and (when configured) indexed.
   *
   * @param text - The text to compress.
   * @param options - Per-call options (see {@link CompressOptions}).
   * @returns The compression result.
   */
  compress(text: string, options: Readonly<CompressOptions> = {}): CompressionResult {
    if (typeof text !== 'string') {
      throw new TypeError('TokenCompressor#compress: `text` must be a string');
    }
    const useCache = options.useCache !== false && this.store !== undefined;
    if (useCache && this.store) {
      const cached = this.store.getFor(text);
      if (cached) return cached;
    }

    const counter = options.counter ?? this.counter;
    const originalTokens = options.originalTokens ?? counter(text);
    const includeOriginal = options.includeOriginalText === true || this.store !== undefined;
    const trackResults = options.saveTechniqueResults === true;

    let current = text;
    const applied: string[] = [];
    const techniqueResults: TechniqueResult[] = [];

    const run = (
      technique: CompressionTechnique,
      transform: (input: string) => string,
      note?: string,
    ): void => {
      const before = current;
      current = transform(current);
      const saved = Math.max(0, Math.round(counter(before) - counter(current)));
      const result = createTechniqueResult(
        technique,
        before.length,
        current.length,
        saved,
        note,
      );
      techniqueResults.push(result);
      if (result.applied) applied.push(technique);
    };

    const cfg = this.config;

    if (cfg.collapseWhitespace === true) {
      run('collapse-whitespace', (input) => this.collapseWhitespace(input));
    }

    if (cfg.dedupeBlocks === true) {
      run('dedupe-blocks', (input) => this.dedupeBlocks(input, cfg.minBlockLength ?? DEFAULT_MIN_BLOCK_LENGTH));
    }

    if (cfg.trimStopwords === true) {
      run('trim-stopwords', (input) => this.trimStopwords(input));
    }

    if (cfg.abbreviate === true) {
      run('abbreviate', (input) => this.abbreviate(input));
    }

    const maxTokens = cfg.maxTokens;
    if (maxTokens !== undefined && maxTokens >= 1 && counter(current) > maxTokens) {
      run('truncate', (input) => this.truncateToTokens(input, maxTokens, counter));
    }

    const compressedTokens = counter(current);
    const result = createCompressionResult(
      current,
      originalTokens,
      compressedTokens,
      applied,
      {
        originalText: includeOriginal ? text : undefined,
        techniqueResults: trackResults ? techniqueResults : undefined,
      },
    );

    if (this.store && useCache) this.store.put(result);
    if (this.index) this.index.indexResult(result);

    return result;
  }

  /**
   * Collapse whitespace deterministically:
   *
   *   - runs of spaces / tabs within a line collapse to a single space,
   *   - each line is trimmed,
   *   - consecutive blank lines collapse to a single blank line,
   *   - when {@link CompressConfig.preserveCode} is set, fenced code blocks
   *     (```` ``` ````) are left byte-for-byte untouched.
   *
   * @param text - Input text.
   * @returns Whitespace-collapsed text.
   */
  collapseWhitespace(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inFence = false;
    let pendingBlank = false;

    for (const rawLine of lines) {
      if (this.config.preserveCode === true && CODE_FENCE_RE.test(rawLine)) {
        if (pendingBlank) {
          out.push('');
          pendingBlank = false;
        }
        out.push(rawLine);
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        out.push(rawLine);
        continue;
      }
      const collapsed = rawLine.replace(/[ \t]+/g, ' ').trim();
      if (collapsed.length === 0) {
        pendingBlank = true;
        continue;
      }
      if (pendingBlank) {
        out.push('');
        pendingBlank = false;
      }
      out.push(collapsed);
    }
    if (pendingBlank) out.push('');
    return out.join('\n');
  }

  /**
   * Remove repeated blocks deterministically. A *block* is a paragraph
   * (contiguous non-blank lines). Blocks whose whitespace-collapsed signature
   * has been seen before are dropped, keeping the first occurrence, as long as
   * the block is at least `minBlockLength` characters. Additionally,
   * consecutive duplicate lines within a paragraph (exact trimmed match) are
   * collapsed, so stray doubled headers / bullets disappear.
   *
   * Fenced code blocks are skipped entirely when
   * {@link CompressConfig.preserveCode} is set, so dedup never touches code.
   *
   * @param text - Input text.
   * @param minBlockLength - Minimum block length (chars) to be eligible.
   * @returns Text with repeated blocks removed.
   */
  dedupeBlocks(text: string, minBlockLength: number = DEFAULT_MIN_BLOCK_LENGTH): string {
    const minLen = Number.isFinite(minBlockLength) && minBlockLength >= 1 ? Math.floor(minBlockLength) : DEFAULT_MIN_BLOCK_LENGTH;
    const paragraphs = text.split(/\n[ \t]*\n+/);
    const seen = new Set<string>();
    const kept: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) {
        kept.push(trimmed);
        continue;
      }
      const collapsed = trimmed.replace(/\s+/g, ' ');
      const sig = collapsed.toLowerCase();
      if (trimmed.length >= minLen && seen.has(sig)) {
        continue;
      }
      seen.add(sig);
      kept.push(this.dedupeConsecutiveLines(trimmed));
    }
    return kept.join('\n\n');
  }

  /**
   * Trim common filler words from the leading and trailing edge of every
   * sentence deterministically.
   *
   * Sentences are split on `.`, `!`, `?` (delimiters retained), each sentence
   * is trimmed of leading / trailing stopwords from
   * {@link LEADING_STOPWORDS} / {@link TRAILING_STOPWORDS}, and the result is
   * rejoined. A sentence is never reduced to empty: if trimming would empty
   * it, the original sentence is kept verbatim.
   *
   * @param text - Input text.
   * @returns Text with sentence-edge filler words removed.
   */
  trimStopwords(text: string): string {
    const sentences = splitSentences(text);
    const out = sentences.map((sentence) => this.trimSentenceEdges(sentence));
    return out.join('');
  }

  /**
   * Shorten common words and phrases deterministically using
   * {@link ABBREVIATIONS}. Multi-word phrases are replaced before single
   * words, each match is word-bounded and case-insensitive, and the case of
   * the first letter of the match is preserved.
   *
   * @param text - Input text.
   * @returns Text with abbreviations applied.
   */
  abbreviate(text: string): string {
    const entries = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);
    let out = text;
    for (const [phrase, replacement] of entries) {
      const pattern = this.escapedPatternFor(phrase);
      out = out.replace(pattern, (match: string) => {
        const first = match.charAt(0);
        if (first !== first.toLowerCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    }
    return out;
  }

  /**
   * Truncate text at a word boundary so its token count does not exceed
   * `maxTokens`, appending an ellipsis. Words are accumulated greedily; the
   * accumulated token count (via `counter`) plus a one-token allowance for the
   * ellipsis must stay within budget. If even a single word cannot fit, the
   * first word is kept anyway so the output is never empty.
   *
   * @param text - Input text.
   * @param maxTokens - Inclusive token ceiling for the output.
   * @param counter - Optional {@link TokenCounter}; defaults to the
   *   instance-level counter.
   * @returns Truncated text (unchanged when it already fits).
   */
  truncateToTokens(
    text: string,
    maxTokens: number,
    counter: TokenCounter = this.counter,
  ): string {
    const budget = Number.isFinite(maxTokens) && maxTokens >= 1 ? Math.floor(maxTokens) : 1;
    if (counter(text) <= budget) return text;

    const ELLIPSIS = '\u2026';
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    let acc = '';

    for (const word of words) {
      const candidate = acc.length === 0 ? word : `${acc} ${word}`;
      if (counter(candidate) + 1 > budget) break;
      acc = candidate;
    }

    // Nothing fit (very small budget): keep the first word so the output is
    // never empty, accepting a slight budget overrun rather than mangling text.
    if (acc.length === 0) {
      if (words.length === 0) return text;
      acc = words[0] as string;
    }
    return `${acc}${ELLIPSIS}`;
  }

  /**
   * Remove consecutive duplicate lines (trimmed, exact match) inside a block,
   * skipping lines inside code fences when `preserveCode` is set. Used by
   * {@link dedupeBlocks} to also catch single-line repeats.
   *
   * @param block - A paragraph (may contain newlines).
   * @returns The block with consecutive duplicate lines collapsed.
   */
  private dedupeConsecutiveLines(block: string): string {
    const lines = block.split('\n');
    const out: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (this.config.preserveCode === true && CODE_FENCE_RE.test(line)) {
        out.push(line);
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        out.push(line);
        continue;
      }
      const trimmed = line.trim();
      const previous = out[out.length - 1];
      if (previous !== undefined && previous.trim() === trimmed && trimmed.length > 0) {
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  /**
   * Trim the leading and trailing stopwords from a single sentence, keeping
   * any trailing punctuation attached to the core. Returns the original
   * sentence when trimming would empty it.
   *
   * @param sentence - A single sentence (may include leading / trailing space).
   * @returns The trimmed sentence.
   */
  private trimSentenceEdges(sentence: string): string {
    const s = sentence.trim();
    if (s.length === 0) return sentence;

    const punctMatch = /([.!?]+)$/.exec(s);
    const punct = punctMatch ? (punctMatch[1] as string) : '';
    const core = punctMatch ? s.slice(0, punctMatch.index) : s;

    const words = core.split(/\s+/).filter((word) => word.length > 0);
    let start = 0;
    while (
      start < words.length &&
      isStopword(words[start] as string, LEADING_STOPWORDS)
    ) {
      start += 1;
    }
    let end = words.length - 1;
    while (
      end >= start &&
      isStopword(words[end] as string, TRAILING_STOPWORDS)
    ) {
      end -= 1;
    }

    if (start > end) return sentence;
    const trimmedCore = words.slice(start, end + 1).join(' ');
    if (trimmedCore.length === 0) return sentence;
    return `${trimmedCore}${punct}`;
  }

  /**
   * Lazily build a word-boundary RegExp for a phrase, escaping any regex
   * metacharacters. Cached per phrase for repeated `abbreviate` calls.
   *
   * @param phrase - The phrase to match.
   * @returns A case-insensitive word-boundary RegExp.
   */
  private escapedPatternFor(phrase: string): RegExp {
    const cached = this.escapedPatterns.get(phrase);
    if (cached) return new RegExp(cached, 'gi');
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.escapedPatterns.set(phrase, `\\b${escaped}\\b`);
    return new RegExp(`\\b${escaped}\\b`, 'gi');
  }

  /**
   * Estimate the token count of arbitrary text with the resolved counter.
   * Convenience passthrough so callers can reuse the compressor's counter.
   *
   * @param text - Text to score.
   * @returns A non-negative token estimate.
   */
  count(text: string): number {
    return Math.max(0, Math.round(this.counter(text)));
  }

  /**
   * List the techniques that would be *enabled* under the current
   * configuration (regardless of whether they change a given input).
   *
   * @returns The enabled techniques, in application order.
   */
  enabledTechniques(): CompressionTechnique[] {
    const cfg = this.config;
    const out: CompressionTechnique[] = [];
    if (cfg.collapseWhitespace === true) out.push('collapse-whitespace');
    if (cfg.dedupeBlocks === true) out.push('dedupe-blocks');
    if (cfg.trimStopwords === true) out.push('trim-stopwords');
    if (cfg.abbreviate === true) out.push('abbreviate');
    if (cfg.maxTokens !== undefined) out.push('truncate');
    return out;
  }
}

/**
 * Split text into sentences, retaining the punctuation delimiters (`.`, `!`,
 * `?`) as part of each sentence. Newlines and blank lines are preserved as
 * separators so paragraph structure survives stopword trimming.
 *
 * @param text - Input text.
 * @returns The sentences, each including its trailing delimiter.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]*[.!?]+|[^.!?]*$/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push(match[0]);
  }
  return out;
}

/**
 * Case-insensitive stopword test for a single word token. The word is
 * stripped of punctuation before the lookup.
 *
 * @param word - The candidate word.
 * @param stopwords - The stopword set to test against.
 * @returns `true` when `word` (case-insensitive) is in `stopwords`.
 */
export function isStopword(word: string, stopwords: readonly string[]): boolean {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  return cleaned.length > 0 && stopwords.includes(cleaned);
}

/**
 * Verify a technique name is known, mirroring `isCompressionTechnique`.
 * Re-exported here so consumers of the engine can validate technique names
 * without importing from the types module directly.
 *
 * @param value - Arbitrary value.
 * @returns `true` when `value` is a supported technique.
 */
export function isTechnique(value: unknown): value is CompressionTechnique {
  return isCompressionTechnique(value);
}