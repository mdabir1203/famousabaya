# Kiosk deployment (Lenovo tablets) and fingerprint reader setup

This guide covers running the floor kiosk on **Lenovo Android tablets**, keeping **invoice entry** on those devices, and how **fingerprint hardware** fits in. The current `kiosk.html` UI uses a **simulated fingerprint grid** for demos; wiring a **physical reader** is a separate integration step (see below).

---

## 1. Design intent (tablets + inclusion)

- **Invoice maker** flow is built for **touch-first** use: large targets (about 48px minimum), readable type scaling with `clamp()`, and a form that works with **on-screen keyboard**, **external keyboard**, and **screen readers** (labels, hints, live status region). Workers enter **multiple invoice numbers** in one box: **digits only** (1–20 digits per value; no letters, decimals, or `1e5`-style input), separated by commas, spaces, semicolons, or new lines (for example `9454, 9455, 9456`). **Duplicates are rejected.** **Leading zeros are kept** (`0094` and `94` are different). Up to **500** numbers and **12000** characters per submit. The stored **invoice count** always equals the number of parsed values; the server rejects a mismatched `invoice_count` if a client sends one.
- **Viewport** allows pinch-zoom where the browser permits it, which helps low-vision users (avoid locking `maximum-scale`).
- For **WCAG 2.1**, keep contrast in themes as shipped, ensure **visible focus** on all controls, and test with **TalkBack** (Android) on a real Lenovo device.

---

## 2. Server deployment (PC or mini-PC on the LAN)

1. **Install Node.js** (LTS) on the machine that will run the kiosk backend.
2. From the project root, run `install\INSTALL.bat` (enables Yarn PnP, installs dependencies).
3. **Optional — Cloudflare Worker ingest** (for dashboard sync): set environment variables before starting the server:
   - `CF_WORKER_URL` — your Worker base URL (e.g. `https://abaya-track.example.workers.dev`)
   - `CF_INGEST_SECRET` — same secret configured on the Worker
4. **Start the server**:
   - Default port: `3000` (override with `PORT` in `.env` if needed).
   - Example: `PORT=3000 node server.js` (adjust for your shell on Windows).
5. **Firewall**: allow inbound TCP on the chosen port from the **tablet subnet** only, if possible.
6. **Remote access**: for admin/office use **Tailscale** ([TAILSCALE_HYBRID.md](TAILSCALE_HYBRID.md)). Cloudflare Tunnel is available as legacy backup ([REMOTE_ACCESS.md](REMOTE_ACCESS.md) Part D). On LAN, plain HTTP is enough for tablets.

---

## 2.1 Barcode list from Excel (other laptop)

Easiest flow for a list exported or maintained in Excel:

1. **One code at a time:** In Excel, click the cell, copy, paste into the kiosk **Manual entry / Excel list** field. It submits when the code is complete (same as typing).
2. **Many codes in one go:** Select a **column** (or row) in Excel, copy, paste into the same field. The **first** code is used right away; the rest go into a **queue** stored in the browser (it survives **Start work** and the fingerprint screen). When you are back on **Scan Abaya**, tap **Use next code** for each following abaya. **Clear list** empties the queue; a **new multi-cell paste** replaces the queue with the new tail.
3. **Optional file path:** *Save As → CSV (UTF-8)* on the laptop, open the CSV in a simple editor, copy the column—same paste behavior as from Excel.
4. **Hardware scanner:** Unchanged—scanner acts as a keyboard; keep focus in the barcode field.

Codes must match **abaya code** or **barcode** in `public/data.js` (e.g. `AB-0041` or `AB00000041`). Delimiters: new lines, tabs, commas, or semicolons between pasted cells.

---

## 3. Tablet setup — QR code deployment (10+ tablets, multiple factories)

### 3.1 One-time: generate QR codes on the server PC

