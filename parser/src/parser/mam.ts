/**
 * MAM Parser
 * 
 * Main parser that orchestrates tokenization and AST construction.
 * Converts raw Markdown into a complete MAM AST.
 */

import { Token, TokenType, STANDARD_SECTIONS } from '../lexer/tokens.js';
import { ParseError, ParseErrorCode, ParseWarning, ParseWarningCode } from './errors.js';
import { parseFrontMatter, FrontMatterData } from './frontmatter.js';
import {
  parseSections,
  SectionData,
  ContentNode,
  SourceLocation,
} from './sections.js';

// ============================================================================
// AST Types
// ============================================================================

export interface MAMModule {
  type: 'MAMModule';
  frontmatter: FrontMatter | null;
  sections: Section[];
  location: SourceLocation;
  metadata: ModuleMetadata;
}

export interface FrontMatter {
  type: 'FrontMatter';
  data: FrontMatterData;
  location: SourceLocation;
}

export interface Section {
  type: 'Section';
  name: string;
  level: number;
  content: ContentNode[];
  location: SourceLocation;
  attributes: SectionAttributes;
}

export interface SectionAttributes {
  required: boolean;
  isCustom: boolean;
  contentTypes: string[];
}

export interface ModuleMetadata {
  sectionCount: number;
  codeBlockCount: number;
  languages: string[];
  customSections: string[];
  parsedAt: string;
}

// ============================================================================
// Parser Configuration
// ============================================================================

export interface ParserOptions {
  source?: string;
  maxDepth?: number;
  strict?: boolean;
  allowUnknownSections?: boolean;
}

export interface ParseResult {
  ast: MAMModule;
  errors: (ParseError | import('../lexer/errors.js').LexerError)[];
  warnings: (ParseWarning | import('../lexer/errors.js').LexerWarning)[];
  stats: ParserStats;
}

export interface ParserStats {
  totalSections: number;
  totalCodeBlocks: number;
  totalLines: number;
  totalTokens: number;
  parseTimeMs: number;
}

// ============================================================================
// Parser
// ============================================================================

export class MAMParser {
  private tokens: Token[];
  private source: string;
  private strict: boolean;
  private allowUnknownSections: boolean;
  private startTime: number = 0;

  constructor(tokens: Token[], options: ParserOptions = {}) {
    this.tokens = tokens;
    this.source = options.source || '<input>';
    this.strict = options.strict || false;
    this.allowUnknownSections = options.allowUnknownSections !== false;
  }

  /**
   * Parse tokens into AST
   */
  parse(): ParseResult {
    this.startTime = performance.now();
    const allErrors: ParseError[] = [];
    const allWarnings: ParseWarning[] = [];

    // Find start of content (skip leading whitespace)
    let startIndex = 0;
    while (startIndex < this.tokens.length && 
           (this.tokens[startIndex]!.type === TokenType.NEWLINE || 
            this.tokens[startIndex]!.type === TokenType.WHITESPACE)) {
      startIndex++;
    }

    // Parse front matter
    const frontmatterResult = parseFrontMatter(this.tokens, startIndex, this.source);
    allErrors.push(...frontmatterResult.errors);

    // Parse sections
    const sectionsResult = parseSections(this.tokens, frontmatterResult.endIndex, this.source);
    allErrors.push(...sectionsResult.errors);
    allWarnings.push(...sectionsResult.warnings);

    // Build sections
    const sections = sectionsResult.sections.map(s => this.buildSection(s));

    // Build metadata
    const metadata = this.buildMetadata(sections);

    // Create source location
    const location = this.createModuleLocation(sections);

    // Build AST
    const ast: MAMModule = {
      type: 'MAMModule',
      frontmatter: frontmatterResult.data
        ? {
            type: 'FrontMatter',
            data: frontmatterResult.data,
            location: {
              start: { line: 1, column: 0, offset: 0 },
              end: { line: 1, column: 3, offset: 3 },
              source: this.source,
            },
          }
        : null,
      sections,
      location,
      metadata,
    };

    // Validate
    this.validateAST(ast, allErrors, allWarnings);

    const stats: ParserStats = {
      totalSections: sections.length,
      totalCodeBlocks: metadata.codeBlockCount,
      totalLines: this.tokens[this.tokens.length - 1]?.line || 0,
      totalTokens: this.tokens.length,
      parseTimeMs: performance.now() - this.startTime,
    };

    return {
      ast,
      errors: allErrors,
      warnings: allWarnings,
      stats,
    };
  }

