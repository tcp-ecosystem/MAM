# Runtime Templates

Templates for MAM modules of `type: runtime` — the execution engine that
prepares, runs and terminates MAM modules under declared isolation and resource
limits.

## Module type

```yaml
type: runtime
```

`runtime` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `runtime` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`runtime.mam`](./runtime.mam) | You want the full template: execution model, isolation boundaries, resource-limit table and the lifecycle state machine. Start here. |
| [`runtime-basic.mam`](./runtime-basic.mam) | One module per process, a time budget and a report. The smallest engine that still refuses to hang. |
| [`runtime-advanced.mam`](./runtime-advanced.mam) | Production shape: limit validation, permission denial, bounded retries, crash-safe termination, log tail and a health endpoint. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `execute` / `report` | Yes | Yes | Yes |
| `prepare` (permissions) | No | Yes | Yes |
| `limit` (enforcement) | Timeout only | Yes | Yes |
| `terminate` | No | Yes | Yes |
| `retry` | No | No | Yes |
| Memory ceiling | No | Yes | Yes |
| Output and log ceilings | Output only | Yes | Yes |
| Lifecycle table | No | Yes | Yes |
| Failure-handling matrix | No | No | Yes |
| Health endpoint | No | No | Yes |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when the engine runs modules it did
not write, or when a run may be retried by a caller. Reach for the full
`runtime.mam` when you want the documented single-attempt case rather than
either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Execution Model`, `Resource Limits`) appear in all
three; `Isolation`, `Lifecycle`, `Failure Handling` and `Observability` appear
in the full and advanced templates.

## Conventions used by these templates

- **The runtime owns the clock and the state machine.** Module code never reads
  a clock and never decides whether a run may continue; a run reaches exactly
  one terminal state.
- **Ceilings terminate, they do not degrade.** A run that crosses timeout,
  memory, output or log limits is stopped, never paused, truncated silently or
  downgraded — truncation of a successful result is always explicit.
- **Only declared retryable errors are retried.** A timeout is never retried,
  and retries are counted in `attempts` and `metrics.retries`.
- **Configuration is validated, not trusted.** A limit set with a zero, negative
  or non-integer value is `rejected` before the run starts rather than being
  replaced by a default.
- **Permissions are checked before execution.** An undeclared permission is
  `denied` with exit code `2`, and the run never reaches `running`.
- **Failure still reports.** Status, usage, attempt count and the bounded log
  tail come back whether the run succeeded, timed out or was terminated.

## Related

- [`../resource/`](../resource) — the state a runtime operates on
- [`../service/`](../service) — long-running processes rather than single runs
- [`../extension/`](../extension) — host-side code that a runtime may load
- [`../policy/`](../policy) — declarative constraints the runtime enforces
