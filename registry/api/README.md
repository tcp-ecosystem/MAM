# @mam/registry-api

> The public contract for the MAM module registry

A GraphQL schema with working resolvers, and an OpenAPI document for REST
clients and code generators. This package holds no storage of its own — it maps
the contract onto [`@mam/registry-server`](../server), so the API and the server
cannot drift into describing different registries.

## Why it is its own package

The contract and the implementation change for different reasons and at
different rates. Clients — a Python client, a browser, a Go daemon, anything with
an HTTP client — need a stable description of the surface. Keeping that
description in a separate package means a server refactor does not silently
change the published API, and a client can depend on the contract without
pulling in the server.

## Installation

```bash
pnpm add @mam/registry-api
```

## Layout

```
registry/api/
├── openapi.yaml              REST contract, OpenAPI 3.0.3
├── graphql/
│   └── schema.graphql        GraphQL SDL
├── src/
│   ├── index.ts              entry point, parity check, spec loading
│   └── resolvers.ts          resolver implementations
└── tests/
    ├── resolvers.test.ts     resolver behaviour
    └── contract.test.ts      schema/resolver/spec parity
```

## GraphQL

```graphql
query {
  modules(query: "pipeline", limit: 20) {
    name
    version
    author
    archived
    versions { version integrity }
  }
}
```

### Operations

| Query | Returns |
|-------|---------|
| `modules(query, tag, author, limit, offset, includeArchived)` | Filtered, paginated modules |
| `module(name)` | One module, or null |
| `searchModules(q, limit)` | Free-text search, excludes archived |
| `moduleVersions(name)` | Every version, newest first |
| `moduleVersion(name, version)` | One version, or null |
| `registryStats` | Aggregate counts |

| Mutation | Effect |
|----------|--------|
| `publishModule(name, version, description, author, tags, files)` | Publishes a version, creating the module if absent |
| `deleteModule(name)` | Removes the module and all versions |
| `archiveModule(name, archived)` | Archives or unarchives without deleting |

## Using the resolvers directly

Useful for hosts without a GraphQL executor, and for tests:

```typescript
import { createResolverContext, invoke } from '@mam/registry-api';

const context = createResolverContext({ dataDir: '.mam-data' });

await invoke('publishModule', {
  name: 'my-module', version: '1.0.0', author: 'me', tags: ['core'],
}, context);

const modules = await invoke('modules', { limit: 10 }, context);
```

`createResolverContext()` with no arguments lazily builds a store from
`$MAM_DATA_DIR`, defaulting to `.mam-data`. `resetResolverStore()` drops the
cached one.

## Keeping the contract honest

The schema, the resolvers and the OpenAPI document are all written by hand, so
they can drift. `checkSchemaParity()` compares the first two and reports which
operations cannot be reached:

```typescript
import { checkSchemaParity, getResolverOperations, describeApi } from '@mam/registry-api';

checkSchemaParity();
// { inSync: true, unreachable: [], unimplemented: [] }

describeApi();   // MAM Registry API v0.1.0 — 6 queries, 3 mutations, 1 module fields
```

- `unreachable` — implemented in a resolver but absent from the schema, so no
  client can call it.
- `unimplemented` — declared in the schema but never implemented.

`tests/contract.test.ts` asserts `inSync` is true, and also feeds the check a
deliberately broken schema to prove the check actually detects drift rather than
always passing.

> This guard exists because the drift is not hypothetical. Five resolvers
> (`searchModules`, `moduleVersions`, `registryStats`, `deleteModule`,
> `archiveModule`) were written and never added to the schema, so they were
> unreachable. `checkSchemaParity` is how that gets caught next time.

## Reading the specs

```typescript
import { readOpenAPI, readGraphQLSchema, OPENAPI_PATH, GRAPHQL_SCHEMA_PATH } from '@mam/registry-api';

readGraphQLSchema();   // SDL string
readOpenAPI();         // raw YAML string
```

Both files ship with the package and are also exposed as subpath exports
(`@mam/registry-api/openapi.yaml`, `@mam/registry-api/graphql`) so a generator
in another language can read them straight from `node_modules`.

## Conventions

- **The package owns no state.** Everything goes through a `ResolverContext`
  holding a `ModuleStore`, so a host can supply its own store and tests do not
  need a server.
- **One-directional `Module` checks.** A field resolver that is not declared is
  unreachable and gets flagged. A declared field with no resolver is fine when
  the parent object provides it, because GraphQL's default resolver reads it
  directly — flagging those would report every scalar field.
- **`module` returns null, mutations throw.** A missing module is a legitimate
  result for a query and an error for a mutation, so `ModuleNotFoundError` and
  `ResolverInputError` exist to keep that distinction.
- **Page size is clamped, not trusted.** `limit` is clamped to 1..100 so a
  caller cannot request the whole registry in one call.
- **Archived means hidden, not deleted.** Archived modules stay resolvable by
  name and version; they drop out of listings and search unless
  `includeArchived` is set.
- **Cross-package imports go through the package name.** The resolvers import
  `@mam/registry-server`, not `../../server/src/store.js`. Reaching into another
  package's source works locally and breaks the moment that package is built or
  published.

## Development

```bash
pnpm --filter @mam/registry-api typecheck
pnpm --filter @mam/registry-api test
pnpm --filter @mam/registry-api build
```

## Related

- [`../server`](../server) — `@mam/registry-server`, the implementation
- [`../client`](../client) — `@mam/registry-client`, the TypeScript client
- [`../README.md`](../README.md) — the registry overview

## License

MIT
