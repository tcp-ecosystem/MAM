# @mam/registry-server

> The implementation behind `@mam/registry-api`

Storage, authentication, search and version management for the MAM module
registry. This package holds no HTTP framework: a host mounts the handlers on
whatever server it likes and passes in the request identity, so the class owns
the parts a framework would not — keeping the search index in step with the
store, and enforcing the limits declared in the config.

[`@mam/registry-api`](../api) describes the surface; this package implements
it. The resolvers in that package import `ModuleStore` from here by package
name, so the contract and the server cannot drift into describing two different
registries.

## Installation

```bash
pnpm add @mam/registry-server
```

## Quick start

`RegistryServer` does not listen on a port. `port` is recorded and logged; the
host is responsible for binding it and for routing requests to handlers.

```typescript
import { RegistryServer } from '@mam/registry-server';
import { createServer } from 'node:http';

const registry = new RegistryServer({
  port: 3000,
  dataDir: '.mam-data',
  authRequired: true,
  rateLimit: 120,
  maxUploadSize: 5 * 1024 * 1024,
  corsOrigins: ['https://app.example.com'],
  auth: {
    tokenTtlMs: 24 * 60 * 60 * 1000,
    // There is no default admin. Seed one explicitly or nothing can be
    // moderated once it is published.
    bootstrapAdmin: {
      username: 'root',
      email: 'root@example.com',
      password: process.env.MAM_ADMIN_PASSWORD!,
    },
  },
});

// Loads the store, creates the bootstrap admin and builds the search index
// from what is already on disk.
await registry.start();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const request = { token, clientId: req.socket.remoteAddress ?? undefined };

  // Preflight before anything else.
  if (req.method === 'OPTIONS') {
    const preflight = registry.handlePreflight(req.headers.origin, req.method);
    res.writeHead(preflight.status, preflight.headers);
    res.end();
    return;
  }

  let body: { files?: Record<string, string> } | undefined;
  if (req.method === 'POST' || req.method === 'PUT') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
  }

  let response;
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/v1/modules':
      response = await registry.handleListModules({ ...request, query: url.searchParams.get('q') ?? undefined });
      break;
    case 'GET /api/v1/search':
      response = await registry.handleSearch(url.searchParams.get('q') ?? '', request);
      break;
    case 'POST /api/v1/modules':
      response = await registry.handlePublish(
        (body ?? {}) as Record<string, unknown>,
        new Map(Object.entries(body?.files ?? {})),
        token ?? '',
      );
      break;
    case 'GET /api/v1/stats':
      response = await registry.handleStats(request);
      break;
    default:
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
  }

  const headers = { 'content-type': 'application/json', ...registry.getCorsHeaders(req.headers.origin) };
  res.writeHead(response.success ? 200 : 400, headers);
  res.end(JSON.stringify(response));
});

server.listen(3000);
```

Every handler resolves to an `ApiResponse` — `{ success, data?, error?, meta? }` —
rather than throwing, so a host maps it onto whatever status codes its contract
asks for.

## Configuration

| Field | Type | Required | Default | Effect |
|-------|------|----------|---------|--------|
| `port` | `number` | yes | — | Recorded and logged on `start()`. The host binds it |
| `dataDir` | `string` | yes | — | Where `ModuleStore` writes; `modules/` is created inside it |
| `authRequired` | `boolean` | yes | — | When true every handler except `handleLogin` and `handleRegister` requires a valid token |
| `rateLimit` | `number` | yes | — | Requests allowed per window. `0` or less disables rate limiting |
| `maxUploadSize` | `number` | yes | — | Maximum publish size in bytes. `0` or less disables the check |
| `corsOrigins` | `string[]` | yes | — | Allowed origins. `*` allows any |
| `auth` | `AuthManagerOptions` | no | `{}` | Token lifetime, scrypt key length, lockout tuning, `bootstrapAdmin` |
| `rateLimitWindowMs` | `number` | no | `60_000` | Length of the rate limit window |
| `logger` | `RegistryLogger` | no | console | `info(message, ...details)` and `error(message, ...details)` |

