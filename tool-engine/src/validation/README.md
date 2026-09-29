# Validation

The Validation layer is the enforcement point of the MAM runtime tool
contract. Given a tool's declared parameter schema it decides whether a
caller's actual invocation parameters are acceptable — required parameters
present, values correctly typed (optionally coerced), enum constraints
honoured and unknown keys rejected in strict mode — and it structurally checks
tool definitions themselves.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ValidationSchema`, `ValidationResult`, `ValidationIssue`, `ValidationConfig`, `TypeName`, guards + factories |
| `store.ts` | `ValidationStore`: name-keyed schema registry, `putSchema`/`delete`/`list`, `toJSON`/`fromJSON` |
| `index.ts` | `ValidationIndex`: lookups by name, parameter and type |
| `retrieval.ts` | `ParamValidator`: required/type/enum/coerce checks + `validateDefinition` |
| `lifecycle.ts` | `ValidationLifecycle`: validation counters, `prune`, periodic GC, events |
| `integration.ts` | `ToolValidator` (facade), `ValidationAdapter` (stable `Validator` contract), `createToolValidator` |

## Example

```ts
import { createToolValidator } from '@mam/tool-engine';

const validator = createToolValidator();
validator.registerSchema({
  name: 'http.get',
  description: 'Perform an HTTP GET request',
  handler: async () => ({}),
  parameters: [
    { name: 'url', type: 'string', required: true },
    { name: 'retries', type: 'integer', required: false, default: 3 },
    { name: 'method', type: 'string', required: false, enum: ['GET', 'POST'] },
  ],
});

const ok = validator.validateParams('http.get', { url: 'https://x.dev', retries: '5' });
ok.valid;            // true — '5' coerced to 5
ok.coerced;          // { retries: 5 }

const bad = validator.validateParams('http.get', { url: 42 });
bad.valid;           // false
bad.issues[0].code;  // 'type'

const defOk = validator.validateDefinition({
  name: 'http.get',
  description: 'Perform an HTTP GET request',
  handler: async () => ({}),
  parameters: [{ name: 'url', type: 'string', required: true }],
});
defOk.valid;         // true
```

Every pass is a pure, deterministic function of its inputs: required and
missing checks, default application (defaults are themselves validated), type
matching with optional coercion (string ↔ number ↔ boolean, plus JSON strings
for array/object), enum membership and strict-mode unknown-key rejection.
Coerced/defaulted values are reported via `result.coerced` so callers can build
the final argument object.