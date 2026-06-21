import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT, PALETTE, SPACE, TYPE } from "../theme";

type CodePanelProps = {
  lines: readonly string[];
  startAt?: number;
  perLineDelay?: number;
  caption?: string;
  width?: number;
};

export const CodePanel: React.FC<CodePanelProps> = ({
  lines,
  startAt = 0,
  perLineDelay = 4,
  caption,
  width = 720,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        width,
        background: PALETTE.bg1,
        border: `1px solid ${PALETTE.panelBorder}`,
        borderRadius: SPACE.radius,
        padding: 28,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}
    >
      {caption ? (
        <div
          style={{
            fontFamily: TYPE.mono,
            fontSize: TYPE.scale.small,
            color: PALETTE.fgFaint,
            marginBottom: 16,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          {caption}
        </div>
      ) : null}
      <pre
        style={{
          margin: 0,
          fontFamily: TYPE.mono,
          fontSize: TYPE.scale.mono,
          color: PALETTE.fg,
          lineHeight: 1.5,
          whiteSpace: "pre",
        }}
      >
        {lines.map((line, i) => {
          const lineStart = startAt + i * perLineDelay;
          const opacity = interpolate(
            frame,
            [lineStart, lineStart + 10],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE_OUT,
            },
          );
          const tx = interpolate(frame, [lineStart, lineStart + 10], [-8, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          });
          return (
            <div
              key={i}
              style={{
                opacity,
                transform: `translateX(${tx}px)`,
                display: "flex",
                gap: 16,
              }}
            >
              <span
                style={{ color: PALETTE.fgFaint, userSelect: "none", width: 24, textAlign: "right" }}
              >
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span>{line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
};
