# AbaYa Track Uninstaller

Standalone Electron wrapper whose only job is to let the operator clean
up an AbaYa Track install safely — choosing what to keep, what to wipe,
and (optionally) exporting `.env` credentials before they're deleted.

## What it detects

| Group | Where | Default |
|---|---|---|
| Running processes | Factory server / watcher / dispatch / cloudflared tunnel | Stop on Apply |
| `factory-data/` | `%APPDATA%\AbaYa Track\factory-data\` | Keep |
| `.env` | `%APPDATA%\AbaYa Track\.env` | Keep |
| `launcher/` cache | `%APPDATA%\AbaYa Track\launcher\` | Keep |
| Install dir | Windows registry → `InstallLocation`; falls back to common paths | Keep |
| Bundled photos | `<install>/resources/public/uploads/employees\|items` | Keep |

## Safety

- Default is **keep everything**. Nothing destructive happens until the
  user clicks Apply.
- Per-item radios (Keep / Wipe). No "select all wipe".
- A second confirmation dialog shows the exact paths that will be
  affected before any action runs.
- `.env` is offered for export to a user-chosen location before any
  wipe. The export button is independent of the Wipe choice.
- Every step is logged to `%TEMP%\AbaYa-Track-Uninstaller\uninstall-audit.log`
  (also accessible from the "Open audit log" button in the footer).
- The install dir wipe prefers the NSIS `Uninst.exe /S` (cleanest
  removal of registry entries + shortcuts) and falls back to a
  recursive `rmSync` only if no uninstaller is found.

## Development

```bash
yarn install
yarn start            # runs electron with --no-sandbox
yarn test             # unit tests for the policy module
yarn dist:win         # builds AbaYa-Track-Uninstaller-1.0.0.exe via electron-builder
```

## Architecture

```
main.js              Electron main: IPC + action runner
preload.js           contextBridge → window.uninstaller
renderer.js          UI (radio per item, confirm modal, result list)
index.html           shell + styled cards
uninstaller-policy.cjs   pure logic: detection + plan building (testable)
uninstaller-policy.test.cjs
```

The policy module has no Electron, no I/O side effects, and is fully
tested. The main process imports it, runs the policy, and translates
each plan item into the corresponding destructive op behind the
`apply:run` IPC handler.
