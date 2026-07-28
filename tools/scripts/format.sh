#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Formatting MAM monorepo..."

cd "$REPO_ROOT"

if command -v pnpm &>/dev/null; then
  pnpm run format
elif command -v npm &>/dev/null; then
  npm run format
else
  echo "Error: No package manager found. Install pnpm or npm." >&2
  exit 1
fi

echo "Format complete."
