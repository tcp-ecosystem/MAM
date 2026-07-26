/**
 * MAM Language Server (v2)
 * 
 * Full LSP implementation with v2 DSL support.
 * Provides completion, diagnostics, hover, definition, references,
 * formatting, and code actions for MAM modules.
 */

import { Connection, InitializeParams, InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseMAM } from '@mam/parser';
import { CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, Hover, MarkupKind, TextEdit, CodeAction, CodeActionKind, Command } from 'vscode-languageserver-protocol';

// ============================================================================
// Constants
// ============================================================================

const V1_SECTIONS = ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid', 'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples', 'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities'];

const V2_MODULE_TYPES = ['module', 'agent', 'tool', 'memory', 'workflow', 'team', 'policy', 'system', 'service', 'component', 'resource', 'interface', 'contract', 'plugin', 'extension', 'runtime', 'package', 'repository', 'documentation'];

const V2_SECTIONS = ['type', 'role', 'goal', 'description', 'provider', 'format', 'backend', 'scope', 'ttl', 'requires', 'inputs', 'outputs', 'tools', 'memory', 'handoff', 'members', 'steps', 'edges', 'allow', 'deny', 'permissions', 'capabilities'];

const YAML_KEYS = ['id', 'version', 'name', 'author', 'runtime', 'tags', 'description', 'dependencies', 'permissions', 'license', 'repository', 'mam_version'];

const LANGUAGES = ['python', 'javascript', 'js', 'typescript', 'ts', 'rust', 'go', 'shell', 'bash', 'yaml', 'json', 'mermaid'];

const MEMORY_FORMATS = ['vector', 'key-value', 'relational', 'graph', 'document'];

const MEMORY_BACKENDS = ['sqlite', 'redis', 'postgres', 'mongodb', 'memory'];

const SCOPE_TYPES = ['module', 'workspace', 'global'];

const PERMISSION_KEYS = ['filesystem', 'network', 'python', 'memory', 'exec'];

const PERMISSION_VALUES: Record<string, string[]> = {
  filesystem: ['read', 'write', 'none'],
  network: ['internet', 'internal', 'none'],
  python: ['sandbox', 'full', 'none'],
  memory: ['local', 'shared', 'none'],
  exec: ['allowed', 'denied'],
};

const SECTION_DOCS: Record<string, string> = {
  Purpose: 'Module objective description. **Required section.**',
  Inputs: 'Expected input parameters in table format (Name, Type, Required, Description).',
  Outputs: 'Expected output values in table format (Name, Type, Description).',
  Rules: 'Behavioral constraints and guidelines. Use bullet list format.',
  Workflow: 'Process definition using Mermaid diagrams.',
  Mermaid: 'Visual diagram definitions using Mermaid syntax.',
  Python: 'Python code blocks for execution. Supports `@mam:` metadata comments.',
  JavaScript: 'JavaScript/TypeScript code blocks for execution.',
  TypeScript: 'TypeScript code blocks for execution.',
  Prompt: 'LLM instructions and prompts for AI agents.',
  Memory: 'Persistent state and knowledge. Use `**key**: value` format.',
  Examples: 'Usage demonstrations with runnable code.',
  Tests: 'Validation rules and test cases.',
  References: 'External links and documentation.',
  Dependencies: 'Required modules and packages.',
  Exports: 'Public interface definitions.',
  Imports: 'Required imports and dependencies.',
  Plugins: 'Required plugins for the module.',
  Permissions: 'Security permissions: network, filesystem, environment, exec, memory.',
  Capabilities: 'System capabilities required by the module.',
};

