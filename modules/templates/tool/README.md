# Tool Templates

Templates for MAM modules of `type: tool` — an executable unit with a narrow,
well-typed contract that another module can call.

## Module type

```yaml
type: tool
```

`tool` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `tool` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`tool.mam`](./tool.mam) | You want the documented full tool: a `provider`, `invoke` / `configure` / `health_check`, the permission scopes, and the error rules. Start here. |
| [`tool-basic.mam`](./tool-basic.mam) | A pure, side-effect free call with one required input and a constant result envelope. |
| [`tool-advanced.mam`](./tool-advanced.mam) | A side-effecting call that other systems invoke unattended: stable error codes, per attempt timeouts, bounded retries, a rate limit and idempotency keys. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `invoke` | Yes | Yes | Yes |
| `configure` | No | Yes | Yes |
| `health_check` | Yes (via `describe`) | Yes | Yes |
| `limit` | No | No | Yes |
| `retry` | No | No | Yes |
| Side effects | None | Provider dependent | Yes |
| Idempotent | Yes | Not declared | Per `idempotency_key` |
| Rate limit | No | No | Yes |
| Per call timeout | No | No | Yes |
| Error codes | 3 | Free text | 8, part of the contract |

Start with `basic` when the tool is a pure transform — it needs no retry, no
limit and no idempotency. Reach for `advanced` the moment the tool changes
something outside its own process; that is the variant that makes a retry safe.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block
  whose `test_*` functions pass

Type specific sections appear between `Capabilities` and `Rules`: `Contract` in
the basic template, and `Contract`, `Error Codes`, `Limits` and `Permissions`
in the advanced one.

## Conventions used by these templates

- **One entry point.** Every tool exposes a single `invoke`; a caller never
  has to know which internal helper to reach for.
- **The envelope is constant.** Success and failure return the same fields, so
  a caller can destructure before it knows the outcome.
- **Error codes are the contract, not messages.** A code may be added freely;
  renaming one is a breaking change, which is why the advanced template lists
  them in a table.
- **The tool never raises to the caller.** Failures come back as `success:
  false` with a code, which is what makes a retry loop safe.
- **Validate, authorize, then limit, then dispatch.** A call that cannot be
  allowed never reaches the provider and never spends rate budget.
- **Retries are bounded and only for retryable codes.** A `permission_denied`
  or an `invalid_payload` is not retried, because retrying cannot fix it.
- **Side effects need an idempotency key.** The advanced template returns the
  first result for a repeated key instead of repeating the effect.

## Related

- [`../agent/`](../agent) — the caller that decides when to invoke a tool
- [`../interface/`](../interface) — contracts between modules, rather than the
  implementation of one
- [`../service/`](../service) — long-running processes behind a tool
- [`../contract/`](../contract) — declared input and output shapes
