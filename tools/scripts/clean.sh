#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Cleaning MAM monorepo build artifacts..."

cd "$REPO_ROOT"

# Workspace clean scripts (rm -rf dist)
pnpm run clean 2>/dev/null || true

# Remove aggregate artifacts
rm -rf dist .turbo .mam-cache

# Remove all tsbuildinfo files
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete 2>/dev/null || true

echo "Clean complete."