  // ==========================================================================
  // Section Building
  // ==========================================================================

  private buildSection(sectionData: SectionData): Section {
    const isCustom = !STANDARD_SECTIONS.has(sectionData.name);
    const required = sectionData.name === 'Purpose';

    return {
      type: 'Section',
      name: sectionData.name,
      level: sectionData.level,
      content: sectionData.content,
      location: {
        start: sectionData.location.start,
        end: sectionData.location.end,
        source: this.source,
      },
      attributes: {
        required,
        isCustom,
        contentTypes: this.getContentTypes(sectionData.content),
      },
    };
  }

  private getContentTypes(content: ContentNode[]): string[] {
    const types = new Set<string>();
    for (const node of content) {
      types.add(node.type);
    }
    return Array.from(types);
  }

  // ==========================================================================
  // Metadata Building
  // ==========================================================================

  private buildMetadata(sections: Section[]): ModuleMetadata {
    let codeBlockCount = 0;
    const languages = new Set<string>();
    const customSections: string[] = [];

    for (const section of sections) {
      if (!STANDARD_SECTIONS.has(section.name)) {
        customSections.push(section.name);
      }

      for (const content of section.content) {
        if (content.type === 'codeblock') {
          codeBlockCount++;
          const lang = (content as any).language;
          if (lang) {
            languages.add(lang);
          }
        }
      }
    }

    return {
      sectionCount: sections.length,
      codeBlockCount,
      languages: Array.from(languages),
      customSections,
      parsedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Location
  // ==========================================================================

  private createModuleLocation(sections: Section[]): SourceLocation {
    if (sections.length === 0) {
      return {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
        source: this.source,
      };
    }

    return {
      start: { line: 1, column: 0, offset: 0 },
      end: sections[sections.length - 1]!.location.end,
      source: this.source,
    };
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  private validateAST(
    ast: MAMModule,
    errors: ParseError[],
    warnings: ParseWarning[]
  ): void {
    // Check for required sections
    const sectionNames = ast.sections.map(s => s.name);
    
    if (!sectionNames.includes('Purpose')) {
      errors.push(
        new ParseError(
          'Missing required section: Purpose',
          this.source,
          1,
          0,
          ParseErrorCode.MISSING_REQUIRED_SECTION
        )
      );
    }

    // Check for duplicate sections
    const seen = new Set<string>();
    for (const section of ast.sections) {
      if (seen.has(section.name)) {
        errors.push(
          new ParseError(
            `Duplicate section: ${section.name}`,
            this.source,
            section.location.start.line,
            section.location.start.column,
            ParseErrorCode.DUPLICATE_SECTION
          )
        );
      }
      seen.add(section.name);
    }

    // Check front matter
    if (!ast.frontmatter) {
      errors.push(
        new ParseError(
          'Missing front matter',
          this.source,
          1,
          0,
          ParseErrorCode.EXPECTED_FRONTMATTER
        )
      );
    } else {
      // Validate ID format
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(ast.frontmatter.data.id)) {
        errors.push(
          new ParseError(
            `Invalid ID format: "${ast.frontmatter.data.id}"`,
            this.source,
            1,
            0,
            ParseErrorCode.INVALID_YAML
          )
        );
      }

      // Validate version format
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(ast.frontmatter.data.version)) {
        errors.push(
          new ParseError(
            `Invalid version format: "${ast.frontmatter.data.version}"`,
            this.source,
            1,
            0,
            ParseErrorCode.INVALID_YAML
          )
        );
      }

      // Validate runtime
      const validRuntimes = ['python', 'javascript', 'typescript', 'rust', 'go', 'shell'];
      if (!validRuntimes.includes(ast.frontmatter.data.runtime)) {
        errors.push(
          new ParseError(
            `Invalid runtime: "${ast.frontmatter.data.runtime}"`,
            this.source,
            1,
            0,
            ParseErrorCode.INVALID_YAML
          )
        );
      }
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse tokens into AST
 */
export function parse(tokens: Token[], options?: ParserOptions): ParseResult {
  const parser = new MAMParser(tokens, options);
  return parser.parse();
}

/**
 * Parse raw Markdown into AST
 */
export function parseMarkdown(
  input: string,
  options?: ParserOptions & import('../lexer/tokenizer.js').TokenizerOptions
): ParseResult {
  // Dynamic import to avoid circular dependencies
  const { tokenize } = require('../lexer/tokenizer.js');
  const result = tokenize(input, options);
  
  const parser = new MAMParser(result.tokens, options);
  return parser.parse();
}