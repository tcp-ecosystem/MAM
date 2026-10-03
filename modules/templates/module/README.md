# Module Templates

Templates for MAM modules of `type: module` — the generic type, used when
nothing more specific applies. A module declares what it consumes, what it
produces, and the constraints its callers must respect.

## Module type

```yaml
type: module
```

`module` is the default type and the first entry in `VALID_MODULE_TYPES`
(`@mam/ast`). The compiler's `checkModuleType` rejects any type not on that
list, so the value must stay `module` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`module.mam`](./module.mam) | You want the canonical full template: validation, status reporting, tests and examples, in the order the spec sets out. Start here. |
| [`module-basic.mam`](./module-basic.mam) | A pure single-function transform with no state and no I/O. The smallest module worth shipping. |
| [`module-advanced.mam`](./module-advanced.mam) | A module other people will call: schema validation, a stable error taxonomy, size limits and timing. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| Input validation | None | Single field | Schema plus limits |
| Error handling | Raises | `status: error` | Stable error codes |
| Size limits | No | No | Yes |
| Timing reported | No | No | Yes |
| I/O | None | None | None |
| Use when | Internal helper | A normal module | A public, depended-on module |

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

## Conventions used by these templates

- **Pure by default.** None of these three variants touch the filesystem,
  network or environment. A module that needs I/O should declare the
  corresponding permission and say so in `Purpose`.
- **Purity means determinism.** The same input always produces the same output,
  which is what makes a module safe to retry and easy to test.
- **A module never raises to the caller.** Failures come back in the result as
  a `status` and a `code`. The advanced variant makes the code stable so callers
  can branch on it.
- **Errors are values, not exceptions.** `status: error` with an empty `result`
  is easier to compose than a raised exception crossing a module boundary.
- **Validate before you work.** The advanced template rejects oversized input
  before transforming it, so a limit cannot be bypassed by a slow path.
- **The Mermaid diagram is a view of the module.** It must match the prose and
  the Python, not become a second source of truth.

## Related

- [`../agent/`](../agent) — an AI agent with a role and goals
- [`../tool/`](../tool) — an executable tool with a narrower contract
- [`../component/`](../component) — a part of a larger system
- [`../system/`](../system) — a system composed of many modules
