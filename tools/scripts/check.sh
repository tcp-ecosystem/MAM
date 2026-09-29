#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Checking MAM monorepo is clean and green..."

cd "$REPO_ROOT"

# 1. Working tree must be clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first." >&2
  git status --short >&2
  exit 1
fi

# 2. No drift from the default branch
if git rev-parse --abbrev-ref HEAD >/dev/null 2>&1 && [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Warning: not on 'main' branch (currently $(git rev-parse --abbrev-ref HEAD))." >&2
fi

# 3. Full verification
pnpm run verify

echo "Check passed: working tree clean and all checks green."