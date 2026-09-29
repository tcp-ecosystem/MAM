# Auth

The Auth layer registers identities and authenticates principals. It owns the
cryptographic heart of the engine — hashing secrets, issuing API keys and
bearer tokens (persisting only digests), managing sessions and sweeping
expired or revoked credentials.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `Identity`, `IdentityInput`, `ApiKey`, `AuthToken`, `Session`, `Credential`, `AuthConfig`, `AuthStats`, guards + factories |
| `store.ts` | `IdentityStore`: identity registry, CRUD, role/type views, `toJSON`/`fromJSON` |
| `index.ts` | `AuthIndex`: by role/type/token, `findToken`, `ownerOf`, rebuild |
| `retrieval.ts` | `CredentialVerifier`: `hashSecret`/`verifySecret`, `createApiKey`, `issueToken`, `verifyApiKey`/`verifyToken` |
| `lifecycle.ts` | `AuthLifecycle`: `pruneExpired`, `revokeAll`, start/stop sweeper, events |
| `integration.ts` | `Authenticator` (`registerIdentity`, `login`, `logout`, `authenticateApiKey`, `authenticateToken`, `current`), `AuthAdapter`, `createAuthenticator` |

## Example

```ts
import { createAuthenticator } from '@mam/security';

const auth = createAuthenticator();
auth.start();

const alice = auth.registerIdentity({ name: 'alice', roles: ['admin'] });
const login = auth.login(alice.id);          // token + one-time secret + session
const result = auth.authenticateToken(login.secret);
console.log(result?.identity.name, result?.session?.id);

const key = auth.createApiKey(alice.id);      // long-lived API key
const viaKey = auth.authenticateApiKey(key.secret);

auth.logout(login.secret);                    // revoke token + session
auth.prune();                                 // immediate expiry sweep
auth.stop();
```

Key design point: raw secrets are never stored. `hashSecret` produces
self-describing digests (`sha256$salt$hash` for high-entropy secrets,
`scrypt$N$r$p$salt$key` for passwords), and verification uses constant-time
comparison.