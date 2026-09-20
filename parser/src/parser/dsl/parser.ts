/**
 * MAM DSL Parser
 *
 * Parses v2 DSL syntax (module declarations, types, edges, etc.).
 * Extends the v1 parser with system description language support.
 */

import { Token, TokenType, STANDARD_SECTIONS } from '../../lexer/tokens.js';
import { ParseError, ParseErrorCode, ParseWarning, ParseWarningCode } from '../errors.js';
import {
  V2ModuleNode,
  V2AgentNode,
  V2ToolNode,
  V2MemoryNode,
  V2WorkflowNode,
  V2TeamNode,
  V2PolicyNode,
  V2SystemNode,
  V2StepNode,
  V2EdgeNode,
  V2PortDefinition,
  V2PermissionSet,
  V2MemoryReference,
  ModuleType,
  isModuleType,
  MODULE_TYPE_KEYWORDS,
  V2_SECTION_KEYWORDS,
} from '@mam/ast';
import { DSLParserOptions, DSLParseResult, DSLParseStats, DSLModuleSummary } from './types.js';
import { parseListItem, parseEdge, parseEdgeLine } from './helpers.js';
import { applySectionParsers, DSLParserSectionLike } from './sections.js';

// ============================================================================
// DSL Parser
// ============================================================================

export class DSLParser implements DSLParserSectionLike {
  public tokens: Token[];
  public pos: number = 0;
  public source: string;
  public strict: boolean;
  public allowUnknownTypes: boolean;
  public errors: ParseError[] = [];
  public warnings: ParseWarning[] = [];

  private startTime: number = 0;
  private moduleCount: number = 0;
  private sectionCount: number = 0;
  private edgeCount: number = 0;

  // Helper methods (bound by constructor)
  public parseListItem!: (module: V2ModuleNode, line: string) => boolean;
  public parseEdge!: (module: V2ModuleNode, line: string) => boolean;

  // Section parser methods (bound by applySectionParsers)
  public parseTypeSection!: (module: V2ModuleNode, value: string) => boolean;
  public parseMemorySection!: (module: V2ModuleNode, value: string) => boolean;
  public parseRequiresSection!: (module: V2ModuleNode) => boolean;
  public parseInputsSection!: (module: V2ModuleNode) => boolean;
  public parseOutputsSection!: (module: V2ModuleNode) => boolean;
  public parseToolsSection!: (module: V2ModuleNode) => boolean;
  public parseMembersSection!: (module: V2ModuleNode) => boolean;
  public parseHandoffSection!: (module: V2ModuleNode) => boolean;
  public parseAllowSection!: (module: V2ModuleNode) => boolean;
  public parseDenySection!: (module: V2ModuleNode) => boolean;
  public parsePermissionsSection!: (module: V2ModuleNode) => boolean;
  public parseStepsSection!: (module: V2ModuleNode) => boolean;
  public parseEdgesSection!: (module: V2ModuleNode) => boolean;
  public parseCapabilitiesSection!: (module: V2ModuleNode) => boolean;

  constructor(tokens: Token[], options: DSLParserOptions = {}) {
    this.tokens = tokens;
    this.source = options.source || '<input>';
    this.strict = options.strict || false;
    this.allowUnknownTypes = options.allowUnknownTypes !== false;

    applySectionParsers(this);

    (this as any).parseListItem = parseListItem.bind(null, this);
    (this as any).parseEdge = parseEdge.bind(null, this);
    (this as any).parseEdgeLine = parseEdgeLine.bind(null, this);
  }

  /**
   * Parse tokens into v2 modules
   */
  parse(): DSLParseResult {
    this.startTime = Date.now();
    this.moduleCount = 0;
    this.sectionCount = 0;
    this.edgeCount = 0;

    const modules: V2ModuleNode[] = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();

      if (this.isEOF()) break;

      const token = this.currentToken();
      if (token?.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        const module = this.parseModuleDeclaration();
        if (module) {
          modules.push(module);
          this.moduleCount++;
        }
      } else {
        this.pos++;
      }
    }

