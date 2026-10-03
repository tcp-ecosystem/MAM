# Repository Templates

Templates for MAM modules of `type: repository` — a declared collection of
sources with a fixed layout, a ref strategy, and a digest manifest that makes
integrity checkable.

## Module type

```yaml
type: repository
```

`repository` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `repository` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`repository.mam`](./repository.mam) | You want the full template: declared roots, manifest, refs and a documented integrity model. Start here. |
| [`repository-basic.mam`](./repository-basic.mam) | One root, one ref, no branching. The smallest collection that still refuses paths outside its layout. |
| [`repository-advanced.mam`](./repository-advanced.mam) | Production shape: enforced limits, branch depth tracking, drift classified per path, and a health check. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `index` / `contribute` | Yes | Yes | Yes |
| `verify` against a manifest | Yes | Yes | Yes |
| `resolve` a named ref | No | Yes | Yes |
| Multiple refs and commits | No | Yes | Yes |
| Drift classification | Flat list | Flat list | `missing` / `modified` / `untracked` |
| Enforced limits | No | No | Yes |
| Branch depth | No | No | Bounded |
| `health` | No | No | Yes |
| `errors` recorded | No | No | Yes |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when you need limits or drift
classification. Reach for the full `repository.mam` when you want the
documented multi-ref version rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Contents`, `Layout`, `Versioning`, and in the
advanced template `Limits`) sit between `Capabilities` and `Rules`.

## Conventions used by these templates

- **A repository declares, it does not own.** The template states which paths
  belong to the collection and which root they must live under; anything else
  is refused rather than silently ignored.
- **The manifest outranks the working tree.** Integrity is decided by the
  recorded digests, so an edit that nobody snapshotted shows up as drift
  instead of being accepted.
- **Refs are opaque.** A resolve returns a commit id, never a mutable working
  tree, and a contribution never rewrites a commit id that already exists.
- **Capabilities are nouns, workflows are verbs.** `index`, `verify` and
  `contribute` say what is possible; the Mermaid diagram says when each one
  runs, and the two must agree.
- **Rules are declarative.** No rule in these templates is implemented in
  Python; the `Python` section shows the mechanism, the runtime enforces the
  constraint.
- **Advanced failures are isolated.** A refused path is recorded in `errors`
  with its cause before it is raised, so the rest of a batch still lands.

## Related

- [`../package/`](../package) — how a distributed artifact is assembled from
  sources
- [`../documentation/`](../documentation) — prose that must match the sources
  it describes
- [`../policy/`](../policy) — declarative behavioural constraints
- [`../contract/`](../contract) — interfaces other collections depend on
