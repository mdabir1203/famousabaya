# Bun runtime + Yarn installs (factory server)

## Single authority for dependency trees

| Artifact | Role |
|----------|------|
| **`yarn.lock`** | **Source of truth** for resolved versions—always commit changes after `yarn add` / `yarn install`. |
| **`node_modules/`** | Produced locally by Yarn (`nodeLinker: node-modules`). Required so **`bun server.js`** can resolve packages (Bun does not use Yarn PnP). |

Do **not** mix **`yarn install`** and **`bun install`** on the same checkout unless you know exactly why—duplicate lockfiles drift and CI/factory PCs diverge.

## Lifecycle scripts

Installs run **with** lifecycle scripts enabled (native builds for `sharp`, `esbuild`, `workerd`, etc.). Do **not** use `bun install --ignore-scripts` or Yarn equivalents unless you document an explicit exception (support/security review).

## Bun version

Pin the Bun major used on factory PCs in release notes or internal runbooks (`bun --version`). Upgrade Bun deliberately across machines.

## Windows launcher (Node vs Bun)

`install/LAUNCH-ALL.bat`, `START-AbaYa-Server.bat`, and `START-Catalog-Watcher.bat` call **`install/PICK-RUNTIME.bat`** when the repo root has **`node_modules\`** and **`bun`** is on your PATH:

- Press **N** for Node.js (`node server.js` when using `node_modules`, otherwise `node -r ./.pnp.cjs server.js` for PnP-only trees).
- Press **B** for Bun (`bun server.js`).

If **`node_modules`** is missing or **`bun`** is not installed, the menu is skipped and Node PnP launch is used.

To **skip the menu** (Task Scheduler, shortcuts, silent launch): set before starting:

```bat
set ABAYA_RUNTIME=node
```

or `set ABAYA_RUNTIME=bun`.

## WSL + Windows PATH guard

If you use WSL on Windows 11 Pro, keep Linux Node/Yarn ahead of Windows shims:

```bash
# ~/.bashrc (or ~/.zshrc)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use --lts >/dev/null
corepack enable >/dev/null 2>&1 || true
```

This prevents `/mnt/c/.../node` and `/mnt/c/.../yarn` from being picked first in mixed PATH shells.

## Commands

| Task | Command |
|------|---------|
| Install deps | `yarn install` (repo root and `tools/catalog-watcher` via `install/setup.cjs`) |
| Run factory API | `yarn start` → **`node server.js`** |
| Smoke tests | `yarn run test:system` (needs server running unless tests only hit worker) |
| Security parity tests | Start server, then `yarn test` or `bun test tests/security-parity.test.ts` |
| Worker deploy | `yarn run deploy:cf` → **`wrangler deploy --config cloudflare/wrangler.toml`** |

## Supply chain

After changing dependencies, run **`yarn npm audit`** from the repo root in the same environment you use for installs (if WSL hits registry/TLS errors, run the equivalent from Windows PowerShell).

This repo uses **`yarn.lock` only** (no `bun.lockb`), so **`bun audit` does not apply** unless you intentionally add a Bun lockfile.

Treat critical findings per your release policy.

## Phase 3 (explicitly deferred)

**TypeScript migration** for `server.js` and/or replacing Express + Socket.IO with **`Bun.serve()`** is **out of scope** until Bun + Express has run stably in production-like conditions. Track that decision separately from this rollout.
