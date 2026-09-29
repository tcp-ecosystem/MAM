# Run prepublish checks: build + test.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
Write-Host "Running prepublish checks..."
pnpm run build
pnpm run test
Write-Host "Prepublish checks passed!"