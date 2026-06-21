import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { SHOTS_S01_TITLE } from "../data/shotLists";
import { SCENES } from "../data/scenes";
import { BackdropGrid } from "../components/BackdropGrid";
import { EASE_OUT, PALETTE, STAGE, TYPE } from "../theme";
import { SceneFrame } from "./SceneFrame";

const DURATION = SCENES.find((s) => s.id === "S01_Title")!.durationFrames;

export const S01_Title: React.FC = () => {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [4, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const titleOpacity = interpolate(frame, [12, 32], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const titleY = interpolate(frame, [12, 32], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const subOpacity = interpolate(frame, [28, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const ruleScale = interpolate(frame, [22, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const footerOpacity = interpolate(
    frame,
    [60, 90],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT },
  );
  const fadeOut = interpolate(
    frame,
    [DURATION - 12, DURATION],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT },
  );

  return (
    <SceneFrame shots={SHOTS_S01_TITLE} totalDuration={DURATION} vignetteIntensity={0.65}>
      <BackdropGrid />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          opacity: fadeOut,
        }}
      >
        <div
          style={{
            opacity: kickerOpacity,
            fontFamily: TYPE.mono,
            fontSize: 36,
            color: PALETTE.accent,
            letterSpacing: 8,
            textTransform: "uppercase",
          }}
        >
          docs / SYSTEM_DESIGN.md
        </div>
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            fontFamily: TYPE.family,
            fontSize: 200,
            fontWeight: 800,
            color: PALETTE.fg,
            letterSpacing: -3,
            lineHeight: 1.0,
            textAlign: "center",
          }}
        >
          AbaYa Track
        </div>
        <div
          style={{
            width: 480,
            height: 4,
            background: PALETTE.accent,
            transform: `scaleX(${ruleScale})`,
            transformOrigin: "center",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            opacity: subOpacity,
            fontFamily: TYPE.family,
            fontSize: 44,
            color: PALETTE.fgDim,
            marginTop: 16,
            textAlign: "center",
            letterSpacing: 0.5,
          }}
        >
          Hybrid factory-floor and cloud analytics system
        </div>
        <div
          style={{
            opacity: subOpacity,
            fontFamily: TYPE.mono,
            fontSize: 28,
            color: PALETTE.fgFaint,
            marginTop: 32,
            letterSpacing: 2,
          }}
        >
          A design-flow walkthrough
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: STAGE.centerX - 600,
          top: STAGE.centerY + 600,
          width: 1200,
          textAlign: "center",
          opacity: footerOpacity,
          fontFamily: TYPE.mono,
          fontSize: 22,
          color: PALETTE.fgFaint,
          letterSpacing: 3,
        }}
      >
        Local-first  -  Cloud-eventual  -  Browser-only CEO
      </div>
    </SceneFrame>
  );
};
