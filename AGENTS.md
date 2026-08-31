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

## 2. The timestamp contract — snapshot stores **seconds**

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
- Always add a release note to `docs/releases/vX.Y.Z.md` describing:
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
- [ ] Did I change a timestamp's unit or a field's name in the offline
  JSON?
  → Update both `server.js`'s hydration and `shared/sqlite-snapshot.cjs`'s
  `normalizeToUnixSec` + field-name fallback.
- [ ] Did I change `completed_count`, `active_count`, or any other
  `snapshot_meta` key?
  → Make sure the new value matches what's actually in the table
  (the meta-honesty contract).
- [ ] Did I bump the user-facing version?
  → `tools/desktop-launcher/package.json` (and the root `package.json` if
  the release pipeline cares), plus a `docs/releases/vX.Y.Z.md` note.
- [ ] Did I run `npm test`?
  → All 57+ tests pass.

If any box is unchecked, the commit is not ready.
