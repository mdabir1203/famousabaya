# v1.2.30 Keynote — Brief

**Lock date:** 2026-09-08
**Status:** Stage 1 of 5 (brief intake) — locked

## The 8 questions

| # | Question | Answer |
|---|---|---|
| 1 | Product / topic | **v1.2.30 — Live Active Session Realtime Stream.** The factory dashboard's "Live Active Sessions" panel and the cloud CEO dashboard's "Active Workers" panel now tick at **1Hz** instead of 2.5s. The cloud side added a `?live=1` cache-bypass so the 1Hz poll hits D1 fresh on every call when there are active sessions. Idle cadence stays at 4.5s. |
| 2 | Audience | (a) **Abaya factory operator** in Dubai — watches the live board for "did that Finish land yet?" (b) **Abir's brother, the CEO** — checks `dashboard.farewellabaya.com/ceo` from his phone between meetings. Both currently believe "the live board always feels a beat behind the worker." |
| 3 | Single outcome | They feel the live tick become a heartbeat — the same Start/Finish event lands in under a second, on both screens, and the gap that made the board feel "stale" is closed. |
| 4 | Length | **30s** |
| 5 | Frame | **16:9 + 9:16** (both renders) |
| 6 | Reference world | **Silicon Valley editorial** (dark mode, glassmorphism, monospace accents, subtle film grain) — matches the dashboard's actual dark theme and the v1.2.30 "realtime stream" character. Stripe / Linear / Vercel energy. |
| 7 | Tone | **Intimate** — quiet reveal, not a launch announcement. |
| 8 | Hard constraints | (a) no logos or third-party IP; (b) the numbers on screen must be real (2.5s, 5s cache, 9.5s worst-case, 1Hz, 16ms socket, `e_bc_<digits>`); (c) conservative Dubai-factory brand — no emoji, no "Subscribe" CTA, no Inter/Roboto/Open Sans/Lato, no linear easing, no 6+-word headlines, no AI gradient-mesh hero; (d) the live ticker is the hero — it must be visually obvious without a voiceover. |

## Single sentence

> "The live board used to feel a beat behind the worker; v1.2.30 closes the gap to a second, on every screen, every time."
