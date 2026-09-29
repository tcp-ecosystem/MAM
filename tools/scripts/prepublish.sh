#!/bin/bash
echo "Running prepublish checks..."
pnpm build
pnpm test
echo "Prepublish checks passed!"
