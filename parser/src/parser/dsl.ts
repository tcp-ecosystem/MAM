/**
 * MAM DSL Parser
 * 
 * Parses v2 DSL syntax (module declarations, types, edges, etc.).
 * Extends the v1 parser with system description language support.
 */

import { Token, TokenType, STANDARD_SECTIONS } from '../lexer/tokens.js';
import { ParseError, ParseErrorCode, ParseWarning, ParseWarningCode } from './errors.js';
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

// ============================================================================
// DSL Parser Configuration
// ============================================================================

export interface DSLParserOptions {
  source?: string;
  strict?: boolean;
  allowUnknownTypes?: boolean;
}

export interface DSLParseResult {
  modules: V2ModuleNode[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

// ============================================================================
// DSL Parser
// ============================================================================

export class DSLParser {
  private tokens: Token[];
  private pos: number = 0;
  private source: string;
  private strict: boolean;
  private allowUnknownTypes: boolean;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];

  constructor(tokens: Token[], options: DSLParserOptions = {}) {
    this.tokens = tokens;
    this.source = options.source || '<input>';
    this.strict = options.strict || false;
    this.allowUnknownTypes = options.allowUnknownTypes !== false;
  }

  /**
   * Parse tokens into v2 modules
   */
  parse(): DSLParseResult {
    const modules: V2ModuleNode[] = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();

      if (this.isEOF()) break;

      // Look for module declarations
      const token = this.currentToken();
      if (token?.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        const module = this.parseModuleDeclaration();
        if (module) modules.push(module);
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

    // Determine module type
    let moduleType: ModuleType = 'module';
    if (keyword === 'agent') moduleType = 'agent';
    else if (keyword === 'tool') moduleType = 'tool';
    else if (keyword === 'memory') moduleType = 'memory';
    else if (keyword === 'workflow') moduleType = 'workflow';
    else if (keyword === 'team') moduleType = 'team';
    else if (keyword === 'policy') moduleType = 'policy';
    else if (keyword === 'system') moduleType = 'system';
    else if (keyword === 'module') moduleType = 'module';

    this.pos++; // Skip declaration line

    // Parse sections
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

    // Parse sections until next module or EOF
    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      if (this.isEOF()) break;

      const token = this.currentToken();
      if (!token) break;

      // Stop at next module declaration
      if (token.type === TokenType.TEXT && this.isModuleDeclaration(token.value)) {
        break;
      }

      // Stop at next heading (v1 section)
      if (token.type >= TokenType.HEADING_1 && token.type <= TokenType.HEADING_6) {
        break;
      }

      // Parse section
      const sectionParsed = this.parseSection(module);
      if (!sectionParsed) {
        this.pos++;
      }
    }

    // Update end location
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
      // Might be a list item or edge
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

    this.pos++; // Skip key line

    // Parse based on key
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
        // Reference to policy module
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
        // Unknown section
        if (!this.allowUnknownTypes) {
          this.warnings.push({
            message: `Unknown section: "${key}"`,
            source: this.source,
            line: token.line,
            column: token.column,
            code: ParseWarningCode.UNKNOWN_SECTION,
          });
        }
        return false;
    }
  }

  // ==========================================================================
  // Type Section
  // ==========================================================================

  private parseTypeSection(module: V2ModuleNode, value: string): boolean {
    if (value && isModuleType(value)) {
      module.moduleType = value as ModuleType;
    }
    return true;
  }

  // ==========================================================================
  // Memory Section
  // ==========================================================================

  private parseMemorySection(module: V2ModuleNode, value: string): boolean {
    if (value === 'shared' || value === 'local' || value === 'external') {
      module.memory = { type: value as 'local' | 'shared' | 'external' };
    } else if (value) {
      module.memory = { type: 'shared', name: value };
    }
    return true;
  }

  // ==========================================================================
  // Requires Section
  // ==========================================================================

