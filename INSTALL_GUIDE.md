# AbaYa Track — Complete Installation Guide

**One-page reference for installing on any Windows laptop/tablet**

---

## Quick Start (5 minutes)

### For Factory PC (production)

1. **Install Node.js 18+ LTS** from https://nodejs.org
2. **Unzip** the release ZIP to `C:\AbaYa-Track`
3. **Run** `install\INSTALL.bat` once (creates shortcuts, installs deps)
4. **Edit** `.env` file with your Excel paths
5. **Double-click** "AbaYa Track" on Desktop

### For CEO/Office (view-only)

- Open https://dashboard.farewellabaya.com in any browser
- No installation needed

### For Tablets (kiosk PWA)

- Open https://kiosk.farewellabaya.com
- Tap "Add to Home Screen"
- Configure server URL from factory PC's setup page

---

## Distribution Options

### Option A: Release ZIP (Recommended for clients)

**Build on dev machine:**
```powershell
yarn run package:release
```
Creates: `dist/AbaYa-Track-v1.0.0.zip`

**On client PC:**
1. Unzip to `C:\AbaYa-Track`
2. Run `install\INSTALL.bat`
3. Edit `.env` (see below)
4. Use Desktop shortcut or `install\LAUNCH-ALL.bat`

### Option B: Electron Installer EXE (GUI launcher)

**Build on dev machine:**
```powershell
yarn run build:installer
```
Creates: `dist/desktop-launcher/AbaYa Track Launcher-1.0.0.exe`

**On client PC:**
1. Run the `.exe` installer
2. Launch "AbaYa Track Launcher" from Start Menu
3. Click "Start Runtime" in the GUI

**Note:** The EXE installer only installs the **desktop launcher GUI**. The underlying server still needs the full repo ZIP for production use. For complete deployment, use **Option A**.

### Option C: Git Clone (development)

```powershell
git clone <repo-url>
cd famousabaya
yarn install
cd tools/desktop-launcher && yarn install
cd ../..
yarn launcher
```

---

## Configuration (.env file)

### Minimum Required

```env
PORT=3000

# Option 1: Single folder for both Excel files
EXCEL_DATA_DIR=C:/Users/YourName/Documents/AbayaData

# Option 2: Individual paths
CATALOG_XLSX_PATH=C:/path/to/items_export.xlsx
EMPLOYEES_XLSX_PATH=C:/path/to/employees.xlsx
```

### Optional (Cloud Features)

```env
# CEO Dashboard sync
CF_WORKER_URL=https://dashboard.farewellabaya.com
CF_INGEST_SECRET=your_secret_here

# HTTPS kiosk tablets (requires Cloudflare Tunnel)
ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.1.100:3000
```

### Excel File Format

**Catalog (`items_export.xlsx`):**
- Sheet name: `Items` (or first sheet)
- Required column: `Barcode Display Name`
- Optional: `Item Name`, `Item Category`, `Process`, `Icon`
- See `docs/CATALOG_EXCEL_SPEC.md`

**Employees (`employees.xlsx`):**
- Required columns: `emp_no`, `ac_no`, `Name`, `Barcode`, `Process`
- See `docs/EMPLOYEES_EXCEL_SPEC.md`

---

## Launch Methods

### Method 1: Desktop Shortcut (Simple)
Double-click "AbaYa Track" → Opens server + browsers

### Method 2: GUI Launcher (Interactive)
Double-click "AbaYa Track Launcher" → Control panel with logs, start/stop buttons, update management

### Method 3: Batch File (Classic)
```cmd
install\LAUNCH-ALL.bat
```

### Method 4: PM2 Service (Production, always-on)

**One-time setup (PowerShell as Admin):**
```powershell
cd C:\AbaYa-Track\install
.\SETUP-PM2-BOOT.ps1
```

**Daily operations:**
```powershell
pm2 status
pm2 logs abaya-server
pm2 restart abaya-server
```

**Auto-starts on boot, survives crashes**

---

## Network Setup

### LAN Only (no internet needed)

- Kiosk: `http://localhost:3000/kiosk.html`
- Dashboard: `http://localhost:3000/dashboard.html`
- Setup QRs: `http://localhost:3000/setup`

