# Permissions

The Permissions layer is a rule-based policy engine that decides whether a
tool request may run. It evaluates declarative allow/deny rules over
tool × capability × roles, resolving ties by specificity, then priority, then
a fail-closed `deny` default.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `PermissionRule`, `PermissionRequest`, `PermissionDecision`, `PermissionConfig`, `PermissionStats`, guards + factories |
| `store.ts` | `PermissionStore`: rule registry, `grant`, `enable`/`disable`, events, `toJSON`/`fromJSON` |
| `index.ts` | `PermissionIndex`: accelerates candidate lookups by tool/capability/role |
| `retrieval.ts` | `PermissionChecker`: `check`/`can`/`checkForRole`, capability extraction + mapping |
| `lifecycle.ts` | `PermissionLifecycle`: `prune`, `revokeTool`, periodic sync, `denied` events |
| `integration.ts` | `ToolAuthorizer` (facade), `PermissionsAdapter` (stable `ToolPermissionProvider`), factories |

## Example

```ts
import { createToolAuthorizer, PermissionDeniedError } from '@mam/tool-engine';

const authz = createToolAuthorizer(); // fails closed by default
authz.grant('fs.read', ['admin', 'editor']);
authz.deny('fs.delete', ['editor']);

authz.check({ tool: 'fs.read', roles: ['admin'] });      // allowed
authz.can({ tool: 'fs.delete', roles: ['editor'] });     // false

try {
  authz.authorize({ tool: 'fs.delete', roles: ['editor'] });
} catch (error) {
  if (error instanceof PermissionDeniedError) {
    console.log(error.decision);      // the denying decision
  }
}

authz.setDefault('allow');            // change the fallback policy at runtime
```

Rules are resolved by precedence: more specific rules win (a rule constrained
on tool + role beats one constrained on tool alone), then higher priority, and
on an exact tie `deny` wins so the boundary stays safe by default. Capability
mappings let the checker understand what capability a tool requires and match
wildcard capabilities like `filesystem.*`.