#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Publishing MAM packages..."

cd "$REPO_ROOT"

if ! command -v pnpm &>/dev/null; then
  echo "Error: pnpm is required for publishing." >&2
  exit 1
fi

# Ensure we are on main and up to date
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Must be on 'main' branch to publish. Currently on '$CURRENT_BRANCH'." >&2
  exit 1
fi

git pull --rebase origin main

# Build first
pnpm run build

# Run tests
pnpm run test

# Publish with changesets
pnpm changeset publish

echo "Publish complete."
