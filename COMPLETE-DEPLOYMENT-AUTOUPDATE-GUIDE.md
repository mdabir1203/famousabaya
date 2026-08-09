# AbaYa Track - Complete Deployment & Auto-Update Guide

## ✅ System Architecture Overview

### Update Flow (Simple, Clear, Maintainable)
```
Electron Launcher GUI (Update Button)
    ↓
IPC: update-check-now
    ↓
main.js: checkForUpdatesSafe()
    ↓
autoUpdater.checkForUpdates()
    ↓
┌─────────────────────────────────────┐
│ 1st Priority: LAN Mirror            │
│    http://192.168.0.101:3111/       │
│    updates/stable/latest.yml        │
└─────────────────────────────────────┘
    ↓ (if fails)
┌─────────────────────────────────────┐
│ 2nd Priority: GitHub Releases       │
│    https://github.com/              │
│    mdabir1203/famousabaya/releases  │
│    (uses GH_TOKEN secret)           │
└─────────────────────────────────────┘
    ↓
Download → User Prompt → Restart & Install
```

---

## 📋 Part 1: Configuration Files Aligned

### `/workspace/.env` (Server + Launcher Config)
```bash
# Server Binding (LAN Access)
HOST=0.0.0.0
PORT=3111
LAN_IP=192.168.0.101

# Socket.IO Tuning (Factory Wi-Fi Jitter Tolerance)
SOCKET_PING_INTERVAL_MS=25000
SOCKET_PING_TIMEOUT_MS=60000

# TCP Keep-Alive (Prevent Android Chrome ERR_CONNECTION_ABORTED)
SERVER_KEEP_ALIVE_TIMEOUT_MS=120000
SERVER_HEADERS_TIMEOUT_MS=130000

# LAN Update Mirror (Primary Source for Tablets/Launcher)
ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111

# GitHub Token (Fallback - Optional for Local Builds)
# Leave empty if using GitHub Actions Secrets
GH_TOKEN=
GITHUB_TOKEN=
```

**Why Empty GH_TOKEN in .env?**
- GitHub Actions uses **Repository Secrets** (`secrets.GH_PAT`), not `.env`
- Local builds can optionally add token here for testing
- Production client laptops get token from installed `.env` during setup

---

## 🚀 Part 2: Automated Releases via GitHub Actions

### Workflow: `.github/workflows/release-desktop-launcher.yml`

**Triggers:**
- Push to `main` branch → Build + Release
- Push tag `v*` → Build + Release (recommended)
- Manual dispatch → Build + Release

**What It Does:**
1. ✅ Runs QA/QC pipeline (Ubuntu)
2. ✅ Builds Windows installer (Windows runner)
3. ✅ Generates self-signed certificate
4. ✅ Creates GitHub Release with:
   - `AbaYa-Track-Launcher-Setup-{version}.exe`
   - `AbaYa-Track-v{version}.zip` (portable)
   - Auto-generated release notes
5. ✅ Skips if version already exists (idempotent)

### Step-by-Step: Enable Automated Releases

#### 1️⃣ Generate GitHub Personal Access Token (PAT)
```
URL: https://github.com/settings/tokens
Type: Classic token
Scopes: repo (full control of private repositories)
Generate → Copy token (ghp_xxxxxxxxxxxx)
```

#### 2️⃣ Add Token to Repository Secrets
```
URL: https://github.com/mdabir1203/famousabaya/settings/secrets/actions

Add TWO secrets:
  Name: GH_PAT
  Value: ghp_your_token_here
  
  Name: GITHUB_TOKEN (optional fallback)
  Value: ghp_your_token_here
```

#### 3️⃣ Trigger First Release
```bash
# Option A: Push a tag (recommended for versioned releases)
git tag v1.2.5
git push origin v1.2.5

# Option B: Push to main (uses version from package.json)
git commit -m "chore: trigger release"
git push origin main
```

#### 4️⃣ Monitor Build
```
URL: https://github.com/mdabir1203/famousabaya/actions
Look for: "QA/QC and Release" workflow run
Status: Should turn green ✓
```

#### 5️⃣ Verify Release Published
```
URL: https://github.com/mdabir1203/famousabaya/releases
Should see: v1.2.5 with EXE and ZIP attachments
```

---

## 💻 Part 3: Local Build (Alternative to CI/CD)

### For Testing Without GitHub

#### Windows One-Click Build
```batch
install\BUILD-AND-PUBLISH.bat
```

**Output:**
- `dist/desktop-launcher/AbaYa-Track-Launcher-Setup-{version}.exe`
- `data/lan-update-mirror/stable/latest.yml` (auto-populated)

#### With GitHub Publish (Local + Token)
```batch
cd tools/desktop-launcher
yarn release:gh
```