    return {
      modules,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  /**
   * Parse multiple modules from token stream
   */
  parseMultiModule(): DSLParseResult {
    return this.parse();
  }

  /**
   * Parse module body sections
   */
  parseModuleBody(module: V2ModuleNode): void {
    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      if (this.isEOF()) break;

      const token = this.currentToken();
      if (!token) break;

      if (token.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        break;
      }

      if (token.type >= TokenType.HEADING_1 && token.type <= TokenType.HEADING_6) {
        break;
      }

      const sectionParsed = this.parseSection(module);
      if (!sectionParsed) {
        this.pos++;
      }
    }
  }

  /**
   * Parse nested sections with depth tracking
   */
  parseNestedSections(module: V2ModuleNode, maxDepth: number): void {
    let depth = 0;
    while (this.pos < this.tokens.length && depth < maxDepth) {
      this.skipWhitespace();
      if (this.isEOF()) break;

      const token = this.currentToken();
      if (!token) break;

      if (token.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        break;
      }

      if (token.type >= TokenType.HEADING_1 && token.type <= TokenType.HEADING_6) {
        depth++;
        if (depth >= maxDepth) break;
      }

      const sectionParsed = this.parseSection(module);
      if (!sectionParsed) {
        this.pos++;
      }
    }
  }

  /**
   * Parse inline edge definitions
   */
  parseInlineEdge(module: V2ModuleNode, line: string): boolean {
    if (!module.edges) module.edges = [];

    const token = this.currentToken();
    if (!token) return false;

    const edge = parseEdgeLine(this, line, token);
    if (edge) {
      module.edges.push(edge);
      this.edgeCount++;
      return true;
    }
    return false;
  }

  /**
   * Skip block comments
   */
  parseBlockComment(): void {
    const token = this.currentToken();
    if (!token) return;

    const line = token.value.trim();
    if (line.startsWith('/*')) {
      this.pos++;
      while (this.pos < this.tokens.length) {
        const current = this.currentToken();
        if (!current) break;
        if (current.value.includes('*/')) {
          this.pos++;
          return;
        }
        this.pos++;
      }
    }
  }

