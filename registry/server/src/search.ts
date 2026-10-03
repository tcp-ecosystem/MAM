/**
 * MAM Search Engine
 *
 * Full-text search for MAM modules.
 *
 * The index is a pair of inverted indexes rather than a map from module name
 * to the record, so a query narrows candidates instead of scanning the whole
 * corpus:
 *
 * - `gramIndex` maps a character n-gram to the module names whose searchable
 *   blob contains it. It drives `search()`.
 * - `nameIndex` maps a character prefix of a lowercased module name to the
 *   module names. It drives `getSuggestions()`.
 *
 * Why grams and not words
 * ----------------------
 * The behaviour of `search()` is `blob.includes(query)`: a substring match, not
 * a word match. A word-level token index cannot reproduce that. `pipe` is a
 * prefix of the word `pipeline` but an *inner* fragment - `peline` - is a
 * substring of `pipeline` and not a prefix of it, so any index keyed on words
 * or word prefixes either misses `peline` (behaviour change) or has to index
 * every substring of every word, which is O(word length squared).
 *
 * Character n-grams of bounded length are the standard way to keep substring
 * semantics while narrowing. Any blob that contains a query of length n
 * necessarily contains that query's first min(n, MAX) characters, so the
 * posting list of any one of its grams is a *guaranteed superset* of the true
 * match set. The engine then confirms each candidate with the original
 * `includes`, which is what keeps scoring, highlights and `total` byte-for-byte
 * identical to a linear scan. Choosing the rarest gram of the query makes the
 * candidate list as small as the index allows.
 *
 * `getRecent()` and `getPopular()` still visit every module: they rank the
 * whole corpus rather than answering a question about it, so there is nothing
 * to narrow to.
 */

import { ModuleRecord } from './store.js';

// ============================================================================
// Types
// ============================================================================

export type SearchSort = 'relevance' | 'downloads' | 'updated' | 'name';

export interface SearchQuery {
  /** Search text */
  text: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by author */
  author?: string;
  /** Sort order. Defaults to `relevance`. */
  sort?: SearchSort;
  /** Results limit, clamped to 1..100. Defaults to 20. */
  limit?: number;
  /** Results offset, never negative. Defaults to 0. */
  offset?: number;
  /** Include archived modules. Defaults to false. */
  includeArchived?: boolean;
}

export interface SearchResults {
  /** Found modules */
  modules: SearchResultItem[];
  /** Total count, before pagination */
  total: number;
  /** Search time in ms */
  timeMs: number;
}

export interface SearchResultItem {
  /** Module name */
  name: string;
  /** Module version */
  version: string;
  /** Module description */
  description: string;
  /** Module author */
  author: string;
  /** Module tags */
  tags: string[];
  /** Relevance score */
  score: number;
  /** Match highlights */
  highlights: string[];
}

// ============================================================================
// Limits
// ============================================================================

/** Smallest page a caller can ask for. */
export const MIN_SEARCH_LIMIT = 1;
/** Largest page a caller can ask for, so one request cannot dump the index. */
export const MAX_SEARCH_LIMIT = 100;
/** Page size used when the caller does not ask for one. */
export const DEFAULT_SEARCH_LIMIT = 20;

// ============================================================================
// Index shape
// ============================================================================

/** Shortest gram indexed. A one-character query is still narrowed, not scanned. */
const MIN_GRAM_LENGTH = 1;
/**
 * Longest gram indexed.
 *
 * Three is the standard choice: it is the shortest length at which grams stop
 * being near-universal across a corpus, and any query at least this long is
 * narrowed by its own grams.
 */
const MAX_GRAM_LENGTH = 3;
/**
 * How many distinct grams of a query are probed when picking the rarest one.
 *
 * The work has to stay bounded: without a cap, a query is as expensive to
 * prepare as the corpus is to scan, and a pathological multi-kilobyte query
 * would turn into tens of thousands of map lookups.
 */
const MAX_QUERY_GRAM_SAMPLE = 12;
/** Only the first this many characters of a query contribute to the sample. */
const MAX_QUERY_GRAM_SCAN = 64;

