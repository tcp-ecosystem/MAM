# Clean build artifacts across the monorepo.
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

pnpm run clean 2>$null

foreach ($t in @("dist", ".turbo", ".mam-cache")) {
  if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force }
}

Get-ChildItem -Path . -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "node_modules" } |
  Remove-Item -Force

Write-Host "Clean complete."