  /**
   * Extract metadata from tokens
   */
  parseMetadata(): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('#') || line.startsWith('//')) {
        this.pos++;
        continue;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) break;

      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();

      if (key && value) {
        metadata[key] = value;
      }
      this.pos++;
    }

    return metadata;
  }

  /**
   * Recover from parse errors
   */
  recoverFromError(): void {
    while (this.pos < this.tokens.length) {
      const token = this.currentToken();
      if (!token) break;

      if (token.type === TokenType.NEWLINE) {
        this.pos++;
        const next = this.currentToken();
        if (next && next.type === TokenType.TEXT && this.isModuleDeclaration(next.value)) {
          return;
        }
      }
      this.pos++;
    }
  }

  /**
   * Expect a specific token type
   */
  expectToken(type: TokenType): Token | null {
    const token = this.currentToken();
    if (!token || token.type !== type) {
      this.addError(
        ParseErrorCode.UNEXPECTED_TOKEN,
        `Expected ${TokenType[type]}, found ${token ? TokenType[token.type] : 'EOF'}`,
        token
      );
      return null;
    }
    this.pos++;
    return token;
  }

  /**
   * Look ahead without consuming
   */
  peekToken(offset: number = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  /**
   * Get combined text of current tokens
   */
  getTokenText(): string {
    const token = this.currentToken();
    if (!token) return '';
    return token.value;
  }

  /**
   * Get current location
   */
  getLocation(): { line: number; column: number; offset: number } {
    const token = this.currentToken();
    if (!token) return { line: 0, column: 0, offset: 0 };
    return { line: token.line, column: token.column, offset: token.offset };
  }

  /**
   * Centralized error reporting
   */
  addError(code: ParseErrorCode, message: string, token?: Token): void {
    const line = token?.line || 0;
    const column = token?.column || 0;
    this.errors.push(new ParseError(message, this.source, line, column, code));
  }

  /**
   * Centralized warning reporting
   */
  addWarning(code: ParseWarningCode, message: string, token?: Token): void {
    const line = token?.line || 0;
    const column = token?.column || 0;
    this.warnings.push(new ParseWarning(message, this.source, line, column, code));
  }

  /**
   * Find a parsed module by name
   */
  getModuleByName(name: string): V2ModuleNode | null {
    const result = this.parse();
    return result.modules.find(m => m.name === name) || null;
  }

  /**
   * Get parser statistics
   */
  getStats(): DSLParseStats {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;
    return {
      tokensProcessed: this.tokens.length,
      modulesParsed: this.moduleCount,
      sectionsParsed: this.sectionCount,
      edgesParsed: this.edgeCount,
      errorsFound: this.errors.length,
      warningsFound: this.warnings.length,
      durationMs,
      startTime: this.startTime,
      endTime,
      averageModuleTime: this.moduleCount > 0 ? durationMs / this.moduleCount : 0,
      peakMemoryUsage: 0,
    };
  }

  /**
   * Get module summaries
   */
  getModuleSummaries(modules: V2ModuleNode[]): DSLModuleSummary[] {
    return modules.map(m => ({
      name: m.name,
      type: m.moduleType,
      sections: this.getModuleSections(m),
      inputs: (m.inputs || []).map(i => i.name),
      outputs: (m.outputs || []).map(o => o.name),
      dependencies: m.requires || [],
      edgeCount: (m.edges || []).length,
      lineCount: m.location.end.line - m.location.start.line + 1,
      hasDocumentation: !!m.documentation,
      hasTests: !!m.tests,
    }));
  }

  /**
   * Get sections of a module
   */
  private getModuleSections(module: V2ModuleNode): string[] {
    const sections: string[] = [];
    if (module.moduleType) sections.push('type');
    if (module.role) sections.push('role');
    if (module.goal) sections.push('goal');
    if (module.description) sections.push('description');
    if (module.provider) sections.push('provider');
    if (module.format) sections.push('format');
    if (module.backend) sections.push('backend');
    if (module.scope) sections.push('scope');
    if (module.ttl) sections.push('ttl');
    if (module.memory) sections.push('memory');
    if (module.requires) sections.push('requires');
    if (module.inputs) sections.push('inputs');
    if (module.outputs) sections.push('outputs');
    if (module.tools) sections.push('tools');
    if (module.members) sections.push('members');
    if (module.handoff) sections.push('handoff');
    if (module.allow) sections.push('allow');
    if (module.deny) sections.push('deny');
    if (module.permissions) sections.push('permissions');
    if (module.steps) sections.push('steps');
    if (module.edges) sections.push('edges');
    if (module.capabilities) sections.push('capabilities');
    if (module.events) sections.push('events');
    if (module.state) sections.push('state');
    if (module.lifecycle) sections.push('lifecycle');
    if (module.documentation) sections.push('documentation');
    if (module.rules) sections.push('rules');
    if (module.prompts) sections.push('prompts');
    if (module.tests) sections.push('tests');
    if (module.examples) sections.push('examples');
    return sections;
  }

  // ==========================================================================
  // Module Declaration
  // ==========================================================================

  private isModuleDeclaration(text: string): boolean {
    const trimmed = text.trim();
    return MODULE_TYPE_KEYWORDS.has(trimmed.split(/\s/)[0] || '');
  }

  private parseModuleDeclaration(): V2ModuleNode | null {
    const startToken = this.currentToken();
    if (!startToken) return null;

    const line = startToken.value.trim();
    const parts = line.split(/\s+/);
    const keyword = parts[0]!;
    const name = parts.slice(1).join(' ') || 'unnamed';

    let moduleType: ModuleType = 'module';
    if (keyword === 'agent') moduleType = 'agent';
    else if (keyword === 'tool') moduleType = 'tool';
    else if (keyword === 'memory') moduleType = 'memory';
    else if (keyword === 'workflow') moduleType = 'workflow';
    else if (keyword === 'team') moduleType = 'team';
    else if (keyword === 'policy') moduleType = 'policy';
    else if (keyword === 'system') moduleType = 'system';
    else if (keyword === 'module') moduleType = 'module';

    this.pos++;

    const module: V2ModuleNode = {
      type: 'ModuleNode',
      name,
      moduleType,
      location: {
        start: { line: startToken.line, column: startToken.column, offset: startToken.offset },
        end: { line: startToken.line, column: startToken.column + startToken.length, offset: startToken.offset + startToken.length },
        source: this.source,
      },
    };

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      if (this.isEOF()) break;

      const token = this.currentToken();
      if (!token) break;

      if (token.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        break;
      }

      if (token.type >= TokenType.HEADING_1 && token.type <= TokenType.HEADING_6) {
        break;
      }

      const sectionParsed = this.parseSection(module);
      if (!sectionParsed) {
        this.pos++;
      }
    }

    const lastToken = this.tokens[Math.min(this.pos - 1, this.tokens.length - 1)];
    if (lastToken) {
      module.location.end = {
        line: lastToken.line,
        column: lastToken.column + lastToken.length,
        offset: lastToken.offset + lastToken.length,
      };
    }

    return module;
  }

  // ==========================================================================
  // Section Parsing
  // ==========================================================================

  private parseSection(module: V2ModuleNode): boolean {
    const token = this.currentToken();
    if (!token || token.type !== TokenType.TEXT) return false;

    const line = token.value.trim();
    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) {
      if (line.startsWith('- ')) {
        return this.parseListItem(module, line);
      }
      if (line.includes('->')) {
        return this.parseEdge(module, line);
      }
      return false;
    }

    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    this.pos++;
    this.sectionCount++;

    switch (key) {
      case 'type':
        return this.parseTypeSection(module, value);
      case 'role':
        module.role = value || undefined;
        return true;
      case 'goal':
        module.goal = value || undefined;
        return true;
      case 'description':
        module.description = value || undefined;
        return true;
      case 'provider':
        module.provider = value || undefined;
        return true;
      case 'format':
        module.format = value || undefined;
        return true;
      case 'backend':
        module.backend = value || undefined;
        return true;
      case 'scope':
        module.scope = value || undefined;
        return true;
      case 'ttl':
        module.ttl = value || undefined;
        return true;
      case 'policy':
        return true;
      case 'memory':
        return this.parseMemorySection(module, value);
      case 'requires':
        return this.parseRequiresSection(module);
      case 'inputs':
        return this.parseInputsSection(module);
      case 'outputs':
        return this.parseOutputsSection(module);
      case 'tools':
        return this.parseToolsSection(module);
      case 'members':
        return this.parseMembersSection(module);
      case 'handoff':
        return this.parseHandoffSection(module);
      case 'allow':
        return this.parseAllowSection(module);
      case 'deny':
        return this.parseDenySection(module);
      case 'permissions':
        return this.parsePermissionsSection(module);
      case 'steps':
        return this.parseStepsSection(module);
      case 'edges':
        return this.parseEdgesSection(module);
      case 'capabilities':
        return this.parseCapabilitiesSection(module);
      default:
        if (!this.allowUnknownTypes) {
          this.warnings.push(
            new ParseWarning(
              `Unknown section: "${key}"`,
              this.source,
              token.line,
              token.column,
              ParseWarningCode.UNKNOWN_SECTION
            )
          );
        }
        return false;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  currentToken(): Token | undefined {
    return this.tokens[this.pos];
  }

  skipWhitespace(): void {
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos]!;
      if (token.type === TokenType.NEWLINE || token.type === TokenType.WHITESPACE) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  isEOF(): boolean {
    return this.pos >= this.tokens.length || this.tokens[this.pos]?.type === TokenType.EOF;
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

export function parseDSL(tokens: Token[], options?: DSLParserOptions): DSLParseResult {
  const parser = new DSLParser(tokens, options);
  return parser.parse();
}
