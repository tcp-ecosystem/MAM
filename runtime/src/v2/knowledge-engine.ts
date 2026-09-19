import {
  KnowledgeEngine,
  KnowledgeSource,
  KnowledgeRetrievalOptions,
  KnowledgeRetrievalResult,
  KnowledgeItem,
  KnowledgeProvenance,
  KnowledgeEngineStats,
  KnowledgeSourceType,
  KnowledgeRetrievalStrategy,
} from './types.js';

interface IndexedDocument {
  id: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  indexedAt: number;
  chunks: string[];
}

interface TermFrequency {
  [term: string]: number;
}

interface InvertedIndex {
  [term: string]: Set<string>;
}

interface DocumentScores {
  [docId: string]: number;
}

interface SourceConfig {
  strategy: KnowledgeRetrievalStrategy;
  customRankingFn?: (a: KnowledgeItem, b: KnowledgeItem) => number;
}

type RankingFn = (a: KnowledgeItem, b: KnowledgeItem) => number;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to',
  'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'don', 'now', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they',
  'them', 'their', 'what', 'which', 'who', 'whom',
]);

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }
  return chunks.length > 0 ? chunks : [text];
}

function computeIdf(docCount: number, termDocCount: number): number {
  if (termDocCount === 0) return 0;
  return Math.log((docCount + 1) / (termDocCount + 1)) + 1;
}

export class DefaultKnowledgeEngine implements KnowledgeEngine {
  private sources: Map<string, KnowledgeSource> = new Map();
  private sourceConfigs: Map<string, SourceConfig> = new Map();
  private documents: Map<string, Map<string, IndexedDocument>> = new Map();
  private invertedIndex: Map<string, InvertedIndex> = new Map();
  private termFrequencies: Map<string, Map<string, TermFrequency>> = new Map();
  private documentTermCounts: Map<string, Map<string, number>> = new Map();
  private documentVectors: Map<string, Map<string, Map<string, number>>> = new Map();
  private provenance: Map<string, KnowledgeProvenance> = new Map();
  private totalRetrievals = 0;
  private totalTimeMs = 0;

  private chunkSize = DEFAULT_CHUNK_SIZE;
  private chunkOverlap = DEFAULT_CHUNK_OVERLAP;

  async addSource(source: KnowledgeSource): Promise<void> {
    if (this.sources.has(source.id)) {
      throw new Error(`Source '${source.id}' already exists`);
    }
    this.sources.set(source.id, source);
    this.sourceConfigs.set(source.id, { strategy: 'keyword' });
    this.documents.set(source.id, new Map());
    this.invertedIndex.set(source.id, {});
    this.termFrequencies.set(source.id, new Map());
    this.documentTermCounts.set(source.id, new Map());
    this.documentVectors.set(source.id, new Map());
  }

  async removeSource(sourceId: string): Promise<void> {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    const docs = this.documents.get(sourceId);
    if (docs) {
      for (const docId of docs.keys()) {
        this.removeDocumentInternal(sourceId, docId);
      }
    }
    this.documents.delete(sourceId);
    this.invertedIndex.delete(sourceId);
    this.termFrequencies.delete(sourceId);
    this.documentTermCounts.delete(sourceId);
    this.documentVectors.delete(sourceId);
    this.sources.delete(sourceId);
    this.sourceConfigs.delete(sourceId);
  }

  async retrieve(query: string, options?: KnowledgeRetrievalOptions): Promise<KnowledgeRetrievalResult> {
    const start = performance.now();
    const topK = options?.topK ?? 10;
    const threshold = options?.threshold ?? 0;
    const strategy = options?.strategy ?? 'keyword';

    const candidates = await this.searchAcrossSources(query);
    let ranked = candidates.map((item) => {
      item.score = this.scoreItem(item, query, strategy);
      return item;
    });

    ranked = ranked.filter((item) => item.score >= threshold);

    if (strategy === 'relevance' || strategy === 'hybrid') {
      ranked = ranked.sort((a, b) => b.score - a.score);
    } else if (strategy === 'recency') {
      ranked = ranked.sort((a, b) => {
        const timeA = this.provenance.get(a.id)?.retrievedAt ?? 0;
        const timeB = this.provenance.get(b.id)?.retrievedAt ?? 0;
        return timeB - timeA;
      });
    } else {
      ranked = ranked.sort((a, b) => b.score - a.score);
    }

    const configForSource = (sourceId: string) => this.sourceConfigs.get(sourceId);
    const customRanked = this.applyCustomRanking(ranked, configForSource);

    const finalItems = customRanked.slice(0, topK).map((item, idx) => {
      item.rank = idx + 1;
      return item;
    });

    const elapsed = performance.now() - start;
    this.totalRetrievals++;
    this.totalTimeMs += elapsed;

    return {
      items: finalItems,
      query,
      strategy,
      timeMs: elapsed,
      totalCandidates: candidates.length,
    };
  }

