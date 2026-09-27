# MAM TypeScript SDK

`@mam/sdk-typescript` is the idiomatic ESM TypeScript implementation of the
MAM SDK contract. It parses Markdown as Module files, validates them, executes
configured code blocks, and includes the six SDK support modules.

## Quick start

```ts
import { parseFile, validate, userAgent } from '@mam/sdk-typescript';

const module = await parseFile('agent.mam.md');
const report = validate(module);
console.log(userAgent(), report.is_valid);
```

The package uses explicit `.js` suffixes for relative ESM imports. The parser
supports the frontmatter scalar, inline-list, and block-list forms used by the
MAM contract. Unknown section titles are preserved as `Custom` sections.

## Layout

`mam/ast.ts` defines the shared data model, `mam/parser.ts` handles files and
strings, and `mam/validator.ts`, `mam/runtime.ts`, and `mam/plugins.ts` provide
the execution surface. The `config`, `cache`, `format`, `graph`, `template`,
and `doctor` modules mirror the support modules in the Go SDK.

## Verification

The package has no runtime dependencies. Tests use Vitest as a development
dependency. The repository-wide JavaScript SDK checks and this package's type
check and test command are recorded in `update.md`; the repo-wide lint command
is intentionally not added because the existing ESLint installation is
missing its TypeScript plugin.
