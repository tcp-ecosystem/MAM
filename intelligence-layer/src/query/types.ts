/**
 * Core domain types for the MAM Intelligence Query understanding layer.
 *
 * The Query understanding layer is the first stage of the Intelligence
 * engine's processing pipeline. Given a free-text user query, it produces a
 * structured {@link QueryAnalysis} that downstream stages (retrieval
 * orchestrators, knowledge fusion, generation planners) can rely on without
 * re-parsing raw text. This module defines the entire public contract of that
 * stage:
 *
 * - {@link QueryIntent} — the coarse semantic goal of a query.
 * - {@link IntentSignal} — a classified intent together with the evidence that
 *   produced it.
 * - {@link QueryAnalysis} — the full, serialisable output of one analysis.
 * - {@link ExpansionConfig} / {@link AnalysisConfig} / {@link AnalyzeOptions} —
 *   the knobs that control normalisation, classification, expansion and
 *   decomposition.
 * - {@link AnalysisStats} — aggregate counters describing a store, index or
 *   analyzer.
 *
 * Every type in this module is deliberately **framework-agnostic and
 * JSON-serialisable**: a {@link QueryAnalysis} produced in one process can be
 * persisted with {@link QueryStore.toJSON} and restored in another without any
 * schema migration. Strings are the only currency — no DOM, Buffer or platform
 * types leak into the contract.
 *
 * ## The analysis pipeline at a glance
 *
 * 1. **Normalise** the raw text (lowercase, trim, collapse whitespace).
 * 2. **Classify** the intent via keyword-pattern scoring, yielding an
 *    {@link IntentSignal} with a calibrated confidence.
 * 3. **Extract** salient terms (tokenise, stop-word filter, frequency rank).
 * 4. **Expand** the term set with synonyms / thesaurus entries when configured.
 * 5. **Decompose** the query into sub-queries when it is comparative or
 *    exploratory.
 * 6. Assemble everything into a {@link QueryAnalysis} and (optionally) cache it.
 *
 * @packageDocumentation
 * @module query/types
 */

/**
 * The coarse semantic goal of a user query.
 *
 * Intents form a deliberately small, closed vocabulary so that consumers can
 * switch on the value exhaustively. The taxonomy:
 *
 * - `'factoid'` — a direct, answerable question about a fact
 *   ("what is the capital of France?").
 * - `'howto'` — a request for instructions or a procedure
 *   ("how do I configure TLS?").
 * - `'comparison'` — a request to contrast two or more subjects
 *   ("Postgres vs MySQL").
 * - `'exploration'` — a broad, open-ended request to survey a topic
 *   ("tell me about reinforcement learning").
 * - `'summarization'` — a request to condense existing material
 *   ("summarize the Q3 report").
 * - `'unknown'` — none of the above could be established with confidence.
 *
 * Custom intents should be layered on top of this type (e.g. via a wrapper
 * union) rather than added to it, since many consumers assume exhaustiveness.
 */
export type QueryIntent =
  | 'factoid'
  | 'howto'
  | 'comparison'
  | 'exploration'
  | 'summarization'
  | 'unknown';

/**
 * All recognised intents in canonical order, newest-signal last.
 *
 * Useful for iteration, statistics histograms and validation loops. The
 * `'unknown'` intent is always the final member.
 */
export const QUERY_INTENTS: readonly QueryIntent[] = [
  'factoid',
  'howto',
  'comparison',
  'exploration',
  'summarization',
  'unknown',
];

/**
 * Type guard for {@link QueryIntent}.
 *
 * @param value - any value, typically from untrusted input or a JSON round-trip
 * @returns `true` when `value` is one of the recognised intents
 */
export function isQueryIntent(value: unknown): value is QueryIntent {
  return typeof value === 'string' && (QUERY_INTENTS as readonly string[]).includes(value);
}

/**
 * Assert that a value is a recognised {@link QueryIntent}.
 *
 * @param value - the value to check
 * @param label - optional label used in the error message for context
 * @returns the narrowed intent
 * @throws {TypeError} when `value` is not a recognised intent
 */
