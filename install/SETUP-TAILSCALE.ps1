# AbaYa Track — Tailscale Setup (run as Administrator)
# Installs Tailscale, logs in via SSO, and exposes port 3000 on the mesh.

$ErrorActionPreference = 'Stop'

$port = if ($env:PORT) { $env:PORT } else { '3000' }

# Check if Tailscale is already installed
$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts) {
    Write-Host '[1/4] Installing Tailscale via winget...'
    winget install --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
    $env:PATH = "$env:PATH;$env:ProgramFiles\Tailscale"
    $ts = Get-Command tailscale -ErrorAction SilentlyContinue
    if (-not $ts) {
        Write-Host 'ERROR: Tailscale not found after install. Restart PowerShell and try again.'
        exit 1
    }
} else {
    Write-Host '[1/4] Tailscale already installed.'
}

Write-Host '[2/4] Logging in (browser will open for SSO)...'
tailscale up

Write-Host "[3/4] Exposing port $port with auto-TLS on Tailscale mesh..."
tailscale serve --bg $port

Write-Host '[4/4] Done. Your Tailscale address:'
$ip = tailscale ip -4
Write-Host "  Tailscale IP: $ip"
Write-Host "  Dashboard:    http://${ip}:${port}/dashboard.html"
Write-Host "  Kiosk:        http://${ip}:${port}/kiosk.html"
Write-Host ''
Write-Host 'Next: install Tailscale on your office laptop with the same account.'
Write-Host 'Guide: docs\TAILSCALE_HYBRID.md'
