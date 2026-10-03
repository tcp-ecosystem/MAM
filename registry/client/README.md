# @mam/registry-client

> The TypeScript client for the MAM registry

Typed HTTP access to a MAM registry, on native `fetch` with no runtime
dependencies. Retries, timeouts, auth header injection, token refresh and
request/response interceptors are built in; everything it talks to is described
by [`@mam/registry-api`](../api) and served by
[`@mam/registry-server`](../server).

## Installation

```bash
pnpm add @mam/registry-client
```

## Quick start

`baseUrl` is required and validated in the constructor — a missing or empty one
throws immediately, rather than failing later as a `TypeError` from inside the
request pipeline. Trailing slashes and surrounding whitespace are stripped.

```typescript
import { RegistryClient, RegistryAuth } from '@mam/registry-client';

const client = new RegistryClient({
  baseUrl: 'https://registry.mam.dev',
  timeout: 15_000,
  retries: 2,
  auth: {
    token: process.env.MAM_TOKEN,
    tokenStorage: {
      // Pluggable: any object with these three methods will do.
      async getItem(key) { return localStorage.getItem(key); },
      async setItem(key, value) { localStorage.setItem(key, value); },
      async removeItem(key) { localStorage.removeItem(key); },
    },
  },
});

// Auth — on a client built with no `auth` config at all, attach one yourself:
const auth = new RegistryAuth({ baseUrl: 'https://registry.mam.dev' });
client.setAuth(auth);
await auth.login('alice', process.env.MAM_PASSWORD!);

// List
const page = await client.listModules({ tag: 'core', limit: 20 });
console.log(page.total, page.data.map(m => m.name));

// Search
const hits = await client.searchModules({ q: 'pipeline', sort: 'updated' });

// Publish
await client.publishModule({
  name: 'my-module',
  version: '1.0.0',
  description: 'Does the thing',
  tags: ['core'],
  files: { 'index.js': 'export const hi = () => "hi";\n' },
});
```

Errors are uniform. `RegistryError` carries the status and the parsed body, so a
caller never has to inspect a stack to tell a 404 from a timeout:

```typescript
import { isRetryableError, toRegistryError } from '@mam/registry-client';

try {
  await client.getModule('nope');
} catch (err) {
  const error = toRegistryError(err);
  if (error.isNotFound) return;
  if (isRetryableError(err)) scheduleRetry();
  throw error;   // statusCode, body, isNetworkError, isTimeout
}
```

## Configuration

