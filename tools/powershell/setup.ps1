# Set up the MAM development environment (Windows / PowerShell).
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

# --- Precondition checks ---
foreach ($cmd in @("node", "pnpm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "'$cmd' is not installed or not on PATH."
    exit 1
  }
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  Write-Error "Node.js >= 20 is required. Found $(node -v)."
  exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
pnpm install
if (-not $?) { exit 1 }

if (-not $SkipBuild) {
  Write-Host "Building packages..." -ForegroundColor Cyan
  pnpm run build
  if (-not $?) { exit 1 }
}

Write-Host ""
Write-Host "Development environment ready!" -ForegroundColor Green
Write-Host "  pnpm run build     - Build all packages"
Write-Host "  pnpm run test      - Run all tests"
Write-Host "  pnpm run lint      - Lint all packages"
Write-Host "  pnpm run typecheck - Type-check all packages"
Write-Host "  pnpm run format    - Format all files"
Write-Host "  tools\powershell\dev.ps1 - Start packages in dev mode"