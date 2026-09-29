import { describe, it, expect } from 'vitest';
import {
  McpClient,
  createMcpClient,
  createMemoryTransportPair,
} from '../src/client/lifecycle.js';
import { RequestCorrelator } from '../src/client/retrieval.js';
import { ConnectionStore } from '../src/client/store.js';
import { JsonRpcErrorCode as ClientJsonRpcErrorCode } from '../src/client/types.js';

function wireStubServer(
  server: ReturnType<typeof createMemoryTransportPair>['server'],
): void {
  server.onMessage(async (text) => {
    const frame = JSON.parse(text) as { id?: number | string; method?: string };
    if (frame.method === 'initialize') {
      await server.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'stub', version: '1.0.0' },
          },
        }),
      );
    } else if (frame.method === 'tools/list') {
      await server.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          result: { tools: [{ name: 'add', inputSchema: { type: 'object' } }] },
        }),
      );
    } else if (frame.method === 'tools/call') {
      await server.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          result: { content: [{ type: 'text', text: '42' }] },
        }),
      );
    } else if (frame.method === 'ping') {
      await server.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} }));
    }
  });
}

describe('client', () => {
  it('McpClient connects, initializes, lists tools and calls a tool', async () => {
    const { client, server } = createMemoryTransportPair();
    wireStubServer(server);

    const mcpClient = createMcpClient({ config: { requestTimeoutMs: 1000 } });
    const result = await mcpClient.connect(client);
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(mcpClient.connected).toBe(true);
    expect(mcpClient.initialized).toBe(true);

    const tools = await mcpClient.listTools();
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0].name).toBe('add');

    const call = await mcpClient.callTool('add', { a: 1, b: 2 });
    expect(call.ok).toBe(true);
    expect(call.value).toBeDefined();
    expect((call.value as { content: { text: string }[] }).content[0].text).toBe('42');

    await mcpClient.close();
    expect(mcpClient.closed).toBe(true);
  });

  it('RequestCorrelator resolves, rejects and times out pending requests', async () => {
    const correlator = new RequestCorrelator();

    const resolved = correlator.send({ id: 1, method: 'ping' });
    expect(correlator.resolve(1, 'pong')).toBe(true);
    await expect(resolved).resolves.toBe('pong');

    const rejected = correlator.send({ id: 2, method: 'ping' });
    expect(correlator.reject(2, new Error('boom'))).toBe(true);
    await expect(rejected).rejects.toThrow('boom');

    const pending = correlator.send({ id: 3, method: 'ping' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const timedOut = correlator.timeoutPending(0);
    expect(timedOut).toBe(1);
    await expect(pending).rejects.toThrow(/timed out/);

    const stats = correlator.stats();
    expect(stats.totalSent).toBe(3);
    expect(stats.totalResolved).toBe(1);
    expect(stats.totalRejected).toBe(1);
    expect(stats.totalTimedOut).toBe(1);
    expect(correlator.pending().count).toBe(0);
  });

  it('RequestCorrelator.clear cancels every pending request', async () => {
    const correlator = new RequestCorrelator();
    const pending = correlator.send({ id: 1, method: 'ping' });
    const cancelled = correlator.clear();
    expect(cancelled).toBe(1);
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(correlator.stats().totalCancelled).toBe(1);
  });

  it('ConnectionStore.markConnected advances connection status', () => {
    const store = new ConnectionStore();
    const connection = store.create({ id: 'c1' });
    expect(connection.status).toBe('connecting');

    store.markConnected('c1');
    expect(store.get('c1')?.status).toBe('connected');
    expect(store.listConnected()).toHaveLength(1);
    expect(store.stats().connected).toBe(1);
  });

  it('McpClient.stats aggregates connection and request counters, then closes', async () => {
    const { client, server } = createMemoryTransportPair();
    wireStubServer(server);

    const mcpClient = createMcpClient();
    await mcpClient.connect(client);
    await mcpClient.ping();

    const stats = mcpClient.stats();
    expect(stats.totalConnections).toBe(1);
    expect(stats.connectedConnections).toBe(1);
    expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
    expect(stats.requestsByMethod['ping']).toBe(1);
    expect(stats.pendingRequests).toBe(0);

    await mcpClient.close();
    expect(mcpClient.closed).toBe(true);
    expect(client.closed).toBe(true);
  });
});