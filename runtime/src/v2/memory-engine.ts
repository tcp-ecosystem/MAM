import {
  MemoryEngine,
  MemoryRecord,
  MemoryStoreMetadata,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryEngineStats,
} from "./types.js";

interface InternalRecord extends MemoryRecord {
  _words: string[];
  _sourceIndex: string;
  _tagIndices: string[];
  _accessCount: number;
  _lastAccessedAt: number;
}

interface BulkStoreItem {
  id: string;
  content: string;
  metadata?: MemoryStoreMetadata;
}

interface ListFilters {
  source?: string;
  tags?: string[];
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
}

interface SerializedEngine {
  version: number;
  records: MemoryRecord[];
  stats: {
    totalSearches: number;
    totalSearchTimeMs: number;
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function termFrequency(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, valA] of a) {
    normA += valA * valA;
    const valB = b.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }
  for (const valB of b.values()) {
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function buildSourceIndex(source: string | undefined): string {
  return (source ?? "").toLowerCase();
}

function buildTagIndices(tags: string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.toLowerCase());
}

function matchFilter(record: InternalRecord, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === "source") {
      if (record._sourceIndex !== String(value).toLowerCase()) return false;
    } else if (key === "tags") {
      const filterTags = Array.isArray(value)
        ? value.map((v) => String(v).toLowerCase())
        : [String(value).toLowerCase()];
      const recordTags = new Set(record._tagIndices);
      let found = false;
      for (const ft of filterTags) {
        if (recordTags.has(ft)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    } else if (key === "createdAfter") {
      if (record.createdAt < Number(value)) return false;
    } else if (key === "createdBefore") {
      if (record.createdAt > Number(value)) return false;
    } else if (key === "updatedAfter") {
      if (record.updatedAt < Number(value)) return false;
    } else if (key === "updatedBefore") {
      if (record.updatedAt > Number(value)) return false;
    } else if (key === "content") {
      const needle = String(value).toLowerCase();
      if (!record.content.toLowerCase().includes(needle)) return false;
    }
  }
  return true;
}

export class DefaultMemoryEngine implements MemoryEngine {
  private records = new Map<string, InternalRecord>();
  private tagIndex = new Map<string, Set<string>>();
  private sourceIndex = new Map<string, Set<string>>();
  private totalSearches = 0;
  private totalSearchTimeMs = 0;
  private embeddingDimension?: number;

