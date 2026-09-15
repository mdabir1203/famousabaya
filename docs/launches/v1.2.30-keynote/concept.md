# v1.2.30 Keynote — Concept

**Stage 2 of 5 (Concept).** One paragraph, hook + arc + closer.

## The concept

> **Open loop (0–3s):** "Why does the live board feel one beat behind the worker?" — planted by a single badge code in soft focus on a dim factory floor.
>
> **Reframe (~7s):** It's not the screen. It's the tick. The 2.5-second full innerHTML rebuild, the 5-second server cache — the lag was in the architecture, not the operator.
>
> **Build (10–22s):** The old strobe. The "9.5s stale" badge ticking in the top right. Then a single, quiet code change: pure helpers, a 1Hz `setInterval(tickLiveSessions, 1000)`, and a `?live=1` cache bypass. The same code we just shipped.
>
> **Climax (~24s):** A split screen. Left: the old 9.5s lag. Right: the new 1s. The same Start event lands on both. The right one is the hero — slightly brighter, ticking in real time, no lag indicator.
>
> **Closer (28–30s):** Black. One centered monospace line: "AbaYa-Track · v1.2.30 · live, again."

## Concept gate

- **Open loop** opens in 0–3s ("Why does the live board feel one beat behind the worker?") and **closes** in the climax (24s) when the split-screen comparison answers it. ✓
- **Reframe is a true reframe** — "the lag was in the architecture" is not a feature list. ✓
- **Fits in 3–4 sentences** (5 above — within budget). ✓
- **Single outcome** (one sentence in brief.md). ✓

## Primary neuromarketing driver

**Contrast (delta).** The before/after split-screen climax is the entire reason this video exists. Every preceding scene exists to set up the delta.

Secondary drivers, by scene:
- Scene 1: open loop (Zeigarnik)
- Scene 2: specificity (the 2.5s number)
- Scene 3: contrast (delta) + mystery gap
- Scene 4: reframe + endowed progress
- Scene 5: contrast (delta) — the climax
- Scene 6: closer + imperfection (the 1% off-center text)

## Why this works for the audience

The factory operator sees the 1s tick on the LAN dashboard tomorrow morning; this video previews the change so it doesn't feel like a glitch. The CEO, watching from his phone, sees the `dashboard.farewellabaya.com/ceo` rhythm finally match the operator's experience. The intimacy of the tone is deliberate: this is a quiet fix, not a feature announcement.
