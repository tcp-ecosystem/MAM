# Tools

The Tools layer manages the three *discoverable* primitives a MCP server
exposes: **tools** (callable functions), **resources** (addressable data blobs)
and **prompts** (parameterised templates). `SchemaConverter` turns declarative
parameter lists into JSON Schema documents and validates call arguments;
`ToolsRegistry` stores the primitives; `ToolsIndex` provides fast lookups;
`ToolsLifecycle` keeps them in lock-step with pruning and events.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `McpTool`, `McpResource`, `McpPrompt`, `JsonSchema`, guards + factories |
| `store.ts` | `ToolsRegistry`: register/unregister/list/get by kind, `DuplicateKeyError`, JSON round-trip |
| `index.ts` | `ToolsIndex`: by kind / name / uri / canonical key |
| `retrieval.ts` | `SchemaConverter`: `toolFromDefinition`, `resourceFromUri`, `promptFromName`, `validateArgs` |
| `lifecycle.ts` | `ToolsLifecycle`: register/unregister/prune, GC timer, typed events |

## Example

```ts
import { SchemaConverter, ToolsLifecycle } from '@mam/mcp';

const converter = new SchemaConverter();
const lifecycle = new ToolsLifecycle({ maxTools: 100 });

// Declarative parameters -> JSON Schema inputSchema.
const tool = converter.toolFromDefinition('echo', 'Echo text back', [
  { name: 'message', type: 'string', required: true },
  { name: 'times', type: 'number', default: 1 },
]);
lifecycle.registerTool(tool);

// Validate call arguments without throwing.
const result = lifecycle.validateArgs(tool.inputSchema, {});
result.ok;                       // false — "message" is required
result.issues[0].code;           // 'missing'
```

`SchemaConverter.validateArgs` checks required fields, declared `type`s,
`enum`/`const` constraints and (when `additionalProperties` is `false`)
undeclared keys, returning a structured issue list instead of throwing.