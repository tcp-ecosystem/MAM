# Extension Templates

Templates for MAM modules of `type: extension` — places in a host system where
behaviour can be added without editing the host, with a hook contract that
contributions must satisfy.

## Module type

```yaml
type: extension
```

`extension` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `extension` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`extension.mam`](./extension.mam) | You want the full template: extension-point table, hook contract, discovery sources and a host compatibility matrix. Start here. |
| [`extension-basic.mam`](./extension-basic.mam) | One hook, one contributor, no ordering. The smallest extension point that still validates before registering. |
| [`extension-advanced.mam`](./extension-advanced.mam) | Production shape: quotas, error quarantine, deprecation warnings, an ordering guarantee and a health/metrics endpoint. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `declare` / `register` | Yes | Yes | Yes |
| `discover` / `invoke` | No | Yes | Yes |
| `verify` (host API check) | No | Yes | Yes |
| `quarantine` | No | No | Yes |
| Many contributors per hook | No | Yes | Yes |
| Priority ordering | No | Yes | Yes |
| Per-extension quota | No | No | Yes |
| Deprecation warning | No | Documented | Enforced |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when more than one party contributes
to the same hook, or when a bad contribution must not be able to take the host
down. Reach for the full `extension.mam` when you want the documented
single-owner case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Extension Point`, `Hook Contract`) appear in all
three; `Discovery`, `Compatibility`, `Quotas and Quarantine`, `Deprecation` and
`Observability` appear in the full and advanced templates.

## Conventions used by these templates

- **The hook contract is a promise about the call, not the internals.** The
  host guarantees the payload shape and never mutates it; the contribution
  guarantees to return a value of the same type it received.
- **Validate before you call.** A contribution that fails the contract check is
  rejected with a `reason`; a contribution that raises at call time is recorded
  in `errors` and the chain continues to the next one.
- **Order is a contract.** Contributions sort by descending `priority` then
  ascending `name`, so invocation order is identical on every host regardless
  of discovery order.
- **Host compatibility is a major-version match.** A `host_api` that differs in
  major is rejected, never coerced or downgraded.
- **Quarantine is not unregistration.** A failing extension keeps its registry
  entry so it can be inspected and re-enabled without restarting the host.
- **Rules are declarative.** They constrain host and contribution; no rule here
  is implemented in Python.

## Related

- [`../plugin/`](../plugin) — packaged contributions that plug into a host
- [`../contract/`](../contract) — the agreement an extension point publishes
- [`../interface/`](../interface) — the API surface a host exposes
- [`../runtime/`](../runtime) — the engine that isolates running extensions
