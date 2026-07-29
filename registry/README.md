# MAM Registry

Monorepo containing the three sub-packages that compose the MAM module registry.

| Package | Path | Description |
|---|---|---|
| `@mam/registry-server` | `server/` | HTTP server – storage, auth, search, version management |
| `@mam/registry-client` | `client/` | TypeScript client library (zero deps, native `fetch`) |
| `@mam/registry-api` | `api/` | GraphQL schema + resolvers, OpenAPI spec |

---

## Packages

### `@mam/registry-server`

Core registry server responsible for module storage, authentication, search indexing, and version management.

```
cd server && npm install
npm run build
npm run test
npm run typecheck
```

Key exports:

- `RegistryServer` – high-level HTTP server (start/stop + request handlers)
- `ModuleStore` – filesystem-backed module & version storage
- `AuthManager` – token-based authentication, registration, password hashing
- `SearchEngine` – in-memory full-text search

### `@mam/registry-client`

Production-grade TypeScript client for interacting with the MAM registry. Uses native `fetch` – no external runtime dependencies.

```
cd client && npm install
npm run build
npm run test
npm run typecheck
```

#### Features

- `RegistryClient` – typed HTTP client with retry, timeout, auth header injection, request/response interceptors
- `RegistryAuth` – login, logout, JWT refresh, profile, password change, pluggable token storage
- `RegistryError` – structured error class with `isAuthError`, `isNotFound`, `isNetworkError`

#### Quick start

```ts
import { RegistryClient } from '@mam/registry-client';

const client = new RegistryClient({
  baseUrl: 'https://registry.mam.dev',
  auth: { token: 'your-jwt' },
});

const mod = await client.getModule('my-module');
const versions = await client.getVersions('my-module');
await client.publishModule({ name: 'my-module', version: '1.0.0', files: { 'index.js': '...' } });
```

### `@mam/registry-api`

GraphQL schema definition and resolver implementations.

- `graphql/schema.graphql` – SDL schema
- `graphql/resolvers/index.ts` – resolver implementations backed by `ModuleStore`
- `openapi.yaml` – REST API contract

---

## Development

All three packages are part of a workspace. From the repo root:

```bash
npm install        # install all workspace deps
npm run build      # build all packages
npm run test       # run all tests
```

Individual packages can be built/tested independently by `cd`-ing into the package directory.

---

## Architecture

```
┌──────────┐      REST / GraphQL      ┌───────────────┐
│  Client  │ ─────────────────────── │  API / Server  │
│  (npm)   │ ◀────────────────────── │  (HTTP + GQL)  │
└──────────┘      JSON responses      └───────┬────────┘
                                              │
                                      ┌───────▼────────┐
                                      │  ModuleStore   │
                                      │  (filesystem)  │
                                      └────────────────┘
```

- **Client** talks to the server over HTTP (native `fetch`).
- **Server** validates auth tokens, indexes modules for search, and persists data to the filesystem via `ModuleStore`.
- **API** exposes the same operations over GraphQL for consumers that prefer a single-endpoint interface.

---

## License

MIT
