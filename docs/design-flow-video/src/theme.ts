import { Easing, interpolate } from "remotion";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const STAGE = {
  width: 4000,
  height: 2250,
  centerX: 2000,
  centerY: 1125,
} as const;

export const PALETTE = {
  bg0: "#070A12",
  bg1: "#0E1424",
  bg2: "#141C32",
  panel: "rgba(20, 28, 50, 0.85)",
  panelBorder: "rgba(120, 160, 240, 0.18)",
  fg: "#E6ECF8",
  fgDim: "rgba(230, 236, 248, 0.62)",
  fgFaint: "rgba(230, 236, 248, 0.35)",
  accent: "#6CC2FF",
  accentWarm: "#FFB16C",
  good: "#5BE0A6",
  warn: "#FFD66C",
  danger: "#FF6C8A",
  rule: "rgba(108, 194, 255, 0.35)",
} as const;

export const TYPE = {
  family:
    "'Inter', 'SF Pro Display', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono:
    "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  scale: {
    h1: 96,
    h2: 64,
    h3: 44,
    body: 28,
    small: 22,
    mono: 24,
  },
} as const;

export const SPACE = {
  pad: 64,
  gap: 32,
  radius: 24,
} as const;

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.83, 0, 0.17, 1);

export const enter = (
  frame: number,
  startAt: number,
  duration = 12,
): { opacity: number; translateY: number } => {
  const opacity = interpolate(frame, [startAt, startAt + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const translateY = interpolate(
    frame,
    [startAt, startAt + duration],
    [16, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  return { opacity, translateY };
};

export const fadeOut = (
  frame: number,
  endAt: number,
  duration = 12,
): number => {
  return interpolate(frame, [endAt - duration, endAt], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
};
