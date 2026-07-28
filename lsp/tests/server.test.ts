/**
 * MAMServer Tests
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

describe('MAMServer', () => {
  let server: MAMServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new MAMServer(mockConnection);
  });

  it('should instantiate with a connection', () => {
    expect(server).toBeInstanceOf(MAMServer);
  });

  it('should register event handlers on construction', () => {
    expect(mockConnection.onCompletion).toHaveBeenCalled();
    expect(mockConnection.onHover).toHaveBeenCalled();
    expect(mockConnection.onDefinition).toHaveBeenCalled();
    expect(mockConnection.onReferences).toHaveBeenCalled();
    expect(mockConnection.onDocumentFormatting).toHaveBeenCalled();
    expect(mockConnection.onCodeAction).toHaveBeenCalled();
    expect(mockConnection.onDidOpenTextDocument).toHaveBeenCalled();
    expect(mockConnection.onDidChangeTextDocument).toHaveBeenCalled();
    expect(mockConnection.onDidCloseTextDocument).toHaveBeenCalled();
    expect(mockConnection.onRequest).toHaveBeenCalled();
  });

  it('initialize() should return server capabilities', () => {
    const result = server.initialize({} as any);

    expect(result).toHaveProperty('capabilities');
    expect(result.capabilities.textDocumentSync).toBe(1);
    expect(result.capabilities.completionProvider).toEqual({
      triggerCharacters: ['#', '-', '`', '[', ':', '>', ' '],
      resolveProvider: false,
    });
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.referencesProvider).toBe(true);
    expect(result.capabilities.documentFormattingProvider).toBe(true);
    expect(result.capabilities.codeActionProvider).toBe(true);
  });

  it('onInitialized() should log to console', () => {
    server.onInitialized();
    expect(mockConnection.console.log).toHaveBeenCalledWith(
      expect.stringContaining('MAM Language Server v2 initialized')
    );
  });

  it('shutdown() should complete without error', () => {
    expect(() => server.shutdown()).not.toThrow();
  });
});
