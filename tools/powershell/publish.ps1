# Publish MAM packages with changesets (requires main + clean tree).
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required for publishing."
  exit 1
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
  Write-Error "Must be on 'main' branch to publish. Currently on '$branch'."
  exit 1
}

git pull --rebase origin main
pnpm run build
pnpm run test
pnpm changeset publish
Write-Host "Publish complete."