# Interface Templates

Templates for MAM modules of `type: interface` — a public contract surface
that callers program against, with routing, request validation and a
structured response.

## Module type

```yaml
type: interface
```

`interface` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The
compiler's `checkModuleType` rejects a module whose `type` is not on that
list, so the value must stay `interface` in every variant below, including
`interface.mam`, whose frontmatter declares `type: interface` while its body
describes the Router/Validator/Handler API system.

## Variants

| File | Use when |
|------|----------|
| [`interface.mam`](./interface.mam) | The full template: Router/Validator/Handler agents, shared memory, middleware order, rate limits and error shapes. Start here. |
| [`interface-basic.mam`](./interface-basic.mam) | You only need the contract: a route table, a schema check and a handler result. No middleware, no limits. |
| [`interface-advanced.mam`](./interface-advanced.mam) | Other teams depend on you: version negotiation, a deprecation window, a compatibility matrix, enforced limits and a health check. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `route` / `validate` / `handle` | Yes | Yes | Yes |
| Schema-driven validation | Yes | Yes | Yes |
| Middleware chain | No | auth, rate-limit, order declared | Not applicable |
| Rate limiting | No | Yes | No |
| Agent decomposition | No | Router, Validator, Handler | No |
| Versioned routes | No | No | Yes |
| `negotiate` / `deprecate` | No | No | Yes |
| Compatibility matrix | No | No | Yes |
| Enforced limits | No | Rule stated, not enforced | Yes |
| `health` | No | No | Yes |
| `errors` recorded | No | No | Yes |

Start with `basic` and move to `advanced` when a second team starts calling
you. Reach for the full `interface.mam` when you want the middleware ordering
and the agent decomposition documented in one place.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

The `Contract` section sits between `Capabilities` and `Rules` in every
variant. The full template additionally declares `System Definition` and the
per-agent blocks; the advanced template adds `Versioning`, `Compatibility` and
`Limits`.

## Conventions used by these templates

- **Capabilities are nouns, workflows are verbs.** `route`, `validate` and
  `handle` say what is possible; the Mermaid diagram says the order, and the
  two must agree.
- **A contract is a table, not prose.** Method, path, request schema and
  success status are what a caller reads; everything else is implementation.
- **The capability vocabulary is stable across variants.** The advanced
  template adds `negotiate`, `deprecate` and `health` on top of
  `route`/`validate`/`handle` rather than renaming them, so a capability read
  off one variant means the same thing in the next.
- **An unknown version is refused, never silently upgraded.** Falling back
  quietly is how an interface breaks its callers without telling anyone.
- **Errors are responses.** 404, 400, 406, 413 and 500 are all documented
  shapes with a body; a handler exception never leaks a traceback.
- **Rules are declarative.** Where a limit is stated in `Rules`, the advanced
  template is the variant that actually enforces it in `Python`.

## Related

- [`../contract/`](../contract) — the agreement two sides sign before coding
- [`../service/`](../service) — the process that serves the interface
- [`../plugin/`](../plugin) — how behaviour is added to an existing surface
- [`../documentation/`](../documentation) — the pages an integrator reads
