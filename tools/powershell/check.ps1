# Ensure the working tree is clean and all checks pass.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

$status = git status --porcelain
if ($status) {
  Write-Error "Working tree is not clean. Commit or stash changes first."
  exit 1
}

pnpm run verify
Write-Host "Check passed: working tree clean and all checks green."