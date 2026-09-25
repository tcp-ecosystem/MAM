/**
 * MamDiagnostics — production diagnostics for MAM modules.
 *
 * Bridges the real MAM validator (`mam validate <file> --format json`) into the
 * VS Code Problems panel. Each CLI diagnostic (1-based line/column) is converted
 * into a vscode.Diagnostic with the appropriate severity and a range derived
 * from the source document.
 *
 * Validations are debounced per-document so typing does not spawn a process per
 * keystroke. If the CLI is unavailable (or the document is not on disk) we fall
 * back to lightweight structural checks (frontmatter + Purpose section) so the
 * user still gets immediate feedback.
 */

import * as vscode from 'vscode';
import { CliService, CliUnavailableError, type CliDiagnostic } from './cli';

/** Debounce window (ms) before a queued document is validated. */
const DEBOUNCE_MS = 400;

export class MamDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly cli: CliService;

  /** Pending debounce timers per document URI. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Generation counter per URI to discard stale async results. */
  private readonly generations = new Map<string, number>();

  /** Cached CLI availability; null = not yet probed. */
  private cliAvailable: boolean | null = null;

  constructor(cli: CliService) {
    this.collection = vscode.languages.createDiagnosticCollection('mam');
    this.cli = cli;
  }

  /** Clear the cached availability probe (call after a CLI install). */
  invalidateCliCache(): void {
    this.cliAvailable = null;
  }

  /**
   * Queue validation for a MAM document. Debounced so rapid edits coalesce.
   */
  validateDocument(doc: vscode.TextDocument, delayMs: number = DEBOUNCE_MS): void {
    if (doc.languageId !== 'mam') return;
    const key = doc.uri.toString();

    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.runValidation(doc);
    }, delayMs);
    this.timers.set(key, timer);
  }

  /** Cancel a pending validation and drop diagnostics for a URI. */
  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    this.generations.delete(key);
    this.collection.delete(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.collection.dispose();
  }

  /** Actual validation entry point (debounce fired). */
  private async runValidation(doc: vscode.TextDocument): Promise<void> {
    const key = doc.uri.toString();
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);

    // Only files on disk can be validated by the CLI. Anything else (untitled,
    // virtual documents) falls back to structural checks.
    if (doc.uri.scheme !== 'file') {
      this.setDiagnostics(doc, key, generation, this.fallbackChecks(doc));
      return;
    }

    const available = await this.resolveCliAvailability();
    if (generation !== this.generations.get(key)) return; // superseded

    if (!available) {
      this.setDiagnostics(doc, key, generation, this.fallbackChecks(doc));
      return;
    }

    try {
      const result = await this.cli.validate(doc.uri.fsPath);
      if (generation !== this.generations.get(key)) return;
      this.setDiagnostics(doc, key, generation, this.mapCliDiagnostics(doc, result.diagnostics));
    } catch (err) {
      if (generation !== this.generations.get(key)) return;
      if (err instanceof CliUnavailableError) {
        this.cliAvailable = false;
        this.setDiagnostics(doc, key, generation, this.fallbackChecks(doc));
      } else {
        // Transient CLI failure: surface a single error diagnostic.
        this.setDiagnostics(doc, key, generation, [
          new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            `mam validate failed: ${(err as Error).message}`,
            vscode.DiagnosticSeverity.Error,
          ),
        ]);
      }
    }
  }

  /** Probe the CLI once and cache the result. */
  private async resolveCliAvailability(): Promise<boolean> {
    if (this.cliAvailable !== null) return this.cliAvailable;
    this.cliAvailable = await this.cli.available();
    return this.cliAvailable;
  }

  /** Store diagnostics for a document, guarding against stale generations. */
  private setDiagnostics(
    doc: vscode.TextDocument,
    key: string,
    generation: number,
    diagnostics: vscode.Diagnostic[],
  ): void {
    if (generation !== this.generations.get(key)) return;
    this.collection.set(doc.uri, diagnostics);
  }

  /**
   * Map `mam validate` diagnostics (1-based) into vscode ranges (0-based).
   */
  private mapCliDiagnostics(doc: vscode.TextDocument, diagnostics: CliDiagnostic[]): vscode.Diagnostic[] {
    return diagnostics.map((d) => {
      const line = Math.max(0, (d.line || 1) - 1);
      const startCol = Math.max(0, (d.column || 1) - 1);
      const clampedLine = Math.min(line, Math.max(0, doc.lineCount - 1));
      const lineLength = doc.lineAt(clampedLine).text.length;

      const endLine = d.endLine !== undefined ? Math.max(0, d.endLine - 1) : clampedLine;
      const endCol = d.endColumn !== undefined ? Math.max(0, d.endColumn - 1) : Math.min(startCol + 1, Math.max(lineLength, 1));

      const range = new vscode.Range(
        clampedLine,
        Math.min(startCol, Math.max(lineLength, 0)),
        Math.min(endLine, Math.max(0, doc.lineCount - 1)),
        endCol,
      );

      const severity =
        d.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : d.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;

      const diag = new vscode.Diagnostic(range, d.message, severity);
      diag.source = 'mam';
      diag.code = d.ruleId;
      return diag;
    });
  }

  /**
   * Lightweight structural checks used when the CLI is not available.
   * Mirrors the intent of the built-in validator rules FM001 / SEC002.
   */
  private fallbackChecks(doc: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = doc.getText();

    if (!/^\s*---\s*$/m.test(text)) {
      diagnostics.push(this.warningAtTop('MAM module missing frontmatter (---)'));
    }

    if (!/^##\s+Purpose\b/m.test(text)) {
      diagnostics.push(this.warningAtTop('Missing required section: Purpose'));
    }

    return diagnostics;
  }

  private warningAtTop(message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message, vscode.DiagnosticSeverity.Warning);
  }
}