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
import { CompletionItem, Diagnostic, DiagnosticSeverity, Hover, TextEdit, CodeAction, Command } from 'vscode-languageserver-protocol';
import { createEvaluator, createMetricsRegistry, createTracer } from '@mam/observability';
import type { Evaluator, EvaluationResult, MetricsRegistry, TraceSpan, Tracer } from '@mam/observability';
import { getCompletions } from './features/completion.js';
import { getHover } from './features/hover.js';
import { getDefinition } from './features/definition.js';
import { getReferences } from './features/references.js';
import { getFormatting } from './features/formatting.js';
import { getCodeActions } from './features/codeAction.js';
import { getDiagnostics } from './features/diagnostics.js';
import type { MAMModule } from '@mam/parser';

// ============================================================================
// Server
// ============================================================================

export interface MAMServerOptions {
  telemetry?: boolean;
}

export interface MAMTelemetrySnapshot {
  spans: TraceSpan[];
  counters: Record<string, number>;
  evaluations: EvaluationResult[];
}

export class MAMServer {
  private connection: Connection;
  private documents: Map<string, TextDocument> = new Map();
  private astCache: Map<string, MAMModule> = new Map();

  private readonly telemetryEnabled: boolean;
  private tracer: Tracer | undefined;
  private metrics: MetricsRegistry | undefined;
  private evaluator: Evaluator | undefined;
  private readonly evaluations: EvaluationResult[] = [];

  constructor(connection: Connection, options: MAMServerOptions = {}) {
    this.connection = connection;
    this.telemetryEnabled = options.telemetry ?? false;
    if (this.telemetryEnabled) {
      this.tracer = createTracer();
      this.metrics = createMetricsRegistry();
      this.evaluator = createEvaluator();
    }
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
      const doc = TextDocument.create(
        params.textDocument.uri,
        params.textDocument.languageId,
        params.textDocument.version,
        params.textDocument.text,
      );
      this.documents.set(params.textDocument.uri, doc);
      this.updateAST(params.textDocument.uri, params.textDocument.text);
    });

    this.connection.onDidChangeTextDocument(params => {
      const doc = this.documents.get(params.textDocument.uri);
      if (doc) {
        const newText = params.contentChanges[0]?.text || doc.getText();
        const updated = TextDocument.create(
          params.textDocument.uri,
          doc.languageId,
          params.textDocument.version,
          newText,
        );
        this.documents.set(params.textDocument.uri, updated);
        this.updateAST(params.textDocument.uri, newText);
      }
    });

    this.connection.onDidCloseTextDocument(params => {
      this.documents.delete(params.textDocument.uri);
      this.astCache.delete(params.textDocument.uri);
    });
  }

  private updateAST(uri: string, text: string): void {
    try {
      const result = parseMAM(text, { source: uri });
      this.astCache.set(uri, result.ast);
    } catch {
      this.astCache.delete(uri);
    }
  }

  // ==========================================================================
  // Completion
  // ==========================================================================

  private onCompletion(params: { position: { line: number; character: number }; textDocument: { uri: string } }): CompletionItem[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const ast = this.astCache.get(params.textDocument.uri) || null;
    return getCompletions(params.textDocument.uri, params.position, doc, ast);
  }

  // ==========================================================================
  // Hover
  // ==========================================================================

  private onHover(params: { position: { line: number; character: number }; textDocument: { uri: string } }): Hover | null {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    const ast = this.astCache.get(params.textDocument.uri) || null;
    return getHover(params.textDocument.uri, params.position, doc, ast);
  }

  // ==========================================================================
  // Definition
  // ==========================================================================

  private onDefinition(params: { position: { line: number; character: number }; textDocument: { uri: string } }) {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    const ast = this.astCache.get(params.textDocument.uri) || null;
    return getDefinition(params.textDocument.uri, params.position, doc, ast);
  }

  // ==========================================================================
  // References
  // ==========================================================================

  private onReferences(params: { textDocument: { uri: string }; position: { line: number; character: number }; context: { includeDeclaration: boolean } }) {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const ast = this.astCache.get(params.textDocument.uri) || null;
    return getReferences(
      params.textDocument.uri,
      params.position,
      doc,
      ast,
      params.context.includeDeclaration,
    );
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  private onFormatting(params: { textDocument: { uri: string }; options: { tabSize: number; insertSpaces: boolean } }): TextEdit[] | null {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    return getFormatting(doc.getText(), params.options);
  }

  // ==========================================================================
  // Code Actions
  // ==========================================================================

  private onCodeAction(params: { textDocument: { uri: string }; range: any; context: { diagnostics: Diagnostic[] } }): (Command | CodeAction)[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const ast = this.astCache.get(params.textDocument.uri) || null;
    return getCodeActions(doc, params.range, params.context, ast) as any;
  }

  // ==========================================================================
  // Diagnostics
  // ==========================================================================

  private getDiagnostics(params: { textDocument: { uri: string } }): Diagnostic[] {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return [];

    const ast = this.astCache.get(params.textDocument.uri) || null;

    if (!this.telemetryEnabled || !this.tracer || !this.metrics || !this.evaluator) {
      return getDiagnostics(doc, ast);
    }

    const started = Date.now();
    const result = this.tracer.traceSync(
      () => getDiagnostics(doc, ast),
      'mam.lsp.validate',
      { attributes: { 'lsp.document.uri': params.textDocument.uri } },
    );
    const latencyMs = Date.now() - started;

    this.metrics.counter('diagnostics').increment();
    this.metrics.histogram('validate_latency_ms').observe(latencyMs);

    const hasErrors = result.some(d => d.severity === DiagnosticSeverity.Error);
    const score = hasErrors ? 0 : 1;
    this.evaluations.push(this.evaluator.evaluate('lsp.diagnostics', score));

    return result;
  }

  getTelemetry(): MAMTelemetrySnapshot | undefined {
    if (!this.telemetryEnabled || !this.tracer || !this.metrics) {
      return undefined;
    }

    const spans = this.tracer.query().search(() => true, Number.MAX_SAFE_INTEGER);
    const counters: Record<string, number> = {};
    for (const metric of this.metrics.collect()) {
      if (metric.type === 'counter') {
        const latest = metric.samples[metric.samples.length - 1];
        counters[metric.name] = latest?.value ?? 0;
      }
    }

    return { spans, counters, evaluations: [...this.evaluations] };
  }

  getDocument(uri: string): TextDocument | undefined {
    return this.documents.get(uri);
  }

  getCachedAST(uri: string): MAMModule | undefined {
    return this.astCache.get(uri);
  }

  getOpenUris(): string[] {
    return Array.from(this.documents.keys());
  }

  hasDocument(uri: string): boolean {
    return this.documents.has(uri);
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  refreshDocument(uri: string, text: string, version?: number, languageId?: string): void {
    const existing = this.documents.get(uri);
    const doc = TextDocument.create(
      uri,
      languageId ?? existing?.languageId ?? 'mam',
      version ?? (existing ? existing.version + 1 : 1),
      text,
    );
    this.documents.set(uri, doc);
    this.updateAST(uri, text);
  }

  clearCache(): void {
    this.documents.clear();
    this.astCache.clear();
  }
}
