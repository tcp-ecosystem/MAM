# Resource Templates

Templates for MAM modules of `type: resource` — state managed outside the MAM
runtime by a provider, with a reconcile loop that drives actual state toward
desired state.

## Module type

```yaml
type: resource
```

`resource` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `resource` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`resource.mam`](./resource.mam) | You want the full template: provider table, permissions, all four capabilities and a documented lifecycle. Start here. |
| [`resource-basic.mam`](./resource-basic.mam) | One provider, one size, no drift handling. The smallest resource that still has a complete lifecycle. |
| [`resource-advanced.mam`](./resource-advanced.mam) | Production shape: health checks, explicit drift detection, a settle window and dependency-aware teardown. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `provision` / `deprovision` | Yes | Yes | Yes |
| `status` / `reconcile` | Yes | Yes | Yes |
| `health` | No | No | Yes |
| `drift` | No | No | Yes |
| Settle window | No | No | Yes |
| Dependency-aware teardown | No | Documented | Enforced |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when you need drift detection or
dependents. Reach for the full `resource.mam` when you want the documented
version of the simple case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Provider`, `Permissions`) appear in the full and
advanced templates.

## Conventions used by these templates

- **Capabilities are nouns, workflows are verbs.** `Capabilities` says what is
  possible; `Workflow` says when it happens. The Mermaid diagram must agree
  with both.
- **Rules are declarative.** They constrain behaviour; the runtime enforces
  them. No rule in these templates is implemented in Python.
- **Reconcile is idempotent.** Running it twice must leave the same state, which
  is what makes it safe to retry.
- **Credentials never appear in output.** `permissions.environment.read` is
  declared so the provider can read them, and a rule forbids logging them.
- **A failed apply is not a partial apply.** The advanced template records the
  failure in `errors` and re-raises, leaving prior state intact.

## Related

- [`../policy/`](../policy) — declarative behavioural constraints
- [`../service/`](../service) — long-running processes rather than reconciled state
- [`../workflow/`](../workflow) — multi-step pipelines
