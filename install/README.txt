AbaYa Track — Windows quick install
===================================

Package manager: Yarn Berry 4 (PnP — no node_modules folder)

1) Install Node.js 18 or newer from https://nodejs.org (LTS is fine).
   Node 18+ ships with corepack, which provides Yarn.

2) Unzip this folder anywhere (e.g. C:\AbaYa-Track).

3) Double-click:  install\INSTALL.bat
   - Enables corepack (activates Yarn).
   - Installs Yarn PnP dependencies for the factory server and catalog watcher.
     Uses the bundled .yarn/cache — no internet connection needed.
   - Creates .env from .env.example if needed.
   - Creates "AbaYa Track" shortcut on your Desktop.

4) Edit .env in the folder root (same level as server.js):
   - CF_WORKER_URL = your Cloudflare Worker URL (optional for local-only)
   - CF_INGEST_SECRET = same secret as on the Worker (optional if not using cloud)

5) Double-click "AbaYa Track" on your Desktop (or install\LAUNCH-ALL.bat).
   Opens the kiosk and dashboard in your browser, starts the server.
   Leave the server window open while working.

Office PC (catalog Excel upload):
- Copy tools\catalog-watcher\config.example.json to config.json and edit it.
- LAUNCH-ALL.bat will start the watcher automatically from that point.
- Full steps: docs\OFFICE_LAPTOP.md

Cloudflare Worker deploy: cloudflare folder + Wrangler — see docs in repo.

Remote HTTPS (client tests from any internet): docs\REMOTE_ACCESS.md
Full IT guide: docs\INSTALL_WINDOWS.md
