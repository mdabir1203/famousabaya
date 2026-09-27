# AGENTS.md — AbaYa-Track

This file is the **single source of truth for the data-shape and schema rules**
that keep the local factory server, the local SQLite snapshot, and the
Cloudflare D1 database in lock-step.

If you are an AI agent or developer about to make a non-trivial change to
`server.js`, `shared/sqlite-snapshot.cjs`, `cloudflare/src/**`, or the
catalog/roster ingest paths, **read this file first** and update it
alongside your change so the next person doesn't have to rediscover the
rules.

The factory operator's rule: **whenever we do an update it must not mess it
up.** This file exists to make that rule executable.

---

## 1. The `emp_id` contract — `e_bc_<digits>` only

Real factory employees have stable ids of the form `e_bc_<barcode>`
(`e_bc_00000121`, `e_bc_136`, `e_bc_999999`). These are set by the local
server's xlsx-based roster and pushed to the cloud via `/api/event`.

**Anything else is synthetic and must be dropped at the boundary.** Synthetic
ids in the wild:

- `e1` … `e26` — short numeric ids from old smoke tests
- `test-smoke-emp`, `TEST_*`
- `ALIGN_DEMO_*`, `POSTDEPLOY_PROBE`
- Any future debug/probe id that is not in the roster

Three enforcement layers, all required:

| Layer | File | Rule |
|---|---|---|
| Cloud ingest boundary | `cloudflare/src/handlers/ingest.js:62` | `if (!/^e_bc_\d+$/.test(incomingEmpId))` → 422 |
| Cloud D1 schema | `cloudflare/migrations/0018_reject_synthetic_emp_ids.sql` | `BEFORE INSERT … WHEN NEW.emp_id NOT LIKE 'e_bc_%' BEGIN SELECT RAISE(IGNORE); END;` |
| Local snapshot writer | `shared/sqlite-snapshot.cjs` (both loops) | `if (!/^e_bc_\d+$/.test(empIdStr)) { sessionsFilteredSynthetic += 1; continue; }` |
| Local SQL aggregations | `cloudflare/src/handlers/report.js:102`, `state.js` | `WHERE emp_id LIKE 'e_bc_%'` |

**If you add a new ingest path** (HTTP route, scheduled job, batch import,
sync endpoint, etc.) that writes to `sessions` or `active_sessions`, copy
the JS guard and the SQL trigger — both. The JS guard short-circuits the
common case with a clear error; the SQL trigger is the last line of defense
if a future code path forgets the JS check.

**If the emp_id format ever changes** (e.g. a new `e_nfc_<digits>` form for
NFC badges), update all four layers in the same commit. The regex is
`/^e_bc_\d+$/` in JS and `LIKE 'e_bc_%'` in SQL.

---

## 2. The timestamp contract — snapshot stores **seconds**, END TIME is the worker's Finish tap

The cloud D1 stores `started_at` and `ended_at` as Unix **seconds**
(`INTEGER NOT NULL`). The local factory server's offline JSON carries
timestamps in **milliseconds** (13-digit values). The snapshot's
`sessions.started_at` / `sessions.ended_at` columns are **seconds**,
matching the cloud — so the local `.db` and the cloud `D1` are byte-for-byte
drop-in.

**One source of truth for the conversion:** `shared/sqlite-snapshot.cjs →
normalizeToUnixSec(raw)`. It auto-detects ms vs sec by magnitude: anything
> 1e12 is ms (year 2001+ in seconds is still < 1e10; 1e12 seconds is year
33658), anything ≤ 1e12 is seconds.

### 2.1 The END TIME contract — operator-visible invariant (v1.2.44)

