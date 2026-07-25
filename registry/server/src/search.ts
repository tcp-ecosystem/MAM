/**
 * MAM Search Engine
 * 
 * Full-text search for MAM modules.
 */

import { ModuleRecord } from './store.js';

// ============================================================================
// Types
// ============================================================================

export interface SearchQuery {
  /** Search text */
  text: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by author */
  author?: string;
  /** Sort by */
  sort?: 'relevance' | 'downloads' | 'updated' | 'name';
  /** Results limit */
  limit?: number;
  /** Results offset */
  offset?: number;
}

export interface SearchResults {
  /** Found modules */
  modules: SearchResultItem[];
  /** Total count */
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
// Search Engine
// ============================================================================

export class SearchEngine {
  private index: Map<string, SearchIndexEntry> = new Map();

  /**
   * Index a module
   */
  indexModule(module: ModuleRecord): void {
    const text = [
      module.name,
      module.description,
      module.author,
      ...module.tags,
    ].join(' ').toLowerCase();

    this.index.set(module.name, {
      name: module.name,
      text,
      module,
    });
  }

  /**
   * Remove module from index
   */
  removeModule(name: string): void {
    this.index.delete(name);
  }

  /**
   * Search modules
   */
  async search(query: string | SearchQuery): Promise<SearchResults> {
    const startTime = performance.now();
    
    const searchQuery = typeof query === 'string' ? { text: query } : query;
    const text = searchQuery.text.toLowerCase();
    const limit = searchQuery.limit || 20;
    const offset = searchQuery.offset || 0;

    // Simple text search
    const results: SearchResultItem[] = [];

    for (const [, entry] of this.index) {
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

      results.push({
        name: entry.module.name,
        version: entry.module.latest,
        description: entry.module.description,
        author: entry.module.author,
        tags: entry.module.tags,
        score,
        highlights,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Paginate
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      modules: paginatedResults,
      total: results.length,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Get suggestions
   */
  getSuggestions(prefix: string, limit: number = 10): string[] {
    const suggestions: string[] = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const [name] of this.index) {
      if (name.toLowerCase().startsWith(lowerPrefix)) {
        suggestions.push(name);
        if (suggestions.length >= limit) break;
      }
    }

    return suggestions;
  }

  /**
   * Get popular modules
   */
  getPopular(limit: number = 10): SearchResultItem[] {
    const modules: SearchResultItem[] = [];

    for (const [, entry] of this.index) {
      modules.push({
        name: entry.module.name,
        version: entry.module.latest,
        description: entry.module.description,
        author: entry.module.author,
        tags: entry.module.tags,
        score: 1,
        highlights: [],
      });
    }

    return modules.slice(0, limit);
  }

  /**
   * Get recent modules
   */
  getRecent(limit: number = 10): SearchResultItem[] {
    const modules = Array.from(this.index.values())
      .sort((a, b) => 
        new Date(b.module.updatedAt).getTime() - 
        new Date(a.module.updatedAt).getTime()
      )
      .slice(0, limit);

    return modules.map(entry => ({
      name: entry.module.name,
      version: entry.module.latest,
      description: entry.module.description,
      author: entry.module.author,
      tags: entry.module.tags,
      score: 1,
      highlights: [],
    }));
  }

  /**
   * Clear index
   */
  clearIndex(): void {
    this.index.clear();
  }

  /**
   * Get index size
   */
  getIndexSize(): number {
    return this.index.size;
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