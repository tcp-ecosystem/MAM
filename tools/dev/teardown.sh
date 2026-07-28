#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Tearing down MAM development environment..."

cd "$REPO_ROOT"

# Clean dist directories
echo "Cleaning dist directories..."
pnpm run clean 2>/dev/null || true

# Remove node_modules
echo "Removing node_modules..."
rm -rf node_modules

# Remove turbo cache
echo "Removing turbo cache..."
rm -rf .turbo

# Remove tsbuildinfo files
echo "Removing tsbuildinfo files..."
find . -name "*.tsbuildinfo" -delete 2>/dev/null || true

echo "Development environment torn down."
