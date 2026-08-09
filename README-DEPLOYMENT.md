# AbaYa Track - Deployment Guide

## Quick Start

### 1. Build the Installer (One-Click)

On your development machine:

```batch
install\BUILD-AND-PUBLISH.bat
```

This will:
- Install all dependencies
- Build the Windows installer EXE
- Publish update files to LAN mirror
- Verify the build output

### 2. Deploy to Factory Server (192.168.0.101)

1. Copy `dist/desktop-launcher/AbaYa-Track-Launcher-Setup-<version>.exe` to the factory server
2. Run the installer on the factory server
3. The server will start automatically on `http://192.168.0.101:3111`

### 3. Connect Tablets

Tablets should connect to:
```
http://192.168.0.101:3111/kiosk.html
```

### 4. Desktop Launcher Auto-Updates

The desktop launcher will:
- First run: Install from the EXE
- Subsequent runs: Check LAN mirror for updates automatically
- Fallback: Use GitHub if LAN mirror is unavailable

---

## Configuration (.env)

Before building, ensure `.env` has these values:

```bash
# Server binding
HOST=0.0.0.0
PORT=3111
LAN_IP=192.168.0.101

# Socket.IO tuning (factory Wi-Fi jitter tolerance)
SOCKET_PING_INTERVAL_MS=25000
SOCKET_PING_TIMEOUT_MS=60000

# TCP keep-alive (prevents Android Chrome connection drops)
SERVER_KEEP_ALIVE_TIMEOUT_MS=120000
SERVER_HEADERS_TIMEOUT_MS=130000

# LAN update mirror for auto-updates
ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111

# Optional: GitHub token for fallback updates
GH_TOKEN=your_github_token_here
GITHUB_TOKEN=your_github_token_here
```

---

## Troubleshooting

### Dashboard Not Loading

1. Check server health: `http://192.168.0.101:3111/api/health`
2. Verify firewall allows port 3111
3. Check browser console for errors
4. Ensure server is running: `http://192.168.0.101:3111/api/server-info`

### Electron Launcher Token Authentication Error

**This is normal if GH_TOKEN is not set.** The launcher:
1. First tries LAN mirror (preferred, works without token)
2. Falls back to GitHub only if LAN fails

To fix the error message:
1. Generate a token at https://github.com/settings/tokens (no scopes needed for public repos)
2. Add to `.env`: `GH_TOKEN=your_token`

### LAN Mirror Empty After Build

1. Ensure `dist/desktop-launcher` contains `.exe` and `latest.yml` files
2. Re-run: `npm run package:installer:win`
3. Then publish: `npm run publish:lan-mirror -- --channel stable`

### Tablets Can't Connect

1. Verify `HOST=0.0.0.0` in `.env` (NOT `127.0.0.1`)
2. Check Windows Firewall allows port 3111
3. Run: `install\ENSURE-LAN-FIREWALL.ps1`
4. Test connectivity: `http://192.168.0.101:3111/api/connectivity-diagnostics`

---

## Diagnostic Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/server-info` | Server configuration and IPs |
| `GET /api/connectivity-diagnostics` | Full connectivity diagnostic |
| `POST /api/tablet-ping` | Tablet latency test |
| `GET /api/debug-kiosk` | Kiosk state debug info |
| `GET /api/kiosk/state` | Real-time kiosk state |

---

## Manual Commands

```batch
# Build installer only
npm run package:installer:win

# Build portable version
npm run package:portable:win

# Publish to LAN mirror
npm run publish:lan-mirror -- --channel stable

# Start server manually
node server.js

# Or use PM2 via launch script
install\LAUNCH-ALL.bat

# Check PM2 status
npm run pm2:status

# Open CEO dashboard
install\OPEN-CEO-DASHBOARD.bat
```

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Tablets   │────▶│ Factory Server   │────▶│ Cloudflare   │
│  (Wi-Fi)    │     │ 192.168.0.101:3111│     │   (Optional) │
└─────────────┘     └──────────────────┘     └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Desktop      │
                    │ Launcher     │
                    │ (Auto-update)│
                    └──────────────┘
```

### Update Flow

1. **LAN Mirror (Primary)**: Desktop launcher checks `http://192.168.0.101:3111/updates/stable/latest.yml`
2. **GitHub (Fallback)**: If LAN fails, checks GitHub releases (requires token for rate limit bypass)

---

## Support

Contact: Mohammad Abir Abbas