export function assertQueryIntent(value: unknown, label = 'intent'): QueryIntent {
  if (!isQueryIntent(value)) {
    throw new TypeError(
      `assertQueryIntent: expected ${label} to be one of ${QUERY_INTENTS.join(', ')}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * A single intent classification result with its supporting evidence.
 *
 * Produced by {@link QueryAnalyzer.classifyIntent}. The `confidence` is a
 * value in `[0, 1]`; the `reasons` array records *why* the classifier chose the
 * intent, which is invaluable for debugging, observability and for explaining
 * downstream behaviour to users.
 */
export interface IntentSignal {
  /**
   * The classified intent. When no signal could be established this is
   * `'unknown'`.
   */
  readonly intent: QueryIntent;

  /**
   * Calibrated confidence in `[0, 1]`. Values below the configured
   * `intentThreshold` cause {@link QueryAnalyzer.analyze} to downgrade the
   * intent to `'unknown'`.
   */
  readonly confidence: number;

  /**
   * Human-readable evidence strings describing which patterns fired and with
   * what strength. Sorted by descending contribution.
   */
  readonly reasons: readonly string[];
}

/**
 * A weighted keyword/regex pattern used to score a query against an intent.
 *
 * Patterns are matched as *regular expressions* against the normalised query.
 * The `weight` controls how strongly a match contributes to the intent's
 * score, and the `reason` is recorded verbatim into {@link IntentSignal.reasons}
 * so classifier decisions remain explainable.
 */
export interface IntentPattern {
  /**
   * Regular expression tested against the normalised (lowercased, trimmed)
   * query text. Should be case-insensitive where the pattern relies on
   * letters, since normalisation already lowercases.
   */
  readonly pattern: RegExp;

  /**
   * Positive contribution added to the intent's raw score when `pattern`
   * matches. Higher-weight patterns dominate weaker ones.
   */
  readonly weight: number;

  /**
   * Short human-readable description of the evidence, e.g.
   * `"contains comparative connector 'vs'"`.
   */
  readonly reason: string;
}

/**
 * Controls synonym / thesaurus expansion for a query.
 *
 * Expansion widens a query's term set so that downstream retrieval matches
 * documents that paraphrase the query rather than merely repeating its exact
 * tokens. The two lookup tables serve different purposes:
 *
 * - {@link synonyms} maps a **term** to its alternates ("car" → "automobile",
 *   "vehicle"), used to broaden individual extracted terms.
 * - {@link thesaurus} maps a **concept** to a phrase cluster ("machine
 *   learning" → ["neural network", "deep learning"]), used to add entire
 *   related phrases when the concept appears anywhere in the query.
 *
 * Both tables are case-insensitive at lookup time (keys are compared after
 * lowercasing).
 */
export interface ExpansionConfig {
  /**
   * Maximum number of terms in the expanded set. When reached, remaining
   * synonyms are skipped. `0` (default) means "no explicit cap beyond
   * {@link AnalysisConfig.maxTerms}".
   */
  readonly maxTerms?: number;

  /**
   * Term → alternate-term table. Values are lowercased alternate terms that
   * are each candidates for inclusion in the expanded set.
   */
  readonly synonyms?: Readonly<Record<string, readonly string[]>>;

  /**
   * Concept → phrase-cluster table. Any cluster member appearing in the query
   * pulls the whole cluster into the expanded set.
   */
  readonly thesaurus?: Readonly<Record<string, readonly string[]>>;
}

/**
 * A rule expressing how a specific term should be treated during extraction.
 *
 * Supports both hard exclusion (a stop word) and score weighting (a
 * domain term that should rank higher than its raw frequency would suggest).
 */
export interface TermRule {
  /**
   * The lowercased term the rule applies to.
   */
  readonly term: string;

  /**
   * When `true`, the term is always excluded from extraction regardless of
   * its frequency.
   */
  readonly stop?: boolean;

  /**
   * Multiplier applied to the term's raw frequency when ranking. Values
   * greater than `1` boost domain terms; values below `1` damp noise.
   */
  readonly boost?: number;
}

/**
 * Full configuration for the {@link QueryAnalyzer}.
 *
 * Every field is optional; {@link DEFAULT_ANALYSIS_CONFIG} supplies safe
 * defaults. The config is a plain, serialisable-ish object (RegExps aside) so
 * it can be assembled from a JSON settings file and validated with the guards
 * in this module.
 */
export interface AnalysisConfig {
  /**
   * Lowercased terms that are never extracted as salient terms. When omitted,
   * {@link DEFAULT_STOPWORDS} is used.
   */
  readonly stopwords?: readonly string[];

  /**
   * Minimum character length for an extracted term. Shorter tokens are
   * discarded. Defaults to 2.
   */
  readonly minTermLength?: number;

  /**
   * Maximum number of terms kept in {@link QueryAnalysis.terms}. Defaults to 8.
   */
  readonly maxTerms?: number;

  /**
   * Confidence threshold in `[0, 1]`. A classified intent whose confidence is
   * below the threshold is downgraded to `'unknown'`. Defaults to 0.35.
   */
  readonly intentThreshold?: number;

  /**
   * Per-intent {@link IntentPattern} sets used by classification. When
   * omitted, {@link DEFAULT_INTENT_PATTERNS} is used. When supplied, the
   * provided patterns are *merged over* the defaults (per-intent arrays are
   * concatenated), so callers can augment without losing the baseline.
   */
  readonly patterns?: Readonly<Partial<Record<QueryIntent, readonly IntentPattern[]>>>;

  /**
   * Enable synonym / thesaurus expansion. `true` uses {@link ExpansionConfig}
   * defaults merged over {@link DEFAULT_QUERY_SYNONYMS}; an object supplies
   * custom tables. Defaults to `true`.
   */
  readonly expand?: boolean | ExpansionConfig;

  /**
   * Enable decomposition of comparative / exploratory queries into sub-queries.
   * Defaults to `true`.
   */
  readonly decompose?: boolean;

  /**
   * Enable lightweight language detection. Defaults to `true`.
   */
  readonly detectLanguage?: boolean;

  /**
   * Additional {@link TermRule}s merged over {@link DEFAULT_TERM_RULES}.
   */
  readonly termRules?: readonly TermRule[];

  /**
   * Optional clock used for `analyzedAt` timestamps. Injecting a clock makes
   * the analyzer deterministic under test.
   */
  readonly now?: () => number;
}

/**
 * Per-call options for {@link QueryAnalyzer.analyze}.
 *
 * Options override the analyzer's configured defaults for a single call,
 * allowing callers to e.g. request a deeper expansion or skip the cache without
 * mutating shared state.
 */
export interface AnalyzeOptions {
  /**
   * Override for {@link AnalysisConfig.expand} for this call only.
   */
  readonly expand?: boolean | ExpansionConfig;

  /**
   * Override for {@link AnalysisConfig.decompose} for this call only.
   */
  readonly decompose?: boolean;

  /**
   * Override for {@link AnalysisConfig.detectLanguage} for this call only.
   */
  readonly detectLanguage?: boolean;

  /**
   * Override for {@link AnalysisConfig.intentThreshold} for this call only.
   */
  readonly intentThreshold?: number;

  /**
   * Override for {@link AnalysisConfig.maxTerms} for this call only.
   */
  readonly maxTerms?: number;

  /**
   * When `true` (default), the result is read from / written to the analyzer's
   * attached {@link QueryStore} cache when one is configured. Set to `false`
   * to force a fresh analysis.
   */
  readonly useCache?: boolean;

  /**
   * When `true`, the result is stored in the attached cache (default) rather
   * than only being read from it.
   */
  readonly cacheResult?: boolean;
}

/**
 * A complete, serialisable result of analysing one query.
 *
 * This is the primary output of the Query understanding layer and the unit of
 * caching in {@link QueryStore} and indexing in {@link QueryIndex}. All string
 * fields are fully normalised and all arrays are deduplicated and ordered.
 */
export interface QueryAnalysis {
  /**
   * Stable content-addressed identifier derived from `normalized`. Two
   * analyses of the same normalised text always share an id, which is what
   * makes {@link QueryStore.getFor} work.
   */
  readonly id: string;

  /**
   * The exact query text the caller supplied, verbatim.
   */
  readonly original: string;

  /**
   * The normalised query text (lowercased, trimmed, whitespace-collapsed).
   */
  readonly normalized: string;

  /**
   * The classified {@link QueryIntent}, downgraded to `'unknown'` when the
   * classification confidence fell below the configured threshold.
   */
  readonly intent: QueryIntent;

  /**
   * The salient extracted terms, ordered by descending frequency. May be empty
   * for very short or stop-word-only queries.
   */
  readonly terms: readonly string[];

  /**
   * The expanded term set when expansion was enabled and produced additions;
   * otherwise the same content as {@link terms}. When present it is a superset
   * of `terms` (original terms plus synonyms/thesaurus members).
   */
  readonly expanded?: readonly string[];

  /**
   * Sub-queries produced by decomposition. Present only when decomposition was
   * enabled *and* the query contained enough structure to split on
   * (`'vs'`, `'versus'`, `'and'`, `'or'`, `'compare'`). When absent, the query
   * was atomic.
   */
  readonly subQueries?: readonly string[];

  /**
   * Candidate named entities (uppercase-proper-noun sequences, numeric
   * quantities, version numbers) recognised during extraction. May be empty.
   */
  readonly entities?: readonly string[];

  /**
   * Detected natural language (a small ISO-639-1-ish code such as `'en'`,
   * `'es'`, `'fr'`, `'de'`), or `'unknown'` when detection is disabled or no
   * signal was found.
   */
  readonly language?: string;

  /**
   * Confidence in `[0, 1]` carried from the {@link IntentSignal}.
   */
  readonly confidence: number;

  /**
   * Epoch-millisecond time at which the analysis was produced.
   */
  readonly analyzedAt: number;

  /**
   * Wall-clock milliseconds spent producing the analysis.
   */
  readonly durationMs: number;
}

/**
 * Aggregate statistics describing the contents of a store, index or analyzer.
 *
 * All fields are computed on demand by {@link QueryStore.stats},
 * {@link QueryIndex.stats} and {@link QueryAnalyzer.stats}, guaranteeing
 * freshness at the cost of an O(n) scan for large collections.
 */
export interface AnalysisStats {
  /**
   * Total number of analyses held (store entries or indexed analyses).
   */
  readonly analyses: number;

  /**
   * Number of analyses whose intent was classified (non-`'unknown'`).
   */
  readonly classified: number;

  /**
   * Number of analyses that were decomposed into at least two sub-queries.
   */
  readonly decomposed: number;

  /**
   * Histogram of intent counts. Only intents observed at least once appear.
   */
  readonly intentCounts: Readonly<Partial<Record<QueryIntent, number>>>;

  /**
   * Sum of all term counts across the analysed queries.
   */
  readonly totalTerms: number;

  /**
   * Number of distinct terms observed across the analysed queries.
   */
  readonly distinctTerms: number;

  /**
   * Mean classification confidence across analysed queries, or `0` when empty.
   */
  readonly avgConfidence: number;

  /**
   * Mean analysis duration in milliseconds, or `0` when empty.
   */
  readonly avgDurationMs: number;
}

/**
 * Result of a single cache write in {@link QueryStore.putMany}.
 *
 * Useful for callers that need to know which analyses were accepted, which were
 * skipped (e.g. because the id collided with an existing entry and `overwrite`
 * was disabled), and how many entries the cache now holds.
 */
export interface PutManyResult {
  /**
   * Number of analyses successfully stored.
   */
  readonly stored: number;

  /**
   * Number of analyses skipped because their id already existed and
   * `overwrite` was `false`.
   */
  readonly skipped: number;

  /**
   * Ids of the stored analyses.
   */
  readonly storedIds: readonly string[];

  /**
   * Ids of the skipped analyses.
   */
  readonly skippedIds: readonly string[];

  /**
   * Cache size after the operation.
   */
  readonly size: number;
}

/**
 * Default stop words applied when the caller supplies none.
 *
 * Chosen to be aggressive enough to keep term lists clean without dropping
 * meaningful short query words ("ai", "vs" are deliberately absent — "vs" is
 * needed for decomposition and "ai" is a legitimate term).
 */
export const DEFAULT_STOPWORDS: readonly string[] = [
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'to',
  'of', 'in', 'on', 'at', 'by', 'with', 'from', 'up', 'about', 'into', 'over',
  'after', 'before', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'can', 'will', 'just', 'don', 'should', 'now', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why',
  'how', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
  'our', 'their', 'please', 'help', 'tell', 'show', 'give', 'make', 'using',
];

/**
 * Default term rules applied over {@link DEFAULT_STOPWORDS}.
 *
 * A small set of high-value domain terms whose ranking is boosted because raw
 * frequency alone would under-represent them in short queries.
 */
export const DEFAULT_TERM_RULES: readonly TermRule[] = [
  { term: 'ai', boost: 2 },
  { term: 'api', boost: 2 },
  { term: 'sql', boost: 2 },
  { term: 'gpt', boost: 2 },
  { term: 'ml', boost: 2 },
  { term: 'kubernetes', boost: 1.5 },
  { term: 'typescript', boost: 1.5 },
  { term: 'docker', boost: 1.5 },
  { term: 'postgres', boost: 1.5 },
];

/**
 * Default synonym tables used by expansion when the caller supplies none.
 *
 * The keys are lowercased *terms*; each value is a list of alternates that will
 * be added to the expanded term set when the key term is present in the query.
 * These are intentionally generic computer / technology synonyms so the default
 * is useful for an AI-assistant context without being domain-specific.
 */
export const DEFAULT_QUERY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ai: ['artificial intelligence', 'machine learning', 'ml'],
  ml: ['machine learning', 'ai', 'artificial intelligence'],
  mlops: ['machine learning operations', 'devops for ml'],
  api: ['application programming interface', 'interface'],
  program: ['application', 'software', 'tool', 'app'],
  programing: ['coding', 'software development', 'development'],
  programming: ['coding', 'software development', 'development'],
  server: ['backend', 'daemon', 'service'],
  database: ['db', 'data store', 'datastore', 'storage engine'],
  cloud: ['cloud computing', 'hosted services'],
  computer: ['machine', 'system'],
  network: ['networking', 'connectivity'],
  security: ['cybersecurity', 'information security', 'infosec'],
  testing: ['software testing', 'qa', 'quality assurance'],
  deployment: ['deploy', 'shipping', 'release'],
  speed: ['performance', 'throughput', 'latency'],
  performance: ['speed', 'throughput', 'latency'],
};

/**
 * Default thesaurus clusters used by expansion.
 *
 * Unlike {@link DEFAULT_QUERY_SYNONYMS} (term → alternates), a thesaurus maps a
 * *concept* to a cluster of related phrases: if any member of the cluster
 * appears in the query, the whole cluster is added to the expanded set. This
 * captures semantic neighbourhoods that a flat synonym table cannot express.
 */
export const DEFAULT_QUERY_THESAURUS: Readonly<Record<string, readonly string[]>> = {
  'machine learning': ['neural network', 'deep learning', 'supervised learning', 'model training'],
  'web development': ['frontend', 'backend', 'full stack', 'http', 'css', 'javascript'],
  'data storage': ['database', 'data warehouse', 'data lake', 'sql', 'nosql'],
  'software lifecycle': ['development', 'testing', 'deployment', 'maintenance', 'observability'],
  'artificial intelligence': ['machine learning', 'deep learning', 'nlp', 'computer vision', 'agents'],
};

/**
 * Default {@link IntentPattern} sets used by classification when the caller
 * supplies none.
 *
 * Each regex is matched against the normalised query. Weights are tuned so that
 * a single strong signal (e.g. `'vs'` for comparison) wins over a weak generic
 * one (e.g. the bare word "what" for factoid). The `reason` strings surface
 * verbatim in {@link IntentSignal.reasons} to keep decisions explainable.
 */
export const DEFAULT_INTENT_PATTERNS: Readonly<Record<QueryIntent, readonly IntentPattern[]>> = {
  factoid: [
    { pattern: /\b(what is|what are|who is|who are|when was|when did|where is|where are|define|definition of|meaning of)\b/i, weight: 2, reason: 'factoid question opener' },
    { pattern: /\b(is|are|was|were|did|does|do|can|could)\b[^?!]*\?\s*$/i, weight: 1, reason: 'ends with a yes/no auxiliary question' },
    { pattern: /[?]$/, weight: 0.5, reason: 'question mark present' },
    { pattern: /\b(how many|how much|how old|what time|what year|what date)\b/i, weight: 1.5, reason: 'quantitative factoid pattern' },
  ],
  howto: [
    { pattern: /\b(how to|how do i|how can i|how would i|how should i)\b/i, weight: 3, reason: 'explicit how-to phrase' },
    { pattern: /\b(steps? to|guide for|tutorial on|procedure for|instructions? for|walkthrough)\b/i, weight: 2, reason: 'instructional noun' },
    { pattern: /\b(configure|install|set up|setup|build|create|implement|deploy|fix|solve|troubleshoot)\b/i, weight: 1, reason: 'action-oriented verb' },
    { pattern: /\b(beginner|step[- ]by[- ]step|step 1|first step)\b/i, weight: 1.5, reason: 'step-oriented language' },
  ],
  comparison: [
    { pattern: /\b(vs\.?|versus)\b/i, weight: 3, reason: 'comparative connector "vs/versus"' },
    { pattern: /\b(compare|comparison|comparing|compared to|compared with)\b/i, weight: 2.5, reason: 'explicit compare verb' },
    { pattern: /\b(difference between|differences between)\b/i, weight: 2.5, reason: 'difference phrase' },
    { pattern: /\b(better than|worse than|which is better|which one|pros and cons|advantages|disadvantages|trade[- ]offs?)\b/i, weight: 2, reason: 'evaluative comparison language' },
    { pattern: /\b(and|or)\b.*\b(and|or)\b/i, weight: 0.5, reason: 'multiple conjuncts hint at comparison' },
  ],
  exploration: [
    { pattern: /\b(tell me about|learn about|find out about|explore|discover|what else|more about)\b/i, weight: 2, reason: 'open-ended exploration verb' },
    { pattern: /\b(overview of|introduction to|topics? (in|related)|related topics|background on)\b/i, weight: 1.5, reason: 'survey-style noun' },
    { pattern: /\b(list of|examples of|types of|kinds of|what are some|what are the main)\b/i, weight: 1.5, reason: 'enumeration-style exploration' },
    { pattern: /\b(new to|getting started with|introduction to|start learning)\b/i, weight: 1, reason: 'orientation-style phrasing' },
  ],
  summarization: [
    { pattern: /\b(summariz|summaris|summary of|summarise)\b/i, weight: 3, reason: 'summarize verb' },
    { pattern: /\b(tl;?dr|tl dr|recap|synopsis|digest|key points|main points|takeaways|highlights)\b/i, weight: 2.5, reason: 'summary noun' },
    { pattern: /\b(condense|shorten|gist of|in short|bottom line)\b/i, weight: 2, reason: 'condensation phrasing' },
    { pattern: /\b(abstract|executive summary|overview of the (report|document|paper))\b/i, weight: 1.5, reason: 'formal summary terms' },
  ],
  unknown: [
    { pattern: /\b(maybe|perhaps|i wonder|just wondering|any idea|does anyone know)\b/i, weight: 0.5, reason: 'hedged, low-signal phrasing' },
  ],
};

/**
 * Default configuration applied when the caller supplies none.
 *
 * Conservative and generally useful: extraction keeps up to eight terms of at
 * least two characters, expansion and decomposition are on, language detection
 * is on, and the confidence threshold of `0.35` prevents weak classifications
 * from being over-trusted.
 */
export const DEFAULT_ANALYSIS_CONFIG: Required<
  Pick<
    AnalysisConfig,
    | 'stopwords'
    | 'minTermLength'
    | 'maxTerms'
    | 'intentThreshold'
    | 'patterns'
    | 'expand'
    | 'decompose'
    | 'detectLanguage'
    | 'termRules'
  >
> & { now: () => number } = {
  stopwords: DEFAULT_STOPWORDS,
  minTermLength: 2,
  maxTerms: 8,
  intentThreshold: 0.35,
  patterns: DEFAULT_INTENT_PATTERNS,
  expand: true,
  decompose: true,
  detectLanguage: true,
  termRules: DEFAULT_TERM_RULES,
  now: () => Date.now(),
};

/**
 * Merge two {@link ExpansionConfig}s, later values winning per-field.
 *
 * Synonym and thesaurus *tables* are merged shallowly per key (later entries
 * win), while `maxTerms` from the later config (when set) wins outright.
 *
 * @param base - the base configuration
 * @param override - the overriding configuration (may be partial)
 * @returns a merged, plain {@link ExpansionConfig}
 */
export function mergeExpansionConfig(
  base: ExpansionConfig | undefined,
  override: ExpansionConfig | undefined,
): ExpansionConfig {
  const maxTerms =
    override?.maxTerms !== undefined ? override.maxTerms : base?.maxTerms;
  const synonyms = { ...(base?.synonyms ?? {}), ...(override?.synonyms ?? {}) };
  const thesaurus = { ...(base?.thesaurus ?? {}), ...(override?.thesaurus ?? {}) };
  return {
    ...(maxTerms !== undefined ? { maxTerms } : {}),
    synonyms,
    thesaurus,
  };
}

/**
 * Normalise a bare value into a fully-resolved {@link ExpansionConfig}.
 *
 * Accepts `true` (use defaults), `false` (disables expansion), `undefined`
 * (use defaults) or an explicit {@link ExpansionConfig}. When the caller's
 * config is an object it is merged over the default tables so custom entries
 * augment rather than replace the baseline.
 *
 * @param value - the raw expansion setting
 * @returns a resolved expansion configuration, or `null` when expansion is off
 */
export function resolveExpansionConfig(
  value: boolean | ExpansionConfig | undefined,
): ExpansionConfig | null {
  if (value === false) {
    return null;
  }
  const custom =
    typeof value === 'object' && value !== null
      ? value
      : { synonyms: undefined, thesaurus: undefined, maxTerms: undefined };
  return mergeExpansionConfig(
    {
      synonyms: DEFAULT_QUERY_SYNONYMS,
      thesaurus: DEFAULT_QUERY_THESAURUS,
    },
    custom,
  );
}

/**
 * Type guard for {@link QueryAnalysis}.
 *
 * Performs a structural (rather than `instanceof`) check so that analyses that
 * have been round-tripped through {@link JSON} — and therefore lost their
 * prototype — still validate.
 *
 * @param value - any value, typically untrusted or deserialised
 * @returns `true` when `value` is a structurally valid {@link QueryAnalysis}
 */
export function isQueryAnalysis(value: unknown): value is QueryAnalysis {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.original === 'string' &&
    typeof record.normalized === 'string' &&
    isQueryIntent(record.intent) &&
    Array.isArray(record.terms) &&
    record.terms.every((term) => typeof term === 'string') &&
    typeof record.confidence === 'number'
  );
}

/**
 * Compute a stable 32-bit content hash for a string.
 *
 * This is a Cyma/cyrb53-style double-hash: fast, deterministic across Node
 * versions and processes, and collision-resistant enough for content-addressed
 * cache keys. It intentionally does **not** use `crypto`, keeping the query
 * layer dependency-free and synchronous.
 *
 * @param text - the string to hash
 * @returns a lowercase hex digest, at most 8 characters
 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Build a {@link QueryAnalysis} from its parts.
 *
 * Factory used by {@link QueryAnalyzer.analyze} to assemble the final result.
 * The content address is derived from `normalized`, all arrays are
 * deduplicated while preserving order, and `analyzedAt` / `durationMs` are
 * filled from the clock and elapsed time.
 *
 * @param parts - the assembled fields of the analysis
 * @returns a complete, frozen {@link QueryAnalysis}
 */
export function createQueryAnalysis(parts: {
  original: string;
  normalized: string;
  intent: QueryIntent;
  terms: readonly string[];
  expanded?: readonly string[];
  subQueries?: readonly string[];
  entities?: readonly string[];
  language?: string;
  confidence: number;
  analyzedAt: number;
  durationMs: number;
}): QueryAnalysis {
  return Object.freeze({
    id: hashText(parts.normalized),
    original: parts.original,
    normalized: parts.normalized,
    intent: parts.intent,
    terms: Object.freeze(dedupeStrings(parts.terms)),
    expanded: parts.expanded ? Object.freeze(dedupeStrings(parts.expanded)) : undefined,
    subQueries: parts.subQueries ? Object.freeze(dedupeStrings(parts.subQueries)) : undefined,
    entities: parts.entities ? Object.freeze(dedupeStrings(parts.entities)) : undefined,
    language: parts.language,
    confidence: clamp01(parts.confidence),
    analyzedAt: parts.analyzedAt,
    durationMs: parts.durationMs,
  });
}

/**
 * Deduplicate an array of strings, preserving first-seen order.
 *
 * @param values - the input strings
 * @returns a new array containing each distinct string once, in order
 */
export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (cleaned.length > 0 && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * Clamp a number into the inclusive `[0, 1]` range.
 *
 * @param value - the raw value
 * @returns the clamped value
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}