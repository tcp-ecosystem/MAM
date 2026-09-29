# Server

The Server layer accepts MCP clients. `McpServer` composes the `SessionStore`
(session registry), `SessionIndex` (query lookups) and `RequestDispatcher`
(pure routing core) into a single facade an application can drive directly.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ServerConfig`, `McpSession`, `ToolListing`, `CallToolResult`, `InitializeResult`, `McpRequestError`, guards + factories |
| `store.ts` | `SessionStore`: create/get/touch/prune sessions, closed-session history, JSON round-trip |
| `index.ts` | `SessionIndex`: by id / protocol version / initialization state |
| `retrieval.ts` | `RequestDispatcher`: routes requests/notifications/batches to handlers, negotiates versions |
| `lifecycle.ts` | `McpServer`, `createMcpServer`, `sendNotification`, `stats` |

## Example

```ts
import { createMcpServer } from '@mam/mcp';

const server = createMcpServer({ serverInfo: { name: 'demo', version: '1.0.0' } });

// Register a tool call handler.
server.registerToolHandler('echo', async (args) => args);

// Create a session and complete the initialize handshake.
const sessionId = server.createSession();
await server.initialize(sessionId, {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'demo-client', version: '1.0.0' },
});

// Drive the wire protocol directly.
const reply = await server.handleRawMessage(
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  sessionId,
);

// Fire-and-forget notifications.
server.sendNotification(sessionId, 'notifications/tools/list_changed');

server.stats();                  // requests by method, active sessions, ...
server.prune({ idleTimeoutMs: 60_000 });
```

Unknown methods produce a `MethodNotFound` (`-32601`) error response; handlers
may throw an `McpRequestError` to control the exact error surfaced to the
client.