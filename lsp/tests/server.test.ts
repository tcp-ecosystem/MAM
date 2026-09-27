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

  it('should handle document open events', () => {
    const handler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    handler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '---\nid: test\n---\n## Purpose\n\nTest module.',
      },
    });

    // Should not throw
    expect(true).toBe(true);
  });

  it('should handle document change events', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const changeHandler = mockConnection.onDidChangeTextDocument.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '---\nid: test\n---\n## Purpose\n\nOriginal.',
      },
    });

    changeHandler({
      textDocument: { uri: 'file:///test.mam.md', version: 2 },
      contentChanges: [{ text: '---\nid: test\n---\n## Purpose\n\nUpdated.' }],
    });

    // Should not throw
    expect(true).toBe(true);
  });

  it('should handle document close events', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const closeHandler = mockConnection.onDidCloseTextDocument.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: 'content',
      },
    });

    closeHandler({
      textDocument: { uri: 'file:///test.mam.md' },
    });

    // Should not throw
    expect(true).toBe(true);
  });

  it('should handle completion requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const completionHandler = mockConnection.onCompletion.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## \n\nPurpose content',
      },
    });

    const result = completionHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      position: { line: 0, character: 3 },
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle hover requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const hoverHandler = mockConnection.onHover.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose\n\nModule purpose.',
      },
    });

    const result = hoverHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      position: { line: 0, character: 3 },
    });

    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('should handle definition requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const definitionHandler = mockConnection.onDefinition.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose\n\nSee Inputs section.',
      },
    });

    const result = definitionHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      position: { line: 2, character: 5 },
    });

    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('should handle references requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const referencesHandler = mockConnection.onReferences.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose\n\nPurpose is important.',
      },
    });

    const result = referencesHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      position: { line: 0, character: 3 },
      context: { includeDeclaration: true },
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle formatting requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const formattingHandler = mockConnection.onDocumentFormatting.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose   \n\n   Module purpose.   \n\n',
      },
    });

    const result = formattingHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      options: { tabSize: 2, insertSpaces: true },
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle code action requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const codeActionHandler = mockConnection.onCodeAction.mock.calls[0]?.[0];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose\n\nModule purpose.',
      },
    });

    const result = codeActionHandler({
      textDocument: { uri: 'file:///test.mam.md' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: { diagnostics: [] },
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle diagnostic requests', () => {
    const openHandler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    const diagnosticHandler = mockConnection.onRequest.mock.calls.find(
      (call: any[]) => call[0] === 'textDocument/diagnostic'
    )?.[1];

    openHandler({
      textDocument: {
        uri: 'file:///test.mam.md',
        languageId: 'mam',
        version: 1,
        text: '## Purpose\n\nModule purpose.',
      },
    });

    if (diagnosticHandler) {
      const result = diagnosticHandler({
        textDocument: { uri: 'file:///test.mam.md' },
      });

      expect(Array.isArray(result)).toBe(true);
    }
  });
});

describe('MAMServer document accessors', () => {
  let server: MAMServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new MAMServer(mockConnection);
  });

  function openTestDoc(uri = 'file:///test.mam.md', text = '## Purpose\n\nBody.'): void {
    const handler = mockConnection.onDidOpenTextDocument.mock.calls[0]?.[0];
    handler({
      textDocument: { uri, languageId: 'mam', version: 1, text },
    });
  }

  it('getDocument() should return opened documents', () => {
    openTestDoc();
    expect(server.getDocument('file:///test.mam.md')?.getText()).toContain('Purpose');
    expect(server.getDocument('file:///missing.mam.md')).toBeUndefined();
  });

  it('getCachedAST() should return parsed modules', () => {
    openTestDoc();
    expect(server.getCachedAST('file:///test.mam.md')).toBeDefined();
    expect(server.getCachedAST('file:///missing.mam.md')).toBeUndefined();
  });

  it('getOpenUris() should list open documents', () => {
    openTestDoc('file:///a.mam.md');
    openTestDoc('file:///b.mam.md');
    expect(server.getOpenUris()).toEqual(
      expect.arrayContaining(['file:///a.mam.md', 'file:///b.mam.md']),
    );
  });

  it('hasDocument() should report open state', () => {
    openTestDoc();
    expect(server.hasDocument('file:///test.mam.md')).toBe(true);
    expect(server.hasDocument('file:///missing.mam.md')).toBe(false);
  });

  it('getDocumentCount() should count open documents', () => {
    expect(server.getDocumentCount()).toBe(0);
    openTestDoc('file:///a.mam.md');
    openTestDoc('file:///b.mam.md');
    expect(server.getDocumentCount()).toBe(2);
  });

  it('refreshDocument() should update text and AST', () => {
    openTestDoc('file:///r.mam.md', '## Purpose\n\nOld.');
    server.refreshDocument('file:///r.mam.md', '## Purpose\n\nNew.');
    expect(server.getDocument('file:///r.mam.md')?.getText()).toContain('New.');
    expect(server.getCachedAST('file:///r.mam.md')).toBeDefined();
  });

  it('clearCache() should drop all documents', () => {
    openTestDoc();
    expect(server.getDocumentCount()).toBe(1);
    server.clearCache();
    expect(server.getDocumentCount()).toBe(0);
    expect(server.getOpenUris()).toEqual([]);
    expect(server.hasDocument('file:///test.mam.md')).toBe(false);
  });
});
