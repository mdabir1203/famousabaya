import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, TYPE } from "../theme";

type StatBadgeProps = {
  value: string;
  label: string;
  startAt?: number;
  color?: string;
};

export const StatBadge: React.FC<StatBadgeProps> = ({
  value,
  label,
  startAt = 0,
  color = PALETTE.accent,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [startAt, startAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const scale = interpolate(frame, [startAt, startAt + 14], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "left center",
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.h2,
          color,
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: TYPE.family,
          fontSize: TYPE.scale.small,
          color: PALETTE.fgDim,
          letterSpacing: 1.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
};
