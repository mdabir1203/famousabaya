# v1.2.30 Keynote — Storyboard (v2)

**Stage 3 of 5 (Storyboard).** 6 scenes, 29 seconds, 16:9 + 9:16 dual render.

**Why v2:** the v1 storyboard had technical-language on-screen ("5s server cache + 4.5s poll", `setInterval(tickLiveSessions, 1000)`, "FNV-1a hash") and only 2 abstract VO lines ("It always felt late." / "Not anymore."). Engineers got it; the office manager and the CEO did not. v2 replaces the abstract VO with **6 human lines, one per scene**, and rewrites the two pieces of jargon that confused non-engineers.

---

## Voice over script (the spine of the video)

| # | At (s) | Line | What it does |
|---|---|---|---|
| 1 | 0.6 | "Every worker. Every swipe. One screen — live." | Sets the scene in human terms — a factory floor, not a system |
| 2 | 5.5 | "It's right. But it's not right now." | Plants the tension without using "2.5s" or "cache" |
| 3 | 10.8 | "The answer is up to ten seconds old." | Quantifies the pain in a unit a non-engineer feels |
| 4 | 16.5 | "Now it hears every swipe — the second it happens." | Names the fix in one breath; engineers hear the 1Hz |
| 5 | 22.5 | "Same data. Same screen. Just — the right now." | Climax: the delta, in three short sentences |
| 6 | 27.5 | "Live, again." | Two-word closer; matches the on-screen tagline |

The script works for both audiences because each line carries one human point that the technical metrics (2.5s, 9.5s, 1Hz) on-screen reinforce for engineers. A non-engineer hears the story; an engineer also sees the proof.

---

## Scene 1 — Cold Open (0–5s)

| | |
|---|---|
| **Frame range** | 0–150 |
| **Duration** | 5.0s |
| **Dominant element** | The badge code `e_bc_00000121` on a glass card |
| **Motion** | Slow scale-in (spring, damping 18, stiffness 80) from 0.94 → 1.0 over the first 1.2s; then a single cursor-caret blink at 1Hz on the badge code |
| **On-screen text** | `e_bc_00000121` (the only text on screen) |
| **VO** | **"Every worker. Every swipe. One screen — live."** at 0.6s |
| **Music** | A single low note at t=0; silence for 2.5s; a breath of synth at t=3 |
| **Neuromarketing driver** | Open loop (Zeigarnik) — the badge is the worker's identity, planted as a question the viewer will hold for 29 seconds |
| **Pattern interrupt** | Hard cut from black to factory. The single badge code is the only thing in focus; everything else is a soft bokeh |
| **Imperfection signature** | The badge card sits at 40% horizontal, 60% vertical — 1% off the perfect grid |

## Scene 2 — The 2.5s Tick (5–10s)

| | |
|---|---|
| **Frame range** | 150–300 |
| **Duration** | 5.0s |
| **Dominant element** | A subtle red horizontal strobe at 2.5s intervals across the dashboard card |
| **Motion** | The strobe fires 2 times during this scene (at t=5.0 and t=7.5). The innerHTML rebuild is shown as a faint ghost flash. The elapsed counter (`12m 4s`) snaps on each strobe |
| **On-screen text** | Top right: `2.5s tick` in monospace. Inside the card: `12m 4s` for one of three session rows |
| **VO** | **"It's right. But it's not right now."** at 5.5s |
| **Music** | A barely-audible digital click synced to each strobe |
| **Neuromarketing driver** | Specificity — the number is the point. "2.5s" beats "fast", and the VO contrast ("right / not right now") lands the feeling |
| **Pattern interrupt** | The strobe itself is the interrupt; the viewer feels the rhythm before they understand it |
| **Imperfection signature** | The dashboard card is intentionally slightly washed out — the start of the "stale" mood that scene 3 makes explicit |

## Scene 3 — The 5s Cache + 9.5s Worst-Case (10–16s)

| | |
|---|---|
| **Frame range** | 300–480 |
| **Duration** | 6.0s |
| **Dominant element** | The `9.5s stale` badge in the top right |
| **Motion** | The counter increments from 0 to 9.5 in 5 seconds — the slow realization. At 9.5, the badge locks and a faint amber glow pulses once |
| **On-screen text** | `9.5s stale` (monospace, warm amber). Below: `old: 5 sec to hear, 4.5 sec to show` (smaller monospace, off-white) — **replaces** the v1 "5s server cache + 4.5s poll" so a non-engineer reads the cause |
| **VO** | **"The answer is up to ten seconds old."** at 10.8s |
| **Music** | Tense sustained synth, building slightly |
| **Neuromarketing driver** | Specificity + contrast (delta) — the worst-case number is the dramatic low before the reframe lifts it. "Ten seconds" is the universal concept |
| **Pattern interrupt** | The freeze frame at 9.5s. The whole frame locks for 1 second before the cut |
| **Imperfection signature** | The 9.5s number has a hand-drawn underline beneath the decimal point — rough SVG, not CSS |

## Scene 4 — The Reframe (16–22s)

