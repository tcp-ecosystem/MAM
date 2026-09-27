# sdk/typescript — Update

## Status

| Check | Result |
| --- | --- |
| `pnpm typecheck` (`tsc --noEmit`) | PASS |
| `pnpm test` | PASS — 3 files, 29 tests |
| `pnpm build` | PASS — used temporarily for the conformance runner |
| `pnpm --filter @mam/sdk-javascript typecheck` | PASS |
| `pnpm --filter @mam/sdk-javascript test` | PASS — 10 files, 196 tests |
| Repository lint | Not run: repo-wide lint is already blocked by the missing `@typescript-eslint/eslint-plugin` |

## Design notes

The package has no runtime dependencies. Frontmatter parsing is implemented as
a small scalar/list reader so malformed values can be reported as validation
diagnostics rather than escaping as library exceptions. The canonical section
list contains the 19 named standard kinds in the request plus `Custom`, giving
20 `SectionKind` variants; this is also the list implemented by Go.

The source files are all at least 300 lines. The three test files contain
9, 10, and 10 `it` cases respectively. `pnpm install` was run only from this
package; it did not change `pnpm-lock.yaml` or any protected package file.

## Known gaps

The parser intentionally supports the common YAML subset rather than all YAML
constructs. The runtime uses the host `node` executable for JavaScript and
returns a failed result for unsupported languages; it does not install or
locate language toolchains. The generated `dist` directory used for the core
runner was removed after verification.
