#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Creating release for MAM monorepo..."

cd "$REPO_ROOT"

if ! command -v pnpm &>/dev/null; then
  echo "Error: pnpm is required for releases." >&2
  exit 1
fi

# Build and test
pnpm run build
pnpm run test

# Version packages via changesets
pnpm changeset version

# Commit version bump
git add -A
git commit -m "chore: version packages" || echo "Nothing to commit"

# Tag the release
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
NEW_VERSION=$(node -p "require('./package.json').version")
git tag "v${NEW_VERSION}" || echo "Tag v${NEW_VERSION} already exists"

# Push
git push origin main --tags

echo "Release v${NEW_VERSION} created."
