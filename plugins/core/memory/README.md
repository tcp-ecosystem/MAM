# @mam/plugin-memory

> Persistent state management for MAM modules

Keeps a `Memory` section in a module synchronised with a namespaced key/value
store backed by per-module JSON files. State written during a parse is available
to the next execution, and can be written back into the document.

## Installation

```bash
pnpm add @mam/plugin-memory
```

## Quick start

The plugin is a ready-made `MAMPlugin`:

```typescript
import memoryPlugin, { getMemoryStore } from '@mam/plugin-memory';

memoryPlugin.manifest.name;   // '@mam/plugin-memory'
getMemoryStore().set('my-module', 'status', 'active');
```

Or build a configured one:

```typescript
import { createMemoryPlugin, createMemoryStore } from '@mam/plugin-memory';

const store = createMemoryStore({ memoryDir: '.mam/memory', maxKeys: 10_000 });
const plugin = createMemoryPlugin({ store, hooks: ['afterParse', 'beforeExecution'] });
```

## The `Memory` section

```markdown
## Memory

- status: active
- version: 2.0.0

```json
{ "db": { "host": "localhost", "port": 5432 } }
```
```

Paragraph bullets are read first, then JSON code blocks. A value defined twice
is reported in `conflicts` rather than overwritten quietly, and JSON keeps its
types — `5432` comes back as a number, not `"5432"`.

## Store

```typescript
import { MemoryStore } from '@mam/plugin-memory';

const store = new MemoryStore({ memoryDir: '.mam/memory' });

store.set('mod', 'key', value);
store.get('mod', 'key');
store.getOrDefault('mod', 'key', 'fallback');
store.setIfAbsent('mod', 'seed', value);       // no clobber
store.update('mod', 'counter', (n) => n + 1);   // functional
store.setMany('mod', { a: 1, b: 2 });
store.getMany('mod', ['a', 'b']);
store.keys('mod');
store.findKeysByPrefix('mod', 'db.');
store.listModules();
```

Modules are held in nested maps rather than one flat map keyed
`${moduleId}:${key}`, so module `a` and module `a:b` cannot leak keys into each
other.

### Time to live

```typescript
store.set('mod', 'session', token, { ttlMs: 60_000 });
store.getTimeToLive('mod', 'session');
store.purgeExpired();
```

Expired keys read as absent and are excluded from `keys()`, `entries()` and
`size()`, so TTL needs no background job.

### Change notifications

```typescript
const off = store.onChange(({ type, moduleId, keys }) => { /* ... */ });
off();
```

A listener that throws cannot break the write that triggered it.

### Persistence

```typescript
await store.saveFile('mod', { a: 1 });
await store.loadFile('mod');      // {} when absent or unreadable
await store.persistToFile('mod');
await store.persistAll();
await store.syncFromFile('mod');  // file wins over memory
```

Writes are atomic: the payload goes to a temp file that is then renamed over the
target, so a crash leaves either the old file or the new one, never a truncated
one. Files carry a version envelope and a legacy bare object is read and
migrated on load.

Errors are reported through `onError` rather than swallowed, because a full disk
used to look like a clean run:

```typescript
const store = new MemoryStore({ onError: (error, { operation }) => log.error(operation, error) });
```

## Parser

```typescript
import { parseMemoryContent, diffMemory, formatMemory, flattenMemory } from '@mam/plugin-memory';

const { flat, entries, conflicts, errors } = parseMemoryContent(content, {
  prefix: 'runtime.',   // namespace every key
  coerce: true,         // '42' -> 42
  flatten: true,        // nested objects become dotted paths
});
```

`coerce` is off by default: a value like `007` or a version `1.10` would change
meaning, and bullets are inherently textual.

`diffMemory(before, after)` returns `added` / `removed` / `changed` /
`unchanged`, which is what makes the write path cheap — the hook only persists
when something actually changed.

`formatMemory(data, { includeJsonBlock: true })` renders back to a section. It
puts non-string values in a JSON block, because `**port**: 5432` would come back
as the string `"5432"`. There is a round-trip test for exactly this.

## Rules

```typescript
import { MEMORY_RULES, runMemoryRules, createMemoryRule } from '@mam/plugin-memory';

runMemoryRules(module, MEMORY_RULES);
```

| Rule | Catches |
|------|---------|
| `memory-duplicate-keys` | a key defined twice |
| `memory-empty-values` | empty, `null` or `undefined` values |
| `memory-key-format` | keys that are not dot-separated identifiers |
| `memory-reserved-prefix` | keys under the reserved `__` prefix |
| `memory-key-length` | keys past the configured limit |
| `memory-value-length` | values past the configured limit |
| `memory-nesting-depth` | paths nested deeper than the limit |
| `memory-entry-count` | oversized sections, and parser truncation |
| `memory-required-keys` | keys a module must define |

Limits are configurable:

```typescript
configureMemoryRules({ maxEntries: 500, requiredKeys: ['status'] });
resetMemoryRuleConfig();
```

## Hooks

```typescript
import { createMemoryHooks, MemoryHookTracker } from '@mam/plugin-memory';

const hooks = createMemoryHooks(store, {
  hooks: ['afterParse', 'beforeExecution', 'afterExecution', 'onError'],
  onError: (error, { hook, moduleId }) => report(hook, moduleId, error),
});
```

`afterParse` merges the section into the store and persists it, writing only the
keys that changed. `beforeExecution` syncs from disk, so a stale in-memory value
from an earlier process is discarded in favour of the durable copy.
`createMemoryInjector` writes state back into the section.

Hook failures are caught and reported rather than thrown, so one module's
persistence problem cannot abort the parse of a whole document.

## Validation

```typescript
import { validateMemoryContent, readMemory, findMemorySection } from '@mam/plugin-memory';
```

The section validator checks JSON syntax, key charset, reserved prefixes and
section size before anything tries to persist it.

## API surface

- `MemoryStore`, `createMemoryStore`, `MemoryLimitError`
- `parseMemoryContent`, `parseMemoryValue`, `mergeMemory`, `deepMerge`,
  `diffMemory`, `flattenMemory`, `unflattenMemory`, `getPath`, `setPath`,
  `deletePath`, `pickMemory`, `groupByPrefix`, `filterMemoryByPrefix`,
  `namespaceMemory`, `formatMemory`
- `MEMORY_RULES`, `memoryRule`, `createMemoryRule`, `createMemoryRules`,
  `runMemoryRules`, `formatRuleSummary`
- `createMemoryPlugin`, `createMemoryApi`, `createMemoryStore`,
  `getMemoryStore`, `describeMemoryPlugin`

## License

MIT