  private parseRequiresSection(module: V2ModuleNode): boolean {
    if (!module.requires) module.requires = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.requires.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        // Next section
        break;
      } else {
        // Indented value
        module.requires.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Inputs Section
  // ==========================================================================

  private parseInputsSection(module: V2ModuleNode): boolean {
    if (!module.inputs) module.inputs = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        const content = line.slice(2).trim();
        const parts = content.split(':').map(p => p.trim());
        module.inputs.push({
          name: parts[0] || '',
          type: parts[1] || 'string',
          required: true,
        });
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        const parts = line.split(':').map(p => p.trim());
        if (parts.length >= 2) {
          module.inputs.push({
            name: parts[0] || '',
            type: parts[1] || 'string',
            required: true,
          });
        }
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Outputs Section
  // ==========================================================================

  private parseOutputsSection(module: V2ModuleNode): boolean {
    if (!module.outputs) module.outputs = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        const content = line.slice(2).trim();
        const parts = content.split(':').map(p => p.trim());
        module.outputs.push({
          name: parts[0] || '',
          type: parts[1] || 'string',
          required: false,
        });
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        const parts = line.split(':').map(p => p.trim());
        if (parts.length >= 2) {
          module.outputs.push({
            name: parts[0] || '',
            type: parts[1] || 'string',
            required: false,
          });
        }
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Tools Section
  // ==========================================================================

  private parseToolsSection(module: V2ModuleNode): boolean {
    if (!module.tools) module.tools = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.tools.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.tools.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Members Section
  // ==========================================================================

  private parseMembersSection(module: V2ModuleNode): boolean {
    if (!module.members) module.members = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.members.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.members.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Handoff Section
  // ==========================================================================

  private parseHandoffSection(module: V2ModuleNode): boolean {
    if (!module.handoff) module.handoff = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.handoff.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.handoff.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Allow Section
  // ==========================================================================

  private parseAllowSection(module: V2ModuleNode): boolean {
    if (!module.allow) module.allow = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.allow.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.allow.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Deny Section
  // ==========================================================================

  private parseDenySection(module: V2ModuleNode): boolean {
    if (!module.deny) module.deny = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.deny.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.deny.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Permissions Section
  // ==========================================================================

  private parsePermissionsSection(module: V2ModuleNode): boolean {
    if (!module.permissions) {
      module.permissions = {};
    }

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      const colonIndex = line.indexOf(':');

      if (colonIndex === -1) break;

      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();

      if (key === 'filesystem') module.permissions.filesystem = value as 'read' | 'write' | 'none';
      else if (key === 'network') module.permissions.network = value as 'internet' | 'internal' | 'none';
      else if (key === 'python') module.permissions.python = value as 'sandbox' | 'full' | 'none';
      else if (key === 'memory') module.permissions.memory = value as 'local' | 'shared' | 'none';
      else if (key === 'exec') module.permissions.exec = value as 'allowed' | 'denied';
      else {
        if (!module.permissions.custom) module.permissions.custom = {};
        module.permissions.custom[key] = value;
      }

      this.pos++;
    }

    return true;
  }

  // ==========================================================================
  // Steps Section
  // ==========================================================================

  private parseStepsSection(module: V2ModuleNode): boolean {
    if (!module.steps) module.steps = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        const stepName = line.slice(2).trim();
        const step: V2StepNode = {
          type: 'StepNode',
          name: stepName,
          location: {
            start: { line: token.line, column: token.column, offset: token.offset },
            end: { line: token.line, column: token.column + token.length, offset: token.offset + token.length },
            source: this.source,
          },
        };
        module.steps.push(step);
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Edges Section
  // ==========================================================================

  private parseEdgesSection(module: V2ModuleNode): boolean {
    if (!module.edges) module.edges = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.includes('->')) {
        const edge = this.parseEdgeLine(line, token);
        if (edge) module.edges.push(edge);
        this.pos++;
      } else if (line.startsWith('- ')) {
        const edgeContent = line.slice(2).trim();
        if (edgeContent.includes('->')) {
          const edge = this.parseEdgeLine(edgeContent, token);
          if (edge) module.edges.push(edge);
        }
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // Capabilities Section
  // ==========================================================================

  private parseCapabilitiesSection(module: V2ModuleNode): boolean {
    if (!module.capabilities) module.capabilities = [];

    while (this.pos < this.tokens.length) {
      this.skipWhitespace();
      const token = this.currentToken();
      if (!token || token.type !== TokenType.TEXT) break;

      const line = token.value.trim();
      if (line.startsWith('- ')) {
        module.capabilities.push(line.slice(2).trim());
        this.pos++;
      } else if (line.includes(':') && !line.startsWith('-')) {
        break;
      } else {
        module.capabilities.push(line);
        this.pos++;
      }
    }

    return true;
  }

  // ==========================================================================
  // List Item
  // ==========================================================================

  private parseListItem(module: V2ModuleNode, line: string): boolean {
    // Try to infer context from previous sections
    // This is a fallback for unstructured list items
    return false;
  }

  // ==========================================================================
  // Edge Parsing
  // ==========================================================================

  private parseEdge(module: V2ModuleNode, line: string): boolean {
    if (!module.edges) module.edges = [];

    const edge = this.parseEdgeLine(line, this.currentToken()!);
    if (edge) {
      module.edges.push(edge);
      this.pos++;
      return true;
    }

    return false;
  }

  private parseEdgeLine(line: string, token: Token): V2EdgeNode | null {
    const arrowIndex = line.indexOf('->');
    if (arrowIndex === -1) return null;

    const source = line.slice(0, arrowIndex).trim();
    const rest = line.slice(arrowIndex + 2).trim();

    // Check for condition [condition]
    let target = rest;
    let condition: string | undefined;

    const bracketStart = rest.indexOf('[');
    const bracketEnd = rest.indexOf(']');
    if (bracketStart !== -1 && bracketEnd !== -1) {
      condition = rest.slice(bracketStart + 1, bracketEnd);
      target = rest.slice(0, bracketStart).trim();
    }

    return {
      type: 'EdgeNode',
      source,
      target,
      condition,
      location: {
        start: { line: token.line, column: token.column, offset: token.offset },
        end: { line: token.line, column: token.column + token.length, offset: token.offset + token.length },
        source: this.source,
      },
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private currentToken(): Token | undefined {
    return this.tokens[this.pos];
  }

  private skipWhitespace(): void {
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos]!;
      if (token.type === TokenType.NEWLINE || token.type === TokenType.WHITESPACE) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private isEOF(): boolean {
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