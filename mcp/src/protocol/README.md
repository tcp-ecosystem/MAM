# Protocol

The Protocol layer is the wire contract of the MCP engine. Every frame that
enters or leaves a client or server is normalized into a discriminated
`ProtocolMessage` (request / response / error / notification) and either
serialized to JSON-RPC 2.0 text (`ProtocolCodec`) or logged and indexed
(`MessageStore` + `MethodIndex`).

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ProtocolMessage`, `JsonRpcRequest/Response/Error/ErrorResponse/Notification`, `ErrorCodes`, `McpProtocolError`, guards + factories |
| `store.ts` | `MessageStore`: append-only frame log with sequence/direction/timestamp, `getByType`, `pendingRequests`, stats, JSON round-trip |
| `index.ts` | `MethodIndex`: inverted lookups by sequence/method/id/type |
| `retrieval.ts` | `ProtocolCodec`: `encodeRequest`/`encodeResponse`/`encodeError`/`encodeNotification`/`serialize`/`decode`, `newRequestId`, `MCP_METHODS` |
| `lifecycle.ts` | `ProtocolLifecycle`: prune, periodic GC, typed events |

## Example

```ts
import { ProtocolCodec, MCP_METHODS } from '@mam/mcp';

const codec = new ProtocolCodec();

// Encode a request and decode it back.
const text = codec.encodeRequest(codec.newRequestId(), MCP_METHODS.ping);
const message = codec.decode(text);
message.type;                    // 'request'

// Responses, errors and notifications round-trip the same way.
const responseText = codec.encodeResponse(1, { ok: true });
const errorText = codec.encodeError(1, -32601, 'Method not found');
const notifText = codec.encodeNotification(MCP_METHODS.toolsListChanged);

// Request ids are strictly monotonic for the life of a codec.
codec.newRequestId();            // 2
codec.newRequestId();            // 3
```

Decoding is strict and lossless: malformed input raises a `McpProtocolError`
carrying a standard JSON-RPC error code (`-32700` parse error, `-32600` invalid
request). Use `tryDecode` when you want a `{ ok, message?, error? }` result
instead of an exception.