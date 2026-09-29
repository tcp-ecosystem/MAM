#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Running verification for MAM monorepo (typecheck + lint + build + test)..."

cd "$REPO_ROOT"

if command -v pnpm &>/dev/null; then
  pnpm run verify
elif command -v npm &>/dev/null; then
  npm run verify
else
  echo "Error: No package manager found. Install pnpm or npm." >&2
  exit 1
fi

echo "Verification passed."