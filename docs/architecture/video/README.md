# AbaYa-Track — 3D Motion Video

A 90-second, 1920×1080, 30 fps cinematic explainer that pairs the prose flow map with a live 3D factory scene, editorial typography, a Lottie-style staggered reveal sequence, and a full voiceover + ambient soundtrack.

This is the third deliverable in the architecture document set:

1. `../CODEBASE-FLOW-MAP.md` — line-cited prose (948 lines, 15 sections)
2. `../diagrams/index.html` — 7 hand-authored SVG flow diagrams
3. `../explainer/index.html` — 3D SaaS-style scroll explainer
4. **`./` (this folder)** — 3D motion video (Remotion)

---

## What it shows

| Frames | Wall-clock | Content |
|---|---|---|
| 0 – 180 | 0 – 6 s | Hero: *Three boxes. One source of truth.* |
| 180 – 540 | 6 – 18 s | Chapter 1 — **physical** (kitchen analogy) |
| 540 – 900 | 18 – 30 s | Chapter 2 — **boot** (18 wrapped timers) |
| 900 – 1260 | 30 – 42 s | Chapter 3 — **runtime** (one tap, 30 things) |
| 1260 – 1620 | 42 – 54 s | Chapter 4 — **cloud write** (4 atomic rows) |
| 1620 – 1980 | 54 – 66 s | Chapter 5 — **resilience** (3 independent timers) |
| 1980 – 2340 | 66 – 78 s | Chapter 6 — **auth** (JWT pair + HttpOnly cookies) |
| 2340 – 2640 | 78 – 88 s | Chapter 7 — **catalog** (factory canonical, cloud downstream) |
| 2640 – 2700 | 88 – 90 s | Outro — *Read the line-cited prose.* |

Each chapter has a per-frame camera waypoint that lerps from the previous chapter's waypoint, eased (slow at the chapter edges), for a cinematic feel.

---

## Stack

- **Remotion 4.0.250** — React-based video framework, server-side render of every frame.
- **@remotion/three** — bridge from React Three Fiber into the Remotion render loop.
- **@react-three/fiber** — declarative R3F (useFrame, useThree live here, not in remotion core).
- **three 0.160** — WebGL scene: 1 hub, 6 orbiting workers, 1 cloud icosahedron, 12 data packets, 1 ring, 1 grid.
- **Cloudflare AI music** — ambient soundtrack (`public/soundtrack.mp3`, 30 s, mp3).
- **Cloudflare TTS** — voiceover per chapter (`public/vo/00-intro.mp3` … `d1.mp3` … `d7.mp3` … `99-outro.mp3`), voice `English_Deep-VoicedGentleman`, speed 0.9.

The Lottie-style staggered reveals (eyebrow → headline → feynman → explain) are done with Remotion's `interpolate` + `Easing` primitives, not actual Lottie JSON — because we wanted the same aesthetic with 3D content behind the type, which Lottie JSON can't do.

---

## Build & render

### 1. Install (one time)

```sh
cd docs/architecture/video
npm install
```

This pulls 196 packages — Remotion, three, React 19, etc.

### 2. Render a single still frame (debug / cover image)

```sh
npx remotion still src/index.tsx AbaYaTrack out/still-frame-240.png --frame=240
```

Outputs a 1920×1080 PNG. Useful frames to spot-check:

| Frame | What you see |
|---|---|
| 100 | Hero at peak — *Three boxes. One source of truth.* |
| 240 | Chapter 1 — first reveal staggered into place |
| 1380 | Chapter 4 — camera pulled back, cloud dominant |
| 2400 | Chapter 7 — last chapter, last scene |
| 2670 | Outro — *Read the line-cited prose.* |

### 3. Render the full MP4

```sh
npm run build
# equivalent to: npx remotion render src/index.tsx AbaYaTrack out/abaya-track.mp4
```

Expected output: `out/abaya-track.mp4`, 1920×1080, 30 fps, ~90 s, H.264. This is the deliverable you upload to YouTube / Twitter / LinkedIn.

Render time on a modern laptop: ~5–15 min for the full 2,700 frames. The bottleneck is `@remotion/three` re-initializing the WebGL context per render chunk — it parallelizes across CPU cores but is still CPU-bound.

### 4. (Optional) Render a GIF for chat / X

```sh
npm run build-gif
# 90s GIF tends to be 40–60 MB; consider trimming to 30s for chat
```

### 5. Live preview in Remotion Studio

