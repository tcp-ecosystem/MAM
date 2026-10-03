# Component Templates

Templates for MAM modules of `type: component` — a reusable part of a larger
system that exposes inputs and outputs behind a declared contract.

## Module type

```yaml
type: component
```

`component` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `component` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`component.mam`](./component.mam) | You want the full template: validation, transform, describe, and a documented contract table. Start here. |
| [`component-basic.mam`](./component-basic.mam) | Required fields checked before the transform, errors returned instead of raised, no mutation of the caller's input. |
| [`component-advanced.mam`](./component-advanced.mam) | Production shape: typed optional fields, a size limit, a stable error code on every outcome, a versioned contract and a degraded path. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `validate` / `transform` / `describe` | Yes | Yes | Yes |
| Contract table | Yes | Yes | Yes |
| Errors as values | Yes | Yes | Yes, structured |
| Caller input never mutated | Yes | Yes | Yes |
| Typed optional fields | No | No | Yes |
| Size limit | No | No | Yes, checked before the transform |
| Stable error code | No | No | Yes, on success and failure |
| Contract version | No | No | Yes |
| `degrade` | No | No | Yes |
| Use when | In-repo helper | A normal component | A depended-on public component |

Start with `basic` and move to `advanced` the moment a caller outside this
repository starts branching on the result. Reach for the full `component.mam`
when you want the documented version of the simple case.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

The `Contract` section appears in all three variants, between `Capabilities`
and `Rules`. The advanced variant adds `Error Codes` and
`Contract Versioning`.

## Conventions used by these templates

- **Validate before you transform.** Every run goes through `validate` first, so
  a transform can assume the contract holds.
- **Errors are values.** An invalid input produces `errors` and a `code`, never
  a raised exception crossing the component boundary.
- **The caller keeps its data.** The transform copies; it never mutates the
  input it was handed.
- **A code on every outcome.** The advanced template returns a `code` even on
  success, so a caller can log and branch on one field instead of inferring
  meaning from a combination of others.
- **Limits are checked before work, not after.** The size limit runs before the
  transform, so a slow path cannot be used to slip past it.
- **A minor version bump may only add fields.** Removing or renaming a field is
  a major bump and needs a migration; that rule is written into the template
  rather than left to the release process.

## Related

- [`../module/`](../module) — the generic type, used when nothing more specific applies
- [`../system/`](../system) — a system composed of many components
- [`../contract/`](../contract) — the interface a component's contract is written against
- [`../interface/`](../interface) — how a component is called from outside
