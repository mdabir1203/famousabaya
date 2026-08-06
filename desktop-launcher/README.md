# AbaYa Track — desktop launcher (optional)

Single-window **Electron** shell that starts the same processes as the classic batch launcher:

- Factory server: `node -r ./.pnp.cjs server.js` from repo root (or `bun server.js` if `ABAYA_RUNTIME=bun`).
- Catalog watcher (optional): `node -r ./.pnp.cjs watch-catalog.js` in `tools/catalog-watcher` (or Bun), with same start guards as [`install/LAUNCH-ALL.bat`](../../install/LAUNCH-ALL.bat).

## When to use batch instead (original workflow)

Prefer **`install/LAUNCH-ALL.bat`** if you want:

- Separate **terminal** windows (`cmd /k`)
- Existing Task Scheduler or scripts that already call the `.bat`
- Machines where you skip installing Electron (this folder’s devDependency)

Nothing in this launcher replaces the batch file — it stays the supported **classic** entry point.

## Install

 From the repo root (after root `yarn install`):

```bash
cd tools/desktop-launcher
yarn install
```

Or double-click **`install/START-Launcher-GUI.bat`** (Windows; runs `yarn launcher` and installs launcher deps on first use).

From repo root:

```bash
yarn launcher
```

If this runs from **WSL**, the command starts Electron with `--no-sandbox --disable-gpu-sandbox` to avoid Chromium `SIGTRAP` crashes (`crbug/638180`) common in WSL terminal launches.

Or:

```bash
cd tools/desktop-launcher && yarn start
```

The footer links read **PORT** from the repo **`.env`** (for URLs only); the factory server reads `.env` itself on startup.

## Stop

Use **Stop** in the UI, or close the window. On Windows, child **`yarn` → `node`** trees are terminated with **`taskkill /T`**.