**Requires:** `GH_TOKEN=ghp_xxx` in `.env`

---

## 🖥️ Part 4: Deploy to Factory Server (192.168.0.101)

### Installation Steps

1. **Download EXE** from GitHub Releases:
   ```
   https://github.com/mdabir1203/famousabaya/releases/latest
   Download: AbaYa-Track-Launcher-Setup-1.2.5.exe
   ```

2. **Install on Factory Server**:
   ```
   Run installer on 192.168.0.101
   Accept defaults
   Installer creates: C:\Users\{user}\AppData\Local\Programs\abaya-track-launcher\
   ```

3. **Configure .env** (Post-Install):
   ```bash
   # Edit: C:\Users\{user}\AppData\Local\Programs\abaya-track-launcher\resources\.env
   
   HOST=0.0.0.0
   PORT=3111
   LAN_IP=192.168.0.101
   ABAYA_UPDATE_MIRROR_BASE_URL=http://192.168.0.101:3111
   GH_TOKEN=ghp_your_token_here  # Optional, for GitHub fallback
   ```

4. **Populate LAN Mirror**:
   ```batch
   cd "C:\Users\{user}\AppData\Local\Programs\abaya-track-launcher\resources"
   node scripts/publish-lan-update-mirror.mjs --channel stable --from dist/desktop-launcher
   ```

5. **Launch Server**:
   ```batch
   install\LAUNCH-ALL.bat
   ```

6. **Verify Tablet Connectivity**:
   ```
   Open browser on tablet: http://192.168.0.101:3111/kiosk.html
   Check diagnostics: http://192.168.0.101:3111/api/connectivity-diagnostics
   ```

---

## 🔧 Part 5: Electron Launcher Update Button (How It Works)

### GUI Elements (renderer.js)
```javascript
// Update button click handler
btnUpdateCheck.onclick = async function () {
  const st = await window.abayaLauncher.updateCheckNow();
  // Triggers IPC → main.js → checkForUpdatesSafe()
};

btnUpdateInstall.onclick = async function () {
  const r = await window.abayaLauncher.updateInstallNow();
  // Downloads → Restarts → Installs new version
};
```

### Backend Logic (main.js)
```javascript
// IPC Handler: Check for updates
ipcMain.handle('update-check-now', async function () {
  await checkForUpdatesSafe('manual');
  return getPublicUpdateState();
});

// IPC Handler: Install update
ipcMain.handle('update-install-now', function () {
  if (!updateState.downloaded) {
    return { ok: false, error: 'No downloaded update available' };
  }
  autoUpdater.quitAndInstall(); // Restarts app
  return { ok: true };
});
```

### Update State Flow
```
Idle → Checking → Available → Downloading → Downloaded → [Restart] → Applied
         ↓
       Error (shows message in GUI)
```

### Why "Token Authentication Error" Appears

**Scenario 1: LAN Mirror Unavailable + No Token**
```
1. Launcher tries: http://192.168.0.101:3111/updates/stable/latest.yml
2. Fails (server offline / wrong IP)
3. Falls back to GitHub
4. No GH_TOKEN in .env → GitHub rate limits anonymous requests
5. Error: "Token authentication error"
```

**Fix:**
- Ensure server running at `http://192.168.0.101:3111`
- OR add `GH_TOKEN=ghp_xxx` to client laptop's `.env`

**Scenario 2: Expected Behavior During Development**
```
This error is NORMAL if:
- LAN mirror not yet populated
- Testing without GitHub token
- First boot before server starts

System automatically retries every 4 hours (configurable)
```

---

## 📊 Part 6: Monitoring & Diagnostics

### Server Endpoints (Tablet Perspective)
```
GET  /api/health                    → Server health check
GET  /api/server-info               → IPs, port, boot ID
GET  /api/connectivity-diagnostics  → Full diagnostic info
POST /api/tablet-ping               → Latency test
GET  /api/debug-kiosk               → Kiosk state debug
GET  /api/kiosk/state               → Real-time kiosk state
```

### Launcher Logs (Client Laptop)
```
Location: data/desktop-launcher/update-events.jsonl

Format: JSON Lines (one event per line)
Events:
  - check-ok
  - check-failed
  - download-progress
  - update-downloaded
  - install-requested
  - updater-fallback-github-after-lan-error
```

### Export Diagnostics (GUI Button)
```
Click: "Export Diagnostics" button
Output: JSON file with:
  - Update state
  - Server status
  - Network config
  - Recent logs
```

---

## 🔍 Part 7: Troubleshooting

### Issue: No Release on GitHub After Push

