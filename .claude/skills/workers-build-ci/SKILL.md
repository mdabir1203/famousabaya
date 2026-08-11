---
name: workers-build-ci
description: Diagnose and fix the "Workers Builds: abaya-track" Cloudflare CI check when it fails on a PR. Use whenever that check goes red.
---

# Fix the "Workers Builds: abaya-track" CI check

## Verified build settings (from the dashboard, July 2026)

| Setting | Value |
|---|---|
| Root directory | `/` (repo root — **not** `cloudflare/`) |
| Build command | `yarn build` |
| Deploy command | `npx wrangler versions upload` |
| Toolchain | yarn@4.13.0, nodejs@22.16.0 |

So the pipeline is: clone → `yarn install` (immutable, repo root) → `yarn build` →
`npx wrangler versions upload` (reads **root `wrangler.jsonc`**).

`versions upload` creates a new version **without shifting production traffic** —
a failed check never breaks the live Worker.

## Reproduce locally — run the exact configured commands

```powershell
$sim = "$env:TEMP\cfsim"; Remove-Item $sim -Recurse -Force -ErrorAction SilentlyContinue
mkdir $sim; git -C <branch-worktree> archive HEAD -o "$env:TEMP\sim.tar"
tar -xf "$env:TEMP\sim.tar" -C $sim; cd $sim
corepack yarn install --immutable --mode=skip-build   # install stage
corepack yarn build                                   # build stage
bun x wrangler@latest versions upload --dry-run       # deploy stage
```

Whichever stage fails locally is the stage failing in CI. Use a **pristine `git archive`
tree** — untracked local files hide real failures.

## Failure modes seen (fixed in order; each fix advanced the pipeline one stage)

1. **`YN0028: lockfile would have been modified`** (install stage) — root `yarn.lock`
   drifted from root `package.json`.
   Fix: `corepack yarn install --mode=update-lockfile`; commit **only** `yarn.lock`
   (never `.yarn/`). Verify `--immutable` passes.

2. **`Usage Error: Couldn't find a script named "build"`** (build stage) — the build
   command is `yarn build`, so root `package.json` **must** define a `build` script.
   It is intentionally a no-op echo: wrangler does its own bundling during
   `versions upload`. **Never remove that script.**

3. **Wrong worker at repo root** (deploy stage) — the deploy runs at the repo root, so
   root `wrangler.jsonc` must describe **abaya-track** (`main: cloudflare/src/index.js`,
   D1, rate limits, vars, crons, route). It is a hand-maintained JSONC mirror of
   `cloudflare/wrangler.toml` — **keep the two in sync when either changes.**
   The kiosk static-assets worker (`abaya-server`) lives at `kiosk-pwa/wrangler.jsonc`
   (`npx wrangler deploy -c kiosk-pwa/wrangler.jsonc`).

## Verify before pushing

`versions upload --dry-run` at the repo root must print the abaya-track bundle:
**~188 KiB** with bindings `DB (abaya-db)`, 3 rate limits, 4 vars. A ~0.3 KiB
assets-only bundle means the root config regressed to the kiosk worker.

## Getting the real error

Dashboard build logs are the fastest path but are auth-gated: the local wrangler OAuth
token has no Workers Builds scope (`403` on `/builds/builds/<id>/logs`), and
`gh api .../check-runs` gives only pass/fail. **Ask the user to paste the log** rather
than guessing — two rounds were lost to guessing at causes the log names in one line.

## Notes

- Local-machine gotcha (not CI): a stray `~/.pnp.cjs` in the home dir breaks
  wrangler/esbuild locally — rename it temporarily.
- `cloudflare/` has its own `package.json`/`yarn.lock`/`.yarnrc.yml`, but CI does
  **not** build from there. Keep it tidy, but it is not the CI build root.
