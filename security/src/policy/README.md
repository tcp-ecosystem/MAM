# Policy

The Policy layer evaluates security rules of the form *"for a subject
performing an action on a resource, allow or deny"* — and it fails closed by
default. Beyond rule evaluation it owns three defensive utilities: input
sanitization, sliding-window rate limiting and dependency allowlist
validation.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `PolicyRule`, `PolicyDefinition`, `PolicyRequest`, `PolicyResult`, `RateLimit`, `SanitizeResult`, `DependencyValidationResult`, `PolicyConfig`, helpers (`ruleMatches`, `compareRules`, `ruleSpecificity`) |
| `store.ts` | `PolicyStore`: rule registry, add/remove, enable/disable, `toJSON`/`fromJSON` |
| `index.ts` | `PolicyIndex`: by action/resource/subject/effect, wildcard buckets |
| `retrieval.ts` | `PolicyEvaluator`: `evaluate`, `sanitize`, `checkRateLimit`, `validateDependencies`, `can`/`canAll`/`canAny` |
| `lifecycle.ts` | `PolicyLifecycle`: rule pruning (explicit/disabled), rate-limit GC, events |
| `integration.ts` | `SecurityPolicyEngine`, `PolicyAdapter`, `createSecurityPolicyEngine`, `SecurityPolicyError` |

## Example

```ts
import { createSecurityPolicyEngine, SecurityPolicyError } from '@mam/security';

const engine = createSecurityPolicyEngine();
engine.addRule({ id: 'allow-read', effect: 'allow', action: 'read', resource: 'document' });
engine.addRule({ id: 'block-vip', effect: 'deny', resource: 'secrets', subject: 'public' });

engine.evaluate({ subject: 'u-1', action: 'read', resource: 'document' }); // allowed
try {
  engine.enforce({ subject: 'public', action: 'read', resource: 'secrets' }); // throws
} catch (error) {
  if (error instanceof SecurityPolicyError) console.error(error.result.reason);
}

const safe = engine.sanitize('<script>alert(1)</script>hello');   // strips JS + tags
const limited = engine.rateLimit('api:u-1', { windowMs: 60_000, max: 5 });
const deps = engine.validateDependencies(['lodash', 'crypto'], ['lodash']);
```

Matching is deterministic: the most specific rule wins, ties broken by highest
`priority`, then insertion order. With no matching rule the configured
`defaultEffect` (default `deny`) applies.