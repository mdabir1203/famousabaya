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
2. From the project root, install dependencies (use your package manager as documented in the repo, e.g. `yarn` or `npm install`).
3. **Optional — Cloudflare Worker ingest** (for dashboard sync): set environment variables before starting the server:
   - `CF_WORKER_URL` — your Worker base URL (e.g. `https://abaya-track.example.workers.dev`)
   - `CF_INGEST_SECRET` — same secret configured on the Worker
4. **Start the server**:
   - Default port: `3000` (override with `PORT` if needed).
   - Example: `PORT=3000 node server.js` (adjust for your shell on Windows).
5. **Firewall**: allow inbound TCP on the chosen port from the **tablet subnet** only, if possible.
6. **HTTPS in production**: terminate TLS on a reverse proxy (nginx, Caddy, etc.) or use a secure tunnel; browsers and mixed content policies are easier to satisfy with HTTPS.

---

## 3. Lenovo tablet setup

1. **Network**: join the same **Wi-Fi / VLAN** as the server (or routeable network with the port open).
2. **Browser**: use **Chrome** (or another Chromium-based browser). Enable **automatic updates**.
3. **Open the kiosk**:
   - URL: `http://<server-ip>:<PORT>/kiosk.html`  
   - Bookmark or add to home screen for a full-screen experience.
4. **Kiosk / fullscreen** (choose one):
   - **Pinned tab + fullscreen** from the browser menu, or  
   - **Android kiosk / lock task** mode (device policy or a kiosk app) so workers cannot leave the browser accidentally.
5. **Power**: keep tablets **charging** during shifts; disable aggressive battery restrictions for the browser app so the socket connection stays stable.
6. **Accessibility**: under **Settings → Accessibility**, enable **TalkBack** for testing; optionally increase **display size** and **font size** to validate layout.

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

## 6. Support notes

- **No legal or medical claims**: biometric deployment may be subject to **local labor and privacy law**; obtain appropriate consent and policy review.  
- **This document** describes deployment patterns; **reader model–specific** steps must follow the **manufacturer’s manual** (firmware, enrollment, anti-spoofing).

For code touchpoints, see `public/kiosk.html`, `public/kiosk.js`, and `server.js` (Socket.IO handlers for `req_lookup` and `req_finishWork`).
