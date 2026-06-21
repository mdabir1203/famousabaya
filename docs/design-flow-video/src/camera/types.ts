export type EasingFn = (t: number) => number;

export type ShotState = {
  x: number;
  y: number;
  scale: number;
  rotateZ: number;
  blur: number;
};

export const IDENTITY_STATE: ShotState = {
  x: 0,
  y: 0,
  scale: 1,
  rotateZ: 0,
  blur: 0,
};

export type ShotKind =
  | "static"
  | "push"
  | "pull"
  | "dolly"
  | "truck"
  | "crane"
  | "whip"
  | "orbit"
  | "dutch"
  | "rack";

export type Shot = {
  kind: ShotKind;
  durationFrames: number;
  to: Partial<ShotState>;
  easing?: EasingFn;
  motionBlur?: boolean;
  focusOn?: string | null;
};

export type ShotList = readonly Shot[];

export type CameraSnapshot = ShotState & {
  motionBlur: boolean;
  focusOn: string | null;
};
