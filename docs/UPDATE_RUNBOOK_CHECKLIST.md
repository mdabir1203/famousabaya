# AbaYa Track — update field checklist (one page)

**Print this.** Tick every box before sign-off.

| Date | _____ / _____ / _____ | PC name | __________________ |
| Operator | __________________ | Verifier | __________________ |
| From → To version | _____ → _____ | Backup folder | __________________ |

---

### Before backup

- [ ] Staff notified / maintenance OK
- [ ] App stopped (launcher + server consoles closed)
- [ ] Known good **PORT** documented (default **3000**)

### Backup — copy ALL to dated folder (outside app)

- [ ] **`.env`**
- [ ] **`data`** (whole folder)
- [ ] **`public\uploads`** (whole folder)
- [ ] **Excel**: folder from `EXCEL_DATA_DIR` or paths in **`.env`**
- [ ] Backup path logged in ticket

### Deploy — pick one pattern

**A — Side-by-side (recommended)**

- [ ] New folder unzipped; **old folder not deleted yet**
- [ ] `.env` + `data` + `public\uploads` (+ Excel if needed) in **new** root before first run

**B — In-place**

- [ ] After file replace: **restored** `data`, uploads, `.env` from backup **same session**

Never: wipe folder with no backup.

### After start — verification

- [ ] Server runs; kiosks load
- [ ] Images OK (employees + items)
- [ ] Dashboard shows expected recent work OR snapshot restored
- [ ] `/api/ceo-ingest-status` OK when cloud sync used
- [ ] **One real test scan** start + finish passes

### Launcher updater (when using Control Center / Electron)

- [ ] Trust row shows sensible **Last checked** / **Next check** / **Retry in** (not stuck blank after 1+ minute on Wi‑Fi)
- [ ] **Update details** line shows **Feed** (`lan` or `github`) and **probe** (`ok` or reason); matches expectation for site (see `docs/ONLINE_UPDATES.md` — LAN mirror)
- [ ] With LAN mirror in use: `GET /api/updates/mirror-health` on factory server shows `latest.yml` for the channel you published
- [ ] **LAN-only test** (optional): block outbound internet on one pilot laptop; confirm update still checks/downloads when mirror is populated
- [ ] **Fallback test** (optional): stop factory server or empty mirror; confirm launcher shows `Feed: github` or recovers after `updater-fallback-github-after-lan-error` in audit log
- [ ] **Release notes** enabled when an update is available; link opens in browser
- [ ] **Export diagnostics** produces JSON; file opens and contains `update`, `auditLogTail`, `pm2`
- [ ] After install + restart, **update applied** banner appears once; **Dismiss** clears it
- [ ] `data/desktop-launcher/update-events.jsonl` present; rotated archives only if log grew past policy cap

### Sign-off

- [ ] Operator + verifier initials: ______ / ______

**Fails any check → stop.** Restore backup (`data`, uploads, `.env`), restart prior build. Open ticket.

Full detail: **[UPDATE_RUNBOOK.md](UPDATE_RUNBOOK.md)**
