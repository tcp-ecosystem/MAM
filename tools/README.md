# MAM Tools

Repo-level developer tooling: build scripts, dev-environment helpers, Docker
images and CI automation for the MAM monorepo.

## Layout

```
tools/
├── dev/         environment setup/teardown
├── scripts/     bash scripts (cross-platform CI / Linux / macOS / Git Bash)
├── powershell/  PowerShell equivalents (Windows / PowerShell 5.1+)
└── docker/      production + dev Dockerfiles and docker-compose
```

## Quick start

```bash
# One-time setup (installs deps + builds)
./tools/dev/setup.sh                 # bash
.\tools\powershell\setup.ps1         # PowerShell (Windows)

# Day to day
./tools/scripts/verify.sh            # typecheck + lint + build + test
./tools/scripts/build.sh
./tools/scripts/test.sh
./tools/scripts/lint.sh
./tools/scripts/typecheck.sh
./tools/scripts/format.sh
```

## dev/

| Script        | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `setup.sh`    | check prerequisites (Node >= 20, pnpm), install deps, build all packages |
| `teardown.sh` | clean `dist`, remove `node_modules`, `.turbo` and `*.tsbuildinfo`        |

## scripts/

| Script                             | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `build.sh`                         | build all packages (`pnpm -r build`)                          |
| `test.sh`                          | run all tests                                                 |
| `lint.sh`                          | lint all packages                                             |
| `typecheck.sh`                     | type-check all packages (`pnpm -r --if-present typecheck`)    |
| `format.sh`                        | format the repo with Prettier                                 |
| `verify.sh`                        | full gate: typecheck + lint + build + test                    |
| `coverage.sh`                      | run tests, preferring a `coverage` script when present        |
| `clean.sh`                         | remove `dist`, `.turbo`, `.mam-cache`, `*.tsbuildinfo`        |
| `dev.sh`                           | start all packages in dev mode (parallel, best-effort)        |
| `check.sh`                         | assert a clean working tree, then run `verify`                |
| `ci.sh`                            | CI pipeline: frozen install + typecheck + lint + build + test |
| `publish.sh`                       | publish packages with changesets (requires `main`)            |
| `release.sh`                       | version + tag + push a release                                |
| `prepublish.sh` / `postpublish.sh` | pre/post publish hooks (moved from the root `scripts/`)       |

## powershell/

Same surface as `scripts/`, provided as `.ps1` files for Windows:
`setup.ps1`, `teardown.ps1`, `build.ps1`, `test.ps1`, `lint.ps1`,
`typecheck.ps1`, `format.ps1`, `verify.ps1`, `coverage.ps1`, `clean.ps1`,
`dev.ps1`, `check.ps1`, `ci.ps1`, `publish.ps1`, `release.ps1`,
`prepublish.ps1`, `postpublish.ps1`.

## docker/

- **`Dockerfile`** — production multi-stage image. The whole repo is the build
  context (`.dockerignore` keeps `node_modules`, `dist`, `.git` etc. out of the
  copy); the runner ships every package's `dist/` and runs the CLI.
- **`Dockerfile.dev`** — dev image with a full install, `CMD pnpm run dev`.
- **`docker-compose.yml`** — compose services for `cli`, `mcp` and `runtime`
  dev servers with live source mounts.

```bash
docker compose -f tools/docker/docker-compose.yml up
```

## Notes

- The monorepo root scripts (`package.json`) are the source of truth:
  `build`, `test`, `lint`, `typecheck`, `format`, `clean`, `verify`,
  `changeset`, `version-packages`, `release`.
- `.prettierignore` and `.dockerignore` at the repo root keep Prettier and the
  Docker build contexts focused on source only.
