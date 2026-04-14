# AbaYa Track Explainer Video (Cloudflare + Client PC) - Same Day

Use this script to record a quick, non-technical deployment video for your client.

Target length: **4-6 minutes**
Audience: Client manager / IT assistant
Goal: Get remote HTTPS access working today.

---

## 0) Before recording (2 minutes prep)

Keep these ready on screen:

1. `docs/INSTALL_WINDOWS.md`
2. `docs/REMOTE_ACCESS.md`
3. The project folder with:
   - `install/INSTALL.bat`
   - `install/LAUNCH-ALL.bat`
4. Cloudflare Zero Trust dashboard (Tunnels + Access)

---

## 1) One-line promise (0:00-0:20)

**Say this:**

"In this short video, we will set up AbaYa Track on your Windows PC and publish it securely over Cloudflare, so your team can open kiosk and dashboard links from any internet connection."

**Show on screen:**

- `https://kiosk.farewellabaya.com/kiosk.html`
- `https://kiosk.farewellabaya.com/dashboard.html`

---

## 2) Install on the client PC (0:20-1:30)

**Say this:**

"First time only: install Node.js LTS, unzip the AbaYa package, then run one file: `install/INSTALL.bat`. This enables Yarn, installs dependencies, and creates a Desktop shortcut."

**Show on screen:**

1. Node.js site (`https://nodejs.org`) - point to LTS.
2. Unzipped project folder.
3. Double-click `install/INSTALL.bat`.
4. Desktop shortcut `AbaYa Track`.

**Say this:**

"Next, open `.env` and set your catalog file path in `CATALOG_XLSX_PATH`. If cloud sync is needed, set `CF_WORKER_URL` and `CF_INGEST_SECRET` too."

---

## 3) Start app locally first (1:30-2:05)

**Say this:**

"Before internet access, always test local launch. Double-click `AbaYa Track` or run `install/LAUNCH-ALL.bat`."

**Show on screen:**

- Local pages opening:
  - `http://localhost:3000/kiosk.html`
  - `http://localhost:3000/dashboard.html`

**Say this:**

"If these local pages open, the app is healthy. Now we publish it over HTTPS."

---

## 4) Cloudflare Tunnel setup (2:05-3:20)

**Say this:**

"In Cloudflare Zero Trust, create a named tunnel, for example `abaya-factory`, and connect this PC using the Windows connector instructions."

**Show on screen:**

1. Zero Trust -> Tunnels -> Create tunnel.
2. Tunnel status **Healthy**.
3. Add public hostname:
   - Hostname: `kiosk.farewellabaya.com`
   - Service: `http://localhost:3000`

**Say this clearly:**

"Use **Published application**, not private route options, so the client can open it in any browser without installing WARP."

---

## 5) Protect with Cloudflare Access (3:20-4:20)

**Say this:**

"Now secure it. In Access -> Applications, add a self-hosted app for `kiosk.farewellabaya.com` and allow only approved client emails."

**Show on screen:**

1. Access -> Applications -> Add self-hosted.
2. Domain: `kiosk.farewellabaya.com`
3. Policy: Allow specific emails or client domain.

**Say this:**

"After this, anyone visiting the URL sees a login screen first, then the kiosk/dashboard after sign-in."

---

## 6) Final test from outside factory Wi-Fi (4:20-5:00)

**Say this:**

"Last test: open mobile data on a phone, then visit the HTTPS links. If login appears and pages load, deployment is complete."

**Show on screen:**

- Phone browser on mobile data:
  - `https://kiosk.farewellabaya.com/kiosk.html`
  - `https://kiosk.farewellabaya.com/dashboard.html`

---

## 7) 30-second troubleshooting outro (5:00-5:30)

**Say this:**

"If you see 502, check that AbaYa server is running and tunnel service points to the same port. If Access blocks login, verify policy emails. If tunnel says credential not found, follow `docs/TUNNEL_CREDENTIALS_WINDOWS.md`."

---

## Fast recording format (optional)

If you need to ship this today, use this structure:

1. Intro + promise (20 sec)
2. Install demo (70 sec)
3. Local launch demo (35 sec)
4. Tunnel setup demo (75 sec)
5. Access policy demo (60 sec)
6. Mobile-data test + close (40 sec)

Total: about 5 minutes.

---

## Copy-paste description for sending to client

"This video shows how to install AbaYa Track on Windows and publish secure HTTPS access through Cloudflare Tunnel + Access. After setup, your authorized team can open kiosk and dashboard from any network using browser login."

