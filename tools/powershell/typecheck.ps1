# Type-check all MAM packages.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm run typecheck } else { npm run typecheck }