/**
 * Clamps a requested page size.
 *
 * `limit: 0` used to mean "no limit" here and quietly became the default
 * instead, so a caller asking for nothing got twenty rows. Anything that is
 * not a real number falls back to the default; anything out of range is
 * pulled to the nearest bound.
 */
export function normalizeSearchLimit(
  limit: number | undefined,
  fallback: number = DEFAULT_SEARCH_LIMIT,
  max: number = MAX_SEARCH_LIMIT
): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) return fallback;
  return Math.max(MIN_SEARCH_LIMIT, Math.min(Math.floor(limit), max));
}

/** Clamps an offset to a non-negative integer. */
export function normalizeSearchOffset(offset: number | undefined): number {
  if (offset === undefined || offset === null || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

/** Timestamp of a record's last change, with unparseable values treated as epoch. */
function updatedTime(module: ModuleRecord): number {
  const parsed = Date.parse(module.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function byName(a: ModuleRecord, b: ModuleRecord): number {
  return a.name.localeCompare(b.name);
}

/**
 * Compares two modules for the non-relevance sort orders.
 *
 * Every order ends in a name comparison so the same query returns the same
 * order twice, whatever order the index was built in.
 *
 * `relevance` needs a score that only the search loop has, so it falls through
 * to the name tiebreak here and is handled by the caller.
 *
 * `downloads` is deliberately not implemented: the store does not record
 * download counts, so ordering by them would be an invented signal. It sorts
 * by name, which at least is stable and honest about what is being ordered.
 */
export function compareModulesBySort(
  a: ModuleRecord,
  b: ModuleRecord,
  sort: SearchSort
): number {
  switch (sort) {
    case 'updated':
      return updatedTime(b) - updatedTime(a) || byName(a, b);
    case 'name':
    case 'downloads':
    default:
      return byName(a, b);
  }
}

/** True when a record should be hidden unless the caller opted into archived. */
function isHidden(record: ModuleRecord, includeArchived: boolean): boolean {
  return record.archived === true && !includeArchived;
}

// ============================================================================
// Inverted index helpers
// ============================================================================

/** A posting list: one term to the module names carrying it. */
type Postings = Map<string, Set<string>>;

function addPosting(postings: Postings, term: string, moduleName: string): void {
  const existing = postings.get(term);
  if (existing) {
    existing.add(moduleName);
    return;
  }
  postings.set(term, new Set([moduleName]));
}

/** Removes a module from a posting list, dropping the term once it is empty. */
function removePosting(postings: Postings, term: string, moduleName: string): void {
  const existing = postings.get(term);
  if (!existing) return;
  existing.delete(moduleName);
  if (existing.size === 0) {
    postings.delete(term);
  }
}

/**
 * Every character gram of `text`, shortest first.
 *
 * Duplicates are collapsed by the caller through the `Set` it probes with; a
 * blob that says "aaaa" has one distinct unigram, not four.
 */
function gramsOf(text: string, minLength: number, maxLength: number): string[] {
  const grams: string[] = [];
  const longest = Math.min(maxLength, text.length);
  for (let size = minLength; size <= longest; size++) {
    for (let i = 0; i + size <= text.length; i++) {
      grams.push(text.slice(i, i + size));
    }
  }
  return grams;
}

/** Adds every gram of `text` to `postings` under `moduleName`. */
function indexGrams(
  postings: Postings,
  text: string,
  minLength: number,
  maxLength: number,
  moduleName: string
): void {
  for (const gram of gramsOf(text, minLength, maxLength)) {
    addPosting(postings, gram, moduleName);
  }
}

/** Removes every gram of `text` from `postings`. Recomputed, never stored twice. */
function unindexGrams(
  postings: Postings,
  text: string,
  minLength: number,
  maxLength: number,
  moduleName: string
): void {
  for (const gram of gramsOf(text, minLength, maxLength)) {
    removePosting(postings, gram, moduleName);
  }
}

// ============================================================================
// Search Engine
// ============================================================================

export class SearchEngine {
  private index: Map<string, SearchIndexEntry> = new Map();
  /** character gram of the searchable blob -> module names. Drives `search()`. */
  private gramIndex: Postings = new Map();
  /** character prefix of the lowercased name -> module names. Drives suggestions. */
  private nameIndex: Postings = new Map();
  /** how many entries the last `search()` scored, after narrowing */
  private _lastCandidateCount = 0;

  /**
   * Index a module
   *
   * Re-indexing a name replaces the entry: the old blob's grams are withdrawn
   * from the inverted index before the new ones are added, so a second publish
   * updates the posting lists instead of leaving a stale duplicate behind.
   */
  indexModule(module: ModuleRecord): void {
    // `tags` is normalised on write, but an index must never crash on a record
    // it did not create: a module stored before the normalisation, or by a
    // future writer, still has to index.
    const text = [
      module.name ?? '',
      module.description ?? '',
      module.author ?? '',
      ...(Array.isArray(module.tags) ? module.tags : []),
    ].join(' ').toLowerCase();

    this.unindexModule(module.name);
    this.index.set(module.name, {
      name: module.name,
      text,
      module,
    });
    indexGrams(this.gramIndex, text, MIN_GRAM_LENGTH, MAX_GRAM_LENGTH, module.name);
    indexGrams(this.nameIndex, module.name.toLowerCase(), 1, module.name.length, module.name);
  }

  /**
   * Withdraws a module from the index and both inverted indexes.
   *
   * The entry is looked up rather than rebuilt, because a module that was
   * replaced in the store would otherwise leave the old text's grams behind.
   */
  private unindexModule(name: string): void {
    const existing = this.index.get(name);
    if (!existing) return;
    unindexGrams(this.gramIndex, existing.text, MIN_GRAM_LENGTH, MAX_GRAM_LENGTH, name);
    unindexGrams(this.nameIndex, name.toLowerCase(), 1, name.length, name);
    this.index.delete(name);
  }

  /**
   * Index a batch of modules
   */
  indexModules(modules: Iterable<ModuleRecord>): void {
    for (const module of modules) {
      this.indexModule(module);
    }
  }

  /**
   * Empty the index and rebuild it from `modules`
   *
   * Reindexing is the safe way to resync: anything that was in the index and
   * is not in `modules` disappears, rather than lingering as a ghost result.
   */
  reindex(modules: Iterable<ModuleRecord> = []): void {
    this.clearIndex();
    this.indexModules(modules);
  }

  /**
   * Remove module from index
   */
  removeModule(name: string): void {
    this.unindexModule(name);
  }

  /**
   * Search modules
   */
  async search(query: string | SearchQuery): Promise<SearchResults> {
    const startTime = performance.now();

    const searchQuery = typeof query === 'string' ? { text: query } : query;
    const text = (searchQuery.text ?? '').toLowerCase();
    const limit = normalizeSearchLimit(searchQuery.limit);
    const offset = normalizeSearchOffset(searchQuery.offset);
    const sort: SearchSort = searchQuery.sort ?? 'relevance';
    const includeArchived = searchQuery.includeArchived === true;

    // Narrow first, score second. The candidate list is a superset of the
    // substring matches, so the `includes` below is still the thing that
    // decides a match – the index only decides what is worth looking at.
    const candidates = this.narrowCandidates(text);
    this._lastCandidateCount = candidates === null ? this.index.size : candidates.length;

    const matches: ScoredEntry[] = [];

    for (const entry of candidates ?? this.index.values()) {
      // Archived modules stay resolvable by name, but they are not discoverable
      // unless a caller explicitly asks for them.
      if (isHidden(entry.module, includeArchived)) {
        continue;
      }

      // Check text match
      if (text && !entry.text.includes(text)) {
        continue;
      }

      // Check tag filter
      if (searchQuery.tags && searchQuery.tags.length > 0) {
        const hasTag = searchQuery.tags.some(tag =>
          entry.module.tags.includes(tag)
        );
        if (!hasTag) continue;
      }

      // Check author filter
      if (searchQuery.author && entry.module.author !== searchQuery.author) {
        continue;
      }

      // Calculate score
      const score = this.calculateScore(entry, text);

      // Generate highlights
      const highlights = this.generateHighlights(entry, text);

      matches.push({
        module: entry.module,
        item: {
          name: entry.module.name,
          version: entry.module.latest,
          description: entry.module.description,
          author: entry.module.author,
          tags: entry.module.tags,
          score,
          highlights,
        },
      });
    }

    this.sortEntries(matches, sort);

    // Paginate
    const paginatedResults = matches.slice(offset, offset + limit).map(m => m.item);

    return {
      modules: paginatedResults,
      total: matches.length,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Get suggestions
   *
   * Ranked by name. Returning index insertion order made suggestions depend on
   * the order modules happened to be published in.
   *
   * The name prefix index answers this directly, so only the modules that
   * actually start with the prefix are visited.
   */
  getSuggestions(prefix: string, limit: number = 10, includeArchived: boolean = false): string[] {
    const lowerPrefix = (prefix ?? '').toLowerCase();
    const max = normalizeSearchLimit(limit, 10);
    const suggestions: string[] = [];

    // An empty prefix matches every name, and no such prefix is stored, so
    // that one case still walks the index.
    const postings = lowerPrefix === '' ? undefined : this.nameIndex.get(lowerPrefix);
    if (lowerPrefix !== '' && !postings) {
      return suggestions;
    }

    const names: Iterable<string> = postings ? postings.values() : this.index.keys();
    for (const name of names) {
      const entry = this.index.get(name);
      if (!entry || isHidden(entry.module, includeArchived)) continue;
      suggestions.push(entry.name);
    }

    suggestions.sort((a, b) => a.localeCompare(b));
    return suggestions.slice(0, max);
  }

  /**
   * Get popular modules
   *
   * Ranked by how many versions a module has published, then by name. The
   * store does not track downloads, so a genuinely "most downloaded" list is
   * not computable yet; release history is a real signal and, unlike insertion
   * order, it is the same on every call. The version count is carried in
   * `score` so the ranking is visible in the response instead of being buried
   * in a comparator.
   *
   * Every module has to be considered: this ranks the whole corpus rather than
   * answering a question about it, so there is no candidate set to narrow to.
   */
  getPopular(limit: number = 10, includeArchived: boolean = false): SearchResultItem[] {
    const max = normalizeSearchLimit(limit, 10);
    const modules: ScoredEntry[] = [];

    for (const [, entry] of this.index) {
      if (isHidden(entry.module, includeArchived)) continue;
      const versionCount = Object.keys(entry.module.versions).length;
      modules.push({
        module: entry.module,
        item: {
          name: entry.module.name,
          version: entry.module.latest,
          description: entry.module.description,
          author: entry.module.author,
          tags: entry.module.tags,
          score: versionCount,
          highlights: [],
        },
      });
    }

    modules.sort((a, b) => b.item.score - a.item.score || compareModulesBySort(a.module, b.module, 'name'));

    return modules.slice(0, max).map(m => m.item);
  }

  /**
   * Get recent modules
   *
   * Like {@link getPopular} this orders the entire corpus, so every module is
   * visited; the only work saved is the text blob, which is never needed here.
   */
  getRecent(limit: number = 10, includeArchived: boolean = false): SearchResultItem[] {
    const max = normalizeSearchLimit(limit, 10);
    const modules: ScoredEntry[] = [];

    for (const [, entry] of this.index) {
      if (isHidden(entry.module, includeArchived)) continue;
      modules.push({
        module: entry.module,
        item: {
          name: entry.module.name,
          version: entry.module.latest,
          description: entry.module.description,
          author: entry.module.author,
          tags: entry.module.tags,
          score: 1,
          highlights: [],
        },
      });
    }

    this.sortEntries(modules, 'updated');

    return modules.slice(0, max).map(m => m.item);
  }

  /**
   * Clear index
   */
  clearIndex(): void {
    this.index.clear();
    this.gramIndex.clear();
    this.nameIndex.clear();
    this._lastCandidateCount = 0;
  }

  /** Alias for {@link clearIndex}. */
  clear(): void {
    this.clearIndex();
  }

  /**
   * Get index size
   */
  getIndexSize(): number {
    return this.index.size;
  }

  /**
   * How many entries the most recent `search()` scored.
   *
   * Equal to `getIndexSize()` when the query was too short or too unusual to
   * narrow with. Exposed because "the index narrows the search" is otherwise an
   * unfalsifiable claim, and a regression back to a full scan should be
   * visible in a test rather than inferred from a timing threshold.
   */
  getLastCandidateCount(): number {
    return this._lastCandidateCount;
  }

  /**
   * Turns a query into the modules worth scoring.
   *
   * Returns `null` when the index cannot narrow the query and the caller must
   * scan, and an array (possibly empty) when it can. An empty array is a real
   * answer: a gram the index has never seen cannot occur in any indexed blob,
   * so nothing can contain the query.
   *
   * Soundness: if a blob contains `text` then it contains every gram of
   * `text`, so the posting list of *any* single gram of the query is a superset
   * of the matches. The rarest gram is picked to make that superset small.
   */
  private narrowCandidates(text: string): SearchIndexEntry[] | null {
    if (text.length < MIN_GRAM_LENGTH) return null;

    const probeEnd = Math.min(text.length, MAX_QUERY_GRAM_SCAN);
    const probed = new Set<string>();
    let best: Set<string> | null = null;

    // Longest grams first: they are the most selective, and the sample budget
    // runs out long before the short ones are worth looking at.
    scan: for (let size = Math.min(MAX_GRAM_LENGTH, text.length); size >= MIN_GRAM_LENGTH; size--) {
      for (let i = 0; i + size <= probeEnd; i++) {
        const gram = text.slice(i, i + size);
        if (probed.has(gram)) continue;
        const postings = this.gramIndex.get(gram);
        if (!postings) return [];
        probed.add(gram);
        if (best === null || postings.size < best.size) best = postings;
        if (probed.size >= MAX_QUERY_GRAM_SAMPLE) break scan;
      }
    }

    if (best === null) return null;

    const candidates: SearchIndexEntry[] = [];
    for (const name of best) {
      const entry = this.index.get(name);
      if (entry) candidates.push(entry);
    }
    return candidates;
  }

  /**
   * Applies the requested order in place.
   *
   * `relevance` is the only order that needs the score computed during the
   * search loop, so it is handled here and the rest is delegated.
   */
  private sortEntries(entries: ScoredEntry[], sort: SearchSort): void {
    entries.sort((a, b) => {
      if (sort === 'relevance') {
        return b.item.score - a.item.score || compareModulesBySort(a.module, b.module, 'name');
      }
      return compareModulesBySort(a.module, b.module, sort);
    });
  }

  private calculateScore(entry: SearchIndexEntry, query: string): number {
    let score = 0;

    // Exact name match
    if (entry.name.toLowerCase() === query) {
      score += 100;
    }
    // Name starts with query
    else if (entry.name.toLowerCase().startsWith(query)) {
      score += 50;
    }
    // Name contains query
    else if (entry.name.toLowerCase().includes(query)) {
      score += 25;
    }

    // Description contains query
    if (entry.module.description.toLowerCase().includes(query)) {
      score += 10;
    }

    // Tags contain query
    if (entry.module.tags.some(tag => tag.toLowerCase().includes(query))) {
      score += 15;
    }

    return score;
  }

  private generateHighlights(entry: SearchIndexEntry, query: string): string[] {
    const highlights: string[] = [];
    const desc = entry.module.description;
    const lowerDesc = desc.toLowerCase();
    const lowerQuery = query.toLowerCase();

    const index = lowerDesc.indexOf(lowerQuery);
    if (index !== -1) {
      const start = Math.max(0, index - 40);
      const end = Math.min(desc.length, index + query.length + 40);
      let snippet = desc.slice(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < desc.length) snippet = snippet + '...';
      highlights.push(snippet);
    }

    return highlights;
  }
}

interface SearchIndexEntry {
  name: string;
  text: string;
  module: ModuleRecord;
}

/** A result item kept next to the record it came from, so it can be ordered. */
interface ScoredEntry {
  module: ModuleRecord;
  item: SearchResultItem;
}
