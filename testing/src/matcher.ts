/**
 * MAM Custom Matchers
 *
 * Provides pattern and structural matching utilities for MAM AST inspection,
 * including regex-based content matching and structural queries.
 */

// ============================================================================
// Types
// ============================================================================

/** Match result for a single pattern */
export interface MatchResult {
  /** Whether the pattern matched */
  matched: boolean;
  /** Pattern name/identifier */
  name: string;
  /** Captured groups (if regex) */
  captures?: string[];
  /** Match position (-1 if no match) */
  index: number;
  /** Matched text */
  text?: string;
}

/** Structural match result */
export interface StructuralMatchResult {
  /** Whether the structure was found */
  found: boolean;
  /** Path to the matched element */
  path: string[];
  /** Matched element */
  element?: unknown;
}

/** AST node subset for matching */
export interface MatchableAST {
  type?: string;
  frontmatter?: {
    data: Record<string, unknown>;
  };
  sections?: Array<{
    name: string;
    level: number;
    content?: string;
    codeBlocks?: Array<{ language: string; content: string }>;
    children?: MatchableAST['sections'];
  }>;
  metadata?: Record<string, unknown>;
}

/** Pattern definition for matching */
export interface PatternDefinition {
  /** Pattern name */
  name: string;
  /** Regex pattern (string) */
  pattern: string;
  /** Regex flags */
  flags?: string;
}

/** Section match query */
export interface SectionQuery {
  /** Section name (exact match) */
  name?: string;
  /** Section name (regex match) */
  namePattern?: string;
  /** Minimum section level */
  minLevel?: number;
  /** Maximum section level */
  maxLevel?: number;
  /** Content must contain */
  contentContains?: string;
  /** Content must match regex */
  contentPattern?: string;
  /** Must have code blocks */
  hasCodeBlocks?: boolean;
  /** Code block language filter */
  codeBlockLanguage?: string;
}

// ============================================================================
// MAMMatcher
// ============================================================================

export class MAMMatcher {
  private patterns: Map<string, RegExp> = new Map();

