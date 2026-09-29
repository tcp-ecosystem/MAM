# Start MAM packages in dev mode (parallel, best-effort).
$ErrorActionPreference = "Continue"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
pnpm -r --if-present --parallel dev