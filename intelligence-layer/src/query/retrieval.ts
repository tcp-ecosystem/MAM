/**
 * The {@link QueryAnalyzer}: the analysis engine of the Query understanding
 * layer.
 *
 * Given a raw free-text query, the analyzer produces a structured
 * {@link QueryAnalysis} by running a deterministic, dependency-free pipeline:
 *
 * 1. **Normalise** — lowercase, trim and collapse whitespace
 *    ({@link QueryAnalyzer.normalize}).
 * 2. **Classify** — score the query against keyword/regex patterns per intent
 *    and return an {@link IntentSignal} with calibrated confidence
 *    ({@link QueryAnalyzer.classifyIntent}).
 * 3. **Extract** — tokenise, filter stop words, rank by frequency and honour
 *    per-term boosts ({@link QueryAnalyzer.extractTerms}).
 * 4. **Expand** — widen the term set with synonyms and thesaurus clusters
 *    ({@link QueryAnalyzer.expand}).
 * 5. **Decompose** — split comparative / exploratory queries into sub-queries
 *    on connectors like `'vs'`, `'and'` and `'or'`
 *    ({@link QueryAnalyzer.decompose}).
 * 6. **Detect** — a lightweight language guess and named-entity candidates.
 *
 * The whole pipeline is deterministic: the same input text and configuration
 * always produces the same analysis. When the analyzer is constructed with a
 * {@link QueryStore}, {@link QueryAnalyzer.analyze} memoises results by
 * content address, so repeated queries skip the pipeline entirely.
 *
 * ## Configurability
 *
 * Behaviour is driven by an {@link AnalysisConfig} captured at construction
 * time, with per-call overrides via {@link AnalyzeOptions}. This lets one
 * analyzer serve both strict, cache-heavy traffic and one-off deep analyses.
 *
 * @packageDocumentation
 * @module query/retrieval
 */

import type { QueryStore } from './store.js';
import {
  DEFAULT_ANALYSIS_CONFIG,
  DEFAULT_INTENT_PATTERNS,
  QUERY_INTENTS,
  assertQueryIntent,
  clamp01,
  createQueryAnalysis,
  dedupeStrings,
  isQueryIntent,
  resolveExpansionConfig,
  type AnalysisConfig,
  type AnalysisStats,
  type AnalyzeOptions,
  type ExpansionConfig,
  type IntentPattern,
  type IntentSignal,
  type QueryAnalysis,
  type QueryIntent,
  type TermRule,
} from './types.js';

/**
 * A single extracted term with its frequency-derived score.
 *
 * Returned by {@link QueryAnalyzer.extractTerms} and converted into the plain
 * string list on {@link QueryAnalysis.terms} by {@link QueryAnalyzer.analyze}.
 */
export interface ExtractedTerm {
  /**
   * The normalised (lowercased, trimmed) term.
   */
  readonly term: string;

  /**
   * Number of times the term occurred in the query after filtering.
   */
  readonly count: number;

  /**
   * Normalised relevance in `[0, 1]`: the term's frequency divided by the
   * most-frequent term's count, multiplied by any configured per-term boost.
   */
  readonly score: number;
}

/**
 * Result of {@link QueryAnalyzer.expand}.
 *
 * Separates the *input* term set from the *additions* so callers can see
 * exactly what the expansion contributed and what the widened set looks like.
 */
export interface ExpansionResult {
  /**
   * The query text that was expanded.
   */
  readonly original: string;

  /**
   * The base extracted terms (before expansion).
   */
  readonly terms: readonly string[];

  /**
   * The synonym / thesaurus terms added by expansion, in insertion order.
   * Empty when expansion produced nothing new.
   */
  readonly added: readonly string[];

  /**
   * The full widened term set (`terms` + `added`, deduplicated).
   */
  readonly expanded: readonly string[];
}

/**
 * Result of {@link QueryAnalyzer.detectLanguage}.
 */
export interface LanguageSignal {
  /**
   * A small ISO-639-1-ish code (`'en'`, `'es'`, `'fr'`, `'de'`) or `'unknown'`
   * when no signal was found or the signal was ambiguous.
   */
  readonly language: string;

