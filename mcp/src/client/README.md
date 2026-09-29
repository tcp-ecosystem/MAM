# Client

The Client layer drives a remote MCP server. `McpClient` composes the
`ConnectionStore` (connection registry), `ConnectionIndex` (query lookups) and
`RequestCorrelator` (id-keyed pending requests) so an application can connect,
initialize, call tools and read resources over any object that satisfies the
`McpTransport` contract.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ClientConfig`, `McpConnection`, `CallResult`, `McpTransport`, `McpClientError`, guards + factories |
| `store.ts` | `ConnectionStore`: create/get/markConnected/markClosed, closed history, JSON round-trip |
| `index.ts` | `ConnectionIndex`: by id / status / protocol version |
| `retrieval.ts` | `RequestCorrelator`: `send`/`resolve`/`reject`/`timeoutPending`/`clear` |
| `lifecycle.ts` | `McpClient`, `createMcpClient`, `MemoryTransport`, `createMemoryTransportPair`, stats, close |

## Example

```ts
import { createMcpClient, createMemoryTransportPair } from '@mam/mcp';

// An in-memory transport pair stands in for a real socket / stdio.
const { client, server } = createMemoryTransportPair();
server.onMessage(async (text) => {
  const frame = JSON.parse(text);
  if (frame.method === 'ping') {
    await server.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} }));
  }
});

const mcpClient = createMcpClient();
await mcpClient.connect(client);       // transport + initialize handshake
const result = await mcpClient.callTool('math.add', { a: 1, b: 2 });
result.ok;                             // true (never throws for tool failures)
await mcpClient.close();               // reject pending requests, stop transport
```

`callTool` never throws for application-level failures: JSON-RPC errors and
timeouts are folded into a `CallResult` with `ok: false`. `RequestCorrelator`
backs every request with a promise that settles exactly once via
`resolve`/`reject`, with `timeoutPending` as a sweep fallback for stale
entries.