  async store(
    id: string,
    content: string,
    metadata?: MemoryStoreMetadata
  ): Promise<MemoryRecord> {
    const now = Date.now();
    const words = tokenize(content);
    const sourceIdx = buildSourceIndex(metadata?.source);
    const tagIdx = buildTagIndices(metadata?.tags);

    const existing = this.records.get(id);
    if (existing) {
      this.removeIndexEntries(existing);
    }

    const record: InternalRecord = {
      id,
      content,
      metadata: {
        source: metadata?.source,
        tags: metadata?.tags,
        embedding: metadata?.embedding,
        timestamp: metadata?.timestamp ?? now,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      _words: words,
      _sourceIndex: sourceIdx,
      _tagIndices: tagIdx,
      _accessCount: existing?._accessCount ?? 0,
      _lastAccessedAt: existing?._lastAccessedAt ?? now,
    };

    this.records.set(id, record);
    this.addIndexEntries(record);

    if (metadata?.embedding && !this.embeddingDimension) {
      this.embeddingDimension = metadata.embedding.length;
    }

    return {
      id: record.id,
      content: record.content,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async retrieve(id: string): Promise<MemoryRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    record._accessCount++;
    record._lastAccessedAt = Date.now();
    return {
      id: record.id,
      content: record.content,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async search(
    query: string,
    options?: MemorySearchOptions
  ): Promise<MemorySearchResult[]> {
    const startTime = Date.now();
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.0;
    const filter = options?.filter ?? {};
    const queryWords = tokenize(query);
    const queryTf = termFrequency(queryWords);

    const results: MemorySearchResult[] = [];

    for (const record of this.records.values()) {
      if (!matchFilter(record, filter)) continue;

      const cosine = cosineSimilarity(queryTf, termFrequency(record._words));
      const jaccard = jaccardSimilarity(queryWords, record._words);
      const score = cosine * 0.7 + jaccard * 0.3;

      if (score >= threshold) {
        results.push({ record: this.toPublicRecord(record), score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const trimmed = results.slice(0, limit);

    const elapsed = Date.now() - startTime;
    this.totalSearches++;
    this.totalSearchTimeMs += elapsed;

    return trimmed;
  }

  getStats(): MemoryEngineStats {
    return {
      totalRecords: this.records.size,
      totalSearches: this.totalSearches,
      averageSearchTimeMs:
        this.totalSearches === 0
          ? 0
          : this.totalSearchTimeMs / this.totalSearches,
      embeddingDimension: this.embeddingDimension,
    };
  }

  async update(
    id: string,
    content: string,
    metadata?: MemoryStoreMetadata
  ): Promise<MemoryRecord | null> {
    const existing = this.records.get(id);
    if (!existing) return null;

    const now = Date.now();
    const words = tokenize(content);
    const sourceIdx = buildSourceIndex(metadata?.source ?? existing.metadata.source);
    const tagIdx = buildTagIndices(
      metadata?.tags ?? existing.metadata.tags
    );

    this.removeIndexEntries(existing);

    const mergedMetadata: MemoryStoreMetadata = {
      source: metadata?.source ?? existing.metadata.source,
      tags: metadata?.tags ?? existing.metadata.tags,
      embedding: metadata?.embedding ?? existing.metadata.embedding,
      timestamp: metadata?.timestamp ?? existing.metadata.timestamp,
    };

    const record: InternalRecord = {
      id,
      content,
      metadata: mergedMetadata,
      createdAt: existing.createdAt,
      updatedAt: now,
      _words: words,
      _sourceIndex: sourceIdx,
      _tagIndices: tagIdx,
      _accessCount: existing._accessCount,
      _lastAccessedAt: existing._lastAccessedAt,
    };

    this.records.set(id, record);
    this.addIndexEntries(record);

    if (metadata?.embedding && !this.embeddingDimension) {
      this.embeddingDimension = metadata.embedding.length;
    }

    return this.toPublicRecord(record);
  }

  async delete(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    this.removeIndexEntries(record);
    this.records.delete(id);
    return true;
  }

  async list(filters?: ListFilters): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const record of this.records.values()) {
      if (!filters) {
        results.push(this.toPublicRecord(record));
        continue;
      }

      let pass = true;

      if (filters.source !== undefined) {
        if (record._sourceIndex !== filters.source.toLowerCase()) pass = false;
      }

      if (pass && filters.tags !== undefined && filters.tags.length > 0) {
        const filterTags = new Set(filters.tags.map((t) => t.toLowerCase()));
        let found = false;
        for (const rt of record._tagIndices) {
          if (filterTags.has(rt)) {
            found = true;
            break;
          }
        }
        if (!found) pass = false;
      }

      if (pass && filters.createdAfter !== undefined) {
        if (record.createdAt < filters.createdAfter) pass = false;
      }
      if (pass && filters.createdBefore !== undefined) {
        if (record.createdAt > filters.createdBefore) pass = false;
      }
      if (pass && filters.updatedAfter !== undefined) {
        if (record.updatedAt < filters.updatedAfter) pass = false;
      }
      if (pass && filters.updatedBefore !== undefined) {
        if (record.updatedAt > filters.updatedBefore) pass = false;
      }

      if (pass) {
        results.push(this.toPublicRecord(record));
      }
    }

    results.sort((a, b) => b.updatedAt - a.updatedAt);
    return results;
  }

  async bulkStore(records: BulkStoreItem[]): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const item of records) {
      const record = await this.store(item.id, item.content, item.metadata);
      results.push(record);
    }
    return results;
  }

  async expire(ttlMs: number): Promise<number> {
    const cutoff = Date.now() - ttlMs;
    const toRemove: string[] = [];
    for (const [id, record] of this.records.entries()) {
      if (record.createdAt <= cutoff) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      const record = this.records.get(id);
      if (record) {
        this.removeIndexEntries(record);
        this.records.delete(id);
      }
    }
    return toRemove.length;
  }

  async consolidate(): Promise<{ merged: number; removed: number }> {
    const allRecords = Array.from(this.records.values());
    const sorted = [...allRecords].sort(
      (a, b) => b._words.length - a._words.length
    );
    const seen = new Set<string>();
    let removed = 0;

    for (let i = 0; i < sorted.length; i++) {
      const recordA = sorted[i];
      if (seen.has(recordA.id)) continue;

      for (let j = i + 1; j < sorted.length; j++) {
        const recordB = sorted[j];
        if (seen.has(recordB.id)) continue;

        const score = jaccardSimilarity(recordA._words, recordB._words);
        if (score > 0.8) {
          seen.add(recordB.id);
        }
      }
    }

    for (const id of seen) {
      const record = this.records.get(id);
      if (record) {
        this.removeIndexEntries(record);
        this.records.delete(id);
        removed++;
      }
    }

    return { merged: 0, removed };
  }

  async getBySource(sourceId: string): Promise<MemoryRecord[]> {
    const normalized = sourceId.toLowerCase();
    const ids = this.sourceIndex.get(normalized);
    if (!ids) return [];
    const results: MemoryRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) {
        results.push(this.toPublicRecord(record));
      }
    }
    return results;
  }

  async getByTags(tags: string[]): Promise<MemoryRecord[]> {
    const matchingIds = new Set<string>();
    for (const tag of tags) {
      const ids = this.tagIndex.get(tag.toLowerCase());
      if (ids) {
        for (const id of ids) {
          matchingIds.add(id);
        }
      }
    }
    const results: MemoryRecord[] = [];
    for (const id of matchingIds) {
      const record = this.records.get(id);
      if (record) {
        results.push(this.toPublicRecord(record));
      }
    }
    return results;
  }

  export(): SerializedEngine {
    const records: MemoryRecord[] = [];
    for (const record of this.records.values()) {
      records.push(this.toPublicRecord(record));
    }
    return {
      version: 1,
      records,
      stats: {
        totalSearches: this.totalSearches,
        totalSearchTimeMs: this.totalSearchTimeMs,
      },
    };
  }

  async import(data: SerializedEngine): Promise<number> {
    let count = 0;
    for (const record of data.records) {
      await this.store(record.id, record.content, {
        source: record.metadata.source,
        tags: record.metadata.tags,
        embedding: record.metadata.embedding,
        timestamp: record.metadata.timestamp,
      });
      count++;
    }
    if (data.stats) {
      this.totalSearches = data.stats.totalSearches ?? 0;
      this.totalSearchTimeMs = data.stats.totalSearchTimeMs ?? 0;
    }
    return count;
  }

  private toPublicRecord(record: InternalRecord): MemoryRecord {
    return {
      id: record.id,
      content: record.content,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private addIndexEntries(record: InternalRecord): void {
    if (record._sourceIndex) {
      let sourceSet = this.sourceIndex.get(record._sourceIndex);
      if (!sourceSet) {
        sourceSet = new Set();
        this.sourceIndex.set(record._sourceIndex, sourceSet);
      }
      sourceSet.add(record.id);
    }

    for (const tag of record._tagIndices) {
      let tagSet = this.tagIndex.get(tag);
      if (!tagSet) {
        tagSet = new Set();
        this.tagIndex.set(tag, tagSet);
      }
      tagSet.add(record.id);
    }
  }

  private removeIndexEntries(record: InternalRecord): void {
    if (record._sourceIndex) {
      const sourceSet = this.sourceIndex.get(record._sourceIndex);
      if (sourceSet) {
        sourceSet.delete(record.id);
        if (sourceSet.size === 0) {
          this.sourceIndex.delete(record._sourceIndex);
        }
      }
    }

    for (const tag of record._tagIndices) {
      const tagSet = this.tagIndex.get(tag);
      if (tagSet) {
        tagSet.delete(record.id);
        if (tagSet.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }
}
