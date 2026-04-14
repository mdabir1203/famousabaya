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

   REQUIRED — set your catalog source (repo sample works immediately):
     CATALOG_XLSX_PATH=./docs/samples/items_export.xlsx
   (You can switch to an absolute Windows path later, e.g. C:\Users\DELL\Desktop\barcode\items_export.xlsx.)
   (The server reads this file at startup and every 24 h automatically.)

  Required Excel column:
    - Barcode Display Name  (unique barcode per row — shown on kiosk)
  Common optional columns:
    - Item Name             (optional description shown on kiosk card)
    - Item Category         (optional abaya tier/grade)
    - Process               (optional; checked when watcher alignProcess is strict for employee folders)
   Full format guide: docs\CATALOG_EXCEL_SPEC.md

   OPTIONAL — Cloudflare cloud sync:
     CF_WORKER_URL = your Cloudflare Worker URL
     CF_INGEST_SECRET = same secret as on the Worker

5) Double-click "AbaYa Track" on your Desktop (or install\LAUNCH-ALL.bat).
   Opens the kiosk, dashboard, and tablet QR setup in your browser.
   Leave the server window open while working.

Kiosk features:
- Employees scan or type the barcode, or type the item name (e.g. FWAS 3593)
  to see all matching variants — then tap to choose.
- Each card shows: Barcode (Item No.), item description, and tier badge.

Office PC (catalog folder watcher — optional):
- Copy tools\catalog-watcher\config.example.json to config.json and edit it.
- LAUNCH-ALL.bat will start the watcher automatically from that point.
- Full steps: docs\OFFICE_LAPTOP.md

Cloudflare Worker deploy: cloudflare folder + Wrangler — see docs in repo.

Remote HTTPS (client tests from any internet): docs\REMOTE_ACCESS.md
Full IT guide: docs\INSTALL_WINDOWS.md
