# Tailscale Hybrid Setup

Tailscale creates an encrypted WireGuard mesh between your devices. Install once, login once, done. No DNS, no credentials file, no tunnel config.

**Who uses what:**

| Who | How they connect | Install needed? |
|-----|-----------------|-----------------|
| CEO phone (any network) | `https://dashboard.farewellabaya.com` (Cloudflare Worker) | No. Browser only. |
| Kiosk tablet (factory) | `https://kiosk.farewellabaya.com` (PWA) or `http://LAN_IP:3000/kiosk.html` | No. Add to home screen. |
| Office laptop / admin | `http://100.x.x.x:3000` (Tailscale mesh) | Yes. Tailscale app. |

---

## Factory PC (one time)

```powershell
# Option A: automated script
powershell -ExecutionPolicy Bypass -File install\SETUP-TAILSCALE.ps1

# Option B: manual
winget install --id Tailscale.Tailscale --accept-source-agreements
tailscale up
tailscale serve --bg 3000
tailscale ip -4
```

After `tailscale up`, a browser window opens for SSO login (Google, Microsoft, etc). After login, the PC gets a stable `100.x.x.x` IP that never changes.

`tailscale serve --bg 3000` exposes port 3000 with auto-TLS on the Tailscale network. Other devices on the same tailnet can reach `https://factory-pc` (MagicDNS name).

---

## Office laptop (one time)

1. Install Tailscale (same method as above).
2. Login with the **same account** as the factory PC.
3. Note the factory PC's Tailscale IP: run `tailscale status` on either device.
4. Edit `tools/catalog-watcher/config.json`:

```json
"employeesUrl": "http://100.x.x.x:3000/api/employees"
```

The watcher can now reach the factory server from any network.

---

## Admin phone (optional)

1. Install Tailscale from App Store / Play Store.
2. Login with same account.
3. Open `http://100.x.x.x:3000/dashboard.html` in the phone browser.
4. Live Socket.IO updates work through Tailscale (unlike the Worker poll-based CEO dashboard).

---

## Tailscale Funnel (optional — public internet access)

Replaces Cloudflare Tunnel entirely. Exposes the factory server to the public internet via a Tailscale-provided HTTPS URL:

```powershell
tailscale funnel 3000
```

This gives you a URL like `https://factory-pc.tail12345.ts.net` that anyone can open in a browser. Enable only if you need public access beyond the CEO Worker dashboard.

---

## Diagnostics

```powershell
tailscale status          # List all devices on your tailnet
tailscale ip -4           # Show this device's Tailscale IPv4
tailscale ping factory-pc # Test connectivity to factory PC
curl http://100.x.x.x:3000/api/state  # Verify factory server reachable
```

---

## Comparison with Cloudflare Tunnel

| | Cloudflare Tunnel | Tailscale |
|-|-------------------|-----------|
| Setup time | 15-30 min (DNS + tunnel + Access) | 2 min (install + login) |
| Credentials | JSON file + config.yml + DNS CNAME | SSO login once |
| IPv6 issues | Needs `noHappyEyeballs` workaround | N/A (WireGuard) |
| Reconnect | Must configure Windows service | Auto-starts as service |
| CEO phone (no app) | Needs tunnel or Worker | Worker (unchanged) |

For **HTTPS kiosk PWA** (`https://kiosk.farewellabaya.com`), use **`install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1`** on the factory PC (or Tailscale `serve` with an `https://` URL). Template: `config/cloudflared.config.yml`.
