import { createContext, useContext } from "react";
import { useCurrentFrame } from "remotion";
import { cinematicOut } from "./easings";
import {
  CameraSnapshot,
  IDENTITY_STATE,
  ShotList,
  ShotState,
} from "./types";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpState = (a: ShotState, b: ShotState, t: number): ShotState => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  scale: lerp(a.scale, b.scale, t),
  rotateZ: lerp(a.rotateZ, b.rotateZ, t),
  blur: lerp(a.blur, b.blur, t),
});

export const computeCamera = (
  localFrame: number,
  shots: ShotList,
): CameraSnapshot => {
  let prev: ShotState = IDENTITY_STATE;
  let acc = 0;
  for (const shot of shots) {
    const start = acc;
    const end = acc + shot.durationFrames;
    const target: ShotState = { ...prev, ...shot.to };
    if (localFrame >= start && localFrame < end) {
      const dur = Math.max(end - start, 1);
      const tRaw = Math.min(Math.max((localFrame - start) / dur, 0), 1);
      const ease = shot.easing ?? cinematicOut;
      const t = ease(tRaw);
      const state = lerpState(prev, target, t);
      return {
        ...state,
        motionBlur: shot.motionBlur ?? false,
        focusOn: shot.focusOn ?? null,
      };
    }
    acc = end;
    prev = target;
  }
  return { ...prev, motionBlur: false, focusOn: null };
};

export const CameraContext = createContext<CameraSnapshot>({
  ...IDENTITY_STATE,
  motionBlur: false,
  focusOn: null,
});

export const useCamera = (shots: ShotList): CameraSnapshot => {
  const frame = useCurrentFrame();
  return computeCamera(frame, shots);
};

export const useCameraContext = (): CameraSnapshot => {
  return useContext(CameraContext);
};
