# Run tests, preferring a coverage script when available.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $hasCoverage = $true
  pnpm run -s coverage 2>$null
  if (-not $?) { $hasCoverage = $false }
  if ($hasCoverage) { pnpm run coverage } else { pnpm run test }
} else {
  npm run test
}