| | |
|---|---|
| **Frame range** | 480–660 |
| **Duration** | 6.0s |
| **Dominant element** | The split between the dimmed old code path (top) and the bright new code (bottom) |
| **Motion** | Top half fades down to 40% opacity. Bottom half scales in from 0.96 to 1.0 (spring). The green `setInterval(tickLiveSessions, 1000)` line at the bottom begins a subtle 1Hz pulse — the new tick |
| **On-screen text** | Top: `innerHTML = ids.map(...).join('')` (faded, dimmed). Bottom: `function computeActiveTodaySec(...)` then `setInterval(tickLiveSessions, 1000)` in green monospace. The word `live` is underlined with a hand-drawn rough SVG path |
| **VO** | **"Now it hears every swipe — the second it happens."** at 16.5s |
| **Music** | The tense synth cuts to a single clear piano note at t=18, marking the reframe |
| **Neuromarketing driver** | Reframe + endowed progress — "we already shipped this; you're seeing the diff". The VO names what changed; the code on-screen shows engineers how |
| **Pattern interrupt** | The split reveal itself: the top half is dimmed in 1 frame, the bottom half brightens in 1 frame |
| **Imperfection signature** | The hand-drawn underline under `live`. The bottom code's left margin is 2% off the right half's perfect grid |

## Scene 5 — The Climax, Side-by-Side (22–27s)

| | |
|---|---|
| **Frame range** | 660–840 |
| **Duration** | 5.0s |
| **Dominant element** | The two dashboards side by side, divided by a thin warm amber vertical line |
| **Motion** | A `Start` event annotation appears at the top center at t=22.5. A faint wave propagates left to right. Left dashboard: lag indicator appears at +2.5s, then the elapsed counter jumps to `5m 2s` at +5.0s. Right dashboard: lag indicator appears at +1.0s, then the elapsed counter jumps to `1m 18s` at +2.0s. The right side is brighter, slightly more vibrant, ticking 2.5x faster |
| **On-screen text** | Center top: `Start` (small monospace). Left card: `9.5s stale` badge, `5m 2s` counter. Right card: `1m 18s` counter, a tiny green dot pulsing next to it |
| **VO** | **"Same data. Same screen. Just — the right now."** at 22.5s. VO 5 is 4.86s and runs 0.36s into the closer — natural documentary-style spillover |
| **Music** | A sustained chord resolves; the music swells to the climax and then drops to silence at t=27.0 |
| **Neuromarketing driver** | Contrast (delta) — the climax is the delta between the two halves, named in the VO |
| **Pattern interrupt** | The hard cut to the split screen; the audio chord resolution |
| **Imperfection signature** | The left side is intentionally 5% more muted than the right. The vertical dividing line is 1px off-center |

## Scene 6 — The Closer (27–29s)

| | |
|---|---|
| **Frame range** | 840–900 |
| **Duration** | 2.0s |
| **Dominant element** | The centered monospace text on near-black |
| **Motion** | Hard cut to near-black. Text scales from 0.98 to 1.0 in 0.4s, then holds. A faint amber glow under the text pulses once at t=28.5 |
| **On-screen text** | Centered at 51% horizontal, 49% vertical (1% off-center): `AbaYa-Track` in a thin display sans, then below in monospace: `v1.2.30 · live, again.` in warm amber. Top right: `2026-09-08 · 04:37 GST` in tiny monospace |
| **VO** | **"Live, again."** at 27.5s — two words, held. The VO and the on-screen tagline say the same thing twice (different senses: audio + visual) |
| **Music** | One final piano note, held and fading |
| **Neuromarketing driver** | Closer + imperfection — the 1% off-center text is the signature |
| **Pattern interrupt** | The hard cut to black. The audio silence after the held note |
| **Imperfection signature** | The 1% off-center text. The warm color cast (off-white at #F4F1EA, not #FFFFFF). 4% film grain |

---

## Storyboard gate

- **Squint test:** even at thumbnail size, the arc reads as: badge → strobe → 9.5s → code → split-screen → black. ✓
- **Two pattern interrupts in the first 15 seconds:** strobe at 5s, freeze at 14s. ✓
- **Open loop closed:** yes, at the climax. ✓
- **Single dominant element per scene:** yes. ✓
- **One purely emotional scene:** Scene 6 (no text-but-a-version-number, no features, just a held note + 2-word VO). ✓
- **VO lands for both audiences:** non-engineer hears the story ("right / not right now", "ten seconds old"), engineer sees the proof (2.5s, 9.5s, 1Hz). ✓

## 9:16 adaptation

The 9:16 render stacks the same 6 scenes vertically with a tighter crop. The split-screen in scene 5 becomes a top/bottom split instead of left/right. The closer moves to the bottom center. All motion timing and text positions scale linearly with the frame. The VO timing is identical (audio doesn't care about aspect ratio).

## Pattern interrupt budget

5 interrupts in 29s = 1 every ~6 seconds. Within the 5–7 second target.

## Why this works for the audience (v2)

- **The office manager** (non-engineer, watches on a phone in a car): hears "Every worker. Every swipe. One screen — live." → understands the screen. Hears "The answer is up to ten seconds old" → feels the pain. Doesn't need the 2.5s tick or the 1Hz to understand the change.
- **The factory operator** (sees the LAN dashboard tomorrow morning): gets a preview of the new rhythm. Already knows the 2.5s tick is gone, so the 9.5s in scene 3 is the contrast that matters.
- **The CEO** (watches the cloud dashboard at dashboard.farewellabaya.com): sees the same change he asked for. The VO names the feeling he wanted; the metrics on-screen confirm the engineering team delivered.
- **The engineer on the team** (watches the launch demo): sees the actual diff in scene 4 (`setInterval(tickLiveSessions, 1000)`, the hand-drawn underline on `live`). They built it; the video credits them by showing the code.