  /**
   * Proportion of the query's tokens that matched the detected language's
   * lexicon, in `[0, 1]`. `0` for `'unknown'`.
   */
  readonly confidence: number;
}

/**
 * Small per-language common-word lexicons used for lightweight detection.
 *
 * Each list contains high-frequency function words for that language; overlap
 * between a query's tokens and a lexicon is used to guess the language without
 * any external dependency.
 */
export const LANGUAGE_LEXICONS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'for', 'with', 'how', 'what', 'why', 'this', 'that', 'from', 'into', 'are', 'was', 'have', 'has', 'not', 'but', 'they', 'them', 'will', 'would', 'can', 'just', 'about', 'which', 'when', 'where'],
  es: ['que', 'para', 'como', 'con', 'por', 'los', 'las', 'una', 'del', 'esto', 'esta', 'este', 'son', 'era', 'han', 'pero', 'ellos', 'ellas', 'cual', 'cuando', 'donde', 'ser', 'haber', 'muy', 'todo'],
  fr: ['que', 'pour', 'avec', 'les', 'des', 'une', 'dans', 'comment', 'pourquoi', 'cette', 'ce', 'ces', 'sont', 'etait', 'ont', 'mais', 'ils', 'elles', 'quel', 'quand', 'ou', 'etre', 'avoir', 'tres', 'tout'],
  de: ['der', 'die', 'das', 'und', 'wie', 'was', 'warum', 'mit', 'für', 'fuer', 'den', 'dem', 'ein', 'eine', 'sind', 'war', 'haben', 'aber', 'sie', 'wer', 'wann', 'wo', 'sein', 'haben', 'sehr', 'alle'],
};

/**
 * Regular expressions used to recognise candidate named entities.
 *
 * Entities are detected against the *original* (case-preserving) query text,
 * since normalisation discards the capitalisation that signals proper nouns.
 */
export const ENTITY_PATTERNS: readonly RegExp[] = [
  // Proper-noun sequences: "OpenAI", "New York Times", "React Native".
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  // Version numbers: "1.4.2", "3.11".
  /\b\d+\.\d+(?:\.\d+)?\b/g,
  // Quantities with units: "16 gb", "5 ms", "100 usd".
  /\b\d+(?:[.,]\d+)?\s*(?:gb|mb|kb|hz|ms|sec|km|m|kg|gb|usd|eur|%)\b/gi,
];

/**
 * The {@link QueryAnalyzer} class: a deterministic query-analysis engine.
 *
 * Construct one analyzer per configuration; it is stateless apart from its
 * configuration and (optionally) a shared {@link QueryStore} cache, so it can
 * be reused safely across requests. All public methods are synchronous.
 */
export class QueryAnalyzer {
  /** Resolved configuration in effect for this analyzer. */
  private readonly config: {
    stopwords: ReadonlySet<string>;
    minTermLength: number;
    maxTerms: number;
    intentThreshold: number;
    expand: boolean | ExpansionConfig;
    decompose: boolean;
    detectLanguage: boolean;
    termRules: readonly TermRule[];
    patterns: Readonly<Partial<Record<QueryIntent, readonly IntentPattern[]>>>;
    now: () => number;
  };

  /** Optional content-addressed analysis cache. */
  private readonly store?: QueryStore;

  /** Cumulative number of analyses produced. */
  private produced = 0;

  /** Cumulative classification confidence. */
  private confidenceSum = 0;

  /** Cumulative analysis duration in ms. */
  private durationSum = 0;

  /** Cumulative decomposed-analysis count. */
  private decomposedCount = 0;

