#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Formatting MAM monorepo..."

cd "$REPO_ROOT"

if command -v pnpm &>/dev/null && pnpm run -s format >/dev/null 2>&1; then
  pnpm run format
elif command -v npx &>/dev/null; then
  npx prettier --write .
else
  echo "Error: prettier not found. Run 'pnpm install' first." >&2
  exit 1
fi

echo "Format complete."