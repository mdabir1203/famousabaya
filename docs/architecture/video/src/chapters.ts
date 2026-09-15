/**
 * Chapter timing and copy for the 3D motion video.
 *
 * Frame rate: 30 fps.
 * Total length: 90 seconds (2700 frames) — 7 chapters + intro + outro.
 *
 * Layout (in seconds):
 *   0–6     intro / hero
 *   6–18    chapter 01  physical
 *   18–30   chapter 02  boot
 *   30–42   chapter 03  runtime
 *   42–54   chapter 04  cloud write
 *   54–66   chapter 05  resilience
 *   66–78   chapter 06  auth
 *   78–88   chapter 07  catalog
 *   88–90   outro / CTA
 */

export type Chapter = {
  id: string;
  ord: string;
  kind: string;
  headline: string;
  feynman: string;
  explain: string;
  /** start frame (inclusive) */
  startFrame: number;
  /** end frame (exclusive) */
  endFrame: number;
  /** camera waypoint — absolute position the camera moves TO during this chapter */
  camera: { x: number; y: number; z: number; look: [number, number, number] };
  /** voiceover line(s) — exact text to TTS, one per line of natural speech */
  voiceover: string[];
};

export const FPS = 30;
export const TOTAL_DURATION_IN_FRAMES = 90 * FPS; // 2700
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const chapters: Chapter[] = [
  {
    id: "d1",
    ord: "01",
    kind: "physical",
    headline: "Three boxes. One source of truth.",
    feynman: "The factory laptop holds everything. The cloud holds a copy. The CEO is a window.",
    explain: "Think of it like a kitchen. The factory is the kitchen where the food is actually cooked. The cloud is the recipe notebook that lives somewhere else, in case the kitchen burns down. The CEO is the person who walks up to the window and asks what is cooking. The kitchen does not trust the notebook. The notebook just tries to keep up.",
    startFrame: 6 * FPS,
    endFrame: 18 * FPS,
    camera: { x: 0, y: 2, z: 18, look: [0, 0, 0] },
    voiceover: [
      "Three boxes. One source of truth.",
      "The factory laptop holds everything. The cloud holds a copy. The CEO is a window.",
      "Think of it like a kitchen. The factory is the kitchen where the food is actually cooked. The cloud is the recipe notebook that lives somewhere else, in case the kitchen burns down. The CEO is the person who walks up to the window and asks what is cooking. The kitchen does not trust the notebook. The notebook just tries to keep up.",
    ],
  },
  {
    id: "d2",
    ord: "02",
    kind: "boot",
    headline: "Eighteen loops. None of them kill the others.",
    feynman: "When the laptop starts, it sets up eighteen timers. Every one of them is wrapped in a safety net so a network failure cannot crash the system.",
    explain: "Imagine a restaurant opening at 7am. The head chef turns on the stove, the dishwasher starts, the cashier boots the register, the delivery driver checks the schedule. Each of those is a separate loop. If the internet is down, the cashier still opens the till with yesterday's numbers. The head chef does not wait for the delivery driver to come online. That is this server. The factory can boot with no WAN, no D1, no LAN share. The kiosk still works.",
    startFrame: 18 * FPS,
    endFrame: 30 * FPS,
    camera: { x: 6, y: 3, z: 14, look: [0, 0, 0] },
    voiceover: [
      "Eighteen loops. None of them kill the others.",
      "When the laptop starts, it sets up eighteen timers. Every one of them is wrapped in a safety net so a network failure cannot crash the system.",
      "Imagine a restaurant opening at 7am. The head chef turns on the stove, the dishwasher starts, the cashier boots the register, the delivery driver checks the schedule. Each of those is a separate loop. If the internet is down, the cashier still opens the till with yesterday's numbers. The head chef does not wait for the delivery driver to come online. That is this server. The factory can boot with no WAN, no D1, no LAN share. The kiosk still works.",
    ],
  },
  {
    id: "d3",
    ord: "03",
    kind: "runtime",
    headline: "Tap Start. One row. The dashboard blinks.",
    feynman: "A worker scans a barcode. The system writes one row to memory, durably saves it to disk, and tries to push it to the cloud. The dashboard updates in milliseconds.",
    explain: "When a tailor sits down at a sewing machine, they scan a card. That single tap kicks off maybe thirty things, but only one of them has to finish before the tailor can start sewing. The rest happen after, in the background, and if any of them fail, the system quietly retries. The tailor never waits. The CEO never sees a gap.",
    startFrame: 30 * FPS,
    endFrame: 42 * FPS,
    camera: { x: -3, y: 1, z: 8, look: [0, 0, 0] },
    voiceover: [
      "Tap start. One row. The dashboard blinks.",
      "A worker scans a barcode. The system writes one row to memory, durably saves it to disk, and tries to push it to the cloud. The dashboard updates in milliseconds.",
      "When a tailor sits down at a sewing machine, they scan a card. That single tap kicks off maybe thirty things, but only one of them has to finish before the tailor can start sewing. The rest happen after, in the background, and if any of them fail, the system quietly retries. The tailor never waits. The CEO never sees a gap.",
    ],
  },
  {
    id: "d4",
    ord: "04",
    kind: "cloud write",
    headline: "One network call. Four rows. Atomic.",
    feynman: "When the cloud receives an event, it does one round trip to the database. Four rows get written. Either all four land or none of them do. There is no in-between.",
    explain: "Picture a bank transfer. You do not want to subtract from one account and then fail to add to the other. Either the money moved or it did not. The cloud here does the same trick, four times over, every time. The four writes — log the session, clear the active row, bump the daily counter, update the abaya timeline — all commit together. If any one of them fails, the whole batch rolls back. The factory pushes the same event again, the database ignores the duplicate, and the system stays consistent.",
    startFrame: 42 * FPS,
    endFrame: 54 * FPS,
    camera: { x: 0, y: 1, z: 22, look: [0, 6, -4] },
    voiceover: [
      "One network call. Four rows. Atomic.",
      "When the cloud receives an event, it does one round trip to the database. Four rows get written. Either all four land or none of them do. There is no in-between.",
      "Picture a bank transfer. You do not want to subtract from one account and then fail to add to the other. Either the money moved or it did not. The cloud here does the same trick, four times over, every time.",
    ],
  },
  {
    id: "d5",
    ord: "05",
    kind: "resilience",
    headline: "Three independent timers. None of them trust the others.",
    feynman: "If the cloud missed something, three other timers will eventually catch it. They run on different schedules, write to different files, and never coordinate.",
    explain: "A 5G tower in Dubai can drop for a second and the line does not stop. The factory laptop does not trust the cloud. The cloud does not trust the factory laptop. Each one has its own notion of what happened, and they meet up on a schedule. If the line keeps moving for six hours with no internet, the laptop is still fine. When the WAN comes back, the cloud catches up within five minutes. If a row was lost in the queue, the periodic reconcile will find it by diffing the local state against the cloud.",
    startFrame: 54 * FPS,
    endFrame: 66 * FPS,
    camera: { x: 0, y: 4, z: 16, look: [0, 6, -4] },
    voiceover: [
      "Three independent timers. None of them trust the others.",
      "If the cloud missed something, three other timers will eventually catch it. They run on different schedules, write to different files, and never coordinate.",
      "A 5G tower in Dubai can drop for a second and the line does not stop. The factory laptop does not trust the cloud. The cloud does not trust the factory laptop. Each one has its own notion of what happened, and they meet up on a schedule.",
    ],
  },
  {
    id: "d6",
    ord: "06",
    kind: "ceo",
    headline: "A password becomes two cookies. The page checks them every time.",
    feynman: "Login. JWT pair. HttpOnly cookies. The dashboard is server-rendered HTML plus JS, inlined, 221 kilobytes. No CDN. No external scripts.",
    explain: "When the CEO opens the URL, the Worker checks two cookies. If they are good, the Worker builds the entire HTML page on the server and ships it down. The page then polls every 3 seconds for a fresh batch of KPIs. The cookies have a 30-minute life and a 7-day refresh token. The CEO does not think about this. They just see the dashboard.",
    startFrame: 66 * FPS,
    endFrame: 78 * FPS,
    camera: { x: 4, y: 1, z: 8, look: [0, 0, 0] },
    voiceover: [
      "A password becomes two cookies. The page checks them every time.",
      "Login. JWT pair. HttpOnly cookies. The dashboard is server-rendered HTML plus JS, inlined, 221 kilobytes. No CDN. No external scripts.",
      "When the CEO opens the URL, the Worker checks two cookies. If they are good, the Worker builds the entire HTML page on the server and ships it down. The page then polls every 3 seconds for a fresh batch of KPIs.",
    ],
  },
  {
    id: "d7",
    ord: "07",
    kind: "catalog",
    headline: "Edit on one laptop. Every other laptop sees it within a minute.",
    feynman: "The factory is canonical. The cloud is downstream. A new laptop with no local data seeds itself from the cloud instead of falling back to demo data.",
    explain: "If the operator renames a process or adds a new abaya on laptop A, the change goes to the cloud in one PUT. Laptop B, C, and D poll the cloud every 60 seconds. The first one to notice the version bump pulls the new list and applies it. A new laptop — one that has never seen the catalog — boots up empty and asks the cloud for the full thing. The bundled demo data is the fallback, not the source.",
    startFrame: 78 * FPS,
    endFrame: 88 * FPS,
    camera: { x: -4, y: 1, z: 8, look: [0, 0, 0] },
    voiceover: [
      "Edit on one laptop. Every other laptop sees it within a minute.",
      "The factory is canonical. The cloud is downstream. A new laptop with no local data seeds itself from the cloud instead of falling back to demo data.",
      "If the operator renames a process or adds a new abaya on laptop A, the change goes to the cloud in one PUT. Laptop B, C, and D poll the cloud every 60 seconds.",
    ],
  },
];

