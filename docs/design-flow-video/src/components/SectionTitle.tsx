import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, TYPE } from "../theme";

type SectionTitleProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
  startAt?: number;
};

export const SectionTitle: React.FC<SectionTitleProps> = ({
  kicker,
  title,
  subtitle,
  startAt = 0,
}) => {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [startAt, startAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const titleOpacity = interpolate(
    frame,
    [startAt + 6, startAt + 22],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  const titleY = interpolate(frame, [startAt + 6, startAt + 22], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const ruleScale = interpolate(
    frame,
    [startAt + 14, startAt + 34],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );
  const subOpacity = interpolate(
    frame,
    [startAt + 22, startAt + 38],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    },
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {kicker ? (
        <div
          style={{
            opacity: kickerOpacity,
            fontFamily: TYPE.mono,
            fontSize: TYPE.scale.small,
            color: PALETTE.accent,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontFamily: TYPE.family,
          fontSize: TYPE.scale.h2,
          fontWeight: 700,
          color: PALETTE.fg,
          letterSpacing: -0.5,
          lineHeight: 1.05,
        }}
      >
        {title}
      </div>
      <div
        style={{
          width: 220,
          height: 3,
          background: PALETTE.accent,
          transform: `scaleX(${ruleScale})`,
          transformOrigin: "left center",
          opacity: 0.85,
          marginTop: 8,
        }}
      />
      {subtitle ? (
        <div
          style={{
            opacity: subOpacity,
            fontFamily: TYPE.family,
            fontSize: TYPE.scale.body,
            color: PALETTE.fgDim,
            marginTop: 12,
            maxWidth: 1100,
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
};
