# Remote access to the factory server (production-first)

This guide is for exposing **AbaYa Track** ([server.js](../server.js); default port **3000**, override with **`PORT`** in `.env`) over **HTTPS** so **authorized people** (e.g. your client) can open the kiosk or dashboard from **any normal internet connection** (home Wi‑Fi, mobile data, office abroad).

**Recommended pattern:** **Named Cloudflare Tunnel** + **Cloudflare Access** (Zero Trust) on a hostname under **farewellabaya.com**. On-site tablets or PCs can keep using **plain HTTP on the LAN** (`http://<server-LAN-IP>:3000` unless you changed `PORT`).

Official references (UI names change over time; use these if steps differ):

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Private web application with Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
- [Install cloudflared on Windows](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

**Error “tunnel credential not found”?** Short fix (5 steps): [TUNNEL_CREDENTIALS_WINDOWS.md](TUNNEL_CREDENTIALS_WINDOWS.md). Optional: `powershell -File scripts\check-cloudflared-credentials.ps1` from the repo root.

---

## Prerequisites

- Domain on **Cloudflare** (DNS managed by Cloudflare).
- **Cloudflare Zero Trust** enabled on the account (free tier is enough for small teams).
- The PC that runs `node server.js` can run **`cloudflared`** and has outbound HTTPS (typical corporate networks allow this).
- **Node.js 18+** and the app installed per [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md).

---

## Part A — Named tunnel to the Node port (`127.0.0.1:3000`)

### 1. Create a tunnel in Zero Trust

1. Log in to [Cloudflare One](https://one.dash.cloudflare.com/) (Zero Trust dashboard).
2. Go to **Networks** → **Tunnels** (or **Access** → **Tunnels**, depending on layout).
3. **Create a tunnel**. Choose **Cloudflared** connector.
4. Name it (e.g. `abaya-factory`).
5. Copy the **install command** shown for **Windows** (it includes a `cloudflared.exe` download or link and a token / login step). Complete the **connector** setup on the factory PC so the tunnel shows **Healthy**.

### 1b. "Add a route" screen — pick **Published application**

If you see **Add a route** with four choices, choose **Published application** (“Publish local applications to the Internet via public hostname”). That puts your Node app on a **normal HTTPS URL** so your client can open **`/kiosk.html`** or **`/dashboard.html`** in **Safari, Chrome, or any browser** on **Wi‑Fi or mobile data** — **no WARP app** required on their phone.

| Option | Use for AbaYa client access? |
|--------|------------------------------|
| **Published application** | **Yes.** Use this. Browser-only, any internet connection. |
| **Private hostname** | No (typical case). Meant for users on **Cloudflare WARP** reaching private DNS names. |
| **Private CIDR** | No. Routes whole subnets; users usually need **WARP** / device posture. |
| **Workers VPC** | No. For Cloudflare **Workers** talking to private networks, not for publishing this server. |

### 2. Route a public hostname to the tunnel

Still in the tunnel configuration (or **Public hostnames** / **Ingress**):

1. Add a **public hostname**: subdomain `kiosk`, domain `farewellabaya.com` → full hostname: `1`
2. Set the **service** to **`http://127.0.0.1:3000`** — must match `PORT` in `.env` (default `3000`).
3. Save. Cloudflare will create or prompt for the **DNS** record (usually a **CNAME** to `xxxx.cfargotunnel.com`).

Wait for DNS to propagate (often a few minutes).

### 2b. Multiple factories

Each site runs its own **PC + `server.js` + `cloudflared`**. Use **one tunnel per factory** (or one tunnel with multiple **public hostnames** / ingress rules if a single connector can reach all origins — usually **one connector machine per site** is simplest):

- Example hostnames: `factory1.farewellabaya.com`, `factory2.farewellabaya.com`, `factory3.farewellabaya.com`, each pointing to that site’s `http://127.0.0.1:3000` (or whatever `PORT` is on that machine).
- Use the **same Cloudflare Access application** (or cloned policies) so the client’s login works for every hostname.

**Central “CEO” analytics** without visiting each factory: your **Cloudflare Worker** CEO dashboard ([cloudflare](../cloudflare)) is already a separate global URL; tunnels are for the **live floor** kiosk/dashboard at each location.

### 3. Optional: example `config.yml` (advanced)

If you manage `cloudflared` with a config file instead of only the dashboard, it typically looks like this (your **tunnel UUID** and **credentials file** come from Cloudflare when you create the tunnel):

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: C:\Users\YOUR_USER\.cloudflared\YOUR_TUNNEL_UUID.json

ingress:
  - hostname: kiosk.farewellabaya.com
    service: http://127.0.0.1:3000
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      tlsTimeout: 10s
      tcpKeepAlive: 30s
      keepAliveTimeout: 90s
  - hostname: "*.farewellabaya.com"
    service: http://127.0.0.1:3000
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      tlsTimeout: 10s
      tcpKeepAlive: 30s
      keepAliveTimeout: 90s
  - service: http_status:404
```

Default config location on Windows: **`%USERPROFILE%\.cloudflared\config.yml`**.

### 4. Run `cloudflared` persistently (Windows)

- Prefer installing **`cloudflared` as a Windows service** so the tunnel survives logoff and reboot. Follow the **“Install and run a tunnel as a service”** section in Cloudflare’s Windows install doc (commands are along the lines of `cloudflared.exe service install` after the config exists).
- Until the service is configured, you can test with:  
  `cloudflared tunnel run <tunnel-name>`  
  in a console window (keep it open while testing).

### 5. Start the app

On the same PC, start AbaYa as usual (`install\LAUNCH-ALL.bat`).

Check **without** Access first (if Cloudflare allows temporarily):  
`https://kiosk.farewellabaya.com/kiosk.html`  
If it loads, the tunnel and origin are correct.

---

## Part B — Cloudflare Access (who may open the URL)

**Do not** leave the kiosk URL **world-open** without at least **Access** (or another auth layer). This is what makes the setup **production-grade** for client testing.

1. In Zero Trust, go to **Access** → **Applications**.
2. **Add an application** → **Self-hosted** (or **SaaS** / **Browser** per current UI).
3. **Application domain:** `kiosk.farewellabaya.com` (same hostname as the tunnel). You can scope to the whole host or path later if you split kiosk vs dashboard.
4. **Policies:** Add a rule such as:
   - **Allow** emails ending in `@clientcompany.com`, **or**
   - **Allow** specific emails (client + your team), **or**
   - **One-time PIN** / **Google** / **GitHub** identity, as appropriate.
5. Save. Unauthenticated visitors should get a **Cloudflare Access login** page, then the app after success.

### After Access is on

- Client opens **`https://kiosk.farewellabaya.com/kiosk.html`** (or `/dashboard.html`) from **mobile data** or any Wi‑Fi, signs in, and should see the same UI as on the LAN.
- **Socket.IO** (live updates) uses WebSockets/long polling. Cloudflare **generally supports** WebSockets on proxied hostnames; if live updates fail only through the tunnel, check [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/) and tunnel logs.

---

## Part C — On-site LAN (unchanged)

- Tablets or kiosks on the factory network: **`http://<SERVER_LAN_IP>:3000/kiosk.html`** (or your `PORT`)
- Windows Firewall: allow **inbound TCP** on that **PORT** from the **tablet subnet** if needed (see [DEPLOYMENT_KIOSK_FINGERPRINT.md](DEPLOYMENT_KIOSK_FINGERPRINT.md)).
- No Access step on LAN unless you intentionally put everything behind the tunnel only.

---

## Part C2 — Persistent connection hardening (mobile-first)

For phone clients on changing 4G/5G/Wi-Fi paths, apply all of these:

1. **Run cloudflared as a Windows service** (not an interactive console window).
2. Confirm tunnel ingress points to the real app port (`http://127.0.0.1:3000` unless `PORT` changed).
3. Keep app process stable (launch with `install\LAUNCH-ALL.bat`; avoid manual terminal closes).
4. Verify Access app is bound to the exact hostname used by client (`kiosk.farewellabaya.com`).
5. Keep client on one canonical URL (avoid switching between hostname variants during session).
6. Confirm dashboard fallback API responds through tunnel:
   - `https://kiosk.farewellabaya.com/api/state`
   - Must return JSON with `ok: true`.

Windows service checks:

```powershell
sc query cloudflared
sc qc cloudflared
```

If not installed as service, complete Cloudflare "service install" flow and reboot once to verify persistence.

---

## Part D — Quick tunnel (debug only, not client production)

For **internal** tests you may use:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

This prints a temporary **`trycloudflare.com`** URL. It **changes**, is **not** on your brand domain, and is **not** a substitute for **Part A + B** when the client must test from anywhere with a **stable, controlled** URL.

---

## Part E — IPv6/AAAA and MTU hardening

Use this when mobile clients connect but drop quickly, especially on cellular.

### 1) AAAA record policy for unstable IPv6 routes

If your ISP/router/path has bad IPv6, keep only IPv4 for tunnel hostnames:

1. In Cloudflare DNS, inspect each public hostname used by the tunnel.
2. If AAAA exists and IPv6 is unstable, remove AAAA for that hostname.
3. Keep the proxied CNAME to `<tunnel-id>.cfargotunnel.com`.
4. Re-test from cellular after 60-300 seconds of DNS propagation.

CLI checks (WSL):

```bash
dig +short A kiosk.farewellabaya.com
dig +short AAAA kiosk.farewellabaya.com
```

### 2) TCP MSS clamping on origin router

If PMTU black-hole behavior exists on mobile carriers, enable MSS clamping at egress.

Linux router example:

```bash
sudo iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

Verify:

```bash
sudo iptables -t mangle -S | rg TCPMSS
```

---

## Part F — Optional alternatives (no Cloudflare Tunnel)

| Approach | When to use |
|----------|-------------|
| **Tailscale / Headscale** | Only trusted devices; client installs mesh app; use MagicDNS or `100.x` IP to `http://...:3000` (or your `PORT`). Not “open in any browser without agent” unless combined with something else. |
| **Self-hosted WireGuard** | Same idea: private IPs; you operate the VPN server. |
| **Host Node on a VPS + TLS** | App runs in the cloud; kiosks must reach that host (different deployment model). |

---

## Security checklist (before sharing with the client)

- [ ] **Access** (or equivalent) enforced on the **public hostname**; no anonymous internet-wide kiosk.
- [ ] **Tunnel connector** runs as a **service** so reboots do not drop remote access.
- [ ] **`.env`** on the server is **not** committed; `CF_INGEST_SECRET` stays secret ([.env.example](../.env.example)).
- [ ] **CEO Worker** dashboard remains **token-protected** as today ([cloudflare](../cloudflare)); tunnel is for the **Node** app, not a replacement for Worker auth.
- [ ] Optional: extra **IP allowlist** on the Access policy for sensitive phases; **rate limiting** / **WAF** rules on the zone if you expect abuse.
- [ ] Test once from **mobile data** (off factory Wi‑Fi): login → kiosk → start/finish a test session if possible.
- [ ] Ingress includes root host and wildcard host (if used), and each maps to `http://127.0.0.1:3000` with `originRequest.noHappyEyeballs: true`.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| **502 / error origin** | Is `node server.js` running? Tunnel service up? Service URL matches **`PORT`** (default `http://127.0.0.1:3000`)? |
| **Tunnel credential not found** | [TUNNEL_CREDENTIALS_WINDOWS.md](TUNNEL_CREDENTIALS_WINDOWS.md) — re-run **Install connector** in Zero Trust; fix `config.yml` **`credentials-file`**. |
| **DNS not resolving** | CNAME for `kiosk…` points to tunnel; propagation delay. |
| **Access loop or 403** | Policy includes client’s email / IdP; application domain matches hostname. |
| **Live updates dead remotely** | WebSocket path blocked or misconfigured; compare LAN vs tunnel; check `cloudflared` and browser devtools Network tab. |
| **Works on Wi‑Fi but not 4G** | Often DNS or captive portal; try another network or disable VPN on phone for test. |

---

## Validation (cellular + tunnel)

Use this short test after any DNS/tunnel change:

1. From WSL:

```bash
curl -v --http1.1 --connect-timeout 10 --max-time 20 https://kiosk.farewellabaya.com/api/state
```

Expected: HTTP `200` with JSON `ok: true`.

2. On phone mobile data:
   - Open `https://kiosk.farewellabaya.com/dashboard.html` for 10-15 minutes.
   - Page must not drop to 5xx.
   - If websocket reconnects, fallback `/api/state` must keep data visible.

## Related docs

- [TUNNEL_CREDENTIALS_WINDOWS.md](TUNNEL_CREDENTIALS_WINDOWS.md) — fix “tunnel credential not found”.
- [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md) — zip install on a PC.
- [OFFICE_LAPTOP.md](OFFICE_LAPTOP.md) — catalog Excel → Worker (separate from tunnel).
- [DEPLOYMENT_KIOSK_FINGERPRINT.md](DEPLOYMENT_KIOSK_FINGERPRINT.md) — tablets and LAN firewall.