  constructor(patterns?: PatternDefinition[]) {
    if (patterns) {
      for (const p of patterns) {
        this.addPattern(p);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Pattern management
  // --------------------------------------------------------------------------

  /**
   * Register a named pattern
   */
  addPattern(def: PatternDefinition): void {
    const flags = def.flags ?? 'g';
    this.patterns.set(def.name, new RegExp(def.pattern, flags));
  }

  /**
   * Remove a named pattern
   */
  removePattern(name: string): boolean {
    return this.patterns.delete(name);
  }

  /**
   * Get a registered pattern by name
   */
  getPattern(name: string): RegExp | undefined {
    return this.patterns.get(name);
  }

  /**
   * Clear all registered patterns
   */
  clearPatterns(): void {
    this.patterns.clear();
  }

  // --------------------------------------------------------------------------
  // Content matching
  // --------------------------------------------------------------------------

  /**
   * Match content against a regex pattern
   */
  matchPattern(content: string, pattern: RegExp | string, name = 'unnamed'): MatchResult {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
    const match = regex.exec(content);

    if (!match) {
      return { matched: false, name, index: -1 };
    }

    return {
      matched: true,
      name,
      captures: match.slice(1),
      index: match.index,
      text: match[0],
    };
  }

  /**
   * Match content against all registered patterns
   */
  matchAll(content: string): MatchResult[] {
    const results: MatchResult[] = [];

    for (const [name, regex] of this.patterns) {
      // Reset lastIndex for global regexes
      regex.lastIndex = 0;
      const match = regex.exec(content);

      if (match) {
        results.push({
          matched: true,
          name,
          captures: match.slice(1),
          index: match.index,
          text: match[0],
        });
      } else {
        results.push({
          matched: false,
          name,
          index: -1,
        });
      }
    }

    return results;
  }

  /**
   * Find all occurrences of a pattern in content
   */
  findAll(content: string, pattern: RegExp | string): MatchResult[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : new RegExp(pattern.source, pattern.flags);
    const results: MatchResult[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      results.push({
        matched: true,
        name: `match-${results.length}`,
        captures: match.slice(1),
        index: match.index,
        text: match[0],
      });

      // Prevent infinite loops on zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Structural matching
  // --------------------------------------------------------------------------

  /**
   * Check if AST has a section matching the query
   */
  matchSection(ast: MatchableAST, query: SectionQuery): StructuralMatchResult {
    const sections = ast.sections ?? [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const path = ['sections', String(i), section.name];

      if (this.matchesSectionQuery(section, query)) {
        return { found: true, path, element: section };
      }
    }

    return { found: false, path: [] };
  }

  /**
   * Find all sections matching the query
   */
  matchSections(ast: MatchableAST, query: SectionQuery): StructuralMatchResult[] {
    const sections = ast.sections ?? [];
    const results: StructuralMatchResult[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const path = ['sections', String(i), section.name];

      if (this.matchesSectionQuery(section, query)) {
        results.push({ found: true, path, element: section });
      }
    }

    return results;
  }

  /**
   * Check if AST has a code block matching criteria
   */
  matchCodeBlock(
    ast: MatchableAST,
    options: { language?: string; contentPattern?: string; sectionName?: string }
  ): StructuralMatchResult {
    const sections = ast.sections ?? [];

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const codeBlocks = section.codeBlocks ?? [];

      for (let ci = 0; ci < codeBlocks.length; ci++) {
        const block = codeBlocks[ci];

        const languageMatch = !options.language || block.language === options.language;
        const contentMatch =
          !options.contentPattern || new RegExp(options.contentPattern).test(block.content);
        const sectionMatch = !options.sectionName || section.name === options.sectionName;

        if (languageMatch && contentMatch && sectionMatch) {
          return {
            found: true,
            path: ['sections', String(si), section.name, 'codeBlocks', String(ci)],
            element: block,
          };
        }
      }
    }

    return { found: false, path: [] };
  }

  /**
   * Check if AST has frontmatter matching expected data
   */
  matchFrontmatter(
    ast: MatchableAST,
    expectedData: Record<string, unknown>
  ): StructuralMatchResult {
    const fm = ast.frontmatter?.data;
    if (!fm) {
      return { found: false, path: [] };
    }

    for (const [key, value] of Object.entries(expectedData)) {
      if (fm[key] !== value) {
        return { found: false, path: [] };
      }
    }

    return {
      found: true,
      path: ['frontmatter'],
      element: fm,
    };
  }

  /**
   * Check if AST has a specific metadata key
   */
  matchMetadata(
    ast: MatchableAST,
    key: string,
    value?: unknown
  ): StructuralMatchResult {
    const metadata = ast.metadata;
    if (!metadata || !(key in metadata)) {
      return { found: false, path: [] };
    }

    if (value !== undefined && metadata[key] !== value) {
      return { found: false, path: [] };
    }

    return {
      found: true,
      path: ['metadata', key],
      element: metadata[key],
    };
  }

  // --------------------------------------------------------------------------
  // AST pattern matching
  // --------------------------------------------------------------------------

  /**
   * Match AST structure against a pattern object
   */
  matchAST(ast: MatchableAST, pattern: Record<string, unknown>): StructuralMatchResult {
    return this.matchObject(ast, pattern, ['root']);
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  private matchesSectionQuery(
    section: MatchableAST['sections'] extends (infer T)[] | undefined ? T : never,
    query: SectionQuery
  ): boolean {
    if (query.name !== undefined && section.name !== query.name) {
      return false;
    }

    if (query.namePattern !== undefined) {
      const regex = new RegExp(query.namePattern);
      if (!regex.test(section.name)) {
        return false;
      }
    }

    if (query.minLevel !== undefined && section.level < query.minLevel) {
      return false;
    }

    if (query.maxLevel !== undefined && section.level > query.maxLevel) {
      return false;
    }

    if (query.contentContains !== undefined) {
      const content = section.content ?? '';
      if (!content.includes(query.contentContains)) {
        return false;
      }
    }

    if (query.contentPattern !== undefined) {
      const content = section.content ?? '';
      const regex = new RegExp(query.contentPattern);
      if (!regex.test(content)) {
        return false;
      }
    }

    if (query.hasCodeBlocks === true) {
      const blocks = section.codeBlocks ?? [];
      if (blocks.length === 0) {
        return false;
      }
    }

    if (query.codeBlockLanguage !== undefined) {
      const blocks = section.codeBlocks ?? [];
      const hasLang = blocks.some((b) => b.language === query.codeBlockLanguage);
      if (!hasLang) {
        return false;
      }
    }

    return true;
  }

  private matchObject(obj: unknown, pattern: Record<string, unknown>, path: string[]): StructuralMatchResult {
    if (typeof obj !== 'object' || obj === null) {
      return { found: false, path };
    }

    for (const [key, value] of Object.entries(pattern)) {
      const objRecord = obj as Record<string, unknown>;

      if (!(key in objRecord)) {
        return { found: false, path: [...path, key] };
      }

      const objValue = objRecord[key];

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const result = this.matchObject(objValue, value as Record<string, unknown>, [...path, key]);
        if (!result.found) {
          return result;
        }
      } else if (objValue !== value) {
        return { found: false, path: [...path, key] };
      }
    }

    return { found: true, path, element: obj };
  }
}