1. Start the AbaYa Track server (`LAUNCH-ALL.bat` or `START-AbaYa-Server.bat`).
2. Open the **QR Setup page** in a browser on the server PC:
   ```
   http://localhost:3000/setup
   ```
   (The setup URL is also printed in the server console window every time the server starts.)
3. On the setup page:
   - **Server LAN IP** — select the IP your tablets can reach (shown automatically).
   - **Custom base URL** — for the **hosted PWA**, use `https://kiosk.farewellabaya.com` (not the factory API host). For same-Wi-Fi only, use `http://<LAN-IP>:3000`.
   - **Factory API for QR** — HTTPS tunnel to `server.js` (default `https://api.farewellabaya.com`). Hosted QRs include `server=` so tablets connect without typing the API URL. Must match [REMOTE_ACCESS.md](REMOTE_ACCESS.md) Part D and `kiosk-pwa/index.html` meta `abaya-factory-api-base`.
   - **Factories & Tablets** — enter each factory name and how many tablets it has (default: 2 factories × 5 tablets = 10 QR codes).
   - Click **Generate QR Codes** — one QR per tablet appears instantly.
4. Click **Print All** (or use Ctrl+P). Each QR card shows:
   - Factory name and tablet label (e.g. `Factory 1 • T-01`)
   - The full kiosk URL encoded in the QR
   - "Scan with tablet camera" instruction
5. Cut out the printed QR cards and stick one on each tablet.

### 3.2 On each tablet

1. **Network**: join the same Wi-Fi / VLAN as the server. For cross-factory access use the Cloudflare Tunnel URL (see [REMOTE_ACCESS.md](REMOTE_ACCESS.md)).
2. **Open camera** → scan the QR card → tap the link → Chrome opens the kiosk.
3. **The top bar** will show the factory name and tablet number (e.g. `Factory 1 • T-01`) confirming the correct URL loaded.
4. **Add to home screen**: Chrome menu → *Add to Home Screen* → tap the icon for full-screen kiosk mode with no browser chrome.
5. **Lock to kiosk** (optional, recommended for factory floor):
   - Android **Pin screen**: Settings → Security → App Pinning → turn on → open Chrome → use *Recent apps* button → pin. Workers cannot leave Chrome accidentally.
   - Or use a **kiosk MDM app** (e.g. SureLock, Fully Kiosk Browser) for zero-UI lockdown across all tablets at once.
6. **Power**: keep tablets on charge during shifts. Disable battery optimisation for Chrome so the Socket.IO connection stays live.

### 3.3 Multi-factory URL structure

**LAN / factory server** (custom base `http://<LAN>:3000`):
```
http://<server-ip>:<PORT>/kiosk.html?factory=Factory+1&tablet=T-01
```

**Hosted PWA** (custom base `https://kiosk.farewellabaya.com`):
```
https://kiosk.farewellabaya.com/?factory=Factory+1&tablet=T-01&server=https%3A%2F%2Fapi.farewellabaya.com
```
The `factory` and `tablet` parameters are displayed in the kiosk top bar for easy identification. They do not affect functionality. The `server` query presets the factory Socket.IO base URL on first open (HTTPS only on the hosted app).

### 3.4 Cross-factory / cross-network access

| Scenario | Recommended **Custom URL** on setup page | **Factory API for QR** |
|----------|-------------------------------------------|-------------------------|
| All tablets on same Wi-Fi | `http://<LAN-IP>:3000` (or pick IP in dropdown) | Leave default; LAN QRs omit `server=` |
| Hosted PWA + tunnel API (any network) | `https://kiosk.farewellabaya.com` | `https://api.farewellabaya.com` (or your tunnel host) |
| Tablets in a different building / VLAN | VPN + LAN URL, or hosted PWA row above | Same as tunnel ingress hostname |

---

## 4. Fingerprint reader installation and integration

### 4.1 What the app does today

- The kiosk identifies employees through **`req_lookup`** after a **simulated** scan (`kiosk.js` + demo grid). There is **no USB biometric SDK** in this repository yet.

