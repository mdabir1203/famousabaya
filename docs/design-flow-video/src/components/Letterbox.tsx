import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT } from "../theme";

type LetterboxProps = {
  enterAt?: number;
  exitBefore?: number;
  totalDuration: number;
  heightPx?: number;
};

export const Letterbox: React.FC<LetterboxProps> = ({
  enterAt = 0,
  exitBefore = 18,
  totalDuration,
  heightPx = 80,
}) => {
  const frame = useCurrentFrame();
  const enterDuration = 18;
  const enterEnd = enterAt + enterDuration;
  const exitStart = totalDuration - exitBefore;

  const heightIn = interpolate(frame, [enterAt, enterEnd], [0, heightPx], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const heightOut = interpolate(
    frame,
    [exitStart, totalDuration],
    [heightPx, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  const h = Math.min(heightIn, heightOut);

  const barStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    height: h,
    background: "#000",
    pointerEvents: "none",
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...barStyle, top: 0 }} />
      <div style={{ ...barStyle, bottom: 0 }} />
    </AbsoluteFill>
  );
};
