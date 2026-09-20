import { Token, TokenType } from '../../lexer/tokens.js';
import { ParseWarning, ParseWarningCode } from '../errors.js';
import {
  V2ModuleNode,
  V2StepNode,
  isModuleType,
  ModuleType,
} from '@mam/ast';
import { DSLParserLike, parseEdgeLine } from './helpers.js';

export interface DSLParserSectionLike extends DSLParserLike {
  warnings: ParseWarning[];
  allowUnknownTypes: boolean;
}

export function parseTypeSection(parser: DSLParserSectionLike, module: V2ModuleNode, value: string): boolean {
  if (value && isModuleType(value)) {
    module.moduleType = value as ModuleType;
  }
  return true;
}

export function parseMemorySection(parser: DSLParserSectionLike, module: V2ModuleNode, value: string): boolean {
  if (value === 'shared' || value === 'local' || value === 'external') {
    module.memory = { type: value as 'local' | 'shared' | 'external' };
  } else if (value) {
    module.memory = { type: 'shared', name: value };
  }
  return true;
}

export function parseRequiresSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.requires) module.requires = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.requires.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.requires.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parseInputsSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.inputs) module.inputs = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
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
      parser.pos++;
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
      parser.pos++;
    }
  }

  return true;
}

export function parseOutputsSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.outputs) module.outputs = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
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
      parser.pos++;
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
      parser.pos++;
    }
  }

  return true;
}

export function parseToolsSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.tools) module.tools = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.tools.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.tools.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parseMembersSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.members) module.members = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.members.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.members.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parseHandoffSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.handoff) module.handoff = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.handoff.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.handoff.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parseAllowSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.allow) module.allow = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.allow.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.allow.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parseDenySection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.deny) module.deny = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.deny.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.deny.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function parsePermissionsSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.permissions) {
    module.permissions = {};
  }

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
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

    parser.pos++;
  }

  return true;
}

export function parseStepsSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.steps) module.steps = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
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
          source: parser.source,
        },
      };
      module.steps.push(step);
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      parser.pos++;
    }
  }

  return true;
}

export function parseEdgesSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.edges) module.edges = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.includes('->')) {
      const edge = parseEdgeLine(parser, line, token);
      if (edge) module.edges.push(edge);
      parser.pos++;
    } else if (line.startsWith('- ')) {
      const edgeContent = line.slice(2).trim();
      if (edgeContent.includes('->')) {
        const edge = parseEdgeLine(parser, edgeContent, token);
        if (edge) module.edges.push(edge);
      }
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      parser.pos++;
    }
  }

  return true;
}

export function parseCapabilitiesSection(parser: DSLParserSectionLike, module: V2ModuleNode): boolean {
  if (!module.capabilities) module.capabilities = [];

  while (parser.pos < parser.tokens.length) {
    parser.skipWhitespace();
    const token = parser.currentToken();
    if (!token || token.type !== TokenType.TEXT) break;

    const line = token.value.trim();
    if (line.startsWith('- ')) {
      module.capabilities.push(line.slice(2).trim());
      parser.pos++;
    } else if (line.includes(':') && !line.startsWith('-')) {
      break;
    } else {
      module.capabilities.push(line);
      parser.pos++;
    }
  }

  return true;
}

export function applySectionParsers(parser: DSLParserSectionLike): void {
  (parser as any).parseTypeSection = parseTypeSection.bind(null, parser);
  (parser as any).parseMemorySection = parseMemorySection.bind(null, parser);
  (parser as any).parseRequiresSection = parseRequiresSection.bind(null, parser);
  (parser as any).parseInputsSection = parseInputsSection.bind(null, parser);
  (parser as any).parseOutputsSection = parseOutputsSection.bind(null, parser);
  (parser as any).parseToolsSection = parseToolsSection.bind(null, parser);
  (parser as any).parseMembersSection = parseMembersSection.bind(null, parser);
  (parser as any).parseHandoffSection = parseHandoffSection.bind(null, parser);
  (parser as any).parseAllowSection = parseAllowSection.bind(null, parser);
  (parser as any).parseDenySection = parseDenySection.bind(null, parser);
  (parser as any).parsePermissionsSection = parsePermissionsSection.bind(null, parser);
  (parser as any).parseStepsSection = parseStepsSection.bind(null, parser);
  (parser as any).parseEdgesSection = parseEdgesSection.bind(null, parser);
  (parser as any).parseCapabilitiesSection = parseCapabilitiesSection.bind(null, parser);
}
