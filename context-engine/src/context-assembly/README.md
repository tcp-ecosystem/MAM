# Context Assembly

The Context Assembly layer is the final gateway between an agent's raw inputs
and the model prompt. It takes zero or more `ContextPart`s — system
instructions, user turns, tool results, memory records, knowledge entries and
few-shot examples — and produces one `AssembledContext`:

1. **Collect** — gather the raw parts supplied by the caller.
2. **Dedupe** — drop parts whose content hash collides, so the same memory or
   tool result never appears twice in one prompt.
3. **Order** — sort parts by role priority (system first) overridden by any
   explicit per-part `order` value.
4. **Budget** — when a token cap is configured, trim the least-retained parts
   (memory, then tool results) while always keeping protected roles such as
   `system`.
5. **Render** — concatenate the survivors into a prompt string with role
   markers (`<|system|>`, `<|user|>`, ...).

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ContextPart`, `AssembledContext`, role constants, part factories (`systemPart`, `userPart`, ...), `estimateTokens`, `partHash` |
| `store.ts` | `ContextAssemblyStore`: insertion-ordered part registry, CRUD, role/source/tag filters, JSON round-trip |
| `index.ts` | `AssemblyIndex`: denormalised lookups by role/source/tag with composite `query` |
| `retrieval.ts` | `ContextAssembler`: collect → dedupe → order → budget → render |
| `lifecycle.ts` | `AssemblyLifecycle`: refresh tracking, TTL pruning, periodic sweeps, typed events |
| `integration.ts` | `ContextAssemblerAdapter`, `ContextPipeline`, `createContextAssembler`, `estimatePromptTokens` |

## Key classes

- **`ContextAssembler`** — the pure ordering/budgeting engine. Stateless apart
  from configuration and rolling counters.
- **`ContextAssemblerAdapter`** — interface-conforming wrapper that also caches
  the last assembled context and can assemble straight from a store.
- **`ContextPipeline`** — fully-wired assembly pipeline owning a store, index,
  assembler and lifecycle; `run(parts, options)` persists, assembles, observes
  and emits events in one call.
- **`ContextAssemblyStore`** / **`AssemblyIndex`** / **`AssemblyLifecycle`** —
  the registry, the lookup index and the maintenance/events layer.

## Example

```ts
import { createContextAssembler } from '@mam/context-engine';

const assembler = createContextAssembler({ maxTokens: 1024 });
const result = assembler.assemble({
  parts: [
    { id: 's', role: 'system', content: 'Be concise.' },
    { id: 'm', role: 'memory', content: 'User prefers bullet points.' },
    { id: 'u', role: 'user', content: 'List the changes.' },
  ],
});
console.log(result.prompt);
// <|system|>
// Be concise.
// <|memory|>
// User prefers bullet points.
// <|user|>
// List the changes.

console.log(result.stats); // parts, candidates, deduped, trimmed, roleCounts
```