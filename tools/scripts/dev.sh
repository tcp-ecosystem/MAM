#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Starting MAM packages in dev mode..."

cd "$REPO_ROOT"

if command -v pnpm &>/dev/null; then
  pnpm -r --if-present --parallel dev
elif command -v npm &>/dev/null; then
  npm -r --if-present --parallel run dev
else
  echo "Error: No package manager found. Install pnpm or npm." >&2
  exit 1
fi