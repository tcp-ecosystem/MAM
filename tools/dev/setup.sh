#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Setting up MAM development environment..."

cd "$REPO_ROOT"

# Check for required tools
for cmd in node pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' is not installed." >&2
    exit 1
  fi
done

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js >= 20 is required. Found v$(node -v)." >&2
  exit 1
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Build all packages
echo "Building packages..."
pnpm run build

echo ""
echo "Development environment ready!"
echo "  pnpm run dev       - Start all packages in dev mode"
echo "  pnpm run build     - Build all packages"
echo "  pnpm run test      - Run all tests"
echo "  pnpm run lint      - Lint all packages"
echo "  pnpm run format    - Format all files"
