import { Easing } from "remotion";
import type { EasingFn } from "./types";

export const cinematicOut: EasingFn = Easing.bezier(0.16, 1, 0.3, 1);
export const cinematicInOut: EasingFn = Easing.bezier(0.83, 0, 0.17, 1);
export const whipIn: EasingFn = Easing.bezier(0.7, 0, 0.84, 0);
export const whipOut: EasingFn = Easing.bezier(0.16, 1, 0.3, 1);
export const focusPull: EasingFn = Easing.bezier(0.4, 0, 0.2, 1);

export const settle = (overshoot: number): EasingFn => {
  return (t: number): number => {
    if (t >= 1) return 1;
    const eased = 1 - Math.pow(1 - t, 3);
    const wobble =
      overshoot * Math.sin(t * Math.PI * 1.5) * (1 - t) * (1 - t);
    return eased + wobble;
  };
};

export const CAMERA_LIMITS = {
  maxTruckPerSecond: 1.0,
  maxScalePerSecond: 0.06,
  maxDutchDeg: 5,
  maxBlurPx: 12,
} as const;
