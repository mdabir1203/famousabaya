# AbaYa-Track — Architecture docs

This folder holds line-level architectural documentation for the
AbaYa-Track production tracking system.

## Start here

- **[video/](./video/)** — 3D motion video. 90 seconds, 1920×1080, 30 fps.
  Remotion + React Three Fiber + Lottie-style staggered overlays + full
  voiceover (English_Deep-VoicedGentleman) + ambient soundtrack. Render
  with `npm install && npm run build`; outputs `out/abaya-track.mp4`.
  See [video/README.md](./video/README.md) for build/render instructions.
- **[explainer/index.html](./explainer/index.html)** — the 3D motion
  explainer. A single static page with an inline Three.js scene of the
  factory, a Cloudflare cloud, and orbiting worker nodes. Scroll
  through seven chapters that pair a one-sentence Feynman summary with
  the full technical diagram. No build step, no server. Open in any
  browser.
- **[diagrams/index.html](./diagrams/index.html)** — the seven flow
  diagrams as standalone SVG. Same content as the explainer, without
  the 3D layer. Useful when you want to print or copy a single
  diagram.
- **[CODEBASE-FLOW-MAP.md](./CODEBASE-FLOW-MAP.md)** — the rigorous
  end-to-end walk. Every request traced from the wire through
  `server.js`, the Cloudflare Worker, D1, R2, the dispatch leaderboard,
  the desktop launcher, and back. Includes a security model, a known
  sharp-edges list, and a function-by-function index.

The diagrams and the prose are 1:1. Each diagram has a corresponding
section in the map; each map section names its diagram.

## Conventions used in this folder

- Line citations are `file.js:NNN` and resolve to the line in the
  current branch.
- Tables in §12 (security model) use the actual env var names and
  header names — copy-paste safe for incident response.
- The Appendix in §15 is a jump table, not an index of every helper.
  Use `rg <symbol>` against the listed file when the entry points to a
  shared module.

## When to update this folder

Any of:

- A new socket RPC on the factory server.
- A new endpoint on the Cloudflare Worker that crosses the
  factory→cloud boundary.
- A new background loop in `server.listen` callback.
- A change to the auth matrix in §12.
- A new known sharp edge (a TODO, a missing file, a footgun).

For diagram changes, edit the SVG in `diagrams/index.html` (or, for
the explainer, edit the corresponding `<svg>` in the matching section
of `explainer/index.html`). The diagrams are hand-authored — there is
no build step or generator.


