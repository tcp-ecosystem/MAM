# Authorization

The Authorization layer answers one question: *"may a principal holding a set
of roles perform an action on a resource?"* It is a pure RBAC engine with
role inheritance, index-accelerated matching and three interchangeable
facades.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `Permission`, `Role`, `Capability`, `AccessRequest`, `AccessDecision`, `AuthzConfig`, matching helpers (`permissionAllows`, `scopeAllows`, `specificity`) |
| `store.ts` | `RoleStore`: define/grant/revoke/assign, `getRolesForIdentity`, `toJSON`/`fromJSON` |
| `index.ts` | `PermissionIndex`: by action/resource/scope/role, `find` triple lookup |
| `retrieval.ts` | `AccessChecker`: `check`/`can`/`authorize`/`checkMany`, `permissionsFor`, `resolveRoles` |
| `lifecycle.ts` | `AuthzLifecycle`: pruning (explicit/orphan), `revokeRole`, periodic sync, events |
| `integration.ts` | `Authorizer`, `RbacEngine`, `AuthorizationAdapter`, `createAuthorizer`, `AuthorizationError` |

## Example

```ts
import { createAuthorizer, RbacEngine, createRole, AuthorizationError } from '@mam/security';

const authz = createAuthorizer();
authz.registerRole({ name: 'editor', permissions: [{ action: 'write', resource: 'document' }] });
authz.grant('editor', { action: 'read', resource: 'document' });
authz.assign('u-1', ['editor']);

authz.check({ identityId: 'u-1', roles: ['editor'], action: 'read', resource: 'document' });
authz.can({ roles: ['editor'], action: 'write', resource: 'document' }); // true
try {
  authz.authorize({ roles: ['editor'], action: 'delete', resource: 'document' }); // throws
} catch (error) {
  if (error instanceof AuthorizationError) console.error(error.decision.reason);
}

// Fully wired engine for the hot path:
const engine = new RbacEngine();
engine.defineRole(createRole('admin', [{ action: '*', resource: '*' }]));
const decision = engine.enforce({ roles: ['admin'], action: 'invoke', resource: 'lambda' });
```

Denials never throw for ordinary `check`/`can` calls — they return a decision
with a `reason` (`no-roles`, `unknown-role`, `missing-permission`,
`invalid-request`). Only `authorize` throws `AuthorizationError`.