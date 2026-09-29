# Create a release: build + test + version via changesets + tag + push.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required for releases."
  exit 1
}

pnpm run build
pnpm run test
pnpm changeset version

git add -A
git commit -m "chore: version packages" 2>$null

$newVersion = node -p "require('./package.json').version"
git tag "v${newVersion}" 2>$null

git push origin main --tags
Write-Host "Release v${newVersion} created."