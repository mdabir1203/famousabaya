# GitHub Release Publishing Guide

## Why Your Release Isn't Appearing on GitHub

The build script is working correctly, but **GitHub releases require authentication**. Without a valid token, the build completes locally but skips the GitHub publish step.

### Current Status
- ✅ Local build: Working (EXE created in `dist/desktop-launcher/`)
- ✅ LAN mirror: Working (updates available at `http://192.168.0.101:3111/updates/stable/`)
- ❌ GitHub releases: **SKIPPED** (no GH_TOKEN configured)

---

## Solution: Add GitHub Token

### Step 1: Generate a GitHub Token

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Settings:
   - **Note**: `AbaYa Track Builder`
   - **Expiration**: No expiration (or set as needed)
   - **Scopes**: Check **`repo`** (Full control of private repositories)
4. Click **"Generate token"**
5. **Copy the token immediately** (you won't see it again!)

### Step 2: Add Token to .env

Edit `/workspace/.env` and add your token:

```bash
GH_TOKEN=ghp_your_actual_token_here_with_all_characters
```

Or use the alternative variable name:
```bash
GITHUB_TOKEN=ghp_your_actual_token_here_with_all_characters
```

### Step 3: Re-run Build

```batch
install\BUILD-AND-PUBLISH.bat
```

The script will now:
1. ✅ Build the installer EXE
2. ✅ Publish to GitHub Releases (https://github.com/mdabir1203/famousabaya/releases)
3. ✅ Update LAN mirror for local tablets

---

## Alternative: Manual GitHub Upload

If you don't want to use a token, you can manually upload:

1. Run build without GitHub publish:
   ```batch
   install\BUILD-AND-PUBLISH.bat stable --skip-gh-publish
   ```

2. Find the generated files:
   - Installer: `dist/desktop-launcher/AbaYa-Track-Launcher-Setup-<version>.exe`
   - Latest config: `dist/desktop-launcher/latest.yml`

3. Go to: https://github.com/mdabir1203/famousabaya/releases/new

4. Create a new release with:
   - Tag version: Match the version in `package.json`
   - Title: e.g., "v1.2.5"
   - Description: Release notes
   - Upload the `.exe` and `.yml` files

---

## Verify It Works

After adding the token and rebuilding, check:

1. **GitHub Releases**: https://github.com/mdabir1203/famousabaya/releases
   - Should show a new release matching your version

2. **Console Output** during build:
   ```
   ✓ Installer built and published to GitHub
   ```

3. **Electron Launcher** on client machines:
   - Should update automatically from GitHub (if LAN mirror unavailable)
   - No more "token authentication error" if using LAN mirror

---

## Security Notes

- The token is stored only in `.env` (not committed to git if `.gitignore` is correct)
- Token is used only during build process
- Consider using a dedicated CI/CD machine for builds
- Rotate tokens periodically for security

---

## Troubleshooting

### "Token rejected" error
- Token may be expired or revoked
- Regenerate a new token
- Ensure `repo` scope is selected

### "Rate limit exceeded"
- Too many builds in short time
- Wait an hour or use a token (higher limits)

### Build succeeds but no release appears
- Check token has `repo` scope (not just `public_repo`)
- Verify repository ownership/permissions
- Check GitHub Actions logs if using CI

### LAN updates work but GitHub doesn't
- This is expected without a token
- LAN mirror is the primary update source for factory tablets
- GitHub is fallback for remote clients
