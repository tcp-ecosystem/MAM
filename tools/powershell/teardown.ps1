# Tear down the MAM development environment (Windows / PowerShell).
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

Write-Host "Tearing down MAM development environment..." -ForegroundColor Yellow

# Clean dist directories
pnpm run clean 2>$null

# Remove node_modules and aggregate artifacts
$targets = @(
  "node_modules",
  ".turbo",
  ".mam-cache",
  "dist"
)
foreach ($t in $targets) {
  if (Test-Path -LiteralPath $t) {
    Write-Host "Removing $t..."
    Remove-Item -LiteralPath $t -Recurse -Force
  }
}

# Remove all tsbuildinfo files (excluding node_modules)
Get-ChildItem -Path . -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "node_modules" } |
  Remove-Item -Force

Write-Host "Development environment torn down." -ForegroundColor Green