**Checklist:**
1. ✅ Token added to **Repository Secrets** (not `.env`)
   - Go to: https://github.com/mdabir1203/famousabaya/settings/secrets/actions
   - Verify: `GH_PAT` exists with valid token

2. ✅ Workflow enabled
   - Go to: https://github.com/mdabir1203/famousabaya/actions
   - Check: No "Workflow disabled" message

3. ✅ Version not duplicate
   - Workflow skips if tag already exists
   - Solution: Increment version in `tools/desktop-launcher/package.json`

4. ✅ Check workflow logs
   - Click failed job → View logs
   - Common errors:
     - "token not found" → Secret name mismatch
     - "permission denied" → Token missing `repo` scope
     - "version already exists" → Tag duplicate

### Issue: Dashboard Not Loading

**Checklist:**
1. ✅ Server running on port 3111
   ```batch
   netstat -ano | findstr :3111
   ```

2. ✅ Firewall allows port 3111
   ```powershell
   install\ENSURE-LAN-FIREWALL.ps1
   ```

3. ✅ Browser console errors
   - Open DevTools (F12)
   - Check Console tab for errors
   - Common: CORS, mixed content (HTTP vs HTTPS)

4. ✅ File exists
   ```bash
   ls public/dashboard.html
   ```

### Issue: Tablets Can't Connect

**Checklist:**
1. ✅ Server binds to `0.0.0.0` (not `127.0.0.1`)
   ```bash
   grep HOST .env
   # Should be: HOST=0.0.0.0
   ```

2. ✅ Correct IP address
   ```
   Server shows: "Connect tablets to: http://192.168.0.101:3111"
   Tablet browser: Navigate to exact URL
   ```

3. ✅ Same network subnet
   ```
   Server: 192.168.0.101
   Tablet: 192.168.0.xxx (same first 3 octets)
   ```

4. ✅ Wi-Fi isolation disabled
   - Some routers block device-to-device communication
   - Solution: Disable "AP Isolation" or "Client Isolation"

### Issue: Update Button Shows "Checking..." Forever

**Causes:**
1. LAN mirror probe timeout (3.5s) + GitHub rate limit
2. Network unreachable
3. Invalid mirror URL

**Debug:**
```javascript
// Check launcher logs
data/desktop-launcher/update-events.jsonl

// Look for:
"check-failed" with error message
"lan-unavailable" probe result
```

**Fix:**
- Ensure server running
- Add GH_TOKEN to .env
- Wait for retry (default: 4 hours, manual check available)

---

## 📝 Part 8: Maintenance Checklist

### Weekly Tasks
- [ ] Check GitHub Actions for failed builds
- [ ] Review update audit logs (`update-events.jsonl`)
- [ ] Test tablet connectivity from factory floor

### Monthly Tasks
- [ ] Rotate GH_TOKEN (security best practice)
- [ ] Clean old release artifacts (keep last 5 versions)
- [ ] Verify backup snapshots (`data/sqlite-snapshots/`)

### Before Major Updates
- [ ] Increment version in `tools/desktop-launcher/package.json`
- [ ] Test on staging laptop first
- [ ] Populate LAN mirror before deploying to production
- [ ] Notify operators of maintenance window

---

## 🎯 Quick Reference Commands

### Build & Release
```bash
# Local build (Windows)
install\BUILD-AND-PUBLISH.bat

# Trigger GitHub release
git tag v1.2.5 && git push origin v1.2.5

# Build portable only
powershell -File scripts/build-release.ps1 -Version 1.2.5
```

### Deploy
```bash
# Install on factory server
AbaYa-Track-Launcher-Setup-1.2.5.exe

# Populate LAN mirror
node scripts/publish-lan-update-mirror.mjs --channel stable

# Launch all services
install\LAUNCH-ALL.bat
```

### Debug
```bash
# Check server status
install\CHECK-PM2-STATUS.ps1

# View update logs
type data\desktop-launcher\update-events.jsonl

# Test tablet endpoint
curl http://192.168.0.101:3111/api/health
```

---

## 📞 Support Resources

- **GitHub Repo**: https://github.com/mdabir1203/famousabaya
- **Releases**: https://github.com/mdabir1203/famousabaya/releases
- **Actions**: https://github.com/mdabir1203/famousabaya/actions
- **Issues**: https://github.com/mdabir1203/famousabaya/issues

**Documentation Files:**
- `GITHUB-ACTIONS-RELEASE-GUIDE.md` - CI/CD setup
- `README-DEPLOYMENT.md` - Deployment overview
- `docs/OPERATIONS_RUNBOOK.md` - Daily operations
- `docs/UPDATE_RUNBOOK.md` - Update procedures

---

**Last Updated**: 2026-01-XX  
**Version**: 1.2.5  
**Maintainer**: Mohammad Abir Abbas
