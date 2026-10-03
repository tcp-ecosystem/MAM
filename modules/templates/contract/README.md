# Contract Templates

Templates for MAM modules of `type: contract` — agreements between a provider
and its consumers, expressed as guarantees, versions and a breaking-change
policy rather than implementation.

## Module type

```yaml
type: contract
```

`contract` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `contract` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`contract.mam`](./contract.mam) | You want the full template: guarantee table, semantic-versioning policy, compatibility matrix and a breaking-change policy. Start here. |
| [`contract-basic.mam`](./contract-basic.mam) | One provider, one published major, two guarantees. The smallest contract that still refuses to bind an unknown version. |
| [`contract-advanced.mam`](./contract-advanced.mam) | Production shape: guarantee history, a deprecation window, a conformance suite that gates publication, and an audit trail of every binding. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `specify` / `guarantee` | Yes | Yes | Yes |
| `version` / `verify` | No | Yes | Yes |
| `deprecate` | No | Documented | Enforced |
| `attest` (conformance) | No | No | Yes |
| Compatibility matrix | No | Yes | Yes |
| Audit trail | No | No | Yes |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when more than one consumer is pinned
to an older major, or when a contract must be provable before it ships. Reach
for the full `contract.mam` when you want the documented version of the
single-major case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Guarantees`, `Versioning`) appear in all three;
`Compatibility`, `Breaking Changes`, `Deprecation` and `Conformance` appear in
the full and advanced templates.

## Conventions used by these templates

- **A contract makes promises, not calls.** No Python in these templates
  performs the work the contract describes; it only models, version-checks and
  binds the promise.
- **Unknown means unbound.** An unparseable or future `requested_version`
  returns `status: unbound` rather than falling back to the published version.
- **Never silently cross a major.** A consumer that pins an old major gets
  `breaking` plus the exact list of changes, and the previous major stays
  served for a declared deprecation window.
- **Guarantees are additive within a major.** Adding a guarantee is `MINOR`;
  removing or weakening one is `MAJOR` and requires a conformance pass.
- **Every binding decision is auditable.** The advanced template writes
  `{consumer, requested, status}` to `audit` on both the success and the
  failure path.
- **Rules are declarative.** They constrain the parties; no rule here is
  implemented in Python.

## Related

- [`../interface/`](../interface) — the concrete API surface a contract governs
- [`../extension/`](../extension) — extension points that carry their own contract
- [`../policy/`](../policy) — declarative constraints applied at runtime
- [`../package/`](../package) — distributing a contract to consumers
