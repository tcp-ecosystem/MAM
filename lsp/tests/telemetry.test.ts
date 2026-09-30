/**
 * MAMServer Telemetry Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAMServer } from '../src/server.js';

const mockConnection = {
  onInitialize: vi.fn(),
  onInitialized: vi.fn(),
  onShutdown: vi.fn(),
  onCompletion: vi.fn(),
  onHover: vi.fn(),
  onDefinition: vi.fn(),
  onReferences: vi.fn(),
  onDocumentFormatting: vi.fn(),
  onCodeAction: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  onRequest: vi.fn(),
  console: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
} as any;

function openDoc(
  uri = 'file:///test.mam.md',
  text = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---\n\n## Purpose\n\nContent\n',
): void {
  const handler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
  handler({
    textDocument: { uri, languageId: 'mam', version: 1, text },
  });
}

function runDiagnostics(uri = 'file:///test.mam.md'): unknown {
  const diagnosticHandler = mockConnection.onRequest.mock.calls.find(
    (call: any[]) => call[0] === 'textDocument/diagnostic'
  )?.[1];
  if (!diagnosticHandler) {
    throw new Error('diagnostic handler not registered');
  }
  return diagnosticHandler({ textDocument: { uri } });
}

describe('MAMServer telemetry', () => {
  describe('when telemetry is enabled', () => {
    let server: MAMServer;

    beforeEach(() => {
      vi.clearAllMocks();
      server = new MAMServer(mockConnection, { telemetry: true });
    });

    it('records a span and increments the diagnostics counter on validate', () => {
      openDoc();
      const result = runDiagnostics();
      expect(Array.isArray(result)).toBe(true);

      const telemetry = server.getTelemetry();
      expect(telemetry).toBeDefined();

      expect(telemetry!.spans).toHaveLength(1);
      expect(telemetry!.spans[0]!.name).toBe('mam.lsp.validate');

      expect(telemetry!.counters['diagnostics']).toBe(1);

      expect(telemetry!.evaluations).toHaveLength(1);
      expect(telemetry!.evaluations[0]!.name).toBe('lsp.diagnostics');
      expect(telemetry!.evaluations[0]!.score).toBe(1);
    });

    it('records a zero score when diagnostics contain errors', () => {
      openDoc('file:///bad.mam.md', '## Inputs\n\nBody.');
      const result = runDiagnostics('file:///bad.mam.md');
      expect(Array.isArray(result)).toBe(true);

      const telemetry = server.getTelemetry();
      expect(telemetry).toBeDefined();
      expect(telemetry!.counters['diagnostics']).toBe(1);
      expect(telemetry!.evaluations[0]!.name).toBe('lsp.diagnostics');
      expect(telemetry!.evaluations[0]!.score).toBe(0);
    });
  });

  describe('when telemetry is disabled (default)', () => {
    let server: MAMServer;

    beforeEach(() => {
      vi.clearAllMocks();
      server = new MAMServer(mockConnection);
    });

    it('returns undefined from getTelemetry() and behavior is unchanged', () => {
      openDoc();
      const result = runDiagnostics();
      expect(Array.isArray(result)).toBe(true);

      expect(server.getTelemetry()).toBeUndefined();
    });
  });
});