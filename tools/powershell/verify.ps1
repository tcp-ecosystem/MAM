# Full verification: typecheck + lint + build + test.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm run verify } else { npm run verify }