### Remote Access Options

#### Tailscale (Recommended for admin)
```powershell
install\SETUP-TAILSCALE.ps1
```
- Encrypts traffic
- No port forwarding
- Access from anywhere via `https://<tailscale-ip>:3000`

#### Cloudflare Tunnel (for HTTPS tablets)
```powershell
install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1
```
- Enables `https://api.farewellabaya.com` → factory server
- Required for `https://kiosk.farewellabaya.com` tablets

See `docs/REMOTE_ACCESS.md` for details.

---

## Updating

### From ZIP (client PCs)

1. Stop server (close cmd window or `pm2 stop`)
2. Backup `.env` to Desktop
3. Unzip new version to new folder
4. Copy `.env` back
5. Run `install\INSTALL.bat`
6. Delete old folder after testing

### From Git (dev machines)

```powershell
git pull
yarn install
pm2 reload ecosystem.config.cjs --update-env
```

### Desktop Launcher Auto-Update

The GUI launcher checks for updates automatically (configurable in `config/update-policy.json`). Updates download from GitHub Releases or LAN mirror.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Node.js not found"** | Install from https://nodejs.org, restart terminal |
| **".pnp.cjs missing"** | Run `install\INSTALL.bat` or `yarn install` |
| **"Port 3000 busy"** | Change `PORT` in `.env`, or close other app using port 3000 |
| **"Excel file not found"** | Check paths in `.env`, ensure files exist with correct names |
| **"Mixed content" on tablets** | Use `https://` factory URL (Cloudflare Tunnel), see kiosk setup |
| **Launcher won't start** | Run `install\START-Launcher-GUI.bat` from cmd to see errors |
| **PM2 not starting** | Run `pm2 startup` then `pm2 save` as Admin |

### Quick Health Check

```powershell
# Server running?
curl http://localhost:3000/api/health

# Catalog loaded?
curl http://localhost:3000/api/catalog/abayas

# PM2 status
pm2 status

# System test
yarn test:system
```

---

## Directory Structure

```
C:\AbaYa-Track\
├── install\
│   ├── INSTALL.bat              # First-time setup
│   ├── LAUNCH-ALL.bat           # Daily launcher
│   ├── START-Launcher-GUI.bat   # GUI control panel
│   └── *.ps1                    # Admin scripts
├── tools\
│   ├── desktop-launcher\        # Electron GUI
│   └── catalog-watcher\         # Office Excel sync
├── data\
│   ├── offline-dashboard-reports\
│   └── ceo-ingest-queue.jsonl
├── public\
│   ├── kiosk.html
│   ├── dashboard.html
│   └── asset-upload.html
├── .env                         # Your config
├── server.js                    # Main server
└── package.json
```

---

## Security Checklist

- [ ] `.env` not committed to Git
- [ ] `CF_INGEST_SECRET` kept private
- [ ] Firewall allows port 3000 (LAN only) or use Tailscale
- [ ] PM2 service runs as dedicated user (optional hardening)
- [ ] Regular backups of `data\` folder

---

## Support & Logs

**Log locations:**
- Server: `data\pm2-logs\abaya-server.out.log`
- Watcher: `data\pm2-logs\catalog-watcher.out.log`
- Launcher GUI: Visible in real-time in the app

**Export diagnostics:**
In Launcher GUI: Click "Export diagnostics" button

**Reset everything:**
Delete `data\desktop-launcher\` folder, restart launcher

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `docs/INSTALL_WINDOWS.md` | Detailed Windows IT guide |
| `docs/REMOTE_ACCESS.md` | Tailscale + Cloudflare setup |
| `docs/OFFICE_LAPTOP.md` | Catalog watcher for office |
| `docs/CATALOG_EXCEL_SPEC.md` | Excel format requirements |
| `docs/OPERATIONS_RUNBOOK.md` | Daily operations checklist |
| `START HERE.txt` | Quick reference card |

---

**Version:** 1.0.0  
**Last updated:** 2024  
**Support:** Check `docs/` folder or export diagnostics from Launcher GUI
