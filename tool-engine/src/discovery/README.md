# Discovery

The Discovery layer registers MAM tools by name, description, tags and
capabilities, indexes them, and answers "which tool does the user mean?" with
ranked free-text search, autocomplete and faceted lookups.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ToolDefinition`, `ToolParameter`, `ToolSchema`, `ToolCapability`, `DiscoveryConfig`, `SearchOptions`, guards + factories |
| `store.ts` | `ToolRegistry`: name-keyed registry, `register`/`unregister`/`list`/`getSchema`, `toJSON`/`fromJSON` |
| `index.ts` | `ToolIndex`: inverted index by name, prefix, tag, capability and description token |
| `retrieval.ts` | `ToolSearcher`: ranked `search`, `suggest`, `byTag`, `byCapability`, `byNamePrefix` |
| `lifecycle.ts` | `DiscoveryLifecycle`: keeps registry and index in sync, `prune`, periodic re-index, events |
| `integration.ts` | `ToolDiscovery` (facade), `DiscoveryAdapter` (stable `ToolCatalog` contract), `createToolDiscovery` |

## Example

```ts
import { createToolDiscovery, createToolDefinition } from '@mam/tool-engine';

const discovery = createToolDiscovery();
discovery.register(createToolDefinition({
  name: 'http.get',
  description: 'Perform an HTTP GET request',
  handler: async () => ({}),
  tags: ['network'],
  capabilities: ['http.request'],
}));
discovery.register(createToolDefinition({
  name: 'fs.read',
  description: 'Read a file from disk',
  handler: async () => ({}),
  tags: ['filesystem'],
  capabilities: ['filesystem.read'],
}));

const hits = discovery.search('http');          // ranked SearchResult[]
const top = discovery.byCapability('http.request'); // by capability
const net = discovery.byTag('network');         // by tag
const schema = discovery.getSchema('http.get'); // ToolSchema without handler

discovery.start();   // periodic re-index every 60s
discovery.stop();
discovery.prune(['fs.read']);   // remove a batch of tools
```

The `catalog` adapter exposes the same read surface through the stable
`ToolCatalog` interface so read-only consumers stay decoupled from the
concrete discovery objects.

Search scoring is a transparent blend of name match (strongest),
description-token overlap and tag/capability overlap; every result carries the
component scores so ranking decisions can be explained.