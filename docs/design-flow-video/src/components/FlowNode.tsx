import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, SPACE, TYPE } from "../theme";

type FlowNodeProps = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
  sublabel?: string;
  tone?: "neutral" | "primary" | "warm" | "good" | "warn" | "danger";
  startAt?: number;
  active?: boolean;
};

const toneToBorder: Record<NonNullable<FlowNodeProps["tone"]>, string> = {
  neutral: "rgba(120, 160, 240, 0.28)",
  primary: PALETTE.accent,
  warm: PALETTE.accentWarm,
  good: PALETTE.good,
  warn: PALETTE.warn,
  danger: PALETTE.danger,
};

export const FlowNode: React.FC<FlowNodeProps> = ({
  x,
  y,
  width = 360,
  height = 140,
  label,
  sublabel,
  tone = "neutral",
  startAt = 0,
  active = false,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [startAt, startAt + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const ty = interpolate(frame, [startAt, startAt + 12], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const glowAmount = active
    ? interpolate(
        frame,
        [startAt + 8, startAt + 28],
        [0, 1],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_OUT,
        },
      )
    : 0;

  const border = toneToBorder[tone];

  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y - height / 2,
        width,
        height,
        opacity,
        transform: `translateY(${ty}px)`,
        background: PALETTE.panel,
        border: `1.5px solid ${active ? border : PALETTE.panelBorder}`,
        borderRadius: SPACE.radius,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 6,
        boxShadow: active
          ? `0 0 ${30 + 30 * glowAmount}px ${border}55, 0 12px 40px rgba(0,0,0,0.5)`
          : `0 12px 40px rgba(0,0,0,0.4)`,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          fontFamily: TYPE.family,
          fontSize: TYPE.scale.h3,
          fontWeight: 700,
          color: PALETTE.fg,
          letterSpacing: -0.3,
          lineHeight: 1.1,
        }}
      >
        {label}
      </div>
      {sublabel ? (
        <div
          style={{
            fontFamily: TYPE.mono,
            fontSize: TYPE.scale.small,
            color: PALETTE.fgDim,
            letterSpacing: 0.5,
          }}
        >
          {sublabel}
        </div>
      ) : null}
    </div>
  );
};