  getStats(): KnowledgeEngineStats {
    let totalItems = 0;
    for (const docs of this.documents.values()) {
      for (const doc of docs.values()) {
        totalItems += doc.chunks.length;
      }
    }
    return {
      totalSources: this.sources.size,
      totalRetrievals: this.totalRetrievals,
      averageRetrievalTimeMs: this.totalRetrievals > 0 ? this.totalTimeMs / this.totalRetrievals : 0,
      totalItemsIndexed: totalItems,
    };
  }

  async indexDocument(
    sourceId: string,
    documentId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    this.removeDocumentInternal(sourceId, documentId);
    const chunks = chunkText(content, this.chunkSize, this.chunkOverlap);
    const doc: IndexedDocument = {
      id: documentId,
      sourceId,
      content,
      metadata: metadata ?? {},
      indexedAt: Date.now(),
      chunks,
    };
    this.documents.get(sourceId)!.set(documentId, doc);
    this.indexDocumentChunks(sourceId, documentId, chunks);
  }

  async removeDocument(sourceId: string, documentId: string): Promise<void> {
    if (!this.documents.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    this.removeDocumentInternal(sourceId, documentId);
    this.documents.get(sourceId)!.delete(documentId);
  }

  getDocuments(sourceId: string): IndexedDocument[] {
    const docs = this.documents.get(sourceId);
    if (!docs) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    return Array.from(docs.values());
  }

  setStrategy(sourceId: string, strategy: KnowledgeRetrievalStrategy): void {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    const config = this.sourceConfigs.get(sourceId) ?? { strategy: 'keyword' };
    config.strategy = strategy;
    this.sourceConfigs.set(sourceId, config);
  }

  setRankingFunction(fn: RankingFn): void {
    this.globalRankingFn = fn;
  }

  private globalRankingFn?: RankingFn;

  getProvenance(itemId: string): KnowledgeProvenance | undefined {
    return this.provenance.get(itemId);
  }

  async searchAcrossSources(query: string, sourceIds?: string[]): Promise<KnowledgeItem[]> {
    const targetSources = sourceIds ?? Array.from(this.sources.keys());
    const queryTokens = tokenize(query);
    const results: KnowledgeItem[] = [];

    for (const sourceId of targetSources) {
      if (!this.sources.has(sourceId)) continue;
      const config = this.sourceConfigs.get(sourceId) ?? { strategy: 'keyword' };
      const docs = this.documents.get(sourceId);
      if (!docs) continue;

      const sourceItems = this.retrieveForSource(sourceId, queryTokens, config.strategy);
      for (const item of sourceItems) {
        this.provenance.set(item.id, item.provenance);
        results.push(item);
      }
    }

    return results;
  }

  async getTopItems(query: string, limit: number): Promise<KnowledgeItem[]> {
    const all = await this.searchAcrossSources(query);
    const scored = all.map((item) => {
      item.score = this.scoreItem(item, query, 'keyword');
      return item;
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((item, idx) => {
      item.rank = idx + 1;
      return item;
    });
  }

  async refreshIndex(sourceId: string): Promise<void> {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    this.clearIndex(sourceId);
    const docs = this.documents.get(sourceId);
    if (!docs) return;
    for (const [docId, doc] of docs.entries()) {
      this.indexDocumentChunks(sourceId, docId, doc.chunks);
    }
  }

  private indexDocumentChunks(sourceId: string, documentId: string, chunks: string[]): void {
    const invIndex = this.invertedIndex.get(sourceId)!;
    const tfMap = this.termFrequencies.get(sourceId)!;
    const dtMap = this.documentTermCounts.get(sourceId)!;
    const dvMap = this.documentVectors.get(sourceId)!;

    const source = this.sources.get(sourceId)!;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const itemId = `${sourceId}:${documentId}:${chunkIdx}`;
      const tokens = tokenize(chunk);
      const tf: TermFrequency = {};
      for (const token of tokens) {
        tf[token] = (tf[token] ?? 0) + 1;
      }

      let totalTerms = 0;
      for (const count of Object.values(tf)) {
        totalTerms += count;
      }
      const normalizedTf: TermFrequency = {};
      for (const [term, count] of Object.entries(tf)) {
        normalizedTf[term] = count / totalTerms;
      }

      tfMap.set(itemId, normalizedTf);
      dtMap.set(itemId, tokens.length);

      const tfidfVec = new Map<string, number>();
      const uniqueTerms = Object.keys(normalizedTf);
      for (const term of uniqueTerms) {
        if (!invIndex[term]) {
          invIndex[term] = new Set();
        }
        invIndex[term].add(itemId);
        tfidfVec.set(term, normalizedTf[term] ?? 0);
      }
      dvMap.set(itemId, tfidfVec);

      this.provenance.set(itemId, {
        sourceId,
        sourceName: source.name,
        retrievedAt: Date.now(),
        chunkIndex: chunkIdx,
        documentId,
      });
    }
  }

  private removeDocumentInternal(sourceId: string, documentId: string): void {
    const docs = this.documents.get(sourceId);
    const doc = docs?.get(documentId);
    if (!doc) return;

    const invIndex = this.invertedIndex.get(sourceId);
    const tfMap = this.termFrequencies.get(sourceId);
    const dtMap = this.documentTermCounts.get(sourceId);
    const dvMap = this.documentVectors.get(sourceId);

    for (let i = 0; i < doc.chunks.length; i++) {
      const itemId = `${sourceId}:${documentId}:${i}`;
      if (tfMap) tfMap.delete(itemId);
      if (dtMap) dtMap.delete(itemId);
      if (dvMap) dvMap.delete(itemId);
      this.provenance.delete(itemId);

      if (invIndex) {
        for (const term of Object.keys(invIndex)) {
          invIndex[term].delete(itemId);
          if (invIndex[term].size === 0) {
            delete invIndex[term];
          }
        }
      }
    }
  }

  private clearIndex(sourceId: string): void {
    const invIndex = this.invertedIndex.get(sourceId);
    if (invIndex) {
      for (const term of Object.keys(invIndex)) {
        delete invIndex[term];
      }
    }
    const tfMap = this.termFrequencies.get(sourceId);
    if (tfMap) {
      tfMap.clear();
    }
    const dtMap = this.documentTermCounts.get(sourceId);
    if (dtMap) {
      dtMap.clear();
    }
    const dvMap = this.documentVectors.get(sourceId);
    if (dvMap) dvMap.clear();
  }

  private retrieveForSource(
    sourceId: string,
    queryTokens: string[],
    strategy: KnowledgeRetrievalStrategy,
  ): KnowledgeItem[] {
    const invIndex = this.invertedIndex.get(sourceId);
    const tfMap = this.termFrequencies.get(sourceId);
    const dtMap = this.documentTermCounts.get(sourceId);
    const dvMap = this.documentVectors.get(sourceId);
    const source = this.sources.get(sourceId)!;
    if (!invIndex || !tfMap || !dtMap || !dvMap) return [];

    if (strategy === 'keyword' || strategy === 'relevance') {
      return this.keywordRetrieve(sourceId, queryTokens, invIndex, tfMap, dtMap, dvMap, source);
    } else if (strategy === 'semantic') {
      return this.semanticRetrieve(sourceId, queryTokens, dvMap, source);
    } else if (strategy === 'hybrid') {
      const kwResults = this.keywordRetrieve(sourceId, queryTokens, invIndex, tfMap, dtMap, dvMap, source);
      const semResults = this.semanticRetrieve(sourceId, queryTokens, dvMap, source);
      return this.mergeHybrid(kwResults, semResults);
    } else if (strategy === 'recency') {
      const kwResults = this.keywordRetrieve(sourceId, queryTokens, invIndex, tfMap, dtMap, dvMap, source);
      return this.recencyBoost(kwResults);
    }
    return this.keywordRetrieve(sourceId, queryTokens, invIndex, tfMap, dtMap, dvMap, source);
  }

  private keywordRetrieve(
    sourceId: string,
    queryTokens: string[],
    invIndex: InvertedIndex,
    tfMap: Map<string, TermFrequency>,
    dtMap: Map<string, number>,
    dvMap: Map<string, Map<string, number>>,
    source: KnowledgeSource,
  ): KnowledgeItem[] {
    const totalDocs = dvMap.size;
    const matchingItems = new Map<string, number>();
    const itemScores = new Map<string, number>();

    for (const term of queryTokens) {
      const posting = invIndex[term];
      if (!posting) continue;
      const idf = computeIdf(totalDocs, posting.size);
      for (const itemId of posting) {
        const tf = tfMap.get(itemId)?.[term] ?? 0;
        const tfidf = tf * idf;
        matchingItems.set(itemId, (matchingItems.get(itemId) ?? 0) + tfidf);
        itemScores.set(itemId, (itemScores.get(itemId) ?? 0) + tfidf);
      }
    }

    const results: KnowledgeItem[] = [];
    for (const [itemId, score] of itemScores) {
      const parts = itemId.split(':');
      const chunkIdx = parseInt(parts[parts.length - 1], 10);
      const docId = parts.length >= 3 ? parts.slice(1, -1).join(':') : parts[1];
      const doc = this.documents.get(sourceId)?.get(docId);
      const content = doc?.chunks[chunkIdx] ?? '';

      results.push({
        id: itemId,
        sourceId,
        content,
        score,
        rank: 0,
        metadata: doc?.metadata,
        provenance: {
          sourceId,
          sourceName: source.name,
          retrievedAt: Date.now(),
          chunkIndex: chunkIdx,
          documentId: docId,
        },
      });
    }

    return results;
  }

  private semanticRetrieve(
    sourceId: string,
    queryTokens: string[],
    dvMap: Map<string, Map<string, number>>,
    source: KnowledgeSource,
  ): KnowledgeItem[] {
    const queryVec = new Map<string, number>();
    for (const token of queryTokens) {
      queryVec.set(token, (queryVec.get(token) ?? 0) + 1);
    }
    let queryNorm = 0;
    for (const val of queryVec.values()) {
      queryNorm += val * val;
    }
    queryNorm = Math.sqrt(queryNorm);
    if (queryNorm === 0) return [];

    const results: KnowledgeItem[] = [];
    for (const [itemId, docVec] of dvMap.entries()) {
      let dotProduct = 0;
      let docNorm = 0;
      for (const [term, val] of docVec.entries()) {
        docNorm += val * val;
        const qVal = queryVec.get(term);
        if (qVal !== undefined) {
          dotProduct += val * qVal;
        }
      }
      docNorm = Math.sqrt(docNorm);
      if (docNorm === 0) continue;
      const similarity = dotProduct / (queryNorm * docNorm);

      const parts = itemId.split(':');
      const chunkIdx = parseInt(parts[parts.length - 1], 10);
      const docId = parts.length >= 3 ? parts.slice(1, -1).join(':') : parts[1];
      const doc = this.documents.get(sourceId)?.get(docId);

      results.push({
        id: itemId,
        sourceId,
        content: doc?.chunks[chunkIdx] ?? '',
        score: similarity,
        rank: 0,
        metadata: doc?.metadata,
        provenance: {
          sourceId,
          sourceName: source.name,
          retrievedAt: Date.now(),
          chunkIndex: chunkIdx,
          documentId: docId,
        },
      });
    }

    return results;
  }

  private mergeHybrid(kwResults: KnowledgeItem[], semResults: KnowledgeItem[]): KnowledgeItem[] {
    const scores = new Map<string, { kw: number; sem: number; item: KnowledgeItem }>();
    for (const item of kwResults) {
      scores.set(item.id, { kw: item.score, sem: 0, item });
    }
    for (const item of semResults) {
      const existing = scores.get(item.id);
      if (existing) {
        existing.sem = item.score;
      } else {
        scores.set(item.id, { kw: 0, sem: item.score, item });
      }
    }
    const merged: KnowledgeItem[] = [];
    for (const { kw, sem, item } of scores.values()) {
      item.score = kw * 0.6 + sem * 0.4;
      merged.push(item);
    }
    return merged;
  }

  private recencyBoost(items: KnowledgeItem[]): KnowledgeItem[] {
    const now = Date.now();
    for (const item of items) {
      const age = now - item.provenance.retrievedAt;
      const decay = Math.exp(-age / (24 * 60 * 60 * 1000));
      item.score *= (1 + decay) / 2;
    }
    return items;
  }

  private scoreItem(item: KnowledgeItem, query: string, strategy: KnowledgeRetrievalStrategy): number {
    const queryTokens = tokenize(query);
    const contentTokens = tokenize(item.content);
    let score = 0;

    const querySet = new Set(queryTokens);
    const contentSet = new Set(contentTokens);
    const intersection = new Set([...querySet].filter((t) => contentSet.has(t)));

    if (strategy === 'keyword' || strategy === 'relevance') {
      score = intersection.size / Math.max(querySet.size, 1);
    } else if (strategy === 'semantic') {
      let dot = 0;
      let qNorm = 0;
      let cNorm = 0;
      for (const term of querySet) {
        const qCount = queryTokens.filter((t) => t === term).length;
        qNorm += qCount * qCount;
      }
      for (const term of contentSet) {
        const cCount = contentTokens.filter((t) => t === term).length;
        cNorm += cCount * cCount;
      }
      for (const term of intersection) {
        const qCount = queryTokens.filter((t) => t === term).length;
        const cCount = contentTokens.filter((t) => t === term).length;
        dot += qCount * cCount;
      }
      qNorm = Math.sqrt(qNorm);
      cNorm = Math.sqrt(cNorm);
      score = qNorm > 0 && cNorm > 0 ? dot / (qNorm * cNorm) : 0;
    } else if (strategy === 'hybrid') {
      const kwScore = intersection.size / Math.max(querySet.size, 1);
      let dot = 0;
      let qNorm = 0;
      let cNorm = 0;
      for (const term of querySet) {
        const qCount = queryTokens.filter((t) => t === term).length;
        qNorm += qCount * qCount;
      }
      for (const term of contentSet) {
        const cCount = contentTokens.filter((t) => t === term).length;
        cNorm += cCount * cCount;
      }
      for (const term of intersection) {
        const qCount = queryTokens.filter((t) => t === term).length;
        const cCount = contentTokens.filter((t) => t === term).length;
        dot += qCount * cCount;
      }
      qNorm = Math.sqrt(qNorm);
      cNorm = Math.sqrt(cNorm);
      const semScore = qNorm > 0 && cNorm > 0 ? dot / (qNorm * cNorm) : 0;
      score = kwScore * 0.6 + semScore * 0.4;
    } else {
      score = intersection.size / Math.max(querySet.size, 1);
    }

    return score;
  }

  private applyCustomRanking(items: KnowledgeItem[], configForSource: (id: string) => SourceConfig | undefined): KnowledgeItem[] {
    if (this.globalRankingFn) {
      return items.sort(this.globalRankingFn);
    }
    for (const item of items) {
      const config = configForSource(item.sourceId);
      if (config?.customRankingFn) {
        return items.sort(config.customRankingFn);
      }
    }
    return items;
  }

  setChunkSize(size: number): void {
    this.chunkSize = Math.max(1, size);
  }

  setChunkOverlap(overlap: number): void {
    this.chunkOverlap = Math.max(0, overlap);
  }

  setSourceRankingFunction(sourceId: string, fn: RankingFn): void {
    if (!this.sources.has(sourceId)) {
      throw new Error(`Source '${sourceId}' not found`);
    }
    const config = this.sourceConfigs.get(sourceId) ?? { strategy: 'keyword' };
    config.customRankingFn = fn;
    this.sourceConfigs.set(sourceId, config);
  }

  getSourceConfig(sourceId: string): SourceConfig | undefined {
    return this.sourceConfigs.get(sourceId);
  }

  getSource(sourceId: string): KnowledgeSource | undefined {
    return this.sources.get(sourceId);
  }
}
