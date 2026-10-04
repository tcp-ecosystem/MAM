# Contributing to MAM

Thank you for your interest in contributing to MAM (Machine Agent Modules)!

## Getting Started

1. Fork the repository
2. Clone your fork
3. Run `pnpm install` to install dependencies
4. Run `pnpm run build` to build all packages
5. Create a feature branch: `git checkout -b feat/my-feature`

### Prerequisites

- Node.js 20+ and `pnpm` 9+
- Python 3.12+ (for Python SDK and `.mam` Python blocks)
- No global installs required; everything runs from the workspace

## Workspace Layout

58 workspace packages under `pnpm-workspace.yaml`:

```text
parser/ ast/ compiler/ validator/ runtime/ cli/
plugins/api/ plugins/core/{memory,mermaid,python,yaml}/
lsp/ package-manager/ testing/ visualization/ reference/
registry/{api,server,client}/   # MAM Hub: contract, service, typed client
sdk/{javascript,typescript,python,go,rust,c,cpp,csharp,java,ruby,sql}/
modules/{examples,templates}/   # runnable examples + scaffolds
spec/ docs/ tools/
```

Packages depend on each other via `workspace:*`. Cross-package imports resolve
to `dist/` at runtime — **rebuild a dependency after changing its `src/`**
(`pnpm --filter <pkg> build`), or downstream tests will run stale code.

## Development

- `pnpm run dev` - Start all packages in development mode
- `pnpm run build` - Build all packages
- `pnpm run test` - Run all tests
- `pnpm run lint` - Lint all packages
- `pnpm run format` - Format code with Prettier

Per package:

```bash
pnpm --filter @mam/registry-server test      # one suite
pnpm --filter @mam/registry-server typecheck # no-emit check
pnpm --filter @mam/parser build              # rebuild after src changes
```

## Testing

- 7,000+ tests across 264 files; keep them green.
- Match the style of the file you are editing (read it first).
- Unit tests must be hermetic; socket tests bind port 0 and close in `afterEach`.
- **Timeouts:** server/socket suites need generous budgets
  (`--testTimeout=25000 --hookTimeout=25000`). A 5s default times out under
  scrypt + server startup and looks like a logic failure.
- **scrypt cost:** use `keyLength: 16` (or the package's `FAST` helper) in tests
  that stand up auth repeatedly. Never weaken production hashing.
- **Hanging runs:** if a suite hangs, suspect an unanswered request or an
  unclosed server before suspecting vitest. Run with `--bail=1` and bounded
  timeouts to isolate.
- A test that only passes in isolation is a test with shared state — fix the
  isolation, not the runner.

## Registry Contributions

The registry (`registry/api|server|client`) is a production service:

- `RegistryServer` handlers stay transport-free; HTTP lives in `src/http.ts`.
- The wire contract is three-way: OpenAPI + GraphQL SDL + client types. Change
  one, update all three, and extend `tests/client-integration.test.ts`.
- The GraphQL SDL is parsed by the reference implementation in tests — a regex
  check is not sufficient for schema changes.
- Security-sensitive code (auth, paths, error messages) needs negative tests:
  traversal names, expired tokens, oversized bodies, malformed JSON.

## Documentation

Docs are part of the change, not an afterthought:

- `README.md` — user-facing overview, CLI catalogue, examples, statistics
- `purpose.md` / `goal.md` / `scope.md` / `brain.md` — vision and status
- `usage.md` — complete usage guide
- `relevant-file.md` — file listing (update counts when adding packages/tests)
- Package `README.md` files — keep behavior tables and test counts current
- When you change a number (tests, commands, templates), grep the docs for the
  old one — stale counts erode trust faster than missing docs.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Scope the subject (`feat(registry): …`, `docs:`) and keep it under 72 chars.

## Pull Request Process

1. Ensure your code follows the existing style
2. Add tests for new features (including negative/security cases where relevant)
3. Update documentation if needed (see above)
4. Ensure all tests pass (`pnpm -r test`) and typechecks are clean
5. Keep PRs focused; unrelated drive-bys go in separate PRs
6. Request a review from maintainers

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.
