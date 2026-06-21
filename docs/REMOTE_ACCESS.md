# Remote Access to the Factory Server

AbaYa Track ([server.js](../server.js), default port **3000**) uses a three-lane network model. Each lane serves a different audience with zero overlap.

---

## Part A — Tailscale (recommended for admin/office)

Tailscale creates an encrypted WireGuard mesh. Install once, SSO login once, done. No DNS, no credentials file, no tunnel config.

Full setup guide: [TAILSCALE_HYBRID.md](TAILSCALE_HYBRID.md)

Quick version:

```powershell
winget install --id Tailscale.Tailscale --accept-source-agreements
tailscale up                # SSO login in browser
tailscale serve --bg 3000   # HTTPS on mesh
tailscale ip -4             # Note your 100.x.x.x
```

Or run `install\SETUP-TAILSCALE.ps1` to automate all of the above.

**Use cases:** Office laptop catalog sync, admin phone live dashboard, remote maintenance.

---

## Part B — CEO Dashboard (no change needed)

The CEO uses `https://dashboard.farewellabaya.com` (Cloudflare Worker). This is a separate global URL backed by D1 — it does not need any tunnel or VPN. The factory server pushes events to the Worker via `POST /api/event`. The CEO sees analytics by polling `/api/state`. Zero install on the CEO phone.

---

## Part C — Factory LAN vs HTTPS kiosk PWA

- **Same Wi-Fi, opened as `http://<LAN_IP>:3000/...`:** tablets can use plain HTTP / WebSocket (same-origin). Windows Firewall: allow inbound TCP on the port (see [DEPLOYMENT_KIOSK_FINGERPRINT.md](DEPLOYMENT_KIOSK_FINGERPRINT.md)).
- **`https://kiosk.farewellabaya.com` (Cloudflare Pages PWA):** the browser **blocks** `ws://` to a LAN IP (mixed content). Tablets must use a **factory URL that starts with `https://`** so Socket.IO uses **`wss://`**. Set that in kiosk setup (localStorage). The usual approach is **Part D** (dedicated API hostname on a tunnel), or **Tailscale `serve`** with an `https://` mesh URL.

### Tablet rollout checklist (HTTPS PWA + tunnel API)

1. **Deploy** Worker and kiosk Pages from the repo: `yarn run deploy:all` (or `install\DEPLOY-ALL.ps1`). Confirm `https://kiosk.farewellabaya.com` loads.
2. **Factory PC:** run `install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1` once (or manually route **`api.farewellabaya.com` → `http://127.0.0.1:3000`**). Template: [config/cloudflared.config.yml](../config/cloudflared.config.yml).
3. **Daily:** `install\LAUNCH-ALL.bat` starts `cloudflared` automatically if `%USERPROFILE%\.cloudflared\config.yml` exists, then `server.js`.
4. **Tablets:** open `http://<factory-pc>:3000/setup`, set **Custom URL** to `https://kiosk.farewellabaya.com`, set **Factory API for QR** to your tunnel host (default `https://api.farewellabaya.com`), generate QRs. Each QR opens the PWA at `/` and passes `server=` so the app connects without typing the API URL. If an old tablet saved `http://…`, open `https://kiosk.farewellabaya.com/?reset=server` or use the gear menu to clear the saved address.
5. **Match hostnames:** if the tunnel uses a different API hostname, edit **`kiosk-pwa/index.html`** meta `abaya-factory-api-base` to the same value, redeploy Pages, and use that URL in setup’s **Factory API for QR** field.

---

## Part D — Cloudflare Tunnel (factory API HTTPS / WSS)

Use a **dedicated subdomain** for the factory Node server (Socket.IO + REST), **not** `kiosk.farewellabaya.com` (that hostname is **Pages** for the static PWA) and **not** `dashboard.farewellabaya.com` (that is the **CEO Worker**).

**Automated setup on the factory PC:** run `install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1` (defaults to `api.farewellabaya.com` → `http://127.0.0.1:3000`). Then set each tablet’s kiosk server URL to `https://api.farewellabaya.com` (or whatever hostname you chose).

Config template (reference): [config/cloudflared.config.yml](../config/cloudflared.config.yml)

### Setup summary (manual alternative)

1. In [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) -> Networks -> Tunnels, create a tunnel (or use the script above).
2. Route a public hostname (e.g. **`api.farewellabaya.com`**) to **`http://127.0.0.1:3000`** on the factory PC.
3. Install `cloudflared` on that PC; run the tunnel, or install as a Windows service for persistence.
4. Optional: Cloudflare Access policy on that hostname.
5. Daily launch: [install/LAUNCH-ALL.bat](../install/LAUNCH-ALL.bat) starts the tunnel automatically if `%USERPROFILE%\.cloudflared\config.yml` exists.

### Tunnel credential not found?

1. Start AbaYa server (`install\START-AbaYa-Server.bat`).
2. In Zero Trust -> Tunnels -> your tunnel -> **Install connector** (Windows).
3. Copy the command. Paste in Command Prompt on the factory PC. Press Enter.
4. This creates the credential file under `C:\Users\<you>\.cloudflared\`.
5. Set **Public hostname** -> Service to `http://127.0.0.1:3000`.

If the folder is empty after step 3, the command failed — try again. Must run as the same Windows user who will run the tunnel.

Optional check: `powershell -File scripts\check-cloudflared-credentials.ps1`

### Config file example

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: C:\Users\YOUR_USER\.cloudflared\YOUR_TUNNEL_UUID.json

ingress:
  - hostname: api.farewellabaya.com
    service: http://127.0.0.1:3000
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      tlsTimeout: 10s
      tcpKeepAlive: 30s
      keepAliveTimeout: 90s
  - service: http_status:404
```

---

## Security checklist

- [ ] `.env` not committed; `CF_INGEST_SECRET` stays secret.
- [ ] CEO Worker dashboard uses `CEO_TOKEN` (password) + `CEO_JWT_SECRET` (session JWT signing); optional `CEO_CREDENTIAL_VERSION` bump revokes sessions.
- [ ] If using Cloudflare Tunnel: Access policy enforced, connector runs as service.
- [ ] If using Tailscale: only authorized accounts on the tailnet.
- [ ] Test from mobile data (off factory Wi-Fi) once.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| **502 / error origin** | Is `server.js` running? Port matches `.env` `PORT` (default 3000)? |
| **Tailscale can't connect** | Both devices on same tailnet? Run `tailscale status`. Firewall blocking UDP 41641? |
| **DNS not resolving** (tunnel) | CNAME points to tunnel? Propagation delay. |
| **Live updates dead remotely** | WebSocket path blocked? Check browser devtools Network tab. |
| **Mixed content / ws blocked** | Page is `https://kiosk…` but factory URL is `http://`. Use `https://api…` (tunnel) in kiosk setup. |
| **Works on Wi-Fi but not 4G** | DNS or captive portal issue; try another network. |

---

## Related docs

- [TAILSCALE_HYBRID.md](TAILSCALE_HYBRID.md) — full Tailscale setup guide.
- [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md) — zip install on a PC.
- [OFFICE_LAPTOP.md](OFFICE_LAPTOP.md) — catalog Excel watcher.
- [DEPLOYMENT_KIOSK_FINGERPRINT.md](DEPLOYMENT_KIOSK_FINGERPRINT.md) — tablets and LAN firewall.
