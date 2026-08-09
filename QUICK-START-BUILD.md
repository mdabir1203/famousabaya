# 🚀 Quick Start: Build & Publish AbaYa Track

## Problem: No Release on GitHub?

**Root Cause:** Missing `GH_TOKEN` in `.env` file.

The build script is working correctly, but **GitHub requires authentication** to create releases. Without a token, it builds locally but skips the GitHub publish step.

---

## ✅ Fix in 3 Steps (5 minutes)

### Step 1: Generate GitHub Token

1. Visit: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Configure:
   - **Note:** `AbaYa Track Builder`
   - **Expiration:** No expiration
   - **Scopes:** ✅ Check **`repo`** (Full control of private repositories)
4. Click **"Generate token"**
5. **COPY THE TOKEN** (starts with `ghp_...`)

### Step 2: Add Token to .env

Edit `.env` file and paste your token:

```bash
GH_TOKEN=ghp_your_token_here_copy_all_characters
```

> ⚠️ **Important:** Copy the entire token including all characters!

### Step 3: Run Build

Double-click: `install\BUILD-AND-PUBLISH.bat`

Or run from command line:
```batch
cd C:\path\to\famousabaya
install\BUILD-AND-PUBLISH.bat
```

---

## 📊 What Happens Next

The script will:

1. ✅ Install dependencies
2. ✅ Build Windows installer EXE
3. ✅ **Publish to GitHub Releases** ← This was missing!
4. ✅ Update LAN mirror for factory tablets

**Check your release:** https://github.com/mdabir1203/famousabaya/releases

---

## 🎯 Expected Output

```
[INFO] Loaded .env file
[INFO] GitHub token found: ghp_...

========================================
  AbaYa Track - Build & Publish
========================================

[1/6] Version: 1.2.5
[2/6] Channel: stable
[3/6] Installing dependencies...
✓ Dependencies installed
[4/6] Building Electron launcher installer...
✓ Installer built and published to GitHub
[5/6] Publishing to LAN update mirror...
✓ LAN mirror updated
[6/6] Verifying LAN mirror...
✓ LAN mirror contains 3 files:
  - AbaYa-Track-Launcher-Setup-1.2.5.exe
  - latest.yml
  - builder.yml

Build Complete!
```

---

## 🔧 Alternative: Manual Upload (No Token Needed)

If you don't want to use a token:

1. **Build locally only:**
   ```batch
   install\BUILD-AND-PUBLISH.bat stable --skip-gh-publish
   ```

2. **Find the files:**
   - `dist/desktop-launcher/AbaYa-Track-Launcher-Setup-1.2.5.exe`
   - `dist/desktop-launcher/latest.yml`

3. **Upload manually:**
   - Go to: https://github.com/mdabir1203/famousabaya/releases/new
   - Create new release tag (e.g., `v1.2.5`)
   - Upload the `.exe` and `.yml` files

---

## 🌐 Update Sources Explained

| Source | URL | When Used | Token Required |
|--------|-----|-----------|----------------|
| **LAN Mirror** (Primary) | `http://192.168.0.101:3111/updates/stable/` | Factory tablets on local network | ❌ No |
| **GitHub** (Fallback) | `https://github.com/mdabir1203/famousabaya/releases` | Remote clients or LAN unavailable | ✅ Yes (for publishing) |

---

## ❓ Troubleshooting

### "Token not found" warning during build
- Token not set in `.env`
- Solution: Follow Step 2 above

### "Token rejected" error
- Token expired or invalid
- Solution: Regenerate token at https://github.com/settings/tokens

### Build succeeds but no release on GitHub
- Token missing `repo` scope
- Solution: Regenerate token with full `repo` scope

### Dashboard not loading on tablets
- Server not running on correct IP
- Solution: Start server with `install\LAUNCH-ALL.bat`
- Verify: `http://192.168.0.101:3111/dashboard.html`

### Electron launcher shows "token authentication error"
- **This is NORMAL** if `GH_TOKEN` is empty
- LAN mirror works without token (primary method)
- To eliminate message: Add valid `GH_TOKEN` to `.env`

---

## 📞 Need Help?

See detailed guide: `GITHUB-RELEASE-GUIDE.md`

Deployment docs: `README-DEPLOYMENT.md`
