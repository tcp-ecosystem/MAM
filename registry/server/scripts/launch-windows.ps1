# MAM Hub Windows launcher — double-click or Startup-folder autostart.
#
# Starts the registry (requires $env:MAM_ADMIN_PASSWORD to be set for this
# user — set it once via [Environment]::SetEnvironmentVariable, or keep the
# line below pointed at your password manager CLI) and then the Cloudflare
# quick tunnel. Keep this window open; closing it stops both.
#
# First run once (remembers the password for future logins):
#   [Environment]::SetEnvironmentVariable("MAM_ADMIN_PASSWORD", "<paste>", "User")
#   [Environment]::SetEnvironmentVariable("MAM_DATA_DIR", "$HOME\mam-data", "User")

$ErrorActionPreference = 'Stop'

$BundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundleDir = Split-Path -Parent $BundleDir   # scripts/ -> server/
Set-Location $BundleDir

if (-not $env:MAM_ADMIN_PASSWORD) {
  Write-Error "MAM_ADMIN_PASSWORD is not set. Set it once (see header), then re-run."
  exit 1
}
$env:MAM_DATA_DIR = if ($env:MAM_DATA_DIR) { $env:MAM_DATA_DIR } else { "$HOME\mam-data" }
$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:HOST = "127.0.0.1"

Write-Host "Starting MAM Hub from $BundleDir ..."
$server = Start-Process node -ArgumentList "launcher.mjs" -NoNewWindow -PassThru
Start-Sleep 6

try {
  $h = Invoke-RestMethod http://127.0.0.1:$env:PORT/healthz -TimeoutSec 10
  Write-Host ("Registry ok (uptime {0}s), data at {1}" -f $h.uptime, $env:MAM_DATA_DIR)
} catch {
  Write-Error "Registry did not answer /healthz. Check the server output above."
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "Starting Cloudflare quick tunnel (public URL below — leave open) ..."
& cloudflared tunnel --url ("http://127.0.0.1:" + $env:PORT)