  /**
   * Construct an analyzer.
   *
   * @param config - optional configuration; {@link DEFAULT_ANALYSIS_CONFIG}
   *   defaults apply
   * @param store - optional {@link QueryStore} used to memoise and cache
   *   analyses produced by {@link QueryAnalyzer.analyze}
   */
  constructor(config?: AnalysisConfig, store?: QueryStore) {
    this.config = {
      stopwords: new Set(config?.stopwords ?? DEFAULT_ANALYSIS_CONFIG.stopwords),
      minTermLength: config?.minTermLength ?? DEFAULT_ANALYSIS_CONFIG.minTermLength,
      maxTerms: config?.maxTerms ?? DEFAULT_ANALYSIS_CONFIG.maxTerms,
      intentThreshold: config?.intentThreshold ?? DEFAULT_ANALYSIS_CONFIG.intentThreshold,
      patterns: config?.patterns ?? DEFAULT_ANALYSIS_CONFIG.patterns,
      expand: config?.expand ?? DEFAULT_ANALYSIS_CONFIG.expand,
      decompose: config?.decompose ?? DEFAULT_ANALYSIS_CONFIG.decompose,
      detectLanguage: config?.detectLanguage ?? DEFAULT_ANALYSIS_CONFIG.detectLanguage,
      termRules: [...(DEFAULT_ANALYSIS_CONFIG.termRules ?? []), ...(config?.termRules ?? [])],
      now: config?.now ?? (() => Date.now()),
    };
    if (this.config.minTermLength < 1) {
      throw new Error(`QueryAnalyzer: minTermLength must be >= 1, got ${this.config.minTermLength}`);
    }
    if (this.config.maxTerms < 0) {
      throw new Error(`QueryAnalyzer: maxTerms must be >= 0, got ${this.config.maxTerms}`);
    }
    this.store = store;
  }

  /**
   * The {@link QueryStore} cache attached to this analyzer, if any.
   *
   * @returns the attached store, or `undefined`
   */
  get storeCache(): QueryStore | undefined {
    return this.store;
  }

  /**
   * A plain read-only projection of the effective configuration.
   *
   * Useful for logging and diagnostics without exposing mutable internals.
   */
  get configSnapshot(): Readonly<AnalysisConfig> {
    return {
      stopwords: [...this.config.stopwords],
      minTermLength: this.config.minTermLength,
      maxTerms: this.config.maxTerms,
      intentThreshold: this.config.intentThreshold,
      patterns: this.config.patterns,
      expand: this.config.expand,
      decompose: this.config.decompose,
      detectLanguage: this.config.detectLanguage,
      termRules: this.config.termRules,
      now: this.config.now,
    };
  }

  /**
   * Run the full analysis pipeline over a query.
   *
   * Steps performed: normalise → cache check → classify → threshold-downgrade
   * → extract terms → detect entities → expand → decompose → detect language →
   * assemble. The result is cached in the attached store (when configured) and
   * subsequent calls for equivalent text return the cached analysis.
   *
   * @param text - the raw user query
   * @param options - per-call overrides; see {@link AnalyzeOptions}
   * @returns a complete {@link QueryAnalysis}
   * @throws {Error} when `text` is empty or whitespace-only
   */
  analyze(text: string, options?: AnalyzeOptions): QueryAnalysis {
    const start = this.config.now();
    const original = String(text ?? '');
    const normalized = this.normalize(original);
    if (normalized.length === 0) {
      throw new Error('QueryAnalyzer.analyze: text must be a non-empty string');
    }

    const useCache = options?.useCache ?? true;
    if (useCache && this.store) {
      const cached = this.store.getFor(normalized);
      if (cached) {
        return cached;
      }
    }

    const signal = this.classifyIntent(normalized);
    const threshold = options?.intentThreshold ?? this.config.intentThreshold;
    const intent: QueryIntent =
      signal.confidence < threshold ? 'unknown' : signal.intent;

    const extracted = this.extractTerms(normalized, options?.maxTerms);
    const terms = extracted.map((entry) => entry.term);
    const entities = this.detectEntities(original);

    let expanded: readonly string[] | undefined;
    const expansion = this.resolveExpansion(options?.expand);
    if (expansion) {
      const result = this.expand(normalized, expansion);
      if (result.added.length > 0) {
        expanded = result.expanded;
      }
    }

    let subQueries: readonly string[] | undefined;
    const decomposeEnabled = options?.decompose ?? this.config.decompose;
    if (decomposeEnabled) {
      const parts = this.decompose(normalized, intent);
      if (parts.length > 1) {
        subQueries = parts;
        this.decomposedCount += 1;
      }
    }

    const language = options?.detectLanguage ?? this.config.detectLanguage
      ? this.detectLanguage(normalized).language
      : undefined;

    const durationMs = this.config.now() - start;
    const analysis = createQueryAnalysis({
      original,
      normalized,
      intent,
      terms,
      expanded,
      subQueries,
      entities: entities.length > 0 ? entities : undefined,
      language,
      confidence: signal.confidence,
      analyzedAt: start,
      durationMs,
    });

    this.produced += 1;
    this.confidenceSum += signal.confidence;
    this.durationSum += durationMs;

    const cacheResult = options?.cacheResult ?? true;
    if (useCache && cacheResult && this.store) {
      this.store.put(analysis);
    }
    return analysis;
  }

