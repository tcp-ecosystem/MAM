# Plugin Templates

Templates for MAM modules of `type: plugin` — an extension point a host loads
at runtime, with lifecycle hooks, registered extensions and interception
pointcuts.

## Module type

```yaml
type: plugin
```

`plugin` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `plugin` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`plugin.mam`](./plugin.mam) | The full template: four lifecycle hooks, an extension table, a pointcut and a documented lifecycle. Start here. |
| [`plugin-basic.mam`](./plugin-basic.mam) | Load, register one extension, activate, deactivate. The pointcut table is present but empty. |
| [`plugin-advanced.mam`](./plugin-advanced.mam) | You share a host with other plugins: ordered advice, per-extension failure isolation, config validation, limits and a health check. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `on_load` / `on_activate` / `on_deactivate` | Yes | Yes | Yes |
| `on_event` hook | No | Yes | Yes |
| `on_health` hook | No | No | Yes |
| `register` | One extension | Extension table | Priority-ordered |
| `deactivate` clears state | Yes | Yes | Yes, pointcuts included |
| `intercept` | No | Declared pointcut | Ordered advice chain with a guard |
| Per-extension failure isolation | No | Rule stated | Implemented, recorded in `errors` |
| Config validation | No | Rule stated | Enforced before the first hook |
| `health` | No | No | Yes |
| Enforced limits | No | No | Yes |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` before installing a pointcut into a
host with other plugins. Reach for the full `plugin.mam` when you want the
four-hook lifecycle documented rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

`Lifecycle`, `Extensions` and `Pointcuts` are the shared vocabulary of this
module type and appear in all three variants, between `Capabilities` and
`Rules`. The advanced template adds `Isolation` and `Limits` there.

## Conventions used by these templates

- **The same three tables in every variant.** `Lifecycle` says when a hook
  runs, `Extensions` says what the plugin contributes, `Pointcuts` says what
  host call it watches. A reader who knows one variant can read the next.
- **A pointcut is not a capability on its own.** In the full and advanced
  templates the pointcut table describes what `intercept` acts on, so the
  capability list and the table cannot drift apart.
- **Registration is scoped to state.** A plugin only touches what it
  registered; deactivation must leave nothing behind, extensions and pointcuts
  alike.
- **A failure is contained and recorded.** In the advanced template an
  extension that raises is skipped, written to `errors`, and the remaining
  extensions still run — one plugin never becomes another's outage.
- **Advice order is declared, not incidental.** Priority sorts the chain, and
  a guard runs last so advice has been recorded by the time the call proceeds.
- **Capabilities are nouns, workflows are verbs.** The Mermaid diagram follows
  the same order as the `Lifecycle` table it mirrors.

## Related

- [`../extension/`](../extension) — what a plugin contributes to a contract
- [`../runtime/`](../runtime) — the host that loads plugins and dispatches
  hooks
- [`../interface/`](../interface) — the surface a plugin most often extends
- [`../policy/`](../policy) — declarative constraints on what a plugin may do
