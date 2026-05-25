import {
  cinematicInOut,
  cinematicOut,
  settle,
  whipIn,
  whipOut,
} from "../camera/easings";
import type { ShotList } from "../camera/types";
import { FPS } from "../theme";

const s = (sec: number): number => Math.round(sec * FPS);

export const SHOTS_S01_TITLE: ShotList = [
  {
    kind: "static",
    durationFrames: s(1),
    to: { scale: 1.0 },
  },
  {
    kind: "push",
    durationFrames: s(7),
    to: { scale: 1.06 },
    easing: cinematicInOut,
  },
];

export const SHOTS_S02_THREE_LANES: ShotList = [
  {
    kind: "static",
    durationFrames: s(8),
    to: { scale: 0.85, x: 0, y: 0 },
    easing: cinematicOut,
  },
  {
    kind: "dolly",
    durationFrames: s(12),
    to: { scale: 1.05, x: 480, y: -120 },
    easing: cinematicInOut,
    focusOn: "lane-ceo",
  },
  {
    kind: "whip",
    durationFrames: s(2),
    to: { scale: 1.05, x: -480, y: -120, rotateZ: 1.5 },
    easing: whipIn,
    motionBlur: true,
  },
  {
    kind: "static",
    durationFrames: s(8),
    to: { rotateZ: 0 },
    easing: whipOut,
    focusOn: "lane-kiosk",
  },
  {
    kind: "crane",
    durationFrames: s(12),
    to: { scale: 1.05, x: 0, y: 360 },
    easing: cinematicInOut,
    focusOn: "lane-admin",
  },
  {
    kind: "pull",
    durationFrames: s(8),
    to: { scale: 0.85, x: 0, y: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S03_COMPONENTS: ShotList = [
  {
    kind: "crane",
    durationFrames: s(10),
    to: { scale: 0.9, x: 0, y: -200 },
    easing: cinematicInOut,
  },
  {
    kind: "dolly",
    durationFrames: s(8),
    to: { scale: 1.1, x: -560, y: -200 },
    easing: cinematicInOut,
    focusOn: "comp-server",
  },
  {
    kind: "truck",
    durationFrames: s(8),
    to: { scale: 1.1, x: 560, y: -200 },
    easing: cinematicInOut,
    focusOn: "comp-worker",
  },
  {
    kind: "crane",
    durationFrames: s(8),
    to: { scale: 1.1, x: -560, y: 200 },
    easing: cinematicInOut,
    focusOn: "comp-watcher",
  },
  {
    kind: "truck",
    durationFrames: s(8),
    to: { scale: 1.1, x: 560, y: 200 },
    easing: cinematicInOut,
    focusOn: "comp-public",
  },
  {
    kind: "pull",
    durationFrames: s(13),
    to: { scale: 0.9, x: 0, y: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S04_DATA_OWNERSHIP: ShotList = [
  {
    kind: "static",
    durationFrames: s(8),
    to: { scale: 0.95 },
  },
  {
    kind: "orbit",
    durationFrames: s(15),
    to: { scale: 1.05, x: -200, rotateZ: -0.8 },
    easing: cinematicInOut,
    focusOn: "data-local",
  },
  {
    kind: "orbit",
    durationFrames: s(15),
    to: { scale: 1.1, x: 0, rotateZ: 0.4 },
    easing: cinematicInOut,
    focusOn: "data-snapshot",
  },
  {
    kind: "orbit",
    durationFrames: s(12),
    to: { scale: 1.05, x: 200, rotateZ: 0.8 },
    easing: cinematicInOut,
    focusOn: "data-cloud",
  },
  {
    kind: "pull",
    durationFrames: s(5),
    to: { scale: 0.95, x: 0, rotateZ: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S05_API_SURFACE: ShotList = [
  {
    kind: "static",
    durationFrames: s(6),
    to: { scale: 0.95, y: -300 },
  },
  {
    kind: "crane",
    durationFrames: s(40),
    to: { scale: 1.0, y: 300 },
    easing: cinematicInOut,
  },
  {
    kind: "pull",
    durationFrames: s(4),
    to: { scale: 0.95, y: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S06_SESSION_LIFECYCLE: ShotList = [
  {
    kind: "static",
    durationFrames: s(3),
    to: { scale: 0.85 },
  },
  {
    kind: "dolly",
    durationFrames: s(6),
    to: { scale: 1.1, x: -700, y: 0 },
    easing: cinematicInOut,
    focusOn: "actor-K",
  },
  {
    kind: "whip",
    durationFrames: s(1.2),
    to: { scale: 1.1, x: -200, y: 0 },
    easing: whipIn,
    motionBlur: true,
  },
  {
    kind: "static",
    durationFrames: s(7),
    to: { x: -200 },
    easing: whipOut,
    focusOn: "actor-S",
  },
  {
    kind: "crane",
    durationFrames: s(6),
    to: { scale: 1.1, x: 350, y: -260 },
    easing: cinematicInOut,
    focusOn: "actor-W",
  },
  {
    kind: "dolly",
    durationFrames: s(6),
    to: { scale: 1.15, x: 700, y: -260 },
    easing: cinematicInOut,
    focusOn: "actor-D",
  },
  {
    kind: "truck",
    durationFrames: s(2),
    to: { scale: 1.1, x: -200, y: 0 },
    easing: whipIn,
    motionBlur: true,
  },
  {
    kind: "static",
    durationFrames: s(6),
    to: { scale: 1.1, x: -200, y: 0 },
    easing: whipOut,
    focusOn: "actor-S",
  },
  {
    kind: "truck",
    durationFrames: s(6),
    to: { scale: 1.1, x: 350, y: 280 },
    easing: cinematicInOut,
    focusOn: "actor-L",
  },
  {
    kind: "whip",
    durationFrames: s(1.5),
    to: { scale: 1.1, x: 350, y: -260 },
    easing: whipIn,
    motionBlur: true,
  },
  {
    kind: "static",
    durationFrames: s(8),
    to: { scale: 1.1, x: 350, y: -260 },
    easing: whipOut,
    focusOn: "actor-W",
  },
  {
    kind: "pull",
    durationFrames: s(12),
    to: { scale: 0.85, x: 0, y: 0 },
    easing: cinematicOut,
  },
  {
    kind: "static",
    durationFrames: s(10.3),
    to: { scale: 0.85 },
  },
];

export const SHOTS_S07_CATALOG_FLOW: ShotList = [
  {
    kind: "dutch",
    durationFrames: s(6),
    to: { scale: 0.92, rotateZ: -3 },
    easing: cinematicInOut,
  },
  {
    kind: "whip",
    durationFrames: s(1.2),
    to: { scale: 1.05, x: -540, rotateZ: -1, y: -260 },
    easing: whipIn,
    motionBlur: true,
    focusOn: "writer-watcher",
  },
  {
    kind: "whip",
    durationFrames: s(1.2),
    to: { scale: 1.05, x: 540, rotateZ: 1, y: -260 },
    easing: whipIn,
    motionBlur: true,
    focusOn: "writer-localXlsx",
  },
  {
    kind: "whip",
    durationFrames: s(1.2),
    to: { scale: 1.05, x: -540, rotateZ: -1, y: 260 },
    easing: whipIn,
    motionBlur: true,
    focusOn: "writer-admin",
  },
  {
    kind: "whip",
    durationFrames: s(1.2),
    to: { scale: 1.05, x: 540, rotateZ: 1, y: 260 },
    easing: whipIn,
    motionBlur: true,
    focusOn: "writer-worker",
  },
  {
    kind: "dolly",
    durationFrames: s(8),
    to: { scale: 1.18, x: 0, y: 0, rotateZ: 0 },
    easing: settle(0.04),
    focusOn: "node-d1",
  },
  {
    kind: "static",
    durationFrames: s(10),
    to: { scale: 1.18 },
    focusOn: "node-d1",
  },
  {
    kind: "pull",
    durationFrames: s(15),
    to: { scale: 0.92, x: 0, y: 0, rotateZ: 0 },
    easing: cinematicOut,
  },
  {
    kind: "static",
    durationFrames: s(5),
    to: { scale: 0.92 },
  },
];

export const SHOTS_S08_SECURITY: ShotList = [
  {
    kind: "static",
    durationFrames: s(6),
    to: { scale: 0.95 },
    focusOn: "sec-controls",
  },
  {
    kind: "truck",
    durationFrames: s(2),
    to: { scale: 1.0, x: -400 },
    easing: cinematicInOut,
    focusOn: "sec-gaps",
  },
  {
    kind: "static",
    durationFrames: s(8),
    to: { x: -400 },
    focusOn: "sec-gaps",
  },
  {
    kind: "truck",
    durationFrames: s(2),
    to: { scale: 1.0, x: 400 },
    easing: cinematicInOut,
    focusOn: "sec-controls",
  },
  {
    kind: "dutch",
    durationFrames: s(6),
    to: { scale: 1.0, x: 0, rotateZ: -2 },
    easing: cinematicInOut,
  },
  {
    kind: "pull",
    durationFrames: s(11),
    to: { scale: 0.95, rotateZ: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S09_DEPLOYMENT: ShotList = [
  {
    kind: "static",
    durationFrames: s(4),
    to: { scale: 0.95 },
  },
  {
    kind: "orbit",
    durationFrames: s(20),
    to: { scale: 1.05, rotateZ: 1.5 },
    easing: cinematicInOut,
  },
  {
    kind: "orbit",
    durationFrames: s(8),
    to: { scale: 1.05, rotateZ: -1.5 },
    easing: cinematicInOut,
  },
  {
    kind: "pull",
    durationFrames: s(3),
    to: { scale: 0.95, rotateZ: 0 },
    easing: cinematicOut,
  },
];

export const SHOTS_S10_OUTRO: ShotList = [
  {
    kind: "static",
    durationFrames: s(1),
    to: { scale: 1.1 },
  },
  {
    kind: "pull",
    durationFrames: s(6),
    to: { scale: 1.0 },
    easing: cinematicOut,
  },
];
