#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Running tests with coverage for MAM monorepo..."

cd "$REPO_ROOT"

# Run every package's test script; those that support coverage via a
# `coverage` script are preferred, otherwise fall back to plain tests.
if command -v pnpm &>/dev/null; then
  if pnpm run -s coverage >/dev/null 2>&1; then
    pnpm run coverage
  else
    pnpm -r run test
  fi
elif command -v npm &>/dev/null; then
  npm run test
else
  echo "Error: No package manager found. Install pnpm or npm." >&2
  exit 1
fi

echo "Coverage run complete."