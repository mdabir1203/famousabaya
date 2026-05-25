import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { SHOTS_S10_OUTRO } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { EASE_OUT, PALETTE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S10_Outro")!.durationFrames;
const cx = STAGE.centerX;
const cy = STAGE.centerY;

export const S10_Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [4, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const subOpacity = interpolate(frame, [16, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const fade = interpolate(frame, [DURATION - 16, DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <SceneFrame shots={SHOTS_S10_OUTRO} totalDuration={DURATION} vignetteIntensity={0.7}>
      <BackdropGrid />
      <div
        style={{
          position: "absolute",
          left: cx - 900,
          top: cy - 200,
          width: 1800,
          textAlign: "center",
          opacity: fade,
        }}
      >
        <div
          style={{
            opacity: titleOpacity,
            fontFamily: TYPE.family,
            fontSize: 110,
            fontWeight: 800,
            color: PALETTE.fg,
            letterSpacing: -2,
          }}
        >
          See docs/SYSTEM_DESIGN.md for full text.
        </div>
        <div
          style={{
            opacity: subOpacity,
            fontFamily: TYPE.mono,
            fontSize: 36,
            color: PALETTE.fgDim,
            marginTop: 32,
            letterSpacing: 3,
          }}
        >
          AbaYa Track  -  factory-floor and cloud analytics
        </div>
      </div>
    </SceneFrame>
  );
};