```sh
npm start
# opens http://localhost:3000 — scrub the timeline to see all 2,700 frames
```

---

## File layout

```
video/
├── package.json
├── tsconfig.json
├── remotion.config.ts
├── public/
│   ├── soundtrack.mp3              # ambient bg music, fades in/out
│   └── vo/
│       ├── 00-intro.mp3            # hero narration
│       ├── 99-outro.mp3            # outro narration
│       └── d1.mp3 … d7.mp3         # per-chapter narration
├── src/
│   ├── index.tsx                   # registerRoot
│   ├── Video.tsx                   # <Composition> declaration
│   ├── Main.tsx                    # 3D scene + overlays + audio
│   ├── chapters.ts                 # timing + camera waypoints + copy
│   └── components/
│       ├── ThreeScene.tsx          # R3F: hub/workers/cloud/packets
│       ├── ChapterOverlay.tsx      # Lottie-style text reveal
│       ├── Hero.tsx                # intro overlay
│       ├── Outro.tsx               # outro overlay
│       ├── Narration.tsx           # voiceover via <Sequence> + <Audio>
│       └── Soundtrack.tsx          # bg music with fade in/out
└── out/                            # render output (gitignored)
```

---

## Editing chapter copy

`src/chapters.ts` is the single source of truth for:

- the **headline** (last phrase is auto-italicized in purple)
- the **feynman line** (italic, with a purple left border)
- the **explain text** (first 2 sentences are rendered on screen, full text is voiced)
- the **voiceover lines** (TTS'd into `public/vo/<id>.mp3`)

To regenerate the voiceover after a copy change:

```sh
# delete the old file
rm public/vo/d3.mp3
# re-run TTS (your tool of choice — see project root docs)
# or use the Cloudflare TTS API directly
```

The video will pick up the new audio on the next render. No code changes needed.

---

## Editing camera waypoints

Each chapter has a `camera: { x, y, z, look }` field in `chapters.ts`. The current camera moves through:

| Chapter | Position (x, y, z) | Looks at | Feel |
|---|---|---|---|
| 1 | (0, 2, 18) | (0, 0, 0) | wide establishing |
| 2 | (6, 3, 14) | (0, 0, 0) | orbit right, mid-height |
| 3 | (-3, 1, 8) | (0, 0, 0) | close, low, left side |
| 4 | (0, 1, 22) | (0, 6, -4) | long pull-back, looks up at cloud |
| 5 | (0, 4, 16) | (0, 6, -4) | high over the floor |
| 6 | (4, 1, 8) | (0, 0, 0) | close, low, right side |
| 7 | (-4, 1, 8) | (0, 0, 0) | mirror of 6 |

`cameraAtFrame()` in `chapters.ts` does the eased lerp between waypoints (cubic ease in/out, slow at chapter edges for a cinematic feel).

---

## Gotchas

These cost time the first time around. Saving them here for future renders.

- **`useFrame` / `useThree` are from `@react-three/fiber`**, not from `remotion` core. The first version of this project imported them from `remotion` and crashed.
- **The package is `@remotion/three`**, not `remotion-three`. Different thing.
- **Hooks cannot be called inside the `useFrame` callback**. Hoist `useThree()` to the top of the component, then reference `camera` and `gl` inside the per-frame closure.
- **Refs set in `useMemo` are null at memo time**. Build the Three.js scene declaratively as JSX (not imperative `new THREE.Mesh()`) so that the React reconciler owns the ref lifecycle.
- **3D scenes need GPU buffer initialization on first render**. The first `remotion still` command may take 30s to bundle; subsequent ones are 5–10s. This is normal.
- **Per-chapter audio uses `<Sequence from={...} durationInFrames={...}>`**. The audio is loaded from `public/vo/` via `staticFile()`. Files are case-sensitive on Linux deploys.
- **`Easing` lives in `remotion`**, not in `Easing.bezier` from framer-motion. Remotion ships its own easing primitives.

---

## Where this lives in the larger deliverable

```
docs/architecture/
├── CODEBASE-FLOW-MAP.md          ← prose (the source of truth for chapter copy)
├── README.md                     ← index
├── diagrams/index.html           ← 7 SVGs, 92 KB
├── explainer/index.html          ← 3D SaaS scroll explainer, 105 KB
└── video/                        ← this folder — 3D motion video
```

All three visual layers (diagrams, explainer, video) draw from the same chapter copy in `CODEBASE-FLOW-MAP.md`. Edit the prose, regenerate TTS, re-render — and the whole stack stays in sync.
