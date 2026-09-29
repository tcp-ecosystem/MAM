import { describe, it, expect } from 'vitest';
import {
  McpServer,
  createMcpServer,
} from '../src/server/lifecycle.js';
import { SessionStore } from '../src/server/store.js';
import {
  MCP_METHOD as ServerMcpMethod,
  JsonRpcErrorCode as ServerJsonRpcErrorCode,
} from '../src/server/types.js';

function initializeParams(protocolVersion = '2024-11-05') {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  };
}

describe('server', () => {
  it('McpServer creates a session and runs the initialize handshake', async () => {
    const server = createMcpServer({
      serverInfo: { name: 'test-server', version: '1.0.0' },
    });
    const sessionId = server.createSession();
    expect(typeof sessionId).toBe('string');

    const result = await server.initialize(sessionId, initializeParams());
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('test-server');

    const session = server.store.get(sessionId);
    expect(session?.initialized).toBe(true);
    expect(server.index.isInitialized(sessionId)).toBe(true);
  });

  it('McpServer dispatches tools/list and tools/call round-trips', async () => {
    const server = createMcpServer();
    server.registerToolHandler('echo', async (args) => args);
    const sessionId = server.createSession();

    const listText = await server.handleRawMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: ServerMcpMethod.ToolsList }),
      sessionId,
    );
    const list = JSON.parse(listText as string);
    expect(list.result.tools).toHaveLength(1);
    expect(list.result.tools[0].name).toBe('echo');

    const callText = await server.handleRawMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: ServerMcpMethod.ToolsCall,
        params: { name: 'echo', arguments: { x: 1 } },
      }),
      sessionId,
    );
    const call = JSON.parse(callText as string);
    expect(call.result.content[0].text).toBe('{"x":1}');
  });

  it('McpServer returns a MethodNotFound error for unknown methods', async () => {
    const server = createMcpServer();
    server.createSession();
    const text = await server.handleRawMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'bogus/method' }),
    );
    const parsed = JSON.parse(text as string);
    expect(parsed.error.code).toBe(ServerJsonRpcErrorCode.MethodNotFound);
  });

  it('McpServer.sendNotification encodes a notification frame', () => {
    const server = createMcpServer();
    const sessionId = server.createSession();
    const text = server.sendNotification(sessionId, 'notifications/tools/list_changed');
    const parsed = JSON.parse(text);
    expect(parsed.method).toBe('notifications/tools/list_changed');
    expect(parsed).not.toHaveProperty('id');
  });

  it('SessionStore.prune removes idle sessions and keeps active ones', () => {
    const store = new SessionStore();
    store.create({}, {}, { id: 'a' });
    store.create({}, {}, { id: 'b' });
    store.touch('a', Date.now());
    store.touch('b', Date.now() - 60_000);

    const pruned = store.prune({ idleTimeoutMs: 1_000 });
    expect(pruned).toBe(1);
    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
    expect(store.totalPruned).toBe(1);
  });

  it('McpServer.stats reports dispatch counters', async () => {
    const server = createMcpServer();
    server.registerToolHandler('echo', async (args) => args);
    server.createSession();
    await server.handleRawMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: ServerMcpMethod.ToolsList }),
    );

    const stats = server.stats();
    expect(stats.activeSessions).toBe(1);
    expect(stats.totalRequests).toBe(1);
    expect(stats.requestsByMethod['tools/list']).toBe(1);
  });
});