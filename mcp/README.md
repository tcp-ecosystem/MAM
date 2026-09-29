# MAM MCP Engine

Standalone MAM MCP engine: **Protocol**, **Server**, **Client** and **Tools**
layers. A dependency-free implementation of the Model Context Protocol
(JSON-RPC 2.0 based) covering the full lifecycle of a client↔server session —
framing and message correlation (protocol), accepting connections and routing
requests (server), driving remote tools/resources/prompts (client), and
managing the discoverable primitives a server exposes (tools).

## Overview

The MCP engine is the interoperability surface of the MAM platform. Each layer
solves one problem and exposes a small, ergonomic integration surface:

- **Protocol** is the wire contract: `ProtocolCodec` encodes and decodes
  JSON-RPC frames into a discriminated `ProtocolMessage` union, `MessageStore`
  logs every frame with sequence/timestamp metadata, `MethodIndex` answers
  "which frames reference this method/id/type?" and `ProtocolLifecycle` ties
  them together with pruning and typed events.
- **Server** accepts clients: `McpServer` composes the `SessionStore`,
  `SessionIndex` and `RequestDispatcher` into one facade that creates sessions,
  negotiates protocol versions during `initialize`, routes `tools/list` /
  `tools/call` / resources / prompts through registered handlers, and emits
  `sendNotification` frames.
- **Client** drives a remote server: `McpClient` composes the
  `ConnectionStore`, `ConnectionIndex` and `RequestCorrelator` so an application
  can `connect`, `initialize`, `listTools`/`callTool`, read resources, render
  prompts and `ping` over any object satisfying the `McpTransport` contract
  (stdio, HTTP, SSE, WebSocket or an in-memory pair).
- **Tools** manages the three discoverable primitives: `SchemaConverter` turns
  declarative parameter lists into JSON Schema `inputSchema` documents and
  validates call arguments against them, `ToolsRegistry` stores tools/resources/
  prompts by canonical key, `ToolsIndex` gives fast kind/name/URI lookups and
  `ToolsLifecycle` keeps the registry/index/converter in lock-step with pruning.

Every layer is organised in the same five-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms) and `lifecycle` (the operational facade).

## Architecture

```
MCP Engine (@mam/mcp)
├── Protocol   src/protocol/   ProtocolCodec, MessageStore, MethodIndex, ProtocolLifecycle
├── Server     src/server/     McpServer, SessionStore, SessionIndex, RequestDispatcher
├── Client     src/client/     McpClient, ConnectionStore, ConnectionIndex, RequestCorrelator
└── Tools      src/tools/      SchemaConverter, ToolsRegistry, ToolsIndex, ToolsLifecycle
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  createMcpServer, McpServer,
  createMcpClient, McpClient,
  createMemoryTransportPair,
  SchemaConverter,
} from '@mam/mcp';
```

## Quick start

```ts
import {
  createMcpServer,
  createMcpClient,
  createMemoryTransportPair,
} from '@mam/mcp';

// 1. Server: register a tool and start listening.
const server = createMcpServer({ serverInfo: { name: 'demo', version: '1.0.0' } });
server.registerToolHandler('math.add', async ({ a, b }) => a + b);
const sessionId = server.createSession();
await server.initialize(sessionId, {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'demo-client', version: '1.0.0' },
});

// 2. Client: connect over an in-process memory transport.
const { client, server: peer } = createMemoryTransportPair();
peer.onMessage(async (text) => {
  const frame = JSON.parse(text);
  if (frame.method === 'tools/call') {
    await peer.send(JSON.stringify({
      jsonrpc: '2.0', id: frame.id,
      result: { content: [{ type: 'text', text: 'hello' }] },
    }));
  }
});

const client = createMcpClient();
await client.connect(client);
const tools = await client.listTools();           // { tools: [...] }
const result = await client.callTool('math.add', { a: 1, b: 2 });
result.ok;                                        // true
```

## Commands

```sh
pnpm install                          # install all workspace packages
pnpm --filter @mam/mcp build          # compile src/ -> dist/ (tsc)
pnpm --filter @mam/mcp test           # run the vitest suite
pnpm --filter @mam/mcp typecheck      # tsc --noEmit
pnpm --filter @mam/mcp clean          # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Protocol | `types.ts` | `ProtocolMessage`, `JsonRpc*` envelopes, `ErrorCodes`, guards + factories |
| | `store.ts` | `MessageStore`: append-only frame log, stats, JSON round-trip |
| | `index.ts` | `MethodIndex`: by sequence/method/id/type |
| | `retrieval.ts` | `ProtocolCodec`: encode/decode/serialize, `MCP_METHODS`, `newRequestId` |
| | `lifecycle.ts` | `ProtocolLifecycle`: prune, GC timer, typed events |
| Server | `types.ts` | `ServerConfig`, `McpSession`, listings, results, `McpRequestError` |
| | `store.ts` | `SessionStore`: session registry, `touch`, `prune`, JSON round-trip |
| | `index.ts` | `SessionIndex`: by id/version/initialization state |
| | `retrieval.ts` | `RequestDispatcher`: routes requests/notifications/batches to handlers |
| | `lifecycle.ts` | `McpServer`, `createMcpServer`, `sendNotification`, `stats` |
| Client | `types.ts` | `ClientConfig`, `McpConnection`, `CallResult`, `McpTransport`, `McpClientError` |
| | `store.ts` | `ConnectionStore`: connection registry, `markConnected`, JSON round-trip |
| | `index.ts` | `ConnectionIndex`: by id/status/protocol version |
| | `retrieval.ts` | `RequestCorrelator`: id-keyed pending requests, resolve/reject/timeout |
| | `lifecycle.ts` | `McpClient`, `createMcpClient`, `MemoryTransport`, stats, close |
| Tools | `types.ts` | `McpTool`/`McpResource`/`McpPrompt`, `JsonSchema`, guards + factories |
| | `store.ts` | `ToolsRegistry`: name/uri-keyed registry, stats, JSON round-trip |
| | `index.ts` | `ToolsIndex`: by kind/name/uri/key |
| | `retrieval.ts` | `SchemaConverter`: `toolFromDefinition`, `validateArgs`, schema building |
| | `lifecycle.ts` | `ToolsLifecycle`: register/unregister/prune, GC timer, events |

## Per-layer docs

- [`src/protocol/README.md`](src/protocol/README.md)
- [`src/server/README.md`](src/server/README.md)
- [`src/client/README.md`](src/client/README.md)
- [`src/tools/README.md`](src/tools/README.md)