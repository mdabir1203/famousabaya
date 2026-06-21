import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, TYPE } from "../theme";

type StepCounterProps = {
  index: number;
  total: number;
  startAt?: number;
  x?: number;
  y?: number;
};

export const StepCounter: React.FC<StepCounterProps> = ({
  index,
  total,
  startAt = 0,
  x,
  y,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [startAt, startAt + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const scale = interpolate(frame, [startAt, startAt + 10], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const wrapperStyle: React.CSSProperties =
    x !== undefined && y !== undefined
      ? { position: "absolute", left: x, top: y }
      : {};

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        ...wrapperStyle,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 18px",
          borderRadius: 999,
          background: "rgba(108, 194, 255, 0.12)",
          border: `1px solid ${PALETTE.accent}55`,
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.small,
          color: PALETTE.accent,
          letterSpacing: 1.5,
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: PALETTE.fg }}>
          Step {index.toString().padStart(2, "0")}
        </span>
        <span style={{ color: PALETTE.fgFaint }}>/</span>
        <span>{total}</span>
      </div>
    </div>
  );
};
