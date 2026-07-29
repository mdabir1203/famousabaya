# CEO Dashboard Access Troubleshooting Guide

## Problem: Cannot access https://dashboard.farewellabaya.com

The CEO dashboard requires **three secrets** to be configured in Cloudflare Workers. If you're getting access errors, one or more secrets are missing.

---

## Required Secrets (Set in Cloudflare, NOT in .env)

The following secrets must be set in your Cloudflare Workers dashboard using Wrangler:

| Secret | Purpose | How to Generate |
|--------|---------|-----------------|
| `INGEST_SECRET` | Factory server authenticates to Worker | Random string (e.g., `AbaYa-Ingest-123456`) |
| `CEO_TOKEN` | CEO login password | Choose a strong password (min 8 chars) |
| `CEO_JWT_SECRET` | **Required for browser login** - signs session cookies | Auto-generated 32-byte base64 string |

### Why CEO_JWT_SECRET is Critical

- **Without it**: Browser login is unavailable (you'll see error: "Login unavailable: set Wrangler secret CEO_JWT_SECRET")
- **With it**: CEO can log in via browser with HttpOnly JWT session cookies
- **Legacy fallback**: API calls with `?token=CEO_PASSWORD` still work without JWT secret, but browser login does not

---

## Solution 1: Run the Deployment Script (Recommended)

From a Windows machine with Node.js 18+ installed:

```powershell
cd cloudflare
powershell -ExecutionPolicy Bypass -File DEPLOY.ps1
```

This script will:
1. Log you into Cloudflare
2. Create D1 database and R2 bucket
3. Prompt you for `INGEST_SECRET` and `CEO_TOKEN`
4. **Auto-generate and set `CEO_JWT_SECRET`**
5. Deploy the Worker
6. Update your local `.env` file

---

## Solution 2: Set Secrets Manually

If you've already deployed and just need to add the missing secret:

```bash
cd cloudflare

# Set INGEST_SECRET (must match CF_INGEST_SECRET in factory server .env)
npx wrangler secret put INGEST_SECRET
# Enter: AbaYa-Ingest-123456 (or your chosen secret)

# Set CEO_TOKEN (CEO login password)
npx wrangler secret put CEO_TOKEN
# Enter: YourStrongPassword123

# Set CEO_JWT_SECRET (auto-generate a 32-byte base64 string)
npx wrangler secret put CEO_JWT_SECRET
# Enter: $(openssl rand -base64 32)  # On Linux/Mac
# Or use PowerShell on Windows:
# [Convert]::ToBase64String((New-Object Byte[] 32) | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })
```

### PowerShell One-Liner to Generate CEO_JWT_SECRET

```powershell
$jwtSecret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 255 }))
Write-Output $jwtSecret
# Copy this value and paste when running: npx wrangler secret put CEO_JWT_SECRET
```

---

## Solution 3: Verify Secrets Are Set

Check if secrets are configured:

```bash
cd cloudflare
npx wrangler secret list
```

You should see:
- `INGEST_SECRET` (type: secret_text)
- `CEO_TOKEN` (type: secret_text)
- `CEO_JWT_SECRET` (type: secret_text) ← **This one is critical for login**

---

## After Setting Secrets

1. **Redeploy the Worker** (if you added secrets manually):
   ```bash
   cd cloudflare
   npx wrangler deploy
   ```

2. **Restart the Factory Server** (so it picks up the new Worker URL):
   ```powershell
   # Stop current server (Ctrl+C)
   # Then run:
   install\LAUNCH-ALL.bat
   ```

3. **Test CEO Dashboard Access**:
   - Open: https://dashboard.farewellabaya.com
   - Enter the `CEO_TOKEN` password you set
   - You should now see the live dashboard

---

## Smoke Test Commands

Verify the deployment is working:

```bash
# Health check (should return JSON with status)
curl -sS "https://dashboard.farewellabaya.com/api/health"

# State API with token (legacy method, works without JWT)
curl -sS "https://dashboard.farewellabaya.com/api/state?token=YOUR_CEO_PASSWORD" | jq '.ok, .ts'

# Browser login redirect (requires CEO_JWT_SECRET)
curl -sSI "https://dashboard.farewellabaya.com/ceo?token=YOUR_CEO_PASSWORD"
# Should return 302 redirect + Set-Cookie headers
```

---

## Common Issues

### Issue: "Login unavailable: set Wrangler secret CEO_JWT_SECRET"
**Cause**: `CEO_JWT_SECRET` is not set in Cloudflare  
**Fix**: Run `npx wrangler secret put CEO_JWT_SECRET` and redeploy

### Issue: Dashboard loads but shows no data
**Cause**: Factory server not pushing events to Worker  
**Fix**: 
1. Check factory server logs for connection errors
2. Verify `CF_WORKER_URL=https://dashboard.farewellabaya.com` in `.env`
3. Verify `CF_INGEST_SECRET` matches Worker's `INGEST_SECRET`
4. Restart factory server: `install\LAUNCH-ALL.bat`

### Issue: "Invalid token" or login fails
**Cause**: Wrong `CEO_TOKEN` password  
**Fix**: 
1. Check what password you set: `npx wrangler secret list` (shows names, not values)
2. Reset it: `npx wrangler secret put CEO_TOKEN`
3. Inform the CEO of the new password
4. Optional: Bump `CEO_CREDENTIAL_VERSION` in `wrangler.toml` to invalidate all sessions

### Issue: Sessions expire too quickly or don't persist
**Cause**: Missing or invalid `CEO_JWT_SECRET`  
**Fix**: Ensure `CEO_JWT_SECRET` is set and redeploy

---

## Security Notes

- **Never commit secrets to Git**: The `.env` file is gitignored; secrets live only in Cloudflare
- **Rotate secrets periodically**: Especially `CEO_TOKEN` if staff changes
- **Use strong secrets**: 
  - `INGEST_SECRET`: 32+ characters, random
  - `CEO_TOKEN`: 8+ characters, mix of letters/numbers/symbols
  - `CEO_JWT_SECRET`: 32 bytes base64 (auto-generated is fine)
- **Credential version bump**: To revoke all active CEO sessions immediately, increment `CEO_CREDENTIAL_VERSION` in `wrangler.toml` and redeploy

---

## Quick Reference

```powershell
# Full deployment (recommended for first-time setup)
cd cloudflare
powershell -ExecutionPolicy Bypass -File DEPLOY.ps1

# Add missing secret manually
npx wrangler secret put CEO_JWT_SECRET

# List all secrets
npx wrangler secret list

# Redeploy after changing secrets
npx wrangler deploy

# Test dashboard
curl -sS "https://dashboard.farewellabaya.com/api/health"
```

---

## Contact

If issues persist after following this guide:
1. Check Cloudflare Worker logs: `npx wrangler tail`
2. Verify domain is correctly routed in Cloudflare Dashboard
3. Ensure D1 database exists and has schema applied
4. Review factory server logs for push errors
