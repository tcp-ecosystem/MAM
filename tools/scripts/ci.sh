#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Running CI pipeline for MAM monorepo..."

cd "$REPO_ROOT"

if ! command -v pnpm &>/dev/null; then
  echo "Error: pnpm is required for CI." >&2
  exit 1
fi

# Fresh install from the lockfile
pnpm install --frozen-lockfile

# Static checks
pnpm run typecheck
pnpm run lint

# Build everything
pnpm run build

# Run the full test suite
pnpm run test

echo "CI pipeline passed."