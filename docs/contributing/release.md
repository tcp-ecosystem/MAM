# Release Guide

> **Process for releasing new MAM versions.**

---

## Overview

MAM uses Changesets for version management and changelog generation.

---

## Release Process

### 1. Create Changeset

```bash
pnpm changeset
```

Follow prompts to describe changes.

### 2. Version Packages

```bash
pnpm changeset version
```

This updates versions and generates changelogs.

### 3. Build

```bash
pnpm build
```

### 4. Test

```bash
pnpm test
```

### 5. Publish

```bash
pnpm changeset publish
```

### 6. Push Tags

```bash
git push --follow-tags
```

---

## Changeset Types

| Type | Description | Version Bump |
|------|-------------|--------------|
| `patch` | Bug fixes | 0.0.x |
| `minor` | New features | 0.x.0 |
| `major` | Breaking changes | x.0.0 |

---

## Creating Changesets

### Interactive

```bash
pnpm changeset
```

### Manual

Create `.changeset/<name>.md`:

```markdown
---
"@mam/parser": minor
"@mam/ast": patch
---

Added new section type support.
```

---

## Version Strategy

### Current Versions

| Package | Version |
|---------|---------|
| @mam/spec | 1.0.0 |
| @mam/parser | 1.0.0 |
| @mam/ast | 1.0.0 |
| @mam/validator | 1.0.0 |
| @mam/runtime | 1.0.0 |
| @mam/compiler | 1.0.0 |
| @mam/cli | 1.0.0 |
| @mam/plugins | 1.0.0 |
| @mam/lsp | 1.0.0 |

### Versioning Rules

1. **Patch** — Bug fixes, documentation updates
2. **Minor** — New features, backward compatible
3. **Major** — Breaking changes

---

## Changelog

Changelogs are auto-generated from changesets.

### Example

```markdown
# @mam/parser

## 1.1.0

### Minor Changes

- Added new section type support

### Patch Changes

- Fixed parser error recovery
```

---

## CI/CD

### GitHub Actions

Releases are automated via GitHub Actions:

1. PR merged to `main`
2. Changesets bot creates version PR
3. Merge version PR
4. Packages published automatically

### Manual Release

```bash
# On main branch
pnpm changeset version
git add .
git commit -m "chore: version packages"
git push
pnpm changeset publish
```

---

## Pre-release

### Alpha

```bash
pnpm changeset pre enter alpha
pnpm changeset version
```

### Beta

```bash
pnpm changeset pre enter beta
pnpm changeset version
```

### Exit Pre-release

```bash
pnpm changeset pre exit
```

---

## Troubleshooting

### Version Conflict

```bash
pnpm changeset version --ignore
```

### Publish Error

```bash
# Check npm auth
npm whoami

# Login if needed
npm login
```

### Tag Already Exists

```bash
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
```

---

## References

- [Contributing](./getting-started.md)
- [Development](./development.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
