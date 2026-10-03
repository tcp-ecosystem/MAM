# Policy Templates

Templates for MAM modules of `type: policy` — declarative allow and deny
constraints evaluated before execution, with every decision recorded.

## Module type

```yaml
type: policy
```

`policy` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `policy` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`policy.mam`](./policy.mam) | You want the full template: allow list, deny list, permission scopes and the documented evaluation order. Start here. |
| [`policy-basic.mam`](./policy-basic.mam) | A flat allow list and deny list with a default deny. The smallest policy that actually decides. |
| [`policy-advanced.mam`](./policy-advanced.mam) | Production shape: scoped rules, wildcards, an `enforce` that raises, and decisions that name the rule that produced them. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| Allow and deny lists | Yes | Yes | Yes |
| Deny beats allow | Yes | Yes | Yes |
| Default deny | Yes | Yes | Yes |
| Audit log | Yes | Yes | Yes, with the rule name |
| Scoped rules | No | No | Yes |
| Wildcard rules | No | No | Yes |
| `enforce` returns | boolean | boolean | raises `PolicyViolation` |
| `explain` | No | No | Yes |
| Use when | One environment | A normal policy | Shared rules across namespaces |

Start with `basic` and move to `advanced` when the same verb has to be allowed
in one namespace and denied in another, or when a blocked call has to be
explainable to the caller.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Type-specific sections `Allow` and `Deny` appear in all three variants, between
`Capabilities` and `Rules`. The advanced variant adds `Scopes` and
`Evaluation Order`.

## Conventions used by these templates

- **Deny is evaluated first and wins outright.** Including over a wildcard
  allow, so `allow: ["*"]` can never re-permit an action on the deny list.
- **Unmatched is denied.** There is no implicit allow. A request that matches no
  rule is a deny with the reason `denied by default`.
- **A decision is data, not an exception.** `evaluate` returns a decision
  object; only `enforce` raises, and only in the advanced variant, so a
  caller can decide whether a block is fatal.
- **Every decision names a reason.** A `false` verdict a caller cannot explain
  is a bug report waiting to happen.
- **The audit log is append only.** Decisions are never rewritten, so the log is
  usable as evidence after the fact.
- **A scoped rule only matches inside its scope.** `write` denies
  `filesystem.write` and says nothing about `shell.write`; the scope is part of
  the rule, not part of the action name.

## Related

- [`../resource/`](../resource) — declarative constraints checked before a change is applied
- [`../service/`](../service) — a long-running process that policies guard
- [`../team/`](../team) — the members a policy applies to
- [`../contract/`](../contract) — the interfaces a policy is written against