The `ended_at` field stored in `sessions` (and rendered on the day-report
modal's END TIME column) MUST be the exact Unix second at which the worker
tapped Finish at the kiosk. It is NEVER to be derived from any formula
on this side of the boundary — no `started_at + duration_sec`, no
`Math.floor` rounding, no clamp to a cap, no re-derivation in the read path.

**Why this is non-negotiable:**

- The operator's audit depends on the displayed END TIME being the actual
  tap time. A Finish at 11:04 AM Dubai must display as 11:04 AM, not as
  11:00 AM (rounded) or 10:00 AM (clamped to a shift boundary).
- The cloud's `windowedActiveTimeSec` and `overlapSecWithWindows` compute
  `duration_sec` (in-shift minutes), which is a DIFFERENT concept and
  belongs in its own column. The DURATION cell on the dashboard shows
  `duration_sec`; the END TIME cell shows `ended_at`. Don't mix them.
- Pre-v1.2.43 history: `/api/admin/close-stale-sessions` pushed a fresh
  `session_finish` each call on the same orphan, with `ended_at =
  Date.now()` at the moment of close. This created the "Wahid's row on
  2026-09-16 had 3 end times" bug. v1.2.43's idempotency guard prevents
  future occurrences; the runtime assertions in
  `cloudflare/src/handlers/ingest.js` and the unit tests in
  `tests/ceo-report.test.mjs` (handleEmployeeDay preserves ended_at
  byte-for-byte) catch any future regression.

**Three enforcement layers:**

1. **LAN-side**: `server.js → req_finishWork` sets `end = Date.now()`
   at the moment of the Finish tap and pushes it verbatim to the cloud.
   The `isDuplicateSessionFinish` guard (v1.2.43) prevents re-pushes.
2. **Cloud-side**: `cloudflare/src/handlers/ingest.js` runtime
   assertions (v1.2.44) reject any `session_finish` push where
   `ended_at <= 0`, `ended_at <= started_at`, or `ended_at` is not a
   finite number. The cloud never overwrites `ended_at` with a derived
   value.
3. **Read-side**: `cloudflare/src/handlers/employee-day.js` and
   `cloudflare/src/ui/ceo-pages.js` pass `ended_at` through unchanged.
   The UI does a pure formatting operation
   (`new Date(sec * 1000).toLocaleTimeString({timeZone: 'Asia/Dubai'})`)
   that doesn't modify the underlying number.

If you ever need to change this — for example, to support a kiosk that
sends a partial-second timestamp — extend `normalizeToUnixSec` to handle
the new shape, don't introduce a recompute in the cloud read path.

### 2.2 The audit-attribute mirror contract (v1.2.47)

The day-modal sessions list stamps two DOM data attributes per row:
`data-started-at-ms` and `data-ended-at-ms`. These carry the raw epoch
**seconds** that the kiosk captured at the moment of Start / Finish tap
(trace: `server.js:2360` for Start, `server.js:2430` for Finish; pushed
verbatim by `cloudflare/src/handlers/ingest.js`). The UI multiplies by
1000 only when stamping into the DOM, so the value matches `Date.now()`'s
ms shape — but the underlying number is never derived.

The contract mirrors §2.1 verbatim: any future agent who introduces a
recompute, clamp, or round-to-day in the read path fails the
`handleEmployeeDay response is ready for the day-modal audit data attrs
(v1.2.47)` test (asserts `s.started_at === 1784005200` and
`s.ended_at === 1784008800` byte-for-byte from the LAN push).

A cross-day session (Start at 11:02 PM, Finish at 9:22 AM next day) is
ONE row on the day modal — not split. The day modal anchors on
`day_date` of the Start, and `data-started-at-ms` / `data-ended-at-ms`
both carry the literal tap times regardless of calendar day.

The function also handles **both** field-name shapes:

```js
const startedSec = normalizeToUnixSec(r.started_at != null ? r.started_at : r.start);
const endedSec   = normalizeToUnixSec(r.ended_at   != null ? r.ended_at   : r.end);
```

- `started_at` / `ended_at` — the canonical shape, produced by
  `server.js:1202-1205` (cloud hydration).
- `start` / `end` — the legacy shape, still produced by some import paths.

**Do not** write a new "third" field name. If the offline JSON ever
changes shape again, extend the `??` fallback in the snapshot writer
and the same line in `server.js`'s hydration, in the same commit. A unit
test in `tests/sqlite-snapshot.test.mjs` covers both shapes.

---

## 3. The schema-mirroring rule

The local snapshot's DDL (`shared/sqlite-snapshot.cjs → SCHEMA_DDL`) must
mirror the cloud D1's DDL (`cloudflare/schema.sql` + all migrations) for
every column the snapshot's consumers read. Mismatch causes the local
dashboard to silently disagree with the CEO cloud view.

**Checklist when adding a D1 migration:**

1. Open `cloudflare/migrations/00NN_*.sql` and read every `ALTER TABLE … ADD
   COLUMN`.
2. Open `shared/sqlite-snapshot.cjs` and add the same column to the
   matching `CREATE TABLE` block. Use the same SQLite type, the same
   default, the same nullability.
3. Update the matching `INSERT … VALUES (?, …)` to bind the new column
   (with a safe default if the source data may be missing).
4. Add a unit test to `tests/sqlite-snapshot.test.mjs` that asserts the
   column exists in the snapshot's DDL.

Currently mirrored:

| Table | Columns | Cloud migration |
|---|---|---|
| `sessions` | base schema | `schema.sql` |
| `active_sessions` | + `effective_started_at`, `windowed_elapsed_sec`, `outside_shift`, `is_cross_day` | `0016_active_session_live_state.sql` |
| `daily_stats` | base schema + all `*_units` columns | `schema.sql` |
| `abaya_catalog` | + `is_custom` | `0019_add_is_custom_to_abaya_catalog.sql` |
| `abaya_time_map`, `catalog_meta`, `worker_settings`, `employees`, `snapshot_meta` | base schema | `schema.sql` |

The cloud also has BEFORE INSERT triggers on `sessions` /
`active_sessions` (migration 0018) and other migrations. **Triggers do
not need to be mirrored in the snapshot** — the local writer's JS guard
is the equivalent enforcement. If a new trigger is added, add a comment
in `SCHEMA_DDL` pointing to the cloud migration so a future maintainer
knows the JS code is the mirror.

---

## 4. The process-canonicalization contract

The cloud D1 stores `emp_process` in canonical Title case
(`'Tailor (01)'`, `'Hand Work'`, `'Stone Work'`, …). The local snapshot
must produce the same string, or the per-process totals on the local
dashboard will contradict the CEO view.

**The cloud is the source of truth:** `cloudflare/src/domain/process.js →
canonicalEmpProcess`. The local writer has a sibling at
`shared/sqlite-snapshot.cjs → canonicalProcess` that must stay byte-equal
in behavior (modulo the .cjs / .mjs boundary).

When the cloud adds a new alias (e.g. the 2026-08-31 `khaka work` →
`Hand Work` rule), copy it to the local function **in the same commit**.
A unit test in `tests/sqlite-snapshot.test.mjs` exercises the full alias
matrix so drift is caught at `npm test`.

`PROCESS_TO_DAILY_COL` maps each canonical process to a column in
`daily_stats`. Adding a new process name requires three things:

1. Add it to `cloudflare/src/domain/process.js → WORK_TYPES`.
2. Add its `*_units` column to `cloudflare/schema.sql → daily_stats` (and
   a matching `ADD COLUMN` migration) **and** to
   `shared/sqlite-snapshot.cjs → SCHEMA_DDL → daily_stats`.
3. Add the mapping to `PROCESS_TO_DAILY_COL` in **both** the cloud and
   the local writer.

If a process name lands in the snapshot that isn't in the map, the writer
silently buckets it under `tailor_01_units` (the default in
`dailyStatsColumnForProcess`). This is documented behavior — the operator
notices via the inflated count, then updates the map. **Do not throw
on unknown processes** — that would silently drop data the floor cares
about.

---

## 5. The catalog column contract

`abaya_catalog` is the operator-managed style catalog. Any new column
the operator can set (e.g. `is_custom` from migration 0019) must be
round-tripped:

- Cloud: `modules/catalog.js` ingest path writes the column; `cloudflare/
  src/handlers/employee-day.js` and `state.js` read it.
- Local snapshot: `shared/sqlite-snapshot.cjs → SCHEMA_DDL → abaya_catalog`
  has the column, and the `INSERT OR REPLACE` binds it (defaulting to 0
  / `''` if the source row doesn't have it).

The `is_custom` flag is the canonical example: the operator runs
`UPDATE abaya_catalog SET is_custom = 1 WHERE id = '3439'` on the cloud,
the cloud pushes the row via `PUT /api/catalog/abayas`, the local server
re-broadcasts the catalog to the snapshot writer, and the snapshot's
`abaya_catalog.is_custom` ends up 1. The live row's "this build" cell
then renders a "Custom" pill (`ceo-pages.js:1353+`).

---

## 6. The version + meta-honesty contract

`completed_count` in `snapshot_meta` is the count of rows **actually
inserted** into `sessions` — not the input count. If filtering is
active, `completed_logs_received` preserves the input count, and
`completed_logs_filtered_synthetic` records how many were rejected. The
invariant for any new filter:

```
completed_count + completed_logs_filtered_synthetic + (other drops) == completed_logs_received
```

`active_count` is similarly the actual `active_sessions` insert count.
Never replace these with input counts — the factory operator has been
bitten before by `completed_count: 5898` over a `sessions: 0` table
(see the v1.2.17 release notes).

`format_version` is `1` and stays `1` until the schema breaks wire
compatibility. Adding columns with safe defaults does **not** bump
`format_version`. Removing a column, renaming one, or changing a
column's type does.

---

## 7. The release pipeline

User-facing version (`tools/desktop-launcher/package.json`):

- Bump on every shipped fix.
- Bump the `patch` segment (1.2.14 → 1.2.15) for bug fixes.
- Bump the `minor` segment (1.2.14 → 1.3.0) for new features / schema
  additions.
- **Audit version continuity before starting a new fix.** Before bumping
  the version for a new fix, run `git log --oneline v<prev>..HEAD` and
  check that the output covers every intermediate version. If commits exist
  in a **disconnected branch** (e.g. `install-coherence-*`) that are
  ahead of the last documented release, they must be merged or rebased
  before the new version ships. A version bump in `package.json` without
  the corresponding release notes is a red flag — trace all commits
  between the last documented version and HEAD to ensure nothing was
  skipped. The v1.2.46–1.2.49 gap (coherence branch not merged to main)
  is the canonical incident this guard prevents.
- Add a release note to `docs/releases/vX.Y.Z.md` describing:
  - The bug / feature in one sentence.
  - The exact files / migrations that changed.
  - What factory PCs will see (or what they need to do).

`package.json` (root) tracks the package's own version and feeds
`scripts/build-release.ps1` to name the portable ZIP. Bump it in lock-step
with the desktop-launcher.

The bundled v1.2.13 artifact at
`tools/desktop-launcher/install-v1213-build/win-unpacked/resources/` is a
**stale build output**. The next `electron-builder` run regenerates it
from source. **Do not hand-edit it** — that creates drift between the
installer's resources and the repo.

---

## 8. The test-as-spec contract

`tests/sqlite-snapshot.test.mjs` is the executable specification for this
file's rules. If you add a rule here, add a test. If you change a rule,
update the test. Run `npm test` before every commit.

The tests cover:

- New field names (`started_at` / `ended_at`) and legacy field names
  (`start` / `end`) both land in `sessions`.
- Synthetic emp_ids are filtered and counted in
  `completed_logs_filtered_synthetic`.
- Timestamps are stored in **seconds** (not milliseconds).
- `active_sessions` rejects synthetic emp_ids.
- Meta keys are honest: `completed_count` reflects actual inserts.
- `canonicalProcess` mirrors the cloud's full alias matrix.
- `active_sessions` DDL has the cloud migration 0016 columns.
- `abaya_catalog` DDL has `is_custom` and preserves it on round-trip.
- New emp_id forms (`e_bc_999999`, `e_bc_00001000`) keep working.
- Unknown process names bucket into `tailor_01_units` (silent default).

---

## 9. The "do not silently drop data" rule

If the snapshot writer doesn't know how to interpret a field, **it must
either store the value as-is or use a documented default** — never skip
the row silently. The factory operator depends on every session landing
in the snapshot. The 2026-08-31 `sessions: 0` bug existed for exactly
this reason: the writer's `if (!Number.isFinite(startedSec)) continue`
silently dropped every row when the field name drifted.

Three fallbacks, in priority order:

1. **Use the value as-is** (e.g. `canonicalProcess` passes unknown process
   names through unchanged).
2. **Use a documented default** (e.g. `tailor_01_units` for unknown
   process; `0` for `is_custom` when missing; `null` for
   `effective_started_at` when the local server doesn't push it).
3. **Filter and count** (e.g. the `e_bc_*` filter increments
   `sessionsFilteredSynthetic` so the operator can spot a misconfigured
   client).

`continue` without a counter is a bug.

---

## 10. The change-pre-check checklist

Before any commit that touches `shared/`, `cloudflare/src/`,
`server.js`, or the catalog/roster ingest paths, run through this list:

- [ ] Did I add / change / remove any column the snapshot DDL mirrors?
  → Update `shared/sqlite-snapshot.cjs → SCHEMA_DDL` and add a test.
- [ ] Did I change a process alias, add a new one, or change a
  `PROCESS_TO_DAILY_COL` mapping?
  → Mirror the change in **both** `cloudflare/src/domain/process.js` and
  `shared/sqlite-snapshot.cjs` and update the alias-matrix test.
- [ ] Did I add a new ingest path that writes to `sessions` or
  `active_sessions`?
  → Add the `e_bc_*` JS guard **and** the `RAISE(IGNORE)` SQL trigger.
- [ ] Did I add a new local finish path (a place that deletes from
  `ACTIVE_SESSIONS` and pushes `session_finish`)?
  → Call `recentFinishTombstone.note(emp_id)` immediately after the
  `delete ACTIVE_SESSIONS[emp_id]` so the cloud-stale resurrection
  race doesn't flash the worker back as "Working" on the kiosk. See
  §11.1 below for the contract.
- [ ] Did I change a timestamp's unit or a field's name in the offline
  JSON?
  → Update both `server.js`'s hydration and `shared/sqlite-snapshot.cjs`'s
  `normalizeToUnixSec` + field-name fallback.
- [ ] Did I touch `ended_at` in any path — LAN push, cloud ingest,
  read handler, or UI formatter?
  → It MUST be the worker's Finish tap time, preserved verbatim from
  `Date.now()` at the moment of tap. NEVER derive it (no
  `started_at + duration_sec`, no clamp, no round). The runtime
  assertions in `cloudflare/src/handlers/ingest.js` and the unit
  tests in `tests/ceo-report.test.mjs` (`preserves ended_at
  byte-for-byte`) enforce this contract. See §2.1.
- [ ] Did I change `completed_count`, `active_count`, or any other
  `snapshot_meta` key?
  → Make sure the new value matches what's actually in the table
  (the meta-honesty contract).
- [ ] Did I bump the user-facing version?
  → `tools/desktop-launcher/package.json` (and the root `package.json` if
  the release pipeline cares), plus a `docs/releases/vX.Y.Z.md` note.
- [ ] Did I run `npm test`?
  → All 199 tests pass (19 pre-existing failures: 17 sql.js path
  resolution on Windows + 2 LAN-side regressions documented in v1.2.50
  release notes — v1.2.31 `req_finishWork` and v1.2.32
  `dropGhostActiveSessions`. Verify with `git stash` + `npm test`
  before blaming your change).
- [ ] Did I run `node scripts/verify-deploy.mjs` against the live
  dashboard BEFORE pushing a deploy?
  → Real browser screenshots + DOM assertions for the surface I
  touched. Per the v1.2.47 verification policy: every change to a
  dashboard-facing handler, UI render, or operator-visible aggregation
  ships with a `VERIFICATION.md` that has at least one screenshot per
  scenario and at least one DOM-assertion line per claim. The skill
  (loaded via `skill({ name: "verification-rigorous" })`) is the
  source of truth for the procedure; the runnable wrapper at
  `scripts/verify-deploy.mjs` invokes it against the deployed worker
  and blocks the deploy on FAIL. See §12 below.

## 11. The read-path scrub contract — drop ghosts + dups at the SQL layer (v1.2.45)

The cloud's `active_sessions` and `sessions` tables may contain noise the
factory's pre-v1.2.44 server is still pushing:

- **Ghost `active_sessions` rows** — `emp_id` not in the current roster
  (`e_bc_999998` sentinel, `e_bc_00000141 / Ashanfi`, future rosters).
- **Orphan `active_sessions` rows** — `started_at` older than 24h with
  no matching `session_finish` (close-stale-sessions never ran, or
  crashed before pushing).
- **Duplicate `sessions` rows** — same `(emp_id, started_at)`, different
  `ended_at` from pre-v1.2.43 close-stale-sessions re-pushes. The cloud
  D1 PK is `'WL-' + emp_id + '-' + ended_at` so each variant landed as
  a new row.

The migration files (0022 ghost cleanup, 0023 dup dedup) are one-time
fixes; new ghost/dup rows keep accumulating until every factory
laptop picks up v1.2.43+ with the server-side idempotency guard. Until
then, the **cloud read path** is responsible for hiding this noise from
the CEO dashboard.

`cloudflare/src/domain/data-cleanup.js` is the source of truth for the
two scrub predicates:

```js
import { activeSessionWhere, dedupSessionsCte } from '../domain/data-cleanup.js';

// active_sessions: only current roster + last 24h
const stmtActive = env.DB.prepare(`
  SELECT ... FROM active_sessions WHERE ${activeSessionWhere(nowSec)} ORDER BY started_at ASC
`);

// sessions: dedup (emp_id, started_at) clusters, keeping max(ended_at)
const stmtSome = env.DB.prepare(`
  ${dedupSessionsCte()}
  SELECT s.* FROM sessions s JOIN survivors w ON w.id = s.id
  WHERE s.day_date = ?
`);
```

Apply `activeSessionWhere` to **every** `FROM active_sessions` read that
is dashboard-facing (state.js live tile, report.js active rows). Apply
`dedupSessionsCte` to **every** `FROM sessions` **aggregation** that the
dashboard renders — not just per-row fetches. As of v1.2.46 this
includes:

- `state.js` — `stmtPerf` / `stmtAgg` / `stmtProcSplit` / `stmtHourly` /
  `stmtGarment` / `stmtAbayasDelivered` and any other `GROUP BY` over
  `sessions`.
- `report.js` — `by-employee` / `by-process` aggregations that the
  CEO report renders.
- **`employee-day.js` — `recent_days` (30-day history strip on the day
  modal) AND `nearby_dates` (empty-day "X units" chip)**. This is the
  fix from v1.2.46: PROCESS COMPLETED on the modal header used the
  in-memory dedup pass for `data.totals.units` but the history strip
  used a raw `COUNT(*) GROUP BY day_date`, so a worker-day with one
  stale dup-pushed row would show "4u" on the strip while PROCESS
  COMPLETED correctly said 3 — operator-visible contradiction inside
  the same modal. Now both go through `dedupSessionsCte()`.

Per-row fetches within `employee-day.js` (the in-modal `sessions` list
itself) and `ingest.js` keep their own dedup logic — those are called
with a known emp_id and they need the original `(started_at, ended_at)`
order intact for the END TIME display. The aggregation queries are
the surfaces that must use the CTE.

**If you add a new dashboard-facing handler that does `COUNT(*)`,
`SUM`, or any `GROUP BY` over `sessions`**, copy both helpers in the
same commit. In-memory JS dedup is NOT sufficient — the per-day history
strip bug is exactly what happens when JS dedup is applied to one
surface but not the other.

**Three enforcement layers:**

1. **Live tile (`/api/state` → `stmtActive`)** — drops ghost and orphan
   rows from the dashboard's Live Active Sessions section.
2. **Aggregations (`/api/state` → `stmtPerf`/`stmtAgg`/`stmtProcSplit`/
   `stmtHourly`/`stmtGarment`/`stmtAbayasDelivered`)** — counts and
   sums are computed after dedup, so PROCESS COMPLETED, WORK TIME,
   ABAYAS DELIVERED, EMPLOYEE PERFORMANCE all reflect unique sessions.
3. **Recent logs (`/api/state` → `stmtLogs`)** — `emp_id LIKE 'e_bc_%'`
   guard filters synthetics out of the Recent Invoice Logs table.

If you add a new dashboard-facing handler that reads from
`active_sessions` or `sessions`, copy both helpers in the same commit.
The unit tests in `tests/data-cleanup.test.mjs` pin the SQL shape and
the roster size invariant.

### 11.1 Offline dashboard parity (v1.2.49)

The offline dashboard at `public/dashboard.html` (served from the LAN
kiosk at `192.168.0.101:3111/dashboard`) is the operator's primary
surface — it's open on the supervisor's laptop all day, while the
cloud CEO dashboard is checked once a morning. Visual changes need to
land in **both** places or the operator's eye gets confused.

Three helpers in `public/dashboard.js` mirror the v1.2.47 cloud treatment:

- `abayaAccentFor(abayaId)` — deterministic HSL accent. Same hash
  formula as `cloudflare/src/ui/ceo-pages.js → edRowAccent` so the
  two dashboards agree on which abaya gets which border.
- `abayaCustomPillFor(abayaId)` — "Custom" pill HTML for the row when
  the local catalog has `is_custom=1`. Same purple as the cloud.
- `rowAuditAttrsFor(l)` — stamps the six `data-*` audit attributes
  (`data-session-id`, `data-emp-id`, `data-abaya-id`,
  `data-abaya-code`, `data-started-at-ms`, `data-ended-at-ms`).
  Cloud uses `WL-<emp_id>-<ended_at>` (D1 PK) for `data-session-id`;
  offline uses `<emp_id>-<started_at>` composite because the LAN has no
  matching PK shape. The other five attrs are byte-equal to the cloud.
  `started_at` / `ended_at` are the kiosk's verbatim `Date.now()`
  values (§2 / §2.1 / §2.2), preserved without recompute.

The three row renderers (Live Active Sessions, Recent Checker Logs,
Recent Invoice Logs) each call `rowAuditAttrsFor(l)` once per row. If
you add a new session-style surface, copy the call site — don't copy-
paste the individual attrs, that risks duplication.

`tests/dashboard-per-abaya.test.mjs` pins the helpers (4 source-grep
+ 4 sandbox behavioral tests). Pure-function checks via `new Function(...)`
sandbox follow the same pattern `tests/dashboard-live-tick.test.mjs`
uses for `computeInShiftSec` / `computeActiveTodaySec`.

### 11.2 The recent-finish tombstone (v1.2.51) — defends the kiosk against cloud-stale resurrection

The factory local server is the source of truth for who is currently
working on the floor (§1 / §11 above). When a worker taps Finish at
the kiosk, the LAN immediately removes them from `ACTIVE_SESSIONS`
and broadcasts the new state to every kiosk client — the worker
disappears from the live board within ~50 ms.

The cloud's `active_sessions` table is a write-through cache of past
`session_start` events. The factory pushes `session_finish` when a
worker taps Finish, and the cloud's ingest handler deletes the
matching row from `active_sessions` at that moment. Both legs happen
on best-effort — push latency is 200 ms-2 s in healthy conditions, up
to 30 s on a busy cell tower or with auth retries. The push can also
fail (network blip, worker 5xx) and sit in the
`ceo-ingest-queue.jsonl` retry buffer for `CEO_INGEST_RETRY_MS` (30 s).

`refreshCloudToday` runs every 30 s and pulls the cloud's view of
active sessions. **Before v1.2.51** it merged any cloud row that had
no matching local entry back into `ACTIVE_SESSIONS` — assuming the
cloud's view was authoritative. This was wrong for the same-laptop
case: if the LAN just removed Arman via a worker Finish tap, the
cloud's stale "still active" row was not authoritative — the LAN was.
The kiosk would then briefly show Arman as working again, ~30-60 s
after his Finish tap, until the push eventually landed.

**Fix**: track a short-lived in-memory tombstone per `emp_id` on the
LAN server. While the tombstone is live, the cloud-active merge skips
that `emp_id` so the LAN's "this worker is finished" view stays
authoritative until the cloud catches up.

The tombstone lives at `shared/recent-finish-tombstone.cjs`. The
helper is pure (Map + TTL) and exposes `note()` / `isLive()` /
`consume()` / `pruneExpired()` / `size()` / `clear()`. Default TTL is
5 minutes (configurable via `RECENT_FINISH_TOMBSTONE_MS`, floor 30 s)
— comfortable against any realistic push-retry cadence. The merge
logic is in `shared/cloud-active-merge.cjs`, extracted from
`server.js → refreshCloudToday` so it can be unit-tested without
spinning up a server subprocess.

**Three call sites** for `note()`:

1. `server.js → req_finishWork` — the worker-tapped-Finish path.
2. `server.js → /api/admin/close-stale-sessions` — the operator-driven
   orphan-close path.
3. (Future: any new local finish path. Add the call alongside the
   `delete ACTIVE_SESSIONS[emp_id]`.)

**One consumer** for `isLive()`:

1. `server.js → refreshCloudToday` — the cloud-active merge loop
   checks `recentFinishTombstone.isLive(empId)` for each row. A live
   tombstone increments `stats.activeSuppressedByTombstone` and skips
   the row.

**Memory hygiene**: `setInterval` runs every 60 s and calls
`pruneExpired()`. Logs `[recent-finish-tombstone] pruned N expired
entries` only when there's something to report.

**Scope**:

- Per-process / in-memory only. Lost on server restart. That's
  correct: on restart the LAN re-hydrates `ACTIVE_SESSIONS` from the
  offline-report snapshot, and a stale cloud row would correctly
  re-hydrate any worker that is actually still on the floor.
- Not shared between factory laptops. **Known gap**: if Laptop A's
  `session_finish` push fails AND Laptop B is running, Laptop B's
  `refreshCloudToday` could still resurrect the worker. Fixing that
  requires either a cloud-side tombstone or LAN coordination, neither
  of which is in scope for v1.2.51. The 5-minute TTL still bounds the
  problem (after 5 min the cloud's stale row will eventually trigger a
  visible resurrection, surfacing the underlying push failure to the
  operator rather than hiding it forever).

**Tests**:

- `tests/recent-finish-tombstone.test.mjs` — 14 unit tests covering
  TTL behavior, refresh, prune, edge cases, and an integration
  scenario that walks the actual Arman Reza timeline (T=0 finish,
  T=2 s merge skip, T=30 s push retry, T=5m tombstone expires).
- `tests/cloud-active-merge.test.mjs` — 14 unit tests covering the
  tombstone-aware merge behavior: baseline (no tombstone) adds the
  worker (legacy); tombstone live → skip + count as suppressed;
  tombstone expires → resume adding; new Start within tombstone
  window → LAN fields preserved; mixed workload (tombstoned + free);
  roster translation; defensive callbacks.

If you change the tombstone TTL default, the merge loop, or add a new
local finish path, mirror the change in:

- `shared/recent-finish-tombstone.cjs` — the helper.
- `shared/cloud-active-merge.cjs` — the merge call site.
- `server.js` — the tombstone declaration + the three call sites.
- `tests/recent-finish-tombstone.test.mjs` and
  `tests/cloud-active-merge.test.mjs` — extend or add tests.

### 11.3 The LAN-local-vs-cloud-stale class (v1.2.52) — defending catalog, employees, work-types, and the boot hydrate

§11.2 documents the **recent-finish tombstone**, the v1.2.51 fix for the
"Arman Reza resurrection" bug. That fix is one instance of a wider
class of bug: **the LAN mutates state locally, the LAN→cloud push is
in flight, and the cloud→LAN pull overwrites the LAN's fresh state
with the cloud's stale view before the push lands.**

v1.2.51 only defended `ACTIVE_SESSIONS`. The same class of race exists
in three other places that the operator hits regularly:

| Where | Race | v1.2.52 fix |
|---|---|---|
| `refreshAbayaCatalogFromCloud` (every 60 s) | Operator marks `is_custom = 1` locally; push is in flight; pull arrives with `is_custom = 0` from cloud → operator's edit vanishes | `catalogLocalMutationTombstone` — note on every catalog mutation site, skip the pull while live |
| `refreshEmployeesFromCloud` (every 60 s, same shape) | Operator adds/removes/renames an employee; pull reverts it | `employeesLocalMutationTombstone` — same pattern |
| `refreshWorkTypesFromCloud` (every 60 s, same shape) | Operator edits work types (e.g. adds "Stone Work"); pull reverts it | `workTypesLocalMutationTombstone` — same pattern |
| `hydrateCompletedLogsFromCloud` (boot-time, 5-30 s round-trip) | Worker taps Finish while the cloud history fetch is in flight; hydrate overwrites local-only rows | Local-overlay merge (`shared/cloud-history-merge.cjs`) — append local rows that don't duplicate a cloud row by `id` or `(emp_id, started_at)` |

**All four are the same root cause class.** If you add a new
cloud→LAN pull path that mutates LAN state, audit it against this
table before shipping. If the table doesn't cover your case, add a
new tombstone + tests, don't skip it.

#### The `recent-mutation-tombstone` helper

`shared/recent-mutation-tombstone.cjs` is the resource-level sibling
of `shared/recent-finish-tombstone.cjs`:

- `recent-finish-tombstone` — keyed by `emp_id` (Map), TTL-bounded,
  per-Finish. Used by `refreshCloudToday` to skip a specific emp_id.
- `recent-mutation-tombstone` — global per-resource (single
  timestamp), TTL-bounded. Used by the catalog/employees/work-types
  pulls to skip the whole merge while ANY local mutation is in flight.

Both helpers are pure, in-memory, lost on restart (correct: a
restart re-hydrates from the offline snapshot, and the next pull
sees a clean slate). Both default to TTL ≥ push latency +
`CEO_INGEST_RETRY_MS` ceiling (30 s default; configurable via
`RECENT_CATALOG_MUTATION_TOMBSTONE_MS`,
`RECENT_EMPLOYEES_MUTATION_TOMBSTONE_MS`,
`RECENT_WORK_TYPES_MUTATION_TOMBSTONE_MS`; floor 5 s).

#### The `cloud-history-merge` helper

`shared/cloud-history-merge.cjs` is the boot-hydrate sibling. It's
not a tombstone because the boot hydration is a one-shot pull, not
a periodic merge: while the `/api/state/history` fetch is in flight
(5-30 s), capture any local rows that arrive, then dedup-and-append
to the cloud view. The function is pure:

```js
mergeCloudHistoryWithLocalOverlay(cloudRows, localRows) → {
  merged,
  localPreserved,            // brand-new local rows kept
  localDuplicatesSkipped,    // local rows that duplicate a cloud row
}
```

Dedup is by `id` (the cloud's `WL-<emp>-<ended_at>` stable id) OR by
`(emp_id, started_at)` composite key. Catches both the "push landed
during the fetch" case (id match) and the "push hasn't landed yet"
case (composite key match). Conservative: malformed rows are
preserved rather than dropped — losing a real session row is worse
than double-counting a malformed one.

#### Catalog / employees / work-types mutation callsites that `note()` the tombstone

These are the LAN-local-write paths that mark the LAN as
authoritative. Every new cloud-LAN merge path that mutates local
state needs a matching `note()` here.

Catalog (3 sites):
- `loadCatalogFromXlsxFile` — auto-watch reload from `CATALOG_XLSX_PATH`
- `/api/catalog` PUT handler — operator PUT
- `/api/catalog-xlsx/upload` — xlsx upload handler

Employees (3 sites):
- `loadEmployeesFromManualFile` — manual JSON reload
- `loadEmployeesFromXlsxFile` — xlsx reload
- `persistEmployeeRosterAndReload` (manual JSON branch) — operator CRUD

Work-types (2 sites):
- `loadWorkTypesFromJsonFile` — disk reload (may pick up operator edits)
- `saveWorkTypesToJsonFile` — operator-edit persistence

**If you add a new mutation path for any of these three resources,
add `note<X>LocalMutation()` at the assignment to `<X>`.** The wiring
audit at `tests/server-cloud-pull-guards.test.mjs` greps server.js
to confirm the callsite count matches the expected number — a new
path without a matching `note()` is caught by extending that test.

#### Known gaps

The v1.2.52 fixes are scoped to the four paths in the table above.
Other cloud-LAN sync paths that share the same root cause but are
NOT yet defended:

- **Multi-laptop LAN-B race** — if Laptop A's push fails AND Laptop
  B's pull runs before the next retry, Laptop B's view overwrites
  Laptop A's edit. The tombstone only defends the single-laptop
  case. Fix requires either a cloud-side "row touched" cache or LAN
  coordination; both out of scope for v1.2.52. The 30 s TTL still
  bounds the worst case to 30 s of staleness.
- **Cloud-pulled catalog with no LAN→cloud push** — the
  `loadCatalogFromXlsxFile` auto-watch path mutates `abayaCatalog`
  locally but doesn't push to the cloud (a separate bug). The
  tombstone defends the LAN for 30 s; after that, the pull CAN
  revert the auto-reload. The operator notices and re-uploads. The
  missing-push is a separate feature/bug.
- **Cloud-pulled roster during the LAN-side pre-hydrate window** —
  `seedRosterFromCloudIfLocalMissing` reads from cloud and writes
  to local. It's a boot-time seed (one-shot), not a periodic pull,
  so the tombstone isn't relevant. The next `refreshEmployeesFromCloud`
  after 60 s could pull from cloud (which by then has the seed) —
  no race here.

#### Tests

- `tests/recent-mutation-tombstone.test.mjs` — 13 unit tests on the
  helper (TTL behavior, NaN/Infinity rejection, custom clocks,
  clear).
- `tests/cloud-history-merge.test.mjs` — 15 unit tests on the merge
  helper (id-dedup, composite-key-dedup, malformed-row handling,
  realistic mixed loads, custom extractors).
- `tests/server-cloud-pull-guards.test.mjs` — 12 source-grep audits
  that pin the wiring: every mutation callsite calls the right
  `note()`, every pull guards on the right `isLive()`, the boot log
  surfaces all three tombstones, the hydrate uses the merge helper
  (no raw `COMPLETED_LOGS = hydrated` overwrite).

**Test count for v1.2.52: 40 new tests, all green.** Total repo
test count after this release: 255 (was 215 before v1.2.51 + v1.2.52).

#### Apply when

- Adding a new cloud→LAN pull path that mutates local state (catalog,
  employees, work-types, or any future resource): add a tombstone +
  `note()` callsites + tests. Don't ship the pull without the
  guard.
- Adding a new local-mutation callsite for an existing resource:
  add `note<X>LocalMutation()` at the assignment to the resource
  array. Extend `tests/server-cloud-pull-guards.test.mjs` if the
  count changes.
- Adding a new boot-time hydrate pull: extract the per-row merge
  logic into a shared pure helper (mirror `cloud-history-merge.cjs`),
  call it from server.js, write unit tests.
- The user reports a new variant of "my edit vanished" / "this
  row came back from the cloud after I changed it locally" — check
  this table. The fix is a tombstone at the pull, mirroring the
  v1.2.52 pattern.

---

## 12. The verification-before-deploy policy (v1.2.47)

Every change that touches a dashboard-facing surface (handler in
`cloudflare/src/handlers/`, UI render in `cloudflare/src/ui/`,
operator-visible aggregation, the kiosk's Start/Finish flow, or any
file that can alter what the factory operator sees on screen) ships
with a `VERIFICATION.md` produced by **real browser interaction**, not
code review or unit tests alone. The factory local server's
`PORT=3111` server is unreachable from outside the LAN, so a
test-only "did it run" smoke test is not sufficient — the change has
to render correctly in the actual deployed cloud dashboard at
`https://dashboard.farewellabaya.com`.

**The wrapper script (`scripts/verify-deploy.mjs`)** drives the full
loop:

1. **Preflight.** Confirms the deployed URL returns a 200, that the
   expected version tag is reachable, that Playwright + Chromium are
   installed, and that the CEO_TOKEN environment variable is present
   (passed interactively, never committed). Fails fast with a clear
   reason if any of these is missing — never pushes a half-verified
   deploy.
2. **Sign in.** Loads the CEO login page, fills the password, submits,
   asserts the dashboard renders (no "Session expired" banner). Captures
   a screenshot at the post-login state.
3. **Drive the changed surface.** For each scenario derived from the
   diff (e.g. "open Mouthirrahman day modal for 09-20", "verify per-abaya
   accent on the sessions list", "verify PROCESS COMPLETED matches
   Last-30-days cell"), the script navigates to the surface, performs
   the operator-visible interaction, and asserts DOM state at the
   point of inspection. Every PASS gets a screenshot + a DOM-assertion
   log line + a console/network excerpt — the three-artifact rule.
4. **Block on FAIL.** If any scenario fails its assertions, the
   wrapper exits non-zero BEFORE running `wrangler deploy`. The deploy
   only happens after every assertion passes.
5. **Deploy.** `npx wrangler deploy` against the cloudflare/ working
   directory with the wrangler OAuth token the developer already has.
6. **Post-deploy re-verify.** Runs the same Playwright scenarios
   against the freshly deployed URL (cache-busted with `?v=<ts>`).
   Asserts the deployed worker serves the new version (worker version
   label / HTML head check). This is the second verification — the
   same eyes-on proof, but against what the operator will actually see.
7. **Emit `VERIFICATION.md`.** Single YAML frontmatter block + body
   following the format in the `verification-rigorous` skill. Includes
   scenario counts, screenshot paths, assertion logs, console excerpts,
   and an explicit verdict (pass / partial / fail). The wrapper fails
   loud if any check is missing — the skill's atomic quality
   checklist runs before the file is written.

**When the policy applies** (always run `scripts/verify-deploy.mjs`):

- Any change to a cloud handler that the dashboard reads (`/api/state`,
  `/api/report/employee-day`, `/api/report/*`, `/api/catalog/abayas`,
  `/api/employees`, the SSE stream).
- Any change to a UI render block in `cloudflare/src/ui/` (the day
  modal, the live tile, the perf list, the KPI tiles, the freshness
  pills).
- Any change to the LAN kiosk's Start / Finish flow (`server.js`'s
  `req_startWork` / `req_finishWork`, `public/kiosk.js`).
- Any change that bumps the user-facing version.

**When the policy does not apply** (skip `scripts/verify-deploy.mjs`):

- Pure backend tests (handler logic that the dashboard never reads,
  worker-internal migrations, snapshot writer columns that the local
  factory dashboard doesn't expose).
- Pure refactors that change nothing the operator can see (renaming
  an internal helper, fixing a typo in a comment, bumping a non-user
  dependency).
- Documentation-only changes.

**The "kiosk is the source of truth" rule still applies.** Even with
browser verification, the contract from §2 / §2.1 / §2.2 is the
authority on what `started_at` and `ended_at` mean. The Playwright run
asserts the dashboard's display matches the kiosk's wire format; it
does not weaken the contract.

**Failure modes the policy guards against** (drawn from the v1.2.45
incident):

- The 2026-09-23 "4u vs 3" bug went out without eyes-on the day modal
  because the unit tests passed. The verification policy adds a
  per-release browser pass that would have caught it.
- The 2026-09-16 "three end times for Wahid" dup-push bug shipped to
  the cloud because the LAN-side idempotency guard landed on the
  factory's worker schedules but the cloud read path wasn't updated.
  The verification policy requires the post-deploy re-verify step
  to confirm the dashboard reads from the new SQL surface.
- The v1.2.33 wrangler-minifier backslash collapse that broke the
  dashboard entirely shipped because the deploy was pushed on unit
  tests alone. The verification policy makes "dashboard renders post-
  deploy" the first assertion, blocking any deploy that blanks the
  page.

**Mandatory skill load before every run.** Before executing
`scripts/verify-deploy.mjs`, the developer (or agent) MUST load the
`verification-rigorous` skill via `skill({ name: 'verification-rigorous' })`.
The skill is the authoritative protocol — Phase 1 (preflight) through
Phase 8 (teardown + self-verification). Running the script without
reading the skill is a policy violation.

**The three-artifact rule is non-negotiable.** Every PASS or FAIL claim
MUST be backed by three simultaneous artifacts captured at the assertion
point:

1. A **screenshot** of the page at the moment the assertion fires.
2. A line in the **assertion log** stating the exact predicate checked
   (e.g. `OK: `.innerText === '3'`).
3. A **console or network excerpt** capturing the state at the same moment.

A scenario with only a screenshot and no assertion log line, or with
logs but no screenshot, is **incomplete** and must be re-run. The skill's
atomic quality checklist (§7 of the skill) enforces this before the report
is written.

**No silent skips.** If a change is genuinely too small to warrant a
full Playwright run (e.g. a single-line typo fix in a comment), the
developer MUST document in the release notes why the verification policy
was waived. The waiver goes in `docs/releases/vX.Y.Z.md` under a
`## Verification` heading with the specific reason. No silent skips.