/** Find the chapter that contains a given frame. */
export function chapterAtFrame(frame: number): Chapter | null {
  for (const c of chapters) {
    if (frame >= c.startFrame && frame < c.endFrame) return c;
  }
  return null;
}

/** Frame progress (0–1) within the current chapter. */
export function chapterProgress(frame: number): { chapter: Chapter; p: number } | null {
  const c = chapterAtFrame(frame);
  if (!c) return null;
  const p = (frame - c.startFrame) / (c.endFrame - c.startFrame);
  return { chapter: c, p };
}

/** Interpolated camera state across a chapter (lerp from previous waypoint to current). */
export function cameraAtFrame(
  frame: number
): { x: number; y: number; z: number; look: [number, number, number] } {
  const cur = chapterAtFrame(frame);
  if (!cur) {
    // pre-intro or outro
    if (frame < chapters[0].startFrame) return chapters[0].camera;
    return chapters[chapters.length - 1].camera;
  }
  const idx = chapters.indexOf(cur);
  const prev = idx > 0 ? chapters[idx - 1] : cur;
  const p = (frame - cur.startFrame) / (cur.endFrame - cur.startFrame);
  // ease the camera move to feel cinematic — slow at the chapter edges
  const t = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  return {
    x: prev.camera.x + (cur.camera.x - prev.camera.x) * t,
    y: prev.camera.y + (cur.camera.y - prev.camera.y) * t,
    z: prev.camera.z + (cur.camera.z - prev.camera.z) * t,
    look: [
      prev.camera.look[0] + (cur.camera.look[0] - prev.camera.look[0]) * t,
      prev.camera.look[1] + (cur.camera.look[1] - prev.camera.look[1]) * t,
      prev.camera.look[2] + (cur.camera.look[2] - prev.camera.look[2]) * t,
    ],
  };
}
