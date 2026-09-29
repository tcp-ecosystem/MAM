# Run all MAM tests.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm run test } else { npm run test }