| Field | Type | Default | Effect |
|-------|------|---------|--------|
| `baseUrl` | `string` | – | Required. Registry root; whitespace and trailing slashes trimmed |
| `timeout` | `number` | `30_000` | Per-attempt deadline, via `AbortSignal.timeout` |
| `retries` | `number` | `2` | Extra attempts after the first. Floored at `0` |
| `retryDelay` | `number` | `500` | Base delay; doubled per attempt |
| `headers` | `Record<string, string>` | `{}` | Appended to every request |
| `auth` | `AuthConfig` | – | Builds a `RegistryAuth`; see [Auth](#auth) |
| `fetch` | `typeof globalThis.fetch` | `globalThis.fetch` | Custom implementation, for tests or a polyfill |

Defaults are applied after the spread, so `new RegistryClient({ ...opts,
timeout: undefined })` still gets 30 s rather than `undefined`.

`AuthConfig` adds `apiKey` (takes precedence over the bearer token, sent as
`Authorization: ApiKey …`), `token` (a pre-existing bearer token), the three
`tokenStorage` methods, and its own `fetch` override — which `RegistryClient`
fills in from the client config so the two always use the same implementation.

## Methods

| Method | Request | Returns |
|--------|---------|---------|
| `getModule(name)` | `GET /modules/:name` | `ModuleRecord` |
| `listModules({ tag?, author?, page?, limit? }?)` | `GET /modules` | `PaginatedResponse<ModuleRecord>` |
| `publishModule(input)` | `POST /modules` | `{ name, version, url }` |
| `deleteModule(name)` | `DELETE /modules/:name` | `void` |
| `getVersions(name)` | `GET /modules/:name/versions` | `string[]` |
| `getVersion(name, version)` | `GET /modules/:name/versions/:version` | `VersionInfo` |
| `searchModules({ q, tag?, author?, sort?, page?, limit? })` | `GET /modules/search` | `PaginatedResponse<ModuleMetadata>` |
| `getModuleDependencies(name)` | `GET /modules/:name/dependencies` | `ModuleDependency[]` |
| `downloadModule(name, version?)` | `GET /modules/:name/download` | `{ url }` |
| `getModuleStats(name)` | `GET /modules/:name/stats` | `ModuleStats` |
| `request<T>(method, path, body?)` | any | `T` — the same pipeline, for endpoints the client does not wrap |
| `setAuth(auth)` | – | Attaches an existing `RegistryAuth` |
| `setAuthToken(token)` | – | Static token; creates the `RegistryAuth` if there is none |
| `clearAuthToken()` | – | Drops stored tokens |
| `addRequestInterceptor(fn)` | – | Runs on every request, in order |
| `addResponseInterceptor(fn)` | – | Runs on every response, in order |

Path segments are percent-encoded, and query parameters with `undefined`, `null`
or `''` values are dropped rather than serialised as `undefined`.

## Errors

`RegistryError` is the single error type the client throws. It carries:

| Member | Meaning |
|--------|---------|
| `statusCode?` | HTTP status, when the failure was a response |
| `body?` | Parsed response body, or the raw text if it was not JSON |
| `isNetworkError` | Network, DNS or timeout failure |
| `isTimeout` | Aborted because it exceeded `timeout` |
| `isAuthError` | `401` or `403` |
| `isNotFound` | `404` |
| `isRetryable` | Network, timeout, or a transient status — everything else is thrown at once |

> `isTimeout` implies `isNetworkError`. The constructor defaults
> `isNetworkError` to `isTimeout`, so a consumer written before `isTimeout`
> existed still treats a timeout as a network failure. Check `isTimeout` first
> if the two need different handling.

The message is taken from the body's `error` or `message` field when there is
one, so the server's own wording survives.

Exported helpers, so a caller never has to guess how an error was produced:

- `RETRYABLE_STATUS_CODES` — `ReadonlySet` of `{408, 429, 500, 502, 503, 504}`.
- `isTimeoutError(err, signal?)` — detects a timeout without `instanceof
  DOMException`, because browsers, Node 18 and polyfills disagree on the class
  they throw. True for an aborted signal, `name === 'TimeoutError'`, or
  `code === 'ETIMEDOUT' / 23`.
- `isRetryableError(err)` — whether it is worth another attempt.
- `toRegistryError(err, context?)` — normalise anything into a `RegistryError`.
  Existing ones pass through untouched, non-`Error`s are stringified, timeouts
  keep their flag, and `context` is prefixed to the message so the failing
  request is identifiable in logs.

## Auth

`RegistryAuth` is available on its own or wired up through `RegistryConfig.auth`.
When constructed by a client it inherits the client's `baseUrl` and `fetch`.

| Method | Notes |
|--------|-------|
| `login(username, password)` | `POST /auth/login`; persists the token and any refresh token |
| `logout()` | `POST /auth/logout`, then `clearTokens()` — local state is dropped even if the call fails |
| `refreshToken()` | `POST /auth/refresh`; throws when no refresh token is held |
| `canRefresh()` | Whether a refresh token is held, i.e. whether `refreshToken()` can succeed |
| `getProfile()` | `GET /auth/profile` |
| `changePassword(oldPassword, newPassword)` | `POST /auth/password` |
| `getAuthHeaders()` | `Authorization` for the next request; triggers a background refresh when needed |
| `getTokenExpiration()` | The JWT `exp` claim as a `Date`, or `null` when it cannot be read |
| `isExpiring()` | Whether the token expires within the 30 s refresh buffer |
| `isAuthenticated()` | An API key, or a token that is present and not expired |
| `setToken(token, refreshToken?)` | For restoring a session. Omitting `refreshToken` clears any stored one |
| `clearTokens()` | Drops in-memory and persisted state, and resets the refresh lock |

**Token storage.** `tokenStorage` is a `TokenStorage` — `getItem`, `setItem`,
`removeItem`, all async — so tokens can survive a process restart. They are
written under `mam_auth_token` and `mam_refresh_token`, and read back on
construction (or via the public `restore()` for callers that need the
synchronous accessors to reflect storage). A session with no refresh token
removes the stale one, so memory and storage cannot disagree. An expired stored
token is discarded, not restored, and a backend that throws is treated as "no
session" rather than a broken client.

**Opaque (non-JWT) tokens.** The MAM server mints opaque random strings, not
JWTs. Such a token has no readable `exp`, so the client cannot know when it
lapses and does not guess: it is treated as **non-expiring**, `isAuthenticated()`
is `true` while it is held, `getTokenExpiration()` returns `null`, `isExpiring()`
is `false`, and `getAuthHeaders()` never refreshes it proactively. A background
refresh per request to find out would cost a round-trip on every call. The token
is renewed **reactively** instead: the request goes out, the registry answers
`401`, and `request()` refreshes once and replays. Only a token with a readable
`exp` is refreshed ahead of expiry, within a 30-second buffer.

**One refresh in flight.** `refreshToken()` shares a single promise between
concurrent callers. Registries commonly invalidate a refresh token the moment it
is used, so two parallel refreshes would leave one of them holding a dead token.
A burst of requests that all get a `401` therefore produces one refresh call, not
one per request. The lock is released when the request settles, so a failed
refresh can be retried; a failed refresh also clears the stored tokens.

## Retries

`request()` retries only what is transient, and only up to `retries` extra
attempts:

- network failures and timeouts
- `408`, `429`, `500`, `502`, `503`, `504` (see `RETRYABLE_STATUS_CODES`)

The delay is `retryDelay * 2^attempt` — 500 ms, 1 s, 2 s by default. Everything
else, including a plain `TypeError` from a bug in an interceptor, is thrown on
the first attempt rather than retried three times.

A `401` is not an ordinary retry. When the auth layer holds a refresh token, the
client refreshes once and replays the request; the replay is flagged so a
genuinely invalid session fails immediately instead of looping. If the refresh
itself fails, the original `401` is what the caller sees — a failed refresh is
not the interesting error.

## Interceptors

```typescript
client.addRequestInterceptor(init => ({
  ...init,
  headers: { ...init.headers, 'x-trace-id': crypto.randomUUID() },
}));

client.addResponseInterceptor(async response => {
  if (response.status === 429) await backoff(response.headers.get('retry-after'));
  return response;
});
```

Request interceptors run after auth and body serialisation and receive the
`RequestInit` plus its resolved `url`, so they can rewrite either. Response
interceptors run on the raw `Response` before the body is read, and are the
right place for logging or metrics.

A request replayed after a `401` runs the interceptors again — it is a second
request, and any trace id or signature it adds should be recomputed rather than
reused.

## Known limitations

Stated plainly, because both are the kind of thing that costs an afternoon:

- **A `DELETE` can still be retried.** The retry decision is made from the
  status code, not the method, so a `DELETE` that returns a `5xx` is retried
  like any other request. If your registry can report a `5xx` after having
  already removed the module, that retry is a repeat of a destructive call.
  Failures after a `deleteModule` that succeeded should be treated as
  ambiguous, not as a clean failure.
- **The auth endpoints are not in the OpenAPI document.**
  `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/profile` and
  `/auth/password` are what this client calls; `../api/openapi.yaml` describes
  the module surface only. Same for `getModuleDependencies`,
  `downloadModule` and `getModuleStats`. They are the client's contract with
  the server, and a host that serves the published OpenAPI document alone will
  not answer them.

## Tests

131 tests across two files: `tests/auth.test.ts` (67) and
`tests/client.test.ts` (64).

```bash
pnpm --filter @mam/registry-client test
```

## Conventions

- **Zero dependencies.** Native `fetch` only; `fetch` is injectable for tests
  and polyfills.
- **Errors are uniform.** Every method rejects with a `RegistryError`; nothing
  throws a raw `TypeError` from the transport.
- **Failures are the caller's.** A method either resolves with parsed data or
  rejects — no partial success, no sentinel `null` for "not found".
- **The client does not guess.** A `baseUrl` that is missing or empty is
  rejected at construction rather than producing a confusing error later.
- **No `AbortSignal` passthrough.** A deadline is set per attempt from
  `timeout`; caller-supplied cancellation is not part of the config.

## Development

```bash
pnpm --filter @mam/registry-client typecheck
pnpm --filter @mam/registry-client test
pnpm --filter @mam/registry-client build
```

## Related

- [`../server`](../server) — `@mam/registry-server`, the implementation
- [`../api`](../api) — `@mam/registry-api`, the contract both implement
- [`../README.md`](../README.md) — the registry overview

## License

MIT
