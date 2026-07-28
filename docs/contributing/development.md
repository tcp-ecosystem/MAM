# Development Guide

> **Setting up the MAM development environment.**

---

## Overview

This guide covers setting up the MAM development environment, understanding the monorepo structure, and working with the codebase.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Runtime |
| pnpm | 8+ | Package manager |
| Git | 2.30+ | Version control |
| TypeScript | 5+ | Language |
| Vitest | Latest | Testing |

---

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/lifejiggy/mam.git
cd mam
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build All Packages

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

### 5. Start Development

```bash
pnpm dev
```

---

## Monorepo Structure

MAM uses pnpm workspaces with Turborepo:

```
mam/
├── packages/
│   ├── spec/           # @mam/spec
│   ├── parser/         # @mam/parser
│   ├── ast/            # @mam/ast
│   ├── validator/      # @mam/validator
│   ├── runtime/        # @mam/runtime
│   ├── compiler/       # @mam/compiler
│   ├── cli/            # @mam/cli
│   ├── plugins/        # @mam/plugins
│   ├── lsp/            # @mam/lsp
│   ├── sdk/            # @mam/sdk
│   └── registry/       # @mam/registry
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## Package Dependencies

```
spec
  ↓
parser
  ↓
ast
  ↓
validator
  ↓
runtime
  ↓
compiler
  ↓
cli, plugins, lsp, sdk, registry
```

---

## Development Commands

### Build

```bash
# Build all
pnpm build

# Build specific package
pnpm build --filter @mam/parser

# Watch mode
pnpm dev
```

### Test

```bash
# Test all
pnpm test

# Test specific package
pnpm test --filter @mam/parser

# Test with coverage
pnpm test:coverage
```

### Lint

```bash
# Lint all
pnpm lint

# Lint specific package
pnpm lint --filter @mam/parser

# Fix issues
pnpm lint:fix
```

### Format

```bash
# Format all
pnpm format

# Check formatting
pnpm format:check
```

---

## Working with Packages

### Parser Package

```bash
cd packages/parser
pnpm test
pnpm build
```

### AST Package

```bash
cd packages/ast
pnpm test
pnpm build
```

### Adding a New Package

1. Create directory in `packages/`
2. Add `package.json`
3. Add `tsconfig.json`
4. Add to `pnpm-workspace.yaml`
5. Add to `turbo.json`

---

## IDE Setup

### VS Code

Recommended extensions:
- TypeScript
- ESLint
- Prettier
- Vitest

Settings are in `.vscode/settings.json`.

### JetBrains

Import settings from `.idea/` directory.

---

## Git Workflow

### Branches

- `main` — Stable releases
- `develop` — Development branch
- `feature/*` — Feature branches
- `fix/*` — Bug fix branches

### Commits

Follow conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
test: add tests
refactor: refactor code
```

---

## Debugging

### VS Code

Launch configurations in `.vscode/launch.json`:

- Run CLI
- Run Tests
- Debug Parser

### Node Inspector

```bash
node --inspect node_modules/.bin/turbo dev
```

---

## Performance

### Benchmarks

```bash
pnpm bench
```

### Profiling

```bash
node --prof node_modules/.bin/turbo build
```

---

## References

- [Contributing](./getting-started.md)
- [Testing](./testing.md)
- [Release](./release.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
