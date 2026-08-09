# GitHub Actions Auto-Release Setup Guide

## ✅ Current Status

Your GitHub Actions workflow is **already configured** at `.github/workflows/release-desktop-launcher.yml` with:
- QA/QC pipeline on every push to `main`
- Automated Windows build and GitHub release publishing
- Self-signed code signing certificate generation
- Release notes auto-generation
- Version duplicate detection

## 🔑 Step 1: Add GitHub Token to Repository Secrets

The workflow uses `secrets.GH_PAT` or `secrets.GITHUB_TOKEN`. You need to add a Personal Access Token (PAT):

### Generate PAT:
1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Select scopes: **`repo`** (full control of private repositories)
4. Generate token and copy it

### Add to Repository Secrets:
1. Go to your repo: https://github.com/mdabir1203/famousabaya/settings/secrets/actions
2. Click **"New repository secret"**
3. Add TWO secrets:
   - **Name**: `GH_PAT`
   - **Value**: `ghp_your_token_here` (paste your token)
   
   - **Name**: `GITHUB_TOKEN` (optional fallback)
   - **Value**: `ghp_your_token_here` (same token)

## 🚀 Step 2: Trigger Your First Automated Release

### Option A: Push a Tag (Recommended)
```bash
# On your local machine
git tag v1.2.5
git push origin v1.2.5
```

This triggers an immediate release build for version 1.2.5.

### Option B: Push to Main Branch
```bash
git commit -m "chore: trigger release build"
git push origin main
```

The workflow will build using the version from `tools/desktop-launcher/package.json` (currently 1.2.5).

## 📦 What Gets Published

After successful build, you'll see on GitHub Releases:
- ✅ **AbaYa-Track-Launcher-Setup-1.2.5.exe** - Windows installer (signed)
- ✅ **AbaYa-Track-v1.2.5.zip** - Portable ZIP archive
- ✅ **Release notes** - Auto-generated from commits
- ✅ **Source code** - Automatic GitHub snapshot

## 💻 Local Build (Alternative to CI/CD)

For local testing without GitHub:

### Windows:
```batch
install\BUILD-AND-PUBLISH.bat
```

This builds locally and publishes to LAN mirror at `http://192.168.0.101:3111/updates/stable/`

### With GitHub Publish (requires token in .env):
```batch
cd tools/desktop-launcher
yarn release:gh
```

## 🔍 Troubleshooting

### "Token authentication error" in Electron Launcher GUI

**Cause**: LAN mirror unavailable AND no GitHub token configured.

**Fix**:
1. Ensure server is running at `http://192.168.0.101:3111`
2. OR add token to `.env` on client laptop:
   ```
   GH_TOKEN=ghp_your_token_here
   ```

### No Release Appearing on GitHub

Check:
1. ✅ Token added to **Repository Secrets** (not just `.env`)
2. ✅ Workflow enabled: https://github.com/mdabir1203/famousabaya/actions
3. ✅ Workflow logs show success: Check "QA/QC and Release" job
4. ✅ Version not already published (workflow skips duplicates)

### Build Fails on "Generate self-signed certificate"

This is normal in some runners. The workflow continues and builds unsigned installer. For production, use a real code signing certificate.

## 🔄 Update Flow After Installation

Once installed on client laptop:

1. **LAN Mirror Priority**: Launcher checks `http://192.168.0.101:3111/updates/stable/latest.yml`
2. **GitHub Fallback**: If LAN fails, checks GitHub Releases (uses token if available)
3. **Auto-Download**: New version downloads in background
4. **User Prompt**: "Update downloaded. Restart now?" dialog appears
5. **One-Click Install**: User clicks "Restart and Install"

## 📊 Monitoring

- **Workflow Runs**: https://github.com/mdabir1203/famousabaya/actions
- **Releases**: https://github.com/mdabir1203/famousabaya/releases
- **Launcher Logs**: Check `data/desktop-launcher/update-events.jsonl` on client machine

---

**Next Steps**:
1. Add `GH_PAT` secret to repository
2. Push tag `v1.2.5` to trigger first release
3. Download EXE from GitHub Releases
4. Install on factory server (192.168.0.101)
5. Populate LAN mirror: Run `node scripts/publish-lan-update-mirror.mjs --channel stable --from dist/desktop-launcher`
6. Test tablet connectivity at `http://192.168.0.101:3111/kiosk.html`
