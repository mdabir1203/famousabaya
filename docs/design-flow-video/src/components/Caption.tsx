import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, TYPE } from "../theme";

type CaptionProps = {
  startAt?: number;
  durationFrames?: number;
  align?: "left" | "center" | "right";
  size?: number;
  color?: string;
  children: React.ReactNode;
};

export const Caption: React.FC<CaptionProps> = ({
  startAt = 0,
  durationFrames = 24,
  align = "center",
  size = TYPE.scale.body,
  color = PALETTE.fgDim,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [startAt, startAt + durationFrames],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  const translateY = interpolate(
    frame,
    [startAt, startAt + durationFrames],
    [10, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        fontFamily: TYPE.family,
        fontSize: size,
        color,
        textAlign: align,
        letterSpacing: 0.2,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
};