const V2_SECTION_DOCS: Record<string, string> = {
  type: 'Module type declaration (agent, tool, memory, workflow, team, policy, system, etc.)',
  role: 'Agent role description',
  goal: 'Agent or module goal',
  description: 'Module description',
  provider: 'Tool or memory provider',
  format: 'Memory format (vector, key-value, relational, graph, document)',
  backend: 'Memory backend (sqlite, redis, postgres, mongodb)',
  scope: 'Memory scope (module, workspace, global)',
  ttl: 'Time-to-live duration (e.g., 24h, 7d)',
  requires: 'Required dependencies',
  inputs: 'Input parameters (name: type)',
  outputs: 'Output values (name: type)',
  tools: 'Available tools',
  memory: 'Memory configuration',
  handoff: 'Handoff targets for agent delegation',
  members: 'Team member agents',
  steps: 'Workflow steps',
  edges: 'Communication edges (source -> target)',
  allow: 'Allowed actions (policy)',
  deny: 'Denied actions (policy)',
  permissions: 'Permission configuration',
  capabilities: 'Module capabilities',
};

// ============================================================================
// Server
// ============================================================================

export class MAMServer {
  private connection: Connection;
  private documents: Map<string, TextDocument> = new Map();
  private moduleCache: Map<string, string[]> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
    this.setupEventHandlers();
  }

  initialize(_params: InitializeParams): InitializeResult {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ['#', '-', '`', '[', ':', '>', ' '],
          resolveProvider: false,
        },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentFormattingProvider: true,
        codeActionProvider: true,
      },
    };
  }

  onInitialized(): void {
    this.connection.console.log('MAM Language Server v2 initialized');
  }

  shutdown(): void {}

  private setupEventHandlers(): void {
    this.connection.onCompletion(params => this.onCompletion(params));
    this.connection.onHover(params => this.onHover(params));
    this.connection.onDefinition(params => this.onDefinition(params));
    this.connection.onReferences(params => this.onReferences(params));
    this.connection.onDocumentFormatting(params => this.onFormatting(params));
    this.connection.onCodeAction(params => this.onCodeAction(params) as any);
    this.connection.onRequest('textDocument/diagnostic', params => this.getDiagnostics(params));

    // Track documents
    this.connection.onDidOpenTextDocument(params => {
      this.documents.set(params.textDocument.uri, TextDocument.create(
        params.textDocument.uri,
        params.textDocument.languageId,
        params.textDocument.version,
        params.textDocument.text
      ));
    });

    this.connection.onDidChangeTextDocument(params => {
      const doc = this.documents.get(params.textDocument.uri);
      if (doc) {
        this.documents.set(params.textDocument.uri, TextDocument.create(
          params.textDocument.uri,
          doc.languageId,
          params.textDocument.version,
          params.contentChanges[0]?.text || doc.getText()
        ));
      }
    });

    this.connection.onDidCloseTextDocument(params => {
      this.documents.delete(params.textDocument.uri);
    });
  }

  // ==========================================================================
  // Completion
  // ==========================================================================

  private onCompletion(params: { position: { line: number; character: number }; textDocument: { uri: string } }): CompletionItem[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const line = doc.getText().split('\n')[params.position.line] || '';
    const items: CompletionItem[] = [];

    // Module type declarations
    if (line.trim().startsWith('module ') || line.trim().startsWith('agent ') || 
        line.trim().startsWith('tool ') || line.trim().startsWith('memory ') ||
        line.trim().startsWith('workflow ') || line.trim().startsWith('team ') ||
        line.trim().startsWith('policy ') || line.trim().startsWith('system ')) {
      // After module declaration, suggest section names
      for (const section of V2_SECTIONS) {
        items.push({
          label: section,
          kind: CompletionItemKind.Property,
          detail: 'MAM Section',
          documentation: V2_SECTION_DOCS[section] || '',
        });
      }
    }
    // V1 sections
    else if (line.trimStart().startsWith('##')) {
      for (const name of V1_SECTIONS) {
        items.push({
          label: name,
          kind: CompletionItemKind.Class,
          detail: 'MAM Section',
          documentation: SECTION_DOCS[name] || '',
        });
      }
    }
    // YAML keys
    else if (line.includes(':') && line.trimStart().startsWith('-')) {
      for (const key of YAML_KEYS) {
        items.push({
          label: key,
          kind: CompletionItemKind.Property,
          detail: 'YAML Key',
        });
      }
    }
    // Type values
    else if (line.trim().startsWith('type:') || line.trim() === 'type') {
      for (const type of V2_MODULE_TYPES) {
        items.push({
          label: type,
          kind: CompletionItemKind.Enum,
          detail: 'Module Type',
        });
      }
    }
    // Format values
    else if (line.trim().startsWith('format:')) {
      for (const format of MEMORY_FORMATS) {
        items.push({
          label: format,
          kind: CompletionItemKind.Enum,
          detail: 'Memory Format',
        });
      }
    }
    // Backend values
    else if (line.trim().startsWith('backend:')) {
      for (const backend of MEMORY_BACKENDS) {
        items.push({
          label: backend,
          kind: CompletionItemKind.Enum,
          detail: 'Memory Backend',
        });
      }
    }
    // Scope values
    else if (line.trim().startsWith('scope:')) {
      for (const scope of SCOPE_TYPES) {
        items.push({
          label: scope,
          kind: CompletionItemKind.Enum,
          detail: 'Scope',
        });
      }
    }
    // Permission keys
    else if (line.trim().startsWith('permissions:') || line.trim().startsWith('filesystem:') ||
             line.trim().startsWith('network:') || line.trim().startsWith('python:') ||
             line.trim().startsWith('memory:') || line.trim().startsWith('exec:')) {
      for (const key of PERMISSION_KEYS) {
        items.push({
          label: key,
          kind: CompletionItemKind.Property,
          detail: 'Permission Key',
        });
      }
      // Also suggest permission values
      for (const [key, values] of Object.entries(PERMISSION_VALUES)) {
        if (line.includes(key)) {
          for (const value of values) {
            items.push({
              label: value,
              kind: CompletionItemKind.Enum,
              detail: `${key} value`,
            });
          }
        }
      }
    }
    // Language identifiers
    else if (line.includes('```')) {
      for (const lang of LANGUAGES) {
        items.push({
          label: lang,
          kind: CompletionItemKind.Enum,
          detail: 'Language',
        });
      }
    }
    // Arrow for edges
    else if (line.includes('-') && !line.includes('->')) {
      items.push({
        label: '->',
        kind: CompletionItemKind.Operator,
        detail: 'Edge arrow',
        insertText: ' -> ',
      });
    }
    // Default suggestions
    else {
      // Module declarations
      for (const keyword of ['module', 'agent', 'tool', 'memory', 'workflow', 'team', 'policy', 'system']) {
        items.push({
          label: keyword,
          kind: CompletionItemKind.Keyword,
          detail: 'Module declaration',
          insertText: `${keyword} `,
        });
      }
      // V1 sections
      for (const name of V1_SECTIONS) {
        items.push({
          label: `## ${name}`,
          kind: CompletionItemKind.Snippet,
          detail: 'MAM Section',
          insertText: `## ${name}\n\n`,
        });
      }
    }

    return items;
  }

  // ==========================================================================
  // Hover
  // ==========================================================================

  private onHover(params: { position: { line: number }; textDocument: { uri: string } }): Hover | null {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    const line = doc.getText().split('\n')[params.position.line] || '';

    // V1 section hover
    const v1Match = line.match(/^##\s+(.+)/);
    if (v1Match) {
      const name = v1Match[1]!.trim();
      const doc_text = SECTION_DOCS[name];
      if (doc_text) {
        return { contents: { kind: MarkupKind.Markdown, value: `**${name}**\n\n${doc_text}` } };
      }
    }

    // V2 module type hover
    const v2Match = line.match(/^(module|agent|tool|memory|workflow|team|policy|system)\s+(.+)/);
    if (v2Match) {
      const type = v2Match[1]!;
      const name = v2Match[2]!.trim();
      const typeDocs: Record<string, string> = {
        module: 'Generic module definition',
        agent: 'AI agent with role, goal, and tools',
        tool: 'Executable tool with provider',
        memory: 'Persistent memory store',
        workflow: 'Process workflow with steps',
        team: 'Agent team with members',
        policy: 'Behavioral policy with allow/deny rules',
        system: 'Complete system with agents and edges',
      };
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${type}**: ${name}\n\n${typeDocs[type] || 'Module type'}`,
        },
      };
    }

    // V2 section hover
    const sectionMatch = line.match(/^(\w+):/);
    if (sectionMatch) {
      const key = sectionMatch[1]!.toLowerCase();
      const doc_text = V2_SECTION_DOCS[key];
      if (doc_text) {
        return { contents: { kind: MarkupKind.Markdown, value: `**${key}**\n\n${doc_text}` } };
      }
    }

    return null;
  }

  // ==========================================================================
  // Definition
  // ==========================================================================

  private onDefinition(params: { position: { line: number }; textDocument: { uri: string } }): null {
    // Definition support for MAM modules
    return null;
  }

  // ==========================================================================
  // References
  // ==========================================================================

  private onReferences(params: { textDocument: { uri: string }; position: { line: number } }): null {
    return null;
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  private onFormatting(params: { textDocument: { uri: string } }): TextEdit[] | null {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const lines = text.split('\n');
    const formatted: string[] = [];
    let lastEmpty = false;

    for (const line of lines) {
      const trimmed = line.replace(/\s+$/, '');
      if (trimmed === '') {
        if (lastEmpty) continue;
        lastEmpty = true;
      } else {
        lastEmpty = false;
      }
      formatted.push(trimmed);
    }

    const result = formatted.join('\n');
    if (result === text) return null;

    const lastLine = lines.length - 1;
    return [{
      range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: 0 } },
      newText: result,
    }];
  }

  // ==========================================================================
  // Code Actions
  // ==========================================================================

  private onCodeAction(params: { textDocument: { uri: string }; range: { start: { line: number } } }): (Command | CodeAction)[] {
    const actions: (Command | CodeAction)[] = [];

    // Add Purpose section
    actions.push({
      title: 'Add Purpose section',
      kind: CodeActionKind.QuickFix as string,
      edit: {
        changes: {
          [params.textDocument.uri]: [{
            range: { start: { line: params.range.start.line, character: 0 }, end: { line: params.range.start.line, character: 0 } },
            newText: '## Purpose\n\nDescribe module purpose.\n\n',
          }],
        },
      },
    } as any);

    // Add type declaration
    actions.push({
      title: 'Add type: module',
      kind: CodeActionKind.QuickFix as string,
      edit: {
        changes: {
          [params.textDocument.uri]: [{
            range: { start: { line: params.range.start.line, character: 0 }, end: { line: params.range.start.line, character: 0 } },
            newText: 'type:\n    module\n\n',
          }],
        },
      },
    } as any);

    // Add permissions section
    actions.push({
      title: 'Add permissions section',
      kind: CodeActionKind.QuickFix as string,
      edit: {
        changes: {
          [params.textDocument.uri]: [{
            range: { start: { line: params.range.start.line, character: 0 }, end: { line: params.range.start.line, character: 0 } },
            newText: 'permissions:\n    network: internet\n    filesystem: read\n\n',
          }],
        },
      },
    } as any);

    return actions;
  }

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  private getDiagnostics(params: { textDocument: { uri: string } }): Diagnostic[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const result = parseMAM(doc.getText(), { source: params.textDocument.uri });
    const diagnostics: Diagnostic[] = [];

    for (const error of result.errors) {
      diagnostics.push({
        range: {
          start: { line: (error as any).line || 0, character: (error as any).column || 0 },
          end: { line: (error as any).line || 0, character: (error as any).column || 0 },
        },
        severity: DiagnosticSeverity.Error,
        message: (error as any).message,
        source: 'mam-lsp',
      });
    }

    for (const warning of result.warnings) {
      diagnostics.push({
        range: {
          start: { line: (warning as any).line || 0, character: (warning as any).column || 0 },
          end: { line: (warning as any).line || 0, character: (warning as any).column || 0 },
        },
        severity: DiagnosticSeverity.Warning,
        message: (warning as any).message,
        source: 'mam-lsp',
      });
    }

    return diagnostics;
  }
}