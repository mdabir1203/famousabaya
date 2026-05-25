# AbaYa Track Design-Flow Video

A Remotion project that renders [docs/SYSTEM_DESIGN.md](../SYSTEM_DESIGN.md) as a ~7-minute, 1920x1080 @ 30fps walkthrough with Hollywood-grade cinematography (virtual camera, motion blur, rack focus, parallax, vignette, film grain, letterbox).

## Quick start

```bash
cd docs/design-flow-video
yarn install
yarn studio          # interactive preview
```

## Render

```bash
yarn still --frame=30 --scale=0.25 -o out/still-s01.jpg     # one-frame sanity check
yarn render:preview                                          # 0.5x preview -> out/abaya-design-flow-preview.mp4
yarn render                                                  # full mp4 -> out/abaya-design-flow.mp4
yarn render:final                                            # same, with --concurrency=1 for low-memory WSL
```

On low-memory WSL, prefer `yarn render:preview` first. The full 1920x1080 render uses one Chromium worker to avoid browser crashes.

## Scenes (mirror docs/SYSTEM_DESIGN.md sections)

| Id  | Title                | Source section                | Approx duration |
| --- | -------------------- | ----------------------------- | --------------- |
| S01 | Title                | Header                        | 8s              |
| S02 | Three Lanes          | sec 2 (network architecture)  | 50s             |
| S03 | Components           | sec 3 (component inventory)   | 55s             |
| S04 | Data Ownership       | sec 4 (data ownership)        | 55s             |
| S05 | API Surface          | sec 5 (API surface)           | 50s             |
| S06 | Session Lifecycle    | sec 6 (session lifecycle)     | 75s             |
| S07 | Catalog Flow         | sec 7 (catalog flow)          | 50s             |
| S08 | Security/Reliability | sec 8 + sec 9                 | 35s             |
| S09 | Deployment Topology  | sec 10 (deployment topology)  | 35s             |
| S10 | Outro                | --                            | 7s              |

## Cinematography

Every scene is wrapped in `<CameraStage>` (a 4000x2250 virtual canvas viewed through the 1920x1080 viewport). A typed shot list in [src/data/shotLists.ts](src/data/shotLists.ts) drives the camera:

- `static`, `push`, `dolly`, `truck`, `crane`, `whip`, `orbit`, `dutch`, `rack`
- Easings: `cinematicOut`, `cinematicInOut`, `whipIn`/`whipOut`, `settle` (overshoot), `focusPull`
- Motion blur via `@remotion/motion-blur`, opt-in per shot (whip-pans, fast dollies)
- Depth of field via per-layer frame-driven `filter: blur(px)` (no CSS transitions)
- Parallax via `<ParallaxLayer depth>` reading the active camera offset
- Overlays: `<Vignette>`, `<FilmGrain>`, `<Letterbox>`

## Source of truth

All factual claims in scenes are pulled from [docs/SYSTEM_DESIGN.md](../SYSTEM_DESIGN.md) — no architecture is invented.

## Constraints

- No CSS `transition` / `@keyframes`. No Tailwind `animate-*`. All motion driven by `useCurrentFrame()` + `interpolate()`.
- Frame-driven `filter: blur(px)` is allowed because the value is recomputed per frame, not transitioned.
