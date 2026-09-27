# Update — sdk/core

## Status

| Check | Result |
| --- | --- |
| `node runner/index.mjs` | PASS — 12/12 fixtures passed |
| JSON fixture inventory | PASS — 12 `.mam.md` and 12 `expected.json` files |
| Repository lint | Not run: repo-wide lint is already blocked by the missing `@typescript-eslint/eslint-plugin` |

The runner was executed after a temporary `pnpm build` of the TypeScript
reference SDK. The generated `dist` directory was removed after verification.

## Adoption

A language SDK reads `CONFORMANCE.md`, implements the named types and functions,
loads each `.mam.md` fixture, parses it, validates it, and compares the
resulting diagnostic code/severity pairs with the adjacent `expected.json`.
The runner uses the TypeScript SDK as its reference implementation; another
language can use the same fixtures without depending on Node.

## Known gaps

The reference YAML reader intentionally covers the frontmatter subset in the
contract, not arbitrary YAML. Unsupported YAML constructs should be reported
by an SDK as parse errors rather than silently accepted. The conformance
request names 19 standard section kinds plus `Custom`; this is treated as 20
total `SectionKind` variants and is recorded in `CONFORMANCE.md`.