  /**
   * Analyse many queries in one call.
   *
   * Each text is analysed independently; a thrown error for one input (e.g. an
   * empty string) aborts the batch and propagates, so callers should validate
   * inputs up front.
   *
   * @param texts - the queries to analyse
   * @param options - shared per-call options for every query
   * @returns one {@link QueryAnalysis} per input, in the same order
   */
  analyzeMany(texts: readonly string[], options?: AnalyzeOptions): QueryAnalysis[] {
    return texts.map((text) => this.analyze(text, options));
  }

  /**
   * Classify the intent of a query via keyword-pattern scoring.
   *
   * Every configured pattern for every intent is matched against the
   * normalised text; matching patterns contribute their weight to their
   * intent's raw score. The intent with the highest score wins, and the
   * confidence is derived from that score (saturating at `0.95`). Reasons for
   * the winning intent are returned, sorted by descending weight.
   *
   * @param text - the raw (or already-normalised) query text
   * @returns an {@link IntentSignal} with the best-guess intent
   */
  classifyIntent(text: string): IntentSignal {
    const normalized = this.normalize(text);
    if (normalized.length === 0) {
      return {
        intent: 'unknown',
        confidence: 0,
        reasons: ['query is empty'],
      };
    }

    const scores = new Map<QueryIntent, number>();
    const reasonsByIntent = new Map<QueryIntent, { weight: number; reason: string }[]>();

    for (const intent of QUERY_INTENTS) {
      scores.set(intent, 0);
      const matched: { weight: number; reason: string }[] = [];
      for (const pattern of this.patternsFor(intent)) {
        if (pattern.pattern.test(normalized)) {
          scores.set(intent, (scores.get(intent) ?? 0) + pattern.weight);
          matched.push({ weight: pattern.weight, reason: pattern.reason });
        }
      }
      if (matched.length > 0) {
        reasonsByIntent.set(intent, matched.sort((a, b) => b.weight - a.weight));
      }
    }

    let bestIntent: QueryIntent = 'unknown';
    let bestScore = 0;
    for (const [intent, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    if (bestScore === 0) {
      return {
        intent: 'unknown',
        confidence: 0.3,
        reasons: ['no intent patterns matched'],
      };
    }

    const confidence = clamp01(Math.min(0.95, 0.4 + bestScore * 0.15));
    const reasons = (reasonsByIntent.get(bestIntent) ?? []).map((entry) => entry.reason);
    return {
      intent: bestIntent,
      confidence,
      reasons,
    };
  }

  /**
   * Extract salient terms from a query.
   *
   * Tokenises the text (unicode-aware), lowercases, discards stop words and
   * tokens shorter than `minTermLength`, applies per-term rule boosts, ranks by
   * frequency and caps the result at `maxTerms` (which may be overridden per
   * call).
   *
   * @param text - the query text
   * @param maxTerms - optional per-call override of the configured cap (`0`
   *   disables the cap)
   * @returns ranked {@link ExtractedTerm}s, best first
   */
  extractTerms(text: string, maxTerms?: number): ExtractedTerm[] {
    const normalized = this.normalize(text);
    const cap = maxTerms !== undefined ? maxTerms : this.config.maxTerms;
    const counts = new Map<string, number>();
    const tokenize = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];

    for (const rawToken of tokenize) {
      const token = rawToken.toLowerCase();
      if (token.length < this.config.minTermLength) {
        continue;
      }
      if (this.config.stopwords.has(token)) {
        continue;
      }
      if (/^\d+$/.test(token)) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    const rules = this.ruleIndex();
    let maxCount = 0;
    const entries: { term: string; count: number; boost: number }[] = [];
    for (const [term, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
      }
      entries.push({ term, count, boost: rules.get(term) ?? 1 });
    }
    entries.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

    const terms: ExtractedTerm[] = [];
    for (const entry of entries) {
      const score = clamp01((entry.count / maxCount) * entry.boost);
      terms.push({ term: entry.term, count: entry.count, score });
    }
    if (cap > 0 && terms.length > cap) {
      return terms.slice(0, cap);
    }
    return terms;
  }

  /**
   * Extract the salient terms as a plain string list.
   *
   * Convenience wrapper over {@link QueryAnalyzer.extractTerms}.
   *
   * @param text - the query text
   * @param maxTerms - optional per-call cap override
   * @returns the ranked term strings
   */
  terms(text: string, maxTerms?: number): string[] {
    return this.extractTerms(text, maxTerms).map((entry) => entry.term);
  }

  /**
   * Expand a query by appending synonyms and thesaurus cluster members.
   *
   * Base terms are extracted, then for each base term the configured synonym
   * table is consulted for alternates and the configured thesaurus for concept
   * clusters. New terms are appended (capped by {@link ExpansionConfig.maxTerms}
   * when set) and the full widened set is returned via an {@link ExpansionResult}.
   *
   * @param text - the query text
   * @param config - the expansion tables to use; when omitted, defaults are used
   * @returns an {@link ExpansionResult} with the base and widened term sets
   */
  expand(text: string, config?: ExpansionConfig | null): ExpansionResult {
    const base = this.extractTerms(text).map((entry) => entry.term);
    const cfg = config ?? resolveExpansionConfig(true);
    const added = cfg ? this.expandTerms(base, cfg) : [];
    const expanded = dedupeStrings([...base, ...added]);
    return {
      original: text,
      terms: base,
      added,
      expanded,
    };
  }

  /**
   * Compute the additional terms produced by expanding a base term set.
   *
   * Pure function of the term set and expansion tables: given the same inputs
   * it always returns the same additions, which makes it easy to unit-test.
   *
   * @param terms - the base (already extracted) terms
   * @param config - the expansion tables (may be `null` to disable)
   * @returns the added terms, in insertion order
   */
  expandTerms(terms: readonly string[], config?: ExpansionConfig | null): string[] {
    if (!config) {
      return [];
    }
    const synonyms = config.synonyms ?? {};
    const thesaurus = config.thesaurus ?? {};
    const present = new Set(terms.map((term) => term.toLowerCase()));
    const added: string[] = [];
    const maxAdditional = config.maxTerms
      ? Math.max(0, config.maxTerms - terms.length)
      : Number.POSITIVE_INFINITY;

    const consider = (candidate: string): void => {
      if (added.length >= maxAdditional) {
        return;
      }
      const cleaned = candidate.trim().toLowerCase();
      if (
        cleaned.length < this.config.minTermLength ||
        this.config.stopwords.has(cleaned) ||
        present.has(cleaned) ||
        added.includes(cleaned)
      ) {
        return;
      }
      added.push(cleaned);
      present.add(cleaned);
    };

    for (const term of terms) {
      const key = term.toLowerCase();
      for (const alternate of synonyms[key] ?? []) {
        consider(alternate);
      }
      for (const [concept, cluster] of Object.entries(thesaurus)) {
        if (key === concept || cluster.some((member) => member === key)) {
          for (const member of cluster) {
            consider(member);
          }
        }
      }
    }
    return added;
  }

  /**
   * Decompose a query into sub-queries on comparative / conjunctive connectors.
   *
   * The strategy is intent-aware:
   *
   * - **comparison** — split on `vs`, `versus`, `compare(d) to/with`, and
   *   `difference between`; fall back to `and`/`or` only when no comparative
   *   connector exists.
   * - **exploration** — split on `and` / `or`.
   * - **other intents** — split on comparative connectors only, and only when
   *   one is present; otherwise the query is atomic.
   *
   * Each resulting segment is cleaned (leading "compare"/"difference between"
   * fillers removed) and trimmed. When fewer than two distinct segments
   * survive, the original query is returned unchanged.
   *
   * @param text - the (normalised) query text
   * @param intent - the classified intent, used to choose the split strategy
   * @returns the sub-queries, or `[text]` when the query is atomic
   */
  decompose(text: string, intent?: QueryIntent): string[] {
    const normalized = this.normalize(text);
    if (normalized.length === 0) {
      return [text];
    }
    const known = intent ? (isQueryIntent(intent) ? intent : 'unknown') : 'unknown';
    const comparativeConnectors = /\s+(?:vs\.?|versus|compared?\s+(?:to|with)|compare|comparing)\s+/i;
    const conjunctiveConnectors = /\s+(?:and|or)\s+/i;

    let connector: RegExp | null = null;
    if (known === 'comparison' || known === 'exploration') {
      connector = known === 'comparison' ? comparativeConnectors : conjunctiveConnectors;
      if (known === 'comparison' && !comparativeConnectors.test(normalized) && conjunctiveConnectors.test(normalized)) {
        connector = conjunctiveConnectors;
      }
    } else if (comparativeConnectors.test(normalized)) {
      connector = comparativeConnectors;
    }

    if (!connector) {
      return [text];
    }

    const parts = normalized.split(connector).map((part) => this.cleanSubQuery(part));
    const unique = dedupeStrings(parts);
    if (unique.length < 2) {
      return [text];
    }
    return unique;
  }

  /**
   * Normalise query text.
   *
   * Lowercases, trims surrounding whitespace and collapses internal runs of
   * whitespace into single spaces. This is the canonical text form used for
   * classification, content addressing and decomposition.
   *
   * @param text - the raw query text
   * @returns the normalised form
   */
  normalize(text: string): string {
    return String(text ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * Detect the natural language of a query.
   *
   * Compares the query's tokens against small per-language common-word
   * lexicons ({@link LANGUAGE_LEXICONS}). The language with the most hits wins;
   * ties collapse to `'unknown'` to avoid false confidence. Confidence is the
   * share of tokens matched.
   *
   * @param text - the query text
   * @returns a {@link LanguageSignal}
   */
  detectLanguage(text: string): LanguageSignal {
    const tokens = this.normalize(text).match(/[\p{L}]+/gu) ?? [];
    if (tokens.length === 0) {
      return { language: 'unknown', confidence: 0 };
    }
    let bestLanguage = 'unknown';
    let bestCount = 0;
    for (const [language, lexicon] of Object.entries(LANGUAGE_LEXICONS)) {
      let count = 0;
      for (const token of tokens) {
        if (lexicon.includes(token)) {
          count += 1;
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestLanguage = language;
      } else if (count === bestCount && count > 0) {
        bestLanguage = 'unknown';
      }
    }
    if (bestLanguage === 'unknown' || bestCount === 0) {
      return { language: 'unknown', confidence: 0 };
    }
    return { language: bestLanguage, confidence: bestCount / tokens.length };
  }

  /**
   * Detect candidate named entities in the *original* query text.
   *
   * Runs {@link ENTITY_PATTERNS} (proper-noun sequences, version numbers,
   * quantities with units) over the case-preserving text, deduplicates, caps at
   * eight results and returns them in order of appearance.
   *
   * @param text - the original (case-preserving) query text
   * @returns detected entity strings
   */
  detectEntities(text: string): string[] {
    const entities: string[] = [];
    for (const pattern of ENTITY_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(String(text ?? ''))) !== null) {
        entities.push(match[0]);
        if (entities.length >= 8) {
          return entities;
        }
      }
    }
    return dedupeStrings(entities);
  }

  /**
   * Aggregate statistics about the analyses produced by this analyzer.
   *
   * Computed from cumulative counters (histogram, averages) plus the attached
   * store's statistics when one is configured, so the returned snapshot spans
   * both the analyzer's lifetime and the current cache contents.
   *
   * @returns a fresh {@link AnalysisStats} snapshot
   */
  stats(): AnalysisStats {
    const intentCounts: Partial<Record<QueryIntent, number>> = {};
    const storeStats = this.store ? this.store.stats() : undefined;
    if (storeStats) {
      return storeStats;
    }
    for (const intent of QUERY_INTENTS) {
      intentCounts[intent] = 0;
    }
    return {
      analyses: this.produced,
      classified: 0,
      decomposed: this.decomposedCount,
      intentCounts,
      totalTerms: 0,
      distinctTerms: 0,
      avgConfidence: this.produced === 0 ? 0 : this.confidenceSum / this.produced,
      avgDurationMs: this.produced === 0 ? 0 : this.durationSum / this.produced,
    };
  }

  /**
   * Clear the attached cache (when one is configured).
   *
   * @returns `true` when a cache was cleared, `false` when no store is attached
   */
  clearCache(): boolean {
    if (!this.store) {
      return false;
    }
    this.store.clear();
    return true;
  }

  /**
   * Resolve the effective expansion setting for a call.
   *
   * Per-call options win over the configured default; `false` disables
   * expansion; a configured {@link ExpansionConfig} is merged over the default
   * synonym/thesaurus tables via {@link resolveExpansionConfig}.
   *
   * @param override - the per-call override (may be `undefined`)
   * @returns a resolved expansion configuration, or `null` when disabled
   */
  private resolveExpansion(
    override: boolean | ExpansionConfig | undefined,
  ): ExpansionConfig | null {
    const raw = override !== undefined ? override : this.config.expand;
    if (raw === false) {
      return null;
    }
    return resolveExpansionConfig(raw === true ? undefined : raw);
  }

  /**
   * The effective {@link IntentPattern} list for an intent.
   *
   * The configured per-intent patterns are concatenated over the defaults so
   * callers can augment without losing the baseline classifier.
   *
   * @param intent - the intent whose patterns to collect
   * @returns the merged pattern list
   */
  private patternsFor(intent: QueryIntent): readonly IntentPattern[] {
    assertQueryIntent(intent, 'intent');
    const defaults = DEFAULT_INTENT_PATTERNS[intent] ?? [];
    const custom = this.config.patterns[intent] ?? [];
    return [...defaults, ...custom];
  }

  /**
   * Build a fast term → boost lookup from the configured term rules.
   *
   * Later rules win for a given term, mirroring the merge semantics described
   * in {@link AnalysisConfig.termRules}.
   *
   * @returns a map from normalised term to boost multiplier
   */
  private ruleIndex(): Map<string, number> {
    const index = new Map<string, number>();
    for (const rule of this.config.termRules) {
      const term = rule.term.trim().toLowerCase();
      if (term.length === 0) {
        continue;
      }
      if (rule.stop) {
        index.set(term, 0);
      } else if (!index.has(term)) {
        index.set(term, rule.boost ?? 1);
      }
    }
    return index;
  }

  /**
   * Clean a sub-query segment produced by {@link QueryAnalyzer.decompose}.
   *
   * Strips leading comparative/exploratory fillers ("compare", "difference
   * between", "what is", "tell me about") and trailing connectors, then
   * normalises whitespace.
   *
   * @param segment - the raw split segment
   * @returns the cleaned segment
   */
  private cleanSubQuery(segment: string): string {
    let cleaned = segment
      .trim()
      .replace(/^(?:compare|comparing|comparison)\s+/i, '')
      .replace(/^(?:the\s+)?difference\s+between\s+/i, '')
      .replace(/^(?:what\s+is|what\s+are|which\s+is|which\s+are|tell\s+me\s+about|learn\s+about)\s+/i, '')
      .replace(/^(?:and|or)\s+/i, '')
      .replace(/\s+(?:and|or)$/i, '')
      .trim();
    if (cleaned.length === 0) {
      return segment.trim();
    }
    return cleaned;
  }
}