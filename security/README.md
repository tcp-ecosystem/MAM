# MAM Security

Standalone MAM Security engine: **Auth**, **Authorization**, **Policy** and
**Audit** layers. A dependency-free, deterministic security stack that covers
the full lifecycle of a request — who you are (auth), what you may do
(authorization), what rules govern the action (policy) and what gets recorded
when it happens (audit).

## Overview

The Security engine is the trust boundary of the MAM platform. Each layer
solves one problem and exposes a small, ergonomic integration surface:

- **Auth** registers identities (users, agents, services, system principals),
  issues API keys and bearer tokens (storing only digests), manages sessions,
  verifies credentials in constant time and sweeps expired/revoked secrets.
- **Authorization** is a pure RBAC engine: roles, permissions, inheritance and
  identity assignments, with an index-accelerated `AccessChecker` that turns
  requests into `AccessDecision`s (`check` / `can` / `authorize`).
- **Policy** evaluates allow/deny rules over a subject/action/resource triple,
  plus defensive utilities: input sanitization, sliding-window rate limiting
  and dependency allowlist validation. It fails closed by default.
- **Audit** records redacted security events (emails, keys, JWTs, passwords
  are masked on the way in), queries the log, detects rule-based anomalies and
  aggregates `SecurityReport`s.

Every layer is organised in the same six-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms), `lifecycle` (housekeeping) and `integration` (the facade you
actually call).

## Architecture

```
Security Engine (@mam/security)
├── Auth            src/auth/            Authenticator, AuthAdapter, CredentialVerifier
├── Authorization   src/authorization/   Authorizer, RbacEngine, AccessChecker
├── Policy          src/policy/          SecurityPolicyEngine, PolicyEvaluator
└── Audit           src/audit/           AuditLogger, SecurityReporter, Redactor
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  createAuthenticator, Authenticator,
  createAuthorizer, RbacEngine,
  createSecurityPolicyEngine, SecurityPolicyEngine,
  createAuditLogger, AuditLogger, createSecurityReporter,
} from '@mam/security';
```

## Quick start

```ts
import {
  createAuthenticator,
  createAuthorizer,
  createSecurityPolicyEngine,
  createAuditLogger,
  createSecurityReporter,
} from '@mam/security';

// 1. Auth: register an identity and log in.
const auth = createAuthenticator();
auth.start();
const alice = auth.registerIdentity({ name: 'alice', roles: ['admin'] });
const login = auth.login(alice.id);
// → give login.secret to the client; store login.token.
const result = auth.authenticateToken(login.secret); // { identity, credential, session }

// 2. Authorization: define roles and check access.
const authz = createAuthorizer();
authz.registerRole({ name: 'admin', permissions: [{ action: '*', resource: '*' }] });
authz.assign(alice.id, ['admin']);
authz.authorize({ identityId: alice.id, roles: ['admin'], action: 'read', resource: 'document' });

// 3. Policy: evaluate rules and sanitize input.
const policy = createSecurityPolicyEngine();
policy.addRule({ id: 'allow-read', effect: 'allow', action: 'read', resource: 'document' });
policy.enforce({ subject: alice.id, action: 'read', resource: 'document' });
const safe = policy.sanitize('<script>alert(1)</script>hello');

// 4. Audit: record (redacted) events and produce a report.
const audit = createAuditLogger();
audit.start();
audit.recordDenied('document.delete', alice.id, { target: 'doc-42' });
const report = createSecurityReporter().report();
```

## Commands

```sh
pnpm install                        # install all workspace packages
pnpm --filter @mam/security build       # compile src/ -> dist/ (tsc)
pnpm --filter @mam/security test        # run the vitest suite
pnpm --filter @mam/security typecheck   # tsc --noEmit
pnpm --filter @mam/security clean       # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Auth | `types.ts` | `Identity`, `ApiKey`, `AuthToken`, `Session`, `AuthConfig`, `AuthStats`, guards + factories |
| | `store.ts` | `IdentityStore`: identity registry, CRUD, role/type views, JSON round-trip |
| | `index.ts` | `AuthIndex`: by role/type/token, owner lookups |
| | `retrieval.ts` | `CredentialVerifier`: hash/verify, API keys, bearer tokens |
| | `lifecycle.ts` | `AuthLifecycle`: expiry sweeps, revocation, events |
| | `integration.ts` | `Authenticator`, `AuthAdapter`, `createAuthenticator` |
| Authorization | `types.ts` | `Permission`, `Role`, `AccessRequest`, `AccessDecision`, matching helpers |
| | `store.ts` | `RoleStore`: define/grant/revoke/assign, JSON round-trip |
| | `index.ts` | `PermissionIndex`: by action/resource/scope/role |
| | `retrieval.ts` | `AccessChecker`: `check`/`can`/`authorize`, inheritance expansion |
| | `lifecycle.ts` | `AuthzLifecycle`: pruning, revocation, periodic sync |
| | `integration.ts` | `Authorizer`, `RbacEngine`, `AuthorizationAdapter`, `createAuthorizer` |
| Policy | `types.ts` | `PolicyRule`, `PolicyRequest`, `PolicyResult`, `RateLimit`, `SanitizeResult` |
| | `store.ts` | `PolicyStore`: rule registry, enable/disable, JSON round-trip |
| | `index.ts` | `PolicyIndex`: by action/resource/subject/effect |
| | `retrieval.ts` | `PolicyEvaluator`: evaluate, sanitize, rate limit, dependencies |
| | `lifecycle.ts` | `PolicyLifecycle`: rule pruning, rate-limit GC, events |
| | `integration.ts` | `SecurityPolicyEngine`, `PolicyAdapter`, `createSecurityPolicyEngine` |
| Audit | `types.ts` | `AuditEvent`, `RedactConfig`, `AnomalyRule`, `SecurityReport`, `AuditConfig` |
| | `store.ts` | `AuditStore`: append-only, capacity-bounded log, JSON round-trip |
| | `index.ts` | `AuditIndex`: by type/actor/result/severity |
| | `retrieval.ts` | `AuditQuery`: `recent`, `byType`, `summary`, `counts` |
| | `lifecycle.ts` | `AuditLifecycle` + `detectAnomalies`: retention, anomaly engine |
| | `integration.ts` | `AuditLogger`, `SecurityReporter`, `Redactor`, factories |

## Per-layer docs

- [`src/auth/README.md`](src/auth/README.md)
- [`src/authorization/README.md`](src/authorization/README.md)
- [`src/policy/README.md`](src/policy/README.md)
- [`src/audit/README.md`](src/audit/README.md)