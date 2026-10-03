# Documentation Templates

Templates for MAM modules of `type: documentation` — prose published as a
module, with a declared audience, a fixed page structure, named owners, and a
publish gate that refuses anything unreviewed or stale.

## Module type

```yaml
type: documentation
```

`documentation` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The
compiler's `checkModuleType` rejects a module whose `type` is not on that
list, so the value must stay `documentation` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`documentation.mam`](./documentation.mam) | You want the full template: audience table, required sections, page ownership and a review gate. Start here. |
| [`documentation-basic.mam`](./documentation-basic.mam) | One audience, one required pair of sections, no review step. The smallest doc set that still has a publish gate. |
| [`documentation-advanced.mam`](./documentation-advanced.mam) | Production shape: staleness measured against the module a page describes, link checking, a health report and enforced limits. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| Declared outline | Yes | Yes | Yes |
| `draft` / `publish` | Yes | Yes | Yes |
| Audience table | One row | Three rows | Four rows |
| Section completeness check | Purpose, Usage | Four required | Four required, six declared |
| `review` sign-off | No | Yes | Yes |
| Per-page owner | No | Yes | Yes |
| Internal link checking | No | No | Yes |
| Staleness vs. module change | No | No | Yes |
| `health` | No | No | Yes |
| Enforced limits | No | No | Yes |
| Link-checker dependency | No | No | Yes |

Start with `basic` and move to `advanced` when pages must stay in step with the
modules they describe. Reach for the full `documentation.mam` when you want
owners and a reviewer but not automatic staleness.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Audience`, `Structure`, `Ownership`, and in the
advanced template `Freshness` and `Limits`) sit between `Capabilities` and
`Rules`.

## Conventions used by these templates

- **Markdown is the source of truth.** Rendered output is a projection and is
  never edited by hand; a fix that only exists in the render is lost on the
  next publish.
- **The outline is declared once.** A required section missing from a page is
  a publish failure, not a style note.
- **Publishing is a gate, not a step.** A page is rendered only when it is
  complete, reviewed and, in the advanced template, fresh.
- **Freshness is measured against the module.** Age alone is not enough — a
  page that has not been edited while its module changed is already wrong.
- **Capabilities are nouns, workflows are verbs.** `draft`, `review` and
  `publish` say what is possible; the Mermaid diagram says the order, and the
  two must agree.
- **Every page has a name on it.** `owner` and `reviewer` are first-class
  fields, so "nobody is responsible" is not representable.

## Related

- [`../repository/`](../repository) — the sources these pages describe
- [`../interface/`](../interface) — the contract an integrator reads first
- [`../policy/`](../policy) — declarative constraints a page documents
- [`../extension/`](../extension) — where a doc generator hooks in
