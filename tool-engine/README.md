# MAM Tool Engine

Standalone MAM Tool Engine: **Discovery**, **Permissions**, **Invocation** and
**Validation** layers. A dependency-free, deterministic tool stack that covers
the full lifecycle of a tool call — finding the right tool (discovery),
deciding whether it may run (permissions), actually running it (invocation)
and making sure the arguments are sound before it does (validation).

## Overview

The Tool Engine is the execution surface of the MAM platform. Each layer
solves one problem and exposes a small, ergonomic integration surface:

- **Discovery** registers tools by name, description, tags and capabilities,
  indexes them, and answers "which tool does the user mean?" with ranked
  free-text search, autocomplete, faceted `byTag`/`byCapability` lookups and
  schema emission.
- **Permissions** is a rule-based policy engine: declarative allow/deny rules
  over tool × capability × roles, resolved by specificity, priority and a
  fail-closed default. `check`/`can`/`authorize` turn a
  `PermissionRequest` into a `PermissionDecision`.
- **Invocation** executes tool handlers with per-attempt timeouts, retries
  with exponential backoff, an internal (or external) result cache, and
  mock-mode stand-ins — recording history and statistics for everything that
  passes through.
- **Validation** enforces the tool contract: required parameters present,
  values correctly typed (optionally coerced), enum constraints honoured and
  unknown keys rejected in strict mode — plus structural checks on tool
  definitions themselves.

Every layer is organised in the same six-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms), `lifecycle` (housekeeping) and `integration` (the facade you
actually call).

## Architecture

```
Tool Engine (@mam/tool-engine)
├── Discovery      src/discovery/      ToolDiscovery, DiscoveryAdapter, ToolSearcher
├── Permissions    src/permissions/    ToolAuthorizer, PermissionChecker, PermissionStore
├── Invocation     src/invocation/     ToolInvoker, ToolExecutor, InvocationStore
└── Validation     src/validation/     ToolValidator, ParamValidator, ValidationStore
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  createToolDiscovery, ToolDiscovery,
  createToolAuthorizer, ToolAuthorizer,
  createToolInvoker, ToolInvoker,
  createToolValidator, ToolValidator,
} from '@mam/tool-engine';
```

## Quick start

```ts
import {
  createToolDiscovery,
  createToolAuthorizer,
  createToolInvoker,
  createToolValidator,
} from '@mam/tool-engine';

// 1. Discovery: register and search tools.
const discovery = createToolDiscovery();
discovery.register({
  name: 'math.add',
  description: 'Add two numbers',
  handler: async ({ a, b }) => a + b,
  parameters: [
    { name: 'a', type: 'number', required: true },
    { name: 'b', type: 'number', required: true },
  ],
  capabilities: ['arithmetic.add'],
});
const hits = discovery.search('add');        // ranked results
const schema = discovery.getSchema('math.add');

// 2. Permissions: decide who may run it (fail closed by default).
const authz = createToolAuthorizer();
authz.grant('math.add', ['user']);
authz.check({ tool: 'math.add', roles: ['user'] });       // allowed
authz.authorize({ tool: 'math.add', roles: ['user'] });   // throws when denied

// 3. Validation: enforce the parameter contract.
const validator = createToolValidator();
validator.registerSchema({
  name: 'math.add',
  description: 'Add two numbers',
  handler: async () => 0,
  parameters: [
    { name: 'a', type: 'number', required: true },
    { name: 'b', type: 'number', required: true },
  ],
});
const ok = validator.validateParams('math.add', { a: '1', b: 2 });
ok.valid;        // true — "1" coerced to 1
ok.coerced;      // { a: 1 }

// 4. Invocation: run it with timeout, retry and recording.
const invoker = createToolInvoker();
const result = await invoker.invoke(
  { tool: 'math.add', params: { a: 1, b: 2 } },
  async ({ a, b }) => a + b,
);
result.ok;               // true
result.value;            // 3
invoker.getStats();      // aggregate statistics
```

## Commands

```sh
pnpm install                          # install all workspace packages
pnpm --filter @mam/tool-engine build      # compile src/ -> dist/ (tsc)
pnpm --filter @mam/tool-engine test       # run the vitest suite
pnpm --filter @mam/tool-engine typecheck  # tsc --noEmit
pnpm --filter @mam/tool-engine clean      # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Discovery | `types.ts` | `ToolDefinition`, `ToolSchema`, `DiscoveryConfig`, guards + factories |
| | `store.ts` | `ToolRegistry`: name-keyed registry, schema views, JSON round-trip |
| | `index.ts` | `ToolIndex`: by name/prefix/tag/capability/description token |
| | `retrieval.ts` | `ToolSearcher`: ranked `search`/`suggest`/`byTag`/`byCapability` |
| | `lifecycle.ts` | `DiscoveryLifecycle`: index sync, prune, periodic re-index |
| | `integration.ts` | `ToolDiscovery`, `DiscoveryAdapter`, `createToolDiscovery` |
| Permissions | `types.ts` | `PermissionRule`, `PermissionRequest`, `PermissionDecision`, config |
| | `store.ts` | `PermissionStore`: rule registry, `grant`, events, JSON round-trip |
| | `index.ts` | `PermissionIndex`: by tool/capability/role |
| | `retrieval.ts` | `PermissionChecker`: `check`/`can`/`authorize`, capability extraction |
| | `lifecycle.ts` | `PermissionLifecycle`: prune, revocation, periodic sync |
| | `integration.ts` | `ToolAuthorizer`, `PermissionsAdapter`, factories |
| Invocation | `types.ts` | `InvocationRequest`, `InvocationResult`, `RetryPolicy`, errors |
| | `store.ts` | `InvocationStore`: history + statistics, JSON round-trip |
| | `index.ts` | `InvocationIndex`: by tool/ok/error/cache/mock |
| | `retrieval.ts` | `ToolExecutor`: timeout, retry, recording |
| | `lifecycle.ts` | `InvocationLifecycle`: history GC, events |
| | `integration.ts` | `ToolInvoker`, `InvocationAdapter`, `createToolInvoker` |
| Validation | `types.ts` | `ValidationSchema`, `ValidationResult`, `ValidationConfig`, guards |
| | `store.ts` | `ValidationStore`: schema registry, JSON round-trip |
| | `index.ts` | `ValidationIndex`: by type/parameter/name |
| | `retrieval.ts` | `ParamValidator`: required/type/enum/coerce + definition checks |
| | `lifecycle.ts` | `ValidationLifecycle`: counters, prune, periodic GC |
| | `integration.ts` | `ToolValidator`, `ValidationAdapter`, `createToolValidator` |

## Per-layer docs

- [`src/discovery/README.md`](src/discovery/README.md)
- [`src/permissions/README.md`](src/permissions/README.md)
- [`src/invocation/README.md`](src/invocation/README.md)
- [`src/validation/README.md`](src/validation/README.md)