> `rateLimit`, `maxUploadSize`, `corsOrigins` and `authRequired` were declared
> on the config type and never read. They are enforced now — see
> [Security](#security) and [CORS](#cors).

`auth` accepts `tokenTtlMs` (24 h), `keyLength` (64), `lockoutMs` (60 s),
`maxFailedAttempts` (5) and `bootstrapAdmin`.

## Handlers

`authRequired` is the column to read. When it is `true`, every row marked
"gated" needs a valid token; the two credential-minting handlers are exempt by
necessity. `handlePublish`, `handleDeleteModule` and `handleArchive` need a
real token even when `authRequired` is `false`, because a write without a
verified identity has no author to record.

| Handler | Auth | Notes |
|---------|------|-------|
| `handleSearch(query, options?)` | gated by `authRequired` | Full-text search over the in-memory index |
| `handleListModules(options?)` | gated by `authRequired` | Reads the store, so it also sees modules published out of band |
| `handleGetModule(name, req?)` | gated by `authRequired` | Resolves archived modules too |
| `handleGetVersions(name, req?)` | gated by `authRequired` | Fails on a missing module rather than returning `[]` |
| `handleGetVersion(name, version, req?)` | gated by `authRequired` | |
| `handlePublish(manifest, files, token)` | always a token | Enforces `maxUploadSize`; author is the token's username, not the manifest's |
| `handleDeleteModule(name, token)` | always a token | Author or `admin` scope. Removes from the store *and* the index |
| `handleArchive(name, options?)` | always a token | Author or `admin` scope. `archived` defaults to `true` |
| `handleLogin(username, password, req?)` | anonymous | Rate limited, never auth gated |
| `handleRegister(username, email, password, req?)` | anonymous | Rate limited, never auth gated |
| `handleStats(req?)` | gated by `authRequired` | `totalModules`, `totalVersions`, `totalDownloads`, `lastUpdated` |
| `isOriginAllowed(origin)` | – | `true` for a configured origin or `*` |
| `getCorsHeaders(origin, methods?)` | – | `{}` for a disallowed origin, rather than echoing it |
| `handlePreflight(origin, method?)` | – | 204 allowed, 403 origin refused, 405 method refused |

Ownership or an `admin` scope gates the destructive operations:
`handleDeleteModule` and `handleArchive` check `module.author` against the
verified username and fall back to `verifyTokenWithScope(token, 'admin')`, so a
takedown is not blocked on the author being reachable. `admin` is only ever
granted to a user with the `admin` role, which only `bootstrapAdmin` creates —
`register()` always assigns `['user']`.

Also public: `start()`, `stop()`, `reindexSearch()`, `getSearchIndexSize()`.

## Security

**Passwords.** Stored as `scrypt$<salt>$<hash>` with a 16-byte random salt per
user, so identical passwords do not share a hash. Verification uses
`timingSafeEqual`, and a username with no record still pays for a hash so a
missing account is not distinguishable by timing.

**Password policy.** Minimum 12 characters, with an uppercase letter, a
lowercase letter and a digit required. Symbols are optional. The policy is
overridable by passing a `PasswordPolicy` as `AuthManager`'s second constructor
argument.

**Lockout.** After `maxFailedAttempts` failures (default 5) an account is locked
for `lockoutMs` (default 60 s), and `authenticate()` then throws
`AuthError('account_locked', …, 429)` rather than returning null, so a client
backs off instead of retrying. A successful login clears the counter.

**Tokens.** `randomBytes(32)` in hex — opaque, server-side only. A token
carries no username, no role and no password, so a leaked token reveals nothing
about the credential that minted it, and a token cannot be decoded to escalate
its own scope. Tokens expire after `tokenTtlMs`.

**Revocation on password change.** `changePassword()` bumps the user's
`credentialVersion` and calls `revokeAllTokens()`. The version is appended to
the token id, so every token minted before the change stops verifying without
an extra field being exposed to clients. Without that, a token stolen before
the change stays valid for the rest of its 24-hour life.

**No default admin.** There is none. `AuthManager.init()` creates the
`bootstrapAdmin` only if one is configured; otherwise the registry starts with
zero users and there is no way to moderate it. A hardcoded default password
would hand anyone who deploys the registry a known administrator, so the choice
is explicit.

**Scopes.** `read` and `write` on every token; `admin` added when the user's
roles include `admin`. `verifyTokenWithScope(token, scope)` and
`hasScope(token, scope)` check it.

**Machine-readable errors.** `AuthError` carries `code` and `statusCode`;
`ValidationError` extends it with `code: 'validation_failed'` and status 400.
The codes in use are `account_locked` (429), `username_taken` (409),
`email_taken` (409) and `validation_failed` (400).

## Search

Queries are narrowed by a character n-gram inverted index before scoring, so a
query does not scan the whole corpus: the posting list of the query's rarest
gram is a guaranteed superset of the substring matches, and each candidate is
then confirmed with the original substring check. Scoring, highlights,
pagination and sort order are unchanged. `getSuggestions` uses a name-prefix
index; `getRecent`/`getPopular` rank the whole corpus by design.

**The index is rebuilt from the store on `start()`**, not only from later
publishes. An index built from publishes alone never sees the modules already
on disk, so every search came back empty after a restart. It is then kept in
step: `handlePublish` re-indexes the *stored* record (the one carrying the
timestamps, the version list and the archived flag) rather than the request
manifest, `handleArchive` re-indexes the updated record, and
`handleDeleteModule` removes the entry — a deleted module that stayed in the
index would keep showing up in search results. `reindexSearch()` is public for a
manual resync.

**Sort options** are `'relevance' | 'downloads' | 'updated' | 'name'`.

- `relevance` (the default for search) — by score, with name as the tiebreak.
- `updated` — newest `updatedAt` first, name as the tiebreak.
- `name` — alphabetical.
- `downloads` — falls back to name. The store does not record download counts,
  so ordering by them would be an invented signal.

Every order ends in a name comparison, so the same query returns the same order
twice whatever order the index was built in. In `handleListModules` there is no
query and so no score; `relevance` becomes `updated` rather than an arbitrary
order.

**Limit clamping** happens in `normalizeSearchLimit`: anything that is not a
finite number falls back to the default (20), anything out of range is pulled to
the nearest bound, 1..100. `limit: 0` used to mean "no limit" and quietly became
the default, so a caller asking for nothing got twenty rows. Offsets go through
`normalizeSearchOffset` and are never negative. The applied values are echoed in
`meta.limit` and `meta.offset` — a caller that asked for 1000000 rows needs to
know it was served 100.

**Archived modules** stay resolvable by name and version. Only their
discoverability changes: `handleSearch`, `handleListModules` and the
`SearchEngine` helpers hide them unless `includeArchived: true`.

## Persistence

Everything lives under `dataDir`:

```
.mam-data/
└── modules/
    └── my-module/
        ├── meta.json                  the module record
        └── 1.0.0/                     files, at their published paths
            ├── index.js
            └── lib/
                └── util.js
```

`meta.json` is the whole record, written pretty-printed on every publish:

| Key | Meaning |
|-----|---------|
| `name`, `description`, `author`, `tags` | Taken from the first manifest published; later versions do not rewrite them |
| `versions` | Map of version string to a `VersionRecord` (`manifest`, `files`, `tarball`, `integrity`, `publishedAt`, `publishedBy`) |
| `latest` | Version of the most recent publish |
| `createdAt`, `updatedAt` | ISO timestamps; `updatedAt` also moves on archive |
| `archived` | Optional boolean. Set by `ModuleStore.setArchived()` |

The `archived` flag lives on the module record rather than on any version, so
re-publishing a version does not carry it away. An absent flag means not
archived; only `archived === true` hides a module.

## Tests

197 tests across four files: `tests/auth.test.ts` (71), `tests/search.test.ts`
(49), `tests/server.test.ts` (62), `tests/store.test.ts` (15).

```bash
pnpm --filter @mam/registry-server test
```

## Conventions

- **No framework, but there is a `listen`.** `RegistryHttpServer` (`src/http.ts`)
  serves the handlers over `node:http` with routing, CORS, security headers,
  body limits, rate-limit headers and graceful shutdown — no express/fastify.
  GraphQL executes against the same store at `/graphql` (`src/graphql.ts`).
  A host that needs something else still owns the socket; the handlers stay
  transport-free.
- **One gate.** Every handler goes through the same rate-limit-then-auth path,
  so `authRequired` cannot be forgotten on a new one. Rate limiting comes
  first, so a caller over budget cannot use the auth path to make the server do
  work.
- **Rate limits are keyed by token, then client id**, so a shared NAT does not
  pool separate users into one budget. The in-memory window is cleared by
  `stop()`; a multi-process deployment needs a shared store.
- **Writes re-read the store before indexing.** The record that was persisted is
  the one that is searchable.
- **Failures are responses.** Handlers return `{ success: false, error }`; only
  `AuthManager` throws, so its callers can distinguish validation from auth.
- **Missing is not empty.** `handleGetVersions` fails on an unknown module,
  because `[]` reads the same as a module with no versions.

## Development

```bash
pnpm --filter @mam/registry-server typecheck
pnpm --filter @mam/registry-server test
pnpm --filter @mam/registry-server build
```

## Related

- [`../api`](../api) — `@mam/registry-api`, the contract this implements
- [`../client`](../client) — `@mam/registry-client`, the TypeScript client
- [`../README.md`](../README.md) — the registry overview

## License

MIT