### 4.2 Installing the reader (hardware + OS)

1. **Choose a deployment host** for the reader:
   - **Option A — Reader on the tablet**: only if the vendor supports **Android**, provides an **APK or WebView bridge**, and documents **USB OTG** or built-in sensor use.
   - **Option B — Reader on the PC** (most common for USB desktop readers): reader stays on the **server PC** or a **small companion PC** next to the tablet; the tablet still shows the rest of the flow (barcode, invoice form).
2. **Install vendor drivers** on that host (Windows: driver package from the manufacturer; Linux: `libfprint` or vendor `.so` per documentation).
3. **Verify in vendor software**: enroll a test finger and confirm **match / template ID** output before integrating with any custom app.
4. **Cable and power**: use a **powered USB hub** if the reader is high-draw or the cable run is long.

### 4.3 Integration paths (from simplest to full control)

| Approach | How it works | Fit for this kiosk |
|----------|----------------|-------------------|
| **Keyboard wedge** | Reader types digits (e.g. employee ID) + Enter into the focused field | Easiest if the reader can emit a **stable ID** that maps to `ac_no` or `emp_id`; you would focus a hidden or visible field and parse in JS. |
| **Vendor SDK on PC** | Native service reads USB, exposes HTTP/WebSocket to LAN | Tablet loads `kiosk.html`; a small **local bridge** calls `req_lookup` or sets session server-side. |
| **Android SDK** | Vendor library inside a WebView or native shell | Requires app packaging beyond static HTML. |

### 4.4 Recommended rollout order

1. Install reader + drivers; confirm **ID output** in vendor tools.  
2. Map output to **employee lookup** (same identifier the server expects in `req_lookup`).  
3. Add a **thin bridge** (optional Node script or vendor middleware) that performs lookup and either **injects** into the page via postMessage or **calls the same Socket.IO events** the kiosk already uses.  
4. **Pilot** one tablet + one reader; log failures (no match, timeout, unplugged device).  
5. Document **who to call** and **how to reboot** the reader/PC if the sensor stops responding.

---

## 5. Verification checklist

- [ ] Tablet opens `kiosk.html` and shows **Connected** (or equivalent) when the server is up.  
- [ ] **Invoice maker**: finish work → form appears → **multiple invoice numbers** validate → submit reaches **Work logged** confirmation.  
- [ ] **Screen reader**: focus order makes sense from fingerprint → ID → barcode → … → invoice fields.  
- [ ] **Fingerprint** (when integrated): failed scan shows a clear message; success advances to ID verification.  

---

## 5.1 Factory shift hours (CEO hourly chart)

Charts and D1 hourly rollups use **factory local time** (`FACTORY_TZ`, default `Asia/Dubai`). Hour buckets are **9–23** so evening completions (up to 11:30 pm) appear.

| Days | Shift windows |
|------|----------------|
| **Saturday–Thursday** | 9:00–13:30, 15:00–20:00, 20:40–23:30 |
| **Friday** | 15:00–20:00, 20:40–23:30 (no morning shift) |

Friday mornings may show **zero** volume in early hours; that is expected. Constants: `FACTORY_HOURLY_START` / `FACTORY_HOURLY_END` in `cloudflare/src/index.js` and `FACTORY_HOURLY_*` / `FACTORY_SHIFT_SCHEDULE_TEXT` in `public/data.js`.

---

## 6. Support notes

- **No legal or medical claims**: biometric deployment may be subject to **local labor and privacy law**; obtain appropriate consent and policy review.  
- **This document** describes deployment patterns; **reader model–specific** steps must follow the **manufacturer’s manual** (firmware, enrollment, anti-spoofing).

For code touchpoints, see `public/kiosk.html`, `public/kiosk.js`, and `server.js` (Socket.IO handlers for `req_lookup` and `req_finishWork`).
